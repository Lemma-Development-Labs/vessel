// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AssetCustody} from "./AssetCustody.sol";
import {BallastToken} from "./BallastToken.sol";
import {ClaimEscrow} from "./ClaimEscrow.sol";
import {IPauseGuardian, IStrategyEngine} from "./interfaces/ICore.sol";
import {Coupon} from "./libraries/Coupon.sol";
import {Coverage} from "./libraries/Coverage.sol";
import {Waterfall} from "./libraries/Waterfall.sol";

/// @title TrancheController
/// @notice The Vessel V1 core (spec §6–§9, §19–§20): asynchronous requests, one 28-day Hull
///         series at a time, forward-priced Ballast units with queued partial exits, the reserve
///         ledger, beta admission budgets and permissionless settlement.
/// @dev Composition (Session 2 freeze): RequestQueue, HullSeries, ReserveLedger and
///      BetaAdmission live here as internal state; custody, claim escrow and Ballast units are
///      separate contracts deployed by this constructor so every link is immutable.
///      Accounting identity after every settlement: A = H + B + R, where
///      A = custody.activeIdle + engine value − unpaid treasury liability. Pending subscriptions,
///      funded claims and quarantined transfers are outside A.
contract TrancheController is ReentrancyGuard {
    // ------------------------------------------------------------------ constants
    uint8 internal constant ADMISSION = 1;
    uint8 internal constant RISK_INCREASE = 2;
    uint8 internal constant SETTLEMENT = 4;

    uint256 public constant ABSOLUTE_LIFETIME_CAP = 25_000e6; // V1 ceiling (spec §19), immutable
    uint256 public constant HULL_TERM = 28 days;
    uint256 public constant SUBSCRIPTION_WINDOW = 72 hours;
    uint256 public constant EXIT_COOLDOWN = 48 hours;
    uint256 public constant MAX_SUBSCRIBERS = 25;
    uint256 public constant MAX_HULL_RATE_BPS = 1_500; // 15% cap (spec §8)
    uint256 public constant MIN_IDLE_BPS = 1_000; // 10% of A stays idle (spec §10)
    uint256 public constant RESERVE_TARGET_BPS = 200;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant ACC = 1e18;

    // ------------------------------------------------------------------ wiring
    IERC20 public immutable usdc;
    IPauseGuardian public immutable pauses;
    address public immutable governance;
    address public immutable operator;
    AssetCustody public immutable custody;
    ClaimEscrow public immutable escrow;
    BallastToken public immutable ballast;
    /// @dev Ballast virtual offsets (P02: release-manifest values, fixed at deployment).
    uint256 public immutable virtualUnits;
    uint256 public immutable virtualAssets;
    IStrategyEngine public engine;

    // ------------------------------------------------------------------ book
    uint256 public hullNav;
    uint256 public ballastNav;
    uint256 public reserveNav;
    uint256 public treasuryLiability;
    uint256 public lossCarry;
    /// @notice A recognized at the end of the last flow or settlement.
    uint256 public lastActive;
    uint256 public epoch;
    bool public impaired;
    uint256 public hullCap; // frozen senior entitlement once impaired
    uint256 public reserveCap; // frozen pre-impairment reserve entitlement

    // ------------------------------------------------------------------ policy (governance, bounded)
    uint256 public stageCap;
    uint256 public closeCost; // stressed close-cost estimate charged to Ballast in cover checks
    uint256 public maxValuationAge = 60;

    // ------------------------------------------------------------------ admission (BetaAdmission)
    uint256 public lifetimeAdmitted;
    uint256 public pendingReserved;
    mapping(address => uint256) public allowanceOf;
    mapping(address => uint256) public admittedOf;
    mapping(address => uint256) public reservedOf;

    // ------------------------------------------------------------------ requests (RequestQueue)
    enum Tranche {
        HULL,
        BALLAST
    }
    enum ReqStatus {
        NONE,
        ESCROWED,
        ADMITTED,
        REFUNDABLE,
        REFUNDED
    }

    struct DepositRequest {
        address owner;
        address receiver;
        Tranche tranche;
        uint64 seriesId;
        uint64 deadline;
        uint64 createdAt;
        ReqStatus status;
        uint256 assets;
        uint256 minOut; // Hull: minimum rate (bps); Ballast: minimum units
    }

    mapping(uint256 => DepositRequest) public deposits;
    uint256 public nextDepositId = 1;
    uint256[] internal ballastQueue;
    uint256 public ballastHead;

    enum ExitStatus {
        NONE,
        COOLING,
        FUNDED,
        CANCELLED
    }

    struct ExitRequest {
        address owner;
        address receiver;
        uint64 requestedAt;
        ExitStatus status;
        uint256 units; // remaining unfunded (still exposed)
        uint256 minAssetsPerUnitWad; // user minimum, applied proportionally
        uint256 funded; // USDC moved to escrow so far
    }

    mapping(uint256 => ExitRequest) public exits;
    uint256 public nextExitId = 1;
    uint256[] internal exitQueue;
    uint256 public exitHead;

    // ------------------------------------------------------------------ Hull series
    enum SeriesState {
        NONE,
        SUBSCRIPTION_OPEN,
        CANCELLED,
        ACTIVE,
        MATURED_UNWINDING,
        CLAIMABLE,
        CLOSED,
        IMPAIRED
    }

    struct Series {
        SeriesState state;
        uint64 subscriptionEnd;
        uint64 activation;
        uint64 maturity;
        uint64 termination;
        uint256 rateBps;
        bytes32 termsHash;
        uint256 principal;
        uint256 recognizedCoupon;
        uint256 accPerUnit; // cumulative USDC funded per principal unit (1e18)
        uint256[] requests;
    }

    mapping(uint256 => Series) internal series_;
    mapping(uint256 => mapping(address => uint256)) public hullUnits;
    mapping(uint256 => mapping(address => uint256)) public hullPaid;
    uint256 public seriesCount;
    uint256 public activeSeries; // 0 = none

    // ------------------------------------------------------------------ errors / events
    error NotGovernance();
    error NotOperator();
    error Paused(uint8 dim);
    error ZeroAmount();
    error ZeroAddress();
    error AboveCeiling();
    error NotEligible();
    error CapExceeded();
    error BadSeries();
    error SeriesBusy();
    error WindowClosed();
    error WindowOpen();
    error TooManySubscribers();
    error DeadlinePassed();
    error NotOwner();
    error BadStatus();
    error BookImpaired();
    error StaleValuation();
    error IdleFloor();
    error JuniorWipedOut();
    error NotMatured();
    error EngineAlreadySet();

    event EngineSet(address engine);
    event StageCapSet(uint256 cap);
    event AllowanceSet(address indexed wallet, uint256 allowance);
    event DepositRequested(
        uint256 indexed id, address indexed owner, Tranche tranche, uint256 seriesId, uint256 assets
    );
    event DepositAdmitted(uint256 indexed id, address indexed receiver, uint256 assets, uint256 units);
    event DepositRefundable(uint256 indexed id, string reason);
    event RefundPaid(uint256 indexed id, address indexed to, uint256 assets);
    event ReserveContributed(address indexed from, uint256 assets);
    event SeriesOpened(uint256 indexed seriesId, uint256 rateBps, bytes32 termsHash, uint256 subscriptionEnd);
    event SeriesActivated(uint256 indexed seriesId, uint256 principal, uint256 maturity);
    event SeriesCancelled(uint256 indexed seriesId, string reason);
    event SeriesMatured(uint256 indexed seriesId, uint256 entitlement);
    event SeriesFunded(uint256 indexed seriesId, uint256 amount, uint256 accPerUnit);
    event SeriesClosed(uint256 indexed seriesId);
    event HullClaimed(uint256 indexed seriesId, address indexed holder, uint256 amount);
    event ExitRequested(uint256 indexed id, address indexed owner, uint256 units);
    event ExitFunded(uint256 indexed id, uint256 unitsBurned, uint256 assets, uint256 unitsRemaining);
    event ExitUserLimited(uint256 indexed id);
    event ExitCancelled(uint256 indexed id, uint256 unitsReleased);
    event EpochSettled(
        uint256 indexed epoch,
        int256 G,
        uint256 coupon,
        uint256 fee,
        uint256 reserveFee,
        uint256 treasuryFee,
        uint256 H,
        uint256 B,
        uint256 R,
        uint256 lossCarry,
        bool impaired
    );
    event BookImpairedEvent(uint256 epoch, uint256 hullCap, uint256 reserveCap);
    event Deployed(uint256 amount);
    event Recalled(uint256 amount);
    event TreasuryPaid(uint256 amount);

    constructor(
        IERC20 usdc_,
        IPauseGuardian pauses_,
        address governance_,
        address operator_,
        address treasury_,
        uint256 virtualUnits_,
        uint256 virtualAssets_
    ) {
        if (governance_ == address(0) || operator_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (virtualUnits_ == 0 || virtualAssets_ == 0) revert ZeroAmount();
        usdc = usdc_;
        pauses = pauses_;
        governance = governance_;
        operator = operator_;
        escrow = new ClaimEscrow(usdc_, pauses_, address(this));
        custody = new AssetCustody(usdc_, address(this), address(escrow), treasury_);
        ballast = new BallastToken(address(this));
        virtualUnits = virtualUnits_;
        virtualAssets = virtualAssets_;
    }

    // ================================================================== modifiers
    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier notPaused(uint8 dim) {
        if (pauses.isPaused(dim)) revert Paused(dim);
        _;
    }

    // ================================================================== governance (bounded)
    function setEngine(IStrategyEngine engine_) external onlyGovernance {
        if (address(engine) != address(0)) revert EngineAlreadySet();
        if (address(engine_) == address(0)) revert ZeroAddress();
        engine = engine_;
        custody.setEngine(address(engine_));
        emit EngineSet(address(engine_));
    }

    function setStageCap(uint256 cap) external onlyGovernance {
        if (cap > ABSOLUTE_LIFETIME_CAP) revert AboveCeiling();
        stageCap = cap;
        emit StageCapSet(cap);
    }

    function setAllowance(address wallet, uint256 allowance) external onlyGovernance {
        if (allowance > ABSOLUTE_LIFETIME_CAP) revert AboveCeiling();
        allowanceOf[wallet] = allowance;
        emit AllowanceSet(wallet, allowance);
    }

    function setCloseCost(uint256 cost) external onlyGovernance {
        closeCost = cost;
    }

    function setMaxValuationAge(uint256 secs) external onlyGovernance {
        if (secs == 0 || secs > 60) revert AboveCeiling(); // spec §10: ≤ 60 s
        maxValuationAge = secs;
    }

    /// @notice Pre-funded reserve / team seed. Counts against the lifetime budget (spec §19).
    function contributeReserve(uint256 assets) external onlyGovernance nonReentrant notPaused(ADMISSION) {
        if (assets == 0) revert ZeroAmount();
        if (lifetimeAdmitted + pendingReserved + assets > stageCap) revert CapExceeded();
        _settle();
        custody.receiveActive(msg.sender, assets);
        lifetimeAdmitted += assets;
        reserveNav += assets;
        lastActive += assets;
        emit ReserveContributed(msg.sender, assets);
    }

    function openSeries(uint256 rateBps, bytes32 termsHash)
        external
        onlyGovernance
        notPaused(ADMISSION)
        returns (uint256 id)
    {
        if (rateBps > MAX_HULL_RATE_BPS) revert AboveCeiling();
        if (impaired) revert BookImpaired();
        if (activeSeries != 0) revert SeriesBusy();
        id = ++seriesCount;
        Series storage s = series_[id];
        s.state = SeriesState.SUBSCRIPTION_OPEN;
        s.rateBps = rateBps;
        s.termsHash = termsHash;
        s.subscriptionEnd = uint64(block.timestamp + SUBSCRIPTION_WINDOW);
        activeSeries = id;
        emit SeriesOpened(id, rateBps, termsHash, s.subscriptionEnd);
    }

    function payTreasury(uint256 amount) external onlyGovernance nonReentrant {
        if (impaired) revert BookImpaired();
        uint256 sid = activeSeries;
        if (sid != 0 && series_[sid].state == SeriesState.MATURED_UNWINDING) revert SeriesBusy();
        if (amount == 0 || amount > treasuryLiability) revert CapExceeded();
        treasuryLiability -= amount;
        custody.payTreasury(amount); // A unchanged: idle and liability fall together
        emit TreasuryPaid(amount);
    }

    // ================================================================== requests
    /// @notice Escrow USDC for a Hull subscription or Ballast admission. Reserves lifetime and
    ///         participant quota now; the money earns nothing and is never deployed until admitted.
    function requestDeposit(
        Tranche tranche,
        uint256 seriesId,
        uint256 assets,
        address receiver,
        uint256 minOut,
        uint256 deadline
    ) external nonReentrant notPaused(ADMISSION) returns (uint256 id) {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        if (deadline <= block.timestamp) revert DeadlinePassed();
        if (impaired) revert BookImpaired();
        uint256 allowance = allowanceOf[msg.sender];
        if (allowance == 0) revert NotEligible();
        if (admittedOf[msg.sender] + reservedOf[msg.sender] + assets > allowance) revert CapExceeded();
        if (lifetimeAdmitted + pendingReserved + assets > stageCap) revert CapExceeded();

        id = nextDepositId++;
        if (tranche == Tranche.HULL) {
            Series storage s = series_[seriesId];
            if (s.state != SeriesState.SUBSCRIPTION_OPEN) revert BadSeries();
            if (block.timestamp >= s.subscriptionEnd) revert WindowClosed();
            if (s.requests.length >= MAX_SUBSCRIBERS) revert TooManySubscribers();
            s.requests.push(id);
        } else {
            if (seriesId != 0) revert BadSeries();
            ballastQueue.push(id);
        }
        pendingReserved += assets;
        reservedOf[msg.sender] += assets;
        deposits[id] = DepositRequest({
            owner: msg.sender,
            receiver: receiver,
            tranche: tranche,
            seriesId: uint64(seriesId),
            deadline: uint64(deadline),
            createdAt: uint64(block.timestamp),
            status: ReqStatus.ESCROWED,
            assets: assets,
            minOut: minOut
        });
        custody.receivePending(msg.sender, assets);
        emit DepositRequested(id, msg.sender, tranche, seriesId, assets);
    }

    /// @notice Cancel an unadmitted request. Hull subscriptions can be cancelled only while the
    ///         window is open (the ordered set freezes at activation).
    function cancelDeposit(uint256 id) external nonReentrant {
        DepositRequest storage d = deposits[id];
        if (d.owner != msg.sender) revert NotOwner();
        if (d.status != ReqStatus.ESCROWED) revert BadStatus();
        if (d.tranche == Tranche.HULL && series_[d.seriesId].state != SeriesState.SUBSCRIPTION_OPEN) {
            revert BadStatus();
        }
        _makeRefundable(id, "cancelled");
    }

    /// @notice Pay a never-admitted request back to its owner. Anyone may trigger it.
    function claimRefund(uint256 id) external nonReentrant {
        DepositRequest storage d = deposits[id];
        if (d.status != ReqStatus.REFUNDABLE) revert BadStatus();
        d.status = ReqStatus.REFUNDED;
        custody.refund(d.owner, d.assets);
        emit RefundPaid(id, d.owner, d.assets);
    }

    function _makeRefundable(uint256 id, string memory reason) private {
        DepositRequest storage d = deposits[id];
        d.status = ReqStatus.REFUNDABLE;
        pendingReserved -= d.assets;
        reservedOf[d.owner] -= d.assets;
        emit DepositRefundable(id, reason);
    }

    function _admitQuota(DepositRequest storage d) private {
        pendingReserved -= d.assets;
        reservedOf[d.owner] -= d.assets;
        lifetimeAdmitted += d.assets;
        admittedOf[d.owner] += d.assets;
        custody.admit(d.assets);
        lastActive += d.assets;
        d.status = ReqStatus.ADMITTED;
    }

    // ================================================================== Ballast
    /// @notice Forward-priced admission: settle the existing book first, then mint at the
    ///         post-settlement price. Bounded by `maxItems`; expired or under-minimum requests
    ///         become refundable instead of blocking the queue.
    function processDepositBatch(uint256 maxItems)
        external
        nonReentrant
        notPaused(ADMISSION)
        notPaused(SETTLEMENT)
        returns (uint256 processed)
    {
        if (impaired) revert BookImpaired();
        _settle();
        uint256 supply = ballast.totalSupply();
        if (ballastNav == 0 && supply > 0) revert JuniorWipedOut();
        uint256 i = ballastHead;
        uint256 end = ballastQueue.length;
        while (i < end && processed < maxItems) {
            uint256 id = ballastQueue[i++];
            processed++;
            DepositRequest storage d = deposits[id];
            if (d.status != ReqStatus.ESCROWED) continue;
            if (block.timestamp > d.deadline) {
                _makeRefundable(id, "deadline");
                continue;
            }
            uint256 units = _unitsFor(d.assets, supply);
            if (units == 0 || units < d.minOut) {
                _makeRefundable(id, "minimum units");
                continue;
            }
            _admitQuota(d);
            ballastNav += d.assets;
            supply += units;
            ballast.mint(d.receiver, units);
            emit DepositAdmitted(id, d.receiver, d.assets, units);
        }
        ballastHead = i;
    }

    function _unitsFor(uint256 assets, uint256 supply) private view returns (uint256) {
        return (assets * (supply + virtualUnits)) / (ballastNav + virtualAssets);
    }

    function _assetsFor(uint256 units, uint256 supply) private view returns (uint256) {
        return (units * (ballastNav + virtualAssets)) / (supply + virtualUnits);
    }

    /// @notice Lock units into an exit request. They stay exposed until funded.
    function requestBallastRedeem(uint256 units, address receiver, uint256 minAssets)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (units == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        ballast.lock(msg.sender, units);
        id = nextExitId++;
        exits[id] = ExitRequest({
            owner: msg.sender,
            receiver: receiver,
            requestedAt: uint64(block.timestamp),
            status: ExitStatus.COOLING,
            units: units,
            minAssetsPerUnitWad: (minAssets * ACC) / units,
            funded: 0
        });
        exitQueue.push(id);
        emit ExitRequested(id, msg.sender, units);
    }

    function cancelRedeem(uint256 id) external nonReentrant {
        ExitRequest storage e = exits[id];
        if (e.owner != msg.sender) revert NotOwner();
        if (e.status != ExitStatus.COOLING) revert BadStatus();
        uint256 units = e.units;
        e.units = 0;
        e.status = ExitStatus.CANCELLED;
        ballast.unlock(msg.sender, units);
        emit ExitCancelled(id, units);
    }

    /// @notice Fund eligible exits in request order, bounded by liquid USDC and by projected 30%
    ///         junior cover after the remaining Hull coupon and stressed close cost. Only the
    ///         funded fraction is burned; the rest stays exposed with its original cooldown.
    function processExitBatch(uint256 maxItems)
        external
        nonReentrant
        notPaused(SETTLEMENT)
        returns (uint256 processed)
    {
        if (impaired) revert BookImpaired();
        _settle();
        uint256 budget = _exitBudget();
        uint256 i = exitHead;
        uint256 end = exitQueue.length;
        while (i < end && processed < maxItems && budget > 0) {
            uint256 id = exitQueue[i];
            ExitRequest storage e = exits[id];
            if (e.status != ExitStatus.COOLING || e.units == 0) {
                i++;
                continue;
            }
            if (block.timestamp < e.requestedAt + EXIT_COOLDOWN) break; // FIFO by time
            processed++;
            uint256 supply = ballast.totalSupply();
            uint256 value = _assetsFor(e.units, supply);
            uint256 pay = value < budget ? value : budget;
            uint256 unitsBurn = pay == value ? e.units : (e.units * pay) / value;
            if (unitsBurn == 0) break;
            pay = _assetsFor(unitsBurn, supply); // never pay more than the burned units are worth
            if (pay * ACC < e.minAssetsPerUnitWad * unitsBurn) {
                // A user minimum that cannot be met never blocks the queue.
                emit ExitUserLimited(id);
                i++;
                continue;
            }
            ballast.burnLocked(e.owner, unitsBurn);
            ballastNav -= pay;
            lastActive -= pay;
            budget -= pay;
            e.units -= unitsBurn;
            e.funded += pay;
            if (e.units == 0) e.status = ExitStatus.FUNDED;
            custody.toEscrow(pay);
            escrow.fund(_exitKey(id), e.receiver, pay);
            emit ExitFunded(id, unitsBurn, pay, e.units);
            if (e.units == 0) i++;
        }
        exitHead = i;
    }

    function _exitBudget() private view returns (uint256) {
        uint256 cFuture;
        uint256 sid = activeSeries;
        if (sid != 0 && series_[sid].state == SeriesState.ACTIVE) {
            Series storage s = series_[sid];
            uint256 full = Coupon.accrued(s.principal, s.rateBps, s.activation, s.maturity, s.maturity, 0);
            cFuture = full - s.recognizedCoupon;
        }
        uint256 bound = Coverage.payoutBound(hullNav, ballastNav, cFuture, closeCost);
        uint256 idle = custody.activeIdle();
        uint256 liquid = idle > treasuryLiability ? idle - treasuryLiability : 0;
        return bound < liquid ? bound : liquid;
    }

    function exitKey(uint256 id) external pure returns (bytes32) {
        return _exitKey(id);
    }

    function _exitKey(uint256 id) private pure returns (bytes32) {
        return keccak256(abi.encode("VESSEL_EXIT", id));
    }

    // ================================================================== Hull
    /// @notice After the 72 h window: settle, then admit the ordered subscription set in one
    ///         transaction on identical terms. Subscriptions whose minimum rate or deadline fails,
    ///         or that would break projected 30% cover or the 2% pre-funded reserve, are
    ///         refundable. If nothing is admitted the series is cancelled.
    function activateSeries(uint256 seriesId)
        external
        nonReentrant
        notPaused(ADMISSION)
        notPaused(RISK_INCREASE)
        notPaused(SETTLEMENT)
    {
        Series storage s = series_[seriesId];
        if (s.state != SeriesState.SUBSCRIPTION_OPEN) revert BadSeries();
        if (block.timestamp < s.subscriptionEnd) revert WindowOpen();
        if (impaired) revert BookImpaired();
        _settle();

        uint256 principal;
        uint256 n = s.requests.length;
        for (uint256 k = 0; k < n; k++) {
            uint256 id = s.requests[k];
            DepositRequest storage d = deposits[id];
            if (d.status != ReqStatus.ESCROWED) continue;
            if (block.timestamp > d.deadline) {
                _makeRefundable(id, "deadline");
                continue;
            }
            if (s.rateBps < d.minOut) {
                _makeRefundable(id, "minimum rate");
                continue;
            }
            uint256 y = principal + d.assets;
            bool coverOk = Coverage.newHullOk(hullNav, ballastNav, y, s.rateBps, HULL_TERM, closeCost);
            bool reserveOk = reserveNav * BPS >= RESERVE_TARGET_BPS * (hullNav + ballastNav + reserveNav + y);
            if (!coverOk || !reserveOk) {
                _makeRefundable(id, coverOk ? "reserve" : "junior cover");
                continue;
            }
            principal = y;
            _admitQuota(d);
            hullUnits[seriesId][d.receiver] += d.assets; // one principal unit per USDC base unit
            emit DepositAdmitted(id, d.receiver, d.assets, d.assets);
        }
        if (principal == 0) {
            s.state = SeriesState.CANCELLED;
            activeSeries = 0;
            emit SeriesCancelled(seriesId, "nothing admitted");
            return;
        }
        s.state = SeriesState.ACTIVE;
        s.principal = principal;
        s.activation = uint64(block.timestamp);
        s.maturity = uint64(block.timestamp + HULL_TERM);
        hullNav += principal;
        emit SeriesActivated(seriesId, principal, s.maturity);
    }

    /// @notice At maturity (or after impairment): settle — coupon stops at maturity/termination —
    ///         and move the series to unwinding. Funding claims needs liquid USDC (fundSeries).
    function matureSeries(uint256 seriesId) external nonReentrant notPaused(SETTLEMENT) {
        Series storage s = series_[seriesId];
        bool terminated = s.state == SeriesState.IMPAIRED;
        if (s.state != SeriesState.ACTIVE && !terminated) revert BadSeries();
        if (!terminated && block.timestamp < s.maturity) revert NotMatured();
        _settle();
        s.state = SeriesState.MATURED_UNWINDING;
        emit SeriesMatured(seriesId, hullNav);
    }

    /// @notice Move up to the senior allocation into escrow, pro-rata for every holder
    ///         (cumulative per-unit accounting: no first-claimer advantage, and later recoveries
    ///         reach earlier claimers too).
    function fundSeries(uint256 seriesId) external nonReentrant notPaused(SETTLEMENT) returns (uint256 amount) {
        Series storage s = series_[seriesId];
        if (s.state != SeriesState.MATURED_UNWINDING && s.state != SeriesState.CLAIMABLE) revert BadSeries();
        _settle();
        uint256 idle = custody.activeIdle();
        uint256 liquid = idle > treasuryLiability ? idle - treasuryLiability : 0;
        amount = hullNav < liquid ? hullNav : liquid;
        if (amount == 0) return 0;
        hullNav -= amount;
        lastActive -= amount;
        s.accPerUnit += (amount * ACC) / s.principal;
        custody.toEscrow(amount);
        escrow.fund(_seriesKey(seriesId), address(0), amount);
        emit SeriesFunded(seriesId, amount, s.accPerUnit);
        if (hullNav == 0 && !impaired) {
            s.state = SeriesState.CLAIMABLE;
        }
    }

    function claimHull(uint256 seriesId) external nonReentrant returns (uint256 amount) {
        Series storage s = series_[seriesId];
        uint256 units = hullUnits[seriesId][msg.sender];
        uint256 owed = (units * s.accPerUnit) / ACC;
        amount = owed - hullPaid[seriesId][msg.sender];
        if (amount == 0) revert ZeroAmount();
        hullPaid[seriesId][msg.sender] = owed;
        escrow.release(_seriesKey(seriesId), msg.sender, amount);
        emit HullClaimed(seriesId, msg.sender, amount);
    }

    /// @notice Close a fully funded series so the next one can open.
    function closeMaturedSeries(uint256 seriesId) external nonReentrant {
        Series storage s = series_[seriesId];
        if (s.state != SeriesState.CLAIMABLE) revert BadSeries();
        s.state = SeriesState.CLOSED;
        if (activeSeries == seriesId) activeSeries = 0;
        emit SeriesClosed(seriesId);
    }

    function seriesKey(uint256 id) external pure returns (bytes32) {
        return _seriesKey(id);
    }

    function _seriesKey(uint256 id) private pure returns (bytes32) {
        return keccak256(abi.encode("VESSEL_HULL", id));
    }

    // ================================================================== engine (operator)
    /// @notice Internal transfer to the engine. Not a flow: G is unchanged.
    function deployToEngine(uint256 amount) external onlyOperator nonReentrant notPaused(RISK_INCREASE) {
        if (impaired) revert BookImpaired();
        uint256 a = activeAssets();
        uint256 idle = custody.activeIdle();
        if (amount > idle) revert IdleFloor();
        uint256 idleAfter = idle - amount;
        if (idleAfter < treasuryLiability + (a * MIN_IDLE_BPS) / BPS) revert IdleFloor();
        custody.toEngine(amount);
        emit Deployed(amount);
    }

    /// @notice Reducing exposure is always allowed, even while risk increase is paused.
    function recallFromEngine(uint256 amount) external onlyOperator nonReentrant {
        custody.fromEngine(amount);
        emit Recalled(amount);
    }

    // ================================================================== settlement
    function settle() external nonReentrant notPaused(SETTLEMENT) {
        _settle();
    }

    /// @notice A = activeIdle + engine value − unpaid treasury liability.
    function activeAssets() public view returns (uint256) {
        uint256 engineValue;
        if (address(engine) != address(0)) {
            uint256 observedAt;
            (engineValue, observedAt) = engine.value();
            if (observedAt + maxValuationAge < block.timestamp) revert StaleValuation();
        }
        uint256 gross = custody.activeIdle() + engineValue;
        return gross > treasuryLiability ? gross - treasuryLiability : 0;
    }

    function _settle() private {
        uint256 a = activeAssets();
        int256 g = int256(a) - int256(lastActive);
        uint256 coupon;
        uint256 sid = activeSeries;
        if (sid != 0 && series_[sid].state == SeriesState.ACTIVE) {
            Series storage s = series_[sid];
            uint256 accrued = Coupon.accrued(s.principal, s.rateBps, s.activation, block.timestamp, s.maturity, 0);
            coupon = accrued - s.recognizedCoupon;
            s.recognizedCoupon = accrued;
        }
        epoch++;
        if (impaired) {
            (hullNav, ballastNav, reserveNav) =
                Waterfall.settleRecovery(hullNav, ballastNav, reserveNav, g, hullCap, reserveCap);
            lossCarry = g >= 0 ? (lossCarry > uint256(g) ? lossCarry - uint256(g) : 0) : lossCarry + uint256(-g);
            lastActive = hullNav + ballastNav + reserveNav;
            emit EpochSettled(epoch, g, 0, 0, 0, 0, hullNav, ballastNav, reserveNav, lossCarry, true);
            return;
        }
        uint256 reserveBefore = reserveNav;
        uint256 entitlementBefore = hullNav + coupon;
        Waterfall.Out memory o = Waterfall.settle(
            Waterfall.In({H: hullNav, B: ballastNav, R: reserveNav, G: g, C: coupon, L: lossCarry, feesDisabled: false})
        );
        hullNav = o.H;
        ballastNav = o.B;
        reserveNav = o.R;
        lossCarry = o.Lnext;
        treasuryLiability += o.FT;
        lastActive = o.H + o.B + o.R;
        emit EpochSettled(epoch, g, coupon, o.F, o.FR, o.FT, o.H, o.B, o.R, o.Lnext, o.impaired);
        if (o.impaired) {
            // Freeze the senior entitlement (principal + coupon accrued to now) and the
            // pre-impairment reserve; fees stay zero and recoveries restore them in that order.
            impaired = true;
            hullCap = entitlementBefore;
            reserveCap = reserveBefore;
            if (sid != 0) {
                Series storage s = series_[sid];
                s.termination = uint64(block.timestamp);
                if (s.state == SeriesState.ACTIVE) s.state = SeriesState.IMPAIRED;
            }
            emit BookImpairedEvent(epoch, hullCap, reserveCap);
        }
    }

    // ================================================================== views
    function seriesInfo(uint256 id)
        external
        view
        returns (
            SeriesState state,
            uint256 rateBps,
            bytes32 termsHash,
            uint256 subscriptionEnd,
            uint256 activation,
            uint256 maturity,
            uint256 principal,
            uint256 recognizedCoupon,
            uint256 accPerUnit,
            uint256 subscriptions
        )
    {
        Series storage s = series_[id];
        return (
            s.state,
            s.rateBps,
            s.termsHash,
            s.subscriptionEnd,
            s.activation,
            s.maturity,
            s.principal,
            s.recognizedCoupon,
            s.accPerUnit,
            s.requests.length
        );
    }

    function juniorCoverBps() external view returns (uint256) {
        return Coverage.coverBps(hullNav, ballastNav);
    }

    function hullClaimable(uint256 seriesId, address holder) external view returns (uint256) {
        return (hullUnits[seriesId][holder] * series_[seriesId].accPerUnit) / ACC - hullPaid[seriesId][holder];
    }

    function ballastUnitValue(uint256 units) external view returns (uint256) {
        return _assetsFor(units, ballast.totalSupply());
    }

    function queueLengths() external view returns (uint256 ballastDeposits, uint256 ballastExits) {
        return (ballastQueue.length, exitQueue.length);
    }
}

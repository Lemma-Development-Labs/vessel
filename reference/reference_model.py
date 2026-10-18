"""Vessel handbook v4 educational reference model; NOT production code.

Run with Python 3.10+. Integer micro-USDC, deterministic examples and properties.
No venue, oracle, custody, bridge, access-control or lifecycle security claims.
"""
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
import csv
import random

UNIT = 10**6

def usd(value):
    return int(Decimal(str(value)) * UNIT)

@dataclass(frozen=True)
class Settlement:
    hull: int
    ballast: int
    reserve: int
    fee: int
    reserve_fee: int
    treasury_fee: int
    loss_carry: int
    impaired: bool

def settle(h, b, r, g, coupon, prior_loss=0, fee_disabled=False):
    """Solvent epoch only; insolvency beyond available assets raises explicitly.

    Round assessed fee and reserve allocation down in micro-USDC. Production
    must review its own valuation precision and cumulative rounding policy.
    """
    if min(h, b, r, coupon, prior_loss) < 0:
        raise ValueError('negative nonnegative input')
    if h + b + r + g < 0:
        raise ValueError('insolvent: obligations exceed recoverable assets')
    eligible = max(g - prior_loss, 0)
    loss_next = max(prior_loss - g, 0)
    fee = 0 if fee_disabled else eligible // 10
    deficit = max((h + b + r) * 2 // 100 - r, 0)
    reserve_fee = min(fee // 2, deficit)

    def allocation(f, fr):
        hn, bn, rn = h + coupon, b, r + fr
        residual = g - f - coupon
        if residual >= 0:
            bn += residual
        else:
            loss = -residual
            hit = min(bn, loss); bn -= hit; loss -= hit
            hit = min(rn, loss); rn -= hit; loss -= hit
            hn -= loss
        return hn, bn, rn

    hn, bn, rn = allocation(fee, reserve_fee)
    if hn < h + coupon:
        fee = reserve_fee = 0
        hn, bn, rn = allocation(0, 0)
    ft = fee - reserve_fee
    assert min(hn, bn, rn, ft) >= 0
    assert hn + bn + rn + ft == h + b + r + g
    assert hn >= h + coupon or fee == 0
    return Settlement(hn, bn, rn, fee, reserve_fee, ft, loss_next, hn < h + coupon)

class AdmissionBudget:
    """Isolated global quota example, NOT a complete request controller.

    Production also needs participant identity/slots, per-person quotas,
    authorization, expiry, asset receipts, state transition and risk checks.
    """
    def __init__(self, cap):
        self.cap, self.admitted = cap, 0
        self.pending, self.closed = {}, set()

    def reserve(self, identity, maximum):
        if maximum <= 0 or identity in self.pending or identity in self.closed:
            raise ValueError('invalid or replayed reservation')
        if self.admitted + sum(self.pending.values()) + maximum > self.cap:
            raise ValueError('lifetime contribution cap')
        self.pending[identity] = maximum

    def admit(self, identity, actual):
        if identity not in self.pending or not 0 < actual <= self.pending[identity]:
            raise ValueError('invalid admission')
        self.pending.pop(identity)
        self.admitted += actual
        self.closed.add(identity)

    def refund_never_admitted(self, identity):
        self.pending.pop(identity)
        self.closed.add(identity)

def verify():
    # Expected outputs were derived in the handbook, independently of this code.
    cases = [
        ('positive', (7000,3000,200,100,20,0), (7020,3070,204,6)),
        ('below_coupon', (7000,3000,200,10,20,0), (7020,2989,'200.5','0.5')),
        ('loss', (7000,3000,200,-100,20,0), (7020,2880,200,0)),
        ('reserve', (7000,30,200,-100,20,0), (7020,0,110,0)),
        ('senior_impairment', (7000,30,20,-100,20,0), (6950,0,0,0)),
        ('loss_recovery', (7000,3000,200,100,20,120), (7020,3080,200,0)),
        ('partial_fee', (7000,3000,200,100,20,40), (7020,3074,203,3)),
        ('fee_waiver', (100,0,0,10,20,0), (110,0,0,0)),
    ]
    rows = []
    for name, values, expected in cases:
        v = [usd(x) for x in values]
        result = settle(*v)
        assert (result.hull,result.ballast,result.reserve,result.treasury_fee) == tuple(usd(x) for x in expected), name
        rows.append([name,*values,*(str(Decimal(x)/UNIT) for x in (result.hull,result.ballast,result.reserve,result.treasury_fee,result.loss_carry))])
    rng = random.Random(20260930)
    for _ in range(5000):
        h,b,r = [rng.randrange(0,20000*UNIT) for _ in range(3)]
        g = rng.randrange(-(h+b+r), max(1,1000*UNIT))
        c,l = rng.randrange(0,500*UNIT),rng.randrange(0,5000*UNIT)
        result = settle(h,b,r,g,c,l)
        assert result.loss_carry == max(l-g,0)
        assert result.fee <= max(g-l,0)//10
        no_fee = settle(h,b,r,g,c,l,fee_disabled=True)
        assert no_fee.fee == no_fee.reserve_fee == no_fee.treasury_fee == 0
    try:
        settle(1,0,0,-2,0)
        raise AssertionError('insolvency not detected')
    except ValueError:
        pass
    coupon = Fraction(usd(1000)*8*28,100*365)
    assert coupon.numerator // coupon.denominator == usd('6.136986')
    cover_limit = (Fraction(4000-100-50)-Fraction(3,10)*(10000-50))/Fraction(7,10)
    assert cover_limit == Fraction(8650,7)
    ledger = AdmissionBudget(usd(1000))
    ledger.reserve('native',usd(400)); ledger.reserve('remote',usd(600))
    try:
        ledger.reserve('overflow',1)
        raise AssertionError('cap bypass')
    except ValueError:
        pass
    ledger.admit('remote',usd(597))
    try:
        ledger.admit('remote',usd(597))
        raise AssertionError('duplicate admission')
    except ValueError:
        pass
    ledger.refund_never_admitted('native')
    assert ledger.admitted == usd(597)
    ledger.reserve('next',usd(403)); ledger.admit('next',usd(403))
    # User withdrawals do not modify the admitted lifetime counter.
    assert ledger.admitted == ledger.cap
    dest = Path(__file__).with_name('accounting_test_vectors.csv')
    with dest.open('w',newline='') as out:
        writer=csv.writer(out)
        writer.writerow(['case','H_start','B_start','R_start','G','coupon','prior_loss','H_final','B_final','R_final','treasury_fee','loss_next'])
        writer.writerows(rows)
    print('PASS: 8 manual vectors; 5000 seeded cases plus fee-disabled variants; explicit insolvency; coupon/cover arithmetic; reservation/replay checks. Not a production audit.')

if __name__ == '__main__':
    verify()

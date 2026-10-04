"""Export golden vectors from the supplied reference model (unchanged) as JSON.

Solidity (Foundry vm.parseJson), TypeScript (packages/math) and Python all
consume these files, so every implementation is judged against the same
independent numbers. Units: integer micro-USDC (6 decimals), serialized as
decimal strings. Run:  python3 reference/export_vectors.py
"""
import json
import random
from fractions import Fraction
from pathlib import Path

import reference_model as rm

OUT = Path(__file__).with_name("vectors")
U = rm.UNIT


def s(x: int) -> str:
    return str(x)


def settlement_case(name, h, b, r, g, c, l, fee_disabled=False):
    out = rm.settle(h, b, r, g, c, l, fee_disabled=fee_disabled)
    return {
        "name": name,
        "in": {"H": s(h), "B": s(b), "R": s(r), "G": s(g), "C": s(c), "L": s(l), "feesDisabled": fee_disabled},
        "out": {
            "H": s(out.hull), "B": s(out.ballast), "R": s(out.reserve), "F": s(out.fee),
            "FR": s(out.reserve_fee), "FT": s(out.treasury_fee), "Lnext": s(out.loss_carry),
            "impaired": out.impaired,
        },
    }


def main() -> None:
    OUT.mkdir(exist_ok=True)
    manual = [
        ("positive", (7000, 3000, 200, 100, 20, 0)),
        ("below_coupon", (7000, 3000, 200, 10, 20, 0)),
        ("loss", (7000, 3000, 200, -100, 20, 0)),
        ("reserve", (7000, 30, 200, -100, 20, 0)),
        ("senior_impairment", (7000, 30, 20, -100, 20, 0)),
        ("loss_recovery", (7000, 3000, 200, 100, 20, 120)),
        ("partial_fee", (7000, 3000, 200, 100, 20, 40)),
        ("fee_waiver", (100, 0, 0, 10, 20, 0)),
    ]
    golden = [settlement_case(n, *[rm.usd(x) for x in v]) for n, v in manual]
    (OUT / "settlement.json").write_text(json.dumps({"unit": "USDC:6", "cases": golden}, indent=2) + "\n")

    # Seeded solvent cases (same distribution as reference_model.verify), plus
    # the fee-disabled variant of each.
    rng = random.Random(20260930)
    cases = []
    for i in range(5000):
        h, b, r = [rng.randrange(0, 20000 * U) for _ in range(3)]
        g = rng.randrange(-(h + b + r), max(1, 1000 * U))
        c, l = rng.randrange(0, 500 * U), rng.randrange(0, 5000 * U)
        cases.append(settlement_case(f"seed{i}", h, b, r, g, c, l))
        cases.append(settlement_case(f"seed{i}_nofee", h, b, r, g, c, l, fee_disabled=True))
    (OUT / "settlement_seeded.json").write_text(
        json.dumps({"unit": "USDC:6", "seed": 20260930, "cases": cases}) + "\n"
    )
    # Same cases as flat 32-byte big-endian words for Solidity (16 words per
    # case): H B R G(int256, two's complement) C L feesDisabled | H' B' R' F FR
    # FT L' impaired | pad.
    def word(v: int) -> bytes:
        return (v % (1 << 256)).to_bytes(32, "big")
    blob = bytearray()
    for c in cases:
        i, o = c["in"], c["out"]
        vals = [int(i[k]) for k in "HBRGCL"] + [int(i["feesDisabled"])]
        vals += [int(o[k]) for k in ("H", "B", "R", "F", "FR", "FT", "Lnext")] + [int(o["impaired"]), 0]
        for v in vals:
            blob += word(v)
    (OUT / "settlement_seeded.bin").write_bytes(bytes(blob))

    # Coupon: principal x rate x seconds / 365 days, floored, 8% on 1,000 USDC for 28 days.
    coupon = Fraction(rm.usd(1000) * 8 * 28, 100 * 365)
    (OUT / "coupon.json").write_text(json.dumps({
        "unit": "USDC:6",
        "cases": [{
            "principal": s(rm.usd(1000)), "rateBps": "800", "seconds": str(28 * 86400),
            "expected": s(coupon.numerator // coupon.denominator),
        }],
    }, indent=2) + "\n")

    # Projected-cover payout bound: x <= [B - Cf - K - 0.30 (H + B - K)] / 0.70
    h, b, cf, k = rm.usd(6000), rm.usd(4000), rm.usd(100), rm.usd(50)
    bound = (Fraction(b - cf - k) - Fraction(3, 10) * (h + b - k)) / Fraction(7, 10)
    current = (Fraction(b) - Fraction(3, 10) * (h + b)) / Fraction(7, 10)
    (OUT / "coverage.json").write_text(json.dumps({
        "unit": "USDC:6",
        "cases": [{
            "H": s(h), "B": s(b), "Cfuture": s(cf), "K": s(k), "coverBps": "3000",
            "payoutBound": s(bound.numerator // bound.denominator),
            "currentOnlyBound": s(current.numerator // current.denominator),
        }],
    }, indent=2) + "\n")

    # Admission reservations, mirroring AdmissionBudget in the model.
    (OUT / "admission.json").write_text(json.dumps({
        "unit": "USDC:6",
        "cap": s(rm.usd(1000)),
        "steps": [
            {"op": "reserve", "id": "native", "amount": s(rm.usd(400)), "ok": True},
            {"op": "reserve", "id": "remote", "amount": s(rm.usd(600)), "ok": True},
            {"op": "reserve", "id": "overflow", "amount": "1", "ok": False},
            {"op": "admit", "id": "remote", "amount": s(rm.usd(597)), "ok": True},
            {"op": "admit", "id": "remote", "amount": s(rm.usd(597)), "ok": False},
            {"op": "refund", "id": "native", "ok": True},
            {"op": "reserve", "id": "next", "amount": s(rm.usd(403)), "ok": True},
            {"op": "admit", "id": "next", "amount": s(rm.usd(403)), "ok": True},
        ],
        "finalAdmitted": s(rm.usd(1000)),
    }, indent=2) + "\n")
    print(f"wrote {len(golden)} golden + {len(cases)} seeded settlement cases, coupon, coverage, admission")


if __name__ == "__main__":
    main()

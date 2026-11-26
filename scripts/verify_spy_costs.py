"""Verify cost scenarios and threshold signs with decimal P&L and the published cash spells."""

import argparse
import csv
import hashlib
import json
from decimal import Decimal as D, getcontext
from functools import lru_cache
from pathlib import Path

from verify_spy_spells import account, near


def verify(data, report_path, spells_path, cost_path):
    getcontext().prec = 40
    r, spells, study = [
        json.loads(p.read_bytes(), parse_float=D)
        for p in (report_path, spells_path, cost_path)
    ]
    assert study["version"] == "spy-cost-1"
    assert (
        hashlib.sha256(report_path.read_bytes()).hexdigest()
        == spells["sourceHash"]
        == study["sourceHash"]
    )
    assert (
        hashlib.sha256(data.read_bytes()).hexdigest()
        == r["dataHash"]
        == study["dataHash"]
    )
    with data.open() as f:
        bars = [
            (b["date"], D(b["open"]), D(b["close"]), D(b["distribution"]), b["payable"])
            for b in csv.DictReader(f)
            if r["start"] <= b["date"] <= r["end"]
        ]
    days = [b[0] for b in bars]
    assert (study["start"], study["end"], study["sessions"], study["capital"]) == (
        days[0],
        days[-1],
        len(days),
        10000,
    )
    out = {"market": set()}
    for k in ("model", "trend"):
        out[k] = {
            d
            for e in spells["spells"][k]
            for d in days
            if e["exit"] <= d and (not e["reentry"] or d < e["reentry"])
        }
    assert (
        len(out["model"]) == study["cashDays"] == 69
        and len(spells["spells"]["model"]) == study["modelExits"] == 64
    )

    @lru_cache(maxsize=None)
    def balance(k, f, s):
        return account(bars, out[k], D(f) / 10000, D(s) / 10000)[0]

    axis = [D(i) / 4 for i in range(25)]
    assert study["axisBp"] == axis and study["published"] == dict(fee=1, slip=2)

    def check_point(point, fee, slip):
        for k in out:
            near(point[k], balance(k, fee, slip))

    for f, row in zip(axis, study["grid"], strict=True):
        for s, point in zip(axis, row, strict=True):
            check_point(point, f, s)
    for bp, point in zip(axis, study["mixed"], strict=True):
        check_point(point, bp / 3, 2 * bp / 3)

    def check_roots(roots, rates):
        for k, root in roots.items():

            def gap(x):
                f, s = rates(x)
                return balance("model", f, s) - balance(k, f, s)

            if root["status"] == "crossing":
                lo, hi = root["low"], root["high"]
                assert 0 <= lo <= hi <= axis[-1] and hi - lo <= D(".000001")
                check_point(root["balances"], *rates((lo + hi) / 2))
                assert gap(lo) >= D("-1e-8") and gap(hi) <= D("1e-8")
            elif root["status"] == "behind-at-zero":
                assert gap(0) < 0
            else:
                assert root["status"] == "ahead-at-limit" and gap(axis[-1]) > 0

    for i, bp in enumerate(axis):
        check_roots(study["cutoffs"]["fee"][i], lambda x: (x, bp))
        check_roots(study["cutoffs"]["slip"][i], lambda x: (bp, x))
    check_roots(study["cutoffs"]["mixed"], lambda x: (D(x) / 3, 2 * D(x) / 3))
    for k in out:
        near(balance(k, 1, 2), r["metrics"][k]["ending"])
    print(
        "Verified 625 fee/slippage pairs, 25 mixed-cost points and 102 conditional threshold results against independent Decimal accounts."
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("data", "report", "spells", "costs"):
        p.add_argument(name, type=Path)
    a = p.parse_args()
    verify(a.data, a.report, a.spells, a.costs)

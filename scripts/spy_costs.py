"""Replay frozen SPY trade dates and solve the fee and slippage break-even slices."""

import argparse
import bisect
import json
from functools import lru_cache
from pathlib import Path

from spy_attribution import cash_spells, targets_from_fills
from spy_study import digest, load_rows, replay, save

RULES = ("model", "trend", "market")
AXIS = [i / 4 for i in range(25)]
TOL_BP = 1e-6


def crossing(axis, gaps, evaluate):
    if any(b >= a for a, b in zip(gaps, gaps[1:])):
        raise ValueError("Expected a decreasing model lead along this slice")
    if gaps[0] < 0:
        return {"status": "behind-at-zero"}
    if gaps[-1] > 0:
        return {"status": "ahead-at-limit"}
    right = next(i for i, value in enumerate(gaps) if value <= 0)
    if gaps[right] == 0:
        return {"status": "crossing", "low": axis[right], "high": axis[right]}
    low, high = axis[right - 1], axis[right]
    while high - low > TOL_BP:
        mid = (low + high) / 2
        if evaluate(mid) > 0:
            low = mid
        else:
            high = mid
    return {"status": "crossing", "low": low, "high": high}


def build(path, report_path):
    rows = load_rows(path)
    report = json.loads(report_path.read_bytes())
    start = bisect.bisect_left([r[0] for r in rows], report["start"])
    bars = rows[start:]
    if (
        report["dataHash"] != digest(path)
        or len(bars) != report["sessions"]
        or bars[-1][0] != report["end"]
    ):
        raise ValueError("Expected the published holdout")
    targets = {k: targets_from_fills(bars, report["trades"][k]) for k in RULES}

    def schedule(orders):
        return [(o["date"], o["side"]) for o in orders]

    schedules = {k: schedule(report["trades"][k]) for k in RULES}

    @lru_cache(maxsize=None)
    def balances(fee, slip):
        result = {}
        for k in RULES:
            stats, _, trades = replay(
                rows, start, targets[k], fee_rate=fee / 10000, slip_rate=slip / 10000
            )
            if schedule(trades) != schedules[k]:
                raise ValueError(f"Trade dates changed for {k}")
            result[k] = stats["ending"]
        return result

    published = dict(fee=report["commissionBp"], slip=report["slippageBp"])
    if balances(**published) != {k: report["metrics"][k]["ending"] for k in RULES}:
        raise ValueError("Baseline wealth differs from the published result")

    def thresholds(evaluate):
        cutoffs = {}
        for k in ("trend", "market"):

            def gap(bp):
                v = evaluate(bp)
                return v["model"] - v[k]

            root = crossing(AXIS, [gap(bp) for bp in AXIS], gap)
            if root["status"] == "crossing":
                root["balances"] = evaluate((root["low"] + root["high"]) / 2)
            cutoffs[k] = root
        return cutoffs

    def mix(total):
        return balances(total / 3, 2 * total / 3)

    return dict(
        version="spy-cost-1",
        sourceHash=digest(report_path),
        dataHash=digest(path),
        start=report["start"],
        end=report["end"],
        capital=report["capital"],
        sessions=len(bars),
        modelExits=len(list(cash_spells(targets["model"]))),
        cashDays=targets["model"].count(0),
        published=published,
        axisBp=AXIS,
        grid=[[balances(f, s) for s in AXIS] for f in AXIS],
        mixed=[mix(x) for x in AXIS],
        cutoffs=dict(
            mixed=thresholds(mix),
            fee=[thresholds(lambda f: balances(f, s)) for s in AXIS],
            slip=[thresholds(lambda s: balances(f, s)) for f in AXIS],
        ),
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("data", "report", "output"):
        p.add_argument(name, type=Path)
    a = p.parse_args()
    save(a.output, build(a.data, a.report))

"""Independent decimal reconstruction of the published full-history report."""

import json
import runpy
import statistics
import subprocess
import sys
from decimal import Decimal as D, getcontext
from itertools import groupby
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
reference = runpy.run_path(str(ROOT / "scripts/verify-crises.py"))
ONE = D(1)


def reconcile(path):
    source = reference["observations"](path)
    report_path = ROOT / "public/research/full-history.json"
    regenerated = subprocess.check_output(
        ["node", "--import", "tsx", "scripts/full-history.mjs", str(path)], cwd=ROOT
    )
    if report_path.read_bytes() != regenerated:
        raise ValueError("Published artifact differs from regenerated results")
    report = json.loads(regenerated)
    dates = [row[0] for row in source]
    start = 13
    horizon = 6

    def dated(i):
        return None if i is None else dates[i]

    def near(a, b):
        if abs(D(str(a)) - b) > D("1e-10") * max(ONE, abs(b)):
            raise ValueError(f"Numeric mismatch: {a} vs {b}")

    wealth = high = ONE
    drawdowns = []
    for _, stock, _ in source:
        wealth *= 1 + stock
        high = max(high, wealth)
        drawdowns.append(1 - wealth / high)
    events = []
    unresolved = None
    for underwater, indexes in groupby(
        range(len(source)), key=lambda i: drawdowns[i] > 0
    ):
        if not underwater:
            continue
        indices = list(indexes)
        deep = [i for i in indices if drawdowns[i] >= D("0.15")]
        end = indices[-1] + 1
        if deep:
            trough = max(indices, key=lambda i: drawdowns[i])
            events.append(
                (indices[0], deep[0], trough, end if end < len(source) else None)
            )
        elif end == len(source):
            unresolved = indices[0]
    # The pinned vintage has a full six-month lookback for each scored event.
    assert all(e[0] >= start + 1 + horizon for e in events)
    assert dated(unresolved) == report["unresolved"] and len(events) == len(
        report["episodes"]
    )
    for e, published in zip(events, report["episodes"]):
        assert list(map(dated, e)) == [
            published[k] for k in ("onset", "breach", "trough", "recovery")
        ]
        near(published["depth"], drawdowns[e[2]])

    def run(rule):
        value = gross = peak = ONE
        prev = fees = dd = D(0)
        weights = []
        net = []
        for i in range(start, len(source)):
            target = reference["weight"](rule, source, i)
            _, stock, cash = source[i]
            fee = abs(target - prev) / 1000
            factor = target * (1 + stock) + (1 - target) * (1 + cash)
            fees += 100 * value * fee
            value *= (1 - fee) * factor
            peak = max(peak, value)
            dd = max(dd, 1 - value / peak)
            gross *= factor
            net.append((1 - fee) * factor - 1)
            weights.append(target)
            prev = target * (1 + stock) / factor
        return weights, net, value, gross, fees, dd

    _, benchmark, market, *_ = run("market")
    n = len(benchmark)
    assert (
        report["months"] == n
        and report["start"] == dated(start)
        and report["observations"] == len(source)
    )

    def annual(v):
        return v ** (D(12) / n) - 1

    for rule in report["rules"]:
        weights, net, value, gross, fees, dd = run(rule["id"])
        for k, v in dict(
            cagr=annual(value),
            cagrGap=annual(value) - annual(market),
            endWealth=100 * value,
            marketWealthGap=100 * (value - market),
            feesPaid=fees,
            feeDrag=annual(gross) - annual(value),
            maxDrawdown=dd,
            averageEquity=sum(weights) / len(weights),
        ).items():
            near(rule[k], v)
        diffs = []
        for j, (_, _, trough, recovery) in enumerate(events):
            strat = bench = ONE
            end = recovery if recovery is not None else len(source) - 1
            if end == trough:
                assert rule["rebounds"][j] is None
                continue
            for i in range(trough + 1 - start, end + 1 - start):
                strat *= 1 + net[i]
                bench *= 1 + benchmark[i]
                diffs.append(net[i] - benchmark[i])
            near(rule["rebounds"][j], strat - bench)
        assert len(diffs) == rule["reboundMonths"]
        near(rule["reboundGap"], sum(diffs) / len(diffs))
        for mode in ("partial", "half"):
            flags = [w < ONE if mode == "partial" else w <= D(".5") for w in weights]
            alarms = [
                i
                for i in range(start + 1, len(source))
                if flags[i - start] and not flags[i - start - 1]
            ]
            used = set()
            matched = []
            leads = []
            at = 0
            for onset, breach, _, _ in events:
                hit = next(
                    (
                        i
                        for i in reversed(alarms)
                        if i not in used
                        and 0 <= onset - i <= horizon
                        and all(flags[i - start : onset - start + 1])
                    ),
                    None,
                )
                later = next((i for i in alarms if onset < i <= breach), None)
                if hit is not None:
                    used.add(hit)
                    lead = onset - hit
                    status = "Early" if lead else "At onset"
                    if lead:
                        leads.append(lead)
                    else:
                        at += 1
                else:
                    lead = None
                    status = (
                        "Already defensive"
                        if flags[onset - start]
                        else "After onset"
                        if later is not None
                        else "No cut by breach"
                    )
                    if status == "After onset":
                        hit = later
                if status == "Already defensive":
                    hit = next(
                        (
                            a
                            for a in reversed(alarms)
                            if a <= onset and all(flags[a - start : onset - start + 1])
                        ),
                        None,
                    )
                matched.append(
                    dict(onset=dated(onset), cut=dated(hit), status=status, lead=lead)
                )
            false = []
            pending = []
            for i in alarms:
                if i in used:
                    continue
                incomplete = i + horizon >= len(source) or (
                    unresolved is not None
                    and i <= unresolved <= i + horizon
                    and all(flags[i - start : unresolved - start + 1])
                )
                (pending if incomplete else false).append(dated(i))
            s = rule[mode]
            assert (s["early"], s["atOnset"], s["missed"], s["medianLead"]) == (
                len(leads),
                at,
                len(events) - len(leads) - at,
                statistics.median(leads) if leads else None,
            )
            assert (
                s["matches"] == matched
                and s["falseAlarms"] == false
                and s["unscored"] == pending
            )
            hits = len(leads) + at
            if hits + len(false):
                near(s["precision"], D(hits) / (hits + len(false)))
            else:
                assert s["precision"] is None
    print(
        f"Agreed on {len(events)} event calendars, all cuts and misses under both thresholds, and all financial metrics across {n} months and eight rules."
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Usage: python3 scripts/verify-full-history.py ARCHIVED_CSV_OR_ZIP"
        )
    getcontext().prec = 50
    reconcile(Path(sys.argv[1]).resolve())

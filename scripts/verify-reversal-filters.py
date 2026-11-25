"""Reconstruct the published experiment with 50-digit Decimal accounting."""

import json
import runpy
import statistics
import subprocess
import sys
from decimal import Decimal as D, getcontext
from math import prod
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF = runpy.run_path(str(ROOT / "scripts/verify-crises.py"))
ONE = D(1)
ZERO = D(0)
WARM, TRAIN = 13, 120
START = WARM + TRAIN


def verify(path):
    published = (ROOT / "public/research/reversal-filters.json").read_bytes()
    if published != subprocess.check_output(
        ["node", "--import", "tsx", "scripts/reversal-filters.mjs", str(path)], cwd=ROOT
    ):
        raise ValueError("Published JSON differs from regeneration")
    data = json.loads(published)
    prior = json.loads((ROOT / "public/research/full-history.json").read_text())
    rows = REF["observations"](path)
    dates = [r[0] for r in rows]
    n = len(rows)

    def near(a, b):
        if b is None:
            assert a is None
            return
        assert abs(D(str(a)) - b) <= D("1e-10") * max(ONE, abs(b)), (a, b)

    def annual(w):
        return w ** (D(12) / (n - START)) - 1

    assert (
        data["dataSha256"] == prior["dataSha256"]
        and data["start"] == dates[START]
        and data["months"] == n - START
    )
    old = next(r["half"] for r in prior["rules"] if r["id"] == "reversal")
    calendar = [
        (
            dates.index(e["onset"]),
            dates.index(e["breach"]),
            dates.index(e["trough"]),
            dates.index(e["recovery"]) if e["recovery"] else n - 1,
        )
        for e in prior["episodes"]
    ]
    rebounds = [
        i
        for _, _, trough, end in calendar
        for i in range(max(START, trough + 1), end + 1)
    ]
    assert len(rebounds) == data["reboundMonths"]
    profile = {a["date"]: a for a in data["alarms"]}
    assert len(profile) == len(data["alarms"])
    assert {
        date for date, a in profile.items() if a["outcome"] == "False alarm"
    } == set(old["falseAlarms"])
    assert {date for date, a in profile.items() if a["outcome"] == "Unscored"} == set(
        old["unscored"]
    )
    matched = {m["cut"]: m for m in old["matches"] if m["lead"] is not None}
    assert set(profile) == set(old["falseAlarms"]) | set(old["unscored"]) | set(matched)
    gross = high = ONE
    weights = {}
    vol = {}
    trend = {}
    fresh = []
    for i, (_, stock, _) in enumerate(rows):
        if i >= WARM:
            weights[i] = REF["weight"]("reversal", rows, i)
            trend[i] = REF["weight"]("trend", rows, i) == 0
            vol[i] = statistics.stdev(r[1] for r in rows[i - 12 : i]) * D(12).sqrt()
            if i > WARM and weights[i] < weights[i - 1]:
                fresh.append(i)
                a = profile[dates[i]]
                assert a["through"] == dates[i - 1] and a["weak"] == trend[i]
                near(a["vol"], vol[i])
                near(a["drawdown"], 1 - gross / high)
                near(a["trailingReturn"], prod(1 + r[1] for r in rows[i - 3 : i]) - 1)
                m = matched.get(dates[i])
                assert a["onset"] == (m["onset"] if m else None) and a["lead"] == (
                    m["lead"] if m else None
                )
                if m:
                    assert a["outcome"] == ("Early" if m["lead"] else "At onset")
        gross *= 1 + stock
        high = max(high, gross)
    assert {dates[i] for i in fresh} == set(profile)
    assert len(data["folds"]) == (n - START + 11) // 12
    cutoffs = {}
    for k, f in enumerate(data["folds"]):
        first = START + 12 * k
        end = min(first + 12, n)
        assert [f[x] for x in ["trainStart", "trainEnd", "start", "end"]] == [
            dates[i] for i in (first - TRAIN, first - 1, first, end - 1)
        ]
        threshold = statistics.median(vol[i] for i in range(first - TRAIN, first))
        near(f["cutoff"], threshold)
        cutoffs.update(dict.fromkeys(range(first, end), threshold))
    masks = {}
    for i in fresh:
        a = profile[dates[i]]
        if i < START:
            assert a["admitted"] is None and a["cutoff"] is None
            continue
        near(a["cutoff"], cutoffs[i])
        keepVol = vol[i] > cutoffs[i]
        masks[i] = {"vol": keepVol, "trend": trend[i], "both": keepVol and trend[i]}
        assert a["admitted"] == masks[i]

    # Reconstruct each accepted cash spell as a span, independently of the fold loop.
    targets = {
        variant: [ONE] * (n - START)
        for variant in ["market", "original", "vol", "trend", "both"]
    }
    for i in range(START, n):
        targets["original"][i - START] = weights[i]
        if weights[i] == 0:
            cut = next((c for c in reversed(fresh) if c <= i), None)
            for v in ("vol", "trend", "both"):
                if cut is None or cut < START or masks[cut][v]:
                    targets[v][i - START] = ZERO
    series = {}
    for v, t in targets.items():
        wealth = peak = noFee = ONE
        dd = paid = prev = ZERO
        net = []
        equity = []
        for j, w in enumerate(t):
            _, stock, cash = rows[j + START]
            fee = abs(w - prev) / 1000
            grossfactor = 1 + stock * w + cash * (1 - w)
            factor = (1 - fee) * grossfactor
            paid += wealth * 100 * fee
            wealth *= factor
            peak = max(wealth, peak)
            dd = max(dd, 1 - wealth / peak)
            noFee *= grossfactor
            prev = w * (1 + stock) / grossfactor
            net.append(factor - 1)
            equity.append(wealth)
        series[v] = dict(
            net=net,
            equity=equity,
            cagr=annual(wealth),
            ending=100 * wealth,
            maxDrawdown=dd,
            averageEquity=sum(t) / len(t),
            feeDrag=annual(noFee) - annual(wealth),
            feesPaid=paid,
        )
    assert {r["id"] for r in data["rules"]} == set(targets)
    for r in data["rules"]:
        v = r["id"]
        s = series[v]
        for metric in [
            "cagr",
            "ending",
            "maxDrawdown",
            "averageEquity",
            "feeDrag",
            "feesPaid",
        ]:
            near(r[metric], s[metric])
        for base, suffix in [("original", "Original"), ("market", "Market")]:
            near(r["vs" + suffix], s["cagr"] - series[base]["cagr"])
            near(
                r["reboundVs" + suffix],
                sum(
                    s["net"][i - START] - series[base]["net"][i - START]
                    for i in rebounds
                )
                / len(rebounds),
            )
        for k, f in enumerate(data["folds"]):
            j = k * 12
            near(
                f["returns"][v],
                s["equity"][min(j + 12, n - START) - 1]
                / (s["equity"][j - 1] if j else ONE)
                - 1,
            )
        t = targets[v]
        cuts = [j + START for j in range(1, len(t)) if t[j] < t[j - 1]]
        used = set()
        early = []
        leads = []
        at = miss = 0
        for onset, _, _, _ in calendar:
            if onset < START + 7:
                continue
            cut = next(
                (
                    i
                    for i in cuts
                    if i not in used
                    and 0 <= onset - i <= 6
                    and max(t[i - START : onset - START + 1]) == 0
                ),
                None,
            )
            if cut is None:
                miss += 1
                continue
            used.add(cut)
            if cut < onset:
                early.append(dates[onset])
                leads.append(onset - cut)
            else:
                at += 1
        pending = 0
        false = 0
        unknown = dates.index(prior["unresolved"]) if prior["unresolved"] else None
        for i in set(cuts) - used:
            incomplete = i + 6 >= n or (
                unknown is not None
                and 0 <= unknown - i <= 6
                and max(t[i - START : unknown - START + 1]) == 0
            )
            if incomplete:
                pending += 1
            else:
                false += 1
        assert (
            r["earlyOnsets"],
            r["early"],
            r["medianLead"],
            r["atOnset"],
            r["missed"],
            r["falseAlarms"],
            r["unscored"],
        ) == (
            early,
            len(early),
            statistics.median(leads) if leads else None,
            at,
            miss,
            false,
            pending,
        )
        near(
            r["precision"],
            D(len(used)) / (len(used) + false) if len(used) + false else None,
        )
    print(
        f"Verified {len(profile)} original cuts, {len(data['folds'])} rolling folds and all five {n - START}-month OOS portfolios."
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Usage: python3 scripts/verify-reversal-filters.py ARCHIVED_CSV_OR_ZIP"
        )
    getcontext().prec = 50
    verify(Path(sys.argv[1]).resolve())

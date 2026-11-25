"""Rebuild both trailing controls, monthly books and published comparisons in Decimal."""

import json
import runpy
import subprocess
import sys
from decimal import Decimal as D, getcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "public/research"
REF = runpy.run_path(str(ROOT / "scripts/verify-crises.py"))
START, TRAIN = 133, 120
ONE, ZERO = D(1), D(0)


def near(actual, expected):
    assert abs(D(str(actual)) - expected) <= D("1e-10") * max(ONE, abs(expected)), (
        actual,
        expected,
    )


def verify(path):
    getcontext().prec = 50
    artifact = (RESEARCH / "exposure-controls.json").read_bytes()
    assert artifact == subprocess.check_output(
        ["node", "--import", "tsx", "scripts/exposure-controls.mjs", str(path)],
        cwd=ROOT,
    )
    data = json.loads(artifact)
    old = json.loads((RESEARCH / "reversal-filters.json").read_text())
    calendar = json.loads((RESEARCH / "full-history.json").read_text())
    rows = REF["observations"](path)
    dates = [r[0] for r in rows]
    n = len(rows)
    assert data["dataSha256"] == old["dataSha256"] == calendar["dataSha256"]
    assert [data[k] for k in ("start", "end", "months", "feeBp")] == [
        dates[START],
        dates[-1],
        n - START,
        10,
    ]
    raw, gated = {}, {}
    for i in range(13, n):
        raw[i] = REF["weight"]("reversal", rows, i)
        if raw[i] or i == 13:
            gated[i] = raw[i]
        elif raw[i - 1]:
            gated[i] = REF["weight"]("trend", rows, i)
        else:
            gated[i] = raw[i - 1] if i == START else gated[i - 1]
    weights = {
        "original": raw,
        "trend": gated,
        "market": dict.fromkeys(range(START, n), ONE),
    }
    assert len(data["folds"]) == (n - START + 11) // 12
    for strategy in ("original", "trend"):
        mix = weights[strategy + "Mix"] = {}
        for k, f in enumerate(data["folds"]):
            first = START + k * 12
            end = min(first + 12, n)
            assert [f[s] for s in ("trainStart", "trainEnd", "start", "end")] == [
                dates[i] for i in (first - 120, first - 1, first, end - 1)
            ]
            w = sum(weights[strategy][i] for i in range(first - TRAIN, first)) / TRAIN
            near(f[strategy], w)
            mix.update(dict.fromkeys(range(first, end), w))
    rebounds = {
        i
        for e in calendar["episodes"]
        for i in range(
            max(START, dates.index(e["trough"]) + 1),
            dates.index(e["recovery"] or dates[-1]) + 1,
        )
    }
    assert len(rebounds) == data["reboundMonths"]
    chart_indices = [START - 1] + [
        i for i in range(START, n) if int(dates[i][-2:]) % 3 == 0 or i == n - 1
    ]
    assert [p["date"] for p in data["chart"]] == [dates[i] for i in chart_indices]
    returns, results = {}, {}
    for name, targets in weights.items():
        net = returns[name] = {}
        wealth = peak = gross = ONE
        prev = ZERO
        balances, losses = {START - 1: ONE}, {START - 1: ZERO}
        for i in range(START, n):
            w = targets[i]
            _, stock, cash = rows[i]
            stock_leg, cash_leg = w * (1 + stock), (1 - w) * (1 + cash)
            factor = stock_leg + cash_leg
            net[i] = factor * (1 - abs(w - prev) / 1000) - 1
            gross *= factor
            wealth *= 1 + net[i]
            peak = max(peak, wealth)
            balances[i], losses[i] = wealth, 1 - wealth / peak
            prev = stock_leg / factor
        annual = lambda v: v ** (D(12) / (n - START)) - 1
        results[name] = dict(
            net=annual(wealth),
            gross=annual(gross),
            feeDrag=annual(gross) - annual(wealth),
            drawdown=max(losses.values()),
            ending=100 * wealth,
            exposure=sum(targets[i] for i in range(START, n)) / (n - START),
        )
        for key, value in results[name].items():
            near(data["metrics"][name][key], value)
        previous = START - 1
        for i, p in zip(chart_indices, data["chart"]):
            if i == START - 1:
                assert p["averageStock"] is None
            else:
                near(
                    p["averageStock"][name],
                    sum(targets[j] for j in range(previous + 1, i + 1))
                    / (i - previous),
                )
            previous = i
            near(p["values"][name], 100 * balances[i])
            near(p["drawdowns"][name], losses[i])
        for f in data["folds"]:
            near(
                f["returns"][name],
                balances[dates.index(f["end"])] / balances[dates.index(f["start"]) - 1]
                - 1,
            )
    for name, net in returns.items():
        for base in ("original", "market"):
            near(
                data["metrics"][name]["reboundVs" + base.title()],
                sum(net[i] - returns[base][i] for i in rebounds) / len(rebounds),
            )
    for r in old["rules"]:
        if r["id"] in returns:
            for k, v in [
                ("net", "cagr"),
                ("drawdown", "maxDrawdown"),
                ("exposure", "averageEquity"),
                ("reboundVsMarket", "reboundVsMarket"),
            ]:
                near(data["metrics"][r["id"]][k], D(str(r[v])))
    splits = {}
    for basis in ("net", "gross"):
        o, t, co, ct = (
            results[p][basis] for p in ("original", "trend", "originalMix", "trendMix")
        )
        splits[basis] = (t - ct) - (o - co)
        for k, v in dict(
            total=t - o,
            allocation=ct - co,
            originalGap=o - co,
            trendGap=t - ct,
            residual=splits[basis],
        ).items():
            near(data[basis][k], v)
    near(data["feeContribution"], splits["net"] - splits["gross"])
    print(
        f"Verified {n - START} months, {len(data['folds'])} folds, {len(rebounds)} rebound months and {len(chart_indices)} plotted observations for all five portfolios."
    )


if __name__ == "__main__":
    verify(Path(sys.argv[1]).resolve())

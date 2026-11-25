"""Independent scalar network inference and share/cash/P&L reconciliation for the frozen holdout."""

import bisect
import csv
import hashlib
import json
import math
import statistics
from datetime import date
from pathlib import Path
from decimal import Decimal as D, getcontext


def near(a, b):
    if not math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-8):
        raise AssertionError((a, b))


def verify(path, model_path, result_path):
    getcontext().prec = 40
    r = json.loads(result_path.read_text())
    model = json.loads(model_path.read_text())
    assert (
        hashlib.sha256(path.read_bytes()).hexdigest()
        == r["dataHash"]
        == model["dataHash"]
    )
    assert hashlib.sha256(model_path.read_bytes()).hexdigest() == r["modelHash"]
    with path.open() as f:
        bars = list(csv.DictReader(f))
    dates = [b["date"] for b in bars]
    op, cl, div = [[D(b[k]) for b in bars] for k in ("open", "close", "distribution")]
    first = bisect.bisect_left(dates, "2022-01-01")
    n = len(dates)
    fit = model["model"]
    assert (r["start"], r["end"], r["sessions"]) == (dates[first], dates[-1], n - first)
    assert (
        fit["cutoff"] == fit["lastLabel"] == dates[first - 1]
        and fit["lastSignal"] == dates[first - 3]
    )
    for fold in model["development"]["folds"]:
        assert fold["lastLabel"] < fold["start"] <= fold["end"] < r["start"]
        assert dates.index(fold["lastSignal"]) + 2 == dates.index(fold["lastLabel"])
    logret = [0] + [math.log(float((cl[i] + div[i]) / cl[i - 1])) for i in range(1, n)]
    monthly = []
    level = 1.0
    raw = gate = 0
    signals = []
    prob = []
    for i in range(1, n):
        # State for this open uses only the previous close.
        level *= math.exp(logret[i - 1])
        if dates[i - 1][:7] != dates[i][:7]:
            monthly.append(level)
            if len(monthly) >= 10:
                old = raw
                raw = int(monthly[-4] > monthly[-1])
                if raw or old or len(monthly) == 10:
                    gate = int(raw or monthly[-1] > statistics.mean(monthly[-10:]))
        if i < first:
            continue
        f = [math.expm1(math.fsum(logret[i - k : i])) for k in (1, 5, 21, 63, 126)]
        f += [
            statistics.stdev(math.expm1(z) for z in logret[i - 21 : i]),
            float((op[i - 1] + div[i - 1]) / cl[i - 2] - 1),
            float(cl[i - 1] / op[i - 1] - 1),
        ]
        z = [(a - b) / c for a, b, c in zip(f, fit["mean"], fit["scale"], strict=True)]
        for layer, (w, bias) in enumerate(
            zip(fit["weights"], fit["bias"], strict=True)
        ):
            z = [
                math.fsum(a * b for a, b in zip(z, col, strict=True)) + k
                for col, k in zip(zip(*w, strict=True), bias, strict=True)
            ]
            if layer < 2:
                z = [max(0, x) for x in z]
        p = 1 / (1 + math.exp(-z[0]))
        signals.append(
            {"model": int(p >= 0.5), "original": raw, "trend": gate, "market": 1}
        )
        prob.append(p)
    chart = {p["date"]: p for p in r["chart"]}
    annual = {p["end"]: p for p in r["annual"]}
    for rule, m in r["metrics"].items():
        nav = peak = lastyear = D(10000)
        shares = fee = slip = divsum = loss = D(0)
        receivables = []
        peak_date = peak_for_dd = trough = dates[first]
        trades = iter(r["trades"][rule])
        orders = stockdays = 0
        for j, sig in enumerate(signals):
            i = first + j
            day = dates[i]
            target = sig[rule]
            stockdays += target
            # Reconcile through overnight P&L, execution loss and intraday P&L.
            nav += shares * (op[i] - cl[i - 1] + div[i])
            if shares and div[i]:
                amount = shares * div[i]
                receivables.append((bars[i]["payable"], amount))
                divsum += amount
            receivables = [(pay, amt) for pay, amt in receivables if pay >= day]
            pending = sum((amt for _, amt in receivables), D(0))
            available = nav - shares * op[i] - pending
            fill = op[i] * (D("1.0002") if target else D(".9998"))
            change = (
                available / (fill * D("1.0001"))
                if target and available > D("1e-8")
                else -shares
                if not target
                else D(0)
            )
            if change:
                trade = next(trades)
                orders += 1
                assert (trade["signal"], trade["date"], trade["side"]) == (
                    dates[i - 1],
                    day,
                    "reinvest"
                    if change > 0 and shares
                    else "buy"
                    if change > 0
                    else "sell",
                )
                cost = abs(change) * fill * D(".0001")
                impact = abs(change * (fill - op[i]))
                for key, v in [
                    ("quantity", abs(change)),
                    ("open", op[i]),
                    ("fill", fill),
                    ("commission", cost),
                    ("slippage", impact),
                ]:
                    near(trade[key], v)
                if rule == "model":
                    near(trade["probability"], prob[j])
                fee += cost
                slip += impact
                nav -= cost + impact
                shares += change
            nav += shares * (cl[i] - op[i])
            if nav > peak:
                peak = nav
                peak_date = day
            dd = 1 - nav / peak
            if dd > loss:
                loss = dd
                peak_for_dd = peak_date
                trough = day
            if day in chart:
                near(chart[day]["wealth"][rule], nav)
                near(chart[day]["loss"][rule], dd)
            if day in annual:
                near(annual[day]["net"][rule], nav / lastyear - 1)
                lastyear = nav
        assert next(trades, None) is None and (
            m["peak"],
            m["trough"],
            m["orders"],
            m["stockDays"],
        ) == (peak_for_dd, trough, orders, stockdays)
        days = (
            date.fromisoformat(dates[-1]) - date.fromisoformat(dates[first])
        ).days + 1
        for key, v in [
            ("ending", nav),
            ("total", nav / 10000 - 1),
            ("drawdown", loss),
            ("cagr", float(nav / 10000) ** (365.2425 / days) - 1),
            ("commission", fee),
            ("slippage", slip),
            ("dividends", divsum),
            ("receivable", pending),
        ]:
            near(m[key], v)
    print(
        f"Verified {n - first} next-open decisions per strategy, all fills, daily-close drawdowns, annual and weekly marks for all four portfolios."
    )


def check_time(path, model_path):
    """Perturb future market data and check the pre-test fit and pre-pivot decisions."""
    from spy_study import HOLD, load_rows, month_rules, observations, train_one
    import numpy as np

    rows = load_rows(path)
    first = bisect.bisect_left([r[0] for r in rows], HOLD)
    x, level = observations(rows)
    raw, gate = month_rules(rows, level)
    for pivot in (first, first + 126, first + 252):
        changed = [
            r
            if i < pivot
            else (
                r[0],
                r[1] * (1.1 if i % 2 else 0.9),
                r[2] * (1.09 if i % 2 else 0.91),
                r[3],
                r[4],
            )
            for i, r in enumerate(rows)
        ]
        after, levels = observations(changed)
        np.testing.assert_array_equal(after[:pivot], x[:pivot])
        for updated, previous in zip(
            month_rules(changed, levels), (raw, gate), strict=True
        ):
            np.testing.assert_array_equal(updated[: pivot + 1], previous[: pivot + 1])
        if pivot == first:
            rebuilt = train_one(changed, after, 2022)
            frozen = json.loads(model_path.read_text())["model"]
            for field in ("weights", "bias"):
                for a, b in zip(rebuilt[field], frozen[field], strict=True):
                    np.testing.assert_allclose(a, b, atol=1e-8, rtol=1e-8)
            for field in ("mean", "scale"):
                np.testing.assert_allclose(rebuilt[field], frozen[field], atol=1e-12)
    print(
        "Future perturbations preserve eligible signals and the pre-2022 scaler and model."
    )


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    for argument in ("data", "model", "report"):
        p.add_argument(argument, type=Path)
    p.add_argument("--check-time", action="store_true")
    a = p.parse_args()
    verify(a.data, a.model, a.report)
    if a.check_time:
        check_time(a.data, a.model)

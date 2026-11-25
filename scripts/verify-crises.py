"""Reconcile both event replays with independent 50-digit decimal arithmetic."""

import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor
from decimal import Decimal as D, getcontext
from math import prod
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ONE, ZERO = D(1), D(0)
WINDOWS = {"2008": ("2007-07", "2009-06"), "2020": ("2019-10", "2020-08")}


def observations(path):
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            (info,) = z.infolist()
            if info.file_size > 2**21:
                raise ValueError("ZIP member too large")
            data = z.read(info)
    else:
        data = path.read_bytes()
    normalized = data.replace(b"\r\n", b"\n")
    if (
        hashlib.sha256(normalized).hexdigest()
        != "1d11c5b507c8fa1e5f572e32f5f45b13d08ff1312429f2b10f5f8696311935ad"
    ):
        raise ValueError("Expected the September 2026 French CSV")
    rows = []
    for row in csv.reader(io.StringIO(data.decode())):
        if len(row) == 5 and re.fullmatch(r"[0-9]{6}", row[0].strip()):
            date, excess, _, _, rf = row
            rows.append(
                (date[:4] + "-" + date[4:], (D(excess) + D(rf)) / 100, D(rf) / 100)
            )
    return rows


def weight(rule, rows, i):
    market = [r[1] for r in rows[i - 13 : i]]
    cash = [r[2] for r in rows[i - 12 : i]]
    growth = lambda seq: prod((ONE + x for x in seq), start=ONE)
    if rule == "market":
        return ONE
    if rule == "cash":
        return ZERO
    if rule == "balanced":
        return D("0.6")
    if rule == "momentum":
        return D(growth(market[-12:]) > growth(cash))
    if rule == "reversal":
        return D(growth(market[-3:]) < ONE)
    if rule == "volatility":
        prev = market[-12:]
        mean = sum(prev) / 12
        vol = (sum((r - mean) ** 2 for r in prev) * 12 / 11).sqrt()
        return min(ONE, D("0.1") / vol) if vol else ONE
    levels = [growth(market[:n]) for n in range(1, 14)]
    if rule == "trend":
        return D(levels[-1] * 10 > sum(levels[-10:]))
    if rule == "breakout":
        return D(levels[-1] > max(levels[:-1]))
    raise ValueError(rule)


def check(args):
    rows, run = args
    getcontext().prec = 50
    dates = [r[0] for r in rows]
    first, last = (dates.index(x) for x in WINDOWS[run["id"]])
    wealth = market = D(100)
    rate = D(run["fee"]) / 10000
    prev_weight = prev_target = total_fee = peak_error = ZERO
    last_cut = None
    ledger = run["ledger"]
    if len(ledger) != last - first + 1:
        raise ValueError("Window length differs")
    for i in range(first - 24, last + 1):
        date, stock, cash = rows[i]
        target = weight(run["rule"], rows, i)
        if i > first - 24 and target < prev_target:
            last_cut = date
        turnover = abs(target - prev_weight)
        gross_factor = target * (ONE + stock) + (ONE - target) * (ONE + cash)
        net_factor = (ONE - turnover * rate) * gross_factor
        if i >= first:
            fee = wealth * turnover * rate
            total_fee += fee
            wealth *= net_factor
            market *= ONE + stock
            actual = ledger[i - first]
            action = (
                "Reduced"
                if target < prev_target
                else "Raised"
                if target > prev_target
                else "Held"
            )
            if (
                actual["date"],
                actual["signalThrough"],
                actual["action"],
                (actual["latestCut"] or {}).get("date"),
            ) != (date, dates[i - 1], action, last_cut):
                raise ValueError(f"Timing mismatch: {run['id']} {run['rule']} {date}")
            fields = dict(
                priorTarget=prev_target,
                target=target,
                driftedWeight=prev_weight,
                turnover=turnover,
                costBp=turnover * rate * 10000,
                fee=fee,
                totalFees=total_fee,
                strategyReturn=net_factor - ONE,
                marketReturn=stock,
                returnGap=net_factor - ONE - stock,
                strategyValue=wealth,
                marketValue=market,
                wealthGap=wealth - market,
            )
            for name, expected in fields.items():
                error = abs(D(str(actual[name])) - expected)
                if error > D("1e-9"):
                    raise ValueError(f"{run['rule']} {date} {name}: difference {error}")
                peak_error = max(error, peak_error)
        prev_target, prev_weight = target, target * (ONE + stock) / gross_factor
    return len(ledger), peak_error


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/verify-crises.py ARCHIVED_CSV_OR_ZIP")
    path = Path(sys.argv[1]).resolve()
    if path.stat().st_size > 2**21:
        raise ValueError("File exceeds 2 MiB")
    rows = observations(path)
    runs = json.loads(
        subprocess.check_output(
            ["node", "--import", "tsx", "scripts/crisis-ledgers.mjs", str(path)],
            cwd=ROOT,
        )
    )
    rules = {
        "market",
        "cash",
        "balanced",
        "trend",
        "momentum",
        "reversal",
        "volatility",
        "breakout",
    }
    expected = {
        (event, rule, fee)
        for event in WINDOWS
        for rule in rules
        for fee in (0, 5, 10, 25, 50, 100)
    }
    scenarios = {(r["id"], r["rule"], r["fee"]) for r in runs}
    if scenarios != expected or len(runs) != len(expected):
        raise ValueError("The strategy or fee grid is incomplete or duplicated")
    workers = min(4, os.cpu_count() or 1)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(check, ((rows, r) for r in runs), chunksize=8))
    print(
        f"{len(runs)} scenarios, {sum(n for n, _ in results)} month records, {workers} processes. "
        f"Max absolute numerical difference {max(err for _, err in results):.2E}."
    )


if __name__ == "__main__":
    main()

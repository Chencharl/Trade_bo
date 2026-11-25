"""Attribute a frozen SPY account to its consecutive cash spells in chronological order."""

import argparse
import bisect
import json
import math
from itertools import groupby
from pathlib import Path

from spy_study import CAPITAL, RULES, digest, load_rows, replay, save


def targets_from_fills(bars, trades):
    positions = {o["date"]: o["side"] != "sell" for o in trades}
    long = False
    targets = []
    for day, *_ in bars:
        long = positions.get(day, long)
        targets.append(int(long))
    return targets


def cash_spells(targets):
    pos = 0
    for long, group in groupby(targets):
        end = pos + sum(1 for _ in group)
        if not long:
            yield pos, end
        pos = end


def window_moves(bars, first, end):
    """Cash versus a single share, from exit open through re-entry open or final close."""
    up = down = 0.0
    for i in range(first, end):
        change = (
            bars[i + 1][1] + bars[i + 1][3] if i + 1 < len(bars) else bars[i][2]
        ) - bars[i][1]
        up += max(0, change)
        down += max(0, -change)
    price = bars[first][1]
    return down / price, up / price


def account_windows(bars, marks, trades):
    orders = {o["date"]: o for o in trades}
    nav, shares = CAPITAL, 0.0
    opening = []
    for i, (day, op, cl, div, _) in enumerate(bars):
        if i:
            nav += shares * (op - bars[i - 1][2] + div)
        fee = slip = 0.0
        if o := orders.get(day):
            shares = 0.0 if o["side"] == "sell" else shares + o["quantity"]
            fee, slip = o["commission"], o["slippage"]
        opening.append((nav, nav - fee - slip, fee, slip))
        nav = marks[i][1]
        if not math.isclose(nav, opening[-1][1] + shares * (cl - op), abs_tol=1e-7):
            raise ValueError(f"Opening account did not reconcile on {day}")
    return opening


def window(account, before, after, last_close):
    right = min(after + 1, len(account))
    end_nav = account[after][1] if after < len(account) else last_close
    orders = account[before:right]
    return dict(
        net=end_nav / account[before][0] - 1,
        commission=sum(o[2] for o in orders),
        slippage=sum(o[3] for o in orders),
    )


def attribution(rows, start, targets, marks, ledgers):
    bars = rows[start:]
    windows = {
        k: account_windows(bars, marks[k], ledgers[k]) for k in ("model", "trend")
    }
    result = {}
    for rule in ("model", "trend"):
        path = [1] * len(bars)
        prev = replay(rows, start, path)[0]
        gross_prev = replay(rows, start, path, fee_rate=0, slip_rate=0)[0]
        events = []
        for a, b in cash_spells(targets[rule]):
            path[a:b] = [0] * (b - a)
            net = replay(rows, start, path)[0]
            gross = replay(rows, start, path, fee_rate=0, slip_rate=0)[0]
            down, up = window_moves(bars, a, b)
            events.append(
                dict(
                    exit=bars[a][0],
                    reentry=bars[b][0] if b < len(bars) else None,
                    days=b - a,
                    avoided=down,
                    missed=up,
                    endingEffect=net["ending"] - prev["ending"],
                    grossEffect=gross["ending"] - gross_prev["ending"],
                    drawdownEffect=net["drawdown"] - prev["drawdown"],
                    model=window(windows["model"], a, b, marks["model"][-1][1]),
                    trend=window(windows["trend"], a, b, marks["trend"][-1][1]),
                    trendStockDays=sum(targets["trend"][a:b]),
                )
            )
            prev, gross_prev = net, gross
        result[rule] = events
    return result


def build(data, report_path):
    rows = load_rows(data)
    report = json.loads(report_path.read_text())
    start = bisect.bisect_left([r[0] for r in rows], report["start"])
    bars = rows[start:]
    if (
        report["dataHash"] != digest(data)
        or len(bars) != report["sessions"]
        or bars[-1][0] != report["end"]
    ):
        raise ValueError("Expected the published holdout and matching frozen bars")
    targets, marks, ledgers = {}, {}, {}
    for k in RULES:
        targets[k] = targets_from_fills(bars, report["trades"][k])
        stats, marks[k], ledgers[k] = replay(rows, start, targets[k])
        if stats != report["metrics"][k]:
            raise ValueError(f"Account mismatch for {k}")
    spells = attribution(rows, start, targets, marks, ledgers)
    # Daily portfolio values at sub-cent precision. Drawdown is reconstructed from these marks.
    daily = [
        [row[0], *(round(marks[k][i][1], 7) for k in RULES)]
        for i, row in enumerate(bars)
    ]
    return dict(
        version="spy-spells-1",
        sourceHash=digest(report_path),
        start=bars[0][0],
        end=bars[-1][0],
        rules=RULES,
        daily=daily,
        spells=spells,
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("data", "report", "output"):
        p.add_argument(name, type=Path)
    args = p.parse_args()
    save(args.output, build(args.data, args.report))

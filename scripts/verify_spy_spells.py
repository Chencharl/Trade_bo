"""Check every published cash spell with a separate Decimal P&L ledger. No ML dependencies."""

import argparse
import csv
import hashlib
import json
from decimal import Decimal as D, getcontext
from math import isclose
from pathlib import Path


def near(actual, expected):
    if not isclose(float(actual), float(expected), rel_tol=1e-11, abs_tol=1e-7):
        raise AssertionError((actual, expected))


def account(bars, cash_days, fee=D(".0001"), slip=D(".0002")):
    nav = peak = D(10000)
    qty = worst = D(0)
    entitlements = []
    history = []
    previous_close = bars[0][1]
    for date, op, close, dividend, payable in bars:
        nav += qty * (op + dividend - previous_close)
        before = nav
        if dividend and qty:
            entitlements.append((payable, dividend * qty))
        entitlements = [(d, amt) for d, amt in entitlements if d >= date]
        available = nav - qty * op - sum(amt for _, amt in entitlements)
        long = date not in cash_days
        fill = op * (1 + slip if long else 1 - slip)
        change = (
            available / (fill * (1 + fee))
            if long and available > D("1e-8")
            else D(0)
            if long
            else -qty
        )
        paid_fee = abs(change) * fill * fee
        paid_slip = abs(change * (fill - op))
        nav -= paid_fee + paid_slip
        after = nav
        qty += change
        nav += qty * (close - op)
        peak = max(peak, nav)
        worst = max(worst, 1 - nav / peak)
        history.append((before, after, paid_fee, paid_slip, nav))
        previous_close = close
    return nav, worst, history


def verify(data, report, spells):
    getcontext().prec = 40
    r = json.loads(report.read_bytes())
    a = json.loads(spells.read_bytes())
    assert hashlib.sha256(report.read_bytes()).hexdigest() == a["sourceHash"]
    assert hashlib.sha256(data.read_bytes()).hexdigest() == r["dataHash"]
    with data.open() as f:
        bars = [
            (b["date"], D(b["open"]), D(b["close"]), D(b["distribution"]), b["payable"])
            for b in csv.DictReader(f)
            if r["start"] <= b["date"] <= r["end"]
        ]
    days = [b[0] for b in bars]
    assert [row[0] for row in a["daily"]] == days
    cash = {}
    books = {}
    for col, k in enumerate(a["rules"], 1):
        # A sell starts the period in cash. A purchase on the reopening date ends it.
        held = False
        fills = iter(r["trades"][k])
        order = next(fills, None)
        cash[k] = set()
        for date in days:
            if order and order["date"] == date:
                held = order["side"] != "sell"
                order = next(fills, None)
            if not held:
                cash[k].add(date)
        nav, dd, books[k] = account(bars, cash[k])
        near(nav, r["metrics"][k]["ending"])
        near(dd, r["metrics"][k]["drawdown"])
        for row, ledger in zip(a["daily"], books[k], strict=True):
            near(row[col], ledger[-1])
    for k, events in a["spells"].items():
        added = set()
        nav, dd, _ = account(bars, added)
        gross, _, _ = account(bars, added, D(0), D(0))
        for s in events:
            left = days.index(s["exit"])
            right = days.index(s["reentry"]) if s["reentry"] else len(days)
            interval = set(days[left:right])
            assert (
                (not added or max(added) < s["exit"])
                and len(interval) == s["days"]
                and interval <= cash[k]
            )
            assert left == 0 or days[left - 1] not in cash[k]
            assert right == len(days) or days[right] not in cash[k]
            added |= interval
            assert len(interval - cash["trend"]) == s["trendStockDays"]
            # Difference the running value of one share including accumulated distributions.
            dividends = D(0)
            levels = [bars[left][1]]
            for i in range(left + 1, min(right + 1, len(days))):
                dividends += bars[i][3]
                levels.append(bars[i][1] + dividends)
            if right == len(days):
                levels.append(bars[-1][2] + dividends)
            increments = [b - a for a, b in zip(levels, levels[1:])]
            near(s["avoided"], -sum(x for x in increments if x < 0) / levels[0])
            near(s["missed"], sum(x for x in increments if x > 0) / levels[0])
            for key in ("model", "trend"):
                book = books[key]
                close = book[right][1] if right < len(days) else book[-1][-1]
                near(s[key]["net"], close / book[left][0] - 1)
                near(s[key]["commission"], sum(d[2] for d in book[left : right + 1]))
                near(s[key]["slippage"], sum(d[3] for d in book[left : right + 1]))
            now, loss, _ = account(bars, added)
            free, _, _ = account(bars, added, D(0), D(0))
            near(s["endingEffect"], now - nav)
            near(s["drawdownEffect"], loss - dd)
            near(s["grossEffect"], free - gross)
            nav, dd, gross = now, loss, free
        assert added == cash[k]
    print(
        f"Verified {len(days)} daily closes for four portfolios and every gross, net, cost and drawdown attribution in the model and trend spells."
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("data", "report", "spells"):
        p.add_argument(name, type=Path)
    a = p.parse_args()
    verify(a.data, a.report, a.spells)

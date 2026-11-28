"""Freeze the minimum daily and month-end context before the first prospective signal."""

import argparse
from pathlib import Path

from spy_forward_source import market
from spy_study import digest, load_rows, observations, save

END = "2026-11-27"


def make_seed(rows):
    _, levels = observations(rows)
    use = [
        i
        for i in range(len(rows))
        if i >= len(rows) - 127 or rows[i][0][:7] != rows[i + 1][0][:7]
    ]
    return dict(
        end=rows[-1][0],
        anchor=rows[-1][2],
        history=[[rows[i][0], 100 * float(levels[i] / levels[-1])] for i in use],
    )


if __name__ == "__main__":
    from exchange_calendars import get_calendar

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("locked_csv", type=Path)
    p.add_argument("output", type=Path)
    a = p.parse_args()
    base_hash = digest(a.locked_csv)
    if base_hash != "4e5edc91eca2a0a358e8d5bea7b20d6b3810642c3f2eb014fff9616936df94a1":
        raise ValueError("Expected the original frozen SPY history through October 30")
    base = load_rows(a.locked_csv)
    cal = get_calendar("XNYS")
    dates = [str(d.date()) for d in cal.sessions_in_range("2026-11-02", END)]
    bars, source = market(dates[0], END, dates)
    seed = make_seed(base + [bars[d] for d in dates])
    save(a.output, dict(**seed, baseHash=base_hash, bridgeSource=source))

"""Rehearse the prospective signal path on all 1,212 previously scored SPY opens."""

import argparse
import bisect
import json
from pathlib import Path
import numpy as np
from spy_attribution import targets_from_fills
from spy_forward import ROOT, locked_inputs, signal_arrays
from spy_forward_seed import make_seed
from spy_study import load_rows, observations, predict, replay


def verify(data):
    rows = load_rows(data)
    _, model = locked_inputs()
    r = json.loads((ROOT / "public/research/spy-daily.json").read_bytes())
    dates = [row[0] for row in rows]
    start = bisect.bisect_left(dates, r["start"]) - 1
    seed = make_seed(rows[:start])
    events = []
    for day, op, cl, div, pay in rows[start:]:
        events.extend(
            (
                dict(
                    date=day,
                    phase="open",
                    level=100 * op / seed["anchor"],
                    distribution=100 * div / seed["anchor"],
                    payable=pay,
                ),
                dict(date=day, phase="close", level=100 * cl / seed["anchor"]),
            )
        )
    x, prob, trend = signal_arrays(seed, model, events, "2026-11-02")
    actual = observations(rows)[0][start:]
    np.testing.assert_allclose(x, actual, rtol=1e-11, atol=1e-12)
    np.testing.assert_allclose(prob, predict(model, actual), rtol=1e-11, atol=1e-12)
    for k, target in (
        ("model", prob[:-1] >= 0.5),
        ("trend", trend[:-1]),
        ("market", np.ones(len(prob) - 1)),
    ):
        np.testing.assert_array_equal(
            target, targets_from_fills(rows[start + 1 :], r["trades"][k])
        )
        s, _, _ = replay(rows, start + 1, target)
        np.testing.assert_allclose(s["ending"], r["metrics"][k]["ending"])
    print(
        f"All {len(prob) - 1} next-open targets per account and final balances match the historical report. No rehearsal rows enter the live ledger."
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("locked_csv", type=Path)
    verify(p.parse_args().locked_csv)

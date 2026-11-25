"""Independently enumerate paired binary schedules and reproduce the 10,000-history test."""

import hashlib
import itertools
import json
import math
import runpy
import struct
import subprocess
import sys
from decimal import getcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/research"
REF = runpy.run_path(str(ROOT / "scripts/verify-crises.py"))
START = 133


def close(a, b):
    assert math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-12), (a, b)


def binary_masks(n, previous, last, k, trades):
    for held in itertools.combinations(range(n), k):
        mask = sum(1 << i for i in held)
        switches = mask ^ ((mask << 1) | previous)
        if (mask >> (n - 1)) == last and (
            switches & ((1 << n) - 1)
        ).bit_count() == trades:
            yield mask


def uniform_words():
    for counter in itertools.count():
        yield from struct.unpack(
            ">8I", hashlib.sha256(f"timing-null-1/20261125/{counter}".encode()).digest()
        )


def choose(words, n):
    if n == 1:
        return 0
    for value in words:
        if value < (2**32 // n) * n:
            return value % n


def summary(rows, weights, prev):
    net = gross = peak = low = 1.0
    loss = 0.0
    for (_, stock, cash), w in zip(rows, weights, strict=True):
        f = 1 + stock * w + cash * (1 - w)
        net *= f * (1 - abs(w - prev) * 0.001)
        gross *= f
        peak = max(peak, net)
        low = min(low, net)
        loss = max(loss, 1 - net / peak)
        prev = w * (1 + stock) / f
    return net, gross, peak, low, loss


def verify(path):
    getcontext().prec = 50
    byts = (SOURCE / "timing-null.json").read_bytes()
    assert byts == subprocess.check_output(
        ["node", "--import", "tsx", "scripts/timing-null.mjs", str(path)], cwd=ROOT
    )
    r = json.loads(byts)
    prior = json.loads((SOURCE / "exposure-controls.json").read_text())
    assert (
        r["draws"] == 10000
        and r["seed"] == "20261125"
        and r["dataSha256"] == prior["dataSha256"]
    )
    assert (r["months"], r["start"], r["end"], r["feeBp"]) == (
        prior["months"],
        prior["start"],
        prior["end"],
        10,
    )
    assert len(r["folds"]) == len(prior["folds"])
    raw_rows = REF["observations"](path)
    raw = {
        i: int(REF["weight"]("reversal", raw_rows, i)) for i in range(13, len(raw_rows))
    }
    trend = []
    original = []
    prev = raw[START - 1]
    for i in range(START, len(raw_rows)):
        if raw[i]:
            prev = 1
        elif raw[i - 1]:
            prev = int(REF["weight"]("trend", raw_rows, i))
        original.append(raw[i])
        trend.append(prev)
    rows = [(t, float(s), float(c)) for t, s, c in raw_rows[START:]]
    months = len(rows)
    power = 12 / months
    choices = []
    starting = 0
    weights = {"original": original, "trend": trend, "originalMix": [], "trendMix": []}
    for fold, old in zip(r["folds"], prior["folds"], strict=True):
        n = fold["months"]
        end = starting + n
        assert n == min(12, months - starting) and (fold["start"], fold["end"]) == (
            rows[starting][0],
            rows[end - 1][0],
        ) == (old["start"], old["end"])
        incoming = [original[starting - 1], trend[starting - 1]] if starting else [0, 0]
        masks = []
        for key, prev in zip(("original", "trend"), incoming, strict=True):
            seq = weights[key][starting:end]
            changes = [b - a for a, b in zip([prev] + seq[:-1], seq, strict=True)]
            buys, sales = changes.count(1), changes.count(-1)
            assert fold[key] == dict(
                stockMonths=sum(seq), buys=buys, sales=sales, trades=buys + sales
            )
            masks.append(list(binary_masks(n, prev, seq[-1], sum(seq), buys + sales)))
            weights[key + "Mix"].extend([old[key]] * n)
        states = tuple(
            o + t
            for o, t in zip(original[starting:end], trend[starting:end], strict=True)
        )
        first = sum(incoming)

        def edges(s):
            return sorted(zip((first,) + s[:-1], s, strict=True))

        observed_edges = edges(states)
        eligible = []
        for o, t in itertools.product(*masks):
            if o & ~t:
                continue
            seq = tuple(((o >> i) & 1) + ((t >> i) & 1) for i in range(n))
            if edges(seq) == observed_edges:
                eligible.append(seq)
        eligible.sort()
        assert states in eligible and len(eligible) == fold["choices"]
        assert (first, states[-1]) == (fold["incoming"], fold["closing"])
        choices.append(
            [
                (
                    summary(
                        rows[starting:end], [int(s == 2) for s in seq], incoming[0]
                    ),
                    summary(
                        rows[starting:end], [int(s != 0) for s in seq], incoming[1]
                    ),
                )
                for seq in eligible
            ]
        )
        starting = end
    assert starting == months
    for delay, key in [(False, "actual"), (True, "delayed")]:
        for name, ws in weights.items():
            net, gross, _, _, dd = summary(rows, ([0] + ws[:-1]) if delay else ws, 0)
            out = r[key][name]
            for measure, value in [
                ("net", net**power - 1),
                ("gross", gross**power - 1),
                ("drawdown", dd),
            ]:
                close(out[measure], value)
                if not delay:
                    close(out[measure], prior["metrics"][name][measure])
        close(
            r[key]["residual"],
            r[key]["trend"]["gross"]
            - r[key]["original"]["gross"]
            - r[key]["trendMix"]["gross"]
            + r[key]["originalMix"]["gross"],
        )
    close(r["actual"]["residual"], prior["gross"]["residual"])
    observed = {"residual": prior["gross"]["residual"]}
    for rule in ("original", "trend"):
        observed[rule + "Return"] = prior["metrics"][rule]["net"]
        observed[rule + "Drawdown"] = prior["metrics"][rule]["drawdown"]
    samples = {k: [] for k in observed}
    words = uniform_words()
    fixed = prior["gross"]["allocation"]
    for _ in range(r["draws"]):
        sampled = [c[choose(words, len(c))] for c in choices]
        gr = []
        for idx, name in enumerate(("original", "trend")):
            net = gross = peak = 1.0
            loss = 0.0
            for pair in sampled:
                f, g, fold_peak, fold_low, fold_loss = pair[idx]
                loss = max(loss, fold_loss, 1 - net * fold_low / peak)
                peak = max(peak, net * fold_peak)
                net *= f
                gross *= g
            samples[name + "Return"].append(net**power - 1)
            samples[name + "Drawdown"].append(loss)
            gr.append(gross**power - 1)
        samples["residual"].append(gr[1] - gr[0] - fixed)
    for metric, values in samples.items():
        values.sort()
        s = r["results"][metric]
        o = observed[metric]
        n = len(values)
        close(s["observed"], o)
        smaller = metric.endswith("Drawdown")
        ties = sum(abs(x - o) <= 1e-12 for x in values)
        better = sum((o - x if smaller else x - o) > 1e-12 for x in values)
        assert (better, ties, better + ties) == (s["better"], s["ties"], s["matched"])
        close(s["p"], (better + ties + 1) / (n + 1))
        close(s["percentile"], (n - better - ties / 2) * 100 / n)
        for key, p in [("low", 0.025), ("median", 0.5), ("high", 0.975)]:
            k = (n - 1) * p
            i = int(k)
            close(s[key], values[i] + (values[i + 1] - values[i]) * (k - i))
        lo, hi = min(o, values[0]), max(o, values[-1])
        close(lo, s["min"])
        close(hi, s["max"])
        bins = [0] * 24
        for x in values:
            bins[min(23, int(24 * (x - lo) / (hi - lo)) if hi > lo else 0)] += 1
        assert bins == s["bins"]
    print(
        "Verified every fold support, all five 10,000-draw distributions, observed and delayed books, and the published bytes."
    )


if __name__ == "__main__":
    verify(Path(sys.argv[1]).resolve())

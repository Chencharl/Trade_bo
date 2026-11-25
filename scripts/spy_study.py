"""Train on development bars only, then score the frozen model on SPY's final holdout."""

import argparse
import bisect
import csv
import hashlib
import json
import warnings
from datetime import date
from pathlib import Path

DATA_HASH = "4e5edc91eca2a0a358e8d5bea7b20d6b3810642c3f2eb014fff9616936df94a1"
HOLD = "2022-01-01"
RULES = ("model", "original", "trend", "market")
FEATURES = [
    "return1",
    "return5",
    "return21",
    "return63",
    "return126",
    "volatility21",
    "overnight",
    "intraday",
]
FEE = 0.0001
SLIP = 0.0002
CAPITAL = 10000.0


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, obj):
    path.write_text(json.dumps(obj, allow_nan=False, separators=(",", ":")) + "\n")


def load_rows(path, development=False):
    if digest(path) != DATA_HASH:
        raise ValueError("SPY input differs from the locked snapshot")
    with path.open() as f:
        return [
            (
                r["date"],
                float(r["open"]),
                float(r["close"]),
                float(r["distribution"]),
                r["payable"],
            )
            for r in csv.DictReader(f)
            if not development or r["date"] < HOLD
        ]


def observations(rows):
    import numpy as np

    op, cl, div = np.array([r[1:4] for r in rows]).T
    ret = np.zeros(len(rows))
    ret[1:] = (cl[1:] + div[1:]) / cl[:-1] - 1
    index = np.cumprod(1 + ret)
    x = np.full((len(rows), len(FEATURES)), np.nan)
    for i in range(126, len(rows)):
        x[i] = [
            *[index[i] / index[i - n] - 1 for n in (1, 5, 21, 63, 126)],
            np.std(ret[i - 20 : i + 1], ddof=1),
            (op[i] + div[i]) / cl[i - 1] - 1,
            cl[i] / op[i] - 1,
        ]
    return x, index


def month_rules(rows, index):
    import numpy as np

    orig = np.zeros(len(rows), dtype=int)
    trend = orig.copy()
    ends = []
    raw = gate = 0
    for i in range(1, len(rows)):
        if rows[i][0][:7] != rows[i - 1][0][:7]:
            ends.append(index[i - 1])
            if len(ends) >= 10:
                previous = raw
                raw = int(ends[-1] < ends[-4])
                if raw:
                    gate = 1
                elif previous or len(ends) == 10:
                    gate = int(ends[-1] > sum(ends[-10:]) / 10)
        orig[i] = raw
        trend[i] = gate
    return orig, trend


def train_one(rows, x, year):
    import numpy as np
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.exceptions import ConvergenceWarning
    from threadpoolctl import threadpool_limits

    dates = [r[0] for r in rows]
    cutoff = bisect.bisect_left(dates, f"{year}-01-01") - 1
    first = max(126, bisect.bisect_left(dates, f"{year - 8}-01-01"))
    # Label for signal i is known at open i+2. Both endpoints must have printed.
    indices = np.arange(first, cutoff - 1)
    y = np.array(
        [int(rows[i + 2][1] + rows[i + 2][3] > rows[i + 1][1]) for i in indices]
    )
    scaler = StandardScaler().fit(x[indices])
    model = MLPClassifier(
        hidden_layer_sizes=(16, 8),
        activation="relu",
        solver="adam",
        alpha=0.0001,
        batch_size=64,
        learning_rate_init=0.001,
        max_iter=30,
        early_stopping=False,
        tol=0,
        n_iter_no_change=100,
        random_state=42,
    )
    with warnings.catch_warnings(), threadpool_limits(limits=1):
        warnings.simplefilter("ignore", ConvergenceWarning)
        model.fit(scaler.transform(x[indices]), y)
    return dict(
        year=year,
        firstSignal=dates[first],
        lastSignal=dates[indices[-1]],
        lastLabel=dates[indices[-1] + 2],
        cutoff=dates[cutoff],
        examples=len(y),
        epochs=model.n_iter_,
        mean=scaler.mean_.tolist(),
        scale=scaler.scale_.tolist(),
        weights=[w.tolist() for w in model.coefs_],
        bias=[b.tolist() for b in model.intercepts_],
    )


def predict(fit, x):
    import numpy as np

    z = (x - np.asarray(fit["mean"])) / np.asarray(fit["scale"])
    for i, (w, b) in enumerate(zip(fit["weights"], fit["bias"], strict=True)):
        z = z @ np.asarray(w) + b
        if i < 2:
            z = np.maximum(z, 0)
    return 1 / (1 + np.exp(-np.clip(z.ravel(), -700, 700)))


def replay(rows, start, targets, prob=None, *, fee_rate=FEE, slip_rate=SLIP):
    dates = [r[0] for r in rows]
    cash = peak = CAPITAL
    shares = unpaid = fees = slip = dividends = dd = 0.0
    peak_date = worst_peak = worst_day = dates[start]
    payouts = {}
    ledger = []
    marks = []
    for i, w in enumerate(targets, start):
        day, op, cl, div, pay = rows[i]
        # Today's buyer is ex-dividend; yesterday's closing holder owns the receivable.
        if shares and div:
            credit = shares * div
            unpaid += credit
            dividends += credit
            release = bisect.bisect_right(dates, pay)
            payouts[release] = payouts.get(release, 0) + credit
        released = payouts.pop(i, 0)
        cash += released
        unpaid -= released
        old = shares
        if w and cash > 1e-8:
            fill = op * (1 + slip_rate)
            qty = cash / (fill * (1 + fee_rate))
            shares += qty
            cash = 0.0
        elif not w and shares:
            fill = op * (1 - slip_rate)
            qty = -shares
            cash += shares * fill * (1 - fee_rate)
            shares = 0.0
        else:
            qty = 0.0
        if qty:
            commission = abs(qty) * fill * fee_rate
            impact = abs(qty) * op * slip_rate
            fees += commission
            slip += impact
            ledger.append(
                dict(
                    signal=dates[i - 1],
                    date=day,
                    side="sell" if qty < 0 else "reinvest" if old else "buy",
                    open=op,
                    fill=fill,
                    quantity=abs(qty),
                    commission=commission,
                    slippage=impact,
                    probability=float(prob[i - start]) if prob is not None else None,
                )
            )
        wealth = cash + shares * cl + unpaid
        if wealth > peak:
            peak = wealth
            peak_date = day
        loss = 1 - wealth / peak
        if loss > dd:
            dd = loss
            worst_peak = peak_date
            worst_day = day
        marks.append([day, wealth, loss, int(w)])
    elapsed = (
        date.fromisoformat(marks[-1][0]) - date.fromisoformat(marks[0][0])
    ).days + 1
    metrics = dict(
        ending=wealth,
        total=wealth / CAPITAL - 1,
        cagr=(wealth / CAPITAL) ** (365.2425 / elapsed) - 1,
        drawdown=dd,
        peak=worst_peak,
        trough=worst_day,
        commission=fees,
        slippage=slip,
        dividends=dividends,
        receivable=unpaid,
        orders=len(ledger),
        stockDays=int(sum(targets)),
    )
    return metrics, marks, ledger


def fit_stage(path, output):
    import numpy as np

    rows = load_rows(path, development=True)
    dates = [r[0] for r in rows]
    x, index = observations(rows)
    orig, trend = month_rules(rows, index)
    first = bisect.bisect_left(dates, "2010-01-01")
    probs = []
    folds = []
    for year in range(2010, 2022):
        fit = train_one(rows, x, year)
        a, b = [bisect.bisect_left(dates, f"{y}-01-01") for y in (year, year + 1)]
        probs.extend(predict(fit, x[a - 1 : b - 1]).tolist())
        folds.append(
            {
                k: fit[k]
                for k in (
                    "year",
                    "firstSignal",
                    "lastSignal",
                    "lastLabel",
                    "examples",
                    "epochs",
                )
            }
            | {"start": dates[a], "end": dates[b - 1]}
        )
    summaries = {}
    for key, targets in zip(
        RULES,
        [np.asarray(probs) >= 0.5, orig[first:], trend[first:], np.ones(len(probs))],
        strict=True,
    ):
        summaries[key], marks, _ = replay(rows, first, targets)
        previous = CAPITAL
        for fold in folds:
            end = bisect.bisect_left(dates, fold["end"]) - first
            fold.setdefault("returns", {})[key] = marks[end][1] / previous - 1
            previous = marks[end][1]
    final = train_one(rows, x, 2022)
    save(
        output,
        dict(
            version="spy-open-1",
            dataHash=DATA_HASH,
            features=FEATURES,
            model=final,
            development=dict(folds=folds, metrics=summaries),
        ),
    )


def score_stage(path, model_path, out):
    import numpy as np

    frozen = json.loads(model_path.read_text())
    if (
        frozen["version"] != "spy-open-1"
        or frozen["dataHash"] != DATA_HASH
        or frozen["model"]["lastLabel"] >= HOLD
    ):
        raise ValueError("Expected frozen pre-holdout model")
    rows = load_rows(path)
    dates = [r[0] for r in rows]
    start = bisect.bisect_left(dates, HOLD)
    x, index = observations(rows)
    orig, trend = month_rules(rows, index)
    prob = predict(frozen["model"], x[start - 1 : -1])
    stats = {}
    trades = {}
    books = {}
    for key, targets in zip(
        RULES,
        [prob >= 0.5, orig[start:], trend[start:], np.ones(len(prob))],
        strict=True,
    ):
        stats[key], books[key], trades[key] = replay(
            rows, start, targets, prob if key == "model" else None
        )
    chart = []
    annual = []
    last = {k: CAPITAL for k in RULES}
    for j, day in enumerate(dates[start:]):
        lastday = j == len(prob) - 1
        # Weekly closing marks preserve visible crisis paths. The drawdown statistic uses every close.
        if (
            j == 0
            or lastday
            or date.fromisoformat(day).isocalendar()[:2]
            != date.fromisoformat(dates[start + j + 1]).isocalendar()[:2]
        ):
            chart.append(
                dict(
                    date=day,
                    wealth={k: books[k][j][1] for k in RULES},
                    loss={k: books[k][j][2] for k in RULES},
                )
            )
        if lastday or day[:4] != dates[start + j + 1][:4]:
            annual.append(
                dict(end=day, net={k: books[k][j][1] / last[k] - 1 for k in RULES})
            )
            last = {k: books[k][j][1] for k in RULES}
    save(
        out,
        dict(
            version="spy-open-1",
            dataHash=DATA_HASH,
            modelHash=digest(model_path),
            start=dates[start],
            end=dates[-1],
            sessions=len(prob),
            capital=CAPITAL,
            commissionBp=FEE * 10000,
            slippageBp=SLIP * 10000,
            metrics=stats,
            annual=annual,
            chart=chart,
            trades=trades,
            development=frozen["development"],
            training={
                k: frozen["model"][k]
                for k in (
                    "cutoff",
                    "firstSignal",
                    "lastSignal",
                    "lastLabel",
                    "examples",
                    "epochs",
                )
            },
        ),
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("stage", choices=["fit", "score"])
    p.add_argument("data", type=Path)
    p.add_argument("model", type=Path)
    p.add_argument("report", type=Path, nargs="?")
    a = p.parse_args()
    if a.stage == "fit":
        fit_stage(a.data, a.model)
    elif a.report:
        score_stage(a.data, a.model, a.report)
    else:
        p.error("score requires a report path")

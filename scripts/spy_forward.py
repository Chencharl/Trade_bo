"""Append time-stamped, prospective SPY observations and derive the three frozen accounts."""

import argparse
import json
import math
import os
from datetime import datetime, timedelta
from pathlib import Path

from spy_attribution import account_windows, cash_spells, window, window_moves
from spy_forward_source import market, NY, UTC
from spy_study import (
    CAPITAL,
    FEE,
    SLIP,
    digest,
    month_rules,
    observations,
    predict,
    replay,
    save,
)

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "public/research/spy-model.json"
SEED = ROOT / "research/spy-forward-seed.json"
FIRST = "2026-11-30"
ENTRY = "2026-12-01"
KEYS = ("model", "trend", "market")
LOCK = dict(
    version="spy-forward-1",
    firstSignal=FIRST,
    firstOpen=ENTRY,
    reviewThrough="2027-11-30",
    capital=CAPITAL,
    baseClose=728.320007,
    feeBp=FEE * 10000,
    slipBp=SLIP * 10000,
    threshold=0.5,
    modelHash="782089554c0bc852fe2727b6e3ca17b006684456633df2f772cac27ce5f0d2ca",
    seedHash="e56b5481c198328a72eb2570ee7708ec8e66f091d39a088b7bbd8e1596c9dc13",
    simulatorHash="71064e9bf4c5629b2138b754d651b0978dd3f564e9fc58d73a8ee712081c0c13",
    attributionHash="e00f21242aca00b244d3f3728d8a0059ff498a8ca480805829e0fc35b539bb61",
)


def locked_inputs():
    for p, k in (
        (MODEL, "modelHash"),
        (SEED, "seedHash"),
        (ROOT / "scripts/spy_study.py", "simulatorHash"),
        (ROOT / "scripts/spy_attribution.py", "attributionHash"),
    ):
        if digest(p) != LOCK[k]:
            raise ValueError("Frozen input changed: " + p.name)
    seed = json.loads(SEED.read_bytes())
    if seed["anchor"] != LOCK["baseClose"]:
        raise ValueError("Opening index anchor changed")
    return seed, json.loads(MODEL.read_bytes())["model"]


def iso(dt):
    return dt.astimezone(UTC).isoformat(timespec="seconds")


def next_phase(cal, last):
    if not last:
        return FIRST, "open"
    if last["phase"] == "open":
        return last["date"], "close"
    return str(cal.next_session(last["date"]).date()), "open"


def market_time(cal, day, phase):
    return (
        cal.session_open(day) if phase == "open" else cal.session_close(day)
    ).to_pydatetime()


def due(cal, events, now):
    day, phase = next_phase(cal, events[-1] if events else None)
    todo = []
    while True:
        stamp = market_time(cal, day, phase)
        if now < stamp + timedelta(minutes=20):
            return todo
        todo.append((day, phase, stamp))
        day, phase = next_phase(cal, {"date": day, "phase": phase})


def observed_rows(events):
    rows = []
    for e in events:
        if e["phase"] == "open":
            rows.append(
                (e["date"], e["level"], e["level"], e["distribution"], e["payable"])
            )
        else:
            day, op, _, div, pay = rows[-1]
            rows[-1] = (day, op, e["level"], div, pay)
    return rows


def signal_arrays(seed, model, events, next_day):
    # Synthetic warm-up opens never enter a live signal. Daily total returns and
    # historical month-end levels preserve the original predictor and state.
    rows = [(d, v, v, 0, "") for d, v in seed["history"]] + observed_rows(events)
    x, index = observations(rows)
    import numpy as np

    _, trend = month_rules(
        rows + [(next_day, 0, 0, 0, "")], np.append(index, index[-1])
    )
    n = len(seed["history"])
    return x[n:], predict(model, x[n:]), trend[n + 1 :]


def decision(seed, model, events, next_day):
    features, probs, trend = signal_arrays(seed, model, events, next_day)
    prob = float(probs[-1])
    if not math.isfinite(prob):
        raise ValueError("Invalid probability")
    return dict(
        features=features[-1].tolist(),
        probability=prob,
        targets=dict(
            model=int(prob >= LOCK["threshold"]), trend=int(trend[-1]), market=1
        ),
    )


def append_events(cal, existing, todo, bars, source, now, run, seed, model):
    events = list(existing)
    for day, phase, clock in todo:
        if (day, phase) != next_phase(cal, events[-1] if events else None):
            raise ValueError("Out-of-order market event")
        if now < clock + timedelta(minutes=20) or datetime.fromisoformat(
            source["quoteThrough"]
        ) < clock - timedelta(seconds=90):
            raise ValueError("SPY feed has not reached the required session phase")
        d, op, cl, div, pay = bars[day]
        price = op if phase == "open" else cl
        if d != day or price is None or not math.isfinite(price) or price <= 0:
            raise ValueError("Missing session price")
        event = dict(
            date=day,
            phase=phase,
            marketAt=iso(clock),
            recordedAt=iso(now),
            run=run,
            source=source,
            level=100 * price / seed["anchor"],
        )
        events.append(event)
        if phase == "open":
            event.update(distribution=100 * div / seed["anchor"], payable=pay)
        else:
            opening = events[-2]
            if (
                opening["distribution"] != 100 * div / seed["anchor"]
                or opening["payable"] != pay
            ):
                raise ValueError("Corporate action changed after the opening snapshot")
            next_day = str(cal.next_session(day).date())
            event["nextOpenAt"] = iso(market_time(cal, next_day, "open"))
            event["signal"] = (
                decision(seed, model, events, next_day)
                if now.astimezone(NY).date().isoformat() == day
                else None
            )
    return events


def summarize(events):
    bars = observed_rows(events)
    metrics = {k: dict(ending=CAPITAL, net=0, fees=0, target=0) for k in KEYS}
    receipts = []
    episodes = []
    if not bars:
        return dict(accounts=metrics, fills=receipts, episodes=episodes)
    positions = {k: [] for k in KEYS}
    opens = events[::2]
    closes = events[1::2]
    for i, e in enumerate(opens):
        prior = closes[i - 1] if i else None
        for k in KEYS:
            if k == "market":
                target = int(e["date"] >= ENTRY)
            elif prior and prior["signal"]:
                if (
                    prior["nextOpenAt"] != e["marketAt"]
                    or prior["recordedAt"] >= e["marketAt"]
                ):
                    raise ValueError(
                        "A fill requires a pre-open signal for that session"
                    )
                target = prior["signal"]["targets"][k]
            else:
                target = positions[k][-1] if i else 0
            positions[k].append(target)
    rows = [("2026-11-27", 100, 100, 0, "")] + bars
    windows = {}
    marks = {}
    for k in KEYS:
        stats, book, trades = replay(rows, 1, positions[k])
        marks[k] = book
        windows[k] = account_windows(bars, book, trades)
        metrics[k] = dict(
            ending=stats["ending"],
            net=stats["total"],
            fees=stats["commission"] + stats["slippage"],
            target=positions[k][-1],
        )
        by_day = {e["date"]: e for e in opens}
        for o in trades:
            e = by_day[o["date"]]
            receipts.append(
                dict(
                    rule=k,
                    date=o["date"],
                    marketAt=e["marketAt"],
                    recordedAt=e["recordedAt"],
                    side=o["side"],
                    commission=o["commission"],
                    slippage=o["slippage"],
                    openPrice=o["open"] * LOCK["baseClose"] / 100,
                    fillPrice=o["fill"] * LOCK["baseClose"] / 100,
                    shares=o["quantity"] * 100 / LOCK["baseClose"],
                    notional=o["fill"] * o["quantity"],
                )
            )
    for a, b in cash_spells(positions["model"]):
        if a == 0:
            continue  # An account which has never bought has not reduced exposure.
        avoided, missed = window_moves(bars, a, b)
        windows_now = {k: window(windows[k], a, b, marks[k][-1][1]) for k in KEYS}
        episodes.append(
            dict(
                exit=bars[a][0],
                reentry=bars[b][0] if b < len(bars) else None,
                through=bars[b][0] if b < len(bars) else bars[-1][0],
                days=b - a,
                avoided=avoided,
                missed=missed,
                windows=windows_now,
            )
        )
    return dict(
        accounts=metrics,
        fills=sorted(receipts, key=lambda r: r["date"]),
        episodes=episodes,
    )


def report(cal, events, activation=None):
    day, phase = next_phase(cal, events[-1] if events else None)
    return dict(
        protocol=LOCK,
        activation=activation,
        events=events,
        nextObservation=iso(market_time(cal, day, phase) + timedelta(minutes=20)),
        **summarize(events),
    )


def verify(cal, stored, seed, model):
    if stored["protocol"] != LOCK:
        raise ValueError("Forward protocol mismatch")
    previous = None
    for e in stored["events"]:
        day, phase = next_phase(cal, previous)
        clock = market_time(cal, day, phase)
        recorded = datetime.fromisoformat(e["recordedAt"])
        if (
            (e["date"], e["phase"], e["marketAt"]) != (day, phase, iso(clock))
            or recorded < clock + timedelta(minutes=20)
            or (previous and e["recordedAt"] < previous["recordedAt"])
        ):
            raise ValueError("Invalid event chronology")
        if not math.isfinite(e["level"]) or e["level"] <= 0:
            raise ValueError("Invalid recorded SPY level")
        if phase == "open" and (
            not math.isfinite(e["distribution"])
            or e["distribution"] < 0
            or (e["distribution"] and e["payable"] < day)
        ):
            raise ValueError("Invalid dividend entitlement")
        if phase == "close":
            if e["nextOpenAt"] != iso(cal.session_open(cal.next_session(day))) or (
                (e["signal"] is not None)
                != (recorded.astimezone(NY).date().isoformat() == day)
            ):
                raise ValueError("Invalid signal time")
        previous = e
    if previous:
        import numpy as np

        f, prob, trend = signal_arrays(
            seed,
            model,
            stored["events"],
            str(cal.next_session(previous["date"]).date()),
        )
        for i, e in enumerate(stored["events"][1::2]):
            sig = e["signal"]
            if sig is None:
                continue
            np.testing.assert_allclose(sig["features"], f[i], rtol=1e-11, atol=1e-12)
            if not math.isclose(sig["probability"], prob[i], abs_tol=1e-12) or sig[
                "targets"
            ] != dict(model=int(prob[i] >= 0.5), trend=int(trend[i]), market=1):
                raise ValueError("Recorded signal disagrees with frozen inputs")
    if stored != report(cal, stored["events"], stored["activation"]):
        raise ValueError("Ledger and published accounts disagree")


def save_atomic(path, updated):
    tmp = path.with_suffix(".tmp")
    save(tmp, updated)
    tmp.replace(path)


def guard(previous, updated, now):
    if updated["events"][: len(previous["events"])] != previous["events"] or (
        previous["activation"] and updated["activation"] != previous["activation"]
    ):
        raise ValueError("Refusing to rewrite recorded history")
    for e in updated["events"][len(previous["events"]) :]:
        if (
            e["phase"] == "close"
            and e["signal"]
            and e["date"] != now.astimezone(NY).date().isoformat()
        ):
            raise ValueError("Signal missed its publication deadline")


def run(path, probe=False, verify_only=False):
    from exchange_calendars import get_calendar

    start = datetime.now(UTC)
    cal = get_calendar(
        "XNYS", start="2026-11-01", end=str((start + timedelta(days=45)).date())
    )
    seed, model = locked_inputs()
    stored = json.loads(path.read_bytes())
    verify(cal, stored, seed, model)
    if verify_only:
        print(
            "Verified", len(stored["events"]), "observations and all three portfolios"
        )
        return
    tasks = due(cal, stored["events"], start)
    if not tasks:
        if probe or not stored["activation"]:
            day = cal.date_to_session(start.astimezone(NY).date(), direction="previous")
            if start < cal.session_close(day) + timedelta(minutes=20):
                day = cal.previous_session(day)
            dates = [str(day.date())]
            _, source = market(dates[0], dates[0], dates)
            if not stored["activation"]:
                activation = dict(
                    recordedAt=iso(datetime.now(UTC)),
                    marketSession=dates[0],
                    source=source,
                    run=os.environ.get("GITHUB_RUN_ID"),
                )
                save_atomic(path, report(cal, stored["events"], activation))
            print("Source probe passed for", dates[0])
        print("No observation due. Next check after", stored["nextObservation"])
        return
    dates = list(dict.fromkeys(d for d, _, _ in tasks))
    bars, source = market(dates[0], dates[-1], dates)
    events = append_events(
        cal,
        stored["events"],
        tasks,
        bars,
        source,
        datetime.now(UTC),
        os.environ.get("GITHUB_RUN_ID"),
        seed,
        model,
    )
    updated = report(cal, events, stored["activation"])
    verify(cal, updated, seed, model)
    save_atomic(path, updated)
    print("Appended", len(tasks), "observations through", events[-1]["marketAt"])


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("ledger", type=Path)
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--probe", action="store_true")
    mode.add_argument(
        "--verify-only",
        action="store_true",
        help="Replay the saved ledger offline without collecting or writing observations",
    )
    mode.add_argument(
        "--before-push",
        type=Path,
        help="Check against the ledger that was fetched before this update",
    )
    args = p.parse_args()
    if args.before_push:
        guard(
            json.loads(args.before_push.read_bytes()),
            json.loads(args.ledger.read_bytes()),
            datetime.now(UTC),
        )
    else:
        run(args.ledger, args.probe, args.verify_only)

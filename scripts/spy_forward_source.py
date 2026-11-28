"""Read unadjusted SPY regular-session bars and issuer ex/pay dates without an API key."""

import hashlib
import io
import json
import math
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

from spy_source import ISSUER_URL, get

NY = ZoneInfo("America/New_York")
UTC = timezone.utc


def timestamp(day):
    return int(
        datetime.combine(date.fromisoformat(day), datetime.min.time(), NY).timestamp()
    )


def quotes(first, last):
    params = urlencode(
        dict(
            period1=timestamp(first),
            period2=timestamp(str(date.fromisoformat(last) + timedelta(days=1))),
            interval="1d",
            events="div,splits",
            includePrePost="false",
        )
    )
    for host in ("query1", "query2"):
        try:
            raw = get(
                None, f"https://{host}.finance.yahoo.com/v8/finance/chart/SPY?{params}"
            )
            return json.loads(raw)["chart"]["result"][0], hashlib.sha256(
                raw
            ).hexdigest()
        except (
            HTTPError,
            URLError,
            TimeoutError,
            ValueError,
            TypeError,
            IndexError,
            KeyError,
        ):
            if host == "query2":
                raise


def distributions(content, first, last):
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    values = {}
    for r in wb.active.values:
        if r[1] != "SPY":
            continue
        ex, pay = [
            datetime.strptime(r[i], "%m/%d/%Y").date().isoformat() for i in (3, 5)
        ]
        if first <= ex <= last:
            amount = sum(float(v or 0) for v in r[6:9])
            if ex in values or pay < ex or not math.isfinite(amount) or amount <= 0:
                raise ValueError("Invalid issuer distribution")
            values[ex] = (amount, pay)
    wb.close()
    return values


def market(first, last, expected):
    data, price_hash = quotes(first, last)
    meta = data["meta"]
    if (meta["symbol"], meta["currency"], meta["exchangeTimezoneName"]) != (
        "SPY",
        "USD",
        "America/New_York",
    ) or data.get("events", {}).get("splits"):
        raise ValueError("Unexpected SPY instrument, timezone, currency or split")
    issuer = get(None, ISSUER_URL)
    payouts = distributions(issuer, first, last)
    dates = [
        datetime.fromtimestamp(t, NY).date().isoformat() for t in data["timestamp"]
    ]
    if dates != expected:
        raise ValueError(
            f"Expected SPY sessions {expected[:1]} through {expected[-1:]}, received {dates[:1]} through {dates[-1:]}"
        )
    ex_dates = {
        datetime.fromtimestamp(e["date"], NY).date().isoformat()
        for e in data.get("events", {}).get("dividends", {}).values()
    }
    if set(payouts) != ex_dates:
        raise ValueError("Issuer and price feed disagree on ex-dates")
    q = data["indicators"]["quote"][0]
    bars = {}
    for d, op, cl in zip(dates, q["open"], q["close"], strict=True):
        if (
            not op
            or not math.isfinite(op)
            or op <= 0
            or (cl is not None and (not math.isfinite(cl) or cl <= 0))
        ):
            raise ValueError("Missing or invalid price on " + d)
        amount, pay = payouts.get(d, (0.0, ""))
        bars[d] = (
            d,
            round(op, 6),
            round(cl, 6) if cl is not None else None,
            round(amount, 6),
            pay,
        )
    return bars, dict(
        prices=price_hash,
        issuer=hashlib.sha256(issuer).hexdigest(),
        quoteThrough=datetime.fromtimestamp(meta["regularMarketTime"], UTC).isoformat(),
    )

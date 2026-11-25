"""Normalize Yahoo SPY daily prices and State Street's ex/pay dates into a local study input."""

import argparse
import csv
import io
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

PRICE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?period1=725846400&period2=1793404800&interval=1d&events=div%2Csplits"
ISSUER_URL = "https://www.ssga.com/library-content/products/fund-data/etfs/us/spdr-etf-historical-distributions.xlsx"
FIRST, LAST = "1993-01-29", "2026-10-30"


def get(path, url):
    if path:
        return Path(path).read_bytes()
    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=45) as r:
        return r.read()


def normalize(prices, issuer):
    from openpyxl import load_workbook
    from exchange_calendars import get_calendar

    data = json.loads(prices)["chart"]["result"][0]
    if (
        data["meta"]["symbol"] != "SPY"
        or data["meta"]["currency"] != "USD"
        or data.get("events", {}).get("splits")
    ):
        raise ValueError("Unexpected instrument, currency or split")
    dates = [
        datetime.fromtimestamp(x, timezone.utc).date().isoformat()
        for x in data["timestamp"]
    ]
    expected = [
        d.date().isoformat()
        for d in get_calendar("XNYS", start=FIRST, end=LAST).sessions
    ]
    if dates != expected:
        raise ValueError("Missing, duplicate or unexpected SPY trading session")
    sheet = load_workbook(io.BytesIO(issuer), read_only=True, data_only=True).active
    divs = {}
    for row in sheet.values:
        if row[1] != "SPY":
            continue
        ex, pay = [
            datetime.strptime(row[i], "%m/%d/%Y").date().isoformat() for i in (3, 5)
        ]
        if not FIRST <= ex <= LAST:
            continue
        if ex in divs or pay < ex:
            raise ValueError("Unexpected SPY dividend")
        divs[ex] = (sum(float(x or 0) for x in row[6:9]), pay)
    yahoo_ex = {
        datetime.fromtimestamp(v["date"], timezone.utc).date().isoformat()
        for v in data["events"]["dividends"].values()
    }
    if set(divs) != yahoo_ex or not set(divs) <= set(dates):
        raise ValueError("Dividend chronology differs between sources")
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["date", "open", "high", "low", "close", "distribution", "payable"])
    quote = data["indicators"]["quote"][0]
    for i, date in enumerate(dates):
        op, hi, lo, cl = (quote[k][i] for k in ["open", "high", "low", "close"])
        if not (0 < lo <= min(op, cl) <= max(op, cl) <= hi):
            raise ValueError("Invalid OHLC on " + date)
        amount, pay = divs.get(date, (0, ""))
        w.writerow([date, *[f"{x:.6f}" for x in [op, hi, lo, cl, amount]], pay])
    return out.getvalue().encode()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("output", type=Path)
    p.add_argument("--prices")
    p.add_argument("--issuer")
    a = p.parse_args()
    data = normalize(get(a.prices, PRICE_URL), get(a.issuer, ISSUER_URL))
    a.output.write_bytes(data)
    print(hashlib.sha256(data).hexdigest(), a.output)

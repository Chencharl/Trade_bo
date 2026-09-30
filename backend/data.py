"""Synthetic fixtures and a server-side Alpha Vantage adapter for US equities."""
from __future__ import annotations

import json
import math
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

DEFAULT_POLICY = {"max_position_pct": 22.0, "max_sector_pct": 32.0,
                  "min_cash_pct": 12.0, "risk_per_trade_pct": 1.0,
                  "planning_stop_pct": 8.0, "rebalance_band_pct": 4.0}
# Symbol, company, sector, base price, slope, phase, role, target %, shares, cost basis.
DEMO_SPEC = [
    ("ORBT", "Orbit Systems", "Technology", 62, .28, 1, "Tactical", 18, 80, 74),
    ("COVE", "Cove Medical", "Health Care", 83, -.22, 2, "Defensive", 12, 220, 70),
    ("NOVA", "Nova Energy", "Energy", 112, .05, 3, "Tactical", 10, 80, 108),
    ("HELM", "Helm Industrial", "Industrials", 69, .19, 4, "Core", 16, 100, 73),
    ("STEA", "Steadfast Bancorp", "Financials", 51, .12, 5, "Core", 14, 190, 55),
    ("BRIO", "Brio Retail", "Consumer Discretionary", 44, -.04, 6, "Defensive", 10, 125, 46),
]


def demo_assets() -> list[dict]:
    """Return entirely fictional prices, fundamentals, and articles."""
    end = date.today()
    days = sorted(end - timedelta(days=i) for i in range(145)
                  if (end - timedelta(days=i)).weekday() < 5)[-100:]
    now = datetime.now(timezone.utc)
    assets = []
    for index, (symbol, name, sector, base, slope, phase, *_rest) in enumerate(DEMO_SPEC):
        bars = [{"date": day.isoformat(),
                 "close": round(base + slope * i + math.sin(i / 4 + phase) * 1.15, 2)}
                for i, day in enumerate(days)]
        if symbol == "ORBT":
            headlines = [("Sample Wire A", "Orbit Systems reports contract expansion", "positive"),
                         ("Sample Wire B", "Orbit Systems increases annual outlook", "positive")]
        elif symbol == "COVE":
            headlines = [("Sample Wire A", "Cove Medical revises demand guidance", "negative")]
        else:
            headlines = [("Sample Wire A", f"{name} issues a company update", "neutral")]
        news = [{"title": title, "source": source,
                 "url": f"https://example.com/tradebo-demo/{symbol.lower()}/{i}",
                 "published_at": (now - timedelta(hours=12 + 9 * i)).isoformat(),
                 "tickers": [symbol], "ticker_relevance_score": 1.0, "sentiment": sentiment,
                 "summary": "Fictional article for interface testing. No real event is implied."}
                for i, (source, title, sentiment) in enumerate(headlines)]
        overview = {
            "sector": sector,
            "market_cap": [8.2, 5.4, 6.1, 4.9, 7.0, 3.7][index] * 1_000_000_000,
            "pe_ratio": [27.4, 19.8, 16.2, 21.1, 12.7, 14.9][index],
            "profit_margin": [.18, .13, .11, .09, .22, .07][index],
            "revenue_ttm": [3.1, 2.6, 4.8, 3.8, 4.2, 2.3][index] * 1_000_000_000,
            "dividend_yield": [0, .014, .021, .012, .029, .018][index],
            "source": "Synthetic fixture",
        }
        assets.append({"symbol": symbol, "name": name, "sector": sector,
                       "mode": "demo", "bars": bars, "news": news,
                       "overview": overview, "retrieved_at": now.isoformat()})
    return assets


def default_model(assets: list[dict]) -> dict:
    if assets and assets[0]["mode"] == "demo":
        return {"cash": 20_000,
                "holdings": [{"symbol": symbol, "shares": shares, "cost_basis": cost, "role": role}
                             for symbol, _, _, _, _, _, role, _, shares, cost in DEMO_SPEC],
                "targets": {**{row[0]: row[7] for row in DEMO_SPEC}, "CASH": 20},
                "policy": DEFAULT_POLICY.copy(), "label": "Illustrative portfolio"}
    symbols = [asset["symbol"] for asset in assets]
    weight = min(20.0, 60.0 / len(symbols)) if symbols else 0
    return {"cash": 100_000,
            "holdings": [{"symbol": symbol, "shares": 0, "cost_basis": None, "role": "Tactical"}
                         for symbol in symbols],
            "targets": {**{symbol: weight for symbol in symbols}, "CASH": 100.0 - weight * len(symbols)},
            "policy": DEFAULT_POLICY.copy(), "label": "Unfunded example model"}


_CACHE: dict[str, tuple[float, dict]] = {}
_RATE_LOCK = Lock()
_LAST_REQUEST_AT = float("-inf")


def _wait_for_provider_slot() -> None:
    """Serialize outbound calls within the free key's per-second burst limit."""
    global _LAST_REQUEST_AT
    with _RATE_LOCK:
        delay = max(0.0, _LAST_REQUEST_AT + 1.25 - time.monotonic())
        if delay:
            time.sleep(delay)
        _LAST_REQUEST_AT = time.monotonic()


def _query(function: str, symbol: str, key: str, ttl: int) -> dict:
    cache_key = f"{function}:{symbol}"
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[0] < ttl:
        return cached[1]
    parameter = {"SYMBOL_SEARCH": "keywords", "TIME_SERIES_DAILY": "symbol",
                 "NEWS_SENTIMENT": "tickers", "OVERVIEW": "symbol"}[function]
    params = {"function": function, parameter: symbol, "apikey": key}
    if function == "NEWS_SENTIMENT":
        params["limit"] = 30
    # Alpha Vantage authenticates through the query string. Never log this URL.
    url = "https://www.alphavantage.co/query?" + urlencode(params)
    try:
        _wait_for_provider_slot()
        with urlopen(url, timeout=15) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError("The market data provider is unavailable. Check the network, key, and quota.") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("The market data provider returned an invalid response.")
    if any(k in payload for k in ("Note", "Information")):
        raise RuntimeError("The market data provider reached a rate, quota, or access limit. Wait and retry with fewer tickers.")
    if "Error Message" in payload:
        raise RuntimeError("The market data provider rejected this endpoint or ticker.")
    _CACHE[cache_key] = (time.time(), payload)
    return payload


def _optional_float(value: object) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def validate_symbol(symbol: str) -> str:
    symbol = symbol.strip().upper()
    if not re.fullmatch(r"[A-Z]{1,5}(?:[.-][A-Z])?", symbol):
        raise ValueError("Enter a US equity ticker with 1–5 letters and an optional class suffix.")
    return symbol


def live_asset(symbol: str) -> dict:
    symbol = validate_symbol(symbol)
    key = os.environ.get("ALPHA_VANTAGE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Set ALPHA_VANTAGE_API_KEY on the local server to load real US equities.")
    matches = _query("SYMBOL_SEARCH", symbol, key, 86400).get("bestMatches", [])
    match = next((m for m in matches if m.get("1. symbol", "").upper() == symbol
                  and m.get("4. region") == "United States" and m.get("3. type") == "Equity"), None)
    if not match:
        raise RuntimeError(f"{symbol} was not verified as a US-listed equity by Symbol Search.")
    series = _query("TIME_SERIES_DAILY", symbol, key, 21600).get("Time Series (Daily)")
    if not isinstance(series, dict) or len(series) < 60:
        raise RuntimeError(f"{symbol} has fewer than 60 available daily observations.")
    try:
        bars = [{"date": day, "close": float(row["4. close"])} for day, row in series.items()]
    except (ValueError, KeyError, TypeError) as exc:
        raise RuntimeError(f"{symbol} returned malformed daily price data.") from exc
    feed = _query("NEWS_SENTIMENT", symbol, key, 3600).get("feed", [])[:30]
    news = []
    for item in feed:
        try:
            published = datetime.strptime(item.get("time_published", ""), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        ticker_data = item.get("ticker_sentiment", [])
        specific = next((entry for entry in ticker_data if entry.get("ticker") == symbol), {})
        score = _optional_float(specific.get("ticker_sentiment_score")) or 0.0
        news.append({"title": item.get("title", ""), "source": item.get("source", "Unknown"),
                     "url": item.get("url", ""), "published_at": published.isoformat(),
                     "tickers": [entry.get("ticker", "") for entry in ticker_data],
                     "ticker_relevance_score": _optional_float(specific.get("relevance_score")),
                     "sentiment": "positive" if score >= .35 else "negative" if score <= -.35 else "neutral",
                     "summary": str(item.get("summary", ""))[:400]})
    raw = _query("OVERVIEW", symbol, key, 86400)
    overview = {"sector": raw.get("Sector") or "Unclassified",
                "market_cap": _optional_float(raw.get("MarketCapitalization")),
                "pe_ratio": _optional_float(raw.get("PERatio")),
                "profit_margin": _optional_float(raw.get("ProfitMargin")),
                "revenue_ttm": _optional_float(raw.get("RevenueTTM")),
                "dividend_yield": _optional_float(raw.get("DividendYield")),
                "source": "Alpha Vantage Company Overview"}
    return {"symbol": symbol, "name": match.get("2. name", symbol),
            "sector": overview["sector"], "mode": "live", "bars": bars,
            "news": news, "overview": overview,
            "retrieved_at": datetime.now(timezone.utc).isoformat()}


def live_assets(symbols: list[str] | None = None) -> list[dict]:
    if symbols is None:
        symbols = [s.strip() for s in os.environ.get("TRADEBOT_SYMBOLS", "AAPL").split(",") if s.strip()]
    normalized = list(dict.fromkeys(validate_symbol(s) for s in symbols))
    if not normalized or len(normalized) > 8:
        raise ValueError("Choose between 1 and 8 US equity tickers.")
    return [live_asset(symbol) for symbol in normalized]

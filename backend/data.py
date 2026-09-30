"""Synthetic showcase fixtures and optional Alpha Vantage market adapter."""

from __future__ import annotations

import json
import math
import os
import time
from datetime import date, datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

POLICY = {"max_position_pct": 12, "min_cash_pct": 20,
          "risk_per_trade_pct": 1, "planning_stop_pct": 8}
DEMO_PORTFOLIO = {"nav": 100000, "cash": 35000,
                  "positions": {"COVE": 80, "NOVA": 24},
                  "allocation": [{"label": "股票", "pct": 55}, {"label": "债券", "pct": 10},
                                 {"label": "现金", "pct": 35}],
                  "target": [{"label": "股票", "pct": 60}, {"label": "债券", "pct": 20},
                             {"label": "现金", "pct": 20}]}
LIVE_PORTFOLIO = {"nav": 100000, "cash": 100000, "positions": {},
                  "allocation": [{"label": "股票", "pct": 0}, {"label": "债券", "pct": 0},
                                 {"label": "现金", "pct": 100}],
                  "target": DEMO_PORTFOLIO["target"]}


def demo_assets() -> list[dict]:
    """Deterministic fictional series, ending today for interactive rule demos."""
    end = date.today()
    trading_dates = [end - timedelta(days=i) for i in range(130)]
    trading_dates = sorted(d for d in trading_dates if d.weekday() < 5)[-90:]
    specs = [("ORBT", "Orbit Labs", "科技", 62, .28, 1),
             ("COVE", "Cove Health", "医疗", 83, -.22, 2),
             ("NOVA", "Nova Energy", "能源", 112, .05, 3)]
    assets = []
    for symbol, name, sector, base, slope, phase in specs:
        bars = []
        for i in range(90):
            d = trading_dates[i]
            close = base + slope*i + math.sin(i/4 + phase)*1.15
            bars.append({"date": d.isoformat(), "close": round(close, 2)})
        stories = []
        if symbol == "ORBT":
            titles = [("模拟资讯 A", "Orbit Labs announces a new contract", "positive"),
                      ("模拟资讯 B", "Orbit Labs raises annual sales outlook", "positive")]
        elif symbol == "COVE":
            titles = [("模拟资讯 A", "Cove Health revises demand outlook", "negative")]
        else:
            titles = [("模拟资讯 A", "Nova Energy reports project update", "neutral")]
        for i, (source, title, sentiment) in enumerate(titles):
            stories.append({"title": title, "source": source,
                            "url": f"https://example.com/demo/{symbol.lower()}/{i}",
                            "published_at": (datetime.now(timezone.utc) - timedelta(hours=12+i*9)).isoformat(),
                            "tickers": [symbol], "sentiment": sentiment,
                            "summary": "纯合成示例，用于演示规则；并非真实市场消息。"})
        assets.append({"symbol": symbol, "name": name, "sector": sector,
                       "mode": "demo", "bars": bars, "news": stories})
    return assets


_CACHE: dict[str, tuple[float, dict]] = {}


def _query(function: str, symbol: str, key: str, ttl: int) -> dict:
    cache_key = f"{function}:{symbol}"
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[0] < ttl:
        return cached[1]
    params = {"function": function, "apikey": key}
    parameter = {"TIME_SERIES_DAILY": "symbol", "NEWS_SENTIMENT": "tickers", "SYMBOL_SEARCH": "keywords"}[function]
    params[parameter] = symbol
    if function == "NEWS_SENTIMENT":
        params["limit"] = 30
    url = "https://www.alphavantage.co/query?" + urlencode(params)
    # Never log the URL: it contains the private API key.
    try:
        with urlopen(url, timeout=15) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError("数据提供方暂时不可用；请检查网络、密钥及请求额度。") from exc
    if any(k in payload for k in ("Note", "Information", "Error Message")):
        raise RuntimeError("数据提供方返回额度、权限或代码错误；请检查密钥及请求额度。")
    _CACHE[cache_key] = (time.time(), payload)
    return payload


def live_assets() -> list[dict]:
    key = os.environ.get("ALPHA_VANTAGE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("尚未配置 ALPHA_VANTAGE_API_KEY；请先在服务端环境变量中设置。")
    symbols = [s.strip().upper() for s in os.environ.get("TRADEBOT_SYMBOLS", "AAPL,MSFT,NVDA").split(",") if s.strip()][:3]
    if not symbols or any(not (s.isascii() and s.isalpha() and 1 <= len(s) <= 5) for s in symbols):
        raise RuntimeError("TRADEBOT_SYMBOLS 只接受 1–5 位字母的美股普通代码。")
    assets = []
    for symbol in symbols:
        matches = _query("SYMBOL_SEARCH", symbol, key, 86400).get("bestMatches", [])
        match = next((m for m in matches if m.get("1. symbol", "").upper() == symbol
                      and m.get("4. region") == "United States"
                      and m.get("3. type") == "Equity"), None)
        if not match:
            raise RuntimeError(f"{symbol} 未通过美股交易所区域核验。")
        series = _query("TIME_SERIES_DAILY", symbol, key, 21600).get("Time Series (Daily)")
        if not isinstance(series, dict) or len(series) < 50:
            raise RuntimeError(f"{symbol} 没有足够的日线记录。")
        bars = [{"date": day, "close": float(row["4. close"])} for day, row in series.items()]
        feed = _query("NEWS_SENTIMENT", symbol, key, 3600).get("feed", [])
        news = []
        for item in feed:
            stamp = item.get("time_published", "")
            try:
                published = datetime.strptime(stamp, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                continue
            ticker_data = item.get("ticker_sentiment", [])
            tags = [x.get("ticker", "") for x in ticker_data]
            specific = next((x for x in ticker_data if x.get("ticker") == symbol), {})
            score = float(specific.get("ticker_sentiment_score", 0))
            sentiment = "positive" if score >= .35 else "negative" if score <= -.35 else "neutral"
            news.append({"title": item.get("title", ""), "source": item.get("source", "Unknown"),
                         "url": item.get("url", ""), "published_at": published,
                         "tickers": tags, "sentiment": sentiment,
                         "summary": item.get("summary", "")[:300]})
        assets.append({"symbol": symbol, "name": match.get("2. name", symbol), "sector": "未分类",
                       "mode": "live", "bars": bars, "news": news})
    return assets

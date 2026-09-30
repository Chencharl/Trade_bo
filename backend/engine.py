"""Deterministic, explainable research and paper-order rules.

Every result is a research candidate, not an instruction to trade. All money
amounts in the sample portfolio are synthetic USD values.
"""

from __future__ import annotations

from datetime import datetime, timezone
from math import floor
from statistics import mean
from typing import Any


def _parse_date(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=timezone.utc) if len(value) == 10 else datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _age_hours(value: str, now: datetime) -> float:
    return (now - _parse_date(value)).total_seconds() / 3600


def score_news(items: list[dict[str, Any]], symbol: str, now: datetime) -> list[dict[str, Any]]:
    """Score ticker relevance and freshness; sentiment is provider metadata only."""
    seen: set[str] = set()
    seen_titles: set[str] = set()
    scored = []
    for item in items:
        title = str(item.get("title", "")).strip()
        url = str(item.get("url", "")).strip()
        published = str(item.get("published_at", ""))
        if not title or not url or not url.startswith("https://"):
            continue
        try:
            age = _age_hours(published, now)
        except (ValueError, TypeError):
            continue
        key = url.split("?", 1)[0].lower()
        title_key = " ".join(title.casefold().split())
        if key in seen or title_key in seen_titles or age < -1:
            continue
        seen.add(key)
        seen_titles.add(title_key)
        tickers = [str(t).upper() for t in item.get("tickers", [])]
        explicit = symbol.upper() in tickers
        # No issuer-name guessing: explicit ticker tags are required for relevance.
        relevance = round((0.7 if explicit else 0.0) + (0.3 if 0 <= age <= 72 else 0.0), 2)
        scored.append({**item, "age_hours": round(age, 1), "relevance": relevance,
                       "relevant": explicit and 0 <= age <= 72, "source": str(item.get("source", "Unknown"))})
    return sorted(scored, key=lambda x: (x["relevant"], x["relevance"], x["published_at"]), reverse=True)


def _signals(bars: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(bars, key=lambda x: x["date"])
    if len(ordered) < 50:
        raise ValueError("At least 50 daily closes are required")
    closes = [float(b["close"]) for b in ordered]
    if any(p <= 0 for p in closes):
        raise ValueError("Close prices must be positive")
    latest = closes[-1]
    sma20 = mean(closes[-20:])
    sma50 = mean(closes[-50:])
    change = (latest / closes[-2] - 1) * 100
    return {"price": round(latest, 2), "change_pct": round(change, 2),
            "sma20": round(sma20, 2), "sma50": round(sma50, 2),
            "trend_up": latest > sma20 > sma50,
            "trend_down": latest < sma20 and sma20 < sma50,
            "as_of": ordered[-1]["date"], "history": ordered[-80:]}


def analyze_asset(asset: dict[str, Any], portfolio: dict[str, Any], policy: dict[str, Any],
                  now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    symbol = str(asset["symbol"]).upper()
    market = _signals(asset["bars"])
    news = score_news(asset.get("news", []), symbol, now)
    relevant = [n for n in news if n["relevant"]]
    sources = {n["source"].lower() for n in relevant}
    positives = sum(n.get("sentiment") == "positive" for n in relevant)
    negatives = sum(n.get("sentiment") == "negative" for n in relevant)
    held = float(portfolio.get("positions", {}).get(symbol, 0))
    nav = float(portfolio["nav"])
    cash = float(portfolio["cash"])
    max_position = float(policy["max_position_pct"]) / 100
    reserve = float(policy["min_cash_pct"]) / 100
    risk_budget = float(policy["risk_per_trade_pct"]) / 100
    stop_pct = float(policy["planning_stop_pct"]) / 100
    price = market["price"]
    current_value = held * price
    max_by_position = max(0.0, nav * max_position - current_value)
    max_by_cash = max(0.0, cash - nav * reserve)
    max_by_risk = nav * risk_budget / stop_pct
    shares = max(0, floor(min(max_by_position, max_by_cash, max_by_risk) / price))
    market_age = _age_hours(market["as_of"], now)
    stale = market_age > 120 or market_age < -24
    gates = [
        {"id": "data", "label": "行情时间", "passed": not stale,
         "detail": f"日线截至 {market['as_of']}；超过 5 天或未来日期即阻断新建议"},
        {"id": "trend", "label": "价格趋势", "passed": market["trend_up"],
         "detail": f"收盘 {price:.2f} / 20 日均线 {market['sma20']:.2f} / 50 日均线 {market['sma50']:.2f}；需依次高于"},
        {"id": "news", "label": "资讯证据", "passed": len(sources) >= 2 and positives >= 2 and negatives == 0,
         "detail": f"72 小时内 {len(relevant)} 条相关资讯，{len(sources)} 个独立来源；利好 {positives} / 利空 {negatives}"},
        {"id": "sizing", "label": "仓位与现金", "passed": shares >= 1,
         "detail": f"最多 {shares} 股；单标的 ≤{max_position:.0%}，现金留存 ≥{reserve:.0%}，计划风险 ≤{risk_budget:.0%}"},
    ]
    concentration = current_value > nav * max_position
    sell_trigger = held > 0 and (market["trend_down"] or concentration)
    sell_gates = [
        {"id": "data", "label": "行情可用", "passed": not stale,
         "detail": f"日线截至 {market['as_of']}；超过 5 天或未来日期则暂停"},
        {"id": "holding", "label": "已有持仓", "passed": held > 0,
         "detail": f"当前记录 {held:g} 股，估值 ${current_value:,.2f}"},
        {"id": "downtrend", "label": "趋势转弱", "passed": market["trend_down"],
         "detail": f"收盘 {price:.2f} / 20 日均线 {market['sma20']:.2f} / 50 日均线 {market['sma50']:.2f}；需依次低于"},
        {"id": "concentration", "label": "仓位超限", "passed": concentration,
         "detail": f"持仓占组合 {current_value/nav:.1%}，上限 {max_position:.0%}"},
    ]
    if stale:
        action = "WAIT"
        reason = "行情已过期，暂停生成交易候选。"
    elif sell_trigger:
        action = "REVIEW_SELL"
        triggers = []
        if market["trend_down"]:
            triggers.append("收盘与均线呈下行排列")
        if concentration:
            triggers.append("持仓超过单标的上限")
        reason = "、".join(triggers) + "；需人工确认卖出范围。"
    elif all(g["passed"] for g in gates):
        action = "REVIEW_BUY"
        reason = "趋势、资讯相关性和仓位约束均满足；仍需人工核验原文及成交条件。"
    else:
        action = "WAIT"
        reason = "至少一项买入条件未满足，维持观察。"
    return {"symbol": symbol, "name": asset["name"], "sector": asset.get("sector", "—"),
            "mode": asset.get("mode", "demo"), "market": market, "news": news,
            "action": action, "reason": reason, "gates": gates, "sell_gates": sell_gates,
            "position_shares": held, "position_value": round(current_value, 2),
            "suggested_max_shares": shares if action == "REVIEW_BUY" else 0,
            "planning_stop": round(price * (1 - stop_pct), 2),
            "risk_note": "计划止损仅用于仓位预算；止损触发价不保证成交价。"}


def build_dashboard(assets: list[dict[str, Any]], portfolio: dict[str, Any],
                    policy: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    analyses = [analyze_asset(a, portfolio, policy, now) for a in assets]
    return {"as_of": (now or datetime.now(timezone.utc)).isoformat(),
            "mode": "live" if assets and assets[0].get("mode") == "live" else "demo",
            "portfolio": portfolio, "policy": policy, "analyses": analyses,
            "method": "规则研究原型；资讯方向为数据提供方标签，不单独触发交易。"}

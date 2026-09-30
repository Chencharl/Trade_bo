"""Auditable portfolio, security, and question-answering rules.

This module deliberately makes no return forecast and never sends a broker order.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from statistics import mean, stdev
from typing import Any

ROLE_METHODS = {
    "Core": "Scheduled allocation review; add only below target with intact trend and no adverse event tag.",
    "Tactical": "Event-confirmed staged entry; each review is capped at one third of target headroom.",
    "Defensive": "Allocation review with a non-negative profit margin gate; no momentum-only entry.",
}


def _date(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _age_hours(value: str, now: datetime) -> float:
    return (now - _date(value)).total_seconds() / 3600


def _number(value: Any, name: str, low: float = 0, high: float = math.inf) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number.")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number.") from exc
    if not math.isfinite(number) or not low <= number <= high:
        raise ValueError(f"{name} must be between {low:g} and {high:g}.")
    return number


def score_news(items: list[dict], symbol: str, company_name: str, now: datetime) -> list[dict]:
    """Retain recent issuer-led headlines with a strong provider ticker link."""
    generic = {"inc", "corp", "corporation", "company", "the", "group", "holdings",
               "international", "technologies", "technology", "systems", "energy",
               "medical", "industrial", "bancorp", "retail", "limited", "ltd"}
    aliases = [word for word in re.findall(r"[a-z]{4,}", company_name.casefold())
               if word not in generic]
    urls: set[str] = set()
    titles: set[str] = set()
    result = []
    for item in items:
        title, url = str(item.get("title", "")).strip(), str(item.get("url", "")).strip()
        if not title or not url.startswith("https://"):
            continue
        try:
            age = _age_hours(str(item.get("published_at", "")), now)
        except ValueError:
            continue
        url_key = url.split("?", 1)[0].casefold()
        title_key = " ".join(title.casefold().split())
        if url_key in urls or title_key in titles or age < -1:
            continue
        urls.add(url_key)
        titles.add(title_key)
        explicit = symbol in [str(s).upper() for s in item.get("tickers", [])]
        recent = 0 <= age <= 72
        try:
            provider_score = float(item.get("ticker_relevance_score"))
            provider_score = provider_score if math.isfinite(provider_score) else 0.0
        except (TypeError, ValueError):
            provider_score = 0.0
        headline_match = (bool(re.search(r"(?<![a-z])" + re.escape(symbol.casefold()) + r"(?![a-z])", title_key))
                          or any(re.search(r"\b" + re.escape(alias) + r"\b", title_key) for alias in aliases))
        reason = ("No explicit ticker tag" if not explicit else
                  "Outside the 72-hour window" if not recent else
                  "Low provider ticker score" if provider_score < .8 else
                  "Issuer absent from headline" if not headline_match else None)
        result.append({**item, "age_hours": round(age, 1),
                       "relevance": round(provider_score, 2),
                       "headline_match": headline_match, "exclusion_reason": reason,
                       "relevant": reason is None})
    return sorted(result, key=lambda x: (x["relevant"], x["relevance"], x["published_at"]), reverse=True)


def market_snapshot(bars: list[dict]) -> dict:
    ordered = sorted(bars, key=lambda bar: bar["date"])
    if len(ordered) < 60:
        raise ValueError("At least 60 daily closes are required.")
    closes = [_number(bar["close"], "close", .0001) for bar in ordered]
    returns = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
    peak = closes[0]
    max_drawdown = 0.0
    for value in closes:
        peak = max(peak, value)
        max_drawdown = min(max_drawdown, value / peak - 1)
    latest = closes[-1]
    sma20, sma50 = mean(closes[-20:]), mean(closes[-50:])
    return {
        "price": round(latest, 2), "as_of": ordered[-1]["date"],
        "change_pct": round((latest / closes[-2] - 1) * 100, 2),
        "return_20d_pct": round((latest / closes[-21] - 1) * 100, 2),
        "sma20": round(sma20, 2), "sma50": round(sma50, 2),
        "trend_up": latest > sma20 > sma50,
        "trend_down": latest < sma20 < sma50,
        "volatility_annualized_pct": round(stdev(returns[-60:]) * math.sqrt(252) * 100, 1),
        "max_drawdown_observed_pct": round(max_drawdown * 100, 1),
        "history": ordered[-90:],
    }


def build_portfolio(assets: list[dict], model: dict) -> dict:
    """Compute all weights from current prices and user-provided shares/cash."""
    if not isinstance(model, dict):
        raise ValueError("Portfolio model is required.")
    asset_map = {asset["symbol"]: asset for asset in assets}
    cash = _number(model.get("cash"), "cash")
    holdings = model.get("holdings")
    if not isinstance(holdings, list) or len(holdings) > 25:
        raise ValueError("Holdings must be a list of at most 25 positions.")
    targets = model.get("targets", {})
    if not isinstance(targets, dict) or "CASH" not in targets:
        raise ValueError("Targets must include CASH.")
    if set(targets) - set(asset_map) - {"CASH"}:
        raise ValueError("A target refers to a symbol outside the loaded universe.")
    target_values = {key: _number(value, f"target {key}", 0, 100) for key, value in targets.items()}
    if abs(sum(target_values.values()) - 100) > .01:
        raise ValueError("Target weights, including CASH, must sum to 100%.")
    policy = model.get("policy", {})
    bounds = {"max_position_pct": (1, 50), "max_sector_pct": (1, 70),
              "min_cash_pct": (0, 60), "risk_per_trade_pct": (.1, 3),
              "planning_stop_pct": (1, 30), "rebalance_band_pct": (0, 15)}
    if set(policy) != set(bounds):
        raise ValueError("Portfolio policy is missing or has unknown fields.")
    policy = {key: _number(policy[key], key, *limit) for key, limit in bounds.items()}
    position_rows = []
    seen: set[str] = set()
    for item in holdings:
        if not isinstance(item, dict):
            raise ValueError("Each holding must be an object.")
        symbol = str(item.get("symbol", "")).upper()
        if symbol not in asset_map or symbol in seen:
            raise ValueError(f"Unknown or duplicate holding: {symbol}.")
        seen.add(symbol)
        shares = _number(item.get("shares"), f"{symbol} shares", 0, 1_000_000)
        if not shares.is_integer():
            raise ValueError(f"{symbol} shares must be a whole number.")
        shares = int(shares)
        role = item.get("role")
        if role not in ROLE_METHODS:
            raise ValueError(f"{symbol} role must be Core, Tactical, or Defensive.")
        cost = item.get("cost_basis")
        cost = None if cost in (None, "") else _number(cost, f"{symbol} cost basis", 0)
        asset = asset_map[symbol]
        market = market_snapshot(asset["bars"])
        position_rows.append({"symbol": symbol, "name": asset["name"],
                              "sector": asset["sector"], "role": role,
                              "method": ROLE_METHODS[role], "shares": shares,
                              "cost_basis": cost, "price": market["price"],
                              "value": round(shares * market["price"], 2),
                              "target_pct": target_values.get(symbol, 0)})
    nav = cash + sum(row["value"] for row in position_rows)
    if nav <= 0:
        raise ValueError("Portfolio value must be greater than zero.")
    sectors: dict[str, dict] = {}
    for row in position_rows:
        row["weight_pct"] = round(row["value"] / nav * 100, 2)
        row["drift_pp"] = round(row["weight_pct"] - row["target_pct"], 2)
        row["unrealized_pl_pct"] = (round((row["price"] / row["cost_basis"] - 1) * 100, 2)
                                    if row["cost_basis"] and row["shares"] else None)
        group = sectors.setdefault(row["sector"], {"sector": row["sector"], "value": 0.0,
                                                       "target_pct": 0.0, "symbols": []})
        group["value"] += row["value"]
        group["target_pct"] += row["target_pct"]
        group["symbols"].append(row["symbol"])
    for symbol, target in target_values.items():
        if symbol == "CASH" or symbol in seen or target == 0:
            continue
        asset = asset_map[symbol]
        group = sectors.setdefault(asset["sector"], {"sector": asset["sector"], "value": 0.0,
                                                         "target_pct": 0.0, "symbols": []})
        group["target_pct"] += target
        group["symbols"].append(symbol)
    for group in sectors.values():
        group["weight_pct"] = round(group["value"] / nav * 100, 2)
        group["drift_pp"] = round(group["weight_pct"] - group["target_pct"], 2)
        group["over_limit"] = group["weight_pct"] > policy["max_sector_pct"]
        group["value"] = round(group["value"], 2)
    roles = {role: {"role": role, "value": 0.0, "target_pct": 0.0,
                    "symbols": []} for role in ROLE_METHODS}
    for row in position_rows:
        group = roles[row["role"]]
        group["value"] += row["value"]
        group["target_pct"] += row["target_pct"]
        group["symbols"].append(row["symbol"])
    for symbol, target in target_values.items():
        if symbol != "CASH" and symbol not in seen and target:
            roles["Tactical"]["target_pct"] += target
            roles["Tactical"]["symbols"].append(symbol)
    for group in roles.values():
        group["value"] = round(group["value"], 2)
        group["weight_pct"] = round(group["value"] / nav * 100, 2)
        group["drift_pp"] = round(group["weight_pct"] - group["target_pct"], 2)
    cash_pct = round(cash / nav * 100, 2)
    alerts = []
    if cash_pct < policy["min_cash_pct"]:
        alerts.append({"severity": "high", "text": "Cash is below the minimum reserve."})
    if abs(cash_pct - target_values["CASH"]) > policy["rebalance_band_pct"]:
        alerts.append({"severity": "review", "text": f"Cash is {abs(cash_pct - target_values['CASH']):.1f} pp away from target."})
    for row in position_rows:
        if row["weight_pct"] > policy["max_position_pct"]:
            alerts.append({"severity": "high", "text": f"{row['symbol']} exceeds the single-name limit."})
        if abs(row["drift_pp"]) > policy["rebalance_band_pct"]:
            alerts.append({"severity": "review", "text": f"{row['symbol']} is {abs(row['drift_pp']):.1f} pp away from target."})
    for group in sectors.values():
        if group["over_limit"]:
            alerts.append({"severity": "high", "text": f"{group['sector']} exceeds the sector limit."})
    return {"label": str(model.get("label", "Editable portfolio"))[:80],
            "nav": round(nav, 2), "cash": cash, "cash_weight_pct": cash_pct,
            "cash_target_pct": target_values["CASH"], "positions": position_rows,
            "sectors": sorted(sectors.values(), key=lambda row: row["weight_pct"], reverse=True),
            "roles": list(roles.values()),
            "targets": target_values, "policy": policy, "alerts": alerts,
            "model": model, "sample": bool(assets and assets[0]["mode"] == "demo")}


def analyze_asset(asset: dict, portfolio: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    symbol = asset["symbol"]
    market = market_snapshot(asset["bars"])
    news = score_news(asset.get("news", []), symbol, asset["name"], now)
    relevant = [item for item in news if item["relevant"]]
    positive = sum(item.get("sentiment") == "positive" for item in relevant)
    negative = sum(item.get("sentiment") == "negative" for item in relevant)
    independent_sources = len({str(item.get("source", "")).casefold() for item in relevant})
    position = next((row for row in portfolio["positions"] if row["symbol"] == symbol), None)
    role = position["role"] if position else "Tactical"
    held = position["shares"] if position else 0
    current_value = position["value"] if position else 0
    current_weight = position["weight_pct"] if position else 0
    target_pct = portfolio["targets"].get(symbol, 0)
    nav, cash, policy = portfolio["nav"], portfolio["cash"], portfolio["policy"]
    sector = asset["sector"]
    sector_row = next((group for group in portfolio["sectors"] if group["sector"] == sector), None)
    sector_value = sector_row["value"] if sector_row else 0
    price = market["price"]
    headroom = min(nav * policy["max_position_pct"] / 100 - current_value,
                   nav * policy["max_sector_pct"] / 100 - sector_value,
                   cash - nav * policy["min_cash_pct"] / 100,
                   nav * policy["risk_per_trade_pct"] / policy["planning_stop_pct"],
                   nav * target_pct / 100 - current_value)
    shares = max(0, math.floor(max(0, headroom) / price))
    if role == "Tactical" and shares:
        shares = min(shares, max(1, math.floor(max(0, nav * target_pct / 100 - current_value) / (3 * price))))
    age = _age_hours(market["as_of"], now)
    fresh = -24 <= age <= 120
    overview = asset.get("overview", {})
    trend_ok = market["trend_up"] if role == "Tactical" else price >= market["sma50"]
    news_ok = (independent_sources >= 2 and positive >= 2 and negative == 0
               if role == "Tactical" else negative == 0)
    fundamentals_ok = (overview.get("profit_margin") is not None and overview["profit_margin"] >= 0
                       if role == "Defensive" else True)
    sector_known = sector != "Unclassified"
    buy_gates = [
        {"id": "freshness", "label": "Price data", "passed": fresh,
         "detail": f"Latest daily close: {market['as_of']}; maximum age: 5 calendar days."},
        {"id": "trend", "label": "Role-specific trend", "passed": trend_ok,
         "detail": ("Close > 20-day > 50-day average required." if role == "Tactical"
                    else "Close at or above the 50-day average required.")},
        {"id": "news", "label": "Event evidence", "passed": news_ok,
         "detail": f"{len(relevant)} relevant articles / {independent_sources} sources / {positive} positive / {negative} negative."},
        {"id": "fundamentals", "label": "Fundamental gate", "passed": fundamentals_ok,
         "detail": ("Non-negative reported profit margin required for Defensive holdings."
                    if role == "Defensive" else "No fundamental threshold in this role's entry rule.")},
        {"id": "classification", "label": "Sector classification", "passed": sector_known,
         "detail": "A reported sector is required before checking sector exposure for an add."},
        {"id": "allocation", "label": "Portfolio headroom", "passed": shares >= 1,
         "detail": f"Current {current_weight:.1f}% / target {target_pct:.1f}%; paper-review ceiling {shares} shares."},
    ]
    overweight = current_weight > target_pct + policy["rebalance_band_pct"]
    position_breach = current_weight > policy["max_position_pct"]
    sector_breach = bool(sector_row and sector_row["over_limit"])
    tactical_break = role == "Tactical" and market["trend_down"]
    sell_triggers = [label for passed, label in [
        (overweight, "above the target band"), (position_breach, "single-name limit breach"),
        (sector_breach, "sector limit breach"), (tactical_break, "Tactical downtrend")]
        if passed and held > 0]
    if not fresh:
        action, reason = "DATA_HOLD", "Daily price data is stale or future-dated; review is paused."
    elif sell_triggers:
        action, reason = "REVIEW_REDUCE", "Review reduction: " + ", ".join(sell_triggers) + "."
    elif all(gate["passed"] for gate in buy_gates):
        action, reason = "REVIEW_ADD", f"The {role.lower()} entry and portfolio headroom rules pass; human review remains required."
    else:
        action, reason = "HOLD", "At least one role-specific entry or allocation rule is not met."
    if sell_triggers:
        above_target = max(0, math.ceil((current_value - nav * target_pct / 100) / price))
        sell_ceiling = min(int(held), max(above_target, math.ceil(held / 3) if tactical_break else 0, 1))
    else:
        sell_ceiling = 0
    return {
        "symbol": symbol, "name": asset["name"], "sector": sector,
        "mode": asset["mode"], "role": role, "method": ROLE_METHODS[role],
        "market": market, "overview": overview, "news": news,
        "action": action, "reason": reason, "buy_gates": buy_gates,
        "sell_triggers": sell_triggers, "relevant_article_count": len(relevant),
        "screened_article_count": len(news), "excluded_article_count": len(news) - len(relevant),
        "independent_source_count": independent_sources,
        "position_shares": held, "position_value": round(current_value, 2),
        "weight_pct": current_weight, "target_pct": target_pct,
        "suggested_max_add_shares": shares if action == "REVIEW_ADD" else 0,
        "review_reduce_shares": sell_ceiling if action == "REVIEW_REDUCE" else 0,
        "planning_stop": round(price * (1 - policy["planning_stop_pct"] / 100), 2),
        "retrieved_at": asset["retrieved_at"],
        "source_note": ("Entirely synthetic demonstration data." if asset["mode"] == "demo"
                        else "Alpha Vantage daily prices, news, and company overview."),
    }


def build_dashboard(assets: list[dict], model: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    portfolio = build_portfolio(assets, model)
    analyses = [analyze_asset(asset, portfolio, now) for asset in assets]
    return {"as_of": now.isoformat(), "mode": assets[0]["mode"] if assets else "demo",
            "portfolio": portfolio, "analyses": analyses,
            "method": "Rule-based research. Sentiment labels are provider metadata, not independently verified facts."}


def answer_question(question: str, analysis: dict, portfolio: dict) -> dict:
    """Return a direct, bounded answer with explicit evidence identifiers."""
    question = question.strip()
    if not 3 <= len(question) <= 500:
        raise ValueError("Enter a question between 3 and 500 characters.")
    lower = question.casefold()
    def mentions(*terms: str) -> bool:
        return any(re.search(r"(?<![a-z])" + re.escape(term) + r"(?![a-z])", lower)
                   for term in terms)
    symbol, market, overview = analysis["symbol"], analysis["market"], analysis["overview"]
    evidence = [
        {"id": "M1", "label": "Daily market data", "as_of": market["as_of"],
         "detail": f"Close ${market['price']:.2f}; 20-day ${market['sma20']:.2f}; 50-day ${market['sma50']:.2f}.",
         "url": None if analysis["mode"] == "demo" else "https://www.alphavantage.co/documentation/"},
        {"id": "P1", "label": "Portfolio model", "as_of": market["as_of"],
         "detail": f"Weight {analysis['weight_pct']:.1f}%; target {analysis['target_pct']:.1f}%; role {analysis['role']}.",
         "url": None},
    ]
    relevant = [item for item in analysis["news"] if item["relevant"]]
    for index, item in enumerate(relevant[:3], 1):
        evidence.append({"id": f"N{index}", "label": item["source"],
                         "as_of": item["published_at"], "detail": item["title"],
                         "url": None if analysis["mode"] == "demo" else item["url"]})
    if mentions("forecast", "predict", "price target", "expected return", "next year", "future price"):
        answer = (f"The loaded evidence cannot forecast {symbol}'s future price or return. "
                  "The historical series and provider snapshot are descriptive only. [M1] [P1]")
        intent = "unsupported"
    elif mentions("buy", "add", "increase", "entry", "purchase"):
        if analysis["action"] == "REVIEW_ADD":
            news_refs = " ".join(f"[N{i}]" for i in range(1, min(len(relevant), 3) + 1))
            answer = (f"{symbol} passes the current {analysis['role'].lower()} add-review rule. "
                      f"The paper-review ceiling is {analysis['suggested_max_add_shares']} shares, "
                      f"subject to updated prices and an explicit order review. [M1] [P1] {news_refs}".strip())
        else:
            failed = [gate["label"] for gate in analysis["buy_gates"] if not gate["passed"]]
            answer = f"Do not advance an add plan for {symbol} under this model. Blocking checks: {', '.join(failed) or 'data hold'}. [M1] [P1]"
        intent = "add"
    elif mentions("sell", "reduce", "exit", "trim"):
        answer = (f"{symbol} has a reduce-review trigger: {', '.join(analysis['sell_triggers'])}. [M1] [P1]"
                  if analysis["action"] == "REVIEW_REDUCE" else
                  f"{symbol} does not meet a reduce-review trigger in the current model. [M1] [P1]")
        intent = "reduce"
    elif mentions("weight", "allocation", "portfolio", "sector", "concentration", "target", "fit", "holding"):
        sector = next((row for row in portfolio["sectors"] if row["sector"] == analysis["sector"]), None)
        role = next((row for row in portfolio["roles"] if row["role"] == analysis["role"]), None)
        exposure = sector["weight_pct"] if sector else 0
        role_weight = role["weight_pct"] if role else 0
        role_target = role["target_pct"] if role else 0
        answer = (f"{symbol} is {analysis['weight_pct']:.1f}% of portfolio value versus a {analysis['target_pct']:.1f}% target. "
                  f"Its {analysis['sector']} sector is {exposure:.1f}% versus a {portfolio['policy']['max_sector_pct']:.1f}% sector cap. "
                  f"The {analysis['role']} sleeve is {role_weight:.1f}% versus a {role_target:.1f}% target. [P1]")
        intent = "allocation"
    elif mentions("news", "catalyst", "event", "headline"):
        answer = (f"{symbol} has {len(relevant)} ticker-tagged articles in the 72-hour relevance window from "
                  f"{analysis['independent_source_count']} named sources. These are event leads, not verified catalysts. "
                  + (" ".join(f"[{item['id']}]" for item in evidence if item["id"].startswith("N")) or "[M1]"))
        intent = "news"
    elif mentions("valuation", "value", "pe", "p/e", "earnings", "revenue", "margin", "dividend"):
        pe, margin = overview.get("pe_ratio"), overview.get("profit_margin")
        evidence.append({"id": "F1", "label": overview.get("source", "Company overview"),
                         "as_of": analysis["retrieved_at"],
                         "detail": f"P/E {pe if pe is not None else 'unavailable'}; profit margin {f'{margin:.1%}' if margin is not None else 'unavailable'}.",
                         "url": None if analysis["mode"] == "demo" else "https://www.alphavantage.co/documentation/"})
        answer = (f"{symbol} has a reported P/E of {pe:.1f}x and profit margin of {margin:.1%}. "
                  "Those fields alone do not establish fair value or an earnings outlook. [F1]"
                  if pe is not None and margin is not None else
                  f"The current source does not provide enough valuation fields to judge {symbol}. [F1]")
        intent = "fundamentals"
    elif mentions("risk", "downside", "volatility", "drawdown", "stop", "trend", "price"):
        answer = (f"Across the observed daily series, {symbol} shows {market['volatility_annualized_pct']:.1f}% "
                  f"annualized volatility and {market['max_drawdown_observed_pct']:.1f}% maximum drawdown. "
                  "These are historical descriptions, not loss bounds. [M1]")
        intent = "risk"
    else:
        answer = (f"The available evidence does not resolve that specific question about {symbol}. "
                  "Ask about allocation, add/reduce conditions, recent ticker-tagged news, fundamentals, or observed risk. [M1] [P1]")
        intent = "unsupported"
    return {"question": question, "symbol": symbol, "intent": intent, "answer": answer,
            "evidence": evidence, "limitations": [
                "The data may be delayed or incomplete; check primary filings and the original article before acting.",
                "This is a research explanation, not an order, return forecast, or personalized recommendation.",
            ]}

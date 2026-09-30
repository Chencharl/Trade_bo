from copy import deepcopy
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from backend.data import DEMO_PORTFOLIO, POLICY, demo_assets, live_assets
from backend.engine import analyze_asset, score_news


class DecisionTests(unittest.TestCase):
    def setUp(self):
        self.assets = demo_assets()
        self.now = datetime.now(timezone.utc)

    def test_three_distinct_outcomes(self):
        outcomes = [analyze_asset(a, DEMO_PORTFOLIO, POLICY, self.now)["action"] for a in self.assets]
        self.assertEqual(outcomes, ["REVIEW_BUY", "REVIEW_SELL", "WAIT"])

    def test_stale_market_blocks_even_sell(self):
        asset = deepcopy(self.assets[1])
        for bar in asset["bars"]:
            bar["date"] = (datetime.fromisoformat(bar["date"]) - timedelta(days=8)).date().isoformat()
        self.assertEqual(analyze_asset(asset, DEMO_PORTFOLIO, POLICY, self.now)["action"], "WAIT")

    def test_duplicate_article_cannot_supply_second_source(self):
        asset = deepcopy(self.assets[0])
        asset["news"][1]["url"] = asset["news"][0]["url"] + "?tracking=1"
        result = analyze_asset(asset, DEMO_PORTFOLIO, POLICY, self.now)
        self.assertEqual(result["action"], "WAIT")
        self.assertFalse(next(g for g in result["gates"] if g["id"] == "news")["passed"])

    def test_unrelated_article_excluded(self):
        news = deepcopy(self.assets[0]["news"])
        news[1]["tickers"] = ["OTHER"]
        result = score_news(news, "ORBT", self.now)
        self.assertEqual(sum(n["relevant"] for n in result), 1)

    def test_syndicated_headline_does_not_count_twice(self):
        asset = deepcopy(self.assets[0])
        asset["news"][1]["title"] = asset["news"][0]["title"]
        self.assertEqual(analyze_asset(asset, DEMO_PORTFOLIO, POLICY, self.now)["action"], "WAIT")

    def test_sell_trace_identifies_actual_trigger(self):
        result = analyze_asset(self.assets[1], DEMO_PORTFOLIO, POLICY, self.now)
        self.assertEqual(result["action"], "REVIEW_SELL")
        self.assertTrue(next(g for g in result["sell_gates"] if g["id"] == "downtrend")["passed"])
        self.assertFalse(next(g for g in result["sell_gates"] if g["id"] == "concentration")["passed"])

    def test_position_cap_reduces_size(self):
        portfolio = deepcopy(DEMO_PORTFOLIO)
        portfolio["positions"]["ORBT"] = 130
        result = analyze_asset(self.assets[0], portfolio, POLICY, self.now)
        self.assertLess(result["suggested_max_shares"], 20)

    def test_no_cash_blocks_buy(self):
        portfolio = deepcopy(DEMO_PORTFOLIO)
        portfolio["cash"] = 19000
        result = analyze_asset(self.assets[0], portfolio, POLICY, self.now)
        self.assertEqual(result["action"], "WAIT")

    def test_live_adapter_rejects_non_us_listing(self):
        response = {"bestMatches": [{"1. symbol": "AAPL", "2. name": "Apple",
                                     "3. type": "Equity", "4. region": "United Kingdom"}]}
        with patch.dict("os.environ", {"ALPHA_VANTAGE_API_KEY": "test-key", "TRADEBOT_SYMBOLS": "AAPL"}), \
             patch("backend.data._query", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "美股交易所区域核验"):
                live_assets()


if __name__ == "__main__":
    unittest.main()

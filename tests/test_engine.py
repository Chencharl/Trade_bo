"""Decision-contract tests for the illustrative US-equity research desk."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from backend.data import _wait_for_provider_slot, default_model, demo_assets, live_assets, validate_symbol
from backend.engine import analyze_asset, answer_question, build_dashboard, build_portfolio, score_news


class DecisionTests(unittest.TestCase):
    def setUp(self):
        self.assets = demo_assets()
        self.model = default_model(self.assets)
        self.now = datetime.now(timezone.utc)

    def board(self):
        return build_dashboard(self.assets, self.model, self.now)

    def test_demo_has_distinct_add_reduce_and_hold_outcomes(self):
        actions = {row["symbol"]: row["action"] for row in self.board()["analyses"]}
        self.assertEqual(actions["ORBT"], "REVIEW_ADD")
        self.assertEqual(actions["COVE"], "REVIEW_REDUCE")
        self.assertEqual(actions["NOVA"], "HOLD")

    def test_weights_derive_from_cash_shares_and_prices(self):
        portfolio = self.board()["portfolio"]
        values = sum(row["value"] for row in portfolio["positions"])
        self.assertAlmostEqual(portfolio["nav"], self.model["cash"] + values, places=2)
        self.assertAlmostEqual(portfolio["cash_weight_pct"] + sum(row["weight_pct"] for row in portfolio["positions"]), 100, delta=.05)
        self.assertGreater(portfolio["sectors"][0]["weight_pct"], 0)
        self.assertAlmostEqual(sum(row["target_pct"] for row in portfolio["roles"]) + portfolio["cash_target_pct"], 100)
        self.assertAlmostEqual(sum(row["weight_pct"] for row in portfolio["roles"]) + portfolio["cash_weight_pct"], 100, delta=.05)

    def test_target_and_share_validation(self):
        model = deepcopy(self.model)
        model["targets"]["CASH"] += 1
        with self.assertRaisesRegex(ValueError, "sum to 100"):
            build_portfolio(self.assets, model)
        model = deepcopy(self.model)
        model["holdings"][0]["shares"] = 1.5
        with self.assertRaisesRegex(ValueError, "whole number"):
            build_portfolio(self.assets, model)

    def test_unheld_target_is_in_sector_plan(self):
        model = deepcopy(self.model)
        model["holdings"] = [h for h in model["holdings"] if h["symbol"] != "ORBT"]
        portfolio = build_portfolio(self.assets, model)
        technology = next(s for s in portfolio["sectors"] if s["sector"] == "Technology")
        self.assertEqual(technology["weight_pct"], 0)
        self.assertEqual(technology["target_pct"], 18)

    def test_stale_price_blocks_both_trade_reviews(self):
        for symbol in ("ORBT", "COVE"):
            asset = deepcopy(next(a for a in self.assets if a["symbol"] == symbol))
            for bar in asset["bars"]:
                bar["date"] = (datetime.fromisoformat(bar["date"]) - timedelta(days=8)).date().isoformat()
            portfolio = build_portfolio(self.assets, self.model)
            self.assertEqual(analyze_asset(asset, portfolio, self.now)["action"], "DATA_HOLD")

    def test_duplicate_or_unrelated_news_cannot_satisfy_tactical_entry(self):
        asset = deepcopy(self.assets[0])
        asset["news"][1]["url"] = asset["news"][0]["url"] + "?tracking=1"
        result = analyze_asset(asset, self.board()["portfolio"], self.now)
        self.assertEqual(result["action"], "HOLD")
        self.assertFalse(next(g for g in result["buy_gates"] if g["id"] == "news")["passed"])
        news = deepcopy(self.assets[0]["news"])
        news[1]["tickers"] = ["OTHER"]
        self.assertEqual(sum(n["relevant"] for n in score_news(news, "ORBT", "Orbit Systems", self.now)), 1)

    def test_provider_ticker_tag_alone_does_not_make_news_relevant(self):
        article = deepcopy(self.assets[0]["news"][0])
        article["tickers"] = ["AAPL"]
        article["ticker_relevance_score"] = .95
        result = score_news([article], "AAPL", "Apple Inc", self.now)[0]
        self.assertFalse(result["relevant"])
        self.assertEqual(result["exclusion_reason"], "Issuer absent from headline")
        article["title"] = "Apple announces a product update"
        article["ticker_relevance_score"] = .6
        result = score_news([article], "AAPL", "Apple Inc", self.now)[0]
        self.assertFalse(result["relevant"])
        self.assertEqual(result["exclusion_reason"], "Low provider ticker score")

    def test_cash_reserve_blocks_add_and_policy_breach_triggers_reduce(self):
        model = deepcopy(self.model)
        model["cash"] = 0
        board = build_dashboard(self.assets, model, self.now)
        self.assertEqual(next(a for a in board["analyses"] if a["symbol"] == "ORBT")["action"], "HOLD")
        cove = next(a for a in board["analyses"] if a["symbol"] == "COVE")
        self.assertEqual(cove["action"], "REVIEW_REDUCE")
        self.assertGreater(cove["review_reduce_shares"], 0)

    def test_unclassified_sector_blocks_add(self):
        asset = deepcopy(self.assets[0])
        asset["sector"] = "Unclassified"
        result = analyze_asset(asset, self.board()["portfolio"], self.now)
        self.assertEqual(result["action"], "HOLD")
        self.assertFalse(next(g for g in result["buy_gates"] if g["id"] == "classification")["passed"])

    def test_question_answers_are_bounded_and_cite_evidence(self):
        board = self.board()
        orbt = next(a for a in board["analyses"] if a["symbol"] == "ORBT")
        answer = answer_question("Can we add to ORBT?", orbt, board["portfolio"])
        self.assertEqual(answer["intent"], "add")
        self.assertIn("[M1] [P1]", answer["answer"])
        allocation = answer_question("How does ORBT fit our portfolio?", orbt, board["portfolio"])
        self.assertEqual(allocation["intent"], "allocation")
        self.assertIn("Tactical sleeve", allocation["answer"])
        unknown = answer_question("What will ORBT return next year?", orbt, board["portfolio"])
        self.assertEqual(unknown["intent"], "unsupported")
        self.assertIn("cannot forecast", unknown["answer"])

    def test_provider_rejects_non_us_listing(self):
        self.assertEqual(validate_symbol("brk.b"), "BRK.B")
        response = {"bestMatches": [{"1. symbol": "AAPL", "2. name": "Apple",
                                     "3. type": "Equity", "4. region": "United Kingdom"}]}
        with patch.dict("os.environ", {"ALPHA_VANTAGE_API_KEY": "test-key"}), \
             patch("backend.data._query", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "US-listed equity"):
                live_assets(["AAPL"])

    def test_single_ticker_example_target_respects_position_cap(self):
        asset = deepcopy(self.assets[0])
        asset["mode"] = "live"
        model = default_model([asset])
        self.assertEqual(model["targets"], {"ORBT": 20.0, "CASH": 80.0})
        self.assertLessEqual(model["targets"]["ORBT"], model["policy"]["max_position_pct"])

    def test_provider_calls_are_spaced_beyond_one_second(self):
        with patch("backend.data._LAST_REQUEST_AT", float("-inf")), \
             patch("backend.data.time.monotonic", side_effect=[100.0, 100.0, 100.2, 101.45]), \
             patch("backend.data.time.sleep") as sleep:
            _wait_for_provider_slot()
            _wait_for_provider_slot()
        sleep.assert_called_once()
        self.assertGreaterEqual(sleep.call_args.args[0], 1.0)


if __name__ == "__main__":
    unittest.main()

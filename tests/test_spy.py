import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from spy_study import replay, CAPITAL


class DailySpyTest(unittest.TestCase):
    def test_no_overnight_gain_before_buy_and_exit_at_open(self):
        rows = [
            ("2020-01-02", 100, 100, 0, ""),
            ("2020-01-03", 120, 120, 0, ""),
            ("2020-01-06", 110, 200, 0, ""),
        ]
        stats, marks, fills = replay(rows, 1, [1, 0])
        shares = CAPITAL / (120 * 1.0002 * 1.0001)
        self.assertAlmostEqual(marks[0][1], shares * 120)
        self.assertAlmostEqual(stats["ending"], shares * 110 * 0.9998 * 0.9999)
        self.assertEqual(
            [(f["signal"], f["date"]) for f in fills],
            [("2020-01-02", "2020-01-03"), ("2020-01-03", "2020-01-06")],
        )

    def test_ex_date_entitlement_survives_exit_and_payment_waits(self):
        rows = [
            ("2020-01-02", 100, 100, 0, ""),
            ("2020-01-03", 100, 100, 0, ""),
            ("2020-01-06", 98, 98, 2, "2020-01-07"),
            ("2020-01-07", 100, 100, 0, ""),
            ("2020-01-08", 100, 100, 0, ""),
        ]
        stats, marks, orders = replay(rows, 1, [1, 0, 1, 1])
        d = 2 * orders[0]["quantity"]
        self.assertAlmostEqual(stats["dividends"], d)
        self.assertAlmostEqual(
            marks[1][1],
            orders[1]["quantity"] * orders[1]["fill"] - orders[1]["commission"] + d,
        )
        self.assertEqual(orders[-1]["side"], "reinvest")
        self.assertAlmostEqual(
            orders[-1]["quantity"] * orders[-1]["fill"] + orders[-1]["commission"], d
        )
        no_entitlement, _, _ = replay(rows, 1, [0, 1, 1, 1])
        self.assertEqual(no_entitlement["dividends"], 0)

    def test_public_receipts_and_frozen_dev_windows(self):
        r = json.loads((ROOT / "public/research/spy-daily.json").read_text())
        f = json.loads((ROOT / "public/research/spy-model.json").read_text())
        self.assertEqual(len(f["development"]["folds"]), 12)
        self.assertLess(f["model"]["lastLabel"], r["start"])
        self.assertEqual([len(b) for b in f["model"]["bias"]], [16, 8, 1])
        for fold in f["development"]["folds"]:
            self.assertLess(fold["lastLabel"], fold["start"])
            self.assertLess(fold["end"], r["start"])
        for rule, orders in r["trades"].items():
            stats = r["metrics"][rule]
            self.assertEqual(stats["orders"], len(orders))
            self.assertAlmostEqual(
                sum(o["commission"] for o in orders), stats["commission"]
            )
            self.assertAlmostEqual(
                sum(o["slippage"] for o in orders), stats["slippage"]
            )
            self.assertAlmostEqual(
                stats["total"] + 1, math.prod(1 + y["net"][rule] for y in r["annual"])
            )
            self.assertAlmostEqual(r["chart"][-1]["wealth"][rule], stats["ending"])
            for o in orders:
                self.assertLess(o["signal"], o["date"])
                self.assertAlmostEqual(
                    o["fill"] / o["open"], 0.9998 if o["side"] == "sell" else 1.0002
                )

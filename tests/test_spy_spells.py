import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from spy_attribution import attribution, cash_spells, window_moves
from spy_study import replay


class SpySpellTest(unittest.TestCase):
    def test_first_and_last_cash_days_and_ex_date(self):
        rows = [
            ("2020-01-02", 80, 85, 0, ""),
            ("2020-01-03", 100, 96, 8, "2020-01-07"),
            ("2020-01-06", 90, 90, 0, ""),
            ("2020-01-07", 92, 95, 2, "2020-01-08"),
            ("2020-01-08", 110, 100, 0, ""),
        ]
        targets = dict(model=[0, 0, 1, 0], trend=[1] * 4)
        marks, orders = {}, {}
        for k, path in targets.items():
            _, marks[k], orders[k] = replay(rows, 1, path)
        events = attribution(rows, 1, targets, marks, orders)
        early, final = events["model"]
        self.assertFalse(events["trend"])
        self.assertEqual(list(cash_spells([0, 0, 0])), [(0, 3)])
        self.assertEqual((early["days"], final["reentry"]), (2, None))
        self.assertAlmostEqual(early["avoided"], 0.10)
        self.assertAlmostEqual(early["missed"], 0.04)
        self.assertAlmostEqual(final["avoided"], 10 / 110)
        self.assertEqual(final["missed"], 0)
        self.assertAlmostEqual(
            early["model"]["commission"], orders["model"][0]["commission"]
        )
        self.assertAlmostEqual(
            sum(s["endingEffect"] for s in events["model"]),
            marks["model"][-1][1] - marks["trend"][-1][1],
        )
        self.assertEqual(window_moves(rows[1:], 0, 1), (0.1, 0))

    def test_public_spells_add_up_to_published_accounts(self):
        path = ROOT / "public/research/spy-daily.json"
        report = json.loads(path.read_bytes())
        study = json.loads((path.parent / "spy-spells.json").read_bytes())
        self.assertEqual(
            study["sourceHash"], hashlib.sha256(path.read_bytes()).hexdigest()
        )
        days = [row[0] for row in study["daily"]]
        self.assertEqual(days, sorted(set(days)))
        self.assertEqual(
            (len(days), days[0], days[-1]),
            (report["sessions"], report["start"], report["end"]),
        )
        self.assertEqual(study["rules"], ["model", "original", "trend", "market"])
        for k, events in study["spells"].items():
            stats = report["metrics"][k]
            hold = report["metrics"]["market"]
            self.assertEqual(
                sum(s["days"] for s in events), len(days) - stats["stockDays"]
            )
            self.assertEqual(
                [s["exit"] for s in events],
                [o["date"] for o in report["trades"][k] if o["side"] == "sell"],
            )
            self.assertAlmostEqual(
                sum(s["endingEffect"] for s in events), stats["ending"] - hold["ending"]
            )
            self.assertAlmostEqual(
                sum(s["drawdownEffect"] for s in events),
                stats["drawdown"] - hold["drawdown"],
            )
            for s in events:
                orders = [
                    o
                    for o in report["trades"][k]
                    if s["exit"] <= o["date"] <= (s["reentry"] or days[-1])
                ]
                self.assertEqual(
                    s["days"],
                    (days.index(s["reentry"]) if s["reentry"] else len(days))
                    - days.index(s["exit"]),
                )
                for cost in ("commission", "slippage"):
                    self.assertAlmostEqual(s[k][cost], sum(o[cost] for o in orders))

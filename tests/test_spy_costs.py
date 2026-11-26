import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from spy_costs import crossing


class CostTest(unittest.TestCase):
    def test_slice_endpoints_and_nonmonotone_data(self):
        def solve(g):
            axis = [0, 1, 2]
            return crossing(axis, [g(x) for x in axis], g)

        for target in (0, 1.125, 2):
            row = solve(lambda x: target - x)
            self.assertLessEqual(row["low"], target)
            self.assertGreaterEqual(row["high"], target)
            self.assertLessEqual(row["high"] - row["low"], 1e-6)
        self.assertEqual(solve(lambda x: -1 - x)["status"], "behind-at-zero")
        self.assertEqual(solve(lambda x: 3 - x)["status"], "ahead-at-limit")
        with self.assertRaises(ValueError):
            solve(lambda x: (x - 1) ** 2)

    def test_public_frozen_baseline_and_thresholds(self):
        base = ROOT / "public" / "research"
        path = base / "spy-daily.json"
        r = json.loads(path.read_bytes())
        data = json.loads((base / "spy-costs.json").read_bytes())
        self.assertEqual(
            data["sourceHash"], hashlib.sha256(path.read_bytes()).hexdigest()
        )
        self.assertEqual(data["axisBp"], [i / 4 for i in range(25)])
        self.assertEqual((data["modelExits"], data["cashDays"]), (64, 69))
        self.assertEqual(
            (data["start"], data["end"], data["sessions"]),
            (r["start"], r["end"], r["sessions"]),
        )
        self.assertEqual(data["grid"][4][8], data["mixed"][12])
        for k in ("model", "trend", "market"):
            self.assertEqual(data["grid"][4][8][k], r["metrics"][k]["ending"])
        ax = data["axisBp"]

        def check(points, cuts):
            self.assertEqual(len(points), len(ax))
            for k in ("trend", "market"):
                gaps = [p["model"] - p[k] for p in points]
                self.assertTrue(all(a > b for a, b in zip(gaps, gaps[1:])))
                c = cuts[k]
                if c["status"] == "crossing":
                    lo, hi = c["low"], c["high"]
                    self.assertTrue(0 <= lo <= hi <= ax[-1] and hi - lo <= 1e-6)
                    self.assertTrue(all(gap > 0 for x, gap in zip(ax, gaps) if x < lo))
                    self.assertTrue(all(gap < 0 for x, gap in zip(ax, gaps) if x > hi))
                elif c["status"] == "behind-at-zero":
                    self.assertLess(gaps[0], 0)
                else:
                    self.assertEqual(c["status"], "ahead-at-limit")
                    self.assertGreater(gaps[-1], 0)

        for i in range(len(ax)):
            check(data["grid"][i], data["cutoffs"]["slip"][i])
            check([row[i] for row in data["grid"]], data["cutoffs"]["fee"][i])
        check(data["mixed"], data["cutoffs"]["mixed"])

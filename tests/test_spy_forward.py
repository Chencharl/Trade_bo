import copy
import importlib.util
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import spy_forward as engine


UTC = timezone.utc


def day(s):
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


@unittest.skipUnless(
    importlib.util.find_spec("exchange_calendars")
    and importlib.util.find_spec("numpy"),
    "forward research dependencies",
)
class ForwardTimingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from exchange_calendars import get_calendar

        cls.cal = get_calendar("XNYS")
        cls.seed, cls.model = engine.locked_inputs()

    def observe(self, events, now, prices):
        tasks = engine.due(self.cal, events, now)
        src = dict(quoteThrough=engine.iso(now), prices="fixture", issuer="fixture")
        return engine.append_events(
            self.cal, events, tasks, prices, src, now, None, self.seed, self.model
        )

    def test_genesis_and_calendar(self):
        start = json.loads(
            (ROOT / "public/research/spy-forward-start.json").read_text()
        )
        engine.verify(self.cal, start, self.seed, self.model)
        self.assertEqual(engine.due(self.cal, [], day("2026-11-30T14:49:00")), [])
        self.assertEqual(engine.market_time(self.cal, "2026-11-27", "close").hour, 18)
        self.assertEqual(engine.market_time(self.cal, "2027-06-01", "open").hour, 13)

    def test_pending_close_fill_delay_and_retries(self):
        bars = {
            d: (d, p, p + 2, 0, "")
            for d, p in (("2026-11-30", 730), ("2026-12-01", 740))
        }
        monday = self.observe([], day("2026-11-30T21:27"), bars)
        self.assertEqual(len(monday), 2)
        self.assertTrue(monday[-1]["signal"])
        self.assertEqual(monday[-1]["nextOpenAt"], "2026-12-01T14:30:00+00:00")
        self.assertEqual(engine.summarize(monday)["fills"], [])
        repeat = self.observe(monday, day("2026-11-30T22:27"), bars)
        self.assertEqual(monday, repeat)
        opened = self.observe(monday, day("2026-12-01T15:20"), bars)
        book = engine.report(self.cal, opened)
        engine.verify(self.cal, book, self.seed, self.model)
        self.assertEqual(
            book["accounts"]["model"]["target"],
            monday[-1]["signal"]["targets"]["model"],
        )
        self.assertTrue(
            all(
                r["marketAt"] == monday[-1]["nextOpenAt"]
                and r["recordedAt"] == opened[-1]["recordedAt"]
                for r in book["fills"]
            )
        )
        engine.guard(engine.report(self.cal, monday), book, day("2026-12-01T16:00"))
        corrupted = copy.deepcopy(book)
        corrupted["events"][1]["signal"]["probability"] += 0.01
        with self.assertRaises(ValueError):
            engine.verify(self.cal, corrupted, self.seed, self.model)
        with self.assertRaises(ValueError):
            engine.guard(
                engine.report(self.cal, monday), corrupted, day("2026-12-01T16:00")
            )

    def test_late_signal_never_reconstructed(self):
        bars = {d: (d, 730, 732, 0, "") for d in ("2026-11-30", "2026-12-01")}
        now = day("2026-12-01T16:00")
        events = self.observe([], now, bars)
        book = engine.report(self.cal, events)
        self.assertIsNone(events[1]["signal"])
        self.assertEqual([r["rule"] for r in book["fills"]], ["market"])
        engine.verify(self.cal, book, self.seed, self.model)
        ontime = self.observe([], day("2026-11-30T21:40"), bars)
        with self.assertRaises(ValueError):
            engine.guard(
                engine.report(self.cal, []), engine.report(self.cal, ontime), now
            )
        with self.assertRaises(ValueError):
            self.observe(
                [],
                day("2026-11-30T22:00"),
                {"2026-11-30": ("2026-11-30", 730, None, 0, "")},
            )

    def test_provider_watermark(self):
        now = day("2026-11-30T21:30")
        b = {"2026-11-30": ("2026-11-30", 730, 732, 0, "")}
        todo = engine.due(self.cal, [], now)
        with self.assertRaises(ValueError):
            engine.append_events(
                self.cal,
                [],
                todo,
                b,
                {"quoteThrough": "2026-11-30T15:00:00+00:00"},
                now,
                None,
                self.seed,
                self.model,
            )


class ForwardAccountsTest(unittest.TestCase):
    def test_net_spells_and_dividends_at_both_boundaries(self):
        # Trade long on day 2, exit at 100, sit out a 10-point drop and
        # a 7-point dividend-inclusive recovery, then buy back at 95.
        dates = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]
        ops = [102, 100, 100, 90, 95]
        closes = [102, 101, 96, 92, 98]
        events = []
        for i, d in enumerate(dates):
            stamp = d + "T14:30:00+00:00"
            events.append(
                dict(
                    date=d,
                    phase="open",
                    marketAt=stamp,
                    recordedAt=stamp,
                    level=ops[i],
                    distribution=2 if i == 4 else 0,
                    payable="2026-12-08" if i == 4 else "",
                )
            )
            if i < 4:
                signal = dict(targets=dict(model=int(i in (0, 3)), trend=1, market=1))
                events.append(
                    dict(
                        date=d,
                        phase="close",
                        recordedAt=d + "T21:30:00+00:00",
                        level=closes[i],
                        signal=signal,
                        nextOpenAt=dates[i + 1] + "T14:30:00+00:00",
                    )
                )
        active = engine.summarize(events[:6])["episodes"][0]
        self.assertIsNone(active["reentry"])
        self.assertAlmostEqual(active["avoided"], 0.04)
        r = engine.summarize(events)
        s = r["episodes"][0]
        self.assertEqual((s["days"], s["exit"], s["reentry"]), (2, dates[2], dates[4]))
        self.assertAlmostEqual(s["avoided"], 0.10)
        self.assertAlmostEqual(s["missed"], 0.07)
        self.assertAlmostEqual(s["windows"]["market"]["net"], -0.03)
        self.assertAlmostEqual(
            s["windows"]["model"]["net"], (0.9998 * 0.9999) / (1.0002 * 1.0001) - 1
        )
        self.assertGreater(
            s["windows"]["model"]["commission"] + s["windows"]["model"]["slippage"], 0
        )
        expected = 10000 / (1.0002 * 1.0001) * 0.9998 * 0.9999 / (1.0002 * 1.0001)
        self.assertAlmostEqual(r["accounts"]["model"]["ending"], expected)
        for fill in r["fills"]:
            self.assertAlmostEqual(fill["fillPrice"] * fill["shares"], fill["notional"])
        self.assertEqual(r["accounts"]["market"], r["accounts"]["trend"])
        missed = copy.deepcopy(events)
        missed[7]["signal"] = None
        self.assertIsNone(engine.summarize(missed)["episodes"][0]["reentry"])

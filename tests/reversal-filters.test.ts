import { strict as assert } from 'node:assert'
import test from 'node:test'
import { reversalFilterPlan, studyReversalFilters, type Variant } from '../src/lab/reversalFilters'
import type { MonthlyRow } from '../src/lab/engine'

function fixture(n = 257): MonthlyRow[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2000, i, 1)).toISOString().slice(0, 7),
    marketReturn:
      (0.01 + 0.075 * Math.sin(i * 0.73) + 0.04 * Math.cos(i * 0.19)) * (1 + (i % 80) / 55),
    cashReturn: 0.001,
  }))
}

test('training observations exclude test returns and positions ignore the current and future return', () => {
  const rows = fixture(),
    original = reversalFilterPlan(rows)
  for (const boundary of [133, 141, 145, 169, 242]) {
    const changed = rows.map((r, i) =>
      i < boundary ? r : { ...r, marketReturn: i % 2 ? 0.3 : -0.25 },
    )
    const revised = reversalFilterPlan(changed)
    const seen = boundary - 133 + 1
    for (const id of Object.keys(original.weights) as Variant[])
      assert.deepEqual(original.weights[id].slice(0, seen), revised.weights[id].slice(0, seen))
    const fold = Math.floor((boundary - 133) / 12)
    assert.deepEqual(original.folds.slice(0, fold + 1), revised.folds.slice(0, fold + 1))
  }
  const vols = original.signals
    .slice(0, 120)
    .map((s) => s.vol)
    .sort((a, b) => a - b)
  assert.equal(original.folds[0].cutoff, (vols[59] + vols[60]) / 2)
  assert.equal(original.folds.at(-1)!.end, rows.length)
  assert.throws(() => reversalFilterPlan(rows.slice(0, 133)), /test month/)
})

test('each gate can only veto a fresh cut; cash-spell decisions survive fold changes', () => {
  const p = reversalFilterPlan(fixture())
  let boundaryChecks = 0,
    vetoed = 0,
    admitted = 0
  for (let j = 0; j < p.weights.original.length; j++) {
    const s = p.signals[120 + j],
      prev = p.signals[119 + j]
    for (const id of ['trend', 'vol', 'both'] as const) {
      const w = p.weights[id][j]
      if (s.target === 1) assert.equal(w, 1)
      else if (prev.target === 0) {
        assert.equal(w, j === 0 ? prev.target : p.weights[id][j - 1])
        if (j > 0 && j % 12 === 0) boundaryChecks++
      } else {
        const high = s.vol > p.folds[Math.floor(j / 12)].cutoff
        const gate = id === 'trend' ? s.weak : id === 'vol' ? high : s.weak && high
        assert.equal(w, gate ? 0 : 1)
        if (gate) admitted++
        else vetoed++
      }
    }
  }
  assert.ok(boundaryChecks > 0 && vetoed > 0 && admitted > 0)
})

test('OOS wealth reconciles with stitched fold returns and original signal history stays descriptive', () => {
  const rows = fixture()
  const r = studyReversalFilters(rows)
  assert.equal(r.months, rows.length - 133)
  assert.equal(r.folds[0].trainEnd, rows[132].date)
  assert.equal(r.folds.at(-1)!.end, rows.at(-1)!.date)
  for (const rule of r.rules) {
    const end = r.folds.reduce((w, f) => w * (1 + f.returns[rule.id]), 100)
    assert.ok(Math.abs(end - rule.ending) < 1e-8)
  }
  const market = r.rules.find((x) => x.id === 'market')!
  assert.ok(
    Math.abs(market.ending - rows.slice(133).reduce((w, x) => w * (1 + x.marketReturn), 99.9)) <
      1e-8,
  )
  assert.equal(market.feesPaid, 0.1)
  assert.ok(
    r.alarms.filter((a) => a.date < r.start).every((a) => a.admitted === null && a.cutoff === null),
  )
  const flat = studyReversalFilters(rows.map((x) => ({ ...x, marketReturn: 0.01 })))
  assert.ok(
    flat.rules.every(
      (x) => x.medianLead === null && x.precision === null && x.reboundVsMarket === null,
    ),
  )
})

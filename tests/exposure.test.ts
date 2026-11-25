import test from 'node:test'
import assert from 'node:assert/strict'
import { exposurePlan, studyExposure, type ExposureId } from '../src/lab/exposureStudy'
import type { MonthlyRow } from '../src/lab/engine'
const rows = Array.from({ length: 392 }, (_, i): MonthlyRow => ({
  date: new Date(Date.UTC(1980, i, 1)).toISOString().slice(0, 7),
  marketReturn: 0.012 + Math.sin(i * 0.61) * 0.11,
  cashReturn: 0.001,
}))
test('fixed targets use only elapsed opening weights and stay frozen through the entire next fold', () => {
  const base = exposurePlan(rows)
  for (const first of [133, 145, 253, 385]) {
    const future = exposurePlan(
      rows.map((r, i) => (i < first ? r : { ...r, marketReturn: -0.035 })),
    )
    const k = (first - base.start) / 12,
      fold = base.means[k]
    assert.deepEqual(future.means.slice(0, k + 1), base.means.slice(0, k + 1))
    for (const [rule, mix] of [
      ['original', 'originalMix'],
      ['trend', 'trendMix'],
    ] as const) {
      if (first >= 253)
        assert.equal(
          fold[rule],
          base.schedules[rule]
            .slice(first - base.start - 120, first - base.start)
            .reduce((a, b) => a + b, 0) / 120,
        )
      assert.ok(
        future.schedules[mix]
          .slice(first - base.start, fold.end - base.start)
          .every((w) => w === fold[rule]),
      )
    }
  }
})
test('the two gaps reconcile with total uplift and stitched folds reproduce continuous ending wealth', () => {
  const r = studyExposure(rows)
  for (const a of [r.net, r.gross]) assert.ok(Math.abs(a.total - a.residual - a.allocation) < 1e-12)
  for (const id of Object.keys(r.metrics) as ExposureId[]) {
    const wealth = r.folds.reduce((w, f) => w * (1 + f.returns[id]), 100)
    assert.ok(Math.abs(wealth / r.metrics[id].ending - 1) < 1e-12)
    assert.equal(r.chart[0].values[id], 100)
    assert.equal(r.chart.at(-1)!.values[id], r.metrics[id].ending)
  }
  const flat = studyExposure(rows.map((r) => ({ ...r, marketReturn: 0, cashReturn: 0 })))
  assert.equal(flat.reboundMonths, 0)
  assert.equal(flat.metrics.trend.reboundVsMarket, null)
  assert.ok(flat.chart.every((p) => Number.isFinite(p.values.trendMix)))
})

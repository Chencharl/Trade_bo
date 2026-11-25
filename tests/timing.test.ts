import test from 'node:test'
import assert from 'node:assert/strict'
import { distribution, foldPaths, studyTiming } from '../src/lab/timingStudy'
import { studyExposure } from '../src/lab/exposureStudy'
import type { MonthlyRow } from '../src/lab/engine'

function signature(seq: number[], prior: number) {
  return seq
    .map((v, i) => 3 * (i ? seq[i - 1] : prior) + v)
    .sort()
    .join(',')
}
test('admissible joint schedules agree with exhaustive enumeration, including boundary entries', () => {
  const seq = [2, 2, 1, 2, 0, 0],
    incoming = 0
  const brute = Array.from({ length: 3 ** seq.length }, (_, i) =>
    i.toString(3).padStart(seq.length, '0').split('').map(Number),
  ).filter((s) => s.at(-1) === seq.at(-1) && signature(s, incoming) === signature(seq, incoming))
  assert.ok(brute.length > 1)
  assert.deepEqual(foldPaths(seq, incoming), brute)
  assert.deepEqual(foldPaths([1, 1], 1), [[1, 1]])
  assert.throws(() => foldPaths([], 0))
})
test('favorable ranks give ties half credit, tail counts include ties, smaller drawdowns rank higher', () => {
  const x = distribution([0.1, 0.2, 0.2, 0.3], 0.2, false)
  assert.deepEqual([x.better, x.ties, x.matched, x.percentile, x.p], [1, 2, 3, 50, 0.8])
  assert.equal(distribution([0.1, 0.2, 0.3], 0.05, true).p, 0.25)
  const all = distribution([0, 0, 0], 0, true)
  assert.deepEqual([all.matched, all.percentile, all.p, all.bins[0]], [3, 50, 1, 3])
})
test('timing endpoints reproduce exposure accounting, future perturbations preserve completed fold supports', () => {
  const rows: MonthlyRow[] = Array.from({ length: 185 }, (_, i) => ({
    date: new Date(Date.UTC(1980, i, 1)).toISOString().slice(0, 7),
    marketReturn: Math.sin(i * 0.65) * 0.105 + 0.007,
    cashReturn: 0.002,
  }))
  const a = studyTiming(rows, () => 0, 8),
    previous = studyExposure(rows)
  assert.ok(Math.abs(a.actual.residual - previous.gross.residual) < 1e-12)
  assert.equal(a.actual.trend.net, previous.metrics.trend.net)
  assert.equal(a.folds.at(-1)!.months, 4)
  const changed = studyTiming(
    rows.map((r, i) => (i >= 157 ? { ...r, marketReturn: -0.12 } : r)),
    () => 0,
    8,
  )
  assert.deepEqual(a.folds.slice(0, 2), changed.folds.slice(0, 2))
  const flat = studyTiming(
    rows.map((r) => ({ ...r, marketReturn: 0, cashReturn: 0 })),
    () => 0,
    8,
  )
  assert.ok(flat.folds.every((f) => f.choices === 1))
  assert.equal(flat.results.residual.ties, 8)
})

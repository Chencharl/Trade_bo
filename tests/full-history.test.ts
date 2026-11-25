import { strict as assert } from 'node:assert'
import test from 'node:test'
import { marketEpisodes, scoreCuts, studyHistory } from '../src/lab/fullHistory'

function observations(returns: number[]) {
  return returns.map((marketReturn, i) => ({
    date: new Date(Date.UTC(1990, i, 1)).toISOString().slice(0, 7),
    marketReturn,
    cashReturn: 0.001,
  }))
}
const event = (onset: number, breach = onset + 1) => ({
  onset,
  breach,
  trough: breach,
  recovery: breach + 1,
  depth: 0.17,
})

test('a high-water spell combines multiple dips and preserves an unresolved right edge', () => {
  const result = marketEpisodes(observations([0.1, -0.1, -0.1, 0.1, -0.2, 0.5, -0.01]))
  assert.equal(result.episodes.length, 1)
  assert.deepEqual(
    { ...result.episodes[0], depth: 0 },
    { onset: 1, breach: 2, trough: 4, recovery: 5, depth: 0 },
  )
  assert.equal(result.unresolvedOnset, 6)
  const open = marketEpisodes(observations([-0.15, 0.03]))
  assert.deepEqual(
    open.episodes.map((e) => [e.onset, e.breach, e.trough, e.recovery]),
    [[0, 0, 0, null]],
  )
  assert.equal(open.unresolvedOnset, null)
})

test('lead, same-opening, already-defensive, late and withdrawn cuts have distinct accounting', () => {
  const weights = Array<number>(53).fill(1)
  for (const [a, b] of [
    [2, 3],
    [8, 12],
    [16, 17],
    [20, 21],
    [28, 39],
    [42, 43],
    [51, 52],
  ]) {
    weights.fill(0, a, b + 1)
  }
  const score = scoreCuts(
    weights,
    0,
    [event(10), event(16), event(19, 21), event(38), event(46)],
    null,
    'half',
  )
  assert.deepEqual(
    score.matches.map((m) => [m.status, m.lead, m.cut]),
    [
      ['Early', 2, 8],
      ['At onset', 0, 16],
      ['After onset', null, 20],
      ['Already defensive', null, 28],
      ['No cut by breach', null, null],
    ],
  )
  assert.deepEqual([score.early, score.atOnset, score.missed, score.medianLead], [1, 1, 3, 2])
  assert.deepEqual(score.falseAlarms, [2, 20, 28, 42])
  assert.deepEqual(score.unscored, [51])
  assert.equal(score.precision, 2 / 6)
})

test('one alert can match one onset and cannot receive credit after exposure is restored', () => {
  const w = Array<number>(32).fill(1)
  w.fill(0, 7, 16)
  w.fill(0, 20, 21)
  const s = scoreCuts(w, 0, [event(9), event(13), event(22)], null, 'half')
  assert.deepEqual(
    s.matches.map((m) => m.status),
    ['Early', 'Already defensive', 'No cut by breach'],
  )
  assert.equal(s.early, 1)
  assert.deepEqual(s.falseAlarms, [20])
})

test('initial exposure, unequal thresholds, incomplete events and an unqualified tail', () => {
  const weights = Array<number>(24).fill(1)
  weights.fill(0.7, 4, 9)
  weights.fill(0.5, 12)
  const e = [event(7), event(8)]
  assert.deepEqual(scoreCuts(weights, 0, e, 16, 'half').unscored, [12])
  const partial = scoreCuts(weights, 0, e, 16, 'partial')
  assert.deepEqual(
    partial.matches.map((m) => m.lead),
    [3, null],
  )
  assert.deepEqual(partial.unscored, [12])
  for (const level of [0, 0.6, 1]) {
    const constant = scoreCuts(
      weights.map(() => level),
      0,
      e,
      null,
      'half',
    )
    assert.equal(constant.early, 0)
    assert.deepEqual(constant.falseAlarms, [])
    assert.equal(constant.medianLead, null)
    assert.equal(constant.precision, null)
  }
  const boundary = Array<number>(20).fill(1)
  boundary.fill(0, 2, 5)
  assert.equal(scoreCuts(boundary, 0, [event(4)], null, 'half').matches.length, 0)
  assert.deepEqual(scoreCuts(boundary, 0, [event(4)], null, 'half').falseAlarms, [])
})

test('all portfolios share a charged starting account; rebounds and cash use actual dates', () => {
  const rs = Array<number>(40).fill(0.01)
  rs[25] = -0.2
  rs[26] = 0.3
  const rep = studyHistory(observations(rs))
  assert.equal(rep.months, 27)
  assert.equal(rep.rules.length, 8)
  assert.equal(rep.episodes.length, 1)
  const market = rep.rules.find((r) => r.id === 'market')!,
    cash = rep.rules.find((r) => r.id === 'cash')!
  assert.ok(Math.abs(market.endWealth - 100 * (1 - 0.001) * 1.01 ** 25 * 0.8 * 1.3) < 1e-9)
  assert.equal(market.feesPaid, 0.1)
  assert.equal(market.cagrGap, 0)
  assert.equal(cash.feesPaid, 0)
  assert.equal(cash.reboundMonths, 1)
  assert.ok(Math.abs(cash.rebounds[0]! - (0.001 - 0.3)) < 1e-12)
  assert.ok(Math.abs(cash.reboundGap! - (0.001 - 0.3)) < 1e-12)
  assert.ok(Math.abs(cash.endWealth - 100 * 1.001 ** 27) < 1e-9)
})

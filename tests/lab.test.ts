import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_LAB_CONFIG,
  LAB_VERSION,
  STRATEGIES,
  backtestStrategy,
  backtestWeights,
  evaluateLab,
  pairedMeanDifferenceInterval,
  sampleStandardDeviation,
  strategyWeight,
  type LabConfig,
  type MonthlyRow,
  type StrategyId,
} from '../src/lab/engine.ts'

function near(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
}

function observations(length = 240): MonthlyRow[] {
  let state = 1
  return Array.from({ length }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return {
      date: `${1990 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
      marketReturn: 0.006 + (state / 2 ** 32 - 0.5) * 0.24,
      cashReturn: 0.002,
    }
  })
}

function constantRows(marketReturn: number, cashReturn: number, length = 180): MonthlyRow[] {
  return observations(length).map((row) => ({ ...row, marketReturn, cashReturn }))
}

test('cash wealth equals analytical monthly compounding with no turnover or excess dispersion', () => {
  const rows = constantRows(-0.02, 0.002, 24)
  const result = backtestStrategy(rows, 'cash', 0, 24, 100)
  near(result.metrics.totalReturn, 1.002 ** 24 - 1)
  near(result.metrics.cagr, 1.002 ** 12 - 1)
  assert.equal(result.metrics.sharpe, null)
  assert.equal(result.metrics.annualVol, 0)
  assert.equal(result.metrics.annualTurnover, 0)
  assert.equal(result.metrics.averageExposure, 0)
  assert.equal(result.metrics.maxDrawdown, 0)
  for (const row of result.ledger) {
    assert.equal(row.costFraction, 0)
    assert.equal(row.netReturn, 0.002)
  }
})

test('fees, gross returns, post-return drift, and wealth match independent two-month arithmetic', () => {
  const rows: MonthlyRow[] = [
    { date: '2020-01', marketReturn: 0.1, cashReturn: 0.01 },
    { date: '2020-02', marketReturn: -0.05, cashReturn: 0.02 },
  ]
  const { ledger, metrics } = backtestStrategy(rows, 'balanced', 0, 2, 100)
  const firstGross = 0.6 * 0.1 + 0.4 * 0.01
  const firstNet = (1 - 0.6 * 0.01) * (1 + firstGross) - 1
  const drift = (0.6 * 1.1) / (1 + firstGross)
  const secondTurnover = drift - 0.6
  const secondGross = 0.6 * -0.05 + 0.4 * 0.02
  const secondNet = (1 - secondTurnover * 0.01) * (1 + secondGross) - 1
  near(ledger[0].turnover, 0.6)
  near(ledger[0].costFraction, 0.006)
  near(ledger[0].grossReturn, firstGross)
  near(ledger[0].netReturn, firstNet)
  near(ledger[1].previousWeight, drift)
  near(ledger[1].turnover, secondTurnover)
  near(ledger[1].netReturn, secondNet)
  near(ledger[1].equity, (1 + firstNet) * (1 + secondNet))
  near(metrics.annualTurnover, (0.6 + secondTurnover) * 6)
  near(metrics.maxDrawdown, -secondNet)
})

test('allocation switches pay their actual turnover and include the initial buy but no terminal sale', () => {
  const rows = constantRows(0.1, 0.01, 4)
  const { ledger } = backtestWeights(rows, [1, 0, 0.5, 1], 0, 50)
  near(ledger[0].turnover, 1)
  near(ledger[1].previousWeight, 1)
  near(ledger[1].turnover, 1)
  near(ledger[2].turnover, 0.5)
  near(ledger[3].previousWeight, 0.55 / 1.055)
  near(ledger[3].turnover, 1 - 0.55 / 1.055)
  near(ledger[3].costFraction, (1 - 0.55 / 1.055) * 0.005)
  assert.equal(ledger.length, 4)
})

test('drawdown includes initial wealth and remains a positive loss fraction', () => {
  const rows = constantRows(-0.1, 0, 3)
  const result = backtestStrategy(rows, 'market', 0, 3, 0)
  near(result.ledger[0].drawdown, 0.1)
  near(result.ledger[2].drawdown, 1 - 0.9 ** 3)
  near(result.metrics.maxDrawdown, 1 - 0.9 ** 3)
  near(result.metrics.worstMonth, -0.1)
})

test('sample volatility and excess Sharpe use n - 1 and annualize monthly observations', () => {
  const rows: MonthlyRow[] = [
    { date: '2020-01', marketReturn: 0.1, cashReturn: 0.01 },
    { date: '2020-02', marketReturn: -0.1, cashReturn: 0.02 },
    { date: '2020-03', marketReturn: 0.05, cashReturn: 0 },
  ]
  const result = backtestStrategy(rows, 'market', 0, 3, 0)
  const returns = [0.1, -0.1, 0.05]
  const excess = [0.09, -0.12, 0.05]
  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  const sd = (values: number[]) =>
    Math.sqrt(values.reduce((sum, value) => sum + (value - average(values)) ** 2, 0) / 2)
  near(result.metrics.annualVol, sd(returns) * Math.sqrt(12))
  near(result.metrics.sharpe!, (average(excess) / sd(excess)) * Math.sqrt(12))
  near(sampleStandardDeviation([1, 2, 3]), 1)
  assert.equal(
    backtestStrategy(constantRows(0.01, 0.002, 3), 'market', 0, 3, 0).metrics.sharpe,
    null,
  )
})

test('fixed rules use completed observations and their strict equality boundaries', () => {
  const increasing = constantRows(0.01, 0.002)
  const flat = constantRows(0, 0)
  const decreasing = constantRows(-0.01, 0)
  assert.equal(strategyWeight(increasing, 'market', 24), 1)
  assert.equal(strategyWeight(increasing, 'cash', 24), 0)
  assert.equal(strategyWeight(increasing, 'balanced', 24), 0.6)
  for (const id of ['trend', 'momentum', 'breakout'] as const) {
    assert.equal(strategyWeight(increasing, id, 24), 1)
    assert.equal(strategyWeight(flat, id, 24), 0)
    assert.equal(strategyWeight(decreasing, id, 24), 0)
  }
  assert.equal(strategyWeight(decreasing, 'reversal', 24), 1)
  assert.equal(strategyWeight(increasing, 'reversal', 24), 0)
  assert.equal(strategyWeight(flat, 'reversal', 24), 0)
  assert.equal(strategyWeight(flat, 'volatility', 24), 1)
  assert.equal(strategyWeight(constantRows(0.01, 0.02), 'momentum', 24), 0)
})

test('trend compares arithmetic wealth levels, and breakout excludes the current level from its past maximum', () => {
  const rows = constantRows(0, 0, 30)
  rows[22].marketReturn = 3
  rows[23].marketReturn = -0.7
  // Last 10 completed levels are eight 1s, 4, and 1.2; arithmetic mean is 1.32.
  assert.equal(strategyWeight(rows, 'trend', 24), 0)
  const rising = constantRows(0.01, 0)
  assert.equal(strategyWeight(rising, 'breakout', 24), 1)
  rising[23].marketReturn = 0
  assert.equal(strategyWeight(rising, 'breakout', 24), 0)
})

test('volatility sizing uses the previous twelve sample returns and never adds leverage', () => {
  const rows = observations()
  const past = rows.slice(12, 24).map((row) => row.marketReturn)
  const average = past.reduce((sum, value) => sum + value, 0) / 12
  const annualVol =
    Math.sqrt(past.reduce((sum, value) => sum + (value - average) ** 2, 0) / 11) * Math.sqrt(12)
  near(strategyWeight(rows, 'volatility', 24), Math.min(1, 0.1 / annualVol))
  assert.equal(strategyWeight(constantRows(0.01, 0), 'volatility', 24), 1)
})

test('perturbing the current or future month never changes prior signals or completed ledger rows', () => {
  const rows = observations()
  const changed = rows.map((row, index) =>
    index < 130 ? { ...row } : { ...row, marketReturn: index % 2 ? 0.2 : -0.3, cashReturn: 0.01 },
  )
  for (const { id } of STRATEGIES) {
    const before = backtestStrategy(rows, id, 24, 150, 10)
    const after = backtestStrategy(changed, id, 24, 150, 10)
    assert.deepEqual(before.ledger.slice(0, 106), after.ledger.slice(0, 106), id)
    assert.equal(before.ledger[106].targetWeight, after.ledger[106].targetWeight, id)
  }
})

test('all individual rules and the frozen selector share the exact final sixty-month window', () => {
  const rows = observations(157)
  const result = evaluateLab(rows, DEFAULT_LAB_CONFIG)
  assert.equal(result.version, LAB_VERSION)
  assert.deepEqual(result.split, {
    warmupEnd: rows[23].date,
    developmentStart: rows[24].date,
    walkForwardStart: rows[84].date,
    holdoutStart: rows[97].date,
    holdoutEnd: rows[156].date,
    developmentMonths: 73,
    holdoutMonths: 60,
  })
  for (const candidate of [...result.results, result.frozenSelection]) {
    assert.equal(candidate.ledger.length, 60)
    assert.deepEqual(
      candidate.ledger.map((row) => row.date),
      rows.slice(97).map((row) => row.date),
    )
    assert.equal(candidate.ledger[0].previousWeight, 0)
    near(candidate.ledger[0].equity, 1 + candidate.ledger[0].netReturn)
  }
  assert.equal(result.walkForward.folds.length, 2)
  assert.equal(result.walkForward.ledger.length, 13)
  assert.equal(result.walkForward.folds[1].testStart, rows[96].date)
  assert.equal(result.walkForward.folds[1].testEnd, rows[96].date)
})

test('final-window return changes cannot change training scores, chosen rule, or walk-forward history', () => {
  const rows = observations()
  const changed = rows.map((row, index) =>
    index < rows.length - 60 ? { ...row } : { ...row, marketReturn: -0.08, cashReturn: 0.01 },
  )
  const before = evaluateLab(rows, DEFAULT_LAB_CONFIG)
  const after = evaluateLab(changed, DEFAULT_LAB_CONFIG)
  assert.equal(before.frozenSelection.chosenId, after.frozenSelection.chosenId)
  assert.equal(before.frozenSelection.trainingSharpe, after.frozenSelection.trainingSharpe)
  assert.deepEqual(before.walkForward, after.walkForward)
  assert.notDeepEqual(before.frozenSelection.ledger, after.frozenSelection.ledger)
})

test('each positive walk-forward winner maximizes net training excess Sharpe', () => {
  const rows = observations()
  const result = evaluateLab(rows, DEFAULT_LAB_CONFIG)
  result.walkForward.folds.forEach((fold, index) => {
    const candidates = STRATEGIES.filter((strategy) => strategy.id !== 'cash').map((strategy) => ({
      id: strategy.id,
      sharpe: backtestStrategy(rows, strategy.id, 24, 84 + index * 12, 10).metrics.sharpe,
    }))
    candidates.sort((a, b) => (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity))
    assert.ok(candidates[0].sharpe !== null && candidates[0].sharpe > 0)
    assert.equal(fold.chosenId, candidates[0].id)
    assert.equal(fold.trainingSharpe, candidates[0].sharpe)
    assert.equal(fold.selectionReason, 'positive-training-score')
    assert.equal(fold.trainStart, rows[24].date)
    assert.equal(fold.trainEnd, rows[83 + index * 12].date)
  })
  const flat = evaluateLab(constantRows(0, 0), { ...DEFAULT_LAB_CONFIG, costBps: 0 })
  assert.equal(flat.frozenSelection.chosenId, 'cash')
  assert.equal(flat.frozenSelection.trainingSharpe, null)
  assert.equal(flat.frozenSelection.selectionReason, 'cash-abstention')
  assert.ok(
    flat.walkForward.folds.every(
      (fold) =>
        fold.chosenId === 'cash' &&
        fold.trainingSharpe === null &&
        fold.selectionReason === 'cash-abstention',
    ),
  )
})

test('selector abstains in cash when negative or undefined training scores cannot beat the cash policy', () => {
  for (const costBps of [0, 10]) {
    const result = evaluateLab(constantRows(-0.01, 0, 156), {
      ...DEFAULT_LAB_CONFIG,
      costBps,
    })
    assert.equal(result.frozenSelection.chosenId, 'cash')
    assert.equal(result.frozenSelection.trainingSharpe, null)
    assert.equal(result.frozenSelection.selectionReason, 'cash-abstention')
    assert.equal(result.frozenSelection.metrics.totalReturn, 0)
    assert.equal(result.frozenSelection.metrics.annualTurnover, 0)
    assert.equal(result.walkForward.metrics.totalReturn, 0)
    assert.equal(result.walkForward.metrics.averageExposure, 0)
    assert.ok(
      result.frozenSelection.ledger.every(
        (row) => row.targetWeight === 0 && row.costFraction === 0,
      ),
    )
    assert.ok(
      result.walkForward.folds.every(
        (fold) =>
          fold.chosenId === 'cash' &&
          fold.trainingSharpe === null &&
          fold.selectionReason === 'cash-abstention',
      ),
    )
    // Abstention changes the selector policy, not the individual declared rules.
    assert.ok(result.results.find((run) => run.id === 'market')!.metrics.cagr < 0)
    assert.equal(result.results.find((run) => run.id === 'trend')!.metrics.totalReturn, 0)
  }
})

test('positive finite scores remain eligible and exact score ties follow descriptor order', () => {
  const rows = constantRows(0, 0).map((row, index) => ({
    ...row,
    marketReturn: index % 2 ? 0.005 : 0.02,
  }))
  const result = evaluateLab(rows, DEFAULT_LAB_CONFIG)
  const marketScore = backtestStrategy(rows, 'market', 24, rows.length - 60, 10).metrics.sharpe
  const trendScore = backtestStrategy(rows, 'trend', 24, rows.length - 60, 10).metrics.sharpe
  assert.ok(marketScore !== null && marketScore > 0)
  assert.equal(trendScore, marketScore)
  assert.equal(result.frozenSelection.chosenId, 'market')
  assert.equal(result.frozenSelection.trainingSharpe, marketScore)
  assert.equal(result.frozenSelection.selectionReason, 'positive-training-score')
  assert.ok(
    result.walkForward.folds.every(
      (fold) =>
        fold.chosenId === 'market' &&
        fold.selectionReason === 'positive-training-score' &&
        fold.trainingSharpe! > 0,
    ),
  )
})

test('a later cash abstention pays the actual exit cost and then stops trading', () => {
  const rows = constantRows(0, 0).map((row, index) => ({
    ...row,
    marketReturn: index < 84 ? 0.01 : index === 84 ? -0.9 : 0,
  }))
  const result = evaluateLab(rows, DEFAULT_LAB_CONFIG)
  assert.equal(result.walkForward.folds[0].selectionReason, 'positive-training-score')
  assert.equal(result.walkForward.folds[1].selectionReason, 'cash-abstention')
  const previous = result.walkForward.ledger[11]
  const exit = result.walkForward.ledger[12]
  assert.ok(previous.targetWeight > 0)
  const driftedWeight =
    (previous.targetWeight * (1 + rows[95].marketReturn)) / (1 + previous.grossReturn)
  assert.equal(exit.targetWeight, 0)
  near(exit.previousWeight, driftedWeight)
  near(exit.turnover, driftedWeight)
  near(exit.costFraction, driftedWeight * 0.001)
  near(exit.netReturn, -driftedWeight * 0.001)
  near(result.walkForward.folds[1].testReturn, -driftedWeight * 0.001)
  assert.ok(
    result.walkForward.ledger
      .slice(13)
      .every((row) => row.turnover === 0 && row.targetWeight === 0),
  )
})

test('walk-forward strategy switches execute one continuous allocation ledger, not stitched candidate returns', () => {
  const rows = observations()
  const result = evaluateLab(rows, DEFAULT_LAB_CONFIG)
  assert.ok(new Set(result.walkForward.folds.map((fold) => fold.chosenId)).size > 1)
  const actualWeights = result.walkForward.ledger.map((_, index) => {
    const id = result.walkForward.folds[Math.floor(index / 12)].chosenId
    return strategyWeight(rows, id, 84 + index)
  })
  const independentExecution = backtestWeights(rows, actualWeights, 84, 10)
  assert.deepEqual(result.walkForward.ledger, independentExecution.ledger)
  assert.deepEqual(result.walkForward.metrics, independentExecution.metrics)
  for (let index = 12; index < result.walkForward.ledger.length; index += 12) {
    const previous = result.walkForward.ledger[index - 1]
    const current = result.walkForward.ledger[index]
    const marketReturn = rows[84 + index - 1].marketReturn
    const expectedDrift = (previous.targetWeight * (1 + marketReturn)) / (1 + previous.grossReturn)
    near(current.previousWeight, expectedDrift)
    near(current.turnover, Math.abs(current.targetWeight - expectedDrift))
  }
  result.walkForward.folds.forEach((fold, index) => {
    const period = result.walkForward.ledger.slice(index * 12, index * 12 + 12)
    near(fold.testReturn, period.reduce((equity, row) => equity * (1 + row.netReturn), 1) - 1)
  })
})

test('development baselines match the selector calendar and independent accounting at minimum, partial, and long windows', () => {
  for (const count of [156, 157, 432]) {
    const rows = constantRows(0.02, 0.001, count)
    const result = evaluateLab(rows, DEFAULT_LAB_CONFIG)
    const developmentRows = rows.slice(84, count - 60)
    assert.equal(result.split.walkForwardStart, rows[84].date)
    assert.deepEqual(
      result.walkForward.baselines.map((baseline) => baseline.id),
      ['market', 'cash', 'balanced'],
    )
    for (const baseline of result.walkForward.baselines) {
      assert.deepEqual(
        baseline.ledger.map((row) => row.date),
        result.walkForward.ledger.map((row) => row.date),
      )
      assert.deepEqual(
        baseline.ledger.map((row) => row.date),
        developmentRows.map((row) => row.date),
      )
      const target = baseline.id === 'market' ? 1 : baseline.id === 'cash' ? 0 : 0.6
      let previous = 0
      let wealth = 1
      let totalTurnover = 0
      developmentRows.forEach((row, index) => {
        const turnover = Math.abs(target - previous)
        const fee = turnover * 0.001
        const grossFactor = target * (1 + row.marketReturn) + (1 - target) * (1 + row.cashReturn)
        const netFactor = (1 - fee) * grossFactor
        wealth *= netFactor
        totalTurnover += turnover
        near(baseline.ledger[index].previousWeight, previous)
        near(baseline.ledger[index].turnover, turnover)
        near(baseline.ledger[index].costFraction, fee)
        near(baseline.ledger[index].netReturn, netFactor - 1)
        near(baseline.ledger[index].equity, wealth, 1e-9)
        previous = (target * (1 + row.marketReturn)) / grossFactor
      })
      near(baseline.metrics.totalReturn, wealth - 1, 1e-9)
      near(baseline.metrics.cagr, wealth ** (12 / developmentRows.length) - 1)
      near(baseline.metrics.annualTurnover, (totalTurnover * 12) / developmentRows.length)
    }
  }
})

test('fold benchmark returns slice continuous holdings without annual reentry or resetting drift', () => {
  const rows = constantRows(0.02, 0.001, 157)
  const result = evaluateLab(rows, DEFAULT_LAB_CONFIG)
  const [first, partial] = result.walkForward.folds
  assert.equal(result.walkForward.folds.length, 2)
  near(first.baselineReturns.market, (1 - 0.001) * 1.02 ** 12 - 1)
  near(first.baselineReturns.cash, 1.001 ** 12 - 1)
  near(partial.baselineReturns.market, 0.02)
  near(partial.baselineReturns.cash, 0.001)
  const drift = (0.6 * 1.02) / (0.6 * 1.02 + 0.4 * 1.001)
  const nextFee = Math.abs(0.6 - drift) * 0.001
  near(partial.baselineReturns.balanced, (1 - nextFee) * (0.6 * 1.02 + 0.4 * 1.001) - 1)
  const market = result.walkForward.baselines.find((baseline) => baseline.id === 'market')!
  const balanced = result.walkForward.baselines.find((baseline) => baseline.id === 'balanced')!
  assert.equal(market.ledger[12].turnover, 0)
  near(balanced.ledger[12].previousWeight, drift)
  near(balanced.ledger[12].costFraction, nextFee)

  for (const baseline of result.walkForward.baselines) {
    const compoundedFolds = result.walkForward.folds.reduce(
      (wealth, fold) =>
        wealth * (1 + fold.baselineReturns[baseline.id as 'market' | 'cash' | 'balanced']),
      1,
    )
    near(compoundedFolds - 1, baseline.metrics.totalReturn)
  }
})

test('cost sensitivity keeps the selected rule fixed and total return decreases with higher costs', () => {
  const rows = observations()
  const result = evaluateLab(rows, { ...DEFAULT_LAB_CONFIG, selectedStrategy: 'balanced' })
  assert.deepEqual(
    result.costSensitivity.map((point) => point.costBps),
    [0, 5, 10, 25, 50],
  )
  result.costSensitivity.forEach((point, index) => {
    const expected = backtestStrategy(
      rows,
      'balanced',
      rows.length - 60,
      rows.length,
      point.costBps,
    )
    assert.equal(point.cagr, expected.metrics.cagr)
    assert.equal(point.totalReturn, expected.metrics.totalReturn)
    if (index > 0) assert.ok(point.totalReturn < result.costSensitivity[index - 1].totalReturn)
  })
})

test('paired block bootstrap is deterministic and identical paths yield an exact zero interval', () => {
  const market = observations(60).map((row) => row.marketReturn)
  const cash = observations(60).map((row) => row.cashReturn)
  for (const stream of [market, cash]) {
    const result = pairedMeanDifferenceInterval(stream, stream, 17)
    assert.equal(result.estimate, 0)
    assert.equal(result.low, 0)
    assert.equal(result.high, 0)
  }
  const result = pairedMeanDifferenceInterval(market, cash, 17)
  assert.deepEqual(result, pairedMeanDifferenceInterval(market, cash, 17))
  assert.notDeepEqual(result, pairedMeanDifferenceInterval(market, cash, 18))
  near(
    result.estimate,
    (12 * market.reduce((sum, value, index) => sum + value - cash[index], 0)) / 60,
  )
  assert.ok(result.low < result.high)
  const shifted = pairedMeanDifferenceInterval(
    market.map((value) => value + 0.01),
    market,
    17,
  )
  near(shifted.estimate, 0.12)
  near(shifted.low, 0.12)
  near(shifted.high, 0.12)
  const marketSelection = evaluateLab(observations(), {
    ...DEFAULT_LAB_CONFIG,
    selectedStrategy: 'market',
  })
  assert.equal(marketSelection.uncertainty.low, 0)
  assert.equal(marketSelection.uncertainty.high, 0)
})

test('bootstrap samples only complete noncircular blocks and truncates the final block to sample length', () => {
  // Seven observations allow only starts 0 and 1. Each resample has one six-month
  // block plus the first element of a second block; all possible means are bounded.
  const selected = [0, 0, 0, 0, 0, 0, 0.7]
  const result = pairedMeanDifferenceInterval(selected, Array(7).fill(0), 17)
  near(result.estimate, 1.2)
  assert.equal(result.low, 0)
  near(result.high, 1.2)
  assert.equal(result.blockLength, 6)
  assert.equal(result.replicates, 1000)
})

test('evaluation is reproducible and does not mutate input rows or configuration', () => {
  const rows = observations(156)
  const config = { ...DEFAULT_LAB_CONFIG }
  const snapshot = structuredClone({ rows, config })
  const first = evaluateLab(rows, config)
  assert.deepEqual(first, evaluateLab(rows, config))
  assert.deepEqual({ rows, config }, snapshot)
  first.config.costBps = 50
  assert.equal(config.costBps, DEFAULT_LAB_CONFIG.costBps)
  for (const result of first.results) {
    for (const row of result.ledger) {
      for (const [key, value] of Object.entries(row)) {
        if (key !== 'date') assert.ok(Number.isFinite(value), `${result.id}: ${key}`)
      }
      assert.ok(row.targetWeight >= 0 && row.targetWeight <= 1)
      assert.ok(row.drawdown >= 0 && row.drawdown < 1)
    }
  }
})

test('invalid costs, strategies, seeds, windows, row counts, dates, and returns fail explicitly', () => {
  const rows = observations(156)
  for (const costBps of [-1, 101, NaN, Infinity])
    assert.throws(() => evaluateLab(rows, { ...DEFAULT_LAB_CONFIG, costBps }), /Transaction cost/)
  assert.throws(
    () => evaluateLab(rows, { ...DEFAULT_LAB_CONFIG, selectedStrategy: 'unknown' as StrategyId }),
    /Unknown strategy/,
  )
  for (const bootstrapSeed of [-1, 2 ** 32, 1.5, NaN])
    assert.throws(
      () => evaluateLab(rows, { ...DEFAULT_LAB_CONFIG, bootstrapSeed }),
      /Bootstrap seed/,
    )
  assert.throws(() => evaluateLab(rows, null as unknown as LabConfig), /configuration/)
  assert.throws(() => evaluateLab(rows.slice(1), DEFAULT_LAB_CONFIG), /156/)
  assert.throws(() => evaluateLab(observations(1501), DEFAULT_LAB_CONFIG), /1,500/)
  for (const date of ['2020-1', '2020-13', 'not-a-date'])
    assert.throws(
      () => evaluateLab([{ ...rows[0], date }, ...rows.slice(1)], DEFAULT_LAB_CONFIG),
      /YYYY-MM/,
    )
  assert.throws(
    () => evaluateLab([rows[0], rows[0], ...rows.slice(2)], DEFAULT_LAB_CONFIG),
    /consecutive/,
  )
  const gap = observations(157).filter((_, index) => index !== 12)
  assert.throws(() => evaluateLab(gap, DEFAULT_LAB_CONFIG), /consecutive/)
  for (const value of [-1, -2, 10.1, NaN, Infinity]) {
    for (const key of ['marketReturn', 'cashReturn'] as const)
      assert.throws(
        () => evaluateLab([{ ...rows[0], [key]: value }, ...rows.slice(1)], DEFAULT_LAB_CONFIG),
        /finite decimal/,
      )
  }
  assert.throws(() => backtestStrategy(rows, 'market', 5, 5, 10), /window/)
  assert.throws(() => backtestWeights(rows, [1.01], 0, 10), /target equity weight/)
  assert.throws(() => strategyWeight(rows, 'trend', 4), /completed monthly/)
  assert.throws(() => pairedMeanDifferenceInterval([0], [0], 17), /at least six/)
})

test('unrepresentable compounded wealth fails instead of returning infinite chart values', () => {
  assert.throws(() => evaluateLab(constantRows(10, 0, 1500), DEFAULT_LAB_CONFIG), /numeric range/)
})

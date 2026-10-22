import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LAB_CONFIG, evaluateLab } from '../src/lab/engine.ts'
import type { LabEvaluation, MonthlyRow, StrategyId } from '../src/lab/engine.ts'
import { evaluateRiskAudit, RISK_AUDIT_VERSION } from '../src/lab/risk.ts'
import type { RiskAudit } from '../src/lab/risk.ts'

function observations(count = 156, marketReturn = 0, cashReturn = 0): MonthlyRow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `${2000 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
    marketReturn,
    cashReturn,
  }))
}

function run(rows: MonthlyRow[], costBps = 0) {
  const evaluation = evaluateLab(rows, { ...DEFAULT_LAB_CONFIG, costBps })
  return { evaluation, audit: evaluateRiskAudit(rows, evaluation) }
}

const rule = (audit: RiskAudit, id: StrategyId) => audit.rules.find((item) => item.id === id)!

function near(actual: number, expected: number, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
}

test('loss windows use pre-return decisions, compounded gross market returns, and exact six-month boundaries', () => {
  const rows = observations()
  const start = rows.length - 60
  rows[start - 2].marketReturn = 0.25
  rows[start - 1].marketReturn = -0.2
  const forward = [0.1, -0.2, -0.1, 0.5, 0, 0]
  forward.forEach((value, index) => (rows[start + index].marketReturn = value))
  const { audit } = run(rows)
  const first = rule(audit, 'market').ledger[0]
  assert.equal(audit.version, RISK_AUDIT_VERSION)
  assert.deepEqual(audit.protocol, { horizonMonths: 6, lossThreshold: 0.15, warningWeight: 0.5 })
  assert.equal(first.signalDate, rows[start - 1].date)
  assert.equal(first.firstReturnMonth, rows[start].date)
  assert.equal(first.endMonth, rows[start + 5].date)
  near(first.drawdownAtSignal, 0.2)
  near(first.forwardWorstReturn, 1.1 * 0.8 * 0.9 - 1)
  assert.equal(first.lossWithinHorizon, true)
  assert.equal(first.monthsToLoss, 3)
  for (const result of audit.rules) {
    assert.equal(result.ledger[0].forwardWorstReturn, first.forwardWorstReturn)
    assert.equal(result.ledger[0].drawdownAtSignal, first.drawdownAtSignal)
  }
})

test('a loss exactly at 15% counts, a smaller loss does not, and month seven is outside the first horizon', () => {
  const atThreshold = observations()
  const start = atThreshold.length - 60
  atThreshold[start].marketReturn = -0.15
  const hit = rule(run(atThreshold).audit, 'cash').ledger[0]
  assert.equal(hit.lossWithinHorizon, true)
  assert.equal(hit.monthsToLoss, 1)

  const belowThreshold = observations()
  belowThreshold[start].marketReturn = -0.149999
  assert.equal(rule(run(belowThreshold).audit, 'cash').ledger[0].lossWithinHorizon, false)
  const late = observations()
  late[start + 6].marketReturn = -0.2
  const windows = rule(run(late).audit, 'cash').ledger
  assert.equal(windows[0].lossWithinHorizon, false)
  assert.equal(windows[0].monthsToLoss, null)
  assert.equal(windows[1].lossWithinHorizon, true)
  assert.equal(windows[1].monthsToLoss, 6)
})

test('the 50% warning boundary includes equality and uses the existing lagged volatility rule', () => {
  const equal = observations()
  const start = equal.length - 60
  // One +20% return among twelve observations has annualized sample SD 20%.
  equal[start - 10].marketReturn = 0.2
  const equalResult = run(equal)
  assert.equal(
    equalResult.evaluation.results.find((item) => item.id === 'volatility')!.ledger[0].targetWeight,
    0.5,
  )
  assert.equal(rule(equalResult.audit, 'volatility').ledger[0].warning, true)
  const above = observations()
  above[start - 10].marketReturn = 0.199999
  const aboveRow = rule(run(above).audit, 'volatility').ledger[0]
  assert.ok(aboveRow.targetWeight > 0.5)
  assert.equal(aboveRow.warning, false)
})

test('the last five starts are censored even if their partially observed future includes a loss', () => {
  const rows = observations()
  rows.at(-1)!.marketReturn = -0.2
  const { audit } = run(rows)
  assert.deepEqual(audit.window, {
    start: rows[rows.length - 60].date,
    end: rows.at(-1)!.date,
    firstSignalDate: rows[rows.length - 61].date,
    lastEligibleStart: rows[rows.length - 6].date,
  })
  for (const result of audit.rules) {
    assert.equal(result.ledger.length, 55)
    assert.equal(result.eligibleMonths, 55)
    assert.equal(result.censoredMonths, 5)
    assert.equal(result.eventWindows, 1)
    assert.equal(result.ledger.at(-1)!.endMonth, rows.at(-1)!.date)
    assert.equal(result.ledger.at(-1)!.monthsToLoss, 6)
    assert.equal(
      result.truePositive + result.falsePositive + result.falseNegative + result.trueNegative,
      55,
    )
  }
  assert.equal(rule(audit, 'cash').truePositive, 1)
  assert.equal(rule(audit, 'market').falseNegative, 1)
})

test('no-loss data expose always-warning cash and never-warning market without undefined rates becoming zero', () => {
  const { audit } = run(observations(156, 0.01))
  const cash = rule(audit, 'cash')
  assert.equal(cash.truePositive, 0)
  assert.equal(cash.falsePositive, 55)
  assert.equal(cash.precision, 0)
  assert.equal(cash.recall, null)
  assert.equal(cash.falseAlarmRate, 1)
  assert.equal(cash.medianWarningDrawdown, 0)
  assert.equal(cash.medianLeadMonths, null)
  const market = rule(audit, 'market')
  assert.equal(market.warningMonths, 0)
  assert.equal(market.trueNegative, 55)
  assert.equal(market.precision, null)
  assert.equal(market.recall, null)
  assert.equal(market.falseAlarmRate, 0)
  assert.equal(market.medianWarningDrawdown, null)
  assert.equal(market.medianLeadMonths, null)
})

test('all-loss data keep the false-alarm denominator undefined and count lead months from the decision boundary', () => {
  const { audit } = run(observations(156, -0.04))
  const cash = rule(audit, 'cash')
  assert.equal(cash.eventWindows, 55)
  assert.equal(cash.truePositive, 55)
  assert.equal(cash.precision, 1)
  assert.equal(cash.recall, 1)
  assert.equal(cash.falseAlarmRate, null)
  assert.equal(cash.medianLeadMonths, 4)
  const market = rule(audit, 'market')
  assert.equal(market.falseNegative, 55)
  assert.equal(market.recall, 0)
  assert.equal(market.precision, null)
  assert.equal(market.falseAlarmRate, null)
})

test('an abrupt drop is a miss for trend and breakout; later defensive reactions receive no advance-warning credit', () => {
  const rows = observations(156, 0.01)
  const start = rows.length - 60
  const drop = start + 20
  rows[drop].marketReturn = -0.2
  rows.slice(drop + 1).forEach((row) => (row.marketReturn = 0))
  const { audit } = run(rows)
  assert.equal(rule(audit, 'market').eventWindows, 6)
  assert.equal(rule(audit, 'market').falseNegative, 6)
  assert.equal(rule(audit, 'cash').truePositive, 6)
  assert.equal(rule(audit, 'cash').falsePositive, 49)
  for (const id of ['trend', 'breakout'] as const) {
    const result = rule(audit, id)
    assert.equal(result.truePositive, 0)
    assert.equal(result.falseNegative, 6)
    assert.equal(result.medianLeadMonths, null)
    assert.ok(result.falsePositive > 0)
    assert.equal(result.ledger[20].warning, false)
    assert.equal(result.ledger[21].warning, true)
    assert.equal(result.ledger[21].lossWithinHorizon, false)
    near(result.ledger[21].drawdownAtSignal, 0.2)
    near(result.medianWarningDrawdown!, 0.2)
  }
})

test('future returns may change outcomes but cannot change earlier targets or pre-signal drawdowns', () => {
  const rows = observations(180, 0.01, 0.001)
  const start = rows.length - 60
  const changed = structuredClone(rows)
  changed[start + 3].marketReturn = -0.3
  const before = run(rows).audit
  const after = run(changed).audit
  for (const { id } of before.rules) {
    const previous = rule(before, id).ledger
    const next = rule(after, id).ledger
    for (let index = 0; index <= 3; index++) {
      assert.equal(previous[index].targetWeight, next[index].targetWeight)
      assert.equal(previous[index].warning, next[index].warning)
      assert.equal(previous[index].drawdownAtSignal, next[index].drawdownAtSignal)
      assert.equal(previous[index].signalDate, next[index].signalDate)
    }
    assert.notEqual(previous[0].lossWithinHorizon, next[0].lossWithinHorizon)
  }
})

test('up-market opportunity gaps use net monthly returns across all sixty months, including censored starts', () => {
  const rows = observations()
  const start = rows.length - 60
  rows[start].marketReturn = -0.3
  rows.at(-1)!.marketReturn = 0.5
  const { audit, evaluation } = run(rows, 10)
  const marketNet = evaluation.results
    .find((item) => item.id === 'market')!
    .ledger.at(-1)!.netReturn
  for (const item of audit.rules) {
    const netReturn = evaluation.results
      .find((result) => result.id === item.id)!
      .ledger.at(-1)!.netReturn
    assert.equal(item.upMarketMonths, 1)
    near(item.meanUpMarketGap!, netReturn - marketNet)
  }
  near(rule(audit, 'cash').meanUpMarketGap!, -0.5)
  near(rule(audit, 'balanced').meanUpMarketGap!, -0.2)
  assert.equal(rule(audit, 'market').meanUpMarketGap, 0)
  for (const result of run(observations()).audit.rules) {
    assert.equal(result.upMarketMonths, 0)
    assert.equal(result.meanUpMarketGap, null)
  }
})

test('gross market loss outcomes exclude strategy entry fees, and opportunity gaps may be positive', () => {
  const rows = observations(156, 0.01, 0.02)
  const free = run(rows, 0)
  const expensive = run(rows, 100)
  for (const { id } of free.audit.rules) {
    assert.deepEqual(
      rule(free.audit, id).ledger.map(
        ({ forwardWorstReturn, lossWithinHorizon, drawdownAtSignal }) => ({
          forwardWorstReturn,
          lossWithinHorizon,
          drawdownAtSignal,
        }),
      ),
      rule(expensive.audit, id).ledger.map(
        ({ forwardWorstReturn, lossWithinHorizon, drawdownAtSignal }) => ({
          forwardWorstReturn,
          lossWithinHorizon,
          drawdownAtSignal,
        }),
      ),
    )
  }
  near(rule(free.audit, 'cash').meanUpMarketGap!, 0.01)
  const marketNetReturns = expensive.evaluation.results
    .find((result) => result.id === 'market')!
    .ledger.map((row) => row.netReturn)
  near(
    rule(expensive.audit, 'cash').meanUpMarketGap!,
    marketNetReturns.reduce((sum, value) => sum + 0.02 - value, 0) / 60,
  )
})

test('historical drawdown remains finite when a gross wealth index would overflow or underflow', () => {
  const overflow = observations(370)
  overflow.slice(0, 310).forEach((row) => (row.marketReturn = 10))
  assert.equal(11 ** 310, Infinity)
  const datasets = [overflow, observations(156, -0.999)]
  for (const rows of datasets) {
    const { audit } = run(rows)
    for (const result of audit.rules) {
      for (const row of result.ledger) {
        assert.ok(Number.isFinite(row.forwardWorstReturn))
        assert.ok(Number.isFinite(row.drawdownAtSignal))
        assert.ok(row.drawdownAtSignal >= 0 && row.drawdownAtSignal <= 1)
      }
      for (const field of [
        'precision',
        'recall',
        'falseAlarmRate',
        'medianWarningDrawdown',
        'medianLeadMonths',
        'meanUpMarketGap',
      ] as const)
        assert.ok(result[field] === null || Number.isFinite(result[field]))
    }
  }
})

test('mismatched versions, dates, rules, incomplete ledgers and invalid numbers are rejected', () => {
  const rows = observations()
  const { evaluation } = run(rows)
  const changes: Array<(value: LabEvaluation) => void> = [
    (value) => {
      value.version = 'lab-1' as typeof value.version
    },
    (value) => {
      value.split.holdoutStart = '2000-01'
    },
    (value) => {
      value.results.pop()
    },
    (value) => {
      value.results[0] = value.results[1]
    },
    (value) => {
      value.results[0].name = 'Untracked rule'
    },
    (value) => {
      value.results[0].ledger.pop()
    },
    (value) => {
      value.results[0].ledger[0].date = value.results[0].ledger[1].date
    },
    (value) => {
      value.results[0].ledger[0].targetWeight = NaN
    },
    (value) => {
      value.results[0].ledger[0].targetWeight = 1.01
    },
    (value) => {
      value.results[0].ledger[0].netReturn = Infinity
    },
    (value) => {
      value.results[0].ledger[0].netReturn = -1
    },
  ]
  for (const change of changes) {
    const value = structuredClone(evaluation)
    change(value)
    assert.throws(() => evaluateRiskAudit(rows, value), /Risk audit/)
  }
  const gap = rows.filter((_, index) => index !== 3)
  assert.throws(() => evaluateRiskAudit(gap, evaluation), /156|consecutive/)
  const invalidReturn = structuredClone(rows)
  invalidReturn[0].marketReturn = NaN
  assert.throws(() => evaluateRiskAudit(invalidReturn, evaluation), /finite/)
})

test('diagnostics are deterministic, preserve the supplied calculation, and contain all eight fixed rules', () => {
  const rows = observations(180, 0.01, 0.002)
  const { evaluation, audit } = run(rows)
  const snapshot = structuredClone({ rows, evaluation })
  assert.deepEqual(evaluateRiskAudit(rows, evaluation), audit)
  assert.deepEqual({ rows, evaluation }, snapshot)
  assert.deepEqual(
    audit.rules.map((item) => item.id),
    evaluation.results.map((item) => item.id),
  )
})

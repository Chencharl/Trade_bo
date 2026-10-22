import { LAB_VERSION, STRATEGIES, validateMonthlyRows } from './engine'
import type { LabEvaluation, LedgerRow, MonthlyRow, StrategyId, StrategyResult } from './engine'

/** Descriptive diagnostics only; this does not change the lab's allocation rules. */
export const RISK_AUDIT_VERSION = 'risk-audit-1'
const HORIZON_MONTHS = 6
const LOSS_THRESHOLD = 0.15
const WARNING_WEIGHT = 0.5
const RESERVED_MONTHS = 60

export type RiskAuditRow = {
  /** Modeled decision boundary: the previous observation month, not a publication date. */
  signalDate: string
  firstReturnMonth: string
  endMonth: string
  targetWeight: number
  warning: boolean
  forwardWorstReturn: number
  lossWithinHorizon: boolean
  monthsToLoss: number | null
  drawdownAtSignal: number
}

export type RiskAuditRule = {
  id: StrategyId
  name: string
  truePositive: number
  falsePositive: number
  falseNegative: number
  trueNegative: number
  warningMonths: number
  eventWindows: number
  eligibleMonths: number
  censoredMonths: number
  precision: number | null
  recall: number | null
  /** False positives divided by all windows without the defined loss outcome. */
  falseAlarmRate: number | null
  medianWarningDrawdown: number | null
  medianLeadMonths: number | null
  /** Unannualized mean (rule net return - Market net return) in raw-market-positive months. */
  meanUpMarketGap: number | null
  upMarketMonths: number
  ledger: RiskAuditRow[]
}

export type RiskAudit = {
  version: typeof RISK_AUDIT_VERSION
  protocol: { horizonMonths: 6; lossThreshold: 0.15; warningWeight: 0.5 }
  window: { start: string; end: string; firstSignalDate: string; lastEligibleStart: string }
  rules: RiskAuditRule[]
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateLedger(row: LedgerRow, expectedDate: string): void {
  if (!row || row.date !== expectedDate)
    throw new Error('Risk audit ledgers must match every reserved month in chronological order.')
  const fields = [
    'targetWeight',
    'previousWeight',
    'turnover',
    'costFraction',
    'grossReturn',
    'netReturn',
    'equity',
    'drawdown',
  ] as const
  if (fields.some((field) => !finite(row[field])))
    throw new Error('Risk audit ledger values must be finite numbers.')
  if (
    row.targetWeight < 0 ||
    row.targetWeight > 1 ||
    row.previousWeight < 0 ||
    row.previousWeight > 1 ||
    row.turnover < 0 ||
    row.turnover > 1 ||
    row.costFraction < 0 ||
    row.costFraction > 0.01 ||
    row.grossReturn <= -1 ||
    row.grossReturn > 10 ||
    row.netReturn <= -1 ||
    row.netReturn > 10 ||
    row.equity <= 0 ||
    row.drawdown < 0 ||
    row.drawdown > 1
  )
    throw new Error('Risk audit ledger values exceed the supported monthly allocation bounds.')
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

/**
 * Test pre-month exposure flags against fixed six-month gross-market loss windows.
 * Uses only mature starts; overlapping windows are not independent crash events.
 * The supplied evaluation must come from the matching lab engine. This diagnostic
 * validates alignment and numeric bounds, not source authenticity or model merit.
 */
export function evaluateRiskAudit(rows: MonthlyRow[], evaluation: LabEvaluation): RiskAudit {
  validateMonthlyRows(rows)
  const start = rows.length - RESERVED_MONTHS
  const eligibleMonths = RESERVED_MONTHS - HORIZON_MONTHS + 1
  if (
    !evaluation ||
    evaluation.version !== LAB_VERSION ||
    evaluation.split?.holdoutMonths !== RESERVED_MONTHS ||
    evaluation.split?.holdoutStart !== rows[start].date ||
    evaluation.split?.holdoutEnd !== rows.at(-1)!.date
  )
    throw new Error('Risk audit requires the matching engine and final 60-month evaluation window.')
  if (!Array.isArray(evaluation.results) || evaluation.results.length !== STRATEGIES.length)
    throw new Error('Risk audit requires all eight fixed-rule ledgers.')
  const results = new Map<StrategyId, StrategyResult>()
  for (const result of evaluation.results) {
    const descriptor = result && STRATEGIES.find((strategy) => strategy.id === result.id)
    if (!descriptor || results.has(result.id) || result.name !== descriptor.name)
      throw new Error('Risk audit requires each declared fixed rule exactly once.')
    if (!Array.isArray(result.ledger) || result.ledger.length !== RESERVED_MONTHS)
      throw new Error('Risk audit requires 60 observations in every fixed-rule ledger.')
    result.ledger.forEach((row, index) => validateLedger(row, rows[start + index].date))
    results.set(result.id, result)
  }

  // Log wealth keeps historical drawdown finite even if the full gross-market
  // wealth index overflows/underflows. Values are recorded BEFORE each return.
  let logWealth = 0
  let logPeak = 0
  const priorDrawdowns = rows.map((row) => {
    const drawdown = -Math.expm1(logWealth - logPeak)
    logWealth += Math.log1p(row.marketReturn)
    logPeak = Math.max(logPeak, logWealth)
    return drawdown === 0 ? 0 : drawdown
  })
  const outcomes = Array.from({ length: eligibleMonths }, (_, offset) => {
    const first = start + offset
    let wealth = 1
    let minimum = Infinity
    let monthsToLoss: number | null = null
    for (let month = 0; month < HORIZON_MONTHS; month++) {
      wealth *= 1 + rows[first + month].marketReturn
      minimum = Math.min(minimum, wealth)
      if (monthsToLoss === null && wealth <= 1 - LOSS_THRESHOLD) monthsToLoss = month + 1
    }
    return {
      signalDate: rows[first - 1].date,
      firstReturnMonth: rows[first].date,
      endMonth: rows[first + HORIZON_MONTHS - 1].date,
      forwardWorstReturn: minimum - 1,
      lossWithinHorizon: monthsToLoss !== null,
      monthsToLoss,
      drawdownAtSignal: priorDrawdowns[first],
    }
  })
  const market = results.get('market')!
  const upMonths = rows.slice(start).flatMap((row, index) => (row.marketReturn > 0 ? [index] : []))
  return {
    version: RISK_AUDIT_VERSION,
    protocol: {
      horizonMonths: HORIZON_MONTHS,
      lossThreshold: LOSS_THRESHOLD,
      warningWeight: WARNING_WEIGHT,
    },
    window: {
      start: rows[start].date,
      end: rows.at(-1)!.date,
      firstSignalDate: rows[start - 1].date,
      lastEligibleStart: rows[start + eligibleMonths - 1].date,
    },
    rules: STRATEGIES.map(({ id, name }) => {
      const result = results.get(id)!
      const ledger = outcomes.map((outcome, index): RiskAuditRow => ({
        ...outcome,
        targetWeight: result.ledger[index].targetWeight,
        warning: result.ledger[index].targetWeight <= WARNING_WEIGHT,
      }))
      const count = (warning: boolean, event: boolean) =>
        ledger.filter((row) => row.warning === warning && row.lossWithinHorizon === event).length
      const truePositive = count(true, true)
      const falsePositive = count(true, false)
      const falseNegative = count(false, true)
      const trueNegative = count(false, false)
      const warningMonths = truePositive + falsePositive
      const eventWindows = truePositive + falseNegative
      return {
        id,
        name,
        truePositive,
        falsePositive,
        falseNegative,
        trueNegative,
        warningMonths,
        eventWindows,
        eligibleMonths,
        censoredMonths: HORIZON_MONTHS - 1,
        precision: ratio(truePositive, warningMonths),
        recall: ratio(truePositive, eventWindows),
        falseAlarmRate: ratio(falsePositive, falsePositive + trueNegative),
        medianWarningDrawdown: median(
          ledger.filter((row) => row.warning).map((row) => row.drawdownAtSignal),
        ),
        medianLeadMonths: median(
          ledger
            .filter((row) => row.warning && row.lossWithinHorizon)
            .map((row) => row.monthsToLoss!),
        ),
        meanUpMarketGap:
          upMonths.length === 0
            ? null
            : upMonths.reduce(
                (sum, month) =>
                  sum + result.ledger[month].netReturn - market.ledger[month].netReturn,
                0,
              ) / upMonths.length,
        upMarketMonths: upMonths.length,
        ledger,
      }
    }),
  }
}

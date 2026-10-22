/** Independent, monthly, long-only equity/cash research engine. All returns are decimals. */
export const LAB_VERSION = 'lab-1'

export type MonthlyRow = { date: string; marketReturn: number; cashReturn: number }

export const STRATEGIES = [
  {
    id: 'market',
    name: 'Market',
    family: 'Benchmark',
    summary: 'Stay fully invested in the equity market.',
    rule: '100% equity every month.',
  },
  {
    id: 'cash',
    name: 'Cash',
    family: 'Benchmark',
    summary: 'Stay in the monthly cash-return series.',
    rule: '100% cash every month.',
  },
  {
    id: 'balanced',
    name: '60 / 40',
    family: 'Allocation',
    summary: 'Rebalance to 60% equity and 40% cash each month.',
    rule: '60% equity / 40% cash; the defensive allocation is cash, not bonds.',
  },
  {
    id: 'trend',
    name: 'Trend following',
    family: 'Trend',
    summary: 'Invest when the market is above its trailing average.',
    rule: '100% equity if the latest completed market index exceeds the mean of its last 10 completed month-end levels; otherwise cash.',
  },
  {
    id: 'momentum',
    name: 'Absolute momentum',
    family: 'Momentum',
    summary: 'Invest when the market has outgrown cash over the last year.',
    rule: '100% equity if prior 12-month market growth exceeds prior 12-month cash growth; otherwise cash.',
  },
  {
    id: 'reversal',
    name: 'Short-term reversal',
    family: 'Mean reversion',
    summary: 'Invest after a negative three-month market return.',
    rule: '100% equity if the prior 3-month compounded market return is negative; otherwise cash.',
  },
  {
    id: 'volatility',
    name: 'Volatility targeting',
    family: 'Risk sizing',
    summary: 'Reduce equity exposure when trailing volatility is high.',
    rule: 'Equity weight = min(1, 10% / annualized sample standard deviation of prior 12 monthly market returns); zero volatility means 100% equity.',
  },
  {
    id: 'breakout',
    name: '12-month breakout',
    family: 'Breakout',
    summary: 'Invest after a new closing high.',
    rule: '100% equity if the latest completed market index exceeds every one of the preceding 12 completed month-end levels; otherwise cash.',
  },
] as const

export type StrategyId = (typeof STRATEGIES)[number]['id']
export type LabConfig = {
  costBps: number
  selectedStrategy: StrategyId
  bootstrapSeed: number
}
export const DEFAULT_LAB_CONFIG: LabConfig = {
  costBps: 10,
  selectedStrategy: 'trend',
  bootstrapSeed: 20261022,
}

export type LedgerRow = {
  date: string
  targetWeight: number
  previousWeight: number
  turnover: number
  costFraction: number
  grossReturn: number
  netReturn: number
  equity: number
  drawdown: number
}
export type LabMetrics = {
  totalReturn: number
  cagr: number
  annualVol: number
  sharpe: number | null
  maxDrawdown: number
  annualTurnover: number
  averageExposure: number
  worstMonth: number
}
export type Backtest = { metrics: LabMetrics; ledger: LedgerRow[] }
export type StrategyResult = Backtest & { id: StrategyId; name: string }
export type WalkForwardFold = {
  trainStart: string
  trainEnd: string
  testStart: string
  testEnd: string
  chosenId: StrategyId
  trainingSharpe: number | null
  testReturn: number
}
export type BootstrapInterval = {
  metric: 'annualized mean return difference'
  estimate: number
  low: number
  high: number
  blockLength: 6
  replicates: 1000
  seed: number
}
export type LabEvaluation = {
  version: typeof LAB_VERSION
  config: LabConfig
  split: {
    warmupEnd: string
    developmentStart: string
    holdoutStart: string
    holdoutEnd: string
    developmentMonths: number
    holdoutMonths: number
  }
  results: StrategyResult[]
  walkForward: Backtest & { folds: WalkForwardFold[] }
  frozenSelection: Backtest & { chosenId: StrategyId; trainingSharpe: number | null }
  costSensitivity: { costBps: number; cagr: number; totalReturn: number }[]
  uncertainty: BootstrapInterval
}

const WARMUP_MONTHS = 24
const MIN_TRAINING_MONTHS = 60
const FINAL_MONTHS = 60
const MIN_ROWS = 156

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Sample standard deviation (n - 1 denominator); a singleton has zero dispersion. */
export function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  let average = 0
  let sumSquares = 0
  values.forEach((value, index) => {
    const delta = value - average
    average += delta / (index + 1)
    sumSquares += delta * (value - average)
  })
  return Math.sqrt(Math.max(0, sumSquares / (values.length - 1)))
}

export function validateMonthlyRows(rows: readonly MonthlyRow[], minimum = MIN_ROWS): void {
  if (!Array.isArray(rows) || rows.length < minimum)
    throw new Error(`At least ${minimum} consecutive monthly observations are required.`)
  if (rows.length > 1500) throw new Error('The lab supports at most 1,500 monthly observations.')
  let previousMonth: number | undefined
  rows.forEach((row, index) => {
    if (!row || typeof row.date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.date))
      throw new Error(`Observation ${index + 1} must use a YYYY-MM date.`)
    const month = Number(row.date.slice(0, 4)) * 12 + Number(row.date.slice(5)) - 1
    if (previousMonth !== undefined && month !== previousMonth + 1)
      throw new Error('Monthly observations must be consecutive, unique, and in date order.')
    previousMonth = month
    for (const key of ['marketReturn', 'cashReturn'] as const) {
      if (!Number.isFinite(row[key]) || row[key] <= -1 || row[key] > 10)
        throw new Error(
          `${row.date}: ${key} must be a finite decimal return greater than -1 and at most 10.`,
        )
    }
  })
}

function validateCost(costBps: number): void {
  if (!Number.isFinite(costBps) || costBps < 0 || costBps > 100)
    throw new Error('Transaction cost must be between 0 and 100 basis points.')
}

function validateStrategy(id: StrategyId): void {
  if (!STRATEGIES.some((strategy) => strategy.id === id))
    throw new Error(`Unknown strategy: ${String(id)}.`)
}

function validateSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Bootstrap seed must be an unsigned 32-bit integer.')
}

/** Log wealth avoids overflow in signal comparisons. Level[i] predates return[i]. */
function marketHistory(rows: readonly MonthlyRow[]): number[] {
  const levels = [0]
  rows.forEach((row, index) => levels.push(levels[index] + Math.log1p(row.marketReturn)))
  return levels
}

function weightFor(
  rows: readonly MonthlyRow[],
  levels: readonly number[],
  id: StrategyId,
  month: number,
): number {
  if (id === 'market') return 1
  if (id === 'cash') return 0
  if (id === 'balanced') return 0.6
  const requiredHistory = id === 'trend' ? 10 : id === 'reversal' ? 3 : id === 'breakout' ? 13 : 12
  if (month < requiredHistory)
    throw new Error(`${id} requires ${requiredHistory} completed monthly observations.`)
  if (id === 'trend') {
    const recent = levels.slice(month - 9, month + 1)
    const maximum = Math.max(...recent)
    // Log-sum-exp computes the arithmetic mean of wealth levels, not a log mean.
    const logAverage = maximum + Math.log(mean(recent.map((level) => Math.exp(level - maximum))))
    return levels[month] > logAverage ? 1 : 0
  }
  if (id === 'momentum') {
    const history = rows.slice(month - 12, month)
    return history.reduce((sum, row) => sum + Math.log1p(row.marketReturn), 0) >
      history.reduce((sum, row) => sum + Math.log1p(row.cashReturn), 0)
      ? 1
      : 0
  }
  if (id === 'reversal') {
    return rows
      .slice(month - 3, month)
      .reduce((sum, row) => sum + Math.log1p(row.marketReturn), 0) < 0
      ? 1
      : 0
  }
  if (id === 'volatility') {
    const annualVol =
      sampleStandardDeviation(rows.slice(month - 12, month).map((row) => row.marketReturn)) *
      Math.sqrt(12)
    return annualVol === 0 ? 1 : Math.min(1, 0.1 / annualVol)
  }
  if (id === 'breakout') return levels[month] > Math.max(...levels.slice(month - 12, month)) ? 1 : 0
  throw new Error(`Unknown strategy: ${String(id)}.`)
}

/** The weight for month i uses only observations [0, i), never return[i]. */
export function strategyWeight(rows: readonly MonthlyRow[], id: StrategyId, month: number): number {
  validateMonthlyRows(rows, 1)
  validateStrategy(id)
  if (!Number.isInteger(month) || month < 0 || month >= rows.length)
    throw new Error('Signal month must be an observation index inside the data.')
  return weightFor(rows, marketHistory(rows), id, month)
}

function assertFiniteResult(values: readonly number[]): void {
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error('These inputs exceed the numeric range of the monthly research engine.')
}

function execute(
  rows: readonly MonthlyRow[],
  start: number,
  end: number,
  weightAt: (month: number) => number,
  costBps: number,
): Backtest {
  let equity = 1
  let peak = 1
  let previousWeight = 0
  const ledger: LedgerRow[] = []
  const excessReturns: number[] = []
  for (let month = start; month < end; month++) {
    const row = rows[month]
    const targetWeight = weightAt(month)
    if (!Number.isFinite(targetWeight) || targetWeight < 0 || targetWeight > 1)
      throw new Error('Every target equity weight must be between zero and one.')
    const turnover = Math.abs(targetWeight - previousWeight)
    const costFraction = (turnover * costBps) / 10_000
    const grossReturn = targetWeight * row.marketReturn + (1 - targetWeight) * row.cashReturn
    // Algebraically (1 - fee) * (1 + gross) - 1, without cancellation near zero.
    const netReturn = grossReturn - costFraction * (1 + grossReturn)
    equity *= 1 + netReturn
    peak = Math.max(peak, equity)
    const drawdown = Math.max(0, 1 - equity / peak)
    assertFiniteResult([turnover, costFraction, grossReturn, netReturn, equity, drawdown])
    if (equity <= 0) throw new Error('The compounded equity value fell outside the numeric range.')
    ledger.push({
      date: row.date,
      targetWeight,
      previousWeight,
      turnover,
      costFraction,
      grossReturn,
      netReturn,
      equity,
      drawdown,
    })
    excessReturns.push(netReturn - row.cashReturn)
    // Proportional fees leave allocation unchanged; returns then cause allocation drift.
    previousWeight = (targetWeight * (1 + row.marketReturn)) / (1 + grossReturn)
    previousWeight = Math.min(1, Math.max(0, previousWeight))
  }
  const netReturns = ledger.map((row) => row.netReturn)
  const excessVol = sampleStandardDeviation(excessReturns)
  const metrics: LabMetrics = {
    totalReturn: equity - 1,
    cagr: equity ** (12 / ledger.length) - 1,
    annualVol: sampleStandardDeviation(netReturns) * Math.sqrt(12),
    sharpe: excessVol === 0 ? null : (mean(excessReturns) / excessVol) * Math.sqrt(12),
    maxDrawdown: Math.max(...ledger.map((row) => row.drawdown)),
    annualTurnover: (ledger.reduce((sum, row) => sum + row.turnover, 0) * 12) / ledger.length,
    averageExposure: mean(ledger.map((row) => row.targetWeight)),
    worstMonth: Math.min(...netReturns),
  }
  assertFiniteResult(Object.values(metrics).filter((value): value is number => value !== null))
  return { metrics, ledger }
}

function validateWindow(rows: readonly MonthlyRow[], start: number, end: number): void {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > rows.length ||
    end <= start
  )
    throw new Error('Backtest window must be nonempty and inside the observations.')
}

/** Run one fixed rule on [start, end), starting with equity 1 entirely in cash. */
export function backtestStrategy(
  rows: readonly MonthlyRow[],
  id: StrategyId,
  start: number,
  end: number,
  costBps: number,
): Backtest {
  validateMonthlyRows(rows, 1)
  validateStrategy(id)
  validateWindow(rows, start, end)
  validateCost(costBps)
  const levels = marketHistory(rows)
  return execute(rows, start, end, (month) => weightFor(rows, levels, id, month), costBps)
}

/** Execute a supplied target schedule, preserving actual drift across strategy switches. */
export function backtestWeights(
  rows: readonly MonthlyRow[],
  weights: readonly number[],
  start: number,
  costBps: number,
): Backtest {
  validateMonthlyRows(rows, 1)
  validateWindow(rows, start, start + weights.length)
  validateCost(costBps)
  return execute(rows, start, start + weights.length, (month) => weights[month - start], costBps)
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function percentile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability
  const left = Math.floor(position)
  return sorted[left] + (sorted[Math.ceil(position)] - sorted[left]) * (position - left)
}

/**
 * Paired, noncircular moving-block bootstrap of the annualized arithmetic mean
 * difference. Conditional on these two observed return streams; not an alpha test.
 */
export function pairedMeanDifferenceInterval(
  selected: readonly number[],
  benchmark: readonly number[],
  seed: number,
): BootstrapInterval {
  validateSeed(seed)
  const blockLength = 6
  const replicates = 1000
  if (selected.length !== benchmark.length || selected.length < blockLength)
    throw new Error('Paired bootstrap streams must have equal lengths of at least six months.')
  assertFiniteResult([...selected, ...benchmark])
  const differences = selected.map((value, index) => value - benchmark[index])
  const random = seededRandom(seed)
  const samples: number[] = []
  for (let replicate = 0; replicate < replicates; replicate++) {
    let sum = 0
    let count = 0
    while (count < differences.length) {
      const start = Math.floor(random() * (differences.length - blockLength + 1))
      for (let offset = 0; offset < blockLength && count < differences.length; offset++, count++)
        sum += differences[start + offset]
    }
    samples.push((12 * sum) / differences.length)
  }
  samples.sort((a, b) => a - b)
  const result: BootstrapInterval = {
    metric: 'annualized mean return difference',
    estimate: 12 * mean(differences),
    low: percentile(samples, 0.025),
    high: percentile(samples, 0.975),
    blockLength,
    replicates,
    seed,
  }
  assertFiniteResult([result.estimate, result.low, result.high])
  return result
}

/** Evaluate fixed rules and a transparent expanding-window selector on past data. */
export function evaluateLab(rows: readonly MonthlyRow[], config: LabConfig): LabEvaluation {
  validateMonthlyRows(rows)
  if (!config) throw new Error('A lab configuration is required.')
  validateCost(config.costBps)
  validateStrategy(config.selectedStrategy)
  validateSeed(config.bootstrapSeed)
  const holdoutStart = rows.length - FINAL_MONTHS
  const walkStart = WARMUP_MONTHS + MIN_TRAINING_MONTHS
  const levels = marketHistory(rows)
  const weights = Object.fromEntries(
    STRATEGIES.map(({ id }) => [
      id,
      rows.map((_, month) => (month < WARMUP_MONTHS ? 0 : weightFor(rows, levels, id, month))),
    ]),
  ) as Record<StrategyId, number[]>
  const run = (id: StrategyId, start: number, end: number, cost = config.costBps) =>
    execute(rows, start, end, (month) => weights[id][month], cost)
  const choose = (end: number) => {
    // Undefined Sharpe ranks below every finite score. If all are undefined,
    // descriptor order deterministically retains Market, the first candidate.
    let chosenId: StrategyId = 'market'
    let trainingSharpe: number | null = null
    let bestScore = -Infinity
    for (const strategy of STRATEGIES) {
      if (strategy.id === 'cash') continue
      const sharpe = run(strategy.id, WARMUP_MONTHS, end).metrics.sharpe
      const score = sharpe ?? -Infinity
      if (score > bestScore) {
        bestScore = score
        chosenId = strategy.id
        trainingSharpe = sharpe
      }
    }
    return { chosenId, trainingSharpe }
  }

  const folds: WalkForwardFold[] = []
  const walkWeights: number[] = []
  for (let start = walkStart; start < holdoutStart; start += 12) {
    const end = Math.min(start + 12, holdoutStart)
    const selection = choose(start)
    folds.push({
      trainStart: rows[WARMUP_MONTHS].date,
      trainEnd: rows[start - 1].date,
      testStart: rows[start].date,
      testEnd: rows[end - 1].date,
      ...selection,
      testReturn: 0,
    })
    walkWeights.push(...weights[selection.chosenId].slice(start, end))
  }
  const walkForward = execute(
    rows,
    walkStart,
    holdoutStart,
    (month) => walkWeights[month - walkStart],
    config.costBps,
  )
  folds.forEach((fold, index) => {
    const start = index * 12
    const end = Math.min(start + 12, walkForward.ledger.length)
    const initialEquity = start === 0 ? 1 : walkForward.ledger[start - 1].equity
    fold.testReturn = walkForward.ledger[end - 1].equity / initialEquity - 1
  })
  const finalSelection = choose(holdoutStart)
  const results = STRATEGIES.map(({ id, name }) => ({
    id,
    name,
    ...run(id, holdoutStart, rows.length),
  }))
  const selected = results.find((result) => result.id === config.selectedStrategy)!
  const market = results.find((result) => result.id === 'market')!
  return {
    version: LAB_VERSION,
    config: { ...config },
    split: {
      warmupEnd: rows[WARMUP_MONTHS - 1].date,
      developmentStart: rows[WARMUP_MONTHS].date,
      holdoutStart: rows[holdoutStart].date,
      holdoutEnd: rows[rows.length - 1].date,
      developmentMonths: holdoutStart - WARMUP_MONTHS,
      holdoutMonths: FINAL_MONTHS,
    },
    results,
    walkForward: { ...walkForward, folds },
    frozenSelection: {
      ...finalSelection,
      ...run(finalSelection.chosenId, holdoutStart, rows.length),
    },
    costSensitivity: [0, 5, 10, 25, 50].map((costBps) => {
      const { cagr, totalReturn } = run(
        config.selectedStrategy,
        holdoutStart,
        rows.length,
        costBps,
      ).metrics
      return { costBps, cagr, totalReturn }
    }),
    uncertainty: pairedMeanDifferenceInterval(
      selected.ledger.map((row) => row.netReturn),
      market.ledger.map((row) => row.netReturn),
      config.bootstrapSeed,
    ),
  }
}

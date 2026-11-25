import {
  backtestStrategy,
  backtestWeights,
  sampleStandardDeviation,
  type MonthlyRow,
  type LedgerRow,
} from './engine'
import { marketEpisodes, scoreCuts, FULL_HISTORY_VERSION } from './fullHistory'

const WARMUP = 13
const TRAIN = 120
const TEST_START = WARMUP + TRAIN
const FEE = 10
export const FILTER_NAMES = {
  original: 'Original reversal',
  trend: 'Trend filter',
  vol: 'Volatility filter',
  both: 'Both filters',
  market: 'Market',
} as const
export type Variant = keyof typeof FILTER_NAMES
const variants = Object.keys(FILTER_NAMES) as Variant[]
const filterIds = ['trend', 'vol', 'both'] as const

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
}
function growth(ledger: LedgerRow[], first: number, last: number) {
  return ledger[last].equity / (first === 0 ? 1 : ledger[first - 1].equity) - 1
}

export function reversalFilterPlan(rows: MonthlyRow[]) {
  if (rows.length <= TEST_START)
    throw new Error('A test month must follow the 13-month warmup and 120 training months.')
  const original = backtestStrategy(rows, 'reversal', WARMUP, rows.length, 0).ledger
  const trend = backtestStrategy(rows, 'trend', WARMUP, rows.length, 0).ledger
  let logDrawdown = 0
  const priorDrawdowns = rows.map((r) => {
    const dd = -Math.expm1(logDrawdown)
    logDrawdown = Math.min(0, logDrawdown + Math.log1p(r.marketReturn))
    return dd
  })
  const signals = original.map((m, j) => {
    const i = j + WARMUP
    const past = rows.slice(i - 12, i).map((r) => r.marketReturn)
    return {
      target: m.targetWeight,
      weak: trend[j].targetWeight === 0,
      vol: sampleStandardDeviation(past) * Math.sqrt(12),
      drawdown: priorDrawdowns[i],
      trailingReturn: past.slice(-3).reduce((w, r) => w * (1 + r), 1) - 1,
    }
  })
  const weights: Record<Variant, number[]> = {
    original: [],
    trend: [],
    vol: [],
    both: [],
    market: [],
  }
  const folds = []
  // A veto persists until the raw rule re-enters equity, including across refits.
  const position = {
    trend: signals[TRAIN - 1].target,
    vol: signals[TRAIN - 1].target,
    both: signals[TRAIN - 1].target,
  }
  for (let first = TRAIN; first < signals.length; first += 12) {
    const last = Math.min(first + 12, signals.length)
    const cutoff = median(signals.slice(first - TRAIN, first).map((s) => s.vol))
    folds.push({ first: first + WARMUP, end: last + WARMUP, cutoff })
    for (let j = first; j < last; j++) {
      const s = signals[j]
      const high = s.vol > cutoff
      for (const id of filterIds) {
        if (s.target === 1) position[id] = 1
        else if (signals[j - 1].target === 1) {
          const admit = id === 'trend' ? s.weak : id === 'vol' ? high : s.weak && high
          position[id] = admit ? 0 : 1
        }
        weights[id].push(position[id])
      }
      weights.original.push(s.target)
      weights.market.push(1)
    }
  }
  return { signals, folds, weights }
}

export function studyReversalFilters(rows: MonthlyRow[]) {
  const { weights, signals, folds } = reversalFilterPlan(rows)
  const { episodes, unresolvedOnset } = marketEpisodes(rows)
  const originalFull = scoreCuts(
    signals.map((s) => s.target),
    WARMUP,
    episodes,
    unresolvedOnset,
    'half',
  )
  const date = (i: number) => rows[i].date
  const falseSet = new Set(originalFull.falseAlarms)
  const hits = new Map(originalFull.matches.filter((m) => m.lead !== null).map((m) => [m.cut!, m]))
  const alarms = signals.flatMap((s, j) => {
    if (j === 0 || s.target !== 0 || signals[j - 1].target !== 1) return []
    const i = j + WARMUP,
      k = i - TEST_START
    const fold = k >= 0 ? folds[Math.floor(k / 12)] : null
    const hit = hits.get(i)
    return [
      {
        date: date(i),
        through: date(i - 1),
        outcome: hit
          ? hit.lead === 0
            ? 'At onset'
            : 'Early'
          : falseSet.has(i)
            ? 'False alarm'
            : 'Unscored',
        onset: hit ? date(hit.onset) : null,
        lead: hit?.lead ?? null,
        weak: s.weak,
        vol: s.vol,
        drawdown: s.drawdown,
        trailingReturn: s.trailingReturn,
        cutoff: fold?.cutoff ?? null,
        admitted: fold
          ? {
              trend: weights.trend[k] === 0,
              vol: weights.vol[k] === 0,
              both: weights.both[k] === 0,
            }
          : null,
      },
    ]
  })
  const runs = variants.map((id) => ({
    id,
    ...backtestWeights(rows, weights[id], TEST_START, FEE),
  }))
  const original = runs[0],
    market = runs.find((r) => r.id === 'market')!
  const reboundIndexes = episodes.flatMap((e) => {
    const first = Math.max(e.trough + 1, TEST_START),
      last = e.recovery ?? rows.length - 1
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, n) => first + n - TEST_START)
  })
  const rules = runs.map((run) => {
    const score = scoreCuts(weights[run.id], TEST_START, episodes, unresolvedOnset, 'half')
    let gross = 1,
      feesPaid = 0
    run.ledger.forEach((m, i) => {
      gross *= 1 + m.grossReturn
      feesPaid += 100 * (i ? run.ledger[i - 1].equity : 1) * m.costFraction
    })
    const reboundGap = (base: LedgerRow[]) =>
      reboundIndexes.length
        ? reboundIndexes.reduce(
            (sum, i) => sum + (run.ledger[i].netReturn - base[i].netReturn),
            0,
          ) / reboundIndexes.length
        : null
    return {
      id: run.id,
      name: FILTER_NAMES[run.id],
      early: score.early,
      atOnset: score.atOnset,
      missed: score.missed,
      falseAlarms: score.falseAlarms.length,
      unscored: score.unscored.length,
      precision: score.precision,
      medianLead: score.medianLead,
      cagr: run.metrics.cagr,
      vsOriginal: run.metrics.cagr - original.metrics.cagr,
      vsMarket: run.metrics.cagr - market.metrics.cagr,
      ending: 100 * run.ledger.at(-1)!.equity,
      maxDrawdown: run.metrics.maxDrawdown,
      averageEquity: run.metrics.averageExposure,
      feesPaid,
      feeDrag: gross ** (12 / run.ledger.length) - 1 - run.metrics.cagr,
      reboundVsOriginal: reboundGap(original.ledger),
      reboundVsMarket: reboundGap(market.ledger),
      earlyOnsets: score.matches.filter((m) => m.status === 'Early').map((m) => date(m.onset)),
    }
  })
  return {
    version: 'reversal-filters-1',
    eventVersion: FULL_HISTORY_VERSION,
    sourceStart: date(0),
    sourceEnd: date(rows.length - 1),
    start: date(TEST_START),
    months: rows.length - TEST_START,
    feeBp: FEE,
    reboundMonths: reboundIndexes.length,
    alarms,
    rules,
    folds: folds.map((f) => ({
      trainStart: date(f.first - TRAIN),
      trainEnd: date(f.first - 1),
      start: date(f.first),
      end: date(f.end - 1),
      cutoff: f.cutoff,
      returns: Object.fromEntries(
        runs.map((r) => [r.id, growth(r.ledger, f.first - TEST_START, f.end - 1 - TEST_START)]),
      ) as Record<Variant, number>,
    })),
  }
}
export type ReversalStudy = ReturnType<typeof studyReversalFilters>

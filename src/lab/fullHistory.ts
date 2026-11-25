import {
  backtestStrategy,
  STRATEGIES,
  LAB_VERSION,
  type MonthlyRow,
  type LedgerRow,
} from './engine'

const WARMUP = 13
const HORIZON = 6
const FEE = 10
const LOSS = 0.15
export const FULL_HISTORY_VERSION = 'history-events-1'
export type CutMode = 'half' | 'partial'
type Episode = {
  onset: number
  breach: number
  trough: number
  recovery: number | null
  depth: number
}

// Track underwater spells across the entire source, including the signal warmup.
export function marketEpisodes(rows: readonly MonthlyRow[]) {
  const episodes: Episode[] = []
  let logRelative = 0,
    onset = -1,
    trough = -1,
    depth = 0,
    breach = -1
  function record(recovery: number | null) {
    if (breach >= 0) episodes.push({ onset, breach, trough, depth, recovery })
  }
  for (let i = 0; i < rows.length; i++) {
    logRelative += Math.log1p(rows[i].marketReturn)
    if (logRelative >= -1e-14) {
      record(i)
      logRelative = 0
      onset = -1
      breach = -1
      depth = 0
      continue
    }
    if (onset < 0) onset = i
    const loss = -Math.expm1(logRelative)
    if (loss > depth) {
      depth = loss
      trough = i
    }
    if (breach < 0 && loss >= LOSS - 1e-14) breach = i
  }
  record(null)
  return { episodes, unresolvedOnset: onset >= 0 && breach < 0 ? onset : null }
}

export function scoreCuts(
  weights: readonly number[],
  start: number,
  events: readonly Episode[],
  unresolved: number | null,
  mode: CutMode,
) {
  const defensive = (w: number) => (mode === 'partial' ? w < 1 : w <= 0.5)
  const cuts: { start: number; end: number }[] = []
  for (let i = 1; i < weights.length; i++) {
    if (!defensive(weights[i - 1]) && defensive(weights[i]))
      cuts.push({ start: i + start, end: start + weights.length - 1 })
    if (defensive(weights[i - 1]) && !defensive(weights[i]) && cuts.length)
      cuts[cuts.length - 1].end = i + start - 1
  }
  const used = new Set<number>()
  const matches = events
    .map((e) => {
      const active = cuts.find((c) => c.start <= e.onset && e.onset <= c.end)
      const cut =
        active && !used.has(active.start) && e.onset - active.start <= HORIZON ? active : null
      if (cut) used.add(cut.start)
      const lead = cut ? e.onset - cut.start : null
      const later = cuts.find((c) => e.onset < c.start && c.start <= e.breach)
      const onsetWeight = weights[e.onset - start]
      const status =
        lead !== null
          ? lead === 0
            ? 'At onset'
            : 'Early'
          : defensive(onsetWeight)
            ? 'Already defensive'
            : later
              ? 'After onset'
              : 'No cut by breach'
      return {
        onset: e.onset,
        cut: active?.start ?? (status === 'After onset' ? later!.start : null),
        lead,
        status,
      }
    })
    .filter((m) => m.onset >= start + 1 + HORIZON)
  const falseAlarms: number[] = [],
    unscored: number[] = []
  for (const cut of cuts) {
    if (used.has(cut.start)) continue
    const last = cut.start + HORIZON
    const pending =
      last >= start + weights.length ||
      (unresolved !== null && unresolved >= cut.start && unresolved <= Math.min(cut.end, last))
    const bucket = pending ? unscored : falseAlarms
    bucket.push(cut.start)
  }
  const leads = matches
    .flatMap((m) => (m.lead !== null && m.lead > 0 ? [m.lead] : []))
    .sort((a, b) => a - b)
  const n = leads.length
  const atOnset = matches.filter((m) => m.lead === 0).length
  const hits = n + atOnset
  return {
    early: n,
    atOnset,
    missed: matches.length - hits,
    medianLead: n ? (leads[Math.floor((n - 1) / 2)] + leads[Math.floor(n / 2)]) / 2 : null,
    precision: hits + falseAlarms.length ? hits / (hits + falseAlarms.length) : null,
    falseAlarms,
    unscored,
    matches,
  }
}

function compounded(ledger: readonly LedgerRow[], start: number, end: number) {
  return ledger[end].equity / (start > 0 ? ledger[start - 1].equity : 1) - 1
}

export function studyHistory(rows: MonthlyRow[]) {
  const { episodes, unresolvedOnset } = marketEpisodes(rows)
  const eligible = episodes.filter((e) => e.onset >= WARMUP + 1 + HORIZON)
  const date = (i: number) => rows[i].date
  const dateOrNull = (i: number | null) => (i === null ? null : date(i))
  const market = backtestStrategy(rows, 'market', WARMUP, rows.length, FEE)
  const rules = STRATEGIES.map(({ id, name }) => {
    const run = id === 'market' ? market : backtestStrategy(rows, id, WARMUP, rows.length, FEE)
    const weights = run.ledger.map((m) => m.targetWeight)
    function score(mode: CutMode) {
      const result = scoreCuts(weights, WARMUP, episodes, unresolvedOnset, mode)
      return {
        ...result,
        falseAlarms: result.falseAlarms.map(date),
        unscored: result.unscored.map(date),
        matches: result.matches.map((m) => ({
          ...m,
          onset: date(m.onset),
          cut: dateOrNull(m.cut),
        })),
      }
    }
    let reboundMonths = 0,
      reboundSum = 0,
      feesPaid = 0,
      grossWealth = 1
    run.ledger.forEach((m, i) => {
      feesPaid += 100 * (i === 0 ? 1 : run.ledger[i - 1].equity) * m.costFraction
      grossWealth *= 1 + m.grossReturn
    })
    const rebounds = eligible.map((e) => {
      const first = e.trough + 1 - WARMUP,
        last = (e.recovery ?? rows.length - 1) - WARMUP
      if (first > last) return null
      for (let i = first; i <= last; i++) {
        reboundMonths++
        reboundSum += run.ledger[i].netReturn - market.ledger[i].netReturn
      }
      return compounded(run.ledger, first, last) - compounded(market.ledger, first, last)
    })
    return {
      id,
      name,
      half: score('half'),
      partial: score('partial'),
      cagr: run.metrics.cagr,
      cagrGap: run.metrics.cagr - market.metrics.cagr,
      endWealth: 100 * run.ledger.at(-1)!.equity,
      marketWealthGap: 100 * (run.ledger.at(-1)!.equity - market.ledger.at(-1)!.equity),
      maxDrawdown: run.metrics.maxDrawdown,
      averageEquity: run.metrics.averageExposure,
      feesPaid,
      feeDrag: grossWealth ** (12 / run.ledger.length) - 1 - run.metrics.cagr,
      rebounds,
      reboundMonths,
      reboundGap: reboundMonths ? reboundSum / reboundMonths : null,
    }
  })
  return {
    version: FULL_HISTORY_VERSION,
    engine: LAB_VERSION,
    sourceStart: date(0),
    sourceEnd: date(rows.length - 1),
    observations: rows.length,
    start: date(WARMUP),
    months: rows.length - WARMUP,
    feeBp: FEE,
    horizon: HORIZON,
    loss: LOSS,
    unresolved: dateOrNull(unresolvedOnset),
    excludedEvents: episodes.length - eligible.length,
    episodes: eligible.map((e) => ({
      onset: date(e.onset),
      breach: date(e.breach),
      trough: date(e.trough),
      recovery: dateOrNull(e.recovery),
      depth: e.depth,
    })),
    rules,
  }
}
export type FullStudy = ReturnType<typeof studyHistory>

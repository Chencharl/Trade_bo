import { backtestWeights, type MonthlyRow } from './engine'
import { exposurePlan } from './exposureStudy'

export const TIMING_VERSION = 'timing-null-1'
export const TIMING_DRAWS = 10_000
const feeBp = 10
const rules = ['trend', 'original', 'trendMix', 'originalMix'] as const
const endpoints = [
  'residual',
  'trendReturn',
  'trendDrawdown',
  'originalReturn',
  'originalDrawdown',
] as const
export type Endpoint = (typeof endpoints)[number]
type Scores = Record<Endpoint, number>
const originalStock = (state: number) => Number(state === 2)
const trendStock = (state: number) => Number(state !== 0)

// Joint states: 0 = both cash, 1 = filtered only invested, 2 = both invested.
export function foldPaths(actual: number[], incoming: number) {
  if (
    actual.length < 1 ||
    actual.length > 12 ||
    ![incoming, ...actual].every((v) => Number.isInteger(v) && v >= 0 && v <= 2)
  )
    throw Error('Expected 1–12 joint stock/cash positions.')
  const edges = Array<number>(9).fill(0)
  let prev = incoming
  for (const next of actual) {
    edges[3 * prev + next]++
    prev = next
  }
  const paths: number[][] = [],
    prefix: number[] = []
  function visit(state: number) {
    if (prefix.length === actual.length) {
      if (state === actual.at(-1)) paths.push([...prefix])
      return
    }
    for (let next = 0; next < 3; next++) {
      const edge = state * 3 + next
      if (!edges[edge]) continue
      edges[edge]--
      prefix.push(next)
      visit(next)
      prefix.pop()
      edges[edge]++
    }
  }
  visit(incoming)
  return paths
}

export function distribution(values: number[], observed: number, lowerWins: boolean) {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length
  function quantile(p: number) {
    const x = (n - 1) * p,
      lo = Math.floor(x)
    return sorted[lo] + (sorted[Math.ceil(x)] - sorted[lo]) * (x - lo)
  }
  let better = 0,
    ties = 0
  for (const x of sorted) {
    if (Math.abs(x - observed) <= 1e-12) ties++
    else if (lowerWins ? x < observed : x > observed) better++
  }
  const matched = better + ties
  const min = Math.min(observed, sorted[0]),
    max = Math.max(observed, sorted[n - 1])
  const bins = Array<number>(24).fill(0)
  for (const v of sorted) {
    const i = max === min ? 0 : Math.floor(((v - min) / (max - min)) * bins.length)
    bins[Math.min(i, bins.length - 1)]++
  }
  return {
    observed,
    low: quantile(0.025),
    median: quantile(0.5),
    high: quantile(0.975),
    better,
    ties,
    matched,
    p: (1 + matched) / (1 + n),
    percentile: (100 * (n - better - ties / 2)) / n,
    min,
    max,
    bins,
  }
}

export function studyTiming(
  rows: MonthlyRow[],
  choose: (size: number) => number,
  draws = TIMING_DRAWS,
) {
  if (!Number.isSafeInteger(draws) || draws < 1) throw Error('Expected a positive number of draws.')
  const { schedules, start, means } = exposurePlan(rows)
  const months = rows.length - start
  function execution(delay: boolean) {
    function run(id: (typeof rules)[number]) {
      const original = schedules[id],
        weights = delay ? [0, ...original.slice(0, -1)] : original
      const { metrics, ledger } = backtestWeights(rows, weights, start, feeBp)
      return {
        net: metrics.cagr,
        drawdown: metrics.maxDrawdown,
        gross: Math.expm1(
          (ledger.reduce((sum, m) => sum + Math.log1p(m.grossReturn), 0) * 12) / months,
        ),
      }
    }
    const trend = run('trend'),
      original = run('original'),
      trendMix = run('trendMix'),
      originalMix = run('originalMix')
    return {
      trend,
      original,
      trendMix,
      originalMix,
      residual: trend.gross - original.gross - (trendMix.gross - originalMix.gross),
    }
  }
  const actual = execution(false),
    delayed = execution(true)
  const scores: Scores = {
    residual: actual.residual,
    trendReturn: actual.trend.net,
    trendDrawdown: actual.trend.drawdown,
    originalReturn: actual.original.net,
    originalDrawdown: actual.original.drawdown,
  }
  const states = schedules.original.map((o, i) => {
    if (o > schedules.trend[i]) throw Error('Trend gate lost the joint holding constraint.')
    return o + schedules.trend[i]
  })
  const folds = means.map(({ first, end }) => {
    const from = first - start,
      until = end - start,
      observed = states.slice(from, until),
      incoming = from ? states[from - 1] : 0
    const paths = foldPaths(observed, incoming)
    function counts(held: (state: number) => number) {
      let previous = held(incoming),
        buys = 0,
        sales = 0,
        stockMonths = 0
      for (const state of observed) {
        const target = held(state)
        stockMonths += target
        if (target > previous) buys++
        if (target < previous) sales++
        previous = target
      }
      return { stockMonths, buys, sales, trades: buys + sales }
    }
    return {
      paths,
      info: {
        start: rows[first].date,
        end: rows[end - 1].date,
        months: end - first,
        incoming,
        closing: observed.at(-1)!,
        choices: paths.length,
        trend: counts(trendStock),
        original: counts(originalStock),
      },
    }
  })
  const market = rows.slice(start).map((r) => 1 + r.marketReturn),
    cash = rows.slice(start).map((r) => 1 + r.cashReturn)
  const feeFactor = 1 - feeBp / 10000
  const fixedGap = actual.trendMix.gross - actual.originalMix.gross
  const sample = {
    residual: [],
    trendReturn: [],
    trendDrawdown: [],
    originalReturn: [],
    originalDrawdown: [],
  } as Record<Endpoint, number[]>
  for (let draw = 0; draw < draws; draw++) {
    let t = 1,
      o = 1,
      tGross = 1,
      oGross = 1,
      tPeak = 1,
      oPeak = 1,
      tLoss = 0,
      oLoss = 0,
      previous = 0,
      i = 0
    for (const { paths } of folds) {
      const path = paths[paths.length === 1 ? 0 : choose(paths.length)]
      for (const state of path) {
        const trend = trendStock(state),
          original = originalStock(state)
        const tf = trend ? market[i] : cash[i],
          of = original ? market[i] : cash[i]
        tGross *= tf
        oGross *= of
        t *= tf * (trend !== trendStock(previous) ? feeFactor : 1)
        o *= of * (original !== originalStock(previous) ? feeFactor : 1)
        tPeak = Math.max(t, tPeak)
        oPeak = Math.max(o, oPeak)
        tLoss = Math.max(tLoss, 1 - t / tPeak)
        oLoss = Math.max(oLoss, 1 - o / oPeak)
        previous = state
        i++
      }
    }
    const annual = 12 / months
    sample.residual.push(tGross ** annual - oGross ** annual - fixedGap)
    sample.trendReturn.push(t ** annual - 1)
    sample.trendDrawdown.push(tLoss)
    sample.originalReturn.push(o ** annual - 1)
    sample.originalDrawdown.push(oLoss)
  }
  const results = Object.fromEntries(
    endpoints.map((id) => [id, distribution(sample[id], scores[id], id.endsWith('Drawdown'))]),
  ) as Record<Endpoint, ReturnType<typeof distribution>>
  return {
    version: TIMING_VERSION,
    draws,
    seed: '20261125',
    start: rows[start].date,
    end: rows.at(-1)!.date,
    months,
    feeBp,
    actual,
    delayed,
    results,
    folds: folds.map((f) => f.info),
  }
}
export type TimingStudy = ReturnType<typeof studyTiming>

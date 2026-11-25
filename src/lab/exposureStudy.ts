import { backtestWeights, type MonthlyRow } from './engine'
import { reversalFilterPlan } from './reversalFilters'
import { marketEpisodes } from './fullHistory'

const ids = ['original', 'originalMix', 'trend', 'trendMix', 'market'] as const
export type ExposureId = (typeof ids)[number]
type ByPortfolio<T> = Record<ExposureId, T>
function byPortfolio<T>(get: (id: ExposureId) => T): ByPortfolio<T> {
  return Object.fromEntries(ids.map((id) => [id, get(id)])) as ByPortfolio<T>
}

export function exposurePlan(rows: MonthlyRow[]) {
  const { signals, folds, weights } = reversalFilterPlan(rows)
  const start = folds[0].first,
    warmup = rows.length - signals.length,
    train = start - warmup
  let target = signals[0].target
  const initialTrend = signals.slice(0, train).map((s, i) => {
    if (s.target === 1) target = 1
    else if (i > 0 && signals[i - 1].target === 1) target = s.weak ? 0 : 1
    return target
  })
  const trendHistory = [...initialTrend, ...weights.trend]
  const means = folds.map(({ first, end }) => {
    const j = first - warmup
    const original = signals.slice(j - train, j).reduce((sum, s) => sum + s.target, 0) / train
    const trend = trendHistory.slice(j - train, j).reduce((sum, w) => sum + w, 0) / train
    return { first, end, original, trend, trainingStart: first - train, trainingEnd: first - 1 }
  })
  const schedules = {
    original: weights.original,
    trend: weights.trend,
    market: weights.market,
    originalMix: means.flatMap((f) => Array<number>(f.end - f.first).fill(f.original)),
    trendMix: means.flatMap((f) => Array<number>(f.end - f.first).fill(f.trend)),
  }
  return { start, means, schedules }
}

export function studyExposure(rows: MonthlyRow[]) {
  const { start, means, schedules } = exposurePlan(rows)
  const feeBp = 10
  const runs = byPortfolio((id) => backtestWeights(rows, schedules[id], start, feeBp))
  const rebound = marketEpisodes(rows).episodes.flatMap((e) => {
    const first = Math.max(start, e.trough + 1),
      last = e.recovery ?? rows.length - 1
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => i + first - start)
  })
  const metrics = byPortfolio((id) => {
    const { metrics, ledger } = runs[id]
    const gross = ledger.reduce((w, m) => w * (1 + m.grossReturn), 1) ** (12 / ledger.length) - 1
    const mean = (base: ExposureId) =>
      rebound.length
        ? rebound.reduce((n, i) => n + (ledger[i].netReturn - runs[base].ledger[i].netReturn), 0) /
          rebound.length
        : null
    return {
      net: metrics.cagr,
      gross,
      feeDrag: gross - metrics.cagr,
      exposure: metrics.averageExposure,
      drawdown: metrics.maxDrawdown,
      ending: ledger.at(-1)!.equity * 100,
      reboundVsMarket: mean('market'),
      reboundVsOriginal: mean('original'),
    }
  })
  function split(basis: 'net' | 'gross') {
    const originalGap = metrics.original[basis] - metrics.originalMix[basis]
    const trendGap = metrics.trend[basis] - metrics.trendMix[basis]
    return {
      total: metrics.trend[basis] - metrics.original[basis],
      allocation: metrics.trendMix[basis] - metrics.originalMix[basis],
      originalGap,
      trendGap,
      residual: trendGap - originalGap,
    }
  }
  const net = split('net'),
    gross = split('gross')
  const point = (i: number, previous: number) => ({
    date: rows[start + i].date,
    values: byPortfolio((id) => (i < 0 ? 100 : runs[id].ledger[i].equity * 100)),
    averageStock:
      i < 0
        ? null
        : byPortfolio(
            (id) =>
              schedules[id].slice(previous + 1, i + 1).reduce((sum, w) => sum + w, 0) /
              (i - previous),
          ),
    drawdowns: byPortfolio((id) => (i < 0 ? 0 : runs[id].ledger[i].drawdown)),
  })
  let previous = -1
  const chart = [point(-1, previous)]
  for (let i = 0; i < rows.length - start; i++) {
    if (Number(rows[start + i].date.slice(5)) % 3 === 0 || start + i === rows.length - 1) {
      chart.push(point(i, previous))
      previous = i
    }
  }
  return {
    version: 'exposure-controls-1',
    start: rows[start].date,
    end: rows.at(-1)!.date,
    months: rows.length - start,
    feeBp,
    reboundMonths: rebound.length,
    metrics,
    net,
    gross,
    feeContribution: net.residual - gross.residual,
    chart,
    folds: means.map((f) => ({
      trainStart: rows[f.trainingStart].date,
      trainEnd: rows[f.trainingEnd].date,
      start: rows[f.first].date,
      end: rows[f.end - 1].date,
      original: f.original,
      trend: f.trend,
      returns: byPortfolio((id) => {
        const l = runs[id].ledger
        return (
          l[f.end - start - 1].equity / (f.first === start ? 1 : l[f.first - start - 1].equity) - 1
        )
      }),
    })),
  }
}
export type ExposureStudy = ReturnType<typeof studyExposure>

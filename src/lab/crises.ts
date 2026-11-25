import { backtestStrategy } from './engine'
import type { MonthlyRow, StrategyId } from './engine'
import { importDataset } from './data'

export const EPISODES = {
  '2008': {
    name: 'Financial crisis',
    start: '2007-07',
    onset: '2007-11',
    end: '2009-06',
    initial: '2008-10',
  },
  '2020': {
    name: 'COVID-19 sell-off',
    start: '2019-10',
    onset: '2020-02',
    end: '2020-08',
    initial: '2020-03',
  },
} as const
export type EpisodeId = keyof typeof EPISODES
export const HISTORY_SOURCE =
  'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_factors.html'
export const HISTORY_ARCHIVE =
  'https://raw.githubusercontent.com/callumtoc/stat40920-group-project/e6878880db0e5a2aea34787f30a34b8a778ed133/data/raw/F-F_Research_Data_Factors.csv'
export const HISTORY_HASH = 'bda5eb94cfe0d19a02842e08907305c190f7270edf70c442bcbc12f5d9a9cf24'
export async function readHistory(bytes: Uint8Array, filename: string) {
  const dataset = await importDataset(bytes, filename, '')
  if (dataset.dataSha256 !== HISTORY_HASH)
    throw new Error(
      'This file differs from the September 2026 French snapshot. Use the archived CSV linked below.',
    )
  return dataset.rows
}

export function replayEpisode(
  rows: MonthlyRow[],
  id: EpisodeId,
  rule: StrategyId,
  costBps: number,
) {
  const event = EPISODES[id]
  const first = rows.findIndex((row) => row.date === event.start)
  const last = rows.findIndex((row) => row.date === event.end)
  // Start live positions two years before the comparison; 13 prior observations
  // cover the longest lookback. Rebase both portfolios only for display.
  const carry = 24
  if (first < carry + 13 || last < first) throw new Error('Insufficient history for this episode.')
  const start = first - carry
  const strategy = backtestStrategy(rows, rule, start, last + 1, costBps).ledger
  const market =
    rule === 'market' ? strategy : backtestStrategy(rows, 'market', start, last + 1, costBps).ledger
  const base = strategy[carry - 1].equity
  const marketBase = market[carry - 1].equity
  let latestCut: { date: string; from: number; to: number } | null = null
  let totalFees = 0
  const entries = []
  for (let i = 1; i < strategy.length; i++) {
    const month = strategy[i]
    const priorTarget = strategy[i - 1].targetWeight
    if (month.targetWeight < priorTarget)
      latestCut = { date: month.date, from: priorTarget, to: month.targetWeight }
    if (i < carry) continue
    const opening = (100 * strategy[i - 1].equity) / base
    const fee = opening * month.costFraction
    totalFees += fee
    const strategyValue = (100 * month.equity) / base
    const marketValue = (100 * market[i].equity) / marketBase
    entries.push({
      date: month.date,
      signalThrough: rows[start + i - 1].date,
      priorTarget,
      target: month.targetWeight,
      driftedWeight: month.previousWeight,
      action:
        month.targetWeight < priorTarget
          ? 'Reduced'
          : month.targetWeight > priorTarget
            ? 'Raised'
            : 'Held',
      latestCut,
      costBp: month.costFraction * 10000,
      fee,
      totalFees,
      turnover: month.turnover,
      strategyReturn: month.netReturn,
      marketReturn: market[i].netReturn,
      returnGap: month.netReturn - market[i].netReturn,
      strategyValue,
      marketValue,
      wealthGap: strategyValue - marketValue,
    })
  }
  return entries
}

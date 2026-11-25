export const keys = ['model', 'original', 'trend', 'market'] as const
export type Rule = (typeof keys)[number]
export type Values = Record<Rule, number>
type Metric = {
  ending: number
  total: number
  cagr: number
  drawdown: number
  peak: string
  trough: string
  commission: number
  slippage: number
  orders: number
  stockDays: number
}
type Trade = {
  date: string
  signal: string
  side: 'buy' | 'sell' | 'reinvest'
  open: number
  fill: number
  quantity: number
  commission: number
  slippage: number
  probability: number | null
}
export type Mark = { date: string; wealth: Values; loss: Values }
export type SpyReport = {
  version: string
  start: string
  end: string
  capital: number
  sessions: number
  modelHash: string
  metrics: Record<Rule, Metric>
  chart: Mark[]
  annual: { end: string; net: Values }[]
  trades: Record<Rule, Trade[]>
  training: {
    cutoff: string
    firstSignal: string
    lastLabel: string
    examples: number
    epochs: number
  }
  development: {
    folds: { start: string; end: string; firstSignal: string; lastLabel: string; returns: Values }[]
  }
}
export type Text = (en: string, zh: string) => string
export const pct = (n: number) => (100 * n).toFixed(2) + '%'
export const diff = (n: number) => (n < 0 ? '−' : '+') + Math.abs(100 * n).toFixed(2)
export const cash = (v: number, digits = 0) =>
  '$' + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export function names(t: Text): Record<Rule, string> {
  return {
    model: t('Neural model', '神经网络'),
    original: t('Original reversal', '原始反转'),
    trend: t('Trend filter', '趋势过滤'),
    market: t('Buy & hold SPY', '持有 SPY'),
  }
}
type Window = { net: number; commission: number; slippage: number }
export type Spell = {
  exit: string
  reentry: string | null
  days: number
  avoided: number
  missed: number
  endingEffect: number
  grossEffect: number
  drawdownEffect: number
  model: Window
  trend: Window
  trendStockDays: number
}
export type CashStudy = {
  version: string
  start: string
  end: string
  sourceHash: string
  rules: string[]
  daily: [string, number, number, number, number][]
  spells: { model: Spell[]; trend: Spell[] }
}
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const money = (n: number) => dollars.format(n)
export const signedMoney = (n: number) => (n < 0 ? '−' : '+') + money(Math.abs(n))

export const signedPercent = (n: number) => (n < 0 ? '−' : '+') + pct(Math.abs(n))

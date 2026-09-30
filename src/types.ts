export type Role = 'Core' | 'Tactical' | 'Defensive'
export type Action = 'REVIEW_ADD' | 'REVIEW_REDUCE' | 'HOLD' | 'DATA_HOLD'
export type Mode = 'demo' | 'live'
export type Page = 'portfolio' | 'research' | 'method' | 'paper'

export type HoldingInput = {
  symbol: string
  shares: number
  cost_basis: number | null
  role: Role
}

export type Model = {
  cash: number
  holdings: HoldingInput[]
  targets: Record<string, number>
  policy: {
    max_position_pct: number
    max_sector_pct: number
    min_cash_pct: number
    risk_per_trade_pct: number
    planning_stop_pct: number
    rebalance_band_pct: number
  }
  label: string
}

export type Position = HoldingInput & {
  name: string
  sector: string
  method: string
  price: number
  value: number
  weight_pct: number
  target_pct: number
  drift_pp: number
  unrealized_pl_pct: number | null
}

export type Portfolio = {
  label: string
  nav: number
  cash: number
  cash_weight_pct: number
  cash_target_pct: number
  positions: Position[]
  sectors: {
    sector: string
    value: number
    weight_pct: number
    target_pct: number
    drift_pp: number
    over_limit: boolean
    symbols: string[]
  }[]
  roles: {
    role: Role
    value: number
    weight_pct: number
    target_pct: number
    drift_pp: number
    symbols: string[]
  }[]
  targets: Record<string, number>
  policy: Model['policy']
  alerts: { severity: string; text: string }[]
  model: Model
  sample: boolean
}

export type News = {
  title: string
  source: string
  url: string
  published_at: string
  summary: string
  sentiment: string
  age_hours: number
  relevance: number
  headline_match: boolean
  exclusion_reason: string | null
  relevant: boolean
}

export type Analysis = {
  symbol: string
  name: string
  sector: string
  mode: Mode
  role: Role
  method: string
  market: {
    price: number
    as_of: string
    change_pct: number
    return_20d_pct: number
    sma20: number
    sma50: number
    trend_up: boolean
    trend_down: boolean
    volatility_annualized_pct: number
    max_drawdown_observed_pct: number
    history: { date: string; close: number }[]
  }
  overview: {
    sector: string
    market_cap: number | null
    pe_ratio: number | null
    profit_margin: number | null
    revenue_ttm: number | null
    dividend_yield: number | null
    source: string
  }
  news: News[]
  action: Action
  reason: string
  buy_gates: { id: string; label: string; passed: boolean; detail: string }[]
  sell_triggers: string[]
  relevant_article_count: number
  screened_article_count: number
  excluded_article_count: number
  independent_source_count: number
  position_shares: number
  position_value: number
  weight_pct: number
  target_pct: number
  suggested_max_add_shares: number
  review_reduce_shares: number
  planning_stop: number
  retrieved_at: string
  source_note: string
}

export type PaperOrder = {
  id: number
  mode: Mode
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  reference_close: number
  price_date: string
  status: 'DRAFT'
  matches_model: boolean
  execution_checks: string[]
  note: string
}

export type Board = {
  as_of: string
  mode: Mode
  symbols: string[]
  portfolio: Portfolio
  analyses: Analysis[]
  paper_orders: PaperOrder[]
  method: string
}

export type Answer = {
  question: string
  symbol: string
  intent: string
  answer: string
  evidence: { id: string; label: string; as_of: string; detail: string; url: string | null }[]
  limitations: string[]
}

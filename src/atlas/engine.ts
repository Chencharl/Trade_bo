/** Educational assumptions, not fitted market estimates. All returns are nominal. */
export const MODEL_VERSION = 'atlas-1'
export const PATH_COUNT = 1000
export const ASSETS = [
  {
    id: 'us',
    name: 'US equities',
    short: 'US stocks',
    color: '#5675ee',
    drift: 0.075,
    volatility: 0.18,
    factors: [0.88, -0.08],
  },
  {
    id: 'intl',
    name: 'Global ex-US',
    short: 'Intl. stocks',
    color: '#9d9ce8',
    drift: 0.065,
    volatility: 0.21,
    factors: [0.8, -0.06],
  },
  {
    id: 'bonds',
    name: 'Treasuries',
    short: 'Bonds',
    color: '#55afa9',
    drift: 0.035,
    volatility: 0.065,
    factors: [-0.15, 0.8],
  },
  {
    id: 'gold',
    name: 'Gold',
    short: 'Gold',
    color: '#dbad61',
    drift: 0.035,
    volatility: 0.16,
    factors: [0.02, 0.1],
  },
  {
    id: 'cash',
    name: 'Cash',
    short: 'Cash',
    color: '#a6b2c5',
    drift: 0.025,
    volatility: 0,
    factors: [0, 0],
  },
] as const

export const SCENARIOS = [
  {
    id: 'baseline',
    name: 'Calm waters',
    subtitle: 'No added shock',
    description:
      'A reference case with constant assumptions. Markets still fluctuate along every simulated path.',
    shocks: [0, 0, 0, 0, 0],
    volatilityMultiplier: 1,
    icon: 'waves',
  },
  {
    id: 'rates',
    name: 'Rates rise',
    subtitle: 'Bonds under pressure',
    description:
      'An illustrative rate repricing hits bonds and equities together. Gold also falls; cash has no price shock.',
    shocks: [-12, -10, -14, -5, 0],
    volatilityMultiplier: 1.15,
    icon: 'arrow',
  },
  {
    id: 'riskoff',
    name: 'Risk-off',
    subtitle: 'A flight to safety',
    description:
      'A sharp equity selloff with an assumed rally in Treasuries and gold. That protection is an assumption, not a promise.',
    shocks: [-32, -36, 8, 10, 0],
    volatilityMultiplier: 1.5,
    icon: 'storm',
  },
  {
    id: 'inflation',
    name: 'Inflation wave',
    subtitle: 'Stocks & bonds fall',
    description:
      'Equities and bonds fall together while gold rises in this constructed scenario. Results remain nominal, not inflation-adjusted.',
    shocks: [-18, -15, -12, 14, 0],
    volatilityMultiplier: 1.25,
    icon: 'flame',
  },
  {
    id: 'unwind',
    name: 'Growth unwinds',
    subtitle: 'Equity repricing',
    description:
      'US equities take the largest hit, international equities follow, and Treasuries and gold provide an assumed partial offset.',
    shocks: [-28, -16, 4, 6, 0],
    volatilityMultiplier: 1.35,
    icon: 'wind',
  },
] as const

export type ScenarioId = (typeof SCENARIOS)[number]['id']
export type Setup = { weights: number[]; scenario: ScenarioId; intensity: number }
export type Config = Setup & { capital: number; years: number; seed: number }
export type Experiment = { config: Config; pinned: Setup | null }
export type Band = {
  month: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}
export type Simulation = {
  bands: Band[]
  paths: number[][]
  terminal: number[]
  median: number
  p10: number
  p90: number
  lossFrequency: number
  meanWorstDecile: number
  shockPct: number
  annualDrift: number
  annualVolatility: number
  stressedVolatility: number
}

export const MIXES = [
  { name: 'Balanced', weights: [45, 20, 20, 10, 5] },
  { name: 'Growth', weights: [65, 25, 0, 5, 5] },
  { name: 'Defensive', weights: [15, 10, 45, 15, 15] },
] as const

export const DEFAULT_CONFIG: Config = {
  weights: [...MIXES[0].weights],
  scenario: 'baseline',
  intensity: 100,
  capital: 100000,
  years: 5,
  seed: 20261001,
}

export function validSetup(value: unknown): value is Setup {
  if (!value || typeof value !== 'object') return false
  const v = value as Setup
  return (
    Array.isArray(v.weights) &&
    v.weights.length === ASSETS.length &&
    v.weights.every((w) => Number.isInteger(w) && w >= 0 && w <= 100) &&
    v.weights.reduce((a, b) => a + b, 0) === 100 &&
    SCENARIOS.some((s) => s.id === v.scenario) &&
    Number.isInteger(v.intensity) &&
    v.intensity >= 0 &&
    v.intensity <= 150
  )
}

export function validConfig(value: unknown): value is Config {
  if (!validSetup(value)) return false
  const v = value as Config
  return (
    Number.isFinite(v.capital) &&
    v.capital >= 1000 &&
    v.capital <= 10000000 &&
    [1, 3, 5, 10].includes(v.years) &&
    Number.isInteger(v.seed) &&
    v.seed >= 0 &&
    v.seed <= 0xffffffff
  )
}

/** Integer percentages, proportional redistribution, deterministic largest-remainder rounding. */
export function rebalance(weights: number[], selected: number, target: number): number[] {
  if (
    !validSetup({ weights, scenario: 'baseline', intensity: 100 }) ||
    !Number.isInteger(selected) ||
    selected < 0 ||
    selected >= weights.length ||
    !Number.isFinite(target)
  ) {
    throw new Error('Invalid allocation.')
  }
  const next = Math.round(Math.min(100, Math.max(0, target)))
  const remaining = 100 - next
  const others = weights
    .map((value, index) => ({ value, index }))
    .filter((row) => row.index !== selected)
  const total = others.reduce((sum, row) => sum + row.value, 0)
  const parts = others.map((row) => {
    const exact = remaining * (total ? row.value / total : 1 / others.length)
    return { index: row.index, value: Math.floor(exact), fraction: exact - Math.floor(exact) }
  })
  let residue = remaining - parts.reduce((sum, row) => sum + row.value, 0)
  for (const part of [...parts].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (residue-- > 0) part.value++
  }
  return weights.map((_, index) =>
    index === selected ? next : parts.find((row) => row.index === index)!.value,
  )
}

export function correlation(i: number, j: number): number {
  if (i === j) return 1
  return ASSETS[i].factors.reduce<number>(
    (sum, factor, k) => sum + factor * ASSETS[j].factors[k],
    0,
  )
}

export function moments(weights: number[]) {
  const drift = ASSETS.reduce((sum, asset, i) => sum + (weights[i] / 100) * asset.drift, 0)
  let variance = 0
  ASSETS.forEach((a, i) =>
    ASSETS.forEach((b, j) => {
      variance +=
        ((weights[i] * weights[j]) / 10000) * a.volatility * b.volatility * correlation(i, j)
    }),
  )
  return { drift, volatility: Math.sqrt(Math.max(0, variance)) }
}

/** Mulberry32 with an explicitly unsigned seed. Open-interval uniforms for Box–Muller. */
function randomNormal(seed: number) {
  let state = seed >>> 0
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296
  }
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform())
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length || q < 0 || q > 1) throw new Error('Invalid quantile.')
  const index = (sorted.length - 1) * q
  const lower = Math.floor(index)
  return (
    sorted[lower] +
    (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * (index - lower)
  )
}

/** A moment-matched portfolio GBM, constant mix, no fees or flows; one shock after month six. */
export function simulate(config: Config): Simulation {
  if (!validConfig(config)) throw new Error('The experiment has invalid inputs.')
  const { drift, volatility } = moments(config.weights)
  const scenario = SCENARIOS.find((row) => row.id === config.scenario)!
  const scale = config.intensity / 100
  const shockPct =
    scenario.shocks.reduce<number>((sum, shock, i) => sum + (shock * config.weights[i]) / 100, 0) *
    scale
  const stressedVolatility = volatility * (1 + (scenario.volatilityMultiplier - 1) * scale)
  const months = config.years * 12
  const paths: number[][] = []
  const atMonth: number[][] = Array.from({ length: months + 1 }, () => [])
  // Each path gets its own stream so changing the horizon preserves earlier months exactly.
  for (let path = 0; path < PATH_COUNT; path++) {
    const normal = randomNormal((config.seed + Math.imul(path, 0x9e3779b9)) >>> 0)
    let value = config.capital
    const sample = [value]
    atMonth[0].push(value)
    for (let month = 1; month <= months; month++) {
      const sigma = month >= 6 ? stressedVolatility : volatility
      value *= Math.exp((drift - (sigma * sigma) / 2) / 12 + (sigma / Math.sqrt(12)) * normal())
      if (month === 6) value *= 1 + shockPct / 100
      atMonth[month].push(value)
      if (path < 48) sample.push(value)
    }
    if (path < 48) paths.push(sample)
  }
  const bands = atMonth.map((values, month) => {
    values.sort((a, b) => a - b)
    return {
      month,
      p10: quantile(values, 0.1),
      p25: quantile(values, 0.25),
      p50: quantile(values, 0.5),
      p75: quantile(values, 0.75),
      p90: quantile(values, 0.9),
    }
  })
  const terminal = atMonth[months]
  return {
    bands,
    paths,
    terminal,
    median: quantile(terminal, 0.5),
    p10: quantile(terminal, 0.1),
    p90: quantile(terminal, 0.9),
    lossFrequency: terminal.filter((value) => value < config.capital).length / PATH_COUNT,
    meanWorstDecile:
      terminal.slice(0, PATH_COUNT / 10).reduce((a, b) => a + b, 0) / (PATH_COUNT / 10),
    shockPct,
    annualDrift: drift,
    annualVolatility: volatility,
    stressedVolatility,
  }
}

export function encodeExperiment(experiment: Experiment): string {
  const { config: c, pinned: p } = experiment
  if (!validConfig(c) || (p && !validSetup(p))) throw new Error('Cannot share invalid inputs.')
  const params = new URLSearchParams({
    v: MODEL_VERSION,
    w: c.weights.join(','),
    s: c.scenario,
    i: String(c.intensity),
    c: String(c.capital),
    y: String(c.years),
    seed: String(c.seed),
  })
  if (p) {
    params.set('pw', p.weights.join(','))
    params.set('ps', p.scenario)
    params.set('pi', String(p.intensity))
  }
  return `#atlas?${params}`
}

export function decodeExperiment(hash: string): Experiment | null {
  if (!hash.startsWith('#atlas?') || hash.length > 1200) return null
  const params = new URLSearchParams(hash.slice(7))
  if (params.get('v') !== MODEL_VERSION) return null
  const numeric = (key: string) => {
    const value = params.get(key)
    return value !== null && value.trim() !== '' ? Number(value) : NaN
  }
  const parseWeights = (key: string) =>
    (params.get(key) || '').split(',').map((v) => (v.trim() ? Number(v) : NaN))
  const config = {
    weights: parseWeights('w'),
    scenario: params.get('s'),
    intensity: numeric('i'),
    capital: numeric('c'),
    years: numeric('y'),
    seed: numeric('seed'),
  }
  if (!validConfig(config)) return null
  let pinned: Setup | null = null
  if (['pw', 'ps', 'pi'].some((key) => params.has(key))) {
    const candidate = {
      weights: parseWeights('pw'),
      scenario: params.get('ps'),
      intensity: numeric('pi'),
    }
    if (!validSetup(candidate)) return null
    pinned = candidate
  }
  return { config, pinned }
}

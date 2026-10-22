import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSETS,
  DEFAULT_CONFIG,
  MODEL_VERSION,
  PATH_COUNT,
  SCENARIOS,
  correlation,
  decodeExperiment,
  encodeExperiment,
  moments,
  quantile,
  rebalance,
  simulate,
  validConfig,
} from '../src/atlas/engine.ts'

test('all-cash paths equal analytic continuous compounding, without any dispersion', () => {
  const config = { ...DEFAULT_CONFIG, weights: [0, 0, 0, 0, 100] }
  const result = simulate(config)
  const expected = config.capital * Math.exp(0.025 * config.years)
  assert.ok(Math.abs(result.median - expected) < 1e-7)
  assert.equal(result.p10, result.p90)
  assert.equal(result.lossFrequency, 0)
  assert.equal(result.annualVolatility, 0)
  for (const scenario of SCENARIOS) {
    assert.equal(
      simulate({ ...config, scenario: scenario.id, intensity: 150 }).median,
      result.median,
    )
  }
})

test('seeded streams reproduce every output and remain stable when extending the horizon', () => {
  const a = simulate(DEFAULT_CONFIG)
  assert.deepEqual(a, simulate(DEFAULT_CONFIG))
  const longer = simulate({ ...DEFAULT_CONFIG, years: 10 })
  assert.deepEqual(a.bands, longer.bands.slice(0, a.bands.length))
  assert.deepEqual(a.paths[0], longer.paths[0].slice(0, a.paths[0].length))
  assert.notEqual(a.median, simulate({ ...DEFAULT_CONFIG, seed: 17 }).median)
})

test('GBM sample mean agrees with its analytic expectation within Monte Carlo error', () => {
  const config = { ...DEFAULT_CONFIG, years: 1, weights: [100, 0, 0, 0, 0] }
  const result = simulate(config)
  const observed = result.terminal.reduce((a, b) => a + b, 0) / PATH_COUNT
  const expected = config.capital * Math.exp(0.075)
  const stderr = (expected * Math.sqrt(Math.exp(0.18 ** 2) - 1)) / Math.sqrt(PATH_COUNT)
  assert.ok(Math.abs(observed - expected) < 4 * stderr)
  assert.equal(result.terminal.length, 1000)
  assert.equal(result.paths.length, 48)
})

test('portfolio moments use covariance rather than adding standalone volatility', () => {
  assert.equal(moments([100, 0, 0, 0, 0]).volatility, 0.18)
  assert.equal(moments([0, 0, 0, 0, 100]).volatility, 0)
  const weights = [50, 0, 50, 0, 0]
  const covariance = 0.18 * 0.065 * (0.88 * -0.15 + -0.08 * 0.8)
  const expected = Math.sqrt(0.25 * 0.18 ** 2 + 0.25 * 0.065 ** 2 + 0.5 * covariance)
  assert.ok(Math.abs(moments(weights).volatility - expected) < 1e-12)
  for (let i = 0; i < ASSETS.length; i++) {
    assert.ok(ASSETS[i].factors.reduce((s, f) => s + f * f, 0) <= 1)
    for (let j = 0; j < ASSETS.length; j++) assert.equal(correlation(i, j), correlation(j, i))
  }
})

test('zero shock intensity equals baseline, and no scenario affects the first five months', () => {
  const baseline = simulate(DEFAULT_CONFIG)
  for (const scenario of SCENARIOS) {
    const zero = simulate({ ...DEFAULT_CONFIG, scenario: scenario.id, intensity: 0 })
    assert.deepEqual(zero.bands, baseline.bands)
    const shocked = simulate({ ...DEFAULT_CONFIG, scenario: scenario.id })
    assert.deepEqual(shocked.bands.slice(0, 6), baseline.bands.slice(0, 6))
  }
})

test('month-six shock, volatility change and weighted attribution match an analytic cash-equity path', () => {
  const config = {
    ...DEFAULT_CONFIG,
    weights: [50, 0, 0, 0, 50],
    scenario: 'riskoff' as const,
    intensity: 100,
  }
  const result = simulate(config)
  assert.equal(result.shockPct, -16)
  assert.ok(Math.abs(result.stressedVolatility - 0.135) < 1e-12)
  // Recover Z from the unshocked seeded path and independently compute the shocked month-six value.
  const base = simulate({ ...config, scenario: 'baseline' })
  const sigma = 0.09,
    stressed = 0.135,
    drift = 0.05
  const z =
    (Math.log(base.paths[0][6] / base.paths[0][5]) - (drift - sigma ** 2 / 2) / 12) /
    (sigma / Math.sqrt(12))
  const expected =
    base.paths[0][5] *
    Math.exp((drift - stressed ** 2 / 2) / 12 + (stressed * z) / Math.sqrt(12)) *
    0.84
  assert.ok(Math.abs(result.paths[0][6] - expected) < 1e-7)
})

test('allocation redistribution preserves exact 100 percent even at boundary values', () => {
  let weights = [...DEFAULT_CONFIG.weights]
  for (let index = 0; index < 5; index++) {
    for (let value = 0; value <= 100; value++) {
      weights = rebalance(weights, index, value)
      assert.equal(weights[index], value)
      assert.equal(
        weights.reduce((a, b) => a + b, 0),
        100,
      )
      assert.ok(weights.every((v) => v >= 0 && v <= 100 && Number.isInteger(v)))
    }
  }
  assert.deepEqual(rebalance([100, 0, 0, 0, 0], 0, 0), [0, 25, 25, 25, 25])
  assert.throws(() => rebalance(weights, 7, 5))
  assert.throws(() => rebalance(weights, 0, NaN))
})

test('percentiles are ordered, values stay positive, and terminal risk metrics use all paths', () => {
  const result = simulate({ ...DEFAULT_CONFIG, scenario: 'riskoff', intensity: 150, years: 10 })
  for (const b of result.bands)
    assert.ok(b.p10 > 0 && b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90)
  assert.equal(
    result.lossFrequency,
    result.terminal.filter((v) => v < DEFAULT_CONFIG.capital).length / 1000,
  )
  assert.equal(
    result.meanWorstDecile,
    result.terminal.slice(0, 100).reduce((a, b) => a + b, 0) / 100,
  )
  assert.equal(quantile([0, 10], 0.25), 2.5)
  assert.throws(() => quantile([], 0.5))
})

test('capital scaling is linear for every simulated percentile', () => {
  const a = simulate(DEFAULT_CONFIG)
  const b = simulate({ ...DEFAULT_CONFIG, capital: DEFAULT_CONFIG.capital * 2 })
  assert.equal(b.median, a.median * 2)
  assert.equal(b.p10, a.p10 * 2)
  assert.equal(a.lossFrequency, b.lossFrequency)
})

test('shared links round trip all inputs and pinned comparisons, including seed zero', () => {
  const experiment = {
    config: { ...DEFAULT_CONFIG, seed: 0, capital: 12345.67 },
    pinned: { weights: [0, 0, 0, 0, 100], scenario: 'rates' as const, intensity: 50 },
  }
  assert.deepEqual(decodeExperiment(encodeExperiment(experiment)), experiment)
  assert.deepEqual(decodeExperiment(encodeExperiment({ config: DEFAULT_CONFIG, pinned: null })), {
    config: DEFAULT_CONFIG,
    pinned: null,
  })
})

test('malformed, unsupported-version and incomplete URL inputs fail closed', () => {
  const valid = encodeExperiment({ config: DEFAULT_CONFIG, pinned: null })
  for (const broken of [
    valid.replace(MODEL_VERSION, 'atlas-99'),
    valid.replace('w=45', 'w=46'),
    valid.replace('seed=20261001', 'seed='),
    valid.replace('c=100000', 'c=Infinity'),
    valid + '&pw=1',
    '#atlas?x=' + 'a'.repeat(2000),
    valid.replace('s=baseline', 's=unknown'),
  ]) {
    assert.equal(decodeExperiment(broken), null)
  }
  for (const patch of [
    { years: 0 },
    { seed: -1 },
    { capital: NaN },
    { intensity: 151 },
    { weights: [50, 50] },
    { weights: [100, 1, 0, 0, 0] },
  ]) {
    assert.equal(validConfig({ ...DEFAULT_CONFIG, ...patch }), false)
    assert.throws(() => simulate({ ...DEFAULT_CONFIG, ...patch }))
  }
})

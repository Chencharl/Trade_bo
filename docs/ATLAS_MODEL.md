# Atlas model specification

Model version: **atlas-1**. Engine: [`src/atlas/engine.ts`](../src/atlas/engine.ts).

Atlas asks how a portfolio behaves under explicit assumptions. It does not estimate those assumptions from market observations. All asset categories, drifts, volatilities, factor exposures, and scenario shocks below are illustrative teaching inputs. Scenario names are narrative labels, not historical event identifiers.

## Inputs and units

- Capital: USD 1,000 through USD 10,000,000. The interface rounds to cents.
- Horizon: 1, 3, 5, or 10 years; 12 monthly steps per year.
- Allocation: five nonnegative integer percentages with an exact total of 100.
- Shock intensity: integer 0–150%; the slider uses five-percentage-point increments.
- Seed: unsigned 32-bit integer, including zero.
- Paths: exactly 1,000; first 48 retained in full for drawing. All paths contribute to statistics.

No contribution, withdrawal, fee, tax, slippage, leverage, or inflation adjustment is included. The constant-mix portfolio approximation assumes continuous rebalancing without cost. No orders or account connections exist in Atlas.

## Baseline assumptions

| Asset | Annual GBM drift μ | Annual volatility σ | Factor 1 loading | Factor 2 loading |
| --- | ---: | ---: | ---: | ---: |
| US equities | 0.075 | 0.180 | 0.88 | -0.08 |
| Global ex-US | 0.065 | 0.210 | 0.80 | -0.06 |
| Treasuries | 0.035 | 0.065 | -0.15 | 0.80 |
| Gold | 0.035 | 0.160 | 0.02 | 0.10 |
| Cash | 0.025 | 0.000 | 0.00 | 0.00 |

μ is the drift in `dV/V = μ dt + σ dW`, not an annual simple-return percentage. For an unshocked one-year GBM, the mean simple return is `exp(μ) − 1`. Cash compounds at its continuous rate with no randomness or scenario price shock.

## Covariance construction

For distinct non-cash assets i and j:

```text
ρᵢⱼ = fᵢ₁ fⱼ₁ + fᵢ₂ fⱼ₂
ρᵢᵢ = 1
Σᵢⱼ = σᵢ σⱼ ρᵢⱼ
μₚ = Σᵢ wᵢ μᵢ
σₚ² = Σᵢ Σⱼ wᵢ wⱼ Σᵢⱼ
```

Each factor row has squared norm no greater than one. The remaining variance is independent asset noise, so `R = FFᵀ + diag(1 − ||fᵢ||²)` is positive semidefinite. Cash has zero volatility; its numerical correlation entries do not affect covariance. Cash is omitted from the correlation table because correlation with a deterministic series is not defined empirically.

The engine generates a **portfolio-level** process with these moments. It does not simulate separate asset prices, dividends, cash flows, or a discrete rebalancing ledger.

## Path generation and scenario timing

For each month:

```text
Vₜ₊₁ = Vₜ × exp((μₚ − σₜ² / 2) / 12 + σₜ × Zₜ / sqrt(12))
Zₜ ~ N(0, 1)
```

The normal draw comes from Box–Muller using two open-interval uniform draws from Mulberry32. Path `k` receives seed `(seed + imul(k, 0x9e3779b9)) >>> 0`. Separate streams keep earlier months exactly stable when the horizon increases. This is reproducible pseudorandom sampling, not cryptographic randomness.

Let `a = intensity / 100`, and `m` be the scenario volatility multiplier. Months 1–5 use baseline volatility. Months 6 onward use `σₚ × [1 + (m − 1)a]`. After month 6’s regular GBM return, the portfolio receives the one-time shock `V₆ ← V₆ × (1 + a Σᵢ wᵢ sᵢ)`. There is no later recovery bonus or shock repetition. Drift stays constant.

| Scenario | US equities | Global ex-US | Treasuries | Gold | Cash | Volatility multiplier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Calm waters | 0% | 0% | 0% | 0% | 0% | 1.00 |
| Rates rise | −12% | −10% | −14% | −5% | 0% | 1.15 |
| Risk-off | −32% | −36% | +8% | +10% | 0% | 1.50 |
| Inflation wave | −18% | −15% | −12% | +14% | 0% | 1.25 |
| Growth unwinds | −28% | −16% | +4% | +6% | 0% | 1.35 |

These are **constructed scenarios**. Treasury or gold protection is a specified assumption, not a guarantee. “Inflation wave” changes nominal asset prices; it does not simulate a consumer price index. Zero intensity is exactly equivalent to baseline for a given allocation and seed.

The distinction between stress scenarios and forecasts is also made in the [Federal Reserve’s description of stress testing](https://www.federalreserve.gov/financial-stability/financial-stability-and-stress-testing.htm). Atlas does not implement a regulatory stress model or use the Fed’s scenario values.

## Reported outputs

At each month, sort all 1,000 values. Quantile q uses linear interpolation at index `(n − 1)q` (zero-based). The main band connects the 10th and 90th percentiles; the inner band connects the 25th and 75th. These are **pointwise simulation percentiles**, not a confidence interval for an estimated parameter, and not a claim that 80% of full paths stay inside the outer band.

- **Simulated median:** interpolated median terminal value.
- **Downside:** 10th percentile terminal value. It is not the worst case.
- **Finish below start:** fraction of terminal values strictly below starting capital. This is an empirical fraction under the toy model, not a calibrated real-world probability.
- **Immediate shock:** weighted sum of asset shocks, scaled by intensity. Excludes month 6’s random market movement.
- **Worst 10% average:** arithmetic mean of the lowest 100 terminal values, not a drawdown measure.
- **Shock contributions:** weight × asset shock × intensity, in portfolio percentage points. Rounding can cause a 0.1 pp difference from the shown total.

The histogram bins all terminal values into 30 equal-width intervals across their full range. Loss-side coloring classifies interval midpoints; the loss fraction uses exact values. The chart axis follows the percentile envelope, so extreme example paths can be clipped; these still count in all statistics. All-cash portfolios have coincident quantiles and one endpoint label.

## Allocation and comparison contracts

When a slider sets an asset to `t`, others divide `100 − t` proportionally to their prior weights. The engine floors exact allocations and assigns leftover percentage points by descending fractional remainder, breaking ties by asset index. If all other prior weights were zero, they divide the remainder equally. The selected weight and total remain exact.

A pinned setup contains weights, scenario, and intensity. It is recomputed with the **current** capital, horizon, and seed. Both portfolios use the same standard-normal stream. This is a controlled common-random-number comparison, not a joint asset-level hedge simulation or cross-portfolio dependence estimate.

## Share and export contracts

`#atlas?v=atlas-1&...` records every configurable numerical input and optional pinned setup. Decoding validates version, bounds, dimensions, and allocation sum. Invalid links load the default with an explanation. A valid zero seed remains zero. Hash links work at repository subpaths without server rewrites.

JSON reports include the version, configuration, asset and scenario assumptions, monthly quantiles, 48 example paths, all 1,000 sorted terminal values, and pinned results when present. SVG cards summarize the current setup; use JSON or links for full reproduction. Exports send no data to a server.

Workers tag requests with increasing IDs; only the newest response updates the interface. Exports are disabled while recalculating. Shared links serialize inputs directly and remain reproducible during calculation.

## Tests and limits

Independent checks cover exact cash compounding, covariance arithmetic, an analytically reconstructed month-six shock, sample mean agreement within Monte Carlo error, linear capital scaling, percentile order, redistribution invariants, deterministic streams, and URL round trips. Browser tests cover sharing, downloading, comparison, keyboard controls, invalid capital, static research navigation, and mobile overflow.

GBM keeps wealth positive and omits defaults, jumps, fat tails, time-varying correlations, endogenous liquidity, and parameter uncertainty. Monthly sampling misses intra-month extremes. There is no calibration, historical backtest, optimization, suitability assessment, or claim of predictive performance. Simulated percentiles are not real loss bounds. Changes to numerical contracts require a new model version.

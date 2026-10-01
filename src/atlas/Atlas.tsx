import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CloudLightning,
  Download,
  ExternalLink,
  Flame,
  Github,
  Layers3,
  Link,
  Pin,
  RotateCcw,
  Shuffle,
  Waves,
  Wind,
  X,
} from 'lucide-react'
import {
  ASSETS,
  DEFAULT_CONFIG,
  MIXES,
  MODEL_VERSION,
  PATH_COUNT,
  SCENARIOS,
  correlation,
  decodeExperiment,
  encodeExperiment,
  rebalance,
} from './engine'
import type { Config, Setup, Simulation } from './engine'
import { Distribution, money, percent, PossibilityField } from './Charts'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import './atlas.css'

const icons = { waves: Waves, arrow: ArrowUpRight, storm: CloudLightning, flame: Flame, wind: Wind }
const REPO = 'https://github.com/Chencharl/Trade_bo'

function initialExperiment() {
  return (
    decodeExperiment(window.location.hash) || {
      config: structuredClone(DEFAULT_CONFIG),
      pinned: null,
    }
  )
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Atlas() {
  const [initial] = useState(initialExperiment)
  const [config, setConfig] = useState<Config>(initial.config)
  const [pinned, setPinned] = useState<Setup | null>(initial.pinned)
  const [result, setResult] = useState<Simulation | null>(null)
  const [comparison, setComparison] = useState<Simulation | null>(null)
  const [completedKey, setCompletedKey] = useState('')
  const runKey = JSON.stringify({ config, pinned })
  const busy = completedKey !== runKey
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(
    window.location.hash.startsWith('#atlas?') && !decodeExperiment(window.location.hash)
      ? 'This shared experiment is invalid or uses a different model version. The default setup is loaded.'
      : '',
  )
  const [shareFallback, setShareFallback] = useState('')
  const [capitalText, setCapitalText] = useState(String(config.capital))
  const [capitalError, setCapitalError] = useState('')
  const [details, setDetails] = useState(false)
  const worker = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const methodRef = useRef<HTMLElement>(null)
  const scenario = SCENARIOS.find((row) => row.id === config.scenario)!
  const mix =
    MIXES.find((row) => row.weights.every((w, i) => w === config.weights[i]))?.name || 'Custom'

  useEffect(() => {
    const instance = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.current = instance
    instance.onmessage = (event) => {
      if (event.data.id !== requestId.current) return
      if (event.data.error) {
        setError(event.data.error)
        return
      }
      setError('')
      setResult(event.data.result)
      setComparison(event.data.comparison)
      setCompletedKey(event.data.key)
    }
    instance.onerror = () => {
      setError('The simulation could not start. Reload the page to try again.')
    }
    return () => {
      instance.terminate()
      worker.current = null
    }
  }, [])

  useEffect(() => {
    setError('')
    worker.current?.postMessage({ id: ++requestId.current, key: runKey, config, pinned })
  }, [config, pinned, runKey])

  useEffect(() => {
    const restore = () => {
      const isExperiment = window.location.hash.startsWith('#atlas?')
      const decoded = decodeExperiment(window.location.hash)
      const next =
        decoded || (isExperiment ? { config: structuredClone(DEFAULT_CONFIG), pinned: null } : null)
      if (isExperiment && !decoded)
        setNotice(
          'This shared experiment is invalid or uses a different model version. The default setup is loaded.',
        )
      if (next) {
        setConfig(next.config)
        setPinned(next.pinned)
        setCapitalText(String(next.config.capital))
      }
    }
    window.addEventListener('hashchange', restore)
    return () => window.removeEventListener('hashchange', restore)
  }, [])

  function update(patch: Partial<Config>) {
    setConfig((current) => ({ ...current, ...patch }))
    setShareFallback('')
  }
  function reset() {
    setConfig(structuredClone(DEFAULT_CONFIG))
    setPinned(null)
    setCapitalText(String(DEFAULT_CONFIG.capital))
    setCapitalError('')
    setNotice('Default experiment restored.')
    setShareFallback('')
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  function applyCapital() {
    const value = Number(capitalText)
    if (!Number.isFinite(value) || value < 1000 || value > 10000000) {
      setCapitalError('Enter a starting value from $1,000 to $10,000,000.')
      return
    }
    setCapitalError('')
    update({ capital: Math.round(value * 100) / 100 })
  }
  async function share() {
    if (capitalError) return
    const hash = encodeExperiment({ config, pinned })
    const url = new URL(window.location.href)
    url.hash = hash
    window.history.replaceState(null, '', url)
    try {
      await navigator.clipboard.writeText(url.href)
      setNotice('Experiment link copied. It includes your mix, scenario, seed, and comparison.')
    } catch {
      setShareFallback(url.href)
      setNotice('Copy the experiment link below.')
    }
  }
  function exportReport() {
    if (!result || busy || capitalError) return
    downloadText(
      'tradebo-atlas-experiment.json',
      JSON.stringify(
        {
          model: MODEL_VERSION,
          pathCount: PATH_COUNT,
          inputs: config,
          assumptions: ASSETS,
          scenario,
          results: result,
          pinned: pinned ? { inputs: { ...config, ...pinned }, results: comparison } : null,
          limitations:
            'Educational, uncalibrated portfolio GBM. Nominal USD. Constant mix; no fees, taxes, inflation adjustment, flows, fat tails, or default model. Not a forecast or investment recommendation.',
          methods: `${REPO}/blob/codex/atlas-lab/docs/ATLAS_MODEL.md`,
        },
        null,
        2,
      ),
      'application/json',
    )
    setNotice('Experiment exported with inputs, assumptions, and simulated results.')
  }
  function exportCard() {
    if (!result || busy || capitalError) return
    const points = result.bands
      .map(
        (b, i) =>
          `${80 + (i / (result.bands.length - 1)) * 880},${470 - (b.p50 / result.p90) * 235}`,
      )
      .join(' ')
    const envelope = [
      ...result.bands.map(
        (b, i) =>
          `${80 + (i / (result.bands.length - 1)) * 880},${470 - (b.p90 / result.p90) * 235}`,
      ),
      ...result.bands
        .map(
          (b, i) =>
            `${80 + (i / (result.bands.length - 1)) * 880},${470 - (b.p10 / result.p90) * 235}`,
        )
        .reverse(),
    ].join(' ')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720"><rect width="1200" height="720" fill="#14233c"/><g font-family="Arial,sans-serif"><text x="80" y="78" font-size="22" fill="#a3b8f5" letter-spacing="5">TRADEBO / ATLAS</text><text x="80" y="144" font-size="48" fill="#fff">Same portfolio. Different possibilities.</text><text x="80" y="184" font-size="20" fill="#acbad3">${mix} mix · ${scenario.name} · ${config.years} years · ${config.intensity}% shock intensity</text><polygon points="${envelope}" fill="#607eed" opacity=".28"/><polyline points="${points}" fill="none" stroke="#b1caff" stroke-width="4"/><text x="80" y="528" font-size="16" fill="#acbad3">STARTING VALUE</text><text x="80" y="575" font-size="36" fill="#fff">${money(config.capital)}</text><text x="445" y="528" font-size="16" fill="#acbad3">SIMULATED MEDIAN</text><text x="445" y="575" font-size="36" fill="#fff">${money(result.median)}</text><text x="840" y="528" font-size="16" fill="#acbad3">10TH PERCENTILE</text><text x="840" y="575" font-size="36" fill="#fff">${money(result.p10)}</text><text x="80" y="639" font-size="16" fill="#acbad3">Illustrative assumptions · 1,000 paths · seed ${config.seed} · ${MODEL_VERSION} · not a forecast</text><text x="80" y="669" font-size="14" fill="#acbad3">Mix: ${config.weights.join(' / ')}% (US / international / Treasuries / gold / cash). No fees or taxes.</text></g></svg>`
    downloadText('tradebo-atlas-card.svg', svg, 'image/svg+xml')
    setNotice('Share card downloaded as an editable SVG.')
  }
  function showMethod() {
    setDetails(true)
    setTimeout(
      () =>
        methodRef.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        }),
      0,
    )
  }

  return (
    <div className="atlas-app">
      <a href="#atlas-main" className="atlas-skip">
        Skip to the experiment
      </a>
      <header className="atlas-header">
        <a className="atlas-brand" href="#" aria-label="TradeBo Atlas home">
          <span className="atlas-brand-mark">
            <Layers3 size={23} strokeWidth={1.6} />
          </span>
          <span>
            tradebo<span className="brand-slash">/</span>
            <strong>atlas</strong>
          </span>
        </a>
        <nav aria-label="Atlas navigation">
          <a className="atlas-nav-active" href="#atlas-main">
            Playground
          </a>
          <button onClick={showMethod}>Under the hood</button>
          <a href="#research" className="research-link">
            Research desk <ArrowUpRight size={13} />
          </a>
        </nav>
        <a
          className="atlas-github"
          href={`${REPO}/tree/codex/atlas-lab`}
          target="_blank"
          rel="noreferrer"
        >
          <Github size={17} />
          <span>View source</span>
          <ArrowUpRight size={14} />
        </a>
      </header>
      <main id="atlas-main" className="atlas-main">
        <section className="atlas-intro">
          <div>
            <div className="atlas-overline">
              <span />
              AN OPEN FINANCE EXPERIMENT
            </div>
            <h1>
              The future isn’t a line.
              <br />
              It’s a <span>field of possibilities.</span>
            </h1>
          </div>
          <div className="atlas-intro-side">
            <p>
              Build a portfolio. Change the conditions. <br />
              See how a thousand futures unfold.
            </p>
            <div className="atlas-intro-meta">
              <span>NO SIGN-UP</span>
              <i />
              <span>RUNS IN YOUR BROWSER</span>
            </div>
          </div>
        </section>
        <div className="atlas-toolbar">
          <div className="atlas-session">
            <span className="atlas-session-dot" />
            Portfolio wind tunnel <span className="atlas-version">v1.0</span>
          </div>
          <div>
            <button onClick={reset} className="atlas-text-button">
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              onClick={() => void share()}
              className="atlas-button atlas-button-share"
              disabled={!!capitalError}
            >
              <Link size={14} />
              Share experiment
            </button>
          </div>
        </div>
        {notice && (
          <div className="atlas-notice" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </div>
        )}
        {shareFallback && (
          <label className="atlas-share-fallback">
            Experiment link
            <input readOnly value={shareFallback} onFocus={(event) => event.target.select()} />
          </label>
        )}
        {error && (
          <div className="atlas-error" role="alert">
            {error}
          </div>
        )}
        <div className="atlas-workspace">
          <aside className="atlas-controls" aria-label="Portfolio controls">
            <div className="atlas-control-heading">
              <span className="atlas-kicker">YOUR PORTFOLIO</span>
              <span className="atlas-small-tag">{mix}</span>
            </div>
            <form
              className="atlas-capital"
              onSubmit={(event) => {
                event.preventDefault()
                applyCapital()
              }}
            >
              <label htmlFor="starting-capital">Starting value</label>
              <div>
                <span>$</span>
                <input
                  id="starting-capital"
                  inputMode="decimal"
                  type="number"
                  min="1000"
                  max="10000000"
                  step="0.01"
                  value={capitalText}
                  onChange={(event) => setCapitalText(event.target.value)}
                  onBlur={applyCapital}
                  aria-invalid={!!capitalError}
                  aria-describedby={capitalError ? 'capital-error' : undefined}
                />
              </div>
              {capitalError && (
                <small id="capital-error" role="alert">
                  {capitalError}
                </small>
              )}
            </form>
            <div className="atlas-mix-tabs" aria-label="Portfolio presets">
              {MIXES.map((item) => (
                <button
                  key={item.name}
                  aria-pressed={mix === item.name}
                  onClick={() => update({ weights: [...item.weights] })}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="atlas-allocation-strip" aria-label="Portfolio allocation">
              {ASSETS.map((asset, i) => (
                <span
                  key={asset.id}
                  style={{ width: `${config.weights[i]}%`, background: asset.color }}
                  title={`${asset.name}: ${config.weights[i]}%`}
                />
              ))}
            </div>
            <div className="atlas-weights">
              {ASSETS.map((asset, i) => (
                <div key={asset.id} className="atlas-weight">
                  <label htmlFor={`weight-${asset.id}`}>
                    <span>
                      <i style={{ background: asset.color }} />
                      {asset.name}
                    </span>
                    <b>
                      {config.weights[i]}
                      <small>%</small>
                    </b>
                  </label>
                  <input
                    id={`weight-${asset.id}`}
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={config.weights[i]}
                    style={
                      {
                        '--asset-color': asset.color,
                        '--range-fill': `${config.weights[i]}%`,
                      } as React.CSSProperties
                    }
                    onChange={(event) =>
                      update({ weights: rebalance(config.weights, i, Number(event.target.value)) })
                    }
                  />
                </div>
              ))}
            </div>
            <p className="atlas-control-note">
              Adjust one weight. The others rebalance to keep your total at 100%.
            </p>
            <div className="atlas-horizon">
              <span className="atlas-input-label">Time horizon</span>
              <div>
                {[1, 3, 5, 10].map((year) => (
                  <button
                    key={year}
                    aria-pressed={config.years === year}
                    onClick={() => update({ years: year })}
                  >
                    {year}Y
                  </button>
                ))}
              </div>
            </div>
            <button
              className={`atlas-pin ${pinned ? 'pinned' : ''}`}
              onClick={() => {
                setPinned(
                  pinned
                    ? null
                    : {
                        weights: [...config.weights],
                        scenario: config.scenario,
                        intensity: config.intensity,
                      },
                )
                setNotice(
                  pinned
                    ? 'Comparison removed.'
                    : 'Setup pinned. Now change the mix or the shock to compare. Both use the same seed, capital, and horizon.',
                )
              }}
            >
              <Pin size={15} />
              {pinned ? 'Remove comparison' : 'Pin this setup to compare'}
            </button>
            <div className="atlas-seed">
              <span>SEED {config.seed}</span>
              <button
                aria-label="Generate a new random seed"
                title="Generate a new random seed"
                onClick={() => update({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })}
              >
                <Shuffle size={14} />
              </button>
            </div>
          </aside>
          <div className="atlas-results">
            {result ? (
              <PossibilityField
                result={result}
                comparison={comparison}
                config={config}
                busy={busy}
              />
            ) : (
              <section className="atlas-field atlas-loading">
                <Layers3 size={36} />
                <h2>Opening the possibility field…</h2>
                <p>Simulating 1,000 paths in your browser.</p>
              </section>
            )}
            <div className="atlas-metrics" aria-busy={busy}>
              <div>
                <span>Simulated median</span>
                <strong data-testid="median-value">{result ? money(result.median) : '—'}</strong>
                <small>{config.years}-year ending value</small>
              </div>
              <div>
                <span>Downside · 10th percentile</span>
                <strong>{result ? money(result.p10) : '—'}</strong>
                <small>10% of paths finish below this</small>
              </div>
              <div>
                <span>Finish below start</span>
                <strong>{result ? percent(result.lossFrequency * 100) : '—'}</strong>
                <small>Share of simulated paths</small>
              </div>
              <div>
                <span>Immediate shock</span>
                <strong className={result && result.shockPct < 0 ? 'atlas-negative' : ''}>
                  {result ? percent(result.shockPct, true) : '—'}
                </strong>
                <small>
                  {config.scenario === 'baseline'
                    ? 'No added scenario shock'
                    : 'Applied once, at month 6'}
                </small>
              </div>
            </div>
            {comparison && result && (
              <div className="atlas-comparison" role="status">
                <Pin size={16} />
                <span>
                  <b>Pinned comparison</b>
                  <small>
                    {SCENARIOS.find((s) => s.id === pinned?.scenario)?.name} ·{' '}
                    {pinned?.weights.join(' / ')}% mix · {pinned?.intensity}% intensity
                  </small>
                </span>
                <span className="comparison-value">
                  {money(result.median - comparison.median)}
                  <small>median difference vs. pinned</small>
                </span>
                <button onClick={() => setPinned(null)} aria-label="Remove pinned comparison">
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
        <section className="atlas-scenarios" aria-labelledby="scenario-title">
          <div className="atlas-section-heading">
            <div>
              <span className="atlas-kicker">CHANGE THE CONDITIONS</span>
              <h2 id="scenario-title">What if the world shifts?</h2>
            </div>
            <span>Constructed scenarios. No historical replay.</span>
          </div>
          <div className="atlas-scenario-grid">
            {SCENARIOS.map((item) => {
              const Icon = icons[item.icon]
              return (
                <button
                  key={item.id}
                  className={`atlas-scenario ${config.scenario === item.id ? 'selected' : ''}`}
                  aria-pressed={config.scenario === item.id}
                  onClick={() => update({ scenario: item.id })}
                >
                  <span className="scenario-icon">
                    <Icon size={21} strokeWidth={1.5} />
                  </span>
                  <strong>{item.name}</strong>
                  <small>{item.subtitle}</small>
                  <span className="scenario-select-dot">
                    {config.scenario === item.id && <Check size={11} />}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="atlas-scenario-detail">
            <div>
              <span className="atlas-scenario-label">{scenario.name}</span>
              <p>{scenario.description}</p>
            </div>
            <div className="atlas-intensity">
              <label htmlFor="shock-intensity">
                Shock intensity <strong>{config.intensity}%</strong>
              </label>
              <input
                id="shock-intensity"
                type="range"
                min="0"
                max="150"
                step="5"
                value={config.intensity}
                disabled={config.scenario === 'baseline'}
                onChange={(event) => update({ intensity: Number(event.target.value) })}
              />
              <div>
                <span>Milder</span>
                <span>Stronger</span>
              </div>
            </div>
          </div>
        </section>
        {result && (
          <section className="atlas-insights" aria-label="Explore the results">
            <article className="atlas-insight-card">
              <div className="atlas-card-heading">
                <div>
                  <span className="atlas-kicker">THE RANGE OF OUTCOMES</span>
                  <h2>Where do the paths land?</h2>
                </div>
                <span className="atlas-small-tag">Year {config.years}</span>
              </div>
              <Distribution result={result} capital={config.capital} />
              <p>
                Each bar groups ending values. The worst 10% average{' '}
                <strong>{money(result.meanWorstDecile)}</strong>; even this is not a bound on
                possible losses.
              </p>
            </article>
            <article className="atlas-insight-card">
              <div className="atlas-card-heading">
                <div>
                  <span className="atlas-kicker">FOLLOW THE EXPOSURE</span>
                  <h2>What drives the shock?</h2>
                </div>
                <ArrowDownRight size={20} />
              </div>
              <div className="atlas-attribution">
                {ASSETS.map((asset, i) => {
                  const impact =
                    (((scenario.shocks[i] * config.intensity) / 100) * config.weights[i]) / 100
                  return (
                    <div key={asset.id}>
                      <span>
                        <i style={{ background: asset.color }} />
                        {asset.short}
                      </span>
                      <div className="attribution-track">
                        <span
                          style={{
                            width: `${Math.min(100, (Math.abs(impact) / 35) * 100)}%`,
                            background: impact < 0 ? '#ce8981' : '#55afa9',
                          }}
                        />
                      </div>
                      <b>
                        {impact > 0 ? '+' : ''}
                        {impact.toFixed(1)}
                        <small> pp</small>
                      </b>
                    </div>
                  )
                })}
              </div>
              <p>
                Allocation × asset shock = contribution to the portfolio shock. The contributions
                sum to <strong>{percent(result.shockPct, true)}</strong>.
              </p>
            </article>
          </section>
        )}
        <section className="atlas-method" ref={methodRef} aria-labelledby="method-title">
          <button
            className="atlas-method-toggle"
            aria-expanded={details}
            aria-controls="atlas-method-content"
            onClick={() => setDetails(!details)}
          >
            <div>
              <span className="atlas-kicker">OPEN THE BLACK BOX</span>
              <h2 id="method-title">A model you can actually inspect.</h2>
            </div>
            <span>
              {details ? 'Close methodology' : 'Explore methodology'}
              <ChevronDown
                size={18}
                style={{ transform: details ? 'rotate(180deg)' : undefined }}
              />
            </span>
          </button>
          {details && (
            <div id="atlas-method-content" className="atlas-method-content">
              <div className="atlas-method-explanation">
                <div>
                  <h3>Random paths. Explicit rules.</h3>
                  <p>
                    A portfolio-level geometric Brownian motion model uses a weighted drift and a
                    covariance-based volatility. A seeded random generator produces 1,000 monthly
                    paths. The portfolio is treated as a constant mix, with no cash flows.
                  </p>
                  <code>Vₜ₊₁ = Vₜ × exp((μ − σ²/2)/12 + σZ/√12)</code>
                  <p>
                    Scenario returns are applied once after month 6’s regular return. Higher
                    volatility begins during month 6 and persists. The intensity slider scales both
                    changes. Returns are nominal; no fees, taxes, or inflation adjustment.
                  </p>
                </div>
                <div>
                  <h3>Useful questions, limited answers.</h3>
                  <p>
                    All drifts, volatilities, correlations, and shocks are hand-set teaching
                    assumptions. They are not estimated from live or historical data. Gaussian
                    shocks omit fat tails, and fixed correlations miss regime changes.
                  </p>
                  <p>
                    The shaded band connects the 10th and 90th percentiles at each month. It
                    contains 80% of values at each time, not 80% of complete paths. The median curve
                    is not one realizable path. Extremes can leave the chart.
                  </p>
                  <p>
                    Scenario thinking is inspired by{' '}
                    <a
                      href="https://www.federalreserve.gov/financial-stability/financial-stability-and-stress-testing.htm"
                      target="_blank"
                      rel="noreferrer"
                    >
                      stress testing <ExternalLink size={12} />
                    </a>
                    ; this is not the Fed’s model or scenarios.
                  </p>
                </div>
              </div>
              <div className="atlas-method-table-wrap">
                <table className="atlas-method-table">
                  <caption>
                    Illustrative annual inputs · before the scenario volatility multiplier
                  </caption>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Drift μ</th>
                      <th>Volatility σ</th>
                      <th>Scenario return¹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ASSETS.map((asset, i) => (
                      <tr key={asset.id}>
                        <th>{asset.name}</th>
                        <td>{percent(asset.drift * 100)}</td>
                        <td>{percent(asset.volatility * 100)}</td>
                        <td>{percent((scenario.shocks[i] * config.intensity) / 100, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="atlas-method-footnote">
                ¹ One-time asset shock at the selected intensity. Annual volatility multiplier from
                month 6:{' '}
                {(1 + ((scenario.volatilityMultiplier - 1) * config.intensity) / 100).toFixed(3)}×.
                Portfolio drift stays constant; exp(μ) − 1 is the model’s one-year mean return
                before any scenario shock.
              </p>
              <details className="atlas-correlation">
                <summary>Inspect the implied correlation matrix</summary>
                <div className="atlas-method-table-wrap">
                  <table className="atlas-method-table">
                    <caption>
                      Two common factors plus independent residuals; cash has zero volatility.
                    </caption>
                    <thead>
                      <tr>
                        <th>Asset</th>
                        {ASSETS.slice(0, 4).map((a) => (
                          <th key={a.id}>{a.short}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ASSETS.slice(0, 4).map((a, i) => (
                        <tr key={a.id}>
                          <th>{a.short}</th>
                          {ASSETS.slice(0, 4).map((b, j) => (
                            <td key={b.id}>{correlation(i, j).toFixed(3)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              {result && (
                <details className="atlas-correlation">
                  <summary>Read the chart as a table</summary>
                  <div className="atlas-method-table-wrap">
                    <table className="atlas-method-table">
                      <caption>Pointwise percentiles across 1,000 simulated paths</caption>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>10th</th>
                          <th>Median</th>
                          <th>90th</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.bands
                          .filter((b) => b.month % 12 === 0 || b.month === 6)
                          .map((b) => (
                            <tr key={b.month}>
                              <th>{b.month === 0 ? 'Today' : `Month ${b.month}`}</th>
                              <td>{money(b.p10)}</td>
                              <td>{money(b.p50)}</td>
                              <td>{money(b.p90)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              <a
                href={`${REPO}/blob/codex/atlas-lab/docs/ATLAS_MODEL.md`}
                target="_blank"
                rel="noreferrer"
                className="atlas-method-source"
              >
                Read the full model specification <ArrowUpRight size={15} />
              </a>
            </div>
          )}
        </section>
        <section className="atlas-takeaway">
          <div>
            <span className="atlas-kicker">TAKE THE EXPERIMENT WITH YOU</span>
            <h2>A different mix. A different conversation.</h2>
            <p>Share the exact setup, or download the results and make it your own.</p>
          </div>
          <div className="atlas-export-actions">
            <button
              className="atlas-button"
              onClick={exportCard}
              disabled={!result || busy || !!capitalError}
            >
              <Download size={15} />
              Save share card
            </button>
            <button
              className="atlas-button atlas-button-dark"
              onClick={exportReport}
              disabled={!result || busy || !!capitalError}
            >
              Export experiment <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>
      <footer className="atlas-footer">
        <a href={`${REPO}/tree/codex/atlas-lab`} target="_blank" rel="noreferrer">
          Built to be explored. Made to be forked. <Github size={15} />
        </a>
        <p>TradeBo Atlas · Illustrative simulation, not a forecast or investment advice.</p>
        <span>{MODEL_VERSION}</span>
      </footer>
    </div>
  )
}

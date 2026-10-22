import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  FlaskConical,
  Github,
  Layers3,
  Upload,
} from 'lucide-react'
import { DEFAULT_LAB_CONFIG, evaluateLab, LAB_VERSION, STRATEGIES } from './engine'
import type { LabConfig } from './engine'
import { createDemoDataset, datasetCSV, importDataset } from './data'
import type { Dataset } from './data'
import { MODEL_VERSION } from '../atlas/engine'
import './lab.css'

type Evaluation = ReturnType<typeof evaluateLab>
type Run = Evaluation['results'][number]
const REPO = 'https://github.com/Chencharl/Trade_bo'
const FRENCH =
  'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip'
const pct = (value: number, signed = false) =>
  `${signed && value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
const pp = (value: number) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`
const number = (value: number | null) => (value === null ? '—' : value.toFixed(2))
const month = (value: string) =>
  new Date(`${value}-02T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
const ruleName = (id: string) => STRATEGIES.find((rule) => rule.id === id)?.name || id

function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function EquityChart({ selected, benchmark }: { selected: Run; benchmark: Run }) {
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 700px)').matches)
  useEffect(() => {
    const media = matchMedia('(max-width: 700px)')
    const change = () => setCompact(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const width = compact ? 520 : 980
  const left = compact ? 64 : 64
  const right = width - 20
  const points = selected.ledger
  const values = [
    1,
    ...points.map((row) => row.equity),
    ...benchmark.ledger.map((row) => row.equity),
  ]
  const low = Math.max(0, Math.min(...values) * 0.9)
  const high = Math.max(...values) * 1.08
  const x = (i: number) => left + (i / points.length) * (right - left)
  const y = (value: number) => 245 - ((value - low) / (high - low)) * 205
  const path = (run: Run) =>
    [1, ...run.ledger.map((row) => row.equity)]
      .map((value, i) => `${i ? 'L' : 'M'}${x(i)},${y(value)}`)
      .join(' ')
  const worst = Math.max(0.05, ...points.map((row) => row.drawdown))
  const dd = `M${left},315 ${points.map((row, i) => `L${x(i + 1)},${315 + (row.drawdown / worst) * 55}`).join(' ')} L${right},315 Z`
  return (
    <svg
      className="lab-equity-svg"
      viewBox={`0 0 ${width} 402`}
      role="img"
      aria-label={`Reserved-window equity and drawdown. ${selected.name}: ${pct(selected.metrics.totalReturn)} total return. Market: ${pct(benchmark.metrics.totalReturn)}. Maximum drawdown ${pct(selected.metrics.maxDrawdown)}.`}
      style={{ fontSize: compact ? 16 : 12 }}
    >
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = low + ((high - low) * tick) / 4
        return (
          <g key={tick}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} className="lab-grid" />
            <text x={left - 10} y={y(value) + 5} textAnchor="end">
              {Math.round(value * 100)}
            </text>
          </g>
        )
      })}
      <path d={path(benchmark)} className="lab-benchmark-line" />
      <path d={path(selected)} className="lab-strategy-line" />
      {[0, 12, 24, 36, 48, 60].map((i) => (
        <text key={i} x={x(i)} y="278" textAnchor={i === 0 ? 'start' : i === 60 ? 'end' : 'middle'}>
          {i === 0 ? 'Start' : points[i - 1].date.slice(0, 4)}
        </text>
      ))}
      <text x={left} y="309" className="lab-dd-caption">
        DRAWDOWN
      </text>
      <path d={dd} className="lab-dd-area" />
      <line x1={left} x2={right} y1="315" y2="315" className="lab-grid" />
      <text x={left} y="394">
        −{pct(worst)} at the lower edge
      </text>
    </svg>
  )
}

export default function StrategyLab() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [config, setConfig] = useState<LabConfig>({ ...DEFAULT_LAB_CONFIG })
  const [completed, setCompleted] = useState<{ key: string; value: Evaluation } | null>(null)
  const [busy, setBusy] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [notice, setNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const runKey = JSON.stringify([dataset?.dataSha256, config])
  const result = completed?.key === runKey ? completed.value : null

  useEffect(() => {
    let active = true
    createDemoDataset()
      .then((data) => {
        if (active) setDataset(data)
      })
      .catch(() => {
        if (active) {
          setError('The sample could not load. Reload this page to try again.')
          setBusy(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!dataset) return
    let active = true
    let worker: Worker | null = null
    let timer = 0
    let fallingBack = false
    setBusy(true)
    setError('')
    const receive = (next: Evaluation) => {
      if (active) {
        setCompleted({ key: runKey, value: next })
        setBusy(false)
      }
    }
    const fail = (message: string) => {
      if (active) {
        setCompleted(null)
        setError(message)
        setBusy(false)
      }
    }
    const fallback = () => {
      if (fallingBack) return
      fallingBack = true
      worker?.terminate()
      timer = window.setTimeout(() => {
        try {
          receive(evaluateLab(dataset.rows, config))
        } catch (reason) {
          fail(reason instanceof Error ? reason.message : 'The evaluation could not finish.')
        }
      }, 0)
    }
    try {
      worker = new Worker(new URL('./lab.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event) =>
        event.data.error ? fail(event.data.error) : receive(event.data.result)
      worker.onerror = (event) => {
        event.preventDefault()
        fallback()
      }
      worker.postMessage({ rows: dataset.rows, config })
    } catch {
      fallback()
    }
    return () => {
      active = false
      window.clearTimeout(timer)
      worker?.terminate()
    }
  }, [dataset, config, runKey])

  async function openFile(file: File) {
    setImporting(true)
    setError('')
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a CSV or ZIP smaller than 2 MiB.')
      const next = await importDataset(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        sourceLabel,
      )
      setDataset(next)
      setNotice(
        'Data file opened locally. No file was uploaded. Every result is an exploratory replay of this snapshot.',
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This file could not be read.')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  async function resetData() {
    setDataset(await createDemoDataset())
    setNotice('Synthetic teaching data restored.')
  }
  function exportRun() {
    if (!dataset || !result || busy || importing) return
    download(
      'tradebo-strategy-lab.json',
      JSON.stringify(
        {
          engine: LAB_VERSION,
          atlasModelVersion: MODEL_VERSION,
          exportedAt: new Date().toISOString(),
          dataset,
          rules: STRATEGIES,
          evaluation: result,
          execution:
            'Signals use completed months only. Target market/cash fractions are rebalanced at the next monthly boundary. Turnover uses the prior drifted allocation; proportional costs are charged before monthly returns. No terminal liquidation.',
          interpretation:
            'Exploratory evaluation. Synthetic data are not market performance. Imported snapshots may be revised and are not verified point-in-time or directly investable. Bootstrap intervals condition on realized returns and omit strategy-search uncertainty. No execution, forecasts, or alpha claims.',
          methodology: `${REPO}/blob/main/docs/STRATEGY_LAB.md`,
        },
        null,
        2,
      ),
      'application/json',
    )
    setNotice(
      'Run exported with source hashes, data, rules, selection windows, and monthly ledgers.',
    )
  }
  const selected = result?.results.find((run) => run.id === config.selectedStrategy)
  const benchmark = result?.results.find((run) => run.id === 'market')
  const selectedRule = STRATEGIES.find((rule) => rule.id === config.selectedStrategy)!
  return (
    <div className="atlas-app lab-app">
      <a className="atlas-skip" href="#lab-main">
        Skip to the strategy evaluation
      </a>
      <header className="lab-header">
        <a className="atlas-brand" href="#" aria-label="TradeBo Atlas home">
          <span className="atlas-brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            tradebo<span className="brand-slash">/</span>
            <strong>lab</strong>
          </span>
        </a>
        <nav aria-label="Strategy Lab navigation">
          <a href="#">
            <ArrowLeft size={14} /> Atlas
          </a>
          <a href={`${REPO}/blob/main/docs/STRATEGY_RESEARCH.md`} target="_blank" rel="noreferrer">
            Research notes <ArrowUpRight size={14} />
          </a>
          <a href={REPO} target="_blank" rel="noreferrer" aria-label="View source on GitHub">
            <Github size={19} />
          </a>
        </nav>
      </header>
      <main id="lab-main" className="lab-main">
        <section className="lab-intro">
          <div>
            <span className="lab-kicker">
              <FlaskConical size={14} /> STRATEGY LAB · {LAB_VERSION}
            </span>
            <h1>
              Test the rule.
              <br />
              <span>Show the evidence.</span>
            </h1>
          </div>
          <div className="lab-intro-note">
            <p>
              Five strategy families. Three baselines.
              <br />
              One shared test of timing, cost, and risk.
            </p>
            <span>LOCAL FILES · REPRODUCIBLE RUNS · NO ACCOUNT</span>
          </div>
        </section>
        <section className="lab-data" aria-label="Data source">
          <div className="lab-data-summary">
            <span className={`lab-source-tag ${dataset?.kind === 'imported' ? 'imported' : ''}`}>
              {dataset?.kind === 'imported' ? 'IMPORTED RETURN DATA' : 'SYNTHETIC TEACHING DATA'}
            </span>
            <h2>{dataset?.name || 'Preparing the experiment…'}</h2>
            <p>
              {dataset
                ? `${month(dataset.rows[0].date)} — ${month(dataset.rows.at(-1)!.date)} · ${dataset.rows.length} monthly observations`
                : 'Loading locally'}
            </p>
            <p className="lab-data-note">
              {dataset?.kind === 'imported'
                ? 'Revised history can differ from what was known at the time. This is a monthly index replay, not actual trade fills.'
                : 'Generated regimes, not historical returns. Open your own file to evaluate market history.'}
            </p>
          </div>
          <div className="lab-data-actions">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.zip,text/csv,application/zip"
              aria-label="Monthly data file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void openFile(file)
              }}
            />
            <button
              className="lab-button primary"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              <Upload size={15} />
              {importing ? 'Reading file…' : 'Open CSV or ZIP'}
            </button>
            <a className="lab-source-link" href={FRENCH} target="_blank" rel="noreferrer">
              Get French monthly factors <ArrowUpRight size={13} />
            </a>
            <details className="lab-import-help">
              <summary>File format & source details</summary>
              <p>
                Open the official French 3-factor monthly CSV or ZIP directly. Or supply at least
                156 consecutive months as decimal returns:
              </p>
              <code>date,market_return,cash_return</code>
              <label htmlFor="lab-source-label">Source for your own CSV</label>
              <input
                id="lab-source-label"
                value={sourceLabel}
                maxLength={200}
                onChange={(event) => setSourceLabel(event.target.value)}
                placeholder="Provider, currency, adjustment & vintage"
              />
              <p>
                Example: 0.02 means +2%. Dates use YYYY-MM. Source details are your declaration.
                Files stay in this browser and are cleared on reload.
              </p>
              <button
                onClick={() => {
                  if (dataset)
                    download(
                      'tradebo-monthly-template.csv',
                      dataset.kind === 'synthetic'
                        ? datasetCSV(dataset.rows)
                        : 'date,market_return,cash_return\n',
                      'text/csv',
                    )
                }}
              >
                Download {dataset?.kind === 'synthetic' ? 'synthetic example' : 'CSV header'}
              </button>
              {dataset?.kind === 'imported' && (
                <button onClick={() => void resetData()}>Restore synthetic data</button>
              )}
            </details>
          </div>
        </section>
        {error && (
          <p className="lab-alert" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="lab-notice" role="status">
            {notice}
          </p>
        )}
        <section className="lab-split" aria-label="Evaluation timeline">
          <div className="lab-section-heading">
            <h2>Keep the future out of selection.</h2>
            <span>24 MONTHS WARM-UP · FINAL 60 MONTHS RESERVED</span>
          </div>
          <div className="lab-timeline">
            <div className="warmup" style={{ flex: 24 }} />
            <div
              className="development"
              style={{ flex: Math.max(1, (dataset?.rows.length || 432) - 84) }}
            />
            <div className="reserved" style={{ flex: 60 }} />
          </div>
          <div className="lab-timeline-labels">
            <span>
              <i className="development" />
              Expanding training → next-year tests
            </span>
            <span>
              <i className="reserved" />
              {result
                ? `${month(result.split.holdoutStart)} — ${month(result.split.holdoutEnd)}`
                : 'Final 60 months'}{' '}
              · reserved evaluation
            </span>
          </div>
          <p>
            The automatic selector never uses the final window to choose its rule. Viewing or tuning
            against it makes the research exploratory; a historical split cannot establish future
            performance.
          </p>
        </section>
        <div className="lab-workspace" aria-busy={busy}>
          <aside className="lab-rules" aria-label="Strategy controls">
            <span className="lab-kicker">CHOOSE A RULE TO INSPECT</span>
            <div className="lab-rule-buttons">
              {STRATEGIES.map((rule) => (
                <button
                  key={rule.id}
                  aria-pressed={config.selectedStrategy === rule.id}
                  aria-label={`Inspect ${rule.name}`}
                  onClick={() =>
                    setConfig((current) => ({ ...current, selectedStrategy: rule.id }))
                  }
                >
                  <span className="lab-rule-dot" />
                  <span>
                    <b>{rule.name}</b>
                    <small>{rule.family}</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
            <div className="lab-cost-control">
              <label htmlFor="lab-cost">
                One-way trading cost <strong>{config.costBps} bps</strong>
              </label>
              <input
                id="lab-cost"
                type="range"
                min="0"
                max="100"
                step="1"
                value={config.costBps}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, costBps: Number(event.target.value) }))
                }
              />
              <p>
                10 bps = 0.10% of the amount traded. Includes a combined fee/slippage assumption;
                entry and rebalancing both count.
              </p>
            </div>
          </aside>
          <section className="lab-results" aria-label="Strategy evaluation" aria-busy={busy}>
            <div className="lab-chart-heading">
              <div>
                <span className="lab-kicker">RESERVED WINDOW · NET OF COSTS</span>
                <h2>100 units. The same starting line.</h2>
              </div>
              <span className="lab-run-state">
                {busy ? 'Evaluating…' : result ? 'Replay complete' : 'Evaluation unavailable'}
              </span>
            </div>
            <div className="lab-chart-legend">
              <span>
                <i />
                {selectedRule.name}
              </span>
              <span className="benchmark">
                <i />
                Market benchmark
              </span>
              <span>Equity above · drawdown below</span>
            </div>
            {selected && benchmark ? (
              <EquityChart selected={selected} benchmark={benchmark} />
            ) : (
              <div className="lab-loading">
                {busy
                  ? 'Evaluating the rules on equal terms…'
                  : 'No evaluation is available for these inputs.'}
              </div>
            )}
            <p className="lab-rule-description">{selectedRule.rule}</p>
            {selected && (
              <div className="lab-metrics">
                <div>
                  <span>Net annualized return</span>
                  <strong data-testid="lab-cagr">{pct(selected.metrics.cagr)}</strong>
                  <small>
                    {benchmark
                      ? `${pp(selected.metrics.cagr - benchmark.metrics.cagr)} vs. market`
                      : ''}
                  </small>
                </div>
                <div>
                  <span>Maximum drawdown</span>
                  <strong>{pct(selected.metrics.maxDrawdown)}</strong>
                  <small>Peak-to-trough loss</small>
                </div>
                <div>
                  <span>Excess-return Sharpe</span>
                  <strong>{number(selected.metrics.sharpe)}</strong>
                  <small>Monthly returns, annualized</small>
                </div>
                <div>
                  <span>Annual turnover</span>
                  <strong>{pct(selected.metrics.annualTurnover)}</strong>
                  <small>Includes drift and initial entry</small>
                </div>
              </div>
            )}
          </section>
        </div>
        {result && selected && (
          <>
            <section className="lab-comparison">
              <div className="lab-section-heading">
                <h2>Every rule. The same window.</h2>
                <span>FIXED RULES · NO PARAMETER SWEEP</span>
              </div>
              <div
                className="lab-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Scroll strategy comparison"
              >
                <table aria-label="Strategy comparison">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>Net annual return</th>
                      <th>Max drawdown</th>
                      <th>Sharpe</th>
                      <th>Annual volatility</th>
                      <th>Market exposure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((run) => (
                      <tr
                        key={run.id}
                        className={run.id === config.selectedStrategy ? 'selected' : ''}
                      >
                        <th>
                          {run.name}
                          {run.id === config.selectedStrategy && (
                            <span className="lab-current">Selected</span>
                          )}
                        </th>
                        <td>{pct(run.metrics.cagr)}</td>
                        <td>{pct(run.metrics.maxDrawdown)}</td>
                        <td>{number(run.metrics.sharpe)}</td>
                        <td>{pct(run.metrics.annualVol)}</td>
                        <td>{pct(run.metrics.averageExposure)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="lab-footnote">
                A high historical score is not evidence of an edge. The cash baseline has undefined
                Sharpe when excess-return variation is zero. The 60/40 baseline means market/cash,
                not stocks/bonds.
              </p>
            </section>
            <div className="lab-diagnostics">
              <section className="lab-diagnostic">
                <span className="lab-kicker">THE PRICE OF TRADING</span>
                <h2>Does the result survive costs?</h2>
                <p>{selectedRule.name} stays fixed as costs change.</p>
                <div className="lab-cost-bars">
                  {result.costSensitivity.map((row) => (
                    <div key={row.costBps}>
                      <span>{row.costBps} bps</span>
                      <div>
                        <i
                          style={{
                            width: `${Math.min(100, (Math.abs(row.cagr) / Math.max(0.001, ...result.costSensitivity.map((item) => Math.abs(item.cagr)))) * 100)}%`,
                          }}
                          className={row.cagr < 0 ? 'negative' : ''}
                        />
                      </div>
                      <b>{pct(row.cagr)}</b>
                    </div>
                  ))}
                </div>
                <small>
                  Bar length shows the absolute annual return; the number preserves its sign. No
                  market impact, taxes, or security-level fills.
                </small>
              </section>
              <section className="lab-diagnostic">
                <span className="lab-kicker">UNCERTAINTY, WITH ITS LIMITS</span>
                <h2>One history is a small sample.</h2>
                <p>{selectedRule.name}: annualized mean return difference versus the market:</p>
                <div className="lab-interval">
                  <strong>{pp(result.uncertainty.estimate)}</strong>
                  <span>95% block-bootstrap interval</span>
                  <b>
                    {pp(result.uncertainty.low)} to {pp(result.uncertainty.high)}
                  </b>
                </div>
                <small>
                  1,000 paired resamples · 6-month blocks · fixed seed. Conditional on these
                  realized returns and a stable dependence structure. This interval excludes
                  strategy-search uncertainty and is not a forecast or an alpha test.
                </small>
              </section>
            </div>
            <section className="lab-selection">
              <div className="lab-section-heading">
                <div>
                  <span className="lab-kicker">AUDIT THE SELECTION</span>
                  <h2>Winning the past is only the first step.</h2>
                </div>
                <span>{result.walkForward.folds.length} CHRONOLOGICAL TEST WINDOWS</span>
              </div>
              <div className="lab-selection-summary">
                <div>
                  <span>Walk-forward development</span>
                  <strong>{pct(result.walkForward.metrics.cagr)}</strong>
                  <p>
                    Net annualized return while selecting each next year's rule from earlier months
                    only.
                  </p>
                </div>
                <div>
                  <span>Rule frozen before the final window</span>
                  <strong className="lab-rule-name">
                    {ruleName(result.frozenSelection.chosenId)}
                  </strong>
                  <p>
                    Training Sharpe {number(result.frozenSelection.trainingSharpe)} · final-window
                    net annual return {pct(result.frozenSelection.metrics.cagr)}.
                  </p>
                </div>
              </div>
              <p className="lab-footnote">
                This automatic choice is separate from the rule you inspect above. The selector
                compares seven declared candidates by training excess Sharpe. Its ledger carries
                actual holdings across switches. Development and final-window returns cover
                different dates; compare each within its own window.
              </p>
              <details>
                <summary>Open the walk-forward selection ledger</summary>
                <div
                  className="lab-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Scroll walk-forward selection"
                >
                  <table aria-label="Walk-forward selection">
                    <thead>
                      <tr>
                        <th>Training ends</th>
                        <th>Next test window</th>
                        <th>Chosen rule</th>
                        <th>Training Sharpe</th>
                        <th>Next-window return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.walkForward.folds.map((fold) => (
                        <tr key={fold.testStart}>
                          <td>{month(fold.trainEnd)}</td>
                          <td>
                            {month(fold.testStart)} — {month(fold.testEnd)}
                          </td>
                          <td>{ruleName(fold.chosenId)}</td>
                          <td>{number(fold.trainingSharpe)}</td>
                          <td>{pct(fold.testReturn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
            <section className="lab-audit">
              <details>
                <summary>Inspect the monthly position & cost ledger</summary>
                <p>
                  Targets are decided before the month's return. The previous weight includes drift
                  from the earlier month. No opening price is inferred from monthly returns.
                </p>
                <div
                  className="lab-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Scroll monthly positions and costs"
                >
                  <table aria-label="Monthly position and cost ledger">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Previous weight</th>
                        <th>Target weight</th>
                        <th>Turnover</th>
                        <th>Cost / NAV</th>
                        <th>Net return</th>
                        <th>Wealth index</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.ledger.map((row) => (
                        <tr key={row.date}>
                          <td>{row.date}</td>
                          <td>{pct(row.previousWeight)}</td>
                          <td>{pct(row.targetWeight)}</td>
                          <td>{pct(row.turnover)}</td>
                          <td>{(row.costFraction * 100).toFixed(3)}%</td>
                          <td>{pct(row.netReturn)}</td>
                          <td>{(row.equity * 100).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <details>
                <summary>Inspect data provenance & interpretation</summary>
                <p>{dataset?.source}</p>
                <ul>
                  {dataset?.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
                <dl>
                  <dt>Canonical data SHA-256</dt>
                  <dd>{dataset?.dataSha256}</dd>
                  <dt>Original file SHA-256</dt>
                  <dd>
                    {dataset?.rawSha256 || 'No imported file; deterministic synthetic generator.'}
                  </dd>
                </dl>
                <p>
                  Monthly total-return index/cash replay. No actual order book, tradable fund, tax
                  model, shorting, leverage, or point-in-time data verification is represented.{' '}
                  <a
                    href={`${REPO}/blob/main/docs/STRATEGY_LAB.md`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read the full contract ↗
                  </a>
                </p>
              </details>
            </section>
          </>
        )}
        <section className="lab-takeaway">
          <div>
            <span className="lab-kicker">KEEP THE EXPERIMENT REPRODUCIBLE</span>
            <h2>Take the evidence with you.</h2>
            <p>Export the source hashes, data, rules, windows, and every monthly position.</p>
          </div>
          <button
            className="lab-button primary"
            disabled={!result || busy || importing || !!error}
            onClick={exportRun}
          >
            <Download size={16} />
            Export research run
          </button>
        </section>
        <section className="lab-references">
          <h2>Learn broadly. Test precisely.</h2>
          <p>
            Design lessons from LEAN, Backtrader, vectorbt, backtesting.py, Freqtrade, Qlib, FinRL,
            Zipline, skfolio, and PyPortfolioOpt. The survey records what we adopted, what needs
            more evidence, and where licensing differs.
          </p>
          <a href={`${REPO}/blob/main/docs/STRATEGY_RESEARCH.md`} target="_blank" rel="noreferrer">
            Read the project comparison & research roadmap <ArrowUpRight size={14} />
          </a>
        </section>
      </main>
      <footer className="lab-footer">
        <span>A personal project by Chen Yang.</span>
        <span>Exploratory research · no trade execution · {LAB_VERSION}</span>
        <a href="#">
          Back to Atlas <ArrowUpRight size={13} />
        </a>
      </footer>
    </div>
  )
}

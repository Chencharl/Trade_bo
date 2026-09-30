import { useEffect, useState } from 'react'
import { ArrowRight, ExternalLink, RefreshCw, Search, Settings2, X } from 'lucide-react'
import type { Action, Analysis, Answer, Board, Mode, Model, Page, PaperOrder, Role } from './types'

const usd = (value: number, digits = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} pp`
const dateLabel = (value: string) => value.slice(0, 10)
const cap = (value: number | null) =>
  value == null ? 'Unavailable' : `$${(value / 1e9).toFixed(1)}B`
const actionLabel: Record<Action, string> = {
  REVIEW_ADD: 'ADD REVIEW',
  REVIEW_REDUCE: 'REDUCE REVIEW',
  HOLD: 'HOLD',
  DATA_HOLD: 'DATA HOLD',
}
const actionTone: Record<Action, string> = {
  REVIEW_ADD: 'positive',
  REVIEW_REDUCE: 'negative',
  HOLD: 'neutral',
  DATA_HOLD: 'warning',
}
const prompts = [
  'Can we add to this position?',
  'How does this fit our portfolio?',
  'What do recent news items show?',
  'What is the observed downside risk?',
]

function TrendChart({ analysis }: { analysis: Analysis }) {
  const series = analysis.market.history
  const values = series.map((row) => row.close)
  const low = Math.min(...values) * 0.985
  const high = Math.max(...values) * 1.015
  const x = (index: number) => 22 + (index / Math.max(1, values.length - 1)) * 656
  const y = (value: number) => 174 - ((value - low) / (high - low || 1)) * 145
  const path = values
    .map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ')
  return (
    <div
      className="trend-chart"
      role="img"
      aria-label={`Daily closing prices for ${analysis.symbol}`}
    >
      <svg viewBox="0 0 700 195" preserveAspectRatio="none">
        {[30, 78, 126, 174].map((row) => (
          <line key={row} x1="22" x2="678" y1={row} y2={row} stroke="#e5eaed" />
        ))}
        <path
          d={path}
          fill="none"
          stroke="#386378"
          strokeWidth="2.1"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(values.length - 1)} cy={y(values.at(-1) || 0)} r="4" fill="#386378" />
      </svg>
      <div className="chart-axis">
        <span>{series[0]?.date}</span>
        <span>Daily closes · no forecast</span>
        <span>{series.at(-1)?.date}</span>
      </div>
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function ModelEditor({
  draft,
  onDraft,
  onClose,
  onSave,
  error,
  busy,
}: {
  draft: Model
  onDraft: (next: Model) => void
  onClose: () => void
  onSave: () => void
  error: string
  busy: boolean
}) {
  const updateHolding = (symbol: string, field: string, value: number | string | null) => {
    onDraft({
      ...draft,
      holdings: draft.holdings.map((row) =>
        row.symbol === symbol ? { ...row, [field]: value } : row,
      ),
    })
  }
  const targetSum = Object.values(draft.targets).reduce((sum, value) => sum + Number(value || 0), 0)
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="model-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-title"
      >
        <div className="drawer-head">
          <div>
            <span className="eyebrow">MODEL INPUTS</span>
            <h2 id="model-title">Edit portfolio model</h2>
          </div>
          <button className="icon-button" aria-label="Close editor" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <p className="drawer-intro">
          Change the illustrative cash balance, shares, roles, and target weights. Inputs remain in
          this local browser session and are sent only to the local research server.
        </p>
        <div className="edit-section">
          <h3>Cash and target</h3>
          <div className="editor-grid">
            <label>
              Cash balance, USD
              <input
                type="number"
                min="0"
                value={draft.cash}
                onChange={(event) => onDraft({ ...draft, cash: Number(event.target.value) })}
              />
            </label>
            <label>
              Cash target, %
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={draft.targets.CASH}
                onChange={(event) =>
                  onDraft({
                    ...draft,
                    targets: { ...draft.targets, CASH: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>
        </div>
        <div className="edit-section">
          <h3>Positions</h3>
          <div className="edit-position-list">
            {draft.holdings.map((row) => (
              <div className="edit-position" key={row.symbol}>
                <div className="edit-symbol">{row.symbol}</div>
                <div className="editor-grid four">
                  <label>
                    Shares
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.shares}
                      onChange={(event) =>
                        updateHolding(row.symbol, 'shares', Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    Cost / share
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.cost_basis ?? ''}
                      onChange={(event) =>
                        updateHolding(
                          row.symbol,
                          'cost_basis',
                          event.target.value === '' ? null : Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    Target, %
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={draft.targets[row.symbol] ?? 0}
                      onChange={(event) =>
                        onDraft({
                          ...draft,
                          targets: { ...draft.targets, [row.symbol]: Number(event.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    Role
                    <select
                      value={row.role}
                      onChange={(event) =>
                        updateHolding(row.symbol, 'role', event.target.value as Role)
                      }
                    >
                      <option>Core</option>
                      <option>Tactical</option>
                      <option>Defensive</option>
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="edit-section">
          <h3>Risk limits</h3>
          <div className="editor-grid three">
            {(
              [
                ['max_position_pct', 'Single name max, %'],
                ['max_sector_pct', 'Sector max, %'],
                ['min_cash_pct', 'Min cash, %'],
                ['risk_per_trade_pct', 'Risk budget, %'],
                ['planning_stop_pct', 'Planning stop, %'],
                ['rebalance_band_pct', 'Review band, pp'],
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={draft.policy[field]}
                  onChange={(event) =>
                    onDraft({
                      ...draft,
                      policy: { ...draft.policy, [field]: Number(event.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
        <div className="drawer-footer">
          <div>
            <span className={Math.abs(targetSum - 100) < 0.01 ? 'sum-ok' : 'sum-error'}>
              Target total {targetSum.toFixed(1)}% / 100%
            </span>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            onClick={onSave}
            disabled={busy || Math.abs(targetSum - 100) > 0.01}
          >
            Apply model
          </button>
        </div>
      </section>
    </div>
  )
}

function App() {
  const [page, setPage] = useState<Page>('portfolio')
  const [mode, setMode] = useState<Mode>('demo')
  const [board, setBoard] = useState<Board | null>(null)
  const [selected, setSelected] = useState('ORBT')
  const [tickerInput, setTickerInput] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Model | null>(null)
  const [editorError, setEditorError] = useState('')
  const [paperMessage, setPaperMessage] = useState('')

  async function load(nextMode: Mode) {
    setBusy(true)
    setError('')
    setAnswer(null)
    setPaperMessage('')
    try {
      const response = await fetch(`/api/dashboard?mode=${nextMode}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'The research server did not return data.')
      setMode(nextMode)
      setBoard(data)
      setSelected(data.analyses[0]?.symbol || '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the research desk.')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load('demo')
  }, [])

  async function recalculate(nextModel: Model, nextSymbols = board?.symbols || []) {
    if (!board) return false
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, model: nextModel, symbols: nextSymbols }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to recalculate the portfolio.')
      setBoard(data)
      setAnswer(null)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to recalculate.')
      return false
    } finally {
      setBusy(false)
    }
  }
  function openEditor() {
    if (board) {
      setDraft(structuredClone(board.portfolio.model))
      setEditorError('')
      setEditing(true)
    }
  }
  async function saveEditor() {
    if (!draft) return
    const worked = await recalculate(draft)
    if (worked) {
      setEditing(false)
      setDraft(null)
    } else setEditorError('The model was not applied. Review the portfolio inputs and limits.')
  }
  async function loadTicker() {
    if (!board) return
    const symbol = tickerInput.trim().toUpperCase()
    if (!/^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(symbol)) {
      setError('Enter a US equity ticker with 1–5 letters and an optional class suffix.')
      return
    }
    if (board.symbols.includes(symbol)) {
      setSelected(symbol)
      setPage('research')
      setTickerInput('')
      setError('')
      setAnswer(null)
      return
    }
    if (mode === 'demo') {
      setError(
        'This ticker is outside the fictional sample. Switch to real data to research another US equity.',
      )
      return
    }
    if (board.symbols.length >= 8) {
      setError('The local research universe is limited to eight tickers.')
      return
    }
    const model = structuredClone(board.portfolio.model)
    model.holdings.push({ symbol, shares: 0, cost_basis: null, role: 'Tactical' })
    model.targets[symbol] = 0
    const worked = await recalculate(model, [...board.symbols, symbol])
    if (worked) {
      setSelected(symbol)
      setPage('research')
      setTickerInput('')
      setAnswer(null)
    }
  }
  async function ask(customQuestion?: string) {
    if (!board) return
    const text = (customQuestion ?? question).trim()
    if (!text) return
    setQuestion(text)
    setBusy(true)
    setError('')
    setAnswer(null)
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          model: board.portfolio.model,
          symbols: board.symbols,
          symbol: selected,
          question: text,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to answer from current evidence.')
      setAnswer(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to answer this question.')
    } finally {
      setBusy(false)
    }
  }
  async function createPaperPlan() {
    if (!board || !active) return
    setBusy(true)
    setPaperMessage('')
    setError('')
    const side = active.action === 'REVIEW_ADD' ? 'BUY' : 'SELL'
    try {
      const response = await fetch('/api/paper/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          model: board.portfolio.model,
          symbols: board.symbols,
          symbol: selected,
          side,
          quantity,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'The paper plan was not created.')
      setBoard({
        ...board,
        paper_orders: [...board.paper_orders, { ...data, matches_model: true }],
      })
      setPaperMessage(
        `Draft ${side.toLowerCase()} plan recorded for ${quantity} ${quantity === 1 ? 'share' : 'shares'}. No order was sent.`,
      )
    } catch (cause) {
      setPaperMessage(cause instanceof Error ? cause.message : 'Unable to create draft.')
    } finally {
      setBusy(false)
    }
  }
  function navigate(next: Page) {
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const active = board?.analyses.find((item) => item.symbol === selected) || board?.analyses[0]
  const relevantNews = active?.news.filter((item) => item.relevant) || []
  const paperCeiling =
    active?.action === 'REVIEW_ADD'
      ? active.suggested_max_add_shares
      : active?.action === 'REVIEW_REDUCE'
        ? active.review_reduce_shares
        : 0
  const currentSide = active?.action === 'REVIEW_ADD' ? 'BUY' : 'SELL'
  const planned =
    board?.paper_orders
      .filter(
        (order) =>
          order.matches_model && order.symbol === active?.symbol && order.side === currentSide,
      )
      .reduce((sum, order) => sum + order.quantity, 0) || 0
  const remaining = Math.max(0, paperCeiling - planned)
  const reviewCandidates =
    board?.analyses.filter(
      (item) => item.action === 'REVIEW_ADD' || item.action === 'REVIEW_REDUCE',
    ) || []

  return (
    <div className="app">
      <header className="site-header">
        <div className="header-inner">
          <div className="identity">
            <span className="identity-mark">TB/</span>
            <div>
              <strong>TradeBo</strong>
              <small>US EQUITY RESEARCH</small>
            </div>
          </div>
          <div className="header-meta">
            <span>LOCAL RESEARCH ENVIRONMENT</span>
            <span className="meta-separator" />{' '}
            <span>
              {new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
        </div>
      </header>
      <div className="nav-shell">
        <nav className="main-nav" aria-label="Main navigation">
          {(
            [
              ['portfolio', 'Portfolio'],
              ['research', 'Security research'],
              ['method', 'Methodology'],
              ['paper', 'Paper plans'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={page === key ? 'nav-link selected' : 'nav-link'}
              onClick={() => navigate(key)}
            >
              {label}
              {key === 'paper' && board && (
                <span className="nav-count">{board.paper_orders.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="mode-switch">
          <span>DATA</span>
          <button
            className={mode === 'demo' ? 'mode active' : 'mode'}
            onClick={() => void load('demo')}
          >
            Sample
          </button>
          <button
            className={mode === 'live' ? 'mode active' : 'mode'}
            onClick={() => void load('live')}
          >
            Provider
          </button>
        </div>
      </div>
      <main className="main">
        <div className="status-line">
          <span className={mode === 'demo' ? 'sample-indicator' : 'provider-indicator'}>
            {mode === 'demo' ? 'SYNTHETIC SAMPLE' : 'PROVIDER DATA'}
          </span>
          <span>
            {mode === 'demo'
              ? 'Fictional companies, prices, and articles. No real market inference.'
              : 'Daily data; availability and timeliness depend on the provider.'}
          </span>
          <button
            className="text-button refresh-button"
            onClick={() => void load(mode)}
            disabled={busy}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {!board && (
          <div className="empty-state">
            <h1>{busy ? 'Loading research inputs' : 'Research data is unavailable'}</h1>
            <p>
              {busy
                ? 'Checking prices, sources, and the portfolio model.'
                : 'Configure a provider key or return to the synthetic sample.'}
            </p>
            <button className="button secondary" onClick={() => void load('demo')}>
              Open sample portfolio
            </button>
          </div>
        )}
        {board && page === 'portfolio' && (
          <>
            <div className="page-title">
              <div>
                <span className="eyebrow">PORTFOLIO / 01</span>
                <h1>Portfolio review</h1>
                <p>Position sizing, sector exposure, and trade posture from one explicit model.</p>
              </div>
              <button className="button secondary" onClick={openEditor}>
                <Settings2 size={16} /> Edit model
              </button>
            </div>
            <div className="metrics-row">
              <Metric
                label="NET ASSET VALUE"
                value={usd(board.portfolio.nav)}
                detail="Cash + priced shares"
              />
              <Metric
                label="CASH RESERVE"
                value={pct(board.portfolio.cash_weight_pct)}
                detail={`${usd(board.portfolio.cash)} · minimum ${pct(board.portfolio.policy.min_cash_pct)}`}
              />
              <Metric
                label="LARGEST POSITION"
                value={pct(
                  Math.max(0, ...board.portfolio.positions.map((item) => item.weight_pct)),
                )}
                detail={
                  board.portfolio.positions.reduce(
                    (largest, item) =>
                      item.weight_pct > (largest?.weight_pct || 0) ? item : largest,
                    board.portfolio.positions[0],
                  )?.symbol || 'No positions'
                }
              />
              <Metric
                label="REVIEW CANDIDATES"
                value={String(reviewCandidates.length).padStart(2, '0')}
                detail={`${reviewCandidates.filter((item) => item.action === 'REVIEW_ADD').length} add / ${reviewCandidates.filter((item) => item.action === 'REVIEW_REDUCE').length} reduce`}
              />
            </div>
            <div className="portfolio-grid">
              <section className="panel holdings-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">POSITION REGISTER</span>
                    <h2>Holdings and target weights</h2>
                  </div>
                  <span className="subtle">Click a row to open its research file</span>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Security / role</th>
                        <th>Sector</th>
                        <th className="numeric">Shares</th>
                        <th className="numeric">Market value</th>
                        <th className="numeric">Weight</th>
                        <th className="numeric">Target</th>
                        <th className="numeric">Drift</th>
                        <th>Posture</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.portfolio.positions.map((position) => {
                        const research = board.analyses.find(
                          (item) => item.symbol === position.symbol,
                        )
                        return (
                          <tr
                            className="clickable-row"
                            key={position.symbol}
                            onClick={() => {
                              setSelected(position.symbol)
                              setAnswer(null)
                              navigate('research')
                            }}
                          >
                            <td>
                              <strong>{position.symbol}</strong>
                              <span>
                                {position.name} · {position.role}
                              </span>
                            </td>
                            <td>{position.sector}</td>
                            <td className="numeric">{position.shares.toLocaleString()}</td>
                            <td className="numeric">{usd(position.value)}</td>
                            <td className="numeric emphasize">{pct(position.weight_pct)}</td>
                            <td className="numeric">{pct(position.target_pct)}</td>
                            <td
                              className={`numeric ${Math.abs(position.drift_pp) > board.portfolio.policy.rebalance_band_pct ? 'alert-text' : ''}`}
                            >
                              {signed(position.drift_pp)}
                            </td>
                            <td>
                              <span
                                className={`status-tag ${actionTone[research?.action || 'HOLD']}`}
                              >
                                {actionLabel[research?.action || 'HOLD']}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="table-caption">
                  Weights use latest available daily closes. Cost basis is excluded from allocation
                  sizing. Targets are user inputs, not optimized forecasts.
                </div>
              </section>
              <aside className="review-aside">
                <div className="aside-heading">
                  <span className="eyebrow">INVESTMENT COMMITTEE NOTE</span>
                  <h2>Review queue</h2>
                </div>
                {board.portfolio.alerts.length === 0 && (
                  <p className="muted">No allocation limit breaches in the loaded model.</p>
                )}
                {board.portfolio.alerts.slice(0, 4).map((item, index) => (
                  <div className="queue-item" key={`${item.text}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <p>{item.text}</p>
                  </div>
                ))}
                {reviewCandidates.slice(0, 4).map((item) => (
                  <button
                    className="queue-item queue-button"
                    key={item.symbol}
                    onClick={() => {
                      setSelected(item.symbol)
                      navigate('research')
                    }}
                  >
                    <span>{item.symbol}</span>
                    <p>
                      {actionLabel[item.action]} · {item.reason}
                    </p>
                    <ArrowRight size={15} />
                  </button>
                ))}
                <div className="aside-foot">
                  <strong>Control hierarchy</strong>
                  <p>
                    Data quality → portfolio caps → role-specific entry or reduction → human
                    execution review.
                  </p>
                </div>
              </aside>
            </div>
            <div className="lower-grid">
              <section className="panel sector-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">EXPOSURE MAP</span>
                    <h2>Sector weights</h2>
                  </div>
                  <span className="subtle">Limit {pct(board.portfolio.policy.max_sector_pct)}</span>
                </div>
                <div className="sector-list">
                  {board.portfolio.sectors.map((sector) => (
                    <div className="sector-row" key={sector.sector}>
                      <div>
                        <strong>{sector.sector}</strong>
                        <span>{sector.symbols.join(' · ')}</span>
                      </div>
                      <div className="sector-meter">
                        <span style={{ width: `${Math.min(sector.weight_pct * 2, 100)}%` }} />
                        <i
                          style={{
                            left: `${Math.min(board.portfolio.policy.max_sector_pct * 2, 100)}%`,
                          }}
                        />
                      </div>
                      <div className="sector-number">
                        {pct(sector.weight_pct)}
                        <small>target {pct(sector.target_pct)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel plan-panel">
                <span className="eyebrow">MODEL INTENT</span>
                <h2>Construction plan</h2>
                <div className="plan-line">
                  <span>Cash target</span>
                  <strong>{pct(board.portfolio.cash_target_pct)}</strong>
                </div>
                <div className="plan-line">
                  <span>Minimum cash</span>
                  <strong>{pct(board.portfolio.policy.min_cash_pct)}</strong>
                </div>
                <div className="plan-line">
                  <span>Single-name ceiling</span>
                  <strong>{pct(board.portfolio.policy.max_position_pct)}</strong>
                </div>
                <div className="plan-line">
                  <span>Sector ceiling</span>
                  <strong>{pct(board.portfolio.policy.max_sector_pct)}</strong>
                </div>
                <div className="plan-line">
                  <span>Rebalance review band</span>
                  <strong>±{board.portfolio.policy.rebalance_band_pct.toFixed(1)} pp</strong>
                </div>
                <p>
                  Targets and limits are editable. A target breach opens a review; it never creates
                  an automatic order.
                </p>
              </section>
            </div>
            <section className="panel role-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">STRATEGY ALLOCATION</span>
                  <h2>Exposure by trading role</h2>
                </div>
                <span className="subtle">Current weight / model target</span>
              </div>
              <div className="role-grid">
                {board.portfolio.roles.map((group) => (
                  <div className="role-card" key={group.role}>
                    <div>
                      <strong>{group.role}</strong>
                      <span>{group.symbols.join(' · ') || 'No securities assigned'}</span>
                    </div>
                    <p>
                      <strong>{pct(group.weight_pct)}</strong>
                      <span>
                        target {pct(group.target_pct)} · {signed(group.drift_pp)}
                      </span>
                    </p>
                    <div className="role-meter">
                      <span style={{ width: `${Math.min(group.weight_pct, 100)}%` }} />
                      <i style={{ left: `${Math.min(group.target_pct, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        {board && page === 'research' && active && (
          <>
            <div className="page-title research-title">
              <div>
                <span className="eyebrow">SECURITY FILE / 02</span>
                <h1>Security research</h1>
                <p>Evidence, portfolio context, and a direct answer to a specific question.</p>
              </div>
              <div className="ticker-search">
                <label htmlFor="ticker-input" className="sr-only">
                  US equity ticker
                </label>
                <input
                  id="ticker-input"
                  placeholder="Ticker e.g. AAPL"
                  value={tickerInput}
                  onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void loadTicker()
                  }}
                />
                <button onClick={() => void loadTicker()} disabled={busy}>
                  <Search size={16} /> Load ticker
                </button>
              </div>
            </div>
            <div className="research-universe">
              Loaded universe:{' '}
              {board.symbols.map((symbol) => (
                <button
                  key={symbol}
                  className={active.symbol === symbol ? 'ticker-chip active' : 'ticker-chip'}
                  onClick={() => {
                    setSelected(symbol)
                    setAnswer(null)
                    setQuestion('')
                    setPaperMessage('')
                    setQuantity(1)
                  }}
                >
                  {symbol}
                </button>
              ))}
            </div>
            <section className="panel security-head">
              <div className="security-identity">
                <div>
                  <span className="eyebrow">
                    {active.sector.toUpperCase()} / {active.role.toUpperCase()}
                  </span>
                  <h2>
                    {active.name} <span>{active.symbol}</span>
                  </h2>
                  <p>{active.method}</p>
                </div>
                <span className={`status-tag large ${actionTone[active.action]}`}>
                  {actionLabel[active.action]}
                </span>
              </div>
              <div className="security-summary">
                <div className="security-price">
                  <strong>{usd(active.market.price, 2)}</strong>
                  <span className={active.market.change_pct >= 0 ? 'up' : 'down'}>
                    {active.market.change_pct > 0 ? '+' : ''}
                    {pct(active.market.change_pct, 2)} day
                  </span>
                  <small>Daily close · {active.market.as_of}</small>
                </div>
                <div className="security-summary-stat">
                  <span>PORTFOLIO WEIGHT</span>
                  <strong>{pct(active.weight_pct)}</strong>
                  <small>Target {pct(active.target_pct)}</small>
                </div>
                <div className="security-summary-stat">
                  <span>MARKET CAP</span>
                  <strong>{cap(active.overview.market_cap)}</strong>
                  <small>{active.overview.source}</small>
                </div>
                <div className="security-summary-stat">
                  <span>RESEARCH STATUS</span>
                  <strong>{active.relevant_article_count} articles</strong>
                  <small>{active.independent_source_count} named sources</small>
                </div>
              </div>
            </section>
            <div className="research-grid">
              <div className="research-main">
                <section className="panel price-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">MARKET OBSERVATION / M1</span>
                      <h2>Price and risk</h2>
                    </div>
                    <span className="subtle">Last {active.market.history.length} observations</span>
                  </div>
                  <TrendChart analysis={active} />
                  <div className="stat-grid">
                    <div>
                      <span>20-day return</span>
                      <strong className={active.market.return_20d_pct >= 0 ? 'up' : 'down'}>
                        {pct(active.market.return_20d_pct)}
                      </strong>
                    </div>
                    <div>
                      <span>20-day average</span>
                      <strong>{usd(active.market.sma20, 2)}</strong>
                    </div>
                    <div>
                      <span>50-day average</span>
                      <strong>{usd(active.market.sma50, 2)}</strong>
                    </div>
                    <div>
                      <span>Observed volatility</span>
                      <strong>{pct(active.market.volatility_annualized_pct)}</strong>
                    </div>
                    <div>
                      <span>Observed max drawdown</span>
                      <strong>{pct(active.market.max_drawdown_observed_pct)}</strong>
                    </div>
                  </div>
                </section>
                <section className="panel rule-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">DECISION RECORD / R1</span>
                      <h2>Rule evaluation</h2>
                    </div>
                    <span className="subtle">
                      {active.buy_gates.filter((gate) => gate.passed).length}/
                      {active.buy_gates.length} add checks pass
                    </span>
                  </div>
                  <p className="rule-reason">{active.reason}</p>
                  <div className="rule-list">
                    {active.buy_gates.map((gate) => (
                      <div className="rule-row" key={gate.id}>
                        <span
                          className={gate.passed ? 'rule-indicator pass' : 'rule-indicator fail'}
                        >
                          {gate.passed ? 'PASS' : 'BLOCK'}
                        </span>
                        <div>
                          <strong>{gate.label}</strong>
                          <p>{gate.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {active.sell_triggers.length > 0 && (
                    <div className="sell-note">
                      <strong>Reduction triggers</strong>
                      <span>{active.sell_triggers.join(' · ')}</span>
                    </div>
                  )}
                </section>
                <section className="panel news-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">SOURCE REGISTER / N1+</span>
                      <h2>Relevant articles</h2>
                    </div>
                    <span className="subtle">Explicit ticker tag · 72 hours</span>
                  </div>
                  {relevantNews.length === 0 ? (
                    <p className="empty-copy">
                      No recent ticker-tagged articles passed the relevance filter. An event-based
                      add cannot be justified by this feed.
                    </p>
                  ) : (
                    relevantNews.map((item, index) => (
                      <article className="article-row" key={item.url}>
                        <div className="article-index">N{index + 1}</div>
                        <div>
                          <div className="article-meta">
                            {item.source} · {dateLabel(item.published_at)} · {item.sentiment} label
                            · relevance {Math.round(item.relevance * 100)}%
                          </div>
                          <h3>
                            {mode === 'demo' ? (
                              item.title
                            ) : (
                              <a href={item.url} target="_blank" rel="noreferrer">
                                {item.title} <ExternalLink size={13} />
                              </a>
                            )}
                          </h3>
                          <p>{item.summary}</p>
                        </div>
                      </article>
                    ))
                  )}
                  <div className="table-caption">
                    Provider sentiment is metadata. Articles require original-source review before
                    any trade decision.
                  </div>
                </section>
              </div>
              <aside className="research-side">
                <section className="panel fundamentals-panel">
                  <span className="eyebrow">FUNDAMENTALS / F1</span>
                  <h2>Company overview</h2>
                  <div className="fact-line">
                    <span>P/E ratio</span>
                    <strong>
                      {active.overview.pe_ratio == null
                        ? 'Unavailable'
                        : `${active.overview.pe_ratio.toFixed(1)}×`}
                    </strong>
                  </div>
                  <div className="fact-line">
                    <span>Revenue, TTM</span>
                    <strong>
                      {active.overview.revenue_ttm == null
                        ? 'Unavailable'
                        : cap(active.overview.revenue_ttm)}
                    </strong>
                  </div>
                  <div className="fact-line">
                    <span>Profit margin</span>
                    <strong>
                      {active.overview.profit_margin == null
                        ? 'Unavailable'
                        : pct(active.overview.profit_margin * 100)}
                    </strong>
                  </div>
                  <div className="fact-line">
                    <span>Dividend yield</span>
                    <strong>
                      {active.overview.dividend_yield == null
                        ? 'Unavailable'
                        : pct(active.overview.dividend_yield * 100)}
                    </strong>
                  </div>
                  <p>
                    Snapshot from {active.overview.source}. No fair-value estimate is inferred from
                    these fields.
                  </p>
                </section>
                <section className="panel posture-panel">
                  <span className="eyebrow">PORTFOLIO CONTEXT / P1</span>
                  <h2>Position and method</h2>
                  <div className="fact-line">
                    <span>Shares held</span>
                    <strong>{active.position_shares}</strong>
                  </div>
                  <div className="fact-line">
                    <span>Market value</span>
                    <strong>{usd(active.position_value)}</strong>
                  </div>
                  <div className="fact-line">
                    <span>Current / target</span>
                    <strong>
                      {pct(active.weight_pct)} / {pct(active.target_pct)}
                    </strong>
                  </div>
                  <div className="fact-line">
                    <span>Planning stop</span>
                    <strong>{usd(active.planning_stop, 2)}</strong>
                  </div>
                  <p>
                    The stop is a sizing input, not a guaranteed exit price. Role: {active.role}.
                  </p>
                  {(active.action === 'REVIEW_ADD' || active.action === 'REVIEW_REDUCE') && (
                    <div className="draft-form">
                      <label htmlFor="paper-quantity">
                        Draft {active.action === 'REVIEW_ADD' ? 'add' : 'reduce'} quantity
                      </label>
                      <small>Remaining review ceiling: {remaining} shares</small>
                      <div>
                        <input
                          id="paper-quantity"
                          type="number"
                          min="1"
                          max={remaining}
                          value={quantity}
                          onChange={(event) => setQuantity(Number(event.target.value))}
                        />
                        <button
                          className="button primary"
                          onClick={() => void createPaperPlan()}
                          disabled={
                            busy ||
                            !Number.isInteger(quantity) ||
                            quantity < 1 ||
                            quantity > remaining
                          }
                        >
                          Record paper plan
                        </button>
                      </div>
                      {paperMessage && (
                        <p className="paper-message" role="status">
                          {paperMessage}
                        </p>
                      )}
                    </div>
                  )}
                </section>
              </aside>
            </div>
            <section className="panel ask-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">RESEARCH QUESTION / Q1</span>
                  <h2>Ask about {active.symbol}</h2>
                </div>
                <span className="subtle">Answers use only loaded evidence</span>
              </div>
              <form
                className="ask-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void ask()
                }}
              >
                <label htmlFor="research-question" className="sr-only">
                  Research question
                </label>
                <input
                  id="research-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder={`Example: Can we add to ${active.symbol} within our target weight?`}
                />
                <button className="button primary" disabled={busy || !question.trim()}>
                  Answer question <ArrowRight size={15} />
                </button>
              </form>
              <div className="prompt-list">
                {prompts.map((prompt) => (
                  <button key={prompt} onClick={() => void ask(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
              {answer && (
                <div className="answer-record">
                  <div className="answer-copy">
                    <span className="eyebrow">DIRECT ANSWER</span>
                    <p>{answer.answer}</p>
                  </div>
                  <div className="source-ledger">
                    <h3>Evidence cited</h3>
                    {answer.evidence.map((entry) => (
                      <div key={entry.id}>
                        <code>[{entry.id}]</code>
                        <span>
                          <strong>{entry.label}</strong>
                          <small>
                            {entry.detail} · {dateLabel(entry.as_of)}
                          </small>
                        </span>
                        {entry.url && (
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${entry.label}`}
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="answer-limits">{answer.limitations.join(' ')}</div>
                </div>
              )}
            </section>
          </>
        )}
        {board && page === 'method' && (
          <>
            <div className="page-title">
              <div>
                <span className="eyebrow">METHODOLOGY / 03</span>
                <h1>Research protocol</h1>
                <p>Explicit rules, source boundaries, and failure conditions.</p>
              </div>
            </div>
            <div className="method-grid">
              <section className="panel">
                <span className="eyebrow">SECURITY ROLES</span>
                <h2>Three distinct trade methods</h2>
                <div className="method-table">
                  <div>
                    <strong>Core</strong>
                    <p>
                      Review allocation on a schedule. Adds require available target headroom, a
                      close at or above the 50-day average, and no adverse recent event tag.
                    </p>
                  </div>
                  <div>
                    <strong>Tactical</strong>
                    <p>
                      Use staged event entries. An add requires close &gt; 20-day &gt; 50-day
                      average and two recent positive ticker-tagged articles from distinct named
                      sources. A downtrend opens a reduction review.
                    </p>
                  </div>
                  <div>
                    <strong>Defensive</strong>
                    <p>
                      Review allocation with a non-negative reported profit margin and no adverse
                      recent event tag. No momentum-only entry.
                    </p>
                  </div>
                </div>
              </section>
              <section className="panel">
                <span className="eyebrow">PORTFOLIO CONTROLS</span>
                <h2>Constraints before a trade</h2>
                <ol className="method-list">
                  <li>Compute NAV from cash plus shares × latest available close.</li>
                  <li>
                    Check single-name, sector, cash-reserve, target-weight, and risk-budget limits.
                  </li>
                  <li>
                    Pause all trade reviews when the latest daily price is older than five calendar
                    days.
                  </li>
                  <li>
                    Record a draft only. Recheck evidence, market session, limit price, taxes, fees,
                    and slippage before any future broker integration.
                  </li>
                </ol>
              </section>
              <section className="panel">
                <span className="eyebrow">EVIDENCE CLASSES</span>
                <h2>What the system can support</h2>
                <div className="method-table">
                  <div>
                    <strong>Market</strong>
                    <p>
                      Raw daily closes and descriptive historical indicators. Splits and dividends
                      are not adjusted in this prototype.
                    </p>
                  </div>
                  <div>
                    <strong>News</strong>
                    <p>
                      Explicit ticker tags, article timestamps, duplicate removal, and provider
                      sentiment labels. Article content and issuer claims are not independently
                      verified.
                    </p>
                  </div>
                  <div>
                    <strong>Fundamentals</strong>
                    <p>
                      Provider overview fields as a snapshot. A P/E ratio or margin is not a
                      valuation model.
                    </p>
                  </div>
                  <div>
                    <strong>Portfolio</strong>
                    <p>
                      User-entered shares, cash, roles, targets, and limits. Model inputs are
                      assumptions until verified against an account statement.
                    </p>
                  </div>
                </div>
              </section>
              <section className="panel">
                <span className="eyebrow">NOT IMPLEMENTED</span>
                <h2>Research limits</h2>
                <p className="method-copy">
                  This release has no return forecast, tax-lot engine, transaction-cost backtest,
                  company filing review, broker connection, or automatic execution. The
                  question-answering layer gives bounded answers from the loaded fields and
                  explicitly declines unsupported questions.
                </p>
                <p className="method-copy">
                  A two-source news rule is a screening condition, not proof of independent
                  reporting. Losses can exceed a planned stop due to gaps and execution conditions.
                </p>
              </section>
            </div>
          </>
        )}
        {board && page === 'paper' && (
          <>
            <div className="page-title">
              <div>
                <span className="eyebrow">PAPER PLAN / 04</span>
                <h1>Draft trade register</h1>
                <p>A review queue with no broker submission or assumed fill.</p>
              </div>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">ORDER CONTROL</span>
                  <h2>Drafts in this server session</h2>
                </div>
                <span className="subtle">Reference close is not a limit price</span>
              </div>
              {board.paper_orders.length === 0 ? (
                <div className="empty-copy">
                  No paper plans have been recorded. Open a security file with an add or reduce
                  review to create a draft.
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Ticker</th>
                        <th>Side</th>
                        <th className="numeric">Shares</th>
                        <th className="numeric">Reference close</th>
                        <th>Price date</th>
                        <th>Model status</th>
                        <th>Order status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.paper_orders.map((order: PaperOrder) => (
                        <tr key={order.id}>
                          <td>#{String(order.id).padStart(3, '0')}</td>
                          <td>
                            <strong>{order.symbol}</strong>
                          </td>
                          <td>{order.side}</td>
                          <td className="numeric">{order.quantity}</td>
                          <td className="numeric">{usd(order.reference_close, 2)}</td>
                          <td>{order.price_date}</td>
                          <td>{order.matches_model ? 'Current' : 'Changed · re-review'}</td>
                          <td>
                            <span className="status-tag neutral">DRAFT</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="execution-box">
                <strong>Mandatory pre-execution checks</strong>
                <ol>
                  <li>Verify source documents and the account's objectives.</li>
                  <li>Refresh price data, positions, and all constraints.</li>
                  <li>Choose a limit price, order expiry, and session.</li>
                  <li>Review fees, taxes, liquidity, and possible slippage.</li>
                </ol>
              </div>
            </section>
          </>
        )}
        <footer className="site-footer">
          <span>TradeBo · US equity research prototype</span>
          <span>
            Research output is conditional and does not constitute a broker order or personalized
            investment advice.
          </span>
        </footer>
      </main>
      {editing && draft && (
        <ModelEditor
          draft={draft}
          onDraft={setDraft}
          onClose={() => setEditing(false)}
          onSave={() => void saveEditor()}
          error={editorError || error}
          busy={busy}
        />
      )}
    </div>
  )
}

export default App

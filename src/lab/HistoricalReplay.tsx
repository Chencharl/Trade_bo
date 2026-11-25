import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EPISODES,
  HISTORY_ARCHIVE,
  HISTORY_HASH,
  HISTORY_SOURCE,
  readHistory,
  replayEpisode,
} from './crises'
import type { EpisodeId } from './crises'
import { DEFAULT_LAB_CONFIG, STRATEGIES } from './engine'
import type { MonthlyRow } from './engine'
import './historical.css'

const pct = (v: number) => (100 * v).toFixed(2) + '%'
const gap = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2)
const label = (date: string) => dateFormat.format(new Date(date + '-01T12:00:00Z'))
type Loaded = { rows: MonthlyRow[] } | { error: string } | null

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
function replayLink(episode: EpisodeId, rule: string, cost: number, month?: string) {
  const params = new URLSearchParams({ rule, cost: String(cost) })
  if (month) params.set('month', month)
  return '#lab-history-' + episode + '?' + params
}

export default function HistoricalReplay({ route }: { route: string }) {
  const episode: EpisodeId = route.startsWith('#lab-history-2008') ? '2008' : '2020'
  const event = EPISODES[episode]
  const params = new URLSearchParams(route.split('?')[1])
  const strategy =
    STRATEGIES.find((item) => item.id === params.get('rule')) ??
    STRATEGIES.find((item) => item.id === DEFAULT_LAB_CONFIG.selectedStrategy)!
  const rule = strategy.id
  const feeParam = Number(params.get('cost') ?? 10)
  const cost = Number.isInteger(feeParam) && feeParam >= 0 && feeParam <= 100 ? feeParam : 10
  const monthParam = params.get('month') ?? ''
  const date =
    /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) &&
    monthParam >= event.start &&
    monthParam <= event.end
      ? monthParam
      : event.initial
  function selectMonth(month: string) {
    window.location.replace(replayLink(episode, rule, cost, month))
  }
  const detail = useRef<HTMLElement>(null)
  const [data, setData] = useState<Loaded>(null)
  const [attempt, setAttempt] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    const generation = ++request.current
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    setData(null)
    async function load() {
      try {
        const response = await fetch(HISTORY_ARCHIVE, {
          signal: controller.signal,
          credentials: 'omit',
        })
        if (!response.ok) throw new Error('Archive unavailable.')
        const bytes = new Uint8Array(await response.arrayBuffer())
        const rows = await readHistory(bytes, 'snapshot.csv')
        if (request.current === generation) setData({ rows })
      } catch (e) {
        if (request.current === generation)
          setData({ error: e instanceof Error ? e.message : 'Could not read the archive.' })
      } finally {
        window.clearTimeout(timeout)
      }
    }
    void load()
    return () => {
      request.current++
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [attempt])
  async function open(file: File) {
    const generation = ++request.current
    setData(null)
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a file under 2 MiB.')
      const rows = await readHistory(new Uint8Array(await file.arrayBuffer()), file.name)
      if (generation === request.current) setData({ rows })
    } catch (e) {
      if (generation === request.current)
        setData({ error: e instanceof Error ? e.message : 'Could not read this file.' })
    }
  }
  const rows = data && 'rows' in data ? data.rows : null
  const entries = useMemo(
    () => (rows ? replayEpisode(rows, episode, rule, cost) : []),
    [rows, episode, rule, cost],
  )
  const active = entries.find((item) => item.date === date)
  const cut = active?.latestCut
  const name = strategy.name
  const timing =
    cut &&
    (cut.date < event.onset
      ? 'before the reference decline'
      : cut.date === event.onset
        ? 'entering the first decline month'
        : 'after the decline began')
  return (
    <main className="crisis-main">
      <a href="#lab" className="crisis-back">
        ← Strategy Lab
      </a>
      <header>
        <h1>Historical replays</h1>
        <p>US equity market and Treasury bills · Kenneth French Data Library</p>
      </header>
      <nav aria-label="Historical episodes">
        {(Object.keys(EPISODES) as EpisodeId[]).map((id) => (
          <a
            key={id}
            href={replayLink(id, rule, cost)}
            aria-current={id === episode ? 'page' : undefined}
          >
            {id} · {EPISODES[id].name}
          </a>
        ))}
      </nav>
      <div className="crisis-controls">
        <label>
          Strategy{' '}
          <select
            value={rule}
            onChange={(e) =>
              window.location.replace(replayLink(episode, e.target.value, cost, date))
            }
          >
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          One-way fee{' '}
          <select
            value={cost}
            onChange={(e) =>
              window.location.replace(replayLink(episode, rule, Number(e.target.value), date))
            }
          >
            {[...new Set([0, 5, 10, 25, 50, 100, cost])]
              .sort((a, b) => a - b)
              .map((v) => (
                <option key={v} value={v}>
                  {v} bp
                </option>
              ))}
          </select>
        </label>
      </div>
      {!data && <p role="status">Loading and verifying the historical snapshot…</p>}
      {data && 'error' in data && (
        <div className="crisis-failure">
          <p role="alert">{data.error}</p>
          <button onClick={() => setAttempt((v) => v + 1)}>Retry archive</button>{' '}
          <label>
            Open archived CSV or ZIP{' '}
            <input
              type="file"
              accept=".csv,.zip"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void open(file)
              }}
            />
          </label>{' '}
          <a href={HISTORY_ARCHIVE}>Get archived CSV</a>
        </div>
      )}
      {active && (
        <div className="crisis-workbench">
          <section className="crisis-months" aria-label="Replay months">
            <h2>{event.name}</h2>
            <p>
              Market return by month · reference decline from <strong>{label(event.onset)}</strong>
            </p>
            <div className="crisis-calendar">
              {entries.map((m) => (
                <button
                  key={m.date}
                  aria-label={
                    label(m.date) +
                    ' market ' +
                    pct(m.marketReturn) +
                    (m.action === 'Held' ? '' : ', ' + m.action + ' equity target') +
                    ', fee ' +
                    m.costBp.toFixed(2) +
                    ' bp'
                  }
                  aria-pressed={m.date === active.date}
                  onClick={() => {
                    selectMonth(m.date)
                    if (window.matchMedia('(max-width: 800px)').matches)
                      detail.current?.scrollIntoView({ block: 'start' })
                  }}
                >
                  <span>{label(m.date)}</span>
                  <b className={m.marketReturn < 0 ? 'crisis-loss' : ''}>{pct(m.marketReturn)}</b>
                  <small>
                    {m.action === 'Reduced' ? '↓ Cut' : m.action === 'Raised' ? '↑ Add' : ''}
                    {m.costBp > 0 && (
                      <>
                        {m.action === 'Held' ? '' : ' · '}
                        {Number(m.costBp.toFixed(2)) || '<0.01'} bp
                      </>
                    )}
                  </small>
                </button>
              ))}
            </div>
          </section>
          <section ref={detail} className="crisis-detail" aria-label="Selected month evidence">
            <div className="crisis-month-picker">
              <label>
                Inspect month{' '}
                <select value={active.date} onChange={(e) => selectMonth(e.target.value)}>
                  {entries.map((m) => (
                    <option key={m.date} value={m.date}>
                      {label(m.date)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div aria-live="polite">
              <h2>
                {label(active.date)} <span>· {name}</span>
              </h2>
              <p>
                <strong>{active.action} equity target</strong> · {pct(active.priorTarget)} →{' '}
                {pct(active.target)} at month opening. Signal history through{' '}
                {label(active.signalThrough)}.
              </p>
              <p>
                {cut ? (
                  <>
                    Latest target cut · <strong>{label(cut.date)}</strong>, {timing}.
                  </>
                ) : (
                  'No target cut observed in the replay or its two-year holdings history.'
                )}
              </p>
              <dl>
                {[
                  ['Strategy net return', pct(active.strategyReturn)],
                  ['Market net return', pct(active.marketReturn)],
                  ['Monthly difference', gap(active.returnGap * 100) + ' pp'],
                  ['Opening equity before trade', pct(active.driftedWeight)],
                  ['Amount traded / opening wealth', pct(active.turnover)],
                  ['Strategy fee this month', active.costBp.toFixed(2) + ' bp'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <h3>From $100 at the start of {label(event.start)}</h3>
              <p>
                Through {label(active.date)}: strategy <b>${active.strategyValue.toFixed(2)}</b> ·
                market <b>${active.marketValue.toFixed(2)}</b> · difference{' '}
                <b>{gap(active.wealthGap)} USD</b>.
              </p>
              <p>
                Strategy fees paid: ${active.fee.toFixed(3)} this month and $
                {active.totalFees.toFixed(3)} since the start.
              </p>
            </div>
          </section>
        </div>
      )}
      <details>
        <summary>Rule, source and accounting</summary>
        <p>
          <strong>{name}</strong> · {strategy.rule}
        </p>
        <p>
          The September 2026 French snapshot uses CRSP US value-weighted monthly market returns
          (Mkt−RF + RF) and the monthly RF cash return. The strategy and Market carry holdings for
          two years before the displayed window. Fees apply to actual turnover, including
          rebalancing from drift. A target cut compares consecutive target weights.
        </p>
        <p>
          The reference months are fixed retrospective study anchors. “Entering” means allocated
          using the preceding completed month. The monthly data cannot establish intramonth
          execution or the original publication date. Positive return differences mean the strategy
          earned more, including when both lost money.
        </p>
        <p>
          <a href={HISTORY_SOURCE}>French series definitions</a> ·{' '}
          <a href={HISTORY_ARCHIVE}>Versioned CSV mirror</a>
        </p>
        <p>
          Verified monthly data SHA-256 <code>{HISTORY_HASH}</code>
        </p>
      </details>
    </main>
  )
}

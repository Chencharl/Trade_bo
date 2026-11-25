import { useEffect, useState } from 'react'
import type { CutMode, FullStudy } from './fullHistory'
import { HISTORY_HASH, HISTORY_SOURCE } from './crises'
import { STRATEGIES, type StrategyId } from './engine'
import './historical.css'
import './full-history.css'

const studyUrl = './research/full-history.json'
const methods = 'https://github.com/Chencharl/Trade_bo/blob/main/docs/STRATEGY_FULL_HISTORY.md'
const usd = (v: number, digits = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
  }).format(v)
function pp(n: number | null) {
  if (n === null) return '—'
  if (Math.abs(n) < 1e-12) return '0.00 pp'
  if (Math.abs(n) < 0.00005) return n < 0 ? '−<0.01 pp' : '+<0.01 pp'
  return (n > 0 ? '+' : '') + (100 * n).toFixed(2) + ' pp'
}
const pct = (n: number | null) => (n === null ? '—' : (n * 100).toFixed(2) + '%')
const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const month = (s: string | null) => (s ? dateFormat.format(new Date(s + '-01T12:00:00Z')) : '—')

export default function FullHistoryStudy() {
  const [report, setReport] = useState<FullStudy | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<CutMode>('half')
  const [returns, setReturns] = useState(false)
  const [id, setId] = useState<StrategyId>('trend')
  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    async function load() {
      const response = await fetch(studyUrl, { signal: controller.signal })
      if (!response.ok) throw new Error('Study unavailable')
      const data = await response.json()
      if (
        data.version !== 'history-events-1' ||
        data.dataSha256 !== HISTORY_HASH ||
        data.rules?.length !== 8
      )
        throw new Error('Study version mismatch')
      if (!controller.signal.aborted) setReport(data)
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setError(true)
    })
    return () => controller.abort()
  }, [attempt])
  const rule = report?.rules.find((r) => r.id === id)
  const score = rule?.[mode]
  return (
    <main className="crisis-main history-study">
      <a href="#lab" className="crisis-back">
        ← Strategy Lab
      </a>
      <header>
        <h1>Full-history study</h1>
        <p>US equity and Treasury bills · Kenneth French Data Library</p>
      </header>
      {!report &&
        (error ? (
          <p role="alert">
            The published study could not be loaded.{' '}
            <button onClick={() => setAttempt((a) => a + 1)}>Retry</button>
          </p>
        ) : (
          <p role="status">Opening study…</p>
        ))}
      {report && rule && score && (
        <>
          <p className="history-period">
            <strong>
              {month(report.start)} – {month(report.sourceEnd)}
            </strong>
            <span>{report.months.toLocaleString('en-US')} invested months</span>
            <span>{report.episodes.length} distinct declines ≥15%</span>
            <span>{report.feeBp} bp one way</span>
          </p>
          <section aria-label="Eight-strategy comparison">
            <div className="history-tools">
              <div className="history-switch" role="group" aria-label="Comparison measure">
                <button aria-pressed={!returns} onClick={() => setReturns(false)}>
                  Warning timing
                </button>
                <button aria-pressed={returns} onClick={() => setReturns(true)}>
                  Returns after fees
                </button>
              </div>
              {!returns && (
                <label>
                  Count cuts to{' '}
                  <select value={mode} onChange={(e) => setMode(e.target.value as CutMode)}>
                    <option value="half">50% equity or less</option>
                    <option value="partial">Below 100% equity</option>
                  </select>
                </label>
              )}
            </div>
            <p className="history-caption">
              {returns
                ? 'Same dates, initial $100 and one-way fee for every rule. Rebound gap is the mean monthly net difference from Market after a trough through recovery.'
                : 'Early means a fresh cut 1–6 months before the first loss month, still in force at onset. At onset means zero full months of lead.'}
            </p>
            <div
              className="history-scroll"
              role="region"
              aria-label="Scroll strategy comparison"
              tabIndex={0}
            >
              <table
                aria-label={returns ? 'Full-history performance' : 'Full-history warning counts'}
              >
                <thead>
                  <tr>
                    <th scope="col">Strategy</th>
                    {(returns
                      ? [
                          'Net CAGR',
                          'vs Market',
                          'End $100',
                          'Fee drag¹',
                          'Max drawdown',
                          'Rebound gap / mo.',
                        ]
                      : [
                          'Early',
                          'At onset',
                          'Missed by onset',
                          'False alarms',
                          'Median lead',
                          'Net CAGR vs Market',
                        ]
                    ).map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rules.map((r) => (
                    <tr key={r.id} className={r.id === id ? 'history-selected' : ''}>
                      <th scope="row">
                        <button aria-pressed={r.id === id} onClick={() => setId(r.id)}>
                          {r.name}
                        </button>
                      </th>
                      {(returns
                        ? [
                            pct(r.cagr),
                            pp(r.cagrGap),
                            usd(r.endWealth),
                            (100 * r.feeDrag).toFixed(3) + ' pp',
                            pct(r.maxDrawdown),
                            pp(r.reboundGap),
                          ]
                        : [
                            r[mode].early,
                            r[mode].atOnset,
                            r[mode].missed,
                            r[mode].falseAlarms.length,
                            r[mode].medianLead === null ? '—' : r[mode].medianLead + ' mo.',
                            pp(r.cagrGap),
                          ]
                      ).map((v, i) => (
                        <td key={i}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="history-caption">
              {returns
                ? '¹ Fee drag is the reduction in annualized return from charging trading costs. Full-period wealth includes rebound gains and losses.'
                : 'Misses include later reactions and positions already defensive. A false alarm is a scored cut without a matched onset, including a cut during an existing decline. A dash means no observed lead.'}
            </p>
          </section>
          <section aria-label="Strategy evidence" className="history-evidence">
            <h2>{rule.name}</h2>
            <p>{STRATEGIES.find((s) => s.id === id)?.summary}</p>
            {id === 'reversal' && (
              <p>
                <a href="#lab-reversal-filters">Inspect false alarms and rolling filter tests →</a>
              </p>
            )}
            <div className="history-readout">
              <div>
                <span>Matched / scored warnings</span>
                <b>
                  {score.precision === null
                    ? '—'
                    : score.early +
                      score.atOnset +
                      ' / ' +
                      (score.early + score.atOnset + score.falseAlarms.length)}
                </b>
              </div>
              <div>
                <span>Ending value per $100</span>
                <b>{usd(rule.endWealth)}</b>
              </div>
              <div>
                <span>Net CAGR vs Market</span>
                <b>{pp(rule.cagrGap)}</b>
              </div>
              <div>
                <span>Rebound gap / month</span>
                <b>{pp(rule.reboundGap)}</b>
              </div>
            </div>
            <p className="history-caption">
              {usd(rule.feesPaid, 2)} in fees over the life of the initial $100 ·{' '}
              {pct(rule.averageEquity)} average equity exposure · {rule.reboundMonths} rebound
              months.
            </p>
            <p className="history-caption">
              At the {mode === 'half' ? '50%' : 'below-full-equity'} threshold,{' '}
              {score.matches.filter((m) => m.status === 'After onset').length} declines had a cut
              after onset by the 15% breach and{' '}
              {score.matches.filter((m) => m.status === 'Already defensive').length} began with an
              older defensive position.
            </p>
            <div
              className="history-scroll"
              role="region"
              aria-label="Scroll decline evidence"
              tabIndex={0}
            >
              <table aria-label="Distinct decline evidence">
                <thead>
                  <tr>
                    {[
                      'Onset',
                      'First −15%',
                      'Trough',
                      'Recovery',
                      'Depth',
                      'Cut timing',
                      'Cut month',
                      'Lead',
                      'Rebound gap²',
                    ].map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.episodes.map((e, i) => {
                    const m = score.matches[i]
                    return (
                      <tr key={e.onset}>
                        <th scope="row">{month(e.onset)}</th>
                        <td>{month(e.breach)}</td>
                        <td>{month(e.trough)}</td>
                        <td>{month(e.recovery)}</td>
                        <td>{pct(e.depth)}</td>
                        <td>{m.status}</td>
                        <td>{month(m.cut)}</td>
                        <td>{m.lead === null ? '—' : m.lead + ' mo.'}</td>
                        <td>{pp(rule.rebounds[i])}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="history-caption">
              ² Compounded net return difference from the month after the trough through recovery.
              An open recovery ends at the last observation.
            </p>
            <details>
              <summary>
                False alarm dates ({score.falseAlarms.length}) and unscored cuts (
                {score.unscored.length})
              </summary>
              <p>
                <strong>False alarms</strong> · {score.falseAlarms.map(month).join(' · ') || 'None'}
              </p>
              <p>
                <strong>Unscored</strong> · {score.unscored.map(month).join(' · ') || 'None'}
              </p>
            </details>
          </section>
          <details>
            <summary>Data and scoring rules</summary>
            <p>
              {report.observations.toLocaleString('en-US')} monthly observations from{' '}
              {month(report.sourceStart)} through {month(report.sourceEnd)}. The first 13 months
              supply signal history. These revised monthly data model opening allocations from
              completed months.
            </p>
            <p>
              One episode runs from the first month below a high until that high is recovered, if
              the market falls at least 15%. Additional falls before recovery belong to the same
              episode. Each cut can match one onset. Fixed allocations never generate a fresh cut.
              Median lead uses early hits only. Unresolved or incomplete follow-up can leave a cut
              unscored.
            </p>
            {report.unresolved && (
              <p>
                At the data boundary, the drawdown starting {month(report.unresolved)} had yet to
                qualify or recover.
              </p>
            )}
            <a href={HISTORY_SOURCE}>Original series definitions</a> ·{' '}
            <a href={methods}>Reproduce the study</a>
          </details>
          <p className="history-download">
            <a href={studyUrl} download="tradebo-full-history.json">
              Download study JSON
            </a>
          </p>
        </>
      )}
    </main>
  )
}

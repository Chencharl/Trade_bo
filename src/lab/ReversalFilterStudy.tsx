import { useEffect, useState, type ReactNode } from 'react'
import type { ReversalStudy } from './reversalFilters'
import { HISTORY_HASH, HISTORY_SOURCE } from './crises'
import './historical.css'
import './full-history.css'

const file = './research/reversal-filters.json'
const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const month = (s: string) => dateFormat.format(new Date(s + '-01T12:00:00Z'))
const percent = (v: number | null) => (v === null ? '—' : (v * 100).toFixed(2) + '%')
const gap = (v: number | null) =>
  v === null ? '—' : (v > 0 ? '+' : '') + (100 * v).toFixed(2) + ' pp'
const dollars = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
type Alarm = ReversalStudy['alarms'][number]
const volBand = (a: Alarm) => (a.vol < 0.1 ? 'Under 10%' : a.vol < 0.2 ? '10–<20%' : '20% or more')
const decide = (v: boolean) => (v ? 'Kept cut' : 'Vetoed')
function Table({
  title,
  columns,
  children,
}: {
  title: string
  columns: string[]
  children: ReactNode
}) {
  return (
    <div className="history-scroll" aria-label={'Scroll ' + title} role="region" tabIndex={0}>
      <table aria-label={title}>
        <thead>
          <tr>
            {columns.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Findings({ r }: { r: ReversalStudy }) {
  const [panel, setPanel] = useState('Warnings')
  const [alarmDate, setAlarmDate] = useState('')
  const [foldIndex, setFoldIndex] = useState(0)
  const allFalse = r.alarms.filter((a) => a.outcome === 'False alarm'),
    early = r.alarms.filter((a) => a.outcome === 'Early')
  const alarm = allFalse.find((a) => a.date === alarmDate) ?? allFalse[0]
  const original = r.rules.find((x) => x.id === 'original')!
  const fold = r.folds[foldIndex]
  const columns =
    panel === 'Warnings'
      ? [
          'Portfolio',
          'False alarms',
          'Removed vs original',
          'Early',
          'At onset',
          'Missed',
          'Unscored',
          'Precision',
          'Equity exposure',
        ]
      : panel === 'Net returns'
        ? [
            'Portfolio',
            'Net CAGR',
            'vs original',
            'vs Market',
            'End $100',
            'Max drawdown',
            'Fee drag / year',
            'Fees paid',
          ]
        : [
            'Portfolio',
            'Rebound gap vs original / mo.',
            'Rebound gap vs Market / mo.',
            'Net CAGR vs original',
            'Net CAGR vs Market',
          ]
  return (
    <>
      <p className="history-period">
        <strong>
          {month(r.start)} – {month(r.sourceEnd)}
        </strong>
        <span>{r.folds.length} rolling test folds</span>
        <span>{r.months.toLocaleString('en-US')} test months</span>
        <span>{r.feeBp} bp one way</span>
      </p>
      <section aria-label="Walk-forward results">
        <h2>Rolling out-of-sample results</h2>
        <p className="history-caption">
          Each test year uses the preceding 10 years for calibration. A rejected sale leaves the
          portfolio invested until the original rule buys again. Positions carry across folds.
        </p>
        <div className="history-switch" role="group" aria-label="Filter comparison">
          {['Warnings', 'Net returns', 'Rebounds'].map((p) => (
            <button key={p} onClick={() => setPanel(p)} aria-pressed={p === panel}>
              {p}
            </button>
          ))}
        </div>
        <Table title={'Filter study ' + panel} columns={columns}>
          {r.rules.map((rule) => (
            <tr key={rule.id}>
              <th scope="row">{rule.name}</th>
              {(panel === 'Warnings'
                ? [
                    rule.falseAlarms,
                    rule.id === 'market' ? '—' : original.falseAlarms - rule.falseAlarms,
                    rule.early,
                    rule.atOnset,
                    rule.missed,
                    rule.unscored,
                    percent(rule.precision),
                    percent(rule.averageEquity),
                  ]
                : panel === 'Net returns'
                  ? [
                      percent(rule.cagr),
                      gap(rule.vsOriginal),
                      gap(rule.vsMarket),
                      dollars(rule.ending),
                      percent(rule.maxDrawdown),
                      (100 * rule.feeDrag).toFixed(3) + ' pp',
                      dollars(rule.feesPaid),
                    ]
                  : [
                      gap(rule.reboundVsOriginal),
                      gap(rule.reboundVsMarket),
                      gap(rule.vsOriginal),
                      gap(rule.vsMarket),
                    ]
              ).map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          ))}
        </Table>
        <p className="history-caption">
          {panel === 'Warnings'
            ? 'Precision includes early and onset-month hits, divided by scored cuts. Early requires 1–6 full months of lead.'
            : panel === 'Net returns'
              ? 'CAGR differences are percentage points per year. Fee drag compares each portfolio with the same positions at zero fee.'
              : r.reboundMonths +
                ' test months fall after a crisis trough through recovery. The gaps are mean monthly net-return differences. These months already enter full-period wealth.'}
        </p>
      </section>
      <p>
        <a href="#lab-exposure">How much of the extra return came from higher stock exposure? →</a>
      </p>
      <section className="history-evidence">
        <h2>The original {early.length} advance cuts</h2>
        <p className="history-caption">
          {original.early} eligible out of sample. Each decision refers to the original cut month.
        </p>
        <Table
          title="Original advance cuts"
          columns={[
            'Cut month',
            'Decline onset',
            'Lead',
            'Trend filter',
            'Volatility filter',
            'Both filters',
          ]}
        >
          {early.map((a) => (
            <tr key={a.date}>
              <th scope="row">{month(a.date)}</th>
              <td>{month(a.onset!)}</td>
              <td>{a.lead} mo.</td>
              {(['trend', 'vol', 'both'] as const).map((id) => (
                <td key={id}>{a.admitted ? decide(a.admitted[id]) : 'Before testing'}</td>
              ))}
            </tr>
          ))}
        </Table>
      </section>
      <section className="history-evidence">
        <h2>Where the {allFalse.length} false alarms occurred</h2>
        <p className="history-caption">
          Full history, including {allFalse.length - original.falseAlarms} false alarms before
          testing. Conditions use data through the prior close. The fixed volatility bands describe
          the sample; the filter uses each fold’s training median.
        </p>
        <Table
          title="Signal conditions"
          columns={[
            'Prior market level',
            '12-month annualized vol.',
            'False alarms',
            'Removed vs original',
            'Early hits',
            'At onset',
          ]}
        >
          {[false, true].flatMap((weak) =>
            ['Under 10%', '10–<20%', '20% or more'].map((b) => {
              const group = r.alarms.filter((a) => a.weak === weak && volBand(a) === b)
              return (
                <tr key={String(weak) + b}>
                  <th scope="row">{weak ? 'At / below 10-month mean' : 'Above 10-month mean'}</th>
                  <td>{b}</td>
                  {['False alarm', 'Early', 'At onset'].map((out) => (
                    <td key={out}>{group.filter((a) => a.outcome === out).length}</td>
                  ))}
                </tr>
              )
            }),
          )}
        </Table>
        <p className="history-caption">
          At the previous close, {allFalse.filter((a) => a.drawdown < 0.05).length} false alarms
          were less than 5% below the market high,{' '}
          {allFalse.filter((a) => a.drawdown >= 0.05 && a.drawdown < 0.15).length} were 5–&lt;15%
          below it, and {allFalse.filter((a) => a.drawdown >= 0.15).length} were already at least
          15% below it.
        </p>
        {alarm && (
          <details>
            <summary>Inspect an original false alarm</summary>
            <p>
              <label>
                Cut month{' '}
                <select value={alarm.date} onChange={(e) => setAlarmDate(e.target.value)}>
                  {allFalse.map((a) => (
                    <option key={a.date} value={a.date}>
                      {month(a.date)}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <p>
              Through {month(alarm.through)} · trailing three-month return{' '}
              {percent(alarm.trailingReturn)} · {percent(alarm.drawdown)} below the market high ·{' '}
              {alarm.weak ? 'at or below' : 'above'} the ten-month mean.
            </p>
            <p>
              Trailing volatility {percent(alarm.vol)}.{' '}
              {alarm.admitted
                ? 'Fold cutoff ' +
                  percent(alarm.cutoff) +
                  '. Trend: ' +
                  decide(alarm.admitted.trend) +
                  '. Volatility: ' +
                  decide(alarm.admitted.vol) +
                  '. Both: ' +
                  decide(alarm.admitted.both) +
                  '.'
                : 'This cut predates out-of-sample testing.'}
            </p>
          </details>
        )}
      </section>
      <details>
        <summary>Inspect a rolling fold</summary>
        <p>
          <label>
            Test period{' '}
            <select value={foldIndex} onChange={(e) => setFoldIndex(Number(e.target.value))}>
              {r.folds.map((f, i) => (
                <option key={f.start} value={i}>
                  {month(f.start)} – {month(f.end)}
                </option>
              ))}
            </select>
          </label>
        </p>
        <p>
          Training openings {month(fold.trainStart)} – {month(fold.trainEnd)} · median annualized
          volatility {percent(fold.cutoff)}.
        </p>
        <Table title="Fold net returns" columns={['Portfolio', 'Net return in fold']}>
          {r.rules.map((rule) => (
            <tr key={rule.id}>
              <th scope="row">{rule.name}</th>
              <td>{percent(fold.returns[rule.id])}</td>
            </tr>
          ))}
        </Table>
      </details>
      <details>
        <summary>Filter and event definitions</summary>
        <p>
          The original reversal holds equities after a negative three-month market return and
          otherwise holds cash. At each new cut, Trend requires a close at or below the ten-month
          mean. Volatility requires the prior twelve-month annualized sample volatility to exceed
          the fold’s training median. Both requires the two conditions together.
        </p>
        <p>
          One decline spans the first month below a high through recovery if the gross market
          eventually loses 15%. A fresh cut must remain in place at onset to score. A false alarm
          has no matched onset under the six-month rule, including cuts during an ongoing decline.
          Incomplete follow-up is unscored. This revised US monthly history had already been
          inspected.
        </p>
        <p>
          <a href={HISTORY_SOURCE}>French series definitions</a> ·{' '}
          <a href="https://github.com/Chencharl/Trade_bo/blob/main/docs/STRATEGY_REVERSAL_FILTERS.md">
            Protocol and independent checks
          </a>
        </p>
      </details>
      <p className="history-download">
        <a href={file} download="tradebo-reversal-filters.json">
          Download results and cut ledger
        </a>
      </p>
    </>
  )
}

export default function ReversalFilterStudy() {
  const [report, setReport] = useState<ReversalStudy | null>(null),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    async function load() {
      const response = await fetch(file, { signal: controller.signal })
      if (!response.ok) throw new Error('Study unavailable')
      const data = await response.json()
      if (
        data.version !== 'reversal-filters-1' ||
        data.dataSha256 !== HISTORY_HASH ||
        data.rules?.length !== 5
      )
        throw new Error('Study version mismatch')
      if (!controller.signal.aborted) setReport(data)
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setError(true)
    })
    return () => controller.abort()
  }, [attempt])
  return (
    <main className="crisis-main history-study">
      <nav aria-label="Reversal study navigation">
        <a href="#lab">← Strategy Lab</a>
        <a href="#lab-full-history">Full-history study</a>
      </nav>
      <header>
        <h1>Reversal filter study</h1>
        <p>Short-term reversal · US equity and Treasury bills</p>
      </header>
      {report ? (
        <Findings r={report} />
      ) : error ? (
        <p role="alert">
          The study could not be loaded.{' '}
          <button onClick={() => setAttempt((a) => a + 1)}>Retry</button>
        </p>
      ) : (
        <p role="status">Opening study…</p>
      )}
    </main>
  )
}

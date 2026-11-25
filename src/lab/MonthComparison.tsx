import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { LedgerRow, StrategyId, StrategyResult } from './engine'

type Props = {
  current: StrategyResult
  reference: StrategyResult
  choices: StrategyResult[]
  onReference: (id: StrategyId) => void
  onExport?: () => void
}
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateLabel = (date: string) => months[Number(date.slice(5)) - 1] + ' ' + date.slice(0, 4)
const metrics = [
  { key: 'drawdown', label: 'End-of-month drawdown', scale: 100, unit: '%', deltaUnit: 'pp' },
  {
    key: 'costFraction',
    label: 'Trading cost / opening NAV',
    scale: 10000,
    unit: 'bp',
    deltaUnit: 'bp',
  },
  { key: 'targetWeight', label: 'Opening market exposure', scale: 100, unit: '%', deltaUnit: 'pp' },
  { key: 'turnover', label: 'Turnover', scale: 100, unit: '%', deltaUnit: 'pp' },
  { key: 'netReturn', label: 'Net monthly return', scale: 100, unit: '%', deltaUnit: 'pp' },
] as const
// All marks and rankings use the same 0.01 pp / bp display precision.
const rounded = (n: number) => Number(n.toFixed(2)) || 0
const signed = (n: number) => (n > 0 ? '+' : '') + n.toFixed(2)
function largest(values: number[]) {
  return values.reduce((best, v, i) => (Math.abs(v) > Math.abs(values[best]) ? i : best), 0)
}
function Mark({ value, maximum }: { value: number; maximum: number }) {
  const direction = value > 0 ? 'higher' : value < 0 ? 'lower' : 'same'
  return (
    <span aria-hidden="true" className={'month-mark ' + direction}>
      <span>{value > 0 ? '+' : value < 0 ? '−' : '·'}</span>
      {value !== 0 && <i style={{ width: (77 * Math.abs(value)) / maximum + '%' }} />}
    </span>
  )
}
export default function MonthComparison({
  current,
  reference,
  choices,
  onReference,
  onExport,
}: Props) {
  const comparisons = current.ledger.map((row, i) => {
    const base = reference.ledger[i]
    if (row.date !== base.date) throw new Error('Comparison ledgers have different dates.')
    return {
      row,
      base,
      dd: rounded((row.drawdown - base.drawdown) * 100),
      fee: rounded((row.costFraction - base.costFraction) * 10000),
    }
  })
  const peakDD = largest(comparisons.map((m) => m.dd)),
    peakFee = largest(comparisons.map((m) => m.fee))
  const maxDD = Math.abs(comparisons[peakDD].dd),
    maxFee = Math.abs(comparisons[peakFee].fee)
  const pair = current.id + '/' + reference.id
  const [pick, setPick] = useState<{ pair: string; index: number } | null>(null)
  const index = pick?.pair === pair ? pick.index : maxDD ? peakDD : peakFee
  const active = comparisons[index]
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const strip = viewport.current
    const cell = buttons.current[index]
    if (!strip || !cell || strip.scrollWidth <= strip.clientWidth) return
    const rect = strip.getBoundingClientRect()
    const target = cell.getBoundingClientRect()
    const labels = strip.querySelector('.month-year')?.clientWidth || 0
    if (target.left < rect.left + labels) strip.scrollLeft += target.left - rect.left - labels - 4
    else if (target.right > rect.right) strip.scrollLeft += target.right - rect.right + 4
  }, [index, pair])
  function choose(i: number, focus = false) {
    setPick({ pair, index: i })
    if (focus) buttons.current[i]?.focus()
  }
  function move(event: KeyboardEvent<HTMLButtonElement>, i: number) {
    const keys: Record<string, number> = {
      ArrowLeft: i - 1,
      ArrowRight: i + 1,
      ArrowDown: i + 12,
      ArrowUp: i - 12,
      Home: 0,
      End: comparisons.length - 1,
    }
    if (!(event.key in keys)) return
    event.preventDefault()
    choose(Math.max(0, Math.min(comparisons.length - 1, keys[event.key])), true)
  }
  const years = [...new Set(comparisons.map((m) => m.row.date.slice(0, 4)))]
  return (
    <section className="month-view" aria-label="Monthly strategy comparison">
      <div className="month-title">
        <h2>Monthly differences</h2>
        <span>
          {comparisons[0].row.date} — {comparisons.at(-1)!.row.date}
        </span>
      </div>
      <div className="month-pair">
        <strong>{current.name}</strong>
        <label>
          compared with{' '}
          <select
            aria-label="Comparison strategy"
            value={reference.id}
            onChange={(e) => onReference(e.target.value as StrategyId)}
          >
            {choices
              .filter((c) => c.id !== current.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="month-peaks">
        {[
          { label: 'Largest drawdown gap', i: peakDD, delta: comparisons[peakDD].dd, unit: 'pp' },
          { label: 'Largest cost gap', i: peakFee, delta: comparisons[peakFee].fee, unit: 'bp' },
        ].map((k) => (
          <button key={k.label} type="button" disabled={k.delta === 0} onClick={() => choose(k.i)}>
            <span>{k.label}</span>
            <strong>{k.delta ? dateLabel(comparisons[k.i].row.date) : 'No difference'}</strong>
            {k.delta !== 0 && (
              <b>
                {signed(k.delta)} {k.unit}
              </b>
            )}
          </button>
        ))}
      </div>
      <div className="month-key">
        <span className="mk-lower">− Lower</span>
        <span className="mk-higher">+ Higher</span>
        <span>· Same to 2 decimals</span>
      </div>
      <div
        className="month-scroll"
        ref={viewport}
        role="group"
        aria-label="Select a month for its values"
      >
        <div className="month-matrix">
          <span />
          {months.map((m) => (
            <span className="month-name" key={m}>
              {m}
            </span>
          ))}
        </div>
        {years.map((y) => (
          <div className="month-matrix" key={y}>
            <div className="month-year">
              <b>{y}</b>
              <span>DD</span>
              <span>Fee</span>
            </div>
            {months.map((m, mi) => {
              const date = y + '-' + String(mi + 1).padStart(2, '0')
              const i = comparisons.findIndex((item) => item.row.date === date)
              if (i < 0) return <span className="month-blank" key={m} />
              const item = comparisons[i]
              const label =
                dateLabel(date) +
                ', drawdown ' +
                signed(item.dd) +
                ' pp, cost ' +
                signed(item.fee) +
                ' bp'
              return (
                <button
                  key={m}
                  ref={(el) => {
                    buttons.current[i] = el
                  }}
                  tabIndex={i === index ? 0 : -1}
                  aria-label={label}
                  title={label}
                  aria-pressed={i === index}
                  onKeyDown={(e) => move(e, i)}
                  onClick={() => choose(i)}
                >
                  <Mark value={item.dd} maximum={maxDD} />
                  <Mark value={item.fee} maximum={maxFee} />
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <p className="month-caption">
        The upper bar shows drawdown and the lower bar shows cost. Each uses its own scale.
      </p>
      <div className="month-detail" aria-live="polite" aria-atomic="true">
        <div className="month-detail-header">
          <h3>{dateLabel(active.row.date)}</h3>
          <button type="button" onClick={onExport} disabled={!onExport}>
            Download 60 months (CSV)
          </button>
        </div>
        <table aria-label="Values for selected month">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">{reference.name}</th>
              <th scope="col">{current.name}</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const amount = (row: LedgerRow) => row[metric.key] * metric.scale
              return (
                <tr key={metric.key}>
                  <th scope="row">{metric.label}</th>
                  <td>
                    {amount(active.base).toFixed(2)} {metric.unit}
                  </td>
                  <td>
                    {amount(active.row).toFixed(2)} {metric.unit}
                  </td>
                  <td>
                    {signed(
                      rounded((active.row[metric.key] - active.base[metric.key]) * metric.scale),
                    )}{' '}
                    {metric.deltaUnit}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

import { useEffect, useId, useState } from 'react'
import type { Config, Simulation } from './engine'

export const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
export const compact = (value: number) =>
  value >= 1000000 ? `$${(value / 1000000).toFixed(1)}m` : `$${Math.round(value / 1000)}k`
export const percent = (value: number, signed = false) =>
  `${signed && value > 0 ? '+' : ''}${value.toFixed(1)}%`

export function PossibilityField({
  result,
  comparison,
  config,
  busy,
}: {
  result: Simulation
  comparison: Simulation | null
  config: Config
  busy: boolean
}) {
  const uid = useId().replace(/:/g, '')
  const [inspected, setInspected] = useState<number | null>(null)
  const [compactView, setCompactView] = useState(
    () => window.matchMedia('(max-width: 850px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 850px)')
    const resize = () => setCompactView(query.matches)
    query.addEventListener('change', resize)
    return () => query.removeEventListener('change', resize)
  }, [])
  const viewWidth = compactView ? 500 : 880
  const left = compactView ? 48 : 62
  const right = compactView ? 385 : 748
  const width = right - left
  const bands = result.bands
  const months = bands.length - 1
  const top =
    Math.max(...bands.map((b) => b.p90), ...(comparison?.bands.map((b) => b.p90) || [])) * 1.14
  const bottom = Math.max(
    0,
    Math.min(...bands.map((b) => b.p10), ...(comparison?.bands.map((b) => b.p10) || [])) * 0.68,
  )
  const x = (month: number) => left + (month / months) * width
  const y = (value: number) => 315 - ((value - bottom) / (top - bottom)) * 265
  const path = (values: number[]) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = (low: 'p10' | 'p25', high: 'p90' | 'p75') =>
    `${path(bands.map((b) => b[high]))} ${[...bands]
      .reverse()
      .map((b) => `L${x(b.month).toFixed(2)},${y(b[low]).toFixed(2)}`)
      .join(' ')} Z`
  const index = Math.min(inspected ?? months, months)
  const point = bands[index]
  const last = bands[months]
  const inspect = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    setInspected(
      Math.max(
        0,
        Math.min(
          months,
          Math.round(
            ((((event.clientX - bounds.left) / bounds.width) * viewWidth - left) / width) * months,
          ),
        ),
      ),
    )
  }
  return (
    <section className="atlas-field" aria-label="Simulated portfolio paths" aria-busy={busy}>
      <div className="field-heading">
        <div>
          <span className="atlas-kicker">THE POSSIBILITY FIELD</span>
          <h2>One portfolio. Many futures.</h2>
        </div>
        <span className={`field-status ${busy ? 'working' : ''}`}>
          <i />
          {busy ? 'Simulating…' : '1,000 simulated paths'}
        </span>
      </div>
      <div className="field-legend">
        <span>
          <i className="legend-band" />
          10th–90th percentile
        </span>
        <span>
          <i className="legend-line" />
          Median
        </span>
        {comparison && (
          <span>
            <i className="legend-compare" />
            Pinned median
          </span>
        )}
        <span className="field-nominal">NOMINAL USD</span>
      </div>
      <svg
        className="field-svg"
        viewBox={`0 0 ${viewWidth} 360`}
        role="img"
        aria-labelledby={`${uid}-title ${uid}-desc`}
        onPointerMove={inspect}
        onPointerLeave={() => setInspected(null)}
      >
        <title id={`${uid}-title`}>Simulated portfolio value over {config.years} years</title>
        <desc id={`${uid}-desc`}>
          Median ending value {money(result.median)}. The 10th to 90th percentile range is{' '}
          {money(result.p10)} to {money(result.p90)}. The chart displays 48 example paths from 1,000
          simulations. These are hypothetical outcomes.
        </desc>
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6e91ff" stopOpacity=".35" />
            <stop offset="100%" stopColor="#6e91ff" stopOpacity=".04" />
          </linearGradient>
          <clipPath id={`${uid}-clip`}>
            <rect x={left} y="36" width={width} height="280" />
          </clipPath>
        </defs>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = bottom + ((top - bottom) * tick) / 4
          return (
            <g key={tick}>
              <line x1={left} y1={y(value)} x2={right} y2={y(value)} className="field-grid" />
              <text x={left - 13} y={y(value) + 4} textAnchor="end" className="field-tick">
                {compact(value)}
              </text>
            </g>
          )
        })}
        {[0, 1, 2, 3, 4, 5].map((tick) => {
          const year = (config.years * tick) / 5
          return (
            <g key={tick}>
              <line
                x1={x((months * tick) / 5)}
                x2={x((months * tick) / 5)}
                y1="36"
                y2="315"
                className="field-grid vertical"
              />
              <text x={x((months * tick) / 5)} y="344" textAnchor="middle" className="field-tick">
                {tick === 0 ? 'Today' : `${Number(year.toFixed(1))}y`}
              </text>
            </g>
          )
        })}
        <g clipPath={`url(#${uid}-clip)`}>
          <path d={area('p10', 'p90')} fill={`url(#${uid}-fill)`} />
          <path d={area('p25', 'p75')} fill="#668cff" opacity=".12" />
          {result.paths.map((values, i) => (
            <path key={i} d={path(values)} className="field-path" />
          ))}
          <line
            x1={left}
            x2={right}
            y1={y(config.capital)}
            y2={y(config.capital)}
            className="field-start"
          />
          {comparison && (
            <path d={path(comparison.bands.map((b) => b.p50))} className="field-comparison" />
          )}
          <path d={path(bands.map((b) => b.p90))} className="field-boundary" />
          <path d={path(bands.map((b) => b.p10))} className="field-boundary" />
          <path d={path(bands.map((b) => b.p50))} className="field-median" />
        </g>
        {config.scenario !== 'baseline' && config.intensity > 0 && (
          <g>
            <line x1={x(6)} x2={x(6)} y1="36" y2="315" className="field-shock" />
            <text x={x(6) + 8} y="27" className="field-shock-label">
              SHOCK / MONTH 6
            </text>
          </g>
        )}
        {(last.p90 - last.p10 < top * 0.015
          ? ([['p50', 'All percentiles']] as const)
          : ([
              ['p90', '90th'],
              ['p50', 'Median'],
              ['p10', '10th'],
            ] as const)
        ).map(([key, label]) => (
          <g key={key} className={key === 'p50' ? 'field-end median' : 'field-end'}>
            <circle cx={right} cy={y(last[key])} r={key === 'p50' ? 4 : 2.5} />
            <text x={right + 20} y={y(last[key]) - 5}>
              {money(last[key])}
            </text>
            <text x={right + 20} y={y(last[key]) + 11} className="field-end-label">
              {label}
            </text>
          </g>
        ))}
        {inspected !== null && (
          <g>
            <line
              x1={x(index)}
              x2={x(index)}
              y1="36"
              y2="315"
              stroke="#b7c7e8"
              strokeDasharray="3 5"
            />
            <circle cx={x(index)} cy={y(point.p50)} r="5" fill="#fff" />
          </g>
        )}
      </svg>
      <div className="field-scrubber">
        <label htmlFor="inspect-month">
          Explore a month <span>{index === 0 ? 'Today' : `Month ${index}`}</span>
        </label>
        <input
          id="inspect-month"
          type="range"
          min="0"
          max={months}
          value={index}
          onChange={(event) => setInspected(Number(event.target.value))}
        />
      </div>
      <div className="field-readout" aria-live="off">
        <span>
          10th <b>{money(point.p10)}</b>
        </span>
        <span>
          Median <b>{money(point.p50)}</b>
        </span>
        <span>
          90th <b>{money(point.p90)}</b>
        </span>
        <span className="field-readout-note">48 sample paths shown · not a forecast</span>
      </div>
    </section>
  )
}

export function Distribution({ result, capital }: { result: Simulation; capital: number }) {
  const low = Math.floor(result.terminal[0] / 1000) * 1000
  const high = Math.max(low + 1000, result.terminal.at(-1)!)
  const bins = Array.from({ length: 30 }, () => 0)
  result.terminal.forEach(
    (value) =>
      bins[Math.min(bins.length - 1, Math.floor(((value - low) / (high - low)) * bins.length))]++,
  )
  const maxCount = Math.max(...bins)
  const marker = 18 + Math.max(0, Math.min(1, (capital - low) / (high - low))) * 384
  return (
    <svg
      className="distribution-svg"
      viewBox="0 0 420 150"
      role="img"
      aria-label={`Distribution of all 1,000 ending values. ${(result.lossFrequency * 100).toFixed(1)} percent finished below the starting balance.`}
    >
      <line x1="18" x2="402" y1="119" y2="119" stroke="#dce2ee" />
      {bins.map((count, index) => (
        <rect
          key={index}
          x={18 + index * 12.8}
          y={119 - (count / maxCount) * 88}
          width="10.5"
          height={(count / maxCount) * 88}
          rx="2"
          fill={
            low + ((index + 0.5) / bins.length) * (high - low) < capital ? '#d18b83' : '#738be3'
          }
        >
          <title>{count} paths in this value interval</title>
        </rect>
      ))}
      {capital >= low && capital <= high && (
        <g>
          <line x1={marker} x2={marker} y1="17" y2="121" stroke="#33496c" strokeDasharray="3 3" />
          <text x={marker + 5} y="15" className="distribution-label">
            Starting value
          </text>
        </g>
      )}
      <text x="18" y="141" className="distribution-label">
        {compact(low)}
      </text>
      <text x="402" y="141" textAnchor="end" className="distribution-label">
        {compact(high)}
      </text>
    </svg>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  keys,
  names,
  cash,
  money,
  signedMoney,
  pct,
  signedPercent,
  type CashStudy,
  type Mark,
  type Values,
  type Text,
  type Rule,
  type SpyReport,
  type Spell,
} from './spyDaily'

export default function SpyEquityChart({
  r,
  study,
  baseline,
  selected,
  choose,
  t,
}: {
  r: SpyReport
  study: CashStudy
  baseline: Rule
  selected: Spell
  choose: (s: Spell) => void
  t: Text
}) {
  const [loss, setLoss] = useState(false)
  const [year, setYear] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(650)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Keep an explicitly zoomed chart on the newly selected exit, even when picked below the chart.
  const [prior, setPrior] = useState(selected)
  if (prior !== selected) {
    setPrior(selected)
    setHover(null)
    if (year && selected.exit.slice(0, 4) !== year) setYear(selected.exit.slice(0, 4))
  }
  const marks = useMemo(() => {
    const peaks: Values = {
      model: r.capital,
      original: r.capital,
      trend: r.capital,
      market: r.capital,
    }
    return study.daily.map(([date, model, original, trend, market]) => {
      const wealth = { model, original, trend, market },
        loss = {} as Values
      for (const k of keys) {
        peaks[k] = Math.max(peaks[k], wealth[k])
        loss[k] = 1 - wealth[k] / peaks[k]
      }
      return { date, wealth, loss }
    })
  }, [study, r.capital])
  const points = year ? marks.filter((p) => p.date.startsWith(year)) : marks
  const last = points.length - 1,
    dates = points.map((p) => p.date),
    years = [...new Set(marks.map((p) => p.date.slice(0, 4)))]
  const valueAt = (p: Mark, k: Rule) => (loss ? -p.loss[k] : p.wealth[k])
  const values = points.flatMap((p) => [valueAt(p, 'model'), valueAt(p, baseline)])
  const min = Math.min(...values),
    max = loss ? 0 : Math.max(...values)
  const stepBase = loss
    ? 0.025
    : Math.max(100, 10 ** Math.floor(Math.log10(Math.max(1, max - min) / 3)))
  const step = Math.max(stepBase, Math.ceil((max - min) / 4 / stepBase) * stepBase)
  const low = Math.floor(min / step) * step,
    high = Math.max(low + step, Math.ceil(max / step) * step)
  const a = loss ? 44 : 50,
    b = width - 16,
    top = 12,
    bottom = 174
  const x = (idx: number) => a + ((b - a) * idx) / last
  const y = (val: number) => bottom - ((bottom - top) * (val - low)) / (high - low)
  const path = (k: Rule) =>
    points
      .map((p, j) => (j ? 'L' : 'M') + x(j).toFixed(1) + ',' + y(valueAt(p, k)).toFixed(1))
      .join(' ')
  const labels = names(t),
    tickDates = dates.flatMap((d, j) => {
      if (j === 0) return [j]
      if (!year) return d.slice(0, 4) !== dates[j - 1].slice(0, 4) ? [j] : []
      return d.slice(0, 7) !== dates[j - 1].slice(0, 7) &&
        (Number(d.slice(5, 7)) - 1) % (width < 440 ? 3 : 2) === 0
        ? [j]
        : []
    })
  const cursorIndex = dates.indexOf(hover ?? selected.exit)
  const i = cursorIndex >= 0 ? cursorIndex : last
  const chosenIndex = dates.indexOf(selected.exit)
  const endIndex = selected.reentry ? dates.indexOf(selected.reentry) : last
  const spells = [...study.spells.model, ...study.spells.trend].sort((l, r) =>
    l.exit.localeCompare(r.exit),
  )
  const visible = spells.flatMap((s) => {
    const index = dates.indexOf(s.exit)
    return index < 0 ? [] : [{ s, index }]
  })
  // Keep neighboring exits independently selectable, including consecutive trading days.
  const barWidth = (b - a) / visible.length
  const pins = visible.map((v, j) => ({ ...v, pos: a + (j + 0.5) * barWidth }))
  const selectedBar = pins.find((p) => p.s === selected)?.pos
  const height = 322,
    barTop = 226,
    zero = 282,
    barBottom = 305
  const largest = Math.max(...pins.map((p) => p.s.endingEffect), 1)
  const scale = Math.min(
    (zero - barTop) / largest,
    (barBottom - zero) / Math.max(1, ...pins.map((p) => -p.s.endingEffect)),
  )
  const isTrend = (s: Spell) => study.spells.trend.includes(s)
  const selectYear = (yr: string) => {
    setYear(yr)
    setHover(null)
    if (yr && !selected.exit.startsWith(yr)) {
      const first = spells.find((s) => s.exit.startsWith(yr))
      if (first) choose(first)
    }
  }
  return (
    <section className="spy-chart" aria-label={t('Portfolio chart', '组合走势图')}>
      <div className="spy-chart-title">
        <h2>
          {loss ? t('Loss from peak', '距前高跌幅') : t('Growth of $10,000', '一万美元的走势')}
        </h2>
        <div className="spy-switch">
          <button aria-pressed={!loss} onClick={() => setLoss(false)}>
            {t('Value', '净值')}
          </button>
          <button aria-pressed={loss} onClick={() => setLoss(true)}>
            {t('Drawdown', '回撤')}
          </button>
        </div>
      </div>
      <div className="spy-legend">
        <span>
          <i />
          {labels.model}
        </span>
        <span>
          <i />
          {labels[baseline]}
        </span>
        <select
          aria-label={t('Chart period', '图表年份')}
          value={year}
          onChange={(e) => selectYear(e.target.value)}
        >
          <option value="">{t('All years', '全部年份')}</option>
          {years.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>
      <div className="spy-plot cash-plot" ref={frame}>
        <svg
          role="img"
          aria-label={t(
            'Daily closing portfolio paths, with the selected cash period shaded',
            '每日收盘净值，阴影标出所选空仓时段',
          )}
          viewBox={'0 0 ' + width + ' ' + height}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            if (((e.clientY - rect.top) * height) / rect.height > bottom) return
            const j = Math.max(
              0,
              Math.min(
                last,
                Math.round(((((e.clientX - rect.left) * width) / rect.width - a) / (b - a)) * last),
              ),
            )
            setHover(dates[j])
          }}
          onPointerLeave={() => setHover(null)}
        >
          {chosenIndex >= 0 && (
            <rect
              x={x(chosenIndex) - 2}
              y={top}
              width={Math.max(4, x(endIndex < 0 ? last : endIndex) - x(chosenIndex) + 2)}
              height={bottom - top}
              fill="#d6e3f6"
            />
          )}
          {Array.from({ length: Math.round((high - low) / step) + 1 }, (_, k) => {
            const z = low + step * k
            return (
              <g key={k}>
                <line x1={a} x2={b} y1={y(z)} y2={y(z)} className="spy-grid" />
                <text x={a - 6} y={y(z) + 4} textAnchor="end">
                  {loss ? +(100 * z).toFixed(1) + '%' : '$' + +(z / 1000).toFixed(2) + 'k'}
                </text>
              </g>
            )
          })}
          {tickDates
            .filter((_, idx) => width >= 400 || year || idx % 2 === 0)
            .map((j) => (
              <text key={j} x={x(j)} y="191" textAnchor={j ? 'middle' : 'start'}>
                {year
                  ? new Intl.DateTimeFormat(t('en-US', 'zh-CN'), {
                      month: 'short',
                      timeZone: 'UTC',
                    }).format(new Date(dates[j] + 'T00:00:00Z'))
                  : dates[j].slice(0, 4)}
              </text>
            ))}
          <path d={path(baseline)} className="spy-reference" />
          <path d={path('model')} className="spy-line" />
          {pins
            .filter(({ s }) => !isTrend(s) || baseline === 'trend')
            .map(({ s, index }) => (
              <circle
                className="cash-dot"
                key={s.exit + isTrend(s)}
                cx={x(index)}
                cy={y(
                  valueAt(points[index], isTrend(s) && baseline === 'trend' ? 'trend' : 'model'),
                )}
                r={s === selected ? 4 : 2.4}
                fill={s === selected ? '#1f3f67' : 'white'}
                stroke="#436792"
                onClick={() => {
                  choose(s)
                  setHover(null)
                }}
              >
                <title>{s.exit + ' · ' + signedMoney(s.endingEffect)}</title>
              </circle>
            ))}
          <line
            pointerEvents="none"
            x1={x(i)}
            x2={x(i)}
            y1={top}
            y2={bottom}
            className="spy-cursor"
          />
          <circle
            pointerEvents="none"
            cx={x(i)}
            cy={y(valueAt(points[i], baseline))}
            r="3"
            fill="#63788d"
          />
          <circle
            pointerEvents="none"
            cx={x(i)}
            cy={y(valueAt(points[i], 'model'))}
            r="3"
            fill="#4263cc"
          />
          <text x={width < 400 ? 4 : a} y={214} className="cash-axis-title">
            {t('Cash exits in order · effect on balance', '依次减仓对期末净值的贡献')}
          </text>
          <line x1={a} x2={b} y1={zero} y2={zero} stroke="#95a7b9" />
          <text x={a - 5} y={zero + 4} textAnchor="end">
            $0
          </text>
          {pins.map(({ s, pos }) => {
            const tip = zero - s.endingEffect * scale
            const w = Math.min(12, barWidth * 0.7)
            return (
              <rect
                key={s.exit + isTrend(s)}
                x={pos - w / 2}
                y={Math.min(tip, zero)}
                width={w}
                height={Math.max(0.8, Math.abs(tip - zero))}
                fill={s.endingEffect >= 0 ? '#227a68' : '#a34f32'}
              />
            )
          })}
          {selectedBar !== undefined && (
            <g>
              <circle
                cx={selectedBar}
                cy={zero - selected.endingEffect * scale}
                r={3.5}
                fill="#1f3f67"
              />
              <text
                className="cash-axis-value"
                x={selectedBar + (selectedBar > width - 100 ? -7 : 7)}
                y={Math.max(
                  barTop + 5,
                  Math.min(barBottom - 2, zero - selected.endingEffect * scale - 6),
                )}
                textAnchor={selectedBar > width - 100 ? 'end' : 'start'}
              >
                {signedMoney(selected.endingEffect)}
              </text>
            </g>
          )}
          {pins
            .filter(
              (p, j) =>
                !j ||
                (!year && p.s.exit.slice(0, 4) !== pins[j - 1].s.exit.slice(0, 4)) ||
                (year && j === pins.length - 1),
            )
            .map(({ s, pos }, j) => (
              <text
                key={s.exit}
                x={pos}
                y={319}
                textAnchor={j ? (year ? 'end' : 'middle') : 'start'}
              >
                {year ? s.exit.slice(5) : s.exit.slice(0, 4)}
              </text>
            ))}
        </svg>
        {pins.map(({ s, pos }, index) => (
          <button
            type="button"
            key={s.exit + isTrend(s)}
            className="cash-hit"
            tabIndex={s === selected ? 0 : -1}
            onKeyDown={(e) => {
              const next = {
                ArrowLeft: index - 1,
                ArrowRight: index + 1,
                Home: 0,
                End: pins.length - 1,
              }[e.key]
              if (next === undefined) return
              e.preventDefault()
              const j = Math.max(0, Math.min(pins.length - 1, next))
              choose(pins[j].s)
              frame.current?.querySelectorAll<HTMLButtonElement>('.cash-hit')[j]?.focus()
            }}
            style={{
              left: pos - barWidth / 2,
              width: barWidth,
              top: barTop,
              height: barBottom - barTop,
            }}
            aria-label={
              (isTrend(s) ? labels.trend : labels.model) +
              ' ' +
              s.exit +
              ' ' +
              signedMoney(s.endingEffect)
            }
            aria-pressed={s === selected}
            title={
              s.exit +
              ' · ' +
              signedMoney(s.endingEffect) +
              ' · ' +
              t('declines avoided', '避跌') +
              ' ' +
              pct(s.avoided) +
              ' · ' +
              t('gains missed', '错过上涨') +
              ' ' +
              pct(s.missed) +
              ' · ' +
              t('costs', '成本') +
              ' ' +
              money(
                s[isTrend(s) ? 'trend' : 'model'].commission +
                  s[isTrend(s) ? 'trend' : 'model'].slippage,
              )
            }
            onClick={() => {
              setHover(null)
              choose(s)
            }}
          />
        ))}
      </div>
      <p className="cash-mobile-readout">
        <b>{selected.exit}</b> · {t('avoided', '避跌')} {pct(selected.avoided)} ·{' '}
        {t('missed', '错过上涨')} {pct(selected.missed)} · {t('cost', '成本')}{' '}
        {money(
          selected[isTrend(selected) ? 'trend' : 'model'].commission +
            selected[isTrend(selected) ? 'trend' : 'model'].slippage,
        )}
        <br />
        {names(t).model} {signedPercent(selected.model.net)} · {names(t).trend}{' '}
        {signedPercent(selected.trend.net)}
      </p>
      <p className="cash-key">
        {t(
          'Each bar is one exit. Select a bar to see the decline avoided, the gains missed and what the trend filter did.',
          '每根柱代表一次减仓。点选可查看避开的下跌、错过的上涨，以及趋势过滤同期的表现。',
        )}
      </p>
      <label className="spy-inspect">
        <span>{t('Inspect close', '查看收盘值')}</span>
        <input
          type="range"
          min={0}
          max={last}
          value={i}
          aria-valuetext={points[i].date}
          onChange={(e) => setHover(dates[Number(e.target.value)])}
        />
      </label>
      <div className="spy-readout">
        <b>{points[i].date}</b>
        {(['model', baseline] as const).map((k) => (
          <span key={k}>
            {labels[k]}{' '}
            <strong>{loss ? pct(valueAt(points[i], k)) : cash(valueAt(points[i], k))}</strong>
          </span>
        ))}
      </div>
    </section>
  )
}

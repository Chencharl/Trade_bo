import { useEffect, useRef, useState } from 'react'
import LabHeader from './LabHeader'
import { HISTORY_HASH } from './crises'
import './lab.css'
import './month-view.css'
import './historical.css'
import './full-history.css'
import type { ExposureId, ExposureStudy } from './exposureStudy'
import './exposure.css'

type Language = 'en' | 'zh'
type Text = (en: string, zh: string) => string
const file = './research/exposure-controls.json'
const source =
  'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_factors.html'
const method = 'https://github.com/Chencharl/Trade_bo/blob/main/docs/STRATEGY_EXPOSURE.md'
const portfolios: ExposureId[] = ['trend', 'trendMix', 'original', 'originalMix', 'market']
const percent = (v: number) => (v * 100).toFixed(2) + '%'
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(2)
function names(t: Text): Record<ExposureId, string> {
  return {
    trend: t('Trend-filtered reversal', '趋势过滤反转'),
    trendMix: t('Trend fixed mix', '趋势策略固定配置'),
    original: t('Original reversal', '原始短期反转'),
    originalMix: t('Original fixed mix', '原策略固定配置'),
    market: t('Buy and hold', '一直持有市场'),
  }
}
const monthNumber = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5)) - 1
const money = (v: number) =>
  '$' +
  v.toLocaleString('en-US', {
    minimumFractionDigits: v < 1000 ? 2 : 0,
    maximumFractionDigits: v < 1000 ? 2 : 0,
  })
function HistoryChart({ r, t }: { r: ExposureStudy; t: Text }) {
  const [pair, setPair] = useState<'trend' | 'original'>('trend')
  const [mode, setMode] = useState<'loss' | 'wealth'>('loss')
  const [period, setPeriod] = useState('2008')
  const [cursor, setCursor] = useState<number | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(880)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(225, entry.contentRect.width)),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const points = r.chart.filter(
    (p) =>
      period === 'all' ||
      (period === '2008'
        ? p.date >= '2007-09' && p.date <= '2009-12'
        : p.date >= '2019-12' && p.date <= '2021-12'),
  )
  const index = cursor === null ? points.length - 1 : Math.min(cursor, points.length - 1)
  const stock = points[index].averageStock
  const mix = pair === 'trend' ? 'trendMix' : 'originalMix'
  const labels = names(t)
  const value = (id: ExposureId, i: number) =>
    mode === 'loss'
      ? -100 * points[i].drawdowns[id]
      : (100 * points[i].values[id]) / points[0].values[id]
  const values = points.flatMap((_, i) => [value(pair, i), value(mix, i)])
  const log = mode === 'wealth' && period === 'all'
  const scale = log ? Math.log10 : (v: number) => v
  let ticks: number[]
  if (mode === 'loss') {
    const step = Math.max(2, Math.ceil(-Math.min(...values) / 20) * 5)
    ticks = Array.from(
      { length: Math.max(2, Math.ceil(-Math.min(...values) / step) + 1) },
      (_, i) => -i * step,
    )
  } else if (log) {
    const lo = Math.floor(Math.log10(Math.min(...values))),
      hi = Math.ceil(Math.log10(Math.max(...values)))
    ticks = Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i))
  } else {
    const lo = Math.min(...values),
      hi = Math.max(...values),
      step = Math.max(1, Math.ceil((hi - lo) / 20) * 5)
    const bottom = Math.floor(lo / step) * step
    ticks = Array.from(
      { length: Math.max(2, Math.ceil((hi - bottom) / step) + 1) },
      (_, i) => bottom + i * step,
    )
  }
  const low = scale(Math.min(...ticks)),
    high = scale(Math.max(...ticks))
  const left = mode === 'loss' ? 47 : 56,
    right = width - 12,
    top = 12,
    bottom = 186
  const time = points.map((p) => monthNumber(p.date))
  const x = (i: number) => left + ((right - left) * (time[i] - time[0])) / (time.at(-1)! - time[0])
  const y = (v: number) => bottom - ((bottom - top) * (scale(v) - low)) / (high - low || 1)
  const path = (id: ExposureId) =>
    points
      .map((_, i) => (i ? 'L' : 'M') + x(i).toFixed(2) + ',' + y(value(id, i)).toFixed(2))
      .join(' ')
  const read = (v: number) => (mode === 'wealth' ? money(v) : v.toFixed(2) + '%')
  const tickCount = width < 520 ? 3 : 5
  const xTicks = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i * (points.length - 1)) / (tickCount - 1)),
  )
  return (
    <section className="xp-chart" aria-labelledby="xp-chart-title">
      <div className="xp-chart-top">
        <h2 id="xp-chart-title">{t('Strategy vs fixed allocation', '策略与固定配置的走势')}</h2>
        <label>
          {t('Compare', '比较')}{' '}
          <select
            aria-label={t('Compare', '比较')}
            value={pair}
            onChange={(e) => setPair(e.target.value as typeof pair)}
          >
            <option value="trend">{labels.trend}</option>
            <option value="original">{labels.original}</option>
          </select>
        </label>
      </div>
      <div className="xp-chart-controls">
        <div className="xp-switch" role="group" aria-label={t('Chart measure', '图表指标')}>
          <button aria-pressed={mode === 'loss'} onClick={() => setMode('loss')}>
            {t('Loss from peak', '距高点跌幅')}
          </button>
          <button aria-pressed={mode === 'wealth'} onClick={() => setMode('wealth')}>
            {t('Growth of $100', '100 美元净值')}
          </button>
        </div>
        <div className="xp-period" role="group" aria-label={t('Chart period', '图表时段')}>
          {['all', '2008', '2020'].map((p) => (
            <button
              key={p}
              aria-pressed={p === period}
              onClick={() => {
                setPeriod(p)
                setCursor(null)
              }}
            >
              {p === 'all' ? t('All years', '全部') : p}
            </button>
          ))}
        </div>
      </div>
      <p className="xp-chart-note">
        {mode === 'loss'
          ? t(
              '0% marks a portfolio high. Deeper dips mean larger losses.',
              '0% 表示组合处于高点。曲线越低，表示从高点跌得越多。',
            )
          : log
            ? t(
                'Both start at $100. Equal vertical steps show tenfold growth.',
                '两者均从 100 美元开始。纵轴每格表示净值增至十倍。',
              )
            : t(
                'Both start at $100 at the first date shown.',
                '两者在图示起点的净值均设为 100 美元。',
              )}
      </p>
      <div className="xp-plot" ref={frame}>
        <svg
          role="img"
          aria-label={t('Quarter-end portfolio comparison', '季度末组合比较')}
          viewBox={'0 0 ' + width + ' 214'}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect(),
              at = ((e.clientX - rect.left) * width) / rect.width
            let best = 0
            for (let i = 1; i < points.length; i++)
              if (Math.abs(x(i) - at) < Math.abs(x(best) - at)) best = i
            setCursor(best)
          }}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={right} y1={y(v)} y2={y(v)} className="xp-grid" />
              <text x={left - 8} y={y(v) + 4} textAnchor="end">
                {mode === 'loss'
                  ? v + '%'
                  : v >= 1e6
                    ? '$' + v / 1e6 + 'm'
                    : v >= 1000
                      ? '$' + v / 1000 + 'k'
                      : '$' + v}
              </text>
            </g>
          ))}
          {xTicks.map((i, j) => (
            <text
              key={i}
              y="208"
              x={x(i)}
              textAnchor={j === 0 ? 'start' : j === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {period === 'all' ? points[i].date.slice(0, 4) : points[i].date}
            </text>
          ))}
          <path d={path(mix)} className="xp-mix-line" />
          <path d={path(pair)} className="xp-rule-line" />
          <line x1={x(index)} x2={x(index)} y1={top} y2={bottom} className="xp-cursor" />
          <circle cx={x(index)} cy={y(value(mix, index))} r="3.6" className="xp-mix-dot" />
          <circle cx={x(index)} cy={y(value(pair, index))} r="3" className="xp-rule-dot" />
        </svg>
      </div>
      <div className="xp-readout">
        <b>{points[index].date}</b>
        <span>
          <i />
          {labels[pair]} <strong>{read(value(pair, index))}</strong>
        </span>
        <span>
          <i />
          {labels[mix]} <strong>{read(value(mix, index))}</strong>
        </span>
      </div>
      {stock && (
        <p className="xp-holdings">
          {t('Average stock allocation during this quarter', '该季度平均股票仓位')} · {labels[pair]}{' '}
          <strong>{percent(stock[pair])}</strong> · {labels[mix]}{' '}
          <strong>{percent(stock[mix])}</strong>
        </p>
      )}
      <label className="xp-slider">
        {t('Inspect a quarter', '选择季度')}
        <input
          type="range"
          aria-valuetext={points[index].date}
          min="0"
          max={points.length - 1}
          value={index}
          onChange={(e) => setCursor(Number(e.target.value))}
        />
      </label>
      <p className="xp-footnote">
        {t(
          'Plotted at quarter ends. The largest loss in the table uses every monthly close.',
          '曲线显示季度末的数值。下表的最大回撤按每个月末计算。',
        )}
      </p>
    </section>
  )
}
function Study({ r, t }: { r: ExposureStudy; t: Text }) {
  const labels = names(t),
    [fold, setFold] = useState(0),
    f = r.folds[fold]
  const unit = t('pp', '个百分点'),
    share = r.net.allocation / r.net.total
  const columns = [
    t('Average in stocks', '平均股票仓位'),
    t('Annual return after fees', '扣费后年化收益'),
    t('Largest loss from peak', '最大回撤'),
    t('Rebound gap vs market¹', '反弹月相对市场¹'),
  ]
  return (
    <>
      <div className="lab-mast">
        <h1>{t('Stock exposure & timing', '股票仓位与择时')}</h1>
        <p>
          {r.start} — {r.end} · {t('U.S. stocks and Treasury bills', '美国股票与短期国债')}
        </p>
      </div>
      <section className="xp-summary" aria-label={t('Return breakdown', '收益拆解')}>
        <p>
          {t('Trend filtering improved annual return by ', '加入趋势过滤后，年化收益提高了 ')}
          <strong>
            {(r.net.total * 100).toFixed(2)} {t('percentage points', '个百分点')}
          </strong>
          {t(' over original reversal.', '。')}
        </p>
        <dl>
          <div>
            <dt>{t('Higher stock allocation', '更高的股票仓位')}</dt>
            <dd>
              {signed(r.net.allocation)} {unit} <small>({(100 * share).toFixed(1)}%)</small>
            </dd>
          </div>
          <div>
            <dt>
              {t('Remaining difference, including timing and fees', '剩余差额，含择时与交易费')}
            </dt>
            <dd>
              {signed(r.net.residual)} {unit}
            </dd>
          </div>
        </dl>
      </section>
      <p className="xp-finding">
        {t(
          'Keeping the trend strategy’s past average stock allocation earned ',
          '按趋势策略过去的平均仓位做固定配置，年化收益为 ',
        )}
        <strong>{percent(r.metrics.trendMix.net)}</strong>
        {t(' a year. Trading its signals earned ', '；跟随信号交易为 ')}
        <strong>{percent(r.metrics.trend.net)}</strong>
        {t('.', '。')}
      </p>
      <HistoryChart r={r} t={t} />
      <section className="xp-comparison">
        <h2>{t('Full-period results', '全期回测结果')}</h2>
        <p>
          {t(
            'Each year, the fixed mixes use the stock allocation their strategy averaged over the previous ten years.',
            '每个测试年度开始前，分别取对应策略过去十年的平均股票仓位，作为该年度的固定配置。',
          )}
        </p>
        <table aria-label={t('Portfolio outcomes', '组合表现')}>
          <thead>
            <tr>
              <th scope="col">{t('Portfolio', '组合')}</th>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {portfolios.map((id) => {
              const m = r.metrics[id]
              return (
                <tr key={id}>
                  <th scope="row">{labels[id]}</th>
                  {[
                    percent(m.exposure),
                    percent(m.net),
                    '−' + percent(m.drawdown),
                    signed(m.reboundVsMarket!) + ' ' + unit,
                  ].map((v, i) => (
                    <td key={i} data-label={columns[i]}>
                      {v}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="xp-footnote">
          {t('¹ Average monthly return minus the market across ', '¹ 在 ')}
          {r.reboundMonths}
          {t(
            ' rebound months, from the month after a trough through recovery. These months already count toward annual return.',
            ' 个反弹月内，取组合与市场月收益之差的平均值。自谷底次月至收复前高，这些月份已计入年化收益。',
          )}
        </p>
      </section>
      <details className="xp-method">
        <summary>{t('How the comparison works', '查看计算方法与逐年结果')}</summary>
        <p>
          {t(
            'Original reversal holds stocks after a negative three-month market return and otherwise holds cash. The trend filter allows a new sale only when the last market close is at or below its ten-month average.',
            '原始反转策略在市场过去三个月累计下跌后持有股票，其余时间持有现金。加入趋势过滤后，只有上月末市场指数处于近十个月末均值或以下，才执行新的卖出信号。',
          )}
        </p>
        <p>
          {r.months.toLocaleString('en-US')}{' '}
          {t('out-of-sample months across ', '个样本外月份，分成 ')}
          {r.folds.length}
          {t(
            ' rolling test periods. Fixed mixes rebalance monthly to the target set for each period. Each portfolio pays 0.10% of the amount traded, including its initial purchase.',
            ' 段滚动测试。固定组合每月调回当年目标权重。所有组合买入和卖出时均按交易金额的 0.10% 扣费，包含首次建仓。',
          )}
        </p>
        <p>
          {t(
            'Against their own fixed mixes, original reversal returned ',
            '相对各自的固定配置，原始策略的年化收益差为 ',
          )}
          <b>
            {signed(r.net.originalGap)} {unit}
          </b>
          {t(' and the trend filter returned ', '，趋势过滤为 ')}
          <b>
            {signed(r.net.trendGap)} {unit}
          </b>
          {t('. The difference between these two gaps is ', '，两者相减得到 ')}
          {signed(r.net.residual)} {unit}
          {t('. Lower relative fee drag accounts for ', '。其中相对交易费拖累下降贡献 ')}
          {signed(r.feeContribution)} {unit}
          {t(
            '. The rest includes timing, compounding and the gap between past and realized stock exposure.',
            '。其余包含择时、复利，以及过去仓位与实际仓位之间的偏差。',
          )}
        </p>
        <label>
          {t('Test period', '测试区间')}{' '}
          <select
            aria-label={t('Test period', '测试区间')}
            value={fold}
            onChange={(e) => setFold(Number(e.target.value))}
          >
            {r.folds.map((p, i) => (
              <option key={p.start} value={i}>
                {p.start} — {p.end}
              </option>
            ))}
          </select>
        </label>
        <p>
          {t('Targets from ', '取均值的历史区间为 ')}
          {f.trainStart} — {f.trainEnd} · {labels.trendMix} {percent(f.trend)} ·{' '}
          {labels.originalMix} {percent(f.original)}
        </p>
        <ul className="xp-fold">
          {portfolios.map((id) => (
            <li key={id}>
              <span>{labels[id]}</span>
              <strong>{signed(f.returns[id])}%</strong>
            </li>
          ))}
        </ul>
        <p className="xp-footnote">
          {t(
            'Returns above cover the selected test period after fees. The last period has two months.',
            '以上为所选测试区间的扣费后收益。最后一期只有两个月。',
          )}
        </p>
        <div className="xp-links">
          <a href={method}>{t('Research protocol', '研究方案')} ↗</a>
          <a href={source}>{t('Market data source', '市场数据来源')} ↗</a>
          <a href={file} download>
            {t('Download results (JSON)', '下载结果（JSON）')} ↓
          </a>
        </div>
      </details>
    </>
  )
}
export default function ExposureStudyPage() {
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('tradebo-study-language')
      if (saved === 'zh' || saved === 'en') return saved
    } catch {
      /* Storage is optional. */
    }
    return navigator.language.startsWith('zh') ? 'zh' : 'en'
  })
  const t: Text = (en, zh) => (lang === 'zh' ? zh : en)
  const [r, setReport] = useState<ExposureStudy | null>(null),
    [error, setError] = useState(false),
    [attempt, retry] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    setError(false)
    fetch(file, { signal: c.signal })
      .then((res) => {
        if (!res.ok) throw Error()
        return res.json()
      })
      .then((d) => {
        if (
          d.version !== 'exposure-controls-1' ||
          d.dataSha256 !== HISTORY_HASH ||
          !d.chart?.length ||
          !d.folds?.length
        )
          throw Error()
        if (!c.signal.aborted) setReport(d)
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true)
      })
    return () => c.abort()
  }, [attempt])
  return (
    <div className="atlas-app lab-app" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      <LabHeader />
      <main className="lab-main xp">
        <nav className="lab-history-links xp-nav" aria-label={t('Study navigation', '研究导航')}>
          <a href="#lab">← Strategy Lab</a>
          <a href="#lab-reversal-filters">{t('Reversal filter study', '反转与误报研究')}</a>
          <button
            className="xp-language"
            onClick={() => {
              const next = lang === 'en' ? 'zh' : 'en'
              setLang(next)
              try {
                localStorage.setItem('tradebo-study-language', next)
              } catch {
                /* Storage is optional. */
              }
            }}
            lang={lang === 'en' ? 'zh-CN' : 'en'}
          >
            {lang === 'en' ? '中文' : 'English'}
          </button>
        </nav>
        {r ? (
          <Study r={r} t={t} />
        ) : error ? (
          <div role="alert">
            <p>{t('Couldn’t load the study.', '研究数据载入失败。')}</p>
            <button onClick={() => retry((n) => n + 1)}>{t('Retry', '重试')}</button>
          </div>
        ) : (
          <p role="status">{t('Loading study…', '正在加载研究…')}</p>
        )}
      </main>
    </div>
  )
}

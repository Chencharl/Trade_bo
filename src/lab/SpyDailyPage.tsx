import { useState, useEffect, useRef } from 'react'
import LabHeader from './LabHeader'
import './lab.css'
import './month-view.css'
import './spy-daily.css'

const keys = ['model', 'original', 'trend', 'market'] as const
type Rule = (typeof keys)[number]
type Values = Record<Rule, number>
type Metric = {
  ending: number
  total: number
  cagr: number
  drawdown: number
  peak: string
  trough: string
  commission: number
  slippage: number
  orders: number
  stockDays: number
}
type Trade = {
  date: string
  signal: string
  side: 'buy' | 'sell' | 'reinvest'
  open: number
  fill: number
  quantity: number
  commission: number
  slippage: number
  probability: number | null
}
type Mark = { date: string; wealth: Values; loss: Values }
export type SpyReport = {
  version: string
  start: string
  end: string
  capital: number
  sessions: number
  modelHash: string
  metrics: Record<Rule, Metric>
  chart: Mark[]
  annual: { end: string; net: Values }[]
  trades: Record<Rule, Trade[]>
  training: {
    cutoff: string
    firstSignal: string
    lastLabel: string
    examples: number
    epochs: number
  }
  development: {
    folds: { start: string; end: string; firstSignal: string; lastLabel: string; returns: Values }[]
  }
}
type Text = (en: string, zh: string) => string
const pct = (n: number) => (100 * n).toFixed(2) + '%'
const diff = (n: number) => (n < 0 ? '−' : '+') + Math.abs(100 * n).toFixed(2)
const cash = (v: number, digits = 0) =>
  '$' + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const url = './research/spy-daily.json'
const method = 'https://github.com/Chencharl/Trade_bo/blob/main/docs/STRATEGY_SPY_DAILY.md'
function names(t: Text): Record<Rule, string> {
  return {
    model: t('Neural model', '神经网络'),
    original: t('Original reversal', '原始反转'),
    trend: t('Trend filter', '趋势过滤'),
    market: t('Buy & hold SPY', '持有 SPY'),
  }
}
function Curve({ r, baseline, t }: { r: SpyReport; baseline: Rule; t: Text }) {
  const [loss, setLoss] = useState(false),
    [hover, setHover] = useState<number | null>(null)
  const frame = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(500)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const points = r.chart,
    last = points.length - 1,
    i = hover ?? last,
    labels = names(t)
  const v = (k: Rule, j: number) => (loss ? -points[j].loss[k] : points[j].wealth[k])
  const vals = points.flatMap((_, j) => [v('model', j), v(baseline, j)])
  const min = Math.min(loss ? 0 : r.capital, ...vals),
    max = Math.max(loss ? 0 : r.capital, ...vals)
  const unit = loss ? 0.05 : Math.max(100, 10 ** Math.floor(Math.log10(Math.max(1, max - min) / 3)))
  const step = Math.max(unit, Math.ceil((max - min) / 4 / unit) * unit)
  const low = Math.floor(min / step) * step,
    high = Math.max(low + step, Math.ceil(max / step) * step)
  const a = loss ? 42 : 50,
    b = width - 10,
    top = 15,
    bottom = 169
  const times = points.map((p) => Date.parse(p.date + 'T00:00:00Z'))
  const x = (j: number) => a + ((b - a) * (times[j] - times[0])) / (times[last] - times[0])
  const y = (z: number) => bottom - ((bottom - top) * (z - low)) / (high - low)
  const path = (k: Rule) =>
    points.map((_, j) => (j ? 'L' : 'M') + x(j).toFixed(2) + ',' + y(v(k, j)).toFixed(2)).join(' ')
  const yearTicks = points
    .flatMap((p, j) =>
      j === 0 || p.date.slice(0, 4) !== points[j - 1].date.slice(0, 4) ? [j] : [],
    )
    .filter((_, idx) => width > 440 || idx % 2 === 0)
  const value = (z: number) => (loss ? pct(z) : cash(z))
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
      </div>
      <div className="spy-plot" ref={frame}>
        <svg
          role="img"
          aria-label={t('Weekly closing portfolio paths', '组合每周收盘走势')}
          viewBox={'0 0 ' + width + ' 195'}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect(),
              pos = ((e.clientX - rect.left) / rect.width) * width
            let j = 0
            while (j < last && Math.abs(x(j + 1) - pos) < Math.abs(x(j) - pos)) j++
            setHover(j)
          }}
        >
          {Array.from({ length: Math.round((high - low) / step) + 1 }, (_, k) => {
            const z = low + step * k
            return (
              <g key={k}>
                <line x1={a} x2={b} y1={y(z)} y2={y(z)} className="spy-grid" />
                <text x={a - 6} y={y(z) + 4} textAnchor="end">
                  {loss ? Math.round(z * 100) + '%' : '$' + z / 1000 + 'k'}
                </text>
              </g>
            )
          })}
          {yearTicks.map((j) => (
            <text key={j} x={x(j)} y="190" textAnchor={j ? 'middle' : 'start'}>
              {points[j].date.slice(0, 4)}
            </text>
          ))}
          <path d={path(baseline)} className="spy-reference" />
          <path d={path('model')} className="spy-line" />
          <line x1={x(i)} x2={x(i)} y1={top} y2={bottom} className="spy-cursor" />
          <circle cx={x(i)} cy={y(v(baseline, i))} r="3" fill="#63788d" />
          <circle cx={x(i)} cy={y(v('model', i))} r="3" fill="#4263cc" />
        </svg>
      </div>
      <label className="spy-inspect">
        <span>{t('Inspect week', '查看周末值')}</span>
        <input
          type="range"
          min={0}
          max={last}
          value={i}
          aria-valuetext={points[i].date}
          onChange={(e) => setHover(Number(e.target.value))}
        />
      </label>
      <div className="spy-readout">
        <b>{points[i].date}</b>
        <span>
          {labels.model} <strong>{value(v('model', i))}</strong>
        </span>
        <span>
          {labels[baseline]} <strong>{value(v(baseline, i))}</strong>
        </span>
      </div>
    </section>
  )
}
function Orders({ r, t }: { r: SpyReport; t: Text }) {
  const [rule, setRule] = useState<Rule>('model'),
    [index, setIndex] = useState(0)
  const trades = r.trades[rule],
    row = trades[index],
    labels = names(t)
  const sides = {
    buy: t('Buy', '买入'),
    sell: t('Sell', '卖出'),
    reinvest: t('Reinvest cash', '现金再投资'),
  }
  return (
    <section className="spy-orders">
      <div className="spy-section-top">
        <h2>{t('From signal to fill', '从信号到成交')}</h2>
        <label>
          {t('Portfolio', '组合')}{' '}
          <select
            aria-label={t('Order portfolio', '订单组合')}
            value={rule}
            onChange={(e) => {
              setRule(e.target.value as Rule)
              setIndex(0)
            }}
          >
            {keys.map((k) => (
              <option value={k} key={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {row ? (
        <>
          <label className="spy-selector">
            {t('Order', '订单')}{' '}
            <select
              aria-label={t('Order date', '成交日期')}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
            >
              {trades.map((o, i) => (
                <option key={o.date} value={i}>
                  {o.date} · {sides[o.side]}
                </option>
              ))}
            </select>
          </label>
          <div className="spy-ticket">
            <div>
              <span>{t('Signal after close', '收盘后发出信号')}</span>
              <strong>{row.signal}</strong>
              <small>
                {row.probability === null
                  ? labels[rule]
                  : t('Model probability of a gain ', '模型估计上涨概率 ') + pct(row.probability)}
              </small>
            </div>
            <div>
              <span>{t('Next trading open', '下一交易日开盘')}</span>
              <strong>{row.date}</strong>
              <small>
                {t('Reported open ', '开盘价 ')}
                {cash(row.open, 2)}
              </small>
            </div>
            <div>
              <span>{t('Simulated fill', '模拟成交')}</span>
              <strong>
                {sides[row.side]} · {cash(row.fill, 2)}
              </strong>
              <small>
                {row.quantity.toFixed(4)} {t('shares', '股')}
              </small>
            </div>
            <div>
              <span>{t('Order costs', '本笔成本')}</span>
              <strong>{cash(row.commission + row.slippage, 2)}</strong>
              <small>
                {t('Fee ', '手续费 ')}
                {cash(row.commission, 2)} · {t('slip ', '滑点 ')}
                {cash(row.slippage, 2)}
              </small>
            </div>
          </div>
        </>
      ) : (
        <p>{t('No orders in this period.', '本期无成交。')}</p>
      )}
    </section>
  )
}
function Findings({ r, t }: { r: SpyReport; t: Text }) {
  const [baseline, setBaseline] = useState<Exclude<Rule, 'model'>>('market')
  const labels = names(t),
    m = r.metrics.model,
    b = r.metrics[baseline]
  const topReturn = keys.reduce((best, k) =>
    r.metrics[k].total > r.metrics[best].total ? k : best,
  )
  const leastLoss = keys.reduce((best, k) =>
    r.metrics[k].drawdown < r.metrics[best].drawdown ? k : best,
  )
  const cols = [
    t('Net return', '扣费后总收益'),
    t('Annualized', '年化收益'),
    t('Max loss¹', '最大回撤¹'),
    t('Fees + slippage', '手续费与滑点'),
  ]
  return (
    <>
      <section className="spy-intro">
        <div className="spy-period">
          {t('FINAL TEST', '最终测试')}{' '}
          <span>
            {r.start} — {r.end} · {t('Model frozen in 2021', '模型于 2021 年冻结')}
          </span>
        </div>
        <h2>{t('SPY at the next open', 'SPY 次日开盘回测')}</h2>
        <p>
          {t(
            'After costs, the neural model turned $10,000 into ',
            '计入手续费和滑点后，同样的 10,000 美元，神经网络期末为 ',
          )}
          <b>{cash(m.ending)}</b>
          {t('. ', '，')}
          {labels[baseline]} {t('ended at ', '为 ')}
          <b>{cash(b.ending)}</b>
          {t('.', '。')}
        </p>
      </section>
      <div className="spy-overview">
        <Curve r={r} t={t} baseline={baseline} />
        <aside className="spy-pair" aria-label={t('Model comparison', '模型对比')}>
          <label>
            {t('Compare the model with', '模型对照组')}{' '}
            <select
              aria-label={t('Comparison portfolio', '对照组合')}
              value={baseline}
              onChange={(e) => setBaseline(e.target.value as typeof baseline)}
            >
              {(['market', 'original', 'trend'] as const).map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span>{t('Model return difference', '模型总收益差')}</span>
            <strong>
              {diff(m.total - b.total)} <small>{t('pp', '个百分点')}</small>
            </strong>
            <p>
              {pct(m.total)} · {labels[baseline]} {pct(b.total)}
            </p>
          </div>
          <div>
            <span>
              {m.drawdown <= b.drawdown
                ? t('Model reduced the largest loss by', '模型最大回撤少了')
                : t('Model increased the largest loss by', '模型最大回撤多了')}
            </span>
            <strong>
              {(100 * Math.abs(m.drawdown - b.drawdown)).toFixed(2)}{' '}
              <small>{t('pp', '个百分点')}</small>
            </strong>
            <p>
              {pct(m.drawdown)} · {labels[baseline]} {pct(b.drawdown)}
            </p>
          </div>
        </aside>
      </div>
      <section className="spy-results">
        <h2>{t('Four strategies on the same dates', '同一时段的四种策略')}</h2>
        <p className="spy-leaders">
          {labels[topReturn]}
          {t(' led on net return at', '的扣费后收益最高，为')}{' '}
          <b>{pct(r.metrics[topReturn].total)}</b>
          {t('. ', '。')}
          {labels[leastLoss]}
          {t(' had the smallest drawdown at', '的最大回撤最小，为')}{' '}
          <b>{pct(r.metrics[leastLoss].drawdown)}</b>
          {t('.', '。')}
        </p>
        <div className="spy-tablebox">
          <table aria-label={t('Final holdout results', '最终留出期结果')}>
            <thead>
              <tr>
                <th>{t('Portfolio', '组合')}</th>
                {cols.map((s) => (
                  <th scope="col" key={s}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const z = r.metrics[k]
                return (
                  <tr key={k}>
                    <th scope="row">{labels[k]}</th>
                    {[
                      pct(z.total),
                      pct(z.cagr),
                      '−' + pct(z.drawdown),
                      cash(z.commission + z.slippage, 2),
                    ].map((v, i) => (
                      <td key={i} data-label={cols[i]}>
                        {v}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="spy-activity">
          {t('The neural model held SPY for ', '神经网络持有 SPY ')}
          <b>
            {m.stockDays.toLocaleString('en-US')} / {r.sessions.toLocaleString('en-US')}
          </b>
          {t(' sessions and placed ', ' 个交易日，共有 ')}
          <b>{m.orders}</b>
          {t(' orders, including dividend reinvestments.', ' 笔模拟成交，含股息再投资。')}
        </p>
        <p className="spy-note">
          {t(
            '¹ Largest loss from a previous high at daily closes. The chart samples weekly closes.',
            '¹ 最大回撤取每日收盘净值相对先前高点的最大跌幅，图中按周显示收盘值。',
          )}
        </p>
      </section>
      <Orders r={r} t={t} />
      <details className="spy-method">
        <summary>
          {t('Training, trading assumptions and yearly results', '训练、成交假设与逐年结果')}
        </summary>
        <p>
          {t(
            'A two-hidden-layer network (16 and 8 units) predicts the direction from the next open to the following open. It uses trailing returns, volatility, and the overnight and intraday moves available at the signal close. At 50% or above it holds SPY, otherwise cash.',
            '两层隐藏层（16、8 个单元）预测从下一次开盘到再下一次开盘的涨跌。输入是信号日收盘时已知的历史收益、波动率、隔夜和日内涨跌。概率达到 50% 时持有 SPY，否则持有现金。',
          )}
        </p>
        <p>
          {t(
            'Each January from 2010 to 2021 the model retrained on eight preceding years. The final model used ',
            '2010–2021 年每年一月用此前八年滚动训练。最终模型用了 ',
          )}
          {r.training.examples} {t('mature labels through ', '个已知标签，截止 ')}
          {r.training.cutoff}
          {t(
            '. Weights, scaling and threshold stayed fixed throughout the holdout.',
            '。整个留出期固定权重、标准化参数和阈值。',
          )}
        </p>
        <p>
          {t(
            'All four accounts start in cash. Commission is 1 bp of filled value and slippage is 2 bp against the order at the open. Cash earns zero. Fractional shares are allowed. Ex-date holders receive dividends, which can be reinvested from the session after the payable date. Values include unpaid receivables.',
            '四组均从现金开始。手续费按成交额 1 个基点，滑点按开盘价向不利方向 2 个基点。现金不计息，允许零股。除息前一日持有者获得分红，支付日后的交易日才可再投资。净值包含应收股息。',
          )}
        </p>
        <p>
          {t(
            'Original reversal and its trend filter keep their monthly signal schedule. Reversal holds SPY after a negative three-month return. The filter permits a new exit only below or at the ten-month average. Both execute next open. Fills use revised daily bars and modeled costs.',
            '原始反转和趋势过滤沿用月末信号。过去三个月累计下跌时，反转策略持股；趋势过滤仅在指数不高于十个月均值时允许新的卖出。两者均于下一交易日开盘执行。模拟成交使用事后日线与假设成本。',
          )}
        </p>
        <table aria-label={t('Holdout calendar returns', '留出期逐年收益')}>
          <thead>
            <tr>
              <th>{t('Through', '截至')}</th>
              {keys.map((k) => (
                <th key={k}>{labels[k]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.annual.map((a) => (
              <tr key={a.end}>
                <th>{a.end}</th>
                {keys.map((k) => (
                  <td key={k} data-label={labels[k]}>
                    {pct(a.net[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <a href={method}>{t('Protocol & reproduction', '方案与复算方法')}</a> ·{' '}
          <a href={url} download>
            {t('Download results and fills', '下载结果与成交明细')}
          </a>{' '}
          ·{' '}
          <a href="./research/spy-model.json" download>
            {t('Frozen weights and 12 training folds', '冻结权重与 12 段滚动训练')}
          </a>
        </p>
      </details>
    </>
  )
}
export default function SpyDailyPage() {
  const [zh, setZh] = useState(() => {
    try {
      const s = localStorage.getItem('tradebo-study-language')
      if (s) return s === 'zh'
    } catch {
      /* optional */
    }
    return navigator.language.startsWith('zh')
  })
  const t: Text = (en, cn) => (zh ? cn : en)
  const [r, setR] = useState<SpyReport | null>(null),
    [err, setErr] = useState(false),
    [attempt, retry] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    setErr(false)
    fetch(url, { signal: c.signal })
      .then((res) => {
        if (!res.ok) throw Error()
        return res.json()
      })
      .then((data) => {
        if (data.version !== 'spy-open-1' || !data.chart?.length || !data.metrics?.market)
          throw Error()
        if (!c.signal.aborted) setR(data)
      })
      .catch(() => {
        if (!c.signal.aborted) setErr(true)
      })
    return () => c.abort()
  }, [attempt])
  return (
    <div className="atlas-app lab-app" lang={zh ? 'zh-CN' : 'en'}>
      <LabHeader />
      <main className="lab-main spy-main">
        <div className="spy-mast">
          <h1>Strategy Lab</h1>
          <a href="#lab-workbench">{t('Monthly workbench', '月度回测工作台')} ↗</a>
          <button
            lang={zh ? 'en' : 'zh-CN'}
            onClick={() => {
              setZh(!zh)
              try {
                localStorage.setItem('tradebo-study-language', zh ? 'en' : 'zh')
              } catch {
                /* optional */
              }
            }}
          >
            {zh ? 'English' : '中文'}
          </button>
        </div>
        {r ? (
          <Findings r={r} t={t} />
        ) : err ? (
          <div role="alert">
            {t('Daily results could not load.', '日线回测载入失败。')}{' '}
            <button onClick={() => retry((a) => a + 1)}>{t('Retry', '重试')}</button>
          </div>
        ) : (
          <p role="status">{t('Loading SPY results…', '正在加载 SPY 回测…')}</p>
        )}
        <nav className="spy-library" aria-label={t('Historical studies', '历史研究')}>
          <h2>{t('Historical studies', '历史研究')}</h2>
          {[
            ['#lab-timing-test', t('Timing vs chance', '择时与随机对照')],
            ['#lab-exposure', t('Stock exposure & timing', '股票仓位与择时')],
            ['#lab-full-history', t('Full-history study', '八策略全历史')],
            ['#lab-reversal-filters', t('Reversal filter study', '反转过滤研究')],
            ['#lab-history-2008', t('2008 financial crisis', '2008 年金融危机')],
            ['#lab-history-2020', t('2020 COVID-19 sell-off', '2020 年疫情暴跌')],
          ].map(([href, name]) => (
            <a key={href} href={href}>
              {name}
            </a>
          ))}
        </nav>
      </main>
    </div>
  )
}

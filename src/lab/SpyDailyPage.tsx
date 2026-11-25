import { useState, useEffect, useRef } from 'react'
import LabHeader from './LabHeader'
import SpyEquityChart from './SpyEquityChart'
import { AttributionNotes, CashInspector } from './SpyCashSpells'
import {
  keys,
  names,
  cash,
  money,
  signedMoney,
  diff,
  pct,
  type CashStudy,
  type Rule,
  type Spell,
  type SpyReport,
  type Text,
} from './spyDaily'
import './lab.css'
import './month-view.css'
import './spy-daily.css'

const url = './research/spy-daily.json'
const method = 'https://github.com/Chencharl/Trade_bo/blob/main/docs/STRATEGY_SPY_DAILY.md'
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
function Findings({ r, study, t }: { r: SpyReport; study: CashStudy; t: Text }) {
  const [baseline, setBaseline] = useState<Exclude<Rule, 'model'>>('market')
  const es = study.spells.model
  const [selected, setSelected] = useState<Spell>(() =>
    es.reduce((best, s) => (s.endingEffect > best.endingEffect ? s : best)),
  )
  const panel = useRef<HTMLDivElement>(null)
  const kind = study.spells.trend.includes(selected) ? 'trend' : 'model'
  const choose = (s: Spell) => {
    setSelected(s)
    setBaseline('trend')
  }
  const jump = (s: Spell) => {
    choose(s)
    panel.current?.scrollIntoView({ block: 'start' })
    panel.current?.focus({ preventScroll: true })
  }
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
          {t('The model spent ', '模型合计空仓 ')}
          <b>{r.sessions - m.stockDays}</b>
          {t(' sessions in cash across ', ' 个交易日，分成 ')}
          <b>{es.length}</b>
          {t(
            ' exits. On a $10,000 account, those exits added ',
            ' 段。本金为 10,000 美元，这些减仓合计使期末净值比持有 SPY 高出 ',
          )}
          <b>{money(m.ending - r.metrics.market.ending)}</b>
          {t(' over holding SPY.', '。')}
        </p>
      </section>
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
      <div className="spy-overview" ref={panel} tabIndex={-1}>
        <SpyEquityChart
          r={r}
          study={study}
          selected={selected}
          choose={choose}
          t={t}
          baseline={baseline}
        />
        <div className="cash-detail">
          <label className="cash-picker">
            {t('Choose an exit', '选择空仓区间')}
            <select
              value={kind + selected.exit}
              onChange={(e) => {
                const opt = e.target.selectedOptions[0],
                  list = opt.dataset.rule === 'trend' ? study.spells.trend : es
                choose(list[Number(opt.dataset.index)])
              }}
            >
              {(['model', 'trend'] as const).map((k) => (
                <optgroup key={k} label={labels[k]}>
                  {study.spells[k].map((s, j) => (
                    <option key={s.exit} data-rule={k} data-index={j} value={k + s.exit}>
                      {s.exit} · {signedMoney(s.endingEffect)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <CashInspector s={selected} t={t} end={r.end} kind={kind} />
        </div>
      </div>
      <AttributionNotes a={study} r={r} t={t} select={jump} />
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
            '¹ Largest loss from a previous high at daily closes. The chart shows daily closes.',
            '¹ 最大回撤取每日收盘净值相对先前高点的最大跌幅，图中显示每日收盘值。',
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
          <a href="./research/spy-spells.json" download>
            {t('Download cash spells', '下载逐段归因')}
          </a>{' '}
          ·{' '}
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
  const [reports, setReports] = useState<[SpyReport, CashStudy] | null>(null),
    [err, setErr] = useState(false),
    [attempt, retry] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    setErr(false)
    Promise.all(
      [url, './research/spy-spells.json'].map(async (path) => {
        const res = await fetch(path, { signal: c.signal })
        if (!res.ok) throw Error()
        return res.json()
      }),
    )
      .then(([r, study]) => {
        if (
          r.version !== 'spy-open-1' ||
          !r.metrics?.market ||
          study.version !== 'spy-spells-1' ||
          study.start !== r.start ||
          study.end !== r.end ||
          study.daily?.length !== r.sessions ||
          study.rules?.join(',') !== keys.join(',') ||
          !study.spells?.model?.length ||
          !study.spells?.trend?.length
        )
          throw Error()
        if (!c.signal.aborted) setReports([r, study])
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
        {reports ? (
          <Findings r={reports[0]} study={reports[1]} t={t} />
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

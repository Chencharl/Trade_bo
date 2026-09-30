import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  FileText,
  Layers3,
  LockKeyhole,
  Radar,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react'

type Gate = { id: string; label: string; passed: boolean; detail: string }
type News = {
  title: string
  source: string
  url: string
  published_at: string
  summary: string
  sentiment: string
  relevance: number
  relevant: boolean
  age_hours: number
}
type Bar = { date: string; close: number }
type Analysis = {
  symbol: string
  name: string
  sector: string
  action: 'REVIEW_BUY' | 'REVIEW_SELL' | 'WAIT'
  reason: string
  market: {
    price: number
    change_pct: number
    sma20: number
    sma50: number
    trend_up: boolean
    trend_down: boolean
    as_of: string
    history: Bar[]
  }
  news: News[]
  gates: Gate[]
  sell_gates: Gate[]
  position_shares: number
  position_value: number
  suggested_max_shares: number
  planning_stop: number
  risk_note: string
}
type Board = {
  mode: 'demo' | 'live'
  as_of: string
  portfolio: {
    nav: number
    cash: number
    positions: Record<string, number>
    allocation: { label: string; pct: number }[]
    target: { label: string; pct: number }[]
  }
  policy: {
    max_position_pct: number
    min_cash_pct: number
    risk_per_trade_pct: number
    planning_stop_pct: number
  }
  analyses: Analysis[]
  paper_orders: {
    id: number
    symbol: string
    side: string
    quantity: number
    reference_price: number
    status: string
    mode: string
    execution_checks: string[]
  }[]
  method: string
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
const price = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n)
const decision = {
  REVIEW_BUY: { label: '买入复核', icon: ArrowUpRight, className: 'buy' },
  REVIEW_SELL: { label: '卖出复核', icon: ArrowDownRight, className: 'sell' },
  WAIT: { label: '保持观望', icon: Clock3, className: 'wait' },
}

function Chart({ history }: { history: Bar[] }) {
  const closes = history.map((x) => x.close)
  const min = Math.min(...closes) * 0.985
  const max = Math.max(...closes) * 1.015
  const x = (i: number) => 18 + (i / Math.max(1, closes.length - 1)) * 702
  const y = (n: number) => 198 - ((n - min) / (max - min || 1)) * 172
  const line = closes
    .map((n, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(n).toFixed(1)}`)
    .join(' ')
  const area = `${line} L 720 208 L 18 208 Z`
  return (
    <div className="chart-wrap" role="img" aria-label="最近 80 个交易日的收盘价折线图">
      <svg viewBox="0 0 740 226" preserveAspectRatio="none">
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#386af0" stopOpacity=".18" />
            <stop offset="1" stopColor="#386af0" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[39, 95, 151, 207].map((gy) => (
          <line key={gy} x1="18" y1={gy} x2="720" y2={gy} stroke="#e7edf7" strokeDasharray="4 6" />
        ))}
        <path d={area} fill="url(#area)" />
        <path
          d={line}
          fill="none"
          stroke="#386af0"
          strokeWidth="2.7"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={x(closes.length - 1)}
          cy={y(closes.at(-1) || 0)}
          r="5"
          fill="#386af0"
          stroke="white"
          strokeWidth="3"
        />
      </svg>
      <div className="chart-labels">
        <span>{history[0]?.date}</span>
        <span>80 个交易日 · 收盘价</span>
        <span>{history.at(-1)?.date}</span>
      </div>
    </div>
  )
}

function App() {
  const [mode, setMode] = useState<'demo' | 'live'>('demo')
  const [board, setBoard] = useState<Board | null>(null)
  const [selected, setSelected] = useState('ORBT')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [orderMessage, setOrderMessage] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [tab, setTab] = useState<'research' | 'policy' | 'orders'>('research')

  async function load(nextMode: 'demo' | 'live') {
    setLoading(true)
    setError('')
    setOrderMessage('')
    setMode(nextMode)
    try {
      const response = await fetch(`/api/dashboard?mode=${nextMode}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '数据读取失败')
      setBoard(data)
      setSelected(data.analyses[0]?.symbol || '')
    } catch (e) {
      setBoard(null)
      setError(e instanceof Error ? e.message : '数据读取失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load('demo')
  }, [])
  const active = useMemo(
    () => board?.analyses.find((x) => x.symbol === selected) || board?.analyses[0],
    [board, selected],
  )
  const visibleGates = active?.action === 'REVIEW_SELL' ? active.sell_gates : active?.gates || []
  const planLimit =
    active && board
      ? Math.max(
          0,
          (active.action === 'REVIEW_BUY'
            ? active.suggested_max_shares
            : active.action === 'REVIEW_SELL'
              ? active.position_shares
              : 0) -
            board.paper_orders
              .filter(
                (o) =>
                  o.mode === mode &&
                  o.symbol === active.symbol &&
                  o.side === (active.action === 'REVIEW_BUY' ? 'BUY' : 'SELL'),
              )
              .reduce((sum, o) => sum + o.quantity, 0),
        )
      : 0
  useEffect(() => {
    setQuantity(1)
  }, [selected])

  async function planOrder() {
    if (!active || !board) return
    setOrderMessage('')
    try {
      const response = await fetch('/api/paper/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, symbol: active.symbol, quantity }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法加入模拟计划')
      setBoard({ ...board, paper_orders: [...board.paper_orders, data] })
      setOrderMessage(
        `已将 ${quantity} 股 ${active.symbol} ${active.action === 'REVIEW_SELL' ? '卖出' : '买入'}加入模拟计划；尚未成交。`,
      )
    } catch (e) {
      setOrderMessage(e instanceof Error ? e.message : '无法加入模拟计划')
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={22} strokeWidth={2.6} />
          </div>
          <div>
            <strong>TradeBo</strong>
            <span>RESEARCH DESK</span>
          </div>
        </div>
        <div className="side-group-label">工作区</div>
        <nav aria-label="主导航">
          <button
            className={tab === 'research' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('research')}
          >
            <Radar size={19} />
            研究总览
          </button>
          <button
            className={tab === 'policy' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('policy')}
          >
            <SlidersHorizontal size={19} />
            规则与风控
          </button>
          <button
            className={tab === 'orders' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('orders')}
          >
            <BookOpen size={19} />
            模拟计划 <span className="nav-count">{board?.paper_orders.length || 0}</span>
          </button>
        </nav>
        <div className="side-bottom">
          <div className="side-status">
            <span className="pulse" />
            研究系统在线
          </div>
          <p>
            让每个决定
            <br />
            都有可以核查的依据。
          </p>
          <div className="side-foot">v0.1 · 本地研究原型</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="crumb">
            工作区 <span>/</span>{' '}
            {tab === 'research' ? '研究总览' : tab === 'policy' ? '规则与风控' : '模拟计划'}
          </div>
          <div className="top-actions">
            <span className="date-label">
              {new Date().toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <button
              className="refresh"
              onClick={() => void load(mode)}
              disabled={loading}
              aria-label="刷新数据"
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" /> EVIDENCE-LED DECISIONS
              </div>
              <h1>
                {tab === 'research'
                  ? '市场在变化，判断要有依据。'
                  : tab === 'policy'
                    ? '先定义边界，再考虑交易。'
                    : '所有计划，停在人工确认之前。'}
              </h1>
              <p>
                {tab === 'research'
                  ? '把行情趋势、资讯相关性和组合约束放在同一张研究桌上。'
                  : tab === 'policy'
                    ? '每项规则都公开可查；条件不足时，系统自动选择观望。'
                    : '这里记录纸面计划，不连接券商账户，也不假设已成交。'}
              </p>
            </div>
            <div className="mode-control" aria-label="数据模式">
              <button className={mode === 'demo' ? 'chosen' : ''} onClick={() => void load('demo')}>
                演示数据
              </button>
              <button className={mode === 'live' ? 'chosen' : ''} onClick={() => void load('live')}>
                真实数据
              </button>
            </div>
          </div>
          {mode === 'demo' && (
            <div className="demo-banner">
              <CircleAlert size={17} />
              <span>
                <strong>演示环境</strong> · 行情、公司及资讯均为合成数据，仅用于展示判断流程。
              </span>
            </div>
          )}
          {error && (
            <div className="error-panel">
              <CircleAlert size={20} />
              <div>
                <strong>无法载入数据</strong>
                <p>{error}</p>
                <button onClick={() => void load('demo')}>
                  返回演示环境 <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
          {loading && !board && <div className="loading">正在整理市场证据…</div>}
          {board && tab === 'research' && (
            <>
              <section className="metrics" aria-label="组合摘要">
                <div className="metric">
                  <div className="metric-label">
                    <Wallet size={17} /> 组合总值 <span>示例</span>
                  </div>
                  <strong>{money(board.portfolio.nav)}</strong>
                  <small>用于风险预算的基准金额</small>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    <Layers3 size={17} /> 可用现金
                  </div>
                  <strong>{money(board.portfolio.cash)}</strong>
                  <small>
                    最低留存 {board.policy.min_cash_pct}% ·{' '}
                    {money((board.portfolio.nav * board.policy.min_cash_pct) / 100)}
                  </small>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    <Radar size={17} /> 待复核机会
                  </div>
                  <strong>
                    {board.analyses
                      .filter((x) => x.action !== 'WAIT')
                      .length.toString()
                      .padStart(2, '0')}
                    <em> / {board.analyses.length.toString().padStart(2, '0')}</em>
                  </strong>
                  <small>买卖候选均需人工复核</small>
                </div>
              </section>

              <div className="workspace-grid">
                <div className="primary-col">
                  {active && (
                    <section className="card asset-card">
                      <div className="section-header">
                        <div>
                          <div className="section-kicker">标的研究 / {active.sector}</div>
                          <h2>
                            {active.symbol} <span>{active.name}</span>
                          </h2>
                        </div>
                        <div className={`decision-pill ${decision[active.action].className}`}>
                          {(() => {
                            const Icon = decision[active.action].icon
                            return <Icon size={16} />
                          })()}
                          {decision[active.action].label}
                        </div>
                      </div>
                      <div className="quote-row">
                        <strong>{price(active.market.price)}</strong>
                        <span className={active.market.change_pct >= 0 ? 'positive' : 'negative'}>
                          {active.market.change_pct >= 0 ? '+' : ''}
                          {active.market.change_pct.toFixed(2)}% <small>较前收盘</small>
                        </span>
                        <div className="quote-date">日线截至 {active.market.as_of}</div>
                      </div>
                      <Chart history={active.market.history} />
                      <div className="indicator-row">
                        <div>
                          <span>20 日均线</span>
                          <strong>{price(active.market.sma20)}</strong>
                        </div>
                        <div>
                          <span>50 日均线</span>
                          <strong>{price(active.market.sma50)}</strong>
                        </div>
                        <div>
                          <span>当前持仓</span>
                          <strong>{active.position_shares} 股</strong>
                        </div>
                        <div>
                          <span>计划止损参考</span>
                          <strong>{price(active.planning_stop)}</strong>
                        </div>
                      </div>
                    </section>
                  )}

                  {active && (
                    <section className="card evidence-card">
                      <div className="section-header">
                        <div>
                          <div className="section-kicker">DECISION TRACE</div>
                          <h2>
                            {active.action === 'REVIEW_SELL' ? '卖出触发条件' : '买入条件检查'}
                          </h2>
                        </div>
                        <span className="section-note">
                          {active.action === 'REVIEW_SELL'
                            ? '趋势转弱或仓位超限，任一触发'
                            : `${visibleGates.filter((g) => g.passed).length}/${visibleGates.length} 条买入条件满足`}
                        </span>
                      </div>
                      <div className="evidence-list">
                        {visibleGates.map((gate, i) => (
                          <div className="evidence-row" key={gate.id}>
                            <div className="evidence-index">0{i + 1}</div>
                            <div className="evidence-icon">
                              {gate.passed ? <Check size={17} /> : <span />}
                            </div>
                            <div className="evidence-copy">
                              <strong>{gate.label}</strong>
                              <p>{gate.detail}</p>
                            </div>
                            <span
                              className={gate.passed ? 'gate-result pass' : 'gate-result block'}
                            >
                              {gate.passed ? '已满足' : '未满足'}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="reason-strip">
                        <ShieldCheck size={18} />
                        <span>{active.reason}</span>
                      </div>
                    </section>
                  )}

                  {active && (
                    <section className="card news-card">
                      <div className="section-header">
                        <div>
                          <div className="section-kicker">SOURCE REVIEW</div>
                          <h2>相关资讯</h2>
                        </div>
                        <span className="section-note">按标的标签与发布时间筛选</span>
                      </div>
                      <div className="news-list">
                        {active.news.length ? (
                          active.news.map((item, i) => (
                            <div className="news-item" key={`${item.url}-${i}`}>
                              <div className="news-top">
                                <span className="source-tag">{item.source}</span>
                                <span>{Math.round(item.age_hours)} 小时前</span>
                                <span className={item.relevant ? 'rel-tag' : 'rel-tag dim'}>
                                  相关性 {Math.round(item.relevance * 100)}%
                                </span>
                              </div>
                              <strong>
                                {board.mode === 'demo' ? (
                                  item.title
                                ) : (
                                  <a href={item.url} target="_blank" rel="noreferrer">
                                    {item.title} <ExternalLink size={14} />
                                  </a>
                                )}
                              </strong>
                              <p>{item.summary}</p>
                              <div className="news-foot">
                                方向标签：
                                {item.sentiment === 'positive'
                                  ? '正向'
                                  : item.sentiment === 'negative'
                                    ? '负向'
                                    : '中性'}{' '}
                                · {item.relevant ? '计入证据' : '未计入'}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty-small">
                            当前没有符合条件的资讯。新买入将保持观望。
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>
                <div className="secondary-col">
                  <section className="card decision-card">
                    <div className="section-kicker">NEXT ACTION</div>
                    <h2>下一步怎么做</h2>
                    {active && (
                      <>
                        <div className={`action-mark ${decision[active.action].className}`}>
                          {(() => {
                            const Icon = decision[active.action].icon
                            return <Icon size={28} />
                          })()}
                        </div>
                        <h3>{decision[active.action].label}</h3>
                        <p>{active.reason}</p>
                        <div className="plan-summary">
                          <div>
                            <span>建议上限</span>
                            <strong>{active.action === 'WAIT' ? '暂无' : `${planLimit} 股`}</strong>
                          </div>
                          <div>
                            <span>单标的上限</span>
                            <strong>{board.policy.max_position_pct}%</strong>
                          </div>
                          <div>
                            <span>单笔风险预算</span>
                            <strong>{board.policy.risk_per_trade_pct}% NAV</strong>
                          </div>
                        </div>
                        {active.action !== 'WAIT' && (
                          <div className="order-box">
                            <label htmlFor="qty">
                              纸面{active.action === 'REVIEW_SELL' ? '卖出' : '买入'}计划{' '}
                              <span>尚可规划 {planLimit} 股</span>
                            </label>
                            <div className="order-controls">
                              <input
                                id="qty"
                                type="number"
                                min="1"
                                max={planLimit}
                                value={quantity}
                                onChange={(e) => setQuantity(Number(e.target.value))}
                              />
                              <button
                                onClick={() => void planOrder()}
                                disabled={
                                  !Number.isInteger(quantity) ||
                                  quantity < 1 ||
                                  quantity > planLimit
                                }
                              >
                                加入模拟计划 <ArrowRight size={15} />
                              </button>
                            </div>
                          </div>
                        )}
                        {orderMessage && (
                          <div className="order-message" role="status">
                            {orderMessage}
                          </div>
                        )}
                        <div className="decision-note">
                          <LockKeyhole size={15} />
                          人工确认前不会发送真实订单
                        </div>
                      </>
                    )}
                  </section>
                  <section className="card allocation-card">
                    <div className="section-header">
                      <div>
                        <div className="section-kicker">PORTFOLIO PLAN</div>
                        <h2>组合配置</h2>
                      </div>
                      <Wallet size={18} />
                    </div>
                    {board.portfolio.allocation.map((a, i) => (
                      <div className="allocation-row" key={a.label}>
                        <div>
                          <strong>{a.label}</strong>
                          <span>
                            {a.pct}% <small>/ 目标 {board.portfolio.target[i]?.pct}%</small>
                          </span>
                        </div>
                        <div className="bar-track">
                          <span className={`bar-fill alloc-${i}`} style={{ width: `${a.pct}%` }} />
                          <i style={{ left: `${board.portfolio.target[i]?.pct || 0}%` }} />
                        </div>
                      </div>
                    ))}
                    <p>目标配置仅作规划示例；实际配置需结合期限、现金需求与风险承受能力。</p>
                  </section>
                  <div className="mini-note">
                    <CircleCheck size={18} />
                    <span>资讯方向只作为复核线索；不会绕过行情、现金和仓位条件。</span>
                  </div>
                </div>
              </div>
              <section className="card watch-card">
                <div className="section-header">
                  <div>
                    <div className="section-kicker">WATCHLIST</div>
                    <h2>研究清单</h2>
                  </div>
                  <span className="section-note">点击标的查看完整证据</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>标的</th>
                        <th>最新收盘</th>
                        <th>日变化</th>
                        <th>趋势</th>
                        <th>结论</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.analyses.map((a) => (
                        <tr
                          key={a.symbol}
                          onClick={() => {
                            setSelected(a.symbol)
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                        >
                          <td>
                            <strong>{a.symbol}</strong>
                            <span>{a.name}</span>
                          </td>
                          <td>{price(a.market.price)}</td>
                          <td className={a.market.change_pct >= 0 ? 'positive' : 'negative'}>
                            {a.market.change_pct >= 0 ? '+' : ''}
                            {a.market.change_pct.toFixed(2)}%
                          </td>
                          <td>
                            {a.market.trend_up ? '上行' : a.market.trend_down ? '下行' : '未确认'}
                          </td>
                          <td>
                            <span className={`table-decision ${decision[a.action].className}`}>
                              {decision[a.action].label}
                            </span>
                          </td>
                          <td>
                            <ArrowRight size={17} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {board && tab === 'policy' && (
            <div className="policy-layout">
              <section className="card policy-hero">
                <div className="section-kicker">THE RULEBOOK</div>
                <h2>决策顺序</h2>
                <p>
                  先看数据能否使用，再判断趋势和新闻是否相互支持，最后计算交易规模。任一买入条件失败，结果即为观望。
                </p>
                <div className="policy-flow">
                  {['数据新鲜度', '趋势确认', '资讯交叉验证', '风险预算', '人工确认'].map(
                    (s, i) => (
                      <div key={s}>
                        <span>0{i + 1}</span>
                        <strong>{s}</strong>
                        {i < 4 && <ArrowRight size={17} />}
                      </div>
                    ),
                  )}
                </div>
              </section>
              <section className="policy-cards">
                {[
                  {
                    icon: Clock3,
                    title: '行情新鲜度',
                    value: '≤ 5 天',
                    text: '日线超过 5 天暂停候选判断，避免以陈旧价格规划交易。',
                  },
                  {
                    icon: FileText,
                    title: '资讯交叉验证',
                    value: '≥ 2 个来源',
                    text: '72 小时内，明确标记该股票代码的两条正向资讯，且没有负向标签。',
                  },
                  {
                    icon: ShieldCheck,
                    title: '单标的上限',
                    value: `${board.policy.max_position_pct}%`,
                    text: '含现有持仓。可用现金还需保留最低现金比例。',
                  },
                  {
                    icon: Wallet,
                    title: '单笔风险预算',
                    value: `${board.policy.risk_per_trade_pct}%`,
                    text: `按 ${board.policy.planning_stop_pct}% 计划止损距离估算股数；实际成交可能偏离。`,
                  },
                ].map(({ icon: Icon, title, value, text }) => (
                  <div className="card policy-rule" key={title}>
                    <Icon size={21} />
                    <div>
                      <span>{title}</span>
                      <strong>{value}</strong>
                      <p>{text}</p>
                    </div>
                  </div>
                ))}
              </section>
              <section className="card policy-bottom">
                <h2>卖出条件</h2>
                <p>
                  只有已有持仓才会进入卖出复核。若收盘跌破 20 日均线且 20 日均线低于 50
                  日均线，或持仓超过单标的上限，系统提示复核卖出范围。卖出不会自动执行。
                </p>
                <h2>当前版本边界</h2>
                <p>
                  均线是描述性指标；资讯标签来自数据提供方，可能错误或缺失。没有回测、交易成本模型、税务模型或券商实盘连接，不展示收益预测。
                </p>
              </section>
            </div>
          )}
          {board && tab === 'orders' && (
            <section className="card orders-card">
              <div className="section-header">
                <div>
                  <div className="section-kicker">PAPER PLAN</div>
                  <h2>模拟计划记录</h2>
                </div>
                <span className="section-note">仅保存在本次服务运行期间</span>
              </div>
              {board.paper_orders.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>编号</th>
                        <th>标的</th>
                        <th>方向</th>
                        <th>数量</th>
                        <th>参考收盘价</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.paper_orders.map((o) => (
                        <tr key={o.id}>
                          <td>#{o.id.toString().padStart(3, '0')}</td>
                          <td>
                            <strong>{o.symbol}</strong>
                          </td>
                          <td>{o.side === 'BUY' ? '买入' : '卖出'}</td>
                          <td>{o.quantity} 股</td>
                          <td>{price(o.reference_price)}</td>
                          <td>
                            <span className="table-decision wait">待人工复核</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="orders-conditions">
                    执行前检查：人工核验资讯与账户目标 · 刷新行情和仓位 · 确认交易时段与限价 ·
                    评估费用及滑点。参考收盘价不是实际下单限价。
                  </p>
                </div>
              ) : (
                <div className="orders-empty">
                  <BookOpen size={34} />
                  <h3>还没有模拟计划</h3>
                  <p>在研究总览中选择符合条件的标的，输入数量并加入计划。</p>
                  <button onClick={() => setTab('research')}>
                    前往研究总览 <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
          )}
          <footer>
            TradeBo ·
            研究与演示用途。所有候选均需核验来源、市场状态及个人适配性；历史趋势不保证未来结果。
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App

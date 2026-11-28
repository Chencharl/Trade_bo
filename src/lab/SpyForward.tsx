import { useEffect, useState } from 'react'
import { money, signedMoney, pct, diff, names, type Text } from './spyDaily'
import './spy-forward.css'

const ledger = 'https://raw.githubusercontent.com/Chencharl/Trade_bo/forward-data/ledger.json'
const repo = 'https://github.com/Chencharl/Trade_bo'
const keys = ['model', 'trend', 'market'] as const
type Key = (typeof keys)[number]
type Timestamp = { date: string; marketAt: string; recordedAt: string; run: string | null }
type Signal = { targets: Record<Key, number>; probability: number }
type Event = Timestamp &
  ({ phase: 'close'; signal: Signal | null; nextOpenAt: string } | { phase: 'open' })
type Close = Extract<Event, { phase: 'close' }>
type Fill = Timestamp & {
  rule: Key
  side: 'buy' | 'sell' | 'reinvest'
  commission: number
  slippage: number
  fillPrice: number
  shares: number
  notional: number
}
type Account = { ending: number; net: number; fees: number; target: number }
type Episode = {
  exit: string
  reentry: string | null
  through: string
  days: number
  avoided: number
  missed: number
  windows: Record<Key, { net: number; commission: number; slippage: number }>
}
export type ForwardReport = {
  protocol: {
    version: string
    firstSignal: string
    firstOpen: string
    reviewThrough: string
    capital: number
    feeBp: number
    slipBp: number
    modelHash: string
  }
  activation: null | { recordedAt: string; run: string | null }
  events: Event[]
  nextObservation: string
  accounts: Record<Key, Account>
  fills: Fill[]
  episodes: Episode[]
}
const et = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const time = (iso: string) => et.format(new Date(iso)) + ' ET'
const position = (v: number, t: Text) => (v ? 'SPY' : t('Cash', '现金'))
function Pager({
  page,
  setPage,
  count,
  t,
}: {
  page: number
  setPage: (v: number) => void
  count: number
  t: Text
}) {
  if (count <= 10) return null
  return (
    <div className="fw-pager">
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>
        {t('Newer', '较新')}
      </button>
      <span>
        {page + 1} / {Math.ceil(count / 10)}
      </span>
      <button disabled={(page + 1) * 10 >= count} onClick={() => setPage(page + 1)}>
        {t('Older', '较早')}
      </button>
    </div>
  )
}
function Episodes({ list, t }: { list: Episode[]; t: Text }) {
  const [chosen, setChosen] = useState('')
  const s = list.find((x) => x.exit === chosen) ?? list.at(-1)
  return (
    <section className="fw-section">
      <div className="fw-heading">
        <h2>{t('What happened while the model was in cash?', '模型减仓期间，市场发生了什么？')}</h2>
        {s && (
          <label>
            {t('Exit open', '减仓开盘日')}{' '}
            <select value={s.exit} onChange={(e) => setChosen(e.target.value)}>
              {list
                .slice()
                .reverse()
                .map((x) => (
                  <option key={x.exit}>{x.exit}</option>
                ))}
            </select>
          </label>
        )}
      </div>
      {s ? (
        <>
          <p className="fw-period">
            {s.exit} → {s.through} ·{' '}
            {s.reentry
              ? t('Bought back at the open', '已在开盘买回')
              : t('Still in cash · marked to latest observation', '仍在空仓 · 按最新观察估值')}
          </p>
          <div className="fw-spell">
            <div>
              <span>{t('SPY declines avoided', '避开的 SPY 下跌')}</span>
              <strong>{pct(s.avoided)}</strong>
            </div>
            <div>
              <span>{t('SPY gains missed', '错过的 SPY 上涨')}</span>
              <strong>{pct(s.missed)}</strong>
            </div>
            <div>
              <span>{t('Model execution costs', '模型区间成交成本')}</span>
              <strong>{money(s.windows.model.commission + s.windows.model.slippage)}</strong>
            </div>
          </div>
          <p className="fw-window">
            {t('Over these dates, after costs', '相同区间内扣费后收益')}　
            {keys.map((k) => (
              <span key={k}>
                {names(t)[k]} <b>{pct(s.windows[k].net)}</b>　
              </span>
            ))}
          </p>
          <p>
            {t(
              'Model difference per $10,000 at exit',
              '若在减仓时各投入 $10,000，模型截至区间末的差额为',
            )}
            {(['trend', 'market'] as const).map((k) => {
              const gap = s.windows.model.net - s.windows[k].net
              return (
                <span key={k}>
                  {' '}
                  · {k === 'trend'
                    ? t('vs. trend', '对比趋势过滤')
                    : t('vs. SPY', '对比持有 SPY')}{' '}
                  <b>{signedMoney(10000 * gap)}</b> ({diff(gap)} {t('pp', '个百分点')})
                </span>
              )
            })}
          </p>
        </>
      ) : (
        <p className="fw-empty">
          {t(
            'No model exit has filled yet. A period in cash starts when the model sells SPY at the open.',
            '还没有模型卖出成交。第一次开盘卖出 SPY 后，这里会开始统计空仓期间的涨跌。',
          )}
        </p>
      )}
    </section>
  )
}
function Journal({ r, t }: { r: ForwardReport; t: Text }) {
  const [signalPage, setSignalPage] = useState(0),
    [fillPage, setFillPage] = useState(0)
  const signals = r.events.filter((e): e is Close => e.phase === 'close').reverse()
  const opens = new Set(r.events.filter((e) => e.phase === 'open').map((e) => e.marketAt))
  const fills = r.fills.slice().reverse()
  return (
    <>
      <section className="fw-section">
        <h2>{t('Signals recorded after the close', '收盘信号记录')}</h2>
        {signals.length ? (
          <>
            <div className="fw-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      t('Session close', '交易日收盘'),
                      t('Recorded (ET)', '实际记录（美东）'),
                      t('Model target', '模型目标'),
                      t('Trend target', '趋势目标'),
                      t('Next open', '下一开盘'),
                    ].map((v) => (
                      <th key={v}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signals.slice(signalPage * 10, signalPage * 10 + 10).map((e) => (
                    <tr key={e.date}>
                      <th>{time(e.marketAt)}</th>
                      <td data-label={t('Recorded', '实际记录')}>
                        {e.run ? (
                          <a href={repo + '/actions/runs/' + e.run}>{time(e.recordedAt)}</a>
                        ) : (
                          time(e.recordedAt)
                        )}
                      </td>
                      <td data-label={t('Model', '模型')}>
                        {e.signal
                          ? position(e.signal.targets.model, t) +
                            ' · P↑ ' +
                            pct(e.signal.probability)
                          : t('Missed · carry', '漏记 · 延续仓位')}
                      </td>
                      <td data-label={t('Trend', '趋势')}>
                        {e.signal ? position(e.signal.targets.trend, t) : t('Carry', '延续仓位')}
                      </td>
                      <td data-label={t('Next open', '下一开盘')}>
                        {time(e.nextOpenAt)}
                        <small>
                          {opens.has(e.nextOpenAt)
                            ? t('Opening print recorded', '已获得开盘价')
                            : t('Awaiting opening print', '等待开盘价')}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={signalPage} setPage={setSignalPage} count={signals.length} t={t} />
          </>
        ) : (
          <p className="fw-empty">
            {t('First scheduled signal', '首条计划信号')} · {r.protocol.firstSignal}{' '}
            {t('after the regular close, ET.', '美东常规交易收盘后。')}
          </p>
        )}
      </section>
      <details className="fw-section fw-details">
        <summary>
          {t('Simulated opening fills', '模拟开盘成交')} · {fills.length}
        </summary>
        {fills.length ? (
          <>
            <div className="fw-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      t('Modeled open', '模拟成交开盘'),
                      t('Recorded (ET)', '实际记录（美东）'),
                      t('Portfolio', '账户'),
                      t('Order', '订单'),
                      t('Simulated fill', '模拟成交价'),
                      t('Filled value', '成交额'),
                      t('Commission + slippage', '手续费与滑点'),
                    ].map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fills.slice(fillPage * 10, fillPage * 10 + 10).map((f) => (
                    <tr key={f.date + f.rule}>
                      <th>{time(f.marketAt)}</th>
                      <td data-label={t('Recorded', '实际记录')}>{time(f.recordedAt)}</td>
                      <td data-label={t('Portfolio', '账户')}>{names(t)[f.rule]}</td>
                      <td data-label={t('Order', '订单')}>
                        {
                          {
                            buy: t('Buy', '买入'),
                            sell: t('Sell', '卖出'),
                            reinvest: t('Reinvest', '股息再投资'),
                          }[f.side]
                        }
                      </td>
                      <td data-label={t('Simulated fill', '模拟成交价')}>
                        {money(f.fillPrice)}
                        <small>
                          {f.shares.toFixed(4)} {t('shares', '股')}
                        </small>
                      </td>
                      <td data-label={t('Filled value', '成交额')}>{money(f.notional)}</td>
                      <td data-label={t('Cost', '成本')}>{money(f.commission + f.slippage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={fillPage} setPage={setFillPage} count={fills.length} t={t} />
          </>
        ) : (
          <p>
            {t('Earliest eligible open', '最早可模拟成交')} · {r.protocol.firstOpen} 09:30 ET
          </p>
        )}
      </details>
    </>
  )
}
function Results({ r, t }: { r: ForwardReport; t: Text }) {
  const closes = r.events.filter((e): e is Close => e.phase === 'close'),
    latest = r.events.at(-1)
  const active = r.events.some((e) => e.phase === 'open' && e.date >= r.protocol.firstOpen)
  const late = Date.now() > Date.parse(r.nextObservation) + 90 * 60000
  return (
    <>
      <section className="spy-intro">
        <div className="spy-period">SPY · {t('FORWARD TEST', '前向测试')}</div>
        <h2>{t('From signal to next open', '从收盘信号到次日开盘')}</h2>
        <p>
          {latest
            ? t('Last portfolio mark', '最近一次组合估值') +
              ' · ' +
              time(latest.marketAt) +
              ' · ' +
              (latest.phase === 'open' ? t('open', '开盘') : t('close', '收盘'))
            : t(
                'The three accounts start in cash. The first signal is due after the November 30, 2026 close.',
                '三个账户均从现金起步。首条信号计划在 2026 年 11 月 30 日收盘后记录。',
              )}
        </p>
      </section>
      {late && (
        <p className="fw-delay" role="status">
          {t(
            'The next observation is overdue. Showing the last published ledger.',
            '下一条观察尚未按时到达。当前显示最近一次公开账本。',
          )}{' '}
          <a href={repo + '/actions/workflows/spy-forward.yml'}>
            {t('Check updater', '查看更新任务')}
          </a>
        </p>
      )}
      <div className="fw-status">
        <div>
          <span>{t('First signal date', '首个信号日')}</span>
          <strong>{r.protocol.firstSignal}</strong>
        </div>
        <div>
          <span>{t('First eligible fill', '最早模拟成交日')}</span>
          <strong>{r.protocol.firstOpen}</strong>
        </div>
        <div>
          <span>{t('Recorded signals / missed', '已记录信号 / 漏记')}</span>
          <strong>
            {closes.filter((e) => e.signal).length} / {closes.filter((e) => !e.signal).length}
          </strong>
        </div>
      </div>
      <section className="fw-section">
        <div className="fw-heading">
          <h2>{t('Net account balances', '扣费后账户余额')}</h2>
          <span>
            {t('Commission 1 bp + slippage 2 bp per side', '单边手续费 1 bp + 滑点 2 bp')}
          </span>
        </div>
        <div className="fw-accounts">
          {keys.map((k) => (
            <div key={k}>
              <span>{names(t)[k]}</span>
              <strong>{money(r.accounts[k].ending)}</strong>
              <small>
                {position(r.accounts[k].target, t)} · {t('costs', '累计成本')}{' '}
                {money(r.accounts[k].fees)}
              </small>
            </div>
          ))}
        </div>
        <div className="fw-gaps">
          {t('Model lead after costs', '模型扣费后领先金额')} ·{' '}
          {t('vs. trend filter', '对比趋势过滤')}{' '}
          <b>{active ? signedMoney(r.accounts.model.ending - r.accounts.trend.ending) : '—'}</b> ·{' '}
          {t('vs. holding SPY', '对比持有 SPY')}{' '}
          <b>{active ? signedMoney(r.accounts.model.ending - r.accounts.market.ending) : '—'}</b>
        </div>
      </section>
      <Episodes list={r.episodes} t={t} />
      <Journal r={r} t={t} />
      {r.activation && !latest && (
        <p className="fw-activation">
          {t('Market data connection verified', '行情连接已核验')} · {time(r.activation.recordedAt)}
          {r.activation.run && (
            <>
              {' '}
              ·{' '}
              <a href={repo + '/actions/runs/' + r.activation.run}>
                {t('View receipt', '查看记录')}
              </a>
            </>
          )}
        </p>
      )}
      <div className="fw-links">
        <a href={repo + '/blob/main/docs/STRATEGY_SPY_FORWARD.md'}>
          {t('Frozen protocol', '冻结方案')}
        </a>
        <a href={ledger}>{t('Full ledger', '完整账本')}</a>
        <a href={repo + '/commits/forward-data/'}>{t('Publication history', '发布历史')}</a>
        <a href={repo + '/actions/workflows/spy-forward.yml'}>
          {t('Scheduled updates', '定时更新')}
        </a>
      </div>
    </>
  )
}
export default function SpyForward({ t }: { t: Text }) {
  const [data, setData] = useState<ForwardReport | null>(null),
    [error, setError] = useState(false),
    [attempt, retry] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const res = await fetch(ledger + '?v=' + Math.floor(Date.now() / 60000), {
          signal: c.signal,
          cache: 'no-store',
        })
        if (!res.ok) throw Error()
        const r: ForwardReport = await res.json()
        if (
          r.protocol?.version !== 'spy-forward-1' ||
          r.protocol.modelHash !==
            '782089554c0bc852fe2727b6e3ca17b006684456633df2f772cac27ce5f0d2ca' ||
          !Array.isArray(r.events) ||
          !r.accounts?.market ||
          !r.nextObservation
        )
          throw Error()
        if (!c.signal.aborted) {
          setData(r)
          setError(false)
        }
      } catch {
        if (!c.signal.aborted) setError(true)
      } finally {
        loading = false
      }
    }
    void load()
    const timer = window.setInterval(load, 300000)
    return () => {
      c.abort()
      window.clearInterval(timer)
    }
  }, [attempt])
  return (
    <div className="fw">
      {error && (
        <p role="alert">
          {data
            ? t(
                'Update unavailable. Showing the last loaded balances.',
                '更新暂不可用。当前显示上次载入的余额。',
              )
            : t('The forward ledger could not be loaded.', '暂时无法读取前向账本。')}{' '}
          <button onClick={() => retry((n) => n + 1)}>{t('Retry', '重试')}</button>
        </p>
      )}
      {data ? (
        <Results r={data} t={t} />
      ) : (
        !error && <p role="status">{t('Loading the forward ledger…', '正在读取前向账本…')}</p>
      )}
    </div>
  )
}

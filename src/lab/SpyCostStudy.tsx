import { useEffect, useRef, useState } from 'react'
import { money, signedMoney, type Text } from './spyDaily'
import './spy-costs.css'

type Mode = 'mixed' | 'fee' | 'slip'
type Comparator = 'trend' | 'market'
const comparators: Comparator[] = ['trend', 'market']
type Balances = Record<Comparator | 'model', number>
type Cutoff =
  | { status: 'crossing'; low: number; high: number; balances: Balances }
  | { status: 'behind-at-zero' | 'ahead-at-limit' }
type Cutoffs = Record<Comparator, Cutoff>
export type CostReport = {
  version: string
  sourceHash: string
  start: string
  end: string
  capital: number
  modelExits: number
  axisBp: number[]
  grid: Balances[][]
  mixed: Balances[]
  published: { fee: number; slip: number }
  cutoffs: { mixed: Cutoffs; fee: Cutoffs[]; slip: Cutoffs[] }
}
const url = './research/spy-costs.json'
const chartColors = { trend: '#394f9a', market: '#216b65' }
const fmt = (v: number) => v.toFixed(2)
const midpoint = (v: Extract<Cutoff, { status: 'crossing' }>) => (v.low + v.high) / 2

function CostChart({
  axis,
  points,
  cuts,
  selectedBp,
  selected,
  pickTie,
  axisLabel,
  reference,
  choose,
  t,
}: {
  axis: number[]
  points: Balances[]
  cuts: Cutoffs
  selectedBp: number
  selected: Balances
  pickTie: (v: Comparator) => void
  axisLabel: string
  reference: number | null
  choose: (v: number) => void
  t: Text
}) {
  const plot = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const el = plot.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => setWidth(Math.max(185, entry.contentRect.width)))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  const labels = { trend: t('Trend filter', '趋势过滤'), market: t('Buy & hold SPY', '持有 SPY') }
  const gap = (v: Balances, k: Comparator) => v.model - v[k]
  const values = points.flatMap((v) => comparators.map((k) => gap(v, k)))
  const step = 500,
    min = Math.min(-step, Math.floor(Math.min(...values) / step) * step),
    max = Math.max(step, Math.ceil(Math.max(...values) / step) * step)
  const left = width < 420 ? 45 : 59,
    right = width - 15,
    top = 25,
    bottom = 225,
    height = 281
  const x = (v: number) => left + ((right - left) * v) / axis[axis.length - 1]
  const y = (v: number) => bottom - ((bottom - top) * (v - min)) / (max - min)
  const tickStep = max - min > 2600 ? 1000 : 500
  const ticks = Array.from(
    { length: Math.floor(max / tickStep) - Math.ceil(min / tickStep) + 1 },
    (_, i) => (i + Math.ceil(min / tickStep)) * tickStep,
  )
  const dollarTick = (v: number) =>
    v === 0
      ? '$0'
      : (v < 0 ? '−' : '+') +
        '$' +
        (Math.abs(v) >= 1000 ? Number((Math.abs(v) / 1000).toFixed(1)) + 'k' : Math.abs(v))
  return (
    <div className="cost-plot" ref={plot}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t(
          'Ending balance advantage and break-even crossings',
          '模型期末余额领先金额与打平点',
        )}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect(),
            pos = ((e.clientX - box.left) / box.width) * width
          choose(
            Math.min(
              axis.length - 1,
              Math.max(0, Math.round(((pos - left) / (right - left)) * (axis.length - 1))),
            ),
          )
        }}
      >
        <rect x={left} y={top} width={right - left} height={y(0) - top} fill="#f0f6f5" />
        <rect x={left} y={y(0)} width={right - left} height={bottom - y(0)} fill="#f2f4f8" />
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={right}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? '#57677d' : '#dde4ed'}
              strokeWidth={v === 0 ? 1.5 : 1}
            />
            <text x={left - 6} y={y(v) + 4} textAnchor="end">
              {dollarTick(v)}
            </text>
          </g>
        ))}
        {axis
          .filter((v) => Number.isInteger(v))
          .map((v) => (
            <text key={v} x={x(v)} y={bottom + 20} textAnchor="middle">
              {v}
            </text>
          ))}
        <text x={(left + right) / 2} y={bottom + 44} textAnchor="middle">
          {axisLabel} (bp)
        </text>
        {reference !== null && (
          <g className="cost-reference">
            <line
              x1={x(reference)}
              x2={x(reference)}
              y1={top - 5}
              y2={bottom}
              stroke="#8a98a8"
              strokeDasharray="4 4"
            />
            <text x={x(reference)} y={top - 9} textAnchor="middle">
              {t('Original', '原设定')} · {reference} bp
            </text>
          </g>
        )}
        <line
          x1={x(selectedBp)}
          x2={x(selectedBp)}
          y1={top}
          y2={bottom}
          stroke="#7c8a9c"
          strokeDasharray="2 3"
        />
        {comparators.map((k) => (
          <g key={k}>
            <path
              d={points.map((p, i) => (i ? 'L' : 'M') + x(axis[i]) + ',' + y(gap(p, k))).join(' ')}
              fill="none"
              stroke={chartColors[k]}
              strokeWidth="2.6"
              strokeDasharray={k === 'trend' ? '6 3' : undefined}
            />
            <circle
              cx={x(selectedBp)}
              cy={y(gap(selected, k))}
              r="4"
              fill={chartColors[k]}
              stroke="white"
              strokeWidth="1.5"
            />
          </g>
        ))}
        {comparators.map((k) => {
          const c = cuts[k]
          if (c.status !== 'crossing') return null
          const bp = midpoint(c),
            cx = x(bp),
            sgn = k === 'trend' ? 1 : -1,
            cy = y(0) + sgn * 22
          const align = cx < left + 48 ? 'start' : cx > right - 52 ? 'end' : 'middle'
          return (
            <g
              key={k}
              className="cost-cross"
              fill={chartColors[k]}
              onClick={(e) => {
                e.stopPropagation()
                pickTie(k)
              }}
            >
              <title>{t('Inspect this tie', '查看此打平点')}</title>
              <circle cx={cx} cy={y(0)} r="12" fill="transparent" />
              <circle
                cx={cx}
                cy={y(0)}
                r="5"
                fill="white"
                stroke={chartColors[k]}
                strokeWidth="2.5"
              />
              <line x1={cx} x2={cx} y1={y(0) + sgn * 6} y2={cy - sgn * 5} stroke={chartColors[k]} />
              <text x={cx} y={cy + (sgn > 0 ? 8 : -1)} textAnchor={align}>
                {k === 'trend' ? t('Trend', '趋势') : 'SPY'} · {fmt(bp)} bp
              </text>
            </g>
          )
        })}
      </svg>
      {comparators.map((k) =>
        cuts[k].status === 'crossing' ? null : (
          <p className="cost-outside" key={k}>
            {labels[k]}
            {cuts[k].status === 'behind-at-zero'
              ? t(' already leads at 0 bp on this axis.', '在横轴为 0 bp 时已经领先。')
              : t(' still trails at the maximum tested cost.', '在测试最高成本时仍然落后。')}
          </p>
        ),
      )}
    </div>
  )
}

function CostSlider({
  name,
  options,
  value,
  onPick,
}: {
  name: string
  options: number[]
  value: number
  onPick: (v: number) => void
}) {
  return (
    <label className="cost-range">
      <span>
        {name}
        <b>{fmt(value)} bp</b>
      </span>
      <input
        aria-label={name}
        type="range"
        min={options[0]}
        max={options[options.length - 1]}
        step="any"
        value={value}
        aria-valuetext={fmt(value) + ' bp'}
        onChange={(e) => {
          const n = Number(e.target.value)
          onPick(options.reduce((a, b) => (Math.abs(n - b) < Math.abs(n - a) ? b : a)))
        }}
        onKeyDown={(e) => {
          const direction = ['ArrowRight', 'ArrowUp'].includes(e.key)
            ? 1
            : ['ArrowLeft', 'ArrowDown'].includes(e.key)
              ? -1
              : 0
          if (!direction) return
          e.preventDefault()
          onPick(
            options[Math.max(0, Math.min(options.length - 1, options.indexOf(value) + direction))],
          )
        }}
      />
    </label>
  )
}

function CostExplorer({ data, t }: { data: CostReport; t: Text }) {
  const axis = data.axisBp
  const [mode, setMode] = useState<Mode>('mixed')
  const [feeIndex, setFee] = useState(axis.indexOf(data.published.fee))
  const [slipIndex, setSlip] = useState(axis.indexOf(data.published.slip))
  const [mixIndex, setMix] = useState(axis.indexOf(data.published.fee + data.published.slip))
  const rows =
    mode === 'mixed'
      ? data.mixed
      : mode === 'fee'
        ? data.grid.map((row) => row[slipIndex])
        : data.grid[feeIndex]
  const cuts =
    mode === 'mixed'
      ? data.cutoffs.mixed
      : mode === 'fee'
        ? data.cutoffs.fee[slipIndex]
        : data.cutoffs.slip[feeIndex]
  const idx = mode === 'mixed' ? mixIndex : mode === 'fee' ? feeIndex : slipIndex
  const setGridIndex = mode === 'mixed' ? setMix : mode === 'fee' ? setFee : setSlip
  const labels = {
    mixed: t('Combined cost', '合计成本'),
    fee: t('Commission', '手续费'),
    slip: t('Slippage', '滑点'),
  }
  const other = mode === 'fee' ? 'slip' : 'fee'
  const [pickedTie, setPickedTie] = useState<Comparator | null>(null)
  const tie = pickedTie && cuts[pickedTie].status === 'crossing' ? cuts[pickedTie] : null
  const selectedBp = tie?.status === 'crossing' ? midpoint(tie) : axis[idx]
  const balances = tie?.status === 'crossing' ? tie.balances : rows[idx]
  const options = [
    ...new Set([
      ...axis,
      ...comparators.flatMap((k) => {
        const c = cuts[k]
        return c.status === 'crossing' ? [midpoint(c)] : []
      }),
    ]),
  ].sort((a, b) => a - b)
  const chooseIndex = (i: number) => {
    setPickedTie(null)
    setGridIndex(i)
  }
  const chooseBp = (v: number) => {
    const target = comparators.find((k) => {
      const c = cuts[k]
      return c.status === 'crossing' && midpoint(c) === v
    })
    if (target) setPickedTie(target)
    else chooseIndex(axis.indexOf(v))
  }
  const fee = mode === 'mixed' ? selectedBp / 3 : mode === 'fee' ? selectedBp : axis[feeIndex]
  const slip =
    mode === 'mixed' ? (2 * selectedBp) / 3 : mode === 'slip' ? selectedBp : axis[slipIndex]
  const quoted = fee === data.published.fee && slip === data.published.slip
  return (
    <>
      <div className="cost-head">
        <h2>
          {t('When do trading costs erase the model’s lead?', '交易成本多高，模型会失去优势？')}
        </h2>
        <p>
          {data.start} — {data.end} ·{' '}
          {t(
            'Same 64 exits. Each portfolio starts with $10,000 and pays the same rates.',
            '固定 64 次减仓。三个账户均从 10,000 美元起步，按相同费率成交。',
          )}
        </p>
      </div>
      <div className="cost-body">
        <div className="cost-figure">
          <div className="cost-modes" role="group" aria-label={t('Cost to vary', '调节的成本')}>
            {(['mixed', 'fee', 'slip'] as const).map((k) => (
              <button
                key={k}
                aria-pressed={mode === k}
                onClick={() => {
                  setMode(k)
                  setPickedTie(null)
                }}
              >
                {labels[k]}
              </button>
            ))}
          </div>
          <p className="cost-caption">
            {t('How much more the model ends with', '模型期末比对照多赚多少钱')}
          </p>
          <div className="cost-legend">
            <span>
              <i />
              {t('vs. holding SPY', '对比持有 SPY')}
            </span>
            <span>
              <i />
              {t('vs. trend filter', '对比趋势过滤')}
            </span>
          </div>
          <CostChart
            axis={axis}
            points={rows}
            cuts={cuts}
            selectedBp={selectedBp}
            selected={balances}
            pickTie={setPickedTie}
            choose={chooseIndex}
            t={t}
            axisLabel={labels[mode]}
            reference={
              mode === 'mixed'
                ? data.published.fee + data.published.slip
                : mode === 'fee' && slip === data.published.slip
                  ? data.published.fee
                  : mode === 'slip' && fee === data.published.fee
                    ? data.published.slip
                    : null
            }
          />
          <p className="cost-help">
            {t(
              'Select a circle on $0 to inspect a tie. To the right of each crossing, the model trails that benchmark.',
              '点选零线上的空心圆可查看打平时的账户余额。超过该点，模型就跑输对应的对照。',
            )}
          </p>
        </div>
        <aside className="cost-control" aria-label={t('Selected costs', '所选交易成本')}>
          <h3>{t('Cost per trade', '每次单边成交的成本')}</h3>
          <p className="cost-bp">1 bp = 0.01%</p>
          <CostSlider name={labels[mode]} options={options} value={selectedBp} onPick={chooseBp} />
          {mode === 'mixed' ? (
            <p className="cost-split">
              {t('1 part commission, 2 parts slippage', '手续费与滑点按 1:2 分配')}
              <br />
              {fmt(fee)} + {fmt(slip)} bp
            </p>
          ) : (
            <CostSlider
              name={
                other === 'fee'
                  ? t('Fixed commission', '固定手续费')
                  : t('Fixed slippage', '固定滑点')
              }
              options={axis}
              value={mode === 'fee' ? slip : fee}
              onPick={(v) => {
                setPickedTie(null)
                ;(mode === 'fee' ? setSlip : setFee)(axis.indexOf(v))
              }}
            />
          )}
          <div className="cost-result" aria-live="polite">
            <p>{t('Model ending balance', '模型期末净值')}</p>
            <strong>{money(balances.model)}</strong>
            {comparators.map((k) => (
              <div key={k}>
                <span>
                  {k === 'trend'
                    ? t('vs. trend filter', '对比趋势过滤')
                    : t('vs. holding SPY', '对比持有 SPY')}
                </span>
                <b>
                  {pickedTie === k
                    ? t('Tie · $0.00', '打平 · $0.00')
                    : signedMoney(balances.model - balances[k])}
                </b>
              </div>
            ))}
          </div>
          <button
            className="cost-reset"
            disabled={quoted}
            onClick={() => {
              setPickedTie(null)
              setFee(axis.indexOf(data.published.fee))
              setSlip(axis.indexOf(data.published.slip))
              setMix(axis.indexOf(data.published.fee + data.published.slip))
            }}
          >
            {quoted
              ? t('Original test costs', '原回测成本')
              : t('Restore original costs', '恢复原回测成本')}
          </button>
        </aside>
      </div>
      <details className="cost-method">
        <summary>{t('Break-even values and calculation', '打平数值与计算方法')}</summary>
        <p>
          {mode === 'mixed'
            ? t(
                'Combined cost keeps a 1:2 commission-to-slippage ratio.',
                '合计成本模式保持手续费与滑点为 1:2。',
              )
            : labels[other] + ' = ' + fmt(mode === 'fee' ? slip : fee) + ' bp.'}{' '}
          {t(
            'One basis point (bp) is 0.01%. Costs apply to buys, sells and dividend reinvestments. Each point replays all three accounts.',
            '1 bp（基点）等于 0.01%。买入、卖出和股息再投资均计成本。每个点都重新计算三个账户。',
          )}
        </p>
        {comparators.map((k) => {
          const v = cuts[k]
          return (
            <p key={k}>
              <b>
                {k === 'trend' ? t('Trend filter', '趋势过滤') : t('Buy & hold SPY', '持有 SPY')}
              </b>{' '}
              ·{' '}
              {v.status === 'crossing'
                ? t('Break-even near ', '打平约 ') + midpoint(v).toFixed(6) + ' bp'
                : v.status === 'behind-at-zero'
                  ? t('Model already trails at zero.', '横轴为零时模型已经落后。')
                  : t('Model still leads at 6 bp.', '横轴为 6 bp 时模型仍领先。')}
            </p>
          )
        })}
        <p>
          <a href={url} download>
            {t('Download the 625 cost pairs and thresholds', '下载 625 组成本和打平点')}
          </a>{' '}
          ·{' '}
          <a href="https://github.com/Chencharl/Trade_bo/blob/main/docs/STRATEGY_SPY_COSTS.md">
            {t('Method and reproduction', '方法与复算')}
          </a>
        </p>
      </details>
    </>
  )
}

export default function SpyCostStudy({ t, sourceHash }: { t: Text; sourceHash: string }) {
  const [data, setData] = useState<CostReport | null>(null),
    [failed, setFailed] = useState(false),
    [attempt, retry] = useState(0)
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    const abort = new AbortController()
    setFailed(false)
    fetch(url, { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) throw Error()
        const d: CostReport = await res.json()
        if (
          d.version !== 'spy-cost-1' ||
          d.sourceHash !== sourceHash ||
          !d.axisBp.length ||
          d.grid.length !== d.axisBp.length ||
          !d.cutoffs.mixed
        )
          throw Error()
        if (!abort.signal.aborted) setData(d)
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true)
      })
    return () => abort.abort()
  }, [attempt, sourceHash])
  useEffect(() => {
    if ((data || failed) && location.hash === '#lab-spy-costs')
      section.current?.scrollIntoView({ block: 'start' })
  }, [data, failed])
  return (
    <section
      className="spy-costs"
      id="lab-spy-costs"
      aria-label={t('Trading cost study', '交易成本研究')}
      ref={section}
    >
      {data ? (
        <CostExplorer data={data} t={t} />
      ) : failed ? (
        <p role="alert">
          {t('Cost results could not load.', '成本结果加载失败。')}{' '}
          <button onClick={() => retry((n) => n + 1)}>
            {t('Retry cost study', '重新载入成本研究')}
          </button>
        </p>
      ) : (
        <p role="status">{t('Loading cost study…', '正在加载成本研究…')}</p>
      )}
    </section>
  )
}

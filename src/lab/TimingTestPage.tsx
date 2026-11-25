import { useState } from 'react'
import HistoricalStudyPage, { type Text } from './HistoricalStudyPage'
import type { TimingStudy, Endpoint } from './timingStudy'
import './timing.css'

const file = './research/timing-null.json'
const pct = (x: number) => (x * 100).toFixed(2) + '%'
const count = (n: number) => n.toLocaleString('en-US')
const rules = ['trend', 'original'] as const
function Results({ r, t }: { r: TimingStudy; t: Text }) {
  const [metric, setMetric] = useState<Endpoint>('residual'),
    [fold, setFold] = useState(0)
  const labels: Record<Endpoint, string> = {
    residual: t('Additional timing return before fees', '过滤带来的额外择时收益（费前）'),
    trendReturn: t('Trend filter · net annual return', '趋势过滤 · 扣费后年化收益'),
    trendDrawdown: t('Trend filter · maximum drawdown', '趋势过滤 · 最大回撤'),
    originalReturn: t('Original reversal · net annual return', '原始反转 · 扣费后年化收益'),
    originalDrawdown: t('Original reversal · maximum drawdown', '原始反转 · 最大回撤'),
  }
  const names = {
    trend: t('Trend filter', '趋势过滤'),
    original: t('Original reversal', '原始反转'),
    trendMix: t('Trend fixed mix', '趋势固定配置'),
    originalMix: t('Original fixed mix', '原始固定配置'),
  }
  const pp = (x: number) => (100 * x).toFixed(2) + ' ' + t('pp', '个百分点')
  const primary = r.results.residual,
    s = r.results[metric],
    f = r.folds[fold]
  const val = metric === 'residual' ? pp : pct
  const peak = Math.max(...s.bins)
  const position = (v: number) =>
    s.max === s.min ? 0 : Math.max(0, Math.min(100, (100 * (v - s.min)) / (s.max - s.min)))
  const columns = [
    t('Observed', '实际'),
    t('Random median', '随机中位数'),
    t('Favorable percentile', '表现百分位'),
  ]
  const execCols = [
    t('Net annual return', '扣费后年化'),
    t('One month later', '延后一个月'),
    t('Max drawdown', '最大回撤'),
    t('Delayed drawdown', '延后回撤'),
  ]
  return (
    <>
      <div className="lab-mast">
        <h1>{t('Timing vs chance', '择时与随机对照')}</h1>
        <p>
          {r.start} — {r.end} · {r.folds.length} {t('test periods', '段样本外测试')}
        </p>
      </div>
      <section className="xp-summary" aria-label={t('Conditional timing result', '择时检验结果')}>
        <p>
          {t(
            'The trend filter added ',
            '扣除两组固定配置的收益差后，趋势过滤相对原始反转的费前年化增量为 ',
          )}
          <strong>{pp(primary.observed)}</strong>
          {t(' per year before fees, after accounting for the two fixed mixes.', '。')}
        </p>
        <p>
          <strong>
            {count(primary.matched)} / {count(r.draws)}
          </strong>
          {t(
            ' random schedules matched or exceeded that gain. The random median was ',
            ' 组随机时点达到或超过这个增量。随机中位数为 ',
          )}
          <strong>{pp(primary.median)}</strong>
          {t('.', '。')}
        </p>
      </section>
      <p className="xp-finding">
        {t(
          'Within each test period, both strategies kept their stock months and numbers of buys and sales. Only trade dates moved. The market followed its actual path.',
          '每段测试内，两种策略各自的持股月数、买入次数和卖出次数都固定，只移动交易时点。市场涨跌保持原有顺序。',
        )}
      </p>
      <section className="xp-chart" aria-label={t('Random schedule distribution', '随机时点分布')}>
        <div className="xp-chart-top">
          <h2>{t('Where the observed result falls', '实际结果排在哪里')}</h2>
          <label>
            {t('Measure', '指标')}{' '}
            <select
              aria-label={t('Measure', '指标')}
              value={metric}
              onChange={(e) => setMetric(e.target.value as Endpoint)}
            >
              {Object.entries(labels).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <figure className="timing-hist" aria-label={labels[metric]}>
          <div className="timing-key">
            <span>
              <i />
              {t('Observed', '实际')} <b>{val(s.observed)}</b>
            </span>
            <span>
              <i />
              {t('Random median', '随机中位数')} <b>{val(s.median)}</b>
            </span>
          </div>
          <div className="timing-bars" aria-hidden="true">
            {s.bins.map((n, i) => (
              <span key={i} style={{ height: (100 * n) / peak + '%' }} />
            ))}
            <i className="timing-median" style={{ left: position(s.median) + '%' }} />
            <i className="timing-observed" style={{ left: position(s.observed) + '%' }} />
          </div>
          <div className="timing-axis">
            <span>{val(s.min)}</span>
            <span>{val(s.max)}</span>
          </div>
          <figcaption>
            {t('Middle 95% of random results', '随机结果中间 95% 的范围')}{' '}
            <b>
              {val(s.low)} – {val(s.high)}
            </b>
            . {t('Taller bars contain more draws.', '柱越高，落入该区间的模拟次数越多。')}
          </figcaption>
        </figure>
        <p className="xp-chart-note">
          {count(s.matched)} / {count(r.draws)}{' '}
          {metric.endsWith('Drawdown')
            ? t('had an equal or smaller loss.', '次的回撤等于或小于实际回撤。')
            : t('matched or exceeded the observed return.', '次达到或超过实际收益。')}{' '}
          {t('One-sided Monte Carlo p', '单侧蒙特卡洛 p 值')} = {s.p.toFixed(4)}.
        </p>
      </section>
      <section className="xp-comparison">
        <h2>{t('Return and drawdown after fees', '扣费后的收益和回撤')}</h2>
        <p>
          {t(
            'Higher percentiles mean better outcomes, including smaller drawdowns. Ties receive half credit.',
            '百分位越高表示表现越好。回撤越小越好，并列时各计一半。',
          )}
        </p>
        <table aria-label={t('Observed strategy ranks', '真实策略排名')}>
          <thead>
            <tr>
              <th>{t('Strategy and measure', '策略与指标')}</th>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['trendReturn', 'trendDrawdown', 'originalReturn', 'originalDrawdown'] as const).map(
              (k) => (
                <tr key={k}>
                  <th scope="row">{labels[k]}</th>
                  {[
                    pct(r.results[k].observed),
                    pct(r.results[k].median),
                    r.results[k].percentile.toFixed(2),
                  ].map((v, i) => (
                    <td data-label={columns[i]} key={i}>
                      {v}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
        <p>
          {t(
            'Original reversal benefited more from its actual dates than the trend filter did. This is why the filter can rank highly on its own return while its incremental advantage ranks low.',
            '原始反转从实际交易日期中获得的收益提升更大。这解释了为什么趋势策略自身收益排名靠前，加上过滤后的增量却排名靠后。',
          )}
        </p>
      </section>
      <details className="xp-method">
        <summary>
          {t('Execution check · trade one month later', '成交假设检验 · 全部延后一个月')}
        </summary>
        <p>
          {t(
            'The base simulation applies a target calculated from completed months to the next monthly return. A separate replay delays every target one additional month and begins in cash. Both charge 0.10% per one-way trade.',
            '基准回测用已结束月份的数据计算仓位，赚取下一月的收益。另一次回放将所有目标仓位再延后一个月，首月持有现金。两种回放均按单向交易金额的 0.10% 收费。',
          )}
        </p>
        <div className="xp-comparison">
          <table aria-label={t('Execution lag sensitivity', '成交延迟敏感性')}>
            <thead>
              <tr>
                <th>{t('Portfolio', '组合')}</th>
                {execCols.map((c) => (
                  <th scope="col" key={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['trend', 'original', 'trendMix', 'originalMix'] as const).map((id) => (
                <tr key={id}>
                  <th scope="row">{names[id]}</th>
                  {[
                    r.actual[id].net,
                    r.delayed[id].net,
                    r.actual[id].drawdown,
                    r.delayed[id].drawdown,
                  ].map((v, i) => (
                    <td data-label={execCols[i]} key={i}>
                      {pct(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          {t('Gross incremental timing return', '费前择时增量')}{' '}
          <b>
            {pp(r.actual.residual)} → {pp(r.delayed.residual)}
          </b>
          .
        </p>
        <p>
          {t(
            'These are fixed monthly rules on a revised U.S. index series. The data contain no release timestamps, orders, quoted spreads or fill prices. A deep-learning forecast would need dated features and labels, training-only preprocessing and model selection, and later data held back from development.',
            '这里检验的是固定月度规则。修订后的美国市场指数序列缺少当时的数据发布时间、委托、买卖报价和成交价。若要检验深度学习预测，需要定义带时间戳的特征与标签，只在训练区间处理数据和选模型，并保留开发期间未查看的后续测试期。',
          )}
        </p>
      </details>
      <details className="xp-method">
        <summary>
          {t('Check the constraints for a test period', '核对每段测试的持仓与交易次数')}
        </summary>
        <p>
          {t(
            'Each pair keeps its entering and closing positions and the number of transitions between both in cash, filtered only in stocks, and both in stocks. Each legal arrangement is equally likely.',
            '每组路径保留期初与期末仓位，以及两者持币、仅过滤策略持股、两者持股之间的转换次数。每种合规排列被抽到的机会相同。',
          )}
        </p>
        <label>
          {t('Test period', '测试区间')}{' '}
          <select
            aria-label={t('Test period', '测试区间')}
            value={fold}
            onChange={(e) => setFold(Number(e.target.value))}
          >
            {r.folds.map((x, i) => (
              <option value={i} key={x.start}>
                {x.start} — {x.end}
              </option>
            ))}
          </select>
        </label>
        <ul>
          {rules.map((id) => (
            <li key={id}>
              {names[id]} · {f[id].stockMonths} / {f.months} {t('months in stocks', '个月持股')} ·{' '}
              {f[id].buys} {t('buys', '次买入')} · {f[id].sales} {t('sales', '次卖出')}
            </li>
          ))}
        </ul>
        <p>
          {f.choices}{' '}
          {t(
            'possible paired schedules in this period. Across the full study, ',
            '种可行的成对路径。全部测试中有 ',
          )}
          {r.folds.filter((x) => x.choices === 1).length} / {r.folds.length}{' '}
          {t('periods had only one arrangement.', '段仅有一种排列。')}
        </p>
        <p>
          {t(
            'The median reflects the constraints and need not be zero. Counts are known only after each period. The test cannot assign a percentage of the observed return to luck or establish performance on new markets.',
            '随机中位数由这些约束决定，可以偏离零。各段交易次数到期末才知道。这项检验无法把实际收益按比例分成运气和能力，也无法验证新市场上的表现。',
          )}
        </p>
        <div className="xp-links">
          <a href="https://github.com/Chencharl/Trade_bo/blob/main/docs/STRATEGY_TIMING_TEST.md">
            {t('Protocol and checks', '研究方案与验证')}
          </a>
          <a href={file} download>
            {t('Download results (JSON)', '下载结果（JSON）')}
          </a>
        </div>
      </details>
    </>
  )
}
const valid = (r: TimingStudy) =>
  Boolean(
    r.draws === 10000 && r.folds?.length && r.results?.residual?.bins?.length && r.delayed?.trend,
  )
export default function TimingTestPage() {
  return (
    <HistoricalStudyPage
      file={file}
      version="timing-null-1"
      valid={valid}
      render={(r, t) => <Results r={r} t={t} />}
    />
  )
}

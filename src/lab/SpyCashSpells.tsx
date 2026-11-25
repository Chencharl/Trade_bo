import {
  money,
  signedMoney,
  pct as percent,
  signedPercent,
  type Text,
  type Spell,
  type CashStudy,
  type SpyReport,
} from './spyDaily'

export function CashInspector({
  s,
  t,
  kind,
  end,
}: {
  s: Spell
  t: Text
  kind: 'model' | 'trend'
  end: string
}) {
  const owner = s[kind]
  return (
    <section
      className="cash-inspector"
      aria-label={t('Selected cash spell', '所选空仓区间')}
      aria-live="polite"
    >
      <div className="cash-caption">
        <div>
          <span>
            {kind === 'model'
              ? t('Model in cash', '模型空仓')
              : t('Trend filter in cash', '趋势过滤空仓')}{' '}
            · {s.days} {t(s.days === 1 ? 'session' : 'sessions', '个交易日')}
          </span>
          <h3>
            {s.exit} <span>→</span> {s.reentry ?? end}
          </h3>
        </div>
        <div>
          <span>{t('Effect on ending balance', '对期末净值的贡献')}</span>
          <strong className={s.endingEffect > 0 ? 'cash-plus' : 'cash-minus'}>
            {signedMoney(s.endingEffect)}
          </strong>
        </div>
      </div>
      <div className="cash-moves">
        <div>
          <span>{t('SPY declines avoided', '避开的 SPY 下跌')}</span>
          <b>{percent(s.avoided)}</b>
        </div>
        <div>
          <span>{t('SPY gains missed', '错过的 SPY 上涨')}</span>
          <b>{percent(s.missed)}</b>
        </div>
        <div>
          <span>{t('Trading costs', '区间交易成本')}</span>
          <b>{money(owner.commission + owner.slippage)}</b>
        </div>
      </div>
      <p className="cash-comparison">
        {t('Over these same opens, the model returned ', '同期开盘到开盘，模型收益为 ')}
        <b>{signedPercent(s.model.net)}</b>
        {t(' and the trend filter returned ', '，趋势过滤为 ')}
        <b>{signedPercent(s.trend.net)}</b>
        {t('. The trend filter held SPY for ', '。趋势过滤在其中持股 ')}
        {s.trendStockDays}/{s.days}
        {t(' sessions.', ' 天。')}
      </p>
      <details>
        <summary>{t('How this exit adds up', '查看这次归因的计算')}</summary>
        <p>
          {t(
            'Declines and gains sum the daily moves of one SPY share between the two opens, including dividends, as a percentage of its exit price. The window ends at the final close if there is no repurchase.',
            '从卖出开盘到买回开盘，以一股 SPY 的卖出开盘价为分母，将含股息的逐日下跌和上涨分别相加。期末仍空仓时，以最后收盘价结算。',
          )}
        </p>
        <p>
          {t('Window costs include commission of ', '区间手续费为 ')}
          {money(owner.commission)}
          {t(' and slippage of ', '，滑点为 ')}
          {money(owner.slippage)}
          {t(
            '. Both account returns include any fills at either boundary.',
            '。两组同期收益均计入区间两端的成交成本。',
          )}
        </p>
        <p>
          {t(
            'Starting from buy-and-hold, replay each exit in date order. Adding this one changed the ending balance by ',
            '以买入持有为起点，按日期依次加入空仓。本次令期末净值变化 ',
          )}
          {signedMoney(s.endingEffect)}
          {t(' (zero-cost replay: ', '（零成本重跑为 ')}
          {signedMoney(s.grossEffect)}
          {t('). Its change to maximum drawdown was ', '）。本次使最大回撤深度变化 ')}
          {(s.drawdownEffect > 0 ? '+' : '') + (100 * s.drawdownEffect).toFixed(2)}{' '}
          {t('pp. Later compounding is included.', '个百分点，期末贡献包含后续复利。')}
        </p>
      </details>
    </section>
  )
}

export function AttributionNotes({
  a,
  r,
  t,
  select,
}: {
  a: CashStudy
  r: SpyReport
  t: Text
  select: (s: Spell) => void
}) {
  const es = a.spells.model,
    ranked = [...es].sort((x, y) => y.endingEffect - x.endingEffect)
  const best = ranked[0],
    second = ranked[1],
    worst = ranked[ranked.length - 1]
  const sum = (events: Spell[], key: 'grossEffect' | 'endingEffect') =>
    events.reduce((n, s) => n + s[key], 0)
  const net = sum(es, 'endingEffect'),
    top = best.endingEffect + second.endingEffect
  const grossGap = sum(es, 'grossEffect') - sum(a.spells.trend, 'grossEffect')
  const netGap = r.metrics.model.ending - r.metrics.trend.ending
  const beforeTrough = es.filter((s) => s.exit <= r.metrics.model.trough)
  const ddWorst = [...beforeTrough].sort((x, y) => y.drawdownEffect - x.drawdownEffect)[0]
  const show = (s: Spell, label: string) => (
    <button type="button" className="cash-jump" onClick={() => select(s)}>
      {label} ↗
    </button>
  )
  return (
    <section className="cash-notes" aria-label={t('What drove the result', '收益与回撤的来源')}>
      <article>
        <h3>{t('Two April exits carried the gain', '收益主要来自四月的两次减仓')}</h3>
        <p>
          {show(best, best.exit)} {t('and', '和')} {show(second, second.exit)}{' '}
          {t('added ', '合计为期末账户增加 ')}
          <b>{money(top)}</b>
          {t(' to the ending balance. The other ', '。其余 ')}
          {es.length - 2}
          {t(' exits together contributed ', ' 段合计贡献 ')}
          <b>{signedMoney(net - top)}</b>
          {t('.', '。')}
        </p>
        <p>
          {t('Costliest exit', '期末损失最大的一段')} ·{' '}
          {show(worst, worst.exit + ' ' + signedMoney(worst.endingEffect))}
        </p>
      </article>
      <article>
        <h3>{t('The deepest loss came in 2022', '最大回撤发生在 2022 年')}</h3>
        <p>
          {t('SPY and the model reached their drawdown trough on ', 'SPY 和模型都在 ')}
          {r.metrics.model.trough}
          {t(
            '. The model had already missed part of the recovery on ',
            ' 触底。模型在此之前错过了部分上涨，影响最大的是 ',
          )}
          {show(ddWorst, ddWorst.exit)}
          {t('. Adding that exit deepened maximum drawdown by ', ' 这段空仓，使最大回撤加深 ')}
          <b>
            {(ddWorst.drawdownEffect * 100).toFixed(2)} {t('pp', '个百分点')}
          </b>
          {t(' in the replay.', '。')}
        </p>
      </article>
      <article>
        <h3>{t('Trading costs changed the winner', '交易成本改变了排名')}</h3>
        <p>
          {t(
            'With free fills, the model beat the trend filter by ',
            '零成本重跑时，模型领先趋势过滤 ',
          )}
          <b>{money(grossGap)}</b>
          {t(
            '. Trading costs and their compounding cut this lead by ',
            '。手续费、滑点及其复利影响使两者差距向下移动 ',
          )}
          <b>{money(grossGap - netGap)}</b>
          {t('. The trend filter exited once, on ', '。趋势过滤仅减仓一次，于 ')}
          {show(a.spells.trend[0], a.spells.trend[0].exit)}
          {t('. During that spell SPY lost ', '。这段空仓期间 SPY 净跌 ')}
          {percent(a.spells.trend[0].avoided - a.spells.trend[0].missed)}
          {t(' between opens.', '（开盘到开盘）。')}
        </p>
      </article>
    </section>
  )
}

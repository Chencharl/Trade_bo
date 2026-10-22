import { useMemo } from 'react'
import type { Dataset } from './data'
import type { LabEvaluation, MonthlyRow } from './engine'
import { evaluateRiskAudit } from './risk'

const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
const gap = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)} pp`
const count = (numerator: number, denominator: number) =>
  denominator === 0 ? '—' : `${numerator} / ${denominator}`

export default function RiskAudit({
  rows,
  evaluation,
  datasetKind,
}: {
  rows: MonthlyRow[]
  evaluation: LabEvaluation
  datasetKind: Dataset['kind']
}) {
  const audit = useMemo(() => evaluateRiskAudit(rows, evaluation), [rows, evaluation])
  const selected = audit.rules.find((rule) => rule.id === evaluation.config.selectedStrategy)!
  const { horizonMonths, lossThreshold, warningWeight } = audit.protocol
  return (
    <section className="lab-risk" aria-labelledby="risk-audit-title">
      <div className="lab-section-heading">
        <div>
          <span className="lab-kicker">
            {datasetKind === 'synthetic'
              ? 'SYNTHETIC DOWNSIDE CHECK'
              : 'IMPORTED-DATA DOWNSIDE CHECK'}{' '}
            · {audit.version}
          </span>
          <h2 id="risk-audit-title">Did lower exposure precede losses?</h2>
        </div>
        <span>
          {selected.eligibleMonths} COMPLETE WINDOWS · {selected.censoredMonths} CENSORED
        </span>
      </div>
      <p className="lab-risk-definition">
        Warning: market exposure ≤{warningWeight * 100}% at month start. Outcome: a month-end market
        loss of ≥{lossThreshold * 100}% from that opening wealth within {horizonMonths} months.
      </p>
      <h3>{selected.name} · inspected rule</h3>
      <dl className="lab-risk-counts">
        <div>
          <dt>Loss windows covered</dt>
          <dd>
            <span data-testid="risk-covered">
              {count(selected.truePositive, selected.eventWindows)}
            </span>
            <small>Warnings / all loss windows</small>
          </dd>
        </div>
        <div>
          <dt>False alarms</dt>
          <dd>
            <span data-testid="risk-false-alarms">
              {count(selected.falsePositive, selected.warningMonths)}
            </span>
            <small>No defined loss / all warnings</small>
          </dd>
        </div>
        <div>
          <dt>Loss windows missed</dt>
          <dd>
            <span data-testid="risk-missed">
              {count(selected.falseNegative, selected.eventWindows)}
            </span>
            <small>No warning / all loss windows</small>
          </dd>
        </div>
      </dl>
      <div className="lab-risk-context">
        <p>
          At warning, median existing market drawdown was{' '}
          <strong data-testid="risk-prior-dd">{percent(selected.medianWarningDrawdown)}</strong>.
          Hits reached the threshold after a retrospective median{' '}
          <strong data-testid="risk-lead">
            {selected.medianLeadMonths === null ? '—' : `${selected.medianLeadMonths} months`}
          </strong>
          .
        </p>
        <p>
          In {selected.upMarketMonths} rising-market months, this rule's average net gap versus
          Market was <strong data-testid="risk-up-gap">{gap(selected.meanUpMarketGap)}</strong> per
          month. Negative values show forgone returns.
        </p>
      </div>
      <div
        className="lab-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Scroll downside warning comparison"
      >
        <table aria-label="Downside warning comparison">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Warnings / windows</th>
              <th scope="col">Covered / losses</th>
              <th scope="col">False alarms / warnings</th>
              <th scope="col">Missed / losses</th>
              <th scope="col">Up-market gap / month</th>
            </tr>
          </thead>
          <tbody>
            {audit.rules.map((rule) => (
              <tr key={rule.id} className={rule.id === selected.id ? 'selected' : ''}>
                <th scope="row">
                  {rule.name}
                  {rule.id === selected.id && <span className="lab-current">Inspected</span>}
                </th>
                <td>{count(rule.warningMonths, rule.eligibleMonths)}</td>
                <td>{count(rule.truePositive, rule.eventWindows)}</td>
                <td>{count(rule.falsePositive, rule.warningMonths)}</td>
                <td>{count(rule.falseNegative, rule.eventWindows)}</td>
                <td>{gap(rule.meanUpMarketGap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lab-footnote">
        Cash always warns; Market never warns. Overlapping windows are not independent events.{' '}
        {selected.censoredMonths} incomplete horizons excluded. Retrospective diagnostic, not a live
        alert or forecast.
      </p>
      <details className="lab-risk-ledger">
        <summary>Inspect monthly downside evidence</summary>
        <p className="lab-footnote">
          {selected.name} · {audit.window.start} to {audit.window.end}. Targets use completed months
          only. Monthly timing is modeled; imported data availability is unverified. The following
          market outcomes were observed afterward. Loss is measured from each decision's opening
          wealth, not a peak-to-trough crash definition. Existing drawdown measures the market's
          loss from its prior peak at the signal month; it shows how much loss had already occurred.
          The last {selected.censoredMonths} months lack a complete {horizonMonths}-month horizon.
          Counts refer to overlapping windows, not separate crashes. — means no eligible denominator
          or observations. Cash can cover every loss by warning continuously; coverage alone does
          not show useful timing. Up-market gaps above compare strategy and Market net returns after
          costs across all 60 reserved months with a positive raw market return.
        </p>
        <div
          className="lab-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Scroll monthly downside evidence"
        >
          <table aria-label="Monthly downside evidence">
            <thead>
              <tr>
                <th scope="col">Signal month (modeled)</th>
                <th scope="col">First return month</th>
                <th scope="col">Horizon ends</th>
                <th scope="col">Market target</th>
                <th scope="col">Prior drawdown</th>
                <th scope="col">Worst forward return</th>
                <th scope="col">Months to loss</th>
                <th scope="col">Observed outcome</th>
              </tr>
            </thead>
            <tbody>
              {selected.ledger.map((row) => (
                <tr key={row.firstReturnMonth}>
                  <th scope="row">{row.signalDate}</th>
                  <td>{row.firstReturnMonth}</td>
                  <td>{row.endMonth}</td>
                  <td>{percent(row.targetWeight)}</td>
                  <td>{percent(row.drawdownAtSignal)}</td>
                  <td>{percent(row.forwardWorstReturn)}</td>
                  <td>{row.monthsToLoss ?? '—'}</td>
                  <td>
                    {row.warning
                      ? row.lossWithinHorizon
                        ? 'Warning + loss'
                        : 'False alarm'
                      : row.lossWithinHorizon
                        ? 'Missed loss'
                        : 'No warning / no loss'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="lab-footnote">
          Recompute this check from the exported research run.{' '}
          <a
            href="https://github.com/Chencharl/Trade_bo/blob/main/docs/STRATEGY_RISK.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the definitions and reproduction steps ↗
          </a>
        </p>
      </details>
    </section>
  )
}

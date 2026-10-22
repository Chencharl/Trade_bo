# Downside diagnostic validation

October 22, 2026 · `risk-audit-1` · [Definitions and limits](STRATEGY_RISK.md)

This milestone adds a test of the risk-warning idea, not a validated early-warning method. The existing strategy engine and its `lab-2` report contract are unchanged.

## Tester's findings

A constructed rising market followed by one sudden 20% monthly fall produces six overlapping loss windows under the fixed protocol. Trend following and breakout do not flag those windows in advance. Their later defensive positions must not receive credit for predicting that drop. Always-defensive Cash covers all six, but also flags the other 49 windows. These controls expose the difference between avoiding exposure and useful timing.

The default synthetic sample has six defined loss windows out of 55 complete starts. Trend covers three, misses three, and has 21 flagged windows without a defined loss. These are teaching-data outcomes, not market evidence.

## Retrospective imported-data check

The already-inspected French research snapshot contains 1,202 months, July 1926–August 2026; normalized SHA-256 `e61f04dcafa03fb9da8276944d7838d9972d178597261e0d1d66ca52cd4c8afc`. It is a revised research proxy with unverified point-in-time availability. No third-party data are distributed. [Source definitions](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_factors.html).

The reserved window is September 2021–August 2026, with 55 complete six-month starts and five censored starts. Exactly three starts meet the fixed loss definition; they are overlapping observations, not three independent crashes. At 10 bps trading cost:

| Rule                 | Flagged windows | Covered / loss windows | False alarms | Missed loss windows | Median prior drawdown at flag | Mean up-month net gap |
| -------------------- | --------------: | ---------------------: | -----------: | ------------------: | ----------------------------: | --------------------: |
| Market               |               0 |                  0 / 3 |            0 |                   3 |                             — |              0.000 pp |
| Cash                 |              55 |                  3 / 3 |           52 |                   0 |                        2.800% |             −3.899 pp |
| 60/40 market/cash    |               0 |                  0 / 3 |            0 |                   3 |                             — |             −1.561 pp |
| Trend following      |              14 |                  2 / 3 |           12 |                   1 |                       14.287% |             −1.636 pp |
| Absolute momentum    |              14 |                  0 / 3 |           14 |                   3 |                       14.698% |             −1.105 pp |
| Short-term reversal  |              38 |                  1 / 3 |           37 |                   2 |                        0.000% |             −2.091 pp |
| Volatility targeting |              12 |                  0 / 3 |           12 |                   3 |                       14.551% |             −1.289 pp |
| 12-month breakout    |              30 |                  2 / 3 |           28 |                   1 |                        8.391% |             −2.790 pp |

Up-month gaps are unannualized arithmetic means over the 35 positive gross-market months of the full 60-month window, using each rule's net return minus Market's net return. False alarms use the exact 15%/six-month definition. Partial exposure above 50% can still reduce losses without producing a flag under this binary convention. The table does not rank overall risk protection.

In this sample, trend warnings often occur after substantial losses, while Cash illustrates the cost of being defensive continuously. The earlier [return/drawdown comparison](VALIDATION.md) remains relevant: reducing loss severity and giving an early warning are different outcomes. Neither this small inspected sample nor a high coverage fraction supports a calibrated crash probability or a live trading claim.

## Reproducibility

The command `npm run audit:risk -- report.json` verifies the complete input report, then freshly recomputes its allocation ledgers before applying binary risk thresholds. Review found that a rounding difference accepted by report comparison could otherwise change a target's 50% classification. A regression test now verifies that such a difference cannot alter the audit. The browser reads the same versioned diagnostic from its current evaluation, and date-by-date evidence remains inspectable.

An independent Python calculation reconciled all 440 eligible rule-window records and all eight up-market return gaps in the imported-data check. This establishes arithmetic agreement on that snapshot; it does not authenticate source availability or investment effectiveness.

70 TypeScript calculation/import/report/CLI tests, 13 Python desk tests, and 84 browser cases passed. New tests cover exact thresholds, sudden-drop misses, censored outcomes, undefined denominators, future-data perturbations, numerical extremes, source labels, report-derived UI values, and expanded evidence accessibility at 320 pixels. Desktop and mobile renders were inspected. The production build and formatting checks pass.

Next research work remains frozen experiments and trial history, followed by appropriate point-in-time data. Independent episode definitions, false-alarm duration, pre-decline versus post-decline classification, and prospective observations are required before stronger warning claims.

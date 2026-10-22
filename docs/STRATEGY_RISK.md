# Downside-warning research

Protocol `risk-audit-1` · October 22, 2026 · [Product goal](PRODUCT_GOAL.md)

The research question is whether earlier observations under the modeled monthly decision timing help identify subsequent severe losses, and whether reducing exposure improves outcomes after costs. Advance warning and loss reduction are separate claims. The current diagnostic tests existing rules; it does not issue a live warning or certify crash prediction.

## Fixed first test

These conventions are fixed for this diagnostic, not optimized on its results. The histories have already been inspected in other research; this is an exploratory audit, not a newly untouched confirmation sample.

| Item              | Definition                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Methods           | All eight existing fixed rules, including always-invested Market, always-defensive Cash, and 60/40 market/cash. No winner is selected by these diagnostics.                                                                                                                                                                                                                                                                      |
| Window            | The same final 60 months already evaluated by Strategy Lab.                                                                                                                                                                                                                                                                                                                                                                      |
| Exposure flag     | Market target weight at or below 50%, decided using completed months before the first return in the outcome window. A flag is a research proxy for defensive positioning, not a probability estimate.                                                                                                                                                                                                                            |
| Loss outcome      | At least a 15% decline from market wealth at the decision boundary to any of the next six month-end levels. Use gross market returns for the label. This is a forward loss from a fixed starting level, not a peak-to-trough crash definition.                                                                                                                                                                                   |
| Complete outcomes | The 55 starts with six observed returns. The final five starts are excluded from all classification and timing statistics, even if a loss is already visible in their partial follow-up.                                                                                                                                                                                                                                         |
| Timing            | The signal date is the previous completed month: a modeled observation boundary, not a verified publication or live-warning timestamp. Strict row lag does not establish that imported data were available at that date. Lead time is 1–6 monthly return periods to the first threshold breach. A breach in the first month counts as one return period; it does not establish a month's advance warning of an intramonth crash. |
| Prior losses      | Drawdown at the signal uses only market history preceding the decision, including history before the reserved window. Show its median across flagged windows and each monthly value so reactive de-risking is visible.                                                                                                                                                                                                           |
| Upside tradeoff   | Across all 60 reserved months where the gross market return is positive, average the rule's net monthly return minus Market's net monthly return. A negative gap means foregone gains in those months. It is an arithmetic monthly comparison, not cumulative wealth lost or a six-month forecast.                                                                                                                               |

Repeated flags are counted as monthly decisions. Six-month outcomes overlap and can describe the same underlying decline many times. They are not independent crash episodes. All methods use the same outcome dates; the signal threshold does not alter their actual positions, trades, returns, or costs.

## Counts and interpretation

For complete windows, count flagged/loss, flagged/no-loss, unflagged/loss, and unflagged/no-loss. "False alarm" means no loss meeting this exact threshold within this exact horizon; it does not by itself establish that the defensive decision was unreasonable.

- Warning precision = flagged loss windows / all flagged windows.
- Loss-window coverage = flagged loss windows / all loss windows.
- False-alarm rate = flagged no-loss windows / all no-loss windows.
- Misses = unflagged loss windows.

Undefined ratios and timing statistics remain blank. Never convert them to zero or interpret an absence of observed loss windows as evidence of safety. Always-defensive Cash can cover every loss window by flagging all the time, so coverage alone cannot demonstrate timing skill. Market and Cash deliberately expose these trivial extremes.

The existing net-return, drawdown, turnover, and cash comparisons remain necessary. A useful protective policy must be assessed alongside missed rallies, rebounds, transaction costs, and long periods out of the market. The fixed 15%/six-month/50% choices are research conventions, not universal investment thresholds.

## Reproduce

Export a research run in Strategy Lab, then run:

```bash
npm run audit:risk -- tradebo-strategy-lab.json
```

The command first verifies the complete `lab-2` report, then recomputes this independently versioned diagnostic. It reports the dataset kind and canonical hash. It does not change the report format or strategy selection. Use a source release containing `risk-audit-1`; older `lab-2` exports can supply the same inputs. Source authenticity, data availability at the time, and investment merit remain unverified.

## What is still needed before an early-warning claim

1. Freeze and register hypotheses, thresholds, data vintages, forecast horizons, and every trial before evaluating new periods. An inspected window cannot be recycled as untouched validation.
2. Define independent decline episodes and distinguish signals before the decline starts from signals after a selloff has begun. Report misses, false-alarm duration, lead times, costs, and rebound participation; retain zero-event and adverse results.
3. Acquire appropriately licensed, point-in-time daily market and cash data before testing faster responses. Add breadth, credit, options, or liquidity signals only with historical availability timestamps and independent fixtures. Monthly snapshots cannot establish intramonth warning or executable fills.
4. Evaluate across distinct regimes and collect prospective observations. Compare against simple exposure controls as well as buy-and-hold. If probabilities are introduced, test calibration and base rates separately from event coverage.

The Federal Reserve distinguishes monitorable vulnerabilities from difficult-to-predict shocks. BIS early-warning research emphasizes false alarms, timing uncertainty, and the difference between crisis coverage and probability conditional on a warning. Its banking-crisis horizons and thresholds are not evidence for stock-market crash prediction. [Federal Reserve framework](https://www.federalreserve.gov/publications/2026-may-financial-stability-report-purpose-and-framework.htm), [BIS interpretation of early-warning indicators](https://www.bis.org/publications/what-do-ewis-tell-us).

Risk control also needs direct out-of-sample evaluation. Cederburg et al. find that volatility-managed portfolios do not systematically outperform unmanaged portfolios in their broad comparison, and that in-sample regression evidence does not ensure implementable gains. This supports testing costs and stability; it does not validate or invalidate TradeBo's particular rules. [Original paper](https://www.lehigh.edu/~xuy219/research/COWY.pdf).

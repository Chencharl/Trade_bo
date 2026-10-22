# Research foundation validation

October 22, 2026 · engine `lab-2` · product goal: [strategy research platform](PRODUCT_GOAL.md).

## Findings and changes

| Tester finding                                                                                   | Change                                                                                       | Evidence                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A constantly declining market could win over cash-like rules because their Sharpe was undefined. | Explicit Cash abstention when no rule has a positive, finite training excess Sharpe.         | Generated declining, flat, positive, tied-score, and crash-to-cash fixtures. A transition to Cash pays its actual exit cost.                |
| The automatic development result lacked baselines on the same dates.                             | Continuous Market, Cash, and 60/40 ledgers alongside the selector.                           | Independent monthly accounting; identical calendars at 156, 157, and 432 input months; no repeated entry fee at fold boundaries.            |
| Exported reports had no supplied recomputation tool.                                             | Offline report verifier with version, rules, canonical hash, and complete-result comparison. | JSON round trip and rejection of changed returns, rules, scores, allocations, omitted ledgers, invalid costs, and wrong versions.           |
| Refresh replaced edited desk portfolio inputs with defaults.                                     | Refresh passes the current model and symbols to recalculation.                               | Synthetic browser journey edits holdings, cash, targets, limits, and symbols, then checks fresh prices/NAV and preservation of those edits. |

## What the experiments show

The constructed 156-month declining-market case uses −1% market return each month and zero cash return. With a 10 bps cost, the old selector chose Market despite negative training excess returns. The new policy stays in Cash with zero return and turnover. This tests an explicit policy; it does not show that staying in cash will be optimal in a different future.

The shipped synthetic dataset gives the following net annualized returns at 10 bps. All methods in each row use identical dates and initialization:

| Window                         |  Automatic method |  Market |   Cash | 60/40 market/cash |
| ------------------------------ | ----------------: | ------: | -----: | ----------------: |
| Development tests, 1997–2020   |            2.905% | −2.462% | 2.734% |           −0.070% |
| Reserved evaluation, 2021–2025 | 1.550% (Breakout) | −5.678% | 1.854% |           −2.546% |

The frozen rule trails Cash in the reserved synthetic window. The evaluator must show this result plainly; it is not a reason to tune the demonstration until the rule wins. Synthetic outcomes are not market evidence.

A retrospective compatibility check also imported the official French file with 1,202 months, July 1926–August 2026. Its normalized SHA-256 was `e61f04dcafa03fb9da8276944d7838d9972d178597261e0d1d66ca52cd4c8afc`. No source data is distributed here. On that revised research snapshot, the frozen Momentum rule returned 10.480% annualized in September 2021–August 2026 versus Market's 11.706%, with maximum drawdowns of 16.580% and 24.845%, respectively. This shows a conditional risk/return tradeoff, not universal superiority or executable performance. The window has been inspected and cannot be represented as an untouched future confirmation. [Source definitions](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_factors.html).

## Checks completed

55 TypeScript calculation/import/replay tests, 13 Python desk tests, and 75 browser cases across Chromium, Firefox, and WebKit passed. Checks include expanded evidence-table accessibility, keyboard navigation, 320-pixel layout, and UI/export/recomputation agreement. Desktop and mobile renders were inspected. These checks establish the tested implementation behavior, not investment performance.

## Reproduce and interpret

Run `npm test` for calculation/import/replay checks and `npm run test:e2e` for browser journeys. Existing desk contracts use `python3 -m unittest discover -s tests -v`. Export the default synthetic experiment and run `npm run verify:report -- report.json` for a complete recalculation.

The calculation contract fixes the rules, dates, costs, cash policy, and comparison tolerance. Report metadata and data hashes are not source authentication. A passing software test or replay does not establish investment profitability. Browser report reopening, a frozen-trial register, broader data coverage, and selection-adjusted inference remain future work.

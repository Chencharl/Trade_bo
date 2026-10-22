# Strategy Lab: calculation and evidence contract

Strategy Lab compares eight fixed allocation rules using monthly market and cash total returns. It is available at [`#lab`](https://chencharl.github.io/Trade_bo/#lab). It is separate from [Atlas's illustrative future-path simulation](ATLAS_MODEL.md) and the [local equity research desk](RESEARCH_DESK.md).

The default dataset is generated synthetic data, not market history. Users can import a local return CSV or a supported Kenneth French file. Third-party market datasets are not bundled. Results are exploratory: the final window is excluded from automated selection, but showing it does not make it permanently unseen or validate a profitable strategy.

The implementation has its own `LAB_VERSION`. A change to numerical behavior, rules, timing, selection, parsing, or uncertainty calculations requires a version change and updated checks. Atlas's model version remains a separate contract.

The [downside-warning diagnostic](STRATEGY_RISK.md) is a separate derived analysis with version `risk-audit-1`. It reads the existing `lab-2` inputs and ledgers; its fixed loss-window definitions leave allocation rules, evaluation results, and the report schema unchanged. Use `npm run audit:risk -- report.json` to verify the input report and reproduce the diagnostic.

## Inputs and provenance

Each row has a month, a market total return, and a cash total return. Returns are simple decimal returns: `0.02` means 2%; `-0.03` means -3%. Cash is a return-bearing sleeve, not an assumed zero-return balance or a bond index.

Generic CSV uses this header and date format:

```csv
date,market_return,cash_return
2000-01,0.0200,0.0030
2000-02,-0.0300,0.0028
2000-03,0.0150,0.0029
```

The three rows illustrate the format; they are not a valid evaluation dataset. An import requires:

- **156–1,500 consecutive monthly observations**, sorted chronologically with unique `YYYY-MM` dates. Missing months and duplicate dates are rejected rather than filled or silently combined.
- Finite returns strictly greater than `-1` and no greater than `10` in each sleeve. These are supported input bounds, not a statement about plausible market returns. Non-finite compounded results are rejected.
- A user-entered source label of 3–200 characters for generic CSV. The label describes the user's source claim; it is not independently verified. An unspecified provider vintage remains unknown.
- UTF-8 CSV or a supported ZIP, no larger than 2 MiB. A ZIP must contain one top-level CSV using stored or DEFLATE compression; its expanded CSV also must fit within 2 MiB.

Files are processed locally in the browser. Importing a file does not upload it. The export includes the SHA-256 of the original uploaded bytes and the SHA-256 of the canonical monthly rows. These answer different questions: whether the file itself changed and whether the normalized calculation inputs changed. ZIP and extracted CSV representations can have different raw hashes while yielding the same canonical rows.

The canonical hash uses UTF-8 bytes of `JSON.stringify` on the ordered row array, with each object containing `date`, `marketReturn`, and `cashReturn` in that property order. Synthetic data has a canonical-row hash and no imported-file hash.

Imported rows and their metadata are included in the experiment report so its owner can reproduce the calculation. Before distributing such a report, the owner must have the relevant data rights. A source label or hash is not evidence of redistribution permission.

## Kenneth French files and data vintages

The supported source is the monthly **Fama/French 3 Research Factors** CSV, directly or inside [`F-F_Research_Data_Factors_CSV.zip`](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip). The parser recognizes the `Mkt-RF,SMB,HML,RF` header and six-digit monthly dates. It reads the monthly section and stops at the explicit annual-section boundary. It does not concatenate annual observations with monthly observations.

French file values are percentages. For each monthly row:

```text
marketReturn = (Mkt-RF + RF) / 100
cashReturn   = RF / 100
```

`Mkt-RF` is an excess return, so treating it directly as the market total return would omit the cash-rate component. `SMB` and `HML` identify the supported file structure but are not traded or used by these market/cash rules. The market series is a research aggregate of qualifying US CRSP equities, not the return of a particular ETF. The published `RF` source changes from Ibbotson Associates through May 2024 to the ICE BofA US 1-Month Treasury Bill Index starting June 2024. [Official factor definitions](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_factors.html)

The data library moved from CRSP FIZ to CIZ with the January 2025 data release. Its description distinguishes month-end dividend reinvestment in FIZ from daily compounding with ex-date reinvestment in CIZ. The library reconstructs histories and notes that historical returns can change with source revisions. A newly downloaded file is therefore a revised research vintage, not proof of the data available to a trader at each historical date. The methodology vintage must not be inferred merely from whether a row's date is before or after 2025. [Data library and CIZ description](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html), [CRSP revision notes](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/changes_crsp.html)

The importer retains up to 500 characters of the French preamble as declared source information. This text and the file hash help identify the import; they do not certify a point-in-time vintage. Invalid numeric values, missing-value sentinels, duplicate months, and gaps are rejected.

The repository's MIT license covers its code, not French/CRSP data or other provider content. A publicly downloadable research file is not an MIT grant. Users obtain the source file themselves, and the dataset remains subject to its provider's terms. No third-party source file is committed or served with the application. [Official source and copyright notice](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/changes_crsp.html)

## Timing and eight fixed rules

Let `r_m,t` and `r_f,t` be market and cash returns for month `t`. Let `P_t` be the market total-return wealth index after month `t`, initialized to 1 before the first observation:

```text
P_t = product over j <= t of (1 + r_m,j)
```

The target market weight `w_t` is set before applying month `t`'s returns. It can use only observations through `t-1`. Remaining weight `1-w_t` earns the cash return. Weights stay between 0 and 1; there is no shorting or leverage.

| Declared order | Rule       | Target market weight before month `t`                                                                                                                |
| -------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1              | Market     | `1`                                                                                                                                                  |
| 2              | Cash       | `0`                                                                                                                                                  |
| 3              | Balanced   | `0.6`; the remaining `0.4` is cash, not bonds                                                                                                        |
| 4              | Trend      | `1` if `P_(t-1)` is strictly above the mean of the ten completed levels `P_(t-10)` through `P_(t-1)`; otherwise `0`                                  |
| 5              | Momentum   | `1` if compounded market growth over months `t-12` through `t-1` is strictly greater than compounded cash growth over the same months; otherwise `0` |
| 6              | Reversal   | `1` if the cumulative market total return over months `t-3` through `t-1` is negative; otherwise `0`                                                 |
| 7              | Volatility | `min(1, 0.10 / (sampleSD(r_m,t-12 ... r_m,t-1) × sqrt(12)))`; zero sample SD gives weight `1`                                                        |
| 8              | Breakout   | `1` if `P_(t-1)` is strictly above the maximum of the 12 preceding completed levels `P_(t-13)` through `P_(t-2)`; otherwise `0`                      |

Sample SD uses the `n-1` denominator. The volatility target is an input to an exposure rule, not a guarantee of subsequent realized risk. The parameters above are fixed descriptors, not a hidden grid search. These rules illustrate five broad method families alongside three baselines; they do not implement every method within those families.

This is a stylized monthly allocation model. Strict information lag prevents the implemented rule from reading the traded month's return. It does not supply an executable opening price, intramonth liquidity, order acceptance, or point-in-time source data. Fees summarize one modeled friction; there is no broker/order simulator.

## Turnover, fees, and holdings drift

Every standalone evaluation begins with wealth `1` fully in cash. Its first allocation pays the configured one-way fee. There is no forced liquidation at the final endpoint.

For an existing position, the previous target drifts with the prior month's market and cash returns. The pre-trade market weight in month `t` is:

```text
driftWeight_t = w_(t-1) × (1 + r_m,t-1)
                / [1 + w_(t-1) × r_m,t-1 + (1-w_(t-1)) × r_f,t-1]
```

The first month's `driftWeight` is zero. Costs and net returns are then:

```text
turnover_t  = abs(w_t - driftWeight_t)
feeRate_t   = turnover_t × feeBps / 10,000
grossFactor = 1 + w_t × r_m,t + (1-w_t) × r_f,t
netReturn_t = (1-feeRate_t) × grossFactor - 1
wealth_t    = wealth_(t-1) × (1 + netReturn_t)
```

Turnover is the fraction of portfolio value shifted between the two sleeves. It is not the sum of both sleeve changes, which would count the same transfer twice. A fixed 60% target can incur further turnover because its actual weight drifts between rebalances. The supported fee input is 0–100 basis points, with a default of 10. Fee rates are illustrative inputs, not quotations for a specific broker.

The walk-forward selector maintains its own holdings and drift across rule switches. It does not concatenate standalone candidates' net-return series, because their preceding holdings and entry costs can differ from the selector's.

## Reported metrics

For an evaluated window of `n` months with ending wealth `V_n` and starting wealth `1`:

| Metric                | Definition                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Total return          | `V_n - 1`                                                                                                                     |
| CAGR                  | `V_n^(12/n) - 1`                                                                                                              |
| Annualized volatility | Sample SD of monthly **net** returns multiplied by `sqrt(12)`                                                                 |
| Excess Sharpe         | `sqrt(12) × mean(netReturn - cashReturn) / sampleSD(netReturn - cashReturn)`; undefined when the denominator is zero          |
| Maximum drawdown      | Maximum of `1 - wealth / priorPeak`, where the running peak includes initial wealth `1`; reported as a positive loss fraction |
| Annualized turnover   | `12/n × sum(monthly turnover)`                                                                                                |
| Average exposure      | Arithmetic mean of monthly target market weights                                                                              |
| Worst month           | Minimum monthly net return, including the modeled fee                                                                         |

The annualization convention is monthly, not a daily 252-session convention. CAGR and arithmetic annualization answer different questions. The square-root-of-12 convention does not correct for serial correlation in monthly returns. Undefined Sharpe values are preserved as missing values rather than replaced with a finite score.

## Development, selection, and reserved evaluation

For `N` observations, the first 24 months are warm-up and the final 60 months form the reserved evaluation window. The development interval lies between them. The 156-month minimum ensures at least 60 training months, one 12-month development test, and 60 reserved months in addition to warm-up.

During development:

1. Start with 60 post-warm-up training months.
2. Score the fixed candidates on those months using their net returns after the configured fee.
3. Choose the highest strictly positive, finite training excess Sharpe among the rules other than the cash baseline. Break exact ties in the declared descriptor order. If no candidate qualifies, hold Cash.
4. Apply that rule ID for the next annual test block. Its signals remain lagged and continue updating each month.
5. Expand the training window and repeat for the next available annual block, ending at the reserved-window boundary.

The final development test block can contain fewer than 12 months if the reserved-window boundary cuts it short. Its exact dates remain in the selection ledger. The interface reports the actual number of development-test months: 156 inputs provide 12 test months; 157 provide 13, including a one-month final fold. The minimum is a software requirement, not a statistical sufficiency claim.

Market, Cash, and 60/40 baselines run over exactly the same development-test dates, starting from cash with the same fee convention. Each keeps continuous holdings across folds. Fold baseline returns are ratios of that continuous wealth ledger, with no repeated initial investment fee. `split.walkForwardStart` identifies the first test month; it differs from the start of development training. The selector/baseline table also reports the separate final-window comparisons; these windows must not be compared as though they covered the same dates.

The training score is:

```text
excess_t = netReturn_t - cashReturn_t
trainingExcessSharpe = sqrt(12) × mean(excess) / sampleSD(excess)
```

In `lab-2`, undefined, zero, and negative training scores are ineligible. With no positive finite score, the selector chooses Cash and records `selectionReason: cash-abstention` and `trainingSharpe: null`. Otherwise its reason is `positive-training-score`. Cash is not assigned a fictitious Sharpe of zero. This is an explicit allocation policy relative to Cash, not a statistical significance threshold or proof of a useful strategy. Earlier `lab-1` reports used a Market fallback and require that original engine to reproduce them.

After development, choose one final rule ID from development data only. Freeze that ID for all final 60 months. Freezing a rule does not freeze its market weight: its formula continues to consume prior completed observations. Each of the eight fixed rules is also evaluated over those same final dates, independently initialized from cash with wealth `1` and charged its own entry cost.

The final window is reserved from the automated selector. The interface still exposes it to the researcher. Changing rules, settings, data, or interpretation after viewing those results makes subsequent comparisons exploratory; the application does not enforce a once-only unseen test. The research-vintage caveat also remains in force even when algorithmic signals are correctly lagged.

## Inspected rule, cost sensitivity, and paired uncertainty

The **inspected rule** is the fixed rule the user selects in the interface (`config.selectedStrategy`). It controls the comparison chart, cost sensitivity, and uncertainty calculation. It is distinct from `frozenSelection.chosenId`, the rule chosen automatically from development data and reported in the frozen-selection panel. Inspecting a rule does not alter the automated training winner.

Cost sensitivity evaluates the **same inspected rule ID** at `0`, `5`, `10`, `25`, and `50` basis points per unit turnover. It does not select a new winner for each displayed fee. The same final dates and cash initialization apply.

The bootstrap compares the inspected rule's final-window net returns with the Market baseline's net returns under the same configured fee:

```text
d_t = inspectedNetReturn_t - marketNetReturn_t
reportedDifference = 12 × mean(d_t)
```

The statistic is an annualized **arithmetic mean return difference**, not a CAGR difference, factor alpha, or annual compounded excess return. Expressing it as a percentage gives percentage points per year.

The engine draws 1,000 deterministic-seed moving-block replicates. The default seed is `20261022`; seeds are unsigned 32-bit integers and are recorded in the output. Each sampled block contains six consecutive observed months. Blocks are sampled with replacement from valid start positions, do not wrap from the end back to the beginning, and are concatenated to the required sample length. Both series use the same sampled indices. The 2.5th and 97.5th percentiles of the replicated annualized arithmetic differences form the displayed interval, using linear interpolation at sorted-array position `(1000-1) × probability`.

This is a descriptive, conditional interval. The procedure does not rerun automated selection in each replicate, correct for inspecting eight rules, account for prior human experimentation, or prove that market regimes recur. A six-month block is a fixed dependence approximation. The interval is not a selection-adjusted significance test or a calibrated forecast of future performance. Inspecting Market against itself gives an exact zero difference and interval.

## Reproduction and acceptance checks

Export a research run from Strategy Lab, then use the matching source release:

```bash
npm run verify:report -- /path/to/tradebo-strategy-lab.json
```

The offline verifier supports `lab-2` reports, caps the input file at 16 MiB, checks the canonical data hash and rule descriptors, and recomputes every evaluation field and ledger. It validates metadata types, requires exact report/dataset/row/evaluation fields, and rejects mismatched versions. Counts, seeds, and configuration parameters must match exactly. Other numeric agreement uses `abs(actual-expected) <= 1e-10 * max(1, abs(expected))`; other values must match exactly. A failure exits nonzero. The output explicitly leaves data authenticity, raw-file hash verification, and source-commit verification false. Verification checks calculation consistency, not source authenticity, original-file bytes, or investment merit; a self-consistent edited dataset is not authenticated by its hash.

When production build information is available, exports record the source commit and dirty-tree status and pin the methodology link to that commit. Unavailable build metadata remains null. These fields are provenance declarations, not signatures or an independent attestation of the exported file. Reports from older engine versions require the corresponding checkout. Browser reopening of reports remains future work.

The experiment report includes the dataset and source notes, raw-file and canonical-row hashes when applicable, `LAB_VERSION`, configuration, all result ledgers, development selection folds, cost sensitivity, bootstrap output, and interpretation limits. Atlas's model version is identified separately. Numerical behavior must be reproducible from the same canonical rows, version, configuration, and deterministic bootstrap settings.

Required checks cover:

- Return arithmetic, initial entry fees, drift-aware rebalancing, and no terminal liquidation.
- Prefix invariance: perturbing later data cannot change earlier targets or selections.
- Exact trend, momentum, reversal, volatility, and breakout window boundaries, including ties and zero variance.
- Common reserved dates and initial capital; selection excludes the reserved returns and uses a separate holdings ledger.
- Stable selection ties, explicit cash abstention, continuous baseline holdings, and exits into cash.
- Generic decimal-return parsing; French percentage conversion, monthly/annual separation, invalid sentinels, duplicates, and gaps.
- Deterministic paired bootstrap sampling and correct arithmetic-difference labeling.
- Browser import, synthetic labeling, navigation, table/export consistency, and readable mobile/keyboard interactions.

The lab does not model taxes, cash flows, security selection, borrow costs, margin, options, intramonth execution, or investability of research aggregates. The [research comparison and roadmap](STRATEGY_RESEARCH.md) records the data and validation requirements for expanding beyond this contract.

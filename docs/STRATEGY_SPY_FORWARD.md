# SPY forward test

## Locked before the first signal

Protocol `spy-forward-1`. The first eligible signal is the November 30, 2026 close and the first eligible fill is the December 1 regular-session open. All three simulated accounts start with $10,000 in cash. The first annual review covers observations through November 30, 2027. Interim balances are descriptive.

Use the published `spy-open-1` weights and scaler (SHA-256 `782089554c0bc852fe2727b6e3ca17b006684456633df2f772cac27ce5f0d2ca`), its eight close-time features and 0.50 holding threshold. Use the existing monthly trend-filtered reversal rule with its historical state carried into the forward test. Hold SPY from the common first eligible open in the passive account. Preserve the original next-open execution, 1 bp commission on filled value, 2 bp adverse slippage per side, fractional shares, zero cash interest and distribution/payment treatment.

Use the XNYS session calendar in New York. Collect the model probability and each account’s next target after the regular close plus 20 minutes, by midnight local time that evening. Record the actual UTC observation time, the exchange close and the intended next regular open. Only a previously saved on-time signal can change active exposure at the next open. A missed signal is logged as missed. Both active accounts carry their position until another timely signal. The passive account's initial purchase was specified before launch.

An opening print can be observed after the scheduled open. Record both times. Use the first accepted observation of each phase and retain it across retries and subsequent price revisions. A late price can complete a mark or price an already authorized simulated order. Missing or conflicting prices, distributions or a split stop the update at that point.

For every model transition from SPY to cash, accumulate SPY declines avoided and gains missed between the exit open and re-entry open, including dividend entitlements. Divide both sums by the exit price. Mark an unfinished interval to the latest observed open or close. Compare all three accounts from immediately before the exit trade through just after re-entry, including both boundary costs. Report the total net dollar differences separately. Pre-entry idle cash is excluded from the exit count.

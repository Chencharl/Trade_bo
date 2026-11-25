# Exposure and timing

Protocol `exposure-controls-1`. Use the snapshot, 90 test folds, 1,070 test months and 10 bp one-way fee from the [reversal filter study](STRATEGY_REVERSAL_FILTERS.md). Its trend-minus-original net CAGR difference is already known.

## Controls fixed before evaluation

For each test fold, compute two separate average opening equity targets over the preceding 120 months, one for original reversal and one for trend-gated reversal. Replay the historical trend gate sequentially during the initial calibration decade, starting from the raw target in its first month. From the first test opening onward use the published strategy's actual target history. Each control holds its training mean fixed for the next test fold and rebalances monthly to that target after holdings drift. Use the available two months in the last fold. All five portfolios start with $100 in cash, pay entry costs and carry holdings and wealth across folds.

Let T and O be the net annualized compound returns of trend-filtered and original reversal, and Cₜ and Cₒ those of their respective lagged fixed-allocation controls. The allocation component is Cₜ − Cₒ. The remaining component is (T − Cₜ) − (O − Cₒ). Their sum is exactly T − O in annual percentage points. Show both individual strategy-minus-control gaps. Recalculate the same difference of gaps before fees to identify the contribution of differential fee drag. The residual includes timing, compounding and differences between estimated and realized exposure. It cannot identify timing skill causally.

Use the maximum drawdown at monthly closes including starting capital. Rebound comparisons average each portfolio's net monthly return minus Market across the same retrospectively labeled trough-to-recovery months used in the previous study. The capital paths already include these returns. Charts sample the monthly simulation at calendar quarter ends, plus the common starting observation and sample end. Loss from peak at a plotted date uses all monthly closes through that date.

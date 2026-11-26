# When does trading cost erase the SPY model's lead?

## Fixed experiment

Protocol `spy-cost-1`, specified before running this sensitivity study. The original 2022-01-03 through 2026-10-30 holdout has already been inspected. The question here is how execution assumptions change its ending balances.

Start each account with $10,000. Freeze every daily target and order date from the [published holdout](../public/research/spy-daily.json), including the model’s 64 exits and 69 sessions in cash. Use identical rates for the model, trend filter and buy-and-hold. Charge both sides. A buy fills at open × (1 + slippage), a sell at open × (1 − slippage), and commission is the specified fraction of the executed notional. Recompute quantities, dividends, receivables, reinvestment and compounding for every scenario using the original account rules.

- Vary commission and adverse slippage independently from 0 to 6 basis points per side in 0.25 bp steps. One basis point is 0.01%. Keep both comparator accounts on the same rates as the model. Preserve the published point at 1 bp commission and 2 bp slippage.
- Also vary their nominal sum from 0 to 6 bp at the published 1:2 fee-to-slippage ratio. A plotted sum of 3 bp means 1 bp commission and 2 bp slippage on each trade.
- The endpoint is the difference in ending dollars, model minus comparator. On each fixed-cost slice and the 1:2 path, check for a decreasing gap across the grid. Locate a sign change by bisecting full portfolio replays to within 0.000001 bp. Report if the model already trails at zero or still leads at the tested maximum. Display rounded cutoffs and retain unrounded numerical brackets.
- Verify the three accounts against their original results at the published rates. Recalculate grid balances, crossover brackets and the zero-cost comparison with a separate decimal ledger. This study conditions on observed SPY history and fixed signals.

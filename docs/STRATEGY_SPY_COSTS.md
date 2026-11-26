# When does trading cost erase the SPY model's lead?

## Fixed experiment

Protocol `spy-cost-1`, specified before running this sensitivity study. The original 2022-01-03 through 2026-10-30 holdout has already been inspected. The question here is how execution assumptions change its ending balances.

Start each account with $10,000. Freeze every daily target and order date from the [published holdout](../public/research/spy-daily.json), including the model’s 64 exits and 69 sessions in cash. Use identical rates for the model, trend filter and buy-and-hold. Charge both sides. A buy fills at open × (1 + slippage), a sell at open × (1 − slippage), and commission is the specified fraction of the executed notional. Recompute quantities, dividends, receivables, reinvestment and compounding for every scenario using the original account rules.

- Vary commission and adverse slippage independently from 0 to 6 basis points per side in 0.25 bp steps. One basis point is 0.01%. Keep both comparator accounts on the same rates as the model. Preserve the published point at 1 bp commission and 2 bp slippage.
- Also vary their nominal sum from 0 to 6 bp at the published 1:2 fee-to-slippage ratio. A plotted sum of 3 bp means 1 bp commission and 2 bp slippage on each trade.
- The endpoint is the difference in ending dollars, model minus comparator. On each fixed-cost slice and the 1:2 path, check for a decreasing gap across the grid. Locate a sign change by bisecting full portfolio replays to within 0.000001 bp. Report if the model already trails at zero or still leads at the tested maximum. Display rounded cutoffs and retain unrounded numerical brackets.
- Verify the three accounts against their original results at the published rates. Recalculate grid balances, crossover brackets and the zero-cost comparison with a separate decimal ledger. This study conditions on observed SPY history and fixed signals.

## Where the ranking changes

The table gives approximate break-even rates on the cost being varied. A nonnegative rate below a crossing leaves the model ahead of that benchmark. Above it, the model finishes behind. Commission and slippage are charged on both entry and exit. Each rate below is per side.

| Cost being varied     | Other assumption          |                   Tie with trend filter | Tie with holding SPY |
| --------------------- | ------------------------- | --------------------------------------: | -------------------: |
| Commission + slippage | Published 1:2 mix         |                             1.103596 bp |          4.260073 bp |
| Commission            | Zero slippage             |                             1.103596 bp |          4.260073 bp |
| Slippage              | Zero commission           |                             1.103596 bp |          4.260073 bp |
| Commission            | Published 2 bp slippage   | Model already behind at zero commission |          2.260073 bp |
| Slippage              | Published 1 bp commission |                             0.103596 bp |          3.260073 bp |

With zero costs, the model led trend by $245.77 and holding SPY by $944.52. At the published 1 bp fee and 2 bp slippage, the model ended at $17,152.35, the trend filter at $17,566.41 and holding SPY at $16,878.39. Eliminating commission alone at 2 bp slippage still left the model $197.01 behind trend.

Swapping commission and slippage gives the same account values to numerical precision here. Buying shares divides available cash by open × (1 + slippage) × (1 + commission). Selling multiplies shares by open × (1 − slippage) × (1 − commission). Both inputs still enter the simulator separately. A combined-cost cutoff depends on the specified mix. The differences among mixes in this range are smaller than the displayed hundredth of a basis point.

In the [interactive chart](https://chencharl.github.io/Trade_bo/#lab-spy-costs), the horizontal zero line is a tie in ending dollars. Each curve uses a different comparator. Select a hollow circle for the account balance at that crossing, or use the slider with the keyboard. The original cost marker appears on slices that contain the published rate pair. Lines connect the quarter-basis-point grid runs. The circle positions and balances come from additional full replays during bisection.

## Reproduce the result

Use the locked normalized SPY file from the [daily study](STRATEGY_SPY_DAILY.md#reproduction). The grid and endpoint were committed in `f5bbce0` before the sensitivity runs. No training step is needed.

```sh
python scripts/spy_costs.py /tmp/spy.csv public/research/spy-daily.json /tmp/spy-costs.json
python scripts/verify_spy_costs.py /tmp/spy.csv public/research/spy-daily.json public/research/spy-spells.json /tmp/spy-costs.json
cmp /tmp/spy-costs.json public/research/spy-costs.json
```

All 625 independent rate pairs and the 25 points along the 1:2 mix use the original simulator. Each replay checks its order dates and sides against the frozen receipts, including dividend reinvestments. A separate 40-digit decimal ledger reconstructs holdings from the published cash intervals, checks the three ending balances at every point, and checks both sides of each numerical root or the endpoint for a slice with no crossing.

The [downloadable results](../public/research/spy-costs.json) include the input hashes and published assumptions. `grid[feeIndex][slipIndex]` contains three ending balances. The fee cutoff arrays are indexed by fixed slippage, the slippage arrays by fixed commission. The mixed path uses the published ratio. Crossing records contain the two bounding rates and the three account balances at their midpoint. This measures sensitivity on this historical SPY window with simulated fills.

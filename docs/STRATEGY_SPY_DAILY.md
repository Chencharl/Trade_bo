# SPY next-open study

Protocol `spy-open-1`. Freeze these choices before any strategy is scored on the final period. This extends the Lab from a monthly market index to one ETF with observed daily opens and closes.

## Dates and model

Use SPY from inception through October 30, 2026 (last completed calendar month at design time). Reconstruct close-to-close total returns from unadjusted-for-dividends prices and issuer distributions. Validate the session sequence against XNYS. The price source is [Yahoo Finance SPY daily history](https://finance.yahoo.com/quote/SPY/history/). Amounts, ex-dates and payable dates come from [State Street's distribution history](https://www.ssga.com/us/en/individual/resources/documents/etf-dividend-distributions). Use the issuer's distribution plus any capital gains. No raw vendor history is distributed with the site.

- The development walk-forward covers 2010–2021. Refit each January on the immediately preceding eight calendar years of mature examples. The final test starts at the first 2022 open and ends at the October 30, 2026 close. Fit once before that first open and freeze weights, preprocessing and threshold for the whole holdout. Historical market regimes have been studied elsewhere in this project. The holdout applies to this experiment's model development.
- At each close use trailing total returns over 1, 5, 21, 63 and 126 sessions, trailing 21-session sample volatility, today's dividend-inclusive overnight return, and today's open-to-close return. A binary label is positive if buying at the next open and holding to the following open delivers a positive gross return including intervening dividend entitlement. Both label endpoints must have occurred by the training cutoff. Scale features using training rows only.
- Two hidden ReLU layers of 16 and 8 units, logistic output, Adam, 30 epochs, batch size 64, learning rate 0.001, L2 alpha 0.0001, seed 42. Go long at probability ≥ 0.50, otherwise hold cash. Fix all settings in advance. No hyperparameter search, early stopping or selection by holdout results.
- Retain the original reversal's monthly clock. After a month-end close, hold equity if its trailing three-month total return is negative. For the trend filter, permit a fresh exit only when the current total-return index is at or below its trailing ten month-end mean. Carry vetoes until equity re-entry. Apply both signals at the following session's open. The neural model can change position daily. Buy-and-hold buys at the first test open. All four portfolios start the holdout from cash.

## Execution and endpoints

Each book starts with $10,000. Use fractional shares and zero interest on idle cash. Buy at the observed open plus 2 bp of slippage, sell at the open minus 2 bp. Charge 1 bp commission on executed notional. Buy only with available cash including the commission. Credit dividend entitlement to holders from the previous close on the ex-date. Count receivables in equity and release them to cash on the first trading session strictly after the payable date. Reinvest available dividends at a modeled open if the target is long. No shorting, leverage, taxes or forced final liquidation.

Mark to the observed close every trading day. Compute cumulative net return, calendar-time CAGR and maximum peak-to-trough drawdown on daily closing equity including the starting capital. Report model differences against each of the three baselines. Expose next-open receipts and separate modeled commission and slippage in dollars. Daily bars approximate a small market-on-open order. They contain no auction queue, bid/ask or actual broker fills.

Keep the holdout scoring command separate from training. Reconcile the published four portfolios, distributions, transaction costs and drawdowns independently. Show all outcomes, including losses to baselines.

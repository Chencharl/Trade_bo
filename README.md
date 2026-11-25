# TradeBo

I built TradeBo to study one question: when a strategy sells to avoid a loss, does it buy back in time for the recovery? Strategy Lab follows the money from the signal at the close to the trade at the next open. You can see what staying in cash saved, what it cost, and how simply holding the market would have worked out.

**[Open Strategy Lab](https://chencharl.github.io/Trade_bo/#lab)** · [Read the SPY study](docs/STRATEGY_SPY_DAILY.md) · [Research plan](docs/STRATEGY_RESEARCH.md#what-we-test-next)

## What happened with SPY?

From January 2022 through October 2026, a neural model spent 69 trading days in cash. On a $10,000 account it finished **$273.95 ahead of buy-and-hold** after simulated fees and slippage. Two exits in April 2025 added $2,707.11 to the final balance. The other 62 together gave back $2,433.16.

The model still had a deeper loss from its peak than SPY, and a monthly trend filter finished $414.07 ahead of it. Click either April exit on the chart to compare the portfolios over those exact trading days. The model weights were fixed before the final test.

[![The April 3 exit on the SPY equity chart, with avoided losses, trading costs and the trend filter's return.](docs/spy-spells.png)](https://chencharl.github.io/Trade_bo/#lab)

## Explore the project

- **[Strategy Lab](https://chencharl.github.io/Trade_bo/#lab)** compares the model with three baselines. Its [monthly workbench](https://chencharl.github.io/Trade_bo/#lab-workbench) lets you try eight rules on your own data. The [2008 and 2020 replays](docs/STRATEGY_CRISIS_REPLAYS.md) examine when strategies cut exposure during those sell-offs.
- **[Atlas](https://chencharl.github.io/Trade_bo/)** lets you change a portfolio's allocation and simulate market shocks with illustrative assumptions.
- **[Research desk](docs/RESEARCH_DESK.md)** runs locally for reviewing holdings and paper trade plans.

Strategy Lab and Atlas run in your browser without an account. All trades shown here are simulations.

## Run locally

Use Node.js 22.12 or newer.

```sh
git clone https://github.com/Chencharl/Trade_bo.git
cd Trade_bo
npm ci
npm run dev
```

[Reproduce the SPY results](docs/STRATEGY_SPY_DAILY.md#reproduction) · [Development and tests](CONTRIBUTING.md) · [MIT license](LICENSE) · [Data and third-party notices](docs/THIRD_PARTY.md)

A personal project by [Chen Yang](https://github.com/Chencharl).

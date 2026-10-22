<div align="center">

# TradeBo Atlas

### The future isn’t a line. It’s a field of possibilities.

A portfolio wind tunnel. Build a mix, change the conditions, and explore a thousand simulated futures.

A personal project by [Chen Yang](https://github.com/Chencharl).

[![CI](https://github.com/Chencharl/Trade_bo/actions/workflows/ci.yml/badge.svg)](https://github.com/Chencharl/Trade_bo/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-4569bb)
![No API key](https://img.shields.io/badge/API_key-not_required-588b84)
[![License: MIT](https://img.shields.io/badge/license-MIT-7080a3)](LICENSE)

[**Open the live playground →**](https://chencharl.github.io/Trade_bo/)

[Explore the model](docs/ATLAS_MODEL.md) · [Strategy Lab](https://chencharl.github.io/Trade_bo/#lab) · [Run locally](#run-it-locally) · [Contribute](CONTRIBUTING.md) · [Research desk](docs/RESEARCH_DESK.md)

![TradeBo Atlas interactive portfolio simulation](docs/atlas-preview.png)

</div>

Most portfolio dashboards tell you what happened. Atlas lets you play with **what could happen under a set of assumptions**. Drag an allocation slider, trigger a market shock, and watch a field of possible outcomes take shape. Pin a setup and compare it with another using the same random draws.

The whole playground runs in your browser. No account, market-data subscription, API key, or backend is needed.

**Start here:** [open Atlas](https://chencharl.github.io/Trade_bo/) on your phone or computer. Choose a portfolio, change the conditions, and share the resulting experiment link. Nothing needs to be installed.

## Take a 60-second tour

1. Start with **Balanced**, **Growth**, or **Defensive**, then make the allocation your own.
2. **Pin this setup to compare**. Apply **Risk-off** or **Inflation wave** and look at both the median and downside.
3. Adjust shock intensity. Trace the impact back to each asset’s weight and assumed shock.
4. Open **Under the hood** to inspect inputs, correlations, equations, and a table of chart values.
5. **Share experiment** to send the exact setup, or save an editable SVG card and a JSON report.

## What makes it interesting

| Feature                             | What it demonstrates                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **The possibility field**           | 1,000 seeded monthly simulations, percentile bands, 48 example paths, and a keyboard-accessible time scrubber.                   |
| **A portfolio that stays balanced** | Integer allocation sliders redistribute the remaining weights proportionally and always sum to 100%.                             |
| **A common experiment**             | Pinned and current portfolios share the same capital, horizon, and random draws, making comparisons reproducible.                |
| **Explainable shocks**              | Five constructed scenarios with visible asset contributions, one-time price shocks, and persistent volatility changes.           |
| **A shareable result**              | Versioned URL state, SVG share cards, and JSON exports including inputs, assumptions, percentile paths, and all terminal values. |
| **A transparent engine**            | Pure TypeScript math in a Web Worker, self-hosted fonts, zero runtime data requests, and analytic sanity checks.                 |

Atlas is a simulation and interaction-design project, **not an alpha claim**. Its asset assumptions and scenarios are deliberately illustrative. Its simulated futures are not a historical backtest or an implied expected investment outcome.

## Compare rules in Strategy Lab

[**Open Strategy Lab →**](https://chencharl.github.io/Trade_bo/#lab)

Strategy Lab adds a separate monthly market/cash evaluation workspace. Compare eight fixed rules across trend, momentum, reversal, volatility, breakout, and three baselines. Inspect lagged allocations, turnover costs, expanding training windows, and a final 60-month window excluded from automated rule selection.

The default data is **synthetic**, not historical market performance. Import your own monthly-return CSV or a supported Kenneth French CSV/ZIP locally in the browser; no third-party market dataset is bundled. A paired six-month block bootstrap describes the inspected rule's observed difference from the market baseline, with its selection limits stated alongside the result. All results remain exploratory.

![Strategy Lab: fixed trading rules, walk-forward selection, costs, and uncertainty on synthetic data](docs/strategy-lab-preview.png)

Read the [calculation and data contract](docs/STRATEGY_LAB.md) and the [ten-project research comparison and method roadmap](docs/STRATEGY_RESEARCH.md). Atlas remains the place to explore simulated future paths; Strategy Lab evaluates fixed rules on an explicit return series.

## Run it locally

Node.js **22.12 or newer**:

```bash
git clone https://github.com/Chencharl/Trade_bo.git
cd Trade_bo
npm ci
npm run dev
```

Open the URL printed by Vite. The Atlas playground needs only the frontend.

```bash
npm run build
npm run preview
```

### The original research desk

TradeBo also includes the existing Python-powered equity workspace: portfolio weights, news relevance screens, evidence-linked answers, and paper plans. Its synthetic sample uses fictional companies. Provider access is optional and keeps its key on the local server.

```bash
npm run build
python3 -m backend.server
# Open http://127.0.0.1:8765/#research
```

See the [research desk guide](docs/RESEARCH_DESK.md) for setup, scope, and provider configuration. Atlas allocations and the research desk account model are separate experiments.

## Under the hood

```text
Allocation + scenario + seed
           │
           ▼
    Validated inputs ──────────────► Versioned share URL
           │
           ▼
    Simulation Web Worker
    ├─ Weighted drift & covariance
    ├─ Seeded portfolio GBM
    └─ Month-six scenario shock
           │
           ▼
    1,000 terminal values + monthly percentiles
           │
           ├─ Possibility field & comparison
           ├─ Distribution & shock attribution
           └─ JSON report / SVG share card
```

The portfolio is approximated by geometric Brownian motion with a constant allocation. Its volatility comes from a positive-semidefinite covariance model built from two common factors and independent residuals. Scenario shocks occur once at month six; the scenario volatility multiplier applies from that month onward.

**Same model version + same inputs + same seed → same results.** Extending the horizon preserves earlier path segments. No Monte Carlo sample is presented as a forecast or a calibrated probability. The [full specification](docs/ATLAS_MODEL.md) records formulas, assumptions, rounding rules, and known omissions.

## Verify

```bash
npm test                                      # Analytic and invariant tests
npm run format:check
npm run build
npx playwright install chromium firefox webkit # Once per environment
npm run test:e2e                               # Real-browser interaction tests
python3 -m unittest discover -s tests -v       # Existing research contracts
```

Checks include deterministic cash growth, covariance arithmetic, Monte Carlo mean agreement, month-six shock timing, constant allocation totals, URL validation, export consistency, keyboard controls, mobile layout, and preservation of the research engine’s contracts. Strategy Lab adds independent fee/holdings arithmetic, future-perturbation checks, selection separation, paired bootstrap checks, bounded CSV/ZIP imports, and stale-result prevention. CI runs the browser journeys in Chromium, Firefox, and WebKit. These engine checks do not replace testing on every physical device.

## Put it on GitHub Pages

The [public app](https://chencharl.github.io/Trade_bo/) is built from `main` by the [Pages workflow](.github/workflows/pages.yml). Every push to `main` runs formatting, numeric and Python tests, a production build, and browser journeys before deployment. A failed check stops publication.

The deployed [build information](https://chencharl.github.io/Trade_bo/build-info.json) records the exact source commit, Atlas model version, Strategy Lab version, and build time. Experiment links separately carry the simulation model version and inputs.

To publish your own fork:

1. In **Settings → Pages**, choose **GitHub Actions** as the source.
2. Push to `main`, or run **Deploy Atlas to Pages** from the Actions tab with `main` selected.
3. Open the deployment URL shown by GitHub and update the project links to your fork.

Relative asset paths support repository subpaths. The workflow uses GitHub’s [official Pages deployment actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). The Python research API stays local; Atlas is entirely static.

## Project map

```text
src/atlas/engine.ts              Assumptions, simulation, allocation & URL contracts
src/atlas/simulation.worker.ts   Background execution and request IDs
src/atlas/Atlas.tsx              Experiment controls, comparison, exports
src/atlas/Charts.tsx             Accessible SVG charts
src/atlas/atlas.css              Responsive visual system
src/lab/engine.ts                Lagged rules, accounting, selection & uncertainty
src/lab/data.ts                  Synthetic fixture, local CSV/ZIP import & hashes
src/lab/StrategyLab.tsx          Evaluation interface and reproducible exports
src/App.tsx                     Original research desk
backend/                        Python research API and provider adapter
tests/atlas.test.ts              Numeric and reproducibility contracts
tests/lab*.test.ts               Strategy accounting and import contracts
tests/browser/                  Playwright user journeys
docs/ATLAS_MODEL.md              Formulas, assumptions and boundaries
docs/STRATEGY_LAB.md             Monthly rule evaluation and data contract
docs/STRATEGY_RESEARCH.md        Primary-source comparison and method roadmap
```

## Make it your own

Try a different covariance model, add a constructed scenario, or introduce cash flows with explicit timing rules. Change `MODEL_VERSION` when numerical behavior changes so old experiment links cannot silently acquire new meanings. Keep assumptions visible and pair changes with independent arithmetic checks.

Possible next directions include fat-tailed innovations, time-varying correlations, and a sourced historical calibration mode. They are not implemented in this release.

MIT licensed; bundled fonts retain their [SIL Open Font Licenses](docs/THIRD_PARTY.md). Educational software; not investment advice.

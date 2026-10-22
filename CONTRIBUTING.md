# Contributing to TradeBo Atlas

TradeBo Atlas is a personal project by Chen Yang. Ideas, bug reports, and focused pull requests are welcome.

## Report a problem

[Open an issue](https://github.com/Chencharl/Trade_bo/issues) with your browser, device, what you expected, and what happened. For a simulation problem, include the experiment link or exported JSON so the result can be reproduced. Remove any personal information before posting.

## Work locally

Use Node.js 22.12 or newer. The Atlas playground needs no account or API key.

```bash
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm run format:check
npm test
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
python3 -m unittest discover -s tests -v
```

Python 3.10 or newer is needed for the existing research-desk tests. On Linux, install browser system dependencies with `npx playwright install --with-deps chromium firefox webkit`.

## Keep experiments reproducible

For numerical changes, document the formula and assumptions in [the model specification](docs/ATLAS_MODEL.md), add an independent arithmetic or invariant check, and change `MODEL_VERSION` when numerical behavior changes. Older experiment links must not silently take on new meanings.

Strategy Lab has a separate [calculation and data contract](docs/STRATEGY_LAB.md) and `LAB_VERSION`. Changes must preserve strict signal lag, source provenance, fee/holdings reconciliation, and the reserved-window selection boundary. Add independent arithmetic and future-perturbation checks for changed logic. Use generated fixtures in tests; do not commit third-party market datasets. Label imported-data tests and synthetic demonstrations accurately.

For interface changes, check keyboard use, mobile layout, and reduced motion. Include a screenshot when the appearance changes. Keep financial assumptions visible and distinguish simulated results from observed market data.

The public site is built from `main` only after its automated checks pass. Contributions are covered by the repository's [MIT license](LICENSE).

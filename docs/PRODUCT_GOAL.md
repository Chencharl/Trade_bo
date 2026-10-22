# TradeBo product goal

**Version 1 · agreed direction: strategy research platform · October 22, 2026**

TradeBo makes investment methods testable against simple baselines on consistent data, with reproducible results and explicit costs, risks, and evidence limits.

A successful evaluator can report underperformance or an inconclusive result. Passing software tests establishes tested behavior, not an investment edge. Strategy count, attractive charts, and a universal Sharpe threshold are not product success criteria.

## Current foundation

Strategy Lab evaluates eight fixed monthly market/cash rules with lagged signals, turnover costs, chronological selection, and source-aware exports. Its default data is synthetic; imported snapshots are not certified point-in-time data. Atlas and the local research desk remain separate supporting components.

The **v1.2 foundation milestone is complete**: same-date walk-forward baselines, Cash abstention, offline report verification, and preservation of edited desk inputs on refresh. The [validation record](VALIDATION.md) preserves results and limitations; the [calculation contract](STRATEGY_LAB.md) defines implemented behavior. Cash is chosen when no eligible rule has a positive, finite training excess Sharpe; this is an algorithm policy, not a universal research-acceptance threshold.

## Priority order

1. **Evaluator correctness, comparable benchmarks, and reproducibility.** Make existing methods and their evaluation independently inspectable before expanding the catalog.
2. **Frozen experiments, report reopening, and trial history.** Preserve protocols and record changes after results were inspected. Browser report reopening remains deferred.
3. **Multi-asset, point-in-time data.** Establish availability timestamps, corporate-action handling, universes, data rights, and reproducible ingestion before security-level claims.
4. **Additional method families.** Add a method only after its hypothesis, required data, execution assumptions, baselines, and independent fixtures are specified.

Paper-trading assistance, a trading journal, and broker integration are outside these priorities.

## Risk-warning evaluation

This is priority-1 evaluation of existing rules. The first [downside diagnostic](STRATEGY_RISK.md) tests whether defensive exposure preceded a 15% forward market loss within six months. It compares all eight rules, exposes misses, false alarms, prior drawdown, and foregone gains, and preserves the existing allocation rules. The [validation record](STRATEGY_RISK_VALIDATION.md) describes the evidence and limitations. It is a retrospective test, not a validated early-warning service.

Stronger warning claims require further work:

- Define the equity-loss event, forecast horizon, signal timestamp, and execution lag before evaluation. Separate warnings preceding a decline from responses after it begins. Monthly observations cannot establish intramonth warning performance.
- Report missed declines, false-alarm counts and duration, warning precision, and lead times. Count distinct events and disclose limited samples; overlapping months are not independent crises.
- Separately test whether exposure changes reduce severe losses after costs against same-date Market, Cash, and Balanced. Include foregone gains, missed rebounds, and full-period returns.
- Freeze evaluation rules, respect data availability, and retain unsuccessful results. Inspected histories remain exploratory; no precise crash-timing or guaranteed protection claim follows.

The [Federal Reserve's framework](https://www.federalreserve.gov/publications/2026-may-financial-stability-report-purpose-and-framework.htm) distinguishes monitorable vulnerabilities from difficult-to-predict shocks. [BIS research](https://www.bis.org/publications/qr-201803/early-warning-indicators-banking-crises-expanding-family) evaluates banking-crisis warnings over a multi-year horizon, including timing and false alarms. Banking crises and equity crashes are different targets; these sources guide evaluation design and do not validate TradeBo.

## Continuing acceptance gates

Comparable dates, capital, costs, and continuous holdings; independent accounting and future-perturbation checks; explicit invalid-input failures; versioned, reproducible reports; and agreement between interface and exports remain required. Applicable project checks must pass. A negative investment result does not fail the evaluator, and a passing implementation does not prove risk reduction. Proposed families in the [method roadmap](STRATEGY_RESEARCH.md#method-roadmap) remain subordinate to these priorities.

## Decision record

**October 22, 2026 — user clarification:** The primary research use case is to identify rising market risk early and assess whether exposure rules reduce severe losses, while measuring false alarms, missed declines, and foregone gains. This sharpens priority 1 without changing the strategy research platform identity or priority order. Acceptance now requires evaluating warning quality separately from portfolio loss reduction.

## Decision rule

A feature must name the goal it serves, its priority, and observable acceptance evidence; otherwise defer it. Goal or priority changes require explicit user agreement and a dated record here of the change, reason, and acceptance impact. Performance claims require separate evidence.

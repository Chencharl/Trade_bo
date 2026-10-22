# TradeBo product goal

**Version 1 · agreed direction: strategy research platform · October 22, 2026**

TradeBo makes investment methods testable against simple baselines on consistent data, with reproducible results and explicit costs, risks, and evidence limits.

A successful evaluator can report underperformance or an inconclusive result. Passing software tests establishes behavior under the tested contracts; it does not establish an investment edge. Strategy count, an attractive chart, and a universal Sharpe threshold are not product success criteria.

## Current foundation

Strategy Lab evaluates eight fixed monthly market/cash rules with lagged signals, turnover costs, chronological selection, and source-aware exports. Its default data is synthetic; imported snapshots are not certified point-in-time data. Atlas explores illustrative portfolio scenarios. The local research desk provides portfolio context and evidence review. These remain separate components.

The [calculation contract](STRATEGY_LAB.md) describes implemented behavior. The [method roadmap](STRATEGY_RESEARCH.md#method-roadmap) records possible extensions; it does not authorize adding them ahead of the priorities below.

## Priority order

1. **Evaluator correctness, comparable benchmarks, and reproducibility.** Make existing methods and their evaluation independently inspectable before expanding the catalog.
2. **Frozen experiments, report reopening, and trial history.** Preserve the protocol and record what changed after results were inspected. Reopening a report in the interface is deferred beyond the current milestone.
3. **Multi-asset, point-in-time data.** Establish availability timestamps, corporate-action handling, universes, data rights, and reproducible ingestion before security-level claims.
4. **Additional method families.** Add a method only after its hypothesis, required data, execution assumptions, baselines, and independent fixtures are specified.

Paper-trading assistance, a trading journal, and broker integration are outside these priorities.

## Current milestone and acceptance gates

This milestone covers same-date walk-forward baselines, cash abstention, an offline report verifier, and the research-desk refresh fix. The items below define acceptance; they do not claim validation has already passed.

- **Comparable evaluation:** Market, Cash, and Balanced use the selector's exact development-test dates, initial wealth, fee convention, and terminal treatment. Each retains its own continuous holdings ledger. Fold summaries do not restart positions or charge a fresh initial allocation.
- **Defined abstention:** The automatic selector chooses Cash when no eligible rule has a positive, finite training excess Sharpe. This is a declared algorithm eligibility rule relative to Cash, not a universal threshold for accepting research or predicting returns.
- **Numerical correctness:** Independent arithmetic reconciles holdings, costs, returns, and metrics. Future-data perturbations cannot change earlier targets or selections. Invalid inputs fail explicitly.
- **Reproduction:** An offline verifier recomputes exported evaluations from their data, version, rules, configuration, and split dates, reporting discrepancies within a documented numerical comparison policy. This does not imply report reopening in the interface.
- **Usable evidence:** Comparisons expose their dates, observation counts, risks, costs, and benchmark differences. Interface values agree with exports. Refreshing desk data preserves edited portfolio inputs and the symbol universe. Failed refreshes retain the prior board and show an error; explicit mode changes still reset to that mode's defaults.

Release the milestone when these gates and applicable project checks pass, even if the evaluated methods underperform. Preserve negative results; do not keep revising methods merely to improve the displayed score.

Chronological testing must specify observation and execution timing. Repeated searches and reuse of inspected windows can still bias results; a reserved window alone does not account for all trials. These motivate explicit timing and trial records, not a profitability guarantee. [WalkForward documentation](https://skfolio.org/generated/skfolio.model_selection.WalkForward.html), [Bailey et al., backtest overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).

## Decision rule

A proposed feature must name the goal it serves, its priority, and observable acceptance evidence. Otherwise, defer it. Changing this goal or priority order requires explicit user agreement and a dated decision record here stating what changed, why, and how acceptance changes. Performance claims require separate evidence; passing implementation checks cannot substitute for it.

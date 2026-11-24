# 0002: Matching an exit to an entry as weighed evidence

## Context
Exact plate equality misses every misread; one-edit fuzzy matching joins lookalikes in a fleet. Both decide
without saying how sure they are.

## Decision
Each open entry is weighed by a log likelihood ratio, "this car" against "some other car":
- the plate, by a weighted edit distance where lookalike characters (O/0, B/8, S/5, I/1) cost little;
- colour and make, as likelihood ratios calibrated to how often two scanners disagree on the same car;
- the length of stay against the site's stay distribution, penalised only beyond 1.5 σ.

"No entry was read" competes with a fixed weight. Above 0.97 posterior the engine decides; in between it asks.
Candidates come from an index of plate skeletons (lookalikes folded together) plus one-character deletions, so
an exit is compared with a handful of cars, not every car on site.

A review must pay for itself: it is opened only when a typical stay's fee at that site, times the chance it is
settled and collected, exceeds the operator minutes it costs (`reviewEconomics` in `config/engine.json`). At a
shopping centre with a free first hour, a missed exit is not worth five minutes of an operator's time.

## Consequences
- Colour, make and length of stay barely change the result in this world (the "plate only" ablation is within
  noise); the plate distance carries the decision. They are kept because they cost nothing and real fleets of
  identical plates are worse than simulated ones.
- Operator time is the price of revenue: 32 minutes per 1,000 stays (dev), 43 on the held-out world.

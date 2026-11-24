# 0001: Simulated car parks with a known truth

## Context
A session engine is judged by stays nobody bills correctly by hand: misreads, missed reads, scanners offline,
mistyped plates. Real data has no labels for those; a parking operator learns about them from complaints.

## Decision
`packages/world` generates car parks whose truth is known: 150 sites (dev) with 513 scanners, regulars, company
fleets with near-identical plates, Automatic Payment registrations, terminal and app payments with typos, scanner
misreads drawn from lookalike characters, missed reads, duplicate reads, offline windows with backlogs, clock
skew, slowly degrading lenses, and a payment provider that times out after taking the money. Every draw is keyed
by (seed, purpose, key), so every design sees the same luck.

Designs are scored against that truth: revenue collected against what a desk that never errs would collect, wrong
charges and notices, double charges, operator minutes, speed, and scanner faults found.

## Consequences
- The numbers measure the method, not a deployment. The fault model is an assumption; its rates sit in
  `config/world.json` where they can be argued with.
- Lane headway (2.5 s) and duplicate spread (2 s) are physical assumptions the engine's "same car" rule relies on.

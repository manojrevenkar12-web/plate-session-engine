# 0007: Held-out results

The held-out world ran once on config `4941c1a388df9a10`, after commit `00793a5` froze the code.

| | Dev | Held-out |
|---|---:|---:|
| Revenue collected | 97.8% | 96.1% |
| Wrong charges and notices per 10,000 stays | 2.7 | 2.0 |
| Double charges | 0 | 0 |
| Operator minutes per 1,000 stays | 32.4 | **42.6** (gate 40) |
| Degrading scanners flagged | 91% | **81%** (gate 85%) |
| False degraded-scanner alarms | 4 | 16 |

Two gates failed. The held-out world misreads more (4.2% against 3.0%), so more exits are uncertain and more
reviews open; and its higher base rate of low-confidence reads pushes the health monitor's fixed baseline both
ways: it misses slow degradations it would have caught and alarms on healthy scanners. The likely fix is a
baseline learned per scanner instead of one number for all; it would be tuned on the dev world and judged on a
new held-out world, not on this one.

Exact matching on the same world: 87.3% revenue, 497.6 wrong per 10,000, 161 double charges.

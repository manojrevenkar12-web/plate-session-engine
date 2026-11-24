# 0003: Watermarks and scanner clocks

## Context
An entry scanner that is offline buffers its reads and sends them later. A system that decides an exit at once
finds no entry, writes the stay off, and later opens a session for the late entry that never closes. Scanner
clocks drift by minutes, which moves a stay across an hourly price step.

## Decision
- Each scanner's watermark is the latest heartbeat time it reported. An exit is decided once every entry scanner
  on its site has reported past it, and once a reconnected scanner has had 16 minutes to flush its backlog. After
  24 hours the exit is decided anyway, and the sweep rechecks waiting exits every minute.
- A scanner's clock offset is estimated from its heartbeats as the largest recent value of (device time − arrival
  time): network delay only ever lowers it, so a batch of late heartbeats cannot fake a skew. Offsets above 45 s
  are corrected.

## Consequences
- Charges are slower: 96% within 15 minutes of exit against 98.9% for deciding at once.
- Without clock correction, wrong charges and notices rise tenfold (27.2 per 10,000 against 2.7).

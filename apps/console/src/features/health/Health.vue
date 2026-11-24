<script setup lang="ts">
import type { Aggregate, Bench } from "../../shared/data/report";
import { num } from "../../shared/format";

defineProps<{ engine: Aggregate; bench: Bench | null }>();
</script>

<template>
  <div class="cards">
    <article class="card">
      <h3>Scanner health</h3>
      <p class="big num">{{ num(engine.degradedScanners * engine.degradedFlagged) }} of {{ num(engine.degradedScanners) }}</p>
      <p>
        degrading scanners flagged, a median {{ engine.flagLeadHours?.toFixed(1) ?? "n/a" }} h after the lens began to fail on a 20 h ramp;
        {{ num(engine.falseDegradedAlarms) }} false alarms.
      </p>
    </article>
    <article class="card">
      <h3>Throughput, measured</h3>
      <template v-if="bench?.engine || bench?.api">
        <p v-if="bench?.engine" class="big num">{{ num(bench.engine.eventsPerSecond) }}<span class="unit"> events/s</span></p>
        <p v-if="bench?.engine">decided by one engine instance on one core ({{ bench.engine.machine }}).</p>
        <p v-if="bench?.api">Ingest: {{ num(bench.api.readsPerSecond) }} reads/s, p99 {{ bench.api.p99ms }} ms ({{ bench.api.store }}, {{ bench.api.queue }}).</p>
      </template>
      <p v-else>No benchmark yet: <code>pnpm bench</code>.</p>
    </article>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s4);
}
.card {
  background: var(--surface);
  border-top: 4px solid var(--sign-blue);
  padding: var(--s4) var(--s5);
  display: grid;
  gap: var(--s2);
  align-content: start;
  color: var(--ink-2);
}
h3 {
  color: var(--ink);
  font-size: var(--step-0);
}
.big {
  font-size: var(--step-2);
  font-weight: 700;
  color: var(--ink);
}
.unit {
  font-size: var(--step-0);
  font-weight: 400;
}
code {
  font-family: var(--font-plate);
}
@media (max-width: 700px) {
  .cards {
    grid-template-columns: 1fr;
  }
}
</style>

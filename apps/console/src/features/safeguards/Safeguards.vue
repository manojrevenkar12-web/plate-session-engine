<script setup lang="ts">
import { computed } from "vue";
import { type Aggregate, SHORT } from "../../shared/data/report";
import { num, pct } from "../../shared/format";

/** Each safeguard switched off on its own, against the full engine. A cell is marked where it got worse. */
const props = defineProps<{ designs: Record<string, Aggregate>; ablations: string[]; labels: Record<string, string> }>();

const COLS = [
  { head: "Revenue collected", get: (a: Aggregate) => a.revenueCaptured, show: (x: number) => pct(x), worse: (x: number, e: number) => x < e - 0.002 },
  { head: "Wrong per 10,000", get: (a: Aggregate) => a.wrongPer10k, show: (x: number) => num(x, 1), worse: (x: number, e: number) => x > e * 1.25 + 0.2 },
  { head: "Double charges", get: (a: Aggregate) => a.doubleCharges, show: (x: number) => num(x), worse: (x: number, e: number) => x > e },
  { head: "Operator min / 1,000", get: (a: Aggregate) => a.operatorMinutesPer1k, show: (x: number) => num(x, 1), worse: (x: number, e: number) => x > e * 1.1 },
] as const;

const engine = computed(() => props.designs.engine!);
const rows = computed(() => props.ablations.filter((n) => props.designs[n]).map((n) => ({ n, a: props.designs[n]! })));
</script>

<template>
  <div class="wrap">
    <table>
      <caption>Each safeguard removed on its own; marked cells are worse than the full engine</caption>
      <thead>
        <tr>
          <th scope="col">Without</th>
          <th v-for="c in COLS" :key="c.head" scope="col">{{ c.head }}</th>
        </tr>
      </thead>
      <tbody>
        <tr class="base">
          <th scope="row">Nothing removed</th>
          <td v-for="c in COLS" :key="c.head" class="num">{{ c.show(c.get(engine)) }}</td>
        </tr>
        <tr v-for="r in rows" :key="r.n">
          <th scope="row">{{ SHORT[r.n] ?? r.n }}<span class="label">{{ labels[r.n] }}</span></th>
          <td v-for="c in COLS" :key="c.head" class="num" :class="{ worse: c.worse(c.get(r.a), c.get(engine)) }">
            {{ c.show(c.get(r.a)) }}<span v-if="c.worse(c.get(r.a), c.get(engine))" class="sr-only"> (worse)</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  font-size: var(--step--1);
}
caption {
  text-align: left;
  color: var(--ink-3);
  padding-bottom: var(--s2);
}
th,
td {
  text-align: left;
  padding: var(--s3);
  border-bottom: var(--hair) solid var(--line);
  vertical-align: top;
}
thead th {
  color: var(--ink-3);
  font-weight: 600;
}
td {
  text-align: right;
}
tbody th {
  font-weight: 700;
}
.label {
  display: block;
  font-weight: 400;
  color: var(--ink-3);
}
.base {
  background: var(--sign-blue-soft);
}
.worse {
  background: var(--signal-soft);
  color: var(--signal);
  font-weight: 700;
}
</style>

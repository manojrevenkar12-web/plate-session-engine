<script setup lang="ts">
import { computed } from "vue";
import { type Aggregate, SHORT } from "../../shared/data/report";
import { eur, num, pct } from "../../shared/format";

const props = defineProps<{ designs: Record<string, Aggregate>; order: string[] }>();

interface Metric {
  title: string;
  note: string;
  value: (a: Aggregate) => number;
  show: (a: Aggregate) => string;
  better: "high" | "low";
}

const METRICS: Metric[] = [
  { title: "Revenue collected", note: "of what a desk that never errs would collect", value: (a) => a.revenueCaptured, show: (a) => pct(a.revenueCaptured), better: "high" },
  { title: "Wrong charges and notices", note: "per 10,000 stays: the wrong person, the wrong amount, or a driver who had paid", value: (a) => a.wrongPer10k, show: (a) => num(a.wrongPer10k, 1), better: "low" },
  { title: "Double charges", note: "a payment timeout retried without a key, or one stay billed twice", value: (a) => a.doubleCharges, show: (a) => num(a.doubleCharges), better: "low" },
  { title: "Revenue lost per 1,000 stays", note: "unbilled, written off or never collected", value: (a) => a.lostCents / a.visits, show: (a) => eur((a.lostCents / a.visits) * 1000), better: "low" },
  { title: "Operator minutes per 1,000 stays", note: "the price of asking a person; exact matching asks no one", value: (a) => a.operatorMinutesPer1k, show: (a) => num(a.operatorMinutesPer1k, 1), better: "low" },
  { title: "Automatic charges within 15 minutes", note: "the engine holds an exit while an entry scanner is offline", value: (a) => a.chargedWithin15, show: (a) => pct(a.chargedWithin15), better: "high" },
];

const rows = computed(() => props.order.filter((n) => props.designs[n]));
const panels = computed(() =>
  METRICS.map((m) => {
    const max = Math.max(...rows.value.map((n) => m.value(props.designs[n]!)), 1e-9);
    return { m, bars: rows.value.map((n) => ({ n, w: m.value(props.designs[n]!) / max, label: m.show(props.designs[n]!) })) };
  }),
);
</script>

<template>
  <div class="grid">
    <figure v-for="p in panels" :key="p.m.title" class="panel">
      <figcaption>
        <span class="title">{{ p.m.title }}</span>
        <span class="note">{{ p.m.note }}. <span class="dir">{{ p.m.better === "low" ? "Lower is better." : "Higher is better." }}</span></span>
      </figcaption>
      <ul>
        <li v-for="b in p.bars" :key="b.n" :class="{ mine: b.n === 'engine' }">
          <span class="who">{{ SHORT[b.n] ?? b.n }}</span>
          <span class="track"><span class="bar" :style="{ width: `${Math.max(b.w * 100, 0.6)}%` }" /></span>
          <span class="val num">{{ b.label }}</span>
        </li>
      </ul>
    </figure>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--hair);
  background: var(--line);
  border: var(--hair) solid var(--line);
}
.panel {
  margin: 0;
  background: var(--surface);
  padding: var(--s4) var(--s4) var(--s5);
  display: grid;
  gap: var(--s3);
  align-content: start;
}
figcaption {
  display: grid;
  gap: var(--s1);
}
.title {
  font-weight: 700;
}
.note {
  font-size: var(--step--1);
  color: var(--ink-3);
  min-height: 2.6em;
}
.dir {
  color: var(--ink-2);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--s2);
}
li {
  display: grid;
  grid-template-columns: 6.5rem 1fr 4.6rem;
  align-items: center;
  gap: var(--s2);
  font-size: var(--step--1);
}
.who {
  color: var(--ink-2);
}
.track {
  height: 0.6rem;
  background: var(--surface-sunk);
  border-radius: 0 4px 4px 0;
}
.bar {
  display: block;
  height: 100%;
  background: var(--ink-3);
  border-radius: 0 4px 4px 0;
  transform-origin: left;
  animation: grow 0.7s var(--ease) both;
}
.mine .bar {
  background: var(--sign-blue);
}
.mine .who,
.mine .val {
  color: var(--ink);
  font-weight: 700;
}
.val {
  text-align: right;
}
@keyframes grow {
  from {
    transform: scaleX(0);
  }
}
@media (max-width: 960px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>

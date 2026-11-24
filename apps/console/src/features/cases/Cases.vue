<script setup lang="ts">
import { motion } from "motion-v";
import { computed } from "vue";
import type { Samples } from "../../shared/data/report";
import { eur } from "../../shared/format";
import { prefersReducedMotion, SCAN_STAGGER, ease } from "../../shared/theme/motion";
import PlateChip from "../../shared/ui/PlateChip.vue";
import States from "../../shared/ui/States.vue";

/** Real decisions from the first simulated day: what the scanners wrote, and what was billed. */
const props = defineProps<{ samples: Samples | undefined }>();
const still = prefersReducedMotion();

const cases = computed(() => {
  const s = props.samples;
  if (!s) return [];
  const out: { kind: string; reads: string[]; billed: string; outcome: string }[] = [];
  const a = s.lookalike[0];
  if (a) out.push({ kind: "The exit scanner misread a character", reads: [...a.entry, ...a.exit], billed: a.billed, outcome: `${eur(a.amountCents)} charged to the registered account` });
  const p = s.typedPayment[0];
  if (p) out.push({ kind: "The driver mistyped the plate at the terminal", reads: [p.typed], billed: p.plate, outcome: "payment linked; no letter goes out" });
  const c = s.plateCheck[0];
  if (c) out.push({ kind: "Entry and exit disagreed on the plate", reads: c.read, billed: c.billed, outcome: `an operator confirmed the plate; notice for ${eur(c.amountCents)}` });
  const b = s.lookalike[1];
  if (b) out.push({ kind: "A lookalike on entry", reads: [...b.entry, ...b.exit], billed: b.billed, outcome: `${eur(b.amountCents)} charged once` });
  return out;
});
</script>

<template>
  <section class="cases" aria-labelledby="cases-title">
    <h2 id="cases-title" class="sr-only">Cases from the simulation</h2>
    <States v-if="cases.length === 0" kind="empty" title="No cases for this world">The held-out world ran before cases were recorded; it runs once.</States>
    <ol v-else>
      <motion.li
        v-for="(c, i) in cases"
        :key="c.kind"
        class="case"
        :initial="still ? false : { opacity: 0, x: -12 }"
        :animate="{ opacity: 1, x: 0 }"
        :transition="{ duration: 0.45, delay: i * SCAN_STAGGER, ease }"
      >
        <p class="kind">{{ c.kind }}</p>
        <div class="row">
          <span class="reads">
            <span class="scan" :style="still ? {} : { animationDelay: `${0.2 + i * SCAN_STAGGER}s` }" aria-hidden="true" />
            <PlateChip v-for="r in c.reads" :key="r" :plate="r" :reference="c.billed" size="s" />
          </span>
          <svg class="to" viewBox="0 0 24 12" aria-hidden="true"><path d="M0 6h20M15 1l6 5-6 5" /></svg>
          <PlateChip :plate="c.billed" size="s" />
        </div>
        <p class="outcome">{{ c.outcome }}</p>
      </motion.li>
    </ol>
  </section>
</template>

<style scoped>
.cases {
  background: var(--asphalt);
  color: #e6e9ec;
  padding: var(--s5);
  border-radius: var(--radius);
  position: relative;
}
ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0;
}
.case {
  padding: var(--s4) 0;
  border-bottom: var(--rule) dashed #4b535b;
  display: grid;
  gap: var(--s2);
}
.case:last-child {
  border-bottom: 0;
}
.kind {
  font-size: var(--step--1);
  color: #aeb6be;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--s3);
  flex-wrap: wrap;
}
.reads {
  position: relative;
  display: inline-flex;
  gap: var(--s2);
  flex-wrap: wrap;
}
.scan {
  position: absolute;
  inset: -3px auto -3px 0;
  width: 3px;
  background: #ff3b30;
  box-shadow: 0 0 10px #ff3b30;
  opacity: 0;
  animation: scan 0.9s var(--ease) both;
}
@keyframes scan {
  0% {
    left: 0;
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  85% {
    opacity: 1;
  }
  100% {
    left: 100%;
    opacity: 0;
  }
}
.to {
  width: 1.5rem;
  height: 0.75rem;
  fill: none;
  stroke: #f5cf3a;
  stroke-width: 2;
}
.outcome {
  font-size: var(--step--1);
  color: #f5cf3a;
}
</style>

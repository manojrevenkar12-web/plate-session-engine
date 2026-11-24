<script setup lang="ts">
import { computed, ref } from "vue";
import Cases from "../features/cases/Cases.vue";
import Comparison from "../features/comparison/Comparison.vue";
import Gates from "../features/gates/Gates.vue";
import Health from "../features/health/Health.vue";
import Safeguards from "../features/safeguards/Safeguards.vue";
import { useReport } from "../shared/data/report";
import { eur, num, pct } from "../shared/format";
import States from "../shared/ui/States.vue";

const { load, retry } = useReport();
const world = ref<"dev" | "heldout">("dev");
const data = computed(() => (load.value.state === "ready" ? load.value.data : null));
const report = computed(() => (data.value ? data.value[world.value] : null));
const e = computed(() => report.value?.designs.engine ?? null);
const sq = computed(() => report.value?.designs.status_quo ?? null);
const passed = computed(() => report.value?.gates.filter((g) => g.pass).length ?? 0);
</script>

<template>
  <div class="page">
    <header class="top">
      <span class="sign" aria-hidden="true">P</span>
      <div class="name">
        <p class="product">plate-session-engine</p>
        <p class="tag">Ticketless car parks: every stay matched, billed once and checked</p>
      </div>
      <a class="repo" href="https://github.com/manojrevenkar12-web/plate-session-engine">Source on GitHub</a>
    </header>

    <States v-if="load.state === 'loading'" kind="loading" />
    <States v-else-if="load.state === 'error'" kind="error" :message="load.message" @retry="retry" />

    <main v-else-if="data">
      <div class="switch" role="radiogroup" aria-label="Which simulated car parks">
        <button type="button" role="radio" :aria-checked="world === 'dev'" @click="world = 'dev'">Development car parks</button>
        <button type="button" role="radio" :aria-checked="world === 'heldout'" @click="world = 'heldout'">Held-out car parks, run once</button>
      </div>

      <States v-if="!report" kind="empty" title="The held-out car parks have not been run">
        Run <code>pnpm heldout</code> once the development gates pass. It writes a lock; a second run is refused.
      </States>

      <template v-else-if="e && sq">
        <section class="hero" aria-labelledby="hero-title">
          <div class="lede">
            <h1 id="hero-title">Every stay billed once, to the right plate</h1>
            <p>
              {{ num(report.sites) }} simulated car parks with {{ num(report.scanners) }} scanners send entry and exit reads that go offline,
              arrive twice, run on wrong clocks and misread characters. Drivers mistype plates at the terminal. The engine turns that into
              sessions, charges and payment requests, and asks a person only where code cannot be sure.
            </p>
            <dl class="readout">
              <div>
                <dt>Revenue collected</dt>
                <dd class="v num">{{ pct(e.revenueCaptured) }}</dd>
                <dd class="vs">exact matching: {{ pct(sq.revenueCaptured) }}</dd>
              </div>
              <div>
                <dt>Wrong charges and notices per 10,000 stays</dt>
                <dd class="v num">{{ num(e.wrongPer10k, 1) }}</dd>
                <dd class="vs">exact matching: {{ num(sq.wrongPer10k, 1) }}</dd>
              </div>
              <div>
                <dt>Double charges</dt>
                <dd class="v num">{{ num(e.doubleCharges) }}</dd>
                <dd class="vs">exact matching: {{ num(sq.doubleCharges) }}</dd>
              </div>
            </dl>
            <p class="small">
              Seeds {{ report.seeds.join(", ") }}, {{ num(report.visits) }} stays. Revenue lost per 1,000 stays: {{ eur((e.lostCents / e.visits) * 1000) }} against
              {{ eur((sq.lostCents / sq.visits) * 1000) }}.
            </p>
          </div>
          <Cases :samples="report.samples" />
        </section>

        <section class="section" aria-labelledby="compare-title">
          <h2 id="compare-title">Four ways to run the same car parks</h2>
          <p class="note">Every design sees the same cars, reads, outages and payments. The engine is the blue bar.</p>
          <Comparison :designs="report.designs" :order="data.order.main" />
        </section>

        <section class="section" aria-labelledby="safe-title">
          <h2 id="safe-title">What each safeguard is worth</h2>
          <Safeguards :designs="report.designs" :ablations="data.order.ablations" :labels="data.labels" />
        </section>

        <section class="section" aria-labelledby="health-title">
          <h2 id="health-title">Scanners and throughput</h2>
          <Health :engine="e" :bench="data.bench" />
        </section>

        <section class="section" aria-labelledby="gates-title">
          <h2 id="gates-title">Release gates: {{ passed }} of {{ report.gates.length }} pass</h2>
          <Gates :gates="report.gates" />
          <p v-if="world === 'heldout' && data.lock" class="note">
            Run once on config <code>{{ data.lock.configHash }}</code>. Failed gates stay failed: the held-out world is not run again.
          </p>
        </section>
      </template>
    </main>

    <footer class="foot">
      Everything here is simulated: the car parks, the scanners and their faults, the drivers, the operator and the model. The numbers measure the method on
      a world whose truth is known, not a deployment.
    </footer>
  </div>
</template>

<style scoped>
.page {
  max-width: var(--page);
  margin: 0 auto;
  padding: var(--s4) var(--s5) var(--s7);
}
.top {
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding-bottom: var(--s4);
  margin-bottom: var(--s5);
  border-bottom: var(--rule) solid var(--ink);
}
.sign {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 6px;
  background: var(--sign-blue);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 1.6rem;
  border: 2px solid #fff;
  box-shadow: 0 0 0 2px var(--sign-blue);
}
.name {
  flex: 1;
}
.product {
  font-weight: 800;
  font-size: var(--step-1);
}
.tag {
  font-size: var(--step--1);
  color: var(--ink-3);
}
.repo {
  color: var(--sign-blue);
}
.switch {
  display: inline-flex;
  border: var(--hair) solid var(--line);
  background: var(--surface-sunk);
  padding: 2px;
  margin-bottom: var(--s6);
}
.switch button {
  font: inherit;
  border: 0;
  background: none;
  color: var(--ink-2);
  padding: var(--s2) var(--s4);
  cursor: pointer;
}
.switch button[aria-checked="true"] {
  background: var(--surface);
  color: var(--ink);
  font-weight: 700;
  box-shadow: inset 0 -3px 0 var(--marking);
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
  gap: var(--s7);
  align-items: start;
  margin-bottom: var(--s8);
}
.lede {
  display: grid;
  gap: var(--s5);
}
h1 {
  font-size: var(--step-3);
  letter-spacing: -0.015em;
  max-width: 16ch;
  text-wrap: balance;
}
.lede > p {
  max-width: var(--measure);
  color: var(--ink-2);
}
.readout {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: var(--rule) solid var(--ink);
}
.readout > div {
  padding: var(--s3) var(--s3) var(--s3) 0;
}
.readout > div + div {
  border-left: var(--hair) solid var(--line);
  padding-left: var(--s3);
}
dt {
  font-size: var(--step--1);
  color: var(--ink-3);
  min-height: 2.6em;
}
dd {
  margin: 0;
}
.v {
  font-size: var(--step-2);
  font-weight: 800;
  color: var(--sign-blue);
}
.vs,
.small {
  font-size: var(--step--1);
  color: var(--ink-3);
}
.section {
  display: grid;
  gap: var(--s4);
  margin-bottom: var(--s7);
}
h2 {
  font-size: var(--step-2);
}
.note {
  color: var(--ink-2);
  max-width: var(--measure);
}
code {
  font-family: var(--font-plate);
  background: var(--surface-sunk);
  padding: 0 var(--s1);
}
.foot {
  border-top: var(--hair) solid var(--line);
  padding-top: var(--s4);
  font-size: var(--step--1);
  color: var(--ink-3);
  max-width: var(--measure);
}
@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
    gap: var(--s5);
  }
}
@media (max-width: 560px) {
  .page {
    padding: var(--s3);
  }
  .readout {
    grid-template-columns: 1fr;
  }
  .readout > div + div {
    border-left: 0;
    border-top: var(--hair) solid var(--line);
    padding-left: 0;
  }
  h1 {
    font-size: var(--step-2);
  }
  .tag,
  .repo {
    display: none;
  }
}
</style>

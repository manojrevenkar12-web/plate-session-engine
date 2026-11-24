<script setup lang="ts">
import type { Gate } from "../../shared/data/report";

defineProps<{ gates: Gate[] }>();
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(3));
</script>

<template>
  <ul class="gates">
    <li v-for="g in gates" :key="g.name" :class="g.pass ? 'pass' : 'fail'">
      <span class="mark">{{ g.pass ? "Pass" : "Fail" }}</span>
      <span class="name">{{ g.name }}</span>
      <span class="num">{{ fmt(g.value) }} {{ g.op }} {{ fmt(g.limit) }}</span>
    </li>
  </ul>
</template>

<style scoped>
.gates {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: var(--hair) solid var(--line);
}
li {
  display: grid;
  grid-template-columns: 3.4rem 1fr auto;
  gap: var(--s4);
  padding: var(--s2) var(--s3);
  border-bottom: var(--hair) solid var(--line);
  font-size: var(--step--1);
}
.mark {
  font-weight: 700;
}
.pass .mark {
  color: var(--sign-blue);
}
.fail {
  background: var(--signal-soft);
}
.fail .mark {
  color: var(--signal);
}
</style>

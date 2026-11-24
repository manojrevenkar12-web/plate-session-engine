<script setup lang="ts">
import { computed } from "vue";
import { differing } from "../format";

/** A number plate as a scanner read it. Characters that differ from `reference` are marked like road paint. */
const props = withDefaults(defineProps<{ plate: string; reference?: string; country?: string; size?: "s" | "m" }>(), {
  reference: undefined,
  country: "D",
  size: "m",
});
const chars = computed(() => {
  const diff = props.reference ? differing(props.plate, props.reference) : [...props.plate].map(() => false);
  return [...props.plate].map((c, i) => ({ c, off: diff[i] ?? false }));
});
const misread = computed(() => chars.value.some((x) => x.off));
</script>

<template>
  <span class="plate" :class="[`size-${size}`, { misread }]" :aria-label="`plate ${plate}${misread ? ', misread' : ''}`">
    <span class="eu" aria-hidden="true">
      <svg viewBox="0 0 20 20" class="stars"><circle v-for="k in 12" :key="k" :cx="10 + 6 * Math.cos((k * Math.PI) / 6)" :cy="10 + 6 * Math.sin((k * Math.PI) / 6)" r="1.1" /></svg>
      <span class="cc">{{ country }}</span>
    </span>
    <span class="text"><span v-for="(x, i) in chars" :key="i" :class="{ off: x.off }">{{ x.c }}</span></span>
  </span>
</template>

<style scoped>
.plate {
  display: inline-flex;
  align-items: stretch;
  background: var(--plate);
  border: var(--rule) solid var(--plate-edge);
  border-radius: var(--radius-plate);
  overflow: hidden;
  color: #111;
  font-family: var(--font-plate);
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 1;
  white-space: nowrap;
}
.size-m {
  font-size: var(--step-1);
}
.size-s {
  font-size: var(--step--1);
}
.eu {
  background: var(--eu);
  color: #fff;
  display: grid;
  justify-items: center;
  align-content: center;
  padding: 0 0.22em;
  gap: 0.05em;
}
.stars {
  width: 0.8em;
  height: 0.8em;
  fill: #ffd400;
}
.cc {
  font-size: 0.55em;
  font-family: var(--font);
  font-weight: 700;
}
.text {
  padding: 0.28em 0.45em 0.18em;
}
.off {
  background: var(--marking);
  color: #111;
  border-radius: 1px;
  box-shadow: 0 0 0 1px var(--marking);
}
</style>

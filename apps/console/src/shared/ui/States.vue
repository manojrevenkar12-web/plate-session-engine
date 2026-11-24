<script setup lang="ts">
/** Loading, error and empty, in one place so every data view says the same thing the same way. */
defineProps<{ kind: "loading" | "error" | "empty"; title?: string; message?: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="kind === 'loading'" class="loading" role="status" aria-live="polite">
    <span class="bay" v-for="i in 4" :key="i" />
    <span class="label">{{ message ?? "Loading the study results" }}</span>
  </div>
  <div v-else-if="kind === 'error'" class="error" role="alert">
    <p class="title">{{ message }}</p>
    <p class="hint">Run <code>pnpm study</code>, then <code>pnpm --filter @pse/console data</code>, and load it again.</p>
    <button type="button" @click="$emit('retry')">Load the report again</button>
  </div>
  <div v-else class="empty">
    <h3>{{ title }}</h3>
    <p><slot /></p>
  </div>
</template>

<style scoped>
.loading {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--s3);
  padding: var(--s6) 0;
}
.bay {
  height: 5rem;
  border-left: var(--rule) dashed var(--line);
  background: linear-gradient(90deg, transparent, var(--surface), transparent) var(--surface-sunk);
  background-size: 200% 100%;
  animation: sweep 1.4s var(--ease) infinite;
}
.label {
  grid-column: 1 / -1;
  color: var(--ink-3);
}
@keyframes sweep {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
.error {
  border-left: 4px solid var(--signal);
  background: var(--signal-soft);
  padding: var(--s4) var(--s5);
  display: grid;
  gap: var(--s2);
  justify-items: start;
}
.title {
  font-weight: 700;
}
.hint {
  color: var(--ink-2);
}
button {
  font: inherit;
  font-weight: 700;
  background: var(--sign-blue);
  color: #fff;
  border: 0;
  border-radius: var(--radius);
  padding: var(--s2) var(--s4);
  cursor: pointer;
}
.empty {
  border: var(--rule) dashed var(--line);
  padding: var(--s5);
  display: grid;
  gap: var(--s2);
  color: var(--ink-2);
}
.empty h3 {
  color: var(--ink);
  font-size: var(--step-1);
}
code {
  font-family: var(--font-plate);
  background: var(--surface-sunk);
  padding: 0 var(--s1);
}
</style>

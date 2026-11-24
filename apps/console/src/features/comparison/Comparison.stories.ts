import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { Aggregate } from "../../shared/data/report";
import Comparison from "./Comparison.vue";

const base: Aggregate = {
  visits: 100_000,
  collectibleCents: 10_000_000,
  capturedCents: 9_800_000,
  lostCents: 200_000,
  revenueCaptured: 0.98,
  wrongCharges: 5,
  wrongNotices: 20,
  noticesToPayers: 10,
  wrongPer10k: 2.5,
  doubleCharges: 0,
  operatorMinutesPer1k: 32,
  reviews: 3000,
  modelCalls: 800,
  agentAccepted: 500,
  degradedScanners: 30,
  degradedFlagged: 0.9,
  flagLeadHours: 7.5,
  falseDegradedAlarms: 4,
  chargedWithin15: 0.96,
};
const meta: Meta<typeof Comparison> = { title: "Features/Comparison", component: Comparison };
export default meta;
export const FourDesigns: StoryObj<typeof Comparison> = {
  args: {
    order: ["status_quo", "fuzzy_match", "model_alone", "engine"],
    designs: {
      status_quo: { ...base, revenueCaptured: 0.91, wrongPer10k: 378, doubleCharges: 302, operatorMinutesPer1k: 0, lostCents: 1_940_000, chargedWithin15: 0.99 },
      fuzzy_match: { ...base, revenueCaptured: 0.944, wrongPer10k: 149, doubleCharges: 327, operatorMinutesPer1k: 0, lostCents: 1_200_000 },
      model_alone: { ...base, revenueCaptured: 0.947, wrongPer10k: 422, doubleCharges: 320, operatorMinutesPer1k: 0, lostCents: 1_140_000 },
      engine: base,
    },
  },
};

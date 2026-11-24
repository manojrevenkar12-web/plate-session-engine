import { DAY, HOUR, MINUTE } from "./events.js";

export interface Tariff {
  freeMinutes: number;
  centsPerHour: number;
  dailyCapCents: number;
}

/**
 * The fee for a stay: free minutes first; then every started hour; each started 24 hours capped.
 * Integer cents throughout.
 */
export function feeCents(tariff: Tariff, durationMs: number): number {
  if (durationMs <= tariff.freeMinutes * MINUTE) return 0;
  const days = Math.floor(durationMs / DAY);
  const rest = durationMs - days * DAY;
  const restHours = Math.ceil(rest / HOUR);
  const restFee = Math.min(restHours * tariff.centsPerHour, tariff.dailyCapCents);
  return days * tariff.dailyCapCents + restFee;
}

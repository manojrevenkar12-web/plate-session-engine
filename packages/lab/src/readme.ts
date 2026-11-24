import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "@pse/engine";
import { designs } from "./run.js";
import { type Aggregate, type Report, readReport, REPORTS } from "./study.js";

export const START = "<!-- results:start -->";
export const END = "<!-- results:end -->";

const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const eur = (cents: number) => `€${Math.round(cents / 100).toLocaleString("en-GB")}`;

interface Column {
  head: string;
  cell: (a: Aggregate) => string;
}

const COLUMNS: Column[] = [
  { head: "Revenue collected, of what a perfect desk collects", cell: (a) => pct(a.revenueCaptured) },
  { head: "Revenue lost per 1,000 stays", cell: (a) => eur((a.lostCents / a.visits) * 1000) },
  { head: "Wrong charges and notices per 10,000 stays", cell: (a) => a.wrongPer10k.toFixed(1) },
  { head: "Notices to drivers who had paid", cell: (a) => n0(a.noticesToPayers) },
  { head: "Double charges", cell: (a) => n0(a.doubleCharges) },
  { head: "Operator minutes per 1,000 stays", cell: (a) => a.operatorMinutesPer1k.toFixed(1) },
  { head: "Automatic charges within 15 min of exit", cell: (a) => pct(a.chargedWithin15) },
];

function table(r: Report, names: string[]): string {
  const d = designs();
  const head = `| Design | ${COLUMNS.map((c) => c.head).join(" | ")} |`;
  const rule = `|---|${COLUMNS.map(() => "---:").join("|")}|`;
  const rows = names.map((n) => {
    const label = n === "engine" ? `**${d.designs[n]!.label}**` : d.designs[n]!.label;
    return `| ${label} | ${COLUMNS.map((c) => c.cell(r.designs[n]!)).join(" | ")} |`;
  });
  return [head, rule, ...rows].join("\n");
}

function gates(r: Report): string {
  const passed = r.gates.filter((g) => g.pass).length;
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(3));
  return [
    `Release gates: ${passed} of ${r.gates.length} pass.`,
    "",
    "| Gate | Value | Limit | |",
    "|---|---:|---:|---|",
    ...r.gates.map((g) => `| ${g.name} | ${fmt(g.value)} | ${g.op} ${fmt(g.limit)} | ${g.pass ? "pass" : "**fail**"} |`),
  ].join("\n");
}

function health(a: Aggregate): string {
  return `Scanner health: ${n0(a.degradedScanners * a.degradedFlagged)} of ${n0(a.degradedScanners)} degrading scanners flagged (median ${a.flagLeadHours?.toFixed(1) ?? "n/a"} h after the lens began to fail, on a 20 h ramp), ${n0(a.falseDegradedAlarms)} false alarms.`;
}

export function readmeBlock(): string {
  const dev = readReport("dev");
  const held = readReport("heldout");
  const d = designs();
  const out: string[] = ["_Generated from `reports/*.json` by `pnpm readme`; do not edit by hand._", ""];
  if (!dev) return [...out, "No study has run yet: `pnpm study`."].join("\n");
  const e = dev.designs.engine!;
  const sq = dev.designs.status_quo!;
  out.push(
    `**Development world** (seeds ${dev.seeds.join(", ")}; per seed ${n0(dev.sites)} sites, ${n0(dev.scanners)} scanners, two days; ${n0(dev.visits)} stays and ${n0(dev.events)} events in all, about ${n0(dev.events / dev.seeds.length / 48)} an hour per seed)`,
    "",
    table(dev, d.main),
    "",
    `Against exact matching the engine collects ${eur(e.capturedCents - sq.capturedCents)} more over the ${dev.seeds.length} simulated two-day runs, sends ${n0(sq.wrongCharges + sq.wrongNotices - e.wrongCharges - e.wrongNotices)} fewer wrong charges and notices, and no double charge. ${health(e)}`,
    "",
    "**Each safeguard removed on its own** (development world)",
    "",
    table(dev, ["engine", ...d.ablations]),
    "",
    gates(dev),
  );
  if (held) {
    const h = held.designs.engine!;
    out.push(
      "",
      `**Held-out world, run once** (seeds ${held.seeds.join(", ")}; Austrian plates, winter, more airports, more scanners offline and for longer, more misreads and typos; config ${held.configHash})`,
      "",
      table(held, d.main),
      "",
      health(h),
      "",
      gates(held),
    );
  } else {
    out.push("", "The held-out world has not been run.");
  }
  const benchFile = join(REPORTS, "bench.json");
  if (existsSync(benchFile)) {
    const b = JSON.parse(readFileSync(benchFile, "utf8")) as { engine?: { eventsPerSecond: number; machine: string }; api?: { readsPerSecond: number; p99ms: number; store: string; queue: string } };
    out.push("");
    if (b.engine) out.push(`Throughput, measured (not simulated) on ${b.engine.machine}: the engine decides ${n0(b.engine.eventsPerSecond)} events a second on one core.`);
    if (b.api) out.push(`The NestJS ingest endpoint takes ${n0(b.api.readsPerSecond)} reads a second, p99 ${b.api.p99ms.toFixed(1)} ms (${b.api.store}, ${b.api.queue}).`);
  }
  return out.join("\n");
}

export function writeReadme(): boolean {
  const file = join(ROOT, "README.md");
  const text = readFileSync(file, "utf8");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < 0) throw new Error("README has no results block");
  const next = text.slice(0, a + START.length) + "\n\n" + readmeBlock() + "\n\n" + text.slice(b);
  writeFileSync(file, next);
  return next !== text;
}

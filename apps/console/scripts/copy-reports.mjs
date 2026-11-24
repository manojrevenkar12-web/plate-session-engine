// Assembles the console's data from the generated reports. Never hand-edited; regenerated on dev, build and test.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => (existsSync(join(root, p)) ? JSON.parse(readFileSync(join(root, p), "utf8")) : null);
const designs = read("config/designs.json");
const data = {
  dev: read("reports/dev.json"),
  heldout: read("reports/heldout.json"),
  lock: read("reports/heldout.lock"),
  bench: read("reports/bench.json"),
  order: { main: designs.main, ablations: designs.ablations },
  labels: Object.fromEntries(Object.entries(designs.designs).map(([k, v]) => [k, v.label])),
};
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "report.json"), JSON.stringify(data));
console.log("console data written");

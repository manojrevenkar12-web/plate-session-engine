import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { benchEngine } from "./bench.js";
import { writeReadme } from "./readme.js";
import { configHash, LOCK, readReport, REPORTS, study, writeReport } from "./study.js";

const [cmd, ...args] = process.argv.slice(2);
const world = (args[args.indexOf("--world") + 1] ?? "dev") as "dev" | "heldout";

if (cmd === "study") {
  if (world === "heldout") {
    if (existsSync(LOCK)) {
      console.error(`The held-out world already ran (${readFileSync(LOCK, "utf8").trim()}). It runs once.`);
      process.exit(3);
    }
    const dev = readReport("dev");
    if (!dev || dev.configHash !== configHash() || dev.gates.some((g) => !g.pass)) {
      console.error("Run the dev study on the current config, with every gate passing, before the held-out world.");
      process.exit(2);
    }
  }
  const r = study(world, (s) => console.log(s));
  writeReport(r);
  if (world === "heldout") writeFileSync(LOCK, JSON.stringify({ seeds: r.seeds, configHash: r.configHash }) + "\n");
  for (const g of r.gates) console.log(`${g.pass ? "PASS" : "FAIL"} ${g.name}: ${g.value} ${g.op} ${g.limit}`);
  process.exit(world === "dev" && r.gates.some((g) => !g.pass) ? 1 : 0);
} else if (cmd === "readme") {
  console.log(writeReadme() ? "README results block updated" : "README results block unchanged");
} else if (cmd === "bench") {
  const file = join(REPORTS, "bench.json");
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const engine = benchEngine();
  writeFileSync(file, JSON.stringify({ ...prev, engine }, null, 1) + "\n");
  console.log(engine);
} else {
  console.error("usage: cli.ts study --world dev|heldout | readme | bench");
  process.exit(64);
}

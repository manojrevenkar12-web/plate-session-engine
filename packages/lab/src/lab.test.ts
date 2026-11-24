import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "@pse/engine";
import { simulate, worldConfig } from "@pse/world";
import { describe, expect, it } from "vitest";
import { designs, runDesign } from "./run.js";
import { LOCK, readReport } from "./study.js";

const sources = (pkg: string) => {
  const dir = join(ROOT, pkg);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.name === "node_modules" || f.name === "generated" || f.name === "dist") continue;
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(ts|vue)$/.test(f.name)) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
};

describe("invariants", () => {
  it("keeps the truth in the world: no product package imports the world or the lab", () => {
    for (const pkg of ["packages/domain", "packages/engine", "packages/store", "apps/api", "apps/console/src"]) {
      for (const f of sources(pkg)) {
        if (f.endsWith(".test.ts") && pkg === "apps/api") continue;
        expect(readFileSync(f, "utf8"), f).not.toMatch(/from "@pse\/(world|lab)"/);
      }
    }
  });

  it("gives every design the same luck", () => {
    const c = worldConfig("dev");
    const w = simulate({ ...c, days: 1, sites: { ...c.sites, count: 10 } }, 11);
    const d = designs();
    const a = runDesign(w, d.designs.engine!).score;
    const b = runDesign(w, d.designs.engine!).score;
    expect(a).toEqual(b);
    const sq = runDesign(w, d.designs.status_quo!).score;
    expect(sq.visits).toBe(a.visits);
    expect(sq.collectibleCents).toBe(a.collectibleCents);
    expect(a.wrongPer10k).toBeLessThan(sq.wrongPer10k);
  });
});

describe("the held-out rule", () => {
  it("runs the held-out world once", () => {
    if (!existsSync(LOCK)) return;
    const r = spawnSync("pnpm", ["exec", "tsx", "packages/lab/src/cli.ts", "study", "--world", "heldout"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(3);
  });

  it("froze the config the held-out world ran on", () => {
    if (!existsSync(LOCK)) return;
    const lock = JSON.parse(readFileSync(LOCK, "utf8")) as { configHash: string };
    expect(readReport("heldout")?.configHash).toBe(lock.configHash);
    expect(readReport("dev")?.configHash).toBe(lock.configHash);
  });

  it("commits the lock in one commit at most", () => {
    if (!existsSync(LOCK) || !existsSync(join(ROOT, ".git"))) return;
    const log = execFileSync("git", ["log", "--format=%H", "--", "reports/heldout.lock"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(log === "" ? 0 : log.split("\n").length).toBeLessThanOrEqual(1);
  });
});

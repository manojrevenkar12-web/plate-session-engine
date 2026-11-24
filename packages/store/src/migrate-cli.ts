/** Applies the committed migration to DATABASE_URL, from scratch. For local runs and benchmarks only. */
import { applyMigration } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("set DATABASE_URL");
await applyMigration(url);
console.log("schema applied");

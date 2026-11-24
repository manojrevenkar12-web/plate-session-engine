import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Applies the committed SQL migration to an empty database (tests and local runs; production uses `prisma migrate deploy`). */
export async function applyMigration(url: string): Promise<void> {
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations", "0001_init", "migration.sql"), "utf8");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

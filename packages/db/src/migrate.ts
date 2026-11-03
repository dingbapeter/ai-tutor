import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/**
 * Self-applying migrations: the api runs this at boot, so a deploy IS the
 * database setup. Nobody has to run psql by hand, ever.
 *
 * A ledger table records which files have been applied; each pending file
 * runs inside its own transaction and is recorded in that same transaction,
 * so a crash mid-way leaves the ledger exactly truthful and the next boot
 * resumes where this one stopped. Files apply in name order (0000..., 0001...).
 */
export async function runMigrations(
  url: string,
  dir: string,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  // Notices like "already exists, skipping" are expected small talk from
  // idempotent DDL; they never belong in the boot log.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamp not null default now()
      )`;
    const done = new Set(
      (await sql`select filename from schema_migrations`).map((r) => r.filename as string),
    );
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const text = readFileSync(join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
      applied.push(file);
      log(`migration applied: ${file}`);
    }
    return applied;
  } finally {
    await sql.end();
  }
}

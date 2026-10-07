import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createGatewayFromEnv } from "@tutor/ai-gateway";
import { runMigrations } from "@tutor/db";
import { buildApp } from "./app.js";
import type { Store } from "./store/types.js";
import { MemoryStore } from "./store/memory.js";
import { PostgresStore } from "./store/postgres.js";
import { PACK_IDS } from "./tutor/prompt.js";

const gateway = createGatewayFromEnv();

let store: Store;
if (process.env.DATABASE_URL) {
  // A deploy IS the database setup: pending migrations apply themselves
  // before the server takes traffic, so nobody ever runs psql by hand.
  // A failed migration fails the boot loudly; with a healthcheck in front,
  // the previous deploy keeps serving.
  if (process.env.AUTO_MIGRATE !== "off") {
    const migrationsDir =
      process.env.MIGRATIONS_DIR ??
      join(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations");
    try {
      const applied = await runMigrations(process.env.DATABASE_URL, migrationsDir, console.log);
      console.log(applied.length ? `migrations: ${applied.length} applied` : "migrations: up to date");
    } catch (err) {
      console.error("migration failed, refusing to start on a half-built database:", err);
      process.exit(1);
    }
  }
  const pg = new PostgresStore(process.env.DATABASE_URL);
  await pg.seedSkills([...PACK_IDS]);
  store = pg;
} else {
  store = new MemoryStore();
}

const app = await buildApp({ gateway, store });

// Railway injects PORT; API_PORT covers local/dev overrides.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });

// Graceful shutdown so in-flight generations finish and connections drain
// when Railway restarts/redeploys the service.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}

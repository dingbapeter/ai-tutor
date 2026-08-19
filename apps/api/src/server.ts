import { createGatewayFromEnv } from "@tutor/ai-gateway";
import { buildApp } from "./app.js";
import type { Store } from "./store/types.js";
import { MemoryStore } from "./store/memory.js";
import { PostgresStore } from "./store/postgres.js";
import { PACK_IDS } from "./tutor/prompt.js";

const gateway = createGatewayFromEnv();

let store: Store;
if (process.env.DATABASE_URL) {
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

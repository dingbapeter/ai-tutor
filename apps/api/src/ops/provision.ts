import { randomBytes } from "node:crypto";
import webpush from "web-push";
import type { Store } from "../store/types.js";

/**
 * Self-provisioned secrets: zero-terminal deploys.
 *
 * When the platform runs on a real database and a secret is not supplied by
 * the environment, it is generated once, stored in platform settings, and
 * reused on every restart and every instance. An env var, when set, always
 * wins (so a founder can rotate a key by setting it). The admin key is shown
 * to the OWNER in the Command Centre's Ops tab; it never has to be created
 * by hand in a terminal.
 */
export async function provisionSecrets(
  store: Store,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (!env.ADMIN_KEY) {
    const saved = await store.getSetting("secret.adminKey");
    if (typeof saved === "string" && saved.length >= 32) {
      env.ADMIN_KEY = saved;
    } else {
      env.ADMIN_KEY = randomBytes(32).toString("hex");
      await store.setSetting("secret.adminKey", env.ADMIN_KEY, null);
    }
  }

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    const saved = (await store.getSetting("secret.vapid")) as
      | { publicKey?: string; privateKey?: string }
      | null;
    if (saved?.publicKey && saved?.privateKey) {
      env.VAPID_PUBLIC_KEY = saved.publicKey;
      env.VAPID_PRIVATE_KEY = saved.privateKey;
    } else {
      const pair = webpush.generateVAPIDKeys();
      env.VAPID_PUBLIC_KEY = pair.publicKey;
      env.VAPID_PRIVATE_KEY = pair.privateKey;
      await store.setSetting("secret.vapid", pair, null);
    }
  }
}

/**
 * The app is its own alarm clock. Given a moment in time, which product
 * jobs are due? Pure, so the clock logic is testable without waiting for
 * mornings or Sundays. The caller still has to win the daily claim in the
 * store before running a job, which is what stops two instances of the api
 * from both sending the same digest.
 */
export function dueJobs(now: Date, nudgeHourUtc: number, digestHourUtc: number): string[] {
  const due: string[] = [];
  if (now.getUTCHours() === nudgeHourUtc) due.push("nudge");
  if (now.getUTCDay() === 0 && now.getUTCHours() === digestHourUtc) due.push("digest");
  return due;
}

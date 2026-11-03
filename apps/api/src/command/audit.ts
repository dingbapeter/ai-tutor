import type { Store } from "../store/types.js";
import type { StaffRole } from "./rbac.js";

/**
 * Records a privileged action. Every write path through the Command Centre
 * calls this. Failures are swallowed deliberately: an audit write must never
 * be the reason a support agent cannot help a family, but it is attempted on
 * every action so the trail is complete in practice.
 */
export async function audit(
  store: Store,
  actor: { userId: string; email: string; role: StaffRole },
  action: string,
  opts: { target?: string; meta?: Record<string, unknown>; ip?: string } = {},
): Promise<void> {
  try {
    await store.recordAudit({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      actorRole: actor.role,
      action,
      target: opts.target,
      meta: opts.meta ?? {},
      ip: opts.ip,
    });
  } catch {
    // never block the action
  }
}

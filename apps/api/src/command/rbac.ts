/**
 * Who can see what in the Command Centre.
 *
 * The hard rule this file exists to enforce: INVESTORS SEE AGGREGATES ONLY.
 * No learner name, no email, no transcript, no incident detail, ever. That is
 * checked here, at the API layer, not hidden in the UI, because a UI that
 * merely omits a button is not access control.
 */

export const STAFF_ROLES = ["owner", "admin", "finance", "support", "staff", "investor"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Capability =
  /** Aggregate platform metrics: counts, trends, rates. No individuals. */
  | "metrics:read"
  /** Revenue in aggregate: MRR, plan mix, churn rate. No customer identities. */
  | "finance:aggregate"
  /** Individual subscriptions, payers, refunds. Identifies customers. */
  | "finance:detail"
  /** Learner and guardian records, including names and emails. */
  | "people:read"
  /** Act on an account: change plan, suspend, resolve a support case. */
  | "people:write"
  /** Safety incidents with excerpts. The most sensitive surface we have. */
  | "safety:read"
  /** Staff roster and who holds which role. */
  | "staff:read"
  /** Add, change or suspend staff. */
  | "staff:write"
  /** Platform configuration and operational switches. */
  | "config:write"
  /** The audit trail. */
  | "audit:read";

const MATRIX: Record<StaffRole, Capability[]> = {
  owner: [
    "metrics:read", "finance:aggregate", "finance:detail", "people:read", "people:write",
    "safety:read", "staff:read", "staff:write", "config:write", "audit:read",
  ],
  admin: [
    "metrics:read", "finance:aggregate", "finance:detail", "people:read", "people:write",
    "safety:read", "staff:read", "config:write", "audit:read",
  ],
  finance: ["metrics:read", "finance:aggregate", "finance:detail", "audit:read"],
  support: ["metrics:read", "people:read", "people:write", "safety:read"],
  staff: ["metrics:read"],
  // The investor role is deliberately the smallest surface in the system.
  investor: ["metrics:read", "finance:aggregate"],
};

export function capabilitiesFor(role: StaffRole): Capability[] {
  return MATRIX[role] ?? [];
}

export function can(role: StaffRole, capability: Capability): boolean {
  return capabilitiesFor(role).includes(capability);
}

/** Roles that must never receive personally identifying data, in any shape. */
export const AGGREGATE_ONLY_ROLES: StaffRole[] = ["investor", "staff"];

export function isAggregateOnly(role: StaffRole): boolean {
  return AGGREGATE_ONLY_ROLES.includes(role);
}

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * Comp access grants — free elevated use (e.g. the "unlimited" plan) that a
 * team member must be EXPLICITLY given, never inherited by being on staff.
 *
 * Two guards keep it from becoming abuse:
 *  - it can be time-boxed (expiresAt), so a tester's access ends on its own
 *    when the testing window closes;
 *  - it is tied to a monthly performance review. Each grant carries a
 *    nextReviewAt; once that passes with no review, the grant LAPSES and the
 *    person falls back to their real plan until a reviewer renews it. Access
 *    is therefore continuously justified against performance, not granted
 *    once and forgotten.
 *
 * Pure functions here so the rules are testable without a database or a clock.
 */

import type { AccessGrant } from "../store/types.js";
export type { AccessGrant };

export type GrantStatus = "active" | "revoked" | "expired" | "review_overdue";

/** Why a grant is or is not currently giving access. */
export function grantStatus(grant: AccessGrant, now: Date): GrantStatus {
  if (grant.revokedAt) return "revoked";
  if (grant.expiresAt && grant.expiresAt <= now) return "expired";
  if (grant.nextReviewAt && grant.nextReviewAt <= now) return "review_overdue";
  return "active";
}

/** Only an active grant grants access; everything else falls back to the real plan. */
export function grantGivesAccess(grant: AccessGrant, now: Date): boolean {
  return grantStatus(grant, now) === "active";
}

/** When the next monthly review is due, given the interval. */
export function nextReviewFrom(now: Date, intervalDays: number): Date {
  return new Date(now.getTime() + intervalDays * 86_400_000);
}

export const REVIEW_DECISIONS = ["renew", "revoke", "keep"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const PERFORMANCE_RATINGS = ["exceeds", "meets", "below", "unsatisfactory"] as const;
export type PerformanceRating = (typeof PERFORMANCE_RATINGS)[number];

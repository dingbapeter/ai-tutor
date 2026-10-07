import type { Store } from "../store/types.js";

/**
 * Platform controls: the switches the Command Centre can flip without a
 * deploy. Each one is honoured on the request path, so nothing here is a
 * label on a dead toggle.
 *
 *   signupsPaused   /auth/register refuses new accounts, with the reason.
 *   notice          A line shown to everyone in the app until it is cleared.
 *
 * Values are read on every request that cares, behind a short cache so a busy
 * platform does not query the settings table thousands of times a minute. The
 * cache is cleared the moment a setting is written, so the operator who flips
 * a switch sees it take effect immediately rather than up to a minute later.
 */

export interface PlatformControls {
  signupsPaused: boolean;
  /** Shown to signups while paused, and in the app banner. */
  signupsPausedReason: string;
  notice: string;
  noticeLevel: "info" | "warn";
}

export const DEFAULT_CONTROLS: PlatformControls = {
  signupsPaused: false,
  signupsPausedReason: "We have paused new signups for a short while. Please try again soon.",
  notice: "",
  noticeLevel: "info",
};

const SETTINGS_KEY = "controls";
const CACHE_MS = 10_000;

export class ControlsReader {
  private cached: { at: number; value: PlatformControls } | null = null;

  constructor(private store: Store) {}

  async get(): Promise<PlatformControls> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    let value = DEFAULT_CONTROLS;
    try {
      const stored = await this.store.getSetting(SETTINGS_KEY);
      if (stored && typeof stored === "object") value = normalize(stored as Record<string, unknown>);
    } catch {
      // A settings read must never take the platform down; defaults are safe.
    }
    this.cached = { at: Date.now(), value };
    return value;
  }

  async set(patch: Partial<PlatformControls>, actorUserId: string): Promise<PlatformControls> {
    const next = normalize({ ...(await this.get()), ...patch } as Record<string, unknown>);
    await this.store.setSetting(SETTINGS_KEY, next, actorUserId);
    this.cached = { at: Date.now(), value: next };
    return next;
  }

  /** Drops the cache so the next read hits the store. */
  forget() {
    this.cached = null;
  }
}

const NOTICE_MAX = 280;

/** Coerces anything stored (or posted) into a valid, bounded control set. */
export function normalize(raw: Record<string, unknown>): PlatformControls {
  const text = (v: unknown, fallback: string) => {
    const s = typeof v === "string" ? v.trim() : "";
    return (s || fallback).slice(0, NOTICE_MAX);
  };
  return {
    signupsPaused: raw.signupsPaused === true,
    signupsPausedReason: text(raw.signupsPausedReason, DEFAULT_CONTROLS.signupsPausedReason),
    notice: typeof raw.notice === "string" ? raw.notice.trim().slice(0, NOTICE_MAX) : "",
    noticeLevel: raw.noticeLevel === "warn" ? "warn" : "info",
  };
}

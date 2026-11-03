/**
 * Referral capture: a friend's link lands anywhere on the site with ?ref=CODE.
 * The code is remembered until an account is actually created, so the visitor
 * can wander (or come back tomorrow) and the inviter still gets the credit.
 * Pure helpers, so the rules are testable without a browser.
 */

const KEY = "dingba_ref";

/** Extracts a plausible referral code from a query string, or null. */
export function refFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get("ref");
  if (!raw) return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9]{4,32}$/.test(code) ? code : null;
}

export function rememberRef(search: string): void {
  const code = refFromSearch(search);
  if (!code) return;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // storage unavailable (private mode): the signup just goes uncredited
  }
}

export function storedRef(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearRef(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear if storage never worked
  }
}

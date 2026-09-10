import { afterEach, describe, expect, it } from "vitest";
import { clearRef, refFromSearch, rememberRef, storedRef } from "../app/referral";

// A minimal localStorage so the remember/clear pair is testable in node.
const backing = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, v),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: () => null,
  length: 0,
} as Storage;

afterEach(() => backing.clear());

describe("referral capture", () => {
  it("accepts real codes and normalises case", () => {
    expect(refFromSearch("?ref=abc23xyz")).toBe("abc23xyz");
    expect(refFromSearch("?utm=x&ref=ABC23XYZ")).toBe("abc23xyz");
  });

  it("rejects junk: missing, too short, or url-hostile", () => {
    expect(refFromSearch("")).toBeNull();
    expect(refFromSearch("?ref=")).toBeNull();
    expect(refFromSearch("?ref=ab")).toBeNull();
    expect(refFromSearch("?ref=abc%20def")).toBeNull();
    expect(refFromSearch("?ref=<script>")).toBeNull();
  });

  it("remembers a code across pages until signup clears it", () => {
    rememberRef("?ref=abc23xyz");
    expect(storedRef()).toBe("abc23xyz");
    rememberRef("?ref=<junk>"); // junk never overwrites a good code
    expect(storedRef()).toBe("abc23xyz");
    clearRef();
    expect(storedRef()).toBeNull();
  });
});

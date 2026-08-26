"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;

/**
 * A line from the Command Centre, shown to everyone until it is cleared.
 * Fetched once per page load; a failure means no banner, never a broken app.
 */
function PlatformNotice() {
  const [notice, setNotice] = useState<{ text: string; level: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/platform`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (alive && b?.notice) setNotice({ text: b.notice, level: b.noticeLevel });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!notice) return null;
  return <div className={`platform-notice${notice.level === "warn" ? " warn" : ""}`}>{notice.text}</div>;
}

/** Top app bar. Hidden while a session is live (body[data-session] set by the
 * home screen) so the tutor gets the whole screen. */
export default function Chrome() {
  const path = usePathname();
  // The Command Centre carries its own chrome; the learner bar has no place there.
  if (path.startsWith("/command")) return null;
  return (
    <>
      <header className="appbar">
        <a href="/" className="wordmark">
          Dingba<span>.</span>
        </a>
        <nav>
          <a href="/learn" className={path.startsWith("/learn") ? "on" : ""}>Learn</a>
          <a href="/account" className={path.startsWith("/account") ? "on" : ""}>Account</a>
        </nav>
      </header>
      <PlatformNotice />
    </>
  );
}

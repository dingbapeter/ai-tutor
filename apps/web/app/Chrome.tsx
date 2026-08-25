"use client";

import { usePathname } from "next/navigation";

/** Top app bar. Hidden while a session is live (body[data-session] set by the
 * home screen) so the tutor gets the whole screen. */
export default function Chrome() {
  const path = usePathname();
  // The Command Centre carries its own chrome; the learner bar has no place there.
  if (path.startsWith("/command")) return null;
  return (
    <header className="appbar">
      <a href="/" className="wordmark">
        Dingba<span>.</span>
      </a>
      <nav>
        <a href="/learn" className={path.startsWith("/learn") ? "on" : ""}>Learn</a>
        <a href="/account" className={path.startsWith("/account") ? "on" : ""}>Account</a>
      </nav>
    </header>
  );
}

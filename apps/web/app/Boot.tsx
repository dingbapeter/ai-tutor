"use client";

import { useEffect, useState } from "react";

/** Registers the service worker and shows an offline banner when the network drops. */
export default function Boot() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline) return null;
  return (
    <div style={{ background: "#1a1a2e", color: "#fff", textAlign: "center", padding: "6px 12px", fontSize: 14 }}>
      📶 You&apos;re offline — messages will send when the connection returns.
    </div>
  );
}

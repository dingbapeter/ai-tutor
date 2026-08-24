"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL!;

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"working" | "done" | "failed">("working");

  useEffect(() => {
    if (!token) {
      setState("failed");
      return;
    }
    fetch(`${API}/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => setState(res.ok ? "done" : "failed"))
      .catch(() => setState("failed"));
  }, [token]);

  return (
    <main className="shell" style={{ maxWidth: 480, textAlign: "center", paddingTop: 60 }}>
      {state === "working" && <p>Confirming your email…</p>}
      {state === "done" && (
        <div className="card fadeUp">
          <h1>Email confirmed ✅</h1>
          <p>Recaps and safety alerts will reach this inbox from now on.</p>
          <p><a href="/account">Go to your dashboard</a></p>
        </div>
      )}
      {state === "failed" && (
        <div className="card fadeUp">
          <h1>That link didn&apos;t work</h1>
          <p>It may have expired (links last 24 hours) or already been used.</p>
          <p>You can request a fresh one from the banner on your <a href="/account">account page</a>.</p>
        </div>
      )}
    </main>
  );
}

export default function Verify() {
  return (
    <Suspense fallback={<main className="shell" style={{ maxWidth: 480, textAlign: "center", paddingTop: 60 }}><p>Loading…</p></main>}>
      <VerifyInner />
    </Suspense>
  );
}

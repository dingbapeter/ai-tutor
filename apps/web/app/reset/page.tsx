"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL!;

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      const res = await fetch(`${API}/auth/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "reset failed");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "reset failed");
    }
  }

  if (!token) return <p>This page needs the link from your reset email.</p>;
  if (done)
    return (
      <p>
        ✅ Password changed — <a href="/account" style={{ color: "#2b4c8c" }}>sign in with your new password</a>.
      </p>
    );
  return (
    <>
      {error && <p style={{ background: "#fdecec", color: "#9d2b2b", borderRadius: 8, padding: "10px 14px" }}>{error}</p>}
      <label style={{ display: "block", margin: "14px 0 6px", fontWeight: 600 }}>New password (8+ characters)</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccd3e0", fontSize: 15, boxSizing: "border-box" }} />
      <button onClick={submit}
        style={{ marginTop: 16, width: "100%", padding: "10px 18px", borderRadius: 8, border: "none", background: "#2b4c8c", color: "#fff", fontSize: 15, cursor: "pointer" }}>
        Set new password
      </button>
    </>
  );
}

export default function Reset() {
  return (
    <main style={{ maxWidth: 420, margin: "48px auto", padding: 16 }}>
      <h1>Choose a new password</h1>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(20,30,60,.08)" }}>
        <Suspense fallback={<p>…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}

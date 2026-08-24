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
        Password changed. <a href="/account">Sign in with your new password</a>.
      </p>
    );
  return (
    <>
      {error && <p className="err">{error}</p>}
      <label className="lbl">New password (8+ characters)</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className="inp" />
      <button onClick={submit} className="btn big" style={{ marginTop: 16 }}>
        Set new password
      </button>
    </>
  );
}

export default function Reset() {
  return (
    <main className="shell" style={{ maxWidth: 440 }}>
      <h1>Choose a new password</h1>
      <div className="card">
        <Suspense fallback={<p>…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}

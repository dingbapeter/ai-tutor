"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "../i18n";

const API = process.env.NEXT_PUBLIC_API_URL!;

function ResetForm() {
  const { t, tx } = useLang();
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
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? t("The password could not be changed."));
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("The password could not be changed."));
    }
  }

  if (!token) return <p>{t("This page needs the link from your reset email.")}</p>;
  if (done)
    return (
      <p>
        {tx("Password changed. {signIn}.", { signIn: <a href="/account">{t("Sign in with your new password")}</a> })}
      </p>
    );
  return (
    <>
      {error && <p className="err">{error}</p>}
      <label className="lbl">{t("New password")} <small>{t("(8+ characters)")}</small></label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} className="inp" />
      <button onClick={submit} className="btn big" style={{ marginTop: 16 }}>
        {t("Set new password")}
      </button>
    </>
  );
}

export default function Reset() {
  const { t } = useLang();
  return (
    <main className="shell" style={{ maxWidth: 440 }}>
      <h1>{t("Choose a new password")}</h1>
      <div className="card">
        <Suspense fallback={<p>…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}

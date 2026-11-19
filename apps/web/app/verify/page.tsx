"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "../i18n";

const API = process.env.NEXT_PUBLIC_API_URL!;

function VerifyInner() {
  const { t, tx } = useLang();
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
      {state === "working" && <p>{t("Confirming your email…")}</p>}
      {state === "done" && (
        <div className="card fadeUp">
          <h1>{t("Email confirmed")} ✅</h1>
          <p>{t("Recaps and safety alerts will reach this inbox from now on.")}</p>
          <p><a href="/account">{t("Go to your dashboard")}</a></p>
        </div>
      )}
      {state === "failed" && (
        <div className="card fadeUp">
          <h1>{t("That link did not work")}</h1>
          <p>{t("It may have expired (links last 24 hours) or already been used.")}</p>
          <p>{tx("You can request a fresh one from the banner on your {accountPage}.", { accountPage: <a href="/account">{t("account page")}</a> })}</p>
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

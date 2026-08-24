"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;

interface Credit {
  name: string;
  by?: string;
  license: string;
  role: string;
  url?: string;
}

export default function Credits() {
  const [credits, setCredits] = useState<Credit[]>([]);
  const [planned, setPlanned] = useState<Credit[]>([]);

  useEffect(() => {
    fetch(`${API}/credits`)
      .then((r) => r.json())
      .then((d) => {
        setCredits(d.credits ?? []);
        setPlanned(d.planned ?? []);
      })
      .catch(() => {});
  }, []);

  return (
    <main className="shell wide">
      <h1>Built on open work 💙</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Dingba exists because brilliant people share their work openly.
        We credit them with joy, and we self-host what their licenses allow.
        That is how we keep tutoring affordable for every family.
      </p>
      {credits.map((c) => (
        <div key={c.name} className="card" style={{ padding: "12px 16px", marginBottom: 8 }}>
          <b>{c.url ? <a href={c.url}>{c.name}</a> : c.name}</b>
          {c.by && <span style={{ color: "var(--text-dim)" }}> by {c.by}</span>}
          <span style={{ float: "right", fontSize: 12, background: "var(--brand-soft)", color: "var(--brand-strong)", borderRadius: 6, padding: "2px 8px" }}>{c.license}</span>
          <div style={{ fontSize: 14, marginTop: 4 }}>{c.role}</div>
        </div>
      ))}
      {planned.length > 0 && (
        <>
          <h3>Coming soon to the platform</h3>
          {planned.map((c) => (
            <div key={c.name} style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 4 }}>
              {c.name} ({c.license}): {c.role}
            </div>
          ))}
        </>
      )}
    </main>
  );
}

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
    <main style={{ maxWidth: 720, margin: "32px auto", padding: 16 }}>
      <h1>Built on open work 💙</h1>
      <p>
        This platform exists because brilliant people share their work openly.
        We credit them with joy, and we self-host what their licenses allow —
        which is how we keep tutoring affordable for every family.
      </p>
      {credits.map((c) => (
        <div key={c.name} style={{ background: "#fff", borderRadius: 10, padding: "12px 16px", marginBottom: 8, boxShadow: "0 1px 3px rgba(20,30,60,.07)" }}>
          <b>{c.url ? <a href={c.url} style={{ color: "#2b4c8c" }}>{c.name}</a> : c.name}</b>
          {c.by && <span style={{ color: "#68718a" }}> — {c.by}</span>}
          <span style={{ float: "right", fontSize: 12, background: "#eef1f8", borderRadius: 6, padding: "2px 8px" }}>{c.license}</span>
          <div style={{ fontSize: 14, marginTop: 4 }}>{c.role}</div>
        </div>
      ))}
      {planned.length > 0 && (
        <>
          <h3>Coming soon to the platform</h3>
          {planned.map((c) => (
            <div key={c.name} style={{ fontSize: 14, color: "#68718a", marginBottom: 4 }}>
              {c.name} ({c.license}) — {c.role}
            </div>
          ))}
        </>
      )}
      <p><a href="/" style={{ color: "#68718a" }}>← back to tutoring</a></p>
    </main>
  );
}

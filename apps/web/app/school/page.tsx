"use client";

import { useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;

interface Mastery {
  skillId: string;
  title?: string;
  level: number;
  attempts: number;
}
interface SessionSummary {
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
}
interface Incident {
  severity: string;
  categories: string[];
  createdAt: string;
}
interface RosterStudent {
  id: string;
  displayName: string;
  mastery: Mastery[];
  sessions: SessionSummary[];
  safety: Incident[];
}
interface Dashboard {
  org: { name: string; seats: number; seatsUsed: number };
  students: RosterStudent[];
}

/** A raw skill id reads as words in front of a teacher, never as an id. */
function skillWords(skillId: string): string {
  const words = skillId.split(".").slice(1).join(" ").replace(/-/g, " ").trim() || skillId;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

export default function SchoolPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [noOrg, setNoOrg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [seats, setSeats] = useState("30");
  const [names, setNames] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (t: string) => {
    setError(null);
    const res = await fetch(`${API}/orgs/dashboard`, { headers: { authorization: `Bearer ${t}` } });
    if (res.status === 404) {
      setNoOrg(true);
      setDash(null);
      return;
    }
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? `could not load (${res.status})`);
      return;
    }
    setNoOrg(false);
    setDash((await res.json()) as Dashboard);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem("tutor_token");
    setToken(t);
    setChecked(true);
    if (t) void load(t);
  }, [load]);

  async function createOrg() {
    if (!token || !orgName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/orgs`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: orgName.trim(), seats: Math.max(1, Math.min(10000, Number(seats) || 30)) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "could not create the organization");
      await load(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not create the organization");
    } finally {
      setBusy(false);
    }
  }

  async function importRoster() {
    if (!token) return;
    const list = names
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 500);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API}/orgs/roster`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ names: list }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "could not import the roster");
      setNames("");
      setNotice(`Added ${json.added.length} learner${json.added.length === 1 ? "" : "s"}.`);
      await load(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not import the roster");
    } finally {
      setBusy(false);
    }
  }

  if (!checked) return null;

  if (!token) {
    return (
      <main className="shell" style={{ maxWidth: 520 }}>
        <h1>School portal</h1>
        <div className="card">
          <p>
            Run a school, a class, or a tutoring group? Sign in first, then this page becomes your
            staff room: import your roster, and see every learner&apos;s progress, activity, and
            safety picture in one place.
          </p>
          <p>
            <a className="btn" href="/account">Sign in or create an account</a>
          </p>
        </div>
      </main>
    );
  }

  if (noOrg) {
    return (
      <main className="shell" style={{ maxWidth: 560 }}>
        <h1>Set up your school</h1>
        <div className="card">
          <p>
            Name your organization and choose how many learner seats you need. Each seat is one
            learner on your roster; you can add learners any time until the seats run out.
          </p>
          <label className="lbl">Organization name</label>
          <input className="inp" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Sunrise Academy" />
          <label className="lbl">Seats</label>
          <input className="inp" value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" style={{ maxWidth: 120 }} />
          <button className="btn" disabled={busy || orgName.trim().length < 2} onClick={createOrg} style={{ marginTop: 14 }}>
            Create organization
          </button>
          {error && <p className="err">{error}</p>}
        </div>
      </main>
    );
  }

  if (!dash) return <main className="shell"><p>{error ?? "Opening the staff room."}</p>{error && <button className="btn quiet small" onClick={() => token && load(token)}>Try again</button>}</main>;

  const flagged = dash.students.filter((s) => s.safety.some((i) => i.severity === "danger")).length;

  return (
    <main className="shell wide">
      <h1>{dash.org.name}</h1>
      <p style={{ color: "var(--text-dim)", marginTop: -6 }}>
        {dash.org.seatsUsed} of {dash.org.seats} seats in use
        {flagged > 0 ? ` · ${flagged} learner${flagged === 1 ? "" : "s"} with a safety flag that needs your eyes` : ""}
      </p>

      <div className="card">
        <b>Add learners</b>
        <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "4px 0 8px" }}>
          One name per line. Each becomes a learner profile your tutors remember; open any of them
          from the Learn page under &ldquo;Who&apos;s learning today?&rdquo;.
        </p>
        <textarea
          className="inp"
          rows={3}
          value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder={"Ada O.\nBen K."}
          style={{ width: "100%", resize: "vertical" }}
        />
        <button className="btn" disabled={busy || !names.trim()} onClick={importRoster} style={{ marginTop: 10 }}>
          Add to roster
        </button>
        {notice && <p style={{ color: "var(--ok)", fontSize: 14 }}>{notice}</p>}
        {error && <p className="err">{error}</p>}
      </div>

      {dash.students.length === 0 ? (
        <div className="card"><p className="cc-empty" style={{ margin: 0 }}>No learners yet. Import your roster above and this page comes alive.</p></div>
      ) : (
        dash.students.map((s) => {
          const worked = s.mastery.filter((m) => m.attempts > 0);
          const strong = [...worked].sort((a, b) => b.level - a.level)[0];
          const weak = [...worked].sort((a, b) => a.level - b.level)[0];
          const danger = s.safety.filter((i) => i.severity === "danger").length;
          const concern = s.safety.filter((i) => i.severity === "concern").length;
          const last = s.sessions[0];
          const isOpen = open === s.id;
          return (
            <div className="card" key={s.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <b style={{ fontSize: 16 }}>{s.displayName}</b>
                {danger > 0 && <span className="cc-tag bad">{danger} serious flag{danger === 1 ? "" : "s"}</span>}
                {danger === 0 && concern > 0 && <span className="cc-tag">{concern} to review</span>}
                <span style={{ color: "var(--text-dim)", fontSize: 13.5, flex: 1 }}>
                  {last ? `last session ${when(last.startedAt)}` : "has not started yet"}
                  {worked.length > 0 ? ` · ${worked.length} skill${worked.length === 1 ? "" : "s"} worked on` : ""}
                </span>
                <a className="btn quiet small" href={`/learn?student=${s.id}`}>Open tutor</a>
                <button className="btn quiet small" onClick={() => setOpen(isOpen ? null : s.id)}>
                  {isOpen ? "Close" : "Details"}
                </button>
              </div>
              {!isOpen && worked.length > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-dim)" }}>
                  Strongest: {strong.title ?? skillWords(strong.skillId)}. Needs work: {weak.title ?? skillWords(weak.skillId)}.
                </p>
              )}
              {isOpen && (
                <div style={{ marginTop: 10 }}>
                  {worked.length > 0 ? (
                    worked
                      .sort((a, b) => a.level - b.level)
                      .map((m) => (
                        <div key={m.skillId} style={{ margin: "7px 0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 2 }}>
                            <span>{m.title ?? skillWords(m.skillId)}</span>
                            <span style={{ color: "var(--text-dim)" }}>{m.attempts} tries</span>
                          </div>
                          <div style={{ background: "var(--surface-2)", borderRadius: 6, height: 8 }}>
                            <div style={{
                              width: `${Math.round(Math.max(0.04, Math.min(1, m.level)) * 100)}%`,
                              height: "100%",
                              borderRadius: 6,
                              background: m.level >= 0.7 ? "var(--ok)" : m.level >= 0.45 ? "#d9a13f" : "var(--danger)",
                            }} />
                          </div>
                        </div>
                      ))
                  ) : (
                    <p style={{ fontSize: 14, color: "var(--text-dim)" }}>No practice recorded yet.</p>
                  )}
                  {s.sessions.length > 0 && (
                    <>
                      <b style={{ fontSize: 14 }}>Recent sessions</b>
                      {s.sessions.map((ses, i) => (
                        <p key={i} style={{ fontSize: 13.5, color: "var(--text-dim)", margin: "4px 0" }}>
                          {when(ses.startedAt)}: {ses.summary ?? "no recap recorded"}
                        </p>
                      ))}
                    </>
                  )}
                  {s.safety.length > 0 && (
                    <>
                      <b style={{ fontSize: 14 }}>Safety</b>
                      {s.safety.map((inc, i) => (
                        <p key={i} style={{ fontSize: 13.5, margin: "4px 0" }}>
                          <span className={`cc-tag${inc.severity === "danger" ? " bad" : ""}`}>{inc.severity}</span>{" "}
                          {inc.categories.join(", ")} · {when(inc.createdAt)}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
      <p className="footlinks"><a href="/learn">Back to learning</a></p>
    </main>
  );
}

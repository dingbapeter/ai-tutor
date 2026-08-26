"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;

interface SessionSummary {
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
}
interface LearnerProfile {
  goals: string[];
  strengths: string[];
  strugglingWith: string[];
  interests: string[];
  preferences: string[];
}
interface LearnerRoutine {
  subjects: string[];
  weekly: Array<{ day: string; blocks: Array<{ time?: string; subject: string }> }>;
  examDates: Array<{ date: string; label: string }>;
  notes: string;
}
interface StudentRow {
  id: string;
  displayName: string;
  sessions: SessionSummary[];
  mastery: Array<{ skillId: string; title?: string; level: number; stage?: string; due?: boolean }>;
  safety: Array<{ direction: string; categories: string[]; severity: string; excerpt: string; createdAt: string }>;
  streakDays?: number;
  profile?: LearnerProfile | null;
  routine?: LearnerRoutine | null;
  careContact?: { name: string; phone: string; relationship?: string } | null;
}

const PROFILE_SECTIONS: Array<{ key: keyof LearnerProfile; label: string }> = [
  { key: "goals", label: "Goals" },
  { key: "strengths", label: "Going well" },
  { key: "strugglingWith", label: "Working on" },
  { key: "interests", label: "Interests" },
  { key: "preferences", label: "Learns best with" },
];

export default function Account() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<"parent" | "student">("parent");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [meEmail, setMeEmail] = useState("");
  const [newChild, setNewChild] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{
    plan: string;
    today: { messages: number; voiceTurns: number; limits: { messages: number; voiceTurns: number } };
  } | null>(null);
  const [transcript, setTranscript] = useState<{ studentId: string; messages: Array<{ role: string; content: string; createdAt: string }> } | null>(null);
  const [pushState, setPushState] = useState<"unknown" | "on" | "off" | "unsupported">("unknown");
  const [forgotSent, setForgotSent] = useState(false);
  const [signupsPaused, setSignupsPaused] = useState<{ paused: boolean; reason: string }>({ paused: false, reason: "" });
  const [emailVerified, setEmailVerified] = useState(true);
  const [verifySent, setVerifySent] = useState(false);
  const [billingOn, setBillingOn] = useState(false);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [routineBusy, setRoutineBusy] = useState<string | null>(null);
  const [careEditing, setCareEditing] = useState<string | null>(null);
  const [careForm, setCareForm] = useState<{ name: string; phone: string; relationship: string }>({ name: "", phone: "", relationship: "" });

  useEffect(() => {
    const t = localStorage.getItem("tutor_token");
    if (t) setToken(t);
    // Whether new accounts are open is a Command Centre switch; ask before
    // showing someone a form that cannot succeed.
    fetch(`${API}/platform`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setSignupsPaused({ paused: !!b.signupsPaused, reason: b.signupsPausedReason ?? "" }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (token) refresh(token);
  }, [token]);

  async function refresh(t: string) {
    try {
      const res = await fetch(`${API}/dashboard`, { headers: { authorization: `Bearer ${t}` } });
      if (res.status === 401) {
        localStorage.removeItem("tutor_token");
        setToken(null);
        return;
      }
      const dash = await res.json();
      setStudents(dash.students);
      const me = await fetch(`${API}/me`, { headers: { authorization: `Bearer ${t}` } });
      if (me.ok) {
        const meJson = await me.json();
        setMeEmail(meJson.email);
        setEmailVerified(meJson.emailVerified !== false);
      }
      const u = await fetch(`${API}/me/usage`, { headers: { authorization: `Bearer ${t}` } });
      if (u.ok) setUsage(await u.json());
      const b = await fetch(`${API}/billing/status`);
      if (b.ok) setBillingOn((await b.json()).configured === true);
    } catch {
      setError("could not load dashboard");
    }
  }

  async function submit() {
    setError(null);
    try {
      const res = await fetch(`${API}/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "register"
            ? { email, password, role, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) }
            : { email, password },
        ),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `error ${res.status}`);
      const json = await res.json();
      localStorage.setItem("tutor_token", json.token);
      setToken(json.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign-in failed");
    }
  }

  async function addChild() {
    if (!newChild.trim() || !token) return;
    setError(null);
    try {
      const res = await fetch(`${API}/students`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: newChild.trim() }),
      });
      if (!res.ok) throw new Error("could not add student");
      setNewChild("");
      refresh(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not add student");
    }
  }

  async function upgrade(plan: "plus" | "premium") {
    if (!token) return;
    setUpgrading(plan);
    setError(null);
    try {
      const res = await fetch(`${API}/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "checkout unavailable");
      window.location.href = (await res.json()).url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "checkout unavailable");
      setUpgrading(null);
    }
  }

  async function signOut() {
    if (token) {
      fetch(`${API}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => {});
    }
    localStorage.removeItem("tutor_token");
    setToken(null);
    setStudents([]);
  }

  async function enableNotifications() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushState("unsupported");
        return;
      }
      const vapid = await fetch(`${API}/push/vapid`);
      if (!vapid.ok) {
        setError("notifications aren't switched on for this server yet");
        return;
      }
      const { publicKey } = await vapid.json();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
      const res = await fetch(`${API}/push/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(sub.toJSON()),
      });
      setPushState(res.ok ? "on" : "off");
    } catch {
      setPushState("off");
    }
  }

  async function uploadRoutine(studentId: string, file: File) {
    if (!token) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("That image is too large. Keep it under 5MB.");
      return;
    }
    setRoutineBusy(studentId);
    setError(null);
    try {
      const res = await fetch(`${API}/students/${studentId}/routine`, {
        method: "POST",
        headers: { "content-type": file.type || "image/jpeg", authorization: `Bearer ${token}` },
        body: file,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "could not read that timetable");
      await refresh(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not read that timetable");
    } finally {
      setRoutineBusy(null);
    }
  }

  async function saveCareContact(studentId: string) {
    if (!token) return;
    if (!careForm.name.trim() || !careForm.phone.trim()) {
      setError("A care contact needs both a name and a phone number.");
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${API}/students/${studentId}/care-contact`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: careForm.name.trim(),
          phone: careForm.phone.trim(),
          ...(careForm.relationship.trim() ? { relationship: careForm.relationship.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "could not save that contact");
      setCareEditing(null);
      await refresh(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save that contact");
    }
  }

  async function removeCareContact(studentId: string) {
    if (!token) return;
    await fetch(`${API}/students/${studentId}/care-contact`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => {});
    await refresh(token);
  }

  async function viewTranscript(studentId: string) {
    if (transcript?.studentId === studentId) {
      setTranscript(null);
      return;
    }
    const res = await fetch(`${API}/students/${studentId}/transcript`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) setTranscript({ studentId, messages: (await res.json()).messages });
  }

  async function deleteEverything() {
    const sure = prompt('This permanently erases your account, every student, and all their history. Type DELETE to confirm.');
    if (sure !== "DELETE" || !token) return;
    const res = await fetch(`${API}/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    if (res.ok) {
      localStorage.removeItem("tutor_token");
      setToken(null);
      setStudents([]);
    }
  }

  async function forgotPassword() {
    if (!email) {
      setError("type your email above first, then tap forgot password");
      return;
    }
    await fetch(`${API}/auth/forgot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    setForgotSent(true);
  }

  if (!token) {
    return (
      <main className="shell" style={{ maxWidth: 480 }}>
        <div className="hero fadeUp" style={{ paddingBottom: 12 }}>
          <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        </div>
        {error && <p className="err">{error}</p>}
        <div className="card fadeUp">
          {mode === "register" && signupsPaused.paused && (
            <p className="notice" style={{ marginTop: 0 }}>{signupsPaused.reason}</p>
          )}
          {mode === "register" && (
            <>
              <label className="lbl">Your name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="inp" />
              <label className="lbl">I am a…</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setRole("parent")} className={`pill${role === "parent" ? " on" : ""}`} style={{ flex: 1 }}>
                  <span><b>Parent</b><br /><small>my kids will learn</small></span>
                </button>
                <button onClick={() => setRole("student")} className={`pill${role === "student" ? " on" : ""}`} style={{ flex: 1 }}>
                  <span><b>Learner</b><br /><small>it&apos;s for me</small></span>
                </button>
              </div>
            </>
          )}
          <label className="lbl">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="inp" type="email" />
          <label className="lbl">Password {mode === "register" && <small>(8+ characters)</small>}</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} className="inp" type="password"
            onKeyDown={(e) => e.key === "Enter" && submit()} />
          {mode === "register" && (
            <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 0 }}>
              By creating an account you confirm you are an adult, you agree to our{" "}
              <a href="/terms">Terms</a> and{" "}
              <a href="/privacy">Privacy Policy</a>, and you consent to your
              children&apos;s learning data being processed to run their tutoring.
            </p>
          )}
          <button
            onClick={submit}
            className="btn big"
            style={{ marginTop: 18 }}
            disabled={mode === "register" && signupsPaused.paused}
          >
            {mode === "login" ? "Sign in" : signupsPaused.paused ? "Signups are closed right now" : "Create account"}
          </button>
          <p style={{ textAlign: "center", marginBottom: 0 }}>
            <button onClick={() => setMode(mode === "login" ? "register" : "login")}
              style={{ border: "none", background: "none", color: "var(--brand)", cursor: "pointer", fontFamily: "inherit", fontSize: 14.5 }}>
              {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
          </p>
          {mode === "login" && (
            <p style={{ textAlign: "center", marginBottom: 0 }}>
              {forgotSent ? (
                <small style={{ color: "var(--ok)" }}>If that email has an account, a reset link is on its way. ✉️</small>
              ) : (
                <button onClick={forgotPassword}
                  style={{ border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
                  Forgot password?
                </button>
              )}
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="shell wide">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ margin: "6px 0" }}>Family dashboard</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <small style={{ color: "var(--text-dim)" }}>{meEmail}</small>
          <button onClick={signOut} className="btn quiet small">Sign out</button>
        </div>
      </div>
      {error && <p className="err">{error}</p>}

      {!emailVerified && (
        <p className="notice">
          Please confirm your email so recaps and safety alerts reach you. Check your inbox.{" "}
          {verifySent ? (
            <b>Sent!</b>
          ) : (
            <button
              onClick={async () => {
                await fetch(`${API}/auth/resend-verification`, {
                  method: "POST",
                  headers: { authorization: `Bearer ${token}` },
                }).catch(() => {});
                setVerifySent(true);
              }}
              style={{ border: "none", background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
            >
              Resend the link
            </button>
          )}
        </p>
      )}

      {usage && (
        <div className="card" style={{ marginBottom: 14, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <b style={{ textTransform: "capitalize" }}>{usage.plan} plan</b>
          <span>💬 Today: {usage.today.messages}/{usage.today.limits.messages} messages</span>
          <span>🎤 {usage.today.voiceTurns}/{usage.today.limits.voiceTurns} voice turns</span>
          {pushState === "on" ? (
            <span style={{ color: "var(--ok)" }}>🔔 Notifications on</span>
          ) : pushState === "unsupported" ? (
            <small style={{ color: "var(--text-dim)" }}>notifications unsupported on this browser</small>
          ) : (
            <button onClick={enableNotifications} className="btn quiet small">🔔 Enable study reminders</button>
          )}
          {billingOn && usage.plan !== "premium" && (
            <span style={{ display: "flex", gap: 8 }}>
              {usage.plan === "free" && (
                <button disabled={upgrading !== null} onClick={() => upgrade("plus")} className="btn small">
                  {upgrading === "plus" ? "Opening checkout…" : "⭐ Upgrade to Plus"}
                </button>
              )}
              <button disabled={upgrading !== null} onClick={() => upgrade("premium")} className="btn small" style={{ background: "var(--brand-deep)" }}>
                {upgrading === "premium" ? "Opening checkout…" : "👑 Go Premium"}
              </button>
            </span>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <b>Add a student</b>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={newChild} onChange={(e) => setNewChild(e.target.value)} className="inp"
            placeholder="Child's name" onKeyDown={(e) => e.key === "Enter" && addChild()} />
          <button onClick={addChild} className="btn">Add</button>
        </div>
      </div>

      {students.length === 0 && <p>No students yet. Add one above, then start a session from the <a href="/">home page</a>.</p>}

      {students.length > 0 && (
        <p style={{ textAlign: "right" }}>
          <button onClick={deleteEverything}
            style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
            Delete my account and all data
          </button>
        </p>
      )}

      {students.map((s) => (
        <div key={s.id} className="card fadeUp" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              {s.displayName}
              {(s.streakDays ?? 0) > 0 && (
                <span style={{ fontSize: 15, marginLeft: 10 }}>🔥 {s.streakDays}-day streak</span>
              )}
            </h2>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => viewTranscript(s.id)}
                style={{ border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>
                {transcript?.studentId === s.id ? "Hide transcript" : "View transcript"}
              </button>
              <a href="/">Start a session</a>
            </span>
          </div>

          {transcript?.studentId === s.id && (
            <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: 12, margin: "10px 0", maxHeight: 260, overflowY: "auto" }}>
              {transcript.messages.length === 0 && <small>No conversation recorded yet.</small>}
              {transcript.messages.map((m, i) => (
                <p key={i} style={{ margin: "4px 0", fontSize: 13 }}>
                  <b>{m.role === "user" ? s.displayName : "Tutor"}:</b> {m.content.slice(0, 400)}
                </p>
              ))}
            </div>
          )}

          <div style={{ margin: "12px 0", padding: "12px 14px", borderRadius: 12, background: "var(--surface-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14.5 }}>Care contact</b>
              {careEditing === s.id ? (
                <button onClick={() => setCareEditing(null)} className="btn ghost small">Cancel</button>
              ) : (
                <span style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      setCareEditing(s.id);
                      setCareForm({
                        name: s.careContact?.name ?? "",
                        phone: s.careContact?.phone ?? "",
                        relationship: s.careContact?.relationship ?? "",
                      });
                    }}
                    className="btn quiet small"
                  >
                    {s.careContact ? "Change" : "Add someone"}
                  </button>
                  {s.careContact && (
                    <button onClick={() => removeCareContact(s.id)} className="btn ghost small">Remove</button>
                  )}
                </span>
              )}
            </div>

            {careEditing === s.id ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <input value={careForm.name} onChange={(e) => setCareForm((f) => ({ ...f, name: e.target.value }))}
                  className="inp" style={{ flex: "1 1 130px" }} placeholder="Their name" />
                <input value={careForm.phone} onChange={(e) => setCareForm((f) => ({ ...f, phone: e.target.value }))}
                  className="inp" style={{ flex: "1 1 130px" }} placeholder="Phone number" type="tel" />
                <input value={careForm.relationship} onChange={(e) => setCareForm((f) => ({ ...f, relationship: e.target.value }))}
                  className="inp" style={{ flex: "1 1 110px" }} placeholder="Mum, uncle, coach…" />
                <button onClick={() => saveCareContact(s.id)} className="btn">Save</button>
              </div>
            ) : (
              <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--text-dim)" }}>
                {s.careContact
                  ? `${s.careContact.name}${s.careContact.relationship ? ` (${s.careContact.relationship})` : ""} · ${s.careContact.phone}. If ${s.displayName} ever sounds like they're in real trouble, their tutor offers a one-tap call to this number. Dingba never dials on its own.`
                  : `Name one trusted person. If ${s.displayName} ever sounds like they're in real trouble, their tutor will offer a one-tap call to them. Nothing is ever dialed automatically.`}
              </p>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0", flexWrap: "wrap" }}>
            <label className="btn quiet small" style={{ cursor: "pointer" }}>
              {routineBusy === s.id ? "Reading timetable…" : s.routine ? "Replace timetable" : "📅 Upload timetable"}
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                disabled={routineBusy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadRoutine(s.id, f);
                  e.target.value = "";
                }}
              />
            </label>
            <small style={{ color: "var(--text-dim)" }}>
              {s.routine
                ? "Their tutor plans around this schedule."
                : "A photo or screenshot of their timetable teaches Dingba their week."}
            </small>
          </div>

          {s.routine && (s.routine.subjects.length > 0 || s.routine.weekly.length > 0 || s.routine.examDates.length > 0 || s.routine.notes) && (
            <>
              <h4 style={{ marginBottom: 6 }}>Learning routine</h4>
              {s.routine.subjects.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                  {s.routine.subjects.map((sub) => (
                    <span key={sub} style={{ fontSize: 13, background: "var(--surface-2)", borderRadius: 999, padding: "2px 10px" }}>{sub}</span>
                  ))}
                </div>
              )}
              {s.routine.weekly.map((d) => (
                <p key={d.day} style={{ margin: "2px 0", fontSize: 13.5 }}>
                  <b>{d.day}</b>{" "}
                  <span style={{ color: "var(--text-dim)" }}>
                    {d.blocks.map((b) => (b.time ? `${b.subject} (${b.time})` : b.subject)).join(" · ")}
                  </span>
                </p>
              ))}
              {s.routine.examDates.length > 0 && (
                <p style={{ margin: "4px 0", fontSize: 13.5 }}>
                  <b>Exams:</b>{" "}
                  <span style={{ color: "var(--text-dim)" }}>
                    {s.routine.examDates.map((e) => `${e.label} (${e.date})`).join(" · ")}
                  </span>
                </p>
              )}
              {s.routine.subjects.length === 0 && s.routine.weekly.length === 0 && s.routine.examDates.length === 0 && s.routine.notes && (
                <p style={{ margin: "4px 0", fontSize: 13.5, color: "var(--text-dim)" }}>{s.routine.notes.slice(0, 300)}</p>
              )}
            </>
          )}

          {s.profile && PROFILE_SECTIONS.some(({ key }) => (s.profile?.[key] ?? []).length > 0) && (
            <>
              <h4 style={{ marginBottom: 6 }}>{s.displayName}&apos;s learning profile</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {PROFILE_SECTIONS.map(({ key, label }) =>
                  (s.profile?.[key] ?? []).length > 0 ? (
                    <div key={key} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
                      <small style={{ color: "var(--text-dim)", minWidth: 96 }}>{label}</small>
                      {(s.profile?.[key] ?? []).map((item) => (
                        <span key={item} style={{ fontSize: 13, background: "var(--brand-soft)", color: "var(--brand-strong)", borderRadius: 999, padding: "2px 10px" }}>
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null,
                )}
              </div>
            </>
          )}

          {s.mastery.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6 }}>Skill progress</h4>
              {s.mastery.map((m) => (
                <div key={m.skillId} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <small>
                      {m.title ?? m.skillId.split(".").slice(1).join(" · ").replace(/-/g, " ")}
                      {m.due && (
                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "var(--brand-strong)", background: "var(--brand-soft)", borderRadius: 999, padding: "1px 8px" }}>
                          due for review
                        </span>
                      )}
                    </small>
                    {m.stage && <small style={{ color: "var(--text-dim)" }}>{m.stage}</small>}
                  </div>
                  <div style={{ background: "var(--surface-2)", borderRadius: 6, height: 10 }}>
                    <div style={{
                      width: `${Math.round(m.level * 100)}%`, height: "100%", borderRadius: 6,
                      background: m.level > 0.7 ? "var(--ok)" : m.level > 0.35 ? "#d9a13f" : "var(--danger)",
                      transition: "width .4s",
                    }} />
                  </div>
                </div>
              ))}
            </>
          )}

          {s.sessions.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6 }}>Recent sessions</h4>
              {s.sessions.map((sess, i) => (
                <div key={i} style={{ borderLeft: "3px solid var(--line)", paddingLeft: 10, marginBottom: 8 }}>
                  <small style={{ color: "var(--text-dim)" }}>{new Date(sess.startedAt).toLocaleString()}</small>
                  <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>
                    {sess.summary ? sess.summary.slice(0, 300) : sess.endedAt ? "(no recap)" : "(in progress)"}
                  </p>
                </div>
              ))}
            </>
          )}
          {s.sessions.length === 0 && <small style={{ color: "var(--text-dim)" }}>No sessions yet. A fresh start is a beautiful thing.</small>}

          {s.safety?.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6, color: "var(--danger)" }}>Flagged moments ({s.safety.length})</h4>
              {s.safety.map((i, idx) => (
                <div key={idx} style={{ borderLeft: `3px solid ${i.severity === "danger" ? "var(--danger)" : "#d9a13f"}`, paddingLeft: 10, marginBottom: 8 }}>
                  <small style={{ color: "var(--text-dim)" }}>
                    {new Date(i.createdAt).toLocaleString()} · {i.severity} · {i.categories.join(", ")} · said by {i.direction === "student" ? s.displayName : "the tutor"}
                  </small>
                  <p style={{ margin: "2px 0", fontSize: 14 }}>&ldquo;{i.excerpt}&rdquo;</p>
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </main>
  );
}

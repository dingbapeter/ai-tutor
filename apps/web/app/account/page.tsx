"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;

interface SessionSummary {
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
}
interface StudentRow {
  id: string;
  displayName: string;
  sessions: SessionSummary[];
  mastery: Array<{ skillId: string; level: number }>;
  safety: Array<{ direction: string; categories: string[]; severity: string; excerpt: string; createdAt: string }>;
  streakDays?: number;
}

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

  useEffect(() => {
    const t = localStorage.getItem("tutor_token");
    if (t) setToken(t);
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
      if (me.ok) setMeEmail((await me.json()).email);
      const u = await fetch(`${API}/me/usage`, { headers: { authorization: `Bearer ${t}` } });
      if (u.ok) setUsage(await u.json());
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
          mode === "register" ? { email, password, displayName, role } : { email, password },
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
      <main style={{ maxWidth: 460, margin: "48px auto", padding: 16 }}>
        <h1 style={{ textAlign: "center" }}>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        {error && <p style={errBox}>{error}</p>}
        <div style={card}>
          {mode === "register" && (
            <>
              <label style={lbl}>Your name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inp} />
              <label style={lbl}>I am a…</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setRole("parent")} style={{ ...pill, ...(role === "parent" ? pillOn : {}) }}>
                  Parent — my kids will learn
                </button>
                <button onClick={() => setRole("student")} style={{ ...pill, ...(role === "student" ? pillOn : {}) }}>
                  Learner — it&apos;s for me
                </button>
              </div>
            </>
          )}
          <label style={lbl}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={inp} type="email" />
          <label style={lbl}>Password {mode === "register" && <small>(8+ characters)</small>}</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} style={inp} type="password"
            onKeyDown={(e) => e.key === "Enter" && submit()} />
          {mode === "register" && (
            <p style={{ fontSize: 13, color: "#68718a", marginBottom: 0 }}>
              By creating an account you confirm you are an adult, you agree to our{" "}
              <a href="/terms" style={{ color: "#2b4c8c" }}>Terms</a> and{" "}
              <a href="/privacy" style={{ color: "#2b4c8c" }}>Privacy Policy</a>, and you consent to your
              children&apos;s learning data being processed to run their tutoring.
            </p>
          )}
          <button onClick={submit} style={{ ...btn, marginTop: 16, width: "100%" }}>
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
          <p style={{ textAlign: "center", marginBottom: 0 }}>
            <button onClick={() => setMode(mode === "login" ? "register" : "login")}
              style={{ border: "none", background: "none", color: "#2b4c8c", cursor: "pointer" }}>
              {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
          </p>
          {mode === "login" && (
            <p style={{ textAlign: "center", marginBottom: 0 }}>
              {forgotSent ? (
                <small style={{ color: "#4a7d5f" }}>If that email has an account, a reset link is on its way. ✉️</small>
              ) : (
                <button onClick={forgotPassword}
                  style={{ border: "none", background: "none", color: "#68718a", cursor: "pointer", fontSize: 13 }}>
                  Forgot password?
                </button>
              )}
            </p>
          )}
          <p style={{ textAlign: "center", marginBottom: 0 }}>
            <a href="/" style={{ color: "#68718a" }}>← back to tutoring</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Family dashboard</h1>
        <div>
          <small style={{ color: "#68718a", marginRight: 12 }}>{meEmail}</small>
          <button onClick={signOut} style={{ ...btn, background: "#8a93a6" }}>Sign out</button>
        </div>
      </div>
      {error && <p style={errBox}>{error}</p>}

      {usage && (
        <div style={{ ...card, marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
          <b style={{ textTransform: "capitalize" }}>{usage.plan} plan</b>
          <span>💬 Today: {usage.today.messages}/{usage.today.limits.messages} messages</span>
          <span>🎤 {usage.today.voiceTurns}/{usage.today.limits.voiceTurns} voice turns</span>
          {pushState === "on" ? (
            <span style={{ color: "#4a7d5f" }}>🔔 Notifications on</span>
          ) : pushState === "unsupported" ? (
            <small style={{ color: "#68718a" }}>notifications unsupported on this browser</small>
          ) : (
            <button onClick={enableNotifications} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              🔔 Enable study reminders
            </button>
          )}
        </div>
      )}

      <div style={{ ...card, marginBottom: 16 }}>
        <b>Add a student</b>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={newChild} onChange={(e) => setNewChild(e.target.value)} style={{ ...inp, margin: 0 }}
            placeholder="Child's name" onKeyDown={(e) => e.key === "Enter" && addChild()} />
          <button onClick={addChild} style={btn}>Add</button>
        </div>
      </div>

      {students.length === 0 && <p>No students yet — add one above, then start a session from the <a href="/">home page</a>.</p>}

      {students.length > 0 && (
        <p style={{ textAlign: "right" }}>
          <button onClick={deleteEverything}
            style={{ border: "none", background: "none", color: "#c0605a", cursor: "pointer", fontSize: 13 }}>
            Delete my account and all data
          </button>
        </p>
      )}

      {students.map((s) => (
        <div key={s.id} style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              {s.displayName}
              {(s.streakDays ?? 0) > 0 && (
                <span style={{ fontSize: 15, marginLeft: 10 }}>🔥 {s.streakDays}-day streak</span>
              )}
            </h2>
            <span>
              <button onClick={() => viewTranscript(s.id)}
                style={{ border: "none", background: "none", color: "#68718a", cursor: "pointer", marginRight: 12 }}>
                {transcript?.studentId === s.id ? "Hide transcript" : "View transcript"}
              </button>
              <a href="/" style={{ color: "#2b4c8c" }}>Start a session →</a>
            </span>
          </div>

          {transcript?.studentId === s.id && (
            <div style={{ background: "#f6f7fb", borderRadius: 8, padding: 12, margin: "10px 0", maxHeight: 260, overflowY: "auto" }}>
              {transcript.messages.length === 0 && <small>No conversation recorded yet.</small>}
              {transcript.messages.map((m, i) => (
                <p key={i} style={{ margin: "4px 0", fontSize: 13 }}>
                  <b>{m.role === "user" ? s.displayName : "Tutor"}:</b> {m.content.slice(0, 400)}
                </p>
              ))}
            </div>
          )}

          {s.mastery.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6 }}>Skill progress</h4>
              {s.mastery.map((m) => (
                <div key={m.skillId} style={{ marginBottom: 6 }}>
                  <small>{m.skillId.split(".").slice(1).join(" · ").replace(/-/g, " ")}</small>
                  <div style={{ background: "#e7ebf4", borderRadius: 6, height: 10 }}>
                    <div style={{
                      width: `${Math.round(m.level * 100)}%`, height: "100%", borderRadius: 6,
                      background: m.level > 0.7 ? "#4a7d5f" : m.level > 0.35 ? "#d9a13f" : "#c0605a",
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
                <div key={i} style={{ borderLeft: "3px solid #ccd3e0", paddingLeft: 10, marginBottom: 8 }}>
                  <small style={{ color: "#68718a" }}>{new Date(sess.startedAt).toLocaleString()}</small>
                  <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>
                    {sess.summary ? sess.summary.slice(0, 300) : sess.endedAt ? "(no recap)" : "(in progress)"}
                  </p>
                </div>
              ))}
            </>
          )}
          {s.sessions.length === 0 && <small style={{ color: "#68718a" }}>No sessions yet — a fresh start is a beautiful thing.</small>}

          {s.safety?.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6, color: "#9d2b2b" }}>Flagged moments ({s.safety.length})</h4>
              {s.safety.map((i, idx) => (
                <div key={idx} style={{ borderLeft: `3px solid ${i.severity === "danger" ? "#c0605a" : "#d9a13f"}`, paddingLeft: 10, marginBottom: 8 }}>
                  <small style={{ color: "#68718a" }}>
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

const card: React.CSSProperties = { background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(20,30,60,.08)" };
const lbl: React.CSSProperties = { display: "block", margin: "14px 0 6px", fontWeight: 600 };
const inp: React.CSSProperties = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccd3e0", fontSize: 15, boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "10px 18px", borderRadius: 8, border: "none", background: "#2b4c8c", color: "#fff", fontSize: 15, cursor: "pointer" };
const pill: React.CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "1px solid #ccd3e0", background: "#fff", cursor: "pointer", flex: 1 };
const pillOn: React.CSSProperties = { border: "2px solid #2b4c8c", background: "#eef1f8" };
const errBox: React.CSSProperties = { background: "#fdecec", color: "#9d2b2b", borderRadius: 8, padding: "10px 14px", margin: "8px 0" };

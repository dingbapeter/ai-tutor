"use client";

import { useEffect, useRef, useState } from "react";
import MathText from "./MathText";

const API = process.env.NEXT_PUBLIC_API_URL!;

interface Persona {
  id: string;
  name: string;
  style: string;
  color?: string;
  accent?: string;
}
interface Pack {
  id: string;
  title: string;
  description: string;
}
interface Problem {
  index: number;
  skillId: string;
  prompt: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
}
type Format = "plain" | "story" | "comic" | "song";

/** Avatar v0: stylized SVG face — blinks when idle, mouth moves while speaking. */
function Avatar({ color = "#e8875a", accent = "#8a4b2d", speaking, size = 72 }: {
  color?: string;
  accent?: string;
  speaking: boolean;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="52" r="40" fill={color} />
      <circle cx="50" cy="30" r="26" fill={accent} opacity="0.25" />
      <g className="avatar-eyes">
        <circle cx="38" cy="46" r="4.5" fill="#1a1a2e" />
        <circle cx="62" cy="46" r="4.5" fill="#1a1a2e" />
        <circle cx="39.5" cy="44.5" r="1.4" fill="#fff" />
        <circle cx="63.5" cy="44.5" r="1.4" fill="#fff" />
      </g>
      {speaking ? (
        <ellipse className="avatar-mouth-talking" cx="50" cy="66" rx="9" ry="6" fill="#1a1a2e" />
      ) : (
        <path d="M 41 64 Q 50 72 59 64" stroke="#1a1a2e" strokeWidth="3" fill="none" strokeLinecap="round" />
      )}
      <circle cx="30" cy="58" r="4" fill="#fff" opacity="0.35" />
      <circle cx="70" cy="58" r="4" fill="#fff" opacity="0.35" />
    </svg>
  );
}

export default function Home() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [packId, setPackId] = useState("");
  const [name, setName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [family, setFamily] = useState<Array<{ id: string; displayName: string }>>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [hostName, setHostName] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [examProblems, setExamProblems] = useState<Array<{ index: number; prompt: string }> | null>(null);
  const [examAnswers, setExamAnswers] = useState<Record<number, string>>({});
  const [examSubmitted, setExamSubmitted] = useState<Set<number>>(new Set());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recap, setRecap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [format, setFormat] = useState<Format>("plain");
  const [showPractice, setShowPractice] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<number, string>>({});
  const [verdicts, setVerdicts] = useState<Record<number, boolean | null>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const persona = personas.find((p) => p.id === personaId);

  useEffect(() => {
    fetch(`${API}/personas`).then((r) => r.json()).then(setPersonas).catch(() => {});
    fetch(`${API}/packs`).then((r) => r.json()).then(setPacks).catch(() => {});
    const t = localStorage.getItem("tutor_token");
    if (t) {
      setToken(t);
      fetch(`${API}/me`, { headers: { authorization: `Bearer ${t}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((me) => me && setFamily(me.students))
        .catch(() => {});
    }
  }, []);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  function playAudio(src: Blob | string) {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const audio = new Audio(url);
    setSpeaking(true);
    audio.onended = audio.onerror = () => {
      setSpeaking(false);
      if (typeof src !== "string") URL.revokeObjectURL(url);
    };
    audio.play().catch(() => setSpeaking(false));
  }

  async function speakMessage(text: string) {
    if (!personaId) return;
    try {
      const res = await fetch(`${API}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 2000), personaId }),
      });
      if (!res.ok) throw new Error("voice unavailable");
      playAudio(await res.blob());
    } catch (e) {
      setError(e instanceof Error ? e.message : "voice unavailable");
    }
  }

  async function startSession() {
    setError(null);
    try {
      const res = await fetch(`${API}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token && studentId ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          token && studentId
            ? { studentId, personaId, packId }
            : { studentName: name || "Student", personaId, packId, ...(parentEmail ? { parentEmail } : {}) },
        ),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `error ${res.status}`);
      const json = await res.json();
      setSessionId(json.sessionId);
      setMessages([]);
      setVerdicts({});
      if (json.remembered > 0) {
        setMessages([{ role: "assistant", content: `(Your tutor remembers your last ${json.remembered > 1 ? "sessions" : "session"}.)` }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start session");
    }
  }

  async function joinClass() {
    if (!joinCode.trim()) return;
    setError(null);
    try {
      const res = await fetch(`${API}/sessions/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          code: joinCode.trim(),
          ...(token ? {} : { guestName: joinName.trim() || "Guest" }),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `could not join (${res.status})`);
      const json = await res.json();
      setSessionId(json.sessionId);
      setParticipantId(json.participantId);
      setHostName(json.host);
      setPersonaId(json.persona.id);
      setMessages([
        {
          role: "assistant",
          content: `(You joined ${json.host}'s ${json.pack} class with ${json.persona.name}.${json.guestMessages ? ` Free class pass: ${json.guestMessages} messages.` : ""})`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not join class");
    }
  }

  async function inviteFriend() {
    if (!sessionId) return;
    setError(null);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/invite`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "invites unavailable");
      setInviteCode((await res.json()).code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "invites unavailable");
    }
  }

  async function startExam() {
    if (!sessionId) return;
    setError(null);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/exam/start`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "exam unavailable");
      const json = await res.json();
      setExamProblems(json.problems);
      setExamAnswers({});
      setExamSubmitted(new Set());
      setShowPractice(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "exam unavailable");
    }
  }

  async function submitExamAnswer(index: number) {
    const answer = examAnswers[index]?.trim();
    if (!answer || !sessionId) return;
    const res = await fetch(`${API}/sessions/${sessionId}/exam/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problemIndex: index, answer }),
    });
    if (res.ok) setExamSubmitted((s) => new Set(s).add(index));
  }

  async function finishExam() {
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/exam/finish`, { method: "POST" });
      if (!res.ok) throw new Error("could not finish exam");
      const json = await res.json();
      setExamProblems(null);
      setMessages((m) => [
        ...m,
        { role: "user", content: `✍️ Finished the mock exam.` },
        { role: "assistant", content: `Score: ${json.score}/${json.of} in ${Math.round(json.durationSec / 60)} min.\n\n${json.postMortem}` },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not finish exam");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!input.trim() || !sessionId || busy) return;
    const text = input.trim();
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch(`${API}/sessions/${sessionId}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          ...(format !== "plain" ? { format } : {}),
          ...(participantId ? { participantId } : {}),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`tutor unavailable (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.replace(/^data: ?/, "").trim();
          if (!data) continue;
          try {
            const evt = JSON.parse(data);
            if (evt.error) throw new Error("the tutor had trouble replying — try again");
            if (evt.delta) {
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + evt.delta };
                return copy;
              });
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes("tutor")) throw e;
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "message failed");
      setMessages((m) => (m[m.length - 1]?.content === "" ? m.slice(0, -1) : m));
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (busy || recording) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1000) return; // accidental tap
        await sendVoice(blob);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("microphone unavailable — check permissions");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    setRecording(false);
  }

  async function sendVoice(blob: Blob) {
    if (!sessionId) return;
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: "🎤 …" }]);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/voice`, {
        method: "POST",
        headers: { "content-type": blob.type || "audio/webm" },
        body: blob,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `voice failed (${res.status})`);
      const json = await res.json();
      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "user", content: `🎤 ${json.transcript}` },
        { role: "assistant", content: json.reply },
      ]);
      const bytes = Uint8Array.from(atob(json.audio), (c) => c.charCodeAt(0));
      playAudio(new Blob([bytes], { type: json.audioMime }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "voice failed");
      setMessages((m) => (m[m.length - 1]?.content === "🎤 …" ? m.slice(0, -1) : m));
    } finally {
      setBusy(false);
    }
  }

  async function openPractice() {
    setShowPractice(!showPractice);
    if (problems.length === 0 && packId) {
      try {
        const res = await fetch(`${API}/packs/${packId}/problems`);
        if (res.ok) setProblems(await res.json());
      } catch {}
    }
  }

  async function submitPractice(p: Problem) {
    const answer = practiceAnswers[p.index]?.trim();
    if (!answer || !sessionId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/practice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemIndex: p.index, answer }),
      });
      if (!res.ok) throw new Error(`practice failed (${res.status})`);
      const json = await res.json();
      setVerdicts((v) => ({ ...v, [p.index]: json.correct }));
      setMessages((m) => [
        ...m,
        { role: "user", content: `✏️ ${p.prompt} — my answer: ${answer}` },
        { role: "assistant", content: json.feedback },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "practice failed");
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    if (!sessionId) return;
    setError(null);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/end`, { method: "POST" });
      if (!res.ok) throw new Error(`could not end session (${res.status})`);
      const json = await res.json();
      setRecap(json.recap);
      setSessionId(null);
      setShowPractice(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not end session");
    }
  }

  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 12,
    padding: 24,
    boxShadow: "0 1px 4px rgba(20,30,60,.08)",
  };

  if (recap) {
    return (
      <main style={{ maxWidth: 640, margin: "48px auto", padding: 16 }}>
        <div style={card}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Avatar color={persona?.color} accent={persona?.accent} speaking={false} size={56} />
            <h2 style={{ margin: 0 }}>Session recap from {persona?.name}</h2>
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{recap}</p>
          <button onClick={() => { setRecap(null); setMessages([]); }} style={btn}>
            Start another session
          </button>
        </div>
      </main>
    );
  }

  if (!sessionId) {
    return (
      <main style={{ maxWidth: 640, margin: "48px auto", padding: 16 }}>
        <h1 style={{ textAlign: "center" }}>Meet your tutor</h1>
        {error && <p style={errBox}>{error}</p>}
        <div style={card}>
          {family.length > 0 ? (
            <>
              <label style={lbl}>Who&apos;s learning today?</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {family.map((s) => (
                  <button key={s.id} onClick={() => setStudentId(s.id)}
                    style={{ ...pill, ...(studentId === s.id ? pillOn : {}) }}>
                    <b>{s.displayName}</b>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label style={lbl}>Your name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inp} placeholder="Ada" />

              <label style={lbl}>Parent email (optional — for session recaps)</label>
              <input value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} style={inp} placeholder="parent@example.com" type="email" />
            </>
          )}

          <label style={lbl}>Pick your tutor</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {personas.map((p) => (
              <button key={p.id} onClick={() => setPersonaId(p.id)}
                style={{ ...pill, ...(personaId === p.id ? pillOn : {}), display: "flex", gap: 10, alignItems: "center" }}>
                <Avatar color={p.color} accent={p.accent} speaking={false} size={40} />
                <span><b>{p.name}</b><br /><small>{p.style}</small></span>
              </button>
            ))}
          </div>

          <label style={lbl}>What are we working on?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {packs.map((p) => (
              <button key={p.id} onClick={() => setPackId(p.id)}
                style={{ ...pill, ...(packId === p.id ? pillOn : {}) }}>
                <b>{p.title}</b>
              </button>
            ))}
          </div>

          <button
            disabled={!personaId || !packId || (family.length > 0 && !studentId)}
            onClick={startSession}
            style={{ ...btn, marginTop: 20 }}>
            Start session
          </button>
          <div style={{ marginTop: 14, borderTop: "1px solid #e7ebf4", paddingTop: 12 }}>
            {!joinOpen ? (
              <p style={{ textAlign: "center", margin: 0 }}>
                <button onClick={() => setJoinOpen(true)}
                  style={{ border: "none", background: "none", color: "#2b4c8c", cursor: "pointer", fontSize: 15 }}>
                  🎟️ Have a class code? Join a friend&apos;s live class
                </button>
              </p>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)}
                  style={{ ...inp, flex: 1, minWidth: 110, margin: 0 }} placeholder="Class code" />
                {!token && (
                  <input value={joinName} onChange={(e) => setJoinName(e.target.value)}
                    style={{ ...inp, flex: 1, minWidth: 110, margin: 0 }} placeholder="Your name" />
                )}
                <button onClick={joinClass} style={btn}>Join class</button>
              </div>
            )}
          </div>
          <p style={{ textAlign: "center", marginBottom: 0 }}>
            <a href="/account" style={{ color: "#68718a" }}>
              {token ? "Family dashboard →" : "Parents: create an account for progress reports →"}
            </a>
            {" · "}
            <a href="/credits" style={{ color: "#68718a" }}>Built on open work 💙</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 760, margin: "16px auto", padding: 16, display: "flex", flexDirection: "column", height: "94vh" }}>
      <style>{`
        .avatar-eyes { animation: blink 4.2s infinite; transform-origin: 50px 46px; }
        @keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 96%, 98% { transform: scaleY(0.08); } }
        .avatar-mouth-talking { animation: talk 0.28s infinite alternate; transform-origin: 50px 66px; }
        @keyframes talk { from { transform: scaleY(0.35); } to { transform: scaleY(1); } }
        .rec-pulse { animation: pulse 1s infinite alternate; }
        @keyframes pulse { from { opacity: 1; } to { opacity: 0.55; } }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar color={persona?.color} accent={persona?.accent} speaking={speaking} />
          <div>
            <h2 style={{ margin: 0 }}>{persona?.name}</h2>
            <small style={{ color: "#68718a" }}>{speaking ? "speaking…" : busy ? "thinking…" : "listening"}</small>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!participantId && (
            <>
              <button onClick={inviteFriend} style={{ ...btn, background: "#5a678a" }}>Invite</button>
              <button onClick={startExam} style={{ ...btn, background: "#5a678a" }}>Mock exam</button>
              <button onClick={openPractice} style={{ ...btn, background: showPractice ? "#2b4c8c" : "#5a678a" }}>Practice</button>
              <button onClick={endSession} style={{ ...btn, background: "#8a93a6" }}>End session</button>
            </>
          )}
          {participantId && <small style={{ color: "#68718a", alignSelf: "center" }}>in {hostName}&apos;s class</small>}
        </div>
      </div>

      {inviteCode && (
        <div style={{ ...card, margin: "10px 0", textAlign: "center" }}>
          🎟️ Friends join with code: <b style={{ fontSize: 22, letterSpacing: 3 }}>{inviteCode}</b>
          <div><small style={{ color: "#68718a" }}>They tap &ldquo;Join a friend&apos;s live class&rdquo; on the home page and enter it.</small></div>
        </div>
      )}

      {examProblems && (
        <div style={{ ...card, margin: "10px 0", maxHeight: 260, overflowY: "auto" }}>
          <b>✍️ Mock exam — answers are checked at the end, keep moving!</b>
          {examProblems.map((p) => (
            <div key={p.index} style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
              <span style={{ flex: 1 }}>{examSubmitted.has(p.index) ? "📩 " : ""}{p.prompt}</span>
              <input value={examAnswers[p.index] ?? ""} disabled={examSubmitted.has(p.index)}
                onChange={(e) => setExamAnswers((a) => ({ ...a, [p.index]: e.target.value }))}
                style={{ ...inp, width: 110, margin: 0 }} placeholder="answer" />
              <button onClick={() => submitExamAnswer(p.index)} disabled={examSubmitted.has(p.index)}
                style={{ ...btn, padding: "8px 12px" }}>Lock in</button>
            </div>
          ))}
          <button onClick={finishExam} disabled={busy} style={{ ...btn, marginTop: 8, background: "#2b4c8c" }}>
            Finish exam & get my results
          </button>
        </div>
      )}

      {showPractice && (
        <div style={{ ...card, margin: "10px 0", maxHeight: 220, overflowY: "auto" }}>
          {problems.length === 0 && <small>No practice problems in this pack yet.</small>}
          {problems.map((p) => (
            <div key={p.index} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <span style={{ flex: 1 }}>
                {verdicts[p.index] === true && "✅ "}
                {verdicts[p.index] === false && "❌ "}
                {p.prompt}
              </span>
              <input
                value={practiceAnswers[p.index] ?? ""}
                onChange={(e) => setPracticeAnswers((a) => ({ ...a, [p.index]: e.target.value }))}
                style={{ ...inp, width: 110, margin: 0 }}
                placeholder="answer"
              />
              <button onClick={() => submitPractice(p)} disabled={busy} style={{ ...btn, padding: "8px 12px" }}>Check</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...card, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            background: m.role === "user" ? "#2b4c8c" : "#eef1f8",
            color: m.role === "user" ? "#fff" : "#1a1a2e",
            borderRadius: 12, padding: "10px 14px", maxWidth: "82%", whiteSpace: "pre-wrap",
          }}>
            {m.role === "assistant" && m.content ? <MathText text={m.content} /> : m.content || "…"}
            {m.role === "assistant" && m.content && !m.content.startsWith("(") && (
              <button onClick={() => speakMessage(m.content)} title="Hear this"
                style={{ border: "none", background: "transparent", cursor: "pointer", marginLeft: 6, fontSize: 14 }}>
                🔊
              </button>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div style={{ display: "flex", gap: 6, margin: "10px 0 6px", flexWrap: "wrap" }}>
        {(["plain", "story", "comic", "song"] as Format[]).map((f) => (
          <button key={f} onClick={() => setFormat(f)}
            style={{ ...chip, ...(format === f ? chipOn : {}) }}>
            {f === "plain" ? "normal" : `as a ${f}`}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {!participantId && <button
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={() => recording && stopRecording()}
          onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
          disabled={busy}
          className={recording ? "rec-pulse" : undefined}
          title="Hold to talk"
          style={{ ...btn, background: recording ? "#c0392b" : "#2b4c8c", minWidth: 52 }}>
          🎤
        </button>}
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          style={{ ...inp, flex: 1, margin: 0 }} placeholder={recording ? "listening…" : "Say something to your tutor…"} />
        <button onClick={send} disabled={busy} style={btn}>Send</button>
      </div>
      {error && <p style={errBox}>{error}</p>}
    </main>
  );
}

const lbl: React.CSSProperties = { display: "block", margin: "16px 0 6px", fontWeight: 600 };
const inp: React.CSSProperties = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccd3e0", fontSize: 15, boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "10px 18px", borderRadius: 8, border: "none", background: "#2b4c8c", color: "#fff", fontSize: 15, cursor: "pointer" };
const pill: React.CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "1px solid #ccd3e0", background: "#fff", cursor: "pointer", textAlign: "left" };
const pillOn: React.CSSProperties = { border: "2px solid #2b4c8c", background: "#eef1f8" };
const chip: React.CSSProperties = { padding: "5px 12px", borderRadius: 999, border: "1px solid #ccd3e0", background: "#fff", cursor: "pointer", fontSize: 13 };
const chipOn: React.CSSProperties = { border: "1px solid #2b4c8c", background: "#2b4c8c", color: "#fff" };
const errBox: React.CSSProperties = { background: "#fdecec", color: "#9d2b2b", borderRadius: 8, padding: "10px 14px", margin: "8px 0" };

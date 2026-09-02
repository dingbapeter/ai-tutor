"use client";

import { useEffect, useRef, useState } from "react";
import MathText from "../MathText";

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
interface Language {
  code: string;
  name: string;
  native: string;
  speaksAloud: boolean;
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
  const [languages, setLanguages] = useState<Language[]>([]);
  const [language, setLanguage] = useState("en");
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
  const [diagProblems, setDiagProblems] = useState<Array<{ index: number; prompt: string }> | null>(null);
  const [diagAnswers, setDiagAnswers] = useState<Record<number, string>>({});
  const [diagSubmitted, setDiagSubmitted] = useState<Set<number>>(new Set());
  const [diagResult, setDiagResult] = useState<{
    skills: Array<{ skillId: string; title: string; assessed: boolean; pct: number | null }>;
    recommend: { title: string; reason: string };
  } | null>(null);
  const [care, setCare] = useState<{ name: string; phone: string; relationship?: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recap, setRecap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [format, setFormat] = useState<Format>("plain");
  const [voiceOn, setVoiceOn] = useState(true);
  const [showPractice, setShowPractice] = useState(false);
  const [lessonSkillId, setLessonSkillId] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState<string | null>(null);
  const [examinable, setExaminable] = useState(true);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<number, string>>({});
  const [verdicts, setVerdicts] = useState<Record<number, boolean | null>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);

  const persona = personas.find((p) => p.id === personaId);

  useEffect(() => {
    fetch(`${API}/personas`).then((r) => r.json()).then(setPersonas).catch(() => {});
    fetch(`${API}/packs`).then((r) => r.json()).then(setPacks).catch(() => {});
    fetch(`${API}/languages`).then((r) => r.json()).then(setLanguages).catch(() => {});
    const savedLang = localStorage.getItem("dingba_language");
    if (savedLang) setLanguage(savedLang);
    // A question typed into the homepage ask box lands in the composer here.
    const params = new URLSearchParams(window.location.search);
    const ask = params.get("ask");
    if (ask) setInput(ask.slice(0, 2000));
    // A plan item tapped on the dashboard arrives as a lesson to start:
    // the pack is preselected and the session opens on that skill.
    const lessonParam = params.get("lesson");
    const packParam = params.get("pack");
    const studentParam = params.get("student");
    if (lessonParam && packParam) {
      setLessonSkillId(lessonParam);
      setPackId(packParam);
      if (studentParam) setStudentId(studentParam);
    }
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

  // The app bar steps aside while a session is live; the tutor gets the screen.
  useEffect(() => {
    if (sessionId) document.body.dataset.session = "1";
    else delete document.body.dataset.session;
    return () => { delete document.body.dataset.session; };
  }, [sessionId]);

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
        body: JSON.stringify({ text: text.slice(0, 2000), personaId, language }),
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
        body: JSON.stringify({
          ...(token && studentId
            ? { studentId, personaId, packId, language }
            : { studentName: name || "Student", personaId, packId, language, ...(parentEmail ? { parentEmail } : {}) }),
          ...(lessonSkillId ? { lessonSkillId } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `error ${res.status}`);
      const json = await res.json();
      setSessionId(json.sessionId);
      setLessonTitle(json.lesson?.title ?? null);
      setExaminable(json.examinable !== false);
      setVerdicts({});
      if (json.greeting) {
        // The tutor speaks first, like a person would.
        setMessages([{ role: "assistant", content: json.greeting }]);
        if (voiceOn) speakMessage(json.greeting);
      } else if (json.remembered > 0) {
        setMessages([{ role: "assistant", content: `(Your tutor remembers your last ${json.remembered > 1 ? "sessions" : "session"}.)` }]);
      } else {
        setMessages([]);
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

  async function startDiagnostic() {
    if (!sessionId) return;
    setError(null);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/diagnostic/start`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "level check unavailable");
      const json = await res.json();
      setDiagProblems(json.problems);
      setDiagAnswers({});
      setDiagSubmitted(new Set());
      setDiagResult(null);
      setShowPractice(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "level check unavailable");
    }
  }

  async function submitDiagAnswer(index: number) {
    const answer = diagAnswers[index]?.trim();
    if (!answer || !sessionId) return;
    const res = await fetch(`${API}/sessions/${sessionId}/diagnostic/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problemIndex: index, answer }),
    });
    if (res.ok) setDiagSubmitted((s) => new Set(s).add(index));
  }

  async function finishDiagnostic() {
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/diagnostic/finish`, { method: "POST" });
      if (!res.ok) throw new Error("could not finish the level check");
      const json = await res.json();
      setDiagProblems(null);
      setDiagResult({ skills: json.skills, recommend: json.recommend });
      setMessages((m) => [...m, { role: "assistant", content: json.note }]);
      if (voiceOn && json.note) speakMessage(json.note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not finish the level check");
    } finally {
      setBusy(false);
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
        { role: "user", content: `Finished the mock exam.` },
        {
          role: "assistant",
          content:
            `Score: ${json.score}/${json.of} in ${Math.round(json.durationSec / 60)} min.` +
            (json.unscored ? ` ${json.unscored} answer${json.unscored === 1 ? "" : "s"} need${json.unscored === 1 ? "s" : ""} your tutor's judgement.` : "") +
            `\n\n${json.postMortem}`,
        },
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
      const attempt = () =>
        fetch(`${API}/sessions/${sessionId}/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text,
            ...(format !== "plain" ? { format } : {}),
            ...(participantId ? { participantId } : {}),
          }),
        });
      // One retry on network failure — flaky connections shouldn't eat a turn.
      let res: Response;
      try {
        res = await attempt();
      } catch {
        await new Promise((r) => setTimeout(r, 1200));
        res = await attempt();
      }
      if (res.status === 402) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "You've reached today's limit. Upgrade to keep going.");
      }
      if (!res.ok || !res.body) throw new Error(`tutor unavailable (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";
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
            // At capacity is different from broken: show the server's own
            // wording, which carries the real wait hint.
            if (evt.busy && typeof evt.error === "string") throw new Error(evt.error);
            if (evt.error) throw new Error("Your tutor had trouble replying. Try that again.");
            // The tutor saw real distress: offer the trusted person, one tap.
            if (evt.care) setCare(evt.care);
            if (evt.delta) {
              full += evt.delta;
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
      if (voiceOn && full.trim()) speakMessage(full);
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
      // iOS Safari records audio/mp4, not webm — pick the first supported type.
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"].find(
        (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t),
      );
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
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
      setError("We can't reach your microphone. Check permissions and try again.");
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
      if (json.care) setCare(json.care);
      const bytes = Uint8Array.from(atob(json.audio), (c) => c.charCodeAt(0));
      playAudio(new Blob([bytes], { type: json.audioMime }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "voice failed");
      setMessages((m) => (m[m.length - 1]?.content === "🎤 …" ? m.slice(0, -1) : m));
    } finally {
      setBusy(false);
    }
  }

  async function sendPhoto(file: File) {
    if (!sessionId || busy) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("That photo is too large. Keep it under 5MB.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { role: "user", content: "📷 …" }]);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/see`, {
        method: "POST",
        headers: { "content-type": file.type || "image/jpeg" },
        body: file,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `photo failed (${res.status})`);
      const json = await res.json();
      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "user", content: "📷 Shared a photo" },
        { role: "assistant", content: json.reply },
      ]);
      if (voiceOn && json.reply) speakMessage(json.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : "photo failed");
      setMessages((m) => (m[m.length - 1]?.content === "📷 …" ? m.slice(0, -1) : m));
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
        { role: "user", content: `My answer to "${p.prompt}": ${answer}` },
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

  if (recap) {
    return (
      <main className="shell">
        <div className="card fadeUp">
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Avatar color={persona?.color} accent={persona?.accent} speaking={false} size={56} />
            <h2 style={{ margin: 0 }}>Session recap from {persona?.name}</h2>
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{recap}</p>
          <button className="btn big" onClick={() => { setRecap(null); setMessages([]); }}>
            Start another session
          </button>
        </div>
      </main>
    );
  }

  if (!sessionId) {
    return (
      <main className="shell">
        <div className="hero fadeUp">
          <h1>What do you want to <span>learn</span> today?</h1>
          <p>Ask anything. Learn anything. Your tutor remembers you.</p>
        </div>
        {error && <p className="err">{error}</p>}
        {personas.length === 0 && (
          <p className="notice">Waking your tutors up. Give it a moment, then try again.</p>
        )}
        <div className="card fadeUp">
          {family.length > 0 ? (
            <>
              <label className="lbl">Who&apos;s learning today?</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {family.map((s) => (
                  <button key={s.id} onClick={() => setStudentId(s.id)}
                    className={`pill${studentId === s.id ? " on" : ""}`}>
                    <b>{s.displayName}</b>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label className="lbl">Your name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="inp" placeholder="Ada" />

              <label className="lbl">Parent email (optional, for session recaps)</label>
              <input value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} className="inp" placeholder="parent@example.com" type="email" />
            </>
          )}

          {lessonSkillId && (
            <p className="notice" style={{ marginTop: 0 }}>
              Starting from your plan: this session opens as a lesson. Pick your tutor and go.
            </p>
          )}

          <label className="lbl">Pick your tutor</label>
          <div className="grid2">
            {personas.map((p) => (
              <button key={p.id} onClick={() => setPersonaId(p.id)}
                className={`pill${personaId === p.id ? " on" : ""}`}>
                <Avatar color={p.color} accent={p.accent} speaking={false} size={40} />
                <span><b>{p.name}</b><br /><small>{p.style}</small></span>
              </button>
            ))}
          </div>

          <label className="lbl">What are we working on?</label>
          <div className="grid2">
            {packs.map((p) => (
              <button key={p.id} onClick={() => setPackId(p.id)}
                className={`pill${packId === p.id ? " on" : ""}`}>
                <b>{p.title}</b>
              </button>
            ))}
          </div>

          <label className="lbl">Which language should your tutor teach in?</label>
          <select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              localStorage.setItem("dingba_language", e.target.value);
            }}
            className="inp"
            aria-label="Teaching language"
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native}
                {l.native !== l.name ? ` (${l.name})` : ""}
                {l.speaksAloud ? "" : " · text and listening"}
              </option>
            ))}
          </select>
          {languages.find((l) => l.code === language && !l.speaksAloud) && (
            <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "6px 0 0" }}>
              Your tutor teaches and understands you in this language today. A speaking
              voice for it is on the way.
            </p>
          )}

          <button
            disabled={!personaId || !packId || (family.length > 0 && !studentId)}
            onClick={startSession}
            className="btn big"
            style={{ marginTop: 22 }}>
            Start session
          </button>
          <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            {!joinOpen ? (
              <p style={{ textAlign: "center", margin: 0 }}>
                <button onClick={() => setJoinOpen(true)} className="btn ghost small">
                  Have a class code? Join a friend&apos;s live class
                </button>
              </p>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)}
                  className="inp" style={{ flex: 1, minWidth: 110 }} placeholder="Class code" />
                {!token && (
                  <input value={joinName} onChange={(e) => setJoinName(e.target.value)}
                    className="inp" style={{ flex: 1, minWidth: 110 }} placeholder="Your name" />
                )}
                <button onClick={joinClass} className="btn">Join class</button>
              </div>
            )}
          </div>
        </div>
        <p className="footlinks">
          <a href="/account">
            {token ? "Family dashboard" : "Parents: create an account for progress reports"}
          </a>
          {" · "}
          <a href="/credits">Built on open work 💙</a>
        </p>
      </main>
    );
  }

  return (
    <main className="session">
      <div className="session-head">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="avatar-live">
            <Avatar color={persona?.color} accent={persona?.accent} speaking={speaking} size={52} />
          </span>
          <div>
            <h2>{persona?.name}</h2>
            <div className="status">
              {lessonTitle ? `Lesson: ${lessonTitle} · ` : ""}
              {speaking ? "speaking…" : busy ? "thinking…" : "listening"}
            </div>
          </div>
        </div>
        <div className="session-actions">
          <button onClick={() => setVoiceOn(!voiceOn)} className="btn quiet small" title="Your tutor reads replies aloud">
            {voiceOn ? "🔊 Voice on" : "🔇 Voice off"}
          </button>
          {!participantId && (
            <>
              {examinable && <button onClick={startDiagnostic} className="btn quiet small">Check my level</button>}
              <button onClick={inviteFriend} className="btn quiet small">Invite</button>
              {examinable && <button onClick={startExam} className="btn quiet small">Mock exam</button>}
              <button onClick={openPractice} className={`btn small${showPractice ? "" : " quiet"}`}>Practice</button>
              <button onClick={endSession} className="btn ghost small">End</button>
            </>
          )}
          {participantId && <span className="status">in {hostName}&apos;s class</span>}
        </div>
      </div>

      {inviteCode && (
        <div className="card tray" style={{ textAlign: "center" }}>
          Friends join with code <span className="invite-code">{inviteCode}</span>
          <div><small className="status">They tap &ldquo;Join a friend&apos;s live class&rdquo; on the home page and enter it.</small></div>
        </div>
      )}

      {care && (
        <div className="care-card fadeUp">
          <div style={{ flex: 1 }}>
            <b>You don&apos;t have to sit with this alone.</b>
            <p style={{ margin: "4px 0 0", fontSize: 14.5 }}>
              {care.name}
              {care.relationship ? ` (${care.relationship})` : ""} is here for you. One tap and their phone rings.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a href={`tel:${care.phone.replace(/[^0-9+]/g, "")}`} className="btn care-call">
              📞 Call {care.name.split(" ")[0]}
            </a>
            <button onClick={() => setCare(null)} className="btn ghost small">Not now</button>
          </div>
        </div>
      )}

      {diagProblems && (
        <div className="card tray">
          <b>Level check. Answer what you can, skip what you can&apos;t. Results at the end.</b>
          {diagProblems.map((p) => (
            <div key={p.index} className="row">
              <span style={{ flex: 1 }}>{diagSubmitted.has(p.index) ? "✓ " : ""}{p.prompt}</span>
              <input value={diagAnswers[p.index] ?? ""} disabled={diagSubmitted.has(p.index)}
                onChange={(e) => setDiagAnswers((a) => ({ ...a, [p.index]: e.target.value }))}
                className="inp" placeholder="answer" />
              <button onClick={() => submitDiagAnswer(p.index)} disabled={diagSubmitted.has(p.index)}
                className="btn quiet small">Lock in</button>
            </div>
          ))}
          <button onClick={finishDiagnostic} disabled={busy || diagSubmitted.size === 0} className="btn" style={{ marginTop: 8 }}>
            Show me where I stand
          </button>
        </div>
      )}

      {diagResult && (
        <div className="card tray">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b>Where you stand</b>
            <button onClick={() => setDiagResult(null)} className="btn quiet small">Close</button>
          </div>
          {diagResult.skills.map((s) => (
            <div key={s.skillId} style={{ margin: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 3 }}>
                <span>{s.title}</span>
                <span style={{ color: "var(--text-dim)" }}>{s.assessed ? `${s.pct}%` : "not assessed"}</span>
              </div>
              <div style={{ background: "var(--surface-2)", borderRadius: 6, height: 9 }}>
                <div style={{
                  width: `${s.assessed ? s.pct : 0}%`, height: "100%", borderRadius: 6,
                  background: (s.pct ?? 0) >= 70 ? "var(--ok)" : (s.pct ?? 0) >= 40 ? "#d9a13f" : "var(--danger)",
                  transition: "width .4s",
                }} />
              </div>
            </div>
          ))}
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            Starting point: <b>{diagResult.recommend.title}</b>{" "}
            <span style={{ color: "var(--text-dim)" }}>({diagResult.recommend.reason})</span>
          </p>
        </div>
      )}

      {examProblems && (
        <div className="card tray">
          <b>Mock exam. Answers are checked at the end, keep moving.</b>
          {examProblems.map((p) => (
            <div key={p.index} className="row">
              <span style={{ flex: 1 }}>{examSubmitted.has(p.index) ? "✓ " : ""}{p.prompt}</span>
              <input value={examAnswers[p.index] ?? ""} disabled={examSubmitted.has(p.index)}
                onChange={(e) => setExamAnswers((a) => ({ ...a, [p.index]: e.target.value }))}
                className="inp" placeholder="answer" />
              <button onClick={() => submitExamAnswer(p.index)} disabled={examSubmitted.has(p.index)}
                className="btn quiet small">Lock in</button>
            </div>
          ))}
          <button onClick={finishExam} disabled={busy} className="btn" style={{ marginTop: 8 }}>
            Finish exam and get my results
          </button>
        </div>
      )}

      {showPractice && (
        <div className="card tray">
          {problems.length === 0 && <small>No practice problems in this pack yet.</small>}
          {problems.map((p) => (
            <div key={p.index} className="row">
              <span style={{ flex: 1 }}>
                {verdicts[p.index] === true && "✅ "}
                {verdicts[p.index] === false && "❌ "}
                {p.prompt}
              </span>
              <input
                value={practiceAnswers[p.index] ?? ""}
                onChange={(e) => setPracticeAnswers((a) => ({ ...a, [p.index]: e.target.value }))}
                className="inp"
                placeholder="answer"
              />
              <button onClick={() => submitPractice(p)} disabled={busy} className="btn quiet small">Check</button>
            </div>
          ))}
        </div>
      )}

      <div className="chat" style={{ marginTop: 10 }}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === "user" ? "user" : "tutor"}`}>
            {m.role === "assistant" && m.content ? <MathText text={m.content} /> : m.content || "…"}
            {m.role === "assistant" && m.content && !m.content.startsWith("(") && (
              <span className="tools">
                <button onClick={() => speakMessage(m.content)} title="Hear this">🔊</button>
                <button onClick={() => navigator.clipboard?.writeText(m.content).catch(() => {})} title="Copy">📋</button>
              </span>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="formats">
        {(["plain", "story", "comic", "song"] as Format[]).map((f) => (
          <button key={f} onClick={() => setFormat(f)}
            className={`chip${format === f ? " on" : ""}`}>
            {f === "plain" ? "normal" : `as a ${f}`}
          </button>
        ))}
      </div>

      <div className="composer">
        {!participantId && <button
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={() => recording && stopRecording()}
          onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
          disabled={busy}
          className={`btn${recording ? " danger rec-pulse" : ""}`}
          title="Hold to talk"
          style={{ minWidth: 52, padding: "12px 14px" }}>
          🎤
        </button>}
        {!participantId && (
          <>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) sendPhoto(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => photoInput.current?.click()}
              disabled={busy}
              className="btn quiet"
              title="Show your tutor a photo"
              style={{ minWidth: 52, padding: "12px 14px" }}>
              📷
            </button>
          </>
        )}
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          className="inp" placeholder={recording ? "listening…" : "Say something to your tutor…"} />
        <button onClick={send} disabled={busy} className="btn">Send</button>
      </div>
      {error && <p className="err">{error}</p>}
    </main>
  );
}

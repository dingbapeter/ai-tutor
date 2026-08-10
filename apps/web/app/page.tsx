"use client";

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;

interface Persona {
  id: string;
  name: string;
  style: string;
}
interface Pack {
  id: string;
  title: string;
  description: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function Home() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [packId, setPackId] = useState("");
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tutorName, setTutorName] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recap, setRecap] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/personas`).then((r) => r.json()).then(setPersonas).catch(() => {});
    fetch(`${API}/packs`).then((r) => r.json()).then(setPacks).catch(() => {});
  }, []);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  async function startSession() {
    const res = await fetch(`${API}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentName: name || "Student", personaId, packId }),
    });
    const json = await res.json();
    setSessionId(json.sessionId);
    setTutorName(json.persona.name);
  }

  async function send() {
    if (!input.trim() || !sessionId || busy) return;
    const text = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setBusy(true);

    const res = await fetch(`${API}/sessions/${sessionId}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const reader = res.body!.getReader();
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
          if (evt.delta) {
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                role: "assistant",
                content: copy[copy.length - 1].content + evt.delta,
              };
              return copy;
            });
          }
        } catch {}
      }
    }
    setBusy(false);
  }

  async function endSession() {
    if (!sessionId) return;
    const res = await fetch(`${API}/sessions/${sessionId}/end`, { method: "POST" });
    const json = await res.json();
    setRecap(json.recap);
    setSessionId(null);
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
          <h2>Session recap from {tutorName}</h2>
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
        <div style={card}>
          <label style={lbl}>Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inp} placeholder="Ada" />

          <label style={lbl}>Pick your tutor</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {personas.map((p) => (
              <button key={p.id} onClick={() => setPersonaId(p.id)}
                style={{ ...pill, ...(personaId === p.id ? pillOn : {}) }}>
                <b>{p.name}</b><br /><small>{p.style}</small>
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

          <button disabled={!personaId || !packId} onClick={startSession} style={{ ...btn, marginTop: 20 }}>
            Start session
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "24px auto", padding: 16, display: "flex", flexDirection: "column", height: "92vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 8 }}>Session with {tutorName}</h2>
        <button onClick={endSession} style={{ ...btn, background: "#8a93a6" }}>End session</button>
      </div>
      <div style={{ ...card, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            background: m.role === "user" ? "#2b4c8c" : "#eef1f8",
            color: m.role === "user" ? "#fff" : "#1a1a2e",
            borderRadius: 12, padding: "10px 14px", maxWidth: "80%", whiteSpace: "pre-wrap",
          }}>
            {m.content || "…"}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          style={{ ...inp, flex: 1, margin: 0 }} placeholder="Say something to your tutor…" />
        <button onClick={send} disabled={busy} style={btn}>Send</button>
      </div>
    </main>
  );
}

const lbl: React.CSSProperties = { display: "block", margin: "16px 0 6px", fontWeight: 600 };
const inp: React.CSSProperties = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccd3e0", fontSize: 15, boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "10px 18px", borderRadius: 8, border: "none", background: "#2b4c8c", color: "#fff", fontSize: 15, cursor: "pointer" };
const pill: React.CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "1px solid #ccd3e0", background: "#fff", cursor: "pointer", textAlign: "left" };
const pillOn: React.CSSProperties = { border: "2px solid #2b4c8c", background: "#eef1f8" };

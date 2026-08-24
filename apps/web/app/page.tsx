"use client";

import { useState } from "react";
import { RandomCaricature } from "./Caricatures";

/**
 * The Dingba storefront. The app itself lives at /learn; this page's one job
 * is to make a first-time visitor feel what a live tutor is, then send their
 * first question straight into a session.
 */

const TRY_THESE = [
  "Explain quantum physics simply",
  "Help me solve this equation",
  "Prepare me for WAEC Biology",
];

const SUBJECTS = [
  ["🧮", "Mathematics"],
  ["🔬", "Science"],
  ["🗣️", "Languages"],
  ["💻", "Coding"],
  ["🏛️", "History"],
  ["📈", "Business"],
  ["✍️", "Writing"],
  ["🎯", "Exam Prep"],
] as const;

const PROFILE_DEMO = [
  ["Mathematics", 78],
  ["Physics", 64],
  ["English", 91],
  ["Chemistry", 71],
] as const;

function Icon({ d, label }: { d: string; label: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label={label}>
      <path d={d} />
    </svg>
  );
}
const MIC = "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3";
const CLIP = "M21 12.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13 5a3.7 3.7 0 0 1 5.2 5.2l-8.2 8.2a1.8 1.8 0 0 1-2.6-2.6L15 8.3";
const CAM = "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";

export default function HomePage() {
  const [ask, setAsk] = useState("");

  function startLearning(question?: string) {
    const q = (question ?? ask).trim();
    window.location.href = q ? `/learn?ask=${encodeURIComponent(q.slice(0, 500))}` : "/learn";
  }

  return (
    <div className="home">
      <section className="home-hero fadeUp">
        <div className="hero-duo">
          <div className="hero-copy">
            <span className="live-pill">
              <span className="live-dot" aria-hidden />
              LIVE classes that feel human. Only smarter.
            </span>
            <h1>Meet your<br />personal <span>A.I</span> tutor.</h1>
            <p className="lede">Ask anything. Upload anything. Learn anything.</p>

            <div className="askbox big">
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startLearning()}
                placeholder="What do you want to learn today?"
                aria-label="What do you want to learn today?"
              />
              <div className="askbox-actions">
                <button className="ask-ico" title="Talk it out with your tutor" onClick={() => startLearning()}>
                  <Icon d={MIC} label="voice" />
                </button>
                <button className="ask-ico" title="Upload your work in the session" onClick={() => startLearning()}>
                  <Icon d={CLIP} label="upload" />
                </button>
                <button className="ask-ico" title="Show your tutor a photo in the session" onClick={() => startLearning()}>
                  <Icon d={CAM} label="camera" />
                </button>
                <span style={{ flex: 1 }} />
                <button className="send-orb" title="Start learning" onClick={() => startLearning()} aria-label="Start learning">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5 M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="try-chips" style={{ justifyContent: "flex-start" }}>
              <span style={{ color: "var(--text-dim)", fontSize: 13.5, fontWeight: 700, alignSelf: "center" }}>Try:</span>
              {TRY_THESE.map((t) => (
                <button key={t} className="chip" onClick={() => startLearning(t)}>{t}</button>
              ))}
            </div>
          </div>

          <div className="cast-stage">
            <span className="blob b1" aria-hidden />
            <span className="blob b2" aria-hidden />
            <span className="blob b3" aria-hidden />
            <div className="hero-cast">
              <RandomCaricature size={360} slot={0} bust />
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>Not just answers. Understanding.</h2>
        <p className="sub">A search engine hands you the result. A good tutor walks you to it, and makes sure it sticks.</p>
        <div className="duo">
          <div className="card mini-chat">
            <div className="msg user">Why is the derivative of x² equal to 2x?</div>
            <div className="msg tutor">Let&apos;s work it out together. Before I explain: if x grows from 2 to 3, what happens to x²?</div>
            <div className="msg user">It goes from 4 to 9... so it grew by 5?</div>
            <div className="msg tutor">Exactly. Now shrink that step smaller and smaller. What number does the growth per step settle towards?</div>
          </div>
          <div className="card">
            <b>Why it works this way</b>
            <p style={{ color: "var(--text-dim)", fontSize: 15 }}>
              Your tutor teaches the way great human tutors do: one question at a time,
              building on what you already know. Wrong answers aren&apos;t failures here,
              they&apos;re information. Every checkable answer in maths is verified by a
              real computer algebra system, so you&apos;re never confidently taught
              something false.
            </p>
            <p style={{ color: "var(--text-dim)", fontSize: 15, marginBottom: 0 }}>
              And when you say &quot;just show me&quot;, it shows you, then hands you a
              similar problem so the understanding is yours.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2>One tutor. Every subject.</h2>
        <p className="sub">The same tutor who helps with fractions today can rehearse your visa interview tomorrow.</p>
        <div className="subject-grid">
          {SUBJECTS.map(([ico, name]) => (
            <div key={name} className="card"><span className="ico" aria-hidden>{ico}</span>{name}</div>
          ))}
        </div>
      </section>

      <section>
        <h2>Dingba gets to know you.</h2>
        <p className="sub">
          Your tutor remembers what you&apos;ve learned. It knows what you&apos;re good at, where
          you&apos;re struggling, what you&apos;ve already studied and what to work on next.
        </p>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <div className="hero-cast" style={{ paddingBottom: 8 }}>
            <RandomCaricature size={120} slot={2} />
          </div>
        <div className="card" style={{ maxWidth: 460, margin: "0 auto 0 0", flex: "1 1 300px" }}>
          <b>Peter&apos;s learning profile</b>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {PROFILE_DEMO.map(([subject, pct]) => (
              <div key={subject}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
                  <span>{subject}</span>
                  <span style={{ color: "var(--text-dim)" }}>{pct}%</span>
                </div>
                <div className="bar"><div style={{ width: `${pct}%` }} /></div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 0, marginTop: 12 }}>
            Illustration. Your own profile builds from your real sessions.
          </p>
        </div>
        </div>
      </section>

      <section>
        <h2>Learn your way.</h2>
        <div className="way-grid">
          <div className="card">
            <b>Talk to Dingba</b>
            <p>Real voice conversation with your tutor. They greet you first, like a person would.</p>
          </div>
          <div className="card">
            <b>Challenge Dingba</b>
            <p>Practice problems, timed mock exams, and honest post-mortems on every miss.</p>
          </div>
          <div className="card">
            <b>Show Dingba</b>
            <p>Photograph your homework or a textbook page, and your tutor teaches from it.</p>
          </div>
          <div className="card">
            <b>Watch Dingba<span className="tag-soon">on the way</span></b>
            <p>Visual, drawn-out explanations for the concepts words alone can&apos;t carry.</p>
          </div>
        </div>
      </section>

      <section>
        <h2>From &quot;I don&apos;t understand&quot; to &quot;I get it.&quot;</h2>
        <div className="journey" style={{ marginTop: 18 }}>
          <span className="step">Question</span>
          <span aria-hidden>→</span>
          <span className="step">Explanation</span>
          <span aria-hidden>→</span>
          <span className="step">Guided practice</span>
          <span aria-hidden>→</span>
          <span className="step">Feedback</span>
          <span aria-hidden>→</span>
          <span className="step">Mastery</span>
        </div>
      </section>

      <section>
        <h2>Your entire learning life.</h2>
        <p className="sub">Dingba grows with you.</p>
        <div className="life-chips">
          {["School", "University", "Exams", "Languages", "Coding", "Career", "Curiosity"].map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </section>

      <div className="cta-panel">
        <div className="hero-cast" style={{ marginBottom: 6 }}>
          <RandomCaricature size={110} slot={4} />
        </div>
        <h2>Ready to learn? Your tutor is waiting.</h2>
        <button className="btn" onClick={() => startLearning()}>Start learning with Dingba</button>
      </div>

      <footer className="site-footer">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/credits">Built on open work 💙</a>
      </footer>
    </div>
  );
}

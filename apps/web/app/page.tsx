"use client";

import { useEffect, useState } from "react";
import { RandomCaricature } from "./Caricatures";
import { HEADLINES } from "./headlines";
import { useLang } from "./i18n";
import Highlighted from "./Highlighted";

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
  // One of many voices per visit. First paint is deterministic so hydration
  // never mismatches; the shuffle lands right after mount.
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(Math.floor(Math.random() * HEADLINES.length)), []);
  const line = HEADLINES[pick];
  const { t } = useLang();

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
              {t("LIVE classes that feel human. Only smarter.")}
            </span>
            <h1><Highlighted text={t(line.headline)} /></h1>
            <p className="lede">{t(line.sub)}</p>

            <div className="askbox big">
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startLearning()}
                placeholder={t("What do you want to learn today?")}
                aria-label={t("What do you want to learn today?")}
              />
              <div className="askbox-actions">
                <button className="ask-ico" title={t("Talk it out with your tutor")} onClick={() => startLearning()}>
                  <Icon d={MIC} label={t("voice")} />
                </button>
                <button className="ask-ico" title={t("Upload your work in the session")} onClick={() => startLearning()}>
                  <Icon d={CLIP} label={t("upload")} />
                </button>
                <button className="ask-ico" title={t("Show your tutor a photo in the session")} onClick={() => startLearning()}>
                  <Icon d={CAM} label={t("camera")} />
                </button>
                <span style={{ flex: 1 }} />
                <button className="send-orb" title={t("Start learning")} onClick={() => startLearning()} aria-label={t("Start learning")}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5 M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="try-chips" style={{ justifyContent: "flex-start" }}>
              <span style={{ color: "var(--text-dim)", fontSize: 13.5, fontWeight: 700, alignSelf: "center" }}>{t("Try:")}</span>
              {TRY_THESE.map((line) => (
                <button key={line} className="chip" onClick={() => startLearning(t(line))}>{t(line)}</button>
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
        <h2>{t("Not just answers. Understanding.")}</h2>
        <p className="sub">{t("A search engine hands you the result. A good tutor walks you to it, and makes sure it sticks.")}</p>
        <div className="duo">
          <div className="card mini-chat">
            <div className="msg user">{t("Why is the derivative of x² equal to 2x?")}</div>
            <div className="msg tutor">{t("Let's work it out together. Before I explain: if x grows from 2 to 3, what happens to x²?")}</div>
            <div className="msg user">{t("It goes from 4 to 9... so it grew by 5?")}</div>
            <div className="msg tutor">{t("Exactly. Now shrink that step smaller and smaller. What number does the growth per step settle towards?")}</div>
          </div>
          <div className="card">
            <b>{t("Why it works this way")}</b>
            <p style={{ color: "var(--text-dim)", fontSize: 15 }}>
              {t("Your tutor teaches the way great human tutors do: one question at a time, building on what you already know. Wrong answers aren't failures here, they're information. Every checkable answer in maths is verified by a real computer algebra system, so you're never confidently taught something false.")}
            </p>
            <p style={{ color: "var(--text-dim)", fontSize: 15, marginBottom: 0 }}>
              {t("And when you say \"just show me\", it shows you, then hands you a similar problem so the understanding is yours.")}
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2>{t("One tutor. Every subject.")}</h2>
        <p className="sub">{t("The same tutor who helps with fractions today can rehearse your visa interview tomorrow.")}</p>
        <div className="subject-grid">
          {SUBJECTS.map(([ico, name]) => (
            <div key={name} className="card"><span className="ico" aria-hidden>{ico}</span>{t(name)}</div>
          ))}
        </div>
      </section>

      <section>
        <h2>{t("Dingba gets to know you.")}</h2>
        <p className="sub">
          {t("Your tutor remembers what you've learned. It knows what you're good at, where you're struggling, what you've already studied and what to work on next.")}
        </p>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <div className="hero-cast" style={{ paddingBottom: 8 }}>
            <RandomCaricature size={120} slot={2} />
          </div>
        <div className="card" style={{ maxWidth: 460, margin: "0 auto 0 0", flex: "1 1 300px" }}>
          <b>{t("Peter's learning profile")}</b>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {PROFILE_DEMO.map(([subject, pct]) => (
              <div key={subject}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
                  <span>{t(subject)}</span>
                  <span style={{ color: "var(--text-dim)" }}>{pct}%</span>
                </div>
                <div className="bar"><div style={{ width: `${pct}%` }} /></div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 0, marginTop: 12 }}>
            {t("Illustration. Your own profile builds from your real sessions.")}
          </p>
        </div>
        </div>
      </section>

      <section>
        <h2>{t("Learn your way.")}</h2>
        <div className="way-grid">
          <div className="card">
            <b>{t("Talk to Dingba")}</b>
            <p>{t("Real voice conversation with your tutor. They greet you first, like a person would.")}</p>
          </div>
          <div className="card">
            <b>{t("Challenge Dingba")}</b>
            <p>{t("Practice problems, timed mock exams, and honest post-mortems on every miss.")}</p>
          </div>
          <div className="card">
            <b>{t("Show Dingba")}</b>
            <p>{t("Photograph your homework or a textbook page, and your tutor teaches from it.")}</p>
          </div>
          <div className="card">
            <b>{t("Watch Dingba")}<span className="tag-soon">{t("on the way")}</span></b>
            <p>{t("Visual, drawn-out explanations for the concepts words alone can't carry.")}</p>
          </div>
        </div>
      </section>

      <section>
        <h2>{t("From \"I don't understand\" to \"I get it.\"")}</h2>
        <div className="journey" style={{ marginTop: 18 }}>
          <span className="step">{t("Question")}</span>
          <span aria-hidden>→</span>
          <span className="step">{t("Explanation")}</span>
          <span aria-hidden>→</span>
          <span className="step">{t("Guided practice")}</span>
          <span aria-hidden>→</span>
          <span className="step">{t("Feedback")}</span>
          <span aria-hidden>→</span>
          <span className="step">{t("Mastery")}</span>
        </div>
      </section>

      <section>
        <h2>{t("Your entire learning life.")}</h2>
        <p className="sub">{t("Dingba grows with you.")}</p>
        <div className="life-chips">
          {["School", "University", "Exams", "Languages", "Coding", "Career", "Curiosity"].map((l) => (
            <span key={l}>{t(l)}</span>
          ))}
        </div>
      </section>

      <div className="cta-panel">
        <div className="hero-cast" style={{ marginBottom: 6 }}>
          <RandomCaricature size={110} slot={4} />
        </div>
        <h2>{t("Ready to learn? Your tutor is waiting.")}</h2>
        <button className="btn" onClick={() => startLearning()}>{t("Start learning with Dingba")}</button>
      </div>

      <footer className="site-footer">
        <a href="/terms">{t("Terms")}</a>
        <a href="/privacy">{t("Privacy")}</a>
        <a href="/credits">{t("Built on open work 💙")}</a>
      </footer>
    </div>
  );
}

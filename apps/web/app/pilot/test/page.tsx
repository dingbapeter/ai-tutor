"use client";

/**
 * A learner sits a pilot test here, from their own link, with no sign-in.
 *
 * One question at a time. Every answer is saved as the learner moves on,
 * so a dropped connection or a closed tab loses nothing and the same link
 * carries on where they stopped. Nothing is marked in front of them: the
 * test measures, it does not teach, and a child should not leave it
 * feeling judged.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import MathText from "../../MathText";
import { useLang } from "../../i18n";

const API = process.env.NEXT_PUBLIC_API_URL!;

interface Question {
  id: string;
  prompt: string;
}
type State = "loading" | "unknown" | "open" | "done" | "closed" | "missed-start" | "offline";

function Test() {
  const { t } = useLang();
  const code = useSearchParams().get("code") ?? "";
  const [state, setState] = useState<State>("loading");
  const [learner, setLearner] = useState("");
  const [pilot, setPilot] = useState("");
  const [phase, setPhase] = useState<"baseline" | "endline">("baseline");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** What the server holds, so only a changed answer is sent. */
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [at, setAt] = useState(-1); // -1 is the welcome, questions.length is the hand-in
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    if (!/^[a-f0-9]{32}$/.test(code)) return setState("unknown");
    try {
      const res = await fetch(`${API}/pilot-tests/${code}/open`, { method: "POST" });
      if (res.status === 404 || res.status === 400) return setState("unknown");
      if (!res.ok) return setState("offline");
      const body = await res.json();
      setLearner(body.learner ?? "");
      setPilot(body.pilot ?? "");
      if (body.phase) setPhase(body.phase);
      if (body.state === "open") {
        setQuestions(body.questions);
        setAnswers(body.answers ?? {});
        setSaved(body.answers ?? {});
      }
      setState(body.state);
    } catch {
      setState("offline");
    }
  }, [code]);

  useEffect(() => {
    void open();
  }, [open]);

  /** Saves the answer on screen if it changed. False means it could not be saved, and the learner stays put. */
  async function keep(): Promise<boolean> {
    const q = questions[at];
    if (!q) return true;
    const answer = (answers[q.id] ?? "").trim();
    if (!answer || answer === saved[q.id]) return true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/pilot-tests/${code}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: q.id, answer }),
      });
      if (!res.ok) throw new Error();
      setSaved((s) => ({ ...s, [q.id]: answer }));
      return true;
    } catch {
      setError(t("That answer could not be saved. Check the connection and try again."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function go(to: number) {
    if (busy) return;
    if (await keep()) setAt(to);
  }

  async function handIn() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/pilot-tests/${code}/finish`, { method: "POST" });
      if (!res.ok) throw new Error();
      setState("done");
    } catch {
      setError(t("The test could not be handed in. Check the connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <p>{t("Opening your test…")}</p>;
  if (state === "unknown") return <div className="card"><p>{t("This test link is not recognised. Ask your teacher for your link.")}</p></div>;
  if (state === "offline")
    return (
      <div className="card">
        <p>{t("The test could not be opened. Check the connection and try again.")}</p>
        <button className="btn" onClick={() => { setState("loading"); void open(); }}>{t("Try again")}</button>
      </div>
    );
  if (state === "closed") return <div className="card"><p>{t("This test has closed.")}</p></div>;
  if (state === "missed-start")
    return <div className="card"><p>{t("The final test is only for learners who sat the starting test. There is nothing for you to do here.")}</p></div>;
  if (state === "done")
    return (
      <div className="card fadeUp" style={{ textAlign: "center" }}>
        <h1 style={{ marginTop: 0 }}>{t("Handed in")} ✅</h1>
        <p>{t("Thank you, {name}. You can close this page.", { name: learner })}</p>
      </div>
    );

  const total = questions.length;
  const done = questions.filter((q) => (answers[q.id] ?? "").trim()).length;

  if (at === -1) {
    const started = Object.keys(saved).length > 0;
    return (
      <div className="card fadeUp">
        <h1 style={{ marginTop: 0 }}>{t("Hello, {name}.", { name: learner })}</h1>
        <p><b>{phase === "baseline" ? t("Starting test") : t("Final test")}</b> · {pilot}</p>
        <p>{t("This short test is not marked in front of you and it does not count against you. It shows your teacher where to help.")}</p>
        <p>{t("Work on your own. If you do not know an answer, leave it and move on.")}</p>
        <button className="btn big" onClick={() => setAt(started ? Math.min(total - 1, Math.max(0, questions.findIndex((q) => !saved[q.id]))) : 0)}>
          {started ? t("Carry on with the test") : t("Start the test")}
        </button>
      </div>
    );
  }

  if (at >= total) {
    return (
      <div className="card fadeUp">
        <h1 style={{ marginTop: 0 }}>{t("Hand in?")}</h1>
        <p>{t("You have answered {done} of {total} questions.", { done, total })}</p>
        {error && <p className="err">{error}</p>}
        <button className="btn big" disabled={busy} onClick={handIn}>{t("Hand in")}</button>
        <p style={{ textAlign: "center", marginBottom: 0 }}>
          <button className="btn quiet small" disabled={busy} onClick={() => setAt(total - 1)}>{t("Go back to the questions")}</button>
        </p>
      </div>
    );
  }

  const q = questions[at];
  return (
    <div className="card fadeUp">
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>{t("Question {n} of {total}", { n: at + 1, total })}</p>
      <div className="pilot-question"><MathText text={q.prompt} /></div>
      <label className="lbl" htmlFor="pilot-answer">{t("Your answer")}</label>
      <input
        id="pilot-answer"
        key={q.id}
        className="inp"
        autoComplete="off"
        autoCapitalize="off"
        autoFocus
        value={answers[q.id] ?? ""}
        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
        onKeyDown={(e) => e.key === "Enter" && void go(at + 1)}
      />
      {error && <p className="err">{error}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button className="btn quiet" disabled={busy || at === 0} onClick={() => void go(at - 1)}>{t("Back")}</button>
        <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => void go(at + 1)}>
          {at === total - 1 ? t("Finish") : t("Next")}
        </button>
      </div>
    </div>
  );
}

export default function PilotTestPage() {
  return (
    <main className="shell" style={{ maxWidth: 560 }}>
      <Suspense fallback={<p>…</p>}>
        <Test />
      </Suspense>
    </main>
  );
}

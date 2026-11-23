"use client";

/**
 * A school's pilot: set it up, hand each learner their test link, open the
 * final test, and read the result. The report at the bottom is the page a
 * head teacher prints: with the print button, only the report prints.
 */
import { useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;

interface Option {
  id: string;
  title: string;
  skills: Array<{ id: string; title: string }>;
}
interface Summary {
  id: string;
  name: string;
  packTitle: string;
  comparison: boolean;
  status: "baseline" | "endline" | "closed";
  questionsPerTest: number;
  skills: Array<{ id: string; title: string }>;
  createdAt: string;
  endlineOpenedAt: string | null;
  closedAt: string | null;
}
interface Member {
  studentId: string;
  displayName: string;
  group: "tutor" | "comparison";
  code: string;
  baseline: string;
  endline: string;
}
interface Detail extends Summary {
  members: Member[];
  notEnrolled: number;
}
interface Gain {
  n: number;
  preMean: number;
  postMean: number;
  gain: number;
  ci: [number, number] | null;
  effect: number | null;
  improved: number;
}
interface Flow {
  enrolled: number;
  satBaseline: number;
  satEndline: number;
  matched: number;
}
interface Report {
  school: string;
  subject: string;
  skillsTested: string[];
  design: string;
  itemsPerForm: number;
  strength: "not-finished" | "too-few" | "early" | "result";
  flow: { tutor: Flow; comparison: Flow };
  tutor: Gain | null;
  comparison: Gain | null;
  difference: { difference: number; ci: [number, number] | null; effect: number | null } | null;
  skills: Array<{ skillId: string; title: string; before: number; after: number }>;
  dosage: { medianSessions: number; medianActiveDays: number } | null;
  integrity: { formOrders: { AB: number; BA: number }; medianDaysBetweenTests: number | null; startedNotFinished: number };
  reading: string[];
  learners: Array<{ code: string; displayName: string; arm: string; baseline: number | null; endline: number | null; gain: number | null; sessions: number }>;
  pilot: { createdAt: string; endlineOpenedAt: string | null; closedAt: string | null };
}

const one = (n: number) => (Math.round(n * 10) / 10).toString();
const signed = (n: number) => `${n > 0 ? "+" : ""}${one(n)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const STATUS: Record<Summary["status"], string> = {
  baseline: "Starting test open",
  endline: "Final test open",
  closed: "Closed",
};

export default function PilotPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [pilots, setPilots] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [noOrg, setNoOrg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // The new-pilot form.
  const [name, setName] = useState("");
  const [packId, setPackId] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState(false);

  const call = useCallback(async (t: string, path: string, init?: RequestInit) => {
    const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${t}`, ...(init?.body ? { "content-type": "application/json" } : {}) } });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(body?.error ?? `could not load (${res.status})`), { status: res.status });
    return body;
  }, []);

  const show = useCallback(
    async (t: string, id: string) => {
      setDetail(await call(t, `/orgs/pilots/${id}`));
      setReport(await call(t, `/orgs/pilots/${id}/report`));
    },
    [call],
  );

  const load = useCallback(
    async (t: string, wanted?: string | null) => {
      setError(null);
      try {
        const list = (await call(t, "/orgs/pilots")) as { options: Option[]; pilots: Summary[] };
        setOptions(list.options);
        setPilots(list.pilots);
        setPackId((p) => p || list.options[0]?.id || "");
        const current = list.pilots.find((p) => p.id === wanted) ?? list.pilots.find((p) => p.status !== "closed") ?? list.pilots[0];
        if (current) await show(t, current.id);
        else {
          setDetail(null);
          setReport(null);
        }
      } catch (e) {
        if ((e as { status?: number }).status === 404) setNoOrg(true);
        else setError((e as Error).message);
      }
    },
    [call, show],
  );

  useEffect(() => {
    const t = localStorage.getItem("tutor_token");
    setToken(t);
    setChecked(true);
    if (t) void load(t, new URLSearchParams(window.location.search).get("id"));
  }, [load]);

  async function act(fn: () => Promise<unknown>, reloadId?: string | null) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load(token, reloadId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    act(async () => {
      const made = await call(token!, "/orgs/pilots", { method: "POST", body: JSON.stringify({ name: name.trim(), packId, comparison, ...(chosen.size ? { skillIds: [...chosen] } : {}) }) });
      setName("");
      setChosen(new Set());
      return made;
    });

  async function download(withNames: boolean) {
    if (!token || !detail) return;
    const res = await fetch(`${API}/orgs/pilots/${detail.id}/results.csv${withNames ? "?names=1" : ""}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return setError("could not prepare the spreadsheet");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "dingba-pilot.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const linkFor = (code: string) => `${window.location.origin}/pilot/test?code=${code}`;
  async function copy(m: Member) {
    try {
      await navigator.clipboard.writeText(linkFor(m.code));
      setCopied(m.studentId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this link:", linkFor(m.code));
    }
  }

  if (!checked) return null;
  if (!token || noOrg) {
    return (
      <main className="shell" style={{ maxWidth: 520 }}>
        <h1>School pilot</h1>
        <div className="card">
          <p>A pilot measures what your learners gain from the tutor, with a short test before and after. Set up your school first.</p>
          <p><a className="btn" href="/school">Open the school portal</a></p>
        </div>
      </main>
    );
  }

  const pack = options.find((o) => o.id === packId);
  const running = pilots.some((p) => p.status !== "closed");
  const phase = detail?.status === "endline" ? "endline" : "baseline";
  const sat = detail ? detail.members.filter((m) => m[phase] === "done").length : 0;

  return (
    <main className="shell wide">
      <div className="no-print">
        <h1>School pilot</h1>
        <p style={{ color: "var(--text-dim)", marginTop: -6 }}>
          Measure what your learners gain: a short test before, some weeks with the tutor, a matched test after.
        </p>
        {error && <p className="err">{error}</p>}

        {!running && (
          <div className="card">
            <b>Start a pilot</b>
            {options.length === 0 ? (
              <p>No subject has enough machine-marked questions for a fair test yet.</p>
            ) : (
              <>
                <label className="lbl">Name</label>
                <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="JSS2 mathematics, first term" />
                <label className="lbl">Subject</label>
                <select className="inp" value={packId} onChange={(e) => { setPackId(e.target.value); setChosen(new Set()); }}>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
                <label className="lbl">Topics to test</label>
                <p style={{ fontSize: 13.5, color: "var(--text-dim)", margin: "0 0 8px" }}>
                  Tick the topics your class will cover during the pilot. Leave them all unticked to test across the whole subject.
                  Up to ten topics get two questions each; more get one each, twenty questions at most.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {pack?.skills.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`pill${chosen.has(s.id) ? " on" : ""}`}
                      aria-pressed={chosen.has(s.id)}
                      style={{ padding: "6px 12px", fontSize: 13.5 }}
                      onClick={() => setChosen((c) => { const n = new Set(c); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, cursor: "pointer" }}>
                  <input type="checkbox" checked={comparison} onChange={(e) => setComparison(e.target.checked)} style={{ marginTop: 4 }} />
                  <span>
                    <b>Include a comparison group</b>
                    <br />
                    <span style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
                      Half the class, picked by chance, waits for the tutor until the pilot ends. Both halves sit both tests.
                      This is the only way the result can show the tutor caused the gain; without it, the report can say that
                      learners improved, not why. The waiting half gets the tutor the day you close the pilot.
                    </span>
                  </span>
                </label>
                <button className="btn" disabled={busy || name.trim().length < 2 || !packId} onClick={start} style={{ marginTop: 14 }}>
                  Start the pilot
                </button>
                <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 0 }}>
                  Everyone on your roster is enrolled. Add your learners in the <a href="/school">school portal</a> first.
                  For an average to mean anything, at least ten learners need to sit both tests (ten in each group with a comparison); thirty or more makes a result worth showing outside the school.
                </p>
              </>
            )}
          </div>
        )}

        {detail && (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <b>{detail.name}</b>
              <span className={`cc-tag${detail.status === "closed" ? "" : " ok"}`}>{STATUS[detail.status]}</span>
            </div>
            <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "4px 0 10px" }}>
              {detail.packTitle} · {detail.questionsPerTest} questions a test · {detail.members.length} learners
              {detail.comparison ? " in two groups" : ""} · started {day(detail.createdAt)}
            </p>

            {detail.status !== "closed" && (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  {detail.status === "baseline" ? (
                    <>
                      <b>Step 1.</b> Give each learner their link below and have them sit the starting test, on their own and without help.
                      {detail.comparison ? " Learners in the tutor group can begin lessons as soon as they have handed in. " : " A learner can begin lessons as soon as they have handed in. "}
                      <b>Step 2.</b> Let the class use the tutor for the weeks you planned. <b>Step 3.</b> Then open the final test.
                    </>
                  ) : (
                    <>The final test is open. Each learner uses the same link as before; it now opens the final test, which asks different questions on the same topics.</>
                  )}
                </p>
                <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "0 0 10px" }}>
                  {sat} of {detail.members.length} have handed in the {phase === "baseline" ? "starting" : "final"} test.
                  {" "}Questions used in the tests are kept out of these learners&apos; practice until the pilot closes.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {detail.status === "baseline" && detail.notEnrolled > 0 && (
                    <button className="btn quiet small" disabled={busy} onClick={() => act(() => call(token, `/orgs/pilots/${detail.id}/enrol`, { method: "POST" }), detail.id)}>
                      Enrol {detail.notEnrolled} new learner{detail.notEnrolled === 1 ? "" : "s"}
                    </button>
                  )}
                  {detail.status === "baseline" && (
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Open the final test? The starting test closes for good. ${detail.members.length - sat} learner(s) have not handed it in and will be left out of the result.`)) {
                          void act(() => call(token, `/orgs/pilots/${detail.id}/status`, { method: "POST", body: JSON.stringify({ status: "endline" }) }), detail.id);
                        }
                      }}
                    >
                      Open the final test
                    </button>
                  )}
                  <button
                    className="btn quiet small"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Close the pilot? No more tests can be sat. The result stays here.")) {
                        void act(() => call(token, `/orgs/pilots/${detail.id}/status`, { method: "POST", body: JSON.stringify({ status: "closed" }) }), detail.id);
                      }
                    }}
                  >
                    Close the pilot
                  </button>
                </div>

                <div className="cc-table-wrap">
                  <table className="cc-table">
                    <thead>
                      <tr>
                        <th>Learner</th>
                        {detail.comparison && <th>Group</th>}
                        <th>Starting test</th>
                        <th>Final test</th>
                        <th>Test link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.members.map((m) => (
                        <tr key={m.studentId}>
                          <td>{m.displayName}</td>
                          {detail.comparison && <td>{m.group === "tutor" ? "Tutor" : "Waits"}</td>}
                          <td>{m.baseline}</td>
                          <td>{m.endline}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button className="btn quiet small" onClick={() => copy(m)}>{copied === m.studentId ? "Copied" : "Copy"}</button>{" "}
                            <a className="btn ghost small" href={`/pilot/test?code=${m.code}`} target="_blank" rel="noreferrer">Open</a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {pilots.length > 1 && (
          <p style={{ fontSize: 14 }}>
            Your pilots:{" "}
            {pilots.map((p, i) => (
              <span key={p.id}>
                {i > 0 && " · "}
                {p.id === detail?.id ? <b>{p.name}</b> : <a href={`/school/pilot?id=${p.id}`}>{p.name}</a>}
              </span>
            ))}
          </p>
        )}
      </div>

      {report && detail && (
        <section className="card pilot-report" aria-label="Pilot report">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{report.school}: {detail.name}</h2>
            <span className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn quiet small" onClick={() => window.print()}>Print</button>
              <button className="btn quiet small" onClick={() => download(true)}>Spreadsheet with names</button>
              <button className="btn quiet small" onClick={() => download(false)}>Spreadsheet without names</button>
            </span>
          </div>
          <p style={{ color: "var(--text-dim)", fontSize: 14, margin: "4px 0 12px" }}>
            {report.subject} · {report.design === "randomised comparison" ? "Randomised comparison: half the class, picked by chance, waited for the tutor" : "Before and after, no comparison group"}
            {" "}· {report.itemsPerForm} questions a test · {day(report.pilot.createdAt)}
            {report.pilot.endlineOpenedAt ? ` to ${day(report.pilot.closedAt ?? report.pilot.endlineOpenedAt)}` : ""}
          </p>

          {report.tutor && (
            <div className="cc-stats">
              <div className="cc-stat">
                <p className="k">Before</p>
                <p className="v">{one(report.tutor.preMean)}%</p>
                <p className="n">average score, {report.tutor.n} tutored learners</p>
              </div>
              <div className="cc-stat">
                <p className="k">After</p>
                <p className="v">{one(report.tutor.postMean)}%</p>
                <p className="n">{Math.round(report.tutor.improved * 100)}% of them scored higher</p>
              </div>
              <div className="cc-stat">
                <p className="k">Change</p>
                <p className="v">{signed(report.tutor.gain)}</p>
                <p className="n">points{report.tutor.ci ? ` · 95% interval ${one(report.tutor.ci[0])} to ${one(report.tutor.ci[1])}` : ""}</p>
              </div>
              {report.difference && (
                <div className="cc-stat">
                  <p className="k">More than comparison</p>
                  <p className="v">{signed(report.difference.difference)}</p>
                  <p className="n">points{report.difference.ci ? ` · 95% interval ${one(report.difference.ci[0])} to ${one(report.difference.ci[1])}` : ""}</p>
                </div>
              )}
            </div>
          )}

          <h3>What this shows</h3>
          {report.reading.map((line, i) => <p key={i} style={{ margin: "0 0 8px" }}>{line}</p>)}

          <h3>Who took part</h3>
          <div className="cc-table-wrap">
            <table className="cc-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th className="num">Enrolled</th>
                  <th className="num">Sat starting test</th>
                  <th className="num">Sat final test</th>
                  <th className="num">Sat both</th>
                </tr>
              </thead>
              <tbody>
                {(report.design === "randomised comparison" ? (["tutor", "comparison"] as const) : (["tutor"] as const)).map((arm) => (
                  <tr key={arm}>
                    <td>{arm === "tutor" ? "Tutored" : "Comparison (waited)"}</td>
                    <td className="num">{report.flow[arm].enrolled}</td>
                    <td className="num">{report.flow[arm].satBaseline}</td>
                    <td className="num">{report.flow[arm].satEndline}</td>
                    <td className="num">{report.flow[arm].matched}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.skills.length > 0 && (
            <>
              <h3>By topic, tutored learners</h3>
              <div className="cc-table-wrap">
                <table className="cc-table">
                  <thead>
                    <tr>
                      <th>Topic</th>
                      <th className="num">Right before</th>
                      <th className="num">Right after</th>
                      <th className="num">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.skills.map((s) => (
                      <tr key={s.skillId}>
                        <td>{s.title}</td>
                        <td className="num">{Math.round(s.before)}%</td>
                        <td className="num">{Math.round(s.after)}%</td>
                        <td className="num">{signed(s.after - s.before)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-dim)" }}>With one or two questions a topic, read this table as a guide to where to look, not as a score for each topic.</p>
            </>
          )}

          <h3>How it was measured</h3>
          <ul style={{ fontSize: 14, paddingLeft: 20, margin: 0 }}>
            <li>Two tests of {report.itemsPerForm} questions on the same topics, with different questions. Half the learners sat one first and half the other ({report.integrity.formOrders.AB} and {report.integrity.formOrders.BA}), so a difference in difficulty between the two cannot pass for learning.</li>
            <li>Every answer was marked by a computer algebra checker, the same way for everyone. A question left blank counts as wrong.</li>
            <li>The test questions were kept out of these learners&apos; lessons and practice while the pilot ran.</li>
            {report.design === "randomised comparison" && <li>Who was tutored was decided by chance, not chosen by the school or by Dingba. The comparison group could not start a lesson until the pilot closed.</li>}
            {report.dosage && <li>Between their two tests, a typical tutored learner (the median) had {one(report.dosage.medianSessions)} sessions with the tutor, on {one(report.dosage.medianActiveDays)} different days.</li>}
            {report.integrity.medianDaysBetweenTests !== null && <li>For a typical learner the two tests were {one(report.integrity.medianDaysBetweenTests)} days apart.</li>}
            {report.integrity.startedNotFinished > 0 && <li>{report.integrity.startedNotFinished} test{report.integrity.startedNotFinished === 1 ? " was" : "s were"} started and never handed in, and not counted.</li>}
          </ul>

          <h3 className="no-print">Each learner</h3>
          <div className="cc-table-wrap no-print">
            <table className="cc-table">
              <thead>
                <tr>
                  <th>Learner</th>
                  {report.design === "randomised comparison" && <th>Group</th>}
                  <th className="num">Before</th>
                  <th className="num">After</th>
                  <th className="num">Change</th>
                  <th className="num">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {report.learners.map((l) => (
                  <tr key={l.code}>
                    <td>{l.displayName}</td>
                    {report.design === "randomised comparison" && <td>{l.arm === "tutor" ? "Tutor" : "Waits"}</td>}
                    <td className="num">{l.baseline === null ? "–" : `${Math.round(l.baseline)}%`}</td>
                    <td className="num">{l.endline === null ? "–" : `${Math.round(l.endline)}%`}</td>
                    <td className="num">{l.gain === null ? "–" : signed(l.gain)}</td>
                    <td className="num">{l.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detail.status === "closed" && (
            <p className="no-print" style={{ marginBottom: 0 }}>
              <button
                className="btn ghost small"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this pilot and every answer in it? This cannot be undone.")) void act(() => call(token, `/orgs/pilots/${detail.id}`, { method: "DELETE" }));
                }}
              >
                Delete this pilot
              </button>
            </p>
          )}
        </section>
      )}
      <p className="footlinks no-print"><a href="/school">Back to the school portal</a></p>
    </main>
  );
}

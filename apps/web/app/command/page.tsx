"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Chart from "./Chart";

const API = process.env.NEXT_PUBLIC_API_URL!;

/**
 * The Command Centre.
 *
 * Everything here is drawn from what the server says this account may do. The
 * tab strip is built from the capability list the API hands back, so a role
 * never sees a door it cannot open, and the server refuses the request anyway
 * if anyone tries the URL directly.
 */

type Capability =
  | "metrics:read" | "finance:aggregate" | "finance:detail"
  | "people:read" | "people:write" | "safety:read"
  | "staff:read" | "staff:write" | "config:write" | "audit:read";

interface Me {
  userId: string;
  email: string;
  role: string;
  title: string | null;
  capabilities: Capability[];
}

interface Metrics {
  learners: number;
  guardians: number;
  sessions: number;
  sessionsToday: number;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  messages: number;
  voiceTurns: number;
  practiceAttempts: number;
  safetyIncidents: number;
  safetyDanger: number;
  paidSubscriptions: number;
  planMix: Array<{ plan: string; count: number }>;
  sessionsSeries: Array<{ day: string; count: number }>;
  signupsSeries: Array<{ day: string; count: number }>;
}

interface Finance {
  currency: string;
  pricesConfigured: boolean;
  mrr: number | null;
  arr: number | null;
  activeSubscriptions: number;
  freeAccounts: number;
  lines: Array<{ plan: string; subscribers: number; monthlyPrice: number | null; monthlyRevenue: number | null }>;
  trouble: {
    week: { failed: number; refunded: number };
    month: { failed: number; refunded: number };
  };
  subscriptions?: Array<{ userId: string; email: string; provider: string; plan: string; status: string; subscriptionRef: string; updatedAt: string }>;
  events?: Array<{
    id: string;
    provider: string;
    type: string;
    email?: string;
    plan?: string;
    amountMinor?: number;
    currency?: string;
    matched: boolean;
    subscriptionRef?: string;
    customerRef?: string;
    createdAt: string;
  }>;
}

const EVENT_WORDS: Record<string, string> = {
  activated: "started paying",
  canceled: "canceled",
  payment_failed: "payment failed",
  refunded: "refunded",
};

function minor(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || !currency) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toLocaleString()}`;
  }
}

interface AccountHit {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  plan: string;
  students: number;
  createdAt: string;
}

interface PersonView {
  account: AccountHit;
  subscription: { provider: string; plan: string; status: string; subscriptionRef: string } | null;
  emailVerified: boolean;
  learners: Array<{
    id: string;
    displayName: string;
    streakDays: number;
    recentSessions: Array<{ startedAt: string; endedAt: string | null; summary: string | null }>;
    incidents?: Array<{ direction: string; categories: string[]; severity: string; excerpt: string; createdAt: string }>;
  }>;
}

interface StaffRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  title: string | null;
  status: "active" | "suspended";
  createdAt: string;
  lastSeenAt: string | null;
  fullName: string | null;
  employmentType: EmploymentType | null;
  startDate: string | null;
  endDate: string | null;
  managerUserId: string | null;
  location: string | null;
  notes: string | null;
}

type EmploymentType = "employee" | "contractor" | "advisor" | "investor";

const EMPLOYMENT_TYPES: EmploymentType[] = ["employee", "contractor", "advisor", "investor"];

/** Whole months between a start date and today, for the tenure line. */
function tenure(startDate: string | null): string {
  if (!startDate) return "";
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return "";
  const months = Math.max(
    0,
    (new Date().getFullYear() - start.getFullYear()) * 12 + (new Date().getMonth() - start.getMonth()),
  );
  if (months < 1) return "started this month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}y ${rest}m` : `${years} year${years === 1 ? "" : "s"}`;
}

interface AuditRow {
  id: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  target?: string;
  meta: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

interface Incident {
  id: string;
  studentId: string;
  studentName: string;
  guardianEmail: string | null;
  direction: string;
  categories: string[];
  severity: string;
  excerpt: string;
  createdAt: string;
}

interface SafetyView {
  severity: string | null;
  today: { concern: number; danger: number };
  week: { concern: number; danger: number };
  incidents: Incident[];
}

interface Controls {
  signupsPaused: boolean;
  signupsPausedReason: string;
  notice: string;
  noticeLevel: "info" | "warn";
}

interface OpsView {
  uptimeSeconds: number;
  memory: { rssMb: number; heapUsedMb: number };
  eventLoop: { lagP50Ms: number; lagMaxMs: number };
  routes: Array<{ route: string; count: number; errors: number; avgMs: number; p95Ms: number | null }>;
  recentErrors: Array<{ at: string; route: string; method: string; statusCode: number; message: string }>;
  aiQueue: {
    running: number;
    queued: number;
    maxConcurrent: number;
    maxQueue: number;
    served: number;
    rejected: number;
    timedOut: number;
    peakQueued: number;
    avgWaitMs: number;
    longestWaitMs: number;
  } | null;
}

type Tab = "overview" | "safety" | "money" | "people" | "team" | "controls" | "ops" | "trail";

const TABS: Array<{ id: Tab; label: string; needs: Capability }> = [
  { id: "overview", label: "Overview", needs: "metrics:read" },
  { id: "safety", label: "Safety", needs: "safety:read" },
  { id: "money", label: "Money", needs: "finance:aggregate" },
  { id: "people", label: "People", needs: "people:read" },
  { id: "team", label: "Team", needs: "staff:read" },
  { id: "controls", label: "Controls", needs: "config:write" },
  { id: "ops", label: "Ops", needs: "config:write" },
  { id: "trail", label: "Trail", needs: "audit:read" },
];

const ROLE_NOTES: Record<string, string> = {
  owner: "Full control of the platform.",
  admin: "Everything except changing who is on the team.",
  finance: "Revenue, subscriptions and the audit trail.",
  support: "The support desk: find a family, read their history, fix their plan.",
  staff: "Aggregate metrics only.",
  investor: "Aggregate metrics and revenue totals. Never a learner's details.",
};

const RANGES = [7, 30, 90] as const;

function num(n: number) {
  return n.toLocaleString();
}

function when(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export default function CommandCentre() {
  const [token, setToken] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    setToken(localStorage.getItem("tutor_token"));
    setBooted(true);
  }, []);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
      return body;
    },
    [token],
  );

  useEffect(() => {
    if (!token) return;
    let live = true;
    (async () => {
      try {
        const who = (await call("/command/me")) as Me;
        if (!live) return;
        setMe(who);
        setGateError(null);
        const first = TABS.find((t) => who.capabilities.includes(t.needs));
        if (first) setTab(first.id);
      } catch (err) {
        if (live) setGateError((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [token, call]);

  const allowed = useMemo(() => TABS.filter((t) => me?.capabilities.includes(t.needs)), [me]);

  if (!booted) return null;

  if (!token || gateError) {
    return <Gate error={gateError} onToken={(t) => { setToken(t); setGateError(null); }} />;
  }

  if (!me) {
    return (
      <div className="cc">
        <div className="cc-body">
          <p className="cc-empty">Opening the console.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cc">
      <header className="cc-bar">
        <a className="cc-mark" href="/command">
          Dingba<span>.</span>
          <small>Command Centre</small>
        </a>
        <nav className="cc-tabs">
          {allowed.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="cc-who">
          <span className="who-email">{me.email}</span>
          <span className={`cc-role ${me.role}`}>{me.role}</span>
        </div>
      </header>

      <div className="cc-body">
        {allowed.length === 0 && (
          <p className="cc-empty">This role has no console sections yet. Ask an owner to widen it.</p>
        )}
        {tab === "overview" && <Overview call={call} token={token} />}
        {tab === "safety" && <Safety call={call} token={token} />}
        {tab === "money" && <Money call={call} me={me} token={token} />}
        {tab === "people" && <People call={call} me={me} />}
        {tab === "team" && <Team call={call} me={me} token={token} />}
        {tab === "controls" && <ControlsPanel call={call} />}
        {tab === "ops" && <Ops call={call} />}
        {tab === "trail" && <Trail call={call} token={token} />}
      </div>
    </div>
  );
}

type Call = (path: string, init?: RequestInit) => Promise<unknown>;

/**
 * Downloads a CSV. A plain link cannot carry the bearer token, so the file is
 * fetched, turned into a blob, and handed to the browser as a save.
 */
function Download({ token, dataset, query = "", label }: { token: string; dataset: string; query?: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function go() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`${API}/command/export/${dataset}.csv${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+?)"/)?.[1] ?? `${dataset}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn quiet small" onClick={go} disabled={busy}>
      {busy ? "Preparing" : failed ? "That did not download, try again" : label}
    </button>
  );
}

/* ---------- sign in ---------- */

function Gate({ error, onToken }: { error: string | null; onToken: (t: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? "that did not work");
      localStorage.setItem("tutor_token", body.token);
      onToken(body.token);
    } catch (err) {
      setFailed((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cc-gate">
      <h1>Command Centre</h1>
      <p>Sign in with the account that holds your console role.</p>
      {error && <div className="err">{error}</div>}
      {failed && <div className="err">{failed}</div>}
      <form onSubmit={submit}>
        <label className="lbl" htmlFor="cc-email">Email</label>
        <input id="cc-email" className="inp" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="lbl" htmlFor="cc-pass">Password</label>
        <input id="cc-pass" className="inp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div style={{ height: 18 }} />
        <button className="btn big" disabled={busy}>{busy ? "Checking" : "Sign in"}</button>
      </form>
    </div>
  );
}

/* ---------- overview ---------- */

function Overview({ call, token }: { call: Call; token: string }) {
  const [days, setDays] = useState<number>(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call(`/command/metrics?days=${days}`)
      .then((b) => live && setMetrics((b as { metrics: Metrics }).metrics))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [call, days]);

  if (error) return <div className="err">{error}</div>;
  if (!metrics) return <p className="cc-empty">Counting.</p>;

  const engaged = metrics.learners > 0 ? Math.round((metrics.activeThisMonth / metrics.learners) * 100) : 0;

  return (
    <>
      <div className="cc-h">
        <h2>Overview</h2>
        <div className="cc-rowacts">
          <span className="cc-tabs">
            {RANGES.map((r) => (
              <button key={r} className={days === r ? "on" : ""} onClick={() => setDays(r)}>
                {r} days
              </button>
            ))}
          </span>
          <Download token={token} dataset="metrics" query={`?days=${days}`} label="Download these days" />
        </div>
      </div>
      <p className="cc-lede">Everything happening on the platform, counted, with nobody named.</p>

      <div className="cc-stats">
        <Stat k="Learners" v={num(metrics.learners)} n={`${num(metrics.guardians)} guardian accounts`} />
        <Stat k="Active this month" v={num(metrics.activeThisMonth)} n={`${engaged}% of all learners`} />
        <Stat k="Active this week" v={num(metrics.activeThisWeek)} n={`${num(metrics.activeToday)} today`} />
        <Stat k="Sessions" v={num(metrics.sessions)} n={`${num(metrics.sessionsToday)} started today`} />
        <Stat k="Messages" v={num(metrics.messages)} n={`${num(metrics.voiceTurns)} spoken turns`} />
        <Stat k="Practice answers" v={num(metrics.practiceAttempts)} n="checked by the maths verifier" />
        <Stat k="Paid subscriptions" v={num(metrics.paidSubscriptions)} n="active right now" />
        <Stat
          k="Safety flags"
          v={num(metrics.safetyIncidents)}
          n={`${num(metrics.safetyDanger)} needed a guardian alert`}
          alert={metrics.safetyDanger > 0}
        />
      </div>

      <div className="cc-panel">
        <h3>Sessions a day</h3>
        <p>How much teaching is actually happening.</p>
        <Chart series={metrics.sessionsSeries} label="Sessions a day" />
      </div>

      <div className="cc-panel">
        <h3>New accounts a day</h3>
        <p>Who is arriving.</p>
        <Chart series={metrics.signupsSeries} label="New accounts a day" />
      </div>

      <div className="cc-panel">
        <h3>Plan mix</h3>
        <p>Where every account sits today.</p>
        <PlanBars mix={metrics.planMix} />
      </div>
    </>
  );
}

function Stat({ k, v, n, alert }: { k: string; v: string; n?: string; alert?: boolean }) {
  return (
    <div className={`cc-stat${alert ? " alert" : ""}`}>
      <p className="k">{k}</p>
      <div className="v">{v}</div>
      {n && <p className="n">{n}</p>}
    </div>
  );
}

function PlanBars({ mix }: { mix: Array<{ plan: string; count: number }> }) {
  const total = mix.reduce((n, m) => n + m.count, 0);
  if (total === 0) return <p className="cc-empty">No accounts yet.</p>;
  return (
    <div className="cc-bars">
      {mix.map((m) => (
        <div className="cc-bar-row" key={m.plan}>
          <span style={{ textTransform: "capitalize", fontWeight: 700 }}>{m.plan}</span>
          <span className="cc-bar-track">
            <span className="cc-bar-fill" style={{ width: `${Math.round((m.count / total) * 100)}%` }} />
          </span>
          <span className="num">{num(m.count)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- safety ---------- */

function Safety({ call, token }: { call: Call; token: string }) {
  const [severity, setSeverity] = useState<"" | "danger" | "concern">("");
  const [data, setData] = useState<SafetyView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (sev: string) => {
      setError(null);
      try {
        const q = sev ? `?severity=${sev}` : "";
        setData((await call(`/command/safety${q}`)) as SafetyView);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [call],
  );

  useEffect(() => {
    load(severity);
  }, [load, severity]);

  return (
    <>
      <div className="cc-h">
        <h2>Safety</h2>
        <div className="cc-rowacts">
          <span className="cc-tabs">
            {([["", "Everything"], ["danger", "Danger"], ["concern", "Concern"]] as const).map(([v, label]) => (
              <button key={v} className={severity === v ? "on" : ""} onClick={() => setSeverity(v)}>
                {label}
              </button>
            ))}
          </span>
          <Download
            token={token}
            dataset="safety"
            query={severity ? `?severity=${severity}` : ""}
            label="Download this view"
          />
        </div>
      </div>
      <p className="cc-lede">
        Every flag raised on the platform, newest first, so nobody has to know which family to look for. Opening
        this page is written to the trail.
      </p>

      {error && <div className="err">{error}</div>}

      {data && (
        <>
          <div className="cc-stats">
            <Stat k="Danger, last 24h" v={num(data.today.danger)} n="guardians were emailed" alert={data.today.danger > 0} />
            <Stat k="Concern, last 24h" v={num(data.today.concern)} n="redirected in the moment" />
            <Stat k="Danger, last 7 days" v={num(data.week.danger)} alert={data.week.danger > 0} />
            <Stat k="Concern, last 7 days" v={num(data.week.concern)} />
          </div>

          <div className="cc-panel">
            <h3>{data.incidents.length === 0 ? "Nothing flagged" : `${data.incidents.length} flagged`}</h3>
            <p>Tutor-side flags mean the model produced something it should not have. Those are our bug, not the learner's.</p>
            {data.incidents.length > 0 ? (
              <div className="cc-table-wrap">
                <table className="cc-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Severity</th>
                      <th>Learner</th>
                      <th>Reach</th>
                      <th>From</th>
                      <th>Categories</th>
                      <th>What was said</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.incidents.map((i) => (
                      <tr key={i.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{when(i.createdAt)}</td>
                        <td>
                          <span className={`cc-tag ${i.severity === "danger" ? "bad" : "warn"}`}>{i.severity}</span>
                        </td>
                        <td>{i.studentName}</td>
                        <td>
                          {i.guardianEmail ? (
                            <a href={`mailto:${i.guardianEmail}`}>{i.guardianEmail}</a>
                          ) : (
                            <span className="cc-tag">no account</span>
                          )}
                        </td>
                        <td>{i.direction === "tutor" ? <span className="cc-tag bad">tutor</span> : "learner"}</td>
                        <td>{i.categories.join(", ")}</td>
                        <td>{i.excerpt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="cc-empty">Nothing has been flagged in this view.</p>
            )}
          </div>
        </>
      )}
      {!data && !error && <p className="cc-empty">Checking.</p>}
    </>
  );
}

/* ---------- money ---------- */

function Money({ call, me, token }: { call: Call; me: Me; token: string }) {
  const [data, setData] = useState<Finance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call("/command/finance")
      .then((b) => live && setData(b as Finance))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [call]);

  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="cc-empty">Adding it up.</p>;

  const detail = me.capabilities.includes("finance:detail");

  return (
    <>
      <div className="cc-h">
        <h2>Money</h2>
        <div className="cc-rowacts">
          <Download token={token} dataset="finance" label="Download the plan mix" />
          {detail && <Download token={token} dataset="subscriptions" label="Download subscriptions" />}
          {detail && <Download token={token} dataset="payments" label="Download the money ledger" />}
        </div>
      </div>
      <p className="cc-lede">
        Revenue counted from live subscriptions.
        {detail ? " You can see who is paying." : " Totals only, no customer details."}
      </p>

      {!data.pricesConfigured && (
        <div className="cc-note">
          Plan prices are not set, so revenue is left blank rather than guessed. Set PRICE_PLUS_MONTHLY and
          PRICE_PREMIUM_MONTHLY on the api service and this fills in.
        </div>
      )}

      <div className="cc-stats">
        <Stat k="Monthly revenue" v={data.mrr === null ? "not set" : money(data.mrr, data.currency)} n="from active subscriptions" />
        <Stat k="Yearly run rate" v={data.arr === null ? "not set" : money(data.arr, data.currency)} n="monthly revenue, twelve times" />
        <Stat k="Paying accounts" v={num(data.activeSubscriptions)} n={`${num(data.freeAccounts)} on free`} />
        <Stat
          k="Failed payments, 7 days"
          v={num(data.trouble.week.failed)}
          n={`${num(data.trouble.month.failed)} in 30 days`}
          alert={data.trouble.week.failed > 0}
        />
        <Stat
          k="Refunds, 7 days"
          v={num(data.trouble.week.refunded)}
          n={`${num(data.trouble.month.refunded)} in 30 days`}
          alert={data.trouble.week.refunded > 0}
        />
      </div>

      <div className="cc-panel">
        <h3>By plan</h3>
        <p>What each tier brings in every month.</p>
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th className="num">Subscribers</th>
                <th className="num">Price</th>
                <th className="num">Monthly</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.plan}>
                  <td style={{ textTransform: "capitalize", fontWeight: 700 }}>{l.plan}</td>
                  <td className="num">{num(l.subscribers)}</td>
                  <td className="num">{l.monthlyPrice === null ? "not set" : money(l.monthlyPrice, data.currency)}</td>
                  <td className="num">{l.monthlyRevenue === null ? "not set" : money(l.monthlyRevenue, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="cc-panel">
          <h3>The money ledger</h3>
          <p>
            Every verified event the processor sent, newest first. A row marked unmatched is money that moved
            for an account we could not find, which deserves a look the same day.
          </p>
          {data.events && data.events.length > 0 ? (
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Account</th>
                    <th>Amount</th>
                    <th>Processor</th>
                    <th>Matched</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{when(e.createdAt)}</td>
                      <td>
                        <span className={`cc-tag ${e.type === "activated" ? "ok" : e.type === "canceled" ? "" : "bad"}`}>
                          {EVENT_WORDS[e.type] ?? e.type}
                        </span>
                        {e.plan && <span style={{ marginLeft: 6, textTransform: "capitalize" }}>{e.plan}</span>}
                      </td>
                      <td>{e.email ?? <span className="mono">{e.customerRef ?? e.subscriptionRef ?? ""}</span>}</td>
                      <td className="num">{minor(e.amountMinor, e.currency)}</td>
                      <td className="mono">{e.provider}</td>
                      <td>{e.matched ? <span className="cc-tag ok">yes</span> : <span className="cc-tag bad">NO</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="cc-empty">No processor events recorded yet.</p>
          )}
        </div>
      )}

      {detail && (
        <div className="cc-panel">
          <h3>Recent subscriptions</h3>
          <p>The fifty most recently changed.</p>
          {data.subscriptions && data.subscriptions.length > 0 ? (
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Processor</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscriptions.map((s) => (
                    <tr key={s.subscriptionRef}>
                      <td>{s.email}</td>
                      <td style={{ textTransform: "capitalize" }}>{s.plan}</td>
                      <td>
                        <span className={`cc-tag ${s.status === "active" ? "ok" : "bad"}`}>{s.status}</span>
                      </td>
                      <td className="mono">{s.provider}</td>
                      <td>{when(s.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="cc-empty">No subscriptions recorded yet.</p>
          )}
        </div>
      )}
    </>
  );
}

/* ---------- people ---------- */

function People({ call, me }: { call: Call; me: Me }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccountHit[] | null>(null);
  const [person, setPerson] = useState<PersonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canWrite = me.capabilities.includes("people:write");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setPerson(null);
    try {
      const b = (await call(`/command/people?q=${encodeURIComponent(query)}`)) as { results: AccountHit[] };
      setResults(b.results);
    } catch (err) {
      setError((err as Error).message);
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  async function open(userId: string) {
    setError(null);
    try {
      setPerson((await call(`/command/people/${userId}`)) as PersonView);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function changePlan(userId: string, plan: string) {
    setError(null);
    try {
      await call(`/command/people/${userId}/plan`, { method: "POST", body: JSON.stringify({ plan }) });
      await open(userId);
      setResults((rows) => rows?.map((r) => (r.userId === userId ? { ...r, plan } : r)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="cc-h">
        <h2>People</h2>
      </div>
      <p className="cc-lede">
        The support desk. Search by email or name. Every search is written to the trail, because looking up a
        family is itself a privileged act.
      </p>

      <form className="cc-search" onSubmit={search}>
        <input
          className="inp"
          placeholder="Email or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search accounts"
        />
        <button className="btn" disabled={busy || query.trim().length < 2}>
          {busy ? "Looking" : "Search"}
        </button>
      </form>

      {error && <div className="err">{error}</div>}

      {results && !person && (
        <div className="cc-panel">
          <h3>{results.length === 0 ? "Nothing matched" : `${results.length} match${results.length === 1 ? "" : "es"}`}</h3>
          <p>Open an account to see its learners.</p>
          {results.length > 0 && (
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Plan</th>
                    <th className="num">Learners</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.userId} className="click" onClick={() => open(r.userId)}>
                      <td>{r.email}</td>
                      <td>{r.displayName ?? "not set"}</td>
                      <td>{r.role}</td>
                      <td style={{ textTransform: "capitalize" }}>{r.plan}</td>
                      <td className="num">{r.students}</td>
                      <td>{when(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {person && (
        <>
          <div className="cc-panel">
            <div className="cc-h">
              <h3>{person.account.email}</h3>
              <button className="btn quiet small" onClick={() => setPerson(null)}>Back to results</button>
            </div>
            <p>
              {person.account.displayName ?? "No name set"}, joined {when(person.account.createdAt)}.{" "}
              {person.emailVerified ? "Email verified." : "Email not verified yet."}
            </p>
            <div className="cc-stats">
              <Stat k="Plan" v={person.account.plan} n={person.subscription ? `${person.subscription.provider}, ${person.subscription.status}` : "no subscription on file"} />
              <Stat k="Learners" v={num(person.learners.length)} />
            </div>
            {canWrite && (
              <>
                <label className="lbl">Move this account to a different plan</label>
                <div className="cc-rowacts">
                  {["free", "plus", "premium"].map((p) => (
                    <button
                      key={p}
                      className={`btn small ${person.account.plan === p ? "" : "quiet"}`}
                      disabled={person.account.plan === p}
                      onClick={() => changePlan(person.account.userId, p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {person.learners.map((l) => (
            <div className="cc-panel" key={l.id}>
              <h3>{l.displayName}</h3>
              <p>
                {l.streakDays > 0 ? `${l.streakDays} day streak.` : "No streak running."} Last {l.recentSessions.length}{" "}
                session{l.recentSessions.length === 1 ? "" : "s"} shown.
              </p>
              {l.recentSessions.length > 0 ? (
                <div className="cc-table-wrap">
                  <table className="cc-table">
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Recap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.recentSessions.map((s, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: "nowrap" }}>{when(s.startedAt)}</td>
                          <td>{s.summary ?? "Session did not end with a recap."}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="cc-empty">No sessions yet.</p>
              )}

              {l.incidents && l.incidents.length > 0 && (
                <>
                  <label className="lbl">Safety flags</label>
                  <div className="cc-table-wrap">
                    <table className="cc-table">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Severity</th>
                          <th>Categories</th>
                          <th>Excerpt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.incidents.map((inc, i) => (
                          <tr key={i}>
                            <td style={{ whiteSpace: "nowrap" }}>{when(inc.createdAt)}</td>
                            <td>
                              <span className={`cc-tag ${inc.severity === "danger" ? "bad" : "warn"}`}>{inc.severity}</span>
                            </td>
                            <td>{inc.categories.join(", ")}</td>
                            <td>{inc.excerpt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ---------- team ---------- */

function Team({ call, me, token }: { call: Call; me: Me; token: string }) {
  const [roles, setRoles] = useState<string[]>([]);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const canWrite = me.capabilities.includes("staff:write");

  const load = useCallback(async () => {
    try {
      const b = (await call("/command/staff")) as { roles: string[]; staff: StaffRow[] };
      setRoles(b.roles);
      setStaff(b.staff);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("/command/staff", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role, title: title.trim() || undefined }),
      });
      setEmail("");
      setTitle("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(row: StaffRow, status: "active" | "suspended") {
    setError(null);
    try {
      await call("/command/staff", {
        method: "POST",
        body: JSON.stringify({ email: row.email, role: row.role, title: row.title ?? undefined, status }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(row: StaffRow) {
    setError(null);
    try {
      await call(`/command/staff/${row.userId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="cc-h">
        <h2>Team</h2>
        <Download token={token} dataset="staff" label="Download the roster" />
      </div>
      <p className="cc-lede">
        Who holds which keys. Investors sit here too, on a role that can only ever reach counts and revenue
        totals, never a learner.
      </p>

      {error && <div className="err">{error}</div>}

      {canWrite && (
        <div className="cc-panel">
          <h3>Add someone, or change their role</h3>
          <p>They need a Dingba account with this email first. Adding an existing member updates them.</p>
          <form className="cc-form" onSubmit={add}>
            <div>
              <label className="lbl" htmlFor="staff-email">Email</label>
              <input id="staff-email" className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="lbl" htmlFor="staff-role">Role</label>
              <select id="staff-role" className="inp" value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="lbl" htmlFor="staff-title">Title, optional</label>
              <input id="staff-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Head of Care" />
            </div>
            <button className="btn" disabled={busy}>{busy ? "Saving" : "Save"}</button>
          </form>
          <p className="cc-lede" style={{ margin: "14px 0 0" }}>{ROLE_NOTES[role]}</p>
        </div>
      )}

      <div className="cc-panel">
        <h3>The roster</h3>
        <p>{staff ? `${staff.length} ${staff.length === 1 ? "person" : "people"} with console access.` : "Loading."}</p>
        {staff && staff.length > 0 && (
          <div className="cc-table-wrap">
            <table className="cc-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Title</th>
                  <th>Engaged</th>
                  <th>Status</th>
                  <th>Last seen</th>
                  {canWrite && <th />}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.userId}>
                    <td>
                      <b>{s.fullName || s.displayName || "not recorded"}</b>
                      {s.startDate && <><br /><span className="cc-tag">{tenure(s.startDate)}</span></>}
                    </td>
                    <td>{s.email}</td>
                    <td><span className={`cc-role ${s.role}`}>{s.role}</span></td>
                    <td>{s.title ?? ""}</td>
                    <td>{s.employmentType ?? <span className="cc-tag">not recorded</span>}</td>
                    <td>
                      <span className={`cc-tag ${s.status === "active" ? "ok" : "bad"}`}>{s.status}</span>
                    </td>
                    <td>{s.lastSeenAt ? when(s.lastSeenAt) : "never"}</td>
                    {canWrite && (
                      <td>
                        <span className="cc-rowacts">
                          <button
                            className="btn quiet small"
                            onClick={() => setEditing(editing === s.userId ? null : s.userId)}
                          >
                            {editing === s.userId ? "Close" : "Details"}
                          </button>
                          {s.userId === me.userId ? (
                            <span className="cc-tag">you</span>
                          ) : (
                            <>
                              {s.status === "active" ? (
                                <button className="btn quiet small" onClick={() => setStatus(s, "suspended")}>Suspend</button>
                              ) : (
                                <button className="btn quiet small" onClick={() => setStatus(s, "active")}>Restore</button>
                              )}
                              <button className="btn danger small" onClick={() => remove(s)}>Remove</button>
                            </>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canWrite && editing && staff && (
        <EmploymentRecord
          key={editing}
          call={call}
          person={staff.find((s) => s.userId === editing)!}
          roster={staff}
          onSaved={async () => {
            await load();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {staff && staff.some((s) => s.managerUserId) && (
        <div className="cc-panel">
          <h3>Who reports to whom</h3>
          <p>Built from the reporting lines on each record.</p>
          <OrgChart roster={staff} />
        </div>
      )}

      <div className="cc-panel">
        <h3>What each role can reach</h3>
        <p>Enforced by the server on every request, not by hiding buttons.</p>
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Reach</th>
              </tr>
            </thead>
            <tbody>
              {(roles.length ? roles : Object.keys(ROLE_NOTES)).map((r) => (
                <tr key={r}>
                  <td><span className={`cc-role ${r}`}>{r}</span></td>
                  <td>{ROLE_NOTES[r] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** The employment half of a record: who someone is and how they are engaged. */
function EmploymentRecord({
  call,
  person,
  roster,
  onSaved,
  onClose,
}: {
  call: Call;
  person: StaffRow;
  roster: StaffRow[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    fullName: person.fullName ?? "",
    employmentType: person.employmentType ?? "",
    startDate: person.startDate ?? "",
    endDate: person.endDate ?? "",
    managerUserId: person.managerUserId ?? "",
    location: person.location ?? "",
    notes: person.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Empty means "not recorded", which is null on the wire, not "".
      const blank = (v: string) => (v.trim() ? v.trim() : null);
      await call(`/command/staff/${person.userId}/hr`, {
        method: "PUT",
        body: JSON.stringify({
          fullName: blank(draft.fullName),
          employmentType: draft.employmentType ? draft.employmentType : null,
          startDate: blank(draft.startDate),
          endDate: blank(draft.endDate),
          managerUserId: blank(draft.managerUserId),
          location: blank(draft.location),
          notes: blank(draft.notes),
        }),
      });
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const others = roster.filter((r) => r.userId !== person.userId);

  return (
    <div className="cc-panel">
      <div className="cc-h">
        <h3>{person.fullName || person.displayName || person.email}</h3>
        <button className="btn quiet small" onClick={onClose}>Close</button>
      </div>
      <p>
        {person.email}
        {person.startDate ? `, ${tenure(person.startDate)} in` : ""}
        {person.endDate ? `, left ${person.endDate}` : ""}
      </p>

      {error && <div className="err">{error}</div>}
      {saved && !error && <div className="notice">Saved.</div>}

      <div className="cc-form">
        <div>
          <label className="lbl" htmlFor="hr-name">Legal name</label>
          <input
            id="hr-name"
            className="inp"
            value={draft.fullName}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
          />
        </div>
        <div>
          <label className="lbl" htmlFor="hr-type">Engaged as</label>
          <select
            id="hr-type"
            className="inp"
            value={draft.employmentType}
            onChange={(e) => setDraft({ ...draft, employmentType: e.target.value })}
          >
            <option value="">not recorded</option>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl" htmlFor="hr-where">Based in</label>
          <input
            id="hr-where"
            className="inp"
            value={draft.location}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })}
          />
        </div>
        <div />
        <div>
          <label className="lbl" htmlFor="hr-start">Started</label>
          <input id="hr-start" className="inp" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
        </div>
        <div>
          <label className="lbl" htmlFor="hr-end">Left</label>
          <input id="hr-end" className="inp" type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
        </div>
        <div>
          <label className="lbl" htmlFor="hr-manager">Reports to</label>
          <select
            id="hr-manager"
            className="inp"
            value={draft.managerUserId}
            onChange={(e) => setDraft({ ...draft, managerUserId: e.target.value })}
          >
            <option value="">nobody</option>
            {others.map((r) => (
              <option key={r.userId} value={r.userId}>{r.fullName || r.email}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving" : "Save record"}</button>
      </div>

      <label className="lbl" htmlFor="hr-notes">Notes</label>
      <textarea
        id="hr-notes"
        className="inp"
        rows={3}
        maxLength={2000}
        value={draft.notes}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        placeholder="Anything the next person in this seat would need to know."
      />
      <p className="cc-lede" style={{ margin: "8px 0 0" }}>
        The trail records that this record changed and which fields, never what the notes say.
      </p>
    </div>
  );
}

/** The reporting tree, drawn from the lines on each record. */
function OrgChart({ roster }: { roster: StaffRow[] }) {
  const byManager = new Map<string, StaffRow[]>();
  for (const person of roster) {
    const key = person.managerUserId ?? "";
    byManager.set(key, [...(byManager.get(key) ?? []), person]);
  }
  const label = (p: StaffRow) => p.fullName || p.displayName || p.email;

  // Depth is bounded by the roster size, and the API refuses loops, so this
  // cannot run away even if a record is edited straight in the database.
  function branch(managerId: string, depth: number): React.ReactElement | null {
    const reports = byManager.get(managerId) ?? [];
    if (reports.length === 0 || depth > roster.length) return null;
    return (
      <ul className="cc-tree">
        {reports.map((p) => (
          <li key={p.userId}>
            <span className="cc-tree-person">
              <b>{label(p)}</b>
              <span className={`cc-role ${p.role}`}>{p.role}</span>
              {p.title && <span className="cc-tag">{p.title}</span>}
              {p.endDate && <span className="cc-tag bad">left {p.endDate}</span>}
            </span>
            {branch(p.userId, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  return branch("", 0) ?? <p className="cc-empty">Everyone reports to somebody, which cannot be right.</p>;
}

/* ---------- controls ---------- */

function ControlsPanel({ call }: { call: Call }) {
  const [live, setLive] = useState<Controls | null>(null);
  const [draft, setDraft] = useState<Controls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    call("/command/controls")
      .then((b) => {
        if (!alive) return;
        const c = (b as { controls: Controls }).controls;
        setLive(c);
        setDraft(c);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [call]);

  async function save(patch: Partial<Controls>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const b = (await call("/command/controls", { method: "PUT", body: JSON.stringify(patch) })) as { controls: Controls };
      setLive(b.controls);
      setDraft(b.controls);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !live) return <div className="err">{error}</div>;
  if (!live || !draft) return <p className="cc-empty">Reading the switches.</p>;

  const noticeChanged = draft.notice !== live.notice || draft.noticeLevel !== live.noticeLevel;
  const reasonChanged = draft.signupsPausedReason !== live.signupsPausedReason;

  return (
    <>
      <div className="cc-h">
        <h2>Controls</h2>
      </div>
      <p className="cc-lede">
        Switches that take effect on the very next request, with no deploy. Every flip is written to the trail
        with what it was before and what it became.
      </p>

      {error && <div className="err">{error}</div>}
      {saved && !error && <div className="notice">Saved. It is live now.</div>}

      <div className="cc-panel">
        <h3>New signups</h3>
        <p>
          {live.signupsPaused
            ? "Registration is closed. Anyone trying to join is turned away with the reason below."
            : "Registration is open. Anyone can create an account."}
        </p>
        <div className="cc-rowacts">
          <button
            className={`btn ${live.signupsPaused ? "quiet" : ""}`}
            disabled={busy || !live.signupsPaused}
            onClick={() => save({ signupsPaused: false })}
          >
            Open
          </button>
          <button
            className={`btn ${live.signupsPaused ? "" : "quiet"}`}
            disabled={busy || live.signupsPaused}
            onClick={() => save({ signupsPaused: true })}
          >
            Pause
          </button>
        </div>
        <label className="lbl" htmlFor="pause-reason">What people are told while it is paused</label>
        <input
          id="pause-reason"
          className="inp"
          value={draft.signupsPausedReason}
          maxLength={280}
          onChange={(e) => setDraft({ ...draft, signupsPausedReason: e.target.value })}
        />
        <div style={{ height: 12 }} />
        <button
          className="btn small"
          disabled={busy || !reasonChanged || draft.signupsPausedReason.trim().length === 0}
          onClick={() => save({ signupsPausedReason: draft.signupsPausedReason })}
        >
          Save the wording
        </button>
      </div>

      <div className="cc-panel">
        <h3>Platform notice</h3>
        <p>One line shown to everyone in the app. Leave it empty for no notice.</p>
        <input
          className="inp"
          value={draft.notice}
          maxLength={280}
          placeholder="Voice lessons are slow this evening while we upgrade a server."
          onChange={(e) => setDraft({ ...draft, notice: e.target.value })}
          aria-label="Platform notice"
        />
        <label className="lbl">How it reads</label>
        <div className="cc-rowacts">
          {(["info", "warn"] as const).map((l) => (
            <button
              key={l}
              className={`btn small ${draft.noticeLevel === l ? "" : "quiet"}`}
              onClick={() => setDraft({ ...draft, noticeLevel: l })}
            >
              {l === "info" ? "Ordinary" : "Needs attention"}
            </button>
          ))}
        </div>
        <div style={{ height: 14 }} />
        <div className="cc-rowacts">
          <button
            className="btn"
            disabled={busy || !noticeChanged}
            onClick={() => save({ notice: draft.notice, noticeLevel: draft.noticeLevel })}
          >
            {live.notice ? "Update the notice" : "Show this notice"}
          </button>
          {live.notice && (
            <button className="btn quiet" disabled={busy} onClick={() => save({ notice: "" })}>
              Clear it
            </button>
          )}
        </div>
        {live.notice && (
          <>
            <label className="lbl">Live right now</label>
            <div className={live.noticeLevel === "warn" ? "cc-note" : "notice"}>{live.notice}</div>
          </>
        )}
      </div>
    </>
  );
}

/* ---------- ops ---------- */

function uptimeWords(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Ops({ call }: { call: Call }) {
  const [data, setData] = useState<OpsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData((await call("/command/ops")) as OpsView);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [call]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="cc-empty">Taking the pulse.</p>;

  const totalErrors = data.routes.reduce((n, r) => n + r.errors, 0);

  return (
    <>
      <div className="cc-h">
        <h2>Ops</h2>
        <button className="btn quiet small" onClick={load}>Refresh</button>
      </div>
      <p className="cc-lede">The platform's pulse, refreshed every fifteen seconds. Slow is the new down.</p>

      <div className="cc-stats">
        <Stat k="Up for" v={uptimeWords(data.uptimeSeconds)} n="this api process" />
        <Stat k="Memory" v={`${data.memory.rssMb} MB`} n={`${data.memory.heapUsedMb} MB heap in use`} />
        <Stat
          k="Event loop lag"
          v={`${data.eventLoop.lagMaxMs} ms`}
          n={`worst of the last minute, typical ${data.eventLoop.lagP50Ms} ms`}
          alert={data.eventLoop.lagMaxMs > 200}
        />
        <Stat k="Failures since start" v={num(totalErrors)} n="responses with a 5xx status" alert={totalErrors > 0} />
      </div>

      {data.aiQueue && (
        <div className="cc-panel">
          <h3>The line at the AI brain</h3>
          <p>
            The model box takes {data.aiQueue.maxConcurrent} conversations at once; up to {data.aiQueue.maxQueue} wait
            in line behind them, and past that learners are asked to retry. Rejections here mean it is time for a
            bigger box or a second one.
          </p>
          <div className="cc-stats">
            <Stat k="Talking now" v={num(data.aiQueue.running)} n={`of ${data.aiQueue.maxConcurrent} slots`} />
            <Stat
              k="Waiting in line"
              v={num(data.aiQueue.queued)}
              n={`worst so far ${data.aiQueue.peakQueued}`}
              alert={data.aiQueue.queued >= data.aiQueue.maxQueue / 2}
            />
            <Stat
              k="Typical wait"
              v={`${data.aiQueue.avgWaitMs} ms`}
              n={`longest ${data.aiQueue.longestWaitMs} ms`}
              alert={data.aiQueue.avgWaitMs > 5000}
            />
            <Stat
              k="Turned away"
              v={num(data.aiQueue.rejected + data.aiQueue.timedOut)}
              n={`${num(data.aiQueue.served)} served since start`}
              alert={data.aiQueue.rejected + data.aiQueue.timedOut > 0}
            />
          </div>
        </div>
      )}

      <div className="cc-panel">
        <h3>Routes by traffic</h3>
        <p>Latency is per route pattern, so one busy session cannot hide behind another.</p>
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Route</th>
                <th className="num">Requests</th>
                <th className="num">Failures</th>
                <th className="num">Avg</th>
                <th className="num">p95</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.slice(0, 20).map((r) => (
                <tr key={r.route}>
                  <td className="mono">{r.route}</td>
                  <td className="num">{num(r.count)}</td>
                  <td className="num">{r.errors > 0 ? <span className="cc-tag bad">{r.errors}</span> : "0"}</td>
                  <td className="num">{r.avgMs} ms</td>
                  <td className="num">{r.p95Ms === null ? "" : r.p95Ms === Infinity ? "over 10 s" : `${r.p95Ms} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cc-panel">
        <h3>Recent failures</h3>
        <p>The last fifty, newest first. Messages only, never anyone's words.</p>
        {data.recentErrors.length > 0 ? (
          <div className="cc-table-wrap">
            <table className="cc-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Route</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {data.recentErrors.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{when(e.at)}</td>
                    <td className="mono">{e.method} {e.route}</td>
                    <td><span className="cc-tag bad">{e.statusCode}</span></td>
                    <td className="mono">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cc-empty">Nothing has failed since this process started.</p>
        )}
      </div>

      <div className="cc-panel">
        <h3>Wiring it to Grafana</h3>
        <p>
          The same numbers stream as Prometheus text from /admin/metrics on the api service, with your admin key
          as a bearer token. Point any Prometheus or Grafana agent at it and nothing else needs installing.
        </p>
      </div>
    </>
  );
}

/* ---------- trail ---------- */

function Trail({ call, token }: { call: Call; token: string }) {
  const [entries, setEntries] = useState<AuditRow[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (action: string) => {
      setError(null);
      try {
        const q = action ? `?action=${encodeURIComponent(action)}` : "";
        const b = (await call(`/command/audit${q}`)) as { entries: AuditRow[] };
        setEntries(b.entries);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [call],
  );

  useEffect(() => {
    load("");
  }, [load]);

  const actions = useMemo(() => [...new Set((entries ?? []).map((e) => e.action))].sort(), [entries]);

  return (
    <>
      <div className="cc-h">
        <h2>Trail</h2>
        <Download token={token} dataset="audit" label="Download the trail" />
      </div>
      <p className="cc-lede">
        Every privileged action, permanently. Nothing in the console can delete from this, because an audit log
        you can edit is not an audit log.
      </p>

      {error && <div className="err">{error}</div>}

      <div className="cc-search">
        <select
          className="inp"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            load(e.target.value);
          }}
          aria-label="Filter by action"
        >
          <option value="">Every action</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <button className="btn quiet" onClick={() => load(filter)}>Refresh</button>
      </div>

      <div className="cc-panel">
        {entries && entries.length > 0 ? (
          <div className="cc-table-wrap">
            <table className="cc-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Did what</th>
                  <th>Details</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{when(e.createdAt)}</td>
                    <td>
                      {e.actorEmail}
                      <br />
                      <span className="cc-tag">{e.actorRole}</span>
                    </td>
                    <td className="mono">{e.action}</td>
                    <td className="mono">{Object.keys(e.meta).length ? JSON.stringify(e.meta) : ""}</td>
                    <td className="mono">{e.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cc-empty">{entries ? "Nothing recorded under that filter yet." : "Reading the trail."}</p>
        )}
      </div>
    </>
  );
}

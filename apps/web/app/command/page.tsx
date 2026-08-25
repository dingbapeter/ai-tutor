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
  subscriptions?: Array<{ userId: string; email: string; provider: string; plan: string; status: string; subscriptionRef: string; updatedAt: string }>;
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

type Tab = "overview" | "money" | "people" | "team" | "trail";

const TABS: Array<{ id: Tab; label: string; needs: Capability }> = [
  { id: "overview", label: "Overview", needs: "metrics:read" },
  { id: "money", label: "Money", needs: "finance:aggregate" },
  { id: "people", label: "People", needs: "people:read" },
  { id: "team", label: "Team", needs: "staff:read" },
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
        {tab === "overview" && <Overview call={call} />}
        {tab === "money" && <Money call={call} me={me} />}
        {tab === "people" && <People call={call} me={me} />}
        {tab === "team" && <Team call={call} me={me} />}
        {tab === "trail" && <Trail call={call} />}
      </div>
    </div>
  );
}

type Call = (path: string, init?: RequestInit) => Promise<unknown>;

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

function Overview({ call }: { call: Call }) {
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
        <div className="cc-tabs">
          {RANGES.map((r) => (
            <button key={r} className={days === r ? "on" : ""} onClick={() => setDays(r)}>
              {r} days
            </button>
          ))}
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

/* ---------- money ---------- */

function Money({ call, me }: { call: Call; me: Me }) {
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

function Team({ call, me }: { call: Call; me: Me }) {
  const [roles, setRoles] = useState<string[]>([]);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

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
                  <th>Email</th>
                  <th>Role</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Last seen</th>
                  {canWrite && <th />}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.userId}>
                    <td>{s.email}</td>
                    <td><span className={`cc-role ${s.role}`}>{s.role}</span></td>
                    <td>{s.title ?? ""}</td>
                    <td>
                      <span className={`cc-tag ${s.status === "active" ? "ok" : "bad"}`}>{s.status}</span>
                    </td>
                    <td>{s.lastSeenAt ? when(s.lastSeenAt) : "never"}</td>
                    {canWrite && (
                      <td>
                        {s.userId === me.userId ? (
                          <span className="cc-tag">you</span>
                        ) : (
                          <span className="cc-rowacts">
                            {s.status === "active" ? (
                              <button className="btn quiet small" onClick={() => setStatus(s, "suspended")}>Suspend</button>
                            ) : (
                              <button className="btn quiet small" onClick={() => setStatus(s, "active")}>Restore</button>
                            )}
                            <button className="btn danger small" onClick={() => remove(s)}>Remove</button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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

/* ---------- trail ---------- */

function Trail({ call }: { call: Call }) {
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

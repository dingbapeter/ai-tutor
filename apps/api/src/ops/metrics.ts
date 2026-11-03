/**
 * In-process observability with zero dependencies, in the same spirit as the
 * rest of the stack: nothing to install, nothing phoning home, and honest
 * numbers over pretty ones.
 *
 * What is collected:
 *   requests    count + error count + latency histogram, per route pattern
 *   loop lag    how far behind the event loop is running (the first thing
 *               that degrades when a Node process is overloaded)
 *   process     memory and uptime
 *
 * Route patterns, never raw URLs, label the metrics: /sessions/:id/message
 * stays one series no matter how many sessions exist, so cardinality is
 * bounded by the route table.
 */

/** Upper bounds in milliseconds. The last bucket catches everything slower. */
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

interface RouteStats {
  count: number;
  errors: number; // 5xx only: a 404 is an answer, a 500 is a failure
  totalMs: number;
  buckets: number[]; // counts per LATENCY_BUCKETS_MS entry, plus overflow
}

export interface ErrorRecord {
  at: string;
  route: string;
  method: string;
  statusCode: number;
  message: string;
}

const ERROR_RING_SIZE = 50;

export class Metrics {
  private routes = new Map<string, RouteStats>();
  private errors: ErrorRecord[] = [];
  private startedAt = Date.now();
  private lagSamples: number[] = [];
  private lagTimer: NodeJS.Timeout | null = null;

  /** Samples event-loop lag every second; call stop() on shutdown. */
  startLagSampling() {
    if (this.lagTimer) return;
    let expected = Date.now() + 1000;
    this.lagTimer = setInterval(() => {
      const lag = Math.max(0, Date.now() - expected);
      expected = Date.now() + 1000;
      this.lagSamples.push(lag);
      if (this.lagSamples.length > 60) this.lagSamples.shift();
    }, 1000);
    this.lagTimer.unref(); // never keep the process alive just to measure it
  }

  stop() {
    if (this.lagTimer) clearInterval(this.lagTimer);
    this.lagTimer = null;
  }

  record(route: string, method: string, statusCode: number, durationMs: number) {
    const key = `${method} ${route}`;
    let stats = this.routes.get(key);
    if (!stats) {
      stats = { count: 0, errors: 0, totalMs: 0, buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0) };
      this.routes.set(key, stats);
    }
    stats.count += 1;
    stats.totalMs += durationMs;
    if (statusCode >= 500) stats.errors += 1;
    const bucket = LATENCY_BUCKETS_MS.findIndex((b) => durationMs <= b);
    stats.buckets[bucket === -1 ? LATENCY_BUCKETS_MS.length : bucket] += 1;
  }

  recordError(record: Omit<ErrorRecord, "at">) {
    this.errors.push({ at: new Date().toISOString(), ...record });
    if (this.errors.length > ERROR_RING_SIZE) this.errors.shift();
  }

  /** The latency below which `q` of requests finished, from the histogram. */
  quantile(route: string, method: string, q: number): number | null {
    const stats = this.routes.get(`${method} ${route}`);
    if (!stats || stats.count === 0) return null;
    const target = Math.ceil(stats.count * q);
    let seen = 0;
    for (let i = 0; i < stats.buckets.length; i += 1) {
      seen += stats.buckets[i];
      if (seen >= target) return i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i] : Infinity;
    }
    return null;
  }

  /** The JSON view the Command Centre renders. */
  summary() {
    const mem = process.memoryUsage();
    const lag = [...this.lagSamples].sort((a, b) => a - b);
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) },
      eventLoop: {
        lagP50Ms: lag.length ? lag[Math.floor(lag.length / 2)] : 0,
        lagMaxMs: lag.length ? lag[lag.length - 1] : 0,
      },
      routes: [...this.routes.entries()]
        .map(([key, s]) => {
          const [method, ...rest] = key.split(" ");
          return {
            route: key,
            count: s.count,
            errors: s.errors,
            avgMs: Math.round(s.totalMs / s.count),
            p95Ms: this.quantile(rest.join(" "), method, 0.95),
          };
        })
        .sort((a, b) => b.count - a.count),
      recentErrors: [...this.errors].reverse(),
    };
  }

  /** Prometheus text exposition, so any Grafana can scrape it as-is. */
  prometheus(): string {
    const lines: string[] = [];
    const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push("# TYPE dingba_http_requests_total counter");
    lines.push("# TYPE dingba_http_request_errors_total counter");
    lines.push("# TYPE dingba_http_request_duration_ms histogram");
    for (const [key, s] of this.routes) {
      const [method, ...rest] = key.split(" ");
      const labels = `method="${esc(method)}",route="${esc(rest.join(" "))}"`;
      lines.push(`dingba_http_requests_total{${labels}} ${s.count}`);
      lines.push(`dingba_http_request_errors_total{${labels}} ${s.errors}`);
      let cumulative = 0;
      for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
        cumulative += s.buckets[i];
        lines.push(`dingba_http_request_duration_ms_bucket{${labels},le="${LATENCY_BUCKETS_MS[i]}"} ${cumulative}`);
      }
      lines.push(`dingba_http_request_duration_ms_bucket{${labels},le="+Inf"} ${s.count}`);
      lines.push(`dingba_http_request_duration_ms_sum{${labels}} ${Math.round(s.totalMs)}`);
      lines.push(`dingba_http_request_duration_ms_count{${labels}} ${s.count}`);
    }
    const mem = process.memoryUsage();
    lines.push("# TYPE dingba_process_rss_bytes gauge");
    lines.push(`dingba_process_rss_bytes ${mem.rss}`);
    lines.push("# TYPE dingba_process_uptime_seconds gauge");
    lines.push(`dingba_process_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`);
    const lag = [...this.lagSamples].sort((a, b) => a - b);
    lines.push("# TYPE dingba_event_loop_lag_ms gauge");
    lines.push(`dingba_event_loop_lag_ms ${lag.length ? lag[lag.length - 1] : 0}`);
    return lines.join("\n") + "\n";
  }
}

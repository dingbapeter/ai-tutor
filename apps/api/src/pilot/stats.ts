/**
 * The arithmetic behind a pilot report. Plain functions, no network, so
 * every number a school or an investor reads can be checked by hand and is
 * pinned by tests against values worked out on paper.
 *
 * Scores are percentages (0 to 100). A "gain" is endline minus baseline for
 * the same learner, in percentage points.
 */

export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Sample standard deviation (n - 1). Zero for fewer than two values. */
export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Two-sided 95% critical values of Student's t, exact to three places for small groups. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
  2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/**
 * The 95% two-sided critical value for `df` degrees of freedom (which may
 * be fractional, as Welch's are). A table up to 30, then the standard
 * series around the normal value, which is right to three places from there.
 */
export function tCritical95(df: number): number {
  if (!(df >= 1)) return NaN;
  if (df <= 30) {
    const lo = Math.floor(df);
    const hi = Math.min(30, lo + 1);
    const frac = df - lo;
    return T95[lo - 1] + (T95[hi - 1] - T95[lo - 1]) * frac;
  }
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
}

export interface PairedGain {
  n: number;
  preMean: number;
  postMean: number;
  /** Mean of (post - pre), percentage points. */
  gain: number;
  /** 95% interval for the mean gain; null when fewer than two learners. */
  ci: [number, number] | null;
  preSd: number;
  /** Mean gain in units of the baseline spread. Null when everyone started level. */
  effect: number | null;
  /** Share of learners who scored higher at the end than at the start, 0 to 1. */
  improved: number;
}

/** Before and after for the same learners, index by index. */
export function pairedGain(pre: number[], post: number[]): PairedGain | null {
  if (pre.length !== post.length) throw new Error("pre and post must pair up");
  const n = pre.length;
  if (n === 0) return null;
  const diffs = pre.map((p, i) => post[i] - p);
  const gain = mean(diffs);
  const se = sd(diffs) / Math.sqrt(n);
  const preSd = sd(pre);
  return {
    n,
    preMean: mean(pre),
    postMean: mean(post),
    gain,
    ci: n >= 2 ? [gain - tCritical95(n - 1) * se, gain + tCritical95(n - 1) * se] : null,
    preSd,
    effect: preSd > 0 ? gain / preSd : null,
    improved: diffs.filter((d) => d > 0).length / n,
  };
}

export interface GainDifference {
  /** Tutored gain minus comparison gain, percentage points. */
  difference: number;
  ci: [number, number] | null;
  /** The difference in units of the pooled baseline spread of both groups. */
  effect: number | null;
}

/**
 * How much more the tutored group gained than the comparison group, with
 * Welch's interval (the two groups need not be the same size or spread).
 */
export function gainDifference(tutorGains: number[], comparisonGains: number[], baselineBoth: number[]): GainDifference | null {
  const n1 = tutorGains.length;
  const n2 = comparisonGains.length;
  if (n1 === 0 || n2 === 0) return null;
  const difference = mean(tutorGains) - mean(comparisonGains);
  const v1 = sd(tutorGains) ** 2 / n1;
  const v2 = sd(comparisonGains) ** 2 / n2;
  const se = Math.sqrt(v1 + v2);
  let ci: [number, number] | null = null;
  if (n1 >= 2 && n2 >= 2 && se > 0) {
    const df = (v1 + v2) ** 2 / (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1));
    const t = tCritical95(df);
    ci = [difference - t * se, difference + t * se];
  } else if (n1 >= 2 && n2 >= 2) {
    ci = [difference, difference];
  }
  const spread = sd(baselineBoth);
  return { difference, ci, effect: spread > 0 ? difference / spread : null };
}

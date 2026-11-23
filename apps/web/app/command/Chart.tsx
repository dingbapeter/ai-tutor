"use client";

/**
 * A trend chart, drawn by hand in SVG. No charting library, no runtime
 * download, and it inherits the theme tokens like everything else.
 */
export default function Chart({ series, label }: { series: Array<{ day: string; count: number }>; label: string }) {
  if (series.length < 2) return <p className="cc-empty">Not enough days yet to draw a trend.</p>;

  const W = 640;
  const H = 120;
  const peak = Math.max(1, ...series.map((p) => p.count));
  const step = W / (series.length - 1);
  const y = (n: number) => H - (n / peak) * (H - 10) - 5;
  const points = series.map((p, i) => [i * step, y(p.count)] as const);
  const line = points.map(([x, py], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const last = points[points.length - 1];
  const total = series.reduce((n, p) => n + p.count, 0);

  return (
    <>
      <svg className="cc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${total} over ${series.length} days`}>
        <path className="area" d={area} />
        <path className="line" d={line} vectorEffect="non-scaling-stroke" />
        <circle className="dot" cx={last[0]} cy={last[1]} r={3.5} vectorEffect="non-scaling-size" />
      </svg>
      <div className="cc-chart-foot">
        <span>{series[0].day}</span>
        <span>
          {total.toLocaleString()} total, peak {peak.toLocaleString()} in a day
        </span>
        <span>{series[series.length - 1].day}</span>
      </div>
    </>
  );
}

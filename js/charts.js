// Speed along a recorded track: per-segment speeds, colour ramp, and tiny SVG charts.

import { distance } from "./geo.js";

export const RAMP = ["#2563eb", "#06b6d4", "#22c55e", "#eab308", "#f97316", "#dc2626"];

/**
 * Track [[lat,lng,t,ele?], ...] -> [{ from, to, km (cumulative at end), kmh, ele }],
 * speeds smoothed over ~3 segments so GPS jitter doesn't paint the line like confetti.
 */
export function segmentSpeeds(track) {
  const segs = [];
  let km = 0;
  for (let i = 1; i < track.length; i++) {
    const a = { lat: track[i - 1][0], lng: track[i - 1][1] };
    const b = { lat: track[i][0], lng: track[i][1] };
    const d = distance(a, b);
    const dt = (track[i][2] - track[i - 1][2]) / 1000;
    km += d / 1000;
    segs.push({ from: a, to: b, km, d, dt, ele: track[i][3] ?? null });
  }
  return segs.map((s, i) => {
    let d = 0;
    let dt = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(segs.length - 1, i + 1); j++) {
      d += segs[j].d;
      dt += segs[j].dt;
    }
    return { from: s.from, to: s.to, km: s.km, ele: s.ele, kmh: dt > 0 ? (d / dt) * 3.6 : 0 };
  });
}

/** Robust range (5th–95th percentile) so one glitch doesn't flatten the colours. */
export function speedRange(segs) {
  const v = segs.map((s) => s.kmh).filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [0, 0];
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return [q(0.05), q(0.95)];
}

export function colorFor(kmh, [lo, hi]) {
  if (hi <= lo) return RAMP[2];
  const f = Math.min(1, Math.max(0, (kmh - lo) / (hi - lo)));
  return RAMP[Math.min(RAMP.length - 1, Math.floor(f * RAMP.length))];
}

/** Group consecutive same-colour segments into polylines: [{ color, points: [[lat,lng],...] }]. */
export function colouredRuns(segs, range) {
  const runs = [];
  for (const s of segs) {
    const color = colorFor(s.kmh, range);
    const last = runs[runs.length - 1];
    if (last && last.color === color) last.points.push([s.to.lat, s.to.lng]);
    else runs.push({ color, points: [[s.from.lat, s.from.lng], [s.to.lat, s.to.lng]] });
  }
  return runs;
}

/**
 * Area chart as an SVG string. series: [{ x, y }], x ascending.
 * Values are numbers only, so the output is safe to inject.
 */
export function areaChart(series, { width = 320, height = 90, color = "currentColor", label = "" } = {}) {
  const pts = series.filter((p) => isFinite(p.x) && isFinite(p.y));
  if (pts.length < 2) return "";
  const x0 = pts[0].x;
  const x1 = pts[pts.length - 1].x;
  let y0 = Math.min(...pts.map((p) => p.y));
  let y1 = Math.max(...pts.map((p) => p.y));
  if (y1 - y0 < 1e-6) {
    y0 -= 1;
    y1 += 1;
  }
  const pad = 4;
  const sx = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - 2 * pad);
  const sy = (y) => height - pad - ((y - y0) / (y1 - y0)) * (height - 2 * pad - 14);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const area = `${line}L${sx(x1).toFixed(1)},${height - pad}L${sx(x0).toFixed(1)},${height - pad}Z`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${label}">
  <path d="${area}" fill="${color}" fill-opacity="0.15"/>
  <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
  <text x="${width - pad}" y="12" text-anchor="end" font-size="11" fill="currentColor" opacity="0.6">max ${y1.toFixed(y1 < 20 ? 1 : 0)}</text>
</svg>`;
}

// Loops: go to a place and come back a different way.

import { bearing, destination, distance } from "./geo.js";
import { resample } from "./ride.js";

/**
 * A point to pass on the way back, offset to one side of the straight line
 * start → place, so the return leg doesn't retrace the way out.
 * side: 1 = right of the outbound direction, -1 = left.
 */
export function returnVia(start, place, side = 1, spread = 0.35) {
  const d = distance(start, place);
  const br = bearing(start, place);
  const mid = destination(start, br, d * 0.5);
  return destination(mid, br + 90 * side, d * spread);
}

/** Stops of a loop: start → place → via → start. */
export function loopStops(start, place, side = 1) {
  return [start, place, returnVia(start, place, side), start];
}

/** Rough loop length (m) from straight-line legs; real roads are longer. */
export function loopStraightLength(stops) {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += distance(stops[i - 1], stops[i]);
  return total;
}

/**
 * How much of a route retraces itself (an out-and-back "spike"), 0..1.
 * 0 = a clean loop, 1 = the whole way back is the way out. Overlap within the
 * first/last `ends` metres is ignored: leaving and returning by your own street is fine.
 */
export function spikeRatio(points, { tolerance = 25, ends = 250 } = {}) {
  const pts = resample(points, 20);
  if (pts.length < 4) return 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distance(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (total < 100) return 0;
  // Grid hash so each point only looks at its neighbours.
  const cell = tolerance / 111320;
  const grid = new Map();
  const keyOf = (p, dx = 0, dy = 0) => `${Math.floor(p.lat / cell) + dx},${Math.floor(p.lng / cell) + dy}`;
  let retraced = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const counted = cum[i] > ends && total - cum[i] > ends;
    if (counted && i > 0) {
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++)
        for (let dy = -2; dy <= 2 && !hit; dy++)
          for (const j of grid.get(keyOf(p, dx, dy)) || [])
            if (cum[i] - cum[j] > 4 * tolerance + 40 && distance(p, pts[j]) <= tolerance) {
              hit = true;
              break;
            }
      if (hit) retraced += cum[i] - cum[i - 1];
    }
    const k = keyOf(p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return Math.min(1, retraced / (total / 2));
}

/**
 * Candidate loops start → place → … → start. Uses a second real place on the way
 * back when one sits off to the side, plus return points left/right at two spreads.
 */
export function loopVariants(start, place, others = []) {
  const d = distance(start, place);
  const br = bearing(start, place);
  const out = [];
  const second = others
    .filter((q) => q.id !== place.id)
    .map((q) => {
      const dq = distance(start, q);
      let ang = Math.abs(bearing(start, q) - br) % 360;
      if (ang > 180) ang = 360 - ang;
      return { q, dq, ang };
    })
    .filter((x) => x.ang >= 35 && x.ang <= 120 && x.dq > d * 0.4 && x.dq < d * 1.1 && distance(place, x.q) < d * 1.2)
    // Best second stop: off to the side (~70°) and as interesting as possible.
    .map((x) => ({ ...x, score: (x.q.wow ?? 0.5) * (1 - Math.abs(x.ang - 70) / 100) }))
    .sort((a, b) => b.score - a.score)[0];
  if (second) out.push({ stops: [start, place, second.q, start], via: second.q, viaPlace: second.q });
  for (const side of [1, -1])
    for (const spread of [0.3, 0.5]) {
      const via = returnVia(start, place, side, spread);
      out.push({ stops: [start, place, via, start], via });
    }
  return out;
}

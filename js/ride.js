// Motorbike ride styles: measure how twisty a route is and pick accordingly.

import { bearing, distance, destination, pathLength } from "./geo.js";

/** Resample a polyline to points every `step` metres (smooths out GPS/geometry noise). */
export function resample(points, step = 60) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = distance(a, b);
    if (seg === 0) continue;
    const br = bearing(a, b);
    let pos = step - carry;
    while (pos <= seg) {
      out.push(destination(a, br, pos));
      pos += step;
    }
    carry = seg - (pos - step);
  }
  const last = points[points.length - 1];
  if (distance(out[out.length - 1], last) > step / 3) out.push(last);
  return out;
}

/**
 * Twistiness: total heading change (degrees) per km of road.
 * A motorway is ~20-60 °/km, town streets ~150+, a mountain pass 300+.
 */
export function curvature(points) {
  const pts = resample(points, 60);
  if (pts.length < 3) return 0;
  let turn = 0;
  let prev = bearing(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i++) {
    const cur = bearing(pts[i - 1], pts[i]);
    let d = Math.abs(cur - prev) % 360;
    if (d > 180) d = 360 - d;
    // Hairpins at junctions in town are not "twisties": cap a single turn.
    turn += Math.min(d, 60);
    prev = cur;
  }
  const km = pathLength(pts) / 1000;
  return km > 0 ? turn / km : 0;
}

/**
 * Score a fetched route for a ride style.
 * route: { points, distance (m), duration (s) }
 */
export function rideScore(route, style) {
  const curv = curvature(route.points);
  const kmh = route.duration > 0 ? route.distance / 1000 / (route.duration / 3600) : 0;
  if (style === "twisty") {
    // Twisty but not crawling through a city: reward curvature at a decent speed.
    const flow = Math.min(1, kmh / 50);
    return { curvature: curv, kmh, score: curv * (0.4 + 0.6 * flow) };
  }
  if (style === "straight") {
    return { curvature: curv, kmh, score: kmh / (1 + curv / 60) };
  }
  return { curvature: curv, kmh, score: 1 };
}

/** Human label for a curvature value. */
export function twistLabel(curv) {
  if (curv >= 250) return "very twisty";
  if (curv >= 150) return "twisty";
  if (curv >= 80) return "some bends";
  return "mostly straight";
}

/** A few points along a route, so a maps app follows the same roads. */
export function viaPoints(points, n = 3) {
  if (points.length < 3) return [];
  const total = pathLength(points);
  const out = [];
  let acc = 0;
  let k = 1;
  for (let i = 1; i < points.length && k <= n; i++) {
    acc += distance(points[i - 1], points[i]);
    if (acc >= (total * k) / (n + 1)) {
      out.push(points[i]);
      k++;
    }
  }
  return out;
}

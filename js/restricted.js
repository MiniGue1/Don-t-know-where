// Restricted land (military areas, private/no-access zones): keep places and routes out of it.
// Polygons are arrays of { lat, lng } (outer rings).

import { distance } from "./geo.js";

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

/** Bounding box, so most polygons can be skipped cheaply. */
function bbox(ring) {
  let s = 90, n = -90, w = 180, e = -180;
  for (const p of ring) {
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
    if (p.lng < w) w = p.lng;
    if (p.lng > e) e = p.lng;
  }
  return { s, n, w, e };
}

/** Pre-compute bounding boxes: [{ ring, box }]. */
export function prepare(polys) {
  return (polys || []).filter((r) => r.length >= 3).map((ring) => ({ ring, box: bbox(ring) }));
}

const inBox = (p, b) => p.lat >= b.s && p.lat <= b.n && p.lng >= b.w && p.lng <= b.e;

export function isRestricted(p, prepared) {
  for (const { ring, box } of prepared) if (inBox(p, box) && pointInPolygon(p, ring)) return true;
  return false;
}

/**
 * Does a route pass through restricted land? Samples every ~50 m and ignores the
 * first and last `ends` metres (you may live right next to a boundary).
 */
export function routeHitsRestricted(points, prepared, ends = 150) {
  if (!prepared.length || points.length < 2) return false;
  let total = 0;
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push((total += distance(points[i - 1], points[i])));
  let next = 0;
  for (let i = 0; i < points.length; i++) {
    if (cum[i] < next) continue;
    next = cum[i] + 50;
    if (cum[i] < ends || total - cum[i] < ends) continue;
    if (isRestricted(points[i], prepared)) return true;
  }
  return false;
}

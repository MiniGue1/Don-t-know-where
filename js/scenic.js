// How fun is a route? What you pass (forest, meadows, water vs. a busy road),
// what you see on the way (springs, viewpoints, rocks…) and what you reach.
// One Overpass request fetches what lies along all candidate routes.

import { distance } from "./geo.js";
import { resample } from "./ride.js";
import { prepare, isRestricted } from "./restricted.js";
import { joinRings, thinRing, osmPt, overpassRace } from "./places.js";

/** Evenly spaced subset of a polyline, for the Overpass `around` filter. */
export function simplifyLine(points, n = 25) {
  if (points.length <= n) return points;
  const out = [];
  for (let i = 0; i < n; i++) out.push(points[Math.round((i * (points.length - 1)) / (n - 1))]);
  return out;
}

const GREEN = [
  ['"landuse"~"^(forest|meadow)$"', "way"],
  ['"natural"~"^(wood|scrub|heath|grassland|water)$"', "way"],
  ['"leisure"~"^(park|nature_reserve)$"', "way"],
  ['"landuse"="forest"', "relation"],
  ['"natural"~"^(wood|water)$"', "relation"],
  ['"leisure"="nature_reserve"', "relation"],
];

/** Overpass query for nature, water and busy roads along the given routes. */
export function corridorQuery(routes, radius = 40) {
  const stmts = [];
  for (const r of routes) {
    const line = simplifyLine(r.points)
      .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
      .join(",");
    const a = `(around:${radius},${line})`;
    for (const [filter, type] of GREEN) stmts.push(`  ${type}${a}[${filter}];`);
    stmts.push(`  way${a}["waterway"~"^(river|stream|canal)$"];`);
    stmts.push(`  way${a}["highway"~"^(motorway|trunk|primary)$"];`);
  }
  return `[out:json][timeout:15];\n(\n${stmts.join("\n")}\n);\nout geom;`;
}

const isGreenTags = (t = {}) =>
  /^(forest|meadow)$/.test(t.landuse || "") || /^(wood|scrub|heath|grassland|water)$/.test(t.natural || "") || /^(park|nature_reserve)$/.test(t.leisure || "");

function lineBox(pts, pad) {
  let s = 90, n = -90, w = 180, e = -180;
  for (const p of pts) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
  }
  const dLat = pad / 111320;
  const dLng = pad / (111320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return { s: s - dLat, n: n + dLat, w: w - dLng, e: e + dLng };
}

/** { green: prepared polygons, water: lines, roads: lines (with .big for motorway/trunk) }. */
export function parseCorridor(json) {
  const greenRings = [];
  const water = [];
  const roads = [];
  const seen = new Set();
  for (const el of json?.elements || []) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = el.tags || {};
    if (el.type === "way" && el.geometry?.length >= 2) {
      const pts = el.geometry.map(osmPt);
      if (t.highway) roads.push({ pts: thinRing(pts), big: /^(motorway|trunk)$/.test(t.highway), box: lineBox(pts, 200) });
      else if (t.waterway) water.push({ pts: thinRing(pts), box: lineBox(pts, 40) });
      else if (isGreenTags(t) && pts.length >= 4) greenRings.push(thinRing(pts));
    } else if (el.type === "relation" && el.members && isGreenTags(t)) {
      const outer = el.members.filter((m) => m.type === "way" && m.role !== "inner" && m.geometry?.length).map((m) => m.geometry.map(osmPt));
      for (const ring of joinRings(outer)) greenRings.push(thinRing(ring));
    }
  }
  return { green: prepare(greenRings), water, roads };
}

/** Distance (m) from p to segment a–b, on a local flat projection. */
function segDist(p, a, b) {
  const k = Math.cos((p.lat * Math.PI) / 180) * 111320;
  const ax = (a.lng - p.lng) * k, ay = (a.lat - p.lat) * 110540;
  const bx = (b.lng - p.lng) * k, by = (b.lat - p.lat) * 110540;
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const tt = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + tt * dx, ay + tt * dy);
}

const inBox = (p, b) => p.lat >= b.s && p.lat <= b.n && p.lng >= b.w && p.lng <= b.e;

/** Is p within `m` metres of any of the lines? */
export function nearLines(p, lines, m) {
  for (const line of lines) {
    if (!inBox(p, line.box)) continue;
    for (let i = 1; i < line.pts.length; i++) if (segDist(p, line.pts[i - 1], line.pts[i]) <= m) return line;
  }
  return null;
}

const samples = (points) => resample(points, 50);

/** Share of the route (0–1) through nature: green areas, or along water. */
export function greenShare(points, corridor) {
  const s = samples(points);
  if (!s.length) return 0;
  return s.filter((p) => isRestricted(p, corridor.green) || nearLines(p, corridor.water, 30)).length / s.length;
}

/** Share of the route (0–1) right next to a busy road. */
export function busyShare(points, corridor) {
  const s = samples(points);
  if (!s.length) return 0;
  return s.filter((p) => nearLines(p, corridor.roads, 25)).length / s.length;
}

/** Interesting places within `within` metres of the route (not the destination), best first. */
export function sightsAlong(points, places, excludeIds = [], within = 120) {
  const s = samples(points);
  if (!s.length) return [];
  const box = lineBox(s, within);
  const skip = new Set(excludeIds);
  return places
    .filter((pl) => !skip.has(pl.id) && inBox(pl, box) && s.some((q) => distance(q, pl) <= within))
    .sort((a, b) => (b.wow ?? 0.5) - (a.wow ?? 0.5));
}

/** Destination right by a motorway or trunk road? */
export function nearMotorway(place, corridor) {
  return Boolean(nearLines(place, corridor.roads.filter((r) => r.big), 150));
}

/**
 * Fun score 0–10. `green` may be null when the corridor data is unavailable.
 * countBusy: only walking/running/cycling mind a busy road.
 */
export function funScore({ green = null, busy = 0, sights = [], destWow = 0.5, nearMotorway: nearMw = false, countBusy = true }) {
  const sightSum = sights.slice(0, 6).reduce((s, p) => s + (p.wow ?? 0.5), 0);
  const sightPart = 1 - Math.exp(-sightSum / 1.5);
  let v = green == null ? 0.5 * sightPart + 0.5 * destWow : 0.4 * green + 0.3 * sightPart + 0.3 * destWow;
  if (countBusy) v -= 0.5 * busy;
  if (nearMw) v *= 0.5;
  return Math.round(Math.max(0, Math.min(1, v)) * 100) / 10;
}

/** Everything about one route at once. */
export function scoreRoute(route, { corridor, places = [], dest, countBusy = true }) {
  const green = corridor ? greenShare(route.points, corridor) : null;
  const busy = corridor && countBusy ? busyShare(route.points, corridor) : 0;
  const sights = sightsAlong(route.points, places, dest ? [dest.id] : []);
  const nearMw = corridor && dest ? nearMotorway(dest, corridor) : false;
  return { green, busy, sights, nearMotorway: nearMw, fun: funScore({ green, busy, sights, destWow: dest?.wow ?? 0.5, nearMotorway: nearMw, countBusy }) };
}

/** Fetch what lies along the routes. Resolves to a corridor or null (offline / slow). */
export function fetchCorridor(routes, opts) {
  if (!routes.length) return Promise.resolve(null);
  return overpassRace(corridorQuery(routes), { timeoutMs: 9000, ...opts })
    .then(parseCorridor)
    .catch(() => null);
}

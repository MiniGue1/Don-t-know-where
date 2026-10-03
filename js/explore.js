// Exploration squares: the map is cut into slippy-map tiles at zoom 16
// (~400 m across in central Europe). Every square you've passed through counts.

import { distance, bearing, destination } from "./geo.js";

export const ZOOM = 16;

export function tileOf(lat, lng, z = ZOOM) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
}

export const squareKey = (x, y) => `${x},${y}`;

function tileLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
const tileLng = (x, z) => (x / 2 ** z) * 360 - 180;

/** [[south, west], [north, east]] of a square, ready for Leaflet. */
export function squareBounds(x, y, z = ZOOM) {
  return [
    [tileLat(y + 1, z), tileLng(x, z)],
    [tileLat(y, z), tileLng(x + 1, z)],
  ];
}

/** Squares touched by a track ([[lat,lng,...], ...]); segments are filled in every ~100 m. */
export function squaresOfTrack(track, into = new Set()) {
  for (let i = 0; i < track.length; i++) {
    const p = { lat: track[i][0], lng: track[i][1] };
    const t = tileOf(p.lat, p.lng);
    into.add(squareKey(t.x, t.y));
    if (i === 0) continue;
    const prev = { lat: track[i - 1][0], lng: track[i - 1][1] };
    const d = distance(prev, p);
    if (d > 100 && d < 50000) {
      const br = bearing(prev, p);
      for (let s = 100; s < d; s += 100) {
        const q = destination(prev, br, s);
        const tq = tileOf(q.lat, q.lng);
        into.add(squareKey(tq.x, tq.y));
      }
    }
  }
  return into;
}

export function visitedSquares(history) {
  const set = new Set();
  for (const t of history) {
    if (t.track?.length) squaresOfTrack(t.track, set);
    else if (t.arrived && t.place) {
      const s = tileOf(t.place.lat, t.place.lng);
      set.add(squareKey(s.x, s.y));
    }
  }
  return set;
}

/** Squares whose centre lies within radiusKm of center. */
export function squaresAround(center, radiusKm) {
  const c = tileOf(center.lat, center.lng);
  const [[s], [n]] = squareBounds(c.x, c.y);
  const sizeKm = Math.max(0.05, (n - s) * 111);
  const r = Math.ceil(radiusKm / sizeKm) + 1;
  const out = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      const [[ss, w], [nn, e]] = squareBounds(c.x + dx, c.y + dy);
      if (distance(center, { lat: (ss + nn) / 2, lng: (w + e) / 2 }) <= radiusKm * 1000) out.push(squareKey(c.x + dx, c.y + dy));
    }
  }
  return out;
}

/** Share (0–100) of the squares around `center` that have been visited. */
export function exploredPercent(visited, center, radiusKm = 5) {
  const around = squaresAround(center, radiusKm);
  if (!around.length) return 0;
  const seen = around.filter((k) => visited.has(k)).length;
  return Math.round((seen / around.length) * 1000) / 10;
}

export function isNewSquare(visited, p) {
  const t = tileOf(p.lat, p.lng);
  return !visited.has(squareKey(t.x, t.y));
}

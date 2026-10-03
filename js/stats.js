// Turns trip history into personal speeds, interests and records.

import { MODES } from "./modes.js";
import { CATEGORY_IDS } from "./places.js";

/** Trips that are usable for speed estimates. */
const speedTrips = (history, mode) =>
  history.filter((t) => t.mode === mode && t.arrived && t.travelSec >= 60 && t.avgSpeedKmh > 0);

/**
 * The user's typical speed for a mode (km/h). Recent trips weigh more; blends
 * toward the default until there are a few trips so one odd trip can't skew it.
 */
export function personalSpeed(history, mode) {
  const def = MODES[mode]?.defaultSpeedKmh ?? 5;
  const trips = speedTrips(history, mode)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
  if (!trips.length) return def;
  let wSum = 0;
  let sum = 0;
  trips.forEach((t, i) => {
    const w = Math.pow(0.85, i);
    // Clamp outliers to a sane band around the default.
    const v = Math.min(Math.max(t.avgSpeedKmh, def * 0.3), def * 3);
    sum += v * w;
    wSum += w;
  });
  const observed = sum / wSum;
  const confidence = Math.min(1, trips.length / 3);
  return +(def * (1 - confidence) + observed * confidence).toFixed(2);
}

/**
 * Learned interest per category in 0..1, based on how long the user lingered
 * at each kind of place. Longer stays => more interest.
 */
export function interestProfile(history) {
  const totals = Object.fromEntries(CATEGORY_IDS.map((c) => [c, 0]));
  for (const t of history) {
    if (!t.arrived || !totals.hasOwnProperty(t.place?.category)) continue;
    // Diminishing returns: a 2 h stay isn't 8x as meaningful as 15 min.
    totals[t.place.category] += Math.log1p((t.dwellSec || 0) / 60) + 0.5;
  }
  const max = Math.max(...Object.values(totals));
  if (max <= 0) return totals;
  for (const c of CATEGORY_IDS) totals[c] = +(totals[c] / max).toFixed(3);
  return totals;
}

export const visitedIds = (history) =>
  new Set(history.filter((t) => t.arrived).map((t) => t.place.id));

/** Personal bests and totals for the profile screen. */
export function records(history) {
  const done = history.filter((t) => t.arrived);
  const byMode = {};
  for (const id of Object.keys(MODES)) {
    const trips = speedTrips(history, id);
    if (!trips.length) continue;
    const fastest = trips.reduce((a, b) => (b.avgSpeedKmh > a.avgSpeedKmh ? b : a));
    byMode[id] = {
      trips: trips.length,
      avgSpeedKmh: personalSpeed(history, id),
      fastest: { tripId: fastest.id, speedKmh: fastest.avgSpeedKmh, place: fastest.place.name },
    };
  }
  const longest = history.reduce((a, b) => (!a || b.distance > a.distance ? b : a), null);
  const longestStay = done.reduce((a, b) => (!a || b.dwellSec > a.dwellSec ? b : a), null);
  return {
    trips: history.length,
    placesVisited: visitedIds(history).size,
    totalDistance: history.reduce((s, t) => s + (t.distance || 0), 0),
    totalDwellSec: history.reduce((s, t) => s + (t.dwellSec || 0), 0),
    streakDays: streakDays(history),
    byMode,
    longestTrip: longest && { tripId: longest.id, distance: longest.distance, place: longest.place.name },
    longestStay: longestStay && { tripId: longestStay.id, dwellSec: longestStay.dwellSec, place: longestStay.place.name },
  };
}

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Consecutive days (ending today or yesterday) with at least one outing. */
export function streakDays(history, now = Date.now()) {
  const days = new Set(history.map((t) => dayKey(t.startedAt)));
  const DAY = 86400000;
  let cursor = now;
  if (!days.has(dayKey(cursor))) cursor -= DAY;
  let n = 0;
  while (days.has(dayKey(cursor))) {
    n++;
    cursor -= DAY;
  }
  return n;
}

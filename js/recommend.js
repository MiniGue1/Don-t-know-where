// Picks where to go: fits your speed and time, matches what you like,
// and prefers places (and directions) you haven't been to yet.

import { bearing, distance } from "./geo.js";
import { personalSpeed, interestProfile, visitedIds } from "./stats.js";

// Real routes are longer than the straight line.
export const DETOUR_FACTOR = 1.35;

/** Estimated one-way travel time in minutes for a straight-line distance. */
export function estimateMinutes(straightMetres, speedKmh) {
  return ((straightMetres * DETOUR_FACTOR) / 1000 / speedKmh) * 60;
}

/** Straight-line radius (m) worth searching for a given outing budget. */
export function searchRadius(minutes, speedKmh) {
  // One-way leg may use up to ~60% of the budget.
  const oneWayKm = (speedKmh * (minutes * 0.6)) / 60;
  return Math.max(400, Math.min(50000, (oneWayKm * 1000) / DETOUR_FACTOR));
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Score and rank candidate places.
 *
 * @param {object} opts
 * @param {Array}  opts.places    candidates from places.js
 * @param {object} opts.from      current position
 * @param {string} opts.mode      walk | bike | moto | car
 * @param {number} opts.minutes   total time the user has for the outing
 * @param {string[]} opts.interests categories the user picked (empty = anything)
 * @param {Array}  opts.history   past trips
 * @param {string} opts.difficulty easy | moderate | hard (walk / run / bike)
 * @param {Map}    opts.elevations place id -> elevation (m), optional
 * @param {number} opts.startEle  elevation at `from`, optional
 * @param {Function} opts.rand    RNG, injectable for tests
 */
export function rankPlaces({
  places,
  from,
  mode,
  minutes,
  interests = [],
  history = [],
  difficulty = "moderate",
  elevations = null,
  startEle = null,
  rand = Math.random,
}) {
  const speed = personalSpeed(history, mode);
  const learned = interestProfile(history);
  const visited = visitedIds(history);
  const recentBearings = history
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 5)
    .filter((t) => t.track?.length)
    .map((t) => bearing({ lat: t.track[0][0], lng: t.track[0][1] }, t.place));

  // Ideal one-way minutes: harder = further out.
  const target = minutes * (difficulty === "easy" ? 0.25 : difficulty === "hard" ? 0.45 : 0.35);
  const maxOneWay = minutes * 0.6;
  const minDist = mode === "walk" ? 150 : mode === "bike" ? 400 : 1000;
  const picked = new Set(interests);

  const ranked = [];
  for (const p of places) {
    const d = distance(from, p);
    if (d < minDist) continue;
    const est = estimateMinutes(d, speed);
    if (est > maxOneWay) continue;

    const reasons = [];
    const fit = Math.exp(-(((est - target) / (target * 0.7)) ** 2));

    let interest = picked.size ? (picked.has(p.category) ? 1 : 0.2) : 0.6;
    interest += 0.5 * (learned[p.category] || 0);
    if (picked.has(p.category)) reasons.push("matches what you want to see");
    else if ((learned[p.category] || 0) > 0.6) reasons.push("you tend to linger at places like this");

    const isNew = !visited.has(p.id);
    const novelty = isNew ? 1 : 0.15;
    if (isNew) reasons.push("somewhere new");

    let direction = 1;
    if (recentBearings.length) {
      const b = bearing(from, p);
      const closest = Math.min(...recentBearings.map((rb) => angleDiff(rb, b)));
      direction = 0.7 + 0.3 * Math.min(1, closest / 90);
      if (closest > 90) reasons.push("a direction you haven't explored lately");
    }

    // Difficulty: prefer flat for easy, climbs for hard (when elevation is known).
    let terrain = 1;
    const ele = elevations?.get(p.id);
    if (ele != null && startEle != null) {
      const climb = ele - startEle;
      const grade = (climb / (d * DETOUR_FACTOR)) * 100;
      if (difficulty === "easy") terrain = grade > 3 ? 0.5 : 1;
      else if (difficulty === "hard") {
        terrain = 0.6 + Math.min(1.2, Math.max(0, grade) / 5);
        if (climb > 40) reasons.push(`+${Math.round(climb)} m climb`);
      }
    } else if (difficulty === "hard" && p.category === "views") terrain = 1.3;

    const named = p.named === false ? 0.75 : 1;
    const jitter = 0.85 + 0.3 * rand();
    const score = fit * interest * novelty * direction * terrain * named * jitter;

    ranked.push({
      place: p,
      score,
      distance: d,
      estMinutes: Math.max(1, Math.round(est)),
      isNew,
      reasons,
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { speedKmh: speed, ranked };
}

/** "Surprise me": weighted random pick among the best few. */
export function surprisePick(ranked, rand = Math.random, top = 6) {
  const pool = ranked.slice(0, top);
  if (!pool.length) return null;
  const total = pool.reduce((s, r) => s + r.score, 0);
  let x = rand() * total;
  for (const r of pool) {
    x -= r.score;
    if (x <= 0) return r;
  }
  return pool[pool.length - 1];
}

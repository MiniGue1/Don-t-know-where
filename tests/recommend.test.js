import { test } from "node:test";
import assert from "node:assert/strict";
import { rankPlaces, surprisePick, searchRadius, estimateMinutes } from "../js/recommend.js";
import { personalSpeed, interestProfile, records, streakDays } from "../js/stats.js";
import { destination } from "../js/geo.js";

const from = { lat: 50, lng: 14 };
const mk = (id, category, dist, deg = 0) => ({ id, name: id, kind: category, category, named: true, ...destination(from, deg, dist) });
const fixed = () => 0.5;

const trip = (over) => ({
  id: Math.random().toString(36),
  mode: "walk",
  arrived: true,
  travelSec: 900,
  avgSpeedKmh: 6,
  dwellSec: 600,
  distance: 1500,
  startedAt: Date.now(),
  place: { id: "x", name: "x", category: "nature", lat: 50.01, lng: 14 },
  track: [[50, 14, 0]],
  ...over,
});

test("personal speed blends toward the user's real pace", () => {
  assert.equal(personalSpeed([], "walk"), 4.8);
  const one = personalSpeed([trip({ avgSpeedKmh: 6 })], "walk");
  assert.ok(one > 4.8 && one < 6);
  const many = personalSpeed([1, 2, 3, 4].map(() => trip({ avgSpeedKmh: 6 })), "walk");
  assert.equal(many, 6);
  // other modes unaffected
  assert.equal(personalSpeed([trip({})], "car"), 40);
});

test("faster users get a bigger search radius", () => {
  assert.ok(searchRadius(30, 6) > searchRadius(30, 4));
  assert.ok(Math.abs(estimateMinutes(1000, 5) - 16.2) < 0.1);
});

test("excludes places that are too far or too close for the time budget", () => {
  const places = [mk("near", "nature", 50), mk("ok", "nature", 600), mk("far", "nature", 6000)];
  const { ranked } = rankPlaces({ places, from, mode: "walk", minutes: 30, rand: fixed });
  assert.deepEqual(ranked.map((r) => r.place.id), ["ok"]);
});

test("prefers chosen interests and new places", () => {
  const places = [mk("cafe", "food", 700), mk("castle", "history", 700, 180)];
  let { ranked } = rankPlaces({ places, from, mode: "walk", minutes: 30, interests: ["history"], rand: fixed });
  assert.equal(ranked[0].place.id, "castle");

  const history = [trip({ place: { ...places[1] } })];
  ({ ranked } = rankPlaces({ places, from, mode: "walk", minutes: 30, interests: [], history, rand: fixed }));
  assert.equal(ranked[0].place.id, "cafe", "visited place should drop");
  assert.equal(ranked.find((r) => r.place.id === "castle").isNew, false);
});

test("learned interests come from dwell time", () => {
  const prof = interestProfile([
    trip({ dwellSec: 3600, place: { id: "a", category: "views" } }),
    trip({ dwellSec: 60, place: { id: "b", category: "food" } }),
  ]);
  assert.equal(prof.views, 1);
  assert.ok(prof.food < 0.5);
});

test("surprise pick is from the top results", () => {
  const ranked = [{ score: 3 }, { score: 2 }, { score: 1 }];
  assert.equal(surprisePick(ranked, () => 0), ranked[0]);
  assert.equal(surprisePick(ranked, () => 0.99), ranked[2]);
  assert.equal(surprisePick([], () => 0.5), null);
});

test("records and streak", () => {
  const day = 86400000;
  const now = new Date(2026, 5, 10, 12).getTime();
  const h = [trip({ startedAt: now }), trip({ startedAt: now - day }), trip({ startedAt: now - 3 * day })];
  assert.equal(streakDays(h, now), 2);
  const r = records(h);
  assert.equal(r.trips, 3);
  assert.equal(r.byMode.walk.trips, 3);
});

test("allowLow keeps dull places when asked", () => {
  const places = [{ ...mk("park", "nature", 700), wow: 0.3 }, { ...mk("tower", "views", 700, 90), wow: 1 }];
  assert.equal(rankPlaces({ places, from, mode: "walk", minutes: 30, rand: fixed }).ranked.length, 1);
  assert.equal(rankPlaces({ places, from, mode: "walk", minutes: 30, rand: fixed, allowLow: true }).ranked.length, 2);
});

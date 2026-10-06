import { test } from "node:test";
import assert from "node:assert/strict";
import { corridorQuery, parseCorridor, greenShare, busyShare, sightsAlong, nearMotorway, funScore, scoreRoute, simplifyLine } from "../js/scenic.js";
import { destination } from "../js/geo.js";

const s = { lat: 49.6, lng: 17.3 };
const line = (from, deg, m, step = 50) => Array.from({ length: Math.round(m / step) + 1 }, (_, i) => destination(from, deg, i * step));
const g = (p) => ({ lat: p.lat, lon: p.lng });

// Route: 2 km due east. A forest covers the first km; a primary road runs along the second km.
const route = line(s, 90, 2000);
const forest = [destination(s, 0, 200), destination(destination(s, 90, 1000), 0, 200), destination(destination(s, 90, 1000), 180, 200), destination(s, 180, 200)];
forest.push(forest[0]);
const roadPts = line(destination(destination(s, 90, 1000), 0, 10), 90, 1000, 100);
const motorway = line(destination(destination(s, 90, 2000), 0, 100), 0, 600, 100);
const json = {
  elements: [
    { type: "way", id: 1, tags: { landuse: "forest" }, geometry: forest.map(g) },
    { type: "way", id: 2, tags: { highway: "primary" }, geometry: roadPts.map(g) },
    { type: "way", id: 3, tags: { highway: "motorway" }, geometry: motorway.map(g) },
    { type: "way", id: 1, tags: { landuse: "forest" }, geometry: forest.map(g) }, // duplicate from another route's corridor
  ],
};
const corridor = parseCorridor(json);

test("query: one around-filter per route, well-formed", () => {
  const q = corridorQuery([{ points: route }, { points: line(s, 0, 1000) }]);
  assert.equal((q.match(/\(/g) || []).length, (q.match(/\)/g) || []).length);
  assert.ok(q.includes("around:40,"));
  assert.equal(q.split("\n").filter((l) => l.includes('"highway"')).length, 2);
  assert.equal(simplifyLine(route, 10).length, 10);
});

test("green share ≈ half; busy share ≈ half", () => {
  assert.equal(corridor.green.length, 1);
  const gs = greenShare(route, corridor);
  const bs = busyShare(route, corridor);
  assert.ok(gs > 0.4 && gs < 0.6, `green ${gs}`);
  assert.ok(bs > 0.35 && bs < 0.6, `busy ${bs}`);
});

test("water counts as nature", () => {
  const river = { elements: [{ type: "way", id: 9, tags: { waterway: "river" }, geometry: line(destination(s, 0, 20), 90, 2000).map(g) }] };
  assert.ok(greenShare(route, parseCorridor(river)) > 0.9);
});

test("sights along the route, excluding the destination, best first", () => {
  const spring = { id: "spring", wow: 0.5, ...destination(destination(s, 90, 500), 0, 80) };
  const tower = { id: "tower", wow: 1, ...destination(destination(s, 90, 1500), 180, 60) };
  const far = { id: "far", wow: 1, ...destination(destination(s, 90, 800), 0, 400) };
  const dest = { id: "dest", wow: 0.9, ...destination(s, 90, 2000) };
  const along = sightsAlong(route, [spring, tower, far, dest], ["dest"]);
  assert.deepEqual(along.map((p) => p.id), ["tower", "spring"]);
});

test("destination by a motorway", () => {
  assert.equal(nearMotorway(destination(s, 90, 2000), corridor), true);
  assert.equal(nearMotorway(s, corridor), false);
});

test("fun score: forest with sights beats road with nothing; motorway halves it", () => {
  const nice = funScore({ green: 0.8, busy: 0, sights: [{ wow: 0.5 }, { wow: 0.9 }], destWow: 0.9 });
  const dull = funScore({ green: 0.1, busy: 0.6, sights: [], destWow: 0.9 });
  assert.ok(nice >= 7 && dull <= 3, `${nice} vs ${dull}`);
  assert.equal(funScore({ green: 0.8, sights: [], destWow: 1, nearMotorway: true }), funScore({ green: 0.8, sights: [], destWow: 1 }) / 2);
  // Cars don't mind roads.
  assert.ok(funScore({ green: 0.2, busy: 0.9, destWow: 0.8, countBusy: false }) > funScore({ green: 0.2, busy: 0.9, destWow: 0.8 }));
  // Without corridor data it still scores from sights + destination.
  assert.ok(funScore({ green: null, sights: [{ wow: 1 }], destWow: 1 }) > 5);
});

test("scoreRoute puts it together", () => {
  const sc = scoreRoute({ points: route }, { corridor, places: [], dest: { id: "d", wow: 1, ...destination(s, 90, 2000) } });
  assert.ok(sc.green > 0.4 && sc.busy > 0.3 && sc.nearMotorway === true);
  const noData = scoreRoute({ points: route }, { corridor: null, places: [], dest: { id: "d", wow: 1, ...s } });
  assert.equal(noData.green, null);
});

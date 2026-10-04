import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInPolygon, prepare, isRestricted, routeHitsRestricted } from "../js/restricted.js";
import { parseRestricted, joinRings, parseOverpass, fetchPlaces, cachedPlaces, isRestrictedTags } from "../js/places.js";
import { spikeRatio, loopVariants } from "../js/loop.js";
import { destination } from "../js/geo.js";

// A 2 km × 2 km military square east of the start.
const sq = [
  { lat: 49.79, lng: 17.45 },
  { lat: 49.79, lng: 17.48 },
  { lat: 49.81, lng: 17.48 },
  { lat: 49.81, lng: 17.45 },
  { lat: 49.79, lng: 17.45 },
];
const polys = prepare([sq]);

test("point in polygon", () => {
  assert.equal(pointInPolygon({ lat: 49.8, lng: 17.46 }, sq), true);
  assert.equal(pointInPolygon({ lat: 49.8, lng: 17.44 }, sq), false);
  assert.equal(isRestricted({ lat: 49.8, lng: 17.47 }, polys), true);
});

test("route through restricted land is detected, but not when only the ends touch it", () => {
  const through = Array.from({ length: 60 }, (_, i) => ({ lat: 49.8, lng: 17.43 + i * 0.001 }));
  assert.equal(routeHitsRestricted(through, polys), true);
  const around = Array.from({ length: 60 }, (_, i) => ({ lat: 49.785, lng: 17.43 + i * 0.001 }));
  assert.equal(routeHitsRestricted(around, polys), false);
  const endsInside = [{ lat: 49.8, lng: 17.4505 }, { lat: 49.8, lng: 17.44 }]; // starts 30 m inside
  assert.equal(routeHitsRestricted(endsInside, polys), false);
});

test("Overpass: restricted ways and multi-part relations, access=no places dropped", () => {
  const g = (p) => ({ lat: p.lat, lon: p.lng });
  const json = {
    elements: [
      { type: "way", id: 1, tags: { landuse: "military" }, geometry: sq.map(g) },
      {
        type: "relation", id: 2, tags: { military: "training_area" },
        members: [
          { type: "way", role: "outer", geometry: [g(sq[0]), g(sq[1]), g(sq[2])] },
          { type: "way", role: "outer", geometry: [g(sq[4]), g(sq[3]), g(sq[2])] }, // reversed half
          { type: "way", role: "inner", geometry: [g(sq[0]), g(sq[1])] },
        ],
      },
      { type: "way", id: 3, tags: { landuse: "farmland" }, geometry: sq.map(g) },
      { type: "node", id: 4, lat: 49.7, lon: 17.4, tags: { tourism: "viewpoint", access: "private" } },
      { type: "node", id: 5, lat: 49.7, lon: 17.41, tags: { tourism: "viewpoint" } },
    ],
  };
  const r = parseRestricted(json);
  assert.equal(r.length, 2);
  assert.equal(r[1].length, 5, "relation halves joined into one closed ring");
  assert.deepEqual(parseOverpass(json).map((p) => p.id), ["osm:node/5"]);
  assert.equal(isRestrictedTags({ landuse: "forest", access: "no" }), true);
  assert.equal(isRestrictedTags({ landuse: "forest" }), false);
  assert.equal(joinRings([[sq[0], sq[1]]]).length, 0, "open fragment is not a ring");
});

test("fetchPlaces races servers, uses the fastest, then serves from cache", async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const calls = [];
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      calls.push(url);
      const slow = url.includes("overpass-api.de");
      const timer = setTimeout(
        () => resolve({ ok: true, json: async () => ({ elements: [{ type: "node", id: slow ? 1 : 2, lat: 1, lon: 1, tags: { historic: "ruins", name: slow ? "slow" : "fast" } }] }) }),
        slow ? 300 : 10
      );
      signal.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("aborted"))));
    });
  const center = { lat: 49.8, lng: 17.4 };
  const t0 = Date.now();
  const r = await fetchPlaces(center, 3000, { fetchImpl, storage });
  assert.equal(r.places[0].name, "fast");
  assert.ok(Date.now() - t0 < 200, "didn't wait for the slow server");
  assert.equal(calls.length, 2);
  const again = await fetchPlaces({ lat: 49.801, lng: 17.401 }, 2900, { fetchImpl, storage });
  assert.equal(again.places[0].name, "fast");
  assert.equal(calls.length, 2, "second call came from the cache");
  assert.equal(cachedPlaces(center, 3000, { storage, now: Date.now() + 25 * 3600e3 }), null, "cache expires after a day");
});

test("fetchPlaces gives up after the timeout", async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  await assert.rejects(fetchPlaces({ lat: 10, lng: 10 }, 1000, { fetchImpl, storage: null, timeoutMs: 50 }));
});

test("spike ratio: clean loop ~0, out-and-back ~1, loop with a stub in between", () => {
  const s = { lat: 49.6, lng: 17.3 };
  const leg = (from, deg, m) => Array.from({ length: Math.round(m / 50) + 1 }, (_, i) => destination(from, deg, i * 50));
  // Square loop 1 km per side.
  const a = leg(s, 0, 1000), b = leg(a.at(-1), 90, 1000), c = leg(b.at(-1), 180, 1000), d = leg(c.at(-1), 270, 1000);
  const loop = [...a, ...b, ...c, ...d];
  assert.ok(spikeRatio(loop) < 0.05, `loop ${spikeRatio(loop)}`);
  const out = leg(s, 0, 2000);
  const outBack = [...out, ...out.slice().reverse()];
  assert.ok(spikeRatio(outBack) > 0.75, `out-and-back ${spikeRatio(outBack)}`);
  // Loop with a 600 m dead-end stub (there and back) in the middle of side b.
  const mid = b[10];
  const stub = leg(mid, 0, 600);
  const spiky = [...a, ...b.slice(0, 11), ...stub, ...stub.slice().reverse(), ...b.slice(11), ...c, ...d];
  const r = spikeRatio(spiky);
  assert.ok(r > 0.2 && r < 0.5, `stub ${r}`);
});

test("loop variants prefer a real second place off to the side", () => {
  const s = { lat: 49.6, lng: 17.3 };
  const place = { id: "a", ...destination(s, 0, 1500) };
  const side = { id: "b", ...destination(s, 70, 1200) };
  const behind = { id: "c", ...destination(s, 180, 1200) };
  const v = loopVariants(s, place, [place, side, behind]);
  assert.equal(v[0].viaPlace.id, "b");
  assert.equal(v.length, 5);
  assert.equal(loopVariants(s, place, [behind]).length, 4);
});

test("loop's second stop prefers the more interesting place", () => {
  const s = { lat: 49.6, lng: 17.3 };
  const place = { id: "a", wow: 1, ...destination(s, 0, 1500) };
  const park = { id: "park", wow: 0.3, ...destination(s, 70, 1200) };
  const spring = { id: "spring", wow: 0.55, ...destination(s, 60, 1100) };
  assert.equal(loopVariants(s, place, [park, spring])[0].viaPlace.id, "spring");
});

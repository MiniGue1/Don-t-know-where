import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, parseOverpass, fetchPlaces, mysterySpot, placeKind, wowScore, buildQuery } from "../js/places.js";
import { rankPlaces } from "../js/recommend.js";
import { destination } from "../js/geo.js";
import { distance } from "../js/geo.js";

test("nature-first kinds; cafés and roadside objects are not suggested", () => {
  assert.equal(placeKind({ man_made: "tower", "tower:type": "observation" }), "tower");
  assert.equal(placeKind({ man_made: "tower", "tower:type": "communication" }), null);
  assert.equal(placeKind({ natural: "waterfall" }), "waterfall");
  assert.equal(placeKind({ natural: "cave_entrance" }), "cave");
  assert.equal(placeKind({ natural: "rock" }), null, "unnamed boulder");
  assert.equal(placeKind({ natural: "rock", name: "Čertův kámen" }), "rocks");
  assert.equal(placeKind({ natural: "water", water: "river", name: "Morava" }), null);
  assert.equal(placeKind({ natural: "water", water: "pond", name: "Rybník" }), "lake");
  assert.equal(placeKind({ landuse: "quarry", name: "Lom" }), null, "active quarry");
  assert.equal(placeKind({ landuse: "quarry", name: "Lom", water: "yes" }), "quarry");
  assert.equal(placeKind({ natural: "tree", denotation: "natural_monument" }), "tree");
  assert.equal(placeKind({ amenity: "cafe", name: "Kavárna" }), null);
  assert.equal(placeKind({ historic: "wayside_cross", name: "Kříž" }), null);
  assert.equal(placeKind({ historic: "memorial", name: "Pomník" }), null);
  assert.equal(categorize({ tourism: "viewpoint" }), "views");
  assert.equal(categorize({ historic: "ruins" }), "history");
  assert.equal(categorize({ leisure: "park", name: "P" }), "nature");
});

test("wow: waterfalls and towers beat parks; Wikipedia and natural monuments add to it", () => {
  assert.ok(wowScore("waterfall", {}) > wowScore("park", { name: "P" }) + 0.5);
  assert.equal(wowScore("tree", {}), 0.5);
  assert.equal(wowScore("tree", { denotation: "natural_monument", name: "Lípa" }), 0.7);
  assert.equal(wowScore("waterfall", { wikidata: "Q1", name: "X", protect_class: "4" }), 1);
});

test("ranking: an interesting place wins and dull ones are only a fallback", () => {
  const from = { lat: 49.5, lng: 17 };
  const mk = (id, kind, wow, deg) => ({ id, name: id, kind, category: "nature", wow, named: true, ...destination(from, deg, 1300) });
  const places = [mk("park", "park", 0.35, 0), mk("tower", "tower", 1, 90), mk("picnic", "picnic", 0.3, 180)];
  for (let i = 0; i < 5; i++) {
    const { ranked } = rankPlaces({ places, from, mode: "walk", minutes: 45 });
    assert.equal(ranked[0].place.id, "tower");
    assert.ok(!ranked.some((r) => r.place.id === "picnic"), "picnic dropped while better exists");
  }
  const { ranked } = rankPlaces({ places: [mk("picnic", "picnic", 0.3, 0)], from, mode: "walk", minutes: 45 });
  assert.equal(ranked[0].place.id, "picnic", "used when it's the only option");
});

test("query is well-formed", () => {
  const q = buildQuery({ lat: 49.5, lng: 17 }, 3000);
  assert.equal((q.match(/\(/g) || []).length, (q.match(/\)/g) || []).length);
  assert.match(q, /tower:type"="observation"/);
  assert.doesNotMatch(q, /cafe/);
  for (const line of q.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("nwr") || l.startsWith("way") || l.startsWith("relation")))
    assert.ok(line.endsWith(";"), line);
});

test("parseOverpass handles nodes, ways (center) and duplicates", () => {
  const places = parseOverpass({
    elements: [
      { type: "node", id: 1, lat: 50, lon: 14, tags: { tourism: "viewpoint", name: "Lookout" } },
      { type: "way", id: 2, center: { lat: 50.01, lon: 14.01 }, tags: { leisure: "park", name: "Big Park" } },
      { type: "node", id: 6, lat: 50.03, lon: 14.03, tags: { amenity: "cafe", name: "Café" } },
      { type: "node", id: 3, lat: 50, lon: 14, tags: { tourism: "viewpoint", name: "Lookout" } },
      { type: "node", id: 4, lat: 50.02, lon: 14.02, tags: { shop: "bakery", name: "Ignored" } },
      { type: "way", id: 5, tags: { historic: "ruins" } },
    ],
  });
  assert.deepEqual(places.map((p) => p.id), ["osm:node/1", "osm:way/2"]);
  assert.equal(places[1].category, "nature");
  assert.equal(places[1].kind, "park");
  assert.ok(places[0].wow > places[1].wow);
});

test("fetchPlaces falls back to the second endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length === 1) throw new Error("down");
    return { ok: true, json: async () => ({ elements: [{ type: "node", id: 9, lat: 1, lon: 2, tags: { historic: "ruins", name: "M" } }] }) };
  };
  const { places } = await fetchPlaces({ lat: 1, lng: 2 }, 1000, { fetchImpl, storage: null });
  assert.equal(calls.length, 2);
  assert.equal(places[0].name, "M");
});

test("mystery spot lands near the requested distance", () => {
  const c = { lat: 50, lng: 14 };
  for (let i = 0; i < 20; i++) {
    const d = distance(c, mysterySpot(c, 1000));
    assert.ok(d >= 740 && d <= 1260, `got ${d}`);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, parseOverpass, fetchPlaces, mysterySpot } from "../js/places.js";
import { distance } from "../js/geo.js";

test("categorize OSM tags", () => {
  assert.equal(categorize({ tourism: "viewpoint" }), "views");
  assert.equal(categorize({ historic: "castle" }), "history");
  assert.equal(categorize({ tourism: "museum" }), "culture");
  assert.equal(categorize({ amenity: "cafe" }), "food");
  assert.equal(categorize({ leisure: "park" }), "nature");
  assert.equal(categorize({ tourism: "artwork" }), "quirky");
  assert.equal(categorize({ shop: "bakery" }), null);
});

test("parseOverpass handles nodes, ways (center) and duplicates", () => {
  const places = parseOverpass({
    elements: [
      { type: "node", id: 1, lat: 50, lon: 14, tags: { tourism: "viewpoint", name: "Lookout" } },
      { type: "way", id: 2, center: { lat: 50.01, lon: 14.01 }, tags: { leisure: "park", name: "Big Park" } },
      { type: "node", id: 3, lat: 50, lon: 14, tags: { tourism: "viewpoint", name: "Lookout" } },
      { type: "node", id: 4, lat: 50.02, lon: 14.02, tags: { shop: "bakery", name: "Ignored" } },
      { type: "way", id: 5, tags: { historic: "ruins" } },
    ],
  });
  assert.deepEqual(places.map((p) => p.id), ["osm:node/1", "osm:way/2"]);
  assert.equal(places[1].category, "nature");
});

test("fetchPlaces falls back to the second endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length === 1) throw new Error("down");
    return { ok: true, json: async () => ({ elements: [{ type: "node", id: 9, lat: 1, lon: 2, tags: { historic: "monument", name: "M" } }] }) };
  };
  const places = await fetchPlaces({ lat: 1, lng: 2 }, 1000, { fetchImpl });
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

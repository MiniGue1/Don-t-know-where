import { test } from "node:test";
import assert from "node:assert/strict";
import { directionsUrl, defaultProvider } from "../js/maplinks.js";

const a = { lat: 50.1, lng: 14.4 };
const b = { lat: 50.2, lng: 14.5 };

test("google maps link uses travel mode", () => {
  const u = new URL(directionsUrl("google", a, b, "bike"));
  assert.equal(u.hostname, "www.google.com");
  assert.equal(u.searchParams.get("travelmode"), "bicycling");
  assert.equal(u.searchParams.get("destination"), "50.200000,14.500000");
});

test("apple maps link", () => {
  const u = new URL(directionsUrl("apple", a, b, "walk"));
  assert.equal(u.hostname, "maps.apple.com");
  assert.equal(u.searchParams.get("mode"), "walking");
});

test("mapy.com link uses lon,lat order", () => {
  const u = new URL(directionsUrl("mapy", a, b, "moto"));
  assert.equal(u.hostname, "mapy.com");
  assert.equal(u.searchParams.get("end"), "14.500000,50.200000");
  assert.equal(u.searchParams.get("routeType"), "car_fast");
});

test("works without an origin", () => {
  assert.ok(!new URL(directionsUrl("google", null, b, "car")).searchParams.has("origin"));
});

test("default provider by platform", () => {
  assert.equal(defaultProvider("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), "apple");
  assert.equal(defaultProvider("Mozilla/5.0 (Linux; Android 15)"), "google");
});

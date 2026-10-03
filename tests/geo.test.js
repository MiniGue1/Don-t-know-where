import { test } from "node:test";
import assert from "node:assert/strict";
import { distance, destination, bearing, formatDistance, formatDuration } from "../js/geo.js";

const prague = { lat: 50.0875, lng: 14.4213 };

test("distance between known points", () => {
  const brno = { lat: 49.1951, lng: 16.6068 };
  assert.ok(Math.abs(distance(prague, brno) - 185000) < 3000);
});

test("destination is the inverse of distance/bearing", () => {
  const p = destination(prague, 73, 2500);
  assert.ok(Math.abs(distance(prague, p) - 2500) < 1);
  assert.ok(Math.abs(bearing(prague, p) - 73) < 0.5);
});

test("formatting", () => {
  assert.equal(formatDistance(420), "420 m");
  assert.equal(formatDistance(2345), "2.3 km");
  assert.equal(formatDuration(75), "1 min 15 s");
  assert.equal(formatDuration(3720), "1 h 2 min");
});

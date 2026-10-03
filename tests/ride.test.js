import { test } from "node:test";
import assert from "node:assert/strict";
import { curvature, rideScore, viaPoints, resample } from "../js/ride.js";
import { destination, pathLength } from "../js/geo.js";

const start = { lat: 46, lng: 11 };
const straight = Array.from({ length: 50 }, (_, i) => destination(start, 90, i * 200));
// zig-zag: alternate headings 45° / 135° every 150 m
const zig = [start];
for (let i = 1; i < 60; i++) zig.push(destination(zig[i - 1], i % 2 ? 45 : 135, 150));

test("resample spacing", () => {
  const r = resample(straight, 100);
  assert.ok(Math.abs(r.length - 99) <= 2, `${r.length}`);
  assert.ok(Math.abs(pathLength(r) - pathLength(straight)) < 5);
});

test("straight road has ~0 curvature, zig-zag is high", () => {
  assert.ok(curvature(straight) < 5);
  assert.ok(curvature(zig) > 200, `${curvature(zig)}`);
});

test("style scoring", () => {
  const twisty = { points: zig, distance: 9000, duration: 900 };
  const fast = { points: straight, distance: 9800, duration: 420 };
  assert.ok(rideScore(twisty, "twisty").score > rideScore(fast, "twisty").score);
  assert.ok(rideScore(fast, "straight").score > rideScore(twisty, "straight").score);
});

test("via points lie on the route", () => {
  const v = viaPoints(straight, 3);
  assert.equal(v.length, 3);
});

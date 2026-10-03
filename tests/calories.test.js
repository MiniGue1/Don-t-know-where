import { test } from "node:test";
import assert from "node:assert/strict";
import { metFor, tripCalories, keytelKcalPerMin } from "../js/calories.js";
import { formatSpeed } from "../js/modes.js";

test("MET interpolation", () => {
  assert.equal(metFor("walk", 4.8), 3.5);
  assert.ok(metFor("run", 10) > 9.8 && metFor("run", 10) < 11);
  assert.equal(metFor("moto", 80), 3.5);
});

test("a 30 min 5 km/h walk for a 70 kg person is ~120 kcal", () => {
  const kcal = tripCalories({ mode: "walk", avgSpeedKmh: 5, travelSec: 1800, dwellSec: 0 }, { weightKg: 70 });
  assert.ok(kcal > 110 && kcal < 140, `${kcal}`);
});

test("an hour of running at 10 km/h burns far more than walking", () => {
  const run = tripCalories({ mode: "run", avgSpeedKmh: 10, travelSec: 3600 }, { weightKg: 70 });
  assert.ok(run > 650 && run < 800, `${run}`);
});

test("heart rate formula is used when profile is complete", () => {
  assert.equal(keytelKcalPerMin(150, { weightKg: 70 }), null);
  const r = keytelKcalPerMin(150, { weightKg: 70, age: 30, sex: "m" });
  assert.ok(r > 10 && r < 16, `${r}`);
  const withHr = tripCalories({ mode: "run", avgSpeedKmh: 10, travelSec: 3600, avgHr: 150 }, { weightKg: 70, age: 30, sex: "m" });
  assert.ok(Math.abs(withHr - r * 60) < 2);
});

test("pace formatting for runners", () => {
  assert.deepEqual(formatSpeed("run", 12), { value: "5:00", unit: "min/km" });
  assert.deepEqual(formatSpeed("bike", 21.34), { value: "21.3", unit: "km/h" });
});

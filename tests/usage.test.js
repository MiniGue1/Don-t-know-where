import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyUsage, recordChoice, splitModes, usualChoice, favourite } from "../js/usage.js";

const ORDER = ["walk", "run", "bike", "moto", "car"];

test("defaults before any use", () => {
  const u = emptyUsage();
  assert.deepEqual(splitModes(u, ORDER), { top: ["walk", "run", "bike"], more: ["moto", "car"] });
  assert.equal(usualChoice(u), null);
  assert.equal(favourite(u, "walk", "length"), null);
});

test("frequent modes move to the front", () => {
  const u = emptyUsage();
  for (let i = 0; i < 3; i++) recordChoice(u, { mode: "moto", length: "long", option: "twisty" }, i);
  recordChoice(u, { mode: "car", length: "short" }, 10);
  const { top, more } = splitModes(u, ORDER);
  assert.deepEqual(top, ["moto", "car", "walk"]);
  assert.deepEqual(more, ["run", "bike"]);
});

test("usual choice needs two picks; recency breaks ties", () => {
  const u = emptyUsage();
  recordChoice(u, { mode: "walk", length: "short", option: "easy" }, 1);
  assert.equal(usualChoice(u), null);
  recordChoice(u, { mode: "walk", length: "short", option: "easy" }, 2);
  recordChoice(u, { mode: "car", length: "medium" }, 3);
  recordChoice(u, { mode: "car", length: "medium" }, 4);
  assert.deepEqual(usualChoice(u), { mode: "car", length: "medium", option: null, n: 2 });
});

test("favourite length and option per mode", () => {
  const u = emptyUsage();
  recordChoice(u, { mode: "run", length: "long", option: "hard" });
  recordChoice(u, { mode: "run", length: "long", option: "easy" });
  recordChoice(u, { mode: "run", length: "short", option: "easy" });
  assert.equal(favourite(u, "run", "length"), "long");
  assert.equal(favourite(u, "run", "option"), "easy");
  assert.equal(favourite(u, "bike", "length"), null);
});

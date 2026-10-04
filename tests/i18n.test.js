import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DICTS, t, setLang, detectLang } from "../js/i18n.js";
import { MODE_IDS, LENGTHS, DIFFICULTIES, RIDE_STYLES } from "../js/modes.js";
import { CATEGORY_IDS, KINDS } from "../js/places.js";
import { BOARDS } from "../js/leaderboard.js";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("English and Czech have the same keys, with plural arrays where expected", () => {
  const en = Object.keys(DICTS.en).sort();
  const cs = Object.keys(DICTS.cs).sort();
  assert.deepEqual(cs, en);
  for (const k of en) {
    assert.equal(Array.isArray(DICTS.cs[k]), Array.isArray(DICTS.en[k]), k);
    if (Array.isArray(DICTS.cs[k])) assert.equal(DICTS.cs[k].length, 3, `${k} needs 3 Czech plural forms`);
  }
});

test("every key used in code and HTML exists", () => {
  const used = new Set();
  const files = ["js/main.js", "js/app.js", ...readdirSync(new URL("js/ui/", root)).map((f) => `js/ui/${f}`), "js/ride.js", "js/recommend.js"];
  for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*"([\w.]+)"/g)) used.add(m[1]);
  for (const m of read("js/recommend.js").matchAll(/k: "([\w.]+)"/g)) used.add(m[1]);
  for (const m of read("js/ride.js").matchAll(/return "(twist\.\w+)"/g)) used.add(m[1]);
  const html = read("index.html");
  for (const m of html.matchAll(/data-i18n="([\w.]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(";")) used.add(pair.split(":")[1]);
  // Keys built from ids at runtime.
  MODE_IDS.forEach((id) => used.add(`mode.${id}`));
  Object.keys(LENGTHS).forEach((id) => used.add(`len.${id}`));
  Object.keys(DIFFICULTIES).forEach((id) => used.add(`diff.${id}`) && used.add(`diff.${id}.hint`));
  Object.keys(RIDE_STYLES).forEach((id) => used.add(`style.${id}`) && used.add(`style.${id}.hint`));
  CATEGORY_IDS.forEach((id) => used.add(`cat.${id}`));
  Object.keys(KINDS).forEach((id) => used.add(`kind.${id}`));
  Object.keys(BOARDS).forEach((id) => used.add(`board.${id}`) && used.add(`unit.${id}`));
  [0, 1, 2, 3].forEach((i) => used.add(`dir.${i}`));
  const missing = [...used].filter((k) => !(k in DICTS.en));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 150, `${used.size} keys`);
});

test("interpolation and Czech plurals", () => {
  setLang("cs");
  assert.equal(t("trip.madeIt", { name: "Hrad" }), "Jsi u cíle: Hrad");
  assert.equal(t("act.squares", { n: 1 }), "1 čtverec");
  assert.equal(t("act.squares", { n: 3 }), "3 čtverce");
  assert.equal(t("act.squares", { n: 12 }), "12 čtverců");
  setLang("en");
  assert.equal(t("act.squares", { n: 1 }), "1 square");
  assert.equal(t("act.squares", { n: 2 }), "2 squares");
  assert.equal(t("no.such.key"), "no.such.key");
});

test("language detection", () => {
  assert.equal(detectLang(["cs-CZ", "en"]), "cs");
  assert.equal(detectLang(["sk"]), "cs");
  assert.equal(detectLang(["de-DE"]), "en");
});

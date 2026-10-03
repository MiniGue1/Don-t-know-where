import { test } from "node:test";
import assert from "node:assert/strict";
import { newIdentity, myStats, encodeCard, decodeCard, extractCode, rankBoard, weekStart } from "../js/leaderboard.js";

const now = new Date(2026, 9, 8, 12).getTime(); // a Thursday

test("identity is fun and random", () => {
  const id = newIdentity();
  assert.match(id.name, /^\w+ \w+$/);
  assert.equal(id.id.length, 10);
});

test("week starts on Monday", () => {
  const d = new Date(weekStart(now));
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 5);
});

test("card round trip and link extraction (with unicode)", () => {
  const me = { id: "abc123", name: "Zvědavý Jezevec", avatar: "🦡" };
  const stats = myStats([{ mode: "run", distance: 5200, startedAt: now, arrived: true, place: { id: "p" } }], () => 300, now);
  assert.equal(stats.weekKm, 5.2);
  const code = encodeCard(me, stats, now);
  const card = decodeCard(extractCode(`https://x.github.io/app/#friend=${code}`));
  assert.equal(card.name, "Zvědavý Jezevec");
  assert.equal(card.stats.weekKcal, 300);
  assert.equal(card.stats.places, 1);
  assert.throws(() => decodeCard("bm9wZQ"));
});

test("ranking with ties and stale weekly cards", () => {
  const me = { id: "me", name: "Me", avatar: "🦦", stats: { weekKm: 10, places: 3, week: weekStart(now) } };
  const friends = [
    { id: "a", name: "A", avatar: "🦊", stats: { weekKm: 20, places: 3, week: weekStart(now) - 7 * 86400000 } },
    { id: "b", name: "B", avatar: "🐼", stats: { weekKm: 12, places: 9, week: weekStart(now) } },
  ];
  const wk = rankBoard("weekKm", me, friends, now);
  assert.deepEqual(wk.map((r) => [r.id, r.value, r.rank]), [["b", 12, 1], ["me", 10, 2], ["a", 0, 3]]);
  const pl = rankBoard("places", me, friends, now);
  assert.deepEqual(pl.map((r) => [r.id, r.rank]), [["b", 1], ["me", 2], ["a", 2]]);
});

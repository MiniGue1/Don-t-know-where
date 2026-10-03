import { test } from "node:test";
import assert from "node:assert/strict";
import { TripTracker } from "../js/tracker.js";
import { destination } from "../js/geo.js";

const start = { lat: 50, lng: 14 };
const place = { id: "p1", name: "Tower", kind: "tower", category: "views", ...destination(start, 90, 1000) };

/** Simulate walking east at `kmh`, one fix every 10 s, then standing at the place. */
function walk(tracker, kmh, t0, standSec) {
  const step = (kmh / 3.6) * 10;
  let t = t0;
  let events = [];
  for (let d = 0; d <= 1000; d += step) {
    events.push(tracker.addPoint({ ...destination(start, 90, d), t, accuracy: 5 }));
    t += 10000;
  }
  for (let s = 0; s < standSec; s += 10) {
    events.push(tracker.addPoint({ ...destination(start, 90, 1000 + (s % 20 ? 1 : 0)), t, accuracy: 5 }));
    t += 10000;
  }
  return { events: events.filter(Boolean), t };
}

test("detects arrival, measures speed and dwell time", () => {
  const t0 = 1_700_000_000_000;
  const tr = new TripTracker({ mode: "walk", place, startedAt: t0 });
  const { events, t } = walk(tr, 5, t0, 300);
  assert.deepEqual(events, ["arrived"]);
  const rec = tr.finish(t);
  assert.equal(rec.arrived, true);
  assert.ok(Math.abs(rec.avgSpeedKmh - 5) < 0.6, `speed ${rec.avgSpeedKmh}`);
  assert.ok(rec.dwellSec >= 290 && rec.dwellSec <= 340, `dwell ${rec.dwellSec}`);
  assert.ok(rec.distance > 900 && rec.distance < 1100);
});

test("ignores inaccurate fixes and GPS teleports", () => {
  const t0 = 0;
  const tr = new TripTracker({ mode: "walk", place, startedAt: t0 });
  tr.addPoint({ ...start, t: 1000, accuracy: 5 });
  tr.addPoint({ lat: 51, lng: 15, t: 2000, accuracy: 500 });
  tr.addPoint({ lat: 50.5, lng: 14.5, t: 3000, accuracy: 5 }); // ~65 km in 2 s
  assert.equal(tr.track.length, 1);
  assert.equal(tr.distance, 0);
});

test("manual arrival and round-trip through JSON", () => {
  const tr = new TripTracker({ mode: "bike", place, startedAt: 0 });
  tr.addPoint({ ...start, t: 1000 });
  tr.markArrived(60000);
  const back = TripTracker.fromJSON(JSON.parse(JSON.stringify(tr.toJSON())));
  const rec = back.finish(120000);
  assert.equal(rec.arrived, true);
  assert.equal(rec.travelSec, 60);
  assert.equal(rec.dwellSec, 60);
});

test("unfinished trip is still recorded", () => {
  const tr = new TripTracker({ mode: "walk", place, startedAt: 0 });
  tr.addPoint({ ...start, t: 0 });
  tr.addPoint({ ...destination(start, 90, 200), t: 120000 });
  const rec = tr.finish(120000);
  assert.equal(rec.arrived, false);
  assert.equal(rec.travelSec, null);
  assert.ok(rec.avgSpeedKmh > 5 && rec.avgSpeedKmh < 7);
});

test("time at the place counts even when the phone sent no fixes while standing still", () => {
  const tr = new TripTracker({ mode: "walk", place, startedAt: 0 });
  tr.addPoint({ ...destination(place, 270, 100), t: 0, accuracy: 5 });
  tr.addPoint({ ...place, t: 60000, accuracy: 5 }); // arrive
  // silence for 10 minutes, then the next fix is 100 m away
  tr.addPoint({ ...destination(place, 90, 100), t: 60000 + 600000 + 60000, accuracy: 5 });
  const rec = tr.finish(60000 + 600000 + 60000);
  assert.ok(rec.dwellSec > 600 && rec.dwellSec < 660, `dwell ${rec.dwellSec}`);
});

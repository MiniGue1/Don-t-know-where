import { test } from "node:test";
import assert from "node:assert/strict";
import { returnVia, loopStops, loopStraightLength } from "../js/loop.js";
import { distance, destination } from "../js/geo.js";
import { TripTracker } from "../js/tracker.js";
import { routeUrl } from "../js/routing.js";

const start = { lat: 50, lng: 14 };
const place = destination(start, 0, 2000); // 2 km north

test("return point is off to the side, so the way back differs", () => {
  const right = returnVia(start, place, 1);
  const left = returnVia(start, place, -1);
  assert.ok(right.lng > start.lng && left.lng < start.lng);
  assert.ok(Math.abs(distance(start, right) - Math.hypot(1000, 700)) < 20);
});

test("loop stops and length", () => {
  const stops = loopStops(start, place);
  assert.equal(stops.length, 4);
  assert.deepEqual(stops[3], start);
  const len = loopStraightLength(stops);
  assert.ok(len > 4000 && len < 5000, `${len}`);
});

test("route URL goes through every stop", () => {
  const url = routeUrl("foot", loopStops(start, place));
  assert.equal(url.split("foot/")[2].split("?")[0].split(";").length, 4);
});

test("tracker reports arriving and then getting back home", () => {
  const tr = new TripTracker({ mode: "walk", place, startedAt: 0, home: start });
  const events = [];
  let t = 0;
  const walk = (from, to, n) => {
    for (let i = 1; i <= n; i++) {
      t += 20000;
      const f = i / n;
      events.push(tr.addPoint({ lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f, t, accuracy: 5 }));
    }
  };
  tr.addPoint({ ...start, t: 0, accuracy: 5 }); // starting at home must not count as back home
  walk(start, place, 20);
  walk(place, start, 20);
  assert.deepEqual(events.filter(Boolean), ["arrived", "home"]);
  const rec = tr.finish(t);
  assert.equal(rec.loop, true);
  assert.ok(rec.homeAt > rec.arrivedAt);
  // Survives a reload mid-trip.
  const back = TripTracker.fromJSON(JSON.parse(JSON.stringify(new TripTracker({ mode: "walk", place, home: start }).toJSON())));
  assert.deepEqual(back.home, start);
});

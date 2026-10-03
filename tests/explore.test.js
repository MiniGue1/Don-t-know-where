import { test } from "node:test";
import assert from "node:assert/strict";
import { tileOf, squareBounds, squaresOfTrack, visitedSquares, exploredPercent, squaresAround, isNewSquare } from "../js/explore.js";
import { destination } from "../js/geo.js";

const prague = { lat: 50.0875, lng: 14.4213 };

test("tile maths round-trips", () => {
  const t = tileOf(prague.lat, prague.lng);
  const [[s, w], [n, e]] = squareBounds(t.x, t.y);
  assert.ok(prague.lat > s && prague.lat < n && prague.lng > w && prague.lng < e);
  assert.ok((n - s) * 111 > 0.2 && (n - s) * 111 < 0.6, "about 400 m");
});

test("long GPS gaps are filled in so no square is skipped", () => {
  const far = destination(prague, 90, 3000);
  const sparse = squaresOfTrack([[prague.lat, prague.lng], [far.lat, far.lng]]);
  assert.ok(sparse.size >= 6, `${sparse.size}`);
});

test("visited squares and explored percent", () => {
  const track = Array.from({ length: 30 }, (_, i) => {
    const p = destination(prague, 0, i * 100);
    return [p.lat, p.lng, i * 1000];
  });
  const visited = visitedSquares([{ track }, { arrived: true, place: destination(prague, 180, 2000) }]);
  assert.ok(visited.size >= 8);
  const pct = exploredPercent(visited, prague, 2);
  const total = squaresAround(prague, 2).length;
  assert.ok(total > 50);
  assert.ok(pct > 0 && pct < 50, `${pct}`);
  assert.equal(isNewSquare(visited, prague), false);
  assert.equal(isNewSquare(visited, destination(prague, 90, 1500)), true);
});

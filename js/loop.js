// Loops: go to a place and come back a different way.

import { bearing, destination, distance } from "./geo.js";

/**
 * A point to pass on the way back, offset to one side of the straight line
 * start → place, so the return leg doesn't retrace the way out.
 * side: 1 = right of the outbound direction, -1 = left.
 */
export function returnVia(start, place, side = 1, spread = 0.35) {
  const d = distance(start, place);
  const br = bearing(start, place);
  const mid = destination(start, br, d * 0.5);
  return destination(mid, br + 90 * side, d * spread);
}

/** Stops of a loop: start → place → via → start. */
export function loopStops(start, place, side = 1) {
  return [start, place, returnVia(start, place, side), start];
}

/** Rough loop length (m) from straight-line legs; real roads are longer. */
export function loopStraightLength(stops) {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += distance(stops[i - 1], stops[i]);
  return total;
}

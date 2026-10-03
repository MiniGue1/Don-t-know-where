// Route preview line from the public OSRM servers run by FOSSGIS
// (routing.openstreetmap.de). Falls back to a straight line if unreachable.

const PROFILE_URL = {
  foot: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
};

/** URL for a route through all `points` (2 or more). */
export function routeUrl(profile, points) {
  const base = PROFILE_URL[profile] || PROFILE_URL.foot;
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  return `${base}/${coords}?overview=full&geometries=geojson`;
}

/** Route from → to. Returns { points: [{lat,lng}], distance (m), duration (s) } or null. */
export function fetchRoute(profile, from, to, opts) {
  return fetchRouteVia(profile, [from, to], opts);
}

/** Route through several stops (e.g. a loop start → place → via → start). */
export async function fetchRouteVia(profile, points, { fetchImpl = fetch, signal } = {}) {
  try {
    const res = await fetchImpl(routeUrl(profile, points), { signal });
    if (!res.ok) return null;
    const json = await res.json();
    const r = json.routes?.[0];
    if (!r) return null;
    return {
      points: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distance: r.distance,
      duration: r.duration,
    };
  } catch {
    return null;
  }
}

// Route preview line from the public OSRM servers run by FOSSGIS
// (routing.openstreetmap.de). Falls back to a straight line if unreachable.

const PROFILE_URL = {
  foot: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
};

export function routeUrl(profile, from, to) {
  const base = PROFILE_URL[profile] || PROFILE_URL.foot;
  return `${base}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
}

/** Returns { points: [{lat,lng}], distance (m), duration (s) } or null. */
export async function fetchRoute(profile, from, to, { fetchImpl = fetch, signal } = {}) {
  try {
    const res = await fetchImpl(routeUrl(profile, from, to), { signal });
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

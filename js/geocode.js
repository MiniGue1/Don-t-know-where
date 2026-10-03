// Address search via OpenStreetMap Nominatim (free, no key; keep requests occasional).

/** Up to `limit` matches: [{ lat, lng, label }]. Biased toward `near` when given. */
export async function searchPlaces(query, { near, limit = 5, lang = "en", fetchImpl = globalThis.fetch } = {}) {
  const q = new URLSearchParams({ format: "json", limit: String(limit), q: query, "accept-language": lang });
  if (near) q.set("viewbox", `${near.lng - 1},${near.lat + 1},${near.lng + 1},${near.lat - 1}`);
  const res = await fetchImpl(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const hits = await res.json();
  return hits.map((h) => ({ lat: +h.lat, lng: +h.lon, label: shortLabel(h.display_name) }));
}

/** "Old Town Square, Old Town, Prague, 110 00, Czechia" → "Old Town Square, Old Town, Prague" */
export function shortLabel(name) {
  return String(name || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^\d[\d\s]*$/.test(s))
    .slice(0, 3)
    .join(", ");
}

/** First match or throws. */
export async function geocode(query, opts) {
  const [hit] = await searchPlaces(query, { ...opts, limit: 1 });
  if (!hit) throw new Error(query);
  return hit;
}

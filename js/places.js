// Finds interesting places nearby from OpenStreetMap via the Overpass API.

import { destination } from "./geo.js";

export const CATEGORIES = {
  nature: { id: "nature", label: "Nature", icon: "trees" },
  views: { id: "views", label: "Views", icon: "mountain" },
  history: { id: "history", label: "History", icon: "building-castle" },
  culture: { id: "culture", label: "Art & culture", icon: "palette" },
  food: { id: "food", label: "Food & drink", icon: "coffee" },
  quirky: { id: "quirky", label: "Hidden gems", icon: "sparkles" },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Overpass QL query for interesting things within `radius` metres of `center`. */
export function buildQuery(center, radius) {
  const a = `(around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)})`;
  return `[out:json][timeout:25];
(
  nwr["tourism"~"^(attraction|viewpoint|museum|gallery|artwork|picnic_site|zoo|theme_park)$"]${a};
  nwr["historic"]["name"]${a};
  nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]${a};
  nwr["natural"~"^(peak|waterfall|cave_entrance|beach|spring|cliff|rock)$"]${a};
  nwr["amenity"~"^(cafe|ice_cream|biergarten|fountain|marketplace)$"]["name"]${a};
  nwr["man_made"~"^(tower|lighthouse|windmill|watermill)$"]${a};
  nwr["waterway"="waterfall"]${a};
);
out center tags 300;`;
}

/** Decide which category an OSM tag set belongs to (or null if not interesting). */
export function categorize(tags = {}) {
  const t = tags;
  if (t.tourism === "viewpoint" || t.natural === "peak" || t.natural === "cliff") return "views";
  if (t.man_made === "tower" || t.man_made === "lighthouse") return "views";
  if (t.historic) return "history";
  if (t.man_made === "windmill" || t.man_made === "watermill") return "history";
  if (["museum", "gallery"].includes(t.tourism)) return "culture";
  if (t.tourism === "artwork" || t.amenity === "fountain") return "quirky";
  if (["cafe", "ice_cream", "biergarten", "marketplace"].includes(t.amenity)) return "food";
  if (t.leisure || t.natural || t.waterway === "waterfall" || t.tourism === "picnic_site") return "nature";
  if (["zoo", "theme_park"].includes(t.tourism)) return "culture";
  if (t.tourism === "attraction") return "quirky";
  return null;
}

function describe(tags) {
  const kind =
    tags.tourism || tags.historic || tags.leisure || tags.natural || tags.amenity || tags.man_made || tags.waterway || "place";
  return String(kind).replace(/_/g, " ");
}

/** Turn an Overpass JSON response into a de-duplicated list of places. */
export function parseOverpass(json) {
  const out = [];
  const seen = new Set();
  for (const el of json?.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const tags = el.tags || {};
    const category = categorize(tags);
    if (!category) continue;
    const name = tags.name || tags["name:en"];
    const kind = describe(tags);
    const title = name || kind.charAt(0).toUpperCase() + kind.slice(1);
    // Skip near-identical duplicates (same name, ~same spot).
    const key = `${title}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name: title,
      named: Boolean(name),
      kind,
      category,
      lat,
      lng,
      wikipedia: tags.wikipedia || null,
      website: tags.website || null,
    });
  }
  return out;
}

/** Fetch places around `center`. Throws if every endpoint fails. */
export async function fetchPlaces(center, radius, { fetchImpl = fetch, signal } = {}) {
  const body = new URLSearchParams({ data: buildQuery(center, radius) });
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchImpl(url, { method: "POST", body, signal });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return parseOverpass(await res.json());
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error("No Overpass endpoint reachable");
}

/**
 * A "mystery spot": a random point at roughly `dist` metres. Used when there
 * is nothing on the map nearby (or we're offline), so there is always somewhere to go.
 */
export function mysterySpot(center, dist, rand = Math.random) {
  const p = destination(center, rand() * 360, dist * (0.75 + rand() * 0.5));
  return {
    id: `mystery:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`,
    name: "Mystery spot",
    named: false,
    kind: "random point — see what's there",
    category: "quirky",
    mystery: true,
    lat: p.lat,
    lng: p.lng,
  };
}

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

/**
 * Overpass QL query for interesting things within `radius` metres of `center`,
 * plus restricted land (military / no access) with its outline so it can be avoided.
 */
export function buildQuery(center, radius) {
  const a = `(around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)})`;
  return `[out:json][timeout:10];
(
  nwr["tourism"~"^(attraction|viewpoint|museum|gallery|artwork|picnic_site|zoo|theme_park)$"]${a};
  nwr["historic"]["name"]${a};
  nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]${a};
  nwr["natural"~"^(peak|waterfall|cave_entrance|beach|spring|cliff|rock)$"]${a};
  nwr["amenity"~"^(cafe|ice_cream|biergarten|fountain|marketplace)$"]["name"]${a};
  nwr["man_made"~"^(tower|lighthouse|windmill|watermill)$"]${a};
  nwr["waterway"="waterfall"]${a};
);
out center tags 200;
(
  way["landuse"="military"]${a};
  relation["landuse"="military"]${a};
  way["military"~"^(training_area|danger_area|range|barracks|airfield)$"]${a};
  relation["military"~"^(training_area|danger_area|range|barracks|airfield)$"]${a};
  way["landuse"]["access"~"^(no|private)$"]${a};
);
out geom;`;
}

const RESTRICTED_MILITARY = /^(training_area|danger_area|range|barracks|airfield)$/;
export function isRestrictedTags(t = {}) {
  return t.landuse === "military" || RESTRICTED_MILITARY.test(t.military || "") || (Boolean(t.landuse) && /^(no|private)$/.test(t.access || ""));
}

const MAX_RING = 400;
const thin = (ring) => (ring.length <= MAX_RING ? ring : ring.filter((_, i) => i % Math.ceil(ring.length / MAX_RING) === 0));
const pt = (g) => ({ lat: +g.lat.toFixed(5), lng: +g.lon.toFixed(5) });
const same = (a, b) => a.lat === b.lat && a.lng === b.lng;

/** Join relation member ways (in any order/direction) into closed rings. */
export function joinRings(segments) {
  const rings = [];
  const open = segments.map((s) => s.slice()).filter((s) => s.length >= 2);
  while (open.length) {
    let ring = open.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const s = open[i];
        const end = ring[ring.length - 1];
        if (same(s[0], end)) ring = ring.concat(s.slice(1));
        else if (same(s[s.length - 1], end)) ring = ring.concat(s.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Restricted polygons (outer rings) from an Overpass response. */
export function parseRestricted(json) {
  const out = [];
  for (const el of json?.elements || []) {
    if (!isRestrictedTags(el.tags)) continue;
    if (el.type === "way" && el.geometry?.length >= 4) out.push(thin(el.geometry.map(pt)));
    else if (el.type === "relation" && el.members) {
      const outer = el.members.filter((m) => m.type === "way" && m.role !== "inner" && m.geometry?.length).map((m) => m.geometry.map(pt));
      for (const ring of joinRings(outer)) out.push(thin(ring));
    }
  }
  return out;
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
    if (/^(no|private)$/.test(tags.access || "")) continue;
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
      wikidata: tags.wikidata || null,
      image: tags.image || null,
      website: tags.website || null,
    });
  }
  return out;
}

/** Fetch places around `center`. Throws if every endpoint fails. */
// ---------------------------------------------------------------- fetching + cache

const CACHE_KEY = "dkw.places.v2";
const CACHE_TTL = 24 * 3600 * 1000;
const CACHE_MAX = 20;

/** Cache key: start rounded to ~1 km, radius in 1 km buckets. */
export const placesCacheKey = (center, radius) => `${center.lat.toFixed(2)},${center.lng.toFixed(2)},${Math.ceil(radius / 1000)}`;

function readCache(storage) {
  try {
    return JSON.parse(storage?.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

export function cachedPlaces(center, radius, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  const hit = readCache(storage)[placesCacheKey(center, radius)];
  return hit && now - hit.t < CACHE_TTL ? { places: hit.places, restricted: hit.restricted || [] } : null;
}

function writeCache(center, radius, data, storage, now) {
  try {
    const c = readCache(storage);
    c[placesCacheKey(center, radius)] = { t: now, ...data };
    const keys = Object.keys(c).sort((a, b) => c[a].t - c[b].t);
    while (keys.length > CACHE_MAX) delete c[keys.shift()];
    storage?.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    // Quota exceeded: caching is optional.
  }
}

const inflight = new Map();

/**
 * Places + restricted areas around `center`: { places, restricted }.
 * Uses the 24 h cache; otherwise asks every Overpass server at once and takes the
 * first good answer (public servers are often slow). Throws if none answers in time.
 */
export function fetchPlaces(center, radius, { fetchImpl = globalThis.fetch, storage = globalThis.localStorage, timeoutMs = 8000, now = Date.now() } = {}) {
  const cached = cachedPlaces(center, radius, { storage, now });
  if (cached) return Promise.resolve(cached);
  const key = placesCacheKey(center, radius);
  if (inflight.has(key)) return inflight.get(key);

  const body = new URLSearchParams({ data: buildQuery(center, radius) }).toString();
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());
  const timer = setTimeout(() => controllers.forEach((c) => c.abort()), timeoutMs);
  const attempts = OVERPASS_ENDPOINTS.map(async (url, i) => {
    const res = await fetchImpl(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controllers[i].signal,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const json = await res.json();
    if (json.remark && !json.elements?.length) throw new Error(json.remark); // server-side timeout
    return json;
  });
  const p = Promise.any(attempts)
    .then((json) => {
      controllers.forEach((c) => c.abort()); // stop the slower server
      const data = { places: parseOverpass(json), restricted: parseRestricted(json) };
      writeCache(center, radius, data, storage, now);
      return data;
    })
    .catch(() => {
      throw new Error("No Overpass server answered in time");
    })
    .finally(() => {
      clearTimeout(timer);
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
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

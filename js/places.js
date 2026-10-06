// Finds interesting places nearby from OpenStreetMap via the Overpass API.

import { destination } from "./geo.js";
import { t } from "./i18n.js";

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
  nwr["natural"~"^(peak|waterfall|cave_entrance|gorge|arch)$"]${a};
  nwr["natural"~"^(cliff|rock|stone|spring|beach|valley|wetland|water)$"]["name"]${a};
  nwr["natural"="tree"]["denotation"="natural_monument"]${a};
  nwr["natural"="tree"]["name"]${a};
  nwr["waterway"~"^(waterfall|rapids)$"]${a};
  nwr["tourism"="viewpoint"]${a};
  nwr["man_made"="tower"]["tower:type"="observation"]${a};
  nwr["leisure"="nature_reserve"]["name"]${a};
  nwr["boundary"="protected_area"]["name"]["protect_class"~"^(1|1a|1b|3|4)$"]${a};
  nwr["historic"~"^(castle|ruins|fort|archaeological_site|monastery)$"]${a};
  nwr["landuse"="quarry"]["name"]${a};
  nwr["tourism"~"^(attraction|picnic_site)$"]["name"]${a};
  nwr["leisure"~"^(park|garden)$"]["name"]${a};
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
export const thinRing = (ring) => (ring.length <= MAX_RING ? ring : ring.filter((_, i) => i % Math.ceil(ring.length / MAX_RING) === 0));
export const osmPt = (g) => ({ lat: +g.lat.toFixed(5), lng: +g.lon.toFixed(5) });
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
    if (el.type === "way" && el.geometry?.length >= 4) out.push(thinRing(el.geometry.map(osmPt)));
    else if (el.type === "relation" && el.members) {
      const outer = el.members.filter((m) => m.type === "way" && m.role !== "inner" && m.geometry?.length).map((m) => m.geometry.map(osmPt));
      for (const ring of joinRings(outer)) out.push(thinRing(ring));
    }
  }
  return out;
}

/**
 * What a place is (its "kind"), how it's grouped, and how worth the trip it is (wow, 0–1).
 * Nature first: waterfalls, lookout towers, caves and gorges beat parks; cafés and
 * roadside crosses are not suggested at all.
 */
export const KINDS = {
  waterfall: { category: "nature", wow: 1.0, icon: "droplets" },
  tower: { category: "views", wow: 1.0, icon: "tower" },
  cave: { category: "nature", wow: 0.95, icon: "bat" },
  gorge: { category: "nature", wow: 0.9, icon: "trekking" },
  viewpoint: { category: "views", wow: 0.9, icon: "binoculars" },
  peak: { category: "views", wow: 0.85, icon: "mountain" },
  rocks: { category: "views", wow: 0.85, icon: "mountain" },
  ruins: { category: "history", wow: 0.85, icon: "building-castle" },
  castle: { category: "history", wow: 0.8, icon: "building-castle" },
  quarry: { category: "nature", wow: 0.75, icon: "swimming" },
  rapids: { category: "nature", wow: 0.7, icon: "wave-sine" },
  reserve: { category: "nature", wow: 0.7, icon: "leaf" },
  lake: { category: "nature", wow: 0.65, icon: "ripple" },
  spring: { category: "nature", wow: 0.5, icon: "droplet" },
  tree: { category: "nature", wow: 0.5, icon: "tree" },
  beach: { category: "nature", wow: 0.5, icon: "beach" },
  wetland: { category: "nature", wow: 0.45, icon: "plant-2" },
  attraction: { category: "quirky", wow: 0.45, icon: "sparkles" },
  picnic: { category: "nature", wow: 0.3, icon: "campfire" },
  park: { category: "nature", wow: 0.3, icon: "trees" },
};

const STILL_WATER = /^(lake|pond|reservoir|oxbow|lagoon|basin)$/;

/** The kind of place for an OSM tag set, or null if it isn't worth suggesting. */
export function placeKind(t = {}) {
  const named = Boolean(t.name);
  if (t.natural === "waterfall" || t.waterway === "waterfall") return "waterfall";
  if (t.man_made === "tower" && t["tower:type"] === "observation") return "tower";
  if (t.natural === "cave_entrance") return "cave";
  if (t.natural === "gorge" || (t.natural === "valley" && named)) return "gorge";
  if (t.tourism === "viewpoint") return "viewpoint";
  if (t.natural === "peak") return "peak";
  if (t.natural === "arch" || (named && /^(cliff|rock|stone)$/.test(t.natural || ""))) return "rocks";
  if (/^(ruins|fort|archaeological_site)$/.test(t.historic || "")) return "ruins";
  if (/^(castle|monastery)$/.test(t.historic || "")) return "castle";
  if (t.landuse === "quarry" && named && (t.water || t.disused === "yes" || t.abandoned === "yes")) return "quarry";
  if (t.waterway === "rapids") return "rapids";
  if (named && (t.leisure === "nature_reserve" || t.boundary === "protected_area")) return "reserve";
  if (named && t.natural === "water" && (!t.water || STILL_WATER.test(t.water))) return "lake";
  if (named && t.natural === "spring") return "spring";
  if (t.natural === "tree" && (named || t.denotation === "natural_monument")) return "tree";
  if (named && t.natural === "beach") return "beach";
  if (named && t.natural === "wetland") return "wetland";
  if (named && t.tourism === "attraction") return "attraction";
  if (named && t.tourism === "picnic_site") return "picnic";
  if (named && /^(park|garden)$/.test(t.leisure || "")) return "park";
  return null;
}

/** How worth the trip a place is, 0–1. */
export function wowScore(kind, t = {}) {
  let w = KINDS[kind]?.wow ?? 0;
  if (t.wikipedia || t.wikidata) w += 0.15;
  if (t.denotation === "natural_monument" || t.protect_class || /památ|monument/i.test(t.protection_title || "")) w += 0.15;
  if (kind === "peak" && t.ele) w += 0.05;
  if (t.name) w += 0.05;
  return Math.min(1, +w.toFixed(3));
}

/** Category of an OSM tag set (kept for older callers). */
export function categorize(tags = {}) {
  const k = placeKind(tags);
  return k ? KINDS[k].category : null;
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
    const kind = placeKind(tags);
    if (!kind) continue;
    const name = tags.name || tags["name:en"];
    const title = name || t(`kind.${kind}`);
    // Skip near-identical duplicates (same name, ~same spot).
    const key = `${title}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name: title,
      named: Boolean(name),
      kind,
      category: KINDS[kind].category,
      wow: wowScore(kind, tags),
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

// ---------------------------------------------------------------- fetching + cache

const CACHE_KEY = "dkw.places.v3"; // v3: nature-first places with kind + wow
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
 * Run an Overpass query on every server at once and return the first good JSON answer
 * (public servers are often slow). Throws if none answers within `timeoutMs`.
 */
export function overpassRace(query, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const body = new URLSearchParams({ data: query }).toString();
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
  return Promise.any(attempts)
    .then((json) => {
      controllers.forEach((c) => c.abort()); // stop the slower server
      return json;
    })
    .catch(() => {
      throw new Error("No Overpass server answered in time");
    })
    .finally(() => clearTimeout(timer));
}

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

  const p = overpassRace(buildQuery(center, radius), { fetchImpl, timeoutMs })
    .then((json) => {
      const data = { places: parseOverpass(json), restricted: parseRestricted(json) };
      writeCache(center, radius, data, storage, now);
      return data;
    })
    .finally(() => inflight.delete(key));
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

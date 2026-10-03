// Photo + short description for a place, from Wikipedia / Wikidata / Wikimedia Commons.
// Free, no API key, CORS-enabled.

const CACHE_KEY = "dkw.wiki.v1";
const CACHE_MAX = 200;

/** "cs:Pražský hrad" → { lang: "cs", title: "Pražský hrad" } */
export function wikiFromTag(tag) {
  const m = String(tag || "").match(/^([a-z-]{2,12}):(.+)$/);
  return m ? { lang: m[1], title: m[2].trim() } : null;
}

/** Best sitelink from a Wikidata entity JSON, preferring `langs` in order. */
export function pickSitelink(json, qid, langs = ["cs", "en"]) {
  const links = json?.entities?.[qid]?.sitelinks || {};
  for (const l of langs) if (links[`${l}wiki`]) return { lang: l, title: links[`${l}wiki`].title };
  const any = Object.keys(links).find((k) => /^[a-z]{2,3}wiki$/.test(k));
  return any ? { lang: any.replace(/wiki$/, ""), title: links[any].title } : null;
}

/** Commons file name of the entity's main image (P18), or null. */
export function imageFromEntity(json, qid) {
  const v = json?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === "string" ? v : null;
}

export const commonsUrl = (file, width = 640) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/, ""))}?width=${width}`;

/** OSM `image` tag → safe image URL (Wikimedia only), or null. */
export function imageFromTag(tag) {
  const s = String(tag || "");
  if (/^File:/.test(s)) return commonsUrl(s);
  if (/^https:\/\/upload\.wikimedia\.org\//.test(s)) return s;
  return null;
}

/** First `n` sentences, capped in length. */
export function trimExtract(text, n = 2, maxLen = 240) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [t];
  let out = sentences.slice(0, n).join("").trim();
  if (out.length > maxLen) out = out.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  return out;
}

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveCache(c) {
  try {
    const keys = Object.keys(c);
    if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach((k) => delete c[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {}
}
let cache = null;
const inflight = new Map();

/**
 * { image, extract, url } for a place (any may be null), or null if nothing is known.
 * Only places with wikipedia / wikidata / image tags are looked up.
 */
export function placeInfo(place, lang = "en", fetchImpl = globalThis.fetch) {
  if (!place.wikipedia && !place.wikidata && !place.image) return Promise.resolve(null);
  cache ??= loadCache();
  const key = `${lang}|${place.id}`;
  if (key in cache) return Promise.resolve(cache[key]);
  if (inflight.has(key)) return inflight.get(key);
  const langs = lang === "cs" ? ["cs", "en"] : ["en", "cs"];
  const p = (async () => {
    let image = imageFromTag(place.image);
    let link = null;
    if (place.wikidata && /^Q\d+$/.test(place.wikidata)) {
      try {
        const res = await fetchImpl(`https://www.wikidata.org/wiki/Special:EntityData/${place.wikidata}.json`);
        if (res.ok) {
          const json = await res.json();
          link = pickSitelink(json, place.wikidata, langs);
          const file = imageFromEntity(json, place.wikidata);
          if (!image && file) image = commonsUrl(file);
        }
      } catch {}
    }
    if (!link) link = wikiFromTag(place.wikipedia);
    let extract = null;
    let url = null;
    if (link && /^[a-z-]{2,12}$/.test(link.lang)) {
      try {
        const res = await fetchImpl(
          `https://${link.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(link.title.replace(/ /g, "_"))}`
        );
        if (res.ok) {
          const s = await res.json();
          extract = trimExtract(s.extract) || null;
          url = s.content_urls?.mobile?.page || null;
          if (!image && s.thumbnail?.source?.startsWith("https://upload.wikimedia.org/")) image = s.thumbnail.source;
        }
      } catch {}
    }
    const info = image || extract ? { image, extract, url } : null;
    cache[key] = info;
    saveCache(cache);
    inflight.delete(key);
    return info;
  })();
  inflight.set(key, p);
  return p;
}

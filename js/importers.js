// Import routes and activities from other apps, entirely on-device.
//   GPX      – Mapy.com, Garmin Connect, Strava, AllTrails, Komoot, ...
//   TCX      – Garmin
//   KML      – Google My Maps / Google Earth
//   GeoJSON  – many tools
//   JSON     – Google Maps Timeline export (on-device "Timeline.json" or Takeout)
//   URL      – Google Maps directions links, Mapy.com point links
//
// Every parser returns a list of { name, kind: "activity" | "route", sport?, points: [{lat,lng,t?,ele?,hr?}] }.
// Plain regex parsing (no DOMParser) so the same code runs in the browser and in Node tests.

const decode = (s) =>
  String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i"));
  return m ? decode(m[1]) : null;
};
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
};
const num = (v) => (v == null || v === "" || isNaN(+v) ? undefined : +v);
const time = (v) => {
  if (!v) return undefined;
  const t = Date.parse(v);
  return isNaN(t) ? undefined : t;
};
const valid = (p) => isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

function finish(item) {
  item.points = item.points.filter(valid);
  const timed = item.points.filter((p) => p.t != null).length;
  item.kind = timed >= 2 && timed >= item.points.length * 0.8 ? "activity" : "route";
  return item;
}

const SPORT_FROM_TEXT = [
  [/run/i, "run"],
  [/walk|hik|foot/i, "walk"],
  [/cycl|bik|ride|bicycl/i, "bike"],
  [/motor/i, "moto"],
  [/driv|car|vehicle|passenger/i, "car"],
];
export function sportFromText(s) {
  if (!s) return undefined;
  for (const [re, sport] of SPORT_FROM_TEXT) if (re.test(s)) return sport;
  return undefined;
}

export function parseGpx(xml) {
  const name = tag(xml.replace(/<(trkpt|rtept|wpt)\b[\s\S]*?<\/\1>/gi, ""), "name") || "Imported route";
  const grab = (el) => {
    const out = [];
    const re = new RegExp(`<${el}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${el}>)`, "gi");
    let m;
    while ((m = re.exec(xml))) {
      const inner = m[2] || "";
      out.push({
        lat: num(attr(m[1], "lat")),
        lng: num(attr(m[1], "lon")),
        ele: num(tag(inner, "ele")),
        t: time(tag(inner, "time")),
        hr: num(tag(inner, "hr")),
      });
    }
    return out;
  };
  let points = grab("trkpt");
  if (!points.length) points = grab("rtept");
  if (!points.length) points = grab("wpt");
  return [finish({ name, sport: sportFromText(tag(xml, "type")), points })];
}

export function parseTcx(xml) {
  const sport = sportFromText(attr(xml.match(/<Activity\b([^>]*)>/i)?.[1] || "", "Sport"));
  const name = tag(xml, "Name") || tag(xml, "Notes") || "Garmin activity";
  const points = [];
  const re = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const tp = m[1];
    const lat = num(tag(tp, "LatitudeDegrees"));
    if (lat == null) continue;
    const hrBlock = tp.match(/<HeartRateBpm[^>]*>([\s\S]*?)<\/HeartRateBpm>/i);
    points.push({
      lat,
      lng: num(tag(tp, "LongitudeDegrees")),
      ele: num(tag(tp, "AltitudeMeters")),
      t: time(tag(tp, "Time")),
      hr: hrBlock ? num(tag(hrBlock[1], "Value")) : undefined,
    });
  }
  return [finish({ name, sport, points })];
}

export function parseKml(xml) {
  const items = [];
  const marks = xml.match(/<Placemark\b[\s\S]*?<\/Placemark>/gi) || [];
  const stops = [];
  for (const pm of marks) {
    const name = tag(pm, "name") || "Imported route";
    // gx:Track with timestamps
    const whens = [...pm.matchAll(/<when>([^<]+)<\/when>/gi)].map((x) => time(x[1]));
    const coords = [...pm.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/gi)].map((x) => x[1].trim().split(/\s+/).map(Number));
    if (coords.length) {
      items.push(finish({ name, points: coords.map(([lng, lat, ele], i) => ({ lat, lng, ele, t: whens[i] })) }));
      continue;
    }
    const raw = tag(pm, "coordinates");
    if (!raw) continue;
    const pts = raw
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => {
        const [lng, lat, ele] = c.split(",").map(Number);
        return { lat, lng, ele: isNaN(ele) ? undefined : ele };
      });
    if (/<Point\b/i.test(pm) && pts.length === 1) stops.push({ ...pts[0], name });
    else items.push(finish({ name, points: pts }));
  }
  if (!items.length && stops.length) items.push(finish({ name: tag(xml, "name") || "Imported places", points: stops }));
  return items;
}

export function parseGeoJson(json) {
  const feats = json.type === "FeatureCollection" ? json.features : json.type === "Feature" ? [json] : [{ geometry: json }];
  const items = [];
  const stops = [];
  for (const f of feats || []) {
    const g = f.geometry;
    if (!g) continue;
    const name = f.properties?.name || f.properties?.title || "Imported route";
    const times = f.properties?.coordTimes || f.properties?.coordinateProperties?.times;
    const toPts = (coords, tt) => coords.map(([lng, lat, ele], i) => ({ lat, lng, ele, t: time(tt?.[i]) }));
    if (g.type === "LineString") items.push(finish({ name, points: toPts(g.coordinates, times) }));
    else if (g.type === "MultiLineString") items.push(finish({ name, points: g.coordinates.flatMap((c, i) => toPts(c, times?.[i])) }));
    else if (g.type === "Point") stops.push({ lat: g.coordinates[1], lng: g.coordinates[0], name });
  }
  if (!items.length && stops.length) items.push(finish({ name: "Imported places", points: stops }));
  return items;
}

// "50.0874654°, 14.4212535°" or "geo:50.08,14.42"
const parseLatLngStr = (s) => {
  const m = String(s || "").match(/(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
};
const e7 = (o) => (o && o.latitudeE7 != null ? { lat: o.latitudeE7 / 1e7, lng: o.longitudeE7 / 1e7 } : null);

/** Google Maps Timeline: new on-device export (semanticSegments) and older Takeout (timelineObjects). */
export function parseGoogleTimeline(json) {
  const items = [];
  const segs = json.semanticSegments || (Array.isArray(json) ? json : null);
  if (segs) {
    // Raw paths are in separate segments; attach them to activities by time.
    const paths = segs.filter((s) => s.timelinePath).flatMap((s) =>
      s.timelinePath.map((p) => ({ ...parseLatLngStr(p.point), t: time(p.time) }))
    );
    for (const s of segs) {
      if (!s.activity) continue;
      const t0 = time(s.startTime);
      const t1 = time(s.endTime);
      const start = parseLatLngStr(s.activity.start?.latLng || s.activity.start);
      const end = parseLatLngStr(s.activity.end?.latLng || s.activity.end);
      const inner = paths.filter((p) => p.t >= t0 && p.t <= t1);
      const points = [start && { ...start, t: t0 }, ...inner, end && { ...end, t: t1 }].filter(Boolean);
      const type = s.activity.topCandidate?.type;
      items.push(finish({ name: `Timeline ${new Date(t0).toLocaleDateString()}`, sport: sportFromText(type), points }));
    }
  }
  for (const o of json.timelineObjects || []) {
    const a = o.activitySegment;
    if (!a) continue;
    const t0 = time(a.duration?.startTimestamp) ?? +a.duration?.startTimestampMs;
    const t1 = time(a.duration?.endTimestamp) ?? +a.duration?.endTimestampMs;
    let points = (a.simplifiedRawPath?.points || []).map((p) => ({
      lat: p.latE7 / 1e7,
      lng: p.lngE7 / 1e7,
      t: time(p.timestamp) ?? +p.timestampMs,
    }));
    if (!points.length) {
      const way = (a.waypointPath?.waypoints || []).map((w) => ({ lat: w.latE7 / 1e7, lng: w.lngE7 / 1e7 }));
      points = [{ ...e7(a.startLocation), t: t0 }, ...way, { ...e7(a.endLocation), t: t1 }];
    } else {
      points = [{ ...e7(a.startLocation), t: t0 }, ...points, { ...e7(a.endLocation), t: t1 }];
    }
    items.push(finish({ name: `Timeline ${new Date(t0).toLocaleDateString()}`, sport: sportFromText(a.activityType), points }));
  }
  return items.filter((i) => i.points.length >= 2);
}

/**
 * Google Maps / Mapy.com links. Returns { name, stops: [{lat,lng} | {query}] } or null.
 * Text stops (e.g. "Prague Castle") need geocoding, done by the caller.
 */
export function parseMapLink(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const stop = (s) => {
    s = decodeURIComponent(s.replace(/\+/g, " ")).trim();
    if (!s) return null;
    return parseLatLngStr(s) && /^-?\d/.test(s) ? parseLatLngStr(s) : { query: s };
  };

  if (/(^|\.)google\.[a-z.]+$/.test(host) && url.pathname.startsWith("/maps")) {
    const q = url.searchParams;
    if (q.get("api") === "1" || q.has("destination")) {
      const stops = [q.get("origin"), ...(q.get("waypoints") || "").split("|"), q.get("destination")]
        .filter(Boolean)
        .map(stop)
        .filter(Boolean);
      return stops.length ? { name: "Google Maps route", stops } : null;
    }
    const dir = url.pathname.match(/\/maps\/dir\/(.+)/);
    if (dir) {
      const stops = dir[1]
        .split("/")
        .filter((s) => s && !s.startsWith("@") && !s.startsWith("data="))
        .map(stop)
        .filter(Boolean);
      return stops.length ? { name: "Google Maps route", stops } : null;
    }
    const at = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const place = url.pathname.match(/\/maps\/place\/([^/]+)/);
    if (at) return { name: place ? decodeURIComponent(place[1].replace(/\+/g, " ")) : "Google Maps place", stops: [{ lat: +at[1], lng: +at[2] }] };
    if (q.get("q")) return { name: "Google Maps place", stops: [stop(q.get("q"))] };
    return null;
  }
  if (/(^|\.)mapy\.(com|cz)$/.test(host)) {
    const x = num(url.searchParams.get("x"));
    const y = num(url.searchParams.get("y"));
    if (x != null && y != null) return { name: "Mapy.com place", stops: [{ lat: y, lng: x }] };
    return null;
  }
  return null;
}

/** Detect the format of a file's text and parse it. */
export function parseFile(fileName, text) {
  const lower = fileName.toLowerCase();
  const head = text.slice(0, 2000);
  if (lower.endsWith(".gpx") || /<gpx\b/i.test(head)) return parseGpx(text);
  if (lower.endsWith(".tcx") || /<TrainingCenterDatabase\b/i.test(head)) return parseTcx(text);
  if (lower.endsWith(".kml") || /<kml\b/i.test(head)) return parseKml(text);
  if (/\.(geo)?json$/.test(lower) || /^\s*[[{]/.test(head)) {
    const json = JSON.parse(text);
    if (json.semanticSegments || json.timelineObjects || (Array.isArray(json) && json[0]?.startTime)) return parseGoogleTimeline(json);
    return parseGeoJson(json);
  }
  if (lower.endsWith(".kmz") || lower.endsWith(".fit"))
    throw new Error("That's a compressed/binary file. Export as GPX (or KML) and import that instead.");
  throw new Error("Unrecognised file. Supported: GPX, TCX, KML, GeoJSON, Google Timeline JSON.");
}

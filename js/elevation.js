// Elevation lookups (Open-Meteo, free, no key) and climb math.

const URL_BASE = "https://api.open-meteo.com/v1/elevation";

/** Elevations (m) for up to 100 points per request. Returns null on failure. */
export async function fetchElevations(points, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!points.length) return [];
  const ctrl = new AbortController();
  const signal = ctrl.signal;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const out = [];
    for (let i = 0; i < points.length; i += 100) {
      const chunk = points.slice(i, i + 100);
      const q = new URLSearchParams({
        latitude: chunk.map((p) => p.lat.toFixed(5)).join(","),
        longitude: chunk.map((p) => p.lng.toFixed(5)).join(","),
      });
      const res = await fetchImpl(`${URL_BASE}?${q}`, { signal });
      if (!res.ok) return null;
      const json = await res.json();
      out.push(...json.elevation);
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Total ascent from a list of elevations, ignoring wobble smaller than `noise` metres. */
export function elevationGain(elevations, noise = 3) {
  let gain = 0;
  let ref = null;
  for (const e of elevations) {
    if (e == null || !isFinite(e)) continue;
    if (ref == null) ref = e;
    else if (e - ref >= noise) {
      gain += e - ref;
      ref = e;
    } else if (ref - e >= noise) ref = e;
  }
  return Math.round(gain);
}

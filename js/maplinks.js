// Deep links that hand navigation off to a real maps app.

const ll = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
const lonlat = (p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

const GOOGLE_MODE = { run: "walking", walk: "walking", bike: "bicycling", moto: "driving", car: "driving" };
const APPLE_MODE = { run: "walking", walk: "walking", bike: "cycling", moto: "driving", car: "driving" };
const MAPY_MODE = { run: "foot_fast", walk: "foot_fast", bike: "bike_road", moto: "car_fast", car: "car_fast" };

export const PROVIDERS = {
  google: { id: "google", label: "Google Maps" },
  apple: { id: "apple", label: "Apple Maps" },
  mapy: { id: "mapy", label: "Mapy.com" },
};

/**
 * Build a directions URL for `provider` from `from` to `to` using travel `mode`.
 * `via` points make Google Maps and Mapy.com follow a specific route (e.g. twisties).
 * Apple Maps' URL scheme has no waypoints, so it only gets the destination.
 */
export function directionsUrl(provider, from, to, mode, via = []) {
  switch (provider) {
    case "google": {
      const q = new URLSearchParams({
        api: "1",
        destination: ll(to),
        travelmode: GOOGLE_MODE[mode] || "walking",
      });
      if (from) q.set("origin", ll(from));
      if (via.length) q.set("waypoints", via.map(ll).join("|"));
      return `https://www.google.com/maps/dir/?${q}`;
    }
    case "apple": {
      const q = new URLSearchParams({
        destination: ll(to),
        mode: APPLE_MODE[mode] || "walking",
      });
      if (from) q.set("source", ll(from));
      return `https://maps.apple.com/directions?${q}`;
    }
    case "mapy": {
      const q = new URLSearchParams({
        mapset: ["walk", "run", "bike"].includes(mode) ? "outdoor" : "basic",
        end: lonlat(to),
        routeType: MAPY_MODE[mode] || "foot_fast",
      });
      if (from) q.set("start", lonlat(from));
      if (via.length) q.set("waypoints", via.map(lonlat).join(";"));
      return `https://mapy.com/fnc/v1/route?${q}`;
    }
    default:
      throw new Error(`Unknown maps provider: ${provider}`);
  }
}

/** Sensible default provider for the current device. */
export function defaultProvider(userAgent = "") {
  return /iPhone|iPad|iPod|Macintosh/.test(userAgent) ? "apple" : "google";
}

// Offline support: the app shell is cached; map tiles and place lookups always go to the network.
const CACHE = "dkw-v3";
const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "js/app.js",
  "js/calories.js",
  "js/charts.js",
  "js/elevation.js",
  "js/geo.js",
  "js/gpx.js",
  "js/hrm.js",
  "js/icons.js",
  "js/importers.js",
  "js/leaderboard.js",
  "js/main.js",
  "js/maplinks.js",
  "js/modes.js",
  "js/places.js",
  "js/recommend.js",
  "js/ride.js",
  "js/routing.js",
  "js/stats.js",
  "js/store.js",
  "js/tracker.js",
  "js/usage.js",
  "js/ui/activity.js",
  "js/ui/go.js",
  "js/ui/me.js",
  "js/ui/ranks.js",
  "js/ui/recap.js",
  "js/ui/trip.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Network first so updates show up; fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

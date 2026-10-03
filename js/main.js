// UI wiring: map, screens, GPS, and the trip lifecycle.

import { MODES, MODE_IDS } from "./modes.js";
import { CATEGORIES, CATEGORY_IDS, fetchPlaces, mysterySpot } from "./places.js";
import { rankPlaces, surprisePick, searchRadius, DETOUR_FACTOR } from "./recommend.js";
import { fetchRoute } from "./routing.js";
import { directionsUrl, defaultProvider, PROVIDERS } from "./maplinks.js";
import { personalSpeed, interestProfile, records } from "./stats.js";
import { TripTracker } from "./tracker.js";
import { createStore } from "./store.js";
import { distance, formatDistance, formatDuration } from "./geo.js";

const L = window.L;
const store = createStore();
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const TIME_OPTIONS = [15, 30, 60, 120, 240];

const settings = store.getSettings({
  mode: "walk",
  minutes: 30,
  interests: [],
  provider: defaultProvider(navigator.userAgent),
  lastPosition: null,
});
const saveSettings = () => store.saveSettings(settings);

const state = {
  position: null, // { lat, lng, accuracy }
  gpsOk: false,
  results: [],
  markers: [],
  selected: null,
  placeCache: new Map(),
  trip: null,
  wakeLock: null,
  view: "explore",
};

// ---------------------------------------------------------------- map

const map = L.map("map", { zoomControl: false, attributionControl: true }).setView(
  settings.lastPosition ? [settings.lastPosition.lat, settings.lastPosition.lng] : [48.5, 10],
  settings.lastPosition ? 14 : 4
);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const layers = {
  me: null,
  places: L.layerGroup().addTo(map),
  route: L.layerGroup().addTo(map),
  track: L.layerGroup().addTo(map),
};

const pinIcon = (category, selected = false) =>
  L.divIcon({
    className: "",
    html: `<div class="pin${selected ? " selected" : ""}"><span>${CATEGORIES[category]?.icon || "📍"}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });

function drawMe() {
  if (!state.position) return;
  const ll = [state.position.lat, state.position.lng];
  if (!layers.me) {
    layers.me = L.marker(ll, {
      icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 1000,
      interactive: false,
    }).addTo(map);
  } else layers.me.setLatLng(ll);
}

function fitTo(points) {
  const pts = points.filter(Boolean).map((p) => [p.lat, p.lng]);
  if (!pts.length) return;
  const bottomPad = Math.min(window.innerHeight * 0.62, 480) + 70;
  const desktop = window.innerWidth >= 900;
  map.fitBounds(L.latLngBounds(pts), {
    paddingTopLeft: [desktop ? 460 : 40, 70],
    paddingBottomRight: [40, desktop ? 70 : bottomPad],
    maxZoom: 17,
  });
}

async function drawRoute(place, mode) {
  layers.route.clearLayers();
  if (!state.position) return;
  const from = state.position;
  // Straight dashed line immediately, real route when it arrives.
  const straight = L.polyline([[from.lat, from.lng], [place.lat, place.lng]], {
    color: "#0f766e",
    weight: 3,
    dashArray: "6 8",
    opacity: 0.7,
  }).addTo(layers.route);
  const route = await fetchRoute(MODES[mode].routingProfile, from, place);
  const stillWanted = state.selected?.place.id === place.id || state.trip?.place.id === place.id;
  if (!route || !stillWanted) return;
  layers.route.removeLayer(straight);
  L.polyline(route.points.map((p) => [p.lat, p.lng]), { color: "#0f766e", weight: 5, opacity: 0.85 }).addTo(layers.route);
}

// ---------------------------------------------------------------- utilities

let toastTimer;
function toast(msg, ms = 2800) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function showView(name) {
  state.view = name;
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelector(`.view[data-view="${name}"]`)?.classList.remove("collapsed");
  layers.track.clearLayers();
  if (name === "history") renderHistory();
  if (name === "me") renderMe();
  if (state.trip && name !== "history") drawTripLayers();
}

/** Destination pin + recorded track of the trip in progress. */
function drawTripLayers() {
  const t = state.trip;
  if (!t) return;
  layers.track.clearLayers();
  L.marker([t.place.lat, t.place.lng], { icon: pinIcon(t.place.category, true) }).addTo(layers.track);
  if (t.track.length > 1)
    L.polyline(t.track.map((q) => [q.lat, q.lng]), { color: "#2563eb", weight: 4 }).addTo(layers.track);
}

// ---------------------------------------------------------------- explore form

function renderPickers() {
  const history = store.getHistory();
  $("#mode-picker").innerHTML = MODE_IDS.map(
    (id) =>
      `<button type="button" role="radio" data-mode="${id}" aria-checked="${settings.mode === id}"><span>${MODES[id].icon}</span>${MODES[id].label}</button>`
  ).join("");
  $("#time-picker").innerHTML = TIME_OPTIONS.map(
    (m) =>
      `<button type="button" role="radio" data-min="${m}" aria-checked="${settings.minutes === m}">${m < 60 ? `${m} min` : `${m / 60} h`}</button>`
  ).join("");
  $("#interest-picker").innerHTML = CATEGORY_IDS.map(
    (c) =>
      `<button type="button" data-cat="${c}" aria-pressed="${settings.interests.includes(c)}">${CATEGORIES[c].icon} ${CATEGORIES[c].label}</button>`
  ).join("");
  const speed = personalSpeed(history, settings.mode);
  const learnedFrom = history.filter((t) => t.mode === settings.mode && t.arrived).length;
  $("#suggest-btn").title = `Planning with ${speed.toFixed(1)} km/h${learnedFrom ? " (your pace)" : ""}`;
}

$("#mode-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  settings.mode = b.dataset.mode;
  saveSettings();
  renderPickers();
});
$("#time-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-min]");
  if (!b) return;
  settings.minutes = +b.dataset.min;
  saveSettings();
  renderPickers();
});
$("#interest-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  const c = b.dataset.cat;
  settings.interests = settings.interests.includes(c)
    ? settings.interests.filter((x) => x !== c)
    : [...settings.interests, c];
  saveSettings();
  renderPickers();
});

// ---------------------------------------------------------------- suggestions

async function loadCandidates(from, radius) {
  const key = `${from.lat.toFixed(3)},${from.lng.toFixed(3)},${Math.round(radius / 500)}`;
  if (state.placeCache.has(key)) return state.placeCache.get(key);
  const places = await fetchPlaces(from, radius);
  state.placeCache.set(key, places);
  return places;
}

async function suggest(surprise) {
  if (!state.position) {
    toast("Need your location first — allow GPS or tap the map to set a start point.");
    return;
  }
  const btns = [$("#suggest-btn"), $("#list-btn")];
  btns.forEach((b) => (b.disabled = true));
  $("#suggest-btn").textContent = "Looking around…";
  const history = store.getHistory();
  const from = { ...state.position };
  const speed = personalSpeed(history, settings.mode);
  const radius = searchRadius(settings.minutes, speed);

  let places = [];
  let offline = false;
  try {
    places = await loadCandidates(from, radius);
  } catch {
    offline = true;
  }
  const { ranked } = rankPlaces({
    places,
    from,
    mode: settings.mode,
    minutes: settings.minutes,
    interests: settings.interests,
    history,
  });

  // There is always somewhere to go: add a mystery spot at a good distance.
  const mysteryDist = (((speed * settings.minutes * 0.35) / 60) * 1000) / DETOUR_FACTOR;
  const mystery = mysterySpot(from, mysteryDist);
  const mysteryEntry = {
    place: mystery,
    score: 0,
    distance: distance(from, mystery),
    estMinutes: Math.max(1, Math.round(settings.minutes * 0.35)),
    isNew: true,
    reasons: ["a random point — pure adventure"],
  };

  let list;
  if (surprise && ranked.length) {
    const pick = surprisePick(ranked);
    list = [pick, ...ranked.filter((r) => r !== pick).slice(0, 4), mysteryEntry];
  } else {
    list = [...ranked.slice(0, 8), mysteryEntry];
  }
  if (!ranked.length) list = [mysteryEntry];

  state.results = list;
  $("#results-meta").textContent = offline
    ? "Offline — mystery spot only"
    : `${ranked.length} places fit · ${speed.toFixed(1)} km/h`;
  if (offline) toast("Couldn't reach the map service — here's a mystery spot instead.");
  else if (!ranked.length) toast("Nothing mapped nearby fits — try more time or another mode.");

  btns.forEach((b) => (b.disabled = false));
  $("#suggest-btn").textContent = "🎲 Surprise me";
  $("#explore-form").hidden = true;
  $("#results").hidden = false;
  renderResults();
  selectResult(0);
}

function renderResults() {
  layers.places.clearLayers();
  state.markers = [];
  $("#result-list").innerHTML = state.results
    .map((r, i) => {
      const p = r.place;
      const cat = CATEGORIES[p.category];
      return `<div class="card" data-i="${i}">
        <div class="card-top">
          <span class="card-icon">${p.mystery ? "❓" : cat.icon}</span>
          <div class="grow">
            <h3>${esc(p.name)}${r.isNew ? '<span class="badge">NEW</span>' : ""}</h3>
            <div class="meta">${esc(p.kind)} · ${formatDistance(r.distance)} away · ~${r.estMinutes} min ${MODES[settings.mode].icon}</div>
            ${r.reasons.length ? `<div class="why">${esc(r.reasons.join(" · "))}</div>` : ""}
          </div>
        </div>
        <div class="actions">
          <button type="button" class="btn primary grow" data-go="${i}">Let's go</button>
        </div>
      </div>`;
    })
    .join("");
  state.markers = state.results.map((r, i) =>
    L.marker([r.place.lat, r.place.lng], { icon: pinIcon(r.place.category) })
      .on("click", () => selectResult(i, true))
      .addTo(layers.places)
  );
}

function selectResult(i, scroll = false) {
  const r = state.results[i];
  if (!r) return;
  state.selected = r;
  document.querySelectorAll("#result-list .card").forEach((c) => c.classList.toggle("selected", +c.dataset.i === i));
  state.markers.forEach((m, j) => {
    m.setIcon(pinIcon(state.results[j].place.category, j === i));
    m.setZIndexOffset(j === i ? 500 : 0);
  });
  if (scroll) document.querySelector(`#result-list .card[data-i="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  fitTo([state.position, r.place]);
  drawRoute(r.place, settings.mode);
}

$("#result-list").addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) return startTrip(state.results[+go.dataset.go].place);
  const card = e.target.closest(".card");
  if (card) selectResult(+card.dataset.i);
});
$("#suggest-btn").addEventListener("click", () => suggest(true));
$("#list-btn").addEventListener("click", () => suggest(false));
$("#back-btn").addEventListener("click", () => {
  state.results = [];
  state.selected = null;
  layers.places.clearLayers();
  layers.route.clearLayers();
  $("#results").hidden = true;
  $("#explore-form").hidden = false;
});

// ---------------------------------------------------------------- trips

function startTrip(place) {
  if (state.trip && !confirm("You already have a trip running. Replace it?")) return;
  state.trip = new TripTracker({ mode: settings.mode, place });
  if (state.position && state.gpsOk) {
    state.trip.addPoint({ ...state.position, t: Date.now() });
  }
  store.saveActiveTrip(state.trip.toJSON());
  layers.places.clearLayers();
  state.results = [];
  $("#results").hidden = true;
  $("#explore-form").hidden = false;
  showView("trip");
  renderTrip();
  drawRoute(place, state.trip.mode);
  fitTo([state.position, place]);
  requestWakeLock();
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

function renderTrip() {
  const t = state.trip;
  $("#tab-trip").classList.toggle("live", Boolean(t));
  if (!t) return;
  const p = t.place;
  $("#trip-place").textContent = p.name;
  $("#trip-kind").textContent = `${p.kind} · ${MODES[t.mode].icon} ${MODES[t.mode].label}`;
  $("#trip-icon").textContent = p.mystery ? "❓" : CATEGORIES[p.category]?.icon || "📍";
  const status = $("#trip-status");
  status.textContent = t.arrived ? "You're there 🎉" : "On the way";
  status.classList.toggle("arrived", t.arrived);

  const now = Date.now();
  const rem = state.position ? distance(state.position, p) : t.remaining();
  $("#trip-remaining").textContent = t.arrived ? "✓" : rem != null ? formatDistance(rem) : "–";
  const travelSec = ((t.arrivedAt ?? now) - t.startedAt) / 1000;
  $("#trip-elapsed").textContent = formatDuration((now - t.startedAt) / 1000);
  const dist = t.arrived ? t.distanceToArrival : t.distance;
  $("#trip-speed").textContent = travelSec > 5 && dist > 0 ? ((dist / travelSec) * 3.6).toFixed(1) : "–";
  const dwell = t.arrived ? t.dwellSec + (t._lastNear != null ? (now - t._lastNear) / 1000 : 0) : null;
  $("#trip-dwell").textContent = dwell == null ? "–" : formatDuration(dwell);
  $("#here-btn").hidden = t.arrived;

  const from = state.position;
  const providers = [settings.provider, ...Object.keys(PROVIDERS).filter((x) => x !== settings.provider)];
  $("#nav-links").innerHTML = providers
    .map(
      (id, i) =>
        `<a class="btn${i === 0 ? " primary" : ""}" target="_blank" rel="noopener" href="${esc(directionsUrl(id, from, p, t.mode))}">${PROVIDERS[id].label}</a>`
    )
    .join("");
}

let lastPersist = 0;
function onTripFix(fix) {
  const t = state.trip;
  if (!t) return;
  const ev = t.addPoint(fix);
  if (ev === "arrived") announceArrival();
  if (Date.now() - lastPersist > 5000 || ev) {
    store.saveActiveTrip(t.toJSON());
    lastPersist = Date.now();
  }
  if (state.view !== "history") drawTripLayers();
}

function announceArrival() {
  const name = state.trip.place.name;
  toast(`You made it to ${name}! Time there is being recorded.`, 4000);
  navigator.vibrate?.([120, 60, 120]);
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    try {
      new Notification("You've arrived", { body: name, icon: "icons/icon-192.png" });
    } catch {}
  }
  renderTrip();
}

$("#here-btn").addEventListener("click", () => {
  if (!state.trip) return;
  state.trip.markArrived(Date.now());
  store.saveActiveTrip(state.trip.toJSON());
  announceArrival();
});

$("#finish-btn").addEventListener("click", () => {
  const t = state.trip;
  if (!t) return;
  const rec = t.finish(Date.now());
  store.addTrip(rec);
  endTrip();
  toast(rec.arrived ? `Saved: ${rec.place.name}` : "Saved (didn't reach it this time)");
  showView("history");
  showTripOnMap(rec);
});

$("#cancel-trip-btn").addEventListener("click", () => {
  if (!state.trip || !confirm("Discard this trip without saving?")) return;
  endTrip();
  showView("explore");
});

function endTrip() {
  state.trip = null;
  store.saveActiveTrip(null);
  layers.route.clearLayers();
  layers.places.clearLayers();
  layers.track.clearLayers();
  releaseWakeLock();
  renderTrip();
}

async function requestWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock?.request("screen");
  } catch {}
}
function releaseWakeLock() {
  state.wakeLock?.release?.().catch(() => {});
  state.wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.trip) {
    requestWakeLock();
    renderTrip();
  }
});

setInterval(() => {
  if (state.trip && state.view === "trip") renderTrip();
}, 1000);

// ---------------------------------------------------------------- history

function renderHistory() {
  const history = store.getHistory();
  const r = records(history);
  $("#history-summary").innerHTML = [
    [r.trips, "outings"],
    [r.placesVisited, "places"],
    [formatDistance(r.totalDistance), "travelled"],
    [`${r.streakDays}🔥`, "day streak"],
  ]
    .map(([v, l]) => `<div class="stat"><span class="stat-v">${v}</span><span class="stat-l">${l}</span></div>`)
    .join("");

  if (!history.length) {
    $("#history-list").innerHTML = `<div class="empty">No outings yet.<br/>Hit <b>Surprise me</b> on Explore and go somewhere new.</div>`;
    return;
  }
  $("#history-list").innerHTML = history
    .map((t) => {
      const d = new Date(t.startedAt);
      const cat = CATEGORIES[t.place.category];
      const parts = [
        formatDistance(t.distance),
        t.travelSec != null ? `${formatDuration(t.travelSec)} there` : "didn't arrive",
        `${t.avgSpeedKmh.toFixed(1)} km/h`,
        t.arrived ? `stayed ${formatDuration(t.dwellSec)}` : null,
      ].filter(Boolean);
      return `<div class="card" data-trip="${esc(t.id)}">
        <div class="card-top">
          <span class="card-icon">${cat?.icon || "📍"}</span>
          <div class="grow">
            <h3>${esc(t.place.name)}</h3>
            <div class="meta">${MODES[t.mode]?.icon || ""} ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            <div class="meta">${parts.join(" · ")}</div>
          </div>
          <button type="button" class="btn ghost danger" data-del="${esc(t.id)}" aria-label="Delete">🗑</button>
        </div>
      </div>`;
    })
    .join("");
}

function showTripOnMap(t) {
  layers.track.clearLayers();
  const pts = (t.track || []).map(([lat, lng]) => ({ lat, lng }));
  if (pts.length > 1) L.polyline(pts.map((p) => [p.lat, p.lng]), { color: "#2563eb", weight: 4 }).addTo(layers.track);
  L.marker([t.place.lat, t.place.lng], { icon: pinIcon(t.place.category, true) }).addTo(layers.track);
  fitTo([...pts, t.place]);
}

$("#history-list").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    if (confirm("Delete this outing?")) {
      store.deleteTrip(del.dataset.del);
      layers.track.clearLayers();
      renderHistory();
    }
    return;
  }
  const card = e.target.closest("[data-trip]");
  if (!card) return;
  const t = store.getHistory().find((x) => x.id === card.dataset.trip);
  if (t) {
    document.querySelectorAll("#history-list .card").forEach((c) => c.classList.toggle("selected", c === card));
    showTripOnMap(t);
  }
});

// ---------------------------------------------------------------- me

function renderMe() {
  const history = store.getHistory();
  const r = records(history);
  const rows = [
    ["Outings", r.trips],
    ["Places discovered", r.placesVisited],
    ["Distance travelled", formatDistance(r.totalDistance)],
    ["Time spent at places", formatDuration(r.totalDwellSec)],
    ["Current streak", `${r.streakDays} day${r.streakDays === 1 ? "" : "s"}`],
  ];
  if (r.longestTrip) rows.push(["Longest outing", `${formatDistance(r.longestTrip.distance)} · ${r.longestTrip.place}`]);
  if (r.longestStay) rows.push(["Longest stay", `${formatDuration(r.longestStay.dwellSec)} · ${r.longestStay.place}`]);
  for (const id of MODE_IDS) {
    const m = r.byMode[id];
    if (m) {
      rows.push([`${MODES[id].icon} Your ${MODES[id].label.toLowerCase()} pace`, `${m.avgSpeedKmh.toFixed(1)} km/h (${m.trips} trips)`]);
      rows.push([`${MODES[id].icon} Fastest`, `${m.fastest.speedKmh.toFixed(1)} km/h · ${m.fastest.place}`]);
    } else {
      rows.push([`${MODES[id].icon} ${MODES[id].label} pace`, `${MODES[id].defaultSpeedKmh} km/h (default)`]);
    }
  }
  $("#records").innerHTML = rows
    .map(([k, v]) => `<div class="record"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join("");

  const prof = interestProfile(history);
  const any = Object.values(prof).some((v) => v > 0);
  $("#interest-bars").innerHTML = any
    ? CATEGORY_IDS.map(
        (c) =>
          `<div class="bar"><span>${CATEGORIES[c].icon} ${CATEGORIES[c].label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(prof[c] * 100)}%"></div></div></div>`
      ).join("")
    : `<p class="hint">Visit a few places and this fills in.</p>`;

  $("#provider-picker").innerHTML = Object.values(PROVIDERS)
    .map((p) => `<button type="button" role="radio" data-provider="${p.id}" aria-checked="${settings.provider === p.id}">${p.label}</button>`)
    .join("");
}

$("#provider-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-provider]");
  if (!b) return;
  settings.provider = b.dataset.provider;
  saveSettings();
  renderMe();
});

$("#export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store.getHistory(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dont-know-where-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("#clear-btn").addEventListener("click", () => {
  if (!confirm("Delete all outings and records? This can't be undone.")) return;
  store.clearHistory();
  renderMe();
  toast("All data deleted");
});

// ---------------------------------------------------------------- location

function setPosition(pos, fromGps) {
  const first = !state.position;
  state.position = pos;
  state.gpsOk = state.gpsOk || fromGps;
  settings.lastPosition = { lat: +pos.lat.toFixed(4), lng: +pos.lng.toFixed(4) };
  drawMe();
  $("#location-status").textContent = fromGps
    ? `Located (±${Math.round(pos.accuracy || 0)} m)`
    : "Start point set manually — tap the map to move it.";
  if (first) {
    saveSettings();
    if (!state.trip) map.setView([pos.lat, pos.lng], 15);
  }
}

function startGps() {
  if (!("geolocation" in navigator)) {
    $("#location-status").textContent = "No GPS available — tap the map to set your start point.";
    return;
  }
  navigator.geolocation.watchPosition(
    (p) => {
      const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      setPosition(fix, true);
      onTripFix({ ...fix, t: Date.now() });
    },
    (err) => {
      if (!state.gpsOk) {
        $("#location-status").textContent =
          err.code === 1
            ? "Location blocked — allow it in settings, or tap the map to set your start point."
            : "Can't get GPS yet — tap the map to set your start point.";
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

map.on("click", (e) => {
  if (state.gpsOk || state.trip) return;
  setPosition({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: 0 }, false);
});

$("#locate-btn").addEventListener("click", () => {
  if (state.position) map.setView([state.position.lat, state.position.lng], Math.max(map.getZoom(), 15));
  else toast("Still looking for you…");
});

// ---------------------------------------------------------------- shell

document.querySelector(".tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  if (b.dataset.tab === "trip" && !state.trip) {
    toast("No trip running — pick a place on Explore.");
    return;
  }
  showView(b.dataset.tab);
  if (b.dataset.tab === "trip") renderTrip();
});

document.querySelectorAll(".grabber").forEach((g) =>
  g.addEventListener("click", () => g.parentElement.classList.toggle("collapsed"))
);

function restoreTrip() {
  const saved = store.getActiveTrip();
  if (!saved) return;
  try {
    state.trip = TripTracker.fromJSON(saved);
    const p = state.trip.place;
    showView("trip");
    renderTrip();
    map.setView([p.lat, p.lng], 15);
    requestWakeLock();
  } catch {
    store.saveActiveTrip(null);
  }
}

renderPickers();
restoreTrip();
startGps();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Exposed for debugging / automated checks.
window.__dkw = { state, store, settings, map };

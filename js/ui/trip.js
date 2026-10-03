// The trip in progress: live stats, hand-off to a maps app, arrival, finish → recap.

import { $, L, esc, toast, state, settings, store, layers, pinIcon, fitTo, views, showView, drawSpeedTrack, downloadFile, kcalFor } from "../app.js";
import { MODES, formatSpeed } from "../modes.js";
import { t } from "../i18n.js";
import { directionsUrl, PROVIDERS } from "../maplinks.js";
import { TripTracker } from "../tracker.js";
import { distance, formatDistance, formatDuration } from "../geo.js";
import { resample } from "../ride.js";
import { routeToGpx, gpxFileName } from "../gpx.js";
import { icon } from "../icons.js";

let wakeLock = null;
let lastPersist = 0;

/**
 * Start a trip to `place`. `routePoints` (optional) is the planned line to show and to send to a watch.
 * opts.home makes it a loop (come back there); opts.loopVia is the return waypoint; opts.origin the start.
 */
export function startTrip(place, mode, routePoints, { home = null, loopVia = null, origin = null } = {}) {
  if (state.trip && !confirm(t("trip.replace"))) return;
  const trip = new TripTracker({ mode, place, home });
  // Keep a light copy of the planned route (it is persisted with the trip).
  trip.plannedRoute = routePoints?.length ? resample(routePoints, 40).slice(0, 800).map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5)]) : null;
  trip.loopVia = loopVia;
  trip.origin = origin;
  state.trip = trip;
  if (state.position && state.gpsOk) trip.addPoint({ ...state.position, t: Date.now() });
  persist(true);
  showView("trip");
  drawTripLayers();
  fitTo([origin || state.position, place, ...(trip.plannedRoute || [])]);
  requestWakeLock();
  toast(t("trip.keepOpen"), 3500);
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

function persist(force) {
  if (!state.trip) return;
  if (force || Date.now() - lastPersist > 5000) {
    store.saveActiveTrip(state.trip.toJSON());
    lastPersist = Date.now();
  }
}

export function drawTripLayers() {
  const trip = state.trip;
  layers.trip.clearLayers();
  if (!trip) return;
  if (trip.plannedRoute) L.polyline(trip.plannedRoute, { color: "#0f766e", weight: 5, opacity: 0.55 }).addTo(layers.trip);
  if (trip.home) L.marker([trip.home.lat, trip.home.lng], { icon: L.divIcon({ className: "", html: `<div class="start-pin">${icon("flag")}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(layers.trip);
  L.marker([trip.place.lat, trip.place.lng], { icon: pinIcon(trip.place.category, true, trip.place.mystery) }).addTo(layers.trip);
  const track = trip.track.map((q) => [q.lat, q.lng, q.t, q.ele]);
  drawSpeedTrack(track, layers.trip);
}

const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

export function renderTrip() {
  const trip = state.trip;
  $("#tab-go").classList.toggle("live", Boolean(trip));
  if (!trip) return;
  const p = trip.place;
  const now = Date.now();
  $("#trip-place").textContent = p.name;
  const status = $("#trip-status");
  const dwell = trip.arrived ? trip.dwellSec + (trip._lastNear != null ? (now - trip._lastNear) / 1000 : 0) : 0;
  const back = trip.home && trip.arrived && trip._lastNear == null;
  status.textContent = trip.homeAt
    ? t("trip.home")
    : back
    ? t("trip.headingBack")
    : trip.arrived
    ? t("trip.arrived", { t: formatDuration(dwell) })
    : t("trip.onWay", { mode: t(`mode.${trip.mode}`) });
  status.classList.toggle("arrived", trip.arrived);
  $("#finish-btn").classList.toggle("pulse", Boolean(trip.homeAt));

  // "To go": to the place, then (on a loop) back to the start.
  const target = trip.arrived && trip.home && !trip.homeAt ? trip.home : p;
  const rem = state.position ? distance(state.position, target) : null;
  $("#trip-remaining").textContent = (trip.arrived && !trip.home) || trip.homeAt ? "0 m" : rem != null ? formatDistance(rem) : "–";
  $("#trip-elapsed").textContent = clock((now - trip.startedAt) / 1000);
  const travelSec = ((trip.arrivedAt ?? now) - trip.startedAt) / 1000;
  const dist = trip.arrived ? trip.distanceToArrival : trip.distance;
  const sp = formatSpeed(trip.mode, travelSec > 5 && dist > 0 ? (dist / travelSec) * 3.6 : 0);
  $("#trip-speed").textContent = sp.value;
  $("#trip-speed-unit").textContent = sp.unit;
  $("#here-btn").hidden = trip.arrived;

  // Navigation: a loop goes place → return point → start; Apple Maps can't take waypoints.
  const from = state.position || trip.origin;
  const loopLink = (id) =>
    trip.home && !trip.homeAt && id !== "apple"
      ? trip.arrived
        ? directionsUrl(id, from, trip.home, trip.mode, trip.loopVia ? [trip.loopVia] : [])
        : directionsUrl(id, from, trip.home, trip.mode, [...(p.via || []), p, ...(trip.loopVia ? [trip.loopVia] : [])])
      : directionsUrl(id, from, trip.arrived && trip.home ? trip.home : p, trip.mode, trip.arrived ? [] : p.via || []);
  const main = $("#nav-main");
  const href = loopLink(settings.provider);
  if (main.getAttribute("href") !== href) {
    main.setAttribute("href", href);
    main.textContent = t("trip.navigate", { app: PROVIDERS[settings.provider].label });
    $("#nav-alt").innerHTML =
      Object.keys(PROVIDERS)
        .filter((id) => id !== settings.provider)
        .map((id) => `<a target="_blank" rel="noopener" href="${esc(loopLink(id))}">${PROVIDERS[id].label}</a>`)
        .join("") + (trip.home && !trip.arrived ? `<span class="hint small apple-hint">${esc(t("trip.appleHint"))}</span>` : "");
  }
}

export function onTripFix(fix) {
  const trip = state.trip;
  if (!trip) return;
  const ev = trip.addPoint(fix);
  if (ev === "arrived") announceArrival();
  if (ev === "home") {
    toast(t("trip.backHome"), 4000);
    navigator.vibrate?.([120, 60, 120, 60, 120]);
    renderTrip();
  }
  persist(Boolean(ev));
  // Redrawing the coloured track is the expensive part; a few times a minute is plenty.
  if (state.view !== "recap" && state.view !== "activity" && (ev || Date.now() - lastDraw > 3000)) {
    drawTripLayers();
    lastDraw = Date.now();
  }
}
let lastDraw = 0;

export function onHeartRate(bpm) {
  state.trip?.addHeartRate(bpm, Date.now());
}

function announceArrival() {
  const name = state.trip.place.name;
  toast(t("trip.madeIt", { name }), 3500);
  navigator.vibrate?.([120, 60, 120]);
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    try {
      new Notification(t("notif.arrived"), { body: name, icon: "icons/icon-192.png" });
    } catch {}
  }
  renderTrip();
}

$("#here-btn").addEventListener("click", () => {
  if (!state.trip) return;
  state.trip.markArrived(Date.now());
  persist(true);
  announceArrival();
});

$("#finish-btn").addEventListener("click", () => {
  const trip = state.trip;
  if (!trip) return;
  const rec = trip.finish(Date.now());
  rec.kcal = kcalFor(rec);
  store.addTrip(rec);
  endTrip();
  showView("recap", { id: rec.id, fresh: true });
});

$("#cancel-trip-btn").addEventListener("click", () => {
  if (!state.trip || !confirm(t("trip.discard"))) return;
  endTrip();
  showView("go");
});

$("#course-btn").addEventListener("click", () => {
  const trip = state.trip;
  if (!trip) return;
  const pts = trip.plannedRoute?.length ? trip.plannedRoute.map(([lat, lng]) => ({ lat, lng })) : [state.position, trip.place].filter(Boolean);
  downloadFile(gpxFileName(trip.place.name), routeToGpx({ name: trip.place.name, points: pts }));
  toast(t("trip.garmin"), 4500);
});

function endTrip() {
  state.trip = null;
  store.saveActiveTrip(null);
  layers.trip.clearLayers();
  releaseWakeLock();
  renderTrip();
}

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {}
}
function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
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

export function restoreTrip() {
  const saved = store.getActiveTrip();
  if (!saved) return false;
  try {
    state.trip = TripTracker.fromJSON(saved);
    showView("trip");
    drawTripLayers();
    fitTo([state.trip.place, state.trip.home, ...state.trip.track]);
    requestWakeLock();
    return true;
  } catch {
    store.saveActiveTrip(null);
    return false;
  }
}

views.trip = { show: renderTrip };

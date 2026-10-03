// The trip in progress: live stats, hand-off to a maps app, arrival, finish → recap.

import { $, L, esc, toast, state, settings, store, layers, pinIcon, fitTo, views, showView, drawSpeedTrack, downloadFile, kcalFor } from "../app.js";
import { MODES, formatSpeed } from "../modes.js";
import { CATEGORIES } from "../places.js";
import { directionsUrl, PROVIDERS } from "../maplinks.js";
import { TripTracker } from "../tracker.js";
import { distance, formatDistance, formatDuration } from "../geo.js";
import { resample } from "../ride.js";
import { routeToGpx, gpxFileName } from "../gpx.js";

let wakeLock = null;
let lastPersist = 0;

/** Start a trip to `place`. `routePoints` (optional) is the planned line to show and to send to a watch. */
export function startTrip(place, mode, routePoints) {
  if (state.trip && !confirm("You already have a trip running. Replace it?")) return;
  const t = new TripTracker({ mode, place });
  // Keep a light copy of the planned route (it is persisted with the trip).
  t.plannedRoute = routePoints?.length ? resample(routePoints, 40).slice(0, 600).map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5)]) : null;
  state.trip = t;
  if (state.position && state.gpsOk) t.addPoint({ ...state.position, t: Date.now() });
  persist(true);
  showView("trip");
  drawTripLayers();
  fitTo([state.position, place, ...(t.plannedRoute || [])]);
  requestWakeLock();
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
  const t = state.trip;
  layers.trip.clearLayers();
  if (!t) return;
  if (t.plannedRoute) L.polyline(t.plannedRoute, { color: "#0f766e", weight: 5, opacity: 0.55 }).addTo(layers.trip);
  L.marker([t.place.lat, t.place.lng], { icon: pinIcon(t.place.category, true, t.place.mystery) }).addTo(layers.trip);
  const track = t.track.map((q) => [q.lat, q.lng, q.t, q.ele]);
  drawSpeedTrack(track, layers.trip);
}

/** Live calorie estimate for the trip so far. */
function liveKcal(t, now) {
  const arrivedAt = t.arrivedAt ?? now;
  const travelSec = (arrivedAt - t.startedAt) / 1000;
  const dist = t.arrived ? t.distanceToArrival : t.distance;
  const bpms = t.hr.map((h) => h[1]);
  return kcalFor({
    mode: t.mode,
    travelSec,
    dwellSec: t.arrived ? (now - t.arrivedAt) / 1000 : 0,
    avgSpeedKmh: travelSec > 0 ? (dist / travelSec) * 3.6 : 0,
    avgHr: bpms.length ? bpms.reduce((a, b) => a + b, 0) / bpms.length : null,
    startedAt: t.startedAt,
    endedAt: now,
  });
}

export function renderTrip() {
  const t = state.trip;
  $("#tab-go").classList.toggle("live", Boolean(t));
  if (!t) return;
  const p = t.place;
  const now = Date.now();
  $("#trip-place").textContent = p.name;
  $("#trip-kind").textContent = `${p.kind} · ${MODES[t.mode].icon} ${MODES[t.mode].label}`;
  $("#trip-icon").textContent = p.mystery ? "❓" : CATEGORIES[p.category]?.icon || "📍";
  const status = $("#trip-status");
  const dwell = t.arrived ? t.dwellSec + (t._lastNear != null ? (now - t._lastNear) / 1000 : 0) : 0;
  status.textContent = t.arrived ? `You're there 🎉 · ${formatDuration(dwell)}` : "On the way";
  status.classList.toggle("arrived", t.arrived);

  const rem = state.position ? distance(state.position, p) : t.remaining();
  $("#trip-remaining").textContent = t.arrived ? "✓" : rem != null ? formatDistance(rem) : "–";
  $("#trip-elapsed").textContent = formatDuration((now - t.startedAt) / 1000);
  const travelSec = ((t.arrivedAt ?? now) - t.startedAt) / 1000;
  const dist = t.arrived ? t.distanceToArrival : t.distance;
  const sp = formatSpeed(t.mode, travelSec > 5 && dist > 0 ? (dist / travelSec) * 3.6 : 0);
  $("#trip-speed").textContent = sp.value;
  $("#trip-speed-unit").textContent = `avg ${sp.unit}`;
  $("#trip-kcal").textContent = liveKcal(t, now);
  $("#here-btn").hidden = t.arrived;

  const from = state.position;
  const via = p.via || [];
  const providers = [settings.provider, ...Object.keys(PROVIDERS).filter((x) => x !== settings.provider)];
  const html = providers
    .map(
      (id, i) =>
        `<a class="btn${i === 0 ? " primary" : ""}" target="_blank" rel="noopener" href="${esc(directionsUrl(id, from, p, t.mode, via))}">${PROVIDERS[id].label}</a>`
    )
    .join("");
  if ($("#nav-links").innerHTML !== html) $("#nav-links").innerHTML = html;
}

export function onTripFix(fix) {
  const t = state.trip;
  if (!t) return;
  const ev = t.addPoint(fix);
  if (ev === "arrived") announceArrival();
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
  persist(true);
  announceArrival();
});

$("#finish-btn").addEventListener("click", () => {
  const t = state.trip;
  if (!t) return;
  const rec = t.finish(Date.now());
  rec.kcal = kcalFor(rec);
  store.addTrip(rec);
  endTrip();
  showView("recap", { id: rec.id, fresh: true });
});

$("#cancel-trip-btn").addEventListener("click", () => {
  if (!state.trip || !confirm("Discard this trip without saving?")) return;
  endTrip();
  showView("go");
});

$("#course-btn").addEventListener("click", () => {
  const t = state.trip;
  if (!t) return;
  const pts = t.plannedRoute?.length ? t.plannedRoute.map(([lat, lng]) => ({ lat, lng })) : [state.position, t.place].filter(Boolean);
  downloadFile(gpxFileName(t.place.name), routeToGpx({ name: t.place.name, points: pts }));
  toast("Import this GPX in Garmin Connect → Courses, then Send to Device.", 4500);
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
    fitTo([state.trip.place, ...state.trip.track]);
    requestWakeLock();
    return true;
  } catch {
    store.saveActiveTrip(null);
    return false;
  }
}

views.trip = { show: renderTrip };

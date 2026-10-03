// Boot: GPS, tabs, deep links, restore a running trip.

import { $, state, settings, saveSettings, map, drawMe, showView, toast, hydrateIcons } from "./app.js";
import { applyI18n, t } from "./i18n.js";
import { updateLocationStatus, prefetch } from "./ui/go.js";
import { onTripFix, restoreTrip, renderTrip } from "./ui/trip.js";
import "./ui/recap.js";
import "./ui/activity.js";
import { addFriendFromCode } from "./ui/ranks.js";
import "./ui/me.js";

// ---------------------------------------------------------------- location

function setPosition(pos) {
  const first = !state.position;
  state.position = pos;
  state.gpsOk = true;
  settings.lastPosition = { lat: +pos.lat.toFixed(4), lng: +pos.lng.toFixed(4) };
  drawMe();
  if (first) {
    updateLocationStatus();
    saveSettings();
    if (!state.start) prefetch();
    if (!state.trip && !state.start) map.setView([pos.lat, pos.lng], 15);
  }
}

function startGps() {
  if (!("geolocation" in navigator)) {
    updateLocationStatus("none");
    return;
  }
  navigator.geolocation.watchPosition(
    (p) => {
      const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      if (p.coords.altitude != null) fix.ele = p.coords.altitude;
      setPosition(fix);
      onTripFix({ ...fix, t: Date.now() });
    },
    (err) => {
      if (!state.gpsOk) updateLocationStatus(err.code === 1 ? "off" : "none");
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

$("#locate-btn").addEventListener("click", () => {
  if (state.position) map.setView([state.position.lat, state.position.lng], Math.max(map.getZoom(), 15));
  else toast(t("loc.searching"));
});

// ---------------------------------------------------------------- shell

document.querySelector(".tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  showView(b.dataset.tab === "go" && state.trip ? "trip" : b.dataset.tab);
});

document.querySelectorAll(".grabber").forEach((g) => g.addEventListener("click", () => g.parentElement.classList.toggle("collapsed")));

/** Friend card links: …/#friend=CODE */
function handleHash() {
  if (location.hash.startsWith("#friend=")) {
    const link = location.hash;
    history.replaceState(null, "", location.pathname + location.search);
    setTimeout(() => addFriendFromCode(link), 300);
  }
}
window.addEventListener("hashchange", handleHash);

hydrateIcons();
applyI18n();
if (!restoreTrip()) showView("go");
renderTrip();
handleHash();
startGps();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Exposed for debugging / automated checks.
window.__dkw = { state, settings, map };

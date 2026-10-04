// Shared app state, map and small UI helpers used by every screen.

import { createStore } from "./store.js";
import { defaultProvider } from "./maplinks.js";
import { CATEGORIES, KINDS } from "./places.js";
import { tripCalories } from "./calories.js";
import { segmentSpeeds, speedRange, colouredRuns } from "./charts.js";
import { icon } from "./icons.js";
import { emptyUsage } from "./usage.js";
import { t, setLang, detectLang } from "./i18n.js";

export const L = window.L;
export const store = createStore();
export const $ = (sel) => document.querySelector(sel);
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DEFAULTS = {
  provider: defaultProvider(navigator.userAgent),
  lastPosition: null,
  mapStyle: "map",
  choice: { mode: "walk", length: "medium", difficulty: "moderate", style: "place" },
  interests: [],
  profile: { weightKg: 70, age: null, sex: "" },
  usage: emptyUsage(),
  lang: null, // null = follow the phone
  recentStarts: [], // [{ lat, lng, label }]
  loopByMode: { walk: true, run: true, bike: true, moto: false, car: false },
};
export const settings = store.getSettings(DEFAULTS);
settings.choice = { ...DEFAULTS.choice, ...settings.choice };
settings.profile = { ...DEFAULTS.profile, ...settings.profile };
settings.usage = { ...emptyUsage(), ...settings.usage };
settings.loopByMode = { ...DEFAULTS.loopByMode, ...settings.loopByMode };
setLang(settings.lang || detectLang());

/** Replace <i data-icon="name"> placeholders with SVG icons. */
export function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
}
export const saveSettings = () => store.saveSettings(settings);

export const state = {
  position: null, // { lat, lng, accuracy, ele? } from GPS
  start: null, // custom start { lat, lng, label }; null = use GPS position
  gpsOk: false,
  trip: null, // TripTracker
  view: "go",
  hr: { conn: null, bpm: null, at: 0 },
  routes: new Map(), // place id -> fetched route { points, distance, duration }
};

/** Where suggestions start from: a chosen start point, else the GPS position. */
export const startPoint = () => state.start || state.position;

export const kcalFor = (trip) => tripCalories(trip, settings.profile);

// ---------------------------------------------------------------- toast

let toastTimer;
export function toast(msg, ms = 2800) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ---------------------------------------------------------------- map

export const map = L.map("map", { zoomControl: false }).setView(
  settings.lastPosition ? [settings.lastPosition.lat, settings.lastPosition.lng] : [48.5, 10],
  settings.lastPosition ? 14 : 4
);

const STYLES = {
  map: {
    label: "map.map",
    layers: () => [
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }),
    ],
  },
  satellite: {
    label: "map.satellite",
    layers: () => [
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
      }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
      }),
    ],
  },
  topo: {
    label: "map.topo",
    layers: () => [
      L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: 'Map &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), &copy; OpenStreetMap',
      }),
    ],
  },
};
const STYLE_ORDER = ["map", "satellite", "topo"];
let baseLayers = [];

export function setMapStyle(style) {
  if (!STYLES[style]) style = "map";
  baseLayers.forEach((l) => map.removeLayer(l));
  baseLayers = STYLES[style].layers();
  baseLayers.forEach((l) => l.addTo(map));
  document.body.dataset.mapStyle = style;
  settings.mapStyle = style;
  saveSettings();
  const next = STYLE_ORDER[(STYLE_ORDER.indexOf(style) + 1) % STYLE_ORDER.length];
  $("#layer-btn").setAttribute("aria-label", t(STYLES[next].label));
  return t(STYLES[style].label);
}
setMapStyle(settings.mapStyle);
$("#layer-btn").addEventListener("click", () => {
  const next = STYLE_ORDER[(STYLE_ORDER.indexOf(settings.mapStyle) + 1) % STYLE_ORDER.length];
  toast(setMapStyle(next), 1200);
});

export const layers = {
  me: null,
  view: L.layerGroup().addTo(map), // whatever the current screen shows; cleared on navigation
  trip: L.layerGroup().addTo(map), // the trip in progress
  start: null, // marker of a custom start point
};

/** Show (or remove) the custom start marker. */
export function drawStart() {
  if (layers.start) {
    map.removeLayer(layers.start);
    layers.start = null;
  }
  if (!state.start) return;
  layers.start = L.marker([state.start.lat, state.start.lng], {
    icon: L.divIcon({ className: "", html: `<div class="start-pin">${icon("flag")}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    zIndexOffset: 900,
    interactive: false,
  }).addTo(map);
}

/** Map pin; `kind` (waterfall, tower, …) picks a more specific icon than the category. */
export const pinIcon = (category, selected = false, mystery = false, kind = null) =>
  L.divIcon({
    className: "",
    html: `<div class="pin${selected ? " selected" : ""}"><span>${icon(mystery ? "map-pin-question" : KINDS[kind]?.icon || CATEGORIES[category]?.icon || "sparkles")}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });

export function drawMe() {
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

export function fitTo(points) {
  const pts = points.filter(Boolean).map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lng]));
  if (!pts.length) return;
  const desktop = window.innerWidth >= 900;
  const sheet = document.querySelector(".view:not([hidden])");
  const sheetH = sheet && !desktop ? Math.min(sheet.offsetHeight, window.innerHeight * 0.7) : 0;
  map.fitBounds(L.latLngBounds(pts), {
    paddingTopLeft: [desktop ? 460 : 30, 80],
    paddingBottomRight: [desktop ? 80 : 70, desktop ? 80 : sheetH + 80],
    maxZoom: 17,
  });
}

/** Draw a recorded track coloured by speed into `group`. Returns the speed range used. */
export function drawSpeedTrack(track, group) {
  if (!track || track.length < 2) return null;
  const segs = segmentSpeeds(track);
  const range = speedRange(segs);
  // white casing underneath keeps the colours readable on satellite imagery
  L.polyline(track.map((p) => [p[0], p[1]]), { color: "#fff", weight: 8, opacity: 0.8 }).addTo(group);
  for (const run of colouredRuns(segs, range)) L.polyline(run.points, { color: run.color, weight: 5 }).addTo(group);
  return { segs, range };
}

// ---------------------------------------------------------------- navigation between screens

export const views = {};
const TAB_FOR = { go: "go", trip: "go", recap: "activity", activity: "activity", ranks: "ranks", me: "me" };

export function showView(name, opts) {
  state.view = name;
  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.dataset.view !== name;
    v.classList.remove("collapsed");
  });
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === TAB_FOR[name]));
  layers.view.clearLayers();
  // Keep the live trip on the map, except while looking at a past outing.
  const showTrip = state.trip && name !== "recap" && name !== "activity";
  if (showTrip && !map.hasLayer(layers.trip)) layers.trip.addTo(map);
  if (!showTrip && map.hasLayer(layers.trip)) map.removeLayer(layers.trip);
  views[name]?.show?.(opts);
}

// ---------------------------------------------------------------- files

export function downloadFile(name, text, type = "application/gpx+xml") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Share via the phone's share sheet (with a file if supported), else fall back. */
export async function shareStuff({ title, text, url, file }) {
  try {
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, text, files: [file] });
      return "shared";
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return "shared";
    }
  } catch (e) {
    if (e?.name === "AbortError") return "cancelled";
  }
  try {
    await navigator.clipboard.writeText([text, url].filter(Boolean).join("\n"));
    return "copied";
  } catch {
    return "failed";
  }
}

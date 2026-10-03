// Activity: totals, outings list, saved/imported routes, and imports from other apps.

import { $, L, esc, toast, state, settings, store, layers, map, fitTo, views, showView, shareStuff, downloadFile, startPoint } from "../app.js";
import { t, getLang } from "../i18n.js";
import { geocode } from "../geocode.js";
import { visitedSquares, exploredPercent, squareBounds } from "../explore.js";
import { MODES, formatSpeed } from "../modes.js";
import { icon } from "../icons.js";
import { records } from "../stats.js";
import { formatDistance, formatDuration, pathLength } from "../geo.js";
import { parseFile, parseMapLink } from "../importers.js";
import { recordFromPoints } from "../tracker.js";
import { fetchRoute } from "../routing.js";
import { resample, viaPoints } from "../ride.js";
import { routeToGpx, gpxFileName } from "../gpx.js";
import { startTrip } from "./trip.js";

export function guessMode(kmh) {
  if (kmh < 7) return "walk";
  if (kmh < 14) return "run";
  if (kmh < 32) return "bike";
  return "car";
}

// ---------------------------------------------------------------- exploration squares

let showSquares = false;
let squaresLayer = null;

/** Where "around you" is: the chosen start, GPS, or the last known position. */
const homeArea = () => startPoint() || settings.lastPosition;

function renderExplore(history) {
  const visited = visitedSquares(history);
  const row = $("#explore-row");
  row.hidden = !visited.size;
  if (!visited.size) return;
  const center = homeArea();
  const pct = center ? exploredPercent(visited, center, 5) : null;
  $("#explore-pct").textContent = pct != null ? t("act.explored", { pct: pct.toLocaleString(getLang()) }) : "";
  $("#explore-count").textContent = t("act.squares", { n: visited.size });
  $("#explore-toggle").textContent = t(showSquares ? "act.hideMap" : "act.showMap");
  if (showSquares) drawSquares(visited);
}

function drawSquares(visited = visitedSquares(store.getHistory())) {
  if (squaresLayer) layers.view.removeLayer(squaresLayer);
  squaresLayer = L.layerGroup().addTo(layers.view);
  const b = map.getBounds().pad(0.2);
  for (const key of visited) {
    const [x, y] = key.split(",").map(Number);
    const bounds = squareBounds(x, y);
    if (!b.intersects(bounds)) continue;
    L.rectangle(bounds, { color: "#0f766e", weight: 1, opacity: 0.6, fillColor: "#14b8a6", fillOpacity: 0.35, interactive: false }).addTo(squaresLayer);
  }
}

$("#explore-row").addEventListener("click", () => {
  showSquares = !showSquares;
  if (!showSquares && squaresLayer) {
    layers.view.removeLayer(squaresLayer);
    squaresLayer = null;
  }
  if (showSquares && homeArea()) map.setView([homeArea().lat, homeArea().lng], 13);
  renderExplore(store.getHistory());
});
map.on("moveend", () => {
  if (showSquares && state.view === "activity") drawSquares();
});

// ---------------------------------------------------------------- lists

function render() {
  const history = store.getHistory();
  const r = records(history);
  squaresLayer = null;
  renderExplore(history);
  $("#history-summary").hidden = !history.length;
  $("#history-summary").innerHTML = [
    [r.placesVisited, t("act.places")],
    [formatDistance(r.totalDistance), t("act.total")],
    [r.streakDays, t("act.streak")],
  ]
    .map(([v, l]) => `<div class="stat"><span class="stat-v">${esc(v)}</span><span class="stat-l">${l}</span></div>`)
    .join("");

  const routes = store.getRoutes();
  $("#routes-block").hidden = !routes.length;
  $("#routes-list").innerHTML = routes
    .map(
      (rt) => `<div class="card" data-route="${esc(rt.id)}">
      <div class="card-top">
        <span class="card-icon">${icon("route-2")}</span>
        <div class="grow">
          <h3>${esc(rt.name)}</h3>
          <div class="meta">${formatDistance(rt.length)} · ${esc(t("act.from", { src: rt.source }))}</div>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn primary grow" data-follow="${esc(rt.id)}">${esc(t("go.go"))}</button>
        <button type="button" class="icon-btn" data-share-route="${esc(rt.id)}" aria-label="${esc(t("act.shareRoute"))}">${icon("share")}</button>
        <button type="button" class="icon-btn" data-del-route="${esc(rt.id)}" aria-label="${esc(t("act.deleteRoute"))}">${icon("trash")}</button>
      </div>
    </div>`
    )
    .join("");

  if (!history.length) {
    $("#history-list").innerHTML = `<div class="empty">${esc(t("act.empty"))}</div>`;
    return;
  }
  $("#history-list").innerHTML = history
    .map((trip) => {
      const d = new Date(trip.startedAt);
      const sp = formatSpeed(trip.mode, trip.avgSpeedKmh);
      const parts = [
        formatDistance(trip.distance),
        trip.travelSec != null ? formatDuration(trip.travelSec) : null,
        `${sp.value} ${sp.unit}`,
      ].filter(Boolean);
      return `<div class="card" data-trip="${esc(trip.id)}">
        <div class="card-top">
          <span class="card-icon">${icon(trip.loop ? "repeat" : MODES[trip.mode]?.icon || "walk")}</span>
          <div class="grow">
            <h3>${esc(trip.place.name)}</h3>
            <div class="meta">${d.toLocaleDateString(getLang(), { day: "numeric", month: "short" })} · ${esc(parts.join(" · "))}</div>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

$("#history-list").addEventListener("click", (e) => {
  const card = e.target.closest("[data-trip]");
  if (card) showView("recap", { id: card.dataset.trip });
});

$("#routes-list").addEventListener("click", async (e) => {
  const routes = store.getRoutes();
  const find = (id) => routes.find((r) => r.id === id);
  const del = e.target.closest("[data-del-route]");
  if (del) {
    if (confirm(t("act.deleteRouteQ"))) {
      store.deleteRoute(del.dataset.delRoute);
      layers.view.clearLayers();
      render();
    }
    return;
  }
  const share = e.target.closest("[data-share-route]");
  if (share) {
    const rt = find(share.dataset.shareRoute);
    const pts = rt.points.map(([lat, lng]) => ({ lat, lng }));
    const gpx = routeToGpx({ name: rt.name, points: pts });
    const file = new File([gpx], gpxFileName(rt.name), { type: "application/gpx+xml" });
    const res = await shareStuff({ title: rt.name, text: t("act.routeText", { name: rt.name, dist: formatDistance(rt.length) }), file });
    if (res === "copied" || res === "failed") downloadFile(gpxFileName(rt.name), gpx);
    return;
  }
  const follow = e.target.closest("[data-follow]");
  if (follow) {
    const rt = find(follow.dataset.follow);
    const pts = rt.points.map(([lat, lng]) => ({ lat, lng }));
    const end = pts[pts.length - 1];
    const place = {
      id: `route:${rt.id}`,
      name: rt.name,
      kind: "saved route",
      category: "quirky",
      lat: end.lat,
      lng: end.lng,
      via: viaPoints(pts, 3),
    };
    startTrip(place, rt.mode || settings.choice.mode, pts, { origin: pts[0] });
    return;
  }
  const card = e.target.closest("[data-route]");
  if (card) {
    const rt = find(card.dataset.route);
    layers.view.clearLayers();
    L.polyline(rt.points, { color: "#fff", weight: 8, opacity: 0.8 }).addTo(layers.view);
    L.polyline(rt.points, { color: "#7c3aed", weight: 5 }).addTo(layers.view);
    fitTo(rt.points);
  }
});

// ---------------------------------------------------------------- import

$("#import-btn").addEventListener("click", () => {
  $("#import-panel").hidden = !$("#import-panel").hidden;
});

function saveRoute(name, points, source, mode) {
  const pts = points.length > 2 ? resample(points, 25) : points;
  const thin = pts.length > 800 ? pts.filter((_, i) => i % Math.ceil(pts.length / 800) === 0 || i === pts.length - 1) : pts;
  store.addRoute({
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.slice(0, 80),
    source,
    mode,
    length: Math.round(pathLength(points)),
    createdAt: Date.now(),
    points: thin.map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5)]),
  });
}

/** Import parsed items; returns { activities, routes }. */
export function importItems(items, source) {
  let activities = 0;
  let routes = 0;
  const existing = new Set(store.getHistory().map((t) => t.id));
  for (const it of items) {
    if (it.points.length < 1) continue;
    if (it.kind === "activity") {
      const span = (it.points[it.points.length - 1].t - it.points[0].t) / 3600000;
      const kmh = span > 0 ? pathLength(it.points) / 1000 / span : 0;
      const mode = it.sport || guessMode(kmh);
      const rec = recordFromPoints({ name: it.name, mode, points: it.points });
      if (existing.has(rec.id)) continue;
      existing.add(rec.id);
      store.addTrip(rec);
      activities++;
    } else {
      saveRoute(it.name, it.points, source, it.sport);
      routes++;
    }
  }
  return { activities, routes };
}

function reportImport({ activities, routes }) {
  if (!activities && !routes) return toast(t("act.nothingNew"));
  toast(t("act.importedN", { n: activities + routes }));
  render();
}

$("#import-file").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  let total = { activities: 0, routes: 0 };
  for (const f of files) {
    try {
      const items = parseFile(f.name, await f.text());
      const src = /mapy/i.test(f.name) ? "Mapy.com" : /timeline|location/i.test(f.name) ? "Google Maps" : f.name.split(".").pop().toUpperCase() + " file";
      const r = importItems(items, src);
      total.activities += r.activities;
      total.routes += r.routes;
    } catch (err) {
      toast(`${f.name}: ${err.message}`, 4500);
      return;
    }
  }
  sortHistory();
  reportImport(total);
});

/** Imported activities can be older than existing ones; keep history newest-first. */
function sortHistory() {
  store.replaceHistory(store.getHistory().sort((a, b) => b.startedAt - a.startedAt));
}


$("#import-link-btn").addEventListener("click", async () => {
  const input = $("#import-link").value;
  const parsed = parseMapLink(input);
  if (!parsed) return toast(t("act.badLink"), 3500);
  try {
    const find = (q) =>
      geocode(q, { near: startPoint(), lang: getLang() }).catch(() => {
        throw new Error(t("act.notFound", { q }));
      });
    let stops = await Promise.all(parsed.stops.map((s) => (s.query ? find(s.query) : s)));
    if (stops.length === 1 && state.position) stops = [{ ...state.position }, stops[0]];
    const tm = new URL(input).searchParams.get("travelmode");
    const mode = { walking: "walk", bicycling: "bike", driving: "car", two_wheeler: "moto" }[tm] || settings.choice.mode;
    // Snap the line to roads/paths between each stop; straight line if routing is unavailable.
    const points = [];
    for (let i = 1; i < stops.length; i++) {
      const leg = await fetchRoute(MODES[mode].routingProfile, stops[i - 1], stops[i]);
      points.push(...(leg ? leg.points : [stops[i - 1], stops[i]]));
    }
    if (points.length < 2) points.push(...stops);
    saveRoute(parsed.name, points, parsed.name.startsWith("Mapy") ? "Mapy.com" : "Google Maps", mode);
    $("#import-link").value = "";
    reportImport({ activities: 0, routes: 1 });
  } catch (err) {
    toast(err.message || t("act.badLink"), 4000);
  }
});

views.activity = { show: render };

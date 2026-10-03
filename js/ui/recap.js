// Recap of one outing: speed-coloured route, stats, calories, badges, charts, share / export.

import { $, L, esc, toast, store, layers, pinIcon, fitTo, views, showView, drawSpeedTrack, downloadFile, shareStuff, kcalFor } from "../app.js";
import { MODES, formatSpeed } from "../modes.js";
import { formatDistance, formatDuration } from "../geo.js";
import { areaChart, RAMP } from "../charts.js";
import { tripToGpx, gpxFileName } from "../gpx.js";
import { streakDays } from "../stats.js";

let current = null;
let backTo = "activity";

/** Badges earned by this outing, judged against the outings before it. */
export function badgesFor(trip, history) {
  const before = history.filter((t) => t.id !== trip.id && t.startedAt < trip.startedAt);
  const out = [];
  if (!before.length) out.push("First outing");
  if (trip.arrived && !before.some((t) => t.arrived && t.place.id === trip.place.id)) out.push("New place");
  const sameMode = before.filter((t) => t.mode === trip.mode && t.arrived && t.travelSec >= 60);
  if (trip.arrived && trip.travelSec >= 60 && sameMode.length && trip.avgSpeedKmh > Math.max(...sameMode.map((t) => t.avgSpeedKmh)))
    out.push("Personal best");
  if (before.length && trip.distance > Math.max(...before.map((t) => t.distance || 0))) out.push("Longest yet");
  const streak = streakDays(history.filter((t) => t.startedAt <= trip.endedAt), trip.endedAt);
  if (streak >= 2) out.push(`${streak} days in a row`);
  return out.slice(0, 3);
}

function render(trip) {
  const history = store.getHistory();
  const d = new Date(trip.startedAt);
  const mode = MODES[trip.mode] || MODES.walk;
  $("#recap-title").textContent = trip.place.name;
  $("#recap-sub").textContent = [
    mode.label,
    `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    trip.imported ? "imported" : trip.arrived ? null : "didn't arrive",
  ]
    .filter(Boolean)
    .join(" · ");

  $("#recap-badges").innerHTML = badgesFor(trip, history)
    .map((b) => `<span class="badge-lg">${esc(b)}</span>`)
    .join("");

  const kcal = trip.kcal ?? kcalFor(trip);
  const avg = formatSpeed(trip.mode, trip.avgSpeedKmh);
  const movingSec = trip.travelSec ?? (trip.endedAt - trip.startedAt) / 1000 - (trip.dwellSec || 0);
  const stats = [
    [formatDistance(trip.distance), "distance"],
    [formatDuration(movingSec), "time"],
    [avg.value, avg.unit],
    [`${kcal}`, "kcal"],
    trip.arrived && !trip.imported ? [formatDuration(trip.dwellSec), "stayed"] : null,
    trip.avgHr ? [`${trip.avgHr}`, "avg bpm"] : trip.elevationGain ? [`${trip.elevationGain} m`, "climb"] : null,
  ].filter(Boolean);
  $("#recap-stats").innerHTML = stats
    .map(([v, l]) => `<div class="stat"><span class="stat-v">${esc(v)}</span><span class="stat-l">${esc(l)}</span></div>`)
    .join("");

  // Map: speed-coloured route + destination.
  layers.view.clearLayers();
  const drawn = drawSpeedTrack(trip.track, layers.view);
  L.marker([trip.place.lat, trip.place.lng], { icon: pinIcon(trip.place.category, true) }).addTo(layers.view);
  fitTo([...(trip.track || []), trip.place]);

  // Charts
  let charts = "";
  if (drawn) {
    const pace = MODES[trip.mode]?.pace;
    charts += `<div class="chart"><span class="chart-title">Speed</span>${areaChart(
      drawn.segs.map((s) => ({ x: s.km, y: s.kmh })),
      { color: "#0f766e", label: "Speed chart" }
    )}</div>`;
    const [lo, hi] = drawn.range;
    const f = (v) => (pace ? formatSpeed(trip.mode, v).value : v.toFixed(0));
    $("#recap-legend").innerHTML = `<span>${esc(f(lo))}</span><span class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></span><span>${esc(f(hi))} ${pace ? "min/km" : "km/h"}</span>`;
  } else {
    $("#recap-legend").innerHTML = trip.track?.length ? "" : "<span>No GPS track recorded.</span>";
  }
  $("#recap-charts").innerHTML = charts;
}

function summaryText(trip) {
  const avg = formatSpeed(trip.mode, trip.avgSpeedKmh);
  const kcal = trip.kcal ?? kcalFor(trip);
  return `${trip.place.name}: ${formatDistance(trip.distance)}, ${avg.value} ${avg.unit}, ${kcal} kcal${
    trip.arrived ? `, stayed ${formatDuration(trip.dwellSec)}` : ""
  }. Found with Don't Know Where`;
}

$("#recap-share").addEventListener("click", async () => {
  if (!current) return;
  const gpx = tripToGpx(current);
  const file = new File([gpx], gpxFileName(current.place.name, new Date(current.startedAt)), { type: "application/gpx+xml" });
  const res = await shareStuff({ title: current.place.name, text: summaryText(current), file });
  if (res === "copied") toast("Summary copied to clipboard");
});

$("#recap-gpx").addEventListener("click", () => {
  if (!current) return;
  downloadFile(gpxFileName(current.place.name, new Date(current.startedAt)), tripToGpx(current));
  toast("Saved. Upload it to Garmin Connect or Strava.", 3500);
});

$("#recap-delete").addEventListener("click", () => {
  if (!current || !confirm("Delete this outing?")) return;
  store.deleteTrip(current.id);
  current = null;
  showView("activity");
});

$("#recap-back").addEventListener("click", () => showView(backTo));

views.recap = {
  show({ id, fresh } = {}) {
    current = store.getHistory().find((t) => t.id === id);
    backTo = fresh ? "go" : "activity";
    if (!current) return showView("activity");
    render(current);
    if (fresh) toast("Saved");
  },
};

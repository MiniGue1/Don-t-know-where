// Recap of one outing: speed-coloured route, stats, calories, badges, charts, share / export.

import { $, L, esc, toast, store, layers, pinIcon, fitTo, views, showView, drawSpeedTrack, downloadFile, shareStuff, kcalFor } from "../app.js";
import { MODES, formatSpeed } from "../modes.js";
import { formatDistance, formatDuration } from "../geo.js";
import { areaChart, RAMP } from "../charts.js";
import { tripToGpx, gpxFileName } from "../gpx.js";
import { streakDays } from "../stats.js";
import { t, getLang } from "../i18n.js";
import { visitedSquares, squaresOfTrack } from "../explore.js";

let current = null;
let backTo = "activity";

/** Badges earned by this outing, judged against the outings before it. Returns display strings. */
export function badgesFor(trip, history) {
  const before = history.filter((x) => x.id !== trip.id && x.startedAt < trip.startedAt);
  const out = [];
  if (!before.length) out.push(t("badge.first"));
  if (trip.arrived && !before.some((x) => x.arrived && x.place.id === trip.place.id)) out.push(t("badge.newPlace"));
  if (before.length && trip.track?.length) {
    const known = visitedSquares(before);
    const fresh = [...squaresOfTrack(trip.track)].filter((k) => !known.has(k)).length;
    if (fresh > 0) out.push(t("badge.squares", { n: fresh }));
  }
  const sameMode = before.filter((x) => x.mode === trip.mode && x.arrived && x.travelSec >= 60);
  if (trip.arrived && trip.travelSec >= 60 && sameMode.length && trip.avgSpeedKmh > Math.max(...sameMode.map((x) => x.avgSpeedKmh)))
    out.push(t("badge.pb"));
  if (before.length && trip.distance > Math.max(...before.map((x) => x.distance || 0))) out.push(t("badge.longest"));
  const streak = streakDays(history.filter((x) => x.startedAt <= trip.endedAt), trip.endedAt);
  if (streak >= 2) out.push(t("badge.streak", { n: streak }));
  return out.slice(0, 3);
}

function render(trip) {
  const history = store.getHistory();
  const d = new Date(trip.startedAt);
  const mode = MODES[trip.mode] || MODES.walk;
  $("#recap-title").textContent = trip.place.name;
  const lang = getLang();
  $("#recap-sub").textContent = [
    t(`mode.${trip.mode}`),
    trip.loop ? t("recap.loop") : null,
    `${d.toLocaleDateString(lang, { day: "numeric", month: "short" })} ${d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })}`,
    trip.imported ? t("recap.imported") : trip.arrived ? null : t("recap.notArrived"),
  ]
    .filter(Boolean)
    .join(" · ");

  $("#recap-badges").innerHTML = badgesFor(trip, history)
    .map((b) => `<span class="badge-lg">${esc(b)}</span>`)
    .join("");

  const kcal = trip.kcal ?? kcalFor(trip);
  const avg = formatSpeed(trip.mode, trip.avgSpeedKmh);
  // A loop's time is the whole round; otherwise time to get there.
  const movingSec = trip.loop
    ? ((trip.homeAt || trip.endedAt) - trip.startedAt) / 1000 - (trip.dwellSec || 0)
    : trip.travelSec ?? (trip.endedAt - trip.startedAt) / 1000 - (trip.dwellSec || 0);
  const stats = [
    [formatDistance(trip.distance), t("recap.distance")],
    [formatDuration(movingSec), t("recap.time")],
    [avg.value, avg.unit],
    [`${kcal}`, "kcal"],
    trip.arrived && !trip.imported ? [formatDuration(trip.dwellSec), t("recap.stayed")] : null,
    trip.avgHr ? [`${trip.avgHr}`, t("recap.bpm")] : trip.elevationGain ? [`${trip.elevationGain} m`, t("recap.climb")] : null,
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
    charts += `<div class="chart"><span class="chart-title">${esc(t("recap.speed"))}</span>${areaChart(
      drawn.segs.map((s) => ({ x: s.km, y: s.kmh })),
      { color: "#0f766e", label: t("recap.speed") }
    )}</div>`;
    const [lo, hi] = drawn.range;
    const f = (v) => (pace ? formatSpeed(trip.mode, v).value : v.toFixed(0));
    $("#recap-legend").innerHTML = `<span>${esc(f(lo))}</span><span class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></span><span>${esc(f(hi))} ${pace ? "min/km" : "km/h"}</span>`;
  } else {
    $("#recap-legend").innerHTML = trip.track?.length ? "" : `<span>${esc(t("recap.noTrack"))}</span>`;
  }
  $("#recap-charts").innerHTML = charts;
}

function summaryText(trip) {
  const avg = formatSpeed(trip.mode, trip.avgSpeedKmh);
  const kcal = trip.kcal ?? kcalFor(trip);
  return t("recap.summary", { name: trip.place.name, dist: formatDistance(trip.distance), speed: `${avg.value} ${avg.unit}`, kcal });
}

$("#recap-share").addEventListener("click", async () => {
  if (!current) return;
  const gpx = tripToGpx(current);
  const file = new File([gpx], gpxFileName(current.place.name, new Date(current.startedAt)), { type: "application/gpx+xml" });
  const res = await shareStuff({ title: current.place.name, text: summaryText(current), file });
  if (res === "copied") toast(t("recap.copied"));
});

$("#recap-gpx").addEventListener("click", () => {
  if (!current) return;
  downloadFile(gpxFileName(current.place.name, new Date(current.startedAt)), tripToGpx(current));
  toast(t("recap.gpxSaved"), 3500);
});

$("#recap-delete").addEventListener("click", () => {
  if (!current || !confirm(t("recap.deleteQ"))) return;
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
    if (fresh) toast(t("recap.saved"));
  },
};

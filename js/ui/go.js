// "Where to?" → mode → length (there / loop) → difficulty or ride style → suggestion.

import { $, L, esc, toast, state, settings, saveSettings, store, layers, map, pinIcon, fitTo, views, showView, startPoint, drawStart } from "../app.js";
import { icon } from "../icons.js";
import { t, getLang } from "../i18n.js";
import { recordChoice, splitModes, usualChoice, favourite } from "../usage.js";
import { MODES, MODE_IDS, LENGTHS, DIFFICULTIES, RIDE_STYLES, thirdStep } from "../modes.js";
import { CATEGORIES, KINDS, fetchPlaces } from "../places.js";
import { scoreRoute, fetchCorridor } from "../scenic.js";
import { rankPlaces, surprisePick, searchRadius, estimateMinutes, DETOUR_FACTOR } from "../recommend.js";
import { personalSpeed } from "../stats.js";
import { fetchRoute, fetchRouteVia } from "../routing.js";
import { rideScore, twistLabel, viaPoints } from "../ride.js";
import { fetchElevations } from "../elevation.js";
import { loopStops, loopStraightLength, loopVariants, spikeRatio } from "../loop.js";
import { prepare, isRestricted, routeHitsRestricted } from "../restricted.js";
import { visitedSquares } from "../explore.js";
import { placeInfo } from "../wiki.js";
import { searchPlaces } from "../geocode.js";
import { distance, destination, formatDistance } from "../geo.js";
import { startTrip } from "./trip.js";

let results = [];
let markers = [];
let ranked = []; // full ranked list, so "Another" can reroll without refetching
let showAllModes = false;
let showMore = false;
let routeLine = null;
let selected = 0;

const choice = settings.choice;
const isLoop = () => Boolean(settings.loopByMode[choice.mode]);

function step(name) {
  if (name !== "loading") clearTimeout(slowTimer);
  document.querySelectorAll("#view-go .step").forEach((s) => (s.hidden = s.dataset.step !== name));
  $("#view-go").scrollTop = 0;
  // Leaving the results (but not just showing a spinner while scoring them) forgets them.
  if (name !== "results" && name !== "loading") {
    layers.view.clearLayers();
    results = [];
  }
}

const fmtMinutes = (m) => (m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(m % 60 ? 1 : 0)} h`);
const optionKey = (mode, opt) => {
  const kind = thirdStep(mode);
  if (!kind || !opt) return null;
  return kind === "style" ? `style.${opt}` : `diff.${opt}`;
};

// ---------------------------------------------------------------- start point

function renderFrom() {
  $("#from-label").textContent = state.start ? state.start.label : t("go.myLocation");
  const recent = settings.recentStarts.filter((r) => !state.start || r.label !== state.start.label);
  $("#from-results").innerHTML = recent
    .map((r, i) => `<button type="button" data-recent="${i}">${icon("map-pin")}<span>${esc(r.label)}</span></button>`)
    .join("");
  $("#from-results").dataset.kind = "recent";
}

function setStart(start) {
  state.start = start;
  if (start) {
    settings.recentStarts = [start, ...settings.recentStarts.filter((r) => r.label !== start.label)].slice(0, 3);
    saveSettings();
    map.setView([start.lat, start.lng], Math.max(map.getZoom(), 14));
  } else if (state.position) map.setView([state.position.lat, state.position.lng], Math.max(map.getZoom(), 14));
  drawStart();
  prefetch();
  $("#from-menu").hidden = true;
  $("#from-query").value = "";
  renderFrom();
  updateLocationStatus();
}

$("#from-btn").addEventListener("click", () => {
  $("#from-menu").hidden = !$("#from-menu").hidden;
  renderFrom();
});

$("#from-menu").addEventListener("click", (e) => {
  const opt = e.target.closest("[data-from]");
  if (opt?.dataset.from === "gps") return setStart(null);
  if (opt?.dataset.from === "map") return beginMapPick();
  const recent = e.target.closest("[data-recent]");
  if (recent) {
    const list = settings.recentStarts.filter((r) => !state.start || r.label !== state.start.label);
    return setStart(list[+recent.dataset.recent]);
  }
  const hit = e.target.closest("[data-hit]");
  if (hit) setStart(searchHits[+hit.dataset.hit]);
});

let searchHits = [];
$("#from-search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#from-query").value.trim();
  if (!q) return;
  try {
    searchHits = await searchPlaces(q, { near: state.position || settings.lastPosition, lang: getLang() });
  } catch {
    return toast(t("toast.searchFailed"));
  }
  if (!searchHits.length) return toast(t("toast.noResults"));
  $("#from-results").innerHTML = searchHits
    .map((h, i) => `<button type="button" data-hit="${i}">${icon("map-pin")}<span>${esc(h.label)}</span></button>`)
    .join("");
});

let picking = false;
function beginMapPick() {
  picking = true;
  $("#from-menu").hidden = true;
  $("#view-go").classList.add("collapsed");
  $("#pick-banner").hidden = false;
}
function endMapPick() {
  picking = false;
  $("#view-go").classList.remove("collapsed");
  $("#pick-banner").hidden = true;
}
map.on("click", (e) => {
  if (!picking) return;
  endMapPick();
  setStart({ lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5), label: t("go.pointOnMap") });
});
$("#pick-cancel").addEventListener("click", endMapPick);

/** Hint under the title only when there's no usable start. */
export function updateLocationStatus(reason) {
  const el = $("#location-status");
  if (startPoint()) {
    el.hidden = true;
    return;
  }
  if (reason) el.dataset.reason = reason;
  el.textContent = t(el.dataset.reason === "off" ? "loc.off" : "loc.none");
  el.hidden = !el.dataset.reason;
}

// ---------------------------------------------------------------- steps

function renderModes() {
  const usage = settings.usage;
  const usual = usualChoice(usage);
  const btn = $("#usual-btn");
  btn.hidden = !usual || !MODES[usual.mode];
  if (!btn.hidden) {
    const bits = [t(`mode.${usual.mode}`), t(`len.${usual.length}`), optionKey(usual.mode, usual.option) && t(optionKey(usual.mode, usual.option))].filter(Boolean);
    btn.innerHTML = `${icon(MODES[usual.mode].icon)}<span><b>${esc(t("go.usual"))}</b><small>${esc(bits.join(" · "))}</small></span>${icon("chevron-right", "go")}`;
  }
  const { top, more } = splitModes(usage, MODE_IDS, 3);
  const shown = showAllModes ? [...top, ...more] : top;
  const fav = top[0] && usage.modes[top[0]] ? top[0] : null;
  $("#mode-picker").innerHTML =
    shown.map((id) => `<button type="button" data-mode="${id}" class="${id === fav ? "fav" : ""}">${icon(MODES[id].icon)}<span>${esc(t(`mode.${id}`))}</span></button>`).join("") +
    (showAllModes ? "" : `<button type="button" class="more" data-more>${icon("plus")}<span>${esc(t("go.more"))}</span></button>`);
}

function renderLengths() {
  const speed = personalSpeed(store.getHistory(), choice.mode);
  const m = MODES[choice.mode];
  const fav = favourite(settings.usage, choice.mode, "length") || "medium";
  const loop = isLoop();
  document.querySelectorAll("#trip-type [data-loop]").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.loop === +loop)));
  $("#length-picker").innerHTML = Object.values(LENGTHS)
    .map((l) => {
      const min = m.lengths[l.id];
      // One way: how far out you can get. Loop: total length.
      const km = loop ? (speed * min) / 60 : (speed * min * 0.6) / 60 / DETOUR_FACTOR;
      return `<button type="button" data-length="${l.id}" class="${fav === l.id ? "fav" : ""}"><b>${esc(t(`len.${l.id}`))}</b><small>${fmtMinutes(min)} · ${formatDistance(km * 1000)}</small></button>`;
    })
    .join("");
}

function renderOptions() {
  const kind = thirdStep(choice.mode);
  const opts = kind === "style" ? RIDE_STYLES : DIFFICULTIES;
  const prefix = kind === "style" ? "style" : "diff";
  const fav = favourite(settings.usage, choice.mode, "option") || (kind === "style" ? "place" : "moderate");
  $("#option-title").textContent = t(kind === "style" ? "go.rideKind" : "go.howHard");
  $("#option-picker").innerHTML = Object.keys(opts)
    .map((id) => `<button type="button" data-option="${id}" class="${fav === id ? "fav" : ""}"><b>${esc(t(`${prefix}.${id}`))}</b><small>${esc(t(`${prefix}.${id}.hint`))}</small></button>`)
    .join("");
}

$("#mode-picker").addEventListener("click", (e) => {
  if (e.target.closest("[data-more]")) {
    showAllModes = true;
    return renderModes();
  }
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  choice.mode = b.dataset.mode;
  saveSettings();
  renderLengths();
  step("length");
});

$("#trip-type").addEventListener("click", (e) => {
  const b = e.target.closest("[data-loop]");
  if (!b) return;
  settings.loopByMode[choice.mode] = b.dataset.loop === "1";
  saveSettings();
  renderLengths();
});

$("#length-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-length]");
  if (!b) return;
  choice.length = b.dataset.length;
  saveSettings();
  if (thirdStep(choice.mode)) {
    renderOptions();
    step("option");
  } else suggest();
});

$("#option-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-option]");
  if (!b) return;
  if (thirdStep(choice.mode) === "style") choice.style = b.dataset.option;
  else choice.difficulty = b.dataset.option;
  saveSettings();
  suggest();
});

$("#usual-btn").addEventListener("click", () => {
  const u = usualChoice(settings.usage);
  if (!u) return;
  choice.mode = u.mode;
  choice.length = u.length;
  if (thirdStep(u.mode) === "style") choice.style = u.option;
  else if (thirdStep(u.mode)) choice.difficulty = u.option;
  saveSettings();
  suggest();
});

document.querySelectorAll("#view-go [data-back]").forEach((b) =>
  b.addEventListener("click", () => {
    let target = b.dataset.back;
    if (target === "option" && !thirdStep(choice.mode)) target = "length";
    if (target === "mode") renderModes();
    if (target === "length") renderLengths();
    if (target === "option") renderOptions();
    step(target);
  })
);

// ---------------------------------------------------------------- suggestions

// How far a destination may lie from the nearest road/path before it counts as unreachable.
const SNAP_LIMIT = { walk: 150, run: 150, bike: 150, moto: 300, car: 300 };
let ctx = null; // { from, mode, profile, minutes, polys, others } for the current suggestions
let slowTimer = null;

function loading(key) {
  $("#loading-text").textContent = t(key);
  step("loading");
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => {
    if (!$("#view-go [data-step=loading]").hidden) $("#loading-text").textContent = `${t(key)}. ${t("load.slow")}`;
  }, 6000);
}

/** Prefetch places for the usual choice as soon as the start is known, so Go feels instant. */
export function prefetch() {
  const from = startPoint();
  if (!from) return;
  const mode = splitModes(settings.usage, MODE_IDS, 1).top[0] || choice.mode;
  const len = favourite(settings.usage, mode, "length") || "medium";
  const loop = settings.loopByMode[mode];
  const speed = personalSpeed(store.getHistory(), mode);
  fetchPlaces(from, searchRadius(MODES[mode].lengths[len] * (loop ? 0.75 : 1), speed)).catch(() => {});
}

/**
 * Check a candidate against real roads: drop it if it's far from any road/path or the
 * way there crosses restricted land; move the pin onto the road if it's slightly off.
 * Keeps the candidate unchanged when routing is unavailable.
 */
async function validate(r) {
  const route = r.rideRoute || (await fetchRoute(ctx.profile, ctx.from, r.place));
  if (!route) return r;
  const wp = route.waypoints?.at(-1);
  if (wp && wp.snap > SNAP_LIMIT[ctx.mode]) return null;
  if (routeHitsRestricted(route.points, ctx.polys)) return null;
  const place = wp && wp.snap > 30 ? { ...r.place, lat: wp.lat, lng: wp.lng } : r.place;
  return { ...r, place, oneWay: route, route: r.loop ? null : route };
}

const joinRoutes = (a, b) => ({ points: [...a.points, ...b.points], distance: a.distance + b.distance, duration: a.duration + b.duration, waypoints: [...(a.waypoints || []), ...(b.waypoints || []).slice(1)] });

/** Routes for a place's loop variants (second place, return point left/right). */
async function loopCandidates(r) {
  const variants = loopVariants(ctx.from, r.place, ctx.others);
  const routes = await Promise.all(
    variants.map(async (v) => {
      if (r.rideRoute) {
        const back = await fetchRouteVia(ctx.profile, v.stops.slice(1));
        return back && joinRoutes(r.rideRoute, back);
      }
      return fetchRouteVia(ctx.profile, v.stops);
    })
  );
  return routes
    .map((route, i) => (route && !routeHitsRestricted(route.points, ctx.polys) ? { route, v: variants[i], spike: spikeRatio(route.points) } : null))
    .filter(Boolean);
}

/** How fun a route is. `covered`: the route was part of the corridor request, so nature/road data applies. */
function funOf(route, r, covered) {
  return scoreRoute(route, {
    corridor: covered ? ctx.corridor : null,
    places: ctx.allPlaces,
    dest: r.place,
    countBusy: !["car", "moto"].includes(ctx.mode),
  });
}

/**
 * Pick the best loop variant: little retracing, fits the time, most fun. If every
 * variant is spiky, fall back to an honest out-and-back on the same path.
 */
function chooseLoop(r, cands, covered) {
  r.loopPlanned = true;
  let best = null;
  for (const c of cands) {
    c.scenic = funOf(c.route, r, covered);
    const fit = Math.abs(c.route.duration / 60 - ctx.minutes) / ctx.minutes;
    c.score = c.spike * 2 + fit - c.scenic.fun / 10;
    if (!best || c.score < best.score) best = c;
  }
  if (best && best.spike <= 0.35) {
    r.route = best.route;
    const wp = best.route.waypoints?.[2];
    r.loopVia = wp ? { lat: wp.lat, lng: wp.lng } : best.v.via;
    r.viaPlace = best.v.viaPlace || null;
    r.scenic = best.scenic;
  } else if (r.oneWay) {
    const back = r.oneWay.points.slice().reverse();
    r.route = { points: [...r.oneWay.points, ...back], distance: r.oneWay.distance * 2, duration: r.oneWay.duration * 2 };
    r.loopVia = null;
    r.outBack = true;
    r.scenic = funOf(r.oneWay, r, covered);
  } else if (best) {
    r.route = best.route;
    r.loopVia = best.v.via;
    r.scenic = best.scenic;
  }
}

/** Loops for cards opened later (not in the first scoring round). */
async function planLoop(r) {
  if (r.loopPlanned) return r;
  chooseLoop(r, await loopCandidates(r), false);
  return r;
}

/**
 * Judge what each route passes: one corridor request covers the top candidates
 * (and the loop variants of the top two), then the list is re-ordered by
 * place score × fun.
 */
async function scoreResults(list, reorder) {
  const top = list.slice(0, 4);
  const loopCands = new Map();
  await Promise.all(
    top
      .slice(0, 2)
      .filter((r) => r.loop && !r.loopPlanned)
      .map(async (r) => loopCands.set(r, await loopCandidates(r)))
  );
  const routes = [];
  for (const r of top) {
    if (loopCands.has(r)) routes.push(...loopCands.get(r).map((c) => c.route));
    else if (r.route) routes.push(r.route);
    else if (r.oneWay) routes.push(r.oneWay);
  }
  loading("load.scoring");
  ctx.corridor = await fetchCorridor(routes);
  for (const r of list) {
    const covered = top.includes(r);
    if (loopCands.has(r)) chooseLoop(r, loopCands.get(r), true);
    else if (r.route) r.scenic = funOf(r.route, r, covered);
  }
  if (reorder) {
    const value = (r) => (r.score || 0.01) * (0.4 + (r.scenic?.fun ?? 5) / 10);
    list.sort((a, b) => value(b) - value(a));
  }
}

/** Validate candidates in order until `want` good ones are found (checks a few at a time). */
async function firstValid(cands, want) {
  const out = [];
  for (let i = 0; i < cands.length && out.length < want; i += 3) {
    const batch = await Promise.all(cands.slice(i, i + 3).map(validate));
    out.push(...batch.filter(Boolean));
  }
  return out.slice(0, want);
}

const pickOrder = (list) => {
  const pick = surprisePick(list);
  return pick ? [pick, ...list.filter((r) => r !== pick)] : [];
};

async function suggest() {
  const from = startPoint() && { lat: startPoint().lat, lng: startPoint().lng };
  if (!from) {
    toast(t("toast.noStart"));
    step("mode");
    $("#from-menu").hidden = false;
    return;
  }
  const history = store.getHistory();
  const mode = choice.mode;
  const minutes = MODES[mode].lengths[choice.length];
  const speed = personalSpeed(history, mode);
  const kind = thirdStep(mode);
  const difficulty = kind === "difficulty" ? choice.difficulty : "moderate";
  const style = kind === "style" ? choice.style : "place";
  const loop = isLoop();
  recordChoice(settings.usage, { mode, length: choice.length, option: kind === "style" ? style : kind ? difficulty : null });
  saveSettings();

  const radius = searchRadius(minutes * (loop ? 0.75 : 1), speed);
  const load = async (r) => {
    const data = await fetchPlaces(from, r);
    const polys = prepare(data.restricted);
    return { polys, places: data.places.filter((p) => !isRestricted(p, polys)) };
  };

  loading("load.looking");
  let places = [];
  let polys = [];
  let offline = false;
  try {
    ({ places, polys } = await load(radius));
  } catch {
    offline = true;
  }
  ctx = { from, mode, profile: MODES[mode].routingProfile, minutes, polys, others: [], allPlaces: places, corridor: null };

  // Difficulty needs to know which places are uphill.
  let elevations = null;
  let startEle = null;
  if (!offline && difficulty !== "moderate" && places.length) {
    loading("load.hills");
    const near = places
      .map((p) => ({ p, d: distance(from, p) }))
      .filter((x) => estimateMinutes(x.d, speed) <= minutes * 0.6)
      .sort((a, b) => a.d - b.d)
      .slice(0, 99)
      .map((x) => x.p);
    const eles = await fetchElevations([from, ...near]);
    if (eles) {
      startEle = eles[0];
      elevations = new Map(near.map((p, i) => [p.id, eles[i + 1]]));
    }
  }

  const squares = visitedSquares(history);
  const rank = (ps, mins, allowLow = false) => {
    const out = rankPlaces({ places: ps, from, mode, minutes: mins, interests: settings.interests, history, difficulty, elevations, startEle, loop, squares, allowLow }).ranked;
    for (const r of out) r.loop = loop;
    return out;
  };
  ranked = rank(places, minutes);
  ctx.others = ranked.slice(0, 30).map((r) => r.place);

  loading("load.checking");
  results = [];
  const ride = style === "twisty" || style === "straight";
  if (ride) {
    loading(style === "twisty" ? "load.curvy" : "load.open");
    results = await firstValid(await pickRide(from, ranked, style, minutes * (loop ? 0.75 : 1), speed, loop), 5);
    if (!results.length) toast(t("toast.routingOff"));
  }
  if (!results.length) results = await firstValid(pickOrder(ranked).slice(0, 9), 5);
  // Nothing interesting fits: allow plainer places, then look a bit further.
  if (!results.length && places.length) {
    ranked = rank(places, minutes, true);
    results = await firstValid(pickOrder(ranked).slice(0, 9), 5);
  }
  if (!results.length && !offline) {
    loading("load.wider");
    try {
      const wider = await load(radius * 1.6);
      ctx.allPlaces = wider.places;
      ctx.polys = wider.polys;
      ranked = rank(wider.places, minutes * 1.3, true);
      ctx.others = ranked.slice(0, 30).map((r) => r.place);
      results = await firstValid(pickOrder(ranked).slice(0, 9), 5);
    } catch {}
  }
  if (results.length) await scoreResults(results, !ride);

  clearTimeout(slowTimer);
  if (offline) toast(t("toast.offline"));
  showMore = false;
  selected = 0;
  step("results");
  if (!results.length) return renderEmpty();
  renderResults();
  select(0);
}

/** Honest empty state instead of a random point. */
function renderEmpty() {
  layers.view.clearLayers();
  markers = [];
  $("#more-btn").hidden = true;
  const order = ["short", "medium", "long"];
  const next = order[order.indexOf(choice.length) + 1];
  $("#result-list").innerHTML = `<div class="card empty-card">
    <p>${esc(t("go.nothingHere"))}</p>
    ${next ? `<button type="button" class="btn primary full" data-longer="${next}">${esc(t("go.tryLonger"))}</button>` : `<p class="hint">${esc(t("go.tryOtherMode"))}</p>`}
  </div>`;
}

/** Motorbike twisties / straights: route several candidates and keep the best roads. */
async function pickRide(from, ranked, style, minutes, speed, loop) {
  const oneWayM = (((speed * minutes * 0.4) / 60) * 1000) / DETOUR_FACTOR;
  const cands = ranked.slice(0, 5).map((r) => ({ ...r }));
  // Plus open-road targets in different directions: good roads don't need a landmark at the end.
  const base = Math.random() * 360;
  for (let i = 0; i < 4; i++) {
    const bearing = base + i * 90 + Math.random() * 40;
    const p = destination(from, bearing, oneWayM * (0.8 + Math.random() * 0.3));
    if (isRestricted(p, ctx.polys)) continue;
    const dir = t(`dir.${Math.round((((bearing % 360) + 360) % 360) / 90) % 4}`);
    cands.push({
      place: { id: `ride:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`, name: t(style === "twisty" ? "ride.curvy" : "ride.open", { dir }), kind: "ride", category: "views", mystery: true, named: false, lat: p.lat, lng: p.lng },
      distance: distance(from, p),
      isNew: true,
      reasons: [],
    });
  }
  const routed = await Promise.all(
    cands.map(async (c) => {
      const route = await fetchRoute("car", from, c.place);
      if (!route || route.duration / 60 > minutes * 0.6) return null;
      const s = rideScore(route, style);
      return {
        ...c,
        loop,
        rideRoute: route,
        score: s.score,
        estMinutes: Math.max(1, Math.round(route.duration / 60)),
        place: { ...c.place, via: viaPoints(route.points, 3) },
        reasons: [{ k: twistLabel(s.curvature) }, { k: "ride.avg", p: { v: Math.round(s.kmh) } }],
      };
    })
  );
  return routed.filter(Boolean).sort((a, b) => b.score - a.score);
}

const reasonText = (r) =>
  (r.reasons || [])
    .slice(0, 2)
    .map((x) => (typeof x === "string" ? x : t(x.k, x.p)))
    .join(" · ");

/** Distance and time shown on a card: one way, or the whole loop. */
function cardMeta(r) {
  const label = KINDS[r.place.kind] ? t(`kind.${r.place.kind}`) : "";
  const kind = label && label !== r.place.name ? `${label} · ` : "";
  return kind + distTime(r);
}

function distTime(r) {
  if (r.route) return `${formatDistance(r.route.distance)} · ${fmtMinutes(r.route.duration / 60)}${r.loop ? ` · ${t(r.outBack ? "go.outBack" : "go.loopApprox")}` : ""}`;
  if (r.loop) {
    const stops = loopStops(startPoint(), r.place);
    return `${formatDistance(loopStraightLength(stops) * DETOUR_FACTOR)} · ${fmtMinutes(r.estMinutes * 2.2)} · ${t("go.loopApprox")}`;
  }
  return `${formatDistance(r.distance)} · ${fmtMinutes(r.estMinutes)}`;
}

/** "Zábavnost 8/10 · 70 % přírodou · cestou: Studánka, Vyhlídka" */
function funLine(r) {
  const s = r.scenic;
  if (!s) return "";
  const parts = [`<b>${esc(t("fun.score", { n: Math.round(s.fun) }))}</b>`];
  if (s.green != null && s.green >= 0.15) parts.push(esc(t("fun.green", { pct: Math.round(s.green * 100) })));
  if (s.sights.length) parts.push(esc(t("fun.along", { list: s.sights.slice(0, 2).map((p) => p.name).join(", ") })));
  if (s.busy > 0.2) parts.push(`<span class="warn">${esc(t("fun.road"))}</span>`);
  return parts.join(" · ");
}

function cardHtml(r, i) {
  const p = r.place;
  const ic = p.mystery ? "map-pin-question" : KINDS[p.kind]?.icon || CATEGORIES[p.category]?.icon || "sparkles";
  const name = p.mystery && !p.via ? t("mystery.name") : p.name;
  return `<div class="card${i === 0 ? " hero" : ""}" data-i="${i}">
    <div class="photo-slot"></div>
    <div class="card-top">
      <span class="card-icon">${icon(ic)}</span>
      <div class="grow">
        <h3>${esc(name)}</h3>
        <div class="meta">${esc(cardMeta(r))}</div>
        <div class="via">${r.viaPlace ? `${icon("arrow-narrow-right")} ${esc(r.viaPlace.name)}` : ""}</div>
        <div class="fun">${funLine(r)}</div>
        ${!r.scenic && reasonText(r) ? `<div class="why">${esc(reasonText(r))}</div>` : ""}
      </div>
    </div>
    <div class="extract-slot"></div>
    ${i === selected ? `<div class="actions"><button type="button" class="btn primary grow" data-go="${i}">${esc(t("go.go"))}</button></div>` : ""}
  </div>`;
}

function renderResults() {
  layers.view.clearLayers();
  routeLine = null;
  const list = showMore ? results : results.slice(0, 1);
  $("#more-btn").hidden = showMore || results.length < 2;
  $("#result-list").innerHTML = list.map(cardHtml).join("");
  markers = list.map((r, i) =>
    L.marker([r.place.lat, r.place.lng], { icon: pinIcon(r.place.category, false, r.place.mystery, r.place.kind) })
      .on("click", () => select(i, true))
      .addTo(layers.view)
  );
  list.forEach((r, i) => loadPhoto(r, i));
}

/** Photo + two lines from Wikipedia, if the place has an article. */
async function loadPhoto(r, i) {
  const info = await placeInfo(r.place, getLang());
  const card = document.querySelector(`#result-list .card[data-i="${i}"]`);
  if (!info || !card || results[i] !== r) return;
  const slot = card.querySelector(".photo-slot");
  if (info.image) slot.innerHTML = `<img class="card-photo" src="${esc(info.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  slot.querySelector("img")?.addEventListener("error", (e) => e.target.remove());
  const text = card.querySelector(".extract-slot");
  if (info.extract) text.innerHTML = `<p class="extract">${esc(info.extract)}</p>`;
  if (info.url && info.extract)
    text.querySelector(".extract").insertAdjacentHTML(
      "beforeend",
      ` <a href="${esc(info.url)}" target="_blank" rel="noopener" class="wiki-link">${esc(t("go.readMore"))}</a>`
    );
}

$("#more-btn").addEventListener("click", () => {
  showMore = true;
  renderResults();
  select(selected);
});

async function select(i, scroll) {
  const r = results[i];
  if (!r) return;
  selected = i;
  const from = startPoint();
  document.querySelectorAll("#result-list .card").forEach((c) => {
    const on = +c.dataset.i === i;
    c.classList.toggle("selected", on);
    const act = c.querySelector(".actions");
    if (on && !act)
      c.insertAdjacentHTML("beforeend", `<div class="actions"><button type="button" class="btn primary grow" data-go="${i}">${esc(t("go.go"))}</button></div>`);
    if (!on && act) act.remove();
  });
  markers.forEach((m, j) => {
    m.setIcon(pinIcon(results[j].place.category, j === i, results[j].place.mystery, results[j].place.kind));
    m.setLatLng([results[j].place.lat, results[j].place.lng]);
    m.setZIndexOffset(j === i ? 500 : 0);
  });
  if (scroll) document.querySelector(`#result-list .card[data-i="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const draw = () => {
    if (results[i] !== r || state.view !== "go" || selected !== i) return;
    if (routeLine) layers.view.removeLayer(routeLine);
    if (r.route) {
      routeLine = L.polyline(r.route.points.map((p) => [p.lat, p.lng]), { color: "#0f766e", weight: 5, opacity: 0.9 }).addTo(layers.view);
      fitTo(r.route.points);
    } else {
      routeLine = L.polyline([[from.lat, from.lng], [r.place.lat, r.place.lng]], { color: "#0f766e", weight: 3, dashArray: "6 8" }).addTo(layers.view);
      fitTo([from, r.place]);
    }
    const card = document.querySelector(`#result-list .card[data-i="${i}"]`);
    if (card) {
      card.querySelector(".meta").textContent = cardMeta(r);
      card.querySelector(".via").innerHTML = r.viaPlace ? `${icon("arrow-narrow-right")} ${esc(r.viaPlace.name)}` : "";
      card.querySelector(".fun").innerHTML = funLine(r);
      if (r.scenic) card.querySelector(".why")?.remove();
    }
  };
  draw();
  if (r.loop && !r.loopPlanned && ctx) {
    await planLoop(r);
    draw();
  }
}

$("#result-list").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const longer = e.target.closest("[data-longer]");
  if (longer) {
    choice.length = longer.dataset.longer;
    saveSettings();
    return suggest();
  }
  const go = e.target.closest("[data-go]");
  if (go) {
    const r = results[+go.dataset.go];
    if (r.loop && !r.loopPlanned) return; // still planning the loop; the button works a moment later
    const from = startPoint();
    const place = { ...r.place, name: r.place.mystery && !r.place.via ? t("mystery.name") : r.place.name };
    startTrip(place, choice.mode, r.route?.points, { home: r.loop ? { lat: from.lat, lng: from.lng } : null, loopVia: r.loopVia || null, origin: from });
    if (state.trip?.place.id === r.place.id) {
      // Next time Go opens (after this trip), start from the first question.
      results = [];
      ranked = [];
      document.querySelectorAll("#view-go .step").forEach((st) => (st.hidden = st.dataset.step !== "mode"));
    }
    return;
  }
  const card = e.target.closest(".card");
  if (card) select(+card.dataset.i);
});

$("#reroll-btn").addEventListener("click", async () => {
  const ride = thirdStep(choice.mode) === "style" && ["twisty", "straight"].includes(choice.style);
  if (!ranked.length || ride || !ctx) return suggest();
  const shown = new Set(results.map((r) => r.place.id));
  const fresh = ranked.filter((r) => !shown.has(r.place.id));
  const pool = fresh.length ? fresh : ranked;
  const pick = surprisePick(pool);
  loading("load.checking");
  const next = await firstValid([pick, ...pool.filter((r) => r !== pick)].slice(0, 9), 5);
  if (next.length) {
    results = next;
    await scoreResults(results, false);
  }
  clearTimeout(slowTimer);
  showMore = false;
  selected = 0;
  step("results");
  renderResults();
  select(0);
});

views.go = {
  show() {
    if (state.trip) return showView("trip");
    showAllModes = false;
    renderFrom();
    renderModes();
    updateLocationStatus();
    drawStart();
    if (results.length) {
      step("results");
      renderResults();
      select(selected);
    } else step("mode");
  },
};

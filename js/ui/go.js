// "Where are you going now?" → mode → length → difficulty / ride style → suggestions.

import { $, L, esc, toast, state, settings, saveSettings, store, layers, pinIcon, fitTo, views, showView } from "../app.js";
import { icon } from "../icons.js";
import { recordChoice, splitModes, usualChoice, favourite } from "../usage.js";
import { MODES, MODE_IDS, LENGTHS, DIFFICULTIES, RIDE_STYLES, thirdStep } from "../modes.js";
import { CATEGORIES, fetchPlaces, mysterySpot } from "../places.js";
import { rankPlaces, surprisePick, searchRadius, estimateMinutes, DETOUR_FACTOR } from "../recommend.js";
import { personalSpeed } from "../stats.js";
import { fetchRoute } from "../routing.js";
import { rideScore, twistLabel, viaPoints } from "../ride.js";
import { fetchElevations } from "../elevation.js";
import { distance, destination, formatDistance } from "../geo.js";
import { startTrip } from "./trip.js";

const placeCache = new Map();
let results = [];
let markers = [];
let ranked = []; // full ranked list, so "Another" can reroll without refetching

const choice = settings.choice;

function step(name) {
  document.querySelectorAll("#view-go .step").forEach((s) => (s.hidden = s.dataset.step !== name));
  $("#view-go").scrollTop = 0;
  if (name !== "results") {
    layers.view.clearLayers();
    results = [];
  }
}

const fmtMinutes = (m) => (m < 60 ? `${m} min` : `${(m / 60).toFixed(m % 60 ? 1 : 0)} h`);
let showAllModes = false;

const optionLabel = (mode, opt) => {
  const kind = thirdStep(mode);
  if (!kind || !opt) return null;
  return (kind === "style" ? RIDE_STYLES : DIFFICULTIES)[opt]?.label;
};

function renderModes() {
  const usage = settings.usage;
  const usual = usualChoice(usage);
  const btn = $("#usual-btn");
  btn.hidden = !usual || !MODES[usual.mode];
  if (!btn.hidden) {
    const bits = [MODES[usual.mode].label, LENGTHS[usual.length]?.label, optionLabel(usual.mode, usual.option)].filter(Boolean);
    btn.innerHTML = `${icon(MODES[usual.mode].icon)}<span><b>As usual</b><small>${esc(bits.join(" · "))}</small></span>${icon("chevron-right", "go")}`;
  }
  const { top, more } = splitModes(usage, MODE_IDS, 3);
  const shown = showAllModes ? [...top, ...more] : top;
  const fav = top[0] && usage.modes[top[0]] ? top[0] : null;
  $("#mode-picker").innerHTML =
    shown
      .map((id) => `<button type="button" data-mode="${id}" class="${id === fav ? "fav" : ""}">${icon(MODES[id].icon)}${MODES[id].label}</button>`)
      .join("") + (showAllModes ? "" : `<button type="button" class="more" data-more aria-label="More">${icon("plus")}More</button>`);
}

function renderLengths() {
  const speed = personalSpeed(store.getHistory(), choice.mode);
  const m = MODES[choice.mode];
  const fav = favourite(settings.usage, choice.mode, "length") || "medium";
  $("#length-picker").innerHTML = Object.values(LENGTHS)
    .map((l) => {
      const min = m.lengths[l.id];
      const km = (speed * min * 0.6) / 60 / DETOUR_FACTOR;
      return `<button type="button" data-length="${l.id}" class="${fav === l.id ? "fav" : ""}"><b>${l.label}</b><small>${fmtMinutes(min)} · ${formatDistance(km * 1000)}</small></button>`;
    })
    .join("");
}

function renderOptions() {
  const kind = thirdStep(choice.mode);
  const opts = kind === "style" ? RIDE_STYLES : DIFFICULTIES;
  const fav = favourite(settings.usage, choice.mode, "option") || (kind === "style" ? "place" : "moderate");
  $("#option-title").textContent = kind === "style" ? "What kind of ride?" : "How hard?";
  $("#option-picker").innerHTML = Object.values(opts)
    .map((o) => `<button type="button" data-option="${o.id}" class="${fav === o.id ? "fav" : ""}"><b>${o.label}</b><small>${o.hint}</small></button>`)
    .join("");
}

$("#mode-picker").addEventListener("click", (e) => {
  if (e.target.closest("[data-more]")) {
    showAllModes = true;
    renderModes();
    return;
  }
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  choice.mode = b.dataset.mode;
  saveSettings();
  renderLengths();
  step("length");
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

async function loadPlaces(from, radius) {
  const key = `${from.lat.toFixed(3)},${from.lng.toFixed(3)},${Math.round(radius / 500)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const places = await fetchPlaces(from, radius);
  placeCache.set(key, places);
  return places;
}

function loading(text) {
  $("#loading-text").textContent = text;
  step("loading");
}

async function suggest() {
  if (!state.position) {
    toast("Need your location — allow GPS, or tap the map to set a start point.");
    step("mode");
    return;
  }
  const history = store.getHistory();
  const from = { ...state.position };
  const mode = choice.mode;
  const minutes = MODES[mode].lengths[choice.length];
  const speed = personalSpeed(history, mode);
  const kind = thirdStep(mode);
  const difficulty = kind === "difficulty" ? choice.difficulty : "moderate";
  const style = kind === "style" ? choice.style : "place";
  recordChoice(settings.usage, { mode, length: choice.length, option: kind === "style" ? style : kind ? difficulty : null });
  saveSettings();

  loading("Looking around");
  let places = [];
  let offline = false;
  try {
    places = await loadPlaces(from, searchRadius(minutes, speed));
  } catch {
    offline = true;
  }

  // Difficulty needs to know which places are uphill.
  let elevations = null;
  let startEle = null;
  if (!offline && difficulty !== "moderate" && places.length) {
    loading("Checking the hills");
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

  ({ ranked } = rankPlaces({ places, from, mode, minutes, interests: settings.interests, history, difficulty, elevations, startEle }));

  // Always somewhere to go: a mystery spot at a good distance.
  const target = minutes * (difficulty === "easy" ? 0.25 : difficulty === "hard" ? 0.45 : 0.35);
  const mysteryEntry = () => {
    const p = mysterySpot(from, ((speed * target) / 60) * 1000 / DETOUR_FACTOR);
    return { place: p, score: 0, distance: distance(from, p), estMinutes: Math.round(target), isNew: true, reasons: ["Random point. See what's there."] };
  };

  if (style === "twisty" || style === "straight") {
    loading(style === "twisty" ? "Finding curvy roads" : "Finding open roads");
    results = await pickRide(from, ranked, style, minutes, speed);
    if (!results.length) toast("Routing is offline, showing places instead");
  } else results = [];

  if (!results.length) {
    const pick = surprisePick(ranked);
    results = pick ? [pick, ...ranked.filter((r) => r !== pick).slice(0, 4)] : [];
    results.push(mysteryEntry());
  }

  if (offline) toast("Offline. Here's a random spot instead.");
  else if (!ranked.length && style === "place") toast("Nothing nearby fits. Try longer.");
  showMore = false;
  step("results");
  renderResults();
  select(0);
}

/** Motorbike twisties / straights: route several candidates and keep the best roads. */
async function pickRide(from, ranked, style, minutes, speed) {
  const oneWayM = ((speed * minutes * 0.4) / 60) * 1000 / DETOUR_FACTOR;
  const cands = ranked.slice(0, 5).map((r) => r);
  // Plus open-road targets in different directions — good roads don't need a landmark at the end.
  const base = Math.random() * 360;
  for (let i = 0; i < 4; i++) {
    const p = destination(from, base + i * 90 + Math.random() * 40, oneWayM * (0.8 + Math.random() * 0.3));
    cands.push({
      place: { id: `ride:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`, name: `${style === "twisty" ? "Curvy" : "Open"} roads ${["north", "east", "south", "west"][Math.round(((base + i * 90) % 360) / 90) % 4]}`, kind: "ride destination", category: "views", mystery: true, named: false, lat: p.lat, lng: p.lng },
      distance: distance(from, p),
      isNew: true,
      reasons: [],
    });
  }
  const routed = await Promise.all(
    cands.map(async (c) => {
      const route = await fetchRoute("car", from, c.place);
      if (!route) return null;
      if (route.duration / 60 > minutes * 0.6) return null;
      const s = rideScore(route, style);
      state.routes.set(c.place.id, route);
      return {
        ...c,
        score: s.score,
        estMinutes: Math.max(1, Math.round(route.duration / 60)),
        place: { ...c.place, via: viaPoints(route.points, 3) },
        reasons: [`${twistLabel(s.curvature)}`, `avg ${Math.round(s.kmh)} km/h`],
      };
    })
  );
  return routed.filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 6);
}

let showMore = false;
const reasonText = (r) => (r.reasons?.length ? r.reasons.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(" · ") : "");

function renderResults() {
  layers.view.clearLayers();
  const mode = choice.mode;
  const list = showMore ? results : results.slice(0, 1);
  $("#more-btn").hidden = showMore || results.length < 2;
  $("#result-list").innerHTML = list
    .map((r, i) => {
      const p = r.place;
      const ic = p.mystery ? "map-pin-question" : CATEGORIES[p.category]?.icon || "sparkles";
      return `<div class="card${i === 0 ? " hero" : ""}" data-i="${i}">
        <div class="card-top">
          <span class="card-icon">${icon(ic)}</span>
          <div class="grow">
            <h3>${esc(p.name)}</h3>
            <div class="meta">${formatDistance(r.distance)} · ${r.estMinutes} min</div>
            ${reasonText(r) ? `<div class="why">${esc(reasonText(r))}</div>` : ""}
          </div>
        </div>
        ${i === 0 ? `<div class="actions"><button type="button" class="btn primary grow" data-go="${i}">Go</button></div>` : ""}
      </div>`;
    })
    .join("");
  markers = list.map((r, i) =>
    L.marker([r.place.lat, r.place.lng], { icon: pinIcon(r.place.category, false, r.place.mystery) })
      .on("click", () => select(i, true))
      .addTo(layers.view)
  );
}

$("#more-btn").addEventListener("click", () => {
  showMore = true;
  renderResults();
  select(0);
});

let routeLine = null;
async function select(i, scroll) {
  const r = results[i];
  if (!r) return;
  document.querySelectorAll("#result-list .card").forEach((c) => {
    const on = +c.dataset.i === i;
    c.classList.toggle("selected", on);
    // Move the "Let's go" button to the selected card.
    const act = c.querySelector(".actions");
    if (on && !act) c.insertAdjacentHTML("beforeend", `<div class="actions"><button type="button" class="btn primary grow" data-go="${i}">Go</button></div>`);
    if (!on && act) act.remove();
  });
  markers.forEach((m, j) => {
    m.setIcon(pinIcon(results[j].place.category, j === i, results[j].place.mystery));
    m.setZIndexOffset(j === i ? 500 : 0);
  });
  if (scroll) document.querySelector(`#result-list .card[data-i="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  fitTo([state.position, r.place]);

  if (routeLine) layers.view.removeLayer(routeLine);
  routeLine = L.polyline([[state.position.lat, state.position.lng], [r.place.lat, r.place.lng]], { color: "#0f766e", weight: 3, dashArray: "6 8" }).addTo(layers.view);
  let route = state.routes.get(r.place.id);
  if (!route) {
    route = await fetchRoute(MODES[choice.mode].routingProfile, state.position, r.place);
    if (route) state.routes.set(r.place.id, route);
  }
  if (route && results[i] === r && state.view === "go") {
    layers.view.removeLayer(routeLine);
    routeLine = L.polyline(route.points.map((p) => [p.lat, p.lng]), { color: "#0f766e", weight: 5, opacity: 0.9 }).addTo(layers.view);
  }
}

$("#result-list").addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) {
    const r = results[+go.dataset.go];
    startTrip(r.place, choice.mode, state.routes.get(r.place.id)?.points);
    if (state.trip?.place === r.place) {
      // Next time Go is opened (after this trip) start from the first question.
      results = [];
      ranked = [];
      document.querySelectorAll("#view-go .step").forEach((st) => (st.hidden = st.dataset.step !== "mode"));
    }
    return;
  }
  const card = e.target.closest(".card");
  if (card) select(+card.dataset.i);
});

$("#reroll-btn").addEventListener("click", () => {
  if (!ranked.length || ["twisty", "straight"].includes(thirdStep(choice.mode) === "style" ? choice.style : "")) return suggest();
  const shown = new Set(results.map((r) => r.place.id));
  const fresh = ranked.filter((r) => !shown.has(r.place.id));
  const pool = fresh.length ? fresh : ranked;
  const pick = surprisePick(pool);
  const mystery = results.find((r) => r.place.mystery);
  results = [pick, ...pool.filter((r) => r !== pick).slice(0, 4), ...(mystery ? [mystery] : [])];
  showMore = false;
  renderResults();
  select(0);
});

views.go = {
  show() {
    if (state.trip) return showView("trip");
    showAllModes = false;
    renderModes();
    if (results.length) {
      renderResults();
      step("results");
    } else step("mode");
  },
};

/** Only shown when something needs the user's attention (no GPS). */
export function setLocationStatus(text) {
  $("#location-status").textContent = text || "";
  $("#location-status").hidden = !text;
}

export function resetGo() {
  results = [];
  ranked = [];
  step("mode");
}

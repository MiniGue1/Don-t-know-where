// "Where are you going now?" → mode → length → difficulty / ride style → suggestions.

import { $, L, esc, toast, state, settings, saveSettings, store, layers, map, pinIcon, fitTo, views, showView } from "../app.js";
import { MODES, MODE_IDS, LENGTHS, DIFFICULTIES, RIDE_STYLES, thirdStep } from "../modes.js";
import { CATEGORIES, CATEGORY_IDS, fetchPlaces, mysterySpot } from "../places.js";
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

function renderModes() {
  $("#mode-picker").innerHTML = MODE_IDS.map(
    (id) =>
      `<button type="button" data-mode="${id}" class="${choice.mode === id ? "last" : ""}"><span>${MODES[id].icon}</span>${MODES[id].label}</button>`
  ).join("");
}

function renderLengths() {
  const speed = personalSpeed(store.getHistory(), choice.mode);
  const m = MODES[choice.mode];
  $("#length-picker").innerHTML = Object.values(LENGTHS)
    .map((l) => {
      const min = m.lengths[l.id];
      const km = (speed * min * 0.6) / 60 / DETOUR_FACTOR;
      const ic = { short: "🟢", medium: "🟡", long: "🔴" }[l.id];
      return `<button type="button" data-length="${l.id}" class="${choice.length === l.id ? "last" : ""}">
        <span class="ic">${ic}</span><span><b>${l.label}</b><small>about ${fmtMinutes(min)} · up to ${formatDistance(km * 1000)} away</small></span></button>`;
    })
    .join("");
}

function renderOptions() {
  const kind = thirdStep(choice.mode);
  const opts = kind === "style" ? RIDE_STYLES : DIFFICULTIES;
  const cur = kind === "style" ? choice.style : choice.difficulty;
  $("#option-title").textContent = kind === "style" ? "What kind of ride?" : "How hard?";
  $("#option-picker").innerHTML = Object.values(opts)
    .map(
      (o) =>
        `<button type="button" data-option="${o.id}" class="${cur === o.id ? "last" : ""}"><span class="ic">${o.icon}</span><span><b>${o.label}</b><small>${o.hint}</small></span></button>`
    )
    .join("");
  $("#interest-picker").innerHTML = CATEGORY_IDS.map(
    (c) => `<button type="button" data-cat="${c}" aria-pressed="${settings.interests.includes(c)}">${CATEGORIES[c].icon} ${CATEGORIES[c].label}</button>`
  ).join("");
}

$("#mode-picker").addEventListener("click", (e) => {
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

$("#interest-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  const c = b.dataset.cat;
  settings.interests = settings.interests.includes(c) ? settings.interests.filter((x) => x !== c) : [...settings.interests, c];
  saveSettings();
  b.setAttribute("aria-pressed", settings.interests.includes(c));
});

document.querySelectorAll("#view-go [data-back]").forEach((b) =>
  b.addEventListener("click", () => {
    let target = b.dataset.back;
    if (target === "option" && !thirdStep(choice.mode)) target = "length";
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

  loading("Looking around…");
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
    loading("Checking the hills…");
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
    return { place: p, score: 0, distance: distance(from, p), estMinutes: Math.round(target), isNew: true, reasons: ["a random point — pure adventure"] };
  };

  if (style === "twisty" || style === "straight") {
    loading(style === "twisty" ? "Hunting for bends…" : "Finding open roads…");
    results = await pickRide(from, ranked, style, minutes, speed);
    if (!results.length) toast("Couldn't reach the routing service — showing places instead.");
  } else results = [];

  if (!results.length) {
    const pick = surprisePick(ranked);
    results = pick ? [pick, ...ranked.filter((r) => r !== pick).slice(0, 4)] : [];
    results.push(mysteryEntry());
  }

  $("#results-meta").textContent = offline
    ? "Offline — mystery spot"
    : `${MODES[mode].icon} ${LENGTHS[choice.length].label.toLowerCase()} · ${speed.toFixed(1)} km/h`;
  if (offline) toast("Couldn't reach the map service — here's a mystery spot instead.");
  else if (!ranked.length && style === "place") toast("Nothing mapped nearby fits — try longer.");
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
      place: { id: `ride:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`, name: `${style === "twisty" ? "Twisty" : "Open-road"} ride ${["north", "east", "south", "west"][Math.round(((base + i * 90) % 360) / 90) % 4]}`, kind: "ride destination", category: "views", mystery: true, named: false, lat: p.lat, lng: p.lng },
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
        reasons: [`${twistLabel(s.curvature)} (${Math.round(s.curvature)}°/km)`, `avg ${Math.round(s.kmh)} km/h`, ...c.reasons.slice(0, 1)],
      };
    })
  );
  return routed.filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 6);
}

function renderResults() {
  layers.view.clearLayers();
  const mode = choice.mode;
  $("#result-list").innerHTML = results
    .map((r, i) => {
      const p = r.place;
      const icon = p.mystery ? "❓" : CATEGORIES[p.category]?.icon || "📍";
      return `${i === 1 ? '<span class="label" style="margin-top:6px">Other ideas</span>' : ""}
      <div class="card${i === 0 ? " hero" : ""}" data-i="${i}">
        <div class="card-top">
          <span class="card-icon">${icon}</span>
          <div class="grow">
            <h3>${esc(p.name)}${r.isNew ? '<span class="badge">NEW</span>' : ""}</h3>
            <div class="meta">${esc(p.kind)} · ${formatDistance(r.distance)} away · ~${r.estMinutes} min ${MODES[mode].icon}</div>
            ${r.reasons?.length ? `<div class="why">${esc(r.reasons.join(" · "))}</div>` : ""}
          </div>
        </div>
        ${i === 0 ? `<div class="actions"><button type="button" class="btn primary grow" data-go="${i}">Let's go</button></div>` : ""}
      </div>`;
    })
    .join("");
  markers = results.map((r, i) =>
    L.marker([r.place.lat, r.place.lng], { icon: pinIcon(r.place.category, false, r.place.mystery) })
      .on("click", () => select(i, true))
      .addTo(layers.view)
  );
}

let routeLine = null;
async function select(i, scroll) {
  const r = results[i];
  if (!r) return;
  document.querySelectorAll("#result-list .card").forEach((c) => {
    const on = +c.dataset.i === i;
    c.classList.toggle("selected", on);
    // Move the "Let's go" button to the selected card.
    const act = c.querySelector(".actions");
    if (on && !act) c.insertAdjacentHTML("beforeend", `<div class="actions"><button type="button" class="btn primary grow" data-go="${i}">Let's go</button></div>`);
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
  renderResults();
  select(0);
});

views.go = {
  show() {
    if (state.trip) return showView("trip");
    renderModes();
    if (results.length) {
      renderResults();
      step("results");
    } else step("mode");
  },
};

export function setLocationStatus(text) {
  $("#location-status").textContent = text;
}

export function resetGo() {
  results = [];
  ranked = [];
  step("mode");
}

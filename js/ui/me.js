// Me: records, learned interests, watch / heart-rate, body profile, settings, data.

import { $, esc, toast, state, settings, saveSettings, store, views, downloadFile } from "../app.js";
import { MODES, MODE_IDS, formatSpeed } from "../modes.js";
import { PROVIDERS } from "../maplinks.js";
import { records } from "../stats.js";
import { formatDistance } from "../geo.js";
import { hrmSupported, connectHrm } from "../hrm.js";
import { onHeartRate } from "./trip.js";

function render() {
  const history = store.getHistory();
  const r = records(history);
  const kcal = history.reduce((s, t) => s + (t.kcal || 0), 0);
  const rows = [
    ["Places", r.placesVisited],
    ["Distance", formatDistance(r.totalDistance)],
    ["Calories", `${kcal.toLocaleString()} kcal`],
  ];
  if (r.longestTrip) rows.push(["Longest", formatDistance(r.longestTrip.distance)]);
  for (const id of MODE_IDS) {
    const m = r.byMode[id];
    if (!m) continue;
    const avg = formatSpeed(id, m.avgSpeedKmh);
    const best = formatSpeed(id, m.fastest.speedKmh);
    rows.push([`${MODES[id].label} pace`, `${avg.value} ${avg.unit}, best ${best.value}`]);
  }
  $("#records").innerHTML = rows.map(([k, v]) => `<div class="record"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");


  $("#provider-picker").innerHTML = Object.values(PROVIDERS)
    .map((p) => `<button type="button" role="radio" data-provider="${p.id}" aria-checked="${settings.provider === p.id}">${p.label}</button>`)
    .join("");

  $("#p-weight").value = settings.profile.weightKg || "";
  $("#p-age").value = settings.profile.age || "";
  $("#p-sex").value = settings.profile.sex || "";
  renderHrm();
}

function renderHrm() {
  const c = state.hr.conn;
  $("#hrm-status").textContent = c ? `${c.name}${state.hr.bpm ? ` · ${state.hr.bpm} bpm` : ""}` : hrmSupported() ? "Not connected" : "Not supported in this browser";
  $("#hrm-btn").textContent = c ? "Disconnect" : "Connect";
  $("#hrm-btn").disabled = !hrmSupported();
  $("#hr-pill").hidden = !c;
}

$("#hrm-btn").addEventListener("click", async () => {
  if (state.hr.conn) {
    state.hr.conn.disconnect();
    return;
  }
  try {
    state.hr.conn = await connectHrm(
      (bpm) => {
        state.hr.bpm = bpm;
        state.hr.at = Date.now();
        $("#hr-value").textContent = bpm;
        onHeartRate(bpm);
        if (state.view === "me") renderHrm();
      },
      () => {
        state.hr = { conn: null, bpm: null, at: 0 };
        renderHrm();
        toast("Heart rate disconnected");
      }
    );
    toast(`Connected to ${state.hr.conn.name}`);
  } catch (e) {
    if (e?.name !== "NotFoundError") toast("Couldn't connect", 3000);
  }
  renderHrm();
});

$("#provider-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-provider]");
  if (!b) return;
  settings.provider = b.dataset.provider;
  saveSettings();
  render();
});

for (const [sel, key, parse] of [
  ["#p-weight", "weightKg", (v) => (v >= 25 && v <= 250 ? v : 70)],
  ["#p-age", "age", (v) => (v >= 10 && v <= 100 ? v : null)],
  ["#p-sex", "sex", (v) => v],
]) {
  $(sel).addEventListener("change", (e) => {
    const raw = e.target.value;
    settings.profile[key] = key === "sex" ? raw : parse(+raw);
    saveSettings();
  });
}

$("#export-btn").addEventListener("click", () => {
  const data = {
    app: "dont-know-where",
    exportedAt: new Date().toISOString(),
    history: store.getHistory(),
    routes: store.getRoutes(),
    friends: store.getFriends(),
    identity: store.getIdentity(),
    settings,
  };
  downloadFile(`dont-know-where-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
});

$("#clear-btn").addEventListener("click", () => {
  if (!confirm("Delete everything? This can't be undone.")) return;
  store.clearAll();
  location.reload();
});

views.me = { show: render };

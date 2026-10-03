// Friends leaderboard without servers or accounts: everyone keeps their own stats,
// and you swap a small "card" link with friends. Nothing is uploaded anywhere.

import { visitedIds, streakDays } from "./stats.js";
import { visitedSquares } from "./explore.js";

const NAMES = {
  en: {
    adj: ["Wandering", "Curious", "Speedy", "Lost", "Sneaky", "Brave", "Sleepy", "Wild", "Jolly", "Restless", "Lucky", "Dizzy"],
    noun: ["Otter", "Fox", "Moose", "Badger", "Goat", "Owl", "Panda", "Hedgehog", "Llama", "Raccoon", "Yak", "Penguin"],
  },
  // Czech adjectives must agree in gender with the noun, so these are kept as whole names.
  cs: [
    "Bloudivá Vydra", "Zvědavá Liška", "Rychlý Los", "Ztracený Jezevec", "Tichá Sova", "Odvážný Kozel",
    "Ospalá Panda", "Divoký Ježek", "Veselá Lama", "Neposedný Mýval", "Šťastný Jak", "Zmatený Tučňák",
  ],
};
// Avatar = a colour; shown as a circle with the nickname's initials.
export const AVATAR_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#be123c"];
const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** Stable colour for an id (used when a card carries no valid colour). */
export function colorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0].toUpperCase())
    .join("");

export function newIdentity(rand = Math.random, lang = "en") {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  return {
    id: Array.from({ length: 10 }, () => Math.floor(rand() * 36).toString(36)).join(""),
    name: lang === "cs" ? pick(NAMES.cs) : `${pick(NAMES.en.adj)} ${pick(NAMES.en.noun)}`,
    avatar: pick(AVATAR_COLORS),
  };
}

const WEEK = 7 * 86400000;

/** Start of the current week (Monday 00:00 local). */
export function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The numbers that go on your card. `kcal` maps a trip to calories. */
export function myStats(history, kcal = () => 0, now = Date.now()) {
  const ws = weekStart(now);
  const week = history.filter((t) => t.startedAt >= ws);
  const human = (t) => t.mode === "walk" || t.mode === "run" || t.mode === "bike";
  return {
    weekKm: +(week.filter(human).reduce((s, t) => s + (t.distance || 0), 0) / 1000).toFixed(1),
    weekKcal: Math.round(week.reduce((s, t) => s + kcal(t), 0)),
    places: visitedIds(history).size,
    squares: visitedSquares(history).size,
    streak: streakDays(history, now),
    totalKm: +(history.reduce((s, t) => s + (t.distance || 0), 0) / 1000).toFixed(1),
    week: ws,
  };
}

// --- share codes: base64url(JSON), compact keys ---------------------------------

const b64url = {
  enc: (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec: (s) => {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};

export function encodeCard(identity, stats, now = Date.now()) {
  return b64url.enc(
    JSON.stringify({
      v: 1,
      i: identity.id,
      n: identity.name.slice(0, 32),
      a: identity.avatar,
      wk: stats.weekKm,
      wc: stats.weekKcal,
      p: stats.places,
      s: stats.streak,
      tk: stats.totalKm,
      q: stats.squares,
      w: stats.week,
      u: now,
    })
  );
}

export function decodeCard(code) {
  const o = JSON.parse(b64url.dec(String(code).trim()));
  if (o?.v !== 1 || typeof o.i !== "string" || typeof o.n !== "string") throw new Error("Not a valid card");
  const n = (x) => (typeof x === "number" && isFinite(x) && x >= 0 ? x : 0);
  return {
    id: o.i.slice(0, 20),
    name: o.n.slice(0, 32),
    avatar: isColor(o.a) ? o.a : colorFor(o.i),
    stats: { weekKm: n(o.wk), weekKcal: n(o.wc), places: n(o.p), squares: n(o.q), streak: n(o.s), totalKm: n(o.tk), week: n(o.w) },
    updatedAt: n(o.u),
  };
}

/** Pull a card code out of a pasted link or raw code. */
export function extractCode(text) {
  const m = String(text).match(/[#&?]friend=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  const t = String(text).trim();
  return /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : null;
}

// Labels and units are i18n keys: board.<id> and unit.<id>.
export const BOARDS = {
  weekKm: { id: "weekKm", weekly: true },
  squares: { id: "squares" },
  places: { id: "places" },
  streak: { id: "streak" },
};

/** Ranked rows for a board. Weekly boards zero out friends' cards from older weeks. */
export function rankBoard(board, me, friends, now = Date.now()) {
  const ws = weekStart(now);
  const rows = [{ ...me, isMe: true }, ...friends].map((p) => {
    const stale = BOARDS[board].weekly && (p.stats.week || 0) < ws;
    return { id: p.id, name: p.name, avatar: p.avatar, isMe: !!p.isMe, value: stale ? 0 : p.stats[board] || 0, updatedAt: p.updatedAt };
  });
  rows.sort((a, b) => b.value - a.value || (a.isMe ? -1 : 1));
  rows.forEach((r, i) => (r.rank = i > 0 && r.value === rows[i - 1].value ? rows[i - 1].rank : i + 1));
  return rows;
}

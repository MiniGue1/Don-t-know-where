// Remembers what the user picks most, so the start screen can lead with it.

export const emptyUsage = () => ({ modes: {}, combos: {} });

const key = ({ mode, length, option }) => `${mode}|${length}|${option || ""}`;

/** Count a choice. Mutates and returns `usage`. */
export function recordChoice(usage, choice, now = Date.now()) {
  usage.modes[choice.mode] = (usage.modes[choice.mode] || 0) + 1;
  const k = key(choice);
  const c = usage.combos[k] || { n: 0, last: 0 };
  usage.combos[k] = { n: c.n + 1, last: now };
  return usage;
}

/** Modes split into the few shown up front and the rest behind "+". */
export function splitModes(usage, order, shown = 3) {
  const rank = [...order].sort((a, b) => (usage.modes[b] || 0) - (usage.modes[a] || 0) || order.indexOf(a) - order.indexOf(b));
  return { top: rank.slice(0, shown), more: rank.slice(shown) };
}

/** The user's usual combo (picked at least twice), or null. */
export function usualChoice(usage) {
  let best = null;
  for (const [k, v] of Object.entries(usage.combos)) {
    if (v.n < 2) continue;
    if (!best || v.n > best.n || (v.n === best.n && v.last > best.last)) best = { k, ...v };
  }
  if (!best) return null;
  const [mode, length, option] = best.k.split("|");
  return { mode, length, option: option || null, n: best.n };
}

/** Most picked value of `field` ("length" | "option") for a mode, or null. */
export function favourite(usage, mode, field) {
  const idx = field === "length" ? 1 : 2;
  const tally = {};
  for (const [k, v] of Object.entries(usage.combos)) {
    const parts = k.split("|");
    if (parts[0] !== mode || !parts[idx]) continue;
    tally[parts[idx]] = (tally[parts[idx]] || 0) + v.n;
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

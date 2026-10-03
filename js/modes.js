// Travel modes (icon = Tabler icon name) and the defaults used before we know how fast the user is.

export const MODES = {
  walk: {
    id: "walk",
    label: "Walk",
    icon: "walk",
    defaultSpeedKmh: 4.8,
    routingProfile: "foot",
    arriveRadius: 40,
    lengths: { short: 20, medium: 45, long: 90 },
    pace: true,
  },
  run: {
    id: "run",
    label: "Run",
    icon: "run",
    defaultSpeedKmh: 9.5,
    routingProfile: "foot",
    arriveRadius: 40,
    lengths: { short: 20, medium: 40, long: 75 },
    pace: true, // show min/km instead of km/h
  },
  bike: {
    id: "bike",
    label: "Cycle",
    icon: "bike",
    defaultSpeedKmh: 15,
    routingProfile: "bike",
    arriveRadius: 60,
    lengths: { short: 30, medium: 60, long: 120 },
  },
  moto: {
    id: "moto",
    label: "Motorbike",
    icon: "motorbike",
    defaultSpeedKmh: 45,
    routingProfile: "car",
    arriveRadius: 120,
    lengths: { short: 45, medium: 90, long: 180 },
  },
  car: {
    id: "car",
    label: "Car",
    icon: "car",
    defaultSpeedKmh: 40,
    routingProfile: "car",
    arriveRadius: 150,
    lengths: { short: 30, medium: 60, long: 120 },
  },
};

export const MODE_IDS = Object.keys(MODES);

export const LENGTHS = {
  short: { id: "short", label: "Short" },
  medium: { id: "medium", label: "Medium" },
  long: { id: "long", label: "Long" },
};

export const DIFFICULTIES = {
  easy: { id: "easy", label: "Easy", hint: "Flat and close" },
  moderate: { id: "moderate", label: "Moderate", hint: "A bit of everything" },
  hard: { id: "hard", label: "Hard", hint: "Hills, further out" },
};

export const RIDE_STYLES = {
  twisty: { id: "twisty", label: "Twisties", hint: "Curvy roads" },
  straight: { id: "straight", label: "Straights", hint: "Fast, open roads" },
  place: { id: "place", label: "A place", hint: "Somewhere worth a stop" },
};

/** Which question step 3 asks for a mode: difficulty, ride style, or nothing. */
export function thirdStep(mode) {
  if (mode === "moto") return "style";
  if (mode === "car") return null;
  return "difficulty";
}

/** Speed shown the way athletes expect it: pace (min/km) for feet, km/h otherwise. */
export function formatSpeed(mode, kmh) {
  if (!kmh || !isFinite(kmh)) return { value: "–", unit: MODES[mode]?.pace ? "min/km" : "km/h" };
  if (MODES[mode]?.pace) {
    const secPerKm = 3600 / kmh;
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return { value: `${m}:${String(s === 60 ? 59 : s).padStart(2, "0")}`, unit: "min/km" };
  }
  return { value: kmh.toFixed(1), unit: "km/h" };
}

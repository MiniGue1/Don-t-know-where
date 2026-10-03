// Calorie estimates. Uses heart rate when a watch is connected (Keytel et al. 2005),
// otherwise MET values from the Compendium of Physical Activities.

// [speed km/h, MET] — linearly interpolated.
const MET_TABLES = {
  walk: [[2, 2.0], [3.2, 2.8], [4, 3.0], [4.8, 3.5], [5.6, 4.3], [6.4, 5.0], [7.2, 7.0], [8, 8.3]],
  run: [[6.4, 6.0], [8, 8.3], [9.7, 9.8], [11.3, 11.0], [12.9, 11.8], [14.5, 12.8], [16, 14.5], [19, 16.0]],
  bike: [[8, 3.5], [16, 5.8], [19, 6.8], [22, 8.0], [25, 10.0], [30, 12.0], [35, 15.8]],
  moto: [[0, 3.5]],
  car: [[0, 2.5]],
};
const RESTING_MET = 1.3; // standing around at the destination

export function metFor(mode, kmh) {
  const t = MET_TABLES[mode] || MET_TABLES.walk;
  if (kmh <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (kmh <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      return y0 + ((y1 - y0) * (kmh - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}

/** kcal per minute from heart rate. Needs age and sex; returns null otherwise. */
export function keytelKcalPerMin(hr, { weightKg, age, sex }) {
  if (!hr || !age || !weightKg || (sex !== "m" && sex !== "f")) return null;
  const kj =
    sex === "m"
      ? -55.0969 + 0.6309 * hr + 0.1988 * weightKg + 0.2017 * age
      : -20.4022 + 0.4472 * hr - 0.1263 * weightKg + 0.074 * age;
  return Math.max(0, kj / 4.184);
}

/**
 * Estimate calories for a finished trip record.
 * profile: { weightKg, age?, sex? ("m" | "f") }
 */
export function tripCalories(trip, profile = {}) {
  const weightKg = profile.weightKg || 70;
  const movingSec = trip.travelSec ?? Math.max(0, (trip.endedAt - trip.startedAt) / 1000 - (trip.dwellSec || 0));
  const dwellSec = trip.dwellSec || 0;

  const hrRate = keytelKcalPerMin(trip.avgHr, { ...profile, weightKg });
  const moving =
    hrRate != null && (trip.mode === "walk" || trip.mode === "run" || trip.mode === "bike")
      ? (hrRate * movingSec) / 60
      : (metFor(trip.mode, trip.avgSpeedKmh || 0) * weightKg * movingSec) / 3600;
  const resting = (RESTING_MET * weightKg * dwellSec) / 3600;
  return Math.round(moving + resting);
}

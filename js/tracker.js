// Records one outing: the GPS track, when you arrived, and how long you stayed.
// Pure logic (no browser APIs) so it can be unit-tested.

import { distance } from "./geo.js";
import { elevationGain } from "./elevation.js";
import { MODES } from "./modes.js";

const MAX_ACCURACY_M = 60; // ignore fixes worse than this
const MIN_STEP_M = 3; // ignore GPS jitter smaller than this

export class TripTracker {
  constructor({ mode, place, startedAt = Date.now(), id, home = null }) {
    this.id = id || `trip-${startedAt}`;
    this.mode = mode;
    this.place = place;
    this.startedAt = startedAt;
    this.arriveRadius = MODES[mode]?.arriveRadius ?? 50;
    this.track = [];
    this.distance = 0; // metres travelled in total
    this.distanceToArrival = null;
    this.arrivedAt = null;
    this.dwellSec = 0;
    this.maxSpeedKmh = 0;
    this.hr = []; // [[t, bpm], ...] from a connected watch / strap
    this.home = home ? { lat: home.lat, lng: home.lng } : null; // loops: where to come back to
    this.homeAt = null;
    this._lastNear = null; // timestamp of last fix that was at the place
  }

  get arrived() {
    return this.arrivedAt != null;
  }

  /** Distance (m) from the latest fix to the destination. */
  remaining() {
    const last = this.track[this.track.length - 1];
    return last ? distance(last, this.place) : null;
  }

  /**
   * Feed a GPS fix { lat, lng, t (ms), accuracy? }.
   * Returns "arrived" the first time the destination is reached, otherwise null.
   */
  addPoint(fix) {
    if (fix.accuracy != null && fix.accuracy > MAX_ACCURACY_M) return null;
    const p = { lat: fix.lat, lng: fix.lng, t: fix.t };
    if (fix.ele != null && isFinite(fix.ele)) p.ele = fix.ele;
    const prev = this.track[this.track.length - 1];
    if (prev) {
      if (p.t <= prev.t) return null;
      const step = distance(prev, p);
      if (step < MIN_STEP_M) {
        // Standing still: still counts toward time at the place.
        this._accumulateDwell(p);
        return null;
      }
      const speedKmh = (step / ((p.t - prev.t) / 1000)) * 3.6;
      // Discard teleports (GPS glitches) that are implausibly fast for the mode.
      if (speedKmh > (MODES[this.mode]?.defaultSpeedKmh ?? 50) * 4 + 20) return null;
      this.distance += step;
      if (step > 15) this.maxSpeedKmh = Math.max(this.maxSpeedKmh, speedKmh);
    }
    this.track.push(p);

    let event = null;
    const near = distance(p, this.place) <= this.arriveRadius;
    if (this.arrived && this.home && this.homeAt == null && distance(p, this.home) <= this.arriveRadius * 1.5) {
      this.homeAt = p.t;
      this._accumulateDwell(p);
      return "home";
    }
    if (near && !this.arrived) {
      this.arrivedAt = p.t;
      this.distanceToArrival = this.distance;
      this._lastNear = p.t;
      event = "arrived";
    } else {
      this._accumulateDwell(p);
    }
    return event;
  }

  /** Heart-rate sample from a connected sensor. Thinned to one per 5 s. */
  addHeartRate(bpm, t = Date.now()) {
    const last = this.hr[this.hr.length - 1];
    if (last && t - last[0] < 5000) return;
    this.hr.push([t, bpm]);
  }

  /** Manual "I'm here" — for when GPS missed the arrival (e.g. app was in the background). */
  markArrived(t = Date.now()) {
    if (this.arrived) return;
    this.arrivedAt = t;
    this.distanceToArrival = this.distance;
    this._lastNear = t;
  }

  _accumulateDwell(p) {
    if (!this.arrived) return;
    const d = distance(p, this.place);
    const near = d <= this.arriveRadius * 1.5;
    if (this._lastNear != null) {
      const gap = (p.t - this._lastNear) / 1000;
      if (near) this.dwellSec += gap;
      else {
        // Phones send few fixes while you stand still, so the first fix after leaving
        // can come much later. Count that gap, minus the time it took to walk away.
        const speed = (MODES[this.mode]?.defaultSpeedKmh ?? 5) / 3.6;
        this.dwellSec += Math.max(0, gap - Math.max(0, d - this.arriveRadius) / speed);
      }
    }
    this._lastNear = near ? p.t : null;
  }

  /** Finish the trip and produce the record stored in history. */
  finish(endedAt = Date.now()) {
    if (this._lastNear != null && endedAt > this._lastNear) {
      this.dwellSec += (endedAt - this._lastNear) / 1000;
      this._lastNear = null;
    }
    const travelSec = this.arrived ? (this.arrivedAt - this.startedAt) / 1000 : null;
    const travelled = this.arrived ? this.distanceToArrival : this.distance;
    const movingSec = travelSec ?? (endedAt - this.startedAt) / 1000;
    const bpms = this.hr.map((h) => h[1]);
    const eles = this.track.map((q) => q.ele).filter((e) => e != null);
    return {
      id: this.id,
      mode: this.mode,
      place: {
        id: this.place.id,
        name: this.place.name,
        kind: this.place.kind,
        category: this.place.category,
        lat: this.place.lat,
        lng: this.place.lng,
      },
      startedAt: this.startedAt,
      arrivedAt: this.arrivedAt,
      loop: Boolean(this.home),
      homeAt: this.homeAt,
      endedAt,
      arrived: this.arrived,
      distance: Math.round(this.distance),
      travelSec: travelSec == null ? null : Math.round(travelSec),
      dwellSec: Math.round(this.dwellSec),
      avgSpeedKmh: movingSec > 0 ? +((travelled / movingSec) * 3.6).toFixed(2) : 0,
      maxSpeedKmh: +this.maxSpeedKmh.toFixed(1),
      elevationGain: eles.length > 1 ? elevationGain(eles) : null,
      avgHr: bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null,
      maxHr: bpms.length ? Math.max(...bpms) : null,
      hr: this.hr,
      track: this.track.map((q) =>
        q.ele != null ? [+q.lat.toFixed(6), +q.lng.toFixed(6), q.t, Math.round(q.ele)] : [+q.lat.toFixed(6), +q.lng.toFixed(6), q.t]
      ),
    };
  }

  /** Serialisable state, so a trip in progress survives the page being reloaded. */
  toJSON() {
    return { ...this };
  }

  static fromJSON(obj) {
    const t = new TripTracker({ mode: obj.mode, place: obj.place, startedAt: obj.startedAt, id: obj.id, home: obj.home });
    Object.assign(t, obj);
    return t;
  }
}

/**
 * Build a history record from an imported activity (Garmin / Strava / Google Timeline).
 * The last point is treated as the destination.
 */
export function recordFromPoints({ name, mode, points, id }) {
  const pts = points.filter((p) => p.t != null).sort((a, b) => a.t - b.t);
  if (pts.length < 2) throw new Error("Activity needs at least two timestamped points");
  const end = pts[pts.length - 1];
  const place = { id: `import:${end.lat.toFixed(4)},${end.lng.toFixed(4)}`, name, kind: "imported activity", category: "quirky", lat: end.lat, lng: end.lng };
  const tr = new TripTracker({ mode, place, startedAt: pts[0].t, id: id || `import-${pts[0].t}` });
  // Imported data is already clean; don't let GPS filters drop it.
  for (const p of pts) {
    const prev = tr.track[tr.track.length - 1];
    if (prev && p.t <= prev.t) continue;
    if (prev) {
      const step = distance(prev, p);
      tr.distance += step;
      const kmh = (step / ((p.t - prev.t) / 1000)) * 3.6;
      if (step > 15 && kmh < 300) tr.maxSpeedKmh = Math.max(tr.maxSpeedKmh, kmh);
    }
    const q = { lat: p.lat, lng: p.lng, t: p.t };
    if (p.ele != null) q.ele = p.ele;
    tr.track.push(q);
    if (p.hr) tr.hr.push([p.t, p.hr]);
  }
  tr.markArrived(end.t);
  const rec = tr.finish(end.t);
  rec.imported = true;
  return rec;
}

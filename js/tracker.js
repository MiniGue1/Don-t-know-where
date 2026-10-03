// Records one outing: the GPS track, when you arrived, and how long you stayed.
// Pure logic (no browser APIs) so it can be unit-tested.

import { distance } from "./geo.js";
import { MODES } from "./modes.js";

const MAX_ACCURACY_M = 60; // ignore fixes worse than this
const MIN_STEP_M = 3; // ignore GPS jitter smaller than this

export class TripTracker {
  constructor({ mode, place, startedAt = Date.now(), id }) {
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

  /** Manual "I'm here" — for when GPS missed the arrival (e.g. app was in the background). */
  markArrived(t = Date.now()) {
    if (this.arrived) return;
    this.arrivedAt = t;
    this.distanceToArrival = this.distance;
    this._lastNear = t;
  }

  _accumulateDwell(p) {
    if (!this.arrived) return;
    const near = distance(p, this.place) <= this.arriveRadius * 1.5;
    if (near && this._lastNear != null) this.dwellSec += (p.t - this._lastNear) / 1000;
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
      endedAt,
      arrived: this.arrived,
      distance: Math.round(this.distance),
      travelSec: travelSec == null ? null : Math.round(travelSec),
      dwellSec: Math.round(this.dwellSec),
      avgSpeedKmh: movingSec > 0 ? +((travelled / movingSec) * 3.6).toFixed(2) : 0,
      maxSpeedKmh: +this.maxSpeedKmh.toFixed(1),
      track: this.track.map((q) => [+q.lat.toFixed(6), +q.lng.toFixed(6), q.t]),
    };
  }

  /** Serialisable state, so a trip in progress survives the page being reloaded. */
  toJSON() {
    return { ...this };
  }

  static fromJSON(obj) {
    const t = new TripTracker({ mode: obj.mode, place: obj.place, startedAt: obj.startedAt, id: obj.id });
    Object.assign(t, obj);
    return t;
  }
}

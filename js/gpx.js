// GPX export. Garmin Connect, Strava, AllTrails, Komoot and Mapy.com all import GPX:
// activities (with time + heart rate) and courses/routes (just the line).

const xmlEsc = (s) =>
  String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

const GPX_TYPE = { run: "running", walk: "walking", bike: "cycling", moto: "motorcycling", car: "driving" };

/** Heart rate at time t from samples [[t, bpm], ...] sorted by time (nearest within 10 s). */
function hrAt(samples, t) {
  if (!samples?.length) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  const cands = [samples[lo], samples[lo - 1]].filter(Boolean);
  const best = cands.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
  return Math.abs(best[0] - t) <= 10000 ? best[1] : null;
}

/** Recorded trip -> GPX activity (track with timestamps, elevation, heart rate). */
export function tripToGpx(trip) {
  const name = `${trip.place?.name || "Outing"} — Don't Know Where`;
  const pts = (trip.track || [])
    .map(([lat, lng, t, ele]) => {
      const hr = hrAt(trip.hr, t);
      return (
        `      <trkpt lat="${lat}" lon="${lng}">` +
        (ele != null ? `<ele>${(+ele).toFixed(1)}</ele>` : "") +
        (t ? `<time>${new Date(t).toISOString()}</time>` : "") +
        (hr ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hr)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : "") +
        `</trkpt>`
      );
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Don't Know Where" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${xmlEsc(name)}</name><time>${new Date(trip.startedAt).toISOString()}</time></metadata>
  <wpt lat="${trip.place.lat}" lon="${trip.place.lng}"><name>${xmlEsc(trip.place.name)}</name></wpt>
  <trk>
    <name>${xmlEsc(name)}</name>
    <type>${GPX_TYPE[trip.mode] || "other"}</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Planned route -> GPX course (import into Garmin Connect as a course and send to your watch). */
export function routeToGpx({ name, points }) {
  const pts = points
    .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${p.ele != null ? `<ele>${(+p.ele).toFixed(1)}</ele>` : ""}</trkpt>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Don't Know Where" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xmlEsc(name)}</name></metadata>
  <trk>
    <name>${xmlEsc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export const gpxFileName = (name, date = new Date()) =>
  `${String(name || "route").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "route"}-${date
    .toISOString()
    .slice(0, 10)}.gpx`;

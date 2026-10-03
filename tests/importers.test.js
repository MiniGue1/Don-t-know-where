import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFile, parseMapLink, sportFromText } from "../js/importers.js";
import { tripToGpx, routeToGpx } from "../js/gpx.js";
import { recordFromPoints } from "../js/tracker.js";

const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="Mapy.com" xmlns="http://www.topografix.com/GPX/1/1">
 <metadata><name>Trip to Petřín &amp; back</name></metadata>
 <trk><name>track</name><type>running</type><trkseg>
  <trkpt lat="50.0800" lon="14.4000"><ele>200</ele><time>2026-06-01T08:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  <trkpt lat="50.0810" lon="14.4010"><ele>210</ele><time>2026-06-01T08:01:00Z</time></trkpt>
  <trkpt lat="50.0830" lon="14.4030"><ele>230</ele><time>2026-06-01T08:03:00Z</time></trkpt>
 </trkseg></trk>
</gpx>`;

test("GPX activity with name, sport, elevation and heart rate", () => {
  const [it] = parseFile("route.gpx", gpx);
  assert.equal(it.name, "Trip to Petřín & back");
  assert.equal(it.kind, "activity");
  assert.equal(it.sport, "run");
  assert.equal(it.points.length, 3);
  assert.equal(it.points[0].hr, 140);
  assert.equal(it.points[2].ele, 230);
});

test("GPX route without times is a route; self-closing rtept", () => {
  const [it] = parseFile("x.gpx", `<gpx><rte><name>Plan</name><rtept lat="1" lon="2"/><rtept lat="1.1" lon="2.1"/></rte></gpx>`);
  assert.equal(it.kind, "route");
  assert.equal(it.points.length, 2);
  assert.equal(it.name, "Plan");
});

test("TCX from Garmin", () => {
  const tcx = `<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Lap><Track>
    <Trackpoint><Time>2026-06-01T08:00:00Z</Time><Position><LatitudeDegrees>50</LatitudeDegrees><LongitudeDegrees>14</LongitudeDegrees></Position><AltitudeMeters>300</AltitudeMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
    <Trackpoint><Time>2026-06-01T08:10:00Z</Time><Position><LatitudeDegrees>50.02</LatitudeDegrees><LongitudeDegrees>14.02</LongitudeDegrees></Position></Trackpoint>
  </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const [it] = parseFile("a.tcx", tcx);
  assert.equal(it.sport, "bike");
  assert.equal(it.kind, "activity");
  assert.equal(it.points[0].hr, 120);
});

test("KML LineString from Google My Maps", () => {
  const kml = `<kml><Document><name>My map</name><Placemark><name>Ride</name><LineString><coordinates>
    14.40,50.08,0 14.41,50.09,0 14.42,50.10,0
  </coordinates></LineString></Placemark></Document></kml>`;
  const [it] = parseFile("m.kml", kml);
  assert.equal(it.name, "Ride");
  assert.deepEqual([it.points[1].lat, it.points[1].lng], [50.09, 14.41]);
});

test("GeoJSON LineString", () => {
  const [it] = parseFile("r.geojson", JSON.stringify({ type: "Feature", properties: { name: "G" }, geometry: { type: "LineString", coordinates: [[14, 50], [14.1, 50.1]] } }));
  assert.equal(it.points.length, 2);
  assert.equal(it.kind, "route");
});

test("Google Timeline (new on-device format)", () => {
  const json = {
    semanticSegments: [
      { startTime: "2026-06-01T10:00:00.000+02:00", endTime: "2026-06-01T10:30:00.000+02:00", activity: { start: { latLng: "50.0800000°, 14.4000000°" }, end: { latLng: "50.0900000°, 14.4200000°" }, topCandidate: { type: "WALKING" } } },
      { startTime: "2026-06-01T10:00:00.000+02:00", endTime: "2026-06-01T12:00:00.000+02:00", timelinePath: [{ point: "50.0850000°, 14.4100000°", time: "2026-06-01T10:15:00.000+02:00" }] },
      { startTime: "x", endTime: "y", visit: {} },
    ],
  };
  const items = parseFile("Timeline.json", JSON.stringify(json));
  assert.equal(items.length, 1);
  assert.equal(items[0].sport, "walk");
  assert.equal(items[0].points.length, 3);
  assert.equal(items[0].kind, "activity");
});

test("Google Takeout timelineObjects", () => {
  const json = { timelineObjects: [{ activitySegment: { startLocation: { latitudeE7: 500800000, longitudeE7: 144000000 }, endLocation: { latitudeE7: 501000000, longitudeE7: 144200000 }, duration: { startTimestamp: "2024-01-01T10:00:00Z", endTimestamp: "2024-01-01T10:20:00Z" }, activityType: "CYCLING" } }] };
  const [it] = parseFile("2024_JANUARY.json", JSON.stringify(json));
  assert.equal(it.sport, "bike");
  assert.equal(it.points[1].lat, 50.1);
});

test("Google Maps and Mapy links", () => {
  assert.deepEqual(parseMapLink("https://www.google.com/maps/dir/50.08,14.42/Prague+Castle/@50.0,14.4,13z/data=!4m2").stops, [
    { lat: 50.08, lng: 14.42 },
    { query: "Prague Castle" },
  ]);
  const api = parseMapLink("https://www.google.com/maps/dir/?api=1&origin=1,2&destination=3,4&waypoints=5,6|7,8");
  assert.equal(api.stops.length, 4);
  assert.deepEqual(parseMapLink("https://www.google.com/maps/place/Old+Town/@50.087,14.42,17z").stops[0], { lat: 50.087, lng: 14.42 });
  assert.deepEqual(parseMapLink("https://mapy.com/en/zakladni?x=14.4&y=50.08&z=15").stops[0], { lat: 50.08, lng: 14.4 });
  assert.equal(parseMapLink("not a url"), null);
});

test("unsupported binary files explain what to do", () => {
  assert.throws(() => parseFile("ride.fit", "\x0e\x10"), /Export as GPX/);
});

test("sport detection", () => {
  assert.equal(sportFromText("IN_PASSENGER_VEHICLE"), "car");
  assert.equal(sportFromText("Running"), "run");
});

test("GPX export round-trips through the importer", () => {
  const [it] = parseFile("a.gpx", gpx);
  const rec = recordFromPoints({ name: "Petřín", mode: "run", points: it.points });
  assert.equal(rec.arrived, true);
  assert.equal(rec.travelSec, 180);
  assert.equal(rec.avgHr, 140);
  assert.equal(rec.elevationGain, 30);
  const out = tripToGpx(rec);
  assert.match(out, /<type>running<\/type>/);
  assert.match(out, /<gpxtpx:hr>140<\/gpxtpx:hr>/);
  const [again] = parseFile("b.gpx", out);
  assert.equal(again.points.length, 3);
  assert.equal(again.kind, "activity");
  const course = routeToGpx({ name: "A <b>", points: it.points });
  assert.match(course, /A &lt;b&gt;/);
});

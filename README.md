# Don't Know Where

Don't know where to go? Open the app and answer **"Where are you going now?"** with Run, Walk, Cycle, Motorbike or Car. Then pick **Short / Medium / Long** and **Easy / Moderate / Hard**. For a motorbike you pick **Twisties / Straights / Interesting place** instead. The app finds somewhere new, hands navigation to **Google Maps, Apple Maps or Mapy.com**, records the outing and shows you a recap afterwards.

**No login. No data collection. Everything stays on your phone.**

**Demo:** https://minigue1.github.io/Don-t-know-where/

## Features

- **Czech and English.** The app follows the phone's language, and you can switch it under Me.
- **Start from anywhere.** Use your GPS position, tap a point on the map, or search an address. The last three start points are remembered.
- **Loops.** Choose "There" or "Loop". A loop takes you to the place and back to the start by a different way. Google Maps and Mapy.com get the whole loop; Apple Maps only navigates to the place. The app notices when you're back at the start.
- **Photos and descriptions.** Places with a Wikipedia article show a photo and two sentences (Wikipedia, Wikidata and Wikimedia Commons; no account needed).
- **Exploration map.** The map is split into squares of about 400 m. Activity shows which ones you've passed through and what share of the area around you (5 km) you've explored. Suggestions prefer unexplored squares, recaps show new squares, and there's a "Squares" leaderboard.
- **Remembers your usual choice.** Your most-used modes come first, and an "As usual" button appears once you've picked the same combination twice.
- **Picks somewhere new.** It finds viewpoints, castles, parks, waterfalls, museums, street art, cafés and more from OpenStreetMap. Places are ranked by:
  - your own pace for each sport
  - the length you chose
  - the difficulty: Hard looks for climbs and goes further, Easy stays flat and close
  - what you like
  - whether you've been there before
  - Every list also includes a mystery spot.
- **Motorbike ride styles.** The app plans real routes to several destinations and measures how twisty each road is (degrees of turning per km). Twisties picks the curviest roads, Straights picks the fast flowing ones. The Google Maps and Mapy.com links include waypoints, so the navigation follows the same roads.
- **Live trip.** Shows distance to go, elapsed time, pace (min/km for running and walking) and calories. Your route is drawn on the map, coloured by speed. The app detects when you arrive and how long you stay. The screen stays awake during a trip.
- **Recap**, like Strava or AllTrails:
  - the route on the map coloured by speed
  - distance, time, average and top speed, calories, time spent at the place, climbing, heart rate
  - speed, elevation and heart-rate charts
  - badges: new place, fastest yet, longest outing, streak
  - share or export as GPX
- **Satellite / terrain map.** Use the 🛰️ button to switch between the normal map, satellite imagery and a terrain map.
- **Watch and Garmin**, without any account:
  - **Live heart rate** over Bluetooth from a Garmin watch (turn on *Broadcast Heart Rate*) or any heart-rate strap. This works in Chrome on Android. When connected, calories are calculated from heart rate.
  - **Export GPX** with time, elevation and heart rate. Upload it to Garmin Connect (Import Data) or Strava.
  - **Route to watch:** export the planned route as GPX, import it in Garmin Connect as a Course, then use Send to Device.
  - **Import** GPX/TCX activities that you exported from Garmin Connect.
- **Import routes** from other apps:
  - GPX (Mapy.com, Garmin, Strava, AllTrails, Komoot)
  - TCX
  - KML (Google My Maps)
  - GeoJSON
  - Google Maps Timeline exports
  - pasted Google Maps directions links
  - Saved routes can be followed ("Go") or shared as GPX.
- **Leaderboards without servers.** You get a fun random nickname and avatar. "Share my card" creates a link that holds only your nickname and totals, never your routes or location. When a friend opens it, you appear on their board. The boards are distance this week, places explored, streak and calories.

## Run locally

```sh
npm start   # http://localhost:8080
npm test    # unit tests (Node 18+)
```

GPS needs HTTPS on phones. The GitHub Pages demo is served over HTTPS.

## Hosting (GitHub Pages)

`.github/workflows/pages.yml` runs the tests and deploys the site on every push. It needs a one-time setting: **Settings → Pages → Build and deployment → Source: GitHub Actions**. After that, re-run the workflow or push again.

## Code map

Plain HTML/CSS/JS ES modules with no build step. Leaflet is vendored in `vendor/`.

| File | Purpose |
| --- | --- |
| `js/modes.js` | Sports, length presets, difficulty and ride styles, pace formatting |
| `js/places.js` | Overpass query and categories |
| `js/recommend.js` | Ranking by pace, time, difficulty/climb, interests and novelty |
| `js/ride.js` | Route curvature, twisties/straights scoring, waypoints |
| `js/tracker.js` | Trip recording: GPS filtering, arrival, time there, heart rate, elevation |
| `js/calories.js` | MET-based calories and the Keytel heart-rate formula |
| `js/charts.js` | Speed colouring and SVG charts |
| `js/gpx.js`, `js/importers.js` | GPX export; GPX/TCX/KML/GeoJSON/Google Timeline/link import |
| `js/leaderboard.js` | Friend cards (share codes) and rankings |
| `js/hrm.js` | Bluetooth heart rate |
| `js/elevation.js` | Elevation lookups (Open-Meteo) and climb calculation |
| `js/i18n.js` | English and Czech text, plural forms |
| `js/loop.js` | Loop planning (return point off to the side) |
| `js/explore.js` | Exploration squares and explored share |
| `js/wiki.js` | Photos and descriptions from Wikipedia/Wikidata |
| `js/geocode.js` | Address search (Nominatim) |
| `js/usage.js` | Remembers the user's usual choices |
| `js/app.js`, `js/ui/*` | Map, screens |

Data sources: © OpenStreetMap contributors (map, places, routing via routing.openstreetmap.de, geocoding via Nominatim), Esri World Imagery, OpenTopoMap, Open-Meteo elevation. For heavy use, switch to paid providers.

## Limits and next steps

- Phones pause GPS for web apps in the background, so record with the app open. You can also record on your watch and import the GPX afterwards. Wrapping the app with **Capacitor** plus a background-geolocation plugin would give full background tracking and native Garmin/Apple Health sync.
- Direct Garmin Connect sync needs approval for Garmin's developer program and a server, which conflicts with "no login, no data collection". GPX files and Bluetooth heart rate cover the same needs locally.
- Leaderboards update when friends re-share their card. A live global board would need a server.

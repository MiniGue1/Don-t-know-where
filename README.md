# Don't Know Where

Don't know where to go? Open the app, pick **walk, bike, motorcycle or car**, say how much time you have and (optionally) what you'd like to see. It picks an interesting place nearby that you haven't been to, hands navigation off to **Google Maps, Apple Maps or Mapy.com**, and records the outing, Strava-style.

## Features

- **Surprise me / Show options**: finds viewpoints, castles, monuments, parks, waterfalls, museums, street art, cafés and more from OpenStreetMap, ranked by:
  - **your pace**: travel times use your real average speed for each mode, learned from past trips
  - **your time budget**: the one-way trip stays within roughly 60% of the time you have
  - **your interests**: the categories you pick, plus what it learns from how long you stay at each kind of place
  - **novelty**: places you've already been to drop down the list, and directions you haven't explored lately get a boost
  - **a mystery spot**: every list ends with a random point at the right distance, so there's always somewhere new to go (and something to do when you're offline)
- **Trip recording**: GPS track, distance, time to get there, average and top speed, automatic arrival detection, and **how long you stayed**. If the app was in the background when you arrived, tap **I'm here**.
- **History**: every outing with its route on the map, plus totals and a daily streak.
- **Records**: your pace for each mode, fastest trip, longest outing, longest stay, and a chart of what you like.
- Works as an installable phone app (PWA). All data stays on the device, and you can export it as JSON.

## Run it

```sh
npm start          # serves on http://localhost:8080
npm test           # unit tests (Node 18+)
```

To use it on a phone, host the folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages). Browsers only give GPS to HTTPS pages. Then open it on the phone and use **Add to Home Screen**.

## How it's built

Plain HTML/CSS/JS ES modules with no build step. Leaflet is vendored in `vendor/`.

| File | Purpose |
| --- | --- |
| `js/places.js` | Overpass API query and OSM tag → category mapping |
| `js/recommend.js` | Scoring and ranking of candidate places |
| `js/tracker.js` | Trip recording: GPS filtering, arrival, time spent there |
| `js/stats.js` | Personal speed, learned interests, records, streak |
| `js/maplinks.js` | Google / Apple / Mapy.com directions links |
| `js/routing.js` | Route preview line (FOSSGIS OSRM) |
| `js/store.js` | localStorage persistence |
| `js/main.js` | UI |

Data sources: © OpenStreetMap contributors (tiles, Overpass, routing.openstreetmap.de). For heavy production use, switch to a paid tile and Overpass provider, because the free public servers have usage policies.

## Known limitation and next step

Phones pause GPS for web pages running in the background, so a trip is recorded most accurately while the app is open on screen. It keeps the screen awake during a trip. To get full background tracking like Strava, wrap the app as a native app with **Capacitor** and a background-geolocation plugin. The logic modules are framework-free and can be reused as they are.

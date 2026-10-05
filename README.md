# Run Planner

A free, personal route planner for running, in the spirit of Strava's route builder. Open it and your usual start
is already there with routes ready to go.

- **Three tabs:** Suggest (pick distance/time/pace, loop or out-and-back, roads/mixed/trails, flat or hilly and routes appear), Draw (build your own, or edit a suggestion), Saved.
- **Find a run:** set distance (or time and pace), loop or out-and-back, roads/mixed/trails, flat or hilly. Routes come
  from a bank generated for your start point, saved in your browser and topped up in the background, so changing a filter is instant.
- **Edit in place:** click the map to extend, drag any point or the line itself to reshape, undo/redo, close the loop, out-and-back,
  free-draw legs for ovals and parks. Live distance, time (grade-adjusted), climb, elevation profile, surface mix, splits.
- **Keep:** save routes in the browser, export/import a backup, GPX export, shareable links.
- Light and dark, km or miles, installable as a PWA.

## How it works (no backend)
- Map: [MapLibre GL](https://maplibre.org) with free [OpenFreeMap](https://openfreemap.org) vector tiles, restyled in `src/map/style.js`.
- Routing: the public [BRouter](https://brouter.de) server by default (free, no key, ~1 request per second is polite).
  Add an optional free [OpenRouteService](https://openrouteservice.org) key in Settings for quiet-street and park preferences.
- Elevation for hand-drawn legs: Open-Meteo. Everything else runs in the browser.

## Pre-made routes for your start
`node scripts/seed.mjs <lat> <lng> [mixed|trail|road]` generates a bank of routes into `public/seed/` so a new device opens with
routes already there (the default start is Spit Bridge). Routes are sized with real walking distances (Valhalla matrix), kept on land,
spur-trimmed and scored for shape (compactness, backtracking, turning per km).

## Develop
```
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/, deployed to GitHub Pages by .github/workflows/deploy.yml
```
Keys are stored only in the browser (localStorage). Nothing secret is in this repo.

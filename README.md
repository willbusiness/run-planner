# Run Planner

A free, personal route planner for running (Strava's route builder, minus the subscription).
Static site, no backend: everything runs in the browser.

- **Explore**: suggested loops and out-and-backs around any point, plus named running/walking routes from OpenStreetMap. Filters (distance, hills, surface, shape) regenerate the suggestions.
- **Plan**: tap to add points that snap to paths, drag points or the line itself to reshape, free-draw legs for ovals and parks, undo/redo, close loop, out-and-back, elevation profile, splits, estimated time.
- **Saved**: routes live in the browser; export/import a JSON backup to move them between devices. GPX export/import.
- **Overlays**: trails and paths (tap for surface/lit/difficulty), ovals and tracks, drinking water and toilets.

## Free services used
| What | Service |
| --- | --- |
| Routing | [OpenRouteService](https://openrouteservice.org/dev/#/signup) (free key, 2,000 req/day), pasted into Settings and stored only in your browser |
| Elevation for free-draw legs | Open-Meteo |
| Trails, ovals, water, named routes | OpenStreetMap via Overpass |
| Map tiles | OpenStreetMap, OpenTopoMap, CARTO |

## Develop
```
npm install
npm run dev
```
Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.

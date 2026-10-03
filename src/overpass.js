// OpenStreetMap data via Overpass: trail network, ovals/tracks, water/toilets, named routes.
import { haversine, pathLength } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

let chain = Promise.resolve(); // Overpass is shared and strict about concurrency: one query at a time
export function overpass(query) {
  const run = async () => {
    let lastErr;
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (res.ok) return (await res.json()).elements || [];
        lastErr = new Error('Overpass ' + res.status);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const bb = (b) => `${b.getSouth().toFixed(5)},${b.getWest().toFixed(5)},${b.getNorth().toFixed(5)},${b.getEast().toFixed(5)}`;
const toLatLngs = (geom) => geom.map((g) => [g.lat, g.lon]);

// ---- surfaces ----
const PAVED = new Set(['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'concrete:plates', 'concrete:lanes', 'metal', 'bricks', 'chipseal']);
const GRAVEL = new Set(['gravel', 'fine_gravel', 'compacted', 'pebblestone', 'crushed_limestone']);
const DIRT = new Set(['dirt', 'ground', 'earth', 'grass', 'sand', 'mud', 'unpaved', 'woodchips', 'grass_paver', 'wood', 'rock']);

export function surfaceClass(tags) {
  const s = tags.surface;
  if (PAVED.has(s)) return 'paved';
  if (GRAVEL.has(s)) return 'gravel';
  if (DIRT.has(s)) return 'dirt';
  return 'unknown';
}

export async function fetchTrails(b) {
  const q = `[out:json][timeout:25];
way["highway"~"^(path|footway|track|bridleway|pedestrian|cycleway)$"]["footway"!~"^(sidewalk|crossing)$"]["access"!~"^(private|no)$"]["foot"!="no"](${bb(b)});
out geom qt 5000;`;
  return (await overpass(q))
    .filter((e) => e.geometry)
    .map((e) => ({ id: e.id, tags: e.tags || {}, coords: toLatLngs(e.geometry), cls: surfaceClass(e.tags || {}) }));
}

export async function fetchOvals(b) {
  const q = `[out:json][timeout:25];
(
  way["leisure"="track"]["sport"!~"cycling|horse_racing|motor|karting|dog_racing|equestrian|motocross|bmx"](${bb(b)});
  way["leisure"="pitch"]["sport"~"athletics|running|australian_football|cricket"](${bb(b)});
);
out geom 800;`;
  return (await overpass(q))
    .filter((e) => e.geometry && e.geometry.length > 3)
    .map((e) => {
      const coords = toLatLngs(e.geometry);
      return { id: e.id, tags: e.tags || {}, coords, lap: pathLength(coords) };
    })
    .filter((o) => o.lap >= 150 && o.lap <= 3000 && !/nets?$/i.test(o.tags.name || '')); // skip cricket nets, huge fields
}

export async function fetchWater(b) {
  const q = `[out:json][timeout:25];
node["amenity"~"^(drinking_water|toilets)$"](${bb(b)});
out 1500;`;
  return (await overpass(q)).map((e) => ({ id: e.id, kind: e.tags?.amenity, lat: e.lat, lng: e.lon, tags: e.tags || {} }));
}

/** Join way fragments into continuous chains by matching shared end nodes. */
function chainWays(ways) {
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const left = ways.map((w) => w.slice());
  const chains = [];
  while (left.length) {
    let cur = left.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i];
        const end = cur[cur.length - 1];
        const start = cur[0];
        if (same(end, w[0])) cur = cur.concat(w.slice(1));
        else if (same(end, w[w.length - 1])) cur = cur.concat(w.slice(0, -1).reverse());
        else if (same(start, w[w.length - 1])) cur = w.slice(0, -1).concat(cur);
        else if (same(start, w[0])) cur = w.slice(1).reverse().concat(cur);
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    chains.push(cur);
  }
  return chains;
}

/** Named running/hiking route relations, clipped to the viewport. */
export async function fetchRoutes(b) {
  const q = `[out:json][timeout:30][maxsize:30000000];
relation["route"~"^(running|hiking|foot|fitness_trail)$"](${bb(b)});
out geom 120;`;
  const out = [];
  for (const rel of await overpass(q)) {
    const ways = (rel.members || [])
      .filter((m) => m.type === 'way' && m.geometry)
      .map((m) => toLatLngs(m.geometry))
      // keep only the fragments that touch the viewport, so 250 km trails don't swamp the list
      .filter((w) => w.some((p) => b.contains(p)));
    if (!ways.length) continue;
    const chains = chainWays(ways).sort((x, y) => pathLength(y) - pathLength(x));
    const length = chains.reduce((s, c) => s + pathLength(c), 0);
    if (length < 800) continue;
    const t = rel.tags || {};
    out.push({
      id: rel.id,
      name: t.name || t.ref || 'Unnamed route',
      tags: t,
      chains,
      main: chains[0],
      length,
      closed: haversine(chains[0][0], chains[0][chains[0].length - 1]) < 30,
    });
  }
  return out;
}

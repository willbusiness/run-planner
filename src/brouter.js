// Keyless fallback router: the public BRouter server (free, CORS-enabled, returns elevation + way tags).
import { RouteError } from './ors.js';
import { haversine } from './geo.js';
import { surfaceClass } from './overpass.js';

const BASE = 'https://brouter.de/brouter';
const PROFILES = { road: 'shortest', mixed: 'trekking', trail: 'hiking-mountain' };

let inflight = 0;
let nextAt = 0;
let spacing = 1100;
export const setSpacing = (ms) => { spacing = ms; };
const waiters = [];
// the public server is a free community service: at most 2 requests in flight, started >= 1.1 s apart
async function slot() {
  while (inflight >= 2) await new Promise((r) => waiters.push(r));
  inflight++;
  const at = Math.max(Date.now(), nextAt);
  nextAt = at + spacing;
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
}
function free() {
  inflight--;
  waiters.shift()?.();
}

const PAVED_HW = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'footway', 'pedestrian', 'cycleway', 'steps']);
function bucketOf(wayTags) {
  const tags = Object.fromEntries(wayTags.split(' ').map((kv) => kv.split('=')));
  const c = surfaceClass(tags);
  if (c !== 'unknown') return c;
  if (tags.highway === 'track') return 'gravel';
  if (PAVED_HW.has(tags.highway)) return 'paved';
  return 'unknown';
}

const PATH_HW = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'track', 'bridleway', 'steps', 'corridor']);
const MAIN_HW = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
/** path = off-road/footpath, main = busy road, street = everything else. */
function kindOf(wayTags) {
  const hw = /(?:^| )highway=([^ ]+)/.exec(wayTags)?.[1];
  return PATH_HW.has(hw) ? 'path' : MAIN_HW.has(hw) ? 'main' : 'street';
}

/** Route through all points in ONE request, then split the result into one entry per consecutive pair. */
export async function route(points, prefs) {
  const profile = PROFILES[prefs.surface] || 'trekking';
  const url = `${BASE}?lonlats=${points.map((p) => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join('|')}&profile=${profile}&alternativeidx=0&format=geojson`;
  let res;
  for (let attempt = 0; ; attempt++) {
    await slot();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      res = await fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
    } catch {
      throw new RouteError('Could not reach the routing server (offline or slow).');
    } finally {
      free();
    }
    // the public server sheds load with 403/429/5xx: back off and retry before giving up
    if ([403, 429, 502, 503, 504].includes(res.status) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }
  if (!res.ok) {
    const msg = (await res.text().catch(() => '')).slice(0, 120);
    if ([403, 429, 502, 503, 504].includes(res.status)) throw new RouteError('The free routing server is busy. Wait a few seconds and try again (or add an OpenRouteService key in Settings).');
    if (/not mapped|not found|no track/i.test(msg)) throw new RouteError('No walkable route found between those points.');
    throw new RouteError(`Routing failed (${res.status}) ${msg}`.trim());
  }
  const j = await res.json();
  const f = j.features?.[0];
  if (!f) throw new RouteError('No route returned.');
  const all = f.geometry.coordinates.map((c) => [c[1], c[0], c[2]]);

  // cumulative distance along the returned line
  const cum = [0];
  for (let i = 1; i < all.length; i++) cum.push(cum[i - 1] + haversine(all[i - 1], all[i]));

  // where does the route pass each waypoint? (first near-closest vertex after the previous one)
  const idx = [0];
  for (let w = 1; w < points.length - 1; w++) {
    const from = idx[w - 1];
    let best = Infinity;
    const ds = [];
    for (let i = from; i < all.length; i++) {
      const d = haversine(points[w], all[i]);
      ds.push(d);
      if (d < best) best = d;
    }
    idx.push(from + ds.findIndex((d) => d <= best + 3));
  }
  idx.push(all.length - 1);

  // surface per message segment, assigned to the leg that contains it
  const rows = (f.properties.messages || []).slice(1);
  const legSurf = points.slice(1).map(() => ({ paved: 0, gravel: 0, dirt: 0, unknown: 0 }));
  const legKinds = points.slice(1).map(() => ({ path: 0, street: 0, main: 0 }));
  let at = 0;
  for (const r of rows) {
    const d = +r[3] || 0;
    const mid = at + d / 2;
    at += d;
    let leg = idx.findIndex((k, n) => n > 0 && mid <= cum[k]) - 1;
    if (leg < 0) leg = legSurf.length - 1;
    legSurf[leg][bucketOf(r[9] || '')] += d;
    legKinds[leg][kindOf(r[9] || '')] += d;
  }
  return points.slice(1).map((_, i) => ({ coords: all.slice(idx[i], idx[i + 1] + 1), surf: legSurf[i], kinds: legKinds[i] }));
}

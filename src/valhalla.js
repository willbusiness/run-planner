// Keyless router #1: the public Valhalla server run by FOSSGIS (free, CORS-enabled).
// One request returns every leg between waypoints, with elevation. A second quick request ("trace_attributes")
// says what each stretch is: surface, footpath or road. Both are skipped for the live-drag fast path.
import { RouteError } from './ors.js';
import { haversine } from './geo.js';

const BASE = 'https://valhalla1.openstreetmap.de';

/** Thrown when a newer edit made this request pointless before it was sent. */
export class Superseded extends Error {}

let inflight = 0;
let nextAt = 0;
const queues = { hi: [], lo: [] }; // the runner's own requests (hi) go before background top-ups (lo)
const SPACING = 550; // ms between request starts: polite to a free community server
async function slot(background) {
  while (inflight >= 2 || (background && queues.hi.length)) await new Promise((r) => (background ? queues.lo : queues.hi).push(r));
  inflight++;
  const at = Math.max(Date.now(), nextAt);
  nextAt = at + SPACING;
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
}
const release = () => {
  inflight--;
  (queues.hi.shift() || queues.lo.shift())?.();
};

async function post(path, body, stale, background = false) {
  for (let attempt = 0; ; attempt++) {
    await slot(background);
    if (stale?.()) {
      release();
      throw new Superseded();
    }
    let res;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }).finally(() => clearTimeout(timer));
    } catch {
      throw new RouteError('Could not reach the routing server (offline or slow).');
    } finally {
      release();
    }
    if ([429, 502, 503, 504].includes(res.status)) {
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      throw new RouteError('The free routing server is busy.');
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (res.status === 400 || res.status === 442 || res.status === 404) throw new RouteError('No walkable route found between those points.');
      throw new RouteError(`Routing failed (${res.status}) ${(j.error || '').slice(0, 80)}`.trim());
    }
    return res.json();
  }
}

/** Decode a precision-6 encoded polyline into [lat, lng] pairs. */
export function decode6(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([lat / 1e6, lng / 1e6]);
  }
  return out;
}

/**
 * Costing options for the runner's preferences. Valhalla's "pedestrian" profile knows footways, bush tracks and steps.
 * Without `use_tracks` and a higher hiking difficulty it simply refuses most walking tracks.
 */
function costing(prefs) {
  const steps = prefs.avoidStairs === false ? 30 : 90;
  if (prefs.surface === 'trail') return { walkway_factor: 0.5, sidewalk_factor: 2.0, use_tracks: 1, max_hiking_difficulty: 5, step_penalty: 30 };
  if (prefs.surface === 'road') return { walkway_factor: 1.5, use_tracks: 0, step_penalty: steps, ...(prefs.quiet ? { use_living_streets: 1 } : {}) };
  return { use_tracks: 0.5, max_hiking_difficulty: 2, step_penalty: steps, ...(prefs.quiet ? { use_living_streets: 1 } : {}) };
}

/** Interpolate the 30 m elevation samples onto each vertex of a leg. */
function withElevation(coords, samples, interval) {
  if (!samples?.length) return coords.map((c) => [c[0], c[1], null]);
  let d = 0;
  return coords.map((c, i) => {
    if (i) d += haversine(coords[i - 1], c);
    const f = Math.min(samples.length - 1, d / interval);
    const a = Math.floor(f);
    const b = Math.min(samples.length - 1, a + 1);
    return [c[0], c[1], samples[a] + (samples[b] - samples[a]) * (f - a)];
  });
}

const PATH_USE = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'mountain_bike', 'track', 'bridleway', 'steps']);
const MAIN_CLASS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const surfaceOf = (s) => (!s ? 'unknown' : s.startsWith('paved') ? 'paved' : s === 'compacted' || s === 'gravel' ? 'gravel' : s === 'dirt' || s === 'path' ? 'dirt' : 'unknown');
const kindOf = (e) => (PATH_USE.has(e.use) ? 'path' : e.use === 'road' && MAIN_CLASS.has(e.road_class) ? 'main' : 'street');

/** Fill each leg's `surf` and `kinds` (metres) in place from the matched edges. */
async function fillAttributes(coords, offsets, legs, stale, background) {
  try {
    const j = await post('/trace_attributes', {
      shape: coords.map((c) => ({ lat: c[0], lon: c[1] })),
      costing: 'pedestrian',
      shape_match: 'map_snap',
      filters: { attributes: ['edge.surface', 'edge.use', 'edge.road_class', 'edge.length', 'edge.begin_shape_index'], action: 'include' },
    }, stale, background);
    for (const l of legs) { l.surf.unknown = 0; l.kinds.street = 0; }
    for (const e of j.edges || []) {
      let leg = offsets.findIndex((o, n) => n > 0 && (e.begin_shape_index ?? 0) < o) - 1;
      if (leg < 0) leg = legs.length - 1;
      const m = (e.length || 0) * 1000;
      legs[leg].surf[surfaceOf(e.surface)] += m;
      legs[leg].kinds[kindOf(e)] += m;
    }
  } catch (e) {
    if (e instanceof Superseded) return;
    /* surface is a nicety: keep it unknown */
  }
}

/** Route through the points; resolves to one entry per consecutive pair: {coords, surf, kinds}. */
export async function route(points, prefs) {
  const body = {
    locations: points.map((p) => ({ lat: p[0], lon: p[1] })),
    costing: 'pedestrian',
    costing_options: { pedestrian: costing(prefs) },
    directions_options: { units: 'kilometers' },
    elevation_interval: 30,
  };
  const j = await post('/route', body, prefs.stale, prefs.background);
  const legsRaw = j.trip?.legs;
  if (!legsRaw?.length) throw new RouteError('No route returned.');
  const legs = legsRaw.map((l) => withElevation(decode6(l.shape), l.elevation, l.elevation_interval || 30));

  // geometry and elevation are ready now; what the ground is made of arrives a moment later (`late`)
  const out = legs.map((coords) => {
    let d = 0;
    for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
    return { coords, surf: { paved: 0, gravel: 0, dirt: 0, unknown: Math.round(d) }, kinds: { path: 0, street: Math.round(d), main: 0 } };
  });
  if (!prefs.fast) {
    const all = legs.flatMap((c, i) => (i ? c.slice(1) : c));
    const offsets = [0];
    legs.forEach((c, i) => offsets.push(offsets[i] + c.length - (i ? 1 : 0)));
    const late = fillAttributes(all, offsets, out, prefs.stale, prefs.background);
    out.forEach((l) => Object.defineProperty(l, 'late', { value: late, enumerable: false }));
  }
  return out;
}

/** Turn-by-turn directions through the waypoints: [{text, at (km from start), len (km)}]. */
export async function directions(points, prefs) {
  const j = await post('/route', {
    locations: points.map((p) => ({ lat: p[0], lon: p[1] })),
    costing: 'pedestrian',
    costing_options: { pedestrian: costing(prefs) },
    directions_options: { units: 'kilometers' },
  });
  const out = [];
  let at = 0;
  const legs = j.trip?.legs || [];
  legs.forEach((leg, li) => {
    for (const m of leg.maneuvers) {
      const arrive = m.type >= 4 && m.type <= 6;
      const skip = (arrive && li < legs.length - 1) || ((m.type === 7 || m.type === 8) && m.length < 0.15);
      if (!skip) out.push({ text: m.instruction.replace(/\.$/, ''), at, len: m.length });
      at += m.length;
    }
  });
  return out;
}

/** Walking distance in km between each consecutive pair of points (one cheap request), or null if unavailable. */
export async function legLengths(points, prefs) {
  try {
    const loc = points.map((p) => ({ lat: p[0], lon: p[1] }));
    const j = await post('/sources_to_targets', { sources: loc.slice(0, -1), targets: loc.slice(1), costing: 'pedestrian', costing_options: { pedestrian: costing(prefs) }, units: 'kilometers' }, undefined, true);
    const out = points.slice(1).map((_, i) => j.sources_to_targets?.[i]?.[i]?.distance);
    return out.every((d) => typeof d === 'number') ? out : null;
  } catch {
    return null;
  }
}

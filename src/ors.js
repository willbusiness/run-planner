// OpenRouteService directions client. The free key we tested allows 200 requests/day (the response headers
// say so), so the app only uses it for the runner's own edits, never for background route generation.
import { settings } from './settings.js';
import { haversine as hav } from './geo.js';

const BASE = 'https://api.openrouteservice.org/v2/directions/';
const PER_MINUTE = 36; // stay under the 40/min cap

// ---- daily quota, as reported by ORS in its response headers ----
const QUOTA_KEY = 'runplanner.orsQuota';
/** {remaining, limit} for today, or null if we haven't heard from ORS yet. */
export function quota() {
  try {
    const q = JSON.parse(localStorage.getItem(QUOTA_KEY) || 'null');
    if (q && q.reset * 1000 > Date.now()) return q;
  } catch { /* ignore */ }
  return null;
}
function readQuota(res) {
  const limit = +res.headers.get('x-ratelimit-limit');
  const remaining = +res.headers.get('x-ratelimit-remaining');
  const reset = +res.headers.get('x-ratelimit-reset');
  if (!limit || Number.isNaN(remaining)) return;
  try { localStorage.setItem(QUOTA_KEY, JSON.stringify({ limit, remaining, reset })); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('ors-usage'));
}
export const usage = () => {
  const q = quota();
  return q ? { used: q.limit - q.remaining, limit: q.limit } : { used: 0, limit: 200 };
};

// ---- rate limiter: sliding one-minute window + small concurrency cap ----
const stamps = [];
let inflight = 0;
const waiters = [];
async function acquire() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    if (inflight < 3 && stamps.length < PER_MINUTE) {
      stamps.push(now);
      inflight++;
      return;
    }
    await new Promise((r) => {
      waiters.push(r);
      setTimeout(r, stamps.length >= PER_MINUTE ? 1000 : 150);
    });
  }
}
function release() {
  inflight--;
  waiters.splice(0).forEach((r) => r());
}

export class RouteError extends Error {}

export function hasKey() {
  return !!settings.orsKey;
}

export function profileFor(prefs) {
  return prefs.surface === 'trail' ? 'foot-hiking' : 'foot-walking';
}

/** Short string identifying prefs that change routing; used in cache keys. */
export function prefsKey(prefs) {
  return [prefs.surface, prefs.quiet ? 'q' : '', prefs.green ? 'g' : '', prefs.avoidStairs ? 's' : ''].join('');
}

function requestBody(points, prefs) {
  const options = {};
  if (prefs.avoidStairs && !prefs.plain) options.avoid_features = ['steps'];
  const weightings = {};
  const green = prefs.green ? 0.8 : prefs.surface === 'mixed' ? 0.3 : prefs.surface === 'trail' ? 0.6 : 0;
  if (green) weightings.green = green;
  if (prefs.quiet) weightings.quiet = 0.7;
  if (Object.keys(weightings).length) options.profile_params = { weightings };
  return {
    coordinates: points.map((p) => [p[1], p[0]]),
    elevation: true,
    extra_info: ['surface'],
    instructions: false,
    geometry_simplify: false,
    ...(Object.keys(options).length ? { options } : {}),
  };
}

// ORS surface ids -> our four buckets
const SURFACE_BUCKET = { 0: 'unknown', 1: 'paved', 2: 'dirt', 3: 'paved', 4: 'paved', 5: 'paved', 6: 'paved', 7: 'dirt', 8: 'gravel', 9: 'gravel', 10: 'gravel', 11: 'dirt', 12: 'dirt', 13: 'dirt', 14: 'paved', 15: 'dirt', 16: 'dirt', 17: 'dirt', 18: 'dirt' };

async function post(profile, body, attempt = 0) {
  if (!settings.orsKey) throw new RouteError('Add your OpenRouteService key in Settings first.');
  await acquire();
  let res;
  try {
    const q = quota();
    if (q && q.remaining <= 3) throw new RouteError("OpenRouteService rate limit hit (today's quota is used up).");
    res = await fetch(BASE + profile + '/geojson', {
      method: 'POST',
      headers: { Authorization: settings.orsKey, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RouteError('Could not reach OpenRouteService (offline?).');
  } finally {
    release();
  }
  readQuota(res);
  if (res.ok) return res.json();
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    return post(profile, body, attempt + 1);
  }
  let msg = '';
  let code = 0;
  try {
    const j = await res.json();
    code = j.error?.code || 0;
    msg = j.error?.message || '';
  } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) throw new RouteError('OpenRouteService rejected the key. Check it in Settings.');
  if (res.status === 429) throw new RouteError('OpenRouteService rate limit hit. Wait a minute or check your daily quota.');
  if (res.status === 404 || code === 2009) throw new RouteError('No walkable route found between those points.');
  if (code === 2010) throw new RouteError('No road or path within 350 m of that point.');
  if (code === 2004) throw new RouteError('That route is too long for the free ORS limit.');
  if (code === 2009) throw new RouteError('No walkable route found between those points.');
  throw new RouteError(`Routing failed (${res.status}) ${msg}`.trim());
}

/**
 * Route through [[lat,lng], ...]. Returns one entry per consecutive pair:
 * [{ coords: [[lat,lng,ele]...], surf: {paved, gravel, dirt, unknown} (meters) }]
 */
export async function route(points, prefs) {
  const profile = profileFor(prefs);
  let data;
  try {
    data = await post(profile, requestBody(points, prefs));
  } catch (e) {
    // "avoid stairs" can make a route impossible and weightings can be refused: retry with plain options
    if (e instanceof RouteError && /^Routing failed \(400\)|No walkable route/.test(e.message)) {
      data = await post(profile, requestBody(points, { ...prefs, quiet: false, green: false, surface: 'road', plain: true }));
    } else throw e;
  }
  const f = data.features?.[0];
  if (!f) throw new RouteError('No route returned.');
  const all = f.geometry.coordinates.map((c) => [c[1], c[0], c[2]]);
  const wp = f.properties.way_points || [0, all.length - 1];
  const surfaceRuns = f.properties.extras?.surface?.values || [];
  return wp.slice(1).map((end, i) => {
    const start = wp[i];
    const coords = all.slice(start, end + 1);
    const surf = { paved: 0, gravel: 0, dirt: 0, unknown: 0 };
    for (const [from, to, id] of surfaceRuns) {
      const a = Math.max(from, start);
      const b = Math.min(to, end);
      if (b <= a) continue;
      let d = 0;
      for (let k = a; k < b; k++) d += hav(all[k], all[k + 1]);
      surf[SURFACE_BUCKET[id] || 'unknown'] += d;
    }
    return { coords, surf };
  });
}

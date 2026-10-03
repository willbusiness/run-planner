// OpenRouteService directions client (free tier: 2000 req/day, 40 req/min).
import { settings } from './settings.js';
import { haversine as hav } from './geo.js';

const BASE = 'https://api.openrouteservice.org/v2/directions/';
const DAILY_LIMIT = 2000;
const PER_MINUTE = 36; // stay under the 40/min cap

// ---- daily usage counter (resets by UTC date, like ORS) ----
const USAGE_KEY = 'runplanner.orsUsage';
export function usage() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
    if (u.date === today) return { used: u.n, limit: DAILY_LIMIT };
  } catch { /* ignore */ }
  return { used: 0, limit: DAILY_LIMIT };
}
function countCall() {
  const today = new Date().toISOString().slice(0, 10);
  const n = usage().used + 1;
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify({ date: today, n }));
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('ors-usage'));
}

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
  if (prefs.avoidStairs) options.avoid_features = ['steps', 'ferries'];
  const weightings = {};
  const green = prefs.green ? 0.8 : prefs.surface === 'mixed' ? 0.3 : prefs.surface === 'trail' ? 0.6 : 0;
  if (green) weightings.green = { factor: green };
  if (prefs.quiet) weightings.quiet = { factor: 0.7 };
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
    countCall();
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
    // Weightings are an optional nicety; if the server dislikes them retry plain.
    if (e instanceof RouteError && /^Routing failed \(400\)/.test(e.message)) {
      const plain = requestBody(points, { ...prefs, quiet: false, green: false, surface: 'road' });
      data = await post(profile, plain);
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

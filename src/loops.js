// Suggested-route generator: invents loops and out-and-backs around a start point,
// routes them with ORS, keeps ones that fit the distance/hills/surface wishes.
import * as ors from './routing.js';
import { elevations } from './elevation.js';
import { destination, pathLength, overlap } from './geo.js';
import { summarize, emptySurf, addSurf, hillClass } from './stats.js';

// Learned ratio of real route length to straight-line polygon length. Updated from every result,
// so after the first batch most candidates land near their target on the first try.
let loopDetour = 1.3;
let outDetour = 1.3;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toLL = (start, x, y) => destination(start, (Math.atan2(x, y) * 180) / Math.PI, Math.hypot(x, y));

/** Unscaled loop shape in local metres: S, then 3 points around a circle that passes through S. */
function loopShape(rand, theta, dir) {
  const R = 1000;
  const cx = R * Math.sin((theta * Math.PI) / 180);
  const cy = R * Math.cos((theta * Math.PI) / 180);
  const pts = [];
  for (const base of [60, 120, 180, 240, 300]) {
    const a = ((theta + 180 + dir * (base + (rand() - 0.5) * 28)) * Math.PI) / 180;
    const r = R * (0.85 + rand() * 0.3);
    pts.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]);
  }
  return pts;
}

function polyLen(pts) {
  let d = 0;
  const all = [[0, 0], ...pts, [0, 0]];
  for (let i = 1; i < all.length; i++) d += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
  return d;
}

function makeCandidate(start, rand, kind, target, theta) {
  if (kind === 'out&back') {
    const dist = target / 2 / outDetour;
    return { kind, target, shape: [[dist * Math.sin((theta * Math.PI) / 180), dist * Math.cos((theta * Math.PI) / 180)]], scale: 1, start };
  }
  const shape = loopShape(rand, theta, rand() < 0.5 ? 1 : -1);
  const scale = target / loopDetour / polyLen(shape);
  return { kind, target, shape, scale, start };
}

const waypointsOf = (c) => [c.start, ...c.shape.map(([x, y]) => toLL(c.start, x * c.scale, y * c.scale)), ...(c.kind === 'loop' ? [c.start] : [])];

function perimeterOf(c) {
  return c.kind === 'loop' ? polyLen(c.shape) * c.scale : Math.hypot(...c.shape[0]) * c.scale;
}

async function routeCandidate(c, prefs) {
  const wps = waypointsOf(c);
  const legs = await ors.route(wps, prefs);
  let outLegs = legs.map((l) => ({ ...l, mode: 'snap' }));
  let outWps = wps;
  if (c.kind === 'out&back') {
    // the way back is the same path reversed
    outLegs = [outLegs[0], { ...outLegs[0], coords: [...outLegs[0].coords].reverse() }];
    outWps = [wps[0], wps[1], wps[0]];
  }
  const coords = [];
  const surf = emptySurf();
  for (const l of outLegs) {
    coords.push(...(coords.length ? l.coords.slice(1) : l.coords));
    addSurf(surf, l.surf);
  }
  return { wps: outWps, legs: outLegs, coords, surf };
}

/**
 * Generate suggestions. Calls onRoute(route) as each finishes; resolves with the final sorted list.
 * `isCancelled()` lets the caller abandon a stale search.
 */
export async function generate({ start, prefs, count = 6, seed = Date.now(), onRoute, onProgress, isCancelled = () => false }) {
  const rand = mulberry32(seed);
  const min = prefs.minKm * 1000;
  const max = Math.max(prefs.maxKm * 1000, min);
  const want = count;
  const total = Math.ceil(want * 1.6);

  const { used, limit } = ors.usage();
  if (ors.usingOrs() && used + total > limit * 0.97) throw new ors.RouteError('Daily OpenRouteService quota nearly used up. Try again tomorrow or plan by hand.');

  // 1. candidates: spread targets across the range, bearings around the compass
  const targets = Array.from({ length: total }, (_, i) => min + (max - min) * ((i + 0.5) / total));
  for (let i = targets.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [targets[i], targets[j]] = [targets[j], targets[i]]; }
  const base = rand() * 360;
  let cands = targets.map((t, i) => {
    const kind = prefs.shape === 'any' ? (rand() < 0.7 ? 'loop' : 'out&back') : prefs.shape;
    return makeCandidate(start, rand, kind, t, (base + (i * 360) / total + rand() * 20) % 360);
  });

  // 2. one batched elevation lookup: drop candidates with waypoints in water (elevation 0),
  //    and rank the rest by how well their terrain relief fits the hills preference
  try {
    const all = cands.flatMap((c) => waypointsOf(c));
    const ele = await Promise.race([elevations(all), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 1500))]);
    let k = 0;
    cands = cands.map((c) => {
      const w = waypointsOf(c);
      const e = ele.slice(k, k + w.length);
      k += w.length;
      const relief = e.slice(1).reduce((s, v, i) => s + Math.abs(v - e[i]), 0) / (c.target / 1000);
      return { ...c, wet: e.some((v) => v != null && v <= 0.5), relief };
    });
    cands = cands.filter((c) => !c.wet);
    const want_ = prefs.hills === 'flat' ? (c) => c.relief : prefs.hills === 'hilly' ? (c) => -c.relief : () => rand();
    cands.sort((a, b) => want_(a) - want_(b));
  } catch {
    /* elevation is only a nicety here */
  }
  cands = cands.slice(0, Math.ceil(want * 1.3));

  // 3. route them, three at a time
  const results = [];
  let done = 0;
  let firstError = null;
  const queue = [...cands];
  const worker = async () => {
    while (queue.length && !isCancelled()) {
      const c = queue.shift();
      try {
        let r = await routeCandidate(c, prefs);
        let d = pathLength(r.coords);
        const learn = (dist) => {
          const ratio = dist / perimeterOf(c);
          if (c.kind === 'loop') loopDetour = Math.min(2, Math.max(1.05, loopDetour * 0.6 + ratio * 0.4));
          else outDetour = Math.min(2, Math.max(1.05, outDetour * 0.6 + ratio * 0.4));
        };
        learn(d);
        // one refinement pass if we're well outside the wanted range
        if ((d < min * 0.92 || d > max * 1.08) && !isCancelled()) {
          c.scale *= Math.min(1.6, Math.max(0.6, c.target / d));
          r = await routeCandidate(c, prefs);
          d = pathLength(r.coords);
          learn(d);
        }
        if (d < min * 0.9 || d > max * 1.1) continue;
        const sum = summarize(r.coords, r.surf);
        const route = { id: `g${seed}-${results.length}-${Math.round(d)}`, source: 'generated', kind: c.kind, ...r, ...sum, hills: hillClass(sum.gain, sum.dist) };
        // skip near-duplicates of something we already have
        if (results.some((x) => overlap(x.coords, route.coords) > 0.6)) continue;
        results.push(route);
        onRoute?.(route);
      } catch (e) {
        if (e instanceof ors.RouteError && /key|quota|rate limit/i.test(e.message)) firstError ||= e;
        // other failures (no road near a waypoint etc.) just drop that candidate
      } finally {
        done++;
        onProgress?.(done, cands.length);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (firstError && !results.length) throw firstError;

  // 4. best matches first: hills preference, then distance
  const rank = (r) => (prefs.hills === 'any' || r.hills === prefs.hills ? 0 : 1);
  results.sort((a, b) => rank(a) - rank(b) || a.dist - b.dist);
  return results.slice(0, want);
}



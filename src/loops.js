// Invents one loop or out-and-back around a start point: places waypoints on a ring, routes them,
// cuts out dead-end spurs, then measures how clean the result is. The route bank calls this in the background.
import * as routing from './routing.js';
import { elevations } from './elevation.js';
import { destination, pathLength } from './geo.js';
import { summarize, emptySurf, addSurf, emptyKinds, addKinds, hillClass, estimateTime } from './stats.js';
import { trimSpurs, shapeMetrics, nearestIndex } from './clean.js';

// Learned ratio of real route length to straight-line polygon length. Improves with every route,
// so most candidates land close to their target on the first try.
let detour = { loop: 1.3, 'out&back': 1.3 };
try { detour = { ...detour, ...JSON.parse(localStorage.getItem('runplanner.detour') || '{}') }; } catch { /* first run */ }
const saveDetour = () => { try { localStorage.setItem('runplanner.detour', JSON.stringify(detour)); } catch { /* ignore */ } };

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

/** Unscaled loop in local metres: a circle through the start, with k waypoints spread around it. */
function ringShape(rand, theta, k) {
  const R = 1000;
  const cx = R * Math.sin((theta * Math.PI) / 180);
  const cy = R * Math.cos((theta * Math.PI) / 180);
  const dir = rand() < 0.5 ? 1 : -1;
  const pts = [];
  for (let i = 1; i <= k; i++) {
    const a = ((theta + 180 + dir * ((360 * i) / (k + 1) + (rand() - 0.5) * (k > 3 ? 26 : 16))) * Math.PI) / 180;
    const r = R * (0.9 + rand() * 0.2);
    pts.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]);
  }
  return pts;
}

const perimeter = (pts) => {
  const all = [[0, 0], ...pts, [0, 0]];
  let d = 0;
  for (let i = 1; i < all.length; i++) d += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
  return d;
};

function candidate(rand, kind, target, theta) {
  if (kind === 'out&back') {
    const dist = target / 2 / detour['out&back'];
    return { kind, target, shape: [[dist * Math.sin((theta * Math.PI) / 180), dist * Math.cos((theta * Math.PI) / 180)]], scale: 1, base: dist };
  }
  const shape = ringShape(rand, theta, 3 + Math.floor(rand() * 3));
  return { kind, target, shape, scale: target / detour.loop / perimeter(shape), base: perimeter(shape) };
}

const waypointsOf = (start, c) => [start, ...c.shape.map(([x, y]) => toLL(start, x * c.scale, y * c.scale)), ...(c.kind === 'loop' ? [start] : [])];

/** Route a candidate and turn it into one clean line plus waypoints that sit on that line. */
async function routeCandidate(start, c, prefs) {
  const wps = waypointsOf(start, c);
  const legs = await routing.route(c.kind === 'loop' ? wps : [wps[0], wps[1]], prefs);
  const surf = emptySurf();
  const kinds = emptyKinds();
  let raw = [];
  for (const l of legs) {
    raw.push(...(raw.length ? l.coords.slice(1) : l.coords));
    addSurf(surf, l.surf);
    addKinds(kinds, l.kinds);
  }
  const rawLen = pathLength(raw);
  let coords = trimSpurs(raw);
  let outLen = pathLength(coords);
  let points = wps;
  if (c.kind === 'out&back') {
    const turn = coords[coords.length - 1];
    coords = [...coords, ...[...coords].reverse().slice(1)];
    points = [start, turn, start];
    outLen *= 2;
    // surface of the way back equals the way out
    for (const k of Object.keys(surf)) surf[k] *= 2;
    for (const k of Object.keys(kinds)) kinds[k] *= 2;
  } else {
    // waypoints snapped onto the trimmed line, in order
    const idx = [0];
    for (let i = 1; i < wps.length - 1; i++) {
      const at = nearestIndex(coords, wps[i], idx[idx.length - 1] + 1);
      if (at > idx[idx.length - 1] && at < coords.length - 1) idx.push(at);
    }
    idx.push(coords.length - 1);
    points = idx.map((i) => [coords[i][0], coords[i][1]]);
    points[0] = start;
    points[points.length - 1] = start;
  }
  const scale = (rawLen && c.kind === 'loop' ? outLen / rawLen : 1) || 1;
  for (const k of Object.keys(surf)) surf[k] = Math.round(surf[k] * scale);
  for (const k of Object.keys(kinds)) kinds[k] = Math.round(kinds[k] * scale);
  return { coords, points, surf, kinds, dist: outLen };
}

const r1 = (v) => Math.round(v * 10) / 10;
const r5 = (v) => Math.round(v * 1e5) / 1e5;

/** Split a clean line at the given waypoints into editable legs [{coords, surf, kinds}]. */
export function splitLegs(coords, points, surf, kinds) {
  const idx = [0];
  for (let i = 1; i < points.length - 1; i++) idx.push(nearestIndex(coords, points[i], idx[idx.length - 1]));
  idx.push(coords.length - 1);
  const total = coords.length - 1 || 1;
  return points.slice(1).map((_, i) => {
    const share = Math.max(0, idx[i + 1] - idx[i]) / total;
    const part = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * share]));
    return { coords: coords.slice(idx[i], Math.max(idx[i + 1], idx[i] + 1) + 1), surf: part(surf), kinds: part(kinds), mode: 'snap' };
  });
}

/**
 * Make one route near `start`. Returns a bank record or null if it didn't work out
 * (no path, wrong length, or an ugly shape).
 */
export async function makeRoute({ start, kind, target, prefs, seed = Date.now() }) {
  const rand = mulberry32(seed);
  const theta = rand() * 360;
  let c = candidate(rand, kind, target, theta);

  // when the runner wants flat or hilly, try a few directions and keep the one whose terrain fits
  if (prefs.hills !== 'any') {
    try {
      const options = Array.from({ length: 4 }, (_, i) => candidate(rand, kind, target, (theta + i * 90) % 360));
      const lists = options.map((o) => waypointsOf(start, o));
      const ele = await Promise.race([elevations(lists.flat()), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 1500))]);
      let k = 0;
      const scored = options.map((o, i) => {
        const e = ele.slice(k, k + lists[i].length);
        k += lists[i].length;
        const relief = e.slice(1).reduce((s, v, j) => s + Math.abs(v - e[j]), 0) / (target / 1000);
        return { o, relief, wet: e.some((v) => v != null && v <= 0.5) };
      }).filter((x) => !x.wet);
      if (scored.length) {
        scored.sort((a, b) => (prefs.hills === 'flat' ? a.relief - b.relief : b.relief - a.relief));
        c = scored[0].o;
      }
    } catch {
      /* elevation is only a nicety here */
    }
  }

  let r = await routeCandidate(start, c, prefs);
  const learn = (d) => {
    const ratio = d / (c.base * c.scale);
    detour[kind] = Math.min(2, Math.max(1.05, detour[kind] * 0.6 + ratio * 0.4));
    saveDetour();
  };
  if (kind === 'loop') learn(r.dist);
  if (Math.abs(r.dist - target) / target > 0.1) {
    c.scale *= Math.min(1.6, Math.max(0.6, target / r.dist));
    r = await routeCandidate(start, c, prefs);
    if (kind === 'loop') learn(r.dist);
  }
  if (Math.abs(r.dist - target) / target > 0.15) return null;

  const q = shapeMetrics(r.coords);
  if (kind === 'loop' && (q.backtrack > 0.12 || q.compact < 0.22)) return null;

  const sum = summarize(r.coords, r.surf, r.kinds);
  return {
    id: `${kind[0]}${Math.round(r.dist)}-${seed.toString(36)}`,
    kind,
    surface: prefs.surface,
    wps: r.points.map((p) => [r5(p[0]), r5(p[1])]),
    c: r.coords.map((p) => [r5(p[0]), r5(p[1]), p[2] == null ? null : r1(p[2])]),
    surf: r.surf,
    kinds: r.kinds,
    dist: Math.round(sum.dist),
    gain: Math.round(sum.gain),
    loss: Math.round(sum.loss),
    gapKm: estimateTime(sum.an, 1),
    hills: hillClass(sum.gain, sum.dist),
    q: { compact: +q.compact.toFixed(2), backtrack: +q.backtrack.toFixed(2), turns: +q.turnsPerKm.toFixed(1) },
    t: Date.now(),
  };
}

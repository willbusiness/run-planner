// Invents one loop or out-and-back around a start point: places waypoints on a ring, routes them,
// cuts out dead-end spurs, then measures how clean the result is. The route bank calls this in the background.
import * as routing from './routing.js';
import * as valhalla from './valhalla.js';
import { elevations } from './elevation.js';
import { destination, pathLength } from './geo.js';
import { summarize, emptySurf, addSurf, emptyKinds, addKinds, hillClass, estimateTime } from './stats.js';
import { trimSpurs, shapeMetrics, nearestIndex, simplify } from './clean.js';

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

/** Route a candidate and turn it into one clean line plus waypoints that sit on that line. Surface info follows via `finish`. */
async function routeCandidate(start, c, prefs) {
  const wps = waypointsOf(start, c);
  const legs = await routing.route(c.kind === 'loop' ? wps : [wps[0], wps[1]], prefs);
  let raw = [];
  for (const l of legs) raw.push(...(raw.length ? l.coords.slice(1) : l.coords));
  const rawLen = pathLength(raw);
  let coords = trimSpurs(raw);
  let outLen = pathLength(coords);
  let points = wps;
  if (c.kind === 'out&back') {
    const turn = coords[coords.length - 1];
    coords = [...coords, ...[...coords].reverse().slice(1)];
    points = [start, turn, start];
    outLen *= 2;
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
  const finish = async () => {
    await legs[0]?.late; // Valhalla fills in surface and path info a moment after the geometry
    const surf = emptySurf();
    const kinds = emptyKinds();
    for (const l of legs) { addSurf(surf, l.surf); addKinds(kinds, l.kinds); }
    const mult = c.kind === 'out&back' ? 2 : scale; // the way back repeats the way out
    for (const k of Object.keys(surf)) surf[k] = Math.round(surf[k] * mult);
    for (const k of Object.keys(kinds)) kinds[k] = Math.round(kinds[k] * mult);
    return { surf, kinds };
  };
  return { coords, points, dist: outLen, finish };
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
/**
 * Find a size for this shape so the walking distance through its points is about `target`.
 * Water and peninsulas make distance jump around, so bracket the answer instead of chasing it.
 * Resolves true (fits), false (can't be made to fit) or null (the distance service is unavailable).
 */
async function fitScale(start, c, target, prefs) {
  let lo = 0;
  let hi = Infinity;
  for (let i = 0; i < 4; i++) {
    const pts = waypointsOf(start, c);
    const lens = await valhalla.legLengths(c.kind === 'loop' ? pts : pts.slice(0, 2), prefs);
    if (!lens) return null;
    // a little shorter than the sum of the legs: dead-end spurs get trimmed out afterwards
    const predicted = lens.reduce((a, b) => a + b, 0) * 1000 * (c.kind === "out&back" ? 2 : 0.97);
    globalThis.__RP_DEBUG && console.log('   predicted', Math.round(predicted), 'scale', c.scale.toFixed(2));
    if (Math.abs(predicted - target) / target < 0.07) return true;
    if (predicted < target) lo = Math.max(lo, c.scale);
    else hi = Math.min(hi, c.scale);
    c.scale = lo > 0 && Number.isFinite(hi) ? Math.sqrt(lo * hi) : c.scale * Math.min(2, Math.max(0.5, target / predicted));
  }
  return false;
}

export async function makeRoute({ start, kind, target, prefs, seed = Date.now() }) {
  const rand = mulberry32(seed);
  const theta = rand() * 360;

  // try several shapes and keep ones whose waypoints are all on land (water makes huge detours);
  // when the runner wants flat or hilly, prefer the ones whose terrain fits
  let shapes = [candidate(rand, kind, target, theta)];
  try {
    const options = Array.from({ length: 6 }, (_, i) => candidate(rand, kind, target, (theta + i * 60) % 360));
    const lists = options.map((o) => waypointsOf(start, o));
    const ele = await Promise.race([elevations(lists.flat()), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 2000))]);
    let k = 0;
    const scored = options.map((o, i) => {
      const e = ele.slice(k, k + lists[i].length);
      k += lists[i].length;
      const relief = e.slice(1).reduce((s, v, j) => s + Math.abs(v - e[j]), 0) / (target / 1000);
      const wet = e.filter((v) => v != null && v <= 0.5).length;
      return { o, relief, wet, r: rand() };
    });
    let pool = scored.filter((x) => x.wet === 0);
    if (!pool.length) pool = [...scored].sort((a, b) => a.wet - b.wet).slice(0, 2);
    if (prefs.hills === 'flat') pool.sort((a, b) => a.relief - b.relief);
    else if (prefs.hills === 'hilly') pool.sort((a, b) => b.relief - a.relief);
    else pool.sort((a, b) => a.r - b.r);
    shapes = pool.map((x) => x.o);
  } catch {
    /* elevation is only a nicety here */
  }

  // size the shape by real walking distances (cheap requests); try up to three shapes before paying for a route
  let c = null;
  for (const shape of shapes.slice(0, 3)) {
    const fit = await fitScale(start, shape, target, prefs);
    if (fit !== false) { c = shape; break; }
  }
  if (!c) return null;

  let r = await routeCandidate(start, c, prefs);
  const learn = (d) => {
    const ratio = d / (c.base * c.scale);
    if (ratio < 1.05 || ratio > 2.6) return; // an outlier (water, a peninsula) says nothing about typical streets
    detour[kind] = Math.min(2.2, Math.max(1.1, detour[kind] * 0.7 + ratio * 0.3));
    saveDetour();
  };
  if (kind === 'loop') learn(r.dist);
  const dbg = (...a) => globalThis.__RP_DEBUG && console.log('  ', ...a);
  dbg('first route', Math.round(r.dist), 'target', target, 'detour', detour[kind].toFixed(2));
  if (Math.abs(r.dist - target) / target > 0.45) return null; // water or a peninsula made a long detour: don't waste more requests
  if (Math.abs(r.dist - target) / target > 0.1) {
    c.scale *= Math.min(1.6, Math.max(0.6, target / r.dist));
    r = await routeCandidate(start, c, prefs);
    if (kind === 'loop') learn(r.dist);
  }
  dbg('after refine', Math.round(r.dist));
  if (Math.abs(r.dist - target) / target > 0.15) return null;

  const line = simplify(r.coords, 2);
  const q = shapeMetrics(line);
  dbg('shape', JSON.stringify(q));
  if (kind === 'loop' && (q.backtrack > 0.1 || q.compact < 0.15 || q.turnsPerKm > 3.5 || q.wiggle > 380)) return null;

  const { surf, kinds } = await r.finish();
  const sum = summarize(line, surf, kinds);
  return {
    id: `${kind[0]}${Math.round(r.dist)}-${seed.toString(36)}`,
    kind,
    surface: prefs.surface,
    wps: r.points.map((p) => [r5(p[0]), r5(p[1])]),
    c: line.map((p) => [r5(p[0]), r5(p[1]), p[2] == null ? null : r1(p[2])]),
    surf,
    kinds,
    dist: Math.round(sum.dist),
    gain: Math.round(sum.gain),
    loss: Math.round(sum.loss),
    gapKm: estimateTime(sum.an, 1),
    hills: hillClass(sum.gain, sum.dist),
    q: { compact: +q.compact.toFixed(2), backtrack: +q.backtrack.toFixed(2), turns: +q.turnsPerKm.toFixed(1), wiggle: Math.round(q.wiggle) },
    t: Date.now(),
  };
}

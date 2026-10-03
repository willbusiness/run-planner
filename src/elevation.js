// Elevation lookups for hand-drawn legs (Open-Meteo, free, no key) + profile analysis.
import { densify, cumulative } from './geo.js';

const cache = new Map();
const keyOf = (p) => p[0].toFixed(4) + ',' + p[1].toFixed(4);

/** Elevation in meters for each [lat,lng]. Throws on network failure. */
export async function elevations(points) {
  const missing = [];
  for (const p of points) if (!cache.has(keyOf(p))) missing.push(p);
  const uniq = [...new Map(missing.map((p) => [keyOf(p), p])).values()];
  for (let i = 0; i < uniq.length; i += 100) {
    const batch = uniq.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${batch.map((p) => p[0].toFixed(5)).join(',')}&longitude=${batch.map((p) => p[1].toFixed(5)).join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Elevation service error ' + res.status);
    const { elevation } = await res.json();
    batch.forEach((p, k) => cache.set(keyOf(p), elevation[k]));
  }
  return points.map((p) => cache.get(keyOf(p)));
}

/** Densify a straight/free-drawn path (~25 m) and attach elevation as the 3rd value. */
export async function withElevation(coords) {
  const pts = densify(coords, 25);
  const ele = await elevations(pts);
  return pts.map((p, i) => [p[0], p[1], ele[i]]);
}

const STEP = 10; // meters between analysis samples

/**
 * Turn [[lat,lng,ele]...] into a uniform 10 m grid with smoothed elevation, grades,
 * and totals. This is the one place gain/loss is defined.
 */
export function analyze(coords) {
  const n0 = coords.length;
  const empty = { dist: 0, gain: 0, loss: 0, min: 0, max: 0, step: STEP, d: [], e: [], g: [] };
  if (n0 < 2) return empty;
  const cum = cumulative(coords);
  const dist = cum[n0 - 1];
  const n = Math.max(2, Math.round(dist / STEP) + 1);
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const m = (dist * i) / (n - 1);
    d[i] = m;
    while (j < n0 - 2 && cum[j + 1] < m) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (m - cum[j]) / span));
    const a = coords[j][2] ?? 0;
    const b = coords[j + 1][2] ?? a;
    e[i] = a + (b - a) * t;
  }
  // moving average over ~60 m kills DEM jitter without erasing real hills
  const w = 3;
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) { s += e[k]; c++; }
    sm[i] = s / c;
  }
  // gain/loss with a small hysteresis so noise doesn't accumulate
  let gain = 0, loss = 0, ref = sm[0], min = sm[0], max = sm[0];
  const TH = 1.5;
  for (let i = 1; i < n; i++) {
    if (sm[i] < min) min = sm[i];
    if (sm[i] > max) max = sm[i];
    const diff = sm[i] - ref;
    if (diff > TH) { gain += diff; ref = sm[i]; }
    else if (diff < -TH) { loss -= diff; ref = sm[i]; }
  }
  // grade (%) over a ~50 m window
  const g = new Float64Array(n);
  const hw = 3;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - hw);
    const b = Math.min(n - 1, i + hw);
    g[i] = ((sm[b] - sm[a]) / (d[b] - d[a] || 1)) * 100;
  }
  return { dist, gain, loss, min, max, step: STEP, d, e: sm, g };
}

// Route clean-up and quality metrics for generated routes. Points are [lat, lng, ele].
import { haversine } from './geo.js';

const DEG_M = 111320;
const flat = (origin) => {
  const k = Math.cos((origin[0] * Math.PI) / 180);
  return (p) => [(p[1] - origin[1]) * DEG_M * k, (p[0] - origin[0]) * 110574];
};

/** Is the excursion coords[i..j] a dead-end spur, i.e. did the path walk out and come back along the same line? */
function isSpur(xy, i, j) {
  const pts = [];
  let acc = 0;
  for (let n = i + 1; n <= j; n++) {
    acc += Math.hypot(xy[n][0] - xy[n - 1][0], xy[n][1] - xy[n - 1][1]);
    pts.push([xy[n], acc]);
  }
  const half = acc / 2;
  const out = pts.filter((q) => q[1] <= half);
  const back = pts.filter((q) => q[1] > half);
  if (!out.length || !back.length) return false;
  let near = 0;
  for (const [p] of back) {
    for (const [q] of out) {
      if (Math.abs(p[0] - q[0]) < 11 && Math.abs(p[1] - q[1]) < 11 && Math.hypot(p[0] - q[0], p[1] - q[1]) < 10) {
        near++;
        break;
      }
    }
  }
  return near / back.length >= 0.85;
}

/**
 * Remove dead-end spurs: places where the route goes down a side street and returns the same way
 * (what happens when a waypoint lands mid-block). Keeps the first and last point.
 */
export function trimSpurs(coords, { maxSpur = 700, tol = 10 } = {}) {
  if (coords.length < 4) return coords;
  const xy = coords.map(flat(coords[0]));
  const keep = []; // indices into coords
  const cum = [];
  let total = 0;
  for (let n = 0; n < coords.length; n++) {
    const p = xy[n];
    if (keep.length) {
      const prev = xy[keep[keep.length - 1]];
      total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    }
    // did we just come back to a point we passed a little while ago?
    let cut = -1;
    for (let k = keep.length - 2; k >= 0; k--) {
      if (total - cum[k] > maxSpur) break;
      const q = xy[keep[k]];
      if (Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol && Math.hypot(p[0] - q[0], p[1] - q[1]) < tol && total - cum[k] > 2 * tol) {
        if (isSpur(xy, keep[k], n)) cut = k;
        break;
      }
    }
    if (cut >= 0) {
      keep.length = cut + 1;
      cum.length = cut + 1;
      total = cum[cut];
      continue;
    }
    keep.push(n);
    cum.push(total);
  }
  if (keep[keep.length - 1] !== coords.length - 1) keep.push(coords.length - 1);
  return keep.map((i) => coords[i]);
}

/** Shape quality of a route. `loop` = starts and ends at the same place. */
export function shapeMetrics(coords) {
  const xy = coords.map(flat(coords[0]));
  // resample to ~15 m
  const pts = [xy[0]];
  const cum = [0];
  let acc = 0;
  let run = 0;
  for (let i = 1; i < xy.length; i++) {
    const d = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    acc += d;
    run += d;
    if (acc >= 15) {
      pts.push(xy[i]);
      cum.push(run);
      acc = 0;
    }
  }
  const P = run || 1;

  // compactness: 1 = circle, small = long and thin or tangled
  let A = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    A += a[0] * b[1] - b[0] * a[1];
  }
  const compact = (4 * Math.PI * Math.abs(A / 2)) / (P * P);

  // backtrack: share of the route that re-uses a street already run (>250 m earlier)
  const cell = 20;
  const grid = new Map();
  let back = 0;
  pts.forEach((p, i) => {
    let hit = false;
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (const j of grid.get(cx + dx + ',' + (cy + dy)) || []) {
          if (cum[i] - cum[j] > 250 && Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]) < 14) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) back++;
    const key = cx + ',' + cy;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });

  // turns: heading changes over 60 m chords
  const heads = [];
  let last = pts[0];
  let dd = 0;
  for (let i = 1; i < pts.length; i++) {
    dd += 15;
    if (dd >= 60) {
      heads.push((Math.atan2(pts[i][0] - last[0], pts[i][1] - last[1]) * 180) / Math.PI);
      last = pts[i];
      dd = 0;
    }
  }
  let turns = 0;
  for (let i = 1; i < heads.length; i++) {
    let d = Math.abs(heads[i] - heads[i - 1]);
    if (d > 180) d = 360 - d;
    if (d > 55) turns++;
  }
  return { compact, backtrack: back / pts.length, turnsPerKm: turns / (P / 1000) };
}

/** Index of the vertex nearest to `ll` at or after `from`. */
export function nearestIndex(coords, ll, from = 0) {
  let best = Infinity;
  let at = from;
  for (let i = from; i < coords.length; i++) {
    const d = haversine(ll, coords[i]);
    if (d < best) {
      best = d;
      at = i;
    }
  }
  return at;
}

// Small geometry helpers. Points are [lat, lng] or [lat, lng, ele].
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Point `meters` away from `p` along compass `bearing` (degrees). */
export function destination(p, bearing, meters) {
  const d = meters / R;
  const br = rad(bearing);
  const lat1 = rad(p[0]);
  const lng1 = rad(p[1]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lat2), ((deg(lng2) + 540) % 360) - 180];
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function pathLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/** Cumulative distance array (meters) for a coordinate list. */
export function cumulative(coords) {
  const out = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + haversine(coords[i - 1], coords[i]);
  return out;
}

/** Linear interpolation of a point along a path at distance `m`. */
export function pointAtDistance(coords, cum, m) {
  if (m <= 0) return coords[0];
  const total = cum[cum.length - 1];
  if (m >= total) return coords[coords.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= m) lo = mid;
    else hi = mid;
  }
  const t = (m - cum[lo]) / (cum[hi] - cum[lo] || 1);
  const a = coords[lo];
  const b = coords[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * t : undefined];
}

/** Resample a path so points are at most `step` meters apart (keeps originals). */
export function densify(coords, step) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = haversine(a, b);
    const n = Math.floor(d / step);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(b);
  }
  return out;
}

/** Closest point on a polyline to `ll`, using flat-earth math (fine at city scale). Returns {index, point, dist}. */
export function closestOnPath(coords, ll) {
  const k = Math.cos(rad(ll[0]));
  let best = { dist: Infinity, index: 0, point: coords[0] };
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1][1] * k;
    const ay = coords[i - 1][0];
    const bx = coords[i][1] * k;
    const by = coords[i][0];
    const px = ll[1] * k;
    const py = ll[0];
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = (px - cx) ** 2 + (py - cy) ** 2;
    if (d < best.dist) best = { dist: d, index: i - 1, point: [cy, cx / k] };
  }
  best.dist = haversine(ll, best.point);
  return best;
}

export function bounds(coords) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const c of coords) {
    if (c[0] < s) s = c[0];
    if (c[0] > n) n = c[0];
    if (c[1] < w) w = c[1];
    if (c[1] > e) e = c[1];
  }
  return [[s, w], [n, e]];
}

/**
 * Fraction of the shorter route that lies within `tol` meters of the other route.
 * Used to drop near-duplicate suggestions.
 */
export function overlap(a, b, tol = 40) {
  const sample = (c) => densify(c, 60).filter((_, i) => i % 2 === 0);
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  const pts = sample(short);
  const ref = densify(long, 40);
  let hit = 0;
  for (const p of pts) {
    for (const q of ref) {
      if (Math.abs(p[0] - q[0]) < 0.0006 && Math.abs(p[1] - q[1]) < 0.0008 && haversine(p, q) < tol) {
        hit++;
        break;
      }
    }
  }
  return hit / pts.length;
}

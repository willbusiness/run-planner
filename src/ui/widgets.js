// Pieces shared by the results list, the editor and the library.
import { h } from './dom.js';
import { settings, fmtDistShort, fmtTime, fmtElev, fmtDist, KM_PER_MI } from '../settings.js';
import { analyze } from '../elevation.js';
import { bearing, cumulative, pointAtDistance } from '../geo.js';
import { drawProfile } from '../profile.js';
import { SURFACE_COLORS, SURFACE_LABELS, splits } from '../stats.js';
import { setScrub } from '../map/routes.js';

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const memo = new WeakMap();
const cached = (rec, key, make) => {
  let m = memo.get(rec);
  if (!m) memo.set(rec, (m = {}));
  return (m[key] ||= make());
};

/** [lat,lng,ele] points of a bank record. */
export const coordsOf = (rec) => rec.c;
export const analysisOf = (rec) => cached(rec, 'an', () => analyze(rec.c));
export const timeOf = (rec) => settings.pace * rec.gapKm;

export function titleOf(rec, start) {
  const target = rec.kind === 'out&back' ? rec.wps[1] : [rec.c.reduce((s, p) => s + p[0], 0) / rec.c.length, rec.c.reduce((s, p) => s + p[1], 0) / rec.c.length];
  const dir = DIRS[Math.round(bearing(start, target) / 45) % 8];
  const hill = rec.hills === 'flat' ? 'Flat' : rec.hills === 'hilly' ? 'Hilly' : 'Rolling';
  return `${hill} ${dir} ${rec.kind === 'loop' ? 'loop' : 'out & back'}`;
}

/** Small SVG outline of a route, scaled to a 56px square. */
export function thumb(coords) {
  const step = Math.max(1, Math.floor(coords.length / 70));
  const pts = coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
  const k = Math.cos((pts[0][0] * Math.PI) / 180);
  const xy = pts.map((p) => [p[1] * k, -p[0]]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1e-9);
  const sc = 48 / span;
  const ox = (56 - (Math.max(...xs) - x0) * sc) / 2;
  const oy = (56 - (Math.max(...ys) - y0) * sc) / 2;
  const d = xy.map((p, i) => `${i ? 'L' : 'M'}${((p[0] - x0) * sc + ox).toFixed(1)} ${((p[1] - y0) * sc + oy).toFixed(1)}`).join('');
  const el = document.createElement('div');
  el.className = 'thumb';
  el.innerHTML = `<svg viewBox="0 0 56 56"><path d="${d}"/></svg>`;
  return el;
}

export function statLine({ dist, time, gain }) {
  return h('div', { class: 'cstats' },
    h('span', null, h('b', null, fmtDistShort(dist).replace(' km', '')), settings.units === 'mi' ? ' mi' : ' km'),
    h('span', null, fmtTime(time)),
    h('span', null, '↑ ' + fmtElev(gain)),
  );
}

export function surfaceBar(surf, kinds) {
  const total = Object.values(surf).reduce((a, b) => a + b, 0);
  if (total < 50) return null;
  const parts = Object.entries(surf).filter(([, v]) => v / total >= 0.02);
  const kt = kinds ? Object.values(kinds).reduce((a, b) => a + b, 0) : 0;
  return h('div', null,
    h('div', { class: 'bar' }, parts.map(([k, v]) => h('i', { style: { flex: v, background: SURFACE_COLORS[k] }, title: SURFACE_LABELS[k] }))),
    h('div', { class: 'legend' },
      parts.map(([k, v]) => h('span', null, h('i', { style: { background: SURFACE_COLORS[k] } }), `${SURFACE_LABELS[k]} ${Math.round((v / total) * 100)}%`)),
      kt > 100 ? h('span', null, `${Math.round((kinds.path / kt) * 100)}% paths`) : null,
    ),
  );
}

/** Elevation chart that moves a dot on the map as you scrub. */
export function profileCanvas(an, coords) {
  const canvas = h('canvas', { class: 'profile' });
  const cum = cumulative(coords);
  const total = cum[cum.length - 1] || 1;
  queueMicrotask(() =>
    drawProfile(canvas, an, {
      onScrub: (i) => {
        if (i == null) return setScrub(null);
        setScrub(pointAtDistance(coords, cum, (an.d[i] / (an.dist || 1)) * total));
      },
    }),
  );
  return canvas;
}

export function splitsTable(an) {
  const rows = splits(an);
  const unit = settings.units;
  return h('table', { class: 'splits' },
    h('thead', null, h('tr', null, ...['#', unit, '↑', '↓', 'Time'].map((t) => h('th', null, t)))),
    h('tbody', null, rows.map((r) => h('tr', null,
      h('td', null, r.n),
      h('td', null, (r.dist / (unit === 'mi' ? KM_PER_MI * 1000 : 1000)).toFixed(2)),
      h('td', { class: 'up' }, Math.round(r.gain)),
      h('td', { class: 'dn' }, Math.round(r.loss)),
      h('td', null, fmtTime(r.time)),
    ))),
  );
}

export { fmtDist };

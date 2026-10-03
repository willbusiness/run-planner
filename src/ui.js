// Tiny UI toolkit: element builder, icons, and a few shared widgets.
import { drawProfile } from './profile.js';
import { fmtDist, fmtElev, fmtTime, fmtDistShort, settings } from './settings.js';
import { SURFACE_COLORS, SURFACE_LABELS } from './stats.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const PATHS = {
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
  redo: 'M21 7v6h-6M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13',
  trash: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  locate: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  save: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  swap: 'M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4',
  loop: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  x: 'M18 6 6 18M6 6l12 12',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  magnet: 'M6 15a6 6 0 0 0 12 0V3h-4v12a2 2 0 0 1-4 0V3H6zM6 8h4M14 8h4',
  search: 'M21 21l-4.3-4.3M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  back: 'M15 18l-6-6 6-6',
  out: 'M5 12h14M13 6l6 6-6 6',
  more: 'M12 5v.01M12 12v.01M12 19v.01',
};

export function icon(name, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', PATHS[name]);
  s.append(p);
  return s;
}

export function iconBtn(name, title, onclick, { label, cls = '', disabled = false } = {}) {
  return h('button', { class: 'ibtn ' + cls, title, 'aria-label': title, onclick, disabled }, icon(name, 18), label ? h('span', null, label) : null);
}

/** Segmented control. options: [[value,label],...]. */
export function seg(options, value, onchange) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  for (const [v, label] of options) {
    wrap.append(
      h('button', {
        type: 'button',
        class: v === value ? 'on' : '',
        onclick: () => {
          wrap.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
          wrap.children[options.findIndex((o) => o[0] === v)].classList.add('on');
          onchange(v);
        },
      }, label),
    );
  }
  return wrap;
}

export function toggle(label, checked, onchange) {
  return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span', null, label));
}

let toastTimer;
export function toast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---- shared route widgets ----
export function statTile(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label), sub ? h('div', { class: 'stat-s' }, sub) : null);
}

export function statsRow(sum) {
  return h('div', { class: 'stats' },
    statTile('Distance', fmtDistShort(sum.dist)),
    statTile('Climb', '↑ ' + fmtElev(sum.gain), '↓ ' + fmtElev(sum.loss)),
    statTile('Est. time', fmtTime(sum.time), `@ goal pace`),
  );
}

export function surfaceBar(surf) {
  const total = Object.values(surf).reduce((a, b) => a + b, 0);
  if (total < 50) return null;
  const parts = Object.entries(surf).filter(([, v]) => v / total >= 0.02);
  return h('div', { class: 'surf' },
    h('div', { class: 'surf-bar' }, parts.map(([k, v]) => h('span', { style: `flex:${v};background:${SURFACE_COLORS[k]}`, title: SURFACE_LABELS[k] }))),
    h('div', { class: 'surf-legend' }, parts.map(([k, v]) => h('span', null, h('i', { style: `background:${SURFACE_COLORS[k]}` }), `${SURFACE_LABELS[k]} ${Math.round((v / total) * 100)}%`))),
  );
}

/** Interactive elevation profile with a readout line. onScrub(distanceMeters|null) moves a map marker. */
export function profileBox(sum, onScrub) {
  const readout = h('div', { class: 'profile-readout' }, 'Hover or drag across the chart');
  const canvas = h('canvas', { class: 'profile' });
  const box = h('div', { class: 'profile-box' }, canvas, readout);
  queueMicrotask(() =>
    drawProfile(canvas, sum.an, {
      onScrub: (i) => {
        if (i == null) {
          readout.textContent = 'Hover or drag across the chart';
          onScrub?.(null);
          return;
        }
        const g = sum.an.g[i];
        readout.textContent = `${fmtDist(sum.an.d[i])} · ${Math.round(sum.an.e[i])} m · ${g >= 0 ? '+' : ''}${g.toFixed(1)}% grade`;
        onScrub?.(sum.an.d[i]);
      },
    }),
  );
  return box;
}

export function splitsTable(rows) {
  const unit = settings.units;
  return h('div', { class: 'tablewrap' },
    h('table', { class: 'splits' },
      h('thead', null, h('tr', null, ...['#', unit, '↑', '↓', 'Time'].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, r.n),
        h('td', null, (r.dist / (unit === 'mi' ? 1609.344 : 1000)).toFixed(2)),
        h('td', null, Math.round(r.gain)),
        h('td', null, Math.round(r.loss)),
        h('td', null, fmtTime(r.time)),
      ))),
    ),
  );
}

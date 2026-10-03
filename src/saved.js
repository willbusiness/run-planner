// Saved routes tab: list, open in Plan, rename, delete, GPX, backup/restore.
import { map, L, fitTo } from './map.js';
import { listRoutes, deleteRoute, updateMeta, exportAll, importAll } from './storage.js';
import { settings, emit, fmtDistShort, fmtElev } from './settings.js';
import { h, icon, iconBtn, toast } from './ui.js';
import { route as planRoute } from './plan.js';
import { bounds } from './geo.js';
import { toGPX, download, safeName } from './gpx.js';

const TAGS = { long: 'Long run', easy: 'Easy', tempo: 'Tempo', hills: 'Hills', race: 'Race sim' };
const group = L.layerGroup();
let rootEl;
let active = false;
let filterTag = '';
let selected = null;

const coordsOf = (rec) => rec.data.legs.flatMap((l, i) => (i ? l.c.slice(1) : l.c));

function drawMap() {
  group.clearLayers();
  for (const rec of listRoutes()) {
    if (filterTag && rec.tag !== filterTag) continue;
    const c = coordsOf(rec);
    if (c.length < 2) continue;
    const sel = rec.id === selected;
    L.polyline(c, { color: sel ? '#ff5a1f' : '#6d4aff', weight: sel ? 6 : 3, opacity: sel ? 1 : 0.6, pane: 'routes', bubblingMouseEvents: false })
      .on('click', () => { selected = rec.id; drawMap(); draw(); })
      .addTo(group);
  }
}

function open(rec) {
  planRoute.loadJSON(rec.data, { savedId: rec.id });
  emit('tab', 'plan');
  const c = coordsOf(rec);
  if (c.length) fitTo(bounds(c));
}

function draw() {
  if (!rootEl) return;
  const list = listRoutes();
  const shown = list.filter((r) => !filterTag || r.tag === filterTag);
  const total = shown.reduce((s, r) => s + r.dist, 0);
  rootEl.replaceChildren(
    h('div', { class: 'ex-head' },
      h('div', { class: 'ex-title' }, `Saved routes (${list.length})`),
      h('div', { class: 'tools' },
        iconBtn('download', 'Export backup', () => download('run-planner-backup.json', exportAll(), 'application/json')),
        iconBtn('upload', 'Import backup', () => rootEl.querySelector('.bk-file').click()),
        h('input', { type: 'file', class: 'bk-file', accept: '.json', hidden: true, onchange: restore }),
      ),
    ),
  );
  if (list.some((r) => r.tag)) {
    rootEl.append(h('div', { class: 'chips pad' },
      h('button', { class: 'chip' + (!filterTag ? ' on' : ''), onclick: () => { filterTag = ''; refresh(); } }, 'All'),
      ...Object.entries(TAGS).filter(([k]) => list.some((r) => r.tag === k)).map(([k, l]) => h('button', { class: 'chip' + (filterTag === k ? ' on' : ''), onclick: () => { filterTag = k; refresh(); } }, l))));
  }
  if (!shown.length) {
    rootEl.append(h('div', { class: 'empty' }, h('p', null, h('b', null, list.length ? 'Nothing with that tag.' : 'No saved routes yet.')), h('p', { class: 'muted' }, 'Save a route from Plan or Explore and it appears here. Everything is stored in this browser; use the export button to move routes between devices.')));
    return;
  }
  rootEl.append(h('div', { class: 'muted small pad' }, `${shown.length} routes · ${fmtDistShort(total)} total`));
  for (const rec of shown) {
    rootEl.append(
      h('div', { class: 'card saved' + (rec.id === selected ? ' sel' : ''), onclick: () => { selected = rec.id; drawMap(); const c = coordsOf(rec); if (c.length) fitTo(bounds(c)); draw(); } },
        h('div', { class: 'card-main' },
          h('div', { class: 'card-title' }, rec.name, rec.tag ? h('span', { class: 'tagpill' }, TAGS[rec.tag] || rec.tag) : null),
          h('div', { class: 'card-sub' }, `${fmtDistShort(rec.dist)} · ↑ ${fmtElev(rec.gain)} · ${new Date(rec.savedAt).toLocaleDateString()}`),
          rec.id === selected ? h('div', { class: 'actions' },
            h('button', { class: 'btn primary small', onclick: (e) => { e.stopPropagation(); open(rec); } }, icon('pencil', 14), 'Open'),
            h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); const n = prompt('Rename route', rec.name); if (n) { updateMeta(rec.id, { name: n }); refresh(); } } }, 'Rename'),
            h('button', { class: 'btn small', onclick: (e) => { e.stopPropagation(); download(safeName(rec.name) + '.gpx', toGPX(rec.name, coordsOf(rec)), 'application/gpx+xml'); } }, 'GPX'),
            h('button', { class: 'btn small danger', onclick: (e) => { e.stopPropagation(); if (confirm(`Delete "${rec.name}"?`)) { deleteRoute(rec.id); selected = null; refresh(); } } }, 'Delete'),
          ) : null,
        ),
      ),
    );
  }
}

async function restore(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const n = importAll(await f.text());
    toast(`Imported ${n} route${n === 1 ? '' : 's'}`);
    refresh();
  } catch (err) {
    toast(err.message);
  }
}

function refresh() {
  drawMap();
  draw();
}

export function initSaved(root) {
  rootEl = root;
  window.addEventListener('saved-changed', () => active && refresh());
  draw();
}
export function activateSaved() {
  active = true;
  group.addTo(map);
  refresh();
}
export function deactivateSaved() {
  active = false;
  group.remove();
}

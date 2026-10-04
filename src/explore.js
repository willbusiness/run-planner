// Explore mode: suggested routes always on the map, browse them, tweak filters to regenerate.
import { map, L, fitTo, setScrub } from './map.js';
import { settings, save, emit, fmtDistShort, fmtTime, fmtElev } from './settings.js';
import { h, icon, iconBtn, seg, toggle, toast, statsRow, surfaceBar, profileBox } from './ui.js';
import { generate } from './loops.js';
import * as ors from './routing.js';
import { osmRoutes, overlayEvents } from './overlays.js';
import { drawProfile } from './profile.js';
import { withElevation } from './elevation.js';
import { summarize, hillClass, emptySurf } from './stats.js';
import { bounds, haversine, cumulative, pointAtDistance, densify, pathLength } from './geo.js';
import { route as planRoute } from './plan.js';
import { Route } from './route.js';
import { saveRoute } from './storage.js';
import { toGPX, download, safeName } from './gpx.js';

const CACHE_KEY = 'runplanner.explore.v1';

const S = {
  active: false,
  start: null, // [lat,lng]
  suggestions: [],
  selected: null, // route id
  status: { state: 'idle', msg: '', done: 0, total: 0 },
  filtersOpen: false,
  genId: 0,
  osm: [],
};

// =============== map layer ===============
const group = L.layerGroup();
const lineLayers = new Map(); // id -> {casing, line, badge}
let pin;

function allRoutes() {
  return [...S.suggestions, ...S.osm];
}
const byId = (id) => allRoutes().find((r) => r.id === id);

function badgePoint(r) {
  const c = r.coords || r.main;
  if (r.source === 'osm') return c[Math.floor(c.length / 2)];
  let best = c[0], far = 0;
  for (const p of c) { const d = haversine(c[0], p); if (d > far) { far = d; best = p; } }
  return best;
}

const QUIET = '#5b7cfa';
const ACCENT = '#ff5a1f';

function drawMapRoutes() {
  group.clearLayers();
  lineLayers.clear();
  const sel = S.selected;
  const list = allRoutes();
  // draw unselected first so the selected route always sits on top
  const order = [...list.filter((r) => r.id !== sel), ...list.filter((r) => r.id === sel)];
  for (const r of order) {
    const isSel = r.id === sel;
    const osm = r.source === 'osm';
    const chains = osm ? r.chains : [r.coords];
    const color = isSel ? ACCENT : osm ? '#9a6bd1' : QUIET;
    const casings = chains.map((c) => L.polyline(c, { color: '#fff', weight: isSel ? 10 : 6, opacity: isSel ? 0.95 : 0.7, pane: 'routes', interactive: false }).addTo(group));
    const lines = chains.map((c) => L.polyline(c, {
      color, weight: isSel ? 6 : 3.5, opacity: isSel ? 1 : sel ? 0.55 : 0.8, pane: 'routes', bubblingMouseEvents: false,
      dashArray: osm && !isSel ? '1 6' : null, lineCap: 'round', lineJoin: 'round',
    }).on('click', () => select(r.id, { fit: false })).addTo(group));
    const n = osm ? null : S.suggestions.indexOf(r) + 1;
    const label = osm ? fmtDistShort(r.length).replace(' ', '') : n;
    const badge = osm && !isSel ? null : L.marker(badgePoint(r), {
      pane: 'handles', zIndexOffset: isSel ? 900 : 0, keyboard: false,
      icon: L.divIcon({ className: '', html: `<div class="badge ${osm ? 'osm' : ''} ${isSel ? 'sel' : ''}">${label}</div>`, iconSize: [osm ? 46 : 24, 24], iconAnchor: [osm ? 23 : 12, 12] }),
    })?.on('click', () => select(r.id, { fit: false })).addTo(group);
    lineLayers.set(r.id, { casings, lines, badge });
  }
  drawPin();
}

/** Desktop hover on a card previews its line on the map. */
function preview(id, on) {
  const l = lineLayers.get(id);
  if (!l || id === S.selected) return;
  l.lines.forEach((x) => { x.setStyle({ color: on ? ACCENT : QUIET, weight: on ? 6 : 3.5, opacity: on ? 1 : S.selected ? 0.55 : 0.8 }); if (on) x.bringToFront(); });
}

function drawPin() {
  pin?.remove();
  if (!S.start || !S.active) return;
  pin = L.marker(S.start, {
    draggable: true, pane: 'handles', zIndexOffset: 1000, keyboard: false, title: 'Search start. Drag to move.',
    icon: L.divIcon({ className: '', html: '<div class="pin"><span></span></div>', iconSize: [30, 38], iconAnchor: [15, 36] }),
  }).addTo(group);
  pin.on('dragend', () => {
    const ll = pin.getLatLng();
    search([ll.lat, ll.lng]);
  });
}

// =============== data ===============
const sigOf = () => {
  const p = settings.prefs;
  return [p.surface, p.quiet, p.green, p.avoidStairs, p.hills, p.shape, p.minKm, p.maxKm].join('|');
};
const cacheKey = (start) => `${start[0].toFixed(3)},${start[1].toFixed(3)}|${sigOf()}`;

function saveCache(start, routes) {
  try {
    const slim = routes.map((r) => ({ kind: r.kind, wps: r.wps, legs: r.legs.map((l) => ({ c: l.coords.map((c) => [+c[0].toFixed(5), +c[1].toFixed(5), c[2] == null ? null : +c[2].toFixed(1)]), s: l.surf })) }));
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key: cacheKey(start), routes: slim }));
  } catch { /* storage full: not important */ }
}

function loadCache(start) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!c || c.key !== cacheKey(start)) return null;
    return c.routes.map((r, i) => {
      const legs = r.legs.map((l) => ({ coords: l.c, surf: l.s, mode: 'snap' }));
      const coords = [];
      const surf = emptySurf();
      legs.forEach((l) => { coords.push(...(coords.length ? l.coords.slice(1) : l.coords)); Object.keys(surf).forEach((k) => (surf[k] += l.surf?.[k] || 0)); });
      const sum = summarize(coords, surf);
      return { id: `c${i}-${Math.round(sum.dist)}`, source: 'generated', kind: r.kind, wps: r.wps, legs, coords, ...sum, hills: hillClass(sum.gain, sum.dist) };
    });
  } catch {
    return null;
  }
}

export async function search(start, { fresh = false, fit = true } = {}) {
  const id = ++S.genId;
  touched = false;
  S.start = start;
  S.ref = start;
  S.selected = null;
  hideSearchPill();
  if (!fresh) {
    const cached = loadCache(start);
    if (cached?.length) {
      S.suggestions = cached;
      S.status = { state: 'done', msg: `${cached.length} routes (saved from last search)`, done: 0, total: 0 };
      refresh();
      if (fit) fitAll();
      return;
    }
  }
  S.suggestions = [];
  S.status = { state: 'loading', msg: 'Finding routes…', done: 0, total: 0 };
  refresh();
  try {
    const list = await generate({
      start,
      prefs: { ...settings.prefs },
      count: 6,
      seed: fresh ? Date.now() : hashSeed(cacheKey(start)),
      isCancelled: () => id !== S.genId,
      onRoute: (r) => {
        if (id !== S.genId) return;
        S.suggestions.push(r);
        if (!S.selected && S.suggestions.length === 1) { S.selected = r.id; ensureProfile(r); }
        refresh();
      },
      onProgress: (done, total) => {
        if (id !== S.genId) return;
        S.status = { ...S.status, done, total, msg: `Finding routes… ${done}/${total}` };
        updateStatus();
      },
    });
    if (id !== S.genId) return;
    S.suggestions = list;
    if (list.length && !list.some((r) => r.id === S.selected)) S.selected = list[0].id;
    S.status = { state: 'done', msg: list.length ? `${list.length} routes near here` : 'No routes fit those filters here. Widen the distance range or try another spot.', done: 0, total: 0 };
    if (list.length) saveCache(start, list);
    refresh();
    if (fit && list.length) fitAll();
  } catch (e) {
    if (id !== S.genId) return;
    S.status = { state: 'error', msg: e.message, done: 0, total: 0 };
    refresh();
  }
}

function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

let touched = false; // has the user grabbed the map since the search began?
['pointerdown', 'wheel', 'touchstart'].forEach((ev) => map.getContainer().addEventListener(ev, () => { touched = true; }, { passive: true }));

function fitAll() {
  const pts = S.suggestions.flatMap((r) => r.coords);
  if (!pts.length || touched || !S.active) return;
  S.refPending = true;
  fitTo(bounds(pts));
}

// OSM relations -> route-like objects (elevation is fetched lazily when selected)
function syncOsm() {
  S.osm = osmRoutes()
    .filter((r) => r.length >= 2500 && r.length <= 60000)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8)
    .map((r) => ({ id: 'osm' + r.id, source: 'osm', kind: 'osm', name: r.name, tags: r.tags, chains: r.chains, main: r.main, length: r.length, closed: r.closed, dist: r.length, an: null }));
  if (S.selected && !byId(S.selected)) S.selected = null;
  if (S.active) refresh();
}
overlayEvents.addEventListener('routes', syncOsm);

async function ensureProfile(r) {
  if (r.source !== 'osm' || r.sum || r.loading) return;
  r.loading = true;
  refreshPanel();
  try {
    const coords = await withElevation(r.main.length > 2 ? limitLength(r.main, 40000) : r.main);
    r.sum = summarize(coords, emptySurf());
    r.coords = coords;
  } catch {
    toast('Could not load elevation for that route.');
  }
  r.loading = false;
  refreshPanel();
}

function limitLength(coords, max) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += haversine(coords[i - 1], coords[i]);
    if (d > max) return coords.slice(0, i);
  }
  return coords;
}

// =============== selection & actions ===============
function select(id, { fit = true } = {}) {
  S.selected = id;
  const r = byId(id);
  setScrub();
  drawMapRoutes();
  refreshPanel();
  emit('sheet', 'half');
  if (r) {
    ensureProfile(r);
    if (fit) {
      S.refPending = true;
      fitTo(bounds(r.source === 'osm' ? r.main : r.coords));
    }
  }
  requestAnimationFrame(() => document.querySelector('#view-explore .detail')?.scrollIntoView({ block: 'nearest' }));
}

const titleOf = (r) => (r.source === 'osm' ? r.name : `${r.kind === 'loop' ? 'Loop' : 'Out & back'} · ${fmtDistShort(r.dist)}`);

function toPlan(r) {
  if (r.source === 'osm') {
    if (!r.coords) return toast('Still loading that route…');
    planRoute.loadTrack(r.coords, { name: r.name });
  } else {
    planRoute.load(r.wps, r.legs, { name: titleOf(r) });
  }
  emit('tab', 'plan');
  fitTo(bounds(r.coords));
}

function saveSuggestion(r) {
  const tmp = new Route();
  if (r.source === 'osm') {
    if (!r.coords) return toast('Still loading that route…');
    tmp.loadTrack(r.coords, { name: r.name });
  } else tmp.load(r.wps, r.legs, { name: titleOf(r) });
  if (saveRoute(tmp, r.sum || r)) { toast('Saved to your routes'); emit('saved-changed'); }
}

// =============== panel ===============
let rootEl;

function card(r) {
  const isSel = r.id === S.selected;
  const an = (r.sum || r).an;
  const spark = h('canvas', { class: 'spark' });
  const n = r.source === 'osm' ? null : S.suggestions.indexOf(r) + 1;
  const el = h('button', { class: 'card' + (isSel ? ' sel' : ''), onclick: () => select(r.id), onmouseenter: () => preview(r.id, true), onmouseleave: () => preview(r.id, false) },
    h('i', { class: 'num' + (r.source === 'osm' ? ' osm' : '') + (isSel ? ' sel' : '') }, n || '↗'),
    h('div', { class: 'card-main' },
      h('div', { class: 'card-title' }, titleOf(r)),
      h('div', { class: 'card-sub' },
        r.source === 'osm'
          ? [fmtDistShort(r.length), r.tags.route === 'running' ? 'running route' : r.tags.route === 'fitness_trail' ? 'fitness trail' : 'walking/hiking route', r.closed ? 'loop' : null].filter(Boolean).join(' · ')
          : `↑ ${fmtElev(r.gain)} · ${r.hills} · ${fmtTime(r.time)}`),
    ),
    an && an.d.length > 2 ? spark : null,
  );
  if (an && an.d.length > 2) queueMicrotask(() => drawProfile(spark, an, { compact: true }));
  return el;
}

function detail(r) {
  const sum = r.source === 'osm' ? r.sum : r;
  const tags = r.tags || {};
  const box = h('div', { class: 'detail' },
    h('div', { class: 'detail-head' },
      h('div', null, h('div', { class: 'detail-title' }, titleOf(r)),
        h('div', { class: 'muted small' }, r.source === 'osm'
          ? ['Existing route (OpenStreetMap)', tags.network ? `network: ${tags.network}` : null, tags.operator].filter(Boolean).join(' · ')
          : `${r.kind === 'loop' ? 'Loop' : 'Out and back'} · ${r.hills} terrain`)),
      iconBtn('x', 'Close', () => { S.selected = null; drawMapRoutes(); refreshPanel(); setScrub(); }, { cls: 'close' }),
    ),
  );
  if (!sum) {
    box.append(h('div', { class: 'muted pad' }, r.loading ? 'Loading elevation…' : 'No elevation data.'));
  } else {
    box.append(statsRow(sum));
    box.append(profileBox(sum, (m) => setScrub(sum.coords, m)));
    const sb = surfaceBar(sum.surf);
    if (sb) box.append(sb);
  }
  if (r.source === 'osm') {
    const bits = [tags.description, tags.distance ? `Listed length: ${tags.distance} km` : null, r.chains.length > 1 ? `Route has ${r.chains.length} separate pieces in view; showing the longest for stats.` : null].filter(Boolean);
    bits.forEach((b) => box.append(h('p', { class: 'muted small' }, b)));
    if (tags.website || tags.url) box.append(h('a', { href: tags.website || tags.url, target: '_blank', rel: 'noopener', class: 'small' }, 'Website'));
    box.append(h('a', { href: `https://www.openstreetmap.org/relation/${r.id.slice(3)}`, target: '_blank', rel: 'noopener', class: 'small' }, ' View on OSM'));
  }
  box.append(
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => toPlan(r), disabled: !sum }, icon('pencil', 16), 'Edit in Plan'),
      h('button', { class: 'btn', onclick: () => saveSuggestion(r), disabled: !sum }, icon('save', 16), 'Save'),
      h('button', { class: 'btn', disabled: !sum, onclick: () => download(safeName(titleOf(r)) + '.gpx', toGPX(titleOf(r), r.coords), 'application/gpx+xml') }, icon('download', 16), 'GPX'),
    ),
  );
  return box;
}

function filters() {
  const p = settings.prefs;
  const set = (k, v) => { p[k] = v; save(); scheduleSearch(); refreshSummary(); };
  const presets = [['5K', 5], ['10K', 10], ['15K', 15], ['Half', 21.1], ['Long', 30]];
  const minI = h('input', { type: 'number', class: 'num', min: 1, max: 80, step: 0.5, value: p.minKm, onchange: (e) => { p.minKm = +e.target.value; if (p.maxKm < p.minKm) { p.maxKm = p.minKm; maxI.value = p.maxKm; } save(); scheduleSearch(); refreshSummary(); } });
  const maxI = h('input', { type: 'number', class: 'num', min: 1, max: 80, step: 0.5, value: p.maxKm, onchange: (e) => { p.maxKm = +e.target.value; if (p.minKm > p.maxKm) { p.minKm = p.maxKm; minI.value = p.minKm; } save(); scheduleSearch(); refreshSummary(); } });
  return h('div', { class: 'filters' },
    h('div', { class: 'pref' }, h('label', null, 'Distance (km)'),
      h('div', { class: 'range' }, minI, h('span', null, 'to'), maxI),
      h('div', { class: 'chips' }, presets.map(([l, km]) => h('button', { class: 'chip', onclick: () => { p.minKm = Math.round(km * 0.9 * 2) / 2; p.maxKm = Math.round(km * 1.1 * 2) / 2; if (km === 21.1) { p.minKm = 20; p.maxKm = 22.5; } minI.value = p.minKm; maxI.value = p.maxKm; save(); scheduleSearch(); refreshSummary(); } }, l))),
    ),
    h('div', { class: 'pref' }, h('label', null, 'Surface'), seg([['road', 'Roads'], ['mixed', 'Mixed'], ['trail', 'Trails']], p.surface, (v) => set('surface', v))),
    h('div', { class: 'pref' }, h('label', null, 'Hills'), seg([['any', 'Any'], ['flat', 'Flat'], ['rolling', 'Rolling'], ['hilly', 'Hilly']], p.hills, (v) => set('hills', v))),
    h('div', { class: 'pref' }, h('label', null, 'Shape'), seg([['any', 'Any'], ['loop', 'Loops'], ['out&back', 'Out & back']], p.shape, (v) => set('shape', v))),
    h('div', { class: 'pref' }, toggle('Quiet streets', p.quiet, (v) => set('quiet', v)), toggle('Parks & green', p.green, (v) => set('green', v)), toggle('Avoid stairs', p.avoidStairs, (v) => set('avoidStairs', v))),
  );
}

const summaryText = () => {
  const p = settings.prefs;
  return `${p.minKm}–${p.maxKm} km · ${{ road: 'Roads', mixed: 'Mixed', trail: 'Trails' }[p.surface]} · ${p.hills === 'any' ? 'Any hills' : p.hills[0].toUpperCase() + p.hills.slice(1)}${p.shape !== 'any' ? ' · ' + (p.shape === 'loop' ? 'Loops' : 'Out & back') : ''}`;
};
function refreshSummary() {
  const el = rootEl?.querySelector('.summary-text');
  if (el) el.textContent = summaryText();
}

let searchTimer;
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => S.start && search(S.start, { fresh: false }), 1100);
}

function updateStatus() {
  const el = rootEl?.querySelector('.status');
  if (el) el.replaceWith(statusEl());
}

function statusEl() {
  const { state, msg } = S.status;
  const u = ors.usage();
  return h('div', { class: 'status ' + state },
    state === 'loading' ? h('span', { class: 'spinner' }) : null,
    h('span', null, msg || (state === 'idle' ? 'Pan the map, then press “Search here”.' : '')),
    ors.usingOrs() ? h('span', { class: 'quota', title: 'OpenRouteService requests used today' }, `${u.used}/${u.limit}`) : null,
  );
}

function draw() {
  rootEl.replaceChildren();
  const loading = S.status.state === 'loading';
  rootEl.append(
    h('div', { class: 'ex-head' },
      h('div', { class: 'ex-title' }, 'Suggested routes'),
      h('div', { class: 'tools' },
        iconBtn('refresh', 'New suggestions here', () => { S.start = [map.getCenter().lat, map.getCenter().lng]; search(S.start, { fresh: true }); }, { disabled: loading }),
        iconBtn('sliders', 'Filters', () => { S.filtersOpen = !S.filtersOpen; draw(); }, { cls: S.filtersOpen ? 'on' : '' }),
      ),
    ),
    h('button', { class: 'summary', onclick: () => { S.filtersOpen = !S.filtersOpen; draw(); } }, h('span', { class: 'summary-text' }, summaryText())),
  );
  if (S.filtersOpen) rootEl.append(filters());
  rootEl.append(statusEl());

  const sel = S.selected && byId(S.selected);
  if (sel) rootEl.append(detail(sel));

  if (S.suggestions.length) rootEl.append(h('div', { class: 'section' }, 'Generated for you'), ...S.suggestions.map(card));

  if (settings.layers.routes) {
    rootEl.append(h('div', { class: 'section' }, S.osm.length ? `Existing routes in view (${S.osm.length})` : 'Existing routes'));
    if (S.osm.length) rootEl.append(...S.osm.map(card));
    else rootEl.append(h('p', { class: 'muted small pad' }, map.getZoom() < 12 ? 'Zoom in to load named running and walking routes from OpenStreetMap.' : 'No named routes found in this view.'));
  }
}

function refreshPanel() {
  if (rootEl && S.active) draw();
}
function refresh() {
  drawMapRoutes();
  refreshPanel();
}

// =============== "search this area" pill ===============
const pill = () => document.getElementById('searchpill');
function hideSearchPill() { pill().hidden = true; }
function checkPill() {
  if (!S.active || !S.start) return hideSearchPill();
  const b = map.getBounds();
  const widthM = haversine([b.getCenter().lat, b.getWest()], [b.getCenter().lat, b.getEast()]);
  const c = map.getCenter();
  // after our own fit-to-routes move, re-anchor instead of offering a new search
  if (S.refPending) { S.refPending = false; S.ref = [c.lat, c.lng]; return hideSearchPill(); }
  pill().hidden = !(haversine(S.ref || S.start, [c.lat, c.lng]) > widthM * 0.35) || S.status.state === 'loading';
}

// =============== lifecycle ===============
export function initExplore(root) {
  rootEl = root;
  S.start = [map.getCenter().lat, map.getCenter().lng];
  map.on('moveend', checkPill);
  pill().addEventListener('click', () => {
    const c = map.getCenter();
    search([c.lat, c.lng], { fit: false });
  });
  window.addEventListener('ors-usage', () => S.active && rootEl.querySelector('.quota') && (rootEl.querySelector('.quota').textContent = `${ors.usage().used}/${ors.usage().limit}`));
  window.addEventListener('keychanged', () => { if (S.status.state === 'error') search(S.start, { fresh: false }); });
  window.addEventListener('settings-changed', () => S.active && refresh());
  syncOsm();
  draw();
}

export function activateExplore() {
  S.active = true;
  group.addTo(map);
  drawMapRoutes();
  draw();
  checkPill();
}
export function deactivateExplore() {
  S.active = false;
  group.remove();
  hideSearchPill();
  setScrub();
}
export function firstSearch() {
  search([map.getCenter().lat, map.getCenter().lng]);
}

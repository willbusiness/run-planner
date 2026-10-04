// The route editor: big live stats, elevation profile, tools, save/export. The map side is map/edit.js.
import { h, icon, iconBtn, seg, toast } from './dom.js';
import { Route } from '../route.js';
import { editLayer } from '../map/edit.js';
import { fitCoords } from '../map/routes.js';
import { state, setMode, bus } from '../app.js';
import { settings, fmtDistShort, fmtTime, KM_PER_MI } from '../settings.js';
import { profileCanvas, surfaceBar, splitsTable } from './widgets.js';
import { saveRoute, shareHash } from '../storage.js';
import { toGPX, download, safeName, parseGPX } from '../gpx.js';
import { showView } from './panel.js';

let route = null;
let root = null;
let splitsOpen = false;
let baseline = '';
let lastSum = null; // shown (dimmed) while the route is re-routing, so the numbers don't flash to dashes

const snap = () => JSON.stringify(route.waypoints.map((p) => p.map((v) => +v.toFixed(5))));

/** Open the editor with a route (or a fresh one starting at the start pin). */
export function openEditor(r, { fit = true } = {}) {
  closeEditor(false);
  route = r || new Route();
  if (!r) {
    route.addWaypoint([...state.start]);
    route.name = '';
  }
  baseline = snap();
  lastSum = null;
  setMode('edit');
  editLayer.attach(route);
  editLayer.onRender = onRender;
  route.addEventListener('error', onError);
  root = buildEditor();
  showView(root);
  if (fit && route.coords().length > 1) fitCoords(route.coords());
  onRender();
}

const onError = (e) => toast(e.detail, 5000);

/** Leave the editor. Unsaved edits to a route ask first (unless `ask` is false). */
export async function closeEditor(ask = true) {
  if (!route) return;
  if (ask && snap() !== baseline && !route.savedId) {
    const choice = await confirmDialog('Keep this route?', 'You have changes that are not saved yet.', 'Save', 'Discard');
    if (choice === 'save') { doSave(); } else if (choice === 'cancel') return;
  }
  route.removeEventListener('error', onError);
  editLayer.onRender = null;
  editLayer.detach();
  route = null;
  root = null;
  if (ask) { setMode('find'); showView(null); }
}

function confirmDialog(title, text, yes, no) {
  return new Promise((resolve) => {
    const dlg = h('dialog', null,
      h('div', { class: 'dhead' }, h('h2', null, title)),
      h('div', { class: 'dbody' }, h('p', { style: { margin: 0, color: 'var(--ink-2)' } }, text),
        h('div', { class: 'row2', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn', onclick: () => done('cancel') }, 'Cancel'),
          h('button', { class: 'btn danger', onclick: () => done('discard') }, no),
          h('button', { class: 'btn primary', onclick: () => done('save') }, yes))));
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done('cancel'); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

function doSave() {
  if (route.pending || route.hasError) return toast('Wait for the route to finish updating first.');
  const sum = route.summary();
  if (!route.name) route.name = `Run ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
  const id = saveRoute(route, sum);
  if (id) { route.savedId = id; baseline = snap(); toast('Saved to My routes'); onRender(); }
}

// ---- the panel ----
let els = {};

function buildEditor() {
  const nameInput = h('input', { class: 'name', placeholder: 'Name this route', value: route.name || '', 'aria-label': 'Route name', oninput: (e) => { route.name = e.target.value; } });
  const undo = iconBtn('undo', 'Undo  ⌘Z', () => route.undo());
  const redo = iconBtn('redo', 'Redo  ⇧⌘Z', () => route.redo());
  const mode = seg([['snap', 'Snap to paths', 'snap'], ['free', 'Free draw', 'free']], editLayer.addMode, (v) => { editLayer.addMode = v; });
  els = {
    undo, redo, name: nameInput,
    stats: h('div', { class: 'bigstats' }),
    msg: h('div', { class: 'hint' }),
    chart: h('div', { class: 'sect' }),
    tools: h('div', { class: 'sect' },
      h('h3', null, 'Draw'),
      mode,
      h('div', { class: 'tools', style: { marginTop: '8px' } },
        h('button', { class: 'btn sm', type: 'button', onclick: () => route.closeLoop(editLayer.addMode) }, icon('loop', 16), 'Back to start'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => route.outAndBack() }, icon('outback', 16), 'Out & back'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => route.reverse() }, icon('flip', 16), 'Reverse'),
        h('button', { class: 'btn sm danger', type: 'button', onclick: () => route.clear() }, icon('trash', 16), 'Clear'),
      ),
    ),
    surf: h('div', { class: 'sect' }),
    splits: h('div', { class: 'sect' }),
    actions: h('div', { class: 'sect' }),
  };
  const file = h('input', { type: 'file', accept: '.gpx', hidden: true, onchange: importGpx });
  els.actions.append(
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary grow', type: 'button', onclick: doSave }, icon('bookmark', 18), 'Save'),
      h('button', { class: 'btn', type: 'button', title: 'Download GPX', onclick: () => download(safeName(route.name) + '.gpx', toGPX(route.name || 'Run', route.coords()), 'application/gpx+xml') }, icon('download', 18), 'GPX'),
      h('button', { class: 'btn', type: 'button', title: 'Copy a link that re-creates this route', onclick: copyLink }, icon('link', 18)),
      h('button', { class: 'btn', type: 'button', title: 'Import a GPX file', onclick: () => file.click() }, icon('upload', 18)),
      file,
    ),
  );
  return h('div', { class: 'view editor' },
    h('div', { class: 'ehead' },
      iconBtn('back', 'Back', () => closeEditor(true)),
      nameInput, undo, redo),
    els.stats, els.msg, els.chart, els.tools, els.surf, els.splits, els.actions);
}

let renderTimer;
function onRender() {
  if (!route || !root) return;
  cancelAnimationFrame(renderTimer);
  renderTimer = requestAnimationFrame(paint);
}

const big = (label, value, unit) => h('div', { class: 'bigstat' }, h('small', null, label), h('b', null, value, unit ? h('em', null, unit) : null));

function paint() {
  if (!route || !root) return;
  els.undo.disabled = !route.canUndo;
  els.redo.disabled = !route.canRedo;
  const ready = route.legs.some((l) => l.status === 'ok');
  const n = route.waypoints.length;
  const fresh = ready && !route.pending ? route.summary() : null;
  if (fresh) lastSum = fresh;
  if (!ready) lastSum = null;
  const sum = fresh || lastSum;
  const km = sum ? (settings.units === 'mi' ? sum.dist / 1000 / KM_PER_MI : sum.dist / 1000) : 0;
  els.stats.classList.toggle('stale', !fresh && !!sum);
  els.stats.replaceChildren(
    big('Distance', sum ? km.toFixed(2) : '–', settings.units),
    big('Time', sum ? fmtTime(sum.time) : '–'),
    big('Climb', sum ? Math.round(sum.gain) : '–', 'm'),
  );
  els.msg.replaceChildren(
    ...(n <= 1 && !ready
      ? [h('b', null, 'Click the map'), ' to add points. The route follows paths and streets. Drag a point, or the line itself, to reshape.']
      : route.hasError
        ? [h('b', { style: { color: 'var(--bad)' } }, 'Part of the route could not be found. '), 'Move the red point, or right-click it and draw that leg freehand.']
        : route.pending
          ? [h('span', { class: 'spin', style: { display: 'inline-block', marginRight: '8px', verticalAlign: '-1px' } }), 'Updating…']
          : []),
  );
  if (editLayer.dragIdx >= 0) return; // don't rebuild the chart under the pointer mid-drag
  if (fresh) {
    els.chart.replaceChildren(h('h3', null, 'Elevation'), profileCanvas(sum.an, sum.coords));
    const sb = surfaceBar(sum.surf, sum.kinds);
    els.surf.replaceChildren(...(sb ? [h('h3', null, 'Surface'), sb] : []));
    els.splits.replaceChildren(
      h('details', { open: splitsOpen, ontoggle: (e) => { splitsOpen = e.target.open; } },
        h('summary', { style: { cursor: 'pointer', fontWeight: 650, padding: '4px 0' } }, `Splits per ${settings.units === 'mi' ? 'mile' : 'km'}`),
        splitsTable(sum.an)),
    );
  } else if (!ready) {
    els.chart.replaceChildren();
    els.surf.replaceChildren();
    els.splits.replaceChildren();
  }
}

async function importGpx(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const { name, coords } = parseGPX(await f.text());
    route.loadTrack(coords, { name: name || f.name.replace(/\.gpx$/i, '') });
    els.name.value = route.name;
    fitCoords(coords);
  } catch (err) {
    toast(err.message);
  }
  e.target.value = '';
}

async function copyLink() {
  const url = location.origin + location.pathname + shareHash(route);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Opening it re-creates this route on any device.');
  } catch {
    toast(url, 8000);
  }
}

export const editing = () => !!route;
export const undoRoute = () => route?.undo();
export const redoRoute = () => route?.redo();
bus.addEventListener('units', () => paint());

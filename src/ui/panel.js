// The floating panel: start pill + settings, three tabs (Suggest / Draw / Saved), and a body that swaps views.
import { h, icon, iconBtn, seg } from './dom.js';
import { buildFind } from './find.js';
import { state, bus, isHome, setMode } from '../app.js';
import { openStartMenu } from './startmenu.js';
import { openLibrary } from './library.js';
import { openSettings } from './settings.js';
import { openEditor, closeEditor, editing } from './editor.js';
import { quota } from '../ors.js';
import { settings } from '../settings.js';

let body;
let find;
let tabs;
let pillName;
let pillTag;
let foot;

const phone = window.matchMedia('(max-width: 859px)');

/** Bottom-sheet behaviour on phones: drag the handle between peek, half and full. */
function mountSheet(root) {
  const grab = h('div', { class: 'grab', 'aria-label': 'Drag to resize' }, h('span'));
  root.prepend(grab);
  const snaps = () => [Math.round(innerHeight * 0.2), Math.round(innerHeight * 0.52), Math.round(innerHeight * 0.88)];
  let height = snaps()[1];
  const apply = (px, animate) => {
    root.style.transition = animate ? 'height 0.3s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    height = px;
    root.style.height = px + 'px';
    document.documentElement.style.setProperty('--sheet-h', px + 'px');
  };
  const set = () => phone.matches && apply(height, false);
  let startY = 0, startH = 0, lastY = 0, lastT = 0, vel = 0;
  const down = (e) => { startY = lastY = e.clientY; startH = height; lastT = performance.now(); vel = 0; grab.setPointerCapture(e.pointerId); grab.dataset.drag = '1'; };
  const move = (e) => {
    if (!grab.dataset.drag) return;
    const now = performance.now();
    vel = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY; lastT = now;
    apply(Math.max(90, Math.min(innerHeight * 0.92, startH + (startY - e.clientY))), false);
  };
  const up = () => {
    if (!grab.dataset.drag) return;
    delete grab.dataset.drag;
    const pts = snaps();
    const target = height - vel * 220; // a flick carries it to the next stop
    apply(pts.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)), true);
  };
  grab.addEventListener('pointerdown', down);
  grab.addEventListener('pointermove', move);
  grab.addEventListener('pointerup', up);
  grab.addEventListener('pointercancel', up);
  phone.addEventListener('change', () => {
    if (phone.matches) apply(snaps()[1], false);
    else { root.style.height = ''; root.style.transition = ''; document.documentElement.style.removeProperty('--sheet-h'); }
  });
  window.addEventListener('resize', set);
  if (phone.matches) apply(height, false);
}

async function onTab(v) {
  if (v === state.mode) return v === 'find' && showView(null);
  if (editing() && !(await closeEditor(true, { next: 'none' }))) return tabs.set(state.mode); // cancelled: stay
  if (v === 'find') { setMode('find'); showView(null); }
  else if (v === 'edit') openEditor(null);
  else openLibrary();
}

export function mountPanel(root) {
  pillTag = h('small', null, 'Starting from');
  pillName = h('b', null);
  const pill = h('button', { class: 'startpill', type: 'button', onclick: () => openStartMenu(pill) },
    h('span', { class: 'dot' }, icon('pin', 17)), h('span', { style: { minWidth: 0 } }, pillTag, pillName), h('span', { style: { color: 'var(--ink-3)', marginLeft: 'auto' } }, icon('down', 16)));
  tabs = seg([['find', 'Suggest', 'route'], ['edit', 'Draw', 'pencil'], ['library', 'Saved', 'bookmark']], 'find', onTab, 'tabs');
  body = h('div', { class: 'pbody' });
  foot = h('button', { class: 'pfoot', type: 'button', onclick: openSettings });
  root.append(
    h('div', { class: 'phead', id: 'phead' }, pill, iconBtn('gear', 'Settings', openSettings)),
    h('div', { class: 'tabsrow' }, tabs),
    body,
    foot,
  );
  find = buildFind();
  body.append(find);
  mountSheet(root);

  const paintPill = () => {
    pillName.textContent = state.startName;
    pillTag.textContent = isHome() ? 'Home' : 'Starting from';
  };
  const paintFoot = () => {
    const q = quota();
    foot.hidden = !settings.orsKey;
    if (!settings.orsKey) return;
    foot.replaceChildren(h('i', { class: q && q.remaining < 20 ? 'low' : '' }), q ? `OpenRouteService · ${q.remaining} of ${q.limit} left today` : 'OpenRouteService key active');
    foot.title = 'Your OpenRouteService requests left today. Click for settings.';
  };
  bus.addEventListener('start', paintPill);
  bus.addEventListener('mode', () => tabs.set(state.mode));
  window.addEventListener('ors-usage', paintFoot);
  window.addEventListener('keychange', paintFoot);
  paintPill();
  paintFoot();
}

/** Show an element in the panel body, or the Suggest screen when null. */
export function showView(el) {
  const next = el || find;
  body.replaceChildren(next);
  body.scrollTop = 0;
  if (next === find) find.refresh();
}

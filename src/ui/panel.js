// The floating panel: header (start pill, library, settings) and a body that swaps between views.
import { h, icon, iconBtn } from './dom.js';
import { buildFind } from './find.js';
import { state, bus, isHome } from '../app.js';
import { openStartMenu } from './startmenu.js';
import { openLibrary } from './library.js';
import { openSettings } from './settings.js';

let body;
let find;
let pillName;
let pillTag;

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
    root.style.setProperty('--sheet', px + 'px');
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
  root.expandSheet = () => phone.matches && height < snaps()[1] && apply(snaps()[1], true);
}

export function mountPanel(root) {
  pillTag = h('small', null, 'Starting from');
  pillName = h('b', null);
  const pill = h('button', { class: 'startpill', type: 'button', onclick: () => openStartMenu(pill) },
    h('span', { class: 'dot' }, icon('pin', 17)), h('span', { style: { minWidth: 0 } }, pillTag, pillName), h('span', { style: { color: 'var(--ink-3)', marginLeft: 'auto' } }, icon('down', 16)));
  body = h('div', { class: 'pbody' });
  root.append(
    h('div', { class: 'phead', id: 'phead' }, pill, iconBtn('bookmark', 'My routes', openLibrary), iconBtn('gear', 'Settings', openSettings)),
    body,
  );
  find = buildFind();
  body.append(find);
  mountSheet(root);
  const paintPill = () => {
    pillName.textContent = state.startName;
    pillTag.textContent = isHome() ? 'Home' : 'Starting from';
  };
  bus.addEventListener('start', paintPill);
  paintPill();
}

/** Show an element in the panel body, or the find screen when null. */
export function showView(el) {
  const next = el || find;
  document.getElementById('phead').hidden = !!el && el !== find;
  body.replaceChildren(next);
  body.scrollTop = 0;
  if (next === find) find.refresh();
}

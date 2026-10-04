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

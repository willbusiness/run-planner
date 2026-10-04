// Tiny DOM helpers + icons. No framework: build elements, keep a few references, update in place.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
}

const P = {
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  loop: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  outback: '<path d="M4 12h16"/><path d="M15 7l5 5-5 5"/><path d="M4 7v10"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>',
  download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 16V5"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  flip: '<path d="M7 7h12l-3-3"/><path d="M17 17H5l3 3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5"/>',
  shuffle: '<path d="M16 4h4v4"/><path d="M20 4L4 20"/><path d="M20 16v4h-4"/><path d="M15 15l5 5"/><path d="M4 4l5 5"/>',
  mountain: '<path d="M3 20l6-11 4 6 2-3 6 8z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  trail: '<path d="M4 20c3-1 4-4 6-6s5-1 6-4 2-4 4-6"/><path d="M4 20h.01M20 4h.01"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  free: '<path d="M4 17c3-9 6 3 9-5s4-3 7-7"/>',
  snap: '<path d="M4 18l5-9 5 6 6-11"/>',
  trash2: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z"/>',
};
export function icon(name, size = 20) {
  const el = document.createElement('span');
  el.className = 'ico';
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  return el;
}

export function iconBtn(name, title, onclick, cls = '') {
  return h('button', { class: 'ibtn ' + cls, title, 'aria-label': title, onclick, type: 'button' }, icon(name));
}

/** Segmented control. options: [[value, label, iconName?]]. Returns the element; el.set(value) updates it. */
export function seg(options, value, onchange, cls = '') {
  const btns = options.map(([v, label, ic]) =>
    h('button', { type: 'button', class: 'seg-btn', 'data-v': v, onclick: () => { set(v); onchange(v); } }, ic ? icon(ic, 16) : null, label),
  );
  const el = h('div', { class: 'seg ' + cls, role: 'group' }, btns);
  function set(v) {
    value = v;
    btns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  }
  set(value);
  el.set = set;
  return el;
}

export function toggle(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', onchange: () => onchange(input.checked) });
  input.checked = checked;
  return h('label', { class: 'toggle' }, h('span', null, label), input, h('i'));
}

let toastTimer;
export function toast(msg, ms = 3200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Keep `parent`'s children in sync with `items` (keyed), reusing elements so nothing flickers. */
export function syncList(parent, items, key, create, update) {
  const existing = new Map([...parent.children].map((c) => [c.dataset.key, c]));
  const want = new Set(items.map(key));
  for (const [k, el] of existing) if (!want.has(k)) { el.remove(); existing.delete(k); }
  items.forEach((it, i) => {
    const k = key(it);
    let el = existing.get(k);
    if (!el) {
      el = create(it);
      el.dataset.key = k;
      el.classList.add('enter');
      el.style.setProperty('--i', Math.min(i, 8));
    }
    update?.(el, it);
    if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null);
  });
}

/** Small floating menu at a screen position. items: [{label, icon?, onclick, danger?} | {heading}]. */
export function showMenu(x, y, items) {
  closeMenu();
  const el = h('div', { class: 'pop', id: 'menu' }, items.map((it) =>
    it.heading ? h('h4', null, it.heading) : h('button', { class: 'row' + (it.danger ? ' danger' : ''), type: 'button', onclick: () => { closeMenu(); it.onclick(); } }, it.icon ? icon(it.icon, 18) : null, it.label),
  ));
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x)) + 'px';
  el.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, y)) + 'px';
  setTimeout(() => {
    const off = (e) => { if (!el.contains(e.target)) closeMenu(); };
    document.addEventListener('pointerdown', off, { once: true, capture: true });
  });
  return el;
}
export function closeMenu() {
  document.getElementById('menu')?.remove();
}

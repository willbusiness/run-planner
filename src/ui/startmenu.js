// The start-point menu: Home, my location, or search any place.
import { h, icon, toast } from './dom.js';
import { settings } from '../settings.js';
import { state, setStart, isHome } from '../app.js';

let open;

export function closeStartMenu() {
  open?.remove();
  open = null;
}

async function search(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=au&viewbox=150.6,-33.5,151.5,-34.2&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Search is unavailable right now.');
  return (await res.json()).map((r) => ({ name: r.name || r.display_name.split(',')[0], sub: r.display_name.split(',').slice(1, 3).join(',').trim(), ll: [+r.lat, +r.lon] }));
}

export function openStartMenu(anchor, { asHome = false } = {}) {
  if (open) return closeStartMenu();
  const results = h('div', { class: 'results-list' });
  let timer;
  const input = h('input', {
    class: 'input', placeholder: 'Search a park, suburb or street…', autocomplete: 'off',
    oninput: () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) return results.replaceChildren();
      timer = setTimeout(async () => {
        try {
          const list = await search(q);
          results.replaceChildren(...(list.length ? list.map((r) => h('button', { type: 'button', onclick: () => pick(r.ll, r.name) }, r.name, h('small', null, r.sub))) : [h('small', { style: { padding: '8px 12px', color: 'var(--ink-3)' } }, 'No places found')]));
        } catch (e) {
          results.replaceChildren(h('small', { style: { padding: '8px 12px' } }, e.message));
        }
      }, 350);
    },
  });

  const pick = (ll, name) => { closeStartMenu(); setStart(ll, name, { fly: true, home: asHome }); if (asHome) toast('Saved as Home'); };
  const rows = [];
  if (settings.home && !asHome) rows.push(h('button', { class: 'row', type: 'button', onclick: () => pick([settings.home.lat, settings.home.lng], settings.home.name) }, icon('home', 18), h('span', null, 'Home', h('small', { style: { display: 'block', color: 'var(--ink-3)', fontWeight: 500 } }, settings.home.name))));
  rows.push(h('button', { class: 'row', type: 'button', onclick: () => {
    closeStartMenu();
    navigator.geolocation?.getCurrentPosition(
      (pos) => { setStart([pos.coords.latitude, pos.coords.longitude], asHome ? 'Home' : 'My location', { fly: true, home: asHome }); if (asHome) toast('Saved as Home'); },
      () => toast('Could not get your location. Check the browser permission.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  } }, icon('locate', 18), 'My location'));
  if (!isHome() && !asHome) rows.push(h('button', { class: 'row', type: 'button', onclick: () => { closeStartMenu(); setStart(state.start, state.startName === 'Dropped pin' ? 'My start' : state.startName, { home: true }); toast('Saved as Home'); } }, icon('home', 18), 'Save this start as Home'));

  const r = anchor.getBoundingClientRect();
  open = h('div', { class: 'pop', style: { left: Math.max(8, Math.min(r.left, innerWidth - 328)) + 'px', top: r.bottom + 8 + 'px', width: Math.max(r.width, 320) + 'px' } },
    h('h4', null, asHome ? 'Where do you usually start your runs?' : 'Start your run from'), ...rows, h('div', { style: { padding: '6px 4px 2px' } }, input), results);
  document.body.append(open);
  input.focus();
  setTimeout(() => document.addEventListener('pointerdown', (e) => { if (open && !open.contains(e.target) && !anchor.contains(e.target)) closeStartMenu(); }, { once: true, capture: true }));
}

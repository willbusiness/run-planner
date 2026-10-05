// Settings dialog: home start, pace, units, appearance, optional OpenRouteService key, data.
import { h, iconBtn, seg, toast } from './dom.js';
import { settings, save, fmtPace, parsePace } from '../settings.js';
import { applyTheme } from '../theme.js';
import { bank } from '../bank.js';
import { bus, state, setStart, isHome } from '../app.js';
import * as routing from '../routing.js';
import { route as orsRoute, quota } from '../ors.js';

export function openSettings() {
  let dlg = document.getElementById('settings');
  if (!dlg) {
    dlg = h('dialog', { id: 'settings' });
    dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
    document.body.append(dlg);
  }
  const pace = h('input', { class: 'input', value: fmtPace(settings.pace).replace(/\/.*/, ''), inputmode: 'numeric', 'aria-label': 'Goal pace', style: { width: '120px' }, onchange: () => {
    const v = parsePace(pace.value);
    if (v && v >= 120 && v <= 900) { settings.pace = v; save(); bus.dispatchEvent(new Event('results')); } else pace.value = fmtPace(settings.pace).replace(/\/.*/, '');
  } });
  const key = h('input', { class: 'input', type: 'password', placeholder: 'Paste your free key (optional)', value: settings.orsKey, autocomplete: 'off', onchange: () => { settings.orsKey = key.value.trim(); save(); window.dispatchEvent(new Event('keychange')); toast(settings.orsKey ? 'Key saved on this device' : 'Key removed'); } });
  const test = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    settings.orsKey = key.value.trim();
    save();
    window.dispatchEvent(new Event('keychange'));
    if (!settings.orsKey) return toast('Paste a key first');
    test.disabled = true;
    try {
      await orsRoute([[-33.8066, 151.2471], [-33.8056, 151.2461]], { surface: 'mixed', avoidStairs: true });
      toast('Key works. ' + (quota() ? `${quota().remaining} of ${quota().limit} requests left today.` : ''));
    } catch (e) {
      toast(e.message, 6000);
    }
    test.disabled = false;
  } }, 'Test key');

  dlg.replaceChildren(
    h('div', { class: 'dhead' }, h('h2', null, 'Settings'), iconBtn('x', 'Close', () => dlg.close())),
    h('div', { class: 'dbody' },
      h('div', { class: 'group' }, h('h3', null, 'Home'),
        h('div', { class: 'row2' },
          h('span', { style: { flex: 1, fontWeight: 600 } }, settings.home ? settings.home.name : 'Not set yet'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { setStart(state.start, isHome() ? settings.home.name : state.startName === 'Dropped pin' ? 'My start' : state.startName, { home: true }); toast('Saved as Home'); dlg.close(); } }, 'Use current start')),
        h('p', null, 'Routes are generated from your start and saved on this device, so they appear instantly next time.')),
      h('div', { class: 'group' }, h('h3', null, 'Goal pace'),
        h('div', { class: 'row2' }, pace, h('span', { style: { color: 'var(--ink-2)' } }, 'per ' + settings.units)),
        h('p', null, 'Used for time estimates. Hills slow the estimate down and descents speed it up.')),
      h('div', { class: 'group' }, h('h3', null, 'Units'),
        seg([['km', 'Kilometres'], ['mi', 'Miles']], settings.units, (v) => { settings.units = v; save(); bus.dispatchEvent(new Event('units')); bus.dispatchEvent(new Event('results')); location.reload(); })),
      h('div', { class: 'group' }, h('h3', null, 'Appearance'),
        seg([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], settings.theme, (v) => { settings.theme = v; save(); applyTheme(); })),
      h('div', { class: 'group' }, h('h3', null, 'OpenRouteService key (optional)'),
        h('div', { class: 'row2' }, h('div', { style: { flex: 1, minWidth: '180px' } }, key), test),
        h('p', null, 'Routing works without it. A free key from openrouteservice.org adds park and quiet-street preferences when you edit a route (it has a small daily quota, so background route-finding never uses it). It stays in this browser.'),
        ...(quota() ? [h('p', { style: { fontWeight: 600, color: 'var(--ink)' } }, `${quota().remaining} of ${quota().limit} requests left today`)] : [])),
      h('div', { class: 'group' }, h('h3', null, 'Data'),
        h('div', { class: 'row2' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => { bank.clear(); toast('Making fresh routes…'); dlg.close(); } }, 'Rebuild suggestions')),
        h('p', null, `${bank.items.length} suggestions stored for this start. Saved routes are in My routes.`)),
    ),
  );
  dlg.showModal();
}

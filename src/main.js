// App wiring: tabs, bottom sheet, layers popover, settings dialog, startup.
import './style.css';
import { map, L, setBasemap, BASEMAP_LABELS, isMobile, fitTo } from './map.js';
import { settings, save, bus, emit, fmtPace, parsePace } from './settings.js';
import { h, icon, toast, toggle } from './ui.js';
import { initOverlays, layerToggled, setOverlayMode, overlayEvents, zoomHint, onOvalAction } from './overlays.js';
import { route, planLayer, buildPlanPanel, addOvalLaps } from './plan.js';
import { initExplore, activateExplore, deactivateExplore, firstSearch } from './explore.js';
import { initSaved, activateSaved, deactivateSaved } from './saved.js';
import { parseShareHash } from './storage.js';
import * as ors from './ors.js';
import { bounds } from './geo.js';

const $ = (id) => document.getElementById(id);
const views = { explore: $('view-explore'), plan: $('view-plan'), saved: $('view-saved') };
const TAB_KEY = 'runplanner.tab';

// ---- topbar buttons ----
$('btn-locate').append(icon('locate', 20));
$('btn-layers').append(icon('layers', 20));
$('btn-settings').append(icon('sliders', 20));

// ---- panels ----
initExplore(views.explore);
const planPanel = buildPlanPanel(views.plan);
initSaved(views.saved);
initOverlays();
setBasemap(settings.basemap);

// ---- tabs ----
let tab = null;
let explored = false;
const layers = {
  explore: [activateExplore, deactivateExplore],
  plan: [() => planLayer.activate(), () => planLayer.deactivate()],
  saved: [activateSaved, deactivateSaved],
};
const SHEET_DEFAULT = { explore: 'half', plan: 'peek', saved: 'half' };

function switchTab(name) {
  if (name === tab) return;
  if (tab) layers[tab][1]();
  tab = name;
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  setOverlayMode(name);
  layers[name][0]();
  if (name === 'plan') planPanel.draw();
  if (name === 'explore' && !explored) { explored = true; firstSearch(); }
  setSheet(SHEET_DEFAULT[name]);
  $('panel-body').scrollTop = 0;
  try { localStorage.setItem(TAB_KEY, name); } catch { /* ignore */ }
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
bus.addEventListener('tab', (e) => switchTab(e.detail));

// ---- bottom sheet (phone) ----
let sheetState = 'half';
const sheetPx = (s) => (s === 'peek' ? 172 : s === 'half' ? Math.round(window.innerHeight * 0.46) : window.innerHeight - 76);
function setSheet(s, animate = true) {
  sheetState = s;
  const p = $('panel');
  p.classList.toggle('dragging', !animate);
  p.style.setProperty('--sheet-h', sheetPx(s) + 'px');
}
bus.addEventListener('sheet', (e) => {
  const order = ['peek', 'half', 'full'];
  if (isMobile() && order.indexOf(e.detail) > order.indexOf(sheetState)) setSheet(e.detail);
});
window.addEventListener('resize', () => setSheet(sheetState));
(function wireGrab() {
  const grab = $('grab');
  const panel = $('panel');
  let startY, startH, moved;
  grab.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
    moved = false;
    grab.setPointerCapture(e.pointerId);
    panel.classList.add('dragging');
  });
  grab.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 4) moved = true;
    const hgt = Math.min(sheetPx('full'), Math.max(sheetPx('peek') - 40, startH + dy));
    panel.style.setProperty('--sheet-h', hgt + 'px');
  });
  const end = (e) => {
    if (startY == null) return;
    const hgt = panel.getBoundingClientRect().height;
    startY = null;
    if (!moved) {
      const order = ['peek', 'half', 'full'];
      return setSheet(order[(order.indexOf(sheetState) + 1) % 3]);
    }
    const states = ['peek', 'half', 'full'];
    setSheet(states.reduce((best, s) => (Math.abs(sheetPx(s) - hgt) < Math.abs(sheetPx(best) - hgt) ? s : best), 'half'));
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
})();

// ---- locate ----
let here;
$('btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Location is not available in this browser.');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      here?.remove();
      here = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1f77ff', fillOpacity: 1, pane: 'handles', interactive: false }).addTo(map);
      map.setView(ll, Math.max(map.getZoom(), 15));
    },
    () => toast('Could not get your location. Check the browser permission.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ---- layers popover ----
const pop = $('layers-pop');
function buildLayers() {
  const hints = () => zoomHint();
  const status = h('div', { class: 'muted small', id: 'layer-status' });
  const refreshStatus = () => { status.textContent = hints().join(' · '); };
  const mk = (key, label) => toggle(label, settings.layers[key], (v) => { settings.layers[key] = v; save(); layerToggled(key); refreshStatus(); });
  pop.replaceChildren(
    h('div', { class: 'pop-title' }, 'Map'),
    ...Object.entries(BASEMAP_LABELS).map(([k, l]) =>
      h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'basemap', checked: settings.basemap === k, onchange: () => setBasemap(k) }), h('span', null, l))),
    h('div', { class: 'pop-title' }, 'Overlays'),
    mk('trails', 'Trails & paths (tap for info)'),
    mk('routes', 'Named running/walking routes'),
    mk('ovals', 'Ovals & running tracks'),
    mk('water', 'Drinking water & toilets'),
    status,
  );
  refreshStatus();
}
$('btn-layers').addEventListener('click', () => {
  pop.hidden = !pop.hidden;
  if (!pop.hidden) buildLayers();
});
map.on('click movestart', () => { pop.hidden = true; });
overlayEvents.addEventListener('status', (e) => {
  const d = e.detail;
  if (d.error) toast(d.error, 4500);
});

// ---- settings dialog ----
const dlg = $('settings');
function openSettings() {
  const key = h('input', { type: 'password', class: 'text', id: 'key', placeholder: 'Paste your OpenRouteService key', value: settings.orsKey, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const showKey = h('button', { type: 'button', class: 'btn small', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } }, 'Show');
  const keyMsg = h('div', { class: 'muted small' }, '');
  const pace = h('input', { type: 'text', class: 'text', inputmode: 'numeric', placeholder: 'm:ss', value: fmtPace(settings.pace).split('/')[0], style: 'width:90px' });
  const u = ors.usage();
  const saveAll = () => {
    const k = key.value.trim();
    const changed = k !== settings.orsKey;
    settings.orsKey = k;
    const p = parsePace(pace.value);
    if (p) settings.pace = p;
    save();
    if (changed) window.dispatchEvent(new Event('keychanged'));
    emit('settings-changed');
  };
  dlg.replaceChildren(
    h('div', { class: 'dlg' },
      h('div', { class: 'dlg-head' }, h('strong', null, 'Settings'), h('button', { class: 'ibtn', onclick: () => dlg.close(), 'aria-label': 'Close' }, icon('x', 18))),
      h('div', { class: 'pref' },
        h('label', { for: 'key' }, 'OpenRouteService key'),
        h('div', { class: 'row' }, key, showKey),
        h('p', { class: 'muted small' }, 'Free at ', h('a', { href: 'https://openrouteservice.org/dev/#/signup', target: '_blank', rel: 'noopener' }, 'openrouteservice.org'), '. Create a token and paste it here. It is stored only in this browser. Free tier: 2,000 routes/day.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: async () => {
            settings.orsKey = key.value.trim(); keyMsg.textContent = 'Testing…';
            try { await ors.route([[-33.8688, 151.2093], [-33.8715, 151.2111]], settings.prefs); keyMsg.textContent = 'Key works.'; keyMsg.className = 'ok small'; save(); } catch (e) { keyMsg.textContent = e.message; keyMsg.className = 'warn small'; }
          } }, 'Test key'),
          h('span', { class: 'muted small' }, `Used today: ${u.used}/${u.limit}`)),
        keyMsg,
      ),
      h('div', { class: 'pref' }, h('label', null, 'Goal pace (min per ' + settings.units + ')'), pace, h('p', { class: 'muted small' }, 'Used for estimated times. Hills adjust it automatically.')),
      h('div', { class: 'pref' }, h('label', null, 'Units'),
        h('select', { class: 'text', style: 'width:120px', onchange: (e) => { const old = settings.units; settings.units = e.target.value; save(); pace.value = fmtPace(settings.pace).split('/')[0]; emit('settings-changed'); } },
          h('option', { value: 'km', selected: settings.units === 'km' }, 'Kilometres'), h('option', { value: 'mi', selected: settings.units === 'mi' }, 'Miles'))),
      h('details', null, h('summary', null, 'About & credits'),
        h('p', { class: 'small muted' }, 'Map data © OpenStreetMap contributors. Routing by OpenRouteService. Elevation from Open-Meteo / SRTM-based models; climb figures are approximate (±10%). Terrain tiles © OpenTopoMap. Light/dark tiles © CARTO.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { saveAll(); dlg.close(); } }, 'Done')),
    ),
  );
  dlg.addEventListener('close', saveAll, { once: true });
  dlg.showModal();
}
$('btn-settings').addEventListener('click', openSettings);
bus.addEventListener('settings', openSettings);
bus.addEventListener('settings-changed', () => { route.changed(); });

// ---- oval helper ----
onOvalAction.fn = (oval) => {
  switchTab('plan');
  addOvalLaps(oval);
};

// ---- startup ----
const shared = parseShareHash(location.hash);
if (shared) {
  route.waypoints = shared.wps;
  route.legs = shared.modes.map((m) => route.pendingLeg(m));
  switchTab('plan');
  route.refresh();
  fitTo(bounds(shared.wps));
} else {
  let t = 'explore';
  try { t = localStorage.getItem(TAB_KEY) || 'explore'; } catch { /* ignore */ }
  switchTab(views[t] ? t : 'explore');
}
if (!settings.orsKey) setTimeout(() => !dlg.open && tab !== 'plan' && toast('Add your free OpenRouteService key in Settings to generate routes.', 6000), 1500);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
}

if (import.meta.env.DEV) window.__rp = { route, map, settings };

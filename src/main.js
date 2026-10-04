import '@fontsource-variable/inter';
import './style.css';
import { createMap, setTrailsVisible, map } from './map/view.js';
import { settings } from './settings.js';
import { applyTheme, isDark } from './theme.js';
import { init, state, bus, select } from './app.js';
import { mountPanel } from './ui/panel.js';
import { mountMapControls } from './ui/mapctl.js';
import { openEditor, closeEditor, editing, undoRoute, redoRoute, currentRoute } from './ui/editor.js';
import { routeFromRecord } from './recroute.js';
import { Route } from './route.js';
import { parseShareHash } from './storage.js';
import { fitCoords } from './map/routes.js';
import { bank } from './bank.js';

const VIEW_KEY = 'runplanner.view.v1';
const home = settings.home || { lat: -33.8975, lng: 151.2335 };
let view;
try { view = JSON.parse(localStorage.getItem(VIEW_KEY)); } catch { /* first run */ }

createMap(document.getElementById('map'), {
  center: view?.c || [home.lat, home.lng],
  zoom: view?.z || 13.5,
  dark: isDark(),
});
document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
map.on('moveend', () => {
  const c = map.getCenter();
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() })); } catch { /* ignore */ }
});

mountPanel(document.getElementById('panel'));
mountMapControls(document.getElementById('mapctl'));

map.on('load', async () => {
  setTrailsVisible(settings.trails);
  await init();
  const shared = parseShareHash(location.hash);
  if (shared) {
    const r = new Route();
    r.waypoints = shared.wps;
    r.legs = shared.modes.map((m) => r.pendingLeg(m));
    r.refresh();
    openEditor(r, { fit: false });
    fitCoords(shared.wps);
  }
});

// ---- keyboard ----
addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (document.querySelector('dialog[open]')) return;
  if (editing()) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redoRoute() : undoRoute(); }
    else if (e.key === 'Escape' && !typing) closeEditor(true);
    return;
  }
  if (typing || state.mode !== 'find') return;
  const i = state.results.findIndex((r) => r.id === state.selectedId);
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); const n = state.results[Math.min(state.results.length - 1, i + 1)]; n && select(n.id); }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); const n = state.results[Math.max(0, i - 1)]; n && select(n.id); }
  if (e.key === 'e' && state.selectedId) { const r = state.results[i]; r && openEditor(routeFromRecord(r, '')); }
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {}));
}
if (import.meta.env.DEV) window.__rp = { state, bank, map, bus, currentRoute };

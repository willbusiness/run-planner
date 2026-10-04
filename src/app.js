// App controller: the start point, the brief, the list of suggestions and which one is selected.
// UI modules listen to `bus` events; the map is updated from here.
import { bank } from './bank.js';
import { settings, save } from './settings.js';
import { map, revealSelected, mapTouched, resetTouched } from './map/view.js';
import { drawResults, clearResults, fitCoords, setStartMarker, wireMapPicking, onRouteClick, onRouteHover } from './map/routes.js';

export const DEFAULT_HOME = { lat: -33.8975, lng: 151.2335, name: 'Centennial Park' };

export const state = {
  mode: 'find', // 'find' | 'edit' | 'library'
  start: [DEFAULT_HOME.lat, DEFAULT_HOME.lng],
  startName: DEFAULT_HOME.name,
  results: [],
  selectedId: null,
  hoverId: null,
  userPicked: false, // true once the runner chose a route themselves
};

export const bus = new EventTarget();
const emit = (name) => bus.dispatchEvent(new Event(name));

export const isHome = () => !!settings.home && Math.abs(settings.home.lat - state.start[0]) < 1e-4 && Math.abs(settings.home.lng - state.start[1]) < 1e-4;
export const selected = () => state.results.find((r) => r.id === state.selectedId) || null;

let briefTimer;
let wantFit = false;

export async function init() {
  const home = settings.home || DEFAULT_HOME;
  state.start = [home.lat, home.lng];
  state.startName = home.name;
  setStartMarker(state.start, { onDrag: (ll) => setStart(ll, 'Dropped pin') });
  wireMapPicking();
  onRouteClick((id) => select(id));
  onRouteHover((id) => hover(id));
  bank.addEventListener('change', () => {
    if (state.mode !== 'find') return;
    cancelAnimationFrame(init.raf);
    init.raf = requestAnimationFrame(() => refresh());
    emit('bank');
  });
  wantFit = true;
  await bank.open(state.start, settings.prefs.surface);
  bank.request(settings.prefs);
  refresh();
}

/** Move the start (and optionally remember it as Home). Starts a fresh set of suggestions. */
export function setStart(ll, name, { home = false, fly = false } = {}) {
  state.start = ll;
  state.startName = name || 'Dropped pin';
  if (home) {
    settings.home = { lat: ll[0], lng: ll[1], name: state.startName };
    save();
  }
  setStartMarker(ll, { onDrag: (p) => setStart(p, 'Dropped pin') });
  state.selectedId = null;
  state.userPicked = false;
  resetTouched();
  wantFit = true;
  emit('start');
  briefChanged({ immediate: true });
  if (fly) map.flyTo({ center: [ll[1], ll[0]], zoom: 13.5, duration: 900 });
}

/** The distance / shape / surface / hills changed. Debounced so dragging the slider stays smooth. */
export function briefChanged({ immediate = false } = {}) {
  save();
  clearTimeout(briefTimer);
  const go = async () => {
    await bank.open(state.start, settings.prefs.surface);
    bank.request(settings.prefs);
    wantFit = true;
    state.selectedId = null; // pick the best of the new set
    state.userPicked = false;
    resetTouched();
    refresh();
  };
  if (immediate) go();
  else briefTimer = setTimeout(go, 220);
}

export function refresh() {
  if (state.mode !== 'find') return;
  const prev = state.selectedId;
  state.results = bank.query(settings.prefs);
  const first = state.results[0]?.id || null;
  // until the runner picks one, the best match stays selected as better ones stream in
  if (!state.userPicked || !state.results.some((r) => r.id === state.selectedId)) state.selectedId = first;
  draw();
  if (state.selectedId && (wantFit || (prev !== state.selectedId && !mapTouched()))) {
    wantFit = false;
    fitCoords(selected().c);
    revealSelected(900);
  }
  emit('results');
}

function draw() {
  if (state.mode !== 'find') return;
  drawResults(state.results.map((r) => ({ id: r.id, coords: r.c })), state.selectedId, state.hoverId);
}

export function select(id, { fit = true, user = true } = {}) {
  state.userPicked = user;
  if (state.selectedId === id) return emit('select');
  state.selectedId = id;
  draw();
  revealSelected();
  const r = selected();
  if (r && fit) fitCoords(r.c, { duration: 650 });
  emit('select');
}

export function hover(id) {
  if (state.hoverId === id) return;
  state.hoverId = id;
  draw();
  emit('hover');
}

export function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle('editing', mode === 'edit');
  if (mode === 'find') {
    state.hoverId = null;
    refresh();
  } else {
    clearResults();
  }
  emit('mode');
}

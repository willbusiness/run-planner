// App settings + routing preferences, persisted in localStorage.
const KEY = 'runplanner.settings.v1';

const defaults = {
  orsKey: '',
  pace: 330, // goal pace, seconds per km
  units: 'km', // 'km' | 'mi'
  theme: 'auto', // 'auto' | 'light' | 'dark'
  home: null, // {lat, lng, name} once the user sets it
  trails: false, // emphasise running paths on the map
  prefs: {
    km: 12, // target distance
    surface: 'mixed', // 'road' | 'mixed' | 'trail'
    shape: 'loop', // 'loop' | 'out&back'
    hills: 'any', // 'any' | 'flat' | 'hilly'
    quiet: false, // avoid busy roads (OpenRouteService only)
    green: false, // prefer parks (OpenRouteService only)
    avoidStairs: true,
  },
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved.v !== 3) { delete saved.prefs; delete saved.basemap; delete saved.layers; }
    return { v: 3, ...defaults, ...saved, prefs: { ...defaults.prefs, ...saved.prefs } };
  } catch {
    return structuredClone(defaults);
  }
}

export const settings = load();
export const bus = window;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode etc. */
  }
}

export function emit(name, detail) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

// ---- formatting helpers shared by the UI ----
export const KM_PER_MI = 1.609344;

export function fmtDist(m) {
  if (settings.units === 'mi') return (m / 1000 / KM_PER_MI).toFixed(2) + ' mi';
  return (m / 1000).toFixed(2) + ' km';
}

export function fmtDistShort(m) {
  const v = settings.units === 'mi' ? m / 1000 / KM_PER_MI : m / 1000;
  return v.toFixed(v >= 10 ? 1 : 2) + (settings.units === 'mi' ? ' mi' : ' km');
}

export function fmtElev(m) {
  return Math.round(m) + ' m';
}

export function fmtTime(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtPace(secPerKm) {
  const v = settings.units === 'mi' ? secPerKm * KM_PER_MI : secPerKm;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}:${String(s).padStart(2, '0')}/${settings.units}`;
}

export function parsePace(text) {
  const m = /^(\d+):([0-5]?\d)$/.exec(text.trim());
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return settings.units === 'mi' ? v / KM_PER_MI : v;
}

// Saved routes (localStorage), JSON backup/restore, and shareable links.
const KEY = 'runplanner.routes.v1';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    alert('Could not save: browser storage is full or blocked.');
    return false;
  }
}

export const listRoutes = () => read().sort((a, b) => b.savedAt - a.savedAt);
export const getRoute = (id) => read().find((r) => r.id === id);

/** Save (or overwrite when `id` is given). `route` is a Route, `sum` its summary. */
export function saveRoute(route, sum, id = route.savedId) {
  const list = read();
  const rec = {
    id: id || 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    savedAt: Date.now(),
    name: route.name || `Run ${new Date().toLocaleDateString()}`,
    tag: route.tag || '',
    dist: sum.dist,
    gain: sum.gain,
    data: route.toJSON(),
  };
  const i = list.findIndex((r) => r.id === rec.id);
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  return write(list) ? rec.id : null;
}

export function deleteRoute(id) {
  write(read().filter((r) => r.id !== id));
}

export function updateMeta(id, patch) {
  const list = read();
  const r = list.find((x) => x.id === id);
  if (!r) return;
  Object.assign(r, patch);
  if (patch.name != null) r.data.name = patch.name;
  if (patch.tag != null) r.data.tag = patch.tag;
  write(list);
}

export const exportAll = () => JSON.stringify({ app: 'run-planner', version: 1, routes: read() });

/** Merge routes from a backup file. Returns how many were added. */
export function importAll(text) {
  const j = JSON.parse(text);
  if (j.app !== 'run-planner' || !Array.isArray(j.routes)) throw new Error('Not a Run Planner backup file.');
  const list = read();
  let added = 0;
  for (const r of j.routes) {
    if (!list.some((x) => x.id === r.id)) { list.push(r); added++; }
  }
  write(list);
  return added;
}

// ---- share links: waypoints + leg modes only; the receiving device re-routes ----
export function shareHash(route) {
  const w = route.waypoints.map((p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join('~');
  const m = route.legs.map((l) => (l.mode === 'free' ? 'f' : 's')).join('');
  return `#p=${w}&m=${m}`;
}

export function parseShareHash(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const w = p.get('p');
  if (!w) return null;
  const wps = w.split('~').map((s) => s.split(',').map(Number));
  if (wps.some((q) => q.length !== 2 || q.some(Number.isNaN))) return null;
  const modes = (p.get('m') || '').split('').map((c) => (c === 'f' ? 'free' : 'snap'));
  while (modes.length < wps.length - 1) modes.push('snap');
  return { wps, modes: modes.slice(0, Math.max(0, wps.length - 1)) };
}

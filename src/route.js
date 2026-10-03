// The route being edited in Plan mode: waypoints, one leg between each pair, undo/redo.
// A leg is either 'snap' (routed along paths by ORS) or 'free' (straight line, for ovals/grass/parks).
import * as ors from './ors.js';
import { withElevation } from './elevation.js';
import { summarize, emptySurf, addSurf } from './stats.js';
import { settings } from './settings.js';

const fmt = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
const legKey = (mode, a, b) => `${mode}|${fmt(a)}|${fmt(b)}`;
const cache = new Map(); // legKey|prefsKey -> {coords, surf}

/** Fill missing elevations by carrying neighbours across (only matters if a lookup failed). */
function fillElevation(coords) {
  let last = coords.find((c) => c[2] != null)?.[2] ?? 0;
  return coords.map((c) => {
    if (c[2] != null) last = c[2];
    return [c[0], c[1], c[2] ?? last];
  });
}

export class Route extends EventTarget {
  constructor() {
    super();
    this.waypoints = []; // [lat,lng]
    this.legs = []; // legs[i]: wp i -> wp i+1
    this.name = '';
    this.tag = '';
    this.savedId = null;
    this.undoStack = [];
    this.redoStack = [];
  }

  // ---- change notification ----
  changed() {
    this.dispatchEvent(new Event('change'));
  }
  fail(message) {
    this.dispatchEvent(new CustomEvent('error', { detail: message }));
  }

  // ---- history ----
  snapshot() {
    return { wps: this.waypoints.map((p) => [...p]), modes: this.legs.map((l) => l.mode) };
  }
  push() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  restore(s) {
    this.waypoints = s.wps.map((p) => [...p]);
    this.legs = s.modes.map((mode) => ({ mode, status: 'pending', key: '', coords: [], surf: emptySurf() }));
    this.refresh();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // ---- edits ----
  addWaypoint(ll, mode = 'snap') {
    this.push();
    if (this.waypoints.length) this.legs.push(this.pendingLeg(mode));
    this.waypoints.push(ll);
    this.refresh();
  }
  insertWaypoint(i, ll, { refresh = true, mode } = {}) {
    // inserting at i splits leg i-1 into two; both inherit its mode
    this.push();
    const m = mode || this.legs[i - 1]?.mode || 'snap';
    this.waypoints.splice(i, 0, ll);
    this.legs.splice(i - 1, 1, this.pendingLeg(m), this.pendingLeg(m));
    if (refresh) this.refresh();
    else this.changed();
  }
  moveWaypoint(i, ll) {
    this.waypoints[i] = ll;
    this.refresh();
  }
  removeWaypoint(i) {
    this.push();
    const n = this.waypoints.length;
    this.waypoints.splice(i, 1);
    if (n <= 1) this.legs = [];
    else if (i === 0) this.legs.shift();
    else if (i === n - 1) this.legs.pop();
    else this.legs.splice(i - 1, 2, this.pendingLeg(this.legs[i - 1].mode));
    this.refresh();
  }
  setLegMode(i, mode) {
    if (!this.legs[i] || this.legs[i].mode === mode) return;
    this.push();
    this.legs[i] = this.pendingLeg(mode);
    this.refresh();
  }
  clear() {
    if (!this.waypoints.length) return;
    this.push();
    this.waypoints = [];
    this.legs = [];
    this.name = '';
    this.savedId = null;
    this.changed();
  }
  reverse() {
    if (this.waypoints.length < 2) return;
    this.push();
    this.waypoints.reverse();
    this.legs = this.legs.reverse().map((l) => ({ ...l, coords: [...l.coords].reverse(), key: '' }));
    this.refresh();
  }
  closeLoop(mode = 'snap') {
    if (this.waypoints.length < 2) return;
    this.push();
    this.legs.push(this.pendingLeg(mode));
    this.waypoints.push([...this.waypoints[0]]);
    this.refresh();
  }
  outAndBack() {
    const n = this.waypoints.length;
    if (n < 2) return;
    this.push();
    for (let i = n - 2; i >= 0; i--) {
      const src = this.legs[i];
      this.waypoints.push([...this.waypoints[i]]);
      this.legs.push(src.status === 'ok' ? { ...src, coords: [...src.coords].reverse(), key: '' } : this.pendingLeg(src.mode));
    }
    this.refresh();
  }

  // ---- loading routes from elsewhere ----
  /** Waypoints plus ready-made legs [{coords, surf, mode}] (no network needed). */
  load(waypoints, legs, { name = '', tag = '', savedId = null } = {}) {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.waypoints = waypoints.map((p) => [p[0], p[1]]);
    this.legs = legs.map((l) => ({ mode: l.mode || 'snap', status: 'ok', key: '', coords: l.coords, surf: l.surf || emptySurf() }));
    this.name = name;
    this.tag = tag;
    this.savedId = savedId;
    this.legs.forEach((l, i) => (l.key = legKey(l.mode, this.waypoints[i], this.waypoints[i + 1])));
    this.changed();
  }

  /** Arbitrary track (GPX, OSM route): drop a waypoint every ~`every` meters, legs are slices of the track. */
  loadTrack(coords, { name = '', every = 2000, surf } = {}) {
    const wps = [coords[0]];
    const legs = [];
    let from = 0;
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
      acc += Math.hypot((coords[i][0] - coords[i - 1][0]) * 111000, (coords[i][1] - coords[i - 1][1]) * 93000);
      if ((acc >= every && i < coords.length - 1) || i === coords.length - 1) {
        legs.push({ mode: 'snap', coords: coords.slice(from, i + 1), surf: i === coords.length - 1 ? surf : undefined });
        wps.push(coords[i]);
        from = i;
        acc = 0;
      }
    }
    this.load(wps, legs, { name });
  }

  // ---- computing legs ----
  pendingLeg(mode) {
    return { mode, status: 'pending', key: '', coords: [], surf: emptySurf() };
  }

  /** Recompute any leg whose endpoints changed. Cheap to call; cached legs resolve instantly. */
  refresh() {
    const prefs = { ...settings.prefs };
    const pk = ors.prefsKey(prefs);
    this.legs.forEach((leg, i) => {
      const a = this.waypoints[i];
      const b = this.waypoints[i + 1];
      const key = legKey(leg.mode, a, b);
      if (leg.key === key && leg.status !== 'error') return;
      leg.key = key;
      const hit = cache.get(key + '|' + (leg.mode === 'snap' ? pk : ''));
      if (hit) {
        Object.assign(leg, hit, { status: 'ok' });
        return;
      }
      leg.status = 'loading';
      leg.coords = [];
      this.compute(leg, key, a, b, prefs, pk);
    });
    this.changed();
  }

  /** Re-route every snapped leg with the current preferences. */
  rerouteAll() {
    this.legs.forEach((l) => {
      if (l.mode === 'snap') l.key = '';
    });
    // drop only prefs-dependent cache entries by changing nothing: keys include prefs, so new prefs miss naturally
    this.refresh();
  }

  async compute(leg, key, a, b, prefs, pk) {
    try {
      let result;
      if (leg.mode === 'free') {
        let coords = [a, b];
        try {
          coords = await withElevation([a, b]);
        } catch {
          this.fail('Elevation lookup failed for a free-draw leg; showing it flat.');
        }
        result = { coords, surf: { ...emptySurf(), dirt: 0, unknown: 0 } };
        result.surf.unknown = Math.hypot((b[0] - a[0]) * 111000, (b[1] - a[1]) * 93000);
      } else {
        const [r] = await ors.route([a, b], prefs);
        result = r;
      }
      if (!this.legs.includes(leg) || leg.key !== key) return; // superseded by a newer edit
      cache.set(key + '|' + (leg.mode === 'snap' ? pk : ''), result);
      Object.assign(leg, result, { status: 'ok' });
    } catch (e) {
      if (!this.legs.includes(leg) || leg.key !== key) return;
      leg.status = 'error';
      leg.error = e.message;
      this.fail(e.message);
    }
    this.changed();
  }

  // ---- derived data ----
  get pending() {
    return this.legs.some((l) => l.status === 'loading' || l.status === 'pending');
  }
  get hasError() {
    return this.legs.some((l) => l.status === 'error');
  }

  /** Full track of finished legs, joined end to end. */
  coords() {
    const out = [];
    for (const l of this.legs) {
      if (l.status !== 'ok') continue;
      out.push(...(out.length ? l.coords.slice(1) : l.coords));
    }
    return out;
  }

  summary() {
    const surf = emptySurf();
    this.legs.forEach((l) => l.status === 'ok' && addSurf(surf, l.surf));
    return summarize(fillElevation(this.coords()), surf);
  }

  // ---- persistence ----
  toJSON() {
    const r = (v, p) => Math.round(v * p) / p;
    return {
      name: this.name,
      tag: this.tag,
      wps: this.waypoints.map((p) => [r(p[0], 1e6), r(p[1], 1e6)]),
      legs: this.legs.map((l) => ({
        mode: l.mode,
        surf: l.surf,
        c: l.status === 'ok' ? l.coords.map((c) => [r(c[0], 1e5), r(c[1], 1e5), c[2] == null ? null : r(c[2], 10)]) : [],
      })),
    };
  }

  loadJSON(j, extra = {}) {
    this.load(
      j.wps,
      j.legs.map((l) => ({ mode: l.mode, surf: l.surf, coords: l.c })),
      { name: j.name, tag: j.tag, ...extra },
    );
    // any leg saved without geometry gets recomputed
    this.legs.forEach((l, i) => {
      if (!l.coords.length) { l.status = 'pending'; l.key = ''; }
    });
    this.refresh();
  }
}

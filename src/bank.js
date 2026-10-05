// The route bank: a growing, saved collection of generated routes for one start point.
// Opening the app shows bank routes instantly; the bank keeps topping itself up in the background,
// so changing distance/hills/surface is a filter, not a wait.
import { makeRoute } from './loops.js';
import { settings } from './settings.js';
import { densify } from './geo.js';
import { RouteError } from './routing.js';

// ---- tiny IndexedDB key/value store ----
let dbp;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('runplanner-v2', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
export async function kvGet(key) {
  try {
    const d = await db();
    return await new Promise((res) => {
      const r = d.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(undefined);
    });
  } catch {
    return undefined;
  }
}
export async function kvSet(key, value) {
  try {
    const d = await db();
    d.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
  } catch {
    /* private mode: the bank just won't persist */
  }
}

// distances (km) the background fill keeps covered
const LADDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 33, 36, 39, 42];
const PER_BIN = 2;
const MAX_ITEMS = 260;
const CONCURRENCY = 2;

const cellsCache = new WeakMap();
function cellsOf(r) {
  let s = cellsCache.get(r);
  if (!s) {
    s = new Set(densify(r.c, 40).map((p) => Math.round(p[0] / 0.0005) + ',' + Math.round(p[1] / 0.0006)));
    cellsCache.set(r, s);
  }
  return s;
}
export function overlapOf(a, b) {
  const A = cellsOf(a);
  const B = cellsOf(b);
  let hit = 0;
  for (const k of A) if (B.has(k)) hit++;
  return hit / Math.max(1, Math.min(A.size, B.size));
}

const keyFor = (start, surface) => `${start[0].toFixed(3)},${start[1].toFixed(3)}|${surface}`;

class Bank extends EventTarget {
  constructor() {
    super();
    this.items = [];
    this.key = '';
    this.start = null;
    this.surface = 'mixed';
    this.jobs = [];
    this.running = 0;
    this.runningUrgent = 0;
    this.pausedUntil = 0;
    this.error = '';
    this.tried = new Map(); // bin -> attempts this session
    this.saveTimer = 0;
    this.seed = Date.now() % 1e9;
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }

  get busy() {
    return this.running > 0 || this.jobs.length > 0;
  }

  /** Is the runner waiting on something specific (as opposed to quiet background top-ups)? */
  get waiting() {
    return this.runningUrgent > 0 || this.jobs.some((j) => j.urgent);
  }

  /** Point the bank at a start + surface. Loads what we saved earlier, then keeps filling. */
  async open(start, surface) {
    const key = keyFor(start, surface);
    if (key === this.key) return;
    this.key = key;
    this.start = start;
    this.surface = surface;
    this.jobs = [];
    this.items = [];
    this.emit();
    const saved = await kvGet(key);
    if (this.key !== key) return; // switched again while loading
    this.items = Array.isArray(saved) ? saved : [];
    if (!this.items.length) this.items = await this.loadSeed(key);
    if (this.key !== key) return;
    this.emit();
    this.fill();
  }

  /** Routes shipped with the app for a known start (see scripts/seed.mjs), so a new device starts with a full bank. */
  async loadSeed(key) {
    const [ll, surface] = key.split('|');
    const [lat, lng] = ll.split(',');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}seed/${lat}_${lng}_${surface}.json`);
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return [];
      const items = await res.json();
      kvSet(key, items);
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  }

  add(rec) {
    if (this.items.some((x) => x.kind === rec.kind && Math.abs(x.dist - rec.dist) < 250 && overlapOf(x, rec) > 0.75)) return;
    this.items.push(rec);
    if (this.items.length > MAX_ITEMS) this.items.shift();
    clearTimeout(this.saveTimer);
    const key = this.key;
    const snapshot = this.items;
    this.saveTimer = setTimeout(() => kvSet(key, snapshot), 800);
    this.emit();
  }

  clear() {
    this.items = [];
    this.jobs = [];
    this.tried.clear();
    kvSet(this.key, []);
    this.emit();
    this.fill();
  }

  // ---- asking for routes ----
  /** Routes that fit a brief, best first, no two nearly identical. */
  query(brief, limit = 8) {
    const T = brief.km * 1000;
    const tol = Math.max(400, T * 0.08);
    const fits = (wide) => this.items.filter((r) => r.kind === brief.shape && Math.abs(r.dist - T) <= tol * wide);
    let pool = fits(1);
    if (pool.length < 3) pool = fits(1.8);
    const hillOk = (r) => (brief.hills === 'flat' ? r.hills === 'flat' : brief.hills === 'hilly' ? r.hills !== 'flat' : true);
    const strict = pool.filter(hillOk);
    if (strict.length >= 3 || brief.hills === 'any') pool = strict.length ? strict : pool;

    const perKm = (r) => r.gain / Math.max(0.1, r.dist / 1000);
    const share = (r, k) => (r.kinds?.[k] || 0) / Math.max(1, r.dist);
    const score = (r) => {
      let s = 1 - Math.abs(r.dist - T) / (tol * 1.8);
      if (r.kind === 'loop') s += Math.min(1, r.q.compact / 0.5) * 0.5 - r.q.backtrack * 2 - Math.max(0, r.q.turns - 2) * 0.1;
      if (brief.hills === 'flat') s -= perKm(r) / 25;
      if (brief.hills === 'hilly') s += Math.min(1, perKm(r) / 20) * 0.6;
      if (brief.surface === 'trail') s += share(r, 'path') * 0.8;
      if (brief.surface === 'road') s -= share(r, 'path') * 0.2;
      if (brief.quiet) s -= share(r, 'main') * 1.5;
      return s;
    };
    const ranked = pool.map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
    const out = [];
    for (const { r } of ranked) {
      if (out.every((o) => overlapOf(o, r) < 0.5)) out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Make sure there are enough routes near this brief; queue the missing ones ahead of the background fill. */
  request(brief, want = 6) {
    const have = this.query(brief, want).length;
    const queued = this.jobs.filter((j) => j.kind === brief.shape && Math.abs(j.target - brief.km * 1000) < brief.km * 60 && j.hills === brief.hills).length;
    const need = Math.min(want, want + 2 - have) - queued;
    for (let i = 0; i < need; i++) this.jobs.unshift({ kind: brief.shape, target: brief.km * 1000, hills: brief.hills, key: this.key, urgent: true });
    this.pump();
  }

  /** Background: keep every distance on the ladder covered. */
  fill() {
    const jobs = [];
    for (const km of LADDER) {
      const have = this.items.filter((r) => r.kind === 'loop' && Math.abs(r.dist - km * 1000) < Math.max(400, km * 60)).length;
      const attempts = this.tried.get(km) || 0;
      for (let i = have; i < PER_BIN && attempts + (i - have) < 5; i++) jobs.push({ kind: 'loop', target: km * 1000, hills: 'any', key: this.key, bin: km });
    }
    // closest to the usual running distances first
    jobs.sort((a, b) => Math.abs(a.target - 12000) - Math.abs(b.target - 12000));
    this.jobs.push(...jobs.filter((j) => !this.jobs.some((q) => q.bin === j.bin && q.kind === j.kind)));
    this.pump();
  }

  // ---- the worker ----
  pump() {
    if (document.hidden || this.hold) return; // `hold` while editing: the runner's own requests come first
    if (Date.now() < this.pausedUntil) {
      clearTimeout(this.wake);
      this.wake = setTimeout(() => this.pump(), this.pausedUntil - Date.now() + 50);
      return;
    }
    while (this.running < CONCURRENCY && this.jobs.length) {
      const job = this.jobs.shift();
      if (job.key !== this.key) continue;
      this.running++;
      if (job.urgent) this.runningUrgent++;
      this.run(job).finally(() => {
        this.running--;
        if (job.urgent) this.runningUrgent--;
        setTimeout(() => this.pump(), job.urgent ? 100 : 1800);
        this.emit();
      });
    }
    this.emit();
  }

  async run(job) {
    const start = this.start;
    const prefs = { ...settings.prefs, surface: this.surface, hills: job.hills || 'any', background: true };
    if (job.bin) this.tried.set(job.bin, (this.tried.get(job.bin) || 0) + 1);
    try {
      const rec = await makeRoute({ start, kind: job.kind, target: job.target, prefs, seed: (this.seed += 7919) });
      if (rec && job.key === this.key) {
        rec.hills = rec.hills || 'rolling';
        this.add(rec);
      }
      this.error = '';
    } catch (e) {
      if (e instanceof RouteError && /busy|reach/i.test(e.message)) {
        this.error = e.message;
        this.pausedUntil = Date.now() + 12000;
        this.jobs.unshift(job); // try again after the pause
      }
    }
  }
}

export const bank = new Bank();
document.addEventListener('visibilitychange', () => !document.hidden && bank.pump());

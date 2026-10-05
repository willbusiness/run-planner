// One entry point for routing. Tries the best available server first and falls back down the list:
//   OpenRouteService (only if you pasted a key) -> Valhalla (free, knows footpaths) -> BRouter (free, backup).
// A server that fails is skipped for a minute so one outage doesn't slow every request.
import * as ors from './ors.js';
import * as valhalla from './valhalla.js';
import * as brouter from './brouter.js';
import { settings } from './settings.js';

export { RouteError, usage } from './ors.js';

export const usingOrs = () => !!settings.orsKey;

const down = new Map(); // provider name -> time it may be tried again
const providers = (prefs) => [
  ...(settings.orsKey && !prefs.background && !prefs.fast ? [['ors', ors]] : []), // ORS has a small daily quota: only for the runner's settled edits
  ['valhalla', valhalla],
  ['brouter', brouter],
];

export async function route(points, prefs) {
  let last;
  const list = providers(prefs);
  for (let i = 0; i < list.length; i++) {
    const [name, p] = list[i];
    const lastOne = i === list.length - 1;
    if (!lastOne && (down.get(name) || 0) > Date.now()) continue;
    try {
      return await p.route(points, prefs);
    } catch (e) {
      if (!(e instanceof ors.RouteError)) throw e;
      if (/No walkable route|No route returned/i.test(e.message)) throw e; // a real dead end: other servers won't help
      last = e;
      if (/busy|rate limit|reach|failed/i.test(e.message)) down.set(name, Date.now() + 60000);
    }
  }
  throw last;
}

/** Part of the leg cache key: results from different routers/prefs must not mix. */
export const prefsKey = (prefs) => (settings.orsKey ? 'o' : 'v') + ors.prefsKey(prefs);

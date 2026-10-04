// One entry point for routing. Uses OpenRouteService when a key is set (better foot-path preferences),
// otherwise (or if ORS is rate-limited / unreachable) the keyless public BRouter server.
import * as ors from './ors.js';
import * as brouter from './brouter.js';
import { settings } from './settings.js';

export { RouteError, usage } from './ors.js';

export const usingOrs = () => !!settings.orsKey;

export async function route(points, prefs) {
  if (settings.orsKey) {
    try {
      return await ors.route(points, prefs);
    } catch (e) {
      if (e instanceof ors.RouteError && /rate limit|reach/i.test(e.message)) return brouter.route(points, prefs);
      throw e;
    }
  }
  return brouter.route(points, prefs);
}

/** Part of the leg cache key: results from different routers/prefs must not mix. */
export const prefsKey = (prefs) => (settings.orsKey ? 'o' : 'b') + ors.prefsKey(prefs);

// Turn a bank record into an editable Route (waypoints sit on the line, legs are slices of it).
import { Route } from './route.js';
import { splitLegs } from './loops.js';

export function routeFromRecord(rec, name = '') {
  const r = new Route();
  r.load(rec.wps, splitLegs(rec.c, rec.wps, rec.surf, rec.kinds), { name });
  return r;
}

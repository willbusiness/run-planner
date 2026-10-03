// Route statistics: grade-adjusted time, splits, surface mix.
import { analyze } from './elevation.js';
import { settings, KM_PER_MI } from './settings.js';

/** Pace multiplier for a given grade (%). 1 = flat. Damped Minetti running-cost curve. */
export function gapFactor(gradePct) {
  const i = Math.max(-0.3, Math.min(0.3, gradePct / 100));
  const cost = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  return Math.max(0.8, Math.min(2.2, 1 + 0.6 * (cost / 3.6 - 1)));
}

/** Seconds to run the analysed route at a flat pace of `pace` s/km. */
export function estimateTime(an, pace = settings.pace) {
  let t = 0;
  for (let i = 1; i < an.d.length; i++) t += ((an.d[i] - an.d[i - 1]) / 1000) * pace * gapFactor(an.g[i]);
  return t;
}

/** Per-km (or per-mile) splits with gain/loss and time. */
export function splits(an, pace = settings.pace) {
  const len = settings.units === 'mi' ? KM_PER_MI * 1000 : 1000;
  const out = [];
  let start = 0;
  let next = len;
  let gain = 0, loss = 0, time = 0;
  for (let i = 1; i < an.d.length; i++) {
    const dd = an.d[i] - an.d[i - 1];
    const de = an.e[i] - an.e[i - 1];
    if (de > 0) gain += de; else loss -= de;
    time += (dd / 1000) * pace * gapFactor(an.g[i]);
    const last = i === an.d.length - 1;
    if (an.d[i] >= next || last) {
      out.push({ n: out.length + 1, dist: an.d[i] - start, gain, loss, time, endEle: an.e[i] });
      start = an.d[i];
      next += len;
      gain = loss = time = 0;
    }
  }
  return out;
}

export function emptySurf() {
  return { paved: 0, gravel: 0, dirt: 0, unknown: 0 };
}

export function addSurf(a, b) {
  for (const k of Object.keys(a)) a[k] += b?.[k] || 0;
  return a;
}

/** Everything the UI needs about a coordinate list. */
export function summarize(coords, surf = emptySurf()) {
  const an = analyze(coords);
  return { coords, an, surf, dist: an.dist, gain: an.gain, loss: an.loss, time: estimateTime(an) };
}

/** Hills category from metres climbed per km. */
export function hillClass(gain, dist) {
  const perKm = gain / Math.max(0.1, dist / 1000);
  return perKm < 7 ? 'flat' : perKm < 16 ? 'rolling' : 'hilly';
}

export const SURFACE_COLORS = { paved: '#6b7a8f', gravel: '#d9a441', dirt: '#8a5a2b', unknown: '#c3c8d0' };
export const SURFACE_LABELS = { paved: 'Sealed', gravel: 'Gravel', dirt: 'Dirt/grass', unknown: 'Unknown' };

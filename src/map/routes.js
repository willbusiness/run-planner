// Draws route suggestions on the map: quiet alternatives, the bold selected route, km marks, start pin.
import { map, setData, lineFeature, maplibregl } from './view.js';
import { settings } from '../settings.js';
import { cumulative, pointAtDistance, bounds } from '../geo.js';

const hit = { onSelect: null, onHover: null };
export const onRouteClick = (fn) => (hit.onSelect = fn);
export const onRouteHover = (fn) => (hit.onHover = fn);

/** Left inset so routes fit beside the floating panel (desktop) or above the sheet (phone). */
export function mapPadding(extra = 56) {
  if (window.innerWidth >= 860) return { top: extra, bottom: extra, left: 408 + 32 + extra, right: extra };
  const sheet = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h')) || window.innerHeight * 0.52;
  return { top: extra, bottom: Math.min(sheet, window.innerHeight * 0.6) + 16, left: 24, right: 24 };
}

export function fitCoords(coords, { duration = 800, extra = 56 } = {}) {
  if (!coords.length) return;
  const [[s, w], [n, e]] = bounds(coords);
  map.fitBounds([[w, s], [e, n]], { padding: mapPadding(extra), duration, maxZoom: 16 });
}

let startMarker;
export function setStartMarker(ll, { onDrag, draggable = true } = {}) {
  if (!ll) return startMarker?.remove();
  if (!startMarker) {
    const el = document.createElement('div');
    el.className = 'mk-start';
    el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></svg>';
    startMarker = new maplibregl.Marker({ element: el, draggable });
  }
  startMarker.setDraggable(draggable);
  startMarker.setLngLat([ll[1], ll[0]]).addTo(map);
  startMarker.off('dragend');
  if (onDrag) startMarker.on('dragend', () => { const p = startMarker.getLngLat(); onDrag([p.lat, p.lng]); });
}

const kmPoints = (coords) => {
  if (coords.length < 2) return [];
  const cum = cumulative(coords);
  const unit = settings.units === 'mi' ? 1609.344 : 1000;
  const total = cum[cum.length - 1];
  const out = [];
  for (let k = 1; k * unit < total - unit * 0.25; k++) {
    const p = pointAtDistance(coords, cum, k * unit);
    out.push({ type: 'Feature', properties: { label: String(k) }, geometry: { type: 'Point', coordinates: [p[1], p[0]] } });
  }
  return out;
};

export function drawKms(coords) {
  setData('kms', kmPoints(coords));
}

/**
 * items: [{id, coords}], selectedId, hoverId. Everything but the selected route is a quiet line.
 */
export function drawResults(items, selectedId, hoverId) {
  const sel = items.find((r) => r.id === selectedId);
  setData('alts', items.filter((r) => r.id !== selectedId).map((r) => lineFeature(r.coords, { id: r.id, hover: r.id === hoverId, dim: !!hoverId && r.id !== hoverId })));
  setData('sel', sel ? [lineFeature(sel.coords, { id: sel.id })] : []);
  drawKms(sel ? sel.coords : []);
}

export function clearResults() {
  setData('alts', []);
  setData('sel', []);
  setData('kms', []);
}

// ---- picking a quiet line on the map ----
let wired = false;
export function wireMapPicking() {
  if (wired) return;
  wired = true;
  const box = (pt, r = 8) => [[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]];
  map.on('click', (e) => {
    if (document.body.classList.contains('editing')) return;
    const f = map.queryRenderedFeatures(box(e.point), { layers: ['alts-line'] })[0] || map.queryRenderedFeatures(box(e.point), { layers: ['sel-line'] })[0];
    if (f && hit.onSelect) hit.onSelect(f.properties.id);
  });
  map.on('mousemove', (e) => {
    if (document.body.classList.contains('editing')) return;
    const f = map.queryRenderedFeatures(box(e.point), { layers: ['alts-line'] })[0];
    map.getCanvas().style.cursor = f ? 'pointer' : '';
    hit.onHover?.(f ? f.properties.id : null, 'map');
  });
}

// ---- elevation-profile scrub dot ----
let scrub;
export function setScrub(p) {
  if (!p) return scrub?.remove();
  if (!scrub) {
    const el = document.createElement('div');
    el.className = 'mk-scrub';
    scrub = new maplibregl.Marker({ element: el });
  }
  scrub.setLngLat([p[1], p[0]]).addTo(map);
}

// The map: MapLibre GL with our route layers. Other modules talk to it through these functions.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'; // bundled with its dependencies by Vite
import { buildStyle, chevronImage, gradientTo, ACCENT } from './style.js';

maplibregl.setWorkerUrl(workerUrl);

export let map;
const cache = {}; // source id -> last data, so a theme switch can restore it
let theme = 'light';
let touched = false; // the runner has moved the map themselves: stop moving it for them
export const mapTouched = () => touched;
export const resetTouched = () => { touched = false; };

const FC = (features) => ({ type: 'FeatureCollection', features });
export const lineFeature = (coords, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords.map((c) => [c[1], c[0]]) } });

export function createMap(container, { center, zoom, dark }) {
  theme = dark ? 'dark' : 'light';
  map = new maplibregl.Map({
    container,
    style: buildStyle(theme),
    center: [center[1], center[0]],
    zoom,
    minZoom: 3,
    maxZoom: 19,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 120,
  });
  map.touchZoomRotate.disableRotation();
  for (const ev of ['pointerdown', 'wheel', 'touchstart']) container.addEventListener(ev, () => (touched = true), { passive: true });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.on('styleimagemissing', (e) => { if (e.id === 'chevron' && !map.hasImage('chevron')) map.addImage('chevron', chevronImage()); });
  map.on('load', () => { if (!map.hasImage('chevron')) map.addImage('chevron', chevronImage()); });
  return map;
}

/** Replace the data of one of our GeoJSON sources. */
export function setData(id, features) {
  cache[id] = features;
  const src = map?.getSource(id);
  if (src) src.setData(FC(features));
}

export function setTheme(next) {
  if (next === theme) return;
  theme = next;
  map.setStyle(buildStyle(theme), { diff: false });
  map.once('styledata', () => {
    if (!map.hasImage('chevron')) map.addImage('chevron', chevronImage());
    for (const [id, f] of Object.entries(cache)) map.getSource(id)?.setData(FC(f));
  });
}

export function setTrailsVisible(on) {
  for (const id of ['trail-paved', 'trail-dirt']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

export { maplibregl };

let anim = 0;
/** Make the selected route draw itself from the start. */
export function revealSelected(ms = 700) {
  cancelAnimationFrame(anim);
  const casing = theme === 'dark' ? '#0b0d10' : '#ffffff';
  const t0 = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - t) ** 3; // ease out
    if (map.getLayer('sel-line')) {
      map.setPaintProperty('sel-line', 'line-gradient', gradientTo(e, ACCENT));
      map.setPaintProperty('sel-casing', 'line-gradient', gradientTo(e, casing));
    }
    if (t < 1) anim = requestAnimationFrame(frame);
  };
  anim = requestAnimationFrame(frame);
}

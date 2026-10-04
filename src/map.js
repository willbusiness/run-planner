// Leaflet map, basemaps, and a few shared map helpers.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { settings, save } from './settings.js';
import { pointAtDistance, cumulative } from './geo.js';

const VIEW_KEY = 'runplanner.view';
const DEFAULT_VIEW = { center: [-33.8975, 151.2335], zoom: 14 }; // Centennial Park, Sydney

function savedView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY)) || DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export const map = L.map('map', { zoomControl: false, zoomSnap: 0.5, zoomDelta: 1, worldCopyJump: false }).setView(savedView().center, savedView().zoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
map.attributionControl.setPrefix(false);

map.on('moveend', () => {
  const c = map.getCenter();
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() }));
  } catch { /* ignore */ }
});

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TILE_OPTS = { updateWhenIdle: false, updateWhenZooming: false, keepBuffer: 3 };
// 'light' and 'dark' are the same OSM tiles restyled with a CSS filter (see style.css), so no extra tile provider is needed.
const BASEMAPS = {
  light: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: OSM } },
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: OSM } },
  topo: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opts: { maxZoom: 17, subdomains: 'abc', attribution: OSM + ', SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>' } },
  dark: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: OSM } },
};
export const BASEMAP_LABELS = { light: 'Clean (best for routes)', osm: 'Street detail', topo: 'Terrain (contours)', dark: 'Dark' };

let base;
export function setBasemap(name) {
  const def = BASEMAPS[name] || BASEMAPS.osm;
  base?.remove();
  base = L.tileLayer(def.url, { ...TILE_OPTS, ...def.opts }).addTo(map);
  base.bringToBack();
  map.getContainer().className = map.getContainer().className.replace(/\bbm-\w+/g, '').trim() + ' bm-' + name;
  settings.basemap = name;
  save();
}

// Panes keep overlays under route lines regardless of add order.
map.createPane('overlays').style.zIndex = 350;
map.createPane('routes').style.zIndex = 420;
map.createPane('handles').style.zIndex = 620;

/** Is the layout the phone bottom-sheet? */
export const isMobile = () => window.matchMedia('(max-width: 799px)').matches;

/** Padding so fitted routes aren't hidden behind the panel/sheet. */
export function fitPadding() {
  if (isMobile()) {
    const sheet = document.getElementById('panel').getBoundingClientRect();
    return { paddingTopLeft: [24, 76], paddingBottomRight: [24, window.innerHeight - sheet.top + 16] };
  }
  return { paddingTopLeft: [420, 76], paddingBottomRight: [64, 32] };
}

export function fitTo(bounds) {
  map.fitBounds(bounds, { ...fitPadding(), maxZoom: 16, animate: true });
}

// ---- scrub marker: follows the elevation profile cursor ----
let scrubMarker;
export function setScrub(coords, meters) {
  if (meters == null || !coords?.length) {
    scrubMarker?.remove();
    scrubMarker = null;
    return;
  }
  const cum = cumulative(coords);
  const p = pointAtDistance(coords, cum, meters);
  if (!scrubMarker) {
    scrubMarker = L.circleMarker([p[0], p[1]], { radius: 7, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 1, pane: 'handles', interactive: false }).addTo(map);
  } else scrubMarker.setLatLng([p[0], p[1]]);
}

export { L };

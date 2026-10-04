// Map overlays from OpenStreetMap: trail network, ovals/tracks, water & toilets, named routes.
import { map, L } from './map.js';
import { settings } from './settings.js';
import { fetchTrails, fetchOvals, fetchWater, fetchRoutes } from './overpass.js';
import { fmtDist } from './settings.js';
import { h } from './ui.js';

// two looks only: soft green for sealed paths, brown dashes for dirt/gravel/unknown tracks (the stuff you'd trail-run)
const UNPAVED = (t) => t.cls === 'gravel' || t.cls === 'dirt' || (t.cls === 'unknown' && (t.tags.highway === 'path' || t.tags.highway === 'track' || t.tags.highway === 'bridleway'));
const MIN_ZOOM = { trails: 15, ovals: 13, water: 15, routes: 12 };
const LOAD = { trails: fetchTrails, ovals: fetchOvals, water: fetchWater, routes: fetchRoutes };

const state = {
  mode: 'explore', // trails only respond to taps when not planning
  routes: [], // named OSM routes in view (consumed by Explore)
};
export const overlayEvents = new EventTarget();
export const osmRoutes = () => state.routes;
export const onOvalAction = { fn: null }; // set by Plan: (oval) => void

const groups = {};
const loaded = {}; // layer -> bounds already fetched
const tokens = {};
const cached = {}; // layer -> last fetched data, for re-render on mode change
const canvas = L.canvas({ pane: 'overlays', padding: 0.4, tolerance: 6 });

const label = (k) => ({ trails: 'trails', ovals: 'ovals', water: 'water points', routes: 'named routes' })[k];

function tagRows(tags, keys) {
  return keys.filter((k) => tags[k]).map((k) => h('div', null, h('b', null, k.replace(/_/g, ' ') + ': '), tags[k]));
}

function trailPopup(t) {
  const name = t.tags.name || ({ footway: 'Footpath', path: 'Path', track: 'Track', bridleway: 'Bridleway', pedestrian: 'Pedestrian way', cycleway: 'Shared path / cycleway' })[t.tags.highway] || 'Path';
  return h('div', { class: 'pop' },
    h('strong', null, name),
    h('div', { class: 'muted' }, `${t.tags.highway} · ${t.cls === 'unknown' ? 'surface not mapped' : t.cls}`),
    ...tagRows(t.tags, ['surface', 'width', 'lit', 'incline', 'sac_scale', 'trail_visibility', 'smoothness', 'bicycle', 'dog']),
    h('a', { href: `https://www.openstreetmap.org/way/${t.id}`, target: '_blank', rel: 'noopener' }, 'View on OSM'),
  );
}

function render(layer, data) {
  groups[layer]?.remove();
  const g = L.layerGroup().addTo(map);
  groups[layer] = g;
  if (layer === 'trails') {
    for (const t of data) {
      const dirt = UNPAVED(t);
      const line = L.polyline(t.coords, {
        renderer: canvas,
        pane: 'overlays',
        color: dirt ? '#a9611f' : '#3da36b',
        weight: dirt ? 2.5 : 2,
        opacity: dirt ? 0.8 : 0.55,
        dashArray: dirt ? '6 4' : null,
        interactive: state.mode !== 'plan',
      }).addTo(g);
      line.on('click', (e) => {
        if (state.mode === 'plan') return;
        L.DomEvent.stop(e);
        L.popup({ maxWidth: 240 }).setLatLng(e.latlng).setContent(trailPopup(t)).openOn(map);
      });
    }
  } else if (layer === 'ovals') {
    for (const o of data) {
      const poly = L.polygon(o.coords, { pane: 'overlays', color: '#1b9e4b', weight: 2, fillColor: '#2fbf63', fillOpacity: 0.18 }).addTo(g);
      poly.on('click', (e) => {
        L.DomEvent.stop(e);
        const sport = (o.tags.sport || '').replace(/_/g, ' ');
        const body = h('div', { class: 'pop' },
          h('strong', null, o.tags.name || (o.tags.leisure === 'track' ? 'Running track' : 'Oval / pitch')),
          h('div', { class: 'muted' }, sport || o.tags.leisure),
          h('div', null, h('b', null, 'Lap: '), fmtDist(o.lap)),
          ...tagRows(o.tags, ['surface', 'lit', 'access']),
          onOvalAction.fn ? h('button', { class: 'btn small', onclick: () => { map.closePopup(); onOvalAction.fn(o); } }, 'Run laps here') : null,
        );
        L.popup({ maxWidth: 240 }).setLatLng(e.latlng).setContent(body).openOn(map);
      });
    }
  } else if (layer === 'water') {
    for (const w of data) {
      const icon = L.divIcon({ className: '', html: `<div class="poi ${w.kind}">${w.kind === 'toilets' ? 'WC' : '💧'}</div>`, iconSize: [22, 22] });
      L.marker([w.lat, w.lng], { icon, pane: 'overlays', keyboard: false })
        .bindPopup(`<div class="pop"><strong>${w.kind === 'toilets' ? 'Toilets' : 'Drinking water'}</strong>${w.tags.name ? `<div>${w.tags.name}</div>` : ''}</div>`)
        .addTo(g);
    }
  }
}

async function update(layer) {
  const on = settings.layers[layer];
  if (!on || map.getZoom() < MIN_ZOOM[layer]) {
    if (layer !== 'routes') { groups[layer]?.remove(); delete groups[layer]; delete loaded[layer]; }
    return;
  }
  const view = map.getBounds();
  if (loaded[layer]?.contains(view)) return;
  const want = view.pad(layer === 'trails' ? 0.1 : 0.25);
  const token = (tokens[layer] = (tokens[layer] || 0) + 1);
  overlayEvents.dispatchEvent(new CustomEvent('status', { detail: { layer, loading: true } }));
  try {
    const data = await LOAD[layer](want);
    if (token !== tokens[layer]) return;
    loaded[layer] = want;
    cached[layer] = data;
    if (layer === 'routes') {
      state.routes = data;
      overlayEvents.dispatchEvent(new Event('routes'));
    } else render(layer, data);
    overlayEvents.dispatchEvent(new CustomEvent('status', { detail: { layer, loading: false, count: data.length } }));
  } catch {
    if (token === tokens[layer]) overlayEvents.dispatchEvent(new CustomEvent('status', { detail: { layer, loading: false, error: `Couldn't load ${label(layer)} (OSM server busy). Pan to retry.` } }));
  }
}

let timer;
export function refreshOverlays() {
  clearTimeout(timer);
  timer = setTimeout(() => Object.keys(LOAD).forEach(update), 600);
}

/** Layer toggled in the layers popover. */
export function layerToggled(layer) {
  if (!settings.layers[layer]) {
    groups[layer]?.remove();
    delete groups[layer];
    delete loaded[layer];
    if (layer === 'routes') { state.routes = []; overlayEvents.dispatchEvent(new Event('routes')); }
  } else update(layer);
}

export function setOverlayMode(mode) {
  const was = state.mode;
  state.mode = mode;
  if (cached.trails && (was === 'plan') !== (mode === 'plan') && groups.trails) render('trails', cached.trails);
}

export function initOverlays() {
  map.on('moveend', refreshOverlays);
  refreshOverlays();
}

export function zoomHint() {
  const z = map.getZoom();
  return Object.entries(MIN_ZOOM)
    .filter(([k, min]) => settings.layers[k] && z < min && k !== 'routes')
    .map(([k, min]) => `Zoom in to ${min}+ to see ${label(k)}`);
}

// Map style: OpenFreeMap's minimal "Positron" layout, recoloured into a calm light/dark theme,
// with our own route layers on top. Everything is vector data, so it stays crisp and fast.
import base from './positron.json';

export const ACCENT = '#ff5a1f';
export const gradientTo = (t, color) => (t >= 1 ? ['interpolate', ['linear'], ['line-progress'], 0, color, 1, color] : ['step', ['line-progress'], color, Math.max(0.0001, t), 'rgba(0,0,0,0)']);

const LIGHT = {
  land: '#f3f2ee',
  residential: '#efeeea',
  park: '#dcead3',
  wood: '#d3e5cb',
  water: '#c4dcec',
  waterLine: '#b5d1e4',
  building: '#e9e7e1',
  buildingLine: '#e0ddd5',
  roadMinor: '#ffffff',
  roadMinorCase: '#e4e1d9',
  roadMajor: '#ffffff',
  roadMajorCase: '#d8d4ca',
  motorway: '#fdf1d6',
  motorwayCase: '#e6d3a0',
  path: '#c7bfae',
  rail: '#d9d6cf',
  label: '#4b5563',
  labelSoft: '#8b93a1',
  halo: '#ffffffd9',
  waterLabel: '#5b87a8',
  parkLabel: '#6b8f5f',
};

const DARK = {
  land: '#171a1f',
  residential: '#1a1d22',
  park: '#1d2a22',
  wood: '#1a2720',
  water: '#10222f',
  waterLine: '#12293a',
  building: '#1e2228',
  buildingLine: '#23282f',
  roadMinor: '#2a2f37',
  roadMinorCase: '#171a1f',
  roadMajor: '#363c46',
  roadMajorCase: '#171a1f',
  motorway: '#444b57',
  motorwayCase: '#171a1f',
  path: '#3b4350',
  rail: '#2a2f37',
  label: '#aeb6c4',
  labelSoft: '#6f7886',
  halo: '#171a1fd9',
  waterLabel: '#6f93b0',
  parkLabel: '#6f9a7c',
};

// zoom-dependent widths for roads (metres-ish at the given zoom)
const w = (a, b, c, d) => ['interpolate', ['exponential', 1.4], ['zoom'], a, b, c, d];

/** Paint overrides by layer id for a palette. */
function overrides(p) {
  return {
    background: { 'background-color': p.land },
    park: { 'fill-color': p.park },
    water: { 'fill-color': p.water },
    waterway: { 'line-color': p.waterLine },
    landuse_residential: { 'fill-color': p.residential },
    landcover_wood: { 'fill-color': p.wood },
    building: { 'fill-color': p.building, 'fill-outline-color': p.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 16, 1] },
    road_pier: { 'line-color': p.land },
    highway_path: { 'line-color': p.path, 'line-opacity': 0.9, 'line-width': w(14, 0.6, 20, 4) },
    highway_minor: { 'line-color': p.roadMinor, 'line-opacity': 1, 'line-width': w(13, 1.6, 20, 20) },
    highway_major_casing: { 'line-color': p.roadMajorCase },
    highway_major_inner: { 'line-color': p.roadMajor },
    highway_major_subtle: { 'line-color': p.roadMajorCase },
    highway_motorway_casing: { 'line-color': p.motorwayCase },
    highway_motorway_inner: { 'line-color': p.motorway },
    highway_motorway_subtle: { 'line-color': p.motorwayCase },
    railway: { 'line-color': p.rail },
    'highway-name-path': { 'text-color': p.labelSoft, 'text-halo-color': p.halo },
    'highway-name-minor': { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.5 },
    'highway-name-major': { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.5 },
    label_other: { 'text-color': p.labelSoft, 'text-halo-color': p.halo },
    label_village: { 'text-color': p.label, 'text-halo-color': p.halo },
    label_town: { 'text-color': p.label, 'text-halo-color': p.halo },
    label_city: { 'text-color': p.label, 'text-halo-color': p.halo },
    label_city_capital: { 'text-color': p.label, 'text-halo-color': p.halo },
    water_name_point_label: { 'text-color': p.waterLabel, 'text-halo-color': p.halo },
    water_name_line_label: { 'text-color': p.waterLabel, 'text-halo-color': p.halo },
    waterway_line_label: { 'text-color': p.waterLabel, 'text-halo-color': p.halo },
  };
}

// layers we drop: borders and far-zoom clutter we never use in a city runner's map
const DROP = new Set(['boundary_3', 'boundary_2', 'boundary_disputed', 'airport', 'highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us', 'label_country_3', 'label_country_2', 'label_country_1', 'label_state']);

const empty = { type: 'FeatureCollection', features: [] };
const FONT = ['Noto Sans Bold'];
const ZOOM_W = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 17, b];

function trailLayer(id, kind, color, dash) {
  const sealed = ['==', ['get', 'surface'], 'paved'];
  return {
    id,
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom: 12.5,
    filter: ['all', ['in', ['get', 'subclass'], ['literal', ['path', 'bridleway', 'track', 'cycleway']]], kind === 'paved' ? sealed : ['!', sealed]],
    layout: { visibility: 'none', 'line-cap': dash ? 'butt' : 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.2, 18, 3.2], ...(dash ? { 'line-dasharray': dash } : {}), 'line-opacity': 0.95 },
  };
}

/** Our own sources + layers, drawn above the basemap. Data is pushed in with source.setData(). */
function routeLayers(dark) {
  const casing = dark ? '#0b0d10' : '#ffffff';
  const alt = dark ? '#8da2c8' : '#51627f';
  return {
    sources: {
      alts: { type: 'geojson', data: empty },
      sel: { type: 'geojson', data: empty, lineMetrics: true },
      pending: { type: 'geojson', data: empty },
      kms: { type: 'geojson', data: empty },
      trail: { type: 'geojson', data: empty },
    },
    layers: [
      // alternatives: calm slate lines so the chosen route is unmistakable
      { id: 'alts-casing', type: 'line', source: 'alts', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': casing, 'line-width': ZOOM_W(3.5, 7), 'line-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.25, 0.7] } },
      { id: 'alts-line', type: 'line', source: 'alts', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': alt, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['boolean', ['get', 'hover'], false], 4.5, 2], 17, ['case', ['boolean', ['get', 'hover'], false], 8, 4]], 'line-opacity': ['case', ['boolean', ['get', 'hover'], false], 1, ['boolean', ['get', 'dim'], false], 0.3, 0.6] } },
      // the selected route: white casing, accent line
      { id: 'sel-casing', type: 'line', source: 'sel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, casing, 1, casing], 'line-width': ZOOM_W(8, 13) } },
      { id: 'sel-line', type: 'line', source: 'sel', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, ACCENT, 1, ACCENT], 'line-width': ZOOM_W(5, 8) } },
      { id: 'sel-arrows', type: 'symbol', source: 'sel', minzoom: 12.5, layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'chevron', 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 17, 0.62], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map' } },
      // legs still being routed or failed: dashed rubber band
      { id: 'pending-line', type: 'line', source: 'pending', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'state'], 'error'], '#e5484d', ACCENT], 'line-width': 3, 'line-dasharray': [0.1, 2.2], 'line-opacity': 0.95 } },
      { id: 'km-labels', type: 'symbol', source: 'kms', minzoom: 11.5, layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 11, 'text-allow-overlap': false, 'text-padding': 8 }, paint: { 'text-color': dark ? '#f3f4f6' : '#111827', 'text-halo-color': casing, 'text-halo-width': 2.2 } },
      // optional emphasised running paths (drawn from the map's own tiles)
      trailLayer('trail-paved', 'paved', dark ? '#6fcf97' : '#2fa36b', null),
      trailLayer('trail-dirt', 'other', dark ? '#d9a35b' : '#b9722a', [2, 1.4]),
    ],
  };
}

/** Build the complete style for 'light' or 'dark'. */
export function buildStyle(theme = 'light') {
  const dark = theme === 'dark';
  const ov = overrides(dark ? DARK : LIGHT);
  const style = structuredClone(base);
  style.layers = style.layers
    .filter((l) => !DROP.has(l.id))
    .map((l) => {
      const o = ov[l.id];
      if (!o) return l;
      return { ...l, paint: { ...l.paint, ...o } };
    });
  const mine = routeLayers(dark);
  style.sources = { ...style.sources, ...mine.sources };
  style.layers.push(...mine.layers);
  style.glyphs = base.glyphs;
  return style;
}

/** Chevron used for the direction arrows along the selected route. */
export function chevronImage() {
  const s = 48;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 7;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(16, 10);
  g.lineTo(32, 24);
  g.lineTo(16, 38);
  g.stroke();
  return g.getImageData(0, 0, s, s);
}

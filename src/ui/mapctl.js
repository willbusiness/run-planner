// Floating map buttons: zoom, my location, layers.
import { h, iconBtn, toggle, toast, closeMenu } from './dom.js';
import { map, maplibregl, setTrailsVisible } from '../map/view.js';
import { settings, save } from '../settings.js';

let me;

export function mountMapControls(root) {
  const layersBtn = iconBtn('layers', 'Map layers', () => togglePop(layersBtn));
  root.append(
    h('div', { class: 'single' }, iconBtn('locate', 'My location', locate)),
    h('div', { class: 'cluster' }, iconBtn('plus', 'Zoom in', () => map.zoomIn({ duration: 250 })), iconBtn('minus', 'Zoom out', () => map.zoomOut({ duration: 250 }))),
    h('div', { class: 'single' }, layersBtn),
  );
}

function locate() {
  if (!navigator.geolocation) return toast('Location is not available in this browser.');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = [pos.coords.longitude, pos.coords.latitude];
      if (!me) {
        const el = h('div', { class: 'mk-me' });
        me = new maplibregl.Marker({ element: el });
      }
      me.setLngLat(ll).addTo(map);
      map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 14.5), duration: 900 });
    },
    () => toast('Could not get your location. Check the browser permission.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

let pop;
function togglePop(anchor) {
  if (pop) { pop.remove(); pop = null; return; }
  closeMenu();
  const r = anchor.getBoundingClientRect();
  pop = h('div', { class: 'pop', style: { right: window.innerWidth - r.left + 10 + 'px', top: r.top - 4 + 'px', transform: 'translateY(-100%)', minWidth: '250px' } },
    h('h4', null, 'On the map'),
    toggle('Running paths & trails', settings.trails, (v) => { settings.trails = v; save(); setTrailsVisible(v); if (v && map.getZoom() < 13) map.easeTo({ zoom: 14 }); }),
    h('div', { style: { padding: '2px 10px 8px', color: 'var(--ink-3)', fontSize: '12px' } }, 'Green is sealed, brown dashes are dirt or gravel. Shown from zoom 13.'),
  );
  document.body.append(pop);
  setTimeout(() => document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); pop = null; } }, { once: true, capture: true }));
}

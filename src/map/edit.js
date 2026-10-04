// Map side of the route editor: waypoint handles, drag-to-reshape, drag-the-line-to-add-a-point,
// click-to-extend, and live re-routing while you drag.
import { map, setData, lineFeature, maplibregl } from './view.js';
import { drawKms } from './routes.js';
import { closestOnPath } from '../geo.js';
import { usingOrs } from '../routing.js';
import { showMenu, closeMenu } from '../ui/dom.js';

const flatLine = (coords) => coords.map((c) => [c[1], c[0]]);

class EditLayer {
  constructor() {
    this.route = null;
    this.addMode = 'snap';
    this.markers = [];
    this.dragIdx = -1;
    this.ghost = null;
    this.ghostLeg = -1;
    this.draggingGhost = false;
    this.suppressClick = false;
    this.onRender = null;
    this.render = this.render.bind(this);
  }

  attach(route) {
    this.detach();
    this.route = route;
    route.addEventListener('change', this.render);
    document.body.classList.add('planning');
    this.mapClick = (e) => {
      if (this.suppressClick || e.originalEvent.target.closest('.maplibregl-marker')) return;
      closeMenu();
      this.route.addWaypoint([e.lngLat.lat, e.lngLat.lng], this.addMode);
    };
    this.mapMove = (e) => this.onMove(e);
    map.on('click', this.mapClick);
    map.on('mousemove', this.mapMove);
    this.render();
  }

  detach() {
    if (!this.route) return;
    this.route.removeEventListener('change', this.render);
    map.off('click', this.mapClick);
    map.off('mousemove', this.mapMove);
    this.route = null;
    this.clearMarkers();
    this.hideGhost();
    document.body.classList.remove('planning');
    setData('sel', []);
    setData('pending', []);
    setData('kms', []);
  }

  // ---- drawing ----
  render() {
    const route = this.route;
    if (!route) return;
    const wps = route.waypoints;
    const solid = [];
    const loose = [];
    route.legs.forEach((leg, i) => {
      if (leg.status === 'ok' && leg.mode === 'snap') solid.push(lineFeature(leg.coords, { leg: i }));
      else if (leg.status === 'ok') loose.push(lineFeature(leg.coords, { state: 'free' }));
      else loose.push(lineFeature([wps[i], wps[i + 1]], { state: leg.status === 'error' ? 'error' : 'pending' }));
    });
    setData('sel', solid);
    setData('pending', loose);
    if (this.dragIdx < 0) {
      this.renderMarkers();
      drawKms(route.coords());
    }
    this.onRender?.();
  }

  clearMarkers() {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
  }

  renderMarkers() {
    this.clearMarkers();
    const wps = this.route.waypoints;
    wps.forEach((p, i) => {
      const last = i === wps.length - 1 && wps.length > 1;
      const closed = last && Math.abs(p[0] - wps[0][0]) < 1e-5 && Math.abs(p[1] - wps[0][1]) < 1e-5;
      const onStart = i > 0 && Math.abs(p[0] - wps[0][0]) < 1e-5 && Math.abs(p[1] - wps[0][1]) < 1e-5;
      if (closed || onStart) return; // a loop's finish (or a return pass) sits on the start pin
      const el = document.createElement('div');
      el.className = i === 0 ? 'mk-start' : last ? 'mk-end' : 'mk-wp';
      if (i === 0) el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></svg>';
      if (last) el.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/></svg>';
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p[1], p[0]]).addTo(map);
      m.on('dragstart', () => { this.hideGhost(); this.route.push(); this.dragIdx = i; this.suppressClick = true; closeMenu(); });
      m.on('drag', () => {
        const ll = m.getLngLat();
        wps[i] = [ll.lat, ll.lng];
        this.render();
        this.live();
      });
      m.on('dragend', () => {
        clearTimeout(this.liveTimer);
        this.dragIdx = -1;
        setTimeout(() => (this.suppressClick = false), 50);
        this.route.moveWaypoint(i, wps[i]);
      });
      el.addEventListener('click', (e) => { e.stopPropagation(); this.menuFor(i, e); });
      this.markers.push(m);
    });
  }

  /** While dragging, re-route touched legs about once a second so the line follows the pointer. */
  live() {
    const now = Date.now();
    clearTimeout(this.liveTimer);
    const gap = usingOrs() ? 700 : 1100; // be kind to the free public router
    if (now - (this.lastLive || 0) > gap) {
      this.lastLive = now;
      this.route.refresh();
    } else {
      this.liveTimer = setTimeout(() => { this.lastLive = Date.now(); this.route.refresh(); }, 350);
    }
  }

  menuFor(i, e) {
    const route = this.route;
    const n = route.waypoints.length;
    const items = [{ heading: i === 0 ? 'Start' : i === n - 1 ? 'Finish' : `Point ${i}` }];
    const legItem = (idx, text) => {
      const leg = route.legs[idx];
      if (!leg) return;
      const to = leg.mode === 'snap' ? 'free' : 'snap';
      items.push({ label: `${text}: ${to === 'free' ? 'draw freehand' : 'snap to paths'}`, icon: to === 'free' ? 'free' : 'snap', onclick: () => route.setLegMode(idx, to) });
    };
    if (i > 0) legItem(i - 1, 'Leg before');
    if (i < n - 1) legItem(i, 'Leg after');
    items.push({ label: 'Delete point', icon: 'trash', danger: true, onclick: () => route.removeWaypoint(i) });
    showMenu(e.clientX + 8, e.clientY + 8, items);
  }

  // ---- drag the line to add a point ----
  onMove(e) {
    if (this.draggingGhost || this.dragIdx >= 0 || !this.route) return;
    const f = map.queryRenderedFeatures([[e.point.x - 9, e.point.y - 9], [e.point.x + 9, e.point.y + 9]], { layers: ['sel-line'] })[0];
    if (!f) return this.scheduleHide();
    clearTimeout(this.hideTimer);
    const ll = [e.lngLat.lat, e.lngLat.lng];
    let best = null;
    this.route.legs.forEach((leg, i) => {
      if (leg.status !== 'ok' || leg.coords.length < 2) return;
      const hit = closestOnPath(leg.coords, ll);
      if (!best || hit.dist < best.dist) best = { ...hit, leg: i };
    });
    if (!best) return;
    this.ghostLeg = best.leg;
    this.showGhost(best.point);
  }

  ensureGhost() {
    if (this.ghost) return this.ghost;
    const el = document.createElement('div');
    el.className = 'mk-ghost';
    el.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    el.addEventListener('mouseleave', () => this.scheduleHide());
    el.addEventListener('click', (e) => e.stopPropagation());
    const m = new maplibregl.Marker({ element: el, draggable: true });
    m.on('dragstart', () => {
      this.draggingGhost = true;
      this.suppressClick = true;
      const idx = this.ghostLeg + 1;
      const ll = m.getLngLat();
      this.route.insertWaypoint(idx, [ll.lat, ll.lng], { refresh: false });
      this.dragIdx = idx;
    });
    m.on('drag', () => {
      const ll = m.getLngLat();
      this.route.waypoints[this.dragIdx] = [ll.lat, ll.lng];
      this.render();
      this.live();
    });
    m.on('dragend', () => {
      clearTimeout(this.liveTimer);
      const ll = m.getLngLat();
      const idx = this.dragIdx;
      this.draggingGhost = false;
      this.dragIdx = -1;
      setTimeout(() => (this.suppressClick = false), 50);
      this.hideGhost();
      this.route.moveWaypoint(idx, [ll.lat, ll.lng]);
    });
    return (this.ghost = m);
  }

  showGhost(pt) {
    const g = this.ensureGhost();
    g.setLngLat([pt[1], pt[0]]);
    if (!g._added) { g.addTo(map); g._added = true; }
  }

  scheduleHide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => !this.draggingGhost && this.hideGhost(), 500);
  }

  hideGhost() {
    clearTimeout(this.hideTimer);
    if (this.ghost?._added) { this.ghost.remove(); this.ghost._added = false; }
  }
}

export const editLayer = new EditLayer();

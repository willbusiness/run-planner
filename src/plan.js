// Plan mode: the map editing layer (waypoints, drag-to-reshape) and the side panel.
import { map, L, fitTo, setScrub } from './map.js';
import { Route } from './route.js';
import { settings, save, emit, fmtDistShort } from './settings.js';
import { h, icon, iconBtn, seg, toggle, toast, statsRow, surfaceBar, profileBox, splitsTable } from './ui.js';
import { closestOnPath, bounds, cumulative, pointAtDistance } from './geo.js';
import { splits } from './stats.js';
import { usingOrs } from './routing.js';
import { saveRoute, shareHash } from './storage.js';
import { toGPX, download, safeName, parseGPX } from './gpx.js';

export const route = new Route();
const LINE = '#ff5a1f';

// =============== map layer ===============
class PlanLayer {
  constructor() {
    this.group = L.layerGroup();
    this.lines = L.layerGroup().addTo(this.group);
    this.marks = L.layerGroup().addTo(this.group);
    this.kms = L.layerGroup().addTo(this.group);
    this.active = false;
    this.dragIdx = -1; // waypoint being dragged: its adjacent legs draw as straight rubber bands
    this.addMode = 'snap';
    this.ghost = L.marker([0, 0], {
      draggable: true, pane: 'handles', zIndexOffset: 800,
      icon: L.divIcon({ className: '', html: '<div class="wp ghost"></div>', iconSize: [18, 18] }),
    });
    this.ghostLeg = -1;
    this.draggingGhost = false;
    this.wireGhost();
    map.on('click', (e) => this.onMapClick(e));
    map.on('zoomend', () => this.renderKms());
    route.addEventListener('change', () => this.active && this.render());
  }

  activate() {
    this.active = true;
    this.group.addTo(map);
    this.render();
    map.getContainer().classList.add('planning');
  }
  deactivate() {
    this.active = false;
    this.hideGhost();
    this.group.remove();
    map.getContainer().classList.remove('planning');
  }

  onMapClick(e) {
    if (!this.active) return;
    if (this.ghost._map) { this.hideGhost(); return; }
    route.addWaypoint([e.latlng.lat, e.latlng.lng], this.addMode);
  }

  // ---- drag-the-line-to-add-a-point ----
  wireGhost() {
    const g = this.ghost;
    g.on('mouseover', () => clearTimeout(this.hideTimer));
    g.on('mouseout', () => this.scheduleHide());
    g.on('dragstart', () => {
      this.draggingGhost = true;
      const idx = this.ghostLeg + 1;
      const ll = g.getLatLng();
      route.insertWaypoint(idx, [ll.lat, ll.lng], { refresh: false });
      this.dragIdx = idx;
    });
    g.on('drag', () => {
      const ll = g.getLatLng();
      route.waypoints[this.dragIdx] = [ll.lat, ll.lng];
      this.renderLines();
      this.liveRoute();
    });
    g.on('dragend', () => {
      clearTimeout(this.liveTimer);
      const ll = g.getLatLng();
      this.draggingGhost = false;
      const idx = this.dragIdx;
      this.dragIdx = -1;
      this.hideGhost();
      route.moveWaypoint(idx, [ll.lat, ll.lng]);
    });
    g.on('click', (e) => L.DomEvent.stop(e));
  }
  scheduleHide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => !this.draggingGhost && this.hideGhost(), 900);
  }
  hideGhost() {
    clearTimeout(this.hideTimer);
    if (this.ghost._map) this.ghost.remove();
  }
  showGhost(legIdx, latlng) {
    if (this.draggingGhost) return;
    clearTimeout(this.hideTimer);
    const leg = route.legs[legIdx];
    const hit = closestOnPath(leg.coords, [latlng.lat, latlng.lng]);
    this.ghostLeg = legIdx;
    this.ghost.setLatLng(hit.point);
    if (!this.ghost._map) this.ghost.addTo(this.group);
  }

  // ---- rendering ----
  render() {
    this.renderLines();
    if (this.dragIdx >= 0) return; // never rebuild markers under a finger mid-drag
    this.renderMarkers();
    this.renderKms();
  }

  /** While dragging, re-route the touched legs about twice a second so the line follows the pointer. */
  liveRoute() {
    const now = Date.now();
    clearTimeout(this.liveTimer);
    const gap = usingOrs() ? 700 : 1100; // be kind to the free public router
    if (now - (this.lastLive || 0) > gap) {
      this.lastLive = now;
      route.refresh();
    } else {
      this.liveTimer = setTimeout(() => { this.lastLive = Date.now(); route.refresh(); }, 350);
    }
  }

  renderLines() {
    this.lines.clearLayers();
    const wps = route.waypoints;
    route.legs.forEach((leg, i) => {
      if (leg.status === 'ok') {
        const ll = leg.coords;
        L.polyline(ll, { color: '#fff', weight: 9, opacity: 0.9, pane: 'routes', interactive: false, lineCap: 'round' }).addTo(this.lines);
        const line = L.polyline(ll, {
          color: LINE, weight: 5, opacity: 1, pane: 'routes', lineCap: 'round', lineJoin: 'round',
          dashArray: leg.mode === 'free' ? '1 9' : null, bubblingMouseEvents: false,
        }).addTo(this.lines);
        const hover = (e) => this.showGhost(i, e.latlng);
        line.on('mousemove', hover);
        line.on('click', hover); // touch: tap the line to get a draggable handle
        line.on('mouseout', () => this.scheduleHide());
      } else {
        // not routed yet: show a straight "rubber band" immediately so every tap gets instant feedback
        const bad = leg.status === 'error';
        L.polyline([wps[i], wps[i + 1]], {
          color: bad ? '#d7263d' : LINE, weight: bad ? 4 : 5, dashArray: bad ? '8 8' : '2 9', opacity: bad ? 0.85 : 0.75, lineCap: 'round', pane: 'routes', interactive: false,
        }).addTo(this.lines);
      }
    });
  }

  renderMarkers() {
    this.marks.clearLayers();
    const wps = route.waypoints;
    wps.forEach((p, i) => {
      const last = i === wps.length - 1 && wps.length > 1;
      const kind = i === 0 ? 'start' : last ? 'end' : 'mid';
      const m = L.marker(p, {
        draggable: true, pane: 'handles', keyboard: false,
        zIndexOffset: i === 0 ? 1000 : last ? 500 : 0,
        icon: L.divIcon({ className: '', html: `<div class="wp ${kind}">${kind === 'start' ? 'S' : kind === 'end' ? 'F' : ''}</div>`, iconSize: [26, 26] }),
      });
      m.on('dragstart', () => { this.hideGhost(); route.push(); this.dragIdx = i; });
      m.on('drag', () => {
        const ll = m.getLatLng();
        wps[i] = [ll.lat, ll.lng];
        this.renderLines();
        this.liveRoute();
      });
      m.on('dragend', () => {
        clearTimeout(this.liveTimer);
        this.dragIdx = -1;
        route.moveWaypoint(i, wps[i]);
      });
      m.on('click', (e) => { L.DomEvent.stop(e); this.waypointPopup(m, i); });
      m.addTo(this.marks);
    });
  }

  waypointPopup(marker, i) {
    const wps = route.waypoints;
    const box = h('div', { class: 'pop' }, h('strong', null, i === 0 ? 'Start' : i === wps.length - 1 ? 'Finish' : `Point ${i}`));
    const legBtn = (idx, text) => {
      const leg = route.legs[idx];
      if (!leg) return;
      const to = leg.mode === 'snap' ? 'free' : 'snap';
      box.append(h('button', { class: 'btn small', onclick: () => { map.closePopup(); route.setLegMode(idx, to); } }, `${text}: ${leg.mode === 'snap' ? 'snapped' : 'free draw'} → ${to === 'free' ? 'free draw' : 'snap to paths'}`));
    };
    if (i > 0) legBtn(i - 1, 'Leg before');
    if (i < wps.length - 1) legBtn(i, 'Leg after');
    box.append(h('button', { class: 'btn small danger', onclick: () => { map.closePopup(); route.removeWaypoint(i); } }, 'Delete point'));
    L.popup({ offset: [0, -8], closeButton: false }).setLatLng(marker.getLatLng()).setContent(box).openOn(map);
  }

  renderKms() {
    this.kms.clearLayers();
    if (!this.active || map.getZoom() < 12) return;
    const coords = route.coords();
    if (coords.length < 2) return;
    const cum = cumulative(coords);
    const unit = settings.units === 'mi' ? 1609.344 : 1000;
    const total = cum[cum.length - 1];
    const step = map.getZoom() >= 14 ? 1 : map.getZoom() >= 13 ? 2 : 5;
    for (let k = step; k * unit < total - unit * 0.3; k += step) {
      const p = pointAtDistance(coords, cum, k * unit);
      L.marker([p[0], p[1]], { interactive: false, pane: 'handles', icon: L.divIcon({ className: '', html: `<div class="kmk">${k}</div>`, iconSize: [18, 18] }) }).addTo(this.kms);
    }
  }
}

export const planLayer = new PlanLayer();

// "Run laps here" on an oval: free-draw legs around its outline
export function addOvalLaps(oval) {
  const pts = oval.coords.slice(0, -1);
  const step = Math.max(1, Math.floor(pts.length / 12));
  const wps = pts.filter((_, i) => i % step === 0);
  wps.push(wps[0]);
  const start = route.waypoints.length;
  route.push();
  wps.forEach((p, i) => {
    if (route.waypoints.length) route.legs.push(route.pendingLeg('free'));
    route.waypoints.push([p[0], p[1]]);
  });
  route.refresh();
  toast(`Added one lap of ${oval.tags.name || 'the oval'} (${fmtDistShort(oval.lap)}). Use Out & back or repeat for more laps.`);
  return start;
}

// =============== panel ===============
export function buildPlanPanel(root) {
  let sum = null;
  let splitsOpen = false;

  const draw = () => {
    root.replaceChildren();
    sum = route.legs.some((l) => l.status === 'ok') ? route.summary() : null;
    const n = route.waypoints.length;

    // toolbar
    const modeSeg = seg([['snap', 'Snap to paths'], ['free', 'Free draw']], planLayer.addMode, (v) => { planLayer.addMode = v; });
    root.append(
      h('div', { class: 'toolbar' },
        modeSeg,
        h('div', { class: 'tools' },
          iconBtn('undo', 'Undo', () => route.undo(), { disabled: !route.canUndo }),
          iconBtn('redo', 'Redo', () => route.redo(), { disabled: !route.canRedo }),
          iconBtn('swap', 'Reverse direction', () => route.reverse(), { disabled: n < 2 }),
          iconBtn('loop', 'Return to start (close loop)', () => route.closeLoop(planLayer.addMode), { disabled: n < 2 }),
          iconBtn('out', 'Out & back', () => route.outAndBack(), { label: '', disabled: n < 2 }),
          iconBtn('trash', 'Clear route', () => route.clear(), { disabled: n < 1 }),
        ),
      ),
    );

    if (!sum) {
      root.append(
        h('div', { class: 'empty' },
          h('p', null, h('b', null, n ? 'Routing…' : 'Tap the map to drop your start point.')),
          h('p', { class: 'muted' }, 'Keep tapping to extend the route. Drag any point or the line itself to reshape it. Switch to Free draw for ovals, grass and parks.'),
        ),
        importRow(),
      );
      return;
    }

    root.append(statsRow(sum));
    if (route.pending) root.append(h('div', { class: 'muted small' }, 'Updating route…'));
    if (route.hasError) root.append(h('div', { class: 'warn small' }, 'Some legs could not be routed (dashed red). Move the point or switch that leg to free draw.'));

    root.append(profileBox(sum, (m) => setScrub(sum.coords, m)));
    const sb = surfaceBar(sum.surf);
    if (sb) root.append(sb);

    // preferences for new legs
    root.append(prefsBlock());

    // save / share
    const name = h('input', { type: 'text', class: 'text', placeholder: 'Route name', value: route.name, oninput: (e) => { route.name = e.target.value; } });
    const tag = h('select', { class: 'text', onchange: (e) => { route.tag = e.target.value; } },
      ...[['', 'No tag'], ['long', 'Long run'], ['easy', 'Easy'], ['tempo', 'Tempo'], ['hills', 'Hills'], ['race', 'Race sim']].map(([v, l]) => h('option', { value: v, selected: v === route.tag }, l)));
    root.append(
      h('div', { class: 'row' }, name, tag),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { const id = saveRoute(route, sum); if (id) { route.savedId = id; toast('Saved'); emit('saved-changed'); } } }, icon('save', 16), route.savedId ? 'Update saved' : 'Save'),
        h('button', { class: 'btn', onclick: () => download(safeName(route.name) + '.gpx', toGPX(route.name || 'Run', sum.coords), 'application/gpx+xml') }, icon('download', 16), 'GPX'),
        h('button', { class: 'btn', onclick: copyLink }, icon('share', 16), 'Link'),
        h('button', { class: 'btn', onclick: () => root.querySelector('.gpx-file').click() }, icon('upload', 16), 'Import'),
        h('input', { type: 'file', class: 'gpx-file', accept: '.gpx', hidden: true, onchange: importGpx }),
      ),
    );

    // splits
    const tbl = h('details', { open: splitsOpen, ontoggle: (e) => { splitsOpen = e.target.open; } },
      h('summary', null, 'Splits per ' + (settings.units === 'mi' ? 'mile' : 'km')),
      splitsTable(splits(sum.an)));
    root.append(tbl);
  };

  function prefsBlock() {
    const p = settings.prefs;
    const set = (k, v) => { p[k] = v; save(); };
    return h('details', { class: 'prefs' },
      h('summary', null, 'Routing preferences'),
      h('div', { class: 'pref' }, h('label', null, 'Surface'), seg([['road', 'Roads'], ['mixed', 'Mixed'], ['trail', 'Trails']], p.surface, (v) => set('surface', v))),
      h('div', { class: 'pref' }, toggle('Quiet streets', p.quiet, (v) => set('quiet', v)), toggle('Parks & green', p.green, (v) => set('green', v)), toggle('Avoid stairs', p.avoidStairs, (v) => set('avoidStairs', v))),
      h('button', { class: 'btn small', onclick: () => { route.rerouteAll(); toast('Re-routing with these settings'); } }, icon('refresh', 14), 'Re-route all legs'),
      h('p', { class: 'muted small' }, 'Applies to new legs. Press re-route to update existing ones.'),
    );
  }

  const importRow = () => h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => root.querySelector('.gpx-file').click() }, icon('upload', 16), 'Import GPX'),
    h('input', { type: 'file', class: 'gpx-file', accept: '.gpx', hidden: true, onchange: importGpx }),
  );

  async function importGpx(e) {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const { name, coords } = parseGPX(await f.text());
      route.loadTrack(coords, { name: name || f.name.replace(/\.gpx$/i, '') });
      fitTo(bounds(coords));
    } catch (err) {
      toast(err.message);
    }
  }

  async function copyLink() {
    const url = location.origin + location.pathname + shareHash(route);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. It re-routes the plan on any device.');
    } catch {
      prompt('Copy this link', url);
    }
  }

  route.addEventListener('change', () => root.isConnected && !root.hidden && planLayer.dragIdx < 0 && draw());
  route.addEventListener('error', (e) => toast(e.detail, 5000));
  draw();
  return { draw };
}


// "My routes": everything you've saved, kept in this browser. Backup/restore moves it between devices.
import { h, icon, iconBtn, toast, syncList } from './dom.js';
import { listRoutes, deleteRoute, updateMeta, exportAll, importAll } from '../storage.js';
import { Route } from '../route.js';
import { fmtDistShort, fmtElev } from '../settings.js';
import { thumb } from './widgets.js';
import { toGPX, download, safeName } from '../gpx.js';
import { openEditor } from './editor.js';
import { showView } from './panel.js';
import { setMode } from '../app.js';

const coordsOf = (rec) => rec.data.legs.flatMap((l, i) => (i ? l.c.slice(1) : l.c));

export function openLibrary() {
  setMode('library');
  showView(buildLibrary());
}

function buildLibrary() {
  const list = h('div', { class: 'cards lib' });
  const file = h('input', { type: 'file', accept: '.json', hidden: true, onchange: restore });
  const head = h('div', { class: 'ehead' },
    h('div', { style: { flex: 1, fontSize: '17px', fontWeight: 650, padding: '0 10px' } }, 'Saved routes'),
    iconBtn('download', 'Export backup', () => { download('run-planner-backup.json', exportAll(), 'application/json'); }),
    iconBtn('upload', 'Import backup', () => file.click()),
    file,
  );
  const root = h('div', { class: 'view' }, head, list);

  function render() {
    const routes = listRoutes();
    if (!routes.length) {
      list.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'No saved routes yet'), 'Save a route you like and it lives here, on this device. Use the export button to back them up or move them to another device.'));
      return;
    }
    list.querySelector('.empty')?.remove();
    syncList(list, routes, (r) => r.id, (rec) => {
      const c = coordsOf(rec);
      const el = h('div', { class: 'card', tabindex: 0, onclick: (e) => { if (!e.target.closest('.rowact')) open(rec); } });
      el._c = c;
      return el;
    }, (el, rec) => {
      const name = h('input', { class: 'ctitle', value: rec.name, 'aria-label': 'Name', style: { border: 0, background: 'none', outline: 'none', width: '100%', padding: 0, font: 'inherit', fontWeight: 650 }, onclick: (e) => e.stopPropagation(), onchange: (e) => updateMeta(rec.id, { name: e.target.value }) });
      el.replaceChildren(h('div', { class: 'crow' },
        el._c.length > 1 ? thumb(el._c) : h('div', { class: 'thumb' }),
        h('div', { class: 'cinfo' }, name,
          h('div', { class: 'cstats' }, h('span', null, h('b', null, fmtDistShort(rec.dist))), h('span', null, '↑ ' + fmtElev(rec.gain)), h('span', null, new Date(rec.savedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })))),
        h('div', { class: 'rowact' },
          iconBtn('download', 'GPX', () => download(safeName(rec.name) + '.gpx', toGPX(rec.name, el._c), 'application/gpx+xml')),
          iconBtn('trash', 'Delete', () => { if (el.dataset.confirm) { deleteRoute(rec.id); render(); } else { el.dataset.confirm = '1'; toast('Click delete again to remove this route'); setTimeout(() => delete el.dataset.confirm, 3000); } }, 'danger'))));
    });
  }

  function open(rec) {
    const r = new Route();
    r.loadJSON(rec.data, { savedId: rec.id });
    r.name = rec.name;
    openEditor(r);
  }

  async function restore(e) {
    const f = e.target.files[0];
    if (!f) return;
    try {
      toast(`Imported ${importAll(await f.text())} route(s)`);
      render();
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  }

  render();
  return root;
}

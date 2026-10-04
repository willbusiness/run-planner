// The "find a run" screen: the brief (distance, time, pace, shape, terrain) and the suggested routes.
import { h, icon, seg, syncList, toast } from './dom.js';
import { settings, save, fmtTime, KM_PER_MI } from '../settings.js';
import { state, bus, briefChanged, select, hover } from '../app.js';
import { bank } from '../bank.js';
import { thumb, titleOf, statLine, surfaceBar, profileCanvas, analysisOf, timeOf } from './widgets.js';
import { routeFromRecord } from '../recroute.js';
import { saveRoute } from '../storage.js';
import { toGPX, download, safeName } from '../gpx.js';
import { openEditor } from './editor.js';
import { openStartMenu } from './startmenu.js';

const PRESETS = [5, 10, 15, 21.1, 30, 42.2];
const MIN_KM = 2;
const MAX_KM = 60;

// slider position (0..1000) <-> km. Most runs are 5-20 km, so that range gets most of the track.
const kmToPos = (km) => (km <= 20 ? ((km - 3) / 17) * 700 : 700 + ((km - 20) / 25) * 300);
const posToKm = (pos) => {
  const km = pos <= 700 ? 3 + (pos / 700) * 17 : 20 + ((pos - 700) / 300) * 25;
  return km < 20 ? Math.round(km * 2) / 2 : Math.round(km);
};

const mi = () => settings.units === 'mi';
const toDisp = (km) => (mi() ? km / KM_PER_MI : km);
const fromDisp = (v) => (mi() ? v * KM_PER_MI : v);
const fmtNum = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

function parseTime(text) {
  const parts = text.trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

const paceText = (secPerKm) => {
  const v = mi() ? secPerKm * KM_PER_MI : secPerKm;
  return `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;
};

export function buildFind() {
  const p = settings.prefs;

  // ---- distance hero ----
  const kmInput = h('input', { class: 'num', inputmode: 'decimal', 'aria-label': 'Distance', autocomplete: 'off' });
  const unit = h('span', { class: 'unit' });
  const range = h('input', { type: 'range', min: 0, max: 1000, step: 1, 'aria-label': 'Distance slider' });
  const slider = h('div', { class: 'slider' }, range);
  const chipEls = PRESETS.map((km) => h('button', { class: 'chip', type: 'button', onclick: () => setKm(km) }, fmtNum(toDisp(km))));
  const timeInput = h('input', { class: 'num', inputmode: 'numeric', 'aria-label': 'Time', autocomplete: 'off' });
  const paceInput = h('input', { class: 'num', inputmode: 'numeric', 'aria-label': 'Pace', autocomplete: 'off' });
  const paceLabel = h('small', null);

  function setKm(km, { fromSlider = false } = {}) {
    km = Math.min(MAX_KM, Math.max(MIN_KM, Math.round(km * 10) / 10));
    p.km = km;
    paint(fromSlider);
    briefChanged();
  }

  function paint(fromSlider = false) {
    if (document.activeElement !== kmInput) kmInput.value = fmtNum(toDisp(p.km));
    unit.textContent = mi() ? 'mi' : 'km';
    if (!fromSlider) range.value = kmToPos(p.km);
    slider.style.setProperty('--p', (kmToPos(p.km) / 1000) * 100 + '%');
    chipEls.forEach((c, i) => c.classList.toggle('on', Math.abs(PRESETS[i] - p.km) < 0.06));
    if (document.activeElement !== timeInput) timeInput.value = fmtTime(p.km * settings.pace);
    if (document.activeElement !== paceInput) paceInput.value = paceText(settings.pace);
    paceLabel.textContent = `Pace /${mi() ? 'mi' : 'km'}`;
  }

  range.addEventListener('input', () => setKm(posToKm(+range.value), { fromSlider: true }));
  kmInput.addEventListener('focus', () => kmInput.select());
  const commitKm = () => {
    const v = parseFloat(kmInput.value.replace(',', '.'));
    if (!Number.isNaN(v)) setKm(fromDisp(v));
    else paint();
  };
  kmInput.addEventListener('change', commitKm);
  kmInput.addEventListener('keydown', (e) => e.key === 'Enter' && kmInput.blur());
  kmInput.addEventListener('blur', paint);

  timeInput.addEventListener('focus', () => timeInput.select());
  timeInput.addEventListener('change', () => {
    const t = parseTime(timeInput.value);
    if (t && t > 120) setKm(t / settings.pace);
    else paint();
  });
  timeInput.addEventListener('keydown', (e) => e.key === 'Enter' && timeInput.blur());
  timeInput.addEventListener('blur', paint);
  paceInput.addEventListener('focus', () => paceInput.select());
  paceInput.addEventListener('change', () => {
    const t = parseTime(paceInput.value);
    if (t && t >= 120 && t <= 900) {
      settings.pace = mi() ? t / KM_PER_MI : t;
      save();
      bus.dispatchEvent(new Event('results'));
    }
    paint();
  });
  paceInput.addEventListener('keydown', (e) => e.key === 'Enter' && paceInput.blur());
  paceInput.addEventListener('blur', paint);

  const step = (d) => setKm(Math.round((p.km + d) * 2) / 2);
  const hero = h('div', { class: 'hero' },
    h('button', { class: 'step', type: 'button', 'aria-label': 'Shorter', onclick: () => step(-1) }, icon('minus')),
    h('div', { class: 'big' }, kmInput, unit),
    h('button', { class: 'step', type: 'button', 'aria-label': 'Longer', onclick: () => step(1) }, icon('plus')),
  );

  // ---- options ----
  const shape = seg([['loop', 'Loop', 'loop'], ['out&back', 'Out & back', 'outback']], p.shape, (v) => { p.shape = v; briefChanged(); });
  const surface = seg([['road', 'Roads'], ['mixed', 'Mixed'], ['trail', 'Trails']], p.surface, (v) => { p.surface = v; briefChanged(); });
  const hills = seg([['flat', 'Flat'], ['any', 'Any'], ['hilly', 'Hilly']], p.hills, (v) => { p.hills = v; briefChanged(); });

  const brief = h('div', { class: 'brief' },
    hero,
    slider,
    h('div', { class: 'chips' }, chipEls),
    h('div', { class: 'tp' },
      h('label', { class: 'field' }, h('small', null, 'Time'), timeInput),
      h('label', { class: 'field' }, paceLabel, paceInput),
    ),
    h('div', { class: 'opts' },
      h('div', { class: 'optrow' }, h('span', null, 'Shape'), shape),
      h('div', { class: 'optrow' }, h('span', null, 'Surface'), surface),
      h('div', { class: 'optrow' }, h('span', null, 'Hills'), hills),
    ),
  );

  // ---- results ----
  const status = h('div', { class: 'stat' });
  const title = h('h2', null, 'Routes for you');
  const note = h('div');
  const cards = h('div', { class: 'cards' });
  const skels = h('div', { class: 'cards' });
  const sumText = h('span', { class: 'sumtext' });
  const sum = h('button', { class: 'bsum', type: 'button', onclick: () => collapse(false) }, sumText, h('span', { class: 'adjust' }, 'Adjust'), icon('down', 16));
  const wrap = h('div', { class: 'bwrap' }, h('div', { class: 'bclip' }, brief));
  const collapse = (v) => {
    wrap.classList.toggle('collapsed', v);
    sum.hidden = !v;
  };
  sum.hidden = true;
  const tools = h('div', { class: 'tools' },
    h('button', { class: 'linkbtn', type: 'button', title: 'Draw your own route', onclick: () => openEditor(null) }, icon('pencil', 16), 'Draw'),
    h('button', { class: 'linkbtn', type: 'button', title: 'Find more routes like these', onclick: () => { bank.request(settings.prefs, 10); toast('Finding more routes…'); } }, icon('shuffle', 16)),
  );
  const root = h('div', { class: 'view find' }, sum, wrap, h('div', { class: 'rhead' }, title, status, tools), note, cards, skels);

  function createCard(r) {
    const body = h('div', { class: 'crow' });
    const el = h('div', {
      class: 'card', tabindex: 0,
      onclick: (e) => { if (!e.target.closest('.actions')) select(r.id, { user: true }); },
      onpointerenter: () => hover(r.id),
      onpointerleave: () => hover(null),
      onkeydown: (e) => e.key === 'Enter' && select(r.id),
    }, body);
    el._body = body;
    return el;
  }

  function updateCard(el, r) {
    const idx = state.results.indexOf(r);
    const base = titleOf(r, state.start);
    const dupes = state.results.slice(0, idx).filter((x) => titleOf(x, state.start) === base).length;
    const name = dupes ? `${base} ${dupes + 1}` : base;
    const sel = state.selectedId === r.id;
    el.classList.toggle('sel', sel);
    if (!el._thumb) { el._thumb = thumb(r.c); }
    const pathShare = r.kinds ? r.kinds.path / Math.max(1, r.dist) : 0;
    const tags = [
      idx === 0 ? h('span', { class: 'tag hi' }, 'Best match') : null,
      h('span', { class: 'tag' }, r.hills === 'flat' ? 'Flat' : r.hills === 'hilly' ? 'Hilly' : 'Rolling'),
      pathShare >= 0.3 ? h('span', { class: 'tag' }, Math.round(pathShare * 100) + '% paths') : null,
    ];
    el._body.replaceChildren(el._thumb, h('div', { class: 'cinfo' }, h('div', { class: 'ctitle' }, name), statLine({ dist: r.dist, time: timeOf(r), gain: r.gain }), h('div', { class: 'tags' }, tags)));
    if (sel && !el._detail) {
      el._detail = h('div', { class: 'detail' },
        profileCanvas(analysisOf(r), r.c),
        surfaceBar(r.surf, r.kinds),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary grow', type: 'button', onclick: () => openEditor(routeFromRecord(r, name)) }, icon('pencil', 18), 'Edit route'),
          h('button', { class: 'btn', type: 'button', title: 'Save to My routes', onclick: () => { saveRoute(routeFromRecord(r, name), r); toast('Saved to My routes'); } }, icon('bookmark', 18), 'Save'),
          h('button', { class: 'btn', type: 'button', title: 'Download GPX', onclick: () => download(safeName(name) + '.gpx', toGPX(name, r.c), 'application/gpx+xml') }, icon('download', 18)),
        ),
      );
      el.append(el._detail);
    } else if (!sel && el._detail) {
      el._detail.remove();
      el._detail = null;
    }
  }

  function render() {
    paint();
    sumText.textContent = `${fmtNum(toDisp(p.km))} ${mi() ? 'mi' : 'km'} · ${p.shape === 'loop' ? 'Loop' : 'Out & back'} · ${{ road: 'Roads', mixed: 'Mixed', trail: 'Trails' }[p.surface]} · ${{ flat: 'Flat', any: 'Any hills', hilly: 'Hilly' }[p.hills]}`;
    const list = state.results;
    syncList(cards, list, (r) => r.id, createCard, updateCard);
    const busy = bank.busy;
    skels.replaceChildren(...(list.length === 0 && busy ? [1, 2, 3].map(() => h('div', { class: 'skel' })) : []));
    status.replaceChildren(busy ? h('span', { class: 'spin' }) : '', busy ? (list.length ? 'Finding more…' : 'Finding routes…') : `${list.length} route${list.length === 1 ? '' : 's'}`);
    note.replaceChildren(
      ...(!settings.home ? [h('div', { class: 'note' }, h('span', { style: { flex: 1 } }, 'Set your own start and your routes will be ready the moment you open the app.'), h('button', { class: 'btn sm', type: 'button', onclick: () => openStartMenu(document.querySelector('.startpill')) }, 'Choose'))] : []),
      ...(bank.error ? [h('div', { class: 'note err' }, 'The free routing server is busy. Retrying in a moment…')] : []),
      ...(list.length === 0 && !busy && !bank.error ? [h('div', { class: 'empty' }, h('b', null, 'No routes at this distance yet'), 'Try a different distance or surface, or tap More.')] : []),
    );
  }

  const updateOnly = () => {
    for (const el of cards.children) el.classList.toggle('sel', el.dataset.key === state.selectedId);
  };
  bus.addEventListener('results', render);
  bus.addEventListener('mode', () => state.mode === 'find' && render());
  bus.addEventListener('select', () => {
    if (state.userPicked) collapse(true);
    render();
    cards.querySelector('.card.sel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  bus.addEventListener('hover', updateOnly);
  render();
  root.refresh = render;
  return root;
}

// GPX export/import and file download helper.
const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function toGPX(name, coords) {
  const pts = coords
    .map((c) => `<trkpt lat="${c[0].toFixed(6)}" lon="${c[1].toFixed(6)}">${c[2] != null ? `<ele>${c[2].toFixed(1)}</ele>` : ''}</trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Run Planner" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(name)}</name></metadata>
<trk><name>${esc(name)}</name><trkseg>
${pts}
</trkseg></trk>
</gpx>`;
}

export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That file is not valid GPX.');
  let nodes = [...doc.querySelectorAll('trkpt')];
  if (!nodes.length) nodes = [...doc.querySelectorAll('rtept')];
  const coords = nodes.map((n) => {
    const ele = n.querySelector('ele');
    return [+n.getAttribute('lat'), +n.getAttribute('lon'), ele ? +ele.textContent : null];
  });
  if (coords.length < 2) throw new Error('No track found in that GPX file.');
  return { name: doc.querySelector('trk > name, metadata > name')?.textContent || '', coords };
}

export function download(filename, text, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (s) => (s || 'route').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'route';

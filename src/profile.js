// Canvas elevation profile, coloured by gradient, with touch/mouse scrubbing.
import { settings, KM_PER_MI } from './settings.js';

function gradeColor(g) {
  if (g > 8) return '#d7263d';
  if (g > 4) return '#f46036';
  if (g > 1.5) return '#f2b134';
  if (g > -1.5) return '#5fb878';
  if (g > -5) return '#4aa3df';
  return '#2d6cdf';
}

/**
 * Draws `an` (from analyze()) into `canvas`. Returns {destroy}. `onScrub(index|null)` fires as the
 * user moves over the chart; index is into an.d / an.e.
 */
export function drawProfile(canvas, an, { onScrub, compact = false } = {}) {
  const ctx = canvas.getContext('2d');
  let scrub = null;

  function render() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = an.d.length;
    if (n < 2) return;
    const css = getComputedStyle(canvas);
    const ink = css.getPropertyValue('--ink-2').trim() || '#667';
    const grid = css.getPropertyValue('--line').trim() || '#ddd';

    const padL = compact ? 2 : 34, padR = 4, padT = 6, padB = compact ? 2 : 16;
    const min = Math.floor(an.min / 10) * 10 - 5;
    const rawMax = Math.ceil(an.max / 10) * 10 + 5;
    const max = Math.max(rawMax, min + 30); // keep flat routes looking flat
    const X = (m) => padL + (m / an.dist) * (w - padL - padR);
    const Y = (e) => padT + (1 - (e - min) / (max - min)) * (h - padT - padB);

    if (!compact) {
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = ink;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.textAlign = 'right';
      const stepE = (max - min) > 120 ? 50 : (max - min) > 50 ? 20 : 10;
      for (let e = Math.ceil(min / stepE) * stepE; e <= max; e += stepE) {
        ctx.beginPath();
        ctx.moveTo(padL, Y(e) + 0.5);
        ctx.lineTo(w - padR, Y(e) + 0.5);
        ctx.stroke();
        ctx.fillText(e + '', padL - 4, Y(e) + 3);
      }
      ctx.textAlign = 'center';
      const unit = settings.units === 'mi' ? KM_PER_MI * 1000 : 1000;
      const totalU = an.dist / unit;
      const stepD = totalU > 30 ? 5 : totalU > 12 ? 2 : totalU > 5 ? 1 : 0.5;
      for (let u = stepD; u < totalU; u += stepD) ctx.fillText(u + '', X(u * unit), h - 3);
    }

    // coloured columns, one per ~2 samples
    const stride = Math.max(1, Math.floor(n / (w / 2)));
    for (let i = 0; i < n - 1; i += stride) {
      const j = Math.min(n - 1, i + stride);
      const x0 = X(an.d[i]), x1 = X(an.d[j]);
      ctx.fillStyle = gradeColor(an.g[i]) + 'cc';
      ctx.beginPath();
      ctx.moveTo(x0, h - padB);
      ctx.lineTo(x0, Y(an.e[i]));
      ctx.lineTo(x1 + 0.5, Y(an.e[j]));
      ctx.lineTo(x1 + 0.5, h - padB);
      ctx.fill();
    }
    ctx.strokeStyle = css.getPropertyValue('--ink').trim() || '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i += stride) ctx[i ? 'lineTo' : 'moveTo'](X(an.d[i]), Y(an.e[i]));
    ctx.stroke();

    if (scrub != null) {
      const x = X(an.d[scrub]);
      ctx.strokeStyle = css.getPropertyValue('--ink').trim() || '#222';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, h - padB);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, Y(an.e[scrub]), 4, 0, 7);
      ctx.fill();
      ctx.stroke();
    }
    canvas._scale = { padL, padR };
  }

  function indexAt(ev) {
    const r = canvas.getBoundingClientRect();
    const { padL, padR } = canvas._scale || { padL: 0, padR: 0 };
    const t = Math.min(1, Math.max(0, (ev.clientX - r.left - padL) / (r.width - padL - padR)));
    return Math.round(t * (an.d.length - 1));
  }

  const move = (ev) => {
    if (an.d.length < 2) return;
    scrub = indexAt(ev);
    render();
    onScrub?.(scrub);
  };
  const leave = () => {
    scrub = null;
    render();
    onScrub?.(null);
  };
  if (onScrub) {
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); move(ev); });
    canvas.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') leave(); });
    canvas.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') leave(); });
    canvas.addEventListener('pointercancel', leave);
    canvas.style.touchAction = 'none';
  }
  const ro = new ResizeObserver(render);
  ro.observe(canvas);
  render();
  return { destroy: () => ro.disconnect() };
}

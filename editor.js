/* ============================================================================
   SPARK phase editor: mark rest, stressor and recovery windows by dragging rectangles over the RR tachogram.
   - choose a type, then drag across the plot (the window snaps to beats; a new window overwrites what it covers);
   - drag the edge of a window to adjust it (a shared edge between two touching windows moves both);
   - click a window to select it; the list below gives exact times (m:ss or seconds), type and delete;
   - "Start from detected" copies the automatic detection as editable windows; "Clear" returns to automatic detection.
   The editor does not own the windows: the app does (api.getWindows / api.setWindows).
   ========================================================================== */
(function (root) {
'use strict';
const doc = root.document, E = root.SparkEngine, C = root.SparkCharts;
const KINDS = [['rest', 'Rest'], ['stressor', 'Stressor'], ['recovery', 'Recovery']];
let api = null, panel = null, card = null, canvas = null, active = false, tool = 'stressor', sel = -1, drag = null, hover = null;
const MIN_NEW = 10, GRAB = 7;                                    // seconds, pixels

const mmss = s => { const m = Math.floor(s / 60), r = Math.round(s - m * 60); return m + ':' + String(r === 60 ? 0 : r).padStart(2, '0'); };
function parseTime(str) {
  const t = String(str).trim(); if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const m = /^(\d+):([0-5]?\d(\.\d+)?)$/.exec(t); return m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) : NaN;
}
const windows = () => (api.getWindows() || []).map(w => ({ kind: w.kind, from: w.from, to: w.to }));
const colorsOf = ws => C.segColors({ segments: ws });
const chart = () => C.chartFor('rr');
function times() { const b = C.bundle(); return b ? b.fit.time : []; }
/** Snap to the nearest beat time. */
function snap(t) { const T = times(); if (!T.length) return t; let lo = 0, hi = T.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; T[m] < t ? lo = m + 1 : hi = m; } const k = lo > 0 && Math.abs(T[lo - 1] - t) < Math.abs(T[lo] - t) ? lo - 1 : lo; return Math.max(0, Math.min(T[T.length - 1], T[k])); }
const duration = () => { const T = times(); return T.length ? T[T.length - 1] : 0; };
function tAt(ev) { const ch = chart(), r = canvas.getBoundingClientRect(); return { t: ch.scales.x.getValueForPixel(ev.clientX - r.left), px: ev.clientX - r.left, py: ev.clientY - r.top }; }
let cur = null;                                                  // the chart being drawn (the registry entry does not exist yet while a chart is being built)
const xPx = t => (cur || chart()).scales.x.getPixelForValue(t);

/* ---- overlay drawn by the chart plugin ------------------------------------------------------------------------------------------------ */
function overlay(ch) {
  if (!active || !api) return; cur = ch; const ctx = ch.ctx, ca = ch.chartArea, ws = windows(), cols = colorsOf(ws), light = doc.documentElement.dataset.theme === 'light'; const font = Chart.defaults.font.family;
  ctx.save(); ctx.beginPath(); ctx.rect(ca.left - 8, ca.top, ca.right - ca.left + 16, ca.bottom - ca.top); ctx.clip();
  ws.forEach((w, i) => {
    const x0 = xPx(w.from), x1 = xPx(w.to), on = i === sel, col = cols[i];
    ctx.strokeStyle = col; ctx.lineWidth = on ? 2.2 : 1.3; ctx.setLineDash(on ? [] : [5, 3]); ctx.strokeRect(x0 + 0.5, ca.top + 1, x1 - x0 - 1, ca.bottom - ca.top - 2); ctx.setLineDash([]);
    [x0, x1].forEach(x => { ctx.fillStyle = col; ctx.fillRect(x - 2.5, (ca.top + ca.bottom) / 2 - 11, 5, 22); });            // grips on the edges
    if (x1 - x0 > 60) { ctx.fillStyle = col; ctx.font = `600 10px ${font}`; ctx.textAlign = 'left'; ctx.fillText(`${w.kind[0].toUpperCase()}${w.kind.slice(1)}  ${mmss(w.from)}–${mmss(w.to)}`, x0 + 6, ca.bottom - 7); }
  });
  if (drag && drag.type === 'new') {
    const col = colorsOf([{ kind: tool, from: 0, to: 1 }])[0], xa = Math.min(drag.px0, drag.px1), xb = Math.max(drag.px0, drag.px1), ya = Math.min(drag.py0, drag.py1), yb = Math.max(drag.py0, drag.py1);
    ctx.fillStyle = col + '2E'; ctx.fillRect(xa, ya, xb - xa, yb - ya); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.strokeRect(xa + 0.5, ya + 0.5, xb - xa, yb - ya); ctx.setLineDash([]);
    const a = Math.min(drag.t0, drag.t1), b = Math.max(drag.t0, drag.t1); ctx.fillStyle = col; ctx.font = `700 10.5px ${font}`; ctx.textAlign = 'left';
    ctx.fillText(`${tool[0].toUpperCase()}${tool.slice(1)}  ${mmss(a)}–${mmss(b)}  (${Math.round(b - a)} s)`, xa + 6, Math.max(ya + 13, ca.top + 13));
  }
  ctx.restore();
}
const redraw = () => { const ch = chart(); if (ch) ch.draw(); };

/* ---- pointer interaction ----------------------------------------------------------------------------------------------------------------- */
function edgeAt(px, py) {
  const ch = chart(), ca = ch.chartArea; if (Math.abs(py - (ca.top + ca.bottom) / 2) > 26) return null;      // edges are grabbed at their grips (middle of the plot); elsewhere a drag starts a new window
  const ws = windows();
  for (let i = 0; i < ws.length; i++) for (const side of ['from', 'to']) if (Math.abs(xPx(ws[i][side]) - px) <= GRAB) return { i, side };
  return null;
}
function onDown(ev) {
  if (!active || !api || !chart() || ev.button > 0) return; const p = tAt(ev), ca = chart().chartArea; if (p.px < ca.left - 4 || p.px > ca.right + 4 || p.py < ca.top || p.py > ca.bottom) return;
  ev.preventDefault(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture(ev.pointerId);
  const edge = edgeAt(p.px, p.py);
  if (edge) { const ws = windows(), w = ws[edge.i], other = ws.findIndex((o, j) => j !== edge.i && Math.abs(o[edge.side === 'from' ? 'to' : 'from'] - w[edge.side]) < 0.75); drag = { type: 'edge', ...edge, other, ws, moved: false }; sel = edge.i; }
  else drag = { type: 'new', t0: snap(p.t), t1: snap(p.t), px0: p.px, py0: p.py, px1: p.px, py1: p.py };
  redraw();
}
function onMove(ev) {
  if (!active || !api || !chart()) return; const p = tAt(ev);
  if (!drag) { const e = edgeAt(p.px, p.py); canvas.style.cursor = e ? 'ew-resize' : 'crosshair'; return; }
  if (drag.type === 'new') { drag.t1 = snap(Math.max(0, Math.min(duration(), p.t))); drag.px1 = p.px; drag.py1 = p.py; }
  else {
    const ws = drag.ws, i = drag.i, w = ws[i], t = snap(Math.max(0, Math.min(duration(), p.t))), prevTo = ws.filter((o, j) => j !== i && o.to <= w.from + 1e-6).reduce((m, o) => Math.max(m, o.to), 0), nextFrom = ws.filter((o, j) => j !== i && o.from >= w.to - 1e-6).reduce((m, o) => Math.min(m, o.from), duration());
    if (drag.side === 'from') { const lo = drag.other >= 0 ? ws[drag.other].from + 5 : prevTo, v = Math.min(Math.max(t, lo), w.to - 5); drag.moved = drag.moved || Math.abs(v - w.from) > 1e-6; w.from = v; if (drag.other >= 0) ws[drag.other].to = v; }
    else { const hi = drag.other >= 0 ? ws[drag.other].to - 5 : nextFrom, v = Math.max(Math.min(t, hi), w.from + 5); drag.moved = drag.moved || Math.abs(v - w.to) > 1e-6; w.to = v; if (drag.other >= 0) ws[drag.other].from = v; }
    api.preview(ws);
  }
  redraw();
}
function onUp(ev) {
  if (!drag) return; const d = drag; drag = null; try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  if (d.type === 'new') {
    const a = Math.min(d.t0, d.t1), b = Math.max(d.t0, d.t1);
    if (b - a >= MIN_NEW) { const ws = E.paintWindow(windows(), { kind: tool, from: a, to: b }); sel = ws.findIndex(w => w.kind === tool && Math.abs(w.from - a) < 1e-6 && Math.abs(w.to - b) < 1e-6); api.setWindows(ws); }
    else { const t = d.t0, ws = windows(); sel = ws.findIndex(w => t >= w.from && t <= w.to); render(); redraw(); }
  } else if (d.moved) { api.setWindows(d.ws.filter(w => w.to - w.from >= 5)); } else { api.preview(null); render(); redraw(); }
}
function onKey(ev) {
  if (!active) return;
  if (ev.key === 'Escape' && drag) { drag = null; api.preview(null); redraw(); ev.stopPropagation(); }
  else if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel >= 0) { ev.preventDefault(); removeAt(sel); }
}
function removeAt(i) { const ws = windows(); ws.splice(i, 1); sel = -1; api.setWindows(ws.length ? ws : null); }

/* ---- panel ------------------------------------------------------------------------------------------------------------------------------------ */
function build() {
  panel = doc.createElement('div'); panel.className = 'pe'; panel.hidden = true; panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Phase editor');
  panel.innerHTML = `<div class="pe-row"><div class="pe-seg" role="radiogroup" aria-label="Phase type to draw">${KINDS.map(([k, l]) => `<button type="button" role="radio" data-kind="${k}" aria-checked="false"><i class="dot"></i>${l}</button>`).join('')}</div>
      <span class="pe-hint">Pick a type, then drag a rectangle across the plot. To adjust a window, drag the grip on its edge (middle of the plot); click a window to select it.</span>
      <div class="pe-actions"><button type="button" class="btn btn-ghost" data-do="detected">Start from detected</button><button type="button" class="btn btn-ghost" data-do="clear">Clear</button><button type="button" class="btn btn-primary" data-do="done">Done</button></div></div>
    <div class="pe-list" role="list"></div><div class="pe-status" aria-live="polite"></div>`;
  card.querySelector('.cc-head').after(panel);
  panel.addEventListener('click', ev => {
    const k = ev.target.closest('[data-kind]'); if (k) { tool = k.dataset.kind; render(); return; }
    const d = ev.target.closest('[data-do]'); if (d) { const a = d.dataset.do; if (a === 'done') close(); else if (a === 'clear') { sel = -1; api.setWindows(null); } else if (a === 'detected') { const det = api.getDetected(); if (!det) api.toast('No phase change was detected automatically: draw the windows, or raise the detection sensitivity in Settings → Phases.', 'warn', 5000); else { sel = -1; api.setWindows(det); } } return; }
    const del = ev.target.closest('[data-del]'); if (del) removeAt(+del.dataset.del);
    const row = ev.target.closest('.pe-item'); if (row && !ev.target.closest('input,select,button')) { sel = +row.dataset.i; render(); redraw(); }
  });
  panel.addEventListener('change', ev => {
    const row = ev.target.closest('.pe-item'); if (!row) return; const i = +row.dataset.i, ws = windows(), w = ws[i], f = ev.target.dataset.f;
    if (f === 'kind') { w.kind = ev.target.value; api.setWindows(ws); return; }
    const v = parseTime(ev.target.value), others = ws.filter((_, j) => j !== i), n = { kind: w.kind, from: f === 'from' ? v : w.from, to: f === 'to' ? v : w.to };
    if (!isFinite(v) || n.to - n.from < 5 || n.from < 0 || n.to > duration() + 1e-6) { ev.target.classList.add('bad'); api.toast('Times must be within the recording, and the window at least 5 s long (m:ss or seconds).', 'warn'); render(); return; }
    sel = -1; api.setWindows(E.paintWindow(others, n));
  });
  canvas = doc.getElementById('chart-rr'); canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('keydown', onKey);
}
/** (Re)draw the window list and the controls. */
function render() {
  if (!panel) return; const ws = windows(), cols = colorsOf(ws), ev = api.getPhases();
  panel.querySelectorAll('[data-kind]').forEach(b => { const on = b.dataset.kind === tool; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.querySelector('.dot').style.background = colorsOf([{ kind: b.dataset.kind }])[0]; });
  panel.querySelector('.pe-list').innerHTML = ws.length ? ws.map((w, i) => `<div class="pe-item${i === sel ? ' sel' : ''}" role="listitem" data-i="${i}"><i class="dot" style="background:${cols[i]}"></i>
      <select data-f="kind" aria-label="Type of window ${i + 1}">${KINDS.map(([k, l]) => `<option value="${k}"${k === w.kind ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input data-f="from" value="${mmss(w.from)}" aria-label="Start of window ${i + 1}" size="6"><span class="pe-dash">–</span><input data-f="to" value="${mmss(w.to)}" aria-label="End of window ${i + 1}" size="6"><span class="pe-dur">${Math.round(w.to - w.from)} s</span>
      <button type="button" class="tool" data-del="${i}" title="Delete this window" aria-label="Delete window ${i + 1}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('') : '<div class="pe-empty">No windows yet.</div>';
  panel.querySelector('.pe-status').textContent = ws.length ? `Your ${ws.length} window${ws.length > 1 ? 's' : ''} define the phases; automatic detection is paused. Beats outside the windows belong to no phase.`
    : ev ? `Phases come from ${ev.source === 'auto' ? 'automatic detection' : 'the typed markers'} (${ev.segments.length}). Drawing a window replaces them; “Start from detected” copies them here for editing.` : 'No phases yet. Draw the windows, or use “Start from detected”.';
  panel.querySelector('[data-do="clear"]').disabled = !ws.length;
  const b = card.querySelector('[data-act="phases"]'); if (b) b.setAttribute('aria-pressed', active ? 'true' : 'false');
}
function open() { if (!panel) return; active = true; panel.hidden = false; card.classList.add('pe-on'); if (canvas) { canvas.style.cursor = 'crosshair'; canvas.style.touchAction = 'none'; } render(); redraw(); api.focusCard && api.focusCard(); }
function close() { active = false; drag = null; if (panel) panel.hidden = true; if (card) card.classList.remove('pe-on'); if (canvas) { canvas.style.cursor = ''; canvas.style.touchAction = ''; } const b = card && card.querySelector('[data-act="phases"]'); if (b) b.setAttribute('aria-pressed', 'false'); redraw(); }
const toggle = () => active ? close() : open();

/** api: {getWindows, setWindows(ws|null), preview(ws|null), getDetected(), getPhases(), toast(msg, kind, ms)} */
function init(a) {
  api = a; card = doc.querySelector('.cc[data-chart="rr"]'); if (!card) return; build();
  doc.addEventListener('spark:card', ev => { if (ev.detail.id === 'rr' && ev.detail.act === 'phases') toggle(); });
}
root.SparkPhaseEditor = { init, open, close, toggle, render, overlay, isActive: () => active, setTool: k => { tool = k; render(); }, select: i => { sel = i; render(); redraw(); } };
})(typeof window !== 'undefined' ? window : globalThis);

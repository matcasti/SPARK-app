/* ============================================================================
   SPARK charts. A registry of cards (title, description, tab, size, builder).
   mountCards() creates the cards once; buildAll(R) redraws them for a result bundle
   R = {fit, rep, dm, diag, psd, hrvObs, hrvFlt, roll, land, events, phases}.
   One visual language for every chart: hairline value-axis grid, no tick marks, rounded legends,
   index tooltips with a crosshair, gradient areas, m:ss time axes and (when phases are known) shaded
   rest / exercise / recovery bands. Colours, line width, bands, grid, thinning and palette are settings.
   ========================================================================== */
(function (root) {
'use strict';
const E = root.SparkEngine, ST = root.SparkSettings, doc = root.document;
const _ch = {};                       // Chart.js instances by card id
let _bundle = null;
const FONT = "Inter, ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif";

/* ---- theme helpers -------------------------------------------------------------------------------------------------- */
const raw = (v, fb) => root.getComputedStyle(doc.documentElement).getPropertyValue(v).trim() || fb;
function hex6(v) {
  v = String(v || '').trim(); let m;
  if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v))) return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if ((m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v))) return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('');
  return '#888888';
}
const css = v => hex6(raw(v, ''));
const isLight = () => doc.documentElement.dataset.theme === 'light';
function tc() { return { tx1: css('--tx1'), tx2: css('--tx2'), tx3: css('--tx3'), bd: css('--bd'), s0: css('--s0'), s1: css('--s1'), acc: css('--acc'), teal: css('--teal'), red: css('--red'), grn: css('--grn'), amb: css('--amb'), pur: css('--pur') }; }
const gridColor = () => isLight() ? 'rgba(15,27,45,.075)' : 'rgba(160,185,225,.11)';
const withA = (hex, a) => hex6(hex) + a;                          // '#rrggbb' + 2-digit alpha
const cfgC = () => ST.get('charts');
/** Colours of the phases of a recording: rest blue, each stressor its own warm/cool hue, recoveries green. `ev` = {segments}. */
const STRESSOR_COLORS = { dark: ['#FFA24D', '#F472B6', '#FACC15', '#38BDF8'], light: ['#E8761A', '#D946A8', '#C79A06', '#0284C7'] };
function segColors(ev) {
  const light = isLight(), pal = STRESSOR_COLORS[light ? 'light' : 'dark'], rest = light ? '#2F6FE4' : '#5B9CFF', rec = light ? '#14976A' : '#39D69B'; let si = 0;
  return ev.segments.map(s => s.kind === 'rest' ? rest : s.kind === 'recovery' ? rec : pal[(si++) % pal.length]);
}
/** Index of the phase a time belongs to, or -1 when it lies in a gap between windows drawn by the user. */
function segIndexAt(t, ev) { const S = ev.segments; for (let i = S.length - 1; i >= 0; i--) if (t >= S[i].from) return t <= S[i].to + 1e-6 ? i : -1; return -1; }
const NEUTRAL = '#8A97AD';

/** Chart.js can run a debounced resize / update on a chart that has just been destroyed (we rebuild charts often); that throws inside the library. Make those calls harmless. */
function guardChartJs() {
  const P = root.Chart && root.Chart.prototype; if (!P || P.__sparkGuard) return; P.__sparkGuard = true;
  ['update', 'resize', 'draw', 'render', 'reset'].forEach(m => { const f = P[m]; if (typeof f === 'function') P[m] = function (...a) { return this.canvas ? f.apply(this, a) : undefined; }; });
}
function chartDefaults() {
  if (!root.Chart) return; guardChartJs(); const c = tc(), light = isLight();
  Chart.defaults.color = c.tx2; Chart.defaults.borderColor = c.bd; Chart.defaults.font.family = FONT; Chart.defaults.font.size = 11;
  Chart.defaults.elements.line.borderJoinStyle = 'round'; Chart.defaults.elements.line.borderCapStyle = 'round'; Chart.defaults.elements.point.hitRadius = 7; Chart.defaults.elements.point.borderWidth = 0;
  Chart.defaults.interaction = { mode: 'index', intersect: false };
  const tt = Chart.defaults.plugins.tooltip;
  Object.assign(tt, { backgroundColor: light ? 'rgba(15,27,45,.95)' : 'rgba(7,11,20,.96)', titleColor: '#EAF1FC', bodyColor: '#C9D6EC', borderColor: light ? 'rgba(255,255,255,.12)' : 'rgba(120,150,205,.28)', borderWidth: 1,
    cornerRadius: 9, padding: 10, boxPadding: 4, usePointStyle: true, caretSize: 5, titleFont: { family: FONT, weight: '600', size: 11.5 }, bodyFont: { family: FONT, size: 11 }, filter: it => !!it.dataset.label });
  const lg = Chart.defaults.plugins.legend; lg.position = 'top'; lg.align = 'start';
  Object.assign(lg.labels, { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, boxHeight: 7, padding: 14, font: { family: FONT, size: 11 }, color: c.tx2 });
  // solid legend markers in the series colour (line datasets have no fill of their own)
  if (!lg.labels._orig) lg.labels._orig = lg.labels.generateLabels;
  lg.labels.generateLabels = ch => lg.labels._orig(ch).map(l => { const ds = ch.data.datasets[l.datasetIndex]; if (ds && typeof ds.borderColor === 'string' && ds.borderColor !== 'transparent') { l.fillStyle = ds.borderColor; l.strokeStyle = ds.borderColor; } return l; });
}

/* ---- formatting and axes ----------------------------------------------------------------------------------------------- */
const fmt = (x, d) => isFinite(x) ? x.toFixed(d == null ? 3 : d) : '—';
const fmtT = (v, span) => { if (span >= 180) { const m = Math.floor(v / 60), s = Math.round(v - m * 60); return m + ':' + String(s === 60 ? 0 : s).padStart(2, '0'); } return String(Math.round(v * 10) / 10); };
const niceStep = span => [1, 2, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600].find(s => s >= span / 7) || 3600;
function deepMerge(a, b) { const o = Object.assign({}, a); for (const k of Object.keys(b || {})) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && typeof a[k] === 'object' && a[k] !== null) ? deepMerge(a[k], b[k]) : b[k]; return o; }
function axisBase(title, o, isY) {
  const c = tc(), show = cfgC().showGrid;
  return deepMerge({ title: { display: !!title, text: title, color: c.tx2, font: { family: FONT, size: 11, weight: '500' }, padding: { top: isY ? 0 : 8, bottom: isY ? 8 : 0 } },
    ticks: { color: c.tx3, padding: isY ? 8 : 6, font: { family: FONT, size: 10.5 }, maxTicksLimit: 8 }, grid: isY ? { color: show ? gridColor() : 'transparent', drawTicks: false } : { display: false, drawTicks: false },
    border: { display: !isY, color: gridColor() } }, o);
}
const axisX = (title, o) => axisBase(title, o, false), axisY = (title, o) => axisBase(title, o, true);
/** Scatter / log axes: light grid on both. */
const axisXY = (title, o) => axisBase(title, deepMerge({ grid: { display: cfgC().showGrid, color: gridColor(), drawTicks: false }, border: { display: false } }, o), true);
function timeAxis(R) {
  const T = R.fit.time, span = T[T.length - 1] - T[0];
  return axisX(span >= 180 ? 'Time (min:s)' : 'Time (s)', { type: 'linear', min: 0, max: Math.ceil(T[T.length - 1]), ticks: { stepSize: niceStep(span), callback: v => fmtT(v, span), maxTicksLimit: 14 } });
}
const spanOf = R => R.fit.time[R.fit.time.length - 1] - R.fit.time[0];

/* ---- series helpers ---------------------------------------------------------------------------------------------------- */
function thinIdx(n) { const m = cfgC().maxPoints; if (!m || n <= m) return null; const step = Math.ceil(n / m), idx = []; for (let i = 0; i < n; i += step) idx.push(i); return idx; }
const pick = (a, idx) => idx ? idx.map(i => a[i]) : Array.from(a);
const xy = (t, y, idx) => { const n = idx ? idx.length : t.length, o = new Array(n); for (let i = 0; i < n; i++) { const k = idx ? idx[i] : i; o[i] = { x: t[k], y: y[k] }; } return o; };
const ln = (label, data, color, o) => Object.assign({ label, data, parsing: false, normalized: true, borderColor: color, backgroundColor: color, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color, borderWidth: cfgC().lineWidth }, o);
const band = (hi, lo, color) => [{ label: '', data: hi, borderColor: 'transparent', backgroundColor: color, pointRadius: 0, fill: false, order: 9 }, { label: '', data: lo, borderColor: 'transparent', backgroundColor: color, pointRadius: 0, fill: '-1', order: 9 }];
function gradient(color, a0, a1) { return cx => { const ch = cx.chart, ca = ch.chartArea; if (!ca) return withA(color, '22'); const g = ch.ctx.createLinearGradient(0, ca.top, 0, ca.bottom); g.addColorStop(0, withA(color, a0 || '55')); g.addColorStop(1, withA(color, a1 || '03')); return g; }; }
/* Filled shapes are drawn by two tiny plugins instead of Chart.js' fill machinery (which costs 60-100 ms per chart for ~1000 points):
   one path, one fill, no dataset elements. They draw under the datasets and are clipped to the plot area. */
/** Band between two curves sharing x: {x, hi, lo}. */
const bandPlugin = (id, b, color) => ({ id, beforeDatasetsDraw(ch) {
  const n = b.x.length, xs = ch.scales.x, ys = ch.scales.y, ca = ch.chartArea, ctx = ch.ctx; if (!n || !xs || !ys) return;
  ctx.save(); ctx.beginPath(); ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top); ctx.clip(); ctx.beginPath();
  for (let i = 0; i < n; i++) { const px = xs.getPixelForValue(b.x[i]), py = ys.getPixelForValue(b.hi[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(xs.getPixelForValue(b.x[i]), ys.getPixelForValue(b.lo[i]));
  ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore(); } });
/** Area under a curve down to a baseline ('bottom' of the plot, or a y value) with a vertical gradient. pts: [{x, y}]. */
const areaPlugin = (id, pts, color, base, a0, a1) => ({ id, beforeDatasetsDraw(ch) {
  const n = pts.length, xs = ch.scales.x, ys = ch.scales.y, ca = ch.chartArea, ctx = ch.ctx; if (n < 2 || !xs || !ys) return;
  const b = base === 'bottom' ? ca.bottom : Math.max(ca.top, Math.min(ca.bottom, ys.getPixelForValue(base || 0))), g = ctx.createLinearGradient(0, ca.top, 0, ca.bottom); g.addColorStop(0, withA(color, a0 || '55')); g.addColorStop(1, withA(color, a1 || '03'));
  ctx.save(); ctx.beginPath(); ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top); ctx.clip(); ctx.beginPath(); ctx.moveTo(xs.getPixelForValue(pts[0].x), b);
  for (let i = 0; i < n; i++) ctx.lineTo(xs.getPixelForValue(pts[i].x), ys.getPixelForValue(pts[i].y));
  ctx.lineTo(xs.getPixelForValue(pts[n - 1].x), b); ctx.closePath(); ctx.fillStyle = g; ctx.fill(); ctx.restore(); } });
function mk(id, cfg) {
  destroyChart(id); const cv = doc.getElementById('chart-' + id); if (!cv || !root.Chart) return null;
  if (!cfg.options) cfg.options = baseOpts(); _ch[id] = new Chart(cv, cfg); return _ch[id];
}
function destroyChart(id) { if (_ch[id]) { _ch[id].destroy(); delete _ch[id]; } }
function setEmpty(id, msg) { const b = doc.querySelector(`.cc[data-chart="${id}"] .cc-body`); if (b) b.innerHTML = `<div class="empty-card">${msg}</div>`; }
function ensureCanvas(id) { const b = doc.querySelector(`.cc[data-chart="${id}"] .cc-body`); if (b && !b.querySelector('canvas') && !b.classList.contains('auto')) b.innerHTML = `<canvas id="chart-${id}"></canvas>`; }
function baseOpts(extra) {
  return deepMerge({ responsive: true, resizeDelay: 120, maintainAspectRatio: false, animation: false, layout: { padding: { top: 2, right: 6, bottom: 0, left: 0 } }, plugins: { legend: { labels: { filter: it => it.text !== '' } } }, scales: { x: axisX(), y: axisY() } }, extra || {});
}
/** Options for a time-series chart: time axis, index tooltip with time title, optional unit. */
function timeOpts(R, ytitle, extra) {
  const span = spanOf(R);
  return baseOpts(deepMerge({ scales: { x: timeAxis(R), y: axisY(ytitle) }, plugins: { tooltip: { callbacks: { title: it => 't = ' + fmtT(it[0].parsed.x, span) + (span >= 180 ? ' min:s' : ' s'), label: c => ` ${c.dataset.label}: ${Number(c.parsed.y).toPrecision(4)}` } } } }, extra || {}));
}

/* ---- plugins ---------------------------------------------------------------------------------------------------------- */
const crosshair = { id: 'crosshair', afterDatasetsDraw(ch) {
  const act = ch.tooltip && ch.tooltip._active; if (!act || !act.length) return; const x = act[0].element.x, ca = ch.chartArea, ctx = ch.ctx;
  ctx.save(); ctx.strokeStyle = isLight() ? 'rgba(15,27,45,.28)' : 'rgba(200,220,255,.30)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, ca.top); ctx.lineTo(x, ca.bottom); ctx.stroke(); ctx.restore(); } };
/** Shaded phase bands (rest, stressors, recoveries) behind a time-series chart, labelled at the top when wide enough. */
function phasePlugin(R) {
  return { id: 'phaseBands', beforeDatasetsDraw(ch) {
    const ev = R.events; if (!ev) return; const x = ch.scales.x, ca = ch.chartArea; if (!x) return; const cols = segColors(ev), ctx = ch.ctx;
    ctx.save(); ctx.beginPath(); ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top); ctx.clip();
    ev.segments.forEach((s, i) => { const x0 = Math.max(ca.left, x.getPixelForValue(s.from)), x1 = Math.min(ca.right, x.getPixelForValue(s.to)); if (x1 <= x0) return;
      ctx.fillStyle = withA(cols[i], isLight() ? '14' : '17'); ctx.fillRect(x0, ca.top, x1 - x0, ca.bottom - ca.top);
      if (x1 - x0 > 46) { ctx.fillStyle = withA(cols[i], 'D8'); ctx.font = `600 9.5px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(s.name.toUpperCase(), (x0 + x1) / 2, ca.top + 12); } });
    ctx.restore(); } };
}
const tsPlugins = R => [crosshair, phasePlugin(R)];

/* ============================================================================================================================ */
/*  BUILDERS                                                                                                                     */
/* ============================================================================================================================ */
function buildRR(R) {
  const { fit } = R, c = tc(), S = ST.colors().S, z = 1.96, idx = thinIdx(fit.dy.length), n = idx ? idx.length : fit.dy.length;
  const t = new Array(n), irr = new Array(n), dy = new Array(n), up = new Array(n), lo = new Array(n), gated = [];
  for (let i = 0; i < n; i++) { const k = idx ? idx[i] : i, s = z * Math.sqrt(Math.max(fit.rrV[k], 0)); t[i] = fit.time[k]; irr[i] = fit.irr[k]; dy[i] = fit.dy[k]; up[i] = irr[i] + s; lo[i] = irr[i] - s; if (fit.gate[k] > fit.ctl.diag_gate_max) gated.push({ x: t[i], y: dy[i] }); }
  const ds = [ln('Observed RR', t.map((x, i) => ({ x, y: dy[i] })), withA(c.tx2, '99'), { borderWidth: 1, order: 5 }), ln('Filtered RR', t.map((x, i) => ({ x, y: irr[i] })), S, { borderWidth: cfgC().lineWidth + 0.3, order: 2 }),
    { label: 'Artifact-gated beat', data: gated, parsing: false, borderColor: 'transparent', backgroundColor: c.amb, pointRadius: 3.5, pointStyle: 'triangle', showLine: false, order: 1 }];
  const extra = cfgC().showCI ? [bandPlugin('ciRR', { x: t, hi: up, lo }, withA(S, '26'))] : [];
  mk('rr', { type: 'line', data: { datasets: ds }, options: timeOpts(R, 'RR interval (s)'), plugins: tsPlugins(R).concat(extra, [{ id: 'phaseEditor', afterDatasetsDraw: ch => { if (root.SparkPhaseEditor) root.SparkPhaseEditor.overlay(ch); } }]) });
}
function buildStates(R) {
  const { fit } = R, col = ST.colors(), z = 1.96, idx = thinIdx(fit.dy.length), n = idx ? idx.length : fit.dy.length;
  const t = new Array(n), Xp = new Array(n), Xs = new Array(n), pH = new Array(n), pL = new Array(n), sH = new Array(n), sL = new Array(n);
  for (let i = 0; i < n; i++) { const k = idx ? idx[i] : i, sp = z * Math.sqrt(Math.max(fit.XpV[k], 0)), ss = z * Math.sqrt(Math.max(fit.XsV[k], 0)); t[i] = fit.time[k]; Xp[i] = fit.Xp[k]; Xs[i] = fit.Xs[k]; pH[i] = Xp[i] + sp; pL[i] = Xp[i] - sp; sH[i] = Xs[i] + ss; sL[i] = Xs[i] - ss; }
  const ds = [ln('Parasympathetic (vagal-like) x_p', t.map((x, i) => ({ x, y: Xp[i] })), col.P), ln('Sympathetic x_s', t.map((x, i) => ({ x, y: Xs[i] })), col.S, { borderWidth: cfgC().lineWidth + 0.4 })];
  const extra = cfgC().showCI ? [bandPlugin('ciS', { x: t, hi: sH, lo: sL }, withA(col.S, '1F')), bandPlugin('ciP', { x: t, hi: pH, lo: pL }, withA(col.P, '24'))] : [];
  mk('states', { type: 'line', data: { datasets: ds }, options: timeOpts(R, 'Drive (Hz)'), plugins: tsPlugins(R).concat(extra) });
}
/** Phase map: the two drives against each other; one colour per phase when phases are known, otherwise by time. */
function buildPhase(R) {
  const { fit, events: ev, phases } = R, c = tc(), N = fit.Xp.length, p = fit.params, sdP = Math.sqrt(p.lp * p.sig2), sdS = Math.sqrt(p.sig2);
  const idx = thinIdx(N), n = idx ? idx.length : N, at = i => idx ? idx[i] : i, light = isLight(), lutV = lut('viridis'), cols = ev ? segColors(ev) : null;
  const ell = { id: 'ellipses', afterDraw: ch => {
    const { ctx, chartArea: ca, scales: { x, y } } = ch; ctx.save(); ctx.beginPath(); ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top); ctx.clip();
    ctx.setLineDash([2, 5]); ctx.strokeStyle = light ? 'rgba(15,27,45,.14)' : 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; const ox = x.getPixelForValue(0), oy = y.getPixelForValue(0);
    ctx.beginPath(); ctx.moveTo(ca.left, oy); ctx.lineTo(ca.right, oy); ctx.moveTo(ox, ca.top); ctx.lineTo(ox, ca.bottom); ctx.stroke();
    [[1.517, .34], [2.448, .22], [3.413, .13]].forEach(([r, a], i) => { ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.strokeStyle = light ? `rgba(20,40,80,${a})` : `rgba(180,210,255,${a})`;
      for (let k = 0; k <= 90; k++) { const th = 2 * Math.PI * k / 90, px = x.getPixelForValue(sdP * r * Math.cos(th)), py = y.getPixelForValue(sdS * r * Math.sin(th)); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.stroke();
      if (i === 2) { ctx.setLineDash([]); ctx.fillStyle = light ? 'rgba(20,40,80,.55)' : 'rgba(180,210,255,.55)'; ctx.font = `500 9px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText('stationary 1–3 σ', x.getPixelForValue(sdP * r * 0.80), y.getPixelForValue(sdS * r * 0.30) - 5); ctx.textAlign = 'left'; } });
    // phase centroids, joined in the order of the protocol
    if (phases && ev) { const pts = phases.map((r, i) => r.cu != null ? [r.xp, r.xs, r.name, cols[i]] : null).filter(Boolean);
      ctx.setLineDash([]); ctx.lineWidth = 1.6; ctx.strokeStyle = light ? 'rgba(15,27,45,.55)' : 'rgba(235,242,255,.7)';
      for (let i = 0; i < pts.length - 1; i++) { const x0 = x.getPixelForValue(pts[i][0]), y0 = y.getPixelForValue(pts[i][1]), x1 = x.getPixelForValue(pts[i + 1][0]), y1 = y.getPixelForValue(pts[i + 1][1]), a = Math.atan2(y1 - y0, x1 - x0);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 9 * Math.cos(a - .4), y1 - 9 * Math.sin(a - .4)); ctx.lineTo(x1 - 9 * Math.cos(a + .4), y1 - 9 * Math.sin(a + .4)); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
      pts.forEach(q => { const px = x.getPixelForValue(q[0]), py = y.getPixelForValue(q[1]); ctx.beginPath(); ctx.arc(px, py, 7, 0, 6.3); ctx.fillStyle = q[3]; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = light ? '#fff' : '#0D1424'; ctx.stroke(); ctx.fillStyle = light ? '#0F1B2D' : '#EAF1FC'; ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(q[2], px + 10, py - 8); }); }
    ctx.restore(); } };
  const tipCb = { callbacks: { title: () => '', label: c => ` ${c.dataset.label}: x_p ${c.parsed.x.toFixed(3)} Hz, x_s ${c.parsed.y.toFixed(3)} Hz` } };
  let datasets;
  if (ev) {
    datasets = ev.segments.map((s, k) => { const d = []; for (let i = 0; i < n; i++) if (segIndexAt(fit.time[at(i)], ev) === k) d.push({ x: fit.Xp[at(i)], y: fit.Xs[at(i)] });
      return { label: s.name, data: d, showLine: true, borderColor: withA(cols[k], '66'), borderWidth: 0.9, backgroundColor: withA(cols[k], 'CC'), pointBackgroundColor: withA(cols[k], 'CC'), pointRadius: 2.2, pointHoverRadius: 4.5, tension: 0 }; });
    const gap = []; for (let i = 0; i < n; i++) if (segIndexAt(fit.time[at(i)], ev) < 0) gap.push({ x: fit.Xp[at(i)], y: fit.Xs[at(i)] });
    if (gap.length) datasets.push({ label: 'Unassigned', data: gap, showLine: false, backgroundColor: withA(NEUTRAL, '77'), pointRadius: 1.8, order: 5 });
  } else {
    const col = i => { const [r, g, b] = lutV[Math.round(255 * at(i) / Math.max(N - 1, 1))]; return `rgb(${r},${g},${b})`; }, pts = Array.from({ length: n }, (_, i) => ({ x: fit.Xp[at(i)], y: fit.Xs[at(i)] }));
    datasets = [{ label: 'Trajectory (early → late)', data: pts, showLine: true, borderColor: withA(c.tx2, '44'), borderWidth: 0.8, pointBackgroundColor: pts.map((_, i) => col(i)), pointRadius: 2.2, pointHoverRadius: 4.5, segment: { borderColor: cx => { const [r, g, b] = lutV[Math.round(255 * at(cx.p0DataIndex) / Math.max(N - 1, 1))]; return `rgba(${r},${g},${b},.45)`; } } }];
  }
  mk('phase', { type: 'scatter', data: { datasets }, options: baseOpts({ interaction: { mode: 'nearest', intersect: true }, plugins: { tooltip: tipCb, legend: { display: !!ev } }, scales: { x: axisXY('Parasympathetic drive x_p (Hz)'), y: axisXY('Sympathetic drive x_s (Hz)') } }), plugins: [ell] });
}
function areaChart(id, R, data, label, color, ytitle, o) {
  const idx = thinIdx(data.length), t = pick(R.fit.time, idx), d = pick(data, idx), pts = t.map((x, i) => ({ x, y: d[i] }));
  mk(id, { type: 'line', data: { datasets: [ln(label, pts, color, { borderWidth: cfgC().lineWidth + 0.2 })] }, options: timeOpts(R, ytitle, { scales: { y: o || {} }, plugins: { legend: { display: false } } }), plugins: tsPlugins(R).concat([areaPlugin('area' + id, pts, color, 0)]) });
}
function signedChart(id, R, data, labelPos, labelNeg, label, color, ytitle) {
  const c = tc(), idx = thinIdx(data.length), t = pick(R.fit.time, idx), d = pick(data, idx);
  mk(id, { type: 'line', data: { datasets: [{ label: labelPos, data: t.map((x, i) => ({ x, y: d[i] > 0 ? d[i] : 0 })), borderColor: 'transparent', backgroundColor: withA(c.red, '40'), fill: 'origin', pointRadius: 0, borderWidth: 0 },
    { label: labelNeg, data: t.map((x, i) => ({ x, y: d[i] < 0 ? d[i] : 0 })), borderColor: 'transparent', backgroundColor: withA(c.teal, '40'), fill: 'origin', pointRadius: 0, borderWidth: 0 }, ln(label, t.map((x, i) => ({ x, y: d[i] })), color)] },
    options: timeOpts(R, ytitle, { plugins: { legend: { labels: { filter: it => it.text !== '' } } } }), plugins: tsPlugins(R) });
}
function buildPSD(R) {
  const { psd } = R, c = tc(), S = ST.colors().S;
  const bands = { id: 'bands', beforeDatasetsDraw: ch => { const { ctx, chartArea: ca, scales: { x } } = ch, a = x.getPixelForValue(.04), b = x.getPixelForValue(.15), d = x.getPixelForValue(.40);
    ctx.save(); ctx.fillStyle = withA(c.red, '12'); ctx.fillRect(Math.max(a, ca.left), ca.top, Math.min(b, ca.right) - Math.max(a, ca.left), ca.bottom - ca.top); ctx.fillStyle = withA(c.teal, '12'); ctx.fillRect(Math.max(b, ca.left), ca.top, Math.min(d, ca.right) - Math.max(b, ca.left), ca.bottom - ca.top);
    ctx.font = `600 9.5px ${FONT}`; ctx.fillStyle = withA(c.red, 'CC'); ctx.fillText('LF', Math.max(a, ca.left) + 6, ca.top + 13); ctx.fillStyle = withA(c.teal, 'CC'); ctx.fillText('HF', Math.max(b, ca.left) + 6, ca.top + 13); ctx.restore(); } };
  const fltPts = psd.flt.freq.map((f, i) => ({ x: f, y: psd.flt.pow[i] }));
  mk('psd', { type: 'scatter', data: { datasets: [{ type: 'line', showLine: true, label: 'Empirical PSD', data: psd.obs.freq.map((f, i) => ({ x: f, y: psd.obs.pow[i] })), borderColor: withA(c.tx2, 'AA'), backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.2 },
    { type: 'line', showLine: true, label: 'Filtered PSD', data: fltPts, parsing: false, borderColor: S, backgroundColor: S, pointRadius: 0, borderWidth: cfgC().lineWidth + 0.2 }] },
    options: baseOpts({ scales: { x: axisXY('Frequency (Hz)', { type: 'linear', min: .01, max: .5, ticks: { maxTicksLimit: 9 } }), y: axisXY('Power spectral density', { type: 'logarithmic' }) }, plugins: { tooltip: { callbacks: { title: it => (+it[0].parsed.x).toFixed(3) + ' Hz', label: c => ` ${c.dataset.label}: ${Number(c.parsed.y).toExponential(2)}` } } } }), plugins: [bands, crosshair, areaPlugin('areaPSD', fltPts, S, 'bottom', '30', '02')] });
}
function buildPoincare(R) {
  const { fit, events: ev } = R, c = tc(), S = ST.colors().S, n = fit.dy.length, idx = thinIdx(n - 1), m = idx ? idx.length : n - 1, at = i => idx ? idx[i] : i, cols = ev ? segColors(ev) : null;
  const lo = Math.min(...fit.dy) * 0.97, hi = Math.max(...fit.dy) * 1.03, obs = Array.from({ length: m }, (_, i) => ({ x: fit.dy[at(i)], y: fit.dy[at(i) + 1] })), dsets = [{ label: 'Observed', data: obs, backgroundColor: withA(c.tx2, '55'), pointRadius: 2, pointBorderWidth: 0, order: 5 }];
  if (ev) { const gp = Array.from({ length: m }, (_, i) => i).filter(i => segIndexAt(fit.time[at(i)], ev) < 0).map(i => ({ x: fit.irr[at(i)], y: fit.irr[at(i) + 1] })); if (gp.length) dsets.push({ label: 'Filtered · unassigned', data: gp, backgroundColor: withA(NEUTRAL, '99'), pointRadius: 2.2, pointBorderWidth: 0, order: 2 }); }
  if (ev) ev.segments.forEach((s, k) => dsets.push({ label: 'Filtered · ' + s.name.toLowerCase(), data: Array.from({ length: m }, (_, i) => i).filter(i => segIndexAt(fit.time[at(i)], ev) === k).map(i => ({ x: fit.irr[at(i)], y: fit.irr[at(i) + 1] })), backgroundColor: withA(cols[k], 'DD'), pointRadius: 2.6, pointBorderWidth: 0, order: 1 }));
  else dsets.push({ label: 'Filtered', data: Array.from({ length: m }, (_, i) => ({ x: fit.irr[at(i)], y: fit.irr[at(i) + 1] })), backgroundColor: withA(S, 'DD'), pointRadius: 2.6, pointBorderWidth: 0, order: 1 });
  dsets.push({ type: 'line', label: '', data: [{ x: lo, y: lo }, { x: hi, y: hi }], borderColor: withA(c.tx3, 'AA'), borderDash: [4, 4], pointRadius: 0, borderWidth: 1 });
  mk('poincare', { type: 'scatter', data: { datasets: dsets }, options: baseOpts({ interaction: { mode: 'nearest', intersect: true }, plugins: { tooltip: { callbacks: { title: () => '', label: c => ` ${c.dataset.label}: ${c.parsed.x.toFixed(3)} → ${c.parsed.y.toFixed(3)} s` } } }, scales: { x: axisXY('RR(n) (s)', { min: lo, max: hi }), y: axisXY('RR(n+1) (s)', { min: lo, max: hi }) } }) });
}
function buildGain(R) {
  const { fit } = R, c = tc(), idx = thinIdx(fit.dy.length), p = fit.params, t = pick(fit.time, idx), g = pick(fit.gain, idx);
  const note = doc.querySelector('.cc[data-chart="gain"] .cc-note');
  if (note) note.innerHTML = `γ = <b>${fmt(p.gamma, 4)}</b> &nbsp; <span class="pill ${p.gate_off ? 'off' : 'on'}">${p.gate_off ? 'gate off — ungated model' : 'gate on'}</span> &nbsp; τ<sub>g</sub> = ${fit.ctl.tau_g} s &nbsp; g<sub>k</sub> ∈ [${fmt(Math.min(...fit.gain), 3)}, ${fmt(Math.max(...fit.gain), 3)}]`;
  mk('gain', { type: 'line', data: { datasets: [ln('', t.map(x => ({ x, y: 1 })), withA(c.tx3, 'AA'), { borderDash: [4, 4], borderWidth: 1 }), ln('Vagal variance gain g_k', t.map((x, i) => ({ x, y: g[i] })), c.acc, { fill: false })] }, options: timeOpts(R, 'g_k (log scale)', { scales: { y: Object.assign({ type: 'logarithmic' }, p.gate_off ? { min: 0.5, max: 2 } : {}) }, plugins: { legend: { display: false } } }), plugins: tsPlugins(R) });
}
function buildPartition(R) {
  const { fit } = R, pt = fit.pr.partition, c = tc(); if (!pt) return setEmpty('partition', 'No spectral partition available.');
  const keep = pt.freq.map((f, i) => i).filter(i => pt.freq[i] >= 0.01 && pt.freq[i] <= 0.5 && isFinite(pt.power[i])), P = ST.colors();
  const powPts = keep.map(i => ({ x: pt.freq[i], y: pt.power[i] }));
  mk('partition', { type: 'scatter', data: { datasets: [
    { type: 'line', showLine: true, label: 'Global CWT power of HR', data: powPts, parsing: false, borderColor: withA(c.tx2, 'DD'), backgroundColor: c.tx2, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y' },
    { type: 'line', showLine: true, label: 'Vagal weight', data: keep.map(i => ({ x: pt.freq[i], y: pt.w_vagal[i] })), borderColor: P.P, backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.8, yAxisID: 'y2' },
    { type: 'line', showLine: true, label: 'Sympathetic weight', data: keep.map(i => ({ x: pt.freq[i], y: pt.w_symp[i] })), borderColor: P.S, backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.8, yAxisID: 'y2' }] },
    options: baseOpts({ scales: { x: axisXY('Frequency (Hz)', { type: 'logarithmic', min: 0.01, max: 0.5 }), y: axisXY('Power', { type: 'logarithmic' }), y2: axisBase('Weight', { position: 'right', min: 0, max: 1, grid: { display: false } }, true) }, plugins: { tooltip: { callbacks: { title: it => (+it[0].parsed.x).toFixed(3) + ' Hz' } } } }), plugins: [crosshair, areaPlugin('areaPow', powPts, c.tx2, 'bottom', '22', '02')] });
  const note = doc.querySelector('.cc[data-chart="partition"] .cc-note');
  if (note) note.innerHTML = `Vagal energy ${pt.vagal_energy.toExponential(2)} · sympathetic energy ${pt.symp_energy.toExponential(2)} → V<sub>P</sub>/V<sub>S</sub> = <b>${fmt(fit.pr.energy_ratio, 4)}</b> (fixed in the fit)`;
}
const normalPdf = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
function ellipsePts(cx, cy, cov, level, n) {
  const k = Math.sqrt(-2 * Math.log(1 - level)), a = cov[0][0], b = cov[0][1], d = cov[1][1], tr = a + d, det = a * d - b * b, q = Math.sqrt(Math.max(tr * tr / 4 - det, 0)), l1 = tr / 2 + q, l2 = tr / 2 - q;
  const th = Math.abs(b) < 1e-300 ? (a >= d ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b), out = [];
  for (let i = 0; i <= (n || 90); i++) { const t = 2 * Math.PI * i / (n || 90), x = k * Math.sqrt(Math.max(l1, 0)) * Math.cos(t), y = k * Math.sqrt(Math.max(l2, 0)) * Math.sin(t); out.push([cx + x * Math.cos(th) - y * Math.sin(th), cy + x * Math.sin(th) + y * Math.cos(th)]); }
  return out;
}
function postChart(id, xtitle, ytitle, prior, post, est, estMax) {
  const c = tc(), ds = [{ type: 'line', showLine: true, label: 'Prior', data: prior, parsing: false, borderColor: withA(c.tx2, 'DD'), backgroundColor: c.tx2, pointRadius: 0, borderWidth: 1.5 }], areas = [areaPlugin('prior' + id, prior, c.tx2, 0, '2A', '02')];
  if (post) { ds.push({ type: 'line', showLine: true, label: 'Posterior (Laplace)', data: post, parsing: false, borderColor: c.acc, backgroundColor: c.acc, pointRadius: 0, borderWidth: 2 }); areas.push(areaPlugin('post' + id, post, c.acc, 0, '55', '04')); }
  ds.push({ type: 'line', showLine: true, label: 'MAP estimate', data: [{ x: est, y: 0 }, { x: est, y: estMax }], borderColor: c.amb, borderDash: [4, 3], pointRadius: 0, borderWidth: 1.6 });
  mk(id, { type: 'scatter', data: { datasets: ds }, options: baseOpts({ scales: { x: axisXY(xtitle, { type: id === 'pp-gamma' ? 'linear' : 'logarithmic' }), y: axisXY(ytitle, { min: 0 }) }, plugins: { tooltip: { callbacks: { title: it => xtitle + ' = ' + Number(it[0].parsed.x).toPrecision(3) } } } }), plugins: [crosshair].concat(areas) });
}
function buildTauPost(which) {
  return R => {
    const { fit, rep } = R, pr = fit.pr, P = which === 'p', mu = P ? pr.log_tau_p_mu : pr.log_tau_s_mu, sg = P ? pr.sigma_log_tau_p : pr.sigma_log_tau_s, est = Math.log(P ? 1 / fit.params.kp : 1 / fit.params.ks);
    const lo = Math.min(mu - 3.6 * sg, est - 0.6), hi = Math.max(mu + 3.6 * sg, est + 0.6), xs = Array.from({ length: 161 }, (_, i) => lo + (hi - lo) * i / 160);
    const prior = xs.map(x => ({ x: Math.exp(x), y: normalPdf(x, mu, sg) })), post = rep ? xs.map(x => ({ x: Math.exp(x), y: normalPdf(x, est, P ? rep.sd_ln_tau_p : rep.sd_ln_tau_s) })) : null;
    postChart(P ? 'pp-taup' : 'pp-taus', `τ_${P ? 'P' : 'S'} (s)`, 'Density per ln τ', prior, post, Math.exp(est), Math.max(...prior.concat(post || []).map(d => d.y)));
  };
}
function buildJitterPost(R) {
  const { fit } = R, pr = fit.pr, xs = Array.from({ length: 161 }, (_, i) => pr.log_jit_mu - 3.6 * pr.sigma_log_jit + 7.2 * pr.sigma_log_jit * i / 160), est = fit.params.rr_jitter_ms;
  const prior = xs.map(x => ({ x: Math.exp(x) * 1000, y: normalPdf(x, pr.log_jit_mu, pr.sigma_log_jit) })); postChart('pp-jit', 'RR timing jitter (ms)', 'Density per ln s', prior, null, est, Math.max(...prior.map(d => d.y)));
}
function buildGammaPost(R) {
  const { fit } = R, pr = fit.pr, q99 = pr.gamma_prior_scale * (Math.pow(0.01, -1 / pr.gamma_prior_shape) - 1), xmax = Math.max(q99, fit.params.gamma * 1.5, 0.05), f = g => pr.gamma_prior_shape / pr.gamma_prior_scale * Math.pow(1 + g / pr.gamma_prior_scale, -(pr.gamma_prior_shape + 1));
  const prior = Array.from({ length: 201 }, (_, i) => ({ x: xmax * i / 200, y: f(xmax * i / 200) })); postChart('pp-gamma', 'γ', 'Prior density (Lomax)', prior, null, fit.params.gamma, f(0));
}
function buildEllipse(R) {
  const { fit, rep } = R, c = tc(), pr = fit.pr, ls = Math.log(1 / fit.params.ks), lp = Math.log(1 / fit.params.kp), dsl = [];
  const prior = ellipsePts(pr.log_tau_s_mu, pr.log_tau_p_mu, [[pr.sigma_log_tau_s ** 2, 0], [0, pr.sigma_log_tau_p ** 2]], 0.95);
  dsl.push({ type: 'line', showLine: true, label: 'Prior 95%', data: prior.map(p => ({ x: Math.exp(p[0]), y: Math.exp(p[1]) })), borderColor: withA(c.tx2, 'DD'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.3 });
  if (rep) [0.5, 0.95].forEach((lv, i) => dsl.push({ type: 'line', showLine: true, label: `Posterior ${lv * 100}%`, data: ellipsePts(ls, lp, rep.lnTauCov, lv).map(p => ({ x: Math.exp(p[0]), y: Math.exp(p[1]) })), borderColor: c.acc, backgroundColor: withA(c.acc, i ? '14' : '26'), fill: true, pointRadius: 0, borderWidth: 1.6 }));
  dsl.push({ label: 'MAP', data: [{ x: Math.exp(ls), y: Math.exp(lp) }], backgroundColor: c.amb, borderColor: isLight() ? '#fff' : '#0D1424', borderWidth: 2, pointRadius: 6, pointStyle: 'circle' });
  mk('ellipse', { type: 'scatter', data: { datasets: dsl }, options: baseOpts({ interaction: { mode: 'nearest', intersect: true }, scales: { x: axisXY('τ_S (s)', { type: 'logarithmic' }), y: axisXY('τ_P (s)', { type: 'logarithmic' }) } }) });
}
function buildRolling(R) {
  const { roll } = R; if (!roll || !roll.length) return setEmpty('rolling', 'Recording too short for the rolling window.');
  const sel = doc.querySelector('.cc[data-chart="rolling"] select.mini'), metric = sel ? sel.value : 'hr', c = tc(), P = ST.colors(), span = spanOf(R);
  const key = { hr: ['hrObs', 'hrFlt', 'Heart rate (bpm)'], sdnn: ['sdnnObs', 'sdnnFlt', 'SDNN (ms)'], rmssd: ['rmssdObs', 'rmssdFlt', 'RMSSD (ms)'] }[metric];
  mk('rolling', { type: 'line', data: { datasets: [ln('Observed', roll.map(r => ({ x: r.t, y: r[key[0]] })), withA(c.tx2, 'BB'), { borderDash: [4, 3] }), ln('Filtered', roll.map(r => ({ x: r.t, y: r[key[1]] })), P.S, { pointRadius: 2, backgroundColor: P.S })] }, options: timeOpts(R, key[2]), plugins: tsPlugins(R) });
}
function corrBars(id, vals, boundN, xt, yt, title) {
  const c = tc(), bound = 1.96 / Math.sqrt(Math.max(boundN, 1));
  mk(id, { type: 'bar', data: { labels: vals.map(v => v.x), datasets: [{ label: title, data: vals.map(v => v.y), backgroundColor: vals.map(v => Math.abs(v.y) > bound ? withA(c.red, 'DD') : withA(c.acc, '88')), borderRadius: 2, borderSkipped: false, barPercentage: 0.82, categoryPercentage: 0.9 },
    { type: 'line', label: '95% band', data: vals.map(() => bound), borderColor: withA(c.grn, 'AA'), borderDash: [4, 4], pointRadius: 0, borderWidth: 1.1 }, { type: 'line', label: '', data: vals.map(() => -bound), borderColor: withA(c.grn, 'AA'), borderDash: [4, 4], pointRadius: 0, borderWidth: 1.1 }] },
    options: baseOpts({ scales: { x: axisX(xt, { ticks: { maxTicksLimit: 12 } }), y: axisY(yt) } }) });
}
function buildXcorr(R) { const { fit } = R, cc = E.crossCorr(fit.Xp, fit.Xs, 40); corrBars('xcorr', cc.map(o => ({ x: o.lag, y: o.r })), fit.Xp.length, 'Lag (beats): x_s leads at positive lag', 'Correlation', 'corr(x_p, x_s)'); }
function buildACF(R) { const { diag } = R; if (!diag) return setEmpty('acf', 'Too few valid innovations.'); corrBars('acf', diag.acf.map((v, i) => ({ x: i + 1, y: v })), diag.N, 'Lag (beats)', 'Autocorrelation', 'ACF'); }
function buildPACF(R) { const { diag } = R; if (!diag) return setEmpty('pacf', 'Too few valid innovations.'); corrBars('pacf', diag.pacf.map((v, i) => ({ x: i + 1, y: v })), diag.N, 'Lag (beats)', 'Partial autocorrelation', 'PACF'); }
function buildHist(R) {
  const { diag } = R, c = tc(); if (!diag) return setEmpty('hist', 'Too few valid innovations.');
  const z = diag.z, mn = Math.min(...z), mx = Math.max(...z), bins = Math.max(15, Math.min(28, Math.round(Math.sqrt(z.length)))), w = (mx - mn) / bins, cen = [], den = [];
  for (let b = 0; b < bins; b++) { const l = mn + b * w, h = l + w; cen.push((l + h) / 2); den.push(z.filter(v => v >= l && (v < h || b === bins - 1)).length / (z.length * w)); }
  mk('hist', { type: 'bar', data: { labels: cen.map(v => v.toFixed(1)), datasets: [{ label: 'Innovations', data: den, backgroundColor: withA(c.acc, '77'), borderRadius: 3, borderSkipped: false, barPercentage: 0.95, categoryPercentage: 1 }, { type: 'line', label: 'N(0,1)', data: cen.map(x => normalPdf(x, 0, 1)), borderColor: c.red, backgroundColor: 'transparent', pointRadius: 0, borderWidth: 2, tension: .4 }] },
    options: baseOpts({ scales: { x: axisX('Standardized innovation', { ticks: { maxTicksLimit: 9 } }), y: axisY('Density') } }) });
}
function buildQQ(R) {
  const { diag } = R, c = tc(); if (!diag) return setEmpty('qq', 'Too few valid innovations.');
  const z = diag.z.slice().sort((a, b) => a - b), N = z.length, pts = z.map((v, i) => ({ x: E.qnorm((i + 0.5) / N), y: v }));
  mk('qq', { type: 'scatter', data: { datasets: [{ label: 'Observations', data: pts, backgroundColor: withA(c.acc, 'AA'), pointRadius: 2.4 }, { label: '', type: 'line', data: [{ x: pts[0].x, y: pts[0].x }, { x: pts[N - 1].x, y: pts[N - 1].x }], borderColor: withA(c.red, 'CC'), pointRadius: 0, borderWidth: 1.5, borderDash: [5, 4] }] },
    options: baseOpts({ interaction: { mode: 'nearest', intersect: true }, scales: { x: axisXY('Theoretical N(0,1)'), y: axisXY('Empirical quantile') } }) });
}
function buildKS(R) {
  const { diag } = R, c = tc(); if (!diag) return setEmpty('ks', 'Too few valid innovations.');
  const u = diag.ks.u, N = diag.N, b = diag.ks_bound, ecdf = [{ x: 0, y: 0 }, ...u.map((v, i) => ({ x: v, y: (i + 1) / N })), { x: 1, y: 1 }];
  mk('ks', { type: 'scatter', data: { datasets: [{ type: 'line', showLine: true, label: 'Empirical CDF', data: ecdf, stepped: 'before', borderColor: c.red, pointRadius: 0, borderWidth: 1.8 },
    { type: 'line', showLine: true, label: 'Uniform CDF', data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: withA(c.tx2, 'AA'), pointRadius: 0, borderWidth: 1.1, borderDash: [5, 4] },
    { type: 'line', showLine: true, label: 'KS bounds (1.36/√N)', data: [{ x: 0, y: b }, { x: 1, y: 1 + b }], borderColor: withA(c.grn, 'AA'), pointRadius: 0, borderWidth: 1, borderDash: [3, 5] },
    { type: 'line', showLine: true, label: '', data: [{ x: 0, y: -b }, { x: 1, y: 1 - b }], borderColor: withA(c.grn, 'AA'), pointRadius: 0, borderWidth: 1, borderDash: [3, 5] }] },
    options: baseOpts({ interaction: { mode: 'nearest', intersect: false }, scales: { x: axisXY('Uniform(0,1)', { min: 0, max: 1 }), y: axisXY('Empirical CDF', { min: 0, max: 1 }) } }) });
}

/* ---- HTML cards ------------------------------------------------------------------------------------------------------------ */
function buildPhaseHRV(R) {
  const rows = R.phaseHRV, body = doc.querySelector('.cc[data-chart="phasehrv"] .cc-body'), ev = R.events, cols = ev ? segColors(ev) : [], pc = ev ? Object.fromEntries(ev.segments.map((s, i) => [s.name, cols[i]])) : {};
  const f = (v, d) => isFinite(v) ? v.toFixed(d) : '—', short = rows.some(r => r.obs && r.duration < 120);
  const line = (r, h, tag, first) => `<tr class="${first ? 'grp ' : ''}${tag === 'Observed' ? 'obs' : 'flt'}">${first ? `<td rowspan="2" class="ph">${pc[r.name] ? `<span class="dot" style="background:${pc[r.name]}"></span>` : ''}${r.name}</td>` : ''}<td class="sig">${tag}</td>${first ? `<td rowspan="2">${f(r.duration, 0)}</td><td rowspan="2">${r.n}</td>` : ''}<td>${f(h.meanHR, 1)}</td><td>${f(h.meanRR, 0)}</td><td>${f(h.SDNN, 1)}</td><td>${f(h.RMSSD, 1)}</td><td>${f(h.pNN50, 1)}</td><td>${f(h.LF, 1)}</td><td>${f(h.HF, 1)}</td><td>${f(h.LFHF, 2)}</td></tr>`;
  const html = rows.map(r => r.obs ? line(r, r.obs, 'Observed', true) + line(r, r.flt, 'Filtered', false) : `<tr class="grp"><td class="ph">${r.name}</td><td colspan="11">too few beats</td></tr>`).join('');
  body.innerHTML = `<table class="stat-table wide"><thead><tr><th>Window</th><th>Signal</th><th>Duration (s)</th><th>Beats</th><th>HR (bpm)</th><th>Mean RR (ms)</th><th>SDNN (ms)</th><th>RMSSD (ms)</th><th>pNN50 (%)</th><th>LF (ms²)</th><th>HF (ms²)</th><th>LF/HF</th></tr></thead><tbody>${html}</tbody></table>
    <div class="se-note">Observed = the recorded RR series; filtered = the model-filtered series (ectopic beats and timing noise removed). Each window uses the beats that start inside it. ${ev ? '' : 'No phases are defined, so only the whole recording is shown. '}LF, HF and LF/HF need at least 2 min of data${short ? ' (shown as — for shorter windows)' : ''}. In windows where heart rate changes strongly (exercise, early recovery) SDNN and the spectral values also contain that trend.</div>`;
}
function buildHRVTable(R) {
  const { hrvObs: o, hrvFlt: f } = R, body = doc.querySelector('.cc[data-chart="hrvtable"] .cc-body');
  const rows = [['Mean heart rate (bpm)', 'meanHR', 1], ['Mean RR (ms)', 'meanRR', 1], ['SDNN (ms)', 'SDNN', 1], ['RMSSD (ms)', 'RMSSD', 1], ['pNN50 (%)', 'pNN50', 1], ['LF power (ms²)', 'LF', 1], ['HF power (ms²)', 'HF', 1], ['LF/HF', 'LFHF', 2]];
  body.innerHTML = `<table class="stat-table"><thead><tr><th>Metric</th><th>Observed RR</th><th>Filtered RR</th><th>Δ%</th></tr></thead><tbody>${rows.map(([n, k, d]) => {
    const a = o[k], b = f[k], dd = isFinite(a) && isFinite(b) && a !== 0 ? 100 * (b - a) / Math.abs(a) : NaN; return `<tr><td>${n}</td><td>${fmt(a, d)}</td><td>${fmt(b, d)}</td><td>${isFinite(dd) ? (dd > 0 ? '+' : '') + dd.toFixed(1) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table>
    <div class="se-note">Spectral values need ≥ 2 min of data (Hann-windowed periodogram of the 4 Hz tachogram). Over a whole recording with changing conditions these summaries mix phases; see the phase table for a per-phase view.</div>`;
}
function buildPhaseTable(R) {
  const body = doc.querySelector('.cc[data-chart="phasetable"] .cc-body'), ph = R.phases, ev = R.events;
  if (!ph || !ev) { body.innerHTML = `<div class="empty-card">${R.phaseNote || 'No phase changes were detected in this recording at the current sensitivity. Type protocol times (seconds) in Settings → Analysis → Protocol phases, or raise the sensitivity.'}</div>`; return; }
  const cols = segColors(ev), mmss = s => { const m = Math.floor(s / 60), r = Math.round(s - m * 60); return m + ':' + String(r === 60 ? 0 : r).padStart(2, '0'); }, bnd = k => ev.boundaries && ev.boundaries.length ? ev.boundaries : [];
  // boundary statistics belong to the phase that starts at the boundary (auto detection only)
  const startStat = k => { if (ev.source !== 'auto' || k === 0) return '—'; const b = ev.boundaries.reduce((a, x) => Math.abs(x.t - ev.segments[k].from) < Math.abs(a.t - ev.segments[k].from) ? x : a, ev.boundaries[0]); return `${b.deltaBpm > 0 ? '+' : ''}${b.deltaBpm.toFixed(0)} bpm · z ${b.z.toFixed(1)}`; };
  const row = (r, i) => r.n < 5 ? `<tr><td>${r.name}</td><td colspan="9">too few beats</td></tr>` : `<tr><td><span class="dot" style="background:${cols[i]}"></span>${r.name}</td><td>${mmss(r.from)}–${mmss(r.to)}</td><td>${fmt(r.duration, 0)}</td><td>${fmt(r.hr, 1)}</td><td>${fmt(r.rmssdObs, 1)}</td><td>${fmt(r.xp, 3)}</td><td>${fmt(r.xs, 3)}</td><td>${fmt(r.shift, 2)}</td><td>${startStat(i)}</td></tr>`;
  const how = ev.source === 'auto' ? `Detected automatically from heart rate (median ${ev.params.binS}-s bins, level changes of at least ${ev.params.minShiftBpm} bpm with z ≥ ${ev.params.minZ}, phases of at least ${ev.params.minSegmentS} s; up to ${ev.params.maxStressors} stressors). Check the limits against your protocol and override them in Settings → Analysis if needed.`
    : 'Phase limits typed in Settings → Analysis (seconds from the first beat).';
  body.innerHTML = `<table class="stat-table"><thead><tr><th>Phase</th><th>Time</th><th>Duration (s)</th><th>HR (bpm)</th><th>RMSSD (ms)</th><th>mean x_p (Hz)</th><th>mean x_s (Hz)</th><th>Shift from rest (σ)</th><th>Change at start</th></tr></thead><tbody>${ph.map(row).join('')}</tbody></table>
    <div class="se-note">${how} Shift = distance between the phase centroid and the rest centroid in the (x_p, x_s) plane, in units of the stationary standard deviations of the two drives.</div>`;
}
function buildCorrMatrix(R) {
  const { rep } = R, body = doc.querySelector('.cc[data-chart="corrmat"] .cc-body'); if (!rep) { body.innerHTML = '<div class="empty-card">Enable “Standard errors and Laplace posterior” in Settings → Analysis.</div>'; return; }
  const names = ['κ_S', 'κ_P', 'Λ_R', 'γ'], C = rep.physCov, r = (i, j) => C[i][j] / Math.sqrt(Math.max(C[i][i], 1e-300) * Math.max(C[j][j], 1e-300));
  const color = v => { const a = Math.min(1, Math.abs(v)); return v >= 0 ? `rgba(${Math.round(60 + 180 * a)},${Math.round(100 - 40 * a)},${Math.round(90 - 40 * a)},${0.22 + 0.7 * a})` : `rgba(${Math.round(50 - 20 * a)},${Math.round(120 + 40 * a)},${Math.round(210 + 20 * a)},${0.22 + 0.7 * a})`; };
  let h = `<div class="corr-grid" style="grid-template-columns:42px repeat(4,1fr)"><div></div>${names.map(n => `<div class="corr-lbl">${n}</div>`).join('')}`;
  for (let i = 0; i < 4; i++) { h += `<div class="corr-lbl">${names[i]}</div>`; for (let j = 0; j < 4; j++) { const v = r(i, j); h += `<div class="corr-cell" style="background:${color(v)}" title="${names[i]} vs ${names[j]}">${isFinite(v) ? v.toFixed(2) : '—'}</div>`; } }
  body.innerHTML = h + `</div><div class="se-note">Correlation of the MAP estimates (inverse numerical Hessian, delta method). Hessian eigenvalue range ${rep.min_eig.toExponential(1)} … ${rep.max_eig.toExponential(1)}${rep.min_eig <= 0 ? ' — not positive definite: SEs are approximate' : ''}.</div>`;
}

function buildPostSummary(R) {
  const { fit, rep } = R, pr = fit.pr, p = fit.params, body = doc.querySelector('.cc[data-chart="postsummary"] .cc-body'), z = 1.96, f = (a, b, d) => `${a.toFixed(d)} – ${b.toFixed(d)}`;
  const tau = (name, tauHat, lo, hi, sdPost, sdPrior) => `<tr><td>${name}</td><td>${f(lo, hi, 1)}</td><td>${tauHat.toFixed(2)}</td><td>${rep ? f(tauHat * Math.exp(-z * sdPost), tauHat * Math.exp(z * sdPost), 2) : '—'}</td><td>${rep ? (sdPost / sdPrior).toFixed(2) : '—'}</td></tr>`;
  const q95 = pr.gamma_prior_scale * (Math.pow(0.05, -1 / pr.gamma_prior_shape) - 1);
  body.innerHTML = `<table class="stat-table"><thead><tr><th>Parameter</th><th>Prior 95% range</th><th>Estimate (MAP)</th><th>Posterior 95% range</th><th>Posterior / prior SD</th></tr></thead><tbody>
    ${tau('τ_P (s)', 1 / p.kp, pr.tau_p_bounds[0], pr.tau_p_bounds[1], rep && rep.sd_ln_tau_p, pr.sigma_log_tau_p)}
    ${tau('τ_S (s)', 1 / p.ks, pr.tau_s_bounds[0], pr.tau_s_bounds[1], rep && rep.sd_ln_tau_s, pr.sigma_log_tau_s)}
    <tr><td>RR jitter (ms)</td><td>${f(pr.jitter_bounds_ms[0], pr.jitter_bounds_ms[1], 1)}</td><td>${p.rr_jitter_ms.toFixed(2)}</td><td>—</td><td>—</td></tr>
    <tr><td>γ (vagal gate)</td><td>0 – ${q95.toFixed(2)}</td><td>${p.gamma.toFixed(5)}${p.gate_off ? ' (off)' : ''}</td><td>—</td><td>—</td></tr>
    <tr><td>V_P / V_S</td><td colspan="2">fixed by the spectral anchor: ${fit.pr.energy_ratio.toFixed(3)}</td><td>—</td><td>—</td></tr></tbody></table>
    <div class="se-note">Posterior ranges are the Laplace approximation (normal in ln τ). A ratio well below 1 means the data narrowed the prior; close to 1 means the prior is doing the work. γ and the jitter have no Laplace range here (γ sits at the boundary when the gate is off).</div>`;
}

/* ---- canvas cards: CWT scalogram and state-space landscape ------------------------------------------------------------------ */
const lutCache = {};
const STOPS = {
  inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 186, 47], [252, 235, 109], [252, 255, 164]],
  viridis: [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]],
  magma: [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]],
  mako: [[11, 4, 5], [43, 28, 53], [62, 53, 107], [53, 93, 150], [49, 130, 163], [53, 168, 171], [91, 204, 175], [170, 229, 190], [222, 245, 229]]
};
function lut(name) {
  name = name || cfgC().palette; if (lutCache[name]) return lutCache[name];
  const st = STOPS[name] || STOPS.inferno, out = [];
  for (let i = 0; i < 256; i++) { const t = i / 255 * (st.length - 1), k = Math.min(st.length - 2, Math.floor(t)), u = t - k; out.push(st[k].map((v, j) => Math.round(v + u * (st[k + 1][j] - v)))); }
  return (lutCache[name] = out);
}
const curLUT = () => lut();
const _l32 = {};
/** The current palette as packed 32-bit ABGR values (little-endian ImageData). */
function lut32() { const name = cfgC().palette; if (_l32[name]) return _l32[name]; return (_l32[name] = Uint32Array.from(lut(name), ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0)); }
let _cwtCache=null, _cwtRO=null, _cwtKey='', _cwtVer=0, _cwtHeatKey='', _cwtHeatCv=null;
const evKey=()=>{ const e=_bundle&&_bundle.events; return e?e.segments.map(s=>s.kind[0]+Math.round(s.from)+'-'+Math.round(s.to)).join(','):''; };
/** Heat-map of the log power at data resolution (cached per data and palette). Row 0 = highest frequency. */
function cwtHeat(){ const {logBPow,nS,nT,pMin,pRange}=_cwtCache, key=_cwtVer+'|'+cfgC().palette; if(_cwtHeatKey===key&&_cwtHeatCv) return _cwtHeatCv;
  const cv=_cwtHeatCv||doc.createElement('canvas'); cv.width=nT; cv.height=nS; const g=cv.getContext('2d'), img=g.createImageData(nT,nS), u32=new Uint32Array(img.data.buffer), L=lut32();
  for(let r=0;r<nS;r++){ const row=logBPow[r], o=r*nT; for(let t=0;t<nT;t++){ let n=(row[t]-pMin)/pRange; n=n<0?0:n>1?1:n; u32[o+t]=L[(n*255+0.5)|0]; } }
  g.putImageData(img,0,0); _cwtHeatKey=key; _cwtHeatCv=cv; return cv; }

function _renderCWT(){
  if(!_cwtCache) return;
  const canvas=doc.getElementById('chart-cwt'); if(!canvas) return;
  const cc=canvas.closest('.cc')||canvas.parentElement;
  const bodyEl=canvas.parentElement; if(!bodyEl.clientWidth) return;   // hidden tab: painted when it is shown (ResizeObserver / resizeVisible)
  const W=Math.max(bodyEl.clientWidth,250);

  const{bFreqs,logBPow,nS,nT,tMin,tMax,pMin,pRange}=_cwtCache;
  const c=tc();
  const isLight=doc.documentElement.dataset.theme==='light';

  // Layout constants (CSS-pixel / logical units — unaffected by DPR below)
  const PAD={top:12,bottom:40,left:50,right:56}; // right leaves room for colorbar
  const H=Math.max(bodyEl.clientHeight||350,220);
  const pW=W-PAD.left-PAD.right, pH=H-PAD.top-PAD.bottom;

  // ── HD/4K-capable backing store ──
  // Canvas width/height *attributes* size the actual pixel buffer; CSS
  // width/height size the on-page box. Pin the CSS box to the logical W×H
  // computed above, then give the buffer dpr× as many pixels per side so it
  // renders crisply on Retina/4K displays instead of being upscaled (and
  // blurred) by the compositor. Floored at 2x even when dpr=1 so the
  // hand-drawn scalogram/text are supersampled for extra smoothness on
  // standard displays too; capped at 3x so the O(pW·pH·dpr²) fill loop below
  // stays fast on very high-density screens.
  const dpr0=Math.min(Math.max(root.devicePixelRatio||1,2),3), dpr=(W*H>650000)?Math.min(dpr0,2):dpr0;   // bounded cost on big canvases
  const key=[W,H,dpr,isLight,cfgC().palette,_cwtVer,evKey()].join('|'); if(key===_cwtKey && canvas.width===Math.round(W*dpr)) return; _cwtKey=key;   // the bitmap survives display:none: nothing to redo
  canvas.style.width=W+'px';
  canvas.style.height=H+'px';
  canvas.width=Math.round(W*dpr);
  canvas.height=Math.round(H*dpr);
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr); // subsequent draw calls below use CSS-pixel coords again

  // Background
  ctx.fillStyle=isLight?'#FFFFFF':'#0B1120';
  ctx.fillRect(0,0,W,H);

  // ── Scalogram: the heat-map is built once at DATA resolution (nT × nS pixels) and scaled by the GPU (bilinear), instead of a per-pixel JS loop at screen resolution
  const fMinLog=Math.log(bFreqs[nS-1]);
  const fMaxLog=Math.log(bFreqs[0]);
  const logRange=fMaxLog-fMinLog+1e-12;
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(cwtHeat(),0,0,nT,nS,PAD.left,PAD.top,pW,pH);

  // Helper: freq (Hz) → canvas y coordinate
  const freqToY=f=>PAD.top+pH-((Math.log(f)-fMinLog)/logRange)*pH;

  // ── LF / HF band boundary dashed lines ──
  const bDef=[{f:0.04,col:c.red,lbl:'VLF│LF'},{f:0.15,col:c.teal,lbl:'LF│HF'},{f:0.40,col:c.teal,lbl:''}];
  ctx.save(); ctx.setLineDash([3,5]); ctx.lineWidth=1;
  for(const{f,col,lbl} of bDef){
    if(f<=bFreqs[nS-1]||f>=bFreqs[0]) continue;
    const y=freqToY(f);
    ctx.strokeStyle=col+'cc';
    ctx.beginPath(); ctx.moveTo(PAD.left,y); ctx.lineTo(PAD.left+pW,y); ctx.stroke();
    if(lbl){
      ctx.fillStyle=col+'cc'; ctx.font='8.5px '+Chart.defaults.font.family;
      ctx.textAlign='left'; ctx.fillText(lbl,PAD.left+4,y-2.5);
    }
  }
  ctx.restore();

  // Band mid-point labels (right edge)
  ctx.font='9px '+Chart.defaults.font.family; ctx.textAlign='right';
  const fBotLF=Math.max(0.04,bFreqs[nS-1]), fTopHF=Math.min(0.40,bFreqs[0]);
  if(bFreqs[nS-1]<0.15&&bFreqs[0]>0.04){
    const yMid=(freqToY(fBotLF)+freqToY(Math.min(0.15,bFreqs[0])))/2;
    ctx.fillStyle=c.red+'88'; ctx.fillText('LF',PAD.left+pW-4,yMid+3.5);
  }
  if(bFreqs[nS-1]<0.40&&bFreqs[0]>0.15){
    const yMid=(freqToY(Math.max(0.15,bFreqs[nS-1]))+freqToY(fTopHF))/2;
    ctx.fillStyle=c.teal+'88'; ctx.fillText('HF',PAD.left+pW-4,yMid+3.5);
  }

  // ── Y-axis: frequency ticks & labels ──
  ctx.fillStyle=c.tx2; ctx.font='10px '+Chart.defaults.font.family; ctx.textAlign='right';
  const fTicks=[0.04,0.10,0.15,0.25,0.40].filter(f=>f>bFreqs[nS-1]*1.05&&f<bFreqs[0]*0.95);
  for(const f of fTicks){
    const y=freqToY(f);
    ctx.fillText(f.toFixed(2),PAD.left-5,y+3.5);
    ctx.fillStyle=c.tx2; ctx.fillRect(PAD.left-3,y-.5,3,1);
    ctx.fillStyle=c.tx2;
  }
  // Y-axis title (rotated)
  ctx.save();
  ctx.fillStyle=c.tx2; ctx.font='10px '+Chart.defaults.font.family;
  ctx.translate(11,PAD.top+pH/2); ctx.rotate(-Math.PI/2);
  ctx.textAlign='center'; ctx.fillText('Frequency (Hz)',0,0);
  ctx.restore();

  // ── X-axis: time ticks & labels ──
  ctx.fillStyle=c.tx2; ctx.font='10px '+Chart.defaults.font.family; ctx.textAlign='center';
  const nXT=Math.min(8,Math.max(4,Math.floor(pW/65)));
  for(let i=0;i<=nXT;i++){
    const t=tMin+i*(tMax-tMin)/nXT;
    const x=PAD.left+(i/nXT)*pW;
    ctx.fillText(fmtT(t,tMax-tMin),x,H-11);
    ctx.fillRect(x-.5,PAD.top+pH,1,3);
  }
  ctx.fillText((tMax-tMin)>=180?'Time (min:s)':'Time (s)',PAD.left+pW/2,H-1);

  // ── Colorbar (right of plot) ──
  const cbX=PAD.left+pW+5, cbY=PAD.top, cbW=12, cbH=pH;
  for(let cy=0;cy<cbH;cy++){
    const n=1-cy/cbH; // top→high power, bottom→low power
    const[r,g,b]=curLUT()[Math.round(n*255)];
    ctx.fillStyle=`rgb(${r},${g},${b})`;
    ctx.fillRect(cbX,cbY+cy,cbW,1.5);
  }
  ctx.strokeStyle=c.bd; ctx.lineWidth=0.6; ctx.setLineDash([]);
  ctx.strokeRect(cbX,cbY,cbW,cbH);
  ctx.fillStyle=c.tx2; ctx.font='8.5px '+Chart.defaults.font.family; ctx.textAlign='left';
  ctx.fillText('High',cbX+cbW+2,cbY+8);
  ctx.fillText('Low', cbX+cbW+2,cbY+cbH-2);
  ctx.save();
  ctx.translate(cbX+cbW+16,cbY+cbH/2); ctx.rotate(-Math.PI/2);
  ctx.textAlign='center'; ctx.font='8px '+Chart.defaults.font.family;
  ctx.fillStyle=c.tx3; ctx.fillText('log power',0,0);
  ctx.restore();

  // ── Plot border ──
  ctx.strokeStyle=c.bd; ctx.lineWidth=1; ctx.setLineDash([]);
  ctx.strokeRect(PAD.left,PAD.top,pW,pH);
  if(_bundle && _bundle.events){ const ev=_bundle.events, cl=segColors(ev); ev.segments.slice(1).forEach((sg,i)=>{ const tt=sg.from, col=cl[i+1]; if(tt<tMin||tt>tMax) return; const x=PAD.left+(tt-tMin)/(tMax-tMin)*pW; ctx.save(); ctx.setLineDash([5,4]); ctx.strokeStyle=col; ctx.lineWidth=1.8; ctx.beginPath(); ctx.moveTo(x,PAD.top); ctx.lineTo(x,PAD.top+pH); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle=col; ctx.font='700 10px '+Chart.defaults.font.family; ctx.textAlign='left'; ctx.shadowColor='rgba(0,0,0,.6)'; ctx.shadowBlur=3; ctx.fillText(sg.name,x+5,PAD.top+13+(i%2)*12); ctx.restore(); }); }

}

function buildCWT(R) {
  const canvas = doc.getElementById('chart-cwt'); if (!canvas) return;
  if (_cwtCache !== R.cwt) { _cwtCache = R.cwt; _cwtVer++; _cwtKey = ''; }
  _renderCWT();
  if (!_cwtRO && root.ResizeObserver) { _cwtRO = new ResizeObserver(() => debounced('cwt', _renderCWT, 110)); _cwtRO.observe(canvas.parentElement || canvas); }
}
const _deb = {};
/** Trailing-edge debounce by name (used by the observers of the two hand-drawn canvases). */
function debounced(name, fn, ms) { clearTimeout(_deb[name]); _deb[name] = setTimeout(fn, ms); }
let _landSrc = null, _landRO = null, _landKey = '', _landVer = 0, _landHeatKey = '', _landHeatCv = null;
function landHeat(L) {
  const key = _landVer + '|' + cfgC().palette; if (_landHeatKey === key && _landHeatCv) return _landHeatCv;
  const N = L.gu.length, Ns = Math.min(240, N * 3), cv = _landHeatCv || doc.createElement('canvas'); cv.width = Ns; cv.height = Ns;
  const g = cv.getContext('2d'), img = g.createImageData(Ns, Ns), u32 = new Uint32Array(img.data.buffer), P = lut32(), pmax = L.potMax;
  for (let py = 0; py < Ns; py++) { const fv = (1 - py / (Ns - 1)) * (N - 1), j0 = Math.min(N - 2, Math.floor(fv)), b = fv - j0;
    for (let px = 0; px < Ns; px++) { const fu = px / (Ns - 1) * (N - 1), i0 = Math.min(N - 2, Math.floor(fu)), a = fu - i0;
      const U = L.pot[i0][j0] * (1 - a) * (1 - b) + L.pot[i0 + 1][j0] * a * (1 - b) + L.pot[i0][j0 + 1] * (1 - a) * b + L.pot[i0 + 1][j0 + 1] * a * b, k = Math.round((1 - U / pmax) * 255); u32[py * Ns + px] = P[k < 0 ? 0 : k > 255 ? 255 : k]; } }
  g.putImageData(img, 0, 0); _landHeatKey = key; _landHeatCv = cv; return cv;
}
function renderLandscape() {
  const R = _bundle; if (!R || !R.land) return; const L = R.land, cv = doc.getElementById('chart-landscape'); if (!cv) return;
  const body = cv.parentElement; if (!body.clientWidth) return;
  const W = Math.max(body.clientWidth, 260), H = Math.max(body.clientHeight, 220), dpr0 = Math.min(Math.max(root.devicePixelRatio || 1, 2), 3), dpr = (W * H > 650000) ? Math.min(dpr0, 2) : dpr0, c = tc(), A = ST.get('analysis'), ev = R.events, cols = ev ? segColors(ev) : null, light = isLight();
  if (!_landRO && root.ResizeObserver) { _landRO = new ResizeObserver(() => debounced('land', renderLandscape, 110)); _landRO.observe(body); }
  const key = [W, H, dpr, light, cfgC().palette, _landVer, evKey(), A.showFlow, A.showBasins, R.phases ? R.phases.map(q => q.cu && q.cu.toFixed(2)).join() : ''].join('|'); if (key === _landKey && cv.width === Math.round(W * dpr)) return; _landKey = key;
  cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const PAD = { l: 52, r: 62, t: 12, b: 40 }, pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b, N = L.gu.length, lt = curLUT();   // colour bar below uses lt
  ctx.fillStyle = light ? '#FFFFFF' : '#0D1424'; ctx.fillRect(0, 0, W, H);
  const X = u => PAD.l + (u - L.limits.u[0]) / (L.limits.u[1] - L.limits.u[0]) * pw, Y = v => PAD.t + ph - (v - L.limits.v[0]) / (L.limits.v[1] - L.limits.v[0]) * ph;
  const pmax = L.potMax;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(landHeat(L), 0, 0, landHeat(L).width, landHeat(L).height, PAD.l, PAD.t, pw, ph);
  ctx.save(); ctx.beginPath(); ctx.rect(PAD.l, PAD.t, pw, ph); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 0.7; ctx.beginPath();
  // iso-lines of U at 1, 2, ...: each cell is visited once and only the levels it crosses are traced (no per-cell allocations)
  for (let i = 0; i < N - 1; i++) { const r0 = L.pot[i], r1 = L.pot[i + 1];
    for (let j = 0; j < N - 1; j++) {
      const a = r0[j], b = r1[j], d = r1[j + 1], e = r0[j + 1], lo = Math.min(a, b, d, e), hi = Math.max(a, b, d, e); let lev = Math.floor(lo) + 1; if (lev < 1) lev = 1;
      for (; lev < pmax && lev <= hi; lev++) {
        if (lev <= lo) continue; const vs = [a, b, d, e], xs = [L.gu[i], L.gu[i + 1], L.gu[i + 1], L.gu[i]], ys = [L.gv[j], L.gv[j], L.gv[j + 1], L.gv[j + 1]]; let px0 = 0, py0 = 0, have = 0;
        for (let k = 0; k < 4; k++) { const p = vs[k], q = vs[(k + 1) % 4]; if ((p - lev) * (q - lev) < 0) { const t = (lev - p) / (q - p), X1 = xs[k] + t * (xs[(k + 1) % 4] - xs[k]), Y1 = ys[k] + t * (ys[(k + 1) % 4] - ys[k]); if (!have) { px0 = X1; py0 = Y1; have = 1; } else { ctx.moveTo(X(px0), Y(py0)); ctx.lineTo(X(X1), Y(Y1)); break; } } }
      } } }
  ctx.stroke();
  // trajectory: coloured by phase when known, else by time; white halo underneath keeps it readable on any heat colour
  const n = L.u.length, step = Math.max(1, Math.floor(n / 1800)), T = R.fit.time, vir = lut('viridis');
  const sm = (a, w) => { const o = new Array(a.length), h = Math.floor(w / 2); for (let i = 0; i < a.length; i++) { let s = 0, m = 0; for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) { s += a[j]; m++; } o[i] = s / m; } return o; };
  const pu = sm(L.u, 7), pv = sm(L.v, 7);                         // drawing only: a 7-beat moving average removes the beat-to-beat staircase
  const colAt = k => ev ? (cols[segIndexAt(T[k], ev)] || NEUTRAL) : (() => { const [r, g, b] = vir[Math.round(47 * k / Math.max(n - 1, 1)) * 255 / 47 | 0]; return `rgb(${r},${g},${b})`; })();
  // the trajectory is drawn as a few long paths (one per run of equal colour), not one stroke per segment
  const seg = (col, wdt) => { ctx.lineWidth = wdt; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; let cur = null, open = false;
    for (let k = 0; k + step < n; k += step) { const cc = typeof col === 'function' ? col(k) : col;
      if (cc !== cur) { if (open) ctx.stroke(); ctx.strokeStyle = cc; ctx.beginPath(); ctx.moveTo(X(pu[k]), Y(pv[k])); cur = cc; open = true; }
      ctx.lineTo(X(pu[k + step]), Y(pv[k + step])); }
    if (open) ctx.stroke(); };
  seg('rgba(255,255,255,.5)', 2.8); seg(colAt, 1.5);
  // mean flow: one arrow per well-visited cell, pointing where the states move next on average, length growing with speed; dark halo + white core stay visible on any heat colour
  if (A.showFlow && L.flow.length) {
    const spd = f => Math.hypot(f.du, f.dv), mx = Math.max(...L.flow.map(spd)) || 1, cellPx = Math.min(pw, ph) / L.flowBins, ru = L.limits.u[1] - L.limits.u[0], rv = L.limits.v[1] - L.limits.v[0];
    const arrow = (x0, y0, x1, y1, w, head) => { const a = Math.atan2(y1 - y0, x1 - x0); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - head * 0.6 * Math.cos(a), y1 - head * 0.6 * Math.sin(a)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45)); ctx.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill(); ctx.stroke(); };
    const items = L.flow.map(f => { const px = f.du / ru * pw, py = -f.dv / rv * ph, m = Math.hypot(px, py) || 1, len = cellPx * (0.45 + 0.75 * Math.sqrt(spd(f) / mx)), cx = X(f.u), cy = Y(f.v); return [cx - px / m * len / 2, cy - py / m * len / 2, cx + px / m * len / 2, cy + py / m * len / 2]; });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(8,12,24,.78)'; ctx.fillStyle = 'rgba(8,12,24,.78)'; items.forEach(q => arrow(q[0], q[1], q[2], q[3], 4.6, 9.5));
    ctx.strokeStyle = '#FFFFFF'; ctx.fillStyle = '#FFFFFF'; items.forEach(q => arrow(q[0], q[1], q[2], q[3], 2, 8));
  }
  // phase centroids, joined in the order of the protocol
  if (R.phases && ev) {
    const cs = R.phases.map((r, i) => ({ r, i })).filter(o => o.r.cu != null);
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.8;
    for (let i = 0; i < cs.length - 1; i++) { const x0 = X(cs[i].r.cu), y0 = Y(cs[i].r.cv), x1 = X(cs[i + 1].r.cu), y1 = Y(cs[i + 1].r.cv), a = Math.atan2(y1 - y0, x1 - x0); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - 8 * Math.cos(a), y1 - 8 * Math.sin(a)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 10 * Math.cos(a - .38), y1 - 10 * Math.sin(a - .38)); ctx.lineTo(x1 - 10 * Math.cos(a + .38), y1 - 10 * Math.sin(a + .38)); ctx.closePath(); ctx.fill(); }
    cs.forEach(o => { const r = o.r; ctx.beginPath(); ctx.arc(X(r.cu), Y(r.cv), 7.5, 0, 6.3); ctx.fillStyle = cols[o.i]; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = `700 10.5px ${FONT}`; ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4; ctx.fillText(r.name, X(r.cu) + 11, Y(r.cv) - 9); ctx.shadowBlur = 0; });
  } else { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(pu[0]), Y(pv[0]), 3.6, 0, 6.3); ctx.fill(); ctx.stroke(); }
  if (A.showBasins) L.basins.forEach(b => { ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(X(b.u), Y(b.v), 5, 0, 6.3); ctx.stroke(); });
  ctx.restore();
  if (A.showFlow && L.flow.length) { const lx = PAD.l + 10, ly = PAD.t + 10; ctx.save(); ctx.fillStyle = 'rgba(8,12,24,.72)'; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(lx - 6, ly - 4, 92, 22, 7) : ctx.rect(lx - 6, ly - 4, 92, 22)); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx, ly + 7); ctx.lineTo(lx + 17, ly + 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(lx + 22, ly + 7); ctx.lineTo(lx + 14, ly + 3); ctx.lineTo(lx + 14, ly + 11); ctx.closePath(); ctx.fill(); ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('mean flow', lx + 28, ly + 11); ctx.restore(); }
  ctx.strokeStyle = light ? 'rgba(15,27,45,.18)' : 'rgba(160,185,225,.22)'; ctx.lineWidth = 1; ctx.strokeRect(PAD.l, PAD.t, pw, ph); ctx.fillStyle = c.tx3; ctx.font = `10.5px ${FONT}`; ctx.textAlign = 'center';
  for (let k = 0; k <= 4; k++) { const u = L.limits.u[0] + (L.limits.u[1] - L.limits.u[0]) * k / 4, v = L.limits.v[0] + (L.limits.v[1] - L.limits.v[0]) * k / 4; ctx.fillText(u.toFixed(1), X(u), PAD.t + ph + 15); ctx.textAlign = 'right'; ctx.fillText(v.toFixed(1), PAD.l - 7, Y(v) + 3.5); ctx.textAlign = 'center'; }
  ctx.fillStyle = c.tx2; ctx.font = `500 11px ${FONT}`; ctx.fillText('x_p / σ_P   (vagal-like, in stationary SDs)', PAD.l + pw / 2, H - 6); ctx.save(); ctx.translate(12, PAD.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('x_s / σ_S   (sympathetic-like)', 0, 0); ctx.restore();
  const cbX = PAD.l + pw + 12; for (let y = 0; y < ph; y++) { const [r, g, b] = lt[Math.round((1 - y / ph) * 255)]; ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(cbX, PAD.t + ph - y - 1, 10, 1.5); }
  ctx.strokeStyle = light ? 'rgba(15,27,45,.18)' : 'rgba(160,185,225,.22)'; ctx.strokeRect(cbX, PAD.t, 10, ph); ctx.fillStyle = c.tx3; ctx.textAlign = 'left'; ctx.font = `10px ${FONT}`; ctx.fillText('U = 0', cbX + 14, PAD.t + ph - 2); ctx.fillText('U = ' + pmax, cbX + 14, PAD.t + 9);
  const note = doc.querySelector('.cc[data-chart="landscape"] .cc-note');
  if (note) note.innerHTML = `U = −ln(p/p<sub>max</sub>): bright = where the reconstructed states spend most time (basin). ${L.basins.length} basin${L.basins.length === 1 ? '' : 's'} above ${Math.round(100 * A.minBasin)}% of the peak density.${ev ? ' Path coloured by phase; large dots = phase centroids, joined in protocol order.' : ''} A descriptive map, not a fitted potential.`;
}

/* ============================================================================================================================ */
/*  REGISTRY and cards                                                                                                           */
/* ============================================================================================================================ */
const CARDS = [
  { id: 'rr', tab: 'signal', title: 'RR interval', sub: 'Observed beats, model-filtered series and its 95% credible band. Use the phase tool to mark rest, stress and recovery on it.', tip: 'c-rr', h: 300, span: 12, tools: [{ act: 'phases', title: 'Define rest / stress / recovery windows on this plot', icon: 'phases' }], build: buildRR },
  { id: 'cwt', tab: 'signal', title: 'Time-frequency scalogram', sub: 'Morlet wavelet power of heart rate (log colour scale)', tip: 'c-cwt', kind: 'cwt', h: 340, span: 12, build: buildCWT },
  { id: 'psd', tab: 'signal', title: 'Power spectrum', sub: 'Empirical vs reconstructed PSD of heart rate', tip: 'c-psd', h: 280, span: 6, build: buildPSD },
  { id: 'poincare', tab: 'signal', title: 'Poincaré plot', sub: 'Each beat against the next: observed and filtered RR', tip: 'c-poin', h: 280, span: 6, build: buildPoincare },
  { id: 'states', tab: 'autonomic', title: 'Latent autonomic drives', sub: 'Vagal-like and sympathetic-like drive with 95% credible bands', tip: 'c-states', h: 300, span: 12, build: buildStates },
  { id: 'phase', tab: 'autonomic', title: 'Phase map', sub: 'The two drives against each other; dashed rings = stationary 1–3 σ', tip: 'c-phase', square: true, span: 6, build: buildPhase },
  { id: 'landscape', tab: 'autonomic', title: 'State-space landscape', sub: 'Occupancy density, basins, mean flow and the trajectory', tip: 'c-land', square: true, span: 6, kind: 'landscape', note: true, build: R => { if (_landSrc !== R.land) { _landSrc = R.land; _landVer++; _landKey = ''; } renderLandscape(); } },
  { id: 'phasetable', tab: 'autonomic', title: 'Phase summary', sub: 'Heart rate, drives and displacement by protocol phase', tip: 'c-phtab', kind: 'html', span: 12, build: buildPhaseTable },
  { id: 'abi', tab: 'autonomic', title: 'Autonomic balance index', sub: 'Smoothed log ratio of vagal to sympathetic activation', tip: 'c-abi', h: 250, span: 6, build: R => areaChart('abi', R, R.dm.abi, 'Log balance (vagal / sympathetic)', tc().acc, 'ln f(x_p) / f(x_s)') },
  { id: 'totaldrive', tab: 'autonomic', title: 'Total drive magnitude', sub: 'Euclidean norm of the two drives', tip: 'c-tdrive', h: 250, span: 6, build: R => areaChart('totaldrive', R, R.dm.tad, 'Total drive ‖x‖', tc().amb, '‖x‖ (Hz)', { min: 0 }) },
  { id: 'epr', tab: 'autonomic', title: 'Entropy production rate', sub: 'Instantaneous allostatic-cost proxy', tip: 'c-epr', h: 250, span: 6, build: R => signedChart('epr', R, R.dm.epr, 'Load (ṡ > 0)', 'Recovery (ṡ < 0)', 'Entropy production rate ṡ(t)', tc().pur, 'ṡ(t)  (s⁻¹)') },
  { id: 'arealvel', tab: 'autonomic', title: 'Phase-plane areal velocity', sub: 'Instantaneous rotation rate of the trajectory', tip: 'c-avel', h: 250, span: 6, build: R => signedChart('arealvel', R, R.dm.arealVel, 'Counter-clockwise (+)', 'Clockwise (−)', 'Areal velocity dA/dt', tc().grn, 'dA/dt (Hz²·s⁻¹)') },
  { id: 'gain', tab: 'model', title: 'Causal vagal variance gate', sub: 'Multiplier g_k of the vagal drive variance at each beat', tip: 'c-gain', h: 260, span: 12, note: true, build: buildGain },
  { id: 'partition', tab: 'model', title: 'Spectral anchor', sub: 'Logistic vagal / sympathetic split of the wavelet power', tip: 'c-part', h: 280, span: 6, note: true, build: buildPartition },
  { id: 'ellipse', tab: 'model', title: 'τ_P – τ_S regions', sub: 'Prior and Laplace posterior (50% and 95%)', tip: 'c-ell', h: 280, span: 6, build: buildEllipse },
  { id: 'pp-taup', tab: 'model', title: 'Vagal time constant τ_P', sub: 'Prior versus posterior', tip: 'c-pp', h: 220, span: 6, build: buildTauPost('p') },
  { id: 'pp-taus', tab: 'model', title: 'Sympathetic time constant τ_S', sub: 'Prior versus posterior', tip: 'c-pp', h: 220, span: 6, build: buildTauPost('s') },
  { id: 'pp-jit', tab: 'model', title: 'RR timing jitter', sub: 'Prior versus estimate', tip: 'c-pp', h: 220, span: 6, build: buildJitterPost },
  { id: 'pp-gamma', tab: 'model', title: 'Gate gain γ', sub: 'Lomax prior versus estimate', tip: 'c-pp', h: 220, span: 6, build: buildGammaPost },
  { id: 'corrmat', tab: 'model', title: 'Parameter correlation', sub: 'κ_S, κ_P, Λ_R, γ (inverse Hessian)', tip: 'c-corr', kind: 'html', span: 6, build: buildCorrMatrix },
  { id: 'postsummary', tab: 'model', title: 'Prior and posterior summary', sub: 'What the data added to each prior', tip: 'c-post', kind: 'html', span: 6, build: buildPostSummary },
  { id: 'hrvtable', tab: 'stats', title: 'Conventional HRV statistics', sub: 'Observed versus model-filtered RR', tip: 'c-hrv', kind: 'html', h: 300, span: 6, build: buildHRVTable },
  { id: 'rolling', tab: 'stats', title: 'Rolling statistics', sub: 'Sliding-window heart rate, SDNN or RMSSD', tip: 'c-roll', h: 300, span: 6, select: [['hr', 'Heart rate'], ['sdnn', 'SDNN'], ['rmssd', 'RMSSD']], build: buildRolling },
  { id: 'phasehrv', tab: 'stats', title: 'Conventional statistics per window', sub: 'Observed and filtered HRV in each phase, with the whole recording for reference', tip: 'c-phhrv', kind: 'html', span: 12, build: buildPhaseHRV },
  { id: 'xcorr', tab: 'stats', title: 'Cross-correlation of the drives', sub: 'x_p against x_s at lags of ±40 beats', tip: 'c-xc', h: 250, span: 6, build: buildXcorr },
  { id: 'acf', tab: 'stats', title: 'Innovation autocorrelation', sub: 'Lags 1–40; bars beyond the band are significant', tip: 'c-acf', h: 250, span: 6, build: buildACF },
  { id: 'hist', tab: 'diag', title: 'Standardized innovations', sub: 'Distribution against N(0,1)', tip: 'c-hist', h: 250, span: 6, build: buildHist },
  { id: 'qq', tab: 'diag', title: 'Normal Q–Q plot', sub: 'Innovation quantiles against normal quantiles', tip: 'c-qq', h: 250, span: 6, build: buildQQ },
  { id: 'pacf', tab: 'diag', title: 'Partial autocorrelation', sub: 'Innovations, lags 1–40', tip: 'c-pacf', h: 250, span: 6, build: buildPACF },
  { id: 'ks', tab: 'diag', title: 'Time-rescaling KS plot', sub: 'Empirical CDF of the transformed innovations', tip: 'c-ks', h: 250, span: 6, build: buildKS }
];
const ICON = { png: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>', full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>', hide: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-3 3.5M6.5 8C4.4 9.6 3 12 3 12s4 6 9 6a9 9 0 0 0 3-.5"/></svg>', width: '<svg viewBox="0 0 24 24"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>', phases: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="6" height="12" rx="1.5"/><rect x="10" y="6" width="5" height="12" rx="1.5"/><rect x="16" y="6" width="5" height="12" rx="1.5"/></svg>' };

function mountCards() {
  CARDS.forEach(card => {
    const grid = doc.getElementById('grid-' + card.tab); if (!grid || doc.querySelector(`.cc[data-chart="${card.id}"]`)) return;
    const lay = ST.Layout.get(card.id), el = doc.createElement('div');
    el.className = 'cc'; el.dataset.chart = card.id; el.dataset.span = String(lay.span || card.span || 6);
    const png = card.kind === 'html' ? '' : `<button class="tool" data-act="png" title="Save as PNG" aria-label="Save ${card.title} as PNG">${ICON.png}</button>`;
    const sel = card.select ? `<select class="mini" aria-label="Metric">${card.select.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : '';
    el.innerHTML = `<div class="cc-head"><div class="cc-lbl"><div class="cc-text"><span class="cc-title" title="${card.title}">${card.title}</span><span class="cc-sub">${card.sub || ''}</span></div><button class="info-btn" data-tip="${card.tip}" aria-label="About this chart">i</button></div>
      <div class="cc-tools">${sel}${(card.tools || []).map(t => `<button class="tool" data-act="${t.act}" title="${t.title}" aria-label="${t.title}" aria-pressed="false">${ICON[t.icon]}</button>`).join('')}${png}<button class="tool" data-act="width" title="Toggle width" aria-label="Toggle width">${ICON.width}</button><button class="tool" data-act="full" title="Fullscreen" aria-label="Fullscreen">${ICON.full}</button><button class="tool" data-act="hide" title="Hide chart" aria-label="Hide chart">${ICON.hide}</button></div></div>
      <div class="cc-body${card.kind === 'html' ? ' auto' : ''}${card.square && !lay.h ? ' sq' : ''}" style="--h:${lay.h || card.h || (card.kind === 'html' ? 0 : 360)}px">${card.kind === 'html' ? '' : `<canvas id="chart-${card.id}"></canvas>`}</div>${card.note ? '<div class="cc-note"></div>' : ''}${card.kind === 'html' ? '' : '<div class="cc-resize" title="Drag to resize"></div>'}`;
    grid.appendChild(el);
    if (ST.get('charts.hidden')[card.id]) el.classList.add('is-hidden');
    el.querySelector('.cc-tools').addEventListener('click', ev => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'full') { el.classList.toggle('fullscreen'); }                     // the cards' own ResizeObservers repaint what needs it
      else if (b.dataset.act === 'hide') { setHidden(card.id, true); }
      else if (b.dataset.act === 'width') { const next = el.dataset.span === '12' ? '6' : '12'; el.dataset.span = next; ST.Layout.set(card.id, { span: +next }); balanceGrids(); }
      else if (b.dataset.act === 'png' && root.SparkExport) root.SparkExport.chartPNG(card.id);
      else doc.dispatchEvent(new root.CustomEvent('spark:card', { detail: { id: card.id, act: b.dataset.act, el, button: b } }));   // card-specific tools (e.g. the phase editor)
    });
    const s = el.querySelector('select.mini'); if (s) s.addEventListener('change', () => { invalidate([card.id]); ensureTab(card.tab); });
    const h = el.querySelector('.cc-resize');
    if (h) h.addEventListener('pointerdown', ev => {
      ev.preventDefault(); h.setPointerCapture(ev.pointerId); const body = el.querySelector('.cc-body'), y0 = ev.clientY, h0 = body.getBoundingClientRect().height; body.classList.remove('sq'); body.style.setProperty('--h', Math.round(h0) + 'px');
      const mv = e => { body.style.setProperty('--h', Math.max(120, Math.round(h0 + e.clientY - y0)) + 'px'); };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); ST.Layout.set(card.id, { h: Math.round(body.getBoundingClientRect().height) }); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    });
  });
}
/** Rows must be full: in a two-column grid a half-width card that would stand alone in its row spans the whole row (class "fill"). */
function balanceGrids() {
  doc.querySelectorAll('.cc-grid').forEach(grid => {
    const cards = Array.from(grid.children).filter(x => x.classList.contains('cc') && !x.classList.contains('is-hidden')); let open = null;
    cards.forEach(x => x.classList.remove('fill'));
    cards.forEach(x => { if (x.dataset.span === '12') { if (open) { open.classList.add('fill'); open = null; } } else if (open) open = null; else open = x; });
    if (open) open.classList.add('fill');
  });
}
/** Re-apply the saved (or default) widths and heights, e.g. after "Reset chart sizes". */
function applyLayout() {
  CARDS.forEach(card => { const el = doc.querySelector(`.cc[data-chart="${card.id}"]`); if (!el) return; const l = ST.Layout.get(card.id), body = el.querySelector('.cc-body'); el.dataset.span = String(l.span || card.span || 6); body.style.setProperty('--h', (l.h || card.h || (card.kind === 'html' ? 0 : 360)) + 'px'); body.classList.toggle('sq', !!card.square && !l.h); });
  balanceGrids(); setTimeout(resizeAll, 30);
}
function setHidden(id, hidden) { const m = Object.assign({}, ST.get('charts.hidden')); if (hidden) m[id] = true; else delete m[id]; ST.set('charts.hidden', m, true); ST.save(); const el = doc.querySelector(`.cc[data-chart="${id}"]`); if (el) el.classList.toggle('is-hidden', !!hidden); balanceGrids(); if (!hidden && _bundle) { invalidate([id]); ensureTab(CARDS.find(x => x.id === id).tab); } }
/* ---- build lifecycle: only what is on screen is built, in slices after the browser has painted ------------------------------------------------
   A card is "dirty" when its picture is out of date (new data, theme, phases, settings). Opening a tab builds that tab's dirty cards one per task,
   so a click is answered at once and the charts appear progressively; hidden tabs are built when they are opened. flush() builds everything
   synchronously (tests, exports). */
const _dirty = new Set(); let _tok = 0, _loop = Promise.resolve();
const NEEDS = { cwt: ['cwt'], psd: ['psd'], landscape: ['land'], hrvtable: ['hrvObs', 'hrvFlt'], rolling: ['roll'] };           // derived data that a worker may still be preparing
const PHASE_CARDS = ['rr', 'states', 'phase', 'landscape', 'phasetable', 'abi', 'totaldrive', 'epr', 'arealvel', 'gain', 'poincare', 'rolling', 'cwt'];
const isHidden = id => !!ST.get('charts.hidden')[id];
const activeTab = () => { const p = doc.querySelector('.tab-panel.active'); return p ? p.id.replace('tab-', '') : null; };
const nextTask = () => new Promise(r => setTimeout(r, 0));
/** Resolve after the next frame has been presented (so that an interaction is answered before heavy work starts). */
const afterPaint = () => new Promise(r => { const idle = () => (root.requestIdleCallback ? root.requestIdleCallback(() => r(), { timeout: 250 }) : setTimeout(r, 40)); if (root.requestAnimationFrame) root.requestAnimationFrame(() => root.requestAnimationFrame(() => setTimeout(idle, 0))); else idle(); });   // two frames, then an idle moment: the frame that answers the interaction has been presented
const inputPending = () => { try { return !!(root.navigator && root.navigator.scheduling && root.navigator.scheduling.isInputPending && root.navigator.scheduling.isInputPending()); } catch (e) { return false; } };
const pendingMark = (id, on) => { const b = doc.querySelector(`.cc[data-chart="${id}"] .cc-body`); if (b) b.classList.toggle('pending', on); };
/** Mark cards (default: all) as out of date. */
function invalidate(ids) { (ids || CARDS.map(c => c.id)).forEach(id => _dirty.add(id)); }
function buildOne(card) {
  const R = _bundle; if (!R || isHidden(card.id)) { _dirty.delete(card.id); return; }
  try { if (card.kind !== 'html' && card.kind !== 'cwt' && card.kind !== 'landscape') ensureCanvas(card.id); card.build(R); }
  catch (e) { console.error('Chart ' + card.id + ' failed:', e); const b = doc.querySelector(`.cc[data-chart="${card.id}"] .cc-body`); if (b) b.innerHTML = `<div class="empty-card">Could not draw this chart: ${String(e.message).replace(/</g, '&lt;')}</div>`; }
  _dirty.delete(card.id); pendingMark(card.id, false);
}
/** Build the out-of-date cards of a tab, one per task, on-screen ones first. Newer requests supersede older ones. */
function ensureTab(tab, now) {
  tab = tab || activeTab(); if (!tab || !_bundle) return Promise.resolve();
  const todo = () => CARDS.filter(c => c.tab === tab && _dirty.has(c.id) && !isHidden(c.id)); if (!todo().length) return _loop;
  const my = ++_tok; todo().forEach(c => pendingMark(c.id, true));
  const run = async () => {
    if (!now) await afterPaint(); if (my !== _tok) return;
    const vh = root.innerHeight || 800, order = todo().map(c => { const el = doc.querySelector(`.cc[data-chart="${c.id}"]`); return { c, near: el && el.getBoundingClientRect().top < vh + 150 ? 0 : 1 }; }).sort((a, b) => a.near - b.near).map(o => o.c);
    for (const card of order) {
      if (my !== _tok) return; const R = _bundle; if (!R) return;
      if (NEEDS[card.id] && R.extrasPending) await R.extrasReady;              // the worker is still preparing this card's data
      if (my !== _tok) return; if (!now && inputPending()) { await nextTask(); if (my !== _tok) return; } buildOne(card); if (!now) await nextTask();
    }
    if (tab === activeTab()) layoutSoon();
  };
  return (_loop = run());
}
/** Build every out-of-date card of every tab now (tests, exports). */
function flush() { _tok++; CARDS.forEach(c => { if (_dirty.has(c.id)) buildOne(c); }); }
const whenIdle = () => _loop.then(() => nextTask()).then(() => _loop);
/** Make a card's tab visible while fn runs (hidden tabs have no size: exports need one). */
function withVisible(id, fn) {
  const card = CARDS.find(c => c.id === id), panel = card && doc.getElementById('tab-' + card.tab), was = panel && panel.classList.contains('active');
  if (!panel || was) return fn();
  const cur = doc.querySelector('.tab-panel.active'); if (cur) cur.classList.remove('active'); panel.classList.add('active');
  try { if (_dirty.has(id)) buildOne(card); const ch = _ch[id]; if (ch) ch.resize(); return fn(); } finally { panel.classList.remove('active'); if (cur) cur.classList.add('active'); }
}
/** Build and destroy a few throw-away charts of the kinds used here, one per task, so that the first real chart is not the first run of the Chart.js code paths. */
let _warm = false;
function warmUp() {
  if (_warm || !root.Chart) return; _warm = true; chartDefaults();
  const n = 500, pts = Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i / 20) })), mkcv = () => { const cv = doc.createElement('canvas'); cv.width = 420; cv.height = 220; return cv; };
  const cfgs = [
    () => ({ type: 'line', data: { datasets: [ln('a', pts, '#3388ff'), ln('b', pts, '#ff6655')] }, options: { responsive: false, animation: false, scales: { x: axisX('t', { type: 'linear', min: 0, max: n }), y: axisY('y') }, plugins: { legend: { labels: { filter: it => it.text !== '' } } } }, plugins: [crosshair] }),
    () => ({ type: 'scatter', data: { datasets: [{ label: 'a', data: pts.slice(1), showLine: true, pointRadius: 0, borderColor: '#3388ff' }] }, options: { responsive: false, animation: false, scales: { x: axisXY('x', { type: 'logarithmic', min: 1, max: n }), y: axisXY('y') } } }),
    () => ({ type: 'bar', data: { labels: pts.slice(0, 40).map((_, i) => i), datasets: [{ label: 'a', data: pts.slice(0, 40).map(p => p.y), backgroundColor: '#3388ff88' }] }, options: { responsive: false, animation: false, scales: { x: axisX('x'), y: axisY('y') } } })
  ];
  (async () => { for (const f of cfgs) { await nextTask(); try { const cv = mkcv(), ch = new Chart(cv.getContext('2d'), f()); ch.draw(); ch.destroy(); } catch (e) { /* warming is best effort */ } } })();
}
/** Resize the Chart.js charts whose container size actually changed. */
function resizeCharts() { Object.values(_ch).forEach(ch => { try { const p = ch.canvas && ch.canvas.parentElement; if (!p || !ch.canvas.isConnected || ch.canvas.offsetParent === null) return; if (Math.abs(ch.width - p.clientWidth) > 1 || Math.abs(ch.height - p.clientHeight) > 1) ch.resize(); } catch (_) { /* ignore */ } }); }
/** Repaint the hand-drawn canvases (each skips the work when nothing changed). */
function resizeAll() { resizeCharts(); _renderCWT(); renderLandscape(); }
/** After the next paint: fix sizes. */
function layoutSoon() { afterPaint().then(() => { _renderCWT(); renderLandscape(); }); }       // charts follow their containers by themselves (ResizeObserver); the two hand-drawn canvases skip the work unless their size changed
/** New result bundle (or a change that affects every picture, e.g. the theme): everything is out of date; the visible tab is rebuilt at once. */
function buildAll(R, only) {
  _bundle = R; chartDefaults(); balanceGrids();
  if (only) { invalidate([only]); return ensureTab(CARDS.find(c => c.id === only).tab, true); }
  invalidate(); return ensureTab(activeTab());
}
/** Phases changed. Charts whose plugin reads the phases at draw time just need a redraw; the others are rebuilt (visible tab now, the rest when opened). */
const PHASE_REDRAW = ['rr', 'states', 'abi', 'totaldrive', 'epr', 'arealvel', 'gain', 'rolling'], PHASE_REBUILD = ['phase', 'poincare', 'phasetable', 'phasehrv', 'cwt', 'landscape'];
function refreshPhases() {
  PHASE_REDRAW.forEach(id => { const ch = _ch[id]; if (ch && !_dirty.has(id) && ch.canvas.offsetParent !== null) { try { ch.draw(); } catch (e) { invalidate([id]); } } else invalidate([id]); });
  invalidate(PHASE_REBUILD); return ensureTab(activeTab());
}
function getCanvas(id) { return doc.getElementById('chart-' + id); }
function chartList() {
  const w = doc.createElement('div'); w.className = 'chk-list';
  CARDS.forEach(c => { const l = doc.createElement('label'), i = doc.createElement('input'); i.type = 'checkbox'; i.checked = !ST.get('charts.hidden')[c.id]; i.addEventListener('change', () => setHidden(c.id, !i.checked)); l.appendChild(i); l.appendChild(doc.createTextNode(c.title)); w.appendChild(l); });
  return w;
}

root.SparkCharts = { warmUp, CARDS, mountCards, applyLayout, balanceGrids, buildAll, ensureTab, invalidate, refreshPhases, flush, whenIdle, withVisible, layoutSoon, resizeAll, resizeCharts, getCanvas, chartList, setHidden, chartDefaults, tc, css, renderLandscape, renderCWT: () => _renderCWT(), charts: _ch, lut, STOPS, segColors, segIndexAt, NEUTRAL, chartFor: id => _ch[id], bundle: () => _bundle };
})(typeof window !== 'undefined' ? window : globalThis);

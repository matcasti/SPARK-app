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
/** Phase colours (rest / exercise / recovery), tuned per theme. */
function phaseColors() { return isLight() ? { rest: '#2F6FE4', exercise: '#E8761A', recovery: '#14976A' } : { rest: '#5B9CFF', exercise: '#FFA24D', recovery: '#39D69B' }; }
const PHASE_NAMES = { rest: 'Rest', exercise: 'Exercise', recovery: 'Recovery' };
function phaseOf(t, ev) { return !ev ? null : t < ev.t_on ? 'rest' : t < ev.t_off ? 'exercise' : 'recovery'; }

function chartDefaults() {
  if (!root.Chart) return; const c = tc(), light = isLight();
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
const ln = (label, data, color, o) => Object.assign({ label, data, borderColor: color, backgroundColor: color, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color, borderWidth: cfgC().lineWidth }, o);
const band = (hi, lo, color) => [{ label: '', data: hi, borderColor: 'transparent', backgroundColor: color, pointRadius: 0, fill: false, order: 9 }, { label: '', data: lo, borderColor: 'transparent', backgroundColor: color, pointRadius: 0, fill: '-1', order: 9 }];
function gradient(color, a0, a1) { return cx => { const ch = cx.chart, ca = ch.chartArea; if (!ca) return withA(color, '22'); const g = ch.ctx.createLinearGradient(0, ca.top, 0, ca.bottom); g.addColorStop(0, withA(color, a0 || '55')); g.addColorStop(1, withA(color, a1 || '03')); return g; }; }
function mk(id, cfg) {
  destroyChart(id); const cv = doc.getElementById('chart-' + id); if (!cv || !root.Chart) return null;
  if (!cfg.options) cfg.options = baseOpts(); _ch[id] = new Chart(cv, cfg); return _ch[id];
}
function destroyChart(id) { if (_ch[id]) { _ch[id].destroy(); delete _ch[id]; } }
function setEmpty(id, msg) { const b = doc.querySelector(`.cc[data-chart="${id}"] .cc-body`); if (b) b.innerHTML = `<div class="empty-card">${msg}</div>`; }
function ensureCanvas(id) { const b = doc.querySelector(`.cc[data-chart="${id}"] .cc-body`); if (b && !b.querySelector('canvas') && !b.classList.contains('auto')) b.innerHTML = `<canvas id="chart-${id}"></canvas>`; }
function baseOpts(extra) {
  return deepMerge({ responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { top: 2, right: 6, bottom: 0, left: 0 } }, plugins: { legend: { labels: { filter: it => it.text !== '' } } }, scales: { x: axisX(), y: axisY() } }, extra || {});
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
/** Shaded rest / exercise / recovery bands behind a time-series chart. */
function phasePlugin(R) {
  return { id: 'phaseBands', beforeDatasetsDraw(ch) {
    const ev = R.events; if (!ev) return; const x = ch.scales.x, ca = ch.chartArea; if (!x) return; const pc = phaseColors(), ctx = ch.ctx, T = R.fit.time, tEnd = T[T.length - 1];
    const seg = [['rest', 0, ev.t_on], ['exercise', ev.t_on, ev.t_off], ['recovery', ev.t_off, tEnd]];
    ctx.save(); ctx.beginPath(); ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top); ctx.clip();
    seg.forEach(([k, a, b]) => { const x0 = Math.max(ca.left, x.getPixelForValue(a)), x1 = Math.min(ca.right, x.getPixelForValue(b)); if (x1 <= x0) return;
      ctx.fillStyle = withA(pc[k], isLight() ? '14' : '17'); ctx.fillRect(x0, ca.top, x1 - x0, ca.bottom - ca.top);
      ctx.fillStyle = withA(pc[k], 'D0'); ctx.font = `600 9.5px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(PHASE_NAMES[k].toUpperCase(), (x0 + x1) / 2, ca.top + 12); });
    ctx.restore(); } };
}
const tsPlugins = R => [crosshair, phasePlugin(R)];

/* ============================================================================================================================ */
/*  BUILDERS                                                                                                                     */
/* ============================================================================================================================ */
function buildRR(R) {
  const { fit } = R, c = tc(), S = ST.colors().S, z = 1.96, idx = thinIdx(fit.dy.length), up = [], lo = [];
  const irr = pick(fit.irr, idx), rv = pick(fit.rrV, idx), dy = pick(fit.dy, idx), gt = pick(fit.gate, idx), t = pick(fit.time, idx);
  for (let i = 0; i < irr.length; i++) { const s = z * Math.sqrt(Math.max(rv[i], 0)); up.push({ x: t[i], y: irr[i] + s }); lo.push({ x: t[i], y: irr[i] - s }); }
  const ds = cfgC().showCI ? band(up, lo, withA(S, '26')) : [{ label: '', data: [], hidden: true }, { label: '', data: [], hidden: true }];
  ds.push(ln('Observed RR', t.map((x, i) => ({ x, y: dy[i] })), withA(c.tx2, '99'), { borderWidth: 1, order: 5 }), ln('Filtered RR', t.map((x, i) => ({ x, y: irr[i] })), S, { borderWidth: cfgC().lineWidth + 0.3, order: 2 }),
    { label: 'Artifact-gated beat', data: t.map((x, i) => gt[i] > fit.ctl.diag_gate_max ? { x, y: dy[i] } : { x, y: null }), borderColor: 'transparent', backgroundColor: c.amb, pointRadius: 3.5, pointStyle: 'triangle', showLine: false, order: 1 });
  mk('rr', { type: 'line', data: { datasets: ds }, options: timeOpts(R, 'RR interval (s)'), plugins: tsPlugins(R) });
}
function buildStates(R) {
  const { fit } = R, col = ST.colors(), z = 1.96, idx = thinIdx(fit.dy.length), t = pick(fit.time, idx), Xp = pick(fit.Xp, idx), Xs = pick(fit.Xs, idx), pv = pick(fit.XpV, idx), sv = pick(fit.XsV, idx), ds = [];
  if (cfgC().showCI) {
    ds.push(...band(t.map((x, i) => ({ x, y: Xs[i] + z * Math.sqrt(Math.max(sv[i], 0)) })), t.map((x, i) => ({ x, y: Xs[i] - z * Math.sqrt(Math.max(sv[i], 0)) })), withA(col.S, '1F')),
            ...band(t.map((x, i) => ({ x, y: Xp[i] + z * Math.sqrt(Math.max(pv[i], 0)) })), t.map((x, i) => ({ x, y: Xp[i] - z * Math.sqrt(Math.max(pv[i], 0)) })), withA(col.P, '24')));
  }
  ds.push(ln('Parasympathetic (vagal-like) x_p', t.map((x, i) => ({ x, y: Xp[i] })), col.P), ln('Sympathetic x_s', t.map((x, i) => ({ x, y: Xs[i] })), col.S, { borderWidth: cfgC().lineWidth + 0.4 }));
  mk('states', { type: 'line', data: { datasets: ds }, options: timeOpts(R, 'Drive (Hz)'), plugins: tsPlugins(R) });
}
/** Phase map: the two drives against each other; coloured by phase when known, otherwise by time. */
function buildPhase(R) {
  const { fit, events: ev, phases } = R, c = tc(), N = fit.Xp.length, p = fit.params, sdP = Math.sqrt(p.lp * p.sig2), sdS = Math.sqrt(p.sig2), pc = phaseColors();
  const idx = thinIdx(N), n = idx ? idx.length : N, at = i => idx ? idx[i] : i, light = isLight(), lutV = lut('viridis');
  const ell = { id: 'ellipses', afterDraw: ch => {
    const { ctx, chartArea: ca, scales: { x, y } } = ch; ctx.save(); ctx.beginPath(); ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top); ctx.clip();
    ctx.setLineDash([2, 5]); ctx.strokeStyle = light ? 'rgba(15,27,45,.14)' : 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; const ox = x.getPixelForValue(0), oy = y.getPixelForValue(0);
    ctx.beginPath(); ctx.moveTo(ca.left, oy); ctx.lineTo(ca.right, oy); ctx.moveTo(ox, ca.top); ctx.lineTo(ox, ca.bottom); ctx.stroke();
    [[1.517, .34], [2.448, .22], [3.413, .13]].forEach(([r, a], i) => { ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.strokeStyle = light ? `rgba(20,40,80,${a})` : `rgba(180,210,255,${a})`;
      for (let k = 0; k <= 90; k++) { const th = 2 * Math.PI * k / 90, px = x.getPixelForValue(sdP * r * Math.cos(th)), py = y.getPixelForValue(sdS * r * Math.sin(th)); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.stroke(); if (i === 2) { ctx.setLineDash([]); ctx.fillStyle = light ? 'rgba(20,40,80,.55)' : 'rgba(180,210,255,.55)'; ctx.font = `500 9px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText('stationary 1–3 σ', x.getPixelForValue(sdP * r * 0.96), y.getPixelForValue(sdS * r * 0.30) - 5); ctx.textAlign = 'left'; } });
    // phase centroids and the path between them
    if (phases && ev) { const pts = phases.filter(r => r.cu != null).map(r => [r.xp, r.xs, r.name]); const keys = ['rest', 'exercise', 'recovery'];
      ctx.setLineDash([]); ctx.lineWidth = 1.6; ctx.strokeStyle = light ? 'rgba(15,27,45,.55)' : 'rgba(235,242,255,.7)';
      for (let i = 0; i < pts.length - 1; i++) { const x0 = x.getPixelForValue(pts[i][0]), y0 = y.getPixelForValue(pts[i][1]), x1 = x.getPixelForValue(pts[i + 1][0]), y1 = y.getPixelForValue(pts[i + 1][1]), a = Math.atan2(y1 - y0, x1 - x0);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 9 * Math.cos(a - .4), y1 - 9 * Math.sin(a - .4)); ctx.lineTo(x1 - 9 * Math.cos(a + .4), y1 - 9 * Math.sin(a + .4)); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
      pts.forEach((q, i) => { const px = x.getPixelForValue(q[0]), py = y.getPixelForValue(q[1]); ctx.beginPath(); ctx.arc(px, py, 7, 0, 6.3); ctx.fillStyle = pc[keys[i]]; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = light ? '#fff' : '#0D1424'; ctx.stroke(); ctx.fillStyle = light ? '#0F1B2D' : '#EAF1FC'; ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(q[2], px + 10, py - 8); }); }
    ctx.restore(); } };
  const tipCb = { callbacks: { title: () => '', label: c => ` ${c.dataset.label}: x_p ${c.parsed.x.toFixed(3)} Hz, x_s ${c.parsed.y.toFixed(3)} Hz` } };
  let datasets;
  if (ev) {
    datasets = ['rest', 'exercise', 'recovery'].map(k => { const ii = []; for (let i = 0; i < n; i++) if (phaseOf(fit.time[at(i)], ev) === k) ii.push(i); const d = ii.map(i => ({ x: fit.Xp[at(i)], y: fit.Xs[at(i)] }));
      return { label: PHASE_NAMES[k], data: d, showLine: true, borderColor: withA(pc[k], '66'), borderWidth: 0.9, backgroundColor: withA(pc[k], 'CC'), pointBackgroundColor: withA(pc[k], 'CC'), pointRadius: 2.2, pointHoverRadius: 4.5, tension: 0 }; });
  } else {
    const col = i => { const [r, g, b] = lutV[Math.round(255 * at(i) / Math.max(N - 1, 1))]; return `rgb(${r},${g},${b})`; }, pts = Array.from({ length: n }, (_, i) => ({ x: fit.Xp[at(i)], y: fit.Xs[at(i)] }));
    datasets = [{ label: 'Trajectory (early → late)', data: pts, showLine: true, borderColor: withA(c.tx2, '44'), borderWidth: 0.8, pointBackgroundColor: pts.map((_, i) => col(i)), pointRadius: 2.2, pointHoverRadius: 4.5, segment: { borderColor: cx => { const [r, g, b] = lutV[Math.round(255 * at(cx.p0DataIndex) / Math.max(N - 1, 1))]; return `rgba(${r},${g},${b},.45)`; } } }];
  }
  mk('phase', { type: 'scatter', data: { datasets }, options: baseOpts({ interaction: { mode: 'nearest', intersect: true }, plugins: { tooltip: tipCb, legend: { display: !!ev } }, scales: { x: axisXY('Parasympathetic drive x_p (Hz)'), y: axisXY('Sympathetic drive x_s (Hz)') } }), plugins: [ell] });
}
function areaChart(id, R, data, label, color, ytitle, o, tipDigits) {
  const idx = thinIdx(data.length), t = pick(R.fit.time, idx), d = pick(data, idx);
  mk(id, { type: 'line', data: { datasets: [ln(label, t.map((x, i) => ({ x, y: d[i] })), color, { backgroundColor: gradient(color), fill: 'origin', borderWidth: cfgC().lineWidth + 0.2 })] }, options: timeOpts(R, ytitle, { scales: { y: o || {} }, plugins: { legend: { display: false } } }), plugins: tsPlugins(R) });
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
  mk('psd', { type: 'scatter', data: { datasets: [{ type: 'line', showLine: true, label: 'Empirical PSD', data: psd.obs.freq.map((f, i) => ({ x: f, y: psd.obs.pow[i] })), borderColor: withA(c.tx2, 'AA'), backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.2 },
    { type: 'line', showLine: true, label: 'Filtered PSD', data: psd.flt.freq.map((f, i) => ({ x: f, y: psd.flt.pow[i] })), borderColor: S, backgroundColor: gradient(S, '30', '02'), fill: 'origin', pointRadius: 0, borderWidth: cfgC().lineWidth + 0.2 }] },
    options: baseOpts({ scales: { x: axisXY('Frequency (Hz)', { type: 'linear', min: .01, max: .5, ticks: { maxTicksLimit: 9 } }), y: axisXY('Power spectral density', { type: 'logarithmic' }) }, plugins: { tooltip: { callbacks: { title: it => (+it[0].parsed.x).toFixed(3) + ' Hz', label: c => ` ${c.dataset.label}: ${Number(c.parsed.y).toExponential(2)}` } } } }), plugins: [bands, crosshair] });
}
function buildPoincare(R) {
  const { fit, events: ev } = R, c = tc(), S = ST.colors().S, pc = phaseColors(), n = fit.dy.length, idx = thinIdx(n - 1), m = idx ? idx.length : n - 1, at = i => idx ? idx[i] : i;
  const lo = Math.min(...fit.dy) * 0.97, hi = Math.max(...fit.dy) * 1.03, obs = Array.from({ length: m }, (_, i) => ({ x: fit.dy[at(i)], y: fit.dy[at(i) + 1] })), dsets = [{ label: 'Observed', data: obs, backgroundColor: withA(c.tx2, '55'), pointRadius: 2, pointBorderWidth: 0, order: 5 }];
  if (ev) ['rest', 'exercise', 'recovery'].forEach(k => dsets.push({ label: 'Filtered · ' + PHASE_NAMES[k].toLowerCase(), data: Array.from({ length: m }, (_, i) => i).filter(i => phaseOf(fit.time[at(i)], ev) === k).map(i => ({ x: fit.irr[at(i)], y: fit.irr[at(i) + 1] })), backgroundColor: withA(pc[k], 'DD'), pointRadius: 2.6, pointBorderWidth: 0, order: 1 }));
  else dsets.push({ label: 'Filtered', data: Array.from({ length: m }, (_, i) => ({ x: fit.irr[at(i)], y: fit.irr[at(i) + 1] })), backgroundColor: withA(S, 'DD'), pointRadius: 2.6, pointBorderWidth: 0, order: 1 });
  dsets.push({ type: 'line', label: '', data: [{ x: lo, y: lo }, { x: hi, y: hi }], borderColor: withA(c.tx3, 'AA'), borderDash: [4, 4], pointRadius: 0, borderWidth: 1 });
  mk('poincare', { type: 'scatter', data: { datasets: dsets }, options: baseOpts({ interaction: { mode: 'nearest', intersect: true }, plugins: { tooltip: { callbacks: { title: () => '', label: c => ` ${c.dataset.label}: ${c.parsed.x.toFixed(3)} → ${c.parsed.y.toFixed(3)} s` } } }, scales: { x: axisXY('RR(n) (s)', { min: lo, max: hi }), y: axisXY('RR(n+1) (s)', { min: lo, max: hi }) } }) });
}
function buildGain(R) {
  const { fit } = R, c = tc(), idx = thinIdx(fit.dy.length), p = fit.params, t = pick(fit.time, idx), g = pick(fit.gain, idx);
  const note = doc.querySelector('.cc[data-chart="gain"] .cc-note');
  if (note) note.innerHTML = `γ = <b>${fmt(p.gamma, 4)}</b> &nbsp; <span class="pill ${p.gate_off ? 'off' : 'on'}">${p.gate_off ? 'gate off — ungated model' : 'gate on'}</span> &nbsp; τ<sub>g</sub> = ${fit.ctl.tau_g} s &nbsp; g<sub>k</sub> ∈ [${fmt(Math.min(...fit.gain), 3)}, ${fmt(Math.max(...fit.gain), 3)}]`;
  mk('gain', { type: 'line', data: { datasets: [ln('', t.map(x => ({ x, y: 1 })), withA(c.tx3, 'AA'), { borderDash: [4, 4], borderWidth: 1 }), ln('Vagal variance gain g_k', t.map((x, i) => ({ x, y: g[i] })), c.acc, { fill: false })] }, options: timeOpts(R, 'g_k (log scale)', { scales: { y: { type: 'logarithmic' } }, plugins: { legend: { display: false } } }), plugins: tsPlugins(R) });
}
function buildPartition(R) {
  const { fit } = R, pt = fit.pr.partition, c = tc(); if (!pt) return setEmpty('partition', 'No spectral partition available.');
  const keep = pt.freq.map((f, i) => i).filter(i => pt.freq[i] >= 0.01 && pt.freq[i] <= 0.5 && isFinite(pt.power[i])), P = ST.colors();
  mk('partition', { type: 'scatter', data: { datasets: [
    { type: 'line', showLine: true, label: 'Global CWT power of HR', data: keep.map(i => ({ x: pt.freq[i], y: pt.power[i] })), borderColor: withA(c.tx2, 'DD'), backgroundColor: gradient(c.tx2, '22', '02'), fill: 'origin', pointRadius: 0, borderWidth: 1.5, yAxisID: 'y' },
    { type: 'line', showLine: true, label: 'Vagal weight', data: keep.map(i => ({ x: pt.freq[i], y: pt.w_vagal[i] })), borderColor: P.P, backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.8, yAxisID: 'y2' },
    { type: 'line', showLine: true, label: 'Sympathetic weight', data: keep.map(i => ({ x: pt.freq[i], y: pt.w_symp[i] })), borderColor: P.S, backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.8, yAxisID: 'y2' }] },
    options: baseOpts({ scales: { x: axisXY('Frequency (Hz)', { type: 'logarithmic', min: 0.01, max: 0.5 }), y: axisXY('Power', { type: 'logarithmic' }), y2: axisBase('Weight', { position: 'right', min: 0, max: 1, grid: { display: false } }, true) }, plugins: { tooltip: { callbacks: { title: it => (+it[0].parsed.x).toFixed(3) + ' Hz' } } } }), plugins: [crosshair] });
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
  const c = tc(), ds = [{ type: 'line', showLine: true, label: 'Prior', data: prior, borderColor: withA(c.tx2, 'DD'), backgroundColor: gradient(c.tx2, '2A', '02'), fill: 'origin', pointRadius: 0, borderWidth: 1.5 }];
  if (post) ds.push({ type: 'line', showLine: true, label: 'Posterior (Laplace)', data: post, borderColor: c.acc, backgroundColor: gradient(c.acc, '55', '04'), fill: 'origin', pointRadius: 0, borderWidth: 2 });
  ds.push({ type: 'line', showLine: true, label: 'MAP estimate', data: [{ x: est, y: 0 }, { x: est, y: estMax }], borderColor: c.amb, borderDash: [4, 3], pointRadius: 0, borderWidth: 1.6 });
  mk(id, { type: 'scatter', data: { datasets: ds }, options: baseOpts({ scales: { x: axisXY(xtitle, { type: id === 'pp-gamma' ? 'linear' : 'logarithmic' }), y: axisXY(ytitle) }, plugins: { tooltip: { callbacks: { title: it => xtitle + ' = ' + Number(it[0].parsed.x).toPrecision(3) } } } }), plugins: [crosshair] });
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
function buildHRVTable(R) {
  const { hrvObs: o, hrvFlt: f } = R, body = doc.querySelector('.cc[data-chart="hrvtable"] .cc-body');
  const rows = [['Mean heart rate (bpm)', 'meanHR', 1], ['Mean RR (ms)', 'meanRR', 1], ['SDNN (ms)', 'SDNN', 1], ['RMSSD (ms)', 'RMSSD', 1], ['pNN50 (%)', 'pNN50', 1], ['LF power (ms²)', 'LF', 1], ['HF power (ms²)', 'HF', 1], ['LF/HF', 'LFHF', 2]];
  body.innerHTML = `<table class="stat-table"><thead><tr><th>Metric</th><th>Observed RR</th><th>Filtered RR</th><th>Δ%</th></tr></thead><tbody>${rows.map(([n, k, d]) => {
    const a = o[k], b = f[k], dd = isFinite(a) && isFinite(b) && a !== 0 ? 100 * (b - a) / Math.abs(a) : NaN; return `<tr><td>${n}</td><td>${fmt(a, d)}</td><td>${fmt(b, d)}</td><td>${isFinite(dd) ? (dd > 0 ? '+' : '') + dd.toFixed(1) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table>
    <div class="se-note">Spectral values need ≥ 2 min of data (Hann-windowed periodogram of the 4 Hz tachogram). Over a whole recording with changing conditions these summaries mix phases; see the phase table for a per-phase view.</div>`;
}
function buildPhaseTable(R) {
  const body = doc.querySelector('.cc[data-chart="phasetable"] .cc-body'), ph = R.phases, pc = phaseColors();
  if (!ph) { body.innerHTML = '<div class="empty-card">Mark the phases (end of rest and end of exercise, in seconds) in Settings → Analysis, or load the 5-2-5 example.</div>'; return; }
  const keys = ['rest', 'exercise', 'recovery'];
  const row = (r, i) => r.n < 5 ? `<tr><td>${r.name}</td><td colspan="8">too few beats</td></tr>` : `<tr><td><span class="dot" style="background:${pc[keys[i]]}"></span>${r.name}</td><td>${fmt(r.duration, 0)}</td><td>${fmt(r.hr, 1)}</td><td>${fmt(r.rmssdObs, 1)}</td><td>${fmt(r.xp, 3)}</td><td>${fmt(r.xs, 3)}</td><td>${fmt(r.sdXp, 3)}</td><td>${fmt(r.sdXs, 3)}</td><td>${fmt(r.shift, 2)}</td></tr>`;
  body.innerHTML = `<table class="stat-table"><thead><tr><th>Phase</th><th>Duration (s)</th><th>HR (bpm)</th><th>RMSSD (ms)</th><th>mean x_p (Hz)</th><th>mean x_s (Hz)</th><th>SD x_p</th><th>SD x_s</th><th>Shift from rest (σ)</th></tr></thead><tbody>${ph.map(row).join('')}</tbody></table>
    <div class="se-note">Shift = distance between the phase centroid and the rest centroid in the (x_p, x_s) plane, in units of the stationary standard deviations of the two drives. Phase limits come from the recording protocol, not from the model.</div>`;
}
function buildCorrMatrix(R) {
  const { rep } = R, body = doc.querySelector('.cc[data-chart="corrmat"] .cc-body'); if (!rep) { body.innerHTML = '<div class="empty-card">Enable “Standard errors and Laplace posterior” in Settings → Analysis.</div>'; return; }
  const names = ['κ_S', 'κ_P', 'Λ_R', 'γ'], C = rep.physCov, r = (i, j) => C[i][j] / Math.sqrt(Math.max(C[i][i], 1e-300) * Math.max(C[j][j], 1e-300));
  const color = v => { const a = Math.min(1, Math.abs(v)); return v >= 0 ? `rgba(${Math.round(60 + 180 * a)},${Math.round(100 - 40 * a)},${Math.round(90 - 40 * a)},${0.22 + 0.7 * a})` : `rgba(${Math.round(50 - 20 * a)},${Math.round(120 + 40 * a)},${Math.round(210 + 20 * a)},${0.22 + 0.7 * a})`; };
  let h = `<div class="corr-grid" style="grid-template-columns:42px repeat(4,1fr)"><div></div>${names.map(n => `<div class="corr-lbl">${n}</div>`).join('')}`;
  for (let i = 0; i < 4; i++) { h += `<div class="corr-lbl">${names[i]}</div>`; for (let j = 0; j < 4; j++) { const v = r(i, j); h += `<div class="corr-cell" style="background:${color(v)}" title="${names[i]} vs ${names[j]}">${isFinite(v) ? v.toFixed(2) : '—'}</div>`; } }
  body.innerHTML = h + `</div><div class="se-note">Correlation of the MAP estimates (inverse numerical Hessian, delta method). Hessian eigenvalue range ${rep.min_eig.toExponential(1)} … ${rep.max_eig.toExponential(1)}${rep.min_eig <= 0 ? ' — not positive definite: SEs are approximate' : ''}.</div>`;
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
let _cwtCache=null, _cwtRO=null;
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
  canvas.style.width=W+'px';
  canvas.style.height=H+'px';
  canvas.width=Math.round(W*dpr);
  canvas.height=Math.round(H*dpr);
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr); // subsequent draw calls below use CSS-pixel coords again

  // Background
  ctx.fillStyle=isLight?'#FFFFFF':'#0B1120';
  ctx.fillRect(0,0,W,H);

  // ── Scalogram via ImageData (bilinear + log-power + inferno colormap) ──
  // putImageData bypasses ctx's transform matrix entirely, so this buffer is
  // sized and placed in raw DEVICE pixels (pW*dpr etc.), not the dpr-scaled
  // logical coordinates the rest of this function uses.
  const pWpx=Math.round(pW*dpr), pHpx=Math.round(pH*dpr);
  const img=ctx.createImageData(pWpx,pHpx);
  const pxBuf=img.data;
  const fMinLog=Math.log(bFreqs[nS-1]);
  const fMaxLog=Math.log(bFreqs[0]);
  const logRange=fMaxLog-fMinLog+1e-12;

  for(let py=0;py<pHpx;py++){
    // py=0 → top → high frequency; py=pHpx-1 → bottom → low frequency
    const logF=fMaxLog-(py/(pHpx-1))*logRange;
    const si_f=(fMaxLog-logF)/logRange*(nS-1);
    const si0=Math.min(Math.max(0,Math.floor(si_f)),nS-2);
    const sf=si_f-si0;
    const row0=logBPow[si0], row1=logBPow[si0+1];
    for(let px2=0;px2<pWpx;px2++){
      const ti_f=px2/(pWpx-1)*(nT-1);
      const ti0=Math.min(Math.max(0,Math.floor(ti_f)),nT-2);
      const tf=ti_f-ti0;
      // Bilinear interpolation in log-power (pre-logged — see buildCWTChart)
      const v00=row0[ti0],   v01=row0[ti0+1];
      const v10=row1[ti0],   v11=row1[ti0+1];
      const lv=v00*(1-sf)*(1-tf)+v01*(1-sf)*tf+v10*sf*(1-tf)+v11*sf*tf;
      const norm=Math.max(0,Math.min(1,(lv-pMin)/pRange));
      const[r,g,b]=curLUT()[Math.round(norm*255)];
      const idx=(py*pWpx+px2)*4;
      pxBuf[idx]=r; pxBuf[idx+1]=g; pxBuf[idx+2]=b; pxBuf[idx+3]=255;
    }
  }
  ctx.putImageData(img,Math.round(PAD.left*dpr),Math.round(PAD.top*dpr));

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
  if(_bundle && _bundle.events){ const ev=_bundle.events, pcs=phaseColors(); [['Exercise start',ev.t_on,pcs.exercise],['Exercise end',ev.t_off,pcs.recovery]].forEach(([lb,tt,col])=>{ if(tt<tMin||tt>tMax) return; const x=PAD.left+(tt-tMin)/(tMax-tMin)*pW; ctx.save(); ctx.setLineDash([5,4]); ctx.strokeStyle=col; ctx.lineWidth=1.8; ctx.beginPath(); ctx.moveTo(x,PAD.top); ctx.lineTo(x,PAD.top+pH); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle=col; ctx.font='700 10px '+Chart.defaults.font.family; ctx.textAlign='left'; ctx.shadowColor='rgba(0,0,0,.6)'; ctx.shadowBlur=3; ctx.fillText(lb,x+5,PAD.top+13); ctx.restore(); }); }

}

function buildCWT(R) {
  const { fit } = R, canvas = doc.getElementById('chart-cwt'); if (!canvas) return;
  const fs = 4, g = E.hrGrid(fit.dy, fs), x = Float64Array.from(g.grid, v => v - E.mean(g.grid)), w = E.biwaveletMorlet(x, 1 / fs);
  const band = w.freqs.map((f, i) => ({ f, i })).filter(({ f }) => f >= 0.01 && f <= 0.50), bFreqs = band.map(({ f }) => f), nS = bFreqs.length, nT = x.length;
  const logBPow = band.map(({ i }) => Float64Array.from(w.power[i], v => Math.log(v + 1e-10)));
  let pMin = Infinity, pMax = -Infinity; for (const row of logBPow) for (const v of row) { if (v < pMin) pMin = v; if (v > pMax) pMax = v; }
  _cwtCache = { bFreqs, logBPow, nS, nT, tMin: g.t0, tMax: g.t0 + (nT - 1) / fs, pMin, pRange: pMax - pMin + 1e-12 };
  _renderCWT();
  if (!_cwtRO && root.ResizeObserver) { _cwtRO = new ResizeObserver(() => _renderCWT()); _cwtRO.observe(canvas.parentElement || canvas); }
}
let _landRO = null;
function renderLandscape() {
  const R = _bundle; if (!R || !R.land) return; const L = R.land, cv = doc.getElementById('chart-landscape'); if (!cv) return;
  const body = cv.parentElement; if (!body.clientWidth) return;
  const W = Math.max(body.clientWidth, 260), H = Math.max(body.clientHeight, 220), dpr0 = Math.min(Math.max(root.devicePixelRatio || 1, 2), 3), dpr = (W * H > 650000) ? Math.min(dpr0, 2) : dpr0, c = tc(), A = ST.get('analysis'), pc = phaseColors(), ev = R.events, light = isLight();
  if (!_landRO && root.ResizeObserver) { _landRO = new ResizeObserver(() => renderLandscape()); _landRO.observe(body); }
  cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const PAD = { l: 52, r: 62, t: 12, b: 40 }, pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b, N = L.gu.length, lt = curLUT();
  ctx.fillStyle = light ? '#FFFFFF' : '#0D1424'; ctx.fillRect(0, 0, W, H);
  const X = u => PAD.l + (u - L.limits.u[0]) / (L.limits.u[1] - L.limits.u[0]) * pw, Y = v => PAD.t + ph - (v - L.limits.v[0]) / (L.limits.v[1] - L.limits.v[0]) * ph;
  const pmax = L.potMax, img = ctx.createImageData(Math.round(pw * dpr), Math.round(ph * dpr)), pxw = img.width;
  for (let py = 0; py < img.height; py++) for (let px = 0; px < pxw; px++) {
    const fu = px / (pxw - 1) * (N - 1), fv = (1 - py / (img.height - 1)) * (N - 1), i0 = Math.min(N - 2, Math.floor(fu)), j0 = Math.min(N - 2, Math.floor(fv)), a = fu - i0, b = fv - j0;
    const U = L.pot[i0][j0] * (1 - a) * (1 - b) + L.pot[i0 + 1][j0] * a * (1 - b) + L.pot[i0][j0 + 1] * (1 - a) * b + L.pot[i0 + 1][j0 + 1] * a * b, [r, g, bl] = lt[Math.round((1 - U / pmax) * 255)], o = (py * pxw + px) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, Math.round(PAD.l * dpr), Math.round(PAD.t * dpr));
  ctx.save(); ctx.beginPath(); ctx.rect(PAD.l, PAD.t, pw, ph); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 0.7; ctx.beginPath();
  for (let lev = 1; lev < pmax; lev++) for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const v = [L.pot[i][j], L.pot[i + 1][j], L.pot[i + 1][j + 1], L.pot[i][j + 1]], xs = [L.gu[i], L.gu[i + 1], L.gu[i + 1], L.gu[i]], ys = [L.gv[j], L.gv[j], L.gv[j + 1], L.gv[j + 1]], pts = [];
    for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a - lev) * (b - lev) < 0) { const t = (lev - a) / (b - a); pts.push([xs[e] + t * (xs[(e + 1) % 4] - xs[e]), ys[e] + t * (ys[(e + 1) % 4] - ys[e])]); } }
    if (pts.length >= 2) { ctx.moveTo(X(pts[0][0]), Y(pts[0][1])); ctx.lineTo(X(pts[1][0]), Y(pts[1][1])); }
  }
  ctx.stroke();
  if (A.showFlow && L.flow.length) {
    const mx = Math.max(...L.flow.map(f => Math.hypot(f.du, f.dv))) || 1, cell = pw / L.flowBins * 0.75; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    L.flow.forEach(f => { const dx = f.du / mx * cell, dy = -f.dv / mx * cell * (ph / pw), x0 = X(f.u) - dx / 2, y0 = Y(f.v) - dy / 2, x1 = x0 + dx, y1 = y0 + dy, ang = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 5 * Math.cos(ang - 0.4), y1 - 5 * Math.sin(ang - 0.4)); ctx.lineTo(x1 - 5 * Math.cos(ang + 0.4), y1 - 5 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill(); });
  }
  // trajectory: coloured by phase when known, else by time; white halo underneath keeps it readable on any heat colour
  const n = L.u.length, step = Math.max(1, Math.floor(n / 1800)), T = R.fit.time, vir = lut('viridis');
  const sm = (a, w) => { const o = new Array(a.length), h = Math.floor(w / 2); for (let i = 0; i < a.length; i++) { let s = 0, m = 0; for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) { s += a[j]; m++; } o[i] = s / m; } return o; };
  const pu = sm(L.u, 7), pv = sm(L.v, 7);                         // drawing only: a 7-beat moving average removes the beat-to-beat staircase
  const colAt = k => ev ? pc[phaseOf(T[k], ev)] : (() => { const [r, g, b] = vir[Math.round(255 * k / Math.max(n - 1, 1))]; return `rgb(${r},${g},${b})`; })();
  const seg = (col, wdt) => { ctx.lineWidth = wdt; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (let k = 0; k + step < n; k += step) { ctx.strokeStyle = typeof col === 'function' ? col(k) : col; ctx.beginPath(); ctx.moveTo(X(pu[k]), Y(pv[k])); ctx.lineTo(X(pu[k + step]), Y(pv[k + step])); ctx.stroke(); } };
  seg('rgba(255,255,255,.5)', 2.8); seg(colAt, 1.5);
  // phase centroids with arrows rest -> exercise -> recovery
  if (R.phases && ev) {
    const keys = ['rest', 'exercise', 'recovery'], cs = R.phases.filter(r => r.cu != null);
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.8;
    for (let i = 0; i < cs.length - 1; i++) { const x0 = X(cs[i].cu), y0 = Y(cs[i].cv), x1 = X(cs[i + 1].cu), y1 = Y(cs[i + 1].cv), a = Math.atan2(y1 - y0, x1 - x0); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - 8 * Math.cos(a), y1 - 8 * Math.sin(a)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 10 * Math.cos(a - .38), y1 - 10 * Math.sin(a - .38)); ctx.lineTo(x1 - 10 * Math.cos(a + .38), y1 - 10 * Math.sin(a + .38)); ctx.closePath(); ctx.fill(); }
    cs.forEach((r, i) => { ctx.beginPath(); ctx.arc(X(r.cu), Y(r.cv), 7.5, 0, 6.3); ctx.fillStyle = pc[keys[i]]; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = `700 10.5px ${FONT}`; ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4; ctx.fillText(r.name, X(r.cu) + 11, Y(r.cv) - 9); ctx.shadowBlur = 0; });
  } else { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(pu[0]), Y(pv[0]), 3.6, 0, 6.3); ctx.fill(); ctx.stroke(); }
  if (A.showBasins) L.basins.forEach(b => { ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(X(b.u), Y(b.v), 5, 0, 6.3); ctx.stroke(); });
  ctx.restore();
  ctx.strokeStyle = light ? 'rgba(15,27,45,.18)' : 'rgba(160,185,225,.22)'; ctx.lineWidth = 1; ctx.strokeRect(PAD.l, PAD.t, pw, ph); ctx.fillStyle = c.tx3; ctx.font = `10.5px ${FONT}`; ctx.textAlign = 'center';
  for (let k = 0; k <= 4; k++) { const u = L.limits.u[0] + (L.limits.u[1] - L.limits.u[0]) * k / 4, v = L.limits.v[0] + (L.limits.v[1] - L.limits.v[0]) * k / 4; ctx.fillText(u.toFixed(1), X(u), PAD.t + ph + 15); ctx.textAlign = 'right'; ctx.fillText(v.toFixed(1), PAD.l - 7, Y(v) + 3.5); ctx.textAlign = 'center'; }
  ctx.fillStyle = c.tx2; ctx.font = `500 11px ${FONT}`; ctx.fillText('x_p / σ_P   (vagal-like, in stationary SDs)', PAD.l + pw / 2, H - 6); ctx.save(); ctx.translate(12, PAD.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('x_s / σ_S   (sympathetic-like)', 0, 0); ctx.restore();
  const cbX = PAD.l + pw + 12; for (let y = 0; y < ph; y++) { const [r, g, b] = lt[Math.round((1 - y / ph) * 255)]; ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(cbX, PAD.t + ph - y - 1, 10, 1.5); }
  ctx.strokeStyle = light ? 'rgba(15,27,45,.18)' : 'rgba(160,185,225,.22)'; ctx.strokeRect(cbX, PAD.t, 10, ph); ctx.fillStyle = c.tx3; ctx.textAlign = 'left'; ctx.font = `10px ${FONT}`; ctx.fillText('U = 0', cbX + 14, PAD.t + ph - 2); ctx.fillText('U = ' + pmax, cbX + 14, PAD.t + 9);
  const note = doc.querySelector('.cc[data-chart="landscape"] .cc-note');
  if (note) note.innerHTML = `U = −ln(p/p<sub>max</sub>): bright = where the reconstructed states spend most time (basin). ${L.basins.length} basin${L.basins.length === 1 ? '' : 's'} above ${Math.round(100 * A.minBasin)}% of the peak density.${ev ? ' Path coloured by phase; large dots = phase centroids.' : ''} A descriptive map, not a fitted potential.`;
}

/* ============================================================================================================================ */
/*  REGISTRY and cards                                                                                                           */
/* ============================================================================================================================ */
const CARDS = [
  { id: 'rr', tab: 'signal', title: 'RR interval', sub: 'Observed beats, model-filtered series and its 95% credible band', tip: 'c-rr', h: 300, span: 12, build: buildRR },
  { id: 'cwt', tab: 'signal', title: 'Time-frequency scalogram', sub: 'Morlet wavelet power of heart rate (log colour scale)', tip: 'c-cwt', kind: 'cwt', h: 340, span: 12, build: buildCWT },
  { id: 'psd', tab: 'signal', title: 'Power spectrum', sub: 'Empirical vs reconstructed PSD of heart rate', tip: 'c-psd', h: 280, span: 6, build: buildPSD },
  { id: 'poincare', tab: 'signal', title: 'Poincaré plot', sub: 'Each beat against the next: observed and filtered RR', tip: 'c-poin', h: 280, span: 6, build: buildPoincare },
  { id: 'states', tab: 'autonomic', title: 'Latent autonomic drives', sub: 'Vagal-like and sympathetic-like drive with 95% credible bands', tip: 'c-states', h: 300, span: 12, build: buildStates },
  { id: 'phase', tab: 'autonomic', title: 'Phase map', sub: 'The two drives against each other; dashed rings = stationary 1–3 σ', tip: 'c-phase', h: 380, span: 6, build: buildPhase },
  { id: 'landscape', tab: 'autonomic', title: 'State-space landscape', sub: 'Occupancy density, basins, mean flow and the trajectory', tip: 'c-land', h: 380, span: 6, kind: 'landscape', note: true, build: () => renderLandscape() },
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
  { id: 'hrvtable', tab: 'stats', title: 'Conventional HRV statistics', sub: 'Observed versus model-filtered RR', tip: 'c-hrv', kind: 'html', span: 6, build: buildHRVTable },
  { id: 'rolling', tab: 'stats', title: 'Rolling statistics', sub: 'Sliding-window heart rate, SDNN or RMSSD', tip: 'c-roll', h: 270, span: 6, select: [['hr', 'Heart rate'], ['sdnn', 'SDNN'], ['rmssd', 'RMSSD']], build: buildRolling },
  { id: 'xcorr', tab: 'stats', title: 'Cross-correlation of the drives', sub: 'x_p against x_s at lags of ±40 beats', tip: 'c-xc', h: 250, span: 6, build: buildXcorr },
  { id: 'acf', tab: 'stats', title: 'Innovation autocorrelation', sub: 'Lags 1–40; bars beyond the band are significant', tip: 'c-acf', h: 250, span: 6, build: buildACF },
  { id: 'hist', tab: 'diag', title: 'Standardized innovations', sub: 'Distribution against N(0,1)', tip: 'c-hist', h: 250, span: 6, build: buildHist },
  { id: 'qq', tab: 'diag', title: 'Normal Q–Q plot', sub: 'Innovation quantiles against normal quantiles', tip: 'c-qq', h: 250, span: 6, build: buildQQ },
  { id: 'pacf', tab: 'diag', title: 'Partial autocorrelation', sub: 'Innovations, lags 1–40', tip: 'c-pacf', h: 250, span: 6, build: buildPACF },
  { id: 'ks', tab: 'diag', title: 'Time-rescaling KS plot', sub: 'Empirical CDF of the transformed innovations', tip: 'c-ks', h: 250, span: 6, build: buildKS }
];
const ICON = { png: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>', full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>', hide: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-3 3.5M6.5 8C4.4 9.6 3 12 3 12s4 6 9 6a9 9 0 0 0 3-.5"/></svg>', width: '<svg viewBox="0 0 24 24"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>' };

function mountCards() {
  CARDS.forEach(card => {
    const grid = doc.getElementById('grid-' + card.tab); if (!grid || doc.querySelector(`.cc[data-chart="${card.id}"]`)) return;
    const lay = ST.Layout.get(card.id), el = doc.createElement('div');
    el.className = 'cc'; el.dataset.chart = card.id; el.dataset.span = String(lay.span || card.span || 6);
    const png = card.kind === 'html' ? '' : `<button class="tool" data-act="png" title="Save as PNG" aria-label="Save ${card.title} as PNG">${ICON.png}</button>`;
    const sel = card.select ? `<select class="mini" aria-label="Metric">${card.select.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : '';
    el.innerHTML = `<div class="cc-head"><div class="cc-lbl"><div class="cc-text"><span class="cc-title" title="${card.title}">${card.title}</span><span class="cc-sub">${card.sub || ''}</span></div><button class="info-btn" data-tip="${card.tip}" aria-label="About this chart">i</button></div>
      <div class="cc-tools">${sel}${png}<button class="tool" data-act="width" title="Toggle width" aria-label="Toggle width">${ICON.width}</button><button class="tool" data-act="full" title="Fullscreen" aria-label="Fullscreen">${ICON.full}</button><button class="tool" data-act="hide" title="Hide chart" aria-label="Hide chart">${ICON.hide}</button></div></div>
      <div class="cc-body${card.kind === 'html' ? ' auto' : ''}" style="--h:${lay.h || card.h || 260}px">${card.kind === 'html' ? '' : `<canvas id="chart-${card.id}"></canvas>`}</div>${card.note ? '<div class="cc-note"></div>' : ''}${card.kind === 'html' ? '' : '<div class="cc-resize" title="Drag to resize"></div>'}`;
    grid.appendChild(el);
    if (ST.get('charts.hidden')[card.id]) el.classList.add('is-hidden');
    el.querySelector('.cc-tools').addEventListener('click', ev => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'full') { el.classList.toggle('fullscreen'); resizeAll(); }
      else if (b.dataset.act === 'hide') { setHidden(card.id, true); }
      else if (b.dataset.act === 'width') { const next = el.dataset.span === '12' ? '6' : '12'; el.dataset.span = next; ST.Layout.set(card.id, { span: +next }); setTimeout(resizeAll, 30); }
      else if (b.dataset.act === 'png' && root.SparkExport) root.SparkExport.chartPNG(card.id);
    });
    const s = el.querySelector('select.mini'); if (s) s.addEventListener('change', () => { try { card.build(_bundle); } catch (e) { console.error(e); } });
    const h = el.querySelector('.cc-resize');
    if (h) h.addEventListener('pointerdown', ev => {
      ev.preventDefault(); h.setPointerCapture(ev.pointerId); const body = el.querySelector('.cc-body'), y0 = ev.clientY, h0 = body.getBoundingClientRect().height;
      const mv = e => { body.style.setProperty('--h', Math.max(120, Math.round(h0 + e.clientY - y0)) + 'px'); resizeAll(); };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); ST.Layout.set(card.id, { h: Math.round(body.getBoundingClientRect().height) }); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    });
  });
}
function setHidden(id, hidden) { const m = Object.assign({}, ST.get('charts.hidden')); if (hidden) m[id] = true; else delete m[id]; ST.set('charts.hidden', m, true); ST.save(); const el = doc.querySelector(`.cc[data-chart="${id}"]`); if (el) el.classList.toggle('is-hidden', !!hidden); if (!hidden && _bundle) { const c = CARDS.find(x => x.id === id); try { c.build(_bundle); } catch (e) { console.error(e); } } }
function resizeCharts() { Object.values(_ch).forEach(ch => { try { if (ch.canvas && ch.canvas.isConnected && ch.canvas.offsetParent !== null) ch.resize(); } catch (_) { /* ignore */ } }); }
function resizeAll() { resizeCharts(); _renderCWT(); renderLandscape(); }
function buildAll(R, only) {
  _bundle = R; chartDefaults();
  CARDS.forEach(card => {
    if (only && only !== card.id) return;
    if (ST.get('charts.hidden')[card.id]) return;
    try { if (card.kind !== 'html' && card.kind !== 'cwt' && card.kind !== 'landscape') ensureCanvas(card.id); card.build(R); }
    catch (e) { console.error('Chart ' + card.id + ' failed:', e); const b = doc.querySelector(`.cc[data-chart="${card.id}"] .cc-body`); if (b) b.innerHTML = `<div class="empty-card">Could not draw this chart: ${String(e.message).replace(/</g, '&lt;')}</div>`; }
  });
}
function getCanvas(id) { return doc.getElementById('chart-' + id); }
function chartList() {
  const w = doc.createElement('div'); w.className = 'chk-list';
  CARDS.forEach(c => { const l = doc.createElement('label'), i = doc.createElement('input'); i.type = 'checkbox'; i.checked = !ST.get('charts.hidden')[c.id]; i.addEventListener('change', () => setHidden(c.id, !i.checked)); l.appendChild(i); l.appendChild(doc.createTextNode(c.title)); w.appendChild(l); });
  return w;
}

root.SparkCharts = { CARDS, mountCards, buildAll, resizeAll, resizeCharts, getCanvas, chartList, setHidden, chartDefaults, tc, css, renderLandscape, renderCWT: () => _renderCWT(), charts: _ch, lut, STOPS, phaseColors, bundle: () => _bundle };
})(typeof window !== 'undefined' ? window : globalThis);

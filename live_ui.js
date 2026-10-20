/* ============================================================================
   SPARK live (interface): mode switch, sensor controls, live charts and values, exports, and hand-over of the session to the Analysis section.
   The logic (BLE, session, reconstruction; also a simulated source used by the tests and the scripting API only) is in live.js.
   ========================================================================== */
(function (root) {
'use strict';
const doc = root.document, $ = id => doc.getElementById(id), L = root.SparkLive, ST = root.SparkSettings, E = root.SparkEngine, SA = root.SparkApp, X = root.SparkExport;
let session = null, source = null, sourceKind = null, charts = {}, drawTimer = null, lastDraw = 0, wakeLock = null, mode = 'analysis', info = { name: '', battery: null, state: 'idle', detail: '' }, started = null, calibTimer = null;
const listeners = [];
/* Built-in defaults of the Live settings: the interface keeps working (and says so) if settings.js is an older file without the Live section, for instance a cached copy. */
const LIVE_DEFAULTS = { smooth: true, displayDelayS: 1, calibrationS: 8, fitWindowMin: 10, refitEveryS: 15, minBeats: 120, chartWindowMin: 5, rrMinMs: 250, rrMaxMs: 2500, gapS: 4, clean: false, autoReconnect: true, keepAwake: true };
const liveSettings = () => Object.assign({}, LIVE_DEFAULTS, ST.get('live') || {}), LS = k => liveSettings()[k];
function setLive(k, v) { const all = ST.all(); if (all && !all.live) all.live = Object.assign({}, LIVE_DEFAULTS); ST.set('live.' + k, v); }
const stale = !(ST.DEFAULTS && ST.DEFAULTS.live);
if (stale) console.warn('SPARK: settings.js has no Live section (an older file, probably cached). Using the built-in defaults for Live; reload the page ignoring the cache (Ctrl+Shift+R).');
const fmt = (x, d) => isFinite(x) ? Number(x).toFixed(d) : '—';
const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const toast = (m, k, ms) => root.SparkApp && root.SparkApp.toast && root.SparkApp.toast(m, k, ms);

/* ---- options and session ------------------------------------------------------------------------------------------------------------------------- */
function liveOptions() {
  const v = liveSettings(), A = Object.assign({ cleanWindow: 50, cleanNMad: 3.5, cleanNIter: 2 }, ST.get('analysis') || {}); let cfg; try { cfg = ST.modelSettings(); } catch (e) { cfg = { priors: E.sparkPriors(), control: E.sparkControl() }; }
  return { fitWindowS: v.fitWindowMin * 60, refitEveryS: v.refitEveryS, minBeats: v.minBeats, chartWindowS: v.chartWindowMin * 60, rrMinMs: v.rrMinMs, rrMaxMs: v.rrMaxMs, gapS: v.gapS,
           clean: v.clean ? { window: A.cleanWindow, n_mad: A.cleanNMad, n_iter: A.cleanNIter } : null, priors: cfg.priors, control: cfg.control };
}
function ensureSession() {
  if (!session) session = new L.LiveSession(Object.assign(liveOptions(), { fitFn: args => root.SparkCompute.fitLive(args), onUpdate: scheduleDraw }));
  return session;
}
function applyOptions() { if (session) { session.setOptions(liveOptions()); session.reconstruct(); scheduleDraw(); } syncControls(); }

/* ---- the sensor ---------------------------------------------------------------------------------------------------------------------------------------- */
const STATUS = { idle: 'Not connected', scanning: 'Choose the sensor in the browser dialog…', connecting: 'Connecting…', streaming: 'Streaming', lost: 'Link lost: reconnecting…', failed: 'Not connected' };
function onStatus(state, i) {
  info.state = state; info.name = (i && i.name) || info.name; let detail = '';
  if (state === 'failed') detail = i && i.reason === 'cancelled' ? 'No device was selected.' : i && i.reason === 'reconnect' ? 'Could not reconnect: switch the sensor on, wet the electrodes and connect again.' : i && i.reason === 'unsupported' ? 'This browser has no Web Bluetooth.' : (i && i.message) || 'Connection failed.';
  if (state === 'lost' && i && i.attempt) detail = 'attempt ' + i.attempt;
  info.detail = detail;
  if (state === 'streaming') { ensureSession().startCalibration(LS('calibrationS'), sourceKind === 'polar' ? L.now() : null); startCalibTicker(); }   // each (re)connection: the first seconds are discarded
  else if (state !== 'lost') stopCalibTicker();
  setStatusText();
  $('live-chip').classList.toggle('ok', state === 'streaming'); $('live-stop').disabled = !(state === 'streaming' || state === 'lost' || state === 'connecting' || state === 'scanning');
  $('live-connect').disabled = !(state === 'idle' || state === 'failed');
  setDot();
  if (state === 'streaming') { if (!started) started = Date.now(); lockScreen(); } else if (state === 'idle' || state === 'failed') releaseScreen();
  if (state === 'failed' && detail && i && i.reason !== 'cancelled') toast(detail, 'err', 5200);
  if (state === 'idle' || state === 'failed') { info.name = ''; info.battery = null; }          // no sensor any more: do not keep showing its name and battery
  renderMeta(); renderBanner(); emit('status', { state, detail });
}
/* ---- calibration: the first seconds after connecting are discarded; the status shows the countdown ---------------------------------------------- */
const calibLeft = () => session && session.calibrating && info.state === 'streaming' ? session.calibrationLeft(L.now()) : 0;
function setStatusText() { const left = calibLeft(), d = info.detail; $('live-status').textContent = left > 0 ? `Calibrating… ${Math.ceil(left)} s` : STATUS[info.state] + (d && info.state !== 'failed' ? ' (' + d + ')' : ''); }
function setDot() { $('live-dot').className = 'live-dot' + (info.state === 'streaming' ? (calibLeft() > 0 ? ' warn' : ' on') : info.state === 'lost' ? ' warn' : ''); }
function startCalibTicker() { stopCalibTicker(); calibTimer = setInterval(() => { setStatusText(); setDot(); renderBanner(); if (!(session && session.calibrating && calibLeft() > 0)) { stopCalibTicker(); scheduleDraw(); } }, 250); }
function stopCalibTicker() { if (calibTimer) { clearInterval(calibTimer); calibTimer = null; } }
function renderMeta() {
  const parts = []; if (info.name) parts.push(info.name); if (info.battery != null) parts.push('battery ' + info.battery + '%');
  if (session && session.contact === false) parts.push('no skin contact: moisten the electrodes and tighten the strap'); $('live-meta').textContent = parts.join(' · ');
}
const setHR = v => { const el = $('live-hr'); el.textContent = v == null ? '—' : v; el.classList.toggle('dim', v == null); };
function onPacket(p) { const s = ensureSession(); s.addPacket(p); if (p.hr != null) setHR(p.hr); renderMeta(); }
async function startSource(src, kind) {
  if (source) await stop();
  source = src; sourceKind = kind; ensureSession(); try { await src.connect(); } catch (e) { if (e && e.name !== 'NotFoundError') console.warn('Connection failed:', e); }
}
async function connectPolar() {
  if (!L.PolarSource.supported()) { onStatus('failed', { reason: 'unsupported' }); return false; }
  const s = ensureSession(), src = new L.PolarSource({ autoReconnect: LS('autoReconnect'), onPacket, onStatus, onBattery: b => { info.battery = b; renderMeta(); }, onReconnect: () => { s.markReconnect(); toast('Reconnected: a new segment started.', '', 3200); } });
  await startSource(src, 'polar'); return source && source.state === 'streaming';
}
async function simulate(rr, opts) {
  const o = opts || {}, speed = o.speed || 10, series = rr || E.genExampleSession().rr;
  const src = new L.SimulatedSource(series, { speed, dropAt: o.dropAt, onPacket, onStatus, onBattery: b => { info.battery = b; renderMeta(); } }); info.name = 'Simulated sensor';
  await startSource(src, 'simulated'); return true;
}
async function stop() {
  const src = source; source = null; if (src) { try { await src.disconnect(); } catch (e) { /* ignore */ } } releaseScreen(); sourceKind = null; renderBanner(); syncButtons();
}
async function lockScreen() {
  try { if (LS('keepAwake') && root.navigator && root.navigator.wakeLock && !wakeLock) { wakeLock = await root.navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { wakeLock = null; }
}
function releaseScreen() { try { if (wakeLock) { wakeLock.release(); } } catch (e) { /* ignore */ } wakeLock = null; }
doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible' && info.state === 'streaming') lockScreen(); });

/* ---- values -------------------------------------------------------------------------------------------------------------------------------------------- */
function renderBanner() {
  const pill = $('live-state-pill'), txt = $('live-state-text'), s = session, l = s && s.latest, left = calibLeft(); let cls = '', label = 'Not connected', msg = 'Connect a Polar H10 to receive RR intervals and reconstruct the autonomic drives as they arrive.';
  if (info.state === 'scanning' || info.state === 'connecting') { label = 'Connecting'; msg = STATUS[info.state]; cls = 'live-warn'; }
  else if (left > 0) { label = 'Calibrating'; cls = 'live-warn'; msg = `Calibrating the sensor: the beats received during the first ${s.calibSeconds} s after connecting are discarded, ${Math.ceil(left)} s left. Keep still, with the strap wet and snug.`; }
  else if (info.state === 'lost') { label = 'Link lost'; msg = 'Reconnecting… beats missed meanwhile start a new segment.'; cls = 'live-bad'; }
  else if (info.state === 'failed') { label = 'Not connected'; msg = info.detail || 'Connection failed.'; cls = 'live-bad'; }
  else if (s && s.nBeats) {
    const st = l ? l.status : 'collecting', mb = s.o.minBeats, cur = s.cur.rr.length, streaming = info.state === 'streaming';
    if (st === 'collecting') { label = streaming ? 'Collecting' : 'Stopped'; msg = `${cur} of ${mb} beats before the first fit. Only the RR intervals are shown so far.`; cls = 'live-warn'; }
    else if (st === 'provisional') { label = streaming ? 'Provisional' : 'Stopped'; msg = `Reconstructing on ${mmss(l.windowS)} of data: the parameters are still settling (about ${mmss(s.o.provisionalS)} are needed). Read the states with care.`; cls = 'live-warn'; }
    else { label = streaming ? 'Tracking' : 'Stopped'; msg = `Reconstructing on the last ${mmss(l.windowS)}; states updated at every beat, parameters every ${s.o.refitEveryS} s.`; cls = streaming ? 'live-ok' : ''; }
    if (s.segments.length > 1) msg += ` Segment ${s.cur.id + 1} of ${s.segments.length} (a gap or reconnection started a new one).`;
  } else if (info.state === 'streaming') { label = 'Waiting'; msg = 'Connected: waiting for the first beats…'; cls = 'live-warn'; }
  pill.textContent = label; pill.className = 'pill ' + cls; txt.textContent = msg;
}
function renderMetrics() {
  const s = session, l = s && s.latest, p = l && l.params, n = l ? l.dy.length : 0, last = n ? l.dy[n - 1] : null, k = n - 1;
  if (!s) { $('live-metrics').innerHTML = ['Heart rate', 'Last RR', 'RMSSD (60 s)', 'x_p now (vagal)', 'x_s now (sympathetic)', 'ν₀ (model)', 'τ Sympathetic', 'τ Parasympathetic', 'V_P / V_S', 'Beats (rejected)', 'Recorded', 'Last fit'].map(t => `<div class="mc"><div class="mc-lbl"><span>${t}</span></div><div class="mc-val">—</div></div>`).join(''); return; }
  const rm = s.rmssd(60), ft = s.fits.length ? s.fits[s.fits.length - 1] : null;
  const items = [
    { l: 'Heart rate', v: s.hr != null ? s.hr : (last ? fmt(60 / last, 0) : '—'), u: 'bpm', hi: true }, { l: 'Last RR', v: last ? fmt(last * 1000, 0) : '—', u: 'ms' }, { l: 'RMSSD (60 s)', v: rm != null ? fmt(rm, 1) : '—', u: 'ms' },
    { l: 'x_p now (vagal)', v: p ? fmt(l.Xp[k], 3) : '—', u: 'Hz' }, { l: 'x_s now (sympathetic)', v: p ? fmt(l.Xs[k], 3) : '—', u: 'Hz' },
    { l: 'ν₀ (model)', v: p ? fmt(p.nu0 * 60, 1) : '—', u: 'bpm' }, { l: 'τ Sympathetic', v: p ? fmt(1 / p.ks, 0) : '—', u: 's' }, { l: 'τ Parasympathetic', v: p ? fmt(1 / p.kp, 1) : '—', u: 's' },
    { l: 'V_P / V_S', v: p ? fmt(p.lp, 2) : '—', u: '' }, { l: 'Beats (rejected)', v: s.nBeats + ' (' + s.rejected + ')', u: '' }, { l: 'Recorded', v: mmss(s.duration), u: 'min:s' }, { l: 'Last fit', v: ft ? fmt(ft.ms, 0) : '—', u: ft ? 'ms · ' + (s.fits.length) + ' fits' : '' }];
  $('live-metrics').innerHTML = items.map(it => `<div class="mc${it.hi ? ' hi' : ''}"><div class="mc-lbl"><span>${it.l}</span></div><div class="mc-val">${it.v}<span class="mc-unit"> ${it.u}</span></div></div>`).join('');
  const c = $('live-counts'), cal = s.calibDiscarded ? ` · ${s.calibDiscarded} discarded in calibration` : '';
  c.textContent = s.nBeats ? `${s.nBeats} beats in ${mmss(s.duration)} · ${s.rejected} rejected${cal} · ${s.segments.length} segment${s.segments.length > 1 ? 's' : ''}${s.segments.length > 1 ? ' (longest ' + s.longestSegment().rr.length + ' beats)' : ''}` : (calibLeft() > 0 ? `Calibrating: ${s.calibDiscarded} beats discarded so far.` : 'No beats yet.' + cal);
  syncButtons();
  let note = ''; if (l && l.changed) note += `RR cleaning on: ${l.changed.reduce((a, b) => a + b, 0)} of ${n} beats in the window replaced. `; if (s.lastError) note += 'Last error: ' + String(s.lastError.message || s.lastError) + '. ';
  if (s.contact === false) note += 'The sensor reports no skin contact. '; $('live-note').textContent = note + 'The filtered states are causal: the newest values use only the beats received so far, so they lag a sudden change by the response time of the drives.';
}
function syncButtons() { const has = !!(session && session.nBeats); ['live-send', 'live-dl-rr', 'live-dl-json', 'live-clear'].forEach(id => { $(id).disabled = !has; }); $('live-dl-recon').disabled = !(session && session.latest && session.latest.irr); }

/* ---- plot size: the height is kept between half and twice the width (preferred height from data-h, clamped) ------------------------------------ */
const ASPECT = { min: 0.5, max: 2 };
function chartHeight(width, pref) { return Math.round(Math.min(Math.max(pref, ASPECT.min * width), ASPECT.max * width)); }
let layoutBusy = false, ro = null;
function layoutCharts() {
  if (layoutBusy) return; layoutBusy = true;
  try { doc.querySelectorAll('.live-card .cc-body').forEach(b => { const w = b.clientWidth; if (!w) return; const h = chartHeight(w, +b.dataset.h || 260); if (b.style.height !== h + 'px') { b.style.height = h + 'px'; const cv = b.querySelector('canvas'), ch = cv && root.Chart && root.Chart.getChart && root.Chart.getChart(cv); if (ch) ch.resize(); } }); }
  finally { layoutBusy = false; }
}
function watchLayout() { if (ro || !root.ResizeObserver) return; let raf = 0; ro = new root.ResizeObserver(() => { if (raf) return; raf = (root.requestAnimationFrame || (f => setTimeout(f, 16)))(() => { raf = 0; layoutCharts(); }); }); doc.querySelectorAll('.live-card').forEach(c => ro.observe(c)); }
root.addEventListener('resize', () => layoutCharts());

/* ---- charts -------------------------------------------------------------------------------------------------------------------------------------------- */
const css = v => root.getComputedStyle(doc.documentElement).getPropertyValue(v).trim();
const withA = (hex, a) => /^#[0-9a-f]{6}$/i.test(hex) ? hex + a : hex;
function axisFmt(v) { return mmss(v); }
/** Subtle axis colours for both themes (translucent, so they work on any card colour): hairline horizontal grid, no vertical grid, a slightly stronger baseline. */
const isLight = () => doc.documentElement.getAttribute('data-theme') === 'light';
const gridCol = () => isLight() ? 'rgba(15,27,45,.075)' : 'rgba(160,185,225,.075)', axisCol = () => isLight() ? 'rgba(15,27,45,.16)' : 'rgba(160,185,225,.15)';
function buildChart(id, datasets, ytitle) {
  if (!root.Chart) return null; const cv = $(id); if (!cv) return null; const tx = css('--tx2') || '#8a97ad', tx3 = css('--tx3') || tx;
  return new root.Chart(cv, { type: 'line', data: { datasets }, options: { responsive: true, maintainAspectRatio: false, animation: false, normalized: true, parsing: false, interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: { legend: { labels: { color: tx, filter: (it, data) => it.text !== '' && data.datasets[it.datasetIndex].data.length > 0 && !data.datasets[it.datasetIndex].hidden, boxWidth: 12, font: { size: 10 } } }, tooltip: { callbacks: { title: it => 't = ' + mmss(it[0].parsed.x), label: c => ` ${c.dataset.label}: ${Number(c.parsed.y).toPrecision(4)}` } } },
    scales: { x: { type: 'linear', ticks: { color: tx3, callback: axisFmt, maxTicksLimit: 8, padding: 6, font: { size: 10 } }, grid: { display: false, drawTicks: false }, border: { display: true, color: axisCol() }, title: { display: true, text: 'Time since the start of the segment (min:s)', color: tx, font: { size: 10 } } },
              y: { ticks: { color: tx3, padding: 8, font: { size: 10 } }, grid: { color: gridCol(), drawTicks: false }, border: { display: false }, title: { display: true, text: ytitle, color: tx, font: { size: 10 } } } } } });
}
const ds = (label, color, o) => Object.assign({ label, data: [], parsing: false, borderColor: color, backgroundColor: color, pointRadius: 0, pointHoverRadius: 3, borderWidth: 1.6, order: 3 }, o || {});
function ensureCharts() {
  if (charts.rr || !root.Chart) return; themeSig = sigNow();
  const col = ST.colors(), tx2 = css('--tx2') || '#8a97ad';
  charts.rr = buildChart('live-chart-rr', [ds('', 'transparent', { borderWidth: 0, fill: '+1', backgroundColor: withA(col.S, '30'), order: 5 }), ds('', 'transparent', { borderWidth: 0, order: 5 }), ds('Received RR', withA(tx2, 'CC'), { showLine: false, pointRadius: 1.8, borderWidth: 0, order: 4 }),
    ds('Series used by the model', col.S, { borderWidth: 1.2, borderDash: [], pointRadius: 0, hidden: true, order: 3 }), ds('Filtered RR', col.S, { borderWidth: 2, order: 2 }), ds('Replaced by cleaning', '#D6562B', { showLine: false, pointRadius: 4, pointStyle: 'circle', backgroundColor: 'transparent', borderWidth: 1.5, order: 1 })], 'RR interval (s)');
  charts.states = buildChart('live-chart-states', [ds('', 'transparent', { borderWidth: 0, fill: '+1', backgroundColor: withA(col.P, '2A'), order: 6 }), ds('', 'transparent', { borderWidth: 0, order: 6 }), ds('', 'transparent', { borderWidth: 0, fill: '+1', backgroundColor: withA(col.S, '2A'), order: 6 }), ds('', 'transparent', { borderWidth: 0, order: 6 }),
    ds('x_p (vagal-like)', col.P, { borderWidth: 2, order: 2 }), ds('x_s (sympathetic-like)', col.S, { borderWidth: 2, order: 1 })], 'Drive (Hz)');
}
/* ---- continuous display: the plots are drawn at a display time that advances smoothly, with the curve interpolated between beats ------------------------------ */
const SM = L.smooth, disp = { t: null, seg: null, last: 0, yr: {}, raf: 0, running: false }; let view = null;
const smoothOn = () => !!LS('smooth') && !(ST.get('appearance.reduceMotion') || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches));
const delayS = () => Math.max(0.3, +LS('displayDelayS') || 1);
function scheduleDraw() {
  if (drawTimer) return; const wait = Math.max(0, (smoothOn() ? 250 : 450) - (Date.now() - lastDraw));
  drawTimer = setTimeout(() => { drawTimer = null; lastDraw = Date.now(); draw(); }, wait);
}
/** Point arrays of the newest reconstruction (built once per update; the frame loop only slices them). */
function prepare(l) {
  const n = l.dy.length, z = 1.96, has = !!l.irr, P = (arr, f) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = { x: l.t[i], y: f ? f(arr[i], i) : arr[i] }; return out; }, sd = (V, i) => Math.sqrt(Math.max(V[i], 0));
  return { l, n, rr: { hi: has ? P(l.irr, (v, i) => v + z * sd(l.rrV, i)) : [], lo: has ? P(l.irr, (v, i) => v - z * sd(l.rrV, i)) : [], recv: P(l.raw), used: l.changed ? P(l.dy) : [], filt: has ? P(l.irr) : [], rep: l.changed ? P(l.raw).filter((p, i) => l.changed[i]) : [] },
    st: { pHi: has ? P(l.Xp, (v, i) => v + z * sd(l.XpV, i)) : [], pLo: has ? P(l.Xp, (v, i) => v - z * sd(l.XpV, i)) : [], sHi: has ? P(l.Xs, (v, i) => v + z * sd(l.XsV, i)) : [], sLo: has ? P(l.Xs, (v, i) => v - z * sd(l.XsV, i)) : [], xp: has ? P(l.Xp) : [], xs: has ? P(l.Xs) : [] } };
}
/** The points of one series up to the display time, plus an interpolated tip exactly at it. */
function visible(arr, t, i0, i1, tDisp, tip) {
  if (!arr.length) return arr; const out = arr.slice(i0, i1);
  if (tip && i1 > 0 && i1 < arr.length && tDisp > t[i1 - 1]) { const f = (tDisp - t[i1 - 1]) / (t[i1] - t[i1 - 1]); out.push({ x: tDisp, y: arr[i1 - 1].y + f * (arr[i1].y - arr[i1 - 1].y) }); }
  return out;
}
function yTarget(series, minSpan) {
  let lo = Infinity, hi = -Infinity; series.forEach(a => { for (let i = 0; i < a.length; i++) { const y = a[i].y; if (y < lo) lo = y; if (y > hi) hi = y; } });
  if (!isFinite(lo)) return null; if (hi - lo < minSpan) { const c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; } const pad = 0.06 * (hi - lo); return { lo: lo - pad, hi: hi + pad };
}
function renderFrame(tDisp, dtS) {
  const c = view; if (!c || !charts.rr || !charts.states) return; const l = c.l, t = l.t, W = session.o.chartWindowS, { xmin, xmax } = SM.viewRange(tDisp, W, 30);
  const i1 = SM.upper(t, tDisp), i0 = Math.max(0, SM.upper(t, xmin) - 1), cr = charts.rr, cs = charts.states, R = c.rr, S = c.st, V = (a, tip) => visible(a, t, i0, i1, tDisp, tip);
  const d = cr.data.datasets, rr = { hi: V(R.hi, true), lo: V(R.lo, true), recv: V(R.recv, false), used: V(R.used, true), filt: V(R.filt, true), rep: V(R.rep, false) };
  d[0].data = rr.hi; d[1].data = rr.lo; d[2].data = rr.recv; d[3].data = rr.used; d[3].hidden = !l.changed; d[4].data = rr.filt; d[5].data = rr.rep;
  const e = cs.data.datasets, st = { pHi: V(S.pHi, true), pLo: V(S.pLo, true), sHi: V(S.sHi, true), sLo: V(S.sLo, true), xp: V(S.xp, true), xs: V(S.xs, true) };
  e[0].data = st.pHi; e[1].data = st.pLo; e[2].data = st.sHi; e[3].data = st.sLo; e[4].data = st.xp; e[5].data = st.xs;
  const yr = yTarget([rr.recv, rr.filt], 0.06), ys = yTarget([st.pHi, st.pLo, st.sHi, st.sLo], 0.05), tau = 0.7;
  if (yr) { disp.yr.rr = SM.easeRange(disp.yr.rr, yr, dtS, tau); cr.options.scales.y.min = disp.yr.rr.lo; cr.options.scales.y.max = disp.yr.rr.hi; }
  if (ys) { disp.yr.st = SM.easeRange(disp.yr.st, ys, dtS, tau); cs.options.scales.y.min = disp.yr.st.lo; cs.options.scales.y.max = disp.yr.st.hi; }
  [cr, cs].forEach(ch => { ch.options.scales.x.min = xmin; ch.options.scales.x.max = xmax; ch.update('none'); });
}
function frameLoop(now) {
  disp.raf = 0; if (mode !== 'live' || !view || !smoothOn()) { disp.running = false; return; }
  const real = L.now(), dt = disp.last ? Math.min(0.25, (real - disp.last) / 1000) : 0.033;
  if (dt >= 0.028) {                                                                // about 30 frames per second
    disp.last = real; const latest = view.l.t[view.n - 1];
    if (disp.seg !== view.l.seg) { disp.seg = view.l.seg; disp.t = null; }
    disp.t = SM.advance(disp.t, latest, dt, delayS()); renderFrame(disp.t, dt);
    if (disp.t >= latest - 1e-6 && info.state !== 'streaming' && info.state !== 'lost') { disp.running = false; return; }   // nothing more will move
  }
  disp.raf = (root.requestAnimationFrame || (f => setTimeout(() => f(L.now()), 16)))(frameLoop);
}
function ensureLoop() { if (disp.running) return; disp.running = true; disp.last = 0; disp.raf = (root.requestAnimationFrame || (f => setTimeout(() => f(L.now()), 16)))(frameLoop); }
function draw() {
  renderBanner(); renderMetrics(); if (mode !== 'live') return;
  const any = !!(session && session.nBeats); doc.querySelectorAll('.live-card').forEach(c => { c.hidden = !any; }); layoutCharts();
  const s = session, l = s && s.latest; ensureCharts(); if (!charts.rr || !l || !l.dy.length) { view = null; return; }
  view = prepare(l);
  if (smoothOn()) ensureLoop(); else { disp.t = l.t[view.n - 1]; disp.seg = l.seg; renderFrame(disp.t, 10); }
}
function destroyCharts() { Object.keys(charts).forEach(k => { try { charts[k] && charts[k].destroy(); } catch (e) { /* ignore */ } delete charts[k]; }); view = null; disp.t = null; disp.yr = {}; }

/* ---- controls ------------------------------------------------------------------------------------------------------------------------------------------ */
function syncControls() {
  const v = liveSettings(); $('live-win').value = v.fitWindowMin; $('live-refit').value = v.refitEveryS; $('live-chartwin').value = v.chartWindowMin; $('live-clean').checked = !!v.clean;
  const sup = L.PolarSource.supported(); $('live-support').textContent = sup ? 'Web Bluetooth is available. The Polar H10 needs to be worn (moisten the electrodes) and not connected to another app.' : 'This browser has no Web Bluetooth: use Chrome or Edge (desktop or Android) on https:// or localhost.';
  $('live-connect').title = sup ? 'Choose a Polar H10 (or any Bluetooth heart-rate sensor) in the browser dialog' : 'Web Bluetooth is not available in this browser';
}
[['live-win', 'live.fitWindowMin'], ['live-refit', 'live.refitEveryS'], ['live-chartwin', 'live.chartWindowMin']].forEach(([id, path]) => { $(id).onchange = function () { const x = parseFloat(this.value); if (!isFinite(x)) { syncControls(); return; } setLive(path.slice(5), Math.max(+this.min || 0, x)); }; });
$('live-clean').onchange = function () { setLive('clean', this.checked); };
$('live-connect').onclick = () => connectPolar();
$('live-stop').onclick = () => stop();
$('live-clear').onclick = () => { if (session) { session.reset(); } destroyCharts(); setHR(null); started = null; draw(); renderBanner(); syncButtons(); };

/* ---- exports and hand-over -------------------------------------------------------------------------------------------------------------------------- */
function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
function rrCSV() { return session.toCSV(); }
function statesCSV() {
  const l = session && session.latest; if (!l || !l.irr) return null; const rows = ['time_s,rr_received_s,rr_used_s,rr_filtered_s,rr_filtered_se_s,x_p_hz,x_p_se,x_s_hz,x_s_se,replaced'];
  for (let i = 0; i < l.dy.length; i++) rows.push([l.t[i].toFixed(4), l.raw[i].toFixed(6), l.dy[i].toFixed(6), l.irr[i].toFixed(6), Math.sqrt(Math.max(l.rrV[i], 0)).toFixed(6), l.Xp[i].toFixed(7), Math.sqrt(Math.max(l.XpV[i], 0)).toFixed(6), l.Xs[i].toFixed(7), Math.sqrt(Math.max(l.XsV[i], 0)).toFixed(6), l.changed ? l.changed[i] : 0].join(','));
  return rows.join('\n') + '\n';
}
function sessionObject() {
  const s = session, l = s.latest, o = s.o; return { spark_live_session: 1, created: new Date().toISOString(), model: 'M3 (engine model_engine.R)', sensor: { kind: sourceKind, name: info.name, battery_percent: info.battery },
    settings: { calibration_s: s.calibSeconds, fit_window_s: o.fitWindowS, refit_every_s: o.refitEveryS, min_beats: o.minBeats, rr_min_ms: o.rrMinMs, rr_max_ms: o.rrMaxMs, gap_s: o.gapS, cleaning: o.clean }, summary: s.summary(),
    parameters_last: l && l.params ? l.params : null, fits: s.fits, segments: s.segments.map(g => ({ id: g.id, started_by: g.reason, rr_s: g.rr })), rejected: s.log.filter(r => r.status === 'rejected').map(r => r.rr), gaps: s.log.filter(r => r.status === 'gap') };
}
const dl = (content, name, mime) => (X && X.download ? X.download(content, name, mime) : null);
$('live-dl-rr').onclick = () => { if (session && session.nBeats) { dl(rrCSV(), `spark_live_rr_${stamp()}.csv`, 'text/csv'); toast('Saved the received RR intervals.', 'ok'); } };
$('live-dl-recon').onclick = () => { const c = statesCSV(); if (c) { dl(c, `spark_live_states_${stamp()}.csv`, 'text/csv'); toast('Saved the states of the current window.', 'ok'); } else toast('No reconstruction yet: wait for the first fit.', '', 3000); };
$('live-dl-json').onclick = () => { if (session && session.nBeats) { dl(JSON.stringify(sessionObject(), null, 2), `spark_live_session_${stamp()}.json`, 'application/json'); toast('Saved the live session.', 'ok'); } };
function sendToAnalysis() {
  const s = session, seg = s && s.longestSegment(); if (!seg || seg.rr.length < 30) { toast('Too few beats to analyse (at least 30).', 'err', 3500); return false; }
  const rr = seg.rr.slice(), label = `Live session ${stamp()} (${rr.length} beats, ${mmss(seg.t[seg.t.length - 1])})`; SA.setData(rr, label);
  setMode('analysis'); const multi = s.segments.length > 1; toast(`Loaded ${rr.length} beats${multi ? ' (the longest of ' + s.segments.length + ' segments)' : ''}. Click Run Analysis.`, 'ok', 4200);
  if (ST.get('analysis.autoRun')) SA.run(); return true;
}
$('live-send').onclick = sendToAnalysis;

/* ---- mode switch ---------------------------------------------------------------------------------------------------------------------------------------- */
function setMode(m) {
  mode = m === 'live' ? 'live' : 'analysis'; $('app').dataset.mode = mode;
  $('mode-analysis').classList.toggle('active', mode === 'analysis'); $('mode-live').classList.toggle('active', mode === 'live'); $('mode-analysis').setAttribute('aria-selected', mode === 'analysis'); $('mode-live').setAttribute('aria-selected', mode === 'live');
  if (mode === 'live') { syncControls(); watchLayout(); draw(); layoutCharts(); setTimeout(() => { layoutCharts(); Object.keys(charts).forEach(k => charts[k] && charts[k].resize()); }, 50); }
  emit('mode', mode);
}
$('mode-analysis').onclick = () => setMode('analysis'); $('mode-live').onclick = () => setMode('live');
function emit(ev, payload) { listeners.filter(l => l.ev === ev).forEach(l => { try { l.fn(payload); } catch (e) { console.error(e); } }); }
let themeSig = '';
const sigNow = () => [doc.documentElement.getAttribute('data-theme') || 'dark', css('--acc'), JSON.stringify(ST.colors())].join('|');
function rebuildIfThemeChanged() { const s = sigNow(); if (s === themeSig) return; themeSig = s; if (Object.keys(charts).length) { destroyCharts(); if (mode === 'live') draw(); } }
if (root.MutationObserver) new root.MutationObserver(rebuildIfThemeChanged).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
ST.onChange(p => { if (typeof p === 'string' && /^(appearance|charts)/.test(p)) rebuildIfThemeChanged(); });
ST.onChange(p => { if (typeof p === 'string' && (p.startsWith('live') || p === '*' || p === 'analysis' || /^analysis\.clean/.test(p) || p.startsWith('model'))) applyOptions(); });
syncControls(); renderBanner(); renderMetrics(); doc.querySelectorAll('.live-card').forEach(c => { c.hidden = true; });
if (stale && root.SparkApp && root.SparkApp.ready) root.SparkApp.ready.then(() => toast('Some files are from an older version (cached?). Reload the page ignoring the cache: Ctrl+Shift+R.', 'err', 9000));

/* ---- public API ------------------------------------------------------------------------------------------------------------------------------------------- */
root.SPARK = root.SPARK || {};
root.SPARK.live = {
  supported: () => L.PolarSource.supported(), connect: connectPolar, simulate, stop, setMode, mode: () => mode, session: () => session, sendToAnalysis,
  state: () => ({ state: info.state, name: info.name, battery: info.battery, kind: sourceKind }), summary: () => session ? session.summary() : null, latest: () => session ? session.latest : null,
  clear: () => $('live-clear').onclick(), flush: () => { if (drawTimer) { clearTimeout(drawTimer); drawTimer = null; } lastDraw = Date.now(); draw(); if (view && charts.rr) { const latest = view.l.t[view.n - 1]; if (disp.t == null || !smoothOn()) disp.t = smoothOn() ? SM.advance(null, latest, 0, delayS()) : latest; renderFrame(disp.t, 0.033); } },
  on: (ev, fn) => { listeners.push({ ev, fn }); return () => { const i = listeners.findIndex(l => l.fn === fn); if (i >= 0) listeners.splice(i, 1); }; },
  display: () => ({ t: disp.t, latest: view ? view.l.t[view.n - 1] : null, smooth: smoothOn(), running: disp.running, delay: delayS() }), layout: layoutCharts, chartHeight, aspect: ASPECT, calibration: () => session ? { calibrating: session.calibrating, left: calibLeft(), seconds: session.calibSeconds, discarded: session.calibDiscarded } : null,
  csv: { rr: () => session ? rrCSV() : '', states: () => session ? statesCSV() : null }, sessionObject: () => session ? sessionObject() : null
};
root.SparkLiveUI = { setMode, draw, ensureSession, onPacket, onStatus };
})(typeof window !== 'undefined' ? window : globalThis);

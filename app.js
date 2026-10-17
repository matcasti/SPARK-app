/* ============================================================================
   SPARK app: wiring of data, model (engine.js), charts (charts.js), settings and exports.
   ========================================================================== */
(function (root) {
'use strict';
const doc = root.document, E = root.SparkEngine, ST = root.SparkSettings, C = root.SparkCharts, X = root.SparkExport;
const $ = id => doc.getElementById(id);
const S = { rr: null, label: '', events: null, fit: null, rep: null, bundle: null, auto: null, manual: false, running: false };
const tick = () => new Promise(r => root.requestAnimationFrame ? root.requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0));
const fmt = (x, d) => isFinite(x) ? x.toFixed(d) : '—';

/* ---- feedback ----------------------------------------------------------------------------------------------------------------- */
function toast(msg, kind, ms) {
  const host = $('toasts'); if (!host) return; const t = doc.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms || 3200);
}
function setProgress(msg, pct) { $('prog-fill').style.width = pct + '%'; $('prog-text').textContent = msg; }
function showAlert(type, msg) {
  ['ok', 'err'].forEach(t => { const el = $('alert-' + t); el.textContent = ''; el.classList.remove('show'); });
  const el = $('alert-' + type); el.textContent = msg; el.classList.add('show');
}

/* ---- appearance ------------------------------------------------------------------------------------------------------------------ */
function syncThemeIcons(light) { $('ico-sun').style.display = light ? 'none' : 'block'; $('ico-moon').style.display = light ? 'block' : 'none'; }
function applyAppearance() { syncThemeIcons(ST.applyAppearance()); }
function redraw() { if (S.bundle) { C.chartDefaults(); C.buildAll(S.bundle); } }
$('theme-btn').onclick = () => { const light = doc.documentElement.dataset.theme === 'light'; ST.set('appearance.theme', light ? 'dark' : 'light'); };

/* ---- layout: tabs, drawer, collapsible panels --------------------------------------------------------------------------------------- */
const TABS = ['overview', 'signal', 'autonomic', 'model', 'stats', 'diag'];
function showTab(tab) {
  doc.querySelectorAll('.tab-btn').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  doc.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  C.resizeCharts();                                                  // synchronous: charts get their size at once
  setTimeout(C.resizeAll, 0);                                         // heavy canvases right after (does not depend on frame callbacks)
}
doc.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
const NARROW = () => root.matchMedia ? root.matchMedia('(max-width: 860px)').matches : (root.innerWidth <= 860);
function setDrawer(open) { $('sidebar').classList.toggle('open', open); $('scrim').classList.toggle('show', open && NARROW()); syncScrollLock(); }
/** Wide screens: the menu button collapses / restores the sidebar (remembered). Narrow screens: it opens the drawer. */
function toggleSidebar() {
  if (NARROW()) { setDrawer(!$('sidebar').classList.contains('open')); return; }
  const collapsed = doc.body.classList.toggle('sb-collapsed'); try { root.localStorage.setItem('spark.sidebar', collapsed ? 'collapsed' : 'open'); } catch (e) { /* ignore */ }
  $('menu-btn').setAttribute('aria-expanded', collapsed ? 'false' : 'true'); setTimeout(C.resizeAll, 60);
}
$('menu-btn').onclick = toggleSidebar; $('scrim').onclick = () => setDrawer(false);
/** The page must not scroll behind a drawer, a modal or a fullscreen chart. */
function syncScrollLock() {
  const lock = ($('settings-modal') && $('settings-modal').classList.contains('show')) || !!doc.querySelector('.cc.fullscreen') || (NARROW() && $('sidebar').classList.contains('open'));
  doc.body.classList.toggle('no-scroll', lock);
}
if (root.MutationObserver) new MutationObserver(syncScrollLock).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
root.addEventListener('resize', () => { if (!NARROW()) { $('sidebar').classList.remove('open'); $('scrim').classList.remove('show'); } syncScrollLock(); });
try { if (root.localStorage.getItem('spark.sidebar') === 'collapsed' && !NARROW()) doc.body.classList.add('sb-collapsed'); } catch (e) { /* ignore */ }
function initCollapse(h, b, a) {
  const hdr = $(h), body = $(b), arr = $(a);
  const toggle = () => { const open = body.classList.contains('hidden'); body.classList.toggle('hidden', !open); arr.classList.toggle('closed', !open); arr.classList.toggle('open', open); hdr.classList.toggle('open', open); hdr.classList.toggle('closed', !open); hdr.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  hdr.addEventListener('click', toggle); hdr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
}
initCollapse('hdr-sim', 'body-sim', 'arr-sim'); initCollapse('hdr-export', 'body-export', 'arr-export');

/* ---- data ------------------------------------------------------------------------------------------------------------------------------ */
const dz = $('drop-zone');
['dragenter', 'dragover'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => dz.addEventListener(e, () => dz.classList.remove('over')));
dz.addEventListener('drop', ev => { ev.preventDefault(); const f = ev.dataTransfer.files[0]; if (f) readFile(f); });
$('file-in').onchange = function () { if (this.files[0]) readFile(this.files[0]); this.value = ''; };
function readFile(f) {
  const r = new root.FileReader();
  r.onload = e => {
    const res = E.parseRR(String(e.target.result));
    if (!res) { showAlert('err', 'Could not parse file — need ≥30 RR values in seconds (0.1–3.0 s) or milliseconds (100–3000 ms).'); return; }
    setData(res.vals, f.name); showAlert('ok', `Loaded: ${f.name}  (${res.vals.length} beats${res.wasMs ? ' · auto-converted ms → s' : ''})`);
    if (ST.get('analysis.autoRun')) run();
  };
  r.readAsText(f);
}
$('btn-example').onclick = () => {
  const ex = E.genExampleSession(); setData(ex.rr, ex.label, ex.events);
  showAlert('ok', `Example loaded: simulated 5-2-5 recording (5 min rest, 2 min exercise, 5 min recovery; ${ex.rr.length} beats). Click Run Analysis.`); if (ST.get('analysis.autoRun')) run();
};
function setData(rr, label, events) {
  S.rr = rr; S.label = label; S.events = events || null; S.auto = null; S.fit = null; S.rep = null; S.bundle = null; S.manual = false;
  $('data-chip').classList.add('ok'); $('data-chip-text').textContent = `${label} — ${rr.length} beats · ${rr.reduce((a, b) => a + b, 0).toFixed(1)} s`;
  $('btn-run').disabled = false; $('btn-run-top').disabled = false;
  $('results-wrap').style.display = 'none'; $('empty-state').style.display = 'flex'; $('sim-result').style.display = 'none';
  X.setContext({ fit: null, label });
}
/** Phase markers: the user's (Settings → Analysis) when both are set, otherwise those of the loaded example. */
function effectiveEvents() {
  const A = ST.get('analysis'); if (A.phaseRest > 0 && A.phaseExercise > A.phaseRest) return { t_on: A.phaseRest, t_off: A.phaseExercise, source: 'settings' };
  return S.events ? Object.assign({ source: 'example' }, S.events) : null;
}

/* ---- analysis ------------------------------------------------------------------------------------------------------------------------------ */
function modelSummary() {
  const d = ST.modelDiff(), n = Object.keys(d.priors).length + Object.keys(d.control).length;
  $('model-summary').textContent = n ? `Model: M3G with ${n} setting${n > 1 ? 's' : ''} changed from the engine defaults.` : 'Model: M3G, engine defaults.';
}
async function run() {
  if (!S.rr || S.running) return; S.running = true; setDrawer(false);
  $('btn-run').disabled = true; $('btn-run-top').disabled = true; $('prog-outer').style.display = 'block'; ['ok', 'err'].forEach(t => $('alert-' + t).classList.remove('show'));
  try {
    let cfg; try { cfg = ST.modelSettings(); } catch (e) { throw new Error('Model settings: ' + e.message); }
    setProgress('Extracting Morlet CWT spectral anchor…', 8); await tick();
    const pr = E.extractSpectralPriors(S.rr, cfg.priors);
    setProgress('Running 4-D BFGS (M3G: causal vagal gate, γ)…', 25); await tick();
    const fit = E.fitFromAnchor(S.rr, pr, cfg.control);
    let rep = null;
    if (ST.get('analysis.computeSE')) { setProgress('Hessian, standard errors and Laplace posterior…', 62); await tick(); try { rep = E.reportModel(fit); } catch (e) { console.warn('SE failed', e); } }
    setProgress('Computing statistics and building charts…', 82); await tick();
    S.fit = fit; S.rep = rep; S.manual = false;
    S.auto = { ks: fit.params.ks, kp: fit.params.kp, lR: fit.params.lR, lp: fit.params.lp, gamma: fit.params.gamma };
    syncSliders(S.auto); $('sim-result').style.display = 'none';
    renderFit(); showTab('overview');
    $('empty-state').style.display = 'none'; $('results-wrap').style.display = 'block'; setTimeout(C.resizeAll, 30);
    setProgress('Complete ✓', 100);
    const p = fit.params;
    showAlert('ok', `ν₀ = ${(p.nu0 * 60).toFixed(1)} bpm · τ_S = ${(1 / p.ks).toFixed(0)} s · τ_P = ${(1 / p.kp).toFixed(2)} s · γ = ${p.gamma.toFixed(4)}${p.gate_off ? ' (gate off)' : ''} · ${fit.opt.convergence === 0 ? 'converged' : 'max iterations reached'}`);
  } catch (e) { setProgress('Error', 0); showAlert('err', 'Analysis failed: ' + e.message); console.error(e); }
  S.running = false; $('btn-run').disabled = false; $('btn-run-top').disabled = false;
}
$('btn-run').onclick = run; $('btn-run-top').onclick = run;

/** Everything derived from a fit that the charts, tables and exports use. */
function computeBundle(fit, rep) {
  const A = ST.get('analysis'), dm = E.derivedMetrics(fit), diag = E.innovationDiagnostics(fit);
  const events = effectiveEvents(), phases = events ? E.phaseSummary(fit, events, dm) : null;
  return { fit, rep, dm, diag, events, phases, psd: E.hrPSD(fit.dy, fit.irr, fit.time), hrvObs: E.hrvStats(fit.dy, fit.pr), hrvFlt: E.hrvStats(fit.irr, fit.pr), roll: E.rollingStats(fit.time, fit.dy, fit.irr, A.rollWindow, A.rollStep),
           land: E.stateLandscape(fit.Xp, fit.Xs, dm.sdP_ss, dm.sdS_ss, { nGrid: A.landscapeGrid, bandwidth: A.landscapeBandwidth, minRel: A.minBasin }) };
}
function renderFit() {
  const fit = S.fit; if (!fit) return;
  S.bundle = computeBundle(fit, S.manual ? null : S.rep);
  renderTables(S.bundle); C.buildAll(S.bundle);
  X.setContext({ fit, rep: S.bundle.rep, dm: S.bundle.dm, diag: S.bundle.diag, events: S.bundle.events, phases: S.bundle.phases, hrvObs: S.bundle.hrvObs, hrvFlt: S.bundle.hrvFlt, label: S.label + (S.manual ? '_manual' : '') });
}
function renderTables(R) {
  const { fit, rep, dm, diag } = R, p = fit.params, f4 = x => isFinite(x) ? Number(x).toPrecision(5) : '—';
  $('param-tbody').innerHTML = X.paramRows(fit, rep).map(r => `<tr><td class="pn">${r.n}</td><td class="pg"><span class="gtag ${r.gc}">${r.group}</span></td><td class="pv">${f4(r.est)}</td><td class="pse">${isFinite(r.se) ? Number(r.se).toPrecision(3) : '—'}</td><td class="pci">${isFinite(r.lo) ? '[' + Number(r.lo).toPrecision(4) + ', ' + Number(r.hi).toPrecision(4) + ']' : '—'}</td><td class="pi">${r.interp}</td><td class="ps">${r.status}</td></tr>`).join('');
  $('model-pill').innerHTML = `<span class="pill ${p.gate_off ? 'off' : 'on'}">${p.gate_off ? 'vagal gate off' : 'vagal gate on'}</span>`;
  $('se-note').textContent = S.manual ? 'Manual parameter values: standard errors are not defined for a manual run.' : rep ? 'SE and 95% intervals: numerical Hessian of the MAP objective with the delta method (as report_model in the R engine). Profiled, fixed and derived parameters have no SE; γ has none when the gate is off.' : 'Standard errors are switched off (Settings → Analysis).';
  const items = [
    { l: 'Heart rate', v: (p.nu0 * 60).toFixed(1), u: 'bpm', hi: true, t: 'm-hr' }, { l: 'τ Sympathetic', v: (1 / p.ks).toFixed(1), u: 's', t: 'm-ts' }, { l: 'τ Parasympathetic', v: (1 / p.kp).toFixed(2), u: 's', t: 'm-tp' },
    { l: 'κ_P / κ_S', v: (p.kp / p.ks).toFixed(2), u: '×', t: 'm-kpks' }, { l: 'V_P / V_S', v: p.lp.toFixed(3), u: '', t: 'm-hflf' }, { l: 'Vagal gate γ', v: p.gamma.toFixed(4), u: p.gate_off ? 'off' : 'on', t: 'm-gamma' },
    { l: 'σ_P / σ_S', v: (p.sigP / p.sigS).toFixed(2), u: '×', t: 'm-sigs' }, { l: 'RR jitter', v: p.rr_jitter_ms.toFixed(2), u: 'ms', t: 'm-jit' }, { l: 'RMSSD (filtered)', v: dm.rmssdFlt.toFixed(1), u: 'ms', t: 'm-rmssd' },
    { l: 'SDNN (filtered)', v: dm.sdnnFlt.toFixed(1), u: 'ms', t: 'm-sdnn' }, { l: 'Fit RMSE', v: dm.rmse.toFixed(2), u: 'ms', t: 'm-rmse' }, { l: 'Gated beats', v: dm.pctGated.toFixed(1), u: '%', t: 'm-gate' },
    { l: 'Log-likelihood', v: fit.LL_star.toFixed(1), u: '', t: 'm-ll' }, { l: 'Areal velocity', v: dm.rmsArealVel.toFixed(5), u: 'Hz²/s', t: 'm-avel' }, { l: 'Mean EPR  ṡ̄', v: dm.mEPR.toFixed(4), u: 's⁻¹', t: 'm-mepr' }, { l: 'Balance σ', v: dm.abiStd.toFixed(3), u: 'nats', t: 'm-bstd' }];
  $('metric-grid').innerHTML = items.map(it => `<div class="mc${it.hi ? ' hi' : ''}"><div class="mc-lbl"><span>${it.l}</span><button class="info-btn" data-tip="${it.t}" aria-label="About ${it.l}">i</button></div><div class="mc-val">${it.v}<span class="mc-unit"> ${it.u}</span></div></div>`).join('');
  const chip = (cls, k, v) => `<div class="dchip ${cls}"><span class="dk">${k}</span><span class="dv">${v}</span></div>`;
  $('dchips').innerHTML = diag ? chip(diag.ks.p > 0.05 ? 'pass' : 'fail', 'KS p-value', fmt(diag.ks.p, 4)) + chip(diag.ks.p > 0.05 ? 'pass' : 'fail', 'KS stat', fmt(diag.ks.D, 4)) +
    chip(diag.pacf_violations === 0 ? 'pass' : diag.pacf_violations <= 2 ? 'warn' : 'fail', 'PACF violations', `${diag.pacf_violations}/${diag.pacf.length} lags`) + chip('', 'Beats retained', `${diag.N}/${diag.N_total}`) +
    chip(dm.pctGated < 5 ? 'pass' : dm.pctGated < 15 ? 'warn' : 'fail', 'Gated beats', fmt(dm.pctGated, 1) + '%') + chip('', 'Fit RMSE', fmt(dm.rmse, 2) + ' ms') + chip('', 'Fit MAPE', fmt(dm.mape, 2) + '%') + chip('', 'Skew / ex. kurtosis', `${fmt(diag.skew, 2)} / ${fmt(diag.kurt, 2)}`)
    : chip('fail', 'Diagnostics', 'too few valid innovations');
}

/* ---- playground ---------------------------------------------------------------------------------------------------------------------------------- */
const SL = { ks: 'sl-ks', kp: 'sl-kp', lR: 'sl-lr', lp: 'sl-lp', gamma: 'sl-gm' }, LBL = { ks: 'v-ks', kp: 'v-kp', lR: 'v-lr', lp: 'v-lp', gamma: 'v-gm' };
function sliderValue(el) { const mn = +el.dataset.min, mx = +el.dataset.max, t = +el.value / 1000; return el.dataset.log ? mn * Math.pow(mx / mn, t) : mn + (mx - mn) * t; }
function sliderSet(el, v) { const mn = +el.dataset.min, mx = +el.dataset.max; v = Math.min(mx, Math.max(mn, v)); el.value = Math.round(1000 * (el.dataset.log ? Math.log(v / mn) / Math.log(mx / mn) : (v - mn) / (mx - mn))); }
function updateSimLabels() { $('v-ks').textContent = sliderValue($('sl-ks')).toFixed(4) + ' Hz'; $('v-kp').textContent = sliderValue($('sl-kp')).toFixed(3) + ' Hz'; $('v-lr').textContent = sliderValue($('sl-lr')).toExponential(2); $('v-lp').textContent = sliderValue($('sl-lp')).toFixed(3); $('v-gm').textContent = sliderValue($('sl-gm')).toFixed(3); }
function syncSliders(a) { Object.keys(SL).forEach(k => sliderSet($(SL[k]), a[k])); updateSimLabels(); }
let _pg = null; Object.values(SL).forEach(id => $(id).addEventListener('input', () => { updateSimLabels(); clearTimeout(_pg); _pg = setTimeout(() => runPlayground(), 140); }));
function renderSim(a, m) {
  const rows = [['κ_S', a.ks, m.ks], ['κ_P', a.kp, m.kp], ['Λ_R', a.lR, m.lR], ['Λ_P', a.lp, m.lp], ['γ', a.gamma, m.gamma]];
  $('sim-tbody').innerHTML = rows.map(([n, x, y]) => { const d = x > 1e-9 ? 100 * (y - x) / x : NaN, cls = !isFinite(d) ? '' : Math.abs(d) < 5 ? 'dok' : Math.abs(d) < 15 ? 'dpos' : 'dneg'; return `<tr><td>${n}</td><td>${x.toPrecision(4)}</td><td>${y.toPrecision(4)}</td><td class="${cls}">${isFinite(d) ? (d > 0 ? '+' : '') + d.toFixed(1) + '%' : '—'}</td></tr>`; }).join('');
  $('sim-result').style.display = 'block';
}
function runPlayground(exact) {
  if (!S.rr || !S.auto) return;
  const v = exact || { ks: sliderValue($('sl-ks')), kp: sliderValue($('sl-kp')), lR: sliderValue($('sl-lr')), lp: sliderValue($('sl-lp')), gamma: sliderValue($('sl-gm')) };
  if (v.kp <= v.ks) { showAlert('err', 'κ_P must be greater than κ_S for a valid model.'); return; }
  try {
    const base = S.fit.pr, pr2 = Object.assign({}, base, { energy_ratio: v.lp }), fit = E.runManualFit(S.rr, pr2, S.fit.ctl, v);
    S.manual = !exact; S.fit = fit; if (exact) { S.fit = fit; }
    renderFit(); renderSim(S.auto, v); if (exact) showAlert('ok', 'Reset to the MAP estimate.');
  } catch (e) { showAlert('err', 'Manual filter run failed: ' + e.message); console.error(e); }
}
$('btn-sim').onclick = () => { if (!S.auto) { showAlert('err', 'Run the main analysis first to obtain MAP-estimated defaults.'); return; } syncSliders(S.auto); runPlayground(S.auto); };
$('btn-use-filtered').onclick = () => { if (!S.fit) { showAlert('err', 'Run the analysis first to generate a filtered RR series.'); return; } setData(Array.from(S.fit.irr), 'Filtered RR (re-estimation)', S.events); showAlert('ok', 'Filtered RR loaded as new input — click Run Analysis to re-estimate.'); };
$('btn-export-filtered').onclick = () => { if (!S.fit) { showAlert('err', 'Run the analysis first to generate a filtered RR series.'); return; } X.filteredRR($('exp-unit').value, $('exp-fmt').value); };

/* ---- settings, export menu, shortcuts ------------------------------------------------------------------------------------------------------------ */
let menu = null;
function openSettings(sec) { if (menu) menu.open(sec); $('settings-modal').setAttribute('aria-hidden', 'false'); }
$('btn-settings').onclick = () => openSettings(); $('btn-model-settings').onclick = () => { setDrawer(false); openSettings('model'); };
const exMenu = $('export-menu');
$('btn-export').onclick = ev => { ev.stopPropagation(); const show = !exMenu.classList.contains('show'); exMenu.classList.toggle('show', show); $('btn-export').setAttribute('aria-expanded', show ? 'true' : 'false'); };
doc.addEventListener('click', ev => { if (!ev.target.closest('.menu-wrap')) exMenu.classList.remove('show'); });
doc.addEventListener('keydown', ev => {
  const tag = (ev.target.tagName || '').toLowerCase(); if (['input', 'select', 'textarea'].includes(tag) || ev.metaKey || ev.ctrlKey || ev.altKey) { if (ev.key === 'Escape') ev.target.blur(); return; }
  const k = ev.key.toLowerCase();
  if (k === 'escape') { exMenu.classList.remove('show'); $('settings-modal').classList.remove('show'); setDrawer(false); doc.querySelectorAll('.cc.fullscreen').forEach(c => { c.classList.remove('fullscreen'); C.resizeAll(); }); }
  else if (k === 'r') run(); else if (k === 's') { ev.preventDefault(); openSettings(); } else if (k === 'e') { exMenu.classList.toggle('show'); } else if (k === 't') $('theme-btn').click();
  else if (/^[1-6]$/.test(k) && S.fit) showTab(TABS[+k - 1]);
});
let _rz; root.addEventListener('resize', () => { clearTimeout(_rz); _rz = setTimeout(C.resizeAll, 90); });
root.addEventListener('orientationchange', () => { clearTimeout(_rz); _rz = setTimeout(C.resizeAll, 220); });
doc.querySelectorAll('.panel-hdr').forEach(h => h.addEventListener('click', () => { clearTimeout(_rz); _rz = setTimeout(C.resizeAll, 220); }));

ST.onChange(path => {
  if (path === '*' || path.startsWith('appearance')) applyAppearance();
  if (path === '*' || path === 'model' || path.startsWith('model')) modelSummary();
  if (path === '*' || path.startsWith('appearance') || path.startsWith('charts') || path.startsWith('analysis')) { if (S.fit) { try { renderFit(); } catch (e) { console.error(e); } } }
  if (path === 'layout' || path === '*') doc.querySelectorAll('.cc').forEach(el => { const l = ST.Layout.get(el.dataset.chart), c = C.CARDS.find(x => x.id === el.dataset.chart); el.dataset.span = String(l.span || c.span || 6); el.querySelector('.cc-body').style.setProperty('--h', (l.h || c.h || 260) + 'px'); });
});

/* ---- start --------------------------------------------------------------------------------------------------------------------------------------------- */
async function init() {
  ST.load(); applyAppearance(); await ST.Layout.init(); C.chartDefaults(); C.mountCards(); X.mountMenu(exMenu);
  menu = ST.mountMenu($('settings-modal'), { chartList: C.chartList, toast, download: X.download, render: () => {} });
  modelSummary(); updateSimLabels();
  if (!root.Chart) showAlert('err', 'Chart.js could not be loaded (offline?). Calculations still work; charts need the library.');
}
const ready = init(); ready.catch(e => console.error(e));
root.SparkApp = { toast, state: S, run, ready, showTab, runPlayground, renderFit, computeBundle, openSettings, setData };
})(typeof window !== 'undefined' ? window : globalThis);

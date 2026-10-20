/* ============================================================================
   SPARK app: wiring of data, model (engine.js), charts (charts.js), settings and exports.
   ========================================================================== */
(function (root) {
'use strict';
const doc = root.document, E = root.SparkEngine, ST = root.SparkSettings, C = root.SparkCharts, X = root.SparkExport;
const $ = id => doc.getElementById(id);
const S = { rr: null, label: '', raw: null, read: null, drawn: null, preview: null, truth: null, phaseNote: '', fit: null, rep: null, bundle: null, auto: null, manual: false, running: false };
const _listeners = {};
function emit(ev, payload) { (_listeners[ev] || []).slice().forEach(f => { try { f(payload); } catch (e) { console.error(e); } }); }
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
  C.ensureTab(tab);                                                 // builds what is out of date for this tab, one chart per task, after the browser has painted
}
doc.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
const NARROW = () => root.matchMedia ? root.matchMedia('(max-width: 860px)').matches : (root.innerWidth <= 860);
function setDrawer(open) { $('sidebar').classList.toggle('open', open); $('scrim').classList.toggle('show', open && NARROW()); syncScrollLock(); }
/** Wide screens: the menu button collapses / restores the sidebar (remembered). Narrow screens: it opens the drawer. */
function toggleSidebar() {
  if (NARROW()) { setDrawer(!$('sidebar').classList.contains('open')); return; }
  const collapsed = doc.body.classList.toggle('sb-collapsed'); try { root.localStorage.setItem('spark.sidebar', collapsed ? 'collapsed' : 'open'); } catch (e) { /* ignore */ }
  $('menu-btn').setAttribute('aria-expanded', collapsed ? 'false' : 'true'); }
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
  r.onload = e => loadText(String(e.target.result), f.name);
  r.onerror = () => showAlert('err', 'Could not read ' + f.name + '.');
  r.readAsText(f);
}
/** Parse the text of a .txt / .csv file with the chosen time unit (Settings or the Data Input selector; default auto-detect). */
function loadText(text, name) {
  const res = E.parseRRDetailed(text, { unit: ST.get('analysis.timeUnit') });
  S.raw = { text, name };                                          // kept so that changing the unit re-reads the same file
  if (res.error) { $('unit-detected').textContent = '—'; showAlert('err', `Could not read ${name}: ${res.error}`); return false; }
  S.read = res; setData(res.vals, name, res);
  const how = { user: 'chosen by you', header: 'from the column header', auto: 'auto-detected' }[res.unitSource];
  showAlert('ok', `Loaded ${name}: ${res.nUsed} beats · read as ${E.UNIT_NAME[res.unit]} (${how})${res.kind === 'times' ? ' · beat times → RR' : ''}${res.warnings.length ? ' · ' + res.warnings.join(' ') : ''}`);
  if (ST.get('analysis.autoRun')) run();
  return true;
}
const syncUnitSelect = () => { $('time-unit').value = ST.get('analysis.timeUnit'); };
$('time-unit').onchange = () => ST.set('analysis.timeUnit', $('time-unit').value);

$('btn-example').onclick = () => loadExample(E.genExampleSession(), 'simulated 5-2-5 recording (5 min rest, 2 min exercise, 5 min recovery)');
$('btn-example-multi').onclick = () => loadExample(E.genExampleMulti(), 'simulated recording with two stressors (exercise, then a milder stressor) separated by recoveries');
function loadExample(ex, what) {
  setData(ex.rr, ex.label); S.truth = ex.truthBoundaries || (ex.events ? [ex.events.t_on, ex.events.t_off] : null);   // truth is kept for tests only: the app detects the phases itself
  showAlert('ok', `Example loaded: ${what}, ${ex.rr.length} beats. Click Run Analysis.`); if (ST.get('analysis.autoRun')) run();
}
/** A new recording starts clean: windows drawn for the previous one and typed markers (seconds of the previous recording) would not fit it.
    keepPhases = true only when the same recording is re-estimated (filtered RR). */
function resetPhasesForNewData(keep) {
  if (keep) return; const had = !!S.drawn || !!(ST.get('analysis.phaseMarkers') || '').trim();
  S.drawn = null; S.preview = null; _markerWarned = '';
  if (ST.get('analysis.phaseMarkers')) ST.set('analysis.phaseMarkers', '', true);
  if (root.SparkPhaseEditor && root.SparkPhaseEditor.isActive()) root.SparkPhaseEditor.close();
  if (had) toast('Phase windows and markers of the previous recording were cleared.', '', 3600);
}
/* ---- optional RR cleaning (the gate of tools/prep-data.R): S.rrRaw is the series as loaded, S.rr the one the analysis uses ----------------------------- */
const cleaningOptions = () => { const A = ST.get('analysis'); return { window: A.cleanWindow, n_mad: A.cleanNMad, n_iter: A.cleanNIter }; };
function deriveSeries(raw) {
  const A = ST.get('analysis'); S.clean = null;
  if (!A.cleanRR || S.cleanSkip) return raw;
  try {
    const r = E.cleanSample(raw, cleaningOptions()); if (Array.prototype.some.call(r.y, v => !isFinite(v))) throw new Error('fewer than two valid beats');
    S.clean = { opts: r.opts, n_changed: r.n_changed, changed: r.changed, raw: Array.from(raw) }; return Array.from(r.y);
  } catch (e) { showAlert('err', 'RR cleaning was not applied: ' + e.message); return raw; }
}
/** The cleaning record attached to a fit (charts and exports read it there). */
const cleaningRecord = () => S.clean ? { enabled: true, opts: S.clean.opts, n_changed: S.clean.n_changed, changed: S.clean.changed, raw: S.clean.raw } : { enabled: false };
function syncCleanControls() {
  const A = ST.get('analysis'); $('clean-on').checked = !!A.cleanRR; $('clean-window').value = A.cleanWindow; $('clean-nmad').value = A.cleanNMad; $('clean-niter').value = A.cleanNIter;
  $('clean-controls').classList.toggle('hidden', !A.cleanRR); updateCleanSummary();
}
function updateCleanSummary() {
  const A = ST.get('analysis'), el = $('clean-summary'); if (!el) return;
  if (!A.cleanRR) { el.textContent = 'Off: the data are used as loaded.'; return; }
  if (!S.rrRaw) { el.textContent = 'On: applied when a recording is loaded (the gate of tools/prep-data.R).'; return; }
  if (S.cleanSkip) { el.textContent = 'Not applied to a filtered series (re-estimation).'; return; }
  if (!S.clean) { el.textContent = 'On, but not applied (see the message above).'; return; }
  const c = S.clean; el.textContent = `${c.n_changed} of ${c.raw.length} beats replaced (${(100 * c.n_changed / c.raw.length).toFixed(1)}%) · window ${c.opts.window}, ${c.opts.n_mad}×MAD, ${c.opts.n_iter} pass${c.opts.n_iter > 1 ? 'es' : ''}.`;
}
/** A cleaning setting changed: the series is derived again from the loaded one (like a change of the time unit); results are cleared, phases kept. */
const cleanSig = () => JSON.stringify([ST.get('analysis.cleanRR'), cleaningOptions()]);
function onCleanSettings() {
  syncCleanControls(); if (!S.rrRaw || S.cleanSig === cleanSig()) return;
  const had = !!S.fit; setData(S.rrRaw, S.label, S.read, true, { noClean: S.cleanSkip }); if (had) toast('Cleaning changed: run the analysis again.', '', 3000);
}
$('clean-on').onchange = function () { ST.set('analysis.cleanRR', this.checked); };
[['clean-window', 'analysis.cleanWindow'], ['clean-nmad', 'analysis.cleanNMad'], ['clean-niter', 'analysis.cleanNIter']].forEach(([id, path]) => { $(id).onchange = function () { const v = parseFloat(this.value); if (!isFinite(v)) { syncCleanControls(); return; } ST.set(path, v); }; });
function setData(rr, label, info, keepPhases, opts) {
  S.rrRaw = rr; S.cleanSkip = !!(opts && opts.noClean); rr = deriveSeries(rr); S.cleanSig = cleanSig();
  S.rr = rr; S.label = label; S.truth = null; S.cwt = null; S.hrvObs = null; S.read = info || null; if (!info) S.raw = null; resetPhasesForNewData(keepPhases); S.auto = null; S.fit = null; S.rep = null; S.bundle = null; S.manual = false; _phaseCache = null;
  $('data-chip').classList.add('ok'); $('data-chip-text').textContent = `${label} — ${rr.length} beats · ${rr.reduce((a, b) => a + b, 0).toFixed(1)} s${info ? ' · ' + info.unit + (info.unitSource === 'auto' ? ' (auto)' : '') : ''}${S.clean ? ' · cleaned: ' + S.clean.n_changed + ' replaced' : ''}`; $('unit-detected').textContent = info ? info.unit + (info.unitSource === 'auto' ? ' · auto' : info.unitSource === 'header' ? ' · header' : ' · set') : '';
  $('btn-run').disabled = false; $('btn-run-top').disabled = false;
  $('results-wrap').style.display = 'none'; $('empty-state').style.display = 'flex'; $('sim-result').style.display = 'none';
  X.setContext({ fit: null, label, read: info || null }); updatePhasePanel(); updateCleanSummary(); emit('data', { label, beats: rr.length });
}
/** Phases of the recording: typed markers win; otherwise automatic detection (unless switched off). Detection uses the observed RR only. */
let _phaseCache = null, _markerWarned = '';
function phaseOptions() {
  const A = ST.get('analysis'), preset = { conservative: [12, 5], standard: [10, 4], sensitive: [8, 4] }[A.phaseSensitivity];
  return { minShiftBpm: preset ? preset[0] : A.phaseMinShift, minZ: preset ? preset[1] : A.phaseMinZ, minSegmentS: A.phaseMinSegment, maxStressors: A.phaseMaxStressors };
}
const dur = () => S.rr.reduce((x, y) => x + y, 0);
function effectivePhases() {
  const A = ST.get('analysis'), markers = (A.phaseMarkers || '').trim(); S.phaseNote = '';
  const win = S.preview || S.drawn;
  if (win && win.length) { const d = E.phasesFromWindows(win, dur()); if (d) return d; }       // windows drawn on the tachogram win over everything
  if (markers) {
    const m = E.phasesFromMarkers(markers, S.rr.reduce((x, y) => x + y, 0));
    if (m) return m;
    if (_markerWarned !== markers) { _markerWarned = markers; toast('Phase markers not valid (need increasing seconds within the recording); using automatic detection.', 'warn', 5000); }
  }
  if (A.phaseMode === 'off') { S.phaseNote = 'Phase analysis is switched off (Settings → Analysis → Protocol phases).'; return null; }
  const opts = phaseOptions(), key = JSON.stringify([S.rr.length, S.label, opts]);
  if (!_phaseCache || _phaseCache.key !== key) _phaseCache = { key, value: E.detectPhases(S.rr, opts) };
  if (!_phaseCache.value) S.phaseNote = `No phase change was detected (heart-rate changes of at least ${opts.minShiftBpm} bpm with z ≥ ${opts.minZ} and phases of at least ${opts.minSegmentS} s). The recording looks stable at this sensitivity: raise the sensitivity or type protocol times in Settings → Analysis → Protocol phases.`;
  return _phaseCache.value;
}
const mmss = s => { const m = Math.floor(s / 60), r = Math.round(s - m * 60); return m + ':' + String(r === 60 ? 0 : r).padStart(2, '0'); };

/* ---- analysis ------------------------------------------------------------------------------------------------------------------------------ */
function modelSummary() {
  const d = ST.modelDiff(), n = Object.keys(d.priors).length + Object.keys(d.control).length;
  $('model-summary').textContent = n ? `Model: M3 with ${n} setting${n > 1 ? 's' : ''} changed from the defaults.` : 'Model: M3, default settings.';
}
async function run() {
  if (!S.rr || S.running) return; S.running = true; setDrawer(false);
  $('btn-run').disabled = true; $('btn-run-top').disabled = true; $('prog-outer').style.display = 'block'; ['ok', 'err'].forEach(t => $('alert-' + t).classList.remove('show'));
  try {
    let cfg; try { cfg = ST.modelSettings(); } catch (e) { throw new Error('Model settings: ' + e.message); }
    const A = ST.get('analysis'); setProgress('Starting…', 3); await tick();
    C.warmUp();                                                    // the main thread is idle while the worker computes
    const job = root.SparkCompute.analyze({ rr: S.rr, priors: cfg.priors, control: cfg.control, computeSE: A.computeSE, roll: { window: A.rollWindow, step: A.rollStep }, landscape: landscapeOpts() }, (m, p) => setProgress(m, p));
    const res = await job.done; S.cwt = null;
    setProgress('Preparing the results…', 85); await tick();
    S.fit = res.fit; S.fit.cleaning = cleaningRecord(); S.rep = res.rep; S.manual = false;
    S.auto = { ks: res.fit.params.ks, kp: res.fit.params.kp, lR: res.fit.params.lR, lp: res.fit.params.lp };
    syncSliders(S.auto); $('sim-result').style.display = 'none';
    renderFit(res, job);
    showTab('overview');
    $('empty-state').style.display = 'none'; $('results-wrap').style.display = 'block';
    setProgress('Complete ✓', 100);
    const p = res.fit.params, ph = S.bundle && S.bundle.events, phText = ph ? ` · phases (${ph.source === 'auto' ? 'detected' : ph.source === 'drawn' ? 'drawn' : 'manual'}): ` + ph.segments.map(g => `${g.name} ${mmss(g.from)}–${mmss(g.to)}`).join(', ') : '';
    showAlert('ok', `ν₀ = ${(p.nu0 * 60).toFixed(1)} bpm · τ_S = ${(1 / p.ks).toFixed(0)} s · τ_P = ${(1 / p.kp).toFixed(2)} s · ${res.fit.opt.convergence === 0 ? 'converged' : 'max iterations reached'}${phText}`);
  } catch (e) { setProgress('Error', 0); showAlert('err', 'Analysis failed: ' + e.message); console.error(e); }
  S.running = false; $('btn-run').disabled = false; $('btn-run-top').disabled = false;
  return S.bundle;
}
$('btn-run').onclick = run; $('btn-run-top').onclick = run;

const landscapeOpts = () => { const A = ST.get('analysis'); return { nGrid: A.landscapeGrid, bandwidth: A.landscapeBandwidth, minRel: A.minBasin }; };
/** Everything the charts, tables and exports use. Cheap parts are eager; spectra, HRV tables, rolling statistics, the landscape and the scalogram are computed on first use
    (or arrive from the worker): a card that is never opened never pays for its data. pre = {dm, diag} when the worker already computed them. */
function computeBundle(fit, rep, pre) {
  const events = effectivePhases(), dm = pre ? pre.dm : E.derivedMetrics(fit), diag = pre ? pre.diag : E.innovationDiagnostics(fit), memo = {};
  const R = { fit, rep, dm, diag, events, phases: events ? E.phaseSummary(fit, events, dm) : null, phaseNote: S.phaseNote, extrasPending: false, extrasReady: Promise.resolve() };
  const lazy = (name, fn) => Object.defineProperty(R, name, { enumerable: true, configurable: true, get() { if (!(name in memo)) memo[name] = fn(); return memo[name]; } });
  lazy('phaseHRV', () => E.phaseHRV(fit, R.events, fit.pr));
  lazy('psd', () => E.hrPSD(fit.dy, fit.irr, fit.time)); lazy('hrvFlt', () => E.hrvStats(fit.irr, fit.pr));
  lazy('hrvObs', () => (S.hrvObs && S.hrvObs.n === fit.dy.length ? S.hrvObs.v : (S.hrvObs = { n: fit.dy.length, v: E.hrvStats(fit.dy, fit.pr) }).v));
  lazy('roll', () => { const A = ST.get('analysis'); return E.rollingStats(fit.time, fit.dy, fit.irr, A.rollWindow, A.rollStep); });
  lazy('land', () => E.stateLandscape(fit.Xp, fit.Xs, dm.sdP_ss, dm.sdS_ss, landscapeOpts()));
  lazy('cwt', () => (S.cwt && S.cwt.n === fit.dy.length ? S.cwt.v : (S.cwt = { n: fit.dy.length, v: E.cwtDisplay(fit.dy) }).v));           // depends on the data only: reused across manual fits
  R.reset = names => names.forEach(n => delete memo[n]);
  R.setExtras = (ex, sig) => { if (!ex) return; ['psd', 'hrvObs', 'hrvFlt', 'cwt'].forEach(k => { if (ex[k] && !(k in memo)) memo[k] = ex[k]; }); if (ex.cwt) S.cwt = { n: fit.dy.length, v: ex.cwt }; if (ex.hrvObs) S.hrvObs = { n: fit.dy.length, v: ex.hrvObs };
    if (sig === extrasSig()) ['roll', 'land'].forEach(k => { if (ex[k] && !(k in memo)) memo[k] = ex[k]; }); };
  return R;
}
const extrasSig = () => { const A = ST.get('analysis'); return JSON.stringify([A.rollWindow, A.rollStep, landscapeOpts()]); };
/** Build the bundle for S.fit, update the tables, and mark every chart out of date (the visible tab is rebuilt at once, the others when opened). */
function renderFit(pre, job) {
  const fit = S.fit; if (!fit) return;
  const R = S.bundle = computeBundle(fit, S.manual ? null : S.rep, pre);
  if (job) { const sig = extrasSig(); R.extrasPending = true; R.extrasReady = job.extras.then(ex => { if (S.bundle === R) R.setExtras(ex, sig); R.extrasPending = false; }, () => { R.extrasPending = false; }); }
  renderTables(R); C.buildAll(R); updatePhasePanel(); emit('result', R);
  X.setContext({ fit, rep: R.rep, dm: R.dm, diag: R.diag, events: R.events, phases: R.phases, bundle: R, label: S.label + (S.manual ? '_manual' : '') });
}
function renderTables(R) {
  const { fit, rep, dm, diag } = R, p = fit.params, f4 = x => isFinite(x) ? Number(x).toPrecision(5) : '—';
  $('param-tbody').innerHTML = X.paramRows(fit, rep).map(r => `<tr><td class="pn">${r.n}</td><td class="pg"><span class="gtag ${r.gc}">${r.group}</span></td><td class="pv">${f4(r.est)}</td><td class="pse">${isFinite(r.se) ? Number(r.se).toPrecision(3) : '—'}</td><td class="pci">${isFinite(r.lo) ? '[' + Number(r.lo).toPrecision(4) + ', ' + Number(r.hi).toPrecision(4) + ']' : '—'}</td><td class="pi">${r.interp}</td><td class="ps">${r.status}</td></tr>`).join('');
  $('se-note').textContent = S.manual ? 'Manual parameter values: standard errors are not defined for a manual run.' : rep ? 'SE and 95% intervals: numerical Hessian of the MAP objective with the delta method (as report_model in the R engine). Profiled, fixed and derived parameters have no SE.' : 'Standard errors are switched off (Settings → Analysis).';
  const items = [
    { l: 'Heart rate', v: (p.nu0 * 60).toFixed(1), u: 'bpm', hi: true, t: 'm-hr' }, { l: 'τ Sympathetic', v: (1 / p.ks).toFixed(1), u: 's', t: 'm-ts' }, { l: 'τ Parasympathetic', v: (1 / p.kp).toFixed(2), u: 's', t: 'm-tp' },
    { l: 'κ_P / κ_S', v: (p.kp / p.ks).toFixed(2), u: '×', t: 'm-kpks' }, { l: 'V_P / V_S', v: p.lp.toFixed(3), u: '', t: 'm-hflf' }, { l: 'Λ_R', v: p.lR.toExponential(2), u: '', t: 'm-lr' },
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

/* ---- phase windows drawn on the tachogram -------------------------------------------------------------------------------------------------- */
/** Replace the phases by windows drawn on the tachogram (null = back to typed markers / automatic detection). */
function setPhaseWindows(ws) {
  S.drawn = ws && ws.length ? ws.map(w => ({ kind: w.kind, from: w.from, to: w.to })) : null; S.preview = null; refreshPhases();
}
function previewWindows(ws) { S.preview = ws; }
/** Windows equivalent to what automatic detection finds now (starting point for editing). */
function detectedWindows() { const d = S.rr ? E.detectPhases(S.rr, phaseOptions()) : null; return d ? d.segments.map(s => ({ kind: s.kind, from: s.from, to: s.to })) : null; }
function refreshPhases() {
  if (S.fit && S.bundle) {
    const R = S.bundle, events = effectivePhases(); R.events = events; R.reset(['phaseHRV']); R.phases = events ? E.phaseSummary(S.fit, events, R.dm) : null; R.phaseNote = S.phaseNote;
    X.setContext({ events, phases: R.phases }); C.refreshPhases();
  }
  updatePhasePanel(); if (root.SparkPhaseEditor) { root.SparkPhaseEditor.render(); } emit('phases', S.bundle && S.bundle.events);
}
function updatePhasePanel() {
  const st = $('phase-status'), list = $('phase-list'), ev = S.bundle && S.bundle.events, have = !!S.fit;
  $('btn-phase-edit').disabled = !have;
  if (!S.rr) { st.textContent = 'Load data to detect rest, stress and recovery.'; list.innerHTML = ''; return; }
  if (!have) { st.textContent = S.drawn ? `${S.drawn.length} window${S.drawn.length > 1 ? 's' : ''} drawn earlier for this recording (applied after the run).` : 'Phases are detected automatically when the analysis runs.'; list.innerHTML = ''; return; }
  const src = !ev ? null : { auto: 'Detected automatically', manual: 'From typed markers', drawn: 'Drawn by you' }[ev.source];
  st.textContent = ev ? `${src} · ${ev.segments.length} phase${ev.segments.length > 1 ? 's' : ''}${ev.nStressors ? ' · ' + ev.nStressors + ' stressor' + (ev.nStressors > 1 ? 's' : '') : ''}` : (S.phaseNote ? 'No phase change detected.' : 'No phases.');
  const cols = ev ? C.segColors(ev) : [];
  list.innerHTML = ev ? ev.segments.map((s, i) => `<div class="ph-chip"><i class="dot" style="background:${cols[i]}"></i><span>${s.name}</span><small>${mmss(s.from)}–${mmss(s.to)}</small></div>`).join('') : '';
}
$('btn-phase-edit').onclick = () => { setDrawer(false); showTab('signal'); const card = doc.querySelector('.cc[data-chart="rr"]'); if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' }); setTimeout(() => root.SparkPhaseEditor.open(), 120); };
$('btn-phase-settings').onclick = () => { setDrawer(false); openSettings('phases'); };

/* ---- playground ---------------------------------------------------------------------------------------------------------------------------------- */
const SL = { ks: 'sl-ks', kp: 'sl-kp', lR: 'sl-lr', lp: 'sl-lp' }, LBL = { ks: 'v-ks', kp: 'v-kp', lR: 'v-lr', lp: 'v-lp' };
function sliderValue(el) { const mn = +el.dataset.min, mx = +el.dataset.max, t = +el.value / 1000; return el.dataset.log ? mn * Math.pow(mx / mn, t) : mn + (mx - mn) * t; }
function sliderSet(el, v) { const mn = +el.dataset.min, mx = +el.dataset.max; v = Math.min(mx, Math.max(mn, v)); el.value = Math.round(1000 * (el.dataset.log ? Math.log(v / mn) / Math.log(mx / mn) : (v - mn) / (mx - mn))); }
function updateSimLabels() { $('v-ks').textContent = sliderValue($('sl-ks')).toFixed(4) + ' Hz'; $('v-kp').textContent = sliderValue($('sl-kp')).toFixed(3) + ' Hz'; $('v-lr').textContent = sliderValue($('sl-lr')).toExponential(2); $('v-lp').textContent = sliderValue($('sl-lp')).toFixed(3); }
function syncSliders(a) { Object.keys(SL).forEach(k => sliderSet($(SL[k]), a[k])); updateSimLabels(); }
let _pg = null; Object.values(SL).forEach(id => $(id).addEventListener('input', () => { updateSimLabels(); clearTimeout(_pg); _pg = setTimeout(() => runPlayground(), 140); }));
function renderSim(a, m) {
  const rows = [['κ_S', a.ks, m.ks], ['κ_P', a.kp, m.kp], ['Λ_R', a.lR, m.lR], ['Λ_P', a.lp, m.lp]];
  $('sim-tbody').innerHTML = rows.map(([n, x, y]) => { const d = x > 1e-9 ? 100 * (y - x) / x : NaN, cls = !isFinite(d) ? '' : Math.abs(d) < 5 ? 'dok' : Math.abs(d) < 15 ? 'dpos' : 'dneg'; return `<tr><td>${n}</td><td>${x.toPrecision(4)}</td><td>${y.toPrecision(4)}</td><td class="${cls}">${isFinite(d) ? (d > 0 ? '+' : '') + d.toFixed(1) + '%' : '—'}</td></tr>`; }).join('');
  $('sim-result').style.display = 'block';
}
function runPlayground(exact) {
  if (!S.rr || !S.auto) return;
  const v = exact || { ks: sliderValue($('sl-ks')), kp: sliderValue($('sl-kp')), lR: sliderValue($('sl-lr')), lp: sliderValue($('sl-lp')) };
  if (v.kp <= v.ks) { showAlert('err', 'κ_P must be greater than κ_S for a valid model.'); return; }
  try {
    const base = S.fit.pr, pr2 = Object.assign({}, base, { energy_ratio: v.lp }), fit = E.runManualFit(S.rr, pr2, S.fit.ctl, v);
    S.manual = !exact; S.fit = fit; fit.cleaning = cleaningRecord();
    renderFit(); renderSim(S.auto, v); if (exact) showAlert('ok', 'Reset to the MAP estimate.');
  } catch (e) { showAlert('err', 'Manual filter run failed: ' + e.message); console.error(e); }
}
$('btn-sim').onclick = () => { if (!S.auto) { showAlert('err', 'Run the main analysis first to obtain MAP-estimated defaults.'); return; } syncSliders(S.auto); runPlayground(S.auto); };
$('btn-use-filtered').onclick = () => { if (!S.fit) { showAlert('err', 'Run the analysis first to generate a filtered RR series.'); return; } setData(Array.from(S.fit.irr), 'Filtered RR (re-estimation)', null, true, { noClean: true }); showAlert('ok', 'Filtered RR loaded as new input — click Run Analysis to re-estimate.'); };
$('btn-export-filtered').onclick = () => { if (!S.fit) { showAlert('err', 'Run the analysis first to generate a filtered RR series.'); return; } X.filteredRR($('exp-unit').value, $('exp-fmt').value); };

/* ---- settings, export menu, shortcuts ------------------------------------------------------------------------------------------------------------ */
let menu = null;
function openSettings(sec) { if (menu) menu.open(sec); $('settings-modal').setAttribute('aria-hidden', 'false'); }
$('btn-settings').onclick = () => openSettings(); $('btn-model-settings').onclick = () => { setDrawer(false); openSettings('model'); };
const exMenu = $('export-menu');
$('btn-export').onclick = ev => { ev.stopPropagation(); const show = !exMenu.classList.contains('show'); exMenu.classList.toggle('show', show); $('btn-export').setAttribute('aria-expanded', show ? 'true' : 'false'); };
doc.addEventListener('click', ev => { if (!ev.target.closest('.menu-wrap')) exMenu.classList.remove('show'); });
doc.addEventListener('keydown', ev => {
  if ($('welcome-modal') && $('welcome-modal').classList.contains('show')) return;
  const tag = (ev.target.tagName || '').toLowerCase(); if (['input', 'select', 'textarea'].includes(tag) || ev.metaKey || ev.ctrlKey || ev.altKey) { if (ev.key === 'Escape') ev.target.blur(); return; }
  const k = ev.key.toLowerCase();
  if (k === 'escape') { exMenu.classList.remove('show'); $('settings-modal').classList.remove('show'); setDrawer(false); doc.querySelectorAll('.cc.fullscreen').forEach(c => { c.classList.remove('fullscreen'); C.resizeAll(); }); }
  else if (k === 'r') { if ($('app').dataset.mode !== 'live') run(); } else if (k === 's') { ev.preventDefault(); openSettings(); } else if (k === 'e') { exMenu.classList.toggle('show'); } else if (k === 't') $('theme-btn').click();
  else if (/^[1-6]$/.test(k) && S.fit) showTab(TABS[+k - 1]);
});
let _rz; const nudge = ms => { clearTimeout(_rz); _rz = setTimeout(C.resizeAll, ms); };
root.addEventListener('resize', () => nudge(140)); root.addEventListener('orientationchange', () => nudge(260));

ST.onChange(path => {
  if (path === 'analysis.timeUnit' || path === '*') { syncUnitSelect(); if (S.raw && path === 'analysis.timeUnit') { loadText(S.raw.text, S.raw.name); return; } }
  if (path === '*' || path.startsWith('appearance')) applyAppearance();                         // CSS only: instant
  if (path === '*' || path.startsWith('model')) modelSummary();
  if (path === 'layout' || path === '*') C.applyLayout();
  if (!S.bundle) return;
  const R = S.bundle;
  if (path === '*') { R.reset(['roll', 'land']); refreshPhases(); C.invalidate(); C.ensureTab(); return; }
  if (path.startsWith('appearance') || path.startsWith('charts')) { C.invalidate(); C.ensureTab(); return; }                    // colours, bands, palette: redraw the visible tab, the others when opened
  if (/^analysis\.phase/.test(path)) { refreshPhases(); return; }
  if (path === 'analysis.rollWindow' || path === 'analysis.rollStep') { R.reset(['roll']); C.invalidate(['rolling']); C.ensureTab(); return; }
  if (/^analysis\.(landscapeGrid|landscapeBandwidth|minBasin)$/.test(path)) { R.reset(['land']); C.invalidate(['landscape']); C.ensureTab(); return; }
  if (path === 'analysis.showFlow' || path === 'analysis.showBasins') { C.invalidate(['landscape']); C.ensureTab(); return; }
});

/* ---- start --------------------------------------------------------------------------------------------------------------------------------------------- */
async function init() {
  ST.load(); try { root.localStorage.removeItem('spark.phasewin'); } catch (e) { /* ignore */ } applyAppearance(); syncUnitSelect(); syncCleanControls(); ST.onChange(p => { if (/^analysis\.clean/.test(p) || p === '*' || p === 'analysis') onCleanSettings(); }); await ST.Layout.init(); C.chartDefaults(); C.mountCards(); X.mountMenu(exMenu);
  root.SparkPhaseEditor.init({ getWindows: () => S.preview || S.drawn, setWindows: setPhaseWindows, preview: previewWindows, getDetected: detectedWindows, getPhases: () => S.bundle && S.bundle.events, toast });
  menu = ST.mountMenu($('settings-modal'), { chartList: C.chartList, toast, download: X.download, render: () => {} });
  modelSummary(); updateSimLabels(); (root.requestIdleCallback || (f => setTimeout(f, 600)))(() => C.warmUp());
  if (!root.Chart) showAlert('err', 'Chart.js could not be loaded (offline?). Calculations still work; charts need the library.');
}
const ready = init(); ready.catch(e => console.error(e));
/* ============================================================================================================================
   Public API:  window.SPARK  (documented in README.md, "Scripting API").  SparkApp is kept as an alias of the old, smaller object.
   ========================================================================================================================== */
const phaseView = ev => ev ? { source: ev.source, nStressors: ev.nStressors, segments: ev.segments.map(s => ({ name: s.name, kind: s.kind, from: s.from, to: s.to })), boundaries: ev.boundaries || [] } : null;
root.SPARK = {
  version: '3.11.1',
  /** Pure functions without DOM: fitModel, detectPhases, parseRRDetailed, simulateSession, ... */
  engine: E,
  settings: ST, charts: C, export: X, editor: root.SparkPhaseEditor,
  /** Data: load text (.txt/.csv), load RR in seconds, built-in examples. */
  data: {
    load: (text, name, opts) => { if (opts && opts.unit) ST.set('analysis.timeUnit', opts.unit, true); return loadText(String(text), name || 'data'); },
    loadRR: (rrSeconds, label) => { setData(Array.from(rrSeconds), label || 'data'); return true; },
    example: kind => { if (kind === 'multi') $('btn-example-multi').click(); else $('btn-example').click(); return S.rr ? S.rr.length : 0; },
    get: () => S.rr ? { rr: S.rr.slice(), raw: S.rrRaw ? Array.from(S.rrRaw) : null, label: S.label, read: S.read, duration: dur(), cleaning: S.clean ? { window: S.clean.opts.window, n_mad: S.clean.opts.n_mad, n_iter: S.clean.opts.n_iter, n_replaced: S.clean.n_changed } : null } : null,
    /** Optional RR cleaning (the gate of tools/prep-data.R). setCleaning({ enabled, window, n_mad, n_iter }) changes the settings and derives the series again (results are cleared). */
    setCleaning: o => { o = o || {}; const map = { enabled: 'cleanRR', window: 'cleanWindow', n_mad: 'cleanNMad', n_iter: 'cleanNIter' }; Object.keys(map).forEach(k => { if (k in o) ST.set('analysis.' + map[k], o[k], true); }); onCleanSettings(); return S.clean ? { n_replaced: S.clean.n_changed, window: S.clean.opts.window, n_mad: S.clean.opts.n_mad, n_iter: S.clean.opts.n_iter } : null; }
  },
  /** Run the analysis; resolves with the result bundle {fit, rep, dm, diag, events, phases, ...} (null if it failed). */
  run: () => run(),
  result: () => S.bundle,
  /** Phases: the current ones, automatic detection, windows, typed markers, mode. */
  phases: {
    get: () => phaseView(S.bundle ? S.bundle.events : (S.rr ? effectivePhases() : null)),
    detect: opts => S.rr ? phaseView(E.detectPhases(S.rr, Object.assign(phaseOptions(), opts || {}))) : null,
    summary: () => S.bundle ? S.bundle.phases : null,
    setWindows: ws => { setPhaseWindows(ws); return phaseView(S.bundle && S.bundle.events); },
    clearWindows: () => { setPhaseWindows(null); return phaseView(S.bundle && S.bundle.events); },
    windows: () => S.drawn ? S.drawn.map(w => Object.assign({}, w)) : null,
    setMarkers: str => { ST.set('analysis.phaseMarkers', String(str || '')); return phaseView(S.bundle && S.bundle.events); },
    setMode: mode => { ST.set('analysis.phaseMode', mode === 'off' ? 'off' : 'auto'); return phaseView(S.bundle && S.bundle.events); },
    edit: open => { if (open === false) root.SparkPhaseEditor.close(); else { $('btn-phase-edit').click(); } }
  },
  /** User interface helpers. */
  ui: { showTab, openSettings, toast, setTheme: t => ST.set('appearance.theme', t) },
  /** Events: 'data' (a recording was loaded), 'result' (analysis finished or redrawn), 'phases' (phases changed). */
  on: (ev, fn) => { (_listeners[ev] = _listeners[ev] || []).push(fn); return () => root.SPARK.off(ev, fn); },
  off: (ev, fn) => { _listeners[ev] = (_listeners[ev] || []).filter(f => f !== fn); }
};
root.SparkApp = { toast, state: S, run, ready, showTab, loadText, runPlayground, renderFit, computeBundle, openSettings, setData };
})(typeof window !== 'undefined' ? window : globalThis);

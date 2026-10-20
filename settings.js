/* ============================================================================
   SPARK settings: one object, persisted in localStorage (settings) and IndexedDB (card layout);
   the configuration menu is generated from SCHEMA below, so adding an option is one entry.
   ========================================================================== */
(function (root) {
'use strict';
const E = root.SparkEngine, KEY = 'spark.settings.v3';

const DEFAULTS = {
  live: { smooth: true, displayDelayS: 1, calibrationS: 8, fitWindowMin: 10, refitEveryS: 15, minBeats: 120, chartWindowMin: 5, rrMinMs: 250, rrMaxMs: 2500, gapS: 4, clean: false, autoReconnect: true, keepAwake: true },
  ui: { welcome: true },
  appearance: { theme: 'auto', accent: 'blue', density: 'comfortable', fontScale: 1, reduceMotion: false },
  charts: { colorP: '', colorS: '', lineWidth: 1.6, showCI: true, showGrid: true, maxPoints: 3000, palette: 'inferno', hidden: {} },
  model: { priors: JSON.parse(JSON.stringify(E.DEFAULT_PRIORS)), control: JSON.parse(JSON.stringify(E.DEFAULT_CONTROL)) },
  analysis: { timeUnit: 'auto', autoRun: false, cleanRR: false, cleanWindow: 50, cleanNMad: 3.5, cleanNIter: 2, computeSE: true, phaseMode: 'auto', phaseMarkers: '', phaseSensitivity: 'standard', phaseMinShift: 10, phaseMinZ: 4, phaseMinSegment: 30, phaseMaxStressors: 4, rollWindow: 60, rollStep: 10, landscapeGrid: 80, landscapeBandwidth: 1, showFlow: true, showBasins: true, minBasin: 0.3 },
  export: { scale: 2, background: 'theme', prefix: 'spark', decimal: '.', separator: ',', includeSettings: true }
};
const ACCENTS = { blue: ['#5B9CFF', '#2563EB'], teal: ['#2DD4D4', '#0E9AA7'], violet: ['#A78BFA', '#6D4FD1'], amber: ['#F5B84B', '#C98A12'], green: ['#3DDC97', '#169C62'] };
const PALETTES = ['inferno', 'viridis', 'magma', 'mako'];

const clone = o => JSON.parse(JSON.stringify(o));
function merge(base, extra) { // deep merge that keeps only keys that exist in the defaults (old or foreign files cannot add junk)
  const out = clone(base);                                    // a deep copy: sections missing from a saved file must not share objects with DEFAULTS (a later set() would change the defaults)
  Object.keys(base).forEach(k => {
    if (extra && k in extra) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && k !== 'hidden') out[k] = merge(base[k], extra[k]);
      else if (k === 'hidden') out[k] = Object.assign({}, extra[k]);
      else if (typeof extra[k] === typeof base[k] || Array.isArray(base[k])) out[k] = extra[k];
    }
  });
  return out;
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); let t = o; for (let i = 0; i < ks.length - 1; i++) t = t[ks[i]]; t[ks[ks.length - 1]] = v; }

let state = clone(DEFAULTS); const listeners = [];
const VERSION = 5;
function load() {
  try {
    const raw = root.localStorage && root.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw); state = merge(DEFAULTS, saved);
      // v5: the default vagal floor is now 0.25 (earlier versions: 0.1, then 0.5); a value saved by an earlier version is taken to be the old default, not a choice
      if (!saved._v || saved._v < 5) { const v = state.model.priors.lower_lf_vagal_fraction; if (v === 0.1 || v === 0.5) state.model.priors.lower_lf_vagal_fraction = DEFAULTS.model.priors.lower_lf_vagal_fraction; }
    }
  } catch (e) { state = clone(DEFAULTS); }
  return state;
}
function save() { try { root.localStorage.setItem(KEY, JSON.stringify(Object.assign({ _v: VERSION }, state))); } catch (e) { /* private mode: keep in memory */ } }
function emit(path) { listeners.forEach(f => { try { f(path, state); } catch (e) { console.error(e); } }); }
const S = {
  DEFAULTS, ACCENTS, PALETTES,
  get: p => getPath(state, p), all: () => state,
  set(p, v, silent) { setPath(state, p, v); save(); if (!silent) emit(p); },
  reset(section) { if (section) state[section] = clone(DEFAULTS[section]); else state = clone(DEFAULTS); save(); emit(section || '*'); },
  onChange: f => listeners.push(f), load, save,
  exportJSON: () => JSON.stringify({ spark_settings: 3, settings: state }, null, 2),
  importJSON(text) { const o = JSON.parse(text); if (!o || !o.settings) throw new Error('Not a SPARK settings file.'); state = merge(DEFAULTS, o.settings); save(); emit('*'); },
  /** Validated engine settings: throws a readable error for impossible values. */
  modelSettings() { return { priors: E.sparkPriors(state.model.priors), control: E.sparkControl(state.model.control), rawPriors: state.model.priors, rawControl: state.model.control }; },
  /** Only the settings that differ from the engine defaults (for reports and the R script). */
  modelDiff() {
    const d = { priors: {}, control: {} };
    ['priors', 'control'].forEach(g => Object.keys(DEFAULTS.model[g]).forEach(k => { if (JSON.stringify(state.model[g][k]) !== JSON.stringify(DEFAULTS.model[g][k])) d[g][k] = state.model[g][k]; }));
    return d;
  },
  /** Settings that differ from the R ENGINE's own defaults: what an R script must state explicitly to reproduce the app (the app defaults equal the engine's). */
  modelDiffVsEngine() {
    const rDef = { priors: Object.assign(clone(DEFAULTS.model.priors), E.R_ENGINE_PRIOR_DEFAULTS), control: clone(DEFAULTS.model.control) }, d = { priors: {}, control: {} };
    ['priors', 'control'].forEach(g => Object.keys(rDef[g]).forEach(k => { if (JSON.stringify(state.model[g][k]) !== JSON.stringify(rDef[g][k])) d[g][k] = state.model[g][k]; }));
    return d;
  },
  /** Colour of the vagal-like (P) and sympathetic-like (S) series. */
  colors() { const css = v => root.getComputedStyle(root.document.documentElement).getPropertyValue(v).trim(); return { P: state.charts.colorP || css('--teal') || '#38BCC8', S: state.charts.colorS || css('--red') || '#C44040' }; },
  applyAppearance() {
    const a = state.appearance, doc = root.document.documentElement;
    const light = a.theme === 'light' || (a.theme === 'auto' && root.matchMedia && !root.matchMedia('(prefers-color-scheme: dark)').matches);
    doc.dataset.theme = light ? 'light' : ''; doc.dataset.density = a.density; doc.dataset.motion = a.reduceMotion ? 'off' : 'on';
    doc.style.setProperty('--fscale', a.fontScale);
    const acc = ACCENTS[a.accent] || ACCENTS.blue, c = light ? acc[1] : acc[0];
    doc.style.setProperty('--acc', c);
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    doc.style.setProperty('--acc-d', `rgba(${r},${g},${b},${light ? 0.10 : 0.15})`);
    return light;
  }
};

/* ---- card layout persistence (IndexedDB, falls back to localStorage) ---------------------------------------------- */
const Layout = (function () {
  let db = null, cache = {};
  const hasIDB = typeof root.indexedDB !== 'undefined' && root.indexedDB;
  function open() {
    return new Promise(res => {
      if (!hasIDB) return res(null);
      try {
        const rq = root.indexedDB.open('spark-ui', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  async function init() {
    db = await open();
    if (db) {
      await new Promise(res => { const tx = db.transaction('kv', 'readonly'), rq = tx.objectStore('kv').get('layout'); rq.onsuccess = () => { cache = rq.result || {}; res(); }; rq.onerror = () => res(); });
    } else { try { cache = JSON.parse(root.localStorage.getItem('spark.layout') || '{}'); } catch (e) { cache = {}; } }
    return cache;
  }
  function persist() {
    if (db) { try { db.transaction('kv', 'readwrite').objectStore('kv').put(cache, 'layout'); } catch (e) { /* ignore */ } }
    else { try { root.localStorage.setItem('spark.layout', JSON.stringify(cache)); } catch (e) { /* ignore */ } }
  }
  return { init, get: id => cache[id] || {}, set(id, patch) { cache[id] = Object.assign({}, cache[id], patch); persist(); }, clear() { cache = {}; persist(); }, all: () => cache };
})();

/* ---- configuration menu ------------------------------------------------------------------------------------------------ */
// type: select | number | checkbox | color | pair (interval) ; model.* fields are validated by the engine as you type
const SCHEMA = [
  { id: 'appearance', title: 'Appearance', groups: [{ title: 'Theme', rows: [
    { path: 'appearance.theme', label: 'Colour scheme', type: 'select', options: [['auto', 'Follow system'], ['dark', 'Dark'], ['light', 'Light']] },
    { path: 'appearance.accent', label: 'Accent colour', type: 'accent' },
    { path: 'appearance.density', label: 'Density', type: 'select', options: [['comfortable', 'Comfortable'], ['compact', 'Compact']] },
    { path: 'appearance.fontScale', label: 'Text size', type: 'number', min: 0.8, max: 1.3, step: 0.05, hint: '1 = default' },
    { path: 'appearance.reduceMotion', label: 'Reduce motion', type: 'checkbox', hint: 'Disables transitions and animations' }] },
    { title: 'Start', rows: [{ path: 'ui.welcome', label: 'Show the welcome message when the app starts', type: 'checkbox', hint: 'It can always be reopened with the ? button in the top bar or the ? key.' }] }] },

  { id: 'data', title: 'Data', groups: [
    { title: 'File input', rows: [
      { path: 'analysis.timeUnit', label: 'Time unit of the file', type: 'select', options: [['auto', 'Auto-detect'], ['ms', 'Milliseconds (ms)'], ['s', 'Seconds (s)'], ['min', 'Minutes (min)']], hint: 'RR intervals or beat times in .txt / .csv files. Auto-detect uses a header hint such as “RR (ms)” or the typical value; choose a unit if it cannot tell.' }] },
    { title: 'RR cleaning (optional)', rows: [
      { path: 'analysis.cleanRR', label: 'Clean RR intervals before the analysis', type: 'checkbox', hint: 'The running-median / MAD gate of tools/prep-data.R: a value farther than n × MAD from the running median is replaced by linear interpolation, the gate is applied several times and the number of beats does not change. Off by default; the model also down-weights artifact beats.' },
      { path: 'analysis.cleanWindow', label: 'Window (beats)', type: 'number', min: 3, step: 2, hint: 'Default 50. An even value is raised to the next odd one; it never exceeds the length of the series.' },
      { path: 'analysis.cleanNMad', label: 'MAD multiplier (n × MAD)', type: 'number', min: 0.5, step: 0.5, hint: 'Default 3.5. Smaller values replace more beats (2 changes about 4-7% of artifact-free beats).' },
      { path: 'analysis.cleanNIter', label: 'Passes', type: 'number', min: 1, max: 20, step: 1, hint: 'Default 2.' }] },
    { title: 'Running', rows: [
      { path: 'analysis.autoRun', label: 'Run automatically after loading', type: 'checkbox' }] }] },

  { id: 'phases', title: 'Phases', groups: [
    { title: 'How phases are found', rows: [
      { type: 'note', text: 'Priority: windows drawn on the tachogram, then typed markers, then automatic detection.' },
      { path: 'analysis.phaseMode', label: 'Automatic detection', type: 'select', options: [['auto', 'On (from heart rate)'], ['off', 'Off']], hint: 'Finds rest, any number of stressors and recoveries when no windows or markers are given' },
      { path: 'analysis.phaseSensitivity', label: 'Sensitivity', type: 'select', options: [['conservative', 'Conservative (≥ 12 bpm, z ≥ 5)'], ['standard', 'Standard (≥ 10 bpm, z ≥ 4)'], ['sensitive', 'Sensitive (≥ 8 bpm, z ≥ 4)'], ['custom', 'Custom (values below)']], hint: 'Lower = finds milder stressors but may invent phases in a drifting recording' }] },
    { title: 'Detection limits', collapsed: true, rows: [
      { path: 'analysis.phaseMinShift', label: 'Custom: minimum HR change (bpm)', type: 'number', min: 2, step: 1 },
      { path: 'analysis.phaseMinZ', label: 'Custom: minimum z-score', type: 'number', min: 1, step: 0.5 },
      { path: 'analysis.phaseMinSegment', label: 'Minimum phase length (s)', type: 'number', min: 10, step: 5 },
      { path: 'analysis.phaseMaxStressors', label: 'Maximum number of stressors', type: 'number', min: 1, max: 8, step: 1 }] },
    { title: 'Typed markers', rows: [
      { path: 'analysis.phaseMarkers', label: 'Marker times (s)', type: 'text', hint: 'Optional; replaces automatic detection. Seconds from the first beat, increasing: end of rest, end of stressor 1, start of stressor 2, end of stressor 2 … e.g. 300, 420 or 240, 360, 600, 780. To draw windows instead, use the phase tool on the RR plot.' }] }] },

  { id: 'model', title: 'Model', groups: [
    { title: 'Time-scale priors', rows: [
      { path: 'model.priors.tau_p_bounds', label: 'τ_P interval (s)', type: 'pair', hint: 'Vagal time constant (log-normal, central interval)' },
      { path: 'model.priors.tau_s_bounds', label: 'τ_S interval (s)', type: 'pair', hint: 'Sympathetic time constant' },
      { path: 'model.priors.ci_coverage', label: 'Interval coverage', type: 'number', min: 0.5, max: 0.999, step: 0.005 },
      { path: 'model.priors.jitter_bounds_ms', label: 'RR timing jitter interval (ms)', type: 'pair' },
      { path: 'model.priors.topo_target_ratio', label: 'Topology target κ_P/κ_S', type: 'number', min: 1.1, step: 1 },
      { path: 'model.priors.topo_prior_weight', label: 'Topology prior weight', type: 'number', min: 0.1, step: 1 }] },
    { title: 'Spectral anchor (V_P / V_S)', collapsed: true, rows: [
      { path: 'model.priors.lf_lower_hz', label: 'LF lower (Hz)', type: 'number', min: 0.001, step: 0.01 },
      { path: 'model.priors.crossover_hz', label: 'Crossover (Hz)', type: 'number', min: 0.01, step: 0.01 },
      { path: 'model.priors.lf_upper_hz', label: 'LF upper (Hz)', type: 'number', min: 0.05, step: 0.01 },
      { path: 'model.priors.hf_upper_hz', label: 'HF upper (Hz)', type: 'number', min: 0.1, step: 0.01 },
      { path: 'model.priors.sns_leakage_at_boundary', label: 'Sympathetic leakage at LF upper', type: 'number', min: 0.001, max: 0.499, step: 0.01 },
      { path: 'model.priors.lower_lf_vagal_fraction', label: 'Vagal floor at low frequency', type: 'number', min: 0, max: 0.99, step: 0.05, hint: 'Default 0.25 (the engine default). Share of the vagal weight kept below the crossover.' },
      { path: 'model.priors.cwt_fs', label: 'CWT resampling (Hz)', type: 'number', min: 1, step: 1 }] },
    { title: 'Artifact gate and optimizer', collapsed: true, rows: [
      { path: 'model.control.jump_threshold', label: 'Jump threshold θ', type: 'number', min: 0.02, step: 0.01, hint: 'Relative RR jump that starts inflating the jitter variance' },
      { path: 'model.control.jump_power', label: 'Jump power p', type: 'number', min: 1, step: 1 },
      { path: 'model.control.lik_gate_max', label: 'Exclude beats above multiplier', type: 'number', min: 1, step: 10 },
      { path: 'model.control.diag_gate_max', label: 'Diagnostics: keep beats below', type: 'number', min: 1, step: 0.1 },
      { path: 'model.control.pacf_lag_max', label: 'PACF lags', type: 'number', min: 5, max: 100, step: 5 },
      { path: 'model.control.maxit', label: 'Max BFGS iterations', type: 'number', min: 10, step: 100 },
      { path: 'model.control.lR_start', label: 'Λ_R start value', type: 'number', min: 0.000001, step: 0.001 }] },
    { title: 'Presets', rows: [{ type: 'presets' }] }] },

  { id: 'analysis', title: 'Analysis', groups: [
    { title: 'Statistics', rows: [
      { path: 'analysis.computeSE', label: 'Standard errors and Laplace posterior', type: 'checkbox', hint: 'Numerical Hessian: a little extra time' },
      { path: 'analysis.rollWindow', label: 'Rolling window (s)', type: 'number', min: 20, step: 10 },
      { path: 'analysis.rollStep', label: 'Rolling step (s)', type: 'number', min: 2, step: 2 }] },
    { title: 'State-space landscape', rows: [
      { path: 'analysis.landscapeGrid', label: 'Grid resolution', type: 'number', min: 30, max: 160, step: 10 },
      { path: 'analysis.landscapeBandwidth', label: 'Smoothing (× Silverman)', type: 'number', min: 0.3, max: 3, step: 0.1 },
      { path: 'analysis.minBasin', label: 'Basin threshold (share of peak)', type: 'number', min: 0.05, max: 0.9, step: 0.05 },
      { path: 'analysis.showFlow', label: 'Show mean-flow arrows', type: 'checkbox' },
      { path: 'analysis.showBasins', label: 'Mark basins', type: 'checkbox' }] }] },

  { id: 'live', title: 'Live', groups: [
    { title: 'Reconstruction on the go', rows: [
      { path: 'live.fitWindowMin', label: 'Window for the fit and the filter (min)', type: 'number', min: 0, step: 1, hint: 'The latest minutes of the current segment are used. 0 = everything since the start. Longer windows give steadier parameters; the model needs a few minutes to settle (about 5).' },
      { path: 'live.refitEveryS', label: 'Re-estimate the parameters every (s of recording)', type: 'number', min: 5, step: 5, hint: 'The states are updated at every beat with the latest parameters; the fit itself takes about 0.1 s and runs in the background.' },
      { path: 'live.minBeats', label: 'Beats before the first fit', type: 'number', min: 40, step: 10, hint: 'Until then only the RR intervals are shown.' },
      { path: 'live.chartWindowMin', label: 'Time shown in the charts (min)', type: 'number', min: 1, step: 1 },
      { path: 'live.smooth', label: 'Smooth, continuous plot updating', type: 'checkbox', hint: 'The plots scroll continuously in real time and the curve is interpolated between beats, with a fixed display delay (below), instead of jumping at every beat. Off, or with Appearance → Reduce motion on, they update at each beat.' },
      { path: 'live.displayDelayS', label: 'Display delay for smooth updating (s)', type: 'number', min: 0.3, max: 5, step: 0.1, hint: 'How far behind the newest beat the plots are drawn; about one beat interval (1 s) gives a steady motion. Shorter follows more closely but can stall when beats arrive late.' }] },
    { title: 'Incoming beats', rows: [
      { path: 'live.rrMinMs', label: 'Shortest accepted RR (ms)', type: 'number', min: 150, step: 10, hint: 'Values outside the accepted range are dropped and counted. Jumps and ectopic beats inside the range are handled by the model (artifact multiplier).' },
      { path: 'live.rrMaxMs', label: 'Longest accepted RR (ms)', type: 'number', min: 1000, step: 100 },
      { path: 'live.gapS', label: 'Gap detection (s)', type: 'number', min: 2, step: 1, hint: 'If the clock runs this far ahead of the beats received (beats lost on the radio link) a new segment starts; the reconstruction uses the current segment.' },
      { path: 'live.clean', label: 'Also apply the RR cleaning gate to the window', type: 'checkbox', hint: 'The gate of tools/prep-data.R with the values of Settings → Data → RR cleaning. Near the newest beat the running window is one-sided, so the latest values are the least reliable.' }] },
    { title: 'Sensor', rows: [
      { path: 'live.calibrationS', label: 'Calibration period after connecting (s)', type: 'number', min: 0, max: 120, step: 1, hint: 'RR intervals received during this period are discarded (the electrodes settle and the first beats are unreliable); the recording starts after it, as in the original app. 0 turns it off. It also applies after an automatic reconnection.' },
      { path: 'live.autoReconnect', label: 'Reconnect automatically when the link is lost', type: 'checkbox', hint: 'Up to five attempts; a reconnection starts a new segment.' },
      { path: 'live.keepAwake', label: 'Keep the screen awake while streaming', type: 'checkbox', hint: 'Uses the Screen Wake Lock API where the browser has it.' }] }] },
  { id: 'charts', title: 'Charts', groups: [
    { title: 'Series', rows: [
      { path: 'charts.colorP', label: 'Vagal-like (x_p) colour', type: 'color', hint: 'Empty = theme default' },
      { path: 'charts.colorS', label: 'Sympathetic-like (x_s) colour', type: 'color', hint: 'Empty = theme default' },
      { path: 'charts.lineWidth', label: 'Line width', type: 'number', min: 0.5, max: 4, step: 0.1 },
      { path: 'charts.showCI', label: 'Show 95% credible bands', type: 'checkbox' },
      { path: 'charts.showGrid', label: 'Show grid lines', type: 'checkbox' },
      { path: 'charts.maxPoints', label: 'Max points per line', type: 'number', min: 300, max: 20000, step: 100, hint: 'Longer series are thinned for drawing only; 0 = never thin' },
      { path: 'charts.palette', label: 'Heat-map palette', type: 'select', options: PALETTES.map(p => [p, p]), hint: 'Scalogram and landscape' }] },
    { title: 'Visible charts', rows: [{ type: 'chartlist' }] }] },

  { id: 'export', title: 'Export', groups: [{ title: 'Files and images', rows: [
    { path: 'export.scale', label: 'Image scale', type: 'select', options: [[1, '1× (screen)'], [2, '2×'], [3, '3×'], [4, '4× (print)']], num: true },
    { path: 'export.background', label: 'Image background', type: 'select', options: [['theme', 'Match theme'], ['white', 'White'], ['black', 'Dark']] },
    { path: 'export.prefix', label: 'File name prefix', type: 'text' },
    { path: 'export.separator', label: 'CSV separator', type: 'select', options: [[',', 'Comma ,'], [';', 'Semicolon ;'], ['\t', 'Tab']] },
    { path: 'export.decimal', label: 'Decimal mark', type: 'select', options: [['.', 'Dot .'], [',', 'Comma ,']] },
    { path: 'export.includeSettings', label: 'Include model settings in reports', type: 'checkbox' }] }] },

  { id: 'backup', title: 'Backup & reset', groups: [{ title: 'Settings file', rows: [{ type: 'settingsio' }] }, { title: 'Layout', rows: [{ type: 'layoutreset' }] }] }
];

const PRESETS = {
  'Default settings': () => S.reset('model'),
  'Strict artifact gate (θ = 0.15)': () => { S.reset('model'); S.set('model.control.jump_threshold', 0.15, true); }
};

function el(tag, attrs, kids) {
  const e = root.document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); });
  (kids || []).forEach(c => e.appendChild(typeof c === 'string' ? root.document.createTextNode(c) : c));
  return e;
}

function validateModelField(path, row) {
  if (!path.startsWith('model.')) return true;
  try { S.modelSettings(); return true; } catch (e) { row.title = e.message; return false; }
}

function buildRow(r, ctx) {
  if (r.type === 'note') return el('div', { class: 'set-note', text: r.text });
  if (r.type === 'chartlist') return ctx.chartList();
  if (r.type === 'presets') {
    const box = el('div', { class: 'pair', style: 'display:flex;flex-wrap:wrap;gap:8px' });
    Object.keys(PRESETS).forEach(k => box.appendChild(el('button', { class: 'btn btn-ghost', style: 'width:auto', text: k, onclick: () => { PRESETS[k](); emit('model'); ctx.render(); ctx.toast('Preset applied: ' + k, 'ok'); } })));
    return box;
  }
  if (r.type === 'settingsio') {
    const box = el('div', { class: 'pair', style: 'display:flex;flex-wrap:wrap;gap:8px' });
    box.appendChild(el('button', { class: 'btn btn-ghost', style: 'width:auto', text: 'Export settings (JSON)', onclick: () => ctx.download(S.exportJSON(), 'spark_settings.json', 'application/json') }));
    const f = el('input', { type: 'file', accept: '.json', style: 'display:none', onchange: ev => { const file = ev.target.files[0]; if (!file) return; file.text().then(t => { try { S.importJSON(t); ctx.render(); ctx.toast('Settings imported', 'ok'); } catch (e) { ctx.toast(e.message, 'err'); } }); ev.target.value = ''; } });
    box.appendChild(el('button', { class: 'btn btn-ghost', style: 'width:auto', text: 'Import settings…', onclick: () => f.click() })); box.appendChild(f);
    box.appendChild(el('button', { class: 'btn btn-ghost', style: 'width:auto', text: 'Reset everything', onclick: () => { if (root.confirm('Reset all settings to their defaults?')) { S.reset(); ctx.render(); ctx.toast('All settings reset', 'ok'); } } }));
    return box;
  }
  if (r.type === 'layoutreset') {
    return el('button', { class: 'btn btn-ghost', style: 'width:auto', text: 'Reset chart sizes and widths', onclick: () => { Layout.clear(); emit('layout'); ctx.toast('Chart layout reset', 'ok'); } });
  }
  const v = S.get(r.path);
  const onVal = val => { S.set(r.path, val); };
  if (r.type === 'accent') {
    const w = el('div', { class: 'swatches' });
    Object.keys(ACCENTS).forEach(k => w.appendChild(el('span', { class: 'swatch' + (v === k ? ' on' : ''), style: 'background:' + ACCENTS[k][0], title: k, role: 'button', tabindex: '0', onclick: () => { onVal(k); ctx.render(); } })));
    return w;
  }
  if (r.type === 'checkbox') return el('input', { type: 'checkbox', ...(v ? { checked: '' } : {}), onchange: ev => onVal(ev.target.checked) });
  if (r.type === 'color') {
    const w = el('div', { class: 'pair' });
    const inp = el('input', { type: 'color', value: v || '#888888', oninput: ev => onVal(ev.target.value) });
    w.appendChild(inp); w.appendChild(el('button', { class: 'btn btn-ghost', style: 'width:auto', text: 'Default', onclick: () => { onVal(''); inp.value = '#888888'; } }));
    return w;
  }
  if (r.type === 'select') {
    const s = el('select', { onchange: ev => onVal(r.num ? parseFloat(ev.target.value) : ev.target.value) });
    r.options.forEach(([val, lbl]) => { const o = el('option', { value: String(val), text: lbl }); if (String(v) === String(val)) o.selected = true; s.appendChild(o); });
    return s;
  }
  if (r.type === 'pair') {
    const w = el('div', { class: 'pair' }), row = w;
    [0, 1].forEach(i => w.appendChild(el('input', { type: 'number', step: 'any', value: String(v[i]), oninput: ev => { const arr = S.get(r.path).slice(); arr[i] = parseFloat(ev.target.value); S.set(r.path, arr, true); const ok = validateModelField(r.path, row); Array.from(w.children).forEach(c => c.classList.toggle('bad', !ok)); if (ok) emit(r.path); } })));
    return w;
  }
  if (r.type === 'text') return el('input', { type: 'text', value: v, oninput: ev => onVal(ev.target.value) });
  const inp = el('input', { type: 'number', value: String(v), step: r.step || 'any', ...(r.min != null ? { min: r.min } : {}), ...(r.max != null ? { max: r.max } : {}) });
  inp.addEventListener('input', ev => { const x = parseFloat(ev.target.value); if (!isFinite(x)) return; S.set(r.path, x, true); const ok = validateModelField(r.path, inp); inp.classList.toggle('bad', !ok); if (ok) emit(r.path); else S.save(); });
  return inp;
}

/** Mount the modal. ctx: {chartList(), toast(), download(), render()} supplied by app.js. */
function mountMenu(host, ctxIn) {
  let active = 'appearance', query = '';
  const ctx = Object.assign({}, ctxIn, { render: () => render() });
  const nav = el('div', { class: 'set-nav' }), pane = el('div', { class: 'set-pane' });
  const search = el('input', { type: 'search', class: 'set-search', placeholder: 'Search settings…', 'aria-label': 'Search settings', oninput: ev => { query = ev.target.value.trim().toLowerCase(); render(true); } });
  const rowEl = r => { if (!r.label) return buildRow(r, ctx); const lab = el('label', { text: r.label }); if (r.hint) lab.appendChild(el('small', { text: r.hint })); return el('div', { class: 'set-row' }, [lab, buildRow(r, ctx)]); };
  function groupEl(g, rows, crumb) {
    const body = rows.map(rowEl);
    if (g.collapsed && !query) { const d = el('details', { class: 'set-grp adv' }, [el('summary', { text: g.title + ' · advanced' })].concat(body)); return d; }
    return el('div', { class: 'set-grp' }, [el('h3', { text: crumb ? crumb + ' › ' + g.title : g.title })].concat(body));
  }
  function render(keepFocus) {
    nav.innerHTML = ''; pane.innerHTML = '';
    nav.appendChild(search);
    SCHEMA.forEach(sec => nav.appendChild(el('button', { class: sec.id === active && !query ? 'active' : '', text: sec.title, onclick: () => { active = sec.id; query = ''; search.value = ''; render(); } })));
    if (query) {
      let n = 0;
      SCHEMA.forEach(sec => sec.groups.forEach(g => { const rows = g.rows.filter(r => r.label && ((r.label + ' ' + (r.hint || '') + ' ' + (r.path || '')).toLowerCase().includes(query))); if (rows.length) { n += rows.length; pane.appendChild(groupEl(g, rows, sec.title)); } }));
      if (!n) pane.appendChild(el('div', { class: 'set-note', text: 'No setting matches “' + query + '”.' }));
    } else SCHEMA.find(x => x.id === active).groups.forEach(g => pane.appendChild(groupEl(g, g.rows)));
    if (keepFocus) search.focus();
  }
  const close = () => host.classList.remove('show');
  host.innerHTML = '';
  const head = el('div', { class: 'modal-head' }, [el('h2', { text: 'Settings' }), el('button', { class: 'tool', 'aria-label': 'Close settings', html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', onclick: close })]);
  const foot = el('div', { class: 'modal-foot' }, [el('span', { class: 'grow', text: 'Changes apply immediately and are saved in this browser. Model settings take effect on the next run.' }),
    el('button', { class: 'btn btn-ghost', text: 'Reset this section', onclick: () => { const sec = SCHEMA.find(x => x.id === active), map = { appearance: 'appearance', model: 'model', analysis: 'analysis', charts: 'charts', export: 'export' }; if (map[sec.id] && !query) { S.reset(map[sec.id]); render(); } } }),
    el('button', { class: 'btn btn-primary', text: 'Done', onclick: close })]);
  host.appendChild(el('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' }, [head, el('div', { class: 'modal-body' }, [nav, pane]), foot]));
  host.addEventListener('click', ev => { if (ev.target === host) close(); });
  render();
  return { open: sec => { if (sec) { active = sec; query = ''; search.value = ''; } render(); host.classList.add('show'); }, close, render };
}

root.SparkSettings = Object.assign(S, { Layout, mountMenu, SCHEMA });
})(typeof window !== 'undefined' ? window : globalThis);

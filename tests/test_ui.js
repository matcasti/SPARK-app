// Headless smoke test of the real page (jsdom + @napi-rs/canvas + Chart.js): load, run, playground, settings, exports.
//   cd tests && npm i jsdom@24 chart.js@4.4.1 @napi-rs/canvas   (once)   then   node test_ui.js
const path = require('path'), fs = require('fs'); const base = path.resolve(__dirname, '..');
const nm = fs.existsSync(path.join(__dirname, 'node_modules')) ? path.join(__dirname, 'node_modules') : '/tmp/uitest/node_modules';
const { JSDOM } = require(path.join(nm, 'jsdom')); const { createCanvas, Image } = require(path.join(nm, '@napi-rs/canvas'));
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'ok    ' : 'FAIL  ') + n + (d ? '  [' + d + ']' : '')); };
let html = fs.readFileSync(path.join(base, 'index.html'), 'utf8').replace(/<script[^>]*cdnjs[^>]*><\/script>/, '').replace(/<script src="[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' }), w = dom.window, errors = [], downloads = [];
w.console.error = (...a) => errors.push(a.map(String).join(' ')); 
w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {} }); w.ResizeObserver = class { observe() {} disconnect() {} };
Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return 900; } }); Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get() { return 300; } });
w.HTMLElement.prototype.getBoundingClientRect = function () { return { width: 900, height: 300, top: 0, left: 0, right: 900, bottom: 300, x: 0, y: 0 }; };
w.devicePixelRatio = 1; w.confirm = () => true;
// canvas bridge: DOM canvas -> napi canvas
const HC = w.HTMLCanvasElement.prototype;
['width', 'height'].forEach(k => { const d = Object.getOwnPropertyDescriptor(HC, k); Object.defineProperty(HC, k, { get() { return d.get.call(this); }, set(v) { d.set.call(this, v); if (this._n) this._n[k] = v; }, configurable: true }); });   // a real canvas keeps its context when resized
HC.getContext = function () {
  if (!this._n) { this._n = createCanvas(this.width || 300, this.height || 150); }
  if (!this._ctx) { const dom_ = this, ctx = this._n.getContext('2d');
    this._ctx = new Proxy(ctx, { get(t, p) { if (p === 'canvas') return dom_; if (p === 'drawImage') return (src, ...a) => t.drawImage(src._n || src, ...a); const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; }, set(t, p, v) { t[p] = v; return true; } }); }
  return this._ctx;
};
HC.toBlob = function (cb) { const buf = this._n.toBuffer('image/png'); cb(new w.Blob([buf], { type: 'image/png' })); };
HC.toDataURL = function () { return 'data:image/png;base64,' + this._n.toBuffer('image/png').toString('base64'); };
w.Blob.prototype.arrayBuffer = function () { return new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsArrayBuffer(this); }); };
w.TextEncoder = TextEncoder;
w.URL.createObjectURL = b => { downloads.push({ blob: b }); return 'blob:test/' + downloads.length; }; w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { const last = downloads[downloads.length - 1]; if (last) last.name = this.download; };
const load = f => w.eval(fs.readFileSync(path.join(base, f), 'utf8')); w.eval(fs.readFileSync(path.join(nm, 'chart.js/dist/chart.umd.js'), 'utf8'));
['engine.js', 'compute.js', 'settings.js', 'charts.js', 'export.js', 'editor.js', 'tips.js', 'app.js'].forEach(load);
// the page's stylesheet is not loaded by jsdom: apply its :root tokens inline so charts use the real theme colours
const cssTokens = (() => { const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8'), m = /:root\{([^}]*)\}/.exec(css)[1]; m.split(';').forEach(d => { const i = d.indexOf(':'); if (i > 0 && d.trim().startsWith('--')) w.document.documentElement.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); }); })();
const $ = id => w.document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
const text = async blob => Buffer.from(await blob.arrayBuffer()).toString('utf8');
(async () => {
  await w.SparkApp.ready; const C = w.SparkCharts, C0 = Object.assign({}, C);
  // charts are built lazily (visible tab, after paint); in this DOM test every request is completed at once
  ['buildAll', 'ensureTab', 'refreshPhases'].forEach(n => { const f = C0[n]; C[n] = (...a) => { const r = f(...a); C.flush(); return r; }; });
  const _C_unused = 0, ST = w.SparkSettings, X = w.SparkExport, S = w.SparkApp.state;
  check('boot: cards mounted for every registry entry', w.document.querySelectorAll('.cc').length === C.CARDS.length, C.CARDS.length + ' cards');
  check('boot: export menu and settings modal exist', $('export-menu').children.length > 5 && $('settings-modal').querySelector('.set-nav'));
  $('btn-example').click(); check('example data loaded (5-2-5 simulation) and Run enabled', !$('btn-run').disabled && /Example 5-2-5/.test($('data-chip-text').textContent) && S.truth && S.truth[0] === 300);
  $('btn-run').click(); for (let i = 0; i < 80 && !S.fit; i++) await sleep(100); await sleep(400);
  check('run: fit completed (M3, 3-D)', !!S.fit && S.fit.model === 'M3' && !('gamma' in S.fit.params) && S.fit.opt.par.length === 3, S.fit && ('LL* ' + S.fit.LL_star.toFixed(2)));
  check('run: results visible, 13 parameter rows with SE and CI', $('results-wrap').style.display === 'block' && $('param-tbody').children.length === 13 && /\[/.test($('param-tbody').textContent));
  check('run: 16 metric cards and diagnostics chips', $('metric-grid').children.length === 16 && $('dchips').children.length >= 6);
  const drawn = Object.keys(C.charts), cards = C.CARDS.filter(c => c.kind !== 'html' && c.kind !== 'cwt' && c.kind !== 'landscape').map(c => c.id);
  const missing = cards.filter(id => !drawn.includes(id)); check('charts: every Chart.js card was drawn', !missing.length, missing.join(',') || drawn.length + ' charts');
  check('charts: html cards filled (HRV table, correlation matrix)', /SDNN/.test(w.document.querySelector('[data-chart=hrvtable] .cc-body').textContent) && w.document.querySelectorAll('.corr-cell').length === 9);
  check('charts: landscape and CWT canvases painted', $('chart-landscape').width > 0 && $('chart-cwt').width > 0);
  check('no console errors during render', errors.length === 0, errors.slice(0, 2).join(' | '));
  const bundle = C.bundle(); check('state-space landscape: basins found and flow computed', bundle.land.basins.length >= 1 && bundle.land.flow.length > 0, bundle.land.basins.length + ' basins');
  check('phases: detected automatically (no markers given) and summarised with the expected heart-rate pattern', bundle.events && bundle.events.source === 'auto' && bundle.phases && bundle.phases.length === 3 && bundle.phases[1].hr > bundle.phases[0].hr * 1.5 && bundle.phases[2].hr < bundle.phases[1].hr && bundle.phases[1].shift > 2 && Math.abs(bundle.events.segments[1].from - 300) < 10, bundle.phases && bundle.phases.map(r => r.name + ' ' + r.hr.toFixed(0) + ' bpm').join(', '));
  check('phase table card is filled and shows the detection statistics', /Stressor/.test(w.document.querySelector('[data-chart=phasetable] .cc-body').textContent) && w.document.querySelectorAll('[data-chart=phasetable] tbody tr').length === 3 && /z \d/.test(w.document.querySelector('[data-chart=phasetable] .cc-body').textContent));
  check('the run message lists the detected phases', /phases \(detected\)/.test($('alert-ok').textContent), $('alert-ok').textContent.slice(-90));
  check('phase map draws one dataset per phase', C.charts.phase.data.datasets.length === 3 && C.charts.phase.data.datasets.map(d => d.label).join() === 'Rest,Stressor,Recovery');
  // playground
  const lp0 = S.fit.params.lp; $('sl-lp').value = 700; $('sl-lp').dispatchEvent(new w.Event('input')); await sleep(500);
  check('playground: a manual run with another Lambda_P re-renders (no SE)', S.manual && Math.abs(S.fit.params.lp - lp0) > 1e-3 * lp0 && /not defined/.test($('se-note').textContent) && !w.document.getElementById('sl-gm'));
  $('btn-sim').click(); await sleep(300); check('playground: reset restores the MAP estimate', !S.manual && Math.abs(S.fit.params.lp - lp0) < 1e-6 * (1 + lp0));
  // settings
  // manual markers override detection; invalid markers fall back; 'off' switches it off; multi-stressor example
  ST.set('analysis.phaseMarkers', '200, 500'); await sleep(400); check('settings: typed markers replace automatic detection', C.bundle().events.source === 'manual' && C.bundle().events.segments[1].from === 200 && C.bundle().phases.length === 3);
  ST.set('analysis.phaseMarkers', '500, 200'); await sleep(400); check('settings: invalid markers fall back to automatic detection with a warning', C.bundle().events.source === 'auto' && /not valid/.test($('toasts').textContent));
  ST.set('analysis.phaseMarkers', ''); ST.set('analysis.phaseMode', 'off'); await sleep(400); check('settings: detection off -> no phases and an explanatory note', C.bundle().events === null && /switched off/.test(w.document.querySelector('[data-chart=phasetable] .cc-body').textContent) && C.charts.phase.data.datasets.length === 1);
  ST.set('analysis.phaseMode', 'auto'); await sleep(400); check('settings: switching detection back on restores the phases', C.bundle().events && C.bundle().events.source === 'auto');
  ST.set('analysis.phaseSensitivity', 'custom'); ST.set('analysis.phaseMinShift', 200); await sleep(400); check('settings: custom thresholds are used (impossible threshold -> no phases, with a note)', C.bundle().events === null && /No phase change was detected/.test(w.document.querySelector('[data-chart=phasetable] .cc-body').textContent)); ST.set('analysis.phaseSensitivity', 'standard'); await sleep(300);
  $('btn-example-multi').click(); $('btn-run').click(); S.fit = null; for (let i = 0; i < 80 && !S.fit; i++) await sleep(100); await sleep(600);
  check('multi-stressor example: five phases detected and drawn (bands, phase map, landscape)', C.bundle().events.nStressors === 2 && C.bundle().events.segments.length === 5 && C.charts.phase.data.datasets.length === 5 && C.bundle().phases.length === 5 && w.document.querySelectorAll('[data-chart=phasetable] tbody tr').length === 5, C.bundle().events.segments.map(g => g.name).join(' > '));
  check('multi-stressor example: boundaries within 30 s of the protocol', S.truth.every((t, i) => Math.abs(C.bundle().events.segments[i + 1].from - t) < 30));
  ST.set('appearance.theme', 'light'); check('settings: theme applies and persists', w.document.documentElement.dataset.theme === 'light' && JSON.parse(w.localStorage.getItem('spark.settings.v3')).appearance.theme === 'light');
  ST.set('charts.showCI', false); await sleep(50); check('settings: hiding CI redraws charts without error', errors.length === 0);
  C.setHidden('qq', true); check('settings: a chart can be hidden and is listed in the menu', w.document.querySelector('[data-chart=qq]').classList.contains('is-hidden') && ST.get('charts.hidden').qq);
  C.setHidden('qq', false);
  ST.set('model.priors.tau_p_bounds', [8, 4], true); let bad = false; try { ST.modelSettings(); } catch (e) { bad = true; } check('settings: invalid model values are rejected by the engine', bad); ST.reset('model');
  ST.set('model.control.jump_threshold', 0.15); check('settings: model diff tracks changed values', JSON.stringify(ST.modelDiff()) === '{"priors":{},"control":{"jump_threshold":0.15}}'); ST.reset('model');
  ST.importJSON(ST.exportJSON()); check('settings: export/import round trip', ST.get('appearance.theme') === 'light');
  ST.set('appearance.theme', 'dark'); ST.set('charts.showCI', true);
  // exports
  const last = () => downloads[downloads.length - 1];
  X.parametersCSV(); let t = await text(last().blob); check('export: parameters CSV (header, SE, CI)', /^parameter,group,estimate,se,ci95_low,ci95_high/.test(t) && t.split('\n').length > 15 && /kappa|κ_S/.test(t), last().name);
  X.beatsCSV(); t = await text(last().blob); check('export: per-beat CSV has one row per beat', t.trim().split('\n').length === S.fit.dy.length + 1 && /artifact_multiplier/.test(t.split('\n')[0]) && !/vagal_gain/.test(t.split('\n')[0]));
  X.sessionJSON(); const sess = JSON.parse(await text(last().blob)); check('export: session JSON (settings, parameters, diagnostics, data)', sess.spark_session === 3 && sess.parameters.length === 13 && sess.data.rr_s.length === S.fit.dy.length && sess.diagnostics.n_total === S.fit.dy.length && sess.phases && sess.phases.summary.length === 5 && sess.phases.source === 'auto' && sess.phases.segments.length === 5 && sess.phases.boundaries.length >= 4);
  X.rScript(); const rs = await text(last().blob); check('export: R script calls fit_model with the settings (the app defaults need none)', /fit_model\(rr, priors, control\)/.test(rs) && /source\("model_engine.R"\)/.test(rs) && !/lower_lf_vagal_fraction/.test(rs) && !/gamma/.test(rs));
  fs.writeFileSync('/tmp/spark_repro.R', rs); fs.writeFileSync('/tmp/spark_expected.json', JSON.stringify({ ks: S.fit.params.ks, kp: S.fit.params.kp, LL: S.fit.LL_star, ratio: S.fit.pr.energy_ratio }));
  await X.chartPNG('states'); await sleep(100); const png = Buffer.from(await last().blob.arrayBuffer()); check('export: single chart PNG is a valid PNG with title strip', png.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && png.length > 3000, png.length + ' bytes');
  await X.allPNGZip(); await sleep(500); const zip = Buffer.from(await last().blob.arrayBuffer());
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6])), nFiles = zip.readUInt16LE(eocd + 10); let off = zip.readUInt32LE(eocd + 16), okCrc = true, okPng = true;
  for (let i = 0; i < nFiles; i++) { const nlen = zip.readUInt16LE(off + 28), crc = zip.readUInt32LE(off + 16), size = zip.readUInt32LE(off + 20), lho = zip.readUInt32LE(off + 42), name = zip.slice(off + 46, off + 46 + nlen).toString();
    const data = zip.slice(lho + 30 + zip.readUInt16LE(lho + 26), lho + 30 + zip.readUInt16LE(lho + 26) + size); okCrc = okCrc && (X.crc32(new Uint8Array(data)) === crc); okPng = okPng && data.slice(0, 4).toString('hex') === '89504e47'; if (process.env.DUMP) { fs.mkdirSync('/tmp/ui_png', { recursive: true }); fs.writeFileSync('/tmp/ui_png/' + name, data); } off += 46 + nlen; }
  check('export: ZIP of all charts (valid structure, CRC32, PNG payloads)', nFiles >= 15 && okCrc && okPng, nFiles + ' files');
  await X.reportHTML(); await sleep(300); const rep = await text(last().blob); check('export: self-contained HTML report with embedded charts, phases and tables', /<img src="data:image\/png;base64,/.test(rep) && /Parameters/.test(rep) && /<h2>Phases<\/h2>/.test(rep) && /Stressor 2/.test(rep) && /HRV statistics/.test(rep), (rep.length / 1024).toFixed(0) + ' kB');
  // ---- data input: formats, units, user choice, re-reading, migration of the vagal-floor default
  const rrx = w.SparkEngine.genExampleSession().rr.slice(0, 240), lines = f => rrx.map(f).join('\n'), App = w.SparkApp;
  ST.set('analysis.timeUnit', 'auto');
  App.loadText(lines(v => (v * 1000).toFixed(0)), 'rr_ms.txt'); check('txt in milliseconds: auto-detected and announced', S.read.unit === 'ms' && /milliseconds/.test($('alert-ok').textContent) && /ms \(auto\)/.test($('data-chip-text').textContent) && /ms/.test($('unit-detected').textContent) && S.rr.length === 240 && Math.abs(S.rr[5] - rrx[5]) < 6e-4);
  App.loadText(lines(v => (v / 60).toFixed(6)), 'rr_min.txt'); check('txt in minutes: auto-detected', S.read.unit === 'min' && Math.abs(S.rr[5] - rrx[5]) < 6e-4);
  App.loadText('time;RR (s)\n' + rrx.map((v, i) => `${i};${v.toFixed(4).replace('.', ',')}`).join('\n'), 'rr.csv'); check('csv with semicolons, decimal commas and a unit hint in the header', S.read.unit === 's' && S.read.unitSource === 'header' && S.read.decimalComma && Math.abs(S.rr[5] - rrx[5]) < 6e-4 && /from the column header/.test($('alert-ok').textContent));
  App.loadText(lines(v => (v * 1000).toFixed(0)), 'rr_ms.txt');
  $('time-unit').value = 's'; $('time-unit').dispatchEvent(new w.Event('change')); await sleep(100);
  check('choosing a wrong unit re-reads the same file and explains the problem (previous data kept)', ST.get('analysis.timeUnit') === 's' && /Check the selected time unit/.test($('alert-err').textContent) && S.rr.length === 240 && $('unit-detected').textContent === '—');
  $('time-unit').value = 'ms'; $('time-unit').dispatchEvent(new w.Event('change')); await sleep(100);
  check('choosing the right unit re-reads the file without uploading it again', S.read.unit === 'ms' && S.read.unitSource === 'user' && /chosen by you/.test($('alert-ok').textContent) && /set/.test($('unit-detected').textContent));
  ST.set('analysis.timeUnit', 'auto'); await sleep(100); check('back to auto-detect', S.read.unitSource === 'auto' && $('time-unit').value === 'auto');
  const run1 = new Promise(r => setTimeout(r, 0)); $('btn-run').click(); S.fit = null; for (let i = 0; i < 80 && !S.fit; i++) await sleep(100); await sleep(300); check('an uploaded millisecond file runs through the whole analysis', !!S.fit && S.fit.dy.length === 240 && S.fit.params.nu0 > 0.5);
  X.filteredRR('min', 'txt'); const mtxt = await text(last().blob); check('filtered RR can be exported in minutes', Math.abs(parseFloat(mtxt.split('\n')[5]) - S.fit.irr[5] / 60) < 1e-6 && /filtered_rr_min/.test(last().name));
  ST.set('analysis.timeUnit', 'auto');
  // vagal floor: default 0.25 (the engine default), not a change from the defaults nor from the engine; values saved by earlier versions (0.1, 0.5) are the old defaults and are migrated
  check('vagal-floor default is 0.25, no change from the app or the engine defaults', ST.get('model.priors.lower_lf_vagal_fraction') === 0.25 && JSON.stringify(ST.modelDiff()) === '{"priors":{},"control":{}}' && JSON.stringify(ST.modelDiffVsEngine()) === '{"priors":{},"control":{}}');
  w.localStorage.setItem('spark.settings.v3', JSON.stringify({ model: { priors: { lower_lf_vagal_fraction: 0.1 } } })); ST.load(); check('settings saved by an earlier version with 0.1 are migrated to the new default', ST.get('model.priors.lower_lf_vagal_fraction') === 0.25);
  w.localStorage.setItem('spark.settings.v3', JSON.stringify({ _v: 4, model: { priors: { lower_lf_vagal_fraction: 0.5 } } })); ST.load(); check('settings saved by version 4 with its default 0.5 are migrated to the new default', ST.get('model.priors.lower_lf_vagal_fraction') === 0.25);
  w.localStorage.setItem('spark.settings.v3', JSON.stringify({ _v: 5, model: { priors: { lower_lf_vagal_fraction: 0.5 } } })); ST.load(); check('a 0.5 chosen under the current version is respected', ST.get('model.priors.lower_lf_vagal_fraction') === 0.5 && JSON.stringify(ST.modelDiffVsEngine()) === '{"priors":{"lower_lf_vagal_fraction":0.5},"control":{}}'); ST.reset('model');
  check('default vagal floor 0.25 shows in the settings menu', ST.SCHEMA.some(sec => sec.groups.some(g => g.rows.some(r => r.path === 'model.priors.lower_lf_vagal_fraction' && /Default 0\.25/.test(r.hint)))));
  check('no vagal-gate or gamma settings remain', !JSON.stringify(ST.SCHEMA).match(/gamma|Lomax|tau_g|zmax|gate_off/));
  // ---- organisation: settings sections, advanced groups, search; export menu groups; public API
  const secs = ST.SCHEMA.map(x => x.id).join(); check('settings sections are organised: appearance, data, phases, model, analysis, charts, export, backup', secs === 'appearance,data,phases,model,analysis,charts,export,backup', secs);
  check('phase settings live in their own section; advanced model groups are collapsed by default', ST.SCHEMA.find(x => x.id === 'phases').groups.some(g => g.rows.some(r => r.path === 'analysis.phaseMode')) && ST.SCHEMA.find(x => x.id === 'model').groups.filter(g => g.collapsed).length === 2);
  App.openSettings('model'); await sleep(100); check('model section shows 2 collapsed "advanced" groups', w.document.querySelectorAll('#settings-modal details.set-grp.adv').length === 2 && w.document.querySelectorAll('#settings-modal .set-grp:not(.adv)').length >= 2);
  const sInp = w.document.querySelector('#settings-modal .set-search'); sInp.value = 'vagal floor'; sInp.dispatchEvent(new w.Event('input')); await sleep(50);
  check('settings search finds a setting across sections and shows where it lives', w.document.querySelectorAll('#settings-modal .set-row').length === 1 && /Spectral anchor/.test(w.document.querySelector('#settings-modal .set-grp h3').textContent) && /Model/.test(w.document.querySelector('#settings-modal .set-grp h3').textContent));
  sInp.value = 'zzzz'; sInp.dispatchEvent(new w.Event('input')); await sleep(50); check('settings search with no match says so', /No setting matches/.test(w.document.querySelector('#settings-modal .set-pane').textContent));
  sInp.value = ''; sInp.dispatchEvent(new w.Event('input')); w.document.querySelector('#settings-modal .modal-foot .btn-primary').click();
  const menuText = $('export-menu').textContent; check('export menu is grouped: Charts / Tables and data / Reports and reproducibility', ['Charts', 'Tables and data', 'Reports and reproducibility'].every(t => menuText.includes(t)) && /Phases and their summary/.test(menuText));
  $('btn-example').click(); $('btn-run').click(); S.fit = null; for (let i = 0; i < 80 && !S.fit; i++) await sleep(100); await sleep(500);
  X.phasesCSV(); const pc = await text(last().blob); check('phases CSV: one row per phase with times, HR, drives and the detection statistics', /^phase,kind,source,from_s,to_s,duration_s,hr_bpm/.test(pc) && pc.trim().split('\n').length >= 2 && /auto/.test(pc), pc.split('\n')[1]);
  const SP = w.SPARK; check('SPARK API: documented namespaces and a version', ['version', 'engine', 'settings', 'charts', 'export', 'editor', 'data', 'run', 'result', 'phases', 'ui', 'on', 'off'].every(k => k in SP) && /^\d+\.\d+\.\d+$/.test(SP.version));
  SP.data.loadRR(Array.from(w.SparkEngine.genExampleSession().rr), 'api data'); const resBundle = await SP.run(); check('SPARK.run() resolves with the result bundle (fit, phases, ...)', resBundle && resBundle.fit && resBundle.events && SP.result() === resBundle);
  const evs = []; const unsub = SP.on('phases', e => evs.push(e && e.source)); SP.phases.setWindows([{ kind: 'rest', from: 0, to: 250 }, { kind: 'stressor', from: 250, to: 400 }]); await sleep(150); const pv = SP.phases.get(); SP.phases.clearWindows(); unsub();
  check('SPARK.phases: setWindows -> drawn phases, summary, events; clearWindows -> automatic again', pv.source === 'drawn' && pv.segments.length === 2 && evs.join() === 'drawn,auto' && SP.phases.get().source === 'auto' && Array.isArray(SP.phases.summary()));
  check('SPARK.phases.detect() runs the detection with the current options without changing the state', SP.phases.detect().nStressors === 1 && SP.phases.get().source === 'auto');
  // ---- v3.6: preset removed, new dataset clears windows, square cards, rows filled
  App.openSettings('model'); await sleep(100); const presetTxt = w.document.querySelector('#settings-modal .set-pane').textContent; check('the "R engine defaults (vagal floor 0.1)" preset is gone; "Default settings" remains', !/R engine defaults/.test(presetTxt) && /Default settings/.test(presetTxt));
  w.document.querySelector('#settings-modal .modal-foot .btn-primary').click();
  SP.data.example('single'); SP.phases.setWindows([{ kind: 'rest', from: 0, to: 250 }]); ST.set('analysis.phaseMarkers', '100, 200', true); SP.data.example('multi');
  check('loading a new dataset clears drawn windows and typed markers', SP.phases.windows() === null && ST.get('analysis.phaseMarkers') === '');
  const phaseBody = w.document.querySelector('[data-chart=phase] .cc-body'), landBody = w.document.querySelector('[data-chart=landscape] .cc-body');
  check('phase map and landscape are square by default', phaseBody.classList.contains('sq') && landBody.classList.contains('sq'));
  ST.Layout.set('phase', { h: 300 }); C.applyLayout(); check('a saved custom height replaces the square default', !phaseBody.classList.contains('sq') && landBody.classList.contains('sq')); ST.Layout.clear(); C.applyLayout(); check('resetting the layout restores the square default', phaseBody.classList.contains('sq'));
  C.setHidden('psd', true); check('hiding one card of a pair makes the other fill the row', w.document.querySelector('[data-chart=poincare]').classList.contains('fill')); C.setHidden('psd', false); check('showing it again restores the pair', !w.document.querySelector('[data-chart=poincare]').classList.contains('fill'));
  C.setHidden('hist', true); C.setHidden('qq', true); C.setHidden('pacf', true); check('three of four cards hidden: the last one fills its row', w.document.querySelector('[data-chart=ks]').classList.contains('fill')); ['hist', 'qq', 'pacf'].forEach(i => C.setHidden(i, false));
  $('btn-run').click(); S.fit = null; for (let i = 0; i < 80 && !S.fit; i++) await sleep(100); await sleep(500);
  check('model tab: parameter correlation and prior/posterior summary form a complete pair', /τ_P/.test(w.document.querySelector('[data-chart=postsummary] .cc-body').textContent) && w.document.querySelectorAll('[data-chart=corrmat] .corr-cell').length === 9 && w.document.querySelectorAll('#grid-model .cc:not(.is-hidden)').length % 2 === 1 /* the summary card is full width */);
  // ---- conventional statistics per window (Statistics tab)
  SP.data.example('single'); $('btn-run').click(); S.fit = null; for (let i = 0; i < 80 && !S.fit; i++) await sleep(100); await sleep(500); C.flush();
  const phBody = w.document.querySelector('[data-chart=phasehrv] .cc-body'); check('Statistics tab: per-window table with observed and filtered rows for the whole recording and each phase', phBody.querySelectorAll('tbody tr').length === 8 && /Whole recording/.test(phBody.textContent) && /Stressor/.test(phBody.textContent) && phBody.querySelectorAll('tr.obs').length === 4 && phBody.querySelectorAll('tr.flt').length === 4);
  const hrCells = Array.from(phBody.querySelectorAll('tr.obs')).map(r => parseFloat(r.children[r.children.length - 8].textContent)); check('the table shows plausible heart rates: stressor well above rest', hrCells.length === 4 && hrCells[2] > hrCells[1] * 1.4, hrCells.join(', '));
  check('the card sits in the Statistics tab, full width, after the pair of whole-recording cards', w.document.querySelector('#grid-stats [data-chart=phasehrv]').dataset.span === '12');
  X.phaseHRVCSV(); const hc = await text(last().blob); check('CSV export of the per-window statistics (observed and filtered rows)', /^window,kind,signal,from_s,to_s,duration_s,beats,mean_hr_bpm/.test(hc) && hc.trim().split('\n').length === 9 && /filtered/.test(hc) && /observed/.test(hc), hc.split('\n').length + ' lines');
  X.sessionJSON(); const sj2 = JSON.parse(await text(last().blob)); check('session JSON carries the per-window statistics', Array.isArray(sj2.hrv.per_window) && sj2.hrv.per_window.length === 4 && sj2.hrv.per_window[1].obs && sj2.hrv.per_window[1].flt);
  SP.phases.setMode('off'); await sleep(150); C.flush(); check('without phases the table shows only the whole recording and says so', w.document.querySelectorAll('[data-chart=phasehrv] tbody tr').length === 2 && /No phases are defined/.test(w.document.querySelector('[data-chart=phasehrv] .cc-body').textContent)); SP.phases.setMode('auto'); await sleep(150);
  check('no console errors overall', errors.length === 0, errors.slice(0, 3).join(' | '));
  // responsiveness hooks exist
  const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8'); check('responsive CSS: drawer, grid and print rules present', /max-width:860px/.test(css) && /@media print/.test(css) && /prefers-reduced-motion/.test(css));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });

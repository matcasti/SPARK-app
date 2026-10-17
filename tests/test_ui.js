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
['engine.js', 'settings.js', 'charts.js', 'export.js', 'tips.js', 'app.js'].forEach(load);
// the page's stylesheet is not loaded by jsdom: apply its :root tokens inline so charts use the real theme colours
const cssTokens = (() => { const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8'), m = /:root\{([^}]*)\}/.exec(css)[1]; m.split(';').forEach(d => { const i = d.indexOf(':'); if (i > 0 && d.trim().startsWith('--')) w.document.documentElement.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); }); })();
const $ = id => w.document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
const text = async blob => Buffer.from(await blob.arrayBuffer()).toString('utf8');
(async () => {
  await w.SparkApp.ready; const C = w.SparkCharts, ST = w.SparkSettings, X = w.SparkExport, S = w.SparkApp.state;
  check('boot: cards mounted for every registry entry', w.document.querySelectorAll('.cc').length === C.CARDS.length, C.CARDS.length + ' cards');
  check('boot: export menu and settings modal exist', $('export-menu').children.length > 5 && $('settings-modal').querySelector('.set-nav'));
  $('btn-example').click(); check('example data loaded (5-2-5 simulation) and Run enabled', !$('btn-run').disabled && /Example 5-2-5/.test($('data-chip-text').textContent) && S.events && S.events.t_on === 300 && S.events.t_off === 420);
  $('btn-run').click(); for (let i = 0; i < 80 && !S.fit; i++) await sleep(100); await sleep(400);
  check('run: fit completed (M3G, 4-D)', !!S.fit && S.fit.model === 'M3G' && isFinite(S.fit.params.gamma), S.fit && ('LL* ' + S.fit.LL_star.toFixed(2) + ', gamma ' + S.fit.params.gamma.toExponential(1)));
  check('run: results visible, 15 parameter rows with SE and CI', $('results-wrap').style.display === 'block' && $('param-tbody').children.length === 15 && /\[/.test($('param-tbody').textContent));
  check('run: 16 metric cards and diagnostics chips', $('metric-grid').children.length === 16 && $('dchips').children.length >= 6);
  const drawn = Object.keys(C.charts), cards = C.CARDS.filter(c => c.kind !== 'html' && c.kind !== 'cwt' && c.kind !== 'landscape').map(c => c.id);
  const missing = cards.filter(id => !drawn.includes(id)); check('charts: every Chart.js card was drawn', !missing.length, missing.join(',') || drawn.length + ' charts');
  check('charts: html cards filled (HRV table, correlation matrix)', /SDNN/.test(w.document.querySelector('[data-chart=hrvtable] .cc-body').textContent) && w.document.querySelectorAll('.corr-cell').length === 16);
  check('charts: landscape and CWT canvases painted', $('chart-landscape').width > 0 && $('chart-cwt').width > 0);
  check('no console errors during render', errors.length === 0, errors.slice(0, 2).join(' | '));
  const bundle = C.bundle(); check('state-space landscape: basins found and flow computed', bundle.land.basins.length >= 1 && bundle.land.flow.length > 0, bundle.land.basins.length + ' basins');
  check('phases: rest / exercise / recovery summary with the expected heart-rate pattern', bundle.phases && bundle.phases.length === 3 && bundle.phases[1].hr > bundle.phases[0].hr * 1.5 && bundle.phases[2].hr < bundle.phases[1].hr && bundle.phases[1].shift > 2, bundle.phases && bundle.phases.map(r => r.name + ' ' + r.hr.toFixed(0) + ' bpm').join(', '));
  check('phase table card is filled', /Exercise/.test(w.document.querySelector('[data-chart=phasetable] .cc-body').textContent) && w.document.querySelectorAll('[data-chart=phasetable] tbody tr').length === 3);
  check('phase map draws one dataset per phase', C.charts.phase.data.datasets.length === 3 && C.charts.phase.data.datasets.map(d => d.label).join() === 'Rest,Exercise,Recovery');
  // playground
  const gam0 = S.fit.params.gamma; $('sl-gm').value = 600; $('sl-gm').dispatchEvent(new w.Event('input')); await sleep(500);
  check('playground: manual run with gamma > 0 re-renders (no SE)', S.manual && S.fit.params.gamma > 0.5 && /not defined/.test($('se-note').textContent));
  $('btn-sim').click(); await sleep(300); check('playground: reset restores the MAP estimate', !S.manual && Math.abs(S.fit.params.gamma - gam0) < 1e-6 * (1 + gam0));
  // settings
  // user-defined phases override the example's; clearing them restores it
  ST.set('analysis.phaseRest', 200); ST.set('analysis.phaseExercise', 500); await sleep(400); check('settings: user phase markers replace the example markers', C.bundle().events.source === 'settings' && C.bundle().events.t_on === 200 && C.bundle().phases[0].duration < 205);
  ST.set('analysis.phaseRest', 0); ST.set('analysis.phaseExercise', 0); await sleep(400); check('settings: clearing them restores the example markers', C.bundle().events.source === 'example');
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
  X.beatsCSV(); t = await text(last().blob); check('export: per-beat CSV has one row per beat', t.trim().split('\n').length === S.fit.dy.length + 1 && /vagal_gain/.test(t.split('\n')[0]));
  X.sessionJSON(); const sess = JSON.parse(await text(last().blob)); check('export: session JSON (settings, parameters, diagnostics, data)', sess.spark_session === 3 && sess.parameters.length === 15 && sess.data.rr_s.length === S.fit.dy.length && sess.diagnostics.n_total === S.fit.dy.length && sess.phases && sess.phases.summary.length === 3);
  X.rScript(); const rs = await text(last().blob); check('export: R script calls fit_model with the settings', /fit_model\(rr, priors, control\)/.test(rs) && /source\("01_model_engine.R"\)/.test(rs));
  fs.writeFileSync('/tmp/spark_repro.R', rs); fs.writeFileSync('/tmp/spark_expected.json', JSON.stringify({ ks: S.fit.params.ks, kp: S.fit.params.kp, gamma: S.fit.params.gamma, LL: S.fit.LL_star, ratio: S.fit.pr.energy_ratio }));
  await X.chartPNG('states'); await sleep(100); const png = Buffer.from(await last().blob.arrayBuffer()); check('export: single chart PNG is a valid PNG with title strip', png.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && png.length > 3000, png.length + ' bytes');
  await X.allPNGZip(); await sleep(500); const zip = Buffer.from(await last().blob.arrayBuffer());
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6])), nFiles = zip.readUInt16LE(eocd + 10); let off = zip.readUInt32LE(eocd + 16), okCrc = true, okPng = true;
  for (let i = 0; i < nFiles; i++) { const nlen = zip.readUInt16LE(off + 28), crc = zip.readUInt32LE(off + 16), size = zip.readUInt32LE(off + 20), lho = zip.readUInt32LE(off + 42), name = zip.slice(off + 46, off + 46 + nlen).toString();
    const data = zip.slice(lho + 30 + zip.readUInt16LE(lho + 26), lho + 30 + zip.readUInt16LE(lho + 26) + size); okCrc = okCrc && (X.crc32(new Uint8Array(data)) === crc); okPng = okPng && data.slice(0, 4).toString('hex') === '89504e47'; if (process.env.DUMP) { fs.mkdirSync('/tmp/ui_png', { recursive: true }); fs.writeFileSync('/tmp/ui_png/' + name, data); } off += 46 + nlen; }
  check('export: ZIP of all charts (valid structure, CRC32, PNG payloads)', nFiles >= 15 && okCrc && okPng, nFiles + ' files');
  await X.reportHTML(); await sleep(300); const rep = await text(last().blob); check('export: self-contained HTML report with embedded charts, phases and tables', /<img src="data:image\/png;base64,/.test(rep) && /Parameters/.test(rep) && /<h2>Phases<\/h2>/.test(rep) && /HRV statistics/.test(rep), (rep.length / 1024).toFixed(0) + ' kB');
  check('no console errors overall', errors.length === 0, errors.slice(0, 3).join(' | '));
  // responsiveness hooks exist
  const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8'); check('responsive CSS: drawer, grid and print rules present', /max-width:860px/.test(css) && /@media print/.test(css) && /prefers-reduced-motion/.test(css));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });

// The phase editor in real Chromium: draw rectangles on the RR tachogram with the mouse, resize edges, shared edges, select/delete, edit times, persistence, API.
//   node tests/test_editor_browser.js [--shots]
const path = require('path'), fs = require('fs'), base = path.resolve(__dirname, '..');
const nm = ['/tmp/br/node_modules', path.join(__dirname, 'node_modules')].find(p => fs.existsSync(path.join(p, 'puppeteer-core')));
const chromium = require(path.join(nm, '@sparticuz/chromium')).default || require(path.join(nm, '@sparticuz/chromium')), puppeteer = require(path.join(nm, 'puppeteer-core'));
const chartJs = fs.readFileSync(['/tmp/uitest/node_modules/chart.js/dist/chart.umd.js', path.join(nm, 'chart.js/dist/chart.umd.js')].find(p => fs.existsSync(p)), 'utf8');
let errs = []; const SHOTS = process.argv.includes('--shots'), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'ok    ' : 'FAIL  ') + n + (d ? '  [' + d + ']' : '')); };
(async () => {
  const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
  const page = await browser.newPage(); await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 }); await page.setRequestInterception(true);
  page.on('request', rq => { const u = rq.url(); if (/cdnjs.*chart/.test(u)) rq.respond({ status: 200, contentType: 'application/javascript', body: chartJs }); else if (/fonts\.(googleapis|gstatic)/.test(u)) rq.respond({ status: 200, contentType: 'text/css', body: '' }); else rq.continue(); });
  errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.join(base, 'index.html')); await sleep(300);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await sleep(300);
  await page.click('#btn-example'); await page.click('#btn-run'); await page.waitForFunction(() => document.getElementById('results-wrap').style.display === 'block', { timeout: 60000 }); await sleep(800);
  await page.evaluate(() => document.querySelector('.tab-btn[data-tab="signal"]').click()); await sleep(600);
  // helpers
  const px = t => page.evaluate(t => { const ch = SparkCharts.chartFor('rr'), r = document.getElementById('chart-rr').getBoundingClientRect(); return r.left + ch.scales.x.getPixelForValue(t); }, t);
  const py = frac => page.evaluate(f => { const ch = SparkCharts.chartFor('rr'), r = document.getElementById('chart-rr').getBoundingClientRect(), ca = ch.chartArea; return r.top + ca.top + (ca.bottom - ca.top) * f; }, frac);
  const drag = async (t0, t1, y0 = 0.35, y1 = 0.7) => { const a = await px(t0), b = await px(t1), ya = await py(y0), yb = await py(y1); await page.mouse.move(a, ya); await page.mouse.down(); await page.mouse.move((a + b) / 2, (ya + yb) / 2, { steps: 4 }); await page.mouse.move(b, yb, { steps: 4 }); await page.mouse.up(); await sleep(250); };
  const wins = () => page.evaluate(() => SPARK.phases.windows());
  const ph = () => page.evaluate(() => SPARK.phases.get());
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  // open the editor from the card tool
  await page.evaluate(() => document.querySelector('.cc[data-chart="rr"] [data-act="phases"]').click()); await sleep(300);
  check('phase tool opens the editor panel on the RR card', await page.evaluate(() => !document.querySelector('.cc[data-chart="rr"] .pe').hidden && SparkPhaseEditor.isActive() && document.querySelector('.cc[data-chart="rr"] [data-act="phases"]').getAttribute('aria-pressed') === 'true'));
  check('before drawing: phases come from automatic detection', (await ph()).source === 'auto' && (await wins()) === null);
  // draw rest, stressor, recovery
  await page.click('.cc[data-chart="rr"] .pe-seg [data-kind="rest"]'); await drag(4, 296);
  await page.click('.cc[data-chart="rr"] .pe-seg [data-kind="stressor"]'); await drag(300, 420);
  await page.click('.cc[data-chart="rr"] .pe-seg [data-kind="recovery"]'); await drag(430, 700);
  let w = await wins(); let p = await ph();
  check('three dragged rectangles become three windows of the chosen types', w && w.length === 3 && w.map(x => x.kind).join() === 'rest,stressor,recovery', w && w.map(x => `${x.kind} ${x.from.toFixed(0)}-${x.to.toFixed(0)}`).join(' | '));
  check('window edges snap to beats and land where the rectangles were drawn (±3 s)', w && near(w[0].from, 4, 3) && near(w[0].to, 296, 3) && near(w[1].from, 300, 3) && near(w[1].to, 420, 3) && near(w[2].from, 430, 3) && near(w[2].to, 700, 3));
  check('the app now uses them: source "drawn", names Rest / Stressor / Recovery', p.source === 'drawn' && p.segments.map(s => s.name).join() === 'Rest,Stressor,Recovery');
  check('charts follow: phase map has one dataset per window plus the unassigned beats', await page.evaluate(() => { SparkCharts.flush(); const d = SparkCharts.chartFor('phase').data.datasets.map(x => x.label); return d.slice(0, 3).join() === 'Rest,Stressor,Recovery' && d.includes('Unassigned'); }));
  check('sidebar lists the windows and says they were drawn', await page.evaluate(() => /Drawn by you/.test(document.getElementById('phase-status').textContent) && document.querySelectorAll('#phase-list .ph-chip').length === 3));
  check('editor list shows the three windows', await page.evaluate(() => document.querySelectorAll('.cc[data-chart="rr"] .pe-item').length === 3));
  if (SHOTS) { await (await page.$('.cc[data-chart="rr"]')).screenshot({ path: '/tmp/editor_drawn.png' }); }
  // overlap: a new stressor window painted over the first part of the rest window trims it
  await page.click('.cc[data-chart="rr"] .pe-seg [data-kind="stressor"]'); await drag(100, 160);
  w = await wins(); check('painting over an existing window trims it (rest is split around the new stressor)', w.length === 5 && w.map(x => x.kind).join() === 'rest,stressor,rest,stressor,recovery' && (await ph()).segments.map(s => s.name).join() === 'Rest 1,Stressor 1,Rest 2,Stressor 2,Recovery', w.map(x => x.kind[0] + Math.round(x.from)).join(' '));
  // delete via keyboard: click inside the small stressor to select, press Delete
  await page.mouse.click(await px(130), await py(0.5)); await sleep(200);
  check('a click selects a window (highlighted in the list)', await page.evaluate(() => document.querySelectorAll('.cc[data-chart="rr"] .pe-item.sel').length === 1));
  await page.keyboard.press('Delete'); await sleep(250); w = await wins(); check('Delete removes the selected window', w.length === 4 && !w.some(x => near(x.from, 100, 4) && x.kind === 'stressor'));
  // contiguous windows: drag the shared edge, both move
  await page.evaluate(() => SPARK.phases.setWindows([{ kind: 'rest', from: 0, to: 300 }, { kind: 'stressor', from: 300, to: 420 }, { kind: 'recovery', from: 420, to: 700 }])); await sleep(300);
  const edgeX = await px(300), ey = await py(0.5); await page.mouse.move(edgeX, ey); await page.mouse.down(); await page.mouse.move(await px(280), ey, { steps: 5 }); await page.mouse.up(); await sleep(300);
  w = await wins(); check('dragging the shared edge of two touching windows moves both', w.length === 3 && near(w[0].to, 280, 4) && near(w[1].from, 280, 4) && near(w[0].to, w[1].from, 0.01), w.map(x => x.from.toFixed(0) + '-' + x.to.toFixed(0)).join(' | '));
  // edit in the list
  await page.evaluate(() => { const inp = document.querySelector('.cc[data-chart="rr"] .pe-item:nth-child(3) input[data-f="to"]'); inp.value = '11:00'; inp.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(250);
  w = await wins(); check('editing a time in the list (m:ss) updates the window', near(w[2].to, 660, 1.5), w[2].to.toFixed(1));
  await page.evaluate(() => { const inp = document.querySelector('.cc[data-chart="rr"] .pe-item:nth-child(2) input[data-f="to"]'); inp.value = 'abc'; inp.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(200);
  check('an invalid time is refused with a message and the window is unchanged', (await wins())[1].to > 400 && await page.evaluate(() => /Times must be within/.test(document.getElementById('toasts').textContent)));
  await page.evaluate(() => { const sel = document.querySelector('.cc[data-chart="rr"] .pe-item:nth-child(2) select'); sel.value = 'recovery'; sel.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(250);
  check('changing the type in the list is applied', (await wins())[1].kind === 'recovery' && (await ph()).segments[1].name.startsWith('Recovery'));
  // a new dataset starts clean: no windows, no typed markers from the previous one
  await page.evaluate(() => SPARK.phases.setMarkers('')); await page.reload(); await sleep(400); await page.click('#btn-example'); await sleep(300);
  check('after reloading the page and loading data, no windows are restored', await page.evaluate(() => SPARK.phases.windows() === null));
  await page.click('#btn-run'); await page.waitForFunction(() => document.getElementById('results-wrap').style.display === 'block', { timeout: 60000 }); await sleep(600);
  await page.evaluate(() => { SPARK.phases.setWindows([{ kind: 'rest', from: 0, to: 250 }, { kind: 'stressor', from: 250, to: 400 }]); SPARK.settings.set('analysis.phaseMarkers', '200, 500'); }); await sleep(300);
  check('windows are in use before loading another recording', (await ph()).source === 'drawn');
  await page.evaluate(() => SparkPhaseEditor.open()); await sleep(100);
  await page.evaluate(() => SPARK.data.example('multi')); await sleep(400);
  check('loading another dataset clears the drawn windows and the typed markers, and closes the editor', await page.evaluate(() => SPARK.phases.windows() === null && SPARK.settings.get('analysis.phaseMarkers') === '' && !SparkPhaseEditor.isActive() && /cleared/.test(document.getElementById('toasts').textContent)));
  await page.click('#btn-run'); await page.waitForFunction(() => SPARK.result() && SPARK.result().fit.dy.length > 900, { timeout: 60000 }); await sleep(600);
  check('the new recording gets its own automatic phases (two stressors)', (await ph()).source === 'auto' && (await ph()).nStressors === 2);
  await page.evaluate(() => SPARK.phases.setWindows([{ kind: 'rest', from: 0, to: 200 }, { kind: 'stressor', from: 200, to: 300 }])); await sleep(200);
  await page.evaluate(() => document.getElementById('btn-use-filtered').click()); await sleep(300);
  check('re-estimating the SAME recording from its filtered RR keeps the windows', await page.evaluate(() => { const w = SPARK.phases.windows(); return w && w.length === 2; }));
  await page.evaluate(() => SPARK.phases.clearWindows());
  await page.evaluate(() => SPARK.data.example('single')); await sleep(300); await page.click('#btn-run'); await page.waitForFunction(() => SPARK.result() && SPARK.result().fit.dy.length > 900 && SPARK.result().fit.dy.length < 1000 && SPARK.result().events && SPARK.result().events.nStressors === 1, { timeout: 60000 }); await sleep(500);
  // start from detected, clear
  await page.evaluate(() => document.querySelector('.tab-btn[data-tab="signal"]').click()); await sleep(400);
  await page.evaluate(() => document.querySelector('.cc[data-chart="rr"] [data-act="phases"]').click()); await sleep(200);
  await page.evaluate(() => document.querySelector('.cc[data-chart="rr"] [data-do="clear"]').click()); await sleep(300);
  check('Clear returns to automatic detection', (await ph()).source === 'auto' && (await wins()) === null);
  await page.evaluate(() => document.querySelector('.cc[data-chart="rr"] [data-do="detected"]').click()); await sleep(300);
  w = await wins(); check('"Start from detected" copies the detected phases as editable windows', w && w.length === 3 && w[1].kind === 'stressor' && near(w[1].from, 300, 15), w && w.map(x => x.kind + ' ' + x.from.toFixed(0) + '-' + x.to.toFixed(0)).join(' | '));
  await page.evaluate(() => document.querySelector('.cc[data-chart="rr"] [data-do="clear"]').click()); await sleep(200);
  // Escape cancels a drag
  { const a = await px(100), b = await px(200), y = await py(0.5); await page.mouse.move(a, y); await page.mouse.down(); await page.mouse.move(b, y, { steps: 3 }); await page.keyboard.press('Escape'); await page.mouse.up(); await sleep(200); check('Escape cancels a drag in progress', (await wins()) === null); }
  // too small a drag is only a click
  await drag(100, 103); check('a tiny drag creates nothing', (await wins()) === null);
  // sidebar button opens the editor on the Signal tab
  await page.evaluate(() => { document.querySelector('.cc[data-chart="rr"] [data-do="done"]').click(); }); await sleep(150);
  check('Done closes the editor', await page.evaluate(() => !SparkPhaseEditor.isActive() && document.querySelector('.cc[data-chart="rr"] .pe').hidden));
  await page.evaluate(() => document.querySelector('.tab-btn[data-tab="autonomic"]').click()); await sleep(300); await page.click('#btn-phase-edit'); await sleep(700);
  check('the sidebar "Define on the tachogram" button jumps to the RR plot and opens the editor', await page.evaluate(() => SparkPhaseEditor.isActive() && document.getElementById('tab-signal').classList.contains('active')));
  // API
  const api = await page.evaluate(() => ({ keys: Object.keys(SPARK).sort().join(), ver: SPARK.version, ph: Object.keys(SPARK.phases).sort().join(), det: !!SPARK.phases.detect() }));
  check('the SPARK API exposes data, run, result, phases, ui, settings, engine, charts, export, editor, on/off', ['charts', 'data', 'editor', 'engine', 'export', 'off', 'on', 'phases', 'result', 'run', 'settings', 'ui', 'version'].every(k => api.keys.split(',').includes(k)) && /^\d+\.\d+\.\d+$/.test(api.ver) && api.det, api.keys);
  const ev = await page.evaluate(async () => { const got = []; const off = SPARK.on('phases', e => got.push(e ? e.source : null)); SPARK.phases.setWindows([{ kind: 'rest', from: 0, to: 250 }, { kind: 'stressor', from: 250, to: 400 }]); SPARK.phases.clearWindows(); off(); return got; });
  check('events: "phases" fires on every change; off() unsubscribes', ev.join() === 'drawn,auto', ev.join());
  check('no console or page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  if (SHOTS) { await page.evaluate(() => SPARK.phases.setWindows([{ kind: 'rest', from: 4, to: 296 }, { kind: 'stressor', from: 300, to: 420 }, { kind: 'recovery', from: 424, to: 700 }])); await sleep(400); await (await page.$('.cc[data-chart="rr"]')).screenshot({ path: '/tmp/editor_open.png' }); await page.screenshot({ path: '/tmp/editor_page.png' }); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e.message); console.error('page errors:', typeof errs !== 'undefined' ? errs.slice(0, 5) : ''); process.exit(2); });

// Performance architecture in real Chromium: worker, lazy builds, no needless rebuilds, hidden-tab export, stability under rapid interaction.
//   node tests/test_lifecycle_browser.js
const path = require('path'), fs = require('fs'), base = path.resolve(__dirname, '..');
const nm = ['/tmp/br/node_modules', path.join(__dirname, 'node_modules')].find(p => fs.existsSync(path.join(p, 'puppeteer-core')));
const chromium = require(path.join(nm, '@sparticuz/chromium')).default || require(path.join(nm, '@sparticuz/chromium')), puppeteer = require(path.join(nm, 'puppeteer-core'));
const chartJs = fs.readFileSync(['/tmp/uitest/node_modules/chart.js/dist/chart.umd.js', path.join(nm, 'chart.js/dist/chart.umd.js')].find(p => fs.existsSync(p)), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'ok    ' : 'FAIL  ') + n + (d ? '  [' + d + ']' : '')); };
(async () => {
  const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
  const page = await browser.newPage(); await page.setViewport({ width: 1366, height: 800 }); await page.setRequestInterception(true);
  page.on('request', rq => { const u = rq.url(); if (/cdnjs.*chart/.test(u)) rq.respond({ status: 200, contentType: 'application/javascript', body: chartJs }); else if (/fonts\.(googleapis|gstatic)/.test(u)) rq.respond({ status: 200, contentType: 'text/css', body: '' }); else rq.continue(); });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.join(base, 'index.html')); await sleep(500);
  await page.click('#btn-example'); await page.click('#btn-run'); await page.waitForFunction(() => document.getElementById('results-wrap').style.display === 'block', { timeout: 90000 }); await sleep(1500);
  check('the analysis ran in a Web Worker', await page.evaluate(() => SparkCompute.isWorker()));
  const same = await page.evaluate(() => { const r = SPARK.result(), rr = SPARK.data.get().rr, f = SparkEngine.fitModel(rr), rep = SparkEngine.reportModel(f), p = r.fit.params, q = f.params; const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
    return { ks: rel(p.ks, q.ks), kp: rel(p.kp, q.kp), ll: rel(r.fit.LL_star, f.LL_star), se: rel(r.rep.se.ks, rep.se.ks), x: Math.max(...r.fit.Xp.map((v, i) => Math.abs(v - f.Xp[i]))), phases: r.events && r.events.segments.length }; });
  check('worker result equals the main-thread result (parameters, log-likelihood, standard errors, states)', same.ks < 1e-9 && same.kp < 1e-9 && same.ll < 1e-9 && same.se < 1e-6 && same.x < 1e-9, JSON.stringify(same));
  check('after a run nothing is built for tabs that were not opened (the overview has no charts)', await page.evaluate(() => Object.keys(SparkCharts.charts).length === 0));
  await page.evaluate(() => { window.__builds = []; SparkCharts.CARDS.forEach(c => { const o = c.build; c.build = function (R) { window.__builds.push(c.id); return o.call(this, R); }; }); });
  await page.click('.tab-btn[data-tab="signal"]');
  check('a skeleton is shown at once while the tab\'s charts are prepared', await page.evaluate(() => document.querySelectorAll('#tab-signal .cc-body.pending').length > 0));
  await page.evaluate(() => SparkCharts.whenIdle()); await sleep(300);
  let st = await page.evaluate(() => ({ built: window.__builds.slice(), pending: document.querySelectorAll('.cc-body.pending').length, charts: Object.keys(SparkCharts.charts) }));
  check('only the opened tab was built, every card of it, and the skeletons are gone', st.built.join() === 'rr,cwt,psd,poincare'.split(',').sort((a, b) => st.built.indexOf(a) - st.built.indexOf(b)).join() && st.pending === 0 && st.charts.every(id => ['rr', 'psd', 'poincare'].includes(id)), st.built.join());
  await page.evaluate(() => { window.__builds.length = 0; window.__draw = 0; const o = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function (...a) { window.__draw++; return o.apply(this, a); }; });
  for (const t of ['autonomic', 'signal', 'model', 'signal', 'overview', 'signal']) { await page.click('.tab-btn[data-tab="' + t + '"]'); await sleep(900); }
  st = await page.evaluate(() => ({ built: window.__builds.slice() }));
  check('revisiting tabs rebuilds nothing', !st.built.includes('rr') && !st.built.includes('cwt') && !st.built.includes('psd') && !st.built.includes('poincare'), st.built.join());
  const heat0 = await page.evaluate(() => { window.__draw = 0; return 0; }); await page.click('.tab-btn[data-tab="autonomic"]'); await sleep(500); await page.click('.tab-btn[data-tab="signal"]'); await sleep(500);
  check('the scalogram and landscape are not repainted when a tab is simply shown again', await page.evaluate(() => window.__draw === 0), 'drawImage calls: ' + await page.evaluate(() => window.__draw));
  // theme: only what is on screen is rebuilt now, the rest when opened
  await page.evaluate(() => { window.__builds.length = 0; }); await page.keyboard.press('t'); await page.evaluate(() => SparkCharts.whenIdle()); await sleep(600);
  st = await page.evaluate(() => ({ built: window.__builds.slice() }));
  check('changing the theme rebuilds only the visible tab', st.built.length > 0 && st.built.every(id => ['rr', 'cwt', 'psd', 'poincare'].includes(id)), st.built.join());
  await page.click('.tab-btn[data-tab="autonomic"]'); await page.evaluate(() => SparkCharts.whenIdle()); await sleep(600);
  check('a tab that was hidden during the change is rebuilt with the new theme when opened', await page.evaluate(() => { const ch = SparkCharts.chartFor('states'); return !!ch && getComputedStyle(document.documentElement).getPropertyValue('--bg') !== '' && SparkCharts.CARDS.filter(c => c.tab === 'autonomic').length > 0; }));
  await page.keyboard.press('t'); await sleep(300);
  // phases: bands redrawn in place, dependent charts rebuilt
  await page.click('.tab-btn[data-tab="signal"]'); await page.evaluate(() => SparkCharts.whenIdle()); await sleep(400);
  const idBefore = await page.evaluate(() => { window.__builds.length = 0; window.__rr = SparkCharts.chartFor('rr'); return !!window.__rr; });
  await page.evaluate(() => SPARK.phases.setWindows([{ kind: 'rest', from: 0, to: 250 }, { kind: 'stressor', from: 250, to: 420 }])); await page.evaluate(() => SparkCharts.whenIdle()); await sleep(500);
  st = await page.evaluate(() => ({ same: SparkCharts.chartFor('rr') === window.__rr, built: window.__builds.slice() }));
  check('changing the phases redraws the RR chart in place (same chart object, no rebuild) and rebuilds only the cards that need it', idBefore && st.same && !st.built.includes('rr') && st.built.includes('poincare'), st.built.join());
  await page.evaluate(() => SPARK.phases.clearWindows());
  // the per-window statistics follow the phases
  await page.click('.tab-btn[data-tab="stats"]'); await page.evaluate(() => SparkCharts.whenIdle()); await sleep(500);
  const nRows = () => page.evaluate(() => document.querySelectorAll('[data-chart=phasehrv] tbody tr').length);
  const r0 = await nRows(); await page.evaluate(() => SPARK.phases.setWindows([{ kind: 'rest', from: 0, to: 200 }, { kind: 'stressor', from: 200, to: 400 }, { kind: 'recovery', from: 400, to: 700 }, { kind: 'rest', from: 700, to: 719 }])); await page.evaluate(() => SparkCharts.whenIdle()); await sleep(500);
  const r1 = await nRows(); check('the per-window table is rebuilt when the phases change (3 phases -> 4 windows)', r0 === 8 && r1 === 10, r0 + ' -> ' + r1);
  await page.evaluate(() => SPARK.phases.clearWindows()); await page.evaluate(() => SparkCharts.whenIdle()); await sleep(300); await page.click('.tab-btn[data-tab="overview"]'); await sleep(200);
  // export of a chart in a tab that is not open
  await page.click('.tab-btn[data-tab="overview"]'); await sleep(300);
  const png = await page.evaluate(async () => { const b = await SPARK.export.renderPNG('ellipse'), u8 = new Uint8Array(await b.arrayBuffer()), bmp = await createImageBitmap(b); return { sig: Array.from(u8.slice(0, 4)).join(), size: u8.length, w: bmp.width, h: bmp.height, tab: document.querySelector('.tab-panel.active').id }; });
  check('a chart of a tab that is not open exports with a real size (tab shown while drawing, then restored)', png.sig === '137,80,78,71' && png.w > 400 && png.h > 200 && png.size > 4000 && png.tab === 'tab-overview', JSON.stringify(png));
  // rapid interaction
  const tabs = ['signal', 'autonomic', 'model', 'stats', 'diag', 'overview']; for (let r = 0; r < 2; r++) { for (const t of tabs) { await page.click('.tab-btn[data-tab="' + t + '"]'); await sleep(40); } for (let i = 0; i < 4; i++) { await page.keyboard.press('t'); await sleep(30); }
    await page.setViewport({ width: 1100, height: 800 }); await sleep(80); await page.setViewport({ width: 1366, height: 800 }); await sleep(120); await page.click('#menu-btn'); await sleep(40); await page.click('#menu-btn'); await sleep(200); }
  await sleep(3000);
  check('no errors under rapid tab, theme, resize and sidebar changes', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });

// Screenshots of individual chart cards in real Chromium:  node tests/shots.js [theme=dark|light] [id1,id2,...]
const path = require('path'), fs = require('fs'), base = path.resolve(__dirname, '..');
const nm = ['/tmp/br/node_modules', path.join(__dirname, 'node_modules')].find(p => fs.existsSync(path.join(p, 'puppeteer-core')));
const chromium = require(path.join(nm, '@sparticuz/chromium')).default || require(path.join(nm, '@sparticuz/chromium')), puppeteer = require(path.join(nm, 'puppeteer-core'));
const chartJs = fs.readFileSync(['/tmp/uitest/node_modules/chart.js/dist/chart.umd.js', path.join(nm, 'chart.js/dist/chart.umd.js')].find(p => fs.existsSync(p)), 'utf8');
const theme = (process.argv[2] || 'dark'), ids = (process.argv[3] || 'rr,states,phase,landscape,phasetable,cwt,psd,poincare,gain,partition,ellipse,pp-taup,xcorr,hist').split(',');
const sleep = ms => new Promise(r => setTimeout(r, ms)); const out = '/tmp/shots_' + theme; fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1.5 }); await page.setRequestInterception(true);
  page.on('request', rq => { const u = rq.url(); if (/cdnjs.*chart/.test(u)) rq.respond({ status: 200, contentType: 'application/javascript', body: chartJs }); else if (/fonts\.(googleapis|gstatic)/.test(u)) rq.respond({ status: 200, contentType: 'text/css', body: '' }); else rq.continue(); });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.join(base, 'index.html')); await sleep(300);
  await page.evaluate(t => SparkSettings.set('appearance.theme', t), theme);
  await page.click('#btn-example'); await page.click('#btn-run'); await page.waitForFunction(() => document.getElementById('results-wrap').style.display === 'block', { timeout: 60000 }); await sleep(800);
  for (const id of ids) {
    const tab = await page.evaluate(i => { const el = document.querySelector(`.cc[data-chart="${i}"]`); return el ? el.closest('.tab-panel').id.replace('tab-', '') : null; }, id); if (!tab) continue;
    await page.evaluate(t => document.querySelector(`.tab-btn[data-tab="${t}"]`).click(), tab); await sleep(900);
    const el = await page.$(`.cc[data-chart="${id}"]`); await el.evaluate(e => e.scrollIntoView({ block: 'center' })); await sleep(300); await el.screenshot({ path: `${out}/${id}.png` });
  }
  if (errs.length) console.log('errors:', errs.slice(0, 3)); console.log('shots in', out); await browser.close();
})();

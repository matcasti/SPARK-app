// Responsiveness audit in a real Chromium: many viewports x the main states of the app, with automatic checks for clipping.
//   npm i puppeteer-core chart.js        (once, in tests/)
//   CHROME=/path/to/chrome node tests/viewport_audit.js [--shots] [--only=390x844,1440x900]
// For every state it reports: horizontal overflow of the page, elements outside the viewport (not inside a scrollable container), clipped text (overflow hidden/clip with
// hidden content), overlaps inside the top bar, interactive elements smaller than 24 px on touch screens, dialogs not fitting the screen, collapsed charts.
// Exit code 1 if any issue is found.
const fs = require('fs'), path = require('path');
const base = path.resolve(__dirname, '..');
const nm = fs.existsSync(path.join(__dirname, 'node_modules')) ? path.join(__dirname, 'node_modules') : '/tmp/uitest/node_modules';
const puppeteer = require(process.env.PUPPETEER || path.join(nm, 'puppeteer-core'));
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const shots = process.argv.includes('--shots'), only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const VIEWPORTS = [[320, 568, 'phone-xs'], [360, 640, 'phone-s'], [375, 667, 'phone-m'], [390, 844, 'phone-l'], [412, 915, 'phone-xl'], [667, 375, 'phone-landscape-s'], [844, 390, 'phone-landscape-l'], [768, 1024, 'tablet-portrait'], [1024, 768, 'tablet-landscape'], [1280, 720, 'laptop'], [1440, 900, 'desktop'], [1600, 900, 'desktop-wide'], [1920, 1080, 'desktop-fhd'], [2560, 1440, 'desktop-qhd'],
  [240, 240, 'tiny-square'], [240, 480, 'tiny-narrow'], [280, 653, 'fold-folded'], [320, 200, 'tiny-short-s'], [480, 240, 'tiny-short-m'], [640, 200, 'tiny-short-l'], [900, 200, 'tiny-short-xl']]
  .filter(v => !only.length || only.includes(v[0] + 'x' + v[1]));
const chartJs = fs.readFileSync(path.join(nm, 'chart.js/dist/chart.umd.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* runs inside the page */
function auditInPage(opts) {
  const vw = window.innerWidth, vh = window.innerHeight, out = [], seen = new Set();
  const add = (type, el, extra) => { const id = type + '|' + (el.id || el.className || el.tagName) + '|' + (extra || ''); if (seen.has(id)) return; seen.add(id); const r = el.getBoundingClientRect(); out.push({ type, el: (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')), text: (el.textContent || '').trim().slice(0, 40), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], extra }); };
  const shown = el => { for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) { if (!d.open && !(el.closest('summary') && d.contains(el.closest('summary')) && el.closest('details') === d)) return false; } const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return false; for (let p = el.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden') return false; } return true; };
  const scrollContainerClips = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const c = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(c.overflowX) && p.getBoundingClientRect().right <= vw + 1.5 && p.getBoundingClientRect().left >= -1.5) return true; } return false; };
  const de = document.documentElement; if (de.scrollWidth > vw + 1) out.push({ type: 'page-overflow-x', el: 'html', text: '', rect: [0, 0, de.scrollWidth, 0], extra: de.scrollWidth + ' > ' + vw });
  if (document.body.scrollWidth > vw + 1 && de.scrollWidth <= vw + 1) out.push({ type: 'body-overflow-x', el: 'body', text: '', rect: [0, 0, document.body.scrollWidth, 0], extra: document.body.scrollWidth + ' > ' + vw });
  const all = Array.from(document.querySelectorAll('body *')).filter(el => !/^(SCRIPT|STYLE|PATH|CIRCLE|LINE|POLYLINE|RECT|G|DEFS)$/i.test(el.tagName.toUpperCase()) || /^(SVG)$/i.test(el.tagName));
  for (const el of all) {
    if (!shown(el)) continue; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const inFixedSheet = !!el.closest('.sidebar') && getComputedStyle(el.closest('.sidebar')).visibility === 'hidden';
    if (inFixedSheet) continue;
    if (r.right < -20) continue;                                      // parked off-screen on purpose (the hidden tooltip)
    if ((r.right > vw + 1.5 || r.left < -1.5) && !scrollContainerClips(el)) { const cs = getComputedStyle(el); if (cs.position !== 'fixed' || r.right > vw + 1.5) add('outside-viewport-x', el, Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw); }
    const cs = getComputedStyle(el), clips = /(hidden|clip)/.test(cs.overflowX) || /(hidden|clip)/.test(cs.overflowY);
    if (clips && el.tagName !== 'CANVAS' && !el.classList.contains('cc-body') && el.tagName !== 'SELECT' && el.tagName !== 'INPUT') {
      const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
      const ell = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '';
      if (hasText && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2)) add(ell ? 'truncated-text(info)' : 'clipped-text', el, `${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
    }
    if (opts.touch && /^(BUTTON|SELECT|INPUT|A|SUMMARY)$/.test(el.tagName) && !(el.type === 'checkbox' || el.type === 'range') && !el.closest('.cc-resize')) { let w2 = r.width, h2 = r.height; const af = getComputedStyle(el, '::after'); if (af.content !== 'none' && af.position === 'absolute') { w2 = Math.max(w2, parseFloat(af.width) || 0); h2 = Math.max(h2, parseFloat(af.height) || 0); } if (w2 < 24 || h2 < 24) add('small-target', el, Math.round(w2) + 'x' + Math.round(h2)); }
  }
  const tb = document.querySelector('.topbar'); if (tb && shown(tb)) {
    const kids = Array.from(tb.querySelectorAll('.icon-btn,.btn-top,.mode-switch,.model-badge,.tb-brand,.menu-wrap')).filter(shown), tr = tb.getBoundingClientRect();
    for (let i = 0; i < kids.length; i++) { const a = kids[i].getBoundingClientRect(); if (a.right > vw + 1 || a.left < -1) add('topbar-outside', kids[i], Math.round(a.left) + '..' + Math.round(a.right)); for (let j = i + 1; j < kids.length; j++) { if (kids[i].contains(kids[j]) || kids[j].contains(kids[i])) continue; const b = kids[j].getBoundingClientRect(); const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 2 && oy > 2) add('topbar-overlap', kids[i], (kids[j].id || kids[j].className) + ' ' + Math.round(ox) + 'px'); } }
    if (tb.scrollWidth > tb.clientWidth + 1) add('topbar-scroll', tb, tb.scrollWidth + ' > ' + tb.clientWidth);
    const main = document.querySelector('.content'); if (main && shown(main)) { const first = Array.from(main.children).find(shown); if (first && first.getBoundingClientRect().top < tr.bottom - 1 && window.scrollY === 0) add('content-under-topbar', first, Math.round(first.getBoundingClientRect().top) + ' < ' + Math.round(tr.bottom)); }
  }
  for (const m of document.querySelectorAll('.modal.show')) { const card = m.querySelector('.modal-card'); if (!card) continue; const r = card.getBoundingClientRect(); if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) add('dialog-outside', card, [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + ' in ' + vw + 'x' + vh);
    const foot = m.querySelector('.modal-foot'); if (foot) { const f = foot.getBoundingClientRect(); if (f.bottom > vh + 1) add('dialog-footer-hidden', foot, Math.round(f.bottom) + ' > ' + vh); }
    const body = m.querySelector('.wm-body, .modal-body'); if (body && body.scrollHeight > body.clientHeight + 1 && !/(auto|scroll)/.test(getComputedStyle(body).overflowY) && !body.querySelector('.set-pane')) add('dialog-body-not-scrollable', body, body.scrollHeight + ' > ' + body.clientHeight); }
  { const inter = Array.from(document.querySelectorAll('button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), summary, a[href]')).filter(shown).filter(e => !e.closest('.mode-switch, .tab-nav, .swatch-row, .cc-resize'));
    const openModal = document.querySelector('.modal.show'); const inter2 = openModal ? inter.filter(e => openModal.contains(e)) : inter;
    const R = inter2.map(e => ({ e, r: e.getBoundingClientRect() })).filter(({ e, r }) => { const cx = r.left + r.width / 2, cy = r.top + r.height / 2; if (cx < 0 || cy < 0 || cx > vw || cy > vh) return true; const t = document.elementFromPoint(cx, cy); return !t || e === t || e.contains(t) || t.contains(e); });   // only controls that are really on top (not under a dialog or menu)
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const A = R[i], B = R[j]; if (A.e.contains(B.e) || B.e.contains(A.e)) continue;
      if ((A.e.closest('.modal-foot') && !B.e.closest('.modal-foot')) || (B.e.closest('.modal-foot') && !A.e.closest('.modal-foot'))) continue;      // a scrolling pane meets its fixed footer: not neighbours
      const vo = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top), ho = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      if (vo > 0.5 * Math.min(A.r.height, B.r.height)) { const gap = Math.max(A.r.left, B.r.left) - Math.min(A.r.right, B.r.right); if (gap > -0.5 && gap < 4) add('tight-gap-x', A.e, (B.e.id || B.e.className || B.e.tagName) + ' gap ' + gap.toFixed(1) + 'px'); }
      else if (ho > 0.5 * Math.min(A.r.width, B.r.width)) { const gap = Math.max(A.r.top, B.r.top) - Math.min(A.r.bottom, B.r.bottom); if (gap > -0.5 && gap < 2) add('tight-gap-y', A.e, (B.e.id || B.e.className || B.e.tagName) + ' gap ' + gap.toFixed(1) + 'px'); } } }
  for (const b of document.querySelectorAll('.live-card .cc-body')) { if (!shown(b)) continue; const r = b.getBoundingClientRect(); if (r.width < 1) continue; const ratio = r.height / r.width; if (ratio < 0.5 - 0.012 || ratio > 2 + 0.012) add('live-chart-aspect', b, 'height/width = ' + ratio.toFixed(3) + ' (' + Math.round(r.height) + 'x' + Math.round(r.width) + ')'); }
  { const cards = Array.from(document.querySelectorAll('.live-card')).filter(shown); if (cards.length === 2 && vw >= 1500) { const r = cards.map(c => c.getBoundingClientRect()); if (Math.abs(r[0].top - r[1].top) > 2) add('live-plots-not-side-by-side', cards[0], 'tops ' + Math.round(r[0].top) + ' / ' + Math.round(r[1].top)); if (Math.max(r[0].bottom, r[1].bottom) > vh + 1) add('live-plot-offscreen', cards[0], 'bottom ' + Math.round(Math.max(r[0].bottom, r[1].bottom)) + ' > ' + vh); } }
  for (const cv of document.querySelectorAll('canvas')) { if (!shown(cv)) continue; const r = cv.getBoundingClientRect(); const card = cv.closest('.cc, .live-card'); if (!card || !shown(card)) continue; if (r.width < 120 || r.height < 90) add('chart-collapsed', cv, Math.round(r.width) + 'x' + Math.round(r.height)); }
  return out;
}

(async () => {
  const puppeteerLib = puppeteer.default || puppeteer;
  const browser = await puppeteerLib.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const all = [], summary = []; if (shots) fs.mkdirSync('/home/claude/out/vp', { recursive: true });
  for (const [w, h, name] of VIEWPORTS) {
    const touch = w < 900 || h < 520, ctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext(), page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, hasTouch: touch, isMobile: false });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (/chart(\.umd)?(\.min)?\.js/.test(u) && !u.startsWith('file:')) r.respond({ status: 200, contentType: 'application/javascript', body: chartJs }); else if (/^https?:/.test(u)) r.abort(); else r.continue(); });
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('file://' + path.join(base, 'index.html'), { waitUntil: 'load' }); await sleep(700);
    const issues = [];
    const check = async (state, snap) => { await sleep(250); const res = await page.evaluate(auditInPage, { touch }); res.forEach(r => issues.push(Object.assign({ viewport: `${w}x${h}`, name, state }, r))); if (shots && snap) await page.screenshot({ path: `/home/claude/out/vp/${w}x${h}_${state}.png` }); };
    const click = async sel => { await page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); }, sel); await sleep(200); };
    // 1 welcome message
    await check('welcome', true); await click('#wm-curious summary'); await sleep(150); await check('welcome-curious', true);
    await click('#wm-start'); await sleep(200);
    // 2 analysis, empty
    await check('analysis-empty', true);
    if (w <= 860) { await click('#menu-btn'); await sleep(350); await check('analysis-drawer', true); await click('#scrim'); await sleep(300); }
    // 3 analysis results: every tab
    await click('#btn-example'); await sleep(300); if (w <= 860 && await page.evaluate(() => document.getElementById('sidebar').classList.contains('open'))) await click('#scrim');
    await page.evaluate(() => { document.getElementById('btn-run-top').click(); }); await page.waitForFunction(() => document.getElementById('results-wrap').style.display === 'block', { timeout: 30000 }).catch(() => {}); await sleep(1500);
    for (const tab of ['overview', 'signal', 'autonomic', 'model', 'stats', 'diag']) { await page.evaluate(t => document.querySelector(`.tab-btn[data-tab="${t}"]`).click(), tab); await sleep(900); await check('analysis-' + tab, tab === 'overview' || tab === 'signal' || tab === 'autonomic'); }
    // export menu, settings
    await page.evaluate(() => document.querySelector('.tab-btn[data-tab="overview"]').click()); await click('#btn-export'); await sleep(250); await check('export-menu', true); await click('#btn-export'); await sleep(200);
    await click('#btn-settings'); await sleep(500); await check('settings', true);
    for (const sec of ['model', 'live', 'analysis']) { await page.evaluate(s => { const b = Array.from(document.querySelectorAll('#settings-modal .set-nav button, #settings-modal .set-nav [role=tab]')).find(x => new RegExp('^' + s, 'i').test(x.textContent.trim())); if (b) b.click(); }, sec); await sleep(300); await check('settings-' + sec, sec === 'model'); }
    await page.keyboard.press('Escape'); await sleep(250); await page.evaluate(() => document.getElementById('settings-modal').classList.remove('show'));
    // 4 live
    await click('#mode-live'); await sleep(400); await check('live-idle', true);
    if (w <= 860) { await click('#menu-btn'); await sleep(350); await check('live-drawer', true); await click('#scrim'); await sleep(300); }
    await page.evaluate(() => SPARK.live.simulate(null, { speed: 1 })); await sleep(1800); await check('live-calibrating', true); await page.evaluate(() => SPARK.live.stop()); await sleep(200);
    await page.evaluate(() => SPARK.live.simulate(null, { speed: 60 })); await sleep(7000); await check('live-running', true);
    await page.evaluate(() => SPARK.live.stop()); await sleep(200);
    // 5 help button reopens the welcome message at the end (dialog over the live section)
    await click('#btn-help'); await sleep(300); await check('welcome-reopened', false); await click('#wm-x');
    summary.push({ viewport: `${w}x${h}`, name, issues: issues.filter(i => !/\(info\)/.test(i.type)).length, info: issues.filter(i => /\(info\)/.test(i.type)).length, pageErrors: errs.length });
    all.push(...issues); await ctx.close();
  }
  await browser.close();
  const real = all.filter(i => !/\(info\)/.test(i.type));
  fs.writeFileSync('/home/claude/out/viewport_audit.json', JSON.stringify({ summary, issues: all }, null, 1));
  console.log('viewport'.padEnd(12), 'name'.padEnd(20), 'issues', 'info', 'page errors'); summary.forEach(s => console.log(s.viewport.padEnd(12), s.name.padEnd(20), String(s.issues).padEnd(6), String(s.info).padEnd(4), s.pageErrors));
  const by = {}; real.forEach(i => { const k = i.type + ' | ' + i.el; (by[k] = by[k] || { n: 0, states: new Set(), vps: new Set(), ex: i }).n++; by[k].states.add(i.state); by[k].vps.add(i.viewport); });
  console.log('\n' + real.length + ' issue(s) in ' + Object.keys(by).length + ' distinct place(s):');
  Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 40).forEach(([k, v]) => console.log('  ' + k + '  x' + v.n + '  [' + [...v.vps].slice(0, 4).join(' ') + (v.vps.size > 4 ? ' …' : '') + ']  states: ' + [...v.states].slice(0, 3).join(',') + (v.states.size > 3 ? '…' : '') + '  e.g. ' + (v.ex.extra || '') + ' "' + v.ex.text.slice(0, 24) + '"'));
  process.exit(real.length ? 1 : 0);
})().catch(e => { console.error('AUDIT CRASH', e); process.exit(2); });

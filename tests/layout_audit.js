// Real-browser layout audit (headless Chromium): renders the app at several viewports and measures what a person would notice:
// horizontal page overflow, collapsed or distorted chart cards, clipped content, non-scrolling containers, sticky bars, modal, menu, fullscreen.
//   node tests/layout_audit.js [--shots] [--only=1366x768,390x844]      needs: npm i puppeteer-core @sparticuz/chromium chart.js
const path = require('path'), fs = require('fs'), base = path.resolve(__dirname, '..');
const nm = ['/tmp/br/node_modules', path.join(__dirname, 'node_modules')].find(p => fs.existsSync(path.join(p, 'puppeteer-core')));
const chromium = require(path.join(nm, '@sparticuz/chromium')).default || require(path.join(nm, '@sparticuz/chromium')), puppeteer = require(path.join(nm, 'puppeteer-core'));
const chartJs = fs.readFileSync(['/tmp/uitest/node_modules/chart.js/dist/chart.umd.js', path.join(nm, 'chart.js/dist/chart.umd.js')].find(p => fs.existsSync(p)), 'utf8');
const SHOTS = process.argv.includes('--shots'), only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const VIEWPORTS = [[1920, 1080, 1, 'desktop-fhd'], [1366, 768, 1, 'laptop'], [1280, 600, 1, 'short-desktop'], [1024, 768, 1, 'tablet-landscape'], [768, 1024, 2, 'tablet-portrait'], [844, 390, 3, 'phone-landscape'], [390, 844, 3, 'phone'], [360, 640, 3, 'small-phone']]
  .filter(v => !only.length || only.includes(v[0] + 'x' + v[1]));
const TABS = ['overview', 'signal', 'autonomic', 'model', 'stats', 'diag'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** runs inside the page */
function measure(tab) {
  const vw = innerWidth, vh = innerHeight, out = { tab, issues: [], stats: {} }, r = el => el.getBoundingClientRect(), vis = el => { const b = r(el); return b.width > 0 && b.height > 0; };
  const add = (kind, what, detail) => out.issues.push({ kind, what, detail });
  const de = document.documentElement;
  out.stats.docScrollW = de.scrollWidth; out.stats.vw = vw; out.stats.docScrollH = de.scrollHeight;
  if (de.scrollWidth > vw + 1) add('page-h-overflow', 'document', `scrollWidth ${de.scrollWidth} > ${vw}`);
  const panel = document.getElementById('tab-' + tab);
  if (!panel || getComputedStyle(panel).display === 'none') { add('tab-not-visible', tab); return out; }
  // cards
  panel.querySelectorAll('.cc').forEach(cc => {
    if (cc.classList.contains('is-hidden')) return; const id = cc.dataset.chart, b = r(cc), body = cc.querySelector('.cc-body'), bb = r(body), cv = cc.querySelector('canvas'), cb = cv ? r(cv) : null;
    if (b.right > vw + 1 || b.left < -1) add('card-outside-viewport', id, `left ${Math.round(b.left)} right ${Math.round(b.right)} vw ${vw}`);
    if (bb.height < 110) add('card-collapsed', id, `body height ${Math.round(bb.height)}`);
    { const hv = parseFloat(getComputedStyle(body).getPropertyValue('--h')) || 260, land = vh <= 520 && vw > vh, exp = Math.min(Math.max(land ? 150 : 180, hv), (land ? 0.78 : 0.82) * vh);
      if (!body.classList.contains('auto') && !cc.classList.contains('fullscreen') && Math.abs(bb.height - exp) > 3) add('card-height-wrong', id, `body ${Math.round(bb.height)} expected ${Math.round(exp)} (--h ${hv}, vh ${vh})`); }
    if (bb.width < 240 && vw >= 360) add('card-narrow', id, `body width ${Math.round(bb.width)}`);
    if (cb && (Math.abs(cb.width - bb.width) > 2 || Math.abs(cb.height - bb.height) > 2)) add('canvas-mismatch', id, `canvas ${Math.round(cb.width)}x${Math.round(cb.height)} vs body ${Math.round(bb.width)}x${Math.round(bb.height)}`);
    if (cv && cv.id !== 'chart-cwt' && cv.id !== 'chart-landscape') { const ratio = (cv.width / (devicePixelRatio || 1)) / (cb.width || 1); if (cb.width && (ratio < 0.9 || ratio > 1.1)) add('canvas-bitmap-stretched', id, `bitmap ${cv.width}x${cv.height} css ${Math.round(cb.width)}x${Math.round(cb.height)} dpr ${devicePixelRatio}`); }
    if (cv && (cv.id === 'chart-cwt' || cv.id === 'chart-landscape')) { const sx = (cv.width / (cb.width || 1)), sy = (cv.height / (cb.height || 1)); if (cb.width && Math.abs(sx - sy) / sx > 0.06) add('canvas-aspect-distorted', id, `bitmap/css x ${sx.toFixed(2)} y ${sy.toFixed(2)}`); }
    // content clipped inside the card
    const hdr = cc.querySelector('.cc-head'); if (hdr && hdr.scrollWidth > hdr.clientWidth + 2) add('card-header-clipped', id, `${hdr.scrollWidth} > ${hdr.clientWidth}`);
    if (body.scrollHeight > body.clientHeight + 4 && body.classList.contains('auto')) add('card-content-clipped', id, `scrollH ${body.scrollHeight} > ${body.clientHeight}`);
  });
  // clipped (hidden overflow) horizontally, not scrollable
  panel.querySelectorAll('*').forEach(el => { const cs = getComputedStyle(el); if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2 && vis(el) && !['CANVAS'].includes(el.tagName) && el.clientWidth > 0) add('clipped-content', (el.className || el.tagName) + ' in ' + (el.parentElement.className || el.parentElement.tagName), `"${el.textContent.trim().slice(0, 30)}" scrollW ${el.scrollWidth} > clientW ${el.clientWidth}`); });
  // overview specifics
  if (tab === 'overview') {
    const pc = panel.querySelector('.pcard'); if (pc) { const t = pc.querySelector('table'), cs = getComputedStyle(pc), scroll = cs.overflowX === 'auto' || cs.overflowX === 'scroll'; if (t.scrollWidth > pc.clientWidth + 2 && !scroll) add('table-clipped-not-scrollable', 'param table', `${t.scrollWidth} > ${pc.clientWidth}`); }
    panel.querySelectorAll('.mc').forEach(m => { if (m.scrollWidth > m.clientWidth + 2) add('metric-card-overflow', m.querySelector('.mc-lbl').textContent.trim(), `${m.scrollWidth} > ${m.clientWidth}`); });
  }
  // scrolling and sticky
  const sb = document.getElementById('sidebar'), nav = document.querySelector('.tab-nav'), top = document.querySelector('.topbar');
  out.stats.sidebar = { overflowY: getComputedStyle(sb).overflowY, scrollH: sb.scrollHeight, clientH: sb.clientHeight, pos: getComputedStyle(sb).position };
  out.stats.topbarH = r(top).height;
  if (r(top).height > 70) add('topbar-too-tall', 'topbar', `${Math.round(r(top).height)}px`);
  out.stats.canScrollPage = de.scrollHeight > vh + 5;
  return out;
}
function sticky() {
  const sb = document.getElementById('sidebar'), nav = document.querySelector('.tab-nav'), res = {}; const y0 = scrollY;
  window.scrollTo(0, Math.min(700, document.documentElement.scrollHeight)); res.scrolledTo = scrollY;
  res.sidebarTop = Math.round(sb.getBoundingClientRect().top); res.sidebarVisible = sb.getBoundingClientRect().bottom > 0 && sb.getBoundingClientRect().top < innerHeight && getComputedStyle(sb).transform === 'none' || innerWidth <= 860;
  res.navTop = Math.round(nav.getBoundingClientRect().top); window.scrollTo(0, y0); return res;
}

(async () => {
  const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
  const report = []; fs.mkdirSync('/tmp/audit_shots', { recursive: true });
  for (const [w, h, dpr, name] of VIEWPORTS) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: w < 800, hasTouch: w < 800 }); await page.setRequestInterception(true);
    page.on('request', rq => { const u = rq.url(); if (/cdnjs.*chart/.test(u)) rq.respond({ status: 200, contentType: 'application/javascript', body: chartJs }); else if (/fonts\.(googleapis|gstatic)/.test(u)) rq.respond({ status: 200, contentType: 'text/css', body: '' }); else rq.continue(); });
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('file://' + path.join(base, 'index.html'), { waitUntil: 'load' }); await sleep(300);
    const rec0 = {}; rec0.closedSidebar = await page.evaluate(() => { const sb = document.getElementById('sidebar'), b = sb.getBoundingClientRect(), cs = getComputedStyle(sb); return { visibility: cs.visibility, left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) }; });
    if (w <= 860) { await page.click('#menu-btn'); await sleep(350); }
    await page.click('#btn-example'); if (w <= 860) { /* drawer still open */ } await page.click('#btn-run'); await page.waitForFunction(() => document.getElementById('results-wrap').style.display === 'block', { timeout: 60000 }); await sleep(900);
    const rec = { name, w, h, dpr, errors: errs, tabs: [], extras: { closedSidebar: rec0.closedSidebar } };
    for (const tab of TABS) {
      await page.evaluate(t => document.querySelector(`.tab-btn[data-tab="${t}"]`).click(), tab); await sleep(600);
      const m = await page.evaluate(measure, tab); rec.tabs.push(m);
      if (tab === 'overview') rec.extras.sticky = await page.evaluate(sticky);
      if (SHOTS) await page.screenshot({ path: `/tmp/audit_shots/${name}_${tab}.png`, fullPage: false });
    }
    if (w > 860) { const before = await page.evaluate(() => Math.round(document.getElementById('content').getBoundingClientRect().width)); await page.click('#menu-btn'); await sleep(400);
      rec.extras.collapse = await page.evaluate(b => ({ before: b, after: Math.round(document.getElementById('content').getBoundingClientRect().width), sidebarShown: getComputedStyle(document.getElementById('sidebar')).display !== 'none' }), before); await page.click('#menu-btn'); await sleep(300); }
    // modal, menu, fullscreen, drawer
    await page.evaluate(() => document.querySelector('.tab-btn[data-tab="signal"]').click()); await sleep(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.getElementById('btn-settings').click()); await sleep(400);
    rec.extras.modal = await page.evaluate(() => { const card = document.querySelector('.modal-card'), pane = document.querySelector('.set-pane'), foot = document.querySelector('.modal-foot'), cr = card.getBoundingClientRect(), fr = foot.getBoundingClientRect(), cs = getComputedStyle(pane); return { cardTop: Math.round(cr.top), cardBottom: Math.round(cr.bottom), vh: innerHeight, footVisible: fr.bottom <= innerHeight + 1 && fr.top >= 0, paneOverflowY: cs.overflowY, paneScrollable: pane.scrollHeight > pane.clientHeight + 2, paneClientH: pane.clientHeight, navVisible: document.querySelector('.set-nav').getBoundingClientRect().height > 20, cardRight: Math.round(cr.right), vw: innerWidth }; });
    if (SHOTS) await page.screenshot({ path: `/tmp/audit_shots/${name}_modal.png` });
    await page.evaluate(() => document.querySelector('.modal-foot .btn-primary').click()); await sleep(200);
    await page.evaluate(() => document.getElementById('btn-export').click()); await sleep(250);
    rec.extras.menu = await page.evaluate(() => { const m = document.getElementById('export-menu'), b = m.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + Math.min(40, b.height / 2), hit = document.elementFromPoint(cx, cy); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), vw: innerWidth, vh: innerHeight, onTop: !!hit && m.contains(hit), inside: b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight }; });
    if (SHOTS) await page.screenshot({ path: `/tmp/audit_shots/${name}_menu.png` });
    await page.evaluate(() => document.getElementById('btn-export').click()); await sleep(100);
    rec.extras.fullscreen = await page.evaluate(async () => { const cc = document.querySelector('.cc[data-chart="rr"]'); cc.querySelector('[data-act="full"]').click(); await new Promise(r => setTimeout(r, 450)); const b = cc.getBoundingClientRect(), body = cc.querySelector('.cc-body').getBoundingClientRect(), cv = cc.querySelector('canvas').getBoundingClientRect(); const o = { cardW: Math.round(b.width), cardH: Math.round(b.height), bodyH: Math.round(body.height), canvasH: Math.round(cv.height), vh: innerHeight, vw: innerWidth }; if (typeof window.__shot === 'function') window.__shot(); cc.querySelector('[data-act="full"]').click(); await new Promise(r => setTimeout(r, 300)); return o; });
    if (w <= 860) { await page.evaluate(() => { document.getElementById('menu-btn').click(); }); await sleep(450); rec.extras.drawer = await page.evaluate(() => { const sb = document.getElementById('sidebar'), b = sb.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight, scrollable: sb.scrollHeight > sb.clientHeight + 2, overflowY: getComputedStyle(sb).overflowY }; }); if (SHOTS) await page.screenshot({ path: `/tmp/audit_shots/${name}_drawer.png` }); }
    report.push(rec); await page.close();
  }
  await browser.close();
  // ---- summary
  let total = 0;
  for (const r of report) {
    const iss = r.tabs.flatMap(t => t.issues.map(i => ({ ...i, tab: t.tab }))), ex = r.extras, extra = [];
    if (ex.sticky && r.w > 860 && ex.sticky.sidebarTop > 80 && r.tabs[0].stats.canScrollPage) extra.push({ kind: 'sidebar-not-sticky', what: 'sidebar', detail: JSON.stringify(ex.sticky) });
    if (ex.sticky && r.tabs[0].stats.canScrollPage && ex.sticky.navTop > 80) extra.push({ kind: 'tabs-not-sticky', what: 'tab-nav', detail: 'navTop ' + ex.sticky.navTop });
    if (ex.modal) { if (!ex.modal.footVisible) extra.push({ kind: 'modal-footer-hidden', what: 'settings', detail: JSON.stringify(ex.modal) }); if (ex.modal.cardBottom > ex.modal.vh + 1) extra.push({ kind: 'modal-taller-than-viewport', what: 'settings', detail: JSON.stringify(ex.modal) }); if (!ex.modal.paneScrollable && ex.modal.paneClientH < 120) extra.push({ kind: 'modal-pane-collapsed', what: 'settings', detail: JSON.stringify(ex.modal) }); if (!ex.modal.navVisible) extra.push({ kind: 'modal-nav-hidden', what: 'settings', detail: '' }); }
    if (ex.closedSidebar && r.w <= 860 && (ex.closedSidebar.visibility !== 'hidden' || ex.closedSidebar.right > 1)) extra.push({ kind: 'closed-drawer-reachable', what: 'sidebar', detail: JSON.stringify(ex.closedSidebar) });
    if (ex.collapse && (ex.collapse.sidebarShown || (ex.collapse.after <= ex.collapse.before && ex.collapse.before < 1495))) extra.push({ kind: 'sidebar-collapse-broken', what: 'menu-btn', detail: JSON.stringify(ex.collapse) });
    if (ex.menu && (!ex.menu.inside || !ex.menu.onTop)) extra.push({ kind: 'export-menu-clipped', what: 'menu', detail: JSON.stringify(ex.menu) });
    if (ex.fullscreen && (ex.fullscreen.bodyH < 200 || ex.fullscreen.canvasH < 150)) extra.push({ kind: 'fullscreen-collapsed', what: 'rr', detail: JSON.stringify(ex.fullscreen) });
    if (ex.drawer && (ex.drawer.left < -1 || ex.drawer.width < 200 || ex.drawer.bottom > ex.drawer.vh + 1)) extra.push({ kind: 'drawer-misplaced', what: 'sidebar', detail: JSON.stringify(ex.drawer) });
    if (ex.drawer && !ex.drawer.scrollable && ex.drawer.vh < 700) extra.push({ kind: 'drawer-not-scrollable?', what: 'sidebar', detail: JSON.stringify(ex.drawer) });
    const all = iss.concat(extra); total += all.length;
    console.log(`\n=== ${r.name} ${r.w}x${r.h}@${r.dpr}  issues: ${all.length}${r.errors.length ? '  console errors: ' + r.errors.length : ''}`);
    const grouped = {}; all.forEach(i => { const k = i.kind + ' | ' + i.what; (grouped[k] = grouped[k] || []).push(i); });
    Object.entries(grouped).slice(0, 40).forEach(([k, v]) => console.log('  - ' + k + (v.length > 1 ? ' (' + v.length + ' tabs)' : '') + '  ' + (v[0].detail || '').slice(0, 170)));
    if (r.errors.length) console.log('  errors:', r.errors.slice(0, 3).join(' || ').slice(0, 300));
  }
  console.log('\nTOTAL ISSUES: ' + total); fs.writeFileSync('/tmp/audit_report.json', JSON.stringify(report)); process.exit(total ? 1 : 0);
})().catch(e => { console.error('AUDIT CRASH', e); process.exit(2); });

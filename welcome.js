/* ============================================================================
   SPARK welcome message: shown at start (unless switched off), reopened with the ? button or the ? key. A modal dialog: focus moves in, Tab stays inside,
   Escape / the backdrop / Get started close it, and focus returns to where it was. "Don't show this again" is stored in the settings (ui.welcome).
   ========================================================================== */
(function (root) {
'use strict';
const doc = root.document, $ = id => doc.getElementById(id), ST = root.SparkSettings; let lastFocus = null;
const wanted = () => ST.get('ui.welcome') !== false;      // a settings file without the `ui` section (older or cached) counts as "show it"
function setWanted(v) { try { const all = ST.all(); if (all && !all.ui) all.ui = { welcome: true }; ST.set('ui.welcome', v, true); } catch (e) { /* the choice just is not stored */ } }
const modal = () => $('welcome-modal'), isOpen = () => modal().classList.contains('show');
function focusables() { return Array.from(modal().querySelectorAll('button, [href], input, select, summary, [tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled && el.offsetParent !== null || el === doc.activeElement); }
function open() {
  if (isOpen()) return; lastFocus = doc.activeElement; $('wm-never').checked = !wanted();
  modal().classList.add('show'); modal().setAttribute('aria-hidden', 'false'); doc.body.classList.add('wm-open'); $('wm-curious').open = false; const b = modal().querySelector('.wm-body'); if (b) b.scrollTop = 0;
  setTimeout(() => $('wm-start').focus(), 0);
}
function close() {
  if (!isOpen()) return; setWanted(!$('wm-never').checked);
  modal().classList.remove('show'); modal().setAttribute('aria-hidden', 'true'); doc.body.classList.remove('wm-open');
  try { if (lastFocus && lastFocus.focus && doc.contains(lastFocus)) lastFocus.focus(); } catch (e) { /* ignore */ } lastFocus = null;
}
$('wm-x').onclick = close; $('wm-start').onclick = close;
modal().addEventListener('mousedown', ev => { if (ev.target === modal()) close(); });
$('wm-example').onclick = () => { close(); if (root.SPARK && root.SPARK.live) root.SPARK.live.setMode('analysis'); $('btn-example').click(); };
$('wm-live').onclick = () => { close(); if (root.SPARK && root.SPARK.live) root.SPARK.live.setMode('live'); };
$('btn-help').onclick = open;
doc.addEventListener('keydown', ev => {
  if (isOpen()) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key === 'Tab') { const f = focusables(); if (!f.length) return; const first = f[0], last = f[f.length - 1], act = doc.activeElement;
      if (ev.shiftKey && (act === first || !modal().contains(act))) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && (act === last || !modal().contains(act))) { ev.preventDefault(); first.focus(); } }
    return;
  }
  const tag = (ev.target.tagName || '').toLowerCase(); if (['input', 'select', 'textarea'].includes(tag) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.key === '?') { ev.preventDefault(); open(); }
});
root.SparkWelcome = { open, close, isOpen };
if (root.SparkApp && root.SparkApp.ready) root.SparkApp.ready.then(() => { if (wanted()) open(); });
})(typeof window !== 'undefined' ? window : globalThis);

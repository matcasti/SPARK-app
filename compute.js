/* ============================================================================
   SPARK compute: runs the heavy numerical work (spectral anchor, MAP fit, Hessian, derived statistics, spectra,
   rolling statistics, state-space landscape, scalogram) in a Web Worker so that the page stays responsive,
   and falls back to the main thread (with yields between stages) where workers are unavailable.
   The worker is created from the engine's own source (SparkEngineFactory.toString()), so it also works from file://.
   ========================================================================== */
(function (root) {
'use strict';

/* The stages are plain functions of the engine: they are used by the main-thread fallback AND embedded in the worker source. */
function stageAnchor(E, a) { return E.extractSpectralPriors(a.rr, a.priors); }
function stageFit(E, a, pr) { return E.fitFromAnchor(a.rr, pr, a.control); }
function stageRep(E, a, fit) { return a.computeSE ? E.reportModel(fit) : null; }
function stageDerived(E, a, fit) { return { dm: E.derivedMetrics(fit), diag: E.innovationDiagnostics(fit) }; }
function stageExtras(E, a, fit, dm) {
  return { psd: E.hrPSD(fit.dy, fit.irr, fit.time), hrvObs: E.hrvStats(fit.dy, fit.pr), hrvFlt: E.hrvStats(fit.irr, fit.pr), roll: E.rollingStats(fit.time, fit.dy, fit.irr, a.roll.window, a.roll.step),
           land: E.stateLandscape(fit.Xp, fit.Xs, dm.sdP_ss, dm.sdS_ss, a.landscape), cwt: E.cwtDisplay(fit.dy) };
}
const WORKER_MAIN = `
${stageAnchor}\n${stageFit}\n${stageRep}\n${stageDerived}\n${stageExtras}
self.onmessage = function (ev) {
  const m = ev.data, E = self.SparkEngine, post = (type, extra) => self.postMessage(Object.assign({ id: m.id, type }, extra));
  try {
    const a = m.args; post('progress', { msg: 'Extracting Morlet CWT spectral anchor…', pct: 8 }); const pr = stageAnchor(E, a);
    post('progress', { msg: 'Running 3-D BFGS (M3)…', pct: 25 }); const fit = stageFit(E, a, pr);
    post('progress', { msg: a.computeSE ? 'Hessian, standard errors and Laplace posterior…' : 'Computing statistics…', pct: 62 }); const rep = stageRep(E, a, fit);
    const d = stageDerived(E, a, fit); post('done', { out: { fit: fit, rep: rep, dm: d.dm, diag: d.diag } });
    post('extras', { extras: stageExtras(E, a, fit, d.dm) });
  } catch (err) { post('error', { message: String(err && err.message || err) }); }
};`;

let worker = null, usable = null; const jobs = new Map(); let nextId = 1;
function startWorker() {
  if (usable !== null) return usable;
  try {
    if (!root.Worker || !root.Blob || !root.URL || !root.URL.createObjectURL || !root.SparkEngineFactory) { usable = false; return false; }
    const src = '(' + root.SparkEngineFactory.toString() + ')(self);\n' + WORKER_MAIN;
    worker = new root.Worker(root.URL.createObjectURL(new root.Blob([src], { type: 'application/javascript' })));
    worker.onmessage = ev => { const m = ev.data, j = jobs.get(m.id); if (!j) return;
      if (m.type === 'progress') j.onProgress && j.onProgress(m.msg, m.pct);
      else if (m.type === 'done') j.resolve(m.out);
      else if (m.type === 'extras') { jobs.delete(m.id); j.extras.resolve(m.extras); }
      else if (m.type === 'error') { jobs.delete(m.id); j.reject(new Error(m.message)); j.extras.resolve(null); } };
    worker.onerror = () => { usable = false; const pend = Array.from(jobs.values()); jobs.clear(); try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; pend.forEach(j => { j.fallback && j.fallback(); }); };
    usable = true;
  } catch (e) { usable = false; }
  return usable;
}
const tick = () => new Promise(r => (root.requestAnimationFrame ? root.requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));

/** Run the analysis. args = {rr, priors, control, computeSE, roll: {window, step}, landscape: {...}}.
    @return {done: Promise<{fit, rep, dm, diag}>, extras: Promise<{psd, hrvObs, hrvFlt, roll, land, cwt} | null>, via: 'worker' | 'main'} */
function analyze(args, onProgress) {
  const E = root.SparkEngine; let resolveExtras; const extras = new Promise(r => { resolveExtras = r; });
  const main = () => {            // fallback: same stages on the main thread, yielding between them so that the progress text can paint
    const done = (async () => {
      onProgress && onProgress('Extracting Morlet CWT spectral anchor…', 8); await tick(); const pr = stageAnchor(E, args);
      onProgress && onProgress('Running 3-D BFGS (M3)…', 25); await tick(); const fit = stageFit(E, args, pr);
      onProgress && onProgress(args.computeSE ? 'Hessian, standard errors and Laplace posterior…' : 'Computing statistics…', 62); await tick(); let rep = null; try { rep = stageRep(E, args, fit); } catch (e) { console.warn('SE failed', e); }
      const d = stageDerived(E, args, fit);
      setTimeout(() => { try { resolveExtras(stageExtras(E, args, fit, d.dm)); } catch (e) { resolveExtras(null); } }, 0);       // derived spectra etc. are computed lazily by the app if needed first
      return { fit, rep, dm: d.dm, diag: d.diag };
    })();
    return { done, extras, via: 'main' };
  };
  if (!startWorker()) return main();
  const id = nextId++; let resolve, reject; const done = new Promise((res, rej) => { resolve = res; reject = rej; });
  const job = { resolve, reject, onProgress, extras: { resolve: resolveExtras }, fallback: null }; jobs.set(id, job);
  const result = { done, extras, via: 'worker' };
  job.fallback = () => { const m = main(); m.done.then(resolve, reject); result.via = 'main'; };       // the worker died: redo on the main thread
  try { worker.postMessage({ id, args }); } catch (e) { jobs.delete(id); usable = false; return main(); }
  return result;
}
root.SparkCompute = { analyze, isWorker: () => usable === true, terminate: () => { if (worker) { worker.terminate(); worker = null; usable = null; jobs.clear(); } } };
})(typeof window !== 'undefined' ? window : globalThis);

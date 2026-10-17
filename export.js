/* ============================================================================
   SPARK exports: chart images (PNG, any scale; all charts as ZIP), parameters and per-beat CSV,
   full session JSON, a self-contained HTML report, a filtered-RR file and an R script that
   reproduces the fit with identical settings. Formats follow Settings -> Export.
   ========================================================================== */
(function (root) {
'use strict';
const doc = root.document, ST = root.SparkSettings, E = root.SparkEngine;
let ctx = { fit: null, rep: null, dm: null, diag: null, hrvObs: null, hrvFlt: null, label: 'data' };   // set by app.js

const X = () => ST.get('export');
const slug = s => String(s || 'data').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'data';
const fname = (kind, ext) => `${X().prefix || 'spark'}_${slug(ctx.label)}_${kind}.${ext}`;
function download(content, name, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' }), url = root.URL.createObjectURL(blob), a = doc.createElement('a');
  a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => root.URL.revokeObjectURL(url), 2000);
  return blob;
}
const dec = s => X().decimal === ',' ? String(s).replace('.', ',') : String(s);
const nf = (x, d) => isFinite(x) ? dec(Number(x).toPrecision(d || 8)) : '';
const nfix = (x, d) => isFinite(x) ? dec(x.toFixed(d)) : '';
function csv(headers, rows) {
  const sep = X().separator === '\\t' ? '\t' : X().separator, q = v => { const s = String(v == null ? '' : v); return s.includes(sep) || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [headers.map(q).join(sep)].concat(rows.map(r => r.map(q).join(sep))).join('\n') + '\n';
}

/* ---- parameter table rows (also used to render the table in the app) ---------------------------------------------------- */
function paramRows(fit, rep) {
  const p = fit.params, pr = fit.pr, ctl = fit.ctl, se = rep ? rep.se : {}, g = (est, s) => ({ est, se: s, lo: isFinite(s) ? est - 1.96 * s : NaN, hi: isFinite(s) ? est + 1.96 * s : NaN });
  const row = (n, group, gc, interp, status, est, s) => Object.assign({ n, group, gc, interp, status }, g(est, s == null ? NaN : s));
  return [
    row('ν₀', 'Baseline', 'g-base', 'Intrinsic SA node pacing rate absent autonomic tone (Hz)', 'Profiled — GLS', p.nu0),
    row('σ²sys', 'Scale', 'g-sc', 'Global stochastic system variance multiplier', 'Profiled — GLS', p.sig2),
    row('κ_S', 'Kinetic', 'g-kin', 'Clearance rate of sympathetic neurotransmitters (Hz)', 'Estimated — MAP', p.ks, se.ks),
    row('κ_P', 'Kinetic', 'g-kin', 'Clearance rate of vagal neurotransmitters (Hz)', 'Estimated — MAP', p.kp, se.kp),
    row('τ_S', 'Kinetic', 'g-kin', 'Sympathetic e-folding time 1/κ_S (s)', 'Derived — MAP', 1 / p.ks, se.tau_s),
    row('τ_P', 'Kinetic', 'g-kin', 'Parasympathetic e-folding time 1/κ_P (s)', 'Derived — MAP', 1 / p.kp, se.tau_p),
    row('σ_S', 'Volatility', 'g-vol', 'Sympathetic drive amplitude', 'Profiled — GLS', p.sigS),
    row('σ_P', 'Volatility', 'g-vol', 'Baseline (g = 1) vagal drive amplitude', 'Derived — spectral', p.sigP),
    row('γ', 'Vagal gain', 'g-vg', 'Variance-gain coefficient ≥ 0 (≈ 0: gate off, ungated model)' + (p.gate_off ? ' — gate OFF' : ''), 'Estimated — MAP (log link)', p.gamma, se.gamma),
    row('Λ_P', 'Ratio', 'g-rat', 'V_P/V_S: logistic CWT partition (Parseval anchor)', 'Fixed — spectral', p.lp),
    row('Λ_R', 'Ratio', 'g-rat', 'Noise-to-signal ratio from SA node threshold jitter', 'Estimated — MAP', p.lR, se.lR),
    row('Jitter', 'Ratio', 'g-rat', 'Equivalent RR timing jitter SD at the median RR (ms)', 'Derived — MAP', p.rr_jitter_ms),
    row('θ_jump', 'Robustness', 'g-rob', 'Relative RR jump threshold of the artifact gate', 'Fixed — setting', ctl.jump_threshold),
    row('p_jump', 'Robustness', 'g-rob', 'Steepness of the artifact gate', 'Fixed — setting', ctl.jump_power),
    row('τ_g', 'Vagal gain', 'g-vg', 'Low-pass time constant feeding the vagal gate (s)', 'Fixed — setting', ctl.tau_g)
  ];
}

/* ---- images ------------------------------------------------------------------------------------------------------------------- */
function bgColor() { const b = X().background; if (b === 'white') return '#ffffff'; if (b === 'black') return '#0B1120'; return doc.documentElement.dataset.theme === 'light' ? '#ffffff' : '#0B1120'; }
function cardTitle(id) { const c = root.SparkCharts.CARDS.find(x => x.id === id); return c ? c.title : id; }
/** Render a card canvas to a PNG Blob at the configured scale, with a title strip and a footer. */
async function renderPNG(id, scaleIn) {
  const cv = root.SparkCharts.getCanvas(id); if (!cv) throw new Error('Nothing to export for this chart yet.');
  const chart = root.SparkCharts.charts[id], scale = scaleIn || X().scale || 2;
  let src = cv, restore = null;
  if (chart) {
    const old = chart.options.devicePixelRatio; chart.options.devicePixelRatio = scale; chart.resize(); src = chart.canvas;
    restore = () => { chart.options.devicePixelRatio = old; chart.resize(); };
  }
  const w = src.width, h = src.height, pad = Math.round(28 * scale / (chart ? 1 : 1)), foot = Math.round(18 * scale), out = doc.createElement('canvas');
  out.width = w; out.height = h + pad + foot; const g = out.getContext('2d'), dark = bgColor() === '#0B1120';
  g.fillStyle = bgColor(); g.fillRect(0, 0, out.width, out.height);
  g.fillStyle = dark ? '#C8D8EC' : '#0C1E30'; g.font = `600 ${Math.round(11.5 * scale)}px -apple-system,Segoe UI,sans-serif`; g.textBaseline = 'middle'; g.fillText(cardTitle(id), Math.round(10 * scale), pad / 2);
  g.drawImage(src, 0, pad);
  g.fillStyle = dark ? '#507098' : '#486888'; g.font = `${Math.round(8.5 * scale)}px -apple-system,Segoe UI,sans-serif`;
  g.fillText(`SPARK M3G · ${slug(ctx.label)}${ctx.fit ? ' · ' + ctx.fit.dy.length + ' beats' : ''}`, Math.round(10 * scale), pad + h + foot / 2);
  if (restore) restore();
  return new Promise((res, rej) => { if (out.toBlob) out.toBlob(b => b ? res(b) : rej(new Error('PNG encoding failed')), 'image/png'); else rej(new Error('Canvas export unsupported')); });
}
async function chartPNG(id) { try { const b = await renderPNG(id); download(b, fname(id, 'png')); toast('Saved ' + fname(id, 'png'), 'ok'); } catch (e) { toast(e.message, 'err'); } }

/* ---- ZIP (store only, no compression, no dependency) --------------------------------------------------------------------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255], d = new Date();
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  files.forEach(f => {
    const nm = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), 0, 0]);
    parts.push(lh, nm, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off)]), nm);
    off += lh.length + nm.length + data.length;
  });
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), 0, 0]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
async function allPNGZip() {
  const cards = root.SparkCharts.CARDS.filter(c => c.kind !== 'html' && !ST.get('charts.hidden')[c.id] && root.SparkCharts.getCanvas(c.id) && !doc.querySelector(`.cc[data-chart="${c.id}"] .empty-card`)), files = [];
  toast('Rendering ' + cards.length + ' images…', 'ok');
  for (const c of cards) { try { const b = await renderPNG(c.id); files.push({ name: fname(c.id, 'png').replace(/^.*?_/, ''), data: new Uint8Array(await b.arrayBuffer()) }); } catch (e) { /* skip */ } }
  if (!files.length) return toast('No charts to export yet.', 'err');
  download(zipStore(files), fname('charts', 'zip')); toast(`Saved ${files.length} charts`, 'ok');
}

/* ---- data files ------------------------------------------------------------------------------------------------------------------ */
function parametersCSV() {
  const rows = paramRows(ctx.fit, ctx.rep).map(r => [r.n.replace(/[₀₁]/g, ''), r.group, nf(r.est), nf(r.se), nf(r.lo), nf(r.hi), r.status, r.interp]);
  const f = ctx.fit, extra = [['LL_star', 'Fit', nf(f.LL_star), '', '', '', 'Profiled', 'Profiled log-likelihood'], ['V_P/V_S', 'Fit', nf(f.pr.energy_ratio), '', '', '', 'Fixed — spectral', 'Spectral anchor']];
  download(csv(['parameter', 'group', 'estimate', 'se', 'ci95_low', 'ci95_high', 'status', 'interpretation'], rows.concat(extra)), fname('parameters', 'csv'), 'text/csv'); toast('Saved parameters CSV', 'ok');
}
function beatsCSV() {
  const f = ctx.fit, h = ['beat', 'time_s', 'rr_observed_s', 'rr_filtered_s', 'rr_filtered_lo95', 'rr_filtered_hi95', 'x_p_hz', 'x_p_se', 'x_s_hz', 'x_s_se', 'vagal_gain', 'artifact_multiplier', 'innovation', 'innovation_diagnostic'], rows = [];
  for (let i = 0; i < f.dy.length; i++) { const sr = Math.sqrt(Math.max(f.rrV[i], 0)); rows.push([i + 1, nfix(f.time[i], 4), nfix(f.dy[i], 5), nfix(f.irr[i], 5), nfix(f.irr[i] - 1.96 * sr, 5), nfix(f.irr[i] + 1.96 * sr, 5), nf(f.Xp[i], 7), nf(Math.sqrt(Math.max(f.XpV[i], 0)), 6), nf(f.Xs[i], 7), nf(Math.sqrt(Math.max(f.XsV[i], 0)), 6), nf(f.gain[i], 6), nf(f.gate[i], 6), nf(f.innovations[i], 6), nf(f.innovations_diagnostic[i], 6)]); }
  download(csv(h, rows), fname('beats', 'csv'), 'text/csv'); toast('Saved per-beat CSV (' + rows.length + ' rows)', 'ok');
}
function filteredRR(unit, fmt) {
  const f = ctx.fit, dp = unit === 'ms' ? 2 : 4, lines = Array.from(f.irr, v => nfix(unit === 'ms' ? v * 1000 : v, dp));
  download((fmt === 'csv' ? `rr_interval_${unit}\n` : '') + lines.join('\n') + '\n', fname('filtered_rr_' + unit, fmt), fmt === 'csv' ? 'text/csv' : 'text/plain');
}
function sessionObject(withData) {
  const f = ctx.fit, rep = ctx.rep, diag = ctx.diag, dm = ctx.dm;
  return { spark_session: 3, created: new Date().toISOString(), model: 'M3G (engine 01_model_engine.R)', data: { label: ctx.label, beats: f.dy.length, duration_s: f.time[f.time.length - 1], rr_s: withData ? Array.from(f.dy) : undefined },
    settings: { priors: ST.get('model.priors'), control: ST.get('model.control'), changed_from_defaults: ST.modelDiff() },
    spectral_anchor: { energy_ratio: f.pr.energy_ratio, p_lf: f.pr.p_lf, p_hf: f.pr.p_hf, nu0_init: f.pr.nu0_init },
    parameters: paramRows(f, rep).map(r => ({ name: r.n, estimate: r.est, se: isFinite(r.se) ? r.se : null, ci95: isFinite(r.lo) ? [r.lo, r.hi] : null, status: r.status })),
    fit: { LL_star: f.LL_star, objective: f.opt ? f.opt.value : null, bfgs_counts: f.opt ? f.opt.counts : null, converged: f.opt ? f.opt.convergence === 0 : null, gate_off: f.params.gate_off, gain_range: [dm.gainMin, dm.gainMax], rr_jitter_ms: f.params.rr_jitter_ms, rmse_ms: dm.rmse, mape_pct: dm.mape, pct_artifact_gated: dm.pctGated },
    posterior: rep ? { sd_ln_tau_s: rep.sd_ln_tau_s, sd_ln_tau_p: rep.sd_ln_tau_p, hessian_eig_range: [rep.min_eig, rep.max_eig] } : null,
    diagnostics: diag ? { n_retained: diag.N, n_total: diag.N_total, ks_D: diag.ks.D, ks_p: diag.ks.p, ks_bound: diag.ks_bound, pacf_violations: diag.pacf_violations, pacf_lags: diag.pacf.length, skew: diag.skew, excess_kurtosis: diag.kurt } : null,
    hrv: { observed: ctx.hrvObs, filtered: ctx.hrvFlt }, phases: ctx.events ? { events: ctx.events, summary: ctx.phases } : null,
    summaries: { rmssd_filtered_ms: dm.rmssdFlt, rmssd_observed_ms: dm.rmssdObs, sdnn_filtered_ms: dm.sdnnFlt, mean_epr: dm.mEPR, rms_areal_velocity: dm.rmsArealVel, balance_sd: dm.abiStd } };
}
function sessionJSON() { download(JSON.stringify(sessionObject(true), null, 2), fname('session', 'json'), 'application/json'); toast('Saved session JSON', 'ok'); }

/* ---- R script ------------------------------------------------------------------------------------------------------------------------ */
function rScript() {
  const f = ctx.fit, diff = ST.modelDiff(), arg = o => Object.keys(o).map(k => { const v = o[k]; return `  ${k} = ${Array.isArray(v) ? 'c(' + v.join(', ') + ')' : v}`; }).join(',\n');
  const rr = Array.from(f.dy, v => String(v)).join(', ');   // full precision: the R fit reproduces the browser fit
  const code = `# SPARK M3G -- reproduces the fit of "${ctx.label}" with the same settings (generated ${new Date().toISOString()})
# Needs 01_model_engine.R and the packages biwavelet, numDeriv, MASS, ggplot2, patchwork.
suppressPackageStartupMessages({ library(biwavelet); library(numDeriv); library(MASS); library(ggplot2); library(patchwork) })
source("01_model_engine.R")

rr <- c(${rr})   # RR intervals (s)

priors <- spark_priors(${Object.keys(diff.priors).length ? '\n' + arg(diff.priors) + '\n' : ''})
control <- spark_control(${Object.keys(diff.control).length ? '\n' + arg(diff.control) + '\n' : ''})

fit <- fit_model(rr, priors, control)
report_model(fit)
print(visualize_model(fit))
print(diagnose_model(fit))

# Expected (browser app): LL* = ${f.LL_star.toFixed(4)}, kappa_S = ${f.params.ks.toPrecision(6)}, kappa_P = ${f.params.kp.toPrecision(6)}, gamma = ${f.params.gamma.toPrecision(4)}, V_P/V_S = ${f.pr.energy_ratio.toPrecision(6)}
`;
  download(code, fname('reproduce', 'R'), 'text/plain'); toast('Saved R script', 'ok');
}

/* ---- HTML report ----------------------------------------------------------------------------------------------------------------------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function reportHTML() {
  const f = ctx.fit, rep = ctx.rep, diag = ctx.diag, dm = ctx.dm; toast('Building report…', 'ok');
  const imgs = []; for (const c of root.SparkCharts.CARDS) { if (c.kind === 'html' || ST.get('charts.hidden')[c.id] || !root.SparkCharts.getCanvas(c.id) || doc.querySelector(`.cc[data-chart="${c.id}"] .empty-card`)) continue;
    try { const b = await renderPNG(c.id, Math.min(X().scale || 2, 2)); const u8 = new Uint8Array(await b.arrayBuffer()); let bin = ''; for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); imgs.push({ title: c.title, src: 'data:image/png;base64,' + root.btoa(bin) }); } catch (e) { /* skip */ } }
  const pr = paramRows(f, rep), n = (x, d) => isFinite(x) ? Number(x).toPrecision(d || 5) : '—', diff = ST.modelDiff(), changed = Object.keys(diff.priors).concat(Object.keys(diff.control));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SPARK report — ${esc(ctx.label)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px/1.5 -apple-system,Segoe UI,system-ui,sans-serif;color:#0c1e30;max-width:980px;margin:24px auto;padding:0 16px}h1{font-size:1.4rem;margin:0}h2{font-size:1rem;border-bottom:1px solid #ccd6e6;padding-bottom:4px;margin:26px 0 10px}
table{border-collapse:collapse;width:100%;font-size:.82rem}th,td{border-bottom:1px solid #e3e9f3;padding:5px 8px;text-align:left}th{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:#486888}td.n{font-family:ui-monospace,Consolas,monospace;text-align:right}
.meta{color:#486888;font-size:.8rem}figure{margin:14px 0;break-inside:avoid}figure img{max-width:100%;border:1px solid #e3e9f3;border-radius:6px}figcaption{font-size:.72rem;color:#486888}code{font-family:ui-monospace,Consolas,monospace;font-size:.78rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.k{border:1px solid #e3e9f3;border-radius:8px;padding:6px 10px}.k b{display:block;font-family:ui-monospace,monospace;font-size:1rem}.k span{font-size:.68rem;color:#486888;text-transform:uppercase}
@media print{figure,table{break-inside:avoid}}</style></head><body>
<h1>SPARK — stochastic phase-domain autonomic reconstruction</h1><div class="meta">Model M3G · ${esc(ctx.label)} · ${f.dy.length} beats · ${n(f.time[f.time.length - 1], 6)} s · ${new Date().toLocaleString()}</div>
<h2>Key estimates</h2><div class="grid">${[['Heart rate (ν₀)', n(f.params.nu0 * 60, 4) + ' bpm'], ['τ_S', n(1 / f.params.ks, 4) + ' s'], ['τ_P', n(1 / f.params.kp, 3) + ' s'], ['γ', n(f.params.gamma, 3) + (f.params.gate_off ? ' (off)' : '')], ['V_P/V_S', n(f.pr.energy_ratio, 4)], ['RMSSD filtered', n(dm.rmssdFlt, 4) + ' ms'], ['Fit RMSE', n(dm.rmse, 3) + ' ms'], ['LL*', n(f.LL_star, 6)]].map(([k, v]) => `<div class="k"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
<h2>Parameters</h2><table><thead><tr><th>Parameter</th><th>Estimate</th><th>SE</th><th>95% CI</th><th>Status</th><th>Interpretation</th></tr></thead><tbody>${pr.map(r => `<tr><td>${esc(r.n)}</td><td class="n">${n(r.est, 6)}</td><td class="n">${isFinite(r.se) ? n(r.se, 3) : '—'}</td><td class="n">${isFinite(r.lo) ? '[' + n(r.lo, 4) + ', ' + n(r.hi, 4) + ']' : '—'}</td><td>${esc(r.status)}</td><td>${esc(r.interp)}</td></tr>`).join('')}</tbody></table>
${diag ? `<h2>Diagnostics</h2><div class="grid"><div class="k"><span>KS p</span><b>${n(diag.ks.p, 3)}</b></div><div class="k"><span>KS D</span><b>${n(diag.ks.D, 3)}</b></div><div class="k"><span>PACF violations</span><b>${diag.pacf_violations}/${diag.pacf.length}</b></div><div class="k"><span>Beats retained</span><b>${diag.N}/${diag.N_total}</b></div></div>` : ''}
${ctx.phases ? `<h2>Phases</h2><table><thead><tr><th>Phase</th><th>Duration (s)</th><th>HR (bpm)</th><th>RMSSD (ms)</th><th>mean x_p</th><th>mean x_s</th><th>Shift (σ)</th></tr></thead><tbody>${ctx.phases.map(r => r.n < 5 ? '' : `<tr><td>${r.name}</td><td class="n">${n(r.duration, 4)}</td><td class="n">${n(r.hr, 4)}</td><td class="n">${n(r.rmssdObs, 3)}</td><td class="n">${n(r.xp, 3)}</td><td class="n">${n(r.xs, 3)}</td><td class="n">${n(r.shift, 3)}</td></tr>`).join('')}</tbody></table>` : ''}
<h2>HRV statistics</h2><table><thead><tr><th>Metric</th><th>Observed</th><th>Filtered</th></tr></thead><tbody>${[['Mean HR (bpm)', 'meanHR'], ['SDNN (ms)', 'SDNN'], ['RMSSD (ms)', 'RMSSD'], ['pNN50 (%)', 'pNN50'], ['LF (ms²)', 'LF'], ['HF (ms²)', 'HF'], ['LF/HF', 'LFHF']].map(([l, k]) => `<tr><td>${l}</td><td class="n">${n(ctx.hrvObs[k], 4)}</td><td class="n">${n(ctx.hrvFlt[k], 4)}</td></tr>`).join('')}</tbody></table>
${X().includeSettings ? `<h2>Model settings</h2><p class="meta">${changed.length ? 'Changed from the engine defaults: <code>' + esc(JSON.stringify(diff)) + '</code>' : 'Engine defaults (M3G).'}</p>` : ''}
<h2>Charts</h2>${imgs.map(i => `<figure><img src="${i.src}" alt="${esc(i.title)}"><figcaption>${esc(i.title)}</figcaption></figure>`).join('')}
<p class="meta">Generated by the SPARK browser app. Reproduce with the exported R script (01_model_engine.R).</p></body></html>`;
  download(html, fname('report', 'html'), 'text/html'); toast('Saved HTML report (open it and use Print → PDF)', 'ok');
}

/* ---- menu --------------------------------------------------------------------------------------------------------------------------- */
function toast(msg, kind) { if (root.SparkApp && root.SparkApp.toast) root.SparkApp.toast(msg, kind); }
const ITEMS = [
  ['Images', null],
  ['Current tab as PNG (all charts, ZIP)', allPNGZip, 'zip'],
  ['Data', null],
  ['Parameters with SE and CI', parametersCSV, 'csv'],
  ['Per-beat table (states, SEs, gain, innovations)', beatsCSV, 'csv'],
  ['Filtered RR series', () => filteredRR(doc.getElementById('exp-unit') ? doc.getElementById('exp-unit').value : 's', doc.getElementById('exp-fmt') ? doc.getElementById('exp-fmt').value : 'csv'), 'txt/csv'],
  ['Session', null],
  ['Full session (settings + results)', sessionJSON, 'json'],
  ['Self-contained report with charts', reportHTML, 'html'],
  ['R script reproducing this fit', rScript, 'R']
];
function mountMenu(host) {
  host.innerHTML = ''; host.setAttribute('role', 'menu');
  ITEMS.forEach(([label, fn, tag]) => {
    if (!fn) { const h = doc.createElement('h6'); h.textContent = label; host.appendChild(h); return; }
    const b = doc.createElement('button'); b.setAttribute('role', 'menuitem'); b.innerHTML = `<span>${label}</span><small>${tag}</small>`; b.disabled = true; b.dataset.needs = 'fit';
    b.addEventListener('click', () => { host.classList.remove('show'); Promise.resolve().then(fn).catch(e => toast(e.message, 'err')); }); host.appendChild(b);
  });
}
function setContext(c) { ctx = Object.assign(ctx, c); doc.querySelectorAll('#export-menu button[data-needs="fit"]').forEach(b => { b.disabled = !ctx.fit; }); }

root.SparkExport = { mountMenu, setContext, chartPNG, renderPNG, allPNGZip, parametersCSV, beatsCSV, filteredRR, sessionJSON, sessionObject, rScript, reportHTML, paramRows, zipStore, crc32, csv, download, fname };
})(typeof window !== 'undefined' ? window : globalThis);

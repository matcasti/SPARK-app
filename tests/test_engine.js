// Equivalence test: the JS engine vs the R engine (tests/reference_R.json, made by tests/make_reference.R).
//   node tests/test_engine.js
const E = require('../engine.js'), fs = require('fs'), ref = JSON.parse(fs.readFileSync(__dirname + '/reference_R.json', 'utf8'));
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok    ' + name + (detail ? '  [' + detail + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); } };
const maxAbs = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const num = x => typeof x === 'string' ? NaN : x;
const t0 = Date.now();
for (const [name, r] of Object.entries(ref)) {
  console.log('\n== ' + name + ' (N = ' + r.dy.length + ')');
  const pri = E.sparkPriors(), ctl = E.sparkControl(), pr = E.extractSpectralPriors(r.dy, pri);
  check('spectral anchor V_p/V_s', rel(pr.energy_ratio, r.energy_ratio) < 1e-6, 'JS ' + pr.energy_ratio.toPrecision(8) + ' vs R ' + r.energy_ratio.toPrecision(8));
  const prAlt = E.extractSpectralPriors(r.dy, E.sparkPriors({ lower_lf_vagal_fraction: 0.5 }));
  check('vagal-floor default is 0.25 (the engine default) and a non-default floor follows the R engine', pri.lower_lf_vagal_fraction === 0.25 && rel(prAlt.energy_ratio, r.energy_ratio_alt) < 1e-6, 'V_P/V_S: 0.25 -> ' + pr.energy_ratio.toPrecision(5) + ', 0.5 -> ' + prAlt.energy_ratio.toPrecision(5));
  check('LF / HF band power (diagnostic)', rel(pr.p_lf, r.p_lf) < 1e-5 && rel(pr.p_hf, r.p_hf) < 1e-5);
  const F = r.filter, f = E.runGLSFilter(r.dy, F.params.kp, F.params.ks, r.energy_ratio, F.params.lR, ctl);
  check('filter: LL*, nu0, sigma^2', rel(f.LL_star, F.LL_star) < 1e-9 && rel(f.nu0, F.nu0) < 1e-9 && rel(f.sig2, F.sig2) < 1e-9, 'dLL ' + Math.abs(f.LL_star - F.LL_star).toExponential(1));
  check('filter: states x_p, x_s', maxAbs(f.Xp, F.X_p) < 1e-9 && maxAbs(f.Xs, F.X_s) < 1e-9, maxAbs(f.Xp, F.X_p).toExponential(1));
  check('filter: state variances', maxAbs(f.XpV, F.X_p_var) < 1e-10 && maxAbs(f.XsV, F.X_s_var) < 1e-10 && maxAbs(f.rrV, F.rr_var) < 1e-10);
  check('filter: innovations (model and diagnostic) and implied RR', maxAbs(f.innovations, F.std_innov) < 1e-8 && maxAbs(f.innovations_diagnostic, F.innovations_diagnostic) < 1e-8 && maxAbs(f.irr, F.implied_rr) < 1e-10);
  check('artifact multiplier', maxAbs(f.gate_multiplier.map(Math.log1p), F.gate_multiplier.map(Math.log1p)) < 1e-9);
  const ov = E.objectiveMap(r.objective.theta, r.dy, Object.assign({}, pr, { energy_ratio: r.energy_ratio }), ctl);
  check('MAP objective at a fixed theta', Math.abs(ov - r.objective.value) < 1e-6, 'JS ' + ov.toFixed(6) + ' vs R ' + r.objective.value.toFixed(6));
  const fit = E.fitModel(r.dy), P = r.fit.params, p = fit.params;
  const kd = ['ks', 'kp', 'lR'].map(k => rel(p[k], P[k]));
  check('fit: kappa_S, kappa_P, Lambda_R', Math.max(...kd) < 2e-3, kd.map(v => v.toExponential(1)).join(' '));
  check('fit: nu0, sigma^2, jitter', rel(p.nu0, P.nu0) < 1e-3 && rel(p.sig2, P.sig2) < 2e-3 && rel(p.rr_jitter_ms, P.rr_jitter_ms) < 2e-3);
  check('fit: MAP objective and LL*', Math.abs(fit.opt.value - r.fit.objective) < 1e-3 && Math.abs(fit.LL_star - r.fit.LL_star) < 1e-2, 'dObj ' + Math.abs(fit.opt.value - r.fit.objective).toExponential(1));
  check('fit: latent states', maxAbs(fit.Xp, r.fit.X_p) < 2e-3 && maxAbs(fit.Xs, r.fit.X_s) < 2e-3, 'max |dx_p| ' + maxAbs(fit.Xp, r.fit.X_p).toExponential(1));
  const rep = E.reportModel(fit), S = r.se;
  const sd = ['ks', 'kp', 'lR'].map(k => rel(rep.se[k], num(S[k])));
  check('standard errors (delta method) within 5%', Math.max(...sd) < 0.05, sd.map(v => (100 * v).toFixed(1) + '%').join(' '));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
process.exit(fail ? 1 : 0);

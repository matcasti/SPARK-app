/* ============================================================================
   SPARK engine (M3G) -- port of 01_model_engine.R. Pure functions: no DOM, so the same file
   runs in the browser and in Node (tests/test_engine.js compares it with the R engine).

   Model: dual OU drives (x_p vagal-like, x_s sympathetic-like) -> integrate-and-fire phase.
   Estimation: concentrated (GLS) likelihood, MAP over theta = (ln ks, ln(kp-ks), ln lR, ln gamma)
   with log-normal priors on tau_p, tau_s and RR jitter, a Beta prior on the topology, a Lomax
   prior + exponential wall on gamma, a spectral anchor for V_p/V_s from a Morlet CWT, an artifact
   gate and a causal vagal variance gate. The optimizer is R's BFGS (vmmin) so fits agree with fit_model().
   ========================================================================== */
(function (root) {
'use strict';

/* ---- numerics ------------------------------------------------------------------------------ */
function fftCore(re, im, inv) {
  const N = re.length;
  for (let i = 0, j = 0; i < N; i++) {
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, wR = Math.cos(ang), wI = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cR = 1, cI = 0;
      for (let k = 0; k < (len >> 1); k++) {
        const uR = re[i + k], uI = im[i + k];
        const vR = re[i + k + (len >> 1)] * cR - im[i + k + (len >> 1)] * cI;
        const vI = re[i + k + (len >> 1)] * cI + im[i + k + (len >> 1)] * cR;
        re[i + k] = uR + vR; im[i + k] = uI + vI;
        re[i + k + (len >> 1)] = uR - vR; im[i + k + (len >> 1)] = uI - vI;
        const nR = cR * wR - cI * wI; cI = cR * wI + cI * wR; cR = nR;
      }
    }
  }
  if (inv) { for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; } }
}
const pow2 = n => 1 << Math.ceil(Math.log2(Math.max(n, 2)));
const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const mean = a => sum(a) / a.length;
const median = a => { const s = Array.from(a).sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const sd = a => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2; return Math.sqrt(s / Math.max(a.length - 1, 1)); };

/* Standard normal CDF (Marsaglia 2004, double precision) and quantile (Acklam + one Halley step) */
function pnorm(x) {
  if (x < -38) return 0; if (x > 38) return 1;
  let s = x, t = 0, b = x; const q = x * x; let i = 1;
  while (s !== t) s = (t = s) + (b *= q / (i += 2));
  return Math.min(1, Math.max(0, 0.5 + s * Math.exp(-0.5 * q - 0.91893853320467274178)));
}
function qnorm(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239],
        b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1],
        c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
        d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  let x; const lo = 0.02425, hi = 1 - lo;
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= hi) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const e = pnorm(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

/* Natural cubic spline (display, PSD) */
function makeSpline(xs, ys) {
  const n = xs.length, h = [], al = [], l = [1], mu = [0], z = [0];
  for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];
  for (let i = 1; i < n - 1; i++) al[i] = 3 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);
  for (let i = 1; i < n - 1; i++) { l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1]; mu[i] = h[i] / l[i]; z[i] = (al[i] - h[i - 1] * z[i - 1]) / l[i]; }
  l[n - 1] = 1; z[n - 1] = 0;
  const c = new Array(n).fill(0), b = [], d = [];
  for (let j = n - 2; j >= 0; j--) { c[j] = z[j] - mu[j] * c[j + 1]; b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3; d[j] = (c[j + 1] - c[j]) / (3 * h[j]); }
  return x => {
    if (x <= xs[0]) { const dx = x - xs[0]; return ys[0] + b[0] * dx + c[0] * dx * dx + d[0] * dx * dx * dx; }
    if (x >= xs[n - 1]) { const j = n - 2, dx = x - xs[j]; return ys[j] + b[j] * dx + c[j] * dx * dx + d[j] * dx * dx * dx; }
    let lo = 0, hi = n - 2; while (lo < hi) { const m = (lo + hi) >> 1; xs[m + 1] < x ? lo = m + 1 : hi = m; }
    const dx = x - xs[lo]; return ys[lo] + b[lo] * dx + c[lo] * dx * dx + d[lo] * dx * dx * dx;
  };
}

/* Monotone Hermite spline, Fritsch-Carlson (R: splinefun(method = "monoH.FC")) */
function monoSpline(xs, ys) {
  const n = xs.length, dx = [], S = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i]; S[i] = (ys[i + 1] - ys[i]) / dx[i]; }
  m[0] = S[0]; m[n - 1] = S[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (S[i - 1] + S[i]) / 2;
  for (let k = 0; k < n - 1; k++) {
    const Sk = S[k];
    if (Sk === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const alpha = m[k] / Sk, beta = m[k + 1] / Sk, a2b3 = 2 * alpha + beta - 3, ab23 = alpha + 2 * beta - 3;
    if (a2b3 > 0 && ab23 > 0 && alpha * (a2b3 + ab23) < a2b3 * a2b3) {
      const tau = 3 * Sk / Math.sqrt(alpha * alpha + beta * beta); m[k] = tau * alpha; m[k + 1] = tau * beta;
    }
  }
  return x => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let lo = 0, hi = n - 2; while (lo < hi) { const mid = (lo + hi) >> 1; xs[mid + 1] <= x ? lo = mid + 1 : hi = mid; }
    const h = dx[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h * m[lo + 1];
  };
}

/* ---- settings (spark_priors / spark_control) --------------------------------------------------- */
const DEFAULT_PRIORS = {
  tau_p_bounds: [3, 6], tau_s_bounds: [100, 300], ci_coverage: 0.95, topo_target_ratio: 20, topo_prior_weight: 10,
  jitter_bounds_ms: [0.5, 20], gamma_prior_shape: 10, gamma_prior_scale: 0.1, gamma_penalty_threshold: 1, gamma_penalty_rate: 5,
  lf_lower_hz: 0.04, lf_upper_hz: 0.15, hf_upper_hz: 0.40, crossover_hz: 0.10, sns_leakage_at_boundary: 0.05,
  lower_lf_vagal_fraction: 0.1, cwt_fs: 4
};
const DEFAULT_CONTROL = {
  jump_threshold: 0.25, jump_power: 10, lik_gate_max: 100, tau_g: 15, zmax: 3, gamma_start: 0.001, lR_start: 0.001,
  kp_gap_floor: 0.05, maxit: 1000, gate_off_threshold: 0.05, diag_gate_max: 1.5, pacf_lag_max: 40
};
const clone = o => JSON.parse(JSON.stringify(o));

function checkRange(name, x, lo, hi, openLo, openHi) {
  if (!isFinite(x) || (openLo ? x <= lo : x < lo) || (openHi ? x >= hi : x > hi)) throw new Error('Invalid setting: ' + name);
}
function checkInterval(name, x) { if (!(x.length === 2 && x[0] > 0 && x[1] > x[0])) throw new Error('Invalid interval: ' + name); }

/** spark_priors(): validated settings plus the derived constants. */
function sparkPriors(user) {
  const p = Object.assign(clone(DEFAULT_PRIORS), user || {});
  checkInterval('tau_p_bounds', p.tau_p_bounds); checkInterval('tau_s_bounds', p.tau_s_bounds); checkInterval('jitter_bounds_ms', p.jitter_bounds_ms);
  checkRange('ci_coverage', p.ci_coverage, 0, 1, true, true); checkRange('topo_target_ratio', p.topo_target_ratio, 1, Infinity, true);
  checkRange('topo_prior_weight', p.topo_prior_weight, 0, Infinity, true); checkRange('gamma_prior_shape', p.gamma_prior_shape, 0, Infinity, true);
  checkRange('gamma_prior_scale', p.gamma_prior_scale, 0, Infinity, true); checkRange('gamma_penalty_threshold', p.gamma_penalty_threshold, 0, Infinity, true);
  checkRange('gamma_penalty_rate', p.gamma_penalty_rate, 0, Infinity, true); checkRange('sns_leakage_at_boundary', p.sns_leakage_at_boundary, 0, 0.5, true, true);
  checkRange('lower_lf_vagal_fraction', p.lower_lf_vagal_fraction, 0, 1, false, true); checkRange('cwt_fs', p.cwt_fs, 0, Infinity, true);
  if (!(p.lf_lower_hz > 0 && p.lf_lower_hz < p.crossover_hz && p.crossover_hz < p.lf_upper_hz && p.lf_upper_hz < p.hf_upper_hz))
    throw new Error('Spectral bands must satisfy 0 < lf_lower < crossover < lf_upper < hf_upper.');
  const z = qnorm((p.ci_coverage + 1) / 2), lg = x => Math.log(x);
  p.log_tau_p_mu = (lg(p.tau_p_bounds[0]) + lg(p.tau_p_bounds[1])) / 2; p.sigma_log_tau_p = (lg(p.tau_p_bounds[1]) - lg(p.tau_p_bounds[0])) / (2 * z);
  p.log_tau_s_mu = (lg(p.tau_s_bounds[0]) + lg(p.tau_s_bounds[1])) / 2; p.sigma_log_tau_s = (lg(p.tau_s_bounds[1]) - lg(p.tau_s_bounds[0])) / (2 * z);
  const jb = p.jitter_bounds_ms.map(v => v / 1000);
  p.log_jit_mu = (lg(jb[0]) + lg(jb[1])) / 2; p.sigma_log_jit = (lg(jb[1]) - lg(jb[0])) / (2 * z);
  const Umode = (p.topo_target_ratio - 1) / (p.topo_target_ratio + 1);
  p.alpha_minus_1 = Umode * p.topo_prior_weight; p.beta_minus_1 = (1 - Umode) * p.topo_prior_weight;
  p.gamma_slope0 = (p.gamma_prior_shape + 1) / p.gamma_prior_scale;
  p.spectral_slope = -Math.log(p.sns_leakage_at_boundary / (1 - p.sns_leakage_at_boundary)) / (p.lf_upper_hz - p.crossover_hz);
  p.ks_mode = 1 / Math.exp(p.log_tau_s_mu); p.kp_mode = 1 / Math.exp(p.log_tau_p_mu);
  return p;
}
function sparkControl(user) {
  const c = Object.assign(clone(DEFAULT_CONTROL), user || {});
  ['jump_threshold', 'jump_power', 'tau_g', 'zmax', 'gamma_start', 'lR_start', 'kp_gap_floor'].forEach(k => checkRange(k, c[k], 0, Infinity, true));
  checkRange('lik_gate_max', c.lik_gate_max, 1, Infinity); checkRange('maxit', c.maxit, 1, Infinity); checkRange('gate_off_threshold', c.gate_off_threshold, 0, Infinity);
  checkRange('diag_gate_max', c.diag_gate_max, 1, Infinity); checkRange('pacf_lag_max', c.pacf_lag_max, 1, Infinity);
  c.pacf_lag_max = Math.floor(c.pacf_lag_max);
  return c;
}

/* ---- Morlet CWT as in biwavelet::wt (dj = 1/12, s0 = 2 dt, zero padding, cone of influence) ----------- */
/** @return {power: Float32Array[] (one row per scale, n columns), period, scale, coi (per column), freqs, dt} */
function biwaveletMorlet(x0, dt, opts) {
  const dj = (opts && opts.dj) || 1 / 12, s0 = 2 * dt, k0 = 6, nObs = x0.length;
  const mu = mean(x0), maxScale = nObs * 0.34 * dt, J1 = Math.round(Math.log2(maxScale / s0) / dj);
  const n = Math.pow(2, Math.ceil(Math.log2(nObs) + 1));
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < nObs; i++) re[i] = x0[i] - mu;
  fftCore(re, im, false);
  const k = new Float64Array(n), half = Math.floor(0.5 * n), k1 = 2 * Math.PI / (n * dt);
  for (let i = 1; i <= half; i++) k[i] = i * k1;
  for (let j = 0; j < Math.floor(0.5 * (n - 1)); j++) k[n - 1 - j] = -(j + 1) * k1;
  const ff = 4 * Math.PI / (k0 + Math.sqrt(2 + k0 * k0)), coiUnit = ff / Math.SQRT2;
  const power = [], scales = [], periods = [];
  const wR = new Float64Array(n), wI = new Float64Array(n);
  for (let a = 0; a <= J1; a++) {
    const s = s0 * Math.pow(2, a * dj), norm = Math.sqrt(s * k[1]) * Math.pow(Math.PI, -0.25) * Math.sqrt(n);
    wR.fill(0); wI.fill(0);
    for (let i = 0; i < n; i++) if (k[i] > 0) { const dd = norm * Math.exp(-((s * k[i] - k0) ** 2) / 2); wR[i] = re[i] * dd; wI[i] = im[i] * dd; }
    fftCore(wR, wI, true);                                  // inverse FFT scaled by 1/n (= invflen)
    const row = new Float32Array(nObs);
    for (let t = 0; t < nObs; t++) row[t] = wR[t] * wR[t] + wI[t] * wI[t];
    power.push(row); scales.push(s); periods.push(ff * s);
  }
  const coi = new Float64Array(nObs), nHalf = Math.floor(0.5 * (nObs + 1)) - 1;
  const mult = [1e-5]; for (let i = 1; i <= nHalf; i++) mult.push(i);
  for (let i = Math.floor(0.5 * nObs - 1); i >= 1; i--) mult.push(i); mult.push(1e-5);
  for (let t = 0; t < nObs; t++) coi[t] = coiUnit * dt * (mult[t] !== undefined ? mult[t] : 1e-5);
  return { power, period: periods, scale: scales, coi, freqs: periods.map(p => 1 / p), dt, N: nObs };
}

/** HR (Hz) on a regular grid (monotone spline), as used by the spectral prior and the scalogram. */
function hrGrid(dy, fs) {
  const t = []; let acc = 0; for (let i = 0; i < dy.length; i++) { acc += dy[i]; t.push(acc); }
  const hr = Array.from(dy, d => 1 / d), sp = monoSpline(t, hr), n = Math.floor((t[t.length - 1] - t[0]) * fs + 1e-9) + 1;
  const grid = new Float64Array(n); for (let i = 0; i < n; i++) grid[i] = sp(t[0] + i / fs);
  return { grid, t0: t[0], time: t, hr };
}

/** extract_spectral_priors(): V_p/V_s from a logistic vagal/sympathetic partition of the global CWT power. */
function extractSpectralPriors(dy, priors) {
  const fs = priors.cwt_fs, g = hrGrid(dy, fs), mu = mean(g.grid), x = Float64Array.from(g.grid, v => v - mu);
  const w = biwaveletMorlet(x, 1 / fs), nS = w.period.length, nT = w.N;
  const gp = new Float64Array(nS);
  for (let s = 0; s < nS; s++) { let acc = 0, cnt = 0; for (let t = 0; t < nT; t++) if (w.period[s] <= w.coi[t]) { acc += w.power[s][t]; cnt++; } gp[s] = cnt ? acc / cnt : NaN; }
  const ord = Array.from({ length: nS }, (_, i) => i).sort((a, b) => w.freqs[a] - w.freqs[b]);
  const f = ord.map(i => w.freqs[i]), pw = ord.map(i => gp[i]);
  const trapz = (xs, ys) => { let s = 0; for (let i = 0; i < xs.length - 1; i++) s += (xs[i + 1] - xs[i]) * (ys[i + 1] + ys[i]) / 2; return s; };
  const L = f.map(v => 1 / (1 + Math.exp(-priors.spectral_slope * (v - priors.crossover_hz))));
  const lv = priors.lower_lf_vagal_fraction, wV = L.map(l => lv + (1 - lv) * l), wS = L.map(l => (1 - lv) * (1 - l));
  const idx = f.map((v, i) => i).filter(i => f[i] >= priors.lf_lower_hz && f[i] <= priors.hf_upper_hz && isFinite(pw[i]));
  const sel = a => idx.map(i => a[i]);
  const vagal = trapz(sel(f), idx.map(i => wV[i] * pw[i])), symp = trapz(sel(f), idx.map(i => wS[i] * pw[i]));
  const lfI = f.map((v, i) => i).filter(i => f[i] >= priors.lf_lower_hz && f[i] < priors.lf_upper_hz && isFinite(pw[i]));
  const hfI = f.map((v, i) => i).filter(i => f[i] >= priors.lf_upper_hz && f[i] <= priors.hf_upper_hz && isFinite(pw[i]));
  const out = Object.assign({}, priors);
  out.nu0_init = mean(g.hr); out.energy_ratio = vagal / symp;
  out.p_lf = trapz(lfI.map(i => f[i]), lfI.map(i => pw[i])); out.p_hf = trapz(hfI.map(i => f[i]), hfI.map(i => pw[i]));
  out.partition = { freq: f, power: pw, w_vagal: wV, w_symp: wS, vagal_energy: vagal, symp_energy: symp };
  if (!(isFinite(out.energy_ratio) && out.energy_ratio > 0)) throw new Error('Spectral prior failed (series too short or flat).');
  return out;
}

/* ---- OU integrals and the filter -------------------------------------------------------------------- */
function ouBlock(k, dt, V, out) {
  const x = k * dt, s2 = 2 * k * V;
  if (x < 1e-3) {
    const d2 = dt * dt, d3 = d2 * dt, d4 = d3 * dt, d5 = d4 * dt;
    out.phi = dt - k * d2 / 2 + k * k * d3 / 6; out.q11 = s2 * (dt - k * d2 + 2 * k * k * d3 / 3);
    out.q13 = s2 * (d2 / 2 - k * d3 / 2 + 7 * k * k * d4 / 24); out.q33 = s2 * (d3 / 3 - k * d4 / 4 + 7 * k * k * d5 / 60);
  } else {
    const e1 = Math.exp(-x), e2 = Math.exp(-2 * x);
    out.phi = (1 - e1) / k; out.q11 = s2 * (1 - e2) / (2 * k); out.q13 = s2 * (1 - 2 * e1 + e2) / (2 * k * k);
    out.q33 = s2 * (2 * x - 3 + 4 * e1 - e2) / (2 * k * k * k);
  }
  return out;
}

/** Artifact gate multiplier 1 + (J / threshold)^power, J = largest relative RR jump at the beat. */
function artifactGate(dy, ctl) {
  const N = dy.length, g = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const back = k > 0 ? Math.abs(dy[k] - dy[k - 1]) / Math.max(dy[k - 1], 1e-6) : 0;
    const fwd = k < N - 1 ? Math.abs(dy[k + 1] - dy[k]) / Math.max(dy[k], 1e-6) : 0;
    let m = Math.min(1 + Math.pow(Math.max(back, fwd) / ctl.jump_threshold, ctl.jump_power), 1e10);
    if (!isFinite(m)) m = 1e10; g[k] = m;
  }
  return g;
}

/* One causal pass. State per beat: X0 = (x_p, x_s, phase_p, phase_s), Xv = same for the nu0 sensitivity. After each beat the
   phases reset to 0, so only the 2x2 block of (x_p, x_s) carries over and the covariance update is P - r r'/S (Joseph form). */
function glsPass(dy, kp, ks, lp, lR, gam, nuPlug, sdP, ctl, gm) {
  const N = dy.length, hp = {}, hs = {}, bp = {}, hq = {};
  const S = new Float64Array(N), Sun = new Float64Array(N), v0 = new Float64Array(N), vv = new Float64Array(N), gain = new Float64Array(N).fill(1);
  const X0s = new Float64Array(N * 4), Xvs = new Float64Array(N * 4), Pst = new Float64Array(N * 5);   // [P11, P22, P33, P44, P34] (1-indexed)
  let x0p = 0, x0s = 0, xvp = 0, xvs = 0, u = lp, w = 0, v = 1, mlp = 0;
  const a = (dt) => Math.exp(-kp * dt), b = (dt) => Math.exp(-ks * dt);
  for (let k = 0; k < N; k++) {
    const dt = dy[k], dynLR = Math.min(lR * gm[k], 1e12);
    ouBlock(ks, dt, 1.0, hs); ouBlock(kp, dt, 1.0, hq);
    const A = a(dt), B = b(dt), C = hq.phi, D = hs.phi;
    const X0pp = A * x0p, X0ps = B * x0s, Xvpp = A * xvp, Xvps = B * xvs;     // predicted x_p, x_s
    let g = 1;
    if (gam > 0) {
      const ae = Math.exp(-dt / ctl.tau_g);
      mlp = ae * mlp + (1 - ae) * (X0pp - nuPlug * Xvpp);
      g = Math.exp(Math.max(Math.min(gam * mlp / sdP, ctl.zmax), -ctl.zmax));
    }
    gain[k] = g;
    ouBlock(kp, dt, lp * g, bp);
    // predicted covariance (4x4, symmetric): indices 0=x_p 1=x_s 2=phase_p 3=phase_s
    const P00 = A * A * u + bp.q11, P01 = A * B * w, P02 = A * C * u + bp.q13, P03 = A * D * w;
    const P11 = B * B * v + hs.q11, P12 = B * C * w, P13 = B * D * v + hs.q13;
    const P22 = C * C * u + bp.q33, P23 = C * D * w, P33 = D * D * v + hs.q33;
    // H = [0, 0, -1, 1]:  r = P H'
    const r0 = -P02 + P03, r1 = -P12 + P13, r2 = -P22 + P23, r3 = -P23 + P33;
    const HPH = P22 - 2 * P23 + P33;
    const Sk = Math.max(HPH + dynLR * dt, 1e-12);
    Sun[k] = Math.max(HPH + lR * dt, 1e-12);
    const X0pred = [X0pp, X0ps, C * x0p, D * x0s], Xvpred = [Xvpp, Xvps, C * xvp, D * xvs];
    const v0k = 1.0 - (-X0pred[2] + X0pred[3]), vvk = dt - (-Xvpred[2] + Xvpred[3]);
    const Kk = [r0 / Sk, r1 / Sk, r2 / Sk, r3 / Sk];
    for (let i = 0; i < 4; i++) { X0s[k * 4 + i] = X0pred[i] + Kk[i] * v0k; Xvs[k * 4 + i] = Xvpred[i] + Kk[i] * vvk; }
    const Pn = (i, j, Pij, ri, rj) => Pij - ri * rj / Sk;
    const n00 = Pn(0, 0, P00, r0, r0), n01 = Pn(0, 1, P01, r0, r1), n11 = Pn(1, 1, P11, r1, r1);
    Pst[k * 5] = n00; Pst[k * 5 + 1] = n11; Pst[k * 5 + 2] = Pn(2, 2, P22, r2, r2); Pst[k * 5 + 3] = Pn(3, 3, P33, r3, r3); Pst[k * 5 + 4] = Pn(2, 3, P23, r2, r3);
    // phase reset
    x0p = X0s[k * 4]; x0s = X0s[k * 4 + 1]; xvp = Xvs[k * 4]; xvs = Xvs[k * 4 + 1]; u = n00; w = n01; v = n11;
    S[k] = Sk; v0[k] = v0k; vv[k] = vvk;
  }
  let den = 0, num = 0;
  for (let k = 0; k < N; k++) if (isFinite(vv[k]) && isFinite(S[k]) && S[k] > 0) { den += vv[k] * vv[k] / S[k]; num += v0[k] * vv[k] / S[k]; }
  const nu0 = den > 1e-12 && isFinite(den) ? num / den : 0;
  return { S, Sun, v0, vv, X0s, Xvs, Pst, gain, nu0, den };
}

/** run_gls_filter(): returns LL_star, nu0, sig2, states (x_p, x_s, variances), innovations, implied RR, gate multiplier and vagal gain. */
function runGLSFilter(dy, kp, ks, lp, lR, gamma, control) {
  const ctl = control || sparkControl(), N = dy.length, gm = artifactGate(dy, ctl);
  const sig2Of = r => {
    const ok = []; let nOk = 0; for (let k = 0; k < N; k++) { const o = gm[k] < ctl.lik_gate_max; ok.push(o); if (o) nOk++; }
    const useAll = nOk < 2; let s = 0, n = 0;
    for (let k = 0; k < N; k++) if (useAll || ok[k]) { const v = r.v0[k] - r.nu0 * r.vv[k]; s += v * v / r.S[k]; n++; }
    return Math.max(s / n, 1e-12);
  };
  let res = glsPass(dy, kp, ks, lp, lR, 0, 0, 0, ctl, gm);
  if (gamma > 1e-6 && isFinite(res.nu0) && res.nu0 > 0) {
    const sdP = Math.sqrt(lp * sig2Of(res));
    res = glsPass(dy, kp, ks, lp, lR, gamma, res.nu0, sdP, ctl, gm);
  }
  if (!isFinite(res.nu0) || res.nu0 <= 0) return { LL_star: -Infinity, nu0: NaN, sig2: NaN, gate_multiplier: gm, ok: false };
  let nEff = 0; const ok = new Array(N);
  for (let k = 0; k < N; k++) { ok[k] = gm[k] < ctl.lik_gate_max; if (ok[k]) nEff++; }
  const useAll = nEff < 2; if (useAll) { nEff = N; ok.fill(true); }
  const vF = new Float64Array(N); let sv = 0, sl = 0;
  for (let k = 0; k < N; k++) { vF[k] = res.v0[k] - res.nu0 * res.vv[k]; if (ok[k]) { sv += vF[k] * vF[k] / res.S[k]; sl += Math.log(res.S[k]); } }
  const sig2 = Math.max(sv / nEff, 1e-12), LL = -0.5 * sl - (nEff / 2) * Math.log(sig2);
  const invDen = res.den > 1e-12 && isFinite(res.den) ? 1 / res.den : NaN;
  const Xp = new Float64Array(N), Xs = new Float64Array(N), XpV = new Float64Array(N), XsV = new Float64Array(N), rrV = new Float64Array(N);
  const irr = new Float64Array(N), zs = new Float64Array(N), zd = new Float64Array(N), tres = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const q = k * 4, st = [res.X0s[q] - res.nu0 * res.Xvs[q], res.X0s[q + 1] - res.nu0 * res.Xvs[q + 1], res.X0s[q + 2] - res.nu0 * res.Xvs[q + 2], res.X0s[q + 3] - res.nu0 * res.Xvs[q + 3]];
    Xp[k] = st[0]; Xs[k] = st[1];
    XpV[k] = (res.Pst[k * 5] + res.Xvs[q] * res.Xvs[q] * invDen) * sig2;
    XsV[k] = (res.Pst[k * 5 + 1] + res.Xvs[q + 1] * res.Xvs[q + 1] * invDen) * sig2;
    rrV[k] = (res.Pst[k * 5 + 2] + res.Pst[k * 5 + 3] - 2 * res.Pst[k * 5 + 4]) * sig2 / (res.nu0 * res.nu0);
    zs[k] = vF[k] / Math.sqrt(res.S[k] * sig2); zd[k] = vF[k] / Math.sqrt(res.Sun[k] * sig2);
    irr[k] = (1 + st[2] - st[3]) / res.nu0; tres[k] = dy[k] - irr[k];
  }
  return { ok: true, LL_star: LL, nu0: res.nu0, sig2, Xp, Xs, XpV, XsV, rrV, irr, innovations: zs, innovations_diagnostic: zd,
           time_residuals: tres, gate_multiplier: gm, gain: res.gain };
}

/* ---- MAP objective, optimizer, fit -------------------------------------------------------------------- */
const thetaToPar = th => { const ks = Math.exp(th[0]); return { ks, kp: ks + Math.exp(th[1]), lR: Math.exp(th[2]), gamma: Math.exp(th[3]) }; };
const parToTheta = p => [Math.log(p.ks), Math.log(p.kp - p.ks), Math.log(p.lR), Math.log(Math.max(p.gamma, 1e-12))];

/** .log_prior_terms(): one term per prior, up to constants. */
function logPriorTerms(par, res, dy, pr) {
  const tauS = 1 / par.ks, tauP = 1 / par.kp;
  const tS = -0.5 * ((Math.log(tauS) - pr.log_tau_s_mu) / pr.sigma_log_tau_s) ** 2, tP = -0.5 * ((Math.log(tauP) - pr.log_tau_p_mu) / pr.sigma_log_tau_p) ** 2;
  const U = (par.kp - par.ks) / (par.kp + par.ks), OneU = 2 * par.ks / (par.kp + par.ks);
  const topo = pr.alpha_minus_1 * Math.log(U) + pr.beta_minus_1 * Math.log(OneU);
  const sRR = Math.sqrt(res.sig2 * par.lR * median(dy)) / res.nu0;
  const lRt = -0.5 * ((Math.log(sRR) - pr.log_jit_mu) / pr.sigma_log_jit) ** 2;
  let gt = -(pr.gamma_prior_shape + 1) * Math.log1p(par.gamma / pr.gamma_prior_scale);
  gt -= Math.expm1(Math.min(pr.gamma_penalty_rate * Math.max(par.gamma - pr.gamma_penalty_threshold, 0), 30));
  return { tau_s: tS, tau_p: tP, topology: topo, lR: lRt, gamma: gt };
}
/** objective_map_4d(): negative log-posterior (1e12 when not finite). */
function objectiveMap(theta, dy, pr, ctl) {
  const par = thetaToPar(theta), res = runGLSFilter(dy, par.kp, par.ks, pr.energy_ratio, par.lR, par.gamma, ctl);
  if (!res.ok) return 1e12;
  const pen = logPriorTerms(par, res, dy, pr), val = -(res.LL_star + pen.tau_s + pen.tau_p + pen.topology + pen.lR + pen.gamma);
  return isFinite(val) ? val : 1e12;
}

/** R's optim(method = "BFGS") (vmmin) with its default central-difference gradient (ndeps = 1e-3). */
function bfgsR(fn, x0, maxit) {
  const n = x0.length, stepredn = 0.2, acctol = 1e-4, reltest = 10, reltol = Math.sqrt(2.220446049250313e-16), ndeps = 1e-3;
  const grad = (p, out) => { const x = p.slice(); for (let i = 0; i < n; i++) { x[i] = p[i] + ndeps; const v1 = fn(x); x[i] = p[i] - ndeps; const v2 = fn(x); out[i] = (v1 - v2) / (2 * ndeps); x[i] = p[i]; } };
  const b = x0.slice(), g = new Array(n).fill(0), t = new Array(n).fill(0), X = new Array(n).fill(0), c = new Array(n).fill(0);
  const B = Array.from({ length: n }, () => new Array(n).fill(0));
  let f = fn(b); if (!isFinite(f)) throw new Error('Initial value is not finite.');
  let Fmin = f, funcount = 1, gradcount = 1, iter = 0, ilast, count = 0, fail = 1;
  grad(b, g); iter++; ilast = gradcount;
  do {
    if (ilast === gradcount) for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) B[i][j] = 0; B[i][i] = 1; }
    for (let i = 0; i < n; i++) { X[i] = b[i]; c[i] = g[i]; }
    let gradproj = 0;
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j <= i; j++) s -= B[i][j] * g[j]; for (let j = i + 1; j < n; j++) s -= B[j][i] * g[j]; t[i] = s; gradproj += s * g[i]; }
    if (gradproj < 0) {
      let steplength = 1, accpoint = false;
      do {
        count = 0;
        for (let i = 0; i < n; i++) { b[i] = X[i] + steplength * t[i]; if (reltest + X[i] === reltest + b[i]) count++; }
        if (count < n) { f = fn(b); funcount++; accpoint = isFinite(f) && f <= Fmin + gradproj * steplength * acctol; if (!accpoint) steplength *= stepredn; }
      } while (!(count === n || accpoint));
      const enough = (f > -Infinity) && Math.abs(f - Fmin) > reltol * (Math.abs(Fmin) + reltol);
      if (!enough) { count = n; Fmin = f; }
      if (count < n) {
        Fmin = f; grad(b, g); gradcount++; iter++;
        let D1 = 0; for (let i = 0; i < n; i++) { t[i] = steplength * t[i]; c[i] = g[i] - c[i]; D1 += t[i] * c[i]; }
        if (D1 > 0) {
          let D2 = 0;
          for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j <= i; j++) s += B[i][j] * c[j]; for (let j = i + 1; j < n; j++) s += B[j][i] * c[j]; X[i] = s; D2 += s * c[i]; }
          D2 = 1 + D2 / D1;
          for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) B[i][j] += (D2 * t[i] * t[j] - X[i] * t[j] - t[i] * X[j]) / D1;
        } else ilast = gradcount;
      } else if (ilast < gradcount) { count = 0; ilast = gradcount; }
    } else { count = 0; if (ilast === gradcount) count = n; else ilast = gradcount; }
    if (iter >= maxit) break;
    if (gradcount - ilast > 2 * n) ilast = gradcount;
  } while (count !== n || ilast !== gradcount);
  fail = iter < maxit ? 0 : 1;
  return { par: b, value: Fmin, counts: [funcount, gradcount], convergence: fail };
}

/** fit_model(): MAP fit from a single start. @return {params, states, ..., priors, control} */
function fitModel(dyIn, priorsIn, controlIn, onProgress) {
  const dy = Array.from(dyIn).filter(v => isFinite(v)), ctl = controlIn || sparkControl();
  const pr = extractSpectralPriors(dy, priorsIn || sparkPriors());
  if (onProgress) onProgress('Spectral anchor done (V_p/V_s = ' + pr.energy_ratio.toFixed(4) + ')', 0.2);
  return fitFromAnchor(dy, pr, ctl);
}
/** The optimization part of fit_model(), given the spectral prior (lets the UI show progress between stages). */
function fitFromAnchor(dy, pr, ctl) {
  const theta0 = [Math.log(pr.ks_mode), Math.log(Math.max(pr.kp_mode - pr.ks_mode, ctl.kp_gap_floor)), Math.log(ctl.lR_start), Math.log(ctl.gamma_start)];
  const opt = bfgsR(th => objectiveMap(th, dy, pr, ctl), theta0, ctl.maxit);
  if (!isFinite(opt.value)) throw new Error('Optimization failed.');
  return assembleFit(dy, pr, ctl, thetaToPar(opt.par), opt);
}

/** Final pass at given parameters (also used by the playground). */
function assembleFit(dy, pr, ctl, par, opt) {
  const Vp = pr.energy_ratio, r = runGLSFilter(dy, par.kp, par.ks, Vp, par.lR, par.gamma, ctl);
  if (!r.ok) throw new Error('Filter failed (non-positive nu0).');
  const time = []; let acc = 0; for (let i = 0; i < dy.length; i++) { acc += dy[i]; time.push(acc); }
  const medDy = median(dy);
  const params = { ks: par.ks, kp: par.kp, lR: par.lR, lp: Vp, gamma: par.gamma, gate_off: par.gamma < ctl.gate_off_threshold, nu0: r.nu0, sig2: r.sig2,
                   sigP: Math.sqrt(2 * par.kp * Vp * r.sig2), sigS: Math.sqrt(2 * par.ks * r.sig2), rr_jitter_ms: 1000 * Math.sqrt(r.sig2 * par.lR * medDy) / r.nu0 };
  return { model: 'M3G', dy, time, pr, ctl, params, LL_star: r.LL_star, gain: r.gain, Xp: r.Xp, Xs: r.Xs, XpV: r.XpV, XsV: r.XsV, rrV: r.rrV,
           irr: r.irr, innovations: r.innovations, innovations_diagnostic: r.innovations_diagnostic, time_residuals: r.time_residuals,
           gate: r.gate_multiplier, opt: opt || null };
}
/** Manual run for the playground: given parameters, no optimization. */
function runManualFit(dy, pr, ctl, par) { return assembleFit(Array.from(dy), pr, ctl, par, null); }

/* ---- Hessian, standard errors, Laplace posterior --------------------------------------------------------- */
function numHessian(f, x, h0) {
  const n = x.length, H = Array.from({ length: n }, () => new Array(n).fill(0)), f0 = f(x);
  const h = x.map(v => (h0 || 1e-3) * Math.max(Math.abs(v), 0.1));
  for (let i = 0; i < n; i++) {
    const xp = x.slice(), xm = x.slice(); xp[i] += h[i]; xm[i] -= h[i];
    H[i][i] = (f(xp) - 2 * f0 + f(xm)) / (h[i] * h[i]);
    for (let j = 0; j < i; j++) {
      const a = x.slice(), b = x.slice(), c = x.slice(), d = x.slice();
      a[i] += h[i]; a[j] += h[j]; b[i] += h[i]; b[j] -= h[j]; c[i] -= h[i]; c[j] += h[j]; d[i] -= h[i]; d[j] -= h[j];
      H[i][j] = H[j][i] = (f(a) - f(b) - f(c) + f(d)) / (4 * h[i] * h[j]);
    }
  }
  return H;
}
/** Symmetric eigendecomposition (Jacobi) and pseudo-inverse (MASS::ginv). */
function eigenSym(A) {
  const n = A.length, V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0)), M = A.map(r => r.slice());
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) off += M[i][j] ** 2; if (off < 1e-22) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(M[p][q]) < 1e-300) continue;
      const th = (M[q][q] - M[p][p]) / (2 * M[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = M[k][p], kq = M[k][q]; M[k][p] = c * kp - s * kq; M[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = M[p][k], qk = M[q][k]; M[p][k] = c * pk - s * qk; M[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const vp = V[k][p], vq = V[k][q]; V[k][p] = c * vp - s * vq; V[k][q] = s * vp + c * vq; }
    }
  }
  return { values: M.map((r, i) => r[i]), vectors: V };
}
function pinv(A) {
  const n = A.length, sym = A.map((r, i) => r.map((v, j) => (v + A[j][i]) / 2)), e = eigenSym(sym), mx = Math.max(...e.values.map(Math.abs)), tol = Math.sqrt(2.220446049250313e-16) * mx;
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let k = 0; k < n; k++) if (Math.abs(e.values[k]) > tol) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) P[i][j] += e.vectors[i][k] * e.vectors[j][k] / e.values[k];
  return P;
}
/** report_model(): delta-method SEs from the numerical Hessian of the MAP objective. Also returns the theta covariance and the Laplace sd of ln tau. */
function reportModel(fit) {
  const p = fit.params, theta = parToTheta(p), f = th => objectiveMap(th, fit.dy, fit.pr, fit.ctl);
  const H = numHessian(f, theta), invH = pinv(H), J = [[p.ks, 0, 0, 0], [p.ks, p.kp - p.ks, 0, 0], [0, 0, p.lR, 0], [0, 0, 0, p.gamma]];
  const cov = J.map((row, i) => J.map((row2, j) => { let s = 0; for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) s += row[a] * invH[a][b] * row2[b]; return s; }));
  const se = i => Math.sqrt(Math.max(cov[i][i], 0));
  const seKs = se(0), seKp = se(1), seLR = se(2), seGm = p.gate_off ? NaN : se(3);
  const jt = [[-1, 0, 0, 0], [-p.ks / p.kp, -(p.kp - p.ks) / p.kp, 0, 0]];             // d(ln tau_s, ln tau_p)/d(theta)
  const lnTauCov = jt.map(r1 => jt.map(r2 => { let s = 0; for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) s += r1[a] * invH[a][b] * r2[b]; return s; }));
  const ev = eigenSym(H.map((r, i) => r.map((v, j) => (v + H[j][i]) / 2))).values;
  return { se: { ks: seKs, kp: seKp, lR: seLR, gamma: seGm, tau_s: Math.sqrt(Math.max(cov[0][0] / p.ks ** 4, 0)), tau_p: Math.sqrt(Math.max(cov[1][1] / p.kp ** 4, 0)) },
           hessian: H, thetaCov: invH, physCov: cov, lnTauCov, sd_ln_tau_s: Math.sqrt(Math.max(lnTauCov[0][0], 0)), sd_ln_tau_p: Math.sqrt(Math.max(lnTauCov[1][1], 0)),
           min_eig: Math.min(...ev), max_eig: Math.max(...ev) };
}

/* ---- diagnostics -------------------------------------------------------------------------------------------- */
/** PACF by Durbin-Levinson (lags 1..maxLag). */
function pacf(series, maxLag) {
  const N = series.length, m = mean(series), c = Array.from(series, x => x - m); let v = 0; for (const x of c) v += x * x; v /= N;
  if (v < 1e-14) return new Array(maxLag).fill(0);
  const acf = [1]; for (let k = 1; k <= maxLag; k++) { let s = 0; for (let t = k; t < N; t++) s += c[t] * c[t - k]; acf.push(s / (N * v)); }
  const out = [acf[1]]; let phi = [0, acf[1]];
  for (let k = 2; k <= maxLag; k++) {
    let num = acf[k], den = 1; for (let j = 1; j < k; j++) { num -= phi[j] * acf[k - j]; den -= phi[j] * acf[j]; }
    const pk = Math.abs(den) > 1e-14 ? num / den : 0, np = new Array(k + 1).fill(0); np[k] = pk;
    for (let j = 1; j < k; j++) np[j] = phi[j] - pk * phi[k - j]; phi = np; out.push(pk);
  }
  return out;
}
function acf(series, maxLag) {
  const N = series.length, m = mean(series), c = Array.from(series, x => x - m); let v = 0; for (const x of c) v += x * x; v /= N;
  const out = []; for (let k = 1; k <= maxLag; k++) { let s = 0; for (let t = k; t < N; t++) s += c[t] * c[t - k]; out.push(v > 0 ? s / (N * v) : 0); }
  return out;
}
/** Kolmogorov-Smirnov distance and asymptotic p-value of Uniform(0,1). */
function ksUniform(u) {
  const N = u.length, s = Array.from(u).sort((a, b) => a - b); let D = 0;
  for (let i = 0; i < N; i++) D = Math.max(D, (i + 1) / N - s[i], s[i] - i / N);
  const lam = (Math.sqrt(N) + 0.12 + 0.11 / Math.sqrt(N)) * D; let p = 0;
  for (let j = 1; j <= 100; j++) p += 2 * Math.pow(-1, j - 1) * Math.exp(-2 * j * j * lam * lam);
  return { D, p: Math.max(0, Math.min(1, p)), u: s, N };
}
/** .innovation_diagnostics(): finite innovations of beats with artifact multiplier < diag_gate_max. */
function innovationDiagnostics(fit) {
  const ctl = fit.ctl, z = [], keep = [];
  for (let i = 0; i < fit.dy.length; i++) if (isFinite(fit.innovations_diagnostic[i]) && fit.gate[i] < ctl.diag_gate_max) { z.push(fit.innovations_diagnostic[i]); keep.push(i); }
  const N = z.length; if (N < 10) return null;
  const U = z.map(pnorm), ks = ksUniform(U), lagMax = Math.min(ctl.pacf_lag_max, Math.max(1, N - 5)), pa = pacf(z, lagMax), band = qnorm(0.975) / Math.sqrt(N);
  return { z, U, keep, N, N_total: fit.dy.length, ks, ks_bound: 1.36 / Math.sqrt(N), pacf: pa, acf: acf(z, lagMax), pacf_band: band, pacf_violations: pa.filter(v => Math.abs(v) > band).length,
           skew: z.reduce((s, v) => s + v ** 3, 0) / N, kurt: z.reduce((s, v) => s + v ** 4, 0) / N - 3 };
}

/* ---- derived metrics, HRV comparators and extra statistics ------------------------------------------------ */
function derivedMetrics(fit) {
  const { Xp, Xs, irr, dy, gate, params } = fit, N = irr.length;
  const VPs = params.lp * params.sig2, VSs = params.sig2, sdP = Math.sqrt(VPs), sdS = Math.sqrt(VSs);
  const fP = Array.from(Xp, x => 0.5 + Math.atan(x / sdP) / Math.PI), fS = Array.from(Xs, x => 0.5 + Math.atan(x / sdS) / Math.PI);
  let prev = 0; const abi = fP.map((v, i) => { const raw = Math.log(v / fS[i]); if (i === 0) prev = raw; prev = 0.1 * raw + 0.9 * prev; return prev; });
  const mABI = mean(abi), abiStd = Math.sqrt(abi.reduce((s, v) => s + (v - mABI) ** 2, 0) / N);
  const tad = Array.from(Xp, (x, i) => Math.sqrt(x * x + Xs[i] * Xs[i]));
  let rf = 0, ro = 0; for (let i = 1; i < N; i++) { rf += (irr[i] - irr[i - 1]) ** 2; ro += (dy[i] - dy[i - 1]) ** 2; }
  const rmssdFlt = 1000 * Math.sqrt(rf / (N - 1)), rmssdObs = 1000 * Math.sqrt(ro / (N - 1)), mIrr = mean(irr);
  const sdnnFlt = 1000 * Math.sqrt(irr.reduce((a, b) => a + (b - mIrr) ** 2, 0) / N);
  let r2 = 0, m2 = 0; for (let i = 0; i < N; i++) { r2 += (dy[i] - irr[i]) ** 2; m2 += Math.abs((dy[i] - irr[i]) / Math.max(dy[i], 1e-6)); }
  const nGated = Array.from(gate).filter(g => g > fit.ctl.diag_gate_max).length;
  const epr = Array.from(Xp, (x, i) => params.kp * (x * x / VPs - 1) + params.ks * (Xs[i] * Xs[i] / VSs - 1));
  for (let i = 1; i < N; i++) epr[i] = 0.1 * epr[i] + 0.9 * epr[i - 1];
  const arealVel = [0]; for (let i = 0; i < N - 1; i++) arealVel.push(0.5 * (Xp[i] * Xs[i + 1] - Xp[i + 1] * Xs[i]) / Math.max(dy[i], 1e-6));
  for (let i = 1; i < N; i++) arealVel[i] = 0.005 * arealVel[i] + 0.995 * arealVel[i - 1];
  const gmin = Math.min(...fit.gain), gmax = Math.max(...fit.gain);
  return { abi, tad, rmssdFlt, rmssdObs, sdnnFlt, mABI, abiStd, nGated, pctGated: 100 * nGated / N, rmse: 1000 * Math.sqrt(r2 / N), mape: 100 * m2 / N,
           epr, mEPR: mean(epr), arealVel, mArealVel: mean(arealVel), rmsArealVel: Math.sqrt(arealVel.reduce((s, v) => s + v * v, 0) / N), gainMin: gmin, gainMax: gmax,
           gainMean: mean(fit.gain), sdP_ss: sdP, sdS_ss: sdS };
}

/** Conventional HRV statistics of an RR series (s): mean HR, SDNN, RMSSD, pNN50, and LF/HF from the tachogram periodogram. */
function hrvStats(rr, priors) {
  const N = rr.length, m = mean(rr); let sq = 0, nn50 = 0, ds = 0;
  for (let i = 1; i < N; i++) { const d = rr[i] - rr[i - 1]; ds += d * d; if (Math.abs(d) > 0.05) nn50++; }
  const out = { meanHR: 60 / m, meanRR: 1000 * m, SDNN: 1000 * sd(rr), RMSSD: 1000 * Math.sqrt(ds / (N - 1)), pNN50: 100 * nn50 / (N - 1), LF: NaN, HF: NaN, LFHF: NaN };
  const fs = 4, t = []; let acc = 0; for (const d of rr) { acc += d; t.push(acc); }
  if (acc > 120) {
    const sp = makeSpline(t, Array.from(rr, v => v * 1000)), n = Math.floor((t[N - 1] - t[0]) * fs) + 1, x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = sp(t[0] + i / fs);
    const mu = mean(x), np = pow2(n), re = new Float64Array(np), im = new Float64Array(np);
    for (let i = 0; i < n; i++) { const tw = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))); re[i] = (x[i] - mu) * tw; }
    fftCore(re, im, false);
    let wss = 0; for (let i = 0; i < n; i++) { const tw = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))); wss += tw * tw; }
    const df = fs / np, band = (a, b) => { let s = 0; for (let k = 1; k < np / 2; k++) { const f = k * df; if (f >= a && f < b) s += 2 * (re[k] ** 2 + im[k] ** 2) / (fs * wss) * df; } return s; };
    out.LF = band(priors.lf_lower_hz, priors.lf_upper_hz); out.HF = band(priors.lf_upper_hz, priors.hf_upper_hz); out.LFHF = out.LF / out.HF;
  }
  return out;
}
/** Rolling statistics over windows of `win` seconds stepped by `step` seconds (observed vs filtered RR). */
function rollingStats(time, dy, irr, win, step) {
  const N = time.length, out = []; let start = time[0];
  while (start + win <= time[N - 1] + 1e-9) {
    const idx = []; for (let i = 0; i < N; i++) if (time[i] >= start && time[i] < start + win) idx.push(i);
    if (idx.length >= 8) {
      const a = idx.map(i => dy[i]), b = idx.map(i => irr[i]), rm = x => { let s = 0; for (let i = 1; i < x.length; i++) s += (x[i] - x[i - 1]) ** 2; return 1000 * Math.sqrt(s / (x.length - 1)); };
      out.push({ t: start + win / 2, hrObs: 60 / mean(a), hrFlt: 60 / mean(b), sdnnObs: 1000 * sd(a), sdnnFlt: 1000 * sd(b), rmssdObs: rm(a), rmssdFlt: rm(b) });
    }
    start += step;
  }
  return out;
}
/** Cross-correlation of two series at lags -maxLag..maxLag (in beats). */
function crossCorr(a, b, maxLag) {
  const n = a.length, ma = mean(a), mb = mean(b), sa = sd(a) * Math.sqrt((n - 1) / n), sb = sd(b) * Math.sqrt((n - 1) / n), out = [];
  for (let l = -maxLag; l <= maxLag; l++) { let s = 0, c = 0; for (let t = 0; t < n; t++) { const u = t + l; if (u >= 0 && u < n) { s += (a[t] - ma) * (b[u] - mb); c++; } } out.push({ lag: l, r: s / (n * sa * sb) }); }
  return out;
}

/** Density landscape of the (x_p, x_s) plane in units of the stationary SDs: U = -ln(p / p_max), basins (local maxima), mean flow. */
function stateLandscape(Xp, Xs, sdP, sdS, opts) {
  const o = Object.assign({ nGrid: 80, bandwidth: 1, potentialMax: 6, minRel: 0.3, flowBins: 10, flowMin: 4 }, opts || {});
  const u = Array.from(Xp, x => x / sdP), v = Array.from(Xs, x => x / sdS), n = u.length;
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
  const pad = a => { const lo = q(a, 0.005), hi = q(a, 0.995), d = (hi - lo) * 0.1 || 1; return [lo - d, hi + d]; };
  const lu = pad(u), lv = pad(v), N = o.nGrid, hu = 1.06 * sd(u) * Math.pow(n, -0.2) * o.bandwidth, hv = 1.06 * sd(v) * Math.pow(n, -0.2) * o.bandwidth;
  const gu = Array.from({ length: N }, (_, i) => lu[0] + (lu[1] - lu[0]) * i / (N - 1)), gv = Array.from({ length: N }, (_, i) => lv[0] + (lv[1] - lv[0]) * i / (N - 1));
  const Ku = gu.map(g => Float64Array.from(u, x => Math.exp(-0.5 * ((g - x) / hu) ** 2))), Kv = gv.map(g => Float64Array.from(v, x => Math.exp(-0.5 * ((g - x) / hv) ** 2)));
  const dens = Array.from({ length: N }, () => new Float64Array(N)); let mx = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { let s = 0; const a = Ku[i], b = Kv[j]; for (let k = 0; k < n; k++) s += a[k] * b[k]; dens[i][j] = s / (n * 2 * Math.PI * hu * hv); if (dens[i][j] > mx) mx = dens[i][j]; }
  const pot = dens.map(r => Float64Array.from(r, d => Math.min(-Math.log(Math.max(d, 1e-300) / mx), o.potentialMax)));
  const basins = [];
  for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) {
    const d = dens[i][j]; if (d < o.minRel * mx) continue; let isMax = true;
    for (let a = -1; a <= 1 && isMax; a++) for (let b = -1; b <= 1; b++) if ((a || b) && dens[i + a][j + b] > d) { isMax = false; break; }
    if (isMax) basins.push({ u: gu[i], v: gv[j], density: d });
  }
  basins.sort((a, b) => b.density - a.density);
  const nb = o.flowBins, cu = Math.max(1e-9, (lu[1] - lu[0]) / nb), cv = Math.max(1e-9, (lv[1] - lv[0]) / nb), cells = new Map();
  for (let k = 0; k < n - 1; k++) {
    const iu = Math.min(nb - 1, Math.max(0, Math.floor((u[k] - lu[0]) / cu))), iv = Math.min(nb - 1, Math.max(0, Math.floor((v[k] - lv[0]) / cv))), key = iu * nb + iv;
    const c = cells.get(key) || { n: 0, du: 0, dv: 0, iu, iv }; c.n++; c.du += u[k + 1] - u[k]; c.dv += v[k + 1] - v[k]; cells.set(key, c);
  }
  const flow = []; cells.forEach(c => { if (c.n >= o.flowMin) flow.push({ u: lu[0] + (c.iu + 0.5) * cu, v: lv[0] + (c.iv + 0.5) * cv, du: c.du / c.n, dv: c.dv / c.n, n: c.n }); });
  return { gu, gv, pot, dens, basins, flow, limits: { u: lu, v: lv }, bandwidth: [hu, hv], u, v, potMax: o.potentialMax, flowBins: nb };
}


/* ---- power spectral density (Daniell-smoothed periodogram) ---------------------------------------------------- */
function computePSD(signal, fs, spans) {
  spans = spans || [3, 5]; const N = signal.length, Np = pow2(N), mn = mean(signal), re = new Float64Array(Np), im = new Float64Array(Np);
  for (let i = 0; i < N; i++) re[i] = signal[i] - mn; fftCore(re, im, false);
  const M = Math.floor(Np / 2) + 1, freq = Array.from({ length: M }, (_, k) => k * fs / Np); let pw = new Array(M);
  pw[0] = re[0] * re[0] / (N * fs); for (let k = 1; k < M - 1; k++) pw[k] = 2 * (re[k] * re[k] + im[k] * im[k]) / (N * fs); pw[M - 1] = re[M - 1] * re[M - 1] / (N * fs);
  for (const span of spans) { const m = Math.floor(span / 2), s = pw.slice(); for (let i = m; i < M - m; i++) { let t = 0; for (let j = -m; j <= m; j++) t += pw[i + j]; s[i] = t / span; } pw = s; }
  const pf = [], pp = []; for (let i = 0; i < M; i++) if (freq[i] >= 0.01 && freq[i] <= 0.5) { pf.push(freq[i]); pp.push(pw[i]); }
  return { freq: pf, pow: pp };
}
function hrPSD(dy, irr, time) {
  const fs = 4, tMin = time[0], tMax = time[time.length - 1], Ng = Math.floor((tMax - tMin) * fs) + 1, tG = Array.from({ length: Ng }, (_, i) => tMin + i / fs);
  const o = makeSpline(time, Array.from(dy, d => 1 / d)), f = makeSpline(time, Array.from(irr, r => 1 / r));
  return { obs: computePSD(tG.map(t => o(t)), fs, [3, 5]), flt: computePSD(tG.map(t => f(t)), fs, [3, 3]) };
}

/* ---- example data and parsing ---------------------------------------------------------------------------------- */
/** Seeded random numbers (mulberry32) with a normal generator. */
function rngFactory(seed) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, n: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}
/** Simulated 5-2-5 recording: 5 min rest, 2 min exercise, 5 min recovery. Two OU drives (vagal-like fast, sympathetic-like slow) plus deterministic
    exercise offsets (fast vagal withdrawal, slower sympathetic rise, slower recovery of both) drive an integrate-and-fire pacemaker.
    Parameters are physiological: ~64 bpm at rest, ~140 bpm at the end of exercise, resting RMSSD ~30-40 ms. @return {rr (s), events, truth} */
function genExampleSession(seed) {
  const rnd = rngFactory(seed || 525), h = 0.01, T = 720, tOn = 300, tOff = 420;
  const truth = { nu0: 1.12, kp: 1 / 4, ks: 1 / 150, sdP: 0.075, sdS: 0.035, jitterMs: 6, Ap: 0.50, As: 0.75, tauOnP: 10, tauOnS: 30, tauOffP: 30, tauOffS: 75 };
  const aP = Math.exp(-truth.kp * h), aS = Math.exp(-truth.ks * h), nP = truth.sdP * Math.sqrt(1 - aP * aP), nS = truth.sdS * Math.sqrt(1 - aS * aS);
  let xp = truth.sdP * rnd.n(), xs = truth.sdS * rnd.n(), phase = 0, tLast = 0;
  const rr = [], jit = truth.jitterMs / 1000, nSteps = Math.round(T / h);
  const endP = truth.Ap * (1 - Math.exp(-(tOff - tOn) / truth.tauOnP)), endS = truth.As * (1 - Math.exp(-(tOff - tOn) / truth.tauOnS));
  const offsets = t => t < tOn ? [0, 0] : t < tOff ? [truth.Ap * (1 - Math.exp(-(t - tOn) / truth.tauOnP)), truth.As * (1 - Math.exp(-(t - tOn) / truth.tauOnS))]
    : [endP * Math.exp(-(t - tOff) / truth.tauOffP), endS * Math.exp(-(t - tOff) / truth.tauOffS)];
  for (let k = 1; k <= nSteps; k++) {
    const t = k * h; xp = aP * xp + nP * rnd.n(); xs = aS * xs + nS * rnd.n();
    const [mp, ms] = offsets(t), rate = Math.max(truth.nu0 - xp + mp + xs + ms, 0.3);   // vagal withdrawal (mp > 0) and sympathetic rise (ms > 0) both speed the pacemaker
    // threshold noise: variance chosen so that the equivalent RR timing jitter is ~truth.jitterMs
    const inc = rate * h + (jit * rate) * Math.sqrt(h) * rnd.n() * 0.5;
    const before = phase; phase += inc;
    if (phase >= 1) { const frac = (1 - before) / inc, tb = t - h + frac * h; rr.push(Math.max(0.3, Math.min(2, tb - tLast))); tLast = tb; phase -= 1; }
  }
  return { rr, events: { t_on: tOn, t_off: tOff, duration: T }, truth, label: 'Example 5-2-5' };
}
const genExampleRR = () => genExampleSession().rr;
/** The earlier, highly variable example series (kept so that the R-equivalence reference data can be regenerated). */
function genLegacyExampleRR(N) {
  N = N || 400; let s = 42 >>> 0;
  const rng = () => { s = Math.imul(s ^ s >>> 15, 1 | s); s ^= s + Math.imul(s ^ s >>> 7, 61 | s); return ((s ^ s >>> 14) >>> 0) / 4294967296; };
  const rn = () => Math.sqrt(-2 * Math.log(rng() + 1e-9)) * Math.cos(2 * Math.PI * rng());
  const nu0 = 1.05, ks = 0.07, kp = 1.1, Vs = 0.025, Vp = 0.11; let xs = 0, xp = 0; const rr = [];
  for (let i = 0; i < N; i++) {
    const dta = 1 / nu0; xs = xs * Math.exp(-ks * dta) + Math.sqrt(Vs * (1 - Math.exp(-2 * ks * dta))) * rn(); xp = xp * Math.exp(-kp * dta) + Math.sqrt(Vp * (1 - Math.exp(-2 * kp * dta))) * rn();
    const nu = Math.max(nu0 - xp + xs, 0.4); rr.push(Math.max(0.3, Math.min(2.0, 1 / nu + 0.012 * rn())));
  }
  return rr;
}
/** Per-phase summary of a fit: events = {t_on, t_off} (s from the first beat). Centroids are in units of the stationary SDs of the two drives. */
function phaseSummary(fit, events, dm) {
  if (!events || !(events.t_on > 0) || !(events.t_off > events.t_on)) return null;
  const T = fit.time, N = T.length, tEnd = T[N - 1] + 1e-9, defs = [['Rest', 0, events.t_on], ['Exercise', events.t_on, events.t_off], ['Recovery', events.t_off, tEnd]];
  const rows = defs.map(([name, a, b]) => {
    const idx = []; for (let k = 0; k < N; k++) { const t = T[k] - fit.dy[k]; if (t >= a && t < b) idx.push(k); }   // beat start time
    if (idx.length < 5) return { name, n: idx.length };
    const pick = arr => idx.map(k => arr[k]), rr = pick(fit.dy), fl = pick(fit.irr), xp = pick(fit.Xp), xs = pick(fit.Xs), g = pick(fit.gain);
    const rm = x => { let s = 0; for (let i = 1; i < x.length; i++) s += (x[i] - x[i - 1]) ** 2; return 1000 * Math.sqrt(s / (x.length - 1)); };
    return { name, n: idx.length, from: a, to: Math.min(b, T[N - 1]), duration: Math.min(b, T[N - 1]) - a, hr: 60 / mean(rr), rmssdObs: rm(rr), rmssdFlt: rm(fl), xp: mean(xp), xs: mean(xs), sdXp: sd(xp), sdXs: sd(xs),
             cu: mean(xp) / dm.sdP_ss, cv: mean(xs) / dm.sdS_ss, gain: mean(g) };
  });
  const ref = rows[0]; rows.forEach(r => { r.shift = (r.cu != null && ref.cu != null) ? Math.hypot(r.cu - ref.cu, r.cv - ref.cv) : NaN; });
  return rows;
}
function parseRR(txt) {
  const raw = txt.trim().split(/[\n\r,;\t ]+/).map(s => parseFloat(s.trim())).filter(v => isFinite(v) && v > 0);
  if (!raw.length) return null;
  const wasMs = median(raw) > 3, vals = raw.map(v => wasMs ? v / 1000 : v).filter(v => v > 0.1 && v < 3.0);
  return vals.length >= 30 ? { vals, wasMs } : null;
}

const API = { fftCore, pow2, mean, median, sd, pnorm, qnorm, makeSpline, monoSpline, DEFAULT_PRIORS, DEFAULT_CONTROL, sparkPriors, sparkControl, biwaveletMorlet, hrGrid,
  extractSpectralPriors, ouBlock, artifactGate, runGLSFilter, thetaToPar, parToTheta, logPriorTerms, objectiveMap, bfgsR, fitModel, fitFromAnchor, assembleFit, runManualFit,
  numHessian, eigenSym, pinv, reportModel, pacf, acf, ksUniform, innovationDiagnostics, derivedMetrics, hrvStats, rollingStats, crossCorr, stateLandscape, computePSD, hrPSD, genExampleSession, genExampleRR, genLegacyExampleRR, phaseSummary, parseRR };
root.SparkEngine = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);

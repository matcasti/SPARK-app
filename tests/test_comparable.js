// Quantities comparable across people (variability in physical units, time constants, mean rate, net tone with an age anchor): the JS engine against the R project's comparable_indices()
// (expected values in tests/expected_comparable_R.json, computed in R from tests/reference_R.json with age 40).   node tests/test_comparable.js
const E = require('../engine.js'), fs = require('fs'), ref = JSON.parse(fs.readFileSync(__dirname + '/reference_R.json', 'utf8')), exp = JSON.parse(fs.readFileSync(__dirname + '/expected_comparable_R.json', 'utf8'));
let pass = 0, fail = 0; const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'ok    ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : '')); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const map = { hr_bpm: 'Hr_bpm', sdP_hz: 'Sd_P_Hz', sdS_hz: 'Sd_S_Hz', sdP_bpm: 'Sd_P_bpm', sdS_bpm: 'Sd_S_bpm', tauP: 'Tau_P', tauS: 'Tau_S', intrinsic_bpm: 'Intrinsic_bpm', net_tone_bpm: 'Net_tone_bpm', net_tone_band_bpm: 'Net_tone_band_bpm' };
for (const [name, r] of Object.entries(ref)) {
  const ci = E.comparableIndices({ dy: r.dy, params: r.fit.params }, 40), e = exp[name], worst = Math.max(...Object.entries(map).map(([k, v]) => rel(ci[k], e[v])));
  check(name + ': every quantity equals the R function (age 40)', worst < 1e-12, 'max relative difference ' + worst.toExponential(1));
  check(name + ': SD_S^2 = sigma^2, (SD_P / SD_S)^2 = Lambda_P, bpm = 60 x Hz', rel(ci.sdS_hz ** 2, r.fit.params.sig2) < 1e-12 && rel((ci.sdP_hz / ci.sdS_hz) ** 2, r.fit.params.lp) < 1e-12 && rel(ci.sdP_bpm, 60 * ci.sdP_hz) < 1e-12);
  const none = E.comparableIndices({ dy: r.dy, params: r.fit.params });
  check(name + ': without an age there is no net tone and the other quantities are unchanged', Number.isNaN(none.net_tone_bpm) && Number.isNaN(none.intrinsic_bpm) && none.sdP_hz === ci.sdP_hz && none.hr_bpm === ci.hr_bpm);
}
check('intrinsic rate: 118.1 - 0.57 x age for adults 18-100, NaN outside the range or when missing', Math.abs(E.intrinsicRateBpm(27.5) - 102.425) < 1e-12 && Math.abs(E.intrinsicRateBpm(76.5) - 74.495) < 1e-12 && Number.isFinite(E.intrinsicRateBpm(18)) && Number.isFinite(E.intrinsicRateBpm(100)) &&
      [17, 101, NaN, undefined, null, -5].every(a => Number.isNaN(E.intrinsicRateBpm(a))));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

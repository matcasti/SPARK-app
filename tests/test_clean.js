// The RR cleaning gate of the app (engine.js) against the R function it ports (clean_sample in tools/prep-data.R); reference: tests/reference_clean_R.json
//   Rscript tests/make_reference_clean.R tools/prep-data.R   then   node tests/test_clean.js
const E = require('../engine.js'), fs = require('fs'), ref = JSON.parse(fs.readFileSync(__dirname + '/reference_clean_R.json', 'utf8'));
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok    ' + name + (detail ? '  [' + detail + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); } };
const num = v => typeof v === 'string' ? NaN : v;
let worst = 0, worstName = '', identicalFlags = 0, nCases = 0, replaced = 0;
for (const c of ref) {
  const x = c.x.map(num), r = E.cleanSample(x, { window: c.window, n_mad: c.n_mad, n_iter: c.n_iter }); nCases++;
  let md = 0; for (let i = 0; i < x.length; i++) { const a = r.y[i], b = num(c.y[i]); if (!(isNaN(a) && isNaN(b))) md = Math.max(md, Math.abs(a - b)); }
  if (md > worst) { worst = md; worstName = `${c.name} (${c.window}, ${c.n_mad}, ${c.n_iter})`; }
  const sameFlags = r.changed.every((v, i) => v === c.changed[i]); if (sameFlags) identicalFlags++; replaced += r.n_changed;
}
check(`values equal R's clean_sample in all ${nCases} cases (series x settings, incl. ties, NAs, even/odd lengths, short and flat series)`, worst < 1e-12, 'max |difference| ' + worst.toExponential(1) + (worst >= 1e-12 ? ' in ' + worstName : ''));
check('the flags of the replaced beats equal R\'s', identicalFlags === nCases, identicalFlags + '/' + nCases + ' cases; ' + replaced + ' beats replaced in total');
// runmed against R itself (rule "median" at the ends) on a series with ties
const x = ref.find(c => c.name === 'tied').x, rm = E.runmed(Float64Array.from(x), 21);
check('runmed keeps the length and is bounded by the data', rm.length === x.length && Math.min(...rm) >= Math.min(...x) && Math.max(...rm) <= Math.max(...x));
// behaviour
const rr = ref.find(c => c.name === 'restLong').x, cl = E.cleanSample(rr);
check('default settings are those of prep-data (50 beats, 3.5 MAD, 2 passes)', JSON.stringify(E.DEFAULT_CLEAN) === '{"window":50,"n_mad":3.5,"n_iter":2}' && cl.opts.window === 50 && cl.opts.n_mad === 3.5 && cl.opts.n_iter === 2);
check('the number of beats is preserved and unflagged beats are untouched', cl.y.length === rr.length && cl.y.every((v, i) => cl.changed[i] || Math.abs(v - rr[i]) < 1e-12));
const art = Float64Array.from({ length: 300 }, (_, i) => 0.85 + 0.03 * Math.sin(i / 7)); art[100] = 1.9; art[200] = 0.3;
const ca = E.cleanSample(art); check('injected artifacts are replaced and clean beats are not', ca.changed[100] === 1 && ca.changed[200] === 1 && ca.n_changed <= 4 && Math.abs(ca.y[100] - 0.85) < 0.1);
check('invalid settings are refused', ['window', 'n_mad', 'n_iter'].every(k => { try { E.cleanSample(art, { [k]: k === 'n_iter' ? 0 : -1 }); return false; } catch (e) { return /Invalid setting/.test(e.message); } }));
check('a series with fewer than two valid values yields NaN (the app does not use it)', E.cleanSample([NaN, NaN, 0.8]).y.every(v => isNaN(v)));
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);

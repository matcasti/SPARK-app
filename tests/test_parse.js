// Reading .txt / .csv data: layouts, units (automatic detection and user choice), error messages.
//   node tests/test_parse.js
const E = require('../engine.js');
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'ok    ' : 'FAIL  ') + n + (d ? '  [' + d + ']' : '')); };
const rr = E.genExampleSession().rr.slice(100, 400), N = rr.length, close = (r, tol) => r.vals && Math.abs(r.vals.length - N) <= (tol || 0) && Math.abs(r.vals[10] - rr[10]) < 6e-4;
const closeT = r => r.vals && Math.abs(r.vals.length - (N - 1)) <= 1 && Math.abs(r.vals[10] - rr[11]) < 2.5e-3;      // beat times: the first interval is lost to differencing
const f = (v, d) => v.toFixed(d), join = (a, s) => a.join(s || '\n');
const times = (scale, d) => { let t = 0; return rr.map(v => { t += v; return f(t * scale, d); }); };

// units, single column
for (const [unit, scale, d] of [['ms', 1000, 0], ['s', 1, 4], ['min', 1 / 60, 6]]) {
  const r = E.parseRRDetailed(join(rr.map(v => f(v * scale, d))));
  check(`txt, one value per line, ${unit}: unit auto-detected`, r.unit === unit && r.unitSource === 'auto' && close(r), r.error || `${r.unit} (${r.unitSource})`);
}
// ms with decimals, with Windows line endings and a BOM
const w = E.parseRRDetailed('\uFEFF' + join(rr.map(v => f(v * 1000, 2)), '\r\n') + '\r\n'); check('BOM, CRLF line endings and decimals in ms', w.unit === 'ms' && close(w), w.error);
// header with a unit hint
for (const [h, unit] of [['RR (ms)', 'ms'], ['rr_s', 's'], ['IBI [s]', 's'], ['rri_min', 'min']]) { const sc = { ms: 1000, s: 1, min: 1 / 60 }[unit], r = E.parseRRDetailed(h + '\n' + join(rr.map(v => f(v * sc, unit === 'min' ? 6 : unit === 'ms' ? 0 : 4)))); check(`header "${h}" gives ${unit} (from the header)`, r.unit === unit && r.unitSource === 'header' && close(r), r.error || r.unitSource); }
// delimiters, columns, decimal comma
const t1 = E.parseRRDetailed('time,rr\n' + join(rr.map((v, i) => `${i},${f(v, 3)}`))); check('csv with a time column and an RR column: picks RR', t1.column.name === 'rr' && t1.kind === 'rr' && close(t1) && t1.delimiter === ',', t1.error);
const t2 = E.parseRRDetailed('rr_s;hr_bpm\n' + join(rr.map(v => `${f(v, 3).replace('.', ',')};${f(60 / v, 1).replace('.', ',')}`))); check('semicolon csv with decimal comma and two columns', close(t2) && t2.decimalComma && t2.delimiter === ';', t2.error);
const t3 = E.parseRRDetailed(join(rr.map(v => f(v, 3).replace('.', ',')))); check('single column with decimal comma (0,85)', close(t3) && t3.decimalComma && t3.unit === 's', t3.error);
const t4 = E.parseRRDetailed('beat\tRR_ms\n' + join(rr.map((v, i) => `${i + 1}\t${f(v * 1000, 0)}`))); check('tab separated with a row counter and RR_ms', close(t4) && t4.unit === 'ms' && t4.column.name === 'RR_ms' && t4.delimiter === 'tab', t4.error);
const t5 = E.parseRRDetailed(join(rr.map((v, i) => `${i + 1} ${f(v * 1000, 0)}`))); check('space separated index and RR in ms', close(t5) && t5.unit === 'ms' && t5.delimiter === 'space', t5.error);
// a csv whose first column is a row counter must not be taken for decimal commas
const t5b = E.parseRRDetailed(join(rr.map((v, i) => `${i % 100},${f(v * 1000, 0)}`))); check('two columns of integers (counter, RR ms) are two columns, not decimal commas', close(t5b) && !t5b.decimalComma && t5b.unit === 'ms', t5b.error);
const t6 = E.parseRRDetailed('# recorded 2025\n# device X\n' + join(rr.map(v => f(v * 1000, 0)))); check('comment lines are ignored', close(t6) && t6.unit === 'ms', t6.error);
const t7 = E.parseRRDetailed('"time","RR (ms)"\n' + join(rr.map((v, i) => `"${i}","${f(v * 1000, 0)}"`))); check('quoted fields', close(t7) && t7.unit === 'ms', t7.error);
// beat times -> RR
for (const [unit, scale, d] of [['s', 1, 3], ['ms', 1000, 0], ['min', 1 / 60, 6]]) { const r = E.parseRRDetailed(join(times(scale, d))); check(`beat times in ${unit} (one column) are differenced`, r.kind === 'times' && r.unit === unit && closeT(r), r.error || r.kind + ' ' + r.unit); }
const bt = E.parseRRDetailed('beat,time_ms\n' + join(times(1000, 0).map((v, i) => `${i},${v}`))); check('beat counter + time_ms columns: the counter is skipped', bt.kind === 'times' && bt.column.name === 'time_ms' && closeT(bt), bt.error);
// user choice
const u1 = E.parseRRDetailed(join(rr.map(v => f(v * 1000, 0))), { unit: 'ms' }); check('user-chosen unit is used (and marked as such)', u1.unit === 'ms' && u1.unitSource === 'user' && close(u1));
const u2 = E.parseRRDetailed(join(rr.map(v => f(v, 4))), { unit: 'ms' }); check('a wrong chosen unit gives a clear error instead of nonsense', !!u2.error && /milliseconds/.test(u2.error) && /Check the selected time unit/.test(u2.error), u2.error);
const u3 = E.parseRRDetailed(join(rr.map(v => f(v * 1000, 0))), { unit: 's' }); check('seconds forced on millisecond data is rejected', !!u3.error, u3.error);
const u4 = E.parseRRDetailed(join(rr.map(v => f(v * 1000, 0))), { unit: 'min' }); check('minutes forced on millisecond data is rejected', !!u4.error);
// errors
check('values that are not RR (heart rate in bpm) ask for a manual unit', /Choose the unit manually/.test(E.parseRRDetailed(join(rr.map(v => f(60 / v, 0)))).error || ''));
check('too few lines', /fewer than 30/.test(E.parseRRDetailed('1\n2\n3').error));
check('no numeric column', /No numeric column/.test(E.parseRRDetailed(join(Array.from({ length: 40 }, (_, i) => 'abc' + i))).error || ''));
// outliers are dropped and reported
const o = rr.map(v => f(v * 1000, 0)); o[50] = '0'; o[60] = '9999'; o[70] = '15000'; const ro = E.parseRRDetailed(join(o)); check('implausible values are ignored and reported', ro.vals && ro.nDropped >= 2 && ro.warnings.some(x => /ignored/.test(x)), ro.warnings && ro.warnings.join(' '));
// backward compatible wrapper
check('parseRR wrapper returns null on failure and an object on success', E.parseRR('x\ny') === null && E.parseRR(join(rr.map(v => f(v * 1000, 0)))).wasMs === true);
// round trip: the same series in the three units gives the same RR to rounding
const ra = E.parseRRDetailed(join(rr.map(v => f(v * 1000, 1)))), rb = E.parseRRDetailed(join(rr.map(v => f(v, 5)))), rc = E.parseRRDetailed(join(rr.map(v => f(v / 60, 8))));
check('the same recording in ms, s and min gives the same RR (to rounding)', ra.vals.every((v, i) => Math.abs(v - rb.vals[i]) < 1e-4 && Math.abs(v - rc.vals[i]) < 1e-4));
// the fit does not depend on the unit it was read in
const fa = E.fitModel(ra.vals), fb = E.fitModel(rc.vals); check('the fitted model is the same (within 2%, rounding of the file) whichever unit it used', Math.abs(fa.params.ks - fb.params.ks) / fa.params.ks < 0.02 && Math.abs(fa.params.kp - fb.params.kp) / fa.params.kp < 0.02, `ks ${fa.params.ks.toExponential(3)} vs ${fb.params.ks.toExponential(3)}`);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);

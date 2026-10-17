// Automatic phase detection: accuracy, robustness, false positives, multiple and graded stressors, manual markers.
//   node tests/test_phases.js
const E = require('../engine.js');
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'ok    ' : 'FAIL  ') + n + (d ? '  [' + d + ']' : '')); };
const names = p => p ? p.segments.map(s => s.name).join(' > ') : 'none';
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. the 5-2-5 example
const ex = E.genExampleSession(), p1 = E.detectPhases(ex.rr);
check('5-2-5: rest > stressor > recovery', names(p1) === 'Rest > Stressor > Recovery', names(p1));
check('5-2-5: onset within 10 s and end within 20 s of the protocol', near(p1.segments[1].from, 300, 10) && near(p1.segments[1].to, 420, 20), p1.segments[1].from.toFixed(0) + ' / ' + p1.segments[1].to.toFixed(0) + ' (truth 300 / 420)');
check('5-2-5: heart-rate levels are plausible', p1.segments[0].hr > 55 && p1.segments[0].hr < 75 && p1.segments[1].hr > 110 && p1.segments[2].hr < p1.segments[1].hr);
check('5-2-5: every boundary reports its change and z-score', p1.boundaries.every(b => isFinite(b.deltaBpm) && b.z >= 4 && Math.abs(b.deltaBpm) >= 10));

// 2. two stressors in one recording
const mu = E.genExampleMulti(), p2 = E.detectPhases(mu.rr);
check('multi: Rest > Stressor 1 > Recovery 1 > Stressor 2 > Recovery 2', names(p2) === 'Rest > Stressor 1 > Recovery 1 > Stressor 2 > Recovery 2', names(p2));
const t2 = p2.segments.slice(1).map(s => s.from), truth = mu.truthBoundaries;
check('multi: all four boundaries within 30 s of the protocol', truth.every((t, i) => near(t2[i], t, 30)), t2.map(v => v.toFixed(0)).join(', ') + ' (truth ' + truth.join(', ') + ')');
check('multi: nStressors = 2', p2.nStressors === 2);
// three stressors with different sizes
const three = E.simulateSession({ duration: 1500, stressors: [Object.assign({ on: 240, off: 360 }, { Ap: 0.5, As: 0.75, tauOnP: 10, tauOnS: 30, tauOffP: 30, tauOffS: 75 }), Object.assign({ on: 600, off: 720 }, { Ap: 0.35, As: 0.5, tauOnP: 10, tauOnS: 25, tauOffP: 25, tauOffS: 60 }), Object.assign({ on: 1000, off: 1120 }, { Ap: 0.6, As: 0.9, tauOnP: 10, tauOnS: 30, tauOffP: 30, tauOffS: 75 })] }, 31);
const p3 = E.detectPhases(three.rr); check('three stressors: three found, in order', p3 && p3.nStressors === 3 && p3.segments.filter(s => s.kind === 'stressor').every((s, i) => near(s.from, [240, 600, 1000][i], 25)), names(p3));
check('maxStressors limits the number of phases', E.detectPhases(three.rr, { maxStressors: 1 }).nStressors <= 1);

// 3. artifacts (ectopic-like beats) must not create or move phases
function withArtifacts(rr, frac, seed) { const r = E.simulateSession({ duration: 30, stressors: [] }, seed).rr, out = rr.slice(); let s = seed >>> 0; const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; for (let i = 5; i < out.length - 5; i++) if (u() < frac) out[i] *= u() < 0.5 ? 1.7 : 0.45; return out; }
const p4 = E.detectPhases(withArtifacts(ex.rr, 0.02, 7)); check('5-2-5 with 2% artifact beats: same three phases, same timing (±15 s)', names(p4) === 'Rest > Stressor > Recovery' && near(p4.segments[1].from, p1.segments[1].from, 15) && near(p4.segments[1].to, p1.segments[1].to, 15), names(p4));

// 4. stationary recordings: no invented phases (default sensitivity)
let fp = 0, nSt = 0;
for (let s = 1; s <= 30; s++) { nSt++; if (E.detectPhases(E.simulateSession({ duration: 600, stressors: [] }, 1000 + s).rr)) fp++; }
check('stationary 10-min recordings: false-positive rate <= 10%', fp / nSt <= 0.10, fp + ' of ' + nSt);
check('the earlier, very variable stationary example: no phases', E.detectPhases(E.genLegacyExampleRR(400)) === null);

// 5. power for a strong stressor (+40 bpm)
let hit = 0;
for (let s = 1; s <= 20; s++) { const rr = E.simulateSession({ duration: 700, stressors: [{ on: 300, off: 420, Ap: 0.26, As: 0.4, tauOnP: 10, tauOnS: 20, tauOffP: 20, tauOffS: 50 }] }, 2000 + s).rr, p = E.detectPhases(rr); if (p && p.segments.length === 3 && near(p.segments[1].from, 300, 15)) hit++; }
check('a +40 bpm stressor is found in >= 95% of simulations', hit >= 19, hit + ' of 20');

// 6. graded stressor (two steps up) counts as ONE stressor
const graded = E.simulateSession({ duration: 900, stressors: [{ on: 240, off: 600, Ap: 0.25, As: 0.4, tauOnP: 8, tauOnS: 15, tauOffP: 25, tauOffS: 60 }, { on: 400, off: 600, Ap: 0.35, As: 0.5, tauOnP: 8, tauOnS: 15, tauOffP: 25, tauOffS: 60 }] }, 77);
const p6 = E.detectPhases(graded.rr); check('graded effort (higher level inside the stressor) stays a single stressor', p6 && p6.nStressors === 1 && p6.boundaries.length >= 3, names(p6) + ', ' + (p6 && p6.boundaries.length) + ' level changes');

// 7. determinism and options
check('detection is deterministic', JSON.stringify(E.detectPhases(ex.rr)) === JSON.stringify(E.detectPhases(ex.rr)));
check('a very high minimum shift suppresses detection', E.detectPhases(ex.rr, { minShiftBpm: 200 }) === null);
check('too short a recording gives no phases', E.detectPhases(ex.rr.slice(0, 20)) === null);

// 8. manual markers
const m1 = E.phasesFromMarkers('300, 420', 720); check('manual: "300, 420" gives rest, stressor, recovery', names(m1) === 'Rest > Stressor > Recovery' && m1.segments[1].from === 300 && m1.segments[2].to === 720 && m1.source === 'manual');
const m2 = E.phasesFromMarkers([240, 360, 600, 780], 1020); check('manual: four markers give two stressors', names(m2) === 'Rest > Stressor 1 > Recovery 1 > Stressor 2 > Recovery 2' && m2.nStressors === 2);
check('manual: invalid markers are rejected (decreasing, non-numeric, single, beyond the recording)', ['420, 300', 'a, b', '300', '900, 1000'].every(s => E.phasesFromMarkers(s, 720) === null));
check('manual: separators ; , and spaces', names(E.phasesFromMarkers('300;420 600', 900)) === 'Rest > Stressor 1 > Recovery > Stressor 2');

// 9. summary per phase
const fit = E.fitModel(mu.rr), dm = E.derivedMetrics(fit), sm = E.phaseSummary(fit, p2, dm);
check('phase summary: one row per phase with HR rising in stressors and falling in recoveries', sm.length === 5 && sm[1].hr > sm[2].hr && sm[3].hr > sm[4].hr && sm[1].hr > sm[3].hr && sm.every(r => r.n > 5), sm.map(r => r.hr.toFixed(0)).join(' / '));
check('phase summary: stressor centroids are displaced from rest, the first more than the second', sm[1].shift > sm[3].shift && sm[3].shift > 1, sm.map(r => r.shift.toFixed(1)).join(' / '));
// 10. conventional statistics per window
{ const ph = E.phaseHRV(fit, p2, fit.pr), idx = k => { const out = []; for (let i = 0; i < fit.time.length; i++) { const t0 = fit.time[i] - fit.dy[i]; if (t0 >= p2.segments[k].from && t0 < Math.min(p2.segments[k].to, fit.time[fit.time.length - 1] + 1e-9)) out.push(i); } return out; };
  check('per-window statistics: a whole-recording row plus one row per phase', ph.length === 6 && ph[0].name === 'Whole recording' && ph.slice(1).map(r => r.name).join() === p2.segments.map(s => s.name).join());
  const k = 1, ii = idx(k), direct = E.hrvStats(ii.map(i => fit.dy[i]), fit.pr), directF = E.hrvStats(ii.map(i => fit.irr[i]), fit.pr);
  check('per-window statistics equal the conventional statistics computed on that window\'s beats (observed and filtered)', ['meanHR', 'SDNN', 'RMSSD', 'pNN50'].every(m => Math.abs(ph[k + 1].obs[m] - direct[m]) < 1e-9 && Math.abs(ph[k + 1].flt[m] - directF[m]) < 1e-9) && ph[k + 1].n === ii.length);
  check('the whole-recording row equals the statistics of the whole series', Math.abs(ph[0].obs.SDNN - E.hrvStats(fit.dy, fit.pr).SDNN) < 1e-9 && Math.abs(ph[0].flt.RMSSD - E.hrvStats(fit.irr, fit.pr).RMSSD) < 1e-9);
  check('heart rate is higher in the stressor windows than in rest, and RMSSD lower', ph[2].obs.meanHR > ph[1].obs.meanHR * 1.4 && ph[2].obs.RMSSD < ph[1].obs.RMSSD, ph.slice(1).map(r => r.obs.meanHR.toFixed(0) + '/' + r.obs.RMSSD.toFixed(0)).join('  '));
  check('spectral values are NaN for windows shorter than 2 min and defined for longer ones', ph.slice(1).every(r => (r.duration < 120) === !isFinite(r.obs.LF)), ph.slice(1).map(r => r.duration.toFixed(0) + 's').join(' '));
  check('without phases only the whole recording is returned', E.phaseHRV(fit, null, fit.pr).length === 1); }
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);

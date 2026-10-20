// Live stream: heart-rate packet parser, Web Bluetooth connection logic (against a mock device), simulated sensor and the live reconstruction session.
//   node tests/test_live.js
const E = require('../engine.js'); globalThis.SparkEngine = E; const L = require('../live.js');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('ok    ' + name + (detail ? '  [' + detail + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); } };
const dv = bytes => new DataView(Uint8Array.from(bytes).buffer);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 1. packet parser (Bluetooth Heart Rate Measurement)
let p = L.parseHRMeasurement(dv([0x10, 72, 0x00, 0x04, 0x00, 0x03]));
check('uint8 heart rate with two RR intervals (1/1024 s units)', p.hr === 72 && p.rr.length === 2 && p.rr[0] === 1024 / 1024 && Math.abs(p.rr[1] - 768 / 1024) < 1e-12, JSON.stringify(p.rr));
p = L.parseHRMeasurement(dv([0x11, 0x2c, 0x01, 0x00, 0x03]));                                   // uint16 heart rate = 300, one RR = 768/1024
check('uint16 heart rate format moves the RR offset', p.hr === 300 && p.rr.length === 1 && Math.abs(p.rr[0] - 0.75) < 1e-12);
p = L.parseHRMeasurement(dv([0x18, 60, 0x2a, 0x00, 0x00, 0x04]));                               // energy expended present (bit 3) before the RR
check('energy expended field is skipped before the RR intervals', p.energy === 42 && p.rr.length === 1 && p.rr[0] === 1);
check('sensor contact bits: unsupported, no contact, contact', L.parseHRMeasurement(dv([0x00, 70])).contact === null && L.parseHRMeasurement(dv([0x04, 70])).contact === false && L.parseHRMeasurement(dv([0x06, 70])).contact === true);
check('a packet without RR (flag bit 4 clear) gives an empty list; a truncated RR is ignored', L.parseHRMeasurement(dv([0x00, 70])).rr.length === 0 && L.parseHRMeasurement(dv([0x10, 70, 0x00])).rr.length === 0);
check('a packet shorter than two bytes is refused', (() => { try { L.parseHRMeasurement(dv([0x10])); return false; } catch (e) { return /too short/.test(e.message); } })());
const rt = L.parseHRMeasurement(L.buildHRMeasurement(300, [0.8, 0.9, 1.02], { contact: true, energy: 7 }));
check('build / parse round trip (RR within 1/2048 s)', rt.hr === 300 && rt.energy === 7 && rt.contact === true && rt.rr.length === 3 && rt.rr.every((v, i) => Math.abs(v - [0.8, 0.9, 1.02][i]) < 1 / 2048 + 1e-12));

// ---- 2. Web Bluetooth connection logic against a mock Polar H10
class Char extends EventTarget { constructor(v) { super(); this.value = v; this.notifying = false; } async startNotifications() { this.notifying = true; } async stopNotifications() { this.notifying = false; } async readValue() { return this.value; } push(d) { this.value = d; this.dispatchEvent(Object.assign(new Event('characteristicvaluechanged'), {})); } }
function mockBluetooth(opts) {
  const o = opts || {}, hr = new Char(null), bat = new Char(dv([87])), log = { filters: null, optional: null, connects: 0 };
  const device = Object.assign(new EventTarget(), { name: 'Polar H10 A1B2C3D4', gatt: { connected: false, async connect() { log.connects++; if (o.failConnect && log.connects <= o.failConnect) throw new Error('GATT connect failed'); this.connected = true;
    return { async getPrimaryService(u) { if (u === L.UUID.HR_SERVICE) return { async getCharacteristic(c) { if (c === L.UUID.HR_MEASUREMENT) return hr; throw new Error('no char'); } };
      if (u === L.UUID.BATTERY_SERVICE && !o.noBattery) return { async getCharacteristic() { return bat; } }; throw new Error('no service'); } }; }, disconnect() { this.connected = false; } } });
  const bt = { async requestDevice(req) { log.filters = req.filters; log.optional = req.optionalServices; if (o.cancel) { const e = new Error('User cancelled'); e.name = 'NotFoundError'; throw e; } return device; } };
  return { bt, hr, bat, device, log, drop() { device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); } };
}
(async () => {
  let m = mockBluetooth(), states = [], packets = [], batt = [], reconnects = 0;
  let src = new L.PolarSource({ bluetooth: m.bt, backoffMs: 5, onStatus: s => states.push(s), onPacket: q => packets.push(q), onBattery: b => batt.push(b), onReconnect: () => reconnects++ });
  await src.connect();
  check('connect: requests a device advertising the Heart Rate service, with the battery service optional', JSON.stringify(m.log.filters) === JSON.stringify([{ services: [L.UUID.HR_SERVICE] }]) && JSON.stringify(m.log.optional) === JSON.stringify([L.UUID.BATTERY_SERVICE]));
  check('connect: subscribes to heart-rate notifications and goes scanning -> connecting -> streaming', m.hr.notifying && states.join() === 'scanning,connecting,streaming' && src.name === 'Polar H10 A1B2C3D4');
  check('battery level is read and reported', batt[0] === 87);
  m.hr.push(L.buildHRMeasurement(61, [0.98, 0.99], { contact: true })); m.hr.push(L.buildHRMeasurement(62, [0.97]));
  check('packets are parsed and delivered with a timestamp', packets.length === 2 && packets[0].rr.length === 2 && Math.abs(packets[0].rr[0] - 0.98) < 1 / 2048 && packets[1].hr === 62 && typeof packets[0].wall === 'number');
  m.drop(); await sleep(60);
  check('a dropped link is reported as lost, then reconnected automatically and streaming resumes', states.includes('lost') && reconnects === 1 && src.state === 'streaming' && m.log.connects === 2, states.join());
  m.hr.push(L.buildHRMeasurement(60, [1.0])); check('data keep flowing after the reconnection (no duplicate handlers)', packets.length === 3);
  await src.disconnect(); check('disconnect stops notifications and ends idle without reconnecting', !m.hr.notifying && src.state === 'idle' && !m.device.gatt.connected);
  m.drop(); await sleep(40); check('a deliberate disconnect is not followed by a reconnection attempt', reconnects === 1 && m.log.connects === 2);
  m = mockBluetooth({ cancel: true }); states = []; src = new L.PolarSource({ bluetooth: m.bt, onStatus: (s, i) => states.push(s + ':' + (i.reason || '')) });
  let err = null; try { await src.connect(); } catch (e) { err = e; } check('cancelling the device chooser is reported as such', err && /cancelled/.test(states[states.length - 1]), states.join());
  m = mockBluetooth({ noBattery: true }); batt = []; src = new L.PolarSource({ bluetooth: m.bt, onBattery: b => batt.push(b) }); await src.connect(); check('a sensor without battery service still streams', src.state === 'streaming' && batt.length === 0);
  m = mockBluetooth({ failConnect: 99 }); states = []; src = new L.PolarSource({ bluetooth: m.bt, backoffMs: 2, maxAttempts: 3, onStatus: s => states.push(s) }); try { await src.connect(); } catch (e) { /* expected */ }
  check('a failed connection is reported (no crash)', src.state === 'failed');
  m = mockBluetooth({ failConnect: 0 }); let lostCount = 0; src = new L.PolarSource({ bluetooth: m.bt, backoffMs: 2, maxAttempts: 2, onStatus: s => { if (s === 'lost') lostCount++; } }); await src.connect(); m.log.connects = 0; m.device.gatt.connect = async () => { throw new Error('out of range'); };
  m.drop(); await sleep(60); check('when reconnection keeps failing the source gives up after the allowed attempts', src.state === 'failed' && lostCount >= 3);
  check('without Web Bluetooth connect() fails with an explanation', await new L.PolarSource({ bluetooth: null }).connect().then(() => false, e => /Web Bluetooth is not available/.test(e.message)) && !L.PolarSource.supported(null) === !(globalThis.navigator && globalThis.navigator.bluetooth));

  // ---- 3. live session: accumulation, rejection, gaps, reconstruction
  const ex = E.genExampleSession().rr, fitSync = a => Promise.resolve(E.fitFromAnchor(a.rr, E.extractSpectralPriors(a.rr, a.priors), a.control));
  const feed = async (ses, rr, t0) => { let tc = 0, i = 0, t = 0, wall = t0 || 1e6; while (i < rr.length) { t += 1; const beats = []; while (i < rr.length && tc + rr[i] <= t) { tc += rr[i]; beats.push(rr[i]); i++; } wall += 1000; ses.addPacket({ rr: beats, hr: 60, wall }); await null; } return tc; };   // async: the fit promises resolve between packets, as in real time
  let ses = new L.LiveSession({ fitFn: null }); ses.addPacket({ rr: [0.1, 0.8, 0.82, 3.5, 0.0, 0.79], wall: 0 });
  check('beats outside the physiological range are rejected and counted (default 250-2500 ms)', ses.nBeats === 3 && ses.rejected === 3 && ses.log.filter(r => r.status === 'rejected').length === 3);
  ses = new L.LiveSession({ fitFn: fitSync, refitEveryS: 15, minBeats: 120, provisionalS: 300 }); const seen = new Set(); ses.o.onUpdate = l => { if (l) seen.add(l.status); };
  const tot = await feed(ses, ex); await new Promise(r => setTimeout(r, 50)); while (ses.fitting) await sleep(10);
  check('session goes collecting -> provisional -> tracking as data accumulate', seen.has('collecting') && seen.has('provisional') && seen.has('tracking'), [...seen].join(' > '));
  const nFit = ses.fits.length, expectFits = Math.floor((ses.duration - 120 * 0.9) / 15);
  check('the parameters are re-estimated about every 15 s of recording time (one fit at a time)', nFit >= expectFits * 0.7 && nFit <= expectFits + 3, nFit + ' fits in ' + ses.duration.toFixed(0) + ' s');
  check('every beat is kept and the segment time axis is the cumulative RR', ses.nBeats === ex.length && Math.abs(ses.duration - ex.reduce((a, b) => a + b, 0)) < 1e-6 && ses.segments.length === 1);
  // live vs offline
  const off = E.fitModel(ex), L0 = ses.latest, n = L0.dy.length, k0 = ex.length - n, sdp = Math.sqrt(E.derivedMetrics(off).sdP_ss ** 2), diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
  const offTail = { Xp: off.Xp.slice(k0), Xs: off.Xs.slice(k0) }, dm = E.derivedMetrics(off);
  check('the live states of the last window agree with the offline fit of the whole recording (RMS difference well below the state SD)', diff(L0.Xp, offTail.Xp) < 0.5 * dm.sdP_ss && diff(L0.Xs, offTail.Xs) < 0.5 * dm.sdS_ss, `x_p ${diff(L0.Xp, offTail.Xp).toFixed(4)} (SD ${dm.sdP_ss.toFixed(3)}), x_s ${diff(L0.Xs, offTail.Xs).toFixed(4)} (SD ${dm.sdS_ss.toFixed(3)})`);
  const tau = ses.fits[ses.fits.length - 1]; check('the last live parameters are close to the offline MAP estimates', Math.abs(Math.log(tau.tau_s / (1 / off.params.ks))) < 0.5 && Math.abs(Math.log(tau.tau_p / (1 / off.params.kp))) < 0.5, `tau_S ${tau.tau_s.toFixed(0)} vs ${(1 / off.params.ks).toFixed(0)} s, tau_P ${tau.tau_p.toFixed(1)} vs ${(1 / off.params.kp).toFixed(1)} s`);
  let t0 = process.hrtime.bigint(); for (let i = 0; i < 50; i++) ses.reconstruct(); const per = Number(process.hrtime.bigint() - t0) / 50e6;
  check('the per-beat reconstruction (one filter pass over the window) takes only a few milliseconds', per < 8, per.toFixed(2) + ' ms for ' + ses.latest.dy.length + ' beats');
  check('the window is limited to the last fitWindowS seconds', await (async () => { const s2 = new L.LiveSession({ fitFn: null, fitWindowS: 120 }); await feed(s2, ex); const w = s2.latest; return w.t[w.t.length - 1] - (w.t[0] - w.dy[0]) <= 121 && w.dy.length < 200; })());
  // gaps
  const s3 = new L.LiveSession({ fitFn: null, gapS: 4 }); let wall = 0; const feed2 = (rr) => { let i = 0; while (i < rr.length) { const b = rr.slice(i, i + 1); wall += rr[i] * 1000; s3.addPacket({ rr: b, wall }); i++; } };
  feed2(ex.slice(0, 120)); wall += 9000; feed2(ex.slice(120, 240));                                // 9 s of beats never arrived
  check('beats lost on the link (clock runs ahead of the RR time) start a new segment', s3.segments.length === 2 && s3.log.some(r => r.status === 'gap' && r.seconds > 6) && s3.segments[0].rr.length === 120 && s3.segments[1].rr.length === 120, s3.log.filter(r => r.status === 'gap').map(r => r.seconds.toFixed(1) + ' s').join());
  const s4 = new L.LiveSession({ fitFn: null }); let cum4 = 0; for (let i = 0; i < 200; i++) { cum4 += ex[i] * 1000; s4.addPacket({ rr: [ex[i]], wall: 1e6 + cum4 + (i % 7) * 120 }); }          // delays of up to 0.7 s that do not accumulate
  check('ordinary timing jitter of the radio link does not create gaps', s4.segments.length === 1);
  s3.markReconnect(); check('an explicit reconnection starts a new segment (only if the current one has beats)', s3.segments.length === 3 && (s3.markReconnect(), s3.segments.length === 3));
  check('the longest segment is what is sent to the analysis; the CSV lists beats, rejected values and gaps', s3.longestSegment().rr.length === 120 && /^segment,time_s,rr_s,status/.test(s3.toCSV()) && /gap/.test(s3.toCSV()));
  check('optional cleaning applies the prep-data gate to the window (artifacts replaced, flagged)', await (async () => { const s5 = new L.LiveSession({ fitFn: null, clean: { window: 50, n_mad: 3.5, n_iter: 2 } }); const x = ex.slice(0, 200); x[100] *= 1.9; await feed(s5, x); const l = s5.latest; return l.changed && l.changed.reduce((a, b) => a + b, 0) >= 1 && Math.abs(l.dy[100] - x[100]) > 0.3; })());
  // ---- 3b. calibration period (discarded beats at the start, as in the blueprint app)
  { const sc = new L.LiveSession({ fitFn: null }); sc.startCalibration(8, 1e6); let tc = 0, i = 0, tt = 0; const packs = [];
    while (i < 60) { tt += 1; const b = []; while (i < ex.length && tc + ex[i] <= tt) { tc += ex[i]; b.push(ex[i]); i++; } packs.push({ rr: b, hr: 60, wall: 1e6 + tt * 1000 }); if (tt > 40) break; }
    const first = packs.filter(p => p.wall - 1e6 < 8000).reduce((a, p) => a + p.rr.length, 0); packs.forEach(p => sc.addPacket(p));
    check('calibration: the beats of the first 8 s after connecting are discarded and counted, the recording starts after it', sc.calibDiscarded === first && sc.nBeats > 0 && sc.nBeats + sc.calibDiscarded === packs.reduce((a, p) => a + p.rr.length, 0) && !sc.calibrating, first + ' beats discarded');
    check('calibration: nothing is stored or reconstructed while it runs, and the segment clock starts at the first recorded beat', (() => { const s2 = new L.LiveSession({ fitFn: null }); s2.startCalibration(8, 1e6); s2.addPacket({ rr: [0.8, 0.82], wall: 1e6 + 3000 }); const none = s2.nBeats === 0 && s2.latest === null && s2.calibrating && s2.segments.length === 1 && s2.segments[0].t.length === 0; s2.addPacket({ rr: [0.8], wall: 1e6 + 8500 }); return none && s2.nBeats === 1 && Math.abs(s2.cur.t[0] - 0.8) < 1e-12; })());
    check('calibration: the time left counts down in real time whatever the clock of the packets (the full period is shown until a reference exists)', (() => { const s3 = new L.LiveSession({ fitFn: null }); s3.startCalibration(8, null); const full = s3.calibrationLeft(L.now()) === 8; s3.addPacket({ rr: [], wall: 2e6 }); const mid = Math.abs(s3.calibrationLeft(L.now() + 3000) - 5) < 0.2, end = s3.calibrationLeft(L.now() + 9000) === 0; const s8 = new L.LiveSession({ fitFn: null }), t0 = L.now(); s8.startCalibration(8, t0); const real = Math.abs(s8.calibrationLeft(t0 + 2000) - 6) < 1e-6; return full && mid && end && real; })());
    check('calibration: 0 s turns it off; without startCalibration nothing is discarded', (() => { const s4 = new L.LiveSession({ fitFn: null }); s4.startCalibration(0, 1e6); s4.addPacket({ rr: [0.8], wall: 1e6 + 100 }); const s5 = new L.LiveSession({ fitFn: null }); s5.addPacket({ rr: [0.8], wall: 1 }); return s4.nBeats === 1 && !s4.calibrating && s5.nBeats === 1 && s5.calibDiscarded === 0; })());
    check('calibration: it restarts after a reconnection (a new segment begins after it)', (() => { const s6 = new L.LiveSession({ fitFn: null }); s6.startCalibration(2, 1e6); s6.addPacket({ rr: [0.8], wall: 1e6 + 500 }); s6.addPacket({ rr: [0.8, 0.8], wall: 1e6 + 2500 }); s6.markReconnect(); s6.startCalibration(2, 5e6); s6.addPacket({ rr: [0.8], wall: 5e6 + 400 }); s6.addPacket({ rr: [0.81, 0.82], wall: 5e6 + 2600 }); return s6.calibDiscarded === 2 && s6.segments.length === 2 && s6.segments[0].rr.length === 2 && s6.segments[1].rr.length === 2; })());
    check('calibration: summary and CSV declare it (seconds and discarded beats)', (() => { const s7 = new L.LiveSession({ fitFn: null }); s7.startCalibration(8, 1e6); s7.addPacket({ rr: [0.8, 0.8], wall: 1e6 + 1000 }); s7.addPacket({ rr: [0.8], wall: 1e6 + 9000 }); const sm = s7.summary(), csv = s7.toCSV().split('\n'); return sm.calibration.seconds === 8 && sm.calibration.discarded_beats === 2 && /^# Calibration period: 8 seconds/.test(csv[0]) && /^segment,time_s,rr_s,status/.test(csv[1]); })()); }
  // ---- 3c. smooth display helpers
  { const S = L.smooth; let tD = null, latest = 0, idx = 0, tb = 0, next = ex[0], prev = null, back = false, ahead = false, maxS = 0, minS = 9; const lags = [], rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let clock = 0; clock < 60; clock += 0.033) { while (idx < ex.length && next <= clock - 0.4 * rnd()) { tb += ex[idx]; latest = tb; idx++; next += ex[idx] || 0; }
      if (latest > 0) { const nt = S.advance(tD, latest, 0.033, 1.0); if (tD != null) { const sp = (nt - tD) / 0.033; maxS = Math.max(maxS, sp); minS = Math.min(minS, sp); if (nt < tD - 1e-12) back = true; } if (nt > latest + 1e-9) ahead = true; tD = nt; if (clock > 10) lags.push(latest - tD); } }
    const meanLag = lags.reduce((a, b) => a + b, 0) / lags.length;
    check('smooth display: the display time advances continuously (0.5x-3x real time), never backwards and never ahead of the newest beat, despite the jitter of the beat arrivals', !back && !ahead && minS >= 0.49 && maxS <= 3.01, `speed ${minS.toFixed(2)}-${maxS.toFixed(2)}x`);
    check('smooth display: it settles at the chosen delay behind the newest beat', Math.abs(meanLag - 1.0) < 0.35, 'mean lag ' + meanLag.toFixed(2) + ' s');
    check('smooth display: a new segment or a burst of beats snaps to the target instead of crawling', S.advance(5, 200, 0.033, 1) === 199 && S.advance(null, 0.85, 0.033, 1) === 0 && S.advance(100, 50, 0.033, 1) === 49);
    const tt = [0, 1, 2, 4], yy = [10, 20, 40, 0];
    check('smooth display: interpolation between beats is linear and holds the end values outside the data', S.interpAt(tt, yy, 0.5) === 15 && S.interpAt(tt, yy, 1.5) === 30 && S.interpAt(tt, yy, 3) === 20 && S.interpAt(tt, yy, -1) === 10 && S.interpAt(tt, yy, 9) === 0 && S.upper(tt, 2) === 3 && S.upper(tt, 1.99) === 2);
    const v1 = S.viewRange(10, 300, 30), v2 = S.viewRange(100, 300, 30), v3 = S.viewRange(500, 300, 30);
    check('smooth display: the time window is 30 s at least, expands until the chart window is full and then scrolls', v1.xmin === 0 && v1.xmax === 30 && v2.xmin === 0 && v2.xmax === 100 && v3.xmin === 200 && v3.xmax === 500);
    let r = null; for (let k = 0; k < 120; k++) r = S.easeRange(r, { lo: 1, hi: 2 }, 0.033, 0.7); const r0 = S.easeRange({ lo: 0, hi: 1 }, { lo: 1, hi: 2 }, 0.033, 0.7);
    check('smooth display: the vertical scale eases toward its target without jumping', Math.abs(r.lo - 1) < 0.05 && Math.abs(r.hi - 2) < 0.05 && r0.lo > 0 && r0.lo < 0.1); }
  // ---- 4. simulated sensor through the whole chain
  const got = []; const sim = new L.SimulatedSource(ex, { speed: 50, onPacket: q => got.push(q) }); sim.state = 'streaming'; sim.advance(100);
  check('simulated sensor: packets about once per second carry all the beats up to that time', got.length >= 99 && got.length <= 101 && Math.abs(got.reduce((a, q) => a + q.rr.reduce((x, y) => x + y, 0), 0) - 100) < 1.2, got.length + ' packets');
  sim.advance(ex.reduce((a, b) => a + b, 0) + 5); check('simulated sensor: stops at the end with every beat delivered once', sim.finished && got.reduce((a, q) => a + q.rr.length, 0) === ex.length);
  const dr = []; const sim2 = new L.SimulatedSource(ex, { speed: 100, dropAt: [{ at: 200, lose: 12 }], onPacket: q => dr.push(q) }); sim2.state = 'streaming'; sim2.advance(500);
  const s6 = new L.LiveSession({ fitFn: null }); dr.forEach(q => s6.addPacket(q)); check('simulated sensor with a 12 s drop-out: the session detects the gap', s6.segments.length === 2 && s6.log.some(r => r.status === 'gap'), s6.summary().segments.map(s => s.beats).join('+') + ' beats');
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();

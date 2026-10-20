/* ============================================================================
   SPARK live: RR intervals in real time (Polar H10 over Web Bluetooth) and reconstruction on the go. Pure logic, no DOM, so it also runs in Node (tests/test_live.js).

   Sensor protocol (standard Bluetooth Heart Rate profile, what the Polar H10 implements): service 0x180D, characteristic 0x2A37 (notifications).
     byte 0   flags: bit 0 heart rate is uint16 (else uint8) | bits 1-2 sensor contact (2 = supported, no contact; 3 = supported, contact) |
                     bit 3 energy expended present (uint16) | bit 4 RR intervals present
     then     heart rate, [energy], and any number of RR intervals, each a little-endian uint16 in units of 1/1024 s.
   Battery: service 0x180F, characteristic 0x2A19 (optional). The ECG/accelerometer service of the H10 is not needed and is not used.

   Reconstruction: every accepted beat extends the current segment; the M3 filter is run on the last `fitWindowS` seconds with the latest parameters (a pass takes well
   under a millisecond), and the parameters (kappa_S, kappa_P, Lambda_R) and the spectral anchor are re-estimated by the MAP fit every `refitEveryS` seconds of
   recording time (through `fitFn`, a Web Worker in the app). A gap (disconnection, or beats lost on the radio link) starts a new segment.
   Calibration (as in the original app that served as blueprint): after the sensor connects, the RR intervals received during `calibrationS` seconds (default 8) are discarded - the
   electrodes settle and the first beats are unreliable - and the recording (time zero of the first segment) starts after it. It restarts after an automatic reconnection.
   ========================================================================== */
(function (root) {
'use strict';
const UUID = {
  HR_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb', HR_MEASUREMENT: '00002a37-0000-1000-8000-00805f9b34fb',
  BATTERY_SERVICE: '0000180f-0000-1000-8000-00805f9b34fb', BATTERY_LEVEL: '00002a19-0000-1000-8000-00805f9b34fb'
};
const getEngine = () => root.SparkEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowMs = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

/** Parse one Heart Rate Measurement notification (a DataView). RR intervals are returned in seconds. */
function parseHRMeasurement(dv) {
  if (!dv || dv.byteLength < 2) throw new Error('Heart-rate packet too short');
  const flags = dv.getUint8(0), wide = (flags & 0x01) === 1, contactBits = (flags >> 1) & 0x03, hasEnergy = (flags & 0x08) !== 0, hasRR = (flags & 0x10) !== 0;
  let off = 1; const hr = wide ? dv.getUint16(off, true) : dv.getUint8(off); off += wide ? 2 : 1;
  let energy = null; if (hasEnergy) { if (off + 2 <= dv.byteLength) energy = dv.getUint16(off, true); off += 2; }
  const rr = []; if (hasRR) for (; off + 2 <= dv.byteLength; off += 2) rr.push(dv.getUint16(off, true) / 1024);
  return { hr, contact: contactBits === 2 ? false : contactBits === 3 ? true : null, energy, rr };
}
/** Build a Heart Rate Measurement packet (used by the simulated sensor and by the tests). */
function buildHRMeasurement(hr, rrSeconds, opts) {
  const o = opts || {}, wide = !!o.wide || hr > 255, n = (rrSeconds || []).length, buf = new ArrayBuffer(1 + (wide ? 2 : 1) + (o.energy != null ? 2 : 0) + 2 * n), dv = new DataView(buf);
  let flags = (wide ? 1 : 0) | ((o.contact === true ? 3 : o.contact === false ? 2 : 0) << 1) | (o.energy != null ? 0x08 : 0) | (n ? 0x10 : 0), off = 1; dv.setUint8(0, flags);
  if (wide) dv.setUint16(off, hr, true); else dv.setUint8(off, hr); off += wide ? 2 : 1;
  if (o.energy != null) { dv.setUint16(off, o.energy, true); off += 2; }
  (rrSeconds || []).forEach(v => { dv.setUint16(off, Math.round(v * 1024), true); off += 2; });
  return dv;
}

/* ---- the sensor ---------------------------------------------------------------------------------------------------------------------------------- */
/** Polar H10 (any Bluetooth Heart Rate sensor) over Web Bluetooth. Callbacks: onPacket({hr, contact, rr, wall}), onStatus(state, info), onBattery(percent), onReconnect().
    States: idle | scanning | connecting | streaming | lost | failed. Needs Chrome or Edge (desktop or Android) on https:// or localhost. */
class PolarSource {
  constructor(opts) {
    const o = opts || {}; this.bt = o.bluetooth || (root.navigator && root.navigator.bluetooth) || null; this.autoReconnect = o.autoReconnect !== false; this.maxAttempts = o.maxAttempts || 5; this.backoffMs = o.backoffMs != null ? o.backoffMs : 1500;
    ['onPacket', 'onStatus', 'onBattery', 'onReconnect'].forEach(k => { this[k] = o[k] || (() => {}); });
    this.device = null; this.hrChar = null; this.batChar = null; this.state = 'idle'; this._closing = false; this._reconnecting = false; this.name = '';
    this._onHR = ev => { try { const p = parseHRMeasurement(ev.target.value); p.wall = nowMs(); this.onPacket(p); } catch (e) { this._status(this.state, { warning: String(e.message || e) }); } };
    this._onBat = ev => { try { this.onBattery(ev.target.value.getUint8(0)); } catch (e) { /* ignore */ } };
    this._onLost = () => { if (this._closing) return; this._status('lost'); if (this.autoReconnect) this._reconnect(); };
  }
  static supported(bt) { return !!(bt || (root.navigator && root.navigator.bluetooth)); }
  _status(s, info) { this.state = s; this.onStatus(s, Object.assign({ name: this.name }, info || {})); }
  async connect() {
    if (!this.bt) { this._status('failed', { reason: 'unsupported' }); throw new Error('Web Bluetooth is not available in this browser (use Chrome or Edge, on https:// or localhost).'); }
    this._closing = false;
    try {
      this._status('scanning');
      this.device = await this.bt.requestDevice({ filters: [{ services: [UUID.HR_SERVICE] }], optionalServices: [UUID.BATTERY_SERVICE] });
      this.name = this.device.name || 'Heart-rate sensor'; this.device.addEventListener('gattserverdisconnected', this._onLost);
      await this._open();
    } catch (e) { this._status('failed', { reason: e && e.name === 'NotFoundError' ? 'cancelled' : 'error', message: String(e && e.message || e) }); throw e; }
  }
  async _open() {
    this._status('connecting');
    const server = await this.device.gatt.connect(), hrService = await server.getPrimaryService(UUID.HR_SERVICE);
    this.hrChar = await hrService.getCharacteristic(UUID.HR_MEASUREMENT); this.hrChar.addEventListener('characteristicvaluechanged', this._onHR); await this.hrChar.startNotifications();
    try {                                                    // the battery service is optional
      const bs = await server.getPrimaryService(UUID.BATTERY_SERVICE); this.batChar = await bs.getCharacteristic(UUID.BATTERY_LEVEL);
      this.batChar.addEventListener('characteristicvaluechanged', this._onBat); await this.batChar.startNotifications(); this._onBat({ target: { value: await this.batChar.readValue() } });
    } catch (e) { this.batChar = null; }
    this._status('streaming');
  }
  async _reconnect() {
    if (this._reconnecting) return; this._reconnecting = true;
    for (let k = 1; k <= this.maxAttempts && !this._closing; k++) {
      await sleep(this.backoffMs * k); if (this._closing) break;
      try { await this._open(); this._reconnecting = false; this.onReconnect(); return; } catch (e) { this._status('lost', { attempt: k }); }
    }
    this._reconnecting = false; if (!this._closing) this._status('failed', { reason: 'reconnect' });
  }
  async disconnect() {
    this._closing = true;
    try { if (this.hrChar) { this.hrChar.removeEventListener('characteristicvaluechanged', this._onHR); await this.hrChar.stopNotifications(); } } catch (e) { /* ignore */ }
    try { if (this.batChar) { this.batChar.removeEventListener('characteristicvaluechanged', this._onBat); await this.batChar.stopNotifications(); } } catch (e) { /* ignore */ }
    try { if (this.device) { this.device.removeEventListener('gattserverdisconnected', this._onLost); if (this.device.gatt && this.device.gatt.connected) this.device.gatt.disconnect(); } } catch (e) { /* ignore */ }
    this.hrChar = null; this.batChar = null; this._status('idle');
  }
}

/** A sensor that plays back a given RR series in real time (speed 1) or faster: demonstration without a device, and the tests. Emits one packet per `packetS` of recording time. */
class SimulatedSource {
  constructor(rr, opts) {
    const o = opts || {}; this.rr = Array.from(rr); this.speed = o.speed || 1; this.packetS = o.packetS || 1; this.loop = !!o.loop; this.dropAt = o.dropAt || null;   // dropAt: [{ at: seconds, lose: seconds }] -> beats are lost
    ['onPacket', 'onStatus', 'onBattery'].forEach(k => { this[k] = o[k] || (() => {}); });
    this.state = 'idle'; this.name = 'Simulated sensor'; this.i = 0; this.tRec = 0; this.tNext = this.packetS; this._timer = null; this._wall = 0; this.finished = false;
  }
  _status(s) { this.state = s; this.onStatus(s, { name: this.name }); }
  async connect() { this._status('streaming'); this.onBattery(100); this._wall = nowMs(); this._timer = setInterval(() => this.advance(((nowMs() - this._wall) / 1000) * this.speed), 100); }
  /** Advance the playback to `seconds` of recording time since the start (deterministic; also used by the timer). */
  advance(seconds) {
    this._wall = nowMs() - (seconds / this.speed) * 1000; const total = this.rr.reduce((a, b) => a + b, 0);
    while (this.tNext <= seconds && this.state === 'streaming') {
      const beats = [], emitAt = this.tNext; let t = this.tRec;
      while (this.i < this.rr.length && t + this.rr[this.i] <= this.tNext) { t += this.rr[this.i]; beats.push(this.rr[this.i]); this.i++; }
      this.tRec = t; this.tNext += this.packetS;
      const lost = this.dropAt && this.dropAt.some(d => t >= d.at && t < d.at + d.lose);
      if (beats.length && !lost) this.onPacket({ hr: Math.round(60 * beats.length / beats.reduce((a, b) => a + b, 0)), contact: true, energy: null, rr: beats, wall: 1e6 + emitAt * 1000 });   // virtual clock: runs in recording time, so an accelerated playback keeps the timing a real sensor would show
      if (this.i >= this.rr.length) { if (this.loop) { this.i = 0; } else { this.finished = true; this._status('idle'); this.stopTimer(); } }
    }
  }
  stopTimer() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
  async disconnect() { this.stopTimer(); this._status('idle'); }
}

/* ---- the session: accumulation, gaps and reconstruction ---------------------------------------------------------------------------------------------- */
const DEFAULT_LIVE = { fitWindowS: 600, refitEveryS: 15, minBeats: 120, provisionalS: 300, chartWindowS: 300, rrMinMs: 250, rrMaxMs: 2500, gapS: 4, clean: null, maxBeats: 30000 };
class LiveSession {
  /** opts: { fitWindowS (0 = all), refitEveryS, minBeats, provisionalS, rrMinMs, rrMaxMs, gapS, clean (cleaning options or null), priors, control, fitFn(args) -> Promise<{params, pr, opt}>, onUpdate(latest) } */
  constructor(opts) { this.o = Object.assign({}, DEFAULT_LIVE, opts || {}); this.reset(); }
  reset() {
    this.calibration = null; this.calibSeconds = 0; this.calibDiscarded = 0; this.segments = []; this.log = []; this.rejected = 0; this.recClock = 0; this.params = null; this.pr = null; this.lastFitAt = -Infinity; this.fits = []; this.fitting = false; this.lastError = null; this.latest = null; this.hr = null; this.contact = null; this.packets = 0; this._newSegment('start');
  }
  setOptions(o) { Object.assign(this.o, o || {}); }
  /** Begin a calibration period: beats received during the next `seconds` are discarded. `wall` (ms, the clock of the packets) is when the sensor connected; without it the first packet starts the period. 0 = no calibration. */
  startCalibration(seconds, wall) { const s = Math.max(0, +seconds || 0); this.calibSeconds = s; this.calibration = s > 0 ? { seconds: s, startWall: wall == null ? null : wall, done: false } : null; this._emit(); }
  get calibrating() { return !!(this.calibration && !this.calibration.done); }
  /** Seconds of calibration left at the real time `nowReal` (ms, performance.now()). The time on the clock of the packets is estimated from the last packet seen (so a sensor with another clock, such as the simulated one, still counts down correctly); the full period is shown until a reference exists. */
  calibrationLeft(nowReal) {
    const c = this.calibration; if (!c || c.done || c.startWall === null) return c && !c.done ? c.seconds : 0;
    const est = c.lastWall != null ? c.lastWall + (nowReal - c.lastReal) : nowReal;
    return Math.max(0, c.seconds - (est - c.startWall) / 1000);
  }
  _newSegment(reason) { this.cur = { id: this.segments.length, rr: [], t: [], reason, wall0: null, drift0: null }; this.segments.push(this.cur); }
  get nBeats() { return this.segments.reduce((a, s) => a + s.rr.length, 0); }
  get duration() { return this.segments.reduce((a, s) => a + (s.t.length ? s.t[s.t.length - 1] : 0), 0); }
  /** Start a new segment explicitly (the sensor reconnected). */
  markReconnect() { if (this.cur.rr.length) this._newSegment('reconnect'); }
  addPacket(p) {
    const E = getEngine(), rr = (p.rr || []).map(Number); this.packets++; if (p.hr != null) this.hr = p.hr; if (p.contact != null) this.contact = p.contact;
    const cal = this.calibration;
    if (cal && !cal.done) {                                                                  // calibration: nothing is stored or reconstructed
      const w0 = p.wall != null ? p.wall : nowMs(); if (cal.startWall === null) cal.startWall = w0; cal.lastWall = w0; cal.lastReal = nowMs();
      if ((w0 - cal.startWall) / 1000 < cal.seconds) { this.calibDiscarded += rr.length; this._emit(); return; }
      cal.done = true;
    }
    const ok = [], lo = this.o.rrMinMs / 1000, hi = this.o.rrMaxMs / 1000;
    for (const v of rr) { if (v >= lo && v <= hi) ok.push(v); else { this.rejected++; this.log.push({ seg: this.cur.id, status: 'rejected', rr: v, t: null }); } }
    if (!ok.length) { this._emit(); return; }
    const wall = p.wall != null ? p.wall : nowMs(), sum = ok.reduce((a, b) => a + b, 0), c = this.cur, tEnd = (c.t.length ? c.t[c.t.length - 1] : 0) + sum;
    if (c.wall0 === null) c.wall0 = wall - sum * 1000;
    const drift = (wall - c.wall0) / 1000 - tEnd;                                        // time elapsed on the clock minus the time covered by the beats: grows when beats are lost
    if (c.drift0 !== null && drift - c.drift0 > this.o.gapS) { this.log.push({ seg: c.id, status: 'gap', seconds: drift - c.drift0 }); this._newSegment('gap'); return this.addPacket(Object.assign({}, p, { rr: ok })); }
    for (const v of ok) { const last = c.t.length ? c.t[c.t.length - 1] : 0; c.rr.push(v); c.t.push(last + v); this.log.push({ seg: c.id, status: 'ok', rr: v, t: last + v }); this.recClock += v; }
    if (c.drift0 === null && c.rr.length >= 8) c.drift0 = drift;
    if (this.nBeats > this.o.maxBeats) this._trim();
    this.reconstruct(); this._maybeRefit(); this._emit();
  }
  _trim() { const s = this.segments[0]; if (s !== this.cur && s) { this.segments.shift(); } else if (s && s.rr.length > this.o.maxBeats / 2) { const k = Math.floor(s.rr.length / 2); s.rr.splice(0, k); const t0 = s.t[k - 1]; s.t.splice(0, k); s.t = s.t.map(x => x - t0); } }
  /** Last `fitWindowS` seconds of the current segment, optionally cleaned with the gate of tools/prep-data.R. */
  windowSeries() {
    const E = getEngine(), c = this.cur, n = c.rr.length; if (!n) return null; let i0 = 0;
    if (this.o.fitWindowS > 0) { const tMin = c.t[n - 1] - this.o.fitWindowS; while (i0 < n - 1 && c.t[i0] <= tMin) i0++; }
    const raw = c.rr.slice(i0); let used = raw, changed = null;
    if (this.o.clean && raw.length >= 3) { try { const r = E.cleanSample(raw, this.o.clean); if (!Array.prototype.some.call(r.y, v => !isFinite(v))) { used = Array.from(r.y); changed = Array.from(r.changed); } } catch (e) { /* keep raw */ } }
    const t0 = i0 ? c.t[i0 - 1] : 0, t = new Array(used.length); let acc = t0; for (let i = 0; i < used.length; i++) { acc += used[i]; t[i] = acc; }
    return { i0, raw, rr: used, t, changed };
  }
  /** One pass of the M3 filter over the window with the latest parameters. */
  reconstruct() {
    const E = getEngine(), w = this.windowSeries(); if (!w) return;
    const info = { seg: this.cur.id, n: w.rr.length, windowS: w.t.length ? w.t[w.t.length - 1] - (w.t[0] - w.rr[0]) : 0, t: w.t, dy: w.rr, raw: w.raw, changed: w.changed, params: null, status: 'collecting' };
    if (this.params && this.pr && w.rr.length >= 20) {
      try {
        const ctl = this.o.control || E.sparkControl(), r = E.runGLSFilter(w.rr, this.params.kp, this.params.ks, this.pr.energy_ratio, this.params.lR, ctl);
        if (r.ok) { Object.assign(info, { irr: r.irr, rrV: r.rrV, Xp: r.Xp, Xs: r.Xs, XpV: r.XpV, XsV: r.XsV, params: { ks: this.params.ks, kp: this.params.kp, lR: this.params.lR, lp: this.pr.energy_ratio, nu0: r.nu0, sig2: r.sig2 } });
          info.status = info.windowS >= this.o.provisionalS ? 'tracking' : 'provisional'; }
      } catch (e) { this.lastError = e; }
    }
    this.latest = info;
  }
  _maybeRefit() {
    if (!this.o.fitFn || this.fitting || this.cur.rr.length < this.o.minBeats) return;
    if (this.params && this.recClock - this.lastFitAt < this.o.refitEveryS) return;
    this.fit(); 
  }
  /** Re-estimate the parameters now (asynchronously) on the current window. @return Promise */
  fit() {
    const w = this.windowSeries(); if (!w || w.rr.length < 30 || !this.o.fitFn || this.fitting) return Promise.resolve(null);
    this.fitting = true; const t0 = nowMs(), E = getEngine(), mark = this.recClock;
    return Promise.resolve(this.o.fitFn({ rr: w.rr, priors: this.o.priors || E.sparkPriors(), control: this.o.control || E.sparkControl() })).then(f => {
      this.fitting = false; this.lastFitAt = mark;
      if (f && f.params && f.opt && f.pr) {
        this.params = { ks: f.params.ks, kp: f.params.kp, lR: f.params.lR }; this.pr = f.pr;
        this.fits.push({ at: mark, ms: nowMs() - t0, n: w.rr.length, tau_s: 1 / f.params.ks, tau_p: 1 / f.params.kp, lp: f.pr.energy_ratio, nu0: f.params.nu0, converged: f.opt.convergence === 0 });
        if (this.fits.length > 500) this.fits.shift();
      }
      this.reconstruct(); this._emit(); return f;
    }, e => { this.fitting = false; this.lastError = e; this._emit(); return null; });
  }
  _emit() { if (this.o.onUpdate) { try { this.o.onUpdate(this.latest, this); } catch (e) { console.error(e); } } }
  /** RMSSD (ms) of the used series over the last `seconds`. */
  rmssd(seconds) { const w = this.latest; if (!w || w.dy.length < 3) return null; const t = w.t, n = t.length; let i0 = n - 1; while (i0 > 0 && t[n - 1] - t[i0 - 1] < seconds) i0--; if (n - i0 < 3) return null; let s = 0, m = 0; for (let i = i0 + 1; i < n; i++) { const d = w.dy[i] - w.dy[i - 1]; s += d * d; m++; } return 1000 * Math.sqrt(s / m); }
  /** The longest segment (what "send to the analysis" uses). */
  longestSegment() { return this.segments.reduce((a, s) => (!a || s.rr.length > a.rr.length) ? s : a, null); }
  toCSV() { const rows = this.calibSeconds > 0 ? [`# Calibration period: ${this.calibSeconds} seconds (RR intervals received during it are excluded from the data)`, 'segment,time_s,rr_s,status'] : ['segment,time_s,rr_s,status']; this.log.forEach(r => { rows.push([r.seg, r.t != null ? r.t.toFixed(4) : '', r.rr != null ? r.rr.toFixed(6) : '', r.status + (r.seconds ? ' ' + r.seconds.toFixed(1) + ' s' : '')].join(',')); }); return rows.join('\n') + '\n'; }
  summary() { return { beats: this.nBeats, rejected: this.rejected, calibration: { seconds: this.calibSeconds, discarded_beats: this.calibDiscarded }, segments: this.segments.map(s => ({ id: s.id, beats: s.rr.length, duration_s: s.t.length ? s.t[s.t.length - 1] : 0, started_by: s.reason })), gaps: this.log.filter(r => r.status === 'gap').length, fits: this.fits.length, duration_s: this.duration }; }
}

/* ---- smooth, continuous display ------------------------------------------------------------------------------------------------------------------------ */
/** Pure helpers of the live plots. The plot is drawn at a display time `tDisp` that moves forward continuously (about 1 s per s) and stays `delayS` behind the newest beat, so the curve
    is interpolated between beats instead of jumping at each one, whatever the jitter of the radio link. */
const SMOOTH = {
  clamp: (x, a, b) => Math.min(Math.max(x, a), b),
  /** One frame: move `tDisp` toward `latest - delayS` at 0.5x-3x real time (1x when on target); never backwards, never ahead of the newest beat; a big gap (new segment, burst) snaps. */
  advance(tDisp, latest, dtS, delayS) {
    const target = latest - delayS; if (tDisp == null || !isFinite(tDisp) || Math.abs(target - tDisp) > 15) return Math.max(0, Math.min(target, latest));
    const speed = SMOOTH.clamp(1 + 1.5 * (target - tDisp), 0.5, 3); let t = tDisp + speed * Math.max(0, dtS); if (t > latest) t = latest; return Math.max(t, tDisp);
  },
  /** Number of points with t <= tq (t ascending). */
  upper(t, tq) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] <= tq) lo = m + 1; else hi = m; } return lo; },
  /** Linear interpolation of y(t) at tq; the end values outside the data. */
  interpAt(t, y, tq) { const n = t.length; if (!n) return NaN; if (tq <= t[0]) return y[0]; if (tq >= t[n - 1]) return y[n - 1]; const i = SMOOTH.upper(t, tq); const f = (tq - t[i - 1]) / (t[i] - t[i - 1]); return y[i - 1] + f * (y[i] - y[i - 1]); },
  /** Visible time range: the last `windowS` seconds, starting at 0 until the window is full, and never narrower than `minSpanS`. */
  viewRange(tDisp, windowS, minSpanS) { const xmin = Math.max(0, tDisp - windowS); return { xmin, xmax: Math.max(tDisp, xmin + minSpanS) }; },
  /** Exponential easing of an axis range toward its target (time constant tauS): the vertical scale moves without jumps. */
  easeRange(cur, target, dtS, tauS) { if (!cur) return { lo: target.lo, hi: target.hi }; const a = 1 - Math.exp(-Math.max(0, dtS) / tauS); return { lo: cur.lo + (target.lo - cur.lo) * a, hi: cur.hi + (target.hi - cur.hi) * a }; }
};

root.SparkLive = { UUID, parseHRMeasurement, buildHRMeasurement, PolarSource, SimulatedSource, LiveSession, DEFAULT_LIVE, now: nowMs, smooth: SMOOTH };
if (typeof module !== 'undefined' && module.exports) module.exports = root.SparkLive;
})(typeof window !== 'undefined' ? window : globalThis);

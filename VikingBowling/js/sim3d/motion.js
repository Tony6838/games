// ---------------------------------------------------------------------------
// motion.js - the throw by swinging the phone (the motion sensors), the default way to throw
// on a phone or tablet that has them; the swipe (input.js) stays as a setting.
//
// The gesture: hold the phone like a ball, press and HOLD the big swing button with the thumb,
// swing the arm back and forward, and let go of the button to let go of the ball.
//   speed  the forward swing's rate of rotation (the gyroscope, deg/s), put on the swipe's own
//          speed curve (input.js motionParams: weakDps is the weakest swipe, topDps the fastest)
//   aim    first, as a bowler picks an arrow: pressed and held still, turning the phone left
//          or right (about the vertical) moves a marker over the lane's arrows (board 5 to 35)
//          and the aim line; the backswing locks it, and the ball is launched at it
//   line   the turning during the swing is an error on top of the aim (a pull or a push), with
//          its own dead zone and a smaller gain: a straight swing follows the aim exactly
//   hook   the wrist's turn about the arm in the last moment before the release
//   timing letting go at the bottom of the forward swing gives the line aimed; clearly early
//          or late adds a small line error (early right, late left, at most 3 boards at the
//          arrows), growing with how far off the release was
// Letting go without a forward swing, during the backswing or long after the swing cancels
// with a hint; a forward swing that is too slow or too short is "too weak", as a swipe is.
//
// Everything is measured in the device's own frame and does not depend on how the phone is
// held (portrait, landscape, screen in or out): the swing is the rotation about its main axis
// (the shoulder's), found from the data; "up" is tracked by integrating the gyroscope from
// the accelerometer's gravity at rest; the arm's axis is "down" at the bottom of the swing.
// Two platform conventions are checked from the data rather than trusted: which of the
// rotation rate's alpha/beta/gamma is which device axis (Chromium gives alpha = x, beta = y,
// gamma = z, which is the default; the gyroscope's prediction of how gravity turns is compared
// with the accelerometer while the phone is handled, and a better fitting mapping wins), and
// the sign of accelerationIncludingGravity (against the orientation event's beta/gamma).
//
// Sensor events (devicemotion, deviceorientation) need a secure context (https or localhost).
// iOS asks for permission (DeviceMotionEvent.requestPermission) and that must come from a tap,
// so the first use shows a short card with the button that asks; a denial, or no sensor data
// within about a second, falls back to the swipe with a note.
// ---------------------------------------------------------------------------
import { t as tr } from '../i18n.js';
import { MotionDemo } from './motiondemo.js';

export const MOTION = {
  g: 9.81,
  movingDps: 40,        // the swing rate (about the swing's axis) above this is a swing lobe
  gapMs: 60,            // a lobe goes on through a dip below movingDps this short
  lobeDeg: 12, lobeDps: 50,    // a lobe that counts: at least this far and this fast
  backDeg: 20, backRatio: 0.4, // the backswing: the first lobe that counts and is at least this far
                               // (and this share of the largest lobe: a small push forward first is not it)
  lateMs: 400,          // the forward swing may have ended this long before the button is let go
  weakDps: 73, topDps: 900,    // the forward swing's rate on the swipe's curve: weakDps = THROW.weakMmS,
                               // topDps = THROW.topMmS, log-log linear between (input.js motionParams)
  fwdDeg: 15,           // a forward swing shorter than this is too weak
  peakMs: 45,           // the swing rate: the highest mean over this window
  twistMs: 180,         // the hook: the wrist's turn over the last 180 ms before the release
  // the aim: 1 board at the arrows (15 ft) per degree the phone is turned, board 5 to 35; the
  // marker smoothed over 120 ms; locked when the backswing starts (turning about a level axis faster
  // than lockDps for lockMs), at the mean over aimMeanMs ending lockRefMs before that (exact when
  // the aim is held, and a wobbling hand averages out)
  arrowsM: 4.572, boardM: 1.0541 / 39, aimBoardsPerDeg: 1, aimMinBoard: 5, aimMaxBoard: 35,
  aimTauMs: 120, aimMeanMs: 250, lockDps: 60, lockMs: 40, lockRefMs: 100,
  pullDeadDeg: 5, pullPerRad: 0.03,                     // the turning during the swing: a pull or a push
  angleMax: 0.15,                                       // the launch angle, aim and errors together (rad)
  twistDeadDeg: 8, sidePerRad: 18,                      // wrist turn -> side rotation, as the swipe's curve
  // release timing: let go at the bottom of the forward swing (or a little past it) and the line
  // is the one aimed; clearly early pushes the ball right, clearly late pulls it left, growing
  // with how far off, up to 3 boards at the arrows (15 ft) for 40 degrees of swing past the window
  releaseEarlyDeg: -10, releaseLateDeg: 30, releaseRampDeg: 40,
  releaseMaxRad: 3 * 0.02703 / 4.572,                   // 3 boards (1.064 in) at 4.572 m
  passedShare: 0.985,   // the rate (smoothed over +-25 ms) fell below this share of its peak: the bottom was passed
  calibMs: 500, calibMaxMs: 2500, stillDps: 25, stillAcc: 1.5,   // "hold still"
  noEventsMs: 1000,     // no sensor data after two of these since starting: no motion control
  minHz: 20,            // sensor events slower than this cannot follow a swing: the swipe instead
  badPresses: 2,        // presses in a row whose sensor stream was too slow or had stalled: the swipe
  permissionMs: 12000,  // the permission request (iOS) has not been answered this long: the swipe
  pauseMs: 20000,       // the button not shown this long (machine players' turns): the sensors stop
  keepMs: 8000,         // sensor history kept
  holdMaxMs: 60000      // ... but from the press on, for as long as the button is held (up to this)
};

const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 1]; };

// A world-fixed vector v, seen from a device turning at w (deg/s, device frame) for dt seconds:
// it turns the other way (Rodrigues about w by -|w| dt)
export function turnFixed(v, w, dt) {
  const r = len(w) * D2R * dt;
  if (r < 1e-9) return v;
  const k = scale(w, 1 / len(w)), c = Math.cos(-r), s = Math.sin(-r), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

// "Up" in the device frame from the orientation event (W3C Z-X'-Y'' angles): the third row of
// R = Rz(alpha) Rx(beta) Ry(gamma)
export function upFromOrientation(beta, gamma) {
  const b = beta * D2R, g = gamma * D2R;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

// The candidate mappings of rotationRate onto the device axes x, y, z: alpha about x, beta about
// y, gamma about z first (what Chromium delivers, checked with its sensor emulation), used until
// the data say otherwise; then the order of the orientation event's angles (alpha about z) and
// both with the opposite sense of rotation
export const FRAMES = [
  { id: 'xyz', f: (r) => [r.alpha, r.beta, r.gamma] },
  { id: 'xyz-', f: (r) => [-r.alpha, -r.beta, -r.gamma] },
  { id: 'zxy', f: (r) => [r.beta, r.gamma, r.alpha] },
  { id: 'zxy-', f: (r) => [-r.beta, -r.gamma, -r.alpha] }
];

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

// ---- the sensor stream ----------------------------------------------------------------------
// push() takes one devicemotion event's data: { t (ms, the event's own clock), rr: rotationRate
// { alpha, beta, gamma } deg/s, ag: accelerationIncludingGravity { x, y, z } m/s2, interval }
export class MotionTracker {
  constructor() {
    this.samples = [];
    this.up = null;
    this.bias = [0, 0, 0];
    this.frame = 0;
    this.accSign = 1;
    this.lastT = 0;
    this.events = 0; this.gyroEvents = 0; this.accEvents = 0;
    this.frameErr = FRAMES.map(() => 0);
    this.frameRot = 0;
    this.fc = null;
    this.signVotes = 0; this.signSum = 0;
    this.oriUp = null; this.oriT = -1e9;
    this.calibrated = false;
    this.swinging = false;       // the swing button is held: no checks, no gravity pull on "up"
    this.restMs = 0;
    this.keepFrom = null;        // the press (ms): its samples are kept however long the button is held
  }

  // The sensor stream's rate (events a second) over the last `ms` before t: a stalled or slow
  // stream cannot follow a swing
  rateAround(t, ms = 1000) {
    let n = 0;
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].t >= t - ms; i--) if (this.samples[i].t <= t + 50) n++;
    return n * 1000 / ms;
  }

  pushOrientation(t, beta, gamma) {
    if (num(beta) === null || num(gamma) === null) return;
    this.oriUp = upFromOrientation(beta, gamma);
    this.oriT = t;
  }

  push(e) {
    this.events++;
    const rr = e.rr && num(e.rr.alpha) !== null && num(e.rr.beta) !== null && num(e.rr.gamma) !== null ? e.rr : null;
    const ag = e.ag && num(e.ag.x) !== null && num(e.ag.y) !== null && num(e.ag.z) !== null ? e.ag : null;
    if (rr) this.gyroEvents++;
    if (ag) this.accEvents++;
    if (!rr) return;
    let t = e.t;
    if (this.lastT && t <= this.lastT) t = this.lastT + 0.01;      // never backwards
    let dtMs = this.lastT ? t - this.lastT : 0;
    if (!(dtMs > 0 && dtMs < 120)) {
      // the first sample, or a gap (a hidden page): the interval the browser gives (ms; old iOS: s)
      const iv = num(e.interval);
      dtMs = iv ? (iv < 1 ? iv * 1000 : iv) : 16.7;
      dtMs = Math.min(dtMs, 50);
    }
    this.lastT = t;
    const dt = dtMs / 1000;
    const raw = FRAMES.map((F) => F.f(rr));
    const a0 = ag ? [ag.x, ag.y, ag.z] : null;
    if (a0 && this.oriUp && t - this.oriT < 250) this.checkSign(a0, raw[this.frame]);    // may turn accSign
    const a = a0 ? scale(a0, this.accSign) : null;
    const aLen = a ? len(a) : 0;
    const aHat = a && aLen > 1 ? scale(a, 1 / aLen) : null;
    if (aHat && !this.swinging) this.checkFrames(t, aHat, aLen, raw, dt);
    else this.fc = null;
    const w = sub(raw[this.frame], this.bias);
    // at rest: no acceleration but gravity and little turning, for 100 ms on end (a swing's
    // turning points pass through |a| = g with the arm's own acceleration in it)
    const rest = aHat && Math.abs(aLen - MOTION.g) < 0.6 && len(w) < 40;
    this.restMs = rest ? (this.restMs || 0) + dtMs : 0;
    if (!this.up) this.up = aHat ? aHat.slice() : (this.oriUp ? this.oriUp.slice() : [0, 0, 1]);
    else {
      this.up = turnFixed(this.up, w, dt);
      // at rest the accelerometer pulls "up" back
      if (this.restMs >= 100 && !this.swinging) {
        const k = 1 - Math.exp(-dt / 0.4);
        this.up = unit([this.up[0] + k * (aHat[0] - this.up[0]), this.up[1] + k * (aHat[1] - this.up[1]), this.up[2] + k * (aHat[2] - this.up[2])]);
      } else this.up = unit(this.up);
    }
    this.samples.push({ t, dt, w, raw: raw[this.frame], up: this.up.slice(), a, aLen });
    // the last keepMs, and while the button is held everything from just before the press: a long
    // hold (aiming slowly) must not lose the start of the aim, or the ball would not go where the
    // marker stood
    const from = this.keepFrom === null ? Infinity : this.keepFrom - 300;
    while (this.samples.length > 2 && t - this.samples[0].t > MOTION.keepMs && (this.samples[0].t < from || t - this.samples[0].t > MOTION.holdMaxMs)) this.samples.shift();
  }

  // Which mapping of rotationRate is right: while the phone is handled slowly (no acceleration
  // but gravity), each candidate predicts how gravity turns in the device frame; over windows of
  // 150 ms the one that predicts the accelerometer best wins, once there is enough turning
  checkFrames(t, aHat, aLen, raw, dt) {
    const rate = len(raw[0]);
    const quiet = Math.abs(aLen - MOTION.g) < 0.8 && rate < 200;
    if (!quiet) { this.fc = null; return; }
    if (!this.fc) { this.fc = { t0: t, g: FRAMES.map(() => aHat.slice()), rot: 0 }; return; }
    for (let k = 0; k < FRAMES.length; k++) this.fc.g[k] = turnFixed(this.fc.g[k], raw[k], dt);
    this.fc.rot += rate * dt;
    if (t - this.fc.t0 < 150) return;
    if (this.fc.rot >= 5) {
      for (let k = 0; k < FRAMES.length; k++) { const d = sub(this.fc.g[k], aHat); this.frameErr[k] += dot(d, d); }
      this.frameRot += this.fc.rot;
      if (this.frameRot >= 60) {
        let best = 0;
        for (let k = 1; k < FRAMES.length; k++) if (this.frameErr[k] < this.frameErr[best]) best = k;
        if (best !== this.frame && this.frameErr[best] < 0.35 * this.frameErr[this.frame]) {
          this.frame = best;
          this.bias = [0, 0, 0];
        }
      }
    }
    this.fc = { t0: t, g: FRAMES.map(() => aHat.slice()), rot: 0 };
  }

  // The sign of accelerationIncludingGravity: at rest it points up; the orientation event says
  // where up is whatever the platform's sign convention
  checkSign(a0, raw) {
    const aLen = len(a0);
    if (Math.abs(aLen - MOTION.g) > 0.5 || len(raw) > 20 || this.signVotes >= 40) return;
    this.signSum += dot(scale(a0, this.accSign / aLen), this.oriUp);
    this.signVotes++;
    if (this.signVotes >= 8 && this.signSum / this.signVotes < -0.85) {      // clearly upside down, not just apart
      this.accSign = -this.accSign;
      this.signSum = 0; this.signVotes = 0;
      this.up = null;
      for (const s of this.samples) if (s.a) s.a = scale(s.a, -1);
    }
  }

  // Still between t0 and t1 (ms): little turning, no acceleration but gravity, and data all along
  isStill(t0, t1) {
    const S = this.samples.filter((s) => s.t >= t0 && s.t <= t1);
    if (S.length < 3 || S[0].t - t0 > 80 || t1 - S[S.length - 1].t > 80) return false;
    return S.every((s) => len(s.raw) < MOTION.stillDps && (!s.a || Math.abs(s.aLen - MOTION.g) < MOTION.stillAcc));
  }

  // Calibrate on the still moment t0..t1: the gyroscope's offset and "up" from gravity
  calibrate(t0, t1) {
    const S = this.samples.filter((s) => s.t >= t0 && s.t <= t1);
    if (!S.length) return false;
    const m = [0, 0, 0], g = [0, 0, 0];
    let na = 0;
    for (const s of S) { for (let i = 0; i < 3; i++) m[i] += s.raw[i] / S.length; if (s.a) { for (let i = 0; i < 3; i++) g[i] += s.a[i]; na++; } }
    this.bias = Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2])) < 8 ? m : [0, 0, 0];
    if (na) this.up = unit(g);
    this.calibrated = true;
    return true;
  }

  between(t0, t1) { return this.samples.filter((s) => s.t >= t0 && s.t <= t1); }

  // "Up" at the press, where the swing's own tracking starts: gravity if the phone was still for
  // 200 ms (exact), else the orientation event's (the platform's own sensor fusion), else the
  // tracked one. Between turns the phone is waved about for a long time and the gyroscope's
  // integration drifts; tested, a press could start 30-40 degrees off without this.
  snapUp(t) {
    let u = null;
    if (this.isStill(t - 200, t)) {
      const g = [0, 0, 0];
      for (const s of this.between(t - 200, t)) if (s.a) for (let i = 0; i < 3; i++) g[i] += s.a[i];
      if (len(g) > 1) u = unit(g);
    }
    if (!u && this.oriUp) u = this.oriUp.slice();
    if (u) this.up = u;
    return !!u;
  }
}

// ---- the aim ------------------------------------------------------------------------------------
// How far the phone has turned about the vertical since the press (deg, + = left), smoothed; locked
// when the backswing starts. Used live (the marker over the arrows) and by analyzeSwing (the throw),
// so the ball goes where the marker stood.
export class AimTracker {
  constructor(M = MOTION) { this.M = M; this.raw = 0; this.yaw = 0; this.fast = 0; this.locked = null; this.hist = []; }
  // t (ms), w (deg/s, device frame), up (device frame), dtMs
  push(t, w, up, dtMs) {
    const M = this.M, dt = Math.max(0, Math.min(100, dtMs)) / 1000;
    const yawRate = dot(w, up);
    this.raw += yawRate * dt;
    if (this.locked) return;
    this.yaw += (this.raw - this.yaw) * (1 - Math.exp(-dtMs / M.aimTauMs));
    this.hist.push({ t, yaw: this.yaw, raw: this.raw });
    while (this.hist.length > 2 && t - this.hist[0].t > 900) this.hist.shift();
    // the swing: turning about a level axis (not about the vertical, which is the aim)
    const swing = len(sub(w, scale(up, yawRate)));
    this.fast = swing > M.lockDps ? this.fast + dtMs : 0;
    if (this.fast >= M.lockMs) {
      const tRef = t - this.fast - M.lockRefMs;
      const win = this.hist.filter((x) => x.t <= tRef && x.t >= tRef - M.aimMeanMs);
      let yaw;
      if (win.length) yaw = win.reduce((a, x) => a + x.raw, 0) / win.length;
      else { let h = this.hist[0]; for (const x of this.hist) if (x.t <= tRef) h = x; yaw = h.yaw; }
      this.locked = { t, tRef, yaw };
    }
  }
  value() { return this.locked ? this.locked.yaw : this.yaw; }
  lockedYaw() { return this.value(); }
}

// ---- the swing --------------------------------------------------------------------------------
// The main axis of the turning (the swing's axis, the shoulder's): the largest eigenvector of
// sum(w w^T dt) over the samples that turn
function swingAxis(S) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let seed = null, seedLen = 0;
  for (const s of S) {
    const l = len(s.w);
    if (l < MOTION.movingDps) continue;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += s.w[i] * s.w[j] * s.dt;
    if (l > seedLen) { seedLen = l; seed = s.w; }
  }
  if (!seed) return null;
  let v = unit(seed);
  for (let it = 0; it < 40; it++) v = unit([dot(C[0], v), dot(C[1], v), dot(C[2], v)]);
  return v;
}

// The swing between the press (tStart) and the release (tRelease), from the tracker's samples.
// Returns { ok: true, rate, fwdDeg, backDeg, heading, twist, ... } or { ok: false, reason }
// with reason 'noData' | 'noSwing' | 'noForward' | 'late' | 'weak'.
//   rate     the forward swing's rate (deg/s): the highest mean over peakMs
//   heading  how far the phone turned about the vertical from the press to twistMs before the
//            release (deg, + = to the left: counterclockwise seen from above), the swing itself
//            left out
//   twist    the turn about the arm in the last twistMs (deg, - = counterclockwise seen from
//            above at the bottom of the swing: a right-hander's hook)
// up0: "up" at the press (MotionTracker.snapUp); a sample stamped just after the press may have
// been handled before it (a pointer event is stamped with the touch's own time)
export function analyzeSwing(samples, tStart, tRelease, M = MOTION, up0 = null) {
  const S = samples.filter((s) => s.t >= tStart - 1 && s.t <= tRelease + 8);
  if (S.length < 3) return { ok: false, reason: 'noData' };
  // "up" through the swing: from the press, by the gyroscope alone (the accelerometer is all
  // swing here, not gravity)
  const ups = [(up0 || S[0].up).slice()];
  for (let i = 1; i < S.length; i++) ups.push(unit(turnFixed(ups[i - 1], S[i].w, S[i].t - S[i - 1].t > 0 ? (S[i].t - S[i - 1].t) / 1000 : S[i].dt)));
  const gyroAxis = swingAxis(S);
  let peakAll = 0;
  for (const s of S) peakAll = Math.max(peakAll, len(s.w));
  if (!gyroAxis) return { ok: false, reason: 'noSwing', peakAll };
  // the agreed grip (the phone like a remote, its long side along the forearm) swings about the
  // phone's short axis, x: the fit starts from there, and the axis found is reported against it
  const axis = upAxis(ups, gyroAxis) || gyroAxis;
  const axisFromX = Math.acos(Math.min(1, Math.abs(axis[0]))) * 180 / Math.PI;
  // the aim, as the marker showed it while the button was held (the same AimTracker)
  const aimT = new AimTracker(M);
  for (let i = 1; i < S.length; i++) if (S[i].t > tStart) aimT.push(S[i].t, S[i].w, ups[i], S[i].t - S[i - 1].t > 0 ? (S[i].t - S[i - 1].t) : S[i].dt * 1000);
  const aimYaw = aimT.lockedYaw();
  const tHeadFrom = aimT.locked ? aimT.locked.tRef : tStart;
  // the swing rate about the axis, and its lobes (one direction each)
  const sw = S.map((s) => dot(s.w, axis));
  const lobes = [];
  let cur = null;
  for (let i = 0; i < S.length; i++) {
    const v = sw[i], sign = Math.sign(v), moving = Math.abs(v) > M.movingDps;
    if (cur && (sign !== cur.sign || (!moving && S[i].t - S[cur.lastMoving].t > M.gapMs))) { lobes.push(cur); cur = null; }
    if (moving && !cur) cur = { sign, i0: i, i1: i, lastMoving: i, peak: 0, deg: 0 };
    if (cur && sign === cur.sign) {
      cur.i1 = i;
      if (moving) cur.lastMoving = i;
      cur.peak = Math.max(cur.peak, Math.abs(v));
      if (i > cur.i0) cur.deg += (Math.abs(v) + Math.abs(sw[i - 1])) / 2 * S[i].dt;
    }
  }
  if (cur) lobes.push(cur);
  for (const l of lobes) { l.t0 = S[l.i0].t; l.t1 = S[l.lastMoving].t; }
  const big = lobes.filter((l) => l.deg >= M.lobeDeg && l.peak >= M.lobeDps);
  const summary = big.map((l) => ({ sign: l.sign, deg: +l.deg.toFixed(1), peak: Math.round(l.peak), t0: Math.round(l.t0 - tStart), t1: Math.round(l.t1 - tStart) }));
  // a real swing, but nowhere as fast as the weakest throw: too weak (not "no swing")
  const swung = lobes.filter((l) => l.deg >= M.lobeDeg);
  if (swung.length && Math.max(...swung.map((l) => l.peak)) < M.weakDps) return { ok: false, reason: 'weak', rate: Math.max(...swung.map((l) => l.peak)), peakAll, lobes: summary };
  if (!big.length) return { ok: false, reason: 'noSwing', peakAll, lobes: summary };
  const maxDeg = Math.max(...big.map((l) => l.deg));
  const back = big.find((l) => l.deg >= Math.max(M.backDeg, M.backRatio * maxDeg));
  if (!back) return { ok: false, reason: 'noSwing', peakAll, lobes: summary };
  const fwd = big[big.length - 1];
  if (fwd === back || fwd.sign === back.sign) return { ok: false, reason: 'noForward', backDeg: back.deg, lobes: summary };
  if (tRelease - fwd.t1 > M.lateMs) return { ok: false, reason: 'late', lateMs: Math.round(tRelease - fwd.t1), lobes: summary };
  // the forward swing's rate: the highest mean over peakMs (noise and jitter averaged out)
  let rate = 0, iPeak = fwd.i0;
  for (let i = fwd.i0; i <= fwd.i1; i++) {
    let sum = 0, wsum = 0;
    for (let j = i; j >= fwd.i0 && S[i].t - S[j].t <= M.peakMs; j--) { const w = Math.max(S[j].dt, 0.001); sum += Math.abs(sw[j]) * w; wsum += w; }
    const m = sum / wsum;
    if (m > rate) { rate = m; }
    if (Math.abs(sw[i]) > Math.abs(sw[iPeak])) iPeak = i;
  }
  // release timing (deg of swing, + = past the bottom, - = before it). Past the forward swing's
  // fastest point (the bottom of a pendulum) it is measured from there; still speeding up, from
  // the calibrated vertical: the arm's angle at the press, where the swing starts hanging down
  let net = 0, netPeak = 0;
  const netAt = [];
  for (let i = 0; i < S.length; i++) {
    if (i > 0 && S[i].t > tStart) net += (sw[i] + sw[i - 1]) / 2 * fwd.sign * (S[i].t - S[i - 1].t > 0 ? (S[i].t - S[i - 1].t) / 1000 : S[i].dt);
    netAt.push(net);
  }
  let iRel = S.length - 1;
  while (iRel > 0 && S[iRel].t > tRelease + 1) iRel--;
  // the rate smoothed over +-25 ms (up to the release), its peak in the forward swing
  const csm = (i) => { let s = 0, n = 0; for (let j = fwd.i0; j <= iRel; j++) if (Math.abs(S[j].t - S[i].t) <= 25) { s += Math.abs(sw[j]); n++; } return n ? s / n : 0; };
  let iPk = fwd.i0, pk = 0;
  for (let i = fwd.i0; i <= Math.min(iRel, fwd.i1); i++) { const v = csm(i); if (v > pk) { pk = v; iPk = i; } }
  netPeak = netAt[iPk];
  const passed = iPk < iRel && csm(iRel) < M.passedShare * pk;
  let releaseDeg = passed ? netAt[iRel] - netPeak : Math.min(0, netAt[iRel]);
  if (!passed && axisFromX < 30) {
    // the agreed grip: the arm hangs where the phone's top points down ("up" is -y); from a stance
    // with the arm forward (aiming chest high) the press is no vertical, this is
    const across = (v) => unit(sub(v, scale(axis, dot(v, axis))));
    const fromVertical = Math.acos(Math.max(-1, Math.min(1, dot(across(ups[iRel]), across([0, -1, 0]))))) * 180 / Math.PI;
    releaseDeg = Math.max(releaseDeg, -fromVertical);
  }
  const res = { rate, fwdDeg: fwd.deg, backDeg: back.deg, axis, axisFromX, lobes: summary, peakAll, releaseDeg, releasePassed: passed };
  if (rate < M.weakDps || fwd.deg < M.fwdDeg) return { ok: false, reason: 'weak', ...res };
  // the arm: "down" at the bottom of the swing (the forward swing's fastest point), across the axis
  let arm = scale(ups[iPeak], -1);
  arm = unit(sub(arm, scale(axis, dot(arm, axis))));
  const tTw = Math.max(fwd.t0, tRelease - M.twistMs);
  let heading = 0, twist = 0;
  // the turning about the vertical, without the swing's own turning about its axis
  const yaw = (i) => { const wp = sub(S[i].w, scale(axis, dot(S[i].w, axis))); return dot(wp, ups[i]); };
  for (let i = 1; i < S.length; i++) {
    const s = S[i], p = S[i - 1];
    if (s.t <= tStart) continue;
    const dt = s.t - p.t > 0 ? (s.t - p.t) / 1000 : s.dt;
    if (s.t <= tHeadFrom) continue;
    if (s.t <= tTw) heading += (yaw(i) + yaw(i - 1)) / 2 * dt;
    else if (s.t <= tRelease + 8) twist += (dot(s.w, arm) + dot(p.w, arm)) / 2 * dt;
  }
  return { ok: true, ...res, aimYaw, aimLocked: !!aimT.locked, heading, twist, tTwist: Math.round(tTw - tStart), tAimLock: aimT.locked ? Math.round(aimT.locked.t - tStart) : null };
}

// The swing's axis from gravity: a swing about a level axis turns "up" about that axis and
// never along it, so the axis is the direction most across every "up" of the swing (the
// smallest eigenvector of sum(up up^T)). Turning about the vertical (the line) and the wrist's
// turn at the bottom (the hook) turn the phone about "up" itself and leave it alone, which a
// fit to the gyroscope's own axis does not. null when "up" swept too little to say.
function upAxis(ups, seed) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const u of ups) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += u[i] * u[j] / ups.length;
  const tr = C[0][0] + C[1][1] + C[2][2];
  const B = C.map((r, i) => r.map((v, j) => (i === j ? tr : 0) - v));
  let v = seed.slice();
  for (let it = 0; it < 80; it++) v = unit([dot(B[0], v), dot(B[1], v), dot(B[2], v)]);
  // the sweep: the middle eigenvalue (how far "up" moved across the axis), from the 2x2 block
  // across v; a few degrees is no sweep
  const Cx = (x) => [dot(C[0], x), dot(C[1], x), dot(C[2], x)];
  const lMin = dot(v, Cx(v));
  const e1 = unit(cross(v, Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), e2 = cross(v, e1);
  const c11 = dot(e1, Cx(e1)), c22 = dot(e2, Cx(e2)), c12 = dot(e1, Cx(e2));
  const lMid = (c11 + c22) / 2 - Math.sqrt(((c11 - c22) / 2) ** 2 + c12 * c12);
  if (lMid < 0.02 || lMin > 0.5 * lMid) return null;
  return dot(v, seed) < 0 ? scale(v, -1) : v;
}

// ---- the device ---------------------------------------------------------------------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem('vbg.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('vbg.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
};

// A phone or tablet (by what the browser says about itself) that can give motion events here
export function motionCapable() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (typeof window.DeviceMotionEvent === 'undefined' || window.isSecureContext === false) return false;
  const ua = navigator.userAgent || '';
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  return /Android|iPhone|iPad|iPod|Mobile/.test(ua) || iPadOS;
}
// The motion events can be had at all (the "Rörelse" setting on any device)
export function motionPossible() {
  return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined' && window.isSecureContext !== false;
}
// "auto": the sensors were found missing or refused on this device before
export function motionRefusedBefore() { return !!store.get('motionUnavailable', false); }

function screenOrientation() {
  try { if (screen.orientation && screen.orientation.type) return screen.orientation.type.split('-')[0]; } catch (e) { /* none */ }
  try { return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'; } catch (e) { return ''; }
}

function stamp(e) {
  const t = e && e.timeStamp;
  return typeof t === 'number' && t > 0 && t < 1e11 ? t : performance.now();
}

function hasPermissionApi() { return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'; }
// iPhone, iPad (iPadOS says it is a Mac with a touch screen), iPod
function appleTouch() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

// ---- the swing button, the first-use card and the sensors ------------------------------------
// h: { onThrow(analysis), onHint(i18nKey, ms), onFallback(i18nKey), onChooseSwipe() }
export class MotionThrow {
  constructor(h) {
    this.h = h;
    this.tracker = new MotionTracker();
    this.state = 'off';          // off -> card -> starting -> ready | failed (paused: the sensors stopped)
    this.visible = false;
    this.press = null;
    this.granted = false;        // the sensors delivered on this page (iOS: no new permission card)
    this.bad = 0;                // presses in a row with too slow or no sensor data
    this.last = null;            // the last swing's analysis (for the tests and ?motiondebug=1)
    this.debug = typeof location !== 'undefined' && /[?&]motiondebug=1/.test(location.search);
    this.onMotion = (e) => this.motionEvent(e);
    this.onOrientation = (e) => this.tracker.pushOrientation(stamp(e), e.beta, e.gamma);
    this.build();
  }

  build() {
    const b = this.btn = document.createElement('div');
    b.id = 'swingBtn';
    b.className = 'swingBtn';
    b.setAttribute('role', 'button');
    b.innerHTML = '<span class="swingIcon" aria-hidden="true"></span><b></b><small></small>';
    document.body.appendChild(b);
    b.addEventListener('pointerdown', (e) => this.down(e));
    // The release is heard wherever it happens - on the window, not only on the button - so the
    // press never sticks: a finger that slid off the button, a pointer capture that was not given,
    // a touch the browser took over (pointercancel, then only touch events: the thumb is the touch
    // that started on the button, whatever other fingers rest on the screen), a capture lost, the
    // page hidden or left (an app switch, the notification shade). A stuck press would leave the
    // button and the placing of the ball dead.
    window.addEventListener('pointerup', (e) => { if (this.press && e.pointerId === this.press.id && !this.press.viaTouch) this.up(e); });
    window.addEventListener('pointercancel', (e) => this.pointerCancel(e));
    b.addEventListener('lostpointercapture', (e) => { const p = this.press; if (p && e.pointerId === p.id && !p.viaTouch) this.cancelPress(); });
    const ownTouch = (e) => [...((e && e.changedTouches) || [])].some((tc) => tc.target && b.contains(tc.target));
    window.addEventListener('touchend', (e) => { if (this.press && this.press.viaTouch && ownTouch(e)) this.up(e); }, { passive: true });
    window.addEventListener('touchcancel', (e) => { if (this.press && this.press.viaTouch && ownTouch(e)) this.cancelPress(); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.cancelPress(); if (!this.visible) this.pause(); } });
    window.addEventListener('blur', () => this.cancelPress());
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    const c = this.card = document.createElement('div');
    c.id = 'motionCard';
    c.className = 'motionCard';
    c.innerHTML = '<h3></h3><p class="mcIntro"></p><p class="mcSafety"></p><div class="mcBtns"><button class="btn" id="motionSwipe"></button><button class="btn gold" id="motionAllow"></button></div>';
    document.body.appendChild(c);
    c.querySelector('#motionAllow').addEventListener('click', () => this.allow());
    c.querySelector('#motionSwipe').addEventListener('click', () => { this.hideCard(); this.h.onChooseSwipe && this.h.onChooseSwipe(); });
    if (this.debug) {
      this.dbg = document.createElement('pre');
      this.dbg.className = 'motionDbg';
      document.body.appendChild(this.dbg);
      setInterval(() => this.drawDebug(), 250);
    }
  }

  t(key) { return tr(key); }

  // the button on or off; the page is told (body.swingOn), so the HUD's buttons keep clear of it
  shown(on) { this.btn.classList.toggle('show', on); document.body.classList.toggle('swingOn', on); }

  label(state) {
    const b = this.btn;
    b.classList.toggle('down', state === 'swing');
    b.classList.toggle('calib', state === 'calib');
    b.classList.toggle('aim', state === 'aim');
    const [big, small] = state === 'calib' ? [this.t('swingHold'), this.t('swingHoldSub')]
      : state === 'aim' ? [this.t('swingAim'), this.t('swingAimSub')]
      : state === 'swing' ? [this.t('swingGo'), this.t('swingGoSub')]
        : state === 'starting' ? [this.t('swingStarting'), ''] : [this.t('swingBtn'), this.t('swingSub')];
    b.querySelector('b').textContent = big;
    b.querySelector('small').textContent = small;
  }

  // The player's turn: true when motion control takes the throw (the button, or the card first)
  show() {
    if (this.state === 'failed') return false;
    this.visible = true;
    clearTimeout(this.pauseT);
    // the sensors were stopped (a menu, a long wait): they start again, without a new card
    if (this.state === 'paused') { this.state = 'off'; this.start(); this.showButton(); return true; }
    if (this.state === 'ready' || this.state === 'starting') { this.showButton(); return true; }
    if (this.state === 'card') { this.showCard(); return true; }
    // the first use: the animated demo of the swing, with the safety note; its "Spela" (or
    // "Hoppa över") is the tap that asks for the sensors where the platform asks (iOS)
    if (!store.get('motionIntro', false)) { this.state = 'card'; this.showCard(); return true; }
    // later pages: iOS asks for permission, and only from a tap (Chromium has requestPermission
    // too but delivers without it); not again on a page where the sensors have delivered
    if (hasPermissionApi() && appleTouch() && !this.granted) { this.state = 'card'; this.showCard(); return true; }
    this.start();
    this.showButton();
    return true;
  }

  hide() {
    this.visible = false;
    this.unlockPortrait();
    this.cancelPress();
    this.shown(false);
    this.hideCard();
    // the sensors run on while the machine players bowl (the next turn needs no restart), but not
    // for long: after pauseMs, or at once on a menu (pause() from the App), they are stopped
    clearTimeout(this.pauseT);
    this.pauseT = setTimeout(() => { if (!this.visible) this.pause(); }, MOTION.pauseMs);
  }

  // The sensors off while the button is not wanted (the menus, the standings, a long wait): no
  // devicemotion listener runs. show() starts them again.
  pause() {
    clearTimeout(this.pauseT);
    if (this.visible || !this.listening) return;
    this.stop();
    if (this.state === 'ready' || this.state === 'starting') this.state = 'paused';
  }

  showButton() {
    this.hideCard();
    this.label(this.state === 'starting' ? 'starting' : 'idle');
    this.shown(true);
    this.lockPortrait();
    // held on its side: allowed, and calibrated for that ("hold still" at the first press in
    // each orientation); once, a tip that upright is the grip
    if (screenOrientation() === 'landscape' && !store.get('motionLandscapeTip', false)) {
      store.set('motionLandscapeTip', true);
      this.h.onHint && this.h.onHint('motionLandscapeTip', 6000);
    }
  }

  // In full screen on a phone held upright (Android: iOS pages cannot lock), keep it upright, so
  // the swing does not turn the screen; a refusal is fine (the swing goes on whatever the screen does)
  lockPortrait() {
    try {
      const o = screen.orientation;
      if (!this.locked && o && typeof o.lock === 'function' && document.fullscreenElement && screenOrientation() === 'portrait') {
        const p = o.lock('portrait');
        this.locked = true;
        if (p && p.catch) p.catch(() => { this.locked = false; });
      }
    } catch (e) { this.locked = false; }
  }
  unlockPortrait() {
    if (!this.locked) return;
    this.locked = false;
    try { screen.orientation.unlock(); } catch (e) { /* not locked */ }
  }

  showCard() {
    if (!store.get('motionIntro', false)) { this.showDemo(true); return; }
    const c = this.card;
    c.querySelector('h3').textContent = this.t('motionTitle');
    c.querySelector('.mcIntro').textContent = this.t('motionAllowAgain');
    const sf = c.querySelector('.mcSafety');
    sf.textContent = this.t('motionSafety');
    sf.hidden = true;
    c.querySelector('#motionAllow').textContent = this.t('motionAllow');
    c.querySelector('#motionSwipe').textContent = this.t('motionUseSwipe');
    this.shown(false);
    c.classList.add('show');
  }
  hideCard() { this.card.classList.remove('show'); if (this.demo && this.demoFirst) this.demo.hide(); }

  // The animated demo (motiondemo.js). first: the first use, whose buttons also start the sensors
  showDemo(first) {
    if (!this.demo) this.demo = new MotionDemo({ onDone: (kind) => this.demoDone(kind) });
    this.demoFirst = first;
    this.shown(false);
    this.demo.show({ first });
  }
  // "Visa svingdemo" in the settings
  playDemo() { this.showDemo(false); }
  demoDone(kind) {
    const first = this.demoFirst;
    this.demoFirst = false;
    if (!first) { if (this.visible && (this.state === 'ready' || this.state === 'starting')) this.showButton(); return; }
    if (kind === 'swipe') { this.h.onChooseSwipe && this.h.onChooseSwipe(); return; }
    this.allow();                       // inside the tap: iOS may ask here
  }

  // The card's button (a tap: iOS lets requestPermission be asked from one only). Both
  // permissions are asked at once, inside the tap, before anything is awaited.
  allow() {
    store.set('motionIntro', true);
    this.asked = true;
    let asks = null;
    try {
      const DM = window.DeviceMotionEvent, DO = window.DeviceOrientationEvent;
      if (DM && typeof DM.requestPermission === 'function') {
        asks = [DM.requestPermission(), DO && typeof DO.requestPermission === 'function' ? DO.requestPermission().catch(() => 'denied') : Promise.resolve('granted')];
      }
    } catch (e) { asks = [Promise.reject(e)]; }
    this.hideCard();
    if (!asks) { this.start(); if (this.visible) this.showButton(); return; }
    this.state = 'starting';
    if (this.visible) this.showButton();
    // a request that is never answered must not leave the button "starting" for good: the swipe after
    // permissionMs. The player may only have been slow to answer iOS's prompt: a "granted" that comes
    // later still brings the swing back (the miss forgotten, the swipe's note taken away)
    let settled = false, timedOut = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; timedOut = true; this.fail('motionNone'); } }, MOTION.permissionMs);
    Promise.all(asks).then(([m]) => {
      if (settled) {
        if (timedOut && m === 'granted' && this.state === 'failed') this.recover();
        return;
      }
      settled = true; clearTimeout(timer);
      if (m === 'granted') { this.granted = true; this.state = 'off'; this.start(); if (this.visible) this.showButton(); }
      else this.fail('motionDenied');
    }, () => { if (settled) return; settled = true; clearTimeout(timer); this.fail('motionDenied'); });
  }

  // The sensors after all (a permission granted after its timeout): back from the swipe to the swing
  recover() {
    this.granted = true;
    store.set('motionMisses', 0);
    store.set('motionUnavailable', false);
    this.state = 'off';
    this.start();
    if (this.visible) this.showButton();
    this.h.onRecover && this.h.onRecover();
  }

  start() {
    if (this.listening) return;
    this.listening = true;
    this.state = 'starting';
    this.startedAt = performance.now();
    this.bad = 0;
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('deviceorientation', this.onOrientation);
    clearTimeout(this.noEvents);
    // Ready at the first gyroscope event (motionEvent). Nothing is judged from the first events: they
    // come while the game starts, when the page is at its busiest, and a stall then said nothing about
    // the sensors - the presses judge the stream (up). Only no gyroscope event at all, twice
    // noEventsMs after the start (a timer that a stall holds up runs late and is given a second
    // round), is no motion control.
    let rounds = 0;
    const check = () => {
      if (this.state !== 'starting') return;
      // nothing came: a browser that has a permission to ask for gets the card (a tap) first
      if (!this.asked && hasPermissionApi() && !this.tracker.events) {
        this.stop();
        this.state = 'card';
        if (this.visible) this.showCard();
        return;
      }
      if (++rounds < 2) { this.noEvents = setTimeout(check, MOTION.noEventsMs); return; }
      this.fail(this.tracker.accEvents && !this.tracker.gyroEvents ? 'motionNoGyro' : 'motionNone');
    };
    this.noEvents = setTimeout(check, MOTION.noEventsMs);
  }

  stop() {
    this.listening = false;
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('deviceorientation', this.onOrientation);
    clearTimeout(this.noEvents);
  }

  // key: why (the note shown). "Auto" remembers the swipe on this device at once when that is
  // certain - the permission refused, no gyroscope - and otherwise (no data at all, a stream too slow
  // for two presses in a row, a permission request never answered) only when it happened on two pages
  // in a row; a press the sensors followed clears the count. Nothing at the start counts: the first
  // events are not judged.
  fail(key) {
    this.state = 'failed';
    this.stop();
    this.cancelPress();
    this.shown(false);
    this.hideCard();
    const certain = key === 'motionDenied' || key === 'motionNoGyro';
    const misses = certain ? 0 : store.get('motionMisses', 0) + 1;
    store.set('motionMisses', misses);
    if (certain || misses >= 2) store.set('motionUnavailable', true);
    this.h.onFallback && this.h.onFallback(key);
  }

  motionEvent(e) {
    const rr = e.rotationRate, ag = e.accelerationIncludingGravity;
    this.tracker.push({ t: stamp(e), rr: rr && { alpha: rr.alpha, beta: rr.beta, gamma: rr.gamma }, ag: ag && { x: ag.x, y: ag.y, z: ag.z }, interval: e.interval });
    if (this.state === 'starting' && this.tracker.gyroEvents > 0) {
      // the sensors deliver: ready (whether they are fast enough is judged by the presses)
      this.state = 'ready';
      this.granted = true;
      clearTimeout(this.noEvents);
      store.set('motionUnavailable', false);
      if (this.visible && !this.press) this.label('idle');
    }
    if (this.press && this.press.calib) this.calibStep(stamp(e));
    else if (this.press && this.press.aim) this.aimStep();
  }

  // The aim phase: from the press (after "hold still") to the backswing, the marker follows the
  // phone's turning; the backswing locks it
  startAim() {
    const p = this.press;
    p.aim = new AimTracker();
    p.aimT = p.tStart;           // the last sample fed (by time: the buffer drops its oldest as it fills)
    p.aimShown = 0;
    this.label('aim');
    this.h.onAimTarget && this.h.onAimTarget(0, false);
  }
  aimStep() {
    const p = this.press, S = this.tracker.samples;
    let i = S.length - 1;
    while (i > 1 && S[i - 1].t > p.aimT) i--;
    for (; i < S.length; i++) {
      if (i < 1 || S[i].t <= p.aimT) continue;
      p.aimT = S[i].t;
      const was = !!p.aim.locked;
      p.aim.push(S[i].t, S[i].w, S[i].up, S[i].t - S[i - 1].t);
      if (!was && p.aim.locked) {
        this.label('swing');
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) { /* no vibration */ }
        this.h.onAimTarget && this.h.onAimTarget(p.aim.value(), true);
      }
    }
    const now = S.length ? S[S.length - 1].t : 0;
    if (!p.aim.locked && now - p.aimShown >= 60) { p.aimShown = now; this.h.onAimTarget && this.h.onAimTarget(p.aim.value(), false); }
  }

  // ---- the press ----
  down(e) {
    if (e.button > 0 || this.press) return;
    e.preventDefault();
    if (this.state !== 'ready') return;
    try { this.btn.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    const t = stamp(e);
    const orient = screenOrientation();
    const calib = !this.tracker.calibrated || orient !== this.calibOrient;
    this.press = { id: e.pointerId, t, tStart: t, calib, viaTouch: false };
    this.tracker.keepFrom = t;
    if (calib) { this.label('calib'); this.calibStep(t); }
    else { this.tracker.snapUp(t); this.press.up0 = this.tracker.up.slice(); this.tracker.swinging = true; this.startAim(); }
  }

  // "Hold still": at the first swing and after the phone was turned (portrait/landscape)
  calibStep(t) {
    const p = this.press;
    if (!p || !p.calib) return;
    const done = t - p.t >= MOTION.calibMs && this.tracker.isStill(t - MOTION.calibMs, t);
    if (done) this.tracker.calibrate(t - MOTION.calibMs, t);
    if (done || t - p.t >= MOTION.calibMaxMs) {
      if (!done) { this.tracker.calibrated = true; this.tracker.snapUp(t); }     // moved all along: go on with what there is
      this.calibOrient = screenOrientation();
      p.calib = false;
      p.tStart = t;
      p.up0 = this.tracker.up.slice();
      this.tracker.swinging = true;
      try { if (navigator.vibrate) navigator.vibrate(25); } catch (err) { /* no vibration */ }
      this.startAim();
    }
  }

  up(e) {
    const p = this.press;
    if (!p) return;
    this.press = null;
    this.tracker.swinging = false;
    this.h.onAimTarget && this.h.onAimTarget(null);
    const tUp = stamp(e);
    this.label('idle');
    // the sensor events of the last moment may be handled after the button's: wait for them
    setTimeout(() => {
      if (this.tracker.keepFrom === p.t) this.tracker.keepFrom = null;     // (unless a new press began)
      // A stream that has stalled or is too slow (a few events a second) cannot follow a swing: two
      // such presses in a row and the swipe takes over, with a note (a quick tap is not counted: the
      // rate is that of the last second, before the press too)
      const hz = this.tracker.rateAround(tUp, 1000);
      if (hz < MOTION.minHz) {
        if (++this.bad >= MOTION.badPresses) { this.fail('motionSlow'); return; }
      } else { this.bad = 0; store.set('motionMisses', 0); }
      if (p.calib) { this.h.onHint && this.h.onHint('motionHoldStill'); return; }
      const r = analyzeSwing(this.tracker.samples, p.tStart, tUp, MOTION, p.up0);
      r.tStart = p.tStart; r.tRelease = tUp; r.hz = hz;
      this.last = r;
      if (r.ok) this.h.onThrow(r);
      else {
        const key = { noSwing: 'motionNoSwing', noForward: 'motionNoSwing', late: 'motionLate', weak: 'motionWeak', noData: 'motionNoSwing' }[r.reason];
        this.h.onHint && this.h.onHint(key, r.reason === 'weak' ? 2600 : 4500);
      }
    }, 60);
  }

  pointerCancel(e) {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    if (e.pointerType === 'touch' && !p.viaTouch) { p.viaTouch = true; return; }   // goes on as touch events
    this.cancelPress();
  }

  cancelPress() { this.tracker.swinging = false; this.tracker.keepFrom = null; if (this.press) { this.press = null; this.label('idle'); this.h.onAimTarget && this.h.onAimTarget(null); } }

  drawDebug() {
    const T = this.tracker, s = T.samples[T.samples.length - 1];
    const f = (v) => (v ? v.map((x) => x.toFixed(2)).join(' ') : '-');
    const hz = T.samples.length > 10 ? (10 / ((T.samples[T.samples.length - 1].t - T.samples[T.samples.length - 11].t) / 1000)).toFixed(0) : '-';
    const L = this.last;
    this.dbg.textContent = `motion ${this.state} ${hz} Hz frame ${FRAMES[T.frame].id} accSign ${T.accSign} cal ${T.calibrated}\n` +
      `w ${s ? f(s.w) : '-'}\nup ${f(T.up)} ori ${f(T.oriUp)}\n` +
      (L ? `last ${L.ok ? 'THROW' : L.reason} rate ${L.rate ? L.rate.toFixed(0) : '-'} fwd ${L.fwdDeg ? L.fwdDeg.toFixed(0) : '-'} back ${L.backDeg ? L.backDeg.toFixed(0) : '-'}\n aim ${L.aimYaw !== undefined ? L.aimYaw.toFixed(1) : '-'} pull ${L.heading !== undefined ? L.heading.toFixed(1) : '-'} twist ${L.twist !== undefined ? L.twist.toFixed(1) : '-'} release ${L.releaseDeg !== undefined ? L.releaseDeg.toFixed(0) : '-'}\n lobes ${JSON.stringify(L.lobes || [])}` : '');
  }
}

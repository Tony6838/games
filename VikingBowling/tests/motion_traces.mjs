// Synthetic motion-sensor traces of a bowling swing with a phone in the hand, for
// tests/motion_test.mjs (node) and tests/motion_browser.mjs (fed to the browser's sensors).
//
// The arm is a rigid pendulum from the shoulder; the phone is held in the hand in some grip.
// World frame: x to the right, y forward (towards the pins), z up. The hand's orientation is
//   R_hand = Rz(psi) * Rx(theta) * Rz(twist)
// theta = the arm's angle (+ forward, 0 hanging down), psi = the swing turned about the
// vertical (+ = to the left), twist = the wrist's turn about the arm (+ = counterclockwise seen
// from above at the bottom: a right-hander's hook). The phone: R_dev = R_hand * H(t) * G, where
// G is the grip (the device axes in the hand's frame) and H the phone being handled before the
// press (slow turns, for the gyroscope-frame check). From R_dev(t) and the hand's path come the
// device-frame rotation rate (deg/s), accelerationIncludingGravity, acceleration and
// orientation (beta, gamma), sampled at fs Hz with optional noise, jitter and dropped samples.
const D2R = Math.PI / 180, R2D = 180 / Math.PI, G0 = 9.81;
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const T = (A) => [0, 1, 2].map((i) => [A[0][i], A[1][i], A[2][i]]);
const app = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const cols = (x, y, z) => [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];

// Grips: the device's x, y, z axes in the hand's frame (at the bottom of the swing the hand's
// frame is the world's). x right, y forward, z up.
export const GRIPS = {
  // THE agreed grip: upright like a remote, its long side along the forearm (the top towards the
  // fingers, down when the arm hangs), the screen towards the player (backwards at the bottom of
  // the swing), the thumb on the lower screen: the swing turns it about its short axis, x
  remote: cols([-1, 0, 0], [0, 0, -1], [0, -1, 0]),
  // portrait, the top of the phone forward, the screen to the right (held like a remote)
  portrait: cols([0, 0, -1], [0, 1, 0], [1, 0, 0]),
  // portrait, the top down along the arm, the screen forward (in the palm, thumb on the screen)
  portraitDown: cols([1, 0, 0], [0, 0, -1], [0, 1, 0]),
  // landscape, the phone's long side along the arm, the screen backwards
  landscape: cols([0, 0, -1], [1, 0, 0], [0, -1, 0]),
  // something in between: portrait turned 30 degrees in the hand and tilted 20
  odd: mul(mul(Rz(30 * D2R), Rx(20 * D2R)), cols([0, 0, -1], [0, 1, 0], [1, 0, 0]))
};

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : (1 - Math.cos(Math.PI * u)) / 2);

let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rand(); v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
export function reseed(s) { seed = s; }

// The swing's timeline. All times in ms from the press (t = 0).
// release: 'fwd' (in the forward swing at releaseU), 'top' (at the top of the backswing),
//          'midBack' (halfway through the backswing), 'late' (lateMs after the forward swing
//          ended), 'none' (no swing: held still and let go)
export function makeSwing(o = {}) {
  const s = Object.assign({
    fs: 60, grip: 'remote', frame: 'xyz', accInvert: false, L: 0.65,
    handleMs: 2500, stillMs: 700, backDeg: 60, fwdDeg: 60, peakDps: 300, backDps: null,
    pauseMs: 0, releaseU: 0.62, startDeg: 0, pushDeg: 0,
    psiDeg: 0, psiPhase: 'back', twistDeg: 0, twistMs: 150,
    hesitant: false, release: 'fwd', lateMs: 900,
    // the aim, after "hold still" and before the backswing: the phone turned aimDeg (+ = left) over
    // aimMs and held aimHoldMs, with an optional wobble of aimJitterDeg at 4.3 Hz
    aimDeg: 0, aimMs: 0, aimHoldMs: 350, aimJitterDeg: 0,
    gyroNoise: 0, accNoise: 0, jitterMs: 0, drop: 0, bias: [0, 0, 0], seed: 1
  }, o);
  reseed(s.seed * 7919 + 17);
  const tl = [];                       // [t0, t1, fn(u) -> theta deg]
  let t = s.stillMs;
  const aimStart = t, aimTurn = s.aimMs || 600, aimTime = (s.aimDeg || s.aimJitterDeg || s.aimMs) ? aimTurn + s.aimHoldMs : 0;
  const seg = (dur, f) => { tl.push([t, t + dur, f]); t += dur; };
  if (aimTime) seg(aimTime, () => s.startDeg);
  // a small push forward first (pushDeg) or a stance with the arm forward (startDeg)
  if (s.hesitant) seg(1200, (u) => s.startDeg + 9 * Math.sin(2 * Math.PI * 1.6 * u * 1.2) * (1 - u));
  if (s.pushDeg) { seg(260, (u) => s.startDeg + s.pushDeg * ease(u)); seg(220, (u) => s.startDeg + s.pushDeg * (1 - ease(u))); }
  const bDps = s.backDps || 0.75 * s.peakDps;
  const tb = (s.backDeg + s.startDeg) * Math.PI / 2 / bDps * 1000;
  const backStart = t;
  seg(tb, (u) => s.startDeg - (s.backDeg + s.startDeg) * ease(u));
  const backEnd = t;
  if (s.pauseMs) seg(s.pauseMs, () => -s.backDeg);
  const tf = (s.backDeg + s.fwdDeg) * Math.PI / 2 / s.peakDps * 1000;
  const fwdStart = t;
  seg(tf, (u) => -s.backDeg + (s.backDeg + s.fwdDeg) * ease(u));
  const fwdEnd = t;
  seg(1500, () => s.fwdDeg);
  const end = t;
  let tRelease;
  if (s.release === 'fwd') tRelease = fwdStart + s.releaseU * tf;
  else if (s.release === 'top') tRelease = backEnd + 120;
  else if (s.release === 'midBack') tRelease = backStart + 0.5 * tb;
  else if (s.release === 'late') tRelease = fwdEnd + s.lateMs;
  else tRelease = s.stillMs + aimTime + 400;
  if (s.release === 'none') { tl.length = 0; }
  const theta = (tt) => {
    if (s.release === 'none') return s.startDeg;
    if (tt <= s.stillMs) return s.startDeg;
    for (const [a, b, f] of tl) if (tt <= b) return f((tt - a) / (b - a));
    return s.fwdDeg;
  };
  // psi: the swing turned towards the target, over the backswing ('back') or early in the
  // forward swing ('fwdEarly', done 200 ms before the release)
  const psi = (tt) => {
    if (!s.psiDeg) return 0;
    if (s.psiPhase === 'back') return s.psiDeg * ease((tt - backStart) / (backEnd - backStart));
    const e = Math.max(fwdStart + 1, tRelease - 220);
    return s.psiDeg * ease((tt - fwdStart) / (e - fwdStart));
  };
  const twist = (tt) => (s.twistDeg ? s.twistDeg * ease((tt - (tRelease - s.twistMs)) / s.twistMs) : 0);
  // handling before the press: slow turns about every axis, back to the grip 300 ms before it
  const handle = (tt) => {
    if (!s.handleMs || tt > -300 || tt < -300 - s.handleMs) return null;
    const u = (tt + 300 + s.handleMs) / s.handleMs, k = Math.sin(Math.PI * u);
    return mul(mul(Rx(35 * D2R * k * Math.sin(2 * Math.PI * u)), Ry(-30 * D2R * k * Math.sin(3 * Math.PI * u))), Rz(25 * D2R * k));
  };
  const G = GRIPS[s.grip];
  const aim = (tt) => {
    if (!aimTime) return 0;
    const u = (tt - aimStart) / aimTime;
    const wob = s.aimJitterDeg && u > 0 && u < 1 ? s.aimJitterDeg * Math.sin(2 * Math.PI * 4.3 * tt / 1000) * Math.sin(Math.PI * u) : 0;
    return s.aimDeg * ease((tt - aimStart) / aimTurn) + wob;
  };
  const Rdev = (tt) => {
    const H = handle(tt);
    let R = mul(mul(Rz((aim(tt) + psi(tt)) * D2R), Rx(theta(tt) * D2R)), Rz(twist(tt) * D2R));
    if (H) R = mul(R, H);
    return mul(R, G);
  };
  const pos = (tt) => app(mul(Rz((aim(tt) + psi(tt)) * D2R), Rx(theta(tt) * D2R)), [0, 0, -s.L]);
  return { s, theta, psi, twist, aim, Rdev, pos, tRelease, tStart: -300 - s.handleMs - 200, tEnd: Math.min(end, tRelease + 600), fwdStart, backStart, backEnd, fwdEnd };
}

// The sensor readings at time tt (ms) of a swing: device-frame rotation rate (deg/s, x y z),
// specific force (accelerometer, m/s2), linear acceleration, and up (for the orientation)
export function readingAt(sw, tt) {
  const h = 0.5;                                   // ms
  const R0 = sw.Rdev(tt), Rm = sw.Rdev(tt - h), Rp = sw.Rdev(tt + h);
  const dR = Rp.map((r, i) => r.map((v, j) => (v - Rm[i][j]) / (2 * h / 1000)));
  const W = mul(T(R0), dR);                        // skew: [w]x
  const w = [(W[2][1] - W[1][2]) / 2 * R2D, (W[0][2] - W[2][0]) / 2 * R2D, (W[1][0] - W[0][1]) / 2 * R2D];
  const hp = 2;                                     // ms, for the acceleration
  const p0 = sw.pos(tt), pm = sw.pos(tt - hp), pp = sw.pos(tt + hp);
  const aw = p0.map((v, i) => (pp[i] - 2 * v + pm[i]) / Math.pow(hp / 1000, 2));
  const lin = app(T(R0), aw);
  const f = app(T(R0), [aw[0], aw[1], aw[2] + G0]);
  const up = app(T(R0), [0, 0, 1]);
  return { w, f, lin, up };
}

// beta, gamma (W3C, gamma in [-90, 90)) for a device-frame up vector
export function orientationOf(up) {
  const [ux, uy, uz] = up;
  let g = Math.abs(uz) > 1e-9 ? Math.atan(-ux / uz) : (ux > 0 ? -Math.PI / 2 : Math.PI / 2);
  if (g >= Math.PI / 2) g -= Math.PI;
  const cg = Math.cos(g), sg = Math.sin(g);
  const cb = Math.abs(cg) > 1e-6 ? uz / cg : -ux / sg;
  return { beta: Math.atan2(uy, cb) * R2D, gamma: g * R2D };
}

// The events a page would get: devicemotion { t, rr, ag, acc, interval } and deviceorientation
// { t, beta, gamma }, at fs Hz with noise, timing jitter and dropped samples
export function sampleSwing(sw, t0 = sw.tStart, t1 = sw.tEnd) {
  const s = sw.s, out = [];
  const step = 1000 / s.fs;
  for (let tt = t0; tt <= t1; tt += step) {
    if (s.drop && rand() < s.drop) continue;
    const te = tt + (s.jitterMs ? gauss() * s.jitterMs : 0);
    const r = readingAt(sw, tt);
    const w = r.w.map((v, i) => v + s.bias[i] + (s.gyroNoise ? gauss() * s.gyroNoise : 0));
    const f = r.f.map((v) => (v + (s.accNoise ? gauss() * s.accNoise : 0)) * (s.accInvert ? -1 : 1));
    // rotationRate as Chromium gives it (alpha about x, beta about y, gamma about z), or in the
    // orientation angles' order (alpha about z), for the frame check
    const rr = s.frame === 'zxy' ? { alpha: w[2], beta: w[0], gamma: w[1] } : { alpha: w[0], beta: w[1], gamma: w[2] };
    const o = orientationOf(r.up);
    out.push({ t: te, rr, ag: { x: f[0], y: f[1], z: f[2] }, acc: { x: r.lin[0], y: r.lin[1], z: r.lin[2] }, interval: step, beta: o.beta, gamma: o.gamma, w: r.w, up: r.up });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

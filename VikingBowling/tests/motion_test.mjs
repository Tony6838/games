// The swing -> throw mapping (js/sim3d/motion.js and motionParams in js/sim3d/input.js), run in
// node with synthetic sensor traces (tests/motion_traces.mjs: a rigid arm and phone, any grip).
//   node tests/motion_test.mjs
// Each trace is fed through the same MotionTracker the page uses (the gyroscope-frame and
// accelerometer-sign checks, "up" tracking, the "hold still" calibration at the press), then
// analyzeSwing() and motionParams(), and the throws are rolled down the lane with the game's
// own physics: the ball speed the lane shows (km/h) and where the ball is at the head pin.
import { MotionTracker, analyzeSwing, MOTION, FRAMES, upFromOrientation } from '../js/sim3d/motion.js';
import { motionParams, motionFingerMmS, launchSpeed, releaseLineError, aimAt, THROW } from '../js/sim3d/input.js';
import { AimTracker } from '../js/sim3d/motion.js';
import { LanePhysics, LANE } from '../js/sim3d/physics.js';
import { makeSwing, sampleSwing, orientationOf } from './motion_traces.mjs';

let failures = 0, checks = 0;
const fail = (msg) => { failures++; console.log('FAIL ' + msg); };
const check = (ok, msg) => { checks++; if (!ok) fail(msg); };

// One swing through the tracker as the page handles it: press at t = 0, "hold still" first if
// the tracker is not calibrated yet, release at the swing's release time. keep: the press's samples
// are kept however long the button is held, as MotionThrow.down does (false: as before that fix)
function run(o, tracker = new MotionTracker(), { keep = true } = {}) {
  const sw = makeSwing(o);
  const ev = sampleSwing(sw);
  // a tracker that has seen a swing before goes on in time: this swing's clock is moved on
  const off = tracker.lastT ? tracker.lastT + 300 - ev[0].t : 0;
  for (const e of ev) e.t += off;
  sw.tRelease += off;
  let calib = !tracker.calibrated, tStart = off, snapped = calib, up0 = null;
  if (keep) tracker.keepFrom = off;
  for (const e of ev) {
    if (e.t > sw.tRelease + 200) break;
    // a press without "hold still": "up" from the orientation event, as the page does
    if (!snapped && e.t >= tStart) { tracker.snapUp(tStart); snapped = true; up0 = tracker.up.slice(); }
    // the swing button is held from the press (after "hold still") to the release
    tracker.swinging = !calib && e.t >= tStart && e.t <= sw.tRelease;
    tracker.pushOrientation(e.t, e.beta, e.gamma);
    tracker.push({ t: e.t, rr: e.rr, ag: e.ag, interval: e.interval });
    if (calib && e.t >= off) {
      const done = e.t - off >= MOTION.calibMs && tracker.isStill(e.t - MOTION.calibMs, e.t);
      if (done || e.t - off >= MOTION.calibMaxMs) { if (done) tracker.calibrate(e.t - MOTION.calibMs, e.t); else { tracker.calibrated = true; tracker.snapUp(e.t); } calib = false; tStart = e.t; up0 = tracker.up.slice(); }
    }
  }
  tracker.swinging = false;
  const a = analyzeSwing(tracker.samples, tStart, sw.tRelease, MOTION, up0);
  tracker.keepFrom = null;
  const p = a.ok ? motionParams(a, 0) : null;
  return { a, p, sw, tracker, tStart };
}

// The ball down the lane: the speed the lane shows and the ball at the head pin (cm from the middle)
const lane = new LanePhysics();
function roll(p) {
  lane.resetPins(0x3FF);
  lane.release({ ...p, z0: 0 });
  let g = 0;
  while (lane.state !== 'deck' && lane.state !== 'done' && g++ < 8000) lane.step(1 / 240);
  const ls = lane.laneSpeed();
  const x = lane.entry ? lane.entry.x : lane.ball.position.x;
  return { kmh: ls ? ls * 3.6 : null, xcm: x * 100, gutter: lane.inGutter };
}
const f1 = (v, d = 1) => (v === null || v === undefined ? '-' : (+v).toFixed(d));

// ---- 0. building blocks ------------------------------------------------------------------------------
{
  // orientation <-> up round trip, and the mapping's anchors
  for (const up of [[0, 0, 1], [0, 1, 0], [0.3, -0.5, 0.81], [-0.7, 0.1, -0.7], [0.99, 0.1, 0]]) {
    const n = Math.hypot(...up), u = up.map((v) => v / n), o = orientationOf(u), b = upFromOrientation(o.beta, o.gamma);
    check(Math.hypot(b[0] - u[0], b[1] - u[1], b[2] - u[2]) < 1e-6, `orientation round trip for ${u.map((v) => v.toFixed(2))}`);
  }
  check(Math.abs(launchSpeed(motionFingerMmS(MOTION.weakDps)) - THROW.vMin) < 1e-9, 'the weakest swing must be the weakest swipe');
  check(Math.abs(launchSpeed(motionFingerMmS(MOTION.topDps)) - launchSpeed(THROW.topMmS)) < 1e-9, 'the fastest swing must be the fastest swipe');
  check(Math.abs(launchSpeed(motionFingerMmS(300)) - 6.25) < 0.03, '300 deg/s must be about 6.25 m/s (a 400 mm/s swipe)');
}

// ---- 1. speed: slow to fast swings ----------------------------------------------------------------------
console.log('\n## 1. Swing speed -> ball (the agreed grip: upright like a remote, 60 Hz, straight, no twist)\n');
console.log('| swing | forward peak (deg/s, true) | measured (deg/s) | launch (m/s) | lane shows (km/h) | at the head pin (cm) | result |');
console.log('|---|---|---|---|---|---|---|');
const SPEEDS = [
  ['too gentle', 55, 25, 20], ['very slow', 100, 30, 30], ['slow', 150, 40, 40], ['slow-medium', 200, 50, 45], ['medium', 300, 60, 60],
  ['medium-fast', 450, 70, 60], ['fast', 600, 80, 60], ['very fast', 900, 90, 60], ['flat out', 1300, 90, 70]
];
const ref60 = {};
let prevSpeed = 0;
for (const [name, dps, back, fwd] of SPEEDS) {
  const r = run({ peakDps: dps, backDeg: back, fwdDeg: fwd });
  if (!r.a.ok) {
    console.log(`| ${name} | ${dps} | ${f1(r.a.rate, 0)} | - | - | - | ${r.a.reason} |`);
    check(dps < MOTION.weakDps && r.a.reason === 'weak', `a ${dps} deg/s swing must throw, or be too weak below ${MOTION.weakDps} (got ${r.a.reason})`);
    continue;
  }
  const b = roll(r.p);
  ref60[dps] = r.p.speed;
  console.log(`| ${name} | ${dps} | ${f1(r.a.rate, 0)} | ${f1(r.p.speed, 2)} | ${f1(b.kmh)} | ${f1(b.xcm)} | thrown |`);
  if (dps <= MOTION.topDps) check(Math.abs(r.a.rate / dps - 1) < 0.04, `${name}: measured ${r.a.rate.toFixed(0)} deg/s for ${dps}`);
  check(r.p.speed > prevSpeed || dps > MOTION.topDps, `${name}: a quicker swing must be a faster ball (${r.p.speed.toFixed(2)} after ${prevSpeed.toFixed(2)})`);
  check(Math.abs(r.p.angle) < 1e-9 && Math.abs(r.p.side) < 1e-9, `${name}: a straight swing must be straight (angle ${r.p.angle}, side ${r.p.side})`);
  // the agreed grip (upright like a remote, long side along the forearm) swings about the phone's short axis
  check(r.a.axisFromX < 3, `${name}: the remote grip must swing about the phone's short axis x (found ${r.a.axisFromX.toFixed(1)} deg off)`);
  prevSpeed = r.p.speed;
}
{
  // the range as the swipe's: a small swing about 13 km/h, a full free swing about 20, a hard one 25+
  const k = (dps) => roll(run({ peakDps: dps, backDeg: 50, fwdDeg: 50 }).p).kmh;
  const s120 = k(120), s300 = k(300), s650 = k(650);
  console.log(`\nRange: 120 deg/s ${f1(s120)} km/h, 300 deg/s ${f1(s300)} km/h, 650 deg/s ${f1(s650)} km/h (the swipe: about 13-26 km/h for 120-1200 mm/s)`);
  check(s120 > 11 && s120 < 15.5, `a small swing (120 deg/s) must give about 13 km/h (got ${f1(s120)})`);
  check(s300 > 18 && s300 < 23, `a full free swing (300 deg/s) must give about 20 km/h (got ${f1(s300)})`);
  check(s650 > 24 && s650 < 28.5, `a hard swing (650 deg/s) must give about 25-27 km/h (got ${f1(s650)})`);
}

// ---- 2. the same swing at 30 Hz, other grips, noise ---------------------------------------------
console.log('\n## 2. The same swings at 30 Hz and in other grips (launch m/s, deviation from portrait 60 Hz)\n');
console.log('| forward peak | remote grip 60 Hz | remote grip 30 Hz | on its side 60 Hz | on its side 30 Hz | in the palm, screen forward | odd grip, 30 Hz |');
console.log('|---|---|---|---|---|---|---|');
for (const dps of [150, 300, 600]) {
  const base = run({ peakDps: dps }).p.speed;
  const cells = [];
  for (const o of [{ fs: 30 }, { grip: 'landscape' }, { grip: 'landscape', fs: 30 }, { grip: 'portraitDown' }, { grip: 'odd', fs: 30 }]) {
    const r = run({ peakDps: dps, ...o });
    if (!r.a.ok) { cells.push(r.a.reason); fail(`${dps} deg/s ${JSON.stringify(o)}: ${r.a.reason}`); continue; }
    const dev = (r.p.speed / base - 1) * 100;
    cells.push(`${f1(r.p.speed, 2)} (${dev >= 0 ? '+' : ''}${f1(dev)} %)`);
    check(Math.abs(dev) < 3, `${dps} deg/s ${JSON.stringify(o)}: ${dev.toFixed(1)} % from portrait 60 Hz`);
    check(Math.abs(r.p.angle) < 0.002 && Math.abs(r.p.side) < 0.5, `${dps} deg/s ${JSON.stringify(o)}: a straight swing must stay straight (angle ${r.p.angle.toFixed(4)}, side ${r.p.side.toFixed(2)})`);
  }
  console.log(`| ${dps} | ${f1(base, 2)} | ${cells.join(' | ')} |`);
}

// ---- 3. the line: the phone turned left or right ----------------------------------------------------
console.log('\n## 3. Pull and push: the swing turned left (+) or right (-) about the vertical during the swing, no aim (medium swing, 300 deg/s)\n');
console.log('An error on top of the aim: ' + MOTION.pullDeadDeg + ' degree dead zone, then ' + MOTION.pullPerRad + ' rad per radian.\n');
console.log('| turned (deg) | when | grip, rate | heading measured (deg) | angle (rad) | at the head pin (cm, + right) |');
console.log('|---|---|---|---|---|---|');
let prevX = Infinity;
for (const psi of [-35, -20, -10, -5, -3, 0, 3, 5, 10, 20, 35]) {
  const r = run({ peakDps: 300, psiDeg: psi });
  const b = roll(r.p);
  console.log(`| ${psi} | backswing | remote grip, 60 Hz | ${f1(r.a.heading)} | ${f1(r.p.angle, 4)} | ${f1(b.xcm)} |`);
  check(Math.abs(r.a.heading - psi) < 2.5, `turned ${psi}: heading measured ${r.a.heading.toFixed(1)}`);
  if (Math.abs(psi) <= MOTION.pullDeadDeg) check(r.p.angle === 0 || Math.abs(r.p.angle) < 1e-9, `turned ${psi}: inside the dead zone the line must be straight`);
  else check(Math.sign(r.p.angle) === -Math.sign(psi), `turned ${psi}: left must go left, right right (angle ${r.p.angle})`);
  check(b.xcm <= prevX + 0.01, `turned ${psi}: more to the left must end further left (${b.xcm.toFixed(1)} after ${prevX.toFixed(1)})`);
  prevX = b.xcm;
}
for (const [psi, o, label] of [[15, { psiPhase: 'fwdEarly', peakDps: 200 }, 'forward swing, 200 deg/s'], [-15, { psiPhase: 'fwdEarly', peakDps: 200, fs: 30 }, 'forward swing, 200 deg/s, 30 Hz'],
  [15, { grip: 'landscape' }, 'backswing, on its side'], [-15, { grip: 'portraitDown', fs: 30 }, 'backswing, palm, 30 Hz'], [15, { grip: 'odd', peakDps: 600 }, 'backswing, odd grip, 600 deg/s']]) {
  const r = run({ peakDps: 300, psiDeg: psi, ...o });
  const b = roll(r.p);
  console.log(`| ${psi} | ${label.split(',')[0]} | ${label.split(',').slice(1).join(',').trim() || 'remote grip, 60 Hz'} | ${f1(r.a.heading)} | ${f1(r.p.angle, 4)} | ${f1(b.xcm)} |`);
  check(Math.abs(r.a.heading - psi) < 3, `turned ${psi} (${label}): heading measured ${r.a.heading.toFixed(1)}`);
}

// ---- 3b. the aim ---------------------------------------------------------------------------------------------
console.log('\n## 3b. Aim first, then swing: the phone turned while held still after the press, locked by the backswing\n');
console.log('1 board at the arrows (15 ft) per degree, board 5 to 35; the marker shows the board; a straight swing follows the aim exactly.\n');
console.log('| aim (deg, + left) | swing | stance x0 (m) | aim locked (deg) | marker board | aimed angle (rad) | pull (rad) | thrown angle (rad) | at the arrows (cm, + right) | at the head pin (cm) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const [aim, o, x0, label] of [
  [0, {}, 0, 'straight'], [5, {}, 0, 'straight'], [10, {}, 0, 'straight'], [-10, {}, 0, 'straight'], [15, {}, 0, 'straight'], [-15, {}, 0, 'straight'],
  [40, {}, 0, 'straight (beyond the range)'], [-40, {}, 0, 'straight (beyond the range)'],
  [-8, {}, 0.25, 'straight, standing right'], [8, {}, -0.25, 'straight, standing left'],
  [10, { psiDeg: 20 }, 0, 'pulled 20 left in the swing'], [10, { psiDeg: -20 }, 0, 'pushed 20 right in the swing'], [10, { psiDeg: 4 }, 0, 'turned 4 in the swing (dead zone)'],
  [10, { aimJitterDeg: 2 }, 0, 'straight, the hand wobbling 2 deg while aiming'],
  [10, { fs: 30 }, 0, 'straight, 30 Hz'], [10, { grip: 'landscape' }, 0, 'straight, on its side'], [-10, { peakDps: 600 }, 0, 'straight, fast'], [10, { startDeg: 60 }, 0, 'straight, aiming chest high']
]) {
  const r = run({ peakDps: 300, aimDeg: aim, ...o });
  if (!r.a.ok) { fail(`aim ${aim} ${label}: ${r.a.reason}`); continue; }
  const p = motionParams(r.a, x0);
  const want = aimAt(aim, x0);
  const b = roll({ ...p });
  console.log(`| ${aim} | ${label} | ${x0} | ${f1(r.a.aimYaw, 2)} | ${p.aimBoard} | ${f1(p.aimAngle, 4)} | ${f1(p.pullRad, 4)} | ${f1(p.angle, 4)} | ${f1((x0 + Math.tan(p.angle) * MOTION.arrowsM) * 100)} | ${f1(b.xcm)} |`);
  check(r.a.aimLocked, `aim ${aim} ${label}: the backswing must lock the aim`);
  const tol = o.aimJitterDeg ? 0.5 : 0.15;
  check(Math.abs(r.a.aimYaw - aim) < tol, `aim ${aim} ${label}: locked ${r.a.aimYaw.toFixed(2)} for ${aim} (within ${tol} deg)`);
  if (!o.psiDeg || Math.abs(o.psiDeg) <= MOTION.pullDeadDeg) check(Math.abs(p.angle - want.angle) < 0.001 && p.pullRad === 0, `aim ${aim} ${label}: a straight swing must follow the aim exactly (${p.angle.toFixed(4)} vs ${want.angle.toFixed(4)})`);
  else {
    const err = -(Math.abs(o.psiDeg) - MOTION.pullDeadDeg) * Math.sign(o.psiDeg) * Math.PI / 180 * MOTION.pullPerRad;
    check(Math.abs(p.angle - (want.angle + err)) < 0.0012, `aim ${aim} ${label}: the aim plus the pull (${p.angle.toFixed(4)} vs ${(want.angle + err).toFixed(4)})`);
  }
  if (Math.abs(aim) >= 30) check(p.aimBoard === (aim > 0 ? MOTION.aimMaxBoard : MOTION.aimMinBoard), `aim ${aim}: the marker must stop at board ${aim > 0 ? 35 : 5} (${p.aimBoard})`);
}
{
  // the live tracker smooths a wobbling hand: the marker moves far less than the hand
  const tr = new AimTracker();
  let maxRaw = 0, maxSm = 0;
  for (let t = 0; t <= 1500; t += 16.7) {
    const yawRate = 2 * 2 * Math.PI * 4.3 * Math.cos(2 * Math.PI * 4.3 * t / 1000);   // a 2 degree wobble at 4.3 Hz
    tr.push(t, [0, yawRate, 0], [0, 1, 0], 16.7);
    if (t > 500) { maxRaw = Math.max(maxRaw, Math.abs(tr.raw)); maxSm = Math.max(maxSm, Math.abs(tr.yaw)); }
  }
  console.log(`\nA 2 degree wobble at 4.3 Hz while aiming: the hand ${f1(maxRaw, 2)} deg, the marker ${f1(maxSm, 2)} deg (${f1(maxSm * MOTION.aimBoardsPerDeg, 2)} boards)`);
  check(maxSm < 0.6 * maxRaw && !tr.locked, 'the aim must smooth a wobbling hand, and turning about the vertical must not lock it');
}

// ---- 4. the hook: the wrist turned at the release --------------------------------------------------------
console.log('\n## 4. Hook: the wrist turned in the last 150 ms (+ = counterclockwise seen from above: a right-hander\'s release)\n');
console.log('| wrist turn (deg) | twist measured (deg) | side rotation (rad/s) | line (rad) | at the head pin (cm, + right) |');
console.log('|---|---|---|---|---|');
let prevSide = -Infinity;
for (const tw of [-90, -60, -30, -8, 0, 8, 30, 60, 90]) {
  const r = run({ peakDps: 300, twistDeg: tw, releaseU: 0.6 });
  const b = roll({ ...r.p, x0: 0.25 });
  console.log(`| ${tw} | ${f1(r.a.twist)} | ${f1(r.p.side, 2)} | ${f1(r.p.angle, 4)} | ${f1(b.xcm)} |`);
  check(Math.abs(-r.a.twist - tw) < Math.max(4, 0.12 * Math.abs(tw)), `wrist ${tw}: twist measured ${r.a.twist.toFixed(1)}`);
  if (Math.abs(tw) <= 8) check(Math.abs(r.p.side) < 0.6, `wrist ${tw}: inside the dead zone almost no hook (side ${r.p.side.toFixed(2)})`);
  else check(Math.sign(r.p.side) === Math.sign(tw), `wrist ${tw}: a right-hander's turn must hook as a right-hander's ball (side ${r.p.side})`);
  check(r.p.side >= prevSide - 0.01, `wrist ${tw}: more turn, more hook`);
  check(Math.abs(r.p.angle) < 0.004, `wrist ${tw}: a wrist turn must not move the line much (angle ${r.p.angle.toFixed(4)})`);
  prevSide = r.p.side;
}
for (const o of [{ fs: 30 }, { grip: 'landscape' }, { grip: 'portraitDown', fs: 30 }, { peakDps: 600 }, { peakDps: 150 }]) {
  const r = run({ peakDps: 300, twistDeg: 50, releaseU: 0.6, ...o });
  check(r.a.ok && r.p.side > 3, `wrist 50 ${JSON.stringify(o)}: must hook (side ${r.a.ok ? r.p.side.toFixed(2) : r.a.reason})`);
  console.log(`| 50 (${JSON.stringify(o)}) | ${f1(r.a.twist)} | ${f1(r.p.side, 2)} | ${f1(r.p.angle, 4)} | - |`);
}
{
  // line and hook together: each stays its own
  const r = run({ peakDps: 300, psiDeg: 15, twistDeg: 45, releaseU: 0.6 });
  console.log(`\nTurned 15 left and a 45 degree right-hander's wrist turn: heading ${f1(r.a.heading)}, twist ${f1(r.a.twist)}, angle ${f1(r.p.angle, 4)}, side ${f1(r.p.side, 2)}`);
  check(r.p.angle < -0.005 && r.p.side > 3, 'line and hook together must both show');
}

// ---- 5. noise, jitter, dropped samples, a gyroscope offset ----------------------------------------------
console.log('\n## 5. Noise: 6 deg/s gyroscope and 0.3 m/s2 accelerometer noise, 4 ms timing jitter, 8 % dropped samples, a gyroscope offset (20 seeds each)\n');
console.log('The line is checked against where the aim marker stood (the player sees it drift and corrects it), the drift itself shown in boards.\n');
console.log('| swing | rate | speed: mean m/s (min-max) | spread | angle: max abs (rad) | aim drift before the lock: max (boards) | thrown line vs the marker: max (rad) | side: max abs (rad/s) | thrown |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [name, o] of [['medium, straight', { peakDps: 300 }], ['slow, straight, 30 Hz', { peakDps: 150, fs: 30 }], ['fast, straight, landscape', { peakDps: 600, grip: 'landscape' }],
  ['medium, 20 left', { peakDps: 300, psiDeg: 20 }], ['medium, wrist 50', { peakDps: 300, twistDeg: 50, releaseU: 0.6 }]]) {
  const speeds = [], angles = [], sides = [], drifts = [], vsMarker = []; let thrown = 0;
  const clean = run(o).p;
  for (let sd = 1; sd <= 20; sd++) {
    const r = run({ ...o, seed: sd, gyroNoise: 6, accNoise: 0.3, jitterMs: 4, drop: 0.08, bias: [1.5, -1.2, 0.8] });
    if (!r.a.ok) continue;
    thrown++; speeds.push(r.p.speed); angles.push(r.p.angle); sides.push(r.p.side);
    drifts.push(Math.abs(r.a.aimYaw - (o.aimDeg || 0)) * MOTION.aimBoardsPerDeg);
    vsMarker.push(Math.abs(r.p.angle - (aimAt(r.a.aimYaw, 0).angle + r.p.pullRad + r.p.timingRad)));
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const spread = (Math.max(...speeds) - Math.min(...speeds)) / mean * 100;
  const dA = Math.max(...angles.map((v) => Math.abs(v - clean.angle))), dS = Math.max(...sides.map((v) => Math.abs(v - clean.side)));
  console.log(`| ${name} | ${o.fs || 60} Hz | ${f1(mean, 2)} (${f1(Math.min(...speeds), 2)}-${f1(Math.max(...speeds), 2)}) | ${f1(spread)} % | ${f1(Math.max(...angles.map(Math.abs)), 4)} (clean ${f1(clean.angle, 4)}) | ${f1(Math.max(...drifts), 2)} | ${f1(Math.max(...vsMarker), 5)} | ${f1(Math.max(...sides.map(Math.abs)), 2)} (clean ${f1(clean.side, 2)}) | ${thrown}/20 |`);
  check(thrown === 20, `${name}: every noisy swing must throw (${thrown}/20)`);
  check(Math.abs(mean / clean.speed - 1) < 0.03 && spread < 8, `${name}: noise must not change the speed much (mean ${mean.toFixed(2)} vs ${clean.speed.toFixed(2)}, spread ${spread.toFixed(1)} %)`);
  check(Math.max(...vsMarker) < 1e-9, `${name}: the ball must go where the marker stood (${Math.max(...vsMarker)})`);
  check(Math.max(...drifts) < 2.0, `${name}: heavy noise may drift the aim at most 2 boards before the lock (${Math.max(...drifts).toFixed(2)})`);
  check(dA < 0.012, `${name}: noise must not change the line by more than the aim's drift (${dA.toFixed(4)} rad)`);
  check(dS < 2.0, `${name}: noise must not change the hook much (${dS.toFixed(2)} rad/s)`);
}

// ---- 6. swings that are not textbook --------------------------------------------------------------------
console.log('\n## 6. Hesitant and unusual swings\n');
console.log('| swing | result | rate (deg/s) | launch (m/s) | angle | side | lobes (sign, deg, peak deg/s) |');
console.log('|---|---|---|---|---|---|---|');
const lobeStr = (a) => (a.lobes || []).map((l) => `${l.sign > 0 ? '+' : '-'}${Math.round(l.deg)}@${l.peak}`).join(' ');
for (const row of [
  ['hesitant: wiggles first, a pause at the top', { hesitant: true, pauseMs: 400, peakDps: 250 }, 'throw'],
  ['a pause of 0.8 s at the top of the backswing', { pauseMs: 800, peakDps: 300 }, 'throw'],
  ['stance with the arm forward (50 deg), then down and back', { startDeg: 50, peakDps: 300 }, 'throw'],
  ['a small push forward (20 deg) first', { pushDeg: 20, peakDps: 300 }, 'throw'],
  ['a short backswing (25 deg), a full forward swing', { backDeg: 25, fwdDeg: 60, peakDps: 250 }, 'throw'],
  ['a big backswing (100 deg)', { backDeg: 100, fwdDeg: 70, peakDps: 450 }, 'throw'],
  ['released early in the forward swing (u 0.35): early, pushed right', { releaseU: 0.35, peakDps: 300 }, 'throw', 'early'],
  ['released at the end of the forward swing (u 0.95): late, pulled left', { releaseU: 0.95, peakDps: 300 }, 'throw', 'late'],
  ['released 300 ms after the forward swing: late, pulled left', { release: 'late', lateMs: 300, peakDps: 300 }, 'throw', 'late'],
  ['no swing: held still and let go', { release: 'none' }, 'noSwing'],
  ['let go at the top of the backswing', { release: 'top', peakDps: 300 }, 'noForward|noSwing'],
  ['let go halfway through the backswing', { release: 'midBack', peakDps: 300 }, 'noForward|noSwing'],
  ['swung, then held for 0.9 s and let go', { release: 'late', lateMs: 900, peakDps: 300 }, 'late'],
  ['a forward swing too slow (55 deg/s)', { peakDps: 55, backDeg: 30, fwdDeg: 30 }, 'weak'],
  ['a tiny swing (10 back, 10 forward)', { backDeg: 10, fwdDeg: 10, peakDps: 150 }, 'noSwing|weak']
]) {
  const [name, o, expect, timing] = row;
  const r = run(o);
  const res = r.a.ok ? 'throw' : r.a.reason;
  console.log(`| ${name} | ${res === 'throw' ? 'thrown' : 'no throw: ' + res} | ${f1(r.a.rate, 0)} | ${r.p ? f1(r.p.speed, 2) : '-'} | ${r.p ? f1(r.p.angle, 4) : '-'} | ${r.p ? f1(r.p.side, 2) : '-'} | ${lobeStr(r.a)} |`);
  check(expect.split('|').includes(res), `${name}: expected ${expect}, got ${res}`);
  if (r.p && !timing) check(Math.abs(r.p.angle) < 0.002 && Math.abs(r.p.side) < 0.6, `${name}: a straight swing must stay straight (angle ${r.p.angle.toFixed(4)}, side ${r.p.side.toFixed(2)})`);
  if (r.p && timing) check(timing === 'early' ? r.p.angle > 0.002 : r.p.angle < -0.002, `${name}: the release timing must move the line (${timing}: angle ${r.p.angle.toFixed(4)})`);
}

// ---- 6b. release timing ------------------------------------------------------------------------------------
console.log('\n## 6b. Release timing: a straight medium swing (60 back, 60 forward, 300 deg/s), let go at different points\n');
console.log('Window without error: ' + MOTION.releaseEarlyDeg + ' to +' + MOTION.releaseLateDeg + ' degrees of swing around the bottom; then up to 3 boards at the arrows over ' + MOTION.releaseRampDeg + ' degrees more. Early pushes right, late pulls left.\n');
console.log('| let go at | arm at the release (deg from vertical, true) | release measured (deg) | timing | line error (rad) | at the arrows (boards, + right) | at the head pin (cm, + right) |');
console.log('|---|---|---|---|---|---|---|');
const boards = (rad) => rad * 4.572 / 0.02703;
let prevErr = Infinity;
for (const [label, o] of [
  ['u 0.25', { releaseU: 0.25 }], ['u 0.30', { releaseU: 0.30 }], ['u 0.36', { releaseU: 0.36 }], ['u 0.42', { releaseU: 0.42 }], ['u 0.46', { releaseU: 0.46 }],
  ['u 0.50 (the bottom)', { releaseU: 0.50 }], ['u 0.56', { releaseU: 0.56 }], ['u 0.62', { releaseU: 0.62 }], ['u 0.68', { releaseU: 0.68 }],
  ['u 0.76', { releaseU: 0.76 }], ['u 0.86', { releaseU: 0.86 }], ['u 1.0 (the end of the swing)', { releaseU: 1.0 }],
  ['150 ms after the swing', { release: 'late', lateMs: 150 }], ['350 ms after the swing', { release: 'late', lateMs: 350 }]
]) {
  const r = run({ peakDps: 300, ...o });
  const trueDeg = r.sw.theta(makeSwing({ peakDps: 300, ...o }).tRelease);
  const err = r.p ? r.p.timingRad : null;
  const timing = !r.p ? r.a.reason : err > 0 ? 'early' : err < 0 ? 'late' : 'on time';
  const b = r.p ? roll({ ...r.p, x0: 0 }) : null;
  console.log(`| ${label} | ${f1(trueDeg)} | ${f1(r.a.releaseDeg)} | ${timing} | ${r.p ? f1(err, 4) : '-'} | ${r.p ? f1(boards(r.p.angle), 2) : '-'} | ${b ? f1(b.xcm) : '-'} |`);
  check(r.a.ok, `${label}: must throw`);
  if (!r.p) continue;
  check(Math.abs(r.a.releaseDeg - Math.max(trueDeg, Math.min(trueDeg, 0))) < 4 || trueDeg > 0, `${label}: release measured ${r.a.releaseDeg.toFixed(1)} for the arm at ${trueDeg.toFixed(1)}`);
  // right at the bottom the rate barely falls: a release up to ~15 degrees past it may read as 0 (both on time)
  if (trueDeg > 15) check(Math.abs(r.a.releaseDeg - trueDeg) < 4, `${label}: past the bottom, release measured ${r.a.releaseDeg.toFixed(1)} for ${trueDeg.toFixed(1)}`);
  if (trueDeg >= -6 && trueDeg <= 26) check(err === 0, `${label}: on time must add no error (${err})`);
  if (trueDeg < -15) check(err > 0, `${label}: early must push right (${err})`);
  if (trueDeg > 35 || o.release === 'late') check(err < 0, `${label}: late must pull left (${err})`);
  check(Math.abs(boards(err)) <= 3.0001, `${label}: at most 3 boards at the arrows (${boards(err).toFixed(2)})`);
  check(err <= prevErr + 1e-9, `${label}: the later the release, the further left (${err} after ${prevErr})`);
  prevErr = err;
}
{
  // the same at 30 Hz, in landscape, and with a stance with the arm forward (on time)
  for (const [label, o, want] of [['30 Hz, u 0.30 (early)', { releaseU: 0.30, fs: 30 }, 'early'], ['30 Hz, u 0.95 (late)', { releaseU: 0.95, fs: 30 }, 'late'],
    ['landscape, u 0.62 (on time)', { releaseU: 0.62, grip: 'landscape' }, 'on time'], ['stance with the arm forward, u 0.62 (on time)', { releaseU: 0.62, startDeg: 50 }, 'on time'],
    ['fast (600 deg/s), u 0.95 (late)', { releaseU: 0.95, peakDps: 600 }, 'late'], ['aiming chest high (arm 60 forward), u 0.33 (early, arm 31 behind)', { releaseU: 0.33, startDeg: 60, aimDeg: 6 }, 'early'], ['aiming chest high, u 0.5 (on time)', { releaseU: 0.5, startDeg: 60, aimDeg: 6 }, 'on time'], ['slow (150 deg/s), u 0.30 (early)', { releaseU: 0.30, peakDps: 150, backDeg: 40, fwdDeg: 45 }, 'early']]) {
    const r = run({ peakDps: 300, ...o });
    const err = r.p ? r.p.timingRad : null;
    const got = err > 0 ? 'early' : err < 0 ? 'late' : 'on time';
    console.log(`| ${label} | - | ${f1(r.a.releaseDeg)} | ${got} | ${f1(err, 4)} | ${f1(boards(r.p.timingRad), 2)} | - |`);
    check(got === want, `${label}: expected ${want}, got ${got}`);
  }
  check(releaseLineError(0) === 0 && releaseLineError(-90) > 0 && releaseLineError(120) < 0 && Math.abs(boards(releaseLineError(-500)) - 3) < 1e-6, 'releaseLineError: zero on time, capped at 3 boards');
}

// ---- 7. platforms: which rotationRate axis is which, the accelerometer's sign -------------------------
console.log('\n## 7. Platform differences found from the data (the phone handled for 2.5 s before the press)\n');
console.log('| rotationRate mapping, accelerometer sign | frame found | sign found | rate | heading (20 left) | twist (wrist 50) |');
console.log('|---|---|---|---|---|---|');
for (const [frame, inv] of [['xyz', false], ['zxy', false], ['xyz', true], ['zxy', true]]) {
  const r1 = run({ frame, accInvert: inv, peakDps: 300, psiDeg: 20 });
  const r2 = run({ frame, accInvert: inv, peakDps: 300, twistDeg: 50, releaseU: 0.6, seed: 3 }, r1.tracker);
  console.log(`| ${frame}${inv ? ', inverted' : ''} | ${FRAMES[r1.tracker.frame].id} | ${r1.tracker.accSign} | ${f1(r1.a.rate, 0)} | ${f1(r1.a.heading)} | ${f1(r2.a.twist)} |`);
  check(FRAMES[r1.tracker.frame].id === frame, `${frame}: the mapping must be found (got ${FRAMES[r1.tracker.frame].id})`);
  check(r1.tracker.accSign === (inv ? -1 : 1), `${frame}${inv ? ' inverted' : ''}: the accelerometer's sign must be found`);
  check(Math.abs(r1.a.heading - 20) < 3 && r2.a.twist < -40, `${frame}${inv ? ' inverted' : ''}: line and hook must come out right`);
}
{
  // a swing straight after another (calibrated, no "hold still"): the tracker carries on
  const tr = new MotionTracker();
  const a = run({ peakDps: 300 }, tr);
  const b = run({ peakDps: 450, stillMs: 150, handleMs: 600, seed: 2 }, tr);
  console.log(`\nTwo swings in a row (the second without "hold still"): ${f1(a.a.rate, 0)} and ${f1(b.a.rate, 0)} deg/s, angles ${f1(a.p.angle, 4)} / ${f1(b.p.angle, 4)}`);
  check(b.a.ok && Math.abs(b.a.rate / 450 - 1) < 0.05 && Math.abs(b.p.angle) < 0.002, 'the second swing must throw as the first did');
}

// ---- 8. the swing button: no dead button --------------------------------------------------------------
console.log('\n## 8. The swing button: a long hold, slow or stalled sensors, a lost release, an unanswered permission, the menus\n');
{
  // a long hold: aiming for 10 s before the swing (more than the 8 s of history kept otherwise)
  const ref = run({ peakDps: 300, aimDeg: 12 });
  const long = run({ peakDps: 300, aimDeg: 12, aimHoldMs: 10000 });
  const lost = run({ peakDps: 300, aimDeg: 12, aimHoldMs: 10000 }, new MotionTracker(), { keep: false });
  console.log(`Aim 12 left, held 10 s before the swing: locked ${f1(long.a.ok ? long.a.aimYaw : NaN, 2)} deg, angle ${long.p ? f1(long.p.angle, 4) : '-'} (held 0.35 s: ${f1(ref.p.angle, 4)}); without keeping the press's samples: locked ${f1(lost.a.ok ? lost.a.aimYaw : NaN, 2)}`);
  check(long.a.ok && long.a.aimLocked && Math.abs(long.a.aimYaw - 12) < 0.2 && Math.abs(long.p.angle - ref.p.angle) < 0.001, 'a 10 s hold must keep the aim: the ball goes where the marker stood');
  check(!lost.a.ok || Math.abs(lost.a.aimYaw - 12) > 2, 'the long-hold check is not vacuous: dropping the press\'s samples loses the aim');
  // the stream's rate, as the release measures it
  const r60 = new MotionTracker(), r5 = new MotionTracker();
  for (let t = 0; t < 2000; t += 16.7) r60.push({ t, rr: { alpha: 0, beta: 0, gamma: 0 }, ag: { x: 0, y: 0, z: 9.81 } });
  for (let t = 0; t < 2000; t += 200) r5.push({ t, rr: { alpha: 0, beta: 0, gamma: 0 }, ag: { x: 0, y: 0, z: 9.81 } });
  check(r60.rateAround(1990) > 50 && r5.rateAround(1990) < MOTION.minHz && r60.rateAround(4000) === 0, `the stream's rate: 60 Hz ${r60.rateAround(1990)}, 5 Hz ${r5.rateAround(1990)}, stalled ${r60.rateAround(4000)}`);
}
{
  // MotionThrow itself, on a minimal stand-in for the page (elements, window, document, storage):
  // the button's events as the browser sends them, and the sensor events
  const registry = () => { const L = {}; return { L, add: (t, f) => { (L[t] = L[t] || []).push(f); }, remove: (t, f) => { L[t] = (L[t] || []).filter((x) => x !== f); }, fire: (t, e) => { for (const f of (L[t] || []).slice()) f(e); }, count: (t) => (L[t] || []).length }; };
  const el = (tag, parent = null) => {
    const r = registry(), kids = {}, cls = new Set();
    const e = {
      tag, parent, id: '', className: '', hidden: false, textContent: '', innerHTML: '',
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); } },
      setAttribute() {}, appendChild(c) { c.parent = e; return c; }, setPointerCapture() {},
      querySelector: (sel) => kids[sel] || (kids[sel] = el(sel, e)),
      addEventListener: r.add, removeEventListener: r.remove, fire: r.fire,
      contains(x) { for (; x; x = x.parent) if (x === e) return true; return false; }
    };
    return e;
  };
  const win = registry(), doc = registry(), storage = new Map();
  const saved = {};
  const setG = (k, v) => { if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
  setG('window', globalThis);
  setG('addEventListener', win.add); setG('removeEventListener', win.remove);
  setG('document', { createElement: (t) => el(t), body: el('body'), addEventListener: doc.add, removeEventListener: doc.remove, hidden: false, fullscreenElement: null });
  setG('localStorage', { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) });
  setG('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', maxTouchPoints: 5 });
  setG('screen', { orientation: { type: 'portrait-primary' } });
  setG('location', { search: '' });
  setG('DeviceMotionEvent', function DeviceMotionEvent() {});
  const { MotionThrow } = await import('../js/sim3d/motion.js');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const keep = { noEventsMs: MOTION.noEventsMs, permissionMs: MOTION.permissionMs, pauseMs: MOTION.pauseMs };
  MOTION.noEventsMs = 300; MOTION.permissionMs = 60; MOTION.pauseMs = 60;
  const fresh = () => { storage.clear(); storage.set('vbg.motionIntro', 'true'); };
  const make = () => { const log = { fallback: [], hints: [], throws: 0 }; const m = new MotionThrow({ onThrow: () => log.throws++, onHint: (k) => log.hints.push(k), onFallback: (k) => log.fallback.push(k), onAimTarget() {}, onChooseSwipe() {} }); m.log = log; return m; };
  let clock = 1000;
  // (the events' own clock is the page's, as Event.timeStamp and performance.now() share it)
  const feed = (m, n, hz) => { clock = Math.max(clock, performance.now()); for (let i = 0; i < n; i++) { clock += 1000 / hz; win.fire('devicemotion', { timeStamp: clock, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, accelerationIncludingGravity: { x: 0, y: -9.81, z: 0 }, interval: 1000 / hz }); } };
  const press = (m, id = 1, type = 'touch') => m.btn.fire('pointerdown', { pointerId: id, pointerType: type, button: 0, timeStamp: clock, preventDefault() {} });
  const live = [];
  const readyOne = () => { const m = make(); m.show(); feed(m, 40, 60); live.push(m); return m; };
  const rows = [];
  const row = (what, ok, got) => { rows.push(`| ${what} | ${ok ? 'ok' : 'FAIL'} | ${got} |`); check(ok, `${what}: ${got}`); };

  // ready at the first gyroscope event, whatever the start is like: the first events come while the
  // game starts (the page at its busiest) and are not judged - the presses are
  const pressSlow = async (mm, id) => { clock += 3000; press(mm, id, 'mouse'); clock += 500; win.fire('pointerup', { pointerId: id, timeStamp: clock }); await wait(80); };
  fresh();
  let m = make(); m.show(); live.push(m);
  const early = m.state;
  feed(m, 1, 60);
  row('60 Hz sensors: ready at the first gyroscope event', early === 'starting' && m.state === 'ready', `${early} before, ${m.state} after one event`);
  m.hide(); m.pause();
  // a start-up stall: one event, then nothing for 300 ms (the game starting), then 60 Hz again
  fresh();
  clock = performance.now();
  const mst = make(); mst.show(); live.push(mst);
  feed(mst, 1, 60); clock += 300; feed(mst, 30, 60);
  await wait(2 * MOTION.noEventsMs + 80);
  row('a stall while the game starts: still the swing, and nothing counted against the sensors', mst.state === 'ready' && !mst.log.fallback.length && storage.get('vbg.motionMisses') === undefined && storage.get('vbg.motionUnavailable') !== 'true',
    `${mst.state}, fallbacks [${mst.log.fallback.join()}], misses ${storage.get('vbg.motionMisses')}, unavailable ${storage.get('vbg.motionUnavailable')}`);
  mst.hide(); mst.pause();
  // a genuinely slow sensor (5 Hz): ready at once, then two presses with too few events - the swipe
  clock = performance.now();
  const m5 = make(); m5.show(); m5.visible = true; live.push(m5);
  feed(m5, 4, 5);
  const ready5 = m5.state;
  for (let k = 0; k < 2; k++) { press(m5, 30 + k, 'mouse'); feed(m5, 3, 5); win.fire('pointerup', { pointerId: 30 + k, timeStamp: clock }); await wait(80); }
  row('5 Hz sensors: the swing at first, the swipe with a note after two presses', ready5 === 'ready' && m5.state === 'failed' && m5.log.fallback[0] === 'motionSlow', `${ready5} -> ${m5.state}, ${m5.log.fallback.join()}`);
  row('one failure (too slow) is not remembered for good', storage.get('vbg.motionUnavailable') !== 'true' && storage.get('vbg.motionMisses') === '1', `unavailable ${storage.get('vbg.motionUnavailable')}, misses ${storage.get('vbg.motionMisses')}`);
  // the next page with the same slow sensor: the swing again at first (its start clears nothing), two slow presses, remembered
  clock = performance.now();
  const m5b = make(); m5b.show(); m5b.visible = true; live.push(m5b);
  feed(m5b, 4, 5);
  for (let k = 0; k < 2; k++) { press(m5b, 40 + k, 'mouse'); feed(m5b, 3, 5); win.fire('pointerup', { pointerId: 40 + k, timeStamp: clock }); await wait(80); }
  row('the same slow sensor on the next page: the swipe again, and now "Auto" remembers it', m5b.state === 'failed' && m5b.log.fallback[0] === 'motionSlow' && storage.get('vbg.motionUnavailable') === 'true', `${m5b.state} ${m5b.log.fallback.join()}, unavailable ${storage.get('vbg.motionUnavailable')}`);
  fresh();
  const mn = make(); mn.show(); await wait(MOTION.noEventsMs + 60);
  const firstRound = mn.state;
  await wait(MOTION.noEventsMs + 60);
  row('no sensor data at all: given a second round, then the swipe, not remembered after once', firstRound === 'starting' && mn.state === 'failed' && mn.log.fallback[0] === 'motionNone' && storage.get('vbg.motionUnavailable') !== 'true',
    `${firstRound} after one round, ${mn.state} after two, ${mn.log.fallback.join()}, unavailable ${storage.get('vbg.motionUnavailable')}`);
  const mok = readyOne(); mok.visible = true;
  press(mok, 50, 'mouse'); win.fire('pointerup', { pointerId: 50, timeStamp: clock + 30 }); await wait(80);
  row('a press the sensors followed clears the miss', mok.state === 'ready' && storage.get('vbg.motionMisses') === '0' && storage.get('vbg.motionUnavailable') === 'false', `misses ${storage.get('vbg.motionMisses')}, unavailable ${storage.get('vbg.motionUnavailable')}`);
  mok.hide(); mok.pause();
  fresh();
  const md = make(); md.fail('motionDenied');
  row('the permission refused: remembered at once', storage.get('vbg.motionUnavailable') === 'true', `unavailable ${storage.get('vbg.motionUnavailable')}`);

  // the permission request that is never answered (iOS)
  fresh();
  setG('DeviceMotionEvent', Object.assign(function DeviceMotionEvent() {}, { requestPermission: () => new Promise(() => {}) }));
  const mp = make(); mp.visible = true; mp.allow();
  const during = mp.state;
  await wait(MOTION.permissionMs + 60);
  row('a permission request never answered: not "starting" for good - the swipe, with a note', during === 'starting' && mp.state === 'failed' && mp.log.fallback[0] === 'motionNone', `${during} -> ${mp.state} ${mp.log.fallback.join()}`);
  // ... answered "granted" after the timeout (the player read the prompt slowly): the swing comes back
  fresh();
  let answer = null;
  setG('DeviceMotionEvent', Object.assign(function DeviceMotionEvent() {}, { requestPermission: () => new Promise((r) => { answer = r; }) }));
  let recovered = 0;
  const ml = new MotionThrow({ onThrow() {}, onHint() {}, onFallback() {}, onAimTarget() {}, onChooseSwipe() {}, onRecover: () => recovered++ });
  live.push(ml); ml.visible = true; ml.allow();
  await wait(MOTION.permissionMs + 60);
  const atTimeout = { st: ml.state, misses: storage.get('vbg.motionMisses') };
  answer('granted'); await wait(20);
  clock = performance.now(); feed(ml, 3, 60);
  row('a permission granted after the timeout: the swing back, the miss forgotten', atTimeout.st === 'failed' && atTimeout.misses === '1' && ml.state === 'ready' && recovered === 1 && storage.get('vbg.motionMisses') === '0' && storage.get('vbg.motionUnavailable') === 'false' && ml.granted,
    `at the timeout ${JSON.stringify(atTimeout)}; after the grant ${ml.state}, recovered ${recovered}, misses ${storage.get('vbg.motionMisses')}`);
  ml.hide(); ml.pause();
  setG('DeviceMotionEvent', function DeviceMotionEvent() {});

  // the press is never stuck
  fresh();
  m = readyOne(); m.visible = true;
  const other = el('lane');
  press(m, 3, 'touch');
  win.fire('pointercancel', { pointerId: 3, pointerType: 'touch' });            // the browser took the touch over
  win.fire('touchend', { changedTouches: [{ target: other }], touches: [{ target: m.btn }] });     // another finger lifted
  const heldWhileOtherLifts = !!m.press;
  clock += 400;
  win.fire('touchend', { timeStamp: clock, changedTouches: [{ target: m.btn.querySelector('b') }], touches: [{ target: other }] });   // the thumb, a finger resting
  row('a touch taken over by the browser: the thumb lifting releases, though another finger rests on the screen', heldWhileOtherLifts && !m.press, `held while the other finger lifted ${heldWhileOtherLifts}, released ${!m.press}`);
  await wait(80);
  for (const [what, act] of [
    ['the page hidden (an app switch) cancels the press', () => { document.hidden = true; doc.fire('visibilitychange', {}); document.hidden = false; }],
    ['the window losing focus cancels the press', () => win.fire('blur', {})],
    ['a lost pointer capture cancels the press', () => m.btn.fire('lostpointercapture', { pointerId: 5 })]
  ]) {
    feed(m, 10, 60);
    press(m, 5, 'mouse');
    const was = !!m.press;
    act();
    row(what, was && !m.press, `pressed ${was}, cancelled ${!m.press}`);
  }
  feed(m, 10, 60);
  press(m, 6, 'mouse');
  win.fire('pointerup', { pointerId: 6, timeStamp: clock + 300 });                // let go beside the button
  row('a release beside the button (outside it) still releases', !m.press, `released ${!m.press}`);
  await wait(80);
  row('placing the ball works again after any of these (no press held)', !m.press && !m.tracker.swinging, `press ${!!m.press}, swinging ${m.tracker.swinging}`);

  // the sensor stream stalls while the button is shown: two presses in a row, the swipe
  const before = m.log.fallback.length;
  for (let k = 0; k < 2; k++) { clock += 3000; press(m, 10 + k, 'mouse'); clock += 500; win.fire('pointerup', { pointerId: 10 + k, timeStamp: clock }); await wait(80); }
  row('a stalled sensor stream: after two presses the swipe takes over, with a note', m.state === 'failed' && m.log.fallback[before] === 'motionSlow', `${m.state} ${m.log.fallback.slice(before).join()}`);
  fresh();
  m = readyOne(); m.visible = true;
  press(m, 20, 'mouse'); win.fire('pointerup', { pointerId: 20, timeStamp: clock + 30 }); await wait(80);
  row('a quick tap with the sensors running is not counted as a stalled stream', m.bad === 0 && m.state === 'ready', `bad ${m.bad}, ${m.state}`);

  // no devicemotion listener on the menus, nor after a long wait; back at the player's turn
  const on1 = win.count('devicemotion');
  m.hide(); m.pause();
  const off1 = win.count('devicemotion');
  m.show(); feed(m, 10, 60);
  const on2 = win.count('devicemotion');
  m.hide(); await wait(MOTION.pauseMs + 60);
  const off2 = win.count('devicemotion');
  m.show(); feed(m, 10, 60);
  row('the sensors stop on the menus and after a long wait, and start again at the turn (no new card)', on1 === 1 && off1 === 0 && on2 === 1 && off2 === 0 && m.state === 'ready', `listeners ${on1} -> menu ${off1} -> turn ${on2} -> long wait ${off2}; ${m.state}`);

  console.log('| case | | what happened |');
  console.log('|---|---|---|');
  for (const r of rows) console.log(r);
  for (const x of live) { x.hide(); x.pause(); }
  Object.assign(MOTION, keep);
  for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);

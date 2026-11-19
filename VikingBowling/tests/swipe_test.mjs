// The grip-and-release throw (js/sim3d/input.js), run in node with synthetic pointer events.
//   node tests/swipe_test.mjs
// A headless browser cannot time a swipe (each synthetic event waits for a software-rendered
// frame), so the gesture maths is checked here, and the throws it gives are rolled down the
// lane with the game's own physics. Every event carries its own timeStamp, as a real one does.
import { LanePhysics, LANE } from '../js/sim3d/physics.js';

let now = 0;
globalThis.performance = { now: () => now };
const listeners = {};
globalThis.window = { innerHeight: 844, innerWidth: 390, devicePixelRatio: 1, addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
const setGlobal = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
const { SwipeInput, STANCE, THROW, launchSpeed, gripTwistDeg, twistSideRaw, sideFactor } = await import('../js/sim3d/input.js');
const el = { addEventListener: (t, f) => { listeners['el' + t] = f; }, setPointerCapture() {} };
const canvas = { getContext: () => ({ setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, closePath() {} }), width: 0, height: 0, clientWidth: 390, clientHeight: 844 };
let thrown = null, placed = null, modes = [];
const input = new SwipeInput(el, canvas, { onThrow: (p) => { thrown = p; }, onPosition: (x, z) => { placed = { x, z }; }, onWeak() { thrown = 'weak'; }, onMode: (m, info) => modes.push({ m, info }) });
let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL ' + msg); };

// ---- devices: the viewport, what the browser says about itself, and the real CSS px per mm --
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X706B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
const DEVICES = [
  { id: 'iPhone 15, portrait', W: 393, H: 852, ua: IPHONE, touch: 5, scr: [393, 852], pxmm: 6.1, pt: 'touch' },
  { id: 'iPhone 15, landscape', W: 852, H: 393, ua: IPHONE, touch: 5, scr: [393, 852], pxmm: 6.1, pt: 'touch' },
  { id: 'Galaxy S23, portrait', W: 360, H: 780, ua: ANDROID_PHONE, touch: 5, scr: [360, 780], pxmm: 5.7, pt: 'touch' },
  { id: 'Galaxy S23, landscape', W: 780, H: 360, ua: ANDROID_PHONE, touch: 5, scr: [780, 360], pxmm: 5.7, pt: 'touch' },
  { id: 'iPad 10.9", portrait', W: 820, H: 1180, ua: IPAD, touch: 5, scr: [820, 1180], pxmm: 5.2, pt: 'touch' },
  { id: 'iPad 10.9", landscape', W: 1180, H: 820, ua: IPAD, touch: 5, scr: [820, 1180], pxmm: 5.2, pt: 'touch' },
  { id: 'Galaxy Tab S8, portrait', W: 800, H: 1280, ua: ANDROID_TAB, touch: 10, scr: [800, 1280], pxmm: 5.3, pt: 'touch' },
  { id: 'laptop 15.6" touch screen, 125 %', W: 1536, H: 864, ua: WINDOWS, touch: 10, scr: [1536, 864], pxmm: 4.4, pt: 'touch' },
  { id: 'desktop 24" touch screen, 100 %', W: 1920, H: 1080, ua: WINDOWS, touch: 10, scr: [1920, 1080], pxmm: 3.6, pt: 'touch' }
];
const PHONE = DEVICES[0];
function useDevice(d) {
  window.innerWidth = d.W; window.innerHeight = d.H;
  setGlobal('navigator', { userAgent: d.ua, maxTouchPoints: d.touch });
  setGlobal('screen', { width: d.scr[0], height: d.scr[1] });
}

// ---- gestures ---------------------------------------------------------------------------
// points: [{ x, y, t }], t in ms; the first is the press, the pointer-up follows the last
// (upAfter ms later: a finger that lifts while it moves; more than THROW.restMs is a finger that stopped)
function gesture(points, { pt = 'touch', id = 1, upAfter = 4 } = {}) {
  thrown = null; placed = null;
  const p0 = points[0];
  now = p0.t;
  listeners.elpointerdown({ button: 0, pointerId: id, pointerType: pt, clientX: p0.x, clientY: p0.y, timeStamp: p0.t, preventDefault() {} });
  for (const p of points.slice(1)) { now = p.t; listeners.pointermove({ pointerId: id, pointerType: pt, clientX: p.x, clientY: p.y, timeStamp: p.t }); }
  const last = points[points.length - 1];
  now = Math.max(now, last.t + upAfter);
  listeners.pointerup({ pointerId: id, pointerType: pt, clientX: last.x, clientY: last.y, timeStamp: last.t + upAfter });
  return thrown;
}
// a straight move from (x, y) by (dx, dy) px at `pxs` px/s, sampled every 8 ms (as a touch screen does)
function stroke(x, y, dx, dy, pxs, t0) {
  const len = Math.hypot(dx, dy), T = len / pxs * 1000, out = [];
  for (let t = 8; t < T; t += 8) out.push({ x: x + dx * t / T, y: y + dy * t / T, t: t0 + t });
  out.push({ x: x + dx, y: y + dy, t: t0 + T });
  return out;
}
// a forward swipe of `mm` millimetres at fingerMmS on device d (its real pixel density)
function deviceSwipe(d, fingerMmS, mm = 45) {
  useDevice(d);
  input.enable(0);
  const x = d.W / 2, y = d.H * 0.85, t0 = 1000;
  return gesture([{ x, y, t: t0 }, ...stroke(x, y, 0, -mm * d.pxmm, fingerMmS * d.pxmm, t0)], { pt: d.pt });
}
// the mapping before the grip throw: viewport heights per second, a hard cap at 10.2 m/s
const oldLaunch = (pxs, H) => Math.max(4.2, Math.min(10.2, 4.2 + (pxs / H - 0.5) * 1.35));

// ---- 1. speed follows the finger's release speed, on a clear monotone curve -----------------
console.log('\n## 1. Release speed -> launch speed (iPhone 15 portrait, 45 mm swipe)\n');
console.log('| finger mm/s | CSS px/s | launch m/s | expected launchSpeed() | launch m/s two mappings ago (viewport heights/s, capped) |');
console.log('|---|---|---|---|---|');
let prev = 0;
for (const f of [50, 75, 100, 170, 250, 400, 550, 700, 1000, 1200, 1600, 2000]) {
  const p = deviceSwipe(PHONE, f);
  const sp = p && p !== 'weak' ? p.speed : null;
  console.log(`| ${f} | ${Math.round(f * PHONE.pxmm)} | ${sp ? sp.toFixed(2) : p} | ${launchSpeed(f * PHONE.pxmm / 6).toFixed(2)} | ${oldLaunch(f * PHONE.pxmm, PHONE.H).toFixed(2)} |`);
  if (!sp) { if (f >= 55) fail(`a ${f} mm/s swipe must throw`); continue; }
  if (!(sp > prev)) fail(`a quicker swipe must be a faster ball (${f} mm/s: ${sp.toFixed(2)} after ${prev.toFixed(2)})`);
  prev = sp;
}
if (deviceSwipe(PHONE, 35) !== null) fail('a release slower than 50 mm/s must not throw (the ball is placed)');
if (deviceSwipe(PHONE, 400, 12) !== 'weak') fail('a quick flick shorter than 17 mm must be too weak');
{
  const p = deviceSwipe(PHONE, 4200 / PHONE.pxmm);
  if (!(Math.abs(p.speed - 7.05) < 0.08)) fail(`a 4200 px/s swipe must launch at about 7.05 m/s (got ${p.speed.toFixed(2)})`);
}

// ---- 2. the same finger speed gives the same ball on every device -----------------------------
console.log('\n## 2. The same finger speed on different devices (real pixel densities)\n');
console.log('| device | CSS px per mm | 170 mm/s | 400 mm/s | 1000 mm/s |');
console.log('|---|---|---|---|---|');
const ref = {};
for (const f of [170, 400, 1000]) ref[f] = deviceSwipe(PHONE, f).speed;
for (const d of DEVICES) {
  const cells = [];
  for (const f of [170, 400, 1000]) {
    const p = deviceSwipe(d, f);
    const dev = (p.speed / ref[f] - 1) * 100;
    cells.push(`${p.speed.toFixed(2)} (${dev >= 0 ? '+' : ''}${dev.toFixed(1)} %)`);
    if (Math.abs(dev) > 4) fail(`${d.id}: ${f} mm/s gives ${p.speed.toFixed(2)} m/s, ${dev.toFixed(1)} % from the phone's ${ref[f].toFixed(2)}`);
  }
  console.log(`| ${d.id} | ${d.pxmm} | ${cells.join(' | ')} |`);
}
{
  const d = { id: 'desktop, mouse', W: 1920, H: 1080, ua: WINDOWS, touch: 0, scr: [1920, 1080], pxmm: 6.0, pt: 'mouse' };
  const p = deviceSwipe(d, 400);
  console.log(`| desktop, mouse (taken as 6 CSS px per mm) | - | - | ${p.speed.toFixed(2)} | - |`);
  if (Math.abs(p.speed - launchSpeed(400)) > 0.02) fail('a mouse swipe of 2400 px/s must give the 400 mm/s ball');
}

// ---- 3. the moment of release decides ----------------------------------------------------------
console.log('\n## 3. The release decides (iPhone 15 portrait)\n');
useDevice(PHONE);
const mm = PHONE.pxmm;
// a stroke whose speed changes: `parts` [[dx mm, dy mm, mm/s], ...] one after the other
function parts(list, { x = 196, y = 700, upAfter = 4, x0 = 0, z0 = STANCE.zMin } = {}) {
  input.enable(x0, z0);
  const t0 = 1000, pts = [{ x, y, t: t0 }];
  for (const [dx, dy, v] of list) {
    const q = pts[pts.length - 1];
    pts.push(...stroke(q.x, q.y, dx * mm, dy * mm, v * mm, q.t));
  }
  return gesture(pts, { upAfter });
}
console.log('| gesture | result | speed m/s | line deg | side rad/s |');
console.log('|---|---|---|---|---|');
const row = (label, p) => console.log(`| ${label} | ${p === null ? 'no throw' + (placed ? `, ball at x ${placed.x.toFixed(3)} z ${placed.z.toFixed(2)}` : '') : p === 'weak' ? 'too weak' : 'throw'} | ${p && p.speed ? p.speed.toFixed(2) : '-'} | ${p && p.speed ? (p.angle * 180 / Math.PI).toFixed(2) : '-'} | ${p && p.speed ? p.side.toFixed(2) : '-'} |`);
{
  const straight = parts([[0, -45, 400]]);
  row('straight push up, 45 mm at 400 mm/s', straight);
  if (!(straight && straight.speed && straight.side === 0 && straight.angle === 0)) fail('a straight push must give no side spin and a straight line');
  // speed and direction are the release's, not the stroke's average
  const slowEnd = parts([[0, -35, 1000], [0, -12, 150]]), fastEnd = parts([[0, -25, 150], [0, -75, 1000]]);
  row('fast, then the last 80 ms at 150 mm/s', slowEnd);
  row('slow, then the last 75 ms at 1000 mm/s', fastEnd);
  if (!(Math.abs(slowEnd.speed - launchSpeed(150)) < 0.1 && Math.abs(fastEnd.speed - launchSpeed(1000)) < 0.1)) fail('the speed must be the release speed (the last 70 ms)');
  const lateFlick = parts([[0, -25, 150], [0, -20, 1000]]);
  row('slow, then a 20 ms flick at 1000 mm/s', lateFlick);
  if (!(lateFlick.speed > launchSpeed(300) && lateFlick.speed < launchSpeed(500))) fail('a flick shorter than the window counts with the drag before it');
  const turnRight = parts([[0, -30, 300], [8, -20, 300]]);
  row('straight up, then the last 72 ms angled 22 deg right', turnRight);
  if (!(Math.abs(turnRight.angle - Math.atan2(8, 20) * THROW.lineK) < 0.001)) fail('the line must follow the direction at the release');
  if (!(turnRight.side < 0)) fail('a path turning right at the release must spin the ball to the right');
  // no pull-back boost any more: a pull-back is a drag back, and the push is what counts
  const pull = parts([[0, 30, 400], [0, -45, 400]]), plain = parts([[0, -45, 400]]);
  row('quick pull-back 30 mm, then 400 mm/s up', pull);
  if (!(Math.abs(pull.speed - plain.speed) < 0.05)) fail('a pull-back must add nothing (the release speed alone)');
  // no throw: slow, sideways, backward, stopped
  const slow = parts([[8, 25, 40]], { z0: 1.0 });
  row('slow drag right and back (40 mm/s), lift', slow);
  if (!(slow === null && placed && placed.x > 0.1 && placed.z > 2.5)) fail('a slow drag and lift must not throw, and leave the ball where it was let go');
  const slowFwd = parts([[0, -20, 30]], { z0: 3.0 });
  row('slow drag forward (30 mm/s), lift', slowFwd);
  if (!(slowFwd === null && placed && placed.z < 2.0)) fail('a slow forward drag must move the ball forward without a throw');
  const side = parts([[25, -4, 600]]);
  row('quick sideways release (81 deg off up)', side);
  if (side !== null) fail('a sideways release must never throw');
  const back = parts([[0, -30, 600], [0, 25, 400]]);
  row('up, then a quick pull back at the release', back);
  if (back !== null) fail('a backward release must never throw');
  const stopped = parts([[0, -45, 600]], { upAfter: 250 });
  row('a quick push that stops 250 ms before the lift', stopped);
  if (stopped !== null) fail('a finger that stopped before it lifted must not throw');
  const lifted = parts([[0, -45, 600]], { upAfter: 60 });
  if (!(lifted && lifted.speed)) fail('a finger lifted 60 ms after its last move (still moving) must throw');
  const tap = gesture([{ x: 196, y: 700, t: 1000 }], { upAfter: 120 });
  if (tap !== null) fail('a tap must not throw');
  // the clutch: a quick stroke does not move the ball; the stance stays where it was gripped
  const fromBack = parts([[3, -45, 800]], { x0: 0.1, z0: 2.5 });
  row('a throw from 2.5 m back, x 0.1', fromBack);
  if (!(fromBack && Math.abs(fromBack.z0 - 2.5) < 0.05 && Math.abs(fromBack.x0 - 0.1) < 0.02)) fail('a quick stroke must throw from where the ball stood');
  if (!(placed && placed.x === 0.1 && placed.z === 2.5 && input.x0 === 0.1 && input.z0 === 2.5)) fail('a throw must leave the stance where the ball was gripped');
  // a slow drag first, then a throw: the ball is where the drag left it at the release
  const dragThrow = parts([[6, 0, 40], [0, -45, 700]], { x0: 0, z0: STANCE.zMin });
  row('slow drag 6 mm right, then a push', dragThrow);
  if (!(dragThrow && dragThrow.x0 > 0.08)) fail('a slow drag before the push must move the ball first');
}

// ---- 4. moving the ball: the bounds and the arrow keys ---------------------------------------
console.log('\n## 4. Moving the ball (iPhone 15 portrait)\n');
{
  parts([[200, 200, 60]]);
  console.log(`| slow drag far right and down | clamped at x ${placed.x}, z ${placed.z} |`);
  if (!(placed.x === STANCE.maxX && placed.z === STANCE.zMax)) fail('the stance must stay on the approach (right edge, 4.4 m back)');
  parts([[-200, -200, 60]], { z0: 2 });
  console.log(`| slow drag far left and up | clamped at x ${placed.x}, z ${placed.z} |`);
  if (!(placed.x === -STANCE.maxX && placed.z === STANCE.zMin)) fail('the stance must stay on the approach (left edge, at the foul line)');
  // the grip shows at once, and the hints are told
  modes = [];
  input.enable(0, STANCE.zMin);
  gesture([{ x: 196, y: 700, t: 1000 }, ...stroke(196, 700, 30, 0, 200, 1000)]);
  const seq = modes.map((q) => q.m + (q.info && q.info.after ? ':' + q.info.after : '')).join(' ');
  console.log(`| modes for a slow sideways drag | ${seq} |`);
  if (seq !== 'ready grip ready:place') fail('the modes must be ready, grip (at the press), ready again after a drag');
  input.enable(0, 1.0);
  placed = null;
  listeners.keydown({ key: 'ArrowDown' }); const kz1 = placed && placed.z;
  listeners.keydown({ key: 'ArrowUp' }); listeners.keydown({ key: 'ArrowUp' }); const kz2 = placed && placed.z;
  listeners.keydown({ key: 'ArrowRight' }); const kx = placed && placed.x;
  console.log(`| arrow keys: down, up, up, right | z 1.00 -> ${kz1.toFixed(2)} -> ${kz2.toFixed(2)}, x ${kx.toFixed(3)} |`);
  if (!(kz1 > 1.0 && kz2 < 1.0 && kx > 0)) fail('the arrow keys must move the ball (up/down: forward/back)');
}

// ---- 5. the stance is only where the bowler stands: the lane does not change -------------
console.log('\n## 5. Standing back changes nothing on the lane\n');
{
  const lane = new LanePhysics();
  const roll = (z0) => {
    lane.resetPins(0); lane.release({ x0: 0.2, z0, speed: 7.05, angle: -0.01, side: 9, roll: 0.5 });
    let g = 0; while (lane.state !== 'deck' && lane.state !== 'done' && g++ < 5000) lane.step(1 / 240);
    return { ls: lane.laneSpeed(), x: lane.entry.x, t: lane.impactTime };
  };
  const a = roll(STANCE.zMin), b = roll(4.0);
  console.log(`| stance | lane speed km/h | at the pins x cm | foul line to pins s |\n|---|---|---|---|\n| 0.35 m | ${(a.ls * 3.6).toFixed(2)} | ${(a.x * 100).toFixed(2)} | ${a.t.toFixed(3)} |\n| 4.0 m | ${(b.ls * 3.6).toFixed(2)} | ${(b.x * 100).toFixed(2)} | ${b.t.toFixed(3)} |`);
  if (!(Math.abs(a.ls - b.ls) < 0.02 && Math.abs(a.x - b.x) < 0.005)) fail('standing back must not change the lane speed or the line');
}

// ---- 6. the line, the spin and the hook, down the lane ------------------------------------
console.log('\n## 6. Line, spin and hook (iPhone 15 portrait)\n');
useDevice(PHONE);
// a swipe from (x1, y1) to (x2, y2) in ms, bowed sideways by `bow` px at the end (bow * t^3: the
// curve is near the release)
function swipe(x1, y1, x2, y2, ms, bow = 0) {
  input.enable(0);
  const n = 16, t0 = 1000, pts = [{ x: x1, y: y1, t: t0 }];
  for (let i = 1; i <= n; i++) { const t = i / n; pts.push({ x: x1 + (x2 - x1) * t + bow * t * t * t, y: y1 + (y2 - y1) * t, t: t0 + ms * t }); }
  return gesture(pts);
}
// the ball's path with this spin against the same throw without it: how far it hooked at the pins
function hookOf(p) {
  const r = LanePhysics.predict({ x0: 0, speed: p.speed, angle: p.angle, side: p.side, roll: 0.5 }, 9);
  const r0 = LanePhysics.predict({ x0: 0, speed: p.speed, angle: p.angle, side: 0, roll: 0.5 }, 9);
  return { r, at: r.gutter ? null : r.entry.x, hook: r.entry && r0.entry ? r.entry.x - r0.entry.x : null };
}
const cases = [
  ['straight, quick (300 px in 150 ms)', [195, 780, 195, 480, 150, 0]],
  ['straight, slow (300 px in 600 ms)', [195, 780, 195, 480, 600, 0]],
  ['very fast flick (400 px in 110 ms)', [195, 790, 195, 390, 110, 0]],
  ['angled right', [180, 780, 230, 480, 160, 0]],
  ['hook: curves left at the end', [220, 780, 220, 470, 170, -70]],
  ['hook played out: aimed right, curving left', [180, 780, 260, 470, 170, -70]],
  ['back-up ball: curves right', [170, 780, 170, 470, 170, 70]],
  ['too short', [195, 780, 195, 720, 100, 0]]
];
console.log('| Swipe | speed m/s | release deg | turn deg | line deg | side rad/s | at the pins cm | hook cm |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [name, args] of cases) {
  const p = swipe(...args);
  if (!p || p === 'weak') { console.log(`| ${name} | - | - | - | - | - | not a throw (${p || 'none'}) | - |`); if (!name.startsWith('too short')) fail(name + ' must throw'); continue; }
  const h = hookOf(p);
  console.log(`| ${name} | ${p.speed.toFixed(2)} | ${(p.releaseDir * 180 / Math.PI).toFixed(1)} | ${(p.turn * 180 / Math.PI).toFixed(1)} | ${(p.angle * 180 / Math.PI).toFixed(2)} | ${p.side.toFixed(2)} | ${h.at === null ? 'gutter' : (h.at * 100).toFixed(0)} | ${h.hook === null ? '-' : (h.hook * 100).toFixed(0)} |`);
}
const quick = swipe(195, 780, 195, 480, 150, 0), slow = swipe(195, 780, 195, 480, 600, 0);
if (!(quick && slow && quick.speed > slow.speed)) fail('a quicker swipe must be a faster ball');
if (!(quick.side === 0 && quick.angle === 0)) fail('a straight swipe must give no spin and a straight line');
const hook = swipe(220, 780, 220, 470, 170, -70), backup = swipe(170, 780, 170, 470, 170, 70);
if (!(hook.side > 2 && backup.side < -2)) fail('a curve to the left must spin the ball to hook left (positive side), to the right negative');
{
  const h = hookOf(hook), b = hookOf(backup);
  if (!(h.hook < -0.08 && b.hook > 0.08)) fail(`the spin must hook the path in the physics (left ${h.hook}, right ${b.hook})`);
  // the hook is in the back end: straight in the oil, bending after it
  const path = h.r.path, p0 = path.find((q) => -q.z >= 3), p1 = path.find((q) => -q.z >= 11), p2 = path[path.length - 1];
  const early = (p1.x - p0.x) / (-p1.z + p0.z), late = (p2.x - p1.x) / (-p2.z + p1.z);
  console.log(`\nthe hook's path: ${(early * 1000).toFixed(1)} mm/m sideways in the oil (3-11 m), ${(late * 1000).toFixed(1)} mm/m after it`);
  if (!(late < early - 0.005)) fail('a left hook must bend left in the back end');
  if (!(Math.abs(hook.side) < 8)) fail('a curved swipe must spin the ball a little, not wildly');
}
if (swipe(180, 780, 230, 480, 160, 0).angle <= 0) fail('a swipe to the right must aim right');
if (swipe(195, 780, 195, 720, 100, 0) !== 'weak') fail('a short flick must be too weak');
// the same curve hooks further on a slower ball, and enters the pins at a steeper angle
{
  const hk = (ms) => {
    const p = swipe(260, 790, 260, 450, ms, -60);
    const r = LanePhysics.predict({ x0: 0.3, speed: p.speed, angle: 0, side: p.side, roll: 0.5 }, 9);
    const r0 = LanePhysics.predict({ x0: 0.3, speed: p.speed, angle: 0, side: 0, roll: 0.5 }, 9);
    return { sp: p.speed, side: p.side, hook: r.entry && r0.entry ? r0.entry.x - r.entry.x : null, deg: r.entry ? Math.atan2(r.entry.vx, -r.entry.vz) * 180 / Math.PI : null, gutter: r.gutter };
  };
  console.log('\n| the same curved swipe, slower to faster | launch m/s | side rad/s | hook at the pins cm | entry deg |');
  console.log('|---|---|---|---|---|');
  let last = null;
  for (const ms of [500, 300, 200, 130, 90]) {
    const h = hk(ms);
    console.log(`| 340 px in ${ms} ms | ${h.sp.toFixed(2)} | ${h.side.toFixed(1)} | ${h.gutter ? 'gutter' : (h.hook * 100).toFixed(0)} | ${h.deg != null ? h.deg.toFixed(1) : '-'} |`);
    if (last && !h.gutter && !last.gutter && !(h.hook < last.hook && Math.abs(h.deg) < Math.abs(last.deg))) fail('a faster ball must hook less and enter straighter');
    last = h;
  }
}

// ---- 7. the phone's twist at the release ---------------------------------------------------
console.log('\n## 7. Twisting the phone at the release\n');
{
  // gripTwistDeg: the turn about the screen's axis over the last 180 ms (deg, + counterclockwise)
  const rate = (zDps, t0 = 0, t1 = 1000, step = 16) => { const s = []; for (let t = t0; t <= t1; t += step) s.push({ t, z: typeof zDps === 'function' ? zDps(t) : zDps }); return s; };
  const ccw = gripTwistDeg(rate(200), 1000), cw = gripTwistDeg(rate(-200), 1000), none = gripTwistDeg(rate(0), 1000);
  console.log(`| 200 deg/s for the last 180 ms | ${ccw.toFixed(1)} deg | -200 | ${cw.toFixed(1)} | still | ${none.toFixed(1)} |`);
  if (!(Math.abs(ccw - 36) < 2 && Math.abs(cw + 36) < 2 && none === 0)) fail('the twist must be the turn over the last 180 ms');
  if (gripTwistDeg(rate(200, 0, 700), 1000) !== null) fail('no twist when the sensor stopped before the release');
  if (gripTwistDeg([{ t: 990, z: 100 }], 1000) !== null) fail('no twist from too few samples');
  const early = gripTwistDeg(rate((t) => (t < 700 ? 300 : 0)), 1000);
  if (!(Math.abs(early) < 0.5)) fail('a turn before the last 180 ms does not count');
  if (!(twistSideRaw(5) === 0 && twistSideRaw(-7.9) === 0)) fail('a twist inside the 8 degree dead zone gives no spin');
  if (!(Math.abs(twistSideRaw(30) - 22 * Math.PI / 180 * 18) < 1e-9 && twistSideRaw(-30) < 0)) fail('a twist gives 18 rad/s per radian past the dead zone');
  // a straight push with the phone twisted: the spin is the twist's; with a curve, both add
  const withTwist = (zDps, list) => {
    input.enable(0);
    input.twist.on = true;
    input.twist.samples = rate(zDps, 0, 3000, 16);
    const t0 = 2000, pts = [{ x: 196, y: 700, t: t0 }];
    for (const [dx, dy, v, bow] of list) {
      const q = pts[pts.length - 1];
      const s = stroke(q.x, q.y, dx * mm, dy * mm, v * mm, q.t);
      if (bow) s.forEach((o, i) => { const f = (i + 1) / s.length; o.x += bow * f * f * f; });
      pts.push(...s);
    }
    const p = gesture(pts);
    input.twist.on = false; input.twist.samples = [];
    return p;
  };
  const tl = withTwist(250, [[0, -45, 600]]), tr = withTwist(-250, [[0, -45, 600]]), t0 = withTwist(0, [[0, -45, 600]]);
  console.log(`| straight push, phone twisted counterclockwise 45 deg | twist ${tl.twist.toFixed(1)} deg, side ${tl.side.toFixed(2)} rad/s |`);
  console.log(`| straight push, clockwise | twist ${tr.twist.toFixed(1)} deg, side ${tr.side.toFixed(2)} rad/s |`);
  console.log(`| straight push, phone still | twist ${t0.twist.toFixed(1)} deg, side ${t0.side.toFixed(2)} rad/s |`);
  if (!(tl.side > 1 && tr.side < -1 && t0.side === 0)) fail('a counterclockwise twist must hook left, clockwise right, none nothing');
  if (!(Math.abs(tl.side - twistSideRaw(tl.twist) * sideFactor(tl.speed)) < 1e-9)) fail('the twist must map as the swing\'s wrist turn (scaled by sideFactor)');
  const both = withTwist(250, [[0, -45, 600, -50]]), curveOnly = withTwist(0, [[0, -45, 600, -50]]);
  console.log(`| a left curve plus a counterclockwise twist | side ${both.side.toFixed(2)} (the curve alone ${curveOnly.side.toFixed(2)}) |`);
  if (!(both.side > curveOnly.side + 0.5 && curveOnly.side > 0)) fail('the twist must add to the curve\'s spin');
  const maxed = withTwist(2500, [[0, -45, 600, -90]]);
  if (!(Math.abs(maxed.side - THROW.sideMax * sideFactor(maxed.speed)) < 1e-9)) fail('curve and twist together must be clamped to the same maximum');
  // no sensor (a desktop, no permission): no twist, the curve only
  input.enable(0);
  const noSensor = gesture([{ x: 196, y: 700, t: 1000 }, ...stroke(196, 700, 0, -270, 3600, 1000)]);
  if (!(noSensor.twist === null && noSensor.side === 0)) fail('without the sensor there is no twist');
}

// ---- 8. slow frames: a real swipe still throws, as fast as at full frame rate ---------------
// the browser handles the events in bursts, one coalesced pointermove per frame and the
// pointer-up a frame late, each point with its own e.timeStamp (when the finger was there)
console.log('\n## 8. Slow devices\n');
function slowSwipe(x1, y1, x2, y2, ms, fps, restMs = 0) {
  thrown = null;
  input.enable(0);
  const n = 16, frame = 1000 / fps, t0 = 1000;
  const pts = [];
  for (let i = 1; i <= n; i++) { const t = i / n; pts.push({ pointerId: 1, pointerType: 'touch', clientX: x1 + (x2 - x1) * t, clientY: y1 + (y2 - y1) * t, timeStamp: t0 + ms * t }); }
  now = t0 + frame * 0.9;                            // the press, handled late too
  listeners.elpointerdown({ button: 0, pointerId: 1, pointerType: 'touch', clientX: x1, clientY: y1, timeStamp: t0, preventDefault() {} });
  let next = 0;
  for (let f = 1; next < n; f++) {
    const until = t0 + f * frame;
    const batch = [];
    while (next < n && pts[next].timeStamp <= until) batch.push(pts[next++]);
    if (!batch.length) continue;
    now = until + frame * 0.9;
    const lastPt = batch[batch.length - 1];
    listeners.pointermove({ ...lastPt, getCoalescedEvents: () => batch });
  }
  const upAt = t0 + ms + restMs;
  now = Math.max(now, upAt) + frame;
  listeners.pointerup({ pointerId: 1, pointerType: 'touch', clientX: x2, clientY: y2, timeStamp: upAt });
  return thrown;
}
for (const fps of [6, 10, 20]) {
  for (const ms of [150, 260, 400]) {
    const r0 = swipe(195, 780, 195, 480, ms, 0), slowP = slowSwipe(195, 780, 195, 480, ms, fps);
    const ok = slowP && slowP !== 'weak' && Math.abs(slowP.speed - r0.speed) < 0.1;
    console.log(`| ${fps} fps, 300 px in ${ms} ms | ${slowP && slowP.speed ? slowP.speed.toFixed(2) : slowP} (full frame rate ${r0.speed.toFixed(2)}) | ${ok ? 'ok' : 'FAIL'} |`);
    if (!ok) failures++;
  }
}
if (slowSwipe(195, 780, 195, 480, 260, 6, 600) !== null) fail('a swipe that rests before it lets go must not be a throw');
// a still finger sends no moves: a rest, then a flick quicker than the 100 ms window
for (const f of [700, 1000, 2000]) {
  input.enable(0, STANCE.zMin);
  const t0 = 1000, q = gesture([{ x: 196, y: 700, t: t0 }, ...stroke(196, 700, 0, -45 * PHONE.pxmm, f * PHONE.pxmm, t0 + 250)]);
  console.log(`| press, rest 0.25 s without a move, flick at ${f} mm/s | throws ${q.speed.toFixed(2)} m/s (the same flick without the rest: ${launchSpeed(f * PHONE.pxmm / 6).toFixed(2)}) |`);
  if (!(Math.abs(q.speed - launchSpeed(f * PHONE.pxmm / 6)) < 0.08)) fail(`a rest before a ${f} mm/s flick must not slow it`);
}
// a busy browser gives up the touch's pointer stream after the first move (pointercancel)
// and goes on with touch events: the swipe still throws, as fast
{
  thrown = null; input.enable(0);
  const n = 16, ms = 260, t0 = 1000;
  now = t0 + 100;
  listeners.elpointerdown({ button: 0, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 780, timeStamp: t0, preventDefault() {} });
  const pt = (i) => ({ clientX: 195, clientY: 780 - 300 * i / n, timeStamp: t0 + ms * i / n });
  listeners.pointermove({ pointerId: 7, pointerType: 'touch', ...pt(1) });
  listeners.pointercancel({ pointerId: 7, pointerType: 'touch' });
  for (let i = 2; i <= n; i += 2) { now += 170; const p = pt(i); listeners.touchmove({ timeStamp: p.timeStamp, changedTouches: [{ clientX: p.clientX, clientY: p.clientY }], touches: [{}] }); }
  listeners.touchend({ timeStamp: t0 + ms + 10, changedTouches: [{ clientX: 195, clientY: 480 }], touches: [] });
  const got = thrown;
  const r0 = swipe(195, 780, 195, 480, ms, 0);
  const ok = got && got !== 'weak' && Math.abs(got.speed - r0.speed) < 0.1;
  console.log(`| pointer stream cancelled, the touch goes on as touch events | ${got && got.speed ? got.speed.toFixed(2) : got} (full frame rate ${r0.speed.toFixed(2)}) | ${ok ? 'ok' : 'FAIL'} |`);
  if (!ok) failures++;
  // the same, with one touchmove for the whole rest of the swipe (one frame): still a throw
  thrown = null; input.enable(0);
  listeners.elpointerdown({ button: 0, pointerId: 9, pointerType: 'touch', clientX: 195, clientY: 780, timeStamp: t0, preventDefault() {} });
  listeners.pointermove({ pointerId: 9, pointerType: 'touch', ...pt(1) });
  listeners.pointercancel({ pointerId: 9, pointerType: 'touch' });
  listeners.touchmove({ timeStamp: t0 + ms, changedTouches: [{ clientX: 195, clientY: 480 }], touches: [{}] });
  listeners.touchend({ timeStamp: t0 + ms + 10, changedTouches: [{ clientX: 195, clientY: 480 }], touches: [] });
  const one = thrown;
  const ok1 = one && one !== 'weak' && one.speed > 4.5;
  console.log(`| ... and only one touchmove after it | ${one && one.speed ? one.speed.toFixed(2) : one} | ${ok1 ? 'ok' : 'FAIL'} |`);
  if (!ok1) failures++;
  // a touchcancel cancels it for real
  thrown = null; input.enable(0);
  listeners.elpointerdown({ button: 0, pointerId: 8, pointerType: 'touch', clientX: 195, clientY: 780, timeStamp: t0, preventDefault() {} });
  listeners.pointermove({ pointerId: 8, pointerType: 'touch', ...pt(1) });
  listeners.pointercancel({ pointerId: 8, pointerType: 'touch' });
  listeners.touchmove({ timeStamp: t0 + 120, changedTouches: [{ clientX: 195, clientY: 600 }], touches: [{}] });
  listeners.touchcancel({});
  listeners.touchend({ timeStamp: t0 + 300, changedTouches: [{ clientX: 195, clientY: 480 }], touches: [] });
  if (thrown !== null) fail('a touchcancel must cancel the swipe');
}

console.log(failures ? `\n${failures} failures` : '\nAll swipe checks passed');
process.exitCode = failures ? 1 : 0;
void LANE;

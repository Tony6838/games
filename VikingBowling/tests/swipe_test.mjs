// The swipe -> throw mapping (js/sim3d/input.js), run in node with synthetic pointer events.
//   node tests/swipe_test.mjs
// A headless browser cannot time a swipe (each synthetic event waits for a software-rendered
// frame), so the gesture maths is checked here, and the throws it gives are rolled down the
// lane with the game's own physics. Every event carries its own timeStamp, as a real one does.
import { LanePhysics, LANE } from '../js/sim3d/physics.js';

let now = 0;
globalThis.performance = { now: () => now };
const listeners = {};
globalThis.window = { innerHeight: 844, innerWidth: 390, devicePixelRatio: 1, addEventListener: (t, f) => { listeners[t] = f; }, setTimeout: () => 0, clearTimeout() {} };
const setGlobal = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
const { SwipeInput, STANCE, THROW, launchSpeed } = await import('../js/sim3d/input.js');
const el = { addEventListener: (t, f) => { listeners['el' + t] = f; }, setPointerCapture() {} };
const canvas = { getContext: () => ({ setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, closePath() {} }), width: 0, height: 0, clientWidth: 390, clientHeight: 844 };
let thrown = null, placed = null, misplaced = 0;
const input = new SwipeInput(el, canvas, { onThrow: (p) => { thrown = p; }, onPosition: (x, z) => { placed = { x, z }; }, onWeak() { thrown = 'weak'; }, onMisplace() { misplaced++; } });
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
// the mapping before this change: viewport heights per second, a hard cap at 10.2 m/s
const oldLaunch = (pxs, H) => Math.max(4.2, Math.min(10.2, 4.2 + (pxs / H - 0.5) * 1.35));

// ---- 1. speed follows the finger, on a clear monotone curve ---------------------------------
console.log('\n## 1. Finger speed -> launch speed (iPhone 15 portrait, 45 mm swipe)\n');
console.log('| finger mm/s | CSS px/s | launch m/s (new) | expected launchSpeed() | launch m/s before (viewport heights/s, capped) |');
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
if (deviceSwipe(PHONE, 35) !== 'weak') fail('a swipe slower than 50 mm/s must be too weak');
if (deviceSwipe(PHONE, 400, 12) !== 'weak') fail('a swipe shorter than 17 mm must be too weak');
// the anchor: the finger speed at which the old mapping reached its cap on a phone in portrait
// (about 4200 CSS px/s) now gives two thirds of that speed down the lane
{
  const p = deviceSwipe(PHONE, 4200 / PHONE.pxmm);
  if (!(Math.abs(p.speed - 7.05) < 0.08)) fail(`a 4200 px/s swipe must launch at about 7.05 m/s (got ${p.speed.toFixed(2)})`);
}

// ---- 2. the same finger speed gives the same ball on every device -----------------------------
console.log('\n## 2. The same finger speed on different devices (real pixel densities)\n');
console.log('| device | CSS px per mm | 170 mm/s: new / before | 400 mm/s: new / before | 1000 mm/s: new / before |');
console.log('|---|---|---|---|---|');
const ref = {};
for (const f of [170, 400, 1000]) ref[f] = deviceSwipe(PHONE, f).speed;
for (const d of DEVICES) {
  const cells = [];
  for (const f of [170, 400, 1000]) {
    const p = deviceSwipe(d, f);
    const dev = (p.speed / ref[f] - 1) * 100;
    cells.push(`${p.speed.toFixed(2)} (${dev >= 0 ? '+' : ''}${dev.toFixed(1)} %) / ${oldLaunch(f * d.pxmm, d.H).toFixed(2)}`);
    if (Math.abs(dev) > 4) fail(`${d.id}: ${f} mm/s gives ${p.speed.toFixed(2)} m/s, ${dev.toFixed(1)} % from the phone's ${ref[f].toFixed(2)}`);
  }
  console.log(`| ${d.id} | ${d.pxmm} | ${cells.join(' | ')} |`);
}
// a mouse: its swipes are measured in CSS px/s as a phone finger's
{
  const d = { id: 'desktop, mouse', W: 1920, H: 1080, ua: WINDOWS, touch: 0, scr: [1920, 1080], pxmm: 6.0, pt: 'mouse' };
  const p = deviceSwipe(d, 400);
  console.log(`| desktop, mouse (taken as 6 CSS px per mm) | - | - | ${p.speed.toFixed(2)} / ${oldLaunch(400 * 6, 1080).toFixed(2)} | - |`);
  if (Math.abs(p.speed - launchSpeed(400)) > 0.02) fail('a mouse swipe of 2400 px/s must give the 400 mm/s ball');
}

// ---- 3. the pull-back adds power, capped; letting go before pushing cancels -----------------
console.log('\n## 3. Pull-back (iPhone 15 portrait)\n');
useDevice(PHONE);
function pullSwipe(pullMm, pullMmS, fMmS, fwdMm = 45, pauseMs = 0) {
  input.enable(0);
  const x = 196, y = 400, t0 = 1000, mm = PHONE.pxmm;
  const back = pullMm > 0 ? stroke(x, y, 0, pullMm * mm, pullMmS * mm, t0) : [];
  const yb = y + pullMm * mm;
  const tb = back.length ? back[back.length - 1].t + pauseMs : t0;
  const pause = pauseMs > 0 ? [{ x, y: yb, t: tb }] : [];
  const fwd = fMmS > 0 ? stroke(x, yb, 0, -fwdMm * mm, fMmS * mm, tb) : [];
  return gesture([{ x, y, t: t0 }, ...back, ...pause, ...fwd]);
}
console.log('| gesture | launch m/s | the pull-back adds m/s |');
console.log('|---|---|---|');
{
  const plain = pullSwipe(0, 0, 400);
  const shortP = pullSwipe(10, 100, 400), fullP = pullSwipe(30, 400, 400), longP = pullSwipe(60, 900, 400);
  for (const [label, p] of [['plain forward swipe, 400 mm/s', plain], ['short slow pull-back (10 mm at 100 mm/s), then 400 mm/s', shortP],
    ['full brisk pull-back (30 mm at 400 mm/s), then 400 mm/s', fullP], ['long fast pull-back (60 mm at 900 mm/s), then 400 mm/s', longP]])
    console.log(`| ${label} | ${p && p.speed ? p.speed.toFixed(2) : p} | ${p && p.boost != null ? p.boost.toFixed(2) : '-'} |`);
  if (!(shortP.speed > plain.speed + 0.05)) fail('a pull-back must add power');
  if (!(fullP.speed > shortP.speed)) fail('a longer, quicker pull-back must add more');
  if (!(Math.abs(fullP.boost - THROW.boostMax) < 0.01 && Math.abs(longP.boost - THROW.boostMax) < 0.01)) fail('the pull-back power must be capped at boostMax');
  const fast = pullSwipe(60, 900, 3000);
  console.log(`| long fast pull-back, then a 3000 mm/s flick | ${fast.speed.toFixed(2)} | ${fast.boost.toFixed(2)} (at most ${THROW.vCap} m/s in all) |`);
  if (!(fast.speed <= THROW.vCap + 1e-9)) fail('no ball faster than vCap');
  const c1 = pullSwipe(30, 400, 0);
  const c2 = pullSwipe(30, 400, 300, 3);                // pushed forward less than 5.5 mm
  console.log(`| pull-back, let go without pushing | ${c1 === null ? 'no throw (cancelled)' : JSON.stringify(c1)} | - |`);
  console.log(`| pull-back, a 3 mm nudge forward, let go | ${c2 === null ? 'no throw (cancelled)' : JSON.stringify(c2)} | - |`);
  if (c1 !== null || c2 !== null) fail('letting go during the pull-back must cancel, without a throw or "too weak"');
  const w = pullSwipe(30, 400, 30);
  console.log(`| pull-back, then a 30 mm/s push | ${w === 'weak' ? 'too weak' : JSON.stringify(w)} | - |`);
  if (w !== 'weak') fail('a pull-back with a too slow push is too weak');
  const paused = pullSwipe(30, 400, 400, 45, 250);
  console.log(`| pull-back, 250 ms pause at the bottom, then 400 mm/s | ${paused.speed.toFixed(2)} | ${paused.boost.toFixed(2)} |`);
  if (!(Math.abs(paused.speed - fullP.speed) < 0.05)) fail('the forward speed must be measured from the bottom of the pull-back');
  // the same pause without a move event (a still finger sends none), then a quick flick
  {
    input.enable(0);
    const x = 196, y = 400, t0 = 1000, mm = PHONE.pxmm;
    const back = stroke(x, y, 0, 30 * mm, 400 * mm, t0), tb = back[back.length - 1].t;
    const q = gesture([{ x, y, t: t0 }, ...back, ...stroke(x, y + 30 * mm, 0, -45 * mm, 1000 * mm, tb + 250)]);
    const want = Math.min(THROW.vCap, launchSpeed(1000 * mm / 6) + THROW.boostMax);
    console.log(`| pull-back, 250 ms still at the bottom (no events), then a 1000 mm/s flick | ${q.speed.toFixed(2)} (expected ${want.toFixed(2)}) | ${q.boost.toFixed(2)} |`);
    if (!(Math.abs(q.speed - want) < 0.08)) fail('a still pause at the bottom of the pull-back must not slow the flick');
  }
}

// ---- 4. placing the ball: a long press, then drag; it never throws ----------------------
console.log('\n## 4. Placing the ball (iPhone 15 portrait)\n');
useDevice(PHONE);
function holdThenDrag(holdMs, dx, dy, pxs = 600, from = { x: 196, y: 600 }) {
  const t0 = 1000, pts = [{ x: from.x, y: from.y, t: t0 }];
  for (let t = 50; t <= holdMs; t += 50) pts.push({ x: from.x + (t % 100 ? 1 : 0), y: from.y, t: t0 + t });   // a still finger jitters a pixel
  const tail = pts[pts.length - 1];
  pts.push(...stroke(tail.x, tail.y, dx, dy, pxs, tail.t));
  return gesture(pts);
}
console.log('| gesture | result | |');
console.log('|---|---|---|');
{
  input.enable(0, STANCE.zMin);
  // 0.25 m right and 2 m back: in mm of finger travel, then px
  const r = holdThenDrag(500, 0.25 / THROW.placeXPerMm * PHONE.pxmm, 2 / THROW.placeZPerMm * PHONE.pxmm);
  console.log(`| hold 0.5 s, drag right and down | placed at x ${placed && placed.x.toFixed(3)} m, ${placed && placed.z.toFixed(2)} m behind the foul line | ${r === null ? 'no throw' : 'THREW'} |`);
  if (r !== null) fail('placing must never throw');
  if (!(placed && placed.x > 0.2 && placed.z > 2.2)) fail('a drag right and down must move the ball right and back');
  // the stance is kept and goes with the next throw
  const p = (() => { const x = 196, y = 700, t0 = 5000; return gesture([{ x, y, t: t0 }, ...stroke(x, y, 0, -270, 2400, t0)]); })();
  if (!(p && Math.abs(p.z0 - input.z0) < 1e-9 && p.z0 > 2.2)) fail('the throw must carry the stance (z0)');
  console.log(`| then a swipe | throws from x ${p.x0.toFixed(3)}, z0 ${p.z0.toFixed(2)} m | ${p.speed.toFixed(2)} m/s |`);
  holdThenDrag(500, 2000, 2000);
  console.log(`| hold, drag far right and down | clamped at x ${placed.x}, z ${placed.z} | |`);
  if (!(placed.x === STANCE.maxX && placed.z === STANCE.zMax)) fail('the stance must stay on the approach (right edge, 4.4 m back)');
  holdThenDrag(500, -4000, -4000);
  console.log(`| hold, drag far left and up | clamped at x ${placed.x}, z ${placed.z} | |`);
  if (!(placed.x === -STANCE.maxX && placed.z === STANCE.zMin)) fail('the stance must stay on the approach (left edge, at the foul line)');
  // a quick press-and-flick is a throw even if its moves are handled after the hold timer
  // (slow device): the events' own times decide; arm() is what the timer would have done
  input.enable(0, STANCE.zMin);
  thrown = null; placed = null;
  now = 1000;
  listeners.elpointerdown({ button: 0, pointerId: 3, pointerType: 'touch', clientX: 196, clientY: 700, timeStamp: 1000, preventDefault() {} });
  now = 1600; input.arm();
  const late = stroke(196, 700, 0, -270, 2400, 1150);
  listeners.pointermove({ pointerId: 3, pointerType: 'touch', clientX: 196, clientY: 430, timeStamp: late[late.length - 1].t, getCoalescedEvents: () => late.map((q) => ({ clientX: q.x, clientY: q.y, timeStamp: q.t })) });
  listeners.pointerup({ pointerId: 3, pointerType: 'touch', clientX: 196, clientY: 430, timeStamp: late[late.length - 1].t + 4 });
  console.log(`| press, flick 150 ms later, handled 600 ms late | ${thrown && thrown.speed ? 'throws ' + thrown.speed.toFixed(2) + ' m/s' : JSON.stringify(thrown)} | placed: ${placed ? 'YES' : 'no'} |`);
  if (!(thrown && thrown.speed && !placed)) fail('a flick that started within the hold time is a throw, however late it is handled');
  if (!(Math.abs(thrown.speed - launchSpeed(2400 / 6)) < 0.05)) fail('the rest before a flick is not part of its speed');
  const rest = (() => { input.enable(0, STANCE.zMin); const t0 = 1000; return gesture([{ x: 196, y: 700, t: t0 }, { x: 196, y: 700, t: t0 + 300 }, ...stroke(196, 700, 0, -270, 2400, t0 + 300)]); })();
  console.log(`| press, rest 0.3 s, flick | ${rest && rest.speed ? 'throws ' + rest.speed.toFixed(2) + ' m/s' : JSON.stringify(rest)} | |`);
  if (!(rest && rest.speed)) fail('a rest shorter than the hold time, then a flick, is a throw');
  // a still finger sends no moves: a rest, then a flick quicker than the 120 ms window
  for (const f of [700, 1000, 2000]) {
    input.enable(0, STANCE.zMin);
    const t0 = 1000, q = gesture([{ x: 196, y: 700, t: t0 }, ...stroke(196, 700, 0, -45 * PHONE.pxmm, f * PHONE.pxmm, t0 + 250)]);
    console.log(`| press, rest 0.25 s without a move, flick at ${f} mm/s | throws ${q.speed.toFixed(2)} m/s (the same flick without the rest: ${launchSpeed(f * PHONE.pxmm / 6).toFixed(2)}) | |`);
    if (!(Math.abs(q.speed - launchSpeed(f * PHONE.pxmm / 6)) < 0.08)) fail(`a rest before a ${f} mm/s flick must not slow it`);
  }
  const held = (() => { input.enable(0.1, 1.5); return holdThenDrag(500, 0, -270, 2400, { x: 196, y: 700 }); })();
  console.log(`| press, hold 0.5 s, flick | ${held === null ? 'no throw: the ball is moved forward to ' + placed.z.toFixed(2) + ' m' : 'THREW'} | |`);
  if (held !== null) fail('after the hold, the drag places: no throw');
  const m0 = misplaced;
  input.enable(0, STANCE.zMin);
  const side = gesture([{ x: 150, y: 700, t: 1000 }, ...stroke(150, 700, 160, 0, 800, 1000)]);
  console.log(`| a quick sideways slide (the old way to move the ball) | ${side === null ? 'no throw' : 'THREW'}, the hint shown: ${misplaced > m0} | |`);
  if (side !== null || misplaced !== m0 + 1) fail('a sideways slide neither throws nor places, and says how to move the ball');
  input.enable(0, 1.0);
  placed = null;
  listeners.keydown({ key: 'ArrowDown' }); const kz1 = placed && placed.z;
  listeners.keydown({ key: 'ArrowUp' }); listeners.keydown({ key: 'ArrowUp' }); const kz2 = placed && placed.z;
  listeners.keydown({ key: 'ArrowRight' }); const kx = placed && placed.x;
  console.log(`| arrow keys: down, up, up, right | z 1.00 -> ${kz1.toFixed(2)} -> ${kz2.toFixed(2)}, x ${kx.toFixed(3)} | |`);
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

// ---- 6. the line, the hook and the throws the swipe gives, down the lane ---------------
console.log('\n## 6. Line and hook (iPhone 15 portrait)\n');
useDevice(PHONE);
function swipe(x1, y1, x2, y2, ms, bow = 0) {
  input.enable(0);
  const n = 16, t0 = 1000, pts = [{ x: x1, y: y1, t: t0 }];
  for (let i = 1; i <= n; i++) { const t = i / n; pts.push({ x: x1 + (x2 - x1) * t + bow * t * t * t, y: y1 + (y2 - y1) * t, t: t0 + ms * t }); }
  return gesture(pts);
}
const cases = [
  ['straight, quick (300 px in 150 ms)', [195, 780, 195, 480, 150, 0]],
  ['straight, slow (300 px in 600 ms)', [195, 780, 195, 480, 600, 0]],
  ['very fast flick (400 px in 110 ms)', [195, 790, 195, 390, 110, 0]],
  ['angled right', [180, 780, 230, 480, 160, 0]],
  ['hook: curves left at the end', [220, 780, 220, 470, 170, -70]],
  ['back-up ball: curves right', [170, 780, 170, 470, 170, 70]],
  ['too short', [195, 780, 195, 720, 100, 0]]
];
console.log('| Swipe | speed m/s | line deg | side rad/s | ball reaches the pins at (cm) |');
console.log('|---|---|---|---|---|');
for (const [name, args] of cases) {
  const p = swipe(...args);
  if (!p || p === 'weak') { console.log(`| ${name} | - | - | - | not a throw (${p || 'none'}) |`); if (!name.startsWith('too short')) fail(name + ' must throw'); continue; }
  const r = LanePhysics.predict({ x0: 0, speed: p.speed, angle: p.angle, side: p.side, roll: 0.5 }, 9);
  const at = r.gutter ? 'gutter' : r.entry ? (r.entry.x * 100).toFixed(0) : '?';
  console.log(`| ${name} | ${p.speed.toFixed(2)} | ${(p.angle * 180 / Math.PI).toFixed(2)} | ${p.side.toFixed(1)} | ${at} |`);
}
const quick = swipe(195, 780, 195, 480, 150, 0), slow = swipe(195, 780, 195, 480, 600, 0);
if (!(quick && slow && quick.speed > slow.speed)) fail('a quicker swipe must be a faster ball');
const hook = swipe(220, 780, 220, 470, 170, -70), backup = swipe(170, 780, 170, 470, 170, 70);
if (!(hook.side > 2 && backup.side < -2)) fail('a curve to the left must hook left (positive side), to the right negative');
if (swipe(180, 780, 230, 480, 160, 0).angle <= 0) fail('a swipe to the right must aim right');
if (swipe(195, 780, 195, 720, 100, 0) !== 'weak') fail('a short swipe must not be a throw');
// the same curve hooks further on a slower ball, and enters the pins at a steeper angle
{
  const hk = (ms) => {
    const p = swipe(260, 790, 260, 450, ms, -60);
    const r = LanePhysics.predict({ x0: 0.3, speed: p.speed, angle: 0, side: p.side, roll: 0.5 }, 9);
    let x12 = null; for (const q of r.path) if (-q.z >= 12) { x12 = q.x; break; }
    return { sp: p.speed, side: p.side, hook: r.entry ? (x12 - r.entry.x) : null, deg: r.entry ? Math.atan2(r.entry.vx, -r.entry.vz) * 180 / Math.PI : null, gutter: r.gutter };
  };
  console.log('\n| the same curved swipe, slower to faster | launch m/s | side rad/s | moved after the oil cm | entry deg |');
  console.log('|---|---|---|---|---|');
  let last = null;
  for (const ms of [500, 300, 200, 130, 90]) {
    const h = hk(ms);
    console.log(`| 340 px in ${ms} ms | ${h.sp.toFixed(2)} | ${h.side.toFixed(1)} | ${h.gutter ? 'gutter' : (h.hook * 100).toFixed(0)} | ${h.deg != null ? h.deg.toFixed(1) : '-'} |`);
    if (last && !h.gutter && !last.gutter && !(h.hook < last.hook && Math.abs(h.deg) < Math.abs(last.deg))) fail('a faster ball must hook less and enter straighter');
    last = h;
  }
}

// ---- 7. slow frames: a real swipe still throws, as fast as at full frame rate ---------------
// the browser handles the events in bursts, one coalesced pointermove per frame and the
// pointer-up a frame late, each point with its own e.timeStamp (when the finger was there)
console.log('\n## 7. Slow devices\n');
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
if (slowSwipe(195, 780, 195, 480, 260, 6, 600) !== 'weak') fail('a swipe that rests before it lets go must not be a throw');
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

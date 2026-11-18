// The swipe -> throw mapping (js/sim3d/input.js), run in node with synthetic pointer events.
//   node tests/swipe_test.mjs
// A headless browser cannot time a swipe (each synthetic event waits for a software-rendered
// frame), so the gesture maths is checked here, and the throws it gives are rolled down the
// lane with the game's own physics.
import { LanePhysics, LANE } from '../js/sim3d/physics.js';

let now = 0;
globalThis.performance = { now: () => now };
const listeners = {};
globalThis.window = { innerHeight: 844, innerWidth: 390, devicePixelRatio: 1, addEventListener: (t, f) => { listeners[t] = f; }, setTimeout: () => 0 };
const { SwipeInput } = await import('../js/sim3d/input.js');
const el = { addEventListener: (t, f) => { listeners['el' + t] = f; }, setPointerCapture() {} };
const canvas = { getContext: () => ({ setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }), width: 0, height: 0, clientWidth: 390, clientHeight: 844 };
let thrown = null;
const input = new SwipeInput(el, canvas, { onThrow: (p) => { thrown = p; }, onPosition() {}, onWeak() { thrown = 'weak'; } });

// one swipe: from (x1,y1) to (x2,y2) in ms milliseconds, bowing sideways by `bow` px at the end
function swipe(x1, y1, x2, y2, ms, bow = 0) {
  thrown = null;
  input.enable(0);
  const n = 16;
  now = 1000;
  listeners.elpointerdown({ button: 0, pointerId: 1, clientX: x1, clientY: y1, preventDefault() {} });
  for (let i = 1; i <= n; i++) {
    now = 1000 + ms * i / n;
    const t = i / n;
    listeners.pointermove({ pointerId: 1, clientX: x1 + (x2 - x1) * t + bow * t * t * t, clientY: y1 + (y2 - y1) * t });
  }
  listeners.pointerup({ pointerId: 1, clientX: x2 + bow, clientY: y2 });
  return thrown;
}

// The same swipe on a slow device (fps frames a second): the browser handles the events in
// bursts, one coalesced pointermove per frame and the pointer-up a frame late, each point
// with its own e.timeStamp (when the finger was there). restMs: the finger rests that long
// at the end before it lets go.
function slowSwipe(x1, y1, x2, y2, ms, fps, restMs = 0) {
  thrown = null;
  input.enable(0);
  const n = 16, frame = 1000 / fps, t0 = 1000;
  const pts = [];
  for (let i = 1; i <= n; i++) { const t = i / n; pts.push({ pointerId: 1, clientX: x1 + (x2 - x1) * t, clientY: y1 + (y2 - y1) * t, timeStamp: t0 + ms * t }); }
  now = t0 + frame * 0.9;                            // the press, handled late too
  listeners.elpointerdown({ button: 0, pointerId: 1, clientX: x1, clientY: y1, timeStamp: t0, preventDefault() {} });
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
  listeners.pointerup({ pointerId: 1, clientX: x2, clientY: y2, timeStamp: upAt });
  return thrown;
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
let failures = 0;
console.log('| Swipe | speed m/s | line deg | side rad/s | ball reaches the pins at (cm) |');
console.log('|---|---|---|---|---|');
for (const [name, args] of cases) {
  const p = swipe(...args);
  if (!p || p === 'weak') { console.log(`| ${name} | - | - | - | not a throw (${p || 'none'}) |`); if (!name.startsWith('too short') && !name.includes('slow')) failures++; continue; }
  const r = LanePhysics.predict({ x0: 0, speed: p.speed, angle: p.angle, side: p.side, roll: 0.25 });
  const at = r.gutter ? 'gutter' : r.entry ? (r.entry.x * 100).toFixed(0) : '?';
  console.log(`| ${name} | ${p.speed.toFixed(2)} | ${(p.angle * 180 / Math.PI).toFixed(2)} | ${p.side.toFixed(1)} | ${at} |`);
}
// expectations
const quick = swipe(195, 780, 195, 480, 150, 0), slow = swipe(195, 780, 195, 480, 600, 0);
if (!(quick && slow && quick.speed > slow.speed)) { failures++; console.log('FAIL a quicker swipe must be a faster ball'); }
const hook = swipe(220, 780, 220, 470, 170, -70), backup = swipe(170, 780, 170, 470, 170, 70);
if (!(hook.side > 5 && backup.side < -5)) { failures++; console.log('FAIL a curve to the left must hook left (positive side), to the right negative'); }
const right = swipe(180, 780, 230, 480, 160, 0);
if (!(right.angle > 0)) { failures++; console.log('FAIL a swipe to the right must aim right'); }
if (swipe(195, 780, 195, 720, 100, 0) !== 'weak') { failures++; console.log('FAIL a short swipe must not be a throw'); }
// slow frames: a real swipe still throws, as fast as at full frame rate
for (const fps of [6, 10, 20]) {
  for (const ms of [150, 260, 400]) {
    const ref = swipe(195, 780, 195, 480, ms, 0), slowP = slowSwipe(195, 780, 195, 480, ms, fps);
    const ok = slowP && slowP !== 'weak' && Math.abs(slowP.speed - ref.speed) < 0.4;
    console.log(`| ${fps} fps, 300 px in ${ms} ms | ${slowP && slowP.speed ? slowP.speed.toFixed(2) : slowP} (full frame rate ${ref.speed.toFixed(2)}) | ${ok ? 'ok' : 'FAIL'} |`);
    if (!ok) failures++;
  }
}
if (slowSwipe(195, 780, 195, 480, 260, 6, 600) !== 'weak') { failures++; console.log('FAIL a swipe that rests before it lets go must not be a throw'); }
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
  const ref = swipe(195, 780, 195, 480, ms, 0);
  const ok = got && got !== 'weak' && Math.abs(got.speed - ref.speed) < 0.4;
  console.log(`| pointer stream cancelled, the touch goes on as touch events | ${got && got.speed ? got.speed.toFixed(2) : got} (full frame rate ${ref.speed.toFixed(2)}) | ${ok ? 'ok' : 'FAIL'} |`);
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
  if (thrown !== null) { failures++; console.log('FAIL a touchcancel must cancel the swipe'); }
}

console.log(failures ? `${failures} failures` : 'All swipe checks passed');
process.exitCode = failures ? 1 : 0;
void LANE;

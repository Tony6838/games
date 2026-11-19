// The grip-and-release throw played in headless Edge with real pointer input (tests/cdp.mjs):
//   node tests/grip_browser.mjs <w> <h> <touch 0|1> [lang] [outDir] [baseUrl]
// The hint near the ball at the player's turn (where it is, that it keeps clear of the ball, the
// aim line, the status line, the buttons, the TVs and the ball speed), the hand on the ball while
// it is held, a slow drag that moves the ball without a throw, a sideways release, a straight push
// (no spin), a curved swipe (side spin that hooks the ball left: its path, and its drawn rotation),
// "wait for your turn" while a machine player bowls, and - touch - the phone's twist read from
// Chromium's sensor emulation (counterclockwise, clockwise, none). Prints what it checked and every
// exception, console error and failed request; exits 1 on a failed check.
import { openBrowser, sleep } from './cdp.mjs';

const [W = '390', H = '844', touch = '1', LANG = 'sv', outDir = 'screenshots/grip', base = 'http://127.0.0.1:8000/'] = process.argv.slice(2);
const w = +W, h = +H, mobile = touch === '1';
const tag = `${outDir}/${w}x${h}_${mobile ? 'touch' : 'mouse'}_${LANG}`;
// the GPU (as tests/motion_browser.mjs): with software WebGL the main thread is busy for ~100 ms a
// frame and the sensor events come late and thinned out (SWGL=1 for software WebGL)
const b = await openBrowser({ w, h, mobile, gpu: !process.env.SWGL });
const checks = [];
const check = (ok, what) => { checks.push((ok ? 'ok   ' : 'FAIL ') + what); console.log((ok ? 'ok   ' : 'FAIL ') + what); return ok; };
const app = (expr) => b.eval(`const a = window.vikingApp; ${expr}`);
async function waitFor(expr, ms = 30000, step = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await app(expr); if (v && !v.error) return v; await sleep(step); }
  return null;
}
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
if (mobile) {
  await b.send('Emulation.setUserAgentOverride', { userAgent: ANDROID, platform: 'Linux armv8l' });
  for (const type of ['accelerometer', 'linear-acceleration', 'gyroscope', 'relative-orientation']) await b.send('Emulation.setSensorOverrideEnabled', { enabled: true, type, metadata: { available: true } });
}
// the phone's rotation rate about the axis through the screen (rad/s, + counterclockwise as seen); the
// emulation gives it to rotationRate (deg/s)
let gyroZ = 0, ticking = mobile;
const setGyro = (z) => b.send('Emulation.setSensorOverrideReadings', { type: 'gyroscope', reading: { xyz: { x: 0, y: 0, z } } });
if (mobile) {
  // devicemotion fires only when all of these have a reading: the phone upright and still
  await b.send('Emulation.setSensorOverrideReadings', { type: 'accelerometer', reading: { xyz: { x: 0, y: 9.81, z: 0 } } });
  await b.send('Emulation.setSensorOverrideReadings', { type: 'linear-acceleration', reading: { xyz: { x: 0, y: 0, z: 0 } } });
  await b.send('Emulation.setSensorOverrideReadings', { type: 'relative-orientation', reading: { quaternion: { x: 0.7071, y: 0, z: 0, w: 0.7071 } } });
  (async () => { let k = 0; while (ticking) { await setGyro(gyroZ + (k++ % 2 ? 1e-4 : 0)); await sleep(12); } })();
}

// ---- the page's state ---------------------------------------------------------------------
const rects = () => app(`const q = (s) => document.querySelector(s);
  const r = (e, pad = 0) => { if (!e || e.hidden) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return null; const c = e.getBoundingClientRect(); return c.width && c.height ? { left: c.left - pad, top: c.top - pad, right: c.right + pad, bottom: c.bottom + pad, text: e.textContent.trim().slice(0, 90) } : null; };
  const L = a.throwLane, cam = a.scene.camera;
  let ball = null;
  if (L) { const p = L.physics.ball.position, R = 0.1085, P = (y) => { const v = cam.position.clone().set(p.x, y, p.z).project(cam); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; };
    const c = P(p.y), t = P(p.y + R); const rr = Math.abs(c.y - t.y); ball = { x: c.x, y: c.y, r: rr, left: c.x - rr, right: c.x + rr, top: c.y - rr, bottom: c.y + rr }; }
  const hand = q('#gripHand'), m = hand && hand.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/);
  return { hint: r(q('#modeHint')), hintKind: q('#modeHint') && q('#modeHint').classList.contains('wait') ? 'wait' : 'ready', status: r(q('#status')), hud: r(q('#play .hudBtns')), tv: r(q('#tvBox')), strip: r(q('#tvStrip')),
    speedo: r(q('#speedo')), toast: r(q('#toast')), ball, hand: hand && hand.classList.contains('show') && m ? { x: +m[1] + 70, y: +m[2] + 60, s: +m[3] } : null,
    enabled: a.input.enabled, x0: a.humanX0 || 0, z0: a.humanZ0 || 0.35, statusText: q('#status').textContent, screen: a.screen };`);
const ov = (p, q) => p && q && p.left < q.right && p.right > q.left && p.top < q.bottom && p.bottom > q.top;
// the hint keeps clear of everything it must not cover
function clearOf(s, what) {
  const H = s.hint;
  if (!check(!!H, `${what}: the hint shows ("${H ? H.text : ''}")`)) return;
  const bad = [];
  for (const k of ['status', 'hud', 'tv', 'strip', 'speedo']) if (ov(H, s[k])) bad.push(k);
  if (s.ball) {
    if (ov(H, s.ball)) bad.push('ball');
    const ar = Math.max(s.ball.r, 16);
    if (ov(H, { left: s.ball.x - ar, right: s.ball.x + ar, top: 0, bottom: s.ball.top })) bad.push('aim line');
  }
  if (H.left < 0 || H.top < 0 || H.right > w || H.bottom > h) bad.push('window edge');
  check(bad.length === 0, `${what}: the hint keeps clear of the status line, buttons, TVs, ball speed, ball and aim line${bad.length ? ' - overlaps ' + bad.join(', ') : ''} (hint ${Math.round(H.left)},${Math.round(H.top)} ${Math.round(H.right - H.left)}x${Math.round(H.bottom - H.top)})`);
}
async function ballXY() { const s = await rects(); return s.ball; }
const shot = (name) => b.shot(`${tag}_${name}.png`);

// ---- input -----------------------------------------------------------------------------------
const evs = { down: mobile ? 'touchStart' : 'mousePressed', move: mobile ? 'touchMove' : 'mouseMoved', up: mobile ? 'touchEnd' : 'mouseReleased' };
async function ptr(type, x, y, ts) {
  const extra = ts ? { timestamp: ts } : {};
  if (mobile) return b.send('Input.dispatchTouchEvent', { type: evs[type], touchPoints: type === 'up' ? [] : [{ x, y }], ...extra });
  return b.send('Input.dispatchMouseEvent', { type: evs[type], x, y, button: 'left', buttons: type === 'up' ? 0 : 1, clickCount: 1, ...extra });
}
// a gesture along pts [{x, y}] over ms, every event with its own time (the game times the swipe by
// the events' clock, so a slow software renderer gets the swipe's real speed)
async function gestureAt(pts, ms, { timed = true } = {}) {
  const t0 = Date.now() / 1000, n = pts.length - 1;
  if (!mobile) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x, y: pts[0].y });
  await ptr('down', pts[0].x, pts[0].y, timed ? t0 : 0);
  for (let i = 1; i <= n; i++) {
    if (!timed) await sleep(ms / n);
    await ptr('move', pts[i].x, pts[i].y, timed ? t0 + (i * ms / n) / 1000 : 0);
  }
  await ptr('up', pts[n].x, pts[n].y, timed ? t0 + ms / 1000 + 0.004 : 0);
}
// a swipe from the ball up the screen: `len` of the window's height, `dx` px to the side, a sideways
// bow at the end (bow * t^3 px), in ms
async function swipeFromBall(len, ms, { dx = 0, bow = 0, n = 16, timed = true } = {}) {
  const B = await ballXY();
  const x1 = Math.max(30, Math.min(w - 30, B.x)), y1 = Math.min(h - 12, B.y + 6), y2 = Math.max(20, y1 - h * len);
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push({ x: x1 + dx * t + bow * t * t * t, y: y1 + (y2 - y1) * t }); }
  await gestureAt(pts, ms, { timed });
}
async function lastRelease() { return app(`return (window.__rel || []).slice(-1)[0] || null`); }
async function untilTurn() { return waitFor('return a.throwResolve && a.input.enabled && document.querySelector("#play").classList.contains("active")', 60000); }
async function afterBall() {
  await waitFor('return !a.throwResolve', 5000, 60);
  await waitFor('return a.activeLane && ["done","idle"].includes(a.activeLane.physics.state)', 20000);
}

// ---- the game --------------------------------------------------------------------------------
await b.go(base + '?nofs=1&detail=low', 3500);
await b.eval(`localStorage.clear(); localStorage.setItem('vbg.settings', JSON.stringify({ lang: ${JSON.stringify(LANG)}, throwMode: 'swipe', robots: 1, aim: true })); localStorage.setItem('vbg.throwHint', 'true'); return 1`);
await b.go(base + '?nofs=1&detail=low', 4000);
await shot('00_splash_help');
check(await b.click('#okBtn'), 'splash OK');
await sleep(700);
await app(`const s = document.querySelector('#optRobots'); s.value = '1'; s.dispatchEvent(new Event('change')); const t = document.querySelector('#optThrow'); t.value = 'swipe'; t.dispatchEvent(new Event('change')); return 1`);
check(await b.click('#menuNext'), 'menu next');
await sleep(700);
check(await b.click('#startBtn'), 'start');
check(!!(await untilTurn()), 'the player\'s turn comes');
await b.eval(`window.__rel = []; vikingEvents.on('throwRelease', (e) => __rel.push(e)); return 1`);
await sleep(1200);
let s = await rects();
await shot('01_ready_hint');
clearOf(s, 'ready');
check(/Ta tag|Grip|Tag fat|Ta tak|Tartu/.test(s.hint ? s.hint.text : ''), `the hint says how to throw: "${s.hint ? s.hint.text : ''}"`);

// the grip: the hand at once, on the ball; the hint gone
{
  const B = s.ball;
  if (!mobile) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: B.x, y: B.y + 4 });
  await ptr('down', B.x, B.y + 4);
  await sleep(350);
  const g = await rects();
  await shot('02_grip_hand');
  check(!!g.hand && Math.hypot(g.hand.x - B.x, g.hand.y - B.y) < Math.max(6, B.r * 0.5), `the hand grips the ball at the press (hand at ${g.hand ? Math.round(g.hand.x) + ',' + Math.round(g.hand.y) : '-'}, ball at ${Math.round(B.x)},${Math.round(B.y)})`);
  check(!g.hint, 'no hint over the held ball');
  // a slow drag right and back: the ball and the hand follow, and letting go throws nothing
  const steps = 14;
  for (let i = 1; i <= steps; i++) { await ptr('move', B.x + i * 4, B.y + 4 + i * 2); await sleep(70); }
  await sleep(300);
  const d = await rects();
  await shot('03_grip_drag');
  check(d.x0 > 0.05 && d.z0 > 0.6, `a slow drag moves the ball (x ${d.x0.toFixed(3)} m, ${d.z0.toFixed(2)} m back)`);
  check(!!d.hand, 'the hand stays on the ball while it is dragged');
  await ptr('up', B.x + steps * 4, B.y + 4 + steps * 2);
  await sleep(1500);
  const e = await rects();
  await shot('04_placed');
  check(e.enabled && !(await lastRelease()) && !e.hand, `a slow drag and lift does not throw; the ball stays (x ${e.x0.toFixed(3)}, ${e.z0.toFixed(2)} m)`);
  clearOf(e, 'after moving the ball');
}

// a sideways release: no throw
{
  const B = await ballXY();
  const pts = []; for (let i = 0; i <= 10; i++) pts.push({ x: B.x - 60 + i * 14, y: B.y + 4 - i * 1.5 });
  await gestureAt(pts, 120);
  await sleep(600);
  check(!(await lastRelease()) && (await rects()).enabled, 'a quick sideways release does not throw');
}

// a straight push: no spin, a straight line
await swipeFromBall(0.42, 160);
await sleep(400);
let rel = await lastRelease();
check(!!rel && rel.input === 'swipe' && rel.side === 0 && Math.abs(rel.angle) < 0.004, `a straight push throws with no spin and a straight line (${rel ? `speed ${rel.speed.toFixed(2)} m/s, angle ${(rel.angle * 180 / Math.PI).toFixed(2)} deg, side ${rel.side.toFixed(2)}` : 'no throw'})`);
check(!(await rects()).hand, 'the hand lets go at the release');
await sleep(500);
await shot('05_straight_rolling');
s = await rects();
check(!s.hint, 'no hint while the ball rolls');
// a press on the lane while the ball rolls: "wait"
{ await ptr('down', w / 2, h * 0.6); await sleep(80); await ptr('up', w / 2, h * 0.6); await sleep(250); }
s = await rects();
await shot('06_wait');
check(!!s.hint && s.hintKind === 'wait', `a press while the ball rolls says wait: "${s.hint ? s.hint.text : ''}"`);
await afterBall();

// on to a curved swipe: the player's next ball (a machine player's turn on the way: "wait" again)
for (let k = 0; k < 3; k++) {
  if (!(await untilTurn())) break;
  const st = await app(`return { first: a.engine.nextBallIsFirst(a.throwLane.number) }`);
  if (st.first) break;
  await sleep(400);
  await app(`a.testThrow({ speed: 7, angle: 0, side: 0 }); return 1`);      // the second ball, quickly
  await afterBall();
  const bot = await waitFor(`return !a.throwResolve && !document.querySelector('#status').classList.contains('mine') ? 1 : 0`, 8000, 100);
  if (bot) {
    await ptr('down', w / 2, h * 0.6); await sleep(80); await ptr('up', w / 2, h * 0.6); await sleep(250);
    const sb = await rects();
    await shot('07_machine_turn_wait');
    check(!!sb.hint && sb.hintKind === 'wait', `a press during the machine player's turn says wait (${sb.statusText})`);
  }
}
check(!!(await untilTurn()), 'the player\'s turn again');
await sleep(800);
await b.eval(`window.__rel = []; return 1`);
// aimed right, curving left at the end (a right-hander's hook)
{ const len = Math.min((await ballXY()).y - 26, h * 0.4); await swipeFromBall(len / h, 180, { dx: len * 0.5, bow: -len * 0.45 }); }
await sleep(300);
rel = await lastRelease();
check(!!rel && rel.side > 1, `a swipe curving left spins the ball to hook left (${rel ? `side ${rel.side.toFixed(2)} rad/s, angle ${(rel.angle * 180 / Math.PI).toFixed(2)} deg, speed ${rel.speed.toFixed(2)}` : 'no throw'})`);
// the drawn rotation: the ball turns about an axis tilted from the plain forward roll
await waitFor('return a.activeLane && a.activeLane.physics.state === "rolling"', 8000, 40);
const spin = await app(`const w = a.activeLane.physics.ball.angularVelocity, v = a.activeLane.physics.ball.velocity; const sp = Math.hypot(v.x, v.z);
  return { wx: w.x, wy: w.y, wz: w.z, along: (w.x * v.x + w.z * v.z) / (sp || 1) * -1 };`);
check(spin && spin.along > 0.5, `the rolling ball turns about its direction of travel (side rotation ${spin ? spin.along.toFixed(2) : '-'} rad/s; the drawn ball copies the body's rotation)`);
const frames = [];
for (const [name, ms] of [['08_hook_release', 0], ['09_hook_oil', 700], ['10_hook_backend', 800]]) { await sleep(ms); await shot(name); }
await waitFor('return a.activeLane && ["deck","done"].includes(a.activeLane.physics.state)', 15000, 60);
await shot('11_hook_pins');
const path = await app(`return a.activeLane.physics.path.map((q) => [+q.x.toFixed(4), +q.z.toFixed(3)])`);
if (path && path.length > 20) {
  const at = (d) => path.find((q) => -q[1] >= d) || path[path.length - 1];
  const p3 = at(3), p11 = at(11), pe = path[path.length - 1];
  const early = (p11[0] - p3[0]) / (-p11[1] + p3[1]), late = (pe[0] - p11[0]) / (-pe[1] + p11[1]);
  check(late < early - 0.004, `its path hooks left in the back end (sideways ${(early * 1000).toFixed(1)} mm/m in the oil, ${(late * 1000).toFixed(1)} mm/m after it; at the pins x ${(pe[0] * 100).toFixed(0)} cm)`);
} else check(false, 'the hook ball\'s path was recorded');
await afterBall();

// the phone's twist (touch: the sensor emulation): counterclockwise, clockwise, none, each on a straight push
if (mobile) {
  const twisted = async (z) => {
    if (!(await untilTurn())) return null;
    await sleep(500);
    await b.eval(`window.__rel = []; return 1`);
    const B = await ballXY();
    // (sent in real time, the events' clock shared with the sensor's: a push long enough to be well
    // over the 50 mm/s a throw needs even when the page handles a move only every 50 ms)
    const x1 = B.x, y1 = Math.min(h - 12, B.y + 6), y2 = Math.max(20, y1 - Math.max(h * 0.4, 300)), n = 12;
    await ptr('down', x1, y1);
    for (let i = 1; i <= n; i++) {
      if (i === n - 7) gyroZ = z;                     // the twist over the last part of the push
      await sleep(25);
      await ptr('move', x1, y1 + (y2 - y1) * i / n);
    }
    await ptr('up', x1, y2);
    gyroZ = 0;
    await sleep(300);
    const r = await lastRelease();
    const p = await app(`return a.input.twist.samples.length`);
    if (!r) console.log('     no release:', JSON.stringify(await app(`const S = a.input.samples; return { enabled: a.input.enabled, n: S.length, first: S[0], last: S.slice(-3).map((q) => [Math.round(q.x), Math.round(q.y), Math.round(q.t)]), toast: document.querySelector('#toast').textContent, status: document.querySelector('#status').textContent }`)));
    await afterBall();
    return r ? { side: r.side, samples: p } : null;
  };
  const ccw = await twisted(3.5), cw = await twisted(-3.5), still = await twisted(0);
  check(!!ccw && ccw.side > 1, `twisting the phone counterclockwise at the release hooks left (side ${ccw ? ccw.side.toFixed(2) : '-'} rad/s)`);
  check(!!cw && cw.side < -1, `clockwise hooks right (side ${cw ? cw.side.toFixed(2) : '-'} rad/s)`);
  check(!!still && Math.abs(still.side) < 0.01, `a still phone adds no spin (side ${still ? still.side.toFixed(2) : '-'})`);
}

ticking = false;
await sleep(50);
const log = [...new Set(b.log)].filter((l) => !/HTTP 404 .*customSettings\.css/.test(l));
console.log(log.length ? 'LOG\n  ' + log.join('\n  ') : 'no errors');
check(!log.some((l) => /EXCEPTION|ERROR/.test(l)), 'no exceptions or console errors');
const failed = checks.filter((c) => c.startsWith('FAIL')).length;
console.log(`\n${checks.length} checks, ${failed} failed`);
await b.close();
process.exit(failed ? 1 : 0);

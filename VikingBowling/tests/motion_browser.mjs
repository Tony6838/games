// Motion control in a real browser: headless Edge with phone emulation and Chromium's sensor
// overrides (Emulation.setSensorOverrideEnabled / setSensorOverrideReadings for the
// gyroscope, accelerometer, linear acceleration and relative orientation), which make the
// page's devicemotion and deviceorientation events fire. A scripted swing (tests/
// motion_traces.mjs) is fed in real time while the swing button is pressed and released with
// real touch events, and the game's own state says what was thrown.
//   node tests/serve.mjs 8773          (in another console)
//   node tests/motion_browser.mjs [http://localhost:8773/] [outDir]
// Scenarios: an Android phone (motion is the default: first-use card, swings, a no-swing
// release, placing the ball, a swipe that does not throw, then the swipe chosen in the
// settings); an iPhone with requestPermission mocked (granted, and denied: back to the swipe);
// a desktop (the swipe, no button).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchEdge, sleep } from './cdp_driver.mjs';
import { makeSwing, readingAt } from './motion_traces.mjs';
import { motionParams, aimAt } from '../js/sim3d/input.js';
import { demoPose, DEMO } from '../js/sim3d/motiondemo.js';

const BASE = process.argv[2] || 'http://localhost:8773/';
const OUT = process.argv[3] || join(process.cwd(), 'motion_browser_out');
mkdirSync(OUT, { recursive: true });
const URL = BASE + '?nofs=1&detail=low';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let failures = 0;
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };
const check = (ok, msg) => { if (!ok) { failures++; say('FAIL ' + msg); } };
const D2R = Math.PI / 180;
// ONLY=AD runs only scenarios A and D
const want = (k) => !process.env.ONLY || process.env.ONLY.includes(k);

function quat(R) {
  const tr = R[0][0] + R[1][1] + R[2][2];
  let w, x, y, z;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; w = 0.25 * S; x = (R[2][1] - R[1][2]) / S; y = (R[0][2] - R[2][0]) / S; z = (R[1][0] - R[0][1]) / S; }
  else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) { const S = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2; w = (R[2][1] - R[1][2]) / S; x = 0.25 * S; y = (R[0][1] + R[1][0]) / S; z = (R[0][2] + R[2][0]) / S; }
  else if (R[1][1] > R[2][2]) { const S = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2; w = (R[0][2] - R[2][0]) / S; x = (R[0][1] + R[1][0]) / S; y = 0.25 * S; z = (R[1][2] + R[2][1]) / S; }
  else { const S = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2; w = (R[1][0] - R[0][1]) / S; x = (R[0][2] + R[2][0]) / S; y = (R[1][2] + R[2][1]) / S; z = 0.25 * S; }
  return { x, y, z, w };
}

async function sensorsOn(B) {
  for (const type of ['accelerometer', 'linear-acceleration', 'gyroscope', 'relative-orientation']) {
    const r = await B.send('Emulation.setSensorOverrideEnabled', { enabled: true, type, metadata: { available: true } });
    check(!r.error, `sensor override ${type}: ${JSON.stringify(r.error)}`);
  }
}
// the readings of a swing at trace time t (ms)
function setReadings(B, sw, t) {
  const r = readingAt(sw, t);
  return Promise.all([
    B.send('Emulation.setSensorOverrideReadings', { type: 'gyroscope', reading: { xyz: { x: r.w[0] * D2R, y: r.w[1] * D2R, z: r.w[2] * D2R } } }),
    B.send('Emulation.setSensorOverrideReadings', { type: 'accelerometer', reading: { xyz: { x: r.f[0], y: r.f[1], z: r.f[2] } } }),
    B.send('Emulation.setSensorOverrideReadings', { type: 'linear-acceleration', reading: { xyz: { x: r.lin[0], y: r.lin[1], z: r.lin[2] } } }),
    B.send('Emulation.setSensorOverrideReadings', { type: 'relative-orientation', reading: { quaternion: quat(sw.Rdev(t)) } })
  ]);
}

async function phone(B, ua, w = 390, h = 844) {
  await B.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w >= 600 ? 1 : 2,   // (a 2x tablet surface is captured garbled in headless Edge)
    mobile: true, screenOrientation: { type: h > w ? 'portraitPrimary' : 'landscapePrimary', angle: h > w ? 0 : 90 } });
  await B.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await B.send('Emulation.setUserAgentOverride', { userAgent: ua, platform: /iPhone/.test(ua) ? 'iPhone' : 'Linux armv8l' });
}

const tap = async (B, x, y) => { await B.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await B.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300); };
const center = (B, sel) => B.evaluate(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, h: r.height } : null;`);
async function tapSel(B, sel) { const c = await center(B, sel); if (!c) { check(false, 'not visible: ' + sel); return false; } await tap(B, c.x, c.y); return true; }
async function clickSel(B, sel) { return B.evaluate(`document.querySelector(${JSON.stringify(sel)}).click(); return true;`, true); }
const shot = async (B, name) => { const s = await B.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64')); };
async function touchSwipe(B, x1, y1, x2, y2, ms, holdMs = 0) {
  await B.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  if (holdMs) await sleep(holdMs);
  const n = 12;
  for (let i = 1; i <= n; i++) { await sleep(ms / n); await B.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / n, y: y1 + (y2 - y1) * i / n }] }); }
  await B.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function waitFor(B, expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await B.evaluate(`return !!(${expr})`)) return true; await sleep(150); }
  return false;
}

// Into a game with no machine players (every ball is the player's), to the player's turn
async function startGame(B) {
  await clickSel(B, '#okBtn'); await sleep(500);
  await B.evaluate(`const s = document.querySelector('#optRobots'); s.value = '0'; s.dispatchEvent(new Event('change')); return 1;`);
  await clickSel(B, '#menuNext'); await sleep(600);
  await clickSel(B, '#startBtn');
  check(await waitFor(B, 'window.vikingApp && vikingApp.throwResolve', 20000), 'the player\'s turn must come');
  await B.evaluate(`if (!window.__rec) { window.__rec = true; window.__rel = []; vikingEvents.on('throwRelease', (e) => __rel.push(e)); } return 1;`);
}

// One swing played in real time: the readings from the start of the trace, the press at t = 0
// (touch on the swing button), the release at the swing's release time
async function playSwing(B, sw, { press = true, probes = [] } = {}) {
  const btn = await center(B, '#swingBtn');
  if (press && !btn) { check(false, 'the swing button must show'); return; }
  const tEnd = sw.tRelease + 350;
  let T0 = performance.now();
  let pressed = false, released = false, steps = 0;
  const todo = probes.slice();
  for (;;) {
    const t = sw.tStart + (performance.now() - T0);
    if (t > tEnd) break;
    await setReadings(B, sw, t);
    steps++;
    while (todo.length && t >= todo[0].t) {
      // the probes come while the phone is held still (the aim) or are quick: the trace's clock waits for them
      const p0 = performance.now(), pr = todo.shift();
      pr.value = await B.evaluate(`const A = vikingApp.input.aimLive; return A ? { board: A.board, locked: A.locked, yaw: +A.yaw.toFixed(2), label: document.querySelector('#swingBtn b').textContent } : null;`);
      if (pr.shot) await shot(B, pr.shot);
      T0 += performance.now() - p0;
    }
    if (press && !pressed && t >= 0) { pressed = true; await B.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: btn.x, y: btn.y }] }); }
    if (pressed && !released && t >= sw.tRelease) { released = true; await B.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    await sleep(3);
  }
  return steps / ((tEnd - sw.tStart) / 1000);
}

const state = (B) => B.evaluate(`const m = vikingApp.input.motion, L = m && m.last, T = m && m.tracker;
  const S = T ? T.samples : [], n = S.length;
  return { rel: (window.__rel || []).slice(), last: L && { ok: L.ok, reason: L.reason, rate: L.rate, heading: L.heading, twist: L.twist, fwdDeg: L.fwdDeg, backDeg: L.backDeg, lobes: L.lobes },
    toast: document.querySelector('#toast').textContent, toastShown: document.querySelector('#toast').classList.contains('show'),
    waiting: !!vikingApp.throwResolve, mstate: m && m.state, frame: T && ['xyz','xyz-','zxy','zxy-'][T.frame], accSign: T && T.accSign,
    hz: n > 30 ? +(30 / ((S[n - 1].t - S[n - 31].t) / 1000)).toFixed(1) : null, useMotion: vikingApp.input.usingMotion(),
    btn: document.querySelector('#swingBtn') ? document.querySelector('#swingBtn').classList.contains('show') : false,
    card: document.querySelector('#motionCard') ? document.querySelector('#motionCard').classList.contains('show') : false,
    demo: document.querySelector('#motionDemo') ? document.querySelector('#motionDemo').classList.contains('show') : false,
    status: document.querySelector('#status').textContent, humanX0: vikingApp.humanX0 };`);

// After a throw: wait for the ball and read what the lane says
async function ballResult(B) {
  await waitFor(B, `vikingApp.activeLane && vikingApp.activeLane.physics.state === 'done'`, 15000);
  await sleep(200);
  return B.evaluate(`const L = vikingApp.activeLane, ph = L.physics; return { speedo: document.querySelector('#speedo').textContent, laneKmh: ph.laneSpeed() ? +(ph.laneSpeed() * 3.6).toFixed(1) : null, atPinsCm: ph.entry ? +((ph.entry.x - L.laneX) * 100).toFixed(1) : null, gutter: ph.inGutter };`);
}

const f = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : String(v));

// ======================================================================================
// A. An Android phone: motion is the default
// ======================================================================================
if (want('A')) {
  say('\n## A. Android phone (Edge, 390x844 touch, Android user agent, sensors emulated)\n');
  const B = await launchEdge();
  await phone(B, ANDROID);
  await sensorsOn(B);
  const rest = makeSwing({ handleMs: 0 });
  await setReadings(B, rest, -1000);
  await B.send('Page.navigate', { url: URL });
  await sleep(3500);
  const pre = await B.evaluate(`return { auto: document.querySelector('#optThrow option[value=auto]').textContent, value: document.querySelector('#optThrow').value, how: !document.querySelector('#howToMotion').hidden, howText: document.querySelector('#howToMotion').textContent.slice(0, 60), secure: isSecureContext }`);
  say(`Settings: Kast = "${pre.auto}" (value ${pre.value}); the splash's swing line shown: ${pre.how} ("${pre.howText}..."); secure context ${pre.secure}`);
  check(/Svinga telefonen/.test(pre.auto) && pre.value === 'auto' && pre.how, 'on a phone "Auto" must mean the swing, and the splash must say so');
  await shot(B, 'A0_splash_phone');
  await startGame(B);
  let s = await state(B);
  say(`First turn: the swing demo shown ${s.demo}, button shown ${s.btn}, status "${s.status}"`);
  check(s.demo && !s.btn, 'the first use must show the swing demo (with the safety note) before the button');
  await shot(B, 'A1_first_use_demo');
  await tapSel(B, '#mdPlay');
  await sleep(1200);
  s = await state(B);
  say(`After the demo's "Spela": motion ${s.mstate}, button ${s.btn}, events ${s.hz} Hz, rotationRate mapping ${s.frame}`);
  check(s.mstate === 'ready' && s.btn, 'after allowing, the sensors must be ready and the button shown');
  await shot(B, 'A2_swing_button');

  say('\n| throw | swing (trace) | result | swing rate seen (deg/s) | heading / twist (deg) | launch m/s (expected) | angle rad (expected) | side rad/s (expected) | lane shows | at the head pin (cm) | sensor events |');
  say('|---|---|---|---|---|---|---|---|---|---|---|');
  const throws = [
    ['1 medium, straight (first: hold still)', { peakDps: 300, handleMs: 2500 }, 'throw'],
    ['2 aim 8 left (board 28), then a fast straight swing', { peakDps: 550, aimDeg: 8, handleMs: 600, stillMs: 300, seed: 2 }, 'throw'],
    ['2b aim 6 right (board 14), pulled 20 left in the swing', { peakDps: 400, aimDeg: -6, psiDeg: 20, handleMs: 600, stillMs: 300, seed: 9 }, 'throw'],
    ['3 no swing: press, hold, release', { release: 'none', handleMs: 600, stillMs: 300, seed: 3 }, 'noSwing'],
    ['4 slow, wrist 50 (right-hander)', { peakDps: 160, backDeg: 45, fwdDeg: 50, twistDeg: 50, releaseU: 0.6, handleMs: 600, stillMs: 300, seed: 4 }, 'throw'],
    ['5 let go at the top of the backswing', { release: 'top', peakDps: 300, handleMs: 600, stillMs: 300, seed: 5 }, 'noForward'],
    ['6 medium, turned 15 right, phone on its side in the hand', { peakDps: 350, psiDeg: -15, grip: 'landscape', handleMs: 600, stillMs: 300, seed: 6 }, 'throw'],
    ['7 medium, straight, let go late (end of the swing)', { peakDps: 300, releaseU: 0.97, handleMs: 600, stillMs: 300, seed: 7 }, 'throw'],
    ['8 medium, straight, let go early (arm still behind)', { peakDps: 300, releaseU: 0.33, handleMs: 600, stillMs: 300, seed: 8 }, 'throw']
  ];
  for (const [name, o, expect] of throws) {
    await waitFor(B, 'vikingApp.throwResolve && document.querySelector("#swingBtn.show")', 15000);
    const before = (await state(B)).rel.length;
    const sw = makeSwing(o);
    const probes = o.aimDeg ? [{ t: sw.backStart - 120, shot: name.startsWith('2 ') ? 'A2b_aim_marker' : null }, { t: sw.fwdStart + 40 }] : [];
    const hz = await playSwing(B, sw, { probes });
    await sleep(400);
    s = await state(B);
    const thrown = s.rel.length > before;
    const p = thrown ? s.rel[s.rel.length - 1] : null;
    // expected: the trace's own swing (rate at the release, heading, wrist turn, the arm's angle at the release)
    const rateTrue = o.releaseU && o.releaseU < 0.5 ? o.peakDps * Math.sin(Math.PI * o.releaseU) : o.peakDps;
    const ex = expect === 'throw' ? motionParams({ rate: rateTrue, aimYaw: o.aimDeg || 0, heading: o.psiDeg || 0, twist: -(o.twistDeg || 0), releaseDeg: sw.theta(sw.tRelease) }) : null;
    if (o.aimDeg) {
      const [hold, lock] = probes.map((x) => x.value);
      const want = aimAt(o.aimDeg, 0).board;
      say(`  aim: while held the marker stood on board ${hold && hold.board} (button "${hold && hold.label}", locked ${hold && hold.locked}); in the swing board ${lock && lock.board}, locked ${lock && lock.locked} (button "${lock && lock.label}"); expected board ${want}`);
      check(hold && Math.abs(hold.board - want) <= 1 && !hold.locked && lock && lock.locked && lock.board === want, `${name}: the marker must show the aim while held and lock on board ${want} at the backswing`);
    }
    let ball = null;
    if (thrown) ball = await ballResult(B);
    say(`| ${name} | ${o.release || 'forward'} ${o.peakDps || ''} | ${thrown ? 'thrown' : 'no throw: ' + (s.last && s.last.reason) + ', hint "' + s.toast.slice(0, 50) + '…"' + (expect === 'throw' ? ' lobes ' + JSON.stringify(s.last && s.last.lobes) : '')} | ${f(s.last && s.last.rate, 0)} | ${f(s.last && s.last.heading, 1)} / ${f(s.last && s.last.twist, 1)} | ${p ? f(p.speed) : '-'} (${ex ? f(ex.speed) : '-'}) | ${p ? f(p.angle, 4) : '-'} (${ex ? f(ex.angle, 4) : '-'}) | ${p ? f(p.side) : '-'} (${ex ? f(ex.side) : '-'}) | ${ball ? ball.speedo : '-'} | ${ball ? ball.atPinsCm : '-'} | ${s.hz} Hz |`);
    if (expect === 'throw') {
      check(thrown && p.input === 'motion', `${name}: must throw by motion`);
      if (thrown) {
        check(Math.abs(p.speed / ex.speed - 1) < 0.04, `${name}: speed ${f(p.speed)} vs expected ${f(ex.speed)}`);
        check(Math.abs(p.angle - ex.angle) < 0.004, `${name}: angle ${f(p.angle, 4)} vs expected ${f(ex.angle, 4)}`);
        if (o.aimDeg) check(p.input === 'motion' && Math.abs(p.angle - ex.angle) < 0.002, `${name}: the ball must follow the locked aim (${f(p.angle, 4)} vs ${f(ex.angle, 4)})`);
        check(Math.abs(p.side - ex.side) < 1.5, `${name}: side ${f(p.side)} vs expected ${f(ex.side)}`);
      }
    } else {
      check(!thrown && s.last && s.last.reason === expect && s.toastShown && /Inget kast/.test(s.toast), `${name}: must not throw, with the hint (got ${thrown ? 'a throw' : s.last && s.last.reason})`);
      check(s.waiting, `${name}: it must still be the player's turn`);
      await shot(B, 'A3_no_swing_hint');
    }
  }

  // placing the ball still works above the button; a swipe there does not throw
  await waitFor(B, 'vikingApp.throwResolve && document.querySelector("#swingBtn.show")', 15000);
  const btn = await center(B, '#swingBtn');
  const x0before = (await state(B)).humanX0 || 0;
  await touchSwipe(B, 195, 260, 255, 260, 300, 600);
  await sleep(300);
  const x0after = (await state(B)).humanX0;
  say(`\nPlacing (hold 0.6 s above the button at y 260, the button's top at ${Math.round(btn.top)}, drag 60 px right): humanX0 ${f(x0before, 3)} -> ${f(x0after, 3)} m`);
  check(x0after > x0before + 0.05, 'a long press and drag above the button must still place the ball');
  const nrel = (await state(B)).rel.length;
  await touchSwipe(B, 195, 380, 195, 120, 160);
  await sleep(500);
  s = await state(B);
  say(`A swipe up above the button: thrown ${s.rel.length > nrel}, hint "${s.toast}"`);
  check(s.rel.length === nrel && /stora knappen/.test(s.toast), 'with motion control a swipe must not throw, and must say how');
  await shot(B, 'A4_swipe_hint');

  // the swipe chosen in the settings: the button goes, a swipe throws
  await clickSel(B, '#btnMenu'); await sleep(500);
  await B.evaluate(`const s = document.querySelector('#optThrow'); s.value = 'swipe'; s.dispatchEvent(new Event('change')); return 1;`);
  await clickSel(B, '#menuNext'); await sleep(600); await clickSel(B, '#startBtn');
  await waitFor(B, 'vikingApp.throwResolve', 20000);
  await sleep(600);
  s = await state(B);
  check(!s.btn && !s.useMotion, 'with the swipe chosen there must be no swing button');
  const n2 = s.rel.length;
  await touchSwipe(B, 195, 700, 190, 420, 220);
  await sleep(500);
  s = await state(B);
  const sp = s.rel.length > n2 ? s.rel[s.rel.length - 1] : null;
  say(`The swipe chosen on the phone: button shown ${s.btn}; a touch swipe throws: ${!!sp} (input ${sp && sp.input}, ${sp && f(sp.speed)} m/s)`);
  check(sp && sp.input === 'swipe', 'with the swipe chosen a touch swipe must throw');
  if (sp) { const b = await ballResult(B); say(`  lane shows ${b.speedo}`); }
  await shot(B, 'A5_swipe_mode');
  const errs = B.log.filter((l) => /EXCEPTION|CONSOLE.ERROR/.test(l));
  say(`\nJS exceptions / console errors in A: ${errs.length ? errs.join(' | ') : 'none'}`);
  check(!errs.length, 'no JS exceptions in A');
  B.close();
}

// ======================================================================================
// B. iPhone: requestPermission mocked, granted and denied
// ======================================================================================
for (const answer of want('B') ? ['granted', 'denied'] : []) {
  say(`\n## B. iPhone, DeviceMotionEvent.requestPermission mocked: ${answer}\n`);
  const B = await launchEdge();
  await phone(B, IPHONE, 393, 852);
  await sensorsOn(B);
  await setReadings(B, makeSwing({ handleMs: 0 }), -1000);
  await B.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__perm = [];
    const mk = (name) => function () { window.__perm.push({ name, activation: !!(navigator.userActivation && navigator.userActivation.isActive) }); return Promise.resolve(${JSON.stringify(answer)}); };
    DeviceMotionEvent.requestPermission = mk('motion');
    if (window.DeviceOrientationEvent) DeviceOrientationEvent.requestPermission = mk('orientation');` });
  await B.send('Page.navigate', { url: URL });
  await sleep(3500);
  await startGame(B);
  let s = await state(B);
  check(s.demo, 'iOS, first use: the swing demo must show (its button is the tap that asks)');
  await shot(B, `B_${answer}_1_demo`);
  await tapSel(B, '#mdPlay');
  await sleep(1300);
  const perm = await B.evaluate('return window.__perm');
  s = await state(B);
  say(`requestPermission calls: ${JSON.stringify(perm)}; motion ${s.mstate}, button ${s.btn}, toast "${s.toastShown ? s.toast : ''}"`);
  check(perm.length === 2 && perm.every((p) => p.activation), 'both permissions must be asked inside the tap (user activation)');
  if (answer === 'granted') {
    check(s.mstate === 'ready' && s.btn, 'granted: the button must show');
    const sw = makeSwing({ peakDps: 400, handleMs: 1500 });
    const n = s.rel.length;
    await playSwing(B, sw);
    await sleep(400);
    s = await state(B);
    const p = s.rel.length > n ? s.rel[s.rel.length - 1] : null;
    say(`A 400 deg/s swing: ${p ? `thrown, ${f(p.speed)} m/s (expected ${f(motionParams({ rate: 400, heading: 0, twist: 0 }).speed)})` : 'NOT thrown: ' + JSON.stringify(s.last)}`);
    check(p && p.input === 'motion', 'iOS granted: a swing must throw');
    if (p) await ballResult(B);
    await shot(B, `B_${answer}_2_thrown`);
    // a new page: iOS asks again (a tap), without the safety note this time
    await B.send('Page.navigate', { url: URL });
    await sleep(3500);
    await startGame(B);
    const again = await B.evaluate(`return { card: document.querySelector('#motionCard').classList.contains('show'), safety: !document.querySelector('#motionCard .mcSafety').hidden, text: document.querySelector('#motionCard .mcIntro').textContent }`);
    say(`Next page load: card ${again.card}, safety note ${again.safety}, text "${again.text}"`);
    check(again.card && !again.safety, 'iOS, later page loads: the card asks again, without the safety note');
    await shot(B, `B_${answer}_3_card_again`);
  } else {
    check(s.mstate === 'failed' && !s.btn && !s.useMotion && /tilläts inte/.test(s.toast), 'denied: back to the swipe, with the note');
    check(/ta tag i klotet och kasta/.test(s.status), `denied: the status must say to grip the ball and throw (the swipe) ("${s.status}")`);
    await shot(B, `B_${answer}_2_fallback`);
    const n = s.rel.length;
    await touchSwipe(B, 196, 720, 192, 430, 220);
    await sleep(500);
    s = await state(B);
    const p = s.rel.length > n ? s.rel[s.rel.length - 1] : null;
    say(`After the denial a swipe throws: ${!!p} (${p && p.input}); Kast setting now reads "${await B.evaluate(`return document.querySelector('#optThrow option[value=auto]').textContent`)}"`);
    check(p && p.input === 'swipe', 'denied: the swipe must throw');
  }
  const errs = B.log.filter((l) => /EXCEPTION|CONSOLE.ERROR/.test(l));
  say(`JS exceptions / console errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  check(!errs.length, `no JS exceptions in B ${answer}`);
  B.close();
}

// ======================================================================================
// D. The swing demo: two phone sizes, two languages, the five steps, skip, replay, reduced motion
// ======================================================================================
for (const [w, h, lang] of want('D') ? [[390, 844, 'sv'], [800, 1280, 'en'], [390, 844, 'en'], [800, 1280, 'sv']] : []) {
  say(`\n## D. The swing demo, ${w}x${h}, ${lang}\n`);
  const B = await launchEdge({ w, h });
  await phone(B, ANDROID, w, h);
  await sensorsOn(B);
  await setReadings(B, makeSwing({ handleMs: 0 }), -1000);
  await B.send('Page.navigate', { url: URL });
  await sleep(3000);
  await B.evaluate(`localStorage.setItem('vbg.settings', JSON.stringify({ lang: '${lang}' })); return 1;`);
  await B.send('Page.navigate', { url: URL });
  await sleep(3500);
  await startGame(B);
  let s = await state(B);
  check(s.demo, `${w}x${h} ${lang}: the demo must show at the first turn`);
  const caps = [];
  for (let i = 0; i < 6; i++) {
    const ms = [500, 1400, 2700, 4000, 4900, 5900][i];
    await B.evaluate(`vikingApp.input.motion.demo.seek(${ms}); return 1;`);
    await sleep(250);
    const c = await B.evaluate(`const o = document.querySelector('#motionDemo'); const p = o.querySelector('.mdPanel').getBoundingClientRect();
      const sv = o.querySelector('.mdStage svg').getBoundingClientRect();
      const out = (e, b) => { if (e.getAttribute('opacity') === '0') return false; const r = e.getBoundingClientRect(); return r.width && (r.right > b.right + 1 || r.left < b.left - 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1); };
      const cut = [...o.querySelectorAll('.mdPanel *')].filter(e => (e.closest('svg') ? out(e, sv) : out(e, p))).map(e => e.getAttribute('class') || e.tagName).join(',');
      return { cap: o.querySelector('.mdCaption').textContent, dots: [...o.querySelectorAll('.mdDots i')].map(d => d.classList.contains('on') ? 1 : 0).join(''), panelH: Math.round(p.height), vh: innerHeight, cut,
        play: o.querySelector('#mdPlay').getBoundingClientRect().bottom <= innerHeight, ball: o.querySelector('.mdStage .mdBall').getAttribute('opacity'), thumb: o.querySelector('.mdStage .mdThumb').getAttribute('cx') };`);
    const pose = demoPose(ms);
    caps.push(`${i + 1} [${c.dots}] "${c.cap}" (thumb ${pose.thumbDown ? 'down' : 'up'}, arm ${pose.theta.toFixed(0)} deg, aim ${pose.aim.toFixed(2)}, ball ${c.ball === '1' ? 'rolling' : 'in hand'})`);
    check(c.dots === '000000'.split('').map((_, k) => (k === i ? 1 : 0)).join(''), `${w}x${h} ${lang}: step ${i + 1} must light dot ${i + 1} (${c.dots})`);
    check(c.play && c.panelH <= c.vh && !c.cut, `${w}x${h} ${lang}: the demo must fit (panel ${c.panelH}/${c.vh}, Spela visible ${c.play}, cut ${c.cut})`);
    await shot(B, `D_${w}x${h}_${lang}_step${i + 1}`);
  }
  for (const c of caps) say('  ' + c);
  // the real gesture the demo shows: the thumb on the gold lower part of the screen, released at the bottom
  const rel = demoPose(DEMO.REL), before = demoPose(DEMO.REL - 50), aimed = demoPose(DEMO.STEPS[3] - 50);
  check(before.thumbDown && !rel.thumbDown && Math.abs(rel.theta) < 3 && rel.ball !== null, 'the demo must lift the thumb at the bottom of the swing, and the ball leave then');
  check(aimed.thumbDown && aimed.aim === 1 && aimed.theta === 0, 'the demo must aim (thumb down, the arm still) before the backswing');
  // skip at once (the first use: it also starts the sensors), then replay from the settings
  await tapSel(B, '#mdSkip');
  await sleep(1200);
  s = await state(B);
  say(`Skip: demo hidden ${!s.demo}, motion ${s.mstate}, swing button ${s.btn}`);
  check(!s.demo && s.mstate === 'ready' && s.btn, `${w}x${h} ${lang}: skipping must close the demo and start the swing`);
  await clickSel(B, '#btnMenu'); await sleep(500);
  const replayBtn = await B.evaluate(`const b = document.querySelector('#optMotionDemo'); return b && !b.hidden ? b.textContent : null;`);
  check(!!replayBtn, `${w}x${h} ${lang}: the settings must offer the demo again`);
  await B.evaluate(`document.querySelector('#optMotionDemo').scrollIntoView({ block: 'center' }); return 1;`);
  await tapSel(B, '#optMotionDemo');
  await sleep(500);
  s = await state(B);
  const firstOnly = await B.evaluate(`return { swipe: !document.querySelector('#mdSwipe').hidden, safety: !document.querySelector('.mdSafety').hidden }`);
  say(`Replay from the settings ("${replayBtn}"): demo shown ${s.demo}; first-use parts shown: swipe ${firstOnly.swipe}, safety ${firstOnly.safety}`);
  check(s.demo && !firstOnly.swipe && !firstOnly.safety, `${w}x${h} ${lang}: the replay must show the demo without the first-use parts`);
  await shot(B, `D_${w}x${h}_${lang}_replay`);
  await tapSel(B, '#mdPlay');
  await sleep(300);
  s = await state(B);
  check(!s.demo, `${w}x${h} ${lang}: "${lang === 'sv' ? 'Spela' : 'Play'}" must close the replay`);
  // reduced motion: the five steps as still frames
  await B.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await tapSel(B, '#optMotionDemo');
  await sleep(500);
  const still = await B.evaluate(`const o = document.querySelector('#motionDemo'); return { still: o.classList.contains('still'), frames: o.querySelectorAll('.mdStills figure').length, raf: !!vikingApp.input.motion.demo.raf, caps: [...o.querySelectorAll('.mdStills figcaption')].map(f => f.textContent) };`);
  say(`Reduced motion: still frames ${still.frames}, animation running ${still.raf}; captions: ${still.caps.join(' | ')}`);
  check(still.still && still.frames === 6 && !still.raf, `${w}x${h} ${lang}: reduced motion must show the six steps as still frames and no animation`);
  await shot(B, `D_${w}x${h}_${lang}_reduced_motion`);
  await tapSel(B, '#mdSkip');
  const errs = B.log.filter((l) => /EXCEPTION|CONSOLE.ERROR/.test(l));
  say(`JS exceptions / console errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  check(!errs.length, `no JS exceptions in D ${w}x${h} ${lang}`);
  B.close();
}

// ======================================================================================
// C. Desktop: the swipe (mouse), no swing button
// ======================================================================================
if (want('C')) {
  say('\n## C. Desktop (1280x800, mouse, no sensors)\n');
  const B = await launchEdge({ w: 1280, h: 800 });
  await B.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await B.send('Page.navigate', { url: URL });
  await sleep(3500);
  const pre = await B.evaluate(`return { auto: document.querySelector('#optThrow option[value=auto]').textContent, how: !document.querySelector('#howToMotion').hidden }`);
  await startGame(B);
  await sleep(600);
  let s = await state(B);
  say(`Kast = "${pre.auto}", splash swing line ${pre.how}; motion object ${s.mstate === undefined || s.mstate === null ? 'not created' : s.mstate}; button ${s.btn}`);
  check(/Svep/.test(pre.auto) && !pre.how && !s.btn && !s.useMotion, 'desktop: Auto must mean the swipe, no button');
  const n = s.rel.length;
  await B.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 700, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) { await sleep(18); await B.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 700 - i * 30, button: 'left', buttons: 1 }); }
  await B.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 340, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  s = await state(B);
  const p = s.rel.length > n ? s.rel[s.rel.length - 1] : null;
  say(`A mouse swipe throws: ${!!p} (${p && p.input}, ${p && f(p.speed)} m/s)`);
  check(p && p.input === 'swipe', 'desktop: a mouse swipe must throw');
  if (p) { const b = await ballResult(B); say(`  lane shows ${b.speedo}`); }
  await shot(B, 'C_desktop_swipe');
  const errs = B.log.filter((l) => /EXCEPTION|CONSOLE.ERROR/.test(l));
  say(`JS exceptions / console errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  check(!errs.length, 'no JS exceptions in C');
  B.close();
}

// ======================================================================================
// E. No dead button: a release the button does not get, the page hidden or left, a long hold, slow
//    or stalled sensors, a permission request never answered, the sensors off on the menus
// ======================================================================================
if (want('E')) {
  say('\n## E. No dead button (Android phone, and an iPhone for the permission)\n');
  // in the page from its first line: the page's own devicemotion listeners counted, and the sensor
  // events thinned out on demand (window.__thinMs, from localStorage 'test.thinMs' at load) by a
  // capturing listener that runs before the game's
  const hooks = `
    window.__dm = new Set(); window.__thinMs = +(localStorage.getItem('test.thinMs') || 0); let __last = -1e9;
    const __add = EventTarget.prototype.addEventListener, __rem = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (t, f, o) { if (this === window && t === 'devicemotion' && !(o && o.capture)) window.__dm.add(f); return __add.call(this, t, f, o); };
    EventTarget.prototype.removeEventListener = function (t, f, o) { if (this === window && t === 'devicemotion' && !(o && o.capture)) window.__dm.delete(f); return __rem.call(this, t, f, o); };
    __add.call(window, 'devicemotion', (e) => { if (window.__thinMs) { if (e.timeStamp - __last < window.__thinMs) { e.stopImmediatePropagation(); return; } __last = e.timeStamp; } }, { capture: true });`;
  const B = await launchEdge();
  await phone(B, ANDROID);
  await sensorsOn(B);
  await setReadings(B, makeSwing({ handleMs: 0 }), -1000);
  await B.send('Page.addScriptToEvaluateOnNewDocument', { source: hooks });
  await B.send('Page.navigate', { url: URL });
  await sleep(2500);
  await B.evaluate(`localStorage.setItem('vbg.motionIntro', 'true'); localStorage.setItem('vbg.throwHint', 'true'); return 1;`);
  await B.send('Page.navigate', { url: URL });
  await sleep(3500);
  await startGame(B);
  check(await waitFor(B, `vikingApp.input.motion && vikingApp.input.motion.state === 'ready' && document.querySelector('#swingBtn.show')`, 8000), 'E: the swing button must be ready');
  const rows = [];
  const row = (what, ok, got) => { rows.push(`| ${what} | ${ok ? 'ok' : 'FAIL'} | ${got} |`); check(ok, `E ${what}: ${got}`); };
  // a press made by the page's own events (the browser's view of a finger or the mouse on the button)
  const pressJs = (id, type) => `const b = document.querySelector('#swingBtn'); const m = vikingApp.input.motion;
    b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: ${id}, pointerType: '${type}', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: 1 }));`;
  // 1. the browser takes the touch over (pointercancel), the thumb lifts while another finger rests
  let r = await B.evaluate(`${pressJs(91, 'touch')}
    const pressed = !!m.press;
    b.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 91, pointerType: 'touch', bubbles: true }));
    const lane = document.querySelector('#stage');
    const thumb = new Touch({ identifier: 1, target: b.querySelector('b'), clientX: 195, clientY: 700 }), rest = new Touch({ identifier: 2, target: lane, clientX: 60, clientY: 300 });
    lane.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [thumb], changedTouches: [new Touch({ identifier: 3, target: lane, clientX: 80, clientY: 300 })] }));
    const heldOther = !!m.press;
    b.querySelector('b').dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [rest], changedTouches: [thumb] }));
    return { pressed, heldOther, released: !m.press };`);
  row('touch taken over by the browser, the thumb lifts while another finger rests', r.pressed && r.heldOther && r.released, JSON.stringify(r));
  await sleep(300);
  // 2-4. the page hidden, the window left, the capture lost: the press is cancelled
  for (const [what, act] of [
    ['the page hidden (an app switch)', `Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;`],
    ['the window losing focus', `window.dispatchEvent(new Event('blur'));`],
    ['the pointer capture lost', `b.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 92, pointerType: 'mouse' }));`]
  ]) {
    r = await B.evaluate(`${pressJs(92, 'mouse')} const pressed = !!m.press; ${act} return { pressed, cancelled: !m.press, label: b.querySelector('b').textContent };`);
    row(what + ' cancels the press', r.pressed && r.cancelled, JSON.stringify(r));
    await sleep(200);
  }
  // 5. a release that lands beside the button
  r = await B.evaluate(`${pressJs(93, 'mouse')} const pressed = !!m.press; document.querySelector('#stage').dispatchEvent(new PointerEvent('pointerup', { pointerId: 93, pointerType: 'mouse', bubbles: true })); return { pressed, released: !m.press };`);
  row('a release beside the button releases', r.pressed && r.released, JSON.stringify(r));
  await sleep(600);
  // and placing still works afterwards
  await waitFor(B, 'vikingApp.throwResolve && document.querySelector("#swingBtn.show")', 8000);
  const x0a = (await state(B)).humanX0 || 0;
  await touchSwipe(B, 195, 260, 255, 260, 300, 600);
  await sleep(300);
  const x0b = (await state(B)).humanX0;
  row('placing the ball works after these (no press stuck)', x0b > x0a + 0.05, `humanX0 ${f(x0a, 3)} -> ${f(x0b, 3)}`);
  // 6. a long hold: aim, hold 9 s, swing - the ball goes where the marker stood
  {
    await waitFor(B, 'vikingApp.throwResolve && document.querySelector("#swingBtn.show")', 15000);
    const before = (await state(B)).rel.length;
    // (the first real press here: "hold still" first, so the phone is still for 0.9 s before the aim)
    const o = { peakDps: 400, aimDeg: 9, aimHoldMs: 9000, handleMs: 600, stillMs: 900, seed: 11 };
    const sw = makeSwing(o);
    await playSwing(B, sw);
    await sleep(400);
    const s = await state(B);
    const L = await B.evaluate(`const L = vikingApp.input.motion.last; return L ? { ok: L.ok, reason: L.reason, aimYaw: L.aimYaw, locked: L.aimLocked, heading: L.heading, releaseDeg: L.releaseDeg, held: L.tRelease - L.tStart, hz: L.hz } : null;`);
    const p = s.rel.length > before ? s.rel[s.rel.length - 1] : null;
    // (the ball was placed above: the aim is the line from where it stands)
    const ex = motionParams({ rate: o.peakDps, aimYaw: o.aimDeg, heading: 0, twist: 0, releaseDeg: sw.theta(sw.tRelease) }, s.humanX0 || 0);
    row('a 9 s hold before the swing keeps the aim', p && p.input === 'motion' && Math.abs(p.angle - ex.angle) < 0.003, (p ? `angle ${f(p.angle, 4)} (expected ${f(ex.angle, 4)})` : 'not thrown') + ` ${JSON.stringify(L)}`);
    if (p) await ballResult(B);
  }
  // 7. the sensors off on the menus, back at the next turn without a card
  {
    await waitFor(B, 'vikingApp.throwResolve && document.querySelector("#swingBtn.show")', 15000);
    const playing = await B.evaluate('return window.__dm.size');
    await clickSel(B, '#btnMenu'); await sleep(600);
    const menu = await B.evaluate('return { n: window.__dm.size, st: vikingApp.input.motion.state }');
    await clickSel(B, '#menuNext'); await sleep(600); await clickSel(B, '#startBtn');
    await waitFor(B, 'vikingApp.throwResolve && document.querySelector("#swingBtn.show")', 15000);
    await sleep(500);
    const back = await B.evaluate('return { n: window.__dm.size, st: vikingApp.input.motion.state, card: document.querySelector("#motionCard").classList.contains("show") }');
    row('no devicemotion listener on the menu; back at the turn', playing === 1 && menu.n === 0 && back.n === 1 && back.st === 'ready' && !back.card, `playing ${playing}, menu ${JSON.stringify(menu)}, turn ${JSON.stringify(back)}`);
  }
  // 8. the sensor stream stalls while the button is shown: two presses, then the swipe
  {
    await B.evaluate('window.__thinMs = 3000; return 1');
    await sleep(1500);
    const btn = await center(B, '#swingBtn');
    for (let k = 0; k < 2; k++) {
      await B.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: btn.x, y: btn.y }] });
      await sleep(700);
      await B.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(600);
    }
    const s = await state(B);
    row('a stalled sensor stream: after two presses the swipe, with a note', s.mstate === 'failed' && !s.useMotion && !s.btn && /för långsamt/.test(s.toast), `${s.mstate}, button ${s.btn}, toast "${s.toast}"`);
    await shot(B, 'E_stalled_fallback');
    await B.evaluate('window.__thinMs = 0; return 1');
  }
  // 9. slow sensors (5 Hz) from the start, on two page loads: the swing at first (the start is not
  //    judged), the swipe after two presses with too few events, remembered the second time
  {
    const loads = [];
    // (the stalled stream above was one miss: start from none)
    await B.evaluate(`localStorage.removeItem('vbg.motionUnavailable'); localStorage.removeItem('vbg.motionMisses'); return 1;`);
    for (let k = 0; k < 2; k++) {
      await B.evaluate(`localStorage.setItem('test.thinMs', '200'); return 1;`);
      await B.send('Page.navigate', { url: URL });
      await sleep(3500);
      await startGame(B);
      await sleep(1800);
      const s0 = await state(B);
      const btn = await center(B, '#swingBtn');
      for (let j = 0; btn && j < 2; j++) {
        await B.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: btn.x, y: btn.y }] });
        await sleep(700);
        await B.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(600);
      }
      const s = await state(B);
      loads.push({ atStart: s0.mstate, st: s.mstate, toast: s.toast.slice(0, 40), unavailable: await B.evaluate(`return localStorage.getItem('vbg.motionUnavailable')`), auto: await B.evaluate(`return document.querySelector('#optThrow option[value=auto]').textContent`) });
    }
    row('5 Hz sensors: the swing at first, the swipe with a note after two presses; "Auto" remembers it only the second time',
      loads.every((l) => l.atStart === 'ready' && l.st === 'failed' && /för långsamt/.test(l.toast)) && loads[0].unavailable !== 'true' && loads[1].unavailable === 'true', JSON.stringify(loads));
    await B.evaluate(`localStorage.removeItem('test.thinMs'); localStorage.removeItem('vbg.motionUnavailable'); localStorage.removeItem('vbg.motionMisses'); return 1;`);
  }
  const errsA = B.log.filter((l) => /EXCEPTION|CONSOLE.ERROR/.test(l));
  B.close();
  // 10. iPhone: the permission request is never answered
  {
    const P = await launchEdge();
    await phone(P, IPHONE, 393, 852);
    await sensorsOn(P);
    await setReadings(P, makeSwing({ handleMs: 0 }), -1000);
    await P.send('Page.addScriptToEvaluateOnNewDocument', { source: `DeviceMotionEvent.requestPermission = () => new Promise(() => {}); if (window.DeviceOrientationEvent) DeviceOrientationEvent.requestPermission = () => new Promise(() => {});` });
    await P.send('Page.navigate', { url: URL });
    await sleep(2500);
    await P.evaluate(`localStorage.setItem('vbg.motionIntro', 'true'); return 1;`);
    await P.send('Page.navigate', { url: URL });
    await sleep(3500);
    await P.evaluate(`const M = await import('./js/sim3d/motion.js'); M.MOTION.permissionMs = 1500; return 1;`);
    await startGame(P);
    const card = await P.evaluate(`return document.querySelector('#motionCard').classList.contains('show')`);
    await tapSel(P, '#motionAllow');
    const during = await P.evaluate('return vikingApp.input.motion.state');
    await sleep(2200);
    const s = await state(P);
    row('iPhone, a permission request never answered: not "starting" for good - the swipe, with a note', card && during === 'starting' && s.mstate === 'failed' && !s.useMotion && /svarar/.test(s.toast), `card ${card}, ${during} -> ${s.mstate}, toast "${s.toast}"`);
    errsA.push(...P.log.filter((l) => /EXCEPTION|CONSOLE.ERROR/.test(l)));
    P.close();
  }
  // 11. iPhone: the permission granted after the timeout (the prompt read slowly) - the swing comes back
  {
    const P = await launchEdge();
    await phone(P, IPHONE, 393, 852);
    await sensorsOn(P);
    await setReadings(P, makeSwing({ handleMs: 0 }), -1000);
    // the answer comes 3 s after the tap; the 12 s timeout is scaled to 1.5 s below
    await P.send('Page.addScriptToEvaluateOnNewDocument', { source: `DeviceMotionEvent.requestPermission = () => new Promise((r) => setTimeout(() => r('granted'), 3000)); if (window.DeviceOrientationEvent) DeviceOrientationEvent.requestPermission = () => new Promise((r) => setTimeout(() => r('granted'), 3000));` });
    await P.send('Page.navigate', { url: URL });
    await sleep(2500);
    await P.evaluate(`localStorage.setItem('vbg.motionIntro', 'true'); localStorage.removeItem('vbg.motionMisses'); localStorage.removeItem('vbg.motionUnavailable'); return 1;`);
    await P.send('Page.navigate', { url: URL });
    await sleep(3500);
    await P.evaluate(`const M = await import('./js/sim3d/motion.js'); M.MOTION.permissionMs = 1500; return 1;`);
    await startGame(P);
    await tapSel(P, '#motionAllow');
    await sleep(2000);
    const atTimeout = await state(P);
    const missesAtTimeout = await P.evaluate(`return localStorage.getItem('vbg.motionMisses')`);
    await sleep(2500);
    const s = await state(P);
    const after = await P.evaluate(`return { misses: localStorage.getItem('vbg.motionMisses'), unavailable: localStorage.getItem('vbg.motionUnavailable'), toastShown: document.querySelector('#toast').classList.contains('show'), toast: document.querySelector('#toast').textContent.slice(0, 40), auto: document.querySelector('#optThrow option[value=auto]').textContent }`);
    row('iPhone, the permission granted after the timeout: the swing back, the note gone, the miss forgotten',
      atTimeout.mstate === 'failed' && /svarar/.test(atTimeout.toast) && missesAtTimeout === '1' && s.mstate === 'ready' && s.useMotion && s.btn && !(after.toastShown && /svarar/.test(after.toast)) && after.misses === '0' && after.unavailable === 'false' && /Svinga/.test(after.auto) && /håll knappen/.test(s.status),
      `at the timeout ${atTimeout.mstate} "${atTimeout.toast.slice(0, 30)}" misses ${missesAtTimeout}; after the grant ${s.mstate}, motion ${s.useMotion}, button ${s.btn}, status "${s.status}", ${JSON.stringify(after)}`);
    await shot(P, 'E_late_grant');
    errsA.push(...P.log.filter((l) => /EXCEPTION|CONSOLE.ERROR/.test(l)));
    P.close();
  }
  say('| case | | what happened |');
  say('|---|---|---|');
  for (const x of rows) say(x);
  say(`JS exceptions / console errors: ${errsA.length ? errsA.join(' | ') : 'none'}`);
  check(!errsA.length, 'no JS exceptions in E');
}

say(`\n${failures ? failures + ' FAILED' : 'All browser checks passed'}`);
writeFileSync(join(OUT, 'motion_browser.md'), lines.join('\n') + '\n');
process.exit(failures ? 1 : 0);

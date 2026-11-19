// Motion control in Chrome on Android, in the emulator (AVD vbs_tablet): the emulator's own
// sensors, set through its console (telnet 5554: sensor set gyroscope / acceleration, in the
// device's frame, rad/s and m/s2), reach Chrome's devicemotion events, and a scripted swing
// (tests/motion_traces.mjs, the agreed grip: upright like a remote) pressed and released on the
// swing button throws. Motion events need a secure context: adb reverse makes the PC's server
// http://localhost:<port> inside the emulator.
//   node tests/serve.mjs 8773           (in another console; the emulator running, Chrome open)
//   node tests/motion_android.mjs [port=8773] [outDir]
// adb is taken from the PATH (the Android SDK's platform-tools); ADB=<path to adb> names another one.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sleep } from './cdp_driver.mjs';
import { emuConsole } from './emu_console.mjs';
import { makeSwing, readingAt } from './motion_traces.mjs';
import { motionParams, aimAt } from '../js/sim3d/input.js';

const PORT = process.argv[2] || '8773';
const OUT = process.argv[3] || join(process.cwd(), 'motion_android_out');
mkdirSync(OUT, { recursive: true });
const ADB = process.env.ADB || 'adb';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });
const URL = `http://localhost:${PORT}/?nofs=1&detail=low`;
let failures = 0;
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };
const check = (ok, msg) => { if (!ok) { failures++; say('FAIL ' + msg); } };
const f = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : String(v));

adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote');
let list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
if (!list.some((t) => t.type === 'page')) {
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', URL, 'com.android.chrome');
  await sleep(4000);
  list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
}
const page = list.find((t) => t.type === 'page');
const B = await connect(page.webSocketDebuggerUrl);
const emu = await emuConsole();
const version = (await (await fetch('http://127.0.0.1:9222/json/version')).json()).Browser;

// the readings of a swing at trace time t, set in the emulator
async function setReadings(sw, t) {
  const r = readingAt(sw, t);
  const D = Math.PI / 180;
  await emu.cmd(`sensor set gyroscope ${(r.w[0] * D).toFixed(5)}:${(r.w[1] * D).toFixed(5)}:${(r.w[2] * D).toFixed(5)}`);
  await emu.cmd(`sensor set acceleration ${r.f[0].toFixed(4)}:${r.f[1].toFixed(4)}:${r.f[2].toFixed(4)}`);
}
const center = (sel) => B.evaluate(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;`);
const tap = async (sel) => { const c = await center(sel); if (!c) { check(false, 'not visible: ' + sel); return; } await B.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] }); await sleep(60); await B.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400); };
const click = (sel) => B.evaluate(`document.querySelector(${JSON.stringify(sel)}).click(); return 1;`, true);
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await B.evaluate(`return !!(${expr})`)) return true; await sleep(200); } return false; };
const shot = async (name) => { const s = await B.send('Page.captureScreenshot', { format: 'png' }); if (s.result) writeFileSync(join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64')); };

say(`## Android emulator: ${version}, AVD vbs_tablet; sensors set through the emulator console\n`);
// a still phone, held upright like a remote, the arm hanging
await setReadings(makeSwing({ handleMs: 0 }), -1000);
await B.send('Page.navigate', { url: URL });
await sleep(3500);
await B.evaluate(`localStorage.clear(); return 1;`);
await B.send('Page.navigate', { url: URL });
await sleep(4500);
const env = await B.evaluate(`return { ua: navigator.userAgent, secure: isSecureContext, auto: document.querySelector('#optThrow option[value=auto]').textContent, orient: screen.orientation && screen.orientation.type, perm: typeof DeviceMotionEvent.requestPermission }`);
say(`Page: secure ${env.secure}, ${env.orient}, Kast = "${env.auto}", requestPermission ${env.perm}; ${env.ua}`);
check(env.secure && /Svinga/.test(env.auto), 'Android: a secure context and the swing as the default');
// the raw events: what the emulator's sensors give the page
await B.evaluate(`window.__ev = []; addEventListener('devicemotion', (e) => { const r = e.rotationRate, g = e.accelerationIncludingGravity; __ev.push([e.timeStamp, r && r.alpha, r && r.beta, r && r.gamma, g && g.x, g && g.y, g && g.z]); }); return 1;`);
await emu.cmd('sensor set gyroscope 0.5:-0.25:1');
await sleep(600);
const raw = await B.evaluate(`const n = __ev.length; return { n, hz: n > 20 ? +(20 / ((__ev[n - 1][0] - __ev[n - 21][0]) / 1000)).toFixed(1) : null, last: __ev[n - 1] && __ev[n - 1].map((v, i) => i ? +(+v).toFixed(2) : Math.round(v)) };`);
say(`devicemotion from the emulator: ${raw.n} events in 0.6 s (${raw.hz} Hz); gyroscope set to 0.5 : -0.25 : 1 rad/s gives rotationRate alpha/beta/gamma ${raw.last && raw.last.slice(1, 4).join(' / ')} deg/s, accelerationIncludingGravity ${raw.last && raw.last.slice(4).join(' / ')}`);
check(raw.hz > 40 && raw.last && Math.abs(raw.last[1] - 28.65) < 0.2 && Math.abs(raw.last[3] - 57.3) < 0.2, 'the emulator\'s sensors must reach the page (alpha = x, gamma = z, in deg/s)');
await setReadings(makeSwing({ handleMs: 0 }), -1000);

// into a game with no machine players
await click('#okBtn'); await sleep(600);
await B.evaluate(`const s = document.querySelector('#optRobots'); s.value = '0'; s.dispatchEvent(new Event('change')); return 1;`);
await click('#menuNext'); await sleep(700);
await click('#startBtn');
check(await waitFor('window.vikingApp && vikingApp.throwResolve'), 'the player\'s turn must come');
await B.evaluate(`window.__rel = []; vikingEvents.on('throwRelease', (e) => __rel.push(e)); return 1;`);
const demo = await B.evaluate(`return document.querySelector('#motionDemo') && document.querySelector('#motionDemo').classList.contains('show')`);
say(`First turn: the swing demo shown ${demo}`);
check(demo, 'the swing demo must show at the first turn');
await shot('android_1_demo');
await tap('#mdPlay');
await sleep(1200);
let st = await B.evaluate(`const m = vikingApp.input.motion; return { state: m.state, btn: document.querySelector('#swingBtn').classList.contains('show'), toast: document.querySelector('#toast').textContent }`);
say(`After "Spela": motion ${st.state}, swing button ${st.btn}${st.toast ? ', hint "' + st.toast + '"' : ''}`);
check(st.state === 'ready' && st.btn, 'the sensors must be ready and the button shown');
await shot('android_2_button');

say('\n| throw (the remote grip) | result | swing rate seen (deg/s) | heading / twist / release (deg) | launch m/s (expected) | angle rad (expected) | side rad/s (expected) | lane shows |');
say('|---|---|---|---|---|---|---|---|');
const throws = [
  ['1 medium, straight (first: hold still)', { peakDps: 300, handleMs: 2500 }, true],
  ['2 aim 8 left (board 28), then a fast straight swing', { peakDps: 550, aimDeg: 8, handleMs: 600, stillMs: 300, seed: 2 }, true],
  ['2b aim 6 right, pulled 20 left in the swing', { peakDps: 400, aimDeg: -6, psiDeg: 20, handleMs: 600, stillMs: 300, seed: 9 }, true],
  ['3 no swing: press, hold, release', { release: 'none', handleMs: 600, stillMs: 300, seed: 3 }, false],
  ['4 slow, wrist 50 (right-hander)', { peakDps: 160, backDeg: 45, fwdDeg: 50, twistDeg: 50, releaseU: 0.6, handleMs: 600, stillMs: 300, seed: 4 }, true],
  ['5 medium, let go late (end of the swing)', { peakDps: 300, releaseU: 0.97, handleMs: 600, stillMs: 300, seed: 5 }, true]
];
for (const [name, o, throws_] of throws) {
  await waitFor('vikingApp.throwResolve && document.querySelector("#swingBtn.show")');
  const btn = await center('#swingBtn');
  const n0 = (await B.evaluate('return __rel.length'));
  const sw = makeSwing(o);
  let T0 = performance.now();
  let pressed = false, released = false, aimHold = null, aimLock = null;
  for (;;) {
    const t = sw.tStart + (performance.now() - T0);
    if (t > sw.tRelease + 350) break;
    await setReadings(sw, t);
    const aimProbe = 'const A = vikingApp.input.aimLive; return A ? { board: A.board, locked: A.locked } : null;';
    // the probes: the trace's clock waits for them (the first comes while the aim is held still)
    if (o.aimDeg && !aimHold && t >= sw.backStart - 120) { const p0 = performance.now(); aimHold = await B.evaluate(aimProbe) || {}; if (name.startsWith('2 ')) await shot('android_2b_aim_marker'); T0 += performance.now() - p0; }
    if (o.aimDeg && !aimLock && t >= sw.fwdStart + 40) { const p0 = performance.now(); aimLock = await B.evaluate(aimProbe) || {}; T0 += performance.now() - p0; }
    if (!pressed && t >= 0) { pressed = true; await B.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: btn.x, y: btn.y }] }); }
    if (pressed && !released && t >= sw.tRelease) { released = true; await B.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    await sleep(4);
  }
  await setReadings(makeSwing({ handleMs: 0 }), -1000);
  await sleep(400);
  const r = await B.evaluate(`const L = vikingApp.input.motion.last; return { rel: __rel.slice(${n0}), last: L && { ok: L.ok, reason: L.reason, rate: L.rate, heading: L.heading, twist: L.twist, releaseDeg: L.releaseDeg }, toast: document.querySelector('#toast').textContent }`);
  const p = r.rel[0];
  const rateTrue = o.peakDps || 0;
  const ex = throws_ ? motionParams({ rate: rateTrue, aimYaw: o.aimDeg || 0, heading: o.psiDeg || 0, twist: -(o.twistDeg || 0), releaseDeg: sw.theta(sw.tRelease) }) : null;
  if (o.aimDeg) {
    const want = aimAt(o.aimDeg, 0).board;
    say(`  aim: held on board ${aimHold && aimHold.board} (locked ${aimHold && aimHold.locked}), in the swing board ${aimLock && aimLock.board} (locked ${aimLock && aimLock.locked}), expected ${want}`);
    check(aimHold && Math.abs(aimHold.board - want) <= 1 && !aimHold.locked && aimLock && aimLock.locked && aimLock.board === want, `${name}: the marker must follow the aim and lock on board ${want}`);
  }
  let lane = '-';
  if (p) { await waitFor(`vikingApp.activeLane.physics.state === 'done'`, 15000); await sleep(300); lane = await B.evaluate(`return document.querySelector('#speedo').textContent`); }
  const L = r.last || {};
  say(`| ${name} | ${p ? 'thrown' : 'no throw: ' + L.reason + ', hint "' + r.toast.slice(0, 40) + '…"'} | ${f(L.rate, 0)} | ${f(L.heading, 1)} / ${f(L.twist, 1)} / ${f(L.releaseDeg, 0)} | ${p ? f(p.speed) : '-'} (${ex ? f(ex.speed) : '-'}) | ${p ? f(p.angle, 4) : '-'} (${ex ? f(ex.angle, 4) : '-'}) | ${p ? f(p.side) : '-'} (${ex ? f(ex.side) : '-'}) | ${lane} |`);
  if (throws_) {
    check(p && p.input === 'motion', `${name}: must throw by motion`);
    if (p) {
      check(Math.abs(p.speed / ex.speed - 1) < 0.05, `${name}: speed ${f(p.speed)} vs ${f(ex.speed)}`);
      check(Math.abs(p.angle - ex.angle) < 0.005, `${name}: angle ${f(p.angle, 4)} vs ${f(ex.angle, 4)}`);
      check(Math.abs(p.side - ex.side) < 2, `${name}: side ${f(p.side)} vs ${f(ex.side)}`);
    }
  } else check(!p && /Inget kast/.test(r.toast), `${name}: must not throw, with the hint`);
  if (name.startsWith('2')) await shot('android_3_after_throw');
}
const errs = B.log.filter((l) => /EXCEPTION|CONSOLE.ERROR/.test(l));
say(`\nJS exceptions / console errors: ${errs.length ? errs.join(' | ') : 'none'}`);
check(!errs.length, 'no JS exceptions on Android');
try { execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }); writeFileSync(join(OUT, 'android_4_device_screen.png'), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 })); } catch (e) { say('screencap: ' + e.message); }
await emu.cmd('sensor set gyroscope 0:0:0');
emu.close(); B.close();
say(`\n${failures ? failures + ' FAILED' : 'All Android checks passed'}`);
writeFileSync(join(OUT, 'motion_android.md'), lines.join('\n') + '\n');
process.exit(failures ? 1 : 0);

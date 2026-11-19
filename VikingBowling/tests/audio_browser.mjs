// The sound in the browser: headless Edge, the game served from a sub-path as GitHub Pages does.
//   node tests/audio_browser.mjs <baseUrl> <outDir> [mobile 0|1] [cpu slowdown, e.g. 4] [quick]
//   (quick: only the first gesture and the frame time)
//   e.g. node tests/serve.mjs 8790 <folder that holds games/VikingBowling>, then
//        node tests/audio_browser.mjs http://127.0.0.1:8790/games/VikingBowling/ out
// Checks, with the browser's own autoplay rules (no autoplay flag):
//   * no AudioContext and no sound before the first gesture; the context runs after it
//   * every sound renders (when idle) without an error; no human voice is rendered (no murmur of
//     talkers, no cheers or groans), and the room tone runs
//   * full games in 3D (EUR and AMR, the player's balls by the game's test throws, the machine
//     players' as they bowl): the reactions in the log follow each ball's result, the early ones
//     come before the ball is scored, the crash grows with the pins that fall, far lanes are heard,
//     and every sound played is from a bank that is not a voice
//   * each reaction played on its own through the shared game events, with the result made by the
//     game's engine, and recorded from the output: a WAV per reaction, with its loudness; a bad
//     ball (gutter, split, a pin left, a missed spare) plays nothing over the room tone
//   * mute and volume work and are remembered over a reload; muted, no AudioContext starts
//   * the frame time with the sound on and muted, on the low detail level
//   * no JS exception and no console error
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:8790/games/VikingBowling/';
const outDir = process.argv[3] || 'audio_out';
const mobile = process.argv[4] === '1';
const cpu = +(process.argv[5] || 1);
const QUICK = process.argv[6] === 'quick';
mkdirSync(outDir, { recursive: true });
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const report = {};

const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'vbgaudio-'));
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const consoleLog = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION ' + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 400));
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (msg.params.type === 'error') problems.push('CONSOLE ERROR ' + text.slice(0, 300));
    else if (msg.params.type === 'warning') consoleLog.push('WARNING ' + text.slice(0, 300));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const app = window.vikingApp; ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) { const d = 'EXCEPTION: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description); problems.push('test script ' + d.slice(0, 300)); return d; }
  return r.result && r.result.result ? r.result.result.value : undefined;
};
async function click(sel) {
  const c = await js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  if (!c) { problems.push('not clickable: ' + sel); return false; }
  if (mobile) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(300);
  return true;
}

// Before any page script: count AudioContexts and started sounds, and whether a gesture came first
const PROBE = `
window.__probe = { gesture: false, contexts: [], startsBeforeGesture: 0, starts: 0 };
for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, () => { window.__probe.gesture = true; }, { capture: true });
const AC0 = window.AudioContext;
if (AC0) {
  const Wrapped = function (...a) { const c = new AC0(...a); window.__probe.contexts.push({ t: Math.round(performance.now()), afterGesture: window.__probe.gesture, state: c.state }); return c; };
  Wrapped.prototype = AC0.prototype;
  window.AudioContext = Wrapped;
  const st = AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start = function (...a) { window.__probe.starts++; if (!window.__probe.gesture) window.__probe.startsBeforeGesture++; return st.apply(this, a); };
}`;

await send('Page.enable'); await send('Runtime.enable');
const W = mobile ? 390 : 1280, H = mobile ? 844 : 800;
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile });
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
if (cpu > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpu });
const url = base + '?nofs=1&detail=low';
await send('Page.navigate', { url });
await sleep(3500);

// ---- 1. nothing before the first gesture ---------------------------------------------------------
const before = await js(`return { probe: window.__probe, on: app.sound.on, volume: app.sound.volume, ctx: !!app.sound.ctx, slider: document.querySelector('[data-volume]') && document.querySelector('[data-volume]').value, coarse: matchMedia('(pointer: coarse)').matches }`);
report.beforeGesture = before;
if (before.probe.contexts.length) problems.push('an AudioContext was created before the first gesture');
if (before.probe.starts) problems.push('a sound was started before the first gesture');
console.log('1. before the first gesture:', JSON.stringify(before));

// ---- 2. the first gesture -------------------------------------------------------------------------
await click('#okBtn');
await sleep(600);
const after = await js(`return { probe: window.__probe, state: app.sound.ctx && app.sound.ctx.state, rate: app.sound.ctx && app.sound.ctx.sampleRate }`);
report.afterGesture = after;
if (after.probe.contexts.length !== 1) problems.push('expected one AudioContext after the gesture, got ' + after.probe.contexts.length);
else if (!after.probe.contexts[0].afterGesture) problems.push('the AudioContext was not created inside the gesture');
if (after.state !== 'running') problems.push('the AudioContext is ' + after.state + ' after the gesture');
console.log('2. after the first gesture:', JSON.stringify(after));
const ready = await js(`const t0 = performance.now(); while (app.sound.jobs.length && performance.now() - t0 < 30000) await sleep(100); return { ms: Math.round(performance.now() - t0), left: app.sound.jobs.length, banks: app.sound.readiness(), log: app.sound.log.filter(e => e.type === 'ready' || e.type === 'roomTone') }`);
report.render = ready;
console.log('   rendered when idle in', ready.ms, 'ms;', JSON.stringify(ready.banks));
if (ready.left) problems.push('sounds still rendering after 30 s');
// no human voices: none of the old voice banks or the murmur of talkers exists; the room tone runs
const VOICE_BANKS = ['yeah', 'cheer', 'roar', 'whoa', 'oh', 'aww', 'ooh', 'sigh', 'murmur'];
const voiceBanks = VOICE_BANKS.filter((n) => n in ready.banks);
if (voiceBanks.length) problems.push('voice banks rendered: ' + voiceBanks.join(', '));
if (ready.banks.roomTone !== true) problems.push('the room tone does not run');
// every buffer played from now on, by bank, so the games can show that no voice is played (taken
// off again before the frame time is measured)
await js(`
  const s = app.sound, play = s.play.bind(s);
  window.__played = {};
  s.play = function (buf, o = {}) { let name = buf ? '?' : 'none ready'; if (buf) for (const [n, b] of s.banks) if (b.slots.includes(buf)) { name = n; break; } window.__played[name] = (window.__played[name] || 0) + 1; return play(buf, o); };
  return true;`);

// A recorder on the output (before the limiter), and the game's events, for the rest of the test
await js(`
  const s = app.sound, c = s.ctx;
  const rec = c.createScriptProcessor(4096, 2, 2);
  window.__rec = { on: false, L: [], R: [] };
  rec.onaudioprocess = (e) => { if (!window.__rec.on) return; window.__rec.L.push(new Float32Array(e.inputBuffer.getChannelData(0))); window.__rec.R.push(new Float32Array(e.inputBuffer.getChannelData(1))); };
  const z = c.createGain(); z.gain.value = 0;
  s.master.connect(rec); rec.connect(z); z.connect(c.destination);
  window.__recNode = rec;
  window.__events = [];
  window.vikingEvents.on('*', (e) => window.__events.push({ t: Math.round(performance.now()), type: e.type, lane: e.lane, human: e.human, exciter: e.exciter, firstBall: e.firstBall, before: e.before, standing: e.standing, inARow: e.inARow }));
  window.__recStart = () => { window.__rec.L = []; window.__rec.R = []; window.__rec.on = true; };
  window.__recStop = () => {
    window.__rec.on = false;
    const n = window.__rec.L.reduce((a, b) => a + b.length, 0), sr = c.sampleRate;
    const L = new Float32Array(n), R = new Float32Array(n); let o = 0;
    window.__rec.L.forEach((b, i) => { L.set(b, o); R.set(window.__rec.R[i], o); o += b.length; });
    let e = 0, peak = 0, best = 0; const w = Math.round(sr * 0.05);
    for (let i = 0; i < n; i++) { e += L[i] * L[i] + R[i] * R[i]; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
    for (let s0 = 0; s0 + w <= n; s0 += w) { let q = 0; for (let i = s0; i < s0 + w; i++) q += L[i] * L[i] + R[i] * R[i]; best = Math.max(best, q / (2 * w)); }
    // 16-bit stereo WAV at 24 kHz (every other sample of 48 kHz), as base64
    const step = sr >= 44100 ? 2 : 1, m = Math.floor(n / step), outSr = Math.round(sr / step);
    const buf = new ArrayBuffer(44 + m * 4), dv = new DataView(buf);
    const wr = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + m * 4, true); wr(8, 'WAVE'); wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, outSr, true); dv.setUint32(28, outSr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, m * 4, true);
    for (let i = 0; i < m; i++) { dv.setInt16(44 + i * 4, Math.max(-32767, Math.min(32767, L[i * step] * 32767)), true); dv.setInt16(46 + i * 4, Math.max(-32767, Math.min(32767, R[i * step] * 32767)), true); }
    let bin = ''; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { seconds: +(n / sr).toFixed(2), rms: +Math.sqrt(e / (2 * Math.max(1, n))).toFixed(4), loudest50ms: +Math.sqrt(best).toFixed(4), peak: +peak.toFixed(3), wav: btoa(bin) };
  };
  return true;`);
const saveRec = async (name) => {
  const r = await js(`return window.__recStop()`);
  if (r && r.wav) writeFileSync(join(outDir, name + '.wav'), Buffer.from(r.wav, 'base64'));
  if (r) delete r.wav;
  return r;
};

// ---- 3. full games in 3D -------------------------------------------------------------------------
// The player's balls: a pocket shot on a full rack (often a strike), at the pins on a leave, and
// now and then a ball into the gutter
const PLAYER = `
  let n = 0;
  window.__playerBall = () => {
    const L = app.throwLane; if (!L) return false;
    const ph = L.physics;
    const standing = ph.pins.filter((p) => p.active && ph.isStanding(p));
    n++;
    if (n % 7 === 3) return app.testThrow({ x0: 0.42, speed: 7, angle: 0.03, side: 0, roll: 0.5 });          // into the gutter
    if (standing.length === 10) return app.testAimedThrow(0.105 + (Math.random() - 0.5) * 0.04, 8, 26, 0.25);
    const xs = standing.map((p) => p.body.position.x - L.laneX), tx = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    return app.testAimedThrow(tx, 7.5, 2, Math.max(-0.3, Math.min(0.3, -tx * 0.6)));
  };`;
async function playGame(style, label, seconds) {
  await js(`app.show('menu'); app.setMode('open'); app.settings.style = ${JSON.stringify(style)}; app.settings.robots = 2; app.settings.skill = 'expert'; app.settings.game = 'normal'; app.syncMenu(); app.save(); return true;`);
  await click('#menuNext');
  await sleep(300);
  await click('#startBtn');
  await js(PLAYER + ' return true;');
  const t0 = Date.now();
  const frames = [];
  let done = false;
  await js(`app.fast = true; window.__sfMs = []; const f0 = app.sound.frame.bind(app.sound); app.sound.frame = (dt, a) => { const t = performance.now(); f0(dt, a); window.__sfMs.push(performance.now() - t); }; window.__raf = []; let last = performance.now(); const loop = (t) => { window.__raf.push(t - last); last = t; if (window.__rafOn) requestAnimationFrame(loop); }; window.__rafOn = true; requestAnimationFrame(loop); return true;`);
  while (Date.now() - t0 < seconds * 1000) {
    const s = await js(`if (app.screen === 'summary') return 'summary'; if (app.throwResolve) { window.__playerBall(); return 'threw'; } return app.screen;`);
    if (s === 'summary') { done = true; break; }
    await sleep(s === 'threw' ? 200 : 250);
  }
  const res = await js(`window.__rafOn = false; app.sound.frame = Object.getPrototypeOf(app.sound).frame.bind(app.sound);
    const raf = window.__raf.slice(5).sort((a, b) => a - b), sf = window.__sfMs.slice().sort((a, b) => a - b);
    const med = (a) => a.length ? +a[Math.floor(a.length / 2)].toFixed(2) : null, p95 = (a) => a.length ? +a[Math.floor(a.length * 0.95)].toFixed(2) : null;
    return { frames: raf.length, rafMedianMs: med(raf), rafP95Ms: p95(raf), soundFrameMedianMs: med(sf), soundFrameP95Ms: p95(sf), soundFrameMaxMs: sf.length ? +sf[sf.length - 1].toFixed(2) : null };`);
  return { label, finished: done, seconds: Math.round((Date.now() - t0) / 1000), ...res };
}

if (!QUICK) {
await js(`app.sound.log.length = 0; window.__events.length = 0; return true;`);
await js(`window.__recStart(); return true;`);
const eur = await playGame('eur', 'open play EUR, 3 bowlers', 420);
const recGame = await saveRec('game_eur_full');
const logEur = await js(`return { log: app.sound.log.slice(), events: window.__events.slice() }`);
report.gameEur = { ...eur, recording: recGame };
console.log('3. full game EUR:', JSON.stringify(eur), JSON.stringify(recGame));
if (!eur.finished) problems.push('the EUR game did not finish');

// What the log says about every ball of the game
function analyse(L, label) {
  const reactions = L.log.filter((e) => e.type === 'reaction');
  const judged = L.log.filter((e) => e.type === 'judged');
  const balls = L.log.filter((e) => e.type === 'balldone');
  const far = L.log.filter((e) => e.type === 'farLane');
  const byKind = {};
  for (const r of reactions) { const k = `${r.human ? 'player' : 'machine'} ${r.kind}${r.kind === 'strike' ? ' x' + r.size : ''} (${r.source})`; byKind[k] = (byKind[k] || 0) + 1; }
  // every judged ball with a reaction kind has a reaction: early before it, or its own
  let missing = 0, early = 0, earlyLead = [];
  for (const j of judged) {
    if (j.kind === 'none') continue;
    const r = reactions.find((x) => x.lane === j.lane && Math.abs(x.t - j.t) < 8000 && (x.kind === j.kind || x.source === 'early'));
    if (!r) missing++;
  }
  for (const r of reactions.filter((x) => x.source === 'early')) {
    early++;
    const j = judged.find((x) => x.t >= r.t && x.lane === r.lane);
    if (j) earlyLead.push(j.t - r.t);
  }
  if (missing) problems.push(`${label}: ${missing} judged balls without a reaction`);
  // the crash grows with the pins that fall
  const byPins = {};
  for (const b of balls) { const k = b.pinsDown; (byPins[k] = byPins[k] || []).push(b.impacts); }
  const crash = Object.keys(byPins).sort((a, b) => a - b).map((k) => ({ pinsDown: +k, balls: byPins[k].length, impactsMean: +(byPins[k].reduce((a, b) => a + b, 0) / byPins[k].length).toFixed(1) }));
  // the judged kinds agree with the events' exciters
  const humanLouder = (() => {
    const g = (h) => reactions.filter((r) => r.human === h && r.kind === 'strike').length;
    return { playerStrikeReactions: g(true), machineStrikeReactions: g(false) };
  })();
  return { reactions: reactions.length, judged: judged.length, balls: balls.length, farLaneBalls: far.length, byKind, earlyReactions: early,
    earlyLeadMs: earlyLead.length ? { min: Math.min(...earlyLead), median: earlyLead.sort((a, b) => a - b)[Math.floor(earlyLead.length / 2)] } : null, crash, ...humanLouder };
}
report.gameEurAnalysis = analyse(logEur, 'EUR');
console.log('   ', JSON.stringify(report.gameEurAnalysis));
if (!report.gameEurAnalysis.farLaneBalls) problems.push('no far-lane ball was heard');

await js(`app.sound.log.length = 0; window.__events.length = 0; return true;`);
const amr = await playGame('amr', 'open play AMR, 3 bowlers', 420);
const logAmr = await js(`return { log: app.sound.log.slice(), events: window.__events.slice() }`);
report.gameAmr = amr;
report.gameAmrAnalysis = analyse(logAmr, 'AMR');
console.log('   full game AMR:', JSON.stringify(amr));
console.log('   ', JSON.stringify(report.gameAmrAnalysis));
if (!amr.finished) problems.push('the AMR game did not finish');
// what the two games played, by bank: the lane, the machine and the far lanes, the applause, and no voice
const played = await js(`return window.__played`);
report.playedInGames = played;
console.log('   played in the games, by bank:', JSON.stringify(played));
for (const n of VOICE_BANKS) if (played[n]) problems.push(`a voice was played in the games: ${n} x${played[n]}`);
for (const n of ['clack', 'thud', 'ballHit', 'pit', 'cushion', 'newRack', 'farRoll']) if (!played[n]) problems.push(`no ${n} was played in the games`);
if (!Object.keys(played).some((n) => n.startsWith('clap'))) problems.push('no applause was played in the games');
for (const L of [logEur, logAmr]) for (const r of L.log.filter((e) => e.type === 'reaction'))
  if (r.layers.some((b) => VOICE_BANKS.includes(b))) problems.push(`a reaction with a voice: ${r.kind} ${r.layers.join('+')}`);

// ---- 4. each reaction, through the shared game events, with the engine's result ---------------------
// The balls are scored by the game's own engine; the events are emitted exactly as lanegame.js
// emits them after a scored ball. Each reaction is recorded from the output.
await js(`app.show('menu'); return true;`);
await sleep(1500);
const directed = await js(`
  const { startOpenPlay } = await import('./js/engine/openplay.js');
  const ev = window.vikingEvents;
  const pop = (m) => { let n = 0; for (let i = 0; i < 10; i++) if (m & (1 << i)) n++; return n; };
  const ALL = 0x3FF, P = (...p) => p.reduce((m, x) => m | (1 << (x - 1)), 0);
  // the balls of one bowler; returns, per ball, the events lanegame.js would emit
  const bowl = (knocks, human) => {
    const eng = startOpenPlay({ method: 'normal', names: [{ name: 'P' }], american: false, redPinPercent: 0, protocol: 'Standard', laneNumber: 5 });
    let rack = ALL; const out = [];
    for (const k of knocks) {
      const first = eng.nextBallIsFirst(5), before = first ? ALL : rack, after = before & ~k;
      const res = eng.score(5, after, 10 - pop(after), 0, false);
      const b = { lane: 5, player: 'P', index: 0, human, bot: !human };
      const list = [['ball', { ...b, firstBall: res.firstBall, pins: res.ballPins, before, standing: after, exciter: res.exciter, practice: false }]];
      if (res.ballPins === 0 && res.firstBall) list.push(['gutter', { ...b, practice: false }]);
      else if (res.ballPins === 0) list.push(['miss', b]);
      if (res.exciter === 1) list.push(['strike', { ...b, inARow: res.numInARow, redPin: false }]);
      else if (res.exciter === 2 || res.exciter === 7) list.push(['spare', b]);
      else if (res.exciter === 4) list.push(['split', { ...b, standing: after }]);
      out.push(list);
      rack = eng.nextBallIsFirst(5) ? ALL : after;
    }
    return out;
  };
  const cases = [
    ['strike', [ALL], 0, true], ['double', [ALL, ALL], 1, true], ['turkey', [ALL, ALL, ALL], 2, true],
    ['perfect_game', new Array(12).fill(ALL), 11, true], ['spare', [ALL & ~P(10), P(10)], 1, true],
    ['converted_split', [ALL & ~P(7, 10), P(7, 10)], 1, true], ['gutter', [0], 0, true], ['split_left', [ALL & ~P(7, 10)], 0, true],
    ['near_miss_10pin', [ALL & ~P(10)], 0, true], ['near_miss_5pin', [ALL & ~P(5)], 0, true], ['missed_spare', [ALL & ~P(5), 0], 1, true],
    ['machine_strike', [ALL], 0, false], ['machine_turkey', [ALL, ALL, ALL], 2, false], ['machine_gutter', [0], 0, false], ['machine_spare', [ALL & ~P(10), P(10)], 1, false]
  ];
  window.__cases = cases.map(([name, knocks, at, human]) => ({ name, list: bowl(knocks, human)[at] }));
  return window.__cases.map((c) => c.name);`);
const reactionRows = [];
for (const name of directed) {
  await js(`app.sound.log.length = 0; window.__recStart(); const c = window.__cases.find((x) => x.name === ${JSON.stringify(name)}); for (const [type, d] of c.list) window.vikingEvents.emit(type, d); return true;`);
  await sleep(name === 'perfect_game' ? 7500 : 4200);
  const rec = await saveRec('reaction_' + name);
  const log = await js(`return app.sound.log.filter((e) => e.type === 'reaction' || e.type === 'judged')`);
  const r = log.find((e) => e.type === 'reaction');
  reactionRows.push({ case: name, reaction: r ? `${r.kind}${r.kind === 'strike' ? ' x' + r.size : ''}` : 'none', human: r ? r.human : null, layers: r ? r.layers.join('+') : '', played: r ? r.played : false, rms: rec.rms, loudest50ms: rec.loudest50ms, peak: rec.peak });
}
console.log('4. each reaction (recorded from the output, before the limiter):');
console.table(reactionRows);
report.reactions = reactionRows;
const row = (n) => reactionRows.find((r) => r.case === n) || {};
// a bad ball gets no reaction: its reactions were voices only (an "oh", a sigh, an "ooh", an "aww")
const expectKind = { strike: 'strike x1', double: 'strike x2', turkey: 'strike x3', perfect_game: 'strike x5', spare: 'spare', converted_split: 'splitSpare', gutter: 'none', split_left: 'none', near_miss_10pin: 'none', near_miss_5pin: 'none', missed_spare: 'none', machine_strike: 'strike x1', machine_turkey: 'strike x3', machine_gutter: 'none', machine_spare: 'spare' };
for (const [n, k] of Object.entries(expectKind)) {
  if (row(n).reaction !== k) problems.push(`${n}: reaction ${row(n).reaction}, expected ${k}`);
  if (k !== 'none' && !row(n).played) problems.push(`${n}: nothing played`);
  if (k !== 'none' && row(n).layers.split('+').some((b) => VOICE_BANKS.includes(b))) problems.push(`${n}: a voice in the reaction (${row(n).layers})`);
}
// loudness: the loudest 50 ms of the recording (its RMS over 4 s is mostly the hall's room tone)
const loud = (n) => row(n).loudest50ms || 0;
if (!(loud('turkey') > loud('strike'))) problems.push('a turkey is not louder than a strike');
if (!(loud('perfect_game') > loud('turkey'))) problems.push('a perfect game is not louder than a turkey');
if (!(loud('strike') > loud('machine_strike') * 1.5)) problems.push("the player's strike is not clearly louder than a machine player's");
// a bad ball: nothing over the room tone (a voice or applause would be ten times louder than this)
for (const n of ['gutter', 'split_left', 'near_miss_10pin', 'near_miss_5pin', 'missed_spare', 'machine_gutter'])
  if (!(loud(n) < 0.01)) problems.push(`${n}: something was heard over the room tone (loudest 50 ms ${loud(n)})`);
if (!(loud('machine_spare') > 0.01)) problems.push('the quietest reaction (a machine player\'s spare) is not above the 0.01 used for "nothing heard"');
// variety: the same reaction twice is not the same sound
await js(`window.__recStart(); const c = window.__cases.find((x) => x.name === 'strike'); for (const [type, d] of c.list) window.vikingEvents.emit(type, d); return true;`);
await sleep(4200);
const again = await saveRec('reaction_strike_again');
report.strikeAgain = again;
if (Math.abs(again.rms - row('strike').rms) < 1e-4) problems.push('the second strike sounded exactly like the first');

// ---- 5. mute and volume, remembered ------------------------------------------------------------------
await js(`document.querySelectorAll('[data-volume]')[0].value = '30'; document.querySelectorAll('[data-volume]')[0].dispatchEvent(new Event('input', { bubbles: true })); return true;`);
const vol = await js(`return { volume: app.sound.volume, stored: localStorage.getItem('vbg.volume'), other: document.querySelectorAll('[data-volume]')[1].value, master: +app.sound.master.gain.value.toFixed(3) }`);
await js(`app.show('play'); app.syncHud(); return true;`);
await click('#btnSound');
await sleep(700);
const muted = await js(`return { on: app.sound.on, stored: localStorage.getItem('vbg.sound'), state: app.sound.ctx.state, master: app.sound.master.gain.value, icon: document.querySelector('#btnSound').textContent.codePointAt(0).toString(16), title: document.querySelector('#btnSound').title }`);
await js(`app.show('menu'); return true;`);
await send('Page.reload');
await sleep(3500);
const reloaded = await js(`return { on: app.sound.on, volume: app.sound.volume, slider: document.querySelector('[data-volume]').value, probe: window.__probe }`);
await click('#okBtn');
await sleep(800);
const mutedGesture = await js(`return { contexts: window.__probe.contexts.length, starts: window.__probe.starts }`);
await js(`app.show('play'); app.syncHud(); return true;`);
await click('#btnSound');
await sleep(800);
const unmuted = await js(`return { on: app.sound.on, stored: localStorage.getItem('vbg.sound'), contexts: window.__probe.contexts.length, state: app.sound.ctx && app.sound.ctx.state, title: document.querySelector('#btnSound').title }`);
report.controls = { volume: vol, muted, reloaded, mutedGesture, unmuted };
console.log('5. controls:', JSON.stringify(report.controls));
if (vol.volume !== 0.3 || vol.stored !== '0.3' || vol.other !== '30') problems.push('the volume is not set or not remembered');
if (muted.on !== false || muted.stored !== 'false' || muted.master > 0.001) problems.push('mute does not silence');
if (reloaded.on !== false || reloaded.volume !== 0.3 || reloaded.slider !== '30') problems.push('mute or volume not remembered over a reload');
if (mutedGesture.contexts !== 0) problems.push('muted, an AudioContext was created anyway');
if (unmuted.on !== true || unmuted.state !== 'running') problems.push('unmuting does not start the sound');
}

// ---- 6. the frame time, sound on and muted (low detail) ---------------------------------------------
// (the recorder off: its callbacks run on the main thread, and only while the sound runs)
await js(`app.show('menu'); if (window.__recNode) window.__recNode.disconnect(); delete app.sound.play; return true;`);
const fps = {};
for (const on of [true, false]) {
  await js(`app.sound.on = ${on}; return true;`);
  const g = await playGame('eur', on ? 'sound on' : 'muted', 150);
  fps[on ? 'soundOn' : 'muted'] = g;
  await js(`if (app.session) app.quit(); app.show('menu'); return true;`);
  await sleep(500);
}
report.frameTime = fps;
console.log('6. frame time:', JSON.stringify(fps));
await js(`app.sound.on = true; return true;`);

report.problems = problems;
report.warnings = consoleLog;
writeFileSync(join(outDir, `report${mobile ? '_mobile' : ''}${cpu > 1 ? '_cpu' + cpu : ''}${QUICK ? '_quick' : ''}.json`), JSON.stringify(report, null, 2));
console.log(problems.length ? `\n${problems.length} PROBLEM(S):\n  ` + [...new Set(problems)].join('\n  ') : '\nNo problems.');
if (consoleLog.length) console.log('Warnings:\n  ' + [...new Set(consoleLog)].join('\n  '));
ws.close();
proc.kill();
process.exit(problems.length ? 1 : 0);

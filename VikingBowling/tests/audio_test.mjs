// The sound test, in node (no browser).
//   node tests/audio_test.mjs [outDir]
// 1. Renders every sound of js/audio/synth.js, checks it (no NaN, no clipping, no DC, the right
//    length and band) and, with outDir, writes each as a WAV file to listen to. There are no human
//    voices: no voice synthesis is exported and no reaction uses anything but applause and whistles.
// 2. Plays balls through the game's own OpenPlay engine and checks that the reactions of
//    js/audio/reactions.js follow them: a strike, a double, a turkey, a perfect game, a spare, a
//    converted split; no reaction to a gutter ball, a split, a near miss or a missed spare (the
//    people have no voices); the human louder than a machine player; and that the
//    strikes-in-a-row guess made before a ball matches the engine.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as S from '../js/audio/synth.js';
import { classify, earlyClassify, plan, upgrade, strikeStreak, flashFor } from '../js/audio/reactions.js';
import { startOpenPlay, globCheckSplit } from '../js/engine/openplay.js';

const outDir = process.argv[2] || null;
if (outDir) mkdirSync(outDir, { recursive: true });
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };

function wav(buf) {
  const n = buf.ch[0].length, c = buf.ch.length, data = Buffer.alloc(44 + n * c * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * c * 2, 4); data.write('WAVE', 8); data.write('fmt ', 12);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(c, 22); data.writeUInt32LE(buf.sr, 24);
  data.writeUInt32LE(buf.sr * c * 2, 28); data.writeUInt16LE(c * 2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * c * 2, 40);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf.ch[k][i] * 32767))), 44 + (i * c + k) * 2);
  return data;
}

// The spectral centroid (Hz) of the loudest second, by FFT
function centroid(buf) {
  const d = buf.ch[0], N = 4096;
  let best = 0, at = 0;
  for (let s = 0; s + N <= d.length; s += N / 2) { let e = 0; for (let i = s; i < s + N; i++) e += d[i] * d[i]; if (e > best) { best = e; at = s; } }
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (d[at + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k), xr = re[i + k + len / 2], xi = im[i + k + len / 2];
      const tr = xr * wr - xi * wi, ti = xr * wi + xi * wr;
      re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti; re[i + k] += tr; im[i + k] += ti;
    }
  }
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * buf.sr / N; den += m; }
  return den ? num / den : 0;
}

function check(name, buf, band, minPeak = 0.05) {
  const n = buf.ch[0].length;
  let peak = 0, sum = 0, e = 0, bad = 0;
  for (const c of buf.ch) for (let i = 0; i < n; i++) { const v = c[i]; if (!Number.isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); sum += v; e += v * v; }
  const rms = Math.sqrt(e / (n * buf.ch.length)), dc = Math.abs(sum / (n * buf.ch.length)), cen = centroid(buf);
  const row = { name, s: +(n / buf.sr).toFixed(2), sr: buf.sr, ch: buf.ch.length, peak: +peak.toFixed(3), rms: +rms.toFixed(3), dc: +dc.toFixed(4), centroidHz: Math.round(cen) };
  if (bad) fail(`${name}: ${bad} samples not finite`);
  if (peak > 0.99) fail(`${name}: clips (peak ${peak})`);
  if (peak < minPeak) fail(`${name}: silent (peak ${peak})`);
  if (dc > 0.01) fail(`${name}: DC ${dc}`);
  if (band && (cen < band[0] || cen > band[1])) fail(`${name}: centroid ${Math.round(cen)} Hz outside ${band}`);
  if (outDir) writeFileSync(join(outDir, name + '.wav'), wav(buf));
  return row;
}

// ---- 1. the sounds ----------------------------------------------------------------------------------
console.log('1. Rendering every sound');
const rows = [];
const time = (fn) => { const t0 = performance.now(); const r = fn(); return [r, performance.now() - t0]; };
const BAND = {
  // the band each sound's energy should sit in (spectral centroid, Hz)
  whistle: [1800, 4000], roomTone: [300, 1800],     // (a one-pole lowpass: its 6 dB/octave tail lifts the centroid)
  clapS: [900, 3200], clapM: [900, 3200], clapL: [800, 3200], clapXL: [700, 3200],
  clack: [800, 4000], ballHit: [400, 3500], thud: [150, 1500], kick: [150, 1500], pit: [60, 800], cushion: [40, 500], drop: [60, 900], ballClack: [900, 4000], clunk: [150, 1800]
};
{ const [b, ms] = time(() => S.renderWhistle(101)); rows.push({ ...check('whistle', b, BAND.whistle), ms: Math.round(ms) }); }
for (const k of S.APPLAUSE_SIZES) { const [b, ms] = time(() => S.renderApplause(k, 202)); rows.push({ ...check('applause_' + k, b, BAND[k]), ms: Math.round(ms) }); }
for (const k of S.IMPACT_TYPES) { const [b, ms] = time(() => S.renderImpact(k, 303)); rows.push({ ...check('impact_' + k, b, BAND[k]), ms: Math.round(ms) }); }
for (const [name, fn] of [
  ['roll_texture', () => S.renderRollTexture(11)], ['pinsetter_newRack', () => S.renderPinsetter('newRack', 404)],
  ['pinsetter_respot', () => S.renderPinsetter('respot', 405)], ['ball_return', () => S.renderBallReturn(406)],
  ['bumper_up', () => S.renderBumper(true, 407)], ['bumper_down', () => S.renderBumper(false, 408)],
  ['chime_up', () => S.renderChime(true)], ['chime_down', () => S.renderChime(false)], ['far_roll', () => S.renderFarRoll(409)],
  ['far_crash_10', () => S.renderFarCrash(10, 410)], ['far_crash_6', () => S.renderFarCrash(6, 411)], ['far_crash_2', () => S.renderFarCrash(2, 412)],
  ['reverb_ir', () => S.renderImpulse(48000, 1.6, 1.4, 7)]
]) { const [b, ms] = time(fn); rows.push({ ...check(name, b), ms: Math.round(ms) }); }
// the hall's room tone: the ventilation, far below everything else (about -44 dBFS RMS)
const roomBuf = S.renderRoomTone(99);
const roomRow = check('room_tone', roomBuf, BAND.roomTone, 0.005);
rows.push(roomRow);
console.table(rows);
if (!(roomRow.rms > 0.003 && roomRow.rms < 0.012)) fail(`the room tone's level is ${roomRow.rms} RMS, expected about 0.006`);
{ // a seamless loop: the jump from the last sample to the first is no bigger than one between neighbours
  const d = roomBuf.ch[0], n = d.length;
  let step = 0; for (let i = 1; i < n; i++) step = Math.max(step, Math.abs(d[i] - d[i - 1]));
  if (Math.abs(d[0] - d[n - 1]) > step * 1.5) fail('the room tone loop clicks at its seam');
}
// a variant made with another seed is another sound
const a = S.renderApplause('clapM', 1).ch[0], b = S.renderApplause('clapM', 2).ch[0];
let diff = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) diff += Math.abs(a[i] - b[i]);
if (diff < 10) fail('two seeds give the same applause');
// no human voices: no voice synthesis is left, and no reaction plays anything but applause and whistles
for (const name of ['voice', 'renderCrowd', 'crowdJob', 'CROWD_KINDS', 'murmurJob']) if (name in S) fail(`synth.js still exports ${name} (a human voice)`);
{
  const PEOPLE = new Set([...S.APPLAUSE_SIZES, 'whistle']);
  for (const kind of ['strike', 'spare', 'splitSpare', 'gutter', 'split', 'nearMiss', 'miss'])
    for (const size of [1, 2, 3, 4, 5]) for (const human of [true, false])
      for (const l of plan({ kind, family: kind === 'strike' ? 'strike' : kind.includes('pare') ? 'spare' : 'bad', size }, human))
        if (!PEOPLE.has(l.bank)) fail(`${kind}/${size}: the reaction plays ${l.bank}, not applause or a whistle`);
}
// a bigger crash on another lane is louder
const loud = (buf) => { let e = 0; for (const v of buf.ch[0]) e += v * v; return e; };
if (!(loud(S.renderFarCrash(10, 5)) > loud(S.renderFarCrash(2, 5)))) fail('a far strike is not louder than two pins');

// ---- 2. the reactions, through the engine ---------------------------------------------------------
console.log('\n2. Reactions to balls played through the OpenPlay engine');
// Bowl a list of balls (the pins knocked down by each) for one bowler and return what the shared
// game events will carry for each ball, as lanegame.js emits them (js/game/events.js: 'ball'
// with exciter, firstBall, before, standing; 'strike' with inARow and redPin)
function bowl(knocks, { method = 'normal', human = true } = {}) {
  const eng = startOpenPlay({ method, names: [{ name: 'P' }], american: false, redPinPercent: 0, protocol: 'Standard', laneNumber: 5 });
  const out = [];
  let rack = 0x3FF;
  for (const knock of knocks) {
    const a = eng.activeOn(5);
    if (!a) break;
    const first = eng.nextBallIsFirst(5);
    const before = first ? 0x3FF : rack;
    const streak = strikeStreak(a.player);
    const after = before & ~knock;
    const res = eng.score(5, after, 10 - popcount(after), 0, false);
    const ev = { exciter: res.exciter, firstBall: res.firstBall, before, standing: after, human, practice: false, inARow: res.numInARow, redPin: res.redPinStrike, kinds: new Set() };
    out.push({ ev, res, streak, first, before, after });
    rack = eng.nextBallIsFirst(5) ? 0x3FF : after;
  }
  return out;
}
function popcount(m) { let n = 0; for (let i = 0; i < 10; i++) if (m & (1 << i)) n++; return n; }
const ALL = 0x3FF, P = (...pins) => pins.reduce((m, p) => m | (1 << (p - 1)), 0);
const cases = [];
function expect(label, ball, kind, size, human = true) {
  const r = classify(ball.ev);
  const ok = r.kind === kind && (size == null || r.size === size);
  const layers = plan(r, human).map((l) => `${l.bank}@${l.gain}`).join(' ');
  cases.push({ case: label, kind: r.kind, size: r.size, layers, ok: ok ? 'ok' : 'FAIL' });
  if (!ok) fail(`${label}: got ${r.kind}/${r.size}, expected ${kind}/${size}`);
  return r;
}
{
  const g = bowl([ALL, ALL, ALL, ALL, ALL]);
  expect('strike', g[0], 'strike', 1); expect('double', g[1], 'strike', 2); expect('turkey', g[2], 'strike', 3); expect('four-bagger', g[3], 'strike', 4);
}
{
  const g = bowl(new Array(12).fill(ALL));
  expect('perfect game (12th strike)', g[11], 'strike', 5);
  expect('11th strike', g[10], 'strike', 4);
}
{
  const g = bowl([ALL & ~P(10), P(10)]);          // a 9 with the 10 pin left, then the spare
  expect('near miss: 10 pin left (no reaction)', g[0], 'none'); expect('spare', g[1], 'spare', 1);
}
{
  const g = bowl([ALL & ~P(5), 0]);              // the 5 pin left, then missed
  expect('near miss: 5 pin left (no reaction)', g[0], 'none'); expect('missed spare (no reaction)', g[1], 'none');
}
{
  const g = bowl([ALL & ~P(7, 10), P(7, 10)]);     // the 7-10 split, converted
  expect('split left (7-10, no reaction)', g[0], 'none'); expect('converted split', g[1], 'splitSpare', 2);
  if (!globCheckSplit(P(7, 10))) fail('7-10 is not a split for the engine');
}
{
  const g = bowl([0, ALL]);                        // a gutter ball, then all ten: a spare
  expect('gutter ball (no reaction)', g[0], 'none'); expect('ten on the second ball', g[1], 'spare', 1);
}
{
  const g = bowl([ALL & ~P(4, 7), P(4)]);          // 4-7 left, only the 4 taken: one pin of two left
  expect('near miss on a spare (7 left of 4-7, no reaction)', g[1], 'none');
}
{
  const g = bowl([P(1, 3, 5, 6, 9, 10), P(2)]);     // an ordinary open frame: 2-4-7-8 left, then the 2
  expect('open frame, 6 then 1', g[0], 'none'); expect('open frame second ball', g[1], 'none');
}
{
  const g = bowl([ALL & ~P(10)], { method: 'notap9' });
  expect('No Tap 9: nine is a strike', g[0], 'strike', 1);
}
{
  const g = bowl([ALL, ALL, ALL], { human: false });
  expect('machine player turkey', g[2], 'strike', 3, false);
}
console.table(cases);

// the human's reaction is louder and bigger than a machine player's
const sum = (L) => L.reduce((s, l) => s + l.gain, 0);
for (const kind of ['strike', 'spare', 'splitSpare']) {
  for (const size of kind === 'strike' ? [1, 2, 3, 4, 5] : [1]) {
    const r = { kind, family: kind === 'strike' ? 'strike' : kind.includes('pare') ? 'spare' : 'bad', size };
    const h = plan(r, true), m = plan(r, false);
    if (!(sum(h) > sum(m))) fail(`${kind}/${size}: the human's reaction is not louder than a machine player's`);
    if (Math.max(...m.map((l) => l.gain)) > 0.6) fail(`${kind}/${size}: a machine player's layer is louder than 0.6`);
  }
}
for (let s = 1; s < 5; s++) {
  const a1 = sum(plan({ kind: 'strike', size: s }, true)), a2 = sum(plan({ kind: 'strike', size: s + 1 }, true));
  if (!(a2 > a1)) fail(`strike size ${s + 1} is not bigger than ${s}`);
}
// an early guess that grows into a turkey adds the turkey's layers
const up = upgrade({ kind: 'strike', family: 'strike', size: 1 }, { kind: 'strike', family: 'strike', size: 3 }, true);
if (!up.some((l) => l.bank === 'whistle')) fail('the upgrade from a strike to a turkey adds no whistle');
if (!flashFor({ kind: 'strike', size: 3 }, true) || flashFor({ kind: 'strike', size: 3 }, false)) fail('the lane lights flash wrongly');
// early: every pin down on a full rack is a strike of the guessed streak; a gutter on a leave is a miss
if (earlyClassify({ before: ALL, streak: 2 }, 'allDown').size !== 3) fail('early turkey guess');
if (earlyClassify({ before: P(7, 10) }, 'allDown', true).kind !== 'splitSpare') fail('early converted split');
if (earlyClassify({ before: P(3) }, 'gutter').kind !== 'none') fail('a ball in the gutter is still judged early (the people have no voice to groan with)');

// ---- 3. the strikes-in-a-row guess before a ball, against the engine ------------------------------
console.log('\n3. The strikes-in-a-row guess (before the ball) against the engine (after it)');
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let strikes = 0, agree = 0;
for (const method of ['normal', 'tenth', 'short3', 'notap9', 'mini']) {
  for (let gme = 0; gme < 400; gme++) {
    const knocks = [];
    for (let i = 0; i < 24; i++) knocks.push(rnd() < 0.55 ? ALL : Math.floor(rnd() * 1024));
    for (const b of bowl(knocks, { method })) {
      if (b.res.exciter !== 1) continue;
      strikes++;
      const guess = earlyClassify({ before: b.before, streak: b.streak }, 'allDown');
      const truth = classify(b.ev);
      if (b.after === 0 && b.before === ALL) { if (guess.size === truth.size) agree++; } else agree++;   // a No Tap / Mini strike is not guessed early
    }
  }
}
console.log(`  ${strikes} strikes: the early size matches the engine's in ${agree} (${(100 * agree / strikes).toFixed(2)} %)`);
if (agree / strikes < 0.99) fail('the strikes-in-a-row guess disagrees with the engine too often');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll audio checks passed.');
process.exit(failures ? 1 : 0);

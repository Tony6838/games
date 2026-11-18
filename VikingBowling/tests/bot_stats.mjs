// Machine-player statistics test.
//   node tests/bot_stats.mjs [gamesPerLevel=20000] [seed=1]
// Plays many games per skill level through the game's own OpenPlay engine and compares the
// average, strike rate, spare rate, open-frame rate, split rate and first-ball average with
// the published figures the bots are built from (README.md, "Machine players").
import { startOpenPlay, globCheckSplit } from '../js/engine/openplay.js';
import { MachinePlayer } from '../js/ai/bots.js';
import { gameTotal } from '../js/engine/bowlingscore.js';

const N = parseInt(process.argv[2] || '20000', 10);
let seed = parseInt(process.argv[3] || '1', 10) >>> 0;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pop = (m) => { let n = 0; for (let i = 0; i < 10; i++) if (m & (1 << i)) n++; return n; };

// target: [avg, strike %, spare %, open %, splits per frame %, first-ball avg] - published (P) or derived
const TARGETS = [
  [100, 10, 22, 70, 8, null],             // E (extrapolated below the published range)
  [130, 18, 36, 52, 8, 7.4],              // P [3] teams averaging 126-137
  [150, 24.7, 47.8, 39.3, 9.7, 8.1],      // P [3]
  [170, 33.3, 58.2, 27.8, 9.9, 8.5],      // P [3]
  [190, 42.9, 66.4, 19.2, 9.4, 8.85],     // P [3]
  [200, 48.8, 70.1, 15.3, 8.6, 9.0],      // P [3]
  [210, 53.1, 73.4, 12.5, 8.1, 9.1],      // P [3]
  [220, 60.2, 80, 8.1, 8, null]           // P [4]
];

const rows = [];
let failures = 0;
for (const t of TARGETS) {
  const avg = t[0];
  const bot = new MachinePlayer({ name: 'Bot', average: avg, rng });
  let pins = 0, frames = 0, strikes = 0, spareChances = 0, spares = 0, opens = 0, splits = 0, firstPins = 0, firsts = 0;
  for (let g = 0; g < N; g++) {
    const game = startOpenPlay({ method: 'normal', names: [{ name: 'Bot' }], rng: () => 0.99, clock: () => 0 });
    let standing = 0x3FF, kind = null;
    for (let guard = 0; guard < 30; guard++) {
      const a = game.activeOn(1);
      if (!a) break;
      const first = game.nextBallIsFirst(1);
      let after;
      if (first) { const f = bot.firstBall(); after = f.standing; kind = f.kind; }
      else after = bot.secondBall(standing, kind);
      const res = game.score(1, after, 10 - pop(after), 0, false);
      standing = after;
      if (!res) break;
      if (res.gameFinished) break;
    }
    const P = game.lanes[0].player[0];
    pins += gameTotal(P.score);
    // frame statistics from the score sheet itself
    for (let f = 0; f < 10; f++) {
      const b1 = P.score[f * 2], b2 = P.score[f * 2 + 1];
      frames++;
      firsts++; firstPins += b1;
      if (b1 === 10) { strikes++; continue; }
      spareChances++;
      if (P.status[f * 2] & 1) splits++;
      if (b1 + b2 === 10) spares++; else opens++;
    }
  }
  const r = {
    avg, games: N,
    average: pins / N, strike: 100 * strikes / frames, spare: 100 * spares / spareChances,
    open: 100 * opens / frames, split: 100 * splits / frames, firstBall: firstPins / firsts
  };
  const formula = 166 + 102 * (r.strike / 100) - 104 * (r.open / 100);   // fit over [3], see README
  const checks = [
    ['average', r.average, avg, 6],
    ['strike %', r.strike, t[1], 1.5],
    ['spare %', r.spare, t[2], 4],
    ['open %', r.open, t[3], 4],
    ['splits/frame %', r.split, t[4], 2.0]
  ];
  if (t[5] !== null) checks.push(['first-ball avg', r.firstBall, t[5], 0.35]);
  const bad = checks.filter(([, v, want, tol]) => Math.abs(v - want) > tol);
  failures += bad.length;
  rows.push({ r, t, formula, bad });
}

console.log(`${N} games per level, seed ${process.argv[3] || 1}`);
console.log('');
console.log('| Level (avg) | Average | Strike % (target) | Spare % (target) | Open % (target) | Splits/frame % (target) | First ball (target) | Result |');
console.log('|---|---|---|---|---|---|---|---|');
for (const { r, t, bad } of rows) {
  const f = (v, d = 1) => v.toFixed(d);
  console.log(`| ${r.avg} | ${f(r.average)} | ${f(r.strike)} (${t[1]}) | ${f(r.spare)} (${t[2]}) | ${f(r.open)} (${t[3]}) | ${f(r.split)} (${t[4]}) | ${f(r.firstBall, 2)} (${t[5] ?? '-'}) | ${bad.length ? 'OFF: ' + bad.map((b) => b[0]).join(', ') : 'ok'} |`);
}
console.log('');
console.log(failures ? `${failures} figures outside tolerance` : 'All figures within tolerance');
process.exitCode = failures ? 1 : 0;

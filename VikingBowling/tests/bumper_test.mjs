// Bumpers: node tests/bumper_test.mjs [throws=120]
//   1. physics: balls released at the gutters (both sides, hook and no hook, slow and fast) -
//      with the bumpers up none ends in the gutter and the pins fall from the deflected ball;
//      the same balls with the bumpers down go into the gutter (the test is not vacuous);
//   2. the machine players' statistics with bumpers: no gutter ball in 20,000 first balls at
//      the lowest levels (80, 100), and the same draws as before without bumpers;
//   3. the bumper mark (+C) as Viking reads it (CProtocol::IsBowlerUsingBumper) and players.json's
//      "bump", and the console's PlusC / plusCCC spelling turned back into +C.
import { LanePhysics, LANE, BUMPER } from '../js/sim3d/physics.js';
import { MachinePlayer } from '../js/ai/bots.js';
import { usesBumpers, withoutBumperMark, playersJson, changePlayersInfo } from '../js/engine/correction.js';
import { startOpenPlay, makePlayer } from '../js/engine/openplay.js';

const N = parseInt(process.argv[2] || '120', 10);
let seed = 4711;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.log('FAIL', what); } return ok; };
const countPins = (m) => { let n = 0; for (let i = 0; i < 10; i++) if (m & (1 << i)) n++; return n; };

// ---- 1. physics -------------------------------------------------------------------------------
const lane = new LanePhysics();
let bumps = 0;
lane.onBumper = () => { bumps++; };
function throwAll(up) {
  seed = 4711;
  lane.setBumpers(up);
  const out = { gutter: 0, pinsDown: 0, someDown: 0, maxX: 0, hits: 0 };
  for (let k = 0; k < N; k++) {
    const side = k % 2 ? 1 : -1;
    const speed = 3.5 + rnd() * 5;
    const params = { x0: side * (0.15 + rnd() * 0.25), speed, angle: side * (0.012 + rnd() * 0.05),
      side: (rnd() < 0.5 ? 0 : (rnd() - 0.5) * 40), roll: 0.3 + rnd() * 0.4 };
    lane.resetPins(0x3FF);
    const before = bumps;          // (each release starts the bumper-hit clock again: physics.js launch)
    lane.release(params);
    let guard = 0;
    while (lane.state !== 'done' && guard++ < 3000) {
      lane.step(1 / 60);
      if (lane.state === 'rolling') out.maxX = Math.max(out.maxX, Math.abs(lane.ball.position.x - lane.laneX));
    }
    if (lane.inGutter) out.gutter++;
    const down = 10 - countPins(lane.standingMask());
    out.pinsDown += down;
    if (down > 0) out.someDown++;
    if (bumps > before) out.hits++;
  }
  return out;
}
const t0 = Date.now();
const up = throwAll(true), down = throwAll(false);
console.log('| bumpers | throws | in the gutter | balls that touched a bumper | balls that took pins | pins per ball | widest ball centre (m) |');
console.log('|---|---|---|---|---|---|---|');
console.log(`| up | ${N} | ${up.gutter} | ${up.hits} | ${up.someDown} | ${(up.pinsDown / N).toFixed(2)} | ${up.maxX.toFixed(3)} |`);
console.log(`| down | ${N} | ${down.gutter} | ${down.hits} | ${down.someDown} | ${(down.pinsDown / N).toFixed(2)} | ${down.maxX.toFixed(3)} |`);
check(up.gutter === 0, 'no gutter ball with the bumpers up');
check(up.maxX < BUMPER.face - LANE.ballRadius + 0.01, 'the ball stays inside the bumpers');
check(up.hits > N * 0.5, 'most of these balls meet a bumper');
check(up.someDown > N * 0.8, 'the deflected balls take pins');
check(down.gutter > N * 0.5, 'without bumpers the same balls go into the gutter');
check(down.hits === 0, 'a lowered bumper is not touched');
console.log(`(physics ${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// ---- 1b. a ball's bumper hit is heard on every ball ----------------------------------------------
// Two balls in a row into the same rail: the second ball's hit (early in its roll) must be reported
// although the first ball's last hit came later in its own roll (the hit clock starts again at the release)
{
  const l2 = new LanePhysics();
  l2.setBumpers(true);
  const hits = [];
  l2.onBumper = () => hits.push(l2.time);
  const ball = { x0: 0.2, speed: 4, angle: 0.06, side: 0, roll: 0.5 };
  const firsts = [];
  for (let k = 0; k < 2; k++) {
    l2.resetPins(0x3FF);
    const n0 = hits.length;
    l2.release(ball);
    let g = 0;
    while (l2.state !== 'done' && g++ < 3000) l2.step(1 / 60);
    firsts.push(hits.length > n0 ? hits[n0] : null);
  }
  console.log(`two balls into the rail: first hit at ${firsts.map((v) => (v === null ? 'none' : v.toFixed(2) + ' s')).join(' and ')}`);
  check(firsts[0] !== null && firsts[1] !== null && Math.abs(firsts[0] - firsts[1]) < 0.05, "the second ball's bumper hit is reported as the first one's was");
}

// ---- 1c. a slow ball with the bumpers up reaches the pins ----------------------------------------
// The slowest balls a throw gives (3.3 m/s and a little more) at the rails: going from
// rail to rail they can take over 9 s to the pins. None may be ended short of the pins while it
// still rolls forward; a ball ends short only when it has really stopped.
{
  const l3 = new LanePhysics();
  l3.setBumpers(true);
  let s3 = 909;
  const r3 = () => { s3 = (s3 * 1664525 + 1013904223) >>> 0; return s3 / 4294967296; };
  const res = { reached: 0, stopped: 0, short: 0, longest: 0, pins: 0 };
  for (let k = 0; k < N; k++) {
    const side = k % 2 ? 1 : -1;
    l3.resetPins(0x3FF);
    l3.release({ x0: side * (0.05 + r3() * 0.3), speed: 3.3 + r3() * 0.9, angle: side * (0.01 + r3() * 0.06),
      side: r3() < 0.5 ? 0 : (r3() - 0.5) * 30, roll: 0.3 + r3() * 0.4 });
    let g = 0, z = null, v = null, at = 0;
    while (l3.state !== 'done' && g++ < 3600) {
      const was = l3.state;
      l3.step(1 / 60);
      if (was === 'rolling' && l3.state !== 'rolling') { z = l3.ball.position.z; v = Math.hypot(l3.ball.velocity.x, l3.ball.velocity.z); at = l3.time; }
    }
    if (z !== null && z < -LANE.headPin + 0.26) { res.reached++; res.longest = Math.max(res.longest, at); res.pins += 10 - countPins(l3.standingMask()); }
    else if (v !== null && v < 0.1) res.stopped++;
    else res.short++;
  }
  console.log(`slow balls (3.3-4.2 m/s) at the rails, bumpers up: ${res.reached} of ${N} reached the pins (the longest after ${res.longest.toFixed(1)} s, ${(res.pins / Math.max(1, res.reached)).toFixed(1)} pins a ball), ${res.stopped} stopped on the lane, ${res.short} ended short while rolling`);
  check(res.short === 0, 'no slow bumper ball is ended short of the pins while it still rolls forward');
  check(res.reached === N, 'every slow bumper ball reaches the pins');
  // and a ball that does not move forward any more (it crawls at 3 cm/s, slower than any throw) is
  // ended where it is, after half a second
  l3.resetPins(0x3FF);
  l3.release({ x0: 0, speed: 0.03, angle: 0, side: 0, roll: 1 });
  let g = 0;
  while (l3.state === 'rolling' && g++ < 3600) l3.step(1 / 60);
  const zs = l3.ball.position.z, vs = Math.hypot(l3.ball.velocity.x, l3.ball.velocity.z);
  console.log(`a ball crawling at 3 cm/s: ended at z ${zs.toFixed(2)} m after ${l3.time.toFixed(1)} s, speed ${vs.toFixed(3)} m/s`);
  check(l3.state === 'deck' && zs > -1 && vs < 0.1 && l3.time < 1.5, 'a ball that has stopped moving forward on the lane is ended there');
}

// ---- 2. machine players -----------------------------------------------------------------------
for (const avg of [80, 100, 130]) {
  let s = 99;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const bot = new MachinePlayer({ name: 'Child', average: avg, rng: r });
  bot.bumpers = true;
  let gutters = 0, bumperBalls = 0, missAll = 0;
  for (let i = 0; i < 20000; i++) {
    const f = bot.firstBall();
    if (f.standing === 0x3FF) gutters++;
    if (f.kind === 'bumper') bumperBalls++;
    const second = bot.secondBall(f.standing, f.kind);
    if (f.standing && second === f.standing && countPins(f.standing) > 1) missAll++;
  }
  console.log(`average ${avg} with bumpers: ${gutters} gutter first balls, ${bumperBalls} bumper balls in 20000`);
  check(gutters === 0, `no gutter first ball at ${avg} with bumpers`);
  if (avg <= 100) check(bumperBalls > 1000, `the would-be gutter balls come off a bumper at ${avg}`);
  // without bumpers the draws are what they always were (bot_stats.mjs pins the rates)
  let s1 = 5, s2 = 5;
  const a = new MachinePlayer({ name: 'A', average: avg, rng: () => { s1 = (s1 * 1664525 + 1013904223) >>> 0; return s1 / 4294967296; } });
  const b = new MachinePlayer({ name: 'B', average: avg, rng: () => { s2 = (s2 * 1664525 + 1013904223) >>> 0; return s2 / 4294967296; } });
  b.bumpers = false;
  let same = true;
  for (let i = 0; i < 2000; i++) { const x = a.firstBall(), y = b.firstBall(); if (x.standing !== y.standing) same = false; }
  check(same, 'bumpers false draws as before');
}

// ---- 3. the mark ----------------------------------------------------------------------------
check(usesBumpers('Eva+c') && usesBumpers('Eva+C') && !usesBumpers('Eva') && !usesBumpers('+') && !usesBumpers('C+C+'), 'IsBowlerUsingBumper');
check(withoutBumperMark('Eva+C') === 'Eva', 'the mark is not shown');
const eng = startOpenPlay({ method: 'normal', names: [{ name: 'Kalle+C' }, { name: 'Lisa' }], laneNumber: 5 });
const pj = playersJson(eng.getPlayerInfoStruct(5), 5);
check(pj.players[0].bump === '1' && pj.players[0].name === 'Kalle' && pj.players[1].bump === '0', 'players.json bump and name');
// the console's "Ändra spelare": Lisa gets bumpers (PlusC), Kalle loses them
const r = changePlayersInfo(eng, 5, { player0Name: 'Kalle', player0ID: '0', player1Name: 'LisaPlusC', player1ID: '1', activePlayer: '0', game: '0', seen: '0,1' }, makePlayer);
const pis = eng.getPlayerInfoStruct(5);
check(r.response.success === 'true' && pis.player[0].playerName === 'Kalle' && pis.player[1].playerName === 'Lisa+C', 'changePlayersInfo sets and clears the mark');

console.log(failures ? `${failures} bumper check(s) failed` : 'All bumper checks passed');
process.exit(failures ? 1 : 0);

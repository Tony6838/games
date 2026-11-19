// The warm-up (inspelning), as OpenPlay plays it: node tests/warmup_test.mjs
//   balls   (GCI_PRACTICE_BALLS, TestBalls_Score): nothing is written on the sheet, every ball passes
//           the turn, after noPlayers x amount balls the serie starts on its first ball
//   frames  (GCI_PRACTICE_FRAMES, TestFrames_Score): the practice balls are on the sheet while the
//           frame is played, wiped when the turn has gone round, one frame counted per round
//   minutes (GCI_PRACTICE_MINUTES): frames as above until the clock is out, then the stop picture
//           (GCI_PracticeOver) and the serie (TestFrames_UpdateClock)
//   End practice on the console (LoadCom's EndPracticeOnLaneData), EUR and an American pair
// and, for each, that a game bowled after a warm-up scores exactly as the same balls without one.
import { startOpenPlay, GCI } from '../js/engine/openplay.js';
import { gameTotal } from '../js/engine/bowlingscore.js';

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.log('FAIL', what); } return ok; };
let seed = 2026;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const count = (m) => { let n = 0; for (let i = 0; i < 10; i++) if (m & (1 << i)) n++; return n; };

function start(method, amount, opts = {}) {
  const names = (opts.names || ['A', 'B', 'C']).map((name) => ({ name }));
  let now = 1_800_000_000_000;
  const clock = () => now;
  // the lanes as a start with practice writes them (practiceMethod, practiceAmount), then StartGame
  const eng = startOpenPlay({ method: opts.game || 'normal', names, american: !!opts.american, laneNumber: 5, clock,
    _pre: true });
  return { eng, setNow: (t) => { now = t; }, getNow: () => now, method, amount };
}
// startOpenPlay starts the game at once; a warm-up is set on the lanes first, as LoadCom's start
// carries it in the lane file, and StartGame (practiceInit) runs again with it
function withPractice(method, amount, opts = {}) {
  const s = start(method, amount, opts);
  const eng = s.eng;
  for (const pis of eng.lanes) {
    pis.practiceMethod = method; pis.practiceAmount = amount;
    for (let i = 0; i < pis.noPlayers; i++) { pis.player[i].activeSquare = 0; pis.player[i].score.fill(0); }
    pis.laneStatus = GCI.Gameplay;
    pis.activePlayer = pis.noPlayers ? (eng.isCrosslane() && pis === eng.lanes[1] ? 8 : 0) : -1;
    pis.isAnyPlayerActive = pis.noPlayers ? 1 : 0;
  }
  eng.startGame();
  return s;
}
// one ball on the lane that is up (the pair taking turns in American play)
function bowl(eng, rack, turn) {
  const lanes = eng.lanes.map((l) => l.laneNumber);
  const order = lanes.length > 1 ? [turn.n, lanes.find((n) => n !== turn.n)] : lanes;
  const lane = order.find((n) => eng.activeOn(n));
  if (!lane) return null;
  if (lanes.length > 1) turn.n = lanes.find((n) => n !== lane);
  const first = eng.nextBallIsFirst(lane);
  const before = first ? 0x3FF : rack.get(lane);
  let after = before;
  for (let i = 0; i < 10; i++) if ((before & (1 << i)) && rnd() < 0.55) after &= ~(1 << i);
  const res = eng.scoreBall(lane, after, 10 - count(after), 0, false);
  rack.set(lane, eng.nextBallIsFirst(lane) ? 0x3FF : after);
  return res;
}
function playOut(eng, guard = 600) {
  const rack = new Map(eng.lanes.map((l) => [l.laneNumber, 0x3FF])), turn = { n: eng.lanes[0].laneNumber };
  const log = [];
  for (let i = 0; i < guard; i++) { const r = bowl(eng, rack, turn); if (!r) break; log.push(r); }
  return log;
}
const sheet = (eng) => eng.lanes.map((pis) => Array.from({ length: pis.noPlayers }, (_, i) => pis.player[i].score.join(',') + '|' + pis.player[i].activeSquare).join(' ')).join(' / ');
const totals = (eng) => eng.lanes.flatMap((pis) => Array.from({ length: pis.noPlayers }, (_, i) => gameTotal(pis.player[i].score)));

// ---- balls -----------------------------------------------------------------------------------
{
  const { eng } = withPractice(GCI.PRACTICE_BALLS, 2);
  const pis = eng.lanes[0];
  check(pis.laneStatus === GCI.Practice && eng.isWarmUp(5), 'balls: the lane is in practice');
  const rack = new Map([[5, 0x3FF]]), turn = { n: 5 };
  const order = [];
  for (let b = 0; b < 6; b++) {
    order.push(pis.activePlayer);
    check(eng.practiceLeft(5).left === 6 - b, 'balls: balls left ' + (6 - b));
    const r = bowl(eng, rack, turn);
    check(r && r.practice, 'balls: a practice ball');
    if (b < 5) check(pis.player.slice(0, 3).every((p) => p.score.every((v) => v === 0) && p.activeSquare === 0), 'balls: nothing on the sheet');
  }
  check(order.join('') === '012012', 'balls: every ball passes the turn (' + order.join('') + ')');
  check(pis.practiceMethod === GCI.PRACTICE_NONE && pis.laneStatus === GCI.Gameplay && pis.activePlayer === 0, 'balls: after 3 x 2 balls the serie starts');
  check(!eng.isWarmUp(5), 'balls: warm-up over');
}

// ---- frames ------------------------------------------------------------------------------------
{
  const { eng } = withPractice(GCI.PRACTICE_FRAMES, 2, { names: ['A', 'B'] });
  const pis = eng.lanes[0];
  const rack = new Map([[5, 0x3FF]]), turn = { n: 5 };
  let sawOnSheet = false, rounds = 0, guard = 0;
  while (eng.isWarmUp(5) && guard++ < 40) {
    const before = pis.player[0].amrLeague.practiceElapsed;
    const r = bowl(eng, rack, turn);
    check(r.practice, 'frames: a practice ball');
    if (pis.player.slice(0, 2).some((p) => p.activeSquare > 0)) sawOnSheet = true;
    if (pis.player[0].amrLeague.practiceElapsed > before) rounds++;
  }
  check(sawOnSheet, 'frames: the practice balls are on the sheet while the frame is played');
  check(rounds === 2, 'frames: two rounds counted (' + rounds + ')');
  check(pis.player.slice(0, 2).every((p) => p.score.every((v) => v === 0) && p.activeSquare === 0) && pis.activePlayer === 0, 'frames: wiped, the serie starts at frame 1 with bowler 1');
}

// ---- minutes -------------------------------------------------------------------------------------
{
  const s = withPractice(GCI.PRACTICE_MINUTES, 2);
  const { eng } = s;
  const pis = eng.lanes[0];
  check(eng.practiceSecondsLeft(5) === 120, 'minutes: two minutes on the clock');
  s.setNow(s.getNow() + 61_000);
  check(eng.practiceSecondsLeft(5) === 59, 'minutes: the clock runs (' + eng.practiceSecondsLeft(5) + ')');
  playOut(eng, 7);
  check(eng.isWarmUp(5) && pis.laneStatus === GCI.Practice, 'minutes: still practice while the time lasts');
  s.setNow(s.getNow() + 60_000);
  check(eng.practiceSecondsLeft(5) <= 0, 'minutes: time out');
  eng.practiceClockOver();
  check(pis.laneStatus === GCI.PracticeOver && pis.practiceAmount === 0 && eng.isWarmUp(5), 'minutes: the stop picture (PracticeOver)');
  const r = playOut(eng, 2);
  check(r.length === 2 && r.every((x) => x.practice), 'minutes: balls during the stop picture are practice balls');
  eng.practiceClockFinish();
  check(!eng.isWarmUp(5) && pis.laneStatus === GCI.Gameplay && pis.player.slice(0, 3).every((p) => p.activeSquare === 0 && p.score.every((v) => v === 0)), 'minutes: the serie starts');
}

// ---- End practice on the console -------------------------------------------------------------------
{
  const { eng } = withPractice(GCI.PRACTICE_BALLS, 4);
  playOut(eng, 3);
  const changed = eng.endPracticeFromConsole(5);
  const pis = eng.lanes[0];
  check(changed.join() === '5' && !eng.isWarmUp(5) && pis.activePlayer === 0 && pis.laneStatus === GCI.Gameplay, 'console: End practice starts the serie');
  check(eng.endPracticeFromConsole(5).length === 0, 'console: a lane not practising is left alone (IsPractising)');
}
{
  const { eng } = withPractice(GCI.PRACTICE_FRAMES, 3, { american: true, names: ['A', 'B', 'C', 'D'] });
  playOut(eng, 3);
  const changed = eng.endPracticeFromConsole(6);
  check(changed.join() === '5,6' && eng.lanes[0].activePlayer === 0 && eng.lanes[1].activePlayer === 8, 'console: an American pair ends both lanes, odd with bowler 0, even with bowler 8');
}
{
  // a tenth-frame game: End practice puts the bowler on ball 18 (FirstBallOfSerie); OpenPlay's own
  // end of a warm-up in frames puts back m_activeSquare, captured before StartGame's 18 - ball 0
  const a = withPractice(GCI.PRACTICE_FRAMES, 1, { game: 'tenth', names: ['A'] });
  a.eng.endPracticeFromConsole(5);
  check(a.eng.lanes[0].player[0].activeSquare === 18, 'console: tenth frame on ball 18');
  const b = withPractice(GCI.PRACTICE_FRAMES, 1, { game: 'tenth', names: ['A'] });
  playOutWarm(b.eng);
  check(!b.eng.isWarmUp(5) && b.eng.lanes[0].player[0].activeSquare === 0, 'frames: OpenPlay\'s own end puts a tenth-frame bowler on ball 0, as in Viking');
}

// ---- not scored: the same game balls give the same result with and without a warm-up ----------------
for (const [method, amount, american] of [[GCI.PRACTICE_BALLS, 2, false], [GCI.PRACTICE_FRAMES, 1, false], [GCI.PRACTICE_BALLS, 1, true], [GCI.PRACTICE_FRAMES, 2, true]]) {
  // bowl the warm-up with its own random balls, then the game with a fixed stream
  const w = withPractice(method, amount, { american, names: ['A', 'B', 'C', 'D'] });
  playOutWarm(w.eng);
  seed = 777; const log1 = playOut(w.eng);
  const n = withPractice(GCI.PRACTICE_NONE, 0, { american, names: ['A', 'B', 'C', 'D'] });
  seed = 777; const log2 = playOut(n.eng);
  check(log1.length === log2.length && log1.every((r) => !r.practice) && sheet(w.eng) === sheet(n.eng) && totals(w.eng).join() === totals(n.eng).join(),
    `not scored: ${['', 'minutes', 'frames', 'balls'][method]} ${amount}${american ? ' AMR' : ''} - totals ${totals(w.eng).join('/')} = ${totals(n.eng).join('/')}`);
}
function playOutWarm(eng) {
  const rack = new Map(eng.lanes.map((l) => [l.laneNumber, 0x3FF])), turn = { n: eng.lanes[0].laneNumber };
  for (let i = 0; i < 200 && eng.lanes.some((l) => eng.isWarmUp(l.laneNumber)); i++) bowl(eng, rack, turn);
  check(!eng.lanes.some((l) => eng.isWarmUp(l.laneNumber)), 'the warm-up ends by itself');
}

// ---- a ball still rolling when the warm-up ends is not scored (js/game/lanegame.js) ------------------
// The game's own ball loop (LaneGame) with a stand-in App: a practice ball is thrown, and while it rolls
// the warm-up is ended - End practice on the console, or the warm-up clock's stop picture running out.
// The ball's six pins must not land on the serie's sheet, for the player's ball and a machine player's.
const { LaneGame } = await import('../js/game/lanegame.js');
async function ballInFlight({ endBy, botUp = false, method = GCI.PRACTICE_BALLS, amount = 4 }) {
  const s = withPractice(method, amount, { names: ['Player', 'Bot'] });
  const eng = s.eng;
  if (endBy === 'clock') s.setNow(s.getNow() + (amount * 60 + 1) * 1000);
  const phys = {
    state: 'idle', entry: null, ball: { position: { set() {} }, velocity: { setZero() {} }, angularVelocity: { setZero() {} } },
    resetPins() {}, setBumpers() {}, release() { this.state = 'rolling'; }, standingMask: () => 0x3C0, laneSpeed: () => 7
  };
  const bot = { firstBall: () => ({ standing: 0x3C0, kind: 'multi' }), secondBall: (m) => m, leftHanded: false, average: 160 };
  let game = null, throws = 0;
  const noop = () => {};
  const app = {
    loadcom: { setMask: noop, playAnimation: noop }, input: { disable: noop }, scene: { aimView: noop, portrait: false },
    sound: { startRoll: noop, stopRoll: noop }, syncLane: noop, pushTv: noop, toast: noop, status: noop, focusLane: noop,
    speedo: noop, reactTo: noop, reactToPractice: noop, interruptThrow: noop, fast: true,
    // the player throws at once; the next time the player is asked (the first time, when the
    // machine player's ball is the one tested) the test is over
    waitForThrow: () => { throws++; if (throws > (botUp ? 0 : 1)) { game.stop(); return Promise.resolve(null); } return Promise.resolve({ x0: 0, speed: 7, angle: 0, side: 0 }); },
    // while the ball rolls the warm-up is ended, as the console or the clock ends it
    watchBall: async () => {
      if (endBy === 'console') eng.endPracticeFromConsole(5);
      else { eng.practiceClockOver(); eng.practiceClockFinish(); }
      game.externalChange(endBy);
      return { gutter: false };
    }
  };
  // the planned machine ball is not what is tested: a straight one
  const who = (lane, index) => (index === 0 ? { name: 'Player', human: true } : { name: 'Bot', bot });
  game = new LaneGame(app, { engine: eng, lanes: [{ number: 5, laneX: 0, physics: phys, slot: 0 }], who });
  game.planBot = () => ({ x0: 0, speed: 7, angle: 0, side: 0, roll: 0.5 });
  if (botUp) { eng.lanes[0].activePlayer = 1; }        // the machine player's practice turn
  await Promise.race([game.run(), new Promise((r) => setTimeout(r, 4000))]);
  game.stop(); game.stopPracticeClock();
  const pis = eng.lanes[0];
  return { warm: eng.isWarmUp(5), active: pis.activePlayer, sheets: pis.player.slice(0, 2).map((p) => ({ as: p.activeSquare, sum: p.score.reduce((a, v) => a + v, 0) })) };
}
for (const c of [{ endBy: 'console' }, { endBy: 'clock', method: GCI.PRACTICE_MINUTES, amount: 1 }, { endBy: 'console', botUp: true }, { endBy: 'console', method: GCI.PRACTICE_FRAMES, amount: 2 }]) {
  const r = await ballInFlight(c);
  const label = `ball in flight at the end of the warm-up (${c.endBy}, ${['', 'minutes', 'frames', 'balls'][c.method || GCI.PRACTICE_BALLS]}${c.botUp ? ', a machine player\'s ball' : ''})`;
  check(!r.warm && r.active === 0 && r.sheets.every((p) => p.as === 0 && p.sum === 0), `${label}: not scored - the serie starts empty with bowler 1 (${JSON.stringify(r)})`);
}

console.log(failures ? `${failures} warm-up check(s) failed` : 'All warm-up checks passed');
process.exit(failures ? 1 : 0);

// VBS-T formats test: every format the game offers, in EUR and in AMR, played through
// the competition engine with machine players, and checked against the rules it was
// built from.   node tests/vbst_formats.mjs [seed=7]
//   - every player bowls exactly the series the movement / rotation deals them, and no
//     lane holds more bowlers than a lane can (8, 16 for a pair)
//   - points: no rule hands out more than its maximum; a BANP match awards at most 20
//     (16 lane or pair points + 4 serie points); Petersen gives 30 per lane (or 15+15)
//   - the end result is sorted the way VBS-T sorts it
//   - hand-checked cases: a BANP 4+4 serie and a Petersen serie with fixed games
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMovement } from '../js/vbst/format.js';
import { Competition } from '../js/vbst/competition.js';
import { resolveFormat, makePlayers, nameTeams, simulateCompetition, loadAutoFormats, PREDEFINED, pickHuman } from '../js/vbst/session.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let seed = parseInt(process.argv[2] || '7', 10) >>> 0;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
Math.random = rng;          // the bots and the RedPin draw use it: make the run repeatable
const latin1 = new TextDecoder('windows-1252');
const fetchMove = async (name) => {
  try { return parseMovement(latin1.decode(readFileSync(join(root, 'Reception', 'vbsTournaments', 'PlayerMovements', name)))); } catch { return null; }
};

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };

async function runFormat(id, american) {
  let fmt, movement;
  try { ({ fmt, movement } = await resolveFormat(id, american, fetchMove)); } catch (e) { return { id, american, skipped: String(e.message || e) }; }
  const players = makePlayers(fmt, { skillAvg: 175, humanName: 'Tester', rng });
  const comp = new Competition({ header: fmt.header, rules: fmt.rules, movement, players, name: 'TEST' });
  nameTeams(comp, fmt, 'sv', false);
  const hi = pickHuman(comp, 'Tester');
  if (!comp.rows[hi].lanes.some(Boolean)) fail(id + ': the player is dealt no lane');
  const st = simulateCompetition(comp, fmt, { rng });
  // checks
  for (const r of comp.rows) for (let s = 0; s < comp.numGames; s++) {
    if (r.lanes[s] && !r.played[s]) fail(`${id} ${american ? 'AMR' : 'EUR'}: ${r.name} was dealt lane ${r.lanes[s]} in serie ${s + 1} but did not bowl`);
    if (!r.lanes[s] && r.played[s]) fail(`${id}: ${r.name} bowled serie ${s + 1} without a lane`);
  }
  for (let s = 0; s < comp.numGames; s++) for (const [l, rows] of comp.lanesInSerie(s)) if (rows.length > 8) fail(`${id}: lane ${l} serie ${s + 1} has ${rows.length} bowlers`);
  const totalPoints = st.teams.reduce((a, t) => a + t.rawPoints, 0);
  if (fmt.header.VBSTvariant === 1 && totalPoints > 20 + 1e-6) fail(`${id}: BANP awarded ${totalPoints} points`);
  if (fmt.id === 'rr') for (let s = 0; s < comp.numGames; s++) {
    const b = comp.rows.reduce((a, r) => a + r.bonuses[s], 0);
    const lanes = comp.american ? comp.lanesInSerie(s).size / 2 : comp.lanesInSerie(s).size;
    if (b < 30 * lanes - 1e-6 && b !== 30 * lanes) { /* ties give 15 + 15 = 30 as well */ }
    if (Math.abs(b - 30 * lanes) > 1e-6) fail(`rr serie ${s + 1}: bonuses ${b}, expected ${30 * lanes}`);
  }
  for (let i = 1; i < st.players.length; i++) if (st.players[i].total > st.players[i - 1].total) fail(`${id}: players not sorted`);
  const lanesUsed = new Set();
  for (const r of comp.rows) for (const l of r.lanes) if (l) lanesUsed.add(l);
  const winner = st.teams.length > 1 ? st.teams[0] : null;
  return {
    id, american, title: fmt.title, players: comp.rows.length - fmt.header.numReservPlayers, series: comp.numGames, lanes: lanesUsed.size,
    teams: st.teams.length, points: st.awardsPoints ? st.teams.map((t) => t.points).join('-') : '',
    pins: st.teams.length > 1 ? st.teams.map((t) => t.pins).join('-') : '', leader: winner ? winner.name : st.players[0].row.name,
    top: st.players[0].total
  };
}

// --- hand-checked cases -------------------------------------------------------
async function handChecks() {
  // BANP 4+4: serie 1 puts p1/p5, p2/p6, p3/p7, p4/p8 on lanes 1-4. Home bowls 200,150,180,160,
  // away 190,170,180,150 -> lane points home 1, away 1, tie on lane 3 (0 each), home 1;
  // serie points: home 690 vs away 690 -> tie, 0 each. So home 2, away 1 after serie 1.
  const { fmt, movement } = await resolveFormat('banp44', false, fetchMove);
  const players = makePlayers(fmt, { skillAvg: 170, humanName: 'H', rng });
  const comp = new Competition({ header: fmt.header, rules: fmt.rules, movement, players, name: 'T' });
  nameTeams(comp, fmt, 'sv', false);
  const games = [200, 150, 180, 160, 190, 170, 180, 150];
  const lanes1 = comp.lanesInSerie(0);
  const expectLanes = [[0, 4], [1, 5], [2, 6], [3, 7]];
  expectLanes.forEach(([a, b], k) => {
    const rows = lanes1.get(k + 1).map((r) => r.idx).sort((x, y) => x - y);
    if (rows.join(',') !== [a, b].join(',')) fail(`banp44 serie 1 lane ${k + 1}: rows ${rows} expected ${a},${b}`);
  });
  for (let i = 0; i < 8; i++) comp.recordGame(comp.rows[i], 0, [], { total: games[i], strikes: 0, spares: 0, opens: 0, splits: 0 });
  comp.endSerie(0);
  const tp = (team) => comp.rows.filter((r) => r.team === team).reduce((a, r) => a + r.teamPoints[0], 0);
  const home = comp.rows[0].team, away = comp.rows[4].team;
  if (Math.abs(tp(home) - 2) > 1e-9 || Math.abs(tp(away) - 1) > 1e-9) fail(`banp44 hand check: home ${tp(home)} away ${tp(away)}, expected 2 and 1`);
  else console.log('Hand check BANP 4+4 serie 1: home 2, away 1 (lane 3 tied, serie tied) - ok');

  // Petersen 6 EU, serie 1: lanes hold pairs; the higher scratch+hcp on a lane gets 30, a tie 15 each
  const r2 = await resolveFormat('rr', false, fetchMove);
  const p2 = makePlayers(r2.fmt, { skillAvg: 170, humanName: 'H', rng });
  const c2 = new Competition({ header: r2.fmt.header, rules: r2.fmt.rules, movement: r2.movement, players: p2, name: 'T' });
  const g2 = [210, 190, 150, 150, 170, 200];
  for (let i = 0; i < 6; i++) c2.recordGame(c2.rows[i], 0, [], { total: g2[i], strikes: 0, spares: 0, opens: 0, splits: 0 });
  c2.endSerie(0);
  let ok = true;
  for (const [l, rows] of c2.lanesInSerie(0)) {
    const [a, b] = rows;
    const ea = a.games[0] > b.games[0] ? 30 : a.games[0] === b.games[0] ? 15 : 0;
    const eb = b.games[0] > a.games[0] ? 30 : a.games[0] === b.games[0] ? 15 : 0;
    if (a.bonuses[0] !== ea || b.bonuses[0] !== eb) { ok = false; fail(`rr lane ${l}: ${a.bonuses[0]}/${b.bonuses[0]} expected ${ea}/${eb}`); }
  }
  if (ok) console.log('Hand check Petersen 6 serie 1: 30 to each lane winner, 15 each on the tied lane - ok');

  // Korp 18: 2 points per lane won, 1 each on a tie, 3 lanes x 3 series = 18 at most
  const r3 = await resolveFormat('korp18', false, fetchMove);
  const p3 = makePlayers(r3.fmt, { skillAvg: 170, humanName: 'H', rng });
  const c3 = new Competition({ header: r3.fmt.header, rules: r3.fmt.rules, movement: r3.movement, players: p3, name: 'T' });
  nameTeams(c3, r3.fmt, 'sv', false);
  const st3 = simulateCompetition(c3, r3.fmt, { rng });
  const sum3 = st3.teams.reduce((a, t) => a + t.rawPoints, 0);
  if (Math.abs(sum3 - 18) > 1e-9) fail(`korp18: ${sum3} points awarded, expected 18 (2 per lane, ties 1+1)`);
  else console.log('Check Korp 18: 18 points shared out over 3 lanes x 3 series - ok');
}

// --- the other lanes at the player's pace, and the lane console ---------------
// American pairs with a warm-up in frames: one lane of a pair can end its warm-up before the other;
// the lanes bowled at the player's pace (PacedLanes) must still bowl exactly the serie drawn for them
async function pacedWarmupChecks() {
  const { PacedLanes, lanesFor, VbstSession } = await import('../js/vbst/session.js');
  const { OpenPlayGame, GCI, makePlayer } = await import('../js/engine/openplay.js');
  const pinsDown = (m) => { let n = 10; for (let i = 0; i < 10; i++) if (m & (1 << i)) n--; return n; };
  const sheet = (ls) => ls.map((pis) => Array.from({ length: pis.noPlayers }, (_, i) => pis.player[i].score.join(',') + '|' + pis.player[i].activeSquare).join(' ')).join(' / ');
  let pairs = 0, differ = 0;
  const bad = [];
  for (const p of PREDEFINED) for (const amount of [1, 2, 3]) {
    let fmt, movement;
    try { ({ fmt, movement } = await resolveFormat(p.id, true, fetchMove)); } catch { continue; }
    const players = makePlayers(fmt, { skillAvg: 175, humanName: 'Tester', rng });
    const comp = new Competition({ header: fmt.header, rules: fmt.rules, movement, players, name: 'TEST' });
    nameTeams(comp, fmt, 'sv', false);
    pickHuman(comp, 'Tester');
    const rowOf = (pl) => comp.rows.find((r) => r.id === pl.playerIdNumber);
    for (const g of comp.groupsInSerie(0)) {
      const lanes = lanesFor(comp, fmt, g, 0, { league: 'TEST.h001' });
      if (lanes.length < 2) continue;
      pairs++;
      const plain = structuredClone(lanes);
      const paced = new PacedLanes(lanes, rowOf, { practice: { method: GCI.PRACTICE_FRAMES, amount } });
      let guard = 0;
      while (!paced.done() && guard++ < 3000) paced.step();
      // the drawn serie, bowled on the same lanes without a warm-up
      const ref = new OpenPlayGame({ lanes: plain });
      ref.startGame();
      for (const b of paced.balls) ref.scoreBall(b.lane, b.after, pinsDown(b.after), 0, false);
      if (guard >= 3000 || sheet(paced.lanes) !== sheet(plain)) { differ++; if (bad.length < 4) bad.push(`${p.id} f${amount} lanes ${lanes.map((l) => l.laneNumber).join('-')}`); }
    }
  }
  if (differ) fail(`AMR warm-up in frames: ${differ} of ${pairs} lane pairs did not bowl the drawn serie (${bad.join(', ')})`);
  else console.log(`Check AMR warm-up in frames (1-3) on the paced lanes: ${pairs} lane pairs of the predefined formats bowled exactly the drawn serie - ok`);

  // a bowler added on the lane console (Ändra spelare) on the player's lane: the serie is bowled to
  // the end with that bowler too (a machine player of the game's level), and the other lanes' pace
  // timer stops with the serie
  const { changePlayersInfo } = await import('../js/engine/correction.js');
  const { MachinePlayer } = await import('../js/ai/bots.js');
  const noop = () => {};
  const phys = { state: 'idle', ball: { position: { set: noop }, velocity: { setZero: noop }, angularVelocity: { setZero: noop } }, resetPins: noop, setBumpers: noop };
  for (const american of [false, true]) {
    let added = null, err = null;
    const app = {
      settings: { theme: 'Standard', skill: 'league', name: 'Tester', warmV: 'format', style: american ? 'amr' : 'eur' },
      slots: [{ laneX: 0 }, { laneX: 1.7 }], physics: [phys, phys], instant: true, instantBot: new MachinePlayer({ name: 'auto', average: 185, rng }), fast: true,
      loadcom: { attach: noop, changed: noop, settings: {}, setMask: noop, playAnimation: noop },
      wallSetup: noop, show: noop, syncHud: noop, toast: noop, effect: noop, pushTv: noop, syncLane: noop, focusLane: noop,
      scene: { aimView: noop, portrait: false }, input: { disable: noop }, status: noop, sound: { startRoll: noop, stopRoll: noop }, speedo: noop, reactTo: noop,
      // the console's Ändra spelare on the player's first lane, before its first ball: one bowler added
      prepareLanes(slotLanes, eng) {
        const lane = slotLanes[0].number, pis = eng.getPlayerInfoStruct(lane), q = { activePlayer: '0', game: String(pis.player[0].activeGame) };
        const ids = [];
        for (let i = 0; i < pis.noPlayers; i++) { q['player' + i + 'Name'] = pis.player[i].playerName; q['player' + i + 'ID'] = String(pis.player[i].playerIdNumber); ids.push(pis.player[i].playerIdNumber); }
        q['player' + pis.noPlayers + 'Name'] = 'Nyspelare'; q['player' + pis.noPlayers + 'ID'] = '-1'; q.seen = ids.join(',');
        const r = changePlayersInfo(eng, lane, q, makePlayer);
        added = r.response.success === 'true' ? { lane, eng, index: pis.noPlayers - 1 } : null;
      }
    };
    const { fmt, movement } = await resolveFormat('banp44', american, fetchMove);
    const s = new VbstSession(app);
    s.fmt = fmt; s.movement = movement; s.league = 'VBG_test.h001';
    s.makeRobots(true);
    s.humanIndex = pickHuman(s.comp, 'Tester');
    try { await s.playSerie(0); } catch (e) { err = e; s.stop(); }
    const pis = added && added.eng.getPlayerInfoStruct(added.lane), np = pis && pis.player[added.index];
    const ok = !err && np && np.playerName === 'Nyspelare' && np.activeSquare >= 20 && !s.paceTimer;
    if (!ok) fail(`banp44 ${american ? 'AMR' : 'EUR'}: a bowler added on the console: ${err ? 'error ' + String(err.message || err) : `bowled to ${np ? np.activeSquare : '-'}, pace timer ${s.paceTimer ? 'running' : 'stopped'}`}`);
    else console.log(`Check banp44 ${american ? 'AMR' : 'EUR'}: a bowler added on the lane console bowls the serie to the end (${np.score.slice(0, np.activeSquare).reduce((a, v) => a + v, 0)} pins), no error, pace timer stopped - ok`);
  }
}

await handChecks();
await pacedWarmupChecks();
const rows = [];
for (const p of PREDEFINED) for (const am of [false, true]) rows.push(await runFormat(p.id, am));
const autos = await loadAutoFormats();
for (const a of autos) for (const am of [false, true]) rows.push(await runFormat('auto:' + a.name, am));

console.log('');
console.log('| Format | Mode | Players | Series | Lanes | Teams | Points | Pins | Leader | Top total |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
let played = 0, skipped = 0;
for (const r of rows) {
  if (r.skipped) { skipped++; console.log(`| ${r.id.replace(/^auto:/, '')} | ${r.american ? 'AMR' : 'EUR'} | - | - | - | - | - | - | not bookable: ${r.skipped.replace(/\|/g, '/')} | |`); continue; }
  played++;
  console.log(`| ${r.title} | ${r.american ? 'AMR' : 'EUR'} | ${r.players} | ${r.series} | ${r.lanes} | ${r.teams} | ${r.points} | ${r.pins} | ${r.leader} | ${r.top} |`);
}
console.log('');
console.log(`${played} format/mode combinations played to the end, ${skipped} not bookable (as in Viking), ${failures} check failures`);
process.exitCode = failures ? 1 : 0;

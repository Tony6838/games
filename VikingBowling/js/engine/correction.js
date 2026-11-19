// ---------------------------------------------------------------------------
// correction.js - what the lane console's score editor, "Ändra spelare" and the player lists do
// to a lane, as Viking 4.4 does it. Ported from Slave/LOADCOM/LoadComWebInterface.cpp:
//   GetPlayers (players.json), GetPlayerScore (playerScore.json),
//   ChangeScore -> CorrectionFitsLane, CorrectionSeesAllBalls, ApplyScoreCorrection,
//                  MoveActiveMarkOffCompletedSeries (ActiveBowlerWithBallLeft),
//   ChangePlayersInfo -> PlayerListFitsLane, BowlerThePageNeverSaw, ActiveBowlerWithBallLeft,
// from shared/lanedata/GCI_info.cpp: SetChangedFlagInStatus, GlobIsFirstBall, GlobCreatePinConfig,
// and the half OpenPlay does when LoadCom tells it GC_CONSOLE_REFRESH after writing the lane
// (Slave/OPENPLAY/ComIn.cpp, ConsoleInput): RefreshGame - the game's scoring port rescores.
// The lane struct is the engine's own (what LoadCom reads and writes is the same shared memory).
// ---------------------------------------------------------------------------
import { GCI, isPlayerSerieComplete } from './openplay.js';

const MAX_BOWLERS = 8;

// CGCI_info::SetChangedFlagInStatus: keep foul and split, keep RedPin, set CHANGED
export function setChangedFlagInStatus(status) {
  const redPin = (status & GCI.REDPIN) !== 0;
  let s = status & (GCI.FOUL | GCI.SPLIT);
  s |= GCI.CHANGED;
  s &= ~GCI.REDPIN;
  if (redPin) s |= GCI.REDPIN;
  return s & 0xFF;
}

// CGCI_info::GlobIsFirstBall
export function globIsFirstBall(ball, score) {
  return !((ball < 19 && ball % 2) || (ball === 20 && score[18] === 10 && score[19] !== 10) || (ball === 19 && score[18] !== 10));
}

// CGCI_info::GlobCreatePinConfig: knock down `fallen` pins of standingBefore, lowest first
export function globCreatePinConfig(standingBefore, fallen) {
  let rc = standingBefore & 0xFFFF;
  for (let i = 0; i < fallen; i++) {
    for (let j = 0; j < 10; j++) if (rc & (1 << j)) { rc &= ~(1 << j); break; }
  }
  return rc;
}

// C's atoi: leading spaces, a sign, digits; anything else 0
function atoi(s) {
  const m = /^\s*([+-]?\d+)/.exec(String(s));
  return m ? parseInt(m[1], 10) : 0;
}

// ApplyScoreCorrection: the balls the request sent into one bowler, activeSquare from them.
// scores: the request's values as strings ("8", "F", "7S", "-1" ...). Returns
// { validScore, changed: [[index, old, new]] }.
export function applyScoreCorrection(player, scoresIn) {
  const scores = scoresIn.slice();
  let validScore = 0;
  const ballChanged = new Array(21).fill(false);
  const changed = [];
  for (let i = 0; i < 21; i++) {
    let isFaul = false, isSplit = false;
    if (i >= scores.length) { player.score[i] = 0; continue; }
    if (scores[i] === 'F') { isFaul = true; scores[i] = '0'; }
    else if (scores[i].length > 1 && (scores[i].endsWith('S') || scores[i].endsWith('s'))) { isSplit = true; scores[i] = scores[i].slice(0, -1); }
    const score = atoi(scores[i]);
    if (score < 0) break;
    validScore++;
    const byte = score & 0xFF;               // BYTE score[21]
    if (player.score[i] !== byte) {
      changed.push([i, player.score[i], byte]);
      ballChanged[i] = true;
      player.status[i] &= ~(GCI.SPLIT | GCI.FOUL);
      player.status[i] = setChangedFlagInStatus(player.status[i]);
    }
    player.score[i] = byte;
    if (isFaul) player.status[i] |= GCI.FOUL;
    else if (isSplit) player.status[i] |= GCI.SPLIT;
  }
  player.activeSquare = validScore;
  for (let i = 0; i < validScore && i < 21; i++) {
    const firstBall = globIsFirstBall(i, player.score);
    if (!firstBall && i > 0 && ballChanged[i - 1]) ballChanged[i] = true;
    if (!ballChanged[i]) continue;
    const standing = firstBall ? 0x3FF : player.pinConfig[i - 1];
    player.pinConfig[i] = globCreatePinConfig(standing, player.score[i]);
  }
  return { validScore, changed };
}

// ActiveBowlerWithBallLeft
export function activeBowlerWithBallLeft(pis, requested) {
  const n = Math.min(MAX_BOWLERS, pis.noPlayers);
  if (requested < 0 || requested >= n || !isPlayerSerieComplete(pis.player[requested])) return requested;
  for (let step = 1; step < n; step++) {
    const c = (requested + step) % n;
    if (!isPlayerSerieComplete(pis.player[c])) return c;
  }
  return requested;
}

// MoveActiveMarkOffCompletedSeries: { moved, from }
export function moveActiveMarkOffCompletedSeries(pis) {
  let from = pis.activePlayer;
  if (pis.type & GCI.LC_START_AMERICAN) return { moved: false, from };
  if (from >= MAX_BOWLERS) from -= MAX_BOWLERS;
  const next = activeBowlerWithBallLeft(pis, from);
  if (next === from) return { moved: false, from };
  pis.activePlayer = next;
  return { moved: true, from };
}

export function correctionFitsLane(pis, row, playerId, game) {
  if (playerId < 0 && game < 0) return true;
  if (row >= Math.min(MAX_BOWLERS, pis.noPlayers)) return false;
  return (playerId < 0 || pis.player[row].playerIdNumber === playerId) && (game < 0 || pis.player[row].activeGame === game);
}
export function correctionSeesAllBalls(pis, row, square) {
  return square < 0 || row >= Math.min(MAX_BOWLERS, pis.noPlayers) || pis.player[row].activeSquare === square;
}
export function playerListFitsLane(pis, ids, game) {
  const n = Math.min(MAX_BOWLERS, pis.noPlayers);
  if (game >= 0 && n > 0 && pis.player[0].activeGame !== game) return { ok: false, missingId: -1 };
  for (const id of ids) {
    if (id < 0) continue;
    let found = false;
    for (let j = 0; j < n && !found; j++) found = pis.player[j].playerIdNumber === id;
    if (!found) return { ok: false, missingId: id };
  }
  return { ok: true, missingId: -1 };
}
export function bowlerThePageNeverSaw(pis, seenIds) {
  if (!seenIds.length) return -1;
  const n = Math.min(MAX_BOWLERS, pis.noPlayers);
  for (let i = 0; i < n; i++) if (!seenIds.includes(pis.player[i].playerIdNumber)) return pis.player[i].playerIdNumber;
  return -1;
}

// The bumper marker at the end of a name: "+C" (CProtocol::IsBowlerUsingBumper: +c or +C)
export function usesBumpers(name) {
  const s = String(name || '');
  return s.length >= 2 && s[s.length - 2] === '+' && (s[s.length - 1] === 'c' || s[s.length - 1] === 'C');
}
export function withoutBumperMark(name) { return usesBumpers(name) ? String(name).slice(0, -2) : String(name || ''); }
export function withBumperMark(name, on) { const b = withoutBumperMark(name); return on ? b + '+C' : b; }

// OpenPlay's GC_CONSOLE_REFRESH: the lane file LoadCom wrote is what OpenPlay now scores, and
// RefreshGame rescores it (the odd lane's OpenPlay refreshes the pair in cross lane play). The
// finishedAndReported half of the C++ concerns a serie whose end of game procedure has run,
// which the game never reaches while the lane is being bowled.
export function consoleRefresh(eng, lane) {
  if (eng.isCrosslane()) {
    const other = eng.getOtherLane(lane);
    if (lane % 2) eng.refreshGame(other);
    else eng.refreshGame(other);          // GC_REFRESH to the odd lane: its RefreshGame
  }
  eng.refreshGame(lane);
}

// ---- the endpoints ------------------------------------------------------------------------

// GetPlayers: players.json
export function playersJson(pis, lane) {
  const players = [];
  const rev = pis.reverseArrows;
  for (let i = 0; i < pis.noPlayers; i++) {
    const p = pis.player[i];
    const bump = /\+c/i.test(p.playerName);
    const name = String(p.playerName).replace(/\+c/g, '').replace(/\+C/g, '');
    let sq = p.activeSquare;
    if (sq > 18) sq = 19;
    let shallPlayLeft = ((sq >> 1) % 2) === 0;
    if (rev) shallPlayLeft = !shallPlayLeft;
    if ((p.activeGame % 2) === 1 && p.amrLeague.amrSwitch) shallPlayLeft = !shallPlayLeft;
    if (lane % 2 === 0) shallPlayLeft = !shallPlayLeft;
    players.push({ index: String(i), name, totalPoints: String(p.totalPoints), hcp: String(p.hcp), playerIdNumber: String(p.playerIdNumber),
      activeGame: String(p.activeGame), shallPlayLeft: shallPlayLeft ? '1' : '0', bump: bump ? '1' : '0', playerMemberNumber: String(p.playerMemberNumber || '') });
  }
  return { activePlayer: String(pis.activePlayer), Reverse: (pis.player[0].amrLeague.amrSwitch && (pis.player[0].activeGame % 2)) ? '1' : '0', players };
}

// GetPlayerScore: playerScore.json
export function playerScoreJson(pis, playerIndex) {
  const p = pis.player[playerIndex];
  const scores = [];
  for (let i = 0; i < 21; i++) scores.push(i < p.activeSquare ? p.score[i] : -1);
  const out = { scores };
  if (playerIndex < pis.noPlayers) {
    out.playerIdNumber = String(p.playerIdNumber);
    out.activeGame = String(p.activeGame);
    out.activeSquare = String(p.activeSquare);
  }
  return out;
}

// ChangeScore (changeScore): returns { response, applied: { player, before, after, changed, markMoved } | null }
export function changeScore(eng, lane, q) {
  const pis = eng.getPlayerInfoStruct(lane);
  const playerindex = q.playerindex === undefined ? 999 : parseInt(q.playerindex, 10);
  const formPlayerId = q.playerid === undefined ? -1 : parseInt(q.playerid, 10);
  const formGame = q.game === undefined ? -1 : parseInt(q.game, 10);
  const formSquare = q.square === undefined ? -1 : parseInt(q.square, 10);
  const scores = String(q.scores === undefined ? '' : q.scores).split(',');
  if (!(playerindex >= 0 && playerindex < MAX_BOWLERS) || !pis) return { response: { success: 'false' }, applied: null };
  if (!correctionFitsLane(pis, playerindex, formPlayerId, formGame)) return { response: { success: 'false', reason: 'laneMovedOn' }, applied: null };
  if (!correctionSeesAllBalls(pis, playerindex, formSquare)) return { response: { success: 'false', reason: 'scoreChanged' }, applied: null };
  if (pis.noPlayers <= playerindex) return { response: { success: 'false' }, applied: null };
  const p = pis.player[playerindex];
  const before = p.activeSquare;
  const { validScore, changed } = applyScoreCorrection(p, scores);
  const mark = moveActiveMarkOffCompletedSeries(pis);
  pis.playedPlayerID = p.playerIdNumber;
  consoleRefresh(eng, lane);
  return { response: { success: 'true' }, applied: { player: playerindex, before, after: validScore, changed, markMoved: mark.moved ? mark.from : null } };
}

// The player-name rule as far as the game needs it (LanedataUtil::SanitizePlayerName keeps the
// trailing bumper marker and takes out what the lane file and the database do not accept)
function sanitizeName(raw) {
  const bump = usesBumpers(raw);
  let base = (bump ? String(raw).slice(0, -2) : String(raw)).replace(/[^\p{L}\p{N} .\-_']/gu, '').slice(0, 20);
  if (!base.trim()) base = '_';
  return bump ? base + '+C' : base;
}

// ChangePlayersInfo (changePlayersInfo): q has player<n>Name, player<n>ID, activePlayer, game, seen
export function changePlayersInfo(eng, lane, q, makePlayer) {
  const pis = eng.getPlayerInfoStruct(lane);
  if (!pis) return { response: { success: 'false' }, applied: null };
  const source = structuredClone(pis);
  const activePlayer = q.activePlayer === undefined ? 0 : parseInt(q.activePlayer, 10) >>> 0;
  const listed = [];
  for (let row = 0; row < MAX_BOWLERS; row++) {
    if (!q['player' + row + 'Name']) break;
    listed.push(q['player' + row + 'ID'] === undefined ? -1 : parseInt(q['player' + row + 'ID'], 10));
  }
  const fits = playerListFitsLane(source, listed, q.game === undefined ? -1 : parseInt(q.game, 10));
  if (!fits.ok) return { response: { success: 'false', reason: 'laneMovedOn' }, applied: null };
  const seen = String(q.seen || '').split(',').filter((s) => s !== '').map((s) => atoi(s));
  if (bowlerThePageNeverSaw(source, seen) >= 0) return { response: { success: 'false', reason: 'laneMovedOn' }, applied: null };
  let addedPlayerID = 300 + Math.floor(Date.now() / 1000) % 10000;
  const target = pis;
  const newPlayers = [];
  let i = 0;
  for (; i < MAX_BOWLERS; i++) {
    let name = q['player' + i + 'Name'];
    if (!name) break;
    const id = q['player' + i + 'ID'] === undefined ? 0 : parseInt(q['player' + i + 'ID'], 10);
    name = String(name).replace(/PlusC/g, '+C');
    let stored = null;
    if (id >= 0) for (let j = 0; j < source.noPlayers && j < MAX_BOWLERS; j++) if (source.player[j].playerIdNumber === id) { stored = source.player[j].playerName; break; }
    name = stored !== null && name === stored ? name : sanitizeName(name);
    let np;
    if (id >= 0) {
      np = null;
      for (let j = 0; j < source.noPlayers; j++) if (source.player[j].playerIdNumber === id) { np = structuredClone(source.player[j]); break; }
      if (!np) np = structuredClone(target.player[i]);
    } else {
      np = makePlayer('', ++addedPlayerID, source.player[0].scoreMode);
      np.activeGame = (newPlayers[0] || source.player[0]).activeGame;
      if (np.scoreMode & GCI.SCORING_369) { np.score[4] = 10; np.score[10] = 10; np.score[16] = 10; }
    }
    np.playerName = name;
    newPlayers.push(np);
  }
  for (let k = 0; k < newPlayers.length; k++) target.player[k] = newPlayers[k];
  target.noPlayers = i;
  if (target.noPlayers === 0) target.activePlayer = 0;
  else if (!(target.type & GCI.LC_START_AMERICAN)) target.activePlayer = activeBowlerWithBallLeft(target, activePlayer);
  for (; i < MAX_BOWLERS; i++) target.player[i] = makePlayer();
  target.playedPlayerID = GCI.ONLINE_SEND_ALL;
  target.isAnyPlayerActive = target.noPlayers > 0 && target.activePlayer >= 0 ? 1 : 0;
  consoleRefresh(eng, lane);
  return { response: { success: 'true' }, applied: { players: newPlayers.length } };
}

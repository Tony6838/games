// ---------------------------------------------------------------------------
// openplay.js - the lane game of Viking Scoring System 4.4, ported to JavaScript.
//
// What OpenPlay.exe (Slave/OPENPLAY) does with a ball, for one lane or for an
// American (cross lane) pair:
//   CGameAbstract::Score            -> score()
//   CGameAbstract::ActivateNextPlayer / ActivateNextPlayer2 / GetNewPlayer /
//                  TestPlayer / SetRenderStatus / MoveActiveMark
//   CGame::CheckGameFinished        -> checkGameFinished()
//   CGame::CheckShortGame, StartGame, InitializeNewGame, CGameAbstract::RefreshGame
//   CMultimedia::MM_GetExciter      -> getExciter()
//   CGameAbstract::randomRedPin     -> randomRedPin()
//   CGCI_info::GlobCheckSplit       -> globCheckSplit()
//   LanedataUtil::IsPlayerSerieComplete -> isPlayerSerieComplete()
// and the pinsetter's side of the message: a ball arrives as the mask of the
// pins left STANDING (GCI_SCORESTRUCT::pins high word) plus the count of pins
// down in the frame so far (its low word) - see CIPinsetterGS::ReadPinData.
//
// The data is GCI_PLAYERINFORMATIONSTRUCT / GCI_PLAYERSTRUCT with the same field
// names, so lanefile.js can write the real lane-file JSON straight from it.
// Hardware (pinsetter resets, bumpers, the UDP broadcast) is left out; the
// scoring, the order of bowlers and the lane state are not.
// ---------------------------------------------------------------------------

import { isFirstBall, recalcScore } from './bowlingscore.js';

export const GCI = {
  // status bits
  SPLIT: 0x0001, CHANGED: 0x0002, FOUL: 0x0004, NOTAP: 0x0008, REDPIN: 0x0010,
  // scoreMode
  SCORING_NORMAL: 0x0000, PIN9_NO_TAP: 0x0001, PIN8_NO_TAP: 0x0002, PIN7_NO_TAP: 0x0004, PIN6_NO_TAP: 0x0008,
  SCORING_369: 0x0010, SCORING_MINI: 0x0020, SCORING_10TH: 0x0040,
  SCORING_SHORTGAME_2: 0x0080, SCORING_SHORTGAME_3: 0x0100, SCORING_SHORTGAME_4: 0x0200, SCORING_SHORTGAME_5: 0x0400,
  // game types (gci.type)
  LC_START_NOPLAY: 0x001, LC_START_OPENPLAY: 0x003, LC_START_TEAMPLAY: 0x004, LC_START_COMPETITION: 0x006,
  LC_START_SHORTGAME: 0x500, LC_START_NOTAP: 0x600, LC_START_369: 0x700, LC_START_AMERICAN: 0x4000,
  // lane status
  Timeplay: 1, Gameplay: 2, ClosedIdle: 5, Tournament: 10, Practice: 11, PracticeOver: 12,
  // practice methods (GCI_PRACTICE_METHOD) and the bowler types TestBlind looks at
  PRACTICE_NONE: 0, PRACTICE_MINUTES: 1, PRACTICE_FRAMES: 2, PRACTICE_BALLS: 3,
  VAC_BOWLER: 3, BLIND_BOWLER: 4,
  ONLINE_SEND_ALL: -1, ONLINE_SEND_NONE: -2,
  // the message overlays (MASKPIC_*, LoadCom's maskPicture)
  MASKPIC_STOP_PRACTICE: 3,
  // exciters
  EXCITER_NONE: 0, EXCITER_STRIKE: 1, EXCITER_SPARE: 2, EXCITER_ZERO: 3, EXCITER_SPLIT: 4,
  EXCITER_FAUL: 5, EXCITER_PIN: 6, EXCITER_SPMAKE: 7, EXCITER_OPEN: 8,
  VBS_CONSTANT: 0x5B,
  ALL_PINS: 0x3FF
};

const PIN = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512];   // PIN1..PIN10

// CGCI_info::GlobCheckSplit(WORD config) - config is the mask of pins STANDING.
export function globCheckSplit(config) {
  let hole = false;
  const has = (n) => (config & PIN[n]) !== 0;
  if (has(1)) hole = false;
  else if (has(2) && has(3)) hole = true;
  else if (has(2)) {
    if (!has(4) && has(7)) hole = true;
    else if (!has(5) && (has(9) || has(6) || has(10))) hole = true;
    else if (has(5) && (has(6) || has(10))) hole = true;
    else hole = false;
  } else if (has(3)) {
    if (!has(6) && has(10)) hole = true;
    else if (!has(5) && (has(8) || has(4) || has(7))) hole = true;
    else if (has(5) && (has(4) || has(7))) hole = true;
    else hole = false;
  } else if (has(4)) {
    if (has(5) || has(6)) hole = true;
    else if (!has(8) && (has(9) || has(10))) hole = true;
    else if (!has(9) && has(10)) hole = true;
    else hole = false;
  } else if (has(5)) {
    hole = has(6) || has(7) || has(10);
  } else if (has(6)) {
    hole = has(7) || has(8);
  } else if (has(7)) {
    hole = has(8) || has(9) || has(10);
  } else if (has(8)) {
    hole = has(9) || has(10);
  } else if (has(9)) {
    hole = has(10);
  }
  return hole;
}

export function countPins(mask) {
  let n = 0;
  for (let i = 0; i < 10; i++) if (mask & (1 << i)) n++;
  return n;
}

// LanedataUtil::IsPlayerSerieComplete
export function isPlayerSerieComplete(p) {
  return p.activeSquare > 19 && (p.score[18] + p.score[19] < 10 || p.activeSquare >= 21);
}

// LanedataUtil::FirstBallOfSerie
export function firstBallOfSerie(scoreMode) {
  if (scoreMode & GCI.SCORING_10TH) return 18;
  if (scoreMode & GCI.SCORING_SHORTGAME_2) return 16;
  if (scoreMode & GCI.SCORING_SHORTGAME_3) return 14;
  if (scoreMode & GCI.SCORING_SHORTGAME_4) return 12;
  if (scoreMode & GCI.SCORING_SHORTGAME_5) return 10;
  return 0;
}

// The ball speed: the game hands scoreBall km/h (what it measured on its lane), where OpenPlay gets
// the pinsetter's value in mm/s. The fields OpenPlay sets from that raw value (the lane's
// lastBallSpeed, the bowler's amrLeague.ballSpeed - what the lane TV shows with "Visa klotfart":
// TakTV's convertBallSpeed reads it as mm/s) get mm/s; ballSpeed[] stays km/h x 100 as Score stores it.
export const kmhToMmPerS = (kmh) => Math.round((+kmh || 0) / 0.0036);

const z21 = () => new Array(21).fill(0);

// A zeroed GCI_PLAYERSTRUCT
export function makePlayer(name = '', id = 0, scoreMode = 0) {
  return {
    playerName: name, originalPlayerName: '', playerMemberNumber: '', playerIdNumber: id,
    activeGame: 0, activeSquare: 0, paymentCategory: 0,
    amrLeague: {
      leaguePath: '', averageScore: 0, blindScore: 0, bowlerType: 0, startLane: 0, teamNumber: 0,
      bowlerNumber: 0, vacScore: 0, activeLane: 0, numGames: 0, practiceElapsed: 0, ballSpeed: 0, amrSwitch: 0
    },
    totalPoints: 0, hcp: 0,
    status: z21(), score: z21(), cameraImageID: z21(), pinConfig: z21(), timeOfThrow: z21(), ballSpeed: z21(),
    averageBallSpeedFirst: 0, numFirst: 0, averageBallSpeedSecond: 0, numSecond: 0,
    playerEmail: '', nextLanes: new Array(15).fill(0), scoreMode, scratchPoints: 0,
    tournamentPlayer: { playerVbsHere: 0, startPoints: 0, teamName: '', protocolPosition: 0, missedGame: 0 }
  };
}

// A zeroed GCI_PLAYERINFORMATIONSTRUCT
export function makeLane(laneNumber) {
  const players = [];
  for (let i = 0; i < 8; i++) players.push(makePlayer());
  return {
    head1: '', head2: '', booking_name: '', bg_image: '', protocol: '', onlineID: 0,
    hcp_mode: 0, team_mode: 0, pari: 0, updateSpeed: 0, laneStatus: 0,
    type: 0, data: 0, noPlayers: 0, activePlayer: -1, playedPlayerID: 0, playedPinPattern: 0,
    isAnyPlayerActive: 0, lastBallSpeed: 0, reverseArrows: 0, RedPin: 0,
    laneFinshFlag1: 0, laneFinshFlag2: 0, exciter: 0, practiceMethod: 0, practiceAmount: 0,
    teamName: ['', ''], competitionID: 0, StartTime: 0, EndTime: 0, LaneOffTime: 0, dllName: '',
    teamHCP: 0, useTeamHCP: false, totalSeries: 0, hdcp_rule: '\u0000', tpercent_hdcp: 0, tbase_hdcp: 0,
    t_above_percent: 0, tmax_hdcp: 0, t_min_ave: 0, t_extra_percent: 0, t_both_percent: 0,
    laneNumber, PerLongId: 0, ResvLongId: 0,
    player: players,
    tournamentGame: {
      vbsHere: 0, bmp_name: '', team_mode: 0, pari: 0, updateSpeed: 0, calculationSpeed: 0,
      showNextLane: 0, numReservPlayers: 0, movementFileName: ''
    },
    laneImageModifiedTime: 0, laneDataModifiedTime: 0, checkSum: 0
  };
}

// ---------------------------------------------------------------------------
// One OpenPlay game: one lane, or the odd/even pair of an American game.
//
// config:
//   lanes      [laneStruct] or [oddLaneStruct, evenLaneStruct] (made with makeLane)
//   isCFG      the protocol theme is a CFG one (CGameAbstract::isCFG)
//   redPinPercent  ScorerSettings::m_RedPin[lane] (0 = RedPin off for the lane)
//   rng        () => [0,1)
//   clock      () => ms, for timeOfThrow (defaults to Date.now)
// ---------------------------------------------------------------------------
export class OpenPlayGame {
  constructor(config) {
    this.lanes = config.lanes;
    this.isCFGTheme = !!config.isCFG;
    this.redPinPercent = config.redPinPercent || 0;
    this.rng = config.rng || Math.random;
    this.clock = config.clock || (() => Date.now());
    this.m_laneNumber = this.lanes[0].laneNumber;            // the odd lane's OpenPlay scores the pair
    this.m_oddLane = this.m_laneNumber;
    this.m_evenLane = this.lanes.length > 1 ? this.lanes[1].laneNumber : this.m_laneNumber + 1;
    this.events = [];                                          // what a render would tell LoadCom (animations)
  }

  get pis() { return this.lanes[0]; }                          // m_pPlayerInfoStruct

  // CGCI_info::GetPlayerInfoStruct(lane): m_pSharedMem[(lane + 1) % 2]
  getPlayerInfoStruct(lane) {
    if (lane === undefined) lane = this.m_laneNumber;
    const idx = (lane + 1) % 2;
    return this.lanes[idx] || this.lanes[0];
  }

  isCrosslane() { return (this.pis.type & GCI.LC_START_AMERICAN) !== 0; }

  // CGameAbstract::GetPlayer
  getPlayer(player) {
    if (player < 0 || player > 16) return null;
    if (this.isCrosslane()) {
      const p = player % 16;
      return p > 7 ? this.lanes[1].player[p - 8] : this.lanes[0].player[p];
    }
    if (player > 7) player = player % 8;
    return (this.m_laneNumber % 2) ? this.lanes[0].player[player] : (this.lanes[1] || this.lanes[0]).player[player];
  }

  getOtherLane(lane) {
    if (lane === undefined) lane = this.m_laneNumber;
    return lane === this.m_oddLane ? this.m_evenLane : this.m_oddLane;
  }

  // CGameAbstract::isCFG - a CFG theme, never for USALeague
  isCFG() {
    if (this.pis.dllName.indexOf('USALeague') >= 0) return false;
    return this.isCFGTheme;
  }

  isGameFinished(player) {
    const p = this.getPlayer(player);
    return !!p && isPlayerSerieComplete(p);
  }

  testBlind(player) {
    const p = this.getPlayer(player);
    if (!p) return false;
    return p.amrLeague.bowlerType === 4 || p.amrLeague.bowlerType === 3;
  }

  // CGameAbstract::AreAllGamesFinished (blind/vacant bowlers are finished when the rest are)
  areAllGamesFinished(lane) {
    let finished = 0, blindUnfinished = 0;
    let evenLane = (lane + 1) % 2;
    if (!this.isCrosslane()) evenLane = 0;
    const pis = this.getPlayerInfoStruct(lane);
    for (let player = 0; player < pis.noPlayers; player++) {
      if (this.isGameFinished(player + evenLane * 8)) finished++;
      else if (this.testBlind(player + evenLane * 8)) blindUnfinished++;
    }
    if (blindUnfinished + finished === pis.noPlayers) {
      for (let player = 0; player < pis.noPlayers; player++) {
        if (this.testBlind(player + evenLane * 8)) this.getPlayer(player + evenLane * 8).activeSquare = 20;
      }
      return true;
    }
    return false;
  }

  // CGameAbstract::MoveActiveMark
  moveActiveMark(activePlayer) {
    const p = this.getPlayer(activePlayer);
    const as = p.activeSquare;
    if (as === 21) return true;
    if (as < 19) {
      if (p.score[as - 1] === 10 && !isFirstBall(as, p.score)) return true;
      return isFirstBall(as, p.score);
    }
    if (as === 20) return !(p.score[18] + p.score[19] >= 10);
    return false;
  }

  // CGameAbstract::TestPlayer
  testPlayer(lane, player) {
    const p = this.getPlayer(player);
    if (!p) return false;
    const as = p.activeSquare;
    const ag = p.activeGame;
    const rev = this.pis.reverseArrows ? 1 : 0;
    const k = (lane + (player <= 7 ? 1 : 0) + rev + (as === 20 ? 1 : 0)) % 2;
    if (this.isCrosslane() && !this.pis.player[0].amrLeague.amrSwitch) {
      if (k) return ((as >> 1) % 2 !== 0) && !this.isGameFinished(player);
      return ((as >> 1) % 2 === 0) && !this.isGameFinished(player);
    }
    if (k) return ((as >> 1) % 2 !== ag % 2) && !this.isGameFinished(player);
    return ((as >> 1) % 2 === ag % 2) && !this.isGameFinished(player);
  }

  // CGameAbstract::SetRenderStatus
  setRenderStatus(lane, player, rs) {
    this.getPlayerInfoStruct(lane).activePlayer = player;
    if (player <= 7 || player === 8) rs.v |= 1;
    if (player > 7 || player === 0) rs.v |= 2;
    if (this.areAllGamesFinished(player <= 7 ? this.m_oddLane : this.m_evenLane)) player = -1;
    this.getPlayerInfoStruct(lane).isAnyPlayerActive = (player !== -1) ? 1 : 0;
    return player !== -1;
  }

  // CGameAbstract::GetNewPlayer
  getNewPlayer(lane, player, stopPlayer, rs) {
    do {
      if (this.testPlayer(lane, player) && !this.testBlind(player))
        return this.setRenderStatus(lane, player, rs);
    } while (++player < stopPlayer);
    return false;
  }

  // CGameAbstract::ActivateNextPlayer2
  activateNextPlayer2(lane, rs, active369 = false) {
    let activePlayer = this.getPlayerInfoStruct(lane).activePlayer;
    const notActive = activePlayer === -1;
    const oddN = this.getPlayerInfoStruct(this.m_oddLane).noPlayers;
    const evenN = this.getPlayerInfoStruct(this.m_evenLane).noPlayers;

    if (active369 && activePlayer !== -1) {
      if (activePlayer <= 7) { activePlayer++; if (activePlayer === oddN) activePlayer = 8; }
      else { activePlayer++; if (activePlayer === evenN + 8) activePlayer = 0; }
    }
    if (notActive) activePlayer = 0;

    if (activePlayer <= 7) {
      if (this.getNewPlayer(lane, activePlayer, oddN, rs)) return true;
      if (this.getNewPlayer(lane, 8, evenN + 8, rs)) return true;
      if (this.getNewPlayer(lane, 0, activePlayer, rs)) return true;
    } else {
      if (this.getNewPlayer(lane, activePlayer, evenN + 8, rs)) return true;
      if (this.getNewPlayer(lane, 0, oddN, rs)) return true;
      if (this.getNewPlayer(lane, 8, activePlayer, rs)) return true;
    }
    this.setRenderStatus(lane, activePlayer, rs);
    this.getPlayerInfoStruct(lane).activePlayer = -1;
    this.getPlayerInfoStruct(lane).isAnyPlayerActive = 0;
    return false;
  }

  // CGameAbstract::ActivateNextPlayer
  activateNextPlayer(lane, rs, active369 = false) {
    if (this.isCrosslane()) {
      const otherLane = this.getOtherLane(lane);
      this.activateNextPlayer2(lane, rs, active369);
      if (this.getPlayerInfoStruct(otherLane).activePlayer === -1)
        this.getPlayerInfoStruct(otherLane).activePlayer = this.getPlayerInfoStruct(lane).activePlayer;
      else
        this.getPlayerInfoStruct(otherLane).isAnyPlayerActive = 1;
      this.activateNextPlayer2(otherLane, rs);
    } else {
      const pC = this.getPlayerInfoStruct(this.m_laneNumber);
      for (let i = 0; i < pC.noPlayers; i++) {
        pC.activePlayer++;
        if (pC.activePlayer >= pC.noPlayers) pC.activePlayer = 0;
        if (!this.isGameFinished(pC.activePlayer)) break;
      }
    }
  }

  // The part of CGame::CheckGameFinished that decides the game is over and adds the
  // game to every bowler's totalPoints (once, guarded by laneFinshFlag1).
  checkGameFinished() {
    const cross = this.isCrosslane();
    if ((cross && this.areAllGamesFinished(this.m_oddLane) && this.areAllGamesFinished(this.m_evenLane)) ||
        (!cross && this.areAllGamesFinished(this.m_laneNumber))) {
      const isCFG = this.isCFG();
      const lanes = cross ? [0, 1] : [0];
      for (const li of lanes) {
        const tmpPis = this.lanes[li];
        if (tmpPis.laneFinshFlag1 !== 0) continue;
        for (let i = 0; i < tmpPis.noPlayers; i++) {
          const p = cross ? this.getPlayer(i + li * 8) : this.getPlayer(i);
          const sums = recalcScore(p.score, 21, true, isCFG);
          let score = 0;
          for (let j = 0; j < 10; j++) score += sums[j];
          if (this.pis.dllName.indexOf('VBS') >= 0)
            p.totalPoints += (tmpPis.hcp_mode === 2) ? score + p.hcp : score;
          else
            p.totalPoints += score + p.hcp;
        }
        tmpPis.laneFinshFlag1 = 1;
      }
      return true;
    }
    return false;
  }

  // CGame::CheckShortGame
  checkShortGame() {
    const ppp = this.getPlayer(0);
    if (!ppp) return;
    const bits = GCI.SCORING_SHORTGAME_2 | GCI.SCORING_SHORTGAME_3 | GCI.SCORING_SHORTGAME_4 | GCI.SCORING_SHORTGAME_5;
    if ((ppp.scoreMode & bits) === 0) return;
    let startSquare = 0;
    if (ppp.scoreMode & GCI.SCORING_SHORTGAME_2) startSquare = 16;
    else if (ppp.scoreMode & GCI.SCORING_SHORTGAME_3) startSquare = 14;
    else if (ppp.scoreMode & GCI.SCORING_SHORTGAME_4) startSquare = 12;
    else if (ppp.scoreMode & GCI.SCORING_SHORTGAME_5) startSquare = 10;
    for (let i = 0; i < 16; i++) {
      const p = this.getPlayer(i);
      if (!p) continue;
      for (let s = 0; s < startSquare; s++) p.score[s] = 0;
      p.activeSquare = startSquare;
    }
  }

  // CGame::StartGame (the scoring part) followed by CGameAbstract::RefreshGame.
  // The lane files arrive as LoadCom's start writes them: names, scoreMode, type,
  // every activeSquare 0, activePlayer 0.
  startGame() {
    this.checkShortGame();
    this.practiceInit();                               // CGameAbstract::TestFrames_Init, each lane's own
    for (const pis of this.lanes) {
      for (let p = 0; p < pis.noPlayers; p++)
        if (pis.player[p].scoreMode & GCI.SCORING_10TH) pis.player[p].activeSquare = 18;
      if (pis.practiceAmount > 0) pis.laneStatus = GCI.Practice;
    }
    this.pis.playedPlayerID = -2;                     // ONLINE_SEND_NONE
    // Each lane's OpenPlay draws its own RedPin at StartGame; one engine serves both here
    for (const pis of this.lanes) this.randomRedPin(pis);
    this.refreshGame(this.m_laneNumber);
  }

  // CGameAbstract::RefreshGame
  refreshGame(callingLane) {
    const rs = { v: 0 };
    let totalPlayer = this.pis.noPlayers;
    if (totalPlayer > 8) totalPlayer = 8;
    if (!this.isCrosslane() && this.pis.activePlayer >= 8) this.pis.activePlayer -= 8;
    this.pis.isAnyPlayerActive = this.pis.activePlayer !== -1 ? 1 : 0;

    for (let lane = 0; lane < this.lanes.length; lane++) {
      const pis = this.lanes[lane];
      for (let player = 0; player < totalPlayer; player++) {
        const p = pis.player[player];
        const mode = p.scoreMode;
        for (let sq = 0; sq < 18; sq += 2) {
          if (p.score[sq] === 10 && p.score[sq + 1] !== 0) p.score[sq + 1] = 0;
          if (mode & GCI.SCORING_369) {
            if (sq >= p.activeSquare && (sq === 4 || sq === 10 || sq === 16)) p.score[sq] = 10;
          } else if (sq >= p.activeSquare) {
            p.score[sq] = 0;
          }
        }
        if ((mode & GCI.SCORING_369) && (p.activeSquare === 4 || p.activeSquare === 10 || p.activeSquare === 16)) p.activeSquare += 2;
        if ((mode & GCI.SCORING_369) && (p.activeSquare === 5 || p.activeSquare === 11 || p.activeSquare === 17)) p.activeSquare++;
        const as = p.activeSquare;
        if ((as % 2) && as < 18 && p.score[as - 1] === 10) p.activeSquare++;
      }
    }
    this.checkGameFinished();
    if (this.isCrosslane()) this.activateNextPlayer(callingLane, rs);
    this.randomRedPin(this.pis, true);
  }

  // CGameAbstract::randomRedPin
  randomRedPin(pPlayInfo, refreshOnly = false) {
    if (pPlayInfo.RedPin === 0) return;
    let activePlayer = pPlayInfo.activePlayer;
    if (activePlayer < 0) activePlayer = 0; else activePlayer %= 8;
    const as = pPlayInfo.player[activePlayer].activeSquare;
    if (as >= 19) { pPlayInfo.RedPin = as - 5; return; }
    let redPin = 0;
    if (!refreshOnly) {
      const randomNumber = 1 + Math.floor(this.rng() * 100);
      if (randomNumber <= this.redPinPercent) redPin = 1;
      else redPin = 2 + (randomNumber % 19);
      pPlayInfo.RedPin = redPin;
    } else redPin = pPlayInfo.RedPin;
    if (redPin === 1) {
      pPlayInfo.player[activePlayer].status[as] |= GCI.REDPIN;
      if (!refreshOnly) this.events.push({ type: 'animation', lane: pPlayInfo.laneNumber, media: 'RedPinAlert.webm' });
    }
  }

  // CMultimedia::MM_GetExciter
  getExciter(pins, fallenPins, p, activePosition, fault) {
    const first = isFirstBall(activePosition, p.score);
    let numInARow = 0;
    if (fault) return { exciter: GCI.EXCITER_FAUL, numInARow };
    if (first && pins === 0x3FF) return { exciter: GCI.EXCITER_ZERO, numInARow };
    if (first && fallenPins === 10) {
      let n = 1;
      let pos = activePosition - 1;
      while (pos >= 0) {
        if (isFirstBall(pos, p.score)) {
          if (p.score[pos] === 10) n++; else break;
        }
        pos--;
      }
      return { exciter: GCI.EXCITER_STRIKE, numInARow: n };
    }
    if (!first && fallenPins === 10 && globCheckSplit(p.pinConfig[activePosition - 1])) return { exciter: GCI.EXCITER_SPMAKE, numInARow };
    if (!first && fallenPins === 10) return { exciter: GCI.EXCITER_SPARE, numInARow };
    if (!first && fallenPins < 10 && !globCheckSplit(p.pinConfig[activePosition - 1])) return { exciter: GCI.EXCITER_OPEN, numInARow };
    if (first && globCheckSplit(pins)) return { exciter: GCI.EXCITER_SPLIT, numInARow };
    if (first && pins && activePosition < 20) return { exciter: GCI.EXCITER_PIN, numInARow };
    return { exciter: GCI.EXCITER_NONE, numInARow };
  }

  // ---- the warm-up (inspelning): Slave/OPENPLAY/TestFrames.cpp and CGame::Score's dispatch ----
  // Per lane, as each lane's own OpenPlay keeps them: m_activeSquare (the square the serie
  // starts on, captured before the tenth frame's 18), m_status (the lane status a game has once
  // the practice is over). m_ballsElapsed is one counter for the pair, as TestBalls_Score counts
  // both lanes' bowlers in cross lane play.
  practiceInit(nowSec = Math.floor(this.clock() / 1000)) {
    this.practice = { activeSquare: [], status: [], ballsElapsed: 0, clockFrom: nowSec };
    this.lanes.forEach((pis, li) => {
      this.practice.status[li] = pis.laneStatus;
      if (pis.practiceAmount === 0) pis.practiceMethod = GCI.PRACTICE_NONE;
      if (pis.practiceMethod === GCI.PRACTICE_MINUTES) {
        for (let p = 0; p < 8; p++) pis.player[p].amrLeague.practiceElapsed = nowSec;    // the clock starts now
      } else if (pis.practiceMethod === GCI.PRACTICE_BALLS || pis.practiceMethod === GCI.PRACTICE_FRAMES) {
        for (let p = 0; p < 8; p++) pis.player[p].amrLeague.practiceElapsed = 0;
      }
      this.practice.activeSquare[li] = pis.player[0].activeSquare;
    });
  }

  laneIndexOf(lane) { return this.lanes.indexOf(this.getPlayerInfoStruct(lane)); }
  mStatus(lane) { const li = this.laneIndexOf(lane); return (this.practice && this.practice.status[li]) || GCI.Gameplay; }
  mActiveSquare(lane) { const li = this.laneIndexOf(lane); return (this.practice && this.practice.activeSquare[li]) || 0; }

  // A warm-up is being played on this lane (LanedataUtil::IsWarmUpBeingPlayed)
  isWarmUp(lane) {
    const pis = this.getPlayerInfoStruct(lane);
    if (pis.laneStatus === GCI.PracticeOver) return true;
    if (pis.practiceMethod === GCI.PRACTICE_NONE) return false;
    return pis.practiceAmount !== 0 || pis.player[0].amrLeague.practiceElapsed !== 0;
  }

  // LanedataUtil::PracticeSecondsLeft (no waiting clock in the game: it starts with the game)
  practiceSecondsLeft(lane, nowSec = Math.floor(this.clock() / 1000)) {
    const pis = this.getPlayerInfoStruct(lane);
    const used = nowSec - pis.player[0].amrLeague.practiceElapsed;
    return pis.practiceAmount * 60 - (used > 0 ? used : 0);
  }

  // What is left of the warm-up, for the game's status line: balls (counted inside OpenPlay,
  // in no lane file - the TV shows only the description), frames or seconds
  practiceLeft(lane) {
    const pis = this.getPlayerInfoStruct(lane);
    switch (pis.practiceMethod) {
      case GCI.PRACTICE_BALLS: {
        let n = this.pis.noPlayers;
        if (this.isCrosslane()) n = this.lanes[0].noPlayers + (this.lanes[1] ? this.lanes[1].noPlayers : 0);
        return { method: pis.practiceMethod, left: Math.max(0, n * this.pis.practiceAmount - this.practice.ballsElapsed) };
      }
      case GCI.PRACTICE_FRAMES: return { method: pis.practiceMethod, left: Math.max(0, pis.practiceAmount - pis.player[0].amrLeague.practiceElapsed) };
      case GCI.PRACTICE_MINUTES: return { method: pis.practiceMethod, left: Math.max(0, this.practiceSecondsLeft(lane)) };
      default: return pis.laneStatus === GCI.PracticeOver ? { method: GCI.PRACTICE_MINUTES, left: 0 } : null;
    }
  }

  // CGame::Score: the warm-up's balls go to TestFrames_Score / TestBalls_Score, every other ball
  // to CGameAbstract::Score (score() above)
  scoreBall(lane, pins, fallenPins, ballspeed = 0, fault = false) {
    const pis = this.getPlayerInfoStruct(lane);
    if (pis.practiceMethod !== GCI.PRACTICE_NONE && pis.practiceAmount === 0 && pis.player[0].amrLeague.practiceElapsed === 0)
      pis.practiceMethod = GCI.PRACTICE_NONE;
    switch (pis.practiceMethod) {
      case GCI.PRACTICE_MINUTES:
        return this.testFramesScore(lane, pins, fallenPins, ballspeed, fault);
      case GCI.PRACTICE_FRAMES:
        if (pis.player[0].amrLeague.practiceElapsed > pis.practiceAmount) {
          pis.activePlayer = 0;
          for (let p = 0; p < Math.min(8, pis.noPlayers); p++) {
            pis.practiceMethod = GCI.PRACTICE_NONE;
            pis.player[p].score.fill(0); pis.player[p].status.fill(0);
            pis.player[p].activeSquare = 0;
          }
        }
        return this.testFramesScore(lane, pins, fallenPins, ballspeed, fault);
      case GCI.PRACTICE_BALLS:
        return this.testBallsScore(lane, pins, fallenPins, ballspeed, fault);
      default: {
        pis.laneFinshFlag1 = 0; pis.laneFinshFlag2 = 0;
        if (this.isCrosslane()) { const o = this.getPlayerInfoStruct(this.getOtherLane(lane)); o.laneFinshFlag1 = 0; o.laneFinshFlag2 = 0; }
        return this.score(lane, pins, fallenPins, ballspeed, fault);
      }
    }
  }

  // CGameAbstract::Find1stValidPlayer / FindLastValidPlayer / CorrectActivePlayer / CleanPractice
  find1stValidPlayer(firstPlayer, noPlayers) {
    let v;
    for (v = firstPlayer; v <= firstPlayer + noPlayers; v++) if (!this.testBlind(v)) break;
    return v >= firstPlayer + noPlayers ? -1 : v;
  }
  findLastValidPlayer(firstPlayer, noPlayers) {
    let v;
    for (v = firstPlayer + noPlayers - 1; v >= firstPlayer; v--) if (!this.testBlind(v)) break;
    return v < firstPlayer ? -1 : v;
  }
  correctActivePlayer(currentPlayer, noPlayers, lane) {
    const firstPlayer = currentPlayer <= 7 ? 0 : 8;
    const last = this.findLastValidPlayer(firstPlayer, noPlayers), first = this.find1stValidPlayer(firstPlayer, noPlayers);
    if (last === -1 || first === -1) return currentPlayer;
    while (this.getPlayer(currentPlayer) && this.getPlayer(currentPlayer).amrLeague.bowlerType === GCI.VAC_BOWLER) {
      if (currentPlayer >= last) { currentPlayer = first; break; }
      currentPlayer++;
    }
    if (currentPlayer >= firstPlayer + noPlayers) currentPlayer = first;
    if (currentPlayer === first) this.cleanPractice(currentPlayer, lane);
    return currentPlayer;
  }
  cleanPractice(currentPlayer, lane) {
    const pis = this.getPlayerInfoStruct(lane);
    const firstPlayer = currentPlayer <= 7 ? 0 : 8;
    if (pis.activePlayer >= pis.noPlayers + firstPlayer - 1) {
      pis.activePlayer = firstPlayer;
      for (let player = 0; player < pis.noPlayers; player++) {
        const p = this.getPlayer(player + firstPlayer);
        p.score.fill(0); p.status.fill(0);
        p.activeSquare = this.mActiveSquare(lane);
      }
      if (pis.practiceMethod === GCI.PRACTICE_FRAMES)
        for (let player = 0; player < 8; player++) this.getPlayer(player + firstPlayer).amrLeague.practiceElapsed++;
    }
  }

  // CGameAbstract::TestFrames_Score - a warm-up ball in frames or on time: the ball is written on
  // the sheet (the TV's practice layout shows it), each finished frame passes the turn, and when
  // the turn has gone round every bowler's balls are wiped and (frames) one frame is counted
  testFramesScore(lane, pins, fallenPins, ballspeed, fault) {
    const pis = this.getPlayerInfoStruct(lane);
    const activePlayer = pis.activePlayer;
    if (activePlayer === -1) return null;
    const p = this.getPlayer(activePlayer);
    if (!p) return null;
    const activeSquare = p.activeSquare;
    if (activeSquare < 0 || activeSquare > 20) return null;
    p.cameraImageID[activeSquare] = 0;
    p.amrLeague.ballSpeed = kmhToMmPerS(ballspeed);
    if (fault) { p.status[activeSquare] |= GCI.FOUL; pins = 0x3FF; }
    const first = isFirstBall(activeSquare, p.score);
    if (globCheckSplit(pins & 0xFFFF) && first) p.status[activeSquare] |= GCI.SPLIT;
    if (!first) {
      const pre = p.score[activeSquare - 1];
      if (pre > fallenPins) fallenPins = 0; else fallenPins -= pre;
    }
    p.score[activeSquare] = fallenPins & 0xFF;
    if (first && p.score[activeSquare] === 10 && activeSquare < 18) p.activeSquare += 2;
    else p.activeSquare++;
    const { exciter, numInARow } = this.getExciter(pins, fallenPins, p, activeSquare, fault);
    let frameEnded = false, ended = false;
    if (this.moveActiveMark(pis.activePlayer)) {
      frameEnded = true;
      pis.activePlayer++;
      if (lane % 2) pis.activePlayer = this.correctActivePlayer(pis.activePlayer % 8, pis.noPlayers, lane);
      else pis.activePlayer = this.correctActivePlayer(pis.activePlayer, pis.noPlayers, lane);
      const offset = this.isCrosslane() ? ((lane + 1) % 2) * 8 : 0;
      if (pis.practiceMethod === GCI.PRACTICE_FRAMES && pis.player[0].amrLeague.practiceElapsed >= pis.practiceAmount) {
        pis.practiceMethod = GCI.PRACTICE_NONE;
        pis.activePlayer = offset;
        pis.laneStatus = this.mStatus(lane);
        for (let player = 0; player < pis.noPlayers; player++) {
          const q = this.getPlayer(player + offset);
          q.score.fill(0); q.status.fill(0);
          q.activeSquare = this.mActiveSquare(lane);
        }
        ended = true;
      }
    }
    pis.isAnyPlayerActive = pis.activePlayer >= 0 ? 1 : 0;
    return { practice: true, practiceEnded: ended, lane, playerIndex: activePlayer, player: p, ballIndex: activeSquare,
      firstBall: first, pins, fallenPins, ballPins: fallenPins, exciter, numInARow, frameEnded, gameFinished: false,
      split: (p.status[activeSquare] & GCI.SPLIT) !== 0, noTapReset: false, redPinStrike: false };
  }

  // CGameAbstract::TestBalls_Score - a warm-up counted in balls: nothing is written on the sheet,
  // every ball passes the turn, and after noPlayers x practiceAmount balls the serie starts
  testBallsScore(lane, pins, fallenPins, ballspeed, fault) {
    const pis = this.getPlayerInfoStruct(lane);
    const activePlayer = pis.activePlayer;
    if (activePlayer < 0) return null;
    const p = this.getPlayer(activePlayer);
    this.practice.ballsElapsed++;
    const P = this.getPlayerInfoStruct();
    let balls = P.noPlayers * P.practiceAmount - this.practice.ballsElapsed;
    if (this.isCrosslane()) balls = (this.getPlayerInfoStruct(1).noPlayers + this.getPlayerInfoStruct(2).noPlayers) * P.practiceAmount - this.practice.ballsElapsed;
    let ended = false;
    if (balls < 1) {
      const mLane = this.m_laneNumber;
      P.practiceMethod = GCI.PRACTICE_NONE;
      P.activePlayer = 0;
      for (let player = 0; player < P.noPlayers; player++) {
        P.player[player].score.fill(0); P.player[player].status.fill(0);
        P.player[player].activeSquare = this.mActiveSquare(mLane);
      }
      P.laneStatus = this.mStatus(mLane);
      if (this.isCrosslane()) {
        const O = this.getPlayerInfoStruct(this.getOtherLane());
        O.practiceMethod = GCI.PRACTICE_NONE;
        O.activePlayer = 8;
        O.laneStatus = this.mStatus(mLane);
        for (let player = 0; player < P.noPlayers; player++) {
          O.player[player].score.fill(0); O.player[player].status.fill(0);
          O.player[player].activeSquare = this.mActiveSquare(mLane);
        }
      }
      ended = true;
    } else this.advancePracticePlayer(lane);
    return { practice: true, practiceEnded: ended, lane, playerIndex: activePlayer, player: p, ballIndex: p ? p.activeSquare : 0,
      firstBall: true, pins, fallenPins, ballPins: fallenPins, exciter: GCI.EXCITER_NONE, numInARow: 0, frameEnded: true,
      gameFinished: false, split: false, noTapReset: false, redPinStrike: false };
  }

  // CGameAbstract::AdvancePracticePlayer
  advancePracticePlayer(lane) {
    const pis = this.getPlayerInfoStruct(lane);
    if (!pis || pis.noPlayers <= 0) return;
    const firstPlayer = pis.activePlayer <= 7 ? 0 : 8;
    const lastPlayer = firstPlayer + pis.noPlayers - 1;
    let next = pis.activePlayer + 1;
    if (next > lastPlayer || next < firstPlayer) next = firstPlayer;
    for (let guard = 0; guard < pis.noPlayers && this.testBlind(next); guard++) { next++; if (next > lastPlayer) next = firstPlayer; }
    if (this.testBlind(next)) return;
    pis.activePlayer = next;
  }

  // CGame::TestFrames_UpdateClock, the end of a warm-up on time: first the stop picture
  // (GCI_PracticeOver, practiceAmount 0 - practice balls are still practice balls), 30 s later
  // the score rows wiped and the serie started (practiceClockFinish)
  practiceClockOver() {
    const changed = [];
    this.lanes.forEach((pis) => {
      if (pis.practiceMethod !== GCI.PRACTICE_MINUTES || pis.laneStatus === GCI.PracticeOver) return;
      pis.laneStatus = GCI.PracticeOver;
      pis.practiceAmount = 0;
      changed.push(pis.laneNumber);
    });
    return changed;
  }
  practiceClockFinish() {
    const changed = [];
    this.lanes.forEach((pis, li) => {
      if (pis.practiceMethod !== GCI.PRACTICE_MINUTES) return;
      pis.practiceMethod = GCI.PRACTICE_NONE;
      pis.activePlayer = this.isCrosslane() ? ((pis.laneNumber + 1) % 2) * 8 : 0;
      for (let player = 0; player < pis.noPlayers; player++) {
        pis.player[player].score.fill(0); pis.player[player].status.fill(0);
        pis.player[player].activeSquare = this.practice.activeSquare[li] || 0;
      }
      if (this.isCrosslane()) this.activateNextPlayer(pis.laneNumber, { v: 0 });    // practiceFinished: the cross lane branch ignores it
      else pis.activePlayer = 0;
      pis.isAnyPlayerActive = pis.activePlayer >= 0 ? 1 : 0;
      pis.laneStatus = this.practice.status[li] || GCI.Gameplay;
      changed.push(pis.laneNumber);
    });
    return changed;
  }

  // LoadCom's End practice (StopPractice -> StopPracticeOnLane -> EndPracticeOnLaneData): only
  // a lane that is practising (IsPractising); the practice balls go (ResetLaneScoreOnly), every
  // bowler starts the serie on its first ball (FirstBallOfSerie), serie and totals are kept. An
  // American pair ends both lanes, the odd one with bowler 0 up, the even one with bowler 8.
  // Returns the lanes it changed.
  endPracticeFromConsole(lane) {
    const ends = this.isCrosslane() ? [[this.m_oddLane, 0], [this.m_evenLane, 8]] : [[lane, 0]];
    const changed = [];
    for (const [l, active] of ends) {
      const pis = this.getPlayerInfoStruct(l);
      const practising = pis.practiceMethod !== GCI.PRACTICE_NONE || pis.laneStatus === GCI.Practice || pis.laneStatus === GCI.PracticeOver;
      if (!practising) continue;
      pis.playedPinPattern = 0;
      for (let i = 0; i < 8; i++) {
        const p = pis.player[i];
        p.activeSquare = 0;
        p.score.fill(0); p.cameraImageID.fill(0); p.status.fill(0); p.pinConfig.fill(0); p.timeOfThrow.fill(0); p.ballSpeed.fill(0);
        p.activeSquare = firstBallOfSerie(p.scoreMode);
      }
      pis.practiceMethod = GCI.PRACTICE_NONE;
      pis.practiceAmount = 0;
      pis.playedPlayerID = GCI.ONLINE_SEND_ALL;
      pis.activePlayer = active;
      pis.isAnyPlayerActive = pis.noPlayers > 0 ? 1 : 0;
      if (pis.laneStatus === GCI.Practice || pis.laneStatus === GCI.PracticeOver) pis.laneStatus = this.mStatus(l);
      changed.push(l);
    }
    // the game's warm-up clock ends with it (OpenPlay's own clock thread would end it again
    // 10-40 s later and wipe the balls bowled meanwhile; the game does not - see the README)
    if (changed.length && this.practice) this.practice.endedByConsole = true;
    return changed;
  }

  // The bowler up on a lane: { index (0..15), player } or null.
  activeOn(lane) {
    const pis = this.getPlayerInfoStruct(lane);
    if (pis.activePlayer < 0 || !pis.isAnyPlayerActive) return null;
    const p = this.getPlayer(pis.activePlayer);
    return p ? { index: pis.activePlayer, player: p } : null;
  }

  // Whether the next ball of the bowler up on `lane` is a first ball (a full rack).
  nextBallIsFirst(lane) {
    const a = this.activeOn(lane);
    return a ? isFirstBall(a.player.activeSquare, a.player.score) : true;
  }

  // CGameAbstract::Score(lane, pins, fallenPins, ballspeed, fault)
  //   pins       mask of pins STANDING after the ball (bit0 = pin 1)
  //   fallenPins pins down in this frame so far, 10 - standing (cumulative over the frame)
  // Returns a description of what happened, or null when the ball is not accepted.
  score(lane, pins, fallenPins, ballspeed = 0, fault = false) {
    const rs = { v: 0 };
    let faultResetNow = false;
    const pLaneInfo = this.getPlayerInfoStruct(lane);
    let activePlayer = pLaneInfo.activePlayer;
    if (activePlayer < 0) return null;
    const pActivePlayer = this.getPlayer(activePlayer);
    const otherLane = this.getOtherLane(lane);

    if (this.areAllGamesFinished(lane) && this.areAllGamesFinished(otherLane)) return null;
    if (!pActivePlayer || pActivePlayer.activeSquare < 0 || pActivePlayer.activeSquare >= 21) return null;

    this.getPlayerInfoStruct(this.m_laneNumber).lastBallSpeed = kmhToMmPerS(ballspeed);
    const activeSquare = pActivePlayer.activeSquare;
    const bIsFirstBall = isFirstBall(activeSquare, pActivePlayer.score);

    // reset status for this throw, keep the RedPin bit
    const redPinStatus = (pActivePlayer.status[activeSquare] & GCI.REDPIN) !== 0;
    pActivePlayer.status[activeSquare] = pActivePlayer.status[activeSquare] & GCI.CHANGED;
    if (redPinStatus) pActivePlayer.status[activeSquare] |= GCI.REDPIN;

    let noTapReset = false;
    let noTapLimit = 10, noTapMode = 0;
    const mode = pActivePlayer.scoreMode;
    if (mode & GCI.PIN6_NO_TAP) { noTapMode = GCI.NOTAP; noTapLimit = 6; }
    else if (mode & GCI.PIN7_NO_TAP) { noTapMode = GCI.NOTAP; noTapLimit = 7; }
    else if (mode & GCI.PIN8_NO_TAP) { noTapMode = GCI.NOTAP; noTapLimit = 8; }
    else if (mode & GCI.PIN9_NO_TAP) { noTapMode = GCI.NOTAP; noTapLimit = 9; }

    if (fallenPins >= noTapLimit && bIsFirstBall && fallenPins !== 10) {
      noTapReset = true;
      fallenPins = 10;
      pins = 0;
      pActivePlayer.status[activeSquare] |= noTapMode;
    }
    if (mode & GCI.SCORING_MINI) {
      if (bIsFirstBall && (fallenPins === 0 || fault)) {
        fault = false;
        noTapReset = true;
        fallenPins = 10;
        pins = 0;
        pActivePlayer.status[activeSquare] |= noTapMode;
      } else if (!bIsFirstBall) {
        const newPrePins = pActivePlayer.score[activeSquare - 1];
        if (newPrePins >= fallenPins || fault) {
          fault = false;
          fallenPins = 10;
          pins = 0;
          pActivePlayer.status[activeSquare] |= noTapMode;
        }
      }
    }

    pActivePlayer.cameraImageID[activeSquare] = 0;
    pActivePlayer.amrLeague.ballSpeed = kmhToMmPerS(ballspeed);

    if (fault) {
      pActivePlayer.status[activeSquare] |= GCI.FOUL;
      pins = 0x3FF;
      fallenPins = 0;
      // m_forceResetOnFoul only drives the pinsetter; nothing of the scoring depends on it
    }

    // split
    if (globCheckSplit(pins & 0xFFFF) && bIsFirstBall && !noTapReset)
      pActivePlayer.status[activeSquare] |= GCI.SPLIT;

    let tempPins = fallenPins;
    if (!bIsFirstBall) {
      const prevPins = pActivePlayer.score[activeSquare - 1];
      if (prevPins > fallenPins) tempPins = 0;
      else tempPins -= prevPins;
    }
    pActivePlayer.score[activeSquare] = tempPins & 0xFF;

    // ball speed in km/h * 100, as CGameAbstract::Score stores it
    const kmh = ballspeed;
    pActivePlayer.ballSpeed[activeSquare] = Math.floor(kmh * 100);
    if (bIsFirstBall) {
      pActivePlayer.averageBallSpeedFirst = Math.floor((kmh + pActivePlayer.averageBallSpeedFirst * pActivePlayer.numFirst) / (pActivePlayer.numFirst + 1));
      pActivePlayer.numFirst++;
    } else {
      pActivePlayer.averageBallSpeedSecond = Math.floor((kmh + pActivePlayer.averageBallSpeedSecond * pActivePlayer.numSecond) / (pActivePlayer.numSecond + 1));
      pActivePlayer.numSecond++;
    }
    const now = new Date(this.clock());
    pActivePlayer.timeOfThrow[activeSquare] = ((now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) * 1000) + now.getMilliseconds();
    pActivePlayer.pinConfig[activeSquare] = pins & 0x3FF;

    pActivePlayer.activeSquare++;
    if (bIsFirstBall && pActivePlayer.score[activeSquare] === 10 && activeSquare < 18) {
      pActivePlayer.score[activeSquare + 1] = 0;
      pActivePlayer.pinConfig[activeSquare + 1] = 1023;
      pActivePlayer.activeSquare++;
    }
    pLaneInfo.playedPlayerID = pActivePlayer.playerIdNumber;
    pLaneInfo.playedPinPattern = pActivePlayer.pinConfig[activeSquare];

    let active369 = false;
    if (mode & GCI.SCORING_369) {
      const as = pActivePlayer.activeSquare;
      if (as === 4 || as === 10 || as === 16) {
        active369 = true;
        pActivePlayer.score[as] = 10;
        pActivePlayer.score[as + 1] = 0;
        pActivePlayer.activeSquare += 2;
      }
    }

    if (this.isCFG() && fallenPins === 10 && (GCI.LC_START_OPENPLAY === (pLaneInfo.type & ~GCI.LC_START_AMERICAN))) {
      if (pActivePlayer.activeSquare === 19) pActivePlayer.activeSquare += 2;
      else if (pActivePlayer.activeSquare === 20) pActivePlayer.activeSquare++;
    }

    let frameEnded = false;
    if (this.moveActiveMark(activePlayer) || active369) {
      frameEnded = true;
      this.activateNextPlayer(lane, rs, active369);
    }

    const bGameFinished = this.checkGameFinished();
    if (bGameFinished) {
      pLaneInfo.activePlayer = -1;
      pLaneInfo.isAnyPlayerActive = 0;
    }

    const { exciter, numInARow } = this.getExciter(pins, fallenPins, pActivePlayer, activeSquare, fault);

    // RedPin strike: the head pin was the red one and the ball was a strike
    const redPinStrike = pLaneInfo.RedPin === 1 && exciter === GCI.EXCITER_STRIKE;
    if (redPinStrike) this.events.push({ type: 'animation', lane: pLaneInfo.laneNumber, media: 'RedPinStrike.webm' });

    pLaneInfo.exciter = exciter;
    if (!bIsFirstBall || exciter === GCI.EXCITER_STRIKE) this.randomRedPin(pLaneInfo);

    if (this.isCrosslane()) {
      const other = this.getPlayerInfoStruct(otherLane);
      other.exciter = exciter;
      other.playedPlayerID = pLaneInfo.playedPlayerID;
    }

    return {
      lane, playerIndex: activePlayer, player: pActivePlayer, ballIndex: activeSquare,
      firstBall: bIsFirstBall, pins, fallenPins, ballPins: tempPins, exciter, numInARow,
      noTapReset, redPinStrike, frameEnded: frameEnded || bGameFinished, gameFinished: bGameFinished,
      split: (pActivePlayer.status[activeSquare] & GCI.SPLIT) !== 0
    };
  }
}

// ---------------------------------------------------------------------------
// The start a lane console sends (LoadComWebService_Console::StartBowling): the
// game type and each bowler's scoreMode from the chosen play method.
// ---------------------------------------------------------------------------
export const PLAY_METHODS = {
  normal:  { type: GCI.LC_START_OPENPLAY, scoreMode: GCI.SCORING_NORMAL, value: 'Starta Vanlig Bowling' },
  369:     { type: GCI.LC_START_369, scoreMode: GCI.SCORING_369, value: 'Starta 3-6-9' },
  mini:    { type: GCI.LC_START_OPENPLAY, scoreMode: GCI.SCORING_MINI, value: 'Starta Mini Bowling' },
  tenth:   { type: GCI.LC_START_OPENPLAY, scoreMode: GCI.SCORING_10TH, value: 'Starta 10th Frame' },
  notap6:  { type: GCI.LC_START_NOTAP, scoreMode: GCI.PIN6_NO_TAP, value: 'Starta NoTap (Limit 6)' },
  notap7:  { type: GCI.LC_START_NOTAP, scoreMode: GCI.PIN7_NO_TAP, value: 'Starta NoTap (Limit 7)' },
  notap8:  { type: GCI.LC_START_NOTAP, scoreMode: GCI.PIN8_NO_TAP, value: 'Starta NoTap (Limit 8)' },
  notap9:  { type: GCI.LC_START_NOTAP, scoreMode: GCI.PIN9_NO_TAP, value: 'Starta NoTap (Limit 9)' },
  short2:  { type: GCI.LC_START_SHORTGAME, scoreMode: GCI.SCORING_SHORTGAME_2, value: 'Short Game 2' },
  short3:  { type: GCI.LC_START_SHORTGAME, scoreMode: GCI.SCORING_SHORTGAME_3, value: 'Short Game 3' },
  short4:  { type: GCI.LC_START_SHORTGAME, scoreMode: GCI.SCORING_SHORTGAME_4, value: 'Short Game 4' },
  short5:  { type: GCI.LC_START_SHORTGAME, scoreMode: GCI.SCORING_SHORTGAME_5, value: 'Short Game 5' },
  cfg:     { type: GCI.LC_START_OPENPLAY, scoreMode: GCI.SCORING_NORMAL, value: 'Starta Vanlig Bowling', cfg: true }
};

// Builds the lane(s) for an open play start and returns a started OpenPlayGame.
//   names: [{name, ...}] in playing order; american: two lanes, split as the
//   reception's F2 splits a booking (first half on the odd lane).
//   practiceMethod / practiceAmount: the warm-up the start carries in the lane file (the
//   reception's F2 "Inspelning"): GCI.PRACTICE_BALLS / _FRAMES / _MINUTES and how many
export function startOpenPlay({ method, names, american = false, laneNumber = 1, redPinPercent = 0, rng, clock, protocol = 'Standard',
  practiceMethod = 0, practiceAmount = 0 }) {
  const pm = PLAY_METHODS[method] || PLAY_METHODS.normal;
  const lanes = american ? [makeLane(laneNumber), makeLane(laneNumber + 1)] : [makeLane(laneNumber)];
  const split = american ? Math.ceil(names.length / 2) : names.length;
  const groups = american ? [names.slice(0, split), names.slice(split)] : [names];
  lanes.forEach((pis, li) => {
    pis.type = pm.type | (american ? GCI.LC_START_AMERICAN : 0);
    pis.laneStatus = GCI.Gameplay;
    pis.protocol = pm.cfg ? 'Viking (cfg)' : protocol;
    pis.RedPin = redPinPercent > 0 ? 1 : 0;
    pis.competitionID = 0;
    pis.StartTime = 0;
    pis.practiceMethod = practiceAmount > 0 ? practiceMethod : 0;
    pis.practiceAmount = practiceAmount > 0 ? practiceAmount : 0;
    pis.booking_name = 'Viking Bowling';
    pis.noPlayers = groups[li].length;
    pis.activePlayer = groups[li].length ? 0 : -1;
    pis.isAnyPlayerActive = groups[li].length ? 1 : 0;
    groups[li].forEach((n, i) => {
      const p = makePlayer(n.name, i + li * 100, pm.scoreMode);
      p.hcp = n.hcp || 0;
      pis.player[i] = p;
    });
  });
  // In cross lane play both lane files arrive with activePlayer 0; RefreshGame's
  // ActivateNextPlayer then gives each lane its first bowler by TestPlayer.
  const game = new OpenPlayGame({ lanes, isCFG: !!pm.cfg, redPinPercent, rng, clock });
  game.startGame();
  return game;
}

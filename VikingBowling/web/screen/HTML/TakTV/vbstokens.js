// ---------------------------------------------------------------------------
// vbstokens.js - the "#TOKEN#" vocabulary of the scoring protocol, in HTML land.
//
// This is a straight port of the pieces of the C++ renderer that turn lane data
// into the strings the protocol draws:
//
//   CGame::GetText          (Slave/OPENPLAY/Game.cpp)      -> vbsGetText
//   RecalcScore/IsFirstBall (scoring/bowlingscore)         -> vbsRecalcScore/vbsIsFirstBall
//   CProtocol::GetTotal     (Slave/OPENPLAY/Protocol.cpp)  -> getTotal
//   CProtocol::StrikeSequence / TruncatePlayerName         -> strikeSequence/truncatePlayerName
//   LanedataUtil::GameModeToText                           -> gameModeToText
//
// Input is the lane-file JSON (CGCI_info::GetJsonFromPlayInfo), so every value
// arrives as a string and has to be parsed - that is what num()/str() are for.
//
// Deliberately NOT reusing commonAPI.js recalcScore(): that one is a simplified
// variant (it drops the spare and previous-strike suppression rules and the
// 10th-frame early returns), and this file has to agree with the C++ to the
// last frame or the HTML scoresheet would differ from the TV.
//
// Hence the vbs prefix on both. They were called recalcScore/isFirstBall, the
// same bare global names commonAPI.js uses for its own pair, which was safe only
// for as long as no page loaded both files - whichever script tag came last
// would silently win. The HTML web console is the first page that does load
// both: it needs commonAPI for its transport and this file for its sheet. The
// prefix is what keeps the two ports apart, so the console's correction grid
// goes on using commonAPI's and the drawn sheet goes on using this one.
// ---------------------------------------------------------------------------

/* global vbsWinPathToUrl */
/* exported vbsGetText, vbsMakeContext */

// GCI.h status bits
// Where CGame::GetText looks up a #teamLogo_n#, as a URL relative to this page
// (the page sits four levels below C:\Viking2001).
var VBS_CLUBLOGO_DIR = '../../../../v3gfx/Backgrounds/ClubLogos/';

var GCI_SPLIT = 0x0001;
var GCI_CHANGED = 0x0002;
var GCI_FOUL = 0x0004;
var GCI_NOTAP = 0x0008;
var GCI_REDPIN = 0x0010;

// GCI.h scoring modes
var GCI_SCORING_NORMAL = 0x0000;
var GCI_PIN9_NO_TAP = 0x0001;
var GCI_PIN8_NO_TAP = 0x0002;
var GCI_PIN7_NO_TAP = 0x0004;
var GCI_PIN6_NO_TAP = 0x0008;
var GCI_SCORING_369 = 0x0010;
var GCI_SCORING_MINI = 0x0020;
var GCI_SCORING_10TH = 0x0040;
var GCI_SCORING_SHORTGAME_2 = 0x0080;
var GCI_SCORING_SHORTGAME_3 = 0x0100;
var GCI_SCORING_SHORTGAME_4 = 0x0200;
var GCI_SCORING_SHORTGAME_5 = 0x0400;

// GCI.h bowler types ("Do NOT change sequence below")
var GCI_REG_BOWLER = 0;
var GCI_SUB_BOWLER = 1;
var GCI_PACER_BOWLER = 2;
var GCI_VAC_BOWLER = 3;
var GCI_BLIND_BOWLER = 4;

// GCI.h lane status
var GCI_Timeplay = 1;
var GCI_Gameplay = 2;
var GCI_PracticeOver = 12;

// GCI.h, GCI_PRACTICE_*
var GCI_PRACTICE_NONE = 0;
var GCI_PRACTICE_MINUTES = 1;
var GCI_PRACTICE_FRAMES = 2;
var GCI_PRACTICE_BALLS = 3;

// A GSX training game is marked by practiceAmount, not by a type of its own.
// 66 is what starts one and 67 is that value after the ++ in
// CScreenPainter::PainterThread - "it is bad coding style that training and
// practice mixed up, but we have to accept history heritage", as the comment
// there puts it. Both mean the same thing.
var VBS_GSX_TRAINING_1 = 66;
var VBS_GSX_TRAINING_2 = 67;

function vbsIsGsxTraining(json) {
  var amount = json ? parseInt(json.practiceAmount, 10) : 0;
  return amount === VBS_GSX_TRAINING_1 || amount === VBS_GSX_TRAINING_2;
}

// The RedPin the sheet draws by: none while a warm-up is played - no red pin on
// the rack, no RED PIN badge (#IS_REDPIN#), no red pin frame mark - else the
// lane's own (the rule: "RedPin alert or animation or image should not
// show in practice period"). Port of LanedataUtil::RedPinShown and
// IsWarmUpBeingPlayed (shared/lanedata/LanedataUtil.cpp): a practice method set
// (but not one configured as nothing at all - no amount, nothing counted, as the
// #PRACTICE# token below reads it), or OpenPlay's stop picture (GCI_PracticeOver)
// - not GCI_Practice alone, which a game moved or restored after its warm-up is
// bowled in. Change the two together.
function vbsRedPinShown(json) {
  var first = json.players ? json.players['player 1'] : null;
  var elapsed = (first && first.amrLeague) ? vbsNum(first.amrLeague.practiceElapsed) : 0;
  var warmUp = vbsNum(json.laneStatus) === GCI_PracticeOver ||
    (vbsNum(json.practiceMethod) !== GCI_PRACTICE_NONE &&
     (vbsNum(json.practiceAmount) !== 0 || elapsed !== 0));
  return warmUp ? 0 : vbsNum(json.RedPin);
}

// CScreenPainter::BinPinToString - "1,2,3,4,5,6,7,8,9,10" for a full rack.
function vbsPinsToString(pinMask) {
  var out = '';
  for (var i = 9; i >= 0; i--) {
    if ((pinMask >> i) & 1) out = (i + 1) + (out === '' ? '' : ',') + out;
  }
  return out;
}

// CTrainingProgram::GetPinsFromPinsStr, literally: "10" is looked for first and
// struck out, then each digit 1..9 in turn, each only once. A substring search
// rather than a parse, so "1,10" and "10,1" both give pins 1 and 10 - keep it
// this way, the ini files are written to suit it.
function vbsPinsFromString(text) {
  var work = String(text || '');
  var pins = 0;

  var at = work.indexOf('10');
  if (at >= 0) {
    work = work.substring(0, at) + 'x' + work.substring(at + 1);
    pins |= (1 << 9);
  }

  for (var pos = 1; pos < 10; pos++) {
    var digit = String(pos);
    var found = work.indexOf(digit);
    if (found >= 0) {
      work = work.substring(0, found) + 'x' + work.substring(found + 1);
      pins |= (1 << (pos - 1));
    }
  }

  return pins;
}

// tdf.h
var VBS_CONSTANT = 0x5B;

// The handful of CLanguage strings the Viking protocol asks for, taken from
// C:\Viking2001\GameConsole\Languages\*.lang. Anything else falls back to the id
// itself, exactly as CLanguage does for an unknown key.
//
// These are only the fallback. vbsLoadLanguage() reads the hall's real .lang
// file - the same file CLanguage::GetNewLanguage parses, under the document root
// - and merges it over the table below, so a hall that has translated or
// reworded a string gets its own text and every id in that file becomes
// available, not just these seven.
var VBS_LANG = {
  Svenska: {
    IDS_LANE: 'Bana', IDS_GAME: 'Serie', IDS_HCPD: 'HCP', IDS_SCRD: 'SER',
    IDS_TOTD: 'TOT', IDS_SPEED: '%.1f km/h', IDS_NEXT_GAME_LANED: 'N\u00e4sta bana:'
  },
  English: {
    IDS_LANE: 'Lane', IDS_GAME: 'Game', IDS_HCPD: 'HCP', IDS_SCRD: 'Game',
    IDS_TOTD: 'TOT', IDS_SPEED: '%.1f mph', IDS_NEXT_GAME_LANED: 'Next lane:'
  }
};

// Reads the hall's own language file and merges it over the fallback above.
//
// Same file CLanguage::GetNewLanguage parses on the slave -
// C:\Viking2001\GameConsole\Languages\<language>.lang, which is under this
// server's document root - and the same shape: an id, whitespace, then the text
// in double quotes, with anything else ignored. It is CP1252, like every other
// runtime data file on this rig, so it is decoded explicitly rather than left to
// fetch()'s UTF-8 assumption, which would turn every a-ring into U+FFFD.
//
// Returns a promise so the caller can re-render when it lands; a miss leaves the
// fallback table in place and is not an error worth showing on a lane TV.
function vbsLoadLanguage(language, into) {
  var name = String(language || 'Svenska').trim();
  var url = '/GameConsole/Languages/' + encodeURIComponent(name) + '.lang';

  var settle = function () {
    var table = VBS_LANG[into] || (VBS_LANG[into] = {});
    Object.defineProperty(table, '__settled', { value: true, enumerable: false, configurable: true });
  };

  return vbsFetch1252(url).then(function (text) {
    var table = VBS_LANG[into] || (VBS_LANG[into] = {});
    settle();
    var lines = text.split(/\r?\n/);
    var found = 0;

    for (var i = 0; i < lines.length; i++) {
      var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]*)"/.exec(lines[i]);
      if (!m) continue;
      table[m[1]] = m[2];
      found++;
    }

    return found;
  }, function (error) {
    settle();
    throw error;
  });
}

// CLanguage::GetText: the string, or - for an id the language file does not
// have - the id itself, which is what the lane TV then draws. The id is only
// answered once the hall's own file has been read (or found missing), so the
// fallback table above cannot put "IDS_..." on a screen for the moment before
// the file arrives; until then a missing string is empty.
function vbsLangText(ctx, id) {
  var v = ctx.lang[id];
  if (v !== undefined && v !== null) return v;
  return ctx.lang.__settled ? id : '';
}

function vbsNum(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function vbsStr(v) {
  return (v === undefined || v === null) ? '' : String(v);
}

// The lane file stores score/status/... as objects keyed "1".."21"; the C++ code
// indexes them 0-based. Flatten once so every port below can stay 0-based.
function vbsArray(obj, count) {
  var out = [];
  for (var i = 0; i < count; i++)
    out.push(vbsNum(obj ? obj[String(i + 1)] : 0));
  return out;
}

// --- scoring -------------------------------------------------------------

function vbsIsFirstBall(slag, score) {
  return !((slag < 19 && (slag % 2)) ||
    (slag === 20 && score[18] === 10 && score[19] !== 10) ||
    (slag === 19 && score[18] !== 10));
}

// Port of RecalcScore (scoring/bowlingscore/bowlingcalculations.cpp).
function vbsRecalcScore(pResults, activePos, bHideStrikeSequence, isCFG) {
  if (activePos === undefined) activePos = 21;
  if (bHideStrikeSequence === undefined) bHideStrikeSequence = true;
  if (isCFG === undefined) isCFG = false;

  var pSumArray = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var i;

  // Step 1 - plain sums, no bonus
  for (i = 0; i < 9; i++)
    pSumArray[i] = pResults[i * 2] + pResults[i * 2 + 1];
  pSumArray[9] = pResults[18] + pResults[19] + pResults[20];

  // Step 2 - spare bonus (no bonus in frame 10)
  for (i = 0; i < (isCFG ? 10 : 9); i++) {
    if (pResults[i * 2] + pResults[i * 2 + 1] >= 10 && pResults[i * 2] !== 10)
      pSumArray[i] += isCFG ? pResults[i * 2] : pResults[(i + 1) * 2];
  }

  // Step 3 - strike bonus (no bonus in frame 10)
  for (i = 0; i < (isCFG ? 10 : 9); i++) {
    if (pResults[i * 2] === 10) {
      if (isCFG) {
        pSumArray[i] += 20;
      } else {
        pSumArray[i] += pResults[(i + 1) * 2] + pResults[(i + 1) * 2 + 1];
        if (pResults[(i + 1) * 2] === 10 && i !== 8)
          pSumArray[i] += pResults[(i + 2) * 2];
      }
    }
  }

  if (isCFG) return pSumArray;

  // Step 4 - blank out anything a future ball can still change
  var pos;
  if (activePos < 2) return pSumArray;

  if (activePos > 18)
    pos = activePos - 1;
  else if ((activePos % 2 === 0) && (pResults[activePos - 2] === 10))
    pos = activePos - 2;
  else
    pos = activePos - 1;

  if (pos === 20) return pSumArray;
  if (pos === 19 && (pResults[18] + pResults[19]) < 10) return pSumArray;

  if (bHideStrikeSequence) {
    if (vbsIsFirstBall(pos, pResults))
      pSumArray[Math.floor(pos / 2)] = -1;

    // spare - no points yet
    if (!vbsIsFirstBall(pos, pResults)) {
      if ((pResults[pos] + pResults[pos - 1]) === 10)
        pSumArray[Math.floor(pos / 2)] = -1;
    }

    // strike in the previous frame and we are on a first ball
    if (vbsIsFirstBall(pos, pResults) && pos < 19) {
      if (pResults[pos - 2] === 10)
        pSumArray[Math.floor((pos - 2) / 2)] = -1;
    }
  }

  return pSumArray;
}

// Port of MaxPossibleScore (scoring/bowlingscore/bowlingcalculations.cpp), the
// #MAX_GAME# tag: the highest game still reachable. The balls bowled so far are
// kept, every later ball is the best it can be - a strike, or the spare after a
// frame's first ball - and the result is scored by vbsRecalcScore. A finished
// game gives its own score. tenthEndsOnMark is CFG open play, whose frame 10
// ends on its strike or spare (CGameAbstract::Score).
function vbsMaxPossibleScore(pResults, activePos, isCFG, tenthEndsOnMark) {
  if (activePos < 0) activePos = 0;
  if (activePos > 21) activePos = 21;     // corrupt lane data: the game is over

  var best = [];
  var p;
  for (p = 0; p < 21; p++)
    best.push(p < activePos ? Math.min(pResults[p], 10) : 0);

  for (p = activePos; p < 21; p++) {
    if (p < 18) {
      if (p % 2 === 0) best[p] = 10;                       // a strike; best[p + 1] stays 0
      else if (best[p - 1] < 10) best[p] = 10 - best[p - 1];   // the spare
    } else if (p === 18) {
      best[p] = 10;
    } else if (p === 19) {
      best[p] = (best[18] === 10) ? (tenthEndsOnMark ? 0 : 10) : 10 - best[18];
    } else {
      var strike = best[18] === 10;
      var spare = !strike && best[18] + best[19] === 10;
      if (tenthEndsOnMark || !(strike || spare)) best[p] = 0;   // no third ball
      else if (strike && best[19] < 10) best[p] = 10 - best[19];
      else best[p] = 10;
    }
  }

  var sums = vbsRecalcScore(best, 21, false, !!isCFG);
  var total = 0;
  for (var i = 0; i < 10; i++) total += sums[i];
  return total;
}

// CGameAbstract::isCFG: a CFG theme is one whose name has "cfg" in it, never for
// a USALeague game. lane.protocol is the theme the slave drew with, the own or
// the competition one as ProtocolThemeName chose it, so it is the name isCFG reads.
function vbsIsCFG(lane) {
  if (lane.dllName.indexOf('USALeague') >= 0) return false;
  return lane.protocol.toLowerCase().indexOf('cfg') >= 0;
}

// Port of CProtocol::StrikeSequence.
function strikeSequence(pScores, startPos, endPos, hideStrikeSequence) {
  if (!hideStrikeSequence) return false;

  for (var i = startPos; i < endPos; i += 2)
    if (pScores[i] !== 10) return false;

  if (endPos === 21) return false;   // end of game reached, calc down scores
  return true;
}

// Port of CProtocol::GetTotal, reached through CGameAbstract::GetPlayerTotalScore.
function getTotal(finished, player, isCFG, lane) {
  var activePosition = player.activeSquare;
  var sums = vbsRecalcScore(player.score, activePosition, true, isCFG);
  var score = 0;
  for (var i = 0; i < Math.floor(activePosition / 2); i++) {
    if (sums[i] === -1) break;      // non finished bonus (strike or spare)
    score += sums[i];
  }

  if (player.playerVbsHere === VBS_CONSTANT) {
    if (lane.hcp_mode === 3)
      return score + player.hcp;

    var s = player.totalPoints + player.startPoints;
    if (!finished) s += score;
    if (lane.hcp_mode > 0) s += player.hcp * (player.activeGame - player.missedGame);
    if (lane.hcp_mode === 1) s += player.hcp;
    return s;
  }

  if (finished)
    return (player.activeSquare === 0) ? (player.totalPoints + player.hcp) : player.totalPoints;

  return player.totalPoints + score + player.hcp;
}

// Port of CGame::CalcStatusLine (Slave/OPENPLAY/Game.cpp). The running team
// total across the lane: for each frame, the sum of every player's score up to
// that frame, which is what the team-sums panel under the protocol draws.
//
// It reads only this lane's own players, so a single lane file is enough. (An
// earlier note here and in the r17333 log said the panel needed the partner
// lane's data - it does not; nothing in this function leaves m_pPlayerInfoStruct.)
//
// Returns null when there is nothing to show, which is what the C++ does by
// leaving `text` untouched - and that empty result is exactly what makes the
// panel's #TFSUM# id resolve empty, so the whole panel disappears.
function calcStatusLine(ctx, num, bTfsum, includeHCP, includeTeamHCP, isCFG) {
  var lane = ctx.lane;

  // GAMETYPE(type) is type & ~LC_START_AMERICAN (shared/lanedata/GCI.h).
  var LC_START_AMERICAN = 0x4000;
  var LC_START_TEAMPLAY = 0x004;
  var gameType = lane.type & ~LC_START_AMERICAN;

  var bUseLanesum = ctx.alwaysShowLaneSum || gameType === LC_START_TEAMPLAY;
  if (lane.vbsHere === VBS_CONSTANT && lane.team_mode > 0) bUseLanesum = true;
  if (!bUseLanesum) return null;

  var addedSums = [];
  var statusLineValues = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var totalScore = 0;
  var maxFrame = -1;
  var i;

  for (var pi = 0; pi < lane.noPlayers; pi++) {
    var player = lane.players[pi];
    if (!player) break;
    var activePosition = player.activeSquare;
    var activeFrame = Math.floor(activePosition / 2);
    var sums = vbsRecalcScore(player.score, activePosition, false, isCFG);
    if (activeFrame > maxFrame) maxFrame = activeFrame;

    addedSums[pi] = [];
    var score = 0;

    var playerTotalScore = 0;
    for (i = 0; i < activeFrame; i++) {
      if (sums[i] === -1) break;
      playerTotalScore += sums[i];
    }

    if (lane.team_mode === 2) {
      totalScore += player.totalPoints;
      // Hack in the C++ too: for team_mode 2 this game's total is already part
      // of totalPoints once the lane has finished, so it is taken back out.
      if (lane.laneFinshFlag1 === 1) totalScore -= playerTotalScore;
      score += player.startPoints;
      var HDCP_ADD_PRE = 1;
      var nGameCountAdd = (lane.hcp_mode === HDCP_ADD_PRE || !!lane.laneFinshFlag1) ? 1 : 0;
      score += includeHCP ? player.hcp * (player.activeGame + nGameCountAdd) : 0;
    } else {
      score += includeHCP ? player.hcp : 0;
    }

    // The frame line (#FSUM..._n#) is this game alone: one game's handicap plus
    // the scratch up to frame n. It no longer shares `score` with #TFSUM#, which
    // in team_mode 2 also carries start points and every game's handicap.
    // Same change as CGame::CalcStatusLine (Slave/OPENPLAY/Game.cpp).
    var frameSum = includeHCP ? player.hcp : 0;
    for (i = 0; i < activeFrame; i++) {
      if (sums[i] === -1) break;
      score += sums[i];
      frameSum += sums[i];
      addedSums[pi][i] = frameSum;
    }
    for (i = 0; i < 10; i++) {
      if (i < activeFrame && addedSums[pi][i] !== undefined && addedSums[pi][i] !== -1)
        statusLineValues[i + 1] += addedSums[pi][i];
      else
        statusLineValues[i + 1] += frameSum;
    }

    totalScore += score;
  }

  if (bTfsum) {
    // LOWORD(data) is the team's start points, counted once per played game.
    var tfsum = totalScore + ((lane.data & 0xFFFF) *
      (lane.players[0] ? lane.players[0].activeGame : 0));
    if (includeTeamHCP) tfsum += lane.teamHCP;
    return String(tfsum);
  }
  // num comes from the layout file; 10 bounds statusLineValues[], maxFrame says
  // it has been reached - LaneSumValue's test.
  if (num < 0 || num > 10 || num > maxFrame) return null;
  return String(statusLineValues[num]);
}

// Port of CProtocol::TruncatePlayerName. maxLength 0 means "no truncation",
// which is what the #NAME# token without a number resolves to.
function truncatePlayerName(rawName, maxLength, activeSquare) {
  var name = vbsStr(rawName);

  // Remove the child identifier ("+c" / "+C" - bumpers)
  if (name.length >= 2 && name.charAt(name.length - 2) === '+' &&
      (name.charAt(name.length - 1) === 'c' || name.charAt(name.length - 1) === 'C')) {
    name = name.substring(0, name.length - 2);
  }

  // Baker notation "Name{n}" -> "Name frame/n"
  if (name.length >= 3 && name.charAt(name.length - 3) === '{' &&
      name.charAt(name.length - 1) === '}') {
    var bakerNumber = name.charCodeAt(name.length - 2) - 48;
    var base = name.substring(0, name.length - 3);
    var frame = Math.floor(activeSquare / 2);
    if (activeSquare >= 19) frame = 9;
    if (bakerNumber > 0)
      name = base + ' ' + ((frame % bakerNumber) + 1) + '/' + bakerNumber;
    else
      name = base;
  }

  if (maxLength > 0 && maxLength < name.length) {
    var parts = name.split(/[ .]+/).filter(function (p) { return p.length > 0; });
    if (parts.length > 0) {
      var first = parts[0];
      var last = parts[parts.length - 1];

      if (first.length <= maxLength) {
        name = (first.length + 2 <= maxLength) ? (first + ' ' + last.charAt(0)) : first;
      } else if (last.length <= maxLength) {
        name = (last.length + 2 <= maxLength) ? (first.charAt(0) + ' ' + last) : last;
      } else if (parts.length > 1) {
        // initials
        var text = '';
        for (var iName = 0; iName < parts.length - 1 && iName < (Math.floor(maxLength / 2) - 1); iName++)
          text += parts[iName].charAt(0) + '.';
        name = (text + last.charAt(0) + '.').substring(0, maxLength);
      }
      name = name.substring(0, maxLength);
    }
  }

  return name;
}

// Port of LanedataUtil::GameModeToText.
function gameModeToText(scoreMode) {
  var modeList = ['Normal', 'Short game 2', 'Short game 3', 'Short game 4', 'Short game 5',
    'Mini', '10th Frame', 'NoTap9', 'NoTap8', 'NoTap7', 'NoTap6', '369',
    'NoTap9 + 369', 'NoTap8 + 369', 'NoTap7 + 369', 'NoTap6 + 369'];
  var modeNrList = [GCI_SCORING_NORMAL, GCI_SCORING_SHORTGAME_2, GCI_SCORING_SHORTGAME_3,
    GCI_SCORING_SHORTGAME_4, GCI_SCORING_SHORTGAME_5, GCI_SCORING_MINI, GCI_SCORING_10TH,
    GCI_PIN9_NO_TAP, GCI_PIN8_NO_TAP, GCI_PIN7_NO_TAP, GCI_PIN6_NO_TAP, GCI_SCORING_369,
    GCI_PIN9_NO_TAP + GCI_SCORING_369, GCI_PIN8_NO_TAP + GCI_SCORING_369,
    GCI_PIN7_NO_TAP + GCI_SCORING_369, GCI_PIN6_NO_TAP + GCI_SCORING_369];

  for (var mode = 0; mode < modeNrList.length; mode++)
    if (modeNrList[mode] === scoreMode) return modeList[mode];

  return '';
}

// CProtocol::ConvertBallSpeed - mm/s to km/h.
function convertBallSpeed(mmPerSecond) {
  return mmPerSecond * 0.0036;
}

// --- the message overlays ------------------------------------------------
//
// The theme's MessageInfo.xml draws the message over the sheet - lane stopped
// for a reset, throw the next ball, service called, out of sequence, the Belgium
// pictures, waiting for the space bar - and in the C++ all of them come from one
// member, CGame::m_activeTransparentPicture (with m_noTapReset telling a NoTap
// stop from an ordinary one), which lives in OpenPlay and in no lane file.
// OpenPlay publishes it as LC_MASK_PICTURE whenever a render shows a different
// one (CGame::PublishMaskPicture) and LoadCom hands it over as "maskPicture":
// the MASKPIC_* value, 0x100 added for a NoTap stop. An older slave sends no such
// field, and then the one overlay it has always said - waiting for space,
// LC_WAIT_SPACE - is the only one drawn, as before.
var VBS_MASKPIC = {
  STOP: 1, BALL: 2, STOP_PRACTICE: 3, STOP_NOTAP: 4, BELGIUM_ODD: 5, BELGIUM_EVEN: 6,
  WAITSPACE: 7, SERVICE: 8, WAIT_SPACE_OTHER_LANE: 9, OUT_OF_SEQUENCE: 10
};

function vbsMaskState(ctx) {
  if (ctx.maskPicture !== null && ctx.maskPicture !== undefined)
    return { pic: ctx.maskPicture & 0xFF, noTap: (ctx.maskPicture & 0x100) !== 0 };
  return { pic: ctx.waitingSpace ? VBS_MASKPIC.WAITSPACE : 0, noTap: false };
}

// The #ID_MASKPIC_...# pictures and #MESSAGE#, as CGame::GetText answers them: a
// picture id answers with itself while its overlay is up and with nothing
// otherwise, which is what decides whether it is drawn. null for any other id.
function vbsMaskText(tmp, ctx) {
  var m = vbsMaskState(ctx);
  var P = VBS_MASKPIC;
  var up = function (on) { return on ? tmp : ''; };
  switch (tmp) {
    case '#ID_MASKPIC_STOP#': return up(m.pic === P.STOP && !m.noTap);
    case '#ID_MASKPIC_STOP_NOTAP#': return up(m.pic === P.STOP && m.noTap);
    case '#ID_MASKPIC_BALL#': return up(m.pic === P.BALL);
    case '#ID_MASKPIC_STOP_PRACTICE#': return up(m.pic === P.STOP_PRACTICE);
    case '#ID_MASKPIC_BELGIUM_ODD#': return up(m.pic === P.BELGIUM_ODD);
    case '#ID_MASKPIC_BELGIUM_EVEN#': return up(m.pic === P.BELGIUM_EVEN);
    case '#ID_MASKPIC_WAITSPACE#': return up(m.pic === P.WAITSPACE);
    case '#ID_MASKPIC_OUT_OF_SEQUENCE#': return up(m.pic === P.OUT_OF_SEQUENCE);
    case '#ID_MASKPIC_SERVICE#': return up(m.pic === P.SERVICE);
    case '#MESSAGE#':
      if (m.pic <= 0) return '';
      switch (m.pic) {
        case P.STOP_NOTAP:
        case P.STOP: return vbsLangText(ctx, m.noTap ? 'IDS_MASKPIC_STOP_NOTAP' : 'IDS_MASKPIC_STOP');
        case P.BALL: return vbsLangText(ctx, 'IDS_MASKPIC_BALL');
        case P.STOP_PRACTICE: return vbsLangText(ctx, 'IDS_MASKPIC_STOP_PRACTICE');
        case P.BELGIUM_ODD: return vbsLangText(ctx, 'IDS_MASKPIC_BELGIUM_ODD');
        case P.BELGIUM_EVEN: return vbsLangText(ctx, 'IDS_MASKPIC_BELGIUM_EVEN');
        case P.WAITSPACE: return vbsLangText(ctx, 'IDS_MASKPIC_WAITSPACE');
        case P.SERVICE: return vbsLangText(ctx, 'IDS_MASKPIC_SERVICE');
        case P.WAIT_SPACE_OTHER_LANE: return vbsLangText(ctx, 'IDS_MASKPIC_WAIT_SPACE_OTHER_LANE');
        case P.OUT_OF_SEQUENCE: return vbsLangText(ctx, 'IDS_MASKPIC_OUT_OF_SEQUENCE');
        default: return 'default';
      }
    default:
      return null;
  }
}

// --- lane data -> render context -----------------------------------------

// Turns one parsed lane file into the shape the token resolver and the layout
// engine want. Everything the C++ pulls out of GCI_PLAYERINFORMATIONSTRUCT and
// GCI_PLAYERSTRUCT is normalised to numbers here, once.
function vbsMakeContext(json, options) {
  options = options || {};

  var lane = {
    laneNumber: vbsNum(json.laneNumber),
    reverseArrows: vbsNum(json.reverseArrows),     // reversed arrow logic in cross lane
    // The partner lane's active bowler in cross lane play, or -1. Written by
    // GetJsonFromPlayInfo only for a cross lane game, so an older lane file - or
    // any other game - correctly leaves it absent rather than pointing at
    // player 0.
    activePlayerOtherLane: (json.activePlayerOtherLane === undefined)
      ? -1 : vbsNum(json.activePlayerOtherLane),
    noPlayers: vbsNum(json.noPlayers),
    activePlayer: vbsNum(json.activePlayer),
    isAnyPlayerActive: vbsNum(json.isAnyPlayerActive),
    hcp_mode: vbsNum(json.hcp_mode),
    RedPin: vbsRedPinShown(json),                  // 0 during a warm-up, see vbsRedPinShown
    teamHCP: vbsNum(json.teamHCP),
    laneStatus: vbsNum(json.laneStatus),
    laneFinshFlag1: vbsNum(json.laneFinshFlag1),
    vbsHere: vbsNum(json.vbsHere),                 // GCI_TOURNAMENT_GAME::vbsHere
    team_mode: vbsNum(json.team_mode),             // GCI_TOURNAMENT_GAME::team_mode
    type: vbsNum(json.type),                       // for GAMETYPE(), see calcStatusLine
    data: vbsNum(json.data),                       // team start points, read as LOWORD
    showNextLane: vbsNum(json.showNextLane),
    StartTime: vbsNum(json.StartTime),
    EndTime: vbsNum(json.EndTime),
    dllName: vbsStr(json.dllName),
    protocol: vbsStr(json.protocol),               // the theme, for vbsIsCFG
    teamName: vbsStr(json['teamNames to lane'] ? json['teamNames to lane']['1'] : ''),
    practiceMethod: vbsNum(json.practiceMethod),
    practiceAmount: vbsNum(json.practiceAmount)
  };

  var players = [];
  for (var i = 0; i < lane.noPlayers; i++) {
    var p = json.players ? json.players['player ' + (i + 1)] : null;
    if (!p) break;
    var amr = p.amrLeague || {};
    players.push({
      playerName: vbsStr(p.playerName),
      activeGame: vbsNum(p.activeGame),
      activeSquare: vbsNum(p.activeSquare),
      totalPoints: vbsNum(p.totalPoints),
      hcp: vbsNum(p.hcp),
      scoreMode: vbsNum(p.scoreMode),
      playerVbsHere: vbsNum(p.playerVbsHere),
      startPoints: vbsNum(p.startPoints),
      missedGame: vbsNum(p.missedGame),
      teamName: vbsStr(p.teamName),
      // In a GSX training game this carries the training programme's name, not
      // a player name: TrainingGameControl writes it there, and so does
      // LoadComWebService_Console::startTraining.
      originalPlayerName: vbsStr(p.originalPlayerName),
      score: vbsArray(p.score, 21),
      status: vbsArray(p.status, 21),
      // Which pins were left standing by each ball, bit 0 = pin 1. Despite the
      // "Fallen pin configuration" comment on GCI_PLAYERSTRUCT::pinConfig it is
      // the standing ones: MM_GetExciter reads 0x3FF as "nothing knocked down"
      // and hands the same value to GlobCheckSplit.
      pinConfig: vbsArray(p.pinConfig, 21),
      nextLanes: vbsArray(p.nextLanes, 4),
      // For GCI_PRACTICE_MINUTES this is the *start* time (time(NULL) minus it
      // is the elapsed seconds); for GCI_PRACTICE_FRAMES it is a count of
      // frames. Only player 0's is ever read, as in the C++.
      practiceElapsed: vbsNum(amr.practiceElapsed),
      amrSwitch: vbsNum(amr.amrSwitch),            // teams swap lanes between games
      bowlerType: vbsNum(amr.bowlerType),
      ballSpeed: vbsNum(amr.ballSpeed),
      averageScore: vbsNum(amr.averageScore),
      numGames: vbsNum(amr.numGames)
    });
  }
  lane.players = players;
  if (players.length < lane.noPlayers) lane.noPlayers = players.length;

  return {
    lane: lane,
    // -1 = "not inside the per-player loop", same meaning as
    // GDI_plus_helper::m_playerBeeingProcessed
    playerBeingProcessed: -1,
    lang: VBS_LANG[options.language] || VBS_LANG.Svenska,
    hideStrikeSequence: options.hideStrikeSequence !== false,   // registry default is TRUE
    showBallSpeed: !!options.showBallSpeed,                     // MES_MASK_BALLSPEED
    // VBS-T OnScoring values, parsed from GameCtrl\VBST_<leaguePath>.ini by
    // vbsonscoring.js. Absent for a non-tournament game, which makes every
    // #VBST_JOB_text<n># resolve empty.
    onScoringValues: options.onScoringValues || null,
    // ScorerSettings::m_alwaysShowLaneSum, the "Visa bansumma" setting. It is a
    // slave registry/DBSettings value (REGVAL_ALWAYS_SHOW_LANE_SUM), not part of
    // the lane file, so it has to be handed to the page - the same problem and
    // the same answer as ?protocol= and ?hidestrike=.
    alwaysShowLaneSum: !!options.alwaysShowLaneSum,
    // ScorerSettings::m_showMaxGame, "Visa maxpoäng för serien" (ShowMaxGame): whether
    // #MAX_GAME# / #MAX_GAME_HCP# draw their value. A slave registry value as the one
    // above, handed to the page the same way; off unless the hall ticks it.
    showMaxGame: !!options.showMaxGame,
    // LC_WAIT_SPACE, kept by LoadCom in WebPara[].waitingSpace and delivered in
    // the lane status payload. Draws the "press SPACE for a new game" overlay
    // from the theme's MessageInfo.xml - the one message the XML screen shows
    // that this one has the state for.
    waitingSpace: !!options.waitingSpace,
    // The overlay OpenPlay's screen shows (LC_MASK_PICTURE), or null when the
    // slave does not say - see vbsMaskState.
    maskPicture: (options.maskPicture === undefined) ? null : options.maskPicture,
    // The two pictures of OpenPlayCommercial0/1, as the slave sends them; null when
    // it does not (an older slave, a page fed a lane file) - the helmet then.
    openPlayCommercial: options.openPlayCommercial || null,
    // The pins left standing, as CGame::m_showPins - a 10-bit mask, bit 0 =
    // pin 1, zero meaning "not showing pins". Only set while the full-screen
    // ShowPins layout is being drawn; see TakTV.js.
    showPins: vbsNum(options.showPins),
    // The rack a GSX training game has set, as CScreenPainter::gCurrentPins.
    // Worked out from player 0's programme before the render - see TakTV.js.
    trainingPins: vbsNum(options.trainingPins),
    // The partner lane's bowlers ({ teamName }), when the page has read them -
    // #teamLogo_n# takes the other team's logo from there. Null otherwise.
    partnerPlayers: options.partnerPlayers || null,
    now: options.now || Math.floor(Date.now() / 1000)
  };
}

// SeperateTextAndNumber (shared/graphics/MyGdiPlus.h): every digit moves to the
// number, everything else stays in the id. "#SUM_HCP_10#" -> "#SUM_HCP_#" + 10.
function separateTextAndNumber(id) {
  var txt = '';
  var num = '';
  for (var i = 0; i < id.length; i++) {
    var c = id.charAt(i);
    if (c >= '0' && c <= '9') num += c; else txt += c;
  }
  return { text: txt, num: num.length ? parseInt(num, 10) : -1 };
}

function vbsFormatSpeed(fmt, kmh) {
  return fmt.replace('%.1f', kmh.toFixed(1));
}

// The practice strings are sprintf formats in the .lang file - "Tid kvar att
// spela %d:%02d", "Inspelningsrutor kvar %d" - so the values have to be put in
// the same way CLanguage's callers do. Only the two conversions those strings
// use are supported; anything else is left as it stands rather than guessed at.
function vbsFormatNumbers(fmt, values) {
  var i = 0;
  return String(fmt || '').replace(/%(0\d+)?d/g, function (match, pad) {
    var v = (i < values.length) ? values[i++] : 0;
    var text = String(v);
    if (pad) {
      var width = parseInt(pad.substring(1), 10);
      while (text.length < width) text = '0' + text;
    }
    return text;
  });
}

// The bowler up on each lane of a cross lane (American) pair, as CGame::GetText
// reads them: pPIS1 is the ODD lane's struct and pPIS2 the even one's, each
// with its activePlayer as a PAIR index - 0..7 the odd lane's roster, 8..15 the
// even lane's (CGCI_info::GetPlayer). This lane's own is in the lane file, the
// partner's arrives as activePlayerOtherLane (-1 when nobody is up there).
// -1 for a lane with nobody up.
function vbsPairActive(lane) {
  var own = lane.isAnyPlayerActive ? lane.activePlayer : -1;
  var other = lane.activePlayerOtherLane;
  var odd = (lane.laneNumber % 2) !== 0;
  return { left: odd ? own : other, right: odd ? other : own };
}

// The pair index of row `index` of this lane's own roster: the even lane's rows
// are 8..15 (GetPlayer(m_playerBeeingProcessed + 8) in CGame::GetText).
function vbsPairIndex(lane, index) {
  return (lane.laneNumber % 2) !== 0 ? index : index + 8;
}

function vbsIsCrossLane(lane) {
  return (lane.type & 0x4000) !== 0;     // IS_CROSSLANE: type & LC_START_AMERICAN
}

// #THIS_PLAYER_ACTIVE#, which BitmapFromXml uses to choose between the
// <active_player> and <inactive_player> row (shared/graphics/MyGdiPlus.cpp).
//
// A cross lane (American) game bowls a pair of lanes at once, so CGame::GetText
// marks the active bowler of EACH lane: two rows come out in the active style,
// and since the left/right arrows live only in that row, each gets one. Both
// lanes' active bowler is a pair index, so on the even lane a row is the bowler
// up when that index is the row plus 8 - comparing the bare row index, as this
// did, marked nobody active on an even lane, or the wrong one.
function vbsIsPlayerActive(lane, index) {
  if (!vbsIsCrossLane(lane))
    return !!lane.isAnyPlayerActive && index === lane.activePlayer;

  var up = vbsPairActive(lane);
  var me = vbsPairIndex(lane, index);
  return up.left === me || up.right === me;
}

// The bowler of this lane's own roster that pair index `pair` names, or null
// when it is a bowler of the partner lane, whose roster is not in this file.
// Outside cross lane play an index of 8 and up is folded back, as GetPlayer does.
function vbsOwnPlayer(lane, pair) {
  if (pair < 0 || pair > 16) return null;
  if (!vbsIsCrossLane(lane)) return lane.players[pair > 7 ? pair % 8 : pair] || null;
  var odd = (lane.laneNumber % 2) !== 0;
  if (odd ? pair > 7 : pair < 8) return null;
  return lane.players[odd ? pair : pair - 8] || null;
}

// isCommercial (shared/graphics/GdiMON.cpp): anything but an info text, a hiscore
// or a result picture - the tests are the C++'s, case and all.
function vbsIsCommercialPicture(name) {
  var n = String(name || '').trim();
  if (!n) return false;
  if (n.indexOf('.txt.jpg') >= 0) return false;
  if (n.indexOf('hiscore') >= 0 && n.indexOf('.xml.jpg') >= 0) return false;
  if (n.indexOf('result') >= 0 && n.indexOf('.xml.jpg') >= 0) return false;
  return true;
}

// atoi: leading spaces, a sign, digits; 0 when there are none.
function vbsAtoi(s) {
  var n = parseInt(String(s === undefined || s === null ? '' : s), 10);
  return isNaN(n) ? 0 : n;
}

// Port of CGame::GetText. Returns { text, status } - status carries the
// GCI_* bits of the throw the token resolved to, which is what drives the
// split/foul/notap/changed decorations in the layout engine - or null where
// the C++ leaves its buffer as it was, so the element keeps its own <text>.
// `current` is what is in that buffer when GetText is called: the element's
// <text> for a text, the token itself for a picture's file or id, nothing for
// a panel's id. Two tokens read it (#TFSUM_HCP#, #TFSUM_CFG#).
function vbsGetText(id, ctx, current) {
  var sep = separateTextAndNumber(id);
  var tmp = sep.text;
  var num = sep.num;
  var lane = ctx.lane;
  var none = { text: '', status: 0 };

  // The message overlays - see vbsMaskState. Answered ahead of everything else;
  // their texts (#IDS_MASKPIC_..._MESSAGE#) are ordinary language strings below,
  // drawn only because they sit inside the overlay's picture in every theme.
  var mask = vbsMaskText(tmp, ctx);
  if (mask !== null) return { text: mask, status: 0 };

  if (id.indexOf('#IDS_') >= 0)
    return { text: vbsLangText(ctx, id.replace(/#/g, '')), status: 0 };

  // The two commercial pictures in the frames of the full-screen pins picture
  // (V3GFX\Resource\ShowPins\ShowPins.xml). CGame::GetText looks for the token in
  // its BUFFER, not in the id - for a picture that is the <file> itself - and
  // answers with what Commercial put in the OpenPlayCommercial0/1 shared memory,
  // which the slave sends as openPlayCommercial1/2, or with the helmet when that
  // is empty or not a commercial (an info text, a hiscore or a result picture).
  var buffer = (current === undefined || current === null) ? '' : String(current);
  var slot = buffer.indexOf('#RANDOM_COMMERCIAL1') >= 0 ? 0 : (buffer.indexOf('#RANDOM_COMMERCIAL2') >= 0 ? 1 : -1);
  if (slot >= 0) {
    var picture = ctx.openPlayCommercial ? String(ctx.openPlayCommercial[slot] || '') : '';
    if (!vbsIsCommercialPicture(picture)) picture = 'C:\\Viking2001\\V3GFX\\Resource\\Hj\u00e4lm_Dont_Move_Or_Edit.jpg';
    return { text: vbsWinPathToUrl(picture), status: 0 };
  }

  // The practice box - "Inspelning pågår" over "Tid kvar att spela 1:50". Two
  // elements in the theme's practice layout, #PRACTICE1# for the description and
  // #PRACTICE2# for the value; port of the "#PRACTICE#" block in CGame::GetText
  // (Game.cpp). All of it comes from the lane file: practiceMethod and
  // practiceAmount are lane fields, and practiceElapsed is player 0's - a start
  // timestamp when counting minutes, a count when counting frames.
  if (tmp === '#PRACTICE#') {
    var practicePlayer = lane.players[0];
    var elapsed = practicePlayer ? practicePlayer.practiceElapsed : 0;
    var amount = lane.practiceAmount;

    // Practice that was configured as nothing at all is not practice. The C++
    // clears the method on the struct here, so later tokens in the same pass see
    // it too; same thing done here for the same reason.
    if (lane.practiceMethod !== GCI_PRACTICE_NONE && amount === 0 && elapsed === 0)
      lane.practiceMethod = GCI_PRACTICE_NONE;

    // For minutes "elapsed" is the moment the clock starts, and it may lie ahead:
    // the clock then waits for the first ball (or the start it was given) and the whole
    // warm-up is shown, frozen. LanedataUtil::PracticeSecondsLeft - keep the two
    // the same.
    var used = ctx.now - elapsed;
    var secondsLeft = amount * 60 - (used > 0 ? used : 0);

    if (num === 1) {
      if (lane.practiceMethod === GCI_PRACTICE_MINUTES)
        return { text: (secondsLeft > 0) ? vbsLangText(ctx, 'IDS_GCI_PRACTICE_MINUTES') : '', status: 0 };
      if (lane.practiceMethod === GCI_PRACTICE_FRAMES)
        return { text: vbsLangText(ctx, 'IDS_GCI_PRACTICE_FRAMES'), status: 0 };
      if (lane.practiceMethod === GCI_PRACTICE_BALLS)
        return { text: vbsLangText(ctx, 'IDS_GCI_PRACTICE_BALLS'), status: 0 };
      return none;
    }

    if (num === 2) {
      if (lane.practiceMethod === GCI_PRACTICE_MINUTES) {
        if (secondsLeft <= 0) return none;
        return {
          text: vbsFormatNumbers(vbsLangText(ctx, 'IDS_GCI_PRACTICE_MINUTES2'),
            [Math.floor(secondsLeft / 60), secondsLeft % 60]),
          status: 0
        };
      }
      if (lane.practiceMethod === GCI_PRACTICE_FRAMES)
        return { text: vbsFormatNumbers(vbsLangText(ctx, 'IDS_GCI_PRACTICE_FRAMES2'), [amount - elapsed]), status: 0 };

      // Balls left needs CGame::m_ballsElapsed, which is counted inside OpenPlay
      // (TestFrames.cpp) and is in no lane file - so the count cannot be worked
      // out here. The description line above still shows, which is the same
      // thing the C++ draws when the count happens to be unknown.
      return none;
    }

    return none;
  }

  // The pins standing after the ball, drawn full screen for five seconds by
  // V3GFX\Resource\ShowPins\ShowPins.xml and its BrunswickPinsAny.xml import.
  // Straight port of the "_PIN_" block in CGame::GetText (Game.cpp): each pin is
  // an element whose id is one of these tokens, and the token answers with a
  // file name when that pin is standing and with nothing when it is not - which
  // is what makes the element be drawn or skipped. Answering the C++ file name
  // rather than the token itself matters for the older themes that put these
  // tokens in <file> instead of <id>; there the answer *is* the picture.
  if (tmp.indexOf('#ANY_') === 0) {
    var pinUp = (ctx.showPins & (1 << (num - 1))) !== 0;

    if (ctx.showPins) {
      if (tmp === '#ANY_PIN_BG#') return { text: 'BigPinBG.png', status: 0 };
      if (tmp === '#ANY_PIN_#') return { text: pinUp ? 'BigPin.png' : '', status: 0 };
      if (tmp === '#ANY_PIN_NUM_#')
        return { text: pinUp ? ('BigPin' + (num < 10 ? '0' : '') + num + '.png') : '', status: 0 };
      if (tmp === '#ANY_RED_PIN_NUM_#')
        return { text: (pinUp && num === lane.RedPin) ? 'ScoreKingRedReflex.png' : '', status: 0 };
      return none;
    }

    // Not showing pins: the rack is drawn whole instead, so the red pin on it can
    // be seen before the first ball. Same condition the C++ uses - a red pin is
    // in play and the active player is about to bowl a first ball.
    var pinPlayer = (lane.activePlayer >= 0) ? vbsOwnPlayer(lane, lane.activePlayer) : null;
    if (!lane.RedPin || lane.activePlayer < 0 || !pinPlayer) return none;

    var isBowl20FirstBall = (pinPlayer.activeSquare === 19) && (pinPlayer.score[18] === 10);
    if (!(pinPlayer.activeSquare % 2 === 0 || isBowl20FirstBall)) return none;

    if (tmp === '#ANY_PIN_BG#') return { text: 'BigPinBG.png', status: 0 };
    if (tmp === '#ANY_PIN_#') return { text: 'BigPin.png', status: 0 };
    if (tmp === '#ANY_PIN_NUM_#')
      return { text: 'BigPin' + (num < 10 ? '0' : '') + num + '.png', status: 0 };
    if (tmp === '#ANY_RED_PIN_NUM_#')
      return { text: (num === lane.RedPin) ? 'ScoreKingRedReflex.png' : '', status: 0 };
    return none;
  }

  // --- odds and ends a layout may ask for ---------------------------------
  //
  // Not used by the scoring protocols, but they are in the NoPlay layouts
  // (V3GFX\Resource\Noplay, CNoplay::GetText in Slave/NOPLAY/GameStart.cpp) and
  // a hall's own theme could use them too. Answered - two of them with nothing -
  // rather than left unknown: an unresolved id leaves vbsPaintPicture drawing
  // the element with the token as its text, and the placeholder text sitting in
  // that layout is "Daniel D var här".
  if (tmp === '#TIME#') {
    var clock = new Date(ctx.now * 1000);
    return {
      text: vbsFormatNumbers('%02d:%02d:%02d',
        [clock.getHours(), clock.getMinutes(), clock.getSeconds()]),
      status: 0
    };
  }

  // "TODO:" in the C++, which writes an empty string.
  if (tmp === '#TO_WELLCOME#') return none;

  // Captured by NoPlay from a GC_SCORE pipe message and shown for a minute
  // after the ball. Nothing carries it to a browser, so it stays empty - the
  // same thing the C++ draws when the media flag is off or the reading is old.
  if (tmp === '#BALL_SPEED#') return none;

  if (tmp === '#LANE_NUMBER#') return { text: String(lane.laneNumber), status: 0 };
  if (tmp === '#LANE_NUMBERD#') return { text: vbsLangText(ctx, 'IDS_LANE'), status: 0 };
  // Which side of the lane pair this lane is on - left is an odd lane, right an
  // even one. Port of LaneSideText in Game.cpp: true is the
  // lane number, false is empty, so a picture with the id shows only on its side
  // and a text with it writes the lane number there and nothing on the other.
  if (tmp === '#IS_LEFTLANE#' || tmp === '#IS_RIGHTLANE#') {
    var isLeft = lane.laneNumber % 2 !== 0;
    return { text: isLeft === (tmp === '#IS_LEFTLANE#') ? String(lane.laneNumber) : '', status: 0 };
  }
  if (tmp === '#GAMED#') return { text: vbsLangText(ctx, 'IDS_GAME'), status: 0 };

  var first = lane.players[0];
  if (!first) return null;      // no player -> C++ logs and leaves the text alone

  if (tmp === '#GAME#') return { text: String(first.activeGame + 1), status: 0 };
  if (tmp === '#GAMEMODE#') return { text: gameModeToText(first.scoreMode), status: 0 };

  if (tmp === '#PINS_ON_PROTOCOL#') return none;   // separate protocol import, not rendered here

  // Any other #ID_MASKPIC_ id answers empty rather than being left unknown: an
  // unrecognised id makes vbsPaintPicture keep the token as the id and draw the
  // element, which put a STOP sign and a sleeping figure across the sheet the
  // first time the runtime loader pulled this layer in.
  if (tmp.indexOf('#ID_MASKPIC_') === 0) return none;

  if (tmp === '#PLAY_TIME#') {
    var minutes;
    if (lane.StartTime <= 0) {                     // counting downwards
      // Truncated towards zero, as CGame's PlayTimeMinutes divides, so the two renderers agree
      // on a negative value too.
      minutes = Math.trunc((lane.EndTime - ctx.now) / 60);
      // Never a negative countdown (BC18331) - a lane restored after its time ran out, or one
      // with both StartTime and EndTime at 0, would otherwise put a minus sign on the wall -
      // EXCEPT a VBS-T competition, which shows its overrun (BC18506): "-10" when a 100 minute
      // match has run 110. Display only; nothing stops a lane on this value.
      var competition = lane.EndTime > 0 && String(lane.dllName || '').indexOf('VBS') >= 0;
      if (minutes < 0 && !competition) minutes = 0;
    } else {                                       // counting upwards
      minutes = Math.floor((ctx.now - Math.abs(lane.StartTime)) / 60);
    }
    return { text: String(minutes), status: 0 };
  }

  if (tmp === '#IS_OPENPLAY#')
    return { text: (lane.laneStatus === GCI_Timeplay || lane.laneStatus === GCI_Gameplay) ? 'YES_SHOW' : '', status: 0 };

  if (tmp === '#IS_REDPIN#')
    return { text: lane.RedPin ? 'YES_SHOW' : '', status: 0 };

  if (tmp === '#IS_VBST#')
    return { text: (lane.dllName.indexOf('VBS') >= 0) ? 'VBST' : '', status: 0 };

  // Frame numbers used as the "|" selector. All three variants exist because a
  // protocol picks one with use_first_player / use_last_player /
  // use_current_player; Viking sets none of them, so #ACTIVE_FRAME# wins.
  if (tmp === '#ACTIVE_FRAME#')
    return { text: activeFrameText(currentPlayer(ctx) || first), status: 0 };
  if (tmp === '#ACTIVE_FIRST_FRAME#')
    return { text: activeFrameText(first), status: 0 };
  if (tmp === '#ACTIVE_LAST_FRAME#')
    return { text: activeFrameText(lane.players[lane.noPlayers - 1]), status: 0 };
  if (tmp === '#ACTIVE_CURRENT_FRAME#') {
    var p = lane.activePlayer;
    if (!lane.isAnyPlayerActive || p < 0 || p >= 8) p = lane.noPlayers - 1;
    return { text: activeFrameText(lane.players[p]), status: 0 };
  }

  // Everything below is player scoped. Outside the per-player loop the C++
  // returns early without touching the text buffer, so the literal survives.
  if (ctx.playerBeingProcessed < 0) return null;
  var ppp = currentPlayer(ctx);
  if (!ppp) return null;

  var as = ppp.activeSquare;

  // --- GSX training -------------------------------------------------------
  //
  // The training screen (V3GFX\Resource\GSX_Training) is drawn by a process of
  // its own, TrainingGameControl.exe, with its own token resolver in
  // CScreenPainter::GetText. These are that resolver's tokens, and every one of
  // them reads from the lane file: the counters are packed into the first six
  // entries of the player's score array, and the programme's name is put in
  // originalPlayerName when the game is started.
  if (tmp.indexOf('#GSX_') === 0) {
    // CScreenPainter::GetScoring - two bytes per value, high byte first.
    var succeeded = (ppp.score[0] << 8) + ppp.score[1];
    var attempted = (ppp.score[2] << 8) + ppp.score[3];
    var inARow = (ppp.score[4] << 8) + ppp.score[5];
    var percent = (attempted > 0) ? Math.floor((100 * succeeded) / attempted) : 100;

    if (tmp === '#GSX_GAMEMODE#') {
      var isTraining = (lane.practiceAmount === VBS_GSX_TRAINING_1
                     || lane.practiceAmount === VBS_GSX_TRAINING_2);
      return { text: isTraining ? ppp.originalPlayerName : '', status: 0 };
    }
    if (tmp === '#GSX_PERCENT#') return { text: percent + '%', status: 0 };
    if (tmp === '#GSX_SUCCESSFUL#') return { text: succeeded + '/' + attempted, status: 0 };
    if (tmp === '#GSX_INROW#') return { text: String(inARow), status: 0 };

    // The rack the lane is set for. It belongs to the game, not to the player
    // being drawn - CScreenPainter keeps it in gCurrentPins, taken from player
    // 0's programme - so it is resolved once and handed in.
    if (tmp === '#GSX_PINS#') return { text: vbsPinsToString(ctx.trainingPins), status: 0 };
    if (tmp === '#GSX_PIN_#')
      return { text: (num >= 0 && (ctx.trainingPins & (1 << (num - 1)))) ? 'YES' : '', status: 0 };

    return none;
  }

  if (tmp === '#THIS_PLAYER_ACTIVE#')
    return { text: vbsIsPlayerActive(lane, ctx.playerBeingProcessed) ? '1' : '', status: 0 };

  if (tmp === '#THROW#') {
    var text = '';
    var status = 0;
    if (as > (num - 1)) {
      var sc = ppp.score[num - 1];
      if (vbsIsFirstBall(num - 1, ppp.score)) {
        text = String(sc);
        if (sc === 10) text = 'X';
        if (sc === 0) text = '-';
      } else {
        var sc2 = sc + ppp.score[num - 2];
        text = String(sc);
        if (sc2 === 10) text = '/';
        if (sc === 0) text = '-';
        if (sc === 0 && sc2 === 10) text = '';
      }
      if (text !== '') status = ppp.status[num - 1];
    } else if ((num === 5 || num === 11 || num === 17) && (ppp.scoreMode & GCI_SCORING_369)) {
      text = 'X';
    }
    return { text: text, status: status };
  }

  if (tmp === '#NAME#')
    return { text: truncatePlayerName(ppp.playerName, num, ppp.activeSquare), status: 0 };

  // The name of the bowler up on THIS lane - in cross lane play that can be a
  // bowler of the partner's roster, whose name this file does not carry.
  if (tmp === '#CURRENT_PLAYER#') {
    if (!lane.isAnyPlayerActive) return none;
    var act = vbsOwnPlayer(lane, lane.activePlayer);
    return act ? { text: truncatePlayerName(act.playerName, num, act.activeSquare), status: 0 } : none;
  }

  if (tmp === '#SPEED#') {
    if (!ctx.showBallSpeed) return none;
    return { text: vbsFormatSpeed(vbsLangText(ctx, 'IDS_SPEED'), convertBallSpeed(ppp.ballSpeed)), status: 0 };
  }
  if (tmp === '#SPEEDD#')
    return ctx.showBallSpeed ? { text: vbsLangText(ctx, 'IDS_SPEEDD'), status: 0 } : none;   // its own string, not IDS_SPEED

  if (tmp === '#SUM#' || tmp === '#SUM_HCP_#') {
    var sums = vbsRecalcScore(ppp.score, as);
    var score = 0;
    var out = '';
    for (var i = 0; i < Math.floor(as / 2); i++) {
      if (sums[i] === -1) break;
      score += sums[i];
      if (!strikeSequence(ppp.score, i * 2, as, ctx.hideStrikeSequence))
        if (i === num - 1)
          out = String(score + (tmp === '#SUM#' ? 0 : ppp.hcp));
    }
    return { text: out, status: 0 };
  }

  if (tmp === '#SUM_CFG_#') {
    var cfgSums = vbsRecalcScore(ppp.score, as, false);
    var cfgScore = ppp.hcp;
    var cfgOut = '';
    for (var c = 0; c < Math.floor(as / 2); c++) {
      if (ppp.score[c * 2] === 10) cfgScore += 30;
      else if (ppp.score[c * 2] + ppp.score[c * 2 + 1] === 10) cfgScore += 10 + ppp.score[c * 2];
      else cfgScore += cfgSums[c];
      if (c === num - 1) cfgOut = String(cfgScore);
    }
    return { text: cfgOut, status: 0 };
  }

  // The highest game this bowler can still reach - 300 until the first frame
  // that is not a strike - and the game's own score once it is finished.
  // Scratch, scored as the game is: CFG, and CFG open play's frame 10 that ends
  // on its mark (LC_START_OPENPLAY, 0x003, with the cross lane bit masked off).
  // #MAX_GAME_HCP# adds the bowler's handicap, as #SUM_HCP_# does to #SUM#.
  // Both are empty unless Setup > Machine "Visa maxpoäng för serien" is ticked
  // (ShowMaxGame, ctx.showMaxGame) - CGame::GetText's MaxGameText; change the two together.
  if (tmp === '#MAX_GAME#' || tmp === '#MAX_GAME_HCP#') {
    if (!ctx.showMaxGame) return { text: '', status: 0 };
    var maxCFG = vbsIsCFG(lane);
    var tenthEndsOnMark = maxCFG && (lane.type & ~0x4000) === 0x003;
    var maxHcp = (tmp === '#MAX_GAME#') ? 0 : ppp.hcp;
    return { text: String(vbsMaxPossibleScore(ppp.score, as, maxCFG, tenthEndsOnMark) + maxHcp), status: 0 };
  }

  // The cross-lane arrows. An American (cross lane) game bowls a pair of lanes
  // alternately, and CGame::GetText puts the LEFT arrow on the row of the bowler
  // who is up on the left (odd) lane and the RIGHT arrow on the row of the one up
  // on the right lane - nobody else's row has one, and nothing else decides it:
  // it compares both lanes' active bowler with the row. (This used to work the
  // side out from the square, reverseArrows and amrSwitch, which drew an arrow on
  // every row of a theme that carries the arrow in its inactive row too.)
  if (tmp === '#LEFT_ARROW#' || tmp === '#RIGHT_ARROW#') {
    if (!vbsIsCrossLane(lane) || ctx.playerBeingProcessed < 0) return none;
    var up = vbsPairActive(lane);
    var me = vbsPairIndex(lane, ctx.playerBeingProcessed);
    var side = (up.right === me) ? 'right' : ((up.left === me) ? 'left' : '');
    return { text: (side === (tmp === '#LEFT_ARROW#' ? 'left' : 'right')) ? 'YES_SHOW' : '', status: 0 };
  }

  if (tmp === '#TEAM_HCP#') return { text: String(lane.teamHCP), status: 0 };
  if (tmp === '#LANE_TEAMNAME#') return { text: lane.teamName, status: 0 };

  // VBS-T OnScoring. The C++ strips "VBST_JOB_" off the token and reads section
  // "text<n>", key "text", from GameCtrl\VBST_<leaguePath>.ini; vbsonscoring.js
  // has already parsed that file into ctx.onScoringValues with the same keys.
  // An absent value resolves empty rather than null, exactly as the C++ leaves
  // an empty string when the section is missing - and empty is what makes the
  // element (and, for a panel id, the whole panel) disappear.
  if (tmp === '#VBST_JOB_text#') {
    var vals = ctx.onScoringValues;
    var v = vals ? vals['text' + num] : undefined;
    return { text: v === undefined ? '' : v, status: 0 };
  }

  // ClubLogos\<team name>.png, falling back to Empty.png - the C++ copies
  // Empty.png into place when the named logo is missing, which comes to the same
  // thing here. Which team: when the lane's first two bowlers carry the same team
  // name - one team to a lane, the ordinary team match - logo 1 and 2 are this
  // lane's team and the partner lane's, the odd lane's on the left; the partner's
  // is read from its bowler at THIS lane's last index (that is what the C++ does).
  // Otherwise logo n is bowler n's team. The name is made a file name the way
  // removeIllegalCharInFilePath makes it one: \ / : ? " < > | and space become _.
  if (tmp === '#teamLogo_#') {
    var all = lane.players;
    var name0 = all[0] ? all[0].teamName : '';
    var name1 = all[1] ? all[1].teamName : '';
    var teamName = '';
    if (name0 === name1) {
      var last = lane.noPlayers - 1;
      var partner = ctx.partnerPlayers;
      var partnerName = (last >= 0 && partner && partner[last]) ? partner[last].teamName : '';
      var odd = (lane.laneNumber % 2) !== 0;
      if (last >= 0) {
        if (num === 1) teamName = odd ? name0 : partnerName;
        else if (num === 2) teamName = odd ? partnerName : name0;
      }
    } else if (num >= 1 && num <= 8) {
      teamName = all[num - 1] ? all[num - 1].teamName : '';
    }
    teamName = String(teamName || '').replace(/[\\/:?"<>| ]/g, '_');
    if (!teamName) return { text: VBS_CLUBLOGO_DIR + 'Empty.png', status: 0 };
    return { text: VBS_CLUBLOGO_DIR + encodeURIComponent(teamName) + '.png', status: 0 };
  }

  // The team-sums line under the protocol. Every one of these returns empty when
  // the lane sum is not in use, which is what hides the whole bottom panel.
  // Argument order matches CalcStatusLine(num, bTfsum, text, includeHCP,
  // includeTeamHCP, isCFG) so the two can be read side by side.
  // Where CalcStatusLine has nothing - no lane sum in this game, a frame nobody
  // has reached - it writes nothing, and the element keeps its own <text>: null.
  var laneSum = function (v) { return v === null ? null : { text: v, status: 0 }; };
  if (tmp === '#FSUM#' || tmp === '#FSUM_SCR#')
    return laneSum(calcStatusLine(ctx, num, false, false, false, false));
  if (tmp === '#FSUM_HCP_#')
    return laneSum(calcStatusLine(ctx, num, false, true, false, false));
  if (tmp === '#FSUM_CFG_#')
    return laneSum(calcStatusLine(ctx, num, false, false, true, true));
  if (tmp === '#TFSUM#')
    return laneSum(calcStatusLine(ctx, num, true, true, true, false));
  if (tmp === '#TFSUM_SCR#')
    return laneSum(calcStatusLine(ctx, num, true, false, false, false));
  if (tmp === '#TFSUM_HCP#' || tmp === '#TFSUM_CFG#') {
    // Both add teamHCP to atoi() of what CalcStatusLine left in the buffer -
    // which, when it wrote nothing, is what was there before. So these always
    // answer a number, and a panel with one of them as its id is always drawn
    // (AmLeague's team strip). #TFSUM_HCP# counts the handicap, #TFSUM_CFG# does not.
    var tf = calcStatusLine(ctx, num, true, tmp === '#TFSUM_HCP#', false, tmp === '#TFSUM_CFG#');
    return { text: String((tf === null ? vbsAtoi(current) : vbsAtoi(tf)) + lane.teamHCP), status: 0 };
  }
  if (tmp === '#NO_OF_GAMES#') return { text: String(first.numGames), status: 0 };
  if (tmp === '#AVG#') return { text: String(ppp.averageScore), status: 0 };

  if (tmp === '#SCR#' || tmp === '#SCR_CFG#') {
    var scratch = (ppp.playerVbsHere === VBS_CONSTANT)
      ? ppp.totalPoints
      : ppp.totalPoints - ppp.activeGame * ppp.hcp;
    return { text: String(scratch), status: 0 };
  }

  if (tmp === '#HCP#')
    return { text: ppp.hcp === 0 ? '' : String(ppp.hcp), status: 0 };
  if (tmp === '#HCPD#')
    return { text: ppp.hcp === 0 ? '' : vbsLangText(ctx, 'IDS_HCPD'), status: 0 };
  if (tmp === '#TOTD#') return { text: vbsLangText(ctx, 'IDS_TOTD'), status: 0 };
  if (tmp === '#SCRD#') return { text: vbsLangText(ctx, 'IDS_SCRD'), status: 0 };

  if (tmp === '#TOT#')
    return { text: String(getTotal(lane.laneFinshFlag1 !== 0, ppp, false, lane)), status: 0 };
  if (tmp === '#TOT_CFG#')
    return { text: String(getTotal(lane.laneFinshFlag1 !== 0, ppp, true, lane)), status: 0 };

  if (tmp === '#PLAYER_STATUS#') {
    switch (ppp.bowlerType) {
      case GCI_SUB_BOWLER: return { text: 'Substitute.png', status: 0 };
      case GCI_PACER_BOWLER: return { text: 'Pacer.png', status: 0 };
      case GCI_VAC_BOWLER: return { text: 'Vacancy.png', status: 0 };
      case GCI_BLIND_BOWLER: return { text: 'Absent.png', status: 0 };
      default: return { text: 'Regular.png', status: 0 };
    }
  }

  // RedPin markers. The id only gates visibility - the picture element carries
  // the file - and the whole group is dead unless the game has a red pin.
  if (tmp.indexOf('_PIN_') >= 0 && tmp.indexOf('#') >= 0) {
    if (!lane.RedPin) return none;
    var box = num * 2 - 2;
    var hasRedPin = (ppp.status[box] & GCI_REDPIN) !== 0;
    if (tmp.indexOf('#FRAME_RED_PIN_MISS_') >= 0 && hasRedPin && ppp.score[box] !== 10)
      return { text: num < 10 ? 'RedPin172x86Enabled.png' : 'RedPin86x86Enabled.png', status: 0 };
    if (tmp.indexOf('#FRAME_RED_PIN_STRIKE_') >= 0 && hasRedPin && ppp.score[box] === 10)
      return { text: num < 10 ? 'RedPin172x86Strike.png' : 'RedPin86x86Strike.png', status: 0 };
    return none;
  }

  // Cross-lane only. A single lane file carries no partner lane, so these stay
  // empty here - see the note in TakTV.js.
  if (tmp.indexOf('_ARROW#') >= 0) return none;

  // The next-lane plate exists only for a VBS tournament that asked for it.
  if (tmp === '#ID_NEXT_GAME_LANE#' || tmp === '#NEXT_GAME_LANED#' || tmp === '#NEXT_GAME_LANE#') {
    var show = (lane.vbsHere === VBS_CONSTANT) && (lane.showNextLane > 0) && ppp.nextLanes[0] > 0;
    if (!show) return none;
    if (tmp === '#ID_NEXT_GAME_LANE#') return { text: '#ID_NEXT_GAME_LANE#', status: 0 };
    if (tmp === '#NEXT_GAME_LANED#') return { text: vbsLangText(ctx, 'IDS_NEXT_GAME_LANED'), status: 0 };
    return { text: String(ppp.nextLanes[0]), status: 0 };
  }

  // Unknown id: CGame::GetText falls off the end without touching the buffer,
  // so the element keeps whatever literal <text> it declared. null says so.
  return null;
}

// CGameAbstract::GetPlayer: index 0..16, wrapped modulo 8 off a normal lane, and
// a slot past noPlayers is a real but unused (zeroed) GCI_PLAYERSTRUCT rather
// than a null. BitmapFromXml leaves m_playerBeeingProcessed at noPlayers when
// its loop ends, so the root after-layers resolve against exactly such a slot -
// returning undefined here instead would make them fall back to their literal
// <text>, which is not what the TV shows.
function currentPlayer(ctx) {
  var index = ctx.playerBeingProcessed;
  if (index < 0 || index > 16) return null;
  var p = ctx.lane.players[index > 7 ? index % 8 : index];
  return p || vbsEmptyPlayer();
}

var vbsEmptyPlayerCache = null;

function vbsEmptyPlayer() {
  if (!vbsEmptyPlayerCache) {
    var zeros = [];
    for (var i = 0; i < 21; i++) zeros.push(0);
    vbsEmptyPlayerCache = {
      playerName: '', activeGame: 0, activeSquare: 0, totalPoints: 0, hcp: 0,
      scoreMode: 0, playerVbsHere: 0, startPoints: 0, missedGame: 0, teamName: '',
      score: zeros, status: zeros.slice(), nextLanes: [0, 0, 0, 0],
      bowlerType: 0, ballSpeed: 0, averageScore: 0, numGames: 0
    };
  }
  return vbsEmptyPlayerCache;
}

// min(9, as/2), with the 10th frame promoted to "10" once it can no longer grow.
function activeFrameText(player) {
  if (!player) return '0';
  var aas = player.activeSquare;
  var text = String(Math.min(9, Math.floor(aas / 2)));
  if (aas > 19) {
    if (player.score[18] + player.score[19] < 10) text = '10';
    else if (aas >= 21) text = '10';
  }
  return text;
}

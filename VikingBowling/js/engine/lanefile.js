// ---------------------------------------------------------------------------
// lanefile.js - the lane file as JSON, in the frozen format of Viking 4.4.
//
// Port of CGCI_info::GetJsonFromPlayInfo (shared/lanedata/GCI_info.cpp): the same
// keys in the same order, every value a quoted string (sys::jsonutil::Str), the
// duplicate "team_mode"/"updateSpeed" keys of the tournament block overwriting the
// lane's own in place (nlohmann::ordered_json keeps the first position), and
// "activePlayerOtherLane" only in cross lane play. This is what LoadCom hands the
// HTML lane TV under "lane" in every payload (BuildHtmlPayload).
// ---------------------------------------------------------------------------

const S = (v) => {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === undefined || v === null) return '0';
  return String(v);
};

function arr21(a) {
  const o = {};
  for (let j = 0; j < 21; j++) o[String(j + 1)] = S(a[j] || 0);
  return o;
}

// pis: the lane struct (makeLane); other: the partner lane in cross lane play, or null
export function laneFileJson(pis, other = null) {
  const pt = {};
  pt.head1 = S(pis.head1);
  pt.head2 = S(pis.head2);
  pt.booking_name = S(pis.booking_name);
  pt.bg_image = S(pis.bg_image);
  pt.protocol = S(pis.protocol);
  pt.onlineID = S(pis.onlineID);
  pt.hcp_mode = S(pis.hcp_mode);
  pt.team_mode = S(pis.team_mode);
  pt.updateSpeed = S(pis.updateSpeed);
  pt.RedPin = S(pis.RedPin);
  pt.type = S(pis.type);
  pt.data = S(pis.data);
  pt.noPlayers = S(pis.noPlayers);
  pt.activePlayer = S(pis.activePlayer);
  if ((pis.type & 0x4000) && other)
    pt.activePlayerOtherLane = S(other.isAnyPlayerActive ? other.activePlayer : -1);
  pt.playedPlayerID = S(pis.playedPlayerID);
  pt.playedPinPattern = S(pis.playedPinPattern);
  pt.laneDataModifiedTime = S(pis.laneDataModifiedTime);
  pt.laneImageModifiedTime = S(pis.laneImageModifiedTime);
  pt.checkSum = S(pis.checkSum);
  pt.isAnyPlayerActive = S(pis.isAnyPlayerActive);
  pt.lastBallSpeed = S(pis.lastBallSpeed);
  pt.reverseArrows = S(pis.reverseArrows);
  pt.laneFinshFlag1 = S(pis.laneFinshFlag1);
  pt.laneFinshFlag2 = S(pis.laneFinshFlag2);
  pt.laneStatus = S(pis.laneStatus);
  pt.exciter = S(pis.exciter);
  const tg = pis.tournamentGame;
  pt.vbsHere = S(tg.vbsHere);
  pt.bmp_name = S(tg.bmp_name);
  pt.team_mode = S(tg.team_mode);          // same key: overwrites in place, as ordered_json does
  pt.pari = S(tg.pari);
  pt.updateSpeed = S(tg.updateSpeed);      // same key again
  pt.calculationSpeed = S(tg.calculationSpeed);
  pt.showNextLane = S(tg.showNextLane);
  pt.numReservPlayers = S(tg.numReservPlayers);
  pt.playerMovements = S(tg.movementFileName);
  pt['teamNames to lane'] = { 1: S(pis.teamName[0]), 2: S(pis.teamName[1]) };
  pt.competitionID = S(pis.competitionID);
  pt.StartTime = S(pis.StartTime);
  pt.ResvLongId = S(pis.ResvLongId);
  pt.PerLongId = S(pis.PerLongId);
  pt.EndTime = S(pis.EndTime);
  pt.LaneOffTime = S(pis.LaneOffTime);
  pt.dllName = S(pis.dllName);
  pt.teamHCP = S(pis.teamHCP);
  pt.useTeamHCP = S(!!pis.useTeamHCP);
  pt.totalSeries = S(pis.totalSeries);
  pt.hdcp_rule = pis.hdcp_rule === undefined ? '\u0000' : String(pis.hdcp_rule);
  pt.tpercent_hdcp = S(pis.tpercent_hdcp);
  pt.tbase_hdcp = S(pis.tbase_hdcp);
  pt.t_above_percent = S(pis.t_above_percent);
  pt.tmax_hdcp = S(pis.tmax_hdcp);
  pt.t_min_ave = S(pis.t_min_ave);
  pt.t_extra_percent = S(pis.t_extra_percent);
  pt.t_both_percent = S(pis.t_both_percent);
  pt.laneNumber = S(pis.laneNumber);
  pt.practiceMethod = S(pis.practiceMethod);
  pt.practiceAmount = S(pis.practiceAmount);

  const players = {};
  for (let i = 0; i < pis.noPlayers; i++) {
    const p = pis.player[i];
    const a = p.amrLeague;
    const tp = p.tournamentPlayer;
    const nl = {};
    for (let j = 0; j < 15; j++) nl[String(j + 1)] = S(p.nextLanes[j] || 0);
    players['player ' + (i + 1)] = {
      playerName: S(p.playerName),
      originalPlayerName: S(p.originalPlayerName),
      playerMemberNumber: S(p.playerMemberNumber),
      playerIdNumber: S(p.playerIdNumber),
      activeGame: S(p.activeGame),
      activeSquare: S(p.activeSquare),
      paymentCategory: S(p.paymentCategory),
      amrLeague: {
        leaguePath: S(a.leaguePath), averageScore: S(a.averageScore), blindScore: S(a.blindScore),
        bowlerType: S(a.bowlerType), startLane: S(a.startLane), teamNumber: S(a.teamNumber),
        bowlerNumber: S(a.bowlerNumber), vacScore: S(a.vacScore), activeLane: S(a.activeLane),
        numGames: S(a.numGames), practiceElapsed: S(a.practiceElapsed), ballSpeed: S(a.ballSpeed),
        amrSwitch: S(a.amrSwitch)
      },
      totalPoints: S(p.totalPoints),
      hcp: S(p.hcp),
      playerVbsHere: S(tp.playerVbsHere),
      startPoints: S(tp.startPoints),
      teamName: S(tp.teamName),
      protocolPosition: S(tp.protocolPosition),
      missedGame: S(tp.missedGame),
      score: arr21(p.score),
      cameraImageID: arr21(p.cameraImageID),
      status: arr21(p.status),
      pinConfig: arr21(p.pinConfig),
      timeOfThrow: arr21(p.timeOfThrow),
      ballSpeed: arr21(p.ballSpeed),
      averageBallSpeedFirst: S(p.averageBallSpeedFirst),
      numFirst: S(p.numFirst),
      averageBallSpeedSecond: S(p.averageBallSpeedSecond),
      numSecond: S(p.numSecond),
      playerEmail: S(p.playerEmail),
      nextLanes: nl,
      scoreMode: S(p.scoreMode),
      scratchPoints: S(p.scratchPoints)
    };
  }
  pt.players = players;
  return pt;
}

// The text form a third party reads (CGCI_info::WriteLaneFileJson indents by four;
// "/" is written as "\/" by the jsonutil facade).
export function laneFileText(pis, other = null) {
  return JSON.stringify(laneFileJson(pis, other), null, 4).replace(/\//g, '\\/');
}

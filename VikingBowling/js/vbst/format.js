// ---------------------------------------------------------------------------
// format.js - the VBS-T competition files, read as the reception reads them.
//   TOURNAMENT_SHIFT_HEADER_STRUCT (<name>.h001, shared/lanedata/tdf.h): 444 bytes as
//     MSVC lays the struct out for x86; older files are shorter and the rest reads as 0,
//     as VBSTReadTournamentHeader does (it reads min(length, 444) into a zeroed struct).
//   TOURNAMENT_SPECIAL_POINT_STRUCT (<name>.r001): 20-byte records.
//   The movement files (Reception/vbsTournaments/PlayerMovements/*.ini): [pN] per
//     position, sK lane offset in serie K (0 = sits out), ppK protocol position, stXpK
//     points-group markers, lagnamn team name, ba=1 the team's baker line.
// ---------------------------------------------------------------------------
const latin1 = new TextDecoder('windows-1252');

function cstr(bytes, off, len) {
  let end = off;
  while (end < off + len && end < bytes.length && bytes[end] !== 0) end++;
  return latin1.decode(bytes.subarray(off, end));
}

export function parseHeader(buf) {
  const src = new Uint8Array(buf);
  const b = new Uint8Array(444);
  b.set(src.subarray(0, Math.min(444, src.length)));
  const v = new DataView(b.buffer);
  const i32 = (o) => v.getInt32(o, true), u16 = (o) => v.getUint16(o, true), u8 = (o) => b[o];
  return {
    shiftName: cstr(b, 0, 32), practiceMethod: i32(32), practiceAmount: i32(36),
    numGames: i32(40), numReservPlayers: i32(44), numPlayers: i32(48),
    rotationStartLane: i32(52), firstLane: i32(56), lastLane: i32(60), playStyle: i32(64), competitionID: i32(68),
    lanesToMove: i32(72), whenToMove: i32(76), numPlayersPerLane: i32(80), lastActiveMovementType: i32(84),
    movementstartLane: i32(88), movementFileName: cstr(b, 92, 32), onScoringFile: cstr(b, 124, 32),
    useExtraPoints: i32(156), hcpType: i32(164), useStart: i32(168), laneTotalAtBottomFormat: i32(172),
    hidePersonalTotal: i32(176), extraEqualazitionSerie: i32(180), moveMethod: i32(220),
    numberOfTeams: u16(228), useSpecialPoints: i32(232), numberOfSpecialPoints: u16(236),
    resultTemplate: cstr(b, 241, 32), showResultsEachGame: i32(280), showEndResults: i32(320),
    pari: u8(340), calculationSpeed: u8(341), columnsToShow: v.getUint32(348, true),
    teamNames: [...b.subarray(357, 365)], use_stp_points: u8(365),
    stp_win: [...b.subarray(366, 374)], stp_equal: [...b.subarray(374, 382)],
    showNextLane: u8(382), playMethod: u8(383), withBonus: i32(384), bonus: u8(388), VBSTvariant: u8(389),
    hcp_baker_auto: u8(404), fileLength: src.length
  };
}

export function parseRules(buf) {
  const v = new DataView(buf);
  const out = [];
  for (let o = 0; o + 20 <= buf.byteLength; o += 20)
    out.push({ numPoints: v.getInt32(o, true), pointType: v.getUint32(o + 4, true), calculatedFromWhatLanes: v.getUint32(o + 8, true),
      numPointsIfEqual: v.getInt32(o + 12, true), inWhatSerie: v.getUint32(o + 16, true) });
  return out;
}

// GetPrivateProfileString-style INI: sections and keys case-insensitive
export function parseIni(text) {
  const out = {};
  let sec = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === ';') continue;
    if (line[0] === '[') { const e = line.indexOf(']'); sec = line.substring(1, e > 0 ? e : line.length).trim().toLowerCase(); out[sec] = out[sec] || {}; continue; }
    const eq = line.indexOf('=');
    if (eq < 0 || sec === null) continue;
    const k = line.substring(0, eq).trim().toLowerCase();
    if (!(k in out[sec])) out[sec][k] = line.substring(eq + 1).trim();
  }
  return out;
}

// The movement file: positions = [p1],[p2]... while the section has s1; series = s1,s2... in [p1]
export function parseMovement(text) {
  const ini = parseIni(text);
  const positions = [];
  for (let p = 1; ini['p' + p] && ini['p' + p].s1 !== undefined; p++) positions.push(ini['p' + p]);
  let nSer = 0;
  if (positions.length) while (positions[0]['s' + (nSer + 1)] !== undefined) nSer++;
  return { positions, nSer };
}

export async function fetchMovement(name) {
  const url = 'Reception/vbsTournaments/PlayerMovements/' + encodeURIComponent(name);
  const r = await fetch(url);
  if (!r.ok) return null;
  return parseMovement(latin1.decode(new Uint8Array(await r.arrayBuffer())));
}

export function b64ToBuffer(s) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b.buffer;
}

// A zeroed header with the given fields, for the formats whose dialog builds the header
export function makeHeader(fields) {
  return Object.assign({
    shiftName: '', practiceMethod: 0, practiceAmount: 0, numGames: 4, numReservPlayers: 0, numPlayers: 8,
    rotationStartLane: 1, firstLane: 1, lastLane: 4, playStyle: 0, competitionID: 0, lanesToMove: 1, whenToMove: 1,
    numPlayersPerLane: 2, lastActiveMovementType: 0, movementstartLane: 1, movementFileName: '', onScoringFile: '',
    useExtraPoints: 0, hcpType: 0, useStart: 0, laneTotalAtBottomFormat: 0, hidePersonalTotal: 0, extraEqualazitionSerie: 0,
    moveMethod: 0, numberOfTeams: 0, useSpecialPoints: 0, numberOfSpecialPoints: 0, resultTemplate: '', showResultsEachGame: 1,
    showEndResults: 1, pari: 0, calculationSpeed: 5, columnsToShow: 0, teamNames: [0, 0, 0, 0, 0, 0, 0, 0], use_stp_points: 0,
    stp_win: [0, 0, 0, 0, 0, 0, 0, 0], stp_equal: [0, 0, 0, 0, 0, 0, 0, 0], showNextLane: 1, playMethod: 0, withBonus: 0, bonus: 0,
    VBSTvariant: 7, hcp_baker_auto: 0
  }, fields);
}

export const TSP = { PERSONAL_EXTRA: 0, TEAM_POINT: 1, TEAM_MOD4_POINT: 2, TEAM_SPECIAL: 3, EACH_LANE: 0, LANE_PAIR: 1, ALL_LANES: 2 };

// ---------------------------------------------------------------------------
// session.js - a VBS-T competition in the game: every format the reception offers -
// the plugins' own (BANP, Ind, Petersen/RR, Skåne, Lagspel, Korp) and every Auto format -
// played serie by serie as VBS-T plays it. The player bowls their own lane (or lane pair
// in AMR) in 3D; every other lane is bowled by machine players through the same OpenPlay
// engine; after each serie the competition engine (competition.js) deals, scores and ranks.
// ---------------------------------------------------------------------------
import { PREDEFINED } from './predefined.js';
import { AUTO_FORMATS, MOVEMENT_FILES } from './autoformats.js';
import { parseHeader, parseRules, fetchMovement, b64ToBuffer } from './format.js';
import { Competition } from './competition.js';
import { loadOnScoring, onScoringIni } from './onscoring.js';
import { OpenPlayGame, makeLane, makePlayer, GCI, countPins } from '../engine/openplay.js';
import { gameTotal } from '../engine/bowlingscore.js';
import { MachinePlayer, generateNames, SKILLS } from '../ai/bots.js';
import { LaneGame } from '../game/lanegame.js';
import { warmChoice, vbstPractice } from '../game/warmup.js';
import { withoutBumperMark } from '../engine/correction.js';
import { t, lang } from '../i18n.js';

export { PREDEFINED };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEAM_NAMES = ['Valhalla BK', 'Midgård BC', 'Asgård IF', 'Birka BS', 'Hedeby BK', 'Sleipner BC', 'Yggdrasil IF', 'Mjölner BS',
  'Fenris BK', 'Bifrost BC', 'Gungner IF', 'Draupner BS', 'Skidbladner BK', 'Huginn BC', 'Muninn IF', 'Brisingamen BS'];
const OWN_TEAM = { sv: 'Vikingarna', en: 'The Vikings', da: 'Vikingerne', no: 'Vikingene', fi: 'Viikingit' };

let autoCache = null;
export async function loadAutoFormats() {
  if (autoCache) return autoCache;
  autoCache = AUTO_FORMATS.map((f) => {
    const header = parseHeader(b64ToBuffer(f.h));
    const rules = f.r ? parseRules(b64ToBuffer(f.r)) : [];
    const missing = header.lastActiveMovementType === 0 && !!header.movementFileName &&
      !MOVEMENT_FILES.some((m) => m.toLowerCase() === header.movementFileName.toLowerCase());
    const players = header.numPlayers - header.numReservPlayers;
    const teams = header.teamNames.filter((v) => v > 0).length;
    return {
      name: f.name, header, rules, missing,
      summary: (l) => `${players} ${tWord('players', l)} · ${header.numGames} ${tWord('series', l)} · ${header.playStyle ? 'AM' : 'EU'}` +
        (teams > 1 ? ` · ${teams} ${tWord('teams', l)}` : '') + (missing ? ' · ⚠' : '')
    };
  });
  return autoCache;
}
function tWord(w, l) {
  const d = { players: { sv: 'spelare', en: 'players', da: 'spillere', no: 'spillere', fi: 'pelaajaa' },
    series: { sv: 'serier', en: 'games', da: 'serier', no: 'serier', fi: 'sarjaa' },
    teams: { sv: 'lag', en: 'teams', da: 'hold', no: 'lag', fi: 'joukkuetta' } };
  return (d[w] && d[w][l]) || w;
}

// Resolves a format id ("banp44", or "auto:<name>") to header, rules and movement, as
// VBS-T books it, with the player's choice of EUR or AMR applied
export async function resolveFormat(formatId, american, fetchMove = fetchMovement) {
  let fmt;
  if (formatId && formatId.startsWith('auto:')) {
    const name = formatId.slice(5);
    const list = await loadAutoFormats();
    const f = list.find((x) => x.name === name);
    if (!f) throw new Error('Unknown format ' + name);
    if (f.missing) throw new Error(t('unavailable') + ' (' + f.header.movementFileName + ')');
    const header = Object.assign({}, f.header);
    if (american && !header.playStyle) header.playStyle = 1;
    if (!american && header.playStyle) header.playStyle = 0;
    header.movementstartLane = header.movementstartLane || 1;
    if (header.playStyle && header.movementstartLane % 2 === 0) header.movementstartLane--;
    fmt = { id: formatId, title: name, header, rules: f.rules, onScoring: header.onScoringFile, auto: true };
  } else {
    const p = PREDEFINED.find((x) => x.id === formatId) || PREDEFINED[0];
    fmt = Object.assign({ id: p.id, title: p.title(lang()) }, p.build(american));
  }
  const h = fmt.header;
  let movement = null;
  if (h.lastActiveMovementType === 0 && h.movementFileName) {
    movement = await fetchMove(h.movementFileName);
    if (!movement || !movement.positions.length) throw new Error(t('unavailable') + ' (' + h.movementFileName + ')');
  }
  return { fmt, movement };
}

// The players for a format: you in the first row, machine players everywhere else
export function makePlayers(fmt, { skillAvg, humanName, rng = Math.random, language = 'sv' }) {
  const n = fmt.header.numPlayers;
  const names = generateNames(n, rng, language, [humanName || '']);
  const players = [];
  for (let i = 0; i < n; i++) {
    const avg = Math.round(skillAvg + (rng() - 0.5) * 30);
    const bot = new MachinePlayer({ name: names[i] || 'Bot ' + i, average: avg, leftHanded: rng() < 0.15, rng });
    const p = { name: i === 0 ? (humanName || 'Spelare') : bot.name, human: i === 0, bot, average: avg, hcp: 0, startPoint: 0 };
    if (fmt.skaneHcp) p.hcp = Math.trunc(Math.max(0, Math.min(42, (210 - avg) * 0.7)));
    players.push(p);
  }
  return players;
}

// Team names on a competition: yours first; teams the header defines by rows, or the
// movement file's lagnamn; a baker line ("Use_Team_Name") is the team itself
export function nameTeams(comp, fmt, language = 'sv', shuffle = true) {
  const own = OWN_TEAM[language] || OWN_TEAM.en;
  const pool = TEAM_NAMES.slice();
  if (shuffle) pool.sort(() => Math.random() - 0.5);
  const byMovement = new Map();
  for (const r of comp.rows) {
    if (r.teamIndex !== undefined) r.team = r.teamIndex === 0 ? own : pool[(r.teamIndex - 1) % pool.length];
    else if (r.movementTeam) {
      if (!byMovement.has(r.movementTeam)) byMovement.set(r.movementTeam, byMovement.size === 0 ? own : pool[(byMovement.size - 1) % pool.length]);
      r.team = byMovement.get(r.movementTeam);
    }
  }
  for (const r of comp.rows) {
    if (r.baker || (fmt.bakerRows && fmt.bakerRows.includes(r.idx))) {
      r.baker = true;
      const mates = comp.rows.filter((x) => x.team === r.team && !x.baker && !x.reserve);
      r.name = (r.team || 'Team') + '{' + (mates.length || 2) + '}';
      r.human = false;
      const avg = mates.length ? Math.round(mates.reduce((a, m) => a + (m.bot ? m.bot.average : 160), 0) / mates.length) : 160;
      r.bot = new MachinePlayer({ name: r.name, average: avg });
    }
  }
  return [...new Set(comp.rows.map((r) => r.team).filter(Boolean))];
}

// The row the player bowls: the first real bowler (not a reserve, not a baker line) who is
// dealt a lane; a format whose only bowlers are baker lines gives the player that line
export function pickHuman(comp, humanName) {
  const bowls = (r) => r.lanes.some(Boolean);
  let row = comp.rows.find((r) => !r.reserve && !r.baker && bowls(r)) || comp.rows.find((r) => bowls(r)) || comp.rows[0];
  for (const r of comp.rows) r.human = r === row;
  if (humanName) { row.name = row.baker ? row.name : humanName; row.humanName = humanName; }
  return row.idx;
}

// Strikes, spares, open frames and splits from a finished game
export function statsOf(p) {
  let strikes = 0, spares = 0, opens = 0, splits = 0;
  const s = p.score;
  for (let f = 0; f < 9; f++) {
    const a = f * 2;
    if (s[a] === 10) { strikes++; continue; }
    if (p.status[a] & 1) splits++;
    if (s[a] + s[a + 1] === 10) spares++; else opens++;
  }
  if (s[18] === 10) { strikes++; if (s[19] === 10) { strikes++; if (s[20] === 10) strikes++; } else if (s[19] + s[20] === 10) spares++; }
  else { if (p.status[18] & 1) splits++; if (s[18] + s[19] === 10) { spares++; if (s[20] === 10) strikes++; } else opens++; }
  return { strikes, spares, opens, splits };
}

// The lane files of a group of lanes for serie s, as VBS-T starts a competition lane
// (CShiftSettings::CreateGCI / GameProcessor::GetCompanyWaitingOnLane)
export function lanesFor(comp, fmt, group, s, { league, theme = 'Standard' }) {
  const h = fmt.header;
  const type = (h.laneTotalAtBottomFormat ? GCI.LC_START_TEAMPLAY : GCI.LC_START_COMPETITION) | (h.playStyle ? GCI.LC_START_AMERICAN : 0);
  return group.map(({ lane, rows }) => {
    const pis = makeLane(lane);
    pis.type = type;
    pis.laneStatus = GCI.Tournament;
    pis.dllName = 'VBSTournam.dll';
    pis.protocol = theme;
    pis.booking_name = String(fmt.title).slice(0, 54);
    pis.hcp_mode = h.hidePersonalTotal ? 3 : h.hcpType;
    pis.totalSeries = comp.numGames;
    pis.competitionID = 4400;
    const tg = pis.tournamentGame;
    tg.vbsHere = GCI.VBS_CONSTANT; tg.team_mode = h.laneTotalAtBottomFormat; tg.pari = h.pari;
    tg.calculationSpeed = h.calculationSpeed || 5; tg.updateSpeed = tg.calculationSpeed; tg.showNextLane = h.showNextLane;
    tg.numReservPlayers = h.numReservPlayers; tg.movementFileName = h.movementFileName || '';
    pis.noPlayers = rows.length;
    pis.activePlayer = rows.length ? 0 : -1;
    pis.isAnyPlayerActive = rows.length ? 1 : 0;
    if (h.laneTotalAtBottomFormat && rows[0]) pis.teamName[0] = rows[0].team;
    rows.forEach((r, i) => {
      const p = makePlayer(r.name, r.id, GCI.SCORING_NORMAL);
      p.hcp = comp.hcpOf(r);
      p.activeGame = s;
      p.amrLeague.leaguePath = league;
      p.amrLeague.averageScore = r.bot ? r.bot.average : 0;
      p.amrLeague.bowlerNumber = 1;
      p.amrLeague.amrSwitch = h.playStyle === 2 ? 1 : 0;
      p.nextLanes[0] = s + 1 < comp.numGames ? r.lanes[s + 1] : 0;
      let prev = 0, bon = 0, missed = 0;
      for (let j = 0; j < s; j++) { prev += r.games[j]; bon += r.bonuses[j]; if (r.games[j] === 0) missed++; }
      p.totalPoints = prev;
      const tp = p.tournamentPlayer;
      tp.playerVbsHere = GCI.VBS_CONSTANT;
      tp.startPoints = (h.useStart ? r.startPoint : 0) + bon;
      tp.teamName = r.team || '';
      tp.protocolPosition = r.pp[s];
      tp.missedGame = missed;
      pis.player[i] = p;
      r.livePlayer = p;
    });
    return pis;
  });
}

// Bowl every ball of the lanes of an engine with machine players (no 3D). record: an array that
// gets every ball as { lane, after } (the pins left standing), to be bowled again on another engine
export function simulateLanes(eng, rowOf, record = null) {
  const rack = new Map(), kind = new Map();
  const lanes = eng.lanes.map((l) => l.laneNumber);
  let turn = lanes[0];
  for (let guard = 0; guard < 400; guard++) {
    const order = lanes.length > 1 ? [turn, lanes.find((n) => n !== turn)] : lanes;
    const lane = order.find((n) => eng.activeOn(n));
    if (!lane) break;
    if (lanes.length > 1) turn = lanes.find((n) => n !== lane);
    const a = eng.activeOn(lane);
    const r = rowOf(a.player);
    const bot = (r && r.bot) || new MachinePlayer({ name: 'x', average: 150 });
    const first = eng.nextBallIsFirst(lane);
    const before = first ? 0x3FF : (rack.has(lane) ? rack.get(lane) : 0x3FF);
    let after;
    if (first) { const f = bot.firstBall(); after = f.standing; kind.set(lane, f.kind); }
    else after = bot.secondBall(before, kind.get(lane)) & before;
    const res = eng.score(lane, after, 10 - countPins(after), 0, false);
    rack.set(lane, after);
    if (!res) break;
    if (record) record.push({ lane, after });
  }
  eng.events.length = 0;
}

// A machine-bowled group of lanes shown at the pace of the player's own lanes: the serie is drawn
// first (simulateLanes on a copy) and then bowled again on the lanes the TVs and the consoles show,
// ball by ball, while the player bowls. A warm-up is bowled first (practice balls, not scored).
// A console correction on such a lane changes its lane struct, and the result is read from it.
export class PacedLanes {
  constructor(lanes, rowOf, { isCFG = false, practice = null } = {}) {
    this.rowOf = rowOf;
    // (a lane of an American pair with nobody on it has no warm-up: it would never end it)
    if (practice && practice.amount > 0) for (const pis of lanes) if (pis.noPlayers) { pis.practiceMethod = practice.method; pis.practiceAmount = practice.amount; }
    const sim = structuredClone(lanes);
    for (const pis of sim) { pis.practiceMethod = 0; pis.practiceAmount = 0; }
    const simEng = new OpenPlayGame({ lanes: sim, isCFG });
    simEng.startGame();
    this.balls = [];
    simulateLanes(simEng, rowOf, this.balls);
    this.eng = new OpenPlayGame({ lanes, isCFG });
    this.eng.startGame();
    this.lanes = lanes;
    this.next = 0;
    this.rack = new Map(); this.kind = new Map();
    this.turn = lanes[0].laneNumber;
    this.overAt = 0;
  }
  get numbers() { return this.lanes.map((l) => l.laneNumber); }
  warm() { return this.lanes.some((l) => this.eng.isWarmUp(l.laneNumber)); }
  progress() { return this.balls.length ? this.next / this.balls.length : 1; }
  done() { return this.next >= this.balls.length && !this.warm(); }

  // One step: a practice ball while the warm-up lasts, else the next ball of the serie.
  // Answers the lane that changed, or 0.
  step(stopMs = 30000) {
    const eng = this.eng;
    if (this.warm()) {
      // a warm-up on time ends by its clock (the stop picture, then the serie)
      const timed = this.lanes.find((p) => p.practiceMethod === GCI.PRACTICE_MINUTES);
      if (timed) {
        if (!this.overAt && eng.practiceSecondsLeft(timed.laneNumber) <= 0) { eng.practiceClockOver(); this.overAt = Date.now(); return timed.laneNumber; }
        if (this.overAt && Date.now() - this.overAt >= stopMs) { eng.practiceClockFinish(); this.overAt = 0; return timed.laneNumber; }
      }
      const nums = this.numbers;
      const order = nums.length > 1 ? [this.turn, nums.find((n) => n !== this.turn)] : nums;
      // only a lane still in its warm-up bowls a practice ball: in an American pair one lane can end
      // its warm-up (in frames) before the other, and a ball bowled on it now would be a serie ball
      // that is not the drawn serie's
      const lane = order.find((n) => eng.isWarmUp(n) && eng.activeOn(n));
      if (!lane) return 0;
      if (nums.length > 1) this.turn = nums.find((n) => n !== lane);
      const a = eng.activeOn(lane);
      const r = this.rowOf(a.player);
      const bot = (r && r.bot) || new MachinePlayer({ name: 'x', average: 150 });
      const first = eng.nextBallIsFirst(lane);
      const before = first ? 0x3FF : (this.rack.get(lane) ?? 0x3FF);
      let after;
      if (first) { const f = bot.firstBall(); after = f.standing; this.kind.set(lane, f.kind); }
      else after = bot.secondBall(before, this.kind.get(lane)) & before;
      eng.scoreBall(lane, after, 10 - countPins(after), 0, false);
      this.rack.set(lane, eng.nextBallIsFirst(lane) ? 0x3FF : after);
      return lane;
    }
    // the warm-up has just ended: the pair's bowlers up as at the start (RefreshGame)
    if (this.wasWarm !== false && this.eng.isCrosslane() && this.next === 0) this.eng.refreshGame(this.eng.m_laneNumber);
    this.wasWarm = false;
    if (this.next >= this.balls.length) return 0;
    const b = this.balls[this.next++];
    eng.scoreBall(b.lane, b.after, 10 - countPins(b.after), 0, false);
    eng.events.length = 0;
    return b.lane;
  }
  // The rest at once: the warm-up ended as End practice ends it, every ball left bowled
  flush() {
    for (const l of this.numbers) if (this.eng.isWarmUp(l)) this.eng.endPracticeFromConsole(l);
    while (this.next < this.balls.length) this.step();
  }
}

// Plays a whole competition with machine players only (the human row too): the tests use it
export function simulateCompetition(comp, fmt, opts = {}) {
  const league = 'TEST.h001';
  for (let s = 0; s < comp.numGames; s++) {
    for (const g of comp.groupsInSerie(s)) {
      const lanes = lanesFor(comp, fmt, g, s, { league });
      const eng = new OpenPlayGame({ lanes, rng: opts.rng });
      eng.startGame();
      const rowOf = (p) => comp.rows.find((r) => r.id === p.playerIdNumber);
      simulateLanes(eng, rowOf);
      for (const pis of lanes) for (let i = 0; i < pis.noPlayers; i++) {
        const p = pis.player[i];
        comp.recordGame(rowOf(p), s, p.score, { total: gameTotal(p.score), ...statsOf(p) });
      }
    }
    comp.endSerie(s);
  }
  return comp.standings();
}

export class VbstSession {
  static async create(app, formatId, american) {
    const s = new VbstSession(app);
    const { fmt, movement } = await resolveFormat(formatId, american);
    s.fmt = fmt;
    s.movement = movement;
    s.league = 'VBG_' + String(formatId || 'x').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40) + '.h001';
    s.makeRobots(true);
    return s;
  }

  constructor(app) { this.app = app; this.stopped = false; }

  title() { const ps = this.fmt.header.playStyle; return this.fmt.title + ' · ' + (ps ? (ps === 2 ? 'AMS' : 'AMR') : 'EUR'); }

  makeRobots(reroll) {
    if (!reroll && this.players) return;
    const skillAvg = SKILLS.find((s) => s.id === this.app.settings.skill).avg;
    this.players = makePlayers(this.fmt, { skillAvg, humanName: this.app.settings.name, language: lang() });
    this.comp = new Competition({ header: this.fmt.header, rules: this.fmt.rules, movement: this.movement, players: this.players, name: this.league });
    this.teams = nameTeams(this.comp, this.fmt, lang());
    this.humanIndex = pickHuman(this.comp, this.app.settings.name);
  }

  rosterHtml() {
    const comp = this.comp;
    const line = (r) => `<div class="robot${r.human ? ' me' : ''}"><span>${r.team ? `<span class="teamTag">${esc(r.team)}</span>` : ''}${r.human ? '&#128100;' : '&#129302;'} ${esc(r.human && !r.baker ? (this.app.settings.name || t('you')) : r.name)}${r.reserve ? ' (res)' : ''}</span><small>${r.human ? t('you') : t('skill') + ': ' + (r.bot ? r.bot.average : '')}${comp.hcpOf(r) ? ' · HCP ' + comp.hcpOf(r) : ''}</small></div>`;
    const set = new Set();
    for (const r of comp.rows) for (const l of r.lanes) if (l) set.add(l);
    return `<div class="note">${comp.numGames} ${tWord('series', lang())} · ${comp.american ? 'AMR' : 'EUR'} · ${set.size} ${t('lanes').toLowerCase()}</div>` + comp.rows.map(line).join('');
  }

  // ---- playing ---------------------------------------------------------------
  async start(humanName) {
    const app = this.app;
    this.stopped = false;
    const keep = this.comp.rows.map((r) => ({ team: r.team, name: r.name, baker: r.baker, bot: r.bot }));
    this.comp = new Competition({ header: this.fmt.header, rules: this.fmt.rules, movement: this.movement, players: this.players, name: this.league });
    this.comp.rows.forEach((r, i) => { r.team = keep[i].team; r.name = keep[i].name; r.baker = keep[i].baker; r.bot = keep[i].bot; });
    this.humanIndex = pickHuman(this.comp, humanName);
    const h = this.fmt.header;
    this.os = await loadOnScoring(this.fmt.onScoring, { teams: this.teams, startLane: h.movementstartLane || 1, lanesPerBox: this.fmt.lanePairs === false ? 1 : 2, fhd: true });
    app.loadcom.vbstLayout = (league) => (this.os && league === this.league ? this.os.layout : null);
    app.loadcom.vbstValues = (league) => (this.os && league === this.league ? onScoringIni(this.os, this.comp, this.serie || 0, (r) => this.live(r)) : null);
    for (let s = 0; s < this.comp.numGames && !this.stopped; s++) {
      this.serie = s;
      // a serie that fails stops the competition: the other lanes' pace timer with it
      try { await this.playSerie(s); } catch (e) { this.stop(); throw e; }
      if (this.stopped) return;
      this.comp.endSerie(s);
      // the serie's points are awarded now: push the lane TV again, so its OnScoring
      // panel shows them (it is pushed per ball, and the last ball came before endSerie)
      if (app.tvLanes) app.pushTv(app.tvLanes);
      if (s < this.comp.numGames - 1) await this.showStandings(s, false);
    }
    if (!this.stopped) await this.showStandings(this.comp.numGames - 1, true);
  }

  rowByPlayer(p) { return this.comp.rows.find((r) => r.id === p.playerIdNumber); }

  // Who bowls a lane's player: the competition's row, or - for a bowler added on the lane console
  // (Ändra spelare), who has no row - a machine player of the game's level, kept per playerIdNumber
  // so that it bowls the same way the whole serie. Its games are not the competition's: nothing is
  // recorded for it (recordFrom).
  botRow(p) {
    const r = p && this.rowByPlayer(p);
    if (r) return r;
    if (!p) return null;
    if (!this.addedRows) this.addedRows = new Map();
    let a = this.addedRows.get(p.playerIdNumber);
    if (!a) {
      const name = withoutBumperMark(p.playerName) || '?';
      const skill = SKILLS.find((k) => k.id === this.app.settings.skill) || SKILLS[0];
      a = { name, human: false, added: true, bot: new MachinePlayer({ name, average: skill.avg }) };
      this.addedRows.set(p.playerIdNumber, a);
    }
    return a;
  }

  // A row's game as it stands on its lane: the player's own lanes and the other lanes, which are
  // bowled at the player's pace (PacedLanes) - every row that bowls this serie has a live lane struct
  live(r) {
    if (!r.livePlayer || !this.liveRows || !this.liveRows.has(r)) return null;
    const p = r.livePlayer;
    return { score: p.score, activeSquare: p.activeSquare, finished: p.activeSquare >= 21 || (p.activeSquare >= 20 && p.score[18] + p.score[19] < 10) };
  }

  // The warm-up of a serie: VBS-T starts one before serie 1 only (CShiftSettings::CreateGCI: the
  // first serie, or a restart with "Inspelning"); the format's own setting, or the one chosen
  practiceFor(s) {
    if (s !== 0) return null;
    const v = this.app.settings.warmV;
    return v && v !== 'format' ? warmChoice(v) : vbstPractice(this.fmt.header);
  }

  // The other lanes keep up with the player: a ball of a paced group whenever it is behind the
  // player's own progress by more than a ball or two, a practice ball while it warms up
  startPacing() {
    const app = this.app;
    clearInterval(this.paceTimer);
    this.paceTimer = setInterval(() => {
      if (this.stopped || !this.paced) return;
      const target = Math.min(1, this.progress() + 0.05);
      for (const g of this.paced) {
        if (g.done()) continue;
        if (!g.warm() && g.progress() > target) continue;
        const wasWarm = g.warm();
        const lane = g.step(app.practiceStopMs || 30000);
        if (!lane) continue;
        app.loadcom.changed(lane);
        // the small TV's own little animation for a strike or a spare on that lane
        const ex = wasWarm ? 0 : g.eng.getPlayerInfoStruct(lane).exciter;
        if (app.tvWall && (ex === GCI.EXCITER_STRIKE || ex === GCI.EXCITER_SPARE || ex === GCI.EXCITER_SPMAKE)) app.tvWall.flash(lane, ex === GCI.EXCITER_STRIKE ? 'STRIKE' : 'SPARE');
      }
    }, app.fast ? 350 : 900);
  }
  stopPacing() { clearInterval(this.paceTimer); this.paceTimer = 0; }

  progress() {
    if (!this.humanRows || !this.humanRows.size) return 1;
    let sum = 0, n = 0;
    for (const r of this.humanRows) { if (!r.livePlayer) continue; sum += Math.min(21, r.livePlayer.activeSquare); n++; }
    return n ? sum / (21 * n) : 1;
  }

  async playSerie(s) {
    const app = this.app, comp = this.comp;
    const groups = comp.groupsInSerie(s);
    const human = comp.rows[this.humanIndex];
    const hg = groups.find((g) => g.some((l) => l.rows.includes(human)));
    const theme = app.settings.theme;
    const isCFG = /cfg/i.test(theme);
    const practice = this.practiceFor(s);
    // (the machine players of the other lanes: a bowler added there on the console bowls too)
    const rowOf = (p) => this.botRow(p);
    this.humanRows = new Set();
    this.liveRows = new Set();
    // every other group of lanes: drawn now, bowled on its TVs at the player's pace
    this.paced = [];
    for (const g of groups) {
      if (g === hg) continue;
      const lanes = lanesFor(comp, this.fmt, g, s, { league: this.league, theme });
      for (const pis of lanes) for (let i = 0; i < pis.noPlayers; i++) this.liveRows.add(this.rowByPlayer(pis.player[i]));
      this.paced.push(new PacedLanes(lanes, rowOf, { isCFG, practice }));
    }
    const finishPaced = () => {
      this.stopPacing();
      for (const g of this.paced) {
        g.flush();
        for (const pis of g.lanes) for (let i = 0; i < pis.noPlayers; i++) this.recordFrom(pis.player[i], s, isCFG);
      }
    };
    if (!hg) { finishPaced(); await this.restScreen(s); return; }
    const lanes = lanesFor(comp, this.fmt, hg, s, { league: this.league, theme });
    for (const pis of lanes) for (let i = 0; i < pis.noPlayers; i++) { this.humanRows.add(this.rowByPlayer(pis.player[i])); this.liveRows.add(this.rowByPlayer(pis.player[i])); }
    if (practice && practice.amount > 0) for (const pis of lanes) if (pis.noPlayers) { pis.practiceMethod = practice.method; pis.practiceAmount = practice.amount; }
    const eng = new OpenPlayGame({ lanes, isCFG });
    eng.startGame();
    app.engine = eng;
    const slotLanes = lanes.map((pis, i) => ({ number: pis.laneNumber, laneX: app.slots[i].laneX, physics: app.physics[i], slot: i }));
    app.prepareLanes(slotLanes, eng);
    // the other lanes on the stand-in LoadCom too (their TVs, their consoles), and the TV wall
    for (const g of this.paced) {
      g.lanes.forEach((pis) => {
        const partner = g.lanes.length > 1 ? g.lanes.find((x) => x !== pis) : null;
        app.loadcom.attach(pis.laneNumber, () => pis, () => partner, g.eng);
      });
    }
    const all = groups.flatMap((g) => g.map((l) => l.lane));
    if (app.wallSetup) app.wallSetup(all, slotLanes.map((L) => L.number));
    this.startPacing();
    app.loadcom.settings.alwaysShowLaneSum = this.fmt.header.laneTotalAtBottomFormat ? 'Yes' : 'No';
    app.show('play');
    app.syncHud();
    app.toast(`${this.fmt.title} · ${t('serie')} ${s + 1}/${comp.numGames} · ${t('lane')} ${lanes.map((l) => l.laneNumber).join('-')}`, 3200);
    const who = (lane, index, p) => {
      const r = this.botRow(p);
      return { name: r.name, human: !!r.human, bot: r.bot || new MachinePlayer({ name: r.name, average: 150 }) };
    };
    app.session = new LaneGame(app, { engine: eng, lanes: slotLanes, who });
    const done = await app.session.run();
    if (!done) { this.stopPacing(); this.stopped = true; return; }
    finishPaced();
    for (const g of this.paced) for (const n of g.numbers) app.loadcom.changed(n);
    app.effect(t('seriesResult'), 'white');
    await new Promise((r) => setTimeout(r, 1500));
    for (const pis of lanes) for (let i = 0; i < pis.noPlayers; i++) this.recordFrom(pis.player[i], s, eng.isCFG());
  }

  recordFrom(p, s, cfg) {
    const r = this.rowByPlayer(p);
    if (!r) return;
    this.comp.recordGame(r, s, p.score, { total: gameTotal(p.score, cfg), ...statsOf(p) });
  }

  restScreen(s) {
    return new Promise((resolve) => {
      this.renderStandings(s - 1, false, `${t('resting')} - ${t('serie')} ${s + 1}`);
      const btn = document.querySelector('#standNext');
      btn.textContent = t('simulate');
      btn.onclick = () => { btn.onclick = null; resolve(); };
      this.app.show('standings');
    });
  }

  showStandings(s, final) {
    return new Promise((resolve) => {
      this.renderStandings(s, final, null);
      const btn = document.querySelector('#standNext');
      btn.textContent = final ? t('newGame') : t('nextSerie');
      btn.onclick = () => { btn.onclick = null; if (final) this.app.show('menu'); resolve(); };
      this.app.show('standings');
    });
  }

  renderStandings(s, final, note) {
    const comp = this.comp;
    const st = comp.standings();
    document.querySelector('#standTitle').textContent = (final ? t('summary') : t('standings')) + ' · ' + this.fmt.title +
      (s >= 0 ? ` · ${t('serie')} ${Math.min(s + 1, comp.numGames)}/${comp.numGames}` : '');
    document.querySelector('#standBody').innerHTML = standingsHtml(comp, st, final, note);
  }

  stop() { this.stopped = true; this.stopPacing(); if (this.app.session) this.app.session.stop(); }
}

export function standingsHtml(comp, st, final, note) {
  let html = note ? `<div class="note">${esc(note)}</div>` : '';
  const done = st.seriesDone;
  // on a narrow screen only the last serie's column shows beside the totals (game.css)
  const sec = (k) => (k < done - 1 ? ' class="sec"' : '');
  if (st.teams.length > 1) {
    const lead = st.teams[0];
    html += '<div class="teamBoxes">' + st.teams.map((tm) => `<div class="teamBox${tm === lead && done ? ' lead' : ''}"><b>${esc(tm.name)}</b>` +
      (st.awardsPoints ? `<div class="big">${tm.points} <small style="font-size:16px">${t('points').toLowerCase()}</small></div>` : `<div class="big">${tm.pins}</div>`) +
      `<div class="note">${t('pins')}: ${tm.pins}</div></div>`).join('') + '</div>';
    if (final && done) {
      const a = st.teams[0], b = st.teams[1];
      const tie = st.awardsPoints ? (a.rawPoints === b.rawPoints && a.pins === b.pins) : a.pins === b.pins;
      html += `<div class="note" style="font-size:18px;color:var(--gold)">${tie ? t('draw') : '&#127942; ' + esc(lead.name) + ' ' + t('wins')}</div>`;
    }
    html += `<div class="tableWrap"><table class="res"><tr><th></th><th>${t('team')}</th>` + Array.from({ length: done }, (_, i) => `<th${sec(i)}>${i + 1}</th>`).join('') + `<th>${t('pins')}</th>${st.awardsPoints ? `<th>${t('points')}</th>` : ''}</tr>` +
      st.teams.map((tm, i) => `<tr><td>${i + 1}</td><td>${esc(tm.name)}</td>` + tm.perSerie.map((p, k) => `<td${sec(k)}>${p.pins}${st.awardsPoints ? `<br><small>${p.points}p</small>` : ''}</td>`).join('') + `<td>${tm.pins}</td>${st.awardsPoints ? `<td><b>${tm.points}</b></td>` : ''}</tr>`).join('') + '</table></div>';
  }
  const showBonus = comp.rows.some((r) => r.bonuses.some((b) => b));
  html += `<div class="tableWrap"><table class="res"><tr><th>${t('place')}</th><th>${t('players')}</th>` + Array.from({ length: done }, (_, i) => `<th${sec(i)}>${i + 1}</th>`).join('') +
    `${comp.h.hcpType ? `<th>${t('hcp')}</th>` : ''}${showBonus ? `<th>${t('bonus')}</th>` : ''}<th>${t('total')}</th></tr>` +
    st.players.filter((p) => p.row.played.some(Boolean)).map((p, i) => {
      const r = p.row;
      const cells = Array.from({ length: done }, (_, k) => `<td${sec(k)}>${r.lanes[k] ? r.games[k] : '-'}</td>`).join('');
      const bonus = r.bonuses.reduce((x, y) => x + y, 0);
      return `<tr class="${r.human ? 'me' : ''} ${final && i === 0 ? 'win' : ''}"><td>${i + 1}</td><td>${esc(r.name)}${r.team ? ` <small>(${esc(r.team)})</small>` : ''}</td>${cells}${comp.h.hcpType ? `<td>${comp.hcpOf(r)}</td>` : ''}${showBonus ? `<td>${bonus}</td>` : ''}<td><b>${p.total}</b></td></tr>`;
    }).join('') + '</table></div>';
  return html;
}

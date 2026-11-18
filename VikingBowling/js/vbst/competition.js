// ---------------------------------------------------------------------------
// competition.js - the VBS-T engine (Reception/PLUGINS/VBSTournament), ported.
//
// One shift of a competition, driven entirely by its header, rules and movement file:
//   deal()                 ChangeMovents / CShiftSettings: lanes, protocol positions and
//                          points markers per player and serie (movement file or rotation)
//   recordGame()           UpdateScoreFile: a finished game into the player file
//   endSerie()             GameProcessor::DoGameCalculations: in a SYNC or no-movement
//                          shift, ProcessSpecialPoints - the stp contests (stp_win /
//                          stp_equal over the stXpK markers), then the .r001 rules by type:
//                          personal extra, team point, team mod4, team special
//   playerTotal(), standings()   SortPlayersByTotalAndMakeEQGame and the info TV's team rows
// Every rule is applied the way gamefinished.cpp applies it, including the combinations
// that award nothing. tests/vbst_formats.mjs plays every format through this file.
// ---------------------------------------------------------------------------
import { TSP } from './format.js';

export const MAX_SERIES = 104;

export class Competition {
  // header, rules (array), movement ({positions, nSer} or null), players: [{name, human, bot, hcp, startPoint}]
  constructor({ header, rules = [], movement = null, players, name = 'VBST' }) {
    this.h = header;
    this.rules = rules;
    this.movement = movement;
    this.name = name;
    this.numGames = Math.max(1, Math.min(MAX_SERIES, header.numGames));
    const n = header.numPlayers;
    this.rows = [];
    for (let i = 0; i < n; i++) {
      const p = players[i] || { name: 'Player' + (i + 1) };
      this.rows.push({
        idx: i, id: 1001 + i, name: p.name, human: !!p.human, bot: p.bot || null,
        hcp: p.hcp || 0, startPoint: p.startPoint || 0, team: p.team || '',
        reserve: i >= n - header.numReservPlayers, baker: false,
        lanes: new Array(this.numGames).fill(0), pp: new Array(this.numGames).fill(0),
        sp: [null, ...Array.from({ length: 8 }, () => new Array(this.numGames).fill(0))],
        games: new Array(this.numGames).fill(0), bonuses: new Array(this.numGames).fill(0),
        teamPoints: new Array(this.numGames).fill(0), spCalc: new Array(this.numGames).fill(0),
        played: new Array(this.numGames).fill(false), scores: new Array(this.numGames).fill(null),
        activeGame: 0, strikes: 0, spares: 0, splits: 0, misses: 0
      });
    }
    this.assignTeams();
    this.deal();
  }

  get american() { return this.h.playStyle !== 0; }
  get sync() { return this.h.moveMethod === 1 || this.h.moveMethod === 2; }
  hcpOf(r) { return this.h.hcpType ? r.hcp : 0; }

  // header.teamNames[k]: the 1-based first row of team k; the reserves go to the teams in blocks
  assignTeams() {
    const firsts = this.h.teamNames.filter((v) => v > 0);
    if (!firsts.length) return;
    const n = this.rows.length - this.h.numReservPlayers;
    const teams = firsts.length;
    this.rows.forEach((r, i) => {
      if (r.team) return;
      if (!r.reserve) {
        let k = 0;
        for (let t = 0; t < teams; t++) if (i + 1 >= firsts[t]) k = t;
        r.teamIndex = k;
      } else {
        const per = Math.max(1, Math.ceil(this.h.numReservPlayers / teams));
        r.teamIndex = Math.min(teams - 1, Math.floor((i - n) / per));
      }
    });
  }

  // CShiftSettings: lanes, protocol positions and markers per row and serie
  deal() {
    const h = this.h, mv = this.movement;
    const nPlayers = this.rows.length;
    this.rows.forEach((r, i) => {
      if (r.reserve) return;                       // a reserve has lane 0 in every serie
      for (let j = 0; j < this.numGames; j++) {
        if (h.extraEqualazitionSerie && j === this.numGames - 1) continue;
        let lane = 0;
        if (h.lastActiveMovementType === 1 || !mv) {
          // rotation
          const L = h.lastLane - h.firstLane + 1;
          let off = h.rotationStartLane - h.firstLane + Math.floor(i / Math.max(1, h.numPlayersPerLane)) +
            (h.whenToMove > 0 ? Math.floor(j / h.whenToMove) * h.lanesToMove : 0);
          while (off + h.firstLane > h.lastLane) off -= L;
          lane = off + h.firstLane;
          r.pp[j] = (i % Math.max(1, h.numPlayersPerLane)) + 1;
        } else {
          const sec = mv.positions[i % mv.positions.length];
          const key = (j % Math.max(1, mv.nSer)) + 1;
          const v = parseInt(sec['s' + key] || '0', 10) || 0;
          lane = v ? Math.abs(h.movementstartLane + v - 1) : 0;
          const pp = sec['pp' + key];
          r.pp[j] = pp !== undefined ? (parseInt(pp, 10) % 255) : ((i + 1) % 255);
          if (j < 52) for (let k = 1; k <= 8; k++) {
            const m = sec['st' + k + 'p' + key];
            if (m !== undefined) r.sp[k][j] = (parseInt(m, 10) || 0) % 255;
          }
          if (j === 0 && sec.lagnamn && i < mv.positions.length) r.movementTeam = sec.lagnamn;
          if (sec.ba === '1' || sec.ba === 1) r.baker = true;
        }
        r.lanes[j] = lane;
      }
    });
    void nPlayers;
  }

  // The lanes of serie s: lane -> rows in protocol order (LanedataUtil sorts by pp, then id)
  lanesInSerie(s) {
    const m = new Map();
    for (const r of this.rows) {
      const l = r.lanes[s];
      if (!l) continue;
      if (!m.has(l)) m.set(l, []);
      m.get(l).push(r);
    }
    for (const list of m.values()) list.sort((a, b) => (a.pp[s] - b.pp[s]) || (a.id - b.id));
    return new Map([...m.entries()].sort((a, b) => a[0] - b[0]));
  }

  // The lane groups bowled together: a lane alone (EUR), or an odd/even pair (AMR) -
  // an empty partner lane is started with no players, as VBS-T does (BC18579)
  groupsInSerie(s) {
    const lanes = this.lanesInSerie(s);
    const groups = [];
    if (!this.american) {
      for (const [l, rows] of lanes) groups.push([{ lane: l, rows }]);
      return groups;
    }
    const done = new Set();
    for (const l of lanes.keys()) {
      const odd = l % 2 ? l : l - 1;
      if (done.has(odd)) continue;
      done.add(odd);
      groups.push([{ lane: odd, rows: lanes.get(odd) || [] }, { lane: odd + 1, rows: lanes.get(odd + 1) || [] }]);
    }
    return groups;
  }

  // UpdateScoreFile: the game of a player on a lane
  recordGame(row, s, scoreArray, stats) {
    row.games[s] = stats.total;
    row.scores[s] = scoreArray.slice();
    row.played[s] = true;
    row.strikes += stats.strikes; row.spares += stats.spares; row.splits += stats.splits; row.misses += stats.opens;
    row.activeGame = s + 1;
  }

  // DoGameCalculations once every row has finished serie s
  endSerie(s) {
    for (const r of this.rows) if (!r.lanes[s]) r.activeGame = Math.max(r.activeGame, s + 1);
    if (this.sync) this.processSpecialPoints(s);
    this.lastSerieDone = s;
  }

  // lanes started in serie s+1 (tryStartingThisLane), the partner lane too in AMR
  lanesStartedNext(s) {
    const set = new Set();
    if (s + 1 >= this.numGames) return set;
    for (const r of this.rows) {
      const l = r.lanes[s + 1];
      if (!l) continue;
      set.add(l);
      if (this.american) set.add(l % 2 ? l + 1 : l - 1);
    }
    return set;
  }

  teamsFound() {
    const out = [];
    for (const r of this.rows) if (r.team && !out.includes(r.team)) out.push(r.team);
    return out;
  }

  value(r, s) { return r.games[s] + this.hcpOf(r) + r.bonuses[s]; }

  // GameProcessor::ProcessSpecialPoints for serie s (0-based)
  processSpecialPoints(s) {
    const h = this.h, rows = this.rows, activeGame = s + 1;
    for (const r of rows) { r.bonuses[s] = 0; r.teamPoints[s] = 0; }

    // 1. stp contests
    if (h.use_stp_points) {
      for (let pp = 0; pp < 8; pp++) {
        if (!h.stp_win[pp] && !h.stp_equal[pp]) continue;
        const teams = this.teamsFound();
        if (!teams.length) continue;
        const marker = (r, ag) => r.sp[pp + 1][ag];
        for (let sp = 1; sp < 256; sp++) {
          let later = false, now = false;
          const sums = teams.map(() => 0), counts = teams.map(() => 0);
          for (const r of rows) for (let ag = 0; ag < this.numGames; ag++) {
            if (marker(r, ag) !== sp) continue;
            if (ag > s) later = true;
            if (ag === s) now = true;
            const t = teams.indexOf(r.team);
            if (t >= 0) { sums[t] += this.value(r, ag); counts[t]++; }
          }
          if (later || !now) continue;
          const winners = topTeams(sums);
          if (winners.length === 1) {
            const w = winners[0];
            if (counts[w] <= 0) continue;
            const pts = h.stp_win[pp] / counts[w];
            let ledger = h.stp_win[pp];
            for (let ag = 0; ag < this.numGames; ag++) for (const r of rows) {
              if (marker(r, ag) === sp && r.team === teams[w]) {
                r.teamPoints[ag] += pts;
                if (ledger && r.lanes[s] > 0) { r.spCalc[s] += ledger; ledger = 0; }
              }
            }
          } else {
            for (const w of winners) {
              if (counts[w] <= 0) continue;
              const pts = h.stp_equal[pp] / counts[w];
              let ledger = h.stp_equal[pp];
              for (let ag = 0; ag < this.numGames; ag++) for (const r of rows) {
                if (marker(r, ag) === sp && r.team === teams[w]) {
                  r.teamPoints[ag] += pts;
                  if (ledger && r.lanes[s] > 0) { r.spCalc[s] += ledger; ledger = 0; }
                }
              }
            }
          }
        }
      }
    }

    if (activeGame < 1 || !this.rules.length) return;
    const applies = (rule) => rule.inWhatSerie === 0 || rule.inWhatSerie === activeGame;
    const started = this.lanesStartedNext(s);
    const lastSerie = activeGame >= this.numGames;
    const groupsFor = (mode, skipNotStarted) => {
      const groups = [];
      if (mode === TSP.EACH_LANE) {
        for (let l = 1; l < 128; l++) {
          if (skipNotStarted && !lastSerie && !started.has(l)) continue;
          const g = rows.filter((r) => r.lanes[s] === l);
          if (g.length) groups.push(g);
        }
      } else if (mode === TSP.LANE_PAIR) {
        for (let l = 1; l < 128; l += 2) {
          if (skipNotStarted && !lastSerie && !started.has(l)) continue;
          const g = rows.filter((r) => r.lanes[s] === l || r.lanes[s] === l + 1);
          if (g.length) groups.push(g);
        }
      } else if (mode === TSP.ALL_LANES) {
        const g = rows.filter((r) => r.lanes[s] > 0);
        if (g.length) groups.push(g);
      }
      return groups;
    };

    // 2a. personal extra points -> bonuses (before the team rules, which then count them)
    for (const rule of this.rules) {
      if (!applies(rule) || rule.pointType !== TSP.PERSONAL_EXTRA) continue;
      for (const g of groupsFor(rule.calculatedFromWhatLanes, rule.calculatedFromWhatLanes !== TSP.ALL_LANES)) {
        let max = -1000, best = [];
        for (const r of g) {
          const v = this.value(r, s);
          if (v > max) { max = v; best = [r]; } else if (v === max) best.push(r);
        }
        if (best.length === 1) best[0].bonuses[s] += rule.numPoints;
        else for (const r of best) r.bonuses[s] += rule.numPointsIfEqual;
      }
    }

    // 2b. team points per lane, lane pair or all lanes
    for (const rule of this.rules) {
      if (!applies(rule) || rule.pointType !== TSP.TEAM_POINT) continue;
      const teams = this.teamsFound();
      for (const g of groupsFor(rule.calculatedFromWhatLanes, false)) {
        const sums = teams.map(() => 0), counts = teams.map(() => 0);
        for (const r of g) { const t = teams.indexOf(r.team); if (t >= 0) { sums[t] += this.value(r, s); counts[t]++; } }
        const winners = topTeams(sums);
        if (!winners.length) continue;
        const award = (w, points) => {
          if (counts[w] <= 0) return;
          for (const r of g) if (r.team === teams[w]) r.teamPoints[s] += points / counts[w];
        };
        if (winners.length === 1) award(winners[0], rule.numPoints);
        else for (const w of winners) award(w, rule.numPointsIfEqual);
      }
    }

    // 2c. team points over series s, s-4, s-8 ... (all lanes, only in the serie it names)
    for (const rule of this.rules) {
      if (rule.inWhatSerie !== activeGame || rule.pointType !== TSP.TEAM_MOD4_POINT || rule.calculatedFromWhatLanes !== TSP.ALL_LANES) continue;
      const teams = this.teamsFound();
      const sums = teams.map(() => 0), counts = teams.map(() => 0);
      for (let t = 0; t < teams.length; t++) for (const r of rows) {
        for (let ag = s; ag >= 0; ag -= 4) {
          if (r.lanes[ag] > 0 && r.team === teams[t]) { sums[t] += this.value(r, ag); if (ag === s) counts[t]++; }
        }
      }
      const winners = topTeams(sums);
      const award = (w, points) => {
        if (counts[w] <= 0) return;      // gamefinished.cpp divides without a guard here; a team bowling nobody gets nothing
        for (const r of rows) if (r.lanes[s] > 0 && r.team === teams[w]) r.teamPoints[s] += points / counts[w];
      };
      if (winners.length === 1) award(winners[0], rule.numPoints);
      else for (const w of winners) award(w, rule.numPointsIfEqual);
    }

    // 2d. team special: contests over the st1/st2 markers, decided at their last serie
    for (const rule of this.rules) {
      if (!applies(rule) || rule.pointType !== TSP.TEAM_SPECIAL || rule.calculatedFromWhatLanes !== TSP.ALL_LANES) continue;
      const teams = this.teamsFound();
      if (!teams.length) continue;
      const hit = (r, ag, sp) => r.sp[1][ag] === sp || r.sp[2][ag] === sp;
      for (let first = 0; first < 2; first++) for (let sp = 1; sp < 256; sp++) {
        let later = false, now = false;
        const sums = teams.map(() => 0), counts = teams.map(() => 0);
        for (const r of rows) for (let ag = 0; ag < this.numGames; ag++) {
          const own = first === 0 ? r.sp[1][ag] : r.sp[2][ag];
          if (own === sp && ag > s) later = true;
          if (own === sp && ag === s) now = true;
          if (hit(r, ag, sp)) { const t = teams.indexOf(r.team); if (t >= 0) { sums[t] += this.value(r, ag); counts[t]++; } }
        }
        if (later || !now) continue;
        const winners = topTeams(sums);
        const award = (w, points) => {
          if (counts[w] <= 0) return;
          let ledger = points;
          for (let ag = 0; ag < this.numGames; ag++) for (const r of rows) {
            if (hit(r, ag, sp) && r.team === teams[w]) {
              r.teamPoints[ag] += points / counts[w];
              if (ledger && r.lanes[s] > 0) { r.spCalc[s] += ledger; ledger = 0; }
            }
          }
        };
        if (winners.length === 1) award(winners[0], rule.numPoints);
        else for (const w of winners) award(w, rule.numPointsIfEqual);
      }
    }
  }

  // The player total the info TV and the end result sort by
  playerTotal(r) {
    let t = r.startPoint;
    for (let g = 0; g < Math.min(r.activeGame, this.numGames); g++) t += this.hcpOf(r) + r.games[g] + r.bonuses[g];
    return t;
  }

  // Players: total descending, the lower handicap first on a tie, then the row order.
  // Teams: points (when the format awards any), then pins - the web view's order - with
  // pins and points per serie as the info TV's team rows count them.
  standings() {
    const players = this.rows.filter((r) => !r.baker || r.played.some(Boolean)).map((r) => ({ row: r, total: this.playerTotal(r) }));
    players.sort((a, b) => (b.total - a.total) || (this.hcpOf(a.row) - this.hcpOf(b.row)) || (a.row.idx - b.row.idx));
    const upto = Math.min(this.numGames, this.lastSerieDone === undefined ? 0 : this.lastSerieDone + 1);
    const teams = this.teamsFound().map((name) => {
      const perSerie = [];
      let pins = 0, points = 0;
      for (let s = 0; s < upto; s++) {
        let sp = 0, spts = 0;
        for (const r of this.rows) {
          if (r.team !== name) continue;
          spts += r.teamPoints[s];
          if (r.lanes[s] > 0) sp += this.hcpOf(r) + r.games[s] + (this.h.useSpecialPoints ? r.bonuses[s] : 0);
        }
        if (s === 0 && this.h.useStart) for (const r of this.rows) if (r.team === name && r.lanes[0] > 0) sp += r.startPoint;
        perSerie.push({ pins: sp, points: Math.trunc(spts + 1e-9) });
        pins += sp; points += spts;
      }
      return { name, pins, points: Math.round(points + 1e-9), rawPoints: points, perSerie };
    });
    const awardsPoints = this.h.use_stp_points || this.rules.some((r) => r.pointType !== TSP.PERSONAL_EXTRA);
    teams.sort((a, b) => (awardsPoints ? b.rawPoints - a.rawPoints : 0) || (b.pins - a.pins));
    return { players, teams, awardsPoints, seriesDone: upto };
  }
}

function topTeams(sums) {
  let max = -1000, best = [];
  sums.forEach((v, t) => { if (v > max) { max = v; best = [t]; } else if (v === max) best.push(t); });
  return best;
}

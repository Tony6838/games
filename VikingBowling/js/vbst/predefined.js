// ---------------------------------------------------------------------------
// predefined.js - the VBS-T formats that have their own dialog in the reception, with
// the header, rules and movement file each dialog writes (CShiftSettings::SetBanpSettings,
// SetPetersenSettings, SetKorpSettings, SetTeamPlaySettings, the Ind and Skåne dialogs).
// The Auto formats come from their own .h001/.r001 files instead (session.js).
// ---------------------------------------------------------------------------
import { makeHeader, TSP } from './format.js';

const rule = (numPoints, pointType, lanes, numPointsIfEqual = 0, inWhatSerie = 0) =>
  ({ numPoints, pointType, calculatedFromWhatLanes: lanes, numPointsIfEqual, inWhatSerie });

const tr = (sv, en, da, no, fi) => (l) => ({ sv, en, da, no, fi }[l] || en);

// Each entry: build(american) -> { header, rules, movement (file name or null), teams: [names], avgHint }
export const PREDEFINED = [
  {
    id: 'banp44', variant: 'BANP',
    title: tr('Banpoängsmatch 4+4, 4 banor', 'Lane points match 4+4, 4 lanes', 'Banepointkamp 4+4, 4 baner', 'Banepoengkamp 4+4, 4 baner', 'Ratapisteottelu 4+4, 4 rataa'),
    sub: tr('2 lag · 4 serier · banpoäng + seriepoäng', '2 teams · 4 games · lane + game points', '2 hold · 4 serier', '2 lag · 4 serier', '2 joukkuetta · 4 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'BANP 4+4', numGames: 4, numPlayers: 10, numReservPlayers: 2, moveMethod: 1, hcpType: 0, useStart: 0,
        movementFileName: 'Banpoäng4Man4Banor.ini', movementstartLane: 1, firstLane: 1, lastLane: 4, playStyle: am ? 1 : 0,
        teamNames: [1, 5, 0, 0, 0, 0, 0, 0], pari: 19, VBSTvariant: 1, onScoringFile: 'banpoäng4man4banor', showNextLane: 1 }),
      rules: [rule(1, TSP.TEAM_POINT, TSP.EACH_LANE), rule(1, TSP.TEAM_POINT, TSP.ALL_LANES)],
      onScoring: 'banpoäng4man4banor', lanePairs: false
    })
  },
  {
    id: 'banp88x8', variant: 'BANP',
    title: tr('Banpoängsmatch 8+8, 8 banor', 'Lane points match 8+8, 8 lanes', 'Banepointkamp 8+8, 8 baner', 'Banepoengkamp 8+8, 8 baner', 'Ratapisteottelu 8+8, 8 rataa'),
    sub: tr('2 lag · 4 serier · banparspoäng + seriepoäng', '2 teams · 4 games · lane pair + game points', '2 hold · 4 serier', '2 lag · 4 serier', '2 joukkuetta · 4 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'BANP 8+8 8b', numGames: 4, numPlayers: 18, numReservPlayers: 2, moveMethod: 1, hcpType: 0, useStart: 0,
        movementFileName: am ? 'Banpoäng8Man8BanorAm.ini' : 'Banpoäng8Man8BanorEu.ini', movementstartLane: 1, firstLane: 1, lastLane: 8, playStyle: am ? 1 : 0,
        teamNames: [1, 9, 0, 0, 0, 0, 0, 0], pari: 19, VBSTvariant: 1, onScoringFile: 'banpoäng8man8banor', showNextLane: 1 }),
      rules: [rule(1, TSP.TEAM_POINT, TSP.LANE_PAIR), rule(1, TSP.TEAM_POINT, TSP.ALL_LANES)],
      onScoring: 'banpoäng8man8banor', lanePairs: true
    })
  },
  {
    id: 'banp88x4', variant: 'BANP',
    title: tr('Banpoängsmatch 8+8, 4 banor', 'Lane points match 8+8, 4 lanes', 'Banepointkamp 8+8, 4 baner', 'Banepoengkamp 8+8, 4 baner', 'Ratapisteottelu 8+8, 4 rataa'),
    sub: tr('2 lag · 8 delserier · helserie-poäng från serie 5', '2 teams · 8 half games · full-game points from game 5', '2 hold · 8 serier', '2 lag · 8 serier', '2 joukkuetta · 8 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'BANP 8+8 4b', numGames: 8, numPlayers: 18, numReservPlayers: 2, moveMethod: 1, hcpType: 0, useStart: 0,
        movementFileName: am ? 'Banpoäng8Man4BanorAm.ini' : 'Banpoäng8Man4BanorEu.ini', movementstartLane: 1, firstLane: 1, lastLane: 4, playStyle: am ? 1 : 0,
        teamNames: [1, 9, 0, 0, 0, 0, 0, 0], pari: 19, VBSTvariant: 1, onScoringFile: 'banpoäng8man4banor', showNextLane: 1 }),
      rules: [rule(1, TSP.TEAM_POINT, TSP.LANE_PAIR), rule(1, TSP.TEAM_MOD4_POINT, TSP.ALL_LANES, 0, 5), rule(1, TSP.TEAM_MOD4_POINT, TSP.ALL_LANES, 0, 6),
        rule(1, TSP.TEAM_MOD4_POINT, TSP.ALL_LANES, 0, 7), rule(1, TSP.TEAM_MOD4_POINT, TSP.ALL_LANES, 0, 8)],
      onScoring: 'banpoäng8man4banor', lanePairs: true
    })
  },
  {
    id: 'banp88x6', variant: 'BANP',
    title: tr('Banpoängsmatch 8+8, 6 banor', 'Lane points match 8+8, 6 lanes', 'Banepointkamp 8+8, 6 baner', 'Banepoengkamp 8+8, 6 baner', 'Ratapisteottelu 8+8, 6 rataa'),
    sub: tr('2 lag · 6 serier · specialpoäng (st1/st2)', '2 teams · 6 games · special points (st1/st2)', '2 hold · 6 serier', '2 lag · 6 serier', '2 joukkuetta · 6 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'BANP 8+8 6b', numGames: 6, numPlayers: 18, numReservPlayers: 2, moveMethod: 1, hcpType: 0, useStart: 0,
        movementFileName: 'Banpoäng8Man6Banor.ini', movementstartLane: 1, firstLane: 1, lastLane: 6, playStyle: am ? 1 : 0,
        teamNames: [1, 9, 0, 0, 0, 0, 0, 0], pari: 19, VBSTvariant: 1, onScoringFile: 'banpoäng8man6banor', showNextLane: 1 }),
      rules: [rule(1, TSP.TEAM_SPECIAL, TSP.ALL_LANES)],
      onScoring: 'banpoäng8man6banor', lanePairs: true
    })
  },
  {
    id: 'ind', variant: 'IND',
    title: tr('Individuell tävling', 'Individual competition', 'Individuel turnering', 'Individuell turnering', 'Henkilökohtainen kilpailu'),
    sub: tr('8 spelare · 4 banor · 4 serier · flytt 1 bana per serie', '8 players · 4 lanes · 4 games · move 1 lane per game', '8 spillere · 4 baner · 4 serier', '8 spillere · 4 baner · 4 serier', '8 pelaajaa · 4 rataa · 4 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'IND', numGames: 4, numPlayers: 8, lastActiveMovementType: 1, rotationStartLane: 1, firstLane: 1, lastLane: 4,
        numPlayersPerLane: 2, lanesToMove: 1, whenToMove: 1, moveMethod: 0, hcpType: 1, useStart: 1, playStyle: am ? 1 : 0, VBSTvariant: 2, showNextLane: 1 }),
      rules: [], individual: true
    })
  },
  {
    id: 'rr', variant: 'RR',
    title: tr('Petersen / Round Robin', 'Petersen / Round Robin', 'Petersen / Round Robin', 'Petersen / Round Robin', 'Petersen / Round Robin'),
    sub: tr('6 spelare · alla mot alla · 5 serier · 30 bonus per vunnen serie', '6 players · everyone meets everyone · 5 games · 30 bonus per game won', '6 spillere · 5 serier · 30 bonus', '6 spillere · 5 serier · 30 bonus', '6 pelaajaa · 5 sarjaa · 30 bonusta'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'RR', numGames: 5, numPlayers: 6, moveMethod: 1, hcpType: 1, useStart: 1, useExtraPoints: 1,
        movementFileName: am ? 'Petersen6AM.ini' : 'Petersen6EU.ini', movementstartLane: 1, firstLane: 1, lastLane: am ? 6 : 3,
        playStyle: am ? 1 : 0, VBSTvariant: 4, bonus: 30, showNextLane: 1 }),
      rules: [rule(30, TSP.PERSONAL_EXTRA, am ? TSP.LANE_PAIR : TSP.EACH_LANE, 15)], individual: true
    })
  },
  {
    id: 'skane', variant: 'SKANE',
    title: tr('Skånemästerskap', 'Skåne Master', 'Skåne Master', 'Skåne Master', 'Skåne Master'),
    sub: tr('8 spelare · 4 banor · 6 serier · HCP av snitt', '8 players · 4 lanes · 6 games · handicap from average', '8 spillere · 6 serier', '8 spillere · 6 serier', '8 pelaajaa · 6 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'SK', numGames: 6, numPlayers: 8, lastActiveMovementType: 1, rotationStartLane: 1, firstLane: 1, lastLane: 4,
        numPlayersPerLane: 2, lanesToMove: 1, whenToMove: 1, moveMethod: 0, hcpType: 1, useStart: 1, playStyle: am ? 1 : 0, VBSTvariant: 5 }),
      rules: [], individual: true, skaneHcp: true
    })
  },
  {
    id: 'lagspel', variant: 'LAGSPEL',
    title: tr('Lagspel', 'Team play', 'Holdspil', 'Lagspill', 'Joukkuepeli'),
    sub: tr('4 lag à 3 · 4 banor · 4 serier · lagsumma', '4 teams of 3 · 4 lanes · 4 games · team total', '4 hold à 3 · 4 serier', '4 lag à 3 · 4 serier', '4 joukkuetta · 4 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'TEAM', numGames: 4, numPlayers: 12, lastActiveMovementType: 1, rotationStartLane: 1, firstLane: 1, lastLane: 4,
        numPlayersPerLane: 3, lanesToMove: 1, whenToMove: 1, moveMethod: 0, hcpType: 1, useStart: 1, laneTotalAtBottomFormat: 1,
        teamNames: [1, 4, 7, 10, 0, 0, 0, 0], playStyle: am ? 1 : 0, VBSTvariant: 3 }),
      rules: []
    })
  },
  {
    id: 'korp18', variant: 'KORP',
    title: tr('Korp - 18 banpoäng', 'Company league - 18 lane points', 'Firmaliga - 18 banepoint', 'Bedrift - 18 banepoeng', 'Yrityssarja - 18 ratapistettä'),
    sub: tr('2 lag à 3 · 3 banor · 3 serier · 2 poäng per bana', '2 teams of 3 · 3 lanes · 3 games · 2 points per lane', '2 hold à 3 · 3 serier', '2 lag à 3 · 3 serier', '2 joukkuetta · 3 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'KORP 18', numGames: 3, numPlayers: 8, numReservPlayers: 2, moveMethod: 1, hcpType: 1, useStart: 1,
        movementFileName: 'VBSKorp3Man3Banor18p.ini', movementstartLane: 1, firstLane: 1, lastLane: 3, playStyle: am ? 1 : 0,
        teamNames: [1, 4, 0, 0, 0, 0, 0, 0], pari: 19, VBSTvariant: 6 }),
      rules: [rule(2, TSP.TEAM_POINT, TSP.EACH_LANE, 1)]
    })
  },
  {
    id: 'korp12', variant: 'KORP',
    title: tr('Korp - Hudiksvall 12 poäng', 'Company league - Hudiksvall 12 points', 'Firmaliga - Hudiksvall 12', 'Bedrift - Hudiksvall 12', 'Yrityssarja - Hudiksvall 12'),
    sub: tr('2 lag à 3 · 3 serier · 1 per bana + 1 per serie', '2 teams of 3 · 3 games · 1 per lane + 1 per game', '2 hold à 3 · 3 serier', '2 lag à 3 · 3 serier', '2 joukkuetta · 3 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'KORP 12', numGames: 3, numPlayers: 8, numReservPlayers: 2, moveMethod: 1, hcpType: 1, useStart: 1,
        movementFileName: 'VBSKorp3Man3Banor12p.ini', movementstartLane: 1, firstLane: 1, lastLane: 3, playStyle: am ? 1 : 0,
        teamNames: [1, 4, 0, 0, 0, 0, 0, 0], pari: 19, VBSTvariant: 6 }),
      rules: [rule(1, TSP.TEAM_POINT, TSP.EACH_LANE, 0), rule(1, TSP.TEAM_POINT, TSP.ALL_LANES, 0)]
    })
  },
  {
    id: 'korpBaker', variant: 'KORP',
    title: tr('Korp - 2 man + baker', 'Company league - 2 players + baker', 'Firmaliga - 2 + baker', 'Bedrift - 2 + baker', 'Yrityssarja - 2 + baker'),
    sub: tr('2 lag à 2 · 4 serier · serie 3-4 baker', '2 teams of 2 · 4 games · games 3-4 baker', '2 hold à 2 · 4 serier', '2 lag à 2 · 4 serier', '2 joukkuetta · 4 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'KORP BAKER', numGames: 4, numPlayers: 8, numReservPlayers: 2, moveMethod: 1, hcpType: 1, useStart: 1,
        movementFileName: 'VBSKorp2Man4SerBaker.ini', movementstartLane: 1, firstLane: 1, lastLane: 2, playStyle: am ? 2 : 0,
        teamNames: [1, 4, 0, 0, 0, 0, 0, 0], pari: 19, VBSTvariant: 6 }),
      rules: [rule(2, TSP.TEAM_POINT, TSP.ALL_LANES, 1)], bakerRows: [2, 5]
    })
  },
  {
    id: 'korpVg', variant: 'KORP',
    title: tr('Korp - Västergötland', 'Company league - Västergötland', 'Firmaliga - Västergötland', 'Bedrift - Västergötland', 'Yrityssarja - Västergötland'),
    sub: tr('2 lag à 4 · 4 serier', '2 teams of 4 · 4 games', '2 hold à 4 · 4 serier', '2 lag à 4 · 4 serier', '2 joukkuetta · 4 sarjaa'),
    build: (am) => ({
      header: makeHeader({ shiftName: 'KORP VG', numGames: 4, numPlayers: 10, numReservPlayers: 2, moveMethod: 1, hcpType: 1, useStart: 0,
        movementFileName: 'Västergötland.ini', movementstartLane: 1, firstLane: 1, lastLane: 4, playStyle: am ? 1 : 0,
        teamNames: [1, 5, 0, 0, 0, 0, 0, 0], pari: 19, VBSTvariant: 6 }),
      rules: [rule(1, TSP.TEAM_POINT, TSP.ALL_LANES, 0), rule(1, TSP.TEAM_POINT, TSP.LANE_PAIR, 0)]
    })
  }
];

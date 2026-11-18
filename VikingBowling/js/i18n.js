// ---------------------------------------------------------------------------
// i18n.js - the five languages of the Viking reception: Swedish (default), English,
// Danish, Norwegian and Finnish. The lane console's own texts (web/screen/console/lang/
// *.json, game types and buttons) are loaded and used where they fit; the rest are the
// game's own.
// ---------------------------------------------------------------------------
export const LANGS = [
  { id: 'sv', name: 'Svenska', lang: 'Svenska' },
  { id: 'en', name: 'English', lang: 'English' },
  { id: 'da', name: 'Dansk', lang: 'Dansk' },
  { id: 'no', name: 'Norsk', lang: 'Norsk' },
  { id: 'fi', name: 'Suomi', lang: 'Suomeksi' }
];

// The flags as the lane console draws them (web/screen/console/js/touchconsoleLane.js)
export const FLAGS = {
  sv: '<svg viewBox="0 0 16 10" aria-hidden="true"><rect width="16" height="10" fill="#006AA7"></rect><rect x="5" width="2" height="10" fill="#FECC00"></rect><rect y="4" width="16" height="2" fill="#FECC00"></rect></svg>',
  en: '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="60" height="30" fill="#012169"></rect><path d="M0 0L60 30M60 0L0 30" stroke="#FFFFFF" stroke-width="6"></path><path d="M0 0L60 30M60 0L0 30" stroke="#C8102E" stroke-width="2"></path><path d="M30 0v30M0 15h60" stroke="#FFFFFF" stroke-width="10"></path><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"></path></svg>',
  fi: '<svg viewBox="0 0 18 11" aria-hidden="true"><rect width="18" height="11" fill="#FFFFFF"></rect><rect x="5" width="3" height="11" fill="#002F6C"></rect><rect y="4" width="18" height="3" fill="#002F6C"></rect></svg>',
  da: '<svg viewBox="0 0 32 20" aria-hidden="true"><rect width="32" height="20" fill="#C8102E"></rect><rect x="10" width="4" height="20" fill="#FFFFFF"></rect><rect y="8" width="32" height="4" fill="#FFFFFF"></rect></svg>',
  no: '<svg viewBox="0 0 24 15" aria-hidden="true"><rect width="24" height="15" fill="#BA0C2F"></rect><rect x="6" width="4" height="15" fill="#FFFFFF"></rect><rect y="5.5" width="24" height="4" fill="#FFFFFF"></rect><rect x="7" width="2" height="15" fill="#00205B"></rect><rect y="6.5" width="24" height="2" fill="#00205B"></rect></svg>'
};

const T = {
  sv: {
    chooseLang: 'Välj språk', ok: 'OK, jag förstår', back: 'Tillbaka', start: 'Starta', next: 'Fortsätt', menu: 'Meny',
    infoTitle: 'Välkommen till Viking Bowling',
    infoText: 'Viking Bowling är till för träning, utbildning och underhållning. Spelet bygger på VBS Bowling AB:s Viking Scoring System 4.4 - samma poängräkning, spelformer, banTV och konsol som i bowlinghallarna.',
    howTo: 'Så kastar du: tryck på banan, dra i sidled för att välja var du släpper klotet och svep sedan uppåt mot käglorna. Svepets fart blir klotets fart, riktningen blir linjen och en böj i slutet ger skruv. Klotet kan hamna i rännan.',
    copyright: '© 1995-2026 VBS Bowling AB. Alla rättigheter förbehållna.',
    fullscreen: 'Helskärm', exitFullscreen: 'Lämna helskärm', sound: 'Ljud',
    openPlay: 'Öppet spel', vbst: 'VBS-T tävling', playStyle: 'Spelstil', eur: 'EUR - europeiskt', amr: 'AMR - amerikanskt',
    eurHint: 'Hela serien på samma bana', amrHint: 'Banparet växlas varje ruta',
    cfg: 'Classic Frame Game', noTapN: 'No Tap {n}', shortN: 'Short Game {n}',
    options: 'Inställningar', redPin: 'RedPin', theme: 'Protokolltema', robots: 'Maskinspelare', skill: 'Nivå',
    aimLine: 'Siktlinje', showSpeed: 'Visa klotfart',
    skills: { beginner: 'Nybörjare', casual: 'Motionär', league: 'Seriespelare', good: 'Duktig', expert: 'Expert', pro: 'Proffs' },
    yourName: 'Ditt namn', namePh: 'Skriv ditt namn', opponents: 'Motspelare', reroll: 'Nya namn', teammates: 'Lagkamrater',
    yourTurn: 'Din tur - svep för att kasta', rolling: 'Klotet rullar …', throwing: '{name} kastar', resting: 'Du vilar denna serie',
    strike: 'STRIKE!', spare: 'SPARE!', split: 'SPLIT', gutter: 'RÄNNA', miss: 'MISS', double: 'DUBBEL!', turkey: 'KALKON!',
    fourBagger: 'FYRA I RAD!', foul: 'FOUL', redPinStrike: 'REDPIN-STRIKE!', redPinChance: 'RedPin-chans!', noTapStrike: 'NO TAP-STRIKE!',
    weak: 'För svagt - svep längre och snabbare', gameOver: 'Spelet är slut',
    summary: 'Resultat', score: 'Poäng', strikes: 'Strikes', spares: 'Spares', opens: 'Öppna', splits: 'Splits', winner: 'Vinnare',
    place: 'Plats', playAgain: 'Spela igen', newGame: 'Nytt spel', lane: 'Bana', serie: 'Serie', team: 'Lag', total: 'Totalt',
    points: 'Poäng', lanePoints: 'Banpoäng', teamPoints: 'Lagpoäng', standings: 'Ställning', nextSerie: 'Nästa serie',
    home: 'Hemmalag', away: 'Bortalag', formats: 'Tävlingsformer', autoFormats: 'Auto-format', search: 'Sök',
    predefined: 'Fördefinierade', players: 'Spelare', series: 'Serier', lanes: 'Banor', you: 'du', bonus: 'Bonus',
    hcp: 'HCP', pins: 'Kägelpoäng', match: 'Match', draw: 'Oavgjort', wins: 'vinner', sitOut: 'vilar',
    tv: 'BanTV', bigTv: 'Stor TV', skip: 'Hoppa över', fast: 'Snabbt', simulate: 'Spela ut serien', seriesResult: 'Serieresultat',
    unavailable: 'Rörelsefilen saknas - formatet kan inte bokas, inte heller i Viking.', ball: 'Klot', speed: 'Fart'
  },
  en: {
    chooseLang: 'Choose language', ok: 'OK, I understand', back: 'Back', start: 'Start', next: 'Continue', menu: 'Menu',
    infoTitle: 'Welcome to Viking Bowling',
    infoText: 'Viking Bowling is for training, education and entertainment. It is built on VBS Bowling AB\'s Viking Scoring System 4.4 - the same scoring, game formats, lane TV and console as in the bowling centres.',
    howTo: 'How to bowl: press on the lane, slide sideways to choose where you release the ball, then swipe up towards the pins. The speed of the swipe is the speed of the ball, its direction is the line, and a curve at the end gives hook. The ball can end up in the gutter.',
    copyright: '© 1995-2026 VBS Bowling AB. All rights reserved.',
    fullscreen: 'Full screen', exitFullscreen: 'Leave full screen', sound: 'Sound',
    openPlay: 'Open play', vbst: 'VBS-T competition', playStyle: 'Play style', eur: 'EUR - European', amr: 'AMR - American',
    eurHint: 'The whole game on one lane', amrHint: 'The lane pair alternates every frame',
    cfg: 'Classic Frame Game', noTapN: 'No Tap {n}', shortN: 'Short Game {n}',
    options: 'Settings', redPin: 'RedPin', theme: 'Score sheet theme', robots: 'Machine players', skill: 'Level',
    aimLine: 'Aim line', showSpeed: 'Show ball speed',
    skills: { beginner: 'Beginner', casual: 'Casual', league: 'League bowler', good: 'Good', expert: 'Expert', pro: 'Professional' },
    yourName: 'Your name', namePh: 'Type your name', opponents: 'Opponents', reroll: 'New names', teammates: 'Teammates',
    yourTurn: 'Your turn - swipe to bowl', rolling: 'The ball is rolling …', throwing: '{name} is bowling', resting: 'You sit out this game',
    strike: 'STRIKE!', spare: 'SPARE!', split: 'SPLIT', gutter: 'GUTTER', miss: 'MISS', double: 'DOUBLE!', turkey: 'TURKEY!',
    fourBagger: 'FOUR IN A ROW!', foul: 'FOUL', redPinStrike: 'REDPIN STRIKE!', redPinChance: 'RedPin chance!', noTapStrike: 'NO TAP STRIKE!',
    weak: 'Too weak - swipe longer and faster', gameOver: 'Game over',
    summary: 'Result', score: 'Score', strikes: 'Strikes', spares: 'Spares', opens: 'Open', splits: 'Splits', winner: 'Winner',
    place: 'Place', playAgain: 'Play again', newGame: 'New game', lane: 'Lane', serie: 'Game', team: 'Team', total: 'Total',
    points: 'Points', lanePoints: 'Lane points', teamPoints: 'Team points', standings: 'Standings', nextSerie: 'Next game',
    home: 'Home team', away: 'Away team', formats: 'Competition formats', autoFormats: 'Auto formats', search: 'Search',
    predefined: 'Predefined', players: 'Players', series: 'Games', lanes: 'Lanes', you: 'you', bonus: 'Bonus',
    hcp: 'HCP', pins: 'Pinfall', match: 'Match', draw: 'Draw', wins: 'wins', sitOut: 'sits out',
    tv: 'Lane TV', bigTv: 'Big TV', skip: 'Skip', fast: 'Fast', simulate: 'Play out the game', seriesResult: 'Game result',
    unavailable: 'The movement file is missing - this format cannot be booked, not in Viking either.', ball: 'Ball', speed: 'Speed'
  },
  da: {
    chooseLang: 'Vælg sprog', ok: 'OK, jeg forstår', back: 'Tilbage', start: 'Start', next: 'Fortsæt', menu: 'Menu',
    infoTitle: 'Velkommen til Viking Bowling',
    infoText: 'Viking Bowling er til træning, uddannelse og underholdning. Spillet bygger på VBS Bowling AB\'s Viking Scoring System 4.4 - samme pointberegning, spilformer, bane-TV og konsol som i bowlingcentrene.',
    howTo: 'Sådan kaster du: tryk på banen, træk til siden for at vælge hvor du slipper kuglen, og stryg så opad mod keglerne. Strygets fart bliver kuglens fart, retningen bliver linjen, og et sving til sidst giver skru. Kuglen kan havne i renden.',
    copyright: '© 1995-2026 VBS Bowling AB. Alle rettigheder forbeholdes.',
    fullscreen: 'Fuld skærm', exitFullscreen: 'Forlad fuld skærm', sound: 'Lyd',
    openPlay: 'Åbent spil', vbst: 'VBS-T turnering', playStyle: 'Spillestil', eur: 'EUR - europæisk', amr: 'AMR - amerikansk',
    eurHint: 'Hele serien på samme bane', amrHint: 'Baneparret skifter hver rude',
    cfg: 'Classic Frame Game', noTapN: 'No Tap {n}', shortN: 'Short Game {n}',
    options: 'Indstillinger', redPin: 'RedPin', theme: 'Protokoltema', robots: 'Computerspillere', skill: 'Niveau',
    aimLine: 'Sigtelinje', showSpeed: 'Vis kuglefart',
    skills: { beginner: 'Nybegynder', casual: 'Motionist', league: 'Ligaspiller', good: 'Dygtig', expert: 'Ekspert', pro: 'Professionel' },
    yourName: 'Dit navn', namePh: 'Skriv dit navn', opponents: 'Modspillere', reroll: 'Nye navne', teammates: 'Holdkammerater',
    yourTurn: 'Din tur - stryg for at kaste', rolling: 'Kuglen ruller …', throwing: '{name} kaster', resting: 'Du holder pause denne serie',
    strike: 'STRIKE!', spare: 'SPARE!', split: 'SPLIT', gutter: 'RENDE', miss: 'MISS', double: 'DOBBELT!', turkey: 'KALKUN!',
    fourBagger: 'FIRE I TRÆK!', foul: 'FOUL', redPinStrike: 'REDPIN-STRIKE!', redPinChance: 'RedPin-chance!', noTapStrike: 'NO TAP-STRIKE!',
    weak: 'For svagt - stryg længere og hurtigere', gameOver: 'Spillet er slut',
    summary: 'Resultat', score: 'Point', strikes: 'Strikes', spares: 'Spares', opens: 'Åbne', splits: 'Splits', winner: 'Vinder',
    place: 'Plads', playAgain: 'Spil igen', newGame: 'Nyt spil', lane: 'Bane', serie: 'Serie', team: 'Hold', total: 'Total',
    points: 'Point', lanePoints: 'Banepoint', teamPoints: 'Holdpoint', standings: 'Stilling', nextSerie: 'Næste serie',
    home: 'Hjemmehold', away: 'Udehold', formats: 'Turneringsformer', autoFormats: 'Auto-formater', search: 'Søg',
    predefined: 'Foruddefinerede', players: 'Spillere', series: 'Serier', lanes: 'Baner', you: 'dig', bonus: 'Bonus',
    hcp: 'HCP', pins: 'Keglepoint', match: 'Kamp', draw: 'Uafgjort', wins: 'vinder', sitOut: 'holder pause',
    tv: 'Bane-TV', bigTv: 'Stor TV', skip: 'Spring over', fast: 'Hurtigt', simulate: 'Spil serien færdig', seriesResult: 'Serieresultat',
    unavailable: 'Bevægelsesfilen mangler - formatet kan ikke bookes, heller ikke i Viking.', ball: 'Kugle', speed: 'Fart'
  },
  no: {
    chooseLang: 'Velg språk', ok: 'OK, jeg forstår', back: 'Tilbake', start: 'Start', next: 'Fortsett', menu: 'Meny',
    infoTitle: 'Velkommen til Viking Bowling',
    infoText: 'Viking Bowling er for trening, opplæring og underholdning. Spillet bygger på VBS Bowling AB sitt Viking Scoring System 4.4 - samme poengberegning, spillformer, bane-TV og konsoll som i bowlinghallene.',
    howTo: 'Slik kaster du: trykk på banen, dra sidelengs for å velge hvor du slipper kula, og sveip så oppover mot keglene. Farten i sveipet blir kulas fart, retningen blir linjen, og en bue til slutt gir skru. Kula kan havne i renna.',
    copyright: '© 1995-2026 VBS Bowling AB. Alle rettigheter forbeholdt.',
    fullscreen: 'Fullskjerm', exitFullscreen: 'Avslutt fullskjerm', sound: 'Lyd',
    openPlay: 'Åpent spill', vbst: 'VBS-T turnering', playStyle: 'Spillestil', eur: 'EUR - europeisk', amr: 'AMR - amerikansk',
    eurHint: 'Hele serien på samme bane', amrHint: 'Baneparet veksler hver rute',
    cfg: 'Classic Frame Game', noTapN: 'No Tap {n}', shortN: 'Short Game {n}',
    options: 'Innstillinger', redPin: 'RedPin', theme: 'Protokolltema', robots: 'Datamaskinspillere', skill: 'Nivå',
    aimLine: 'Siktelinje', showSpeed: 'Vis kulefart',
    skills: { beginner: 'Nybegynner', casual: 'Mosjonist', league: 'Seriespiller', good: 'Flink', expert: 'Ekspert', pro: 'Proff' },
    yourName: 'Ditt navn', namePh: 'Skriv navnet ditt', opponents: 'Motspillere', reroll: 'Nye navn', teammates: 'Lagkamerater',
    yourTurn: 'Din tur - sveip for å kaste', rolling: 'Kula ruller …', throwing: '{name} kaster', resting: 'Du står over denne serien',
    strike: 'STRIKE!', spare: 'SPARE!', split: 'SPLIT', gutter: 'RENNE', miss: 'BOM', double: 'DOBBEL!', turkey: 'KALKUN!',
    fourBagger: 'FIRE PÅ RAD!', foul: 'FOUL', redPinStrike: 'REDPIN-STRIKE!', redPinChance: 'RedPin-sjanse!', noTapStrike: 'NO TAP-STRIKE!',
    weak: 'For svakt - sveip lenger og raskere', gameOver: 'Spillet er over',
    summary: 'Resultat', score: 'Poeng', strikes: 'Strikes', spares: 'Spares', opens: 'Åpne', splits: 'Splitter', winner: 'Vinner',
    place: 'Plass', playAgain: 'Spill igjen', newGame: 'Nytt spill', lane: 'Bane', serie: 'Serie', team: 'Lag', total: 'Totalt',
    points: 'Poeng', lanePoints: 'Banepoeng', teamPoints: 'Lagpoeng', standings: 'Stilling', nextSerie: 'Neste serie',
    home: 'Hjemmelag', away: 'Bortelag', formats: 'Turneringsformer', autoFormats: 'Auto-formater', search: 'Søk',
    predefined: 'Forhåndsdefinerte', players: 'Spillere', series: 'Serier', lanes: 'Baner', you: 'deg', bonus: 'Bonus',
    hcp: 'HCP', pins: 'Keglepoeng', match: 'Kamp', draw: 'Uavgjort', wins: 'vinner', sitOut: 'står over',
    tv: 'Bane-TV', bigTv: 'Stor TV', skip: 'Hopp over', fast: 'Raskt', simulate: 'Spill ut serien', seriesResult: 'Serieresultat',
    unavailable: 'Bevegelsesfilen mangler - formatet kan ikke bookes, heller ikke i Viking.', ball: 'Kule', speed: 'Fart'
  },
  fi: {
    chooseLang: 'Valitse kieli', ok: 'OK, ymmärrän', back: 'Takaisin', start: 'Käynnistä', next: 'Jatka', menu: 'Valikko',
    infoTitle: 'Tervetuloa Viking Bowlingiin',
    infoText: 'Viking Bowling on tarkoitettu harjoitteluun, opetukseen ja viihteeksi. Peli perustuu VBS Bowling AB:n Viking Scoring System 4.4:ään - sama pistelasku, pelimuodot, rata-TV ja konsoli kuin keilahalleissa.',
    howTo: 'Näin heität: paina rataa, liu\'uta sivulle valitaksesi pallon irrotuskohdan ja pyyhkäise sitten ylös kohti keiloja. Pyyhkäisyn nopeus on pallon nopeus, suunta on linja ja kaarre lopussa antaa koukun. Pallo voi päätyä kouruun.',
    copyright: '© 1995-2026 VBS Bowling AB. Kaikki oikeudet pidätetään.',
    fullscreen: 'Koko näyttö', exitFullscreen: 'Poistu koko näytöstä', sound: 'Ääni',
    openPlay: 'Vapaa peli', vbst: 'VBS-T kilpailu', playStyle: 'Pelityyli', eur: 'EUR - eurooppalainen', amr: 'AMR - amerikkalainen',
    eurHint: 'Koko sarja samalla radalla', amrHint: 'Ratapari vaihtuu joka ruudussa',
    cfg: 'Classic Frame Game', noTapN: 'No Tap {n}', shortN: 'Short Game {n}',
    options: 'Asetukset', redPin: 'RedPin', theme: 'Pöytäkirjan teema', robots: 'Konepelaajat', skill: 'Taso',
    aimLine: 'Tähtäysviiva', showSpeed: 'Näytä pallon nopeus',
    skills: { beginner: 'Aloittelija', casual: 'Kuntokeilaaja', league: 'Sarjakeilaaja', good: 'Taitava', expert: 'Asiantuntija', pro: 'Ammattilainen' },
    yourName: 'Nimesi', namePh: 'Kirjoita nimesi', opponents: 'Vastustajat', reroll: 'Uudet nimet', teammates: 'Joukkuetoverit',
    yourTurn: 'Sinun vuorosi - pyyhkäise heittääksesi', rolling: 'Pallo vierii …', throwing: '{name} heittää', resting: 'Olet tauolla tämän sarjan',
    strike: 'KAATO!', spare: 'PAIKKO!', split: 'HAJARI', gutter: 'KOURU', miss: 'OHI', double: 'TUPLA!', turkey: 'KALKKUNA!',
    fourBagger: 'NELJÄ PERÄKKÄIN!', foul: 'YLIASTUNTA', redPinStrike: 'REDPIN-KAATO!', redPinChance: 'RedPin-mahdollisuus!', noTapStrike: 'NO TAP -KAATO!',
    weak: 'Liian heikko - pyyhkäise pidemmälle ja nopeammin', gameOver: 'Peli päättyi',
    summary: 'Tulos', score: 'Pisteet', strikes: 'Kaadot', spares: 'Paikot', opens: 'Avoimet', splits: 'Hajarit', winner: 'Voittaja',
    place: 'Sija', playAgain: 'Pelaa uudelleen', newGame: 'Uusi peli', lane: 'Rata', serie: 'Sarja', team: 'Joukkue', total: 'Yhteensä',
    points: 'Pisteet', lanePoints: 'Ratapisteet', teamPoints: 'Joukkuepisteet', standings: 'Tilanne', nextSerie: 'Seuraava sarja',
    home: 'Kotijoukkue', away: 'Vierasjoukkue', formats: 'Kilpailumuodot', autoFormats: 'Auto-muodot', search: 'Hae',
    predefined: 'Valmiit', players: 'Pelaajat', series: 'Sarjat', lanes: 'Radat', you: 'sinä', bonus: 'Bonus',
    hcp: 'HCP', pins: 'Kaatopisteet', match: 'Ottelu', draw: 'Tasapeli', wins: 'voittaa', sitOut: 'tauolla',
    tv: 'Rata-TV', bigTv: 'Iso TV', skip: 'Ohita', fast: 'Nopeasti', simulate: 'Pelaa sarja loppuun', seriesResult: 'Sarjan tulos',
    unavailable: 'Liikkumatiedosto puuttuu - muotoa ei voi varata, ei Vikingissäkään.', ball: 'Pallo', speed: 'Nopeus'
  }
};

let current = 'sv';
let consoleTexts = {};

export function setLang(id) { current = T[id] ? id : 'sv'; document.documentElement.lang = current === 'no' ? 'nb' : current; }
export function lang() { return current; }
export function langInfo() { return LANGS.find((l) => l.id === current); }

// t('key') or t('skills.pro'), with {name} style placeholders
export function t(key, vars) {
  let v = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), T[current]);
  if (v === undefined) v = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), T.en);
  if (v === undefined) v = key;
  if (vars) for (const [k, val] of Object.entries(vars)) v = String(v).split('{' + k + '}').join(val);
  return v;
}

// The lane console's texts for this language (game.normal, game.369, ...)
export async function loadConsoleTexts() {
  try {
    const r = await fetch('web/screen/console/lang/' + current + '.json');
    consoleTexts = r.ok ? await r.json() : {};
  } catch (e) { consoleTexts = {}; }
}
export function ct(key, fallback) { return consoleTexts[key] || fallback || key; }

// ---------------------------------------------------------------------------
// loadcom.js - the game's stand-in for LoadCom's HTML service (port 24324 on a lane PC).
//
// On a lane PC the lane TV page is served by LoadCom and pushed one payload per change
// on /html/events?lane=<n>: BuildLaneStatusJson + BuildHtmlPayload in
// Slave/LOADCOM/LoadComWebInterface.cpp - the lane status ("Playing" during a game), the
// settings a browser cannot read from the slave's registry, a one-shot "animation" when
// OpenPlay sent LC_PLAY_ANIMATION, and the lane file itself under "lane". This object
// builds the same payload from the game's lane structs and pushes it to the TakTV pages
// in the game's iframes (see tv-standin.js, which answers their EventSource and fetch).
// ---------------------------------------------------------------------------
import { laneFileJson } from '../engine/lanefile.js';
import { GCI } from '../engine/openplay.js';
import { playersJson, playerScoreJson, changeScore, changePlayersInfo } from '../engine/correction.js';
import { makePlayer } from '../engine/openplay.js';

// The hall's web console settings (Terminalinställningar), as LoadCom sends them in every console
// payload: WebGameControl bits 0 Avsluta spel, 1 Service, 2 Ändra spelare, 3 Korrigera, 4 Flytta
// spel, 5 Kundens meny, 6 Avsluta inspelning. The game's hall offers what makes sense without a
// real hall: correcting, changing the players (names, order, bumpers) and ending the practice.
// Ending the game is the game's own menu; Service, moving a game, the customer's menu and Beställ
// need staff, another lane or the hall's own pages.
export const GAME_WEB_GAME_CONTROL = (1 << 2) | (1 << 3) | (1 << 6);

export class StandInLoadCom {
  constructor() {
    this.lanes = new Map();          // lane number -> { get: () => lane struct, partner: () => struct|null }
    this.subscribers = new Map();    // lane number -> [fn(text)]
    this.animation = new Map();      // lane number -> queued one-shot media (WebPara.animationHtml)
    this.lastAnim = new Map();
    this.settings = {
      lang: 'Svenska', banner: '', pinsOnScoring: 'Standard_FHD', showPins: 'Yes',
      hideStrikeSequence: 'Yes', alwaysShowLaneSum: 'No', showBallSpeed: 'No', showMaxGame: 'Yes',
      background: ''
    };
    this.appInstance = 'VikingBowling-' + Date.now().toString(36);
    this.tick = 1000;
    this.vbstValues = null;          // (league) => ini text, set by the VBS-T engine
    this.listeners = [];             // fn(lane) on every change (the TV wall)
    this.masks = new Map();          // lane -> maskPicture (MASKPIC_*), what OpenPlay's LC_MASK_PICTURE leaves in WebPara
    this.consoleSubs = new Map();    // lane -> [{ fn, closed }] (/console/events)
    this.vtv = new Map();            // lane -> { url, stamp } the lane TV's own picture of the sheet (/html/vtvimage)
    this.imgSeq = new Map();
    this.onConsoleChange = null;     // (lane, kind, detail) after a console command changed a lane
    this.consoleHall = null;         // (lane, path, query) => answer | null: the game's pinsetter commands
    this.compactImage = null;        // (lane) => data URL of the game's compact view of the lane
    window.VikingLoadCom = this;     // what tv-standin.js and console-standin.js in the iframes talk to
  }

  // lane: number; get: () => GCI_PLAYERINFORMATIONSTRUCT-like object; partner: () => other lane or null;
  // engine: the OpenPlay game that scores the lane (what a console command acts on)
  attach(lane, get, partner = () => null, engine = null) {
    this.lanes.set(lane, { get, partner, engine });
  }

  clear() {
    this.lanes.clear();
    this.animation.clear();
    this.lastAnim.clear();
    this.masks.clear();
    for (const v of this.vtv.values()) if (v.url) URL.revokeObjectURL(v.url);
    this.vtv.clear();
  }

  // LC_MASK_PICTURE: the message overlay the lane's screen shows (the stop picture of a warm-up)
  setMask(lane, value) {
    if ((this.masks.get(lane) || 0) === value) return;
    this.masks.set(lane, value);
    this.push(lane);
  }

  subscribe(lane, fn) {
    if (!this.subscribers.has(lane)) this.subscribers.set(lane, []);
    this.subscribers.get(lane).push(fn);
    fn(this.payloadText(lane, true));
  }

  unsubscribeAll() { this.subscribers.clear(); }

  // LC_PLAY_ANIMATION: the media file (web/screen/TV/media/<name>) the TV plays once
  // Two in a row (a RedPin strike, then the next frame's RedPin chance) would replace each
  // other in LoadCom's one slot within the same second; here the second waits until the
  // first has had time to play, so both are seen.
  // ms: how long the media plays (the RedPin videos about 7 s, the hall's exciter animations under
  // 3 s). A short one that is still waiting when the next ball's comes is replaced by it, as
  // LoadCom's one slot is written over.
  playAnimation(lane, media, ms = 7000) {
    (this.animLog || (this.animLog = [])).push({ lane, media, t: Date.now() });     // for the automated runs
    let q = this.animation.get(lane) || [];
    if (ms < 7000) q = q.filter((x) => !(x.short && x.at > Date.now()));
    const prev = q.length ? q[q.length - 1] : null;
    const lastAt = prev ? prev.at : (this.lastAnim.get(lane) || 0);
    const lastMs = prev ? prev.ms : (this.lastAnimMs && this.lastAnimMs.get(lane)) || 7000;
    const at = Math.max(Date.now(), lastAt + lastMs);
    q.push({ media, at, ms, short: ms < 7000 });
    this.animation.set(lane, q);
    if (at > Date.now()) setTimeout(() => this.push(lane), at - Date.now() + 20);
  }
  takeAnimation(lane, peek) {
    const q = this.animation.get(lane);
    if (!q || !q.length || q[0].at > Date.now()) return '';
    const media = q[0].media;
    if (!peek) {
      const item = q.shift();
      this.lastAnim.set(lane, Date.now());
      (this.lastAnimMs || (this.lastAnimMs = new Map())).set(lane, item.ms || 7000);
    }
    return media;
  }

  // The lane changed: stamp it (laneDataModifiedTime is what the page compares) and push
  changed(lane) {
    const entry = this.lanes.get(lane);
    if (entry) {
      const pis = entry.get();
      if (pis) pis.laneDataModifiedTime = (this.tick += 17);
    }
    this.push(lane);
    for (const fn of this.listeners) { try { fn(lane); } catch (e) { console.warn('lane listener failed', e); } }
  }

  push(lane) {
    this.pushConsole(lane);
    const subs = this.subscribers.get(lane);
    if (!subs || !subs.length) return;
    const text = this.payloadText(lane);
    for (const fn of subs) { try { fn(text); } catch (e) { console.warn('TV push failed', e); } }
  }

  // ---- the console service (WebSource=console, port 24321) ------------------------------------
  subscribeConsole(lane, fn, closed) {
    if (!this.consoleSubs.has(lane)) this.consoleSubs.set(lane, []);
    this.consoleSubs.get(lane).push({ fn, closed });
    fn(JSON.stringify(this.consolePayload(lane)));
  }
  pushConsole(lane) {
    const subs = this.consoleSubs.get(lane);
    if (!subs || !subs.length) return;
    const live = subs.filter((s) => !s.closed());
    this.consoleSubs.set(lane, live);
    if (!live.length) return;
    const text = JSON.stringify(this.consolePayload(lane));
    for (const s of live) { try { s.fn(text); } catch (e) { console.warn('console push failed', e); } }
  }
  unsubscribeConsoles() { this.consoleSubs.clear(); }

  // BuildLaneStatusJson for WebSource=console
  consolePayload(lane) {
    const s = this.settings;
    const entry = this.lanes.get(lane);
    const pis = entry ? entry.get() : null;
    const playing = !!pis && pis.noPlayers > 0;
    return {
      lanestatus: playing ? 'Playing' : 'NoPlayer',
      useHtmlProtocol: 'Yes',
      appInstance: this.appInstance,
      VBSname: pis ? pis.dllName : '',
      isAMR: pis && (pis.type & GCI.LC_START_AMERICAN) ? '1' : '0',
      waitingSpace: 'No',
      animation: '',
      commercial: 'NoThingToPlay',
      banner: s.banner,
      bannerHeight: '23',
      lang: s.lang,
      laneLang: s.lang,
      practice: pis && pis.practiceMethod ? 'Yes' : 'No',
      // the reserve swap reads the competition's player file on the reception: not offered
      numReservPlayers: '0',
      WebGameType: '127',
      WebGameControl: String(GAME_WEB_GAME_CONTROL),
      WebMaxPlayers: '6',
      WebOrderButton: 'No',
      laneImgIndex: pis ? String(pis.laneDataModifiedTime) + '.' + (this.imgSeq.get(lane) || 0) : '0',
      checkSum: '0',
      laneDataModifiedTime: pis ? String(pis.laneDataModifiedTime) : '0'
    };
  }

  // The lane TV page's picture of the sheet (on a lane PC TakTV posts it to /html/vtvimage as
  // VTVFile<n>.html.jpg; in the game the console asks the page for it, ConsoleHost.picture).
  // stamp: the lane state the picture shows (laneDataModifiedTime when it was drawn)
  storeVtvImage(lane, blob, stamp) {
    const entry = this.lanes.get(lane);
    const pis = entry ? entry.get() : null;
    if (!pis || !blob) return;
    const old = this.vtv.get(lane);
    if (old && old.url) URL.revokeObjectURL(old.url);
    this.vtv.set(lane, { url: URL.createObjectURL(blob), stamp: stamp === undefined ? pis.laneDataModifiedTime : stamp });
    this.imgSeq.set(lane, (this.imgSeq.get(lane) || 0) + 1);
    this.pushConsole(lane);
  }
  // What the console shows as the lane's picture: the TV's own picture of the lane as it is now,
  // else the game's compact view of it
  vtvImageUrl(lane) {
    const entry = this.lanes.get(lane);
    const pis = entry ? entry.get() : null;
    const v = this.vtv.get(lane);
    if (v && pis && v.stamp === pis.laneDataModifiedTime) return v.url;
    return this.compactImage ? this.compactImage(lane) : null;
  }

  // A console command: path and query as the page sent them. Answers { status, body }.
  consoleRequest(url, body) {
    let u;
    try { u = new URL(url, 'http://lane/'); } catch (e) { return { status: 400, body: '' }; }
    const q = {};
    u.searchParams.forEach((v, k) => { q[k] = v; });
    if (typeof body === 'string' && body) new URLSearchParams(body).forEach((v, k) => { q[k] = v; });
    const name = u.pathname.replace(/^\/console\//i, '');
    const lane = parseInt(q.lane, 10) || 0;
    const entry = this.lanes.get(lane);
    const pis = entry ? entry.get() : null;
    const eng = entry ? entry.engine : null;
    const ok = (b) => ({ status: 200, body: b });
    const done = (kind, detail) => { this.changed(lane); if (this.onConsoleChange) this.onConsoleChange(lane, kind, detail); };
    switch (name) {
      case 'lanestatus.json':
        return pis ? ok(this.consolePayload(lane)) : { status: 400, body: 'lanestatus.json: lane ' + lane + ' is not served by this slave' };
      case 'players.json':
        return ok(pis ? playersJson(pis, lane) : { players: [] });
      case 'playerScore.json': {
        const i = parseInt(q.playerIndex, 10) || 0;
        if (!pis || i < 0 || i >= 8) return { status: 404, body: '' };
        return ok(playerScoreJson(pis, i));
      }
      case 'changeScore': {
        if (!eng) return ok({ success: 'false' });
        const r = changeScore(eng, lane, q);
        if (r.applied) done('correction', r.applied);
        return ok(r.response);
      }
      case 'changePlayersInfo': {
        if (!eng) return ok({ success: 'false' });
        const r = changePlayersInfo(eng, lane, q, makePlayer);
        if (r.applied) done('players', r.applied);
        return ok(r.response);
      }
      case 'endPractice': {
        if (eng) {
          const changed = eng.endPracticeFromConsole(lane);
          if (changed.length) { for (const l of changed) if (l !== lane) this.changed(l); done('endPractice', { lanes: changed }); }
        }
        return ok({ success: 'true' });
      }
      default: {
        // the pinsetter (lastPlayedPinPattern, ResetPin, SetPin) is the game's own lane
        const hall = this.consoleHall ? this.consoleHall(lane, name, q) : null;
        if (hall) return ok(hall);
        // what needs a real hall: staff (callPersonal), the reception (reserves, member names,
        // moving a game), starting a lane from the console (the game starts its lanes itself)
        return ok({ success: 'false', reason: 'offline' });
      }
    }
  }

  payloadText(lane, peek = false) {
    return JSON.stringify(this.payload(lane, peek));
  }

  payload(lane, peek = false) {
    const s = this.settings;
    const entry = this.lanes.get(lane);
    const pis = entry ? entry.get() : null;
    const other = entry ? entry.partner() : null;
    const animation = this.takeAnimation(lane, peek);
    const p = {
      lanestatus: pis && pis.noPlayers > 0 ? 'Playing' : 'Commercial',
      useHtmlProtocol: 'Yes',
      appInstance: this.appInstance,
      VBSname: pis ? pis.dllName : '',
      isAMR: pis && (pis.type & 0x4000) ? '1' : '0',
      waitingSpace: 'No',
      animation,
      commercial: 'NoThingToPlay',
      banner: s.banner,
      bannerHeight: '23',
      lang: s.lang,
      laneLang: s.lang,
      practice: pis && pis.practiceMethod ? 'Yes' : 'No',
      numReservPlayers: String(pis ? pis.tournamentGame.numReservPlayers : 0),
      WebGameType: '1',
      WebGameControl: '1',
      WebMaxPlayers: '6'
    };
    if (s.background) p.background = s.background;
    p.showPins = s.showPins;
    p.vtvImageResX = '960';
    p.pinsOnScoring = s.pinsOnScoring;
    p.hideStrikeSequence = s.hideStrikeSequence;
    p.alwaysShowLaneSum = s.alwaysShowLaneSum;
    p.showBallSpeed = s.showBallSpeed;
    p.showMaxGame = s.showMaxGame;
    p.openPlayCommercial1 = '';
    p.openPlayCommercial2 = '';
    p.maskPicture = String(this.masks.get(lane) || 0);
    if (pis) p.lane = laneFileJson(pis, other);
    return p;
  }

  onScoringValues(league) {
    return this.vbstValues ? this.vbstValues(league) : null;
  }

  // The OnScoring layout of a competition (<league>.xml), as a URL under the game folder
  onScoringLayout(league) {
    return this.vbstLayout ? this.vbstLayout(league) : null;
  }
}

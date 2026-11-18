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
    window.VikingLoadCom = this;     // what tv-standin.js in the iframes talks to
  }

  // lane: number; get: () => GCI_PLAYERINFORMATIONSTRUCT-like object; partner: () => other lane or null
  attach(lane, get, partner = () => null) {
    this.lanes.set(lane, { get, partner });
  }

  clear() {
    this.lanes.clear();
    this.animation.clear();
    this.lastAnim.clear();
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
  playAnimation(lane, media) {
    const q = this.animation.get(lane) || [];
    const last = q.length ? q[q.length - 1].at : (this.lastAnim.get(lane) || 0);
    const at = Math.max(Date.now(), last + (q.length || Date.now() - last < 7000 ? 7000 : 0));
    q.push({ media, at });
    this.animation.set(lane, q);
    if (at > Date.now()) setTimeout(() => this.push(lane), at - Date.now() + 20);
  }
  takeAnimation(lane, peek) {
    const q = this.animation.get(lane);
    if (!q || !q.length || q[0].at > Date.now()) return '';
    const media = q[0].media;
    if (!peek) { q.shift(); this.lastAnim.set(lane, Date.now()); }
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
  }

  push(lane) {
    const subs = this.subscribers.get(lane);
    if (!subs || !subs.length) return;
    const text = this.payloadText(lane);
    for (const fn of subs) { try { fn(text); } catch (e) { console.warn('TV push failed', e); } }
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
    p.maskPicture = '0';
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

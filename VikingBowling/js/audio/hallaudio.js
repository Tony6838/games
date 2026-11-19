// ---------------------------------------------------------------------------
// hallaudio.js - the sound of the bowling hall, with Web Audio.
//
//   * the player's ball: its roll, filtered from noise by its real speed, with a beat at its
//     rotation rate, fading with its distance down the lane; the gutter's hollow rattle; the
//     ball landing at the release (a machine player's); the cushion at the back of the pit
//   * the pins: a sound for every impact the physics reports - the ball meeting a pin, a pin
//     against a pin, a pin falling on the deck, against the kickback, into the pit - so the
//     crash grows with the pins that fall (js/sim3d/physics.js is only read, never changed)
//   * the pinsetter's sweep and reset after every ball, and the ball coming back on the return
//   * the hall: a low murmur, and the balls, crashes and pinsetters of the lanes further away,
//     in step with the hall's own far-lane life (js/sim3d/hall.js, read only)
//   * the people: applause, cheers, sighs and groans after a ball (js/audio/reactions.js), from
//     the shared game events (js/game/events.js) and, for what the hall can already see while
//     the pins settle (every pin down, a ball in the gutter), from the physics at once
//   * the bumpers rising and lowering, and the console's chime at the warm-up
//
// Every sound is synthesised (js/audio/synth.js) when the browser is idle; nothing is loaded.
// Nothing makes a sound, and no AudioContext exists, before the player's first tap or key
// (the browsers' autoplay rules). The sound button mutes, the volume setting (both remembered)
// sets the level; the default is moderate, lower on a phone. The hall's reverb is one shared
// convolver; a sound's distance sets its level, pan and how much of it is reverb.
// ---------------------------------------------------------------------------
import { LANE } from '../sim3d/physics.js';
import { GCI, globCheckSplit } from '../engine/openplay.js';
import { gameEvents } from '../game/events.js';
import * as S from './synth.js';
import { classify, earlyClassify, plan, upgrade, flashFor, strikeStreak, countPins } from './reactions.js';
import { LaneFlash } from './moments.js';

const isPhone = () => {
  try { return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600; } catch (e) { return false; }
};
const PHONE = isPhone();
const MAX_VOICES = PHONE ? 28 : 48, MAX_HITS_PER_FRAME = PHONE ? 5 : 8;
const LISTENER_Z = 1.2;              // the bowler, just behind the foul line
const CROWD_GAIN = 1.3, ROLL_GAIN = 0.85, MURMUR_GAIN = 0.55;

// The banks of sounds: how many variants, how each is made, and whether a used variant is made
// anew (with a new seed) so the crowd never repeats itself. In the order they are rendered.
const BANKS = [
  ['clack', 8, (s) => S.renderImpact('clack', s)], ['ballHit', 4, (s) => S.renderImpact('ballHit', s)],
  ['thud', 5, (s) => S.renderImpact('thud', s)], ['kick', 3, (s) => S.renderImpact('kick', s)],
  ['pit', 3, (s) => S.renderImpact('pit', s)], ['cushion', 2, (s) => S.renderImpact('cushion', s)],
  ['drop', 2, (s) => S.renderImpact('drop', s)],
  ['yeah', 3, (s) => S.crowdJob('yeah', s), true], ['clapM', 2, (s) => S.applauseJob('clapM', s), true],
  ['clapS', 2, (s) => S.applauseJob('clapS', s), true], ['oh', 2, (s) => S.crowdJob('oh', s), true],
  ['aww', 2, (s) => S.crowdJob('aww', s), true], ['ooh', 2, (s) => S.crowdJob('ooh', s), true],
  ['sigh', 2, (s) => S.crowdJob('sigh', s), true], ['cheer', 2, (s) => S.crowdJob('cheer', s), true],
  ['whistle', 2, (s) => S.crowdJob('whistle', s), true], ['whoa', 2, (s) => S.crowdJob('whoa', s), true],
  ['clapL', 2, (s) => S.applauseJob('clapL', s), true],
  ['newRack', 2, (s) => S.renderPinsetter('newRack', s)], ['respot', 2, (s) => S.renderPinsetter('respot', s)],
  ['ballReturn', 2, (s) => S.renderBallReturn(s)],
  ['farRoll', 2, (s) => S.renderFarRoll(s)], ['farCrashBig', 2, (s) => S.renderFarCrash(10, s)],
  ['farCrashMid', 2, (s) => S.renderFarCrash(6, s)], ['farCrashSmall', 2, (s) => S.renderFarCrash(2, s)],
  ['roar', 1, (s) => S.crowdJob('roar', s), true], ['clapXL', 1, (s) => S.applauseJob('clapXL', s), true],
  ['bumperUp', 1, (s) => S.renderBumper(true, s)], ['bumperDown', 1, (s) => S.renderBumper(false, s)],
  ['chimeUp', 1, () => S.renderChime(true)], ['chimeDown', 1, () => S.renderChime(false)]
];
const IMPACT_GAIN = { ballHit: 2.2, clack: 1.4, thud: 1.1, kick: 1.2, pit: 0.9, cushion: 1.6, drop: 1.0 };
// hall.js's far-lane life: the rake starts SWEEP_AT seconds after the hit (ROLL_TIME 2.5, SWEEP_AT 2.0)
const FAR_ROLL_TIME = 2.5, FAR_SWEEP_AT = 2.0;

export class HallAudio {
  constructor({ store = null, app = null } = {}) {
    this.store = store;
    this.app = app;
    this.ctx = null;
    this._on = store ? store.get('sound', true) !== false : true;
    const v = store ? store.get('volume', null) : null;
    this._volume = typeof v === 'number' && v >= 0 && v <= 1 ? v : (PHONE ? 0.45 : 0.6);
    this.banks = new Map();
    this.lastPick = new Map();
    this.jobs = [];
    this.jobT = 0;
    this.voices = 0;
    this.log = [];
    this.debug = typeof location !== 'undefined' && /[?&]audiolog=1/.test(location.search);
    this.ball = null;
    this.pinPrev = [];
    this.pending = new Map();
    this.practice = new Set();
    this.farSeen = new WeakSet();
    this.flash = null;
    this.seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    this.listenGestures();
    this.listenGame();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.applyRunState());
      this.bindVolume();
    }
  }

  // ---- on / off, volume -------------------------------------------------------------------
  get on() { return this._on; }
  set on(v) {
    v = !!v;
    if (v === this._on) return;
    this._on = v;
    if (this.store) this.store.set('sound', v);
    if (v) this.unlock();               // the button press is a user gesture
    this.applyRunState();
    this.logEvent('sound', { on: v });
  }
  get volume() { return this._volume; }
  set volume(v) {
    this._volume = Math.max(0, Math.min(1, +v || 0));
    if (this.store) this.store.set('volume', this._volume);
    this.applyRunState();
  }
  masterGain() { return this._volume * this._volume * 1.2; }     // a slider that sounds even
  running() { return !!this.ctx && this.ctx.state === 'running' && this._on; }

  applyRunState() {
    const c = this.ctx;
    if (!c) return;
    const want = this._on && !document.hidden;
    try {
      const now = c.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(want ? this.masterGain() : 0, now, 0.04);
      clearTimeout(this.suspendT);
      if (want) { if (c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {}); }
      else this.suspendT = setTimeout(() => { if (!(this._on && !document.hidden) && c.state === 'running') c.suspend().catch(() => {}); }, 300);
    } catch (e) { this.fail(e); }
  }

  // The volume sliders ([data-volume], in both option rows): 0-100, remembered
  bindVolume() {
    const inputs = [...document.querySelectorAll('[data-volume]')];
    for (const inp of inputs) {
      inp.value = String(Math.round(this._volume * 100));
      inp.addEventListener('input', () => {
        this.volume = (+inp.value || 0) / 100;
        for (const o of inputs) if (o !== inp) o.value = inp.value;
      });
      inp.addEventListener('change', () => this.preview());
    }
  }
  // a pin's clack at the new level
  preview() {
    if (!this.running()) return;
    this.play(this.pick('clack'), { gain: 0.8, wet: 0.2 });
  }

  // ---- the first gesture ------------------------------------------------------------------
  listenGestures() {
    if (typeof window === 'undefined') return;
    this.gesture = () => this.unlock();
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'])
      window.addEventListener(ev, this.gesture, { capture: true, passive: true });
  }
  stopListening() {
    if (!this.gesture) return;
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'])
      window.removeEventListener(ev, this.gesture, { capture: true });
    this.gesture = null;
  }

  // Called from a user gesture (also by main.js on OK, Start and the throw)
  unlock() {
    if (!this._on || document.hidden) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.stopListening(); return; }
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.unlockedAt = performance.now();
        this.build();
        this.logEvent('unlock', { state: this.ctx.state, sampleRate: this.ctx.sampleRate });
      }
      const c = this.ctx;
      if (c.state === 'running') { this.stopListening(); return; }
      const p = c.resume();
      if (p && p.then) p.then(() => { if (c.state === 'running') this.stopListening(); this.applyRunState(); }, () => {});
    } catch (e) { this.fail(e); }
  }

  fail(e) {
    if (this.failed) return;
    this.failed = true;
    console.warn('Viking Bowling: no sound (' + (e && e.message ? e.message : e) + ')');
  }

  // ---- the graph ------------------------------------------------------------------------------
  build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 6; lim.attack.value = 0.003; lim.release.value = 0.25;
    this.master.connect(lim);
    lim.connect(c.destination);
    this.sfx = c.createGain(); this.crowd = c.createGain(); this.amb = c.createGain();
    for (const b of [this.sfx, this.crowd, this.amb]) b.connect(this.master);
    // the hall's reverb
    this.verb = c.createConvolver();
    this.verb.buffer = this.toBuffer(S.renderImpulse(c.sampleRate, PHONE ? 1.1 : 1.6, 1.4, this.seed));
    const verbOut = c.createGain();
    verbOut.gain.value = 0.8;
    this.verb.connect(verbOut);
    verbOut.connect(this.master);
    // the pin deck, 18 m away: its impacts share one dulling filter and one reverb send, so an
    // impact costs two audio nodes, however many pins fly
    this.deck = c.createBiquadFilter();
    this.deck.type = 'lowpass'; this.deck.frequency.value = 5000;
    this.deck.connect(this.sfx);
    const deckWet = c.createGain();
    deckWet.gain.value = 0.42;
    this.deck.connect(deckWet);
    deckWet.connect(this.verb);
    this.buildRoll();
    // iOS: a silent sound inside the gesture unlocks the output
    try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(); } catch (e) { /* not needed */ }
    // everything else is rendered when the browser is idle, the sounds needed first first
    let k = 1;
    for (const [name, n, make, fresh] of BANKS) {
      this.banks.set(name, { slots: new Array(n).fill(null), pending: new Array(n).fill(false), make, fresh: !!fresh });
      for (let i = 0; i < n; i++) { const seed = this.seed + k++ * 7919; this.queue(() => this.fill(name, i, seed)); }
      if (name === 'clapL') this.queue(() => this.murmurStep());          // the hall's murmur, talker by talker
    }
    this.applyRunState();
  }

  // An AudioBuffer from synth.js's arrays (at their own rate; an older Safari wants 22.05 kHz or more)
  toBuffer(s) {
    const c = this.ctx;
    let ab;
    try { ab = c.createBuffer(s.ch.length, s.ch[0].length, s.sr); } catch (e) {
      const k = 22050 / s.sr;
      s = { sr: 22050, ch: s.ch.map((d) => { const o = new Float32Array(Math.floor(d.length * k)); for (let i = 0; i < o.length; i++) { const x = i / k, j = Math.floor(x), f = x - j; o[i] = (d[j] || 0) * (1 - f) + (d[j + 1] || 0) * f; } return o; }) };
      ab = c.createBuffer(s.ch.length, s.ch[0].length, s.sr);
    }
    s.ch.forEach((d, i) => { if (ab.copyToChannel) ab.copyToChannel(d, i); else ab.getChannelData(i).set(d); });
    return ab;
  }

  // ---- rendering when idle ------------------------------------------------------------------------
  // Jobs run in the browser's idle time, a small step at a time (a voice, a few clappers, a
  // talker). A refill (a crowd variant made anew after use) waits while a ball is out and just
  // after a reaction, so it never competes with the frames that matter.
  queue(fn, refill = false) { this.jobs.push({ fn, it: null, refill }); this.kick(); }
  busy() {
    const app = this.app, L = app && app.rendering && app.activeLane, st = L && L.physics && L.physics.state;   // a ball moves only while the 3D view is drawn
    return st === 'approach' || st === 'rolling' || st === 'deck' || performance.now() - (this.lastReaction || -1e9) < 2500;
  }
  kick() {
    if (this.jobT || !this.jobs.length) return;
    const head = this.jobs[0];
    if (head.refill && this.busy()) { this.jobT = setTimeout(() => { this.jobT = 0; this.kick(); }, 500); return; }
    const run = (deadline) => {
      this.jobT = 0;
      const t0 = performance.now();
      const more = () => (deadline && typeof deadline.timeRemaining === 'function' && !deadline.didTimeout
        ? deadline.timeRemaining() > 2 : performance.now() - t0 < 6);
      do {
        const j = this.jobs[0];
        if (j.refill && this.busy()) break;
        try {
          if (!j.it) { const r = j.fn(); if (r && typeof r.next === 'function') j.it = r; else { this.jobs.shift(); continue; } }
          if (j.it.next().done) this.jobs.shift();
        } catch (e) { this.jobs.shift(); this.fail(e); }
      } while (this.jobs.length && more());
      if (this.jobs.length) this.kick();
      else if (!this.ready) { this.ready = true; this.logEvent('ready', { ms: Math.round(performance.now() - (this.unlockedAt || 0)) }); }
    };
    this.jobT = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, head.refill ? undefined : { timeout: 1000 }) : setTimeout(run, 30);
  }
  *fill(name, slot, seed) {
    const b = this.banks.get(name);
    if (!b) return;
    let r = b.make(seed);
    if (r && typeof r.next === 'function') r = yield* r;
    if (this.ctx) b.slots[slot] = this.toBuffer(r);
  }
  *murmurStep() {
    const out = {};
    yield* S.murmurJob(this.seed ^ 0x5eed, out, { talkers: PHONE ? 7 : 9 });
    if (out.buf && this.ctx) this.startMurmur(this.toBuffer(out.buf));
  }
  startMurmur(buf) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(MURMUR_GAIN, c.currentTime, 1.2);
    src.connect(g); g.connect(this.amb);
    const w = c.createGain(); w.gain.value = 0.3; g.connect(w); w.connect(this.verb);
    src.start();
    this.murmur = { src, g };
    this.logEvent('murmur', { seconds: buf.duration });
  }

  // A ready variant of a bank, not the one played last; a crowd variant is made anew after use
  pick(name) {
    const b = this.banks.get(name);
    if (!b) return null;
    const ready = [];
    b.slots.forEach((s, i) => { if (s) ready.push(i); });
    if (!ready.length) return null;
    let i = ready[Math.floor(Math.random() * ready.length)];
    if (ready.length > 1 && i === this.lastPick.get(name)) i = ready[(ready.indexOf(i) + 1) % ready.length];
    this.lastPick.set(name, i);
    const buf = b.slots[i];
    if (b.fresh && !b.pending[i]) {
      // a new variant replaces this one when it is ready; until then this one stays playable,
      // so a bank is never empty however quickly the reactions come
      b.pending[i] = true;
      const seed = (Math.random() * 4294967296) >>> 0;
      this.queue(() => this.refill(name, i, seed), true);
    }
    return buf;
  }
  *refill(name, slot, seed) {
    yield* this.fill(name, slot, seed);
    this.banks.get(name).pending[slot] = false;
  }

  // Play a buffer: { when, gain, pan, rate, bus, wet (reverb send), lp (Hz), force }
  play(buf, o = {}) {
    const c = this.ctx;
    if (!c || !buf || !this.running()) return null;
    if (this.voices >= MAX_VOICES && !o.force) return null;
    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = o.rate || 1;
      const nodes = [src];
      let node = src;
      if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; nodes.push(f); }
      const g = c.createGain();
      g.gain.value = o.gain ?? 1;
      node.connect(g); node = g; nodes.push(g);
      if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(p); node = p; nodes.push(p); }
      node.connect(o.bus || this.sfx);
      if (o.wet) { const w = c.createGain(); w.gain.value = o.wet; node.connect(w); w.connect(this.verb); nodes.push(w); }
      src.start(Math.max(c.currentTime, o.when || 0));
      this.voices++;
      src.onended = () => { this.voices--; for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } };
      return src;
    } catch (e) { this.fail(e); return null; }
  }

  // Level, pan, reverb and dullness of a sound at (x, z) in the hall, heard by the bowler
  spatial(x, z) {
    const L = this.app && this.app.activeLane;
    const dx = x - (L ? L.laneX : 0), dz = z - LISTENER_Z;
    const d = Math.hypot(dx, dz, 0.5);
    const gain = 1 / (1 + Math.max(0, d - 1) / 6);
    return { gain, pan: Math.max(-0.9, Math.min(0.9, dx / Math.max(1.5, d) * 1.2)), wet: 0.12 + 0.4 * (1 - gain), lp: d > 9 ? Math.max(2500, 16000 - d * 600) : 0, d };
  }
  laneX(laneNo) {
    const app = this.app;
    const lanes = (app && app.session && app.session.lanes) || [];
    const L = lanes.find((l) => l.number === laneNo) || (app && app.activeLane);
    return L ? L.laneX : 0;
  }

  // ---- the rolling ball ---------------------------------------------------------------------------
  buildRoll() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.toBuffer(S.renderRollTexture(this.seed & 0xffff));
    src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7; lp.frequency.value = 400;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 85; body.Q.value = 1.2; body.gain.value = 6;
    const am = c.createGain(); am.gain.value = 1;                          // the beat of the turning ball
    const rot = c.createOscillator(); rot.frequency.value = 8;
    const depth = c.createGain(); depth.gain.value = 0.15;
    rot.connect(depth); depth.connect(am.gain);
    const level = c.createGain(); level.gain.value = 0;
    const gbp = c.createBiquadFilter(); gbp.type = 'bandpass'; gbp.frequency.value = 520; gbp.Q.value = 1.8;   // the gutter
    const gut = c.createGain(); gut.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    src.connect(lp); lp.connect(body); body.connect(am); am.connect(level); level.connect(pan);
    src.connect(gbp); gbp.connect(gut); gut.connect(pan);
    pan.connect(this.sfx);
    const w = c.createGain(); w.gain.value = 0.15; pan.connect(w); w.connect(this.verb);
    src.start(); rot.start();
    this.roll = { lp, rot, level, gut, pan };
  }

  // Every frame: the roll follows the ball. Each value is held for 0.3 s only, so a roll can
  // never be left sounding when frames stop (the menu, a hidden tab).
  updateRoll(L) {
    const r = this.roll, ph = L.physics, st = ph.state, b = ph.ball;
    if (!r) return;
    let level = 0, gut = 0, freq = 300, rot = 8, pan = 0;
    if (st === 'approach' || st === 'rolling' || (st === 'deck' && b.position.z > -LANE.pitEdge)) {
      const v = Math.hypot(b.velocity.x, b.velocity.z);
      const sp = this.spatial(b.position.x, b.position.z);
      if (b.position.y < LANE.ballRadius + 0.03) {
        level = Math.pow(Math.min(1, v / 8), 1.1) * sp.gain * (st === 'approach' ? 0.5 : 1);
        if (ph.inGutter) { gut = level * 0.9; level *= 0.25; }
      }
      freq = 140 + 75 * v;
      rot = Math.max(1, v / (2 * Math.PI * LANE.ballRadius));
      pan = sp.pan;
    }
    // the ball landing at the release (a machine player's; the player's is carried up the approach)
    if (st === 'rolling' && (this.rollState === 'idle' || this.rollState === 'done' || this.rollState === undefined) && b.position.z > -1) {
      const sp = this.spatial(b.position.x, b.position.z);
      this.play(this.pick('drop'), { gain: IMPACT_GAIN.drop * sp.gain, pan: sp.pan, wet: sp.wet });
    }
    this.rollState = st;
    const now = this.ctx.currentTime;
    const set = (param, v, k = 0.03) => { param.cancelScheduledValues(now); param.setTargetAtTime(v, now, k); };
    set(r.level.gain, level * ROLL_GAIN); r.level.gain.setTargetAtTime(0, now + 0.3, 0.08);
    set(r.gut.gain, gut * ROLL_GAIN); r.gut.gain.setTargetAtTime(0, now + 0.3, 0.08);
    set(r.lp.frequency, freq, 0.05);
    set(r.rot.frequency, rot, 0.05);
    if (r.pan.pan) set(r.pan.pan, pan, 0.05);
  }

  // From lanegame.js, just before a ball is released: who bowls, the rack before the ball
  startRoll(c = {}) {
    const L = c.lane || (this.app && this.app.activeLane);
    const p = c.player || null;
    this.ball = {
      laneNo: L ? L.number : null, human: !!(c.who && c.who.human), first: c.first !== false,
      before: c.before == null ? 0x3FF : c.before, scoreMode: p ? p.scoreMode | 0 : 0, streak: strikeStreak(p),
      early: null, confirmed: null, hits: 0, impacts: 0, cushion: false, done: false
    };
    this.rollState = 'idle';
    this.pinPrev = [];
    if (L && L.physics) L.physics.pins.forEach((pin) => { const v = pin.body.velocity; this.pinPrev.push({ vx: v.x, vy: v.y, vz: v.z, last: -1, pit: false }); });
  }
  stopRoll() {
    if (!this.roll || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (const g of [this.roll.level.gain, this.roll.gut.gain]) { g.cancelScheduledValues(now); g.setTargetAtTime(0, now, 0.06); }
  }

  // ---- the pins -----------------------------------------------------------------------------------
  // The physics events of the active lane (main.js passes ph.events every frame)
  ballEvents(L, events) {
    if (!events || !events.length) return;
    for (const ev of events) {
      if (ev.type === 'hit') this.onBallHit(L, ev);
      else if (ev.type === 'gutter') this.onGutter(L);
      else if (ev.type === 'done') this.onBallDone(L);
    }
  }
  impact(type, k, x, z, jitter = 0.016) {
    if (!this.running()) return;
    const sp = this.spatial(x, z);
    const g = IMPACT_GAIN[type] * Math.min(1, k) * sp.gain;
    if (g < 0.01) return;
    const when = this.ctx.currentTime + 0.02 + Math.random() * jitter, rate = 0.9 + Math.random() * 0.22;
    const onDeck = sp.d > 14 && Math.abs(sp.pan) < 0.15;
    this.play(this.pick(type), onDeck ? { when, gain: g, rate, bus: this.deck } : { when, gain: g, pan: sp.pan, wet: sp.wet, rate, lp: sp.lp });
    if (this.ball) this.ball.impacts++;
  }
  onBallHit(L, ev) {
    const pin = L.physics.pins[ev.pin - 1];
    if (!pin) return;
    const p = pin.body.position;
    this.impact('ballHit', 0.35 + (ev.speed || 6) / 9, p.x, p.z, 0.005);
    if (this.pinPrev[ev.pin - 1]) this.pinPrev[ev.pin - 1].last = performance.now();
    if (this.ball) this.ball.hits++;
  }
  onGutter(L) {
    const b = L.physics.ball.position;
    this.impact('kick', 0.6, b.x, b.z, 0);                    // the drop into the gutter
    const B = this.ball;
    if (B && !B.early && B.laneNo === L.number && !(B.scoreMode & GCI.SCORING_MINI) && !this.practice.has(L.number) && !this.instant()) {
      B.early = earlyClassify(B, 'gutter');
      setTimeout(() => this.react(B.early, B.human, L.number, 'early'), 250);
    }
  }
  // Every frame while the ball is out: an impact for every sudden change of a pin's velocity
  watchPins(L, dt) {
    const ph = L.physics, st = ph.state;
    if (st !== 'rolling' && st !== 'deck') return;
    const now = performance.now();
    const half = LANE.width / 2;
    const hits = [];
    ph.pins.forEach((pin, i) => {
      if (!pin.active || pin.ghost) return;
      const prev = this.pinPrev[i] || (this.pinPrev[i] = { vx: 0, vy: 0, vz: 0, last: -1, pit: false });
      const v = pin.body.velocity, p = pin.body.position;
      const dv = Math.hypot(v.x - prev.vx, v.y - prev.vy, v.z - prev.vz);
      prev.vx = v.x; prev.vy = v.y; prev.vz = v.z;
      if (dv > 0.55 && now - prev.last > 30 && p.y > -0.3) {
        prev.last = now;
        const k = (dv - 0.4) / 3.5;
        const x = p.x - L.laneX;
        if (Math.abs(x) > half + LANE.gutter - 0.06) hits.push(['kick', k, p.x, p.z]);
        else if (p.y < 0.09) { hits.push(['thud', k, p.x, p.z]); if (k > 0.3) hits.push(['clack', k * 0.4, p.x, p.z]); }
        else hits.push(['clack', k, p.x, p.z]);
      }
      if (!prev.pit && p.z < -LANE.pitEdge && p.y < -0.12) { prev.pit = true; hits.push(['pit', 0.6, p.x, p.z]); }
    });
    // the loudest few of this frame (the rest would be masked by them anyway)
    if (hits.length > MAX_HITS_PER_FRAME) hits.sort((a, b) => b[1] - a[1]).length = MAX_HITS_PER_FRAME;
    for (const [type, k, x, z] of hits) this.impact(type, k, x, z, type === 'pit' ? 0.05 : dt);
    // the ball into the cushion at the back
    const B = this.ball, b = ph.ball.position;
    if (B && !B.cushion && b.z < -LANE.pitEdge - 0.3) {
      B.cushion = true;
      const v = Math.hypot(ph.ball.velocity.x, ph.ball.velocity.z);
      this.impact('cushion', 0.4 + v / 10, b.x, b.z, 0);
    }
  }
  // Every frame: once every pin of the rack is down the hall knows it is a strike (or a spare)
  watchOutcome(L) {
    const B = this.ball, ph = L.physics;
    if (!B || B.early || B.laneNo !== L.number || this.practice.has(L.number) || this.instant()) return;
    if (ph.impactTime == null || (ph.state !== 'deck' && ph.state !== 'done')) return;
    const since = ph.time - ph.impactTime;
    if (since < 0.25 || since > 6 || !B.before) return;
    let live = 0;
    ph.pins.forEach((p, i) => { if (p.active && (p.ghost || ph.isStanding(p))) live |= 1 << i; });
    if ((live & B.before) !== 0) return;
    B.early = earlyClassify(B, 'allDown', B.before !== 0x3FF && globCheckSplit(B.before));
    this.react(B.early, B.human, L.number, 'early');
  }
  // The ball has come to rest: the pinsetter's cycle, and the ball comes back
  onBallDone(L) {
    const B = this.ball, ph = L.physics;
    if (B && B.done) return;
    if (B) B.done = true;
    const standing = ph.standingMask();
    const full = !B || !B.first || (standing & (B ? B.before : 0x3FF)) === 0;
    if (B) this.logEvent('balldone', { lane: L.number, human: B.human, before: B.before, standing, pinsDown: countPins(B.before & ~standing), hits: B.hits, impacts: B.impacts });
    if (!this.running()) return;
    const now = this.ctx.currentTime;
    const deck = this.spatial(L.laneX, -LANE.headPin - 0.6);
    this.play(this.pick(full ? 'newRack' : 'respot'), { when: now + 0.35, gain: 1.4 * deck.gain, pan: deck.pan, wet: deck.wet + 0.1 });
    if (!(this.app && this.app.fast)) {
      const lanes = (this.app && this.app.session && this.app.session.lanes) || [L];
      const xs = lanes.map((l) => l.laneX);
      const ret = this.spatial((Math.min(...xs) + Math.max(...xs)) / 2 + (lanes.length > 1 ? 0 : 0.8), 3.4);
      this.play(this.pick('ballReturn'), { when: now + 2.4, gain: 0.8 * ret.gain, pan: ret.pan, wet: ret.wet });
    }
  }

  instant() { return !!(this.app && this.app.instant); }

  // ---- every frame (main.js, after the scene is drawn) ----------------------------------------
  frame(dt, app) {
    if (app) this.app = app;
    if (!this.flash && this.app && this.app.scene) this.flash = new LaneFlash(this.app.scene);
    if (this.flash) this.flash.update(dt);
    const L = this.app && this.app.activeLane;
    if (L && L.physics) this.watchOutcome(L);
    if (!this.running()) return;
    if (L && L.physics) { this.updateRoll(L); this.watchPins(L, dt); }
    this.watchFarLanes();
  }

  // The hall's far-lane life (hall.js): a new ball on another lane is heard rolling, its pins
  // crash when the hall's ball reaches them, its pinsetter sweeps when the hall's rake does, and
  // now and then the bowlers over there cheer a strike.
  watchFarLanes() {
    const hall = this.app && this.app.scene && this.app.scene.hall;
    if (!hall || !hall.racks || typeof hall.racks.values !== 'function') return;
    for (const rack of hall.racks.values()) {
      const ev = rack.event;
      if (!ev || this.farSeen.has(ev) || !rack.L || typeof ev.hit !== 'number') continue;
      this.farSeen.add(ev);
      const now = this.ctx.currentTime, lead = Math.max(0, (ev.t0 || 0) - (hall.time || 0));
      const x = rack.L.x, pins = countPins((ev.knock || 0) & (rack.standing ?? 0x3FF));
      const near = this.spatial(x, -3), far = this.spatial(x, -LANE.headPin);
      this.play(this.pick('farRoll'), { when: now + lead, gain: 0.9 * near.gain, pan: near.pan, wet: near.wet + 0.15, rate: Math.max(0.85, Math.min(1.15, FAR_ROLL_TIME / ev.hit)) });
      if (pins > 0) this.play(this.pick(pins >= 9 ? 'farCrashBig' : pins >= 4 ? 'farCrashMid' : 'farCrashSmall'),
        { when: now + lead + ev.hit, gain: 1.6 * far.gain, pan: far.pan, wet: far.wet + 0.15, lp: 6000 });
      this.play(this.pick(ev.reset ? 'newRack' : 'respot'), { when: now + lead + ev.hit + FAR_SWEEP_AT - 0.3, gain: 0.9 * far.gain, pan: far.pan, wet: far.wet + 0.2, lp: 5000 });
      if (pins === 10 && rack.standing === 0x3FF && Math.random() < 0.35)
        this.play(this.pick('yeah'), { when: now + lead + ev.hit + 0.5, gain: 0.35 * near.gain, pan: near.pan, wet: 0.5, lp: 2200, bus: this.crowd });
      this.logEvent('farLane', { x: Math.round(x * 100) / 100, pins, reset: !!ev.reset });
    }
  }

  // ---- the people ---------------------------------------------------------------------------------
  react(r, human, laneNo, source) {
    if (!r || r.kind === 'none') return;
    const layers = plan(r, human);
    const fl = flashFor(r, human);
    if (fl && this.flash) this.flash.trigger(fl[0], fl[1]);
    const played = this.playLayers(layers);
    this.lastReaction = performance.now();
    this.logEvent('reaction', { kind: r.kind, size: r.size, human: !!human, lane: laneNo, source, layers: layers.map((l) => l.bank), played });
  }
  playLayers(layers) {
    if (!this.running() || !layers.length) return false;
    const now = this.ctx.currentTime;
    let any = false;
    for (const l of layers) {
      const buf = this.pick(l.bank);
      if (!buf) continue;
      any = true;
      this.play(buf, { when: now + l.delay + Math.random() * 0.05, gain: l.gain * CROWD_GAIN * (0.88 + Math.random() * 0.24),
        rate: 0.96 + Math.random() * 0.08, bus: this.crowd, wet: 0.24, pan: (Math.random() - 0.5) * 0.25, force: true });
    }
    return any;
  }

  // The shared game events (js/game/events.js): the events of one ball arrive together; they are
  // gathered and judged once, after the emitting code has finished
  listenGame() {
    for (const type of ['ball', 'strike', 'spare', 'split', 'gutter', 'miss']) gameEvents.on(type, (e) => this.collect(e));
    gameEvents.on('bumpersUp', (e) => this.bumpers(e, true));
    gameEvents.on('bumpersDown', (e) => this.bumpers(e, false));
    gameEvents.on('bumperHit', (e) => this.bumperHit(e));
    gameEvents.on('practiceStart', (e) => this.practiceStart(e));
    gameEvents.on('practiceEnd', (e) => this.practiceEnd(e));
    gameEvents.on('gameStart', (e) => this.gameStart(e));
    gameEvents.on('gameEnd', (e) => this.gameEnd(e));
  }
  collect(e) {
    const lane = e.lane;
    let p = this.pending.get(lane);
    if (!p) {
      p = { lane, kinds: new Set() };
      this.pending.set(lane, p);
      queueMicrotask(() => this.flush(lane));
    }
    if (e.type === 'ball') Object.assign(p, { ball: true, exciter: e.exciter, firstBall: e.firstBall, standing: e.standing, before: e.before, practice: !!e.practice, human: e.human });
    else {
      p.kinds.add(e.type);
      if (e.type === 'strike') { p.inARow = e.inARow; p.redPin = e.redPin; }
      if (p.human == null && e.human != null) p.human = e.human;
      if (e.practice) p.practice = true;
    }
  }
  flush(lane) {
    const p = this.pending.get(lane);
    this.pending.delete(lane);
    if (!p || this.instant()) return;
    if (this.practice.has(lane)) p.practice = true;
    const r = classify(p);
    const human = !!p.human;
    const B = this.ball && this.ball.laneNo === lane && !this.ball.confirmed ? this.ball : null;
    if (B) B.confirmed = r;
    this.logEvent('judged', { lane, kind: r.kind, size: r.size, human, early: B && B.early ? B.early.kind : null });
    if (r.kind === 'none') return;
    if (B && B.early) {
      if (B.early.family === r.family) {
        const more = upgrade(B.early, r, human);
        if (more.length) {
          const fl = flashFor(r, human);
          if (fl && this.flash) this.flash.trigger(fl[0] * 0.8, 1);
          const played = this.playLayers(more);
          this.logEvent('reaction', { kind: r.kind, size: r.size, human, lane, source: 'upgrade', layers: more.map((l) => l.bank), played });
        }
        return;
      }
    }
    this.react(r, human, lane, 'confirmed');
  }

  // ---- the machines -----------------------------------------------------------------------------
  // the rails move only when they change (they are down when a lane opens)
  bumpers(e, up) {
    if (!this.bumperUp) this.bumperUp = new Map();
    if (!!this.bumperUp.get(e.lane) === up) return;
    this.bumperUp.set(e.lane, up);
    this.logEvent(up ? 'bumpersUp' : 'bumpersDown', { lane: e.lane });
    if (!this.running()) return;
    const sp = this.spatial(this.laneX(e.lane), -5);
    this.play(this.pick(up ? 'bumperUp' : 'bumperDown'), { gain: 1.1 * sp.gain, pan: sp.pan, wet: sp.wet });
  }
  bumperHit(e) {
    if (!this.running()) return;
    const app = this.app, L = app && app.activeLane;
    const b = L && L.physics ? L.physics.ball.position : { x: this.laneX(e.lane), z: -8 };
    const k = Math.min(1, (e.speed || 5) / 7);
    this.impact('kick', 0.4 + k * 0.6, b.x, b.z, 0);
    this.impact('thud', 0.3 * k, b.x, b.z, 0);
  }
  practiceStart(e) {
    this.practice.add(e.lane);
    this.logEvent('practiceStart', { lane: e.lane });
    if (!this.running()) return;
    const con = this.spatial(this.laneX(e.lane), 3);
    this.play(this.pick('chimeUp'), { gain: 0.35, pan: con.pan, wet: 0.15 });
    const deck = this.spatial(this.laneX(e.lane), -LANE.headPin);
    this.play(this.pick('newRack'), { when: this.ctx.currentTime + 0.4, gain: 0.9 * deck.gain, pan: deck.pan, wet: deck.wet + 0.1 });
  }
  practiceEnd(e) {
    this.practice.delete(e.lane);
    this.logEvent('practiceEnd', { lane: e.lane });
    if (!this.running()) return;
    const con = this.spatial(this.laneX(e.lane), 3);
    this.play(this.pick('chimeDown'), { gain: 0.35, pan: con.pan, wet: 0.15 });
  }
  gameStart(e) {
    for (const l of (e && e.lanes) || []) this.practice.delete(l);
    this.logEvent('gameStart', { lanes: e && e.lanes });
  }
  // the end of a game: the group gives a short round of applause
  gameEnd(e) {
    this.logEvent('gameEnd', { lanes: e && e.lanes });
    if (this.instant() || !this.running()) return;
    const buf = this.pick('clapS');
    if (buf) this.play(buf, { when: this.ctx.currentTime + 0.6, gain: 0.45 * CROWD_GAIN, bus: this.crowd, wet: 0.24, force: true });
  }

  // ---- the log (for the tests; ?audiolog=1 prints it) ------------------------------------------
  logEvent(type, data = {}) {
    const e = { t: Math.round(typeof performance !== 'undefined' ? performance.now() : 0), type, ...data };
    this.log.push(e);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    if (this.debug) console.info('[audio]', JSON.stringify(e));
  }
  // for the tests: how many variants of each bank are ready
  readiness() {
    const r = {};
    for (const [name, b] of this.banks) r[name] = b.slots.filter(Boolean).length + '/' + b.slots.length;
    r.murmur = !!this.murmur;
    return r;
  }
}

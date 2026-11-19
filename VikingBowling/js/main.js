// ---------------------------------------------------------------------------
// main.js - Viking Bowling: the screens and the game flow.
//   splash (the blue Viking helmet, five flags, help and copyright) -> game choice (open play and its
//   variants, or a VBS-T format; EUR or AMR) -> names -> play -> summary
// ---------------------------------------------------------------------------
import { setLang, lang, langInfo, t, ct, LANGS, FLAGS, loadConsoleTexts } from './i18n.js';
import { BowlingScene } from './sim3d/scene.js';
import { LanePhysics, LANE } from './sim3d/physics.js';
import { SwipeInput, STANCE } from './sim3d/input.js';
import { StandInLoadCom } from './standin/loadcom.js';
import { MachinePlayer, generateNames, SKILLS } from './ai/bots.js';
import { startOpenPlay, GCI, firstBallOfSerie } from './engine/openplay.js';
import { gameTotal } from './engine/bowlingscore.js';
import { LaneGame } from './game/lanegame.js';
import { HallAudio } from './audio/hallaudio.js';
import { VbstSession, PREDEFINED, loadAutoFormats } from './vbst/session.js';
import { AUTO_FORMATS } from './vbst/autoformats.js';
import { gameCard, formatCard, formatSymbolFor } from './menucards.js';
// the TV wall, the lane consoles, the bumpers and the warm-up (js/game/wallgame.js)
import { installWallGame, WARM_IDS, warmChoice } from './game/wallgame.js';
import { withBumperMark, withoutBumperMark } from './engine/correction.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('vbg.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('vbg.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
};

// The open play game types: the name (the lane console's text where it has one), one line on
// what is special about the game and its symbol (js/menucards.js). Short Game n starts at
// frame 11 - n (CGame::CheckShortGame: start square 16, 14, 12, 10).
const OPEN_GAMES = [
  { id: 'normal', sym: 'pin', label: () => ct('game.normal', 'Vanlig bowling'), desc: () => t('gdNormal') },
  { id: '369', sym: '369', label: () => ct('game.369', '3-6-9'), desc: () => t('gd369') },
  { id: 'mini', sym: 'mini', label: () => ct('game.mini', 'Mini Bowling'), desc: () => t('gdMini') },
  { id: 'tenth', sym: 'tenth', label: () => ct('game.10thFrame', '10th Frame'), desc: () => t('gdTenth') },
  { id: 'notap9', sym: 'notap:9', label: () => t('noTapN', { n: 9 }), desc: () => t('gdNoTap', { n: 9 }) },
  { id: 'notap8', sym: 'notap:8', label: () => t('noTapN', { n: 8 }), desc: () => t('gdNoTap', { n: 8 }) },
  { id: 'notap7', sym: 'notap:7', label: () => t('noTapN', { n: 7 }), desc: () => t('gdNoTap', { n: 7 }) },
  { id: 'notap6', sym: 'notap:6', label: () => t('noTapN', { n: 6 }), desc: () => t('gdNoTap', { n: 6 }) },
  { id: 'short2', sym: 'short:9', label: () => t('shortN', { n: 2 }), desc: () => t('gdShort', { f: 9 }) },
  { id: 'short3', sym: 'short:8', label: () => t('shortN', { n: 3 }), desc: () => t('gdShort', { f: 8 }) },
  { id: 'short4', sym: 'short:7', label: () => t('shortN', { n: 4 }), desc: () => t('gdShort', { f: 7 }) },
  { id: 'short5', sym: 'short:6', label: () => t('shortN', { n: 5 }), desc: () => t('gdShort', { f: 6 }) },
  { id: 'cfg', sym: 'cfg', label: () => t('cfg'), desc: () => t('gdCfg') }
];
const THEMES = ['Standard', 'Viking Refresh', 'Halloween', 'Xmas Center'];      // the options of #optTheme
// the pin crash's time a frame on the low detail level: 8 ms, or half the frame interval when frames
// are slower anyway (a software renderer draws a frame in 100 ms and more: the crash keeps its pace)
const PIN_BUDGET_MS = 8, PIN_BUDGET_SHARE = 0.5;
const MAX_ROBOTS = 5;                                                          // the options of #optRobots

// The saved settings, checked against what this version of the game knows: a value that
// is not one of the known ids (an older version's, or a damaged entry) gives way to the
// default, so a stale localStorage can never stop the game from starting.
export function loadSettings(saved) {
  const d = { lang: 'sv', style: 'eur', game: 'normal', redPin: false, aim: true, speed: false,
    theme: 'Standard', robots: 2, skill: 'league', name: '' };
  const v = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const one = (key, ok) => { if (ok(v[key])) d[key] = v[key]; };
  const bool = (x) => typeof x === 'boolean';
  one('lang', (x) => LANGS.some((l) => l.id === x));
  one('style', (x) => x === 'eur' || x === 'amr');
  one('game', (x) => OPEN_GAMES.some((g) => g.id === x));
  one('skill', (x) => SKILLS.some((k) => k.id === x));
  one('theme', (x) => THEMES.includes(x));
  one('robots', (x) => Number.isInteger(x) && x >= 0 && x <= MAX_ROBOTS);
  one('redPin', bool); one('aim', bool); one('speed', bool); one('aimV', bool);
  one('name', (x) => typeof x === 'string');
  d.name = d.name.trim().slice(0, 20);
  d.detail = 'auto'; one('detail', (x) => x === 'auto' || x === 'high' || x === 'low');    // the 3D hall's detail level (sim3d/hall.js)
  d.throwMode = 'auto'; one('throwMode', (x) => x === 'auto' || x === 'motion' || x === 'swipe');   // swing the phone or swipe (sim3d/input.js, motion.js)
  d.warm = 'none'; one('warm', (x) => WARM_IDS.includes(x));                                    // the warm-up of open play
  d.warmV = 'format'; one('warmV', (x) => x === 'format' || WARM_IDS.includes(x));              // VBS-T: the format's own or another
  d.bump = false; one('bump', bool);                                                             // the player bowls with bumpers
  one('format', (x) => typeof x === 'string' && (PREDEFINED.some((p) => p.id === x) ||
    (x.startsWith('auto:') && AUTO_FORMATS.some((a) => a.name === x.slice(5)))));
  return d;
}

class App {
  constructor() {
    this.settings = loadSettings(store.get('settings', {}));
    this.mode = 'open';
    this.fast = false;
    this.sound = new HallAudio({ store, app: this });      // js/audio: the hall's sound (mute and volume remembered)
    this.loadcom = new StandInLoadCom();
    this.scene = new BowlingScene($('#stage'), { detail: this.settings.detail });
    this.scene.onDetailChange = () => this.syncDetailUi();     // "auto" dropped to low on a slow device
    const sp = LANE.laneSpacing;
    this.slots = [{ slot: 0, laneX: 0, number: 5, hue: 0.6 }, { slot: 1, laneX: sp, number: 6, hue: 0.08 }];
    this.scene.buildHall(this.slots, { base: 5 });
    this.physics = this.slots.map((s) => new LanePhysics({ laneX: s.laneX }));
    this.input = new SwipeInput($('#stage'), $('#trail'), {
      onPosition: (x, z) => this.onPosition(x, z),
      onThrow: (p) => this.onThrow(p),
      onAim: (p) => this.onAim(p),
      onWeak: () => this.toast(t('weak')),
      onMisplace: () => this.toast(t('placeHint'), 3500, 'hint'),
      // the throw by swinging the phone (sim3d/motion.js): its hints, "use the swipe instead"
      onHint: (key, ms) => this.toast(t(key), ms || 4000, 'hint'),
      onChooseSwipe: () => { this.settings.throwMode = 'swipe'; this.save(); this.input.setMode('swipe'); this.syncThrowUi(); this.swipeStatus(); },
      onModeChange: () => { this.syncThrowUi(); this.swipeStatus(); },     // motion control failed (the swipe) or came back
      onHintClear: () => { clearTimeout(this.toastT); $('#toast').classList.remove('show'); },
      // the swing's aim marker over the arrows is drawn through the scene's camera
      aimView: () => (this.throwLane ? { camera: this.scene.camera, laneX: this.throwLane.laneX } : null)
    });
    this.input.setMode(this.settings.throwMode);
    this.activeLane = null;
    this.instantBot = new MachinePlayer({ name: 'auto', average: 185 });   // for app.instant (automated runs)
    this.last = performance.now();
    this.scene.aimView(0, this.scene.portrait);
    this.physics.forEach((ph, i) => this.scene.sync(i, ph));
    // one frame now, behind the splash (it compiles the shaders and uploads the textures);
    // after that the 3D view is drawn only while it is seen (show('play'))
    this.scene.render(0);
    this.rendering = false;
    this.raf = 0;
    this.bindUi();
    setLang(this.settings.lang);
    this.applyTexts();
    installWallGame(this, $, store);    // the TV wall, the lane consoles, the bumpers, the warm-up
    window.vikingApp = this;            // for the automated screenshot runs
  }

  // ---- rendering --------------------------------------------------------
  // The render loop runs only while the play screen shows the 3D view: behind the splash,
  // the menus, the standings and the summary it is paused, and it resumes on play.
  setRendering(on) {
    if (on === this.rendering) return;
    this.rendering = on;
    if (on) { this.last = performance.now(); if (!this.raf) this.raf = requestAnimationFrame((ts) => this.frame(ts)); }
    else if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  frame(ts) {
    this.raf = 0;
    if (!this.rendering) return;
    const elapsed = Math.max(0, (ts - this.last) / 1000);
    const dt = Math.min(0.05, elapsed);
    const physDt = Math.min(0.25, elapsed);      // a slow frame still moves the ball in real time
    this.last = ts;
    const L = this.activeLane;
    if (L) this.scene.setActiveLane(L.slot);      // the playing lane's overhead TV is the large, framed one
    if (L) {
      const ph = L.physics;
      if (ph.state === 'approach' || ph.state === 'rolling' || ph.state === 'deck') {
        // ⏩ speeds up the machine players' balls, never the player's own. On the low detail level (a
        // phone) the pin crash - the contact solving of ten pins - gets PIN_BUDGET_MS a frame (or a
        // share of a slow frame): on a CPU that cannot keep up it then plays a little slower than real
        // time instead of stalling frames
        const budget = this.scene.detail === 'low' && ph.state === 'deck' ? Math.max(PIN_BUDGET_MS, PIN_BUDGET_SHARE * elapsed * 1000) : 0;
        ph.step(physDt * (this.fast && !ph.human ? 2.5 : 1), budget);
        const b = ph.ball.position;
        if (ph.state === 'approach') { /* carried up to the foul line: the aim view stays */ }
        else if (ph.state === 'rolling' && b.z > -13.5) this.scene.followView(L.laneX, b.z, b.x);
        else this.scene.pinView(L.laneX, this.scene.portrait);
        this.sound.ballEvents(L, ph.events.splice(0));      // the pins' impacts, the gutter, the ball at rest
      }
      this.syncLane(L, this.redPinFor(L));
    }
    this.scene.render(dt);
    this.sound.frame(dt, this);                            // the roll, the pins, the far lanes, the lane lights
    this.raf = requestAnimationFrame((t2) => this.frame(t2));
  }

  syncLane(L, redPin) { this.scene.sync(L.slot, L.physics, redPin); }
  // the red head pin: not while practice balls are played (LanedataUtil::RedPinShown, as
  // LaneGame.redPinOn), so the warm-up's racks are white
  redPinFor(L) {
    const g = this.engine;
    if (!g) return false;
    const pis = g.getPlayerInfoStruct(L.number);
    return !!pis && pis.RedPin === 1 && !g.isWarmUp(L.number);
  }

  // ---- the throw ---------------------------------------------------------
  waitForThrow(L) {
    return new Promise((resolve) => {
      this.throwResolve = resolve;
      this.throwLane = L;
      // the throw is asked again while the lane console is open (a console change interrupted it):
      // the swipe and the swing button stay off behind it until it is closed (ConsoleHost.close)
      if (!(this.consoleHost && this.consoleHost.isOpen)) this.input.enable(this.humanX0 || 0, this.humanZ0 || STANCE.zMin);
      this.onPosition(this.humanX0 || 0, this.humanZ0 || STANCE.zMin);
      // thrown by swinging the phone: the swing button says how (and the first-use card)
      if (this.input.usingMotion()) { this.status(t('yourTurnMotion'), true); return; }
      // the gestures, once: throw, pull back for power, hold to move the ball
      if (!store.get('throwHint', false)) { store.set('throwHint', true); this.toast(t('throwHint'), 9000, 'hint'); }
    });
  }
  // the player's turn went over to the swipe (chosen instead of the swing, or the swing failed), or
  // back to the swing (a permission granted late)
  swipeStatus() {
    if (this.throwResolve) this.status(t(this.input.usingMotion() ? 'yourTurnMotion' : 'yourTurn'), true);
  }
  // where the player stands: x across the lane, z metres behind the foul line
  onPosition(x, z = this.humanZ0 || STANCE.zMin) {
    this.humanX0 = x;
    this.humanZ0 = z;
    const L = this.throwLane;
    if (!L || !this.throwResolve) return;
    L.physics.ball.position.set(L.laneX + x, LANE.ballRadius, z);
    L.physics.ball.velocity.setZero();
    // the camera behind the ball, as far back as the player stands
    this.scene.aimView(L.laneX, this.scene.portrait, z);
    this.scene.camTargetPos.x = L.laneX + x * 0.5;
  }
  onAim(p) {
    if (!this.aimEnabled() || !this.throwLane) return;
    const now = performance.now();
    if (this.lastAim && now - this.lastAim < 140) return;
    this.lastAim = now;
    const r = LanePhysics.predict({ x0: p.x0, speed: p.speed, angle: p.angle, side: p.side, roll: p.roll,
      bumpers: !!(this.bumpers && this.bumpers.isUp(this.throwLane.slot)) }, 4);
    this.scene.showAimPath(this.throwLane.laneX, r.path);
  }
  aimEnabled() { return this.mode === 'vbst' ? this.settings.aimV !== false : this.settings.aim; }
  // for the automated runs: a well aimed throw at targetX (m right of the head pin)
  testAimedThrow(targetX = 0.09, speed = 8, side = 26, x0 = 0.25) { const p = LanePhysics.aim({ targetX, x0, speed, side, roll: 0.5 }); this.humanX0 = x0; return this.testThrow(p); }
  // for the automated runs: a throw as a swipe would give it
  testThrow(p) { if (this.throwResolve) this.onThrow(Object.assign({ x0: this.humanX0 || 0, z0: this.humanZ0 || STANCE.zMin, roll: 0.5 }, p)); return !!p; }
  onThrow(p) {
    if (!this.throwResolve) return;
    const r = this.throwResolve;
    this.throwResolve = null;
    this.input.disable();
    this.scene.showAimPath(0, null);
    this.sound.unlock();
    r(p);
  }
  watchBall(L) {
    return new Promise((resolve) => {
      const check = () => {
        if (L.physics.state === 'done') { resolve({ gutter: L.physics.inGutter }); return; }
        setTimeout(check, 50);
      };
      check();
    });
  }

  // ---- the HUD -----------------------------------------------------------
  status(text, mine) { const s = $('#status'); s.textContent = text; s.classList.toggle('mine', !!mine); }
  // the ball speed after every ball, as a lane shows it (the lane TV shows it too when the
  // "show ball speed" option is on)
  speedo(kmh) {
    const loc = { sv: 'sv-SE', en: 'en-GB', da: 'da-DK', no: 'nb-NO', fi: 'fi-FI' }[lang()] || 'sv-SE';
    let v;
    try { v = new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(kmh); } catch (e) { v = kmh.toFixed(1); }
    $('#speedo').textContent = kmh > 0 ? t('ballSpeedKmh', { v }) : '';
  }
  // cls 'hint': a gesture hint, shown above the status line instead of at the top
  toast(text, ms = 2200, cls = '') { const e = $('#toast'); e.textContent = text; e.classList.toggle('hint', cls === 'hint'); e.classList.add('show'); clearTimeout(this.toastT); this.toastT = setTimeout(() => e.classList.remove('show'), ms); }
  effect(text, cls = '') {
    const e = $('#effect');
    e.className = 'effect ' + cls;
    e.textContent = text;
    void e.offsetWidth;
    e.classList.add('show');
    // taken off when it has played, or showing the HUD again would replay it
    e.onanimationend = () => e.classList.remove('show');
  }

  reactTo(res, who, before, after, result) {
    const fallen = 10 - countBits(after);
    if (res.exciter === GCI.EXCITER_STRIKE) {
      const n = res.numInARow;
      const label = res.redPinStrike ? t('redPinStrike') : (res.noTapReset && after !== 0 ? t('noTapStrike')
        : n >= 4 ? t('fourBagger') : n === 3 ? t('turkey') : n === 2 ? t('double') : t('strike'));
      this.effect(label, res.redPinStrike ? 'red' : '');
      this.scene.burst(this.activeLane.laneX, res.redPinStrike ? 0xff3030 : 0xE2B550, 120);
    } else if (res.exciter === GCI.EXCITER_SPARE || res.exciter === GCI.EXCITER_SPMAKE) {
      this.effect(t('spare'));
      this.scene.burst(this.activeLane.laneX, 0x7fc1ff, 70);
    } else if (res.exciter === GCI.EXCITER_SPLIT) this.effect(t('split'), 'white');
    else if (res.exciter === GCI.EXCITER_ZERO || (result && result.gutter && fallen === 0)) this.effect(t('gutter'), 'white');
    else if (!res.firstBall && res.ballPins === 0) this.effect(t('miss'), 'white');
    if (res.player && res.player.status) { /* the lane TV shows the rest */ }
  }

  focusLane(n) {
    const idx = this.tvLanes ? this.tvLanes.indexOf(n) : 0;
    if (idx < 0) return;
    $('#tv1').hidden = idx !== 0;
    $('#tv2').hidden = idx !== 1;
    $$('#tvTabs button').forEach((b) => b.classList.toggle('active', +b.dataset.lane === n));
  }

  pushTv(lanes) { for (const n of lanes) this.loadcom.changed(n); }
  // the window of the TakTV page that shows this lane, or null (a lane without one: the small TVs)
  tvWindowFor(lane) {
    const i = this.tvLanes ? this.tvLanes.indexOf(lane) : -1;
    const f = i >= 0 ? [$('#tv1'), $('#tv2')][i] : null;
    return f && f.getAttribute('src') ? f.contentWindow : null;
  }

  // Points the lane TV page(s) at the lanes of this game
  setupTv(laneNumbers) {
    this.tvLanes = laneNumbers;
    this.loadcom.unsubscribeAll();
    this.loadcom.settings.lang = langInfo().lang;
    this.loadcom.settings.showBallSpeed = this.settings.speed ? 'Yes' : 'No';
    const tvs = [$('#tv1'), $('#tv2')];
    tvs.forEach((f, i) => {
      if (i < laneNumbers.length) {
        // readonly: the page does not rasterise and post its sheet as a JPEG after every push (on a
        // phone that hitched the game); the lane console's picture of the lane is asked of the page
        // only while the console shows that lane (ConsoleHost, tvWindowFor)
        f.src = 'web/screen/HTML/TakTV/TakTVGame.html?lane=' + laneNumbers[i] + '&lang=' + encodeURIComponent(langInfo().lang) + '&readonly=1&v=' + Date.now();
        f.hidden = i !== 0;
      } else { f.hidden = true; f.removeAttribute('src'); }
    });
    const tabs = $('#tvTabs');
    tabs.hidden = laneNumbers.length < 2;
    $$('#tvTabs button').forEach((b, i) => { b.dataset.lane = laneNumbers[i] || ''; b.textContent = t('lane') + ' ' + (laneNumbers[i] || ''); });
  }

  // ---- screens -------------------------------------------------------------
  show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    this.screen = id;
    this.setRendering(id === 'play');
    if (id !== 'play') this.input.pauseSensors();       // no devicemotion listener on the menus
    // back on a screen with a start button: a new game may be started again (see start())
    if (id === 'splash' || id === 'menu' || id === 'names' || id === 'summary') {
      this.starting = false;
      $('#startBtn').disabled = false;
      $('#sumAgain').disabled = false;
    }
  }

  applyTexts() {
    $$('[data-t]').forEach((e) => { e.textContent = t(e.dataset.t); });
    $('#humanName').placeholder = t('namePh');
    $('#autoSearch').placeholder = t('search');
    const skillOpts = SKILLS.map((s) => `<option value="${s.id}">${t('skills.' + s.id)} (${s.avg})</option>`).join('');
    $('#optSkill').innerHTML = skillOpts; $('#optSkillV').innerHTML = skillOpts;
    $('#optSkill').value = this.settings.skill; $('#optSkillV').value = this.settings.skill;
    $('#langRow').innerHTML = LANGS.map((l) => `<button class="flagBtn${l.id === lang() ? ' active' : ''}" data-lang="${l.id}" role="radio" aria-checked="${l.id === lang()}">${FLAGS[l.id]}<span>${l.name}</span></button>`).join('');
    this.renderGameGrid();
    if (this.formatsShown) this.renderFormats();
    this.syncDetailUi();
    this.syncThrowUi();
  }

  // The way to throw in the two option rows (swing the phone or swipe); "Auto" says which it
  // is on this device. The splash's line on the swing shows where the swing is the default.
  syncThrowUi() {
    for (const sel of [$('#optThrow'), $('#optThrowV')]) {
      if (!sel) continue;
      const auto = sel.querySelector('option[value="auto"]');
      if (auto) auto.textContent = t('throwAuto') + ' (' + t(this.input.autoMode() === 'motion' ? 'throwMotion' : 'throwSwipe') + ')';
      sel.value = this.settings.throwMode;
    }
    const how = $('#howToMotion');
    if (how) how.hidden = this.input.autoMode() !== 'motion';
    // "Visa svingdemo" where the swing is the way to throw
    const swing = this.settings.throwMode === 'motion' || (this.settings.throwMode === 'auto' && this.input.autoMode() === 'motion');
    for (const b of [$('#optMotionDemo'), $('#optMotionDemoV')]) if (b) b.hidden = !swing;
  }

  // The hall's detail level in the two option rows; "Auto" says which level it picked
  syncDetailUi() {
    for (const sel of [$('#optDetail'), $('#optDetailV')]) {
      if (!sel) continue;
      const auto = sel.querySelector('option[value="auto"]');
      if (auto) auto.textContent = t('detailAuto') + ' (' + t(this.scene.autoLevel === 'low' ? 'detailLow' : 'detailHigh') + ')';
      sel.value = this.settings.detail;
    }
  }

  renderGameGrid() {
    $('#gameGrid').innerHTML = OPEN_GAMES.map((g) => gameCard(g, g.id === this.settings.game)).join('');
  }

  bindUi() {
    $('#langRow').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lang]');
      if (!b) return;
      this.goFullscreen();
      this.settings.lang = b.dataset.lang;
      setLang(b.dataset.lang);
      await loadConsoleTexts();
      this.applyTexts();
      this.save();
    });
    $('#okBtn').addEventListener('click', async () => {
      this.goFullscreen();
      this.sound.unlock();
      await loadConsoleTexts();
      this.applyTexts();
      this.show('menu');
    });
    $$('.tab').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.tab)));
    $$('[data-style]').forEach((b) => b.addEventListener('click', () => { this.settings.style = b.dataset.style; this.syncMenu(); this.save(); }));
    $('#gameGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-game]');
      if (!b) return;
      this.settings.game = b.dataset.game; this.renderGameGrid(); this.save();
    });
    $('#optRedPin').addEventListener('change', (e) => { this.settings.redPin = e.target.checked; this.save(); });
    $('#optAim').addEventListener('change', (e) => { this.settings.aim = e.target.checked; this.save(); });
    $('#optAimV').addEventListener('change', (e) => { this.settings.aimV = e.target.checked; this.save(); });
    $('#optSpeed').addEventListener('change', (e) => { this.settings.speed = e.target.checked; this.save(); });
    $('#optTheme').addEventListener('change', (e) => { this.settings.theme = e.target.value; this.save(); });
    $('#optRobots').addEventListener('change', (e) => { this.settings.robots = +e.target.value; this.save(); });
    $('#optSkill').addEventListener('change', (e) => { this.settings.skill = e.target.value; this.save(); });
    $('#optSkillV').addEventListener('change', (e) => { this.settings.skill = e.target.value; this.save(); });
    for (const id of ['#optThrow', '#optThrowV']) {
      const sel = $(id);
      if (sel) sel.addEventListener('change', (e) => { this.settings.throwMode = e.target.value; this.input.setMode(e.target.value, true); this.save(); this.syncThrowUi(); });
    }
    for (const id of ['#optMotionDemo', '#optMotionDemoV']) { const b = $(id); if (b) b.addEventListener('click', () => this.input.playDemo()); }
    for (const id of ['#optDetail', '#optDetailV']) {
      $(id).addEventListener('change', (e) => { this.settings.detail = e.target.value; this.scene.setDetail(e.target.value); this.save(); this.syncDetailUi(); });
    }
    $$('[data-ftab]').forEach((b) => b.addEventListener('click', () => { this.ftab = b.dataset.ftab; this.renderFormats(); }));
    $('#autoSearch').addEventListener('input', () => this.renderFormats());
    $('#formatList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-fmt]');
      if (!b) return;
      this.settings.format = b.dataset.fmt; this.save(); this.renderFormats();
    });
    $('#menuBack').addEventListener('click', () => this.show('splash'));
    $('#menuNext').addEventListener('click', () => this.toNames());
    $('#namesBack').addEventListener('click', () => this.show('menu'));
    $('#reroll').addEventListener('click', () => this.makeRobots(true));
    $('#startBtn').addEventListener('click', () => this.start());
    $('#humanName').addEventListener('input', (e) => { this.settings.name = e.target.value.trim(); this.save(); });
    $('#tvBox').addEventListener('click', (e) => {
      if (e.target.closest('#tvTabs button')) { this.focusLane(+e.target.closest('button').dataset.lane); return; }
      $('#tvBox').classList.toggle('big');
    });
    $('#btnFull').addEventListener('click', () => this.toggleFullscreen());
    $('#btnFull').hidden = !fsSupported();          // iPhone Safari: pages have no full-screen API
    $('#standNext').addEventListener('click', () => this.fullscreenOnPlay());
    $('#btnSound').addEventListener('click', () => { this.sound.on = !this.sound.on; store.set('sound', this.sound.on); this.syncHud(); });
    $('#btnFast').addEventListener('click', () => { this.fast = !this.fast; this.syncHud(); });
    $('#btnMenu').addEventListener('click', () => this.quit());
    $('#sumMenu').addEventListener('click', () => { this.show('menu'); });
    $('#sumAgain').addEventListener('click', () => this.start());
    $('#standMenu').addEventListener('click', () => this.quit());
    document.addEventListener('fullscreenchange', () => this.syncHud());
    document.addEventListener('webkitfullscreenchange', () => this.syncHud());
  }

  syncHud() {
    $('#btnSound').innerHTML = this.sound.on ? '&#128266;' : '&#128263;';
    $('#btnSound').title = t(this.sound.on ? 'soundOff' : 'soundOn'); $('#btnSound').setAttribute('aria-label', $('#btnSound').title);
    $('#btnFast').classList.toggle('on', this.fast);
    $('#btnFull').title = fsElement() ? t('exitFullscreen') : t('fullscreen');
    $('#btnFull').classList.toggle('on', !!fsElement());
  }

  save() { store.set('settings', this.settings); }

  setMode(m) {
    this.mode = m;
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === m));
    $('#openPane').hidden = m !== 'open';
    $('#vbstPane').hidden = m !== 'vbst';
    if (m === 'vbst') { this.formatsShown = true; this.renderFormats(); }
  }

  syncMenu() {
    $$('[data-style]').forEach((b) => b.classList.toggle('active', b.dataset.style === this.settings.style));
    $('#optRedPin').checked = this.settings.redPin;
    $('#optAim').checked = this.settings.aim;
    $('#optAimV').checked = this.settings.aimV !== false;
    $('#optSpeed').checked = this.settings.speed;
    $('#optTheme').value = this.settings.theme;
    $('#optRobots').value = String(this.settings.robots);
    this.syncDetailUi();
    this.syncThrowUi();
  }

  async renderFormats() {
    const ftab = this.ftab || 'pre';
    $$('[data-ftab]').forEach((b) => b.classList.toggle('active', b.dataset.ftab === ftab));
    $('#autoSearch').hidden = ftab !== 'auto';
    let list;
    if (ftab === 'pre') list = PREDEFINED.map((f) => ({ id: f.id, title: f.title(lang()), sub: f.sub(lang()), sym: formatSymbolFor(f.id) }));
    else {
      if (!this.autoFormats) { $('#formatList').innerHTML = '<div class="note">…</div>'; this.autoFormats = await loadAutoFormats(); }
      const q = ($('#autoSearch').value || '').toLowerCase();
      list = this.autoFormats.filter((f) => !q || f.name.toLowerCase().includes(q)).map((f) => ({ id: 'auto:' + f.name, title: f.name, sub: f.summary(lang()), bad: f.missing,
        sym: formatSymbolFor('', (f.header.teamNames || []).filter((v) => v > 0).length) }));
    }
    if (!this.settings.format) this.settings.format = PREDEFINED[0].id;
    $('#formatList').innerHTML = list.map((f) => formatCard(f, f.id === this.settings.format, ftab !== 'pre')).join('');
  }

  // ---- names --------------------------------------------------------------
  async toNames() {
    $('#humanName').value = this.settings.name || '';
    if (this.mode === 'vbst') {
      try {
        this.vbst = await VbstSession.create(this, this.settings.format, this.settings.style === 'amr');
      } catch (e) {
        this.toast(String(e.message || e)); return;
      }
      $('#namesTitle').textContent = this.vbst.title();
    } else {
      $('#namesTitle').textContent = OPEN_GAMES.find((g) => g.id === this.settings.game).label() + ' · ' + (this.settings.style === 'amr' ? 'AMR' : 'EUR');
    }
    this.makeRobots(false);
    this.show('names');
  }

  makeRobots(reroll) {
    const rng = Math.random;
    if (this.mode === 'vbst') { this.vbst.makeRobots(reroll); this.renderRobots(); return; }
    const n = this.settings.robots;
    if (reroll || !this.robots || this.robots.length !== n) {
      const names = generateNames(n, rng, lang(), [this.settings.name || '']);
      const base = SKILLS.find((s) => s.id === this.settings.skill).avg;
      this.robots = names.map((name) => new MachinePlayer({ name, average: Math.round(base + (rng() - 0.5) * 24), leftHanded: rng() < 0.15, rng }));
    }
    this.renderRobots();
  }

  renderRobots() {
    if (this.mode === 'vbst') { $('#robotList').innerHTML = this.vbst.rosterHtml(); return; }
    // each machine player may bowl with bumpers too (a child at a low level): the console's toggle
    $('#robotList').innerHTML = `<div class="note">${t('opponents')}</div>` + this.robots.map((r, i) =>
      `<div class="robot"><span>&#129302; ${escapeHtml(r.name)}</span><span class="robotRight"><small>${t('skill')}: ${r.average}${r.leftHanded ? ' · L' : ''}</small>` +
      `<label class="bumpToggle"><input type="checkbox" data-bump="${i}"${r.bumpers ? ' checked' : ''}> <span>${t('bumpers')}</span></label></span></div>`).join('');
  }

  humanName() {
    const n = ($('#humanName').value || '').trim().replace(/[^\p{L}\p{N} .\-_']/gu, '').slice(0, 20);
    return n || ({ en: 'Player', da: 'Spiller', no: 'Spiller', fi: 'Pelaaja' }[lang()] || 'Spelare');
  }

  // ---- open play -------------------------------------------------------------
  async start() {
    // one session per press: a double click (or Start and Spela igen at once) is ignored
    // until the game is over or the player is back on a menu (show() clears it)
    if (this.starting) return;
    this.starting = true;
    $('#startBtn').disabled = true;
    $('#sumAgain').disabled = true;
    this.fullscreenOnPlay();
    this.sound.unlock();
    this.settings.name = this.humanName();
    this.save();
    if (this.session) this.session.stop();
    if (this.mode === 'vbst') {
      try { await this.vbst.start(this.settings.name); } catch (e) { this.toast(String((e && e.message) || e)); this.show('names'); }
      return;
    }
    const american = this.settings.style === 'amr';
    const players = [{ name: this.settings.name, human: true, bumpers: !!this.settings.bump }, ...this.robots.map((r) => ({ name: r.name, bot: r, bumpers: !!r.bumpers }))];
    // the warm-up the start carries, and the bumper mark (+C) after the name of a bumper player,
    // as the lane console's start writes them into the lane file
    const warm = warmChoice(this.settings.warm);
    this.engine = startOpenPlay({
      method: this.settings.game, names: players.map((p) => ({ name: withBumperMark(p.name, p.bumpers) })), american,
      redPinPercent: this.settings.redPin ? 15 : 0, protocol: this.settings.theme, laneNumber: 5,
      practiceMethod: warm.method, practiceAmount: warm.amount
    });
    const eng = this.engine;
    const lanes = eng.lanes.map((pis, i) => ({ number: pis.laneNumber, laneX: this.slots[i].laneX, physics: this.physics[i], slot: i }));
    this.prepareLanes(lanes, eng);
    // who is who: by the player's id in the lane file (the console may reorder, add or take off
    // bowlers); in an American game the first half is on the odd lane, the rest on the even
    const split = american ? Math.ceil(players.length / 2) : players.length;
    const byId = new Map();
    eng.lanes.forEach((pis, li) => { for (let i = 0; i < pis.noPlayers; i++) byId.set(pis.player[i].playerIdNumber, players[li === 0 ? i : split + i]); });
    const skillAvg = SKILLS.find((s) => s.id === this.settings.skill).avg;
    const who = (lane, index, p) => {
      let w = p && byId.get(p.playerIdNumber);
      if (!w && p) {     // a bowler added at the console: a machine player of the game's level
        w = { name: withoutBumperMark(p.playerName), bot: new MachinePlayer({ name: withoutBumperMark(p.playerName), average: skillAvg }) };
        byId.set(p.playerIdNumber, w);
        players.push(w);
      }
      return Object.assign(w || players[0], p ? { name: withoutBumperMark(p.playerName) } : {});
    };
    this.show('play');
    this.syncHud();
    const session = this.session = new LaneGame(this, { engine: eng, lanes, who });
    const finished = await session.run();
    if (!finished || this.session !== session) return;
    this.effect(t('gameOver'), 'white');
    await new Promise((r) => setTimeout(r, 2200));
    // the player may have left (or started again) during the pause
    if (this.session !== session || session.stopped || this.screen !== 'play') return;
    this.showSummary(players, eng);
  }

  // Lanes, TV and stand-in for a game on these lanes
  prepareLanes(lanes, eng) {
    this.loadcom.clear();
    this.scene.relabel(lanes[0].number);
    lanes.forEach((L) => {
      const pis = eng.getPlayerInfoStruct(L.number);
      const other = lanes.length > 1 ? eng.getPlayerInfoStruct(lanes.find((x) => x !== L).number) : null;
      this.loadcom.attach(L.number, () => pis, () => other);
      this.scene.setLabel(L.slot, L.number);
    });
    this.loadcom.settings.alwaysShowLaneSum = 'No';
    this.setupTv(lanes.map((L) => L.number));
    this.activeLane = lanes[0];
    this.humanX0 = this.humanX0 || 0;
    this.speedo(0);
  }

  showSummary(players, eng) {
    const rows = [];
    const cfg = eng.isCFG();
    for (const pis of eng.lanes) for (let i = 0; i < pis.noPlayers; i++) {
      const p = pis.player[i];
      const name = withoutBumperMark(p.playerName);          // the bumper mark is not shown
      const who = players.find((x) => x.name === name) || {};
      rows.push({ name, human: !!who.human, total: gameTotal(p.score, cfg), ...frameStats(p) });
    }
    rows.sort((a, b) => b.total - a.total);
    const best = rows[0] ? rows[0].total : 0;
    $('#sumBody').innerHTML = `<div class="tableWrap"><table class="res"><tr><th>${t('place')}</th><th>${t('players')}</th><th>${t('score')}</th><th>${t('strikes')}</th><th>${t('spares')}</th><th>${t('opens')}</th><th class="sec">${t('splits')}</th></tr>` +
      rows.map((r, i) => `<tr class="${r.human ? 'me' : ''} ${r.total === best ? 'win' : ''}"><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${r.total}</td><td>${r.strikes}</td><td>${r.spares}</td><td>${r.opens}</td><td class="sec">${r.splits}</td></tr>`).join('') + '</table></div>' +
      `<div class="note">${escapeHtml(OPEN_GAMES.find((g) => g.id === this.settings.game).label())} · ${this.settings.style === 'amr' ? 'AMR' : 'EUR'}</div>`;
    this.show('summary');
  }

  quit() {
    if (this.session) this.session.stop();
    if (this.vbst) this.vbst.stop();
    if (this.throwResolve) { const r = this.throwResolve; this.throwResolve = null; r({ x0: 0, speed: 6, angle: 0, side: 0 }); }
    // a ball still rolling is finished at once: the render loop that steps it stops with
    // the play screen, and the stopped serie must not wait for it (or keep its sound)
    for (const ph of this.physics) if (ph.state === 'approach' || ph.state === 'rolling' || ph.state === 'deck') ph.state = 'done';
    this.sound.stopRoll();
    this.input.disable();
    $('#tvBox').classList.remove('big');
    this.show('menu');
  }

  // ---- full screen -----------------------------------------------------------
  // Asked for on the first gesture on the splash (a flag or OK). If the browser refused it,
  // or the player left it (Esc, the back gesture), it is asked for again at the next play
  // start - Starta, Spela igen, Nästa serie - which is a user gesture too. Leaving it with
  // the game's own full-screen button is the player's choice: then only that button asks again.
  goFullscreen() {
    if (this.fullscreenAsked) return;
    this.fullscreenAsked = true;
    this.requestFs(false);
  }
  fullscreenOnPlay() {
    if (this.fullscreenDeclined) return;
    this.requestFs(false);
  }
  requestFs(byButton) {
    if (!byButton && /[?&]nofs=1/.test(location.search)) return;
    const el = document.documentElement;
    if (fsElement()) return;
    try {
      let p = null;
      if (el.requestFullscreen) p = el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) p = el.webkitRequestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* not allowed here */ }
  }
  toggleFullscreen() {
    if (fsElement()) {
      this.fullscreenDeclined = true;
      try { const p = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (p && p.catch) p.catch(() => {}); } catch (e) { /* already left */ }
    } else { this.fullscreenDeclined = false; this.requestFs(true); }
  }
}

function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function fsSupported() { const el = document.documentElement; return !!(el.requestFullscreen || el.webkitRequestFullscreen); }

function countBits(m) { let n = 0; for (let i = 0; i < 10; i++) if (m & (1 << i)) n++; return n; }

// Strikes, spares, open frames and splits from a bowler's score sheet. Only the frames the
// game type plays count: 10th Frame starts at frame 10, Short Game n at frame 11 - n
// (LanedataUtil::FirstBallOfSerie); the frames before are not played, not open.
export function frameStats(p) {
  let strikes = 0, spares = 0, opens = 0, splits = 0;
  const s = p.score;
  const first = firstBallOfSerie(p.scoreMode);
  const scored = (i) => i >= first && i < p.activeSquare;
  for (let f = 0; f < 9; f++) {
    const a = f * 2;
    if (!scored(a)) continue;
    if ((p.scoreMode & GCI.SCORING_369) && (a === 4 || a === 10 || a === 16) && p.pinConfig[a] === 0 && p.timeOfThrow[a] === 0) { strikes++; continue; }
    if (s[a] === 10) { strikes++; continue; }
    if (p.status[a] & 1) splits++;
    if (scored(a + 1)) { if (s[a] + s[a + 1] === 10) spares++; else opens++; }
  }
  // frame 10
  if (scored(18)) {
    if (s[18] === 10) { strikes++; if (scored(19)) { if (s[19] === 10) { strikes++; if (scored(20) && s[20] === 10) strikes++; } else if (scored(20) && s[19] + s[20] === 10) spares++; } }
    else { if (p.status[18] & 1) splits++; if (scored(19)) { if (s[18] + s[19] === 10) { spares++; if (scored(20) && s[20] === 10) strikes++; } else opens++; } }
  }
  return { strikes, spares, opens, splits };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export { escapeHtml };

const app = new App();
app.syncMenu();
loadConsoleTexts().then(() => app.applyTexts());

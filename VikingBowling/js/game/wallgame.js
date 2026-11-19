// ---------------------------------------------------------------------------
// wallgame.js - the TV wall, the lane consoles, the bumpers and the warm-up, put into the game's
// App (main.js) in one place: installWallGame(app, $, store) from the App's constructor.
//
//   app.bumpers      the 3D bumper rails and their colliders (sim3d/bumpers.js, physics.js)
//   app.tvWall       one lane TV per lane in play (game/tvwall.js)
//   app.consoleHost  the lane console of each lane (game/consolehost.js, standin/console-standin.js)
//   app.tvMedia      the TV animations (game/tvmedia.js)
// and the hooks LaneGame and the stand-in LoadCom call: interruptThrow, consoleGate,
// reactToPractice, loadcom.onConsoleChange, loadcom.consoleHall (the pinsetter's Reset/Set).
// ---------------------------------------------------------------------------
import { GCI, countPins } from '../engine/openplay.js';
import { gameEvents } from './events.js';
import { Bumpers3D } from '../sim3d/bumpers.js';
import { TvWall } from './tvwall.js';
import { ConsoleHost } from './consolehost.js';
import { TvMedia } from './tvmedia.js';
import { withoutBumperMark, usesBumpers } from '../engine/correction.js';
import { WARM_OPTIONS, WARM_IDS, warmChoice, warmLabel, vbstPractice } from './warmup.js';
import { t } from '../i18n.js';

export { WARM_OPTIONS, WARM_IDS, warmChoice, warmLabel, vbstPractice };

export function installWallGame(app, $, store) {
  app.store = store;
  // ---- bumpers ----
  app.bumpers = new Bumpers3D(app.scene, app.physics);
  app.bumpers.onFirstUp = () => {
    if (store.get('bumperHint', false)) return;
    store.set('bumperHint', true);
    app.toast(t('bumpHint'), 8000, 'hint');
  };
  app.physics.forEach((ph, i) => {
    ph.onBumper = (speed) => gameEvents.emit('bumperHit', { lane: app.activeLane && app.activeLane.slot === i ? app.activeLane.number : app.slots[i].number, speed });
  });
  // ---- the TV wall, the consoles, the TV animations ----
  app.tvWall = new TvWall(app, $('#tvStrip'));
  app.consoleHost = new ConsoleHost(app, { box: $('#consoleBox'), frame: $('#consoleFrame'), tabs: $('#consoleTabs'), close: $('#consoleClose'), title: $('#consoleTitle') });
  app.tvMedia = new TvMedia(app);
  app.loadcom.compactImage = (lane) => app.tvWall.imageUrl(lane);
  $('#btnConsole').addEventListener('click', () => app.consoleHost.open());

  // ---- the hooks LaneGame calls ----
  app.consoleGate = () => app.consoleHost.gate();
  app.interruptThrow = () => {
    if (!app.throwResolve) return;
    const r = app.throwResolve;
    app.throwResolve = null;
    app.input.disable();
    app.scene.showAimPath(0, null);
    r(null);
  };
  app.reactToPractice = () => { /* practice balls are not celebrated: the TV shows the practice box */ };

  // A console command changed a lane: the lane the player bowls on goes through LaneGame (the TV,
  // the bumpers, the warm-up's end, the throw asked again); another lane of a competition through
  // the VBS-T session
  app.loadcom.onConsoleChange = (lane, kind, detail) => {
    if (kind === 'correction') {
      const entry = app.loadcom.lanes.get(lane);
      const pis = entry && entry.get();
      const p = pis && detail ? pis.player[detail.player] : null;
      const frame = detail && detail.changed.length ? Math.min(10, Math.floor(detail.changed[0][0] / 2) + 1) : 0;
      gameEvents.emit('correction', { lane, player: p ? withoutBumperMark(p.playerName) : '', frame });
    }
    const lg = app.laneGame;
    const lanes = kind === 'endPractice' && detail ? detail.lanes : [lane];
    if (lg && !lg.stopped && lg.lanes.some((l) => lanes.includes(l.number))) lg.externalChange('console');
    else if (app.onOtherLaneChange) app.onOtherLaneChange(lane, kind);
    for (const l of lanes) app.tvWall.changed(l);
  };

  // The pinsetter's commands from the console (Reset/Set), on the lanes the player bowls on
  app.loadcom.consoleHall = (lane, name, q) => {
    const lg = app.laneGame;
    const L = lg && !lg.stopped ? lg.laneInfo(lane) : null;
    if (!L) return null;
    if (name === 'lastPlayedPinPattern') return { pinPattern: String(lg.rack.get(lane) ?? 0x3FF) };
    if (name === 'ResetPin') {              // LC_MACHINECTRL_RESET: a new rack
      lg.rack.set(lane, 0x3FF);
      if (lg.pending && lg.pending.lane === lane) app.interruptThrow();
      return { success: 'true' };
    }
    if (name === 'SetPin') {                // the machine sets these pins (a second ball's rack)
      const m = (parseInt(q.PinPattern, 10) || 0) & 0x3FF;
      lg.rack.set(lane, m || 0x3FF);
      if (lg.pending && lg.pending.lane === lane) app.interruptThrow();
      return { success: 'true' };
    }
    return null;
  };

  // ---- the names screen: the bumper toggles ----
  $('#robotList').addEventListener('change', (e) => {
    const box = e.target.closest('input[data-bump]');
    if (!box || !app.robots) return;
    const r = app.robots[+box.dataset.bump];
    if (r) r.bumpers = box.checked;
  });
  $('#humanBump').addEventListener('change', (e) => { app.settings.bump = e.target.checked; app.save(); });

  // ---- the warm-up choices ----
  const fill = () => {
    const opts = WARM_OPTIONS.map((o) => `<option value="${o.id}">${warmLabel(o.method, o.amount)}</option>`).join('');
    $('#optWarm').innerHTML = opts;
    $('#optWarm').value = app.settings.warm || 'none';
    $('#optWarmV').innerHTML = `<option value="format">${t('warmFormat')}</option>` + opts;
    $('#optWarmV').value = app.settings.warmV || 'format';
    $('#humanBump').checked = !!app.settings.bump;
    $('#btnConsole').title = t('conButton');
    $('#btnConsole').setAttribute('aria-label', t('conButton'));
  };
  $('#optWarm').addEventListener('change', (e) => { app.settings.warm = e.target.value; app.save(); });
  $('#optWarmV').addEventListener('change', (e) => { app.settings.warmV = e.target.value; app.save(); });
  app.fillWallTexts = fill;
  fill();

  // ---- wrapped App methods ----
  const prepare = app.prepareLanes.bind(app);
  app.prepareLanes = (lanes, eng) => {
    prepare(lanes, eng);
    for (const L of lanes) { const e = app.loadcom.lanes.get(L.number); if (e) e.engine = eng; }
    app.bumpers.reset();
    app.consoleHost.close();
    app.tvWall.setup(lanes.map((L) => L.number), lanes.map((L) => L.number));
    app.consoleHost.setLanes(lanes.map((L) => L.number));
    // American play: OpenPlay's adjustBumper leaves the rails alone in cross lane play
    const bumperPlayer = eng.lanes.some((pis) => pis.player.slice(0, pis.noPlayers).some((p) => usesBumpers(p.playerName)));
    if (bumperPlayer && eng.isCrosslane()) setTimeout(() => app.toast(t('bumpAmr'), 6000), 3800);
  };
  // the player's own bumper toggle belongs to open play (a competition has no bumpers)
  const toNames = app.toNames.bind(app);
  app.toNames = async () => { await toNames(); $('#humanBump').closest('label').hidden = app.mode === 'vbst'; };
  // every lane in play, after the competition has attached its other lanes
  app.wallSetup = (allLanes, humanLanes) => {
    app.tvWall.setup(allLanes, humanLanes);
    app.consoleHost.setLanes([...humanLanes, ...allLanes]);
  };
  // the large TV follows the lane being bowled (an American pair): the small TVs show the others
  const focusLane = app.focusLane.bind(app);
  app.focusLane = (n) => { focusLane(n); if (app.tvWall.views.has(n)) app.tvWall.setBig(n); };
  const quit = app.quit.bind(app);
  app.quit = () => {
    const lg = app.laneGame;
    if (lg && lg.warm) lg.lanes.forEach((l, i) => { if (lg.warm[i]) gameEvents.emit('practiceEnd', { lane: l.number, reason: 'quit' }); });
    if (lg) lg.stopPracticeClock();
    app.consoleHost.close();
    quit();
    app.bumpers.reset();
  };
  const applyTexts = app.applyTexts.bind(app);
  app.applyTexts = () => { applyTexts(); fill(); };
}

export { countPins };

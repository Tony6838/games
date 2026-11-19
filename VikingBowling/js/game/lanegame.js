// ---------------------------------------------------------------------------
// lanegame.js - one serie on the lanes the player sees, ball by ball.
//
// The scoring is the OpenPlay engine (js/engine/openplay.js); every ball goes to it as a
// pinsetter reports one - the mask of pins left standing and the pins down in the frame -
// and after every ball the lane file goes to the lane TV through the stand-in LoadCom.
// The human's ball is a real physics throw; a machine player's pinfall is drawn from its
// statistics first (js/ai/bots.js) and then bowled in 3D so that the pins fall that way.
// ---------------------------------------------------------------------------
import { LanePhysics, LANE, PIN_SPOTS } from '../sim3d/physics.js';
import { STANCE } from '../sim3d/input.js';
import { GCI, countPins, globCheckSplit } from '../engine/openplay.js';
import { mirrorMask } from '../ai/bots.js';
import { t } from '../i18n.js';
import { gameEvents } from './events.js';
import { usesBumpers, withoutBumperMark } from '../engine/correction.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// OpenPlay shows the stop picture of a warm-up on time for 30 s (TestFrames_UpdateClock)
// before it wipes the practice balls and the serie starts
export const PRACTICE_STOP_PICTURE_MS = 30000;
const PRACTICE_MODES = { [GCI.PRACTICE_BALLS]: 'balls', [GCI.PRACTICE_FRAMES]: 'frames', [GCI.PRACTICE_MINUTES]: 'minutes' };

// How a machine player bowls: speed, hook and where it stands, from its average
export function botStyle(bot) {
  const k = Math.max(0, Math.min(1, (bot.average - 90) / 135));
  const hand = bot.leftHanded ? -1 : 1;
  const side = (4 + k * 18) * hand;
  return { speed: 5.9 + k * 2.4, side, x0: hand * (0.04 + k * 0.2) };
}

function pinX(i) { return PIN_SPOTS[i][0]; }

// Where the ball must meet the head pin's row for this leave (right-handed; mirrored for left)
function targetForLeave(before, leave, firstBall, rng) {
  const fallen = before & ~leave;
  const n = (Math.random() - 0.5);
  if (firstBall) {
    if (leave === 0) return 0.115 + n * 0.015;
    if (leave & 1) {                                  // the head pin stands: the ball missed it
      let left = 0, right = 0;
      for (let i = 1; i < 10; i++) if (leave & (1 << i)) { if (pinX(i) < 0) left++; else if (pinX(i) > 0) right++; }
      return left >= right ? 0.2 + n * 0.04 : -0.19 + n * 0.04;
    }
    if (leave === (1 << 9)) return 0.135 + n * 0.01;  // the 10 pin: a light pocket
    if (leave === (1 << 6)) return 0.09 + n * 0.01;   // the 7 pin
    let sx = 0, c = 0;
    for (let i = 0; i < 10; i++) if (fallen & (1 << i)) { sx += pinX(i); c++; }
    const mean = c ? sx / c : 0;
    return Math.max(-0.2, Math.min(0.24, mean * 0.6 + 0.04 + n * 0.02));
  }
  // second ball: at the pins that go, or past the pins when nothing goes
  const pins = [];
  for (let i = 0; i < 10; i++) if (before & (1 << i)) pins.push(i);
  if (!fallen) {
    const key = pins[0];
    const side = pinX(key) >= 0 ? 1 : -1;
    return Math.max(-0.5, Math.min(0.5, pinX(key) + side * (0.19 + Math.abs(n) * 0.06)));
  }
  let sx = 0, c = 0;
  for (let i = 0; i < 10; i++) if (fallen & (1 << i)) { sx += pinX(i); c++; }
  return sx / c;
}

export class LaneGame {
  // lanes: [{ number, laneX, physics }]; who(lane, index, player) -> { name, human, bot }
  constructor(app, { engine, lanes, who, onBall }) {
    this.app = app;
    this.engine = engine;
    this.lanes = lanes;
    this.who = who;
    this.onBall = onBall || (() => {});
    this.turn = lanes[0].number;
    this.rack = new Map(lanes.map((l) => [l.number, 0x3FF]));
    this.kind = new Map();
    this.stopped = false;
    this.warm = lanes.map(() => false);     // which lanes are in their warm-up
    this.pending = null;                    // the player's throw being waited for: { lane, index }
    app.laneGame = this;                    // the console stand-in reports its changes here
  }

  laneInfo(n) { return this.lanes.find((l) => l.number === n); }

  // Which lane bowls next: the one lane, or the pair taking turns
  nextLane() {
    const order = this.lanes.length > 1 ? [this.turn, this.lanes.find((l) => l.number !== this.turn).number] : [this.lanes[0].number];
    for (const n of order) if (this.engine.activeOn(n)) return n;
    return null;
  }

  async run() {
    const app = this.app, eng = this.engine;
    for (const l of this.lanes) { l.physics.resetPins(0x3FF); app.syncLane(l, this.redPinOn(l.number)); }
    app.pushTv(this.lanes.map((l) => l.number));
    gameEvents.emit('gameStart', { lanes: this.lanes.map((l) => l.number) });
    this.warm = this.lanes.map((l) => eng.isWarmUp(l.number));
    this.lanes.forEach((l, i) => { if (this.warm[i]) gameEvents.emit('practiceStart', this.practiceDetail(l.number)); });
    if (this.warm.some(Boolean)) { this.startPracticeClock(); app.toast(t('warmStart'), 3600); }
    this.adjustBumpers();                   // CGame::StartGame -> RefreshGame -> adjustBumper
    while (!this.stopped) {
      const laneNo = this.nextLane();
      if (!laneNo) break;
      if (this.lanes.length > 1) this.turn = this.lanes.find((l) => l.number !== laneNo).number;
      await this.ball(laneNo);
    }
    this.stopPracticeClock();
    app.input.disable();
    if (!this.stopped) gameEvents.emit('gameEnd', { lanes: this.lanes.map((l) => l.number) });
    return !this.stopped;
  }

  // The red head pin: not while practice balls are played (LanedataUtil::RedPinShown)
  redPinOn(laneNo) {
    const pis = this.engine.getPlayerInfoStruct(laneNo);
    return !!pis && pis.RedPin === 1 && !this.engine.isWarmUp(laneNo);
  }

  // ---- the warm-up ------------------------------------------------------------------------
  practiceDetail(laneNo) {
    const pis = this.engine.getPlayerInfoStruct(laneNo);
    const left = this.engine.practiceLeft(laneNo);
    return { lane: laneNo, mode: PRACTICE_MODES[pis.practiceMethod] || 'minutes', amount: pis.practiceAmount,
      balls: pis.practiceMethod === GCI.PRACTICE_BALLS ? pis.practiceAmount : 0,
      minutes: pis.practiceMethod === GCI.PRACTICE_MINUTES ? pis.practiceAmount : 0, left: left ? left.left : 0 };
  }
  // The status line during the warm-up: what is left of it, as the game counts it
  practiceText(laneNo) {
    const left = this.engine.practiceLeft(laneNo);
    if (!left) return '';
    if (left.method === GCI.PRACTICE_BALLS) return t('warmBallsLeft', { n: left.left });
    if (left.method === GCI.PRACTICE_FRAMES) return t('warmFramesLeft', { n: left.left });
    const s = Math.max(0, left.left);
    return s > 0 ? t('warmTimeLeft', { t: Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }) : t('warmOverSoon');
  }
  // OpenPlay's clock thread for a warm-up on time: from 3 s after the start, the end once the time
  // is up - the stop picture (GCI_PracticeOver), then 30 s later the serie
  startPracticeClock() {
    const app = this.app, eng = this.engine, t0 = Date.now();
    this.practiceTimer = setInterval(() => {
      if (this.stopped) return;
      if (this.pending && this.warm.some(Boolean)) app.status(this.practiceText(this.pending.lane) + ' · ' + t('yourTurn'), true);
      if (Date.now() - t0 < 3000 || this.overAt) return;
      const timed = eng.lanes.find((p) => p.practiceMethod === GCI.PRACTICE_MINUTES && p.laneStatus === GCI.Practice);
      if (!timed || eng.practiceSecondsLeft(timed.laneNumber) > 0) return;
      this.overAt = Date.now();
      for (const l of eng.practiceClockOver()) app.loadcom.setMask(l, GCI.MASKPIC_STOP_PRACTICE);
      app.pushTv(this.lanes.map((l) => l.number));
      this.practiceFinish = setTimeout(() => {
        if (this.stopped) return;
        for (const l of eng.practiceClockFinish()) app.loadcom.setMask(l, 0);
        this.externalChange('clock');
      }, app.practiceStopMs || PRACTICE_STOP_PICTURE_MS);
    }, 1000);
  }
  stopPracticeClock() { clearInterval(this.practiceTimer); clearTimeout(this.practiceFinish); }
  // The warm-up has ended on some lanes: events, the stop picture off, a full rack, RedPin
  // drawn again (it is held while practice balls are played), the TV and a toast
  practiceEnded(reason) {
    const app = this.app, eng = this.engine;
    const now = this.lanes.map((l) => eng.isWarmUp(l.number));
    let any = false;
    this.lanes.forEach((l, i) => {
      if (!this.warm[i] || now[i]) return;
      any = true;
      app.loadcom.setMask(l.number, 0);
      this.rack.set(l.number, 0x3FF);
      const pis = eng.getPlayerInfoStruct(l.number);
      if (pis.RedPin) eng.randomRedPin(pis);
      gameEvents.emit('practiceEnd', { lane: l.number, reason });
    });
    this.warm = now;
    if (!any) return;
    if (!now.some(Boolean)) this.stopPracticeClock();
    for (const ev of eng.events.splice(0)) app.loadcom.playAnimation(ev.lane, ev.media);
    app.toast(t('warmOver'), 3200);
  }

  // ---- the bumpers (CGameAbstract::adjustBumper) ---------------------------------------------
  // Up for a bowler whose name carries the bumper mark (+C), down for the others; only outside
  // cross lane play, as OpenPlay does. Called where OpenPlay calls it: at the start, after a
  // scored ball that did not end the game, and after a refresh (the console's changes) - not
  // during the warm-up, whose balls OpenPlay scores without it (TestFrames_Score, TestBalls_Score).
  adjustBumpers() {
    const app = this.app, eng = this.engine;
    if (!app.bumpers || eng.isCrosslane()) return;
    for (const L of this.lanes) {
      const a = eng.activeOn(L.number);
      if (!a) continue;
      app.bumpers.set(L.slot, usesBumpers(a.player.playerName), { lane: L.number, player: withoutBumperMark(a.player.playerName) });
    }
  }

  // The lane was changed from outside the ball loop - the console (a correction, End practice,
  // the player list) or the warm-up clock: the TV, the warm-up's end, the bumpers, and the
  // player's throw is asked for again (the bowler up, or the rack, may have changed)
  externalChange(reason) {
    if (this.stopped) return;
    const app = this.app;
    if (this.warm.some(Boolean)) this.practiceEnded(reason === 'console' ? 'console' : 'done');
    if (reason !== 'clock') this.adjustBumpers();
    app.pushTv(this.lanes.map((l) => l.number));
    if (this.pending) app.interruptThrow();
  }

  // ---- after every scored ball ----------------------------------------------------------------
  afterScore(laneNo, res, who, before, after, result) {
    const app = this.app, eng = this.engine;
    for (const ev of eng.events.splice(0)) app.loadcom.playAnimation(ev.lane, ev.media);    // RedPin (LC_PLAY_ANIMATION)
    if (!res.practice && app.tvMedia) app.tvMedia.scored(laneNo, res, eng);                 // the exciter's TV animation
    this.emitBall(laneNo, res, who, before, after, result);
    if (!res.practice && !res.gameFinished) this.adjustBumpers();
    if (this.warm.some(Boolean)) this.practiceEnded('done');
    app.pushTv(this.lanes.map((l) => l.number));
  }

  emitBall(laneNo, res, who, before, after, result) {
    const p = res.player;
    const base = { lane: laneNo, player: p ? withoutBumperMark(p.playerName) : (who.name || ''), index: res.playerIndex,
      human: !!who.human, bot: !who.human };
    const practice = !!res.practice;
    gameEvents.emit('ball', { ...base, firstBall: res.firstBall, pins: res.ballPins, before, standing: after, exciter: res.exciter, practice });
    const zero = res.ballPins === 0, inGutter = !!(result && result.gutter);
    if (zero && (res.firstBall || inGutter)) gameEvents.emit('gutter', { ...base, practice });
    else if (zero && !res.firstBall && !practice) gameEvents.emit('miss', base);
    if (practice) return;
    if (res.exciter === GCI.EXCITER_STRIKE) gameEvents.emit('strike', { ...base, inARow: res.numInARow, redPin: !!res.redPinStrike });
    else if (res.exciter === GCI.EXCITER_SPARE || res.exciter === GCI.EXCITER_SPMAKE) gameEvents.emit('spare', base);
    else if (res.exciter === GCI.EXCITER_SPLIT) gameEvents.emit('split', { ...base, standing: after });
  }

  async ball(laneNo) {
    const app = this.app, eng = this.engine;
    const L = this.laneInfo(laneNo);
    const phys = L.physics;
    const active = eng.activeOn(laneNo);
    const who = this.who(laneNo, active.index, active.player);
    const first = eng.nextBallIsFirst(laneNo);
    const before = first ? 0x3FF : this.rack.get(laneNo);
    phys.state = 'idle';               // whatever a quit game left rolling
    phys.resetPins(before);
    app.focusLane(laneNo);
    app.scene.aimView(L.laneX, app.scene.portrait);
    app.activeLane = L;
    app.syncLane(L, this.redPinOn(laneNo));

    // "instant": every ball, the player's too, decided by a machine player and scored at
    // once, without the 3D throw (the automated screenshot and test runs use it)
    const practising = eng.isWarmUp(laneNo);
    const bumpersOn = !!(app.bumpers && app.bumpers.isUp(L.slot));
    phys.setBumpers && phys.setBumpers(bumpersOn);
    if (app.instant) {
      const bot = who.bot || app.instantBot;
      bot.bumpers = bumpersOn;
      let after;
      if (first) { const f = bot.firstBall(); after = f.standing; this.kind.set(laneNo, f.kind); }
      else after = bot.secondBall(before, this.kind.get(laneNo)) & before;
      const res = eng.scoreBall(laneNo, after, 10 - countPins(after), 0, false);
      if (res) {
        this.afterScore(laneNo, res, who, before, after, null);
        this.onBall(res, laneNo, who);
      }
      this.rack.set(laneNo, eng.nextBallIsFirst(laneNo) ? 0x3FF : after);
      await sleep(15);
      return;
    }

    let params, forced = null, leave = null;
    if (who.human) {
      app.status((practising ? this.practiceText(laneNo) + ' · ' : '') + t('yourTurn'), true);
      // the ball waits where the player stands (placed with a long press or the arrow keys)
      const x0 = app.humanX0 || 0, z0 = app.humanZ0 || STANCE.zMin;
      phys.ball.position.set(L.laneX + x0, LANE.ballRadius, z0);
      phys.ball.velocity.setZero(); phys.ball.angularVelocity.setZero();
      this.pending = { lane: laneNo, index: active.index };
      params = await app.waitForThrow(L);
      this.pending = null;
      // asked again: the console changed the lane while the player was aiming
      if (this.stopped || !params) return;
      app.status(t('rolling'), true);
    } else {
      // the bowlers wait while somebody is at the lane console
      if (app.consoleGate) await app.consoleGate(laneNo);
      if (this.stopped) return;
      // the gate may have been held across a change: the bowler up is asked again
      const now = eng.activeOn(laneNo);
      if (!now || now.index !== active.index || eng.nextBallIsFirst(laneNo) !== first) return;
      app.status((practising ? this.practiceText(laneNo) + ' · ' : '') + t('throwing', { name: who.name }), false);
      const bot = who.bot;
      bot.bumpers = bumpersOn;          // a machine player with bumpers up throws no gutter ball
      if (first) { const f = bot.firstBall(); leave = f.standing; this.kind.set(laneNo, f.kind); }
      else leave = bot.secondBall(before, this.kind.get(laneNo));
      leave &= before;
      params = this.planBot(bot, before, leave, first, bumpersOn && this.kind.get(laneNo) === 'bumper' && first);
      forced = { leave };
      phys.ball.position.set(L.laneX + params.x0, LANE.ballRadius, 0.35);
      app.syncLane(L, this.redPinOn(laneNo));
      // warm-up balls quickly: a practice turn is not waited for
      await sleep(practising ? (app.fast ? 80 : 250) : (app.fast ? 150 : 650));
      if (this.stopped) return;
    }
    phys.practiceFast = practising && !who.human;
    app.sound.startRoll({ lane: L, who, first, before, player: active.player });   // js/audio: who bowls, the rack
    phys.human = !!who.human;           // ⏩ speeds up the machine players' balls only
    phys.release({ ...params, forced });
    const result = await app.watchBall(L);
    app.sound.stopRoll();
    if (this.stopped) return;
    // The lane changed while the ball rolled - End practice on the console or the warm-up clock
    // ended the warm-up, or the console changed the bowler up: the ball was bowled for a turn that
    // is over, so it is not scored. A practice ball must never land on the serie's sheet (the serie
    // starts with its first bowler and a full rack), and a ball must not go to another bowler.
    const upNow = eng.activeOn(laneNo);
    if ((practising && !eng.isWarmUp(laneNo)) || !upNow || upNow.index !== active.index || eng.nextBallIsFirst(laneNo) !== first) return;
    let after = forced ? leave : phys.standingMask();
    after &= before;
    const fallenCum = 10 - countPins(after);
    // the ball speed as a lane measures it: the average from the foul line to the pins, in the
    // lane's true scale (18.29 m to the head pin)
    const ls = phys.laneSpeed();
    const kmh = Math.round((ls || (phys.entry ? phys.entry.speed : params.speed * 0.85)) * 3.6 * 10) / 10;
    app.speedo(kmh);
    const res = eng.scoreBall(laneNo, after, fallenCum, kmh, false);
    if (!res) return;
    if (!who.human && this.kind.get(laneNo) === undefined) this.kind.set(laneNo, 'multi');
    // the pinsetter: a new rack after a finished frame, else the standing pins stay
    this.rack.set(laneNo, eng.nextBallIsFirst(laneNo) ? 0x3FF : after);
    this.afterScore(laneNo, res, who, before, after, result);
    if (res.practice) app.reactToPractice && app.reactToPractice(res, who, before, after, result);
    else app.reactTo(res, who, before, after, result);
    this.onBall(res, laneNo, who);
    await sleep(res.practice && !who.human ? (app.fast ? 150 : 600) : (app.fast ? 300 : 1300));
  }

  // A release that brings the machine player's ball where its pinfall says it went
  planBot(bot, before, leave, first, bumperBall = false) {
    const st = botStyle(bot);
    const lefty = bot.leftHanded;
    const own = (m) => (lefty ? mirrorMask(m) : m);
    // a ball that would have gone into the gutter, with the bumpers up: it runs into a bumper
    // half way down, comes off it and goes on into the pins
    if (bumperBall) {
      const side = (leave & 0x2A4) ? -1 : 1;    // the side the leave is not on (pins 3, 6, 10 standing: hit the left one)
      return { x0: side * 0.28, speed: st.speed * 0.85, angle: side * 0.024, side: 0, roll: 0.3 };
    }
    // a gutter ball: off the edge of the lane
    if (first && leave === 0x3FF) {
      const side = Math.random() < 0.5 ? -1 : 1;
      return { x0: side * 0.33, speed: st.speed * 0.9, angle: side * 0.02, side: 0, roll: 0.3 };
    }
    let target = targetForLeave(own(before), own(leave), first);
    if (lefty) target = -target;
    const spare = !first;
    const side = spare ? st.side * 0.25 : st.side * (0.9 + Math.random() * 0.2);
    const x0 = spare ? Math.max(-0.35, Math.min(0.35, -Math.sign(target || 1) * 0.12)) : st.x0;
    const aim = LanePhysics.aim({ targetX: target, x0, speed: st.speed * (0.97 + Math.random() * 0.06), side, roll: 0.5 });
    return aim;
  }

  stop() { this.stopped = true; }
}

export { globCheckSplit };

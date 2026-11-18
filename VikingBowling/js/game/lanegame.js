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
import { GCI, countPins, globCheckSplit } from '../engine/openplay.js';
import { mirrorMask } from '../ai/bots.js';
import { t } from '../i18n.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  }

  laneInfo(n) { return this.lanes.find((l) => l.number === n); }

  // Which lane bowls next: the one lane, or the pair taking turns
  nextLane() {
    const order = this.lanes.length > 1 ? [this.turn, this.lanes.find((l) => l.number !== this.turn).number] : [this.lanes[0].number];
    for (const n of order) if (this.engine.activeOn(n)) return n;
    return null;
  }

  async run() {
    const app = this.app;
    for (const l of this.lanes) { l.physics.resetPins(0x3FF); app.syncLane(l, this.redPinOn(l.number)); }
    app.pushTv(this.lanes.map((l) => l.number));
    while (!this.stopped) {
      const laneNo = this.nextLane();
      if (!laneNo) break;
      if (this.lanes.length > 1) this.turn = this.lanes.find((l) => l.number !== laneNo).number;
      await this.ball(laneNo);
    }
    app.input.disable();
    return !this.stopped;
  }

  redPinOn(laneNo) {
    const pis = this.engine.getPlayerInfoStruct(laneNo);
    return pis && pis.RedPin === 1;
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
    if (app.instant) {
      const bot = who.bot || app.instantBot;
      let after;
      if (first) { const f = bot.firstBall(); after = f.standing; this.kind.set(laneNo, f.kind); }
      else after = bot.secondBall(before, this.kind.get(laneNo)) & before;
      const res = eng.score(laneNo, after, 10 - countPins(after), 0, false);
      for (const ev of eng.events.splice(0)) app.loadcom.playAnimation(ev.lane, ev.media);
      app.pushTv(this.lanes.map((l) => l.number));
      this.rack.set(laneNo, eng.nextBallIsFirst(laneNo) ? 0x3FF : after);
      void res;
      await sleep(15);
      return;
    }

    let params, forced = null, leave = null;
    if (who.human) {
      app.status(t('yourTurn'), true);
      const x0 = app.humanX0 || 0;
      phys.ball.position.set(L.laneX + x0, LANE.ballRadius, 0.35);
      phys.ball.velocity.setZero(); phys.ball.angularVelocity.setZero();
      params = await app.waitForThrow(L);
      if (this.stopped) return;
      app.status(t('rolling'), true);
    } else {
      app.status(t('throwing', { name: who.name }), false);
      const bot = who.bot;
      if (first) { const f = bot.firstBall(); leave = f.standing; this.kind.set(laneNo, f.kind); }
      else leave = bot.secondBall(before, this.kind.get(laneNo));
      leave &= before;
      params = this.planBot(bot, before, leave, first);
      forced = { leave };
      phys.ball.position.set(L.laneX + params.x0, LANE.ballRadius, 0.35);
      app.syncLane(L, this.redPinOn(laneNo));
      await sleep(app.fast ? 150 : 650);
      if (this.stopped) return;
    }
    app.sound.startRoll();
    phys.release({ ...params, forced });
    const result = await app.watchBall(L);
    app.sound.stopRoll();
    if (this.stopped) return;
    let after = forced ? leave : phys.standingMask();
    after &= before;
    const fallenCum = 10 - countPins(after);
    const kmh = Math.round((phys.entry ? phys.entry.speed : params.speed * 0.85) * 3.6 * 10) / 10;
    app.speedo(kmh);
    const res = eng.score(laneNo, after, fallenCum, kmh, false);
    if (!res) return;
    if (!who.human && this.kind.get(laneNo) === undefined) this.kind.set(laneNo, 'multi');
    for (const ev of eng.events.splice(0)) app.loadcom.playAnimation(ev.lane, ev.media);
    app.pushTv(this.lanes.map((l) => l.number));
    app.reactTo(res, who, before, after, result);
    this.onBall(res, laneNo, who);
    // the pinsetter: a new rack after a finished frame, else the standing pins stay
    this.rack.set(laneNo, eng.nextBallIsFirst(laneNo) ? 0x3FF : after);
    await sleep(app.fast ? 300 : 1300);
  }

  // A release that brings the machine player's ball where its pinfall says it went
  planBot(bot, before, leave, first) {
    const st = botStyle(bot);
    const lefty = bot.leftHanded;
    const own = (m) => (lefty ? mirrorMask(m) : m);
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

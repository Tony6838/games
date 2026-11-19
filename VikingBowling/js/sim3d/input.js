// ---------------------------------------------------------------------------
// input.js - the throw: a swipe with a finger or the mouse.
//
// Two gestures that cannot be mistaken for each other:
//   place   press and HOLD still (0.4 s), then drag: the ball follows the finger across
//           the approach (left/right) and back from the foul line (forward/back), like
//           choosing where to stand. Letting go places it; it never throws. The arrow keys
//           do the same (left/right, up/down).
//   throw   press and move at once. A swipe up towards the pins throws; it may start with
//           a pull-back (drag the ball back towards you first, a backswing): the pull-back's
//           length and speed add some power, capped. Letting go during the pull-back,
//           before any push forward, cancels: no throw.
// The forward swipe decides the throw:
//   speed   how fast the finger moved over the last 120 ms of the swipe, in physical units
//           (mm/s: CSS pixels over the device's pixels per millimetre), so the same finger
//           speed gives the same ball on a phone, a tablet and a desktop, in portrait and in
//           landscape; mapped on a logarithmic curve, see launchSpeed()
//   line    which way the swipe pointed (a few degrees either side)
//   hook    how much the swipe curved at the end: curve to the left and the ball hooks
//           left, as a right-hander's ball does; to the right, a left-hander's
// A swipe that is too short or too slow is not a throw ("too weak").
//
// Every sample is timed by the event's own clock (e.timeStamp: when the finger was there),
// not by when the page got round to handling it, and every point the browser coalesced
// into one pointermove is used. On a slow device (a few frames a second) the events of a
// swipe are handled in bursts, late; timed by performance.now() the swipe looked slow and
// was refused as too weak. The pointer-up only ends the gesture: it is not a sample.
// The hold that starts placing is decided by the same clock: a finger that had already
// moved within the hold time is a throw, even if its moves are handled after the hold timer.
// A browser whose main thread is that busy may also give up a touch's pointer stream
// (pointercancel) while it goes on delivering the same touch as touch events; the swipe
// then continues with those, and only a touchcancel really cancels it.
//
// On a phone or tablet with motion sensors the throw is by default a swing of the phone
// (js/sim3d/motion.js, the "Kast" setting: Auto / Rörelse / Svep); placing the ball (hold and
// drag, the arrow keys) works the same in both. A swing's speed is put on the swipe's own
// speed curve (motionParams below), so both give the same range of balls.
// Every throw released by the player, swipe or swing, is announced on the game's events
// (js/game/events.js) as 'throwRelease' { human: true, input: 'swipe' | 'motion', speed, angle, side }.
// ---------------------------------------------------------------------------
import { MOTION, MotionThrow, motionCapable, motionPossible, motionRefusedBefore } from './motion.js';
import { gameEvents } from '../game/events.js';

// Where the ball may stand: across the lane (m from its middle) and behind the foul line (m)
export const STANCE = { maxX: 0.42, zMin: 0.35, zMax: 4.4 };

// The gesture and the throw. Distances in mm and speeds in mm/s of the finger on the screen.
export const THROW = {
  holdMs: 400,          // press this long without moving to place the ball
  slopMm: 1.7,          // movement that still counts as holding still
  startMm: 5.5,         // movement up (or down: a pull-back) that starts a throw
  minSwingMm: 17,       // a forward swipe shorter than this is too weak
  weakMmS: 50,          // a forward swipe slower than this is too weak
  // launch speed (m/s) = vMin + vPerLn * ln(f / weakMmS), f clamped to weakMmS..topMmS:
  //   50 mm/s 3.3 (10 km/h down the lane), 170 mm/s 5.0, 400 mm/s 6.25, 700 mm/s 7.05,
  //   1200 mm/s 7.8, 2000 mm/s and faster 8.54 (29 km/h)
  vMin: 3.3, vPerLn: 1.42, topMmS: 2000,
  // the pull-back: up to boostMax m/s more, for a pull-back of boostFullMm at boostFullMmS
  boostMax: 0.9, boostFullMm: 30, boostFullMmS: 400,
  vCap: 9.0,            // the fastest ball, pull-back included
  // side rotation: the swipe's curve gives up to 20 rad/s; at sideRefSpeed it is sideAtRef of
  // that, and it grows with speed^sidePow (a quicker arm turns the ball more, but less than in
  // proportion: a slower ball still hooks further and enters the pins at a steeper angle)
  sideRefSpeed: 7.05, sideAtRef: 0.69, sidePow: 0.6,
  placeXPerMm: 0.0175,  // placing: metres across the lane per mm of finger travel (the lane's width in 48 mm)
  placeZPerMm: 0.074    // ... and metres back per mm (the stance's depth in 55 mm)
};

// The launch speed (m/s) for a finger speed (mm/s)
export function launchSpeed(fingerMmS) {
  const f = Math.max(THROW.weakMmS, Math.min(THROW.topMmS, fingerMmS));
  return THROW.vMin + THROW.vPerLn * Math.log(f / THROW.weakMmS);
}

// The share of the swipe's side rotation a ball of this launch speed gets
export function sideFactor(speed) {
  return THROW.sideAtRef * Math.pow(Math.max(0.1, speed) / THROW.sideRefSpeed, THROW.sidePow);
}

// A swing's rate (deg/s, the forward swing about the shoulder's axis) as the finger speed
// (mm/s) that gives the same ball: the weakest swing (MOTION.weakDps) is the weakest swipe
// (THROW.weakMmS), the fastest (MOTION.topDps) the fastest (THROW.topMmS), log-log linear between,
// so launchSpeed() makes 73 deg/s 3.3 m/s, 150 deg/s 4.8, 300 deg/s 6.25, 600 deg/s 7.7 and
// 900 deg/s and more 8.54 m/s (29 km/h), the swipe's range
export function motionFingerMmS(dps) {
  const r = Math.max(MOTION.weakDps, Math.min(MOTION.topDps, dps));
  const k = Math.log(THROW.topMmS / THROW.weakMmS) / Math.log(MOTION.topDps / MOTION.weakDps);
  return THROW.weakMmS * Math.pow(r / MOTION.weakDps, k);
}

// The line error of the release timing (rad, + = to the right): none inside the window around
// the bottom of the forward swing (MOTION.releaseEarlyDeg..releaseLateDeg degrees of swing), then
// growing over releaseRampDeg to releaseMaxRad (3 boards at the arrows): early pushes the ball
// right, late pulls it left
export function releaseLineError(releaseDeg) {
  const d = releaseDeg || 0;
  if (d < MOTION.releaseEarlyDeg) return MOTION.releaseMaxRad * Math.min(1, (MOTION.releaseEarlyDeg - d) / MOTION.releaseRampDeg);
  if (d > MOTION.releaseLateDeg) return -MOTION.releaseMaxRad * Math.min(1, (d - MOTION.releaseLateDeg) / MOTION.releaseRampDeg);
  return 0;
}

// The aim at the lane's arrows (15 ft): from the ball's board x0 (m from the lane's middle, +
// right), the phone turned aimYaw degrees (+ = left) moves the target MOTION.aimBoardsPerDeg boards
// a degree, within board 5 (right) to 35 (left), boards counted from the right as a right-hander
// does. Returns the target's x at the arrows, its board and the launch angle (rad, + right) to it.
export function aimAt(aimYaw, x0 = 0) {
  const bw = MOTION.boardM, half = 39 * bw / 2;
  const xOf = (board) => half - (board - 0.5) * bw;
  const x = clamp(x0 - (aimYaw || 0) * MOTION.aimBoardsPerDeg * bw, xOf(MOTION.aimMaxBoard), xOf(MOTION.aimMinBoard));
  return { x, board: Math.round((half - x) / bw + 0.5), angle: Math.atan2(x - x0, MOTION.arrowsM) };
}

// The throw for a swing (motion.js analyzeSwing): speed from the forward swing's rate; the line is
// the locked aim (aimAt), plus the turning during the swing as a pull or a push (a dead zone and
// MOTION.pullPerRad), plus the release timing's error; hook from the wrist's turn (- = a
// right-hander's: positive side rotation), a dead zone and then the swipe's 18 per rad of curve,
// scaled by sideFactor as a swipe's is
export function motionParams(a, x0 = 0, z0 = STANCE.zMin) {
  const dead = (v, d) => Math.sign(v) * Math.max(0, Math.abs(v) - d);
  const speed = Math.min(THROW.vCap, launchSpeed(motionFingerMmS(a.rate)));
  const timing = releaseLineError(a.releaseDeg);
  const aim = aimAt(a.aimYaw || 0, x0);
  const pull = -dead(a.heading || 0, MOTION.pullDeadDeg) * Math.PI / 180 * MOTION.pullPerRad;
  const angle = clamp(aim.angle + pull + timing, -MOTION.angleMax, MOTION.angleMax);
  const side = clamp(-dead(a.twist, MOTION.twistDeadDeg) * Math.PI / 180 * MOTION.sidePerRad, -20, 20) * sideFactor(speed);
  return { x0, z0, speed, angle, side, roll: 0.5, input: 'motion', swingDps: a.rate, heading: a.heading, twist: a.twist, releaseDeg: a.releaseDeg || 0, timingRad: timing,
    aimYaw: a.aimYaw || 0, aimBoard: aim.board, aimAngle: aim.angle, pullRad: pull };
}

// CSS pixels per millimetre of screen, for turning a swipe into a physical finger speed.
// CSS pixels are about the same size on every phone (about 6 per mm) and a little larger on
// tablets (about 5.2); a touch screen on a desktop or laptop has about 96 per inch (4 per mm).
// A mouse is taken as a finger on a phone: its swipes cover the same pixels per second.
export function cssPxPerMm(pointerType) {
  if (!pointerType || pointerType === 'mouse') return 6.0;
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1;
  if (!(/Android|iPhone|iPad|iPod|Mobile/.test(ua) || iPadOS)) return 4.0;
  const sc = typeof screen !== 'undefined' ? screen : null;
  const short = sc ? Math.min(sc.width || 0, sc.height || 0) : 0;
  return short > 0 && short < 600 ? 6.0 : 5.2;
}

// The time of an input event on performance.now()'s clock; an event without a usable
// timeStamp (a synthetic one, or an old browser's epoch time) is timed now
function stamp(e) {
  const t = e && e.timeStamp;
  return typeof t === 'number' && t > 0 && t < 1e11 ? t : performance.now();
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A world point on the screen (CSS px) through a three.js camera's matrices; null behind it
function projectPoint(cam, x, y, z, w, h) {
  const m = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
  const vx = m[0] * x + m[4] * y + m[8] * z + m[12], vy = m[1] * x + m[5] * y + m[9] * z + m[13], vz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12], cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13], cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
  if (!(cw > 0)) return null;
  return { x: (cx / cw * 0.5 + 0.5) * w, y: (0.5 - cy / cw * 0.5) * h };
}

export class SwipeInput {
  constructor(element, overlay, handlers) {
    this.el = element;
    this.overlay = overlay;               // a canvas over the 3D view for the trail
    this.h = handlers;                    // { onPosition(x0, z0), onThrow(params), onAim(partial), onWeak(), onMisplace(),
                                          //   onHint(i18nKey, ms), onChooseSwipe(), onModeChange() }
    this.enabled = false;
    this.useMotion = false;               // the throw is a swing of the phone (motion.js), not a swipe
    this.motion = null;
    this.samples = [];
    this.x0 = 0;
    this.z0 = STANCE.zMin;
    this.maxX = STANCE.maxX;
    this.pxmm = 6;
    this.ctx = overlay.getContext('2d');
    element.addEventListener('pointerdown', (e) => this.down(e));
    // a long press must not open the browser's menu
    element.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.pointerCancel(e));
    window.addEventListener('touchmove', (e) => this.touchMove(e), { passive: true });
    window.addEventListener('touchend', (e) => this.touchEnd(e), { passive: true });
    window.addEventListener('touchcancel', () => { if (this.viaTouch) this.cancel(); }, { passive: true });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  enable(x0 = 0, z0 = STANCE.zMin) {
    this.enabled = true;
    this.x0 = clamp(x0, -this.maxX, this.maxX);
    this.z0 = clamp(z0, STANCE.zMin, STANCE.zMax);
    this.clearTrail();
    if (this.useMotion && !this.motion.show()) this.useMotion = false;
  }
  disable() { this.enabled = false; this.active = false; this.clearHold(); this.clearTrail(); if (this.motion) this.motion.hide(); }

  // The way to throw: 'auto' (a swing on a phone or tablet with motion sensors, unless they were
  // found missing or refused here before; else the swipe), 'motion' or 'swipe'. retry: the
  // player chose 'motion' again after it failed on this page.
  setMode(mode, retry = false) {
    this.modeSetting = mode;
    const want = mode === 'motion' ? motionPossible() : mode === 'auto' ? motionCapable() && !motionRefusedBefore() : false;
    if (want) this.makeMotion();
    if (retry && mode === 'motion' && this.motion && this.motion.state === 'failed') this.motion.state = 'off';
    const was = this.useMotion;
    this.useMotion = !!(want && this.motion && this.motion.state !== 'failed');
    if (this.enabled && was !== this.useMotion) {
      if (this.useMotion) { if (!this.motion.show()) this.useMotion = false; }
      else if (this.motion) this.motion.hide();
    }
  }
  makeMotion() {
    if (!this.motion) {
      this.motion = new MotionThrow({
        onThrow: (a) => this.motionThrow(a),
        onAimTarget: (yaw, locked) => this.showAim(yaw, locked),
        onHint: (key, ms) => this.hint(key, ms),
        onFallback: (key) => this.motionFailed(key),
        onRecover: () => this.motionRecovered(),
        onChooseSwipe: () => this.h.onChooseSwipe && this.h.onChooseSwipe()
      });
    }
    return this.motion;
  }
  // "Visa svingdemo" in the settings
  playDemo() { if (motionPossible()) this.makeMotion().playDemo(); }
  // the motion sensors off while no throw can come (the menus, the standings, the summary)
  pauseSensors() { if (this.motion) this.motion.pause(); }
  usingMotion() { return this.useMotion; }
  // what "auto" means on this device now
  autoMode() { return motionCapable() && !motionRefusedBefore() && !(this.motion && this.motion.state === 'failed') ? 'motion' : 'swipe'; }

  hint(key, ms) { if (this.h.onHint) this.h.onHint(key, ms); }

  // No motion control after all (refused, no sensor data, no gyroscope): the swipe, with a note
  motionFailed(key) {
    this.useMotion = false;
    this.hint(key, 6500);
    if (this.h.onModeChange) this.h.onModeChange();
  }
  // ... and back (a permission granted after its timeout): the swing as the setting says, the note gone
  motionRecovered() {
    if (this.h.onHintClear) this.h.onHintClear();
    this.setMode(this.modeSetting || 'auto');
    if (this.h.onModeChange) this.h.onModeChange();
  }

  // The aim while the swing button is held: the marker over the arrows and the aim line
  // (Siktlinje); null takes them away
  showAim(yaw, locked) {
    if (yaw === null || yaw === undefined || !this.enabled) { this.aimLive = null; this.clearTrail(); return; }
    const a = aimAt(yaw, this.x0);
    this.aimLive = { yaw, locked: !!locked, board: a.board, x: a.x, angle: a.angle };
    if (this.h.onAim) this.h.onAim({ x0: this.x0, z0: this.z0, speed: this.lastMotionSpeed || 6.25, angle: a.angle, side: 0, roll: 0.5 });
    this.drawAimMarker();
  }
  drawAimMarker() {
    const v = this.h.aimView && this.h.aimView();
    const A = this.aimLive;
    if (!v || !A || !v.camera || !v.camera.projectionMatrix) return;
    const c = this.overlay, g = this.ctx, dpr = window.devicePixelRatio || 1;
    if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    const P = (x, z) => projectPoint(v.camera, v.laneX + x, 0.004, z, c.clientWidth, c.clientHeight);
    const p = P(A.x, -MOTION.arrowsM), q = P(A.x + MOTION.boardM * 1.6, -MOTION.arrowsM);
    if (!p) return;
    const r = Math.max(9, Math.min(26, q ? Math.abs(q.x - p.x) * 1.2 : 12));
    g.lineWidth = 3;
    g.strokeStyle = A.locked ? 'rgba(255,255,255,0.95)' : 'rgba(226,181,80,0.95)';
    g.fillStyle = A.locked ? 'rgba(255,255,255,0.25)' : 'rgba(226,181,80,0.25)';
    g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(p.x, p.y - r * 1.6); g.lineTo(p.x, p.y - r * 0.5); g.stroke();
    g.font = '600 15px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(238,242,248,0.95)';
    g.fillText(String(A.board), p.x, p.y - r * 1.8);
  }

  motionThrow(a) {
    if (!this.enabled || !this.useMotion) return;
    const p = motionParams(a, this.x0, this.z0);
    this.lastMotionSpeed = p.speed;
    this.release(p, 'motion');
  }

  // A throw released by the player
  release(p, input) {
    gameEvents.emit('throwRelease', { human: true, input, speed: p.speed, angle: p.angle, side: p.side, x0: p.x0, z0: p.z0 });
    this.h.onThrow(p);
  }

  place(x0, z0) {
    this.x0 = clamp(x0, -this.maxX, this.maxX);
    this.z0 = clamp(z0, STANCE.zMin, STANCE.zMax);
    this.h.onPosition && this.h.onPosition(this.x0, this.z0);
  }

  key(e) {
    if (!this.enabled || this.active) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.place(this.x0 + (e.key === 'ArrowLeft' ? -0.027 : 0.027), this.z0);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.place(this.x0, this.z0 + (e.key === 'ArrowUp' ? -0.15 : 0.15));
  }

  down(e) {
    if (!this.enabled || e.button > 0) return;
    if (this.motion && this.motion.press) return;      // the thumb is on the swing button
    this.active = true;
    this.viaTouch = false;
    this.pointerId = e.pointerId;
    this.pxmm = cssPxPerMm(e.pointerType);
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    this.startX0 = this.x0;
    this.startZ0 = this.z0;
    this.tDown = stamp(e);
    this.samples = [{ x: e.clientX, y: e.clientY, t: this.tDown, ph: 'pending' }];
    this.phase = 'pending';               // pending -> place | start -> pull -> swing | swing
    this.armed = false;
    this.swingStart = 0;
    this.bottom = 0;
    this.pullPx = 0;
    this.pullPeakPxS = 0;
    this.clearHold();
    this.holdTimer = window.setTimeout(() => this.arm(), THROW.holdMs);
    e.preventDefault();
  }

  // The hold time has passed with the finger still: show that the ball is picked up (the
  // events' own times confirm it when the finger moves)
  arm() {
    this.holdTimer = 0;
    if (!this.active || this.phase !== 'pending') return;
    this.armed = true;
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* no vibration */ }
    this.drawTrail();
  }
  clearHold() { if (this.holdTimer) { window.clearTimeout(this.holdTimer); this.holdTimer = 0; } }

  move(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    // every point the browser coalesced into this event, each with its own time
    let points = null;
    try { points = e.getCoalescedEvents ? e.getCoalescedEvents() : null; } catch (err) { points = null; }
    if (!points || !points.length) points = [e];
    this.addPoints(points.map((c) => ({ x: c.clientX, y: c.clientY, t: stamp(c) })));
  }

  addPoints(list) {
    for (const s of list) {
      const prev = this.samples[this.samples.length - 1];
      if (prev && s.t < prev.t) s.t = prev.t;            // never backwards
      this.addSample(s);
    }
    this.drawTrail();
    if (this.phase === 'swing' && this.h.onAim && !this.useMotion) {
      const p = this.params(false);
      if (p) this.h.onAim(p);
    }
  }

  addSample(s) {
    const first = this.samples[0];
    const mm = this.pxmm;
    if (this.phase === 'pending') {
      if (Math.hypot(s.x - first.x, s.y - first.y) > THROW.slopMm * mm) {
        // still for the whole hold time (by the events' clock): placing; moved sooner: a throw
        this.phase = s.t - this.tDown >= THROW.holdMs ? 'place' : 'start';
        this.armed = false;
        this.clearHold();
      }
    }
    s.ph = this.phase;
    this.samples.push(s);
    const i = this.samples.length - 1;
    if (this.phase === 'place') {
      this.place(this.startX0 + (s.x - first.x) / mm * THROW.placeXPerMm, this.startZ0 + (s.y - first.y) / mm * THROW.placeZPerMm);
      return;
    }
    if (this.phase === 'start') {
      const up = (first.y - s.y) / mm;
      if (-up > THROW.startMm) this.phase = 'pull';
      else if (up > THROW.startMm) { this.phase = 'swing'; this.swingStart = this.lowest(0, i); }
      s.ph = this.phase;
    }
    if (this.phase === 'pull') {
      if (s.y >= this.samples[this.bottom].y) this.bottom = i;
      this.pullPx = Math.max(this.pullPx, s.y - first.y);
      // the pull-back's speed: over the last 60 ms (or what there is of it)
      let k = i;
      while (k > 0 && s.t - this.samples[k].t < 60) k--;
      const dt = Math.max(16, s.t - this.samples[k].t);
      this.pullPeakPxS = Math.max(this.pullPeakPxS, (s.y - this.samples[k].y) / (dt / 1000));
      // pushed forward from the lowest point: the swing starts there
      if ((this.samples[this.bottom].y - s.y) / mm > THROW.startMm) { this.phase = 'swing'; this.swingStart = this.bottom; s.ph = 'swing'; }
    }
  }

  // The sample nearest the player (largest y) between a and b
  lowest(a, b) {
    let k = a;
    for (let j = a; j <= b; j++) if (this.samples[j].y >= this.samples[k].y) k = j;
    return k;
  }

  up(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this.finish(e);
  }

  finish(e) {
    this.active = false;
    this.viaTouch = false;
    this.clearHold();
    // The pointer-up is not a sample: it is handled as late as the moves, and its point is
    // the last move's. Only a finger that rested before it let go (by the events' own
    // clock) makes the swipe end without speed.
    const lastMove = this.samples[this.samples.length - 1];
    const rested = lastMove && stamp(e) - lastMove.t > 300;
    const p = this.phase === 'swing' && !rested ? this.params(true) : null;
    window.setTimeout(() => this.clearTrail(), 350);
    // with motion control a swipe does not throw: say how it is done (placing still works)
    if (this.useMotion && this.phase === 'swing') this.hint('motionUseButton', 5000);
    else if (p) this.release(p, 'swipe');
    else if (this.phase === 'swing') this.h.onWeak && this.h.onWeak();
    else if (this.phase === 'start' && lastMove && Math.abs(lastMove.x - this.samples[0].x) / this.pxmm > 8) {
      // a quick sideways slide (how the ball was moved before): say how it is moved now
      this.h.onMisplace && this.h.onMisplace();
    }
    // placing ends here; a press, a sideways slide or a pull-back without a push is no throw
  }

  cancel() { this.active = false; this.viaTouch = false; this.clearHold(); this.clearTrail(); }

  // The swipe's pointer stream was cancelled: a touch that goes on as touch events goes on
  pointerCancel(e) {
    if (this.active && e && e.pointerType === 'touch' && e.pointerId === this.pointerId && !this.viaTouch) { this.viaTouch = true; return; }
    this.cancel();
  }
  touchMove(e) {
    if (!this.active || !this.viaTouch) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (t) this.addPoints([{ x: t.clientX, y: t.clientY, t: stamp(e) }]);
  }
  touchEnd(e) {
    if (!this.active || !this.viaTouch) return;
    if (e.touches && e.touches.length) return;            // another finger is still down
    this.finish(e);
  }

  // The power a pull-back adds (m/s): its length and speed, capped
  pullBoost() {
    if (this.pullPx <= 0) return 0;
    const len = this.pullPx / this.pxmm, sp = this.pullPeakPxS / this.pxmm;
    return THROW.boostMax * Math.min(1, len / THROW.boostFullMm) * (0.35 + 0.65 * Math.min(1, sp / THROW.boostFullMmS));
  }

  // The throw described by the forward part of the gesture
  params(final) {
    const pts = this.samples.slice(Math.max(0, this.swingStart || 0));
    // two points are enough for the speed and the line (a slow device may deliver no more:
    // the browser coalesces the moves of a frame); the hook needs more and is 0 then
    if (pts.length < 2) return null;
    const mm = this.pxmm;
    const last = pts[pts.length - 1];
    // speed from the last 120 ms of the swipe; but a still finger sends no moves, so a quick
    // flick after a rest has a gap before its first point: the rest is not part of the swipe
    // (a slow device's gaps are moving all the way, and are kept)
    let k = pts.length - 1;
    while (k > 0 && last.t - pts[k].t < 120) {
      const gap = pts[k].t - pts[k - 1].t;
      if (gap > 40 && last.t - pts[k].t >= 8) {
        const vAfter = (pts[k].y - last.y) / (last.t - pts[k].t);
        if ((pts[k - 1].y - pts[k].y) / gap < 0.4 * vAfter) break;
      }
      k--;
    }
    const a = pts[k];
    const dt = Math.max(8, last.t - a.t);                // one frame of a 120 Hz touch screen at least
    const fingerPxS = (a.y - last.y) / (dt / 1000);      // CSS px per second, up is +
    const fingerMmS = fingerPxS / mm;
    const totalMm = (pts[0].y - last.y) / mm;
    if (final && (totalMm < THROW.minSwingMm || fingerMmS < THROW.weakMmS)) return null;
    // direction: the whole swing's chord; hook: how the direction turned from the first to the last third
    const n = pts.length;
    const p0 = pts[0], p1 = pts[Math.floor(n / 3)], p2 = pts[Math.floor(2 * n / 3)], p3 = last;
    const ang = (u, v) => Math.atan2(v.x - u.x, u.y - v.y);  // 0 = straight up, + = to the right
    // the line is where the swipe was heading before its end curved: the curve is the hook
    const chord = ang(p0, p2);
    const turn = ang(p2, p3) - ang(p0, p1);
    const boost = this.pullBoost();
    const speed = Math.min(THROW.vCap, launchSpeed(fingerMmS) + boost);
    const angle = clamp(chord * 0.075, -0.06, 0.06);
    // a turn to the left (negative) is a right-hander's hook: positive side rotation
    const side = clamp(-turn * 18, -20, 20) * sideFactor(speed);
    return { x0: this.x0, z0: this.z0, speed, angle, side, roll: 0.5, vy: fingerPxS / window.innerHeight, fingerPxS, fingerMmS, boost, chord, turn };
  }

  drawTrail() {
    const c = this.overlay, g = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    const S = this.samples;
    if (!S.length) return;
    // picked up (held) or being placed: a ring with four arrows at the finger
    if (this.armed || this.phase === 'place') {
      const p = S[S.length - 1];
      g.strokeStyle = 'rgba(238,242,248,0.9)';
      g.fillStyle = 'rgba(238,242,248,0.9)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(p.x, p.y, 30, 0, Math.PI * 2); g.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = p.x + dx * 44, cy = p.y + dy * 44;
        g.beginPath();
        g.moveTo(cx + dx * 8, cy + dy * 8);
        g.lineTo(cx - dx * 4 + dy * 7, cy - dy * 4 + dx * 7);
        g.lineTo(cx - dx * 4 - dy * 7, cy - dy * 4 - dx * 7);
        g.closePath(); g.fill();
      }
      return;
    }
    if (S.length < 2 || this.useMotion) return;         // with motion control a swipe draws no throw
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 1; i < S.length; i++) {
      const a = S[i - 1], b = S[i];
      const f = i / S.length;
      g.strokeStyle = b.ph === 'swing' ? `rgba(226,181,80,${0.25 + 0.75 * f})`
        : b.ph === 'pull' ? `rgba(110,180,255,${0.35 + 0.65 * f})` : 'rgba(238,242,248,0.6)';
      g.lineWidth = 4 + 10 * f;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // the pull-back's power, as a ring filling round the point where it turned
    if (this.pullPx > 0) {
      const b = S[this.bottom];
      const k = this.pullBoost() / THROW.boostMax;
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(110,180,255,0.35)';
      g.beginPath(); g.arc(b.x, b.y, 22, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(110,180,255,0.95)';
      g.beginPath(); g.arc(b.x, b.y, 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke();
    }
  }

  clearTrail() {
    const c = this.overlay;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, c.width, c.height);
  }
}

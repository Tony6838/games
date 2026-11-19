// ---------------------------------------------------------------------------
// input.js - the throw: grip the ball with a finger or the mouse, and let go.
//
// A press on the lane grips the ball at once: a hand holds it (an SVG drawn over the ball, as
// a bowler's thumb and two fingers sit in the holes). The ball follows the slow part of the
// drag (slower than followMmS, a clutch: a quick stroke leaves it in the hand where it stood)
// across the approach and back from the foul line. Everything is decided when the finger lifts,
// by its release velocity - how it moved over the last releaseMs before the lift:
//   throw   forward (within maxReleaseDeg of straight up the screen), at weakMmS or faster, at
//           the end of a forward stroke of minSwingMm or more:
//     speed   the release speed in physical units (mm/s: CSS pixels over the device's pixels
//             per millimetre), so the same finger speed gives the same ball on a phone, a
//             tablet and a desktop, in portrait and in landscape; on a logarithmic curve,
//             launchSpeed()
//     line    the release velocity's direction, compressed (lineK) to a few degrees
//     spin    the curve of the path near the release (the heading's turn over its last
//             curveMm): curving to the left is a right-hander's release, side rotation that
//             hooks the ball to the left in the dry back end (physics.js); a straight push
//             gives none
//   place   anything else: a slow drag and lift, a sideways or backward release, a finger
//           that stopped before it lifted. The ball stays where it was let go: that is how
//           the player chooses where to stand. The arrow keys move it too.
//   weak    a quick forward flick shorter than minSwingMm ("too weak"); the ball stays.
// A throw does not move the stance: the next ball waits where this one was gripped.
//
// Every sample is timed by the event's own clock (e.timeStamp: when the finger was there),
// not by when the page got round to handling it, and every point the browser coalesced
// into one pointermove is used. On a slow device (a few frames a second) the events of a
// swipe are handled in bursts, late; timed by performance.now() the swipe looked slow and
// was refused as too weak. The pointer-up only ends the gesture: it is not a sample, but its
// time says whether the finger had stopped before it let go.
// A browser whose main thread is that busy may also give up a touch's pointer stream
// (pointercancel) while it goes on delivering the same touch as touch events; the swipe
// then continues with those, and only a touchcancel really cancels it.
//
// Every device throws this way - a phone or tablet with a finger, a desktop with the mouse, a
// laptop with its touch pad. The game reads no motion sensors.
// Every throw released by the player is announced on the game's events (js/game/events.js) as
// 'throwRelease' { human: true, input: 'swipe', speed, angle, side }.
// ---------------------------------------------------------------------------
import { LANE } from './physics.js';
import { gameEvents } from '../game/events.js';

// Where the ball may stand: across the lane (m from its middle) and behind the foul line (m)
export const STANCE = { maxX: 0.42, zMin: 0.35, zMax: 4.4 };

// The gesture and the throw. Distances in mm and speeds in mm/s of the finger on the screen.
export const THROW = {
  releaseMs: 70,        // the release velocity: the finger's movement over the last 70 ms before the lift
                        // (4 samples of a 60 Hz touch screen; a longer window mixes a late flick with the drag before it)
  restMs: 100,          // a finger that has not moved for this long before it lifts stopped: no throw
  followMmS: 120,       // the ball follows the drag while the finger is slower than this (over followMs)
  followMs: 60,
  maxReleaseDeg: 50,    // a release more than this off straight up the screen is sideways: no throw
  minSwingMm: 17,       // a forward stroke shorter than this is too weak
  weakMmS: 50,          // a forward release slower than this does not throw (the ball is placed)
  // launch speed (m/s) = vMin + vPerLn * ln(f / weakMmS), f clamped to weakMmS..topMmS:
  //   50 mm/s 3.3 (10 km/h down the lane), 170 mm/s 5.0, 400 mm/s 6.25, 700 mm/s 7.05,
  //   1200 mm/s 7.8, 2000 mm/s and faster 8.54 (29 km/h)
  vMin: 3.3, vPerLn: 1.42, topMmS: 2000,
  vCap: 9.0,            // the fastest ball
  // the line: the release direction (rad, 0 = straight up the screen) times lineK, within lineMax:
  // 10 degrees off straight is 0.0087 rad, 16 cm at the head pin (the pocket for a straight ball
  // from the middle is 4 degrees right). A curve turns the release direction too: a hook is
  // released aimed right and curved left, as a bowler plays out and lets the ball come back
  lineK: 0.05, lineMax: 0.06,
  // the spin from the curve: the heading's turn between the two halves of the path's last curveMm
  // before the release, a dead zone of curveDeadRad, then curvePerRad rad/s of side rotation per
  // radian of turn (a gentle curve, 15 degrees: about 5 rad/s on a 7 m/s ball, 17 cm of hook)
  curveMm: 30, curveDeadRad: 0.05, curvePerRad: 28,
  sideMax: 20,          // the curve's side rotation at most, before sideFactor
  // side rotation grows with speed: at sideRefSpeed it is sideAtRef of the raw value, and it
  // grows with speed^sidePow (a quicker arm turns the ball more, but less than in proportion: a
  // slower ball still hooks further and enters the pins at a steeper angle)
  sideRefSpeed: 7.05, sideAtRef: 0.69, sidePow: 0.6,
  placeXPerMm: 0.0175,  // the drag: metres across the lane per mm of finger travel (the lane's width in 48 mm)
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
const deadZone = (v, d) => Math.sign(v) * Math.max(0, Math.abs(v) - d);

// ---- the hand on the ball ------------------------------------------------------------------
// A right hand from behind, gripping the ball as a bowler does: the thumb up in the thumb hole,
// the middle and ring fingers in the finger holes, the index and little fingers on the ball, the
// wrist towards the player. Drawn for this game; the ball is the circle of radius 50 round (0, 0).
const HAND_SVG = `<svg viewBox="-70 -60 140 190" width="140" height="190" aria-hidden="true">
<defs>
<linearGradient id="vbgSkin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3C6A0"/><stop offset="1" stop-color="#D49A72"/></linearGradient>
<linearGradient id="vbgArm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DDA47A"/><stop offset="0.5" stop-color="#DDA47A" stop-opacity="0.85"/><stop offset="1" stop-color="#DDA47A" stop-opacity="0"/></linearGradient>
<radialGradient id="vbgHole" cx="0.5" cy="0.3" r="0.7"><stop offset="0" stop-color="#030304"/><stop offset="1" stop-color="#262830"/></radialGradient>
</defs>
<g stroke-linejoin="round" stroke-linecap="round">
<ellipse cx="-11" cy="-27" rx="8.5" ry="7" fill="url(#vbgHole)"/>
<ellipse cx="-9" cy="1" rx="7.5" ry="6" fill="url(#vbgHole)"/>
<ellipse cx="10" cy="2" rx="7.5" ry="6" fill="url(#vbgHole)"/>
<path d="M-16 58 C-18 80 -20 100 -22 128 L22 128 C20 100 18 80 16 58 Z" fill="url(#vbgArm)"/>
<g fill="url(#vbgSkin)" stroke="#5B3421" stroke-width="2.4">
<path d="M-21 27 C-28 23 -33 15 -35 7 C-36 1 -31 -2 -27 2 C-23 7 -19 14 -14 21 Z"/>
<path d="M21 29 C27 25 31 18 32 12 C33 6 27 4 25 9 C23 14 20 20 16 25 Z"/>
<path d="M-26 30 C-29 12 -23 -10 -17.5 -24 C-16 -29 -6 -29 -5.5 -23 C-6 -12 -9 6 -11 24 Z"/>
<path d="M-15 24 L-15 3 C-15 -4 -3 -4 -3 3 L-3 24 Z"/>
<path d="M4 25 L4 4 C4 -3 16 -3 16 4 L16 25 Z"/>
<path d="M-16 60 C-26 51 -30 36 -27 25 C-25 18 -18 17 -10 18 C-2 19 7 19 15 18 C23 17 29 21 28 31 C27 44 23 53 16 60 Z"/>
</g>
<path d="M-19.5 -27 A8.5 7 0 0 1 -2.5 -27 Z M-16.5 1 A7.5 6 0 0 1 -1.5 1 Z M2.5 2 A7.5 6 0 0 1 17.5 2 Z" fill="url(#vbgHole)"/>
<path d="M-19.5 -27 A8.5 7 0 0 1 -2.5 -27 M-16.5 1 A7.5 6 0 0 1 -1.5 1 M2.5 2 A7.5 6 0 0 1 17.5 2" fill="none" stroke="#A3A9B6" stroke-width="2"/>
<path d="M-21 22 C-17 19.5 -13 19.5 -10 21.5 M-5 21.5 C-1 19.5 3 19.5 6 21.5 M11 22 C15 20 19 20 22 23" fill="none" stroke="#B27C58" stroke-width="1.8"/>
</g>
</svg>`;

function makeHand() {
  if (typeof document === 'undefined' || !document.body) return null;
  const d = document.createElement('div');
  d.id = 'gripHand';
  d.className = 'gripHand';
  d.innerHTML = HAND_SVG;
  document.body.appendChild(d);
  return d;
}

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
    this.h = handlers;                    // { onPosition(x0, z0), onThrow(params), onAim(partial), onWeak(),
                                          //   onMode(mode, info): 'ready' | 'grip' | 'off' (the hints, js/game/modehint.js),
                                          //   onBlocked({ x, y }): a press on the lane while no throw can come,
                                          //   aimView(): { camera, laneX } for the hand on the ball }
    this.enabled = false;
    this.samples = [];
    this.x0 = 0;
    this.z0 = STANCE.zMin;
    this.maxX = STANCE.maxX;
    this.pxmm = 6;
    this.ctx = overlay.getContext('2d');
    this.hand = null;                     // the hand on the ball (made at the first grip)
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
    this.mode('ready');
  }
  disable() {
    this.enabled = false; this.active = false; this.grip(false); this.clearTrail();
    this.mode('off');
  }
  // the input's mode, for the hints (js/game/modehint.js)
  mode(m, info = null) { if (this.h.onMode) this.h.onMode(m, info); }

  // A throw released by the player
  release(p) {
    gameEvents.emit('throwRelease', { human: true, input: 'swipe', speed: p.speed, angle: p.angle, side: p.side, x0: p.x0, z0: p.z0 });
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
    if (e.button > 0) return;
    if (!this.enabled) { if (this.h.onBlocked) this.h.onBlocked({ x: e.clientX, y: e.clientY }); return; }
    this.active = true;
    this.viaTouch = false;
    this.pointerId = e.pointerId;
    this.pxmm = cssPxPerMm(e.pointerType);
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    this.startX0 = this.x0;
    this.startZ0 = this.z0;
    this.tDown = stamp(e);
    this.samples = [{ x: e.clientX, y: e.clientY, t: this.tDown, fast: false }];
    // the clutch: the ball follows the finger from here while it moves slowly
    this.anchor = { x: e.clientX, y: e.clientY, x0: this.x0, z0: this.z0 };
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (err) { /* no vibration */ }
    this.grip(true);
    this.mode('grip');
    e.preventDefault();
  }

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
    // the aim line (Siktlinje) while a throw is under way: the ball as if it were let go now
    if (this.h.onAim) {
      const last = this.samples[this.samples.length - 1];
      const r = last.fast ? this.releaseOf(last.t, false) : null;
      if (r && r.kind === 'throw') this.h.onAim(r.p);
    }
  }

  addSample(s) {
    const S = this.samples, mm = this.pxmm;
    // the finger's speed over the last followMs (by the events' clock)
    let k = S.length - 1;
    while (k > 0 && s.t - S[k].t < THROW.followMs) k--;
    const dt = Math.max(1, s.t - S[k].t);
    s.fast = Math.hypot(s.x - S[k].x, s.y - S[k].y) / mm / (dt / 1000) >= THROW.followMmS;
    S.push(s);
    const A = this.anchor;
    // a quick stroke: the ball stays in the hand where it is (the clutch slips)
    if (s.fast) { A.x = s.x; A.y = s.y; A.x0 = this.x0; A.z0 = this.z0; return; }
    this.place(A.x0 + (s.x - A.x) / mm * THROW.placeXPerMm, A.z0 + (s.y - A.y) / mm * THROW.placeZPerMm);
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

  // The finger lifts: a throw, a too short flick, or the ball placed where it was let go
  finish(e) {
    this.active = false;
    this.viaTouch = false;
    const tUp = stamp(e);
    const r = this.releaseOf(tUp, true);
    this.grip(false);
    window.setTimeout(() => this.clearTrail(), 350);
    if (r.kind === 'throw') {
      const sx = this.startX0, sz = this.startZ0;
      this.release(r.p);
      // the stance stays where the ball was gripped: a throw's own drag does not move the player
      this.x0 = sx; this.z0 = sz;
      this.h.onPosition && this.h.onPosition(sx, sz);
      return;
    }
    if (r.kind === 'weak') this.h.onWeak && this.h.onWeak();
    if (this.enabled) this.mode('ready', { after: r.kind, moved: this.x0 !== this.startX0 || this.z0 !== this.startZ0 });
  }

  // How the finger let go at tUp: { kind: 'throw', p } | { kind: 'weak' } | { kind: 'place', why }.
  // final: the real lift (the rest before the lift counts, a short stroke is "too weak"); else the
  // aim line's "as if let go now".
  releaseOf(tUp, final) {
    const S = this.samples, mm = this.pxmm;
    if (S.length < 2) return { kind: 'place', why: 'tap' };
    const last = S[S.length - 1];
    if (final && tUp - last.t > THROW.restMs) return { kind: 'place', why: 'stopped' };
    // the release velocity over the last releaseMs; but a still finger sends no moves, so a quick
    // flick after a rest has a gap before its first point: the rest is not part of the release
    // (a slow device's gaps are moving all the way, and are kept)
    let k = S.length - 1;
    while (k > 0 && last.t - S[k].t < THROW.releaseMs) {
      const gap = S[k].t - S[k - 1].t;
      if (gap > 40 && last.t - S[k].t >= 8) {
        const vAfter = Math.hypot(last.x - S[k].x, last.y - S[k].y) / (last.t - S[k].t);
        if (Math.hypot(S[k].x - S[k - 1].x, S[k].y - S[k - 1].y) / gap < 0.4 * vAfter) break;
      }
      k--;
    }
    const a = S[k];
    const dt = Math.max(8, last.t - a.t) / 1000;          // one frame of a 120 Hz touch screen at least
    const vx = (last.x - a.x) / mm / dt, vy = (a.y - last.y) / mm / dt;    // mm/s, vy + = up the screen
    const fingerMmS = Math.hypot(vx, vy);
    const dir = Math.atan2(vx, vy);                       // 0 = straight up the screen, + = to the right
    if (vy < THROW.weakMmS || Math.abs(dir) > THROW.maxReleaseDeg * Math.PI / 180) return { kind: 'place', why: vy <= 0 ? 'back' : vy < THROW.weakMmS ? 'slow' : 'sideways' };
    // the forward stroke: from the point nearest the player before the release
    const low = this.lowest(0, S.length - 1);
    const strokeMm = (S[low].y - last.y) / mm;
    if (strokeMm < THROW.minSwingMm) return final ? { kind: 'weak' } : { kind: 'place', why: 'short' };
    const speed = Math.min(THROW.vCap, launchSpeed(fingerMmS));
    const angle = clamp(dir * THROW.lineK, -THROW.lineMax, THROW.lineMax);
    const turn = this.curveTurn(low);
    // a turn to the left (negative) is a right-hander's hook: positive side rotation
    const curveSide = -deadZone(turn, THROW.curveDeadRad) * THROW.curvePerRad;
    const side = clamp(curveSide, -THROW.sideMax, THROW.sideMax) * sideFactor(speed);
    return { kind: 'throw', p: { x0: this.x0, z0: this.z0, speed, angle, side, roll: 0.5, fingerMmS, releaseDir: dir, turn, curveSide, strokeMm } };
  }

  // How the path turned near the release (rad, + = to the right): the heading of the second half
  // of its last curveMm against the first half's, within the forward stroke from sample `from`
  curveTurn(from) {
    const S = this.samples, mm = this.pxmm, n = S.length - 1;
    let len = 0, j = n;
    while (j > from && len < THROW.curveMm * mm) { len += Math.hypot(S[j].x - S[j - 1].x, S[j].y - S[j - 1].y); j--; }
    if (len < 6 * mm || n - j < 2) return 0;
    // the point half way along that piece of the path
    let half = 0, m = n;
    while (m > j && half < len / 2) { half += Math.hypot(S[m].x - S[m - 1].x, S[m].y - S[m - 1].y); m--; }
    const head = (u, v) => Math.atan2(v.x - u.x, u.y - v.y);
    let turn = head(S[m], S[n]) - head(S[j], S[m]);
    if (turn > Math.PI) turn -= 2 * Math.PI; else if (turn < -Math.PI) turn += 2 * Math.PI;
    return turn;
  }

  cancel() { this.active = false; this.viaTouch = false; this.grip(false); this.clearTrail(); if (this.enabled) this.mode('ready', { after: 'cancel' }); }

  // The swipe's pointer stream was cancelled: a touch that goes on as touch events goes on
  pointerCancel(e) {
    if (this.active && e && e.pointerType === 'touch' && e.pointerId === this.pointerId && !this.viaTouch) { this.viaTouch = true; return; }
    if (this.active) this.cancel();
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

  // The hand on the ball while it is held: drawn every frame at the ball as the camera sees it
  // (the camera moves after the ball as it is dragged)
  grip(on) {
    this.gripping = on;
    if (on && !this.hand) this.hand = makeHand();         // null outside a browser
    if (!this.hand) return;
    if (!on) { this.hand.classList.remove('show'); return; }
    this.handFrame();
  }
  handFrame() {
    if (this.handRaf) { cancelAnimationFrame(this.handRaf); this.handRaf = 0; }
    if (!this.gripping || !this.hand) return;
    const v = this.h.aimView && this.h.aimView();
    if (v && v.camera && v.camera.projectionMatrix) {
      const W = window.innerWidth, H = window.innerHeight, R = LANE.ballRadius;
      const c = projectPoint(v.camera, v.laneX + this.x0, R, this.z0, W, H);
      const top = projectPoint(v.camera, v.laneX + this.x0, 2 * R, this.z0, W, H);
      if (c && top) {
        const r = clamp(c.y - top.y, 8, 120);
        this.hand.style.transform = `translate(${(c.x - 70).toFixed(1)}px, ${(c.y - 60).toFixed(1)}px) scale(${(r / 50).toFixed(3)})`;
        this.hand.classList.add('show');
      }
    }
    this.handRaf = requestAnimationFrame(() => { this.handRaf = 0; this.handFrame(); });
  }

  drawTrail() {
    const c = this.overlay, g = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    const S = this.samples;
    if (S.length < 2) return;
    // the finger's path: gold where it moved quickly (a throw), pale where it dragged the ball
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 1; i < S.length; i++) {
      const a = S[i - 1], b = S[i];
      const f = i / S.length;
      g.strokeStyle = b.fast ? `rgba(226,181,80,${0.25 + 0.75 * f})` : 'rgba(238,242,248,0.45)';
      g.lineWidth = b.fast ? 4 + 10 * f : 3;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
  }

  clearTrail() {
    const c = this.overlay;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, c.width, c.height);
  }
}

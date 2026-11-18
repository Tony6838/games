// ---------------------------------------------------------------------------
// input.js - the throw: a swipe with a finger or the mouse.
//
// Press on the lane and slide sideways to choose where on the approach the ball is
// released; then swipe up towards the pins and let go. The swipe decides the throw:
//   speed       how fast the last part of the swipe was
//   line        which way the swipe pointed (a few degrees either side)
//   hook        how much the swipe curved at the end: curve to the left and the ball
//               hooks left, as a right-hander's ball does; to the right, a left-hander's
// A swipe that is too short or too slow is not a throw.
//
// Every sample is timed by the event's own clock (e.timeStamp: when the finger was there),
// not by when the page got round to handling it, and every point the browser coalesced
// into one pointermove is used. On a slow device (a few frames a second) the events of a
// swipe are handled in bursts, late; timed by performance.now() the swipe looked slow and
// was refused as too weak. The pointer-up only ends the gesture: it is not a sample.
// A browser whose main thread is that busy may also give up a touch's pointer stream
// (pointercancel) while it goes on delivering the same touch as touch events; the swipe
// then continues with those, and only a touchcancel really cancels it.
// ---------------------------------------------------------------------------

// The time of an input event on performance.now()'s clock; an event without a usable
// timeStamp (a synthetic one, or an old browser's epoch time) is timed now
function stamp(e) {
  const t = e && e.timeStamp;
  return typeof t === 'number' && t > 0 && t < 1e11 ? t : performance.now();
}

export class SwipeInput {
  constructor(element, overlay, handlers) {
    this.el = element;
    this.overlay = overlay;               // a canvas over the 3D view for the trail
    this.h = handlers;                    // { onPosition(x0), onThrow(params), onAim(partial) }
    this.enabled = false;
    this.samples = [];
    this.x0 = 0;
    this.maxX = 0.42;
    this.ctx = overlay.getContext('2d');
    element.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.pointerCancel(e));
    window.addEventListener('touchmove', (e) => this.touchMove(e), { passive: true });
    window.addEventListener('touchend', (e) => this.touchEnd(e), { passive: true });
    window.addEventListener('touchcancel', () => { if (this.viaTouch) this.cancel(); }, { passive: true });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  enable(x0 = 0) { this.enabled = true; this.x0 = x0; this.clearTrail(); }
  disable() { this.enabled = false; this.active = false; this.clearTrail(); }

  key(e) {
    if (!this.enabled) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      this.x0 = Math.max(-this.maxX, Math.min(this.maxX, this.x0 + (e.key === 'ArrowLeft' ? -0.027 : 0.027)));
      this.h.onPosition && this.h.onPosition(this.x0);
    }
  }

  down(e) {
    if (!this.enabled || e.button > 0) return;
    this.active = true;
    this.viaTouch = false;
    this.pointerId = e.pointerId;
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    this.startX0 = this.x0;
    this.samples = [{ x: e.clientX, y: e.clientY, t: stamp(e) }];
    this.phase = 'position';
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
    if (this.phase === 'swing' && this.h.onAim) {
      const p = this.params(false);
      if (p) this.h.onAim(p);
    }
  }

  addSample(s) {
    this.samples.push(s);
    const first = this.samples[0];
    const H = window.innerHeight, W = window.innerWidth;
    if (this.phase === 'position') {
      // sideways first: the ball moves with the finger along the foul line
      const up = first.y - s.y;
      if (up > H * 0.04) {
        this.phase = 'swing';
        this.swingStart = this.samples.length - 2;
      } else {
        const dx = (s.x - first.x) / Math.min(W, H) * 1.1;
        this.x0 = Math.max(-this.maxX, Math.min(this.maxX, this.startX0 + dx));
        this.h.onPosition && this.h.onPosition(this.x0);
      }
    }
  }

  up(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this.finish(e);
  }

  finish(e) {
    this.active = false;
    this.viaTouch = false;
    // The pointer-up is not a sample: it is handled as late as the moves, and its point is
    // the last move's. Only a finger that rested before it let go (by the events' own
    // clock) makes the swipe end without speed.
    const lastMove = this.samples[this.samples.length - 1];
    const rested = lastMove && stamp(e) - lastMove.t > 300;
    const p = this.phase === 'swing' && !rested ? this.params(true) : null;
    window.setTimeout(() => this.clearTrail(), 350);
    if (p) this.h.onThrow(p);
    else if (this.phase === 'swing') this.h.onWeak && this.h.onWeak();
  }

  cancel() { this.active = false; this.viaTouch = false; this.clearTrail(); }

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

  // The throw described by the swing part of the gesture
  params(final) {
    const pts = this.samples.slice(Math.max(0, this.swingStart || 0));
    // two points are enough for the speed and the line (a slow device may deliver no more:
    // the browser coalesces the moves of a frame); the hook needs more and is 0 then
    if (pts.length < 2) return null;
    const H = window.innerHeight;
    const last = pts[pts.length - 1];
    // speed from the last 120 ms of the swipe
    let k = pts.length - 1;
    while (k > 0 && last.t - pts[k].t < 120) k--;
    const a = pts[k];
    const dt = Math.max(16, last.t - a.t);
    const vy = (a.y - last.y) / H / (dt / 1000);        // screen heights per second, up is +
    const total = (pts[0].y - last.y) / H;
    if (final && (total < 0.12 || vy < 0.35)) return null;
    // direction: the whole swing's chord; hook: how the direction turned from the first to the last third
    const n = pts.length;
    const p0 = pts[0], p1 = pts[Math.floor(n / 3)], p2 = pts[Math.floor(2 * n / 3)], p3 = last;
    const ang = (u, v) => Math.atan2(v.x - u.x, u.y - v.y);  // 0 = straight up, + = to the right
    // the line is where the swipe was heading before its end curved: the curve is the hook
    const chord = ang(p0, p2);
    const turn = ang(p2, p3) - ang(p0, p1);
    const speed = Math.max(4.2, Math.min(10.2, 4.2 + (vy - 0.5) * 1.35));
    const angle = Math.max(-0.06, Math.min(0.06, chord * 0.075));
    // a turn to the left (negative) is a right-hander's hook: positive side rotation
    const side = Math.max(-20, Math.min(20, -turn * 18));
    return { x0: this.x0, speed, angle, side, roll: 0.5, vy, chord, turn };
  }

  drawTrail() {
    const c = this.overlay, g = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    if (this.samples.length < 2) return;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1], b = this.samples[i];
      const f = i / this.samples.length;
      g.strokeStyle = this.phase === 'swing' ? `rgba(226,181,80,${0.25 + 0.75 * f})` : 'rgba(238,242,248,0.6)';
      g.lineWidth = 4 + 10 * f;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
  }

  clearTrail() {
    const c = this.overlay;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, c.width, c.height);
  }
}

// ---------------------------------------------------------------------------
// modehint.js - whether the player can throw now, and how, on the screen.
//   ready  the player's turn: a short hint near the ball - grip the ball and let go in the
//          direction of the throw, drag slowly to move it (with the swing: the big button throws,
//          a slow drag above it moves the ball)
//   grip   the ball is held: the hand on the ball shows it (sim3d/input.js); no hint over it
//   off    no throw now (the ball rolling, the pins, the pinsetter, a machine player's turn, the
//          lane console, another screen): no hint; a press on the lane says "wait for your turn"
// When the ready hint shows: at once at the first three turns of the page; after a gesture that
// did not throw (the ball moved, a tap, too weak, a release on the lane with the swing) at once
// for the rest of that turn, and after "too weak" the next turns too; otherwise after 5 s of the
// turn without a throw (a player who seems stuck). Never while a gesture toast shows (the
// one-time explanation): they would say the same thing in the same place.
// Where: below the ball as the aiming view shows it, or beside it when the status line is right
// under it (a phone on its side), clear of the status line, the HUD's buttons, the TVs, the ball
// speed, a toast, the ball and the aim line above it; with the swing, just above the swing button.
// ---------------------------------------------------------------------------
import { t } from '../i18n.js';
import { gameEvents } from './events.js';
import { LANE } from '../sim3d/physics.js';

export const MODE_HINT = { eagerTurns: 3, stuckTurns: 2, idleMs: 5000, waitMs: 1800, gap: 8 };

const ICON = {
  throw: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14V3M3.5 7.5 8 3l4.5 4.5"/></svg>',
  move: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M6 3.5 8 1.5l2 2M6 12.5l2 2 2-2M3.5 6 1.5 8l2 2M12.5 6l2 2-2 2"/></svg>',
  button: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/></svg>',
  wait: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.3 1.6"/></svg>'
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const overlap = (a, b) => a.left < b.right && a.left + a.w > b.left && a.top < b.bottom && a.top + a.h > b.top;
// an element's box as an obstacle, or null when it is not shown
function box(el, pad = 4) {
  if (!el || el.hidden) return null;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad } : null;
}

export class ModeHint {
  constructor(app, root) {
    this.app = app;
    this.mode = 'off';
    this.eager = MODE_HINT.eagerTurns;    // turns left that show the hint at once
    this.turnShow = false;                // the hint shows at this turn
    this.waiting = false;                 // "wait for your turn", for a moment
    const el = this.el = document.createElement('div');
    el.id = 'modeHint';
    el.className = 'modeHint';
    el.setAttribute('role', 'status');
    root.appendChild(el);
    gameEvents.on('throwRelease', (e) => { if (e.human) this.eager = Math.max(0, this.eager - 1); });
    window.addEventListener('resize', () => this.render());
    // placed again when a toast comes or goes, when the play screen shows (a turn may begin just
    // before it does) and when the swing button changes (pressed, shown)
    this.observe(document.getElementById('toast'));
    this.observe(root);
    this.root = root;
  }
  playing() { return this.root.classList.contains('active'); }

  // text: also its text (the swing button says "starting" and then its label, without a class change)
  observe(el, text = false) {
    if (!el || typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => this.render()).observe(el, { attributes: true, attributeFilter: ['class'], ...(text ? { subtree: true, childList: true, characterData: true } : {}) });
  }

  // The input's mode (SwipeInput onMode): 'ready' | 'grip' | 'off'; info { after } when a gesture ended without a throw
  set(mode, info) {
    const was = this.mode;
    this.mode = mode;
    clearTimeout(this.idleT);
    if (mode !== 'off') { this.waiting = false; clearTimeout(this.waitT); }
    if (mode === 'ready' && was === 'off') {
      // a new turn
      this.turnShow = this.eager > 0;
      if (!this.turnShow) this.idleT = setTimeout(() => { this.turnShow = true; this.render(); }, MODE_HINT.idleMs);
    } else if (mode === 'ready' && was === 'grip') {
      // a gesture that did not throw: the player may not know how to throw
      this.turnShow = true;
      if (info && info.after === 'weak') this.eager = Math.max(this.eager, MODE_HINT.stuckTurns);
    } else if (mode === 'off') this.turnShow = false;
    this.render();
  }

  // A press on the lane while no throw can come (SwipeInput onBlocked): "wait", just above the press
  blocked(at) {
    if (this.mode !== 'off' || !this.playing()) return;
    this.pressAt = at || null;
    this.waiting = true;
    clearTimeout(this.waitT);
    this.waitT = setTimeout(() => { this.waiting = false; this.render(); }, MODE_HINT.waitMs);
    this.render();
  }

  // the swing button shown, its sensors ready and not pressed
  swingIdle() {
    const m = this.app.input.motion, b = document.getElementById('swingBtn');
    if (b && b !== this.swingSeen) { this.swingSeen = b; this.observe(b, true); }
    return !!(m && m.state === 'ready' && !m.press && b && b.classList.contains('show') && !/\b(down|calib|aim)\b/.test(b.className));
  }

  render() {
    const app = this.app, el = this.el;
    let kind = null;
    if (this.waiting && this.mode === 'off') kind = 'wait';
    else if (this.mode === 'ready' && this.turnShow && this.playing()) {
      if (!app.input.usingMotion()) kind = 'swipe';
      else if (this.swingIdle()) kind = 'motion';
    }
    const toast = document.getElementById('toast');
    if (kind && kind !== 'wait' && toast && toast.classList.contains('show') && toast.classList.contains('hint')) kind = null;
    if (!kind) { el.classList.remove('show'); return; }
    const html = kind === 'wait' ? `<span class="mhMain">${ICON.wait}<span>${esc(t('hintWait'))}</span></span>`
      : kind === 'motion' ? `<span class="mhMain">${ICON.button}<span>${esc(t('hintThrowMotion'))}</span></span><span class="mhSub">${ICON.move}<span>${esc(t('hintDragMotion'))}</span></span>`
        : `<span class="mhMain">${ICON.throw}<span>${esc(t('hintGrip'))}</span></span><span class="mhSub">${ICON.move}<span>${esc(t('hintDrag'))}</span></span>`;
    if (this.html !== html) { el.innerHTML = html; this.html = html; }
    el.classList.toggle('wait', kind === 'wait');
    const pos = this.place(kind);
    if (!pos) { el.classList.remove('show'); return; }
    el.style.maxWidth = pos.maxW + 'px';
    el.style.left = Math.round(pos.left) + 'px';
    el.style.top = Math.round(pos.top) + 'px';
    el.classList.add('show');
    this.placed = { kind, left: pos.left, top: pos.top, w: pos.w, h: pos.h };      // (for the tests)
  }

  // The ball as the aiming view will show it (the camera's target pose: it may still be moving there)
  ballRect() {
    const a = this.app, L = a.throwLane, sc = a.scene;
    if (!L || !sc || !sc.camera || !sc.camTargetPos) return null;
    const cam = this.cam || (this.cam = sc.camera.clone());
    cam.copy(sc.camera);
    cam.position.copy(sc.camTargetPos);
    cam.lookAt(sc.camTargetLook);
    cam.updateMatrixWorld(true);
    const b = L.physics.ball.position, R = LANE.ballRadius, W = window.innerWidth, H = window.innerHeight;
    const P = (x, y, z) => { const v = sc.camera.position.clone().set(x, y, z).project(cam); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; };
    const c = P(b.x, b.y, b.z), top = P(b.x, b.y + R, b.z), foot = P(b.x, 0, b.z + R);
    const r = Math.abs(c.y - top.y) * 1.08;
    return { x: c.x, y: c.y, r, bottom: Math.max(c.y + r, foot.y) + 4 };
  }

  // Where the hint goes: { left, top, w, h, maxW } or null when nothing fits
  place(kind) {
    const W = window.innerWidth, H = window.innerHeight, g = MODE_HINT.gap, el = this.el;
    const $ = (s) => document.querySelector(s);
    const status = box($('#status'), 2);
    const obst = [status, box($('#play .hudBtns')), box($('#tvBox')), box($('#tvStrip')), box($('#speedo'), 2)];
    const toast = $('#toast');
    if (toast && toast.classList.contains('show')) obst.push(box(toast));
    let B = null;
    if (kind === 'swipe') {
      B = this.ballRect();
      if (!B) return null;
      const ar = Math.max(B.r, 16);
      obst.push({ left: B.x - B.r, right: B.x + B.r, top: B.y - B.r, bottom: B.bottom });         // the ball
      obst.push({ left: B.x - ar, right: B.x + ar, top: 0, bottom: B.y - B.r });                // the aim line up the lane
    }
    if (kind === 'motion') obst.push(box($('#swingBtn'), 0));
    const obstacles = obst.filter(Boolean);
    const size = (maxW) => { el.style.maxWidth = maxW + 'px'; el.style.left = '0px'; el.style.top = '0px'; return { w: el.offsetWidth, h: el.offsetHeight }; };
    // (half a pixel of slack: offsetWidth rounds up a box that is exactly as wide as the space)
    const inside = (r) => r.left >= g - 0.5 && r.top >= g - 0.5 && r.left + r.w <= W - g + 0.5 && r.top + r.h <= H - g + 0.5;
    const clear = (r) => inside(r) && !obstacles.some((o) => overlap(r, o));
    // spec: { cx | left | right, top | bottom | cy, maxW }; one nudge past each obstacle it meets
    const at = (spec) => {
      const maxW = Math.floor(Math.max(120, Math.min(spec.maxW, W - 2 * g)));
      const s = size(maxW);
      const left = spec.cx !== undefined ? Math.min(W - g - s.w, Math.max(g, spec.cx - s.w / 2)) : spec.left !== undefined ? spec.left : spec.right - s.w;
      const top = spec.top !== undefined ? spec.top : spec.bottom !== undefined ? spec.bottom - s.h : spec.cy - s.h / 2;
      return { left, top, w: s.w, h: s.h, maxW };
    };
    const tryAt = (spec) => {
      const r = at(spec);
      if (clear(r)) return r;
      for (const o of obstacles) {
        if (!overlap(r, o)) continue;
        const moves = [];
        // up past it, or to its right or left (sideFirst: the sides first - with the swing, up is the pins)
        const up = spec.top === undefined || spec.nudgeUp ? [{ ...spec, top: undefined, cy: undefined, bottom: o.top - g }] : [];
        if (!spec.sideFirst) moves.push(...up);
        moves.push({ ...spec, cx: undefined, right: undefined, left: Math.ceil(o.right + g), maxW: Math.min(spec.maxW, W - g - Math.ceil(o.right + g) - 1) });
        moves.push({ ...spec, cx: undefined, left: undefined, right: Math.floor(o.left - g), maxW: Math.min(spec.maxW, Math.floor(o.left - g) - g - 1) });
        if (spec.sideFirst) moves.push(...up);
        for (const m of moves) { if (m.maxW < 120) continue; const q = at(m); if (clear(q)) return q; }
      }
      return null;
    };
    // (a wide screen sets the two parts on one line, css/modehint.css: room for that line)
    const wide = Math.min(W >= 900 && H >= 521 ? 720 : 460, W - 2 * g);
    const above = status ? status.top - g : H - 60;
    let cands;
    if (kind === 'wait') {
      // above the finger (where the player looks, and the finger does not cover it), else below it
      const p = this.pressAt || { x: W / 2, y: above };
      cands = [{ cx: p.x, bottom: p.y - 40, maxW: wide, nudgeUp: true }, { cx: p.x, top: p.y + 40, maxW: wide }, { cx: W / 2, bottom: above, maxW: wide }];
    }
    else if (kind === 'motion') {
      const b = box($('#swingBtn'), 0);
      cands = [{ cx: W / 2, bottom: (b ? b.top : above) - g, maxW: wide, sideFirst: true }];
    } else {
      const side = Math.min(360, W * 0.45);
      cands = [
        { cx: B.x, top: B.bottom + g, maxW: wide },                                   // below the ball
        { left: B.x + B.r + 2 * g, cy: B.y, maxW: side, nudgeUp: true },              // beside it, right
        { right: B.x - B.r - 2 * g, cy: B.y, maxW: side, nudgeUp: true }              // ... left
      ];
    }
    for (const c of cands) { const r = tryAt(c); if (r) return r; }
    return null;
  }
}

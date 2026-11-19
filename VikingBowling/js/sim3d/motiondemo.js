// ---------------------------------------------------------------------------
// motiondemo.js - the animated demo of the throw by swinging the phone (js/sim3d/motion.js),
// shown the first time a game starts in motion mode on a phone or tablet, and again from
// "Visa svingdemo" in the settings.
//
// One delivery, looped, drawn in SVG (no video): 1 the phone upright in one hand like a remote,
// the thumb over the swing button (the gold lower part of the screen, as in the game); 2 press
// and hold; 3 aim: turn the phone a little until the marker stands on the arrow (the small lane
// seen from behind, top right); 4 swing back; 5 swing forward; 6 lift the thumb at the bottom of
// the swing, and the ball rolls away down the lane on the aimed line. The caption follows the step; "Släpp vid botten av svingen"
// says what the release timing does. A big "Spela" button and "Hoppa över" end it at any time.
// With prefers-reduced-motion the five steps are shown as still frames.
// ---------------------------------------------------------------------------
import { t as tr } from '../i18n.js';

// The timeline (ms) of one delivery; the loop is LOOP long
const LOOP = 8000;
const STEPS = [0, 1000, 1800, 3300, 4300, 5100];   // the start of steps 1-6
const STILLS = [500, 1400, 2900, 4150, 4950, 6100]; // the reduced-motion frames
const REL = 5100;                                  // the thumb lifts: the bottom of the swing
const CAPTIONS = ['demoStep1', 'demoStep2', 'demoAim', 'demoStep3', 'demoStep4', 'demoStep5'];
export const DEMO = { LOOP, STEPS, REL, STILLS };
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : (1 - Math.cos(Math.PI * u)) / 2);
const easeOut = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : Math.sin(Math.PI / 2 * u));

// the arm's angle (deg, + forward towards the lane), the thumb down, the ball's x (null: in the hand)
export function demoPose(ms) {
  const t = ((ms % LOOP) + LOOP) % LOOP;
  let theta = 0;
  if (t >= 3300 && t < 4300) theta = -65 * ease((t - 3300) / 1000);
  else if (t >= 4300 && t < REL) theta = -65 + 65 * (1 - Math.cos(Math.PI / 2 * (t - 4300) / (REL - 4300)));   // speeding up to the bottom
  else if (t >= REL && t < 5700) theta = 38 * easeOut((t - REL) / 600);
  else if (t >= 5700 && t < 7300) theta = 38 - 38 * ease((t - 5700) / 1600) * 0.4;
  else if (t >= 7300) theta = 22.8 * (1 - ease((t - 7300) / 700));
  const thumbDown = t >= 1100 && t < REL;
  const ball = t >= REL && t < 7700 ? Math.min(1, (t - REL) / 1500) : null;
  const pinsDown = t >= REL + 1450 && t < 7700;
  // the aim: the marker slides to the arrow while the phone is turned, and stays (locked)
  const aim = t < 1900 ? 0 : t < 2900 ? ease((t - 1900) / 1000) : t < 7700 ? 1 : 1 - ease((t - 7700) / 300);
  const turning = t >= 1900 && t < 2900;
  let step = 0;
  for (let i = 0; i < STEPS.length; i++) if (t >= STEPS[i]) step = i;
  return { t, theta, thumbDown, ball, pinsDown, aim, turning, step };
}

// the inset lane (seen from behind): x at depth d (0 at the foul line, 1 at the pins) for an offset u (-1..1 across)
const IN = { x: 285, yFoul: 118, yPins: 26, halfFoul: 50, halfPins: 15, dArrows: 0.32, aimU: 0.42 };
const inY = (d) => IN.yFoul + (IN.yPins - IN.yFoul) * d;
const inX = (d, u) => IN.x + u * (IN.halfFoul + (IN.halfPins - IN.halfFoul) * d);

// The scene: the player side on, the lane to the right
const SCENE = `
<svg class="mdScene" viewBox="0 0 360 250" aria-hidden="true">
  <rect x="0" y="232" width="360" height="18" fill="#0E1A2C"/>
  <rect x="176" y="226" width="180" height="8" rx="2" fill="#D7B47F"/>
  <g class="mdPins" transform="translate(338 226)">
    <g class="mdPin" transform="translate(-12 0)"><path d="M-3 0 q-2 -7 1 -12 q-2 -3 0 -6 q2 -3 4 0 q2 3 0 6 q3 5 1 12 z" fill="#F4F6FA" stroke="#9aa8bf" stroke-width=".6"/><rect x="-2.2" y="-14" width="4.4" height="1.6" fill="#C8102E"/></g>
    <g class="mdPin" transform="translate(-4 0)"><path d="M-3 0 q-2 -7 1 -12 q-2 -3 0 -6 q2 -3 4 0 q2 3 0 6 q3 5 1 12 z" fill="#F4F6FA" stroke="#9aa8bf" stroke-width=".6"/><rect x="-2.2" y="-14" width="4.4" height="1.6" fill="#C8102E"/></g>
    <g class="mdPin" transform="translate(4 0)"><path d="M-3 0 q-2 -7 1 -12 q-2 -3 0 -6 q2 -3 4 0 q2 3 0 6 q3 5 1 12 z" fill="#F4F6FA" stroke="#9aa8bf" stroke-width=".6"/><rect x="-2.2" y="-14" width="4.4" height="1.6" fill="#C8102E"/></g>
  </g>
  <circle class="mdBall" r="8" cx="156" cy="218" fill="#1D3F7A" stroke="#E2B550" stroke-width="2"/>
  <g stroke="#9AA8BF" stroke-width="7" stroke-linecap="round" fill="none">
    <path d="M146 146 L136 230 M154 146 L166 230"/>
    <path d="M150 58 L150 146"/>
    <path d="M150 66 L138 122"/>
  </g>
  <circle cx="150" cy="36" r="14" fill="#9AA8BF"/>
  <g class="mdArm" transform="rotate(0 150 66)">
    <path d="M150 66 L150 160" stroke="#C99A6B" stroke-width="9" stroke-linecap="round"/>
    <rect x="140" y="156" width="20" height="16" rx="7" fill="#C99A6B"/>
    <g class="mdPhone">
      <rect x="139" y="150" width="22" height="46" rx="4" fill="#0A1322" stroke="#E2B550" stroke-width="1.6"/>
      <rect x="142" y="154" width="16" height="21" rx="1.5" fill="#17263F"/>
      <rect class="mdBtn" x="142" y="177" width="16" height="15" rx="2.5" fill="#E2B550"/>
      <circle class="mdRing" cx="150" cy="185" r="9" fill="none" stroke="#E2B550" stroke-width="1.5"/>
    </g>
    <ellipse class="mdThumb" cx="150" cy="185" rx="5.5" ry="4.5" fill="#D9A877" stroke="#8A5A32" stroke-width="1"/>
  </g>
  <path class="mdTurn" d="M128 214 A24 9 0 1 0 172 214" fill="none" stroke="#6EB4FF" stroke-width="2.5"/>
  <path class="mdTurnHead" d="M172 214 l-7 -5 M172 214 l-8 3" stroke="#6EB4FF" stroke-width="2.5" fill="none"/>
  <g class="mdInset">
    <rect x="226" y="14" width="118" height="112" rx="8" fill="#0B1424" stroke="#24375A"/>
    <path d="M${inX(0, -1)} ${IN.yFoul} L${inX(0, 1)} ${IN.yFoul} L${inX(1, 1)} ${IN.yPins} L${inX(1, -1)} ${IN.yPins} Z" fill="#D7B47F"/>
    ${[-3, -2, -1, 0, 1, 2, 3].map((k) => { const d = IN.dArrows + Math.abs(k) * 0.025, x = inX(d, k * 0.2), y = inY(d); return `<path d="M${x.toFixed(1)} ${(y - 4).toFixed(1)} l-3 6 h6 z" fill="#7A5A2E"/>`; }).join('')}
    ${[-1, 0, 1].map((k) => `<circle cx="${inX(1, k * 0.35).toFixed(1)}" cy="${IN.yPins + 3}" r="2.4" fill="#F4F6FA"/>`).join('')}
    <path class="mdAimLine" d="" stroke="#E2B550" stroke-width="1.6" stroke-dasharray="4 3" fill="none"/>
    <ellipse class="mdMarker" rx="7" ry="3.2" fill="rgba(226,181,80,0.3)" stroke="#E2B550" stroke-width="2"/>
    <circle class="mdInBall" r="3.6" fill="#1D3F7A" stroke="#E2B550" stroke-width="1"/>
  </g>
  <text class="mdStepNo" x="14" y="26" font-size="16" font-weight="700" fill="#E2B550"></text>
</svg>`;

function paint(svg, p) {
  svg.querySelector('.mdArm').setAttribute('transform', `rotate(${(-p.theta).toFixed(2)} 150 66)`);
  const th = svg.querySelector('.mdThumb'), btn = svg.querySelector('.mdBtn'), ring = svg.querySelector('.mdRing');
  th.setAttribute('cx', p.thumbDown ? 150 : 137);
  th.setAttribute('cy', p.thumbDown ? 185 : 179);
  th.setAttribute('opacity', p.thumbDown ? 1 : 0.95);
  btn.setAttribute('opacity', p.thumbDown ? 1 : 0.45);
  const pulse = p.thumbDown ? 0.5 + 0.5 * Math.sin(p.t / 120) : 0;
  ring.setAttribute('opacity', pulse.toFixed(2));
  ring.setAttribute('r', (9 + pulse * 3).toFixed(1));
  const ball = svg.querySelector('.mdBall');
  if (p.ball === null) ball.setAttribute('opacity', 0);
  else {
    // from the hand at the bottom of the swing (x 150) down the lane to the pins
    const u = easeOut(p.ball);
    ball.setAttribute('opacity', 1);
    ball.setAttribute('cx', (156 + 166 * u).toFixed(1));
  }
  svg.querySelectorAll('.mdPin').forEach((g, i) => {
    const x = [-12, -4, 4][i];
    g.setAttribute('transform', `translate(${x} 0)` + (p.pinsDown ? ` rotate(${[-70, 75, 82][i]})` : ''));
  });
  svg.querySelector('.mdStepNo').textContent = String(p.step + 1);
  // the inset: the marker from straight ahead to the arrow, the aim line through it, the ball on it
  const dA = IN.dArrows + 0.05;
  const mx = inX(dA, IN.aimU * p.aim), my = inY(dA);
  const mk = svg.querySelector('.mdMarker');
  mk.setAttribute('cx', mx.toFixed(1)); mk.setAttribute('cy', my.toFixed(1));
  mk.setAttribute('stroke', p.step >= 3 ? '#FFFFFF' : '#E2B550');
  const along = (d) => [IN.x + (mx - IN.x) * d / dA, inY(d)];
  const [ex, ey] = along(1);
  svg.querySelector('.mdAimLine').setAttribute('d', `M${IN.x} ${IN.yFoul} L${ex.toFixed(1)} ${ey.toFixed(1)}`);
  const ib = svg.querySelector('.mdInBall');
  const d = p.ball === null ? 0 : easeOut(p.ball);
  const [bx, by] = along(d * 0.97);
  ib.setAttribute('cx', bx.toFixed(1)); ib.setAttribute('cy', (by - 2).toFixed(1));
  for (const c of ['.mdTurn', '.mdTurnHead']) svg.querySelector(c).setAttribute('opacity', p.turning ? 1 : 0);
}

export class MotionDemo {
  // h: { onDone(kind) } kind 'play' | 'skip' | 'swipe'
  constructor(h) {
    this.h = h;
    this.raf = 0;
    this.frozen = null;
    const o = this.el = document.createElement('div');
    o.id = 'motionDemo';
    o.className = 'motionDemo';
    o.setAttribute('role', 'dialog');
    o.innerHTML = `<div class="mdPanel">
      <div class="mdHead"><h3></h3><button class="mdSkip" id="mdSkip"></button></div>
      <div class="mdStage">${SCENE}</div>
      <div class="mdStills"></div>
      <div class="mdDots">${'<i></i>'.repeat(6)}</div>
      <p class="mdCaption" aria-live="polite"></p>
      <p class="mdTiming"></p>
      <p class="mdSafety"></p>
      <div class="mdBtns"><button class="btn" id="mdSwipe"></button><button class="btn gold big" id="mdPlay"></button></div>
    </div>`;
    document.body.appendChild(o);
    o.querySelector('#mdPlay').addEventListener('click', () => this.done('play'));
    o.querySelector('#mdSkip').addEventListener('click', () => this.done('skip'));
    o.querySelector('#mdSwipe').addEventListener('click', () => this.done('swipe'));
  }

  reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  // first: the first use (the safety note and "Svep i stället" too)
  show({ first = false } = {}) {
    const o = this.el;
    o.querySelector('h3').textContent = tr('demoTitle');
    o.querySelector('#mdSkip').textContent = tr('demoSkip') + ' ✕';
    o.querySelector('#mdPlay').textContent = tr('demoPlay');
    o.querySelector('#mdSwipe').textContent = tr('motionUseSwipe');
    o.querySelector('#mdSwipe').hidden = !first;
    o.querySelector('.mdTiming').textContent = tr('demoTiming');
    const sf = o.querySelector('.mdSafety');
    sf.textContent = tr('motionSafety');
    sf.hidden = !first;
    const still = this.reduced();
    o.classList.toggle('still', still);
    const box = o.querySelector('.mdStills');
    box.innerHTML = '';
    if (still) {
      // the five steps side by side, each with its caption
      STILLS.forEach((ms, i) => {
        const f = document.createElement('figure');
        f.innerHTML = SCENE + `<figcaption>${i + 1}. ${tr(CAPTIONS[i])}</figcaption>`;
        paint(f.querySelector('svg'), demoPose(ms));
        box.appendChild(f);
      });
    }
    o.classList.add('show');
    this.visible = true;
    this.t0 = performance.now();
    this.lastStep = -1;
    if (!still) this.tick();
  }

  // for the tests: hold the animation at ms of the loop (null runs it again)
  seek(ms) { this.frozen = ms; if (this.visible && !this.raf && !this.reduced()) this.tick(); }

  tick() {
    this.raf = 0;
    if (!this.visible) return;
    const ms = this.frozen !== null ? this.frozen : performance.now() - this.t0;
    const p = demoPose(ms);
    paint(this.el.querySelector('.mdStage svg'), p);
    if (p.step !== this.lastStep) {
      this.lastStep = p.step;
      this.el.querySelector('.mdCaption').textContent = tr(CAPTIONS[p.step]);
      this.el.querySelectorAll('.mdDots i').forEach((d, i) => d.classList.toggle('on', i === p.step));
      this.el.querySelector('.mdTiming').classList.toggle('hot', p.step === 5);
    }
    this.raf = requestAnimationFrame(() => this.tick());
  }

  hide() {
    this.visible = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.el.classList.remove('show');
  }

  done(kind) { this.hide(); this.h.onDone && this.h.onDone(kind); }
}

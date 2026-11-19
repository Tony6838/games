// ---------------------------------------------------------------------------
// synth.js - every sound of the game, synthesised in JavaScript into plain sample arrays.
//
// No sound files and no Web Audio in here: each function returns { sr, ch: [Float32Array, ...] }
// (one array per channel), so the same code renders in the browser (js/audio/hallaudio.js turns
// the arrays into AudioBuffers) and in node (tests/audio_test.mjs writes them to WAV files).
// Every render takes a seed, so a variant can be made again and a new seed gives a new variant.
//
//   the people     renderApplause(size)   single claps (filtered noise bursts), one clapper at a time
//                  renderWhistle()        a two-finger whistle (a pure tone, no voice)
//                  (no human voices: the people are heard only clapping and whistling)
//   the lane       renderImpact(type)     modal synthesis: a pin's clack, a pin on the deck, the
//                                         ball meeting a pin, the kickback, the pit, the cushion
//                  renderRollTexture()    the noise the rolling ball is filtered from (in real time)
//   the machine    renderPinsetter(kind)  sweep, deadwood, a new rack set or the leave respotted
//                  renderBallReturn()     the return track, the lift, the clack on the rack
//                  renderBumper(up)       the bumper rails rising or lowering
//   the hall       renderRoomTone()       the hall's room tone: the ventilation, far below the rest
//                  renderImpulse()        the hall's reverb (an impulse response)
//                  renderFarRoll(), renderFarCrash(pins)   a ball on another lane
//                  renderChime(up)        the lane console's soft two-tone chime
// ---------------------------------------------------------------------------

// Seeded random numbers (mulberry32)
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function makeBuf(sr, seconds, channels = 1) {
  const n = Math.max(1, Math.round(sr * seconds));
  const ch = [];
  for (let i = 0; i < channels; i++) ch.push(new Float32Array(n));
  return { sr, ch };
}

// A biquad filter (the RBJ cookbook); bandpass has a 0 dB peak
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(type, f, q, sr) {
    const w = TAU * clamp(f, 10, sr * 0.45) / sr, s = Math.sin(w), c = Math.cos(w), al = s / (2 * q), a0 = 1 + al;
    if (type === 'bp') { this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; }
    else if (type === 'lp') { this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; }
    else { this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0; }
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
const onePole = (fc, sr) => 1 - Math.exp(-TAU * fc / sr);

// The value of a contour [[u, v0, v1, ...], ...] at u (0..1), linearly between the points
function at(pts, u) {
  if (u <= pts[0][0]) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const a = pts[i - 1], b = pts[i], k = (u - a[0]) / (b[0] - a[0] || 1);
      const r = [u];
      for (let j = 1; j < a.length; j++) r.push(a[j] + (b[j] - a[j]) * k);
      return r;
    }
  }
  return pts[pts.length - 1];
}

const panGains = (pan) => [Math.cos((clamp(pan, -1, 1) + 1) * Math.PI / 4), Math.sin((clamp(pan, -1, 1) + 1) * Math.PI / 4)];

// Add a mono sample into a buffer at a time (seconds), with gain and pan
function mix(buf, mono, t, gain = 1, pan = 0) {
  const s0 = Math.round(t * buf.sr);
  const [gl, gr] = panGains(pan);
  const L = buf.ch[0], R = buf.ch[1];
  for (let i = 0; i < mono.length; i++) {
    const j = s0 + i;
    if (j < 0) continue;
    if (j >= L.length) break;
    if (R) { L[j] += mono[i] * gain * gl; R[j] += mono[i] * gain * gr; } else L[j] += mono[i] * gain;
  }
}

// Scale so that the loudest 50 ms window has this RMS, with the peak kept under 0.98; soft: the
// peaks above 0.6 are rounded off instead (applause, whose single claps would otherwise hold
// the whole round down)
export function normalize(buf, targetRms = 0.2, soft = false) {
  const n = buf.ch[0].length, w = Math.max(1, Math.round(buf.sr * 0.05));
  let best = 0, peak = 0;
  for (let s = 0; s + w <= n; s += w >> 1) {
    let e = 0;
    for (const c of buf.ch) for (let i = s; i < s + w; i++) e += c[i] * c[i];
    best = Math.max(best, e / (w * buf.ch.length));
  }
  for (const c of buf.ch) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]));
  if (!(best > 0) || !(peak > 0)) return buf;
  if (soft) {
    const k = targetRms / Math.sqrt(best);
    for (const c of buf.ch) for (let i = 0; i < n; i++) {
      const v = c[i] * k, a = Math.abs(v);
      c[i] = 0.98 * (a <= 0.6 ? v : Math.sign(v) * (0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4)));
    }
    return buf;
  }
  const k = Math.min(targetRms / Math.sqrt(best), 0.98 / peak);
  for (const c of buf.ch) for (let i = 0; i < n; i++) c[i] *= k;
  return buf;
}

// Fade the last `seconds` to silence (so a cut never clicks)
function fadeTail(buf, seconds = 0.08) {
  const n = buf.ch[0].length, f = Math.min(n, Math.round(seconds * buf.sr));
  for (const c of buf.ch) for (let i = 0; i < f; i++) c[n - 1 - i] *= i / f;
}

// ---- the people: a whistle ----------------------------------------------------------------------
// A two-finger whistle: a pure tone that rises, holds and falls (or the "wheet-whoo")
function whistle(buf, t0, gain, pan, rand) {
  const sr = buf.sr, dur = 0.7 + rand() * 0.45, n = Math.round(dur * sr), s0 = Math.round(t0 * sr);
  const top = 2600 + rand() * 700;
  const wolf = rand() < 0.5;
  const f = wolf ? [[0, top * 0.62], [0.2, top], [0.42, top * 1.02], [0.5, top * 0.75], [0.62, top * 0.95], [1, top * 0.6]]
    : [[0, top * 0.7], [0.15, top], [0.8, top * 1.03], [1, top * 0.72]];
  const amp = [[0, 0], [0.06, 1], [0.42, 0.9], [0.5, wolf ? 0.25 : 0.9], [0.6, 0.85], [1, 0]];
  const [pl, pr] = panGains(pan), L = buf.ch[0], R = buf.ch[1];
  const bp = new Biquad();
  let ph = 0, env = 0;
  const envK = 1 - Math.exp(-1 / (0.008 * sr));
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j >= L.length) break;
    const u = i / n, fr = at(f, u)[1] * (1 + 0.004 * Math.sin(TAU * 6 * i / sr));
    if ((i & 63) === 0) bp.set('bp', fr, 10, sr);
    env += (at(amp, u)[1] - env) * envK;
    ph += fr / sr; if (ph > 1) ph -= 1;
    const y = (Math.sin(TAU * ph) * 0.85 + bp.run(rand() * 2 - 1) * 0.6) * env * gain;
    if (j < 0) continue;
    L[j] += y * pl; if (R) R[j] += y * pr;
  }
}

// A whistle from the group, as a buffer of its own (1.4 s, stereo; its place in the group by the seed)
export function renderWhistle(seed, sr = 16000) {
  const rand = rng(seed);
  const buf = makeBuf(sr, 1.4, 2);
  whistle(buf, 0.02 + rand() * 0.15, 0.25, (rand() - 0.5) * 1.2, rand);
  fadeTail(buf, 0.1);
  return normalize(buf, 0.15);
}

// Run a render job (a generator that yields between its parts and returns the buffer) at once
export function runJob(it) { let r; do { r = it.next(); } while (!r.done); return r.value; }

// ---- applause -----------------------------------------------------------------------------------
// One clap: a noise burst (1 ms attack, 4-9 ms decay) through the clapper's own band (the
// spectrum peaks from about 1 kHz for cupped hands to 2.5 kHz for flat ones; Repp 1987)
function clapTemplate(sr, fc, q, cup, rand) {
  const n = Math.round(0.035 * sr), out = new Float32Array(n);
  const bp = new Biquad().set('bp', fc, q, sr), body = new Biquad().set('bp', 420, 1.6, sr);
  const tau = (0.004 + rand() * 0.005) * sr, att = 0.0006 * sr;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const e = i < att ? i / att : Math.exp(-(i - att) / tau);
    const x = (rand() * 2 - 1) * e;
    out[i] = bp.run(x) + cup * body.run(x) * 1.5;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < n; i++) out[i] /= peak || 1;
  return out;
}

const APPLAUSE = {
  clapS: { clappers: 4, dur: 1.9, rate: [3.8, 5.2], distant: 0, loud: 0.14 },
  clapM: { clappers: 7, dur: 2.9, rate: [4.0, 5.5], distant: 0, loud: 0.18 },
  clapL: { clappers: 12, dur: 3.9, rate: [4.2, 5.8], distant: 8, loud: 0.21 },
  clapXL: { clappers: 16, dur: 6.5, rate: [4.3, 6.0], distant: 26, loud: 0.25 }
};
export const APPLAUSE_SIZES = Object.keys(APPLAUSE);

export function renderApplause(size, seed, sr = 16000) { return runJob(applauseJob(size, seed, sr)); }
// ...a few clappers at a time
export function* applauseJob(size, seed, sr = 16000) {
  const spec = APPLAUSE[size] || APPLAUSE.clapM, rand = rng(seed);
  const buf = makeBuf(sr, spec.dur, 2);
  const total = spec.clappers + spec.distant;
  for (let c = 0; c < total; c++) {
    const far = c >= spec.clappers;
    const fc = (far ? 800 : 950) + rand() * (far ? 900 : 1500);
    const tpl = [];
    for (let k = 0; k < 4; k++) tpl.push(clapTemplate(sr, fc, 1.2 + rand() * 1.3, rand() * 0.35, rand));
    if (far) {          // the hall's other bowlers: further away, duller
      const a = onePole(1800, sr);
      for (const t of tpl) { let y = 0; for (let i = 0; i < t.length; i++) { y += a * (t[i] - y); t[i] = y * 1.6; } }
    }
    const rate = spec.rate[0] + rand() * (spec.rate[1] - spec.rate[0]);
    const s0 = far ? 0.3 + rand() * 1.2 : 0.03 + rand() * 0.35;
    const e = Math.min(spec.dur - 0.06, spec.dur * (0.62 + rand() * 0.4));
    const pan = (rand() - 0.5) * (far ? 1.9 : 1.2);
    const g = far ? 0.22 + rand() * 0.2 : 0.55 + rand() * 0.45;
    for (let t = s0; t < e; t += (1 / rate) * (1 + (rand() - 0.5) * 0.14)) {
      const up = Math.min(1, (t - s0) / 0.3), down = Math.min(1, (e - t) / 0.6);
      const a = up * down * (1 - 0.25 * (t - s0) / (e - s0)) * (0.75 + rand() * 0.5);
      mix(buf, tpl[Math.floor(rand() * 4)], t, a * g, pan);
    }
    if (c % 3 === 2) yield;
  }
  fadeTail(buf, 0.1);
  return normalize(buf, spec.loud, true);
}

// ---- the lane: impacts ------------------------------------------------------------------------------
// Decaying modes [Hz from, Hz to, amplitude, decay ms from, to] plus a click [amp, ms, filter, Hz]
const IMPACT = {
  // a pin against a pin: the maple pin's ring, damped by its plastic coat
  clack: { len: 0.16, modes: [[700, 950, 1, 35, 55], [1500, 1900, 0.8, 25, 40], [2600, 3200, 0.6, 15, 25], [3900, 4600, 0.4, 10, 18], [5400, 6400, 0.22, 6, 10]], click: [0.8, 1.5, 'hp', 1500] },
  // a pin falling on the deck
  thud: { len: 0.22, modes: [[170, 260, 1, 40, 70], [420, 520, 0.5, 25, 35], [750, 950, 0.3, 25, 40], [1600, 1900, 0.18, 15, 25]], click: [0.5, 2, 'lp', 1800] },
  // the ball meeting a pin: the heavy ball's thock and the pin's crack
  ballHit: { len: 0.26, modes: [[240, 320, 1, 25, 35], [700, 900, 0.9, 30, 50], [1500, 1850, 0.75, 22, 35], [2600, 3100, 0.55, 14, 22], [4000, 4600, 0.35, 8, 14]], click: [1.3, 3, 'bp', 2200] },
  // a pin thrown against the kickback (the side board)
  kick: { len: 0.26, modes: [[140, 220, 1, 50, 70], [560, 680, 0.4, 20, 30], [750, 950, 0.35, 25, 40], [1600, 1900, 0.2, 15, 25]], click: [0.5, 2, 'lp', 2500] },
  // a pin dropping into the pit
  pit: { len: 0.22, modes: [[90, 140, 1, 45, 60], [260, 340, 0.35, 25, 35]], click: [0.6, 6, 'lp', 700] },
  // the ball hitting the cushion at the back of the pit
  cushion: { len: 0.36, modes: [[55, 80, 1, 80, 100], [140, 190, 0.35, 40, 60]], click: [0.7, 10, 'lp', 320] },
  // the ball landing on the lane at the release
  drop: { len: 0.32, modes: [[70, 100, 1, 55, 70], [180, 240, 0.5, 25, 35], [600, 800, 0.15, 15, 20]], click: [0.6, 3, 'lp', 1500] },
  // a ball against a ball on the return rack
  ballClack: { len: 0.12, modes: [[1100, 1500, 1, 12, 18], [2600, 3200, 0.6, 7, 10], [4200, 4800, 0.3, 4, 6]], click: [0.9, 1, 'hp', 2000] },
  // the pinsetter's metal: the sweep bar, the deck at its stops
  clunk: { len: 0.26, modes: [[110, 130, 1, 35, 45], [370, 450, 0.7, 25, 35], [900, 1200, 0.5, 18, 25], [2100, 2400, 0.3, 10, 14]], click: [0.7, 2, 'lp', 3000] }
};
export const IMPACT_TYPES = Object.keys(IMPACT);

export function renderImpact(type, seed, sr = 22050) {
  const spec = IMPACT[type] || IMPACT.clack, rand = rng(seed);
  const buf = makeBuf(sr, spec.len, 1), out = buf.ch[0], n = out.length;
  for (const [f0, f1, amp, t0, t1] of spec.modes) {
    const f = f0 + rand() * (f1 - f0);
    if (f > sr * 0.45) continue;
    const tau = (t0 + rand() * (t1 - t0)) / 1000;
    const a = amp * (0.75 + rand() * 0.5);
    // a decaying sinusoid by recursion: y[n] = 2 r cos(w) y[n-1] - r^2 y[n-2]
    const w = TAU * f / sr, r = Math.exp(-1 / (tau * sr)), c = 2 * r * Math.cos(w), r2 = r * r;
    const ph = rand() * TAU;
    let y1 = Math.sin(ph) * a, y2 = Math.sin(ph - w) * a / r;
    for (let i = 0; i < n; i++) { const y = c * y1 - r2 * y2; out[i] += y1; y2 = y1; y1 = y; }
  }
  const [ca, cms, ct, cf] = spec.click;
  const filt = new Biquad().set(ct, cf, ct === 'bp' ? 0.8 : 0.707, sr), ctau = cms / 1000 * sr;
  for (let i = 0; i < n; i++) out[i] += filt.run((rand() * 2 - 1) * ca * Math.exp(-i / ctau)) * 2;
  const att = Math.round(0.0004 * sr);
  for (let i = 0; i < att; i++) out[i] *= i / att;
  fadeTail(buf, 0.03);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / (peak || 1);
  return buf;
}

// ---- the rolling ball -------------------------------------------------------------------------------
// A seamless loop of the noise the ball's rumble is filtered from in real time: mostly brown
// (the lane's low boom) with some lighter noise for the swish.
export function renderRollTexture(seed = 11, sr = 22050, seconds = 2) {
  const rand = rng(seed), n = Math.round(seconds * sr), fade = Math.round(0.25 * sr);
  const raw = new Float32Array(n + fade);
  let b = 0, p = 0;
  const pa = onePole(900, sr);
  for (let i = 0; i < raw.length; i++) {
    const w = rand() * 2 - 1;
    b = (b + w * 0.02) * 0.997;
    p += pa * (w - p);
    raw[i] = b * 3 + p * 0.35;
  }
  const buf = makeBuf(sr, seconds, 1), out = buf.ch[0];
  for (let i = 0; i < n; i++) {
    if (i < fade) { const k = i / fade; out[i] = raw[i] * Math.sin(k * Math.PI / 2) + raw[n + i] * Math.cos(k * Math.PI / 2); }
    else out[i] = raw[i];
  }
  let m = 0;
  for (let i = 0; i < n; i++) m += out[i];
  m /= n;
  for (let i = 0; i < n; i++) out[i] -= m;
  return normalize(buf, 0.3);
}

// ---- the machine --------------------------------------------------------------------------------------
// The pinsetter's motors: the mains hum (100 Hz and its harmonics) and the gearbox whine, gliding
function motor(out, sr, t0, t1, gain, w0, w1, rand) {
  const s0 = Math.round(t0 * sr), s1 = Math.min(out.length, Math.round(t1 * sr));
  const n = s1 - s0, att = 0.08 * sr, rel = 0.14 * sr;
  const lp = onePole(1400, sr);
  let wp = rand(), y = 0;
  for (let i = 0; i < n; i++) {
    const t = (s0 + i) / sr, e = Math.min(1, i / att, (n - i) / rel);
    const u = i / n, wf = w0 + (w1 - w0) * u;
    wp += wf / sr;
    let h = 0;
    for (let k = 1; k <= 5; k++) h += Math.sin(TAU * 100 * k * t + k) / Math.pow(k, 1.3);
    const s = h * 0.45 + Math.sin(TAU * wp) * 0.3 * (1 + 0.2 * Math.sin(TAU * 13 * t)) + (rand() * 2 - 1) * 0.12;
    y += lp * (s - y);
    out[s0 + i] += y * e * gain;
  }
}
// Pins scraped along the deck by the sweep: band noise, rattling
function scrape(out, sr, t0, t1, gain, rand) {
  const s0 = Math.round(t0 * sr), s1 = Math.min(out.length, Math.round(t1 * sr)), n = s1 - s0;
  const bp = new Biquad().set('bp', 1700, 0.8, sr);
  let am = 0, amT = 0;
  for (let i = 0; i < n; i++) {
    if (--amT <= 0) { amT = Math.round(sr * (0.03 + rand() * 0.06)); am = 0.3 + rand() * 0.7; }
    const e = Math.sin(Math.PI * i / n);
    out[s0 + i] += bp.run(rand() * 2 - 1) * am * e * gain;
  }
}

export function renderPinsetter(kind, seed, sr = 22050) {
  const rand = rng(seed);
  const buf = makeBuf(sr, 3.9, 1), out = buf.ch[0];
  const S = (type) => renderImpact(type, Math.floor(rand() * 1e9), sr).ch[0];
  const add = (type, t, g) => mix(buf, S(type), t, g);
  motor(out, sr, 0.0, 3.6, 0.12, 470, 520, rand);
  add('clunk', 0.0, 0.55);                                       // the sweep drops
  if (kind === 'respot') {
    motor(out, sr, 0.2, 0.7, 0.1, 620, 430, rand);               // the deck comes down over the leave
    add('clunk', 0.75, 0.32);                                    // ...and grips it
    motor(out, sr, 0.8, 1.3, 0.1, 430, 620, rand);               // up with the leave
    add('clunk', 1.35, 0.3);
    scrape(out, sr, 1.45, 2.0, 0.22, rand);                      // the deadwood is swept
    for (let i = 0; i < 5; i++) add('clack', 1.45 + rand() * 0.5, 0.12 + rand() * 0.2);
    for (let i = 0; i < 3; i++) add('pit', 1.7 + rand() * 0.4, 0.35);
    add('clunk', 2.05, 0.3);
    motor(out, sr, 2.1, 2.6, 0.1, 620, 430, rand);               // the leave set back down
    const k = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < k; i++) { const t = 2.65 + rand() * 0.04; add('thud', t, 0.22); add('clack', t, 0.08); }
  } else {
    scrape(out, sr, 0.35, 1.05, 0.28, rand);                     // the rake takes every pin to the pit
    for (let i = 0; i < 10; i++) add('clack', 0.35 + rand() * 0.7, 0.15 + rand() * 0.3);
    for (let i = 0; i < 6; i++) add('pit', 0.6 + rand() * 0.8, 0.35);
    add('clunk', 1.25, 0.32);
    motor(out, sr, 1.6, 2.4, 0.11, 620, 420, rand);              // the deck comes down with a new rack
    for (let i = 0; i < 10; i++) { const t = 2.45 + rand() * 0.05; add('thud', t, 0.2); add('clack', t, 0.07); }
    add('clunk', 2.55, 0.35);
  }
  motor(out, sr, 2.7, 3.25, 0.1, 420, 620, rand);                // the deck goes up
  add('clunk', 3.3, 0.42);
  add('clunk', 3.45, 0.38);                                      // and the sweep lifts
  fadeTail(buf, 0.1);
  return normalize(buf, 0.16);
}

// The ball coming back: the return track under the lanes, the lift, the clack on the rack
export function renderBallReturn(seed, sr = 22050) {
  const rand = rng(seed);
  const buf = makeBuf(sr, 2.8, 1), out = buf.ch[0];
  const S = (type) => renderImpact(type, Math.floor(rand() * 1e9), sr).ch[0];
  const lp = onePole(220, sr);
  let y = 0;
  const n1 = Math.round(1.75 * sr);
  for (let i = 0; i < n1; i++) {
    const u = i / n1;
    y += lp * ((rand() * 2 - 1) - y);
    out[i] += y * 2.2 * Math.pow(u, 1.5) * (1 + 0.25 * Math.sin(TAU * 8 * i / sr));
  }
  for (let t = 0.6; t < 1.7; t += 0.32 + rand() * 0.08) mix(buf, S('thud'), t, 0.12 * t);   // the joints of the track
  mix(buf, S('cushion'), 1.72, 0.7);                              // the lift
  motor(out, sr, 1.65, 1.95, 0.08, 880, 980, rand);
  const lp2 = onePole(600, sr), s0 = Math.round(1.9 * sr), n2 = Math.round(0.25 * sr);
  y = 0;
  for (let i = 0; i < n2; i++) { y += lp2 * ((rand() * 2 - 1) - y); out[s0 + i] += y * 0.9 * Math.sin(Math.PI * i / n2); }
  mix(buf, S('ballClack'), 2.16, 0.9);
  mix(buf, S('ballClack'), 2.29, 0.35);
  fadeTail(buf, 0.08);
  return normalize(buf, 0.18);
}

// The bumper rails: a motor that rises (or falls) in pitch, then the two rails stop
export function renderBumper(up, seed, sr = 22050) {
  const rand = rng(seed);
  const buf = makeBuf(sr, 1.35, 1), out = buf.ch[0];
  motor(out, sr, 0.0, 0.95, 0.16, up ? 300 : 520, up ? 520 : 300, rand);
  const c = renderImpact('clunk', Math.floor(rand() * 1e9), sr).ch[0];
  mix(buf, c, 0.95, 0.5);
  mix(buf, renderImpact('clunk', Math.floor(rand() * 1e9), sr).ch[0], 1.0 + rand() * 0.03, 0.42);
  fadeTail(buf, 0.06);
  return normalize(buf, 0.16);
}

// The lane console's soft chime: two tones, rising (the warm-up starts) or falling (it ends)
export function renderChime(up, sr = 22050) {
  const buf = makeBuf(sr, 0.75, 1), out = buf.ch[0];
  const notes = up ? [659.3, 880] : [880, 659.3];
  notes.forEach((f, k) => {
    const s0 = Math.round(k * 0.2 * sr), n = Math.round(0.5 * sr);
    for (let i = 0; i < n && s0 + i < out.length; i++) {
      const t = i / sr, e = Math.min(1, t / 0.004) * Math.exp(-t / 0.16);
      out[s0 + i] += (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t) + 0.08 * Math.sin(TAU * 3 * f * t)) * e;
    }
  });
  fadeTail(buf, 0.05);
  return normalize(buf, 0.15);
}

// ---- other lanes --------------------------------------------------------------------------------------
// A ball rolling away down another lane: the release, then a rumble that fades as it goes
export function renderFarRoll(seed, sr = 22050) {
  const rand = rng(seed);
  const buf = makeBuf(sr, 2.7, 1), out = buf.ch[0];
  mix(buf, renderImpact('drop', Math.floor(rand() * 1e9), sr).ch[0], 0.0, 0.6);
  const lp = onePole(260, sr), n = out.length;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    y += lp * ((rand() * 2 - 1) - y);
    out[i] += y * 2.4 * Math.min(1, t / 0.1) / (1 + 1.2 * t) * (1 + 0.15 * Math.sin(TAU * 9 * t));
  }
  fadeTail(buf, 0.3);
  return normalize(buf, 0.16);
}
// The pins of another lane: more pins, a longer and denser crash; dulled by the distance
export function renderFarCrash(pins, seed, sr = 22050) {
  const rand = rng(seed);
  const buf = makeBuf(sr, 1.2, 1), out = buf.ch[0];
  const S = (type) => renderImpact(type, Math.floor(rand() * 1e9), sr).ch[0];
  const k = clamp(pins, 1, 10);
  mix(buf, S('ballHit'), 0, 1);
  for (let i = 0; i < k * 2; i++) mix(buf, S('clack'), 0.02 + rand() * 0.4 * (k / 10 + 0.3), 0.25 + rand() * 0.45);
  for (let i = 0; i < k; i++) mix(buf, S('thud'), 0.12 + rand() * 0.5, 0.3 + rand() * 0.3);
  for (let i = 0; i < Math.ceil(k * 0.6); i++) mix(buf, S('pit'), 0.3 + rand() * 0.5, 0.25);
  mix(buf, S('cushion'), 0.35, 0.6);
  const a = onePole(3200, sr);
  let y = 0;
  for (let i = 0; i < out.length; i++) { y += a * (out[i] - y); out[i] = y; }
  fadeTail(buf, 0.1);
  return normalize(buf, 0.12 + 0.012 * k);
}

// ---- the hall ---------------------------------------------------------------------------------------
// The hall's room tone: the ventilation, far below everything else (a one-pole 160 Hz lowpass of
// white noise, about -44 dBFS RMS). A seamless loop, stereo.
export function renderRoomTone(seed, { sr = 11025, seconds = 12 } = {}) {
  const rand = rng(seed), fade = 2;
  const buf = makeBuf(sr, seconds + fade, 2);
  const lp = onePole(160, sr);
  for (let c = 0; c < 2; c++) {
    const ch = buf.ch[c];
    let y = 0;
    for (let i = 0; i < ch.length; i++) { y += lp * ((rand() * 2 - 1) - y); ch[i] = y * 0.05; }
  }
  // a seamless loop: the extra seconds are crossfaded into the start
  const n = Math.round(seconds * sr), f = Math.round(fade * sr);
  const res = makeBuf(sr, seconds, 2);
  for (let c = 0; c < 2; c++) {
    const src = buf.ch[c], dst = res.ch[c];
    for (let i = 0; i < n; i++) {
      if (i < f) { const k = i / f; dst[i] = src[i] * Math.sin(k * Math.PI / 2) + src[n + i] * Math.cos(k * Math.PI / 2); }
      else dst[i] = src[i];
    }
  }
  return res;
}

// The hall's reverb: a few early reflections and a dense tail that decays (RT60) and dulls
// with time, as a large room with a carpet and ceiling tiles does. Stereo, decorrelated.
export function renderImpulse(sr, seconds = 1.6, rt60 = 1.4, seed = 7) {
  const rand = rng(seed);
  const buf = makeBuf(sr, seconds, 2), n = buf.ch[0].length;
  const pre = Math.round(0.018 * sr);
  const early = [[0.011, 0.5], [0.019, 0.42], [0.027, 0.36], [0.036, 0.3], [0.047, 0.26], [0.061, 0.22]];
  for (let c = 0; c < 2; c++) {
    const ch = buf.ch[c];
    early.forEach(([t, g], i) => { const j = Math.round((t + (c ? 0.0017 : 0) * (i % 2 ? 1 : -1)) * sr) + pre; if (j < n) ch[j] += g * (rand() < 0.5 ? -1 : 1) * (i % 2 === c ? 1 : 0.7); });
    let y = 0, a = 1;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      if (((i - pre) & 63) === 0) a = onePole(7000 * Math.exp(-t * 1.3) + 1200, sr);   // dulls with time
      y += a * ((rand() * 2 - 1) - y);
      ch[i] += y * Math.exp(-6.9 * t / rt60) * Math.min(1, t / 0.03) * 0.5;
    }
  }
  return buf;
}

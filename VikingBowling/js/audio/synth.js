// ---------------------------------------------------------------------------
// synth.js - every sound of the game, synthesised in JavaScript into plain sample arrays.
//
// No sound files and no Web Audio in here: each function returns { sr, ch: [Float32Array, ...] }
// (one array per channel), so the same code renders in the browser (js/audio/hallaudio.js turns
// the arrays into AudioBuffers) and in node (tests/audio_test.mjs writes them to WAV files).
// Every render takes a seed, so a variant can be made again and a new seed gives a new variant.
//
//   the crowd      renderCrowd(kind)      wordless shouts from formant-filtered voices: "yeah",
//                                         "woo", "whoa", "oh", "aww", "ooh", sighs; whistles
//                  renderApplause(size)   single claps (filtered noise bursts), one clapper at a time
//   the lane       renderImpact(type)     modal synthesis: a pin's clack, a pin on the deck, the
//                                         ball meeting a pin, the kickback, the pit, the cushion
//                  renderRollTexture()    the noise the rolling ball is filtered from (in real time)
//   the machine    renderPinsetter(kind)  sweep, deadwood, a new rack set or the leave respotted
//                  renderBallReturn()     the return track, the lift, the clack on the rack
//                  renderBumper(up)       the bumper rails rising or lowering
//   the hall       murmurJob()            the hall's murmur: distant talkers, laughs, room tone
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

// A band-limited sawtooth (polyBLEP)
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

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

// ---- voices ----------------------------------------------------------------------------------
// The vowels' first three formants (Hz, an adult male voice; Peterson & Barney 1952). A female
// voice has them about 16 % higher.
const V = {
  i: [270, 2290, 3010], e: [530, 1840, 2480], ae: [660, 1720, 2410], a: [730, 1090, 2440],
  aw: [620, 1000, 2500], o: [470, 820, 2450], u: [300, 870, 2240], uh: [640, 1190, 2390], n: [260, 1300, 2300]
};
const VOWEL_LIST = ['i', 'e', 'ae', 'a', 'aw', 'o', 'u', 'uh'];

// One voice: a sawtooth (the vocal folds) plus breath noise through three formant filters,
// with a pitch contour, vibrato, a slow random wander of the pitch and an amplitude contour.
//   o: { t0, dur, f0: [[u, Hz]], formants: [[u, F1, F2, F3]], amp: [[u, a]], k (formant scale),
//        breath 0..1, vib (semitones), vibRate (Hz), jitter, gain, pan, lp (Hz, distance) }
export function voice(buf, o, rand) {
  const sr = buf.sr, L = buf.ch[0], R = buf.ch[1];
  const n = Math.round(o.dur * sr), s0 = Math.round(o.t0 * sr);
  const [pl, pr] = panGains(o.pan || 0), g = o.gain ?? 1;
  const f1 = new Biquad(), f2 = new Biquad(), f3 = new Biquad();
  const k = o.k || 1, g2 = o.g2 ?? 0.55, g3 = o.g3 ?? 0.3, breath = o.breath ?? 0.15;
  const vibD = o.vib ?? 0.2, vibR = o.vibRate ?? 5.5, vibPh = rand() * TAU, jitK = o.jitter ?? 1;
  const lpA = o.lp ? onePole(o.lp, sr) : 0;
  let ph = rand(), jit = 0, env = 0, a = 0, f0 = 100, shim = 1, lpY = 0;
  const envK = 1 - Math.exp(-1 / (0.012 * sr));
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j >= L.length) break;
    if ((i & 31) === 0) {
      const u = i / n;
      const fm = at(o.formants, u);
      f1.set('bp', fm[1] * k, fm[1] * k / 90, sr);
      f2.set('bp', fm[2] * k, fm[2] * k / 120, sr);
      f3.set('bp', fm[3] * k, fm[3] * k / 170, sr);
      jit += (rand() - 0.5) * 0.25 - jit * 0.03;
      const st = vibD * Math.sin(vibPh + TAU * vibR * i / sr) + jit * jitK;
      f0 = at(o.f0, u)[1] * Math.pow(2, st / 12);
      a = at(o.amp, u)[1];
      shim = 1 + (rand() - 0.5) * 0.15;
    }
    env += (a * shim - env) * envK;
    const dt = f0 / sr;
    ph += dt; if (ph >= 1) ph -= 1;
    const saw = 2 * ph - 1 - blep(ph, dt);
    const src = saw * (1 - breath) + (rand() * 2 - 1) * breath * 1.2;
    let y = f1.run(src) + g2 * f2.run(src) + g3 * f3.run(src);
    if (lpA) { lpY += lpA * (y - lpY); y = lpY; }
    y *= env * g;
    if (j < 0) continue;
    if (R) { L[j] += y * pl; R[j] += y * pr; } else L[j] += y;
  }
}

// A short hiss ("s" at the end of "yes", a consonant in the murmur)
function fricative(buf, t0, dur, f, gain, pan, rand) {
  const sr = buf.sr, n = Math.round(dur * sr), s0 = Math.round(t0 * sr);
  const bp = new Biquad().set('bp', Math.min(f, sr * 0.42), 1.4, sr);
  const [pl, pr] = panGains(pan), L = buf.ch[0], R = buf.ch[1];
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j >= L.length) break;
    const e = Math.sin(Math.PI * i / n);
    const y = bp.run(rand() * 2 - 1) * e * gain;
    if (j < 0) continue;
    if (R) { L[j] += y * pl; R[j] += y * pr; } else L[j] += y;
  }
}

// The words of the crowd, as pitch, vowel and loudness contours. base: the voice's pitch (Hz)
function utter(kind, base, rand) {
  const r = (a, b) => a + (b - a) * rand();
  const P = (pts) => pts.map(([u, m]) => [u, base * m]);
  switch (kind) {
    case 'yeah': return { dur: r(0.42, 0.8), f0: P([[0, 1], [0.22, 1.32], [0.6, 1.22], [1, 0.88]]),
      formants: [[0, ...V.i], [0.18, ...V.e], [0.45, ...V.ae], [1, ...V.a]], amp: [[0, 0], [0.07, 1], [0.65, 0.85], [1, 0]], breath: 0.14 };
    case 'yeahLong': return { dur: r(1.0, 1.7), f0: P([[0, 1], [0.15, 1.4], [0.7, 1.32], [1, 0.9]]),
      formants: [[0, ...V.i], [0.1, ...V.e], [0.25, ...V.ae], [1, ...V.a]], amp: [[0, 0], [0.05, 1], [0.75, 0.9], [1, 0]], breath: 0.16 };
    case 'yes': return { dur: r(0.32, 0.45), f0: P([[0, 1.05], [0.3, 1.35], [1, 1.1]]), s: true,
      formants: [[0, ...V.i], [0.25, ...V.e], [1, ...V.e]], amp: [[0, 0], [0.1, 1], [0.75, 0.8], [0.9, 0], [1, 0]], breath: 0.12 };
    case 'woo': return { dur: r(0.7, 1.3), f0: P([[0, 1.15], [0.3, 1.75], [0.75, 1.85], [1, 1.35]]),
      formants: [[0, ...V.u], [1, 330, 850, 2350]], amp: [[0, 0], [0.12, 1], [0.8, 0.9], [1, 0]], breath: 0.12, g2: 0.35, g3: 0.15 };
    case 'whoa': return { dur: r(0.8, 1.2), f0: P([[0, 0.95], [0.45, 1.5], [1, 1.2]]),
      formants: [[0, ...V.u], [0.25, ...V.o], [0.6, ...V.a], [1, ...V.a]], amp: [[0, 0], [0.1, 1], [0.8, 0.9], [1, 0]], breath: 0.16 };
    case 'aah': return { dur: r(1.5, 2.5), f0: P([[0, 1], [0.2, 1.3], [0.8, 1.25], [1, 0.95]]),
      formants: [[0, ...V.ae], [0.2, ...V.a], [1, ...V.a]], amp: [[0, 0], [0.1, 1], [0.8, 0.85], [1, 0]], breath: 0.3 };
    case 'oh': return { dur: r(0.75, 1.15), f0: P([[0, 1.22], [0.18, 1.3], [1, 0.78]]),
      formants: [[0, ...V.o], [1, 430, 780, 2450]], amp: [[0, 0], [0.08, 1], [0.5, 0.7], [1, 0]], breath: 0.25, g2: 0.4 };
    case 'ohno': return { dur: r(1.0, 1.3), f0: P([[0, 1.2], [0.2, 1.3], [0.45, 1.1], [0.55, 1.15], [1, 0.75]]),
      formants: [[0, ...V.o], [0.42, ...V.o], [0.5, ...V.n], [0.58, ...V.o], [1, ...V.o]],
      amp: [[0, 0], [0.06, 1], [0.4, 0.8], [0.5, 0.2], [0.58, 0.85], [1, 0]], breath: 0.22, g2: 0.4 };
    case 'aww': return { dur: r(1.0, 1.5), f0: P([[0, 1.12], [0.15, 1.35], [1, 0.74]]),
      formants: [[0, ...V.aw], [1, 600, 950, 2450]], amp: [[0, 0], [0.08, 1], [0.55, 0.75], [1, 0]], breath: 0.2 };
    case 'ooh': return { dur: r(0.65, 1.0), f0: P([[0, 1], [0.4, 1.45], [1, 1.25]]),
      formants: [[0, ...V.u], [1, 420, 820, 2400]], amp: [[0, 0], [0.1, 1], [0.8, 0.9], [1, 0]], breath: 0.15, g2: 0.4 };
    case 'sigh': return { dur: r(1.0, 1.5), f0: P([[0, 1.05], [1, 0.72]]),
      formants: [[0, 650, 1300, 2500], [1, 520, 1100, 2400]], amp: [[0, 0], [0.22, 1], [0.6, 0.6], [1, 0]], breath: 0.7 };
    default: return utter('yeah', base, rand);
  }
}

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

// The crowd's reactions. Each is a small group of voices (men about 140-195 Hz and women about
// 235-320 Hz when excited, 60/40), starting at their own reaction time, at their own place.
//   [kind, count, delay from, delay to, words...]   later: a second shout of some of them
const CROWD = {
  yeah:  { dur: 1.5, groups: [[2, 3, 0.03, 0.28, ['yeah', 'yeah', 'yes', 'woo']]] },
  cheer: { dur: 2.4, groups: [[5, 6, 0.0, 0.32, ['yeahLong', 'yeah', 'woo', 'yes', 'yeah']], [1, 2, 0.65, 1.0, ['woo', 'yeah']]] },
  roar:  { dur: 4.0, groups: [[9, 11, 0.0, 0.5, ['aah', 'yeahLong', 'woo', 'yeah', 'aah']], [5, 6, 0.8, 2.3, ['woo', 'yeah', 'yeahLong', 'yes']],
    [5, 6, 0.1, 0.8, ['aah', 'yeahLong'], 1600]], whistles: [0.35, 1.5] },
  whoa:  { dur: 2.0, groups: [[3, 4, 0.0, 0.15, ['whoa']], [2, 2, 0.7, 1.0, ['yeah', 'woo']]] },
  oh:    { dur: 1.7, groups: [[2, 3, 0.0, 0.2, ['oh', 'ohno', 'oh']], [0, 1, 0.3, 0.5, ['sigh']]] },
  aww:   { dur: 1.9, groups: [[3, 4, 0.0, 0.18, ['aww', 'aww', 'oh']]] },
  ooh:   { dur: 1.4, groups: [[3, 3, 0.0, 0.15, ['ooh']]] },
  sigh:  { dur: 1.9, groups: [[2, 2, 0.0, 0.25, ['sigh']], [0, 1, 0.1, 0.3, ['oh']]] },
  whistle: { dur: 1.4, groups: [], whistles: [0.02] }
};
export const CROWD_KINDS = Object.keys(CROWD);
// how loud each is (the loudest 50 ms, RMS): a bigger crowd is louder as well as fuller
const CROWD_LOUDNESS = { yeah: 0.16, cheer: 0.2, roar: 0.25, whoa: 0.2, oh: 0.17, aww: 0.18, ooh: 0.16, sigh: 0.14, whistle: 0.15 };

// Run a render job (a generator that yields between its parts and returns the buffer) at once
export function runJob(it) { let r; do { r = it.next(); } while (!r.done); return r.value; }

export function renderCrowd(kind, seed, sr = 16000) { return runJob(crowdJob(kind, seed, sr)); }
// ...a voice at a time, so the browser can render it in small idle slices
export function* crowdJob(kind, seed, sr = 16000) {
  const spec = CROWD[kind] || CROWD.yeah, rand = rng(seed);
  const buf = makeBuf(sr, spec.dur, 2);
  for (const [lo, hi, d0, d1, words, lp] of spec.groups) {
    const count = lo + Math.floor(rand() * (hi - lo + 1));
    for (let v = 0; v < count; v++) {
      const female = rand() < 0.4;
      const base = female ? 235 + rand() * 85 : 140 + rand() * 55;
      const u = utter(words[Math.floor(rand() * words.length)], base, rand);
      const t0 = d0 + rand() * (d1 - d0);
      const dur = Math.min(u.dur, spec.dur - t0 - 0.05);
      if (dur < 0.2) continue;
      const pan = (rand() - 0.5) * 1.3;
      const gain = (lp ? 0.35 : 0.6) + rand() * 0.4;
      voice(buf, { ...u, t0, dur, k: female ? 1.16 : 1, pan, gain, lp, vib: 0.15 + rand() * 0.2, vibRate: 4.8 + rand() * 1.5 }, rand);
      if (u.s) fricative(buf, t0 + dur * 0.82, 0.13, 5200, 0.25 * gain, pan, rand);
      yield;
    }
  }
  for (const w of spec.whistles || []) whistle(buf, w + rand() * 0.15, 0.25, (rand() - 0.5) * 1.2, rand);
  fadeTail(buf, 0.1);
  return normalize(buf, CROWD_LOUDNESS[kind] || 0.2);
}

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
// The hall's murmur, rendered talker by talker (a generator: the caller runs one step at a time
// when the browser is idle). Each talker speaks in phrases of syllables - a vowel, a pitch that
// falls through the phrase, now and then a hiss - with pauses, and now and then laughs; far
// away (dulled) and somewhere in the hall. Under it the room tone. A seamless loop.
export function* murmurJob(seed, out, { sr = 11025, seconds = 12, talkers = 9 } = {}) {
  const rand = rng(seed), fade = 2;
  const buf = makeBuf(sr, seconds + fade, 2);
  const total = seconds + fade;
  for (let k = 0; k < talkers; k++) {
    const female = rand() < 0.45;
    const base = female ? 185 + rand() * 50 : 100 + rand() * 40;
    const g = 0.25 + 0.75 * Math.pow(rand(), 1.5), pan = (rand() - 0.5) * 1.6, lp = 900 + rand() * 900;
    let t = rand() * 2;
    while (t < total - 0.3) {
      const phrase = 0.8 + rand() * 3, rate = 3.8 + rand() * 2;
      const end = Math.min(total - 0.2, t + phrase);
      if (rand() < 0.05) {                                          // a laugh
        const n = 4 + Math.floor(rand() * 3);
        for (let h = 0; h < n && t < end; h++) {
          voice(buf, { t0: t, dur: 0.16, f0: [[0, base * 1.5], [1, base * 1.35]], formants: [[0, ...V.a], [1, ...V.a]],
            amp: [[0, 0], [0.25, 1], [1, 0]], breath: 0.45, k: female ? 1.16 : 1, gain: g, pan, lp, vib: 0 }, rand);
          t += 0.19 + rand() * 0.03;
        }
      } else {
        const s0 = t;
        while (t < end) {
          const d = (1 / rate) * (0.7 + rand() * 0.6);
          const decl = 1.15 - 0.25 * (t - s0) / phrase;
          const f = base * decl * (0.92 + rand() * 0.16);
          const v1 = V[VOWEL_LIST[Math.floor(rand() * VOWEL_LIST.length)]], v2 = V[VOWEL_LIST[Math.floor(rand() * VOWEL_LIST.length)]];
          voice(buf, { t0: t, dur: d, f0: [[0, f * 1.04], [1, f * 0.96]], formants: [[0, ...v1], [1, ...v2]],
            amp: [[0, 0], [0.3, 1], [0.7, 0.8], [1, 0]], breath: 0.18, k: female ? 1.16 : 1, gain: g, pan, lp, vib: 0, jitter: 0.5 }, rand);
          if (rand() < 0.3) fricative(buf, t, 0.05, 2400, 0.08 * g, pan, rand);
          t += d;
        }
      }
      t += 0.3 + rand() * 1.6;
    }
    yield k;
  }
  // the room tone: ventilation, far below everything else
  const lp = onePole(160, sr);
  for (let c = 0; c < 2; c++) {
    const ch = buf.ch[c];
    let y = 0;
    for (let i = 0; i < ch.length; i++) { y += lp * ((rand() * 2 - 1) - y); ch[i] += y * 0.05; }
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
  normalize(res, 0.12);
  out.buf = res;
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

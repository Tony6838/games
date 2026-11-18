// sound.js - the ball's roll and the pins, synthesised with Web Audio (no sound files).
export class Sound {
  constructor() { this.ctx = null; this.on = true; this.roll = null; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
  }

  noise(seconds) {
    const c = this.ctx, n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // The ball rolling: low filtered noise; speed 0..1 sets the level
  startRoll() {
    if (!this.on || !this.ctx) return;
    this.stopRoll();
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise(2); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = c.createGain(); g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.35, c.currentTime + 0.15);
    src.connect(lp).connect(g).connect(c.destination);
    src.start();
    this.roll = { src, g };
  }
  stopRoll() {
    if (!this.roll || !this.ctx) return;
    const { src, g } = this.roll;
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.25);
    src.stop(this.ctx.currentTime + 0.3);
    this.roll = null;
  }

  // Pins: a burst of short wooden clacks, more for a bigger hit
  crash(power = 1) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx;
    const hits = Math.max(2, Math.round(power * 14));
    for (let i = 0; i < hits; i++) {
      const t = c.currentTime + Math.random() * 0.45 * Math.min(1, power + 0.2);
      const src = c.createBufferSource(); src.buffer = this.noise(0.08);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 1800; bp.Q.value = 6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * (0.4 + Math.random() * 0.6), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(bp).connect(g).connect(c.destination);
      src.start(t);
    }
  }

  // A short fanfare for a strike
  fanfare(notes = [523, 659, 784, 1046]) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx;
    notes.forEach((f, i) => {
      const t = c.currentTime + 0.25 + i * 0.09;
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.4);
    });
  }
}

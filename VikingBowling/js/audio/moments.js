// ---------------------------------------------------------------------------
// moments.js - the lights over the player's lanes brighten for a moment on a big ball (a
// strike, a turkey, a converted split), as a centre's lane lights do. Subtle: the pin-deck
// lamp and the warm lamps behind the valances (scene.gameLights()) go up by at most 85 % and
// fade back within a second, in one pulse or a few. Only light intensities change, so nothing
// is compiled or re-rendered and the frame costs nothing extra.
// ---------------------------------------------------------------------------
export class LaneFlash {
  constructor(scene) {
    this.scene = scene;
    this.pulses = [];       // [{ at: seconds from now, k: strength }]
    this.time = 0;
    this.base = null;
    this.lights = null;
  }

  // strength 0..1, pulses 1..5 (0.32 s apart)
  trigger(strength, pulses = 1) {
    for (let i = 0; i < pulses; i++) this.pulses.push({ at: this.time + i * 0.32, k: strength * (i === 0 ? 1 : 0.8) });
  }

  update(dt) {
    this.time += dt;
    const lights = this.scene && this.scene.gameLights ? this.scene.gameLights() : null;
    if (!lights || !lights.length) return;
    if (!this.pulses.length) {
      // at rest: remember the lights as the hall set them (a detail change may have changed them)
      if (this.lights !== lights || !this.base || this.base.length !== lights.length || this.active) {
        if (this.active && this.base && this.lights === lights) lights.forEach((l, i) => { l.intensity = this.base[i]; });
        this.lights = lights;
        this.base = lights.map((l) => l.intensity);
        this.active = false;
      }
      return;
    }
    if (!this.base || this.lights !== lights) { this.lights = lights; this.base = lights.map((l) => l.intensity); }
    let env = 0;
    for (const p of this.pulses) {
      const t = this.time - p.at;
      if (t < 0) continue;
      env += p.k * (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / 0.3));
    }
    this.pulses = this.pulses.filter((p) => this.time - p.at < 1.6);
    const f = 1 + 0.85 * Math.min(1, env);
    lights.forEach((l, i) => { l.intensity = this.base[i] * f; });
    this.active = true;
  }
}

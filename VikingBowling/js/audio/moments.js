// ---------------------------------------------------------------------------
// moments.js - the lights over the player's lanes brighten for a moment on a big ball (a
// strike, a turkey, a converted split), as a centre's lane lights do. Subtle: the pin-deck
// lamp and the warm lamps behind the valances (scene.gameLights()) go up by at most 85 % and
// fade back within a second, in one pulse or a few. Only light intensities change, so nothing
// is compiled or re-rendered and the frame costs nothing extra.
// A flash always scales the lights' resting intensities (read while no pulse is lit), never the
// intensities of the frame before, and puts them back exactly when its last pulse has faded, so
// flashes cannot add up, whatever the frame rate. (They once did: the lights were compared by
// the array gameLights() returned, a new one every call, so every frame of a flash took the
// brightened lights as the new resting ones - a strike left them thousands of times too bright,
// more on a faster screen, and the lane and the pins turned white.)
// ---------------------------------------------------------------------------
export const FLASH_GAIN = 0.85;     // the most a flash adds to the lights (+85 %)

export class LaneFlash {
  constructor(scene) {
    this.scene = scene;
    this.pulses = [];       // [{ at: seconds from now, k: strength }]
    this.time = 0;
    this.base = null;       // the lights' resting intensities
    this.lights = null;     // the lights they belong to
    this.active = false;    // the lights are brightened now
  }

  // strength 0..1, pulses 1..5 (0.32 s apart)
  trigger(strength, pulses = 1) {
    for (let i = 0; i < pulses; i++) this.pulses.push({ at: this.time + i * 0.32, k: strength * (i === 0 ? 1 : 0.8) });
  }

  update(dt) {
    this.time += dt;
    const lights = this.scene && this.scene.gameLights ? this.scene.gameLights() : null;
    if (!lights || !lights.length) return;
    // other lights than before (compared light by light: the list may be a new array every call):
    // the old ones go back to rest, the new ones' intensities are their resting ones
    const same = !!this.lights && this.lights.length === lights.length && lights.every((l, i) => l === this.lights[i]);
    if (!same) {
      if (this.active) this.restore();
      this.lights = lights.slice();
      this.base = lights.map((l) => l.intensity);
    }
    if (!this.pulses.length) {
      // at rest: put the lights back after a flash, or take them as the hall set them now
      if (this.active) this.restore();
      else this.base = this.lights.map((l) => l.intensity);
      return;
    }
    let env = 0;
    for (const p of this.pulses) {
      const t = this.time - p.at;
      if (t < 0) continue;
      env += p.k * (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / 0.3));
    }
    this.pulses = this.pulses.filter((p) => this.time - p.at < 1.6);
    const f = 1 + FLASH_GAIN * Math.min(1, env);
    this.lights.forEach((l, i) => { l.intensity = this.base[i] * f; });
    this.active = true;
  }

  // the lights at their resting intensities
  restore() {
    this.lights.forEach((l, i) => { l.intensity = this.base[i]; });
    this.active = false;
  }
}

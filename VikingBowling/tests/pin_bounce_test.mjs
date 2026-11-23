// The pins must not bounce more than pins do: node tests/pin_bounce_test.mjs
// With the frame times of real displays (the browser's frame clock in steps of 0.1 ms, or 1 ms as Safari's),
// because what a display does to the sub-steps is what made the pins hop (js/sim3d/physics.js, step):
//   1. a pin dropped flat on the deck comes up with a fraction of its landing speed, and the same on every display
//   2. a throw, and the next ones on the re-racked lane, leave the same pins after the same time on every display
//   3. after a throw nothing is thrown up late: no energy made on the deck and in the gutters, no high hop
//   4. a re-racked pin has the inertia of a new one
//   5. a machine player's ball: the pins made to fall late fall, with a believable spin and no flight
//   6. the pit takes a pin instead of throwing it back
//   7. what is drawn moves evenly on every display
import * as CANNON from 'cannon-es';
import { LanePhysics, LANE, PIN_PROFILE } from '../js/sim3d/physics.js';

let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; return ok; };
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// the frame times of a display: its clock's times, rounded to q ms, one after the other
const display = (hz, q = 0.1) => { let n = 0, last = 0; return () => { const t = Math.round(++n * 1000 / hz / q) * q, d = t - last; last = t; return d / 1000; }; };
const uneven = () => { const r = seeded(17); return () => 0.004 + r() * 0.026; };
const DISPLAYS = [
  ['60 Hz', () => display(60)], ['60 Hz, a 1 ms clock', () => display(60, 1)], ['75 Hz', () => display(75)], ['90 Hz', () => display(90)],
  ['120 Hz', () => display(120)], ['144 Hz', () => display(144)], ['uneven frames of 4-30 ms', uneven]
];
const FIXED = () => () => 1 / 60;

// the height of a pin's lowest point
function lowest(b) {
  const q = b.quaternion, up = 1 - 2 * (q.x * q.x + q.z * q.z), s = Math.sqrt(Math.max(0, 1 - up * up));
  let m = Infinity;
  for (const [h, r] of PIN_PROFILE) m = Math.min(m, b.position.y + up * (h - 0.150) - r * s);
  return m;
}
function energy(b) {
  const w = b.quaternion.inverse().vmult(b.angularVelocity), I = b.inertia;
  return 0.5 * LANE.pinMass * b.velocity.lengthSquared() + 0.5 * (I.x * w.x * w.x + I.y * w.y * w.y + I.z * w.z * w.z) + LANE.pinMass * 9.81 * b.position.y;
}
// one pin alone on the lane, tilted about x, its lowest point at height y
function onePin({ y, tilt, z = -17, v = [0, 0, 0], w = [0, 0, 0] }) {
  const L = new LanePhysics();
  L.resetPins(1);
  L.state = 'deck'; L.impactTime = 0; L.time = 0;
  const b = L.pins[0].body;
  b.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tilt);
  b.position.set(0, 0, z);
  b.position.y = y - lowest(b);
  b.velocity.set(...v); b.angularVelocity.set(...w);
  b.updateInertiaWorld(true);
  b.wakeUp();
  return [L, b];
}

// ---- 1. a landing ------------------------------------------------------------------------------
{
  const drop = (frames, k) => {
    const [L, b] = onePin({ y: 0.25 + k * 0.004, tilt: -Math.PI / 2 - 0.2 });
    let down = 0, hop = 0, landed = false;
    while (L.time < 1.2) {
      L.step(frames());
      if (!landed && lowest(b) < 0.002) landed = true;
      if (!landed) down = Math.max(down, -b.velocity.y); else hop = Math.max(hop, lowest(b));
    }
    return [down, hop];
  };
  for (const [name, make] of DISPLAYS) {
    let worst = 0, ratio = 0;
    for (let k = 0; k < 16; k++) {
      const [down, hop] = drop(make(), k);
      worst = Math.max(worst, hop);
      ratio = Math.max(ratio, Math.sqrt(2 * 9.81 * hop) / down);
    }
    check(worst < 0.05 && ratio < 0.45, `a pin dropped 25-31 cm flat on the deck, ${name}: hops at most ${(worst * 100).toFixed(1)} cm, ${ratio.toFixed(2)} of its landing speed`);
  }
}

// ---- 2. and 3. throws ---------------------------------------------------------------------------
const aims = [[0.065, 8.0, 28, 0.25], [0.0, 7.0, 24, 0.25], [0.065, 5.0, 0, 0.06], [0.115, 8.5, 28, 0.25]]
  .map(([targetX, speed, side, x0]) => LanePhysics.aim({ targetX, x0, speed, side, roll: 0.5 }));
function throws(frames, watch = null) {
  const L = new LanePhysics(), ends = [];
  for (const a of aims) {
    L.resetPins(0x3FF);
    L.release(a);
    if (watch) watch.start(L);
    let guard = 0;
    while (L.state !== 'done' && guard++ < 5000) L.step(frames());
    if (watch) watch.stop(L);
    ends.push({ mask: L.standingMask(), time: L.events.find((e) => e.type === 'done').t });      // (the frame's last sub-steps run on after it)
  }
  return ends;
}
{
  // what is made on the deck and in the gutters from 1 s after the impact on, when the last pins are still moving
  const seen = { energy: 0, com: 0, hop: 0 };
  const watch = {
    start(L) {
      const step = L.world.step;
      L.world.step = function (h) {
        const before = L.pins.map((p) => energy(p.body));
        step.call(this, h);
        if (L.impactTime == null || L.time - L.impactTime < 1) return;
        L.pins.forEach((p, i) => {
          const b = p.body;
          if (!p.active || b.position.z < -LANE.pitEdge || b.position.y < -0.06 || Math.abs(b.position.x) > LANE.width / 2 + LANE.gutter) return;
          seen.energy += Math.max(0, energy(b) - before[i]);
          seen.com = Math.max(seen.com, b.position.y);
          seen.hop = Math.max(seen.hop, lowest(b));
        });
      };
    },
    stop(L) { delete L.world.step; }
  };
  const want = throws(FIXED());
  for (const [name, make] of DISPLAYS) {
    seen.energy = seen.com = seen.hop = 0;
    const got = throws(make(), watch);
    const same = got.every((g, i) => g.mask === want[i].mask && Math.abs(g.time - want[i].time) < 1e-6);
    check(same, `${aims.length} throws on one lane, ${name}: the pins left and the time of every ball as in 1/60 s frames`);
    check(seen.energy < 3 && seen.com < 0.25 && seen.hop < 0.08,
      `  ... from 1 s after the impact: ${seen.energy.toFixed(2)} J made, highest centre of mass ${(seen.com * 100).toFixed(0)} cm (standing 15), highest off the deck ${(seen.hop * 100).toFixed(1)} cm`);
  }
}

// ---- 4. the re-racked pin -------------------------------------------------------------------------
{
  const L = new LanePhysics();
  const I = L.pins.map((p) => p.body.inertia.clone());
  L.resetPins(0x3FF);
  L.release(aims[0]);
  let guard = 0;
  while (L.state !== 'done' && guard++ < 2000) L.step(1 / 60);
  L.resetPins(0x3FF);
  const off = Math.max(...L.pins.map((p, i) => Math.max(...['x', 'y', 'z'].map((k) => Math.abs(p.body.inertia[k] / I[i][k] - 1)))));
  check(off < 1e-6, `a pin set again after a throw has a new pin's inertia (the most it differs: ${(off * 100).toFixed(1)} %)`);
}

// ---- 5. a machine player's ball ---------------------------------------------------------------------
{
  const random = Math.random;
  Math.random = seeded(11);
  let pins = 0, spin = 0, com = 0, up = 0;
  // the ball takes only the right side of the rack; everything else is made to fall late
  for (const leave of [0, 0x200, 0x008, 0x00A]) for (const targetX of [0.40, 0.30]) {
    const L = new LanePhysics();
    L.resetPins(0x3FF);
    L.release({ ...LanePhysics.aim({ targetX, x0: 0.35, speed: 7.5, side: 0, roll: 0.5 }), forced: { leave } });
    let pushed = [];
    const nudge = L.nudgeForced;
    L.nudgeForced = function () {
      pushed = this.pins.filter((p, i) => p.active && !(leave & (1 << i)) && this.isStanding(p));
      nudge.call(this);
      for (const p of pushed) spin = Math.max(spin, p.body.angularVelocity.length());
    };
    const frames = display(60);
    let guard = 0;
    while (L.state !== 'done' && guard++ < 2000) { L.step(frames()); for (const p of pushed) com = Math.max(com, p.body.position.y); }
    pins += pushed.length;
    up += pushed.filter((p) => L.isStanding(p)).length;
  }
  Math.random = random;
  check(pins > 20 && up === 0, `machine players' balls: all ${pins} pins made to fall late have fallen (still up: ${up})`);
  check(spin < 60 && com < 0.35, `  ... pushed over with a spin of at most ${spin.toFixed(0)} rad/s and never over ${(com * 100).toFixed(0)} cm (centre of mass; standing 15)`);
}

// ---- 6. the pit ---------------------------------------------------------------------------------------
for (const v of [4, 6, 8]) {
  const [L, b] = onePin({ y: 0.05, tilt: -1, z: -18.9, v: [0, 0.3, -v], w: [-15, 0, 0] });
  let back = 0;
  while (L.time < 1.5) { L.step(1 / 60); back = Math.max(back, b.velocity.z); }
  check(back < 0.3 * v, `a pin flying into the pit's cushion at ${v} m/s comes back at ${back.toFixed(2)} m/s`);
}

// ---- 7. what is drawn -----------------------------------------------------------------------------------
for (const [name, make] of DISPLAYS) {
  const L = new LanePhysics(), frames = make();
  L.resetPins(0x3FF);
  L.release({ x0: 0, speed: 8, angle: 0, side: 0, roll: 0.5 });
  let z = L.drawn(L.ball).position.z, off = 0, t = 0;
  while (t < 0.6) {
    const dt = frames();
    L.step(dt);
    t += dt;
    const now = L.drawn(L.ball).position.z;
    off = Math.max(off, Math.abs((z - now) - dt * -L.ball.velocity.z));
    z = now;
  }
  check(off < 0.002, `the ball at 8 m/s is drawn as far on as each frame's time says, ${name}: at most ${(off * 1000).toFixed(2)} mm off`);
}

console.log(failures ? `${failures} FAILED` : 'All pin bounce checks passed');
process.exitCode = failures ? 1 : 0;

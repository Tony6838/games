// Pin-action check for the 3D lane (js/sim3d/physics.js), run in node:
//   node tests/physics_tune.mjs [trials=40]
// Throws balls at the classic impact points and prints how often each leaves a strike and
// the most common leaves. What real bowling looks like: a right-hander's pocket hit (the
// ball meeting the head pin about 6-7 cm right of centre with a few degrees of entry angle)
// strikes most of the time and otherwise leaves single corner pins; a head-on hit splits;
// a light hit leaves the 10-pin side; a straight ball into the pocket carries less.
import { LanePhysics, LANE } from '../js/sim3d/physics.js';
import { globCheckSplit } from '../js/engine/openplay.js';

const trials = parseInt(process.argv[2] || '40', 10);
let seed = 99;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pinsOf = (m) => { const a = []; for (let i = 0; i < 10; i++) if (m & (1 << i)) a.push(i + 1); return a.join('-') || 'X'; };

const SCENARIOS = [
  ['pocket, hook (righty)', { targetX: 0.065, x0: 0.25, speed: 8.0, side: 28 }],
  ['pocket, hook, slower', { targetX: 0.065, x0: 0.25, speed: 6.8, side: 24 }],
  ['light pocket', { targetX: 0.115, x0: 0.25, speed: 8.0, side: 28 }],
  ['high pocket', { targetX: 0.035, x0: 0.25, speed: 8.0, side: 28 }],
  ['head on', { targetX: 0.0, x0: 0.25, speed: 8.0, side: 28 }],
  ['Brooklyn', { targetX: -0.06, x0: 0.25, speed: 8.0, side: 28 }],
  ['straight ball, pocket', { targetX: 0.065, x0: 0.06, speed: 7.5, side: 0 }],
  ['far right (10 pin)', { targetX: 0.42, x0: 0.42, speed: 7.5, side: 0 }]
];

const lane = new LanePhysics();
const t0 = Date.now();
let pocketPct = 0;
for (const [name, s] of SCENARIOS) {
  const aim = LanePhysics.aim(s);
  const counts = new Map();
  let strikes = 0, splits = 0, entryDeg = 0;
  for (let k = 0; k < trials; k++) {
    lane.resetPins(0x3FF);
    lane.release({ x0: aim.x0, speed: aim.speed * (1 + (rnd() - 0.5) * 0.04), angle: aim.angle + (rnd() - 0.5) * 0.0016, side: aim.side * (1 + (rnd() - 0.5) * 0.1), roll: aim.roll });
    let guard = 0;
    while (lane.state !== 'done' && guard++ < 2400) lane.step(1 / 60);
    const m = lane.standingMask();
    if (lane.entry) entryDeg += Math.atan2(lane.entry.vx, -lane.entry.vz) * 180 / Math.PI;
    if (!m) strikes++;
    if (globCheckSplit(m)) splits++;
    counts.set(pinsOf(m), (counts.get(pinsOf(m)) || 0) + 1);
  }
  if (name === SCENARIOS[0][0]) pocketPct = 100 * strikes / trials;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`${name.padEnd(24)} entry ${aim.entry ? (aim.entry.x * 100).toFixed(1) : '?'} cm ${ (entryDeg / trials).toFixed(1)} deg  strike ${(100 * strikes / trials).toFixed(0)}%  split ${(100 * splits / trials).toFixed(0)}%  | ${top}`);
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// The low detail level's budget for the pin crash (main.js, step(dt, budgetMs)): a frame that runs out
// of time drops the rest of its time, so the crash plays slower than real time; the sub-steps are the
// same 1/360 s. (1) Exactly: a budget that runs out at once is one sub-step a frame - the same pins at
// the same time as stepping 1/360 s a frame. (2) The pin action of the pocket hit stepped that way
// against the normal 1/60 s frames (a throw ends the same on any frame time, tests/pin_bounce_test.mjs;
// these are other throws than the ones above, so only the rates compare)
{
  const a = new LanePhysics(), b = new LanePhysics();
  const aim = LanePhysics.aim(SCENARIOS[0][1]);
  let same = 0, strikesBudget = 0;
  const n = trials;
  for (let k = 0; k < n; k++) {
    const r = { x0: aim.x0, speed: aim.speed * (1 + (rnd() - 0.5) * 0.04), angle: aim.angle + (rnd() - 0.5) * 0.0016, side: aim.side * (1 + (rnd() - 0.5) * 0.1), roll: aim.roll };
    for (const L of [a, b]) { L.resetPins(0x3FF); L.release(r); }
    let g = 0;
    while (a.state !== 'done' && g++ < 20000) a.step(a.state === 'deck' ? a.dt : 1 / 60);
    g = 0;
    while (b.state !== 'done' && g++ < 20000) b.step(1 / 60, b.state === 'deck' ? 1e-6 : 0);
    if (a.standingMask() === b.standingMask() && a.time === b.time) same++;
    if (!b.standingMask()) strikesBudget++;
  }
  const ci = (pct) => 196 * Math.sqrt((pct / 100) * (1 - pct / 100) / n);
  console.log(`the pin crash on a budget (one sub-step a frame on the deck): ${same} of ${n} throws exactly as stepping 1/360 s a frame; pocket hook strikes ${(100 * strikesBudget / n).toFixed(0)}% +- ${ci(100 * strikesBudget / n).toFixed(0)} (in 1/60 s frames above: ${pocketPct.toFixed(0)}% +- ${ci(pocketPct).toFixed(0)}; other throws, so only the rates compare)`);
  if (same !== n) { console.log('FAIL the budget did more than take time away'); process.exitCode = 1; }
}

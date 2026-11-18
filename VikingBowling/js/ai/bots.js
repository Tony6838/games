// ---------------------------------------------------------------------------
// bots.js - machine players whose pinfall matches published bowling statistics.
//
// A machine player has an average. Each first ball is drawn by CATEGORY first, with
// the rates of real bowlers of that average (strike, single-pin leave, split, other
// multi-pin leave, gutter), then the exact pins of the leave are drawn from the real
// leave tables, mirrored for a left-hander. Each spare attempt converts with the
// published conversion rate for that kind of leave (single pin - corner pins 1.7x as
// hard - multi-pin, split by split). So the TV gets real pin pictures, and the
// statistics come out as the sources say. See README.md "Machine players" for the
// sources and tests/bot_stats.mjs for the proof.
//
// Sources (numbers marked P are published, E estimated - README has the full list):
//   [1] PBA, Certified Stringpin Statistical Comparisons 2024 (Lanetalk data, 176,442 frames)
//   [3] NTCA 2021-22 National Statistics, team summary (~300,000 frames, 111-210 averages)
//   [4] Bowling This Month, "Plotting a Course for 220", 2020
// ---------------------------------------------------------------------------

// avg, strike, singleLeave, split, gutter, singleConv, multiConv, splitConvScale(PBA=1)
// rows 150-210 from [3] (P), 220 from [4] (P), 225 tour-leader level and 100 (E),
// 130 between [3]'s 126-137 average teams.
const TABLE = [
  [ 80, 0.05, 0.10, 0.07, 0.18, 0.25, 0.10, 0.25],
  [100, 0.10, 0.14, 0.08, 0.14, 0.42, 0.24, 0.35],
  [130, 0.18, 0.18, 0.08, 0.04, 0.54, 0.37, 0.70],
  [150, 0.247, 0.25, 0.097, 0.01, 0.653, 0.454, 0.88],
  [170, 0.333, 0.25, 0.099, 0.004, 0.766, 0.574, 0.94],
  [190, 0.429, 0.25, 0.094, 0.0, 0.855, 0.674, 0.87],
  [200, 0.488, 0.25, 0.086, 0.0, 0.892, 0.713, 0.87],
  [210, 0.531, 0.25, 0.081, 0.0, 0.922, 0.756, 0.86],
  [220, 0.602, 0.24, 0.080, 0.0, 0.951, 0.840, 0.95],
  [228, 0.650, 0.23, 0.075, 0.0, 0.970, 0.870, 1.05]
];

export function profileFor(avg) {
  let i = 0;
  while (i < TABLE.length - 2 && TABLE[i + 1][0] <= avg) i++;
  const a = TABLE[i], b = TABLE[i + 1];
  const t = Math.max(0, Math.min(1, (avg - a[0]) / (b[0] - a[0])));
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  return {
    avg, strike: L(1), single: L(2), split: L(3), gutter: L(4),
    singleConv: L(5), multiConv: L(6), splitScale: L(7),
    // bigger leaves for weaker bowlers: first-ball average 6.6 at 111 ... 9.1 at 208 [3]
    multiSize: avg < 150 ? 4.7 - Math.max(0, avg - 100) / 50 * 1.5 : 3.2 - Math.min(1, (avg - 150) / 60) * 0.3
  };
}

const M = (...pins) => pins.reduce((m, p) => m | (1 << (p - 1)), 0);

// Single-pin leaves, share of frames on the 2024 PBA tour [1] (D) - weights only
const SINGLES = [[10, 9.3], [7, 4.2], [4, 2.5], [9, 1.9], [2, 1.6], [6, 1.5], [3, 0.9], [8, 0.9], [5, 0.4]];
// Splits: [pins, share of frames on tour, tour conversion %] [1] (D)
const SPLITS = [
  [[2, 10], 0.75, 21.2], [[7, 10], 0.72, 0.94], [[2, 8, 10], 0.69, 0.7], [[3, 10], 0.46, 57.7],
  [[2, 4, 8, 10], 0.39, 9.8], [[2, 4, 10], 0.37, 19.5], [[4, 6, 7], 0.34, 0.7], [[4, 6, 7, 10], 0.30, 0.4],
  [[4, 9], 0.28, 17.6], [[4, 10], 0.26, 5.5], [[4, 7, 10], 0.21, 6.5], [[8, 10], 0.20, 1.7],
  [[2, 7], 0.18, 60.6], [[4, 6], 0.17, 0.3], [[6, 7, 10], 0.14, 7.2], [[5, 7], 0.04, 21], [[5, 10], 0.03, 30],
  [[6, 7], 0.10, 3.0], [[7, 9], 0.08, 4.0], [[3, 7], 0.06, 2.0], [[4, 6, 7, 9, 10], 0.05, 0.3], [[6, 7, 9, 10], 0.05, 0.5]
];
// Multi-pin, not split: [pins, share] - the most common from [1], more from amateur play
const MULTIS = [
  [[3, 6, 10], 1.4], [[6, 10], 1.1], [[2, 8], 1.0], [[3, 6], 0.8], [[4, 7], 0.7], [[2, 4], 0.45],
  [[3, 9], 0.4], [[2, 5], 0.3], [[3, 5], 0.3], [[6, 9, 10], 0.35], [[2, 4, 7], 0.35], [[4, 7, 8], 0.3],
  [[2, 4, 5], 0.3], [[3, 5, 6], 0.3], [[3, 6, 9, 10], 0.35], [[2, 4, 7, 8], 0.25], [[2, 4, 5, 8], 0.3],
  [[3, 5, 6, 9], 0.3], [[1, 2], 0.12], [[1, 2, 4], 0.15], [[1, 2, 4, 7], 0.25], [[1, 3, 6, 10], 0.18],
  [[1, 2, 8], 0.1], [[1, 2, 4, 10], 0.1], [[2, 4, 5, 7, 8], 0.25], [[3, 5, 6, 9, 10], 0.25],
  [[1, 2, 4, 7, 8], 0.15], [[1, 3, 6, 9, 10], 0.15], [[1, 2, 3, 4, 7], 0.08], [[2, 4, 5, 7, 8, 9], 0.12],
  [[3, 5, 6, 8, 9, 10], 0.12], [[1, 2, 3, 5, 8], 0.06], [[1, 2, 4, 5, 7, 8], 0.1], [[1, 3, 5, 6, 9, 10], 0.1],
  [[1, 2, 3, 4, 5, 7, 8], 0.05], [[1, 2, 3, 5, 6, 9, 10], 0.05], [[2, 3, 4, 5, 6, 7, 8, 9, 10], 0.02],
  [[1, 2, 3, 4, 5, 6, 7, 8, 9], 0.02], [[5, 8], 0.12], [[5, 9], 0.12], [[6, 9], 0.12], [[4, 8], 0.08], [[2, 5, 8], 0.12], [[3, 5, 9], 0.12]
].map(([p, w]) => ({ mask: M(...p), w, n: p.length }));

const MIRROR = [0, 1, 3, 2, 6, 5, 4, 10, 9, 8, 7];
export function mirrorMask(mask) {
  let out = 0;
  for (let p = 1; p <= 10; p++) if (mask & (1 << (p - 1))) out |= 1 << (MIRROR[p] - 1);
  return out;
}
const popcount = (m) => { let n = 0; for (let i = 0; i < 10; i++) if (m & (1 << i)) n++; return n; };

function pick(list, weightOf, rng) {
  let total = 0;
  for (const x of list) total += weightOf(x);
  let r = rng() * total;
  for (const x of list) { r -= weightOf(x); if (r <= 0) return x; }
  return list[list.length - 1];
}

// ---------------------------------------------------------------------------
export class MachinePlayer {
  constructor({ name, average, leftHanded = false, rng = Math.random }) {
    this.name = name;
    this.average = average;
    this.leftHanded = leftHanded;
    this.rng = rng;
    this.p = profileFor(average);
  }

  hand(mask) { return this.leftHanded ? mirrorMask(mask) : mask; }

  // First ball on a full rack: returns { standing (mask), kind }
  firstBall() {
    const r = this.rng(), p = this.p;
    if (r < p.strike) return { standing: 0, kind: 'strike' };
    if (r < p.strike + p.gutter) return { standing: 0x3FF, kind: 'gutter' };
    if (r < p.strike + p.gutter + p.single) {
      const s = pick(SINGLES, (x) => x[1], this.rng);
      return { standing: this.hand(M(s[0])), kind: 'single' };
    }
    if (r < p.strike + p.gutter + p.single + p.split) {
      const s = pick(SPLITS, (x) => x[1], this.rng);
      return { standing: this.hand(M(...s[0])), kind: 'split', conv: s[2] };
    }
    // other multi-pin leaves, weighted toward the bowler's typical leave size
    const size = p.multiSize;
    const m = pick(MULTIS, (x) => x.w * Math.exp(-Math.pow(x.n - size, 2) / 3.5), this.rng);
    return { standing: this.hand(m.mask), kind: 'multi' };
  }

  // A second ball at `standing` (the pins left by the first). Returns the pins still standing.
  secondBall(standing, firstKind) {
    const p = this.p, rng = this.rng;
    const n = popcount(standing);
    if (n === 0) return 0;
    if (standing === 0x3FF) {                 // a gutter first: the second ball is a new first ball
      const f = this.firstBall();
      return f.standing;
    }
    let conv;
    if (n === 1) {
      const pinNo = Math.log2(standing) + 1;
      const corner = pinNo === 7 || pinNo === 10;
      // corner pins are missed 1.7x as often as the others [1]; keep the overall rate at singleConv
      const miss = 1 - p.singleConv;
      conv = 1 - miss * (corner ? 1.32 : 0.78);
    } else if (firstKind === 'split') {
      const own = this.hand(standing);
      const s = SPLITS.find((x) => M(...x[0]) === own);
      const tour = s ? s[2] / 100 : 0.05;
      conv = Math.min(0.9, tour * p.splitScale);
    } else {
      // multi-pin: harder the more pins and the weaker the bowler; washouts (head pin up) a little harder
      // (the size factors average out to 1 over the leave mix, so the overall rate stays multiConv)
      conv = Math.min(0.99, p.multiConv * (n <= 2 ? 1.12 : n === 3 ? 1.02 : 0.9) * ((standing & 1) ? 0.9 : 1.03));
    }
    if (rng() < conv) return 0;
    // missed: a single pin stays up; otherwise some of the pins fall
    if (n === 1) return standing;
    if (rng() < 0.25) return standing;        // chopped nothing / missed them all
    let left = standing;
    const pins = [];
    for (let i = 0; i < 10; i++) if (standing & (1 << i)) pins.push(i);
    const take = 1 + Math.floor(rng() * (n - 1));
    for (let k = 0; k < take; k++) {
      const idx = Math.floor(rng() * pins.length);
      left &= ~(1 << pins[idx]);
      pins.splice(idx, 1);
    }
    return left || standing;
  }
}

// ---------------------------------------------------------------------------
// Generated names for the machine players: Nordic first names with a bowling epithet.
const FIRST = ['Astrid', 'Bjørn', 'Sigrid', 'Leif', 'Ingrid', 'Erik', 'Freja', 'Ragnar', 'Saga', 'Harald',
  'Tove', 'Gunnar', 'Liv', 'Ivar', 'Ylva', 'Torvald', 'Maja', 'Halvar', 'Sölvi', 'Aino', 'Eino', 'Helmi',
  'Viljo', 'Kaisa', 'Mads', 'Signe', 'Rune', 'Elin', 'Orvar', 'Disa', 'Egil', 'Runa', 'Toke', 'Hedda'];
const EPITHET = ['the Strong', 'Strikehand', 'Tenpin', 'Iron Arm', 'the Steady', 'Pocketeer', 'the Swift',
  'Hookson', 'the Calm', 'Splitbreaker', 'Spareseeker', 'Laneborn', 'the Bold', 'Oilreader', 'Turkeyhunter'];
const EPITHET_SV = ['den Starke', 'Strajkhand', 'Käglan', 'Järnarm', 'den Stadige', 'Fickträffaren', 'den Snabbe',
  'Krok', 'den Lugne', 'Splitbrytaren', 'Sparejägaren', 'Banfödd', 'den Djärve', 'Oljeläsaren', 'Kalkonjägaren'];

export function generateNames(count, rng = Math.random, lang = 'sv', taken = []) {
  const out = [];
  const used = new Set(taken.map((s) => s.toLowerCase()));
  const ep = lang === 'sv' || lang === 'no' || lang === 'da' ? EPITHET_SV : EPITHET;
  let guard = 0;
  while (out.length < count && guard++ < 500) {
    const f = FIRST[Math.floor(rng() * FIRST.length)];
    const name = rng() < 0.5 ? f : f + ' ' + ep[Math.floor(rng() * ep.length)];
    if (name.length > 20) continue;
    if (used.has(name.toLowerCase()) || used.has(f.toLowerCase())) continue;
    used.add(name.toLowerCase()); used.add(f.toLowerCase());
    out.push(name);
  }
  return out;
}

// Skill levels offered for the machine players
export const SKILLS = [
  { id: 'beginner', avg: 100 },
  { id: 'casual', avg: 130 },
  { id: 'league', avg: 160 },
  { id: 'good', avg: 185 },
  { id: 'expert', avg: 205 },
  { id: 'pro', avg: 222 }
];

/* 四家自我博弈工具（Node，多线程）。
 *
 *   node tools/selfplay.js stats [局数] [ai模块]
 *       四家用同一套 AI 打，统计胡牌率、牌型、吃碰次数等。
 *   node tools/selfplay.js duel <挑战者> <卫冕者> [牌副数]
 *       同一副牌打四遍，挑战者轮流坐四个座位，另外三家是卫冕者。
 *       同牌对打把运气差异抵消掉了，看的是挑战者平均每局的净点数。
 *       <挑战者>/<卫冕者> 可以是 current、ai 模块路径或 params JSON 文件。
 *   node tools/selfplay.js tune [轮数] [每轮牌副数] [从哪个 JSON 开始]
 *       随机改动参数，打赢现任才接受。过程写进 docs/selfplay_log.md，最优参数写进 tools/params_best.json。
 *
 * 所有座位都只通过 view 拿信息，和正式游戏走同一个裁判。 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const T = require(path.join(ROOT, 'js/tiles.js'));
const { Hand } = require(path.join(ROOT, 'js/game.js'));

function mulberry(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (n) => Math.floor(next() * n);
}

/** spec: { module?: 路径, params?: {...} }。 */
function makeFactory(spec) {
  const AI = require(spec.module ? path.resolve(ROOT, spec.module) : path.join(ROOT, 'js/ai.js'));
  return () => AI.createPlayer(spec.params ? { params: spec.params } : {});
}

function deck(seed) {
  const rnd = mulberry(seed);
  const wall = T.shuffle(T.buildSet(), rnd);
  const dice = [rnd(6) + 1, rnd(6) + 1];
  return { wall, dice, dealer: rnd(4) };
}

async function runDuel(job) {
  const makeA = makeFactory(job.a);
  const makeB = makeFactory(job.b);
  const a = makeA();
  const b = makeB();
  const out = { n: 0, sum: 0, sumSq: 0, wins: 0, losses: 0, oppWins: 0, draws: 0, hands: 0 };
  for (let i = 0; i < job.decks; i++) {
    const d = deck(job.seed + i);
    let total = 0;
    for (let seat = 0; seat < 4; seat++) {
      const adapters = [b, b, b, b];
      adapters[seat] = a;
      const r = await new Hand({ dealer: d.dealer, adapters, presetWall: d.wall, dice: d.dice }).run();
      total += r.deltas[seat];
      out.hands++;
      if (r.type === 'draw') out.draws++;
      for (const w of r.winners) {
        if (w.seat === seat) out.wins++;
        else out.oppWins++;
      }
      if (r.deltas[seat] < 0) out.losses++;
    }
    const mean = total / 4;
    out.n++;
    out.sum += mean;
    out.sumSq += mean * mean;
  }
  return out;
}

async function runStats(job) {
  const make = makeFactory(job.a);
  const counters = {
    hands: 0, wins: 0, draws: 0, multi: 0, zimo: 0, ron: 0, rob: 0, qizhuoyi: 0,
    chi: 0, peng: 0, gang: 0, points: 0, wallAtEnd: 0, patterns: {}, seatWins: [0, 0, 0, 0],
    dealerWins: 0, dealerDelta: 0, tenpaiEnd: 0, maxPoints: 0, passRon: 0, calledHandsWon: 0, closedWon: 0,
  };
  const R = require(path.join(ROOT, 'js/rules.js'));
  const ai = make();
  const wrap = {
    chooseTurn: (v, o) => ai.chooseTurn(v, o),
    chooseClaim: (v, c) => {
      const a = ai.chooseClaim(v, c);
      if (c.options.hu && a.type !== 'hu') counters.passRon++;
      return a;
    },
    chooseRob: (v, c) => ai.chooseRob(v, c),
  };
  const hook = (e) => {
    if (e.type === 'meld' && !e.upgrade) counters[e.mtype]++;
    if (e.type === 'meld' && e.upgrade) counters.gang++;
  };
  for (let i = 0; i < job.decks; i++) {
    const d = deck(job.seed + i);
    const r = await new Hand({ dealer: d.dealer, adapters: [wrap, wrap, wrap, wrap], presetWall: d.wall, dice: d.dice, hook }).run();
    counters.hands++;
    counters.wallAtEnd += r.remaining;
    counters.dealerDelta += r.deltas[d.dealer];
    if (r.type === 'draw') {
      counters.draws++;
      for (const s of r.seats) {
        if (R.waits(R.toCounts(s.hand.map((x) => x.kind)), s.melds).length) counters.tenpaiEnd++;
      }
    } else {
      counters.wins++;
      if (r.winners.length > 1) counters.multi++;
      for (const w of r.winners) {
        counters[w.how]++;
        counters.seatWins[w.seat]++;
        counters.points += w.score.points;
        counters.maxPoints = Math.max(counters.maxPoints, w.score.points);
        if (w.seat === d.dealer) counters.dealerWins++;
        if (w.score.closed) counters.closedWon++;
        for (const p of w.score.patterns) counters.patterns[p] = (counters.patterns[p] || 0) + 1;
      }
    }
  }
  return counters;
}

function spawn(job) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: job });
    w.once('message', resolve);
    w.once('error', reject);
  });
}

const THREADS = Math.max(2, Math.min(os.cpus().length - 2, 24));

async function parallel(job, decks) {
  const size = Math.ceil(decks / THREADS);
  const jobs = [];
  for (let i = 0; i < THREADS; i++) jobs.push({ ...job, seed: job.seed + i * size, decks: size });
  return Promise.all(jobs.map(spawn));
}

async function duel(a, b, decks, seed) {
  const parts = await parallel({ kind: 'duel', a, b, seed }, decks);
  const t = { n: 0, sum: 0, sumSq: 0, wins: 0, oppWins: 0, draws: 0, hands: 0, losses: 0 };
  for (const p of parts) for (const k of Object.keys(t)) t[k] += p[k];
  const mean = t.sum / t.n;
  const variance = Math.max(t.sumSq / t.n - mean * mean, 1e-9);
  const se = Math.sqrt(variance / t.n);
  return { mean, se, z: mean / se, ...t };
}

function parseSpec(arg) {
  if (!arg || arg === 'current') return {};
  if (arg.endsWith('.json')) return { params: JSON.parse(fs.readFileSync(path.resolve(ROOT, arg), 'utf8')) };
  return { module: arg };
}

function printStats(c) {
  const pct = (x) => (100 * x / c.hands).toFixed(1) + '%';
  const winners = c.seatWins.reduce((a, b) => a + b, 0);
  console.log('局数 ' + c.hands + '  胡牌局 ' + pct(c.wins) + '  流局 ' + pct(c.draws) + '  一炮多响 ' + c.multi);
  console.log('每局：吃 ' + (c.chi / c.hands).toFixed(2) + '  碰 ' + (c.peng / c.hands).toFixed(2) + '  杠 ' + (c.gang / c.hands).toFixed(2) +
    '  结束时牌墙还剩 ' + (c.wallAtEnd / c.hands).toFixed(1) + ' 张');
  console.log('胡牌方式：自摸 ' + c.zimo + '  放炮 ' + c.ron + '  拉杠胡 ' + c.rob + '  七捉一 ' + c.qizhuoyi + '  放过的炮 ' + c.passRon);
  console.log('平均每胡 ' + (c.points / Math.max(winners, 1)).toFixed(1) + ' 点  最高 ' + c.maxPoints + ' 点  门清胡牌 ' + c.closedWon);
  console.log('流局时平均听牌家数 ' + (c.tenpaiEnd / Math.max(c.draws, 1)).toFixed(2));
  console.log('各座位胡牌 ' + c.seatWins.join(' / ') + '  庄家胡牌 ' + c.dealerWins + '  庄家平均净点 ' + (c.dealerDelta / c.hands).toFixed(2));
  console.log('牌型 ' + Object.entries(c.patterns).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + ' ' + v).join('  '));
}

// ---- 调参 ------------------------------------------------------------------
function perturb(params, rnd) {
  const out = JSON.parse(JSON.stringify(params));
  const keys = Object.keys(out).filter((k) => !k.startsWith('passRon'));
  const count = 1 + rnd(3);
  const changed = [];
  const gauss = () => {
    const u = (rnd(1000000) + 1) / 1000001;
    const v = (rnd(1000000) + 1) / 1000001;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  for (let i = 0; i < count; i++) {
    const key = keys[rnd(keys.length)];
    const factor = Math.exp(gauss() * 0.3);
    if (Array.isArray(out[key])) out[key] = out[key].map((x) => Math.min(0.98, x * factor));
    else if (key === 'survive') out[key] = Math.min(0.995, 1 - (1 - out[key]) * factor);
    else out[key] = out[key] * factor;
    changed.push(key);
  }
  return { params: out, changed };
}

function round3(p) {
  const r = (x) => Math.round(x * 1000) / 1000;
  const o = {};
  for (const k of Object.keys(p)) o[k] = Array.isArray(p[k]) ? p[k].map(r) : r(p[k]);
  return o;
}

async function tune(rounds, decks, startFile) {
  const AI = require(path.join(ROOT, 'js/ai.js'));
  const bestFile = path.join(ROOT, 'tools/params_best.json');
  const logFile = path.join(ROOT, 'docs/selfplay_log.md');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  let champion = startFile ? JSON.parse(fs.readFileSync(path.resolve(ROOT, startFile), 'utf8')) : { ...AI.PARAMS };
  const original = JSON.parse(JSON.stringify(champion));
  const rnd = mulberry(Date.now() >>> 0);
  let seed = rnd(1 << 30);
  let accepted = 0;
  fs.appendFileSync(logFile, '\n## 调参 ' + new Date().toISOString() + '（每轮 ' + decks + ' 副牌 ×4）\n\n');
  for (let i = 1; i <= rounds; i++) {
    const { params, changed } = perturb(champion, rnd);
    seed += decks * 2;
    const first = await duel({ params }, { params: champion }, decks, seed);
    let line = '第 ' + i + ' 轮 改动 ' + changed.join(',') + '：' + first.mean.toFixed(3) + ' ± ' + first.se.toFixed(3);
    if (first.z > 1.2) {
      seed += decks * 4;
      const confirm = await duel({ params }, { params: champion }, decks * 3, seed);
      line += ' → 复核 ' + confirm.mean.toFixed(3) + ' ± ' + confirm.se.toFixed(3);
      if (confirm.z > 2) {
        champion = params;
        accepted++;
        line += ' ✔ 接受';
        fs.writeFileSync(bestFile, JSON.stringify(round3(champion), null, 2));
        fs.appendFileSync(logFile, '- ' + line + '\n');
      }
    }
    console.log(line);
  }
  seed += decks * 8;
  const final = await duel({ params: champion }, { params: original }, decks * 4, seed);
  const summary = '共 ' + rounds + ' 轮，接受 ' + accepted + ' 次；最终对起点：每局净赢 ' +
    final.mean.toFixed(3) + ' ± ' + final.se.toFixed(3) + ' 点（z=' + final.z.toFixed(1) + '）';
  console.log(summary);
  fs.appendFileSync(logFile, '\n' + summary + '\n');
  fs.writeFileSync(bestFile, JSON.stringify(round3(champion), null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const seed = Date.now() % 1000000000;
  if (cmd === 'stats') {
    const parts = await parallel({ kind: 'stats', a: parseSpec(args[1]), seed }, Number(args[0]) || 2000);
    const t = parts[0];
    for (const p of parts.slice(1)) {
      for (const k of Object.keys(p)) {
        if (k === 'patterns') for (const q of Object.keys(p.patterns)) t.patterns[q] = (t.patterns[q] || 0) + p.patterns[q];
        else if (k === 'seatWins') p.seatWins.forEach((x, s) => { t.seatWins[s] += x; });
        else if (k === 'maxPoints') t.maxPoints = Math.max(t.maxPoints, p.maxPoints);
        else t[k] += p[k];
      }
    }
    printStats(t);
  } else if (cmd === 'duel') {
    const r = await duel(parseSpec(args[0]), parseSpec(args[1]), Number(args[2]) || 2000, seed);
    console.log('挑战者每局净赢 ' + r.mean.toFixed(3) + ' ± ' + r.se.toFixed(3) + ' 点（z=' + r.z.toFixed(1) + '）');
    console.log('挑战者胡 ' + r.wins + '，三家卫冕者合计胡 ' + r.oppWins + '，流局 ' + r.draws + '，共 ' + r.hands + ' 局');
  } else if (cmd === 'tune') {
    await tune(Number(args[0]) || 30, Number(args[1]) || 1500, args[2]);
  } else {
    console.log('用法见文件开头的注释');
  }
}

if (!isMainThread) {
  (workerData.kind === 'duel' ? runDuel(workerData) : runStats(workerData))
    .then((r) => parentPort.postMessage(r))
    .catch((e) => { throw e; });
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}

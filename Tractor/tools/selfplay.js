/* 四人自我博弈工具（Node，多线程）。所有座位都只通过 view 拿信息，和正式游戏走同一个裁判。
 *
 *   node tools/selfplay.js stats [局数] [ai模块或params]
 *       四家用同一套 AI，统计分数、牌型、埋牌等。
 *   node tools/selfplay.js duel <挑战者> <卫冕者> [牌副数]
 *       同一副牌打两遍：挑战者队先坐东西再坐南北，庄家座位不变。运气抵消后，
 *       看的是挑战者当闲家比卫冕者当闲家多拿多少分。
 *       <挑战者>/<卫冕者> 可以是 current、ai 模块路径或 params JSON 文件。
 *   node tools/selfplay.js sweep [每项牌副数] [倍数]
 *       把每个参数单独放大、缩小，看哪些方向真正影响胜负。
 *   node tools/selfplay.js tune [轮数] [每轮牌副数] [起始JSON]
 *       随机改动参数，打赢现任才接受。过程写进 docs/selfplay_log.md，最优参数写进 tools/params_best.json。
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'js/cards.js'));
const { Hand, teamOf } = require(path.join(ROOT, 'js/game.js'));

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

function makeFactory(spec) {
  const AI = require(spec.module ? path.resolve(ROOT, spec.module) : path.join(ROOT, 'js/ai.js'));
  return () => AI.createPlayer(spec.params ? { params: spec.params } : {});
}

function deal(seed) {
  const rnd = mulberry(seed);
  return { deck: C.shuffle(C.buildDeck(), rnd), dealer: rnd(4), level: 2 + rnd(13) };
}

async function runDuel(job) {
  const a = makeFactory(job.a)();
  const b = makeFactory(job.b)();
  const out = { n: 0, sum: 0, sumSq: 0, lvl: 0, lvlSq: 0, holdsA: 0, holdsB: 0, attackA: 0, attackB: 0 };
  for (let i = 0; i < job.decks; i++) {
    const d = deal(job.seed + i);
    let edge = 0;
    let lvl = 0;
    for (const aSeats of [0, 1]) {
      const adapters = [0, 1, 2, 3].map((s) => (s % 2 === aSeats ? a : b));
      const r = await new Hand({ dealer: d.dealer, levels: [d.level, d.level], presetDeck: d.deck, adapters }).run();
      const aIsDealer = teamOf(r.dealer) === aSeats;
      if (aIsDealer) {
        edge -= r.attackerPoints;
        out.attackB += r.attackerPoints;
        if (r.dealerHolds) out.holdsA++;
      } else {
        edge += r.attackerPoints;
        out.attackA += r.attackerPoints;
        if (r.dealerHolds) out.holdsB++;
      }
      // 级别分：赢家升几级 +1（上台本身也值一级）
      const value = r.up + 1;
      lvl += r.winnerTeam === aSeats ? value : -value;
    }
    const mean = edge / 2;
    const lm = lvl / 2;
    out.n++;
    out.sum += mean;
    out.sumSq += mean * mean;
    out.lvl += lm;
    out.lvlSq += lm * lm;
  }
  return out;
}

async function runStats(job) {
  const p = makeFactory(job.a)();
  const R = require(path.join(ROOT, 'js/rules.js'));
  const c = {
    hands: 0, attack: 0, holds: 0, up: {}, teamWins: [0, 0], throws: 0, fails: 0, tricks: 0, buried: 0,
    kittyHands: 0, kittyBonus: 0, bids: 0, noBid: 0, nt: 0, dealerTrumpHands: 0, ruffs: 0, pairLeads: 0, tractorLeads: 0, leads: 0, trickPtsDealer: 0,
  };
  for (let i = 0; i < job.decks; i++) {
    const d = deal(job.seed + i);
    let bids = 0;
    let ctx = null;
    const hook = (e) => {
      if (e.type === 'bid') bids++;
      if (e.type === 'trumpSet') ctx = R.makeCtx(e.level, e.trump);
      if (e.type === 'throwFailed') c.fails++;
      if (e.type === 'trickEnd') c.tricks++;
      if (e.type === 'play' && e.lead) {
        c.leads++;
        if (e.isThrow) c.throws++;
        else if (e.kinds.length === 2) c.pairLeads++;
        else if (e.kinds.length >= 4) c.tractorLeads++;
      }
    };
    const r = await new Hand({ dealer: d.dealer, levels: [d.level, d.level], presetDeck: d.deck, adapters: [p, p, p, p], hook }).run();
    void ctx;
    c.hands++;
    c.attack += r.attackerPoints;
    if (r.dealerHolds) c.holds++;
    c.teamWins[r.winnerTeam]++;
    const key = (r.dealerHolds ? '庄+' : '闲+') + Math.min(r.up, 4);
    c.up[key] = (c.up[key] || 0) + 1;
    c.buried += r.kittyPoints;
    if (r.kittyBonus > 0) { c.kittyHands++; c.kittyBonus += r.kittyBonus; }
    if (bids === 0) c.noBid++;
    c.bids += bids;
    if (r.trump === null) c.nt++;
  }
  return c;
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
  const t = { n: 0, sum: 0, sumSq: 0, lvl: 0, lvlSq: 0, holdsA: 0, holdsB: 0, attackA: 0, attackB: 0 };
  for (const p of parts) for (const k of Object.keys(t)) t[k] += p[k];
  const mean = t.sum / t.n;
  const se = Math.sqrt(Math.max(t.sumSq / t.n - mean * mean, 1e-9) / t.n);
  const lvl = t.lvl / t.n;
  const lvlSe = Math.sqrt(Math.max(t.lvlSq / t.n - lvl * lvl, 1e-9) / t.n);
  return { ...t, mean, se, z: mean / se, lvl, lvlSe };
}

function parseSpec(arg) {
  if (!arg || arg === 'current') return {};
  if (arg.endsWith('.json')) return { params: JSON.parse(fs.readFileSync(path.resolve(ROOT, arg), 'utf8')) };
  return { module: arg };
}

function printStats(c) {
  const pct = (x) => (100 * x / c.hands).toFixed(1) + '%';
  console.log('局数 ' + c.hands + '  闲家平均 ' + (c.attack / c.hands).toFixed(1) + ' 分  庄家守住 ' + pct(c.holds) + '  两队胜局 ' + c.teamWins.join(' / '));
  console.log('结果 ' + Object.entries(c.up).sort().map(([k, v]) => k + ':' + pct(v)).join('  '));
  console.log('每局 ' + (c.tricks / c.hands).toFixed(1) + ' 墩；领牌：对子 ' + pct(c.pairLeads / (c.leads / c.hands)) + ' 拖拉机 ' + pct(c.tractorLeads / (c.leads / c.hands)) + ' 甩牌 ' + pct(c.throws / (c.leads / c.hands)) + '（失败 ' + c.fails + ' 次）');
  console.log('平均埋 ' + (c.buried / c.hands).toFixed(1) + ' 分  抠底 ' + pct(c.kittyHands) + '  平均每次 ' + (c.kittyBonus / Math.max(c.kittyHands, 1)).toFixed(1) + ' 分');
  console.log('亮主 ' + (c.bids / c.hands).toFixed(2) + ' 次/局  没人亮主 ' + pct(c.noBid) + '  无主局 ' + pct(c.nt));
}

function perturb(params, rnd) {
  const out = { ...params };
  const keys = Object.keys(out);
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
    if (key.startsWith('hold')) out[key] = Math.min(0.99, out[key] * factor);
    else out[key] = out[key] * factor;
    changed.push(key);
  }
  return { params: out, changed };
}

function round3(p) {
  const o = {};
  for (const k of Object.keys(p)) o[k] = Math.round(p[k] * 1000) / 1000;
  return o;
}

async function tune(rounds, decks, startFile) {
  const AI = require(path.join(ROOT, 'js/ai.js'));
  const bestFile = path.join(ROOT, 'tools/params_best.json');
  const logFile = path.join(ROOT, 'docs/selfplay_log.md');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  let champion = startFile ? JSON.parse(fs.readFileSync(path.resolve(ROOT, startFile), 'utf8')) : { ...AI.PARAMS };
  const original = { ...champion };
  const rnd = mulberry(Date.now() >>> 0);
  let seed = rnd(1 << 30);
  let accepted = 0;
  fs.appendFileSync(logFile, '\n## 调参 ' + new Date().toISOString() + '（每轮 ' + decks + ' 副牌 ×2）\n\n');
  for (let i = 1; i <= rounds; i++) {
    const { params, changed } = perturb(champion, rnd);
    seed += decks * 2;
    const first = await duel({ params }, { params: champion }, decks, seed);
    let line = '第 ' + i + ' 轮 改动 ' + changed.join(',') + '：' + first.mean.toFixed(2) + ' ± ' + first.se.toFixed(2);
    if (first.z > 1.2) {
      seed += decks * 4;
      const confirm = await duel({ params }, { params: champion }, decks * 3, seed);
      line += ' → 复核 ' + confirm.mean.toFixed(2) + ' ± ' + confirm.se.toFixed(2);
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
  const summary = '共 ' + rounds + ' 轮，接受 ' + accepted + ' 次；最终对起点：闲家多拿 ' + final.mean.toFixed(2) + ' ± ' + final.se.toFixed(2) +
    ' 分（z=' + final.z.toFixed(1) + '），级别分 ' + final.lvl.toFixed(3) + ' ± ' + final.lvlSe.toFixed(3);
  console.log(summary);
  fs.appendFileSync(logFile, '\n' + summary + '\n');
  fs.writeFileSync(bestFile, JSON.stringify(round3(champion), null, 2));
}

async function sweep(decks, factor) {
  const AI = require(path.join(ROOT, 'js/ai.js'));
  const base = { ...AI.PARAMS };
  const rows = [];
  let seed = Date.now() % 1000000000;
  for (const key of Object.keys(base)) {
    for (const mult of [factor, 1 / factor]) {
      const params = { ...base, [key]: key.startsWith('hold') ? Math.min(0.99, base[key] * mult) : base[key] * mult };
      seed += decks * 2;
      const r = await duel({ params }, { params: base }, decks, seed);
      rows.push({ key, mult, mean: r.mean, se: r.se, z: r.z, lvl: r.lvl });
      console.log(key + ' ×' + mult.toFixed(2) + '：' + r.mean.toFixed(2) + ' ± ' + r.se.toFixed(2) + '（z=' + r.z.toFixed(1) + '，级别 ' + r.lvl.toFixed(3) + '）');
    }
  }
  rows.sort((a, b) => b.z - a.z);
  console.log('\n最值得改的方向：');
  for (const r of rows.slice(0, 8)) console.log('  ' + r.key + ' ×' + r.mult.toFixed(2) + '  ' + r.mean.toFixed(2) + ' ± ' + r.se.toFixed(2) + '  z=' + r.z.toFixed(1));
  console.log('影响最大的负向（说明这个参数现在很重要）：');
  for (const r of rows.slice(-6)) console.log('  ' + r.key + ' ×' + r.mult.toFixed(2) + '  ' + r.mean.toFixed(2) + ' ± ' + r.se.toFixed(2) + '  z=' + r.z.toFixed(1));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const seed = Date.now() % 1000000000;
  if (cmd === 'stats') {
    const parts = await parallel({ kind: 'stats', a: parseSpec(args[1]), seed }, Number(args[0]) || 2000);
    const t = parts[0];
    for (const p of parts.slice(1)) {
      for (const k of Object.keys(p)) {
        if (k === 'up') for (const q of Object.keys(p.up)) t.up[q] = (t.up[q] || 0) + p.up[q];
        else if (k === 'teamWins') p.teamWins.forEach((x, s) => { t.teamWins[s] += x; });
        else t[k] += p[k];
      }
    }
    printStats(t);
  } else if (cmd === 'duel') {
    const r = await duel(parseSpec(args[0]), parseSpec(args[1]), Number(args[2]) || 2000, seed);
    console.log('挑战者当闲家比对手多拿 ' + r.mean.toFixed(2) + ' ± ' + r.se.toFixed(2) + ' 分（z=' + r.z.toFixed(1) + '）');
    console.log('级别分 ' + r.lvl.toFixed(3) + ' ± ' + r.lvlSe.toFixed(3) + '；挑战者当庄守住 ' + r.holdsA + ' 次，对手当庄守住 ' + r.holdsB + ' 次（共 ' + r.n + ' 副）');
  } else if (cmd === 'sweep') {
    await sweep(Number(args[0]) || 1200, Number(args[1]) || 3);
  } else if (cmd === 'tune') {
    await tune(Number(args[0]) || 30, Number(args[1]) || 1000, args[2]);
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

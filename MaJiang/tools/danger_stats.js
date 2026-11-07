/* 统计打出一张牌时真实的放炮率和对手胡牌的大小，用来校准 js/ai.js 的风险模型。
 *   node tools/danger_stats.js [局数] */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const T = require(path.join(ROOT, 'js/tiles.js'));
const { Hand } = require(path.join(ROOT, 'js/game.js'));
const AI = require(path.join(ROOT, 'js/ai.js'));

const N = Number(process.argv[2]) || 6000;
const table = new Map();
const add = (key, hit, pts) => {
  let t = table.get(key);
  if (!t) { t = { n: 0, hits: 0, pts: 0 }; table.set(key, t); }
  t.n++;
  if (hit) { t.hits++; t.pts += pts; }
};

function features(view, k, o) {
  const p = view.players[o];
  let mask = 0;
  let chi = false;
  for (const m of p.melds) {
    if (!m.kinds) continue;
    if (m.type === 'chi') chi = true;
    for (const x of m.kinds) if (T.isNumber(x)) mask |= 1 << T.suitOf(x);
  }
  const m = p.melds.length;
  const honor = T.isHonor(k);
  let rel;
  if (m === 0) rel = '无副露';
  else if (mask === 0) rel = honor ? '字副露·字牌' : '字副露·数牌';
  else if ((mask & (mask - 1)) !== 0) rel = chi ? '多门' : '多门碰';
  else if (honor) rel = '单门·字牌';
  else rel = T.suitOf(k) === Math.log2(mask) ? '单门·同门' : '单门·别门';
  const stage = view.wallRemaining >= 60 ? '前' : view.wallRemaining >= 30 ? '中' : '后';
  const own = p.discards.includes(k) ? '现物' : '生张';
  const seen = new Array(34).fill(0);
  for (const t of view.hand) seen[t.kind]++;
  for (const q of view.players) {
    for (const x of q.discards) seen[x]++;
    for (const mm of q.melds) if (mm.kinds) for (const x of mm.kinds) seen[x]++;
  }
  const u = Math.max(0, 4 - seen[k]);
  return { m: Math.min(m, 4), rel, stage, own, u };
}

(async () => {
  const brain = AI.createPlayer();
  let pending = [];
  const flush = () => {
    for (const f of pending) {
      add(`${f.rel}|副露${f.m}|${f.stage}|${f.own}`, f.hit, f.points);
      add(`${f.rel}|副露${f.m}`, f.hit, f.points);
      add(`${f.rel}`, f.hit, f.points);
      add(`合计|${f.stage}|${f.own}`, f.hit, f.points);
      if (f.own === '生张') add(`外面还有|${f.u}张|副露${f.m}`, f.hit, f.points);
      if (f.m === 0) add(`无副露·阶段|${f.stage}`, f.hit, f.points);
      add(`阶段|${f.rel}|${f.stage}`, f.hit, f.points);
    }
    pending = [];
  };
  const adapter = {
    chooseTurn(view, opts) {
      flush();
      const act = brain.chooseTurn(view, opts);
      if (act.type === 'discard') {
        for (let o = 0; o < 4; o++) {
          if (o === view.seat) continue;
          pending.push({ o, ...features(view, act.kind, o), hit: false, points: 0 });
        }
      }
      return act;
    },
    chooseClaim(view, claim) {
      if (claim.options.hu) {
        const f = pending.find((x) => x.o === view.seat);
        if (f) { f.hit = true; f.points = claim.options.preview.points; }
      }
      return brain.chooseClaim(view, claim);
    },
    chooseRob: (v, c) => brain.chooseRob(v, c),
  };
  for (let h = 0; h < N; h++) {
    await new Hand({ dealer: h % 4, adapters: [adapter, adapter, adapter, adapter] }).run();
    flush();
  }
  const rows = [...table.entries()].map(([k, t]) => ({ k, ...t, rate: t.hits / t.n, avg: t.hits ? t.pts / t.hits : 0 }));
  const show = (filter) => {
    for (const r of rows.filter(filter).sort((a, b) => a.k.localeCompare(b.k, 'zh'))) {
      console.log(r.k.padEnd(26) + ' 样本 ' + String(r.n).padStart(7) + '  放炮率 ' + (100 * r.rate).toFixed(2).padStart(6) + '%  平均 ' + r.avg.toFixed(1) + ' 点  期望损失 ' + (r.rate * r.avg).toFixed(3));
    }
  };
  console.log('—— 按对手副露情况 ——');
  show((r) => r.k.split('|').length === 2 && r.k.includes('副露') && !r.k.startsWith('合计'));
  console.log('\n—— 按牌局阶段和是否现物 ——');
  show((r) => r.k.startsWith('合计'));
  console.log('\n—— 外面还有几张（生张）——');
  show((r) => r.k.startsWith('外面还有') && r.n > 300);
  console.log('\n—— 无副露对手 ——');
  show((r) => r.k.startsWith('无副露·阶段'));
  console.log('\n—— 各关系按阶段 ——');
  show((r) => r.k.startsWith('阶段|'));
  console.log('\n—— 单门对手细分 ——');
  show((r) => r.k.split('|').length === 4 && r.k.startsWith('单门·同门') && r.n > 200);
})();

/* 规则、裁判、AI 公平性的无界面测试： node tests/run_tests.js [模拟局数] */
'use strict';
const assert = require('assert');
const T = require('../js/tiles.js');
const R = require('../js/rules.js');
const { Hand } = require('../js/game.js');
const AI = require('../js/ai.js');

const K = {
  w: (n) => n - 1,
  t: (n) => 8 + n,
  b: (n) => 17 + n,
  E: 27, S: 28, W: 29, N: 30, Z: 31, F: 32, B: 33,
};

function counts(list) {
  return R.toCounts(list);
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('失败: ' + name + '\n  ' + e.message);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error('失败: ' + name + '\n  ' + (e.stack || e.message));
    process.exitCode = 1;
  }
}

const w = K.w, t = K.t, b = K.b;
const seq = (f, a) => [f(a), f(a + 1), f(a + 2)];
const tri = (k) => [k, k, k];

// ---- 牌型 ----------------------------------------------------------------
test('清一色', () => {
  const h = [...seq(w, 1), ...seq(w, 4), ...seq(w, 7), ...seq(w, 1), w(5), w(5)];
  assert.equal(R.shapeOf(counts(h), []), 'qingyise');
});
test('混一色', () => {
  const h = [...seq(t, 1), ...seq(t, 4), ...tri(K.E), ...tri(t(9)), K.Z, K.Z];
  assert.equal(R.shapeOf(counts(h), []), 'hunyise');
});
test('碰碰胡（三种花色）', () => {
  const h = [...tri(w(1)), ...tri(t(2)), ...tri(b(3)), ...tri(K.E), w(9), w(9)];
  assert.equal(R.shapeOf(counts(h), []), 'pengpeng');
});
test('混碰', () => {
  const h = [...tri(w(1)), ...tri(w(2)), ...tri(K.Z), ...tri(K.E), w(9), w(9)];
  assert.equal(R.shapeOf(counts(h), []), 'hunpeng');
});
test('清碰（可按顺子也可按刻子拆时取刻子）', () => {
  const h = [...tri(w(1)), ...tri(w(2)), ...tri(w(3)), ...tri(w(7)), w(9), w(9)];
  assert.equal(R.shapeOf(counts(h), []), 'qingpeng');
});
test('平胡不能胡：两门花色有顺子', () => {
  const h = [...seq(w, 1), ...seq(t, 4), ...seq(w, 4), ...tri(w(9)), t(9), t(9)];
  assert.equal(R.shapeOf(counts(h), []), null);
});
test('平胡不能胡：一门花色加风但没成牌', () => {
  const h = [w(1), w(2), w(4), w(5), w(7), w(8), w(9), K.E, K.S, K.W, K.N, K.Z, K.F, K.B];
  assert.equal(R.shapeOf(counts(h), []), null);
});
test('乱风向：全风字不成副也能胡', () => {
  const h = [K.E, K.E, K.S, K.W, K.W, K.N, K.N, K.Z, K.Z, K.F, K.F, K.B, K.B, K.E];
  assert.equal(R.shapeOf(counts(h), []), 'luanfeng');
});
test('字一色：全风字且成副', () => {
  const h = [...tri(K.E), ...tri(K.S), ...tri(K.Z), ...tri(K.F), K.B, K.B];
  assert.equal(R.shapeOf(counts(h), []), 'ziyise');
});
test('吃过就不算碰碰胡', () => {
  const melds = [{ type: 'chi', kinds: seq(w, 1) }];
  const h = [...tri(w(5)), ...tri(w(6)), ...tri(w(7)), w(9), w(9)];
  assert.equal(R.shapeOf(counts(h), melds), 'qingyise');
});
test('副露的花色也算进去', () => {
  const melds = [{ type: 'peng', kinds: tri(t(5)) }];
  const h = [...seq(w, 1), ...seq(w, 4), ...seq(w, 7), w(5), w(5)];
  assert.equal(R.shapeOf(counts(h), melds), null);
});
test('张数不对不算胡', () => {
  const h = [...seq(w, 1), ...seq(w, 4), w(5), w(5)];
  assert.equal(R.shapeOf(counts(h), []), null);
});
test('七对不是合法牌型', () => {
  const h = [w(1), w(1), w(3), w(3), t(5), t(5), t(7), t(7), b(2), b(2), b(4), b(4), K.E, K.E];
  assert.equal(R.shapeOf(counts(h), []), null);
});

// ---- 花和点数 ------------------------------------------------------------
function sc(hand, melds, extra) {
  return R.score({ counts: counts(hand), melds: melds || [], flowerCount: 0, ...extra });
}
const hunHand = () => [...seq(t, 1), ...seq(t, 4), ...tri(t(9)), ...tri(K.S), K.Z, K.Z];

test('混一色：底 2 + 花', () => {
  // 3 张花牌 + 南风暗刻 1 花 = 4 花，门清翻倍前 6 点
  const s = sc(hunHand(), [], { flowerCount: 3 });
  assert.equal(s.flowers.total, 4);
  assert.equal(s.points, 12); // 门清 ×2
  assert.ok(s.patterns.includes('门清'));
});
test('到 8 花算 1 辣', () => {
  const melds = [{ type: 'peng', kinds: tri(t(2)) }];
  const hand = [...seq(t, 4), ...tri(t(9)), ...tri(K.S), K.Z, K.Z];
  assert.equal(sc(hand, melds, { flowerCount: 6 }).points, 9);
  assert.equal(sc(hand, melds, { flowerCount: 7 }).points, 10);
  assert.equal(sc(hand, melds, { flowerCount: 8 }).points, 10);
});
test('风箭碰杠花数', () => {
  const m = (k, type, sub) => ({ type, sub, kinds: type === 'peng' ? tri(k) : [k, k, k, k] });
  assert.equal(R.meldFlowers({ type: 'chi', kinds: seq(w, 1) }), 0);
  assert.equal(R.meldFlowers(m(w(1), 'peng')), 0);
  assert.equal(R.meldFlowers(m(w(1), 'gang', 'ming')), 1);
  assert.equal(R.meldFlowers(m(w(1), 'gang', 'jia')), 1);
  assert.equal(R.meldFlowers(m(w(1), 'gang', 'an')), 2);
  assert.equal(R.meldFlowers(m(K.E, 'peng')), 1);
  assert.equal(R.meldFlowers(m(K.E, 'gang', 'ming')), 2);
  assert.equal(R.meldFlowers(m(K.E, 'gang', 'an')), 3);
  assert.equal(R.meldFlowers(m(K.Z, 'peng')), 2);
  assert.equal(R.meldFlowers(m(K.Z, 'gang', 'ming')), 3);
  assert.equal(R.meldFlowers(m(K.Z, 'gang', 'an')), 4);
});
const openPeng = { type: 'peng', kinds: tri(w(2)) };
test('清一色 1 辣、清碰 2 辣、混碰 1 辣、乱风向 2 辣、字一色 4 辣', () => {
  assert.equal(sc([...seq(w, 1), ...seq(w, 4), ...seq(w, 7), w(5), w(5)], [openPeng]).points, 10);
  assert.equal(sc([...tri(w(1)), ...tri(w(3)), ...tri(w(7)), w(9), w(9)], [openPeng]).points, 20);
  assert.equal(sc([...tri(w(1)), ...tri(K.E), ...tri(w(7)), w(9), w(9)], [openPeng]).points, 10);
  const honorMeld = { type: 'peng', kinds: tri(K.E) };
  assert.equal(sc([K.S, K.S, K.W, K.N, K.N, K.Z, K.Z, K.F, K.B, K.B, K.B], [honorMeld]).points, 20);
  assert.equal(sc([...tri(K.S), ...tri(K.Z), ...tri(K.F), K.B, K.B], [honorMeld]).points, 40);
});
test('门清翻倍；暗杠不破门清，明杠破', () => {
  const hand = [...seq(w, 1), ...seq(w, 4), ...seq(w, 7), w(5), w(5)];
  const anGang = { type: 'gang', sub: 'an', kinds: [w(2), w(2), w(2), w(2)] };
  const mingGang = { type: 'gang', sub: 'ming', kinds: [w(2), w(2), w(2), w(2)] };
  assert.equal(sc(hand, [anGang]).points, 20);
  assert.equal(sc(hand, [mingGang]).points, 10);
  assert.equal(sc([...hand, ...tri(w(9))], []).points, 20);
});
test('大吊车：不足 1 辣算 1 辣，已是辣子再加 1 辣', () => {
  const melds = [
    { type: 'peng', kinds: tri(t(1)) }, { type: 'peng', kinds: tri(t(2)) },
    { type: 'peng', kinds: tri(w(3)) }, { type: 'peng', kinds: tri(b(4)) },
  ];
  const s = sc([K.E, K.E], melds);
  assert.equal(s.shape, 'pengpeng');
  assert.equal(s.points, 10);
  assert.ok(s.patterns.includes('大吊车'));
  const qing = [
    { type: 'chi', kinds: seq(w, 1) }, { type: 'chi', kinds: seq(w, 4) },
    { type: 'chi', kinds: seq(w, 7) }, { type: 'chi', kinds: seq(w, 2) },
  ];
  assert.equal(sc([w(9), w(9)], qing).points, 20);
});
test('杠开只算自摸，海底捞月翻倍', () => {
  const melds = [{ type: 'gang', sub: 'ming', kinds: [t(1), t(1), t(1), t(1)] }];
  const hand = [...seq(t, 2), ...seq(t, 5), ...tri(K.E), K.Z, K.Z];
  assert.equal(sc(hand, melds, { selfDraw: false, afterKong: true }).points, 4); // 底2 + 明杠1 + 东暗刻1
  assert.equal(sc(hand, melds, { selfDraw: true, afterKong: true }).points, 10);
  assert.equal(sc(hand, melds, { selfDraw: true, lastTile: true }).points, 8);
});
test('荒番和开宝各 ×2', () => {
  const melds = [{ type: 'peng', kinds: tri(t(1)) }];
  const hand = [...seq(t, 2), ...seq(t, 5), ...tri(K.E), K.Z, K.Z];
  assert.equal(sc(hand, melds, { huangfan: true }).points, 6);
  assert.equal(sc(hand, melds, { huangfan: true, kaibao: true }).points, 12);
});
test('天胡 10 辣、地胡 8 辣（牌型仍要合法）', () => {
  const hand = [...seq(t, 1), ...seq(t, 4), ...seq(t, 7), ...tri(K.E), K.Z, K.Z];
  assert.equal(sc(hand, [], { tianhu: true }).points, 100);
  assert.equal(sc(hand, [], { dihu: true }).points, 80);
  const bad = [...seq(t, 1), ...seq(w, 4), ...seq(b, 7), ...tri(K.E), K.Z, K.Z];
  assert.equal(sc(bad, [], { tianhu: true }), null);
});

// ---- 结算 ----------------------------------------------------------------
const noCalls = () => [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
test('自摸三家付；放炮一家付', () => {
  assert.deepEqual(R.settle([{ seat: 1, how: 'zimo', points: 5 }], noCalls()).deltas, [-5, 15, -5, -5]);
  assert.deepEqual(R.settle([{ seat: 1, how: 'ron', from: 3, points: 5 }], noCalls()).deltas, [0, 5, 0, -5]);
});
test('拉杠胡：被抢杠的一家付 3 倍', () => {
  assert.deepEqual(R.settle([{ seat: 2, how: 'rob', from: 0, points: 10 }], noCalls()).deltas, [-30, 0, 30, 0]);
});
test('一炮多响：放炮者叠加付', () => {
  const r = R.settle([{ seat: 1, how: 'ron', from: 0, points: 5 }, { seat: 2, how: 'ron', from: 0, points: 10 }], noCalls());
  assert.deepEqual(r.deltas, [-15, 5, 10, 0]);
});
test('三口：自摸由绑定方独付 5 份，放炮 2 份，第三家放炮分情况', () => {
  const calls = noCalls();
  calls[1][0] = 3; // 座位 1 吃碰了座位 0 三次，互相绑定
  assert.deepEqual(R.settle([{ seat: 1, how: 'zimo', points: 4 }], calls).deltas, [-20, 20, 0, 0]);
  assert.deepEqual(R.settle([{ seat: 0, how: 'zimo', points: 4 }], calls).deltas, [20, -20, 0, 0]);
  assert.deepEqual(R.settle([{ seat: 1, how: 'ron', from: 0, points: 4 }], calls).deltas, [-8, 8, 0, 0]);
  assert.deepEqual(R.settle([{ seat: 1, how: 'ron', from: 2, points: 4 }], calls, () => true).deltas, [-4, 8, -4, 0]);
  assert.deepEqual(R.settle([{ seat: 1, how: 'ron', from: 2, points: 4 }], calls, () => false).deltas, [0, 8, -8, 0]);
});
test('吃：不能吃完只剩同一张可打', () => {
  const c = counts([w(5), w(6), w(4), w(4)]);
  assert.deepEqual(R.chiOptions(c, w(4)), []);
  const c2 = counts([w(5), w(6), w(4), w(9)]);
  assert.deepEqual(R.chiOptions(c2, w(4)), [[w(5), w(6)]]);
});
test('字牌和花不能吃', () => {
  assert.deepEqual(R.chiOptions(counts([K.E, K.S, K.W]), K.S), []);
});
test('边张吃不跨花色', () => {
  assert.deepEqual(R.chiOptions(counts([w(8), w(9), t(1), t(2)]), t(3)), [[t(1), t(2)]]);
  assert.deepEqual(R.chiOptions(counts([w(8), w(9), t(1), t(2)]), w(7)), [[w(8), w(9)]]);
  assert.deepEqual(R.chiOptions(counts([w(9), t(2)]), t(1)), []);
});

// ---- 洗牌 ----------------------------------------------------------------
test('一副牌 144 张，每种张数正确', () => {
  const s = T.buildSet();
  assert.equal(s.length, 144);
  const c = new Array(42).fill(0);
  s.forEach((k) => c[k]++);
  for (let k = 0; k < 34; k++) assert.equal(c[k], 4);
  for (let k = 34; k < 42; k++) assert.equal(c[k], 1);
});

// ---- 排好牌墙的局面：验证裁判流程 --------------------------------------------
/** 按发牌顺序排牌：前 53 张进四家手牌（庄家 14），然后是 rest（从牌头摸），其余填空。 */
function rig(hands, rest, tail) {
  const dealer = 0;
  const pool = new Array(42).fill(0);
  T.buildSet().forEach((k) => pool[k]++);
  const takeTile = (k) => {
    assert.ok(pool[k] > 0, '布局用了太多 ' + T.name(k));
    pool[k]--;
    return k;
  };
  const wall = new Array(144).fill(-1);
  let pos = 0;
  const idx = [0, 0, 0, 0];
  const put = (seat, n) => {
    for (let i = 0; i < n; i++) wall[pos++] = takeTile(hands[seat][idx[seat]++]);
  };
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) put((dealer + i) % 4, 4);
  for (let i = 0; i < 4; i++) put((dealer + i) % 4, 1);
  put(dealer, 1);
  for (const k of rest) wall[pos++] = takeTile(k);
  // 补牌顺序是 142,143,140,141...
  const tailOrder = [];
  for (let i = 142; i >= 0; i -= 2) tailOrder.push(i, i + 1);
  (tail || []).forEach((k, i) => { wall[tailOrder[i]] = takeTile(k); });
  // 其余随便填非花牌，花放到最不碍事的中间位置
  const left = [];
  for (let k = 0; k < 42; k++) for (let n = 0; n < pool[k]; n++) left.push(k);
  left.sort((a, b2) => (a >= 34) - (b2 >= 34));
  let j = 0;
  for (let i = 0; i < 144; i++) if (wall[i] < 0) wall[i] = left[j++];
  return wall;
}

function scripted(turnFn, claimFn, robFn) {
  return {
    chooseTurn: turnFn || ((view, opts) => (opts.canHu ? { type: 'hu' } : { type: 'discard', id: view.drawnId !== null ? view.drawnId : view.hand[view.hand.length - 1].id })),
    chooseClaim: claimFn || (() => ({ type: 'pass' })),
    chooseRob: robFn || (() => ({ type: 'pass' })),
  };
}

const filler = {
  a: [t(1), t(4), t(7), b(1), b(4), b(7), w(1), w(4), w(7), K.E, K.S, K.W, K.N],
  b: [t(2), t(5), t(8), b(2), b(5), b(8), w(2), w(5), w(8), K.Z, K.F, K.B, K.E],
  c: [t(3), t(6), t(9), b(3), b(6), b(9), w(3), w(6), w(9), K.S, K.W, K.N, K.Z],
};

(async () => {
  await testAsync('天胡', async () => {
    const dealerHand = [...seq(w, 1), ...seq(w, 4), ...seq(w, 7), ...seq(w, 1), K.Z, K.Z];
    const wall = rig([dealerHand, filler.a, filler.b, filler.c], []);
    const h = new Hand({ dealer: 0, adapters: [scripted(), scripted(), scripted(), scripted()], presetWall: wall, dice: [1, 2] });
    const r = await h.run();
    assert.equal(r.type, 'win');
    assert.equal(r.winners[0].seat, 0);
    assert.ok(r.winners[0].score.patterns.includes('天胡'));
    assert.deepEqual(r.deltas, [300, -100, -100, -100]);
  });

  await testAsync('放炮 + 碰优先于吃 + 吃后不能打同一张', async () => {
    // 庄家打一万。座位 1（下家）有 二三万可吃，座位 2 有两张一万可碰，碰优先。
    const hands = [
      [w(1), t(1), t(4), t(7), b(1), b(4), b(7), w(5), w(8), K.E, K.S, K.W, K.N, K.Z],
      [w(2), w(3), t(2), t(5), t(8), b(2), b(5), b(8), w(6), w(9), K.F, K.B, K.E],
      [w(1), w(1), t(3), t(6), t(9), b(3), b(6), b(9), w(7), K.S, K.W, K.N, K.Z],
      [t(1), t(2), t(3), t(4), t(5), t(6), t(7), t(8), t(9), b(1), b(2), b(3), b(4)],
    ];
    const wall = rig(hands, [w(9), w(9), w(9), w(8)]);
    let claimed = null;
    const human = scripted((v, o) => ({ type: 'discard', kind: v.hand.find((x) => x.kind === w(1)) ? w(1) : v.hand[0].kind }));
    const down = scripted(null, (v, c) => (c.options.chi.length ? { type: 'chi', chi: c.options.chi[0] } : { type: 'pass' }));
    const opp = scripted(
      (v, o) => { claimed = o; throw new Error('STOP'); },
      (v, c) => (c.options.peng ? { type: 'peng' } : { type: 'pass' })
    );
    const h = new Hand({ dealer: 0, adapters: [human, down, opp, scripted()], presetWall: wall, dice: [1, 2] });
    await assert.rejects(h.run(), /STOP/);
    assert.ok(claimed, '碰家应该获得出牌权');
    assert.equal(claimed.canHu, false, '碰后不能当自摸');
  });

  await testAsync('吃后不能打吃进的那张', async () => {
    const hands = [
      [w(1), t(1), t(4), t(7), b(1), b(4), b(7), w(5), w(8), K.E, K.S, K.W, K.N, K.Z],
      [w(2), w(3), t(2), t(5), t(8), b(2), b(5), b(8), w(6), w(9), K.F, K.B, K.E],
      [t(3), t(6), t(9), b(3), b(6), b(9), w(7), K.S, K.W, K.N, K.Z, K.F, K.B],
      [t(1), t(2), t(3), t(4), t(5), t(6), t(7), t(8), t(9), b(1), b(2), b(3), b(4)],
    ];
    const wall = rig(hands, [w(9), w(9), w(9), w(8)]);
    let seen = null;
    const human = scripted(() => ({ type: 'discard', kind: w(1) }));
    const down = scripted((v, o) => { seen = o; throw new Error('STOP'); }, (v, c) => ({ type: 'chi', chi: c.options.chi[0] }));
    const h = new Hand({ dealer: 0, adapters: [human, down, scripted(), scripted()], presetWall: wall, dice: [1, 2] });
    await assert.rejects(h.run(), /STOP/);
    assert.equal(seen.forbid, w(1));
  });

  // 拉杠的共同局面：庄家打红中；下家打七万被庄家碰；庄家再摸到第四张七万时加杠。
  const kongScript = (robberHand, robReply) => {
    const h0 = [w(7), w(7), t(4), t(7), b(1), b(4), b(7), t(5), t(8), K.E, K.S, K.W, K.N, K.Z];
    const h1 = [w(7), t(2), t(5), t(8), b(2), b(5), b(8), t(6), t(9), K.F, K.B, K.E, t(3)];
    const h3 = [t(1), t(2), t(3), t(3), t(5), t(6), t(7), t(8), t(9), b(1), b(2), b(3), b(4)];
    const wall = rig([h0, h1, robberHand, h3], [b(9), b(9), b(9), b(9), w(7)]);
    const dealer = {
      chooseTurn: (v, o) => {
        const jia = o.gangs.find((g) => g.sub === 'jia');
        if (jia) return { type: 'gang', kind: jia.kind, sub: 'jia' };
        return { type: 'discard', kind: v.hand.some((x) => x.kind === K.Z) ? K.Z : v.hand[0].kind };
      },
      chooseClaim: (v, c) => (c.options.peng ? { type: 'peng' } : { type: 'pass' }),
      chooseRob: () => ({ type: 'pass' }),
    };
    const down = scripted((v) => (v.hand.some((x) => x.kind === w(7)) ? { type: 'discard', kind: w(7) } : { type: 'discard', id: v.drawnId }));
    const rob = { n: 0 };
    const robber = {
      chooseTurn: (v) => ({ type: 'discard', id: v.drawnId }),
      chooseClaim: () => ({ type: 'pass' }),
      chooseRob: () => { rob.n++; return robReply; },
    };
    const last = scripted((v) => ({ type: 'discard', id: v.drawnId }));
    return { wall, adapters: [dealer, down, robber, last], rob };
  };

  await testAsync('拉杠胡：听这张的人能抢，被抢者付 3 倍', async () => {
    // 一二三 一二三 四五六 九九 + 五六：听四万、七万
    const robberHand = [w(1), w(2), w(3), w(1), w(2), w(3), w(4), w(5), w(6), w(9), w(9), w(5), w(6)];
    assert.ok(R.waits(counts(robberHand), []).includes(w(7)));
    const { wall, adapters, rob } = kongScript(robberHand, { type: 'hu' });
    const r = await new Hand({ dealer: 0, adapters, presetWall: wall, dice: [1, 2] }).run();
    assert.equal(rob.n, 1);
    assert.equal(r.type, 'win');
    assert.equal(r.winners[0].seat, 2);
    assert.equal(r.winners[0].how, 'rob');
    assert.ok(r.winners[0].score.patterns.includes('拉杠胡'));
    assert.equal(r.winners[0].score.points, 20, '清一色 1 辣，门清 ×2');
    assert.deepEqual(r.deltas, [-60, 0, 60, 0]);
  });

  await testAsync('拉杠胡：放弃不抢，杠照常成立并补牌', async () => {
    const robberHand = [w(1), w(2), w(3), w(1), w(2), w(3), w(4), w(5), w(6), w(9), w(9), w(5), w(6)];
    const { wall, adapters, rob } = kongScript(robberHand, { type: 'pass' });
    let upgraded = false;
    let afterKongDraw = false;
    const stop = new Error('STOP');
    const hook = (e) => {
      if (e.type === 'meld' && e.upgrade) upgraded = true;
      if (upgraded && e.type === 'draw' && e.tail) { afterKongDraw = true; throw stop; }
    };
    await new Hand({ dealer: 0, adapters, presetWall: wall, dice: [1, 2], hook }).run().catch((e) => { if (e !== stop) throw e; });
    assert.equal(rob.n, 1);
    assert.ok(upgraded && afterKongDraw, '杠成立后从牌尾补牌');
  });

  await testAsync('拉杠胡：没听这张的人不会被询问', async () => {
    const robberHand = [w(1), w(2), w(3), w(4), w(5), w(6), w(1), w(2), w(3), t(1), b(2), K.E, K.F];
    assert.ok(!R.waits(counts(robberHand), []).includes(w(7)));
    const { wall, adapters, rob } = kongScript(robberHand, { type: 'hu' });
    let upgraded = false;
    const stop = new Error('STOP');
    const hook = (e) => {
      if (e.type === 'meld' && e.upgrade) { upgraded = true; throw stop; }
    };
    await new Hand({ dealer: 0, adapters, presetWall: wall, dice: [1, 2], hook }).run().catch((e) => { if (e !== stop) throw e; });
    assert.equal(rob.n, 0);
    assert.ok(upgraded);
  });

  await testAsync('流局：牌墙摸空后下局荒番，庄家不变', async () => {
    const pass = {
      chooseTurn: (v) => ({ type: 'discard', id: v.drawnId !== null ? v.drawnId : v.hand[v.hand.length - 1].id }),
      chooseClaim: () => ({ type: 'pass' }),
      chooseRob: () => ({ type: 'pass' }),
    };
    // 摸什么打什么，而且不胡：一定走到牌墙摸空
    const never = { ...pass, chooseTurn: (v) => pass.chooseTurn(v) };
    const h = new Hand({ dealer: 2, huangfan: 1, adapters: [never, never, never, never] });
    const r = await h.run();
    assert.equal(r.type, 'draw');
    assert.equal(r.nextDealer, 2);
    assert.equal(r.nextHuangfan, 2);
    assert.deepEqual(r.deltas, [0, 0, 0, 0]);
  });

  await testAsync('八花：直接胡，三家付', async () => {
    const hands = [
      [34, 35, 36, 37, 38, 39, 40, 41, t(1), t(2), t(3), t(4), t(5), t(6)],
      filler.a, filler.b, filler.c,
    ];
    const wall = rig(hands, [], [w(1), w(2), w(3), w(4), w(5), w(6), w(7), w(8)]);
    const h = new Hand({ dealer: 0, adapters: [scripted(), scripted(), scripted(), scripted()], presetWall: wall, dice: [1, 2] });
    const r = await h.run();
    assert.equal(r.type, 'win');
    assert.ok(r.winners[0].score.patterns.includes('八花'));
    assert.deepEqual(r.deltas, [120, -40, -40, -40]);
  });

  await testAsync('七捉一：七花的一家赢一花的一家', async () => {
    const hands = [
      [34, 35, 36, 37, 38, 39, 40, t(1), t(2), t(3), t(4), t(5), t(6), t(7)],
      [41, ...filler.a.slice(0, 12)],
      filler.b, filler.c,
    ];
    const wall = rig(hands, [], [w(1), w(2), w(3), w(4), w(5), w(6), w(7), w(8), w(9)]);
    const h = new Hand({ dealer: 0, adapters: [scripted(), scripted(), scripted(), scripted()], presetWall: wall, dice: [1, 2] });
    const r = await h.run();
    assert.equal(r.type, 'win');
    assert.equal(r.winners[0].how, 'qizhuoyi');
    assert.deepEqual(r.deltas, [10, -10, 0, 0]);
  });

  await testAsync('别人的 view 里没有手牌、牌墙和暗杠牌种', async () => {
    const seenViews = [];
    const wrap = (p) => ({
      chooseTurn: (v, o) => { seenViews.push(v); return p.chooseTurn(v, o); },
      chooseClaim: (v, c) => { seenViews.push(v); return p.chooseClaim(v, c); },
      chooseRob: (v, c) => { seenViews.push(v); return p.chooseRob(v, c); },
    });
    const players = [0, 1, 2, 3].map(() => wrap(AI.createPlayer()));
    for (let i = 0; i < 8; i++) await new Hand({ dealer: i % 4, adapters: players }).run();
    assert.ok(seenViews.length > 50);
    for (const v of seenViews) {
      assert.deepEqual(Object.keys(v).sort(), ['calls', 'dealer', 'drawnId', 'hand', 'huangfan', 'kaibao', 'players', 'seat', 'wallRemaining'].sort());
      assert.ok(Object.isFrozen(v) && Object.isFrozen(v.hand) && Object.isFrozen(v.players));
      for (const p of v.players) {
        assert.deepEqual(Object.keys(p).sort(), ['discards', 'flowers', 'handCount', 'melds', 'seat'].sort());
        if (p.seat !== v.seat) {
          for (const m of p.melds) if (m.sub === 'an') assert.equal(m.kinds, null);
        }
      }
    }
  });

  await testAsync('AI 不偷看：隐藏信息换掉，决定不变', async () => {
    // 同一个 view 反复问同一个 AI，结果必须一模一样；AI 只有 view 这一个输入。
    const ai = AI.createPlayer();
    const views = [];
    const spy = {
      chooseTurn: (v, o) => { views.push(['turn', v, o]); return ai.chooseTurn(v, o); },
      chooseClaim: (v, c) => { views.push(['claim', v, c]); return ai.chooseClaim(v, c); },
      chooseRob: (v, c) => ai.chooseRob(v, c),
    };
    await new Hand({ dealer: 0, adapters: [spy, spy, spy, spy] }).run();
    for (const [what, v, o] of views) {
      const fresh = AI.createPlayer();
      const a = what === 'turn' ? ai.chooseTurn(v, o) : ai.chooseClaim(v, o);
      const b2 = what === 'turn' ? fresh.chooseTurn(v, o) : fresh.chooseClaim(v, o);
      assert.deepEqual(a, b2);
    }
    // 把 AI 源码里不允许出现的东西也查一遍
    const src = require('fs').readFileSync(require.resolve('../js/ai.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|crypto|game\.js|\bHand\b/.test(code), 'AI 不该用随机数或碰裁判');
  });

  // ---- 大量模拟 --------------------------------------------------------------
  const N = Number(process.argv[2]) || 2000;
  const stats = {
    hands: 0, wins: 0, draws: 0, zimo: 0, ron: 0, rob: 0, multi: 0,
    seatWins: [0, 0, 0, 0], seatDelta: [0, 0, 0, 0],
    patterns: {}, initialHonor: [0, 0, 0, 0], initialFlower: [0, 0, 0, 0], initialCount: [0, 0, 0, 0],
    points: 0, maxPoints: 0, kaibao: 0, ms: 0, decisions: 0,
  };

  const players = [0, 1, 2, 3].map(() => {
    const ai = AI.createPlayer();
    return {
      chooseTurn(v, o) {
        stats.decisions++;
        const t0 = performance.now();
        const a = ai.chooseTurn(v, o);
        stats.ms += performance.now() - t0;
        return a;
      },
      chooseClaim(v, c) {
        stats.decisions++;
        const t0 = performance.now();
        const a = ai.chooseClaim(v, c);
        stats.ms += performance.now() - t0;
        return a;
      },
      chooseRob: (v, c) => ai.chooseRob(v, c),
    };
  });

  await testAsync('模拟 ' + N + ' 局：牌张守恒、零和、都能结束', async () => {
    let dealer = 0;
    let huang = 0;
    for (let i = 0; i < N; i++) {
      const dealt = [[], [], [], []];
      const ids = new Set();
      const hook = (e) => {
        if (e.type === 'deal') {
          e.ids.forEach((id) => { assert.ok(!ids.has(id), '同一张牌发了两次'); ids.add(id); });
          e.kinds; // observer -1：发牌事件不带牌种
          assert.equal(e.kinds, null);
          dealt[e.seat].push(...e.ids);
        }
        if (e.type === 'draw') {
          assert.ok(!ids.has(e.id), '同一张牌摸了两次');
          ids.add(e.id);
          assert.equal(e.kind, null, '摸牌事件不该向外透露牌种');
        }
      };
      const h = new Hand({ dealer, huangfan: huang, adapters: players, hook, observer: -1 });
      const r = await h.run();

      // 张数守恒
      const all = [];
      for (const s of r.seats) {
        s.hand.forEach((x) => all.push(x.kind));
        s.melds.forEach((m) => all.push(...m.kinds));
        all.push(...s.flowers, ...s.discards);
      }
      // 被拉杠的那张牌已离开加杠者的手，还没进任何牌堆：它就是胡的那张
      if (r.winners.some((w2) => w2.how === 'rob')) all.push(r.winners[0].winKind);
      const wallLeft = r.remaining;
      assert.equal(all.length + wallLeft, 144, '牌张总数不对 ' + all.length + '+' + wallLeft);
      const cnt = new Array(42).fill(0);
      all.forEach((k) => cnt[k]++);
      for (let k = 0; k < 34; k++) assert.ok(cnt[k] <= 4, T.name(k) + ' 多于 4 张');
      for (let k = 34; k < 42; k++) assert.ok(cnt[k] <= 1, T.name(k) + ' 多于 1 张');

      for (const s of r.seats) {
        const need = 13 - s.melds.length * 3;
        const n = s.hand.length;
        const winnerNow = r.winners.some((w2) => w2.seat === s.seat && w2.how === 'zimo');
        const robbedNow = r.winners.some((w2) => w2.how === 'rob' && w2.from === s.seat);
        if (winnerNow && r.winners[0].score.shape !== 'bahua') assert.equal(n, need + 1);
        else if (robbedNow) assert.equal(n, need); // 加杠那张已被抢走
        else if (n !== need && n !== need + 1) assert.fail('座位 ' + s.seat + ' 手牌 ' + n + ' 张，应为 ' + need);
      }

      assert.equal(r.deltas.reduce((a, b2) => a + b2, 0), 0, '不是零和');
      for (const w2 of r.winners) {
        assert.ok(w2.score.points > 0);
        assert.ok(Number.isInteger(w2.score.points));
        // 胡牌必须确实合法：重新判定一次
        if (w2.score.shape !== 'bahua' && w2.score.shape !== 'qizhuoyi') {
          const s = r.seats[w2.seat];
          const c = counts(s.hand.map((x) => x.kind));
          if (w2.how !== 'zimo') c[w2.winKind]++;
          assert.ok(R.shapeOf(c, s.melds), '胡了不合法的牌');
        }
      }

      stats.hands++;
      if (r.type === 'draw') stats.draws++;
      else {
        stats.wins++;
        if (r.winners.length > 1) stats.multi++;
        for (const w2 of r.winners) {
          stats.seatWins[w2.seat]++;
          stats[w2.how] = (stats[w2.how] || 0) + 1;
          stats.points += w2.score.points;
          stats.maxPoints = Math.max(stats.maxPoints, w2.score.points);
          for (const p of w2.score.patterns) stats.patterns[p] = (stats.patterns[p] || 0) + 1;
        }
      }
      r.deltas.forEach((d, s) => { stats.seatDelta[s] += d; });
      if (r.kaibao) stats.kaibao++;
      dealer = i % 4; // 轮流坐庄，让每个座位机会相等
      huang = 0;
    }
  });

  // ---- 发牌公平性：直接看发到每个座位的牌 ---------------------------------------
  await testAsync('发牌公平：每个座位拿到的字牌、花牌比例没有差异', async () => {
    const M = 3000;
    const honor = [0, 0, 0, 0];
    const flower = [0, 0, 0, 0];
    const rank1 = [0, 0, 0, 0];
    const stop = new Error('STOP');
    const quick = { chooseTurn() { throw stop; }, chooseClaim() { throw stop; }, chooseRob() { throw stop; } };
    for (let i = 0; i < M; i++) {
      let ownKinds = [[], [], [], []];
      for (let obs = 0; obs < 1; obs++) {
        // 用一个发牌事件带牌种的 observer 分四次开四局不合适，所以每局只观察一个轮转座位
        const observer = i % 4;
        const h = new Hand({
          dealer: (i >> 2) % 4,
          adapters: [quick, quick, quick, quick],
          observer,
          hook: (e) => {
            if (e.type === 'deal' && e.seat === observer) ownKinds[observer].push(...e.kinds);
            if (e.type === 'dealDone') throw stop;
          },
        });
        await h.run().catch((e) => { if (e !== stop) throw e; });
        const s = observer;
        for (const k of ownKinds[s]) {
          if (T.isHonor(k)) honor[s]++;
          else if (T.isFlower(k)) flower[s]++;
          else if (T.rankOf(k) === 0) rank1[s]++;
        }
      }
    }
    const chi2 = (arr) => {
      const total = arr.reduce((a, b2) => a + b2, 0);
      const e = total / 4;
      return arr.reduce((a, x) => a + (x - e) * (x - e) / e, 0);
    };
    const c1 = chi2(honor);
    const c2 = chi2(flower);
    const c3 = chi2(rank1);
    console.log('  字牌分布', honor, 'χ²=' + c1.toFixed(2), ' 花牌分布', flower, 'χ²=' + c2.toFixed(2), ' 幺牌分布', rank1, 'χ²=' + c3.toFixed(2));
    // 自由度 3，p=0.0005 的临界值约 17.7；超过才判失败，避免偶然波动造成误报
    assert.ok(c1 < 17.7 && c2 < 17.7 && c3 < 17.7, '发牌分布有偏');
  });

  // ---- 对照：AI 要明显强过乱打的玩家 --------------------------------------------
  await testAsync('AI 比乱打强', async () => {
    const naive = {
      chooseTurn: (v, o) => {
        if (o.canHu) return { type: 'hu' };
        const legal = v.hand.filter((x) => x.kind !== o.forbid);
        return { type: 'discard', id: legal[T.secureInt(legal.length)].id };
      },
      chooseClaim: (v, c) => (c.options.hu ? { type: 'hu' } : { type: 'pass' }),
      chooseRob: () => ({ type: 'hu' }),
    };
    const M = Math.min(N, 800);
    let aiWins = 0;
    let naiveWins = 0;
    let aiDelta = 0;
    for (let i = 0; i < M; i++) {
      const smartSeat = i % 4;
      const adapters = [naive, naive, naive, naive];
      adapters[smartSeat] = AI.createPlayer();
      const r = await new Hand({ dealer: (i >> 2) % 4, adapters }).run();
      for (const w2 of r.winners) {
        if (w2.seat === smartSeat) aiWins++;
        else naiveWins++;
      }
      aiDelta += r.deltas[smartSeat];
    }
    console.log('  1 个 AI 对 3 个乱打：AI 胡 ' + aiWins + ' 次，乱打三家合计胡 ' + naiveWins + ' 次，AI 净点数 ' + aiDelta + '（' + M + ' 局）');
    assert.ok(aiWins > naiveWins * 2, 'AI 应该明显更强');
    assert.ok(aiDelta > 0);
  });

  const pct = (x) => (100 * x / stats.hands).toFixed(1) + '%';
  console.log('\n模拟结果（' + stats.hands + ' 局，同一 AI 四家轮流坐庄）');
  console.log('  胡牌局 ' + pct(stats.wins) + '，流局 ' + pct(stats.draws) + '，一炮多响 ' + stats.multi);
  console.log('  自摸 ' + (stats.zimo || 0) + '，放炮 ' + (stats.ron || 0) + '，拉杠胡 ' + (stats.rob || 0) + '，七捉一 ' + (stats.qizhuoyi || 0));
  console.log('  各座位胡牌次数 ' + stats.seatWins.join(' / '));
  console.log('  各座位净点数 ' + stats.seatDelta.join(' / '));
  const wc = stats.seatWins.reduce((a, b2) => a + b2, 0);
  console.log('  平均每次胡 ' + (stats.points / Math.max(wc, 1)).toFixed(1) + ' 点，最高 ' + stats.maxPoints + ' 点，开宝局 ' + pct(stats.kaibao));
  console.log('  牌型 ' + Object.entries(stats.patterns).sort((a, b2) => b2[1] - a[1]).map(([k, v]) => k + ':' + v).join('  '));
  console.log('  AI 平均每次决策 ' + (stats.ms / Math.max(stats.decisions, 1)).toFixed(2) + ' ms（' + stats.decisions + ' 次）');

  const e = stats.seatWins.reduce((a, b2) => a + b2, 0) / 4;
  const chi = stats.seatWins.reduce((a, x) => a + (x - e) * (x - e) / Math.max(e, 1), 0);
  console.log('  座位胡牌 χ²=' + chi.toFixed(2) + '（自由度 3，< 17.7 视为无差异）');
  test('同一 AI 坐四个座位，胡牌次数没有座位偏差', () => assert.ok(chi < 17.7));

  console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '，有失败' : '，全部通过'));
})();

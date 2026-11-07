/* 规则、裁判、AI 公平性的无界面测试： node tests/run_tests.js [模拟局数] */
'use strict';
const assert = require('assert');
const C = require('../js/cards.js');
const R = require('../js/rules.js');
const { Hand, teamOf } = require('../js/game.js');
const AI = require('../js/ai.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) {
    console.error('失败: ' + name + '\n  ' + e.message);
    process.exitCode = 1;
  }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; } catch (e) {
    console.error('失败: ' + name + '\n  ' + (e.stack || e.message));
    process.exitCode = 1;
  }
}

const S = 0, H = 1, K = 2, D = 3; // 花色：黑桃 红桃 梅花 方块
const c = (suit, rank) => C.kindOf(suit, rank);
const SJ = C.SMALL_JOKER, BJ = C.BIG_JOKER;
const ctx7c = R.makeCtx(7, K); // 打 7，梅花主
const ctxNT = R.makeCtx(7, null);

// ---- 牌序 ------------------------------------------------------------------
test('主牌顺序：大王 > 小王 > 主级 > 副级 > 主花色', () => {
  const p = ctx7c.pow;
  assert.ok(p[BJ] > p[SJ]);
  assert.ok(p[SJ] > p[c(K, 7)]);
  assert.ok(p[c(K, 7)] > p[c(H, 7)]);
  assert.equal(p[c(H, 7)], p[c(D, 7)]);
  assert.ok(p[c(H, 7)] > p[c(K, 14)]);
  assert.equal(ctx7c.cls[c(H, 7)], R.TRUMP);
  assert.equal(ctx7c.cls[c(K, 3)], R.TRUMP);
  assert.equal(ctx7c.cls[c(H, 3)], H);
  assert.equal(ctx7c.cls[BJ], R.TRUMP);
});
test('级牌两边的牌算相邻', () => {
  assert.equal(ctx7c.pow[c(H, 8)] - ctx7c.pow[c(H, 6)], 1);
});
test('无主：王和级牌是主，四门花色都不是主', () => {
  assert.equal(ctxNT.cls[c(K, 3)], K);
  assert.equal(ctxNT.cls[c(K, 7)], R.TRUMP);
  assert.equal(ctxNT.pow[c(K, 7)], ctxNT.pow[c(S, 7)]);
  assert.ok(ctxNT.pow[SJ] > ctxNT.pow[c(K, 7)]);
});
test('分牌合计 200', () => {
  assert.equal(C.buildDeck().reduce((a, k) => a + C.points(k), 0), 200);
  assert.equal(C.buildDeck().length, 108);
});

// ---- 拖拉机（Wikipedia 上的例子，打 7 梅花主）---------------------------------
const isTractor = (kinds, ctx) => {
  const comps = R.decompose(kinds, ctx);
  return comps.length === 1 && comps[0].type === 'tractor';
};
const dbl = (...ks) => ks.flatMap((k) => [k, k]);
test('普通连对', () => {
  assert.ok(isTractor(dbl(c(H, 5), c(H, 4)), ctx7c));
});
test('中间隔着级牌也算连对', () => {
  assert.ok(isTractor(dbl(c(D, 8), c(D, 6)), ctx7c));
});
test('主级对 + 副级对 + 主 A 对是拖拉机', () => {
  assert.ok(isTractor(dbl(c(K, 7), c(D, 7), c(K, 14)), ctx7c));
});
test('大王对 + 小王对 + 主级对是拖拉机', () => {
  assert.ok(isTractor(dbl(BJ, SJ, c(K, 7)), ctx7c));
});
test('两种副级对一样大，不是拖拉机', () => {
  assert.ok(!isTractor(dbl(c(S, 7), c(D, 7)), ctx7c));
});
test('副级对不和本花色相连', () => {
  assert.ok(!isTractor(dbl(c(H, 7), c(H, 6)), ctx7c));
  assert.ok(!isTractor(dbl(c(K, 7), c(K, 6)), ctx7c));
});
test('不相邻的对子、不同花色不是拖拉机', () => {
  assert.ok(!isTractor(dbl(c(H, 10), c(H, 8)), ctx7c));
  assert.ok(!R.sameClass(dbl(c(S, 9), c(D, 8)), ctx7c));
  assert.ok(!R.sameClass([c(K, 2), c(K, 2), c(S, 14), c(S, 14)], ctx7c));
});
test('拆牌优先凑最长的拖拉机', () => {
  const comps = R.decompose([...dbl(c(H, 5), c(H, 4), c(H, 3)), c(H, 9), ...dbl(c(H, 12))], ctx7c);
  assert.equal(comps[0].type, 'tractor');
  assert.equal(comps[0].len, 3);
  assert.equal(comps[1].type, 'pair');
  assert.equal(comps[2].type, 'single');
});

// ---- 跟牌 ------------------------------------------------------------------
test('单张：有同门必须跟同门', () => {
  const hand = [c(S, 3), c(H, 4), c(K, 5)];
  assert.ok(R.canFollow(hand, [c(S, 9)], [c(S, 3)], ctx7c).ok);
  assert.ok(!R.canFollow(hand, [c(S, 9)], [c(H, 4)], ctx7c).ok);
});
test('断门可以垫任何牌，也可以毙', () => {
  const hand = [c(H, 4), c(K, 5)];
  assert.ok(R.canFollow(hand, [c(S, 9)], [c(H, 4)], ctx7c).ok);
  assert.ok(R.canFollow(hand, [c(S, 9)], [c(K, 5)], ctx7c).ok);
});
test('领对子：有对子必须出对子', () => {
  const hand = [c(S, 3), c(S, 3), c(S, 9), c(S, 10), c(H, 4)];
  assert.ok(R.canFollow(hand, dbl(c(S, 14)), dbl(c(S, 3)), ctx7c).ok);
  assert.ok(!R.canFollow(hand, dbl(c(S, 14)), [c(S, 9), c(S, 10)], ctx7c).ok);
});
test('领对子：没有对子出两张同门', () => {
  const hand = [c(S, 9), c(S, 10), c(H, 4), c(H, 4)];
  assert.ok(R.canFollow(hand, dbl(c(S, 14)), [c(S, 9), c(S, 10)], ctx7c).ok);
  assert.ok(!R.canFollow(hand, dbl(c(S, 14)), dbl(c(H, 4)), ctx7c).ok);
});
test('同门不够：全部打出，其余随便', () => {
  const hand = [c(S, 9), c(H, 4), c(H, 5)];
  assert.ok(R.canFollow(hand, dbl(c(S, 14)), [c(S, 9), c(H, 4)], ctx7c).ok);
  assert.ok(!R.canFollow(hand, dbl(c(S, 14)), [c(H, 5), c(H, 4)], ctx7c).ok);
});
test('领拖拉机：有拖拉机必须跟拖拉机，没有就跟对子', () => {
  const lead = dbl(c(S, 14), c(S, 13));
  const withTractor = [...dbl(c(S, 3), c(S, 4)), ...dbl(c(S, 10)), c(S, 12)];
  assert.ok(R.canFollow(withTractor, lead, dbl(c(S, 3), c(S, 4)), ctx7c).ok);
  assert.ok(!R.canFollow(withTractor, lead, dbl(c(S, 3), c(S, 10)), ctx7c).ok);
  const pairsOnly = [...dbl(c(S, 3), c(S, 10)), c(S, 12), c(S, 9)];
  assert.ok(R.canFollow(pairsOnly, lead, dbl(c(S, 3), c(S, 10)), ctx7c).ok);
  assert.ok(!R.canFollow(pairsOnly, lead, [...dbl(c(S, 3)), c(S, 12), c(S, 9)], ctx7c).ok);
});

// ---- 比大小 ----------------------------------------------------------------
const trick = (...plays) => plays.map(([seat, kinds]) => ({ seat, kinds }));
test('同门大牌赢，一样大先出的赢', () => {
  assert.equal(R.trickWinner(trick([0, [c(S, 9)]], [1, [c(S, 14)]], [2, [c(S, 3)]], [3, [c(S, 14)]]), ctx7c), 1);
});
test('主牌毙副牌，副级牌一样大先出的赢', () => {
  assert.equal(R.trickWinner(trick([0, [c(S, 14)]], [1, [c(K, 3)]], [2, [c(H, 7)]], [3, [c(D, 7)]]), ctx7c), 2);
});
test('不同门的大牌不算数', () => {
  assert.equal(R.trickWinner(trick([0, [c(S, 3)]], [1, [c(H, 14)]], [2, [c(D, 14)]], [3, [c(H, 13)]]), ctx7c), 0);
});
test('两张散主压不了副牌对子', () => {
  const t = trick([0, dbl(c(S, 3))], [1, [c(K, 3), c(K, 4)]], [2, [c(S, 9), c(H, 2)]], [3, [c(H, 3), c(H, 4)]]);
  assert.equal(R.trickWinner(t, ctx7c), 0);
});
test('主对毙副牌对', () => {
  const t = trick([0, dbl(c(S, 14))], [1, dbl(c(K, 3))], [2, dbl(c(K, 4))], [3, [c(H, 3), c(H, 4)]]);
  assert.equal(R.trickWinner(t, ctx7c), 2);
});
test('拖拉机只能被同长度连对毙', () => {
  const lead = dbl(c(S, 14), c(S, 13));
  assert.equal(R.trickWinner(trick([0, lead], [1, dbl(c(K, 3), c(K, 9))], [2, [c(H, 3), c(H, 4), c(H, 5), c(H, 6)]], [3, [c(D, 3), c(D, 4), c(D, 5), c(D, 6)]]), ctx7c), 0);
  assert.equal(R.trickWinner(trick([0, lead], [1, dbl(c(K, 3), c(K, 4))], [2, [c(H, 3), c(H, 4), c(H, 5), c(H, 6)]], [3, [c(D, 3), c(D, 4), c(D, 5), c(D, 6)]]), ctx7c), 1);
});
test('甩牌被毙要同结构，比最大的部件', () => {
  const lead = [c(S, 14), c(S, 14), c(S, 13)];
  const t = trick([0, lead], [1, [...dbl(c(K, 3)), c(K, 9)]], [2, [...dbl(c(K, 4)), c(K, 2)]], [3, [c(H, 3), c(H, 4), c(H, 5)]]);
  assert.equal(R.trickWinner(t, ctx7c), 2);
});

// ---- 甩牌 ------------------------------------------------------------------
test('甩牌：别人压不住才成功', () => {
  const lead = [c(S, 14), c(S, 13)];
  const ok = R.checkLead(lead, [[c(H, 3)], [c(D, 3)], [c(S, 3)]], ctx7c);
  assert.ok(ok.isThrow && !ok.failed);
  const bad = R.checkLead([c(S, 14), c(S, 12)], [[c(S, 13)], [c(D, 3)], [c(S, 3)]], ctx7c);
  assert.ok(bad.failed);
  assert.deepEqual(bad.failed.kinds, [c(S, 12)]);
});
test('甩牌失败时改出被压住的最小部件', () => {
  const lead = [c(S, 13), c(S, 12), c(S, 12), c(S, 10), c(S, 10)];
  const bad = R.checkLead(lead, [[c(S, 14)], [], []], ctx7c);
  assert.deepEqual(bad.failed.kinds, [c(S, 13)]);
  const bad2 = R.checkLead(lead, [[c(S, 11), c(S, 11)], [], []], ctx7c);
  assert.deepEqual(bad2.failed.kinds, [c(S, 10), c(S, 10)]);
});
test('不同门的牌不能一起领', () => {
  assert.equal(R.checkLead([c(S, 14), c(H, 14)], [[], [], []], ctx7c).ok, false);
});

// ---- 亮主和结算 --------------------------------------------------------------
test('亮主：对子压单张，大王对压小王对，不能亮更弱的', () => {
  const lv = 7;
  const hand = [c(S, 7), c(H, 7), c(H, 7), SJ, SJ, BJ, BJ];
  assert.equal(R.legalBids(hand, lv, null).length, 5);
  const afterSingle = R.legalBids(hand, lv, { strength: 1 });
  assert.ok(afterSingle.every((b) => b.strength >= 2));
  const afterPair = R.legalBids(hand, lv, { strength: 2 });
  assert.deepEqual(afterPair.map((b) => b.strength), [3, 4]);
  assert.deepEqual(R.legalBids(hand, lv, { strength: 4 }), []);
  assert.deepEqual(R.legalBids([BJ, SJ], lv, null), [], '一张王不能亮');
});
test('升级表', () => {
  const t = (p) => { const o = R.outcome(p); return [o.dealerHolds, o.up]; };
  assert.deepEqual(t(0), [true, 3]);
  assert.deepEqual(t(5), [true, 2]);
  assert.deepEqual(t(35), [true, 2]);
  assert.deepEqual(t(40), [true, 1]);
  assert.deepEqual(t(75), [true, 1]);
  assert.deepEqual(t(80), [false, 0]);
  assert.deepEqual(t(115), [false, 0]);
  assert.deepEqual(t(120), [false, 1]);
  assert.deepEqual(t(155), [false, 1]);
  assert.deepEqual(t(160), [false, 2]);
  assert.deepEqual(t(195), [false, 2]);
  assert.deepEqual(t(200), [false, 3]);
  assert.deepEqual(t(280), [false, 5]);
});
test('抠底倍数', () => {
  assert.equal(R.kittyMultiplier([c(S, 3)], ctx7c), 2);
  assert.equal(R.kittyMultiplier(dbl(c(S, 3)), ctx7c), 4);
  assert.equal(R.kittyMultiplier(dbl(c(S, 3), c(S, 4)), ctx7c), 8);
  assert.equal(R.kittyMultiplier(dbl(c(S, 3), c(S, 4), c(S, 5)), ctx7c), 12);
});

// ---- 排好牌的局面 --------------------------------------------------------------
/** 让第一个候选就是最小合法牌：裁判流程测试用的笨玩家。 */
function plain(extra) {
  const lowFirst = (view) => view.hand.slice().sort((a, b) => a.kind - b.kind);
  return {
    chooseBid: () => null,
    chooseBury: (v) => lowFirst(v).filter((t) => !v.shownIds.includes(t.id)).slice(0, 8).map((t) => t.id),
    chooseLead: (v) => [lowFirst(v)[0].id],
    chooseFollow: (v, info) => {
      const ctx = R.makeCtx(v.level, v.trump);
      const cls = ctx.cls[info.lead[0]];
      const same = v.hand.filter((t) => ctx.cls[t.kind] === cls);
      const other = v.hand.filter((t) => ctx.cls[t.kind] !== cls);
      const use = same.concat(other).slice(0, info.lead.length);
      return use.map((t) => t.id);
    },
    ...extra,
  };
}

function shuffled() {
  return C.shuffle(C.buildDeck());
}

(async () => {
  await testAsync('没人亮主：翻底牌定主，起手家坐庄', async () => {
    const stop = new Error('STOP');
    let trumpEvt = null;
    const deck = shuffled();
    // 把底牌第 3 张固定成级牌 ♥2，前两张固定成非级牌
    const put = (pos, kind) => { const j = deck.indexOf(kind, 0); const t = deck[pos]; deck[pos] = kind; deck[j] = t; };
    put(100, c(S, 9));
    put(101, c(D, 9));
    put(102, c(H, 2));
    const h = new Hand({
      dealer: null, starter: 2, levels: [2, 2], presetDeck: deck, adapters: [plain(), plain(), plain(), plain()],
      hook: (e) => { if (e.type === 'trumpSet') { trumpEvt = e; throw stop; } },
    });
    await h.run().catch((e) => { if (e !== stop) throw e; });
    assert.equal(trumpEvt.dealer, 2);
    assert.equal(trumpEvt.trump, H);
    assert.ok(trumpEvt.flipped);
  });

  await testAsync('第一局：最先亮主的人坐庄，别人推翻只换主不换庄', async () => {
    const deck = shuffled();
    const put = (pos, kind) => { const j = deck.indexOf(kind); const t = deck[pos]; deck[pos] = kind; deck[j] = t; };
    // 起手 seat 0：第 1 张给 0，第 2 张给 1...
    put(0, c(S, 2));
    put(1, c(H, 2));
    const second = deck.indexOf(c(H, 2), 2); // 第二张红桃 2 也发给座位 1
    deck[second] = deck[5];
    deck[5] = c(H, 2);
    const seen = [];
    const stop = new Error('STOP');
    const eager = plain({ chooseBid: (v, opts) => (opts.length ? { strength: opts[opts.length - 1].strength, suit: opts[opts.length - 1].suit } : null) });
    const h = new Hand({
      dealer: null, starter: 0, levels: [2, 2], presetDeck: deck, adapters: [eager, eager, plain(), plain()],
      hook: (e) => { if (e.type === 'bid') seen.push(e); if (e.type === 'trumpSet') throw stop; },
    });
    await h.run().catch((e) => { if (e !== stop) throw e; });
    assert.equal(seen[0].seat, 0);
    assert.equal(seen[0].suit, S);
    assert.equal(seen[1].seat, 1);
    assert.equal(seen[1].suit, H);
    assert.equal(seen[1].strength, 2);
    assert.equal(seen[1].dealer, 0, '庄家仍是最先亮主的人');
  });

  await testAsync('亮在桌上的牌不能扣底，扣完底收回；被反主时收回', async () => {
    const deck = shuffled();
    const put = (pos, kind) => { const j = deck.indexOf(kind); const t = deck[pos]; deck[pos] = kind; deck[j] = t; };
    put(0, c(S, 2)); // 起手 seat 0 的第一张：级牌 ♠2
    const once = (v, opts) => (!v.bid && opts.length ? { strength: opts[0].strength, suit: opts[0].suit } : null);
    // 1. 自己亮主坐庄，扣底想扣桌上那张：裁判拒绝
    let shownAtBury = null;
    const cheat = plain({
      chooseBid: once,
      chooseBury: (v) => {
        shownAtBury = v.shownIds;
        return v.shownIds.concat(v.hand.filter((t) => !v.shownIds.includes(t.id)).map((t) => t.id)).slice(0, 8);
      },
    });
    await assert.rejects(new Hand({ dealer: null, starter: 0, levels: [2, 2], presetDeck: deck, adapters: [cheat, plain(), plain(), plain()] }).run(),
      /亮在桌上的牌不能扣底/);
    assert.deepEqual(shownAtBury, [0]);
    // 2. 不扣它：打得完，扣完底后谁的 view 里都没有桌上的牌了
    const later = [];
    const honest = (extra) => plain({
      chooseLead: (v) => { later.push(v.shownIds.length); return plain().chooseLead(v); },
      chooseFollow: (v, i) => { later.push(v.shownIds.length); return plain().chooseFollow(v, i); },
      ...extra,
    });
    await new Hand({ dealer: null, starter: 0, levels: [2, 2], presetDeck: deck, adapters: [honest({ chooseBid: once }), honest(), honest(), honest()] }).run();
    assert.ok(later.length > 0 && later.every((n) => n === 0));
    // 3. 被座位 1 用一对 ♥2 反主：座位 0 的 ♠2 收回手里，扣底时可以扣
    const deck2 = deck.slice();
    const put2 = (pos, kind, from) => { const j = deck2.indexOf(kind, from); const t = deck2[pos]; deck2[pos] = kind; deck2[j] = t; };
    put2(1, c(H, 2), 1);
    put2(5, c(H, 2), 2);
    let buryView = null;
    const dealer0 = plain({ chooseBid: once, chooseBury: (v) => { buryView = v; return [0].concat(plain().chooseBury(v).filter((id) => id !== 0)).slice(0, 8); } });
    const counter = plain({ chooseBid: (v, opts) => { const o = opts.find((x) => x.strength === 2); return o ? { strength: o.strength, suit: o.suit } : null; } });
    const bids = [];
    await new Hand({
      dealer: null, starter: 0, levels: [2, 2], presetDeck: deck2, adapters: [dealer0, counter, plain(), plain()],
      hook: (e) => { if (e.type === 'bid') bids.push(e.seat); },
    }).run();
    assert.deepEqual(bids, [0, 1]);
    assert.equal(buryView.seat, 0);
    assert.deepEqual(buryView.shownIds, [], '反主后座位 0 的牌已收回');
  });

  await testAsync('AI 扣底从不扣自己亮在桌上的牌', async () => {
    let withShown = 0;
    for (let i = 0; i < 300; i++) {
      const players = [0, 1, 2, 3].map(() => {
        const p = AI.createPlayer({ params: { simWorlds: 0 } });
        const bury = p.chooseBury;
        p.chooseBury = (v) => {
          const a = bury(v);
          if (v.shownIds.length) withShown++;
          assert.ok(!a.some((id) => v.shownIds.includes(id)), 'AI 扣了桌上的牌');
          return a;
        };
        return p;
      });
      await new Hand({ dealer: null, starter: i % 4, levels: [2 + (i % 13), 2], adapters: players }).run();
    }
    assert.ok(withShown > 30, '庄家自己亮主的局面太少：' + withShown);
  });

  await testAsync('整局流程：埋牌、出完、零分庄家升三级、抠底', async () => {
    const r = await new Hand({ dealer: 0, levels: [5, 9], adapters: [plain(), plain(), plain(), plain()] }).run();
    assert.equal(r.dealer, 0);
    assert.equal(r.level, 5);
    assert.ok(r.attackerPoints >= 0);
    assert.equal(r.kittyKinds.length, 8);
    const o = R.outcome(r.attackerPoints);
    assert.equal(r.dealerHolds, o.dealerHolds);
    if (o.dealerHolds) {
      assert.equal(r.levelsAfter[0], Math.min(14, 5 + o.up));
      assert.equal(r.levelsAfter[1], 9);
      assert.equal(r.nextDealer, 2);
    } else {
      assert.equal(r.levelsAfter[1], Math.min(14, 9 + o.up));
      assert.equal(r.levelsAfter[0], 5);
      assert.equal(r.nextDealer, 1);
    }
  });

  await testAsync('从 K 升上去也要打一局 A：只有打 A 守住才通关', async () => {
    let held = 0;
    for (let i = 0; i < 40 && held < 3; i++) {
      const players = [0, 1, 2, 3].map(() => AI.createPlayer({ params: { simWorlds: 0 } }));
      const r = await new Hand({ dealer: 0, levels: [13, 13], adapters: players }).run();
      assert.equal(r.champion, null);
      assert.ok(r.levelsAfter[0] <= 14 && r.levelsAfter[1] <= 14);
      if (r.dealerHolds) {
        assert.equal(r.levelsAfter[0], Math.min(14, 13 + r.up));
        held++;
      }
    }
    assert.ok(held > 0);
  });

  await testAsync('结算的赢墩得分是闲家真正赢到的墩分，不受罚分影响', async () => {
    for (let i = 0; i < 20; i++) {
      const players = [0, 1, 2, 3].map(() => AI.createPlayer({ params: { simWorlds: 0 } }));
      let won = 0;
      const hook = (e) => {
        if (e.type === 'trickEnd' && e.toAttackers) won += e.points;
      };
      const r = await new Hand({ dealer: i % 4, levels: [2, 2], adapters: players, hook }).run();
      assert.equal(r.trickPoints, won);
      assert.equal(r.attackerPoints, Math.max(0, r.trickPoints + r.kittyBonus + r.penalties));
    }
  });

  await testAsync('打过 A 才算通关', async () => {
    let foundChampion = false;
    for (let i = 0; i < 40 && !foundChampion; i++) {
      const players = [0, 1, 2, 3].map(() => AI.createPlayer({ params: { simWorlds: 0 } }));
      const r = await new Hand({ dealer: 0, levels: [14, 3], adapters: players }).run();
      if (r.dealerHolds) {
        assert.equal(r.champion, 0);
        assert.equal(r.levelsAfter[0], 14);
        foundChampion = true;
      } else {
        assert.equal(r.champion, null);
      }
    }
    assert.ok(foundChampion, '40 局里至少该守住一次');
  });

  await testAsync('别人的 view 里没有手牌、牌堆，底牌只有庄家知道', async () => {
    const views = [];
    const wrap = (p) => ({
      chooseBid: (v, o, l) => { views.push(v); return p.chooseBid(v, o, l); },
      chooseBury: (v) => { views.push(v); return p.chooseBury(v); },
      chooseLead: (v) => { views.push(v); return p.chooseLead(v); },
      chooseFollow: (v, i) => { views.push(v); return p.chooseFollow(v, i); },
    });
    const players = [0, 1, 2, 3].map(() => wrap(AI.createPlayer({ params: { simWorlds: 6 } })));
    for (let i = 0; i < 6; i++) await new Hand({ dealer: null, starter: i % 4, levels: [2, 2], adapters: players }).run();
    assert.ok(views.length > 200);
    for (const v of views) {
      assert.deepEqual(Object.keys(v).sort(), ['attackerPoints', 'bid', 'buried', 'current', 'dealer', 'dealt', 'flipped', 'hand', 'handCounts', 'level', 'levels', 'phase', 'seat', 'shownIds', 'tricks', 'trump'].sort());
      assert.ok(Object.isFrozen(v) && Object.isFrozen(v.hand));
      if (v.seat !== v.dealer) assert.equal(v.buried, null, '只有庄家知道底牌');
      assert.ok(v.handCounts.every((n) => typeof n === 'number'));
    }
  });

  await testAsync('AI 不偷看：决定只取决于 view', async () => {
    const ai = AI.createPlayer();
    const log = [];
    const spy = {
      chooseBid: (v, o, l) => { const a = ai.chooseBid(v, o, l); log.push(['bid', v, o, l, a]); return a; },
      chooseBury: (v) => { const a = ai.chooseBury(v); log.push(['bury', v, null, null, a]); return a; },
      chooseLead: (v) => { const a = ai.chooseLead(v); log.push(['lead', v, null, null, a]); return a; },
      chooseFollow: (v, i) => { const a = ai.chooseFollow(v, i); log.push(['follow', v, i, null, a]); return a; },
    };
    await new Hand({ dealer: null, starter: 1, levels: [2, 2], adapters: [spy, spy, spy, spy] }).run();
    const fresh = AI.createPlayer();
    for (const [what, v, x, l, a] of log) {
      let b;
      if (what === 'bid') b = fresh.chooseBid(v, x, l);
      else if (what === 'bury') b = fresh.chooseBury(v);
      else if (what === 'lead') b = fresh.chooseLead(v);
      else b = fresh.chooseFollow(v, x);
      assert.deepEqual(a, b);
    }
    const src = require('fs').readFileSync(require.resolve('../js/ai.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|crypto|game\.js|\bHand\b/.test(code), 'AI 不该用随机数或碰裁判');
  });

  // ---- 大量模拟 --------------------------------------------------------------
  const N = Number(process.argv[2]) || 1500;
  const stats = {
    hands: 0, attackerTotal: 0, dealerHolds: 0, up: {}, teamWins: [0, 0], throws: 0, throwFails: 0,
    kittyBonusHands: 0, kittyBonus: 0, buriedPts: 0, ms: 0, decisions: 0, tricks: 0, bids: 0, noBid: 0, nt: 0,
  };
  const fast = { params: { simWorlds: 0 } }; // 大量模拟用不推演的快速版，规则路径完全一样
  const players = [0, 1, 2, 3].map(() => AI.createPlayer(fast));
  const timed = players.map((p) => ({
    chooseBid: (v, o, l) => p.chooseBid(v, o, l),
    chooseBury: (v) => p.chooseBury(v),
    chooseLead: (v) => { const t = performance.now(); const a = p.chooseLead(v); stats.ms += performance.now() - t; stats.decisions++; return a; },
    chooseFollow: (v, i) => { const t = performance.now(); const a = p.chooseFollow(v, i); stats.ms += performance.now() - t; stats.decisions++; return a; },
  }));

  await testAsync('模拟 ' + N + ' 局：牌张守恒、分数合计、都能结束', async () => {
    for (let i = 0; i < N; i++) {
      const counted = new Set();
      let fails = 0;
      let throws = 0;
      let tricks = 0;
      let bids = 0;
      let totalPts = 0;
      let attackerFromTricks = 0;
      let dealer = null;
      const hook = (e) => {
        if (e.type === 'deal') {
          assert.equal(e.kind, null, '发牌事件不该透露牌种');
          assert.ok(!counted.has(e.id), '同一张牌发了两次');
          counted.add(e.id);
        }
        if (e.type === 'bid') bids++;
        if (e.type === 'trumpSet') dealer = e.dealer;
        if (e.type === 'throwFailed') fails++;
        if (e.type === 'play' && e.isThrow) throws++;
        if (e.type === 'trickEnd') {
          tricks++;
          totalPts += e.points;
          if (e.toAttackers) attackerFromTricks += e.points;
        }
      };
      const r = await new Hand({ dealer: null, starter: i % 4, levels: [2 + (i % 13), 2 + ((i * 3) % 13)], adapters: timed, hook }).run();
      assert.equal(totalPts + r.kittyPoints, 200, '牌面分合计不是 200：' + totalPts + '+' + r.kittyPoints);
      assert.equal(r.attackerPoints, Math.max(0, attackerFromTricks + r.kittyBonus + r.penalties));
      assert.equal(r.tricks, tricks);
      assert.equal(r.dealer, dealer);
      if (r.multiplier) assert.equal(teamOf(r.lastWinner), r.attackers);
      else assert.equal(teamOf(r.lastWinner), r.dealerTeam);
      stats.hands++;
      stats.attackerTotal += r.attackerPoints;
      if (r.dealerHolds) stats.dealerHolds++;
      stats.teamWins[r.winnerTeam]++;
      const key = (r.dealerHolds ? '庄+' : '闲+') + r.up;
      stats.up[key] = (stats.up[key] || 0) + 1;
      stats.throws += throws;
      stats.throwFails += fails;
      stats.tricks += tricks;
      stats.buriedPts += r.kittyPoints;
      if (r.kittyBonus > 0) { stats.kittyBonusHands++; stats.kittyBonus += r.kittyBonus; }
      if (bids === 0) stats.noBid++;
      stats.bids += bids;
      if (r.trump === null) stats.nt++;
    }
  });

  await testAsync('发牌公平：每个座位拿到的王、分牌、主牌张数没有差异', async () => {
    const M = 3000;
    const stop = new Error('STOP');
    const joker = [0, 0, 0, 0];
    const pts = [0, 0, 0, 0];
    const quick = { chooseBid: () => null, chooseBury() { throw stop; }, chooseLead() { throw stop; }, chooseFollow() { throw stop; } };
    for (let i = 0; i < M; i++) {
      const observer = i % 4;
      const h = new Hand({
        dealer: (i >> 2) % 4, levels: [2, 2], adapters: [quick, quick, quick, quick], observer,
        hook: (e) => {
          if (e.type === 'deal' && e.seat === observer) {
            if (C.isJoker(e.kind)) joker[observer]++;
            pts[observer] += C.points(e.kind);
          }
          if (e.type === 'dealDone') throw stop;
        },
      });
      await h.run().catch((e) => { if (e !== stop) throw e; });
    }
    const chi2 = (arr) => {
      const total = arr.reduce((a, b) => a + b, 0);
      const e = total / 4;
      return arr.reduce((a, x) => a + (x - e) * (x - e) / e, 0);
    };
    console.log('  王分布', joker, 'χ²=' + chi2(joker).toFixed(2), ' 分牌分布', pts);
    assert.ok(chi2(joker) < 17.7, '发牌分布有偏');
    const ptsE = pts.reduce((a, b) => a + b, 0) / 4;
    for (const p of pts) assert.ok(Math.abs(p - ptsE) / ptsE < 0.03, '分牌分布偏差过大');
  });

  await testAsync('AI 明显强过乱打（同牌对打）', async () => {
    const dumb = {
      chooseBid: () => null,
      chooseBury: (v) => { const h = v.hand.filter((t) => !v.shownIds.includes(t.id)); C.shuffle(h); return h.slice(0, 8).map((t) => t.id); },
      chooseLead: (v) => [v.hand[C.secureInt(v.hand.length)].id],
      chooseFollow: (v, info) => {
        const ctx = R.makeCtx(v.level, v.trump);
        const cls = ctx.cls[info.lead[0]];
        const hand = v.hand.map((t) => t.kind);
        const same = v.hand.filter((t) => ctx.cls[t.kind] === cls);
        const pick = same.length >= info.lead.length ? same : same.concat(v.hand.filter((t) => ctx.cls[t.kind] !== cls));
        // 随机试到合法为止，保底时按结构规则由 AI 模块的合法性判定挡下
        for (let tries = 0; tries < 400; tries++) {
          const s = pick.slice();
          C.shuffle(s);
          const ids = s.slice(0, info.lead.length);
          if (R.canFollow(hand, info.lead, ids.map((t) => t.kind), ctx).ok) return ids.map((t) => t.id);
        }
        return AI.createPlayer({ params: { simWorlds: 0 } }).chooseFollow(v, info);
      },
    };
    const M = Math.min(N, 400);
    let aiPtsWhenAttack = 0;
    let dumbPtsWhenAttack = 0;
    for (let i = 0; i < M; i++) {
      const deck = shuffled();
      const smart = AI.createPlayer({ params: { simWorlds: 0 } });
      // 同一副牌：AI 当闲家一次，当庄家一次
      const a = await new Hand({ dealer: 0, levels: [2, 2], presetDeck: deck, adapters: [dumb, smart, dumb, smart] }).run();
      aiPtsWhenAttack += a.attackerPoints;
      const b = await new Hand({ dealer: 0, levels: [2, 2], presetDeck: deck, adapters: [smart, dumb, smart, dumb] }).run();
      dumbPtsWhenAttack += b.attackerPoints;
    }
    console.log('  AI 当闲家平均得 ' + (aiPtsWhenAttack / M).toFixed(1) + ' 分；乱打当闲家平均得 ' + (dumbPtsWhenAttack / M).toFixed(1) + ' 分');
    assert.ok(aiPtsWhenAttack > dumbPtsWhenAttack * 1.5);
  });

  const n = stats.hands;
  const pct = (x) => (100 * x / n).toFixed(1) + '%';
  console.log('\n模拟结果（' + n + ' 局，同一 AI 四家）');
  console.log('  闲家平均得分 ' + (stats.attackerTotal / n).toFixed(1) + '，庄家守住 ' + pct(stats.dealerHolds) + '，两队胜局 ' + stats.teamWins.join(' / '));
  console.log('  结果分布 ' + Object.entries(stats.up).sort().map(([k, v]) => k + ':' + v).join('  '));
  console.log('  每局 ' + (stats.tricks / n).toFixed(1) + ' 墩，甩牌 ' + stats.throws + ' 次（失败 ' + stats.throwFails + ' 次），平均埋分 ' + (stats.buriedPts / n).toFixed(1));
  console.log('  抠底 ' + pct(stats.kittyBonusHands) + '，平均每次加 ' + (stats.kittyBonus / Math.max(stats.kittyBonusHands, 1)).toFixed(1) + ' 分');
  console.log('  亮主 ' + (stats.bids / n).toFixed(2) + ' 次/局，没人亮主 ' + pct(stats.noBid) + '，无主局 ' + pct(stats.nt));
  console.log('  AI 平均每次决策 ' + (stats.ms / Math.max(stats.decisions, 1)).toFixed(2) + ' ms');
  console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '，有失败' : '，全部通过'));
})();

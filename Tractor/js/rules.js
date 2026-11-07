/* 拖拉机（升级 / 80 分）规则：牌序、牌型、跟牌、比大小、算分。全部是纯函数，不含牌局状态。 */
(function (root) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./cards.js') : root.TJ.Cards;

  const TRUMP = 4; // 主牌这一门的编号，普通花色是 0..3

  const VALUES = {
    handSize: 25,
    kittySize: 8,
    line: 80,
    step: 40,
    throwPenalty: 10, // 甩牌失败罚分
  };

  /** 把「打几、什么主」变成查表：每种牌属于哪一门，以及在这一门里的大小。 */
  function makeCtx(level, trump) {
    const cls = new Int8Array(54);
    const pow = new Int8Array(54);
    for (let k = 0; k < 52; k++) {
      const s = C.suitOf(k);
      const r = C.rankOf(k);
      if (r === level) {
        cls[k] = TRUMP;
        pow[k] = s === trump ? 13 : 12; // 主级牌 > 副级牌（副级牌彼此一样大）
      } else {
        cls[k] = s === trump ? TRUMP : s;
        pow[k] = r - 2 - (r > level ? 1 : 0); // 跳过级牌，两边的牌算相邻
      }
    }
    cls[C.SMALL_JOKER] = TRUMP;
    cls[C.BIG_JOKER] = TRUMP;
    // 无主时没有主级牌，小王紧挨级牌
    pow[C.SMALL_JOKER] = trump === null ? 13 : 14;
    pow[C.BIG_JOKER] = trump === null ? 14 : 15;
    return { level, trump, cls, pow };
  }

  function tally(kinds) {
    const m = new Map();
    for (const k of kinds) m.set(k, (m.get(k) || 0) + 1);
    return m;
  }

  /**
   * 把同一门的牌拆成拖拉机、对子、单张（优先凑最长的拖拉机）。
   * 返回按牌数从多到少、同样牌数从大到小排好的部件。
   */
  function decompose(kinds, ctx) {
    const left = tally(kinds);
    const comps = [];
    for (;;) {
      const byPow = new Map();
      for (const [k, n] of left) {
        if (n >= 2 && !byPow.has(ctx.pow[k])) byPow.set(ctx.pow[k], k);
      }
      const powers = [...byPow.keys()].sort((a, b) => b - a);
      let bestStart = -1;
      let bestLen = 1;
      let i = 0;
      while (i < powers.length) {
        let j = i;
        while (j + 1 < powers.length && powers[j + 1] === powers[j] - 1) j++;
        const len = j - i + 1;
        if (len > bestLen) {
          bestLen = len;
          bestStart = i;
        }
        i = j + 1;
      }
      if (bestStart < 0) break;
      const run = powers.slice(bestStart, bestStart + bestLen).map((p) => byPow.get(p));
      for (const k of run) left.set(k, left.get(k) - 2);
      comps.push({ type: 'tractor', len: bestLen, kinds: run.flatMap((k) => [k, k]), top: ctx.pow[run[0]], size: bestLen * 2 });
    }
    for (const [k, n] of left) {
      if (n >= 2) {
        comps.push({ type: 'pair', len: 1, kinds: [k, k], top: ctx.pow[k], size: 2 });
        left.set(k, n - 2);
      }
    }
    for (const [k, n] of left) {
      for (let i = 0; i < n; i++) comps.push({ type: 'single', len: 1, kinds: [k], top: ctx.pow[k], size: 1 });
    }
    comps.sort((a, b) => b.size - a.size || b.top - a.top);
    return comps;
  }

  /** 这些牌是否属于同一门。 */
  function sameClass(kinds, ctx) {
    const c = ctx.cls[kinds[0]];
    return kinds.every((k) => ctx.cls[k] === c);
  }

  /** 从一堆牌里找到各个长度的连对：返回 [{top, len, kinds}]，每个高度只取一种牌。 */
  function runsOf(kindsList, ctx) {
    const counts = tally(kindsList);
    const byPow = new Map();
    for (const [k, n] of counts) {
      if (n >= 2 && !byPow.has(ctx.pow[k])) byPow.set(ctx.pow[k], k);
    }
    const powers = [...byPow.keys()].sort((a, b) => b - a);
    const runs = [];
    let i = 0;
    while (i < powers.length) {
      let j = i;
      while (j + 1 < powers.length && powers[j + 1] === powers[j] - 1) j++;
      if (j > i) runs.push({ top: powers[i], len: j - i + 1, kinds: powers.slice(i, j + 1).map((p) => byPow.get(p)) });
      i = j + 1;
    }
    return runs;
  }

  /** 手里（已限定在同一门）有没有能压过这个部件的牌。甩牌时用来检查。 */
  function canBeatComp(comp, handKinds, ctx) {
    if (comp.type === 'single') return handKinds.some((k) => ctx.pow[k] > comp.top);
    if (comp.type === 'pair') {
      const c = tally(handKinds);
      for (const [k, n] of c) if (n >= 2 && ctx.pow[k] > comp.top) return true;
      return false;
    }
    for (const r of runsOf(handKinds, ctx)) {
      // 这段连对里长度够、顶比对方大的子段
      if (r.len >= comp.len && r.top > comp.top) return true;
    }
    return false;
  }

  /**
   * 跟牌的「结构分」：手里这些牌能对上领出牌型的多少。
   * 必须打够：有拖拉机出拖拉机，没有就出对子，再没有才出散牌。
   */
  function structureScore(kinds, leadComps, ctx) {
    let tractorScore = 0;
    let pool = kinds.slice();
    let pairsNeeded = 0;
    for (const comp of leadComps) {
      if (comp.type === 'pair') pairsNeeded += 1;
      if (comp.type === 'tractor') pairsNeeded += comp.len;
    }
    for (const comp of leadComps) {
      if (comp.type !== 'tractor') continue;
      const runs = runsOf(pool, ctx).sort((a, b) => b.len - a.len);
      if (!runs.length) continue;
      const take = Math.min(runs[0].len, comp.len);
      tractorScore += take * take;
      pairsNeeded -= take;
      const used = runs[0].kinds.slice(0, take);
      for (const k of used) {
        pool.splice(pool.indexOf(k), 1);
        pool.splice(pool.indexOf(k), 1);
      }
    }
    let pairs = 0;
    for (const [, n] of tally(pool)) if (n >= 2) pairs++;
    return tractorScore * 100 + Math.min(pairs, Math.max(0, pairsNeeded));
  }

  /**
   * 跟牌是否合法。hand、play 都是牌种数组，lead 是领出的牌种。
   * 同门够：必须全从这门出，并且结构分要和手里能拿出的最好结构一样。
   * 同门不够：这门全部打出，其余随便垫。
   */
  function canFollow(hand, lead, play, ctx) {
    if (play.length !== lead.length) return { ok: false, reason: '要出 ' + lead.length + ' 张' };
    const counts = tally(hand);
    for (const [k, n] of tally(play)) {
      if ((counts.get(k) || 0) < n) return { ok: false, reason: '手里没有这张牌' };
    }
    const cls = ctx.cls[lead[0]];
    const same = hand.filter((k) => ctx.cls[k] === cls);
    const playSame = play.filter((k) => ctx.cls[k] === cls);
    if (same.length <= lead.length) {
      if (playSame.length !== same.length) return { ok: false, reason: '同门的牌必须全部打出' };
      return { ok: true };
    }
    if (playSame.length !== lead.length) return { ok: false, reason: '手里还有这门牌，必须跟同门' };
    const comps = decompose(lead, ctx);
    if (structureScore(play, comps, ctx) < structureScore(same, comps, ctx)) {
      const hasTractor = comps.some((c) => c.type === 'tractor');
      return { ok: false, reason: hasTractor ? '手里有拖拉机或对子，必须跟上' : '手里有对子，必须跟对子' };
    }
    return { ok: true };
  }

  /**
   * 这手跟牌能否按领牌的结构拆开（同结构才可能赢）。能拆就返回最大部件的顶。
   * 甩牌按最大的部件比大小，部件多的时候单张不比。
   */
  function fitsLead(play, leadComps, ctx) {
    if (!sameClass(play, ctx)) return null;
    let pool = play.slice();
    let top = null;
    for (const comp of leadComps) {
      let got = null;
      if (comp.type === 'tractor') {
        const runs = runsOf(pool, ctx).filter((r) => r.len >= comp.len).sort((a, b) => b.top - a.top);
        if (runs.length) {
          const used = runs[0].kinds.slice(0, comp.len);
          got = runs[0].top;
          for (const k of used) {
            pool.splice(pool.indexOf(k), 1);
            pool.splice(pool.indexOf(k), 1);
          }
        }
      } else if (comp.type === 'pair') {
        let best = -1;
        let bestK = -1;
        for (const [k, n] of tally(pool)) {
          if (n >= 2 && ctx.pow[k] > best) { best = ctx.pow[k]; bestK = k; }
        }
        if (bestK >= 0) {
          got = best;
          pool.splice(pool.indexOf(bestK), 1);
          pool.splice(pool.indexOf(bestK), 1);
        }
      } else if (pool.length) {
        let bestK = pool[0];
        for (const k of pool) if (ctx.pow[k] > ctx.pow[bestK]) bestK = k;
        got = ctx.pow[bestK];
        pool.splice(pool.indexOf(bestK), 1);
      }
      if (got === null) return null;
      if (top === null) top = got;
    }
    return top;
  }

  /** 这一墩谁赢。plays: [{seat, kinds}]，第一个是领牌。同样大时先出的赢。 */
  function trickWinner(plays, ctx) {
    const lead = plays[0].kinds;
    const comps = decompose(lead, ctx);
    const leadClass = ctx.cls[lead[0]];
    let bestSeat = plays[0].seat;
    let bestIsTrump = leadClass === TRUMP;
    let bestTop = comps[0].top;
    for (let i = 1; i < plays.length; i++) {
      const p = plays[i];
      const cls = ctx.cls[p.kinds[0]];
      if (!sameClass(p.kinds, ctx)) continue;
      if (cls !== leadClass && cls !== TRUMP) continue;
      const top = fitsLead(p.kinds, comps, ctx);
      if (top === null) continue;
      const isTrump = cls === TRUMP;
      if ((isTrump && !bestIsTrump) || (isTrump === bestIsTrump && top > bestTop)) {
        bestSeat = p.seat;
        bestIsTrump = isTrump;
        bestTop = top;
      }
    }
    return bestSeat;
  }

  /**
   * 判定一手领牌。单张、对子、拖拉机直接合法；多个部件是甩牌，
   * others 是其余三家手牌（只有裁判有），任何一家能压过其中某个部件就算失败。
   * 失败时必须改出被压住的最小部件。
   */
  function checkLead(kinds, others, ctx) {
    if (!kinds.length) return { ok: false, reason: '先选牌' };
    if (!sameClass(kinds, ctx)) return { ok: false, reason: '一次只能出同一门的牌' };
    const comps = decompose(kinds, ctx);
    if (comps.length === 1) return { ok: true, comps, isThrow: false };
    const cls = ctx.cls[kinds[0]];
    let failed = null;
    for (const comp of comps) {
      const beaten = others.some((hand) => canBeatComp(comp, hand.filter((k) => ctx.cls[k] === cls), ctx));
      if (beaten && (!failed || comp.size < failed.size || (comp.size === failed.size && comp.top < failed.top))) {
        failed = comp;
      }
    }
    if (failed) return { ok: true, comps, isThrow: true, failed };
    return { ok: true, comps, isThrow: true };
  }

  /** 抠底倍数：最后一墩最大部件的张数 × 2（单张 2 倍、对子 4 倍、两对拖拉机 8 倍）。 */
  function kittyMultiplier(leadKinds, ctx) {
    return decompose(leadKinds, ctx)[0].size * 2;
  }

  /** 闲家得分 -> 谁升几级。返回 { dealerHolds, up }。 */
  function outcome(attackerPoints) {
    const p = Math.max(0, attackerPoints);
    if (p === 0) return { dealerHolds: true, up: 3 };
    if (p < 40) return { dealerHolds: true, up: 2 };
    if (p < 80) return { dealerHolds: true, up: 1 };
    if (p < 120) return { dealerHolds: false, up: 0 };
    if (p < 160) return { dealerHolds: false, up: 1 };
    if (p < 200) return { dealerHolds: false, up: 2 };
    return { dealerHolds: false, up: 3 + Math.floor((p - 200) / 40) };
  }

  /**
   * 亮主。strength：单张级牌 1，一对级牌 2，一对小王 3，一对大王 4（后两种是无主）。
   * 新的亮主必须比当前更强；同花色加对只有本人可以（两副牌里只有他能凑出这一对）。
   */
  function legalBids(handKinds, level, current) {
    const c = tally(handKinds);
    const strength = current ? current.strength : 0;
    const out = [];
    for (let s = 0; s < 4; s++) {
      const k = C.kindOf(s, level);
      const n = c.get(k) || 0;
      if (n >= 1 && strength < 1) out.push({ strength: 1, suit: s, kinds: [k] });
      if (n >= 2 && strength < 2) out.push({ strength: 2, suit: s, kinds: [k, k] });
    }
    if ((c.get(C.SMALL_JOKER) || 0) >= 2 && strength < 3) out.push({ strength: 3, suit: null, kinds: [C.SMALL_JOKER, C.SMALL_JOKER] });
    if ((c.get(C.BIG_JOKER) || 0) >= 2 && strength < 4) out.push({ strength: 4, suit: null, kinds: [C.BIG_JOKER, C.BIG_JOKER] });
    return out;
  }

  /** 手牌显示顺序：主牌在最左边从大到小，其余按花色，从大到小。 */
  function sortKey(k, ctx) {
    const cls = ctx.cls[k];
    const group = cls === TRUMP ? 0 : 1 + cls;
    return group * 100 - ctx.pow[k] + (ctx.trump !== null && C.suitOf(k) === ctx.trump ? -0.5 : 0) + (cls === TRUMP && !C.isJoker(k) ? C.suitOf(k) * 0.01 : 0);
  }

  /** 只知道打几、还没定主时的排序：王和级牌在最左，其余按花色。 */
  function sortKeyEarly(k, level) {
    if (C.isJoker(k)) return -100 - k;
    const r = C.rankOf(k);
    if (r === level) return -50 + C.suitOf(k);
    return (1 + C.suitOf(k)) * 100 - r;
  }

  const api = {
    TRUMP, VALUES, makeCtx, tally, decompose, sameClass, runsOf, canBeatComp, structureScore,
    canFollow, fitsLead, trickWinner, checkLead, kittyMultiplier, outcome, legalBids, sortKey, sortKeyEarly,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.TJ = root.TJ || {}).Rules = api;
})(typeof self !== 'undefined' ? self : globalThis);

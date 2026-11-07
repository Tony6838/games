/* 上海麻将（清混碰）规则：牌型判定、算花、算点、结算。不含任何牌局状态，全部是纯函数。 */
(function (root) {
  'use strict';
  const T = typeof module === 'object' && module.exports ? require('./tiles.js') : root.MJ.Tiles;

  /** 所有可调的规则数值都在这里。1 辣 = 10 点；普通牌面 = 底 2 点 + 花数，封顶 1 辣。 */
  const VALUES = {
    base: 2,
    la: 10,
    shapeLa: { qingyise: 1, hunpeng: 1, qingpeng: 2, luanfeng: 2, ziyise: 4 },
    bahuaLa: 4,
    tianhuLa: 10,
    dihuLa: 8,
    qizhuoyiLa: 1,
    robMultiple: 3,
    sankouCalls: 3,
    sankouZimoShares: 5,
    sankouRonShares: 2,
  };

  const SHAPE_NAMES = {
    qingyise: '清一色',
    hunyise: '混一色',
    pengpeng: '碰碰胡',
    hunpeng: '混碰',
    qingpeng: '清碰',
    luanfeng: '乱风向',
    ziyise: '字一色',
  };

  function toCounts(kinds) {
    const c = new Array(34).fill(0);
    for (const k of kinds) c[k]++;
    return c;
  }

  function sum(c) {
    let s = 0;
    for (let i = 0; i < c.length; i++) s += c[i];
    return s;
  }

  function canFormSets(c, from) {
    let i = from;
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) return true;
    if (c[i] >= 3) {
      c[i] -= 3;
      const ok = canFormSets(c, i);
      c[i] += 3;
      if (ok) return true;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      const ok = canFormSets(c, i);
      c[i]++; c[i + 1]++; c[i + 2]++;
      if (ok) return true;
    }
    return false;
  }

  /** 暗手能否拆成「若干副 + 一对将」。 */
  function isStandard(c) {
    if (sum(c) % 3 !== 2) return false;
    for (let p = 0; p < 34; p++) {
      if (c[p] < 2) continue;
      c[p] -= 2;
      const ok = canFormSets(c, 0);
      c[p] += 2;
      if (ok) return true;
    }
    return false;
  }

  /** 暗手是否全部是刻子加一对将。 */
  function isAllTriplets(c) {
    let pairs = 0;
    for (let i = 0; i < 34; i++) {
      if (c[i] === 0 || c[i] === 3) continue;
      if (c[i] === 2) pairs++;
      else return false;
    }
    return pairs === 1;
  }

  /**
   * 判定牌型。counts 是暗手（含胡的那张），melds 是已亮的副露和暗杠。
   * 清混碰只认这几种牌型，不合的一律返回 null（没有「平胡」）。
   */
  function shapeOf(counts, melds) {
    if (sum(counts) + melds.length * 3 !== 14) return null;
    let mask = 0;
    let honor = false;
    let hasChi = false;
    const note = (k) => {
      if (T.isHonor(k)) honor = true;
      else mask |= 1 << T.suitOf(k);
    };
    for (let k = 0; k < 34; k++) if (counts[k] > 0) note(k);
    for (const m of melds) {
      if (m.type === 'chi') hasChi = true;
      for (const k of m.kinds) note(k);
    }
    const std = isStandard(counts);
    if (mask === 0) return std ? 'ziyise' : 'luanfeng'; // 全是风牌和箭牌，乱风向不必成副
    if (!std) return null;
    const oneSuit = (mask & (mask - 1)) === 0;
    const peng = !hasChi && isAllTriplets(counts);
    if (oneSuit && !honor) return peng ? 'qingpeng' : 'qingyise';
    if (oneSuit) return peng ? 'hunpeng' : 'hunyise';
    return peng ? 'pengpeng' : null;
  }

  function honorLabel(k) {
    return T.name(k);
  }

  /** 一副副露值几花：普通牌碰 0、明杠 1、暗杠 2；风牌 1/2/3；箭牌 2/3/4。 */
  function meldFlowers(m) {
    if (m.type === 'chi') return 0;
    const k = m.kinds[0];
    const cls = T.isDragon(k) ? 2 : T.isWind(k) ? 1 : 0;
    if (m.type === 'peng') return cls;
    return cls + (m.sub === 'an' ? 2 : 1);
  }

  function meldLabel(m) {
    const n = T.name(m.kinds[0]);
    if (m.type === 'peng') return n + '碰';
    if (m.sub === 'an') return n + '暗杠';
    return n + '明杠';
  }

  function flowerDetail(counts, melds, flowerCount, standard) {
    const items = [];
    if (flowerCount > 0) items.push({ label: '花牌 ×' + flowerCount, n: flowerCount });
    for (const m of melds) {
      const n = meldFlowers(m);
      if (n > 0) items.push({ label: meldLabel(m), n });
    }
    if (standard) {
      for (let k = 27; k < 34; k++) {
        if (counts[k] === 3) items.push({ label: honorLabel(k) + '暗刻', n: T.isDragon(k) ? 2 : 1 });
      }
    }
    let total = 0;
    for (const it of items) total += it.n;
    return { items, total };
  }

  function applyTableMultipliers(res, ctx) {
    if (ctx.huangfan) {
      res.points *= 2;
      res.patterns.push('荒番');
      res.steps.push('荒番 ×2 = ' + res.points + ' 点');
    }
    if (ctx.kaibao) {
      res.points *= 2;
      res.patterns.push('开宝');
      res.steps.push('开宝（骰子成对）×2 = ' + res.points + ' 点');
    }
    return res;
  }

  /** 不看牌型的满贯类：八花、七捉一。 */
  function flatScore(kind, ctx) {
    const la = kind === 'bahua' ? VALUES.bahuaLa : VALUES.qizhuoyiLa;
    const label = kind === 'bahua' ? '八花' : '七捉一';
    const points = la * VALUES.la;
    return applyTableMultipliers({
      shape: kind,
      shapeName: label,
      patterns: [label],
      flowers: { items: [{ label: '花牌 ×' + (ctx.flowerCount || 0), n: ctx.flowerCount || 0 }], total: ctx.flowerCount || 0 },
      steps: [label + '：' + la + ' 辣 = ' + points + ' 点'],
      points,
      closed: false,
    }, ctx);
  }

  /**
   * 算一手胡牌的牌面点数（每一份的大小）。
   * ctx: { counts, melds, flowerCount, selfDraw, afterKong, lastTile, robKong, tianhu, dihu, huangfan, kaibao }
   * 牌型不合法时返回 null，所以它同时也是「能不能胡」的唯一判定。
   */
  function score(ctx) {
    const { counts, melds } = ctx;
    const shape = shapeOf(counts, melds);
    if (!shape) return null;

    const standard = shape !== 'luanfeng';
    const flowers = flowerDetail(counts, melds, ctx.flowerCount || 0, standard);
    const closed = melds.every((m) => m.type === 'gang' && m.sub === 'an');
    const res = {
      shape,
      shapeName: SHAPE_NAMES[shape],
      patterns: [SHAPE_NAMES[shape]],
      flowers,
      steps: [],
      points: 0,
      closed,
    };

    if (ctx.tianhu || ctx.dihu) {
      const la = ctx.tianhu ? VALUES.tianhuLa : VALUES.dihuLa;
      const label = ctx.tianhu ? '天胡' : '地胡';
      res.patterns.unshift(label);
      res.points = la * VALUES.la;
      res.steps.push(label + '：' + la + ' 辣 = ' + res.points + ' 点');
      return applyTableMultipliers(res, ctx);
    }

    const la = VALUES.shapeLa[shape] || 0;
    if (la) {
      res.points = la * VALUES.la;
      res.steps.push(res.shapeName + '：' + la + ' 辣 = ' + res.points + ' 点');
    } else {
      const raw = VALUES.base + flowers.total;
      res.points = Math.min(raw, VALUES.la);
      res.steps.push(res.shapeName + '：底 ' + VALUES.base + ' + ' + flowers.total + ' 花 = ' + raw + ' 点' +
        (raw >= VALUES.la ? '（到 8 花算 1 辣）' : ''));
    }

    const raiseToLa = (label) => {
      res.patterns.push(label);
      res.points = res.points < VALUES.la ? VALUES.la : res.points + VALUES.la;
      res.steps.push(label + '：不足 1 辣算 1 辣，已是辣子再加 1 辣 = ' + res.points + ' 点');
    };
    if (melds.length === 4) raiseToLa('大吊车');
    if (ctx.afterKong && ctx.selfDraw) raiseToLa('杠开');

    if (closed) {
      res.points *= 2;
      res.patterns.push('门清');
      res.steps.push('门清 ×2 = ' + res.points + ' 点');
    }
    if (ctx.lastTile && ctx.selfDraw) {
      res.points *= 2;
      res.patterns.push('海底捞月');
      res.steps.push('海底捞月 ×2 = ' + res.points + ' 点');
    }
    if (ctx.robKong) res.patterns.push('拉杠胡');
    return applyTableMultipliers(res, ctx);
  }

  /** 这手牌（13 - 3×副露 张）听哪些牌。胡牌合法性与 score 同一套判定。 */
  function waits(counts, melds) {
    const out = [];
    for (let k = 0; k < 34; k++) {
      if (counts[k] >= 4) continue;
      counts[k]++;
      if (shapeOf(counts, melds)) out.push(k);
      counts[k]--;
    }
    return out;
  }

  /** 吃牌的组合。吃完必须还有别的牌可打（不能吃 4 万打 4 万）。 */
  function chiOptions(counts, k) {
    if (!T.isNumber(k)) return [];
    const r = T.rankOf(k);
    const out = [];
    if (r >= 2 && counts[k - 2] > 0 && counts[k - 1] > 0) out.push([k - 2, k - 1]);
    if (r >= 1 && r <= 7 && counts[k - 1] > 0 && counts[k + 1] > 0) out.push([k - 1, k + 1]);
    if (r <= 6 && counts[k + 1] > 0 && counts[k + 2] > 0) out.push([k + 1, k + 2]);
    return out.filter(([a, b]) => {
      for (let i = 0; i < 34; i++) {
        const left = counts[i] - (i === a ? 1 : 0) - (i === b ? 1 : 0);
        if (left > 0 && i !== k) return true;
      }
      return false;
    });
  }

  /** 三口（包牌）：任意一方吃碰杠另一方累计 3 次，两人即互相绑定。 */
  function isSankou(calls, a, b) {
    return calls[a][b] >= VALUES.sankouCalls || calls[b][a] >= VALUES.sankouCalls;
  }

  /**
   * 结算。winners: [{seat, how:'zimo'|'ron'|'rob'|'qizhuoyi', from, points}]。
   * tingOf(seat) 只在第三家放炮、胜者有三口关系时才会被用到。
   */
  function settle(winners, calls, tingOf) {
    const deltas = [0, 0, 0, 0];
    const payments = [];
    const pay = (from, to, amount, note) => {
      deltas[from] -= amount;
      deltas[to] += amount;
      payments.push({ from, to, amount, note });
    };
    for (const w of winners) {
      const P = w.points;
      const partners = [0, 1, 2, 3].filter((s) => s !== w.seat && isSankou(calls, w.seat, s));
      if (w.how === 'rob') {
        pay(w.from, w.seat, P * VALUES.robMultiple, '被拉杠 ×' + VALUES.robMultiple);
      } else if (w.how === 'qizhuoyi') {
        pay(w.from, w.seat, P, '七捉一');
      } else if (w.how === 'zimo') {
        if (partners.length) {
          for (const s of partners) pay(s, w.seat, P * VALUES.sankouZimoShares, '三口包牌 ×' + VALUES.sankouZimoShares);
        } else {
          for (let s = 0; s < 4; s++) if (s !== w.seat) pay(s, w.seat, P, '自摸');
        }
      } else if (partners.includes(w.from)) {
        pay(w.from, w.seat, P * VALUES.sankouRonShares, '三口放炮 ×' + VALUES.sankouRonShares);
        for (const s of partners) if (s !== w.from) pay(s, w.seat, P, '三口连带');
      } else if (partners.length) {
        if (tingOf(w.from)) {
          pay(w.from, w.seat, P, '放炮');
          for (const s of partners) pay(s, w.seat, P, '三口连带');
        } else {
          pay(w.from, w.seat, P * 2, '未听牌放炮 ×2');
        }
      } else {
        pay(w.from, w.seat, P, '放炮');
      }
    }
    return { deltas, payments };
  }

  const api = {
    VALUES, SHAPE_NAMES, toCounts, isStandard, isAllTriplets, shapeOf, meldFlowers,
    flowerDetail, score, flatScore, waits, chiOptions, isSankou, settle,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.MJ = root.MJ || {}).Rules = api;
})(typeof self !== 'undefined' ? self : globalThis);

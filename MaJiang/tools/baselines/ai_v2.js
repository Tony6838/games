/* 机器玩家。
 *
 * 决策是 view（自己的手牌 + 公开信息）的纯函数，没有别的输入，也不碰随机数：
 * 对手手牌和牌墙顺序变了，只要 view 不变，决定就完全相同。tests/run_tests.js 专门验证这一点。
 *
 * 思路：把每种合法牌型（清一色、混一色、碰碰胡、混碰、清碰、乱风向）当作一个目标，
 * 用向听数和进张估算「来得及做成的概率 × 做成后的点数」，再减去按公开信息估计的放炮风险。
 * PARAMS 里的数字由 tools/selfplay.js 四家对局调出来，调优记录在 docs/selfplay_log.md。
 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const T = isNode ? require('../../js/tiles.js') : root.MJ.Tiles;
  const R = isNode ? require('../../js/rules.js') : root.MJ.Rules;

  // 由 tools/selfplay.js tune 四家对局调出，含义见 docs/ai.md
  const PARAMS = {
    refine: 1, // 一向听时实算听牌后的等张，选好等张（1 开 0 关）
    surviveMeld: 0.006, // 对手每多一副副露，牌局早结束的可能就大一点
    gFlush: [0.175, 0.395, 0.57, 0.745],
    gHalf: [0.1, 0.25, 0.416, 0.582],
    gPeng: [0.058, 0.116, 0.174, 0.232],
    callBonus: 0.8,
    ronBonus: 0.755,
    horizon: 12.42,
    survive: 0.97,
    second: 0.2,
    third: 0.05,
    closedBonus: 0.983,
    payScale: 1.8,
    defense: 0.776,
    defenseLate: 0.3,
    tenpaiBase: 0.02,
    tenpaiMeld: 0.183,
    tenpaiLate: 0.269,
    hitBase: 0.033,
    hitOwnRiver: 0.3,
    hitFlush: 1.504,
    hitFlushHonor: 1.1,
    hitOffSuit: 0.189,
    hitPeng: 1.684,
    hitPengThin: 0.5,
    lossFlush: 7.005,
    lossPeng: 7,
    lossPlain: 5,
    stayBias: 1.05,
    stayAdd: 0.1,
    gangAn: 0.35,
    gangMing: 0.3,
    gangJia: 0.1,
    sankouRisk: 0.466,
    passRonMaxPoints: 6,
    passRonFactor: 1.0,
  };

  // ---- 向听数表：按花色缓存 ---------------------------------------------------
  const POW5 = [1, 5, 25, 125, 625, 3125, 15625, 78125, 390625];
  const suitCache = new Map();
  const honorCache = new Map();

  function record(t, h, s, p) {
    const idx = h * 5 + Math.min(s, 4);
    if (p > t[idx]) t[idx] = p;
  }

  function exploreSuit(c, from, h, s, p, t) {
    let i = from;
    while (i < 9 && c[i] === 0) i++;
    if (i === 9) { record(t, h, s, p); return; }
    if (c[i] >= 3 && s < 4) {
      c[i] -= 3; exploreSuit(c, i, h, s + 1, p, t); c[i] += 3;
    }
    if (i <= 6 && c[i + 1] && c[i + 2] && s < 4) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      exploreSuit(c, i, h, s + 1, p, t);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (c[i] >= 2) {
      if (!h) { c[i] -= 2; exploreSuit(c, i, 1, s, p, t); c[i] += 2; }
      if (p < 4) { c[i] -= 2; exploreSuit(c, i, h, s, p + 1, t); c[i] += 2; }
    }
    if (p < 4) {
      if (i <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; exploreSuit(c, i, h, s, p + 1, t); c[i]++; c[i + 1]++; }
      if (i <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; exploreSuit(c, i, h, s, p + 1, t); c[i]++; c[i + 2]++; }
    }
    c[i]--; exploreSuit(c, i, h, s, p, t); c[i]++;
  }

  function suitTable(c, base) {
    let key = 0;
    for (let i = 0; i < 9; i++) key += c[base + i] * POW5[i];
    let t = suitCache.get(key);
    if (t) return t;
    t = new Int8Array(10).fill(-1);
    exploreSuit(c.slice(base, base + 9), 0, 0, 0, 0, t);
    if (suitCache.size > 300000) suitCache.clear();
    suitCache.set(key, t);
    return t;
  }

  function exploreHonor(c, i, h, s, p, t) {
    if (i === 7) { record(t, h, s, p); return; }
    const n = c[i];
    exploreHonor(c, i + 1, h, s, p, t);
    if (n >= 3 && s < 4) exploreHonor(c, i + 1, h, s + 1, p, t);
    if (n >= 2) {
      if (!h) exploreHonor(c, i + 1, 1, s, p, t);
      if (p < 4) exploreHonor(c, i + 1, h, s, p + 1, t);
    }
  }

  function honorTable(c) {
    let key = 0;
    for (let i = 0; i < 7; i++) key += c[27 + i] * POW5[i];
    let t = honorCache.get(key);
    if (t) return t;
    t = new Int8Array(10).fill(-1);
    exploreHonor(c.slice(27, 34), 0, 0, 0, 0, t);
    honorCache.set(key, t);
    return t;
  }

  /** N 是还要凑齐的副数。向听 = 2N - 2×成副 - 搭子 - 将；-1 表示已胡。 */
  function fromParts(N, s, p, h) {
    const sets = Math.min(s, N);
    const partial = Math.min(p, N - sets);
    return 2 * N - 2 * sets - partial - h;
  }

  function shantenOne(a, N) {
    let best = 99;
    for (let h = 0; h < 2; h++) {
      for (let s = 0; s < 5; s++) {
        const p = a[h * 5 + s];
        if (p < 0) continue;
        const v = fromParts(N, s, p, h);
        if (v < best) best = v;
      }
    }
    return best;
  }

  function shantenTwo(a, b, N) {
    let best = 99;
    for (let ha = 0; ha < 2; ha++) {
      for (let sa = 0; sa < 5; sa++) {
        const pa = a[ha * 5 + sa];
        if (pa < 0) continue;
        for (let hb = 0; hb + ha < 2; hb++) {
          for (let sb = 0; sb < 5; sb++) {
            const pb = b[hb * 5 + sb];
            if (pb < 0) continue;
            const v = fromParts(N, sa + sb, pa + pb, ha + hb);
            if (v < best) best = v;
          }
        }
      }
    }
    return best;
  }

  function shantenTriplets(c, from, to, honors, N) {
    let tri = 0;
    let pairs = 0;
    const tally = (x) => {
      if (x >= 3) tri++;
      else if (x === 2) pairs++;
    };
    for (let k = from; k < to; k++) tally(c[k]);
    if (honors) for (let k = 27; k < 34; k++) tally(c[k]);
    const sets = Math.min(tri, N);
    let head = 0;
    let part = pairs;
    if (pairs > 0) { head = 1; part = pairs - 1; }
    else if (tri > N) head = 1;
    return 2 * N - 2 * sets - Math.min(part, N - sets) - head;
  }

  /** 目标牌型的向听数。 */
  function shantenOf(t, c, N) {
    switch (t.type) {
      case 'qing': return shantenOne(suitTable(c, t.suit * 9), N);
      case 'hun': return shantenTwo(suitTable(c, t.suit * 9), honorTable(c), N);
      case 'qpeng': return shantenTriplets(c, t.suit * 9, t.suit * 9 + 9, false, N);
      case 'hpeng': return shantenTriplets(c, t.suit * 9, t.suit * 9 + 9, true, N);
      case 'peng': return shantenTriplets(c, 0, 34, false, N);
      default: { // luan：只看风牌箭牌张数，不必成副
        let x = 0;
        for (let k = 27; k < 34; k++) x += c[k];
        return 3 * N + 1 - x;
      }
    }
  }

  function allowsKind(t, k) {
    switch (t.type) {
      case 'qing': case 'qpeng': return T.suitOf(k) === t.suit;
      case 'hun': case 'hpeng': return T.suitOf(k) === t.suit || T.isHonor(k);
      case 'luan': return T.isHonor(k);
      default: return true;
    }
  }

  /** 已有副露决定了哪些牌型还走得通。 */
  function targetsFor(melds) {
    let mask = 0;
    let honor = false;
    let chi = false;
    for (const m of melds) {
      if (m.type === 'chi') chi = true;
      for (const k of m.kinds) {
        if (T.isHonor(k)) honor = true;
        else mask |= 1 << T.suitOf(k);
      }
    }
    const out = [];
    for (let s = 0; s < 3; s++) {
      if (mask & ~(1 << s)) continue;
      if (!honor) {
        out.push({ type: 'qing', suit: s });
        if (!chi) out.push({ type: 'qpeng', suit: s });
      }
      out.push({ type: 'hun', suit: s });
      if (!chi) out.push({ type: 'hpeng', suit: s });
    }
    if (!chi) out.push({ type: 'peng' });
    if (mask === 0 && !chi) out.push({ type: 'luan' });
    return out;
  }

  /** 到目标完成时大概能拿几点。 */
  function targetValue(t, c, st, P) {
    let v;
    switch (t.type) {
      case 'qing': v = 10; break;
      case 'qpeng': v = 20; break;
      case 'hpeng': v = 10; break;
      case 'luan': v = 20; break;
      default: {
        let f = st.flowerBase;
        for (let k = 27; k < 34; k++) {
          const dragon = k >= 31;
          if (c[k] >= 3) f += dragon ? 2 : 1;
          else if (c[k] === 2) f += dragon ? 1 : 0.5;
        }
        v = Math.min(2 + f, 10);
      }
    }
    if (st.N === 1) v = v < 10 ? (v + 10) / 2 : v + 4; // 再一副就是大吊车
    if (st.closed) v *= P.closedBonus;
    return v * st.mult;
  }

  function stepTable(t, P) {
    switch (t.type) {
      case 'qing': return P.gFlush;
      case 'hun': return P.gHalf;
      case 'luan': return null;
      default: return P.gPeng;
    }
  }

  /**
   * 还要进 steps.length 张牌，每一圈第 i 步成功的概率是 steps[i]，
   * 在 rounds 圈内（牌局每圈以 survive 的概率继续）做完的概率。
   */
  function finishProbability(steps, rounds, survive) {
    const n = steps.length;
    const dp = new Float64Array(n + 1);
    dp[0] = 1;
    let done = 0;
    let alive = 1;
    const whole = Math.floor(rounds);
    for (let r = 0; r <= whole; r++) {
      const weight = r < whole ? 1 : rounds - whole;
      if (weight <= 0) break;
      alive *= survive;
      for (let i = n - 1; i >= 0; i--) {
        const move = dp[i] * steps[i] * weight;
        dp[i] -= move;
        if (i === n - 1) done += move * alive;
        else dp[i + 1] += move;
      }
    }
    return done;
  }

  function buildState(view, c, melds, P) {
    const me = view.players[view.seat];
    let flowerBase = me.flowers.length;
    for (const m of melds) flowerBase += R.meldFlowers(m);
    const seen = new Array(34).fill(0);
    for (const t of view.hand) seen[t.kind]++;
    for (const p of view.players) {
      for (const k of p.discards) seen[k]++;
      for (const m of p.melds) if (m.kinds) for (const k of m.kinds) seen[k]++;
    }
    const unseen = seen.map((n) => Math.max(0, 4 - n));
    let U = 0;
    for (const n of unseen) U += n;
    return {
      N: 4 - melds.length,
      melds,
      targets: targetsFor(melds),
      flowerBase,
      closed: melds.every((m) => m.type === 'gang' && m.sub === 'an'),
      mult: (view.huangfan ? 2 : 1) * (view.kaibao ? 2 : 1),
      unseen,
      U: Math.max(U, 1),
      rounds: view.wallRemaining / 4,
      survive: Math.max(0.5, P.survive - P.surviveMeld * view.players.reduce((n, p) => n + (p.seat === view.seat ? 0 : p.melds.length), 0)),
    };
  }

  /** 一向听：把每种进张都试一遍，选最好的打法，平均听牌后还有多少张可胡。 */
  function expectedWaits(t, c, st) {
    const N = st.N;
    let total = 0;
    let weight = 0;
    for (let k = 0; k < 34; k++) {
      if (st.unseen[k] === 0 || !allowsKind(t, k)) continue;
      c[k]++;
      if (shantenOf(t, c, N) === 0) {
        let best = 0;
        for (let d = 0; d < 34; d++) {
          if (c[d] === 0) continue;
          c[d]--;
          if (shantenOf(t, c, N) === 0) {
            let live = 0;
            for (let w = 0; w < 34; w++) {
              const left = st.unseen[w] - (w === k ? 1 : 0);
              if (left <= 0 || !allowsKind(t, w)) continue;
              c[w]++;
              if (shantenOf(t, c, N) === -1) live += left;
              c[w]--;
            }
            if (live > best) best = live;
          }
          c[d]++;
        }
        total += best * st.unseen[k];
        weight += st.unseen[k];
      }
      c[k]--;
    }
    return weight > 0 ? total / weight : 0;
  }

  /** 13 - 3×副露 张牌（还没摸下一张）的期望收益。 */
  function handEV(c, st, P, refine) {
    const shanten = st.targets.map((t) => shantenOf(t, c, st.N));
    let minS = 99;
    for (const s of shanten) if (s < minS) minS = s;
    const evs = [];
    const rounds = Math.min(st.rounds, P.horizon);
    for (let i = 0; i < st.targets.length; i++) {
      const t = st.targets[i];
      const s = shanten[i];
      if (s > minS + 2 || s > 7) continue;
      let accept = 0;
      let allowed = 0;
      for (let k = 0; k < 34; k++) {
        if (st.unseen[k] === 0 || !allowsKind(t, k)) continue;
        allowed += st.unseen[k];
        c[k]++;
        const ns = shantenOf(t, c, st.N);
        c[k]--;
        if (ns < s) accept += st.unseen[k];
      }
      if (accept === 0) continue;
      // 第一步用实测进张和阶段估算的平均（向听数一格一格跳，实测值单独看很不稳定），
      // 往后按阶段估算（越接近听牌，能进的牌越少）
      const table = stepTable(t, P);
      const frac = allowed / st.U;
      const steps = [];
      for (let left = s; left >= 0; left--) {
        let model = table ? table[Math.min(left, 3)] * frac : frac;
        if (refine && s === 1 && left === 0) model = expectedWaits(t, c, st) / st.U;
        const raw = left === s ? (left === 0 ? accept / st.U : (accept / st.U + model) / 2) : model;
        // 乱风向的单张风牌吃碰不了，没听牌之前只能靠自己摸
        const tries = 1 + (left === 0 ? P.ronBonus : t.type === 'luan' ? 0 : P.callBonus);
        steps.push(1 - Math.pow(1 - Math.min(raw, 0.95), tries));
      }
      const prob = finishProbability(steps, rounds, st.survive);
      evs.push(prob * targetValue(t, c, st, P));
    }
    evs.sort((a, b) => b - a);
    return P.payScale * ((evs[0] || 0) + P.second * (evs[1] || 0) + P.third * (evs[2] || 0));
  }

  // ---- 放炮风险：只用牌桌上看得见的东西 ----------------------------------------
  function readOpponents(view, P) {
    const progress = 1 - Math.min(view.wallRemaining, 84) / 84;
    const out = [];
    for (const p of view.players) {
      if (p.seat === view.seat) continue;
      let mask = 0;
      let chi = false;
      for (const m of p.melds) {
        if (!m.kinds) continue; // 别人的暗杠看不见牌种
        if (m.type === 'chi') chi = true;
        for (const k of m.kinds) if (T.isNumber(k)) mask |= 1 << T.suitOf(k);
      }
      const mCount = p.melds.length;
      let flushSuit = -1;
      let conf = 0;
      if (mCount > 0 && mask !== 0 && (mask & (mask - 1)) === 0) {
        flushSuit = mask === 1 ? 0 : mask === 2 ? 1 : 2;
        conf = 0.5 + 0.15 * mCount;
      } else if (mCount === 0 && p.discards.length >= 6) {
        const bySuit = [0, 0, 0];
        let num = 0;
        for (const k of p.discards) if (T.isNumber(k)) { bySuit[T.suitOf(k)]++; num++; }
        for (let s = 0; s < 3; s++) {
          if (num >= 5 && bySuit[s] / num <= 0.1) { flushSuit = s; conf = 0.35; }
        }
      }
      const pengLikely = !chi && mCount >= 2;
      const tenpai = Math.min(0.9, P.tenpaiBase + P.tenpaiMeld * mCount + P.tenpaiLate * progress);
      const est = flushSuit >= 0 ? P.lossFlush : pengLikely ? P.lossPeng : P.lossPlain;
      out.push({ river: p.discards, flushSuit, conf, pengLikely, tenpai, est });
    }
    return out;
  }

  /** 打出 k 张的预期损失 = Σ 对手已听牌的概率 × 他正好等这张的概率 × 他胡牌的大小。 */
  function discardDanger(k, opps, unseen, P) {
    const u = unseen[k];
    let total = 0;
    for (const o of opps) {
      let hit = P.hitBase;
      if (o.river.includes(k)) hit *= P.hitOwnRiver; // 他自己打过的牌，多半不等
      if (o.flushSuit >= 0) {
        if (T.suitOf(k) === o.flushSuit) hit *= P.hitFlush + o.conf;
        else if (T.isHonor(k)) hit *= P.hitFlushHonor;
        else hit *= P.hitOffSuit;
      }
      if (o.pengLikely) hit *= u >= 2 ? P.hitPeng : P.hitPengThin;
      hit *= u === 0 ? 0 : 0.5 + u / 6; // 外面已经没有这张了，只有他手里的单吊/对子才可能
      total += o.tenpai * Math.min(hit, 0.5) * o.est;
    }
    return total;
  }

  function bestDiscard(view, c, st, forbid, P, defenseScale) {
    const opps = readOpponents(view, P);
    const progress = 1 - Math.min(view.wallRemaining, 84) / 84;
    const weight = defenseScale * P.defense * (1 + P.defenseLate * progress);
    const scored = [];
    for (let k = 0; k < 34; k++) {
      if (c[k] === 0 || k === forbid) continue;
      c[k]--;
      const ev = handEV(c, st, P, false);
      c[k]++;
      const danger = weight * discardDanger(k, opps, st.unseen, P);
      scored.push({ kind: k, value: ev - danger, danger });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.value - a.value || a.kind - b.kind);
    if (!P.refine) return scored[0];
    // 几乎一样好的选择之间，才用「一向听时实算等张」决胜；它和其他阶段的估算尺度不同，不能直接比大小
    const top = scored[0];
    const margin = Math.max(0.05, Math.abs(top.value) * 0.1);
    let best = top;
    let bestRefined = -Infinity;
    for (const cand of scored.slice(0, 4)) {
      if (cand.value < top.value - margin) break;
      c[cand.kind]--;
      const refined = handEV(c, st, P, true) - cand.danger;
      c[cand.kind]++;
      if (refined > bestRefined + 1e-9) {
        bestRefined = refined;
        best = cand;
      }
    }
    return best;
  }

  /** 点太小而等张很多时，宁可放过别人的牌去摸自摸（三家都付）。 */
  function shouldPassRon(view, st, c, points, P) {
    if (!st.closed || view.wallRemaining < 32 || points > P.passRonMaxPoints) return false;
    let live = 0;
    for (const k of R.waits(c, st.melds)) live += st.unseen[k];
    const zimo = 1 - Math.pow(1 - live / st.U, Math.min(st.rounds, P.horizon));
    return zimo * 0.6 * 3 > P.passRonFactor; // 三家付，打六折算可能被别人抢先
  }

  /** style: { defense: 放炮风险权重的倍数, params: 覆盖 PARAMS 的部分数值（调优工具用） } */
  function createPlayer(styleIn) {
    const style = { defense: 1, ...styleIn };
    const P = style.params ? { ...PARAMS, ...style.params } : PARAMS;
    const defenseScale = style.defense;
    return {
      chooseTurn(view, opts) {
        if (opts.canHu) return { type: 'hu' };
        const me = view.players[view.seat];
        const c = R.toCounts(view.hand.map((t) => t.kind));
        const st = buildState(view, c, me.melds, P);
        const best = bestDiscard(view, c, st, opts.forbid === null ? -1 : opts.forbid, P, defenseScale);
        let action = { type: 'discard', kind: best.kind };
        let top = best.value;
        for (const g of opts.gangs) {
          const c2 = c.slice();
          let melds;
          if (g.sub === 'an') {
            c2[g.kind] -= 4;
            melds = me.melds.concat([{ type: 'gang', sub: 'an', kinds: [g.kind, g.kind, g.kind, g.kind] }]);
          } else {
            c2[g.kind] -= 1;
            melds = me.melds.map((m) => (m.type === 'peng' && m.kinds[0] === g.kind
              ? { type: 'gang', sub: 'jia', kinds: [g.kind, g.kind, g.kind, g.kind] } : m));
          }
          const st2 = buildState(view, c2, melds, P);
          const value = handEV(c2, st2, P, false) + (g.sub === 'an' ? P.gangAn : P.gangJia);
          if (value >= top) {
            top = value;
            action = { type: 'gang', kind: g.kind, sub: g.sub };
          }
        }
        return action;
      },

      chooseClaim(view, claim) {
        const me = view.players[view.seat];
        const c = R.toCounts(view.hand.map((t) => t.kind));
        const st = buildState(view, c, me.melds, P);
        const k = claim.kind;
        const opt = claim.options;
        if (opt.hu && !shouldPassRon(view, st, c, opt.preview.points, P)) return { type: 'hu' };

        const stay = handEV(c, st, P, false);
        let bestAct = { type: 'pass' };
        let top = stay * P.stayBias + P.stayAdd;
        const sankou = view.calls[view.seat][claim.from] === R.VALUES.sankouCalls - 1 ? P.sankouRisk : 0;

        if (opt.peng) {
          const c2 = c.slice();
          c2[k] -= 2;
          const st2 = buildState(view, c2, me.melds.concat([{ type: 'peng', kinds: [k, k, k] }]), P);
          const b = bestDiscard(view, c2, st2, -1, P, defenseScale);
          if (b && b.value - sankou > top) {
            top = b.value - sankou;
            bestAct = { type: 'peng' };
          }
        }
        if (opt.gang) {
          const c2 = c.slice();
          c2[k] -= 3;
          const melds = me.melds.concat([{ type: 'gang', sub: 'ming', kinds: [k, k, k, k] }]);
          const v = handEV(c2, buildState(view, c2, melds, P), P, false) + P.gangMing - sankou;
          if (v > top) {
            top = v;
            bestAct = { type: 'gang' };
          }
        }
        for (const pair of opt.chi) {
          const c2 = c.slice();
          c2[pair[0]]--;
          c2[pair[1]]--;
          const kinds = [pair[0], pair[1], k].sort((x, y) => x - y);
          const st2 = buildState(view, c2, me.melds.concat([{ type: 'chi', kinds }]), P);
          const b = bestDiscard(view, c2, st2, k, P, defenseScale);
          if (b && b.value - sankou > top) {
            top = b.value - sankou;
            bestAct = { type: 'chi', chi: pair };
          }
        }
        return bestAct;
      },

      chooseRob() {
        return { type: 'hu' };
      },
    };
  }

  const api = { createPlayer, targetsFor, shantenOf, PARAMS, handEV, buildState, finishProbability, targetValue };
  if (isNode) module.exports = api;
  else (root.MJ = root.MJ || {}).AI = api;
})(typeof self !== 'undefined' ? self : globalThis);

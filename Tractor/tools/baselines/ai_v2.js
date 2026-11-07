/* 电脑玩家。决策是 view（自己的手牌 + 公开信息，庄家还知道自己埋的底牌）的纯函数，
 * 没有别的输入，也不碰随机数。和对家的配合全靠牌桌上看得见的出牌，没有任何暗中通气。
 * PARAMS 由 tools/selfplay.js 四人对局调出，调优记录在 docs/selfplay_log.md。 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const C = isNode ? require('../../js/cards.js') : root.TJ.Cards;
  const R = isNode ? require('../../js/rules.js') : root.TJ.Rules;
  const { TRUMP } = R;

  const PARAMS = {
    // 亮主
    bidBase: 8.5, // 预计主牌张数达到这个数才愿意亮
    bidJoker: 2.2, // 一张王按几张主算
    bidLevel: 1.6, // 一张级牌按几张主算
    bidOverride: 7.5, // 推翻对家的亮主要多强出这么多
    bidNT: 4, // 无主要比有主明显更强才亮：王对放到主牌里同样很强
    bidOverrideFoe: 0.8,
    // 埋牌
    buryPoint: 2.01, // 埋分牌的代价（怕被抠底）
    buryVoid: 6, // 清空一门的收益
    buryHigh: 5,
    buryPair: 9,
    // 领牌
    sureBase: 4,
    sureSize: 3,
    surePoints: 0.8,
    ruffRisk: 0.6,
    lowPow: 0.5,
    leadPointLoss: 0.8,
    shortSuit: 1.2,
    drawTrump: 5,
    trumpLeadCost: 2.5,
    partnerRuff: 4,
    throwBonus: 4.553,
    keepForLast: 4,
    // 跟牌
    initiative: 3,
    holdUnsure: 0.55,
    holdSure: 0.95,
    feed: 1,
    feedUnsure: 0.4,
    giveLoss: 0.9,
    costPow: 0.35,
    costTrump: 2,
    costPair: 2.5,
    costHigh: 1.662,
    voidDump: 1.5, // 垫牌时清空一门，以后就能毙
    shortFirst: 0.165, // 垫牌时先垫短门
    leadFoeVoid: 1.5, // 对手已断的门，低牌领出去就是送他毙分
    ruffMinPoints: 5,
    lastTrickValue: 30,
  };

  const sum = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);

  /** 从公开信息整理出：哪些牌我还没见过、谁已经断了哪一门。 */
  function analyze(view) {
    const ctx = R.makeCtx(view.level, view.trump);
    const unseen = new Int8Array(54).fill(2);
    const hand = view.hand.map((t) => t.kind);
    for (const k of hand) unseen[k]--;
    if (view.buried) for (const k of view.buried) unseen[k]--;
    const voids = [new Set(), new Set(), new Set(), new Set()];
    const noPairs = [new Set(), new Set(), new Set(), new Set()];
    const seeTrick = (plays) => {
      if (!plays.length) return;
      const lead = plays[0].kinds;
      const cls = ctx.cls[lead[0]];
      const leadHasPair = R.decompose(lead, ctx).some((c) => c.size >= 2);
      for (const p of plays) {
        for (const k of p.kinds) unseen[k]--;
        if (p === plays[0]) continue;
        const inClass = p.kinds.filter((k) => ctx.cls[k] === cls);
        if (inClass.length < lead.length) voids[p.seat].add(cls);
        else if (leadHasPair && !R.decompose(inClass, ctx).some((c) => c.size >= 2)) noPairs[p.seat].add(cls);
      }
    };
    for (const t of view.tricks) seeTrick(t.plays);
    if (view.current) seeTrick(view.current.plays);
    return {
      ctx, hand, unseen, voids, noPairs,
      partner: (view.seat + 2) % 4,
      isDealerTeam: view.dealer !== null && view.dealer % 2 === view.seat % 2,
      tricksLeftCards: view.hand.length,
    };
  }

  /** 外面还没出现的牌里，有没有可能压过这个部件。 */
  function unseenCanBeat(comp, A) {
    const { ctx, unseen } = A;
    const cls = ctx.cls[comp.kinds[0]];
    const pool = [];
    for (let k = 0; k < 54; k++) {
      if (ctx.cls[k] !== cls) continue;
      for (let i = 0; i < unseen[k]; i++) pool.push(k);
    }
    return R.canBeatComp(comp, pool, ctx);
  }

  function classCount(kinds, cls, ctx) {
    let n = 0;
    for (const k of kinds) if (ctx.cls[k] === cls) n++;
    return n;
  }

  function unseenCount(cls, A) {
    let n = 0;
    for (let k = 0; k < 54; k++) if (A.ctx.cls[k] === cls) n += A.unseen[k];
    return n;
  }

  /** 留在手里值多少：越大越舍不得打。 */
  function keepValue(k, hand, A, P) {
    const { ctx } = A;
    let v = (ctx.pow[k] / 15) * P.costPow * 10;
    if (ctx.cls[k] === TRUMP) v += P.costTrump;
    const r = C.rankOf(k);
    if (r === 14 || r === 13) v += P.costHigh;
    let same = 0;
    for (const x of hand) if (x === k) same++;
    if (same >= 2) v += P.costPair;
    return v;
  }

  function takeKinds(handList, kinds) {
    const pool = handList.slice();
    for (const k of kinds) {
      const i = pool.indexOf(k);
      if (i < 0) return null;
      pool.splice(i, 1);
    }
    return pool;
  }

  /** 按偏好顺序凑出一手合法跟牌。prefer(k) 越小越优先打出。 */
  function buildFollow(hand, lead, ctx, prefer) {
    const cls = ctx.cls[lead[0]];
    const n = lead.length;
    const sorted = hand.slice().sort((a, b) => prefer(a) - prefer(b));
    const same = sorted.filter((k) => ctx.cls[k] === cls);
    const others = sorted.filter((k) => ctx.cls[k] !== cls);
    if (same.length <= n) return same.concat(others.slice(0, n - same.length));
    const comps = R.decompose(lead, ctx);
    let pool = same.slice();
    const chosen = [];
    let pairsLeft = 0;
    for (const c of comps) {
      if (c.type === 'pair') pairsLeft++;
      if (c.type === 'tractor') pairsLeft += c.len;
    }
    for (const c of comps) {
      if (c.type !== 'tractor') continue;
      const runs = R.runsOf(pool, ctx).sort((a, b) => b.len - a.len || sum(a.kinds, prefer) - sum(b.kinds, prefer));
      if (!runs.length) continue;
      const take = Math.min(runs[0].len, c.len);
      // 长连对里取最优先打出的一段
      let bestSlice = runs[0].kinds.slice(0, take);
      let bestCost = sum(bestSlice, prefer);
      for (let i = 1; i + take <= runs[0].len; i++) {
        const s = runs[0].kinds.slice(i, i + take);
        const cost = sum(s, prefer);
        if (cost < bestCost) { bestCost = cost; bestSlice = s; }
      }
      for (const k of bestSlice) {
        chosen.push(k, k);
        pool.splice(pool.indexOf(k), 1);
        pool.splice(pool.indexOf(k), 1);
      }
      pairsLeft -= take;
    }
    while (pairsLeft > 0) {
      const pairs = [];
      for (const [k, cnt] of R.tally(pool)) if (cnt >= 2) pairs.push(k);
      if (!pairs.length) break;
      pairs.sort((a, b) => prefer(a) - prefer(b));
      chosen.push(pairs[0], pairs[0]);
      pool.splice(pool.indexOf(pairs[0]), 1);
      pool.splice(pool.indexOf(pairs[0]), 1);
      pairsLeft--;
    }
    while (chosen.length < n) chosen.push(pool.shift());
    return chosen;
  }

  /** 断门时用主牌毙：按领牌结构凑一手主牌。凑不出同结构就返回 null。 */
  function buildRuff(hand, lead, ctx, prefer) {
    const trumps = hand.filter((k) => ctx.cls[k] === TRUMP).sort((a, b) => prefer(a) - prefer(b));
    if (trumps.length < lead.length) return null;
    const comps = R.decompose(lead, ctx);
    let pool = trumps.slice();
    const chosen = [];
    for (const c of comps) {
      if (c.type === 'tractor') {
        const runs = R.runsOf(pool, ctx).filter((r) => r.len >= c.len).sort((a, b) => a.top - b.top);
        if (!runs.length) return null;
        const r = runs[0];
        const part = r.kinds.slice(r.len - c.len);
        for (const k of part) {
          chosen.push(k, k);
          pool.splice(pool.indexOf(k), 1);
          pool.splice(pool.indexOf(k), 1);
        }
      } else if (c.type === 'pair') {
        const pairs = [];
        for (const [k, n] of R.tally(pool)) if (n >= 2) pairs.push(k);
        if (!pairs.length) return null;
        pairs.sort((a, b) => ctx.pow[a] - ctx.pow[b]);
        chosen.push(pairs[0], pairs[0]);
        pool.splice(pool.indexOf(pairs[0]), 1);
        pool.splice(pool.indexOf(pairs[0]), 1);
      } else {
        const s = pool.slice().sort((a, b) => ctx.pow[a] - ctx.pow[b]);
        chosen.push(s[0]);
        pool.splice(pool.indexOf(s[0]), 1);
      }
    }
    return chosen;
  }

  /** 这手牌打下去，当前这一墩是不是我领先。 */
  function wouldLead(view, A, play) {
    const cur = view.current;
    const plays = cur.plays.map((p) => ({ seat: p.seat, kinds: p.kinds.slice() }));
    plays.push({ seat: view.seat, kinds: play });
    return R.trickWinner(plays, A.ctx) === view.seat;
  }

  /** 候选跟牌：几种不同打法各凑一手，去重并验证合法。 */
  function followCandidates(view, A, lead, P) {
    const { ctx, hand } = A;
    const low = (k) => keepValue(k, hand, A, P) + C.points(k) * 0.35;
    const noPoints = (k) => keepValue(k, hand, A, P) + (C.points(k) > 0 ? 6 : 0);
    const dumpPoints = (k) => keepValue(k, hand, A, P) * 0.5 - C.points(k);
    const high = (k) => -ctx.pow[k] - (ctx.cls[k] === TRUMP ? 20 : 0);
    const out = [];
    const seen = new Set();
    const add = (play) => {
      if (!play || play.length !== lead.length) return;
      const key = play.slice().sort((a, b) => a - b).join(',');
      if (seen.has(key)) return;
      seen.add(key);
      if (R.canFollow(hand, lead, play, ctx).ok) out.push(play);
    };
    add(buildFollow(hand, lead, ctx, low));
    add(buildFollow(hand, lead, ctx, noPoints));
    add(buildFollow(hand, lead, ctx, dumpPoints));
    add(buildFollow(hand, lead, ctx, high));

    const cls = ctx.cls[lead[0]];
    const same = hand.filter((k) => ctx.cls[k] === cls);
    if (lead.length === 1) {
      for (const k of new Set(same.length ? same : hand)) add([k]);
    } else if (lead.length === 2 && same.length >= 2) {
      for (const [k, n] of R.tally(same)) if (n >= 2) add([k, k]);
    }
    // 断了这门：可以毙
    if (cls !== TRUMP && same.length === 0) {
      add(buildRuff(hand, lead, ctx, low));
      if (lead.length === 1) for (const k of new Set(hand)) if (ctx.cls[k] === TRUMP) add([k]);
    }
    if (!out.length) throw new Error('凑不出合法跟牌');
    return out;
  }

  /** 给一手跟牌打分：这一墩能拿下多少，要付出多少好牌。 */
  function scoreFollow(view, A, play, P) {
    const cur = view.current;
    const { ctx, partner, hand } = A;
    const pos = cur.plays.length; // 我之前已经有几家出了
    const before = cur.plays.map((p) => ({ seat: p.seat, kinds: p.kinds }));
    const bestSeat = R.trickWinner(before, ctx);
    const partnerBest = bestSeat === partner;
    let trickPts = 0;
    for (const p of cur.plays) trickPts += sum(p.kinds, C.points);
    const myPts = sum(play, C.points);
    const win = wouldLead(view, A, play);
    let cost = 0;
    for (const k of play) cost += keepValue(k, hand, A, P);
    const lastTrick = hand.length === play.length;
    const lastBonus = lastTrick ? P.lastTrickValue : 0;

    // 这手牌（或者对家现在领先的牌）后面还会不会被压
    const lead = cur.plays[0].kinds;
    const comps = R.decompose(lead, ctx);
    const remaining = 3 - pos;
    const holdChance = (kinds, seatNow) => {
      if (remaining === 0) return 1;
      void seatNow;
      const cls = ctx.cls[kinds[0]];
      const pool = [];
      for (let k = 0; k < 54; k++) {
        if (ctx.cls[k] === cls) for (let i = 0; i < A.unseen[k]; i++) pool.push(k);
      }
      const top = R.fitsLead(kinds, comps, ctx);
      if (top === null) return P.holdUnsure;
      const threat = comps[0].type === 'single'
        ? pool.some((k) => ctx.pow[k] > top)
        : R.canBeatComp({ ...comps[0], top }, pool, ctx);
      // 后面还没出的人如果都断了这门，也可能拿主牌毙
      const ruffPossible = ctx.cls[lead[0]] !== TRUMP && cls !== TRUMP;
      let chance = threat ? P.holdUnsure : P.holdSure;
      if (ruffPossible) chance *= 0.85;
      return chance;
    };

    if (win) {
      const hold = holdChance(play, view.seat);
      if (partnerBest) {
        // 对家本来就领先，还要压过去只是浪费，除非他的牌大概率守不住
        const partnerKinds = cur.plays.find((p) => p.seat === partner).kinds;
        const ph = holdChance(partnerKinds, partner);
        return hold * (trickPts + myPts + P.initiative + lastBonus) * (1 - ph) + (ph * myPts * P.feed) - cost;
      }
      return hold * (trickPts + myPts + P.initiative + lastBonus) - cost;
    }
    if (partnerBest) {
      const partnerKinds = cur.plays.find((p) => p.seat === partner).kinds;
      const ph = holdChance(partnerKinds, partner);
      const feedRate = ph >= P.holdSure * 0.8 ? P.feed : P.feedUnsure;
      return myPts * feedRate * ph + ph * (trickPts + lastBonus) * 0.3 - cost - (1 - ph) * myPts * P.giveLoss;
    }
    return -myPts * P.giveLoss - cost + voidBonus(play, A, P, cur.plays[0].kinds);
  }

  /** 不必跟牌时垫什么：能清空一门最好，其次垫短门。 */
  function voidBonus(play, A, P, lead) {
    const { ctx, hand } = A;
    const leadCls = ctx.cls[lead[0]];
    let bonus = 0;
    const counts = new Map();
    for (const k of hand) counts.set(ctx.cls[k], (counts.get(ctx.cls[k]) || 0) + 1);
    const used = new Map();
    for (const k of play) used.set(ctx.cls[k], (used.get(ctx.cls[k]) || 0) + 1);
    for (const [cls, n] of used) {
      if (cls === TRUMP || cls === leadCls) continue;
      const total = counts.get(cls);
      if (n === total) bonus += P.voidDump;
      bonus += P.shortFirst * (n / Math.max(total, 1));
    }
    return bonus;
  }

  /** 把一些部件合成一手甩牌（都是外面压不住的）。 */
  function throwCandidate(comps, A) {
    const sure = comps.filter((c) => !unseenCanBeat(c, A));
    if (sure.length < 2) return null;
    return sure;
  }

  function chooseLeadKinds(view, A, P) {
    const { ctx, hand, partner } = A;
    const classes = new Map();
    for (const k of hand) {
      const c = ctx.cls[k];
      if (!classes.has(c)) classes.set(c, []);
      classes.get(c).push(k);
    }
    const foes = [(view.seat + 1) % 4, (view.seat + 3) % 4];
    const myTrumps = classCount(hand, TRUMP, ctx);
    const outTrumps = unseenCount(TRUMP, A);
    const cardsLeft = hand.length;
    let best = null;
    let bestScore = -Infinity;
    const consider = (kinds, score) => {
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = kinds;
      }
    };
    for (const [cls, kinds] of classes) {
      const comps = R.decompose(kinds, ctx);
      const isT = cls === TRUMP;
      const foeVoid = foes.some((f) => A.voids[f].has(cls));
      const partnerVoid = !isT && A.voids[partner].has(cls);
      const outInClass = unseenCount(cls, A);
      const everyoneThin = !isT && outInClass < 6;
      for (const comp of comps) {
        const pts = sum(comp.kinds, C.points);
        const sure = !unseenCanBeat(comp, A);
        const powNorm = comp.top / 15;
        let score;
        if (sure) {
          const ruff = !isT && (foeVoid || everyoneThin) ? P.ruffRisk : 0;
          score = (P.sureBase + comp.size * P.sureSize + pts * P.surePoints) * (1 - ruff);
          if (isT) {
            // 大主：吊主有利时才打；留到最后保底
            const lead = myTrumps / Math.max(outTrumps, 1);
            score = comp.size * P.sureSize + (lead > 0.8 ? P.drawTrump : 0) - P.trumpLeadCost;
            if (outTrumps === 0) score = -2;
            if (cardsLeft <= comp.size + 2) score += P.keepForLast;
          }
        } else {
          score = -powNorm * P.lowPow * 10 - pts * P.leadPointLoss;
          if (foeVoid && !isT) score -= P.leadFoeVoid + pts * 0.5;
          if (!isT && kinds.length <= 3) score += P.shortSuit; // 打短门，争取断门
          if (isT) score -= P.trumpLeadCost - (A.isDealerTeam && myTrumps > outTrumps * 0.6 ? P.drawTrump * 0.6 : 0);
        }
        if (partnerVoid && !foeVoid) score += P.partnerRuff + pts * 0.5; // 让对家毙
        // 不要轻易拆对子和拖拉机
        if (comp.size === 1) {
          let same = 0;
          for (const x of hand) if (x === comp.kinds[0]) same++;
          if (same >= 2) score -= P.costPair;
        }
        consider(comp.kinds, score);
      }
      // 甩牌：全是外面压不住的大牌才考虑
      const thrown = throwCandidate(comps, A);
      if (thrown) {
        const k = thrown.flatMap((c) => c.kinds);
        const pts = sum(k, C.points);
        const ruff = !isT && (foeVoid || everyoneThin) ? P.ruffRisk : 0;
        consider(k, (P.sureBase + k.length * P.sureSize + pts * P.surePoints + P.throwBonus) * (1 - ruff) - (isT ? P.trumpLeadCost : 0));
      }
    }
    return best;
  }

  /** 按牌种挑手里具体的牌编号。 */
  function idsFor(view, kinds) {
    const pool = view.hand.map((t) => ({ ...t }));
    const out = [];
    for (const k of kinds) {
      const i = pool.findIndex((t) => t.kind === k);
      out.push(pool[i].id);
      pool.splice(i, 1);
    }
    return out;
  }

  function bidStrengthFor(hand, suit, level, dealtShare, P) {
    let v = 0;
    for (const k of hand) {
      if (C.isJoker(k)) v += P.bidJoker;
      else if (C.rankOf(k) === level) v += P.bidLevel;
      else if (suit !== null && C.suitOf(k) === suit) v += 1;
    }
    // 还没发完的牌按比例估算
    return v / Math.max(dealtShare, 0.2);
  }

  function createPlayer(styleIn) {
    const style = { ...styleIn };
    const P = style.params ? { ...PARAMS, ...style.params } : PARAMS;
    return {
      chooseBid(view, options, last) {
        const hand = view.hand.map((t) => t.kind);
        const share = Math.min(1, hand.length / 25);
        const partner = (view.seat + 2) % 4;
        const firstHand = view.dealer === null;
        let best = null;
        let bestV = -Infinity;
        for (const o of options) {
          const v = bidStrengthFor(hand, o.suit, view.level, share, P) - (o.suit === null ? P.bidNT : 0);
          if (v > bestV) { bestV = v; best = o; }
        }
        if (!best) return null;
        let need = P.bidBase;
        if (view.bid) need += view.bid.seat === partner ? P.bidOverride : P.bidOverrideFoe;
        if (share < 0.5) need += 2; // 太早亮看不清，等牌多一点
        if (last) need -= firstHand ? 3 : 1.5; // 最后机会；第一局亮了就能坐庄
        return bestV >= need ? { strength: best.strength, suit: best.suit } : null;
      },

      chooseBury(view) {
        const A = analyze(view);
        const { ctx } = A;
        let hand = A.hand.slice();
        const buried = [];
        // 一张张挑：每次埋掉「留着最不值」的牌
        for (let n = 0; n < R.VALUES.kittySize; n++) {
          const counts = new Map();
          for (const k of hand) counts.set(ctx.cls[k], (counts.get(ctx.cls[k]) || 0) + 1);
          let pick = -1;
          let bestVal = Infinity;
          for (const k of new Set(hand)) {
            const cls = ctx.cls[k];
            let v = keepValue(k, hand, A, P);
            if (cls === TRUMP) v += 20;
            const r = C.rankOf(k);
            if (r >= 13) v += P.buryHigh;
            if (C.points(k) > 0) v += P.buryPoint * (C.points(k) / 10);
            const same = hand.filter((x) => x === k).length;
            if (same >= 2) v += P.buryPair;
            if (cls !== TRUMP) v -= P.buryVoid / Math.max(1, counts.get(cls)); // 越短的门越想清掉
            if (v < bestVal - 1e-9) { bestVal = v; pick = k; }
          }
          buried.push(pick);
          hand.splice(hand.indexOf(pick), 1);
        }
        return idsFor(view, buried);
      },

      chooseLead(view) {
        const A = analyze(view);
        return idsFor(view, chooseLeadKinds(view, A, P));
      },

      chooseFollow(view, info) {
        const A = analyze(view);
        const cands = followCandidates(view, A, info.lead, P);
        let best = cands[0];
        let bestV = -Infinity;
        for (const play of cands) {
          const v = scoreFollow(view, A, play, P);
          if (v > bestV + 1e-9) { bestV = v; best = play; }
        }
        return idsFor(view, best);
      },
    };
  }

  const api = { createPlayer, PARAMS };
  if (isNode) module.exports = api;
  else (root.TJ = root.TJ || {}).AI = api;
})(typeof self !== 'undefined' ? self : globalThis);

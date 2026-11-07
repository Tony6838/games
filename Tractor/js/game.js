/* 一局牌的裁判。公平性的硬边界都在这里：
 *  - 牌堆和四家手牌放在 JavaScript 真私有字段（#）里，外部代码在语言层面读不到。
 *  - 牌的编号就是它在洗好的牌堆里的位置，编号不透露牌种。
 *  - 玩家（电脑或真人界面）只能拿到 #view(seat)：自己的手牌 + 公开信息。
 *    底牌只有埋牌的庄家知道；甩牌能否成立由裁判核对，电脑领牌前并不知道别人手里有什么。
 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const C = isNode ? require('./cards.js') : root.TJ.Cards;
  const R = isNode ? require('./rules.js') : root.TJ.Rules;

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }

  const teamOf = (seat) => seat % 2;

  class Hand {
    #kinds;
    #hands = [[], [], [], []];
    #kitty = [];
    #buried = [];
    #adapters;
    #hook;
    #observer;
    #dealer;       // 第一局开始时可能还没有庄家
    #starter;
    #levels;
    #level;
    #bid = null;
    #shown = null; // { seat, ids }：最后一次亮主亮在桌上的牌，庄家扣完底才收回
    #trump = null;
    #ctx = null;
    #tricks = [];
    #current = null;
    #attackerPoints = 0;
    #penalties = 0;
    #trickPoints = 0;
    #flipped = [];
    #dealt = 0;
    #phase = 'deal';

    /**
     * opts: { dealer(可为 null，表示第一局抢庄), starter, levels:[两队级别], adapters:[4], hook, observer, presetDeck?, randInt? }
     * presetDeck 只给测试布局用，游戏界面从不传。
     */
    constructor(opts) {
      const rnd = opts.randInt || C.secureInt;
      this.#adapters = opts.adapters;
      this.#hook = opts.hook || null;
      this.#observer = opts.observer === undefined ? -1 : opts.observer;
      this.#dealer = opts.dealer === undefined ? null : opts.dealer;
      this.#starter = opts.dealer !== null && opts.dealer !== undefined ? opts.dealer : opts.starter;
      this.#levels = opts.levels.slice();
      this.#level = this.#dealer === null ? this.#levels[0] : this.#levels[teamOf(this.#dealer)];
      this.#kinds = opts.presetDeck ? opts.presetDeck.slice() : C.shuffle(C.buildDeck(), rnd);
    }

    async #emit(e) {
      if (this.#hook) await this.#hook(e);
    }

    #publicTricks() {
      return this.#tricks.map((t) => ({
        leader: t.leader,
        winner: t.winner,
        points: t.points,
        plays: t.plays.map((p) => ({ seat: p.seat, kinds: p.ids.map((id) => this.#kinds[id]) })),
      }));
    }

    #view(seat) {
      const k = this.#kinds;
      return deepFreeze({
        seat,
        phase: this.#phase,
        level: this.#level,
        levels: this.#levels.slice(),
        dealer: this.#dealer,
        bid: this.#bid ? { seat: this.#bid.seat, strength: this.#bid.strength, suit: this.#bid.suit } : null,
        // 自己亮在桌上的牌：仍算手牌，但扣底时不在手里，不能扣
        shownIds: this.#shown && this.#shown.seat === seat ? this.#shown.ids.slice() : [],
        trump: this.#trump,
        dealt: this.#dealt,
        hand: this.#hands[seat].map((id) => ({ id, kind: k[id] })),
        handCounts: this.#hands.map((h) => h.length),
        attackerPoints: this.#attackerPoints,
        flipped: this.#flipped.map((id) => k[id]),
        // 底牌是庄家自己埋的，只有他知道
        buried: seat === this.#dealer ? this.#buried.map((id) => k[id]) : null,
        tricks: this.#publicTricks(),
        current: this.#current ? {
          leader: this.#current.leader,
          plays: this.#current.plays.map((p) => ({ seat: p.seat, kinds: p.ids.map((id) => k[id]) })),
        } : null,
      });
    }

    async run() {
      await this.#emit({
        type: 'handStart', dealer: this.#dealer, starter: this.#starter,
        level: this.#level, levels: this.#levels.slice(),
      });
      await this.#deal();
      await this.#decideTrump();
      await this.#takeKitty();
      return this.#playTricks();
    }

    // ---- 发牌和亮主 ----------------------------------------------------------
    async #deal() {
      for (let i = 0; i < 100; i++) {
        const seat = (this.#starter + i) % 4;
        this.#hands[seat].push(i);
        this.#dealt = i + 1;
        await this.#emit({
          type: 'deal', seat, id: i, index: i,
          kind: seat === this.#observer ? this.#kinds[i] : null,
        });
        // 真人点按钮发生在这张牌落地之前，要先于拿到这张牌的电脑生效
        await this.#askBids(seat === this.#observer ? [seat] : [this.#observer, seat]);
      }
      this.#kitty = [100, 101, 102, 103, 104, 105, 106, 107];
      this.#phase = 'lastCall';
      await this.#emit({ type: 'dealDone' });
      // 发完牌还有最后一次亮主机会，从起手家开始逐家问
      for (let round = 0; round < 2; round++) {
        let any = false;
        for (let i = 0; i < 4; i++) {
          if (await this.#askBids([(this.#starter + i) % 4], true)) any = true;
        }
        if (!any) break;
      }
    }

    async #askBids(seats, last) {
      let any = false;
      for (const seat of seats) {
        if (seat < 0) continue;
        const options = R.legalBids(this.#hands[seat].map((id) => this.#kinds[id]), this.#level, this.#bid);
        const a = this.#adapters[seat];
        if (!options.length) {
          if (a.noBids) a.noBids(); // 界面收起已经失效的亮主按钮
          continue;
        }
        const choice = await a.chooseBid(this.#view(seat), deepFreeze(options), !!last);
        if (choice) {
          const pick = options.find((o) => o.strength === choice.strength && o.suit === choice.suit);
          if (!pick) throw new Error('非法亮主');
          await this.#applyBid(seat, pick);
          any = true;
        }
      }
      return any;
    }

    async #applyBid(seat, pick) {
      this.#bid = { seat, strength: pick.strength, suit: pick.suit };
      this.#trump = pick.suit;
      if (this.#dealer === null) this.#dealer = seat; // 第一局：最先亮主的人坐庄
      const shown = [];
      const need = pick.kinds.slice();
      for (const id of this.#hands[seat]) {
        const i = need.indexOf(this.#kinds[id]);
        if (i >= 0) {
          need.splice(i, 1);
          shown.push(id);
        }
      }
      this.#shown = { seat, ids: shown.slice() }; // 被反主时，前一家亮的牌就此收回
      await this.#emit({
        type: 'bid', seat, strength: pick.strength, suit: pick.suit, kinds: pick.kinds.slice(),
        ids: shown, dealer: this.#dealer,
      });
    }

    async #decideTrump() {
      if (!this.#bid) {
        if (this.#dealer === null) this.#dealer = this.#starter;
        // 没人亮主：逐张翻底牌，翻到级牌定它的花色；一直没有就取最大那张的花色（先翻到的优先）
        let chosen = null;
        let best = -1;
        for (const id of this.#kitty) {
          const k = this.#kinds[id];
          this.#flipped.push(id);
          await this.#emit({ type: 'flip', id, kind: k });
          if (C.isJoker(k)) continue;
          if (C.rankOf(k) === this.#level) {
            chosen = C.suitOf(k);
            break;
          }
          if (C.rankOf(k) > best) {
            best = C.rankOf(k);
            chosen = C.suitOf(k);
          }
        }
        this.#trump = chosen;
      }
      this.#level = this.#levels[teamOf(this.#dealer)];
      this.#ctx = R.makeCtx(this.#level, this.#trump);
      await this.#emit({
        type: 'trumpSet', trump: this.#trump, level: this.#level, dealer: this.#dealer,
        flipped: this.#flipped.length > 0,
      });
    }

    async #takeKitty() {
      const dealer = this.#dealer;
      this.#phase = 'bury';
      const ids = this.#kitty.slice();
      this.#hands[dealer].push(...ids);
      await this.#emit({
        type: 'kittyTaken', seat: dealer, ids,
        kinds: dealer === this.#observer ? ids.map((id) => this.#kinds[id]) : null,
      });
      const act = await this.#adapters[dealer].chooseBury(this.#view(dealer));
      const hand = this.#hands[dealer];
      if (!Array.isArray(act) || act.length !== R.VALUES.kittySize || new Set(act).size !== act.length || !act.every((id) => hand.includes(id))) {
        throw new Error('非法埋牌');
      }
      const onTable = this.#shown && this.#shown.seat === dealer ? this.#shown.ids : [];
      if (act.some((id) => onTable.includes(id))) throw new Error('非法埋牌：亮在桌上的牌不能扣底');
      for (const id of act) hand.splice(hand.indexOf(id), 1);
      this.#buried = act.slice();
      this.#shown = null; // 扣完底，亮的牌收回手里
      await this.#emit({
        type: 'buried', seat: dealer, ids: act.slice(),
        kinds: dealer === this.#observer ? act.map((id) => this.#kinds[id]) : null,
      });
    }

    // ---- 出牌 ----------------------------------------------------------------
    async #playTricks() {
      this.#phase = 'play';
      let leader = this.#dealer;
      const ctx = this.#ctx;
      const dealerTeam = teamOf(this.#dealer);
      let lastLeadKinds = null;
      let lastWinner = null;
      while (this.#hands[leader].length > 0) {
        this.#current = { leader, plays: [] };
        await this.#emit({ type: 'trickStart', leader });
        // 领牌
        const leadAct = await this.#adapters[leader].chooseLead(this.#view(leader));
        const leadIds = this.#checkIds(leader, leadAct);
        const leadKinds = leadIds.map((id) => this.#kinds[id]);
        const others = [1, 2, 3].map((d) => this.#hands[(leader + d) % 4].map((id) => this.#kinds[id]));
        const verdict = R.checkLead(leadKinds, others, ctx);
        if (!verdict.ok) throw new Error('非法领牌：' + verdict.reason);
        let played = leadIds;
        if (verdict.failed) {
          // 甩牌失败：只能打被压住的那部分，其余收回，并罚分
          const need = verdict.failed.kinds.slice();
          played = [];
          for (const id of leadIds) {
            const i = need.indexOf(this.#kinds[id]);
            if (i >= 0) {
              need.splice(i, 1);
              played.push(id);
            }
          }
          const penalty = R.VALUES.throwPenalty;
          this.#attackerPoints += teamOf(leader) === dealerTeam ? penalty : -penalty;
          this.#penalties += teamOf(leader) === dealerTeam ? penalty : -penalty;
          await this.#emit({
            type: 'throwFailed', seat: leader, tried: leadIds.slice(), triedKinds: leadKinds.slice(),
            played: played.slice(), penalty, toAttackers: teamOf(leader) === dealerTeam,
            attackerPoints: this.#attackerPoints,
          });
        }
        this.#removeFromHand(leader, played);
        this.#current.plays.push({ seat: leader, ids: played });
        const realLead = played.map((id) => this.#kinds[id]);
        await this.#emit({
          type: 'play', seat: leader, ids: played.slice(), kinds: realLead.slice(), lead: true,
          isThrow: verdict.isThrow && !verdict.failed,
        });
        // 跟牌：按出牌顺序一家家来，后面的人看得到前面出了什么，和真实牌桌一样
        for (let d = 1; d < 4; d++) {
          const seat = (leader + d) % 4;
          const act = await this.#adapters[seat].chooseFollow(this.#view(seat), deepFreeze({ lead: realLead.slice() }));
          const ids = this.#checkIds(seat, act);
          const kinds = ids.map((id) => this.#kinds[id]);
          const hand = this.#hands[seat].map((id) => this.#kinds[id]);
          const check = R.canFollow(hand, realLead, kinds, ctx);
          if (!check.ok) throw new Error('非法跟牌：' + check.reason);
          this.#removeFromHand(seat, ids);
          this.#current.plays.push({ seat, ids });
          await this.#emit({ type: 'play', seat, ids: ids.slice(), kinds: kinds.slice(), lead: false });
        }
        // 比大小
        const plays = this.#current.plays.map((p) => ({ seat: p.seat, kinds: p.ids.map((id) => this.#kinds[id]) }));
        const winner = R.trickWinner(plays, ctx);
        let pts = 0;
        for (const p of plays) for (const k of p.kinds) pts += C.points(k);
        if (teamOf(winner) !== dealerTeam) {
          this.#attackerPoints += pts;
          this.#trickPoints += pts;
        }
        const finished = { leader, winner, points: pts, plays: this.#current.plays };
        this.#tricks.push(finished);
        this.#current = null;
        await this.#emit({
          type: 'trickEnd', winner, points: pts, attackerPoints: this.#attackerPoints,
          toAttackers: teamOf(winner) !== dealerTeam,
          ids: finished.plays.flatMap((p) => p.ids),
          pointIds: finished.plays.flatMap((p) => p.ids).filter((id) => C.points(this.#kinds[id]) > 0),
        });
        lastLeadKinds = realLead;
        lastWinner = winner;
        leader = winner;
      }
      return this.#finish(lastLeadKinds, lastWinner);
    }

    #checkIds(seat, ids) {
      const hand = this.#hands[seat];
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || !ids.every((id) => hand.includes(id))) {
        throw new Error('非法出牌：座位 ' + seat);
      }
      return ids.slice();
    }

    #removeFromHand(seat, ids) {
      const h = this.#hands[seat];
      for (const id of ids) h.splice(h.indexOf(id), 1);
    }

    async #finish(lastLeadKinds, lastWinner) {
      const ctx = this.#ctx;
      const dealer = this.#dealer;
      const dealerTeam = teamOf(dealer);
      const attackers = 1 - dealerTeam;
      const buriedKinds = this.#buried.map((id) => this.#kinds[id]);
      let kittyPoints = 0;
      for (const k of buriedKinds) kittyPoints += C.points(k);
      let multiplier = 0;
      let kittyBonus = 0;
      if (teamOf(lastWinner) === attackers) {
        multiplier = R.kittyMultiplier(lastLeadKinds, ctx);
        kittyBonus = kittyPoints * multiplier;
        this.#attackerPoints += kittyBonus;
      }
      const total = Math.max(0, this.#attackerPoints);
      const out = R.outcome(total);
      const winnerTeam = out.dealerHolds ? dealerTeam : attackers;
      const levels = this.#levels.slice();
      let champion = null;
      if (out.dealerHolds) {
        if (levels[dealerTeam] === 14) champion = dealerTeam; // 打 A 并且守住才算通关，从 K 升上去也要打一局 A
        levels[dealerTeam] = Math.min(levels[dealerTeam] + out.up, 14);
      } else {
        levels[attackers] = Math.min(levels[attackers] + out.up, 14); // 对方升上来也要先把 A 打下来
      }
      const nextDealer = out.dealerHolds ? (dealer + 2) % 4 : (dealer + 1) % 4;
      const result = deepFreeze({
        attackerPoints: total,
        trickPoints: this.#trickPoints,
        penalties: this.#penalties,
        kittyKinds: buriedKinds,
        kittyIds: this.#buried.slice(),
        kittyPoints,
        multiplier,
        kittyBonus,
        lastWinner,
        dealer,
        dealerTeam,
        attackers,
        trump: this.#trump,
        level: this.#level,
        dealerHolds: out.dealerHolds,
        up: out.up,
        winnerTeam,
        levelsBefore: this.#levels.slice(),
        levelsAfter: levels,
        champion,
        nextDealer,
        tricks: this.#tricks.length,
      });
      this.#phase = 'done';
      await this.#emit({ type: 'handEnd', result });
      return result;
    }
  }

  const api = { Hand, teamOf, deepFreeze };
  if (isNode) module.exports = api;
  else (root.TJ = root.TJ || {}).Game = api;
})(typeof self !== 'undefined' ? self : globalThis);

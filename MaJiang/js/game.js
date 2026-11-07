/* 一局牌的裁判。
 *
 * 公平性的硬边界都在这个文件：
 *  - 牌墙和四家的手牌放在 JavaScript 真私有字段（#）里，外部代码在语言层面就读不到。
 *  - 牌的编号就是它在洗好的牌墙里的位置，编号本身不透露牌种。
 *  - 玩家（AI 或真人界面）只能拿到 #view(seat)：自己的手牌 + 所有人都看得见的公开信息。
 *    别人的暗杠牌种、别人的手牌、牌墙顺序都不在其中。
 *  - 响应别人打牌时，各家在互不知情的情况下各自决定，裁判收齐后才按优先级结算。
 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const T = isNode ? require('./tiles.js') : root.MJ.Tiles;
  const R = isNode ? require('./rules.js') : root.MJ.Rules;

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }

  class Hand {
    #kinds;
    #taken = new Uint8Array(144);
    #head = 0;
    #tailSeq = [];
    #tailPos = 0;
    #remaining = 144;
    #seats;
    #adapters;
    #hook;
    #observer;
    #dealer;
    #huangfan;
    #kaibao;
    #dice;
    #discardCount = 0;
    #callCount = 0;
    #calls = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    #lastTile = false;
    #pengBan = [new Set(), new Set(), new Set(), new Set()];
    #finished = null;

    /**
     * opts: { dealer, huangfan, adapters:[4], hook(evt), observer, randInt?, presetWall?, dice? }
     * presetWall / dice 只给单元测试布局用，游戏界面从不传。
     */
    constructor(opts) {
      this.#adapters = opts.adapters;
      this.#hook = opts.hook || null;
      this.#observer = opts.observer === undefined ? -1 : opts.observer;
      this.#dealer = opts.dealer;
      this.#huangfan = opts.huangfan || 0;
      const rnd = opts.randInt || T.secureInt;
      this.#kinds = opts.presetWall ? opts.presetWall.slice() : T.shuffle(T.buildSet(), rnd);
      this.#dice = opts.dice || [rnd(6) + 1, rnd(6) + 1];
      this.#kaibao = this.#dice[0] === this.#dice[1];
      for (let i = 142; i >= 0; i -= 2) this.#tailSeq.push(i, i + 1); // 从牌尾补牌，每墩先取上面那张
      this.#seats = [0, 1, 2, 3].map((seat) => ({
        seat, hand: [], melds: [], flowers: [], discards: [], drawn: null, ownDraws: 0,
      }));
    }

    async #emit(evt) {
      if (this.#hook) await this.#hook(evt);
    }

    #nextHead() {
      while (this.#taken[this.#head]) this.#head++;
      const id = this.#head;
      this.#taken[id] = 1;
      this.#remaining--;
      return id;
    }

    #nextTail() {
      while (this.#taken[this.#tailSeq[this.#tailPos]]) this.#tailPos++;
      const id = this.#tailSeq[this.#tailPos];
      this.#taken[id] = 1;
      this.#remaining--;
      return id;
    }

    /** 某一家能看到的全部信息。这是玩家了解牌局的唯一入口。 */
    #view(seat) {
      const k = this.#kinds;
      const me = this.#seats[seat];
      const hand = me.hand.map((id) => ({ id, kind: k[id] })).sort((a, b) => a.kind - b.kind || a.id - b.id);
      const players = this.#seats.map((p) => ({
        seat: p.seat,
        handCount: p.hand.length,
        flowers: p.flowers.map((id) => k[id]),
        discards: p.discards.map((id) => k[id]),
        melds: p.melds.map((m) => {
          const hidden = m.sub === 'an' && p.seat !== seat;
          return { type: m.type, sub: m.sub, from: m.from, kinds: hidden ? null : m.ids.map((id) => k[id]) };
        }),
      }));
      return deepFreeze({
        seat,
        dealer: this.#dealer,
        wallRemaining: this.#remaining,
        huangfan: this.#huangfan > 0,
        kaibao: this.#kaibao,
        drawnId: me.drawn,
        hand,
        players,
        calls: this.#calls.map((row) => row.slice()),
      });
    }

    #meldsOf(seat) {
      return this.#seats[seat].melds.map((m) => ({
        type: m.type, sub: m.sub, kinds: m.ids.map((id) => this.#kinds[id]),
      }));
    }

    #countsOf(seat, extraKind) {
      const c = R.toCounts(this.#seats[seat].hand.map((id) => this.#kinds[id]));
      if (extraKind !== null && extraKind !== undefined) c[extraKind]++;
      return c;
    }

    #score(seat, extraKind, flags) {
      const p = this.#seats[seat];
      const selfDraw = !!flags.selfDraw;
      const tianhu = selfDraw && seat === this.#dealer && this.#discardCount === 0 && this.#callCount === 0;
      const dihu = seat !== this.#dealer && this.#callCount === 0 && (selfDraw
        ? p.ownDraws === 1
        : this.#discardCount === 1 && flags.from === this.#dealer && !flags.robKong);
      return R.score({
        counts: this.#countsOf(seat, extraKind),
        melds: this.#meldsOf(seat),
        flowerCount: p.flowers.length,
        selfDraw,
        afterKong: !!flags.afterKong,
        lastTile: selfDraw && this.#lastTile,
        robKong: !!flags.robKong,
        tianhu,
        dihu,
        huangfan: this.#huangfan > 0,
        kaibao: this.#kaibao,
      });
    }

    /** 摸牌（含连续补花）。返回 {id,kind}；牌墙摸空返回 null；花牌直接决出胜负时返回 {ended,result}。 */
    async #draw(seat, fromTail) {
      let tail = fromTail;
      const p = this.#seats[seat];
      for (;;) {
        if (this.#remaining === 0) return null;
        const id = tail ? this.#nextTail() : this.#nextHead();
        const kind = this.#kinds[id];
        await this.#emit({
          type: 'draw', seat, id, tail, remaining: this.#remaining,
          kind: seat === this.#observer ? kind : null,
        });
        if (T.isFlower(kind)) {
          p.flowers.push(id);
          await this.#emit({ type: 'flower', seat, id, kind, count: p.flowers.length });
          const end = await this.#checkFlowers(seat);
          if (end) return { ended: true, result: end };
          tail = true;
          continue;
        }
        p.hand.push(id);
        p.drawn = id;
        this.#lastTile = this.#remaining === 0;
        return { id, kind };
      }
    }

    /** 亮花后检查八花、七捉一。 */
    async #checkFlowers(seat) {
      const flat = { huangfan: this.#huangfan > 0, kaibao: this.#kaibao };
      if (this.#seats[seat].flowers.length === 8) {
        const s = R.flatScore('bahua', { ...flat, flowerCount: 8 });
        return this.#finishWin([{ seat, how: 'zimo', from: null, winKind: null, winId: null, score: s }]);
      }
      const seven = this.#seats.find((p) => p.flowers.length === 7);
      const one = this.#seats.find((p) => p.flowers.length === 1);
      if (seven && one) {
        const s = R.flatScore('qizhuoyi', { ...flat, flowerCount: 7 });
        return this.#finishWin([{ seat: seven.seat, how: 'qizhuoyi', from: one.seat, winKind: null, winId: null, score: s }]);
      }
      return null;
    }

    async run() {
      const dealer = this.#dealer;
      await this.#emit({
        type: 'handStart', dealer, dice: this.#dice.slice(), kaibao: this.#kaibao,
        huangfan: this.#huangfan > 0, remaining: this.#remaining,
      });

      const give = async (seat, n) => {
        const ids = [];
        for (let i = 0; i < n; i++) ids.push(this.#nextHead());
        this.#seats[seat].hand.push(...ids);
        await this.#emit({
          type: 'deal', seat, ids, remaining: this.#remaining,
          kinds: seat === this.#observer ? ids.map((id) => this.#kinds[id]) : null,
        });
      };
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) await give((dealer + i) % 4, 4);
      for (let i = 0; i < 4; i++) await give((dealer + i) % 4, 1);
      await give(dealer, 1);
      await this.#emit({ type: 'dealDone' });

      // 开局补花，从庄家开始依次补。
      for (let i = 0; i < 4; i++) {
        const seat = (dealer + i) % 4;
        const p = this.#seats[seat];
        for (;;) {
          const idx = p.hand.findIndex((id) => T.isFlower(this.#kinds[id]));
          if (idx < 0) break;
          const id = p.hand.splice(idx, 1)[0];
          p.flowers.push(id);
          await this.#emit({ type: 'flower', seat, id, kind: this.#kinds[id], count: p.flowers.length });
          const end = await this.#checkFlowers(seat);
          if (end) return end;
          const d = await this.#draw(seat, true);
          if (d && d.ended) return d.result;
        }
        p.drawn = null;
      }
      this.#seats[dealer].drawn = this.#seats[dealer].hand[this.#seats[dealer].hand.length - 1];
      await this.#emit({ type: 'handReady' });

      let seat = dealer;
      let ctx = { afterKong: false, justClaimed: false, forbid: null };
      for (;;) {
        const out = await this.#turn(seat, ctx);
        if (out.ended) return out.result;
        const claim = await this.#claims(seat, out.id, out.kind);
        if (claim.ended) return claim.result;
        if (claim.seat !== undefined) {
          seat = claim.seat;
          if (claim.type === 'gang') {
            const d = await this.#draw(seat, true);
            if (d === null) return this.#finishDraw();
            if (d.ended) return d.result;
            ctx = { afterKong: true, justClaimed: false, forbid: null };
          } else {
            ctx = { afterKong: false, justClaimed: true, forbid: claim.type === 'chi' ? out.kind : null };
          }
          continue;
        }
        if (this.#remaining === 0) return this.#finishDraw();
        seat = (seat + 1) % 4;
        this.#seats[seat].ownDraws++;
        const d = await this.#draw(seat, false);
        if (d === null) return this.#finishDraw();
        if (d.ended) return d.result;
        ctx = { afterKong: false, justClaimed: false, forbid: null };
      }
    }

    async #turn(seat, startCtx) {
      let ctx = startCtx;
      const p = this.#seats[seat];
      this.#pengBan[seat].clear();
      for (;;) {
        await this.#emit({ type: 'turn', seat, remaining: this.#remaining });
        const opts = { canHu: false, preview: null, gangs: [], forbid: ctx.forbid };
        if (!ctx.justClaimed) {
          const s = this.#score(seat, null, { selfDraw: true, afterKong: ctx.afterKong });
          if (s) {
            opts.canHu = true;
            opts.preview = s;
          }
          if (this.#remaining > 0) opts.gangs = this.#gangOptions(seat);
        }
        const act = await this.#adapters[seat].chooseTurn(this.#view(seat), deepFreeze(opts));

        if (act.type === 'hu') {
          if (!opts.canHu) throw new Error('非法操作：座位 ' + seat + ' 不能胡');
          const winId = p.drawn;
          const winKind = this.#kinds[winId];
          return {
            ended: true,
            result: await this.#finishWin([{ seat, how: 'zimo', from: null, winKind, winId, score: opts.preview }]),
          };
        }

        if (act.type === 'gang') {
          const g = opts.gangs.find((x) => x.kind === act.kind && x.sub === act.sub);
          if (!g) throw new Error('非法操作：座位 ' + seat + ' 不能杠');
          const robbed = await this.#doSelfKong(seat, g);
          if (robbed) return { ended: true, result: robbed };
          const d = await this.#draw(seat, true);
          if (d === null) return { ended: true, result: await this.#finishDraw() };
          if (d.ended) return { ended: true, result: d.result };
          ctx = { afterKong: true, justClaimed: false, forbid: null };
          continue;
        }

        if (act.type !== 'discard') throw new Error('非法操作：未知动作');
        const id = this.#pickDiscard(seat, act, ctx.forbid);
        p.hand.splice(p.hand.indexOf(id), 1);
        p.discards.push(id);
        p.drawn = null;
        this.#discardCount++;
        const kind = this.#kinds[id];
        await this.#emit({ type: 'discard', seat, id, kind, remaining: this.#remaining });
        return { id, kind };
      }
    }

    #pickDiscard(seat, act, forbid) {
      const p = this.#seats[seat];
      let id;
      if (act.id !== undefined) {
        id = act.id;
        if (!p.hand.includes(id)) throw new Error('非法操作：出的牌不在手里');
      } else {
        const same = p.hand.filter((x) => this.#kinds[x] === act.kind);
        if (!same.length) throw new Error('非法操作：手里没有这张牌');
        id = same.includes(p.drawn) ? p.drawn : same[same.length - 1];
      }
      if (forbid !== null && this.#kinds[id] === forbid) throw new Error('非法操作：不能吃什么打什么');
      return id;
    }

    #gangOptions(seat) {
      const p = this.#seats[seat];
      const c = this.#countsOf(seat);
      const out = [];
      for (let k = 0; k < 34; k++) if (c[k] === 4) out.push({ kind: k, sub: 'an' });
      for (const m of p.melds) {
        if (m.type === 'peng') {
          const k = this.#kinds[m.ids[0]];
          if (c[k] > 0) out.push({ kind: k, sub: 'jia' });
        }
      }
      return out;
    }

    /** 暗杠 / 加杠。加杠时别家可以拉杠胡，返回结算结果则本局已结束。 */
    async #doSelfKong(seat, g) {
      const p = this.#seats[seat];
      const ofKind = p.hand.filter((id) => this.#kinds[id] === g.kind);
      if (g.sub === 'an') {
        for (const id of ofKind) p.hand.splice(p.hand.indexOf(id), 1);
        const m = { type: 'gang', sub: 'an', ids: ofKind, from: seat };
        p.melds.push(m);
        p.drawn = null;
        this.#callCount++;
        await this.#emit({
          type: 'meld', seat, mtype: 'gang', sub: 'an', ids: ofKind.slice(), claimedId: null, from: seat,
          kinds: seat === this.#observer ? ofKind.map((id) => this.#kinds[id]) : null,
          remaining: this.#remaining,
        });
        return null;
      }

      const id = ofKind[0];
      p.hand.splice(p.hand.indexOf(id), 1);
      p.drawn = null;
      await this.#emit({ type: 'kongAttempt', seat, id, kind: g.kind });

      // 拉杠胡：各家独立决定，可以多家同时胡。
      const robbers = [];
      const asks = [];
      for (let i = 1; i < 4; i++) {
        const s = (seat + i) % 4;
        const sc = this.#score(s, g.kind, { robKong: true, from: seat });
        if (sc) {
          asks.push(Promise.resolve(this.#adapters[s].chooseRob(this.#view(s), deepFreeze({ kind: g.kind, from: seat, preview: sc })))
            .then((a) => {
              if (a.type === 'hu') robbers.push({ seat: s, how: 'rob', from: seat, winKind: g.kind, winId: id, score: sc });
            }));
        }
      }
      await Promise.all(asks);
      if (robbers.length) return this.#finishWin(robbers);

      const m = p.melds.find((x) => x.type === 'peng' && this.#kinds[x.ids[0]] === g.kind);
      m.type = 'gang';
      m.sub = 'jia';
      m.ids.push(id);
      this.#callCount++;
      await this.#emit({
        type: 'meld', seat, mtype: 'gang', sub: 'jia', ids: m.ids.slice(), claimedId: id, from: m.from,
        kinds: m.ids.map((x) => this.#kinds[x]), upgrade: true, remaining: this.#remaining,
      });
      return null;
    }

    /** 别家打出一张牌后的响应：胡 > 碰/杠 > 吃。各家同时决定，彼此不知道对方的选择。 */
    async #claims(from, id, kind) {
      const wallEmpty = this.#remaining === 0;
      const next = (from + 1) % 4;
      const asks = [];
      for (let i = 1; i < 4; i++) {
        const s = (from + i) % 4;
        const c = this.#countsOf(s);
        const options = { hu: false, preview: null, peng: false, gang: false, chi: [] };
        const sc = this.#score(s, kind, { from });
        if (sc) {
          options.hu = true;
          options.preview = sc;
        }
        if (!wallEmpty) {
          if (c[kind] >= 2 && !this.#pengBan[s].has(kind)) options.peng = true;
          if (c[kind] === 3 && !this.#pengBan[s].has(kind)) options.gang = true;
          if (s === next) options.chi = R.chiOptions(c, kind);
        }
        if (!options.hu && !options.peng && !options.gang && !options.chi.length) continue;
        asks.push(
          Promise.resolve(this.#adapters[s].chooseClaim(this.#view(s), deepFreeze({ kind, from, options })))
            .then((act) => ({ seat: s, act, options }))
        );
      }
      if (!asks.length) return {};
      const replies = await Promise.all(asks);

      for (const r of replies) {
        const t = r.act.type;
        const ok = t === 'pass' || (t === 'hu' && r.options.hu) || (t === 'peng' && r.options.peng) ||
          (t === 'gang' && r.options.gang) ||
          (t === 'chi' && r.options.chi.some((o) => r.act.chi && o[0] === r.act.chi[0] && o[1] === r.act.chi[1]));
        if (!ok) throw new Error('非法操作：座位 ' + r.seat + ' 响应 ' + t);
        if (r.options.peng && t !== 'peng' && t !== 'gang' && t !== 'hu') this.#pengBan[r.seat].add(kind);
      }

      const hus = replies.filter((r) => r.act.type === 'hu');
      if (hus.length) {
        const winners = hus.map((r) => ({
          seat: r.seat, how: 'ron', from, winKind: kind, winId: id, score: r.options.preview,
        }));
        return { ended: true, result: await this.#finishWin(winners) };
      }

      const big = replies.find((r) => r.act.type === 'peng' || r.act.type === 'gang');
      const pick = big || replies.find((r) => r.act.type === 'chi');
      if (!pick) return {};
      await this.#applyClaim(pick.seat, pick.act, from, id, kind);
      return { seat: pick.seat, type: pick.act.type };
    }

    async #applyClaim(seat, act, from, id, kind) {
      const p = this.#seats[seat];
      const take = (k) => {
        const x = p.hand.find((h) => this.#kinds[h] === k);
        p.hand.splice(p.hand.indexOf(x), 1);
        return x;
      };
      let ids;
      if (act.type === 'chi') {
        const a = take(act.chi[0]);
        const b = take(act.chi[1]);
        ids = [a, b, id].sort((x, y) => this.#kinds[x] - this.#kinds[y]);
      } else if (act.type === 'peng') {
        ids = [take(kind), id, take(kind)];
      } else {
        ids = [take(kind), id, take(kind), take(kind)];
      }
      const river = this.#seats[from].discards;
      river.splice(river.indexOf(id), 1);
      p.melds.push({ type: act.type, sub: act.type === 'gang' ? 'ming' : undefined, ids, from });
      p.drawn = null;
      this.#callCount++;
      this.#calls[seat][from]++;
      await this.#emit({
        type: 'meld', seat, mtype: act.type, sub: act.type === 'gang' ? 'ming' : undefined,
        ids: ids.slice(), kinds: ids.map((x) => this.#kinds[x]), claimedId: id, from, remaining: this.#remaining,
      });
      if (this.#calls[seat][from] === R.VALUES.sankouCalls && this.#calls[from][seat] < R.VALUES.sankouCalls) {
        await this.#emit({ type: 'sankou', a: seat, b: from });
      }
    }

    #snapshot() {
      return this.#seats.map((p) => ({
        seat: p.seat,
        hand: p.hand.map((id) => ({ id, kind: this.#kinds[id] })).sort((a, b) => a.kind - b.kind || a.id - b.id),
        melds: p.melds.map((m) => ({
          type: m.type, sub: m.sub, from: m.from, ids: m.ids.slice(), kinds: m.ids.map((id) => this.#kinds[id]),
        })),
        flowers: p.flowers.map((id) => this.#kinds[id]),
        discards: p.discards.map((id) => this.#kinds[id]),
      }));
    }

    async #finishWin(winners) {
      const { deltas, payments } = R.settle(
        winners.map((w) => ({ seat: w.seat, how: w.how, from: w.from, points: w.score.points })),
        this.#calls,
        (s) => R.waits(this.#countsOf(s), this.#meldsOf(s)).length > 0
      );
      let nextDealer = winners[0].seat;
      if (winners.length > 1) {
        for (let i = 1; i < 4; i++) {
          const s = (winners[0].from + i) % 4;
          if (winners.some((w) => w.seat === s)) { nextDealer = s; break; }
        }
      }
      const result = deepFreeze({
        type: 'win', winners, deltas, payments, nextDealer,
        nextHuangfan: Math.max(0, this.#huangfan - 1),
        seats: this.#snapshot(), remaining: this.#remaining,
        kaibao: this.#kaibao, huangfan: this.#huangfan > 0,
      });
      this.#finished = result;
      await this.#emit({ type: 'handEnd', result });
      return result;
    }

    async #finishDraw() {
      const result = deepFreeze({
        type: 'draw', winners: [], deltas: [0, 0, 0, 0], payments: [],
        nextDealer: this.#dealer, nextHuangfan: this.#huangfan + 1,
        seats: this.#snapshot(), remaining: 0,
        kaibao: this.#kaibao, huangfan: this.#huangfan > 0,
      });
      this.#finished = result;
      await this.#emit({ type: 'handEnd', result });
      return result;
    }
  }

  const api = { Hand, deepFreeze };
  if (isNode) module.exports = api;
  else (root.MJ = root.MJ || {}).Game = api;
})(typeof self !== 'undefined' ? self : globalThis);

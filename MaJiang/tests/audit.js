/* 实战审计：让正式 AI 打指定局数，逐手检查决策，统计明显的失误。
 *   node tests/audit.js [局数] [ai模块或params.json] [--show 类别]
 * 只读，不改任何东西。检查用的是全局视角（裁判知道的信息），AI 决策本身仍然只看 view。 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const T = require(path.join(ROOT, 'js/tiles.js'));
const R = require(path.join(ROOT, 'js/rules.js'));
const { Hand } = require(path.join(ROOT, 'js/game.js'));

const N = Number(process.argv[2]) || 300;
const spec = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
const showIdx = process.argv.indexOf('--show');
const SHOW = showIdx >= 0 ? process.argv[showIdx + 1] : null;
const AI = require(spec && spec.endsWith('.js') ? path.resolve(spec) : path.join(ROOT, 'js/ai.js'));
const params = spec && spec.endsWith('.json') ? JSON.parse(fs.readFileSync(spec, 'utf8')) : null;

const names = (a) => a.map(T.name).join(' ');
const counts = (view) => R.toCounts(view.hand.map((t) => t.kind));

function targetsAlive(melds) {
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
  const oneSuit = (mask & (mask - 1)) === 0;
  return { oneSuit, honor, chi, dead: chi && !oneSuit };
}

const stat = {
  hands: 0, wins: 0, draws: 0, zimo: 0, ron: 0, rob: 0, multi: 0,
  turnDecisions: 0, claimOffers: 0, claimTaken: { chi: 0, peng: 0, gang: 0, hu: 0 }, claimDeclined: { chi: 0, peng: 0, gang: 0, hu: 0 },
  deadCalls: 0, deadHandsAtEnd: 0, brokeTenpai: 0, brokeTenpaiBig: 0, tenpaiDecisions: 0,
  feedBigFlush: 0, feedBigFlushLost: 0, recklessDiscard: 0, recklessLost: 0,
  winPoints: 0, lostByRon: 0, seatWins: [0, 0, 0, 0], seatNet: [0, 0, 0, 0],
  endTenpai: 0, endSeats: 0, wallAtWin: [], discardsToWin: [],
  shapeWins: {}, callsPerWinHand: 0, callsPerLossHand: 0, winSeats: 0, lossSeats: 0,
  ronSmallFromBigHand: 0, waitsDead: 0, waitsTotal: 0, zeroWaitDiscard: 0,
  sankouCount: 0, sankouPaid: 0, kongRobbed: 0, passRon: 0, passRonThenLost: 0,
  firstCommit: 0,
};
const examples = {};
const note = (cat, text) => {
  (examples[cat] = examples[cat] || []);
  if (examples[cat].length < 12) examples[cat].push(text);
};

function legalWaits(view, kindRemoved) {
  const me = view.players[view.seat];
  const c = counts(view);
  if (kindRemoved !== null) c[kindRemoved]--;
  return R.waits(c, me.melds);
}

function liveCount(view, waits) {
  const seen = new Array(34).fill(0);
  for (const t of view.hand) seen[t.kind]++;
  for (const p of view.players) {
    for (const k of p.discards) seen[k]++;
    for (const m of p.melds) if (m.kinds) for (const k of m.kinds) seen[k]++;
  }
  let live = 0;
  for (const w of waits) live += Math.max(0, 4 - seen[w]);
  return live;
}

(async () => {
  const brain = AI.createPlayer(params ? { params } : {});
  for (let h = 0; h < N; h++) {
    const dealer = h % 4;
    const passedRon = new Set();
    const lastDiscardBy = { seat: -1 };
    const adapter = {
      chooseTurn(view, opts) {
        const act = brain.chooseTurn(view, opts);
        stat.turnDecisions++;
        if (act.type === 'discard' && !opts.canHu) {
          // 能保持听牌却打成不听
          const kinds = new Set(view.hand.map((t) => t.kind));
          let bestLive = 0;
          let bestKind = -1;
          for (const k of kinds) {
            if (opts.forbid === k) continue;
            const w = legalWaits(view, k);
            const live = liveCount(view, w);
            if (w.length && live > bestLive) { bestLive = live; bestKind = k; }
          }
          if (bestKind >= 0) {
            stat.tenpaiDecisions++;
            const mine = legalWaits(view, act.kind);
            const myLive = liveCount(view, mine);
            if (!mine.length || myLive === 0) {
              stat.brokeTenpai++;
              if (bestLive >= 4) stat.brokeTenpaiBig++;
              note('拆听牌', '牌墙' + view.wallRemaining + ' 手牌 ' + names(view.hand.map((t) => t.kind)) + ' 打' + T.name(act.kind) + '，本可打' + T.name(bestKind) + '听' + bestLive + '张');
            }
          }
          // 对手明显在做清一色、自己还很远时，打他那门的生张
          const c = counts(view);
          c[act.kind]--;
          const tenpaiNow = R.waits(c, view.players[view.seat].melds).length > 0;
          for (const p of view.players) {
            if (p.seat === view.seat || p.melds.length < 3) continue;
            let mask = 0;
            for (const m of p.melds) if (m.kinds) for (const k of m.kinds) if (T.isNumber(k)) mask |= 1 << T.suitOf(k);
            if (mask && (mask & (mask - 1)) === 0 && T.isNumber(act.kind) && (mask & (1 << T.suitOf(act.kind))) && !p.discards.includes(act.kind) && !tenpaiNow) {
              stat.recklessDiscard++;
              note('冒险打牌', '牌墙' + view.wallRemaining + ' 打' + T.name(act.kind) + '，座位' + p.seat + '已亮 ' + p.melds.map((m) => (m.kinds ? names(m.kinds) : '暗杠')).join('|') + '，自己还没听：' + names(view.hand.map((t) => t.kind)));
              lastDiscardBy.seat = view.seat;
              lastDiscardBy.reckless = true;
            }
          }
        }
        return act;
      },
      chooseClaim(view, claim) {
        const act = brain.chooseClaim(view, claim);
        stat.claimOffers++;
        const o = claim.options;
        for (const type of ['chi', 'peng', 'gang', 'hu']) {
          const offered = type === 'chi' ? o.chi.length > 0 : o[type];
          if (!offered) continue;
          if (act.type === type) stat.claimTaken[type]++;
          else stat.claimDeclined[type]++;
        }
        if (o.hu && act.type !== 'hu') {
          stat.passRon++;
          passedRon.add(view.seat);
          note('放过点炮', '牌墙' + view.wallRemaining + ' 点数' + o.preview.points + ' ' + o.preview.patterns.join('·') + ' 手牌 ' + names(view.hand.map((t) => t.kind)));
        }
        if (act.type === 'chi' || act.type === 'peng' || act.type === 'gang') {
          const me = view.players[view.seat];
          const k = claim.kind;
          const kinds = act.type === 'chi' ? [act.chi[0], act.chi[1], k].sort((a, b) => a - b) : act.type === 'peng' ? [k, k, k] : [k, k, k, k];
          const after = me.melds.concat([{ type: act.type, kinds }]);
          if (targetsAlive(after).dead) {
            stat.deadCalls++;
            note('吃成死牌', '吃碰后没有任何合法牌型：' + after.map((m) => names(m.kinds)).join(' | '));
          }
        }
        return act;
      },
      chooseRob: (view, info) => brain.chooseRob(view, info),
    };
    let bigLoser = null;
    const hook = (e) => {
      if (e.type === 'discard') lastDiscardBy.last = e.seat;
      void bigLoser;
    };
    const r = await new Hand({ dealer, adapters: [adapter, adapter, adapter, adapter], hook }).run();
    stat.hands++;
    r.deltas.forEach((d, s) => { stat.seatNet[s] += d; });
    for (const s of r.seats) {
      stat.endSeats++;
      const c = R.toCounts(s.hand.map((x) => x.kind));
      const isWinnerZimo = r.winners.some((w) => w.seat === s.seat && w.how === 'zimo');
      if (!isWinnerZimo && R.waits(c, s.melds).length) stat.endTenpai++;
      if (targetsAlive(s.melds).dead) stat.deadHandsAtEnd++;
    }
    if (r.type === 'draw') stat.draws++;
    else {
      stat.wins++;
      if (r.winners.length > 1) stat.multi++;
      stat.wallAtWin.push(r.remaining);
      for (const w of r.winners) {
        stat[w.how] = (stat[w.how] || 0) + 1;
        stat.seatWins[w.seat]++;
        stat.winPoints += w.score.points;
        stat.shapeWins[w.score.shapeName] = (stat.shapeWins[w.score.shapeName] || 0) + 1;
        if (w.how === 'ron' && lastDiscardBy.reckless && w.from === lastDiscardBy.seat) {
          stat.recklessLost++;
        }
        const melds = r.seats[w.seat].melds.length;
        stat.callsPerWinHand += melds;
        stat.winSeats++;
      }
      if (r.payments.some((p) => /三口/.test(p.note))) stat.sankouPaid++;
    }
    for (const seat of passedRon) {
      if (!r.winners.some((w) => w.seat === seat)) stat.passRonThenLost++;
    }
  }

  const n = stat.hands;
  const pct = (x, y) => (100 * x / Math.max(y === undefined ? n : y, 1)).toFixed(1) + '%';
  const avg = (arr) => (arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1)).toFixed(1);
  console.log('局数 ' + n + '  胡牌 ' + pct(stat.wins) + '  流局 ' + pct(stat.draws) + '  一炮多响 ' + stat.multi);
  console.log('胡牌方式：自摸 ' + stat.zimo + '  点炮 ' + stat.ron + '  拉杠 ' + (stat.rob || 0) + '  七捉一 ' + (stat.qizhuoyi || 0) + '；胡牌时牌墙平均还剩 ' + avg(stat.wallAtWin) + ' 张');
  console.log('平均每胡 ' + (stat.winPoints / Math.max(stat.winSeats, 1)).toFixed(1) + ' 点；胡牌者平均副露 ' + (stat.callsPerWinHand / Math.max(stat.winSeats, 1)).toFixed(2) + ' 副');
  console.log('牌型 ' + Object.entries(stat.shapeWins).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join('  '));
  console.log('响应：' + ['chi', 'peng', 'gang', 'hu'].map((t) => t + ' 接受' + stat.claimTaken[t] + '/放弃' + stat.claimDeclined[t]).join('  '));
  console.log('各座位胡牌 ' + stat.seatWins.join(' / ') + '  净点 ' + stat.seatNet.join(' / '));
  console.log('局末听牌 ' + pct(stat.endTenpai, stat.endSeats) + ' 的座位；局末死牌（已吃碰且无合法牌型）' + stat.deadHandsAtEnd + ' 家');
  console.log('—— 失误检查 ——');
  console.log('吃碰成死牌 ' + stat.deadCalls + ' 次');
  console.log('能听却拆听（或听死张）' + stat.brokeTenpai + ' / ' + stat.tenpaiDecisions + ' 次（' + pct(stat.brokeTenpai, stat.tenpaiDecisions) + '），其中放弃 ≥4 张好听 ' + stat.brokeTenpaiBig + ' 次');
  console.log('冒险打牌（自己没听，打三副清一色对手那门的生张）' + stat.recklessDiscard + ' 次');
  console.log('放过点炮 ' + stat.passRon + ' 次，之后没胡 ' + stat.passRonThenLost + ' 次');
  console.log('出现三口付款的局 ' + stat.sankouPaid);
  if (SHOW && examples[SHOW]) {
    console.log('\n例子：' + SHOW);
    for (const x of examples[SHOW]) console.log('  ' + x);
  } else if (SHOW === 'all') {
    for (const [k, v] of Object.entries(examples)) {
      console.log('\n例子：' + k);
      for (const x of v.slice(0, 6)) console.log('  ' + x);
    }
  }
})();

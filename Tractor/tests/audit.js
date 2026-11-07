/* 实战审计：让正式 AI 打指定局数，逐手检查决策，统计明显的失误。
 *   node tests/audit.js [局数] [ai模块或params.json] [--show 类别|all]
 * 只读，不改任何东西。检查用的是全局视角（裁判知道的信息），AI 决策本身仍然只看 view。 */
'use strict';
const path = require('path');
const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'js/cards.js'));
const R = require(path.join(ROOT, 'js/rules.js'));
const { Hand, teamOf } = require(path.join(ROOT, 'js/game.js'));

const names = (a) => a.map(C.name).join(' ');
const pts = (a) => a.reduce((x, k) => x + C.points(k), 0);

async function runBatch(cfg) {
  const AI = require(cfg.spec && cfg.spec.endsWith('.js') ? path.resolve(cfg.spec) : path.join(ROOT, 'js/ai.js'));
  const params = cfg.spec && cfg.spec.endsWith('.json') ? JSON.parse(fs.readFileSync(cfg.spec, 'utf8')) : null;
  const brain = AI.createPlayer(params ? { params } : {});
  const s = {
    hands: 0, attack: 0, holds: 0, teamWins: [0, 0], seatLead: [0, 0, 0, 0],
    lastTrickAttackers: 0, kittyHands: 0, kittyBonus: 0, buried: 0, buriedPointHands: 0,
    leads: 0, leadTrump: 0, leadTrumpDealer: 0, leadTrumpAtt: 0, leadsDealer: 0, leadsAtt: 0, leadPair: 0, leadTractor: 0, leadThrow: 0, leadPoints: 0,
    follows: 0, lastSeatMissedWin: 0, lastSeatMissedPts: 0, overtookPartner: 0, overtookSure: 0, gaveFoePts: 0, gaveFoePtsAmount: 0,
    ruffZero: 0, ruffBig: 0, wastedTop: 0, feedChance: 0, feedDone: 0, feedMissedPts: 0,
    pointsLostToRuff: 0, decisionMs: 0, decisions: 0, maxMs: 0, bidTrumpLen: 0, bidHands: 0, shortTrumpDealer: 0, dealerTrumpLen: 0,
    tractorBroken: 0, tractorLeadOffered: 0, tractorLeadTaken: 0, levelSpread: {}, trumpExhaustByTrick: 0,
    lastTrickStrong: 0, kittyKnownWin: 0,
  };
  const ex = {};
  const note = (cat, text) => {
    (ex[cat] = ex[cat] || []);
    if (ex[cat].length < 10) ex[cat].push(text);
  };
  const timed = (fn) => {
    const a = performance.now();
    const r = fn();
    const ms = performance.now() - a;
    s.decisionMs += ms;
    s.decisions++;
    if (ms > s.maxMs) s.maxMs = ms;
    return r;
  };

  for (let h = 0; h < cfg.hands; h++) {
    const levels = [2 + ((h + cfg.offset) % 13), 2 + ((h + cfg.offset) % 13)];
    const adapter = {
      chooseBid: (v, o, l) => brain.chooseBid(v, o, l),
      chooseBury: (v) => {
        const ids = brain.chooseBury(v);
        const ctx = R.makeCtx(v.level, v.trump);
        const hand = v.hand.map((t) => t.kind);
        s.dealerTrumpLen += hand.filter((k) => ctx.cls[k] === R.TRUMP).length;
        const buried = v.hand.filter((t) => ids.includes(t.id)).map((t) => t.kind);
        if (buried.some((k) => ctx.cls[k] === R.TRUMP)) note('埋了主牌', names(buried) + ' 手牌 ' + names(hand));
        return ids;
      },
      chooseLead: (v) => {
        const ids = timed(() => brain.chooseLead(v));
        const ctx = R.makeCtx(v.level, v.trump);
        const kinds = v.hand.filter((t) => ids.includes(t.id)).map((t) => t.kind);
        s.leads++;
        const isDealerTeam = teamOf(v.seat) === teamOf(v.dealer);
        if (isDealerTeam) s.leadsDealer++;
        else s.leadsAtt++;
        const comps = R.decompose(kinds, ctx);
        if (ctx.cls[kinds[0]] === R.TRUMP) {
          s.leadTrump++;
          if (isDealerTeam) s.leadTrumpDealer++;
          else s.leadTrumpAtt++;
        }
        if (comps.length > 1) s.leadThrow++;
        else if (comps[0].type === 'tractor') s.leadTractor++;
        else if (comps[0].type === 'pair') s.leadPair++;
        s.leadPoints += pts(kinds);
        // 手里有拖拉机却从来不领
        const classes = new Map();
        for (const t of v.hand) {
          const c = ctx.cls[t.kind];
          if (!classes.has(c)) classes.set(c, []);
          classes.get(c).push(t.kind);
        }
        let hasTractor = false;
        for (const list of classes.values()) if (R.decompose(list, ctx).some((x) => x.type === 'tractor')) hasTractor = true;
        if (hasTractor) {
          s.tractorLeadOffered++;
          if (comps.some((x) => x.type === 'tractor')) s.tractorLeadTaken++;
        }
        return ids;
      },
      chooseFollow: (v, info) => {
        const ids = timed(() => brain.chooseFollow(v, info));
        const ctx = R.makeCtx(v.level, v.trump);
        const kinds = v.hand.filter((t) => ids.includes(t.id)).map((t) => t.kind);
        s.follows++;
        const cur = v.current.plays;
        const pos = cur.length;
        const partner = (v.seat + 2) % 4;
        const before = cur.map((p) => ({ seat: p.seat, kinds: p.kinds }));
        const bestBefore = R.trickWinner(before, ctx);
        const after = before.concat([{ seat: v.seat, kinds }]);
        const iWin = R.trickWinner(after, ctx) === v.seat;
        const trickPts = before.reduce((a, p) => a + pts(p.kinds), 0);
        const partnerBest = bestBefore === partner;
        const hand = v.hand.map((t) => t.kind);
        const lead = cur[0].kinds;
        const leadCls = ctx.cls[lead[0]];
        const same = hand.filter((k) => ctx.cls[k] === leadCls);

        // 最后一家：这一墩有分，手里有合法的牌能赢，却没赢（只查单张和对子，组合太多）
        if (pos === 3 && !partnerBest && !iWin && trickPts >= 10 && lead.length <= 2) {
          let can = false;
          const options = lead.length === 1
            ? [...new Set(hand)].map((k) => [k])
            : [...R.tally(hand)].filter(([, n]) => n >= 2).map(([k]) => [k, k]);
          for (const play of options) {
            if (!R.canFollow(hand, lead, play, ctx).ok) continue;
            if (R.trickWinner(before.concat([{ seat: v.seat, kinds: play }]), ctx) === v.seat) { can = true; break; }
          }
          if (can) {
            s.lastSeatMissedWin++;
            s.lastSeatMissedPts += trickPts;
            note('末家放分', '领' + names(lead) + ' 桌上 ' + trickPts + ' 分，手牌 ' + names(hand) + '，打了 ' + names(kinds));
          }
        }
        // 对家已领先，还压过去（只算有不压的合法选择时）
        let couldStayUnder = false;
        if (partnerBest && iWin && lead.length <= 2) {
          const options = lead.length === 1
            ? [...new Set(hand)].map((k) => [k])
            : [...R.tally(hand)].filter(([, n]) => n >= 2).map(([k]) => [k, k]);
          for (const play of options) {
            if (!R.canFollow(hand, lead, play, ctx).ok) continue;
            if (R.trickWinner(before.concat([{ seat: v.seat, kinds: play }]), ctx) !== v.seat) { couldStayUnder = true; break; }
          }
        }
        if (partnerBest && iWin && couldStayUnder) {
          s.overtookPartner++;
          if (pos === 3) {
            s.overtookSure++;
            note('压对家', '最后一家压对家：领' + names(lead) + ' 对家 ' + names(cur.find((p) => p.seat === partner).kinds) + '，打了 ' + names(kinds) + ' 手牌 ' + names(hand));
          }
        }
        // 最后一家，对家已赢：该送分
        if (pos === 3 && partnerBest && !iWin && same.length < lead.length) {
          const freeOptions = hand.filter((k) => C.points(k) > 0).length;
          s.feedChance++;
          if (pts(kinds) > 0) s.feedDone++;
          else if (freeOptions > 0) {
            s.feedMissedPts += 5;
            note('没送分', '对家已赢，断门能垫分却垫了 ' + names(kinds) + ' 手牌 ' + names(hand));
          }
        }
        // 对手领先，又是最后一家（确定输这一墩），却打分牌，手里还有不带分的合法选择
        if (!iWin && !partnerBest && pos === 3 && pts(kinds) > 0) {
          const noPoint = lead.length === 1
            ? [...new Set(hand)].filter((k) => C.points(k) === 0).some((k) => R.canFollow(hand, lead, [k], ctx).ok)
            : false;
          if (noPoint) {
            s.gaveFoePts++;
            s.gaveFoePtsAmount += pts(kinds);
            note('送分给对手', '领' + names(lead) + ' 打了 ' + names(kinds) + ' 手牌 ' + names(hand));
          }
        }
        // 用主牌毙没分的一墩
        if (leadCls !== R.TRUMP && same.length === 0 && ctx.cls[kinds[0]] === R.TRUMP && iWin) {
          if (trickPts === 0 && pts(kinds) === 0) s.ruffZero++;
          if (kinds.some((k) => C.isJoker(k)) && trickPts < 10) {
            s.ruffBig++;
            note('大王毙小分', '领' + names(lead) + ' 桌上 ' + trickPts + ' 分，用 ' + names(kinds) + ' 毙，手牌 ' + names(hand));
          }
        }
        return ids;
      },
    };
    let lastWinner = null;
    const hook = (e) => {
      if (e.type === 'trickEnd') lastWinner = e.winner;
      if (e.type === 'bid') s.bidHands++;
    };
    const r = await new Hand({ dealer: (h + cfg.offset) % 4, levels, adapters: [adapter, adapter, adapter, adapter], hook }).run();
    s.hands++;
    s.attack += r.attackerPoints;
    if (r.dealerHolds) s.holds++;
    s.teamWins[r.winnerTeam]++;
    if (teamOf(lastWinner) === r.attackers) s.lastTrickAttackers++;
    if (r.kittyBonus > 0) { s.kittyHands++; s.kittyBonus += r.kittyBonus; }
    s.buried += r.kittyPoints;
    if (r.kittyPoints > 0) s.buriedPointHands++;
    const key = (r.dealerHolds ? '庄+' : '闲+') + Math.min(r.up, 4);
    s.levelSpread[key] = (s.levelSpread[key] || 0) + 1;
  }
  return { s, ex };
}

if (!isMainThread) {
  runBatch(workerData).then((r) => parentPort.postMessage(r)).catch((e) => { throw e; });
} else {
  const N = Number(process.argv[2]) || 300;
  const spec = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const showIdx = process.argv.indexOf('--show');
  const SHOW = showIdx >= 0 ? process.argv[showIdx + 1] : null;
  const THREADS = 12;
  const size = Math.ceil(N / THREADS);
  const jobs = [];
  for (let i = 0; i < THREADS; i++) {
    jobs.push(new Promise((res, rej) => {
      const w = new Worker(__filename, { workerData: { hands: size, offset: i * size, spec } });
      w.once('message', res);
      w.once('error', rej);
    }));
  }
  Promise.all(jobs).then((parts) => {
    const t = parts[0].s;
    const ex = parts[0].ex;
    for (const { s, ex: e2 } of parts.slice(1)) {
      for (const k of Object.keys(s)) {
        if (k === 'teamWins' || k === 'seatLead') s[k].forEach((x, i) => { t[k][i] += x; });
        else if (k === 'levelSpread') for (const q of Object.keys(s[k])) t[k][q] = (t[k][q] || 0) + s[k][q];
        else if (k === 'maxMs') t[k] = Math.max(t[k], s[k]);
        else t[k] += s[k];
      }
      for (const [k, v] of Object.entries(e2)) ex[k] = (ex[k] || []).concat(v);
    }
    const n = t.hands;
    const pct = (x, y) => (100 * x / Math.max(y === undefined ? n : y, 1)).toFixed(1) + '%';
    console.log('局数 ' + n + '  闲家平均 ' + (t.attack / n).toFixed(1) + ' 分  庄家守住 ' + pct(t.holds) + '  两队胜局 ' + t.teamWins.join(' / '));
    console.log('结果 ' + Object.entries(t.levelSpread).sort().map(([k, v]) => k + ':' + pct(v)).join('  '));
    console.log('决策耗时 平均 ' + (t.decisionMs / Math.max(t.decisions, 1)).toFixed(1) + ' ms，最长 ' + t.maxMs.toFixed(0) + ' ms');
    console.log('领牌 ' + t.leads + '：领主 ' + pct(t.leadTrump, t.leads) + '（庄家方 ' + pct(t.leadTrumpDealer, t.leadsDealer) + ' / 闲家 ' + pct(t.leadTrumpAtt, t.leadsAtt) + '），对子 ' + pct(t.leadPair, t.leads) + '，拖拉机 ' + pct(t.leadTractor, t.leads) + '，甩牌 ' + pct(t.leadThrow, t.leads) + '；有拖拉机时领它 ' + pct(t.tractorLeadTaken, t.tractorLeadOffered));
    console.log('庄家埋牌后平均主牌 ' + (t.dealerTrumpLen / n).toFixed(1) + ' 张；埋分局 ' + pct(t.buriedPointHands) + '，平均埋 ' + (t.buried / n).toFixed(1) + ' 分');
    console.log('闲家赢最后一墩 ' + pct(t.lastTrickAttackers) + '，抠底得分局 ' + pct(t.kittyHands) + '，平均每次 ' + (t.kittyBonus / Math.max(t.kittyHands, 1)).toFixed(1) + ' 分');
    console.log('—— 失误检查 ——');
    console.log('末家能赢却放掉有分的墩 ' + t.lastSeatMissedWin + ' 次，共 ' + t.lastSeatMissedPts + ' 分');
    console.log('压对家 ' + t.overtookPartner + ' 次（最后一家仍压 ' + t.overtookSure + ' 次）');
    console.log('对家已赢且自己断门：有机会 ' + t.feedChance + ' 次，送了分 ' + t.feedDone + ' 次');
    console.log('确定输这一墩还打分牌 ' + t.gaveFoePts + ' 次，共送 ' + t.gaveFoePtsAmount + ' 分');
    console.log('主牌毙没分的墩 ' + t.ruffZero + ' 次；用王毙不到 10 分的墩 ' + t.ruffBig + ' 次');
    if (SHOW === 'all') {
      for (const [k, v] of Object.entries(ex)) {
        console.log('\n例子：' + k);
        for (const x of v.slice(0, 6)) console.log('  ' + x);
      }
    } else if (SHOW && ex[SHOW]) {
      console.log('\n例子：' + SHOW);
      for (const x of ex[SHOW]) console.log('  ' + x);
    }
    process.exit(0);
  });
}

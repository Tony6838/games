/* 界面：把裁判的事件变成动画，把玩家的点击变成动作。界面收到的信息和其他玩家一样，只有自己的牌和公开信息。 */
(function (root) {
  'use strict';
  const { Cards: C, Rules: R, Game, AI, Art, Scene } = root.TJ;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const AUTO = params.get('auto') === '1'; // 测试用：你的座位也交给电脑
  const NAMES = ['沈强', '王雷', '徐涌', '吴忠'];
  const TEAM_NAMES = ['你们队', '对手队'];
  const DEAL_MS = 62; // 每张牌的间隔；有亮主机会时会停下来等你，不靠放慢发牌
  // 动画和电脑出牌的节奏只有一种。原来有标准/快/慢三档，试玩下来「慢」正合真人的速度。
  // 测试工具用 ?speed= 加快。
  const PACE = 0.7;

  let scene = null;
  let session = { levels: [2, 2], dealer: null, handNo: 0, starter: C.secureInt(4) };
  let state = null;
  let pending = null;
  let queuedBid = null;
  let bidBarKey = '';
  let declinedBids = new Set(); // 这一局你按过「不亮」的亮主选项，之后不再为它们停下来
  const bidKey = (o) => o.strength + ':' + o.suit;
  let soundOn = true;
  let lastResult = null;
  const hintAI = AI.createPlayer();

  const sleep = (ms) => scene.wait(ms);

  // ---- 声音 ------------------------------------------------------------------
  let audio = null;
  function ctx() {
    if (!audio) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (A) audio = new A();
    }
    return audio;
  }
  /** 只在用户点击时解锁声音：没有手势时调 resume() 不会成功，那个请求会一直挂着。切后台回来声音停了，下一次点击也从这里恢复。 */
  function unlockAudio() {
    const a = ctx();
    if (a && a.state !== 'running' && a.state !== 'closed') a.resume().catch(() => {});
  }
  function tick(freq, dur, gain, type) {
    const a = ctx();
    if (!a || !soundOn || a.state !== 'running') return; // 还没解锁时不排队，否则节点永远放不完也释放不掉
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), a.currentTime + dur);
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur + 0.01);
  }
  function swish(dur, gain, freq) {
    const a = ctx();
    if (!a || !soundOn || a.state !== 'running') return; // 还没解锁时不排队，否则节点永远放不完也释放不掉
    const n = Math.floor(a.sampleRate * dur);
    const b = a.createBuffer(1, n, a.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = a.createBufferSource();
    s.buffer = b;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = a.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(a.destination);
    s.start();
  }
  function sound(name) {
    switch (name) {
      case 'deal': swish(0.05, 0.14, 3600); break;
      case 'clack': swish(0.07, 0.4, 2400); tick(900, 0.04, 0.06); break;
      case 'sweep': swish(0.16, 0.22, 1800); break;
      case 'points': swish(0.14, 0.26, 2000); tick(880, 0.14, 0.09, 'sine'); tick(1320, 0.18, 0.06, 'sine'); break;
      case 'bid': tick(660, 0.2, 0.13, 'sine'); tick(990, 0.26, 0.09, 'sine'); break;
      case 'chance': tick(1175, 0.16, 0.07, 'sine'); tick(1568, 0.2, 0.05, 'sine'); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tick(f, 0.5, 0.15, 'sine'), i * 95)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => setTimeout(() => tick(f, 0.42, 0.13, 'sine'), i * 150)); break;
      case 'fail': tick(180, 0.34, 0.25, 'sawtooth'); break;
      default: break;
    }
  }

  // ---- 提示和记录 ------------------------------------------------------------
  function log(text, big) {
    const li = document.createElement('li');
    li.textContent = text;
    if (big) li.className = 'big';
    const list = $('logList');
    list.appendChild(li);
    while (list.children.length > 200) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
  }

  function setHint(text, warn) {
    const h = $('hint');
    h.hidden = !text;
    if (text) {
      h.textContent = text;
      h.classList.toggle('warn', !!warn);
    }
  }

  function floater(seat, text, cls) {
    const a = scene.project(scene.seatAnchor(seat)) || { x: viewW() / 2, y: viewH() / 2 };
    const el = document.createElement('div');
    el.className = 'float-word ' + (cls || '');
    el.textContent = text;
    el.style.left = Math.max(90, Math.min(viewW() - 90, a.x)) + 'px';
    el.style.top = Math.max(viewH() * 0.2, Math.min(viewH() * 0.58, a.y)) + 'px';
    $('floaters').appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  function miniCard(kind) {
    const i = document.createElement('img');
    i.src = Art.iconUrl(kind);
    i.className = 'mini';
    i.alt = C.name(kind);
    i.title = C.name(kind);
    i.draggable = false;
    return i;
  }

  function trumpText(trump) {
    return trump === null ? '无主' : C.SUIT_NAMES[trump];
  }

  function kindsText(kinds) {
    return kinds.map(C.name).join(' ');
  }

  function refreshHud() {
    if (!state) return;
    for (let s = 0; s < 4; s++) {
      const el = $('plate' + s);
      const tags = [];
      if (state.dealer === s) tags.push('<span class="tag dealer">庄</span>');
      else if (state.dealer !== null && state.dealer !== undefined) {
        const isAttacker = s % 2 !== state.dealer % 2;
        tags.push('<span class="tag ' + (isAttacker ? 'att' : 'def') + '">' + (isAttacker ? '闲' : '庄家方') + '</span>');
      }
      const mate = s === 2 ? '<span class="tag mate">对家</span>' : '';
      const shown = state.bidCard && state.bidCard.seat === s && s !== 0 && state.bidCard.n > 0
        ? '<div class="meta">亮 ' + C.name(state.bidCard.kind) + (state.bidCard.n > 1 ? ' ×' + state.bidCard.n : '') + '</div>' : '';
      el.innerHTML = '<div class="who">' + NAMES[s] + mate + tags.join('') + '</div>' +
        '<div class="meta">手牌 ' + state.counts[s] + ' 张</div>' + shown;
      el.classList.toggle('active', state.turn === s);
    }
    const info = $('roundInfo');
    let html = '<span class="chip">第 ' + session.handNo + ' 局</span>';
    html += '<span class="chip">你们队打 ' + C.rankText(session.levels[0]) + '</span>';
    html += '<span class="chip">对手队打 ' + C.rankText(session.levels[1]) + '</span>';
    if (state.trump !== undefined) {
      html += '<span class="chip warm">本局打 ' + C.rankText(state.level) + ' · ' + trumpText(state.trump) + '</span>';
    }
    info.innerHTML = html;
    const box = $('scoreBox');
    const dealerKnown = state.dealer !== null && state.dealer !== undefined && state.trump !== undefined;
    box.hidden = !dealerKnown;
    if (dealerKnown) {
      $('scoreValue').textContent = String(state.points);
      $('scoreFill').style.width = Math.min(100, Math.max(0, state.points / 2)) + '%';
      const youAttack = state.dealer % 2 === 1;
      $('scoreRole').textContent = (youAttack ? '你们是闲家，已得' : '闲家（对手）已得');
      $('scoreFill').className = youAttack ? 'mine' : 'theirs';
    }
  }

  // ---- 裁判事件 -> 动画 --------------------------------------------------------
  async function onEvent(e) {
    switch (e.type) {
      case 'handStart':
        state = {
          turn: -1, dealer: e.dealer, level: e.level, trump: undefined, points: 0,
          counts: [0, 0, 0, 0], ctx: null,
        };
        scene.keyGroup = (k) => (C.isJoker(k) || C.rankOf(k) === e.level ? -1 : C.suitOf(k));
        scene.sorter = (a, b) => R.sortKeyEarly(a, e.level) - R.sortKeyEarly(b, e.level);
        scene.setConsole({ turn: -1, trump: undefined, level: e.level, points: 0, dealer: e.dealer });
        queuedBid = null;
        bidBarKey = '';
        declinedBids = new Set();
        refreshHud();
        log('第 ' + session.handNo + ' 局开始' + (e.dealer !== null ? '，' + NAMES[e.dealer] + ' 坐庄' : '，先亮主的人坐庄'), true);
        await scene.newHand();
        await sleep(200);
        break;
      case 'deal':
        state.counts[e.seat]++;
        scene.dealCard(e.seat, e.id, e.kind);
        await sleep(DEAL_MS);
        if (e.index % 8 === 0) refreshHud();
        break;
      case 'bid': {
        state.dealer = e.dealer;
        state.bidSeat = e.seat;
        state.bidCard = { seat: e.seat, kind: e.kinds[0], n: e.kinds.length };
        const what = e.suit === null ? '无主（' + kindsText(e.kinds) + '）' : kindsText(e.kinds);
        log(NAMES[e.seat] + ' 亮主：' + what, true);
        floater(e.seat, e.suit === null ? '无主！' : (e.strength >= 2 ? '反主！' : '亮主！'), 'bid');
        scene.setConsole({ trump: e.suit, dealer: e.dealer });
        state.trump = e.suit;
        refreshHud();
        // 亮的牌大家都看得见，之后电脑的这张牌收回手里盖住
        await scene.showBid(e.seat, e.ids, e.kinds);
        if (e.seat !== 0) e.ids.forEach((id) => scene.setKind(id, null));
        break;
      }
      case 'dealDone':
        refreshHud();
        await sleep(160);
        break;
      case 'flip':
        if (state.flipIndex === undefined) state.flipIndex = 0;
        log('没人亮主，翻底牌：' + C.name(e.kind));
        await scene.flipKitty(e.id, e.kind, state.flipIndex++);
        await sleep(240);
        break;
      case 'trumpSet':
        state.dealer = e.dealer;
        state.level = e.level;
        state.trump = e.trump;
        state.ctx = R.makeCtx(e.level, e.trump);
        scene.keyGroup = (k) => state.ctx.cls[k];
        scene.sorter = (a, b) => R.sortKey(a, state.ctx) - R.sortKey(b, state.ctx);
        scene.sortHuman();
        scene.setConsole({ trump: e.trump, level: e.level, dealer: e.dealer });
        refreshHud();
        await Promise.all([0, 1, 2, 3].map((s) => scene.layoutHand(s, 380)));
        log('本局打 ' + C.rankText(e.level) + '，' + trumpText(e.trump) + (e.trump === null ? '' : '为主') + '，' + NAMES[e.dealer] + ' 坐庄', true);
        floater(e.dealer, '坐庄', 'bid');
        await sleep(360);
        break;
      case 'kittyTaken':
        state.counts[e.seat] += e.ids.length;
        refreshHud();
        // 翻开过的底牌庄家拿走后，别人就看不到了
        if (e.seat !== 0) e.ids.forEach((id) => scene.setKind(id, null));
        await scene.takeKitty(e.seat, e.ids, e.kinds);
        log(NAMES[e.seat] + ' 拿走底牌');
        await sleep(200);
        break;
      case 'buried':
        state.counts[e.seat] -= e.ids.length;
        refreshHud();
        await scene.bury(e.seat, e.ids);
        log(NAMES[e.seat] + ' 埋好底牌' + (e.kinds ? '：' + kindsText(e.kinds) : ''));
        await sleep(240);
        break;
      case 'trickStart':
        state.turn = e.leader;
        scene.setConsole({ turn: e.leader });
        refreshHud();
        break;
      case 'throwFailed': {
        floater(e.seat, '甩牌失败！', 'bad');
        sound('fail');
        state.points = e.attackerPoints;
        scene.setConsole({ points: Math.max(0, e.attackerPoints) });
        refreshHud();
        log(NAMES[e.seat] + ' 甩牌失败（' + kindsText(e.triedKinds) + '），' + (e.toAttackers ? '闲家加 ' : '闲家减 ') + e.penalty + ' 分', true);
        await scene.throwFail(e.seat, e.tried, e.triedKinds);
        break;
      }
      case 'play': {
        state.counts[e.seat] -= e.ids.length;
        if (state.bidCard && state.bidCard.seat === e.seat) state.bidCard.n -= e.kinds.filter((k) => k === state.bidCard.kind).length;
        if (e.isThrow) floater(e.seat, '甩！', 'bid');
        const next = (e.seat + 1) % 4;
        await scene.play(e.seat, e.ids, e.kinds);
        log(NAMES[e.seat] + (e.lead ? ' 领 ' : ' 跟 ') + kindsText(e.kinds));
        state.turn = next;
        scene.setConsole({ turn: next });
        refreshHud();
        await sleep(90);
        break;
      }
      case 'trickEnd': {
        state.turn = -1;
        scene.setConsole({ turn: -1 });
        refreshHud();
        log(NAMES[e.winner] + ' 赢这一墩' + (e.points ? '，' + e.points + ' 分' : ''));
        if (e.points > 0) floater(e.winner, (e.toAttackers ? '+' : '守住 ') + e.points + ' 分', e.toAttackers ? 'plus' : 'guard');
        await scene.collect(e.winner, e.ids, e.points, e.toAttackers);
        state.points = e.attackerPoints;
        scene.setConsole({ points: Math.max(0, e.attackerPoints) });
        refreshHud();
        break;
      }
      case 'handEnd':
        await onHandEnd(e.result);
        break;
      default: break;
    }
  }

  async function onHandEnd(result) {
    lastResult = result;
    clearPending();
    state.turn = -1;
    state.points = result.attackerPoints;
    scene.setConsole({ turn: -1, points: result.attackerPoints });
    refreshHud();
    await scene.moveCamera({ eye: [0, 34, 23], at: [0, 0, 2] }, 500);
    await scene.revealKitty(result.kittyIds, result.kittyKinds);
    if (result.kittyBonus > 0) {
      floater(result.lastWinner, '抠底 ' + result.kittyPoints + ' × ' + result.multiplier, 'plus');
      log('闲家抠底：' + result.kittyPoints + ' 分 × ' + result.multiplier + ' = ' + result.kittyBonus + ' 分', true);
    }
    await sleep(700);
    if (result.winnerTeam === 0) scene.celebrate(0);
    else sound('lose');
    await sleep(900);
    showResult(result);
    session.levels = result.levelsAfter.slice();
    session.dealer = result.nextDealer;
  }

  // ---- 玩家操作 --------------------------------------------------------------
  function clearPending() {
    pending = null;
    bidBarKey = '';
    $('actions').hidden = true;
    $('actions').innerHTML = '';
    setHint('');
    if (scene) {
      scene.interactive = false;
      scene.dimFn = null;
      scene.hoverId = null;
      scene.selected = new Set();
    }
  }

  function button(cls, label, handler, disabled) {
    const b = document.createElement('button');
    b.className = 'act ' + cls;
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener('click', () => { unlockAudio(); handler(); });
    return b;
  }

  function bidLabel(o) {
    if (o.strength === 4) return '亮大王对（无主）';
    if (o.strength === 3) return '亮小王对（无主）';
    return (o.strength === 2 ? '亮对 ' : '亮 ') + C.name(o.kinds[0]);
  }

  /**
   * 发牌途中一出现新的亮主或反主机会，就停下来等你选。按了「不亮」的选项之后不再停，
   * 按钮还留着，想亮随时点，下一张牌时生效。发完牌还有最后一次机会。
   */
  function humanChooseBid(view, options, last) {
    const queued = queuedBid && options.find((o) => o.strength === queuedBid.strength && o.suit === queuedBid.suit);
    if (queuedBid && !queued) dropQueuedBid();
    if (queued) {
      queuedBid = null;
      bidBarKey = '';
      $('actions').hidden = true;
      $('actions').innerHTML = '';
      return Promise.resolve({ strength: queued.strength, suit: queued.suit });
    }
    if (!last && !options.some((o) => !declinedBids.has(bidKey(o)))) {
      showBidButtons(options);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      bidBarKey = '';
      pending = { kind: 'bid', resolve };
      const bar = $('actions');
      bar.innerHTML = '';
      for (const o of options) {
        bar.appendChild(button('bid', bidLabel(o), () => {
          const p = pending;
          clearPending();
          if (p) p.resolve({ strength: o.strength, suit: o.suit });
        }));
      }
      bar.appendChild(button('pass', last ? '不亮' : '不亮，继续发牌', () => {
        for (const o of options) declinedBids.add(bidKey(o));
        const p = pending;
        clearPending();
        if (p) p.resolve(null);
      }));
      bar.hidden = false;
      sound('chance');
      if (last) setHint('发牌结束，这是最后的亮主机会');
      else if (view.bid && view.bid.seat !== view.seat) setHint(NAMES[view.bid.seat] + ' 亮了主，你可以反主，选好再继续发牌');
      else setHint('你可以亮主，选好再继续发牌');
    });
  }

  function dropQueuedBid() {
    queuedBid = null;
    floater(0, '亮主慢了一步', 'bad');
  }

  /** 发牌途中亮主的按钮。内容没变就不要重建：手指按下到抬起之间节点换了，这次点击就丢了。 */
  function showBidButtons(options) {
    const bar = $('actions');
    const key = options.map((o) => o.strength + ':' + o.suit).join();
    if (key === bidBarKey) return;
    bidBarKey = key;
    bar.innerHTML = '';
    if (!options.length) {
      bar.hidden = true;
      return;
    }
    for (const o of options) {
      bar.appendChild(button('bid', bidLabel(o), () => {
        queuedBid = { strength: o.strength, suit: o.suit };
        bidBarKey = '';
        bar.innerHTML = '';
        bar.hidden = true;
      }));
    }
    bar.hidden = false;
  }

  /** 这一轮已经没有可亮的了，比如别人亮了更大的。 */
  function humanNoBids() {
    if (queuedBid) dropQueuedBid();
    showBidButtons([]);
  }

  function selectedIds() {
    return [...scene.selected];
  }

  function kindOfId(view, id) {
    return view.hand.find((t) => t.id === id).kind;
  }

  function humanChooseBury(view) {
    return new Promise((resolve) => {
      pending = { kind: 'bury', view, resolve };
      scene.interactive = true;
      scene.selected = new Set();
      const bar = $('actions');
      bar.innerHTML = '';
      const ok = button('play', '埋牌（还差 8 张）', () => {
        const ids = selectedIds();
        if (ids.length !== R.VALUES.kittySize) return;
        const p = pending;
        clearPending();
        if (p) p.resolve(ids);
      }, true);
      ok.id = 'btnConfirm';
      bar.appendChild(ok);
      bar.appendChild(button('tip', '提示', () => {
        scene.selected = new Set(hintAI.chooseBury(view));
        onSelectionChanged();
      }));
      bar.appendChild(button('pass', '清空', () => {
        scene.selected = new Set();
        onSelectionChanged();
      }));
      bar.hidden = false;
      setHint('挑 8 张牌埋到底下（发亮的是刚拿到的底牌），按住滑动可以连选');
    });
  }

  function humanChooseLead(view) {
    return new Promise((resolve) => {
      pending = { kind: 'lead', view, resolve };
      scene.interactive = true;
      scene.selected = new Set();
      playBar(view, null);
      setHint('轮到你领牌：单张、对子、拖拉机都行，也可以甩牌');
    });
  }

  function humanChooseFollow(view, info) {
    return new Promise((resolve) => {
      pending = { kind: 'follow', view, info, resolve };
      scene.interactive = true;
      scene.selected = new Set();
      const ctxNow = R.makeCtx(view.level, view.trump);
      const hand = view.hand.map((t) => t.kind);
      const cls = ctxNow.cls[info.lead[0]];
      const same = hand.filter((k) => ctxNow.cls[k] === cls).length;
      // 手里这门够跟时，其他门的牌变暗
      scene.dimFn = same >= info.lead.length ? (k) => ctxNow.cls[k] !== cls : null;
      playBar(view, info);
      // 只有一种选择时帮玩家选好
      if (same === 0 && info.lead.length === 1) setHint('这门没牌了：垫一张，或者用主牌毙');
      else setHint('跟 ' + info.lead.length + ' 张（领牌：' + kindsText(info.lead) + '）');
    });
  }

  function playBar(view, info) {
    const bar = $('actions');
    bar.innerHTML = '';
    const ok = button('play', '出牌', () => {
      const v = validateSelection();
      if (!v.ok) {
        setHint(v.reason, true);
        return;
      }
      const ids = selectedIds();
      const p = pending;
      clearPending();
      if (p) p.resolve(ids);
    }, true);
    ok.id = 'btnConfirm';
    bar.appendChild(ok);
    bar.appendChild(button('tip', '提示', async () => {
      const owner = pending;
      setHint('正在想……');
      const ids = await think(info ? hintAI.followSteps(view, info) : hintAI.leadSteps(view), 0);
      if (pending !== owner) return; // 算的时候玩家已经出牌了
      scene.selected = new Set(ids);
      onSelectionChanged();
    }));
    bar.appendChild(button('pass', '清空', () => {
      scene.selected = new Set();
      onSelectionChanged();
    }));
    bar.hidden = false;
  }

  function validateSelection() {
    if (!pending) return { ok: false, reason: '' };
    const ids = selectedIds();
    const view = pending.view;
    const ctxNow = R.makeCtx(view.level, view.trump);
    const kinds = ids.map((id) => kindOfId(view, id));
    if (!kinds.length) return { ok: false, reason: '先选牌' };
    if (pending.kind === 'lead') {
      if (!R.sameClass(kinds, ctxNow)) return { ok: false, reason: '一次只能出同一门的牌' };
      return { ok: true, throwing: R.decompose(kinds, ctxNow).length > 1 };
    }
    return R.canFollow(view.hand.map((t) => t.kind), pending.info.lead, kinds, ctxNow);
  }

  function onSelectionChanged() {
    const btn = $('btnConfirm');
    if (!btn || !pending) return;
    if (pending.kind === 'bury') {
      const left = R.VALUES.kittySize - scene.selected.size;
      btn.disabled = left !== 0;
      btn.textContent = left > 0 ? '埋牌（还差 ' + left + ' 张）' : left < 0 ? '多选了 ' + (-left) + ' 张' : '埋牌';
      return;
    }
    const v = validateSelection();
    btn.disabled = !v.ok;
    btn.textContent = v.throwing ? '甩牌' : '出牌';
    if (pending.kind === 'lead' && v.throwing) setHint('甩牌：有人压得住就算失败，罚 10 分', true);
    else if (scene.selected.size && !v.ok) setHint(v.reason, true);
    else if (pending.kind === 'lead') setHint('轮到你领牌：单张、对子、拖拉机都行，也可以甩牌');
    else setHint('跟 ' + pending.info.lead.length + ' 张（领牌：' + kindsText(pending.info.lead) + '）');
  }

  function wireStage() {
    const stage = $('stage');
    stage.addEventListener('pointermove', (ev) => {
      const pt = viewPoint(ev);
      scene.mouse[0] = (pt.x / viewW() - 0.5) * 2;
      scene.mouse[1] = (pt.y / viewH() - 0.5) * 2;
      if (ev.pointerType !== 'mouse' || !scene.interactive) return;
      const id = scene.pick(viewPoint(ev).x, viewPoint(ev).y);
      scene.hoverId = id;
      stage.style.cursor = id !== null ? 'pointer' : 'default';
    });
    stage.addEventListener('pointerleave', () => { scene.hoverId = null; });
    // 按下选中或取消这张，不松手滑过的牌跟着一起：手机上 33 张牌每张只露出 20 多像素，一张张点容易点错
    let sweep = null;
    const sweepOver = (ev) => {
      if (!sweep) return;
      if (!scene.interactive) {
        sweep = null;
        return;
      }
      const id = scene.pick(viewPoint(ev).x, viewPoint(ev).y);
      if (id === null || sweep.seen.has(id)) return;
      sweep.seen.add(id);
      if (sweep.add) scene.selected.add(id);
      else scene.selected.delete(id);
      sound('deal');
      onSelectionChanged();
    };
    stage.addEventListener('pointerdown', (ev) => {
      if (!scene.interactive || ev.button !== 0) return;
      const id = scene.pick(viewPoint(ev).x, viewPoint(ev).y);
      if (id === null) return;
      sweep = { add: !scene.selected.has(id), seen: new Set() };
      stage.setPointerCapture(ev.pointerId); // 滑到按钮上松手也算结束
      sweepOver(ev);
    });
    stage.addEventListener('pointermove', sweepOver);
    stage.addEventListener('pointercancel', () => { sweep = null; });
    stage.addEventListener('pointerup', () => {
      unlockAudio();
      sweep = null;
    });
    stage.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (scene.interactive) {
        scene.selected = new Set();
        onSelectionChanged();
      }
    });
  }

  // ---- 结果 ------------------------------------------------------------------
  function showResult(result) {
    const myTeam = 0;
    const iWon = result.winnerTeam === myTeam;
    const v = $('verdict');
    v.className = 'verdict ' + (iWon ? 'win' : 'lose');
    let tail;
    if (result.dealerHolds) {
      tail = TEAM_NAMES[result.dealerTeam] + '守庄成功，升 ' + result.up + ' 级';
    } else {
      tail = TEAM_NAMES[result.attackers] + '上台' + (result.up > 0 ? '，升 ' + result.up + ' 级' : '');
    }
    v.innerHTML = (iWon ? '你们赢了' : '你们输了') + '<small>' + tail + '</small>';
    sound(iWon ? 'win' : 'lose');

    const body = $('resultBody');
    body.innerHTML = '';
    const rows = document.createElement('table');
    rows.className = 'pay-table';
    const line = (a, b, cls) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + a + '</td><td class="num ' + (cls || '') + '">' + b + '</td>';
      rows.appendChild(tr);
    };
    const attackerName = TEAM_NAMES[result.attackers];
    line('庄家', NAMES[result.dealer] + '（' + TEAM_NAMES[result.dealerTeam] + '）');
    line('本局', '打 ' + C.rankText(result.level) + ' · ' + trumpText(result.trump));
    line(attackerName + '（闲家）赢墩得分', result.trickPoints);
    if (result.kittyBonus > 0) line('抠底：底牌 ' + result.kittyPoints + ' 分 × ' + result.multiplier, '+' + result.kittyBonus);
    else line('底牌 ' + result.kittyPoints + ' 分', result.lastWinner % 2 === result.dealerTeam ? '庄家方赢最后一墩，不计' : '无分');
    if (result.penalties) line('甩牌罚分', (result.penalties > 0 ? '+' : '') + result.penalties);
    line('闲家总分', result.attackerPoints + ' / 80', result.attackerPoints >= 80 ? 'plus' : 'minus');
    line('两队级别', '你们队 ' + C.rankText(result.levelsBefore[0]) + ' → ' + C.rankText(result.levelsAfter[0]) +
      '　对手队 ' + C.rankText(result.levelsBefore[1]) + ' → ' + C.rankText(result.levelsAfter[1]));
    line('下一局庄家', NAMES[result.nextDealer]);
    body.appendChild(rows);

    const kitty = document.createElement('div');
    kitty.className = 'kitty-row';
    const lab = document.createElement('span');
    lab.textContent = '底牌';
    kitty.appendChild(lab);
    result.kittyKinds.forEach((k) => kitty.appendChild(miniCard(k)));
    body.appendChild(kitty);

    if (result.champion !== null) {
      const c = document.createElement('div');
      c.className = 'champion';
      c.textContent = TEAM_NAMES[result.champion] + '打过 A，通关！下一局从 2 重新开始。';
      body.appendChild(c);
    }
    $('resultScreen').hidden = false;
    $('btnBackResult').hidden = true;
    if (result.champion !== null) {
      session.resetNext = true;
    }
    if (AUTO) setTimeout(startHand, 1200);
  }

  // ---- 开局 ------------------------------------------------------------------
  /**
   * 分步跑电脑的推演：连续算超过 8 毫秒就让出主线程渲染一帧，手机上也不会卡住画面。
   * 结果和分成几步无关。算的时间算进「思考时间」，不会让电脑显得更慢。
   */
  async function think(gen, delay) {
    const t0 = performance.now();
    let slice = t0;
    let value;
    for (;;) {
      const r = gen.next();
      if (r.done) {
        value = r.value;
        break;
      }
      if (performance.now() - slice > 8) {
        await new Promise((res) => requestAnimationFrame(res));
        slice = performance.now();
      }
    }
    const spent = (performance.now() - t0) * scene.speed;
    if (spent < delay) await sleep(delay - spent);
    return value;
  }

  function makeAiAdapter(style) {
    const ai = AI.createPlayer(style || {});
    return {
      chooseBid: (v, o, l) => ai.chooseBid(v, o, l),
      async chooseBury(view) {
        await sleep(650);
        return ai.chooseBury(view);
      },
      chooseLead: (view) => think(ai.leadSteps(view), 520),
      chooseFollow: (view, info) => think(ai.followSteps(view, info), 360),
    };
  }

  /** 裁判或电脑出错时不要卡死：告诉玩家，并能开始下一局。 */
  function showCrash(err) {
    console.error(err);
    clearPending();
    const v = $('verdict');
    v.className = 'verdict even';
    v.textContent = '这一局出错了';
    const small = document.createElement('small');
    small.textContent = err && err.message ? err.message : String(err);
    v.appendChild(small);
    $('resultBody').innerHTML = '';
    $('resultScreen').hidden = false;
    $('btnBackResult').hidden = true;
  }

  function startHand() {
    document.documentElement.classList.add('started');
    $('resultScreen').hidden = true;
    $('startScreen').hidden = true;
    $('btnBackResult').hidden = true;
    if (session.resetNext) {
      session.levels = [2, 2];
      session.resetNext = false;
    }
    session.handNo++;
    scene.orbit = null;
    scene.moveCamera(scene.camHome, 900);
    const human = AUTO ? makeAiAdapter({}) : {
      chooseBid: humanChooseBid,
      noBids: humanNoBids,
      chooseBury: humanChooseBury,
      chooseLead: humanChooseLead,
      chooseFollow: humanChooseFollow,
    };
    const adapters = [human, makeAiAdapter(), makeAiAdapter(), makeAiAdapter()];
    const hand = new Game.Hand({
      dealer: session.dealer,
      starter: session.starter,
      levels: session.levels,
      adapters,
      hook: onEvent,
      observer: 0,
    });
    hand.run().catch(showCrash);
  }

  // ---- 横屏 --------------------------------------------------------------------
  // 手机竖着拿时，把整个页面转 90 度画成横屏，不提示用户转手机（iPhone 和微信都不能锁定方向）。
  // CSS 用 --lw/--lh（横屏的宽和高）排版；触摸坐标用 viewPoint() 换成横屏里的坐标。
  const appEl = $('app');
  let rotated = false;
  function applyOrientation() {
    const W = innerWidth;
    const H = innerHeight;
    rotated = matchMedia('(pointer: coarse)').matches && H > W;
    const lw = rotated ? H : W;
    const lh = rotated ? W : H;
    const r = document.documentElement;
    r.classList.toggle('rot', rotated);
    r.style.setProperty('--lw', lw + 'px');
    r.style.setProperty('--lh', lh + 'px');
    r.classList.toggle('compact', lh <= 520); // 原来的 @media (max-height: 520px)
    r.classList.toggle('narrow', lh <= 520 && lw / lh <= 1.9); // 原来的 (max-aspect-ratio: 19/10)
    r.classList.toggle('w860', lw <= 860); // 原来的 @media (max-width: 860px)
  }
  addEventListener('resize', applyOrientation);
  addEventListener('orientationchange', () => {
    applyOrientation();
    setTimeout(applyOrientation, 300); // iOS 先发事件，过一会儿才更新 innerWidth
  });
  applyOrientation();
  const viewW = () => appEl.clientWidth;
  const viewH = () => appEl.clientHeight;
  /** 屏幕上的触摸点 -> 横屏画面里的坐标。 */
  function viewPoint(ev) {
    return rotated ? { x: innerHeight - ev.clientY, y: ev.clientX } : { x: ev.clientX, y: ev.clientY };
  }

  // ---- 全屏横屏 ----------------------------------------------------------------
  // 手机上只能全屏横屏玩：开始键是「全屏开玩」，进不了全屏就不开局。浏览器只允许在点击之后进全屏。
  // iPhone 的 Safari 和微信不让网页全屏：iPhone 要从「添加到主屏幕」的图标打开，微信要换到浏览器打开。
  const fsEl = document.documentElement;
  const canFullscreen = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen) && document.fullscreenEnabled !== false;
  const phone = matchMedia('(pointer: coarse)').matches;
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  const wechat = /MicroMessenger/i.test(navigator.userAgent);
  const ios = /iPhone|iPod|iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mustFullscreen = phone && !standalone; // 从主屏幕图标打开的本来就是全屏
  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function lockLandscape() {
    const o = screen.orientation;
    if (!o || !o.lock) return;
    o.lock('landscape').then(() => fsEl.classList.add('locked'), () => fsEl.classList.remove('locked'));
  }
  /** 进全屏并锁横屏，成功了得到 true。必须在点击里同步调用，否则浏览器不允许。 */
  function enterFullscreen() {
    if (isFullscreen()) {
      lockLandscape();
      return Promise.resolve(true);
    }
    if (!canFullscreen) return Promise.resolve(false);
    let p;
    try {
      p = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl, { navigationUI: 'hide' });
    } catch (e) {
      return Promise.resolve(false);
    }
    return Promise.resolve(p)
      .then(() => new Promise((res) => setTimeout(() => res(isFullscreen()), 150)), () => false)
      .then((ok) => {
        if (ok) lockLandscape();
        return ok;
      });
  }
  function exitFullscreen() {
    const f = document.exitFullscreen || document.webkitExitFullscreen;
    if (f && isFullscreen()) Promise.resolve(f.call(document)).catch(() => {});
  }
  /** 游戏中被返回手势退出了全屏：盖一层「回到全屏继续」，点了才回去（那一下不会被当成出牌）。 */
  function checkFullscreenLost() {
    $('fsResume').hidden = !(mustFullscreen && fsEl.classList.contains('started') && !isFullscreen());
  }
  /** 进不了全屏：告诉用户怎么办，不开局。 */
  function showGuide() {
    const kind = wechat ? 'wechat' : ios ? 'ios' : 'other';
    for (const k of ['wechat', 'ios', 'other']) $('guide-' + k).hidden = k !== kind;
    $('fsGuide').hidden = false;
  }
  function wireFullscreen() {
    const btn = $('btnFull');
    const onChange = () => {
      btn.textContent = isFullscreen() ? '退出全屏' : '全屏';
      if (!isFullscreen()) fsEl.classList.remove('locked');
      checkFullscreenLost();
    };
    btn.hidden = !canFullscreen || phone; // 手机上一直全屏，不给退出按钮
    btn.addEventListener('click', () => {
      if (isFullscreen()) exitFullscreen();
      else enterFullscreen();
    });
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    $('btnFsResume').addEventListener('click', () => {
      unlockAudio();
      enterFullscreen().then(checkFullscreenLost);
    });
    onChange();
    fsEl.classList.toggle('phone', phone);
    if (mustFullscreen) $('btnStart').textContent = '全屏开玩';
    $('btnGuideBack').addEventListener('click', () => { $('fsGuide').hidden = true; });
  }

  /** 开始键：手机上先进全屏横屏，进不了就不开局。 */
  function onStartClick() {
    unlockAudio();
    if (!mustFullscreen) {
      startHand();
      return;
    }
    enterFullscreen().then((ok) => {
      if (ok) startHand();
      else showGuide();
    });
  }

  function wireButtons() {
    $('btnStart').addEventListener('click', onStartClick);
    $('btnNext').addEventListener('click', () => { unlockAudio(); startHand(); });
    $('btnStartRules').addEventListener('click', () => { $('rulesScreen').hidden = false; });
    $('btnRules').addEventListener('click', () => { $('rulesScreen').hidden = false; });
    $('btnRulesClose').addEventListener('click', () => { $('rulesScreen').hidden = true; });
    $('rulesScreen').addEventListener('click', (e) => {
      if (e.target === $('rulesScreen')) $('rulesScreen').hidden = true;
    });
    $('btnLog').addEventListener('click', () => { $('logPanel').hidden = !$('logPanel').hidden; });
    $('btnSound').addEventListener('click', () => {
      soundOn = !soundOn;
      $('btnSound').innerHTML = '<span class="lbl">声音：</span>' + (soundOn ? '开' : '关');
    });
    $('btnViewTable').addEventListener('click', () => {
      $('resultScreen').hidden = true;
      $('btnBackResult').hidden = false;
    });
    $('btnBackResult').addEventListener('click', () => {
      $('resultScreen').hidden = false;
      $('btnBackResult').hidden = true;
    });
  }

  function boot() {
    try {
      scene = new Scene($('stage'));
    } catch (e) {
      console.error(e);
      $('startScreen').hidden = true;
      $('noWebgl').hidden = false;
      return;
    }
    scene.onSound = sound;
    scene.speed = Number(params.get('speed')) || PACE;
    wireStage();
    wireButtons();
    wireFullscreen();
    if (AUTO) startHand();
    else {
      scene.orbit = 0.4;
      scene.newHand();
    }
    root.__tjDebug = {
      get lastResult() { return lastResult; },
      get scene() { return scene; },
      get pendingKind() { return pending ? pending.kind : null; },
      get pending() { return pending; },
    };
  }

  boot();
})(typeof self !== 'undefined' ? self : globalThis);

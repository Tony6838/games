/* 界面：把裁判的事件变成动画，把玩家的点击变成动作。
 * 界面收到的信息和其他玩家一样，只有自己的牌和公开信息。 */
(function (root) {
  'use strict';
  const { Tiles: T, Rules: R, Game, AI, Art, Scene } = root.MJ;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const AUTO = params.get('auto') === '1'; // 测试用：你的座位也交给电脑
  // 动画和电脑出牌的节奏只有一种。原来有标准/快/慢三档，试玩下来「慢」正合真人的速度。
  // 测试工具用 ?speed= 加快。
  const PACE = 0.7;
  const NAMES = ['沈强', '王雷', '徐涌', '吴忠'];
  const WIND = ['东', '南', '西', '北'];
  // 三位电脑用同一个大脑，只在冒险程度上略有不同
  const STYLES = [null, { defense: 0.85 }, { defense: 1 }, { defense: 1.2 }];

  let scene = null;
  let session = { dealer: T.secureInt(4), huangfan: 0, handNo: 0 };
  let state = null;
  let pending = null; // 正在等玩家操作：{ kind, view, opts, resolve }
  let soundOn = true;
  let lastResult = null;

  const sleep = (ms) => scene.wait(ms);

  // ---- 声音（用 WebAudio 现场合成，不需要音频文件）------------------------------
  let audio = null;
  function ctx() {
    if (!audio) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (C) audio = new C();
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
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.45), a.currentTime + dur);
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur + 0.01);
  }
  function noise(dur, gain, freq) {
    const a = ctx();
    if (!a || !soundOn || a.state !== 'running') return; // 还没解锁时不排队，否则节点永远放不完也释放不掉
    const n = Math.floor(a.sampleRate * dur);
    const b = a.createBuffer(1, n, a.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const s = a.createBufferSource();
    s.buffer = b;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.1;
    const g = a.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(a.destination);
    s.start();
  }
  function sound(name) {
    switch (name) {
      case 'clack': noise(0.08, 0.5, 2500); tick(1650, 0.05, 0.1); break;
      case 'dice': noise(0.05, 0.3, 3400); break;
      case 'flower': tick(990, 0.2, 0.09, 'sine'); tick(1480, 0.25, 0.06, 'sine'); break;
      case 'call': tick(520, 0.16, 0.16); noise(0.09, 0.4, 1700); break;
      case 'kong': tick(240, 0.32, 0.25); noise(0.14, 0.6, 1100); break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tick(f, 0.5, 0.15, 'sine'), i * 95));
        break;
      case 'lose': [392, 330, 262].forEach((f, i) => setTimeout(() => tick(f, 0.42, 0.13, 'sine'), i * 150)); break;
      default: break;
    }
  }

  // ---- 记录与提示 ------------------------------------------------------------
  function log(text, big) {
    const li = document.createElement('li');
    li.textContent = text;
    if (big) li.className = 'big';
    const list = $('logList');
    list.appendChild(li);
    while (list.children.length > 160) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
  }

  function callWord(seat, word, cls) {
    const anchor = scene.project(scene.tileAnchor(seat)) || { x: viewW() / 2, y: viewH() / 2 };
    const el = document.createElement('div');
    el.className = 'call-word ' + (cls || '');
    el.textContent = word;
    const x = Math.max(90, Math.min(viewW() - 90, anchor.x));
    const y = Math.max(viewH() * 0.22, Math.min(viewH() * 0.62, anchor.y - 40));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    $('callout').appendChild(el);
    setTimeout(() => el.remove(), 2100);
  }

  function setHint(text) {
    const h = $('hint');
    h.hidden = !text;
    if (text) h.textContent = text;
  }

  function img(kind, cls) {
    const i = document.createElement('img');
    i.src = Art.iconUrl(kind);
    i.className = cls || 'mini';
    i.alt = T.name(kind);
    i.title = T.name(kind);
    i.draggable = false;
    return i;
  }

  function refreshPlates() {
    if (!state) return;
    for (let s = 0; s < 4; s++) {
      const p = state.pub[s];
      const el = $('plate' + s);
      const tags = [];
      if (s === session.dealer) tags.push('<span class="tag dealer">庄</span>');
      tags.push('<span class="tag wind">' + WIND[(s - session.dealer + 4) % 4] + '</span>');
      const partners = [];
      for (let o = 0; o < 4; o++) {
        if (o !== s && R.isSankou(state.calls, s, o)) partners.push(NAMES[o]);
      }
      const sk = partners.length ? '<span class="tag sankou" title="和 ' + partners.join('、') + ' 成三口">三口</span>' : '';
      el.innerHTML = '<div class="who">' + NAMES[s] + tags.join('') + sk + '</div>' +
        '<div class="meta">花 ' + p.flowers + ' 张<span class="dis"> · 打出 ' + p.discards + ' 张</span></div>';
      el.classList.toggle('active', state.turn === s);
    }
    const info = $('roundInfo');
    const chips = ['第 ' + session.handNo + ' 局', '牌墙 ' + state.remaining + ' 张'];
    let html = chips.map((c) => '<span class="chip">' + c + '</span>').join('');
    if (state.kaibao) html += '<span class="chip warm">开宝 ×2</span>';
    if (state.huangfan) html += '<span class="chip warm">荒番 ×2</span>';
    info.innerHTML = html;
  }

  // ---- 裁判事件 -> 动画 --------------------------------------------------------
  async function onEvent(e) {
    switch (e.type) {
      case 'handStart': {
        state = {
          turn: -1,
          remaining: e.remaining,
          kaibao: e.kaibao,
          huangfan: e.huangfan,
          pub: [0, 1, 2, 3].map(() => ({ flowers: 0, discards: 0 })),
          calls: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        };
        scene.setConsole({ turn: -1, remaining: 144, dealer: e.dealer });
        refreshPlates();
        log('第 ' + session.handNo + ' 局开始，' + NAMES[e.dealer] + ' 坐庄', true);
        await scene.newHand(e.dealer, e.dice);
        await scene.rollDice(e.dice[0], e.dice[1]);
        log('骰子 ' + e.dice[0] + ' + ' + e.dice[1] + (e.kaibao ? '，开宝！本局翻倍' : ''));
        if (e.kaibao) callWord(e.dealer, '开宝', '');
        await sleep(280);
        break;
      }
      case 'deal':
        state.remaining = e.remaining;
        await scene.dealTiles(e.seat, e.ids, e.kinds);
        scene.setConsole({ remaining: e.remaining });
        refreshPlates();
        if (Math.random() < 0.5) sound('clack');
        break;
      case 'dealDone':
        await sleep(160);
        await scene.sortHuman(true);
        for (let s = 1; s < 4; s++) scene.layout(s, 220);
        break;
      case 'handReady':
        scene.seats.forEach((S, s) => {
          if (S.drawn !== null) {
            S.hand.push(S.drawn);
            S.drawn = null;
          }
          if (s === 0) S.hand.sort((a, b) => scene.tiles[a].kind - scene.tiles[b].kind || a - b);
        });
        // 开打前剩下的牌墙往中间收拢：牌少了一半，可以离中控台近些，牌也不用小
        await Promise.all([0, 1, 2, 3].map((s) => scene.layout(s, 240)).concat([scene.compactWall()]));
        break;
      case 'draw':
        state.remaining = e.remaining;
        scene.setConsole({ remaining: e.remaining });
        refreshPlates();
        await scene.drawTile(e.seat, e.id, e.kind);
        break;
      case 'flower':
        state.pub[e.seat].flowers = e.count;
        await scene.flower(e.seat, e.id, e.kind);
        log(NAMES[e.seat] + ' 补花 ' + T.name(e.kind));
        refreshPlates();
        break;
      case 'turn':
        state.turn = e.seat;
        scene.setConsole({ turn: e.seat, remaining: e.remaining });
        refreshPlates();
        break;
      case 'discard':
        state.pub[e.seat].discards++;
        await scene.discard(e.seat, e.id, e.kind);
        log(NAMES[e.seat] + ' 打 ' + T.name(e.kind));
        refreshPlates();
        await sleep(e.seat === 0 ? 120 : 220);
        break;
      case 'kongAttempt':
        log(NAMES[e.seat] + ' 想加杠 ' + T.name(e.kind));
        await scene.kongAttempt(e.seat, e.id, e.kind);
        await sleep(350);
        break;
      case 'meld': {
        const word = e.mtype === 'chi' ? '吃' : e.mtype === 'peng' ? '碰' : e.sub === 'an' ? '暗杠' : '杠';
        if (e.from !== e.seat) state.calls[e.seat][e.from]++;
        if (e.from !== e.seat && e.claimedId !== null && !e.upgrade) state.pub[e.from].discards--;
        callWord(e.seat, word, '');
        sound(e.mtype === 'gang' ? 'kong' : 'call');
        await scene.meld(e);
        const what = e.kinds ? e.kinds.map(T.name).join(' ') : '（暗）';
        log(NAMES[e.seat] + ' ' + word + (e.sub === 'an' && !e.kinds ? '' : ' ' + what));
        refreshPlates();
        await sleep(240);
        break;
      }
      case 'sankou':
        log(NAMES[e.a] + ' 和 ' + NAMES[e.b] + ' 成三口（包牌）', true);
        break;
      case 'handEnd':
        await onHandEnd(e.result);
        break;
      default: break;
    }
  }

  async function onHandEnd(result) {
    state.turn = -1;
    lastResult = result;
    clearPending();
    refreshPlates();
    if (result.type === 'draw') {
      log('牌墙摸完，流局', true);
      callWord(0, '流局', '');
      await sleep(600);
      await scene.revealAll(result);
      sound('lose');
    } else {
      for (const w of result.winners) {
        callWord(w.seat, w.how === 'zimo' ? '自摸' : '胡', 'hu');
        log(NAMES[w.seat] + ' 胡牌：' + w.score.patterns.join(' '), true);
      }
      await sleep(420);
      await scene.revealAll(result);
      await sleep(1000);
    }
    await sleep(800);
    showResult(result);
    session.dealer = result.nextDealer;
    session.huangfan = result.nextHuangfan;
  }

  // ---- 玩家操作 --------------------------------------------------------------
  function clearPending() {
    pending = null;
    $('actions').hidden = true;
    $('actions').innerHTML = '';
    $('waitsPanel').hidden = true;
    setHint('');
    if (scene) {
      scene.interactive = false;
      scene.forbidKind = null;
      scene.hoverId = null;
      scene.selectedId = null;
    }
  }

  function actionButton(cls, label, sub, handler, tiles) {
    const b = document.createElement('button');
    b.className = 'act ' + cls;
    b.append(label);
    if (tiles) tiles.forEach((k) => b.appendChild(img(k)));
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      b.appendChild(s);
    }
    b.addEventListener('click', () => { unlockAudio(); handler(); });
    return b;
  }

  function huLabel(preview) {
    return preview.patterns.join('·') + ' ' + preview.points + ' 点';
  }

  function humanChooseTurn(view, opts) {
    return new Promise((resolve) => {
      pending = { kind: 'turn', view, opts, resolve };
      scene.interactive = true;
      scene.forbidKind = opts.forbid;
      const bar = $('actions');
      bar.innerHTML = '';
      if (opts.canHu) {
        bar.appendChild(actionButton('hu', '胡', huLabel(opts.preview), () => finishTurn({ type: 'hu' })));
      }
      for (const g of opts.gangs) {
        bar.appendChild(actionButton('gang', g.sub === 'an' ? '暗杠' : '加杠', '', () => finishTurn({ type: 'gang', kind: g.kind, sub: g.sub }), [g.kind]));
      }
      bar.hidden = bar.children.length === 0;
      setHint(opts.forbid !== null ? '点一张牌打出（刚吃的 ' + T.name(opts.forbid) + ' 不能打）' : '点一张牌打出');
      $('waitsPanel').hidden = true;
    });
  }

  function finishTurn(act) {
    const p = pending;
    clearPending();
    if (p) p.resolve(act);
  }

  function humanChooseClaim(view, claim) {
    return new Promise((resolve) => {
      pending = { kind: 'claim', view, claim, resolve };
      const bar = $('actions');
      bar.innerHTML = '';
      const o = claim.options;
      const finish = (act) => {
        const p = pending;
        clearPending();
        if (p) p.resolve(act);
      };
      if (o.hu) bar.appendChild(actionButton('hu', '胡', huLabel(o.preview), () => finish({ type: 'hu' })));
      if (o.gang) bar.appendChild(actionButton('gang', '杠', '', () => finish({ type: 'gang' }), [claim.kind]));
      if (o.peng) bar.appendChild(actionButton('peng', '碰', '', () => finish({ type: 'peng' }), [claim.kind]));
      for (const pair of o.chi) {
        bar.appendChild(actionButton('chi', '吃', '', () => finish({ type: 'chi', chi: pair }), [pair[0], claim.kind, pair[1]].sort((a, b) => a - b)));
      }
      // 上家打的牌不要，接下来就轮到你摸牌：按钮叫「抓牌」；别家打的牌放过并不轮到你，叫「过」
      const drawNext = (claim.from + 1) % 4 === view.seat && view.wallRemaining > 0;
      bar.appendChild(actionButton('pass', drawNext ? '抓牌' : '过', '', () => finish({ type: 'pass' })));
      bar.hidden = false;
      setHint(NAMES[claim.from] + ' 打出 ' + T.name(claim.kind));
    });
  }

  function humanChooseRob(view, info) {
    return new Promise((resolve) => {
      pending = { kind: 'rob', view, info, resolve };
      const bar = $('actions');
      bar.innerHTML = '';
      const finish = (act) => {
        const p = pending;
        clearPending();
        if (p) p.resolve(act);
      };
      bar.appendChild(actionButton('hu', '拉杠胡', huLabel(info.preview) + ' ×3', () => finish({ type: 'hu' }), [info.kind]));
      bar.appendChild(actionButton('pass', '过', '', () => finish({ type: 'pass' })));
      bar.hidden = false;
      setHint(NAMES[info.from] + ' 在加杠 ' + T.name(info.kind) + '，可以拉杠胡');
    });
  }

  // 听牌提示：只用自己的手牌和桌面上看得见的牌来数还剩几张。
  function visibleCounts(view) {
    const seen = new Array(34).fill(0);
    for (const t of view.hand) seen[t.kind]++;
    for (const p of view.players) {
      for (const k of p.discards) seen[k]++;
      for (const m of p.melds) if (m.kinds) for (const k of m.kinds) seen[k]++;
    }
    return seen;
  }

  function renderWaits(title, waits, seen) {
    const panel = $('waitsPanel');
    if (!waits.length) {
      panel.hidden = true;
      return;
    }
    panel.innerHTML = '';
    const lab = document.createElement('span');
    lab.textContent = title;
    panel.appendChild(lab);
    for (const k of waits) {
      const wrap = document.createElement('div');
      wrap.className = 'wait';
      wrap.appendChild(img(k));
      wrap.append(Math.max(0, 4 - seen[k]) + ' 张');
      panel.appendChild(wrap);
    }
    panel.hidden = false;
  }

  function showWaitsIfDiscard(id) {
    if (!pending || pending.kind !== 'turn') return;
    const view = pending.view;
    const me = view.players[view.seat];
    const c = R.toCounts(view.hand.map((t) => t.kind));
    const tile = view.hand.find((t) => t.id === id);
    if (!tile) { $('waitsPanel').hidden = true; return; }
    c[tile.kind]--;
    const w = R.waits(c, me.melds);
    renderWaits('打 ' + T.name(tile.kind) + ' 听：', w, visibleCounts(view));
  }

  function tryDiscard(id) {
    if (!pending || pending.kind !== 'turn') return;
    const tile = pending.view.hand.find((t) => t.id === id);
    if (!tile) return;
    if (pending.opts.forbid !== null && tile.kind === pending.opts.forbid) {
      setHint('刚吃的 ' + T.name(tile.kind) + ' 不能马上打出');
      return;
    }
    finishTurn({ type: 'discard', id });
  }

  function wireStage() {
    const stage = $('stage');
    stage.addEventListener('pointermove', (ev) => {
      const pt = viewPoint(ev);
      scene.mouse[0] = (pt.x / viewW() - 0.5) * 2;
      scene.mouse[1] = (pt.y / viewH() - 0.5) * 2;
      if (ev.pointerType !== 'mouse' || !scene.interactive) return;
      const id = scene.pick(viewPoint(ev).x, viewPoint(ev).y);
      if (id !== scene.hoverId) {
        scene.hoverId = id;
        if (id !== null) {
          sound('dice');
          showWaitsIfDiscard(id);
        } else if (pending) {
          $('waitsPanel').hidden = true;
        }
      }
      stage.style.cursor = id !== null ? 'pointer' : 'default';
    });
    stage.addEventListener('pointerleave', () => { scene.hoverId = null; });
    stage.addEventListener('pointerup', (ev) => {
      unlockAudio();
      if (!scene.interactive) return;
      const id = scene.pick(viewPoint(ev).x, viewPoint(ev).y);
      if (id === null) {
        scene.selectedId = null;
        return;
      }
      if (ev.pointerType === 'mouse' || scene.selectedId === id) {
        tryDiscard(id);
      } else {
        // 触摸屏：第一下抬起并显示听牌提示，第二下才打出
        scene.selectedId = id;
        showWaitsIfDiscard(id);
      }
    });
  }

  // ---- 结果 ------------------------------------------------------------------
  const HOW = { zimo: '自摸', ron: '点炮胡', rob: '拉杠胡', qizhuoyi: '七捉一' };

  function showResult(result) {
    const me = result.deltas[0];
    const v = $('verdict');
    v.className = 'verdict ' + (me > 0 ? 'win' : me < 0 ? 'lose' : 'even');
    let line;
    let sub = '';
    if (result.type === 'draw') {
      line = '流局';
      sub = '牌墙摸完，本局无输赢。下一局荒番 ×2。';
    } else if (me > 0) {
      line = '你赢了 +' + me + ' 点';
    } else if (me < 0) {
      line = '你输了 ' + me + ' 点';
    } else {
      line = '本局不输不赢';
      sub = result.winners.map((w) => NAMES[w.seat]).join('、') + ' 胡牌，这局你不用付。';
    }
    v.innerHTML = line + (sub ? '<small>' + sub + '</small>' : '');
    sound(me > 0 ? 'win' : me < 0 ? 'lose' : 'clack');

    const body = $('resultBody');
    body.innerHTML = '';
    for (const w of result.winners) body.appendChild(winnerBlock(w, result));
    body.appendChild(payTable(result));
    $('resultScreen').hidden = false;
    $('btnBackResult').hidden = true;
    if (AUTO) setTimeout(startHand, 1200);
  }

  function winnerBlock(w, result) {
    const box = document.createElement('div');
    box.className = 'win-block';
    const head = document.createElement('div');
    head.className = 'win-head';
    const from = w.from !== null && w.from !== undefined && w.how !== 'zimo'
      ? (w.how === 'qizhuoyi' ? NAMES[w.from] + ' 付' : NAMES[w.from] + (w.how === 'rob' ? ' 被拉杠' : ' 放炮'))
      : '';
    head.innerHTML = '<span>' + NAMES[w.seat] + '</span><span class="how">' + HOW[w.how] + (from ? ' · ' + from : '') + '</span>' +
      '<span class="pts">牌面 ' + w.score.points + ' 点</span>';
    box.appendChild(head);

    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const p of w.score.patterns) {
      const s = document.createElement('span');
      s.textContent = p;
      chips.appendChild(s);
    }
    box.appendChild(chips);

    const seat = result.seats[w.seat];
    const row = document.createElement('div');
    row.className = 'tile-row';
    for (const m of seat.melds) {
      m.kinds.forEach((k) => row.appendChild(img(k)));
      const g = document.createElement('span');
      g.className = 'gap';
      row.appendChild(g);
    }
    if (w.how === 'zimo') {
      // 自摸时胡的那张已经在手牌里，单独放到最后
      const rest = seat.hand.filter((h) => h.id !== w.winId);
      rest.forEach((h) => row.appendChild(img(h.kind)));
    } else {
      seat.hand.forEach((h) => row.appendChild(img(h.kind)));
    }
    if (w.winKind !== null && w.winKind !== undefined) {
      const g = document.createElement('span');
      g.className = 'gap';
      row.appendChild(g);
      row.appendChild(img(w.winKind, 'mini winning'));
    }
    if (seat.flowers.length) {
      const g = document.createElement('span');
      g.className = 'gap';
      row.appendChild(g);
      const lab = document.createElement('span');
      lab.className = 'label';
      lab.textContent = '花';
      row.appendChild(lab);
      seat.flowers.forEach((k) => row.appendChild(img(k)));
    }
    box.appendChild(row);

    const list = document.createElement('ul');
    list.className = 'detail';
    if (w.score.flowers.items.length) {
      const li = document.createElement('li');
      li.textContent = '花：' + w.score.flowers.items.map((f) => f.label + ' +' + f.n).join('，') + ' = ' + w.score.flowers.total + ' 花';
      list.appendChild(li);
    }
    for (const s of w.score.steps) {
      const li = document.createElement('li');
      li.textContent = s;
      list.appendChild(li);
    }
    box.appendChild(list);
    return box;
  }

  function payTable(result) {
    const t = document.createElement('table');
    t.className = 'pay-table';
    t.innerHTML = '<tr><th>玩家</th><th>本局明细</th><th style="text-align:right">输赢</th></tr>';
    for (let s = 0; s < 4; s++) {
      const notes = result.payments
        .filter((p) => p.from === s || p.to === s)
        .map((p) => (p.to === s ? '收 ' + NAMES[p.from] + ' ' + p.amount : '付 ' + NAMES[p.to] + ' ' + p.amount) + '（' + p.note + '）');
      const d = result.deltas[s];
      const tr = document.createElement('tr');
      if (s === 0) tr.className = 'me';
      const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : '';
      tr.innerHTML = '<td>' + NAMES[s] + '</td><td>' + (notes.join('；') || '—') + '</td>' +
        '<td class="num ' + cls + '">' + (d > 0 ? '+' : '') + d + '</td>';
      t.appendChild(tr);
    }
    return t;
  }

  // ---- 开局 ------------------------------------------------------------------
  function makeAiAdapter(style) {
    const ai = AI.createPlayer(style || {});
    return {
      async chooseTurn(view, opts) {
        await sleep(420 + (opts.canHu ? 220 : 0));
        return ai.chooseTurn(view, opts);
      },
      // 响应别人打牌时不加延迟，否则「想了一下」本身就泄露了手里有能吃碰的牌
      chooseClaim: (view, claim) => ai.chooseClaim(view, claim),
      chooseRob: (view, info) => ai.chooseRob(view, info),
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
    $('waitsPanel').hidden = true;
    $('resultScreen').hidden = false;
    $('btnBackResult').hidden = true;
  }

  function startHand() {
    document.documentElement.classList.add('started');
    $('resultScreen').hidden = true;
    $('startScreen').hidden = true;
    $('btnBackResult').hidden = true;
    session.handNo++;
    scene.orbit = null;
    scene.moveCamera(scene.camHome, 900);
    const human = AUTO ? makeAiAdapter({}) : {
      chooseTurn: humanChooseTurn,
      chooseClaim: humanChooseClaim,
      chooseRob: humanChooseRob,
    };
    const adapters = [human, makeAiAdapter(STYLES[1]), makeAiAdapter(STYLES[2]), makeAiAdapter(STYLES[3])];
    const hand = new Game.Hand({
      dealer: session.dealer,
      huangfan: session.huangfan,
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
  /** 游戏中被返回手势退出了全屏：盖一层「回到全屏继续」，点了才回去（那一下不会被当成打牌）。 */
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
    $('btnSwitch').addEventListener('click', () => switchGame('../Tractor/'));
    $('btnQuit').addEventListener('click', quitGame);
  }

  // ---- 结束、换游戏 --------------------------------------------------------------
  // 换页都用 replace，不往历史里加页：返回键不会回到打完的这一局，「结束」也还能关掉网页。
  /** 同一网站里另一页的地址。双击 index.html 打开（file:）时，目录不会自己打开 index.html，要写出来。 */
  function pageUrl(dir) {
    return dir + (location.protocol === 'file:' ? 'index.html' : '');
  }
  function switchGame(dir) {
    location.replace(pageUrl(dir));
  }
  /**
   * 「结束」：关掉网页。浏览器只允许网页关掉只打开过这一页的标签页（从桌面快捷方式打开的就是）
   * 或从桌面图标打开的应用；肯关的话 window.closed 马上变成 true。
   * 标签页里原来就有别的网页时浏览器不让关，就回到主菜单（网站首页）。
   */
  function quitGame() {
    window.close();
    if (!window.closed) location.replace(pageUrl('../'));
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
      // 开始画面：牌墙升起，镜头缓慢环绕牌桌
      scene.orbit = 0.35;
      scene.newHand(0, [3, 4]);
    }
    // 只暴露给自动化测试看的状态，里面没有隐藏信息
    root.__mjDebug = { get lastResult() { return lastResult; }, get scene() { return scene; }, get pendingKind() { return pending ? pending.kind : null; }, get pending() { return pending; } };
  }

  boot();
})(typeof self !== 'undefined' ? self : globalThis);

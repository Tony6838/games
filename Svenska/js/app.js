/* 界面：话题 → 文章列表 → 文章；朗读高亮、查词弹出框、全文翻译、设置。 */
(function () {
  'use strict';
  const SV = window.SV;
  const { h } = SV;
  const $ = (sel) => document.querySelector(sel);

  // ---------- 设置 ----------
  const SET_KEY = 'sv.settings.v1';
  const DEFAULTS = { scale: 1, rate: 0.9, gender: 'f', voiceURI: '', online: null, tip: true, topic: 'idag' };
  const S = Object.assign({}, DEFAULTS, SV.store.get(SET_KEY, {}));
  delete S.level; // 旧版本的「简易优先」设置，不再用
  S.scale = SV.clamp(+S.scale || 1, 0.8, 1.8);
  S.rate = SV.clamp(+S.rate || 0.9, 0.5, 1.3);
  if (!['f', 'm'].includes(S.gender)) S.gender = 'f';
  if (S.online !== true && S.online !== false) S.online = null;
  const save = () => SV.store.set(SET_KEY, S);

  const TOPICS = SV.sources.TOPICS;
  const BATCH = 9; // 一批几篇
  const els = {
    topics: $('#topics'), list: $('#list'), article: $('#article'), main: $('#main'), notice: $('#notice'), tip: $('#tip'),
    popup: $('#popup'), toast: $('#toast'), player: $('#player'),
    play: $('#btnPlay'), rate: $('#btnRate'), voice: $('#btnVoice'), translate: $('#btnTranslate'), next: $('#btnNext'),
  };

  // view：'loading' | 'list' | 'article' | 'message'
  const cur = {
    topic: null, view: 'loading', batch: [], notices: [], more: false, batchNo: 0,
    listZh: false, listTranslating: false, listScroll: 0,
    item: null, model: null, translating: false, zhShown: true,
  };
  let loadToken = 0;
  let loading = false;
  let wantArticle = new URLSearchParams(location.search).get('a') || '';

  // ---------- 提示条 ----------
  let toastTimer = 0;
  function toast(msg, ms = 3800) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
  }

  // ---------- 朗读 ----------
  let voiceInfo = { voice: null, gender: '?', exact: false };
  const reader = new SV.speech.Reader({
    sentences: () => (cur.view === 'article' && cur.model ? cur.model.sentences : []),
    voice: () => voiceInfo.voice,
    rate: () => S.rate,
    onState: (st) => {
      document.body.classList.toggle('speaking', st === 'speaking');
      document.body.classList.toggle('paused', st === 'paused');
      updateButtons();
    },
    onPosition: (si, wi, byWord) => highlight(si, wi, byWord),
    onError: (msg) => toast(msg),
  });

  function refreshVoice() {
    voiceInfo = SV.speech.pickVoice({ gender: S.gender, voiceURI: S.voiceURI });
    const g = voiceInfo.voice ? voiceInfo.gender : S.gender;
    els.voice.querySelector('b').textContent = g === 'm' ? '男' : g === 'f' ? '女' : '声';
    els.voice.querySelector('.lbl').textContent = g === 'm' ? '男声' : g === 'f' ? '女声' : '声音';
    els.voice.title = voiceInfo.voice ? '现在的声音：' + voiceInfo.voice.name + '（点一下切换男声、女声）' : '这台设备没有瑞典语声音';
  }

  let hlS = null;
  let hlW = null;
  function highlight(si, wi, byWord) {
    const m = cur.model;
    const s = m && si >= 0 ? m.sentences[si] : null;
    if (hlS && (!s || hlS !== s.el)) hlS.classList.remove('reading');
    if (hlW) hlW.classList.remove('current');
    hlS = null;
    hlW = null;
    if (!s) return;
    s.el.classList.add('reading');
    hlS = s.el;
    const w = wi >= 0 ? s.words[wi] : null;
    if (w && (byWord || reader.wordEvents)) {
      w.el.classList.add('current');
      hlW = w.el;
    }
    ensureVisible(hlW || s.el);
  }

  let lastUserScroll = 0;
  ['wheel', 'touchmove'].forEach((ev) => window.addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true }));
  function visibleBand() {
    const top = els.topics.getBoundingClientRect().bottom + 10;
    const bottom = els.player.getBoundingClientRect().top - 10;
    return { top, bottom };
  }
  function ensureVisible(el) {
    if (Date.now() - lastUserScroll < 2500) return;
    const r = el.getBoundingClientRect();
    const band = visibleBand();
    if (r.top >= band.top && r.bottom <= band.bottom) return;
    const target = window.scrollY + r.top - (band.top + (band.bottom - band.top) * 0.3);
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  function startReading() {
    if (cur.view !== 'article' || !cur.model) return;
    if (!SV.speech.supported) { toast('这个浏览器不支持朗读'); return; }
    if (reader.state === 'idle' && !SV.speech.voices().length) {
      toast('这台设备上没有瑞典语声音，发音可能不对。用 Edge 浏览器可以用微软的瑞典语声音，详见「设置」。', 6000);
    }
    hidePopup();
    reader.toggle();
  }

  // ---------- 播放栏的按钮随页面变 ----------
  function updateButtons(progress) {
    const inArticle = cur.view === 'article' && !!cur.model;
    const inList = cur.view === 'list';
    // 朗读
    const st = reader.state;
    const playLbl = st === 'speaking' ? '暂停' : st === 'paused' ? '继续' : '朗读';
    els.play.querySelector('.lbl').textContent = playLbl;
    els.play.setAttribute('aria-label', playLbl);
    els.play.disabled = !inArticle;
    els.play.title = inArticle ? '朗读这篇文章（空格键也可以）' : '先在列表里选一篇文章';
    // 翻译
    const tl = els.translate.querySelector('.lbl');
    els.translate.disabled = !(inArticle || inList);
    if (inList) {
      els.translate.title = '把列表里的标题翻译成中文';
      els.translate.classList.toggle('on', cur.listZh);
      tl.textContent = cur.listTranslating ? (progress != null ? `翻译中 ${progress}%` : '翻译中…') : cur.listZh ? '隐藏译文' : '翻译标题';
    } else {
      els.translate.title = '把整篇文章翻译成中文';
      const blocks = inArticle ? cur.model.blocks : [];
      const done = blocks.filter((x) => x.zhEl).length;
      els.translate.classList.toggle('on', done > 0 && cur.zhShown);
      if (cur.translating) tl.textContent = progress != null ? `翻译中 ${progress}%` : '翻译中…';
      else if (!done) tl.textContent = '全文翻译';
      else if (done < blocks.length) tl.textContent = '继续翻译';
      else tl.textContent = cur.zhShown ? '隐藏译文' : '显示译文';
    }
    // 下一篇 / 换一批
    els.next.disabled = !(inArticle || inList);
    els.next.querySelector('.lbl').textContent = inList ? '换一批' : '下一篇';
    els.next.title = inList ? `「${cur.topic ? cur.topic.zh : ''}」的下一批文章（再点一次话题也可以）` : '列表里的下一篇';
  }

  // ---------- 话题 ----------
  function renderChips() {
    els.topics.textContent = '';
    for (const t of TOPICS) {
      const b = h('button', { type: 'button', class: 'chip' + (t.key === 'latt' ? ' extra' : ''), 'data-topic': t.key }, t.zh);
      b.addEventListener('click', () => {
        b.blur();
        showTopic(t, cur.topic === t && !loading && (cur.view === 'list' || cur.view === 'article'));
      });
      els.topics.append(b);
    }
  }
  function markChip(topic, busy) {
    for (const b of els.topics.children) {
      const on = !!topic && b.dataset.topic === topic.key;
      b.classList.toggle('active', on);
      b.classList.toggle('busy', on && busy);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = on ? '再点一次换一批文章' : '';
      if (on && busy === false) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function setView(view) {
    cur.view = view;
    els.list.hidden = view !== 'list';
    els.article.hidden = view === 'list';
    document.body.dataset.view = view;
    updateButtons();
  }

  function message(...children) {
    els.notice.hidden = true;
    els.article.textContent = '';
    els.article.removeAttribute('data-id');
    els.article.append(h('div', { class: 'state-box', lang: 'zh-CN' }, ...children));
    cur.item = null;
    cur.model = null;
    setView('message');
  }

  // again：再点一次同一个话题 → 下一批
  async function showTopic(topic, again) {
    const token = ++loadToken;
    loading = true;
    reader.stop();
    hidePopup();
    cur.topic = topic;
    S.topic = topic.key;
    save();
    markChip(topic, true);
    // 从文章直接换话题：浏览器的「后退」不再回到那篇文章
    if (history.state && history.state.sv === 'article') { try { history.replaceState(null, ''); } catch (e) { /* 忽略 */ } }
    const bar = h('i');
    if (!again) {
      els.notice.hidden = true;
      els.article.textContent = '';
      els.article.removeAttribute('data-id');
      els.article.append(h('div', { class: 'state-box', lang: 'zh-CN' },
        h('p', null, `正在从瑞典广播电台（Sveriges Radio）取「${topic.zh}」的新闻…`),
        h('div', { class: 'loading-bar' }, bar)));
      cur.item = null;
      cur.model = null;
      setView('loading');
    }
    let res;
    try {
      res = await SV.sources.loadTopic(topic, (done, total) => { if (token === loadToken) bar.style.width = Math.round((done / total) * 100) + '%'; });
    } catch (e) {
      res = { cands: [], failed: topic.feeds.length, error: e };
    }
    if (token !== loadToken) return;
    loading = false;
    markChip(topic, false);
    if (!res.cands.length) {
      if (res.error) {
        message(h('p', null, '没能从瑞典广播电台（Sveriges Radio）取到新闻。'),
          h('p', null, '可能是网络不通，或者请求太密集被 SR 的服务器暂时拒绝了。请过一两分钟再试。'),
          h('button', { type: 'button', onclick: () => showTopic(topic) }, '再试一次'));
      } else {
        const alt = TOPICS.filter((t) => t !== topic && ['idag', 'teknik', 'klimat', 'ekonomi'].includes(t.key));
        message(h('p', null, `Sveriges Radio 最近几天没有「${topic.zh}」的文章（SR 的新闻源每个节目只保留最新的 20 篇左右）。`),
          h('p', null, '先看看别的话题吧：'),
          h('div', { class: 'next-row' }, alt.map((t) => h('button', { type: 'button', onclick: () => showTopic(t) }, t.zh))));
      }
      return;
    }
    const b = SV.sources.nextBatch(topic, res.cands, BATCH, !!again);
    const notices = b.notices.slice();
    if (res.loose) notices.unshift(`最近几天没有专门讲「${topic.zh}」的文章，下面这些和它有些关系。`);
    if (res.failed) notices.push(`有 ${res.failed} 个节目这次没取到，文章可能少一些。`);
    cur.batch = b.items;
    cur.more = b.more;
    cur.notices = notices;
    cur.batchNo = again ? cur.batchNo + 1 : 1;
    cur.listZh = false;
    cur.listScroll = 0;
    // 网址里带了 ?a=文章编号：直接打开那一篇
    if (wantArticle) {
      const it = res.cands.map((c) => c.item).find((x) => x.id === wantArticle);
      wantArticle = '';
      if (it) {
        if (!cur.batch.includes(it)) cur.batch = [it, ...cur.batch].slice(0, BATCH);
        renderList();
        openArticle(it, true);
        return;
      }
    }
    renderList();
    window.scrollTo({ top: 0 });
  }

  // ---------- 文章列表 ----------
  function when(item, long) {
    const [y, m, d] = item.day.split('-');
    const today = SV.stockholmDay(new Date());
    const diff = SV.dayDiff(today, item.day);
    const rel = diff === 0 ? '今天' : diff === 1 ? '昨天' : `${+m}月${+d}日`;
    return `${rel} ${SV.stockholmTime(item.published)}${long ? '（瑞典时间）' : ''}${diff > 1 && y !== today.slice(0, 4) ? ' ' + y + '年' : ''}`;
  }
  function firstLine(item) {
    const t = item.blocks.length ? item.blocks[0].text : '';
    return t.length > 220 ? t.slice(0, 210).replace(/\s+\S*$/, '') + ' …' : t;
  }

  function renderList() {
    reader.stop();
    hidePopup();
    const topic = cur.topic;
    const read = SV.sources.readSet();
    els.list.textContent = '';
    els.list.append(h('div', { class: 'list-head' },
      h('h2', null, topic.zh),
      h('span', null, `第 ${cur.batchNo} 批 · ${cur.batch.length} 篇 · 选一篇来读；再点一次「${topic.zh}」换一批`)));
    const ol = h('ol', { class: 'cards' });
    for (const it of cur.batch) {
      const a = h('a', { class: 'card' + (read.has(it.id) ? ' read' : ''), href: '?topic=' + topic.key + '&a=' + encodeURIComponent(it.id), 'data-id': it.id },
        h('span', { class: 'c-title', lang: 'sv' }, it.title),
        h('span', { class: 'c-first', lang: 'sv' }, firstLine(it)),
        h('span', { class: 'c-meta' },
          it.easy ? h('span', { class: 'badge' }, '简易瑞典语') : null,
          h('span', { lang: 'sv' }, it.program),
          h('span', null, when(it)),
          read.has(it.id) ? h('span', { class: 'badge done' }, '已读') : null));
      a.addEventListener('click', (e) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openArticle(it, true);
      });
      ol.append(h('li', null, a));
    }
    els.list.append(ol);
    els.list.append(h('div', { class: 'list-foot' },
      h('button', { type: 'button', onclick: (e) => { e.currentTarget.blur(); showTopic(topic, true); } }, cur.more ? '换一批 →' : '从最新的重新列 →')));
    els.article.textContent = '';
    els.article.removeAttribute('data-id');
    cur.item = null;
    cur.model = null;
    setView('list');
    showNotices();
  }

  function showNotices() {
    if (cur.notices.length && cur.view !== 'article') {
      els.notice.textContent = cur.notices.join(' ');
      els.notice.hidden = false;
    } else {
      els.notice.hidden = true;
    }
  }

  // 从文章回到列表（列表还是原来那一批，滚动位置也回到原处）
  function backToList(fromHistory) {
    if (cur.view !== 'article') return;
    if (!fromHistory && history.state && history.state.sv === 'article') { history.back(); return; }
    reader.stop();
    hidePopup();
    hlS = hlW = null;
    const read = SV.sources.readSet();
    for (const a of els.list.querySelectorAll('.card')) {
      if (read.has(a.dataset.id) && !a.classList.contains('read')) {
        a.classList.add('read');
        a.querySelector('.c-meta').append(h('span', { class: 'badge done' }, '已读'));
      }
    }
    els.article.textContent = '';
    els.article.removeAttribute('data-id');
    cur.item = null;
    cur.model = null;
    setView('list');
    showNotices();
    window.scrollTo({ top: cur.listScroll });
  }
  window.addEventListener('popstate', () => { if (cur.view === 'article') backToList(true); });

  // ---------- 文章 ----------
  function openArticle(item, push) {
    reader.stop();
    hidePopup();
    hlS = hlW = null;
    if (cur.view === 'list') cur.listScroll = window.scrollY;
    if (push && !(history.state && history.state.sv === 'article')) {
      try { history.pushState({ sv: 'article', id: item.id }, ''); } catch (e) { /* 不支持就算了 */ }
    }
    cur.item = item;
    cur.translating = false;
    cur.zhShown = true;
    SV.sources.markRead(item.id);
    const topic = cur.topic;
    const art = els.article;
    art.textContent = '';
    art.dataset.id = item.id;
    const today = SV.stockholmDay(new Date()) === item.day;
    const back = () => h('button', { type: 'button', class: 'back-btn', lang: 'zh-CN', onclick: (e) => { e.currentTarget.blur(); backToList(false); } }, `← 返回「${topic.zh}」列表`);
    art.append(h('div', { class: 'art-top', lang: 'zh-CN' }, back()));
    art.append(h('div', { class: 'meta', lang: 'zh-CN' },
      item.easy ? h('span', { class: 'badge', title: '这篇是用简易瑞典语写的' }, '简易瑞典语') : null,
      today ? h('span', { class: 'badge today' }, '今天') : null,
      h('span', { lang: 'sv' }, item.program),
      h('span', null, when(item, true)),
      h('a', { href: item.link, target: '_blank', rel: 'noopener' }, '原文 ↗')));
    const title = h('h1');
    const body = h('div', { class: 'body' });
    art.append(title, body);
    cur.model = SV.text.renderArticle(item, title, body);
    art.append(h('div', { class: 'src', lang: 'zh-CN' },
      h('p', null, '来源：Sveriges Radio（瑞典广播电台）· ', h('span', { lang: 'sv' }, item.program), item.byline ? h('span', { lang: 'sv' }, ' · ' + item.byline) : null),
      h('p', null, '原文：', h('a', { href: item.link, target: '_blank', rel: 'noopener' }, item.link), '（在 SR 网站上还可以听电台的原声）'),
      h('p', null, '文章版权归 Sveriges Radio 所有。本站在你打开时从 SR 的开放接口读取，不保存、不修改。')));
    const idx = cur.batch.indexOf(item);
    art.append(h('div', { class: 'next-row', lang: 'zh-CN' },
      back(),
      h('button', { type: 'button', onclick: (e) => { e.currentTarget.blur(); nextArticle(); } },
        idx >= 0 && idx < cur.batch.length - 1 ? '下一篇 →' : '下一批 →')));
    els.notice.hidden = true;
    setView('article');
    window.scrollTo({ top: 0 });
  }

  // 文章里的「下一篇」：列表里的下一篇；最后一篇之后换下一批
  function nextArticle() {
    if (!cur.topic) return;
    const idx = cur.item ? cur.batch.indexOf(cur.item) : -1;
    if (idx >= 0 && idx < cur.batch.length - 1) openArticle(cur.batch[idx + 1], false);
    else {
      if (history.state && history.state.sv === 'article') { try { history.replaceState(null, ''); } catch (e) { /* 忽略 */ } }
      showTopic(cur.topic, true);
    }
  }

  // ---------- 查词弹出框 ----------
  const pop = { open: false, pinned: false, wordEl: null, rect: null, token: 0, si: -1, wi: -1, text: '' };
  let hoverTimer = 0;
  let hideTimer = 0;

  const ICON_SPEAK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor"/></svg>';

  function hidePopup() {
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer);
    if (pop.wordEl) pop.wordEl.classList.remove('picked');
    pop.open = false;
    pop.pinned = false;
    pop.wordEl = null;
    pop.token++;
    els.popup.hidden = true;
    els.popup.textContent = '';
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!pop.pinned) hidePopup(); }, 350);
  }

  function placePopup() {
    if (!pop.open) return;
    const rect = pop.wordEl ? pop.wordEl.getBoundingClientRect() : pop.rect;
    if (!rect) return;
    const p = els.popup;
    const vw = document.documentElement.clientWidth;
    const band = visibleBand();
    if (pop.wordEl && (rect.bottom < band.top - 4 || rect.top > band.bottom + 4)) { hidePopup(); return; }
    p.style.left = '8px';
    p.style.top = '8px';
    const pr = p.getBoundingClientRect();
    const left = SV.clamp(rect.left + rect.width / 2 - pr.width / 2, 8, Math.max(8, vw - pr.width - 8));
    let top = rect.top - pr.height - 10;
    if (top < band.top) top = rect.bottom + 10;
    if (top + pr.height > band.bottom) top = Math.max(8, Math.min(rect.top - pr.height - 10, band.bottom - pr.height));
    p.style.left = Math.round(left) + 'px';
    p.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  function trErrorText(e) {
    if (!e) return '翻译失败';
    if (e.code === 'needGesture') return '点一下这个词，启用浏览器内置的翻译';
    if (e.code === 'none') return S.online === false ? '在线翻译已关闭（可以在「设置」里打开）' : '这个浏览器没有可用的翻译';
    if (e.code === 'quota') return '今天的免费在线翻译额度用完了，明天再来，或者换 Chrome / Edge 电脑版（有内置翻译）';
    if (e.code === 'network') return '连不上在线翻译服务，请检查网络';
    return e.message || '翻译失败';
  }
  const ENGINE = { builtin: '浏览器内置翻译', mymemory: 'MyMemory 在线翻译', cache: '' };

  function onDownload(p) {
    toast(`正在下载浏览器的瑞典语→中文翻译模型：${Math.round((p || 0) * 100)}%`, 3000);
  }

  // 弹出框：word 模式（文章里的一个词）或 text 模式（鼠标选中的几个词）
  function openPopup({ wordEl, text, rect, pinned, si, wi }) {
    clearTimeout(hideTimer);
    if (pop.wordEl) pop.wordEl.classList.remove('picked');
    const token = ++pop.token;
    Object.assign(pop, { open: true, pinned, wordEl: wordEl || null, rect: rect || null, si, wi, text });
    if (wordEl && pinned) wordEl.classList.add('picked');
    const p = els.popup;
    p.textContent = '';
    p.setAttribute('role', pinned ? 'dialog' : 'tooltip');
    p.setAttribute('aria-label', '「' + text + '」的中文');
    const isWord = !!wordEl;
    const gl = isWord ? SV.glossary.lookup(text) : null;
    p.append(h('div', { class: 'pw' }, h('b', { lang: 'sv' }, text)));
    if (gl) {
      const box = h('div', { class: 'gl' });
      for (const e of gl) {
        box.append(h('div', null,
          e.lemma !== text.toLowerCase() ? h('i', { lang: 'sv' }, e.lemma + '：') : null,
          e.zh,
          e.guessed ? h('i', null, '（按词形推测的原形）') : null));
      }
      p.append(box);
    }
    const mt = h('div', { class: 'mt wait' }, '翻译中…');
    const needMt = !gl || SV.tr.builtinReady();
    if (needMt) p.append(mt);
    const acts = h('div', { class: 'acts' });
    const bSpeak = h('button', { type: 'button', title: '读出来' });
    bSpeak.innerHTML = ICON_SPEAK + '<span>读</span>';
    bSpeak.addEventListener('click', (e) => { e.stopPropagation(); reader.speakText(text); });
    acts.append(bSpeak);
    if (isWord) {
      const bFrom = h('button', { type: 'button', title: '从这个词开始朗读' });
      bFrom.innerHTML = ICON_PLAY + '<span>从这里读</span>';
      bFrom.addEventListener('click', (e) => { e.stopPropagation(); hidePopup(); reader.play(si, wi); });
      acts.append(bFrom);
      const sentBox = h('div', { class: 'sent', hidden: true });
      const bSent = h('button', { type: 'button', title: '翻译这个词所在的整句' }, '本句译文');
      bSent.addEventListener('click', async (e) => {
        e.stopPropagation();
        const s = cur.model && cur.model.sentences[si];
        if (!s) return;
        sentBox.hidden = false;
        sentBox.textContent = '翻译中…';
        placePopup();
        try {
          const r = await translateText(s.text);
          if (token !== pop.token) return;
          sentBox.textContent = r ? r.zh : '没有翻译（在线翻译没有打开）';
        } catch (err) {
          if (token !== pop.token) return;
          sentBox.textContent = trErrorText(err);
        }
        placePopup();
      });
      acts.append(bSent);
      p.append(acts, sentBox);
    } else {
      p.append(acts);
    }
    const eng = h('div', { class: 'eng' });
    p.append(eng);
    p.hidden = false;
    placePopup();
    if (!needMt) return;
    const short = isWord || text.split(/\s+/).length <= 3;
    const job = short
      ? SV.tr.translate(text, 'word', { gesture: pinned, online: S.online !== false, onDownload })
      : translateText(text);
    Promise.resolve(job).then((r) => {
      if (token !== pop.token) return;
      if (!r) { mt.textContent = '没有翻译（在线翻译没有打开）'; mt.className = 'mt err'; } else {
        mt.textContent = r.zh;
        mt.className = 'mt';
        if (ENGINE[r.engine]) eng.textContent = ENGINE[r.engine];
      }
      placePopup();
    }, (err) => {
      if (token !== pop.token) return;
      mt.textContent = trErrorText(err);
      mt.className = 'mt err';
      placePopup();
    });
  }

  function openWordPopup(wordEl, pinned) {
    const sEl = wordEl.closest('.s');
    if (!sEl || !cur.model) return;
    const si = +sEl.dataset.si;
    const wi = +wordEl.dataset.wi;
    const s = cur.model.sentences[si];
    if (!s || !s.words[wi]) return;
    openPopup({ wordEl, text: s.words[wi].text, pinned, si, wi });
  }

  // 整句、整段、标题：内置翻译优先；要用 MyMemory 的，先问过用户（返回 null 表示用户不用在线翻译）
  async function decideOnline() {
    const avail = await SV.tr.builtinAvailability();
    const builtinOk = avail === 'ready' || avail === 'available' || avail === 'downloadable' || avail === 'downloading';
    if (builtinOk) return { online: S.online === true };
    if (S.online === false) return null;
    if (S.online === null && !(await askConsent())) return null;
    return { online: true, mm: true };
  }
  async function translateText(text) {
    const cached = SV.tr.cachedText(text);
    if (cached) return { zh: cached, engine: 'cache' };
    const d = await decideOnline();
    if (!d) return null;
    return SV.tr.translate(text, 'text', { gesture: true, online: d.online, onDownload });
  }

  function askConsent() {
    const dlg = $('#dlgConsent');
    return new Promise((resolve) => {
      if (!dlg.showModal) { resolve(window.confirm('这个浏览器没有内置翻译。要用 MyMemory 在线翻译吗？（文字会发给 MyMemory 的服务器，每天约 5000 字符的免费额度）')); return; }
      const done = () => {
        dlg.removeEventListener('close', done);
        const ok = dlg.returnValue === 'yes';
        if (dlg.returnValue === 'yes' || dlg.returnValue === 'no') {
          S.online = ok;
          save();
          syncSettingsForm();
        }
        resolve(ok);
      };
      dlg.returnValue = '';
      dlg.addEventListener('close', done);
      dlg.showModal();
    });
  }

  // ---------- 全文翻译（文章）/ 翻译标题（列表） ----------
  async function translateAll() {
    if (cur.view === 'list') return translateTitles();
    if (cur.view !== 'article' || !cur.model || cur.translating) return;
    const model = cur.model;
    const blocks = model.blocks;
    const todo = blocks.filter((b) => !b.zhEl);
    if (!todo.length) {
      cur.zhShown = !cur.zhShown;
      for (const b of blocks) b.zhEl.hidden = !cur.zhShown;
      updateButtons();
      return;
    }
    cur.zhShown = true;
    for (const b of blocks) if (b.zhEl) b.zhEl.hidden = false;
    const d = await decideOnline();
    if (!d) {
      if (S.online === false) toast('这个浏览器没有内置翻译，在线翻译也关着。可以在「设置」里打开在线翻译。', 5000);
      return;
    }
    if (d.mm) {
      const u = SV.tr.mmUsage();
      const need = todo.reduce((n, b) => n + b.text.length, 0);
      if (u.chars + need > SV.tr.MM_LIMIT) toast(`今天已经用了约 ${u.chars} 个字符的在线翻译，这篇约 ${need} 个字符，可能超过每天约 5000 字符的免费额度。`, 6000);
    }
    if (cur.model !== model) return;
    cur.translating = true;
    updateButtons(0);
    let n = 0;
    let failure = null;
    for (const b of todo) {
      try {
        const r = await SV.tr.translate(b.text, 'text', { gesture: true, online: d.online, onDownload });
        if (cur.model !== model) return;
        const zh = h('span', { class: 'zh', lang: 'zh-CN' }, r.zh);
        b.el.append(zh);
        b.zhEl = zh;
      } catch (e) {
        failure = e;
        break;
      }
      n++;
      updateButtons(Math.round((n / todo.length) * 100));
    }
    if (cur.model !== model) return;
    cur.translating = false;
    updateButtons();
    if (failure) toast(trErrorText(failure), 6000);
  }

  async function translateTitles() {
    if (cur.listTranslating) return;
    const cards = [...els.list.querySelectorAll('.card')];
    const done = cards.filter((c) => c.querySelector('.zh'));
    if (cards.length && done.length === cards.length) {
      cur.listZh = !cur.listZh;
      for (const c of cards) c.querySelector('.zh').hidden = !cur.listZh;
      updateButtons();
      return;
    }
    const d = await decideOnline();
    if (!d) {
      if (S.online === false) toast('这个浏览器没有内置翻译，在线翻译也关着。可以在「设置」里打开在线翻译。', 5000);
      return;
    }
    const batch = cur.batch;
    cur.listTranslating = true;
    cur.listZh = true;
    for (const c of done) c.querySelector('.zh').hidden = false;
    updateButtons(0);
    let n = 0;
    let failure = null;
    for (const c of cards) {
      if (c.querySelector('.zh')) { n++; continue; }
      const it = batch.find((x) => x.id === c.dataset.id);
      try {
        const r = await SV.tr.translate(it.title, 'text', { gesture: true, online: d.online, onDownload });
        if (cur.batch !== batch) break;
        c.querySelector('.c-title').after(h('span', { class: 'zh', lang: 'zh-CN' }, r.zh));
      } catch (e) {
        failure = e;
        break;
      }
      n++;
      updateButtons(Math.round((n / cards.length) * 100));
    }
    cur.listTranslating = false;
    updateButtons();
    if (failure) toast(trErrorText(failure), 6000);
  }

  // ---------- 事件 ----------
  let lastPointer = 'mouse';
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; clearTimeout(hoverTimer); }, true);

  // 点文章：正在读就暂停（点在词上同时显示这个词）；没在读时点词显示中文
  els.main.addEventListener('click', (e) => {
    if (cur.view !== 'article') return;
    if (e.target.closest('a, button, input, select, .tip')) return;
    const sel = window.getSelection ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && String(sel).trim().length > 1 && lastPointer === 'mouse') return;
    const wEl = e.target.closest('#article .w');
    if (reader.state === 'speaking') {
      reader.pause();
      if (wEl) openWordPopup(wEl, true);
      else hidePopup();
      return;
    }
    if (wEl) {
      if (pop.open && pop.pinned && pop.wordEl === wEl) hidePopup();
      else openWordPopup(wEl, true);
    } else {
      hidePopup();
    }
  });

  // 鼠标停在词上：显示中文（正在朗读时不弹，免得挡住；点一下就暂停并显示）
  els.article.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return; // 按着键在拖选文字时不弹
    const wEl = e.target.closest('.w');
    if (!wEl || reader.state === 'speaking' || (pop.open && pop.pinned)) return;
    clearTimeout(hideTimer);
    clearTimeout(hoverTimer);
    if (pop.open && pop.wordEl === wEl) return;
    hoverTimer = setTimeout(() => {
      if (reader.state === 'speaking' || (pop.open && pop.pinned) || !wEl.isConnected) return;
      openWordPopup(wEl, false);
    }, 260);
  });
  els.article.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const wEl = e.target.closest('.w');
    if (!wEl || (e.relatedTarget && wEl.contains(e.relatedTarget))) return;
    clearTimeout(hoverTimer);
    if (pop.open && !pop.pinned) scheduleHide();
  });
  els.popup.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  els.popup.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && pop.open && !pop.pinned) scheduleHide(); });
  els.popup.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!pop.open || els.popup.contains(e.target) || els.main.contains(e.target)) return;
    if (e.target.closest('dialog')) return;
    hidePopup();
  });

  // 电脑上用鼠标选中几个词：翻译选中的部分
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse' || reader.state === 'speaking' || cur.view !== 'article') return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const text = String(sel).replace(/\s+/g, ' ').trim();
      if (text.length < 2 || text.length > 300 || !/\s/.test(text)) return;
      const range = sel.getRangeAt(0);
      if (!els.article.contains(range.commonAncestorContainer)) return;
      openPopup({ text, rect: range.getBoundingClientRect(), pinned: true, si: -1, wi: -1 });
    }, 0);
  });

  // 空格：暂停 / 继续；Esc：关掉弹出框
  let spaceHandled = false;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (pop.open) hidePopup(); return; }
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (document.querySelector('dialog[open]') || cur.view !== 'article') return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    spaceHandled = true;
    if (e.repeat) return;
    if (reader.state === 'speaking') reader.pause();
    else startReading();
  });
  document.addEventListener('keyup', (e) => {
    if ((e.code === 'Space' || e.key === ' ') && spaceHandled) { e.preventDefault(); spaceHandled = false; }
  });

  window.addEventListener('scroll', () => { if (pop.open) placePopup(); }, { passive: true });
  window.addEventListener('resize', () => { if (pop.open) placePopup(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && reader.state === 'speaking') reader.pause(); });

  // 播放栏
  els.play.addEventListener('click', () => { els.play.blur(); startReading(); });
  const RATES = [0.6, 0.75, 0.9, 1, 1.15];
  els.rate.addEventListener('click', () => {
    els.rate.blur();
    const next = RATES.find((r) => r > S.rate + 0.01);
    setRate(next || RATES[0]);
    toast('语速 ' + fmtRate(S.rate), 1500);
  });
  els.voice.addEventListener('click', () => {
    els.voice.blur();
    S.gender = S.gender === 'f' ? 'm' : 'f';
    S.voiceURI = '';
    save();
    refreshVoice();
    syncSettingsForm();
    const want = S.gender === 'm' ? '男声' : '女声';
    if (!voiceInfo.voice) toast('这台设备上没有瑞典语声音（详见「设置」）');
    else if (!voiceInfo.exact) toast(`这台设备没有瑞典语${want}，现在用的是 ${voiceInfo.voice.name}`, 5000);
    else toast(`${want}：${voiceInfo.voice.name}`, 2500);
    if (reader.state === 'speaking') reader.play(reader.si, reader.wi);
  });
  els.translate.addEventListener('click', () => { els.translate.blur(); translateAll(); });
  els.next.addEventListener('click', () => {
    els.next.blur();
    if (cur.view === 'list') showTopic(cur.topic, true);
    else if (cur.view === 'article') nextArticle();
  });

  // 顶栏
  const fmtRate = (r) => (Math.round(r * 100) / 100).toFixed(2).replace(/0$/, '') + '×';
  function setRate(r) {
    S.rate = SV.clamp(Math.round(r * 100) / 100, 0.5, 1.3);
    save();
    els.rate.querySelector('b').textContent = fmtRate(S.rate);
    syncSettingsForm();
    if (reader.state === 'speaking') reader.play(reader.si, reader.wi);
  }
  function setScale(v) {
    S.scale = SV.clamp(Math.round(v * 10) / 10, 0.8, 1.8);
    save();
    document.documentElement.style.setProperty('--scale', S.scale);
    syncSettingsForm();
    if (pop.open) placePopup();
  }
  $('#btnSmaller').addEventListener('click', () => setScale(S.scale - 0.1));
  $('#btnBigger').addEventListener('click', () => setScale(S.scale + 0.1));
  $('#btnHelp').addEventListener('click', () => { const d = $('#dlgHelp'); if (d.showModal) d.showModal(); });
  $('#btnSettings').addEventListener('click', () => {
    const d = $('#dlgSettings');
    fillVoiceSelect();
    syncSettingsForm();
    updateTrNote();
    if (d.showModal) d.showModal();
  });
  $('#btnTipClose').addEventListener('click', () => { els.tip.hidden = true; S.tip = false; save(); });

  // ---------- 设置对话框 ----------
  const selVoice = $('#selVoice');
  function fillVoiceSelect() {
    const list = SV.speech.voices();
    selVoice.textContent = '';
    selVoice.append(h('option', { value: '' }, `自动（${S.gender === 'm' ? '男声' : '女声'}优先）`));
    for (const x of list) {
      const g = x.gender === 'f' ? '女' : x.gender === 'm' ? '男' : '性别不明';
      selVoice.append(h('option', { value: x.v.voiceURI }, `${x.v.name}（${g}）`));
    }
    selVoice.value = list.some((x) => x.v.voiceURI === S.voiceURI) ? S.voiceURI : '';
    const note = $('#voiceNote');
    if (!SV.speech.supported) note.textContent = '这个浏览器不支持朗读。';
    else if (!list.length) note.textContent = '这台设备上没有瑞典语声音。办法：用 Edge 浏览器（自带微软的瑞典语在线声音 Sofie、Mattias）；Windows 可以在「设置 → 时间和语言 → 语音」里添加瑞典语语音；iPhone / iPad 在「设置 → 辅助功能 → 朗读内容 → 声音」里下载瑞典语声音；安卓在系统的「文字转语音」设置里安装瑞典语。';
    else note.textContent = `这台设备有 ${list.length} 个瑞典语声音。认不出男女的标为「性别不明」，可以试听后自己选。`;
  }
  selVoice.addEventListener('change', () => {
    S.voiceURI = selVoice.value;
    const x = SV.speech.voices().find((v) => v.v.voiceURI === S.voiceURI);
    if (x && x.gender !== '?') S.gender = x.gender;
    save();
    refreshVoice();
  });
  $('#btnTryVoice').addEventListener('click', () => reader.speakText('Hej! Välkommen. Här kan du läsa nyheter på svenska.'));
  const rngRate = $('#rngRate');
  const rngFont = $('#rngFont');
  rngRate.addEventListener('input', () => setRate(+rngRate.value));
  rngFont.addEventListener('input', () => setScale(+rngFont.value));
  $('#chkOnline').addEventListener('change', (e) => {
    S.online = !!e.target.checked;
    save();
    updateTrNote();
  });
  $('#btnClearHistory').addEventListener('click', () => { SV.sources.clearHistory(); toast('阅读记录已清除'); });
  function syncSettingsForm() {
    rngRate.value = S.rate;
    $('#outRate').textContent = fmtRate(S.rate);
    rngFont.value = S.scale;
    $('#outFont').textContent = Math.round(S.scale * 100) + '%';
    $('#chkOnline').checked = S.online !== false;
    if (selVoice.options.length) selVoice.value = SV.speech.voices().some((x) => x.v.voiceURI === S.voiceURI) ? S.voiceURI : '';
  }
  async function updateTrNote() {
    const a = await SV.tr.builtinAvailability();
    const u = SV.tr.mmUsage();
    let t;
    if (a === 'ready' || a === 'available') t = '浏览器内置翻译：可用（在本机翻译，文字不离开这台设备，不限量）。';
    else if (a === 'downloadable' || a === 'downloading') t = '浏览器内置翻译：可用。第一次用时浏览器要下载瑞典语→中文的翻译模型（点「全文翻译」或点一个词就开始）。';
    else t = '这个浏览器没有内置翻译（Chrome、Edge 的电脑版才有），会用 MyMemory 在线翻译。';
    if (u.chars) t += ` 今天已用在线翻译约 ${u.chars} 个字符。`;
    $('#trNote').textContent = t;
  }

  // ---------- 开始 ----------
  document.documentElement.style.setProperty('--scale', S.scale);
  els.rate.querySelector('b').textContent = fmtRate(S.rate);
  renderChips();
  els.tip.hidden = !S.tip;
  SV.speech.onVoices(() => {
    refreshVoice();
    if ($('#dlgSettings').open) fillVoiceSelect();
  });
  save();
  const params = new URLSearchParams(location.search);
  const first = TOPICS.find((t) => t.key === params.get('topic')) || TOPICS.find((t) => t.key === S.topic) || TOPICS[0];
  showTopic(first, false);

  // 给自动测试看的状态（不影响使用）
  window.SVApp = {
    state: () => ({
      topic: cur.topic && cur.topic.key,
      view: cur.view,
      batch: cur.batch.map((x) => x.id),
      batchNo: cur.batchNo,
      id: cur.item && cur.item.id,
      title: cur.item && cur.item.title,
      program: cur.item && cur.item.program,
      day: cur.item && cur.item.day,
      easy: cur.item && cur.item.easy,
      loading,
      reader: reader.state,
      si: reader.si,
      wi: reader.wi,
      wordEvents: reader.wordEvents,
      sentences: cur.model ? cur.model.sentences.length : 0,
      blocks: cur.model ? cur.model.blocks.length : 0,
      translated: cur.model ? cur.model.blocks.filter((b) => b.zhEl).length : 0,
      translating: cur.translating,
      listZh: els.list.querySelectorAll('.card .zh').length,
      voice: voiceInfo.voice ? voiceInfo.voice.name : null,
      voiceGender: voiceInfo.gender,
      popup: pop.open ? { pinned: pop.pinned, text: pop.text } : null,
      settings: Object.assign({}, S),
    }),
  };
})();

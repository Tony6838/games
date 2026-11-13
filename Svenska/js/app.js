/* 界面：话题 → 文章列表 → 文章；朗读高亮、查词弹出框、设置。 */
(function () {
  'use strict';
  const SV = window.SV;
  const { h } = SV;
  const $ = (sel) => document.querySelector(sel);

  // ---------- 设置 ----------
  const SET_KEY = 'sv.settings.v1';
  // online：微软翻译（额度用完、连不上）和浏览器内置翻译都用不了时，用 MyMemory 在线翻译。
  // 默认开着，只有在「设置」里取消勾选才关（false）。微软翻译不受这个开关管（微软不保存文字）。
  // engine：'cloud' 云端自然语音（js/config.js 设了 ttsUrl 才有）或 'device' 这台设备自己的声音；cloudVoice：云端选的声音；
  // cloudOffMonth：云端这个月的免费额度用完了（'2026-11'），这个月里直接用本机的声音，不再每次先试云端
  // loop：循环朗读（读完这一篇从头再读），这个浏览器记住；存不了（隐私模式等）时只在这次打开的页面里有效
  const DEFAULTS = { scale: 1, rate: 0.9, gender: 'f', voiceURI: '', engine: 'cloud', cloudVoice: '', cloudOffMonth: '', online: true, tip: true, topic: 'idag', loop: false };
  const S = Object.assign({}, DEFAULTS, SV.store.get(SET_KEY, {}));
  delete S.level; // 旧版本的「简易优先」设置，不再用
  // 设置的版本：第一版在说明框里点「不用」会把在线翻译一直关着（Safari 上点词只看到「在线翻译已关闭」）。
  // 现在在线翻译默认开着、不再先问，所以旧版本留下的状态一律改回默认一次；
  // 这个版本以后在「设置」里自己关掉的（v = 3），照样保留。
  if (S.v !== 3) { S.online = true; S.v = 3; }
  S.scale = SV.clamp(+S.scale || 1, 0.8, 1.8);
  S.rate = SV.clamp(+S.rate || 0.9, 0.5, 1.3);
  if (!['f', 'm'].includes(S.gender)) S.gender = 'f';
  if (!['cloud', 'device'].includes(S.engine)) S.engine = 'cloud';
  if (S.online !== false) S.online = true;
  S.loop = S.loop === true;
  const save = () => SV.store.set(SET_KEY, S);

  const TOPICS = SV.sources.TOPICS;
  // 本站不翻译整篇文章：整篇用浏览器自己的整页翻译。没有内置翻译（Translator API，今天是 Chrome、Edge
  // 电脑版 138 起）的浏览器，在列表和文章开头提示怎么用它自己的整页翻译。按功能检测，不看浏览器的名字。
  const UA = navigator.userAgent || '';
  const IS_IOS = /iP(hone|ad|od)/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1); // iPadOS 默认报成 Mac
  const IS_SAFARI = !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|MicroMessenger|YaBrowser|Mercury/i.test(UA) &&
    (IS_IOS || (/AppleWebKit/.test(UA) && /Safari\//.test(UA) && !/Chrome|Chromium|Edg|OPR|Firefox|Android/.test(UA)));
  const PAGE_TR_HINT = IS_SAFARI ? '整篇翻译：点地址栏「aA → 翻译成中文」'
    : /Firefox\/|FxiOS/.test(UA) ? '整篇翻译：用地址栏的翻译图标'
      : /Android/.test(UA) && /Chrome\//.test(UA) && !/EdgA|SamsungBrowser|OPR|YaBrowser|MicroMessenger/.test(UA) ? '整篇翻译：点右上角 ⋮ →「翻译…」'
        : '整篇翻译：用浏览器自带的翻译功能';
  // 内置翻译能不能用（瑞典语→中文），开始时查一次；整页翻译的提示一行跟着这个 class 显示或隐藏
  function setBuiltin(ok) {
    document.body.classList.toggle('no-builtin', !ok);
  }
  const BATCH = 9; // 一批几篇
  const els = {
    topbar: $('#topbar'), topics: $('#topics'), list: $('#list'), article: $('#article'), main: $('#main'), notice: $('#notice'), tip: $('#tip'),
    popup: $('#popup'), toast: $('#toast'), player: $('#player'),
    play: $('#btnPlay'), rate: $('#btnRate'), voice: $('#btnVoice'), loop: $('#btnLoop'), next: $('#btnNext'),
    back: $('#btnBack'), brand: $('#brand'), guide: $('#guide'),
  };

  // view：'loading' | 'list' | 'article' | 'message'
  const cur = {
    topic: null, view: 'loading', batch: [], notices: [], more: false, batchNo: 0, listScroll: 0,
    item: null, model: null,
  };
  let loadToken = 0;
  let loading = false;
  let lastArticleId = ''; // 云端语音合成好的段落属于哪一篇（换文章时放掉）
  let wantArticle = new URLSearchParams(location.search).get('a') || '';

  // ---------- 提示条 ----------
  let toastTimer = 0;
  function toast(msg, ms = 3800) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
  }

  // ---------- 按钮的瑞典文提示 ----------
  // 每个按钮都有瑞典文提示（Tony 定的，学瑞典语用）：第一行瑞典文，第二行中文说明。
  // 电脑上是浏览器自己的 title 提示（鼠标停在按钮上）；手机、平板没有悬停，按住按钮半秒，
  // 在按钮上方显示同样的两行，松手不算点击。新加的按钮一律用 tip() 给提示，测试会查每个按钮。
  function tip(el, sv, zh) {
    el.dataset.sv = sv;
    el.dataset.zh = zh || '';
    el.title = zh ? sv + '\n' + zh : sv;
    return el;
  }
  const tipBox = h('div', { class: 'svtip', role: 'tooltip', hidden: true });
  document.body.append(tipBox);
  let tipTimer = 0;
  let press = null; // { btn, x, y, timer, shown }
  function hideTip() { clearTimeout(tipTimer); tipBox.hidden = true; }
  function showTip(btn) {
    // 对话框（showModal）在最上层，提示框要放进对话框里才看得见
    const host = btn.closest('dialog[open]') || document.body;
    if (tipBox.parentNode !== host) host.append(tipBox);
    tipBox.textContent = '';
    tipBox.append(h('b', { lang: 'sv' }, btn.dataset.sv));
    if (btn.dataset.zh) tipBox.append(h('span', { lang: 'zh-CN' }, btn.dataset.zh));
    tipBox.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = tipBox.offsetWidth;
    const ht = tipBox.offsetHeight;
    const vw = document.documentElement.clientWidth;
    tipBox.style.left = Math.round(SV.clamp(r.left + r.width / 2 - w / 2, 8, Math.max(8, vw - w - 8))) + 'px';
    tipBox.style.top = Math.round(r.top - ht - 8 >= 8 ? r.top - ht - 8 : Math.min(r.bottom + 8, window.innerHeight - ht - 8)) + 'px';
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, 3000);
  }
  document.addEventListener('touchstart', (e) => {
    hideTip();
    if (press) clearTimeout(press.timer);
    press = null;
    const t = e.touches.length === 1 ? e.touches[0] : null;
    const btn = t && e.target.closest ? e.target.closest('button[data-sv]') : null;
    if (!btn) return;
    press = { btn, x: t.clientX, y: t.clientY, shown: false, timer: 0 };
    const p = press;
    p.timer = setTimeout(() => { p.shown = true; showTip(btn); }, 500);
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (press && !press.shown && t && (Math.abs(t.clientX - press.x) > 10 || Math.abs(t.clientY - press.y) > 10)) {
      clearTimeout(press.timer);
      press = null;
    }
  }, { capture: true, passive: true });
  function endPress(e) {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.shown && e.cancelable) e.preventDefault(); // 按住是看提示，松手不算点击
    press = null;
  }
  document.addEventListener('touchend', endPress, { capture: true, passive: false });
  document.addEventListener('touchcancel', endPress, { capture: true });
  // 安卓上长按会弹出菜单：按住按钮时不要
  document.addEventListener('contextmenu', (e) => { if (press) e.preventDefault(); }, true);
  window.addEventListener('scroll', hideTip, { passive: true });

  // ---------- 朗读 ----------
  // 两种声音，接口一样：云端自然语音（js/cloudtts.js，微软 Azure，电脑、手机、任何浏览器都一样自然；
  // js/config.js 设了 ttsUrl 才有）和这台设备自己的声音（js/speech.js）。默认用云端；云端出错时，
  // 这次打开的页面里改用本机的声音（刷新再试云端）。「设置」里也可以自己选。
  // ---------- 锁屏界面和媒体键（Media Session） ----------
  // 云端语音是普通的 audio：手机锁屏界面、安卓的通知栏、电脑的媒体键和系统的「正在播放」都能控制它：
  // 播放、暂停、停止、下一篇、上一篇。本机的声音（speechSynthesis）不是 audio，系统一般不显示这些控制。
  // 没有这个接口的浏览器什么都不做。没有「循环」这个系统按钮，循环朗读只能在页面上开关。
  const media = (typeof navigator !== 'undefined' && navigator.mediaSession) || null;
  function mediaMeta(item) {
    if (!media || typeof MediaMetadata === 'undefined') return;
    try {
      media.metadata = item ? new MediaMetadata({
        title: item.title,
        artist: item.program + ' · Sveriges Radio',
        album: '瑞典语读报',
        artwork: [192, 512].map((n) => ({ src: new URL(`icons/icon-${n}.png`, location.href).href, sizes: `${n}x${n}`, type: 'image/png' })),
      }) : null;
    } catch (e) { /* 忽略 */ }
  }
  function mediaState(st) {
    if (!media) return;
    try { media.playbackState = st === 'speaking' ? 'playing' : st === 'paused' ? 'paused' : 'none'; } catch (e) { /* 忽略 */ }
  }
  function mediaAction(name, fn) {
    if (!media || !media.setActionHandler) return;
    try { media.setActionHandler(name, fn); } catch (e) { /* 这个浏览器不支持这个动作 */ }
  }

  let voiceInfo = { voice: null, gender: '?', exact: false };
  let cloudDown = false;
  const hooks = {
    sentences: () => (cur.view === 'article' && cur.model ? cur.model.sentences : []),
    blocks: () => (cur.view === 'article' && cur.model ? cur.model.blocks : []),
    voice: () => voiceInfo.voice,
    voiceName: () => cloudVoice().name,
    rate: () => S.rate,
    loop: () => S.loop === true,
    onState: (st) => {
      document.body.classList.toggle('speaking', st === 'speaking');
      document.body.classList.toggle('paused', st === 'paused');
      mediaState(st);
      updateButtons();
    },
    onPosition: (si, wi, byWord) => highlight(si, wi, byWord),
    onError: (msg) => toast(msg),
    onFail: (e) => cloudFailed(e),
  };
  const deviceReader = new SV.speech.Reader(hooks);
  const cloudReader = SV.cloud && SV.cloud.configured ? new SV.cloud.Reader(hooks) : null;
  const monthKey = () => new Date().toISOString().slice(0, 7); // Azure 的免费额度按月算
  const quotaOut = () => S.cloudOffMonth === monthKey();
  const useCloud = () => !!cloudReader && S.engine === 'cloud' && !cloudDown && !quotaOut();
  let reader = useCloud() ? cloudReader : deviceReader;

  // 云端选的声音：设置里选过、而且和「女声 / 男声」一致的，否则这个性别的第一个（Sofie、Mattias）
  function cloudVoice() {
    const chosen = SV.cloud ? SV.cloud.voiceByName(S.cloudVoice) : null;
    if (chosen && chosen.gender === S.gender) return chosen;
    const V = SV.cloud ? SV.cloud.VOICES : [{ name: '', label: '', gender: 'f' }];
    return V.find((v) => v.gender === S.gender) || V[0];
  }

  // 换用另一种声音：从同一个地方接着读（朗读中或暂停的，停在「继续」上）
  function switchReader() {
    const next = useCloud() ? cloudReader : deviceReader;
    if (next === reader) return;
    const { si, wi, state: was } = reader;
    reader.stop();
    reader = next;
    reader.si = si;
    reader.wi = wi;
    if (was !== 'idle') reader.setState('paused');
  }

  function cloudFailed(e) {
    const was = reader.state;
    cloudDown = true;
    if (e && e.code === 'quota') { S.cloudOffMonth = monthKey(); save(); } // 这个月里不再先试云端
    const why = e && e.code === 'quota' ? '云端语音这个月的免费额度用完了，下个月自动再用'
      : e && (e.code === 'forbidden' || e.code === 'auth') ? '云端语音的设置有问题（令牌服务或 Azure 密钥）'
        : e && e.code === 'network' ? '连不上云端语音'
          : '云端语音这次没成功';
    toast(why + '，先改用这台设备自己的声音' + (was !== 'idle' ? '，点「继续」接着读。' : '。'), 6000);
    switchReader();
    refreshVoice();
  }

  function refreshVoice() {
    voiceInfo = SV.speech.pickVoice({ gender: S.gender, voiceURI: S.voiceURI });
    let g;
    let name;
    if (useCloud()) {
      const v = cloudVoice();
      g = v.gender;
      name = v.label + '（微软云端自然语音）';
    } else {
      g = voiceInfo.voice ? voiceInfo.gender : S.gender;
      name = voiceInfo.voice ? voiceInfo.voice.name : '';
    }
    els.voice.querySelector('b').textContent = g === 'm' ? '男' : g === 'f' ? '女' : '声';
    els.voice.querySelector('.lbl').textContent = g === 'm' ? '男声' : g === 'f' ? '女声' : '声音';
    tip(els.voice, g === 'm' ? 'Manlig röst' : g === 'f' ? 'Kvinnlig röst' : 'Röst',
      name ? '现在的声音：' + name + '（点一下切换男声、女声）' : '这台设备没有瑞典语声音');
  }

  // 只标正在读的词（下划线）；正在读的句子不标出来。声音没有词的位置时（不发 boundary 事件），
  // 不标词，页面照样滚动，让正在读的那一句留在屏幕里。
  let hlW = null;
  function highlight(si, wi, byWord) {
    const m = cur.model;
    const s = m && si >= 0 ? m.sentences[si] : null;
    if (hlW) hlW.classList.remove('current');
    hlW = null;
    if (!s) return;
    const w = wi >= 0 ? s.words[wi] : null;
    if (w && (byWord || reader.wordEvents)) {
      w.el.classList.add('current');
      hlW = w.el;
    }
    ensureVisible(hlW || s.el);
  }

  let lastUserScroll = 0;
  ['wheel', 'touchmove'].forEach((ev) => window.addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true }));
  // 屏幕上看得见文章的那一段：顶上粘着的话题和朗读按钮下面，到窗口底边
  function visibleBand() {
    const top = Math.max(0, els.topbar.getBoundingClientRect().bottom) + 10;
    const bottom = window.innerHeight - 10;
    return { top, bottom };
  }
  function ensureVisible(el) {
    // 页面藏着时不滚（回到前台时再滚到正在读的词）；用户刚自己滚过时也不滚
    if (document.hidden || Date.now() - lastUserScroll < 2500) return;
    const r = el.getBoundingClientRect();
    const band = visibleBand();
    if (r.top >= band.top && r.bottom <= band.bottom) return;
    const target = window.scrollY + r.top - (band.top + (band.bottom - band.top) * 0.3);
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  function startReading() {
    if (cur.view !== 'article' || !cur.model) return;
    if (!useCloud()) {
      if (!SV.speech.supported) { toast('这个浏览器不支持朗读'); return; }
      if (reader.state === 'idle' && !SV.speech.voices().length) {
        toast('这台设备上没有瑞典语声音，发音可能不对。用 Edge 浏览器可以用微软的瑞典语声音，详见「设置」。', 6000);
      }
    }
    hidePopup();
    reader.toggle();
  }

  // ---------- 播放栏的按钮随页面变 ----------
  function updateButtons() {
    const inArticle = cur.view === 'article' && !!cur.model;
    const inList = cur.view === 'list';
    // 朗读
    const st = reader.state;
    const playLbl = st === 'speaking' ? '暂停' : st === 'paused' ? '继续' : '朗读';
    els.play.querySelector('.lbl').textContent = playLbl;
    els.play.setAttribute('aria-label', playLbl);
    els.play.disabled = !inArticle;
    tip(els.play, st === 'speaking' ? 'Pausa' : st === 'paused' ? 'Fortsätt' : 'Läs upp',
      !inArticle ? '先在列表里选一篇文章'
        : st === 'speaking' ? '暂停（空格键也可以）'
          : st === 'paused' ? '从停下的词接着读（空格键也可以）' : '朗读这篇文章（空格键也可以）');
    // 循环朗读：开关，任何时候都能按
    els.loop.classList.toggle('on', S.loop);
    els.loop.setAttribute('aria-pressed', S.loop ? 'true' : 'false');
    tip(els.loop, S.loop ? 'Upprepa: på' : 'Upprepa',
      S.loop ? '循环朗读开着：读完这一篇从头再读（点一下关掉）' : '循环朗读：读完这一篇从头再读，一遍又一遍（点一下打开）');
    // 下一篇 / 换一批
    els.next.disabled = !(inArticle || inList);
    els.next.querySelector('.lbl').textContent = inList ? '换一批' : '下一篇';
    if (inList) tip(els.next, 'Fler artiklar', `「${cur.topic ? cur.topic.zh : ''}」的下一批文章（再点一次话题也可以）`);
    else tip(els.next, 'Nästa artikel', st === 'speaking' ? '列表里的下一篇，接着朗读' : '列表里的下一篇');
  }

  // ---------- 话题 ----------
  function renderChips() {
    els.topics.textContent = '';
    for (const t of TOPICS) {
      const b = h('button', { type: 'button', class: 'chip' + (t.key === 'latt' ? ' extra' : ''), 'data-topic': t.key }, t.zh);
      tip(b, t.sv, `看「${t.zh}」的新闻`);
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
      const t = TOPICS.find((x) => x.key === b.dataset.topic);
      if (t) tip(b, t.sv, on ? '再点一次换一批文章' : `看「${t.zh}」的新闻`);
      if (on && busy === false) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function setView(view) {
    cur.view = view;
    els.list.hidden = view !== 'list';
    els.article.hidden = view === 'list';
    els.back.hidden = view !== 'article';
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
          tip(h('button', { type: 'button', onclick: () => showTopic(topic) }, '再试一次'), 'Försök igen', '再从 SR 取一次新闻'));
      } else {
        const alt = TOPICS.filter((t) => t !== topic && ['idag', 'teknik', 'klimat', 'ekonomi'].includes(t.key));
        message(h('p', null, `Sveriges Radio 最近几天没有「${topic.zh}」的文章（SR 的新闻源每个节目只保留最新的 20 篇左右）。`),
          h('p', null, '先看看别的话题吧：'),
          h('div', { class: 'next-row' }, alt.map((t) => tip(h('button', { type: 'button', onclick: () => showTopic(t) }, t.zh), t.sv, `看「${t.zh}」的新闻`))));
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
    els.list.append(h('p', { class: 'safari-hint page-tr-hint', lang: 'zh-CN' }, PAGE_TR_HINT));
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
      tip(h('button', { type: 'button', onclick: (e) => { e.currentTarget.blur(); showTopic(topic, true); } }, cur.more ? '换一批 →' : '从最新的重新列 →'),
        cur.more ? 'Fler artiklar' : 'Börja om från de senaste',
        cur.more ? `「${topic.zh}」的下一批文章` : '都列过了，从最新的文章重新列')));
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
    hlW = null;
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
    hlW = null;
    if (cur.view === 'list') cur.listScroll = window.scrollY;
    if (push && !(history.state && history.state.sv === 'article')) {
      try { history.pushState({ sv: 'article', id: item.id }, ''); } catch (e) { /* 不支持就算了 */ }
    }
    cur.item = item;
    SV.sources.markRead(item.id);
    // 换了一篇文章：上一篇合成好的云端语音放掉（同一篇再打开时还留着；循环朗读重读时不再花额度）
    if (SV.cloud && SV.cloud.forget && lastArticleId !== item.id) SV.cloud.forget();
    lastArticleId = item.id;
    mediaMeta(item);
    if (useCloud()) SV.cloud.warm(); // 先下载语音 SDK、拿令牌（不花额度），点「朗读」时快一点
    const topic = cur.topic;
    const art = els.article;
    art.textContent = '';
    art.dataset.id = item.id;
    const today = SV.stockholmDay(new Date()) === item.day;
    const back = () => tip(h('button', { type: 'button', class: 'back-btn', lang: 'zh-CN', onclick: (e) => { e.currentTarget.blur(); backToList(false); } }, `← 返回「${topic.zh}」列表`),
      'Tillbaka till listan', `返回「${topic.zh}」列表`);
    // 文章开头的「返回列表」放在顶栏标题旁边（setView 显示它），省一行
    els.back.querySelector('.long').textContent = `← 返回「${topic.zh}」列表`;
    tip(els.back, 'Tillbaka till listan', `返回「${topic.zh}」列表`);
    art.append(h('div', { class: 'meta', lang: 'zh-CN' },
      item.easy ? h('span', { class: 'badge', title: '这篇是用简易瑞典语写的' }, '简易瑞典语') : null,
      today ? h('span', { class: 'badge today' }, '今天') : null,
      h('span', { lang: 'sv' }, item.program),
      h('span', null, when(item, true)),
      h('a', { href: item.link, target: '_blank', rel: 'noopener' }, '原文 ↗')));
    art.append(h('p', { class: 'safari-hint page-tr-hint', lang: 'zh-CN' }, PAGE_TR_HINT));
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
      idx >= 0 && idx < cur.batch.length - 1
        ? tip(h('button', { type: 'button', onclick: (e) => { e.currentTarget.blur(); nextArticle(); } }, '下一篇 →'), 'Nästa artikel', '列表里的下一篇')
        : tip(h('button', { type: 'button', onclick: (e) => { e.currentTarget.blur(); nextArticle(); } }, '下一批 →'), 'Fler artiklar', '这一批读完了，列下一批')));
    els.notice.hidden = true;
    setView('article');
    window.scrollTo({ top: 0 });
  }

  // 「下一篇」（播放栏、文章末尾、锁屏界面的「下一首」）：列表里的下一篇；最后一篇之后换下一批（这时停下）。
  // 正在朗读时，打开下一篇后接着朗读，开着循环朗读就循环读新的这一篇；暂停着或没在读时只打开，不读。
  function nextArticle() {
    if (!cur.topic) return;
    const reading = reader.state === 'speaking';
    const idx = cur.item ? cur.batch.indexOf(cur.item) : -1;
    if (idx >= 0 && idx < cur.batch.length - 1) {
      openArticle(cur.batch[idx + 1], false);
      if (reading) startReading();
    } else {
      if (history.state && history.state.sv === 'article') { try { history.replaceState(null, ''); } catch (e) { /* 忽略 */ } }
      showTopic(cur.topic, true);
    }
  }
  // 锁屏界面的「上一首」：列表里的上一篇（正在读时接着读）；已经是第一篇时，正在读的话从头再读这一篇
  function prevArticle() {
    if (!cur.topic || cur.view !== 'article') return;
    const reading = reader.state === 'speaking';
    const idx = cur.item ? cur.batch.indexOf(cur.item) : -1;
    if (idx > 0) {
      openArticle(cur.batch[idx - 1], false);
      if (reading) startReading();
    } else if (reading) {
      reader.play(0, 0);
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

  // hasSent：弹出框里有「本句译文」（文章里的一个词）
  function trErrorText(e, hasSent) {
    if (!e) return '翻译失败';
    // 微软翻译的免费额度用完了才落到后面的：说一声
    const az = e.azure === 'quota' ? '微软翻译的免费额度用完了，' : '';
    if (e.code === 'needClick') return az + '点一下这个词，用 MyMemory 在线翻译';
    if (e.code === 'needGesture') return az + '点一下这个词，启用浏览器内置的翻译';
    if (isOffError(e)) return offText(e);
    if (e.code === 'none') return az + '这个浏览器没有可用的翻译';
    if (e.code === 'unreliable') return az + '在线翻译没有给出可靠的译文' + (hasSent ? '，看看「本句译文」' : '');
    if (e.code === 'quota') return az ? az + 'MyMemory 今天的免费额度也用完了，明天再来，或者换 Chrome / Edge 电脑版（有内置翻译）' : '今天的免费在线翻译额度用完了，明天再来，或者换 Chrome / Edge 电脑版（有内置翻译）';
    if (e.code === 'network') return az + '在线翻译服务没有回应（网络不通、今天的额度用完了，或者被内容拦截器挡住了）';
    return az + (e.message || '翻译失败');
  }
  // 微软翻译只是这会儿不行（连不上、超时、太忙、出错、设置不对、这一句太长）
  const AZ_TRANSIENT = ['network', 'server', 'busy', 'broken', 'long'];
  // MyMemory 关着、又没有内置翻译时：说清楚到底是怎么回事。微软翻译只是暂时连不上时，先说这个，打开 MyMemory 只是另一个办法
  function offText(e) {
    if (AZ_TRANSIENT.includes(e.azure)) return '微软翻译暂时用不了（连不上或者出错了），这个浏览器又没有内置翻译。过一会儿再试；也可以打开 MyMemory 在线翻译（开关在顶部齿轮按钮「设置」里）。';
    if (e.azure === 'quota') return '微软翻译的免费额度用完了，MyMemory 在线翻译又关着（开关在顶部齿轮按钮「设置」里），这个浏览器也没有内置翻译。';
    return '在线翻译关着（开关在顶部齿轮按钮「设置」里），这个浏览器又没有内置翻译。';
  }
  const ENGINE = { azure: '微软翻译', builtin: '浏览器内置翻译', mymemory: 'MyMemory 在线翻译', cache: '' };
  // 弹出框最下面那一行小字：用的哪个翻译；微软翻译的额度用完了才用别的时，说一声
  const engineLabel = (r) => (ENGINE[r.engine] ? ENGINE[r.engine] + (r.engine !== 'azure' && r.azure === 'quota' ? '（微软翻译的免费额度用完了）' : '') : '');

  function onDownload(p) {
    toast(`正在下载浏览器的瑞典语→中文翻译模型：${Math.round((p || 0) * 100)}%`, 3000);
  }

  // 整句译文先占多大地方：中文译文的字数一般是瑞典语句子长度的 0.28–0.37 倍（2026-11-13 的评估集，140 句），
  // 按 0.37 倍、一行 21 个字估；最多 4 行，更长的在格子里滚动。这样译文来的时候大多不用再长高（评估集里 140 句有 7 句长高一行）
  const sentenceLines = (sv) => SV.clamp(Math.ceil((sv.length * 0.37) / 21), 1, 4);
  let senseApplied = 0; // 给测试看：按这一句选词义的结果真的放进弹出框几次（换了词、关了以后回来的结果不算）

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
    // 小词典里的意思，一个一个分开（「判决；（口语）他们」是两个）
    const senses = gl ? SV.sense.senses(gl) : [];
    const sentence = isWord && cur.model ? cur.model.sentences[si] : null;
    // 有几个意思（Tony 定的）：自动显示这一句的译文；js/sense.js 确定时，给那个意思和整句译文里这个词的译文画下划线。
    // 鼠标只是停在词上时不用 MyMemory：只剩 MyMemory 时不自动翻这一句，只有意思和「本句译文」
    const auto = !!sentence && senses.length >= 2 && (pinned || SV.tr.hoverCanTranslate());
    p.classList.toggle('multi', auto);
    p.append(h('div', { class: 'pw' }, h('b', { lang: 'sv' }, text)));
    if (gl) {
      const box = h('div', { class: 'gl' });
      gl.forEach((e, ei) => {
        const line = h('div', null, e.lemma !== text.toLowerCase() ? h('i', { lang: 'sv' }, e.lemma + '：') : null);
        senses.filter((x) => x.entry === ei).forEach((x, j) => {
          if (j) line.append('；');
          x.el = h('span', { class: 'sense' }, x.text);
          line.append(x.el);
        });
        if (e.guessed) line.append(h('i', null, '（按词形推测的原形）'));
        box.append(line);
      });
      p.append(box);
    }
    let ctxs = null;
    if (auto) {
      ctxs = h('div', { class: 'ctxs wait', 'data-why': 'wait' }, '正在翻译这一句…');
      ctxs.style.minHeight = 'calc(' + sentenceLines(sentence.text) * 1.6 + 'em + 7px)'; // 7px：上面的虚线和空隙（border-box）
      p.append(ctxs);
    }
    // 小词典里没有的词才交给翻译引擎（单独发这个词）；小词典里有的，意思直接显示，不花在线翻译的额度
    const mt = h('div', { class: 'mt wait' }, '翻译中…');
    const needMt = !gl;
    if (needMt) p.append(mt);
    const acts = h('div', { class: 'acts' });
    const bSpeak = isWord ? tip(h('button', { type: 'button' }), 'Läs upp ordet', '读这个词') : tip(h('button', { type: 'button' }), 'Läs upp', '读选中的词句');
    bSpeak.innerHTML = ICON_SPEAK + '<span>读</span>';
    bSpeak.addEventListener('click', (e) => { e.stopPropagation(); reader.speakText(text); });
    acts.append(bSpeak);
    let bSent = null;
    if (isWord) {
      const bFrom = tip(h('button', { type: 'button' }), 'Läs härifrån', '从这个词开始朗读');
      bFrom.innerHTML = ICON_PLAY + '<span>从这里读</span>';
      bFrom.addEventListener('click', (e) => { e.stopPropagation(); hidePopup(); reader.play(si, wi); });
      acts.append(bFrom);
      const sentBox = h('div', { class: 'sent', hidden: true });
      bSent = tip(h('button', { type: 'button' }, '本句译文'), 'Översätt meningen', '翻译这个词所在的整句');
      // 和自动显示的整句译文是同一个翻译、同一个缓存：一句只花一次额度
      bSent.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = cur.model && cur.model.sentences[si];
        if (!s) return;
        if (ctxs) {
          if (!ctxs.hidden && ctxs.dataset.why !== 'wait' && ctxs.dataset.why !== 'fail') {
            // 整句译文已经在上面了：让那一格闪一下（只换底色，弹出框不变），滚回开头
            ctxs.scrollTop = 0;
            ctxs.classList.remove('flash');
            void ctxs.offsetWidth;
            ctxs.classList.add('flash');
            clearTimeout(ctxs.flashTimer);
            ctxs.flashTimer = setTimeout(() => ctxs.classList.remove('flash'), 900);
            return;
          }
          // 还在等（可能是鼠标停着开始的：不能下载内置翻译的模型、不能用 MyMemory），或者刚才没翻成：点的这一次自己再翻，
          // 结果放在同一个格子里。微软翻译那一步和还在等的那一次共用一个请求（js/translate.js），不多花额度
          ctxs.hidden = false;
          ctxs.dataset.clicked = '1';
          fillInto(ctxs, () => translateText(s.text), 'ctxs', 'ctxs err', eng, null, () => ctxs.dataset.why !== 'wait' && ctxs.dataset.why !== 'fail');
          return;
        }
        sentBox.hidden = false;
        fillInto(sentBox, () => translateText(s.text), 'sent', 'sent err', null);
      });
      acts.append(bSent);
      p.append(acts, sentBox);
    } else {
      p.append(acts);
    }
    // 最下面那一行小字（用的哪个翻译）。有几个意思的词先占好这一行，整句译文来的时候弹出框不长高
    const eng = h('div', { class: 'eng' }, auto ? ' ' : null);
    p.append(eng);
    p.hidden = false;
    placePopup();
    if (auto) fillSentence(ctxs, sentence, sentence.words[wi], senses, gl, pinned, eng);
    if (!needMt) return;
    const short = isWord || text.split(/\s+/).length <= 3;
    // explicit：读者点了按钮重试（「打开在线翻译」）：就算弹出框是鼠标停着打开的，这一次也算点出来的
    fillInto(mt, (explicit) => (short
      ? SV.tr.translate(text, 'word', { gesture: pinned || explicit, online: S.online !== false, mm: pinned || explicit, onDownload })
      : translateText(text)), 'mt', 'mt err', eng, bSent);
  }

  // 有几个意思的词：意思已经都列出来了，这里自动放上这一句的译文。
  // 能挑的词（js/sense.js）先请微软翻译把这个词包在 <b> 里翻译整句：确定时，给那个意思画下划线，整句译文里这个词的译文也画下划线；
  // 不确定、或者微软翻译用不了（再用内置翻译、MyMemory 翻整句）：只放整句译文，不画。
  // 结果回来时弹出框已经关了、或者换到别的词上了，就不管它。整句也翻不了：收起这一格，不报错（点「本句译文」能看到原因）。
  async function fillSentence(box, s, w, senses, gl, pinned, eng) {
    const token = pop.token;
    const put = (zh, res, r) => {
      senseApplied++;
      box.textContent = '';
      box.className = 'ctxs';
      box.dataset.why = res ? res.why : 'plain';
      if (res && res.index >= 0 && res.start >= 0 && res.end <= zh.length) {
        box.append(zh.slice(0, res.start), h('span', { class: 'key', title: '这个词在这一句里的译文' }, zh.slice(res.start, res.end)), zh.slice(res.end));
        const best = senses[res.index];
        if (best && best.el) {
          best.el.classList.add('best');
          best.el.title = '符合这句的意思';
          best.el.append(h('span', { class: 'sr' }, '（符合这句的意思）'));
        }
      } else {
        box.append(zh);
      }
      if (eng && !eng.textContent.trim()) eng.textContent = engineLabel(r) || ' ';
      placePopup();
    };
    if (SV.sense.pickable(gl, senses) && SV.tr.azureState() === 'ok') {
      try {
        const r = await SV.tr.tagged(s.text, w.start, w.end);
        if (token !== pop.token) return;
        const parsed = SV.sense.parseTagged(r.html);
        if (parsed.text) {
          SV.tr.rememberText(s.text, parsed.text);
          put(parsed.text, SV.sense.pickTagged(senses, parsed), r);
          return;
        }
      } catch (e) {
        if (token !== pop.token) return; // 落到普通的整句翻译
      }
    }
    try {
      const r = await translateText(s.text, { gesture: pinned, mm: pinned });
      if (token !== pop.token) return;
      put(r.zh, null, r);
    } catch (e) {
      if (token !== pop.token || box.dataset.clicked) return; // 点了「本句译文」：那边自己显示结果或原因
      box.hidden = true;
      box.dataset.why = 'fail';
      placePopup();
    }
  }

  // 在线翻译是不是因为被关掉才没法用
  function isOffError(e) {
    return !!e && (e.code === 'disabled' || (e.code === 'none' && S.online === false));
  }
  // 在弹出框的一个格子里放译文。在线翻译关着时，给一个「打开在线翻译」按钮：一点就打开，马上重新翻译
  // （微软翻译只是暂时连不上时，这个按钮不醒目：先说暂时连不上，打开 MyMemory 只是另一个办法）。
  // MyMemory 给单词的译文不可靠时，说一声，并把下面那个「本句译文」按钮（bSent，弹出框是文章里的一个词时才有）变成醒目的样子。
  // skip()：结果回来时如果它说「已经有了」（别的途径先放好了），就不放。
  // run(explicit)：explicit 是 true 时，是读者点了按钮重试（不管弹出框是不是鼠标停着打开的，都算点出来的）
  function fillInto(box, run, okClass, errClass, eng, bSent, skip) {
    const token = pop.token;
    box.className = errClass.replace(' err', '') + ' wait';
    box.textContent = '翻译中…';
    placePopup();
    Promise.resolve().then(() => run(false)).then((r) => {
      if (token !== pop.token || (skip && skip())) return;
      if (!r) {
        box.textContent = '没有翻译';
        box.className = errClass;
      } else {
        box.textContent = r.zh;
        box.className = okClass;
        if (eng) eng.textContent = engineLabel(r);
      }
      placePopup();
    }, (err) => {
      if (token !== pop.token || (skip && skip())) return;
      box.textContent = trErrorText(err, !!bSent);
      box.className = errClass;
      if (err && err.code === 'unreliable' && bSent) bSent.classList.add('primary');
      if (isOffError(err)) {
        const quiet = AZ_TRANSIENT.includes(err.azure);
        const b = tip(h('button', { type: 'button', class: quiet ? 'on-btn' : 'primary on-btn' }, '打开在线翻译'), 'Slå på onlineöversättning', '打开 MyMemory 在线翻译，马上重新翻译');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          pop.pinned = true;
          turnOnline();
          fillInto(box, () => run(true), okClass, errClass, eng);
        });
        box.append(h('br'), b);
      }
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

  // 本句译文、选中的几个词、自动显示的整句译文：和查词一样的顺序（js/translate.js）：微软翻译，用不了时浏览器内置翻译
  // （Chrome、Edge 电脑版），再不行用 MyMemory（默认开着，在「设置」里关了就不用）。
  // opts.gesture、opts.mm：是不是读者点出来的。鼠标只是停在词上时都是 false：不能开始下载内置翻译的模型，也不用 MyMemory（Tony 定的）
  async function translateText(text, opts = {}) {
    const cached = SV.tr.cachedText(text);
    if (cached) return { zh: cached, engine: 'cache' };
    return SV.tr.translate(text, 'text', { gesture: opts.gesture !== false, mm: opts.mm !== false, online: S.online !== false, onDownload });
  }

  // 「打开在线翻译」按钮：一点就打开（关掉的开关在顶部齿轮按钮「设置」里）
  function turnOnline() {
    S.online = true;
    save();
    syncSettingsForm();
    toast('已打开在线翻译（MyMemory）。不想用时，可以在顶部齿轮按钮「设置」里关掉。', 4000);
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
    if (e.key === 'Escape') { if (pop.open) hidePopup(); if (!els.guide.hidden) hideGuide(); return; }
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
  // 页面藏起来（切到别的标签页、窗口最小化、手机锁屏）时不暂停，接着读。回到前台时，标记已经在正在读的词上，
  // 滚过去（不重读）；本机的声音如果被系统停掉了（手机锁屏），从停下的词接着读。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || reader.state !== 'speaking') return;
    if (reader.kick) reader.kick();
    if (hlW) ensureVisible(hlW);
  });

  // 锁屏界面、通知栏、媒体键（见上面 Media Session）
  mediaAction('play', () => { if (cur.view === 'article' && reader.state !== 'speaking') startReading(); });
  mediaAction('pause', () => { if (reader.state === 'speaking') reader.pause(); });
  mediaAction('stop', () => { if (reader.state !== 'idle') { reader.stop(); highlight(-1, -1, false); } });
  mediaAction('nexttrack', () => { if (cur.view === 'article') nextArticle(); });
  mediaAction('previoustrack', () => { if (cur.view === 'article') prevArticle(); });

  // 播放栏
  els.play.addEventListener('click', () => { els.play.blur(); startReading(); });
  // 循环朗读：读完这一篇从头再读，直到按暂停、点「下一篇」（接着循环读下一篇）或者把它关掉；
  // 读的时候关掉，这一遍读完就停
  els.loop.addEventListener('click', () => {
    els.loop.blur();
    S.loop = !S.loop;
    save();
    updateButtons();
    toast(S.loop ? '循环朗读：开。读完这一篇从头再读，直到按暂停' : '循环朗读：关。读完这一遍就停', 2500);
  });
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
    S.cloudVoice = '';
    save();
    refreshVoice();
    syncSettingsForm();
    const want = S.gender === 'm' ? '男声' : '女声';
    if (useCloud()) toast(`${want}：${cloudVoice().label}（云端自然语音）`, 2500);
    else if (!voiceInfo.voice) toast('这台设备上没有瑞典语声音（详见「设置」）');
    else if (!voiceInfo.exact) toast(`这台设备没有瑞典语${want}，现在用的是 ${voiceInfo.voice.name}`, 5000);
    else toast(`${want}：${voiceInfo.voice.name}`, 2500);
    if (reader.state === 'speaking') reader.play(reader.si, reader.wi);
  });
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
    // 云端的声音直接改播放速度；本机的声音要从当前的词重新读
    if (reader.rateChanged) reader.rateChanged();
    else if (reader.state === 'speaking') reader.play(reader.si, reader.wi);
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
  els.back.addEventListener('click', () => { els.back.blur(); backToList(false); });

  // 「怎么用」小说明：鼠标停在顶栏标题上时出现，移开就消失（不挡住下面的话题按钮）；
  // 手机上点一下标题打开，点别处关上（点到的按钮照常起作用）。
  let guidePinned = false;
  const showGuide = (pin) => { els.guide.hidden = false; guidePinned = guidePinned || !!pin; };
  const hideGuide = () => { els.guide.hidden = true; guidePinned = false; };
  els.brand.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showGuide(false); });
  els.brand.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !guidePinned) hideGuide(); });
  els.brand.addEventListener('click', () => { if (guidePinned) hideGuide(); else showGuide(true); });
  els.brand.addEventListener('focus', () => showGuide(false));
  els.brand.addEventListener('blur', () => { if (!guidePinned) hideGuide(); });
  els.brand.addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (els.guide.hidden) showGuide(true); else hideGuide(); } });
  document.addEventListener('pointerdown', (e) => {
    if (els.guide.hidden || els.brand.contains(e.target) || els.guide.contains(e.target)) return;
    hideGuide();
  }, true);

  // ---------- 设置对话框 ----------
  const selVoice = $('#selVoice');
  const CLOUD_NOTE = '云端自然语音：微软 Azure 的瑞典语神经语音，电脑、手机、任何浏览器上都一样。朗读时文章的文字发给微软的语音服务合成声音（Edge 浏览器的在线声音也是这样），要联网。';
  function fillVoiceSelect() {
    // 声音来源：只有设了云端语音（js/config.js 的 ttsUrl）才显示
    $('#engineRow').hidden = !cloudReader;
    const eng = cloudReader && S.engine === 'cloud' ? 'cloud' : 'device';
    for (const r of document.querySelectorAll('#engineRow input[name="engine"]')) r.checked = r.value === eng;
    selVoice.textContent = '';
    const note = $('#voiceNote');
    if (useCloud()) {
      for (const v of SV.cloud.VOICES) selVoice.append(h('option', { value: v.name }, `${v.label}（${v.gender === 'm' ? '男' : '女'}，云端）`));
      selVoice.value = cloudVoice().name;
      note.textContent = CLOUD_NOTE;
      return;
    }
    const list = SV.speech.voices();
    selVoice.append(h('option', { value: '' }, `自动（${S.gender === 'm' ? '男声' : '女声'}优先）`));
    for (const x of list) {
      const g = x.gender === 'f' ? '女' : x.gender === 'm' ? '男' : '性别不明';
      selVoice.append(h('option', { value: x.v.voiceURI }, `${x.v.name}（${g}）`));
    }
    selVoice.value = list.some((x) => x.v.voiceURI === S.voiceURI) ? S.voiceURI : '';
    let t;
    if (!SV.speech.supported) t = '这个浏览器不支持朗读。';
    else if (!list.length) t = '这台设备上没有瑞典语声音。办法：用 Edge 浏览器（自带微软的瑞典语在线声音 Sofie、Mattias）；Windows 可以在「设置 → 时间和语言 → 语音」里添加瑞典语语音；iPhone / iPad 在「设置 → 辅助功能 → 朗读内容 → 声音」里下载瑞典语声音；安卓在系统的「文字转语音」设置里安装瑞典语。';
    else t = `这台设备有 ${list.length} 个瑞典语声音。认不出男女的标为「性别不明」，可以试听后自己选。`;
    t += ' 手机锁屏后，这台设备的声音会停下（回到前台从停下的词接着读）；锁屏后继续朗读需要云端语音。';
    if (cloudReader && S.engine === 'cloud' && quotaOut()) t = '云端语音这个月的免费额度用完了，下个月自动再用；现在用的是这台设备自己的声音。' + t;
    else if (cloudReader && S.engine === 'cloud' && cloudDown) t = '云端语音这次没成功，现在用的是这台设备自己的声音；刷新网页会再试云端。' + t;
    note.textContent = t;
  }
  selVoice.addEventListener('change', () => {
    if (useCloud()) {
      const v = SV.cloud.voiceByName(selVoice.value);
      if (v) { S.cloudVoice = v.name; S.gender = v.gender; }
    } else {
      S.voiceURI = selVoice.value;
      const x = SV.speech.voices().find((v) => v.v.voiceURI === S.voiceURI);
      if (x && x.gender !== '?') S.gender = x.gender;
    }
    save();
    refreshVoice();
    if (reader.state === 'speaking') reader.play(reader.si, reader.wi);
  });
  // 声音来源：云端自然语音 / 这台设备自己的声音。选回云端时，之前出过的错不算，再试一次
  for (const r of document.querySelectorAll('#engineRow input[name="engine"]')) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      S.engine = r.value;
      if (r.value === 'cloud') { cloudDown = false; S.cloudOffMonth = ''; }
      save();
      switchReader();
      refreshVoice();
      fillVoiceSelect();
    });
  }
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
    if (!selVoice.options.length) return;
    if (useCloud()) selVoice.value = cloudVoice().name;
    else selVoice.value = SV.speech.voices().some((x) => x.v.voiceURI === S.voiceURI) ? S.voiceURI : '';
  }
  async function updateTrNote() {
    const a = await SV.tr.builtinAvailability();
    const u = SV.tr.mmUsage();
    const az = SV.tr.azureState();
    let t = '';
    if (az === 'quota') t = '微软翻译的免费额度用完了（每 6 小时再试一次）。';
    else if (az !== 'off') t = '查词和「本句译文」先用微软翻译（微软不保存收到的文字；免费额度所有读者共用，用完时自动改用下面的）。';
    const lead = az === 'off' ? '浏览器内置翻译：可用' : '微软翻译用不了时，用浏览器内置翻译';
    if (a === 'ready' || a === 'available') t += lead + '（在本机翻译，文字不离开这台设备，不限量）。';
    else if (a === 'downloadable' || a === 'downloading') t += lead + '。第一次用时浏览器要下载瑞典语→中文的翻译模型（点一个词就开始）。';
    else t += '这个浏览器没有内置翻译（Chrome、Edge 的电脑版才有）：' + (az === 'off' ? '' : '微软翻译用不了时，') + '查词和「本句译文」用 MyMemory 在线翻译；整篇翻译请用浏览器自带的翻译功能（' + PAGE_TR_HINT.replace('整篇翻译：', '') + '）。';
    if (u.chars) t += ` 今天已用 MyMemory 在线翻译约 ${u.chars} 个字符。`;
    $('#trNote').textContent = t;
  }

  // ---------- 开始 ----------
  document.documentElement.style.setProperty('--scale', S.scale);
  els.rate.querySelector('b').textContent = fmtRate(S.rate);
  // 页面上固定的按钮的瑞典文提示。朗读、男女声、下一篇、返回列表随状态变，
  // 由 updateButtons、refreshVoice、openArticle 再改；这里先给它们一个，免得哪个按钮没有提示。
  const STATIC_TIPS = [
    ['#btnSmaller', 'Mindre text', '字小一点'],
    ['#btnBigger', 'Större text', '字大一点'],
    ['#btnHelp', 'Hjälp', '怎么用'],
    ['#btnSettings', 'Inställningar', '设置：声音、语速、字号、在线翻译'],
    ['#btnBack', 'Tillbaka till listan', '返回列表'],
    ['#btnPlay', 'Läs upp', '先在列表里选一篇文章'],
    ['#btnRate', 'Talhastighet', '语速：点一下换一档'],
    ['#btnVoice', S.gender === 'm' ? 'Manlig röst' : 'Kvinnlig röst', '切换男声、女声'],
    ['#btnLoop', 'Upprepa', '循环朗读：读完这一篇从头再读'],
    ['#btnNext', 'Nästa artikel', '列表里的下一篇'],
    ['#btnTipClose', 'Jag förstår', '知道了，不再显示这条说明'],
    ['#btnTryVoice', 'Provlyssna', '试听这个声音'],
    ['#btnClearHistory', 'Rensa läshistoriken', '清除阅读记录'],
    ['#dlgSettings .dlg-actions button', 'Stäng', '关闭设置'],
    ['#dlgHelp .dlg-actions button', 'Okej', '关闭说明'],
  ];
  for (const [sel, sv, zh] of STATIC_TIPS) { const b = $(sel); if (b) tip(b, sv, zh); }
  renderChips();
  els.tip.hidden = !S.tip;
  SV.speech.onVoices(() => {
    refreshVoice();
    if ($('#dlgSettings').open) fillVoiceSelect();
  });
  save();
  // 内置翻译能不能用：没有时显示整页翻译的提示
  SV.tr.builtinAvailability().then((a) => setBuiltin(a !== 'unavailable'), () => setBuiltin(false));
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
      loop: S.loop === true,
      loops: reader.loops || 0,
      block: cur.model && cur.model.sentences[reader.si] ? cur.model.sentences[reader.si].block : -1,
      hidden: document.hidden,
      cloudCache: SV.cloud && SV.cloud.cacheSize ? SV.cloud.cacheSize() : 0,
      media: media && media.metadata ? { title: media.metadata.title, artist: media.metadata.artist, state: media.playbackState } : null,
      sentences: cur.model ? cur.model.sentences.length : 0,
      blocks: cur.model ? cur.model.blocks.length : 0,
      engine: useCloud() ? 'cloud' : 'device',
      voice: useCloud() ? cloudVoice().name : voiceInfo.voice ? voiceInfo.voice.name : null,
      voiceGender: useCloud() ? cloudVoice().gender : voiceInfo.gender,
      popup: pop.open ? { pinned: pop.pinned, text: pop.text } : null,
      senseApplied,
      settings: Object.assign({}, S),
    }),
  };
})();

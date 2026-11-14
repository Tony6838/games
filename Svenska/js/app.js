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
  // after：读完一篇以后怎么办（播放栏上的一个按钮，点一下换一种）：'stop' 读完就停（默认）、'next' 接着读列表里的下一篇、
  // 'loop' 本篇循环（从头再读）。旧版本的 loop: true（「循环」开着）当作 'loop'。
  // rate：语速只有 0.8、0.9、1 三档（Tony 定的，2026-11-14）；ramp：循序渐进三连读（第 1 遍 0.8×、第 2 遍 0.9×、第 3 遍 1×）。
  // 这些这个浏览器都记住；存不了（隐私模式等）时只在这次打开的页面里有效
  const DEFAULTS = { scale: 1, rate: 0.9, ramp: false, gender: 'f', voiceURI: '', engine: 'cloud', cloudVoice: '', cloudOffMonth: '', online: true, tip: true, topic: 'idag', after: 'stop' };
  const AFTER = ['stop', 'next', 'loop'];
  const RATES = [0.8, 0.9, 1];
  // 三连读的三遍：语速和为什么这样读
  const RAMP = [{ rate: 0.8, why: '慢读，便于理解' }, { rate: 0.9, why: '中速，便于练习' }, { rate: 1, why: '正常速度' }];
  let saved = SV.store.get(SET_KEY, {});
  if (!saved || typeof saved !== 'object') saved = {};
  const S = Object.assign({}, DEFAULTS, saved);
  delete S.level; // 旧版本的「简易优先」设置，不再用
  if (!AFTER.includes(saved.after)) S.after = saved.loop === true ? 'loop' : 'stop'; // 旧版本的「循环」开关（看存下来的，不看默认值）
  delete S.loop;
  // 设置的版本：第一版在说明框里点「不用」会把在线翻译一直关着（Safari 上点词只看到「在线翻译已关闭」）。
  // 现在在线翻译默认开着、不再先问，所以旧版本留下的状态一律改回默认一次；
  // 这个版本以后在「设置」里自己关掉的（v = 3），照样保留。
  if (S.v !== 3) { S.online = true; S.v = 3; }
  S.scale = SV.clamp(+S.scale || 1, 0.8, 1.8);
  // 旧版本存的别的语速（0.5–1.3）改成最近的一档：0.7 → 0.8，1.1、1.25 → 1
  const nearestRate = (r) => RATES.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) - 1e-9 ? x : best), RATES[0]);
  S.rate = nearestRate(+S.rate || 0.9);
  S.ramp = S.ramp === true;
  if (!['f', 'm'].includes(S.gender)) S.gender = 'f';
  if (!['cloud', 'device'].includes(S.engine)) S.engine = 'cloud';
  if (S.online !== false) S.online = true;
  const save = () => SV.store.set(SET_KEY, S);

  const TOPICS = SV.sources.TOPICS;
  // 本站不翻译整篇文章：整篇用浏览器自己的整页翻译。怎么用（这个浏览器的办法放在最前面）写在说明框「?」的「整篇翻译」里，
  // 列表和文章上不再显示（Tony 定的，2026-11-14：「可以转移到帮助里，不需要在主页出现」）；「设置」的翻译说明里也有。
  const UA = navigator.userAgent || '';
  const IS_IOS = /iP(hone|ad|od)/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1); // iPadOS 默认报成 Mac
  const IS_SAFARI = !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|MicroMessenger|YaBrowser|Mercury/i.test(UA) &&
    (IS_IOS || (/AppleWebKit/.test(UA) && /Safari\//.test(UA) && !/Chrome|Chromium|Edg|OPR|Firefox|Android/.test(UA)));
  const PAGE_TR_HINT = IS_SAFARI ? '整篇翻译：点地址栏「aA → 翻译成中文」'
    : /Firefox\/|FxiOS/.test(UA) ? '整篇翻译：用地址栏的翻译图标'
      : /Android/.test(UA) && /Chrome\//.test(UA) && !/EdgA|SamsungBrowser|OPR|YaBrowser|MicroMessenger/.test(UA) ? '整篇翻译：点右上角 ⋮ →「翻译…」'
        : '整篇翻译：用浏览器自带的翻译功能';
  const PAGE_TR_KNOWN = PAGE_TR_HINT !== '整篇翻译：用浏览器自带的翻译功能'; // 认出了是哪个浏览器
  // 内置翻译能不能用（瑞典语→中文），开始时查一次，记在 body 的 no-builtin 上（给测试看，样子不跟着变）
  function setBuiltin(ok) {
    document.body.classList.toggle('no-builtin', !ok);
  }
  const BATCH = 9; // 一批几篇
  const els = {
    topbar: $('#topbar'), topics: $('#topics'), list: $('#list'), article: $('#article'), main: $('#main'), notice: $('#notice'), tip: $('#tip'),
    popup: $('#popup'), toast: $('#toast'), player: $('#player'),
    play: $('#btnPlay'), rate: $('#btnRate'), voice: $('#btnVoice'), after: $('#btnAfter'), next: $('#btnNext'),
    back: $('#btnBack'), brand: $('#brand'), guide: $('#guide'), topicSel: $('#topicSel'),
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
  // 没有这个接口的浏览器什么都不做。「读完以后」（读完就停、接着读下一篇、本篇循环）和三连读没有系统按钮，只能在页面上选。
  // 三连读时，标题下面那一行前面写着第几遍（「第 2/3 遍 0.9× · 节目 · Sveriges Radio」）。
  const media = (typeof navigator !== 'undefined' && navigator.mediaSession) || null;
  function mediaMeta(item) {
    if (!media || typeof MediaMetadata === 'undefined') return;
    try {
      media.metadata = item ? new MediaMetadata({
        title: item.title,
        artist: (S.ramp ? `第 ${ramp.pass + 1}/3 遍 ${fmtRate(curRate())} · ` : '') + item.program + ' · Sveriges Radio',
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
    // 按了锁屏界面、媒体键的按钮：读者在，「接着读下一篇」重新数（见 AUTO_NEXT_MAX）
    try { media.setActionHandler(name, (d) => { userActed(); fn(d); }); } catch (e) { /* 这个浏览器不支持这个动作 */ }
  }

  // ---------- 三连读、读完以后 ----------
  // 三连读（S.ramp）：一篇读三遍，第 1 遍 0.8×（慢读，便于理解）、第 2 遍 0.9×（练习）、第 3 遍 1×（正常速度），
  // 每遍之间停一下（GAP_MS），滚回开头。三遍读完以后，和不用三连读时一样按「读完以后」：停下、接着读下一篇（又从第 1 遍开始）、
  // 本篇循环（三遍再来一次）。暂停、继续都在这一遍里；打开别的文章、下一篇、回到列表、停止，都回到第 1 遍。
  const ramp = { pass: 0 }; // 正在读第几遍（0、1、2）
  const curRate = () => (S.ramp ? RAMP[ramp.pass].rate : S.rate);
  const fmtRate = (r) => (Math.round(r * 100) / 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + '×';
  // 一篇（或三连读的一遍）读完，停一下再接着读（下一遍、下一篇、本篇循环）。等的时候 reader 是 hold() 的样子：
  // 状态还是「正在读」，云端语音一直循环播静音（锁屏时也接得上）。按暂停、停止、打开别的文章、回到列表就不接着读了。
  const GAP_MS = 1500;
  let gap = null; // { tok, kind, timer }：等着接着读（停一下的定时器、或者正在取下一批）；kind 是 afterThis() 当时的回答
  let gapTok = 0;
  function cancelGap() {
    if (gap) clearTimeout(gap.timer);
    gap = null;
    gapTok++;
  }
  // 这一遍（这一篇）读完以后做什么：'pass' 三连读的下一遍；不然按「读完以后」：'stop'、'next'、'loop'
  const afterThis = () => (S.ramp && ramp.pass < RAMP.length - 1 ? 'pass' : S.after);
  // 「接着读下一篇」没人管的时候最多连着自动读几篇：云端语音的免费额度所有读者共用（每月约 50 万个字符），
  // 不让一台没人听的手机把一个话题的文章全读完。读者在页面上点了、按了键，或者按了锁屏界面的按钮，就从头数。
  // 读完第 AUTO_NEXT_MAX 篇停下，说一声；点 ▶ 接着读下一篇。
  const AUTO_NEXT_MAX = 10;
  let autoNextMax = AUTO_NEXT_MAX; // 测试可以改小（SVApp.setAutoNextMax）
  let autoCount = 0; // 读者没碰页面，连着自动打开、读了几篇
  let capNext = false; // 停在了第 AUTO_NEXT_MAX 篇：点 ▶ 接着读下一篇
  const userActed = () => { autoCount = 0; };
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, userActed, true);

  let voiceInfo = { voice: null, gender: '?', exact: false };
  let cloudDown = false;
  const hooks = {
    sentences: () => (cur.view === 'article' && cur.model ? cur.model.sentences : []),
    blocks: () => (cur.view === 'article' && cur.model ? cur.model.blocks : []),
    voice: () => voiceInfo.voice,
    voiceName: () => cloudVoice().name,
    rate: () => curRate(),
    // 读完马上从头再读（reader 自己做，不停顿）：只有「本篇循环」而且不是三连读（三连读的三遍由下面的 onEnd 接着读）
    loop: () => S.after === 'loop' && !S.ramp,
    // 整篇读完（不是上面的循环）：要接着读（三连读的下一遍、下一篇、三连读的本篇循环）就回 true，reader 先 hold() 等着
    onEnd: () => articleEnded(),
    onState: (st) => {
      document.body.classList.toggle('speaking', st === 'speaking');
      document.body.classList.toggle('paused', st === 'paused');
      const pass0 = ramp.pass;
      if (st !== 'speaking' && gap) {
        const g = gap;
        cancelGap();
        if (st === 'paused') {
          // 等着接着读的时候按了暂停：不接着读了，停在这一篇的开头（再点 ▶ 从头读）。三连读的两遍之间：再点 ▶ 读下一遍；
          // 三遍都读完了（等着读下一篇、再来三遍）：回到第 1 遍（不读第四遍）
          if (g.kind === 'pass') { if (S.ramp && ramp.pass < RAMP.length - 1) ramp.pass++; } else if (S.ramp && !g.at) ramp.pass = 0;
          // 读的时候在这一批的最后一篇点了「下一篇」、正在取下一批：停在原来读到的地方
          if (g.at) { reader.si = g.at.si; reader.wi = g.at.wi; highlight(g.at.si, g.at.wi, true); }
        }
      }
      if (st === 'idle') ramp.pass = 0; // 停下了：下次从第 1 遍开始
      if (ramp.pass !== pass0 && cur.item && S.ramp) mediaMeta(cur.item);
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
    // 三连读：还在这一遍里（停下旧的声音会把它放回第 1 遍）。两遍之间换的：停在下一遍的开头；三遍都读完、等着读下一篇或再来时：第 1 遍
    const g = reader.held ? gap : null;
    let pass = ramp.pass;
    if (g && g.kind === 'pass') pass = Math.min(pass + 1, RAMP.length - 1);
    else if (g && S.ramp && !g.at) pass = 0;
    reader.stop();
    reader = next;
    reader.si = g && g.at ? g.at.si : si;
    reader.wi = g && g.at ? g.at.wi : wi;
    if (was !== 'idle') { ramp.pass = pass; reader.setState('paused'); }
  }

  function cloudFailed(e) {
    const was = reader.state;
    cloudDown = true;
    if (e && e.code === 'quota') { S.cloudOffMonth = monthKey(); save(); } // 这个月里不再先试云端
    const why = e && e.code === 'quota' ? '云端语音这个月的免费额度用完了，下个月自动再用'
      : e && (e.code === 'forbidden' || e.code === 'auth') ? '云端语音的设置有问题（令牌服务或 Azure 密钥）'
        : e && e.code === 'network' ? '连不上云端语音'
          : '云端语音这次没成功';
    toast(why + '，先改用这台设备自己的声音' + (was !== 'idle' ? '，点蓝色的 ▶ 按钮接着读。' : '。'), 6000);
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
    // 按钮上只有一个字（女 / 男）；读屏软件听到的是「女声」「男声」，提示里有瑞典文和现在的声音
    els.voice.querySelector('b').textContent = g === 'm' ? '男' : g === 'f' ? '女' : '声';
    els.voice.setAttribute('aria-label', g === 'm' ? '男声' : g === 'f' ? '女声' : '声音');
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
    if (capNext && reader.state === 'idle' && S.after === 'next') {
      // 连着自动读了 AUTO_NEXT_MAX 篇停下了：点 ▶ 接着读下一篇（先「读起来」，下面的「下一篇」就打开下一篇接着读；
      // 这一批的最后一篇时取下一批接着读）
      capNext = false;
      autoCount = 0;
      reader.play(0, 0);
      nextArticle();
      return;
    }
    capNext = false;
    if (S.ramp && reader.state === 'idle') toast(passText(), 3000);
    reader.toggle();
  }
  // 三连读这一遍的说明（提示条、提示）：「三连读 第 2 遍：0.9×，中速，便于练习」
  const passText = () => `三连读 第 ${ramp.pass + 1} 遍：${fmtRate(curRate())}，${RAMP[ramp.pass].why}`;

  // ---------- 播放栏的按钮随页面变 ----------
  // 按钮上只有图标（Tony 定的，2026-11-14：「有图标就够了，这样可以有更大的阅读空间」）：
  // 说明在 aria-label（读屏软件）和 tip() 的提示里（瑞典文 + 中文，电脑上鼠标停着、手机上按住半秒）。
  const AFTER_INFO = {
    stop: { sv: 'Stoppa efter artikeln', zh: '读完就停', tip: '读完这一篇就停（点一下换成「接着读下一篇」）', toast: '读完就停：读完这一篇就停下' },
    next: { sv: 'Fortsätt med nästa artikel', zh: '接着读下一篇', tip: '读完这一篇，接着读列表里的下一篇（点一下换成「本篇循环」）', toast: '接着读下一篇：读完这一篇，自动打开列表里的下一篇接着读' },
    loop: { sv: 'Upprepa artikeln', zh: '本篇循环', tip: '读完这一篇从头再读，一遍又一遍，直到按暂停（点一下换成「读完就停」）', toast: '本篇循环：读完这一篇从头再读，直到按暂停' },
  };
  function updateButtons() {
    const inArticle = cur.view === 'article' && !!cur.model;
    const inList = cur.view === 'list';
    // 朗读（▶ / ❚❚）
    const st = reader.state;
    els.play.setAttribute('aria-label', st === 'speaking' ? '暂停' : st === 'paused' ? '继续' : '朗读');
    els.play.disabled = !inArticle;
    tip(els.play, st === 'speaking' ? 'Pausa' : st === 'paused' ? 'Fortsätt' : 'Läs upp',
      !inArticle ? '先在列表里选一篇文章'
        : st === 'speaking' ? '暂停（空格键也可以）'
          : st === 'paused' ? '从停下的地方接着读（空格键也可以）' : '朗读这篇文章（空格键也可以）');
    // 语速：0.8× → 0.9× → 1× → 三连读 → 0.8×。三连读时按钮上是这一遍的语速和三级台阶（亮的是第几遍）
    const r = curRate();
    els.rate.querySelector('b').textContent = fmtRate(r);
    els.rate.classList.toggle('ramp', S.ramp);
    els.rate.dataset.pass = S.ramp ? String(ramp.pass + 1) : '';
    if (S.ramp) {
      els.rate.setAttribute('aria-label', `语速：三连读，第 ${ramp.pass + 1} 遍，${fmtRate(r)}`);
      tip(els.rate, 'Steg för steg: läs tre gånger', `循序渐进三连读：现在第 ${ramp.pass + 1} 遍，${fmtRate(r)}（第 1 遍 0.8× 慢读，第 2 遍 0.9× 练习，第 3 遍 1× 正常速度；点一下换成 0.8×）`);
    } else {
      els.rate.setAttribute('aria-label', `语速 ${fmtRate(r)}`);
      tip(els.rate, 'Talhastighet ' + fmtRate(r).replace('.', ','), r === 1 ? '语速 1×（点一下换成循序渐进三连读：0.8×、0.9×、1× 各读一遍）' : `语速 ${fmtRate(r)}（点一下换一档：0.8×、0.9×、1×、三连读）`);
    }
    // 读完以后：读完就停 → 接着读下一篇 → 本篇循环，任何时候都能按
    const a = AFTER_INFO[S.after];
    els.after.dataset.mode = S.after;
    els.after.classList.toggle('on', S.after !== 'stop');
    els.after.setAttribute('aria-label', '读完以后：' + a.zh); // 三种状态：读屏软件听 aria-label，不用 aria-pressed
    tip(els.after, a.sv, '读完以后：' + a.tip);
    // 下一篇 / 换一批
    els.next.disabled = !(inArticle || inList);
    els.next.setAttribute('aria-label', inList ? '换一批' : '下一篇');
    if (inList) tip(els.next, 'Fler artiklar', `「${cur.topic ? cur.topic.zh : ''}」的下一批文章`);
    else tip(els.next, 'Nästa artikel', st === 'speaking' ? '列表里的下一篇，接着朗读' : '列表里的下一篇');
  }

  // ---------- 话题 ----------
  // 电脑、平板上是一排话题按钮；手机上是标题旁边的下拉菜单（css/style.css 按屏幕宽度显示其中一个），
  // 两个都用 TOPICS 这一张表做，选了以后都走 chooseTopic。再点一次同一个话题换一批（菜单里选同一个不算换，
  // 手机上换一批用列表最下面的「换一批」或播放栏最右边的按钮）。
  // 正在取文章（loading）时再点同一个话题不算「换一批」（还没列出来）；但「接着读下一篇」在取下一批时（还有 gap），
  // 和平常一样换一批（朗读停下，列出下一批）
  function chooseTopic(t) {
    showTopic(t, cur.topic === t && (!loading || !!gap) && (cur.view === 'list' || cur.view === 'article'));
  }
  function renderChips() {
    els.topics.textContent = '';
    els.topicSel.textContent = '';
    for (const t of TOPICS) {
      const b = h('button', { type: 'button', class: 'chip' + (t.key === 'latt' ? ' extra' : ''), 'data-topic': t.key }, t.zh);
      tip(b, t.sv, `看「${t.zh}」的新闻`);
      b.addEventListener('click', () => {
        b.blur();
        chooseTopic(t);
      });
      els.topics.append(b);
      els.topicSel.append(h('option', { value: t.key, lang: 'zh-CN' }, t.zh));
    }
  }
  tip(els.topicSel, 'Välj ämne', '选话题');
  els.topicSel.addEventListener('change', () => {
    const t = TOPICS.find((x) => x.key === els.topicSel.value);
    els.topicSel.blur();
    if (t) chooseTopic(t);
  });
  function markChip(topic, busy) {
    if (topic) els.topicSel.value = topic.key;
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

  const dropArticleHistory = () => {
    if (history.state && history.state.sv === 'article') { try { history.replaceState(null, ''); } catch (e) { /* 忽略 */ } }
  };
  // again：再点一次同一个话题 → 下一批。
  // auto：读的时候读完了这一批的最后一篇（接着读下一篇），或者在最后一篇点了「下一篇」：取下一批，打开第一篇接着读。
  // 取的时候文章还在，朗读等着（reader.hold()，锁屏时也接得上）；这时按了暂停、停止、打开了别的，下一批就不列出来，页面不动。
  // 取不到：朗读停下、说一声，文章还在；这个话题的文章都列过了（下一批从最新的重新开始）：和「下一篇」一样列出来，朗读停下
  async function showTopic(topic, again, auto = 0) {
    try {
      await loadTopicAndShow(topic, again, auto);
    } finally {
      // 接着读下一批时出了意外（抛了异常）：别让朗读一直「等着」（放着静音，锁屏界面一直是「正在播放」）
      if (auto && gap && gap.tok === auto) { gap = null; if (reader.held) reader.stop(); }
    }
  }
  async function loadTopicAndShow(topic, again, auto) {
    const token = ++loadToken;
    loading = true;
    if (!auto) { cancelGap(); reader.stop(); capNext = false; }
    hidePopup();
    cur.topic = topic;
    S.topic = topic.key;
    save();
    markChip(topic, true);
    // 从文章直接换话题：浏览器的「后退」不再回到那篇文章（接着读下一批时，等列出来了再改）
    if (!auto) dropArticleHistory();
    const stillAuto = () => !!gap && gap.tok === auto && reader.state === 'speaking' && reader.held && cur.view === 'article';
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
    if (auto && !stillAuto()) { // 等的时候暂停了、停了、打开了别的：不列下一批
      if (gap && gap.tok === auto) gap = null;
      if (reader.held && !gap) reader.stop();
      return;
    }
    if (auto && !res.cands.length) {
      // 取不到：朗读停下，文章还在。读的时候点了「下一篇」才取的：停在原来读到的地方（暂停），点 ▶ 接着读
      const at = gap && gap.at;
      const pass = ramp.pass;
      gap = null;
      reader.stop();
      if (at) { ramp.pass = pass; reader.si = at.si; reader.wi = at.wi; reader.setState('paused'); highlight(at.si, at.wi, true); }
      toast((res.error ? '没能取到下一批文章（网络不通，或者 SR 的服务器暂时拒绝了）' : `「${topic.zh}」没有更多文章了`) + (at ? '，停在刚才读到的地方。' : '，朗读停下。'), 6000);
      return;
    }
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
    if (auto) {
      dropArticleHistory();
      if (b.restarted || !b.items.length) {
        // 这个话题最近的文章都列过了：和「下一篇」一样列出来（从最新的重新开始），朗读停下
        gap = null;
        renderList();
        window.scrollTo({ top: 0 });
        toast(`「${topic.zh}」最近的文章都列过了，朗读停下。`, 6000);
        return;
      }
      renderList(true);
      window.scrollTo({ top: 0 });
      readOn(b.items[0], true);
      return;
    }
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

  // keep：接着读下一批（showTopic 的 auto）时，朗读不停（马上打开下一批的第一篇接着读）
  function renderList(keep) {
    if (!keep) { cancelGap(); reader.stop(); }
    hidePopup();
    const topic = cur.topic;
    const read = SV.sources.readSet();
    els.list.textContent = '';
    els.list.append(h('div', { class: 'list-head' },
      h('h2', null, topic.zh),
      h('span', null, `第 ${cur.batchNo} 批 · ${cur.batch.length} 篇 · 选一篇来读；`,
        h('span', { class: 'wide-only' }, `再点一次「${topic.zh}」换一批`),
        h('span', { class: 'narrow-only' }, '点最下面的「换一批」换一批'))));
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
    cancelGap();
    reader.stop();
    capNext = false;
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
  // keep：接着读下一篇（readOn）：朗读不停（reader 等着，马上从头读新的这一篇），锁屏时也接得上
  function openArticle(item, push, keep) {
    if (!keep) { cancelGap(); reader.stop(); }
    ramp.pass = 0; // 三连读从第 1 遍开始
    capNext = false;
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

  // 「下一篇」（播放栏、文章末尾、锁屏界面的「下一首」）：列表里的下一篇；最后一篇之后换下一批。
  // 正在朗读时，打开下一篇后接着朗读（「读完以后」照旧，三连读从第 1 遍开始）；在这一批的最后一篇，取下一批，打开第一篇接着读。
  // 暂停着或没在读时只打开（最后一篇之后列出下一批），不读。
  function nextArticle() {
    if (!cur.topic) return;
    const reading = reader.state === 'speaking';
    const idx = cur.item ? cur.batch.indexOf(cur.item) : -1;
    if (idx >= 0 && idx < cur.batch.length - 1) {
      openArticle(cur.batch[idx + 1], false);
      if (reading) startReading();
    } else if (reading && cur.view === 'article') {
      // at：读到哪里了（取不到下一批、或者取的时候按了暂停，就停在这里）
      const at = { si: reader.si, wi: reader.wi };
      cancelGap();
      reader.hold();
      gap = { tok: ++gapTok, kind: 'next', timer: 0, at };
      toast('这一批读完了，正在取下一批文章…', 3000);
      showTopic(cur.topic, true, gap.tok);
    } else {
      dropArticleHistory();
      showTopic(cur.topic, true);
    }
  }

  // 一篇（三连读的一遍）读完了（reader 的 onEnd）：要接着读就回 true（reader 先 hold() 等着），停一下（GAP_MS）再读：
  // 三连读的下一遍、「读完以后」是「接着读下一篇」或「本篇循环」（不用三连读时的本篇循环由 reader 自己马上从头读，不到这里）。
  function articleEnded() {
    if (cur.view !== 'article' || !cur.model || !cur.topic) return false;
    const what = afterThis();
    if (what === 'stop') return false;
    if (what === 'next' && autoCount >= autoNextMax) {
      // 读者没碰页面，已经连着自动读了 AUTO_NEXT_MAX 篇：停下（免得没人听时把一个话题的文章全读完，花掉大家共用的额度）
      capNext = true;
      toast(`已经连续读了 ${autoNextMax} 篇，停下了；点 ▶ 接着读`, 10000);
      return false;
    }
    cancelGap();
    const tok = ++gapTok;
    gap = { tok, kind: what, timer: setTimeout(() => { if (gap && gap.tok === tok) { gap.timer = 0; goOn(tok); } }, GAP_MS) };
    if (what === 'pass') toast(`第 ${ramp.pass + 1} 遍读完了`, GAP_MS);
    return true;
  }
  // 停够了：接着读。到这时再看一遍「读完以后」和三连读（等的时候可能换过）
  function goOn(tok) {
    if (!gap || gap.tok !== tok) return;
    if (reader.state !== 'speaking' || !reader.held || cur.view !== 'article' || !cur.model) { // 已经不在等了
      gap = null;
      if (reader.held) reader.stop();
      return;
    }
    let what = afterThis();
    if (what === 'pass' && gap.kind !== 'pass') what = S.after; // 等的时候才换成三连读：这一篇算读完了，按「读完以后」
    if (what === 'pass') { ramp.pass++; readAgain(passText()); return; }
    if (what === 'loop') { ramp.pass = 0; readAgain(S.ramp ? '本篇循环，三连读再来一次：' + passText() : '本篇循环：从头再读'); return; }
    if (what === 'next') {
      autoCount++; // 读者没碰页面，又自动打开了一篇（到 AUTO_NEXT_MAX 篇就停，见 articleEnded）
      const idx = cur.item ? cur.batch.indexOf(cur.item) : -1;
      if (idx >= 0 && idx < cur.batch.length - 1) { readOn(cur.batch[idx + 1], false); return; }
      // 这一批的最后一篇：和「下一篇」一样取下一批，打开第一篇接着读
      toast('这一批读完了，正在取下一批文章…', 3000);
      showTopic(cur.topic, true, tok);
      return;
    }
    gap = null;
    reader.stop(); // 等的时候换成了「读完就停」
  }
  // 从头再读这一篇（三连读的下一遍、本篇循环）：滚回开头，用这一遍的语速
  function readAgain(msg) {
    gap = null;
    window.scrollTo({ top: 0 });
    toast(msg, 3000);
    if (cur.item) mediaMeta(cur.item);
    reader.play(0, 0);
    updateButtons();
  }
  // 接着读下一篇：打开它（滚到顶上，和手动打开一样），用同一个声音从头读（三连读从第 1 遍开始）。
  // 朗读一直没停（等的时候云端语音放着静音），锁屏时也接得上；锁屏界面换成新的标题
  function readOn(item, push) {
    gap = null;
    openArticle(item, push, true);
    if (!cur.model || !cur.model.sentences.length) { reader.stop(); toast('下一篇没有正文，朗读停下。', 5000); return; }
    toast('下一篇：' + item.title + (S.ramp ? '（三连读 第 1 遍 0.8×）' : ''), 4000);
    reader.play(0, 0);
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
      cancelGap(); // 读完了正在停一下：不接着读下一篇了，从头再读这一篇
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
  // 读完以后：读完就停 → 接着读下一篇 → 本篇循环 → 读完就停（像音乐播放器的「重复」按钮）。读的时候也能换，
  // 这一篇读完时按新的来（本篇循环换成别的：这一遍读完就按别的）
  els.after.addEventListener('click', () => {
    els.after.blur();
    S.after = AFTER[(AFTER.indexOf(S.after) + 1) % AFTER.length];
    capNext = false;
    save();
    updateButtons();
    toast(AFTER_INFO[S.after].toast, 2500);
  });
  // 语速：0.8× → 0.9× → 1× → 三连读 → 0.8×。读的时候点：马上换（离开三连读就用 0.8× 接着读；换成三连读，现在读的算第 1 遍）
  els.rate.addEventListener('click', () => {
    els.rate.blur();
    if (S.ramp) setRate(RATES[0], false);
    else if (S.rate >= RATES[RATES.length - 1]) setRate(RATES[0], true);
    else setRate(RATES[RATES.indexOf(S.rate) + 1], false);
    toast(S.ramp ? '循序渐进三连读：一篇读三遍，0.8× 慢读理解 → 0.9× 练习 → 1× 正常速度' : '语速 ' + fmtRate(S.rate), S.ramp ? 3500 : 1500);
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
    if (reader.state === 'speaking' && !reader.held) reader.play(reader.si, reader.wi);
  });
  els.next.addEventListener('click', () => {
    els.next.blur();
    if (cur.view === 'list') showTopic(cur.topic, true);
    else if (cur.view === 'article') nextArticle();
  });

  // 语速（0.8、0.9、1）和三连读（rampOn）：播放栏的按钮、设置里的选项都走这里
  function setRate(r, rampOn) {
    const was = S.ramp;
    S.rate = nearestRate(r);
    S.ramp = !!rampOn;
    if (S.ramp !== was) ramp.pass = 0; // 换成三连读：现在读的算第 1 遍；离开三连读：不再分遍
    save();
    syncSettingsForm();
    updateButtons();
    if (cur.item) mediaMeta(cur.item);
    // 云端的声音直接改播放速度；本机的声音要从当前的词重新读（等着接着读的时候不用：下一遍、下一篇开始时用新的语速）
    if (reader.rateChanged) reader.rateChanged();
    else if (reader.state === 'speaking' && !reader.held) reader.play(reader.si, reader.wi);
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
  // 说明框「整篇翻译」：认得出的浏览器，它的办法放在最前面（Safari、iPhone 是「点地址栏『aA → 翻译成中文』」）；
  // 认不出的不说「你现在用的浏览器：用浏览器自带的翻译功能」，只列各个浏览器的办法
  $('#helpTrHint').textContent = PAGE_TR_KNOWN ? '你现在用的浏览器：' + PAGE_TR_HINT.replace('整篇翻译：', '') + '。' : '';
  $('#helpTrOthers').textContent = PAGE_TR_KNOWN ? '别的浏览器：' : '比如：';
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
    if (reader.state === 'speaking' && !reader.held) reader.play(reader.si, reader.wi);
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
  // 语速：0.8×、0.9×、1×、循序渐进三连读，和播放栏上的语速按钮是同一个设置
  const rateRadios = [...document.querySelectorAll('#rateRow input[name="rate"]')];
  for (const r of rateRadios) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      if (r.value === 'ramp') setRate(RATES[0], true);
      else setRate(+r.value, false);
    });
  }
  const rngFont = $('#rngFont');
  rngFont.addEventListener('input', () => setScale(+rngFont.value));
  $('#chkOnline').addEventListener('change', (e) => {
    S.online = !!e.target.checked;
    save();
    updateTrNote();
  });
  $('#btnClearHistory').addEventListener('click', () => { SV.sources.clearHistory(); toast('阅读记录已清除'); });
  function syncSettingsForm() {
    for (const r of rateRadios) r.checked = S.ramp ? r.value === 'ramp' : +r.value === S.rate;
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
    else t += '这个浏览器没有内置翻译（Chrome、Edge 的电脑版才有）：' + (az === 'off' ? '' : '微软翻译用不了时，') + '查词和「本句译文」用 MyMemory 在线翻译；整篇翻译请用浏览器自带的翻译功能' + (PAGE_TR_KNOWN ? '（' + PAGE_TR_HINT.replace('整篇翻译：', '') + '）' : '') + '。';
    if (u.chars) t += ` 今天已用 MyMemory 在线翻译约 ${u.chars} 个字符。`;
    $('#trNote').textContent = t;
  }

  // ---------- 开始 ----------
  document.documentElement.style.setProperty('--scale', S.scale);
  // 页面上固定的按钮的瑞典文提示。朗读、语速、男女声、读完以后、下一篇、返回列表随状态变，
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
    ['#btnAfter', AFTER_INFO[S.after].sv, '读完以后：' + AFTER_INFO[S.after].tip],
    ['#btnNext', 'Nästa artikel', '列表里的下一篇'],
    ['#btnTipClose', 'Jag förstår', '知道了，不再显示这条说明'],
    ['#btnTryVoice', 'Provlyssna', '试听这个声音'],
    ['#btnClearHistory', 'Rensa läshistoriken', '清除阅读记录'],
    ['#dlgSettings .dlg-actions button', 'Stäng', '关闭设置'],
    ['#dlgHelp .dlg-actions button', 'Okej', '关闭说明'],
  ];
  for (const [sel, sv, zh] of STATIC_TIPS) { const b = $(sel); if (b) tip(b, sv, zh); }
  updateButtons();
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
    setAutoNextMax: (n) => { autoNextMax = n > 0 ? n : AUTO_NEXT_MAX; }, // 测试用：连着自动读几篇就停（平常是 AUTO_NEXT_MAX）
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
      after: S.after,
      loop: S.after === 'loop',
      loops: reader.loops || 0,
      held: !!reader.held, // 读完了，等着接着读（三连读的下一遍、下一篇）
      autoCount, // 读者没碰页面，连着自动读了几篇
      capNext, // 连着自动读够了、停下了
      gap: gap ? gap.kind : '', // 等着做什么：'pass'、'next'、'loop'
      ramp: S.ramp,
      pass: ramp.pass + 1, // 三连读的第几遍
      rate: curRate(), // 现在用的语速
      audioRate: reader.audio ? reader.audio.playbackRate : null, // 云端语音的 audio 真的在用的播放速度
      more: cur.more,
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

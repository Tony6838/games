/* 翻译成中文（简体）。查词、「本句译文」、选中的几个词都按同一个顺序（Tony 定的，2026-11-13）：
   0. 缓存（见下面）。
   1. 微软翻译（Azure AI Translator 的免费档 F0），经过 Tony 的 Cloudflare Worker（js/config.js 的 translateUrl，
      就是 tools/tts-worker 的 POST /translate）：Azure 的密钥只在 Worker 里；微软不保存收到的文字。
      免费额度每月 200 万个字符，所有读者共用。额度用完（Worker 回 429 quota）时 6 小时里不再问它（记在 localStorage 的 sv.az.v1）；
      太频繁（429 busy）时一分钟里不问；连不上、8 秒没回答时 30 秒里不问；Worker 的设置不对（403、404、405、500、
      Azure 的密钥不对）时，这次打开的页面里不再问。
   2. 浏览器内置翻译（Translator API，Chrome / Edge 138 起的电脑版）：在本机翻译，文字不离开电脑，没有额度。
      第一次要下载语言模型，浏览器规定只能在用户点了按钮之后开始下载。
   3. MyMemory 的免费接口（api.mymemory.translated.net，支持 CORS，不用注册），只在「设置」里的在线翻译开关开着、
      而且是读者点出来的（点词、点「本句译文」，鼠标只是停在词上不算，Tony 定的）时候用。
      不带电子邮件参数，不发任何个人信息；匿名额度约每天 5000 字符；它会长期保存收到的句子；本站不用它翻译整篇文章。
      它给单个词的「译文」常常是翻译记忆库里的字幕（kommunen →「市长办公厅的人能够相信吗?」），不像一个词的译文的不显示。
   同一段文字同时有两次要翻译（鼠标停在词上开始翻这一句，接着又点了「本句译文」）：微软翻译那一步共用一个请求，不多花额度；
   微软翻译不行时，各自按自己的条件往下走（点出来的可以下载内置翻译的模型、可以用 MyMemory），不会被鼠标停着的那一次拖累。
   单词的译文存在 localStorage（长期，记下是哪个翻译给的），句子的译文只存在 sessionStorage（关掉标签页就清掉），
   因为那是 SR 文章的内容，按 SR 的条款不长期保存。 */
(function () {
  'use strict';
  const SV = window.SV;

  const OPTS = { sourceLanguage: 'sv', targetLanguage: 'zh' };
  const WORD_KEY = 'sv.trw.v1';
  const TEXT_KEY = 'sv.trs.v1';
  const MM_KEY = 'sv.mm.v1'; // { day, chars }：今天交给 MyMemory 的字符数，只用来提醒

  // ---------- 缓存 ----------
  // 单词：{ 词: { z: 译文, e: 'azure' | 'builtin' | 'mymemory' } }；以前的版本存的是一个字符串（不知道是哪个翻译给的）
  let wordCache = SV.store.get(WORD_KEY, {});
  if (!wordCache || typeof wordCache !== 'object') wordCache = {};
  let textCache = SV.session.get(TEXT_KEY, {});
  if (!textCache || typeof textCache !== 'object') textCache = {};
  function remember(kind, key, value, engine) {
    if (kind === 'word') {
      wordCache[key] = { z: value, e: engine || '' };
      const keys = Object.keys(wordCache);
      if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete wordCache[k];
      SV.store.set(WORD_KEY, wordCache);
    } else {
      textCache[key] = value;
      const keys = Object.keys(textCache);
      if (keys.length > 600) for (const k of keys.slice(0, keys.length - 600)) delete textCache[k];
      SV.session.set(TEXT_KEY, textCache);
    }
  }
  function forget(kind, key) {
    if (kind === 'word') { delete wordCache[key]; SV.store.set(WORD_KEY, wordCache); } else { delete textCache[key]; SV.session.set(TEXT_KEY, textCache); }
  }
  // 缓存里的译文。MyMemory 的字幕检查（unreliable）只用在以前版本存下的字符串上：
  // 现在 MyMemory 的单词译文存之前就查过，微软翻译、内置翻译的译文（比如 Grattis →「祝贺！」）不查。
  function cacheGet(kind, key, text) {
    if (kind !== 'word') return textCache[key] || null;
    const v = wordCache[key];
    if (typeof v === 'string') {
      if (unreliable(text, v)) { forget(kind, key); return null; }
      return v;
    }
    return v && typeof v.z === 'string' && v.z ? v.z : null;
  }

  // ---------- 微软翻译（Azure Translator，经过 Tony 的 Worker） ----------
  const AZ_KEY = 'sv.az.v1'; // { until }：免费额度用完了，这个时间（毫秒）以前不再问微软翻译
  const AZ_QUOTA_PAUSE = 6 * 3600 * 1000;
  const AZ_BUSY_PAUSE = 60 * 1000;
  const AZ_NET_PAUSE = 30 * 1000; // 连不上、超时：30 秒里不再问，免得每查一个词都等 8 秒
  const AZ_MAX_CHARS = 1000; // 和 Worker 的上限一样（按 Unicode 码位算）；更长的直接用下面的
  const AZ_TIMEOUT = 8000;
  let azPauseUntil = 0;
  let azPauseWhy = '';
  let azBroken = false; // Worker 的设置不对（不让这个网页用、还没有 /translate、没设密钥）：这次打开的页面里不再问
  const azUrl = () => String((SV.config && SV.config.translateUrl) || '');
  function azQuotaUntil() {
    const v = SV.store.get(AZ_KEY, null);
    const t = v && +v.until;
    return t && t > Date.now() ? t : 0;
  }
  // 'off'（没设置）| 'broken'（设置不对）| 'quota'（免费额度用完了）| 'busy'（刚被限流）| 'network'（刚才连不上、超时）| 'ok'
  function azureState() {
    if (!azUrl()) return 'off';
    if (azBroken) return 'broken';
    if (azQuotaUntil()) return 'quota';
    if (azPauseUntil > Date.now()) return azPauseWhy;
    return 'ok';
  }
  function pause(why, ms) { azPauseUntil = Date.now() + ms; azPauseWhy = why; }
  // 只发要翻译的文字（{ texts: [文字] }，查词选意思时加 textType: 'html'），不带 Cookie；语言在 Worker 里定死
  async function azureCall(text, textType) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), AZ_TIMEOUT) : 0;
    let r;
    let j = null;
    try {
      r = await fetch(azUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(textType === 'html' ? { texts: [text], textType: 'html' } : { texts: [text] }),
        cache: 'no-store',
        credentials: 'omit',
        signal: ctrl ? ctrl.signal : undefined,
      });
      try { j = await r.json(); } catch (e) { j = null; }
    } catch (e) {
      pause('network', AZ_NET_PAUSE);
      throw err('network', '连不上微软翻译');
    } finally {
      clearTimeout(timer);
    }
    if (r.ok) {
      const t = j && Array.isArray(j.translations) ? j.translations[0] : null;
      if (typeof t === 'string' && t.trim()) return t;
      throw err('server', '微软翻译的回答不对');
    }
    const code = j && typeof j.error === 'string' ? j.error : '';
    if (r.status === 429 && code === 'quota') {
      SV.store.set(AZ_KEY, { until: Date.now() + AZ_QUOTA_PAUSE });
      throw err('quota', '微软翻译的免费额度用完了');
    }
    if (r.status === 429) {
      pause('busy', AZ_BUSY_PAUSE);
      throw err('busy', '微软翻译这会儿太忙');
    }
    if ([403, 404, 405, 500].includes(r.status) || (r.status === 502 && /^azure 40[13]\b/.test(code))) {
      azBroken = true;
      throw err('broken', '微软翻译的设置有问题');
    }
    throw err('server', '微软翻译出错（HTTP ' + r.status + '）');
  }
  // 同一段文字同时只发一个请求，大家等同一个结果（成功、失败都一样）
  const azInflight = new Map();
  function azure(text, textType) {
    const id = (textType || 'plain') + '\n' + text;
    if (!azInflight.has(id)) azInflight.set(id, azureCall(text, textType).finally(() => azInflight.delete(id)));
    return azInflight.get(id);
  }

  // MyMemory 给单词（或选中的两三个词）的「译文」像不像真的译文：翻译记忆库里的字幕常常整句冒出来。
  // 不像的：原文没有句末标点而译文有（。？！?!）、以破折号开头（字幕里的对话）、分了行、汉字中间有空格（「线路安全 好了」）、
  // 汉字太多（一个词最多 10 个汉字，每多一个词多 4 个）、一个汉字也没有又比原文长得多。「你好」这样短而错的认不出来。
  function unreliable(src, zh) {
    const s = String(src || '').trim();
    const out = String(zh || '').trim();
    if (!out) return true;
    const n = s.split(/\s+/).filter(Boolean).length || 1;
    if (/[。？！?!]/.test(out) && !/[.?!]/.test(s)) return true;
    if (/^[-–—]/.test(out) || /[\r\n]/.test(out)) return true;
    if (/[㐀-鿿]\s+[㐀-鿿]/.test(out)) return true;
    const han = (out.match(/[㐀-鿿]/g) || []).length;
    if (han > 6 + 4 * n) return true;
    if (!han && out.length > 2 * s.length + 10) return true;
    return false;
  }

  // ---------- 浏览器内置翻译 ----------
  let builtin = null; // Translator 实例
  let creating = null;
  let lastAvail = null;
  const hasBuiltinApi = () => typeof self !== 'undefined' && typeof self.Translator !== 'undefined' && !!self.Translator;

  async function builtinAvailability() {
    if (builtin) return 'ready';
    if (!hasBuiltinApi()) return 'unavailable';
    try {
      lastAvail = await self.Translator.availability(OPTS);
    } catch (e) {
      lastAvail = 'unavailable';
    }
    return lastAvail;
  }

  // onProgress(0..1)：下载模型的进度
  function createBuiltin(onProgress) {
    if (builtin) return Promise.resolve(builtin);
    if (creating) return creating;
    creating = self.Translator.create({
      ...OPTS,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => { if (onProgress) onProgress(e.loaded); });
      },
    }).then((t) => {
      builtin = t;
      return t;
    }).finally(() => { creating = null; });
    return creating;
  }

  // ---------- MyMemory ----------
  const MM_LIMIT = 5000;
  function mmUsage() {
    const u = SV.store.get(MM_KEY, null);
    const today = new Date().toISOString().slice(0, 10);
    return u && u.day === today ? u : { day: today, chars: 0 };
  }
  function mmAdd(n) {
    const u = mmUsage();
    u.chars += n;
    SV.store.set(MM_KEY, u);
  }
  const bytes = (s) => new TextEncoder().encode(s).length;
  function decodeEntities(s) {
    if (!/&[#a-z0-9]+;/i.test(s)) return s;
    const d = new DOMParser().parseFromString('<!DOCTYPE html><body>' + s, 'text/html');
    return d.body.textContent;
  }
  function err(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  // q 最多 500 个字符（实测：超过时回 200，responseStatus 403「QUERY LENGTH LIMIT EXCEEDED」）；
  // 一次只能翻一段（MyMemory 的条款）。不带 de（电子邮件）、key 等参数。
  async function myMemoryOne(text) {
    const url = 'https://api.mymemory.translated.net/get?langpair=sv%7Czh-CN&q=' + encodeURIComponent(text);
    let r;
    try {
      r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (e) {
      throw err('network', '连不上在线翻译服务');
    }
    if (r.status === 429) throw err('quota', '今天的免费在线翻译额度用完了');
    if (!r.ok) throw err('server', '在线翻译服务出错（HTTP ' + r.status + '）');
    const j = await r.json();
    const out = j && j.responseData && j.responseData.translatedText;
    if (j.quotaFinished || /MYMEMORY WARNING/i.test(out || '') || String(j.responseStatus) === '429') throw err('quota', '今天的免费在线翻译额度用完了');
    if (String(j.responseStatus) !== '200' || !out) throw err('server', '在线翻译服务出错：' + (j.responseDetails || j.responseStatus));
    // 出错时 MyMemory 也可能回 200，把英文大写的错误说明放在「译文」里：不能当译文显示
    if (/QUERY LENGTH LIMIT|INVALID (LANGUAGE|SOURCE|TARGET|EMAIL)|PLEASE SELECT|NO QUERY SPECIFIED/.test(out)) throw err('server', '在线翻译服务出错：' + out);
    mmAdd(text.length);
    return decodeEntities(out);
  }

  // 长文按句子切成不超过 450 字节的小段，一段一段地翻
  function chunksOf(text) {
    if (bytes(text) <= 450) return [text];
    const out = [];
    let cur = '';
    // 句子太长就在逗号、分号等后面断开（不用后行断言，老的 iPhone Safari 不认识）
    const pieces = SV.text.splitSentences(text).flatMap((s) => (bytes(s) <= 450 ? [s] : s.replace(/([,;:–])\s+/g, '$1\u0000').split('\u0000')));
    for (const p of pieces) {
      const next = cur ? cur + ' ' + p : p;
      if (bytes(next) <= 450) { cur = next; continue; }
      if (cur) out.push(cur);
      if (bytes(p) <= 450) { cur = p; continue; }
      // 还是太长：按空格硬切
      let part = '';
      for (const w of p.split(' ')) {
        const n2 = part ? part + ' ' + w : w;
        if (bytes(n2) > 450 && part) { out.push(part); part = w; } else part = n2;
      }
      cur = part;
    }
    if (cur) out.push(cur);
    return out;
  }
  async function myMemoryAll(text) {
    const parts = chunksOf(text);
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      if (i) await SV.sleep(250);
      out.push(await myMemoryOne(parts[i]));
    }
    return out.join('');
  }
  const mmInflight = new Map();
  function myMemory(text) {
    if (!mmInflight.has(text)) mmInflight.set(text, myMemoryAll(text).finally(() => mmInflight.delete(text)));
    return mmInflight.get(text);
  }

  // ---------- 对外 ----------
  // opts.gesture：是不是用户刚点过（允许开始下载内置模型）
  // opts.online：「设置」里的在线翻译（MyMemory）开关（true / false）
  // opts.mm：这一次能不能用 MyMemory（鼠标只是停在词上时是 false，Tony 定的）；不写就是可以
  // opts.onDownload(0..1)：内置模型下载进度
  // 返回 { zh, engine: 'azure' | 'builtin' | 'mymemory' | 'cache', azure }，
  //   azure 是这次为什么没用（或用了）微软翻译：'ok'、'off'（没设置）、'quota'、'busy'、'network'、'broken'、'server'、'long'（太长）。
  // 失败抛出带 code 的错误（也带 azure）：'none'（没有可用的翻译）、'needGesture'（内置翻译要先点一下才能下载）、
  //   'needClick'（只剩 MyMemory，可这一次是鼠标停着，要点一下）、
  //   'quota'、'network'、'server'（MyMemory 的），'unreliable'（MyMemory 给单词的译文不可靠）
  function translate(text, kind, opts) {
    const key = kind === 'word' ? text.toLowerCase() : text;
    const hit = cacheGet(kind, key, text);
    if (hit) return Promise.resolve({ zh: hit, engine: 'cache', azure: azureState() });
    return run(text, kind, key, opts || {});
  }

  async function run(text, kind, key, opts) {
    let zh = null;
    let engine = null;
    let az = azureState();
    if (az === 'ok' && Array.from(text).length > AZ_MAX_CHARS) az = 'long';
    if (az === 'ok') {
      try {
        zh = await azure(text);
        engine = 'azure';
      } catch (e) {
        az = e.code || 'server'; // 落到内置翻译、MyMemory
      }
    }
    const fail = (e) => { e.azure = az; return e; };
    if (zh == null) {
      const avail = await builtinAvailability();
      if (avail === 'ready' || avail === 'available' || ((avail === 'downloadable' || avail === 'downloading') && opts.gesture)) {
        try {
          const t = await createBuiltin(opts.onDownload);
          zh = await t.translate(text);
          engine = 'builtin';
        } catch (e) {
          zh = null; // 落到 MyMemory
        }
      }
      if (zh == null) {
        if (!opts.online) {
          if (avail === 'downloadable' || avail === 'downloading') throw fail(err('needGesture', '点一下按钮，启用浏览器内置的翻译'));
          throw fail(err('none', opts.online === false ? '在线翻译已关闭' : '这个浏览器没有内置翻译'));
        }
        if (opts.mm === false) throw fail(err('needClick', '点一下，用 MyMemory 在线翻译'));
        try {
          zh = await myMemory(text);
        } catch (e) {
          throw fail(e);
        }
        engine = 'mymemory';
        if (kind === 'word' && unreliable(text, zh)) throw fail(err('unreliable', '在线翻译没有给出可靠的结果'));
      }
    }
    zh = (zh || '').trim();
    if (zh) remember(kind, key, zh, engine);
    return { zh, engine, azure: az };
  }

  // 查词选意思（js/sense.js）：这一句的 HTML，查的词（第 start..end 个字）包在 <b> 里，只请微软翻译（别的翻译不放标签）。
  // 返回 { html, engine: 'azure' | 'cache' }；微软翻译用不了时抛出带 code 的错误（azureState 的那些、'long'）。
  // 结果是 SR 文章的内容，只存在 sessionStorage。
  async function tagged(text, start, end) {
    const key = '\u0001' + start + '\u0001' + text;
    if (textCache[key]) return { html: textCache[key], engine: 'cache' };
    const st = azureState();
    if (st !== 'ok') throw err(st, '微软翻译用不了');
    const input = SV.sense.tagSentence(text, start, end);
    if (Array.from(input).length > AZ_MAX_CHARS) throw err('long', '这一句太长');
    const html = await azure(input, 'html');
    remember('text', key, html);
    return { html, engine: 'azure' };
  }

  // 鼠标只是停在词上时，有没有不用 MyMemory 的翻译（微软翻译，或者已经能用的内置翻译）
  const hoverCanTranslate = () => azureState() === 'ok' || !!builtin || lastAvail === 'available' || lastAvail === 'ready';

  SV.tr = {
    translate,
    tagged,
    builtinAvailability,
    hasBuiltinApi,
    mmUsage,
    MM_LIMIT,
    cachedText: (text) => textCache[text] || null,
    // 按句子选词义时拿到的整句译文（去掉标签），也当「本句译文」存起来，再点「本句译文」不再花额度
    rememberText: (text, zh) => { if (zh && !textCache[text]) remember('text', text, zh); },
    builtinReady: () => !!builtin,
    hoverCanTranslate,
    azureState,
    azureQuotaUntil: azQuotaUntil,
    unreliable,
  };
})();

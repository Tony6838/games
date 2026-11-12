/* 翻译成中文（简体）。
   1. 浏览器内置翻译（Translator API，Chrome / Edge 138 起的电脑版）：在本机翻译，文字不离开电脑，没有额度。
      第一次要下载语言模型，浏览器规定只能在用户点了按钮之后开始下载。
   2. 没有内置翻译时，用 MyMemory 的免费接口（api.mymemory.translated.net，支持 CORS，不用注册）。
      不带电子邮件参数，不发任何个人信息；匿名额度约每天 5000 字符；
      它会长期保存收到的句子，所以整篇文章交给它之前先问用户（见 app.js）。
   单词的译文存在 localStorage（长期），句子和段落的译文只存在 sessionStorage（关掉标签页就清掉），
   因为那是 SR 文章的内容，按 SR 的条款不长期保存。 */
(function () {
  'use strict';
  const SV = window.SV;

  const OPTS = { sourceLanguage: 'sv', targetLanguage: 'zh' };
  const WORD_KEY = 'sv.trw.v1';
  const TEXT_KEY = 'sv.trs.v1';
  const MM_KEY = 'sv.mm.v1'; // { day, chars }：今天交给 MyMemory 的字符数，只用来提醒

  // ---------- 缓存 ----------
  let wordCache = SV.store.get(WORD_KEY, {});
  if (!wordCache || typeof wordCache !== 'object') wordCache = {};
  let textCache = SV.session.get(TEXT_KEY, {});
  if (!textCache || typeof textCache !== 'object') textCache = {};
  function remember(kind, key, value) {
    if (kind === 'word') {
      wordCache[key] = value;
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
  const cacheGet = (kind, key) => (kind === 'word' ? wordCache[key] : textCache[key]);

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
  async function myMemory(text) {
    const parts = chunksOf(text);
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      if (i) await SV.sleep(250);
      out.push(await myMemoryOne(parts[i]));
    }
    return out.join('');
  }

  // ---------- 对外 ----------
  // opts.gesture：是不是用户刚点过（允许开始下载内置模型）
  // opts.online：允许用 MyMemory 吗（true / false）
  // opts.onDownload(0..1)：内置模型下载进度
  // 返回 { zh, engine: 'builtin' | 'mymemory' | 'cache' }，失败抛出带 code 的错误：
  //   'none'（没有可用的翻译）、'needGesture'（内置翻译要先点一下才能下载）、'quota'、'network'、'server'
  async function translate(text, kind, opts) {
    const key = kind === 'word' ? text.toLowerCase() : text;
    const hit = cacheGet(kind, key);
    if (hit) return { zh: hit, engine: 'cache' };
    const avail = await builtinAvailability();
    let zh = null;
    let engine = null;
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
        if (avail === 'downloadable' || avail === 'downloading') throw err('needGesture', '点一下按钮，启用浏览器内置的翻译');
        throw err('none', opts.online === false ? '在线翻译已关闭' : '这个浏览器没有内置翻译');
      }
      zh = await myMemory(text);
      engine = 'mymemory';
    }
    zh = (zh || '').trim();
    if (zh) remember(kind, key, zh);
    return { zh, engine };
  }

  SV.tr = {
    translate,
    builtinAvailability,
    hasBuiltinApi,
    mmUsage,
    MM_LIMIT,
    cachedText: (text) => textCache[text] || null,
    builtinReady: () => !!builtin,
  };
})();

/* 公用小工具：本地存储（读写都包在 try/catch 里，存不了也照常运行）、时间、DOM。 */
(function () {
  'use strict';
  const SV = (window.SV = window.SV || {});

  function makeStore(getArea) {
    return {
      get(key, fallback) {
        try {
          const v = getArea().getItem(key);
          return v == null ? fallback : JSON.parse(v);
        } catch (e) {
          return fallback;
        }
      },
      set(key, value) {
        try {
          getArea().setItem(key, JSON.stringify(value));
          return true;
        } catch (e) {
          return false;
        }
      },
      remove(key) {
        try { getArea().removeItem(key); } catch (e) { /* 存不了就算了 */ }
      },
    };
  }
  // 设置、已读记录、单词翻译：长期保存
  SV.store = makeStore(() => window.localStorage);
  // 文章句子的译文：只在这个标签页里临时保存，关掉就没了
  SV.session = makeStore(() => window.sessionStorage);

  SV.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  SV.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 文章的日期一律按瑞典时间算：「今天的新闻」是瑞典的今天
  const partsFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function parts(d) {
    const o = {};
    for (const p of partsFmt.formatToParts(d)) o[p.type] = p.value;
    return o;
  }
  SV.stockholmDay = (d) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
  SV.stockholmTime = (d) => { const p = parts(d); return `${p.hour}:${p.minute}`; };
  SV.dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

  // h('div', { class: 'x', onclick: fn }, '文字', child)
  SV.h = function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : String(c));
    }
    return el;
  };

  // 只允许打开 Sveriges Radio 自己的 https 链接
  SV.safeSrLink = (url, articleId) => {
    try {
      const u = new URL(url, 'https://www.sverigesradio.se/');
      if (/^(www\.)?sverigesradio\.se$/i.test(u.hostname)) { u.protocol = 'https:'; return u.href; }
    } catch (e) { /* 落到下面 */ }
    return articleId ? 'https://www.sverigesradio.se/artikel/' + encodeURIComponent(articleId) : 'https://www.sverigesradio.se/';
  };
})();

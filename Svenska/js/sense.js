/* 一个词在小词典里有几个意思时，按这一句挑出这句里的意思（Tony 定的，2026-11-13）。

   弹出框里（js/app.js）：没有多个意思就直接显示。有几个意思时，先把意思全列出来，再自动显示这一句的译文；
   只有下面的规则「确定」时，才给那个意思画下划线，并在整句译文里给这个词的译文画下划线。不确定就不画，读者自己对着整句看。

   确定的规则（2026-11-13 用 SR 的 140 个真句子、271 个「有几个意思的词」和真的微软翻译量过：画了 30 个，错 0 个；
   以前按整句译文找意思的办法画了 55 个，错 1 个，而且用编的句子很容易骗过它。量法和数字见 README「翻译」）：
   1. 能挑：至少两个意思，每个意思都有能找的中文词（两个汉字以上，见 keysOf），原形不是按词尾推测的。
      有一个意思只有单字或者只有括号里的说明（「在……里；在」「（复数定冠词）」），它永远找不到，别的意思碰巧出现就会错，所以不挑。
   2. 请微软翻译把整句当 HTML 翻译，查的这个词包在 <b> 里（tagSentence）；微软会把标签放在它认为是这个词的译文的中文上。
   3. 译文里正好一对 <b>，标签里只有一个意思的中文词（两个以上的意思的词都在里面：不确定），
      而且标签里的汉字不比这个中文词多两个以上，才算确定（pickTagged）。标签空了、放错地方（常常是小词）、盖住一长串字：不确定。
   浏览器内置翻译和 MyMemory 不会放标签，所以只有微软翻译能「确定」；用它们时只显示整句的译文，不画。 */
(function () {
  'use strict';
  const SV = window.SV;
  const HAN = /[㐀-鿿豈-﫿]/;
  const hanOnly = (s) => Array.from(String(s || '')).filter((c) => HAN.test(c)).join('');
  // 汉字、中文标点、全角字符：它们旁边的空格是微软在标签两边加的，去掉
  const WIDE = /[　-〿㐀-鿿豈-﫿＀-￯]/;

  // 一个意思（小词典里「；」之间的一段）→ 用来找的中文词：去掉括号里的说明，按「、，, /」和省略号分开，只留汉字，
  // 不到两个汉字的不用（在、的、了、家、是这类单字到处都有）
  function keysOf(sense) {
    const bare = String(sense || '').replace(/（[^）]*）|\([^)]*\)/g, ' ');
    const out = [];
    for (const part of bare.split(/[、，,/／…]+|\s+/)) {
      const k = hanOnly(part);
      if (Array.from(k).length >= 2 && !out.includes(k)) out.push(k);
    }
    return out;
  }

  // 小词典查到的 [{ lemma, zh, guessed }] → [{ entry（第几个原形）, text（显示的原文）, keys }]，顺序和弹出框里一样
  function senses(list) {
    const out = [];
    (list || []).forEach((e, entry) => {
      for (const t of String(e.zh || '').split(/[；;]/)) {
        const text = t.trim();
        if (text) out.push({ entry, text, keys: keysOf(text) });
      }
    });
    return out;
  }

  // 规则 1：能不能挑
  const pickable = (list, ss) => !!list && ss.length >= 2 && ss.every((s) => s.keys.length) && !list.some((e) => e.guessed);

  // 规则 2：发给微软翻译的 HTML（这一句，第 start..end 个字是查的词）
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tagSentence = (text, start, end) => esc(text.slice(0, start)) + '<b>' + esc(text.slice(start, end)) + '</b>' + esc(text.slice(end));

  // 实体（&amp; &hellip; &#8212; ……）还原成文字。浏览器里用 DOMParser 解析，只取 textContent：传进来的文字已经去掉了标签，
  // 剩下的 < 也先转义，所以不会有元素；DOMParser 生成的文档不执行脚本、不加载任何东西。结果只当文字用（放进文字节点）。
  // 没有 DOMParser 时（Node 里跑 tests/sense_eval.mjs），认数字实体和常见的命名实体
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»',
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', bull: '•', times: '×', deg: '°', copy: '©', reg: '®', shy: '' };
  function decodeFallback(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, n) => {
      if (n[0] === '#') {
        const c = n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
        return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : '';
      }
      return Object.prototype.hasOwnProperty.call(ENT, n) ? ENT[n] : m;
    });
  }
  function decode(s) {
    if (s.indexOf('&') < 0) return s;
    if (typeof DOMParser === 'function') {
      try {
        return new DOMParser().parseFromString('<!DOCTYPE html><body>' + s.replace(/</g, '&lt;'), 'text/html').body.textContent;
      } catch (e) { /* 落到下面 */ }
    }
    return decodeFallback(s);
  }
  // 微软的 HTML 译文 → { text（去掉标签的纯文字，汉字旁边多出来的空格也去掉）, tag: { start, end }（标签在 text 里的位置），
  // 没有标签、不止一对、没配对时 tag 是 null }。只取文字，从来不把微软给的 HTML 放进页面。
  function parseTagged(html) {
    const parts = String(html || '').split(/(<\/?b\s*>)/i);
    let raw = '';
    let open = -1;
    let tag = null;
    let pairs = 0;
    let bad = false;
    for (const p of parts) {
      if (/^<b\s*>$/i.test(p)) { if (open >= 0) bad = true; open = raw.length; continue; }
      if (/^<\/b\s*>$/i.test(p)) {
        if (open < 0) { bad = true; continue; }
        pairs++;
        tag = { start: open, end: raw.length };
        open = -1;
        continue;
      }
      raw += decode(p.replace(/<[^>]*>/g, ''));
    }
    if (open >= 0 || pairs !== 1) bad = true;
    // 去空格（开头结尾的、连着的、挨着汉字和中文标点的），同时把标签的位置换算过来
    let text = '';
    const map = new Array(raw.length + 1);
    for (let i = 0; i < raw.length; i++) {
      map[i] = text.length;
      const c = raw[i];
      if (/\s/.test(c)) {
        let a = i - 1;
        while (a >= 0 && /\s/.test(raw[a])) a--;
        let b = i + 1;
        while (b < raw.length && /\s/.test(raw[b])) b++;
        if (a < 0 || b >= raw.length || WIDE.test(raw[a]) || WIDE.test(raw[b]) || /\s$/.test(text)) continue;
        text += ' ';
        continue;
      }
      text += c;
    }
    map[raw.length] = text.length;
    return { text, tag: bad || !tag ? null : { start: map[tag.start], end: map[tag.end] } };
  }

  // 规则 3。返回 { index（确定的意思在 ss 里的位置，不确定是 -1）, why, start, end（这个意思的中文词在 text 里的位置，画下划线用）}；
  // why：'match' 确定；'notag' 没有标签、标签里没有汉字；'none' 标签里没有哪个意思的词；'tie' 两个以上的意思的词都在标签里；
  // 'wide' 只有一个意思的词在里面，但标签里的汉字比它多两个以上
  const MAX_EXTRA = 2;
  function pickTagged(ss, parsed) {
    if (!parsed || !parsed.tag) return { index: -1, why: 'notag' };
    const inside = parsed.text.slice(parsed.tag.start, parsed.tag.end);
    const han = hanOnly(inside);
    if (!han) return { index: -1, why: 'notag' };
    const present = new Map(); // 意思 → 在标签里的、最长的那个中文词
    (ss || []).forEach((s, si) => {
      for (const k of s.keys) if (inside.includes(k) && (!present.has(si) || k.length > present.get(si).length)) present.set(si, k);
    });
    if (!present.size) return { index: -1, why: 'none' };
    if (present.size > 1) return { index: -1, why: 'tie' };
    const [index, key] = [...present][0];
    if (han.length > key.length + MAX_EXTRA) return { index: -1, why: 'wide' };
    const start = parsed.tag.start + inside.indexOf(key);
    return { index, why: 'match', key, start, end: start + key.length };
  }

  // 给测试用：一句话里第 wi 个词，微软给的 HTML 译文 html → { pickable, index, best, why, key }
  function inSentence(sentence, wi, html) {
    const w = SV.text.words(sentence)[wi];
    const list = w ? SV.glossary.lookup(w.text) : null;
    const ss = senses(list);
    if (!pickable(list, ss)) return { pickable: false, index: -1, best: null, why: ss.length >= 2 ? 'unpickable' : 'single', key: null };
    const r = pickTagged(ss, parseTagged(html));
    return { pickable: true, index: r.index, best: r.index >= 0 ? ss[r.index].text : null, why: r.why, key: r.key || null };
  }

  SV.sense = { keysOf, senses, pickable, tagSentence, parseTagged, pickTagged, inSentence, MAX_EXTRA };
})();

/* 文章来源。瑞典语：瑞典广播电台（Sveriges Radio, SR）开放接口里各节目的 Atom 新闻源（这个文件里）。
   api.sr.se 回 Access-Control-Allow-Origin: *，浏览器可以直接读，不用服务器也不用代理。
   每个源里是这个节目最新的 20 篇文章，带全文（HTML）。文章只在打开网页时现取，
   只放在内存里（SR 的条款不允许另存、复制、修改），本站不保存文章。
   别的语言的源（GOV.UK、WordPress 网站、维基百科、RSS……）在 js/adapters.js：话题的 feeds 里写的是源的名字（字符串），
   源的设置在语言设置的 sources 里（js/lang/*.js），取法（adapter）在 js/adapters.js；数字还是 SR 的节目号。
   取源、限流、缓存、归类、分批、阅读记录都在这里，各种语言一样。 */
(function () {
  'use strict';
  const SV = window.SV;

  const FEED_URL = 'https://api.sr.se/api/rss/program/';
  const EASY = new Set([4916, 493]); // 简易瑞典语：Radio Sweden på lätt svenska、Klartext

  // 话题、关键词在各个语言的设置里（js/lang/*.js）；这里用现在这种语言的（SV.lang，见 js/langs.js）
  const TOPICS = SV.lang.topics;

  function compileKeywords(str) {
    return (str || '').split(/\s+/).filter(Boolean).map((k) => {
      let w = 1;
      if (k.startsWith('+')) { w = 2; k = k.slice(1); }
      if (k.startsWith('=')) return { type: 'exact', s: k.slice(1), w };
      if (k.includes('_')) return { type: 'phrase', s: k.replace(/_/g, ' '), w };
      return { type: 'prefix', s: k, w };
    });
  }
  for (const t of TOPICS) {
    t.kws = compileKeywords(t.kw);
    t.noKws = compileKeywords(t.no);
    t.allSet = new Set(t.all);
  }

  // ---------- 取源：限流 + 内存缓存 ----------
  // SR 的服务器（Akamai）会暂时拒绝太密集的请求，所以同时最多取 2 个源，
  // 同一个源 10 分钟内不再重取（浏览器自己还会按 SR 给的 max-age=60 缓存）。
  const TTL = 10 * 60 * 1000;
  const cache = new Map(); // programId -> { at, items } 或 { promise }
  // 别的语言的源在不同的网站上：同时最多取 4 个（各算各的）
  const lanes = { sr: { active: 0, max: 2, waiting: [] }, other: { active: 0, max: 4, waiting: [] } };
  async function slot(id) {
    const ln = typeof id === 'number' ? lanes.sr : lanes.other;
    while (ln.active >= ln.max) await new Promise((r) => ln.waiting.push(r));
    ln.active++;
    return ln;
  }
  function release(ln) {
    ln.active--;
    const w = ln.waiting.shift();
    if (w) w();
  }

  // id：数字是 SR 的节目号；字符串是这种语言的源（SV.lang.sources[id]，按它的 adapter 取，见 js/adapters.js）
  function fetchFeed(id) {
    const c = cache.get(id);
    if (c && c.promise) return c.promise;
    if (c && Date.now() - c.at < TTL) return Promise.resolve(c.items);
    const p = (async () => {
      const ln = await slot(id);
      try {
        let lastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            let items;
            if (typeof id === 'number') {
              const r = await fetch(FEED_URL + id, { credentials: 'omit', referrerPolicy: 'no-referrer' });
              if (!r.ok) throw new Error('HTTP ' + r.status);
              items = parseFeed(await r.text(), id);
            } else {
              const src = (SV.lang.sources || {})[id];
              const ad = src && SV.adapters && SV.adapters[src.adapter];
              if (!ad) throw new Error('没有这个源：' + id);
              items = await ad(src, id);
              // 原文链接只要 https（新闻源里写的 javascript:、data:、http: 这类不要，这一篇就不列）
              items = items.filter((it) => { try { return new URL(it.link).protocol === 'https:'; } catch (e) { return false; } });
            }
            failedAt.delete(id);
            cache.set(id, { at: Date.now(), items });
            return items;
          } catch (e) {
            lastErr = e;
            // 源没有开（比如要 Worker 的源，Worker 还没有这个功能）、超时、被限流（429）：这一次不重试
            if (e && e.permanent) break;
            if (attempt === 0) await SV.sleep(1500);
          }
        }
        throw lastErr;
      } finally {
        release(ln);
      }
    })();
    cache.set(id, { promise: p });
    p.catch(() => { if (cache.get(id) && cache.get(id).promise === p) { cache.delete(id); failedAt.set(id, Date.now()); } });
    return p;
  }
  const failedAt = new Map(); // 源 -> 上次没取到的时间（js/app.js 数文章太少的话题时用：取过了、没取到的算 0 篇）
  // 这个源 10 分钟里取过没有（取到了，或者没取到）；没取过、正在取的回 false
  function feedKnown(id) {
    const c = cache.get(id);
    if (c && c.items && Date.now() - c.at < TTL) return true;
    const f = failedAt.get(id);
    return !!f && Date.now() - f < TTL;
  }

  // ---------- 解析 ----------
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim(); // JS 的 s 也包括不换行空格
  const SKIP_PARA = /^(Lyssna|Läs också|Läs mer|Se också|Se även|Hör också|Hör mer)\b/i;

  // SR 文章 HTML -> 段落列表。去掉图片、图片说明、「Lyssna:」音频链接、作者的电子邮件。
  // DOMParser 生成的文档不加载图片也不执行脚本。
  function cleanHtml(html) {
    const doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + (html || '') + '</body>', 'text/html');
    doc.querySelectorAll('img,picture,figure,figcaption,script,style,iframe,video,audio,source,svg,noscript,object,embed,table,form,button').forEach((n) => n.remove());
    doc.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
    const blocks = [];
    let byline = '';
    const push = (type, node) => {
      const text = norm(node.textContent);
      if (!text || SKIP_PARA.test(text)) return;
      blocks.push({ type, text });
    };
    const onlyChild = (n, sel) => {
      const c = n.querySelector(sel);
      return c && norm(c.textContent) === norm(n.textContent) ? c : null;
    };
    (function walk(node) {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) {
          const t = norm(n.textContent);
          if (t && !SKIP_PARA.test(t)) blocks.push({ type: 'p', text: t });
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (tag === 'P') {
          if (n.classList.contains('byline')) {
            n.querySelectorAll('a[href^="mailto:"]').forEach((a) => a.remove());
            byline = norm(n.textContent.replace(/\S+@\S+/g, ' '));
            continue;
          }
          if (onlyChild(n, 'i, em')) continue; // 图片说明
          if (n.querySelector('p, ul, ol, div, blockquote')) { walk(n); continue; }
          push(onlyChild(n, 'strong, b') ? 'lead' : 'p', n);
        } else if (tag === 'UL' || tag === 'OL') {
          for (const li of n.children) if (li.tagName === 'LI') push('li', li);
        } else if (/^H[1-6]$/.test(tag)) {
          push('h', n);
        } else if (tag === 'BLOCKQUOTE') {
          push('q', n);
        } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'MAIN') {
          walk(n);
        } else {
          push('p', n);
        }
      }
    })(doc.body);
    return { blocks, byline };
  }

  const MIN_BODY = 160; // 正文太短的（只有音频的条目）不要

  // ---------- 别的源的文章 HTML（js/adapters.js 用） ----------
  // 和 SR 的 cleanHtml 一样只留文字（图片、图片说明、视频、嵌入的东西都去掉：别的源的图片多半另有版权），
  // 另外：opt.remove：再去掉这些（CSS 选择器）；opt.skip：这样开头的段落不要；opt.stop：碰到这样的段落，后面都不要
  // （比如 GOV.UK 新闻稿末尾的「ENDS」「Notes to editors」）；opt.tables 'text'：表格按行变成段落（不能删改的文章不丢内容），
  // 别的情况去掉表格；opt.keepLinks：记下每段里的链接（文字里的位置和网址），文章里在链接的字后面画一个小箭头（KFF 要保留所有链接）。
  // 返回 [{ type: 'p' | 'h' | 'li' | 'q', text, links? }]
  // 别的语言的文章 HTML -> 段落。先用正则去掉脚本、样式、SVG、注释（有的文章里有十几 MB 的互动图表脚本），
  // 去掉以后还超过 300 KB 的不要（回一个空的，blocks.tooLong）。opt.stop：这样的一段开始就停下，blocks.cut 记下那一段的开头
  // （后面还有字时）；opt.captions：图片说明照登成一段（type 'caption'，KFF）。
  const MAX_HTML = 300 * 1024;
  function cleanArticle(html, opt = {}) {
    html = String(html || '').replace(/<(script|style|svg|noscript|iframe|template)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    if (html.length > (opt.maxHtml || MAX_HTML)) return Object.assign([], { tooLong: true });
    const doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + html + '</body>', 'text/html');
    if (opt.captions) {
      for (const f of Array.from(doc.querySelectorAll('figure'))) {
        const cap = f.querySelector('figcaption');
        const t = cap ? norm(cap.textContent) : '';
        if (!t) continue;
        const p = doc.createElement('p');
        p.dataset.caption = '1';
        p.textContent = t;
        f.replaceWith(p);
      }
    }
    doc.querySelectorAll('img,picture,figure,figcaption,script,style,iframe,video,audio,source,svg,noscript,object,embed,form,button,input,select,textarea,canvas,map,template' + (opt.remove ? ',' + opt.remove : '')).forEach((n) => n.remove());
    if (opt.tables !== 'text') doc.querySelectorAll('table').forEach((n) => n.remove());
    const blocks = [];
    let stopped = false;
    let cut = '';
    let rest = 0; // 停下以后还有多少字（有字才算节选）
    // 一个元素的文字（空白合成一个），同时记下里面 <a href> 的位置
    function textOf(el) {
      let text = '';
      const links = [];
      let space = false;
      (function walk(n) {
        for (const c of Array.from(n.childNodes)) {
          if (c.nodeType === 3) {
            for (const ch of c.textContent) {
              if (/[\u200b-\u200d\u2060\ufeff]/.test(ch)) continue; // 看不见的零宽字符
              if (/\s/.test(ch)) { space = text.length > 0; continue; }
              if (space) { text += ' '; space = false; }
              text += ch;
            }
          } else if (c.nodeType === 1) {
            if (c.tagName === 'BR') { space = text.length > 0; continue; }
            const href = c.tagName === 'A' ? c.getAttribute('href') : '';
            const start = text.length + (space ? 1 : 0);
            walk(c);
            if (href && opt.keepLinks && text.length > start) {
              let url = '';
              try { url = new URL(href, opt.base || 'https://example.invalid/').href; } catch (e) { url = ''; }
              if (/^https?:/i.test(url) && !/example\.invalid/.test(url)) links.push({ start, end: text.length, href: url });
            }
          }
        }
      })(el);
      return { text, links };
    }
    const push = (type, el) => {
      if (stopped) { rest += norm(el.textContent).length; return; }
      const { text, links } = textOf(el);
      if (!text || !/[\p{L}\p{N}]/u.test(text)) return; // 只有标点的（「).」）不要
      if (opt.stop && opt.stop.test(text)) { stopped = true; cut = text.slice(0, 80); return; }
      if (opt.skip && opt.skip.test(text)) return;
      if (el.dataset && el.dataset.caption) type = 'caption';
      blocks.push(links.length ? { type, text, links } : { type, text });
    };
    (function walk(node) {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) {
          const t = norm(n.textContent);
          if (t) push('p', n.ownerDocument.createElement('span').appendChild(n.ownerDocument.createTextNode(t)).parentNode);
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (tag === 'P') {
          if (n.querySelector('p, ul, ol, div, blockquote, table')) { walk(n); continue; }
          push('p', n);
        } else if (tag === 'UL' || tag === 'OL') {
          for (const li of n.children) if (li.tagName === 'LI') push('li', li);
        } else if (/^H[1-6]$/.test(tag)) {
          push('h', n);
        } else if (tag === 'BLOCKQUOTE') {
          if (n.querySelector('p, ul, ol')) { for (const c of n.querySelectorAll('p, li')) push('q', c); } else push('q', n);
        } else if (tag === 'TABLE') {
          for (const tr of n.querySelectorAll('tr')) {
            const cells = Array.from(tr.children).map((td) => norm(td.textContent)).filter(Boolean);
            if (cells.length) { const sp = doc.createElement('span'); sp.textContent = cells.join(' | '); push('li', sp); }
          }
        } else if (tag === 'HR') {
          continue;
        } else if (['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'CENTER', 'SPAN', 'DL', 'DD', 'DT', 'DETAILS', 'SUMMARY'].includes(tag)) {
          if (n.querySelector('p, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, div, table')) walk(n); else push('p', n);
        } else {
          push('p', n);
        }
      }
    })(doc.body);
    if (cut && rest > 0) blocks.cut = cut;
    return blocks;
  }
  // 纯文字（段落之间空一行，比如 GOV.UK 的 indexable_content）-> 段落
  function textBlocks(text, opt = {}) {
    const blocks = [];
    const paras = String(text || '').split(/\n\s*\n/);
    for (let i = 0; i < paras.length; i++) {
      const t = norm(paras[i]);
      if (!t) continue;
      if (opt.stop && opt.stop.test(t)) {
        if (paras.slice(i + 1).some((x) => norm(x))) blocks.cut = t.slice(0, 80); // 后面还有字：节选
        break;
      }
      if (opt.skip && opt.skip.test(t)) continue;
      blocks.push({ type: 'p', text: t });
    }
    return blocks;
  }
  const bodyLength = (blocks) => blocks.reduce((n, b) => n + b.text.length, 0);
  // HTML 里的字（标题、作者名里的 &amp; 之类）
  function plainText(html) {
    const doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + (html || '') + '</body>', 'text/html');
    return norm(doc.body.textContent);
  }

  function parseFeed(text, programId) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('源格式不对');
    const root = xml.documentElement;
    let program = '';
    for (const c of root.children) if (c.localName === 'title') { program = norm(c.textContent); break; }
    const items = [];
    for (const e of Array.from(xml.getElementsByTagName('entry'))) {
      const get = (name) => {
        const n = e.getElementsByTagName(name)[0];
        return n ? n.textContent : '';
      };
      const rawId = norm(get('id'));
      const m = rawId.match(/article\/(\d+)/);
      const articleId = m ? m[1] : '';
      const title = norm(get('title'));
      const pub = new Date(get('published') || get('updated'));
      if (!title || isNaN(pub)) continue;
      let { blocks, byline } = cleanHtml(get('content'));
      let bodyLen = blocks.reduce((n, b) => n + b.text.length, 0);
      if (bodyLen < MIN_BODY) {
        const alt = cleanHtml(get('summary'));
        const altLen = alt.blocks.reduce((n, b) => n + b.text.length, 0);
        if (altLen > bodyLen) { blocks = alt.blocks; bodyLen = altLen; }
      }
      if (bodyLen < MIN_BODY) continue;
      // 正文第一段和标题一样的，去掉
      if (blocks.length && blocks[0].text === title) blocks.shift();
      const linkEl = e.getElementsByTagName('link')[0];
      items.push({
        id: articleId ? 'sr' + articleId : 'sr:' + rawId,
        title,
        link: SV.safeSrLink(linkEl ? linkEl.getAttribute('href') : '', articleId),
        published: pub,
        day: SV.newsDay(pub),
        program: program || 'Sveriges Radio',
        programId,
        easy: EASY.has(programId),
        blocks,
        byline,
      });
    }
    return items;
  }

  // ---------- 归类 ----------
  function tokens(text) {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+(?:[-:][\p{L}\p{N}]+)*/gu) || [];
    const out = [];
    for (const w of words) {
      out.push(w);
      if (w.includes('-')) out.push(...w.split('-'));
    }
    return out;
  }
  // 返回 { hits: 加权的分数, core: 「+」词出现了几次 }
  function countHits(toks, joined, kws) {
    let hits = 0;
    let core = 0;
    for (const k of kws) {
      let n = 0;
      if (k.type === 'phrase') {
        let i = joined.indexOf(' ' + k.s);
        while (i >= 0 && n < 3) { n++; i = joined.indexOf(' ' + k.s, i + 1); }
      } else {
        for (const t of toks) {
          if (k.type === 'exact' ? t === k.s : t.startsWith(k.s)) { n++; if (n >= 3) break; }
        }
      }
      hits += n * k.w;
      if (k.w > 1) core += n;
    }
    return { hits, core };
  }
  // 得分：标题里每个关键词算 3 分，正文里每次出现算 1 分（同一个词最多 3 次，「+」词加倍）；专题节目底分 4。
  // 够 topic.min（默认 3）分才算这个话题的文章；一篇也不够时，退一步用 2 分以上的（loose）。
  // all 里可以是源（节目号、源的名字），也可以是文章的标签（tags：比如 GOV.UK 文章的发布部门），都算专题。
  function score(item, topic) {
    let s = topic.allSet.has(item.programId) || (item.tags && item.tags.some((t) => topic.allSet.has(t))) ? 4 : 0;
    if (!topic.kws.length) return s;
    if (!item._tok) {
      const t = tokens(item.title);
      const b = tokens(item.blocks.map((x) => x.text).join(' '));
      item._tok = { t, b, tj: ' ' + t.join(' ') + ' ', bj: ' ' + b.join(' ') + ' ' };
    }
    const k = item._tok;
    // no：标题里出现一次、或者正文里出现两次这些词，就不算这个话题（趣闻轶事不要犯罪、战争、事故）
    if (topic.noKws.length && (countHits(k.t, k.tj, topic.noKws).hits > 0 || countHits(k.b, k.bj, topic.noKws).hits >= 2)) return 0;
    const ti = countHits(k.t, k.tj, topic.kws);
    const bo = countHits(k.b, k.bj, topic.kws);
    // core：「+」词至少要出现几次（标题里的算两次），只顺带提一句的文章不算（现在没有话题用它）
    if (topic.core && 2 * ti.core + bo.core < topic.core) return s;
    return s + 3 * ti.hits + bo.hits;
  }

  // 几个源的文章 -> 这个话题的候选（取不到正文的 bad 不要）
  function collect(topic, lists) {
    const seen = new Set();
    let cands = [];
    const loose = [];
    const min = topic.min || 3;
    for (const list of lists) {
      for (const it of list) {
        if (seen.has(it.id) || it.bad) continue;
        seen.add(it.id);
        const sc = score(it, topic);
        if (sc >= min) cands.push({ item: it, score: sc });
        else if (sc >= 2) loose.push({ item: it, score: sc });
      }
    }
    let isLoose = false;
    if (!cands.length && loose.length && !topic.strict) { cands = loose; isLoose = true; }
    if (SV.lang.batch && SV.lang.batch.dedupe) cands = dedupe(cands);
    return { cands, loose: isLoose };
  }

  // ---------- 一样的新闻稿发了好几次（别的语言：SV.lang.batch.dedupe） ----------
  // 加拿大政府常把同一篇新闻稿换个部长、换个地方发十几次（「X highlights Government of Canada's investments from Budget 2026」）。
  // 同一个源、发布时间相差不到 48 小时，而且下面两条有一条成立，才算同一篇，只留最新的：
  // - 标题里「highlights / announces / welcomes……」这个动词后面的部分一样（至少 6 个词；前面的人名、职务、地方不管）；
  // - 正文第一句（至少 14 个词，比较它最后 12 个词，前面的日期、地名不管）一样，标题的词也有六成以上一样
  //   （同一套开头、讲的是某个地方的某个项目的那几篇不合并）。
  // 别的都不算（比如每周一次的同名报告，相差一周；同一个动词后面说的是不同的事）。
  const DUP_HOURS = 48;
  const VERB_RE = /^(highlights?|announces?|announced|welcomes?|marks?|celebrates?|launches?|unveils?|outlines?|showcases?|promotes?|delivers?|invests?|supports?|confirms?)$/;
  const words = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  function dupKeys(it) {
    if (it._dup) return it._dup;
    const tw = words(it.title);
    let titleKey = '';
    const vi = tw.findIndex((w, i) => i > 0 && VERB_RE.test(w));
    if (vi > 0 && tw.length - vi - 1 >= 6) titleKey = tw[vi].replace(/(s|ed)$/, '') + ' ' + tw.slice(vi + 1).join(' ');
    let openKey = '';
    const text = (it.blocks || []).slice(0, 6).map((b) => b.text).join(' ');
    for (const s of text.match(/[^.!?]+[.!?]+/g) || []) {
      const sw = words(s);
      if (sw.length >= 14) { openKey = sw.slice(-12).join(' '); break; }
    }
    it._dup = { titleKey, openKey, titleSet: new Set(tw) };
    return it._dup;
  }
  function sameRelease(a, b) {
    if (a.programId !== b.programId || Math.abs(a.published - b.published) > DUP_HOURS * 3600000) return false;
    const ka = dupKeys(a);
    const kb = dupKeys(b);
    if (ka.titleKey && ka.titleKey === kb.titleKey) return true;
    if (!ka.openKey || ka.openKey !== kb.openKey) return false;
    let both = 0;
    for (const w of ka.titleSet) if (kb.titleSet.has(w)) both++;
    return both / (ka.titleSet.size + kb.titleSet.size - both) >= 0.6;
  }
  // cands：[{ item, score }]；一样的只留最新的一篇（顺序不变）
  function dedupe(cands) {
    const newestFirst = cands.slice().sort((a, b) => b.item.published - a.item.published);
    const kept = [];
    const drop = new Set();
    for (const c of newestFirst) {
      if (kept.some((k) => sameRelease(k.item, c.item))) drop.add(c);
      else kept.push(c);
    }
    return drop.size ? cands.filter((c) => !drop.has(c)) : cands;
  }
  async function loadTopic(topic, onProgress) {
    let done = 0;
    const results = await Promise.allSettled(topic.feeds.map((id) => fetchFeed(id).finally(() => {
      done++;
      if (onProgress) onProgress(done, topic.feeds.length);
    })));
    const failed = results.filter((r) => r.status !== 'fulfilled').length;
    const { cands, loose } = collect(topic, results.filter((r) => r.status === 'fulfilled').map((r) => r.value));
    return { cands, loose, failed, total: topic.feeds.length, error: failed === topic.feeds.length ? results[0].reason : null };
  }
  // 只用已经取过的源数这个话题有几篇（不去取）：有一个源 10 分钟里没取过（或者正在取）就回 null
  function countCached(topic) {
    if (!topic.feeds.every(feedKnown)) return null;
    const lists = topic.feeds.map((id) => { const c = cache.get(id); return c && c.items ? c.items : []; });
    return collect(topic, lists).cands.length;
  }
  // 这一批里要另外取正文的文章（item.loadBody，见 js/adapters.js 的 src.lazy）：一篇篇取（同时最多 3 篇），
  // 取不到、不能用的（太大、不许转载……）标成 bad、从这一批里去掉，以后也不再列。
  // 整个最多 20 秒：到时候还没取到的这一批先不列（不标 bad，以后的批次还可以再试）
  async function fillBodies(items, budget = 20000) {
    const need = items.filter((it) => it.loadBody && !it.bodyLoaded && !it.bad);
    let next = 0;
    async function worker() {
      while (next < need.length) {
        const it = need[next++];
        try {
          const blocks = await it.loadBody();
          it.blocks = blocks;
          it.bodyLoaded = true;
        } catch (e) {
          it.bad = true;
        }
      }
    }
    let timer = 0;
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(3, need.length) }, worker)),
      new Promise((r) => { timer = setTimeout(r, budget); }),
    ]);
    clearTimeout(timer);
    return items.filter((it) => !it.bad && (!it.loadBody || it.bodyLoaded));
  }

  // ---------- 文章列表：一批几篇，最新的在前；再点一次话题换下一批，列过的不再列 ----------
  // 只记文章的编号，不记内容。
  // 各种语言分开存：键的前面是语言代码（瑞典语是以前的 sv.shown.v1……）
  const SHOWN_KEY = SV.lang.prefix + 'shown.v1'; // { 话题: [列过的编号] }
  const READ_KEY = SV.lang.prefix + 'read.v1'; // [打开读过的编号]，列表里标「已读」
  const BATCH_KEY = SV.lang.prefix + 'batch.v1'; // sessionStorage：{ 话题: [这一批的编号] }，刷新网页时还是这一批

  function getShown(topicKey) {
    const m = SV.store.get(SHOWN_KEY, {});
    return Array.isArray(m && m[topicKey]) ? m[topicKey] : [];
  }
  function setShown(topicKey, ids) {
    const m = SV.store.get(SHOWN_KEY, {}) || {};
    m[topicKey] = ids.slice(-400);
    SV.store.set(SHOWN_KEY, m);
  }
  function markRead(id) {
    const list = (SV.store.get(READ_KEY, []) || []).filter((x) => x !== id);
    list.push(id);
    SV.store.set(READ_KEY, list.slice(-1500));
  }
  function readSet() { return new Set(SV.store.get(READ_KEY, []) || []); }
  function clearHistory() {
    SV.store.remove(SHOWN_KEY);
    SV.store.remove(READ_KEY);
    SV.session.remove(BATCH_KEY);
  }
  // 去掉了的话题（「电动车」elbilar，2026-11-14）留下的「列过哪些」：打开网页时丢掉（SV.store 读写都包在 try/catch 里）
  function pruneTopics() {
    const keys = new Set(TOPICS.map((t) => t.key));
    for (const [store, key] of [[SV.store, SHOWN_KEY], [SV.session, BATCH_KEY]]) {
      const m = store.get(key, null);
      if (!m || typeof m !== 'object') continue;
      const gone = Object.keys(m).filter((k) => !keys.has(k));
      if (!gone.length) continue;
      for (const k of gone) delete m[k];
      store.set(key, m);
    }
  }
  pruneTopics();

  // again=false：打开话题时，这个标签页里已经有这个话题的一批（比如刚刷新过网页），就还给这一批。
  // again=true：再点一次话题，换下一批。
  // 一批挑哪几篇（pool 是还没列过的，最新的在前）。瑞典语：最新的几篇（和以前一样）。
  // 别的语言（SV.lang.batch.interleave）：各个源轮流，每个源先拿它最新的；一批里一个源最多 perSource 篇（默认 3），
  // 别的源都没有了才再多拿（只有一个源时就都是它的）。顺序就是轮流的顺序（最新的文章所在的源先）。
  function pickBatch(pool, size) {
    const cfg = SV.lang.batch;
    if (!cfg || !cfg.interleave) return pool.slice(0, size).map((c) => c.item);
    const cap = cfg.perSource || 3;
    const bySrc = new Map();
    for (const c of pool) {
      const k = c.item.programId;
      if (!bySrc.has(k)) bySrc.set(k, []);
      bySrc.get(k).push(c.item);
    }
    const queues = [...bySrc.values()]; // 源的顺序：它最新的一篇有多新
    const out = [];
    const used = new Map();
    for (const capped of [true, false]) {
      let moved = true;
      while (out.length < size && moved) {
        moved = false;
        for (const q of queues) {
          if (out.length >= size) break;
          if (!q.length) continue;
          const k = q[0].programId;
          if (capped && (used.get(k) || 0) >= cap) continue;
          out.push(q.shift());
          used.set(k, (used.get(k) || 0) + 1);
          moved = true;
        }
      }
    }
    return out;
  }

  function nextBatch(topic, cands, size, again) {
    const notices = [];
    if (!cands.length) return { items: [], notices, more: false };
    const sorted = cands.slice().sort((a, b) => b.item.published - a.item.published);
    const byId = new Map(sorted.map((c) => [c.item.id, c.item]));
    const batches = SV.session.get(BATCH_KEY, {}) || {};
    if (!again && Array.isArray(batches[topic.key])) {
      const items = batches[topic.key].map((id) => byId.get(id)).filter(Boolean);
      if (items.length >= Math.min(3, batches[topic.key].length)) return { items, notices, more: sorted.length > items.length, reused: true };
    }
    let shown = new Set(getShown(topic.key));
    let pool = sorted.filter((c) => !shown.has(c.item.id));
    let restarted = false; // 都列过了，从最新的重新开始（接着读下一批时，朗读这时停下）
    if (!pool.length) {
      restarted = true;
      shown = new Set();
      pool = sorted;
      notices.push('这个话题最近的文章都列过了，从最新的重新开始。');
    }
    const items = pickBatch(pool, size);
    const today = SV.newsDay(new Date());
    if (!items.some((it) => it.day === today)) {
      const newest = items.reduce((a, b) => (b.published > a.published ? b : a));
      const age = SV.dayDiff(today, newest.day);
      notices.push(age <= 1 ? '这个话题今天还没有新文章，下面是最近的。' : `这个话题今天还没有新文章，最新的一篇是 ${age} 天前的。`);
    }
    setShown(topic.key, [...shown, ...items.map((it) => it.id)]);
    batches[topic.key] = items.map((it) => it.id);
    SV.session.set(BATCH_KEY, batches);
    return { items, notices, more: pool.length > items.length, restarted };
  }

  // 这一批去掉了几篇（取不到正文）：会话里记的这一批也跟着改（刷新网页时还是这几篇）
  function setBatch(topicKey, items) {
    const batches = SV.session.get(BATCH_KEY, {}) || {};
    batches[topicKey] = items.map((it) => it.id);
    SV.session.set(BATCH_KEY, batches);
  }

  SV.sources = { TOPICS, EASY, MIN_BODY, loadTopic, countCached, fillBodies, setBatch, nextBatch, pickBatch, dedupe, markRead, readSet, clearHistory, fetchFeed, parseFeed, cleanHtml, cleanArticle, textBlocks, bodyLength, plainText, score, tokens };
})();

/* 别的语言的新闻源怎么取（瑞典语的 SR 在 js/sources.js）。每种取法是一个函数 adapter(src, key)，
   src 是语言设置里 sources 的一项（js/lang/*.js），回一组文章，格式和 SR 的一样：
   { id, title, link, published, day, program（栏目、部门、作者所在的节目）, programId（源的名字）, tags（归类用的标签）,
     easy, blocks（[{ type, text, links? }]；blocks.cut：在哪一段之前停下的，见下）, byline, source（{ name, short, zh }）,
     credit（署名和许可：文章开头一行的许可简称、点它弹出的整句，见 js/app.js 的 metaLine） }
   - 只留文字：图片、视频都不要（多半另有版权）；KFF 的图片说明照登成文字。表格按行变成文字。
   - 停在「给记者的联系方式」「Notes to editors」这类段落前面的（stop），blocks.cut 记下那一段的开头，
     许可的整句里写明是节选（到哪里为止），不说「没有改动」。
   - 正文很大的源（KFF 的文章里有十几 MB 的互动图表脚本）：列表只取标题和摘要，列出来的那几篇再一篇篇取正文
     （item.loadBody，js/sources.js 的 fillBodies），每篇最多 1.5 MB，去掉脚本以后超过 300 KB 的不要。
   - 要 Worker 转的源（没有 CORS）：js/config.js 的 feedProxy 是 false 时不取，话题里少了这个源。
   每个源只在打开网页、打开话题时取一次，10 分钟内不重取（js/sources.js 的缓存），文章只放在内存里。 */
(function () {
  'use strict';
  const SV = window.SV;
  const { cleanArticle, textBlocks, bodyLength, plainText, MIN_BODY } = SV.sources;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function permanent(msg) { const e = new Error(msg); e.permanent = true; return e; }

  // 读回答，最多 max 个字节（边读边数，超过就不再读，这个源这次算没取到）
  async function readText(r, max) {
    const m = (r.headers.get('Content-Type') || '').match(/charset=["']?([\w-]+)/i);
    let dec;
    try { dec = new TextDecoder(m ? m[1] : 'utf-8'); } catch (e) { dec = new TextDecoder('utf-8'); }
    if (!r.body || !r.body.getReader) {
      const t = await r.text();
      if (t.length > max) throw permanent('too big');
      return t;
    }
    const reader = r.body.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) {
        try { await reader.cancel(); } catch (e) { /* 不管 */ }
        throw permanent('too big');
      }
      parts.push(value);
    }
    const all = new Uint8Array(n);
    let at = 0;
    for (const x of parts) { all.set(x, at); at += x.byteLength; }
    return dec.decode(all);
  }
  // 10 秒（opt.timeout）没取完就算这个源这次没取到（不再重试：连不上的网站常常一直连不上，别让读者等）；
  // 最多 3 MB（opt.maxBytes）
  async function getText(url, opt = {}) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opt.timeout || 10000) : 0;
    try {
      const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl ? ctrl.signal : undefined, ...(opt.headers ? { headers: opt.headers } : {}) });
      if (r.status === 404 && opt.missingOk) throw permanent('HTTP 404');
      if (r.status === 429) throw permanent('HTTP 429'); // 新闻代理的每个网络地址的上限（或者网站限流）：这一次不再试
      // 新闻代理那边超时（Worker 等新闻网站 10 秒没等到）：和这边超时一样（不再试；一篇篇取正文时连着两个就不再问）
      if (r.status === 504) throw permanent('timeout (HTTP 504)');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await readText(r, opt.maxBytes || 3 * 1024 * 1024);
    } catch (e) {
      if (e && e.name === 'AbortError') throw permanent('timeout');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  const getJson = async (url, opt) => JSON.parse(await getText(url, opt));
  // 维基百科要求说明是谁在用它的接口（浏览器里不能改 User-Agent，用 Api-User-Agent），没说明的请求更容易被限流（429）
  const WIKI_HEADERS = { 'Api-User-Agent': 'SvenskaReader/1.0 (https://tony6838.github.io/games/Svenska/)' };

  // 是不是英语（NASA 的新闻稿有西班牙语版、GOV.UK 有威尔士语的）：数常用的小词，英语的要比别的多
  const STOP = {
    en: ['the', 'and', 'of', 'to', 'in', 'is', 'for', 'that', 'with', 'on', 'was', 'are', 'it', 'by', 'this', 'from'],
    es: ['el', 'la', 'de', 'que', 'y', 'los', 'las', 'del', 'en', 'para', 'por', 'con', 'una', 'se', 'es', 'su'],
    cy: ['y', 'yr', 'a', 'ac', 'i', 'o', 'yn', 'mae', 'ar', 'gyda', 'ei', 'eu', 'wedi', 'bod'],
  };
  function looksLike(text, lang) {
    const toks = String(text || '').toLowerCase().match(/\p{L}+/gu) || [];
    if (toks.length < 8) return true;
    const count = (l) => toks.reduce((n, t) => n + (STOP[l].includes(t) ? 1 : 0), 0);
    const mine = count(lang);
    return Object.keys(STOP).every((l) => l === lang || count(l) <= mine);
  }

  const dayOf = (d) => SV.newsDay(d);
  const sourceOf = (src) => ({ name: src.name, short: src.short || src.name, zh: src.zh || '' });

  // ---------- GOV.UK（英国政府网站的新闻稿、讲话；Open Government Licence v3.0） ----------
  // 搜索接口一次给最新的 60 篇（标题、发布部门、全文的纯文字 indexable_content），不用再一篇篇取。
  // 末尾的「ENDS」「Notes to editors」以后不要（给记者的联系方式、背景资料）：blocks.cut 记下，许可的整句里写明是节选。
  // 发布部门当作标签（govuk:部门），话题按它归类。
  SV.adapters = SV.adapters || {};
  SV.adapters.govuk = async (src, key) => {
    const types = (src.types || ['news_story', 'press_release', 'speech', 'world_news_story']).map((t) => 'filter_content_store_document_type=' + t).join('&');
    const url = 'https://www.gov.uk/api/search.json?' + types + '&order=-public_timestamp&count=' + (src.count || 60) +
      '&fields=title,link,public_timestamp,description,organisations,content_store_document_type,indexable_content';
    const j = await getJson(url);
    const out = [];
    for (const r of (j && j.results) || []) {
      const title = norm(r.title);
      const pub = new Date(r.public_timestamp);
      if (!title || isNaN(pub) || !r.link) continue;
      const blocks = textBlocks(r.indexable_content, { stop: /^(ENDS\b|-?ENDS-?$|Notes to editors|Notes for editors|Media enquiries|Further information\s*$)/i, skip: /^(Share this page|Contact .*press office)/i });
      if (blocks.length && blocks[0].text === title) blocks.shift();
      if (bodyLength(blocks) < MIN_BODY) continue;
      if (!looksLike(title + ' ' + blocks.slice(0, 3).map((b) => b.text).join(' '), 'en')) continue;
      const orgs = r.organisations || [];
      const tags = [];
      for (const o of orgs) {
        if (o.slug) tags.push('govuk:' + o.slug);
        for (const pa of o.parent_organisations || []) tags.push('govuk:' + pa);
      }
      tags.push('govuk-type:' + r.content_store_document_type);
      const program = orgs[0] ? norm(orgs[0].title) : 'GOV.UK';
      out.push({
        id: 'govuk:' + r.link,
        title,
        link: 'https://www.gov.uk' + r.link,
        published: pub,
        day: dayOf(pub),
        program,
        programId: key,
        tags,
        easy: false,
        blocks,
        byline: '',
        source: sourceOf(src),
        credit: { license: src.license, note: src.note },
      });
    }
    return out;
  };

  // ---------- WordPress 网站（NASA、KFF Health News、Global Voices）：/wp-json/wp/v2/<path> ----------
  // src.base、src.path（默认 posts）、src.query、src.count；src.author 'yoast'：作者名在 yoast_head_json.author；
  // src.skipTypes：KFF 的 content-types 里这些不要（早报汇编的是别家的新闻、播客只有链接……）；
  // src.remove、src.skip、src.stop、src.tables、src.keepLinks、src.captions：交给 cleanArticle；src.lang：不是这种语言的文章不要；
  // src.rejectText：正文里有这样的字的不要（KFF 标着「All Rights Reserved」的文章不许转载）。
  // src.lazy：列表只要标题和摘要（KFF 有的文章里有十几 MB 的互动图表脚本，一次 20 篇有 30 MB），
  //   列出来的那几篇再一篇篇取正文（item.loadBody）；归类按标题和摘要。
  const BODY_MAX_BYTES = 1.5 * 1024 * 1024;
  // 一篇的正文 HTML -> 段落（取到正文以后的检查：不许转载的、太短的、不是英语的、差不多全是链接的不要；KFF 的介绍语）
  function wpBlocks(src, title, html, link) {
    if (src.rejectText && src.rejectText.test(html)) throw permanent('not republishable');
    const blocks = cleanArticle(html, { remove: src.remove, skip: src.skip, stop: src.stop, tables: src.tables, keepLinks: src.keepLinks, captions: src.captions, base: link });
    if (blocks.length && blocks[0].text === title) blocks.shift();
    if (bodyLength(blocks) < (src.minBody || MIN_BODY)) throw permanent(blocks.tooLong ? 'too long' : 'too short');
    if (src.lang && !looksLike(title + ' ' + blocks.slice(0, 3).map((b) => b.text).join(' '), src.lang)) throw permanent('not ' + src.lang);
    // 差不多全是链接的（「点这里听记者上节目」那种汇编）不要
    if (src.maxLinkShare) {
      const linked = blocks.reduce((n, b) => n + (b.links || []).reduce((m, l) => m + (l.end - l.start), 0), 0);
      if (linked > src.maxLinkShare * bodyLength(blocks)) throw permanent('mostly links');
    }
    // 文章末尾的介绍语（KFF 要求保留）：原文里没有就加在最后一段（照样是文章的一段）
    if (src.tagline && !blocks.some((b) => b.text.includes(src.tagline.slice(0, 40)))) blocks.push({ type: 'p', text: src.tagline });
    return blocks;
  }
  SV.adapters.wp = async (src, key) => {
    const lazy = !!src.lazy;
    const api = src.base.replace(/\/+$/, '') + '/wp-json/wp/v2/' + (src.path || 'posts');
    const fields = ['id', 'date_gmt', 'link', 'title', lazy ? 'excerpt' : 'content'];
    if (src.author === 'yoast') fields.push('yoast_head_json.author');
    if (src.typeField) fields.push(src.typeField);
    const list = await getJson(api + '?per_page=' + (src.count || 20) + '&_fields=' + fields.join(',') + (src.query || ''));
    const out = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (src.skipTypes && src.typeField && (p[src.typeField] || []).some((t) => src.skipTypes.includes(t))) continue;
      const title = plainText(p.title && p.title.rendered);
      const pub = new Date(String(p.date_gmt || '').replace(/Z?$/, 'Z'));
      if (!title || isNaN(pub) || !p.link) continue;
      if (src.skipTitle && src.skipTitle.test(title)) continue; // 播客、汇编这类不要
      let blocks;
      if (lazy) {
        // 摘要（列表上的第一行、归类用）；末尾的「[…]」去掉
        blocks = cleanArticle(String((p.excerpt && p.excerpt.rendered) || '').replace(/\s*\[(?:&hellip;|…|\.\.\.)\]/g, ' …'));
        if (!blocks.length) continue;
      } else {
        try { blocks = wpBlocks(src, title, (p.content && p.content.rendered) || '', p.link); } catch (e) { continue; }
      }
      const byline = src.author === 'yoast' ? norm(p.yoast_head_json && p.yoast_head_json.author) : '';
      const item = {
        id: key + ':' + p.id,
        title,
        link: p.link,
        published: pub,
        day: dayOf(pub),
        program: src.program || src.name,
        programId: key,
        tags: [],
        easy: !!src.easy,
        blocks,
        byline,
        source: sourceOf(src),
        credit: { license: src.license, tagline: src.tagline, note: src.note, byline },
      };
      if (lazy) {
        item.loadBody = async () => {
          const j = await getJson(api + '/' + encodeURIComponent(p.id) + '?_fields=content', { timeout: 20000, maxBytes: BODY_MAX_BYTES });
          return wpBlocks(src, title, (j && j.content && j.content.rendered) || '', p.link);
        };
      }
      out.push(item);
    }
    return out;
  };

  // ---------- 维基百科（各种语言）：首页的「新闻动态」「你知道吗」「历史上的今天」「今日特色条目」 ----------
  // 这些首页条目只有一两句话，读的是它链到的条目（粗体的那个）的开头部分（导言），一次最多问 20 个条目（extracts）。
  // 维基百科是 CC BY-SA 4.0：写明是维基百科、条目的链接和许可，说明是摘录（只有开头部分）。
  const featuredCache = new Map(); // 'en' -> Promise（同一个维基的首页只取一次，几个话题共用）
  const ymd = (d) => [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')];
  function featured(wiki) {
    if (featuredCache.has(wiki)) return featuredCache.get(wiki);
    const p = (async () => {
      let lastErr = null;
      for (const back of [0, 1]) { // 今天的还没有就用昨天的
        const d = new Date(Date.now() - back * 86400000);
        try {
          const j = await getJson(`https://${wiki}.wikipedia.org/api/rest_v1/feed/featured/${ymd(d).join('/')}`, { headers: WIKI_HEADERS });
          if (j && (j.news || j.tfa || j.dyk || j.onthisday)) return { j, date: d, back };
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('维基百科首页没有内容');
    })();
    featuredCache.set(wiki, p);
    p.catch(() => featuredCache.delete(wiki));
    setTimeout(() => { if (featuredCache.get(wiki) === p) featuredCache.delete(wiki); }, 10 * 60 * 1000);
    return p;
  }
  // 链接（./Title 或完整网址）-> 条目名
  function wikiTitle(href) {
    const m = String(href || '').match(/(?:\.\/|\/wiki\/)([^?#]+)/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]).replace(/_/g, ' '); } catch (e) { return m[1].replace(/_/g, ' '); }
  }
  // 首页一条的 HTML：纯文字和粗体的那个条目（没有粗体就用第一个链接）
  function hook(html) {
    const doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + (html || '') + '</body>', 'text/html');
    doc.querySelectorAll('style, sup.reference').forEach((n) => n.remove());
    const b = doc.querySelector('b a[href], a[href] b');
    const a = b ? (b.tagName === 'A' ? b : b.closest('a')) : doc.querySelector('a[href]');
    const titles = Array.from(doc.querySelectorAll('a[href]')).map((x) => wikiTitle(x.getAttribute('href'))).filter(Boolean);
    return { text: norm(doc.body.textContent).replace(/\s+\(pictured\)/i, ''), main: a ? wikiTitle(a.getAttribute('href')) : '', titles };
  }
  // 条目的导言（HTML）：{ 条目名: { title, html } }，跟着重定向
  async function extracts(wiki, titles) {
    const out = new Map();
    const uniq = [...new Set(titles.filter(Boolean))];
    for (let i = 0; i < uniq.length; i += 20) {
      const part = uniq.slice(i, i + 20);
      const url = `https://${wiki}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&exlimit=20&redirects=1&format=json&formatversion=2&origin=*&titles=` + encodeURIComponent(part.join('|'));
      const j = await getJson(url, { headers: WIKI_HEADERS });
      const q = (j && j.query) || {};
      const alias = new Map();
      for (const n of q.normalized || []) alias.set(n.from, n.to);
      for (const r of q.redirects || []) alias.set(r.from, r.to);
      const pages = new Map((q.pages || []).filter((pg) => !pg.missing && pg.extract).map((pg) => [pg.title, pg]));
      for (const t of part) {
        let x = t;
        for (let k = 0; k < 3 && alias.has(x); k++) x = alias.get(x);
        const pg = pages.get(x);
        if (pg) out.set(t, { title: pg.title, html: pg.extract });
      }
    }
    return out;
  }
  const WIKI_LICENSE = { short: 'CC BY-SA 4.0', text: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', statement: 'Text from Wikipedia, the free encyclopedia, under CC BY-SA 4.0 (excerpt: the lead section of the article; authors in the article history).' };
  // 首页条目的时间：读者这里的今天（首页按 UTC 的日子换；在 UTC−6 以西，早上 6 点 UTC 是读者的昨天），早上 6 点、还没到就是现在
  function wikiTime(back) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6);
    return new Date(Math.min(d.getTime(), now.getTime()) - back * 86400000);
  }
  // 「历史上的今天」一条链到的几个条目里，讲这件事本身的那个（不是人、地方、年份、很大的题目）：
  // 名字或说明里有这一年（「1992 airliner crash」「2010 Abu Dhabi Grand Prix」）、导言里提到这一年的优先；人、地方往后
  function otdPage(o) {
    const y = String(o.year);
    const text = norm(o.text); // 名字里常有不换行空格（HMS&nbsp;Ark Royal）
    const yr = new RegExp('(^|[^0-9])' + y + '(?![0-9])');
    const range = new RegExp('(^|[^0-9])' + y + '\\s*[–-]\\s*\\d|\\bfrom \\d{3,4} to \\d{3,4}\\b|\\d{3,4}\\s*[–-]\\s*\\d{2,4}');
    let best = null;
    let bestScore = -Infinity;
    (o.pages || []).forEach((pg) => {
      const title = String(pg.normalizedtitle || pg.title || '').replace(/_/g, ' ');
      const desc = String(pg.description || '');
      const ex = String(pg.extract || '');
      let sc = 0;
      if (yr.test(title)) sc += 4;
      if (yr.test(desc)) sc += range.test(desc) ? 1 : 3;
      else if (yr.test(ex) && !range.test(desc)) sc += 2;
      if (/\((born \d{3,4}|died \d{3,4}|c?\.? ?\d{3,4}\s*[–-]\s*\d{2,4})\)/.test(desc)) sc -= 4; // 人
      if (/^(City|Town|Village|Ward|County|Country|Capital|State|Province|Region|Island|Municipality|Commune|District|Body of water|British Overseas Territory|Sovereign state|Continent)\b/i.test(desc)) sc -= 4; // 地方
      if (/^\d{3,4}$/.test(title)) sc -= 4; // 年份
      // 很大的题目（「Phase of flight…」「Rhythm and blues music genre」）：说明里第一个词以后没有专有名词、没有数字
      if (desc && !/\d/.test(desc) && !/\s\p{Lu}/u.test(desc)) sc -= 2;
      // 这件事的主语：句子里这个条目的名字后面紧跟着动词（「Vietnam Airlines Flight 474 crashed」「HMS Ark Royal sank」）
      const name = norm(title.replace(/\s*\([^)]*\)\s*$/, ''));
      const at = name ? text.indexOf(name) : -1;
      if (at >= 0 && /^\s+(?:was|were|is|are|became|did|had|has|began|won|sank|ran|took|made|went|fell|flew|\w+ed)\b/.test(text.slice(at + name.length, at + name.length + 24))) sc += 2;
      if (sc > bestScore) { best = title; bestScore = sc; }
    });
    return best || '';
  }
  function wikiItem(src, key, wiki, kind, title, page, published) {
    const blocks = cleanArticle(page.html, { skip: /^\s*$/ });
    if (bodyLength(blocks) < (src.minBody || MIN_BODY)) return null;
    const link = `https://${wiki}.wikipedia.org/wiki/` + encodeURIComponent(page.title.replace(/ /g, '_'));
    return {
      id: `wiki:${wiki}:${kind}:${page.title}`,
      title,
      link,
      published,
      day: dayOf(published),
      program: src.program || 'Wikipedia',
      programId: key,
      tags: [],
      easy: !!src.easy,
      blocks,
      byline: '',
      source: sourceOf(src),
      credit: { license: src.license || WIKI_LICENSE, wiki: { title: page.title, link }, note: src.note },
    };
  }
  // src.wiki：哪种语言的维基百科；src.kind：news（新闻动态）、dyk（你知道吗）、onthisday（历史上的今天）、tfa（今日特色条目）；
  // src.dykPrefix：「你知道吗」那一条前面加的字（英语 'Did you know'）
  SV.adapters.wiki = async (src, key) => {
    const wiki = src.wiki;
    const { j, back } = await featured(wiki);
    const at = wikiTime(back);
    const entries = [];
    if (src.kind === 'news') for (const n of j.news || []) { const hk = hook(n.story); entries.push({ title: hk.text, main: hk.main || (n.links && n.links[0] && n.links[0].title.replace(/_/g, ' ')), lead: '' }); }
    if (src.kind === 'dyk') for (const d of j.dyk || []) { const hk = hook(d.html); entries.push({ title: (src.dykPrefix ? src.dykPrefix + ' ' : '') + hk.text.replace(/^\.\.\.\s*/, ''), main: hk.main, lead: '' }); }
    if (src.kind === 'onthisday') for (const o of (j.onthisday || []).slice(0, 15)) entries.push({ title: `${o.year}: ${norm(o.text)}`, main: otdPage(o), lead: '' });
    if (src.kind === 'tfa' && j.tfa) entries.push({ title: norm(j.tfa.titles && j.tfa.titles.normalized) || norm(j.tfa.title).replace(/_/g, ' '), main: norm(j.tfa.titles && j.tfa.titles.normalized) || j.tfa.title.replace(/_/g, ' '), lead: '' });
    const ex = await extracts(wiki, entries.map((e) => e.main));
    const out = [];
    entries.forEach((e, i) => {
      const page = ex.get(e.main);
      if (!page || !e.title) return;
      // 同一天的几条按首页上的顺序排（第一条最新）
      const it = wikiItem(src, key, wiki, src.kind, e.title, page, new Date(at.getTime() - i * 60000));
      if (it) out.push(it);
    });
    return out;
  };

  // 简易版维基百科（Simple English Wikipedia）：首页上（新闻动态、你知道吗、历史上的今天、特色条目）链到的条目，
  // 简易版里也有的，读简易版的导言。src.from：拿哪种维基百科的首页（'en'）；src.wiki：简易版（'simple'）
  SV.adapters.simplewiki = async (src, key) => {
    const { j, back } = await featured(src.from);
    const titles = [];
    const add = (t) => { if (t && !titles.includes(t)) titles.push(t); };
    for (const n of j.news || []) for (const t of hook(n.story).titles) add(t);
    for (const d of j.dyk || []) for (const t of hook(d.html).titles) add(t);
    for (const o of j.onthisday || []) for (const pg of o.pages || []) add(pg.title.replace(/_/g, ' '));
    if (j.tfa && j.tfa.titles) add(j.tfa.titles.normalized);
    const ex = await extracts(src.wiki, titles.slice(0, 40)); // 两次请求（一次最多 20 个条目），别问得太密
    const at = wikiTime(back);
    const out = [];
    const seen = new Set();
    titles.forEach((t, i) => {
      const page = ex.get(t);
      if (!page || seen.has(page.title) || (src.skipTitle && src.skipTitle.test(page.title))) return; // 「List of …」这样的列表条目不要
      seen.add(page.title);
      const it = wikiItem(src, key, src.wiki, 'simple', page.title, page, new Date(at.getTime() - i * 60000));
      if (it) { it.easy = true; out.push(it); }
    });
    return out;
  };

  // ---------- RSS 2.0（新西兰政府、南非政府新闻社、香港政府……）：全文在 content:encoded 或 description ----------
  // src.url：源的地址；src.proxy：要经过 Worker 的 /feed?src=<proxy>（js/config.js 的 feedProxy 是 true 才取）；
  // src.bylineOf(作者, 段落)：署名怎么写；src.lang、src.remove、src.skip、src.stop、src.tables、src.keepLinks 同上。
  SV.adapters.rss = async (src, key) => {
    const url = src.proxy ? proxyUrl('feed', src.proxy) : src.url;
    const text = await getText(url, { missingOk: !!src.proxy });
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('源格式不对');
    const out = [];
    for (const e of Array.from(xml.getElementsByTagName('item'))) {
      const get = (name) => {
        const n = e.getElementsByTagName(name)[0];
        return n ? n.textContent : '';
      };
      const title = plainText(get('title'));
      const link = norm(get('link')) || norm(get('guid'));
      const pub = new Date(get('pubDate') || get('dc:date') || get('updated'));
      if (!title || !link || isNaN(pub)) continue;
      if (src.skipTitle && src.skipTitle.test(title)) continue;
      const author = norm(get('dc:creator') || get('author'));
      const html = get('content:encoded') || get('description');
      if (src.rejectText && src.rejectText.test(html)) continue;
      const blocks = cleanArticle(html, { remove: src.remove, skip: src.skip, stop: src.stop, tables: src.tables, keepLinks: src.keepLinks, base: link });
      if (blocks.length && blocks[0].text === title) blocks.shift();
      if (bodyLength(blocks) < (src.minBody || MIN_BODY)) continue;
      if (src.lang && !looksLike(title + ' ' + blocks.slice(0, 3).map((b) => b.text).join(' '), src.lang)) continue;
      const byline = src.bylineOf ? src.bylineOf(author, blocks) : author;
      const cats = Array.from(e.getElementsByTagName('category')).map((c) => norm(c.textContent).toLowerCase()).filter(Boolean);
      out.push({
        id: key + ':' + (norm(get('guid')) || link),
        title,
        link,
        published: pub,
        day: dayOf(pub),
        program: src.program || src.name,
        programId: key,
        tags: cats.map((c) => key + ':' + c),
        easy: !!src.easy,
        blocks,
        byline,
        source: sourceOf(src),
        credit: { license: src.license, tagline: src.tagline, note: src.note, byline },
      });
    }
    return out;
  };

  // 几个请求同时最多 n 个（一篇篇取正文的源：欧盟委员会、ESO、加拿大政府、PIB……）。一个网站卡住时别让话题一直转圈：
  // 整个最多 budget 毫秒（默认 20 秒），连着两个超时就不再开始新的；到时候取到几篇算几篇（没取完的是 null）
  const ADAPTER_BUDGET = 20000;
  function mapLimit(list, n, fn, budget = ADAPTER_BUDGET) {
    const out = new Array(list.length).fill(null);
    let next = 0;
    let active = 0;
    let timeouts = 0;
    let done = false;
    return new Promise((resolve) => {
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(out.slice()); } };
      const timer = setTimeout(finish, budget);
      function pump() {
        while (!done && active < n && next < list.length && timeouts < 2) {
          const i = next++;
          active++;
          Promise.resolve().then(() => fn(list[i], i)).then((v) => { out[i] = v; timeouts = 0; }, (e) => {
            out[i] = null;
            if (e && /timeout/.test(e.message)) timeouts++;
          }).finally(() => { active--; pump(); });
        }
        if (!done && active === 0) finish();
      }
      pump();
    });
  }

  // ---------- 欧盟委员会新闻室（European Commission Press Corner，英文）：新闻稿、讲话、声明 ----------
  // 列表 api/search（最新的几十条，各种语言的都有，只要英文、不要机器翻译的），正文 api/documents（一篇一个请求，最多同时 3 个）。
  // 接口没有文档，回答的格式变了就当这个源没取到。CC BY 4.0：写「© European Union, 年份」、链接，说明只转了文字。
  // 全文照登（Background、Quote(s)、For more information 都在）；只有末尾给记者的联系方式（Press contacts、
  // General public inquiries）不要，blocks.cut 记下，许可的整句里写明。
  SV.adapters.ec = async (src, key) => {
    const base = 'https://ec.europa.eu/commission/presscorner/api/';
    const list = await getJson(base + 'search?language=en&pagesize=' + (src.list || 60));
    const types = src.types || ['IP', 'SPEECH', 'STATEMENT', 'QANDA', 'AC'];
    const rows = ((list && list.docuLanguageListResources) || [])
      .filter((x) => x && x.languageCode === 'EN' && !x.isETranslated && x.refCode && x.docutype && types.includes(x.docutype.code))
      .slice(0, src.count || 24);
    const docs = await mapLimit(rows, 4, (x) => getJson(base + 'documents?reference=' + encodeURIComponent(x.refCode) + '&language=en'));
    const out = [];
    rows.forEach((x, i) => {
      const d = docs[i];
      const res = d && d.docuLanguageResource;
      if (!res || !res.htmlContent) return;
      const title = norm(res.title || x.title);
      const pub = new Date(d.publishDate || x.eventDate);
      if (!title || isNaN(pub)) return;
      const blocks = cleanArticle(res.htmlContent, { tables: 'text', stop: /^(Press contacts?:?|General public inquiries\b)/i });
      if (blocks.length && blocks[0].text === title) blocks.shift();
      if (bodyLength(blocks) < MIN_BODY) return;
      const ref = x.refCode;
      out.push({
        id: 'ec:' + ref,
        title,
        link: 'https://ec.europa.eu/commission/presscorner/detail/en/' + ref.toLowerCase().replace(/\//g, '_'),
        published: pub,
        day: dayOf(pub),
        program: norm(x.docutype.description) || src.program || src.name,
        programId: key,
        tags: ((d.policiesResource) || []).map((pl) => 'ec:' + String(pl.code || '').toLowerCase()).concat('ec-type:' + x.docutype.code.toLowerCase()),
        easy: false,
        blocks,
        byline: '',
        source: sourceOf(src),
        credit: { license: src.license, copyright: '© European Union, ' + pub.getFullYear(), note: src.note },
      });
    });
    return out;
  };

  // ---------- ESO、ESA/Webb 的新闻稿（djangoplicity 网站）：RSS 里只有摘要，全文在网页上（网页也有 CORS） ----------
  // 网页里从「text_intro」那一段开始，到「More information」「Links」「Contacts」之前；图片、图片说明不要。CC BY 4.0。
  SV.adapters.djangoplicity = async (src, key) => {
    const xml = new DOMParser().parseFromString(await getText(src.url), 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('源格式不对');
    const entries = Array.from(xml.getElementsByTagName('item')).slice(0, src.count || 8).map((e) => ({
      title: plainText((e.getElementsByTagName('title')[0] || {}).textContent),
      link: norm((e.getElementsByTagName('link')[0] || {}).textContent),
      pub: new Date((e.getElementsByTagName('pubDate')[0] || {}).textContent),
    })).filter((x) => x.title && /^https:\/\//.test(x.link) && !isNaN(x.pub));
    const pages = await mapLimit(entries, 2, (x) => getText(x.link));
    const out = [];
    entries.forEach((x, i) => {
      if (!pages[i]) return;
      const doc = new DOMParser().parseFromString(pages[i], 'text/html');
      const first = doc.querySelector('.text_intro, .pr_first');
      if (!first) return;
      let html = '';
      let cut = '';
      for (let n = first; n; n = n.nextElementSibling) {
        if (/^H[1-4]$/.test(n.tagName) && /More information|Links|Contacts|About the Release|Images|Videos/i.test(n.textContent)) { cut = norm(n.textContent).slice(0, 80); break; }
        html += n.outerHTML;
      }
      const blocks = cleanArticle(html, { remove: '.archive-image, .image-container, .bg-image, .popup, .popup-link' });
      if (cut) blocks.cut = cut;
      if (bodyLength(blocks) < MIN_BODY) return;
      out.push({
        id: key + ':' + x.link,
        title: x.title,
        link: x.link,
        published: x.pub,
        day: dayOf(x.pub),
        program: src.program || src.name,
        programId: key,
        tags: [],
        easy: false,
        blocks,
        byline: '',
        source: sourceOf(src),
        credit: { license: src.license, note: src.note },
      });
    });
    return out;
  };

  // ---------- eLife digests（给一般读者写的科研简讯，CC BY 4.0） ----------
  SV.adapters.elife = async (src, key) => {
    const list = await getJson('https://api.elifesciences.org/digests?per-page=' + (src.count || 8) + '&order=desc');
    const rows = ((list && list.items) || []).filter((x) => x && x.id && x.stage === 'published');
    const docs = await mapLimit(rows, 3, (x) => getJson('https://api.elifesciences.org/digests/' + encodeURIComponent(x.id)));
    const out = [];
    rows.forEach((x, i) => {
      const d = docs[i];
      if (!d || !Array.isArray(d.content)) return;
      const html = d.content.filter((c) => c && c.type === 'paragraph' && c.text).map((c) => '<p>' + c.text + '</p>').join('');
      const blocks = cleanArticle(html);
      if (bodyLength(blocks) < MIN_BODY) return;
      const pub = new Date(d.published || x.published);
      if (isNaN(pub)) return;
      out.push({
        id: 'elife:' + x.id,
        title: plainText(d.title || x.title),
        link: 'https://elifesciences.org/digests/' + encodeURIComponent(x.id),
        published: pub,
        day: dayOf(pub),
        program: src.program || src.name,
        programId: key,
        tags: (d.subjects || []).map((sb) => 'elife:' + sb.id),
        easy: !!src.easy,
        blocks,
        byline: '',
        source: sourceOf(src),
        credit: { license: src.license, note: src.note },
      });
    });
    return out;
  };

  // ---------- 没有 CORS 的网站：经过 Worker 的新闻代理（/feed、/page，只认 Worker 里写好的源） ----------
  // js/config.js 的 feedProxy 是 false（部署了的 Worker 还没有新闻代理）时不取：这些源的文章就没有，不另外说
  // Worker 的地址：js/config.js 的 newsUrl（不写就是 ttsUrl，同一个 Worker）
  function proxyUrl(kind, id, path) {
    const base = SV.config && (SV.config.newsUrl || SV.config.ttsUrl);
    if (!SV.config || !SV.config.feedProxy || !base) throw permanent('no news proxy');
    return String(base).replace(/\/+$/, '') + '/' + kind + '?src=' + encodeURIComponent(id) + (path ? '&p=' + encodeURIComponent(path) : '');
  }
  const viaPage = (id, path) => getText(proxyUrl('page', id, path), { missingOk: true, timeout: 12000 });
  const htmlDoc = (text) => new DOMParser().parseFromString(text, 'text/html');
  // 网页里一块的 HTML，交给 cleanArticle
  function pageBlocks(doc, sel, opt) {
    const el = doc.querySelector(sel);
    return el ? cleanArticle(el.innerHTML, opt) : [];
  }
  const makeItem = (src, key, x) => Object.assign({ programId: key, tags: [], easy: !!src.easy, byline: '', source: sourceOf(src), day: dayOf(x.published) }, x,
    { credit: Object.assign({ license: src.license, note: src.note }, x.credit || {}) });
  const withStatement = (lic, statement) => Object.assign({}, lic || {}, { statement });

  // ---------- 加拿大政府新闻（Government of Canada）：列表 api.io.canada.ca（有 CORS），全文在 canada.ca 的网页上（经过代理） ----------
  // 署名：标题、部门，「a copy of the version available at <网址>」（非商业转载）
  SV.adapters.gcnews = async (src, key) => {
    proxyUrl('page', src.proxy, '/'); // 没有新闻代理就不取（列表里只有一两句的摘要）
    const j = await getJson('https://api.io.canada.ca/io-server/gc/news/en/v2?sort=publishedDate&orderBy=desc&pick=' + (src.list || 40) + '&format=json' + (src.query || ''));
    const rows = ((j && j.feed && j.feed.entry) || []).filter((e) => e && e.link && e.title).slice(0, src.count || 16);
    const pages = await mapLimit(rows, 3, (e) => {
      const u = new URL(e.link, 'https://www.canada.ca');
      return u.hostname === 'www.canada.ca' ? viaPage(src.proxy, u.pathname) : null;
    });
    const out = [];
    rows.forEach((e, i) => {
      if (!pages[i]) return;
      const doc = htmlDoc(pages[i]);
      const box = doc.querySelector('#news-release-container');
      if (!box) return;
      const dept = norm((box.querySelector('p.gc-byline a') || doc.querySelector('p.gc-byline a') || {}).textContent);
      const kind = norm((box.querySelector('h2') || {}).textContent);
      const blocks = cleanArticle(box.innerHTML, { remove: 'p.teaser.hidden, .hidden, section.lnkbx, .news-tags, .pagedetails, p.gc-byline, h1', stop: /^(Contacts?|Associated links|Stay connected)$/i, skip: /^(News release|Statement|Backgrounder|Media advisory|Readout|Speech)$/i });
      if (bodyLength(blocks) < MIN_BODY) return;
      const pub = new Date(e.publishedDate);
      if (isNaN(pub)) return;
      const link = new URL(e.link, 'https://www.canada.ca').href;
      const title = plainText(e.title);
      out.push(makeItem(src, key, {
        id: 'gc:' + link, title, link, published: pub, program: dept || kind || src.program, blocks, tags: dept ? ['gc:' + dept.toLowerCase()] : [],
        credit: { license: withStatement(src.license, '“' + title + '”' + (dept ? ', ' + dept : '') + ', Government of Canada. This reproduction is a copy of the version available at ' + link + '.') },
      }));
    });
    return out;
  };

  // ---------- 加拿大统计局 The Daily：目录 www150.statcan.gc.ca（有 CORS），文章经过代理 ----------
  SV.adapters.statcan = async (src, key) => {
    proxyUrl('page', src.proxy, '/');
    const doc = htmlDoc(await getText('https://www150.statcan.gc.ca/n1/dai-quo/index-eng.htm'));
    const dateText = norm((doc.querySelector('p.sd-daily-date') || {}).textContent);
    const rows = Array.from(doc.querySelectorAll('.sd-daily-toc .panel')).map((pn) => {
      const a = pn.querySelector('a[href*="/daily-quotidien/"]');
      if (!a) return null;
      // 目录里的链接是 /daily-quotidien/…（网页的 base 是 /n1/），文章真正的地址是 /n1/daily-quotidien/…
      const path = new URL(a.getAttribute('href'), 'https://www150.statcan.gc.ca/').pathname.replace(/^\/daily-quotidien\//, '/n1/daily-quotidien/');
      return { title: norm((pn.querySelector('h3') || a).textContent), path, theme: norm((pn.querySelector('.panel-heading h2') || {}).textContent) };
    }).filter((x) => x && /^\/n1\/daily-quotidien\/\d{6}\/dq\d{6}[a-z]{1,2}-eng\.htm$/.test(x.path)).slice(0, src.count || 8);
    const pages = await mapLimit(rows, 3, (x) => viaPage(src.proxy, x.path));
    const out = [];
    rows.forEach((x, i) => {
      if (!pages[i]) return;
      const pd = htmlDoc(pages[i]);
      const blocks = pageBlocks(pd, 'main > section', { remove: '.release_nav, .sd-thumbnail, .tablebtn, .sdg, .sd-noteuser, .pagedetails, h1, p.sd-release-date', stop: /^(Contact information|Note to readers|Available tables|Products)$/i, tables: 'none' });
      if (bodyLength(blocks) < MIN_BODY) return;
      const m = x.path.match(/dq(\d{2})(\d{2})(\d{2})/);
      if (!m) return;
      const pub = new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], 13, 30)); // The Daily 每天 8:30（渥太华时间）发布
      const link = 'https://www150.statcan.gc.ca' + x.path;
      const rd = norm((pd.querySelector('p.sd-release-date') || {}).textContent).replace(/^Released:\s*/i, '') || dateText;
      out.push(makeItem(src, key, {
        id: 'statcan:' + x.path, title: x.title, link, published: pub, program: x.theme ? src.program + ' · ' + x.theme : src.program, blocks,
        credit: { license: withStatement(src.license, 'Adapted from Statistics Canada, The Daily, “' + x.title + '”, ' + rd + '. This does not constitute an endorsement by Statistics Canada of this product.') },
      }));
    });
    return out;
  };

  // ---------- 印度政府新闻局 PIB（英文）：今天的新闻稿列表、一篇篇的新闻稿，都经过代理 ----------
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function pibDate(text) {
    // 「14 NOV 2026 3:45PM」（印度时间）
    const m = String(text || '').match(/(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m || !(m[2].toLowerCase() in MONTHS)) return null; // 认不出时间：这篇不要（不当作「现在」）
    let hr = +m[4] % 12;
    if ((m[6] || '').toUpperCase() === 'PM') hr += 12;
    return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], hr, +m[5]) - 330 * 60000);
  }
  SV.adapters.pib = async (src, key) => {
    const list = htmlDoc(await viaPage(src.proxy, '/allRel.aspx?reg=3&lang=1'));
    const rows = [];
    for (const hd of list.querySelectorAll('h3')) {
      const ministry = norm(hd.textContent);
      let n = hd.nextElementSibling;
      while (n && n.tagName !== 'UL' && n.tagName !== 'H3') n = n.nextElementSibling;
      if (!n || n.tagName !== 'UL') continue;
      for (const a of n.querySelectorAll('a[href*="PRID="]')) {
        const m = (a.getAttribute('href') || '').match(/PRID=(\d{6,8})/);
        if (m) rows.push({ prid: m[1], title: norm(a.textContent), ministry });
      }
    }
    const pick = rows.filter((x) => !src.skipTitle || !src.skipTitle.test(x.title)).slice(0, src.count || 16);
    const pages = await mapLimit(pick, 3, (x) => viaPage(src.proxy, '/PressReleaseIframePage.aspx?PRID=' + x.prid + '&reg=3&lang=1'));
    const out = [];
    pick.forEach((x, i) => {
      if (!pages[i]) return;
      const pd = htmlDoc(pages[i]);
      const raw = pd.querySelector('input#ltrDescriptionn, input#ltrDescription');
      const blocks = cleanArticle(raw ? raw.getAttribute('value') || '' : '', { skip: /^[_\s*]+$|^[A-Z]{1,4}(\/[A-Z]{1,4})+(\/\d+)*$|^\(Release ID|^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i });
      if (bodyLength(blocks) < MIN_BODY) return;
      const ministry = norm((pd.querySelector('#MinistryName') || {}).textContent) || x.ministry;
      const title = norm((pd.querySelector('#Titleh2') || {}).textContent) || x.title;
      const link = 'https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=' + x.prid;
      const pub = pibDate((pd.querySelector('#PrDateTime') || {}).textContent);
      if (!pub) return;
      out.push(makeItem(src, key, {
        id: 'pib:' + x.prid, title, link, published: pub, program: ministry || src.program, blocks,
        tags: ministry ? ['pib:' + ministry.toLowerCase()] : [],
        credit: { license: withStatement(src.license, 'Source: Press Information Bureau (pib.gov.in)' + (ministry ? ', ' + ministry : '') + ', Government of India.') },
      }));
    });
    return out;
  };

  // ---------- Frontiers for Young Minds（给孩子读的科学文章，CC BY 4.0）：最新文章的列表、文章，都经过代理 ----------
  SV.adapters.frym = async (src, key) => {
    const list = htmlDoc(await viaPage(src.proxy, '/articles'));
    const rows = Array.from(list.querySelectorAll('.article')).map((a) => {
      const link = a.querySelector('a[href*="/articles/10.3389/frym."]');
      if (!link) return null;
      return { path: new URL(link.getAttribute('href'), 'https://kids.frontiersin.org').pathname, title: norm((a.querySelector('.article-heading') || link).textContent), date: norm((a.querySelector('.article-date') || {}).textContent) };
    }).filter((x) => x && /^\/articles\/10\.3389\/frym\.\d{4}\.\d{5,7}$/.test(x.path)).slice(0, src.count || 6);
    const pages = await mapLimit(rows, 2, (x) => viaPage(src.proxy, x.path));
    const out = [];
    rows.forEach((x, i) => {
      if (!pages[i]) return;
      const pd = htmlDoc(pages[i]);
      const blocks = pageBlocks(pd, '.fulltext-content', { remove: 'figure, .figure, sup, .references', stop: /^(Glossary|Conflict of Interest|Acknowledgments?|AI Tool Statement|References|Original Source Article)$/i, tables: 'none' });
      if (bodyLength(blocks) < MIN_BODY) return;
      const pub = new Date(norm((pd.querySelector('.fulltext-date') || {}).textContent) || x.date);
      if (isNaN(pub)) return; // 认不出日期：这篇不要
      const authors = Array.from(pd.querySelectorAll('.fulltext-person-name')).map((n) => norm(n.textContent)).filter(Boolean);
      const doi = x.path.replace(/^\/articles\//, '');
      const link = 'https://kids.frontiersin.org' + x.path;
      const byline = authors.length > 3 ? authors.slice(0, 3).join(', ') + ' et al' : authors.join(', ');
      const title = norm((pd.querySelector('h1.fulltext-heading') || {}).textContent) || x.title;
      // 文章开头一行写前三位作者（et al）；许可的整句里是全部作者（CC BY 要写明作者）
      out.push(makeItem(src, key, {
        id: 'frym:' + doi, title, link, published: pub, program: src.program, blocks, easy: true, byline,
        credit: { byline, license: withStatement(src.license, (authors.length ? authors.join(', ') + '. ' : '') + '“' + title + '”. Frontiers for Young Minds. doi:' + doi + '. CC BY 4.0; text only (figures, glossary and references not reproduced).') },
      }));
    });
    return out;
  };

  SV.adapterTest = { mapLimit }; // 给自动测试看（一个网站卡住时整个最多 20 秒）
})();

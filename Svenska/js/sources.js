/* 文章来源：瑞典广播电台（Sveriges Radio, SR）开放接口里各节目的 Atom 新闻源。
   api.sr.se 回 Access-Control-Allow-Origin: *，浏览器可以直接读，不用服务器也不用代理。
   每个源里是这个节目最新的 20 篇文章，带全文（HTML）。文章只在打开网页时现取，
   只放在内存里（SR 的条款不允许另存、复制、修改），本站不保存文章。 */
(function () {
  'use strict';
  const SV = window.SV;

  const FEED_URL = 'https://api.sr.se/api/rss/program/';
  const EASY = new Set([4916, 493]); // 简易瑞典语：Radio Sweden på lätt svenska、Klartext
  const EASY_FEEDS = [4916, 493];
  // 普通新闻的主力：Ekot（SR 的新闻部，全天滚动）、Dagens Eko、Studio Ett、P3 Nyheter
  const G = [83, 5526, 1637, 5335];
  const P4 = [103, 104, 96, 114]; // P4 斯德哥尔摩、哥德堡、马尔默、乌普萨拉的地方新闻

  // zh：话题按钮上的中文名；sv：瑞典文名，是话题按钮的瑞典文提示（每个按钮都有瑞典文提示）。
  // 关键词写法：普通词按词头匹配（regering 也匹配 regeringen、regeringsbildning），
  // 「=」开头的必须整词相同，「_」表示词组里的空格，「+」开头的算两倍分。都用小写。
  // all：这些节目的文章不看关键词，全部属于这个话题。min：至少要几分才算（默认 3，见 score）。
  // strict：不够分时不拿沾边的文章充数；core：「+」词至少要出现几次（标题里出现算两次）。这两个现在没有话题用（用过它们的「电动车」2026-11-14 去掉了）。
  // 手机上话题不是一排按钮，是标题旁边的下拉菜单（js/app.js 的 renderChips 用这同一张表做按钮和菜单）。
  // 简易瑞典语只是最后一个单独的话题，别的话题都用普通的新闻。
  const TOPICS = [
    { key: 'idag', zh: '今日要闻', sv: 'Dagens nyheter', feeds: [83, 5526, 1637, 5335], all: [83, 5526, 1637, 5335], kw: '' },
    {
      key: 'sverige', zh: '瑞典', sv: 'Sverige', feeds: [83, ...P4, 5526], all: P4,
      kw: '=sverige sveriges svensk stockholm göteborg malmö uppsala skåne norrland lappland skellefteå umeå luleå kiruna linköping norrköping örebro västerås jönköping gävle sundsvall gotland halland värmland dalarna småland smhi polisen kommunen kommuner regionen riksdag regering försäkringskassan migrationsverket skatteverket arbetsförmedlingen folkhälsomyndigheten',
    },
    {
      key: 'politik', zh: '政治', sv: 'Politik', feeds: [...G, 438], all: [],
      kw: 'politik regering riksdag minister statsminister partiledar =parti =partiet =partier =partierna opposition budget socialdemokrat moderat sverigedemokrat vänsterparti centerparti liberalerna kristdemokrat miljöparti talman =val =valet valrörelse valresultat riksdagsval väljar regeringsbildning övergångsregering lagförslag proposition president presidentval parlament kongress senat premiärminister eu-kommission kommunfullmäktige demokrati diktatur sanktion',
    },
    {
      key: 'varlden', zh: '国际', sv: 'Världen', feeds: [...G, 438, 4773, 2946, 5459], all: [4773, 2946, 5459],
      kw: '=usa amerikansk trump ryssland rysk putin ukraina ukrain kiev kyiv =eu europeiska =fn =nato israel gaza palestin hamas hizbollah iran syrien libanon jemen krig konflikt vapenvila fredsavtal fredssamtal indien japan sydkorea nordkorea afrika frankrike fransk tyskland storbritannien brittisk london spanien italien polen finland norge danmark utrikes diplomat flykting terror =g7 =g20 venezuela brasilien mexiko turkiet egypten',
    },
    {
      key: 'usa', zh: '美国', sv: 'USA', feeds: [...G, 4923, 438, 4773], all: [4923],
      kw: '+=usa +=usa:s +amerikansk trump vita_huset washington kongressen senaten representanthuset demokraterna republikanerna new_york kalifornien texas florida pentagon =fbi =cia biden harris vance mellanårsval',
    },
    {
      key: 'eu', zh: '欧盟', sv: 'EU', feeds: [...G, 4941, 438, 4773], all: [4941],
      kw: '+=eu +=eu:s eu-kommission eu-parlament eu-länder europaparlament europeiska_unionen europeiska_kommissionen ministerrådet bryssel von_der_leyen =euro euron eurozon schengen strasbourg europaval eu-domstol',
    },
    {
      key: 'kina', zh: '中国', sv: 'Kina', feeds: [...G, 5386, 438, 4773], all: [5386],
      kw: 'kina kines peking beijing shanghai =xi jinping hongkong taiwan tibet xinjiang uigur kommunistpartiet huawei =byd alibaba shenzhen guangzhou wuhan =yuan',
    },
    {
      key: 'forsvar', zh: '军事国防', sv: 'Försvar', feeds: [...G, 438, 2946, 1300, 4773], all: [], min: 4,
      kw: '+försvar +militär +=nato +nato:s soldat +armé armén +marinen +flygvapn +värnplikt +totalförsvar krigsmakt vapen vapenexport krigsmateriel ammunition missil robotar ubåt stridsvagn stridsflyg =jas gripen =saab drönare säkerhetspolitik beredskap civilförsvar hybridhot sabotage spion =must säpo kärnvapen invasion fronten anfall attack krig',
    },
    {
      key: 'ekonomi', zh: '经济', sv: 'Ekonomi', feeds: [...G, 2778, 6679], all: [2778, 6679],
      kw: 'ekonomi ränta räntan riksbank inflation arbetslös =jobb =jobben konkurs varsel =lön =löner =lönen skatt budget bostadspris bolån export import =tull =tullar tullkrig handelskrig =bnp tillväxt lågkonjunktur högkonjunktur recession investering =priser =priserna prishöjning elpris matpris =hyra =hyror pension företag =bank =banken =banker',
    },
    {
      key: 'borsen', zh: '股市', sv: 'Börsen', feeds: [...G, 2778, 6679], all: [], min: 4,
      kw: '+börs +aktie +stockholmsbörsen +nasdaq +=omx +=omxs30 dow_jones wall_street index =kursen kursras kursrus +utdelning investerare fond fonder =vd vd:n bolag bolaget börsvärde marknadsvärde kvartalsrapport rapporten vinst förlust omsättning riksbank ränta nvidia tesla ericsson volvo kryptovaluta bitcoin',
    },
    {
      key: 'teknik', zh: '科技', sv: 'Teknik', feeds: [...G, 4090], all: [4090],
      kw: '=ai artificiell_intelligens teknik techbolag techjätte =app =appen =appar internet mobiltelefon =mobilen smartphone dator datacenter robot =chip =chipet chipjätte halvledar nvidia =apple google microsoft =meta tiktok spotify ericsson samsung openai chatgpt cyber hackare hackar it-attack it-säkerhet digital bredband =5g algoritm sociala_medier instagram facebook youtube =musk drönare satellit datorspel tv-spel',
    },
    {
      key: 'vetenskap', zh: '科学', sv: 'Vetenskap', feeds: [83, 412, 406, 3345], all: [412, 406],
      kw: 'forskare forskning forskar studie studien vetenskap universitet rymd =nasa =esa planet galax svart_hål svarta_hål astronom fysik kemi biolog arkeolog fossil =dna genetisk evolution nobelpris experiment laborator karolinska mikrob bakterie upptäckt',
    },
    {
      key: 'halsa', zh: '健康', sv: 'Hälsa', feeds: [...G, 1272, 412], all: [1272],
      kw: 'hälsa =ohälsa vård sjukvård sjukhus sjukdom läkare sjuksköterska patient cancer vaccin virus smitta covid influensa medicin läkemedel psykisk depression demens diabetes hjärt stroke tandvård folkhälsa vårdcentral akuten operation alkohol rökning narkotika sömn övervikt',
    },
    {
      key: 'klimat', zh: '环境气候', sv: 'Miljö och klimat', feeds: [...G, 3345], all: [3345],
      kw: 'klimat miljö utsläpp koldioxid växthusgas fossila förnybar solenergi solcell vindkraft kärnkraft energi natur skog biologisk_mångfald utrotning =hav =havet =haven plast översvämning torka värmebölja =storm stormen oväder snöfall =snö smhi =väder vädret klimatmöte cop1 cop2 cop3 naturvård återvinning',
    },
    {
      key: 'utbildning', zh: '教育', sv: 'Utbildning', feeds: [...G, ...P4], all: [], min: 4,
      kw: '+skola +skolan +skolor +elev +lärare +förskola +gymnasi +högskola +universitet utbildning studenter =student betyg skolinspektionen skolverket läxor klassrum rektor =sfi svenska_för_invandrare yrkesutbildning folkhögskola =csn studielån',
    },
    {
      key: 'migration', zh: '移民', sv: 'Migration', feeds: [...G, ...P4], all: [], min: 4,
      kw: '+migration +invandr +asyl +flykting +medborgarskap +uppehållstillstånd +migrationsverket +utvisning utvisad +arbetstillstånd integration nyanländ =sfi svenska_för_invandrare gränskontroll anhöriginvandring återvandring',
    },
    {
      key: 'brott', zh: '治安法律', sv: 'Lag och ordning', feeds: [...G, ...P4, 4702, 5413], all: [4702, 5413], min: 4,
      kw: '+polis +gripen +gripna +greps +åtal +åtalad +misstänkt +misstänks +mord +dödsskjutning +skjutning +sprängning +gäng rättegång tingsrätt hovrätt fängelse =dom =domen dömd döms brott brottsling stöld rån bedrägeri bluff våldtäkt misshandel narkotika säpo',
    },
    {
      key: 'kultur', zh: '文化', sv: 'Kultur', feeds: [83, 478, 5053, 5335], all: [478, 5053],
      kw: 'kultur musik film =bok =boken böcker författar konst konstnär teater museum utställning konsert artist sångare sångerska roman litteratur festival opera =dans tv-serie melodifestival eurovision skådespelar regissör poesi =dikt =bio =bion biograf datorspel',
    },
    {
      key: 'sport', zh: '体育', sv: 'Sport', feeds: [83, 179, 5514, 6656, 5335, 103, 104], all: [179, 5514, 6656],
      kw: 'sport fotboll hockey ishockey =os olympisk =vm =em allsvensk landslag =match =matchen =matcher tränare =spelare =spelaren =seger =segern =final =finalen tennis golf friidrott skidor längdskid skidskytte handboll parahandboll bandy basket simning cykling boxning =nhl zlatan =fifa paralympics parasport idrott =guld =silver =brons',
    },
    // 额外的一个话题：SR 专门用简易瑞典语写的新闻（句子短、词简单）
    { key: 'latt', zh: '简易瑞典语', sv: 'Lätt svenska', feeds: EASY_FEEDS, all: EASY_FEEDS, kw: '' },
  ];

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
    t.allSet = new Set(t.all);
  }

  // ---------- 取源：限流 + 内存缓存 ----------
  // SR 的服务器（Akamai）会暂时拒绝太密集的请求，所以同时最多取 2 个源，
  // 同一个源 10 分钟内不再重取（浏览器自己还会按 SR 给的 max-age=60 缓存）。
  const TTL = 10 * 60 * 1000;
  const cache = new Map(); // programId -> { at, items } 或 { promise }
  let active = 0;
  const waiting = [];
  async function slot() {
    while (active >= 2) await new Promise((r) => waiting.push(r));
    active++;
  }
  function release() {
    active--;
    const w = waiting.shift();
    if (w) w();
  }

  function fetchFeed(id) {
    const c = cache.get(id);
    if (c && c.promise) return c.promise;
    if (c && Date.now() - c.at < TTL) return Promise.resolve(c.items);
    const p = (async () => {
      await slot();
      try {
        let lastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await fetch(FEED_URL + id, { credentials: 'omit', referrerPolicy: 'no-referrer' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const items = parseFeed(await r.text(), id);
            cache.set(id, { at: Date.now(), items });
            return items;
          } catch (e) {
            lastErr = e;
            if (attempt === 0) await SV.sleep(1500);
          }
        }
        throw lastErr;
      } finally {
        release();
      }
    })();
    cache.set(id, { promise: p });
    p.catch(() => { if (cache.get(id) && cache.get(id).promise === p) cache.delete(id); });
    return p;
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
        day: SV.stockholmDay(pub),
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
  function score(item, topic) {
    let s = topic.allSet.has(item.programId) ? 4 : 0;
    if (!topic.kws.length) return s;
    if (!item._tok) {
      const t = tokens(item.title);
      const b = tokens(item.blocks.map((x) => x.text).join(' '));
      item._tok = { t, b, tj: ' ' + t.join(' ') + ' ', bj: ' ' + b.join(' ') + ' ' };
    }
    const k = item._tok;
    const ti = countHits(k.t, k.tj, topic.kws);
    const bo = countHits(k.b, k.bj, topic.kws);
    // core：「+」词至少要出现几次（标题里的算两次），只顺带提一句的文章不算（现在没有话题用它）
    if (topic.core && 2 * ti.core + bo.core < topic.core) return s;
    return s + 3 * ti.hits + bo.hits;
  }

  async function loadTopic(topic, onProgress) {
    let done = 0;
    const results = await Promise.allSettled(topic.feeds.map((id) => fetchFeed(id).finally(() => {
      done++;
      if (onProgress) onProgress(done, topic.feeds.length);
    })));
    const seen = new Set();
    let cands = [];
    const loose = [];
    let failed = 0;
    const min = topic.min || 3;
    for (const r of results) {
      if (r.status !== 'fulfilled') { failed++; continue; }
      for (const it of r.value) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        const sc = score(it, topic);
        if (sc >= min) cands.push({ item: it, score: sc });
        else if (sc >= 2) loose.push({ item: it, score: sc });
      }
    }
    let isLoose = false;
    if (!cands.length && loose.length && !topic.strict) { cands = loose; isLoose = true; }
    return { cands, loose: isLoose, failed, total: topic.feeds.length, error: failed === topic.feeds.length ? results[0].reason : null };
  }

  // ---------- 文章列表：一批几篇，最新的在前；再点一次话题换下一批，列过的不再列 ----------
  // 只记文章的编号，不记内容。
  const SHOWN_KEY = 'sv.shown.v1'; // { 话题: [列过的编号] }
  const READ_KEY = 'sv.read.v1'; // [打开读过的编号]，列表里标「已读」
  const BATCH_KEY = 'sv.batch.v1'; // sessionStorage：{ 话题: [这一批的编号] }，刷新网页时还是这一批

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
    const items = pool.slice(0, size).map((c) => c.item);
    const today = SV.stockholmDay(new Date());
    if (!items.some((it) => it.day === today)) {
      const age = SV.dayDiff(today, items[0].day);
      notices.push(age <= 1 ? '这个话题今天还没有新文章，下面是最近的。' : `这个话题今天还没有新文章，最新的一篇是 ${age} 天前的。`);
    }
    setShown(topic.key, [...shown, ...items.map((it) => it.id)]);
    batches[topic.key] = items.map((it) => it.id);
    SV.session.set(BATCH_KEY, batches);
    return { items, notices, more: pool.length > items.length, restarted };
  }

  SV.sources = { TOPICS, EASY, loadTopic, nextBatch, markRead, readSet, clearHistory, fetchFeed, parseFeed, cleanHtml, score, tokens };
})();

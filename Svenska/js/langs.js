/* 选语言：网址的 ?lang=en（可以收藏；没有或者不认识就是瑞典语）。每种语言的设置在 js/lang/<代码>.js，
   用 SV.addLang 登记；这里选出现在这种，放在 SV.lang，别的文件（话题、分句、朗读、翻译、界面）都按它来。
   换语言就是打开另一个网址（js/app.js 的国旗按钮），网页整个重新载入，所以每个文件只在载入时读一次 SV.lang。
   各种语言的阅读记录、单词的译文缓存、话题和声音分开存（存储的键前面是语言代码，瑞典语还是以前的 sv.…）；
   字号、语速、读完以后、男声女声、在线翻译开关这些是读者自己的习惯，各种语言共用（存在 sv.settings.v1）。 */
(function () {
  'use strict';
  const SV = window.SV;
  // 国旗的顺序：瑞典语、英语总在前面（Tony 定的）；以后加的语言排在后面
  const ORDER = ['sv', 'en'];
  const rank = (code) => { const i = ORDER.indexOf(code); return i < 0 ? ORDER.length : i; };
  SV.langList = SV.LANGS.slice().sort((a, b) => rank(a.code) - rank(b.code));
  const byCode = new Map(SV.langList.map((l) => [l.code, l]));

  let code = 'sv';
  try {
    const q = (new URLSearchParams(location.search).get('lang') || '').trim().toLowerCase();
    if (byCode.has(q)) code = q;
  } catch (e) { /* 没有网址（测试里）就是瑞典语 */ }
  const L = byCode.get(code) || SV.langList[0];
  L.prefix = L.code + '.'; // 瑞典语 'sv.'：和以前的键一样
  SV.lang = L;

  // 换语言的网址：只改 ?lang=（瑞典语去掉这个参数），别的参数（话题等）不带过去
  SV.langUrl = (c) => {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    if (c !== 'sv') u.searchParams.set('lang', c);
    return u.href;
  };

  // 「今天」和文章的时间：瑞典语按瑞典时间（和以前一样）；timeZone 不写的语言按读者自己这里的时间
  const fmt = new Intl.DateTimeFormat('en-GB', Object.assign({
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }, L.timeZone ? { timeZone: L.timeZone } : {}));
  const parts = (d) => { const o = {}; for (const p of fmt.formatToParts(d)) o[p.type] = p.value; return o; };
  SV.newsDay = (d) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
  SV.newsTime = (d) => { const p = parts(d); return `${p.hour}:${p.minute}`; };

  // 只靠新闻代理才有文章的话题（needsProxy）：部署了的 Worker 还没有新闻代理（js/config.js 的 feedProxy）时不列
  if (!(SV.config && SV.config.feedProxy)) L.topics = L.topics.filter((t) => !t.needsProxy);
  // 话题的外文名（按钮的提示）：瑞典语的话题写在 sv 里，别的语言写在 native 里
  for (const t of L.topics) if (!t.native) t.native = t.sv;

  // 按钮的提示（第一行是正在学的这种语言）：js/app.js 里写的是瑞典文，别的语言按 tips 换掉；
  // tipRe：带数字的（「Talhastighet 0,9×」）用正则换。没有对应的就还是原来的字。
  SV.tipText = (s) => {
    if (L.code === 'sv' || !s) return s;
    if (L.tips && Object.prototype.hasOwnProperty.call(L.tips, s)) return L.tips[s];
    for (const [re, rep] of L.tipRe || []) if (re.test(s)) return s.replace(re, rep);
    return s;
  };
})();

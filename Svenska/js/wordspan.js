/* 点了一个词、看整句的译文时：这个词在整句译文里是哪几个字（Tony 定的，2026-11-15：「当点击单词跳出翻译时，如果继续按整句翻译，
   则原始被按的词的翻译要在整句翻译中用下划线表现出来」）。瑞典语、英语一样。

   只用已经有的东西：微软翻译把整句当 HTML 翻译、查的词包在 <b> 里（js/sense.js 的 tagSentence，Worker 不用改），
   这个词自己的译文（小词典的意思，或者翻译引擎给这个词的译文），这一句里别的词的译文。中文按词切开用浏览器的
   Intl.Segmenter（zh，granularity: 'word'）。按下面的顺序，前一步找到了就不再往下（locate）：

   1. 标签（'tag'）：微软放 <b> 的地方。去掉两头的标点、空格和虚词（的、了、中、该……，整个词才去），切到词的边界上。
      不要的标签：空的；跨过了标点（「小时，最终」）；只有一个汉字、又不是这个词的译文里的字（agreed →「认」）；
      小词（the、of、och、som……）的标签里没有它的译文里的字（the →「欧」）；太宽、里面又没有这个词的译文里的字；
      盖住几个词、其中一个只和别的词的译文有共同的字（soaring →「对食品价格」，「食品」是 food 的）；
      正好是这一句里别的词的译文（blaze →「控制」，是 control 的）。标签里有几个词、只有一部分和这个词的译文有共同的字：
      只画那一部分（announced →「周二宣布」画「宣布」）。这个词的译文在句子里别的地方正好出现一次、标签又不含它的译文：
      画那里（control 的标签在「火势」上，「控制」在别处）。数字也算这个词的译文（「20-year-old」的标签「20岁的司」画「20岁」，
      「了3.5」画「3.5」，3,5 和 3.5 一样）；和前面的词连起来才是一个词的不当虚词去掉（「实际上」不去「上」）。
   2. 这个词的译文（'cand'）：两个汉字以上的译文在整句译文里正好出现一次（不在别的词的译文里面）；
      小词典里一个字的意思正好在一个词里（kall「冷」→「寒冷」）。
   3. 剩下的（'rest'）：微软没有把这个词对到任何字上（Tony 的例子：enshrined 的标签是空的，单独译成「入祀」）。
      这个词前后三个词以内、同一个小句（逗号之间）里的实词的译文在整句译文里找到了（UNCLOS →「联合国海洋法公约」），
      那几个中文小句里，去掉这一句所有别的词的译文和虚词（也去掉常见的代词、助动词：「我们」「可以」），正好只剩一个词
      没有着落（「规定」），就是它。只在微软翻译带标签的整句上做（没有标签的整句不做）。
      剩下两处以上、或者剩下挨着的几个词（tidigt：「清晨」「离开」都没有着落）：不画。
   4. 都不行：不画（'none'）。宁可不画，也不画错。小词只做 1、2。
   2026-11-15 用 41 句自己编的英语、瑞典语句子（211 个词）和真的微软翻译量过：画了 191 个，错 2 个，对一部分 8 个
   （tests/wordspan_cases.json、tests/sense_eval.mjs；数字和例子见 README「翻译 → 整句译文里点的词」）。

   只返回位置，不碰页面：显示由 js/app.js 做（文字节点，不用 innerHTML）。 */
(function () {
  'use strict';
  const SV = window.SV;
  // 汉字（也算扩展 B 以后的，「𠮷」这样的字在 JavaScript 里是两个码元）
  const HAN_SRC = '[\\u3400-\\u9fff\\uf900-\\ufaff\\u{20000}-\\u{3134f}]';
  const HAN = new RegExp(HAN_SRC, 'u');
  const HAN_G = new RegExp(HAN_SRC, 'gu');
  const hanCount = (s) => (String(s || '').match(HAN_G) || []).length;
  // 用来比的东西：汉字和数字（「20岁」「3.5」「2024」，小数点、千分位可以是点或逗号）
  const KEY_G = new RegExp(HAN_SRC + '|\\d+(?:[.,]\\d+)*', 'gu');
  const keyOnly = (s) => (String(s || '').match(KEY_G) || []).join('');
  // 一串数字（3,5 和 3.5 算一样）
  const digitRuns = (s) => (String(s || '').match(/\d+(?:[.,]\d+)*/g) || []).map((d) => d.replace(/,/g, '.'));
  const len = (s) => Array.from(s).length; // 按字数（不按码元）
  const WORDY = /[\p{L}\p{N}]/u;
  // 中文小句的分界（中英文标点）
  const CLAUSE_END = /[，,；;：:。！？!?]/;
  // 去掉标签两头时当虚词的整个词（Intl.Segmenter 切出来的一个词正好是这些才去掉；「上涨」「中国」不会被去掉）。
  // 剩下的部分里也不算「没有着落的字」
  const PARTICLES = new Set(('的 了 着 过 地 得 之 所 中 上 下 里 内 外 前 后 间 在 于 对 与 和 及 并 把 被 将 已 已经 正 正在 也 都 就 还 又 再 更 很 '
    + '最 其 该 这 那 此 各 每 们 为 是 有 从 向 由 以 而 等 些 个 名 位 种 起 次 一 一名 一个 一种 一位 一座 一项 一些 这个 那个 这些 那些 '
    + '对于 关于 如 即 则 且 或 并且 以及 及其 其中 说 称 时 到 到了').split(' '));
  // 和前面的词连起来才是一个词的（「实际/上」：去掉「上」就只剩「实际」）：这时不当虚词去掉
  const KEEP = new Set(('实际上 事实上 基本上 原则上 总体上 大体上 本质上 实质上 表面上 理论上 历史上 世界上 社会上 '
    + '以上 以下 之上 之下 之前 之后 之中 之间 以前 以后 此外 另外 期间 中间').split(' '));
  // 第 3 步里也算「有着落」的常见虚词、代词、助动词（「球队可以获胜」里没有着落的「可以」不是点的词的译文）
  const ZH_FUNC = new Set(('我 你 他 她 它 我们 你们 他们 她们 它们 咱们 自己 大家 别人 人们 这里 那里 这样 那样 这么 那么 这种 那种 '
    + '可以 能 能够 会 要 想 必须 应该 应当 可能 需要 得以 无法 不能 不会 不 没 没有 未 并非 不是 '
    + '因为 所以 如果 但是 但 而且 然而 因此 于是 虽然 尽管 即使 还是 或者 而是 就是 也是 还有 等等 只是 只有 '
    + '所有 许多 很多 一些 其他 其它 每个 各种 任何 非常 十分 比较 已经 正在 仍然 依然 甚至 例如 比如 '
    + '根据 通过 由于 为了 除了 关于 对于 当时 时候 什么 怎么 为什么 如何 哪 谁').split(' '));

  let segmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  } catch (e) { segmenter = null; }

  // 整句译文 → 词：{ start, end, text, han（几个汉字）, particle, word（有字母、数字、汉字） }。
  // 没有 Intl.Segmenter 时（很老的浏览器）一个汉字算一个词，第 3、4 步不做
  function segments(zh) {
    const out = [];
    const mk = (start, text) => out.push({ start, end: start + text.length, text, han: hanCount(text), particle: PARTICLES.has(text), word: WORDY.test(text) });
    if (segmenter) {
      for (const s of segmenter.segment(zh)) mk(s.index, s.segment);
    } else {
      const re = new RegExp(HAN_SRC + '|(?:(?!' + HAN_SRC + ')[\\s\\S])+', 'gu');
      let m;
      while ((m = re.exec(zh))) mk(m.index, m[0]);
    }
    return out;
  }

  // 译文（「判决；（口语）他们」「已宣布」「20岁」）→ 用来比的中文：去掉括号里的说明，按「；、，/」和省略号分开，
  // 只留汉字和数字
  function keysOf(list) {
    const out = [];
    for (const t of list || []) {
      const bare = String(t || '').replace(/（[^）]*）|\([^)]*\)/g, ' ');
      for (const part of bare.split(/[；;、，/／…。！？!?\s]+|,(?!\d)/)) {
        const k = keyOnly(part);
        if (k && !out.includes(k)) out.push(k);
      }
    }
    return out;
  }

  function occurrences(zh, k) {
    const out = [];
    if (!k) return out;
    for (let i = zh.indexOf(k); i >= 0; i = zh.indexOf(k, i + 1)) out.push({ start: i, end: i + k.length });
    return out;
  }
  // 重叠的合成一段
  function merge(spans) {
    const s = spans.slice().sort((x, y) => x.start - y.start || y.end - x.end);
    const out = [];
    for (const r of s) {
      const last = out[out.length - 1];
      if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
      else out.push({ start: r.start, end: r.end });
    }
    return out;
  }

  // ctx：{ word（查的词）, weak（小词：the、of、och、som……，js/lang/*.js 的 tr.weak）, cands（这个词自己的译文，字符串数组）,
  //        single（只有一个译文：翻译引擎给的，或者小词典里只有一个意思）, curated（cands 是小词典里的、不是按词尾推测的）,
  //        others: [{ text, tr: [译文…], weak（小词）, near（在查的词前后三个词以内、同一个小句） }] }
  // tag：微软的标签在 zh 里的位置 { start, end }（js/sense.js 的 parseTagged），没有就是 null。
  // tagged：zh 是微软翻译的带标签的整句（标签可能是空的、放坏了）；内置翻译、MyMemory 给的整句不是，第 3 步不做
  // （没有标签时不知道微软把这个词对到了哪里，「剩下的」靠不住）。不给时看有没有 tag。
  // 返回 { start, end, why: 'tag' | 'cand' | 'rest' } 或 { start: -1, end: -1, why: 'none', tagWhy（标签为什么不要） }
  function locate(zh, tag, ctx, tagged) {
    zh = String(zh || '');
    ctx = ctx || {};
    if (tagged === undefined) tagged = !!tag;
    const S = segments(zh);
    const own = keysOf(ctx.cands);
    const ownChars = new Set(Array.from(own.join('')).filter((c) => HAN.test(c)));
    const wordLc = String(ctx.word || '').toLowerCase();
    // 数字：这个词自己的（「20-year-old」的 20、「3,5」）和它的译文里的
    const ownDigits = new Set([wordLc, ...own].flatMap(digitRuns));
    // 和这个词的译文有共同的字，或者有一样的一串数字
    const shares = (s) => Array.from(s).some((c) => ownChars.has(c)) || digitRuns(s).some((d) => ownDigits.has(d));
    const strong = (s) => own.some((k) => len(k) >= 2 && s.includes(k));
    // 别的词：和查的词一样的词（同一句里的第二个 security）不算；和查的词自己的译文一样的译文也不算
    // 小词（of、by、has、med……）单独译出来的常常不对（of →「关于」，by →「作者」），也不算
    const others = (ctx.others || []).filter((o) => !o.weak && String(o.text || '').toLowerCase() !== wordLc)
      .map((o) => ({ near: !!o.near, keys: keysOf(o.tr).filter((k) => !own.includes(k)) }));
    // 别的词的译文（两个汉字以上的）在整句译文里出现的地方，和它们用的字
    const otherOcc = [];
    for (const o of others) for (const k of o.keys) if (len(k) >= 2) otherOcc.push(...occurrences(zh, k));
    const ownedBy = (a, b) => otherOcc.some((r) => r.start <= a && b <= r.end);
    const otherChars = new Set(Array.from(others.flatMap((o) => o.keys.filter((k) => len(k) >= 2)).join('')).filter((c) => HAN.test(c)));
    const othersOnly = (t) => Array.from(t).some((c) => otherChars.has(c)) && !shares(t);
    const ownOcc = () => merge(own.filter((k) => len(k) >= 2).flatMap((k) => occurrences(zh, k)).filter((r) => !ownedBy(r.start, r.end)));
    // 一串词两头的虚词（整个词才算；和前面的词连起来是一个词的不算：「实际/上」）
    const endParticle = (ss, i) => (ss[i].particle || !ss[i].word) && !(i > 0 && KEEP.has(ss[i - 1].text + ss[i].text));
    const startParticle = (ss, i) => (ss[i].particle || !ss[i].word) && !(i + 1 < ss.length && KEEP.has(ss[i].text + ss[i + 1].text));
    // 第 i 个码元开始的字、第 i 个码元前面的字（扩展 B 的汉字、表情是两个码元）
    const charAt = (i) => String.fromCodePoint(zh.codePointAt(i));
    const charBefore = (i) => { const c = zh.charCodeAt(i - 1); return c >= 0xdc00 && c <= 0xdfff && i >= 2 ? zh.slice(i - 2, i) : zh[i - 1]; };
    const ok = (a, b, why) => ({ start: a, end: b, why });
    const none = (why) => ({ start: -1, end: -1, why: 'none', tagWhy: why });

    // ---------- 1. 标签 ----------
    let tagWhy = 'notag';
    if (tag) {
      const r = fromTag();
      if (r.start >= 0) return r;
      tagWhy = r.why;
    }
    function fromTag() {
      const bad = (why) => ({ start: -1, end: -1, why });
      let a = Math.max(0, tag.start);
      let b = Math.min(zh.length, tag.end);
      while (a < b && !WORDY.test(charAt(a))) a += charAt(a).length;
      while (b > a && !WORDY.test(charBefore(b))) b -= charBefore(b).length;
      if (a >= b) return bad('empty');
      // 标签跨过了标点（「小时，最终」）：盖住了别的东西
      if (CLAUSE_END.test(zh.slice(a, b))) return bad('wide');
      // 先去掉两头整个在标签里的虚词（「了3.5」→「3.5」），再看下面两条（还不切到词的边界上）
      {
        const inner = S.filter((s) => s.start >= a && s.end <= b);
        let i = 0;
        let j = inner.length - 1;
        while (i < j && inner[i].start === a && startParticle(inner, i)) { a = inner[i].end; i++; }
        while (j > i && inner[j].end === b && endParticle(inner, j)) { b = inner[j].start; j--; }
        while (a < b && !WORDY.test(charAt(a))) a += charAt(a).length;
        while (b > a && !WORDY.test(charBefore(b))) b -= charBefore(b).length;
      }
      const raw = zh.slice(a, b);
      if (!hanCount(raw)) {
        // 原样留着的人名、缩写、数字（UNCLOS、Ikea、3.5）：要和查的词一样（数字里的逗号当点）
        const r = raw.toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
        const w = wordLc.replace(/(\d),(\d)/g, '$1.$2');
        return r === w || (r.length >= 3 && (r.includes(w) || w.includes(r))) ? ok(a, b, 'tag') : bad('latin');
      }
      // 只有一个汉字、又不是这个词的译文里的字（agreed →「认」，misstänks →「多」）
      if (hanCount(raw) === 1 && !shares(raw)) return bad('single');
      // 切到词的边界上，去掉两头的虚词和标点（全是虚词时留着：小词的译文常常就是一个虚词）
      let ss = S.filter((s) => s.end > a && s.start < b);
      // Intl.Segmenter 有时把后面的字连到一起（「实际/上有」）：标签里的部分和前面的词连起来是一个词（「实际上」）时，只要标签里的部分
      {
        const last = ss[ss.length - 1];
        const cut = last && last.end > b ? zh.slice(last.start, b) : '';
        if (cut && ss.length >= 2 && KEEP.has(ss[ss.length - 2].text + cut)) ss[ss.length - 1] = { start: last.start, end: b, text: cut, han: hanCount(cut), particle: PARTICLES.has(cut), word: true };
      }
      let i0 = 0;
      let i1 = ss.length - 1;
      while (i0 < i1 && startParticle(ss, i0)) i0++;
      while (i1 > i0 && endParticle(ss, i1)) i1--;
      ss = ss.slice(i0, i1 + 1);
      if (!ss.length || !ss.some((s) => s.word)) return bad('empty');
      const content = ss.filter((s) => !s.particle && s.han);
      const H = content.reduce((n, s) => n + s.han, 0);
      // 和这个词的译文有共同的字的词（数字也算：「20-year-old」的「20」）
      const hit = ss.map((s) => (ctx.weak || !s.particle) && (s.han > 0 || /\d/.test(s.text)) && shares(s.text));
      // 只画和这个词的译文有共同的字的那一部分：太宽的（五个汉字以上）、小词的、
      // 有两个汉字以上的词而只有一部分有共同的字的（「周二宣布」→「宣布」）。
      // Intl.Segmenter 有时把一个词切成单字（「会/面」「积/雪」），单字不单独去掉
      const dropOk = ss.some((s, i) => !s.particle && s.han >= 2 && !hit[i]);
      if (ctx.weak || H > 4 || (hit.some(Boolean) && dropOk)) {
        if (!hit.some(Boolean)) return bad(ctx.weak ? 'weak' : 'wide');
        let f = hit.indexOf(true);
        let l = hit.lastIndexOf(true);
        // 挨着的单字也算（Intl.Segmenter 把「洪灾」切成了「洪/灾」）
        // （不是别的词的译文里的字：「马/尔/默」的「默」是 Malmö 的）
        const single = (x) => x.han === 1 && !x.particle && !ownedBy(x.start, x.end) && !otherChars.has(x.text);
        while (f > 0 && single(ss[f - 1])) f--;
        while (l < ss.length - 1 && single(ss[l + 1])) l++;
        ss = ss.slice(f, l + 1);
      }
      // 盖住几个词、其中一个（两个汉字以上）只和别的词的译文有共同的字：标签放宽了，盖住了别的词
      // （soaring 的标签「食品价格」，「食品」是 food 的）
      const rest = ss.filter((s) => !s.particle && s.han);
      if (rest.length > 1 && rest.some((s) => s.han >= 2 && othersOnly(s.text))) return bad('other');
      a = ss[0].start;
      b = ss[ss.length - 1].end;
      const txt = zh.slice(a, b);
      const cap = Math.max(4, ...own.map((k) => len(k) + 2));
      if (hanCount(txt) > cap) return bad('wide');
      if (ctx.weak && hanCount(txt) > 3) return bad('weak');
      if (!strong(txt)) {
        // 正好是别的词的译文（或者在它里面）：标签放错了（blaze 的标签在 control 的「控制」上）
        if (ownedBy(a, b)) return bad('other');
        if (ctx.single && !ctx.weak) {
          const occ = ownOcc();
          // 这个词的译文在别处正好出现一次，标签里又没有它：画那里（control 的标签在「火势」上，「控制」在别处）
          if (occ.length === 1 && (occ[0].end <= a || occ[0].start >= b)) return ok(occ[0].start, occ[0].end, 'cand');
          // 这个词的译文正好出现一次、把标签包在里面：画整个译文（标签「建设」，译文「住房建设」）
          if (occ.length === 1 && occ[0].start <= a && b <= occ[0].end) return ok(occ[0].start, occ[0].end, 'tag');
        }
      }
      return ok(a, b, 'tag');
    }

    // ---------- 2. 这个词的译文正好出现一次 ----------
    {
      const occ = ownOcc();
      // 原样留着的人名、缩写
      if (!occ.length && wordLc.length >= 2 && /[\p{L}]/u.test(wordLc)) {
        const low = zh.toLowerCase();
        for (let i = low.indexOf(wordLc); i >= 0; i = low.indexOf(wordLc, i + 1)) {
          const before = i > 0 ? zh[i - 1] : '';
          const after = zh[i + wordLc.length] || '';
          if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) occ.push({ start: i, end: i + wordLc.length });
        }
      }
      if (occ.length === 1) return ok(occ[0].start, occ[0].end, 'cand');
      if (occ.length > 1) return none(tagWhy);
      // 小词典里的一个字的意思（kall「冷」）：正好一个词里有这个字（「寒冷」）
      if (ctx.curated && !ctx.weak && segmenter) {
        const singles = own.filter((k) => len(k) === 1 && HAN.test(k));
        const hits = singles.length ? S.filter((s) => s.word && !s.particle && singles.some((k) => s.text.includes(k)) && !ownedBy(s.start, s.end)) : [];
        if (hits.length === 1 && hits[0].han <= 4) return ok(hits[0].start, hits[0].end, 'cand');
        if (hits.length > 1) return none(tagWhy);
      }
    }
    if (ctx.weak || !segmenter || !tagged) return none(tagWhy);

    // ---------- 3. 剩下的 ----------
    // 查的词前后（同一个小句里）的实词的译文在整句译文里正好出现一次：这几处所在的中文小句里，
    // 去掉别的词的译文（一样的、有共同的字的）和虚词，正好只剩一个词（两到四个汉字）没有着落，就是它。
    // 剩下两处以上、或者剩下的是挨着的几个词（tidigt：「清晨」「离开」）：不画
    {
      const anchors = [];
      for (const o of others) {
        if (!o.near) continue;
        for (const k of o.keys) {
          if (len(k) < 2) continue;
          const occ = occurrences(zh, k);
          if (occ.length === 1) anchors.push(occ[0]);
        }
      }
      if (anchors.length) {
        const clauses = [];
        let from = 0;
        for (let i = 0; i <= zh.length; i++) {
          if (i === zh.length || CLAUSE_END.test(zh[i])) {
            if (i > from) clauses.push({ start: from, end: i });
            from = i + 1;
          }
        }
        const picked = clauses.filter((c) => anchors.some((r) => r.start < c.end && r.end > c.start));
        // 有着落的：别的词的译文（一样的、在它里面的、有共同的字的），常见的虚词、代词、助动词（「可以」「我们」）
        const covered = (s) => ZH_FUNC.has(s.text) || otherOcc.some((r) => r.start < s.end && r.end > s.start)
          || others.some((o) => o.keys.some((k) => len(k) === 1 && s.text === k))
          || Array.from(s.text).some((c) => otherChars.has(c));
        const runs = [];
        for (const c of picked) {
          let cur = null;
          for (const s of S) {
            if (s.start < c.start || s.end > c.end) continue;
            if (s.word && s.han > 0 && !s.particle && !covered(s)) {
              if (cur && cur.end === s.start) { cur.end = s.end; cur.n++; } else { cur = { start: s.start, end: s.end, n: 1 }; runs.push(cur); }
            } else {
              cur = null;
            }
          }
        }
        if (runs.length === 1 && runs[0].n === 1) {
          const n = hanCount(zh.slice(runs[0].start, runs[0].end));
          if (n >= 2 && n <= 4) return ok(runs[0].start, runs[0].end, 'rest');
        }
      }
    }
    return none(tagWhy);
  }

  // 这一句里每个词属于哪个小句（逗号、分号、冒号、括号、引号、破折号之间）：near 用
  function clauseOf(sentence, words) {
    const ids = [];
    let id = 0;
    let last = 0;
    for (const w of words) {
      if (/[,;:()"“”«»—–]/.test(sentence.slice(last, w.start))) id++;
      ids.push(id);
      last = w.end;
    }
    return ids;
  }

  // 一句话 sentence 的词 words（js/text.js 的 words：{ text, start, end }）里点了第 wi 个：locate 要用的东西。
  // lookup：小词典（js/glossary.js 的 lookup，英语没有）；isWeak：是不是小词。
  // 返回 { word, ownNeed（要不要翻译引擎给这个词的译文：不在小词典里，或者小词典的原形是按词尾推测的）,
  //        need（要翻译引擎翻的别的词：不在小词典里或者是推测的；小词、数字、和点的词一样的词不要）,
  //        ctx(trOf（{ 小写的词: 译文 }）, ownTr（这个词的译文）) → locate 的 ctx }
  function plan(sentence, words, wi, lookup, isWeak) {
    const word = words[wi].text;
    const lc = word.toLowerCase();
    const weakOf = (t) => !!(isWeak && isWeak(t));
    const gl = lookup ? lookup(word) : null;
    const guessed = !!gl && gl.some((e) => e.guessed);
    const clause = clauseOf(sentence, words);
    const others = [];
    const need = [];
    words.forEach((o, i) => {
      if (i === wi) return;
      const e = { text: o.text, tr: [], weak: weakOf(o.text), near: clause[i] === clause[wi] && Math.abs(i - wi) <= 3, ask: false };
      others.push(e);
      if (e.weak || !/\p{L}/u.test(o.text) || o.text.toLowerCase() === lc) return;
      const g = lookup ? lookup(o.text) : null;
      if (g) e.tr.push(...g.map((x) => x.zh));
      if (!g || g.some((x) => x.guessed)) {
        e.ask = true;
        if (!need.some((t) => t.toLowerCase() === o.text.toLowerCase())) need.push(o.text);
      }
    });
    return {
      word,
      ownNeed: !gl || guessed,
      need,
      ctx(trOf, ownTr) {
        // 只看自己的键（词是 constructor、toString 时不拿到 Object 的东西）
        const got = (t) => (trOf && Object.prototype.hasOwnProperty.call(trOf, t.toLowerCase()) && typeof trOf[t.toLowerCase()] === 'string' ? trOf[t.toLowerCase()] : '');
        const cands = gl ? gl.map((e) => e.zh) : [];
        if (ownTr) cands.push(ownTr);
        return {
          word,
          weak: weakOf(word),
          cands,
          single: !gl || (!guessed && gl.length === 1 && !/[；;]/.test(gl[0].zh)),
          curated: !!gl && !guessed,
          others: others.map((e) => ({ text: e.text, weak: e.weak, near: e.near, tr: e.ask && got(e.text) ? e.tr.concat(got(e.text)) : e.tr })),
        };
      },
    };
  }
  // 小词的表（js/lang/*.js 的 tr.weak，空格分开）→ isWeak
  function weakTest(list) {
    const set = new Set(String(list || '').toLowerCase().split(/\s+/).filter(Boolean));
    return (t) => set.has(String(t || '').toLowerCase());
  }

  SV.wordspan = { locate, plan, weakTest, segments, keysOf, clauseOf, hasSegmenter: () => !!segmenter, PARTICLES };
})();

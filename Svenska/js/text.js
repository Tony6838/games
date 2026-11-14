/* 把文章拆成句子和单词，生成可以高亮、可以点的 DOM。
   每句是 <span class="s" data-si>，每个词是 <span class="w" data-wi>；
   词的位置（start/end）是相对这一句文字的，朗读时 boundary 事件的 charIndex 就靠它找到词。 */
(function () {
  'use strict';
  const SV = window.SV;

  // 下面是瑞典语的规则；别的语言在它的设置里（js/lang/*.js 的 text：segmenter、wordRe、abbr、cont）换掉
  const LT = (SV.lang && SV.lang.text) || {};
  // 词：字母或数字，中间可以有连字符、撇号、冒号（EU:s、AI-chip、1990-talet），数字里可以有小数点（12.30、3,5）
  const WORD_RE = LT.wordRe || /[\p{L}\p{N}]+(?:[-'’:][\p{L}\p{N}]+|[.,]\p{N}+)*/gu;
  // 这些缩写后面的句点不是句子结束（osv.、m.m. 常在句末，不放进来；它们在句中时后面是小写字母，下面另有规则）
  const ABBR = LT.abbr || /(?:^|[\s(])(?:bl\.a|t\.ex|s\.k|fr\.o\.m|t\.o\.m|p\.g\.a|resp|jfr|f\.d|dvs|ca|kl|nr|tel|inkl|exkl|[A-ZÅÄÖ])\.\s*$/;
  // 下一段这样开头（小写字母、数字）就不是新句子
  const CONT = LT.cont || /^\s*[a-zåäöéü0-9]/;
  // 英语：可以在句末的缩写（U.S.、p.m.、etc.、Inc.、单个大写字母「vitamin D.」）后面是常见的句首词（The、It、But……）时，
  // 还是新的一句（「U.S. The」断开，「U.S. Senate」「John F. Kennedy」不断）。瑞典语没有这两条
  const ABBR_END = LT.abbrEnd || null;
  const STARTER = LT.starter || null;
  // 分句器不断、但一定要断开的地方（英语：「in 2025. 12 people」数字后面的句点下一句以数字开头；
  // 分句器把「U.S. The」当成一句时，在缩写和句首词之间）
  const SPLIT = LT.split || null;

  let segmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) segmenter = new Intl.Segmenter(LT.segmenter || 'sv', { granularity: 'sentence' });
  } catch (e) { segmenter = null; }

  function splitSentences(text) {
    let parts;
    if (segmenter) parts = Array.from(segmenter.segment(text), (s) => s.segment);
    else parts = text.match(/[^.!?…]+(?:[.!?…]+["”’»)]*\s*|$)/g) || [text];
    if (SPLIT) parts = parts.flatMap((p) => p.split(SPLIT));
    const out = [];
    for (const p of parts) {
      if (!p) continue;
      const prev = out.length ? out[out.length - 1] : null;
      // 缩写后面、或者下一段以小写字母/数字开头：不是新句子（英语：可以在句末的缩写后面是句首词时除外）
      const endOk = ABBR_END && STARTER && ABBR_END.test(prev || '') && STARTER.test(p);
      if (prev !== null && ((ABBR.test(prev) && !endOk) || CONT.test(p) || !/[\p{L}\p{N}]/u.test(p))) out[out.length - 1] = prev + p;
      else out.push(p);
    }
    return out.map((s) => s.trim()).filter(Boolean);
  }

  function words(text) {
    const list = [];
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text))) list.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    return list;
  }

  // 生成一句的 DOM，并登记到 model.sentences
  function renderSentence(text, parent, model, blockIndex) {
    const si = model.sentences.length;
    const span = document.createElement('span');
    span.className = 's';
    span.dataset.si = si;
    const ws = words(text);
    let last = 0;
    ws.forEach((w, wi) => {
      if (w.start > last) span.append(text.slice(last, w.start));
      const el = document.createElement('span');
      el.className = 'w';
      el.dataset.wi = wi;
      el.textContent = w.text;
      span.append(el);
      w.el = el;
      last = w.end;
    });
    if (last < text.length) span.append(text.slice(last));
    parent.append(span);
    model.sentences.push({ text, el: span, words: ws, block: blockIndex });
    return si;
  }

  // 原文里的链接（有的源要求保留，比如 KFF Health News）：在链接的最后一个词后面放一个小箭头，点它打开链接。
  // 词本身还是点了查词、朗读时高亮，箭头不算句子的一部分（不朗读、不影响词的位置）
  function linkMark(href) {
    const a = document.createElement('a');
    a.className = 'src-link';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    let host = '';
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
    a.title = '原文里的链接：' + host;
    a.setAttribute('aria-label', '链接：' + host);
    const i = document.createElement('i');
    i.className = 'ic ic-ext';
    i.setAttribute('aria-hidden', 'true');
    a.append(i);
    return a;
  }

  function renderBlockText(text, el, model, blockIndex, links) {
    const block = model.blocks[blockIndex];
    let cursor = 0;
    splitSentences(text).forEach((s, i) => {
      if (i) el.append(' ');
      const si = renderSentence(s, el, model, blockIndex);
      block.sentences.push(si);
      if (!links || !links.length) return;
      // 这一句在整段里从哪里开始（分句时去掉了句子两头的空白）
      const at = text.indexOf(s, cursor);
      const start = at >= 0 ? at : cursor;
      cursor = start + s.length;
      const sent = model.sentences[si];
      for (const ln of links) {
        if (ln.end <= start || ln.end > start + s.length + 1) continue;
        let w = null;
        for (const x of sent.words) if (start + x.start < ln.end) w = x;
        if (w) w.el.after(linkMark(ln.href));
      }
    });
  }

  // 返回 { sentences, blocks }；blocks[i] = { el, type, text, sentences: [句子序号] }
  function renderArticle(item, titleEl, bodyEl) {
    const model = { sentences: [], blocks: [] };
    model.blocks.push({ el: titleEl, type: 'title', text: item.title, sentences: [] });
    renderBlockText(item.title, titleEl, model, 0);
    let list = null;
    for (const b of item.blocks) {
      let el;
      if (b.type === 'li') {
        if (!list) { list = document.createElement('ul'); bodyEl.append(list); }
        el = document.createElement('li');
        list.append(el);
      } else {
        list = null;
        el = document.createElement(b.type === 'h' ? 'h2' : b.type === 'q' ? 'blockquote' : 'p');
        if (b.type === 'lead') el.className = 'lead';
        if (b.type === 'caption') el.className = 'caption'; // 图片说明（图片没有转载，KFF 的说明照登）
        bodyEl.append(el);
      }
      const bi = model.blocks.length;
      model.blocks.push({ el, type: b.type, text: b.text, sentences: [] });
      renderBlockText(b.text, el, model, bi, b.links);
    }
    return model;
  }

  // 朗读位置 charIndex（相对这一句）-> 词的序号
  function wordAt(sentence, charIndex) {
    const ws = sentence.words;
    for (let i = 0; i < ws.length; i++) if (ws[i].end > charIndex) return i;
    return ws.length ? ws.length - 1 : -1;
  }

  SV.text = { splitSentences, words, renderArticle, wordAt, WORD_RE };
})();

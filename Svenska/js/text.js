/* 把文章拆成句子和单词，生成可以高亮、可以点的 DOM。
   每句是 <span class="s" data-si>，每个词是 <span class="w" data-wi>；
   词的位置（start/end）是相对这一句文字的，朗读时 boundary 事件的 charIndex 就靠它找到词。 */
(function () {
  'use strict';
  const SV = window.SV;

  // 词：字母或数字，中间可以有连字符、撇号、冒号（EU:s、AI-chip、1990-talet），数字里可以有小数点（12.30、3,5）
  const WORD_RE = /[\p{L}\p{N}]+(?:[-'’:][\p{L}\p{N}]+|[.,]\p{N}+)*/gu;
  // 这些缩写后面的句点不是句子结束（osv.、m.m. 常在句末，不放进来；它们在句中时后面是小写字母，下面另有规则）
  const ABBR = /(?:^|[\s(])(?:bl\.a|t\.ex|s\.k|fr\.o\.m|t\.o\.m|p\.g\.a|resp|jfr|f\.d|dvs|ca|kl|nr|tel|inkl|exkl|[A-ZÅÄÖ])\.\s*$/;

  let segmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) segmenter = new Intl.Segmenter('sv', { granularity: 'sentence' });
  } catch (e) { segmenter = null; }

  function splitSentences(text) {
    let parts;
    if (segmenter) parts = Array.from(segmenter.segment(text), (s) => s.segment);
    else parts = text.match(/[^.!?…]+(?:[.!?…]+["”’»)]*\s*|$)/g) || [text];
    const out = [];
    for (const p of parts) {
      if (!p) continue;
      const prev = out.length ? out[out.length - 1] : null;
      // 缩写后面、或者下一段以小写字母/数字开头：不是新句子
      if (prev !== null && (ABBR.test(prev) || /^\s*[a-zåäöéü0-9]/.test(p) || !/[\p{L}\p{N}]/u.test(p))) out[out.length - 1] = prev + p;
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

  function renderBlockText(text, el, model, blockIndex) {
    const block = model.blocks[blockIndex];
    splitSentences(text).forEach((s, i) => {
      if (i) el.append(' ');
      block.sentences.push(renderSentence(s, el, model, blockIndex));
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
        bodyEl.append(el);
      }
      const bi = model.blocks.length;
      model.blocks.push({ el, type: b.type, text: b.text, sentences: [] });
      renderBlockText(b.text, el, model, bi);
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

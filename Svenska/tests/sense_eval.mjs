// 检查「按这一句选词义」的规则（js/sense.js），不开浏览器、不联网：用 Node 载入网站自己的 js/util.js、text.js、glossary.js、sense.js。
//   node tests/sense_eval.mjs                 只跑下面编的例子（可以放进仓库）
//   node tests/sense_eval.mjs <评估集.json>    再跑一个标好答案的评估集，列出每种办法画了几个、对几个、错几个
// 评估集是 SR 文章里的真句子和真的微软翻译（README「翻译」）。按 SR 的条款，文章的内容不能存进这个仓库，所以评估集放在仓库外面。
// 格式：[{ text: 句子, wi: 第几个词, word, html: 微软把这个词包在 <b> 里翻译的结果（没有就是 null）, plain: 整句的普通译文,
//          ok: [对的意思的序号…]（[] 表示小词典里没有合适的意思；没标的项只要有办法画了下划线就算错，要补标）}]
// 网站用的规则（下面的「H2」）在评估集上画错一个，就退出码 1。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const jsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const window = { SV: {} };
const ctx = vm.createContext({ window, Intl, console, TextEncoder, setTimeout, clearTimeout });
for (const f of ['util.js', 'text.js', 'glossary.js', 'sense.js']) vm.runInContext(readFileSync(join(jsDir, f), 'utf8'), ctx, { filename: f });
const SV = window.SV;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  通过 ' : '  失败 ') + name + (detail ? '：' + detail : ''));
}
const T = (sv, wi, html) => SV.sense.inSentence(sv, wi, html);

console.log('\n== 规则 1：能挑的词');
check('只有单字、或者只有括号说明的意思的词不挑：de、det、den、var、för、som、att、bli、i、och、hem（så、då 的每个意思都有两个汉字的词，可以挑）',
  ['de', 'det', 'den', 'var', 'för', 'som', 'att', 'bli', 'i', 'och', 'hem'].every((w) => !SV.sense.pickable(SV.glossary.lookup(w), SV.sense.senses(SV.glossary.lookup(w)))));
check('每个意思都有两个汉字以上的词才挑：dom、om、få、ska、sköta、läge、svensk', ['dom', 'om', 'få', 'ska', 'sköta', 'läge', 'svensk'].every((w) => SV.sense.pickable(SV.glossary.lookup(w), SV.sense.senses(SV.glossary.lookup(w)))));
const guessed = SV.glossary.lookup('verkar');
check('按词尾推测的原形不挑（verkar → verka？）', guessed && guessed[0].guessed && !SV.sense.pickable(guessed, SV.sense.senses(guessed)), JSON.stringify(guessed));
check('去掉括号说明，按「、」分开，单字不用', ['（口语）他们', '在……之后', '人们（泛指）', '既（både … och 既……又……）', '得到、受到'].map((s) => SV.sense.keysOf(s).join('/')).join(' | ') === '他们 | 之后 | 人们 |  | 得到/受到');

console.log('\n== 审查找到的例子（编的句子）');
// 发现 1：正确的意思找不到（单字、括号说明），别的意思碰巧出现。现在这些词不挑，根本不去要带标签的译文
for (const [sv, wi, why] of [
  ['De svenska spelarna säger att laget vann.', 0, 'De 是复数定冠词，「（复数定冠词）」找不到'],
  ['Det var svårt för alla.', 1, 'var 是「是」，单字找不到'],
  ['Priset är för högt på grund av kriget.', 2, 'för 是「太」，单字找不到'],
]) {
  const r = T(sv, wi, null);
  check(`不挑：${sv}（${why}）`, !r.pickable && r.index === -1, JSON.stringify(r));
}
// 发现 2：小词典外的词译出了某个意思的中文。下面的 HTML 是真的微软翻译（2026-11-13，textType=html）给这三句编的句子的回答
check('Hon ansvarar för att sköta barnen：标签盖住「负责照顾孩子们」（两个意思都在、字也太多），不画',
  T('Hon ansvarar för att sköta barnen.', 4, '她 <b>负责照顾孩子们</b> 。').index === -1);
const far = T('Regeringen får kritik för att företag kan undvika skatt.', 1, '政府因企业能够逃税而 <b>受到</b> 批评。');
check('Regeringen får kritik … kan undvika skatt：标签在「受到」上，画「得到、受到」（以前的办法画了「可以」）', far.best === '得到、受到' && far.key === '受到', JSON.stringify(far));
check('Det svenska folket röstade：标签只盖住「瑞典」，没有哪个意思的词，不画（以前的办法画了「瑞典人」）',
  T('Det svenska folket röstade.', 1, '<b>瑞典</b>人就在这座城市里。').index === -1);

console.log('\n== 规则 2、3：带标签的译文');
// 下面的 HTML 是编的，测解析和规则本身
check('dom：标签在「判决」上 → 判决', T('Domen föll i tingsrätten i går.', 0, '该<b>判决</b>于昨天在地区法院作出。').best === '判决');
check('dom：标签在「他们」上 → （口语）他们', T('Dom säger att det är fel.', 0, '<b>他们</b>说这是错的。').best === '（口语）他们');
check('标签里两个意思都有：平手，不画', T('Dom säger att domen var fel.', 0, '<b>他们判决</b>说是错的。').why === 'tie');
check('标签里有两个意思的词（长的那个宽度还算，短的那个不算）：还是平手，不画', T('Hon har flera hundar.', 2, '她有<b>好几个多个</b>狗。').why === 'tie');
check('标签比意思的词多三个汉字：太宽，不画', T('Läget i Gaza är allvarligt.', 0, '加沙的<b>局势仍然很</b>严峻。').why === 'wide');
check('标签比意思的词多两个汉字：还算', T('Läget i Gaza är allvarligt.', 0, '加沙的<b>目前局势</b>很严峻。').best === '局势');
check('标签空了：不画', T('Läget i Gaza är allvarligt.', 0, '加沙的<b></b>局势很严峻。').why === 'notag');
check('没有标签：不画', T('Läget i Gaza är allvarligt.', 0, '加沙的局势很严峻。').why === 'notag');
check('两对标签：不画', T('Läget i Gaza är allvarligt.', 0, '<b>加沙</b>的<b>局势</b>很严峻。').why === 'notag');
check('标签里没有哪个意思的词：不画', T('Läget i Gaza är allvarligt.', 0, '加沙<b>的</b>局势很严峻。').why === 'none');
const pt = SV.sense.parseTagged('她 <b>负责</b> 照顾 &quot;孩子&quot; &amp; Ikea AB 。');
check('解析：去掉标签，汉字旁边的空格去掉，拉丁字母之间的空格留着，&quot; &amp; 还原', pt.text === '她负责照顾"孩子" & Ikea AB。' && pt.text.slice(pt.tag.start, pt.tag.end) === '负责', JSON.stringify(pt));
const pt2 = SV.sense.parseTagged('<b>没有</b> <script>x</script>新政府');
check('解析：别的标签只留文字，标签位置对', pt2.text === '没有x新政府' && pt2.tag.start === 0 && pt2.tag.end === 2, JSON.stringify(pt2));
const pt3 = SV.sense.parseTagged('这&hellip;&mdash;&#8212;&#x4e2d;&laquo;x&raquo;<b>局势</b>&lt;b&gt;');
check('解析（没有 DOMParser 时）：数字实体和常见的命名实体还原，转义的标签还是文字，标签位置对', pt3.text === '这…——中«x»局势<b>' && pt3.text.slice(pt3.tag.start, pt3.tag.end) === '局势', JSON.stringify(pt3));
check('发出去的 HTML：句子里的 < & 转义，查的词包在 <b> 里', SV.sense.tagSentence('A<B & C', 4, 5) === 'A&lt;B <b>&amp;</b> C');

// ---------- 整句译文里点的词（js/wordspan.js） ----------
// tests/wordspan_cases.json：自己编的英语、瑞典语句子（不是 SR 的文章，可以放进仓库；英语第一句是 Tony 截图里的例子），
// 每句几个词，带真的微软翻译（2026-11-15，经过 Worker）：把这个词包在 <b> 里整句翻译的回答（html），和这句里每个词单独的译文
// （words：[词, 在句子里的位置, 译文]）。want 是现在的规则画的（空的：不画），judge 是亲手标的：
// ok 画对了；part 画对了一部分（多了或少了一两个字）；bad 画错了；miss 没画（其实有对应的译文）；skip 没画，本来就没有清楚的对应（小词）。
// 规则一改，画的和 want 不一样就失败：一个一个看过对错，再改这个文件里的 want 和 judge（故意没有自动改的办法，免得不看就接受）
console.log('\n== 整句译文里点的词（js/wordspan.js）');
for (const f of ['lang/sv.js', 'lang/en.js', 'wordspan.js']) vm.runInContext(readFileSync(join(jsDir, f), 'utf8'), ctx, { filename: f });
{
  const weak = Object.fromEntries(SV.LANGS.map((l) => [l.code, SV.wordspan.weakTest(l.tr.weak)]));
  const cases = JSON.parse(readFileSync(join(jsDir, '..', 'tests', 'wordspan_cases.json'), 'utf8'));
  const run = (c, t) => {
    const words = c.words.map(([text, start]) => ({ text, start, end: start + text.length }));
    const tr = Object.fromEntries(c.words.filter((w) => w[2]).map(([text, , zh]) => [text.toLowerCase(), zh]));
    const p = SV.wordspan.plan(c.s, words, t.wi, c.lang === 'sv' ? SV.glossary.lookup : null, weak[c.lang]);
    const parsed = SV.sense.parseTagged(t.html);
    const r = SV.wordspan.locate(parsed.text, parsed.tag, p.ctx(tr, p.ownNeed ? tr[p.word.toLowerCase()] : ''), true);
    return { word: p.word, got: r.start >= 0 ? parsed.text.slice(r.start, r.end) : '', why: r.why, plan: p };
  };
  const stat = {};
  const diff = [];
  for (const c of cases) {
    for (const t of c.targets) {
      const r = run(c, t);
      if (r.got !== t.want) diff.push(`${r.word}：画了「${r.got}」，应该「${t.want}」`);
      const s = stat[c.lang] || (stat[c.lang] = { ok: 0, part: 0, bad: 0, miss: 0, skip: 0 });
      s[t.judge]++;
    }
  }
  for (const [lang, s] of Object.entries(stat)) {
    const drawn = s.ok + s.part + s.bad;
    console.log(`  ${lang === 'sv' ? '瑞典语' : '英语'}：${s.ok + s.part + s.bad + s.miss + s.skip} 个词，画了 ${drawn} 个：对 ${s.ok}、对一部分 ${s.part}、错 ${s.bad}；没画 ${s.miss + s.skip} 个（其中 ${s.skip} 个是没有对应的小词）`);
  }
  check(`${cases.reduce((n, c) => n + c.targets.length, 0)} 个词：画的和标好的一样`, !diff.length, diff.join('；'));
  const one = (lang, word) => { const c = cases.find((x) => x.lang === lang && x.targets.some((t) => x.words[t.wi][0] === word)); return run(c, c.targets.find((t) => c.words[t.wi][0] === word)); };
  const en = one('en', 'enshrined');
  check('Tony 的例子：enshrined 的标签是空的、单独译成「入祀」（句子里没有），画「规定」（这个小句里 UNCLOS 的译文旁边，唯一没有着落的词）', en.got === '规定' && en.why === 'rest', JSON.stringify(en.got + ' ' + en.why));
  const ma = one('en', 'maritime');
  check('英语：maritime 单独译成「海事」，标签在「海上」上：画「海上」', ma.got === '海上' && ma.why === 'tag', ma.got);
  const sk = one('sv', 'säkerhetsfrågor');
  const fa = one('sv', 'Fartygen');
  check('瑞典语的合成词、变形：säkerhetsfrågor →「安全问题」，Fartygen（单独译成「舰船」）→「舰队」', sk.got === '安全问题' && fa.got === '舰队', sk.got + ' ' + fa.got);
  const sm = one('sv', 'skärpta');
  check('瑞典语：skärpta 的标签只有一个字「重」、单独译成「磨砺」：画剩下的「加重」', sm.got === '加重' && sm.why === 'rest', sm.got + ' ' + sm.why);
  const bl = one('en', 'blaze');
  const ma2 = one('sv', 'matematik');
  check('标签放在别的词的译文上：blaze 的标签在 control 的「控制」上，不画；matematik 的标签在「教学」（undervisning 的）上，画「数学」', bl.got === '' && ma2.got === '数学', bl.got + ' ' + ma2.got);
  const ti = one('sv', 'tidigt');
  check('剩下两处没有着落（tidigt：「清晨」「离开」）：不画', ti.got === '' && ti.why === 'none');
  const weakOnes = ['the', 'of', 'on', 'against', 'på', 'som'].map((w) => one(['på', 'som'].includes(w) ? 'sv' : 'en', w));
  check('小词的标签和它的译文没有共同的字（the →「欧」，som →「涉嫌」）：不画', weakOnes.every((r) => !r.got), weakOnes.map((r) => r.word + ':' + r.got).join(' '));
  const pl = one('sv', 'tidigt').plan;
  check('要翻译引擎翻的词：不在小词典里或者原形是推测的；小词、和点的词一样的词不要', pl.need.includes('Fartygen') && !pl.need.includes('i') && !pl.need.includes('på') && !pl.need.includes('morgonen') && !pl.need.includes('tidigt'), pl.need.join(' '));
  // 没有标签时（内置翻译、MyMemory 给的整句）：只按这个词的译文找，正好出现一次才画
  const L0 = SV.wordspan.locate;
  check('没有标签：这个词的译文正好出现一次就画，出现两次不画', L0('政府希望与北欧邻国讨论安全问题。', null, { word: 'grannländerna', cands: ['邻国'], single: true }).why === 'cand'
    && L0('安全和安全问题', null, { word: 'säkerhet', cands: ['安全'], single: true }).why === 'none');
  check('原样留着的名字、缩写（UNCLOS、Ikea）', L0('宜家 Ikea 开了新店', { start: 3, end: 7 }, { word: 'Ikea', cands: ['宜家'] }).why !== 'none'
    && L0('Ikea 开了新店', null, { word: 'Ikea', cands: [] }).why === 'cand');
  check('标签跨过了标点：不要', L0('数小时，最终控制住', { start: 1, end: 6 }, { word: 'bringing', cands: ['带来'] }).why === 'none');

  // ---------- 复审（2026-11-15）找到的，英语、瑞典语各一遍 ----------
  const P = (html) => SV.sense.parseTagged(html);
  const at = (html, ctx2, tagged = true) => { const p = P(html); const r = L0(p.text, p.tag, ctx2, tagged); return r.start >= 0 ? p.text.slice(r.start, r.end) : ''; };
  // 1. 第 3 步：没有着落的只是虚词、代词、助动词（「可以」「我们」）时不画；有实词时照样画
  const team = (word) => ({ word, cands: ['确实'], single: true, others: [{ text: 'x1', near: true, tr: ['球队'] }, { text: 'x2', weak: true, near: true, tr: ['可以'] }, { text: 'x3', near: true, tr: ['获胜'] }] });
  const plan2 = (word) => ({ word, cands: ['完全'], single: true, others: [{ text: 'x1', weak: true, near: true, tr: ['我们'] }, { text: 'x2', near: true, tr: ['支持'] }, { text: 'x3', near: true, tr: ['计划'] }] });
  check('第 3 步：剩下的只是「可以」「我们」这样的词时不画（英语 indeed、fully；瑞典语 verkligen、fullt）',
    !at('球队<b></b>可以获胜。', team('indeed')) && !at('球队<b></b>可以获胜。', team('verkligen')) && !at('我们<b></b>支持该计划。', plan2('fully')) && !at('我们<b></b>支持该计划。', plan2('fullt')),
    [at('球队<b></b>可以获胜。', team('indeed')), at('我们<b></b>支持该计划。', plan2('fullt'))].join(' '));
  const rules = (word) => ({ word, cands: ['场景'], single: true, others: [{ text: 'x1', weak: true, near: true, tr: [] }, { text: 'x2', near: true, tr: ['遵守'] }, { text: 'x3', near: true, tr: ['义务'] }, { text: 'x4', near: true, tr: ['条约'] }] });
  check('第 3 步：「我们」「必须」算有着落，剩下的「规定」照样画（英语 the obligations set out in the treaty、瑞典语 skyldigheterna som fastställs i fördraget）',
    at('我们必须遵守条约中<b></b>规定的义务。', rules('set')) === '规定' && at('我们必须遵守条约中<b></b>规定的义务。', rules('fastställs')) === '规定');
  // 2. 第 3 步只在微软翻译带标签的整句上做：内置翻译、MyMemory 给的整句（没有标签）只做第 2 步
  const ctxOf = (lang, word) => {
    const c = cases.find((x) => x.lang === lang && x.targets.some((t) => x.words[t.wi][0] === word));
    const t = c.targets.find((y) => c.words[y.wi][0] === word);
    const tr = Object.fromEntries(c.words.filter((w) => w[2]).map(([x, , z]) => [x.toLowerCase(), z]));
    const p = one(lang, word).plan;
    return { zh: P(t.html).text, ctx: p.ctx(tr, p.ownNeed ? tr[p.word.toLowerCase()] : '') };
  };
  const en2 = ctxOf('en', 'enshrined');
  const sv2 = ctxOf('sv', 'skärpta');
  const noTagEn = L0(en2.zh, null, en2.ctx, false);
  const noTagSv = L0(sv2.zh, null, sv2.ctx, false);
  check('没有标签的整句（内置翻译、MyMemory）不做第 3 步：enshrined、skärpta 不画（有标签时画「规定」「加重」）',
    noTagEn.why === 'none' && noTagSv.why === 'none' && one('en', 'enshrined').got === '规定' && one('sv', 'skärpta').got === '加重', JSON.stringify([noTagEn, noTagSv]));
  // 3. 数字也算这个词的译文；标签两头的虚词先去掉再看是不是只有一个字
  check('数字：「20岁」「3.5」是用来比的译文（keysOf 留数字）', JSON.stringify(SV.wordspan.keysOf(['20岁', '3.5', '3,5', '2024年'])) === JSON.stringify(['20岁', '3.5', '3,5', '2024年']),
    JSON.stringify(SV.wordspan.keysOf(['20岁', '3.5', '3,5', '2024年'])));
  const driver = (word) => ({ word, cands: ['20岁'], single: true, others: [{ text: 'driver', near: true, tr: ['司机'] }] });
  check('数字：英语 20-year-old 的标签「20岁的司」→「20岁」，瑞典语 20-årig 的标签「20岁的男」→「20岁」',
    at('五月份，一名 <b>20岁的司</b> 机撞上树木。', driver('20-year-old')) === '20岁' && at('一名 <b>20岁的男</b>子被捕。', { word: '20-årig', cands: ['20岁'], single: true, others: [{ text: 'man', near: true, tr: ['男子'] }] }) === '20岁',
    at('五月份，一名 <b>20岁的司</b> 机撞上树木。', driver('20-year-old')) + ' ' + at('一名 <b>20岁的男</b>子被捕。', { word: '20-årig', cands: ['20岁'], single: true, others: [{ text: 'man', near: true, tr: ['男子'] }] }));
  check('数字：标签「了3.5」→「3.5」（英语 3.5；瑞典语 3,5 当 3.5）',
    at('物价上涨 <b>了3.5</b> %。', { word: '3.5', cands: ['3.5'], single: true }) === '3.5' && at('物价上涨 <b>了3.5</b> %。', { word: '3,5', cands: ['3,5'], single: true }) === '3.5');
  // 小问题：「实际上」不去掉「上」（Intl.Segmenter 切成「实际/上有」）；扩展 B 的汉字；constructor 这样的词
  check('「实际上」整个画（英语 actually、瑞典语 faktiskt）',
    at('他们 <b>实际上</b> 有可能赢得选举。', { word: 'actually', cands: ['其实'], single: true }) === '实际上' && at('他们 <b>实际上</b> 有可能赢得选举。', { word: 'faktiskt', cands: ['其实'], single: true }) === '实际上');
  check('扩展 B 的汉字（两个码元）不被当成标点去掉', at('<b>𠮷野家</b>😀开了新店', { word: 'Yoshinoya', cands: ['吉野家'], single: true }) === '𠮷野家');
  const pc = SV.wordspan.plan('The constructor calls toString.', [{ text: 'The', start: 0, end: 3 }, { text: 'constructor', start: 4, end: 15 }, { text: 'calls', start: 16, end: 21 }, { text: 'toString', start: 22, end: 30 }], 2, null, weak.en).ctx({}, '');
  check('词是 constructor、toString 时不拿到 Object 自己的东西', pc.others.every((o) => o.tr.every((t) => typeof t === 'string')), JSON.stringify(pc.others));
}

// ---------- 评估集 ----------
const setFile = process.argv[2];
if (setFile) {
  console.log('\n== 评估集：' + setFile);
  const set = JSON.parse(readFileSync(setFile, 'utf8'));
  // 以前的办法（2026-11-13 上一版的 js/sense.js）：在整句的普通译文里找意思的中文词，对照用
  const old = (() => {
    function rivals(words, wi, list) {
      const mine = new Set((list || []).map((e) => e.lemma));
      const out = [];
      words.forEach((w, i) => {
        if (i === wi) return;
        const gl = SV.glossary.lookup(w);
        if (!gl || gl.some((e) => mine.has(e.lemma))) return;
        const keys = new Set();
        for (const s of SV.sense.senses(gl)) for (const k of s.keys) keys.add(k);
        if (keys.size) out.push([...keys]);
      });
      return out;
    }
    function pick(list, zh, others) {
      const text = String(zh || '').replace(/\s+/g, '');
      const hits = [];
      list.forEach((s, si) => { for (const k of s.keys) { let from = 0; let at; while ((at = text.indexOf(k, from)) >= 0) { hits.push({ s: si, k, start: at, end: at + k.length }); from = at + 1; } } });
      const live = hits.filter((h) => !hits.some((g) => g.s !== h.s && g.start <= h.start && g.end >= h.end && g.end - g.start > h.end - h.start));
      const count = new Map();
      for (const h of live) count.set(h.k, (count.get(h.k) || 0) + 1);
      const rivalsOf = (k) => others.filter((keys) => keys.some((o) => o.includes(k) || k.includes(o))).length;
      const won = new Set();
      for (const h of live) if (count.get(h.k) > rivalsOf(h.k)) won.add(h.s);
      return won.size === 1 ? [...won][0] : -1;
    }
    return { rivals, pick };
  })();
  const variants = {
    'V0 以前的办法（整句里找）': (it, I) => (I.ss.filter((x) => x.keys.length).length >= 2 ? old.pick(I.ss, it.plain, old.rivals(I.words, it.wi, I.list)) : -1),
    'V2 以前的办法，只挑能挑的词': (it, I) => (SV.sense.pickable(I.list, I.ss) ? old.pick(I.ss, it.plain, old.rivals(I.words, it.wi, I.list)) : -1),
    'H2 网站用的规则（标签）': (it, I) => (SV.sense.pickable(I.list, I.ss) ? SV.sense.pickTagged(I.ss, SV.sense.parseTagged(it.html)).index : -1),
  };
  const table = {};
  const unlabelled = new Set();
  for (const it of set) {
    const words = SV.text.words(it.text).map((w) => w.text);
    const list = SV.glossary.lookup(words[it.wi]);
    const I = { words, list, ss: SV.sense.senses(list) };
    for (const [name, fn] of Object.entries(variants)) {
      const t = table[name] || (table[name] = { n: 0, ok: 0, bad: [] });
      const p = fn(it, I);
      if (p < 0) continue;
      t.n++;
      if (!Array.isArray(it.ok)) { unlabelled.add(it.text + ' / ' + it.word); t.bad.push(it.word + '（没标）'); continue; }
      if (it.ok.includes(p)) t.ok++;
      else t.bad.push(it.word + ' → ' + I.ss[p].text);
    }
  }
  console.log(`  ${set.length} 个词（${new Set(set.map((x) => x.text)).size} 句）`);
  for (const [name, t] of Object.entries(table)) console.log(`  ${name}：画了 ${t.n} 个，对 ${t.ok} 个，错 ${t.bad.length} 个${t.bad.length ? '（' + t.bad.join('，') + '）' : ''}`);
  if (unlabelled.size) console.log('  没标答案的：' + [...unlabelled].join(' | '));
  const h2 = table['H2 网站用的规则（标签）'] || { bad: [] };
  check('评估集：网站用的规则一个也没画错', !h2.bad.length, h2.bad.join('，'));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过。`);
process.exit(failed.length ? 1 : 0);

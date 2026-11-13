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

// 用 Playwright 的 WebKit（Safari 的引擎，Windows 上也能跑）检查 Safari / iPhone / iPad 上的用法，
// 重点：没有「全文翻译」按钮，没有浏览器内置翻译时提示浏览器自己的整页翻译；查词和本句译文走 MyMemory；
// 「读完以后」按钮（读完就停 / 接着读下一篇 / 本篇循环：记住、浏览器不让存时照样能用、旧版本的「循环」开关改过来）；
// 语速按钮（只有 0.8×、0.9×、1× 和三连读，旧版本的别的语速改成最近的一档）；微软翻译（假的 /translate）和按这一句选词义的下划线在 WebKit 里的样子。
// 微软翻译默认当作连不上（假的 /translate 让请求失败），别的检查照旧走 MyMemory。
// 最后在 Playwright 的 Firefox 里也看一下（没装就跳过），包括云端语音（假的 SDK）的后台朗读、本篇循环、页面藏着时接着读下一篇和锁屏界面的动作。
//   node tests/webkit_check.mjs <截图目录> [网址] [real]
// 不给网址时，自己在本机起静态服务器。MyMemory 默认由测试代答（不占真实额度）；最后加 real 时，
// 「真实翻译」那一项真的去问 MyMemory（一个词和一句话，很少的额度）。
// 需要 Playwright：在任意目录 `npm i playwright && npx playwright install webkit firefox`，
// 再把那个目录设成环境变量 PLAYWRIGHT_DIR（仓库里不放 node_modules）。
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_AZURE, MS_RECORDER, fakeTranslateReply } from './fakes.mjs';

const [outDir = 'shots-webkit', urlArg = '', mode = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
let pw;
try { pw = await import('playwright'); } catch {
  if (!process.env.PLAYWRIGHT_DIR) { console.error('找不到 playwright：请设 PLAYWRIGHT_DIR（见文件开头）'); process.exit(2); }
  pw = createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js'))('playwright');
}
const { webkit, firefox, devices } = pw;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let server = null;
let baseUrl = urlArg;
if (!baseUrl) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(repoRoot, p));
    try {
      if (!file.startsWith(repoRoot) || !statSync(file).isFile()) throw new Error();
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/Svenska/`;
}
console.log('测试网址', baseUrl, '引擎 WebKit', webkit.name());

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  通过 ' : '  失败 ') + name + (detail ? '：' + detail : ''));
}
const WARN = 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN  23 HOURS 59 MINUTES 59 SECONDS VISIT HTTPS://MYMEMORY.TRANSLATED.NET/DOC/USAGELIMITS.PHP TO TRANSLATE MORE';
const json = (route, obj, status = 200) => route.fulfill({ status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(obj) });
const MM = {
  ok: (route, rec) => {
    const u = new URL(route.request().url());
    const q = u.searchParams.get('q') || '';
    rec.push({ chars: q.length, bytes: Buffer.byteLength(q), urlLen: route.request().url().length, params: [...u.searchParams.keys()] });
    return json(route, { responseData: { translatedText: '【译】' + q.slice(0, 20) }, quotaFinished: false, responseStatus: 200 });
  },
  quota: (route) => json(route, { responseData: { translatedText: WARN }, quotaFinished: true, responseStatus: 429 }),
  warnIn200: (route) => json(route, { responseData: { translatedText: WARN }, quotaFinished: false, responseStatus: 200 }),
  tooLong: (route) => json(route, { responseData: { translatedText: 'QUERY LENGTH LIMIT EXCEEDED. MAX ALLOWED QUERY : 500 CHARS' }, responseStatus: 200 }),
  blocked: (route) => route.abort('blockedbyclient'),
};

// 假的 /translate（微软翻译，Tony 的 Worker 的替身，fakes.mjs）：azMode 'down'（默认：连不上）| 'ok' | 'quota' | 'busy'；
// azPlan.add 放进句子的译文里（按这一句选词义的测试用）
let azMode = 'down';
let azPlan = {};
const azRoute = (route) => {
  const req = route.request();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const r = fakeTranslateReply(azMode, req.postData() || '', azPlan);
  if (!r) return route.abort('connectionrefused');
  return route.fulfill({ status: r.status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(r.body) });
};
const WORKER_TRANSLATE = 'https://svenska-tts.tony6838.workers.dev/translate';

const browser = await webkit.launch();
const allErrors = [];
let shotNo = 0;
// preset：打开网页之前先放进 localStorage 的设置（模拟旧版本、或者用户自己改过的设置）
// blockStorage：浏览器不让存（隐私模式、关了网站数据），读 localStorage / sessionStorage 就出错
async function newPage(device, mm, rec = [], preset = null, userAgent = '', blockStorage = false) {
  const ctx = await browser.newContext({ ...devices[device], ...(userAgent ? { userAgent } : {}) });
  if (blockStorage) {
    await ctx.addInitScript(() => {
      for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
  }
  if (preset) await ctx.addInitScript((p) => { try { if (!sessionStorage.getItem('preset-done')) { localStorage.setItem('sv.settings.v1', JSON.stringify(p)); sessionStorage.setItem('preset-done', '1'); } } catch (e) { /* 忽略 */ } }, preset);
  const page = await ctx.newPage();
  page.hasTouchInput = !!devices[device].hasTouch;
  page.on('pageerror', (e) => allErrors.push(device + ': ' + e.message));
  if (mm) await page.route('**/api.mymemory.translated.net/**', (route) => mm(route, rec));
  await page.route(WORKER_TRANSLATE, azRoute);
  await page.goto(baseUrl);
  const ok = await page.waitForFunction(() => window.SVApp && SVApp.state().view === 'list', null, { timeout: 40000 }).then(() => true, () => false);
  return { ctx, page, ok, rec };
}
// 「本句译文」的结果：一般在弹出框下面（.sent）；有几个意思的词，整句译文自动显示在上面的格子里（.ctxs），结果和说明都在那里
// 有触摸的设备用 tap，Mac 的 Safari 用鼠标点
const touch = (page, sel, i = 0) => (page.hasTouchInput ? page.locator(sel).nth(i).tap() : page.locator(sel).nth(i).click());
async function openArticle(page) {
  await touch(page, '#list .card');
  return page.waitForFunction(() => SVApp.state().view === 'article' && SVApp.state().sentences > 0, null, { timeout: 10000 }).then(() => true, () => false);
}
async function shot(page, name) {
  await page.screenshot({ path: join(outDir, String(++shotNo).padStart(2, '0') + '-' + name + '.png') });
}
const seen = (page) => page.evaluate(() => ({
  toast: document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent,
  s: SVApp.state(),
}));
// 「全文翻译」按钮还在不在（应当没有）；看得见的「整篇翻译：……」提示
const trState = (page, where) => page.evaluate((w) => ({
  btn: !!document.querySelector('#btnTranslate'),
  hint: [...document.querySelectorAll(w + ' .page-tr-hint, ' + w + ' .safari-hint')].length + /整篇翻译：/.test(document.querySelector(w).textContent),
  help: document.querySelector('#helpTrHint').textContent, // 说明框「?」的整篇翻译里，这个浏览器的办法（认不出的浏览器是空的）
  others: document.querySelector('#helpTrOthers').textContent, // 后面列各个浏览器的办法：「别的浏览器：」或者「比如：」
}), where);
// 「读完以后」按钮（读完就停 / 接着读下一篇 / 本篇循环）的样子和存下来的设置
const afterState = (page) => page.evaluate(() => {
  const b = document.querySelector('#btnAfter');
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('sv.settings.v1')).after; } catch (e) { stored = 'blocked'; }
  return { exists: !!b, sv: b && b.dataset.sv, pressed: b && (b.classList.contains('on') ? 'on' : 'off') + (b.hasAttribute('aria-pressed') ? '+aria-pressed' : ''), label: b && b.getAttribute('aria-label'), mode: b && b.dataset.mode,
    icon: b ? [...b.querySelectorAll('svg')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.getAttribute('class')).join() : '', after: SVApp.state().settings.after, stored };
});
// 语速按钮：上面的字、三连读的台阶、读屏软件听到的
const rateState = (page) => page.evaluate(() => {
  const b = document.querySelector('#btnRate');
  const steps = b.querySelector('.steps');
  return { face: b.querySelector('b').textContent, steps: getComputedStyle(steps).display !== 'none', pass: b.dataset.pass, label: b.getAttribute('aria-label'), sv: b.dataset.sv,
    rate: SVApp.state().settings.rate, ramp: SVApp.state().settings.ramp, clipped: b.scrollWidth > b.clientWidth + 1 };
});
const layout = (page) => page.evaluate(() => {
  const de = document.documentElement;
  const btns = [...document.querySelectorAll('#player button')].filter((b) => !b.hidden).map((b) => b.getBoundingClientRect());
  return { vw: de.clientWidth, scrollW: de.scrollWidth, playerFits: btns.every((r) => r.left >= 0 && r.right <= de.clientWidth + 0.5) };
});

try {
  // ---------- iPhone：Safari 的默认用法 ----------
  console.log('\n== iPhone 13（WebKit、Safari 的 UA、触摸）');
  let { ctx, page, ok, rec } = await newPage('iPhone 13', MM.ok);
  check('iPhone 上列出文章（SR 的 CORS 在 WebKit 里也通）', ok);
  const env = await page.evaluate(() => ({ ua: navigator.userAgent, translator: typeof self.Translator, dialog: typeof HTMLDialogElement, segmenter: typeof Intl.Segmenter, speech: 'speechSynthesis' in window, voices: window.speechSynthesis ? speechSynthesis.getVoices().filter((v) => /^sv/i.test(v.lang)).length : 0 }));
  console.log('  环境：', JSON.stringify(env));
  check('Safari 没有内置翻译', env.translator === 'undefined');
  check('在线翻译（查词用）默认开着', (await seen(page)).s.settings.online === true);
  await page.waitForFunction(() => document.body.classList.contains('no-builtin'), null, { timeout: 5000 }).catch(() => {});
  let tr = await trState(page, '#list');
  check('没有「全文翻译」按钮，列表上不提示整页翻译，说明框里写着 Safari 的「aA → 翻译成中文」', !tr.btn && !tr.hint && tr.help === '你现在用的浏览器：点地址栏「aA → 翻译成中文」。', JSON.stringify(tr));
  let lay = await layout(page);
  check('iPhone 上列表不横向溢出、朗读按钮在屏幕内', lay.scrollW <= lay.vw && lay.playerFits, JSON.stringify(lay));
  await shot(page, 'iphone-list');
  check('iPhone 上点一篇打开文章', await openArticle(page));
  tr = await trState(page, '#article');
  check('文章页上也不提示（在说明框里）', !tr.btn && !tr.hint, JSON.stringify(tr));
  const hdr = await page.evaluate(() => {
    const b = document.querySelector('#btnBack'), br = document.querySelector('#brand'), t = document.querySelector('.tools');
    const rb = b.getBoundingClientRect(), rr = br.getBoundingClientRect(), rt = t.getBoundingClientRect();
    const mid = (r) => (r.top + r.bottom) / 2;
    return { shown: !b.hidden, text: b.innerText.trim(), sameRow: Math.abs(mid(rb) - mid(rr)) < 8 && Math.abs(mid(rt) - mid(rr)) < 8, h: Math.round(rb.height), inView: rb.left >= 0 && rb.right <= document.documentElement.clientWidth, clipped: b.scrollWidth > b.clientWidth + 1 };
  });
  check('iPhone 上「← 列表」在顶栏标题旁边、同一行，不截字，好点', hdr.shown && hdr.sameRow && hdr.inView && !hdr.clipped && hdr.h >= 36, JSON.stringify(hdr));
  await touch(page, '#brand');
  await page.waitForTimeout(300);
  const g = await page.evaluate(() => { const g = document.querySelector('#guide'); if (g.hidden) return null; const r = g.getBoundingClientRect(); return { on: r.left >= 0 && r.right <= document.documentElement.clientWidth && r.bottom <= innerHeight, lines: g.querySelectorAll('li').length }; });
  check('iPhone 上点标题打开「怎么用」，在屏幕内', g && g.on && g.lines >= 4, JSON.stringify(g));
  await shot(page, 'iphone-guide');
  // 点「怎么用」外面（正文左边的空白，不是词）：关上。手机上话题不再占一行，文章开头那一行现在被「怎么用」盖着
  const outW = await page.evaluate(() => { const g = document.querySelector('#guide').getBoundingClientRect(); return { x: 6, y: Math.round(Math.min(innerHeight - 30, g.bottom + 30)) }; });
  await page.touchscreen.tap(outW.x, outW.y);
  await page.waitForTimeout(300);
  check('iPhone 上点别处关上「怎么用」', await page.evaluate(() => document.querySelector('#guide').hidden), JSON.stringify(outW));
  await touch(page, '#article .body .w', 2);
  await page.waitForTimeout(800);
  const pop = await page.evaluate(() => { const p = document.querySelector('#popup'); if (p.hidden) return null; const r = p.getBoundingClientRect(); return { word: p.querySelector('.pw b').textContent, text: (p.querySelector('.gl')?.textContent || '') + (p.querySelector('.mt')?.textContent || ''), on: r.left >= 0 && r.right <= document.documentElement.clientWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  check('iPhone 上点词弹出中文，弹出框在屏幕内', pop && pop.text && pop.on, JSON.stringify(pop));
  await page.locator('#popup .acts button', { hasText: '本句译文' }).tap();
  await page.waitForTimeout(800);
  let sent = await page.evaluate(() => (() => { const a = document.querySelector('#popup .sent'); const b = document.querySelector('#popup .ctxs'); return (a && !a.hidden ? a.textContent : '') || (b && !b.hidden ? b.textContent : ''); })());
  check('「本句译文」用 MyMemory（测试代答）', /【译】/.test(sent), sent.slice(0, 40));
  check('发给 MyMemory 的每段不超过 500 个字符、只有 q 和 langpair', rec.length && rec.every((r) => r.chars <= 500 && r.params.every((k) => k === 'q' || k === 'langpair')),
    `${rec.length} 次，最长 ${Math.max(0, ...rec.map((r) => r.chars))} 字符 / ${Math.max(0, ...rec.map((r) => r.bytes))} 字节 / 网址 ${Math.max(0, ...rec.map((r) => r.urlLen))} 字符`);
  await shot(page, 'iphone-sentence');
  await page.evaluate(() => document.querySelector('#main').click());
  // 往下滚：话题和朗读按钮粘在顶上
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  const stick = await page.evaluate(() => { const bar = document.querySelector('#topbar').getBoundingClientRect(); const p = document.querySelector('#btnPlay').getBoundingClientRect(); return { barTop: Math.round(bar.top), playTop: Math.round(p.top), playBottom: Math.round(p.bottom), scrolled: Math.round(scrollY) }; });
  check('iPhone 上往下滚，朗读按钮还粘在顶上', stick.barTop === 0 && stick.playTop >= 0 && stick.playBottom < 130, JSON.stringify(stick));
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log('  朗读：', env.speech ? `有 speechSynthesis，${env.voices} 个瑞典语声音` : '这个 WebKit 没有 speechSynthesis（Windows 上的 WebKit 不带语音），朗读只能在真的苹果设备上试');
  await ctx.close();

  // ---------- iPhone 上的 Chrome（CriOS，也是 WebKit） ----------
  ({ ctx, page, ok } = await newPage('iPhone 13', MM.ok, [], null, devices['iPhone 13'].userAgent.replace('Version/', 'CriOS/157.0.0.0 Version/')));
  await page.waitForFunction(() => document.body.classList.contains('no-builtin'), null, { timeout: 5000 }).catch(() => {});
  tr = await trState(page, '#list');
  check('iPhone 上的 Chrome（认不出它的办法）：没有按钮，列表上不提示，说明框里不说「你现在用的浏览器」，只列各个浏览器的办法', !tr.btn && !tr.hint && tr.help === '' && tr.others === '比如：', JSON.stringify(tr));
  await ctx.close();

  // ---------- 「读完以后」按钮（读完就停 → 接着读下一篇 → 本篇循环）、语速按钮（0.8× → 0.9× → 1× → 三连读）：
  // 瑞典文提示、读屏软件听到的、图标、浏览器记住；浏览器不让存时照样能用
  // （Windows 上的 WebKit 不能播音频，也没有 Media Session，所以朗读本身在这里试不了，在下面的 Firefox 里试）
  console.log('\n== 「读完以后」和语速按钮');
  ({ ctx, page, ok } = await newPage('iPhone 13', MM.ok));
  let lp = await afterState(page);
  check('iPhone 上有「读完以后」按钮，默认「读完就停」（灰色的重复图标，瑞典文提示 Stoppa efter artikeln）',
    lp.exists && lp.mode === 'stop' && lp.icon === 'i-stop' && lp.sv === 'Stoppa efter artikeln' && lp.pressed === 'off' && lp.label === '读完以后：读完就停' && lp.after === 'stop', JSON.stringify(lp));
  await touch(page, '#btnAfter');
  await page.waitForTimeout(200);
  lp = await afterState(page);
  check('点一下：接着读下一篇（瑞典文提示 Fortsätt med nästa artikel），存进了浏览器',
    lp.mode === 'next' && lp.icon === 'i-next' && lp.pressed === 'on' && lp.sv === 'Fortsätt med nästa artikel' && lp.label === '读完以后：接着读下一篇' && lp.stored === 'next', JSON.stringify(lp));
  await touch(page, '#btnAfter');
  await page.waitForTimeout(200);
  lp = await afterState(page);
  check('再点一下：本篇循环（重复图标里有个 1，瑞典文提示 Upprepa artikeln）', lp.mode === 'loop' && lp.icon === 'i-loop' && lp.sv === 'Upprepa artikeln' && lp.stored === 'loop', JSON.stringify(lp));
  await page.reload();
  await page.waitForFunction(() => window.SVApp && SVApp.state().view === 'list', null, { timeout: 40000 });
  lp = await afterState(page);
  check('重新打开网页，还是「本篇循环」', lp.mode === 'loop' && lp.pressed === 'on' && lp.after === 'loop', JSON.stringify(lp));
  await shot(page, 'iphone-after-loop');
  await touch(page, '#btnAfter');
  await page.waitForTimeout(200);
  check('再点一下：回到「读完就停」', (await afterState(page)).mode === 'stop');
  // 语速：默认 0.9×，点：1× → 三连读（0.8× 和台阶）→ 0.8× → 0.9×
  let rs = await rateState(page);
  check('语速默认 0.9×（读屏软件听到「语速 0.9×」）', rs.face === '0.9×' && !rs.steps && rs.label === '语速 0.9×' && /^Talhastighet 0,9×$/.test(rs.sv), JSON.stringify(rs));
  const faces = [];
  for (let k = 0; k < 4; k++) {
    await touch(page, '#btnRate');
    await page.waitForTimeout(150);
    rs = await rateState(page);
    faces.push(rs.face + (rs.steps ? '+台阶' + rs.pass : '') + (rs.clipped ? '（截字）' : ''));
    if (rs.ramp) await shot(page, 'iphone-rate-ramp');
  }
  check('语速按钮只有四种：1× → 三连读（0.8× 和台阶，第 1 遍）→ 0.8× → 0.9×，不截字', faces.join(' ') === '1× 0.8×+台阶1 0.8× 0.9×', faces.join(' '));
  const lay5 = await layout(page);
  check('iPhone 上五个朗读按钮都在屏幕内', lay5.playerFits, JSON.stringify(lay5));
  await ctx.close();
  ({ ctx, page, ok } = await newPage('iPhone 13', MM.ok, [], null, '', true));
  check('浏览器不让存的时候，页面照常列出文章', ok);
  await touch(page, '#btnAfter');
  await page.waitForTimeout(200);
  lp = await afterState(page);
  check('浏览器不让存的时候，「读完以后」照样能换（只在这次打开的页面里有效）', lp.mode === 'next' && lp.after === 'next' && lp.stored === 'blocked', JSON.stringify(lp));
  await ctx.close();

  // ---------- 旧版本留下的「关」：改回默认一次 ----------
  console.log('\n== 设置的迁移');
  ({ ctx, page, ok } = await newPage('iPhone 13', MM.ok, [], { online: false, topic: 'idag' }));
  let v = await seen(page);
  check('旧版本存的「在线翻译关」（点过「不用」）改回默认的开', v.s.settings.online === true && v.s.settings.v === 3, JSON.stringify({ online: v.s.settings.online, v: v.s.settings.v }));
  await openArticle(page);
  let idx = await page.evaluate(() => [...document.querySelectorAll('#article .body .w')].findIndex((w) => w.textContent.length > 6 && !SV.glossary.lookup(w.textContent)));
  await touch(page, '#article .body .w', Math.max(0, idx));
  await page.waitForTimeout(800);
  let pv = await page.evaluate(() => document.querySelector('#popup .mt')?.textContent || '');
  check('迁移后点词直接用在线翻译', /【译】/.test(pv), pv);
  await ctx.close();
  // 旧版本的「循环」开关和别的语速：「循环」开着 → 本篇循环；语速只剩 0.8、0.9、1，别的改成最近的一档
  for (const [preset, wantAfter, wantRate] of [[{ v: 3, loop: true, rate: 0.7, topic: 'idag' }, 'loop', 0.8], [{ v: 3, loop: false, rate: 1.25, topic: 'idag' }, 'stop', 1], [{ v: 3, rate: 1.1, topic: 'idag' }, 'stop', 1], [{ v: 3, rate: 0.6, topic: 'idag' }, 'stop', 0.8]]) {
    ({ ctx, page, ok } = await newPage('iPhone 13', MM.ok, [], preset));
    const m = await page.evaluate(() => { let st = null; try { st = JSON.parse(localStorage.getItem('sv.settings.v1')); } catch (e) { /* 忽略 */ } return { after: SVApp.state().settings.after, rate: SVApp.state().settings.rate, mode: document.querySelector('#btnAfter').dataset.mode, face: document.querySelector('#btnRate b').textContent, storedLoop: st && 'loop' in st, storedAfter: st && st.after, storedRate: st && st.rate }; });
    check(`旧设置 ${JSON.stringify(preset)}：读完以后是「${wantAfter}」，语速 ${wantRate}×（存回去也是）`,
      m.after === wantAfter && m.mode === wantAfter && m.rate === wantRate && m.face === wantRate + '×' && m.storedAfter === wantAfter && m.storedRate === wantRate && !m.storedLoop, JSON.stringify(m));
    await ctx.close();
  }

  // ---------- 这个版本以后在「设置」里关掉的：保留，并且有「打开在线翻译」 ----------
  console.log('\n== 在「设置」里关掉在线翻译以后');
  ({ ctx, page, ok } = await newPage('iPhone 13', MM.ok, [], { online: false, v: 3, topic: 'idag' }));
  check('新版本里自己关掉的，重新打开网页后还是关着', (await seen(page)).s.settings.online === false);
  await openArticle(page);
  idx = await page.evaluate(() => [...document.querySelectorAll('#article .body .w')].findIndex((w) => w.textContent.length > 6 && !SV.glossary.lookup(w.textContent)));
  await touch(page, '#article .body .w', Math.max(0, idx));
  await page.waitForTimeout(700);
  let pw2 = await page.evaluate(() => ({ mt: document.querySelector('#popup .mt')?.textContent || '', btn: !!document.querySelector('#popup .mt .on-btn') }));
  check('点词：说明在线翻译关着、开关在哪里，并给「打开在线翻译」按钮', /顶部齿轮按钮「设置」/.test(pw2.mt) && pw2.btn, pw2.mt);
  await shot(page, 'iphone-popup-off');
  await touch(page, '#popup .mt .on-btn');
  await page.waitForTimeout(800);
  pw2 = await page.evaluate(() => ({ mt: document.querySelector('#popup .mt')?.textContent || '', online: SVApp.state().settings.online, popup: !document.querySelector('#popup').hidden }));
  check('点「打开在线翻译」：一点就打开，马上显示译文', pw2.popup && pw2.online === true && /【译】/.test(pw2.mt), pw2.mt);
  await ctx.close();
  ({ ctx, page, ok } = await newPage('iPhone 13', MM.ok, [], { online: false, v: 3, topic: 'idag' }));
  await openArticle(page);
  await touch(page, '#article .body .w', 1);
  await page.waitForTimeout(500);
  await page.locator('#popup .acts button', { hasText: '本句译文' }).tap();
  await page.waitForTimeout(500);
  pw2 = await page.evaluate(() => ({ sent: (() => { const a = document.querySelector('#popup .sent'); const b = document.querySelector('#popup .ctxs'); return (a && !a.hidden ? a.textContent : '') || (b && !b.hidden ? b.textContent : ''); })(), btn: !!document.querySelector('#popup .sent:not([hidden]) .on-btn, #popup .ctxs:not([hidden]) .on-btn') }));
  check('「本句译文」：关着时也给「打开在线翻译」按钮', pw2.btn && /设置/.test(pw2.sent), pw2.sent);
  await touch(page, '#popup .sent:not([hidden]) .on-btn, #popup .ctxs:not([hidden]) .on-btn');
  await page.waitForTimeout(800);
  sent = await page.evaluate(() => (() => { const a = document.querySelector('#popup .sent'); const b = document.querySelector('#popup .ctxs'); return (a && !a.hidden ? a.textContent : '') || (b && !b.hidden ? b.textContent : ''); })());
  check('点了以后马上显示整句的译文', /【译】/.test(sent), sent);
  await ctx.close();

  // ---------- MyMemory 出错时（本句译文），用户看得到中文说明，不会把错误当译文 ----------
  console.log('\n== MyMemory 出错');
  for (const [name, handler, expect] of [
    ['额度用完（quotaFinished）', MM.quota, /额度/],
    ['额度用完（200 里夹着 MYMEMORY WARNING）', MM.warnIn200, /额度/],
    ['查询太长（200 里夹着错误说明）', MM.tooLong, /出错/],
    ['被拦截 / 连不上', MM.blocked, /没有回应/],
  ]) {
    ({ ctx, page, ok } = await newPage('iPhone 13', handler));
    await openArticle(page);
    await touch(page, '#article .body .w', 1);
    await page.waitForTimeout(400);
    await page.locator('#popup .acts button', { hasText: '本句译文' }).tap();
    await page.waitForTimeout(1200);
    sent = await page.evaluate(() => (() => { const a = document.querySelector('#popup .sent'); const b = document.querySelector('#popup .ctxs'); return (a && !a.hidden ? a.textContent : '') || (b && !b.hidden ? b.textContent : ''); })());
    check(`${name}：说明写成中文，不当成译文`, expect.test(sent) && !/MYMEMORY WARNING|^QUERY LENGTH/.test(sent), sent.slice(0, 60));
    if (name.startsWith('额度用完（quota')) await shot(page, 'iphone-quota');
    await ctx.close();
  }

  // ---------- 微软翻译（假的 /translate）、按这一句选词义的下划线 ----------
  console.log('\n== iPhone：微软翻译（假的 /translate）、按这一句选词义');
  azMode = 'ok';
  azPlan = {};
  ({ ctx, page, ok } = await newPage('iPhone 13', MM.ok));
  await openArticle(page);
  const wk = await page.evaluate(() => [...document.querySelectorAll('#article .w')].map((w, i) => {
    const sEl = w.closest('.s'); const gl = SV.glossary.lookup(w.textContent); const ss = SV.sense.senses(gl);
    return { i, si: +sEl.dataset.si, text: w.textContent, gl: !!gl, n: ss.length, pickable: SV.sense.pickable(gl, ss), keys: ss.map((x) => x.keys) };
  }));
  const popW = () => page.evaluate(() => {
    const p = document.querySelector('#popup'); if (p.hidden) return null; const r = p.getBoundingClientRect();
    const best = p.querySelector('.sense.best'); const c = best ? getComputedStyle(best) : null; const box = p.querySelector('.ctxs'); const key = box && box.querySelector('.key');
    return { word: p.querySelector('.pw b').textContent, mt: p.querySelector('.mt') ? p.querySelector('.mt').textContent : '', eng: p.querySelector('.eng').textContent,
      best: p.querySelectorAll('.sense.best').length, bestIndex: best ? [...p.querySelectorAll('.sense')].indexOf(best) : -1, why: box ? box.dataset.why : null,
      sentence: box && !box.hidden ? box.textContent : '', key: key ? key.textContent : '', keyColor: key ? getComputedStyle(key).textDecorationColor : '',
      line: c ? c.textDecorationLine : '', color: c ? c.textDecorationColor : '',
      on: r.left >= 0 && r.top >= 0 && r.right <= document.documentElement.clientWidth + 0.5 && r.bottom <= innerHeight + 0.5 };
  });
  const closeW = () => page.evaluate(() => { if (!document.querySelector('#popup').hidden) document.querySelector('#main').click(); });
  const freshW = wk.filter((x) => !x.gl && x.text.length >= 4 && /^\p{L}+$/u.test(x.text));
  await touch(page, '#article .w', freshW[0].i);
  await page.waitForTimeout(800);
  let pz = await popW();
  check('iPhone：小词典里没有的词用微软翻译', pz && pz.mt === '〔微软〕' + freshW[0].text && pz.eng === '微软翻译', JSON.stringify(pz));
  await closeW();
  const mw = wk.find((x) => x.pickable);
  const mw2 = wk.find((x) => x.pickable && mw && x.si !== mw.si);
  if (mw && mw2) {
    azPlan = { tag: mw.keys[0][0] };
    await touch(page, '#article .w', mw.i);
    await page.waitForTimeout(900);
    pz = await popW();
    check('iPhone：能挑的词、确定：意思和自动显示的整句译文里都画蓝色下划线，弹出框在屏幕内',
      pz && pz.best === 1 && pz.bestIndex === 0 && pz.why === 'match' && /underline/.test(pz.line) && pz.color === 'rgb(21, 101, 192)' && pz.key === mw.keys[0][0] && pz.keyColor === 'rgb(21, 101, 192)' && pz.on, `${mw.text}「${mw.keys[0][0]}」 ${JSON.stringify(pz)}`);
    await shot(page, 'iphone-sense-certain');
    await closeW();
    azPlan = { tag: mw2.keys[0][0] + mw2.keys[1][0] };
    await touch(page, '#article .w', mw2.i);
    await page.waitForTimeout(900);
    pz = await popW();
    check('iPhone：不确定：整句译文自动显示，不画', pz && pz.best === 0 && ['tie', 'wide'].includes(pz.why) && /测试译文/.test(pz.sentence) && !pz.key && pz.on, JSON.stringify(pz));
    await shot(page, 'iphone-sense-uncertain');
    await closeW();
    azPlan = {};
  } else {
    check('iPhone：文章里有两句带能挑的词', false, '这篇文章里没有');
  }
  azMode = 'quota';
  await touch(page, '#article .w', freshW[1].i);
  await page.waitForTimeout(900);
  pz = await popW();
  const markW = await page.evaluate(() => { try { return !!JSON.parse(localStorage.getItem('sv.az.v1')).until; } catch (e) { return false; } });
  check('iPhone：微软翻译的免费额度用完：用 MyMemory，写着额度用完了，记住 6 小时', pz && /【译】/.test(pz.mt) && pz.eng === 'MyMemory 在线翻译（微软翻译的免费额度用完了）' && markW, JSON.stringify(pz));
  await shot(page, 'iphone-quota-mymemory');
  await ctx.close();
  azMode = 'down';
  azPlan = {};

  // ---------- iPad、Mac 的 Safari ----------
  for (const device of ['iPad (gen 7)', 'Desktop Safari']) {
    console.log(`\n== ${device}`);
    ({ ctx, page, ok } = await newPage(device, MM.ok));
    check(`${device} 上列出文章`, ok);
    await page.waitForFunction(() => document.body.classList.contains('no-builtin'), null, { timeout: 5000 }).catch(() => {});
    lay = await layout(page);
    check(`${device} 上不横向溢出、朗读按钮在屏幕内`, lay.scrollW <= lay.vw && lay.playerFits, JSON.stringify(lay));
    tr = await trState(page, '#list');
    check(`${device}：没有「全文翻译」按钮，列表上不提示，说明框里是「aA → 翻译成中文」`, !tr.btn && !tr.hint && /aA → 翻译成中文/.test(tr.help), JSON.stringify(tr));
    await openArticle(page);
    await shot(page, device.replace(/\W+/g, '-') + '-article');
    await ctx.close();
  }

  // ---------- 真的问 MyMemory（加 real 时）：查一个词、翻一句 ----------
  if (mode === 'real') {
    console.log('\n== 真实的 MyMemory（WebKit、iPhone）');
    ({ ctx, page, ok } = await newPage('iPhone 13', null));
    await openArticle(page);
    idx = await page.evaluate(() => [...document.querySelectorAll('#article .body .w')].findIndex((w) => w.textContent.length > 6 && !SV.glossary.lookup(w.textContent)));
    await touch(page, '#article .body .w', Math.max(0, idx));
    await page.waitForTimeout(3000);
    pv = await page.evaluate(() => document.querySelector('#popup .mt')?.textContent || '');
    await page.locator('#popup .acts button', { hasText: '本句译文' }).tap();
    await page.waitForTimeout(4000);
    sent = await page.evaluate(() => (() => { const a = document.querySelector('#popup .sent'); const b = document.querySelector('#popup .ctxs'); return (a && !a.hidden ? a.textContent : '') || (b && !b.hidden ? b.textContent : ''); })());
    const zhRe = /[一-鿿]/;
    check('真实的 MyMemory：查词和本句译文都有中文（或者清楚的中文说明）', zhRe.test(pv) && zhRe.test(sent), `${pv} ｜ ${sent.slice(0, 50)}`);
    await shot(page, 'iphone-real-mymemory');
    await ctx.close();
  }

  // ---------- Firefox ----------
  console.log('\n== Firefox');
  let ff = null;
  try { ff = await firefox.launch(); } catch (e) { console.log('  没有装 Playwright 的 Firefox，跳过：' + String(e.message).split('\n')[0]); }
  if (ff) {
    const fctx = await ff.newContext({ viewport: { width: 1280, height: 800 } });
    const fpage = await fctx.newPage();
    fpage.on('pageerror', (e) => allErrors.push('Firefox: ' + e.message));
    const frec = [];
    await fpage.route('**/api.mymemory.translated.net/**', (route) => MM.ok(route, frec));
    await fpage.route(WORKER_TRANSLATE, azRoute);
    await fpage.goto(baseUrl);
    ok = await fpage.waitForFunction(() => window.SVApp && SVApp.state().view === 'list', null, { timeout: 40000 }).then(() => true, () => false);
    check('Firefox 上列出文章', ok, await fpage.evaluate(() => navigator.userAgent));
    await fpage.waitForFunction(() => document.body.classList.contains('no-builtin') || typeof self.Translator !== 'undefined', null, { timeout: 5000 }).catch(() => {});
    tr = await trState(fpage, '#list');
    const hasApi = await fpage.evaluate(() => typeof self.Translator !== 'undefined');
    check('Firefox：没有「全文翻译」按钮，列表上不提示，说明框里是「用地址栏的翻译图标」', !tr.btn && !tr.hint && /用地址栏的翻译图标/.test(tr.help), JSON.stringify({ hasApi, ...tr }));
    await fpage.locator('#list .card').first().click();
    await fpage.waitForFunction(() => SVApp.state().view === 'article' && SVApp.state().sentences > 0, null, { timeout: 10000 });
    const fidx = await fpage.evaluate(() => [...document.querySelectorAll('#article .body .w')].findIndex((w) => w.textContent.length > 6 && !SV.glossary.lookup(w.textContent)));
    await fpage.locator('#article .body .w').nth(Math.max(0, fidx)).click();
    await fpage.waitForTimeout(800);
    const fpop = await fpage.evaluate(() => document.querySelector('#popup .mt')?.textContent || '');
    check('Firefox 上点词，查词用 MyMemory', /【译】/.test(fpop), fpop);
    await fpage.screenshot({ path: join(outDir, String(++shotNo).padStart(2, '0') + '-firefox-article.png') });
    await fctx.close();

    // ---------- Firefox：后台朗读、循环朗读、锁屏界面的控制（云端语音：假的 SDK 和令牌服务；Firefox 的 audio 真的播） ----------
    // 无头里页面藏不起来：把 document.hidden 改成 true、发 visibilitychange（和切到别的标签页时页面收到的一样），
    // 看页面自己不停下、一段读完接着读下一段。真的后台（定时器、动画帧停下）在无头 Edge 的测试里试（窗口最小化）。
    console.log('\n== Firefox：后台朗读和循环朗读（云端语音，假的 SDK）');
    const cctx = await ff.newContext({ viewport: { width: 1280, height: 800 } });
    await cctx.addInitScript({ content: `window.SV_CONFIG = { ttsUrl: 'https://svtts.test' };` });
    await cctx.addInitScript({ content: FAKE_AZURE });
    await cctx.addInitScript({ content: MS_RECORDER });
    const cpage = await cctx.newPage();
    cpage.on('pageerror', (e) => allErrors.push('Firefox 云端: ' + e.message));
    await cpage.route('https://svtts.test/**', (route) => json(route, { token: 'tok-ff', region: 'northeurope' }));
    await cpage.route('https://svtts.test/translate', azRoute); // 后注册的先匹配：微软翻译照旧当作连不上
    await cpage.route('**/api.mymemory.translated.net/**', (route) => MM.ok(route, []));
    await cpage.goto(baseUrl);
    ok = await cpage.waitForFunction(() => window.SVApp && SVApp.state().view === 'list', null, { timeout: 40000 }).then(() => true, () => false);
    await cpage.locator('#list .card').first().click();
    await cpage.waitForFunction(() => SVApp.state().view === 'article' && SVApp.state().sentences > 0, null, { timeout: 10000 });
    const fst = () => cpage.evaluate(() => SVApp.state());
    const fms = await cpage.evaluate(() => ({ handlers: Object.keys(window.__ms || {}), title: navigator.mediaSession && navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : '' }));
    check('Firefox：用云端语音；锁屏界面和媒体键的动作都注册了，标题是这篇文章',
      ok && (await fst()).engine === 'cloud' && ['play', 'pause', 'stop', 'nexttrack', 'previoustrack'].every((n) => fms.handlers.includes(n)) && fms.title === (await fst()).title, JSON.stringify(fms));
    await cpage.locator('#btnPlay').click();
    const fStarted = await cpage.waitForFunction(() => SVApp.state().reader === 'speaking' && !!document.querySelector('#article .w.current'), null, { timeout: 8000 }).then(() => true, () => false);
    check('Firefox：点「朗读」，云端语音读起来（audio 真的在播）', fStarted, JSON.stringify(await fst()).slice(0, 120));
    const fb0 = (await fst()).block;
    await cpage.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    let fMax = fb0;
    const fStates = new Set();
    for (let k = 0; k < 14; k++) {
      await cpage.waitForTimeout(500);
      const x = await fst();
      fStates.add(x.reader);
      if (x.reader === 'speaking') fMax = Math.max(fMax, x.block);
    }
    check('Firefox：页面藏起来（模拟）时不停，一段读完接着读下一段', fStarted && fMax > fb0 && !fStates.has('paused'), `第 ${fb0} 段 → 第 ${fMax} 段，状态 ${[...fStates].join('、')}`);
    await cpage.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await cpage.waitForTimeout(800);
    const fBack = await cpage.evaluate(() => { const s = SVApp.state(); const w = document.querySelector('#article .w.current'); const sEl = document.querySelectorAll('#article .s')[s.si]; return { reader: s.reader, onWord: !!w && !!sEl && w === sEl.querySelectorAll('.w')[s.wi] }; });
    check('Firefox：回到前台时，标记就在正在读的词上', fBack.reader === 'speaking' && fBack.onWord, JSON.stringify(fBack));
    // 循环朗读：从最后一段读起，读完从头再读，重读时不再合成
    await cpage.evaluate(() => { window.__ttsWordMs = 25; });
    await cpage.locator('#btnAfter').click(); // 读完就停 → 接着读下一篇
    await cpage.locator('#btnAfter').click(); // → 本篇循环
    const fLast = await cpage.evaluate(() => { const ps = [...document.querySelectorAll('#article .body p, #article .body li')].filter((p) => p.querySelector('.w')); return [...document.querySelectorAll('#article .body .w')].indexOf(ps[ps.length - 1].querySelector('.w')); });
    // 先暂停再点最后一段的词：一个词 25 毫秒时，读着的页面一直在往回滚到正在读的词，
    // 滚到最后一段和点下去之间要是正好开始往回滚，点完词页面还在滚，那个词滚出屏幕，弹出框就关了
    await cpage.evaluate(() => window.__ms.pause());
    await cpage.locator('#article .body .w').nth(fLast).click();
    await cpage.waitForTimeout(300);
    await cpage.locator('#popup .acts button', { hasText: '从这里读' }).click();
    const fLoops0 = (await fst()).loops;
    const fLooped = await cpage.waitForFunction((n) => SVApp.state().loops > n + 1, fLoops0, { timeout: 120000, polling: 200 }).then(() => true, () => false);
    const fSynth = await cpage.evaluate(() => window.__ttsLog.map((x) => x.voice + '\n' + x.text));
    check('Firefox：开着「循环」，读完从头再读，读了两遍也每段只合成一次', fLooped && fSynth.length === new Set(fSynth).size, `读了 ${(await fst()).loops} 遍，合成 ${fSynth.length} 次`);
    await cpage.evaluate(() => window.__ms.pause());
    await cpage.waitForTimeout(300);
    check('Firefox：锁屏界面的「暂停」停下循环朗读', (await fst()).reader === 'paused' && (await cpage.evaluate(() => navigator.mediaSession.playbackState)) === 'paused');
    await cpage.screenshot({ path: join(outDir, String(++shotNo).padStart(2, '0') + '-firefox-loop-paused.png') });
    // 接着读下一篇，页面藏着（模拟）：读完停一下，打开列表里的下一篇接着读，锁屏界面换成新的标题
    await cpage.locator('#btnAfter').click(); // 本篇循环 → 读完就停
    await cpage.locator('#btnAfter').click(); // → 接着读下一篇
    const fId0 = (await fst()).id;
    await cpage.locator('#article .body .w').nth(fLast).click();
    await cpage.waitForTimeout(300);
    await cpage.locator('#popup .acts button', { hasText: '从这里读' }).click();
    await cpage.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const fNext = await cpage.waitForFunction((id0) => { const s = SVApp.state(); return s.id !== id0 && s.id === s.batch[s.batch.indexOf(id0) + 1] && s.reader === 'speaking' && !s.held; }, fId0, { timeout: 60000, polling: 200 }).then(() => true, () => false);
    const fN = await cpage.evaluate(() => ({ s: SVApp.state(), meta: navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : '' }));
    check('Firefox：「接着读下一篇」，页面藏着（模拟）时读完打开下一篇接着读，锁屏界面换成新的标题', fNext && fN.meta === fN.s.title, `${fN.s.reader} ${fN.s.title}`);
    await cpage.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await cpage.evaluate(() => window.__ms.pause());
    await cctx.close();
    await ff.close();
  }
} catch (e) {
  check('测试脚本没有出错', false, e.stack || String(e));
}
check('页面没有脚本错误', !allErrors.length, allErrors.slice(0, 5).join(' | '));
await browser.close();
if (server) server.close();
writeFileSync(join(outDir, 'webkit-report.json'), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过。`);
process.exit(failed.length ? 1 : 0);

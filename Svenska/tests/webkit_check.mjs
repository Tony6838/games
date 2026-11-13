// 用 Playwright 的 WebKit（Safari 的引擎，Windows 上也能跑）检查 Safari / iPhone / iPad 上的用法，
// 重点：没有「全文翻译」按钮，没有浏览器内置翻译时提示浏览器自己的整页翻译；查词和本句译文走 MyMemory。
// 最后在 Playwright 的 Firefox 里也看一下（没装就跳过）。
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

const browser = await webkit.launch();
const allErrors = [];
let shotNo = 0;
// preset：打开网页之前先放进 localStorage 的设置（模拟旧版本、或者用户自己改过的设置）
async function newPage(device, mm, rec = [], preset = null, userAgent = '') {
  const ctx = await browser.newContext({ ...devices[device], ...(userAgent ? { userAgent } : {}) });
  if (preset) await ctx.addInitScript((p) => { try { if (!sessionStorage.getItem('preset-done')) { localStorage.setItem('sv.settings.v1', JSON.stringify(p)); sessionStorage.setItem('preset-done', '1'); } } catch (e) { /* 忽略 */ } }, preset);
  const page = await ctx.newPage();
  page.hasTouchInput = !!devices[device].hasTouch;
  page.on('pageerror', (e) => allErrors.push(device + ': ' + e.message));
  if (mm) await page.route('**/api.mymemory.translated.net/**', (route) => mm(route, rec));
  await page.goto(baseUrl);
  const ok = await page.waitForFunction(() => window.SVApp && SVApp.state().view === 'list', null, { timeout: 40000 }).then(() => true, () => false);
  return { ctx, page, ok, rec };
}
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
  hint: [...document.querySelectorAll(w + ' .page-tr-hint')].filter((x) => x.offsetParent).map((x) => x.textContent).join(''),
}), where);
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
  check('没有「全文翻译」按钮，列表上提示 Safari 的「aA → 翻译成中文」', !tr.btn && /点地址栏「aA → 翻译成中文」/.test(tr.hint), JSON.stringify(tr));
  let lay = await layout(page);
  check('iPhone 上列表不横向溢出、朗读按钮在屏幕内', lay.scrollW <= lay.vw && lay.playerFits, JSON.stringify(lay));
  await shot(page, 'iphone-list');
  check('iPhone 上点一篇打开文章', await openArticle(page));
  tr = await trState(page, '#article');
  check('文章页上也有这行提示', !tr.btn && /aA → 翻译成中文/.test(tr.hint), tr.hint);
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
  await touch(page, '#article .meta');
  await page.waitForTimeout(300);
  check('iPhone 上点别处关上「怎么用」', await page.evaluate(() => document.querySelector('#guide').hidden));
  await touch(page, '#article .body .w', 2);
  await page.waitForTimeout(800);
  const pop = await page.evaluate(() => { const p = document.querySelector('#popup'); if (p.hidden) return null; const r = p.getBoundingClientRect(); return { word: p.querySelector('.pw b').textContent, text: (p.querySelector('.gl')?.textContent || '') + (p.querySelector('.mt')?.textContent || ''), on: r.left >= 0 && r.right <= document.documentElement.clientWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  check('iPhone 上点词弹出中文，弹出框在屏幕内', pop && pop.text && pop.on, JSON.stringify(pop));
  await page.locator('#popup .acts button', { hasText: '本句译文' }).tap();
  await page.waitForTimeout(800);
  let sent = await page.evaluate(() => document.querySelector('#popup .sent')?.textContent || '');
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
  check('iPhone 上的 Chrome：没有按钮，提示用浏览器自带的翻译', !tr.btn && /用浏览器自带的翻译功能/.test(tr.hint), tr.hint);
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
  pw2 = await page.evaluate(() => ({ sent: document.querySelector('#popup .sent')?.textContent || '', btn: !!document.querySelector('#popup .sent .on-btn') }));
  check('「本句译文」：关着时也给「打开在线翻译」按钮', pw2.btn && /设置/.test(pw2.sent), pw2.sent);
  await touch(page, '#popup .sent .on-btn');
  await page.waitForTimeout(800);
  sent = await page.evaluate(() => document.querySelector('#popup .sent')?.textContent || '');
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
    sent = await page.evaluate(() => document.querySelector('#popup .sent')?.textContent || '');
    check(`${name}：说明写成中文，不当成译文`, expect.test(sent) && !/MYMEMORY WARNING|^QUERY LENGTH/.test(sent), sent.slice(0, 60));
    if (name.startsWith('额度用完（quota')) await shot(page, 'iphone-quota');
    await ctx.close();
  }

  // ---------- iPad、Mac 的 Safari ----------
  for (const device of ['iPad (gen 7)', 'Desktop Safari']) {
    console.log(`\n== ${device}`);
    ({ ctx, page, ok } = await newPage(device, MM.ok));
    check(`${device} 上列出文章`, ok);
    await page.waitForFunction(() => document.body.classList.contains('no-builtin'), null, { timeout: 5000 }).catch(() => {});
    lay = await layout(page);
    check(`${device} 上不横向溢出、朗读按钮在屏幕内`, lay.scrollW <= lay.vw && lay.playerFits, JSON.stringify(lay));
    tr = await trState(page, '#list');
    check(`${device}：没有「全文翻译」按钮，提示「aA → 翻译成中文」`, !tr.btn && /aA → 翻译成中文/.test(tr.hint), tr.hint);
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
    sent = await page.evaluate(() => document.querySelector('#popup .sent')?.textContent || '');
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
    await fpage.goto(baseUrl);
    ok = await fpage.waitForFunction(() => window.SVApp && SVApp.state().view === 'list', null, { timeout: 40000 }).then(() => true, () => false);
    check('Firefox 上列出文章', ok, await fpage.evaluate(() => navigator.userAgent));
    await fpage.waitForFunction(() => document.body.classList.contains('no-builtin') || typeof self.Translator !== 'undefined', null, { timeout: 5000 }).catch(() => {});
    tr = await trState(fpage, '#list');
    const hasApi = await fpage.evaluate(() => typeof self.Translator !== 'undefined');
    check('Firefox：没有「全文翻译」按钮，没有内置翻译时提示「用地址栏的翻译图标」', !tr.btn && (hasApi || /用地址栏的翻译图标/.test(tr.hint)), JSON.stringify({ hasApi, ...tr }));
    await fpage.locator('#list .card').first().click();
    await fpage.waitForFunction(() => SVApp.state().view === 'article' && SVApp.state().sentences > 0, null, { timeout: 10000 });
    const fidx = await fpage.evaluate(() => [...document.querySelectorAll('#article .body .w')].findIndex((w) => w.textContent.length > 6 && !SV.glossary.lookup(w.textContent)));
    await fpage.locator('#article .body .w').nth(Math.max(0, fidx)).click();
    await fpage.waitForTimeout(800);
    const fpop = await fpage.evaluate(() => document.querySelector('#popup .mt')?.textContent || '');
    check('Firefox 上点词，查词用 MyMemory', /【译】/.test(fpop), fpop);
    await fpage.screenshot({ path: join(outDir, String(++shotNo).padStart(2, '0') + '-firefox-article.png') });
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

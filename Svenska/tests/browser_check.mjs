// 用无头 Edge 真实打开「瑞典语读报」，用真实的鼠标、触摸、键盘事件检查各项功能，截图并收集控制台错误。
//   node tests/browser_check.mjs <截图目录> [网址]
// 不给网址时，自己在本机起一个静态服务器（根目录是仓库的根），打开 http://127.0.0.1:<端口>/Svenska/。
// 给网址时（比如 https://tony6838.github.io/games/Svenska/）直接测那个网址。
//
// 一共打开三次页面：
//   1. 电脑 1600×900、真实的朗读和浏览器内置翻译：每个话题列出文章、再点一次换一批；打开文章、返回列表、
//      浏览器后退、下一篇；鼠标悬停查词；看看无头 Edge 里真实的瑞典语声音能不能读、有没有词的 boundary 事件；
//      试内置翻译。
//   2. 电脑 1600×900、模拟的朗读（假的 Sofie / Mattias，按词发 boundary 事件）、没有内置翻译、
//      MyMemory 由测试代答（不占真实额度）：朗读高亮、空格暂停继续、点文章暂停、从这里读、换男女声、
//      在线翻译前先征求同意、列表里翻译标题、全文翻译、发给 MyMemory 的内容（不超过 500 字节、不带电子邮件）。
//   3. 手机 390×844 触摸：列表和文章不横向溢出、再点话题换一批、点词弹框不出屏、点屏幕暂停、全文翻译、返回列表。
// 只连 SR、MyMemory 和本机；页面连了别的地方算失败。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [outDir = 'shots', urlArg = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const feedCache = process.env.SV_FEED_CACHE || '';
if (feedCache) mkdirSync(feedCache, { recursive: true });

// ---------- 本机静态服务器 ----------
let server = null;
let baseUrl = urlArg;
if (!baseUrl) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };
  server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(repoRoot, p));
    if (!file.startsWith(repoRoot)) { res.writeHead(403); res.end(); return; }
    try {
      if (!statSync(file).isFile()) throw new Error();
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/Svenska/`;
}
console.log('测试网址', baseUrl);

// ---------- 无头 Edge ----------
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9650 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'svcheck-'));
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 60 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let msgId = 0;
const pendingMsgs = new Map();
const problems = [];
const hosts = new Map();
let mock = null; // MyMemory 代答
const mmRequests = [];
ws.addEventListener('message', async (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pendingMsgs.has(msg.id)) { pendingMsgs.get(msg.id)(msg); pendingMsgs.delete(msg.id); return; }
  const p = msg.params;
  if (msg.method === 'Runtime.exceptionThrown') problems.push('异常: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  else if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) problems.push(p.type + ': ' + p.args.map((a) => a.value ?? a.description).join(' '));
  else if (msg.method === 'Log.entryAdded' && p.entry.level === 'error') problems.push('日志: ' + p.entry.text + (p.entry.url ? ' ' + p.entry.url : ''));
  else if (msg.method === 'Network.requestWillBeSent') {
    try {
      const u = new URL(p.request.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') hosts.set(u.host, (hosts.get(u.host) || 0) + 1);
    } catch { /* data: 等 */ }
  } else if (msg.method === 'Fetch.requestPaused' && /api\.sr\.se/.test(p.request.url)) {
    // 调试时用：SV_FEED_CACHE=目录，SR 的源只取一次，存在本机临时目录里，以后从那里读（不进仓库）
    const file = join(feedCache, encodeURIComponent(p.request.url) + '.xml');
    if (p.responseStatusCode == null) {
      if (existsSync(file)) {
        send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/atom+xml; charset=utf-8' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: readFileSync(file).toString('base64') });
      } else send('Fetch.continueRequest', { requestId: p.requestId });
    } else {
      const b = await send('Fetch.getResponseBody', { requestId: p.requestId });
      if (p.responseStatusCode === 200 && b.result) writeFileSync(file, Buffer.from(b.result.body, b.result.base64Encoded ? 'base64' : 'utf8'));
      send('Fetch.continueRequest', { requestId: p.requestId });
    }
  } else if (msg.method === 'Fetch.requestPaused') {
    const u = new URL(p.request.url);
    const q = u.searchParams.get('q') || '';
    mmRequests.push({ q, bytes: Buffer.byteLength(q), params: [...u.searchParams.keys()] });
    const body = JSON.stringify({ responseData: { translatedText: '【译】' + q.slice(0, 24), match: 0.9 }, quotaFinished: false, responseDetails: '', responseStatus: 200, matches: [] });
    send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(body).toString('base64'),
    });
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; pendingMsgs.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const state = () => evalJs('window.SVApp && SVApp.state()');
async function waitFor(expr, ms = 30000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await evalJs(expr)) return true; } catch { /* 页面还没好 */ }
    await sleep(step);
  }
  return false;
}
let shotNo = 0;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(outDir, String(++shotNo).padStart(2, '0') + '-' + name + '.png');
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('  截图', file);
}
let touchMode = false;
async function tap(x, y) {
  if (touchMode) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(40);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(120);
}
async function hover(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
async function space() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: ' ' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await sleep(150);
}
// 元素中心（视口坐标），先滚到看得见
async function center(selector, index = 0) {
  return evalJs(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return null;
    const r0 = el.getBoundingClientRect();
    const band = { top: document.querySelector('#topics').getBoundingClientRect().bottom, bottom: document.querySelector('#player').getBoundingClientRect().top };
    if (r0.top < band.top + 20 || r0.bottom > band.bottom - 20) window.scrollBy(0, r0.top - (band.top + 120));
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 30)), y: Math.round(r.top + r.height / 2), text: el.textContent };
  })()`);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  通过 ' : '  失败 ') + name + (detail ? '：' + detail : ''));
}

const FAKE_SPEECH = `(() => {
  const voices = [
    { name: 'Microsoft Sofie Online (Natural) - Swedish (Sweden)', lang: 'sv-SE', voiceURI: 'fake-sofie', localService: false, default: false },
    { name: 'Microsoft Mattias Online (Natural) - Swedish (Sweden)', lang: 'sv-SE', voiceURI: 'fake-mattias', localService: false, default: false },
    { name: 'Microsoft David - English (United States)', lang: 'en-US', voiceURI: 'fake-david', localService: true, default: true },
  ];
  window.__speechLog = [];
  let queue = [], timer = null, speaking = null;
  const fire = (u, type, extra) => { const e = Object.assign(new Event(type), extra || {}); if (u['on' + type]) u['on' + type](e); };
  function run() {
    if (speaking || !queue.length) return;
    const u = queue.shift();
    speaking = u;
    window.__speechLog.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate, lang: u.lang });
    fire(u, 'start');
    const words = [...u.text.matchAll(/\\S+/g)];
    let i = 0;
    const step = () => {
      if (speaking !== u) return;
      if (i < words.length) { fire(u, 'boundary', { name: 'word', charIndex: words[i].index, charLength: words[i][0].length }); i++; timer = setTimeout(step, 160); }
      else { speaking = null; fire(u, 'end'); run(); }
    };
    timer = setTimeout(step, 40);
  }
  const fake = {
    getVoices: () => voices,
    speak(u) { queue.push(u); setTimeout(run, 0); },
    cancel() { const u = speaking; queue = []; speaking = null; clearTimeout(timer); if (u) fire(u, 'error', { error: 'interrupted' }); },
    pause() {}, resume() {},
    get speaking() { return !!speaking; }, get pending() { return queue.length > 0; }, get paused() { return false; },
    addEventListener() {}, removeEventListener() {}, onvoiceschanged: null,
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; } };
})();`;
const NO_BUILTIN = `(() => { try { delete window.Translator; } catch (e) {} if (typeof window.Translator !== 'undefined') Object.defineProperty(window, 'Translator', { value: undefined, configurable: true }); })();`;

let scriptIds = [];
async function openPage({ width, height, mobile, fakeSpeech, noBuiltin, mockMM, query = '' }) {
  for (const id of scriptIds) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
  scriptIds = [];
  if (fakeSpeech) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_SPEECH })).result.identifier);
  if (noBuiltin) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: NO_BUILTIN })).result.identifier);
  const patterns = [];
  if (mockMM) patterns.push({ urlPattern: '*api.mymemory.translated.net*', requestStage: 'Request' });
  if (feedCache) patterns.push({ urlPattern: '*api.sr.se/api/rss/program/*', requestStage: 'Request' }, { urlPattern: '*api.sr.se/api/rss/program/*', requestStage: 'Response' });
  if (patterns.length) await send('Fetch.enable', { patterns });
  else await send('Fetch.disable');
  mock = mockMM;
  touchMode = mobile;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 });
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await send('Page.navigate', { url: baseUrl + query });
  await sleep(800);
  const ok = await waitFor("window.SVApp && !SVApp.state().loading && SVApp.state().view === 'list'", 40000);
  return ok;
}

async function layoutReport(sel) {
  return evalJs(`(() => {
    const de = document.documentElement;
    const box = document.querySelector(${JSON.stringify(sel)});
    const p = box.querySelector('.body p, .body li, .card .c-first') || box;
    const br = box.getBoundingClientRect();
    const cards = [...box.querySelectorAll('.card')].map((c) => Math.round(c.getBoundingClientRect().top));
    const btns = [...document.querySelectorAll('#player button')].map((b) => b.getBoundingClientRect());
    const chips = document.querySelector('#topics');
    return {
      vw: de.clientWidth, scrollW: de.scrollWidth, boxW: Math.round(br.width), boxLeft: Math.round(br.left),
      fontPx: parseFloat(getComputedStyle(p).fontSize),
      columns: cards.length ? cards.filter((t) => t === cards[0]).length : 0,
      playerFits: btns.every((r) => r.left >= 0 && r.right <= de.clientWidth + 0.5),
      chipsScrollable: chips.scrollWidth > chips.clientWidth, chipsW: chips.scrollWidth,
      cutText: [...document.querySelectorAll('#player button .lbl')].filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent),
    };
  })()`);
}
async function popupReport() {
  return evalJs(`(() => {
    const p = document.querySelector('#popup');
    if (p.hidden) return null;
    const r = p.getBoundingClientRect();
    const de = document.documentElement;
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: de.clientWidth, vh: innerHeight,
      word: p.querySelector('.pw b')?.textContent, gl: p.querySelector('.gl')?.textContent || '', mt: p.querySelector('.mt')?.textContent || '', eng: p.querySelector('.eng')?.textContent || '',
      onScreen: r.left >= 0 && r.top >= 0 && r.right <= de.clientWidth + 0.5 && r.bottom <= innerHeight + 0.5 };
  })()`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');

const listReady = (key) => `window.SVApp && !SVApp.state().loading && ${key ? `SVApp.state().topic === ${JSON.stringify(key)} && ` : ''}(SVApp.state().view === 'list' || SVApp.state().view === 'message')`;
async function openFirstCard(index = 0) {
  const c = await center('#list .card', index);
  if (!c) return false;
  await tap(c.x, c.y);
  return waitFor(`SVApp.state().view === 'article' && SVApp.state().sentences > 0`, 10000);
}
async function clickButtonText(sel, text) {
  const p = await evalJs(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)}) && x.offsetParent); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!p) return false;
  await tap(p.x, p.y);
  return true;
}

const summary = { url: baseUrl, topics: [] };
try {
  // ================= 1. 电脑、真实的朗读和翻译 =================
  console.log('\n== 1. 电脑 1600×900：话题列表、换一批、打开文章和返回、悬停查词、真实声音、内置翻译');
  check('首页打开并列出文章', await openPage({ width: 1600, height: 900, mobile: false }));
  let st = await state();
  check('默认话题是「今日要闻」，普通新闻', st.topic === 'idag' && st.view === 'list' && st.batch.length >= 5, `${st.batch.length} 篇`);
  const lay = await layoutReport('#list');
  summary.desktopListLayout = lay;
  check('电脑上列表用满宽度', lay.boxW >= lay.vw * 0.85, `列表 ${lay.boxW}px / 视口 ${lay.vw}px，${lay.columns} 列`);
  check('电脑上没有横向滚动', lay.scrollW <= lay.vw, `${lay.scrollW} <= ${lay.vw}`);
  await shot('desktop-list');
  const topicKeys = await evalJs('SV.sources.TOPICS.map((t) => t.key)');
  for (let i = 0; i < topicKeys.length; i++) {
    const key = topicKeys[i];
    const c = await center(`#topics .chip[data-topic="${key}"]`);
    await tap(c.x, c.y);
    await waitFor(listReady(key), 40000);
    const s1 = await state();
    const msg = await evalJs(`document.querySelector('#article .state-box')?.textContent || ''`);
    const titles1 = await evalJs(`[...document.querySelectorAll('#list .card .c-title')].slice(0, 3).map((x) => x.textContent)`);
    let s2 = s1;
    if (s1.view === 'list') {
      await sleep(150);
      const c2 = await center(`#topics .chip[data-topic="${key}"]`);
      await tap(c2.x, c2.y);
      await waitFor(`${listReady(key)} && SVApp.state().batchNo === ${s1.batchNo + 1}`, 20000);
      s2 = await state();
    }
    const notice = await evalJs(`document.querySelector('#notice').hidden ? '' : document.querySelector('#notice').textContent`);
    const overlap = s1.batch.filter((id) => s2.batch.includes(id)).length;
    summary.topics.push({ key, view: s1.view, first: s1.batch.length, second: s2.batch.length, overlap, titles: titles1, notice, message: msg });
    if (s1.view === 'message') {
      check(`话题「${key}」`, /最近几天没有/.test(msg), '没有文章，显示了说明：' + msg.slice(0, 80));
      continue;
    }
    check(`话题「${key}」列出文章`, s1.batch.length >= 1, `${s1.batch.length} 篇，第一篇：${titles1[0] || ''}`);
    check(`话题「${key}」再点一次换一批`, s2.batchNo === s1.batchNo + 1 && s2.batch.length >= 1 && (overlap === 0 || /重新开始/.test(notice)), `第二批 ${s2.batch.length} 篇，和第一批重复 ${overlap} 篇${notice ? '；提示：' + notice : ''}`);
  }
  // 回到今日要闻，打开第一篇
  const ci = await center('#topics .chip[data-topic="idag"]');
  await tap(ci.x, ci.y);
  await waitFor(listReady('idag'), 20000);
  check('在列表里点一篇，打开文章', await openFirstCard(0), (await state()).title);
  const lay2 = await layoutReport('#article');
  summary.desktopArticleLayout = lay2;
  check('电脑上正文用满宽度', lay2.boxW >= lay2.vw * 0.85, `正文 ${lay2.boxW}px / 视口 ${lay2.vw}px，字号 ${lay2.fontPx}px`);
  await shot('desktop-article');
  const firstId = (await state()).id;
  await clickButtonText('#article .back-btn', '返回');
  await waitFor(`SVApp.state().view === 'list'`, 5000);
  st = await state();
  check('「← 返回列表」回到原来的列表，标上「已读」', st.view === 'list' && await evalJs(`!!document.querySelector('#list .card.read[data-id=${JSON.stringify(firstId)}]')`), st.view);
  await openFirstCard(1);
  await evalJs('history.back()');
  await waitFor(`SVApp.state().view === 'list'`, 5000);
  check('浏览器的「后退」也回到列表', (await state()).view === 'list');
  await openFirstCard(0);
  const idA = (await state()).id;
  await clickButtonText('#article .next-row button', '下一篇');
  await waitFor(`SVApp.state().view === 'article' && SVApp.state().id !== ${JSON.stringify(idA)}`, 5000);
  st = await state();
  check('文章末尾的「下一篇」打开列表里的下一篇', st.id === st.batch[1], st.title);
  await evalJs('window.scrollTo(0, 0)');
  await sleep(300);
  // 悬停查词
  const wi = await evalJs(`(() => { const ws = [...document.querySelectorAll('#article .body .w')]; return ws.findIndex((w) => w.textContent.length >= 5); })()`);
  const wc = await center('#article .body .w', Math.max(0, wi));
  await hover(wc.x, wc.y);
  await sleep(1500);
  let pr = await popupReport();
  check('鼠标悬停在词上弹出中文', !!pr && pr.word === wc.text && (pr.mt || pr.gl).length > 0 && !/翻译中/.test(pr.mt + pr.gl), pr ? `${pr.word} → ${pr.gl} ${pr.mt} ${pr.eng}` : '没有弹出');
  check('悬停弹出框在屏幕内', pr && pr.onScreen, pr ? JSON.stringify(pr) : '');
  await shot('desktop-hover');
  await hover(5, 880);
  await sleep(900);
  check('鼠标移开后弹出框消失', !(await popupReport()));
  // 真实声音
  const voices = await evalJs(`speechSynthesis.getVoices().filter((v) => /^sv/i.test(v.lang)).map((v) => v.name)`);
  summary.realVoices = voices;
  console.log('  无头 Edge 里的瑞典语声音：', voices.join('；') || '没有');
  const pc = await center('#btnPlay');
  await tap(pc.x, pc.y);
  await sleep(6000);
  const sr = await state();
  const curWord = await evalJs(`document.querySelector('#article .w.current')?.textContent || ''`);
  summary.realSpeech = { reader: sr.reader, si: sr.si, wi: sr.wi, wordEvents: sr.wordEvents, voice: sr.voice, curWord };
  console.log('  真实朗读 6 秒后：', JSON.stringify(summary.realSpeech));
  await space();
  await sleep(200);
  check('真实朗读：空格暂停', (await state()).reader === 'paused', (await state()).reader);
  // 内置翻译（第一次要下载模型，无头里不一定成）
  const avail = await evalJs('SV.tr.builtinAvailability()');
  const tc = await center('#btnTranslate');
  await tap(tc.x, tc.y);
  const builtinOk = await waitFor('SVApp.state().translated > 0 && SVApp.state().translated === SVApp.state().blocks', 90000, 500);
  const sample = await evalJs(`[...document.querySelectorAll('#article .zh')].slice(0, 2).map((z) => z.textContent)`);
  summary.builtinTranslate = { availability: avail, ok: builtinOk, sample, dialogOpen: await evalJs(`!!document.querySelector('dialog[open]')`) };
  console.log('  内置翻译：', JSON.stringify({ avail, builtinOk, sample }));
  if (builtinOk) await shot('desktop-builtin-translation');
  await evalJs(`document.querySelectorAll('dialog[open]').forEach((d) => d.close('no'))`);

  // ================= 2. 电脑、模拟朗读、MyMemory 代答 =================
  console.log('\n== 2. 电脑 1600×900：模拟朗读、空格和点击暂停、男女声、在线翻译');
  check('页面重新打开', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true }));
  // 列表里翻译标题（要先同意用在线翻译）
  const tl = await center('#btnTranslate');
  await tap(tl.x, tl.y);
  await sleep(500);
  check('没有内置翻译时，先问要不要用在线翻译', await evalJs(`document.querySelector('#dlgConsent').open`));
  await shot('desktop-consent');
  await clickButtonText('#dlgConsent button', '使用在线翻译');
  const titlesDone = await waitFor(`SVApp.state().listZh === SVApp.state().batch.length`, 30000, 300);
  check('列表里「翻译标题」：每个标题下面有中文', titlesDone, `${(await state()).listZh}/${(await state()).batch.length}`);
  await shot('desktop-list-translated');
  check('打开一篇文章', await openFirstCard(0));
  const pc2 = await center('#btnPlay');
  await tap(pc2.x, pc2.y);
  await sleep(1500);
  let s = await state();
  const hl = await evalJs(`({ word: document.querySelector('#article .w.current')?.textContent || '', sent: !!document.querySelector('#article .s.reading') })`);
  check('点「朗读」开始读，句子和词高亮', s.reader === 'speaking' && hl.sent && hl.word, `${s.reader} 第 ${s.si} 句第 ${s.wi} 词「${hl.word}」，声音 ${s.voice}`);
  check('默认用女声 Sofie', /Sofie/.test(s.voice || ''), s.voice);
  await space();
  s = await state();
  const pausedAt = { si: s.si, wi: s.wi };
  check('空格暂停', s.reader === 'paused', JSON.stringify(pausedAt));
  await sleep(700);
  const s2b = await state();
  check('暂停后光标不动', s2b.si === pausedAt.si && s2b.wi === pausedAt.wi);
  await shot('desktop-paused');
  const logLen = await evalJs('__speechLog.length');
  await space();
  await sleep(100);
  s = await state();
  const resumedText = await evalJs(`__speechLog[${logLen}] && __speechLog[${logLen}].text`);
  const expected = await evalJs(`(() => { const s = document.querySelectorAll('#article .s')[${pausedAt.si}]; const w = s.querySelectorAll('.w')[${pausedAt.wi}]; return w ? w.textContent : ''; })()`);
  check('空格继续，从停下的词接着读', s.reader === 'speaking' && resumedText && resumedText.startsWith(expected), `从「${(resumedText || '').slice(0, 40)}」开始，停在「${expected}」`);
  await sleep(1200);
  const wc2 = await center('#article .body .w', 3);
  await tap(wc2.x, wc2.y);
  await sleep(400);
  s = await state();
  pr = await popupReport();
  check('点文章暂停朗读', s.reader === 'paused', s.reader);
  check('点在词上同时弹出中文', !!pr && pr.word === wc2.text, pr ? `${pr.word} → ${pr.gl} ${pr.mt}` : '');
  await sleep(1000);
  await shot('desktop-click-word-popup');
  const logLen2 = await evalJs('__speechLog.length');
  await clickButtonText('#popup .acts button', '从这里读');
  await sleep(300);
  const fromText = await evalJs(`__speechLog[${logLen2}] && __speechLog[${logLen2}].text`);
  check('弹出框「从这里读」从这个词开始读', (await state()).reader === 'speaking' && fromText && fromText.startsWith(wc2.text), (fromText || '').slice(0, 40));
  await space();
  const wc3 = await center('#article .body .w', 6);
  await tap(wc3.x, wc3.y);
  await sleep(300);
  const logLen3 = await evalJs('__speechLog.length');
  await clickButtonText('#popup .acts button', '读');
  await sleep(200);
  const spoken = await evalJs(`__speechLog[${logLen3}] && __speechLog[${logLen3}].text`);
  check('弹出框的喇叭读这个词', spoken === wc3.text, `${spoken} / ${wc3.text}`);
  await evalJs(`document.querySelector('#popup').hidden || document.querySelector('#main').click()`);
  const vc = await center('#btnVoice');
  await tap(vc.x, vc.y);
  await sleep(200);
  s = await state();
  check('点「女声」切换到男声 Mattias', s.voiceGender === 'm' && /Mattias/.test(s.voice || ''), s.voice);
  await tap(vc.x, vc.y);
  await sleep(200);
  s = await state();
  check('再点切回女声 Sofie', s.voiceGender === 'f' && /Sofie/.test(s.voice || ''), s.voice);
  const rc = await center('#btnRate');
  await tap(rc.x, rc.y);
  s = await state();
  check('点「语速」改变语速', Math.abs(s.settings.rate - 1) < 0.01, String(s.settings.rate));
  // 全文翻译（已经同意过在线翻译）
  await evalJs(`document.querySelector('#popup').hidden || document.querySelector('#main').click()`);
  const tc2 = await center('#btnTranslate');
  await tap(tc2.x, tc2.y);
  const allDone = await waitFor('SVApp.state().translated > 0 && SVApp.state().translated === SVApp.state().blocks', 60000, 300);
  s = await state();
  check('全文翻译：每段下面都有中文', allDone, `${s.translated}/${s.blocks} 段`);
  check('发给 MyMemory 的每段不超过 500 字节', mmRequests.length > 0 && mmRequests.every((r) => r.bytes <= 500), `${mmRequests.length} 次，最长 ${Math.max(0, ...mmRequests.map((r) => r.bytes))} 字节`);
  check('发给 MyMemory 的请求不带电子邮件等参数', mmRequests.every((r) => r.params.every((k) => k === 'q' || k === 'langpair')), [...new Set(mmRequests.flatMap((r) => r.params))].join(','));
  await evalJs('window.scrollTo(0, 0)');
  await sleep(200);
  await shot('desktop-translated');
  const tbLabel = await evalJs(`document.querySelector('#btnTranslate .lbl').textContent`);
  await tap(tc2.x, tc2.y);
  const hiddenZh = await evalJs(`[...document.querySelectorAll('#article .zh')].every((z) => z.hidden)`);
  check('再点「隐藏译文」把中文收起来', tbLabel === '隐藏译文' && hiddenZh, tbLabel);
  const nonGl = await evalJs(`(() => { const ws = [...document.querySelectorAll('#article .body .w')]; return ws.findIndex((w) => w.textContent.length > 6 && !SV.glossary.lookup(w.textContent)); })()`);
  const wc4 = await center('#article .body .w', Math.max(0, nonGl));
  await tap(wc4.x, wc4.y);
  await sleep(800);
  pr = await popupReport();
  check('点不在小词典里的词，用在线翻译', !!pr && pr.mt.length > 0 && !/翻译中/.test(pr.mt), pr ? `${pr.word} → ${pr.mt}（${pr.eng || '缓存'}）` : '');
  await evalJs(`document.querySelector('#main').click()`);
  const sel = await evalJs(`(() => { const ws = [...document.querySelectorAll('#article .body .w')].slice(2, 5); ws[0].scrollIntoView({ block: 'center' }); const a = ws[0].getBoundingClientRect(), b = ws[2].getBoundingClientRect(); return a.top === b.top ? { x1: a.left + 1, y: a.top + a.height / 2, x2: b.right - 1 } : null; })()`);
  if (sel) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sel.x1, y: sel.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sel.x1, y: sel.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let k = 1; k <= 8; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sel.x1 + (sel.x2 - sel.x1) * k / 8, y: sel.y, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sel.x2, y: sel.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(900);
    pr = await popupReport();
    check('鼠标选中几个词，弹出它们的中文', !!pr && pr.word && pr.word.includes(' ') && pr.mt.length > 0, pr ? `${pr.word} → ${pr.mt}` : '');
    await shot('desktop-selection');
  }

  // ================= 3. 手机 390×844 触摸 =================
  console.log('\n== 3. 手机 390×844 触摸');
  check('手机上打开页面', await openPage({ width: 390, height: 844, mobile: true, fakeSpeech: true, noBuiltin: true, mockMM: true }));
  const ml = await layoutReport('#list');
  summary.phoneListLayout = ml;
  check('手机上列表没有横向溢出', ml.scrollW <= ml.vw, `${ml.scrollW} <= ${ml.vw}`);
  check('手机上列表用满宽度、一列', ml.boxW >= ml.vw - 40 && ml.columns === 1, `列表 ${ml.boxW}px / 视口 ${ml.vw}px，${ml.columns} 列`);
  check('手机上播放栏的按钮都在屏幕内、字没有被截断', ml.playerFits && !ml.cutText.length, ml.cutText.join(','));
  check('手机上话题一行，可以横着滑', ml.chipsScrollable, `话题条宽 ${ml.chipsW}px`);
  await shot('phone-list');
  // 再点当前话题：换一批
  const b1 = (await state()).batch;
  const activeChip = await center('#topics .chip.active');
  await tap(activeChip.x, activeChip.y);
  await waitFor(`${listReady('')} && SVApp.state().batchNo === 2`, 20000);
  const b2 = (await state()).batch;
  check('手机上再点当前话题，换一批', b2.length > 0 && !b2.some((id) => b1.includes(id)), `${b2.length} 篇`);
  check('手机上点一篇打开文章', await openFirstCard(0), (await state()).title);
  const ma = await layoutReport('#article');
  summary.phoneArticleLayout = ma;
  check('手机上文章没有横向溢出', ma.scrollW <= ma.vw, `${ma.scrollW} <= ${ma.vw}`);
  check('手机上正文用满宽度', ma.boxW >= ma.vw - 40, `正文 ${ma.boxW}px / 视口 ${ma.vw}px，字号 ${ma.fontPx}px`);
  await shot('phone-article');
  const wp = await center('#article .body .w', 2);
  await tap(wp.x, wp.y);
  await sleep(900);
  pr = await popupReport();
  check('手机上点词弹出中文', !!pr && pr.word === wp.text, pr ? `${pr.word} → ${pr.gl} ${pr.mt}` : '');
  check('手机上弹出框在屏幕内', pr && pr.onScreen, pr ? JSON.stringify(pr) : '');
  await shot('phone-word-popup');
  const rightIdx = await evalJs(`(() => { const ws = [...document.querySelectorAll('#article .body .w')].slice(0, 80); let best = 0, br = 0; ws.forEach((w, i) => { const r = w.getBoundingClientRect(); if (r.right > br && r.top > 150 && r.bottom < innerHeight - 120) { br = r.right; best = i; } }); return best; })()`);
  const wr = await center('#article .body .w', rightIdx);
  await tap(wr.x + 5, wr.y);
  await sleep(700);
  pr = await popupReport();
  check('手机上点最右边的词，弹出框也不出屏', pr && pr.onScreen, pr ? `${pr.word} ${pr.left}-${pr.right}/${pr.vw}` : '');
  if (await popupReport()) { await tap(Math.round(ml.vw / 2), 40); await sleep(250); }
  if (await popupReport()) await evalJs(`document.querySelector('#main').click()`);
  const pp = await center('#btnPlay');
  await tap(pp.x, pp.y);
  await sleep(1200);
  s = await state();
  check('手机上点「朗读」开始读', s.reader === 'speaking', s.reader);
  await tap(Math.round(ml.vw / 2), 460);
  await sleep(300);
  s = await state();
  check('手机上点屏幕暂停', s.reader === 'paused', s.reader);
  await shot('phone-paused');
  await tap(pp.x, pp.y);
  await sleep(300);
  check('手机上点「继续」接着读', (await state()).reader === 'speaking');
  await space();
  const tp = await center('#btnTranslate');
  await tap(tp.x, tp.y);
  await sleep(400);
  if (await evalJs(`document.querySelector('#dlgConsent').open`)) await clickButtonText('#dlgConsent button', '使用在线翻译');
  const phoneTr = await waitFor('SVApp.state().translated > 0 && SVApp.state().translated === SVApp.state().blocks', 60000, 300);
  check('手机上全文翻译', phoneTr, `${(await state()).translated}/${(await state()).blocks}`);
  await evalJs('window.scrollTo(0, 0)');
  await sleep(200);
  await shot('phone-translated');
  const ml2 = await layoutReport('#article');
  check('手机上翻译后也没有横向溢出', ml2.scrollW <= ml2.vw, `${ml2.scrollW} <= ${ml2.vw}`);
  await clickButtonText('#article .back-btn', '返回');
  await waitFor(`SVApp.state().view === 'list'`, 5000);
  check('手机上「← 返回列表」', (await state()).view === 'list');
  const hb = await center('#btnSettings');
  await tap(hb.x, hb.y);
  await sleep(400);
  const dlg = await evalJs(`(() => { const d = document.querySelector('#dlgSettings'); const r = d.getBoundingClientRect(); return { open: d.open, left: r.left, right: r.right, vw: document.documentElement.clientWidth, voices: d.querySelector('#selVoice').options.length }; })()`);
  check('手机上设置对话框在屏幕内，列出声音', dlg.open && dlg.left >= 0 && dlg.right <= dlg.vw && dlg.voices >= 3, JSON.stringify(dlg));
  await shot('phone-settings');
  await evalJs(`document.querySelector('#dlgSettings').close()`);
} catch (e) {
  check('测试脚本没有出错', false, e.stack || String(e));
}

const allowed = (h) => /^127\.0\.0\.1(:\d+)?$/.test(h) || h === 'api.sr.se' || h === 'api.mymemory.translated.net' || h === new URL(baseUrl).host;
summary.hosts = Object.fromEntries(hosts);
check('页面只连了本站、SR 和 MyMemory', [...hosts.keys()].every(allowed), [...hosts.entries()].map(([h, n]) => `${h}×${n}`).join(' '));
const realProblems = problems.filter((p) => !/favicon/.test(p));
check('控制台没有错误', !realProblems.length, realProblems.slice(0, 8).join(' | '));
summary.problems = problems;
summary.results = results;
writeFileSync(join(outDir, 'report.json'), JSON.stringify(summary, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过。报告：${join(outDir, 'report.json')}`);
ws.close();
proc.kill();
if (server) server.close();
await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge 可能还没放手 */ }
process.exit(failed.length ? 1 : 0);

// 用无头 Edge 真实打开「瑞典语读报」，用真实的鼠标、触摸、键盘事件检查各项功能，截图并收集控制台错误。
//   node tests/browser_check.mjs <截图目录> [网址]
// 不给网址时，自己在本机起一个静态服务器（根目录是仓库的根），打开 http://127.0.0.1:<端口>/Svenska/。
// 给网址时（比如 https://tony6838.github.io/games/Svenska/）直接测那个网址。
//
// 环境变量 SV_REAL_TTS=1：最后再用真的云端语音（js/config.js 里的令牌服务和微软 Azure）读几秒，会花几百个字符的免费额度。
//
// 前三次一律用本机的声音（不管 js/config.js 里填了什么），第四、五次用假的微软 SDK 和假的令牌服务查云端语音。
// 「页面藏起来」用窗口最小化：页面真的 document.hidden，动画帧停下、定时器一秒一次（和切到别的标签页一样）。
//   1. 电脑 1600×900、真实的朗读和浏览器内置翻译：每个话题列出文章、再点一次换一批；打开文章、返回列表、
//      浏览器后退、下一篇；鼠标悬停查词；看看无头 Edge 里真实的瑞典语声音能不能读、有没有词的 boundary 事件、
//      窗口最小化时接着读；点一个词试内置翻译。
//   2. 电脑 1600×900、模拟的朗读（假的 Sofie / Mattias，按词发 boundary 事件）、没有内置翻译、
//      MyMemory 由测试代答（不占真实额度）：朗读高亮（只标词：浅色红色下划线、深色黄色下划线，句子不标，排版不动）、空格暂停继续、
//      窗口最小化时不暂停、点文章暂停、从这里读、换男女声、没有内置翻译时整页翻译的办法在说明框里、本句译文走 MyMemory、
//      发给 MyMemory 的内容（不超过 500 个字符、不带电子邮件）、本机的声音：本篇循环、接着读下一篇、三连读。
//   3. 手机 390×844 触摸、安卓 Chrome 的用户代理：去掉了的话题「电动车」、标题旁边的话题菜单、列表和文章不横向溢出、「换一批」按钮换一批、点词弹框不出屏、点屏幕暂停、
//      整页翻译的办法在说明框里、往下滚时朗读按钮粘在顶上、文章页的顶栏（话题菜单，没有「← 列表」）、点标题回到列表、320 / 375 / 430 像素宽的顶栏。
//   4. 云端语音：合成、播放、跟着播放进度标词、缓存、换声音、出错时改用本机的声音。
//   5. 云端语音：页面藏起来时一段接一段读下去、回来时标记在正在读的词上、锁屏界面和媒体键（Media Session）、
//      本篇循环（重读不再合成）、「下一首」接着读下一篇、换成读完就停这一遍读完就停。
//   5b. 读完以后（读完就停 → 接着读下一篇 → 本篇循环）、语速（只有 0.8×、0.9×、1×）和循序渐进三连读：旧设置的迁移、按钮的样子和 aria-label、
//      接着读下一篇（停一下、页面藏着时、暂停 / 停止 / 回到列表 / 下一首、这一批的最后一篇、都列过了、取不到）、三连读的三遍和读完以后。
//   6. 电脑：翻译的顺序（假的 /translate、假的内置翻译）：微软翻译 → 连不上、超时时用内置翻译、30 秒里不再问 → 额度用完时 6 小时不再问；
//      按这一句选词义（js/sense.js）：只有一个意思直接显示；几个意思时自动显示整句译文，确定（标签）时意思和译文里都画蓝色下划线
//      （深色模式另一种蓝），弹出框不跳不变大小、不盖住词；拿不准不画；结果回来时弹出框已经换了、关了，真的没放进去。
//      6b：在线翻译（MyMemory）关着、内置翻译要下载：微软翻译、内置翻译照样用，MyMemory 不用；鼠标停着开始的翻译不拖累点出来的。
//      6c：Worker 的设置不对（403、404、405、500、Azure 的密钥不对）：这次打开的页面里不再问。
//   7. 手机 390×844：额度用完时用 MyMemory 并说明；鼠标停着不用 MyMemory；手机宽度下的两种样子、很长的整句；MyMemory 给单词的字幕不显示；
//      翻译全都失败时不画也不报错；微软翻译暂时连不上时说清楚；太忙时一分钟里不再问。
// 只连 SR、MyMemory 和本机；页面连了别的地方算失败。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_AZURE, MS_RECORDER, FAKE_TRANSLATOR, fakeTranslateReply } from './fakes.mjs';

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
let ttsWorkerMode = 'ok'; // 假的云端语音令牌服务：'ok' 或 'forbidden'
let ttsTokenCalls = 0;
const mmRequests = [];
// 假的 /translate（微软翻译，Tony 的 Worker 的替身，fakes.mjs）：azMode 'ok' | 'quota' | 'busy' | 'down'（连不上）；
// azPlan.add 放进句子的译文里；azDelay 毫秒以后才回答；azRequests 记下每次请求的 texts
let azMode = 'ok';
let azPlan = {};
let azDelay = 0;
const azRequests = [];
// MyMemory 代答的样子：'ok'（【译】原文）、'garbage'（单词回一句字幕，像真的 MyMemory 那样）、'fail'（连不上）
let mmMode = 'ok';
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
  } else if (msg.method === 'Fetch.requestPaused' && /svtts\.test\/translate/.test(p.request.url)) {
    const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'POST' }, { name: 'Access-Control-Allow-Headers', value: 'Content-Type' }];
    if (p.request.method === 'OPTIONS') {
      send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 204, responseHeaders: cors });
      return;
    }
    const body = p.request.postData != null ? p.request.postData
      : (p.request.postDataEntries || []).map((e) => Buffer.from(e.bytes || '', 'base64').toString('utf8')).join('');
    try { const j = JSON.parse(body); const t = j.texts; t.html = j.textType === 'html'; azRequests.push(t); } catch { azRequests.push(null); }
    const reply = fakeTranslateReply(azMode, body, azPlan);
    const go = () => (reply
      ? send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: reply.status, responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(reply.body)).toString('base64') })
      : send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionRefused' }));
    if (azDelay) setTimeout(go, azDelay); else go();
  } else if (msg.method === 'Fetch.requestPaused' && /svtts\.test/.test(p.request.url)) {
    // 假的云端语音令牌服务（Tony 的 Cloudflare Worker 的替身）：ok 发令牌，forbidden 回 403
    ttsTokenCalls++;
    const ok = ttsWorkerMode === 'ok';
    send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: ok ? 200 : 403,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(JSON.stringify(ok ? { token: 'tok-' + ttsTokenCalls, region: 'northeurope' } : { error: 'origin not allowed' })).toString('base64'),
    });
  } else if (msg.method === 'Fetch.requestPaused') {
    const u = new URL(p.request.url);
    const q = u.searchParams.get('q') || '';
    mmRequests.push({ q, bytes: Buffer.byteLength(q), params: [...u.searchParams.keys()] });
    if (mmMode === 'fail') { send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionRefused' }); return; }
    // MyMemory 给单个词常常回翻译记忆库里的字幕（2026-11-13 实测：kommunen →「市长办公厅的人能够相信吗?」）
    const out = mmMode === 'garbage' && !/\s/.test(q) ? '市长办公厅的人能够相信吗?' : '【译】' + q.slice(0, 24);
    const body = JSON.stringify({ responseData: { translatedText: out, match: 0.9 }, quotaFinished: false, responseDetails: '', responseStatus: 200, matches: [] });
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
    const band = { top: Math.max(0, document.querySelector('#topbar').getBoundingClientRect().bottom), bottom: innerHeight };
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
      if (i < words.length) { fire(u, 'boundary', { name: 'word', charIndex: words[i].index, charLength: words[i][0].length }); i++; timer = setTimeout(step, window.__speechWordMs || 160); }
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

// 窗口最小化 / 还原：页面真的藏起来（document.hidden），requestAnimationFrame 停下，定时器放慢到一秒一次，
// 和切到别的标签页一样（无头 Edge 里实测）
async function minimize(on) {
  const w = await send('Browser.getWindowForTarget', {});
  if (!w.result) return false;
  await send('Browser.setWindowBounds', { windowId: w.result.windowId, bounds: { windowState: on ? 'minimized' : 'normal' } });
  await sleep(300);
  return true;
}

let scriptIds = [];
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';
// cloud：true 用云端语音（假的 SDK 和假的令牌服务 svtts.test）；'real' 用 js/config.js 里真的令牌服务和真的 Azure；
// 不设时一律用本机的声音，不管 js/config.js 里填了什么
// fakeTranslator：假的浏览器内置翻译（fakes.mjs）；initJs：在页面脚本之前运行的一段脚本（比如先清掉翻译的缓存）
async function openPage({ width, height, mobile, fakeSpeech, noBuiltin, mockMM, cloud = false, query = '', ua = '', fakeTranslator = false, initJs = '' }) {
  for (const id of scriptIds) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
  scriptIds = [];
  if (cloud !== 'real') scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.SV_CONFIG = { ttsUrl: ${JSON.stringify(cloud ? 'https://svtts.test' : '')} };` })).result.identifier);
  if (cloud === true) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_AZURE })).result.identifier);
  if (fakeSpeech) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_SPEECH })).result.identifier);
  if (noBuiltin) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: NO_BUILTIN })).result.identifier);
  if (fakeTranslator) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_TRANSLATOR })).result.identifier);
  if (initJs) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: initJs })).result.identifier);
  scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: MS_RECORDER })).result.identifier);
  const patterns = [];
  if (cloud === true) patterns.push({ urlPattern: '*svtts.test/*', requestStage: 'Request' });
  if (mockMM) patterns.push({ urlPattern: '*api.mymemory.translated.net*', requestStage: 'Request' });
  if (feedCache) patterns.push({ urlPattern: '*api.sr.se/api/rss/program/*', requestStage: 'Request' }, { urlPattern: '*api.sr.se/api/rss/program/*', requestStage: 'Response' });
  if (patterns.length) await send('Fetch.enable', { patterns });
  else await send('Fetch.disable');
  mock = mockMM;
  touchMode = mobile;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 });
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await send('Emulation.setUserAgentOverride', { userAgent: ua || (await send('Browser.getVersion')).result.userAgent });
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
      // 播放栏的按钮只有图标（和语速、女 / 男这样的一两个字）：没有说明文字，按钮里的东西不截断
      cutText: [...document.querySelectorAll('#player button')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.id),
      labels: document.querySelectorAll('#player .lbl').length,
      faces: [...document.querySelectorAll('#player button')].map((b) => b.innerText.trim()),
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
// 选话题：电脑上点话题按钮；手机上用标题旁边的下拉菜单（系统自己的选择器在无头里点不开：改它的值、发 change，和选了一样）
async function pickTopic(key) {
  if (await evalJs(`!!document.querySelector('#topics .chip[data-topic="${key}"]')?.offsetParent`)) {
    const c = await center(`#topics .chip[data-topic="${key}"]`);
    await tap(c.x, c.y);
    return;
  }
  await evalJs(`(() => { const s = document.querySelector('#topicSel'); s.value = ${JSON.stringify(key)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
// 顶栏（标题、话题菜单、「← 列表」、工具按钮）：排成几行、有没有出屏或横向溢出、有没有截字；
// 话题菜单里哪些话题的名字放不下（末尾是省略号）
async function headerFit() {
  return evalJs(`(() => { const de = document.documentElement;
    const items = [...document.querySelectorAll('header.top .brand, header.top .topic-sel, header.top .back-btn, header.top .tools')].filter((e) => e.offsetParent);
    const rs = items.map((e) => e.getBoundingClientRect());
    const mids = rs.map((r) => (r.top + r.bottom) / 2);
    const rows = mids.filter((m, i) => mids.findIndex((x) => Math.abs(x - m) < 10) === i).length;
    const sel = document.querySelector('#topicSel');
    let selCut = [];
    if (sel.offsetParent) {
      const cs = getComputedStyle(sel);
      const room = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const sp = document.createElement('span');
      sp.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + cs.font;
      document.body.append(sp);
      selCut = [...sel.options].filter((o) => { sp.textContent = o.textContent; return sp.getBoundingClientRect().width > room + 0.5; }).map((o) => o.textContent);
      sp.remove();
    }
    return { rows, overflow: de.scrollWidth > de.clientWidth || rs.some((r) => r.left < -0.5 || r.right > de.clientWidth + 0.5),
      clipped: [...document.querySelectorAll('header.top button')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.id || e.className),
      items: items.map((e) => e.id || e.className.split(' ')[0]), selCut, height: Math.round(document.querySelector('header.top').getBoundingClientRect().height) }; })()`);
}
// 文章开头那一行：来源（「Sveriges Radio · 节目」，手机上「SR · 节目」）、时间、「原文 ↗」；排成几行、出没出屏；
// 文章末尾还有没有来源、版权那一段
// 文章开头那一行应当写的来源：「Sveriges Radio · 节目」（short：很窄的手机上「SR · 节目」）；新闻源里没有节目名时只有 Sveriges Radio
const srcWant = (program, short) => (short ? 'SR' : 'Sveriges Radio') + (program && program !== 'Sveriges Radio' ? ' · ' + program : '');
// 用键盘（Shift+Tab）把焦点移到标题「瑞典语读报」上（从它后面那个看得见的「← 返回列表」或话题菜单退回来），这时是键盘的焦点（:focus-visible）
async function tabToTitle() {
  await evalJs(`(() => { const n = [...document.querySelectorAll('#btnBack, #topicSel')].find((e) => e.offsetParent); if (n) n.focus(); })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8 });
  await sleep(100);
  return evalJs(`(() => { const b = document.querySelector('#brand'); let fv = false; try { fv = b.matches(':focus-visible'); } catch (e) {} return document.activeElement === b && fv; })()`);
}
async function pressKey(key, code, vk) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(150);
}
async function srcLine() {
  return evalJs(`(() => { const m = document.querySelector('#article .meta'); if (!m) return null;
    const vis = (e) => !!e && e.getClientRects().length > 0;
    const s = m.querySelector('.src-line'); const a = [...m.querySelectorAll('a')].find((x) => /原文/.test(x.textContent));
    const rs = [...m.children].filter(vis).map((e) => e.getBoundingClientRect());
    const mids = rs.map((r) => (r.top + r.bottom) / 2);
    const art = document.querySelector('#article');
    return { text: s ? s.innerText.replace(/\\s+/g, ' ').trim() : '', link: a ? a.getAttribute('href') : '', rows: mids.filter((y, i) => mids.findIndex((z) => Math.abs(z - y) < 8) === i).length,
      right: Math.round(Math.max(...rs.map((r) => r.right))), vw: document.documentElement.clientWidth, footer: !!art.querySelector('.src'),
      copyright: /版权|不保存|来源：|原声/.test(art.textContent), todayBadge: !!m.querySelector('.badge.today'), metaText: m.innerText.replace(/\\s+/g, ' ').trim() }; })()`);
}
// 回到列表：电脑上点「← 返回列表」，手机上点标题「瑞典语读报」（手机的文章页上没有「← 列表」）
async function toList() {
  if ((await state()).view !== 'article') return true;
  if (!(await clickButtonText('#btnBack', '列表'))) { const b = await center('#brand'); await tap(b.x, b.y); }
  return waitFor(`SVApp.state().view === 'list'`, 5000);
}
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

// 每个按钮都要有瑞典文提示：data-sv 是瑞典文（有拉丁字母、没有汉字），title 的第一行就是它
async function tipAudit() {
  return evalJs(`(() => {
    const all = [...document.querySelectorAll('button')];
    const bad = all.filter((b) => {
      const sv = b.dataset.sv || '';
      return !sv || /[\\u3400-\\u9fff]/.test(sv) || !/[A-Za-zÅÄÖåäö]/.test(sv) || !(b.title || '').startsWith(sv);
    }).map((b) => (b.id ? '#' + b.id : '') + '「' + b.textContent.trim().slice(0, 12) + '」');
    return { n: all.length, bad };
  })()`);
}
async function longPress(x, y, ms = 800) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(ms);
}
const svTip = () => evalJs(`(() => { const t = document.querySelector('.svtip'); if (!t || t.hidden) return null; const r = t.getBoundingClientRect(); const de = document.documentElement;
  return { text: t.innerText.replace(/\\n/g, ' / '), inView: r.left >= 0 && r.top >= 0 && r.right <= de.clientWidth + 0.5 && r.bottom <= innerHeight + 0.5, inDialog: !!t.closest('dialog[open]') }; })()`);

// ================= 6、7. 翻译：微软翻译（假的 /translate）、按这一句选词义 =================
// 每一轮先清掉翻译的缓存（单词、句子）和微软翻译的额度记录
const CLEAR_TR = `try { localStorage.removeItem('sv.trw.v1'); localStorage.removeItem('sv.az.v1'); sessionStorage.removeItem('sv.trs.v1'); } catch (e) {}`;
// 文章里的每个词：在「#article .w」里的序号、第几句、小词典里几个意思、能不能挑（js/sense.js 规则 1）、每个意思的中文词
const articleWords = () => evalJs(`[...document.querySelectorAll('#article .w')].map((w, i) => {
  const sEl = w.closest('.s'); const gl = SV.glossary.lookup(w.textContent); const ss = SV.sense.senses(gl);
  return { i, si: +sEl.dataset.si, text: w.textContent, gl: !!gl, n: ss.length, pickable: SV.sense.pickable(gl, ss), keys: ss.map((x) => x.keys) };
})`);
const sentenceText = (si) => evalJs(`document.querySelectorAll('#article .s')[${si}].textContent`);
// 弹出框现在的样子；wordI：查的词在「#article .w」里的序号（看弹出框盖没盖住它）
const popState = (wordI = -1) => evalJs(`(() => { const p = document.querySelector('#popup'); if (p.hidden) return null; const r = p.getBoundingClientRect(); const de = document.documentElement;
  const ss = [...p.querySelectorAll('.gl .sense')]; const best = ss.filter((x) => x.classList.contains('best')); const c = p.querySelector('.ctxs');
  const w = ${wordI} >= 0 ? document.querySelectorAll('#article .w')[${wordI}].getBoundingClientRect() : null;
  return { word: p.querySelector('.pw b') ? p.querySelector('.pw b').textContent : '', rect: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10),
    senses: ss.map((x) => (x.firstChild ? x.firstChild.textContent : '')), best: best.map((x) => ss.indexOf(x)), bestTitle: best[0] ? best[0].title : '',
    ctxs: !!c && !c.hidden, why: c ? c.dataset.why : null, sentence: c ? c.textContent : '', key: c && c.querySelector('.key') ? c.querySelector('.key').textContent : '',
    mt: p.querySelector('.mt') ? p.querySelector('.mt').textContent : '', mtNode: !!p.querySelector('.mt'), eng: p.querySelector('.eng') ? p.querySelector('.eng').textContent : '',
    err: !!p.querySelector('.err'), sentBtn: (p.querySelector('.acts button.primary') || {}).textContent === '本句译文', sentBox: !!p.querySelector('.sent') && !p.querySelector('.sent').hidden,
    sentBoxText: p.querySelector('.sent') ? p.querySelector('.sent').textContent : '',
    covers: !!w && !(r.bottom <= w.top || r.top >= w.bottom || r.right <= w.left || r.left >= w.right),
    onScreen: r.left >= 0 && r.top >= 0 && r.right <= de.clientWidth + 0.5 && r.bottom <= innerHeight + 0.5 }; })()`);
// 弹出框里的结果都回来了（整句译文的格子不是「正在…」，译文不是「翻译中…」）
const popSettled = (ms = 6000) => waitFor(`(() => { const p = document.querySelector('#popup'); if (p.hidden) return false; const c = p.querySelector('.ctxs'); const m = p.querySelector('.mt');
  return (!c || c.dataset.why !== 'wait') && (!m || !m.classList.contains('wait')); })()`, ms, 100);
const closePop = () => evalJs(`document.querySelector('#popup').hidden || document.querySelector('#main').click()`);
// 点一个词。模拟的触摸偶尔不产生点击（CDP 的问题，2026-11-13 在一篇文章上见过一次）：一秒内没有这个词的弹出框，
// 就直接在词上发一次点击，并在输出里写一行「提示」，不悄悄地算过
let tapRetries = 0;
const clickW = async (w) => {
  const c = await center('#article .w', w.i);
  await tap(c.x, c.y);
  const ok = await waitFor(`!document.querySelector('#popup').hidden && document.querySelector('#popup .pw b').textContent === ${JSON.stringify(w.text)}`, 1000, 50);
  if (!ok) {
    tapRetries++;
    console.log(`  提示：点「${w.text}」没有打开弹出框，改用直接点击（第 ${tapRetries} 次）`);
    await evalJs(`document.querySelectorAll('#article .w')[${w.i}].click()`);
  }
};
// 直接在那个词上发一次点击（弹出框可能正好盖住它，真的点下去会点到弹出框上）
const clickWDirect = (w) => evalJs(`document.querySelectorAll('#article .w')[${w.i}].click()`);
// 下划线的样子：意思的、整句译文里的
const underlineStyle = (sel) => evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; const c = getComputedStyle(b);
  return { line: c.textDecorationLine, color: c.textDecorationColor, skip: c.textDecorationSkipInk }; })()`);
const setDark = (on) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] });
// 页面里的钟往后拨（看「30 秒里不再问」）
const shiftTime = (ms) => evalJs(`(() => { if (!window.__realNow) { window.__realNow = Date.now.bind(Date); window.__timeOff = 0; } window.__timeOff += ${ms}; Date.now = () => window.__realNow() + window.__timeOff; })()`);
// 找一篇有好几句带「能挑的词」、也有不能挑的多义词的文章（每个测试用一个新的句子，译文还没缓存）：
// 先在今日要闻这一批里找，没有就换几个话题
// freshSi：还要有这么多句，里面有小词典里没有的词（查词的测试用）
async function articleWithSenses(need, freshSi = 0) {
  for (const topic of ['idag', 'sverige', 'politik', 'varlden', 'ekonomi']) {
    if (topic !== 'idag' || (await state()).topic !== 'idag') {
      await pickTopic(topic);
      if (!(await waitFor(listReady(topic), 40000))) continue;
    }
    const n = (await state()).batch.length;
    for (let k = 0; k < n; k++) {
      if (!(await openFirstCard(k))) continue;
      const pool = await articleWords();
      const sis = new Set(pool.filter((x) => x.pickable).map((x) => x.si));
      const fsi = new Set(pool.filter((x) => !x.gl && x.text.length >= 4 && /^\p{L}+$/u.test(x.text)).map((x) => x.si));
      if (sis.size >= need && fsi.size >= freshSi && pool.some((x) => x.n >= 2 && !x.pickable)) return pool;
      await toList();
    }
  }
  return null;
}
function wordPicker(pool) {
  const usedText = new Set(['kommunen', 'grattis']); // 这两个词在第 6 轮开始时已经放进单词的缓存
  const usedSi = new Set();
  return {
    // 小词典里没有的词（每次一个新的，免得用到单词的缓存）；newSentence：还要在一个没用过的句子里（句子的译文还没缓存）
    fresh(newSentence = false) {
      const w = pool.find((x) => !x.gl && x.text.length >= 4 && /^\p{L}+$/u.test(x.text) && !usedText.has(x.text.toLowerCase()) && (!newSentence || !usedSi.has(x.si)));
      if (w) { usedText.add(w.text.toLowerCase()); if (newSentence) usedSi.add(w.si); }
      return w;
    },
    // 能挑的词，每次在一个新的句子里
    pickable() { const w = pool.find((x) => x.pickable && !usedSi.has(x.si)); if (w) usedSi.add(w.si); return w; },
    // 有几个意思、但不能挑的词（有单字或括号说明的意思），在一个新的句子里
    // 先找没有能挑的词的句子：免得用掉能挑的词的句子，后面的 pickable() 不够用（看当天的文章，以前偶尔会这样）
    unpickable() {
      const ok = (x) => x.n >= 2 && !x.pickable && !usedSi.has(x.si);
      const w = pool.find((x) => ok(x) && !pool.some((y) => y.si === x.si && y.pickable)) || pool.find(ok);
      if (w) usedSi.add(w.si);
      return w;
    },
    single() { return pool.find((x) => x.gl && x.n === 1); },
  };
}
const brief = (ps) => (ps ? JSON.stringify({ word: ps.word, senses: ps.senses, best: ps.best, why: ps.why, sentence: ps.sentence, key: ps.key, mt: ps.mt, eng: ps.eng, rect: ps.rect }) : '没有弹出框');
const azLast = () => azRequests[azRequests.length - 1] || null;

async function translationChecks() {
  // ---------- 6. 电脑 ----------
  console.log('\n== 6. 电脑 1600×900：微软翻译（假的 /translate）、按这一句选词义、翻译的顺序');
  azMode = 'ok'; azPlan = {}; azDelay = 0; mmMode = 'ok';
  // 单词的缓存先放两个：微软翻译给的「Grattis →『祝贺！』」（新的格式，记着来源），以前的版本存的 MyMemory 字幕（只有一个字符串）
  const SEED = CLEAR_TR + ` try { localStorage.setItem('sv.trw.v1', JSON.stringify({ grattis: { z: '祝贺！', e: 'azure' }, kommunen: '市长办公厅的人能够相信吗?' })); } catch (e) {}`;
  check('翻译：页面打开（假的内置翻译、假的微软翻译）', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, fakeTranslator: true, mockMM: true, cloud: true, initJs: SEED }));
  check('翻译：微软翻译的地址跟着令牌服务走（js/config.js）', (await evalJs('SV.config.translateUrl')) === 'https://svtts.test/translate' && (await evalJs('SV.tr.azureState()')) === 'ok');

  // 按这一句选词义的规则（更多的例子在 tests/sense_eval.mjs）：审查找到的例子，HTML 是真的微软翻译给这几句编的句子的回答
  const u = await evalJs(`(() => {
    const T = (sv, wi, html) => SV.sense.inSentence(sv, wi, html);
    return {
      de: T('De svenska spelarna säger att laget vann.', 0, null), var: T('Det var svårt för alla.', 1, null), for: T('Priset är för högt på grund av kriget.', 2, null),
      skota: T('Hon ansvarar för att sköta barnen.', 4, '她 <b>负责照顾孩子们</b> 。'),
      far: T('Regeringen får kritik för att företag kan undvika skatt.', 1, '政府因企业能够逃税而 <b>受到</b> 批评。'),
      svenska: T('Det svenska folket röstade.', 1, '<b>瑞典</b>人就在这座城市里。'),
      dom: T('Domen föll i tingsrätten i går.', 0, '该<b>判决</b>于昨天在地区法院作出。'),
    };
  })()`);
  check('选词义：有单字或括号说明的意思的词不挑（De 是复数定冠词、var 是「是」、för 是「太」时，以前会画错）', !u.de.pickable && !u.var.pickable && !u.for.pickable, JSON.stringify([u.de, u.var, u.for]));
  check('选词义：小词典外的词译出了某个意思（ansvarar →「负责」）、词的一部分（瑞典 ⊂ 瑞典人民）：不画', u.skota.index === -1 && u.svenska.index === -1, JSON.stringify([u.skota, u.svenska]));
  check('选词义：微软把标签放在「受到」上：får 是「得到、受到」（以前画了「可以」）；标签在「判决」上：dom 是「判决」', u.far.best === '得到、受到' && u.dom.best === '判决', JSON.stringify([u.far, u.dom]));
  // 微软的 HTML 译文里的实体全部还原成文字（浏览器里用 DOMParser，只取文字），标签那样的东西也只是文字
  const ent = await evalJs(`(() => { const r = SV.sense.parseTagged('这&hellip;&eacute;&#8212;&ndash;&copy;&nbsp;<b>局势</b>&lt;img src=x onerror=alert(1)&gt;&amp;'); return { text: r.text, tag: r.text.slice(r.tag.start, r.tag.end) }; })()`);
  check('解析：所有实体都还原（&hellip; &eacute; &#8212; &ndash; &copy;），转义的标签还是文字', ent.text === '这…é—–©局势<img src=x onerror=alert(1)>&' && ent.tag === '局势', JSON.stringify(ent));
  // MyMemory 给单词的「译文」：字幕不当译文显示
  const junk = await evalJs(`[['kommunen', '市长办公厅的人能够相信吗?'], ['fick', '线路安全 好了'], ['rätt', '- 对，没错。\\n- 好吧。'], ['Hej', 'Hello there, how are you doing today my friend'], ['kommunen', '市长办公厅的人能够相信他们说的那些话']].map(([a, b]) => SV.tr.unreliable(a, b))`);
  const fine = await evalJs(`[['läget', '你好'], ['kommunen', '市政府'], ['arbetsmarknadsdepartementet', '劳动力市场部'], ['Kristersson', 'Kristersson'], ['inte längre', '不再'], ['både', '既……又……']].map(([a, b]) => SV.tr.unreliable(a, b))`);
  check('MyMemory 的字幕：带问号、汉字中间有空格、对话（破折号、分行）、太长的不当译文', junk.every(Boolean), JSON.stringify(junk));
  check('MyMemory 的字幕：正常的译文照常显示（「你好」这样短而错的认不出来）', fine.every((x) => !x), JSON.stringify(fine));
  // 单词的缓存：以前的版本存的字符串还查字幕；现在记下了是哪个翻译给的，微软翻译、内置翻译的（Grattis →「祝贺！」）不查
  let nc = azRequests.length;
  const cg = await evalJs(`SV.tr.translate('Grattis', 'word', { online: true, gesture: true }).then((r) => r.engine + '/' + r.zh)`);
  check('单词的缓存：微软翻译给的「祝贺！」照常用（不当成 MyMemory 的字幕，不再请求）', cg === 'cache/祝贺！' && azRequests.length === nc, cg);
  const ck = await evalJs(`SV.tr.translate('kommunen', 'word', { online: true, gesture: true }).then((r) => r.engine + '/' + r.zh)`);
  check('单词的缓存：以前的版本存的字幕（不知道来源）丢掉重查', ck === 'azure/〔微软〕kommunen' && azRequests.length === nc + 1, ck);
  const stored = await evalJs(`JSON.parse(localStorage.getItem('sv.trw.v1')).kommunen`);
  check('单词的缓存：新存的记着是哪个翻译给的', stored && stored.e === 'azure' && stored.z === '〔微软〕kommunen', JSON.stringify(stored));

  const pool = await articleWithSenses(7); // 六次 pickable() 和一次 unpickable() 各用掉一句：要七句（只要六句时，看当天的文章偶尔不够）
  check('翻译：找到一篇有七句以上带「能挑的词」、也有不能挑的多义词的文章', !!pool, pool ? (await state()).title : '几个话题里都没有');
  if (!pool) return;
  const pick = wordPicker(pool);

  // 小词典里没有的词：只发这个词给微软翻译
  let w = pick.fresh();
  let n0 = azRequests.length;
  await clickW(w);
  await popSettled();
  let ps = await popState();
  check('翻译：小词典里没有的词，用微软翻译，只发这个词', ps && ps.mt === '〔微软〕' + w.text && ps.eng === '微软翻译' && azRequests.length === n0 + 1 && JSON.stringify(azRequests[n0]) === JSON.stringify([w.text]), brief(ps));
  await shot('desktop-azure-word');
  await closePop();
  // 只有一个意思：直接显示，不自动翻整句
  const one = pick.single();
  n0 = azRequests.length;
  await clickW(one);
  await sleep(700);
  ps = await popState();
  check('翻译：小词典里只有一个意思：直接显示，不自动翻整句，不发请求', ps && ps.word === one.text && ps.senses.length === 1 && !ps.ctxs && !ps.mtNode && azRequests.length === n0, brief(ps));
  await closePop();

  // 能挑、确定：意思和整句译文里这个词的译文都画下划线
  const wU = pick.pickable();
  const keyU = wU.keys[0][0];
  azPlan = { tag: keyU };
  azDelay = 900;
  n0 = azRequests.length;
  await clickW(wU);
  await sleep(250);
  const before = await popState(wU.i);
  await popSettled();
  const after = await popState(wU.i);
  const sentU = await sentenceText(wU.si);
  check('翻译：有几个意思的词，意思马上全部列出来，下面先占好整句译文的地方（「正在翻译这一句…」）', before && before.why === 'wait' && before.ctxs && /正在翻译这一句/.test(before.sentence) && before.senses.length === wU.n && !before.best.length, brief(before));
  const tagReq = azRequests[n0];
  check('翻译：能挑的词，请微软翻译把整句当 HTML 翻，这个词包在 <b> 里（一次）', azRequests.length === n0 + 1 && tagReq && tagReq.html && tagReq[0].includes('<b>' + wU.text + '</b>') && tagReq[0].replace(/<\/?b>/g, '') === sentU.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), JSON.stringify(tagReq));
  check('翻译：确定（标签里正好是一个意思的词）：意思画下划线（title「符合这句的意思」），整句译文自动显示，里面这个词的译文也画下划线',
    after && after.best.length === 1 && after.best[0] === 0 && after.bestTitle === '符合这句的意思' && after.why === 'match' && after.key === keyU && after.sentence === '这句' + keyU + '测试译文。', `${wU.text}「${keyU}」 ${brief(after)}`);
  check('翻译：结果来了，弹出框不跳、不变大小、意思不换顺序，没盖住这个词', before && after && JSON.stringify(before.rect) === JSON.stringify(after.rect) && JSON.stringify(before.senses) === JSON.stringify(after.senses) && !after.covers, `${JSON.stringify(before && before.rect)} → ${JSON.stringify(after && after.rect)}`);
  check('翻译：读屏软件听得到「符合这句的意思」', await evalJs(`(document.querySelector('#popup .sense.best .sr') || {}).textContent === '（符合这句的意思）'`));
  await setDark(false);
  const ulL = [await underlineStyle('#popup .sense.best'), await underlineStyle('#popup .ctxs .key')];
  check('浅色：两个下划线都是蓝色（--sense）、一整条', ulL.every((x) => x && /underline/.test(x.line) && x.color === 'rgb(21, 101, 192)' && x.skip === 'none'), JSON.stringify(ulL));
  await shot('desktop-sense-certain');
  await setDark(true);
  await sleep(150);
  const ulD = [await underlineStyle('#popup .sense.best'), await underlineStyle('#popup .ctxs .key')];
  check('深色：两个下划线都是浅蓝色，和正在读的词的黄色不一样', ulD.every((x) => x && /underline/.test(x.line) && x.color === 'rgb(100, 181, 246)'), JSON.stringify(ulD));
  await shot('desktop-sense-certain-dark');
  await setDark(false);
  azDelay = 0;
  n0 = azRequests.length;
  const rectF = (await popState()).rect;
  await clickButtonText('#popup .acts button', '本句译文');
  await sleep(300);
  const flashed = await evalJs(`document.querySelector('#popup .ctxs').classList.contains('flash')`);
  ps = await popState();
  check('翻译：整句译文已经在上面了，再点「本句译文」：那一格闪一下，不再发请求、不重复显示，弹出框不变', ps && flashed && azRequests.length === n0 && !ps.sentBox && ps.ctxs && JSON.stringify(ps.rect) === JSON.stringify(rectF), `${flashed} ${brief(ps)}`);
  await sleep(900);
  check('翻译：闪一下就好（过一会儿底色还原）', !(await evalJs(`document.querySelector('#popup .ctxs').classList.contains('flash')`)));
  await closePop();
  // 同一句里别的只有一个意思的词：「本句译文」用刚才拿到的整句译文，不再花额度
  const sameSi = pool.find((x) => x.si === wU.si && x.gl && x.n === 1);
  if (sameSi) {
    n0 = azRequests.length;
    await clickW(sameSi);
    await sleep(300);
    await clickButtonText('#popup .acts button', '本句译文');
    await sleep(300);
    ps = await popState();
    check('翻译：同一句里别的词点「本句译文」，用已经拿到的整句译文（不再发请求）', ps && ps.sentBoxText === '这句' + keyU + '测试译文。' && azRequests.length === n0, brief(ps));
    await closePop();
  }

  // 能挑、不确定（平手，鼠标停在词上）：整句译文照样自动显示，不画
  const wT = pick.pickable();
  azPlan = { tag: wT.keys[0][0] + wT.keys[1][0] };
  azDelay = 300;
  const cT = await center('#article .w', wT.i);
  await hover(cT.x, cT.y);
  await waitFor(`!document.querySelector('#popup').hidden && document.querySelector('#popup .pw b').textContent === ${JSON.stringify(wT.text)}`, 3000, 100);
  await popSettled();
  ps = await popState(wT.i);
  check('翻译：鼠标停在词上也一样；两个意思都在标签里（不确定）：整句译文自动显示，意思和译文里都不画', ps && ps.word === wT.text && !ps.best.length && ['tie', 'wide'].includes(ps.why) && ps.ctxs && !ps.key && ps.sentence.includes('测试译文') && !ps.covers, brief(ps));
  await shot('desktop-sense-uncertain-hover');
  await setDark(true);
  await sleep(150);
  await shot('desktop-sense-uncertain-dark');
  await setDark(false);
  await hover(5, 880);
  await sleep(800);
  // 标签盖住的字太多：不画
  const wW = pick.pickable();
  azPlan = { tag: wW.keys[0][0] + '仍然是' };
  azDelay = 0;
  await clickW(wW);
  await popSettled();
  ps = await popState();
  // 太宽（'wide'）；如果别的意思的词正好也在里面（没有 ⊂ 没有人），就是平手（'tie'）：都是拿不准
  check('翻译：标签比意思的词多三个字（太宽）：不画，整句照样显示', ps && !ps.best.length && ['wide', 'tie'].includes(ps.why) && ps.ctxs && !ps.key, brief(ps));
  await closePop();
  // 有几个意思、但不能挑的词：只要普通的整句译文，自动显示，不画
  const wP = pick.unpickable();
  azPlan = { add: '普通' };
  n0 = azRequests.length;
  await clickW(wP);
  await popSettled();
  ps = await popState();
  check('翻译：有几个意思但不能挑的词（有单字或括号说明的意思）：发普通的整句，自动显示，不画', ps && ps.why === 'plain' && ps.ctxs && !ps.best.length && ps.sentence === '这句普通测试译文。' && azRequests.length === n0 + 1 && !azRequests[n0].html, `${wP.text} ${brief(ps)}`);
  await closePop();
  azPlan = {};
  // 结果回来时弹出框已经换到别的词：真的没放进去（senseApplied 不变；去掉 fillSentence 里对 pop.token 的检查，这一项就过不了）
  const wS = pick.pickable();
  azPlan = { tag: wS.keys[0][0] };
  azDelay = 1500;
  let applied0 = (await state()).senseApplied;
  await clickW(wS);
  await sleep(250);
  await clickWDirect(one);
  await sleep(1900);
  ps = await popState();
  check('翻译：结果回来时弹出框已经换到别的词：不放进去（计数不变），新的弹出框没有下划线', ps && ps.word === one.text && !ps.best.length && !ps.ctxs && (await state()).senseApplied === applied0, `${brief(ps)} 计数 ${applied0} → ${(await state()).senseApplied}`);
  await closePop();
  const wS2 = pick.pickable();
  azPlan = { tag: wS2.keys[0][0] };
  azDelay = 1200;
  applied0 = (await state()).senseApplied;
  await clickW(wS2);
  await sleep(250);
  await closePop();
  await sleep(1500);
  check('翻译：结果回来时弹出框已经关了：不放进去，也不再打开', await evalJs(`document.querySelector('#popup').hidden`) && (await state()).senseApplied === applied0);
  azDelay = 0;
  azPlan = {};

  // ---------- 翻译的顺序：微软翻译 → 内置翻译 ----------
  azMode = 'down';
  w = pick.fresh();
  n0 = azRequests.length;
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('翻译的顺序：微软翻译连不上：这一次用浏览器内置翻译', ps && ps.mt === '〔内置〕' + w.text && ps.eng === '浏览器内置翻译' && azRequests.length === n0 + 1, brief(ps));
  await closePop();
  azMode = 'ok';
  w = pick.fresh();
  n0 = azRequests.length;
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('翻译的顺序：连不上以后 30 秒里不再问微软翻译（不发请求），用内置翻译', ps && azRequests.length === n0 && ps.mt === '〔内置〕' + w.text && (await evalJs('SV.tr.azureState()')) === 'network', brief(ps));
  await closePop();
  await shiftTime(31000);
  w = pick.fresh();
  n0 = azRequests.length;
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('翻译的顺序：30 秒以后又先问微软翻译', ps && ps.mt === '〔微软〕' + w.text && azRequests.length === n0 + 1, brief(ps));
  await closePop();
  // 8 秒没回答：超时，这一次用内置翻译，也停 30 秒
  azDelay = 9000;
  w = pick.fresh();
  const t0 = Date.now();
  await clickW(w);
  await popSettled(15000);
  const waited = Date.now() - t0;
  ps = await popState();
  check('翻译的顺序：微软翻译 8 秒没回答：不再等，这一次用内置翻译，30 秒里不再问', ps && ps.mt === '〔内置〕' + w.text && waited >= 7500 && waited < 12000 && (await evalJs('SV.tr.azureState()')) === 'network', `等了 ${waited} 毫秒 ${brief(ps)}`);
  await closePop();
  azDelay = 0;
  await sleep(1500); // 让被放弃的那个假请求也回答完
  await shiftTime(31000);
  azMode = 'quota';
  w = pick.fresh();
  await clickW(w);
  await popSettled();
  ps = await popState();
  const mark = await evalJs(`(() => { try { return JSON.parse(localStorage.getItem('sv.az.v1')); } catch (e) { return null; } })()`);
  const left = mark ? mark.until - (await evalJs('Date.now()')) : 0;
  check('翻译的顺序：微软翻译的免费额度用完：用内置翻译，下面写着额度用完了', ps && ps.mt === '〔内置〕' + w.text && ps.eng === '浏览器内置翻译（微软翻译的免费额度用完了）', brief(ps));
  check('翻译的顺序：记住 6 小时里不再问微软翻译（localStorage 的 sv.az.v1）', left > 6 * 3600e3 - 120e3 && left <= 6 * 3600e3 + 5e3, `还有 ${Math.round(left / 60000)} 分钟`);
  await shot('desktop-quota-builtin');
  await closePop();
  azMode = 'ok';
  w = pick.fresh();
  n0 = azRequests.length;
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('翻译的顺序：额度用完以后不再问微软翻译（不发请求）', ps && azRequests.length === n0 && ps.mt === '〔内置〕' + w.text && /额度用完/.test(ps.eng), brief(ps));
  await closePop();
  // 能挑的词：微软翻译用不了时，整句用内置翻译，不画
  const wB = pick.pickable();
  await clickW(wB);
  await popSettled();
  ps = await popState();
  check('翻译：微软翻译用不了时，能挑的词也只显示内置翻译给的整句，不画（内置翻译不会放标签）', ps && ps.ctxs && ps.why === 'plain' && ps.sentence.startsWith('〔内置〕') && !ps.best.length, brief(ps));
  await closePop();
  const sb = await center('#btnSettings');
  await tap(sb.x, sb.y);
  await sleep(400);
  const setT = await evalJs(`({ note: document.querySelector('#trNote').textContent, label: document.querySelector('#chkOnline').parentElement.textContent })`);
  check('设置：说明微软翻译的免费额度用完了；在线翻译的开关只管 MyMemory', /微软翻译的免费额度用完了/.test(setT.note) && /MyMemory/.test(setT.label) && /微软翻译的免费额度用完/.test(setT.label), JSON.stringify(setT));
  await shot('desktop-settings-translate');
  await evalJs(`document.querySelector('#dlgSettings').close()`);

  // ---------- 在线翻译（MyMemory）关着、内置翻译要点一下才能下载：微软翻译和内置翻译照样用，MyMemory 不用；点的人不被鼠标停着的那次拖累 ----------
  console.log('\n== 6b. 电脑：在线翻译关着、内置翻译要下载');
  azMode = 'ok'; azPlan = {}; azDelay = 0; mmMode = 'ok';
  const OFF = CLEAR_TR + ` window.__trAvail = 'downloadable'; try { localStorage.setItem('sv.settings.v1', JSON.stringify({ online: false, v: 3, topic: 'idag', tip: false })); } catch (e) {}`;
  check('关着：页面打开（MyMemory 关着，内置翻译要下载）', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, fakeTranslator: true, mockMM: true, cloud: true, initJs: OFF }));
  check('关着：设置里在线翻译是关的', (await state()).settings.online === false);
  const poolB = await articleWithSenses(2);
  if (!poolB) { check('关着：找到文章', false); return; }
  const pickB = wordPicker(poolB);
  const mm0 = mmRequests.length;
  w = pickB.fresh();
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('关着：小词典里没有的词照样用微软翻译', ps && ps.mt === '〔微软〕' + w.text, brief(ps));
  await closePop();
  // 鼠标停在一个有几个意思的词上（不能下载模型），微软翻译慢、最后连不上；这时点「本句译文」：
  // 微软翻译那一步共用一个请求，连不上以后，点的这一次自己去下载内置翻译的模型，用它翻这一句
  const wD = pickB.unpickable();
  azMode = 'down';
  azDelay = 2500;
  n0 = azRequests.length;
  const cD = await center('#article .w', wD.i);
  await hover(cD.x, cD.y);
  await waitFor(`!document.querySelector('#popup').hidden && document.querySelector('#popup .pw b').textContent === ${JSON.stringify(wD.text)}`, 3000, 100);
  await sleep(400);
  const creates0 = await evalJs('window.__trCreates');
  await clickButtonText('#popup .acts button', '本句译文');
  await waitFor(`(() => { const c = document.querySelector('#popup .ctxs'); return c && !c.hidden && /〔内置〕/.test(c.textContent); })()`, 8000, 100);
  ps = await popState();
  check('关着：鼠标停着开始翻的一句，接着点了「本句译文」：微软翻译只问一次，连不上以后点的那次下载内置翻译的模型来翻（不会被鼠标停着的那次拖累）',
    ps && /^〔内置〕/.test(ps.sentence) && azRequests.length === n0 + 1 && (await evalJs('window.__trCreates')) > creates0 && !/点一下这个词/.test(ps.sentence), `${brief(ps)} 请求 ${azRequests.length - n0} 次，下载 ${creates0} → ${await evalJs('window.__trCreates')}`);
  await hover(5, 880);
  await sleep(800);
  azDelay = 0;
  await shiftTime(31000);
  azMode = 'down';
  w = pickB.fresh();
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('关着：微软翻译连不上：用内置翻译', ps && ps.mt === '〔内置〕' + w.text, brief(ps));
  await closePop();
  check('关着：一次也没有问 MyMemory', mmRequests.length === mm0, `${mmRequests.length - mm0} 次`);
  azMode = 'ok';

  // ---------- Worker 的设置不对（403、404、405、500、Azure 的密钥不对）：这次打开的页面里不再问 ----------
  console.log('\n== 6c. Worker 的设置不对');
  for (const mode of ['status:403', 'status:404', 'status:405', 'status:500', 'azure401']) {
    azMode = mode;
    const okOpen = await openPage({ width: 1200, height: 800, mobile: false, fakeSpeech: true, fakeTranslator: true, mockMM: true, cloud: true, initJs: CLEAR_TR });
    n0 = azRequests.length;
    const r1 = await evalJs(`SV.tr.translate('provord' + Math.random().toString(36).slice(2, 6), 'word', { online: true, gesture: true }).then((r) => r.engine + '/' + r.azure, (e) => 'ERR ' + e.code)`);
    const st = await evalJs('SV.tr.azureState()');
    azMode = 'ok';
    const r2 = await evalJs(`SV.tr.translate('annatord' + Math.random().toString(36).slice(2, 6), 'word', { online: true, gesture: true }).then((r) => r.engine, (e) => 'ERR ' + e.code)`);
    check(`设置不对（${mode}）：这一次用内置翻译，这次打开的页面里不再问微软翻译`, okOpen && r1 === 'builtin/broken' && st === 'broken' && r2 === 'builtin' && azRequests.length === n0 + 1, `${r1} ${st} ${r2}，请求 ${azRequests.length - n0} 次`);
  }
  azMode = 'ok';

  // ---------- 7. 手机 ----------
  console.log('\n== 7. 手机 390×844：额度用完时用 MyMemory、鼠标停着不用 MyMemory、手机上的下划线和整句译文、字幕、全都失败、太忙');
  azMode = 'ok'; azPlan = {}; azDelay = 0; mmMode = 'ok';
  const QUOTA_MARK = CLEAR_TR + ` try { localStorage.setItem('sv.az.v1', JSON.stringify({ until: Date.now() + 6 * 3600 * 1000 })); localStorage.setItem('sv.settings.v1', JSON.stringify({ online: true, v: 3, topic: 'idag' })); } catch (e) {}`;
  check('手机翻译：页面打开（没有内置翻译，微软翻译的额度用完了）', await openPage({ width: 390, height: 844, mobile: true, fakeSpeech: true, noBuiltin: true, mockMM: true, cloud: true, ua: ANDROID_UA, initJs: QUOTA_MARK }));
  const pool2 = await articleWithSenses(5, 12);
  check('手机翻译：找到一篇有五句以上带「能挑的词」的文章', !!pool2, pool2 ? (await state()).title : '这一批里没有');
  if (!pool2) return;
  const pick2 = wordPicker(pool2);
  w = pick2.fresh();
  n0 = azRequests.length;
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('手机翻译：额度用完、没有内置翻译：点词用 MyMemory，下面写着微软翻译的额度用完了，不问微软翻译',
    ps && /^【译】/.test(ps.mt) && ps.eng === 'MyMemory 在线翻译（微软翻译的免费额度用完了）' && azRequests.length === n0, brief(ps));
  await shot('phone-quota-mymemory');
  await closePop();
  // 鼠标停在词上（Tony 定的）：只剩 MyMemory 时不用它，不自动翻整句；点了才用。手机上没有鼠标，用模拟的鼠标试
  touchMode = false;
  const mmH = mmRequests.length;
  const wH = pick2.fresh(true);
  const cH = await center('#article .w', wH.i);
  await hover(cH.x, cH.y);
  await waitFor(`!document.querySelector('#popup').hidden && document.querySelector('#popup .pw b').textContent === ${JSON.stringify(wH.text)}`, 3000, 100);
  await popSettled();
  ps = await popState();
  check('鼠标停着：只剩 MyMemory 时，小词典里没有的词说「点一下这个词」，不发给 MyMemory', ps && /点一下这个词，用 MyMemory 在线翻译/.test(ps.mt) && mmRequests.length === mmH, brief(ps));
  await hover(5, 830);
  await sleep(800);
  const wHm = pick2.unpickable();
  const cHm = await center('#article .w', wHm.i);
  await hover(cHm.x, cHm.y);
  await waitFor(`!document.querySelector('#popup').hidden && document.querySelector('#popup .pw b').textContent === ${JSON.stringify(wHm.text)}`, 3000, 100);
  await sleep(600);
  ps = await popState();
  check('鼠标停着：只剩 MyMemory 时，有几个意思的词只有意思和「本句译文」，不自动翻整句，不发给 MyMemory', ps && !ps.ctxs && ps.senses.length >= 2 && mmRequests.length === mmH, brief(ps));
  touchMode = true;
  await closePop();
  await clickW(wHm);
  await popSettled();
  ps = await popState();
  check('点一下同一个词：自动显示整句，用 MyMemory（点出来的才用）', ps && ps.ctxs && /^【译】/.test(ps.sentence) && mmRequests.length === mmH + 1, brief(ps));
  await closePop();
  // 鼠标停着打开的弹出框（MyMemory 关着、微软翻译的额度用完了、没有内置翻译）里点「打开在线翻译」：
  // 点按钮就是点出来的，这一次用 MyMemory 翻译（以前用的是鼠标停着的那次的条件，马上又说「点一下这个词」）
  await evalJs(`(() => { const c = document.querySelector('#chkOnline'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  touchMode = false;
  const wO = pick2.fresh();
  const mmO = mmRequests.length;
  const cO = await center('#article .w', wO.i);
  await hover(cO.x, cO.y);
  await waitFor(`!document.querySelector('#popup').hidden && document.querySelector('#popup .pw b').textContent === ${JSON.stringify(wO.text)}`, 3000, 100);
  await popSettled();
  const psO = await popState();
  const offBtn = await evalJs(`(() => { const b = document.querySelector('#popup .mt .on-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  if (offBtn) await tap(offBtn.x, offBtn.y);
  await popSettled();
  ps = await popState();
  check('鼠标停着打开的弹出框里点「打开在线翻译」：打开 MyMemory，马上用它翻译（不再说「点一下这个词」）',
    offBtn && /在线翻译又关着/.test(psO.mt) && ps && /^【译】/.test(ps.mt) && mmRequests.length === mmO + 1 && (await state()).settings.online === true, `${psO && psO.mt} → ${ps && ps.mt}`);
  touchMode = true;
  await closePop();
  await evalJs(`localStorage.removeItem('sv.az.v1')`);
  // 手机宽度：确定（两个下划线）、不确定（只有整句），深浅两种
  const wPu = pick2.pickable();
  azPlan = { tag: wPu.keys[0][0] };
  azDelay = 600;
  await clickW(wPu);
  await sleep(200);
  const bP = await popState(wPu.i);
  await popSettled();
  const aP = await popState(wPu.i);
  check('手机翻译：确定：意思和整句译文里都画下划线，弹出框不跳、在屏幕内、不盖住这个词',
    aP && aP.best.length === 1 && aP.key === wPu.keys[0][0] && aP.onScreen && !aP.covers && bP && JSON.stringify(bP.rect) === JSON.stringify(aP.rect), `${brief(bP)} → ${brief(aP)}`);
  const cutP = await evalJs(`[...document.querySelectorAll('#popup .gl > div, #popup .acts button')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent)`);
  check('手机翻译：弹出框里没有被截断的字', !cutP.length, cutP.join('、'));
  await shot('phone-sense-certain');
  await setDark(true);
  await sleep(150);
  const ulP = await underlineStyle('#popup .ctxs .key');
  check('手机翻译：深色模式下的下划线是浅蓝色', ulP && ulP.color === 'rgb(100, 181, 246)', JSON.stringify(ulP));
  await shot('phone-sense-certain-dark');
  await setDark(false);
  await closePop();
  const wPt = pick2.pickable();
  azPlan = { tag: wPt.keys[0][0] + wPt.keys[1][0] };
  azDelay = 0;
  await clickW(wPt);
  await popSettled();
  ps = await popState(wPt.i);
  check('手机翻译：不确定（两个意思都在标签里，或者标签太宽）：整句译文自动显示、不画，弹出框在屏幕内、不盖住这个词', ps && !ps.best.length && ['tie', 'wide'].includes(ps.why) && ps.ctxs && ps.onScreen && !ps.covers, brief(ps));
  await shot('phone-sense-uncertain');
  await setDark(true);
  await sleep(150);
  await shot('phone-sense-uncertain-dark');
  await setDark(false);
  await closePop();
  // 很长的整句译文：最多 4 行，在格子里滚动
  const wL = pick2.unpickable();
  azPlan = { add: '很长的一句话'.repeat(20) };
  await clickW(wL);
  await popSettled();
  const longBox = await evalJs(`(() => { const c = document.querySelector('#popup .ctxs'); if (!c) return null; const lh = parseFloat(getComputedStyle(c).lineHeight); return { h: c.clientHeight, sh: c.scrollHeight, lines: Math.round((c.clientHeight - 6) / lh), scrolls: getComputedStyle(c).overflowY }; })()`);
  ps = await popState(wL.i);
  check('手机翻译：很长的整句译文最多占 4 行，在格子里滚动；弹出框在屏幕内、不盖住这个词', longBox && longBox.sh > longBox.h && longBox.lines <= 4 && longBox.scrolls === 'auto' && ps.onScreen && !ps.covers, JSON.stringify(longBox));
  await shot('phone-sense-long');
  await closePop();
  azPlan = {};
  // MyMemory 给单词回一句字幕
  azMode = 'down';
  mmMode = 'garbage';
  w = pick2.fresh(true);
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('手机翻译：MyMemory 给单词回一句字幕：不显示，说明没有可靠的译文，「本句译文」按钮变醒目', ps && /没有给出可靠的译文，看看「本句译文」/.test(ps.mt) && !ps.mt.includes('市长') && ps.sentBtn && ps.onScreen, brief(ps));
  await shot('phone-unreliable');
  const ob = await evalJs(`(() => { const b = document.querySelector('#popup .acts button.primary'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tap(ob.x, ob.y);
  await sleep(800);
  ps = await popState();
  check('手机翻译：点「本句译文」，显示这一句的译文', /【译】/.test(ps.sentBoxText), ps.sentBoxText);
  await closePop();
  // 全都失败：意思照样显示，不画，也不报错（整句的格子收起来）
  mmMode = 'fail';
  await shiftTime(31000);
  const wF = pick2.pickable();
  await clickW(wF);
  await popSettled(12000);
  ps = await popState();
  check('手机翻译：微软翻译和 MyMemory 都连不上：意思照样显示，不画，没有错误提示', ps && ps.why === 'fail' && !ps.ctxs && !ps.best.length && !ps.err && ps.senses.length === wF.n, brief(ps));
  await closePop();
  // 微软翻译只是暂时连不上、MyMemory 关着：先说暂时连不上，「打开在线翻译」不醒目
  mmMode = 'ok';
  await evalJs(`(() => { const c = document.querySelector('#chkOnline'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  w = pick2.fresh(true);
  await clickW(w);
  await popSettled();
  ps = await popState();
  const btnCls = await evalJs(`(document.querySelector('#popup .mt .on-btn') || {}).className || ''`);
  check('手机翻译：微软翻译暂时连不上、MyMemory 关着：说「微软翻译暂时用不了」，「打开在线翻译」只是另一个办法（不醒目）', ps && /微软翻译暂时用不了/.test(ps.mt) && btnCls === 'on-btn', `${ps && ps.mt}「${btnCls}」`);
  await shot('phone-azure-transient-off');
  await closePop();
  await evalJs(`(() => { const c = document.querySelector('#chkOnline'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  // 太忙：这一次用 MyMemory，一分钟里不再问
  await shiftTime(31000);
  azMode = 'busy';
  w = pick2.fresh();
  n0 = azRequests.length;
  await clickW(w);
  await popSettled();
  ps = await popState();
  const mark2 = await evalJs(`localStorage.getItem('sv.az.v1')`);
  check('手机翻译：微软翻译太忙（429 busy）：这一次用 MyMemory，不说额度用完，也不记 6 小时', ps && /^【译】/.test(ps.mt) && ps.eng === 'MyMemory 在线翻译' && azRequests.length === n0 + 1 && !mark2, brief(ps));
  await closePop();
  azMode = 'ok';
  w = pick2.fresh();
  n0 = azRequests.length;
  await clickW(w);
  await popSettled();
  ps = await popState();
  check('手机翻译：太忙以后一分钟里不再问微软翻译', ps && azRequests.length === n0 && /^【译】/.test(ps.mt), brief(ps));
  await closePop();
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
  let ta = await tipAudit();
  check('列表页：每个按钮都有瑞典文提示（title 第一行是瑞典文）', ta.n >= 30 && !ta.bad.length, `${ta.n} 个按钮${ta.bad.length ? '，没有的：' + ta.bad.join('、') : ''}`);
  const chipTips = await evalJs(`[...document.querySelectorAll('#topics .chip')].map((b) => b.dataset.sv)`);
  check('20 个话题按钮各有自己的瑞典文名字（「电动车」去掉了）', chipTips.length === 20 && new Set(chipTips).size === 20, chipTips.join('、'));
  const iconTip = await evalJs(`document.querySelector('#btnSettings').title`);
  check('提示是两行：瑞典文，然后是中文说明', /^Inställningar\n设置/.test(iconTip), JSON.stringify(iconTip));
  // 云端语音用的微软 Speech SDK：固定版本，完整性校验（integrity）对得上，真的能从 CDN 加载
  const sdkOk = await evalJs(`SV.cloud.loadSdk().then((s) => !!(s && s.SpeechSynthesizer && s.SpeechConfig && s.SpeechConfig.fromAuthorizationToken && s.ResultReason && s.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3 !== undefined), (e) => 'ERR ' + e.message)`);
  check('云端语音的微软 SDK 能从 CDN 加载，完整性校验通过', sdkOk === true, String(sdkOk));
  check('没有设置云端语音时用本机的声音', (await state()).engine === 'device', (await state()).engine);
  // 朗读按钮组紧跟在最后一个话题「简易瑞典语」后面，同一行，样子是立体按键，和话题按钮不一样
  // 页面开始时问过一次内置翻译（有的话不显示整页翻译的提示）；这里再问一次，等它答完
  const availStart = await evalJs('SV.tr.builtinAvailability()');
  await sleep(200);
  const ctl = await evalJs(`(() => {
    const last = document.querySelector('#topics .chip:last-child').getBoundingClientRect();
    const play = document.querySelector('#btnPlay').getBoundingClientRect();
    const chipCss = getComputedStyle(document.querySelector('#topics .chip'));
    const keyCss = getComputedStyle(document.querySelector('#btnRate'));
    return { sameRow: Math.abs((last.top + last.bottom) / 2 - (play.top + play.bottom) / 2) < 6, after: play.left > last.right,
      chipBottom: chipCss.borderBottomWidth, keyBottom: keyCss.borderBottomWidth, keyBg: keyCss.backgroundImage.slice(0, 15),
      translateBtn: !!document.querySelector('#btnTranslate'), players: document.querySelectorAll('#player button').length, hint: !!document.querySelector('.page-tr-hint, .safari-hint'), help: document.querySelector('#helpTrHint').textContent, others: document.querySelector('#helpTrOthers').textContent };
  })()`);
  check('电脑上朗读按钮组紧跟在「简易瑞典语」后面、同一行', ctl.sameRow && ctl.after, JSON.stringify(ctl));
  check('朗读按钮是立体的样子（渐变、加厚的下边），和话题按钮不同', parseFloat(ctl.keyBottom) >= 3 && parseFloat(ctl.chipBottom) <= 1 && /gradient/.test(ctl.keyBg), JSON.stringify(ctl));
  check('没有「全文翻译」按钮（朗读按钮组是朗读、语速、男女声、读完以后、下一篇）', !ctl.translateBtn && ctl.players === 5, JSON.stringify(ctl));
  // 只有图标：朗读、读完以后、下一篇上没有字，语速是「0.9×」，男女声是一个字；说明在 aria-label 和提示里
  check('电脑上播放栏的按钮只有图标，没有说明文字，都有 aria-label', lay.labels === 0 && lay.faces.join('|') === '|0.9×|' + lay.faces[2] + '||' && /^[女男声]$/.test(lay.faces[2]) && !lay.cutText.length
    && (await evalJs(`[...document.querySelectorAll('#player button')].every((b) => (b.getAttribute('aria-label') || '').length >= 2)`)), JSON.stringify({ faces: lay.faces, cut: lay.cutText }));
  check('列表上没有整页翻译的提示；说明框「?」里：认不出的浏览器（无头 Edge）不说「你现在用的浏览器」，只列各个浏览器的办法（比如：…）', availStart !== 'unavailable' && !ctl.hint && ctl.help === '' && ctl.others === '比如：', `${availStart} ${JSON.stringify(ctl)}`);
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
  const hdrD = await evalJs(`(() => { const b = document.querySelector('#btnBack'); const br = document.querySelector('#brand'); const t = document.querySelector('.tools'); if (!b || b.hidden) return null; const rb = b.getBoundingClientRect(), rr = br.getBoundingClientRect(), rt = t.getBoundingClientRect(); const de = document.documentElement; return { text: b.innerText.trim(), sameRow: Math.abs((rb.top + rb.bottom) / 2 - (rr.top + rr.bottom) / 2) < 8 && Math.abs((rt.top + rt.bottom) / 2 - (rr.top + rr.bottom) / 2) < 8, h: Math.round(rb.height), w: Math.round(rb.width), inView: rb.left >= 0 && rb.right <= de.clientWidth, clipped: b.scrollWidth > b.clientWidth + 1 }; })()`);
  check('电脑上「← 返回列表」在顶栏标题旁边、同一行', hdrD && hdrD.sameRow && hdrD.inView && !hdrD.clipped && /返回「今日要闻」列表/.test(hdrD.text), JSON.stringify(hdrD));
  const firstId = (await state()).id;
  await clickButtonText('#btnBack', '返回');
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
  ta = await tipAudit();
  check('文章页和查词弹出框：每个按钮都有瑞典文提示', !ta.bad.length && (await evalJs(`document.querySelectorAll('#popup button[data-sv]').length`)) >= 3, `${ta.n} 个按钮${ta.bad.length ? '，没有的：' + ta.bad.join('、') : ''}`);
  await hover(5, 880);
  await sleep(900);
  check('鼠标移开后弹出框消失', !(await popupReport()));
  // 文章开头一行写着来源：电脑上「Sveriges Radio · 节目」、时间（瑞典时间）、「原文 ↗」；文章末尾没有来源、版权那一段（版权在说明框里）
  await evalJs('window.scrollTo(0, 0)');
  await sleep(200);
  st = await state();
  let sl = await srcLine();
  check('电脑上文章开头一行：「Sveriges Radio · 节目」、时间（瑞典时间）、「原文 ↗」（链到 SR 的这篇文章），一行；文章末尾没有来源、版权、作者那一段',
    sl && sl.text === srcWant(st.program) && sl.link === st.link && /sverigesradio\.se/.test(sl.link) && /（瑞典时间）/.test(sl.metaText) && sl.rows === 1 && !sl.footer && !sl.copyright && !sl.todayBadge, JSON.stringify(sl));
  const helpSrc = await evalJs(`(() => { const t = document.querySelector('#dlgHelp').textContent; return { src: /文章来源/.test(t) && /版权归 Sveriges Radio 所有/.test(t) && /不保存、不修改/.test(t) && /原声/.test(t), title: /标题「瑞典语读报」回到列表/.test(t), settings: /右上角的齿轮按钮/.test(t) && /清除阅读记录/.test(t) }; })()`);
  check('说明框里有「文章来源」（版权、不保存不修改、SR 网站上听原声）、点标题回到列表、设置在哪里', helpSrc.src && helpSrc.title && helpSrc.settings, JSON.stringify(helpSrc));
  // 标题「瑞典语读报」是一个按钮：文章页上点一下回到列表（和「← 返回列表」一样，浏览器的「后退」照旧），列表页上回到最上面；
  // 回车、空格也能按。以前的「怎么用」小说明和第一次打开时的说明框都去掉了
  check('没有「怎么用」小说明、没有第一次打开时的说明框；标题是按钮，有瑞典文提示', await evalJs(`!document.querySelector('#guide') && !document.querySelector('#tip') && document.querySelector('#brand').tagName === 'BUTTON' && document.querySelector('#brand').dataset.sv === 'Tillbaka till listan' && document.querySelector('#brand').getAttribute('aria-label') === '瑞典语读报：回到列表'`));
  const idT = (await state()).id;
  const brT = await center('#brand');
  await tap(brT.x, brT.y);
  await waitFor(`SVApp.state().view === 'list'`, 5000);
  st = await state();
  const hsT = await evalJs(`history.state && history.state.sv`);
  check('文章页上点标题「瑞典语读报」：回到列表（和「← 返回列表」一样，浏览器历史里的文章那一步退掉了），这一篇标上「已读」', st.view === 'list' && hsT !== 'article' && await evalJs(`!!document.querySelector('#list .card.read[data-id=${JSON.stringify(idT)}]')`), `${st.view} ${hsT}`);
  check('列表页上标题的提示是「回到最上面」', (await evalJs(`document.querySelector('#brand').dataset.sv + '|' + document.querySelector('#brand').getAttribute('aria-label')`)) === 'Till toppen|瑞典语读报：回到最上面');
  // 1600×900 上这一批放得下一屏：先在下面加一点空白，页面才滚得动
  await evalJs(`document.querySelector('main').style.paddingBottom = '1500px'; window.scrollTo(0, 10)`);
  await sleep(300);
  const brL = await evalJs(`(() => { const r = document.querySelector('#brand').getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2), sy: Math.round(scrollY) }; })()`);
  await tap(brL.x, brL.y);
  const topOk = await waitFor(`scrollY === 0`, 3000, 100);
  check('列表页上点标题：回到最上面', brL.sy > 0 && topOk && (await state()).view === 'list', JSON.stringify(brL));
  await evalJs(`document.querySelector('main').style.paddingBottom = ''`);
  // 键盘：用 Shift+Tab 到了标题上（键盘的焦点），回车、空格都回到列表（空格不是暂停、继续）
  for (const [key, code, vk] of [['Enter', 'Enter', 13], [' ', 'Space', 32]]) {
    await openFirstCard(0);
    const onTitle = await tabToTitle();
    await pressKey(key, code, vk);
    const kOk = await waitFor(`SVApp.state().view === 'list'`, 3000);
    check(`用键盘（Tab）到了标题上按${key === 'Enter' ? '回车' : '空格'}：回到列表`, onTitle && kOk && (await state()).reader === 'idle', `${onTitle} ${(await state()).view}`);
  }
  // 标题连按两下（同一下里）：只退一步（不会退出本站）。列表那一步先做个记号，退回来时看得到
  await evalJs(`history.replaceState({ mark: 'list' }, '')`);
  await openFirstCard(0);
  await evalJs(`(() => { const b = document.querySelector('#brand'); b.click(); b.click(); })()`);
  await sleep(1500);
  const dbl = await evalJs(`({ path: location.pathname, view: window.SVApp && SVApp.state().view, mark: history.state && history.state.mark })`);
  check('标题连按两下：只回到列表一次，不会退出本站', /\/Svenska\//.test(dbl.path) && dbl.view === 'list' && dbl.mark === 'list', JSON.stringify(dbl));
  await openFirstCard(1);
  await evalJs('window.scrollTo(0, 0)');
  await sleep(200);
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
  if (sr.reader === 'speaking') {
    // 真实的声音（speechSynthesis）在页面藏起来时：Edge 接着读（一句读完在 onend 里接下一句，不靠定时器）
    const r0 = await state();
    await minimize(true);
    await sleep(6000);
    const r1 = await state();
    const rHidden = await evalJs('document.hidden');
    await minimize(false);
    summary.realSpeechHidden = { before: { si: r0.si, wi: r0.wi }, after: { si: r1.si, wi: r1.wi, reader: r1.reader }, hidden: rHidden };
    check('真实的声音：页面藏起来（窗口最小化）6 秒，接着往下读', rHidden && r1.reader === 'speaking' && (r1.si > r0.si || (r1.si === r0.si && r1.wi > r0.wi)), JSON.stringify(summary.realSpeechHidden));
    await space();
    await sleep(200);
    check('真实朗读：空格暂停', (await state()).reader === 'paused', (await state()).reader);
  } else {
    // 微软的在线声音偶尔在无头浏览器里出错：页面应当停下（不卡住），并提示过
    console.log('  真实的在线声音这次没读出来（语音服务出错），页面状态：', sr.reader);
    check('真实朗读出错时停下，不卡住', sr.reader === 'paused' || sr.reader === 'idle', sr.reader);
  }
  // 内置翻译（第一次要下载模型，无头里不一定成）：点一个小词典里没有的词（点了才允许下载模型），
  // 看弹出框里的译文是不是内置翻译给的
  const avail = await evalJs('SV.tr.builtinAvailability()');
  const biIdx = await evalJs(`[...document.querySelectorAll('#article .body .w')].findIndex((w, i) => i > 8 && w.textContent.length > 6 && !SV.glossary.lookup(w.textContent))`);
  const bw = await center('#article .body .w', Math.max(0, biIdx));
  await tap(bw.x, bw.y);
  const builtinOk = await waitFor(`SV.tr.builtinReady() && /浏览器内置翻译/.test(document.querySelector('#popup .eng')?.textContent || '')`, 90000, 500);
  const sample = await evalJs(`document.querySelector('#popup .mt')?.textContent || ''`);
  summary.builtinTranslate = { availability: avail, ok: builtinOk, word: bw.text, sample, dialogOpen: await evalJs(`!!document.querySelector('dialog[open]')`) };
  console.log('  内置翻译：', JSON.stringify(summary.builtinTranslate));
  if (builtinOk) await shot('desktop-builtin-word');
  await evalJs(`document.querySelectorAll('dialog[open]').forEach((d) => d.close('no'))`);

  // ================= 2. 电脑、模拟朗读、MyMemory 代答 =================
  console.log('\n== 2. 电脑 1600×900：模拟朗读、空格和点击暂停、男女声、在线翻译');
  check('页面重新打开', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true }));
  // 没有内置翻译：在列表和文章开头提示用浏览器自己的整页翻译（本站没有「全文翻译」按钮）
  await waitFor(`document.body.classList.contains('no-builtin')`, 5000);
  const noBi = await evalJs(`({ btn: !!document.querySelector('#btnTranslate'), hint: !!document.querySelector('.page-tr-hint, .safari-hint'), help: document.querySelector('#helpTrHint').textContent, others: document.querySelector('#helpTrOthers').textContent })`);
  check('没有内置翻译时也没有「全文翻译」按钮', !noBi.btn);
  check('没有内置翻译时：列表上不提示整页翻译，说明框「?」的整篇翻译里列着各个浏览器的办法（认不出这个浏览器，不说「用浏览器自带的翻译功能」这种绕圈的话）', !noBi.hint && noBi.help === '' && noBi.others === '比如：', JSON.stringify(noBi));
  await shot('desktop-no-builtin-list');
  check('打开一篇文章', await openFirstCard(0));
  const pc2 = await center('#btnPlay');
  await tap(pc2.x, pc2.y);
  await sleep(1500);
  let s = await state();
  // 只标正在读的词；正在读的句子不标出来（没有 reading 这个 class，句子没有底色）
  const hl = await evalJs(`(() => { const w = document.querySelector('#article .w.current'); return { word: w ? w.textContent : '',
    sentMarked: !!document.querySelector('#article .reading'), sentBg: w ? getComputedStyle(w.closest('.s')).backgroundColor : '' }; })()`);
  check('点「朗读」开始读，正在读的词有标记，句子不标出来', s.reader === 'speaking' && hl.word && !hl.sentMarked && hl.sentBg === 'rgba(0, 0, 0, 0)', `${s.reader} 第 ${s.si} 句第 ${s.wi} 词「${hl.word}」，句子底色 ${hl.sentBg}，声音 ${s.voice}`);
  // 词一个一个往下走时，排版不动：所有词相对文章的位置在两个时刻完全一样
  const wordMap = () => evalJs(`(() => { const a = document.querySelector('#article').getBoundingClientRect();
    return { cur: document.querySelector('#article .w.current')?.textContent || '', pos: [...document.querySelectorAll('#article .w')].map((w) => { const r = w.getBoundingClientRect(); return Math.round((r.left - a.left) * 10) + ',' + Math.round((r.top - a.top) * 10); }).join(';') }; })()`);
  const mapA = await wordMap();
  await sleep(500);
  const mapB = await wordMap();
  check('正在读的词往下走时，别的词一点也不挪（不重新折行）', mapA.pos === mapB.pos && mapA.cur !== mapB.cur, `「${mapA.cur}」→「${mapB.cur}」`);
  check('默认用女声 Sofie', /Sofie/.test(s.voice || ''), s.voice);
  check('朗读时「暂停」按钮的瑞典文提示是 Pausa', (await evalJs(`document.querySelector('#btnPlay').dataset.sv`)) === 'Pausa');
  // 正在读的词：浅色（日间）是红色下划线，深色（夜间）是黄色下划线；都没有色块底，字是正文的颜色、不加粗，
  // 高度和同一句里别的词一样（下划线不改行高和排版）
  const wordStyle = () => evalJs(`(() => { const w = document.querySelector('#article .w.current'); if (!w) return null;
    const c = getComputedStyle(w), a = getComputedStyle(document.querySelector('#article'));
    const other = [...w.closest('.s').querySelectorAll('.w')].find((x) => x !== w);
    return { bg: c.backgroundColor, shadow: c.boxShadow, line: c.textDecorationLine, lineColor: c.textDecorationColor, skip: c.textDecorationSkipInk, color: c.color, ink: a.color,
      sameWeight: !other || c.fontWeight === getComputedStyle(other).fontWeight, sentBg: getComputedStyle(w.closest('.s')).backgroundColor,
      sameHeight: !other || Math.abs(w.getBoundingClientRect().height - other.getBoundingClientRect().height) < 0.5 }; })()`);
  const darkMode = (on) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] });
  await darkMode(false);
  const lightW = await wordStyle();
  check('浅色：正在读的词是一整条红色下划线，没有黄底，字是正文的颜色、不加粗，不改行高，句子没有底色',
    lightW && lightW.bg === 'rgba(0, 0, 0, 0)' && lightW.shadow === 'none' && /underline/.test(lightW.line) && lightW.lineColor === 'rgb(211, 47, 47)' && lightW.skip === 'none' && lightW.color === lightW.ink && lightW.sameWeight && lightW.sameHeight && lightW.sentBg === 'rgba(0, 0, 0, 0)', JSON.stringify(lightW));
  await shot('desktop-light-reading');
  await darkMode(true);
  await sleep(150);
  const darkW = await wordStyle();
  check('深色：正在读的词是黄色下划线，没有黄底，字是正文的颜色、不加粗，句子没有底色',
    darkW && darkW.bg === 'rgba(0, 0, 0, 0)' && /underline/.test(darkW.line) && darkW.lineColor === 'rgb(245, 197, 24)' && darkW.color === darkW.ink && darkW.sameWeight && darkW.sentBg === 'rgba(0, 0, 0, 0)', JSON.stringify(darkW));
  await shot('desktop-dark-reading');
  await darkMode(false);
  await space();
  s = await state();
  const pausedAt = { si: s.si, wi: s.wi };
  check('空格暂停', s.reader === 'paused', JSON.stringify(pausedAt));
  await sleep(700);
  const s2b = await state();
  check('暂停后光标不动', s2b.si === pausedAt.si && s2b.wi === pausedAt.wi);
  check('暂停时「继续」按钮的瑞典文提示是 Fortsätt', (await evalJs(`document.querySelector('#btnPlay').dataset.sv`)) === 'Fortsätt');
  const lightP = await wordStyle();
  check('浅色暂停：停下的词是浅一些的红色下划线，没有底色',
    lightP && lightP.bg === 'rgba(0, 0, 0, 0)' && /underline/.test(lightP.line) && lightP.lineColor === 'rgb(229, 115, 115)', JSON.stringify(lightP));
  await shot('desktop-paused');
  await darkMode(true);
  await sleep(150);
  const darkP = await wordStyle();
  check('深色暂停：停下的词是暗一些的黄色下划线，没有黄底',
    darkP && darkP.bg === 'rgba(0, 0, 0, 0)' && /underline/.test(darkP.line) && darkP.lineColor === 'rgb(138, 111, 20)', JSON.stringify(darkP));
  await shot('desktop-dark-paused');
  await darkMode(false);
  const logLen = await evalJs('__speechLog.length');
  await space();
  await sleep(100);
  s = await state();
  const resumedText = await evalJs(`__speechLog[${logLen}] && __speechLog[${logLen}].text`);
  const expected = await evalJs(`(() => { const s = document.querySelectorAll('#article .s')[${pausedAt.si}]; const w = s.querySelectorAll('.w')[${pausedAt.wi}]; return w ? w.textContent : ''; })()`);
  check('空格继续，从停下的词接着读', s.reader === 'speaking' && resumedText && resumedText.startsWith(expected), `从「${(resumedText || '').slice(0, 40)}」开始，停在「${expected}」`);
  // 页面藏起来（窗口最小化）时本机的声音也不暂停。模拟的声音靠定时器报词，藏起来时一秒才报一个，所以只看还在往前走
  const d0 = await state();
  await minimize(true);
  const dHidden = await evalJs('document.hidden');
  await sleep(3500);
  const d1 = await state();
  await minimize(false);
  check('本机的声音：页面藏起来（窗口最小化）时不暂停，接着往下读', dHidden && d1.reader === 'speaking' && (d1.si > d0.si || (d1.si === d0.si && d1.wi > d0.wi)),
    `藏着：${dHidden}，第 ${d0.si} 句第 ${d0.wi} 词 → 第 ${d1.si} 句第 ${d1.wi} 词`);
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
  // 「本句译文」用 MyMemory（测试代答）
  await evalJs(`document.querySelector('#popup').hidden || document.querySelector('#main').click()`);
  check('文章页上也没有整页翻译的提示（在说明框里）', await evalJs(`!document.querySelector('#article .page-tr-hint, #article .safari-hint') && !/整篇翻译：/.test(document.querySelector('#article').textContent)`));
  const ws5 = await center('#article .body .w', 4);
  await tap(ws5.x, ws5.y);
  await sleep(400);
  await clickButtonText('#popup .acts button', '本句译文');
  await sleep(800);
  // 有几个意思的词，整句译文自动显示在上面的格子里（.ctxs），点「本句译文」不再重复；别的词显示在下面（.sent）
  const sentT = await evalJs(`(() => { const a = document.querySelector('#popup .sent'); const b = document.querySelector('#popup .ctxs'); return (a && !a.hidden ? a.textContent : '') || (b && !b.hidden ? b.textContent : ''); })()`);
  check('「本句译文」用在线翻译', /【译】/.test(sentT), sentT.slice(0, 40));
  check('发给 MyMemory 的每段不超过 500 个字符', mmRequests.length > 0 && mmRequests.every((r) => r.q.length <= 500), `${mmRequests.length} 次，最长 ${Math.max(0, ...mmRequests.map((r) => r.q.length))} 字符 / ${Math.max(0, ...mmRequests.map((r) => r.bytes))} 字节`);
  check('发给 MyMemory 的请求不带电子邮件等参数', mmRequests.every((r) => r.params.every((k) => k === 'q' || k === 'langpair')), [...new Set(mmRequests.flatMap((r) => r.params))].join(','));
  await shot('desktop-sentence');
  await evalJs(`document.querySelector('#main').click()`);
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
  // 本篇循环，本机的声音：「读完以后」点两下（读完就停 → 接着读下一篇 → 本篇循环），读完最后一句从头再读（读完换回读完就停，后面几轮照常）
  await evalJs(`document.querySelector('#popup').hidden || document.querySelector('#main').click()`);
  const lbD = await center('#btnAfter');
  await tap(lbD.x, lbD.y);
  await tap(lbD.x, lbD.y);
  check('本机的声音：「读完以后」点两下是「本篇循环」', (await state()).after === 'loop', (await state()).after);
  const lastD = await evalJs(`(() => { const ss = document.querySelectorAll('#article .s'); return [...document.querySelectorAll('#article .w')].indexOf(ss[ss.length - 1].querySelector('.w')); })()`);
  const lwD = await center('#article .w', lastD);
  await tap(lwD.x, lwD.y);
  await sleep(300);
  await clickButtonText('#popup .acts button', '从这里读');
  const loopsD0 = (await state()).loops;
  const loopedD = await waitFor(`SVApp.state().loops > ${loopsD0} && SVApp.state().reader === 'speaking'`, 20000, 100);
  st = await state();
  check('本机的声音：本篇循环，读完最后一句从头再读这一篇', loopedD && st.si <= 2, `第 ${st.loops} 遍，第 ${st.si} 句`);
  await space();
  const lbD2 = await center('#btnAfter');
  await tap(lbD2.x, lbD2.y);
  check('本机的声音：再点一下回到「读完就停」', (await state()).settings.after === 'stop');
  // 接着读下一篇，本机的声音：读完最后一句，停一下，打开列表里的下一篇，从标题读起
  await tap(lbD2.x, lbD2.y);
  const idD = (await state()).id;
  const lwD2 = await center('#article .w', lastD);
  await tap(lwD2.x, lwD2.y);
  await sleep(300);
  await clickButtonText('#popup .acts button', '从这里读');
  const nextD = await waitFor(`(() => { const s = SVApp.state(); return s.id !== ${JSON.stringify(idD)} && s.id === s.batch[s.batch.indexOf(${JSON.stringify(idD)}) + 1] && s.reader === 'speaking' && !s.held; })()`, 30000, 100);
  await sleep(300);
  st = await state();
  const nD = await evalJs(`({ h1: document.querySelector('#article h1').textContent, said: __speechLog.slice(-6).map((x) => x.text), toast: document.querySelector('#toast').textContent, y: scrollY })`);
  check('本机的声音：「接着读下一篇」读完打开列表里的下一篇，从标题读起（滚回顶上，提示「下一篇：标题」）',
    nextD && nD.said.some((t) => nD.h1.startsWith(t.slice(0, 20))) && nD.toast.startsWith('下一篇：' + st.title) && nD.y < 120, `${st.title}；读了 ${JSON.stringify(nD.said.slice(0, 2))}；${nD.toast}`);
  await evalJs('window.__ms.stop()');
  // 三连读，本机的声音：语速按钮 1× → 三连读；读三遍，每遍的语速是 0.8、0.9、1，读完就停（读完以后是「读完就停」）
  await tap(lbD2.x, lbD2.y); // 接着读下一篇 → 本篇循环
  await tap(lbD2.x, lbD2.y); // → 读完就停
  await evalJs('window.__speechWordMs = 8');
  const rcD = await center('#btnRate');
  await tap(rcD.x, rcD.y);
  st = await state();
  check('本机的声音：语速 1× 再点是三连读（第 1 遍 0.8×）', st.ramp && st.pass === 1 && st.rate === 0.8 && st.after === 'stop', JSON.stringify({ ramp: st.ramp, pass: st.pass, rate: st.rate, after: st.after }));
  const logD = await evalJs('__speechLog.length');
  const pcD = await center('#btnPlay');
  await tap(pcD.x, pcD.y);
  const rampD = await waitFor(`SVApp.state().reader === 'idle'`, 150000, 250);
  const ratesD = await evalJs(`__speechLog.slice(${logD}).map((x) => x.rate)`);
  const titleD = await evalJs(`document.querySelector('#article h1').textContent`);
  const startsD = await evalJs(`__speechLog.slice(${logD}).filter((x) => ${JSON.stringify(titleD)}.startsWith(x.text.slice(0, 20))).length`);
  const runsD = ratesD.filter((r, i) => i === 0 || r !== ratesD[i - 1]);
  check('本机的声音：三连读读三遍，语速依次是 0.8、0.9、1（每遍从标题读起），读完就停', rampD && runsD.join() === '0.8,0.9,1' && startsD === 3 && (await state()).pass === 1,
    `语速 ${runsD.join(' → ')}，${ratesD.length} 句，标题读了 ${startsD} 遍`);
  await tap(rcD.x, rcD.y); // 三连读 → 0.8×
  await tap(rcD.x, rcD.y); // → 0.9×
  check('本机的声音：语速按钮离开三连读是 0.8×，再点 0.9×', !(await state()).ramp && (await state()).settings.rate === 0.9);
  // 点了顶上的工具按钮、关了对话框（按钮、Esc）、点了弹出框里的按钮以后，空格还是朗读、暂停（焦点不留在那个按钮上）
  const spaceToggles = async (label, act) => {
    await act();
    await sleep(300);
    const s0 = await state();
    await space();
    await sleep(300);
    const s1 = await state();
    const open = await evalJs(`!!document.querySelector('dialog[open]')`);
    const focus = await evalJs(`document.activeElement ? document.activeElement.id || document.activeElement.tagName : ''`);
    check(`${label}，再按空格：朗读开始或暂停（不是又按了一次那个按钮）`, s0.view === 'article' && s1.reader !== s0.reader && s1.settings.scale === s0.settings.scale && !open,
      `${s0.reader} → ${s1.reader}，字号 ${s0.settings.scale} → ${s1.settings.scale}，对话框 ${open}，焦点 ${focus}，第 ${s0.si} → ${s1.si} 句`);
    if (s1.reader === 'speaking') await space();
  };
  // 从开头读、一个词 400 毫秒：这几下里读不完这一篇
  await evalJs('window.__ms.stop(); window.__speechWordMs = 400');
  await spaceToggles('点了 A+', async () => { const c = await center('#btnBigger'); await tap(c.x, c.y); });
  await spaceToggles('点了 A−', async () => { const c = await center('#btnSmaller'); await tap(c.x, c.y); });
  await spaceToggles('打开说明框、点「好」关上', async () => { const c = await center('#btnHelp'); await tap(c.x, c.y); await sleep(300); const b = await evalJs(`(() => { const e = document.querySelector('#dlgHelp .dlg-actions button'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); await sleep(200); await tap(b.x, b.y); });
  await spaceToggles('打开设置、按 Esc 关上', async () => { const c = await center('#btnSettings'); await tap(c.x, c.y); await sleep(300); await pressKey('Escape', 'Escape', 27); });
  await spaceToggles('点了弹出框里的喇叭「读」', async () => { const w = await center('#article .body .w', 3); await tap(w.x, w.y); await sleep(400); await clickButtonText('#popup .acts button', '读'); await sleep(300); await evalJs(`document.querySelector('#main').click()`); });
  await evalJs('window.__ms.stop(); window.__speechWordMs = 0');
  await evalJs('window.__speechWordMs = 0');

  // ================= 3. 手机 390×844 触摸 =================
  console.log('\n== 3. 手机 390×844 触摸');
  // 「电动车」这个话题去掉了：浏览器里存着它（上次看的话题、列过哪些）时，改用默认的话题，记录丢掉，不出错
  const ELB = `try { if (!sessionStorage.getItem('elb')) { const st = JSON.parse(localStorage.getItem('sv.settings.v1') || '{}'); st.topic = 'elbilar'; localStorage.setItem('sv.settings.v1', JSON.stringify(st));
    const m = JSON.parse(localStorage.getItem('sv.shown.v1') || '{}'); m.elbilar = ['sr1', 'sr2']; localStorage.setItem('sv.shown.v1', JSON.stringify(m)); sessionStorage.setItem('elb', '1'); } } catch (e) {}`;
  check('手机上打开页面：存着去掉了的话题「电动车」', await openPage({ width: 390, height: 844, mobile: true, fakeSpeech: true, noBuiltin: true, mockMM: true, ua: ANDROID_UA, initJs: ELB }));
  const elb = await evalJs(`({ topic: SVApp.state().topic, shown: Object.keys(JSON.parse(localStorage.getItem('sv.shown.v1') || '{}')), zh: document.documentElement.textContent.includes('电动车'),
    topics: SV.sources.TOPICS.length, keyLeft: SV.sources.TOPICS.some((t) => t.key === 'elbilar') })`);
  check('存着的话题是「电动车」（去掉了）：打开「今日要闻」，它的记录丢掉了；页面上（话题按钮、菜单、说明）哪里也没有「电动车」',
    elb.topic === 'idag' && !elb.shown.includes('elbilar') && !elb.zh && !elb.keyLeft && elb.topics === 20, JSON.stringify(elb));
  check('网址里是 ?topic=elbilar：也打开「今日要闻」', await openPage({ width: 390, height: 844, mobile: true, fakeSpeech: true, noBuiltin: true, mockMM: true, ua: ANDROID_UA, query: '?topic=elbilar' }) && (await state()).topic === 'idag', (await state()).topic);
  check('手机上打开页面（安卓 Chrome 的用户代理）', await openPage({ width: 390, height: 844, mobile: true, fakeSpeech: true, noBuiltin: true, mockMM: true, ua: ANDROID_UA }));
  const ml = await layoutReport('#list');
  summary.phoneListLayout = ml;
  check('手机上列表没有横向溢出', ml.scrollW <= ml.vw, `${ml.scrollW} <= ${ml.vw}`);
  check('手机上列表用满宽度、一列', ml.boxW >= ml.vw - 40 && ml.columns === 1, `列表 ${ml.boxW}px / 视口 ${ml.vw}px，${ml.columns} 列`);
  check('手机上朗读按钮都在屏幕内、没有说明文字、里面的东西没有被截断', ml.playerFits && !ml.cutText.length && ml.labels === 0, ml.cutText.join(',') + ' ' + ml.faces.join('|'));
  const mBtn = await evalJs(`[...document.querySelectorAll('#player button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
  check('手机上播放栏的按钮一样宽、至少 40 像素高（好点）', mBtn.every(([w, h]) => h >= 40 && w >= 44 && Math.abs(w - mBtn[0][0]) <= 1), JSON.stringify(mBtn));
  // 手机上话题是标题旁边的下拉菜单（话题按钮那一行不显示，省一行），选项和话题按钮是同一张表
  const selP = await evalJs(`(() => { const s = document.querySelector('#topicSel'); const r = s.getBoundingClientRect(); const b = document.querySelector('#brand').getBoundingClientRect();
    return { shown: !!s.offsetParent, chipsShown: !!document.querySelector('#topics .chip').offsetParent, sameRow: Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2) < 8, value: s.value, h: Math.round(r.height),
      opts: [...s.options].map((o) => o.value + ':' + o.textContent).join(), chips: [...document.querySelectorAll('#topics .chip')].map((c) => c.dataset.topic + ':' + c.textContent).join() }; })()`);
  check('手机上话题是标题旁边的下拉菜单（话题按钮那一行不显示），选项和话题按钮一样，选着现在的话题',
    selP.shown && !selP.chipsShown && selP.sameRow && selP.opts === selP.chips && selP.value === (await state()).topic && selP.h >= 36, JSON.stringify(selP).slice(0, 240));
  const hdP = await headerFit();
  summary.phoneHeader = hdP;
  check('手机 390 像素宽：标题、话题菜单和工具按钮在一行，不出屏、不截字，菜单里「今日要闻」放得下', hdP.rows === 1 && !hdP.overflow && !hdP.clipped.length && !hdP.selCut.includes('今日要闻'), JSON.stringify(hdP));
  const barP = await evalJs(`Math.round(document.querySelector('#topbar').getBoundingClientRect().height)`);
  check('手机上粘在顶上的只有朗读按钮一行（不到 60 像素高）', barP < 60, `${barP}px`);
  await shot('phone-list');
  // 在菜单里选另一个话题：和点话题按钮一样
  await pickTopic('politik');
  const selOk = await waitFor(listReady('politik'), 40000);
  check('手机上在菜单里选「政治」，列出政治的文章，菜单上是「政治」', selOk && (await evalJs(`document.querySelector('#topicSel').selectedOptions[0].textContent`)) === '政治', (await state()).topic);
  await pickTopic('idag');
  await waitFor(listReady('idag'), 40000);
  // 手机上没有悬停：按住按钮半秒显示瑞典文提示，松手不算点击（男女声不变）
  const gender0 = (await state()).settings.gender;
  const vbP = await center('#btnVoice');
  await longPress(vbP.x, vbP.y);
  const lp = await svTip();
  await shot('phone-long-press-tip');
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  check('手机上按住按钮半秒，显示瑞典文提示，在屏幕内', lp && /röst/.test(lp.text) && lp.inView, JSON.stringify(lp));
  check('手机上按住看提示，松手不算点击', (await state()).settings.gender === gender0, `${gender0} → ${(await state()).settings.gender}`);
  // 换一批：手机上菜单里选同一个话题不算换，用播放栏最右边的按钮（列表页上是「换一批」）
  const b1 = (await state()).batch;
  const nbP = await center('#btnNext');
  check('手机上列表页播放栏最右边的按钮是「换一批」', (await evalJs(`document.querySelector('#btnNext').getAttribute('aria-label') + ' ' + document.querySelector('#btnNext').dataset.sv`)) === '换一批 Fler artiklar');
  await tap(nbP.x, nbP.y);
  await waitFor(`${listReady('')} && SVApp.state().batchNo === 2`, 20000);
  const b2 = (await state()).batch;
  check('手机上点播放栏最右边的「换一批」，换一批', b2.length > 0 && !b2.some((id) => b1.includes(id)), `${b2.length} 篇`);
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
  // 点文章开头的节目和时间那一行（不是词）关上弹出框；别点顶栏，那里有「← 列表」
  if (await popupReport()) { const mt = await center('#article .meta'); await tap(mt.x, mt.y); await sleep(250); }
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
  // 没有内置翻译：提示安卓 Chrome 自己的整页翻译（本站没有「全文翻译」按钮）
  const hintP = await evalJs(`({ btn: !!document.querySelector('#btnTranslate'), hint: !!document.querySelector('.page-tr-hint, .safari-hint'), help: document.querySelector('#helpTrHint').textContent })`);
  check('手机上没有「全文翻译」按钮，文章上不提示整页翻译，说明框里写着安卓 Chrome 的「⋮ → 翻译…」', !hintP.btn && !hintP.hint && /点右上角 ⋮ →「翻译…」/.test(hintP.help), JSON.stringify(hintP));
  // 往下滚：话题和朗读按钮粘在顶上，还点得到
  // 短的文章（来源那一段去掉以后）一屏放得下：先在下面加一点空白，页面才滚得动
  await evalJs(`document.querySelector('main').style.paddingBottom = '1500px'; window.scrollTo(0, document.documentElement.scrollHeight)`);
  await sleep(400);
  const stick = await evalJs(`(() => { const bar = document.querySelector('#topbar').getBoundingClientRect(); const p = document.querySelector('#btnPlay').getBoundingClientRect(); return { barTop: Math.round(bar.top), playTop: Math.round(p.top), playBottom: Math.round(p.bottom), scrolled: Math.round(scrollY) }; })()`);
  check('手机上往下滚以后，朗读按钮还粘在顶上', stick.scrolled > 200 && stick.barTop === 0 && stick.playTop >= 0 && stick.playBottom < 130, JSON.stringify(stick));
  const pp2 = await evalJs(`(() => { const r = document.querySelector('#btnPlay').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tap(pp2.x, pp2.y);
  await sleep(500);
  check('手机上滚到下面也能点「朗读」', (await state()).reader === 'speaking');
  await space();
  await shot('phone-sticky-controls');
  await evalJs('window.scrollTo(0, 0)');
  await sleep(200);
  const ml2 = await layoutReport('#article');
  check('手机上滚动以后也没有横向溢出', ml2.scrollW <= ml2.vw, `${ml2.scrollW} <= ${ml2.vw}`);
  // 手机上文章页的顶栏：没有「← 列表」（点标题回到列表），和列表页一样是标题、话题菜单（选着现在的话题）和工具按钮，一行
  const hdA = await headerFit();
  const selA = await evalJs(`({ back: !!document.querySelector('#btnBack').offsetParent, sel: !!document.querySelector('#topicSel').offsetParent, value: document.querySelector('#topicSel').value })`);
  check('手机上文章页的顶栏：没有「← 列表」，是标题、话题菜单（选着现在的话题）和工具按钮，一行，不出屏、不截字',
    !selA.back && selA.sel && selA.value === (await state()).topic && hdA.rows === 1 && !hdA.overflow && !hdA.clipped.length, JSON.stringify({ ...selA, rows: hdA.rows, items: hdA.items }));
  // 文章开头一行：手机上「SR · 节目」、时间、「原文 ↗」；文章末尾没有来源、版权那一段
  st = await state();
  const slP = await srcLine();
  check('手机（390 像素宽）上文章开头一行写着「Sveriges Radio · 节目」、时间和「原文 ↗」（链到 SR 的这篇文章），不出屏；文章末尾没有来源、版权那一段',
    slP && slP.text === srcWant(st.program) && slP.link === st.link && slP.rows <= 2 && slP.right <= slP.vw && !slP.footer && !slP.copyright && !/瑞典时间/.test(slP.metaText), JSON.stringify(slP));
  const brHit = await evalJs(`(() => { const b = document.querySelector('#brand').getBoundingClientRect(); const s = document.querySelector('#topicSel').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), gap: Math.round(s.left - b.right) }; })()`);
  check('手机上标题好点：能点的地方至少 40 像素高，和话题菜单不重叠', brHit.h >= 40 && brHit.gap >= 1, JSON.stringify(brHit));
  // 手机上点标题：回到列表
  const brP = await center('#brand');
  await tap(brP.x, brP.y);
  await waitFor(`SVApp.state().view === 'list'`, 5000);
  check('手机上点标题「瑞典语读报」回到列表', (await state()).view === 'list');
  // 文章页上在话题菜单里选另一个话题：和电脑上在文章页点那个话题按钮一样，列出那个话题的文章。
  // 浏览器历史里文章那一步退掉了（不是改掉）：回到列表那一步（先做个记号），再按「后退」不会白按一次
  await evalJs(`history.replaceState({ mark: 'list' }, '')`);
  await openFirstCard(0);
  const inArt = await evalJs(`history.state && history.state.sv`);
  await pickTopic('sverige');
  const selArt = await waitFor(listReady('sverige'), 40000);
  await sleep(300);
  const hsArt = await evalJs(`({ mark: history.state && history.state.mark, sv: history.state && history.state.sv })`);
  check('手机上文章页在话题菜单里选「瑞典」：列出瑞典的文章；浏览器历史里文章那一步退掉了（再按后退不会白按一次）',
    selArt && inArt === 'article' && (await state()).topic === 'sverige' && (await evalJs(`document.querySelector('#topicSel').value`)) === 'sverige' && hsArt.mark === 'list' && !hsArt.sv, JSON.stringify(hsArt));
  const hb = await center('#btnSettings');
  await tap(hb.x, hb.y);
  await sleep(400);
  const dlg = await evalJs(`(() => { const d = document.querySelector('#dlgSettings'); const r = d.getBoundingClientRect(); return { open: d.open, left: r.left, right: r.right, vw: document.documentElement.clientWidth, voices: d.querySelector('#selVoice').options.length }; })()`);
  check('手机上设置对话框在屏幕内，列出声音', dlg.open && dlg.left >= 0 && dlg.right <= dlg.vw && dlg.voices >= 3, JSON.stringify(dlg));
  await shot('phone-settings');
  // 对话框里的按钮：提示要放进对话框（最上层）才看得见；按住「试听」不应该真的读
  const spoken0 = await evalJs('__speechLog.length');
  const tvP = await evalJs(`(() => { const r = document.querySelector('#btnTryVoice').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await longPress(tvP.x, tvP.y);
  const lp2 = await svTip();
  await shot('phone-settings-long-press-tip');
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  check('手机上对话框里按住按钮，提示显示在对话框上面', lp2 && /Provlyssna/.test(lp2.text) && lp2.inDialog && lp2.inView, JSON.stringify(lp2));
  check('手机上按住「试听」看提示，松手不试听', (await evalJs('__speechLog.length')) === spoken0);
  // 设置里的语速：只有 0.8×、0.9×、1× 和三连读
  const rateOpts = await evalJs(`[...document.querySelectorAll('#rateRow input[name="rate"]')].map((r) => r.value + (r.checked ? '*' : ''))`);
  check('设置里的语速只有 0.8×、0.9×、1× 和循序渐进三连读，选着现在的语速', rateOpts.map((x) => x.replace('*', '')).join() === '0.8,0.9,1,ramp' && rateOpts.filter((x) => x.endsWith('*')).length === 1, rateOpts.join(' '));
  await evalJs(`document.querySelector('#dlgSettings').close()`);
  // 别的手机宽度（320、375、430 像素）：顶栏不出屏、不横向滚动、不截字；列表页、文章页一样是标题、话题菜单、工具按钮
  // （文章页上没有「← 列表」），375 以上一行，320 时话题菜单自己一行
  for (const [w, hh] of [[320, 568], [375, 667], [430, 932]]) {
    await openPage({ width: w, height: hh, mobile: true, fakeSpeech: true, noBuiltin: true, mockMM: true, ua: ANDROID_UA });
    const hl = await headerFit();
    if (w === 320) await shot('phone-320-list');
    await openFirstCard(0);
    const ha = await headerFit();
    const la = await layoutReport('#article');
    if (w === 320) await shot('phone-320-article');
    summary['phoneHeader' + w] = { list: hl, article: ha };
    const slw = await srcLine();
    const pw = (await state()).program;
    check(`手机 ${w} 像素宽：文章开头一行是「${w < 360 ? 'SR' : 'Sveriges Radio'} · 节目」，不出屏`, slw.text === srcWant(pw, w < 360) && slw.right <= slw.vw, JSON.stringify(slw));
    check(`手机 ${w} 像素宽：列表页（${hl.rows} 行）和文章页（${ha.rows} 行）的顶栏不出屏、不横向滚动、不截字，播放栏在屏幕内`,
      !hl.overflow && !ha.overflow && !hl.clipped.length && !ha.clipped.length && (w < 360 || (hl.rows === 1 && ha.rows === 1)) && hl.items.includes('topicSel') && ha.items.join() === hl.items.join() && !ha.items.includes('btnBack')
      && !hl.selCut.includes('今日要闻') && la.playerFits && la.scrollW <= la.vw, JSON.stringify({ list: hl, article: ha }));
  }

  // ================= 4. 云端自然语音（假的微软 SDK 和假的令牌服务） =================
  console.log('\n== 4. 电脑 1600×900：云端自然语音');
  ttsWorkerMode = 'ok';
  check('云端语音：页面打开', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true, cloud: true }));
  st = await state();
  check('设了云端语音时默认用它，女声是 Sofie', st.engine === 'cloud' && st.voice === 'sv-SE-SofieNeural', `${st.engine} ${st.voice}`);
  check('云端：打开一篇文章', await openFirstCard(0));
  const blocksC = await evalJs(`(() => { const ss = [...document.querySelectorAll('#article .s')]; const byBlock = []; for (const el of document.querySelectorAll('#article h1, #article .body > p, #article .body li, #article .body h2, #article .body blockquote')) { const s = [...el.querySelectorAll('.s')]; if (s.length) byBlock.push({ first: +s[0].dataset.si, text: s.map((x) => x.textContent).join(' ') }); } return byBlock; })()`);
  const pcC = await center('#btnPlay');
  await tap(pcC.x, pcC.y);
  await waitFor(`window.__ttsLog.length >= 1 && SVApp.state().reader === 'speaking'`, 8000);
  await sleep(700);
  let tl = await evalJs('window.__ttsLog');
  let cw = await evalJs(`document.querySelector('#article .w.current')?.textContent || ''`);
  check('云端：点「朗读」合成第一段（标题），用 Sofie、Worker 发的令牌，不直接播放（audioConfig = null）',
    tl[0] && tl[0].text === blocksC[0].text && tl[0].voice === 'sv-SE-SofieNeural' && /^tok-/.test(tl[0].token) && tl[0].audioConfig === null, JSON.stringify(tl[0]));
  check('云端：跟着播放进度高亮单词', !!cw, `「${cw}」`);
  check('云端：没有用本机的声音', (await evalJs('__speechLog.length')) === 0);
  await waitFor(`SVApp.state().si >= ${blocksC[1].first}`, 15000);
  st = await state();
  tl = await evalJs('window.__ttsLog');
  check('云端：一段读完自动接着读下一段（下一段已经提前合成好）', st.reader === 'speaking' && st.si >= blocksC[1].first && tl.some((x) => x.text === blocksC[1].text), `第 ${st.si} 句；合成过 ${tl.length} 段`);
  await sleep(500);
  await space();
  st = await state();
  const pausedC = { si: st.si, wi: st.wi };
  const wordC = await evalJs(`document.querySelector('#article .w.current')?.textContent || ''`);
  await sleep(700);
  st = await state();
  check('云端：空格暂停，停在那个词上', st.reader === 'paused' && st.si === pausedC.si && st.wi === pausedC.wi, `「${wordC}」 ${JSON.stringify(pausedC)}`);
  const synthBefore = (await evalJs('window.__ttsLog')).length;
  await space();
  await sleep(120);
  st = await state();
  check('云端：再按空格从停下的词接着读，不再合成', st.reader === 'speaking' && st.si === pausedC.si && st.wi >= pausedC.wi && (await evalJs('window.__ttsLog')).length === synthBefore, `${JSON.stringify({ si: st.si, wi: st.wi })} 合成 ${synthBefore} → ${(await evalJs('window.__ttsLog')).length}`);
  const rateC = await center('#btnRate');
  await tap(rateC.x, rateC.y);
  await sleep(300);
  check('云端：换语速不重新合成，接着读', (await evalJs('window.__ttsLog')).length === synthBefore && (await state()).reader === 'speaking');
  const vcC = await center('#btnVoice');
  await tap(vcC.x, vcC.y);
  await waitFor(`window.__ttsLog.some((x) => x.voice === 'sv-SE-MattiasNeural')`, 5000);
  st = await state();
  check('云端：点「女声」换成男声 Mattias，从当前的词接着读', st.voice === 'sv-SE-MattiasNeural' && st.reader === 'speaking' && (await evalJs(`window.__ttsLog.some((x) => x.voice === 'sv-SE-MattiasNeural')`)), st.voice);
  await space();
  // 查词弹出框的喇叭：用云端的声音读这个词
  await evalJs('window.scrollTo(0, 0)');
  await sleep(300);
  const wiC = await evalJs(`[...document.querySelectorAll('#article .body .w')].findIndex((w) => w.textContent.length >= 5)`);
  const wpC = await center('#article .body .w', Math.max(0, wiC));
  await hover(wpC.x, wpC.y);
  await sleep(1300);
  const spk = await evalJs(`(() => { const b = document.querySelector('#popup .acts button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (spk) { await tap(spk.x, spk.y); await sleep(500); }
  tl = await evalJs('window.__ttsLog');
  check('云端：弹出框的喇叭用云端的声音读这个词', !!spk && tl[tl.length - 1].text === wpC.text && tl[tl.length - 1].voice === 'sv-SE-MattiasNeural', tl.length ? JSON.stringify(tl[tl.length - 1]) : '');
  await hover(5, 880);
  await sleep(800);
  // 设置：声音来源两项，云端的三个声音；改用本机的声音再改回来
  const sbC = await center('#btnSettings');
  await tap(sbC.x, sbC.y);
  await sleep(400);
  const setC = await evalJs(`({ row: !document.querySelector('#engineRow').hidden, cloud: document.querySelector('#engineRow input[value="cloud"]').checked, opts: [...document.querySelectorAll('#selVoice option')].map((o) => o.value), note: document.querySelector('#voiceNote').textContent.slice(0, 12) })`);
  check('云端：设置里有「声音来源」，列出 Sofie、Hillevi、Mattias', setC.row && setC.cloud && setC.opts.join() === 'sv-SE-SofieNeural,sv-SE-HilleviNeural,sv-SE-MattiasNeural', JSON.stringify(setC));
  await shot('desktop-cloud-settings');
  await evalJs(`(() => { const r = document.querySelector('#engineRow input[value="device"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  st = await state();
  check('云端：设置里改用这台设备自己的声音', st.engine === 'device' && /Sofie|Mattias/.test(st.voice || ''), `${st.engine} ${st.voice}`);
  await evalJs(`(() => { const r = document.querySelector('#engineRow input[value="cloud"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('云端：再改回云端自然语音', (await state()).engine === 'cloud');
  await evalJs(`document.querySelector('#dlgSettings').close()`);
  ta = await tipAudit();
  check('云端：每个按钮仍然都有瑞典文提示', !ta.bad.length, ta.bad.join('、'));

  // 令牌服务不给令牌（比如 Worker 的设置不对）：说清楚，改用本机的声音，点「继续」接着读
  ttsWorkerMode = 'forbidden';
  check('云端出错：页面打开', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true, cloud: true }));
  await openFirstCard(0);
  const pcF = await center('#btnPlay');
  await tap(pcF.x, pcF.y);
  await waitFor(`SVApp.state().engine === 'device'`, 8000);
  st = await state();
  const toastF = await evalJs(`document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent`);
  check('云端出错：提示原因，改用本机的声音，停在「继续」上', st.engine === 'device' && st.reader === 'paused' && /云端语音的设置有问题/.test(toastF), `${st.engine} ${st.reader}「${toastF}」`);
  await tap(pcF.x, pcF.y);
  await sleep(1200);
  check('云端出错：点「继续」用本机的声音接着读', (await state()).reader === 'speaking' && (await evalJs('__speechLog.length')) > 0);
  await space();
  ttsWorkerMode = 'ok';

  // 免费额度用完（Azure 回 429）：说明，改用本机的声音；这个月里再打开网页，直接用本机的声音，不再先试云端
  check('云端额度用完：页面打开', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true, cloud: true }));
  check('云端额度用完：一开始还是用云端', (await state()).engine === 'cloud');
  await evalJs(`window.__ttsFail = 'quota'`);
  await openFirstCard(0);
  const pcQ = await center('#btnPlay');
  await tap(pcQ.x, pcQ.y);
  await waitFor(`SVApp.state().engine === 'device'`, 8000);
  st = await state();
  const toastQ = await evalJs(`document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent`);
  const month = new Date().toISOString().slice(0, 7);
  check('云端额度用完：说明额度用完了，改用本机的声音，记住这个月', st.engine === 'device' && /免费额度用完了/.test(toastQ) && st.settings.cloudOffMonth === month, `${st.engine}「${toastQ}」${st.settings.cloudOffMonth}`);
  check('云端额度用完：再打开网页，这个月直接用本机的声音', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true, cloud: true }));
  st = await state();
  check('云端额度用完：不再先试云端', st.engine === 'device' && (await evalJs('window.__ttsLog.length')) === 0, st.engine);
  // 在设置里选回「云端自然语音」：再试一次（测试到这里把记录清掉）
  await evalJs(`(() => { const r = document.querySelector('#engineRow input[value="cloud"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('云端额度用完：设置里选回云端就再试', (await state()).engine === 'cloud' && (await state()).settings.cloudOffMonth === '');

  // ================= 5. 后台朗读、循环朗读、锁屏界面的控制（云端语音：假的 SDK 和令牌服务） =================
  console.log('\n== 5. 电脑 1600×900：页面藏起来时接着读、循环朗读、锁屏界面和媒体键（Media Session）');
  check('后台：页面打开', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true, cloud: true }));
  check('后台：用云端语音，循环朗读默认关着', (await state()).engine === 'cloud' && (await state()).loop === false, JSON.stringify({ engine: (await state()).engine, loop: (await state()).loop }));
  check('后台：打开一篇文章', await openFirstCard(0));
  const msInfo = await evalJs(`(() => { const m = navigator.mediaSession && navigator.mediaSession.metadata; return { handlers: Object.keys(window.__ms || {}), title: m ? m.title : '', artist: m ? m.artist : '', artwork: m ? m.artwork.length : 0 }; })()`);
  check('锁屏界面：注册了播放、暂停、停止、下一篇、上一篇；标题是这篇文章，下面是节目和 Sveriges Radio',
    ['play', 'pause', 'stop', 'nexttrack', 'previoustrack'].every((n) => msInfo.handlers.includes(n)) && msInfo.title === (await state()).title && /Sveriges Radio/.test(msInfo.artist) && msInfo.artwork >= 1, JSON.stringify(msInfo));
  const pcB = await center('#btnPlay');
  await tap(pcB.x, pcB.y);
  await waitFor(`SVApp.state().reader === 'speaking' && !!document.querySelector('#article .w.current')`, 8000);
  check('锁屏界面：朗读时显示「正在播放」', (await evalJs('navigator.mediaSession.playbackState')) === 'playing');
  // 窗口最小化：页面藏起来，requestAnimationFrame 停下、定时器一秒一次；一段读完要在 audio 的 ended 事件里接着读下一段
  await minimize(true);
  const h0 = await evalJs(`({ hidden: document.hidden, s: SVApp.state() })`);
  // 藏着的 7 秒里每半秒看一次（从测试这边问，不受页面定时器放慢的影响）：读到了第几段、一直在读、页面一直藏着
  let hMax = h0.s.block;
  let hStates = new Set();
  let hHidden = true;
  for (let k = 0; k < 14; k++) {
    await sleep(500);
    const x = await evalJs(`({ hidden: document.hidden, reader: SVApp.state().reader, block: SVApp.state().block })`);
    hHidden = hHidden && x.hidden;
    hStates.add(x.reader);
    if (x.reader === 'speaking') hMax = Math.max(hMax, x.block);
  }
  check('后台：页面藏起来（窗口最小化）时接着读，一段读完接着读下一段',
    h0.hidden && hHidden && h0.s.reader === 'speaking' && hMax > h0.s.block && !hStates.has('paused'), `藏着 7 秒：从第 ${h0.s.block} 段读到第 ${hMax} 段，状态 ${[...hStates].join('、')}`);
  await minimize(false);
  await sleep(1200);
  const back = await evalJs(`(() => { const s = SVApp.state(); const w = document.querySelector('#article .w.current'); const sEl = document.querySelectorAll('#article .s')[s.si];
    const exp = sEl ? sEl.querySelectorAll('.w')[s.wi] : null; const r = w ? w.getBoundingClientRect() : null;
    return { hidden: document.hidden, reader: s.reader, onWord: !!w && w === exp, inView: !!r && r.top >= 0 && r.bottom <= innerHeight, scrolled: Math.round(scrollY) }; })()`);
  check('后台：回到前台时，标记就在正在读的词上（不重读），也滚到看得见的地方', !back.hidden && back.reader === 'speaking' && back.onWord && back.inView, JSON.stringify(back));
  await shot('desktop-back-from-background');
  // 锁屏界面的暂停、播放
  await evalJs('window.__ms.pause()');
  await sleep(200);
  check('锁屏界面的「暂停」：停下，显示「已暂停」', (await state()).reader === 'paused' && (await evalJs('navigator.mediaSession.playbackState')) === 'paused');
  await evalJs('window.__ms.play()');
  await waitFor(`SVApp.state().reader === 'speaking'`, 5000);
  check('锁屏界面的「播放」：从停下的词接着读', (await state()).reader === 'speaking');
  // 本篇循环：「读完以后」点两下（读完就停 → 接着读下一篇 → 本篇循环），从最后一段读起，读完从头再读；第二遍不再合成
  const lb = await center('#btnAfter');
  await tap(lb.x, lb.y);
  await tap(lb.x, lb.y);
  const loopOn = await evalJs(`({ after: SVApp.state().settings.after, pressed: document.querySelector('#btnAfter').getAttribute('aria-pressed'), on: document.querySelector('#btnAfter').classList.contains('on'), sv: document.querySelector('#btnAfter').dataset.sv, label: document.querySelector('#btnAfter').getAttribute('aria-label'),
    stored: (() => { try { return JSON.parse(localStorage.getItem('sv.settings.v1')).after; } catch (e) { return null; } })() })`);
  check('「读完以后」按钮：本篇循环，按下去的样子，瑞典文提示是 Upprepa artikeln，这个浏览器记住了', loopOn.after === 'loop' && loopOn.on && loopOn.pressed === null && loopOn.sv === 'Upprepa artikeln' && loopOn.label === '读完以后：本篇循环' && loopOn.stored === 'loop', JSON.stringify(loopOn));
  await evalJs('window.__ttsWordMs = 25');
  const lastW = await evalJs(`(() => { const ps = [...document.querySelectorAll('#article .body p, #article .body li')].filter((p) => p.querySelector('.w')); const w = ps[ps.length - 1].querySelector('.w'); return [...document.querySelectorAll('#article .body .w')].indexOf(w); })()`);
  const lwc = await center('#article .body .w', lastW);
  await tap(lwc.x, lwc.y);
  await sleep(300);
  await clickButtonText('#popup .acts button', '从这里读');
  const loops0 = (await state()).loops;
  const idLoop = (await state()).id;
  const looped = await waitFor(`SVApp.state().loops > ${loops0} && SVApp.state().reader === 'speaking'`, 30000, 50);
  st = await state();
  check('循环朗读：读完最后一段，从头再读这一篇', looped && st.block <= 2 && st.id === idLoop, `第 ${st.loops} 遍，第 ${st.block} 段`);
  const looped2 = await waitFor(`SVApp.state().loops > ${loops0 + 1}`, 120000, 500);
  const synthLog = await evalJs('window.__ttsLog.map((x) => x.voice + "\\n" + x.text)');
  const dups = synthLog.length - new Set(synthLog).size;
  check('循环朗读：第二遍、第三遍不再合成（每段只向 Azure 合成一次）', looped2 && dups === 0, `读了 ${(await state()).loops} 遍，合成 ${synthLog.length} 次，重复 ${dups} 次`);
  // 暂停：不再往前走，也不从头再读
  await evalJs('window.__ms.pause()');
  const p1 = await state();
  await sleep(1500);
  const p2 = await state();
  check('循环朗读：按暂停（锁屏界面的暂停也一样）就停下', p1.reader === 'paused' && p2.reader === 'paused' && p2.si === p1.si && p2.wi === p1.wi && p2.loops === p1.loops, JSON.stringify({ si: p2.si, wi: p2.wi, loops: p2.loops }));
  // 下一篇（锁屏界面的「下一首」）：正在读时打开下一篇接着读，循环还开着；上一篇合成的语音放掉
  await evalJs('window.__ms.play()');
  await waitFor(`SVApp.state().reader === 'speaking'`, 5000);
  const idL = (await state()).id;
  const cacheBefore = (await state()).cloudCache;
  await evalJs('window.__ttsWordMs = 220');
  await evalJs('window.__ms.nexttrack()');
  await waitFor(`SVApp.state().id !== ${JSON.stringify(idL)} && SVApp.state().reader === 'speaking'`, 8000);
  await sleep(400);
  st = await state();
  // 新的一篇只留着正在读的这段和提前合成的两段，上一篇的都放掉了
  check('「下一首」（下一篇）：打开下一篇接着读，循环还开着，上一篇合成的语音放掉了',
    st.id !== idL && st.id === st.batch[st.batch.indexOf(idL) + 1] && st.reader === 'speaking' && st.loop === true && st.cloudCache <= 3 && st.media && st.media.title === st.title,
    `合成好的段落 ${cacheBefore} → ${st.cloudCache}；${st.title}`);
  await evalJs('window.__ttsWordMs = 25');
  // 换成读完就停：这一遍读完就停
  const lb2 = await center('#btnAfter');
  await tap(lb2.x, lb2.y);
  const loopsOff = (await state()).loops;
  check('再点「读完以后」：读完就停', (await state()).settings.after === 'stop' && !(await evalJs(`document.querySelector('#btnAfter').classList.contains('on')`)));
  const ended = await waitFor(`SVApp.state().reader === 'idle'`, 120000, 500);
  st = await state();
  check('换成读完就停以后：这一遍读完就停，不再从头读', ended && st.loops === loopsOff && (await evalJs('navigator.mediaSession.playbackState')) === 'none', `${st.reader}，第 ${st.loops} 遍`);
  await shot('desktop-loop-off-idle');

  // ================= 5b. 读完以后、语速和三连读（云端语音：假的 SDK 和令牌服务） =================
  console.log('\n== 5b. 电脑 1600×900：读完以后（读完就停 → 接着读下一篇 → 本篇循环）、语速和循序渐进三连读（云端语音，假的 SDK）');
  // 旧版本的设置：「循环」开着、语速 0.7 → 本篇循环、0.8×；存回去的设置里没有 loop
  const OLD = `try { if (!sessionStorage.getItem('old')) { localStorage.setItem('sv.settings.v1', JSON.stringify({ v: 3, loop: true, rate: 0.7, topic: 'idag', engine: 'cloud' })); sessionStorage.setItem('old', '1'); } } catch (e) {}`;
  check('读完以后：页面打开（旧版本的设置）', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true, cloud: true, initJs: OLD }));
  const mig = await evalJs(`(() => { const st = JSON.parse(localStorage.getItem('sv.settings.v1')); const b = document.querySelector('#btnAfter'); return { after: SVApp.state().after, rate: SVApp.state().settings.rate, mode: b.dataset.mode,
    pressed: b.classList.contains('on') ? 'on' : 'off', face: document.querySelector('#btnRate b').textContent, storedLoop: 'loop' in st, storedAfter: st.after, storedRate: st.rate }; })()`);
  check('旧版本「循环」开着、语速 0.7：变成「本篇循环」、0.8×，存回去的设置里没有 loop', mig.after === 'loop' && mig.mode === 'loop' && mig.pressed === 'on' && mig.rate === 0.8 && mig.face === '0.8×' && !mig.storedLoop && mig.storedAfter === 'loop' && mig.storedRate === 0.8, JSON.stringify(mig));
  // 「读完以后」点一下换一种：本篇循环 → 读完就停 → 接着读下一篇 → 本篇循环；图标、瑞典文提示、读屏软件听到的、提示条都跟着变
  const afterNow = () => evalJs(`(() => { const b = document.querySelector('#btnAfter'); return { mode: b.dataset.mode, pressed: (b.classList.contains('on') ? 'on' : 'off') + (b.hasAttribute('aria-pressed') ? '+aria-pressed' : ''), label: b.getAttribute('aria-label'), sv: b.dataset.sv,
    icon: [...b.querySelectorAll('svg')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.getAttribute('class')).join(), color: getComputedStyle(b).color,
    toast: document.querySelector('#toast').textContent, stored: JSON.parse(localStorage.getItem('sv.settings.v1')).after }; })()`);
  // 点播放栏上的按钮（每次重新找位置：读的时候页面在滚，粘在顶上的播放栏位置会变）
  const press = async (sel) => { const c = await center(sel); await tap(c.x, c.y); };
  const cyc = [];
  for (let k = 0; k < 3; k++) { await press('#btnAfter'); cyc.push(await afterNow()); }
  check('「读完以后」点一下换一种：读完就停 → 接着读下一篇 → 本篇循环，图标、瑞典文提示、aria-label、提示条、存的设置都跟着变',
    cyc.map((x) => x.mode + '/' + x.icon + '/' + x.pressed + '/' + x.stored).join(' ') === 'stop/i-stop/off/stop next/i-next/on/next loop/i-loop/on/loop'
    && cyc[0].label === '读完以后：读完就停' && cyc[1].label === '读完以后：接着读下一篇' && cyc[2].label === '读完以后：本篇循环'
    && cyc[0].sv === 'Stoppa efter artikeln' && cyc[1].sv === 'Fortsätt med nästa artikel' && cyc[2].sv === 'Upprepa artikeln'
    && /^读完就停/.test(cyc[0].toast) && /^接着读下一篇/.test(cyc[1].toast) && /^本篇循环/.test(cyc[2].toast) && cyc[0].color !== cyc[1].color, JSON.stringify(cyc.map((x) => [x.mode, x.icon, x.label, x.color])));
  // 语速按钮：0.8× → 0.9× → 1× → 三连读 → 0.8×，只有这几种；读屏软件听到语速，三连读时是「三连读，第 1 遍，0.8×」
  const rateNow = () => evalJs(`(() => { const b = document.querySelector('#btnRate'); return b.querySelector('b').textContent + (getComputedStyle(b.querySelector('.steps')).display !== 'none' ? '+台阶' + b.dataset.pass : '') + '|' + b.getAttribute('aria-label'); })()`);
  const rcyc = [await rateNow()];
  for (let k = 0; k < 4; k++) { await press('#btnRate'); rcyc.push(await rateNow()); }
  check('语速按钮只有 0.8× → 0.9× → 1× → 三连读 → 0.8×，aria-label 跟着变',
    rcyc.join(' ; ') === '0.8×|语速 0.8× ; 0.9×|语速 0.9× ; 1×|语速 1× ; 0.8×+台阶1|语速：三连读，第 1 遍，0.8× ; 0.8×|语速 0.8×', rcyc.join(' ; '));
  await press('#btnAfter'); // 本篇循环 → 读完就停
  await press('#btnAfter'); // → 接着读下一篇
  check('重新打开网页：还是「接着读下一篇」、0.8×', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: true, noBuiltin: true, mockMM: true, cloud: true })
    && (await state()).after === 'next' && (await state()).rate === 0.8 && !(await state()).ramp, JSON.stringify({ after: (await state()).after, rate: (await state()).rate }));
  // 播放栏的按钮上没有说明文字，aria-label 跟着状态变（列表页上「下一篇」是「换一批」，朗读时「朗读」是「暂停」）
  const lbl = () => evalJs(`[...document.querySelectorAll('#player button')].map((b) => b.getAttribute('aria-label')).join('|')`);
  const lblList = await lbl();
  check('列表页：播放栏没有说明文字，aria-label 是「朗读、语速、男女声、读完以后、换一批」', (await evalJs(`document.querySelectorAll('#player .lbl').length`)) === 0 && /^朗读\|语速 0\.8×\|[女男]声\|读完以后：接着读下一篇\|换一批$/.test(lblList), lblList);

  // ---- 接着读下一篇 ----
  check('接着读下一篇：打开第一篇', await openFirstCard(0));
  await evalJs('window.__ttsWordMs = 25');
  // 读这一篇的最后一段（点那一段的第一个词，「从这里读」）
  const readLast = async () => {
    await evalJs(`window.__ms.pause && SVApp.state().reader === 'speaking' && window.__ms.pause()`);
    const i = await evalJs(`(() => { const ps = [...document.querySelectorAll('#article .body p, #article .body li')].filter((p) => p.querySelector('.w')); const w = ps[ps.length - 1].querySelector('.w'); return [...document.querySelectorAll('#article .body .w')].indexOf(w); })()`);
    const c = await center('#article .body .w', i);
    await tap(c.x, c.y);
    await sleep(300);
    return clickButtonText('#popup .acts button', '从这里读');
  };
  await press('#btnPlay');
  await sleep(300);
  const lblRead = await lbl();
  check('朗读时 aria-label：「朗读」变成「暂停」，「换一批」变成「下一篇」', /^暂停\|.*\|下一篇$/.test(lblRead), lblRead);
  let id0 = (await state()).id;
  await readLast();
  const heldOk = await waitFor(`SVApp.state().held && SVApp.state().gap === 'next'`, 30000, 50);
  const tHeld = Date.now();
  const atGap = await state();
  const gapInfo = await evalJs(`({ playing: navigator.mediaSession.playbackState, word: !!document.querySelector('#article .w.current'), audio: (() => { const a = [...document.querySelectorAll('audio')]; return a.length; })() })`);
  check('读完这一篇：停一下，还在这一篇，锁屏界面还是「正在播放」（云端语音放着静音）', heldOk && atGap.id === id0 && atGap.reader === 'speaking' && gapInfo.playing === 'playing' && !gapInfo.word, JSON.stringify({ id: atGap.id, reader: atGap.reader, ...gapInfo }));
  const synth0 = (await evalJs('window.__ttsLog.length'));
  const advanced = await waitFor(`(() => { const s = SVApp.state(); return s.id !== ${JSON.stringify(id0)} && s.reader === 'speaking' && !s.held; })()`, 10000, 50);
  const tAdv = Date.now() - tHeld;
  await sleep(400);
  st = await state();
  const adv = await evalJs(`({ toast: document.querySelector('#toast').textContent, y: Math.round(scrollY), h1: document.querySelector('#article h1').textContent, first: window.__ttsLog[${synth0}] && window.__ttsLog[${synth0}].text })`);
  check('停一下（约 1.5 秒）以后打开列表里的下一篇，滚到顶上，提示「下一篇：标题」，从标题读起，锁屏界面换成新的标题',
    advanced && st.id === st.batch[st.batch.indexOf(id0) + 1] && tAdv >= 1000 && tAdv < 4000 && adv.toast === '下一篇：' + st.title && adv.y < 150 && adv.first === adv.h1 && st.media && st.media.title === st.title && st.media.state === 'playing',
    `${(tAdv / 1000).toFixed(1)} 秒；${adv.toast}；scrollY ${adv.y}；先合成「${(adv.first || '').slice(0, 30)}」`);
  await shot('desktop-auto-next');
  // 页面藏起来（窗口最小化）时也接着读下一篇
  id0 = st.id;
  await readLast();
  await minimize(true);
  let hidAll = true;
  let hidAdv = false;
  for (let k = 0; k < 60 && !hidAdv; k++) {
    await sleep(500);
    const x = await evalJs(`({ hidden: document.hidden, s: SVApp.state() })`);
    hidAll = hidAll && x.hidden;
    hidAdv = x.s.id !== id0 && x.s.id === x.s.batch[x.s.batch.indexOf(id0) + 1] && x.s.reader === 'speaking' && !x.s.held && x.s.media && x.s.media.title === x.s.title;
  }
  await minimize(false);
  check('页面藏起来（窗口最小化）时：读完这一篇，接着读下一篇，锁屏界面换成新的标题', hidAll && hidAdv, `藏着：${hidAll}，${(await state()).title}`);
  // 停一下的时候按暂停（锁屏界面的暂停也一样）：不接着读，停在这一篇的开头；再按 ▶ 从头读这一篇
  id0 = (await state()).id;
  await readLast();
  await waitFor(`SVApp.state().held`, 30000, 50);
  await evalJs('window.__ms.pause()');
  await sleep(2500);
  st = await state();
  check('停一下的时候按暂停：不接着读下一篇，停在这一篇（锁屏界面「已暂停」）', st.id === id0 && st.reader === 'paused' && !st.held && !st.gap && (await evalJs('navigator.mediaSession.playbackState')) === 'paused', JSON.stringify({ id: st.id === id0, reader: st.reader, gap: st.gap }));
  await space();
  await sleep(500);
  st = await state();
  check('再按空格：从这一篇的开头读', st.id === id0 && st.reader === 'speaking' && st.si <= 2, `第 ${st.si} 句`);
  // 停一下的时候按停止：也不接着读
  await readLast();
  await waitFor(`SVApp.state().held`, 30000, 50);
  await evalJs('window.__ms.stop()');
  await sleep(2500);
  st = await state();
  check('停一下的时候按停止：不接着读下一篇', st.id === id0 && st.reader === 'idle', st.reader);
  // 停一下的时候按锁屏界面的「下一首」：马上打开下一篇接着读
  await press('#btnPlay');
  await readLast();
  await waitFor(`SVApp.state().held`, 30000, 50);
  const tN = Date.now();
  await evalJs('window.__ms.nexttrack()');
  const nOk = await waitFor(`(() => { const s = SVApp.state(); return s.id !== ${JSON.stringify(id0)} && s.reader === 'speaking'; })()`, 5000, 50);
  check('停一下的时候按「下一首」：马上打开下一篇接着读', nOk && Date.now() - tN < 1400, `${Date.now() - tN} 毫秒`);
  // 停一下的时候回到列表：不接着读
  id0 = (await state()).id;
  await readLast();
  await waitFor(`SVApp.state().held`, 30000, 50);
  await clickButtonText('#btnBack', '列表');
  await sleep(2500);
  st = await state();
  check('停一下的时候回到列表：不接着读', st.view === 'list' && st.reader === 'idle' && !st.gap, `${st.view} ${st.reader}`);

  // ---- 这一批的最后一篇：和「下一篇」一样取下一批，打开第一篇接着读 ----
  // （SR 的源里还有没列过的文章时；都列过了时，和「下一篇」一样列出来，朗读停下：下面另外假装一次）
  await evalJs(`(() => { window.__nbOrig = SV.sources.nextBatch; window.__ltOrig = SV.sources.loadTopic; SV.sources.nextBatch = (...a) => (window.__nb = window.__nbOrig(...a)); })()`);
  const lastCard = async () => {
    if ((await state()).view === 'article') { await clickButtonText('#btnBack', '列表'); await waitFor(`SVApp.state().view === 'list'`, 5000); }
    return openFirstCard((await state()).batch.length - 1);
  };
  await lastCard();
  let bn0 = (await state()).batchNo;
  id0 = (await state()).id;
  await press('#btnPlay');
  await readLast();
  const eob = await waitFor(`(() => { const s = SVApp.state(); return (s.batchNo > ${bn0} && s.view === 'article' && s.reader === 'speaking' && !s.held) || (s.view === 'list' && s.reader === 'idle'); })()`, 60000, 100);
  st = await state();
  const nb = await evalJs(`window.__nb ? { restarted: window.__nb.restarted, n: window.__nb.items.length } : null`);
  const eobToast = await evalJs(`document.querySelector('#toast').textContent`);
  check(nb && nb.restarted ? '这一批的最后一篇读完：这个话题的文章都列过了，和「下一篇」一样列出来（从最新的重新开始），朗读停下'
    : '这一批的最后一篇读完：取下一批，打开它的第一篇接着读',
  eob && nb && (nb.restarted ? st.view === 'list' && st.reader === 'idle' && /都列过了/.test(eobToast)
    : st.view === 'article' && st.batchNo === bn0 + 1 && st.id === st.batch[0] && st.reader === 'speaking' && eobToast.startsWith('下一篇：')), `${JSON.stringify(nb)} 第 ${st.batchNo} 批 ${st.view} ${st.reader}「${eobToast}」`);
  await evalJs(`window.__ms.pause && window.__ms.pause()`);
  // 假装这个话题的文章都列过了：列出来（从最新的重新开始），朗读停下，说一声
  await evalJs(`SV.sources.nextBatch = (...a) => (window.__nb = Object.assign(window.__nbOrig(...a), { restarted: true }))`);
  await lastCard();
  bn0 = (await state()).batchNo;
  await press('#btnPlay');
  await readLast();
  const rs1 = await waitFor(`SVApp.state().view === 'list' && SVApp.state().reader === 'idle'`, 60000, 100);
  check('这一批的最后一篇读完、文章都列过了：和「下一篇」一样列出来，朗读停下，提示「都列过了」', rs1 && (await state()).batchNo === bn0 + 1 && /都列过了，朗读停下/.test(await evalJs(`document.querySelector('#toast').textContent`)), await evalJs(`document.querySelector('#toast').textContent`));
  // 假装取不到下一批：文章还在，朗读停下，说一声（不会一直重试）
  await evalJs(`(() => { SV.sources.nextBatch = window.__nbOrig; SV.sources.loadTopic = async () => ({ cands: [], failed: 4, total: 4, error: new Error('test') }); })()`);
  await lastCard();
  id0 = (await state()).id;
  await press('#btnPlay');
  await readLast();
  const lf = await waitFor(`SVApp.state().reader === 'idle'`, 60000, 100);
  await sleep(2000);
  st = await state();
  check('取不到下一批：文章还在，朗读停下，提示取不到（不再重试）', lf && st.view === 'article' && st.id === id0 && st.reader === 'idle' && /没能取到下一批文章/.test(await evalJs(`document.querySelector('#toast').textContent`)), `${st.view} ${st.reader}`);
  // 换回真的取源，nextBatch 还是记下结果的那个（上一步假装「都列过了」留下的 __nb 清掉）
  await evalJs(`(() => { SV.sources.loadTopic = window.__ltOrig; SV.sources.nextBatch = (...a) => (window.__nb = window.__nbOrig(...a)); window.__nb = null; })()`);
  // 读的时候在这一批的最后一篇点「下一篇」：也取下一批，打开第一篇接着读（不是只列出来）
  await press('#btnPlay');
  await sleep(500);
  bn0 = (await state()).batchNo;
  await press('#btnNext');
  const mn = await waitFor(`(() => { const s = SVApp.state(); return (s.batchNo > ${bn0} && s.view === 'article' && s.reader === 'speaking') || (s.view === 'list' && s.reader === 'idle'); })()`, 60000, 100);
  st = await state();
  const nb2 = await evalJs(`window.__nb ? window.__nb.restarted : null`);
  check('读的时候在这一批的最后一篇点「下一篇」：取下一批，打开第一篇接着读（文章都列过了时列出来、停下）', mn && (nb2 ? st.view === 'list' : st.view === 'article' && st.id === st.batch[0] && st.reader === 'speaking'), `restarted ${nb2}，${st.view} ${st.reader}`);
  await evalJs(`window.__ms.stop && window.__ms.stop()`);
  // 读的时候在最后一篇点「下一篇」、取不到下一批：停在刚才读到的地方（暂停），不是这一篇的开头；再按 ▶ 从那里接着读
  await evalJs(`SV.sources.loadTopic = async () => ({ cands: [], failed: 4, total: 4, error: new Error('test') })`);
  await lastCard();
  await press('#btnPlay');
  await waitFor(`SVApp.state().si >= 1 && SVApp.state().reader === 'speaking'`, 30000, 50);
  await press('#btnNext');
  const kf = await waitFor(`SVApp.state().reader === 'paused'`, 10000, 50);
  st = await state();
  const kfx = await evalJs(`({ toast: document.querySelector('#toast').textContent, word: document.querySelector('#article .w.current')?.textContent || '' })`);
  check('读的时候在最后一篇点「下一篇」、取不到下一批：停在刚才读到的地方（暂停，不是开头），说一声', kf && st.view === 'article' && st.si >= 1 && !!kfx.word && /停在刚才读到的地方/.test(kfx.toast), `第 ${st.si} 句「${kfx.word}」 ${kfx.toast}`);
  const keep = { si: st.si, wi: st.wi };
  await press('#btnPlay');
  await sleep(400);
  st = await state();
  check('再按 ▶：从那里接着读', st.reader === 'speaking' && st.si >= keep.si, `第 ${keep.si} 句 → 第 ${st.si} 句`);
  // 取下一批的时候按暂停：也停在刚才读到的地方，取回来了也不列出来
  await evalJs(`SV.sources.loadTopic = (...a) => new Promise((r) => setTimeout(() => r(window.__ltOrig(...a)), 4000))`);
  bn0 = (await state()).batchNo;
  id0 = (await state()).id;
  await press('#btnNext');
  await sleep(500);
  const fetching = await state();
  await evalJs('window.__ms.pause()');
  await sleep(300);
  const pz = await state();
  await sleep(4500);
  st = await state();
  check('取下一批的时候按暂停：停在刚才读到的地方，取回来了也不列下一批', fetching.held && fetching.loading && pz.reader === 'paused' && pz.si >= keep.si && st.view === 'article' && st.id === id0 && st.batchNo === bn0 && st.reader === 'paused',
    JSON.stringify({ held: fetching.held, loading: fetching.loading, si: pz.si, view: st.view, batchNo: st.batchNo }));
  // 「下一篇」正在取下一批的时候点现在的话题按钮：和平常一样换一批（朗读停下，列出下一批），不是再列一遍这一批
  const batch0 = (await state()).batch.join();
  await press('#btnPlay');
  await sleep(300);
  await press('#btnNext');
  await sleep(500);
  const fetching2 = await state();
  const chipA = await center('#topics .chip.active');
  await tap(chipA.x, chipA.y);
  const chipOk = await waitFor(`(() => { const s = SVApp.state(); return s.view === 'list' && !s.loading && s.batchNo === ${bn0 + 1}; })()`, 30000, 100);
  st = await state();
  check('「下一篇」正在取下一批时点现在的话题按钮：和平常一样换一批（朗读停下，列出下一批）', fetching2.loading && fetching2.held && chipOk && st.reader === 'idle' && !st.gap && st.batch.join() !== batch0,
    JSON.stringify({ loading: fetching2.loading, view: st.view, batchNo: st.batchNo, reader: st.reader }));
  await evalJs(`SV.sources.loadTopic = window.__ltOrig`);
  // 接着读下一篇最多连着自动读 AUTO_NEXT_MAX 篇（测试里改成 2）：读者没碰页面就停下，说一声；按了键（或者点了）从头数；点 ▶ 接着读下一篇
  await evalJs(`SVApp.setAutoNextMax(2); window.__ttsWordMs = 8`);
  await openFirstCard(0);
  const capIds = (await state()).batch;
  await readLast();
  const cap1 = await waitFor(`SVApp.state().id === ${JSON.stringify(capIds[1])} && SVApp.state().reader === 'speaking' && !SVApp.state().held`, 60000, 50);
  const cnt1 = (await state()).autoCount;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  const cnt2 = (await state()).autoCount;
  check('接着读下一篇：自动打开一篇数一篇，按了键就从头数', cap1 && cnt1 === 1 && cnt2 === 0, `${cnt1} → ${cnt2}`);
  const capped = await waitFor(`SVApp.state().capNext && SVApp.state().reader === 'idle'`, 150000, 100);
  st = await state();
  const capToast = await evalJs(`document.querySelector('#toast').textContent`);
  check('读者没碰页面，又连着自动读了 2 篇（AUTO_NEXT_MAX，测试里改小）：读完第 2 篇停下，说「已经连续读了 2 篇，停下了；点 ▶ 接着读」',
    capped && st.id === capIds[3] && st.autoCount === 2 && /已经连续读了 2 篇，停下了；点 ▶ 接着读/.test(capToast) && (await evalJs('navigator.mediaSession.playbackState')) === 'none', `${st.title}；${capToast}`);
  await shot('desktop-auto-next-cap');
  await press('#btnPlay');
  const capGo = await waitFor(`SVApp.state().id === ${JSON.stringify(capIds[4])} && SVApp.state().reader === 'speaking'`, 15000, 50);
  st = await state();
  check('停下以后点 ▶：接着读下一篇，从头数', capGo && st.autoCount === 0 && !st.capNext, JSON.stringify({ id: st.id === capIds[4], count: st.autoCount }));
  await evalJs(`window.__ms.stop(); SVApp.setAutoNextMax(0); window.__ttsWordMs = 25`);

  // ---- 循序渐进三连读 ----
  await evalJs('window.__ttsWordMs = 8');
  if ((await state()).view !== 'article') await openFirstCard(0);
  // 读完以后换成「读完就停」（现在是接着读下一篇：点两下），语速换成三连读（现在是 0.8×：点三下）
  await press('#btnAfter');
  await press('#btnAfter');
  for (let k = 0; k < 3; k++) await press('#btnRate');
  st = await state();
  check('三连读：语速按钮上是 0.8× 和台阶（第 1 遍），读完以后是「读完就停」', st.ramp && st.pass === 1 && st.rate === 0.8 && st.after === 'stop', JSON.stringify({ ramp: st.ramp, pass: st.pass, rate: st.rate, after: st.after }));
  // 读一次三连读，记下每一遍：第几遍、语速（audio 真的用的播放速度）、从第几句开始、提示条、锁屏界面
  async function rampRun(until, ms = 150000) {
    const seen = [];
    let last = '';
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const x = await evalJs(`({ s: SVApp.state(), toast: document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent, steps: document.querySelector('#btnRate').dataset.pass })`);
      const k = `${x.s.id}|${x.s.pass}|${x.s.reader}|${x.s.held}`;
      if (k !== last) { seen.push({ id: x.s.id, pass: x.s.pass, reader: x.s.reader, held: x.s.held, gap: x.s.gap, rate: x.s.rate, si: x.s.si, toast: x.toast, steps: x.steps, artist: x.s.media && x.s.media.artist }); last = k; }
      if (x.s.reader === 'speaking' && !x.s.held && seen.length) {
        const cur = seen[seen.length - 1];
        if (!cur.audioRate || Date.now() - t0 > 0) cur.audioRate = x.s.audioRate;
      }
      if (await evalJs(until)) break;
      await sleep(80);
    }
    return seen;
  }
  const passes = (seen) => seen.filter((x) => x.reader === 'speaking' && !x.held).map((x) => `${x.pass}@${x.audioRate}`);
  const idR = (await state()).id;
  await press('#btnPlay');
  const synthR0 = await evalJs('window.__ttsLog.length');
  let seen = await rampRun(`SVApp.state().reader === 'idle'`);
  const synthR = await evalJs(`window.__ttsLog.slice(${synthR0}).map((x) => x.text)`);
  check('三连读 + 读完就停：读三遍，语速（audio 的播放速度）依次是 0.8、0.9、1，每遍之间停一下，读完就停',
    passes(seen).join(' ') === '1@0.8 2@0.9 3@1' && seen.filter((x) => x.held && x.gap === 'pass').length === 2 && seen[seen.length - 1].reader === 'idle' && seen.every((x) => x.id === idR), JSON.stringify(seen.map((x) => [x.pass, x.reader, x.held, x.audioRate, x.gap])));
  const p2R = seen.find((x) => x.pass === 2 && x.reader === 'speaking' && !x.held) || {};
  check('三连读：第 2 遍开始时滚回开头、提示「第 2 遍：0.9×」，按钮上的台阶亮到第 2 级，锁屏界面写着「第 2/3 遍」', p2R.si <= 1 && /第 2 遍：0\.9×/.test(p2R.toast) && p2R.steps === '2' && /^第 2\/3 遍 0\.9×/.test(p2R.artist || ''), JSON.stringify(p2R));
  check('三连读：第 2、3 遍不再合成（三遍只向 Azure 合成一次）', synthR.length === new Set(synthR).size, `合成 ${synthR.length} 段`);
  // 两遍之间按暂停：不读下一遍；再按 ▶ 读下一遍（0.9×），从开头
  await press('#btnPlay');
  await waitFor(`SVApp.state().held && SVApp.state().gap === 'pass'`, 60000, 50);
  await evalJs('window.__ms.pause()');
  await sleep(2500);
  st = await state();
  check('三连读：两遍之间按暂停，不读下一遍（停在开头，下一遍是第 2 遍 0.9×）', st.reader === 'paused' && !st.held && st.pass === 2 && st.rate === 0.9 && st.si === 0, JSON.stringify({ reader: st.reader, pass: st.pass, rate: st.rate, si: st.si }));
  await press('#btnPlay');
  await sleep(600);
  st = await state();
  check('三连读：再按 ▶ 读第 2 遍，0.9×，从开头', st.reader === 'speaking' && st.pass === 2 && st.audioRate === 0.9 && st.si <= 2, JSON.stringify({ pass: st.pass, audioRate: st.audioRate, si: st.si }));
  await shot('desktop-ramp-pass2');
  // 读的时候点语速：马上换（离开三连读是 0.8×，接着读，不重新合成）；再点到三连读：现在读的算第 1 遍
  const synthQ = await evalJs('window.__ttsLog.length');
  await press('#btnRate');
  await sleep(300);
  st = await state();
  check('三连读时读着点语速：离开三连读，0.8× 接着读，不重新合成', !st.ramp && st.rate === 0.8 && st.audioRate === 0.8 && st.reader === 'speaking' && (await evalJs('window.__ttsLog.length')) === synthQ, JSON.stringify({ ramp: st.ramp, rate: st.rate, audioRate: st.audioRate, reader: st.reader }));
  // 再点到三连读（0.9× → 1× → 三连读）：从开头读、词放慢（重新合成），免得这篇文章正好在点的时候读完
  await evalJs('window.__ms.stop(); SV.cloud.forget(); window.__ttsWordMs = 220');
  await press('#btnPlay');
  await waitFor(`SVApp.state().reader === 'speaking' && !!document.querySelector('#article .w.current')`, 8000);
  for (let k = 0; k < 3; k++) await press('#btnRate');
  await sleep(300);
  st = await state();
  check('读着点到三连读：现在读的算第 1 遍，0.8×', st.ramp && st.pass === 1 && st.audioRate === 0.8 && st.reader === 'speaking' && !st.held, JSON.stringify({ ramp: st.ramp, pass: st.pass, audioRate: st.audioRate, held: st.held }));
  await evalJs('window.__ms.stop(); SV.cloud.forget(); window.__ttsWordMs = 8');
  check('停止以后回到第 1 遍', (await state()).pass === 1 && (await state()).reader === 'idle');
  // 三连读 + 本篇循环：三遍读完，三遍再来一次（第 1 遍 0.8×，还是这一篇）
  await press('#btnAfter'); // 读完就停 → 接着读下一篇
  await press('#btnAfter'); // → 本篇循环
  await press('#btnPlay');
  seen = await rampRun(`(() => { const s = SVApp.state(); const t = document.querySelector('#toast').textContent; return s.reader === 'speaking' && !s.held && s.pass === 1 && t.startsWith('本篇循环，三连读再来一次'); })()`);
  check('三连读 + 本篇循环：三遍（0.8、0.9、1）读完，这一篇再来三连读，从第 1 遍 0.8× 开始',
    passes(seen).join(' ').startsWith('1@0.8 2@0.9 3@1 1@') && seen[seen.length - 1].pass === 1 && seen[seen.length - 1].rate === 0.8 && seen.every((x) => x.id === idR), JSON.stringify(seen.map((x) => [x.pass, x.reader, x.held, x.audioRate])));
  await evalJs('window.__ms.stop()');
  // 三连读 + 接着读下一篇：三遍读完，打开下一篇，又从第 1 遍 0.8× 开始
  await press('#btnAfter'); // 本篇循环 → 读完就停
  await press('#btnAfter'); // → 接着读下一篇
  await press('#btnPlay');
  seen = await rampRun(`(() => { const s = SVApp.state(); return s.id !== ${JSON.stringify(idR)} && s.reader === 'speaking' && !s.held; })()`);
  st = await state();
  check('三连读 + 接着读下一篇：三遍读完，打开下一篇，从第 1 遍 0.8× 读起（提示里写着三连读第 1 遍）',
    passes(seen).join(' ').startsWith('1@0.8 2@0.9 3@1') && st.id !== idR && st.pass === 1 && st.rate === 0.8 && st.reader === 'speaking' && /下一篇：.*三连读 第 1 遍/.test(await evalJs(`document.querySelector('#toast').textContent`)),
    JSON.stringify(seen.map((x) => [x.pass, x.reader, x.held, x.audioRate])) + ' ' + st.title);
  await shot('desktop-ramp-next');
  // 三遍都读完、等着读下一篇的时候按暂停：不接着读，回到第 1 遍（再按 ▶ 从这一篇的开头读 0.8×，不读第四遍）
  const idQ = (await state()).id;
  const heldQ = await waitFor(`SVApp.state().held && SVApp.state().gap === 'next'`, 150000, 50);
  await evalJs('window.__ms.pause()');
  await sleep(2500);
  st = await state();
  check('三连读：三遍读完、等着读下一篇时按暂停，不接着读，回到第 1 遍（0.8×），不读第四遍', heldQ && st.reader === 'paused' && st.id === idQ && st.pass === 1 && st.rate === 0.8 && st.si === 0, JSON.stringify({ reader: st.reader, pass: st.pass, rate: st.rate, si: st.si }));
  await press('#btnPlay');
  const q0 = await state(); // 马上看一次读到哪里（一个词 8 毫秒，等久了已经读到后面去了）
  await sleep(400);
  st = await state();
  check('再按 ▶：这一篇第 1 遍，0.8×，从开头读', st.reader === 'speaking' && st.id === idQ && st.pass === 1 && st.audioRate === 0.8 && q0.si <= 2, JSON.stringify({ pass: st.pass, audioRate: st.audioRate, si0: q0.si }));
  // 下一篇（手动）：回到第 1 遍；回到列表也是
  await evalJs('window.__ms.stop()');
  await press('#btnRate'); // 三连读 → 0.8×
  await press('#btnRate'); // → 0.9×
  await press('#btnAfter'); // 接着读下一篇 → 本篇循环
  await press('#btnAfter'); // → 读完就停
  st = await state();
  check('测试完换回 0.9×、读完就停', !st.ramp && st.rate === 0.9 && st.after === 'stop', JSON.stringify({ ramp: st.ramp, rate: st.rate, after: st.after }));
  await evalJs('window.__ttsWordMs = 220');

  // ================= 6、7. 翻译：微软翻译、按这一句选词义（函数在文件后面） =================
  await translationChecks();

  // ================= 8. 真的云端语音（SV_REAL_TTS=1 才做） =================
  if (process.env.SV_REAL_TTS === '1') {
    console.log('\n== 8. 真的云端语音：js/config.js 的令牌服务和微软 Azure');
    check('真的云端：页面打开', await openPage({ width: 1600, height: 900, mobile: false, fakeSpeech: false, noBuiltin: true, mockMM: true, cloud: 'real' }));
    check('真的云端：用云端语音', (await state()).engine === 'cloud', (await state()).engine);
    await openFirstCard(0);
    const pcR = await center('#btnPlay');
    await tap(pcR.x, pcR.y);
    const startedR = await waitFor(`SVApp.state().reader === 'speaking' && !!document.querySelector('#article .w.current')`, 20000);
    const p1 = await state();
    const w1 = await evalJs(`document.querySelector('#article .w.current')?.textContent || ''`);
    await sleep(4000);
    const p2 = await state();
    const w2 = await evalJs(`document.querySelector('#article .w.current')?.textContent || ''`);
    const toastR = await evalJs(`document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent`);
    check('真的云端：微软的声音读起来，高亮跟着往前走', startedR && p2.engine === 'cloud' && p2.reader === 'speaking' && (p2.si > p1.si || p2.wi > p1.wi), `「${w1}」(${p1.si}/${p1.wi}) → 「${w2}」(${p2.si}/${p2.wi}) ${p2.voice} ${toastR}`);
    await space();
  }
} catch (e) {
  check('测试脚本没有出错', false, e.stack || String(e));
}

// 云端语音另外连：微软 SDK 的 CDN（cdn.jsdelivr.net）、令牌服务（测试里是假的 svtts.test）；合成走 WebSocket，不在这个列表里
const allowed = (h) => /^127\.0\.0\.1(:\d+)?$/.test(h) || h === 'api.sr.se' || h === 'api.mymemory.translated.net' || h === 'cdn.jsdelivr.net' || h === 'svtts.test' || h === 'svenska-tts.tony6838.workers.dev' || h === new URL(baseUrl).host;
summary.hosts = Object.fromEntries(hosts);
check('页面只连了本站、SR、MyMemory，以及云端语音的 SDK 和令牌服务', [...hosts.keys()].every(allowed), [...hosts.entries()].map(([h, n]) => `${h}×${n}`).join(' '));
// 第 4 轮故意让假的令牌服务回 403（测试改用本机声音），浏览器自己会记一条网络错误，不算
// 第 6、7 轮故意让假的 /translate 回 429、连不上，让 MyMemory 连不上，浏览器也会记一条网络错误，不算
const realProblems = problems.filter((p) => !/favicon/.test(p) && !p.includes('403 (Forbidden) https://svtts.test/token')
  && !/svtts\.test\/translate|api\.mymemory\.translated\.net/.test(p));
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

// 用无头 Edge 真实打开「瑞典语读报」，用真实的鼠标、触摸、键盘事件检查各项功能，截图并收集控制台错误。
//   node tests/browser_check.mjs <截图目录> [网址]
// 不给网址时，自己在本机起一个静态服务器（根目录是仓库的根），打开 http://127.0.0.1:<端口>/Svenska/。
// 给网址时（比如 https://tony6838.github.io/games/Svenska/）直接测那个网址。
//
// 环境变量 SV_REAL_TTS=1：最后再用真的云端语音（js/config.js 里的令牌服务和微软 Azure）读几秒，会花几百个字符的免费额度。
//
// 前三次一律用本机的声音（不管 js/config.js 里填了什么），第四次用假的微软 SDK 和假的令牌服务查云端语音。
// 前三次：
//   1. 电脑 1600×900、真实的朗读和浏览器内置翻译：每个话题列出文章、再点一次换一批；打开文章、返回列表、
//      浏览器后退、下一篇；鼠标悬停查词；看看无头 Edge 里真实的瑞典语声音能不能读、有没有词的 boundary 事件；
//      试内置翻译。
//   2. 电脑 1600×900、模拟的朗读（假的 Sofie / Mattias，按词发 boundary 事件）、没有内置翻译、
//      MyMemory 由测试代答（不占真实额度）：朗读高亮、空格暂停继续、点文章暂停、从这里读、换男女声、
//      没有内置翻译时不显示「全文翻译」而提示整页翻译、本句译文走 MyMemory、发给 MyMemory 的内容（不超过 500 个字符、不带电子邮件）。
//   3. 手机 390×844 触摸、安卓 Chrome 的用户代理：列表和文章不横向溢出、再点话题换一批、点词弹框不出屏、点屏幕暂停、
//      没有「全文翻译」按钮而有整页翻译的提示、往下滚时朗读按钮粘在顶上、返回列表、「怎么用」。
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
let ttsWorkerMode = 'ok'; // 假的云端语音令牌服务：'ok' 或 'forbidden'
let ttsTokenCalls = 0;
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

// 假的微软 Speech SDK：不联网，每个词 220 毫秒，返回同样长的静音 WAV 和每个词的时间（和真的 SDK 一样的事件和字段）。
// 记下每次合成的声音、文字、令牌，看缓存和换声音对不对。
const FAKE_AZURE = `(() => {
  window.__ttsLog = [];
  const WORD = /[\\p{L}\\p{N}]+(?:[-'’:][\\p{L}\\p{N}]+|[.,]\\p{N}+)*/gu;
  function wav(ms) {
    const rate = 8000, n = Math.round(rate * ms / 1000), buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return buf;
  }
  class SpeechSynthesizer {
    constructor(conf, audioConfig) { this.conf = conf; this.audioConfig = audioConfig; this.wordBoundary = null; }
    speakTextAsync(text, ok) {
      // window.__ttsFail = 'quota'：像 Azure 的免费额度用完时一样，合成被拒绝（429）
      if (window.__ttsFail === 'quota') { setTimeout(() => ok({ reason: 'canceled', errorDetails: 'WebSocket upgrade failed: Too many requests (429). Quota exceeded.' }), 50); return; }
      const ws = [...text.matchAll(WORD)];
      window.__ttsLog.push({ voice: this.conf.speechSynthesisVoiceName, text, token: this.conf.token, audioConfig: this.audioConfig });
      setTimeout(() => {
        ws.forEach((m, i) => this.wordBoundary && this.wordBoundary(this, { audioOffset: (100 + i * 220) * 10000, duration: 200 * 10000, text: m[0], wordLength: m[0].length, textOffset: m.index, boundaryType: 'WordBoundary' }));
        ok({ reason: 'done', audioData: wav(150 + ws.length * 220) });
      }, 80);
    }
    close() {}
  }
  window.SpeechSDK = {
    SpeechConfig: { fromAuthorizationToken: (token, region) => ({ token, region }) },
    SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: 'mp3' },
    ResultReason: { SynthesizingAudioCompleted: 'done' },
    SpeechSynthesizer,
  };
})();`;

let scriptIds = [];
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';
// cloud：true 用云端语音（假的 SDK 和假的令牌服务 svtts.test）；'real' 用 js/config.js 里真的令牌服务和真的 Azure；
// 不设时一律用本机的声音，不管 js/config.js 里填了什么
async function openPage({ width, height, mobile, fakeSpeech, noBuiltin, mockMM, cloud = false, query = '', ua = '' }) {
  for (const id of scriptIds) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
  scriptIds = [];
  if (cloud !== 'real') scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.SV_CONFIG = { ttsUrl: ${JSON.stringify(cloud ? 'https://svtts.test' : '')} };` })).result.identifier);
  if (cloud === true) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_AZURE })).result.identifier);
  if (fakeSpeech) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_SPEECH })).result.identifier);
  if (noBuiltin) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: NO_BUILTIN })).result.identifier);
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
  check('21 个话题按钮各有自己的瑞典文名字', chipTips.length === 21 && new Set(chipTips).size === 21, chipTips.join('、'));
  const iconTip = await evalJs(`document.querySelector('#btnSettings').title`);
  check('提示是两行：瑞典文，然后是中文说明', /^Inställningar\n设置/.test(iconTip), JSON.stringify(iconTip));
  // 云端语音用的微软 Speech SDK：固定版本，完整性校验（integrity）对得上，真的能从 CDN 加载
  const sdkOk = await evalJs(`SV.cloud.loadSdk().then((s) => !!(s && s.SpeechSynthesizer && s.SpeechConfig && s.SpeechConfig.fromAuthorizationToken && s.ResultReason && s.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3 !== undefined), (e) => 'ERR ' + e.message)`);
  check('云端语音的微软 SDK 能从 CDN 加载，完整性校验通过', sdkOk === true, String(sdkOk));
  check('没有设置云端语音时用本机的声音', (await state()).engine === 'device', (await state()).engine);
  // 朗读按钮组紧跟在最后一个话题「简易瑞典语」后面，同一行，样子是立体按键，和话题按钮不一样
  await waitFor(`!document.querySelector('#btnTranslate').hidden || document.body.classList.contains('no-builtin')`, 8000);
  const ctl = await evalJs(`(() => {
    const last = document.querySelector('#topics .chip:last-child').getBoundingClientRect();
    const play = document.querySelector('#btnPlay').getBoundingClientRect();
    const chipCss = getComputedStyle(document.querySelector('#topics .chip'));
    const keyCss = getComputedStyle(document.querySelector('#btnRate'));
    return { sameRow: Math.abs((last.top + last.bottom) / 2 - (play.top + play.bottom) / 2) < 6, after: play.left > last.right,
      chipBottom: chipCss.borderBottomWidth, keyBottom: keyCss.borderBottomWidth, keyBg: keyCss.backgroundImage.slice(0, 15),
      translateBtn: !document.querySelector('#btnTranslate').hidden, hint: !!document.querySelector('#list .page-tr-hint').offsetParent };
  })()`);
  check('电脑上朗读按钮组紧跟在「简易瑞典语」后面、同一行', ctl.sameRow && ctl.after, JSON.stringify(ctl));
  check('朗读按钮是立体的样子（渐变、加厚的下边），和话题按钮不同', parseFloat(ctl.keyBottom) >= 3 && parseFloat(ctl.chipBottom) <= 1 && /gradient/.test(ctl.keyBg), JSON.stringify(ctl));
  check('有内置翻译时显示「全文翻译」按钮，不显示整页翻译的提示', ctl.translateBtn && !ctl.hint, JSON.stringify(ctl));
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
  // 「怎么用」：鼠标停在标题上出现，移开就消失，不挡话题按钮
  await evalJs('window.scrollTo(0, 0)');
  await sleep(200);
  const br = await center('#brand');
  await hover(br.x, br.y);
  await sleep(300);
  const g = await evalJs(`(() => { const g = document.querySelector('#guide'); if (g.hidden) return null; const r = g.getBoundingClientRect(); return { on: r.left >= 0 && r.right <= document.documentElement.clientWidth && r.bottom <= innerHeight, lines: g.querySelectorAll('li').length }; })()`);
  check('鼠标停在顶栏标题上，出现「怎么用」，在屏幕内', g && g.on && g.lines >= 4, JSON.stringify(g));
  await shot('desktop-guide');
  const chipC = await center('#topics .chip[data-topic="sverige"]');
  await hover(chipC.x, chipC.y);
  await sleep(200);
  check('鼠标移到话题按钮上，「怎么用」马上消失', await evalJs(`document.querySelector('#guide').hidden`));
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
    await space();
    await sleep(200);
    check('真实朗读：空格暂停', (await state()).reader === 'paused', (await state()).reader);
  } else {
    // 微软的在线声音偶尔在无头浏览器里出错：页面应当停下（不卡住），并提示过
    console.log('  真实的在线声音这次没读出来（语音服务出错），页面状态：', sr.reader);
    check('真实朗读出错时停下，不卡住', sr.reader === 'paused' || sr.reader === 'idle', sr.reader);
  }
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
  // 没有内置翻译：不显示「全文翻译」按钮，在它的位置提示用浏览器自己的整页翻译
  await waitFor(`document.body.classList.contains('no-builtin')`, 5000);
  const noBi = await evalJs(`({ btn: !document.querySelector('#btnTranslate').hidden, hint: [...document.querySelectorAll('#list .page-tr-hint')].filter((x) => x.offsetParent).map((x) => x.textContent).join('') })`);
  check('没有内置翻译时不显示「全文翻译」按钮', !noBi.btn);
  check('列表上提示用浏览器自带的整页翻译', /整篇翻译：用浏览器自带的翻译功能/.test(noBi.hint), noBi.hint);
  await shot('desktop-no-builtin-list');
  check('打开一篇文章', await openFirstCard(0));
  const pc2 = await center('#btnPlay');
  await tap(pc2.x, pc2.y);
  await sleep(1500);
  let s = await state();
  const hl = await evalJs(`({ word: document.querySelector('#article .w.current')?.textContent || '', sent: !!document.querySelector('#article .s.reading') })`);
  check('点「朗读」开始读，句子和词高亮', s.reader === 'speaking' && hl.sent && hl.word, `${s.reader} 第 ${s.si} 句第 ${s.wi} 词「${hl.word}」，声音 ${s.voice}`);
  check('默认用女声 Sofie', /Sofie/.test(s.voice || ''), s.voice);
  check('朗读时「暂停」按钮的瑞典文提示是 Pausa', (await evalJs(`document.querySelector('#btnPlay').dataset.sv`)) === 'Pausa');
  // 正在读的词：浅色是整块黄底；深色（夜间）是黄色下划线，没有黄底，字是正文的颜色
  const wordStyle = () => evalJs(`(() => { const w = document.querySelector('#article .w.current'); if (!w) return null;
    const c = getComputedStyle(w), a = getComputedStyle(document.querySelector('#article'));
    return { bg: c.backgroundColor, line: c.textDecorationLine, lineColor: c.textDecorationColor, color: c.color, ink: a.color }; })()`);
  const darkMode = (on) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] });
  await darkMode(false);
  const lightW = await wordStyle();
  // 黄底有 0.12 秒的渐显，模拟的声音刚换词时读到的是 rgba(255, 216, 77, 0.9x)，所以只比颜色不比透明度
  check('浅色：正在读的词是整块黄底', lightW && /^rgba?\(255, 216, 77\b/.test(lightW.bg) && !/underline/.test(lightW.line), JSON.stringify(lightW));
  await darkMode(true);
  await sleep(150);
  const darkW = await wordStyle();
  check('深色：正在读的词是黄色下划线，没有黄底，字是正文的颜色',
    darkW && darkW.bg === 'rgba(0, 0, 0, 0)' && /underline/.test(darkW.line) && darkW.lineColor === 'rgb(245, 197, 24)' && darkW.color === darkW.ink, JSON.stringify(darkW));
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
  check('文章页上也有整页翻译的提示', await evalJs(`!!document.querySelector('#article .page-tr-hint').offsetParent`));
  const ws5 = await center('#article .body .w', 4);
  await tap(ws5.x, ws5.y);
  await sleep(400);
  await clickButtonText('#popup .acts button', '本句译文');
  await sleep(800);
  const sentT = await evalJs(`document.querySelector('#popup .sent')?.textContent || ''`);
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

  // ================= 3. 手机 390×844 触摸 =================
  console.log('\n== 3. 手机 390×844 触摸');
  check('手机上打开页面（安卓 Chrome 的用户代理）', await openPage({ width: 390, height: 844, mobile: true, fakeSpeech: true, noBuiltin: true, mockMM: true, ua: ANDROID_UA }));
  const ml = await layoutReport('#list');
  summary.phoneListLayout = ml;
  check('手机上列表没有横向溢出', ml.scrollW <= ml.vw, `${ml.scrollW} <= ${ml.vw}`);
  check('手机上列表用满宽度、一列', ml.boxW >= ml.vw - 40 && ml.columns === 1, `列表 ${ml.boxW}px / 视口 ${ml.vw}px，${ml.columns} 列`);
  check('手机上朗读按钮都在屏幕内、字没有被截断', ml.playerFits && !ml.cutText.length, ml.cutText.join(','));
  check('手机上话题一行，可以横着滑', ml.chipsScrollable, `话题条宽 ${ml.chipsW}px`);
  await shot('phone-list');
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
  // 没有内置翻译：不显示「全文翻译」按钮，提示安卓 Chrome 自己的整页翻译
  const hintP = await evalJs(`({ btn: !document.querySelector('#btnTranslate').hidden, hint: document.querySelector('#article .page-tr-hint')?.offsetParent ? document.querySelector('#article .page-tr-hint').textContent : '' })`);
  check('手机上没有「全文翻译」按钮，提示安卓 Chrome 的「⋮ → 翻译…」', !hintP.btn && /点右上角 ⋮ →「翻译…」/.test(hintP.hint), JSON.stringify(hintP));
  // 往下滚：话题和朗读按钮粘在顶上，还点得到
  await evalJs('window.scrollTo(0, document.documentElement.scrollHeight)');
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
  const hdrP = await evalJs(`(() => { const b = document.querySelector('#btnBack'); const br = document.querySelector('#brand'); const t = document.querySelector('.tools'); if (!b || b.hidden) return null; const rb = b.getBoundingClientRect(), rr = br.getBoundingClientRect(), rt = t.getBoundingClientRect(); const de = document.documentElement; return { text: b.innerText.trim(), sameRow: Math.abs((rb.top + rb.bottom) / 2 - (rr.top + rr.bottom) / 2) < 8 && Math.abs((rt.top + rt.bottom) / 2 - (rr.top + rr.bottom) / 2) < 8, h: Math.round(rb.height), w: Math.round(rb.width), inView: rb.left >= 0 && rb.right <= de.clientWidth, clipped: b.scrollWidth > b.clientWidth + 1 }; })()`);
  check('手机上「← 列表」和标题、工具按钮在同一行，不截字，好点', hdrP && hdrP.sameRow && hdrP.inView && !hdrP.clipped && hdrP.h >= 36, JSON.stringify(hdrP));
  // 点标题：打开「怎么用」，点别处关上
  const brP = await center('#brand');
  await tap(brP.x, brP.y);
  await sleep(300);
  const gP = await evalJs(`(() => { const g = document.querySelector('#guide'); if (g.hidden) return null; const r = g.getBoundingClientRect(); return { on: r.left >= 0 && r.right <= document.documentElement.clientWidth && r.bottom <= innerHeight, text: g.innerText.slice(0, 20) }; })()`);
  check('手机上点标题打开「怎么用」，在屏幕内', gP && gP.on && /怎么用/.test(gP.text), JSON.stringify(gP));
  await shot('phone-guide');
  const metaP = await center('#article .meta');
  await tap(metaP.x, metaP.y);
  await sleep(300);
  check('手机上点别处关上「怎么用」', await evalJs(`document.querySelector('#guide').hidden`));
  await clickButtonText('#btnBack', '列表');
  await waitFor(`SVApp.state().view === 'list'`, 5000);
  check('手机上「← 返回列表」', (await state()).view === 'list');
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
  await evalJs(`document.querySelector('#dlgSettings').close()`);

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

  // ================= 5. 真的云端语音（SV_REAL_TTS=1 才做） =================
  if (process.env.SV_REAL_TTS === '1') {
    console.log('\n== 5. 真的云端语音：js/config.js 的令牌服务和微软 Azure');
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
const realProblems = problems.filter((p) => !/favicon/.test(p) && !p.includes('403 (Forbidden) https://svtts.test/token'));
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

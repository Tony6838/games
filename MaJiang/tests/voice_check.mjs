// 语音和开始画面「所有玩家积分清零」的真实界面测试：无头 Edge，用真实的鼠标或触摸点，
// 假的 speechSynthesis 记下说了什么，和牌局记录一句一句地对。
//   node tests/voice_check.mjs <截图目录> [--hands 2] [--speed 5] [--only splash,play,slow,mute,none,throw,novoice,late]
//                              [--gl gpu|swiftshader]
//                              [--base https://tony6838.github.io/games/MaJiang/]   测线上的版本，不测本地文件
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const outDir = argv[0] || 'voice';
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const HANDS = +opt('hands', 2);
const SPEED = +opt('speed', 5);
const GL = opt('gl', 'gpu');
const ONLY = opt('only', '').split(',').filter(Boolean);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = opt('base', '') || 'file:///' + root.replace(/\\/g, '/') + '/index.html';
mkdirSync(outDir, { recursive: true });
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[390, 844, true], [844, 390, true], [1280, 800, false], [667, 375, true]];
const sizeName = (z) => z[0] + 'x' + z[1];

const problems = [];
let checks = 0;
const check = (ok, what) => {
  checks++;
  if (ok) return;
  problems.push(what);
  console.log('  失败: ' + what);
};

// ---- 注入页面：假的朗读、牌局记录、localStorage 的写入 ----------------------------------
const VOICES = `[['Microsoft Bengt', 'sv-SE', true], ['Microsoft Huihui', 'zh-CN', true], ['Microsoft Xiaotong Online (Natural)', 'wuu-CN', false], ['Microsoft Yunzhe Online (Natural)', 'wuu-CN', false]].map(([name, lang, localService]) => ({ name, lang, localService, voiceURI: name, default: false }))`;
const inject = (mode) => `(() => {
  const mode = ${JSON.stringify(mode)};
  const S = window.__t = { spoken: [], asked: [], lines: [], errors: [], writes: [], live: 0, maxLive: 0, cancels: 0, voicesAt: mode === 'late' ? performance.now() + 5000 : 0 };
  addEventListener('error', (e) => S.errors.push('error: ' + e.message + ' @' + e.filename + ':' + e.lineno));
  addEventListener('unhandledrejection', (e) => S.errors.push('rejection: ' + (e.reason && e.reason.stack || e.reason)));
  for (const f of ['setItem', 'removeItem', 'clear']) {
    const orig = Storage.prototype[f];
    Storage.prototype[f] = function (...a) { S.writes.push(f + ' ' + (a[0] || '')); return orig.apply(this, a); };
  }
  const set = (name, value) => Object.defineProperty(window, name, { value, configurable: true, writable: true });
  if (mode === 'none') { set('speechSynthesis', undefined); set('SpeechSynthesisUtterance', undefined); }
  else if (mode === 'throw') {
    const boom = () => { S.cancels++; throw new Error('boom'); };
    set('speechSynthesis', { getVoices: boom, speak: boom, cancel: boom, addEventListener: boom });
    set('SpeechSynthesisUtterance', function () { throw new Error('boom'); });
  } else {
    const [delay, dur] = mode === 'slow' ? [150, 1900] : [0, 4]; // slow 是量出来的 Edge 联网声音：念完拖一秒多空白才报「说完」
    const all = ${VOICES};
    const queue = [];
    let busy = null;
    const next = () => {
      if (busy || !queue.length) return;
      const u = busy = queue.shift();
      setTimeout(() => {
        if (busy !== u) return;
        if (u.onstart) u.onstart({});
        setTimeout(() => {
          if (busy !== u) return;
          busy = null;
          S.live--;
          if (u.onend) u.onend({});
          next();
        }, dur);
      }, delay);
    };
    set('SpeechSynthesisUtterance', class { constructor(text) { this.text = text; this.volume = 1; this.rate = 1; this.pitch = 1; this.voice = null; this.lang = ''; } });
    set('speechSynthesis', {
      getVoices: () => (mode === 'novoice' ? all.filter((v) => v.lang === 'sv-SE') : performance.now() < S.voicesAt ? [] : all),
      speak: (u) => {
        S.spoken.push({ text: u.text, volume: u.volume, lang: u.lang, voice: u.voice && u.voice.name, pitch: u.pitch, rate: u.rate, t: performance.now(), tap: navigator.userActivation.isActive });
        if (!u.text) return; // 浏览器里空话当场算说完
        S.live++;
        S.maxLive = Math.max(S.maxLive, S.live);
        queue.push(u);
        next();
      },
      cancel: () => {
        S.cancels++;
        const gone = busy ? [busy, ...queue] : queue.slice();
        busy = null;
        queue.length = 0;
        S.live = 0;
        for (const u of gone) if (u.onerror) u.onerror({ error: 'canceled' });
      },
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    const proto = MJ.Voice.Speaker.prototype; // 牌局要说的每一句和时间
    const announce = proto.announce;
    proto.announce = function (lines) { for (const l of lines) S.asked.push({ text: MJ.Voice.PHRASES[l.key], seat: l.seat, t: performance.now() }); return announce.call(this, lines); };
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        const line = { text: n.textContent, t: performance.now() };
        if (/ 胡牌：/.test(line.text)) line.winners = window.__mjDebug.lastResult.winners.map((w) => ({ seat: w.seat, how: w.how, patterns: w.score.patterns }));
        S.lines.push(line);
      }
    }).observe(document.getElementById('logList'), { childList: true });
    addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.act.pass');
      if (b) S.lines.push({ text: '按钮 ' + b.textContent, t: performance.now() });
    }, true);
  });
})();`;

// ---- 一个页面 ----------------------------------------------------------------------
async function open(size, mode, query) {
  const [w, h, touch] = size;
  const profile = mkdtempSync(join(tmpdir(), 'mjvoice-'));
  const proc = spawn(edge, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--ignore-gpu-blocklist',
    ...(GL === 'gpu' ? ['--use-angle=d3d11', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), 'about:blank',
  ], { stdio: 'ignore' });
  // 端口让 Edge 自己挑空着的，写在这个文件里：不会连到别的浏览器上去
  let targets = null;
  for (let i = 0; i < 80 && !targets; i++) {
    try {
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
    } catch { await sleep(200); }
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let msgId = 0;
  const waiting = new Map();
  const noise = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') noise.push('异常: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) noise.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const e = msg.params.entry;
      if (!/manifest\.webmanifest/.test(e.text + e.url)) noise.push('日志: ' + e.text); // 双击打开（file:）时浏览器不肯读 manifest，不碍事
    }
    else if (msg.method === 'Page.javascriptDialogOpening') {
      noise.push('弹出了浏览器的对话框: ' + msg.params.message);
      send('Page.handleJavaScriptDialog', { accept: false });
    }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 80) + ' ' + JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  if (mode !== 'real') await send('Page.addScriptToEvaluateOnNewDocument', { source: inject(mode) });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: touch ? 2 : 1, mobile: touch });
  if (touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const load = async () => {
    await send('Page.navigate', { url: BASE + '?speed=' + SPEED + (query || '') });
    await sleep(2200);
  };
  await load();
  if (touch) await load(); // 无头 Edge：触摸模拟之后第一次打开的网页不给全屏，再打开一次才给
  const tap = async (x, y) => {
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return;
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  };
  const click = async (sel) => {
    const b = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`);
    if (!b) return false;
    await tap(b.x, b.y);
    return true;
  };
  return {
    size, touch, send, ev, tap, click, load, noise,
    shot: async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      if (r.result?.data) writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
    },
    close: async (name) => {
      if (mode !== 'real') for (const e of await ev('window.__t.errors')) check(false, name + ' 页面错误 ' + e);
      for (const n of noise) check(false, name + ' ' + n);
      ws.close();
      proc.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

// ---- 替你打牌：照电脑的主意用真实的点击打，吃碰杠有一半放过 ------------------------------
const STATE = `(()=>{const d=window.__mjDebug;const p=d.pending;const root=document.documentElement;
 if(p&&window.__last!==p){window.__last=p;window.__seq=(window.__seq||0)+1}
 const r={kind:p?p.kind:null,seq:p?window.__seq:0,result:!document.getElementById('resultScreen').hidden,rot:root.classList.contains('rot'),
  resume:!document.getElementById('fsResume').hidden,start:!document.getElementById('startScreen').hidden,acts:[...document.querySelectorAll('#actions .act')].map(b=>b.className.replace('act ',''))};
 if(!p)return r;
 const ai=window.__ai||(window.__ai=MJ.AI.createPlayer({}));
 const a=p.kind==='turn'?ai.chooseTurn(p.view,p.opts):p.kind==='claim'?ai.chooseClaim(p.view,p.claim):ai.chooseRob(p.view,p.info);
 r.act=a.type;
 if(a.type==='discard'){const id=a.id!==undefined?a.id:p.view.hand.find(t=>t.kind===a.kind).id;const s=d.scene;const c=s.project(s.tiles[id].pos);
  const free=(x,y)=>{const e=r.rot?document.elementFromPoint(y,innerHeight-x):document.elementFromPoint(x,y);return e===s.canvas};
  for(const dy of [0,-8,8,-16,16])for(const dx of [0,-4,4,-8,8,-12,12]){if(!r.at&&s.pick(c.x+dx,c.y+dy)===id&&free(c.x+dx,c.y+dy))r.at={x:c.x+dx,y:c.y+dy}}
  if(r.at&&r.rot)r.at={x:r.at.y,y:innerHeight-r.at.x}}
 return r})()`;

async function play(p, hands, hooks) {
  const limit = Date.now() + hands * 240000;
  let done = 0;
  let seq = -1;
  let claims = 0;
  let wasResult = false;
  while (done < hands && Date.now() < limit) {
    await sleep(60);
    const s = await p.ev(STATE);
    if (hooks && hooks.tick) await hooks.tick(s);
    if (s.start) { await p.click('#btnStart'); await sleep(600); continue; }
    if (s.resume) { await p.click('#btnFsResume'); await sleep(300); continue; }
    if (s.result) {
      if (!wasResult) {
        wasResult = true;
        done++;
        await sleep(400);
        if (hooks && hooks.result) await hooks.result(done);
        if (done < hands) await p.click('#btnNext');
        await sleep(300);
      }
      continue;
    }
    wasResult = false;
    if (!s.kind || (s.seq === seq && Math.random() < 0.9)) continue;
    seq = s.seq;
    if (s.kind === 'turn') {
      if (s.act === 'hu' || s.act === 'gang') await p.click('#actions .act.' + s.act);
      else if (s.at) {
        await p.tap(s.at.x, s.at.y);
        if (p.touch) { await sleep(60); await p.tap(s.at.x, s.at.y); }
      }
    } else {
      claims++;
      const want = s.act !== 'pass' && claims % 3 ? s.act : s.acts.includes('hu') ? 'hu' : claims % 2 && s.acts.find((a) => a !== 'pass') || 'pass';
      await p.click('#actions .act.' + want);
    }
  }
  return done;
}

// ---- 牌局记录里应该说的话 ----------------------------------------------------------
const NAMES = ['沈强', '王雷', '徐涌', '吴忠'];
function expected(lines) {
  const out = [];
  let jia = -1;
  let wins = 0;
  for (const l of lines) {
    const t = l.text;
    if (!/ 胡牌：/.test(t)) wins = 0;
    let m;
    if (/^按钮 /.test(t)) out.push([t.includes('抓牌') ? '抓牌。' : '过。', 0]);
    else if (/^骰子 .*开宝/.test(t)) out.push(['开宝！', null]);
    else if ((m = /^(\S+) 补花 /.exec(t))) out.push(['补花！', NAMES.indexOf(m[1])]);
    else if ((m = /^(\S+) 想加杠 /.exec(t))) out.push(['加杠！', jia = NAMES.indexOf(m[1])]);
    else if ((m = /^(\S+) (吃|碰|杠|暗杠)( |$)/.exec(t))) {
      const seat = NAMES.indexOf(m[1]);
      if (!(m[2] === '杠' && jia === seat)) out.push([m[2] + '！', seat]);
      jia = -1;
    } else if ((m = /^(\S+) 和 (\S+) 成三口/.exec(t))) out.push(['三口！', NAMES.indexOf(m[1])]);
    else if (/流局$/.test(t)) out.push(['流局！', 0]);
    else if (/ 胡牌：/.test(t)) {
      const w = l.winners[wins++];
      const special = w.patterns.find((x) => ['八花', '天胡', '地胡'].includes(x));
      out.push([special ? special + '！' : { zimo: '自摸！', ron: '胡了！', rob: '拉杠胡！', qizhuoyi: '七捉一！' }[w.how], w.seat]);
      jia = -1;
    }
  }
  return out;
}

const jobs = {};
const counts = {};

// 开始画面的按键：大小、位置、点一下和点两下、清零了什么、别的没动
async function splash(size) {
  const name = 'splash ' + sizeName(size);
  const p = await open(size, 'fast');
  const KEY = 'mj.totals.v1';
  const seed = {
    'mj.totals.v1': JSON.stringify({ totals: [-12345, 5678, 890, 5777], hands: 1287 }),
    'mj.totals.auto.v1': JSON.stringify({ totals: [1, 2, 3, -6], hands: 9 }),
    'tj.level.v1': '{"a":1}', 'sv.settings': 'x', other: '',
  };
  const dump = () => p.ev('JSON.stringify(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))');
  const label = () => p.ev(`document.getElementById('btnResetTotals').textContent`);
  const layout = async (what) => {
    const r = await p.ev(`(()=>{const q=(s)=>document.querySelector(s);const card=q('#startScreen .card');const b=q('#btnResetTotals');
      const R=(e)=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]};
      const els=[...document.querySelectorAll('#startScreen h1, #startScreen .sub, #startScreen ul, #btnStart, #btnStartRules, #btnResetTotals, #totalsText > span, #startScreen .dedication')];
      const br=R(b);const hit=document.elementFromPoint((br[0]+br[2])/2,(br[1]+br[3])/2);
      return {w:innerWidth,h:innerHeight,card:R(card),b:br,hit:hit===b,cut:b.scrollWidth>b.clientWidth||b.scrollHeight>b.clientHeight,
        scroll:card.scrollHeight>card.clientHeight||card.scrollWidth>card.clientWidth,rects:els.map((e)=>[e.id||e.className||e.tagName,R(e)]),lines:b.getClientRects().length}})()`);
    const bw = r.b[2] - r.b[0];
    const bh = r.b[3] - r.b[1];
    check(Math.min(bw, bh) >= 44, `${name} ${what} 按键 ${bw}×${bh} 小于 44`);
    check(!r.cut, `${name} ${what} 按键上的字放不下`);
    check(r.hit, `${name} ${what} 按键被挡住`);
    check(!r.scroll, `${name} ${what} 开始画面要滚动`);
    check(r.card[0] >= 0 && r.card[1] >= 0 && r.card[2] <= r.w && r.card[3] <= r.h, `${name} ${what} 卡片出了屏幕 ${r.card}`);
    check(r.rects.every(([, a]) => a[0] >= r.card[0] && a[1] >= r.card[1] && a[2] <= r.card[2] && a[3] <= r.card[3]), `${name} ${what} 有东西出了卡片`);
    for (let i = 0; i < r.rects.length; i++) {
      for (let j = i + 1; j < r.rects.length; j++) {
        const [an, a] = r.rects[i];
        const [bn, b] = r.rects[j];
        const x = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
        const y = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        check(!(x > 0.5 && y > 0.5), `${name} ${what} ${an} 和 ${bn} 重叠`);
      }
    }
  };
  // 没存过分数：按键也在
  await p.ev('localStorage.clear()');
  await p.load();
  check(await label() === '所有玩家积分清零', name + ' 没有分数时的按键');
  await layout('没有分数');
  await p.shot('splash-' + sizeName(size) + '-fresh');
  check((await p.ev('window.__t.spoken.length')) === 0, name + ' 还没点就说话');

  await p.ev(`localStorage.clear();for(const [k,v] of Object.entries(${JSON.stringify(seed)}))localStorage.setItem(k,v)`);
  await p.load();
  const before = await dump();
  check((await p.ev(`document.getElementById('totalsText').textContent`)).includes('沈强 -12345'), name + ' 列出的分数');
  await layout('有分数');
  await p.shot('splash-' + sizeName(size));
  await p.ev('window.__t.writes.length=0');

  // 点一下只是问；马上再点（手抖）不算；过了时间变回来
  await p.click('#btnResetTotals');
  check(await label() === '再按一次确认清零', name + ' 点一下以后的字 ' + await label());
  await layout('等第二下');
  await p.shot('splash-' + sizeName(size) + '-armed');
  check(await dump() === before, name + ' 只点一下就动了存储');
  await sleep(4200);
  check(await label() === '所有玩家积分清零', name + ' 没点第二下，过几秒应该变回来');
  check(await dump() === before, name + ' 没确认就动了存储');
  const quick = await p.ev(`(()=>{const b=document.getElementById('btnResetTotals');b.click();b.click();b.click();return b.textContent})()`);
  check(quick === '再按一次确认清零' && await dump() === before, name + ' 连点三下应该只算第一下 ' + quick);
  await sleep(4300);
  check(await label() === '所有玩家积分清零', name + ' 连点以后过几秒应该变回来');
  // 点一下，点别处，不清零
  await p.click('#btnStartRules');
  await sleep(600); // 等弹窗的动画完，位置才准
  await p.click('#btnRulesClose');
  await sleep(200);
  check(await dump() === before && (await p.ev('window.__t.writes.length')) === 0, name + ' 看规则动了存储');

  // 两下：清零
  await p.click('#btnResetTotals');
  await sleep(800);
  await p.click('#btnResetTotals');
  const after = await p.ev(`(()=>{const b=document.getElementById('btnResetTotals');const t=b.textContent;b.click();return [t,b.textContent]})()`);
  check(after.join() === '积分已清零,积分已清零', name + ' 清零以后的字、马上又点一下 ' + after);
  await layout('已清零');
  const text = await p.ev(`document.getElementById('totalsText').textContent`);
  check(text === '总输赢（已打 0 局）：沈强 0王雷 0徐涌 0吴忠 0', name + ' 清零以后列出的 ' + text);
  const zero = JSON.stringify({ totals: [0, 0, 0, 0], hands: 0 });
  const want = JSON.stringify(JSON.parse(before).map(([k, v]) => [k, k === KEY ? zero : v]));
  check(await dump() === want, name + ' 清零以后的存储 ' + await dump());
  const writes = await p.ev('window.__t.writes');
  check(writes.length === 1 && writes[0] === 'setItem ' + KEY, name + ' 写了存储 ' + writes);
  await p.shot('splash-' + sizeName(size) + '-done');
  await sleep(2300);
  check(await label() === '所有玩家积分清零', name + ' 清零以后过几秒变回来');
  check(JSON.stringify(await p.ev('window.__mjDebug.totals')) === zero, name + ' 游戏里的总输赢');

  // 不重新载入就开局：名牌上是 0，从第 1 局开始；重新载入也是 0
  await p.click('#btnStart');
  let plates = [];
  for (let i = 0; i < 40 && plates.length < 4; i++) {
    await sleep(200);
    plates = await p.ev(`[...document.querySelectorAll('.plate .total')].map(e=>e.textContent)`);
  }
  check(plates.join() === '0,0,0,0', name + ' 名牌 ' + plates);
  check((await p.ev(`document.getElementById('roundInfo').textContent`)).includes('第 1 局'), name + ' 第 1 局');
  await p.load();
  check((await p.ev(`document.getElementById('totalsText').textContent`)).includes('已打 0 局'), name + ' 重新载入以后');
  await p.close(name);
}
for (const z of SIZES) jobs['splash ' + sizeName(z)] = () => splash(z);

// 真的打几局：说的话和牌局记录一句一句地对，谁说的用谁的声音
async function playAndCompare(size) {
  const name = 'play ' + sizeName(size);
  const p = await open(size, 'fast');
  let shots = 0;
  const done = await play(p, HANDS, {
    tick: async () => {
      if (shots === 0 && (await p.ev('window.__t.spoken.length')) > 6) { shots = 1; await p.shot('table-' + sizeName(size)); }
    },
    result: async (n) => { if (n === 1) await p.shot('result-' + sizeName(size)); },
  });
  check(done === HANDS, name + ' 只打完 ' + done + ' 局');
  const t = await p.ev('({spoken:window.__t.spoken,asked:window.__t.asked,lines:window.__t.lines,maxLive:window.__t.maxLive,cancels:window.__t.cancels,seats:MJ.Voice.pickVoices(speechSynthesis.getVoices()).map(s=>({voice:s.voice.name,pitch:s.pitch,rate:s.rate}))})');
  check(t.spoken[0] && t.spoken[0].text === '' && t.spoken[0].volume === 0 && t.spoken[0].tap, name + ' 第一句应该是点击里的空话');
  check(t.spoken.filter((s) => s.text === '').length === 1, name + ' 空话只说一次');
  const got = t.spoken.filter((s) => s.text !== '');
  const want = expected(t.lines);
  const a = got.map((s) => s.text).join(' ');
  const b = want.map((s) => s[0]).join(' ');
  check(a === b, name + ' 说的和记录不一样\n    说的 ' + a + '\n    应该 ' + b);
  check(got.length > 5 * HANDS / 2, name + ' 说得太少 ' + got.length);
  check(t.asked.map((s) => s.text).join(' ') === b, name + ' 牌局要说的和记录不一样');
  got.forEach((s, i) => {
    const seat = want[i] && want[i][1];
    if (seat === null || seat === undefined) return;
    const v = t.seats[seat];
    check(s.voice === v.voice && s.pitch === v.pitch && s.rate === v.rate && s.volume === 1, `${name} 第 ${i} 句 ${s.text} 座位 ${seat} 的声音 ${s.voice} ${s.pitch}`);
    check(s.lang === 'wuu-CN', name + ' 有上海话就用上海话 ' + s.lang);
  });
  check(new Set(got.map((s) => s.voice + s.pitch)).size >= 3, name + ' 几家的声音要不一样');
  check(t.maxLive === 1, name + ' 同时交给浏览器 ' + t.maxLive + ' 句');
  check(t.cancels <= done, name + ' 打断了 ' + t.cancels + ' 次'); // 只有一局的结果可以打断还没出声的一句（刚点「过」，别家就胡了）
  for (const s of got) counts[s.text] = (counts[s.text] || 0) + 1;
  console.log('  ' + name + '：' + done + ' 局，说了 ' + got.length + ' 句');
  await p.close(name);
}
for (const z of SIZES.slice(0, 3)) jobs['play ' + sizeName(z)] = () => playAndCompare(z);

// 说得慢（一句两秒）、牌局快：排队只留一句，不拖在牌局后面，结果一定说
jobs.slow = async () => {
  const p = await open([844, 390, true], 'slow');
  const done = await play(p, HANDS);
  await sleep(3000);
  const t = await p.ev('({spoken:window.__t.spoken,asked:window.__t.asked,lines:window.__t.lines,maxLive:window.__t.maxLive})');
  check(done === HANDS, 'slow 只打完 ' + done + ' 局');
  const got = t.spoken.filter((s) => s.text !== '');
  const want = expected(t.lines).map((s) => s[0]);
  check(t.maxLive === 1, 'slow 同时交给浏览器 ' + t.maxLive + ' 句');
  check(got.length > 3 && got.length <= want.length, 'slow 说了 ' + got.length + ' 句，一共 ' + want.length);
  // 说的是应该说的话的一个子序列（丢掉的是被代替的、等太久的）
  let k = 0;
  for (const s of got) { while (k < want.length && want[k] !== s.text) k++; k++; }
  check(k <= want.length, 'slow 说的次序不对 ' + got.map((s) => s.text).join(' ') + ' | ' + want.join(' '));
  // 从牌局要说到真的说，不能拖
  const lags = got.map((s) => s.t - Math.max(...t.asked.filter((a) => a.text === s.text && a.t <= s.t).map((a) => a.t))).sort((a, b) => a - b);
  const lag = lags[lags.length - 1];
  check(lag < 1300, 'slow 最慢的一句落在牌局后面 ' + Math.round(lag) + ' 毫秒');
  check(lags[lags.length >> 1] < 50, 'slow 一半的话应该马上说，中间的落后 ' + Math.round(lags[lags.length >> 1]) + ' 毫秒');
  // 每局的结果都说了
  const ends = (list) => list.filter((x) => /^(自摸|胡了|拉杠胡|七捉一|八花|天胡|地胡|流局)！$/.test(x)).join(' ');
  check(ends(got.map((s) => s.text)) === ends(want), 'slow 结果 ' + ends(got.map((s) => s.text)) + ' 应该 ' + ends(want));
  console.log('  slow：' + done + ' 局，该说 ' + want.length + ' 句，说了 ' + got.length + ' 句，最慢的落后 ' + Math.round(lag) + ' 毫秒');
  await p.close('slow');
};

// 关声音：一句也不说；再打开：接着说
jobs.mute = async () => {
  const p = await open([1280, 800, false], 'fast', '&auto=1');
  await p.tap(640, 20);
  await p.tap(640, 400);
  const n = () => p.ev('window.__t.spoken.filter(s=>s.text).length');
  const lines = () => p.ev('window.__t.lines.length');
  const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
  check(await until(async () => (await n()) >= 3, 90000), 'mute 开着的时候应该说话');
  await p.click('#btnSound');
  check((await p.ev(`document.getElementById('btnSound').textContent`)) === '声音：关', 'mute 按钮的字');
  const n0 = await n();
  const l0 = await lines();
  check(await until(async () => expected((await p.ev('window.__t.lines')).slice(l0)).length >= 5, 120000), 'mute 关着的时候牌局照走');
  check(await n() === n0, 'mute 关着还说了 ' + ((await n()) - n0) + ' 句');
  await p.click('#btnSound');
  check(await until(async () => (await n()) > n0, 120000), 'mute 再打开应该接着说');
  await p.close('mute');
};

// 没有语音、语音一用就出错、没有中文声音、声音晚载入：牌局照样打完
for (const mode of ['none', 'throw', 'novoice', 'late']) {
  jobs[mode] = async () => {
    const p = await open([844, 390, true], mode, '&auto=1');
    await p.tap(400, 200);
    const end = Date.now() + 240000;
    let hands = 0;
    while (Date.now() < end && hands < 1) { await sleep(300); hands = await p.ev(`(window.__mjDebug.lastResult?1:0)`); }
    check(hands === 1, mode + ' 没打完一局');
    const said = await p.ev('window.__t.spoken.filter(s=>s.text).map(s=>[s.text,s.lang])');
    const lines = expected(await p.ev('window.__t.lines'));
    if (mode === 'late') check(said.length > 0 && said.length < lines.length && said.every((s) => s[1] === 'wuu-CN'), 'late 说了 ' + said.length + ' / ' + lines.length);
    else check(said.length === 0, mode + ' 说了 ' + said.join(' '));
    console.log('  ' + mode + '：打完一局，说了 ' + said.length + ' / ' + lines.length + ' 句');
    await p.close(mode);
  };
}

const t0 = Date.now();
const todo = Object.keys(jobs).filter((k) => !ONLY.length || ONLY.some((o) => k === o || k.startsWith(o + ' ')));
const runner = async () => {
  for (let k = todo.shift(); k; k = todo.shift()) {
    try { await jobs[k](); } catch (e) { check(false, k + ' ' + (e.stack || e)); }
    console.log(k + ' 完成');
  }
};
await Promise.all([runner(), runner(), runner()]);
if (Object.keys(counts).length) console.log('说过的话 ' + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + v).join(' '));
console.log(`${checks} 项检查，${problems.length} 个问题，${Math.round((Date.now() - t0) / 1000)} 秒`);
for (const p of problems) console.log('  ' + p);
process.exit(problems.length ? 1 : 0);

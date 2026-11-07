// 用无头 Edge 真实打开游戏，用真实鼠标事件玩，截图并收集控制台错误。
//   node tests/browser_check.mjs <截图目录> [宽] [高] [速度] [局数]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [outDir = 'shots', w = '1600', h = '900', speed = '3', hands = '1', touch = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9650 + Math.floor(Math.random() * 140);
const profile = mkdtempSync(join(tmpdir(), 'tjshot-'));
const proc = spawn(edge, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets = null;
for (let i = 0; i < 60 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let msgId = 0;
const pendingMsgs = new Map();
const problems = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pendingMsgs.has(msg.id)) { pendingMsgs.get(msg.id)(msg); pendingMsgs.delete(msg.id); }
  else if (msg.method === 'Runtime.exceptionThrown') {
    problems.push('异常: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    problems.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push('日志: ' + msg.params.entry.text);
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; pendingMsgs.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
let shotNo = 0;
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(outDir, String(++shotNo).padStart(2, '0') + '-' + name + '.png');
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('截图', file);
};
const mouse = async (x, y, click) => {
  if (touch) {
    if (click) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    return;
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
  if (click) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  }
};
const clickEl = async (sel) => {
  const box = await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width}})()`);
  if (!box || !box.w) throw new Error('找不到 ' + sel);
  await mouse(box.x, box.y, true);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: touch ? 2 : 1, mobile: !!touch });
if (touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url: 'file:///' + root.replace(/\\/g, '/') + '/index.html?speed=' + speed });
await sleep(3000);
await shot('start');
await clickEl('#btnStart');

const finished = [];
let handsLeft = +hands;
let dealShot = false;
let turnShots = 0;
let buryShot = false;
let clicks = 0;
let bidsSeen = 0;
const t0 = Date.now();
while (handsLeft > 0 && Date.now() - t0 < 9 * 60000) {
  await sleep(150);
  const st = await evalJs(`(()=>{const d=window.__tjDebug;if(!d)return null;const s=d.scene;
    const resultOpen=!document.getElementById('resultScreen').hidden;
    const me=s.seats[0];const list=me?me.hand:[];
    return {pending:d.pendingKind,resultOpen,hand:list.length,
      bidButtons:document.querySelectorAll('#actions .act.bid').length,
      tiles:list.map(id=>{const c=s.cards[id];return {id,...s.project(c.pos)}}),
      plays:s.seats.reduce((a,x)=>a+x.play.length,0)};})()`);
  if (!st) continue;
  if (!dealShot && st.hand >= 12) { dealShot = true; await shot('dealing'); }
  if (st.resultOpen) {
    await sleep(500);
    const summary = await evalJs(`(()=>{const r=window.__tjDebug.lastResult;return {attackers:r.attackerPoints,dealer:r.dealer,trump:r.trump,level:r.level,winner:r.winnerTeam,up:r.up,kitty:r.kittyPoints,mult:r.multiplier,levels:r.levelsAfter,next:r.nextDealer}})()`);
    finished.push(summary);
    console.log('本局结果', JSON.stringify(summary));
    await shot('result' + finished.length);
    handsLeft--;
    if (handsLeft > 0) {
      await clickEl('#btnViewTable');
      await sleep(400);
      await shot('table' + finished.length);
      await clickEl('#btnBackResult');
      await sleep(200);
      await clickEl('#btnNext');
      dealShot = false;
    }
    continue;
  }
  if (st.pending === 'bid') {
    bidsSeen++;
    await shot('lastcall');
    await clickEl('#actions .act.pass');
    continue;
  }
  if (st.pending === 'bury' || st.pending === 'lead' || st.pending === 'follow') {
    if (st.pending === 'bury' && !buryShot) { buryShot = true; await sleep(800); await shot('bury'); }
    // 真实点几张牌，走一遍选牌和撤销，再用提示按钮选牌出牌
    if (clicks < 8 && st.tiles.length) {
      const t = st.tiles[Math.floor(st.tiles.length / 2)];
      await mouse(t.x, t.y - 20, true);
      await sleep(120);
      if (turnShots < 2 && st.pending !== 'bury') { await shot('selected'); }
      await mouse(t.x, t.y - 20, true);
      clicks++;
    }
    await clickEl('#actions .act.tip');
    for (let i = 0; i < 40 && await evalJs(`document.getElementById('btnConfirm').disabled`); i++) await sleep(120);
    if (st.pending !== 'bury' && turnShots < 4) { turnShots++; await shot('turn' + turnShots); }
    const dis = await evalJs(`document.getElementById('btnConfirm').disabled`);
    if (dis) { problems.push('提示选的牌不能出：' + st.pending + ' ' + (await evalJs(`document.getElementById('hint').textContent`))); break; }
    await clickEl('#btnConfirm');
    await sleep(160);
  }
}
if (handsLeft > 0) problems.push('超时：没打完 ' + hands + ' 局');
console.log(JSON.stringify({ finished: finished.length, clicks, bidsSeen }));
if (problems.length) {
  console.log('发现问题：');
  problems.slice(0, 30).forEach((p) => console.log('  ' + p));
} else {
  console.log('控制台没有错误');
}
ws.close();
proc.kill();
await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(problems.length ? 1 : 0);

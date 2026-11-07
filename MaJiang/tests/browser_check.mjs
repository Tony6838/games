// 用无头 Edge 真实打开游戏，用真实鼠标事件玩一局，截图并收集控制台错误。
//   node tests/browser_check.mjs <截图目录> [宽] [高] [速度] [局数] [auto] [touch]   （touch=1 用手机的触摸事件）
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [outDir = 'shots', w = '1600', h = '900', speed = '3', hands = '1', auto = '', touch = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9800 + Math.floor(Math.random() * 150);
const profile = mkdtempSync(join(tmpdir(), 'mjshot-'));
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
const url = 'file:///' + root.replace(/\\/g, '/') + '/index.html?speed=' + speed + (auto === 'auto' ? '&auto=1' : '');
await send('Page.navigate', { url });
await sleep(2500);
await shot('start');

const finished = [];
let handsLeft = +hands;
if (auto !== 'auto') await clickEl('#btnStart');
let sawTurn = false;
let hoverShot = false;
let dealShot = false;
let lateShot = 0;
let claims = 0;
let discards = 0;
const t0 = Date.now();
const limitMs = 8 * 60000;
while (handsLeft > 0 && Date.now() - t0 < limitMs) {
  await sleep(120);
  const st = await evalJs(`(()=>{const d=window.__mjDebug;if(!d)return null;
    const s=d.scene;const resultOpen=!document.getElementById('resultScreen').hidden;
    const me=s.seats&&s.seats[0];
    const list=me?(me.drawn!==null?me.hand.concat([me.drawn]):me.hand):[];
    return {pending:d.pendingKind,resultOpen,walls:s.tiles.length,hand:list.length,
      interactive:s.interactive,
      tiles:list.map(id=>{const t=s.tiles[id];return {id,kind:t.kind,...s.project(t.pos)}}),
      discards:(s.seats||[]).reduce((a,x)=>a+x.discards.length,0)};})()`);
  if (!st) continue;
  if (!dealShot && st.hand >= 8) { dealShot = true; await shot('dealing'); }
  if (st.resultOpen) {
    await sleep(600);
    const summary = await evalJs(`(()=>{const r=window.__mjDebug.lastResult;return {type:r.type,deltas:r.deltas,winners:r.winners.map(w=>({seat:w.seat,how:w.how,points:w.score.points,patterns:w.score.patterns}))}})()`);
    finished.push(summary);
    console.log('本局结果', JSON.stringify(summary));
    await shot('result' + finished.length);
    handsLeft--;
    if (handsLeft > 0) {
      await clickEl('#btnViewTable');
      await sleep(500);
      await shot('table' + finished.length);
      await clickEl('#btnBackResult');
      await sleep(200);
      if (auto !== 'auto') await clickEl('#btnNext');
      dealShot = false;
    }
    continue;
  }
  if (st.pending === 'turn' && st.tiles.length) {
    sawTurn = true;
    const pick = st.tiles[st.tiles.length - 1 - (discards % Math.min(3, st.tiles.length))];
    await mouse(pick.x, pick.y - 12, false);
    await sleep(160);
    if (!hoverShot) { hoverShot = true; await shot('hover'); }
    if (st.discards > 40 && lateShot === 0) { lateShot = 1; await shot('midgame'); }
    if (st.discards > 58 && lateShot === 1) { lateShot = 2; await shot('lategame'); }
    const huBtn = await evalJs(`!!document.querySelector('#actions .act.hu')`);
    if (huBtn) { await clickEl('#actions .act.hu'); continue; }
    await mouse(pick.x, pick.y - 12, true);
    if (touch) { await sleep(140); await mouse(pick.x, pick.y - 12, true); }
    discards++;
    await sleep(120);
    continue;
  }
  if (st.pending === 'claim' || st.pending === 'rob') {
    claims++;
    if (claims <= 2) await shot('claim' + claims);
    const pref = await evalJs(`(()=>{for(const c of ['hu','peng','gang','chi']){if(document.querySelector('#actions .act.'+c))return c}return 'pass'})()`);
    // 大约一半的吃碰会接受，把各种路径都走一遍
    const choose = pref === 'hu' || claims % 2 === 0 ? pref : 'pass';
    await clickEl('#actions .act.' + choose);
    await sleep(120);
  }
}
if (handsLeft > 0) problems.push('超时：' + hands + ' 局没打完');
console.log(JSON.stringify({ sawTurn, claims, discards, finished: finished.length }));
const perf = await evalJs(`new Promise(res=>{let n=0;const t=performance.now();function f(){if(++n===30)res(Math.round(30000/(performance.now()-t)));else requestAnimationFrame(f)}requestAnimationFrame(f)})`);
console.log('软件渲染下帧率约', perf, 'fps');
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

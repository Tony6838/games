// Headless Edge screenshots for the game (same approach as the Viking web UI's shot.mjs).
//   node tests/shoot.mjs <stepsFile.json>
// stepsFile: { "url": "...", "sizes": [[1920,1080,0], [390,844,1]], "out": "screenshots/x",
//              "steps": [{ "name": "splash", "js": "await sleep(500)", "wait": 0,
//                          "swipe": {x1,y1,x2,y2,ms}, "click": "css selector" }] }
// Each step: optional plain wait, a real pointer swipe or click, the script (awaited in the page),
// then a screenshot <out>_<w>x<h>_<name>.png. Console errors and failed requests are printed.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(w, h, mobile) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = mkdtempSync(join(tmpdir(), 'vbgshot-'));
  const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-extensions', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const log = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') log.push('EXCEPTION ' + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 400));
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
      log.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) log.push('HTTP ' + msg.params.response.status + ' ' + msg.params.response.url);
    if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) log.push('NETFAIL ' + msg.params.errorText);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return 'EXCEPTION: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: spec.url });
  await sleep(spec.loadWait || 2500);
  mkdirSync(dirname(spec.out), { recursive: true });
  for (const step of spec.steps) {
    if (step.wait) await sleep(step.wait);
    if (step.click) {
      const c = await evaluate(`const e = document.querySelector(${JSON.stringify(step.click)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
      if (c) {
        if (mobile) {
          await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
          await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
        }
        await sleep(step.clickWait || 400);
      } else log.push('click target not found: ' + step.click);
    }
    if (step.swipe) {
      let s = step.swipe;
      if (typeof s === 'string') s = await evaluate(s);
      const n = 14, dt = (s.ms || 300) / n;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const curve = (s.curve || 0) * Math.sin(Math.PI * t) * t;
        pts.push({ x: s.x1 + (s.x2 - s.x1) * t + curve, y: s.y1 + (s.y2 - s.y1) * t });
      }
      if (mobile) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
        for (let i = 1; i <= n; i++) { await sleep(dt); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pts[i]] }); }
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= n; i++) { await sleep(dt); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[i].x, y: pts[i].y, button: 'left', buttons: 1 }); }
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts[n].x, y: pts[n].y, button: 'left', buttons: 0, clickCount: 1 });
      }
    }
    if (step.js) { const v = await evaluate(step.js); if (v !== undefined) console.log(`  ${step.name}:`, typeof v === 'string' ? v.slice(0, 600) : JSON.stringify(v).slice(0, 600)); }
    if (step.shot !== false) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = `${spec.out}_${w}x${h}_${step.name}.png`;
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    }
  }
  ws.close();
  proc.kill();
  return log;
}

for (const [w, h, mobile] of spec.sizes) {
  const log = await run(w, h, mobile);
  console.log(`${w}x${h}${mobile ? ' (touch)' : ''}: ${log.length ? '\n  ' + [...new Set(log)].join('\n  ') : 'no errors'}`);
}

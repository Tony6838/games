// A small Chrome DevTools Protocol driver for headless Edge (the same approach as shoot.mjs):
// real pointer input (Input.dispatchMouseEvent / dispatchTouchEvent), page scripts, screenshots,
// and every exception, console error and failed request collected.
//   const b = await openBrowser({ w, h, mobile, gpu });  await b.go(url);  await b.click('#okBtn');
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openBrowser({ w = 1280, h = 800, mobile = false, gpu = false, scale = 1 } = {}) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = mkdtempSync(join(tmpdir(), 'vbgcdp-'));
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-extensions', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    `--window-size=${w},${h}`];
  if (gpu) args.push('--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-webgpu');
  else args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
  const proc = spawn(EDGE, [...args, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 80 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const log = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') log.push('EXCEPTION ' + String(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 500));
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
      log.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) log.push('HTTP ' + msg.params.response.status + ' ' + msg.params.response.url);
    if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) log.push('NETFAIL ' + msg.params.errorText + ' ' + (msg.params.type || ''));
    // an alert() (the console's "the score changed while the form was open") is answered at once
    if (msg.method === 'Page.javascriptDialogOpening') {
      log.push('DIALOG ' + msg.params.type + ': ' + String(msg.params.message).slice(0, 200));
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: !!mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const b = {
    w, h, mobile, log, send,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: `(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) return { error: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) };
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async go(url, wait = 2500) { await send('Page.navigate', { url }); await sleep(wait); },
    // the centre of an element (in the page, or inside a same-origin iframe given by its selector)
    async center(sel, frameSel = null) {
      return b.eval(`const f = ${JSON.stringify(frameSel)} ? document.querySelector(${JSON.stringify(frameSel)}) : null;
        const doc = f ? f.contentDocument : document; const e = doc && doc.querySelector(${JSON.stringify(sel)});
        if (!e) return null; let r = e.getBoundingClientRect(); if (!r.width && !r.height) return null;
        // a control below the fold (a short screen) is scrolled into view first, as a user would
        const vw = f ? doc.defaultView.innerWidth : innerWidth, vh = f ? doc.defaultView.innerHeight : innerHeight;
        if (r.bottom > vh || r.top < 0 || r.right > vw || r.left < 0) { e.scrollIntoView({ block: 'center', inline: 'nearest' }); await new Promise((q) => setTimeout(q, 250)); r = e.getBoundingClientRect(); }
        const fr = f ? f.getBoundingClientRect() : { x: 0, y: 0 };
        return { x: fr.x + r.x + r.width / 2, y: fr.y + r.y + r.height / 2 };`);
    },
    async tap(x, y) {
      if (mobile) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await sleep(40);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await sleep(40);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
    },
    async click(sel, frameSel = null) {
      const c = await b.center(sel, frameSel);
      if (!c || c.error) return false;
      await b.tap(c.x, c.y);
      return true;
    },
    // a swipe: a press, steps along the path with their own times, a release
    // Every event carries its own time (CDP's timestamp, seconds since the epoch), as a finger's
    // events do: the game times a swipe by the events' clock, so a slow software renderer that
    // handles them late still gets the swipe's real speed.
    async swipe(x1, y1, x2, y2, ms = 220, steps = 14, curve = 0) {
      const pt = (k) => { const t = k / steps; return { x: x1 + (x2 - x1) * t + curve * Math.sin(Math.PI * t) * Math.abs(y2 - y1) * 0.15, y: y1 + (y2 - y1) * t }; };
      const t0 = Date.now() / 1000, at = (k) => t0 + (k * ms / steps) / 1000;
      if (mobile) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }], timestamp: at(0) });
        for (let k = 1; k <= steps; k++) { const p = pt(k); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p], timestamp: at(k) }); }
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: at(steps) + 0.005 });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, timestamp: at(0) - 0.01 });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, timestamp: at(0) });
        for (let k = 1; k <= steps; k++) { const p = pt(k); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, timestamp: at(k) }); }
        const p = pt(steps);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, timestamp: at(steps) + 0.005 });
      }
      await sleep(ms);
    },
    async shot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    },
    async close() { try { await send('Browser.close'); } catch { /* gone */ } try { proc.kill(); } catch { /* gone */ } }
  };
  return b;
}

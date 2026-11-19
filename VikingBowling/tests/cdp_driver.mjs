// A minimal CDP driver for headless Edge (tests/motion_browser.mjs) and for Chrome on Android
// over adb forward (tests/motion_android.mjs).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Connect to a page's websocket; collects exceptions, console errors and failed requests in log
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0;
  const pending = new Map(), log = [], listeners = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    for (const l of listeners) l(msg);
    if (msg.method === 'Runtime.exceptionThrown') log.push('EXCEPTION ' + String(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 600));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') log.push('CONSOLE.ERROR ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) log.push('HTTP ' + msg.params.response.status + ' ' + msg.params.response.url);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr, userGesture = false) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture });
    if (r.error) return 'CDP ERROR: ' + JSON.stringify(r.error);
    if (r.result && r.result.exceptionDetails) return 'EXCEPTION: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  return { ws, send, evaluate, log, on: (f) => listeners.push(f), close: () => { try { ws.close(); } catch { /* closed */ } } };
}

// Headless Edge with a throw-away profile
export async function launchEdge({ w = 390, h = 844, extra = [] } = {}) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'vbgmotion-'));
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions',
    '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    // the GPU (as tests/shoot.mjs and the README's frame times): with software WebGL the page's main
    // thread is busy for ~100 ms a frame and the sensor events come late and thinned out
    ...(process.env.SWGL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist']),
    `--window-size=${w},${h}`, ...extra, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 80 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } }
  const page = targets.find((t) => t.type === 'page');
  const B = await connect(page.webSocketDebuggerUrl);
  B.port = port;
  const close = B.close;
  B.close = () => { close(); try { proc.kill(); } catch { /* gone */ } };
  return B;
}

// 用无头 Edge 的 canvas 画网页图标（主屏幕、标签页用），写到 icons/。
//   node tools/make_icons.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9500 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'svicon-'));
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = null;
for (let i = 0; i < 60 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

const draw = `(async () => {
  const out = {};
  for (const n of [180, 192, 512]) {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const s = n / 512;
    g.fillStyle = '#0b5cad';
    g.fillRect(0, 0, n, n);
    // 一道浅色的北欧十字
    g.fillStyle = 'rgba(255, 210, 63, 0.22)';
    g.fillRect(150 * s, 0, 70 * s, n);
    g.fillRect(0, 300 * s, n, 70 * s);
    g.fillStyle = '#ffd23f';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = 'bold ' + Math.round(250 * s) + 'px "Segoe UI", Arial, sans-serif';
    g.fillText('Sv', 256 * s, 285 * s);
    g.fillStyle = '#ffffff';
    g.font = 'bold ' + Math.round(118 * s) + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
    g.fillText('读报', 256 * s, 440 * s);
    out[n] = c.toDataURL('image/png');
  }
  return out;
})()`;
const r = await send('Runtime.evaluate', { expression: draw, awaitPromise: true, returnByValue: true });
const urls = r.result.result.value;
for (const [n, url] of Object.entries(urls)) {
  const file = join(root, 'icons', `icon-${n}.png`);
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log('写入', file);
}
ws.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge 可能还没放手 */ }

// 调关键词用：在无头 Edge 里取一遍各话题的 SR 源，列出每个话题的候选文章和得分（今天的标 *，简易的标「易」）。
//   node tools/topic_report.mjs [话题键，比如 elbilar] [每个话题列几篇，默认 8]
// 每个 SR 源只取一次（页面里有缓存），所有话题加起来二十几个请求。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [only = '', limit = '8'] = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(repoRoot, p));
  try {
    if (!file.startsWith(repoRoot) || !statSync(file).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9450 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'svtopic-'));
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/Svenska/` });
await sleep(2500);
const r = await send('Runtime.evaluate', {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => {
    const out = [];
    const today = SV.stockholmDay(new Date());
    for (const t of SV.sources.TOPICS) {
      if (${JSON.stringify(only)} && t.key !== ${JSON.stringify(only)}) continue;
      const res = await SV.sources.loadTopic(t);
      const list = res.cands.slice().sort((a, b) => b.score - a.score || b.item.published - a.item.published);
      out.push('== ' + t.key + ' ' + t.zh + '：' + res.cands.length + ' 篇' + (res.loose ? '（没有够分的，用的是 2 分以上的）' : '') + (res.failed ? '，' + res.failed + ' 个源没取到' : ''));
      for (const c of list.slice(0, ${+limit})) out.push('  ' + String(c.score).padStart(3) + (c.item.day === today ? ' *' : '  ') + (c.item.easy ? '易 ' : '   ') + c.item.day + ' ' + c.item.program.slice(0, 22).padEnd(22) + ' ' + c.item.title);
    }
    return out.join('\\n');
  })()`,
});
console.log(r.result.result ? r.result.result.value : JSON.stringify(r.result));
ws.close();
proc.kill();
server.close();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }

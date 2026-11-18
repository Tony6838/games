// A small static file server for testing the game the way GitHub Pages serves it:
// case-sensitive paths (Windows is not, Pages is), UTF-8 paths, correct MIME types, and a
// log of every 404 so a file the pages ask for under another spelling is found before
// publishing.  node tests/serve.mjs [port=8765] [root=..]
import http from 'node:http';
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = parseInt(process.argv[2] || '8765', 10);
const root = resolve(process.argv[3] || join(here, '..'));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.lang': 'text/plain', '.ini': 'text/plain', '.h001': 'application/octet-stream', '.r001': 'application/octet-stream', '.md': 'text/plain; charset=utf-8'
};
const misses = new Set();

// Every path segment must exist with exactly this spelling
function exactCase(full) {
  const rel = full.substring(root.length).split(sep).filter(Boolean);
  let cur = root;
  for (const part of rel) {
    let names;
    try { names = readdirSync(cur); } catch { return false; }
    if (!names.includes(part)) return false;
    cur = join(cur, part);
  }
  return true;
}

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  let full = resolve(join(root, p));
  if (!full.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try { if (statSync(full).isDirectory()) full = join(full, 'index.html'); } catch { /* 404 below */ }
  if (!existsSync(full) || !exactCase(full)) {
    if (!misses.has(p)) { misses.add(p); console.log('404', p, existsSync(full) ? '(exists with another case)' : ''); }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(full));
}).listen(port, '0.0.0.0', () => console.log(`Serving ${root} on http://127.0.0.1:${port}/`));

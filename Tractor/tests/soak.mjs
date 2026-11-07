// 真实界面的长跑测试：无头 Edge 里让四家电脑打，监控错误、流畅度、内存、界面与裁判是否一致、布局。
//   node tests/soak.mjs <输出目录> [--hands 300] [--par 6] [--w 844] [--h 390] [--dpr 2] [--speed 6]
//                       [--throttle 1] [--gl gpu|swiftshader] [--stall 300]
//                       [--sizes 844x390x2,667x375x2,1600x900x1]   每个页面轮流用一种屏幕
//                       [--base https://tony6838.github.io/games/MaJiang/]   测线上的版本，不测本地文件
//                       [--human 1]   不用电脑代打，由 tests/robot.mjs 用真实点击玩你的座位，单数页面用触摸
// 麻将和拖拉机共用这份脚本（两边各放一份），自动识别是哪个游戏。
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newRobotStats, runRobot } from './robot.mjs';

const argv = process.argv.slice(2);
const outDir = argv[0] || 'soak';
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const HANDS = +opt('hands', 300);
const PAR = +opt('par', 6);
const W = +opt('w', 844);
const H = +opt('h', 390);
const DPR = +opt('dpr', 2);
const SPEED = +opt('speed', 6);
const THROTTLE = +opt('throttle', 1);
const GL = opt('gl', 'gpu');
const STALL_S = +opt('stall', 300);
const HUMAN = opt('human', '0') === '1';
const BASE = opt('base', '');
const SIZES = opt('sizes', '').split(',').filter(Boolean).map((x) => x.split('x').map(Number));
mkdirSync(outDir, { recursive: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 注入页面的监控 ----------------------------------------------------------------
const PAGE_MONITOR = `(() => {
  const newFrames = () => ({ n: 0, sum: 0, over33: 0, over50: 0, over100: 0, over250: 0, max: 0, jsSum: 0, jsMax: 0, consoleCalls: 0, consoleMs: 0 });
  const S = window.__soak = {
    errors: [], longTasks: [], hands: [], frames: newFrames(), viol: {}, plate: {}, overlap: {}, shot: null,
    samples: 0, installed: false, consistency: [], cardOverflow: 0, lastEnd: performance.now(),
    renderer: '', glErrors: 0,
  };
  const AC = window.AudioContext;
  if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ac = this; } };
  addEventListener('error', (e) => S.errors.push('error: ' + e.message + ' @' + e.filename + ':' + e.lineno));
  addEventListener('unhandledrejection', (e) => S.errors.push('rejection: ' + (e.reason && e.reason.stack || e.reason)));
  const origErr = console.error;
  console.error = function (...a) { S.errors.push('console.error: ' + a.map(String).join(' ')); return origErr.apply(this, a); };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) S.longTasks.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}
  let last = performance.now();
  const tick = () => {
    const n = performance.now();
    const d = n - last;
    last = n;
    const f = S.frames;
    f.n++;
    f.sum += d;
    if (d > 33.4) f.over33++;
    if (d > 50) f.over50++;
    if (d > 100) f.over100++;
    if (d > 250) f.over250++;
    if (d > f.max) f.max = d;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const debug = () => window.__mjDebug || window.__tjDebug;
  const isMJ = () => !!window.__mjDebug;
  const dims = () => (isMJ() ? [0.5, 0.675, 0.39] : [0.5, 0.7, 0.011]);
  const items = (sc) => (isMJ() ? sc.tiles : sc.cards);

  function rectOf(sc, t, ns) {
    const [hx, hy, hz] = dims();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const v = ns.GFX.Quat.rotate(t.q, [sx * hx * t.s, sy * hy * t.s, sz * hz * t.s]);
      const p = sc.project([t.pos[0] + v[0], t.pos[1] + v[1], t.pos[2] + v[2]]);
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  }

  function groups(sc) {
    const g = {};
    const add = (name, id) => { (g[name] = g[name] || []).push(id); };
    sc.seats.forEach((s, i) => {
      if (isMJ()) {
        s.hand.forEach((id) => add('手牌' + i, id));
        if (s.drawn !== null) add('手牌' + i, s.drawn);
        s.melds.forEach((m) => m.tiles.forEach((id) => add('副露' + i, id)));
        s.flowers.forEach((id) => add('花' + i, id));
        s.discards.forEach((id) => add('牌河' + i, id));
      } else {
        s.hand.forEach((id) => add('手牌' + i, id));
        s.play.forEach((id) => add('出牌' + i, id));
      }
    });
    return g;
  }

  const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

  function sampleLayout() {
    const d = debug();
    const sc = d.scene;
    if (!sc.seats || !sc.seats.length || sc.tweens.length || innerHeight > innerWidth) return;
    const ns = isMJ() ? window.MJ : window.TJ;
    const g = groups(sc);
    const rects = {};
    const VW = innerWidth;
    const VH = innerHeight;
    S.samples++;
    for (const name of Object.keys(g)) {
      rects[name] = g[name].map((id) => rectOf(sc, items(sc)[id], ns));
      let worst = 0;
      for (const r of rects[name]) {
        const out = Math.max(0, -r.x0, r.x1 - VW, -r.y0, r.y1 - VH);
        if (out > worst) worst = out;
      }
      if (worst > 2) {
        const v = S.viol[name] = S.viol[name] || { n: 0, worst: 0, maxCount: 0 };
        v.n++;
        if (worst > v.worst) v.worst = Math.round(worst);
        v.maxCount = Math.max(v.maxCount, g[name].length);
        if (!v.shot) { v.shot = true; S.shot = 'offscreen-' + name; }
      }
    }
    // 不同区域的牌互相盖住（盖住超过较小一张 30% 才算）
    const names = Object.keys(rects);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        let hit = 0;
        for (const a of rects[names[i]]) for (const b of rects[names[j]]) {
          const m = Math.min(area(a), area(b));
          if (m > 0 && inter(a, b) / m > 0.3) hit++;
        }
        if (hit) {
          const key = names[i] + ' × ' + names[j];
          const o = S.overlap[key] = S.overlap[key] || { n: 0, maxTiles: 0 };
          o.n++;
          if (hit > o.maxTiles) o.maxTiles = hit;
          if (!o.shot) { o.shot = true; S.shot = 'overlap-' + key.replace(/[^\\w\\u4e00-\\u9fff]+/g, '_'); }
        }
      }
    }
    // 界面元素挡住牌
    const chrome = ['plate0', 'plate1', 'plate2', 'plate3', 'scoreBox', 'roundInfo'];
    for (const id of chrome) {
      const el = document.getElementById(id);
      if (!el || el.hidden) continue;
      const b = el.getBoundingClientRect();
      if (!b.width) continue;
      const pr = { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom };
      for (const name of names) {
        let hit = 0;
        for (const r of rects[name]) {
          const a = area(r);
          if (a > 0 && inter(pr, r) / a > 0.3) hit++;
        }
        if (hit) {
          const key = id + ' 挡 ' + name;
          const o = S.plate[key] = S.plate[key] || { n: 0, maxTiles: 0 };
          o.n++;
          if (hit > o.maxTiles) o.maxTiles = hit;
          if (!o.shot) { o.shot = true; S.shot = 'cover-' + key.replace(/[^\\w\\u4e00-\\u9fff]+/g, '_'); }
        }
      }
    }
  }

  function nanCheck(sc) {
    for (const t of items(sc)) {
      if (![...t.pos, ...t.q, t.s].every(Number.isFinite)) return 'NaN 位置 id=' + t.id;
    }
    return null;
  }

  function endOfHand(res) {
    const d = debug();
    const sc = d.scene;
    const problems = [];
    const nan = nanCheck(sc);
    if (nan) problems.push(nan);
    if (isMJ()) {
      res.seats.forEach((rs, i) => {
        const s = sc.seats[i];
        const handN = s.hand.length + (s.drawn !== null ? 1 : 0);
        if (handN !== rs.hand.length) problems.push('座位' + i + ' 手牌数 ' + handN + ' != ' + rs.hand.length);
        if (s.melds.length !== rs.melds.length) problems.push('座位' + i + ' 副露数 ' + s.melds.length + ' != ' + rs.melds.length);
        if (s.flowers.length !== rs.flowers.length) problems.push('座位' + i + ' 花数不一致');
        if (s.discards.length !== rs.discards.length) problems.push('座位' + i + ' 牌河 ' + s.discards.length + ' != ' + rs.discards.length);
        for (const h of rs.hand) if (sc.tiles[h.id].kind !== h.kind) problems.push('座位' + i + ' 手牌牌面不一致 id=' + h.id);
        rs.melds.forEach((m) => m.ids.forEach((id, j) => { if (sc.tiles[id].kind !== m.kinds[j]) problems.push('座位' + i + ' 副露牌面不一致'); }));
      });
      if (sc.consoleState.remaining !== res.remaining) problems.push('中控台张数 ' + sc.consoleState.remaining + ' != ' + res.remaining);
    } else {
      let piles = 0;
      sc.seats.forEach((s, i) => {
        piles += s.pile.length;
        if (s.hand.length) problems.push('座位' + i + ' 打完还有 ' + s.hand.length + ' 张手牌');
      });
      if (piles + sc.kitty.length !== 108) problems.push('牌总数 ' + (piles + sc.kitty.length));
      if (sc.consoleState.points !== res.attackerPoints) problems.push('中控台分数 ' + sc.consoleState.points + ' != ' + res.attackerPoints);
      const shown = document.getElementById('scoreValue').textContent;
      if (shown !== String(res.attackerPoints)) problems.push('分数框 ' + shown + ' != ' + res.attackerPoints);
      res.kittyIds.forEach((id, i) => { if (sc.cards[id].kind !== res.kittyKinds[i]) problems.push('底牌牌面不一致'); });
    }
    const card = document.getElementById('resultBody');
    let overflow = 0;
    if (card && card.scrollHeight > card.clientHeight + 1) overflow = card.scrollHeight - card.clientHeight;
    const nextBtn = document.getElementById('btnNext').getBoundingClientRect();
    if (nextBtn.bottom > innerHeight || nextBtn.top < 0) problems.push('下一局按钮在屏幕外 bottom=' + Math.round(nextBtn.bottom));
    const gl = sc.gfx.gl.getError();
    if (gl && gl !== sc.gfx.gl.CONTEXT_LOST_WEBGL) { problems.push('GL 错误 ' + gl); S.glErrors++; }
    return { problems, overflow };
  }

  function summary(res) {
    if (isMJ()) {
      return {
        type: res.type, deltas: res.deltas,
        winners: res.winners.map((w) => ({ seat: w.seat, how: w.how, from: w.from, points: w.score.points, patterns: w.score.patterns })),
        remaining: res.remaining,
        discards: res.seats.reduce((a, s) => a + s.discards.length, 0),
        melds: res.seats.map((s) => s.melds.length),
        flowers: res.seats.map((s) => s.flowers.length),
        maxRiver: Math.max(...res.seats.map((s) => s.discards.length)),
      };
    }
    return {
      attackers: res.attackerPoints, dealer: res.dealer, holds: res.dealerHolds, up: res.up, trump: res.trump, level: res.level,
      kitty: res.kittyPoints, multiplier: res.multiplier, penalties: res.penalties, tricks: res.tricks, champion: res.champion, winnerTeam: res.winnerTeam,
    };
  }

  const install = () => {
    const d = debug();
    if (!d || !d.scene || S.installed) return;
    S.installed = true;
    const sc = d.scene;
    const gl = sc.gfx.gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    S.renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const origFrame = sc.frame;
    sc.frame = (t) => {
      const a = performance.now();
      origFrame(t);
      const ms = performance.now() - a;
      S.frames.jsSum += ms;
      if (ms > S.frames.jsMax) S.frames.jsMax = ms;
    };
    const origConsole = sc.setConsole.bind(sc);
    sc.setConsole = (p) => {
      const a = performance.now();
      origConsole(p);
      S.frames.consoleCalls++;
      S.frames.consoleMs += performance.now() - a;
    };
    let seen = null;
    let awaiting = null;
    setInterval(() => {
      if (!S.installed) return;
      const r = d.lastResult;
      if (r && r !== seen) {
        seen = r;
        awaiting = r;
      }
      const open = !document.getElementById('resultScreen').hidden;
      if (awaiting && open) {
        const res = awaiting;
        awaiting = null;
        const end = endOfHand(res);
        const now = performance.now();
        if (end.overflow) S.cardOverflow++;
        S.hands.push({
          ms: Math.round(now - S.lastEnd),
          s: summary(res),
          problems: end.problems,
          overflow: end.overflow,
          frames: S.frames,
          tweens: sc.tweens.length,
          anims: sc.anims.length,
          particles: sc.particles.length,
          rings: sc.rings.length,
          dom: document.getElementsByTagName('*').length,
          longTasks: S.longTasks.splice(0),
        });
        S.lastEnd = now;
        S.frames = newFrames();
      } else if (!open && !awaiting) {
        try { sampleLayout(); } catch (e) { S.errors.push('layout sampler: ' + e.message); }
      }
    }, 700);
  };
  setInterval(install, 200);
})();`;

// ---- 一个浏览器实例 ----------------------------------------------------------------
async function runInstance(index, shared) {
  const [pageW, pageH, pageDpr] = SIZES.length ? SIZES[index % SIZES.length] : [W, H, DPR];
  const sizeName = pageW + 'x' + pageH;
  const port = 10200 + index * 3 + Math.floor(Math.random() * 300);
  const profile = mkdtempSync(join(tmpdir(), 'soak-'));
  const glArgs = GL === 'gpu'
    ? ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const proc = spawn(edge, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--enable-precise-memory-info',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...glArgs, 'about:blank',
  ], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 80 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let msgId = 0;
  const waiting = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Performance.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_MONITOR });
  await send('Emulation.setDeviceMetricsOverride', { width: pageW, height: pageH, deviceScaleFactor: pageDpr, mobile: HUMAN && index % 2 === 1 });
  if (HUMAN && index % 2 === 1) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (HUMAN) await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const url = (BASE || 'file:///' + root.replace(/\\/g, '/') + '/index.html') + '?' + (HUMAN ? '' : 'auto=1&') + 'speed=' + SPEED;
  await send('Page.navigate', { url });
  await sleep(2500);

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  const robotTrace = [];
  const robotDone = HUMAN ? runRobot({
    send, ev, stats: shared.robot, isDone: () => shared.done >= HANDS, sleep, touch: index % 2 === 1,
    home: [pageW, pageH, pageDpr], sizes: SIZES.length ? SIZES : [[pageW, pageH, pageDpr]], shot, trace: robotTrace,
  }).catch((e) => { const m = 'robot #' + index + ' ' + (e && e.stack || e); shared.errors.push(m); console.log(m); }) : null;
  const mine = [];
  const memory = [];
  let lastHandAt = Date.now();
  let nextMem = 0;
  while (shared.done < HANDS) {
    await sleep(1500);
    const st = await ev(`(()=>{const s=window.__soak;if(!s)return null;const h=s.hands.splice(0);const w=s.shot;s.shot=null;const e=s.errors.splice(0);return {h,w,e,renderer:s.renderer,viol:s.viol,overlap:s.overlap,plate:s.plate,samples:s.samples}})()`);
    if (!st) continue;
    shared.renderer = st.renderer || shared.renderer;
    shared.layout[index] = { size: sizeName, viol: st.viol, overlap: st.overlap, plate: st.plate, samples: st.samples };
    for (const e of st.e) {
      shared.errors.push('#' + index + ' ' + e);
      if (shared.errors.length < 4) await shot('error-' + shared.errors.length);
    }
    if (st.w && !shared.shots.has(sizeName + '-' + st.w)) {
      shared.shots.add(sizeName + '-' + st.w);
      await shot(sizeName + '-' + st.w);
    }
    if (st.h.length) {
      lastHandAt = Date.now();
      mine.push(...st.h);
      shared.done += st.h.length;
      for (const h of st.h) shared.hands.push({ ...h, instance: index, size: sizeName });
      if (shared.done % 25 < st.h.length) console.log(new Date().toLocaleTimeString() + ' 已打 ' + shared.done + ' / ' + HANDS + ' 局');
    }
    if (mine.length >= nextMem) {
      await send('HeapProfiler.collectGarbage');
      const m = await send('Performance.getMetrics');
      const get = (n) => m.result.metrics.find((x) => x.name === n)?.value;
      memory.push({ hands: mine.length, heapMB: +(get('JSHeapUsedSize') / 1048576).toFixed(2), nodes: get('Nodes'), listeners: get('JSEventListeners') });
      nextMem = mine.length + 15;
    }
    if (Date.now() - lastHandAt > STALL_S * 1000) {
      const state = await ev(`(()=>{const d=window.__mjDebug||window.__tjDebug;if(!d)return 'no debug';const s=d.scene;return JSON.stringify({tweens:s.tweens.length,anims:s.anims.length,pending:d.pendingKind,result:!document.getElementById('resultScreen').hidden})})()`);
      shared.stalls.push({ instance: index, state });
      await shot('stall-' + shared.stalls.length);
      console.log('卡住了 #' + index + ' ' + state);
      if (HUMAN) {
        console.log(await ev(`JSON.stringify({scale:visualViewport.scale,vw:visualViewport.width,vh:visualViewport.height,ox:visualViewport.offsetLeft,oy:visualViewport.offsetTop,w:innerWidth,h:innerHeight,fs:!!document.fullscreenElement})`));
        console.log(robotTrace.join('\n'));
        console.log(await ev(`(()=>{const d=window.__mjDebug||window.__tjDebug;const s=d.scene;const me=s.seats[0];const list=window.__mjDebug&&me.drawn!==null?me.hand.concat([me.drawn]):me.hand;return JSON.stringify({drawn:me.drawn,interactive:s.interactive,hint:document.getElementById('hint').textContent,hintHidden:document.getElementById('hint').hidden,acts:[...document.querySelectorAll('#actions .act')].map(b=>b.className),viewHand:d.pending&&d.pending.view?d.pending.view.hand.map(t=>t.id):null,hand:list.map(id=>{const t=(s.tiles||s.cards)[id];const c=s.project(t.pos);return [id,t.kind,Math.round(c.x),Math.round(c.y),s.pick(c.x,c.y),(document.elementFromPoint(c.x,c.y)||{}).id]})})})()`));
      }
      await send('Page.reload');
      await sleep(2500);
      lastHandAt = Date.now();
    }
  }
  shared.memory[index] = memory;
  if (robotDone) await Promise.race([robotDone, sleep(8000)]);
  ws.close();
  proc.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}

const shared = { done: 0, hands: [], errors: [], stalls: [], layout: {}, memory: {}, shots: new Set(), renderer: '', robot: HUMAN ? newRobotStats() : null };
const t0 = Date.now();
await Promise.all(Array.from({ length: PAR }, (_, i) => sleep(i * 700).then(() => runInstance(i, shared))));

// ---- 汇总 --------------------------------------------------------------------------
const hands = shared.hands;
const fr = { n: 0, sum: 0, over33: 0, over50: 0, over100: 0, over250: 0, max: 0, jsSum: 0, jsMax: 0, consoleCalls: 0, consoleMs: 0 };
const lt = [];
for (const h of hands) {
  for (const k of Object.keys(fr)) {
    if (k === 'max' || k === 'jsMax') fr[k] = Math.max(fr[k], h.frames[k]);
    else fr[k] += h.frames[k];
  }
  lt.push(...h.longTasks);
}
lt.sort((a, b) => a - b);
const durations = hands.map((h) => h.ms).sort((a, b) => a - b);
const pick = (arr, q) => (arr.length ? arr[Math.floor((arr.length - 1) * q)] : 0);
const mergeLayout = (key, only) => {
  const out = {};
  for (const l of Object.values(shared.layout)) {
    if (only && l.size !== only) continue;
    for (const [k, v] of Object.entries(l[key] || {})) {
      const o = out[k] = out[k] || { n: 0 };
      o.n += v.n;
      if (v.worst !== undefined) o.worst = Math.max(o.worst || 0, v.worst);
      if (v.maxTiles !== undefined) o.maxTiles = Math.max(o.maxTiles || 0, v.maxTiles);
      if (v.maxCount !== undefined) o.maxCount = Math.max(o.maxCount || 0, v.maxCount);
    }
  }
  return out;
};
const samples = Object.values(shared.layout).reduce((a, l) => a + (l.samples || 0), 0);
const problems = hands.flatMap((h) => h.problems.map((p) => '#' + h.instance + ' ' + p));
const report = {
  config: { HANDS, PAR, W, H, DPR, SPEED, THROTTLE, GL, renderer: shared.renderer, seconds: Math.round((Date.now() - t0) / 1000) },
  handsPlayed: hands.length,
  errors: shared.errors,
  stalls: shared.stalls,
  consistencyProblems: problems,
  resultCardOverflow: hands.filter((h) => h.overflow).length,
  resultCardOverflowMax: Math.max(0, ...hands.map((h) => h.overflow)),
  leftovers: { tweens: Math.max(0, ...hands.map((h) => h.tweens)), anims: Math.max(0, ...hands.map((h) => h.anims)) },
  frames: {
    avgMs: +(fr.sum / Math.max(fr.n, 1)).toFixed(1),
    fps: +(1000 * fr.n / Math.max(fr.sum, 1)).toFixed(1),
    over33pct: +(100 * fr.over33 / Math.max(fr.n, 1)).toFixed(2),
    over50pct: +(100 * fr.over50 / Math.max(fr.n, 1)).toFixed(2),
    over100pct: +(100 * fr.over100 / Math.max(fr.n, 1)).toFixed(2),
    over250: fr.over250,
    maxMs: Math.round(fr.max),
    frameJsAvgMs: +(fr.jsSum / Math.max(fr.n, 1)).toFixed(2),
    frameJsMaxMs: Math.round(fr.jsMax),
    consoleUpdates: fr.consoleCalls,
    consoleAvgMs: +(fr.consoleMs / Math.max(fr.consoleCalls, 1)).toFixed(2),
  },
  longTasks: { count: lt.length, perHand: +(lt.length / Math.max(hands.length, 1)).toFixed(1), p50: pick(lt, 0.5), p95: pick(lt, 0.95), max: lt[lt.length - 1] || 0, over200: lt.filter((x) => x > 200).length, over500: lt.filter((x) => x > 500).length },
  handSeconds: { p50: +(pick(durations, 0.5) / 1000).toFixed(1), p95: +(pick(durations, 0.95) / 1000).toFixed(1), max: +((durations[durations.length - 1] || 0) / 1000).toFixed(1) },
  memory: shared.memory,
  layout: { samples, offscreen: mergeLayout('viol'), overlap: mergeLayout('overlap'), chromeCovers: mergeLayout('plate') },
  layoutBySize: Object.fromEntries([...new Set(Object.values(shared.layout).map((l) => l.size))].map((z) => [z, {
    samples: Object.values(shared.layout).filter((l) => l.size === z).reduce((a, l) => a + (l.samples || 0), 0),
    offscreen: mergeLayout('viol', z), overlap: mergeLayout('overlap', z), chromeCovers: mergeLayout('plate', z),
  }])),
  shots: [...shared.shots],
  robot: shared.robot,
};
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1));
writeFileSync(join(outDir, 'hands.json'), JSON.stringify(hands.map((h) => ({ ms: h.ms, s: h.s, overflow: h.overflow, problems: h.problems, i: h.instance, size: h.size, lt: h.longTasks.filter((x) => x >= 100), fn: h.frames.n, f33: h.frames.over33, fmax: Math.round(h.frames.max), dom: h.dom }))));
console.log(JSON.stringify(report, (k, v) => (k === 'memory' ? undefined : v), 1));
for (const [i, m] of Object.entries(shared.memory)) console.log('内存 #' + i + ' ' + m.map((x) => x.hands + '局:' + x.heapMB + 'MB/' + x.nodes + '节点').join('  '));
process.exit(0);

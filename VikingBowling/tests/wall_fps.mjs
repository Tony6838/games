// Frame rate and the TV wall's cost, in headless Edge on this PC's GPU (Direct3D 11):
//   node tests/wall_fps.mjs [w=1280] [h=800] [baseUrl] [cpuSlowdown]   (cpuSlowdown e.g. 4: a phone-like CPU, touch, the
//   two 8-lane cases on the low level only)
// Plays an 8-lane VBS-T format (Banpoängsmatch 8+8 on 8 lanes: the player's lane and seven other
// lanes on the TV wall) and an open play game (one lane, no small TVs), each on the low and the
// high detail level (?detail=), with the machine players bowling at ⏩, and measures over 6 s:
//   * frames a second (the median interval of requestAnimationFrame; the display's refresh caps it),
//   * the main thread's busy time per second (CDP Performance.getMetrics: TaskDuration), which tells
//     the cases apart where the frame rate is capped;
// and, on the low level, the 8-lane game with the seven small TVs as seven live TakTV pages (what
// the game does not do).
import { openBrowser, sleep } from './cdp.mjs';

const [W = '1280', H = '800', base = 'http://127.0.0.1:8471/games/VikingBowling/', slow = '0'] = process.argv.slice(2);
const cpu = +slow;
const rows = [];
let renderer = '';

async function run(detail, mode, extraTakTV = false) {
  const b = await openBrowser({ w: +W, h: +H, gpu: true, mobile: cpu > 0 });
  const app = (e) => b.eval(`const a = window.vikingApp; ${e}`);
  await b.go(base + '?nofs=1&detail=' + detail, 3000);
  await b.eval('localStorage.clear(); localStorage.setItem("vbg.throwHint", "true"); localStorage.setItem("vbg.bumperHint", "true"); return 1');
  await b.go(base + '?nofs=1&detail=' + detail, 3500);
  renderer = await app(`const gl = a.scene.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''`);
  if (cpu > 0) await b.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await b.click('#okBtn'); await sleep(600);
  if (mode === 'vbst') {
    await b.click('[data-tab="vbst"]'); await sleep(500);
    await app(`a.settings.format = 'banp88x8'; a.save(); a.renderFormats(); return 1`);
    await sleep(300);
  }
  await b.click('#menuNext'); await sleep(1200);
  await b.click('#startBtn'); await sleep(6000);
  await app('a.fast = true; return 1');
  const tiles = await app(`return [...document.querySelectorAll("#tvStrip .tvTile")].filter((t) => !t.hidden).length`);
  if (extraTakTV) {
    await app(`for (const tile of [...document.querySelectorAll("#tvStrip .tvTile")].filter((t) => !t.hidden)) { const f = document.createElement('iframe');
      f.src = 'web/screen/HTML/TakTV/TakTVGame.html?lane=' + tile.dataset.lane + '&readonly=1&lang=Svenska'; f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none';
      tile.appendChild(f); } return 1`);
    await sleep(5000);
  }
  await b.send('Performance.enable');
  const m0 = (await b.send('Performance.getMetrics')).result.metrics;
  const r = await app(`const t = []; let last = performance.now(); const t0 = last;
    await new Promise((res) => { const f = (now) => { t.push(now - last); last = now; if (now - t0 < 6000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    t.sort((x, y) => x - y); return { med: t[t.length >> 1], p90: t[Math.floor(t.length * 0.9)], n: t.length, detail: a.scene.detail };`);
  const m1 = (await b.send('Performance.getMetrics')).result.metrics;
  const get = (m, k) => (m.find((x) => x.name === k) || {}).value || 0;
  const busy = (get(m1, 'TaskDuration') - get(m0, 'TaskDuration')) / (get(m1, 'Timestamp') - get(m0, 'Timestamp'));
  const label = mode === 'vbst' ? (extraTakTV ? '8 lanes, the 7 small TVs as live TakTV pages' : '8 lanes: TakTV + 7 compact small TVs + 8 overhead TVs') : 'open play, 1 lane (TakTV, 1 overhead TV)';
  rows.push(`| ${label} | ${r.detail} | ${tiles} | ${(1000 / r.med).toFixed(1)} | ${r.med.toFixed(1)} | ${r.p90.toFixed(1)} | ${(busy * 1000).toFixed(0)} ms |`);
  const errors = b.log.filter((l) => /EXCEPTION|ERROR/.test(l));
  await b.close();
  return { busy, errors };
}

const lowWall = await run('low', 'vbst');
const lowTak = await run('low', 'vbst', true);
const highWall = cpu ? { busy: 0, errors: [] } : await run('high', 'vbst');
const lowOpen = cpu ? { busy: 0, errors: [] } : await run('low', 'open');
const highOpen = cpu ? { busy: 0, errors: [] } : await run('high', 'open');
console.log(`renderer: ${renderer}; ${W}x${H}${cpu ? '; CPU slowed down ' + cpu + 'x, touch' : ''}`);
console.log('| case | detail | small TVs | fps (median) | frame ms median | frame ms p90 | main thread busy per s |');
console.log('|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
console.log('');
console.log(`the small TVs as TakTV pages: ${((lowTak.busy - lowWall.busy) * 1000).toFixed(0)} ms more main-thread work per second than the compact ones (low level)`);
const errs = [lowWall, lowTak, highWall, lowOpen, highOpen].flatMap((x) => x.errors);
console.log(errs.length ? errs.join('\n') : 'no exceptions');
process.exit(0);

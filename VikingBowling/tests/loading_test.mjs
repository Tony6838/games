// The load bar on the splash (js/loading.js, css/loading.css), in headless Edge (tests/cdp.mjs) on
// a throttled connection: node tests/loading_test.mjs [kbps=3000] [outDir]
//   - js/loadsizes.js names exactly the files the splash waits for (tools/make_loadsizes.mjs)
//   - while the game loads, the bar is shown with "Laddar … n %" and the n only grows, past 50 %;
//     the flags, the text box and the OK button are not shown (empty, the text box looked like a
//     progress bar that never moved)
//   - when the game has started, the bar is gone and the splash's texts and OK button are there,
//     and OK, Fortsätt and Starta reach the play screen
//   - the text follows the language chosen last time (English)
//   - a file that does not load: the bar turns red and says the game could not be loaded
// Starts its own copy of tests/serve.mjs. Screenshots go to outDir (default screenshots/loading).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, sleep } from './cdp.mjs';
import { startupFiles } from '../tools/make_loadsizes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [kbps = '3000', outDir = join(here, '..', 'screenshots', 'loading')] = process.argv.slice(2);
const checks = [];
const check = (ok, what) => { checks.push((ok ? 'ok   ' : 'FAIL ') + what); return ok; };

// 1. the list is the startup graph as it is now
{
  const now = startupFiles();
  const listed = JSON.parse(readFileSync(join(here, '..', 'js', 'loadsizes.js'), 'utf8').match(/LOAD_FILES = (\{[\s\S]*?\});/)[1]);
  const missing = Object.keys(now).filter((f) => !(f in listed)), extra = Object.keys(listed).filter((f) => !(f in now));
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const drift = Math.abs(sum(now) - sum(listed)) / sum(now);
  check(!missing.length && !extra.length && drift < 0.02,
    `js/loadsizes.js is up to date (${Object.keys(now).length} files${missing.length ? ', missing ' + missing.join(' ') : ''}${extra.length ? ', not loaded any more ' + extra.join(' ') : ''}, size ${(drift * 100).toFixed(1)} % off) - else: node tools/make_loadsizes.mjs`);
}

const port = 8600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(port)], { stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + 'index.html')).ok) break; } catch { /* not up yet */ } await sleep(100); }

const state = `const b = document.getElementById('loadBar'); const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
  return { ready: document.documentElement.classList.contains('vbgReady'), bar: vis('#loadBar'), failed: b.classList.contains('failed'),
    n: +b.getAttribute('aria-valuenow'), text: b.querySelector('.loadText').textContent.replace(/\\s+/g, ' ').trim(),
    css: getComputedStyle(b.querySelector('.loadTrack')).height === '12px', info: vis('#splash .infoBox'), ok: vis('#okBtn') ? document.getElementById('okBtn').textContent : '', flags: vis('#langRow') };`;

async function load({ lang = null, block = null, throttle = +kbps, shots = null } = {}) {
  const b = await openBrowser({ w: 1280, h: 800 });
  await b.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttle) await b.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: throttle * 128, uploadThroughput: throttle * 128 });
  if (block) await b.send('Network.setBlockedURLs', { urls: [block] });
  if (lang) await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('vbg.settings', JSON.stringify({ lang: '${lang}' })); } catch (e) {}` });
  b.send('Page.navigate', { url: base });
  const seen = [];
  const t0 = Date.now();
  let shot = 0;
  while (Date.now() - t0 < 90000) {
    const s = await Promise.race([b.eval(state), sleep(2500).then(() => null)]);     // no answer while main.js builds the hall
    if (s && !s.error) {
      seen.push(s);
      if (shots && s.bar && !s.ready && s.n >= shot * 30) { await b.shot(`${outDir}/${shots}_${String(s.n).padStart(2, '0')}.png`); shot++; }
      if (s.ready || s.failed) break;
    }
    await sleep(150);
  }
  return { b, seen };
}

try {
  // 2. a load, the bar, the game starts
  {
    const { b, seen } = await load({ shots: 'sv' });
    const during = seen.filter((s) => s.bar && !s.ready && !s.failed);
    const ns = during.map((s) => s.n);
    check(during.length >= 5, `the bar is seen while the game loads (${during.length} samples at ${kbps} kbit/s)`);
    check(ns.every((n, i) => i === 0 || n >= ns[i - 1]), 'its percentage only grows: ' + [...new Set(ns)].join(' '));
    check(Math.max(...ns) >= 50, 'and gets past 50 % before the game starts building the hall');
    check(during.filter((s) => s.n > 0).every((s) => /^Laddar … \d+ %$/.test(s.text)), `the text reads "Laddar … n %" ("${during[during.length - 1]?.text}")`);
    const styled = during.filter((s) => s.css);      // before css/loading.css has arrived the page is not drawn
    const early = styled.filter((s) => s.info || s.ok || s.flags);
    check(styled.length && !early.length, 'the flags, the text box and the OK button wait' + (early.length ? ': ' + JSON.stringify(early[0]) : ''));
    const end = seen[seen.length - 1];
    check(end.ready && !end.bar && !end.failed, 'the game started: the bar is gone');
    check(end.info && end.flags && /OK/.test(end.ok), `the splash's flags, text box and OK button ("${end.ok}") are there`);
    await b.shot(`${outDir}/sv_ready.png`);
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check(await b.click('#okBtn'), 'OK');
    await sleep(800);
    check(await b.click('#menuNext'), 'Fortsätt');
    await sleep(800);
    check(await b.click('#startBtn'), 'Starta');
    let screen = '';
    for (let i = 0; i < 60 && screen !== 'play'; i++) { await sleep(500); screen = await b.eval('return window.vikingApp && window.vikingApp.screen'); }
    check(screen === 'play', 'the play screen is reached (' + screen + ')');
    await sleep(1500);
    await b.shot(`${outDir}/sv_play.png`);
    const errs = b.log.filter((l) => /EXCEPTION|ERROR/.test(l));
    check(!errs.length, 'no exceptions or console errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await b.close();
  }
  // 3. the language chosen last time
  {
    const { b, seen } = await load({ lang: 'en', throttle: Math.min(+kbps, 3000) });
    const t = seen.filter((s) => s.bar && s.n > 0).map((s) => s.text);
    check(t.length && t.every((x) => /^Loading … \d+%$/.test(x)), `English: "${t[t.length - 1]}"`);
    await b.close();
  }
  // 4. a file that does not load
  {
    const { b, seen } = await load({ block: '*js/engine/openplay.js', throttle: 0 });
    const end = seen[seen.length - 1];
    check(end.failed && end.bar && !end.ready && /kunde inte laddas/.test(end.text), `a file that does not load: "${end.text}"`);
    await b.shot(`${outDir}/sv_failed.png`);
    await b.close();
  }
} finally {
  server.kill();
}

console.log(checks.join('\n'));
const failed = checks.filter((c) => c.startsWith('FAIL')).length;
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);

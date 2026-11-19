// ---------------------------------------------------------------------------
// loading.js - the load bar on the splash while the game downloads and starts.
//   index.html runs this small module before js/main.js. Two phases:
//   1. The download, 0-85 % of the bar: the share of the startup files (js/loadsizes.js, made by
//      tools/make_loadsizes.mjs) that have arrived, by size, as the browser's resource timing
//      reports them; between two arrivals it moves on at the speed measured so far, never past
//      what is still outstanding. The percentage under the bar is this figure.
//   2. The start: main.js runs its modules and builds the hall in one go, and the page cannot
//      draw until it is done (2-3 s on a first visit, even on a desktop). So every tick also
//      arms an animation, started STALL_MS later, that moves the bar on towards the end and
//      fades the percentage out; the browser runs it off the main thread. While the page draws,
//      the next tick replaces it before it starts; when the page stops drawing, it plays.
//      On a fast or cached load main.js may start before this module has drawn anything at
//      all: then the creep css/loading.css gives the bar from the first paint carries it.
//   main.js marks <html> with .vbgReady when the splash is ready, and css/loading.css then shows
//   the splash's flags, texts and OK button instead of the bar. If main.js never gets that far
//   (a file that did not load, an error), the bar says so.
// ---------------------------------------------------------------------------
import { setLang, t } from './i18n.js';
import { LOAD_FILES } from './loadsizes.js';

const DOWNLOAD_SHARE = 0.85;
const AHEAD_MAX = 0.95;        // the estimate between two arrivals covers at most this share of what is outstanding
const START_END = 0.97;        // where phase 2 takes the bar
const START_MS = 3000;
const STALL_MS = 400;          // no tick for this long: the page has stopped drawing
const ARM_MS = 100;

const bar = document.getElementById('loadBar');
const ready = () => document.documentElement.classList.contains('vbgReady');

if (bar && !ready()) {
  // the language the player chose last time (main.js sets it again from the same setting)
  try { setLang((JSON.parse(localStorage.getItem('vbg.settings')) || {}).lang); } catch (e) { setLang('sv'); }
  const fill = bar.querySelector('.loadFill'), label = bar.querySelector('.loadLabel'), pct = bar.querySelector('.loadPct');
  label.textContent = t('loading');
  const base = decodeURIComponent(new URL('.', location.href).pathname);     // the list names files relative to the page
  const total = Object.values(LOAD_FILES).reduce((a, b) => a + b, 0) || 1;
  const arrived = new Set();
  let done = 0, lastEnd = 0, seen = -1, shown = -1, failed = false, armedAt = -1e9, creep = null, fade = null;

  const take = () => {
    const list = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
    if (list.length === seen) return;
    seen = list.length;
    for (const e of list) {
      let path;
      try { path = decodeURIComponent(new URL(e.name).pathname); } catch (x) { continue; }
      if (!path.startsWith(base)) continue;
      const rel = path.slice(base.length);
      if (!(rel in LOAD_FILES) || arrived.has(rel)) continue;
      arrived.add(rel);
      done += LOAD_FILES[rel];
      lastEnd = Math.max(lastEnd, e.responseEnd || 0);
    }
  };

  // the fill is the track's width, moved left by the part not yet loaded (a transform, so the
  // browser can animate it off the main thread); a sliver shows from the start
  const at = (p) => `translateX(${((Math.max(p, 0.02) - 1) * 100).toFixed(2)}%)`;
  const disarm = () => { if (creep) creep.cancel(); if (fade) fade.cancel(); creep = fade = null; };
  const arm = (p) => {
    disarm();
    if (!fill.animate) return;
    creep = fill.animate([{ transform: at(p) }, { transform: at(Math.max(p, START_END)) }],
      { duration: START_MS, delay: STALL_MS, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'forwards' });
    fade = pct.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, delay: STALL_MS, fill: 'forwards' });
  };

  // css/loading.css lets the fill creep on by itself until this module runs: go on from where it is
  const takeOver = () => {
    let p0 = 0;
    try {
      const m = new DOMMatrixReadOnly(getComputedStyle(fill).transform);
      const w = fill.offsetWidth;
      if (w) p0 = Math.min(START_END, Math.max(0, 1 + m.m41 / w));
    } catch (e) { /* no DOMMatrix: from the start */ }
    fill.style.animation = 'none';
    return p0;
  };
  const floor = takeOver();

  const tick = () => {
    if (failed) return;
    if (ready()) { disarm(); return; }       // css/loading.css has put the splash's texts in its place
    take();
    let got = done;
    if (done > 0 && done < total && lastEnd > 0) {
      const rate = done / lastEnd;           // bytes per ms since the page was asked for
      got = Math.min(done + rate * (performance.now() - lastEnd), done + (total - done) * AHEAD_MAX);
    }
    const p = Math.max(floor, shown / 100, DOWNLOAD_SHARE * Math.min(1, got / total));
    const n = Math.round(p * 100), now = performance.now(), changed = n !== shown;
    if (changed) {
      shown = n;
      fill.style.transform = at(p);
      bar.setAttribute('aria-valuenow', String(n));
      pct.textContent = t('loadPct', { n });
    }
    if (changed || now - armedAt >= ARM_MS) { armedAt = now; arm(p); }
    requestAnimationFrame(tick);
  };

  // DOMContentLoaded comes after main.js has run (module scripts run in order before it):
  // without .vbgReady by then, the game did not start
  addEventListener('DOMContentLoaded', () => {
    if (ready()) return;
    failed = true;
    disarm();
    bar.classList.add('failed');
    fill.style.transform = 'none';
    label.textContent = t('loadFailed');
    pct.textContent = '';
  }, { once: true });

  tick();
}

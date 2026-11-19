// ---------------------------------------------------------------------------
// consolehost.js - the lane console of each lane in play, as the tablet beside the lane shows it:
// VBS's own web console page (web/screen/console/touchconsoleLaneGame.html, touchconsoleLane.html
// plus the game's stand-in) in a frame over the game, one tab per lane. The page talks to the
// stand-in LoadCom exactly as it talks to LoadCom on a lane PC (js/standin/console-standin.js).
// While the console is open the bowlers on its lane wait (LaneGame asks consoleGate before a
// machine player's ball) and the player's swipe is off, as nobody bowls while the console is used.
// The console's picture of the lane (VTVFile<n>.jpg) is the lane TV page's own sheet, asked of the
// TakTV page only while the console shows that lane (the TV frames are readonly: a JPEG after every
// push hitched a phone); the game's compact view stands in until it comes, and for a lane without
// a TakTV page.
// ---------------------------------------------------------------------------
import { t } from '../i18n.js';

export class ConsoleHost {
  constructor(app, { box, frame, tabs, close, title }) {
    this.app = app;
    this.box = box; this.frame = frame; this.tabs = tabs; this.title = title;
    this.lanes = [];
    this.lane = null;
    this.waiters = [];
    close.addEventListener('click', () => this.close());
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lane]');
      if (b) this.open(+b.dataset.lane);
    });
    app.loadcom.closeConsole = () => this.close();
    // the lane shown changed (a console command, a ball): its picture again, once things settle
    app.loadcom.listeners.push((lane) => { if (this.isOpen && lane === this.lane) this.pictureSoon(); });
  }

  pictureSoon(ms = 200) {
    clearTimeout(this.pictureT);
    this.pictureT = setTimeout(() => this.picture(), ms);
  }
  // The TakTV page's sheet of the console's lane as a JPEG, as the page itself writes VTVFile<n>.html.jpg
  // (vbsExportSheetJpeg at the payload's vtvImageResX, 960, the height from the sheet's own
  // proportions), stamped with the lane state it shows
  picture() {
    const app = this.app, lane = this.lane;
    if (!this.isOpen || !app.tvWindowFor) return;
    let w = null;
    try { w = app.tvWindowFor(lane); } catch (e) { w = null; }
    const entry = app.loadcom.lanes.get(lane);
    const pis = entry && entry.get();
    if (!w || !pis || typeof w.vbsExportSheetJpeg !== 'function' || !w.vbsSheet || typeof w.vbsSheet.capture !== 'function') return;
    let svg = null;
    try { svg = w.vbsSheet.capture(); } catch (e) { svg = null; }
    if (!svg) return;
    const stamp = pis.laneDataModifiedTime;
    const vb = String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const W = 960, H = vb[2] > 0 && vb[3] > 0 ? Math.round(W * vb[3] / vb[2]) : 540;
    w.vbsExportSheetJpeg(svg, W, H, 0.85).then((dataUrl) => {
      if (!this.isOpen || this.lane !== lane) return;
      const bin = atob(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      app.loadcom.storeVtvImage(lane, new Blob([bytes], { type: 'image/jpeg' }), stamp);
    }).catch((e) => console.warn('Lane picture not made', e));
  }

  get isOpen() { return !this.box.hidden; }

  // lanes: every lane in play, the player's first
  setLanes(lanes) {
    this.lanes = [...new Set(lanes)];
    this.renderTabs();
  }

  renderTabs() {
    this.tabs.innerHTML = this.lanes.map((n) => `<button type="button" data-lane="${n}" class="${n === this.lane ? 'active' : ''}">${t('lane')} ${n}</button>`).join('');
    this.title.textContent = t('conTitle');
  }

  open(lane) {
    const app = this.app;
    if (!lane) lane = app.activeLane ? app.activeLane.number : this.lanes[0];
    this.lane = lane;
    this.renderTabs();
    app.loadcom.unsubscribeConsoles();
    // the lane's pair partner, as the tablet of a pair shows its lane ("pair=1")
    const pair = this.lanes.includes(lane % 2 ? lane + 1 : lane - 1) ? '&pair=1' : '';
    this.frame.src = 'web/screen/console/touchconsoleLaneGame.html?lane=' + lane + pair + '&lanecolor=E2B550&v=' + Date.now();
    this.box.hidden = false;
    // the lane's picture once the console page is up - loaded and showing the lane (its dock out,
    // body.vbsPlaying), or after 4 s: drawing the sheet as a JPEG would otherwise hold up the page's
    // own start, as they share the main thread
    const frame = this.frame, opened = Date.now();
    const ready = () => {
      if (!this.isOpen || this.lane !== lane || !frame.getAttribute('src')) return;
      let up = false;
      try { const d = frame.contentDocument; up = !!(d && d.readyState === 'complete' && d.body && d.body.classList.contains('vbsPlaying')); } catch (e) { up = true; }
      if (up || Date.now() - opened > 4000) this.pictureSoon(300);
      else this.readyT = setTimeout(ready, 150);
    };
    clearTimeout(this.readyT);
    this.readyT = setTimeout(ready, 150);
    app.input.disable();
    if (app.onConsoleOpen) app.onConsoleOpen(lane);
    if (!app.store || !app.store.get('consoleHint', false)) { if (app.store) app.store.set('consoleHint', true); app.toast(t('conHint'), 6000); }
  }

  close() {
    if (!this.isOpen) return;
    this.box.hidden = true;
    clearTimeout(this.pictureT); clearTimeout(this.readyT);
    this.frame.removeAttribute('src');
    this.app.loadcom.unsubscribeConsoles();
    const w = this.waiters.splice(0);
    for (const r of w) r();
    // the player's throw goes on where it was waiting
    if (this.app.throwResolve && this.app.throwLane) this.app.input.enable(this.app.humanX0 || 0, this.app.humanZ0);
  }

  // Resolves when nobody is at the console (the bowlers wait meanwhile)
  gate() {
    if (!this.isOpen) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
}

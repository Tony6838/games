// ---------------------------------------------------------------------------
// tvwall.js - one lane TV per lane in play, as a hall has them.
//
//   * The lanes the player bowls on are shown by the real lane TV page (TakTV, the #tvBox frames,
//     main.js): large and framed in gold, following the player from lane to lane.
//   * Every other lane in play - the other lanes of a VBS-T competition, the pair lane of an
//     American game when the player is not on it - gets a small TV in the strip (#tvStrip): the
//     game's compact view of that lane's own score (scoreview.js), drawn from the same lane struct
//     the stand-in LoadCom feeds the TakTV pages, at most twice a second per lane. Several live
//     TakTV pages were measured to cost too much on the low detail level (README, "The TV wall").
//     A tap on a small TV shows it large; a tap again puts it back.
//   * The hall's overhead TV of every lane in play shows the same compact view (scene.setLaneTvTexture,
//     one canvas per lane, uploaded again when it is drawn).
// ---------------------------------------------------------------------------
import { drawScoreView, VIEW_W, VIEW_H } from './scoreview.js';
import { t } from '../i18n.js';

const SMALL_EVERY_MS = 500;      // a small TV is drawn at most twice a second
const BIG_EVERY_MS = 120;

export class TvWall {
  constructor(app, strip) {
    this.app = app;
    this.strip = strip;
    this.views = new Map();      // lane -> { canvas, tile, human, last, index, timer }
    app.loadcom.listeners.push((lane) => this.changed(lane));
    strip.addEventListener('click', (e) => {
      const tile = e.target.closest('.tvTile');
      if (!tile) return;
      const big = !tile.classList.contains('big');
      for (const v of this.views.values()) {
        v.tile.classList.remove('big');
        if (v.bigCanvas) { v.bigCanvas.remove(); v.bigCanvas = null; }
      }
      tile.classList.toggle('big', big);
      this.strip.classList.toggle('hasBig', big);
      // shown large, the view is drawn again at twice the size (its own canvas: the small one is
      // also the overhead TV's texture, which keeps its size)
      const v = this.views.get(+tile.dataset.lane);
      if (big && v) {
        v.bigCanvas = document.createElement('canvas');
        v.bigCanvas.width = VIEW_W * 2; v.bigCanvas.height = VIEW_H * 2;
        v.bigCanvas.className = 'tileBig';
        tile.appendChild(v.bigCanvas);
        this.draw(+tile.dataset.lane);
      }
    });
  }

  // lanes: every lane in play; humanLanes: the ones the player bowls on (the TakTV frames)
  setup(lanes, humanLanes) {
    this.clear();
    const sorted = [...new Set(lanes)].sort((a, b) => a - b);
    for (const n of sorted) {
      const human = humanLanes.includes(n);
      const canvas = document.createElement('canvas');
      canvas.width = VIEW_W; canvas.height = VIEW_H;
      // every lane has its small TV; the one the large TV shows is hidden (setBig) - in an American
      // pair the large TV moves with the play and the pair lane's small TV takes its place
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tvTile';
      tile.dataset.lane = String(n);
      tile.setAttribute('aria-label', t('lane') + ' ' + n);
      tile.appendChild(canvas);
      this.strip.appendChild(tile);
      this.views.set(n, { canvas, tile, human, last: 0, index: this.app.scene.laneIndexOf(n), timer: 0 });
    }
    this.strip.classList.remove('hasBig');
    this.setBig(humanLanes[0]);
    for (const n of this.views.keys()) this.draw(n);
  }

  // The lane the large TV shows: its small TV is not shown
  setBig(lane) {
    this.big = lane;
    let shown = 0;
    for (const [n, v] of this.views) {
      const hide = n === lane;
      if (v.tile.hidden !== hide) v.tile.hidden = hide;
      if (!hide) shown++;
    }
    this.strip.hidden = shown === 0;
    this.strip.dataset.count = String(shown);
  }

  // The lanes the player bowls on changed (a VBS-T serie on other lanes): which tile is which
  humanLanesChanged(humanLanes) {
    const lanes = [...this.views.keys()];
    this.setup(lanes, humanLanes);
  }

  changed(lane) {
    const v = this.views.get(lane);
    if (!v || v.timer) return;
    const every = v.human ? BIG_EVERY_MS : SMALL_EVERY_MS;
    const wait = Math.max(0, v.last + every - performance.now());
    v.timer = setTimeout(() => { v.timer = 0; this.draw(lane); }, wait);
  }

  draw(lane) {
    const v = this.views.get(lane);
    const entry = this.app.loadcom.lanes.get(lane);
    if (!v || !entry) return;
    const pis = entry.get();
    if (!pis) return;
    v.last = performance.now();
    let active = -1;
    if (pis.isAnyPlayerActive && pis.activePlayer >= 0) active = pis.activePlayer % 8;
    const lg = this.app.laneGame;
    let practice = '';
    const eng = entry.engine;
    if (eng && eng.isWarmUp(lane)) practice = (lg && lg.lanes.some((l) => l.number === lane) && lg.practiceText(lane)) || t('warmShort');
    const opts = { lane, active, cfg: eng ? eng.isCFG() : false, practice, laneWord: t('lane'),
      highlight: v.human, title: pis.booking_name, emptyText: t('wallEmpty') };
    drawScoreView(v.canvas, pis, opts);
    if (v.bigCanvas) drawScoreView(v.bigCanvas, pis, opts);
    if (v.index !== null && v.index !== undefined) this.app.scene.setLaneTvTexture(v.index, v.canvas);
  }

  // A small TV's own animation, the cheap way: the mark over the picture for a moment (a strike,
  // a spare on another lane)
  flash(lane, text) {
    const v = this.views.get(lane);
    if (!v || !v.tile) return;
    const old = v.tile.querySelector('.tileFx');
    if (old) old.remove();
    const fx = document.createElement('span');
    fx.className = 'tileFx';
    fx.textContent = text;
    fx.addEventListener('animationend', () => fx.remove());
    v.tile.appendChild(fx);
  }

  // A data URL of a lane's view (the lane console's picture of a lane with no TakTV page)
  // (drawn at the 960 pixels VTVFile<n>.jpg has, v3GfxSaveImagesResX's default)
  imageUrl(lane) {
    const v = this.views.get(lane);
    const entry = this.app.loadcom.lanes.get(lane);
    if (!v || !entry || !entry.get()) return null;
    const pis = entry.get();
    const c = this.hiRes || (this.hiRes = document.createElement('canvas'));
    c.width = 960; c.height = 540;
    const eng = entry.engine, lg = this.app.laneGame;
    let practice = '';
    if (eng && eng.isWarmUp(lane)) practice = (lg && lg.lanes.some((l) => l.number === lane) && lg.practiceText(lane)) || t('warmShort');
    drawScoreView(c, pis, { lane, active: pis.isAnyPlayerActive && pis.activePlayer >= 0 ? pis.activePlayer % 8 : -1, cfg: eng ? eng.isCFG() : false,
      practice, laneWord: t('lane'), title: pis.booking_name });
    return c.toDataURL('image/jpeg', 0.88);
  }

  clear() {
    for (const v of this.views.values()) {
      clearTimeout(v.timer);
      if (v.tile) v.tile.remove();
      if (v.index !== null && v.index !== undefined) this.app.scene.setLaneTvTexture(v.index, null);
    }
    this.views.clear();
    this.strip.hidden = true;
  }
}

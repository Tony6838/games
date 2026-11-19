// ---------------------------------------------------------------------------
// scoreview.js - a compact lane TV drawn on a canvas from the same lane struct the TakTV page is
// fed: the lane number, every bowler's name, the ten frames with the ball marks the Standard
// theme uses (X, /, -, F, a split ringed), the running totals as CProtocol::GetTotal shows them
// (RecalcScore with the strike sequence held back), the total, the bowler up marked, and the
// practice box while a warm-up is played. Used for the small TVs of the TV wall, the hall's
// overhead lane TVs (scene.setLaneTvTexture) and the lane console's picture of a lane that has
// no TakTV page open. Drawn at LANE_TV_SIZE (512 x 288) and scaled by whoever shows it.
// ---------------------------------------------------------------------------
import { runningTotals } from '../engine/bowlingscore.js';
import { GCI, firstBallOfSerie } from '../engine/openplay.js';
import { withoutBumperMark } from '../engine/correction.js';

export const VIEW_W = 512, VIEW_H = 288;
const FONT = '"Barlow Condensed", "Segoe UI Semibold", Arial, sans-serif';

function displayName(raw, activeSquare) {
  let n = withoutBumperMark(raw);
  const m = /^(.*)\{(\d)\}$/.exec(n);                   // a baker line "Team{3}": the member per frame
  if (m) { const k = +m[2], f = activeSquare >= 19 ? 9 : Math.floor(activeSquare / 2); n = m[1] + ' ' + ((f % k) + 1) + '/' + k; }
  return n;
}

// The marks of one bowler's ten frames: [[mark, mark(, mark)], ...] with { t, split, foul }. The
// frames before the game type's first (10th Frame, Short Game: LanedataUtil::FirstBallOfSerie) are
// not played and stay empty, as on the lane TV
export function frameMarks(p) {
  const s = p.score, st = p.status, as = p.activeSquare, first = firstBallOfSerie(p.scoreMode);
  const mk = (i, v, prevForSpare) => {
    if (i >= as || i < first) return null;
    const foul = (st[i] & GCI.FOUL) !== 0, split = (st[i] & GCI.SPLIT) !== 0;
    let t;
    if (foul) t = 'F';
    else if (prevForSpare !== null && prevForSpare !== 10 && prevForSpare + v === 10) t = '/';
    else if (v === 10) t = 'X';
    else if (v === 0) t = '-';
    else t = String(v);
    return { t, split: split && t !== 'X', foul };
  };
  const frames = [];
  for (let f = 0; f < 9; f++) {
    const a = 2 * f;
    const first = mk(a, s[a], null);
    const second = first && first.t === 'X' ? null : mk(a + 1, s[a + 1], s[a]);
    frames.push([first, second]);
  }
  const b18 = mk(18, s[18], null);
  const b19 = mk(19, s[19], s[18] === 10 ? null : s[18]);
  const b20 = mk(20, s[20], (s[18] === 10 && s[19] !== 10) ? s[19] : (s[18] !== 10 && s[18] + s[19] === 10) ? null : null);
  frames.push([b18, b19, b20]);
  return frames;
}

// pis: the lane struct; opts: { lane, active (index of the bowler up, -1 none), cfg, big, practice: text, title }
export function drawScoreView(canvas, pis, opts = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = W / VIEW_W;
  g.setTransform(k, 0, 0, k, 0, 0);
  // the Standard theme's dark blue
  const bg = g.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#13305e'); bg.addColorStop(1, '#081429');
  g.fillStyle = bg; g.fillRect(0, 0, VIEW_W, VIEW_H);
  // the band: the lane and the booking
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, VIEW_W, 30);
  g.fillStyle = opts.highlight ? '#E2B550' : '#cfd8e8';
  g.font = `700 21px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText((opts.laneWord || 'Bana') + ' ' + (opts.lane || pis.laneNumber), 10, 16);
  g.textAlign = 'right'; g.fillStyle = '#9fb3d4'; g.font = `600 15px ${FONT}`;
  const title = opts.title || pis.booking_name || '';
  g.fillText(title.length > 34 ? title.slice(0, 33) + '…' : title, VIEW_W - 10, 16);
  const n = Math.max(1, Math.min(8, pis.noPlayers));
  const top = 34, foot = opts.practice ? 30 : 6;
  const rowH = Math.min(58, Math.max(26, (VIEW_H - top - foot) / Math.max(4, n)));
  const nameW = 112, totW = 54, fw = (VIEW_W - nameW - totW - 8) / 10;
  if (!pis.noPlayers) {
    g.textAlign = 'center'; g.fillStyle = '#9fb3d4'; g.font = `600 22px ${FONT}`;
    g.fillText(opts.emptyText || '', VIEW_W / 2, VIEW_H / 2);
    return;
  }
  for (let i = 0; i < n; i++) {
    const p = pis.player[i];
    const y = top + i * rowH;
    const up = i === opts.active;
    g.fillStyle = up ? 'rgba(226,181,80,0.22)' : (i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)');
    g.fillRect(4, y, VIEW_W - 8, rowH - 2);
    if (up) { g.strokeStyle = '#E2B550'; g.lineWidth = 2; g.strokeRect(5, y + 1, VIEW_W - 10, rowH - 4); }
    // the name
    g.textAlign = 'left'; g.fillStyle = up ? '#ffe7a8' : '#ffffff';
    g.font = `700 ${Math.round(Math.min(20, rowH * 0.46))}px ${FONT}`;
    let name = displayName(p.playerName, p.activeSquare);
    while (name.length > 3 && g.measureText(name).width > nameW - 14) name = name.slice(0, -1);
    g.fillText(name, 10, y + rowH / 2);
    // the frames
    const marks = frameMarks(p);
    const totals = runningTotals(p.score, p.activeSquare, !!opts.cfg, true);
    // no running total in the frames the game type does not play (10th Frame, Short Game)
    const firstFrame = Math.floor(firstBallOfSerie(p.scoreMode) / 2);
    for (let f = 0; f < firstFrame; f++) totals[f] = null;
    const markF = Math.round(Math.min(16, rowH * 0.36)), totF = Math.round(Math.min(18, rowH * 0.4));
    for (let f = 0; f < 10; f++) {
      const x = nameW + f * fw;
      const activeFrame = up && (f === 9 ? p.activeSquare >= 18 : Math.floor(p.activeSquare / 2) === f);
      g.fillStyle = activeFrame ? 'rgba(226,181,80,0.35)' : 'rgba(0,0,0,0.28)';
      g.fillRect(x + 1, y + 2, fw - 2, rowH - 6);
      const cells = marks[f];
      const cw = (fw - 2) / cells.length;
      g.font = `700 ${markF}px ${FONT}`; g.textAlign = 'center';
      cells.forEach((m, c) => {
        if (!m) return;
        const cx = x + 1 + cw * c + cw / 2, cy = y + 2 + rowH * 0.24;
        g.fillStyle = m.t === 'X' ? '#ffd257' : m.t === '/' ? '#7fd0ff' : m.foul ? '#ff7070' : '#ffffff';
        g.fillText(m.t, cx, cy);
        if (m.split) { g.strokeStyle = '#ff8a8a'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, markF * 0.55, 0, Math.PI * 2); g.stroke(); }
      });
      if (totals[f] !== null) {
        g.font = `700 ${totF}px ${FONT}`; g.fillStyle = '#e8eef8';
        g.fillText(String(totals[f]), x + fw / 2, y + rowH * 0.68);
      }
    }
    // the total so far, and the bowler's total over the series in a competition
    let tot = 0;
    for (let f = 9; f >= 0; f--) if (totals[f] !== null) { tot = totals[f]; break; }
    g.textAlign = 'right'; g.fillStyle = '#ffd257'; g.font = `700 ${Math.round(Math.min(22, rowH * 0.5))}px ${FONT}`;
    g.fillText(String(tot + (p.hcp || 0) * (pis.hcp_mode === 0 && !pis.dllName ? 1 : 0)), VIEW_W - 10, y + rowH / 2);
  }
  // the practice box (the theme's practice layout: the description over the value)
  if (opts.practice) {
    g.fillStyle = 'rgba(180,30,40,0.85)'; g.fillRect(0, VIEW_H - 28, VIEW_W, 28);
    g.fillStyle = '#ffffff'; g.font = `700 17px ${FONT}`; g.textAlign = 'center';
    g.fillText(opts.practice, VIEW_W / 2, VIEW_H - 14);
  }
}

// A blob/JPEG of the view, for the lane console's picture of a lane (VTVFile<n>.jpg)
export function scoreViewBlob(pis, opts) {
  const c = document.createElement('canvas');
  c.width = 960; c.height = 540;
  drawScoreView(c, pis, opts);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
}

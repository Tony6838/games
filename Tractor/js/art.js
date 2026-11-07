/* 牌面、牌背、桌布、木纹：全部由 Canvas 现场绘制，不依赖任何图片文件。花色符号用矢量路径画，各系统显示一致。 */
(function (root) {
  'use strict';
  const C = root.TJ.Cards;

  const W = 256;
  const H = 358;
  const COLS = 10;
  const ROWS = 6;
  const PAPER = '#fbf8ef';
  const RED = '#c4202a';
  const BLACK = '#1b1d24';
  const GOLD = '#c9a24b';
  const FONT = '"Georgia","Times New Roman","Songti SC","SimSun",serif';
  const KAI = '"KaiTi","STKaiti","BiauKai","SimSun",serif';

  const isRed = (s) => s === 1 || s === 3;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /** 以 (x,y) 为中心、size 为高度画花色符号。 */
  function suitPath(g, s, x, y, size) {
    const r = size / 2;
    g.beginPath();
    if (s === 1) { // 红桃
      g.moveTo(x, y + r);
      g.bezierCurveTo(x - r * 1.5, y - r * 0.15, x - r * 0.95, y - r * 1.15, x, y - r * 0.42);
      g.bezierCurveTo(x + r * 0.95, y - r * 1.15, x + r * 1.5, y - r * 0.15, x, y + r);
    } else if (s === 3) { // 方块
      g.moveTo(x, y - r);
      g.quadraticCurveTo(x + r * 0.28, y - r * 0.28, x + r * 0.78, y);
      g.quadraticCurveTo(x + r * 0.28, y + r * 0.28, x, y + r);
      g.quadraticCurveTo(x - r * 0.28, y + r * 0.28, x - r * 0.78, y);
      g.quadraticCurveTo(x - r * 0.28, y - r * 0.28, x, y - r);
    } else if (s === 0) { // 黑桃
      g.moveTo(x, y - r);
      g.bezierCurveTo(x + r * 0.3, y - r * 0.42, x + r * 1.2, y - r * 0.05, x + r * 0.82, y + r * 0.48);
      g.bezierCurveTo(x + r * 0.55, y + r * 0.78, x + r * 0.18, y + r * 0.58, x + r * 0.1, y + r * 0.3);
      g.quadraticCurveTo(x + r * 0.16, y + r * 0.82, x + r * 0.42, y + r);
      g.lineTo(x - r * 0.42, y + r);
      g.quadraticCurveTo(x - r * 0.16, y + r * 0.82, x - r * 0.1, y + r * 0.3);
      g.bezierCurveTo(x - r * 0.18, y + r * 0.58, x - r * 0.55, y + r * 0.78, x - r * 0.82, y + r * 0.48);
      g.bezierCurveTo(x - r * 1.2, y - r * 0.05, x - r * 0.3, y - r * 0.42, x, y - r);
    } else { // 梅花
      const b = r * 0.46;
      g.arc(x, y - r * 0.5, b, 0, Math.PI * 2);
      g.moveTo(x - r * 0.48 + b, y + r * 0.12);
      g.arc(x - r * 0.48, y + r * 0.12, b, 0, Math.PI * 2);
      g.moveTo(x + r * 0.48 + b, y + r * 0.12);
      g.arc(x + r * 0.48, y + r * 0.12, b, 0, Math.PI * 2);
      g.moveTo(x + r * 0.1, y + r * 0.2);
      g.quadraticCurveTo(x + r * 0.16, y + r * 0.82, x + r * 0.42, y + r);
      g.lineTo(x - r * 0.42, y + r);
      g.quadraticCurveTo(x - r * 0.16, y + r * 0.82, x - r * 0.1, y + r * 0.2);
      g.closePath();
    }
    g.fill();
  }

  function drawSuit(g, s, x, y, size, flip) {
    g.fillStyle = isRed(s) ? RED : BLACK;
    if (flip) {
      g.save();
      g.translate(x, y);
      g.rotate(Math.PI);
      suitPath(g, s, 0, 0, size);
      g.restore();
    } else {
      suitPath(g, s, x, y, size);
    }
  }

  function corner(g, kind) {
    const s = C.suitOf(kind);
    const text = C.rankText(C.rankOf(kind));
    g.fillStyle = isRed(s) ? RED : BLACK;
    g.font = 'bold ' + (text === '10' ? 58 : 66) + 'px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 40, 46);
    drawSuit(g, s, 40, 104, 46);
  }

  const PIPS = {
    2: [[0.5, 0.2], [0.5, 0.8]],
    3: [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8]],
    4: [[0.32, 0.2], [0.68, 0.2], [0.32, 0.8], [0.68, 0.8]],
    5: [[0.32, 0.2], [0.68, 0.2], [0.5, 0.5], [0.32, 0.8], [0.68, 0.8]],
    6: [[0.32, 0.2], [0.68, 0.2], [0.32, 0.5], [0.68, 0.5], [0.32, 0.8], [0.68, 0.8]],
    7: [[0.32, 0.2], [0.68, 0.2], [0.5, 0.35], [0.32, 0.5], [0.68, 0.5], [0.32, 0.8], [0.68, 0.8]],
    8: [[0.32, 0.2], [0.68, 0.2], [0.5, 0.35], [0.32, 0.5], [0.68, 0.5], [0.5, 0.65], [0.32, 0.8], [0.68, 0.8]],
    9: [[0.32, 0.17], [0.68, 0.17], [0.32, 0.39], [0.68, 0.39], [0.5, 0.5], [0.32, 0.61], [0.68, 0.61], [0.32, 0.83], [0.68, 0.83]],
    10: [[0.32, 0.17], [0.68, 0.17], [0.5, 0.28], [0.32, 0.39], [0.68, 0.39], [0.32, 0.61], [0.68, 0.61], [0.5, 0.72], [0.32, 0.83], [0.68, 0.83]],
  };

  /** J Q K：自己画的徽章式牌面（不是传统宫廷人物）。 */
  function courtPanel(g, s, r) {
    const col = isRed(s) ? RED : BLACK;
    const accent = isRed(s) ? '#e7b94f' : '#3d6fb8';
    const x0 = 62;
    const y0 = 60;
    const w = W - 124;
    const h = H - 120;
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.strokeRect(x0, y0, w, h);
    g.fillStyle = isRed(s) ? 'rgba(196,32,42,0.07)' : 'rgba(27,29,36,0.06)';
    g.fillRect(x0, y0, w, h);
    const cx = W / 2;
    const cy = H / 2;
    // 对称的斜纹底
    g.save();
    g.beginPath();
    g.rect(x0, y0, w, h);
    g.clip();
    g.strokeStyle = accent;
    g.globalAlpha = 0.35;
    g.lineWidth = 2;
    for (let i = -h; i < w; i += 22) {
      g.beginPath();
      g.moveTo(x0 + i, y0);
      g.lineTo(x0 + i + h, y0 + h);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
    // 上下对称的徽章：冠（K）、花（Q）、盾（J）
    const emblem = (ey, flip) => {
      g.save();
      g.translate(cx, ey);
      if (flip) g.rotate(Math.PI);
      g.fillStyle = accent;
      if (r === 13) {
        g.beginPath();
        g.moveTo(-34, 16);
        g.lineTo(-40, -18);
        g.lineTo(-16, 2);
        g.lineTo(0, -26);
        g.lineTo(16, 2);
        g.lineTo(40, -18);
        g.lineTo(34, 16);
        g.closePath();
        g.fill();
      } else if (r === 12) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.beginPath();
          g.ellipse(Math.cos(a) * 16, Math.sin(a) * 16, 13, 8, a, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = col;
        g.beginPath();
        g.arc(0, 0, 7, 0, Math.PI * 2);
        g.fill();
      } else {
        g.beginPath();
        g.moveTo(-26, -20);
        g.lineTo(26, -20);
        g.quadraticCurveTo(28, 14, 0, 26);
        g.quadraticCurveTo(-28, 14, -26, -20);
        g.fill();
      }
      g.restore();
    };
    emblem(y0 + 46, false);
    emblem(y0 + h - 46, true);
    g.fillStyle = col;
    g.font = 'bold 86px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(C.rankText(r), cx, cy + 3);
    drawSuit(g, s, x0 + 24, cy, 28);
    drawSuit(g, s, x0 + w - 24, cy, 28);
  }

  function jokerFace(g, big) {
    const col = big ? RED : BLACK;
    const accent = big ? '#e7b94f' : '#6f7682';
    const cx = W / 2;
    const cy = H / 2;
    g.fillStyle = accent;
    const rays = 16;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a - 0.09) * 42, cy + Math.sin(a - 0.09) * 42);
      g.lineTo(cx + Math.cos(a) * 86, cy + Math.sin(a) * 86);
      g.lineTo(cx + Math.cos(a + 0.09) * 42, cy + Math.sin(a + 0.09) * 42);
      g.closePath();
      g.fill();
    }
    g.fillStyle = col;
    g.beginPath();
    g.arc(cx, cy, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PAPER;
    g.font = 'bold 56px ' + KAI;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('王', cx, cy + 3);
    // 角上竖排文字，手牌重叠时也认得出
    g.fillStyle = col;
    g.font = 'bold 56px ' + KAI;
    g.fillText(big ? '大' : '小', 40, 46);
    g.fillText('王', 40, 104);
    g.save();
    g.translate(W, H);
    g.rotate(Math.PI);
    g.fillText(big ? '大' : '小', 40, 46);
    g.fillText('王', 40, 104);
    g.restore();
  }

  function drawFace(g, kind) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    if (C.isJoker(kind)) {
      jokerFace(g, kind === C.BIG_JOKER);
      return;
    }
    const s = C.suitOf(kind);
    const r = C.rankOf(kind);
    if (r <= 10) {
      const size = r >= 9 ? 50 : 56;
      for (const [px, py] of PIPS[r]) {
        const x = 48 + px * (W - 96);
        const y = 24 + py * (H - 48);
        drawSuit(g, s, x, y, size, py > 0.55);
      }
    } else if (r === 14) {
      drawSuit(g, s, W / 2, H / 2, 128);
    } else {
      courtPanel(g, s, r);
    }
    corner(g, kind);
    g.save();
    g.translate(W, H);
    g.rotate(Math.PI);
    corner(g, kind);
    g.restore();
  }

  function drawBack(g) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    const m = 14;
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#8e1f2c');
    grad.addColorStop(1, '#5e111d');
    g.fillStyle = grad;
    g.fillRect(m, m, W - m * 2, H - m * 2);
    g.save();
    g.beginPath();
    g.rect(m, m, W - m * 2, H - m * 2);
    g.clip();
    g.strokeStyle = 'rgba(232,196,120,0.42)';
    g.lineWidth = 2;
    for (let i = -H; i < W + H; i += 24) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H, H);
      g.stroke();
      g.beginPath();
      g.moveTo(i + H, 0);
      g.lineTo(i, H);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = GOLD;
    g.lineWidth = 4;
    g.strokeRect(m + 8, m + 8, W - (m + 8) * 2, H - (m + 8) * 2);
    g.fillStyle = '#5e111d';
    g.beginPath();
    g.arc(W / 2, H / 2, 50, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = GOLD;
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = GOLD;
    g.font = 'bold 60px ' + KAI;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('八', W / 2, H / 2 - 2);
  }

  /** 54 种牌面 + 牌背。牌背放在最后一格。 */
  function buildAtlas() {
    const canvas = makeCanvas(W * COLS, H * ROWS);
    const g = canvas.getContext('2d');
    const place = (i, fn) => {
      g.save();
      g.translate((i % COLS) * W, Math.floor(i / COLS) * H);
      g.beginPath();
      g.rect(0, 0, W, H);
      g.clip();
      fn(g);
      g.restore();
    };
    for (let k = 0; k < 54; k++) place(k, (x) => drawFace(x, k));
    place(54, drawBack);
    const cell = (i) => [(i % COLS) / COLS, Math.floor(i / COLS) / ROWS, 1 / COLS, 1 / ROWS];
    return { canvas, cell, backCell: cell(54) };
  }

  const iconCache = new Map();
  function iconUrl(k) {
    if (iconCache.has(k)) return iconCache.get(k);
    const scale = 0.4;
    const w = Math.round(W * scale);
    const h = Math.round(H * scale);
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const r = 9;
    g.beginPath();
    g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r);
    g.clip();
    g.scale(scale, scale);
    drawFace(g, k);
    const url = c.toDataURL('image/png');
    iconCache.set(k, url);
    return url;
  }

  function suitIcon(s, color) {
    const c = makeCanvas(48, 48);
    const g = c.getContext('2d');
    g.fillStyle = color || (isRed(s) ? '#e8505a' : '#f3ead6');
    suitPath(g, s, 24, 24, 40);
    return c.toDataURL('image/png');
  }

  function buildFelt() {
    const S = 1024;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#123555';
    g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    let seed = 2024;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 15;
      d[i] = Math.max(0, d[i] + n);
      d[i + 1] = Math.max(0, d[i + 1] + n);
      d[i + 2] = Math.max(0, d[i + 2] + n);
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.05;
    g.strokeStyle = '#d5e4f5';
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const a = rnd() * Math.PI * 2;
      g.lineWidth = 0.6 + rnd();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
      g.stroke();
    }
    g.globalAlpha = 1;
    return c;
  }

  function buildWood() {
    const S = 512;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#35201a';
    g.fillRect(0, 0, S, S);
    let seed = 991;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 220; i++) {
      const y = rnd() * S;
      const dark = rnd() > 0.5;
      g.strokeStyle = dark ? 'rgba(14,7,4,0.34)' : 'rgba(120,80,55,0.13)';
      g.lineWidth = 0.6 + rnd() * 2.6;
      g.beginPath();
      g.moveTo(0, y);
      const wob = 3 + rnd() * 10;
      for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.012 + i) * wob);
      g.stroke();
    }
    return c;
  }

  root.TJ.Art = { buildAtlas, iconUrl, suitIcon, suitPath, buildFelt, buildWood, makeCanvas, CARD_ASPECT: H / W };
})(typeof self !== 'undefined' ? self : globalThis);

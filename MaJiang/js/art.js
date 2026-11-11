/* 牌面、骰子、桌布、木纹：全部由 Canvas 现场绘制，不依赖任何图片文件。 */
(function (root) {
  'use strict';
  const T = root.MJ.Tiles;

  const CELL_W = 256;
  const CELL_H = 346;
  const COLS = 7;
  const ROWS = 6;
  const INK = '#17294f';
  const RED = '#b4232a';
  const GREEN = '#127a4c';
  const BLUE = '#1f4fa3';
  const FONT = '"KaiTi","STKaiti","BiauKai","Noto Serif CJK SC","Source Han Serif SC","SimSun",serif';

  function dotRing(g, x, y, r, color, center) {
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f7f2e4';
    g.beginPath(); g.arc(x, y, r * 0.72, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r * 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = center || '#f7f2e4';
    g.beginPath(); g.arc(x, y, r * 0.2, 0, Math.PI * 2); g.fill();
  }

  function drawTong(g, n) {
    const W = CELL_W;
    const H = CELL_H;
    const cx = W / 2;
    const cy = H / 2;
    const xs3 = [W * 0.27, W * 0.5, W * 0.73];
    const xs2 = [W * 0.32, W * 0.68];
    switch (n) {
      case 1: {
        dotRing(g, cx, cy, 86, GREEN, RED);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          g.fillStyle = i % 2 ? RED : BLUE;
          g.beginPath();
          g.arc(cx + Math.cos(a) * 66, cy + Math.sin(a) * 66, 7, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 2:
        dotRing(g, cx, H * 0.31, 46, GREEN);
        dotRing(g, cx, H * 0.69, 46, BLUE);
        break;
      case 3:
        dotRing(g, W * 0.25, H * 0.22, 36, BLUE);
        dotRing(g, cx, cy, 36, RED);
        dotRing(g, W * 0.75, H * 0.78, 36, GREEN);
        break;
      case 4:
        for (const [x, y, c] of [[0, 0, BLUE], [1, 0, GREEN], [0, 1, GREEN], [1, 1, BLUE]]) {
          dotRing(g, xs2[x], y ? H * 0.7 : H * 0.3, 40, c);
        }
        break;
      case 5:
        for (const [x, y, c] of [[0, 0, BLUE], [1, 0, GREEN], [0, 1, GREEN], [1, 1, BLUE]]) {
          dotRing(g, x ? W * 0.74 : W * 0.26, y ? H * 0.78 : H * 0.22, 34, c);
        }
        dotRing(g, cx, cy, 34, RED);
        break;
      case 6:
        for (let i = 0; i < 2; i++) dotRing(g, xs2[i], H * 0.2, 33, GREEN);
        for (let r = 0; r < 2; r++) for (let i = 0; i < 2; i++) dotRing(g, xs2[i], H * (0.5 + r * 0.3), 33, RED);
        break;
      case 7:
        for (let i = 0; i < 3; i++) dotRing(g, W * (0.24 + i * 0.26), H * (0.14 + i * 0.09), 26, GREEN);
        for (let r = 0; r < 2; r++) for (let i = 0; i < 2; i++) dotRing(g, xs2[i], H * (0.59 + r * 0.25), 30, RED);
        break;
      case 8:
        for (let r = 0; r < 4; r++) for (let i = 0; i < 2; i++) dotRing(g, xs2[i], H * (0.14 + r * 0.24), 30, BLUE);
        break;
      default: {
        const cols = [GREEN, RED, BLUE];
        for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) dotRing(g, xs3[i], H * (0.2 + r * 0.3), 28, cols[r]);
      }
    }
  }

  function stick(g, x, y, h, color) {
    const w = 18;
    g.save();
    g.translate(x, y);
    g.fillStyle = color;
    const rr = (px, py, pw, ph, r) => {
      g.beginPath();
      g.moveTo(px + r, py);
      g.arcTo(px + pw, py, px + pw, py + ph, r);
      g.arcTo(px + pw, py + ph, px, py + ph, r);
      g.arcTo(px, py + ph, px, py, r);
      g.arcTo(px, py, px + pw, py, r);
      g.fill();
    };
    rr(-w / 2, -h / 2, w, h, 8);
    g.fillStyle = '#f7f2e4';
    g.fillRect(-w / 2 + 6, -h / 2 + 8, w - 12, h - 16);
    g.fillStyle = color;
    rr(-w / 2 - 3, -h / 2, w + 6, 10, 4);
    rr(-w / 2 - 3, -5, w + 6, 10, 4);
    rr(-w / 2 - 3, h / 2 - 10, w + 6, 10, 4);
    g.restore();
  }

  /**
   * 一条：一只站着的小鸟，自己画的造型。
   * 整只鸟在自己的坐标里占 x -60..122、y -130..89，中心在 (31, -20.5)：放大 1.04 倍后把这个中心对准牌面中心，
   * 左右、上下留白一样多。左下的尾巴和右边的头、嘴分量相当，所以鸟身、脚和墨色的重心也都在正中附近。
   * 改了鸟的形状要按画出来的像素重新量外框，再改这里的数。
   */
  function drawBird(g) {
    g.save();
    g.translate(CELL_W / 2, CELL_H / 2);
    g.scale(1.04, 1.04);
    g.translate(-31, 20.5);
    // 尾巴：两根短羽往左下方伸出
    for (const [a, c, len, w] of [[-0.35, RED, 24, 8], [-0.7, BLUE, 26, 9]]) {
      g.save();
      g.translate(-14, 18);
      g.rotate(a);
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(-len, 0, len, w, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // 背上的长羽：四根往右上方展开，根部都在离原点 26 处；最右边那根短一些，不伸出鸟嘴
    const fan = [[-1.15, RED, 58], [-0.85, BLUE, 58], [-0.55, GREEN, 58], [-0.25, RED, 47]];
    for (const [a, c, len] of fan) {
      g.save();
      g.rotate(a + Math.PI / 2);
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(0, -(26 + len), 15, len, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // 身体
    g.fillStyle = GREEN;
    g.beginPath(); g.ellipse(26, 8, 54, 40, -0.35, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f0c24b';
    g.beginPath(); g.ellipse(36, 14, 26, 18, -0.35, 0, Math.PI * 2); g.fill();
    // 翅膀
    g.fillStyle = BLUE;
    g.beginPath(); g.ellipse(6, 4, 30, 17, 0.4, 0, Math.PI * 2); g.fill();
    // 头和喙
    g.fillStyle = RED;
    g.beginPath(); g.arc(68, -38, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f0a020';
    g.beginPath(); g.moveTo(88, -44); g.lineTo(116, -36); g.lineTo(88, -28); g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(74, -44, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111';
    g.beginPath(); g.arc(76, -44, 3.5, 0, Math.PI * 2); g.fill();
    // 脚
    g.strokeStyle = '#a4631c';
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(18, 44); g.lineTo(10, 84); g.moveTo(40, 40); g.lineTo(44, 84); g.stroke();
    g.beginPath(); g.moveTo(-6, 86); g.lineTo(62, 86); g.stroke();
    g.restore();
  }

  function drawTiao(g, n) {
    const W = CELL_W;
    const H = CELL_H;
    const cx = W / 2;
    const h = 92;
    switch (n) {
      case 1: drawBird(g); break;
      case 2:
        stick(g, cx, H * 0.29, 118, GREEN);
        stick(g, cx, H * 0.71, 118, BLUE);
        break;
      case 3:
        stick(g, cx, H * 0.27, 112, BLUE);
        stick(g, W * 0.32, H * 0.72, 112, GREEN);
        stick(g, W * 0.68, H * 0.72, 112, GREEN);
        break;
      case 4:
        for (const [x, y, c] of [[0.32, 0.28, BLUE], [0.68, 0.28, GREEN], [0.32, 0.72, GREEN], [0.68, 0.72, BLUE]]) {
          stick(g, W * x, H * y, 118, c);
        }
        break;
      case 5:
        for (const [x, y, c] of [[0.24, 0.26, GREEN], [0.76, 0.26, BLUE], [0.24, 0.74, BLUE], [0.76, 0.74, GREEN]]) {
          stick(g, W * x, H * y, 106, c);
        }
        stick(g, cx, H * 0.5, 106, RED);
        break;
      case 6:
        for (let r = 0; r < 2; r++) {
          for (let i = 0; i < 3; i++) stick(g, W * (0.22 + i * 0.28), H * (0.28 + r * 0.44), 112, r ? BLUE : GREEN);
        }
        break;
      case 7:
        stick(g, cx, H * 0.15, 66, RED);
        for (let r = 0; r < 2; r++) {
          for (let i = 0; i < 3; i++) stick(g, W * (0.22 + i * 0.28), H * (0.45 + r * 0.33), h, r ? BLUE : GREEN);
        }
        break;
      case 8:
        // 上下两排、每排四根竖条，间距相等，一眼数得清；外侧两根绿、中间两根蓝
        for (let r = 0; r < 2; r++) {
          for (let i = 0; i < 4; i++) {
            stick(g, cx + (i - 1.5) * 57, H * (0.28 + r * 0.44), 112, i === 0 || i === 3 ? GREEN : BLUE);
          }
        }
        break;
      default: {
        const cols = [RED, BLUE, GREEN];
        for (let i = 0; i < 3; i++) {
          for (let r = 0; r < 3; r++) stick(g, W * (0.22 + i * 0.28), H * (0.19 + r * 0.31), h, cols[r === 1 ? 1 : i === 1 ? 0 : 2]);
        }
      }
    }
  }

  function bigText(g, ch, x, y, size, color) {
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = size / 42;
    g.font = 'bold ' + size + 'px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, x, y);
    g.strokeText(ch, x, y);
  }

  function blossom(g, x, y, r, color, petals) {
    g.fillStyle = color;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.42, r * 0.28, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f0c24b';
    g.beginPath(); g.arc(x, y, r * 0.28, 0, Math.PI * 2); g.fill();
  }

  const FLOWER_LOOK = [
    { ch: '春', col: GREEN, bloom: '#d6517a', n: 1 },
    { ch: '夏', col: RED, bloom: '#e0663a', n: 2 },
    { ch: '秋', col: '#a86414', bloom: '#d58a1c', n: 3 },
    { ch: '冬', col: BLUE, bloom: '#4f86c8', n: 4 },
    { ch: '梅', col: RED, bloom: '#d6517a', n: 1 },
    { ch: '蘭', col: BLUE, bloom: '#7d58b8', n: 2 },
    { ch: '竹', col: GREEN, bloom: '#2c9a62', n: 3 },
    { ch: '菊', col: '#a86414', bloom: '#e0a020', n: 4 },
  ];

  function drawFace(g, k) {
    const W = CELL_W;
    const H = CELL_H;
    g.save();
    if (k < 9) {
      bigText(g, T.CN_NUM[k], W / 2, H * 0.3, 118, INK);
      bigText(g, '萬', W / 2, H * 0.71, 128, RED);
    } else if (k < 18) {
      drawTiao(g, k - 9 + 1);
    } else if (k < 27) {
      drawTong(g, k - 18 + 1);
    } else if (k < 31) {
      bigText(g, ['東', '南', '西', '北'][k - 27], W / 2, H / 2, 186, INK);
    } else if (k === 31) {
      bigText(g, '中', W / 2, H / 2, 196, RED);
    } else if (k === 32) {
      bigText(g, '發', W / 2, H / 2, 186, GREEN);
    } else if (k === 33) {
      g.strokeStyle = BLUE;
      g.lineWidth = 11;
      g.strokeRect(W * 0.2, H * 0.17, W * 0.6, H * 0.66);
      g.lineWidth = 4;
      g.strokeRect(W * 0.26, H * 0.215, W * 0.48, H * 0.57);
    } else {
      const f = FLOWER_LOOK[k - 34];
      bigText(g, f.ch, W / 2, H * 0.31, 122, f.col);
      blossom(g, W * 0.5, H * 0.73, 54, f.bloom, 6);
      blossom(g, W * 0.26, H * 0.82, 22, f.bloom, 5);
      blossom(g, W * 0.74, H * 0.82, 22, f.bloom, 5);
      bigText(g, String(f.n), W * 0.17, H * 0.12, 42, f.col);
    }
    g.restore();
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /** 42 种牌面合成一张图集，透明底，贴在 3D 牌的正面。 */
  function buildAtlas() {
    const canvas = makeCanvas(CELL_W * COLS, CELL_H * ROWS);
    const g = canvas.getContext('2d');
    for (let k = 0; k < 42; k++) {
      g.save();
      g.translate((k % COLS) * CELL_W, Math.floor(k / COLS) * CELL_H);
      g.beginPath();
      g.rect(0, 0, CELL_W, CELL_H);
      g.clip();
      drawFace(g, k);
      g.restore();
    }
    return {
      canvas,
      cell(k) {
        return [(k % COLS) / COLS, Math.floor(k / COLS) / ROWS, 1 / COLS, 1 / ROWS];
      },
    };
  }

  const iconCache = new Map();
  /** 界面里用的小牌图。 */
  function iconUrl(k) {
    if (iconCache.has(k)) return iconCache.get(k);
    const scale = 0.42;
    const pad = 8;
    const w = Math.round(CELL_W * scale) + pad;
    const h = Math.round(CELL_H * scale) + pad;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const r = 12;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#fbf7ea');
    bg.addColorStop(1, '#e9e2cd');
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r);
    g.fill();
    g.save();
    g.translate(pad / 2, pad / 2);
    g.scale(scale, scale);
    drawFace(g, k);
    g.restore();
    const url = c.toDataURL('image/png');
    iconCache.set(k, url);
    return url;
  }

  /** 骰子六个面，3×2 排布。1 和 4 的点按传统用红色。 */
  function buildDiceAtlas() {
    const S = 128;
    const c = makeCanvas(S * 3, S * 2);
    const g = c.getContext('2d');
    const spots = {
      1: [[0.5, 0.5]],
      2: [[0.3, 0.3], [0.7, 0.7]],
      3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
      4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
      5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
      6: [[0.3, 0.24], [0.7, 0.24], [0.3, 0.5], [0.7, 0.5], [0.3, 0.76], [0.7, 0.76]],
    };
    // 面序对应网格：+x=2, -x=5, +y=1, -y=6, +z=3, -z=4
    const order = [2, 5, 1, 6, 3, 4];
    order.forEach((v, i) => {
      const x = (i % 3) * S;
      const y = Math.floor(i / 3) * S;
      g.fillStyle = '#f6f1e3';
      g.fillRect(x, y, S, S);
      g.fillStyle = v === 1 || v === 4 ? '#c2262b' : '#20242c';
      const r = v === 1 ? 22 : 13;
      for (const [px, py] of spots[v]) {
        g.beginPath();
        g.arc(x + px * S, y + py * S, r, 0, Math.PI * 2);
        g.fill();
      }
    });
    return c;
  }

  function buildFelt() {
    const S = 1024;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#0a4538';
    g.fillRect(0, 0, S, S);
    // 绒面的细微纤维
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 16;
      d[i] = Math.max(0, d[i] + n);
      d[i + 1] = Math.max(0, d[i + 1] + n);
      d[i + 2] = Math.max(0, d[i + 2] + n);
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.05;
    g.strokeStyle = '#d7f0d0';
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
    let seed = 777;
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

  root.MJ.Art = { buildAtlas, iconUrl, buildDiceAtlas, buildFelt, buildWood, makeCanvas };
})(typeof self !== 'undefined' ? self : globalThis);

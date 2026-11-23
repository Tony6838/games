// ---------------------------------------------------------------------------
// hall.js - the bowling hall around the game's lanes, drawn with three.js. Everything is
// made here from geometry and canvas textures (the two VBS pictures it uses, the helmet
// and the "VBS Bowling" logo, are the lane console's own, web/screen/common/img).
//
// What it builds, for the game's lanes and the neighbouring lanes, to a real centre's layout
// (USBC dimensions; the lane itself is physics.js's LANE):
//   * the lanes (surface, approach, gutters, capping, foul-line units, kickbacks, pit and
//     curtain), merged into one mesh per material so twenty lanes cost the draw calls of one;
//   * the masking units: one long lit band across the hall (a Viking mural, the lane numbers on
//     plates), the fascia above it with a cyan neon line and a neon sign, and a soft glow under
//     the band over the pin decks;
//   * one overhead lane TV per lane, angled down; the playing lane's TV is larger and framed.
//     Each screen can be given its own canvas (setTvTexture, scene.setLaneTvTexture);
//   * every lane pair's ball return (hood, rack, three balls) and scoring console; the ceiling
//     with rows of warm light valances and the light they throw on the lanes (a light map, so
//     no extra dynamic lights), side walls with neon accents, a cosmic carpet behind the approach;
//   * on the high level also tables, settees, a back wall and a bar behind the approach (behind
//     the camera at every stance), and a planar reflection of the pin decks, masking units and
//     lights in the lane oil, strong on the oiled 40 ft and weaker on the dry back end;
//   * soft blob shadows under the neighbours' pins and the rolling balls;
//   * some quiet life: now and then a ball rolls down a lane two or more lanes away from the
//     game's lanes, pins fall, the rake sweeps and a new rack comes down. Seeded, so the same
//     sequence plays every time.
// The neighbouring pins and balls are instanced; the lighting is baked into emissive
// materials, a light map and an environment map rendered once from the hall.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { LANE, PIN_SPOTS } from './physics.js';
import { lowPinGeometry } from './pinmesh.js';

export const REFLECT_LAYER = 1;            // what the lane oil reflects (the mirror camera's layer)

// The two detail levels. left, right: the neighbouring lanes on each side of the game's lanes
// (the game's first lane is lane 5, so four on the left make the hall start at lane 1 and its
// wall show on the left; on the right the hall goes on out of sight).
export const DETAIL_LEVELS = {
  high: { left: 4, right: 12, mirror: true, mirrorScale: 0.5, envSize: 128, extras: true },
  low: { left: 4, right: 4, mirror: false, mirrorScale: 0, envSize: 32, extras: false }
};

const MOBILE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));   // iPadOS reports a Mac

// The level "auto" picks: low on phones and tablets, on four cores or fewer, with ?gfx=low
// and on a software renderer; high otherwise. The scene also drops to low by itself when the
// high level runs below about 26 frames a second (BowlingScene.watchFrameRate).
export function autoDetail(renderer) {
  if (/[?&]gfx=low/.test(location.search)) return 'low';
  if (MOBILE || (navigator.hardwareConcurrency || 8) <= 4) return 'low';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(name)) return 'low';
  } catch (e) { /* no renderer name: keep high */ }
  return 'high';
}

// ---- dimensions (metres; x across, y up, z down the lane, 0 = foul line) -----------------
const SP = LANE.laneSpacing;               // lane centre to lane centre
const W = LANE.width, G = LANE.gutter;
const LEN = LANE.pitEdge + 0.1;            // lane surface, foul line to the pit
const FLOOR = -0.12, CEIL = 3.5;
const MASK_Z = -LANE.pitEdge - 0.30;       // front of the masking units
const MASK_Y0 = 0.95, MASK_H = SP * 192 / 512, MASK_Y1 = MASK_Y0 + MASK_H;
const KICK_Z0 = -LANE.headPin + 0.75;      // kickbacks: the physics walls (physics.js) are -17.54 .. -20.14
const TV_Z = -3.0, TV_Y = 2.2, TV_TILT = 0.22;
const VALANCES = [-1.0, -5.5, -9.5, -13.5];
const WALKWAY = 1.8;                       // beside the outermost lanes, to the side walls
const HALL_Z0 = 12.5, HALL_Z1 = -20.6;     // back wall behind the settees .. end wall
const APPROACH_END = 4.6;                   // the approach: 4.6 m (USBC: at least 15 ft, 4.57 m)
const RETURN_Z = 3.0;                       // the ball return's hood: 3.0 .. 4.0 m behind the foul line, its rack to 4.84
const CONSOLE_Z = 8.3;                      // the scoring console, then the tables and settees: all behind the camera at
const SEATS_Z = 9.0;                        // every stance (it stands up to 4.4 + 3.6 m behind the foul line, scene.aimView)
const TV_PX = [512, 288];                  // a lane TV screen's canvas (16:9)

// ---- small helpers -------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(1, 1, 1));
  return geo.applyMatrix4(_m);
}
function tint(geo, color, k = 1) {
  const c = new THREE.Color(color).multiplyScalar(k);
  const n = geo.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function box(w, h, d, x, y, z, color, k) { return tint(xf(new THREE.BoxGeometry(w, h, d), x, y, z), color, k); }
// Concatenates geometries (position, normal, uv, color - the attributes they all have)
function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    if (!parts.every((p) => p.getAttribute(name))) continue;
    const size = parts[0].getAttribute(name).itemSize;
    const arr = new Float32Array(parts.reduce((n, p) => n + p.getAttribute(name).array.length, 0));
    let o = 0;
    for (const p of parts) { arr.set(p.getAttribute(name).array, o); o += p.getAttribute(name).array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of geos) g.dispose();
  for (const p of parts) p.dispose();
  out.computeBoundingSphere();
  return out;
}
// A rectangle with its UVs set to [u0..u1] x [v0..v1]
function quad(w, h, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  return g;
}
function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.userData.redraw = () => { draw(c.getContext('2d'), w, h); t.needsUpdate = true; };
  return t;
}
// Seeded random numbers, so the hall and its life look the same every time
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

// The two VBS pictures from the lane console, loaded once; the textures that use them are
// drawn again when they (and the font) have arrived.
const IMG = {};
function loadImage(key, src) {
  if (IMG[key]) return IMG[key].promise;
  const im = new Image();
  IMG[key] = { im, promise: new Promise((res) => { im.onload = () => res(im); im.onerror = () => res(null); }) };
  im.src = src;
  return IMG[key].promise;
}
const ready = (key) => (IMG[key] && IMG[key].im.complete && IMG[key].im.naturalWidth ? IMG[key].im : null);
function goldImage(im, w, h) {           // the white helmet as a gold emblem
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0, w, h);
  g.globalCompositeOperation = 'source-in';
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#F6D88A'); gr.addColorStop(1, '#B98A2E');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  return c;
}

// ---- the textures --------------------------------------------------------------------------
// The masking band: four lane cells of a Viking night (aurora, mountains, sea) with
// VIKING | BOWLING over the game's lane pair, the helmet with a longship, and VBS Bowling.
function muralTexture() {
  return canvasTexture(2048, 192, (g, Wd, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#071430'); sky.addColorStop(0.55, '#0d2750'); sky.addColorStop(1, '#143868');
    g.fillStyle = sky; g.fillRect(0, 0, Wd, H);
    const per = (x, f, ph) => Math.sin((x / Wd) * Math.PI * 2 * f + ph);      // periodic over the texture, so it repeats seamlessly
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let r = 0; r < 4; r++) {
      g.beginPath();
      for (let x = -8; x <= Wd + 8; x += 8) { const y = 46 + r * 13 + 16 * per(x, 2, r * 1.7) + 7 * per(x, 7, r); if (x < 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.strokeStyle = r % 2 ? 'rgba(70,170,255,0.10)' : 'rgba(60,230,170,0.12)';
      g.lineWidth = 16 - r * 2; g.shadowColor = g.strokeStyle; g.shadowBlur = 18;
      g.stroke();
    }
    g.restore();
    // stars
    const rand = rng(7);
    g.fillStyle = 'rgba(220,235,255,0.55)';
    for (let i = 0; i < 140; i++) g.fillRect(rand() * Wd, rand() * 80, 1.5, 1.5);
    // mountains and the sea
    g.fillStyle = '#081a38';
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= Wd; x += 8) g.lineTo(x, 150 - 26 * Math.abs(per(x, 3, 0.4)) - 12 * Math.abs(per(x, 11, 1.1)));
    g.lineTo(Wd, H); g.closePath(); g.fill();
    g.fillStyle = '#0a2346'; g.fillRect(0, 160, Wd, H - 160);
    g.fillStyle = 'rgba(120,190,255,0.18)';
    for (let i = 0; i < 60; i++) g.fillRect(rand() * Wd, 164 + rand() * 18, 10 + rand() * 30, 1.5);
    // the cells
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const word = (text, cx) => {
      g.font = `bold 78px ${FONT}`;
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText(text, cx + 3, 129);
      const gr = g.createLinearGradient(0, 95, 0, 165); gr.addColorStop(0, '#FFF3D0'); gr.addColorStop(1, '#E2B550');
      g.fillStyle = gr; g.fillText(text, cx, 126);
    };
    word('VIKING', 256); word('BOWLING', 768);
    const helm = ready('helm');
    if (helm) g.drawImage(goldImage(helm, 150, 88), 1024 + 70, 80);
    // a longship on the sea
    g.fillStyle = '#E2B550';
    g.beginPath(); g.moveTo(1024 + 270, 150); g.quadraticCurveTo(1024 + 340, 172, 1024 + 440, 150); g.lineTo(1024 + 452, 128); g.lineTo(1024 + 430, 146);
    g.quadraticCurveTo(1024 + 350, 160, 1024 + 285, 146); g.lineTo(1024 + 262, 128); g.closePath(); g.fill();
    g.fillRect(1024 + 352, 70, 4, 76);
    g.fillStyle = '#C8102E'; g.fillRect(1024 + 318, 76, 72, 56);
    g.fillStyle = '#F2F2F2'; for (let s = 0; s < 4; s++) g.fillRect(1024 + 318 + s * 18, 76, 9, 56);
    const vbs = ready('vbs');
    if (vbs) { g.globalAlpha = 0.95; g.drawImage(vbs, 1536 + 256 - 174, 100, 348, 57); g.globalAlpha = 1; }
    // trims: gold top and bottom, a dark seam between lanes
    g.fillStyle = '#E2B550'; g.fillRect(0, 0, Wd, 5); g.fillRect(0, H - 5, Wd, 5);
    g.fillStyle = 'rgba(3,8,18,0.8)';
    for (let x = 0; x <= Wd; x += 512) g.fillRect(x - 2, 5, 4, H - 10);
  }, true);
}

// The fascia over the masking units: dark, a faint VBS honeycomb and lighter panel seams
function fasciaTexture() {
  return canvasTexture(1024, 256, (g, Wd, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#04080f'); gr.addColorStop(1, '#0b1630');
    g.fillStyle = gr; g.fillRect(0, 0, Wd, H);
    g.strokeStyle = 'rgba(226,181,80,0.07)'; g.lineWidth = 2;
    const r = 26, hx = r * Math.sqrt(3);
    for (let row = 0; row * r * 1.5 < H + r; row++) for (let col = -1; col * hx < Wd + hx; col++) {
      const cx = col * hx + (row % 2) * hx / 2, cy = row * r * 1.5;
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      g.closePath(); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < Wd; x += 256) g.fillRect(x, 0, 2, H);
  }, true);
}

// The neon sign over the game's lanes
function neonTexture() {
  return canvasTexture(1024, 128, (g, Wd, H) => {
    g.clearRect(0, 0, Wd, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 92px ${FONT}`;
    for (const [blur, col] of [[28, 'rgba(40,200,255,0.9)'], [10, 'rgba(120,230,255,1)']]) {
      g.shadowColor = col; g.shadowBlur = blur; g.strokeStyle = col; g.lineWidth = 7; g.strokeText('VIKING  BOWLING', Wd / 2, H / 2 + 4);
    }
    g.shadowBlur = 0; g.strokeStyle = '#EFFFFF'; g.lineWidth = 2.5; g.strokeText('VIKING  BOWLING', Wd / 2, H / 2 + 4);
  });
}

function ceilingTexture() {
  return canvasTexture(128, 128, (g, Wd, H) => {
    g.fillStyle = '#0a111f'; g.fillRect(0, 0, Wd, H);
    g.fillStyle = '#121c31'; g.fillRect(0, 0, Wd, 2); g.fillRect(0, 0, 2, H);
    const rand = rng(3);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${rand() * 0.025})`; g.fillRect(rand() * Wd, rand() * H, 2, 2); }
  }, true);
}

// The carpet behind the approach, as bowling centres have it: neon shapes - rings, triangles,
// squiggles, stars - on near black. One 1.6 m tile, drawn so it repeats seamlessly.
function carpetTexture() {
  return canvasTexture(256, 256, (g, Wd, H) => {
    g.fillStyle = '#0a0d22'; g.fillRect(0, 0, Wd, H);
    const rand = rng(5);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '45,60,120' : '2,4,12'},0.6)`; g.fillRect(rand() * Wd, rand() * H, 2, 2); }   // the pile
    const cols = ['#29d3ff', '#ff3fb4', '#ffd23f', '#5dff8a', '#9b6bff'];
    const at = (fn) => { for (const dx of [-Wd, 0, Wd]) for (const dy of [-H, 0, H]) { g.save(); g.translate(dx, dy); fn(); g.restore(); } };   // wrap at the edges
    for (let i = 0; i < 22; i++) {
      const x = rand() * Wd, y = rand() * H, c = cols[Math.floor(rand() * cols.length)], kind = Math.floor(rand() * 5), r = 6 + rand() * 12, a = rand() * Math.PI * 2;
      at(() => {
        g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2.5; g.globalAlpha = 0.75;
        g.beginPath();
        if (kind === 0) g.arc(x, y, r, 0, Math.PI * 2);                                   // ring
        else if (kind === 1) for (let k = 0; k < 3; k++) g[k ? 'lineTo' : 'moveTo'](x + r * Math.cos(a + k * 2.094), y + r * Math.sin(a + k * 2.094));
        else if (kind === 2) for (let k = 0; k <= 6; k++) g[k ? 'lineTo' : 'moveTo'](x + (k - 3) * r / 3 * Math.cos(a) - (k % 2 ? 1 : -1) * 5 * Math.sin(a), y + (k - 3) * r / 3 * Math.sin(a) + (k % 2 ? 1 : -1) * 5 * Math.cos(a));   // squiggle
        else if (kind === 3) for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * 0.45 : r; g[k ? 'lineTo' : 'moveTo'](x + rr * Math.cos(a + k * 0.628), y + rr * Math.sin(a + k * 0.628)); }   // star
        else g.arc(x, y, 3, 0, Math.PI * 2);
        if (kind === 1 || kind === 3) g.closePath();
        if (kind === 4) g.fill(); else g.stroke();
        g.globalAlpha = 1;
      });
    }
  }, true);
}

// The side walls, one 8 m piece: neon stripes and a lit VBS panel
function wallTexture() {
  return canvasTexture(1024, 464, (g, Wd, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#070d1a'); gr.addColorStop(1, '#0c1730');
    g.fillStyle = gr; g.fillRect(0, 0, Wd, H);
    const rand = rng(9);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rand() * 0.03})`; g.fillRect(rand() * Wd, rand() * H, 2, 2); }   // the fabric
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < Wd; x += 128) g.fillRect(x, 0, 3, H - 40);                                  // acoustic panel seams
    g.fillStyle = '#05080f'; g.fillRect(0, H - 40, Wd, 40);            // skirting
    const line = (y, col, w) => { g.shadowColor = col; g.shadowBlur = 14; g.fillStyle = col; g.fillRect(0, y, Wd, w); g.shadowBlur = 0; };
    line(150, 'rgba(60,200,255,0.95)', 5);
    line(166, 'rgba(255,60,170,0.7)', 3);
    // a lit panel: the helmet and the VBS name
    const x = 380, y = 200, w = 264, h = 112;
    g.fillStyle = '#10264a'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#E2B550'; g.lineWidth = 3; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    const helm = ready('helm');
    if (helm) g.drawImage(goldImage(helm, 110, 64), x + 14, y + 24);
    const vbs = ready('vbs');
    if (vbs) g.drawImage(vbs, x + 120, y + 45, 134, 22);
  }, true);
}

// The lane TV atlas: three still score sheets in the Standard theme's colours and the idle
// VBS screen. Each is a TV_PX cell of a 2 x 2 atlas.
const TV_NAMES = ['ANNA', 'ERIK', 'LARS', 'SARA', 'OLLE', 'MAJA', 'NILS', 'EMMA', 'KARL', 'LINA', 'PER', 'IDA'];
function tvAtlasTexture() {
  const [cw, ch] = TV_PX;
  return canvasTexture(cw * 2, ch * 2, (g) => {
    const rand = rng(11);
    const sheet = (ox, oy, players, lane) => {
      const gr = g.createLinearGradient(ox, oy, ox + cw, oy + ch);
      gr.addColorStop(0, '#2a62c0'); gr.addColorStop(0.5, '#1a8fd0'); gr.addColorStop(1, '#203f98');
      g.fillStyle = gr; g.fillRect(ox, oy, cw, ch);
      // no lane number: the same picture hangs over several lanes (a lane's own score goes in by setLaneTvTexture)
      g.fillStyle = '#fff'; g.font = `bold 30px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('VIKING', ox + 14, oy + 14);
      g.font = `bold 18px ${FONT}`; g.textAlign = 'right'; g.fillText('Serie 1', ox + cw - 12, oy + 10);
      const gx = ox + 14, gw = cw - 28, fw = gw / 11.2;
      g.fillStyle = '#3a7ff0'; g.fillRect(gx, oy + 64, gw, 20);
      g.fillStyle = '#fff'; g.font = `bold 16px ${FONT}`; g.textAlign = 'center';
      for (let f = 0; f < 10; f++) g.fillText(String(f + 1), gx + fw * (f + 0.5), oy + 66);
      for (let p = 0; p < players; p++) {
        const y = oy + 88 + p * 46;
        g.fillStyle = '#fff'; g.fillRect(gx, y, gw, 42);
        g.strokeStyle = '#9aa7bd'; g.lineWidth = 1;
        const done = 3 + Math.floor(rand() * 6);
        let tot = 0;
        for (let f = 0; f < 10; f++) {
          g.strokeRect(gx + fw * f, y, fw, 42); g.strokeRect(gx + fw * f + fw / 2, y, fw / 2, 16);
          if (f < done) {
            const r = rand(), mark = r < 0.35 ? 'X' : r < 0.7 ? '/' : String(Math.floor(rand() * 9));
            tot += mark === 'X' ? 22 : mark === '/' ? 15 : 7;
            g.fillStyle = mark === 'X' ? '#c8102e' : '#122';
            g.font = `bold 14px ${FONT}`; g.fillText(mark, gx + fw * f + fw * 0.75, y + 1);
            g.fillStyle = '#122'; g.font = `bold 16px ${FONT}`; g.fillText(String(tot), gx + fw * (f + 0.5), y + 21);
          }
        }
        g.fillStyle = '#122'; g.font = `bold 18px ${FONT}`; g.textAlign = 'left';
        g.fillText(TV_NAMES[Math.floor(rand() * TV_NAMES.length)], gx + fw * 10 + 4, y + 2);
        g.textAlign = 'right'; g.fillText(String(tot), gx + gw - 4, y + 22); g.textAlign = 'center';
        if (p === 0) { g.fillStyle = 'rgba(255,200,40,0.9)'; g.fillRect(gx - 8, y, 5, 42); }
      }
    };
    sheet(0, 0, 4, 7); sheet(cw, 0, 2, 12);
    // the idle screen
    const ox = 0, oy = ch;
    const rg = g.createRadialGradient(ox + cw / 2, oy + ch / 2, 10, ox + cw / 2, oy + ch / 2, cw * 0.65);
    rg.addColorStop(0, '#1d58b8'); rg.addColorStop(1, '#06112a');
    g.fillStyle = rg; g.fillRect(ox, oy, cw, ch);
    const helm = ready('helm');
    if (helm) g.drawImage(goldImage(helm, 180, 105), ox + cw / 2 - 90, oy + 42);
    g.fillStyle = '#fff'; g.font = `bold 54px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('VIKING BOWLING', ox + cw / 2, oy + 186);
    const vbs = ready('vbs');
    if (vbs) g.drawImage(vbs, ox + cw / 2 - 87, oy + 232, 174, 28);
    sheet(cw, ch, 3, 3);
  });
}

// The lane number plates: one 128 x 64 cell per lane of the hall, 16 x 4 cells
function numberAtlas() {
  const t = canvasTexture(2048, 256, (g, Wd, H) => { g.clearRect(0, 0, Wd, H); });
  t.anisotropy = 8;
  return t;
}
function drawNumberCell(tex, cell, number) {
  const g = tex.image.getContext('2d');
  const x = (cell % 16) * 128, y = Math.floor(cell / 16) * 64;
  g.clearRect(x, y, 128, 64);
  tex.needsUpdate = true;
  if (!(number >= 1)) return;                // no plate below lane 1 (the masking unit stays blank, as before)
  g.fillStyle = '#081530';
  g.beginPath(); if (g.roundRect) g.roundRect(x + 4, y + 4, 120, 56, 12); else g.rect(x + 4, y + 4, 120, 56); g.fill();
  g.strokeStyle = '#E2B550'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#FFE3A0'; g.font = `bold 54px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(number), x + 64, y + 36);
}

// A soft round shadow (alpha 1 in the middle, 0 at the rim), for contact shadows
let BLOB = null;
export function blobTexture() {
  if (!BLOB) {
    BLOB = canvasTexture(64, 64, (g, Wd, H) => {
      const r = g.createRadialGradient(Wd / 2, H / 2, 2, Wd / 2, H / 2, Wd / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.clearRect(0, 0, Wd, H); g.fillStyle = r; g.fillRect(0, 0, Wd, H);
    });
    BLOB.colorSpace = THREE.NoColorSpace;
  }
  return BLOB;
}

// A ramp (alpha 1 at the top of the texture, 0 at the bottom) for the glows
function rampTexture() {
  const t = canvasTexture(4, 64, (g, Wd, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.clearRect(0, 0, Wd, H); g.fillStyle = gr; g.fillRect(0, 0, Wd, H);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// The light the valances throw on the lanes, along the lane (v = 0 at the foul line)
function laneLightMap() {
  const n = 256, data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const z = -(i + 0.5) / n * LEN;
    let l = 0.10;
    for (const zv of VALANCES) l += 0.55 * Math.exp(-(((z - (zv - 2.3)) / 1.5) ** 2));
    l += 0.75 * THREE.MathUtils.smoothstep(-z, LANE.headPin - 1.6, LANE.headPin - 0.2);   // the pin deck, brighter under the masking light
    const b = Math.min(255, Math.round(l * 160));
    data.set([b, Math.round(b * 0.94), Math.round(b * 0.84), 255], i * 4);                 // warm lamps
  }
  const t = new THREE.DataTexture(data, 1, n);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---- the planar reflection in the lane oil ----------------------------------------------
// The reflected scene (layer REFLECT_LAYER only: masking units, lights, pins, balls, TVs) is
// rendered from the camera mirrored in the lane plane into a texture at part of the screen's
// resolution, with the near plane clipped to the lane (oblique projection), and added on the
// lane boards with a Fresnel weight: strong at a grazing angle (the pin decks far away),
// faint at your feet.
class LaneMirror {
  constructor(geometry, scale) {
    this.scale = scale;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(REFLECT_LAYER);
    this.target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: true });
    this.target.texture.generateMipmaps = false;
    this.textureMatrix = new THREE.Matrix4();
    this.material = new THREE.ShaderMaterial({
      uniforms: { tMirror: { value: this.target.texture }, textureMatrix: { value: this.textureMatrix }, strength: { value: 0.22 } },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vUv = textureMatrix * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D tMirror; uniform float strength; varying vec4 vUv; varying vec3 vWorld;
        void main() {
          vec3 v = normalize(cameraPosition - vWorld);
          float f = 0.03 + 0.97 * pow(1.0 - clamp(v.y, 0.0, 1.0), 5.0);
          vec3 r = texture2DProj(tMirror, vUv).rgb;
          float d = -vWorld.z;                                                      // metres from the foul line
          float oil = d < 12.19 ? 1.0 : (d < 17.4 ? mix(1.0, 0.5, clamp((d - 12.19) / 2.5, 0.0, 1.0)) : 0.8);   // 40 ft of oil, a dry back end, a finished pin deck
          gl_FragColor = vec4(min(r, vec3(1.4)) * strength * f * oil, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = -1;
    this.clip = new THREE.Vector4();
    this.plane = new THREE.Plane();
    this.tmp = { p: new THREE.Vector3(), dir: new THREE.Vector3(), up: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0), q: new THREE.Vector4() };   // no allocation per frame
  }
  resize(w, h) { this.target.setSize(Math.max(16, Math.round(w * this.scale)), Math.max(16, Math.round(h * this.scale))); }
  render(renderer, scene, camera) {
    if (camera.position.y <= 0.01) return;
    const vc = this.camera;
    camera.updateMatrixWorld();
    const T = this.tmp;
    const p = T.p.setFromMatrixPosition(camera.matrixWorld);
    const dir = T.dir.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const up = T.up.set(0, 1, 0).transformDirection(camera.matrixWorld);
    vc.position.set(p.x, -p.y, p.z);
    vc.up.set(up.x, -up.y, up.z);
    vc.lookAt(p.x + dir.x, -(p.y + dir.y), p.z + dir.z);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // the oblique near plane: nothing below the lane is drawn (http://www.terathon.com/lengyel/Lengyel-Oblique.pdf)
    this.plane.set(T.n.set(0, 1, 0), 0).applyMatrix4(vc.matrixWorldInverse);
    const c = this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = vc.projectionMatrix.elements;
    const q = T.q.set((Math.sign(c.x) + e[8]) / e[0], (Math.sign(c.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    c.multiplyScalar(2 / c.dot(q));
    e[2] = c.x; e[6] = c.y; e[10] = c.z + 1; e[14] = c.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    const prevTarget = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
  }
  dispose() { this.target.dispose(); this.material.dispose(); this.mesh.geometry.dispose(); }
}

// ---- quiet life on the far lanes -----------------------------------------------------------
const FULL = 0x3ff;
const LEAVES = [0x200, 0x040, 0x248, 0x220, 0x010, 0x300, 0x008, 0x002, 0x0c0, 0x208];   // 10, 7, 4-7-10, 6-10, 5, 9-10, 4, 2, 7-8, 4-10 (bit n-1 = pin n)
const ROLL_TIME = 2.5, SWEEP_AT = 2.0, RESET_AT = 3.4, RESET_TIME = 0.7, EVENT_END = 4.4;

// ---- the hall ------------------------------------------------------------------------------
export class Hall {
  // ctx: { renderer, scene, textures: { lane, approach }, laneMat, gameXs: [x, ...], base }
  constructor(ctx) {
    this.ctx = ctx;
    this.root = null;
    this.labels = new Map();                 // lane index -> number on its masking unit
    this.base = ctx.base;
    this.tvTex = new Map();                  // lane index -> { tex, src, owned }
    this.activeTv = 0;
    this.time = 0;
    this.shared = {
      mural: muralTexture(), fascia: fasciaTexture(), neon: neonTexture(), ceiling: ceilingTexture(), wall: wallTexture(),
      tv: tvAtlasTexture(), numbers: numberAtlas(), carpet: carpetTexture(), ramp: rampTexture(), laneLight: laneLightMap(), lowPin: lowPinGeometry()
    };
    ctx.laneMat.lightMap = this.shared.laneLight;
    ctx.laneMat.lightMapIntensity = 1.6;
    // the VBS pictures and the font arrive later: draw what uses them again
    const redraw = () => { for (const k of ['mural', 'wall', 'tv']) this.shared[k].userData.redraw(); if (this.root) this.drawNumbers(); };
    Promise.all([loadImage('helm', 'web/screen/common/img/helm.png'), loadImage('vbs', 'web/screen/common/img/vbs_logo.png'),
      document.fonts ? document.fonts.load(`bold 60px "Barlow Condensed"`).catch(() => null) : null]).then(redraw);
  }

  // Lane index k: the lane at x = k * laneSpacing (0 = the game's first lane)
  get lanes() { return this.laneList || []; }

  build(detail) {
    this.dispose(true);
    const D = this.detailCfg = DETAIL_LEVELS[detail] || DETAIL_LEVELS.high;
    this.detail = detail;
    const { scene } = this.ctx;
    const root = this.root = new THREE.Group();
    root.name = 'hall';
    const gameKs = this.ctx.gameXs.map((x) => Math.round(x / SP));
    const kMin = Math.min(...gameKs) - D.left, kMax = Math.max(...gameKs) + D.right;
    this.kMin = kMin; this.kMax = kMax;
    this.laneList = [];
    for (let k = kMin; k <= kMax; k++) this.laneList.push({ k, x: k * SP, game: gameKs.includes(k), cell: k - kMin, dist: Math.min(...gameKs.map((g) => Math.abs(g - k))) });
    const xA = kMin * SP - SP / 2, xB = kMax * SP + SP / 2;                 // outer edges of the outer capping
    const wallL = xA - WALKWAY, wallR = xB + WALKWAY;
    this.bounds = { xA, xB, wallL, wallR };
    const hallW = wallR - wallL, midX = (wallL + wallR) / 2;
    const reflect = (o) => { o.layers.enable(REFLECT_LAYER); return o; };
    const add = (geo, mat, opts = {}) => {
      const m = new THREE.Mesh(geo, mat);
      if (opts.reflect) reflect(m);
      if (opts.receive) m.receiveShadow = true;
      if (opts.order !== undefined) m.renderOrder = opts.order;
      root.add(m);
      return m;
    };
    const mats = this.mats = {};

    // -- the lanes: surface, approach, gutters, capping, kickbacks, pit and curtain
    const surf = [], appr = [], gut = [], trim = [], mirror = [];
    for (const L of this.laneList) {
      surf.push(xf(new THREE.PlaneGeometry(W, LEN), L.x, 0, -LEN / 2, -Math.PI / 2));
      appr.push(xf(new THREE.PlaneGeometry(SP, 4.6), L.x, -0.001, 2.3, -Math.PI / 2));
      for (const s of [-1, 1]) {
        const g = new THREE.CylinderGeometry(G / 2, G / 2, LEN, 14, 1, true, -Math.PI / 2, Math.PI);
        g.scale(1, 1, 0.45);
        gut.push(xf(g, L.x + s * (W / 2 + G / 2), 0, -LEN / 2, Math.PI / 2));
      }
      if (D.mirror) mirror.push(xf(new THREE.PlaneGeometry(W - 0.01, LANE.pitEdge - 0.03), L.x, 0, -(LANE.pitEdge) / 2, -Math.PI / 2));
    }
    for (let k = kMin - 1; k <= kMax; k++) {
      const x = k * SP + SP / 2;
      trim.push(box(0.16, 0.08, LEN, x, 0.02, -LEN / 2, 0x1a2742));                                    // capping
      trim.push(box(0.16, MASK_Y0, KICK_Z0 - MASK_Z, x, MASK_Y0 / 2, (KICK_Z0 + MASK_Z) / 2, 0x060a14));         // kickback, up to the masking unit
    }
    const shell = [];                                                                                 // unlit, dark
    shell.push(box(xB - xA, 0.04, 1.0, (xA + xB) / 2, -0.36, -LANE.pitEdge - 0.5, 0x010203));         // the pit
    shell.push(tint(xf(new THREE.PlaneGeometry(xB - xA, 1.8), (xA + xB) / 2, 0.45, -LANE.pitEdge - 0.98), 0x020307));   // the pit curtain: black behind the pins
    for (const [x0, x1] of [[wallL, xA], [xB, wallR]]) {                                              // the walkways' end panels
      shell.push(tint(xf(new THREE.PlaneGeometry(x1 - x0, MASK_Y0 - FLOOR), (x0 + x1) / 2, (MASK_Y0 + FLOOR) / 2, MASK_Z), 0x060a14));
    }
    mats.lane = this.ctx.laneMat;
    mats.appr = new THREE.MeshStandardMaterial({ map: this.ctx.textures.approach, roughness: 0.5 });
    mats.gutter = new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
    mats.trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, envMapIntensity: 0.35 });
    add(merge(surf), mats.lane, { receive: true });
    add(merge(appr), mats.appr, { receive: true });
    add(merge(gut), mats.gutter, { receive: true });

    // -- the hall's shell: floor, ceiling, side walls, the end wall above the masking units
    const sh = this.shared;
    const floor = xf(new THREE.PlaneGeometry(hallW, HALL_Z0 - HALL_Z1), midX, FLOOR, (HALL_Z0 + HALL_Z1) / 2, -Math.PI / 2);
    mats.floor = new THREE.MeshLambertMaterial({ color: 0x0c1322 });
    add(floor, mats.floor);
    // the carpet behind the approach, level with it, where a bowler standing far back looks down
    const carpet = xf(new THREE.PlaneGeometry(hallW, HALL_Z0 - APPROACH_END), midX, -0.004, (HALL_Z0 + APPROACH_END) / 2, -Math.PI / 2);
    sh.carpet.repeat.set(hallW / 1.6, (HALL_Z0 - APPROACH_END) / 1.6);
    mats.carpet = new THREE.MeshLambertMaterial({ map: sh.carpet });
    add(carpet, mats.carpet, { receive: true });
    sh.ceiling.repeat.set(hallW / 1.2, (HALL_Z0 - HALL_Z1) / 1.2);
    mats.ceiling = new THREE.MeshBasicMaterial({ map: sh.ceiling });
    add(xf(new THREE.PlaneGeometry(hallW, HALL_Z0 - HALL_Z1), midX, CEIL, (HALL_Z0 + HALL_Z1) / 2, Math.PI / 2), mats.ceiling, { reflect: true });
    sh.wall.repeat.set((HALL_Z0 - HALL_Z1) / 8, 1);
    mats.wall = new THREE.MeshBasicMaterial({ map: sh.wall, color: 0xb8c0d0 });
    const wl = xf(new THREE.PlaneGeometry(HALL_Z0 - HALL_Z1, CEIL - FLOOR), wallL, (CEIL + FLOOR) / 2, (HALL_Z0 + HALL_Z1) / 2, 0, Math.PI / 2);
    const wr = xf(new THREE.PlaneGeometry(HALL_Z0 - HALL_Z1, CEIL - FLOOR), wallR, (CEIL + FLOOR) / 2, (HALL_Z0 + HALL_Z1) / 2, 0, -Math.PI / 2);
    add(merge([wl, wr]), mats.wall, { reflect: true });
    // masking band and fascia, wall to wall; their textures repeat every four lanes, cell 0 over lane 0
    const band = (tex, y0, y1) => {
      const t = tex;
      t.repeat.set(hallW / (4 * SP), 1);
      t.offset.set((wallL + SP / 2) / (4 * SP), 0);
      return xf(new THREE.PlaneGeometry(hallW, y1 - y0), midX, (y0 + y1) / 2, MASK_Z);
    };
    mats.mural = new THREE.MeshBasicMaterial({ map: sh.mural, color: 0xe6e6e6 });
    add(band(sh.mural, MASK_Y0, MASK_Y1), mats.mural, { reflect: true });
    mats.fascia = new THREE.MeshBasicMaterial({ map: sh.fascia });
    add(band(sh.fascia, MASK_Y1, CEIL), mats.fascia, { reflect: true });
    // the lane number plates, on the band's top trim
    const plates = this.laneList.map((L) => {
      const c = L.cell, u0 = (c % 16) / 16, v1 = 1 - Math.floor(c / 16) / 4;
      return xf(quad(0.6, 0.3, u0, v1 - 0.25, u0 + 1 / 16, v1), L.x, MASK_Y1 + 0.03, MASK_Z + 0.02);
    });
    mats.numbers = new THREE.MeshBasicMaterial({ map: sh.numbers, alphaTest: 0.5 });
    add(merge(plates), mats.numbers, { reflect: true });
    this.drawNumbers();
    // the neon sign over the game's lanes
    const gx0 = Math.min(...this.ctx.gameXs), gx1 = Math.max(...this.ctx.gameXs);
    mats.neon = new THREE.MeshBasicMaterial({ map: sh.neon, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0xbfe9ff });
    add(xf(new THREE.PlaneGeometry(4.4, 0.55), (gx0 + gx1) / 2, 2.32, MASK_Z + 0.02), mats.neon, { order: 2 });

    // -- valances with their lamps, the lamp lines and the glows
    const strips = [], glows = [];
    const glow = (geo, color, k) => glows.push(tint(geo, color, k));
    for (const zv of VALANCES) {
      shell.push(box(hallW, 0.63, 0.05, midX, CEIL - 0.315, zv, 0x0b1426));                            // the valance, hiding its lamps from the bowlers
      shell.push(box(hallW, 0.04, 0.052, midX, CEIL - 0.61, zv, 0x1a2a48));                            // its lower edge, catching the spill
      strips.push(box(hallW, 0.014, 0.02, midX, CEIL - 0.632, zv - 0.03, 0xffe2b4, 1.15));              // the lamp lens, seen under the valance
      glow(xf(quad(hallW, 1.9), midX, CEIL - 0.01, zv - 1.0, Math.PI / 2), 0xffe0b0, 0.10);               // lit ceiling on the pin side
    }
    strips.push(box(hallW, 0.018, 0.02, midX, MASK_Y1 + 0.012, MASK_Z + 0.012, 0x4fd8ff, 1.3));        // cyan neon on the masking units
    strips.push(box(xB - xA, 0.018, 0.03, (xA + xB) / 2, MASK_Y0 - 0.01, MASK_Z + 0.01, 0xfff4e0, 1.0));  // the pin deck light's lens
    glow(xf(quad(hallW, 0.32, 0, 1, 1, 0), midX, MASK_Y1 + 0.17, MASK_Z + 0.015), 0x3fc8ff, 0.15);
    glow(xf(new THREE.PlaneGeometry(xB - xA, 0.45), (xA + xB) / 2, MASK_Y0 - 0.225, MASK_Z + 0.03), 0xfff0d8, 0.10);   // soft glow under the masking units
    for (const x of [wallL + 0.01, wallR - 0.01]) {                                                    // neon along the side walls
      const ry = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      glow(xf(quad(HALL_Z0 - HALL_Z1, 0.6), x, 2.0, (HALL_Z0 + HALL_Z1) / 2, 0, ry), 0x3fc8ff, 0.12);
    }

    // -- one overhead TV per lane, built by buildTvs()
    this.tvGroup = new THREE.Group();
    root.add(this.tvGroup);

    // -- every lane pair: the ball return between its two lanes at the back of the approach
    //    (the hood over the lift, the opening, the hand dryer, the rack with three balls), and the
    //    scoring console behind it; on the high level tables, settees, the back wall and a bar.
    //    A bowler standing far back sees the pair's return beside the lane, as in a real centre.
    const bgBalls = [];
    for (let k = kMin; k < kMax; k++) {
      if (((k % 2) + 2) % 2 !== 0) continue;                     // a pair: lane k (even) and k + 1; the game's pair is 0 and 1
      const x = k * SP + SP / 2, hz0 = RETURN_Z, hz1 = RETURN_Z + 1.0, hzc = (hz0 + hz1) / 2;
      trim.push(box(0.46, 0.035, 1.03, x, 0.017, hzc, 0x0b1222));                                     // the foot
      trim.push(box(0.44, 0.32, 1.0, x, 0.19, hzc, 0x1b2944));                                        // the hood's sides
      const dome = new THREE.CylinderGeometry(0.22, 0.22, 1.0, 16, 1, false, -Math.PI / 2, Math.PI);  // its rounded top
      dome.rotateX(-Math.PI / 2); dome.translate(x, 0.35, hzc);
      trim.push(tint(dome, 0x24375e));
      trim.push(box(0.46, 0.03, 1.01, x, 0.35, hzc, 0x5a86c8));                                       // a light-blue stripe
      trim.push(box(0.30, 0.22, 0.02, x, 0.24, hz1 + 0.006, 0x04060b));                               // the opening the balls come out of
      trim.push(box(0.20, 0.09, 0.15, x, 0.61, hz1 - 0.14, 0x2e3f60));                                // the hand dryer on top
      for (const sx of [-1, 1]) trim.push(box(0.025, 0.025, 0.78, x + sx * 0.09, 0.47, hz1 + 0.39, 0x9aa4b4));   // the rack's rails, to the end of the approach
      trim.push(box(0.28, 0.5, 0.06, x, 0.25, hz1 + 0.81, 0x1b2944));                                 // and its stop
      for (let b = 0; b < 3; b++) bgBalls.push({ x, y: 0.4825 + 0.0606, z: hz1 + 0.67 - b * 0.218, hue: (k * 0.137 + b * 0.31 + 0.5) % 1 });
      // the scoring console: a post and a touch screen facing the settee
      trim.push(box(0.07, 0.92, 0.07, x, 0.46, CONSOLE_Z, 0x2a3242));
      const con = new THREE.BoxGeometry(0.44, 0.30, 0.05); con.rotateX(-0.45); con.translate(x, 1.02, CONSOLE_Z);
      trim.push(tint(con, 0x10151f));
      const scr = new THREE.PlaneGeometry(0.38, 0.24); scr.rotateX(-0.45); scr.translate(x, 1.02 + 0.026 * Math.sin(0.45), CONSOLE_Z + 0.026 * Math.cos(0.45));
      strips.push(tint(scr, 0x2f7fd8, 0.9));
      if (D.extras) {
        trim.push(box(0.9, 0.05, 0.55, x, 0.46, SEATS_Z, 0x3a2a1c));                                  // a table
        trim.push(box(0.1, 0.44, 0.1, x, 0.22, SEATS_Z, 0x222833));
        trim.push(box(1.7, 0.42, 0.62, x, 0.21, SEATS_Z + 0.9, 0x1b4f9a));                            // the settee, facing the lanes
        trim.push(box(1.7, 0.55, 0.16, x, 0.55, SEATS_Z + 1.22, 0x163f7c));
      }
    }
    // the foul-line units on the capping
    for (let k = kMin - 1; k <= kMax; k++) {
      const x = k * SP + SP / 2;
      trim.push(box(0.13, 0.05, 0.10, x, 0.085, 0.0, 0x0e1626));
      for (const sx of [-1, 1]) strips.push(box(0.01, 0.014, 0.02, x + sx * 0.066, 0.09, 0.0, 0xff4a3a, 0.7));   // the foul lights' lenses
    }
    if (D.extras) {
      trim.push(tint(xf(new THREE.PlaneGeometry(hallW, CEIL - FLOOR), midX, (CEIL + FLOOR) / 2, HALL_Z0, 0, Math.PI), 0x0b1426));   // back wall
      trim.push(box(hallW * 0.4, 1.05, 0.6, midX, 0.52, HALL_Z0 - 0.5, 0x2a1d14));                                                 // the bar
      strips.push(box(hallW * 0.4, 0.03, 0.02, midX, 1.06, HALL_Z0 - 0.81, 0xffb050, 1.2));
    }
    add(merge(trim), mats.trim, { reflect: true });
    mats.strips = new THREE.MeshBasicMaterial({ vertexColors: true });
    add(merge(strips), mats.strips, { reflect: true });
    mats.shell = new THREE.MeshBasicMaterial({ vertexColors: true });
    add(merge(shell), mats.shell, { reflect: true });
    mats.glow = new THREE.MeshBasicMaterial({ map: sh.ramp, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    add(merge(glows), mats.glow, { reflect: true, order: 1 });

    // -- the neighbours' pins (instanced) and the background balls
    const pinLanes = this.laneList.filter((L) => !L.game);
    mats.pin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0x3a3a3a });
    const pins = this.pins = new THREE.InstancedMesh(sh.lowPin, mats.pin, Math.max(1, pinLanes.length * 10));
    pins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    reflect(pins); root.add(pins);
    const R = rng(4400 + D.right);
    this.racks = new Map();
    pinLanes.forEach((L, i) => {
      const r = R();
      const standing = r < 0.62 ? FULL : LEAVES[Math.floor(R() * LEAVES.length)];
      this.racks.set(L.k, { L, slot: i, standing, event: null });
    });
    // soft contact shadows (blobs) under the neighbours' pins and the two rolling balls: they cast no real shadows
    mats.blob = new THREE.MeshBasicMaterial({ color: 0x000000, map: blobTexture(), transparent: true, opacity: 0.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
    const blobs = this.blobs = new THREE.InstancedMesh(blobGeo, mats.blob, pinLanes.length * 10 + 2);
    blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    blobs.frustumCulled = false;
    root.add(blobs);
    for (let i = 0; i < blobs.count; i++) blobs.setMatrixAt(i, _m.makeScale(0, 0, 0));
    for (const rack of this.racks.values()) this.poseRack(rack, 0);
    // background balls: two that roll, the rest in the ball returns
    mats.ball = new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.1 });
    const balls = this.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(LANE.ballRadius, 18, 12), mats.ball, 2 + bgBalls.length);
    balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    for (let i = 0; i < balls.count; i++) {
      const b = bgBalls[i - 2];
      balls.setColorAt(i, col.setHSL(b ? b.hue : [0.02, 0.75][i], 0.7, 0.38));
      if (b) balls.setMatrixAt(i, _m.makeTranslation(b.x, b.y, b.z));
      else balls.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
    reflect(balls); root.add(balls);
    balls.computeBoundingSphere = function () { this.boundingSphere = new THREE.Sphere(new THREE.Vector3(midX, 0, -8), 60); };
    balls.computeBoundingSphere();
    pins.computeBoundingSphere = function () { this.boundingSphere = new THREE.Sphere(new THREE.Vector3(midX, 0, -18.7), hallW); };
    pins.computeBoundingSphere();
    // the rake that sweeps a neighbour's pin deck (one per lane, hidden until used)
    const rakes = this.rakes = new THREE.InstancedMesh(new THREE.BoxGeometry(W + 0.1, 0.07, 0.05), mats.trim, Math.max(1, pinLanes.length));
    rakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tint(rakes.geometry, 0x1c2638);
    for (let i = 0; i < rakes.count; i++) rakes.setMatrixAt(i, _m.makeScale(0, 0, 0));
    rakes.frustumCulled = false;
    reflect(rakes); root.add(rakes);

    // -- the reflection in the lane oil
    if (D.mirror && mirror.length) {
      this.mirror = new LaneMirror(merge(mirror), D.mirrorScale);
      root.add(this.mirror.mesh);
      const size = this.ctx.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.mirror.resize(size.x, size.y);
    }

    this.buildTvs();
    this.life = { rand: rng(20261118), next: 3.0, rollers: [null, null] };
    scene.add(root);
    return this;
  }

  // ---- lane numbers ---------------------------------------------------------------------
  relabel(base) {
    this.base = base;
    this.labels.clear();
    this.drawNumbers();
  }
  setLabel(k, number) {
    if (this.labels.get(k) === number) return;
    this.labels.set(k, number);
    const L = this.lanes.find((x) => x.k === k);
    if (L) drawNumberCell(this.shared.numbers, L.cell, number);
  }
  numberOf(k) { return this.labels.has(k) ? this.labels.get(k) : this.base + k; }
  drawNumbers() {
    const t = this.shared.numbers;
    t.image.getContext('2d').clearRect(0, 0, t.image.width, t.image.height);
    for (const L of this.lanes) drawNumberCell(t, L.cell, this.numberOf(L.k));
  }

  // ---- the lane TVs -----------------------------------------------------------------------
  setActiveTv(k) {
    if (k === this.activeTv) return;
    this.activeTv = k;
    this.buildTvs();
  }
  setTvTexture(k, src) {
    const old = this.tvTex.get(k);
    if (old && src && old.src === src) { old.tex.needsUpdate = true; return; }       // the same canvas, drawn again
    if (old && old.owned) old.tex.dispose();
    this.tvTex.delete(k);
    if (src) {
      let tex = src, owned = false;
      if (!src.isTexture) { tex = new THREE.CanvasTexture(src); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; owned = true; }
      this.tvTex.set(k, { tex, src, owned });
    }
    this.buildTvs();
  }
  buildTvs() {
    const grp = this.tvGroup;
    if (!grp) return;
    for (const c of [...grp.children]) { grp.remove(c); c.geometry.dispose(); if (c.userData.ownMaterial) c.material.dispose(); }
    const housing = [], screens = [], frames = [], halo = [], own = [];
    const atlasCell = (L) => (L.game ? 2 : [0, 1, 3][((L.k % 3) + 3) % 3]);
    for (const L of this.lanes) {
      const active = L.k === this.activeTv;
      const w = active ? 0.86 : 0.62, h = w * 9 / 16, y = TV_Y + (active ? 0.02 : 0);
      const at = (geo, dz) => geo.translate(0, 0, dz).rotateX(TV_TILT).translate(L.x, y, TV_Z);
      housing.push(tint(at(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.06), -0.035), 0x06090f));
      housing.push(box(0.035, CEIL - (y + h / 2), 0.035, L.x, (CEIL + y + h / 2) / 2, TV_Z - 0.06, 0x151c2a));
      const custom = this.tvTex.get(L.k);
      if (custom) { own.push({ geo: at(new THREE.PlaneGeometry(w, h), 0.002), tex: custom.tex, active }); continue; }
      const c = atlasCell(L), u0 = (c % 2) / 2, v1 = 1 - Math.floor(c / 2) / 2;
      screens.push(tint(at(quad(w, h, u0, v1 - 0.5, u0 + 0.5, v1), 0.002), 0xffffff, active ? 1.0 : 0.62));
      if (active) {
        for (const [fw, fh, fx, fy] of [[w + 0.07, 0.02, 0, h / 2 + 0.035], [w + 0.07, 0.02, 0, -h / 2 - 0.035], [0.02, h + 0.07, w / 2 + 0.035, 0], [0.02, h + 0.07, -w / 2 - 0.035, 0]]) {
          const g = new THREE.PlaneGeometry(fw, fh); g.translate(fx, fy, 0); frames.push(tint(at(g, 0.004), 0xffd27a, 1.7));
        }
        halo.push(tint(at(new THREE.PlaneGeometry(w + 0.5, h + 0.4), -0.07), 0xffc860, 0.5));
      }
    }
    // a lane with its own screen picture still gets the frame when it is the playing lane
    for (const o of own) if (o.active) {
      const L = this.lanes.find((x) => x.k === this.activeTv); const w = 0.86, h = w * 9 / 16, y = TV_Y + 0.02;
      const at = (geo, dz) => geo.translate(0, 0, dz).rotateX(TV_TILT).translate(L.x, y, TV_Z);
      for (const [fw, fh, fx, fy] of [[w + 0.07, 0.02, 0, h / 2 + 0.035], [w + 0.07, 0.02, 0, -h / 2 - 0.035], [0.02, h + 0.07, w / 2 + 0.035, 0], [0.02, h + 0.07, -w / 2 - 0.035, 0]]) {
        const g = new THREE.PlaneGeometry(fw, fh); g.translate(fx, fy, 0); frames.push(tint(at(g, 0.004), 0xffd27a, 1.7));
      }
      halo.push(tint(at(new THREE.PlaneGeometry(w + 0.5, h + 0.4), -0.07), 0xffc860, 0.5));
    }
    const put = (geo, mat, ownMat) => { const m = new THREE.Mesh(geo, mat); m.layers.enable(REFLECT_LAYER); m.userData.ownMaterial = !!ownMat; grp.add(m); return m; };
    put(merge(housing), this.mats.shell);
    if (screens.length) {
      this.mats.tv = this.mats.tv || new THREE.MeshBasicMaterial({ map: this.shared.tv, vertexColors: true });
      put(merge(screens), this.mats.tv);
    }
    if (frames.length) put(merge(frames), this.mats.strips);
    if (halo.length) {
      this.mats.halo = this.mats.halo || new THREE.MeshBasicMaterial({ map: this.haloTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      put(merge(halo), this.mats.halo).renderOrder = 1;
    }
    for (const o of own) put(o.geo, new THREE.MeshBasicMaterial({ map: o.tex, color: o.active ? 0xffffff : 0x9e9e9e }), true);
  }
  haloTexture() {
    if (!this.shared.halo) {
      this.shared.halo = canvasTexture(64, 64, (g, Wd, H) => {
        const r = g.createRadialGradient(Wd / 2, H / 2, 4, Wd / 2, H / 2, Wd / 2);
        r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
        g.clearRect(0, 0, Wd, H); g.fillStyle = r; g.fillRect(0, 0, Wd, H);
      });
      this.shared.halo.colorSpace = THREE.NoColorSpace;
    }
    return this.shared.halo;
  }

  // ---- the neighbours' pins and the quiet life ---------------------------------------------
  // Pose one neighbour's pins: standing pins up, a running event's falling pins tumbling,
  // the swept ones gone, a new rack coming down.
  poseRack(rack, now) {
    const { L, slot } = rack;
    const ev = rack.event;
    for (let i = 0; i < 10; i++) {
      const [px, pz] = PIN_SPOTS[i];
      let show = (rack.standing >> i) & 1, y = 0, tilt = 0, yaw = 0, dx = 0, dz = 0;
      if (ev && show) {
        const t = now - ev.t0, rs = t - ev.hit - SWEEP_AT;     // rs: time since the rake started
        const knocked = (ev.knock >> i) & 1;
        const swept = knocked || ev.reset;                   // the rake takes the fallen pins; after a last ball, all
        if (knocked && t >= ev.hit + ev.delay[i]) {          // falling: tips over away from the ball, some fly to the pit
          const p = Math.min(1, (t - ev.hit - ev.delay[i]) / 0.38);
          tilt = (Math.PI / 2) * p * p; yaw = ev.dir[i];
          const d = (0.16 + ev.fly[i]) * p;
          dx = Math.sin(yaw) * d; dz = -Math.cos(yaw) * d; y = 0.055 * p;
          if (pz + dz < -LANE.pitEdge) show = 0;
        }
        if (swept && rs >= 0.4 && ev.sweepZ(t) < pz + dz + 0.05) show = 0;
        if (!swept && rs >= 0 && rs < 1.3) y = 0.42 * Math.min(1, rs / 0.3, (1.3 - rs) / 0.3);   // the table lifts a leave over the rake
        if (ev.reset && t >= ev.hit + RESET_AT) {            // a new rack comes down
          show = 1; tilt = 0; yaw = 0; dx = dz = 0;
          y = 0.5 * (1 - Math.min(1, (t - ev.hit - RESET_AT) / RESET_TIME));
        }
      } else if (ev && ev.reset && now - ev.t0 >= ev.hit + RESET_AT) {
        show = 1;
        y = 0.5 * (1 - Math.min(1, (now - ev.t0 - ev.hit - RESET_AT) / RESET_TIME));
      }
      if (!show) { this.pins.setMatrixAt(slot * 10 + i, _m.makeScale(0, 0, 0)); this.blobs.setMatrixAt(slot * 10 + i, _m); continue; }
      _q.setFromEuler(_e.set(-tilt, -yaw, 0, 'YXZ'));        // the top falls towards (sin yaw, -cos yaw)
      _m.compose(_v.set(L.x + px + dx, y, pz + dz), _q, _s.set(1, 1, 1));
      this.pins.setMatrixAt(slot * 10 + i, _m);
      const b = tilt < 0.3 ? Math.max(0, 0.17 * (1 - y * 2.5)) : 0;   // the blob: under a standing pin, fading as it is lifted
      this.blobs.setMatrixAt(slot * 10 + i, _m.compose(_v.set(L.x + px + dx, 0.0015, pz + dz), _q.identity(), _s.set(b || 1e-5, 1, b || 1e-5)));
    }
    this.pins.instanceMatrix.needsUpdate = true;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  // A ball on a far lane every few seconds: the lanes two or more away from the game's lanes
  // and close enough to be seen; two at a time at most.
  update(dt) {
    if (!this.root || !this.racks) return;
    this.time += dt;
    const now = this.time, life = this.life;
    if (now >= life.next) {
      life.next = now + 3.5 + life.rand() * 6;
      const free = life.rollers.indexOf(null);
      const cands = [...this.racks.values()].filter((r) => !r.event && r.L.dist >= 2 && r.L.dist <= 7);
      if (free >= 0 && cands.length) this.startEvent(cands[Math.floor(life.rand() * cands.length)], free, now);
    }
    let any = false;
    for (const rack of this.racks.values()) {
      const ev = rack.event;
      if (!ev) continue;
      any = true;
      const t = now - ev.t0;
      // the ball: down the lane with a little hook, then into the pit
      const ri = ev.roller;
      if (t < ev.hit + 0.3) {
        const p = Math.min(1, t / ev.hit);
        const z = 0.3 - (LANE.headPin + 0.3) * p - Math.max(0, t - ev.hit) * 4;
        const x = rack.L.x + ev.x0 + ev.hook * p * p * p;
        _q.setFromAxisAngle(_v.set(1, 0, 0), -(0.3 - z) / LANE.ballRadius);
        _m.compose(_v.set(x, LANE.ballRadius, z), _q, _s.set(1, 1, 1));
        this.balls.setMatrixAt(ri, _m);
        this.blobs.setMatrixAt(this.blobs.count - 2 + ri, _m.compose(_v.set(x, 0.0015, z), _q.identity(), _s.set(0.26, 1, 0.26)));
      } else { this.balls.setMatrixAt(ri, _m.makeScale(0, 0, 0)); this.blobs.setMatrixAt(this.blobs.count - 2 + ri, _m); }
      // the rake
      const rs = t - ev.hit - SWEEP_AT;
      if (rs >= 0 && rs < 1.3) {
        const down = Math.min(1, rs / 0.35), back = THREE.MathUtils.clamp((rs - 0.4) / 0.5, 0, 1), up = THREE.MathUtils.clamp((rs - 0.95) / 0.3, 0, 1);
        const y = 0.9 - 0.84 * down + 0.84 * up;
        this.rakes.setMatrixAt(rack.slot, _m.makeTranslation(rack.L.x, y, ev.sweepZ(t)));
      } else this.rakes.setMatrixAt(rack.slot, _m.makeScale(0, 0, 0));
      this.poseRack(rack, now);
      if (t >= ev.hit + (ev.reset ? EVENT_END : SWEEP_AT + 1.4)) {
        rack.standing = ev.reset ? FULL : rack.standing & ~ev.knock;
        rack.event = null;
        life.rollers[ri] = null;
        this.poseRack(rack, now);
      }
    }
    if (any) { this.balls.instanceMatrix.needsUpdate = true; this.rakes.instanceMatrix.needsUpdate = true; this.blobs.instanceMatrix.needsUpdate = true; }
  }
  startEvent(rack, roller, now) {
    const R = this.life.rand;
    const first = rack.standing === FULL;
    let knock;
    if (first) knock = R() < 0.45 ? FULL : FULL & ~LEAVES[Math.floor(R() * LEAVES.length)];
    else knock = R() < 0.6 ? rack.standing : rack.standing & ~(1 << [...Array(10).keys()].filter((i) => (rack.standing >> i) & 1)[0]);
    const left = rack.standing & ~knock;
    const ev = {
      t0: now, roller, knock, hit: ROLL_TIME * (0.9 + R() * 0.2), x0: (R() - 0.3) * 0.3, hook: -0.05 - R() * 0.12,
      reset: left === 0 || !first, delay: [], dir: [], fly: []
    };
    for (let i = 0; i < 10; i++) {
      const [px, pz] = PIN_SPOTS[i];
      ev.delay.push(Math.hypot(px, pz + LANE.headPin) / 3.2 + R() * 0.08);
      ev.dir.push(Math.atan2(px + (R() - 0.5) * 0.2, 0.25) + (R() - 0.5) * 0.9);
      ev.fly.push(R() < 0.35 ? 0.6 : 0);
    }
    ev.sweepZ = (t) => -LANE.headPin + 0.35 - 1.5 * THREE.MathUtils.clamp((t - ev.hit - SWEEP_AT - 0.4) / 0.5, 0, 1);
    rack.event = ev;
    this.life.rollers[roller] = rack;
  }

  // ---- the reflection, the environment map ---------------------------------------------------
  resize(w, h) { if (this.mirror) this.mirror.resize(w, h); }
  renderMirror(renderer, scene, camera) { if (this.mirror) this.mirror.render(renderer, scene, camera); }

  // The hall seen from over the game's lanes, once, as the environment the lane finish and the
  // balls reflect. hide: objects left out (the game's pins and balls).
  bakeEnvironment(hide = []) {
    const { renderer, scene } = this.ctx;
    const size = this.detailCfg.envSize;
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.1, 80, rt);
    const gx = this.ctx.gameXs;
    cam.position.set((Math.min(...gx) + Math.max(...gx)) / 2, 1.0, -6);
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    if (this.mirror) this.mirror.mesh.visible = false;
    const shadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    cam.update(renderer, scene);
    renderer.shadowMap.autoUpdate = shadow;
    hide.forEach((o, i) => { o.visible = was[i]; });
    if (this.mirror) this.mirror.mesh.visible = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromCubemap(rt.texture);
    pmrem.dispose(); rt.dispose();
    if (this.envTarget) this.envTarget.dispose();        // a render target's texture is freed with the target, not by itself
    this.envTarget = envTarget;
    this.env = envTarget.texture;
    return this.env;
  }

  // Everything the hall made; keepShared keeps the textures it can use again
  dispose(keepShared = false) {
    if (this.root) {
      this.ctx.scene.remove(this.root);
      this.root.traverse((o) => { if (o.geometry && o.geometry !== this.shared.lowPin) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
      for (const [k, m] of Object.entries(this.mats || {})) if (k !== 'lane') m.dispose();
      this.mats = {};
      if (this.mirror) { this.mirror.dispose(); this.mirror = null; }
      this.root = null; this.racks = null; this.tvGroup = null;
    }
    if (!keepShared) {
      for (const t of Object.values(this.shared)) if (t && t.dispose) t.dispose();
      for (const v of this.tvTex.values()) if (v.owned) v.tex.dispose();
      this.tvTex.clear();
      if (this.envTarget) { this.envTarget.dispose(); this.envTarget = null; this.env = null; }
    }
  }
}

export const LANE_TV_SIZE = TV_PX;

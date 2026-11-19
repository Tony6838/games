// ---------------------------------------------------------------------------
// scene.js - what the player sees: the game's lanes with their pins and balls, drawn with
// three.js from the physics in physics.js, inside the bowling hall of hall.js. Original
// artwork: everything is made here from geometry and canvas textures.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LANE, PIN_PROFILE, PIN_SPOTS } from './physics.js';
import { Hall, autoDetail, REFLECT_LAYER, LANE_TV_SIZE, blobTexture } from './hall.js';

const _bm = new THREE.Matrix4(), _bv = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3();
const LOW_END = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4 || /[?&]gfx=low/.test(location.search);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Seeded random numbers: the wood looks the same every time
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// One board of wood grain: fine streaks for maple, longer and wavier ones for pine
function grain(g, R, x, w, y0, y1, pine) {
  const n = Math.round((y1 - y0) / (pine ? 28 : 40));
  for (let k = 0; k < n; k++) {
    const len = pine ? 80 + R() * 320 : 30 + R() * 150, y = y0 + R() * (y1 - y0 - len);
    g.fillStyle = pine ? `rgba(110,58,20,${0.05 + R() * 0.08})` : `rgba(120,72,32,${0.03 + R() * 0.05})`;
    const gx = x + R() * w;
    if (pine && R() < 0.35) { g.beginPath(); g.ellipse(gx, y + len / 2, 1.2 + R() * 2.5, len / 2, 0, 0, Math.PI * 2); g.fill(); }   // a cathedral
    else g.fillRect(gx, y, 1, len);
  }
}

// The lane, to the USBC layout: 39 boards (41.5 in); maple heads up to the dovetail joints at
// 16 ft, pine down the middle (on a synthetic lane the same pattern, printed), maple again on
// the pin deck; the foul line, the guide dots at 7 ft (boards 3, 5, 8, 11, 14), the seven
// arrows between 13 and 15 ft as a V pointing at the pins, the range finders at 34 ft and the
// pin spots.
function laneTexture() {
  const W = 512, H = 4096;               // across x along
  return canvasTexture(W, H, (g) => {
    const R = seeded(39);
    const bw = W / 39;
    const zToY = (m) => H - (m / (LANE.pitEdge + 0.1)) * H;   // metres from the foul line -> texture row
    for (let i = 0; i < 39; i++) {
      const x = i * bw, off = i % 2 ? 0.13 : -0.13;           // alternate boards end further: the dovetail zig-zag
      const j1 = zToY(4.88 + off), j2 = zToY(LANE.headPin - 1.0 + off);
      const t = 216 + ((i * 37) % 15) - 7, tp = 206 + ((i * 53) % 13) - 6;
      g.fillStyle = `rgb(${t}, ${t - 37}, ${t - 90})`; g.fillRect(x, j1, bw + 1, H - j1);          // maple heads
      g.fillStyle = `rgb(${tp}, ${tp - 45}, ${tp - 102})`; g.fillRect(x, j2, bw + 1, j1 - j2);     // pine
      g.fillStyle = `rgb(${t + 6}, ${t - 28}, ${t - 80})`; g.fillRect(x, 0, bw + 1, j2);           // maple pin deck
      grain(g, R, x, bw, j1, H, false); grain(g, R, x, bw, j2, j1, true); grain(g, R, x, bw, 0, j2, false);
      g.fillStyle = 'rgba(85,45,15,0.28)'; g.fillRect(x, 0, 1, H);                               // the seams
      g.fillStyle = 'rgba(70,35,10,0.45)'; g.fillRect(x, j1 - 1, bw, 2); g.fillRect(x, j2 - 1, bw, 2);   // the joints
    }
    // the foul line
    g.fillStyle = '#1b1b1b';
    g.fillRect(0, zToY(0) - 10, W, 10);
    // guide dots at 7 ft (2.13 m)
    g.fillStyle = '#1d2b4a';
    for (const b of [3, 5, 8, 11, 14]) for (const sd of [-1, 1]) {
      const x = W / 2 + sd * (19.5 - b) * bw;
      g.beginPath(); g.arc(x, zToY(2.13), 4, 0, Math.PI * 2); g.fill();
    }
    // the arrows on boards 5, 10 ... 35: the outer ones 13 ft from the foul line, the middle one 15 ft
    for (let a = 0; a < 7; a++) {
      const x = (5 + a * 5 - 0.5) * bw;
      const y = zToY(4.57 - Math.abs(a - 3) * 0.2);
      g.fillStyle = '#16264a';
      g.beginPath(); g.moveTo(x, y - 40); g.lineTo(x - 7, y + 10); g.lineTo(x + 7, y + 10); g.closePath(); g.fill();
    }
    // the range finders at 34 ft (10.36 m), boards 10 and 30
    for (const b of [10, 30]) g.fillRect((b - 0.5) * bw - 3, zToY(10.36) - 20, 6, 20);
    // pin spots
    g.fillStyle = 'rgba(40,30,20,0.5)';
    for (const [px, pz] of PIN_SPOTS) { g.beginPath(); g.arc(W / 2 + px / LANE.width * W, zToY(-pz), 5, 0, Math.PI * 2); g.fill(); }
  });
}

// The approach (one lane's share of it, the full lane-plus-gutters-plus-capping width, 4.6 m):
// maple boards in line with the lane's, and the approach dots 2-6 in, 12 ft and 15 ft behind
// the foul line on boards 3, 5, 8, 11, 14 from each side and the middle board 20. The canvas has
// the plane's proportions, so the dots are round.
function approachTexture() {
  const Wm = LANE.laneSpacing, Hm = 4.6, W = 256, H = Math.round(W * Hm / Wm);
  return canvasTexture(W, H, (g) => {
    const R = seeded(15);
    const pxm = W / Wm, bwm = LANE.width / 39, x0 = (Wm - LANE.width) / 2;   // the lane's left edge, metres from the canvas edge
    const first = -Math.ceil(x0 / bwm);
    for (let i = first; i * bwm + x0 < Wm; i++) {
      const x = (x0 + i * bwm) * pxm, w = bwm * pxm;
      const t = 220 + ((((i * 29) % 13) + 13) % 13) - 6;
      g.fillStyle = `rgb(${t}, ${t - 38}, ${t - 92})`; g.fillRect(x, 0, w + 1, H);
      grain(g, R, x, w, 0, H, false);
      g.fillStyle = 'rgba(85,45,15,0.22)'; g.fillRect(x, 0, 1, H);
    }
    g.fillStyle = '#1d2b4a';
    for (const zm of [0.1, 3.66, 4.57]) for (const b of [3, 5, 8, 11, 14, 20, 26, 29, 32, 35, 37]) {
      g.beginPath(); g.arc((x0 + (b - 0.5) * bwm) * pxm, zm * pxm, 2.2, 0, Math.PI * 2); g.fill();
    }
  });
}

// The oil on the lane, along it (v = 0 at the foul line): R is the finish's gloss (the clear
// coat), G its roughness - glossy over the 40 ft of oil, drier and duller on the back end, the
// pin deck in between
function laneOilMap() {
  const n = 256, data = new Uint8Array(n * 4), len = LANE.pitEdge + 0.1;
  for (let i = 0; i < n; i++) {
    const d = (i + 0.5) / n * len;
    const dry = THREE.MathUtils.smoothstep(d, LANE.oilLength, LANE.oilLength + 2.5);
    let gloss = 1 - 0.45 * dry, rough = 0.4 + 0.6 * dry;
    if (d > LANE.headPin - 1.0) { gloss = 0.8; rough = 0.6; }
    data.set([Math.round(gloss * 255), Math.round(rough * 255), 0, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, 1, n);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function ballTexture(hue = 0.6) {
  return canvasTexture(512, 256, (g, W, H) => {
    const base = new THREE.Color().setHSL(hue, 0.65, 0.32);
    g.fillStyle = '#' + base.getHexString();
    g.fillRect(0, 0, W, H);
    // marbled swirls
    for (let k = 0; k < 220; k++) {
      const c = new THREE.Color().setHSL(hue + (Math.random() - 0.5) * 0.12, 0.7, 0.2 + Math.random() * 0.45);
      g.strokeStyle = `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},0.35)`;
      g.lineWidth = 2 + Math.random() * 8;
      g.beginPath();
      let x = Math.random() * W, y = Math.random() * H;
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 120; y += (Math.random() - 0.5) * 60; g.quadraticCurveTo(x + 30, y - 20, x, y); }
      g.stroke();
    }
    // gold band and three finger holes
    g.fillStyle = 'rgba(226,181,80,0.8)';
    g.fillRect(0, H * 0.48, W, 3);
    g.fillStyle = '#0a0a0a';
    for (const [x, y, r] of [[W * 0.25, H * 0.32, 10], [W * 0.28, H * 0.32, 10], [W * 0.265, H * 0.42, 12]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  });
}

// The pin: a lathe of the real outline, white with the two red neck stripes
function pinGeometry() {
  const pts = [];
  const add = (y, r) => pts.push(new THREE.Vector2(Math.max(r, 0.0005), y));
  for (const [y, r] of PIN_PROFILE) add(y, r);
  const geo = new THREE.LatheGeometry(pts.sort((a, b) => a.y - b.y), 28);
  const colors = [];
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const red = (y > 0.226 && y < 0.239) || (y > 0.246 && y < 0.259);
    colors.push(red ? 0.75 : 1, red ? 0.05 : 1, red ? 0.07 : 1);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export class BowlingScene {
  // opts.detail: the hall's detail level, 'auto' (default), 'high' or 'low' (hall.js)
  constructor(container, opts = {}) {
    this.container = container;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: !LOW_END, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW_END ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !/[?&]gfx=low/.test(location.search);
    renderer.shadowMap.type = LOW_END ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false;          // reset once a frame in render(): the counts cover the reflection pass too
    container.appendChild(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070c16);
    scene.fog = new THREE.Fog(0x0a1222, 22, 72);
    this.detailSetting = ['auto', 'high', 'low'].includes(opts.detail) ? opts.detail : 'auto';
    this.autoLevel = autoDetail(renderer);
    this.detail = this.resolveDetail();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
    this.camPos = new THREE.Vector3(0, 1.5, 2.8);
    this.camLook = new THREE.Vector3(0, 0.1, -18);
    this.camTargetPos = this.camPos.clone();
    this.camTargetLook = this.camLook.clone();

    scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x2a1a10, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 8, 2);
    scene.add(key);

    this.textures = { lane: laneTexture(), approach: approachTexture() };
    this.pinGeo = pinGeometry();
    this.pinMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.9 });
    this.redPinMat = new THREE.MeshPhysicalMaterial({ color: 0xd81e22, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
    this.lanes = new Map();
    this.effects = [];
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // Builds the hall (hall.js: the lanes, the neighbouring lanes, masking units, TVs, ceiling,
  // walls) and the game's own pins and balls
  buildHall(gameLanes, laneNumbers) {
    const xs = gameLanes.map((g) => g.laneX);
    const oil = laneOilMap();
    this.laneMat = new THREE.MeshPhysicalMaterial({ map: this.textures.lane, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.3,
      clearcoatMap: oil, clearcoatRoughnessMap: oil, envMapIntensity: 0.7 });
    this.hall = new Hall({ renderer: this.renderer, scene: this.scene, textures: this.textures, laneMat: this.laneMat, gameXs: xs, base: laneNumbers.base });
    this.hall.build(this.detail);
    // light over the pin decks and along the lanes
    const deckLight = new THREE.SpotLight(0xfff4e0, 60, 9, Math.PI / 5, 0.5, 1.2);
    deckLight.position.set((xs[0] + xs[xs.length - 1]) / 2, 2.6, -LANE.headPin + 2.0);
    deckLight.target.position.set(deckLight.position.x, 0, -LANE.headPin - 0.4);
    deckLight.shadow.mapSize.set(LOW_END ? 512 : 1024, LOW_END ? 512 : 1024);
    this.scene.add(deckLight, deckLight.target);
    this.deckLight = deckLight;
    for (let z = -2; z > -17; z -= 5) {
      const l = new THREE.PointLight(0xffecd2, 6, 9, 1.5);       // the warm lamps behind the valances
      l.position.set((xs[0] + xs[xs.length - 1]) / 2, 2.4, z);
      this.scene.add(l);
      (this.lampLights || (this.lampLights = [])).push(l);
    }
    // game lanes: pins and ball
    for (const gl of gameLanes) {
      const pins = [];
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(this.pinGeo, this.pinMat);
        m.castShadow = true;
        this.scene.add(m);
        pins.push(m);
      }
      const ball = new THREE.Mesh(new THREE.SphereGeometry(LANE.ballRadius, 40, 24),
        new THREE.MeshPhysicalMaterial({ map: ballTexture(gl.hue ?? 0.6), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 }));
      ball.castShadow = true;
      ball.layers.enable(REFLECT_LAYER);
      pins.forEach((m) => m.layers.enable(REFLECT_LAYER));
      this.scene.add(ball);
      this.lanes.set(gl.slot, { ...gl, pins, ball });
    }
    // soft contact shadows: always under the balls (no lamp casts the ball's shadow along the lane),
    // and under the pins when the pin deck light casts no real shadows (the low level)
    this.blobs = new THREE.InstancedMesh((() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })(),
      new THREE.MeshBasicMaterial({ color: 0x000000, map: blobTexture(), transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      gameLanes.length * 11);
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobs.frustumCulled = false;
    for (let i = 0; i < this.blobs.count; i++) this.blobs.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    this.scene.add(this.blobs);
    this.applyShadows();
    this.scene.traverse((o) => { if (o.isLight) o.layers.enable(REFLECT_LAYER); });     // the reflection is lit as the hall is
    this.bakeEnvironment();
  }

  // The pin deck light casts real (soft) shadows on the high level; on the low level the pins
  // get blob shadows instead, and the shadow pass is not drawn at all
  applyShadows() {
    if (!this.deckLight) return;
    this.deckLight.castShadow = this.detail === 'high' && this.renderer.shadowMap.enabled;
    this.pinBlobs = !this.deckLight.castShadow;
  }

  // The lane finish and the balls reflect the hall itself: an environment map rendered once
  // from over the game's lanes (the game's own pins and balls left out)
  bakeEnvironment() {
    const hide = [];
    for (const l of this.lanes.values()) hide.push(l.ball, ...l.pins);
    if (this.aimLine) hide.push(this.aimLine);
    for (const e of this.effects) hide.push(e.pts);
    const env = this.hall.bakeEnvironment(hide);
    this.laneMat.envMap = env;
    this.laneMat.needsUpdate = true;
    for (const l of this.lanes.values()) { l.ball.material.envMap = env; l.ball.material.needsUpdate = true; }
    if (this.hall.mats.ball) this.hall.mats.ball.envMap = env;
  }

  // ---- detail level ------------------------------------------------------------
  // setting: 'auto', 'high' or 'low'; ?detail=high|low in the URL overrides it (tests)
  resolveDetail() {
    const m = /[?&]detail=(high|low)/.exec(location.search);
    if (m) return m[1];
    return this.detailSetting === 'auto' ? this.autoLevel : this.detailSetting;
  }
  setDetail(setting) {
    this.detailSetting = ['auto', 'high', 'low'].includes(setting) ? setting : 'auto';
    this.applyDetail(this.resolveDetail());
  }
  applyDetail(level) {
    if (level === this.detail) return;
    this.detail = level;
    if (!this.hall) return;
    this.hall.build(level);
    this.applyShadows();
    for (const [slot, l] of this.lanes) if (l.lastPhysics) this.sync(slot, l.lastPhysics, l.lastRedPin);
    this.scene.traverse((o) => { if (o.isLight) o.layers.enable(REFLECT_LAYER); });
    this.bakeEnvironment();
    if (this.onDetailChange) this.onDetailChange(level);
  }
  // On "auto", a device that draws the high level at under ~26 frames a second (the median of
  // 90 frames, after the first 40) is moved to the low level, once
  watchFrameRate() {
    if (this.detailSetting !== 'auto' || this.detail !== 'high' || this.perfDone || /[?&]detail=/.test(location.search)) return;
    const now = performance.now();
    const p = this.perf || (this.perf = { last: 0, n: 0, gaps: [] });
    const gap = now - p.last;
    p.last = now;
    if (gap > 500 || document.hidden) { p.n = 0; p.gaps.length = 0; return; }
    if (++p.n <= 40) return;
    p.gaps.push(gap);
    if (p.gaps.length < 90) return;
    const med = p.gaps.slice().sort((a, b) => a - b)[p.gaps.length >> 1];
    this.perfDone = true;
    this.frameMs = med;
    if (med > 1000 / 26) {
      console.info('Viking Bowling: ' + (1000 / med).toFixed(0) + ' frames a second on the high detail level - the hall drops to the low level');
      this.autoLevel = 'low';
      this.applyDetail('low');
    }
  }

  // ---- the lane TVs over the approach -------------------------------------------
  // One TV per lane of the hall. lane: the lane's index in the hall - 0 is the game's first
  // lane (slot 0), 1 the lane to its right (slot 1), -1 the lane to its left, and so on
  // (hallLanes() lists them with the numbers on their masking units).
  // source: a canvas (drawn again by the caller: call setLaneTvTexture with the same canvas to
  // upload it again), a THREE.Texture, or null for the hall's own still picture. LANE_TV_SIZE
  // (512 x 288, 16:9) is the size the screens are made for.
  setLaneTvTexture(lane, source) { if (this.hall) this.hall.setTvTexture(lane, source); }
  // The playing lane's TV is larger and framed in gold
  setActiveLane(lane) { if (this.hall) this.hall.setActiveTv(lane); }
  hallLanes() { return this.hall ? this.hall.lanes.map((L) => ({ index: L.k, number: this.hall.numberOf(L.k), x: L.x, game: L.game })) : []; }
  laneIndexOf(number) { const L = this.hall && this.hall.lanes.find((x) => this.hall.numberOf(x.k) === number); return L ? L.k : null; }
  get laneTvSize() { return LANE_TV_SIZE; }

  setBallLook(laneNumber, hue) {
    const l = this.lanes.get(laneNumber);
    if (!l) return;
    if (l.ball.material.map) l.ball.material.map.dispose();
    l.ball.material.map = ballTexture(hue);
    l.ball.material.needsUpdate = true;
  }

  // Copy the physics state of a lane onto its meshes
  sync(laneNumber, physics, redPin = false) {
    const l = this.lanes.get(laneNumber);
    if (!l) return;
    physics.pins.forEach((p, i) => {
      const m = l.pins[i];
      m.visible = p.active && p.body.position.y > -0.6;
      // the body's origin is the centre of mass; the mesh's is the base
      const b = p.body;
      const off = new THREE.Vector3(0, -0.150, 0).applyQuaternion(new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
      m.position.set(b.position.x + off.x, b.position.y + off.y, b.position.z + off.z);
      m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      m.material = (redPin && i === 0) ? this.redPinMat : this.pinMat;
      // its blob, on the low level, while it stands
      const up = 1 - 2 * (b.quaternion.x * b.quaternion.x + b.quaternion.z * b.quaternion.z);
      const sb = this.pinBlobs && m.visible && up > 0.85 && m.position.y > -0.05 && m.position.y < 0.08 ? 0.17 : 0;
      this.blobs.setMatrixAt(laneNumber * 11 + i, _bm.compose(_bv.set(m.position.x, 0.0015, m.position.z), _bq, _bs.set(sb || 1e-5, 1, sb || 1e-5)));
    });
    const bb = physics.ball;
    l.ball.position.set(bb.position.x, bb.position.y, bb.position.z);
    l.ball.quaternion.set(bb.quaternion.x, bb.quaternion.y, bb.quaternion.z, bb.quaternion.w);
    // the ball's blob, on the lane, the approach or in the gutter: under its lowest point, fading as it leaves the surface
    const lift = bb.position.y - LANE.ballRadius, ground = Math.max(lift, -0.06);
    const sb = bb.position.y > -0.25 ? 0.27 * Math.max(0, 1 - Math.max(0, lift) * 6) : 0;
    this.blobs.setMatrixAt(laneNumber * 11 + 10, _bm.compose(_bv.set(bb.position.x, ground + 0.002, bb.position.z), _bq, _bs.set(sb || 1e-5, 1, sb || 1e-5)));
    this.blobs.instanceMatrix.needsUpdate = true;
    l.lastPhysics = physics; l.lastRedPin = redPin;
  }

  // Camera presets
  // The aiming view: at a bowler's eye height (1.6 m; 1.65 in portrait), 3.2 m (3.6 m) behind
  // the ball so the ball shows in the lower part of the picture, looking down the lane past the
  // arrows, with the field of view the game always had (resize()). stanceZ: where the ball
  // waits before the throw, metres behind the foul line (the ball's z; left out, 0.35, the
  // foul-line stance). The view moves back with the stance; the hall keeps its tables and
  // settees behind z 8, so no stance up to the end of the approach (4.6) sees them.
  aimView(laneX, portrait, stanceZ) {
    const s = Number.isFinite(stanceZ) ? stanceZ : 0.35;
    this.camTargetPos.set(laneX, portrait ? 1.65 : 1.6, s + (portrait ? 3.6 : 3.2));
    this.camTargetLook.set(laneX, 0.0, s - 6.35);
  }
  followView(laneX, ballZ, ballX) {
    const z = Math.max(ballZ + 3.2, -14.2);
    this.camTargetPos.set(laneX + (ballX - laneX) * 0.3, 1.05 - Math.min(0.25, -ballZ / 60), z);
    this.camTargetLook.set(laneX + (ballX - laneX) * 0.5, 0.05, Math.min(ballZ - 5, -18.5));
  }
  pinView(laneX, portrait) {
    this.camTargetPos.set(laneX, portrait ? 1.35 : 0.95, -LANE.headPin + (portrait ? 3.6 : 2.6));
    this.camTargetLook.set(laneX, 0.1, -LANE.headPin - 0.5);
  }

  // A burst of sparks at the pins
  burst(laneX, color = 0xE2B550, count = 90) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), vel = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = laneX + (Math.random() - 0.5) * 0.6; pos[i * 3 + 1] = 0.3 + Math.random() * 0.3; pos[i * 3 + 2] = -LANE.headPin - 0.4;
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 3, (Math.random() - 0.2) * 2));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.05, transparent: true, opacity: 1, depthWrite: false }));
    this.scene.add(pts);
    this.effects.push({ pts, vel, life: 1.6 });
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the lane's width in view in portrait
    this.camera.fov = w < h ? 62 : 48;
    this.camera.updateProjectionMatrix();
    this.portrait = w < h;
    if (this.hall) { const s = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.hall.resize(s.x, s.y); }
  }

  render(dt) {
    const k = 1 - Math.pow(0.0015, dt);
    this.camPos.lerp(this.camTargetPos, k);
    this.camLook.lerp(this.camTargetLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      const a = e.pts.geometry.getAttribute('position');
      for (let j = 0; j < e.vel.length; j++) {
        e.vel[j].y -= 4 * dt;
        a.setXYZ(j, a.getX(j) + e.vel[j].x * dt, a.getY(j) + e.vel[j].y * dt, a.getZ(j) + e.vel[j].z * dt);
      }
      a.needsUpdate = true;
      e.pts.material.opacity = Math.max(0, e.life / 1.6);
      if (e.life <= 0) { this.scene.remove(e.pts); e.pts.geometry.dispose(); e.pts.material.dispose(); this.effects.splice(i, 1); }
    }
    this.renderer.info.reset();
    if (this.hall) {
      this.hall.update(dt);
      this.hall.renderMirror(this.renderer, this.scene, this.camera);
    }
    this.renderer.render(this.scene, this.camera);
    if (dt > 0) this.watchFrameRate();
  }
}

// The lights over the game's lanes (the pin-deck lamp and the lamps behind the valances), for
// js/audio/moments.js, which brightens them for a moment on a strike
BowlingScene.prototype.gameLights = function () {
  return this.deckLight ? [this.deckLight, ...(this.lampLights || [])] : [];
};

// The lane number on a game lane's masking unit
BowlingScene.prototype.setLabel = function (slot, number) {
  const l = this.lanes.get(slot);
  if (!l || !this.hall) return;
  this.hall.setLabel(Math.round(l.laneX / LANE.laneSpacing), number);
};

// The predicted path of the ball being aimed (null hides it)
BowlingScene.prototype.showAimPath = function (laneX, path) {
  if (this.aimLine) { this.scene.remove(this.aimLine); this.aimLine.geometry.dispose(); this.aimLine.material.dispose(); this.aimLine = null; }
  if (!path || path.length < 2) return;
  const pts = path.filter((p, i) => i % 2 === 0).map((p) => new THREE.Vector3(p.x + laneX, 0.012, p.z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  this.aimLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xE2B550, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.85 }));
  this.aimLine.computeLineDistances();
  this.scene.add(this.aimLine);
};

// Number every lane of the hall from the first game lane's number (blank below lane 1)
BowlingScene.prototype.relabel = function (base) {
  if (this.hall) this.hall.relabel(base);
};

// ---------------------------------------------------------------------------
// scene.js - what the player sees: a bowling hall with the game's lanes, drawn with
// three.js from the physics in physics.js. Original artwork: everything is made here
// from geometry and canvas textures.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LANE, PIN_PROFILE, PIN_SPOTS } from './physics.js';

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

// The lane: 39 maple boards, the guide dots at 7 ft and the arrows at 15 ft, the foul line
function laneTexture() {
  const W = 512, H = 4096;               // across x along
  return canvasTexture(W, H, (g) => {
    const bw = W / 39;
    for (let i = 0; i < 39; i++) {
      const tone = 214 + ((i * 37) % 17) - 8;
      g.fillStyle = `rgb(${tone}, ${tone - 38}, ${tone - 92})`;
      g.fillRect(i * bw, 0, bw + 1, H);
      g.fillStyle = 'rgba(90,50,20,0.25)';
      g.fillRect(i * bw, 0, 1, H);
      // grain
      for (let k = 0; k < 60; k++) {
        g.fillStyle = `rgba(120,70,30,${0.04 + Math.random() * 0.05})`;
        g.fillRect(i * bw + Math.random() * bw, Math.random() * H, 1, 30 + Math.random() * 160);
      }
    }
    const zToY = (m) => H - (m / (LANE.pitEdge + 0.1)) * H;   // metres from the foul line -> texture row
    // pin deck a little lighter
    g.fillStyle = 'rgba(255,240,215,0.18)';
    g.fillRect(0, 0, W, zToY(LANE.headPin - 0.25));
    // the foul line
    g.fillStyle = '#1b1b1b';
    g.fillRect(0, zToY(0) - 10, W, 10);
    // guide dots at 7 ft (2.13 m) and the arrows at 15 ft (4.57 m)
    g.fillStyle = '#1d2b4a';
    for (const b of [3, 5, 8, 11, 14]) for (const s of [-1, 1]) {
      const x = W / 2 + s * (19.5 - b) * bw;
      g.beginPath(); g.arc(x, zToY(2.13), 4, 0, Math.PI * 2); g.fill();
    }
    for (let a = 0; a < 7; a++) {
      const board = 5 + a * 5;
      const x = (board - 0.5) * bw;
      const dist = 3.66 + Math.abs(a - 3) * 0.3;
      const y = zToY(dist);
      g.fillStyle = '#16264a';
      g.beginPath(); g.moveTo(x, y - 40); g.lineTo(x - 7, y + 10); g.lineTo(x + 7, y + 10); g.closePath(); g.fill();
    }
    // pin spots
    g.fillStyle = 'rgba(40,30,20,0.5)';
    for (const [px, pz] of PIN_SPOTS) { g.beginPath(); g.arc(W / 2 + px / LANE.width * W, zToY(-pz), 5, 0, Math.PI * 2); g.fill(); }
  });
}

function approachTexture() {
  return canvasTexture(512, 512, (g, W, H) => {
    const bw = W / 39;
    for (let i = 0; i < 39; i++) {
      const tone = 200 + ((i * 29) % 13);
      g.fillStyle = `rgb(${tone}, ${tone - 45}, ${tone - 100})`;
      g.fillRect(i * bw, 0, bw + 1, H);
    }
    g.fillStyle = '#1d2b4a';
    for (const y of [0.25, 0.7]) for (const b of [3, 5, 8, 11, 14, 20, 25, 28, 31, 34, 36]) { g.beginPath(); g.arc(b * bw, y * H, 4, 0, Math.PI * 2); g.fill(); }
  });
}

// The masking panel over the pins: the game's own artwork
function maskingTexture(laneNumber) {
  if (!(laneNumber >= 1)) return canvasTexture(64, 16, (g, W, H) => { g.fillStyle = "#0d1b33"; g.fillRect(0, 0, W, H); });
  return canvasTexture(1024, 256, (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0d1b33'); grad.addColorStop(1, '#16325a');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#E2B550'; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
    // runic border
    g.fillStyle = 'rgba(226,181,80,0.35)';
    g.font = 'bold 26px serif';
    g.fillText('ᚠᚢᚦᚨᚱᚲ ᚷᚹᚺᚾᛁᛃ ᛇᛈᛉᛊᛏ ᛒᛖᛗᛚᛜ ᛞᛟ ᚠᚢᚦᚨᚱᚲ ᚷᚹᚺᚾᛁᛃ', 30, H - 26);
    g.fillStyle = '#EEF2F8';
    g.font = 'bold 96px "Barlow Condensed", Arial Narrow, sans-serif';
    g.textAlign = 'center';
    g.fillText('VIKING BOWLING', W / 2, 120);
    g.fillStyle = '#E2B550';
    g.font = 'bold 48px "Barlow Condensed", Arial, sans-serif';
    g.fillText(String(laneNumber), W / 2, 185);
  });
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
  constructor(container) {
    this.container = container;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: !LOW_END, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW_END ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !/[?&]gfx=low/.test(location.search);
    renderer.shadowMap.type = LOW_END ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070c16);
    scene.fog = new THREE.Fog(0x070c16, 24, 46);
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

  // Builds the visible lanes: the game's own (with pins and a ball) and neighbours for the hall
  buildHall(gameLanes, laneNumbers) {
    const sp = LANE.laneSpacing;
    const xs = gameLanes.map((g) => g.laneX);
    const minX = Math.min(...xs) - sp * 3, maxX = Math.max(...xs) + sp * 3;
    // floor, ceiling glow, side walls
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 6, 60), new THREE.MeshStandardMaterial({ color: 0x0c1220, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((minX + maxX) / 2, -0.12, -12);
    this.scene.add(floor);
    const laneMat = new THREE.MeshPhysicalMaterial({ map: this.textures.lane, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.7 });
    const apprMat = new THREE.MeshStandardMaterial({ map: this.textures.approach, roughness: 0.5 });
    const gutterMat = new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1a2742, roughness: 0.6 });
    const pitMat = new THREE.MeshStandardMaterial({ color: 0x020305, roughness: 1 });
    const len = LANE.pitEdge + 0.1;
    let n = 0;
    for (let x = minX; x <= maxX + 0.01; x += sp, n++) {
      const surf = new THREE.Mesh(new THREE.PlaneGeometry(LANE.width, len), laneMat);
      surf.rotation.x = -Math.PI / 2; surf.position.set(x, 0, -len / 2);
      surf.receiveShadow = true;
      this.scene.add(surf);
      const appr = new THREE.Mesh(new THREE.PlaneGeometry(LANE.width + 2 * LANE.gutter + 0.16, 4.6), apprMat);
      appr.rotation.x = -Math.PI / 2; appr.position.set(x, -0.001, 2.3);
      appr.receiveShadow = true;
      this.scene.add(appr);
      for (const s of [-1, 1]) {
        const g = new THREE.Mesh(new THREE.CylinderGeometry(LANE.gutter / 2, LANE.gutter / 2, len, 16, 1, true, -Math.PI / 2, Math.PI), gutterMat);
        g.scale.set(1, 1, 0.45);          // local z is world y after the turn: a shallow channel
        g.rotation.x = Math.PI / 2; g.rotation.y = 0;
        g.rotation.z = 0;
        g.position.set(x + s * (LANE.width / 2 + LANE.gutter / 2), 0.0, -len / 2);
        g.rotateX(0);
        g.receiveShadow = true;
        this.scene.add(g);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, len), capMat);
      cap.position.set(x + sp / 2, 0.02, -len / 2);
      this.scene.add(cap);
      const pit = new THREE.Mesh(new THREE.BoxGeometry(LANE.width + 2 * LANE.gutter, 0.02, 1.0), pitMat);
      pit.position.set(x, -0.35, -LANE.pitEdge - 0.5);
      this.scene.add(pit);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(sp, 1.2), new THREE.MeshStandardMaterial({ color: 0x05070c }));
      back.position.set(x, 0.3, -LANE.pitEdge - 0.98);
      this.scene.add(back);
      // the masking unit
      const which = gameLanes.find((g) => Math.abs(g.laneX - x) < 0.01);
      const offset = Math.round((x - xs[0]) / sp);
      const num = laneNumbers.base + offset;
      const mask = new THREE.Mesh(new THREE.PlaneGeometry(sp, sp / 4), new THREE.MeshBasicMaterial({ map: maskingTexture(num) }));
      mask.position.set(x, 1.15, -LANE.pitEdge - 0.4);
      this.scene.add(mask);
      if (which) which.maskMesh = mask;
      this.masks = this.masks || [];
      this.masks.push({ mesh: mask, offset });
      // decorative racks on the neighbouring lanes
      if (!which) {
        for (const [px, pz] of PIN_SPOTS) {
          const pin = new THREE.Mesh(this.pinGeo, this.pinMat);
          pin.position.set(x + px, 0, pz);
          this.scene.add(pin);
        }
      }
    }
    // light over the pin decks and along the lanes
    const deckLight = new THREE.SpotLight(0xfff4e0, 60, 9, Math.PI / 5, 0.5, 1.2);
    deckLight.position.set((xs[0] + xs[xs.length - 1]) / 2, 2.6, -LANE.headPin + 2.0);
    deckLight.target.position.set(deckLight.position.x, 0, -LANE.headPin - 0.4);
    deckLight.castShadow = true;
    deckLight.shadow.mapSize.set(LOW_END ? 512 : 1024, LOW_END ? 512 : 1024);
    this.scene.add(deckLight, deckLight.target);
    for (let z = -2; z > -17; z -= 5) {
      const l = new THREE.PointLight(0xc8d8ff, 6, 9, 1.5);
      l.position.set((xs[0] + xs[xs.length - 1]) / 2, 2.4, z);
      this.scene.add(l);
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
      this.scene.add(ball);
      this.lanes.set(gl.slot, { ...gl, pins, ball });
    }
  }

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
    });
    const bb = physics.ball;
    l.ball.position.set(bb.position.x, bb.position.y, bb.position.z);
    l.ball.quaternion.set(bb.quaternion.x, bb.quaternion.y, bb.quaternion.z, bb.quaternion.w);
  }

  // Camera presets
  aimView(laneX, portrait) {
    this.camTargetPos.set(laneX, portrait ? 1.25 : 1.05, portrait ? 3.3 : 2.9);
    this.camTargetLook.set(laneX, 0.0, -6);
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
    this.renderer.render(this.scene, this.camera);
  }
}

// The lane number on a game lane's masking panel
BowlingScene.prototype.setLabel = function (slot, number) {
  const l = this.lanes.get(slot);
  if (!l || !l.maskMesh || l.label === number) return;
  l.label = number;
  if (l.maskMesh.material.map) l.maskMesh.material.map.dispose();
  l.maskMesh.material.map = maskingTexture(number);
  l.maskMesh.material.needsUpdate = true;
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
  for (const m of this.masks || []) {
    const n = base + m.offset;
    if (m.label === n) continue;
    m.label = n;
    if (m.mesh.material.map) m.mesh.material.map.dispose();
    m.mesh.material.map = maskingTexture(n);
    m.mesh.material.needsUpdate = true;
  }
};

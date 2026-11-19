// ---------------------------------------------------------------------------
// bumpers.js - the bumper rails of the game's lanes, as a hall's bumper machines: a padded rail
// lying in each gutter that swings up on its hinge when a bumper player's turn starts (OpenPlay's
// adjustBumper raises them, Pet48's LaneBumper drives the motor) and folds back down for a player
// without bumpers. The rails are solid in the physics at once (physics.js setBumpers); the model
// takes BUMPER_MOVE_S to rise or fall, as the motor does.
// Built from geometry and a canvas texture, added to the scene beside the game's own pins and balls
// (scene.lanes: slot -> { laneX }); it animates itself while moving.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { LANE, BUMPER } from './physics.js';
import { REFLECT_LAYER } from './hall.js';
import { gameEvents } from '../game/events.js';

export const BUMPER_MOVE_S = 1.6;
const DOWN_ANGLE = 1.35;          // lying in the gutter, folded outward (rad)

function railTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  // the padded cover: blue with a darker seam every segment, a yellow strip along the top
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#0f3f86'); grd.addColorStop(0.5, '#2a7ae0'); grd.addColorStop(1, '#0f3f86');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, 64, 6);
  g.fillStyle = '#f2c230'; g.fillRect(26, 0, 12, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Bumpers3D {
  // scene: the BowlingScene; physics: [LanePhysics per slot]
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.state = new Map();       // slot -> { up, t (0 down .. 1 up), groups: [left, right] }
    const len = BUMPER.z0 - BUMPER.z1;
    const tex = railTexture();
    tex.repeat.set(1, len / 0.9);
    this.mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
    this.capMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b8, metalness: 0.7, roughness: 0.35 });
    // the rail's section: 10 cm wide, 14 cm high, rounded on the lane side
    const shape = new THREE.Shape();
    // from the gutter's floor (4.5 cm below the lane) to the physics rail's top
    const w = BUMPER.halfWidth * 2, h = BUMPER.height + 0.045, r = 0.035;
    this.railH = h;
    shape.moveTo(0, 0); shape.lineTo(w, 0); shape.lineTo(w, h); shape.lineTo(r, h);
    shape.quadraticCurveTo(0, h, 0, h - r); shape.lineTo(0, 0);
    this.geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    this.geo.translate(0, 0, -len);                 // from z = 0 down the lane
    // the UVs of the long sides along the rail: the texture's v runs with z
    const uv = this.geo.getAttribute('uv'), pos = this.geo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) / w + pos.getY(i) / h) * 0.5, -pos.getZ(i) / 0.9 / (len / 0.9));
    uv.needsUpdate = true;
    this.geo.computeVertexNormals();
    for (const [slot, L] of scene.lanes) this.build(slot, L.laneX);
    this.raf = 0;
  }

  build(slot, laneX) {
    const groups = [-1, 1].map((side) => {
      // the rail's lane-side bottom edge, at the gutter's floor; it rises out of the gutter
      const hinge = new THREE.Group();
      hinge.position.set(laneX + side * BUMPER.face, -0.045, BUMPER.z0);
      const rail = new THREE.Mesh(this.geo, this.mat);
      // the section is drawn from x 0 (lane side) to w (outside): mirror it for the left rail
      rail.scale.x = side;
      rail.castShadow = false; rail.receiveShadow = true;
      rail.layers.enable(REFLECT_LAYER);
      hinge.add(rail);
      this.scene.scene.add(hinge);
      return { hinge, side };
    });
    const s = { up: false, t: 0, groups, laneX };
    this.state.set(slot, s);
    this.pose(s);
  }

  // up 0..1: sunk below the gutter's floor .. upright beside the lane, its face where the physics
  // has it; on the way it leans out a little, as the rail's lever arm swings it up
  pose(s) {
    const e = s.t * s.t * (3 - 2 * s.t);
    for (const { hinge, side } of s.groups) {
      hinge.rotation.z = -side * DOWN_ANGLE * 0.18 * Math.sin(Math.PI * (1 - e)) * (1 - e);
      hinge.position.y = -0.045 - (this.railH + 0.03) * (1 - e);
      hinge.visible = e > 0.01;
    }
  }

  isUp(slot) { const s = this.state.get(slot); return !!s && s.up; }

  // OpenPlay's adjustBumper for one lane: up for a bumper player, down for the others
  set(slot, up, info = {}) {
    const s = this.state.get(slot);
    if (!s) return;
    up = !!up;
    if (this.physics[slot]) this.physics[slot].setBumpers(up);
    if (s.up === up) return;
    s.up = up;
    gameEvents.emit(up ? 'bumpersUp' : 'bumpersDown', { lane: info.lane, player: info.player || '' });
    if (up && this.onFirstUp) { const f = this.onFirstUp; this.onFirstUp = null; f(info); }
    this.animate();
  }

  // all down at once (a new game, the menu)
  reset() {
    for (const [slot, s] of this.state) { s.up = false; s.t = 0; this.pose(s); if (this.physics[slot]) this.physics[slot].setBumpers(false); }
  }

  animate() {
    if (this.raf) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      let moving = false;
      for (const s of this.state.values()) {
        const target = s.up ? 1 : 0;
        if (s.t !== target) {
          s.t = target > s.t ? Math.min(1, s.t + dt / BUMPER_MOVE_S) : Math.max(0, s.t - dt / BUMPER_MOVE_S);
          this.pose(s);
          moving = true;
        }
      }
      this.raf = moving ? requestAnimationFrame(step) : 0;
      if (moving && this.scene && !this.scene.rendering && this.onIdleFrame) this.onIdleFrame();
    };
    this.raf = requestAnimationFrame(step);
  }
}

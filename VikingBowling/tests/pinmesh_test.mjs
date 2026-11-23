// The drawn pins are closed, also underneath: node tests/pinmesh_test.mjs
// The pin's materials draw the outside only, so a hole in the mesh shows what is behind the pin (its base
// was open until 2026-11-23, and looked transparent on a pin lying with it to the player). For both pins
// (the game's and the neighbours' low detail one, js/sim3d/pinmesh.js): every edge is shared by exactly two
// triangles turned opposite ways (no hole, nothing inside out), the base is flat, faces down and is shaded
// flat, the outline is the one the physics collides with, and the pin stays cheap. The old mesh, a plain
// lathe of the outline, must fail the first check (the check is not vacuous).
import * as THREE from 'three';
import { pinGeometry, lowPinGeometry } from '../js/sim3d/pinmesh.js';
import { PIN_PROFILE, pinRadiusAt } from '../js/sim3d/physics.js';

let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; return ok; };

// Open edges and edges used the same way twice, the vertices at one place taken as one
function holes(geo) {
  const pos = geo.getAttribute('position'), index = geo.getIndex(), id = new Map(), edges = new Map();
  const at = (v) => { const k = [pos.getX(v), pos.getY(v), pos.getZ(v)].map((c) => Math.round(c * 1e6)).join(); if (!id.has(k)) id.set(k, id.size); return id.get(k); };
  let volume = 0, noArea = 0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const t = [0, 1, 2].map((k) => at(index.getX(i + k)));
    if (new Set(t).size < 3) { noArea++; continue; }
    for (let k = 0; k < 3; k++) { const e = t[k] + '>' + t[(k + 1) % 3]; edges.set(e, (edges.get(e) || 0) + 1); }
    A.fromBufferAttribute(pos, index.getX(i)); B.fromBufferAttribute(pos, index.getX(i + 1)); C.fromBufferAttribute(pos, index.getX(i + 2));
    volume += A.dot(B.cross(C)) / 6;
  }
  let open = 0, twice = 0, openLow = 0;
  for (const [e, n] of edges) {
    const [a, b] = e.split('>');
    if (n > 1) twice++;
    if (!edges.has(b + '>' + a)) { open++; const y = [...id].find(([, v]) => v === +a)[0].split(',')[1] / 1e6; if (y < 0.01) openLow++; }
  }
  return { open, openLow, twice, volume, noArea };
}

// the mesh as it was: a lathe of the outline from the corner of the base up
{
  const old = new THREE.LatheGeometry(PIN_PROFILE.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.0005), y)), 28);
  check(holes(old).openLow === 28, `the old mesh is found open underneath (${holes(old).openLow} open edges round its base)`);
}
// (the volume of the outline's solid, cut in 4000 slices)
let solid = 0;
for (let i = 0; i < 4000; i++) solid += Math.PI * pinRadiusAt((i + 0.5) / 4000 * 0.381) ** 2 * 0.381 / 4000;

for (const [name, geo, most] of [['the game\'s pin', pinGeometry(), 1008], ['the neighbours\' pin', lowPinGeometry(), 280]]) {
  const h = holes(geo), pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), index = geo.getIndex(), tris = index.count / 3;
  check(h.open === 0 && h.twice === 0, `${name}: closed all round (open edges ${h.open}, inside-out edges ${h.twice})`);
  check(h.noArea === 0 && tris <= most, `${name}: ${tris} triangles, none without area`);
  check(h.volume > 0.9 * solid && h.volume < 1.01 * solid, `${name}: outside out, ${(h.volume / solid * 100).toFixed(0)} % of the outline's volume`);
  // the base: the triangles lying on the deck cover a disc, face down, and are lit as one flat face
  let area = 0, flat = 1;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const v = [0, 1, 2].map((k) => index.getX(i + k));
    if (v.some((k) => Math.abs(pos.getY(k)) > 1e-7)) continue;
    A.fromBufferAttribute(pos, v[0]); B.fromBufferAttribute(pos, v[1]); C.fromBufferAttribute(pos, v[2]);
    n.copy(B).sub(A).cross(C.sub(A));
    area += -n.y / 2;                                              // counted against when it faces up
    for (const k of v) flat = Math.min(flat, -nor.getY(k) / Math.hypot(nor.getX(k), nor.getY(k), nor.getZ(k)));
  }
  const r = Math.sqrt(area / Math.PI) * 1000;
  check(r > 22 && r < 26 && flat > 0.995, `${name}: a flat base of ${r.toFixed(1)} mm radius facing down, shaded flat (${(Math.acos(Math.min(1, flat)) * 180 / Math.PI).toFixed(1)} degrees off at most)`);
  // every ring on the outline the pins collide with (the edge of the base is taken off by up to 2 mm)
  let off = 0, offEdge = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), d = Math.hypot(pos.getX(i), pos.getZ(i)) - pinRadiusAt(y);
    if (y > 0.003) off = Math.max(off, Math.abs(d)); else offEdge = Math.max(offEdge, d);
  }
  check(off < 1e-6 && offEdge < 0.0005, `${name}: on the physics' outline (${(off * 1000).toFixed(3)} mm off), nothing outside it at the base`);
  // the stripes are still there
  const col = geo.getAttribute('color');
  let red = 0;
  for (let i = 0; i < pos.count; i++) if (col.getY(i) < 0.5 && pos.getY(i) > 0.22 && pos.getY(i) < 0.27) red++; else if (col.getY(i) < 0.5) red = -Infinity;
  check(red > 0, `${name}: red on the neck only`);
}
console.log(failures ? `${failures} FAILED` : 'All pin mesh checks passed');
process.exitCode = failures ? 1 : 0;

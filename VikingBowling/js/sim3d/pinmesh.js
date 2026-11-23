// ---------------------------------------------------------------------------
// pinmesh.js - the pin as it is drawn: the USBC outline (PIN_PROFILE in physics.js) turned on a
// lathe and closed underneath, for the game's own pins (scene.js, the red pin too), the
// neighbours' (hall.js) and so the pins in the lane's reflection. Only what is seen: the collision
// shape is PIN_PIECES in physics.js. No DOM: tests/pinmesh_test.mjs runs it in node.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { PIN_PROFILE } from './physics.js';

// The base, [height, radius] from its middle out. The profile's lowest point, (0, 25.8 mm), is the corner
// between the flat base and the side. EDGED: the corner taken off over the 2.4 mm a real pin's 5/32 in
// edge radius takes of the base, so the edge catches the light as a rounded one does. SHARP: for few
// facets, the corner twice: one for the base and one for the side, each with its own normal.
const SIDE = PIN_PROFILE.slice(1), [, CORNER] = PIN_PROFILE[0];
const EDGED = [[0, 0], [0, CORNER - 0.0024], [0.0021, CORNER + 0.0011]];
const SHARP = [[0, 0], [0, CORNER], [0, CORNER]];

// outline: [height, radius] from the axis at the base to the axis at the top. The lathe's own normals
// are kept: they follow the outline (each point's is weighted by the length of the segments beside it,
// so the base stays flat up to its edge), and unlike computeVertexNormals() they leave no seam where the
// lathe meets itself. red(y): whether a ring at that height is in a neck stripe.
function lathe(outline, segments, red) {
  const geo = new THREE.LatheGeometry(outline.map(([y, r]) => new THREE.Vector2(r, y)), segments);
  const pos = geo.getAttribute('position'), col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.set(red(pos.getY(i)) ? [0.75, 0.05, 0.07] : [1, 1, 1], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // triangles without area are not drawn: a ring on the axis is a point, and the sharp corner's two rings
  // are the same one
  const index = geo.getIndex(), keep = [];
  const same = (a, b) => pos.getX(a) === pos.getX(b) && pos.getY(a) === pos.getY(b) && pos.getZ(a) === pos.getZ(b);
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => index.getX(i + k));
    if (!same(a, b) && !same(b, c) && !same(c, a)) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  return geo;
}

// The game's pins: white with the two red neck stripes
export function pinGeometry() {
  return lathe([...EDGED, ...SIDE], 28, (y) => (y > 0.226 && y < 0.239) || (y > 0.246 && y < 0.259));
}

// The neighbours' pins: the same outline with fewer facets (instanced, so ~260 pins are one draw)
export function lowPinGeometry() {
  const keep = [2, 3, 4, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17];
  return lathe([...SHARP, ...keep.map((i) => PIN_PROFILE[i])], 10, (y) => y > 0.222 && y < 0.262);
}

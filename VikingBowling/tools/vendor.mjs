// Copies the two runtime libraries out of node_modules into lib/, with their licences,
// so the game runs from any static host (GitHub Pages does not serve node_modules).
//   npm install && node tools/vendor.mjs
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const files = [
  ['three/build/three.module.js', 'lib/three/three.module.js'],
  ['three/build/three.core.js', 'lib/three/three.core.js'],
  ['three/LICENSE', 'lib/three/LICENSE'],
  ['three/examples/jsm/environments/RoomEnvironment.js', 'lib/three/addons/environments/RoomEnvironment.js'],
  ['cannon-es/dist/cannon-es.js', 'lib/cannon-es/cannon-es.js'],
  ['cannon-es/LICENSE', 'lib/cannon-es/LICENSE']
];
for (const [from, to] of files) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(nm, from), join(root, to));
  console.log(to);
}

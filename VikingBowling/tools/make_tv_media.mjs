// Makes the game hall's lane TV animations: node tools/make_tv_media.mjs [baseUrl] [previewDir]
//   baseUrl: where the game folder is served (default http://127.0.0.1:8471/games/VikingBowling/)
// Opens tools/tv_media_maker.html in headless Edge, records every animation with MediaRecorder
// (WebM, VP9 where there is one) and writes web/screen/TV/media/<Name>.webm with <Name>.ini beside
// it - the sidecar a hall writes for its own media, naming the exciter it is for, which
// shared/graphics/prio.cpp reads ([main] action=..., prio=...). With previewDir, one still of each.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, sleep } from '../tests/cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || 'http://127.0.0.1:8471/games/VikingBowling/';
const preview = process.argv[3] || null;
const OUT = join(here, '..', 'web', 'screen', 'TV', 'media');
// the file, the actions it is for (CMultimedia::GetRandomMedia's names), its length
const MEDIA = [
  ['Strike', 'STRIKEA', 2.4], ['Double', 'STRIKE2', 2.2], ['Turkey', 'STRIKE3', 2.6], ['FourBagger', 'STRIKE4', 2.4],
  ['StrikeStreak', 'STRIKE5;STRIKE6;STRIKE7;STRIKE8;STRIKE9;STRIKE10;STRIKE11', 2.4], ['Perfect300', '300', 3.2],
  ['Spare', 'SPARE', 2.2], ['SplitConverted', 'SPMAKE', 2.6], ['Split', 'SPLIT', 2.0], ['GutterBall', 'MISS', 2.4], ['Foul', 'FOUL', 2.0]
];

const b = await openBrowser({ w: 960, h: 540 });
await b.go(base + 'tools/tv_media_maker.html', 2500);
mkdirSync(OUT, { recursive: true });
for (const [name, action, secs] of MEDIA) {
  const r = await b.eval(`return await window.record(${JSON.stringify(name)}, ${secs})`);
  if (!r || r.error || !r.b64) { console.log('FAILED', name, r && r.error); continue; }
  writeFileSync(join(OUT, name + '.webm'), Buffer.from(r.b64, 'base64'));
  writeFileSync(join(OUT, name + '.ini'),
    `; Viking Bowling - the game hall's lane TV animation (tools/make_tv_media.mjs)\r\n[main]\r\naction=${action}\r\nprio=100\r\n`);
  console.log(name.padEnd(15), action.padEnd(12), (r.size / 1024).toFixed(0) + ' KB', r.type);
  if (preview) {
    const png = await b.eval(`return window.frameAt(${JSON.stringify(name)}, ${secs * 0.8})`);
    mkdirSync(preview, { recursive: true });
    writeFileSync(join(preview, name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
  }
  await sleep(200);
}
console.log(b.log.filter((l) => !/favicon/.test(l)).join('\n'));
await b.close();
process.exit(0);

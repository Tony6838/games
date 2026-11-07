/* 存一份当前 AI 作为对打基线： node tools/snapshot.js v2
 * 之后可以 node tools/selfplay.js duel current tools/baselines/ai_v2.js 6000 */
'use strict';
const fs = require('fs');
const path = require('path');
const name = process.argv[2];
if (!name) { console.error('要给基线起个名字'); process.exit(1); }
const dir = path.join(__dirname, 'baselines');
fs.mkdirSync(dir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, '../js/ai.js'), 'utf8')
  .replace("require('./cards.js')", "require('../../js/cards.js')")
  .replace("require('./rules.js')", "require('../../js/rules.js')");
fs.writeFileSync(path.join(dir, 'ai_' + name + '.js'), src, 'utf8');
console.log('已保存 tools/baselines/ai_' + name + '.js');

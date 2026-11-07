# 上海麻将（清混碰）

网页 3D 麻将，你对三位电脑玩家。只用 HTML、CSS、JavaScript，没有第三方库，也没有图片和音频文件（牌面、声音都是现场生成的）。

## 怎么玩

- **电脑上**：直接双击 `index.html`。
- **手机上**：打开网址后点「全屏开玩」，游戏只在全屏横屏下进行；竖着拿手机也会按横屏显示，不用转手机。iPhone 的 Safari 不能全屏，要先「分享 → 添加到主屏幕」，再从主屏幕的图标打开；微信里要先「在浏览器打开」。
- 鼠标：移到牌上抬起并显示「打这张听什么」，点一下打出。触屏：点一下抬起，再点一下打出。

规则在游戏里的「规则」按钮，写的就是程序实际执行的规则。上海麻将各家打法有出入，数值都集中在 `js/rules.js` 开头的 `VALUES`，可以按自己的习惯改。

## 公平性

- 洗牌用 `crypto.getRandomValues` 加 Fisher-Yates，没有取模偏差。
- 牌墙和手牌放在 `js/game.js` 的真私有字段（`#`）里，外部代码读不到。牌的编号就是在牌墙中的位置，不透露牌种。
- 电脑只拿到 `view`：自己的手牌和桌面公开信息。别人的暗杠看不到牌种。
- 电脑的决定是 `view` 的纯函数，不用随机数；响应打牌时各家互不知情，也不加「想一下」的延迟。
- `tests/run_tests.js` 验证以上几点，并统计发牌分布和座位胜率。

## 文件

| 路径 | 内容 |
|---|---|
| `js/tiles.js` | 牌张、洗牌 |
| `js/rules.js` | 牌型判定、算花、算点、结算（纯函数） |
| `js/game.js` | 裁判：一局的流程和信息隔离 |
| `js/ai.js` | 电脑玩家，原理和参数见 `docs/ai.md` |
| `js/art.js` `gfx.js` `scene.js` | 牌面绘制、WebGL2 渲染、牌桌布局和动画 |
| `js/app.js` | 界面：事件变动画，点击变动作 |
| `tools/selfplay.js` | 四家自我博弈：统计、同牌对打、调参 |
| `tools/snapshot.js` `tools/baselines/` | 保存和对打用的 AI 基线 |
| `tools/danger_stats.js` | 从对局统计真实放炮率：`node tools/danger_stats.js 8000` |
| `docs/selfplay_log.md` | 每轮调参和逻辑改动的对打结果，包括被否决的 |
| `docs/test_report.md` | 300 局实战测试报告 |
| `tests/run_tests.js` | 规则和公平性测试：`node tests/run_tests.js 2000` |
| `tests/browser_check.mjs` | 无头 Edge 真实打一局并截图：`node tests/browser_check.mjs 目录 844 390 4 1 play touch` |
| `tests/soak.mjs` | 在真实界面连打多局，查错误、卡顿、内存、布局：`node tests/soak.mjs 目录 --hands 300 --par 3 --speed 10 --w 844 --h 390 --dpr 2 --gl gpu --stall 400`，结果在目录里的 `report.json` |
| `tests/robot.mjs` | 给 `soak.mjs` 用的「真人」：加 `--human 1` 后不再由电脑代打你的座位，而是用真实的鼠标或触摸事件来打，同时乱点、连点、转屏、切后台、丢失 WebGL 上下文。`--sizes 844x390x2,667x375x2,1600x900x1` 让各个页面用不同屏幕 |
| `tests/audit.js` | 逐局查电脑的失误：`node tests/audit.js 300` |

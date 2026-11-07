# 电脑玩家怎么打

`js/ai.js` 的决策只用一个输入：裁判给的 `view`（自己的手牌 + 桌面公开信息）。没有随机数，同一个 `view` 永远得到同一个决定。

## 思路

把每种合法牌型当作一个目标：清一色、混一色、碰碰胡、混碰、清碰、乱风向。对每一种可能的出牌：

1. 算出打掉这张后，离每个目标还差几张（向听数），以及现在能进多少张。
2. 估算在牌局结束前做成的概率 × 做成后的点数，取最好的目标，再加一点第二、第三目标的权重。
3. 减去打这张放炮的预期损失（见下一节）。

吃、碰、杠就是比较「动手之后」和「不动」的期望收益。杠的额外收益只在杠完还能胡的时候才算，否则会杠成死牌。一向听时，几乎一样好的选择之间，再用实算的将来等张数决胜。

## 放炮风险

打出一张牌的预期损失 = 对每个对手求和（真实放炮率 × 他这种情况下胡牌的平均点数）。

放炮率不是拍脑袋的，是 `tools/danger_stats.js` 从 8000 局对局里数出来的：

- `RON_RATE`：按对手的副露数（0～4）和牌局阶段（前、中、后）查基准放炮率，基准是「对手只亮一门，打他那门的牌」。
- `UNSEEN_FACTOR`：这张牌外面还剩 0～3 张时的倍数。外面一张不剩也不等于安全，因为顺子听牌不需要别人手里有这张。
- `rel*`：其他情况相对基准的比例，比如打字牌、打别门的牌、对手亮了两门。
- `pts*`：对手胡牌的平均点数。

读牌只用看得见的东西：副露的花色、副露数、牌河。

## 参数

| 参数 | 含义 |
|---|---|
| `refine` | 一向听时是否实算等张来决胜 |
| `surviveMeld` | 对手每多一副副露，牌局提前结束的可能增加多少 |
| `gFlush` `gHalf` `gPeng` | 听牌、一向听、二向听、三向听以上时，清一色 / 混一色 / 碰碰胡每一步能进的牌占可用牌的比例 |
| `callBonus` `ronBonus` | 吃碰、别人放炮让一圈里多见几张牌 |
| `horizon` `survive` | 最多按几圈估算；每圈牌局继续的概率 |
| `second` `third` | 第二、第三目标的权重 |
| `closedBonus` | 没吃碰时门清翻倍的希望 |
| `payScale` | 自摸三家付带来的放大 |
| `defense` | 放炮风险的总权重 |
| `relHonor` | 对手只亮一门时，打字牌相对打他那门的放炮率 |
| `relOffSuit` | 对手只亮一门时，打别门的牌的放炮率 |
| `relMulti` | 对手亮了两门（只可能碰碰胡）时的放炮率 |
| `relZiNumber` `relZiHonor` | 对手亮的全是字牌时，打数牌、打字牌的放炮率 |
| `relOwnRiver` | 这张牌在对手自己的牌河里时的放炮率 |
| `ptsPlain` `ptsClosed` `ptsZi` `ptsFour` | 对手胡牌的平均点数：普通、门清、字牌做大、四副副露 |
| `stayBias` `stayAdd` | 吃碰要比不动好多少才动手 |
| `gangAn` `gangMing` `gangJia` | 三种杠的额外收益 |
| `sankouRisk` | 第三次吃碰同一家（成三口）的代价 |
| `passRonMaxPoints` `passRonFactor` | 什么情况下放过小炮等自摸 |

`RON_RATE` 和 `UNSEEN_FACTOR` 是统计出来的常量，不参与调参。

三位电脑只有 `defense` 的倍数不同（0.85 / 1 / 1.2），大脑是同一个。

## 怎么继续改进

每次改动都要在同牌对打里赢过基线才留下，过程记在 `selfplay_log.md`：

```
node tools/snapshot.js v5                                  存基线
node tools/selfplay.js duel current tools/baselines/ai_v4.js 4000   改完后对打
node tools/selfplay.js tune 60 1500                        随机调参，打赢才接受
node tools/selfplay.js stats 4000                          看胡牌率、牌型分布等
node tools/danger_stats.js 8000                            重新统计真实放炮率
node tests/audit.js 300                                    逐局查失误
```

# Viking Bowling

A 3D bowling game for the browser by **VBS Bowling AB**, built from VBS's own
**Viking Scoring System 4.4**: its scoring and lane logic, its open play game types,
its VBS-T competition formats, its HTML lane TV and lane console look, its 4.4
splash and its texts in the five reception languages. You bowl with a swipe of a
finger or the mouse; everyone else on the lanes is a machine player whose game
follows published bowling statistics.

© 1995-2026 VBS Bowling AB. All rights reserved (see `LICENSE`). The game is for
training, education and entertainment.

---

## Running it

The game is static files. Serve the folder with any web server and open it:

```
cd VikingBowling
py -3 -m http.server 8000
```

then open <http://localhost:8000/>. On a phone or tablet on the same network use
`http://<this PC's address>:8000/`. Nothing is loaded from the internet at run time.

`node tests/serve.mjs 8000` does the same and also refuses a file asked for with the
wrong upper/lower case, as GitHub Pages does, and logs every 404.

The game runs from any sub-path (GitHub Pages included): every path is relative,
and the lane TV's absolute requests (`/html/...`, `/GameConsole/...`) are answered or
redirected inside the game (see "The lane TV" below).

URL options for testing: `?gfx=low` (no shadows, lower resolution), `?nofs=1` (never
asks for full screen).

### How to play

1. Splash: choose a language with a flag (Swedish is the default), read the short
   help and copyright text, press **OK**. The game asks for full screen on the first
   tap here. If the browser refused it, or you left it (Esc, the back gesture), it asks
   again when the next game starts (**Starta**, **Spela igen**, **Nästa serie**); the ⛶
   button in the game leaves and re-enters full screen (leaving with ⛶ is your choice,
   and then only ⛶ asks again). **iPhone:** Safari has no full-screen API for web pages
   (only for videos), so the game runs in the browser window there and the ⛶ button is
   not shown; added to the home screen, iOS opens it without the browser bars
   (`apple-mobile-web-app-capable`). iPad Safari has the API.
2. Choose **Öppet spel** (open play) or **VBS-T tävling** (competition), and
   **EUR** (the whole game on one lane) or **AMR** (American: the lane pair
   alternates every frame).
3. Type your name. The machine players get generated names; **Nya namn** draws new ones.
4. Bowl: press on the lane and slide sideways to choose where you release the ball
   (or use ←/→), then swipe up towards the pins and let go.
   * the **speed** of the swipe is the speed of the ball,
   * its **direction** is the line,
   * a **curve at the end** gives hook (curve left: hooks left, as a right-hander's ball).
   The ball can end in the gutter. With **Siktlinje** on, the ball's predicted path is
   drawn while you swipe.
5. Tap the lane TV to make it full size. ⏩ speeds the machine players up.
6. After the game: the summary (open play) or the standings after every serie and the
   end result (VBS-T).

---

## What works

| | EUR | AMR |
|---|---|---|
| Open play: Vanlig bowling, 3-6-9, Mini Bowling, 10th Frame, No Tap 6/7/8/9, Short Game 2/3/4/5, Classic Frame Game (CFG) | ✔ | ✔ |
| RedPin (red head pin, the RedPin chance and RedPin strike videos on the TV) | ✔ | ✔ |
| VBS-T, the formats with their own reception dialog: Banpoängsmatch 4+4 (4 lanes), 8+8 on 8, 4 and 6 lanes; Individuell; Petersen / Round Robin; Skånemästerskap; Lagspel; Korp 18 banpoäng, Hudiksvall 12, 2 man + baker, Västergötland | ✔ | ✔ (Korp baker: AMS) |
| VBS-T **Auto**: all 153 predefined Auto formats of 4.4 (`Reception\vbsTournaments\Auto\Hidden`) | 151 ✔ | 151 ✔ |

Two Auto formats cannot be played: **Finspång Korp** and **STM Final 1 serie** name
movement files that are not shipped with 4.4 (`Lag 2m EU 4s BP Finspång.ini`,
`STM1s.ini`), so the real VBS-T cannot book them either; the game shows them greyed
with that explanation.

Every VBS-T format plays as VBS-T plays it: the format's own header, rules and movement
file deal the players to lanes serie by serie (movement file or rotation, EUR / AMR /
AMS), every lane is bowled through the OpenPlay engine, points are awarded after each
serie by the format's rules (stp contests, personal extra points, team points per lane,
lane pair or all lanes, team MOD4 and team special points), and the standings and the
end result are sorted as VBS-T sorts them. You bowl your own lane (or lane pair) in 3D;
the other lanes are bowled by machine players at the same time, and when the movement
gives you no lane in a serie you sit it out and the serie is played out without you.

---

## What is reused from Viking 4.4, and from where

A path in the "From" column is either in the Viking 4.4 source tree (`scoring/...`,
`Slave/...`, `shared/...`, `Reception/PLUGINS/...`) or, where it says "installation", in an
installed Viking 4.4 (the `Viking2001` folder a lane PC and the reception run from), whose
files come from the `^/Resource/4.4` part of VBS's SVN repository.

| In the game | From | How |
|---|---|---|
| `js/engine/bowlingscore.js` | `scoring/bowlingscore/bowlingcalculations.cpp` (`RecalcScore`, `IsFirstBall`, `MaxPossibleScore`) | ported line by line, both guards included (activePos clamp, `pos >= 2`) |
| `js/engine/openplay.js` | `Slave/OPENPLAY/GameAbstract.cpp` (`Score`, `ActivateNextPlayer`, `ActivateNextPlayer2`, `GetNewPlayer`, `TestPlayer`, `SetRenderStatus`, `MoveActiveMark`, `RefreshGame`, `randomRedPin`, `AreAllGamesFinished`), `Game.cpp` (`CheckShortGame`, `CheckGameFinished`, `StartGame`), `Multimedia.cpp` (`MM_GetExciter`), `shared/lanedata` (`GlobCheckSplit`, `IsPlayerSerieComplete`, `FirstBallOfSerie`), `Slave/LOADCOM` (`startBowling`: game types and score modes) | ported; same structs and field names as `GCI_PLAYERINFORMATIONSTRUCT` / `GCI_PLAYERSTRUCT` |
| `js/engine/lanefile.js` | `CGCI_info::GetJsonFromPlayInfo` (`shared/lanedata/GCI_info.cpp`) | the frozen lane-file JSON: same keys, same order, every value a quoted string |
| `js/standin/loadcom.js`, `tv-standin.js` | `Slave/LOADCOM/LoadComWebInterface.cpp` (`BuildLaneStatusJson`, `BuildHtmlPayload`, `/html/events`, `/html/lanedata.json`) | a stand-in for LoadCom's HTML service, see "The lane TV" |
| `js/vbst/competition.js` | `Reception/PLUGINS/VBSTournament/gamefinished.cpp` (`ProcessSpecialPoints`, `DoGameCalculations`, `UpdateScoreFile`, `SortPlayersByTotalAndMakeEQGame`, the info TV team rows), `ChangeMovents.cpp` / `ShiftSettings.cpp` (dealing) | ported, including the rule combinations that award nothing |
| `js/vbst/format.js` | `shared/lanedata/tdf.h` (`TOURNAMENT_SHIFT_HEADER_STRUCT`, 444 bytes, `TOURNAMENT_SPECIAL_POINT_STRUCT`) and the movement INI format | the real `.h001` / `.r001` files are parsed at run time |
| `js/vbst/predefined.js` | `CShiftSettings::SetBanpSettings`, `SetPetersenSettings`, `SetKorpSettings`, `SetTeamPlaySettings`, the Ind and Skåne dialogs | the headers and rules those dialogs write |
| `js/vbst/onscoring.js` | `Slave/OPENPLAY/VBSTournam.cpp` (`MakeVBSJobs`), `Calc.cpp` (`GetEliteMax100to220Score`, the pari projection) | the VBS-T panel's values |
| `web/screen/HTML/TakTV/` | installation: `web\screen\HTML\TakTV` (`^/Resource/4.4/web/screen/HTML/TakTV`) | every file is byte for byte the SVN base of `^/Resource/4.4` at **r18742** (the folder's last change is r18727). `sample_lane.json`, a sample nothing loads, is left out. Added: `TakTVGame.html` = `TakTV.html` with two script tags (`js/standin/manifest.js`, `js/standin/tv-standin.js`) and a comment |
| `web/screen/TV/media/RedPin*.webm` | installation: `web\screen\TV\media` | the RedPin videos the TV plays |
| `v3gfx/Protocols/` (Standard, Viking Refresh, Viking (cfg), Halloween, Xmas Center), `v3gfx/Resource/` (Objects, ShowPins, Pins_On_Protocol, ShowMessage), `v3gfx/Backgrounds/Blue.jpg` | installation: `v3gfx` | the lane TV's themes and pictures. Ten XML files (`Protocols/Viking (cfg)/protocol.xml`, `Viking2001_CommonInfo.xml`, `Viking2001_StandardGrids.xml`, `Viking2001_TeamInfo.xml` and six under `Resource/Pins_On_Protocol/`) differ from the SVN base r18742 only by one removed comment line, the file's owner (a person's name); every other copied file is byte for byte as in 4.4. Left out: three files nothing asks for (`Resource/Objects/HammerLogo.png`, a third-party logo; `Resource/Objects/Top123.png`; `Protocols/Xmas Center/_Note.txt`) |
| `v3gfx/Backgrounds/ClubLogos/Empty.png` | installation: `v3gfx\Backgrounds\ClubLogos` | the transparent placeholder 4.4 ships, and only that: no hall's club logos. The VBS-T panels ask for `ClubLogos/<team>.png`; the game's teams have no logos, so the stand-in answers every such request with `Empty.png`, as the C++ copies `Empty.png` into place when a team's logo is missing |
| `GameConsole/Languages/*.lang` | installation: `GameConsole\Languages` | the lane TV's texts in the five languages |
| `Reception/vbsTournaments/` (Auto headers, PlayerMovements, OnScoring, OnScoringXml) | installation: `Reception\vbsTournaments` | the competition formats, movements and TV panels |
| `web/screen/console/lang/*.json`, `fonts/`, palette in `css/game.css`, flags in `js/i18n.js`, game-type pictures `web/screen/common/img/gametype*.jpg` | the web lane console (`touchconsoleLane.*`) | the menus use the console's look, game-type names and flags |
| `img/Splash44.png` | installation: `Reception\Loader\Splash.bmp` (converted to PNG) | **the 4.4 splash** ("Version 4.4, Copyright 1995-2026"). The source tree's `Reception\LOADER\SPLASH.bmp` is an older "Viking Scoring System 4 Alpha" picture, so the installed file is the 4.4 one |
| `img/SplashW.jpg` | installation: `SplashW.jpg` | the 1920x1080 "Loading" artwork (file unchanged), blurred and darkened behind the splash card, with its top quarter - the word "Loading" - pushed off the top of the screen (`.splashBg` in `css/game.css`), so the page cannot look as if it were still loading |

No C++ source is in this folder. The scoring harness, which compiles the C++, is kept
outside it (see "The scoring proof").

## What is new

* The 3D hall, lane, gutters, pins and ball (three.js, everything modelled and textured
  in code), the camera and the effects (`js/sim3d/scene.js`).
* The lane physics (`js/sim3d/physics.js`, cannon-es for pin-deck collisions): the ball's
  contact with the lane is modelled as sliding friction against the slip of the contact
  point, with a 40 ft oil pattern, so a ball with side rotation skids in the oil, hooks
  in the dry back end and rolls out; ball-pin and pin-pin impacts are impulses along the
  real pin outline (the USBC profile) with its rotational inertia.
* The swipe input (`js/sim3d/input.js`), the machine players (`js/ai/bots.js`), the
  synthesised sounds (`js/sound.js`), the flow and the screens (`js/main.js`, `index.html`,
  `css/game.css`) and the game's own texts in five languages (`js/i18n.js`).
* A machine player's ball is planned and bowled in 3D so the pins fall as its drawn
  pinfall says: the ball is aimed (by simulating the release) at the spot that leaves
  that leave, the pins that must stay up cannot be knocked down, and a pin that should
  fall but was not hit falls late, as a messenger would take it.

## The lane TV

The scoreboard is VBS's own HTML lane TV (`web/screen/HTML/TakTV`), with its themes,
the 5-second "pins left standing" picture, the RedPin videos, the VBS-T OnScoring panel,
the team-sum panel for team play and the AMR lane-pair view. It is fed exactly as a lane
PC feeds it: `TakTV.js` opens `EventSource('/html/events?lane=n')` and is pushed one
payload per ball, in the shape `BuildHtmlPayload` writes (lane status, settings, a one-shot
`animation` when OpenPlay sends `LC_PLAY_ANIMATION`, and the lane file under `lane`).

`js/standin/tv-standin.js` (loaded first by `TakTVGame.html`) answers inside the iframe:
`EventSource` subscribes to the game's stand-in LoadCom (`js/standin/loadcom.js`),
`/html/lanedata.json` returns the partner lane in AMR, the VBS-T layout
(`Reception/vbsTournaments/<league>.h001.xml`) and values (`GameCtrl/VBST_<league>.ini`)
come from the game's competition, and every asset URL is put into its real
upper/lower case (`js/standin/manifest.js`, made by `tools/make_manifest.mjs`), because
the theme XML was written on Windows and asks for `V3GFX\...` where the folder is
`v3gfx`. A request for a team's club logo (`v3gfx/Backgrounds/ClubLogos/<team>.png`) is
answered with `ClubLogos/Empty.png`. No file of TakTV is changed.

---

## The scoring proof

The C++ cannot run in a browser and Emscripten was not available, so the
scoring and the lane logic are **ported to JavaScript** (the HTML lane TV already
carries VBS's own JS port of `RecalcScore`, `vbsRecalcScore`). The port is proved
against the C++ by a native harness, kept outside the game folder in a separate tools
folder (not published):

* `build.cmd` compiles, with the Visual Studio 2026 compiler and outside the Viking
  solution, `scoring\bowlingscore\bowlingcalculations.cpp` **unmodified** (its own unit
  tests run too: all 6 pass), plus the real OpenPlay functions - `Score`,
  `ActivateNextPlayer[2]`, `TestPlayer`, `GetNewPlayer`, `SetRenderStatus`,
  `MoveActiveMark`, `RefreshGame`, `CheckShortGame`, `CheckGameFinished`,
  `MM_GetExciter`, `GlobCheckSplit`, `IsPlayerSerieComplete` - which `extract.mjs`
  copies **verbatim** from the Viking 4.4 source tree at build time. Only hardware, pipes,
  files and logging are stubbed; nothing that decides a score.
* `run.mjs` generates games for every game type, in EUR and in AMR, with 1-8 bowlers.
  A ball is "the pins this ball knocks if they stand" plus a foul flag, so each side
  works out the rack from its own state. After every ball both sides print the whole
  state: every bowler's `activeSquare`, `totalPoints`, `score[21]`, `status[21]`,
  `pinConfig[21]`, `RecalcScore` (strike sequence hidden and shown), `MaxPossibleScore`,
  and each lane's `activePlayer`, `isAnyPlayerActive`, `exciter`, `laneFinshFlag1`.
  It also fuzzes `RecalcScore`/`IsFirstBall`/`MaxPossibleScore` over 20,000 arrays and
  `GlobCheckSplit` over all 1024 pin masks, and runs the lane TV's `vbsRecalcScore`.

Result (`node run.mjs 300 4400`): **9,600 games, 606,095 state lines compared, 0 differ.**

| Game type | EUR games / balls | AMR games / balls | differing lines |
|---|---|---|---|
| Vanlig bowling | 300 / 25,036 | 300 / 27,068 | 0 |
| No Tap 6, 7, 8, 9 | 4 x 300 / 86,854 | 4 x 300 / 97,352 | 0 |
| 3-6-9 | 300 / 16,392 | 300 / 19,012 | 0 |
| Mini Bowling | 300 / 23,226 | 300 / 25,691 | 0 |
| 10th Frame | 300 / 3,276 | 300 / 4,031 | 0 |
| Short Game 2, 3, 4, 5 | 4 x 300 / 36,695 | 4 x 300 / 41,548 | 0 |
| Classic Frame Game (CFG theme) | 300 / 23,841 | 300 / 25,565 | 0 |
| No Tap 9 + 3-6-9, Short Game 3 + No Tap 9 | 2 x 300 / 23,336 | 2 x 300 / 27,319 | 0 |
| Competition lane (VBS-T) | 300 / 24,293 | 300 / 26,759 | 0 |
| `RecalcScore` fuzz, 20,000 arrays | | | 0 |
| `GlobCheckSplit`, all 1024 masks | | | identical |
| lane TV `vbsRecalcScore` vs the game | | | 0 |

---

## Machine players

Each machine player has an average (the skill levels are Nybörjare 100, Motionär 130,
Seriespelare 160, Duktig 185, Expert 205, Proffs 222; each player gets ±12 around it,
15 % are left-handed). Every first ball is drawn by category with the rates of real
bowlers of that average - strike, single-pin leave, split, other multi-pin leave,
gutter - and then the exact pins: single pins and splits from the leave tables of the
2024 PBA tour (mirrored for a left-hander), other leaves from a table of common leaves
weighted toward the leave size of that average. Every spare attempt converts with the
published rate for that kind of leave: single pins (the corner pins missed 1.7 times as
often as the others), multi-pin leaves, and each split with its own tour conversion
rate scaled to the bowler's level. So the TV draws real pin pictures, and the numbers
come out as the sources say.

`node tests/bot_stats.mjs 20000 1` - 20,000 games per level through the game's engine:

| Average | Game average | Strike % (target) | Spare % (target) | Open % (target) | Splits per frame % (target) | First-ball pins (target) |
|---|---|---|---|---|---|---|
| 100 | 104.0 | 10.0 (10) | 21.6 (22) | 70.6 (70) | 7.9 (8) | 6.25 (-) |
| 130 | 131.9 | 17.9 (18) | 36.7 (36) | 51.9 (52) | 8.0 (8) | 7.58 (7.4) |
| 150 | 151.5 | 24.7 (24.7) | 47.5 (47.8) | 39.5 (39.3) | 9.6 (9.7) | 8.27 (8.1) |
| 170 | 170.7 | 33.4 (33.3) | 58.7 (58.2) | 27.5 (27.8) | 10.0 (9.9) | 8.57 (8.5) |
| 190 | 189.1 | 43.0 (42.9) | 67.2 (66.4) | 18.7 (19.2) | 9.4 (9.4) | 8.88 (8.85) |
| 200 | 199.4 | 48.7 (48.8) | 71.0 (70.1) | 14.9 (15.3) | 8.6 (8.6) | 9.04 (9.0) |
| 210 | 208.0 | 53.1 (53.1) | 74.3 (73.4) | 12.0 (12.5) | 8.2 (8.1) | 9.17 (9.1) |
| 220 | 220.7 | 60.3 (60.2) | 77.4 (80) | 9.0 (8.1) | 8.0 (8) | 9.34 (-) |

All figures are inside the test's tolerances (average ±6, strike ±1.5 points, spare and
open ±4, splits ±2, first ball ±0.35). The averages also agree with a fit over the NTCA
teams, average ≈ 166 + 102·strike rate − 104·open rate.

Sources:

1. PBA, *Certified Stringpin Statistical Comparisons 2024* (Lanetalk data from the 2024
   PBA National Tour, 176,442 frames): leave frequencies and conversion rates per leave.
   <https://www.pba.com/sites/pba/files/2024-11/Certified%20Stringpin%20Statistical%20Comparisons%202024.pdf>
2. PBA, *Executive Summary: 2024 PBA String Pin Report*, 22 Nov 2024 (tour strike 57.6 %,
   spare 75.7 %). <https://www.pba.com/2024/november/executive-summary-2024-pba-string-pin-report>
3. NTCA (M. D. Kraushaar), *2021-22 NTCA National Statistics - Team Summary Performance
   by Format* (75 teams, about 300,000 frames, 111-210 averages): strike, spare, single-pin
   and multi-pin conversion, splits and open frames by average.
   <https://www.ntcabowling.com/s/1-Season-Statistics-NewNationalDatabase-202122-AllTeams-by-Format-ew4k.pdf>
4. T. Rose, *Breaking Down Barriers: Plotting a Course for 220*, Bowling This Month,
   Nov 2020 (a 220 bowler: 60.2 % strikes, 95.1 % single pins, 8.1 % open frames).
   <https://www.bowlingthismonth.com/bowling-tips/breaking-down-barriers-plotting-a-course-for-220/>
5. Yaari & David, *"Hot Hand" on Strike*, PLoS ONE 7(1):e30112, 2012 (459,423 PBA frames,
   mean strike probability 0.579). <https://pmc.ncbi.nlm.nih.gov/articles/PMC3257263/>

The rows at 150-210 are published [3], 220 is [4]; 130 is between [3]'s teams at 126-137;
100 (and the leave size and gutter rate below 150) are estimates extrapolated from [3],
since no source publishes a beginners' table.

---

## VBS-T formats test

`node tests/vbst_formats.mjs 7` plays **every format in EUR and in AMR** (the 12
dialog formats and all 153 Auto formats: 326 combinations played to the end, 4 not
bookable as in Viking) through the competition engine with machine players, and checks:

* every player bowls exactly the series the movement or rotation deals them, and no
  lane holds more bowlers than a lane can;
* points: a Banpoängsmatch never awards more than 20 (16 lane or lane-pair points and
  4 serie points); Petersen gives 30 per lane (15 + 15 on a tie); Korp 18 shares out
  exactly 18;
* the end result is sorted as VBS-T sorts it;
* hand-checked cases: a Banpoängsmatch 4+4 serie with fixed games (home 2, away 1: one
  lane and the serie tied), a Petersen serie with a tie.

Result: **0 check failures.** The full table (format, mode, players, series, lanes,
teams, points, pins, leader) is printed by the test.

## Other tests

| Test | What |
|---|---|
| `node tests/swipe_test.mjs` | the swipe -> throw mapping with synthetic pointer events: a quicker swipe is a faster ball, a curve left hooks left, a short swipe is no throw; and on a slow device (6, 10 and 20 frames a second: the events handled in bursts, coalesced, the pointer-up a frame late) a swipe throws exactly as fast as at full frame rate, timed by the events' own `timeStamp`; a touch whose pointer stream the browser cancels while it goes on delivering touch events still throws |
| `node tests/physics_tune.mjs` | pin action at the classic impact points (pocket, light, high, head-on, Brooklyn, straight ball) |
| `node tests/shoot.mjs <spec>` | headless Edge screenshots (the specs used are described below) |

## Screenshots

The screenshots are kept locally only: `screenshots/` is in `.gitignore` and is not part
of the published game, so nothing here links to them. `node tests/shoot.mjs <spec>` makes
them again. Locally, `screenshots/` holds every screen of the flow and the play, at desktop (1920x1080),
tablet landscape (1280x800, touch), tablet portrait (800x1280, touch) and phone
(390x844, touch): splash (Swedish and English), the open play menu, the VBS-T menu
(dialog formats and Auto formats), names, aiming, the ball rolling, the pin deck, the
result, the full-size lane TV, the open play summary, the VBS-T names, a Banpoängsmatch
lane and its lane TV with the OnScoring panel, the standings after a serie, the end result,
an AMR game (names, play, a machine player's throw, the pair's other lane TV) and a
Lagspel lane TV with the team-sum panel. Files are named
`<size>_<width>x<height>_<nn>_<screen>.png`. They were taken with headless Edge and
software WebGL (`?gfx=low`, so without shadows); a real GPU draws them with shadows and
at full resolution. They were taken before the review fixes of 2026-11-18 (the splash backdrop,
the phone tables, the full-size lane TV in portrait and the status line have changed
since), so make them again for the current look.

---

## Libraries and licences

| Library | Version | Licence | Where |
|---|---|---|---|
| three.js | 0.180.0 | MIT | `lib/three/` (`LICENSE` beside it); `RoomEnvironment.js` from its examples |
| cannon-es | 0.20.0 | MIT | `lib/cannon-es/` (`LICENSE` beside it) |
| Barlow, Barlow Condensed (fonts, from the Viking lane console) | - | SIL Open Font License 1.1 | `web/screen/console/fonts/` (`OFL-LICENSE.txt`) |

They are installed from npm into `node_modules/` (`npm install`) and copied into `lib/`
by `node tools/vendor.mjs`, because a static host (GitHub Pages) does not serve
`node_modules`. Everything else is VBS Bowling AB's (see `LICENSE`).

---

## Known gaps

* **Pin action is believable, not exact.** In the physics the best line (the ball meeting
  the head pin about 11-12 cm right of centre with 5-6 degrees of entry angle) strikes
  roughly 35-40 % of the time, where real bowlers carry more, and it sits a little right
  of the textbook pocket (6-7 cm). Pocket hits leave the classic corner pins (7, 10),
  head-on hits split, light hits leave the 10-pin side (`tests/physics_tune.mjs`).
  Machine players are not affected (their pinfall comes from the statistics), only the
  human's balls.
* **Fouls** exist in the engine (and are tested) but a swipe cannot foul.
* **Handicap and start points** in VBS-T are 0, except Skånemästerskap, which derives
  the handicap from the average as its dialog does. The equalization serie of Petersen
  (an option in its dialog, off by default) is not offered.
* **Baker lines** (Korp 2 man + baker, the `ba=1` lines of Auto formats) are bowled by
  one machine player with the team's average, frame by frame; the lane TV names the
  member per frame as on a lane.
* **VBS-T pace**: lanes of a NORMAL-movement format are played serie by serie together
  (on a real rig they may run at their own pace); the results are the same, because
  points are only computed in SYNC formats.
* **Practice / warm-up**, the reception's live booking flow and online scoring are not
  part of the game.
* **Five harmless 404s** remain, all for files that are missing in Viking 4.4 itself (or are
  meant to be absent); the lane TV draws without them, as on a lane, and they are left as
  they are:
  1. `v3gfx/Protocols/Viking/*.png` (`Regular.png`, `Viking2001_Grid1-5_Active.png`,
     `Viking2001_Grid1-5_Inactive.png`, `Viking2001_Grid6-8_*.png`, `LeftArrow.png`,
     `RightArrow.png`, `Viking2001_Team_Sums1-5.png`, `RedPin1-9.png`): TakTV's built-in
     Viking protocol asks for a `Protocols/Viking` folder that 4.4 does not install;
  2. `V3GFX/Resource/Pins_On_Protocol/Standard_FHD/BluePin200Red.png`, not in 4.4;
  3. `V3GFX/Resource/Pins_On_Protocol/Standard/Pins_On_Protocol.xml`, not in 4.4: for a sheet
     narrower than full HD the page tries the non-FHD style first, then uses `Standard_FHD`;
  4. `web/screen/common/css/customSettings.css`, the per-hall style override that
     `TakTV.html` loads last and that is normally absent (its own comment says so);
  5. `/favicon.ico` at the site root, which the browser asks for by itself when a file such
     as a RedPin video is opened on its own (the game's pages name their icon).
  The club logos (`v3gfx/Backgrounds/ClubLogos/<team>.png`) are no longer among them: the
  stand-in answers them with `Empty.png` (see "The lane TV").
* The Android emulator check was not done.

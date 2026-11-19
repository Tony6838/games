# Viking Bowling

A 3D bowling game for the browser by **VBS Bowling AB**, built from VBS's own
**Viking Scoring System 4.4**: its scoring and lane logic, its open play game types,
its VBS-T competition formats, its HTML lane TV and lane console look, the blue
Viking helmet of its lane TV and its texts in the five reception languages. You bowl with a swipe of a
finger or the mouse, or on a phone or tablet by swinging the phone; everyone else on the lanes is a machine player whose game
follows published bowling statistics.

© 1995-2026 VBS Bowling AB. All rights reserved (see `LICENSE`). The game is for
training, education, demos and entertainment.

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

URL options for testing: `?gfx=low` (no shadows, lower resolution, the hall's low detail
level), `?detail=high` or `?detail=low` (the hall's detail level, see "The hall"), `?nofs=1`
(never asks for full screen).

### How to play

1. Splash: choose a language with a flag (Swedish is the default; on a phone in portrait
   the five flags share one row on smaller tiles), read the short
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
   alternates every frame). Every game type and competition format is a card: a
   symbol, the name, and one line on what is special about it (see "The game-type
   cards" below); the chosen card has the gold frame. A card is a button, so a tap, a
   click, or Tab and Enter/Space chooses it.
3. Type your name. The machine players get generated names; **Nya namn** draws new ones.
4. Bowl: touch the ball - a hand grips it - then push or swipe towards the pins and let go
   (see "The throw" below). The moment you let go decides:
   * the finger's **speed** as it lets go is the speed of the ball,
   * its **direction** as it lets go is the line,
   * a **curve** just before letting go spins the ball, which hooks in the back end (curve
     left: hooks left, as a right-hander's ball); on a phone, **twisting the phone** as you let
     go spins it too (counterclockwise: hooks left).

   To choose where you stand, **drag the ball slowly** and let go: it moves across the approach
   and back from the foul line (up to 4.4 m) and stays where you let go. The arrow keys do the
   same (←/→ across, ↑/↓ forward and back). At your turn a short hint near the ball says how;
   a press on the lane while you cannot throw says to wait for your turn.
   The ball can end in the gutter. With **Siktlinje** on, the ball's predicted path is
   drawn while you swipe. After every ball its speed is shown at the bottom right in km/h.

   **On a phone or tablet the throw is a swing of the phone** (see "Throwing by swinging the
   phone" below): hold it upright like a remote, keep your thumb on the big **HÅLL - SVINGA -
   SLÄPP** button over the lower part of the screen, aim by turning the phone until the marker
   stands on an arrow, swing your arm back and forward and lift your thumb at the bottom of the
   swing. A short animated demo shows it the first time. The
   swipe stays available: **Kast** in the settings (Auto / Svinga telefonen / Svep).
5. Tap the lane TV to make it full size. ⏩ speeds the machine players up (not your own ball).
   The other lanes in play have small TVs under it (tap one to see it large); see "The TV wall".
6. **Inspelning** (warm-up) in the options: none, balls, frames or minutes before the game; the
   balls are not scored and the lane TV shows the practice box (see "The warm-up"). **Bumpers**:
   tick the box under your name, or a machine player's, on the names screen (see "Bumpers").
7. The **Banterminal** button (*Lane console* in English) opens the **lane console** of each lane
   in play, VBS's own web console: Korrigera (correct a score), Ändra spelare (names, order,
   bumpers), Avsluta inspelning (end the warm-up), Reset/Set (see "The lane console"). The start
   help says so too.
8. After the game: the summary (open play) or the standings after every serie and the
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
| `web/screen/HTML/TakTV/` | installation: `web\screen\HTML\TakTV` (`^/Resource/4.4/web/screen/HTML/TakTV`) | every file is byte for byte the SVN base of `^/Resource/4.4` at **r18742** (the folder's last change is r18727), except four comments that named a hall or a person (one in `TakTV.js`, two in `vbstokens.js`, one in `vbsnameentry.js`; now "seen at a hall", "the rule" or left out). `sample_lane.json`, a sample nothing loads, is left out. Added: `TakTVGame.html` = `TakTV.html` with two script tags (`js/standin/manifest.js`, `js/standin/tv-standin.js`) and a comment |
| `web/screen/TV/media/RedPin*.webm` | installation: `web\screen\TV\media` | the RedPin videos the TV plays |
| `v3gfx/Protocols/` (Standard, Viking Refresh, Viking (cfg), Halloween, Xmas Center), `v3gfx/Resource/` (Objects, ShowPins, Pins_On_Protocol, ShowMessage), `v3gfx/Backgrounds/Blue.jpg` | installation: `v3gfx` | the lane TV's themes and pictures. Ten XML files (`Protocols/Viking (cfg)/protocol.xml`, `Viking2001_CommonInfo.xml`, `Viking2001_StandardGrids.xml`, `Viking2001_TeamInfo.xml` and six under `Resource/Pins_On_Protocol/`) differ from the SVN base r18742 only by one removed comment line, the file's owner (a person's name); every other copied file is byte for byte as in 4.4. Left out: three files nothing asks for (`Resource/Objects/HammerLogo.png`, a third-party logo; `Resource/Objects/Top123.png`; `Protocols/Xmas Center/_Note.txt`) |
| `v3gfx/Backgrounds/ClubLogos/Empty.png` | installation: `v3gfx\Backgrounds\ClubLogos` | the transparent placeholder 4.4 ships, and only that: no hall's club logos. The VBS-T panels ask for `ClubLogos/<team>.png`; the game's teams have no logos, so the stand-in answers every such request with `Empty.png`, as the C++ copies `Empty.png` into place when a team's logo is missing |
| `GameConsole/Languages/*.lang` | installation: `GameConsole\Languages` | the lane TV's texts in the five languages |
| `Reception/vbsTournaments/` (Auto headers, PlayerMovements, OnScoring, OnScoringXml) | installation: `Reception\vbsTournaments` | the competition formats, movements and TV panels; eleven `OnScoringXml/*_FHD.xml` differ only in one comment, where a person's name and a date gave way to "målet" (the aim the comment quotes is kept) |
| `web/screen/console/lang/*.json`, `fonts/`, palette in `css/game.css`, flags in `js/i18n.js` | the web lane console (`touchconsoleLane.*`) | the menus use the console's look, game-type names and flags. The console's game-type pictures (`web/screen/common/img/gametype*.jpg`, small blurred score sheets) are no longer used or shipped: the menu draws its own symbols (`js/menucards.js`) |
| `img/VikingHelmet.webp` | installation: `web\screen\common\img\ClosedLane.png` (the same file byte for byte as `web\screen\console\ErrorPage\helm.png`) | **the splash picture**: the blue Viking helmet of the web lane TV, the background of the info TV that plays the commercials (`web\screen\info`, `common\css\info.css`) and the picture of a closed lane on the web lane console. Cropped to the helmet (the 1000x1000 picture's transparent margin taken off: 1000x592) and saved as lossless WebP (88 KB instead of 375 KB; every visible pixel unchanged). On the splash it sits on the lane console's dark blue with a soft light behind it (`.splashLogo` in `css/game.css`), because the helmet's right horn darkens to almost that blue. The classic `Commercial.exe` shows a different helmet, `V3GFX\Resource\Hjälm_Dont_Move_Or_Edit.jpg` (silver and copper, 640x480). The splash and the info text show no version number |
| `web/screen/console/touchconsoleLane.html`, `js/{TouchConsole,correctScore,startBowling,VBSTchangePlayer,saveMoveGame,touchconsoleLang,touchconsoleLane}.js`, `touchconsoleLane.css`, `lang/`, `fonts/`; `web/screen/common/js/{commonAPI,vbskeyboard,vbscursor}.js`, `common/js/bootstrap/{jquery-3.7.1.min,bootstrap.min}.js`, `common/css/vbskeyboard.css`, `common/img/{CustomLogo,checked_Pin,checked_PinBig,unchecked_Pin,noPin,customButton,LeftArrow,RightArrow}.png` | installation: `web\screen\console`, `web\screen\common` (`^/Resource/4.4`, SVN base r18742) | **the lane console**, byte for byte, except three comments that named a person or a hall (two in `commonAPI.js`, one in `startBowling.js`; now "at a hall" or left out). Added: `touchconsoleLaneGame.html` = `touchconsoleLane.html` with one script tag (`js/standin/console-standin.js`), the phone sizing (a `<style>` block and a small script, see "The lane console") and comments; `custom.html`, the hall's own "Kundens meny" page, is the game's placeholder (a hall writes its own; 4.4's sample opens an external site) |
| `js/engine/correction.js` | `Slave/LOADCOM/LoadComWebInterface.cpp` (`GetPlayers`, `GetPlayerScore`, `ChangeScore`, `ApplyScoreCorrection`, `CorrectionFitsLane`, `CorrectionSeesAllBalls`, `ActiveBowlerWithBallLeft`, `MoveActiveMarkOffCompletedSeries`, `ChangePlayersInfo`, `PlayerListFitsLane`, `BowlerThePageNeverSaw`), `shared/lanedata/GCI_info.cpp` (`SetChangedFlagInStatus`, `GlobIsFirstBall`, `GlobCreatePinConfig`), `Slave/OPENPLAY/ComIn.cpp` (`GC_CONSOLE_REFRESH`) | ported; the correction is proved against the C++ (see "The scoring proof") |
| the warm-up in `js/engine/openplay.js` | `Slave/OPENPLAY/TestFrames.cpp` (`TestFrames_Init`, `TestFrames_Score`, `TestBalls_Score`, `CleanPractice`, `CorrectActivePlayer`, `AdvancePracticePlayer`, the end of `TestFrames_UpdateClock`), `CGame::Score`'s dispatch, `Slave/LOADCOM/ComIn.cpp` (`StopPractice`, `EndPracticeOnLaneData`, `IsPractising`), `LanedataUtil` (`IsWarmUpBeingPlayed`, `PracticeSecondsLeft`, `FirstBallOfSerie`) | ported |
| `js/game/tvmedia.js` | `CGame::RenderScreen2`, `CGame::MyCGamePlayAnim`, `CMultimedia::GetRandomMedia`, the media `.ini` of `shared/graphics/prio.cpp` | ported (see "The TV animations"); the animations themselves are the game's own (`web/screen/TV/media/*.webm`, `tools/make_tv_media.mjs`) |
| the bumper rule | `CGameAbstract::adjustBumper`, `CProtocol::IsBowlerUsingBumper` (the `+C` mark), the console's `plusCCC` / `PlusC` | ported; the rails and their physics are the game's own |

No C++ source is in this folder. The scoring harness, which compiles the C++, is kept
outside it (see "The scoring proof").

## What is new

* The 3D lanes, pins and ball, the camera and the effects (`js/sim3d/scene.js`), and the
  bowling centre around them (`js/sim3d/hall.js`, see "The hall"); three.js, everything
  modelled and textured in code.
* The lane physics (`js/sim3d/physics.js`, cannon-es for pin-deck collisions): the ball's
  contact with the lane is modelled as sliding friction against the slip of the contact
  point, with a 40 ft oil pattern, so a ball with side rotation skids in the oil, hooks
  in the dry back end and rolls out; ball-pin and pin-pin impacts are impulses along the
  real pin outline (the USBC profile) with its rotational inertia.
* The swipe input (`js/sim3d/input.js`), the machine players (`js/ai/bots.js`), the
  flow and the screens (`js/main.js`, `index.html`, `css/game.css`) and the game's own
  texts in five languages (`js/i18n.js`).
* The load bar on the splash (`js/loading.js`, `css/loading.css`): until the game has
  started, the splash shows the helmet, the title and a gold bar with "Laddar … n %" instead
  of the flags, the help and **OK** (empty, the help box looked like a progress bar that never
  moved). The figure is the share, by size, of the files the splash waits for that have
  arrived (the browser's resource timing against `js/loadsizes.js`: the static import graph
  of the page's modules, its style sheets and the helmet, each with its size), and fills 85 %
  of the bar. The rest is `main.js` building the hall, when the page cannot draw: the bar
  then moves on by an animation the browser runs off the main thread, and the number fades
  out. A file that does not load turns the bar red: "Spelet kunde inte laddas …". After a
  change to the JavaScript, run `node tools/make_loadsizes.mjs` (`npm run loadsizes`);
  `tests/loading_test.mjs` says when the list is out of date (an old list only makes the
  bar's steps uneven).
* The sound of the hall and its people, all synthesised in the browser (`js/audio/`, see
  "The sound").
* A machine player's ball is planned and bowled in 3D so the pins fall as its drawn
  pinfall says: the ball is aimed (by simulating the release) at the spot that leaves
  that leave, the pins that must stay up cannot be knocked down, and a pin that should
  fall but was not hit falls late, as a messenger would take it.
* The TV wall's compact score view and its wiring (`js/game/scoreview.js`, `tvwall.js`), the
  console's frame (`js/game/consolehost.js`), the bumper rails and their colliders
  (`js/sim3d/bumpers.js`, `physics.js`), the TV animations (`web/screen/TV/media/*.webm`), the
  game's event emitter (`js/game/events.js`) and the module that puts these into the App
  (`js/game/wallgame.js`).

## The game-type cards

The menu shows every game type as a bright card (`js/menucards.js`, styles under
`.gameTile` / `.fmt` in `css/game.css`): a symbol drawn in SVG on a badge coloured by
family, the name large (the lane console's own text where it has one: `game.normal`,
`game.369`, `game.mini`, `game.10thFrame`), and one line on what is special about the
game, in the five languages (`gd*` keys in `js/i18n.js`). Each line states the rule as
the engine scores it:

| Game | Symbol | Line (sv / en) | In the engine |
|---|---|---|---|
| Vanlig bowling | a pin | 10 rutor, bonus för strike och spare / 10 frames, bonus for strikes and spares | `recalcScore` |
| 3-6-9 | 3-6-9 | Strike ges i ruta 3, 6 och 9 / Strikes are given in frames 3, 6 and 9 | squares 4, 10, 16 are set to 10 (`score`, `refreshGame`) |
| Mini Bowling | 0 > X | Ett missat klot räknas som strike eller spare / A missed ball counts as a strike or spare | a first ball with no pins (or a foul) is a strike, a second ball with no new pins (or a foul) a spare |
| 10th Frame | a frame with 10 | Bara ruta 10 spelas / Only the 10th frame is bowled | `activeSquare` starts at 18 |
| No Tap 9, 8, 7, 6 | 9=X ... 6=X | 9 käglor räknas som strike / 9 pins count as a strike | N or more pins on the first ball become a strike |
| Short Game 2, 3, 4, 5 | 9-10 ... 6-10 | Spelet börjar i ruta 9 ... 6 / The game starts at frame 9 ... 6 | `checkShortGame`: start square 16, 14, 12, 10 |
| Classic Frame Game | X=30 | Strike = 30, spare = 10 + första klotet / Strike = 30, spare = 10 + first ball | `recalcScore(..., isCFG)`; no bonus balls in frame 10 |

The VBS-T cards show teams (white against gold, with the team size: 4+4, 8+8, 3+3, 2+2;
four teams for Lagspel), one player (Individuell, Skåne with HCP) or everyone against
everyone (Petersen), and the format's own line (`sub` in `js/vbst/predefined.js`). The
Auto list uses the same card with a smaller symbol (a team or a player, from the
header's team rows). The cards replaced the lane console's blurred score-table pictures,
which made the whole menu dim. A card is a `<button>` with `aria-pressed`; the chosen one
has the gold frame. On a phone the line runs under the symbol and the open play cards
stay in two columns; on a short screen (a phone held sideways) the cards are tighter. On a phone (and a
short screen) the VBS-T formats and the options under them scroll together, so the list gets the
screen's height (at 390 x 844 it showed three and a half cards over the options); the format tabs and
the search stay at the top.

## The hall

`js/sim3d/hall.js` builds the bowling centre around the game's lanes, entirely in code:
geometry and canvas textures drawn at load, no models and no texture downloads. The only
pictures it uses are the lane console's own `web/screen/common/img/helm.png` (the helmet) and
`vbs_logo.png`. It adds one script of 60 KB (19 KB gzipped), and about 5 KB in `scene.js`
for the lane and approach wood, to the download, and nothing else.

**Layout, to a real centre's dimensions (USBC).**

| Part | What it is |
|---|---|
| Lanes | the game's lanes are lanes 5 and 6, at the same place as before; the hall has lanes 1-18 on the high level and 1-10 on the low level. 41.5 in (1.054 m) lanes of 39 boards, 18.29 m from the foul line to the head pin, 9.25 in gutters, the capping between the lanes, a 4.6 m approach |
| Markings | the foul line, with the foul-light units on the capping; the approach dots 2-6 in, 12 ft and 15 ft behind the foul line; the guide dots at 7 ft; the seven arrows between 13 and 15 ft as a V pointing at the pins; the range finders at 34 ft; the pin spots, 30.48 cm apart |
| Pin decks | the neighbours' pins (the real outline, instanced), racked or with a leave standing; the kickbacks up to the masking units, the pit and a black curtain behind the pins |
| Masking units | one lit band across the hall: a Viking night mural (aurora, mountains, a longship, the helmet, VBS Bowling, and VIKING · BOWLING over the game's lane pair) with each lane's number on a gold-rimmed plate (none below lane 1); a cyan neon line, the pin-deck lamp under the band and a soft glow; above it the fascia with the VBS honeycomb and a VIKING BOWLING neon sign |
| Lane TVs | one per lane, over the start of the lanes, angled down; the playing lane's TV is larger, with a gold frame and a halo. They show still score sheets, and the VIKING BOWLING screen over the game's lanes, until a lane's own score is drawn on them (see the API below) |
| Lane pairs | every pair has its ball return between its two lanes at the back of the approach (the hood 3-4 m behind the foul line, the hand dryer, the rack with three balls) and its scoring console behind it |
| Ceiling, walls, floor | a dark tiled ceiling with four rows of light valances (the boards that hide the lamps from the bowlers, a warm lamp line under each, the lit ceiling behind them); side walls of fabric panels with cyan and magenta neon and lit VBS panels; a cosmic bowling carpet behind the approach; on the high level tables, settees, a back wall and a bar from 9 m behind the foul line |

**Materials and light.** The lane is maple on the heads and the pin deck and pine down the
middle, joined by dovetails (a synthetic lane prints the same pattern), with grain; the
approach is maple boards in line with the lane's. The finish is a clear coat whose gloss
follows the oil: glossy over the 40 ft pattern, duller on the dry back end (a clear-coat map).
The lane and the balls reflect an environment map rendered once from the hall; on the high
level the lanes also mirror the pin decks, the masking units, the TVs and the lamps (a planar
reflection at half resolution, weighted by the Fresnel term and weaker on the dry back end).
The valances' light on the lanes and the brighter pin decks are a light map, not extra lamps;
the masking band, the TVs, the neon and the lamp lines are emissive, so the hall is dark and the
lanes glow. Shadows: on the high level the pin-deck lamp casts its soft shadows as before; every
ball has a soft contact shadow (a blob) on the lane, the approach and in the gutter; on the low
level the pins have blobs too and no shadow pass is drawn.

**Life.** Every 3.5-9.5 s a ball rolls down a lane two to seven lanes from the game's lanes:
the pins fall, the rake sweeps, the table lifts the leave or lowers a new rack. It is seeded, so
it plays the same way every time; it never touches the game's physics or sound, and it runs
only while the 3D view is drawn.

**The camera.** The aiming view is at a bowler's eye height, 1.6 m (1.65 m in portrait),
3.2 m (3.6 m) behind the ball wherever the player stands, with the game's field of view
(`scene.aimView(laneX, portrait, stanceZ)`). Following the ball and the pin view are unchanged.
The consoles, tables and settees stand behind the camera at every stance.

### Detail levels

| | High | Low |
|---|---|---|
| Lanes | 1-18 (4 left of the game's lanes, 12 right) | 1-10 (4 and 4) |
| Lane reflection | planar mirror and environment map | environment map |
| Pin shadows | the pin-deck lamp's soft shadow map | blobs, no shadow pass |
| Tables, settees, bar | yes | no |
| The pin crash (the physics) | in real time | at most 8 ms of it a frame (or half the frame interval, when frames are slower anyway, as with a software renderer): on a CPU that cannot keep up it plays a little slower than real time instead of stalling frames (the same 1/360 s sub-steps: the physics is unchanged) |
| Draw calls a frame (shadow and reflection passes included) | 105 | 46 |
| Triangles a frame | 183,000 | 53,000 |

Before the hall the game drew 143 draw calls and 79,000 triangles a frame.

"Auto", the default, picks the low level on phones and tablets, on four CPU cores or fewer,
with `?gfx=low` and on a software renderer, and the high level otherwise; on "auto" a device
that draws the high level at under about 26 frames a second (the median of 90 frames) drops to
the low level once, by itself. The level is a setting, **Grafik** (Auto / Hög / Låg), in the
options of open play and of VBS-T, saved with the other settings; changing it rebuilds the hall
at once. `?detail=high` or `?detail=low` in the URL overrides it (for tests).

**Frame cost.** Measured with headless Edge on an Intel UHD Graphics 770 (an integrated GPU,
Direct3D 11): the time to draw one frame of the aiming view and wait for the GPU (the render
and a 1-pixel `readPixels`), the median of 60 frames and of two runs, with the GPU's own time
from `EXT_disjoint_timer_query_webgl2` in brackets. The display caps the frame rate at its
refresh rate (60 Hz), so these say how much room is left: under 16.7 ms is a steady 60 fps.
Software WebGL (SwiftShader, the path the earlier screenshot runs used) is slow whatever the
scene; "auto" picks the low level there.

| Size | Before the hall | High | Low |
|---|---|---|---|
| 1920x1080 | 12.6 ms (GPU 10.1) | 11.4 ms (8.8) | 9.6 ms (8.1) |
| 1280x800 | 6.5 ms (4.7) | 9.4 ms (6.8) | 6.6 ms (5.4) |
| 800x1280 | 7.2 ms (5.0) | 8.5 ms (5.6) | 6.0 ms (4.3) |
| 390x844 | 5.6 ms (2.7) | 5.8 ms (4.3) | 4.5 ms (3.2) |
| 844x390 | 5.7 ms (2.3) | 7.0 ms (5.4) | 5.4 ms (3.8) |
| 390x844 at a phone's 1.5x pixels (585x1266) | 8.7 ms (6.8) | 7.7 ms (5.3) | 6.7 ms (4.5) |
| 390x844, the CPU slowed down 4x | 9.9 ms (3.6) | 10.6 ms (5.4) | 4.6 ms (3.0) |
| 1920x1080, software WebGL | 775 ms | 1247 ms | 467 ms |
| 390x844, software WebGL | 123 ms | 141 ms | 99 ms |

No phone was measured. A mid-range phone's GPU is roughly a third of this one, which puts the
low level at about 15-20 ms a frame at a phone's resolution (50-65 fps), the high level a
little slower.

**The pin crash on a phone's CPU.** The ten pins' contacts with the deck and the walls (cannon-es)
cost about 0.15 s of CPU per simulated second on the test PC; at 390 x 844 with the CPU slowed four
times the player's ball had frames of 80-160 ms at the 99th percentile while the pins fell. Fewer
solver iterations were tried and not kept: the solver is under a tenth of that time (the contact
search between the pins' convex pieces and the deck is the rest), and fewer iterations change the
play: over 200 pocket hits 32.5 % strikes at 24 iterations and 41 % at 10 (40 throws per impact point
at 6 iterations: the Brooklyn from 3 % to 15 %), with no time saved. The low level instead gives the
crash 8 ms a frame, or half the frame interval when frames are slower anyway (a software renderer's
100 ms and more: there the crash keeps real time) (`step(dt, budgetMs)` in `physics.js`):
the 99th percentile frame during the player's ball is now one or two of the display's frames (13.5-26.6 ms;
before 67-160 ms), 16-17 frames over 50 ms per four balls instead of 31-63, and the crash ran at 70-100 %
of real time
(`tests/physics_tune.mjs` checks that the budget only takes time away: one that runs out at once is
exactly one sub-step a frame; over 200 pocket hits stepped that way 30.5 % strikes, in 1/60 s frames
32.5 %, in 1/75 s frames 36 % - the same within the ±6.5 points of 200 throws). A machine player's
ball is planned with 18 simulated releases (`LanePhysics.aim`, about 90 ms on the test PC): that is the
one long task of about half a second per run with the CPU slowed four times.

### The hall's API, for drawing each lane's own score on its TV

| Call | What it does |
|---|---|
| `scene.hallLanes()` | the hall's lanes, `{ index, number, x, game }`. `index` is the lane's place in the hall: 0 is the game's first lane (slot 0), 1 the next one (slot 1), -1 the lane to the left of lane 0 |
| `scene.laneIndexOf(number)` | the index of the lane with this number on its masking unit, or `null` |
| `scene.setLaneTvTexture(index, source)` | puts a canvas (or a `THREE.Texture`) on that lane's TV. Draw on the canvas and call it again with the same canvas to show the new picture; `null` gives the hall's still picture back. The screens are made for `scene.laneTvSize`, 512 x 288 (16:9) |
| `scene.setActiveLane(index)` | the playing lane's TV is the large, framed one; `main.js` calls it with the active lane's slot every frame |
| `scene.setDetail('auto' / 'high' / 'low')` | the detail level; `scene.detail` is the level in use, `scene.autoLevel` the one "auto" picked |

## The throw

`js/sim3d/input.js` turns a gesture into a throw. A press on the lane **grips the ball at
once**: a hand holds it (an SVG drawn for the game over the ball, thumb and two fingers in the
holes, following the ball as the camera sees it). Everything is decided **when the finger
lifts**, by its release velocity: how it moved over the last **70 ms** before the lift (four
samples of a 60 Hz touch screen; a longer window mixes a late flick with the drag before it).

| Gesture | What it does |
|---|---|
| push or swipe up towards the pins and let go while moving | throws: speed and line from the release velocity, spin from the curve near the release |
| drag slowly (the ball follows the finger while it moves slower than 120 mm/s) and let go | no throw: the ball stays where it was let go - that is how you choose where to stand (across the lane, up to 4.4 m back from the foul line) |
| let go moving sideways (more than 50° off straight up the screen) or backwards | no throw; the ball stays |
| stop, then lift (no movement in the last 100 ms) | no throw; the ball stays |
| a forward release slower than 50 mm/s | no throw (it is a slow drag); the ball stays |
| a quick forward flick shorter than 17 mm | "För svagt" (too weak); the ball stays |
| ←/→, ↑/↓ | move the ball across, forward and back |

A quick stroke does not drag the ball with it (the clutch slips above 120 mm/s): a throw starts
from where the ball stood, and the stance stays there for the next ball. The pull-back power of
the earlier swipe is gone: dragging back now moves the ball, and only the release counts.

**Line.** The direction of the release velocity, 0 straight up the screen, times 0.05 (at most
0.06 rad): 10 degrees off straight is 0.0087 rad, 16 cm at the head pin; the pocket for a
straight ball from the middle is a release 4 degrees to the right. A curve turns the release
direction as well as spinning the ball, so a hook is released aimed right and curved left, as a
bowler plays out and lets the ball come back.

**Spin.** The heading's turn between the two halves of the path's last 30 mm before the release:
a dead zone of 0.05 rad (3 degrees), then 28 rad/s of side rotation per radian, scaled with speed
as below (`sideFactor`); a straight push gives none. On a phone, a **twist of the phone** at the
release adds to it: the rotation about the axis through the screen over the last 180 ms
(counterclockwise as you see the screen = a right-hander's release = hook left), mapped as the
swing's wrist turn (8 degree dead zone, then 18 rad/s per radian); curve and twist together are
clamped to 20 rad/s before `sideFactor`. The twist is read from `devicemotion` only where the
events come without asking (Android) or were allowed on this page already (iOS, the swing's
card) - never a permission prompt - and only while a throw can come. The axis: what the swing's
tracker found from its data (`FRAMES`), else Chromium's order (`rotationRate.gamma`, checked with
the sensor emulation: a gyroscope z of +3 rad/s arrives as gamma +171.9 deg/s), and the standard's
`alpha` on iPhone and iPad (not tried on a device). Without the sensor the spin is the curve's.
A gentle curve (15 degrees over the end) gives about 5 rad/s on a 7 m/s ball, 17 cm of hook at
the pins; the drawn ball turns with its side rotation from the release on (also while it is
carried up the approach from a stance behind the foul line).

**On the screen** (`js/game/modehint.js`, `css/modehint.css`): at the player's turn a short hint
near the ball - under it, or beside it when the status line is right below it (a phone on its
side), clear of the status line, the buttons, the TVs, the ball speed and the aim line - says
**Ta tag i klotet och släpp i kastriktningen · Dra långsamt för att flytta** (with the swing:
**Kasta med den stora knappen · Dra klotet långsamt ovanför knappen för att flytta det**, above
the swing button). It shows at once at the first three turns of a page; later it comes back at
once after a gesture that did not throw (the ball moved, a tap, too weak) and the next two turns
after "too weak", and otherwise after 5 s of a turn without a throw. While the ball is held the
hand is the sign; while no throw can come (the ball rolling, the pins, the pinsetter, a machine
player's turn, the console or another screen) there is no hint, and a press on the lane shows
**Vänta tills det är din tur** above the finger for a moment.

**Speed.** The finger's release speed (above) is measured in
millimetres per second, CSS pixels divided by the device's pixels per millimetre (about 6 on
a phone, 5.2 on a tablet, 4 on a desktop or laptop touch screen; a mouse counts as a finger
on a phone), so the same finger speed gives the same ball on a phone, a tablet and a desktop,
in portrait and in landscape (`tests/swipe_test.mjs`: within 3.4 % over nine real devices).
The launch speed follows the finger speed on a logarithmic curve, `3.3 + 1.42 ln(f / 50)` m/s,
from 50 mm/s (a slower release does not throw) to 2000 mm/s:

| Finger speed (mm/s) | ≈ CSS px/s on a phone | Launch (m/s) | Foul line to head pin (s) | Ball speed shown (km/h) |
|---|---|---|---|---|
| 50 | 300 | 3.3 | 6.9 | 9.4 |
| 170 | 1000 | 5.0 | 4.1 | 15.9 |
| 400 | 2400 | 6.25 | 3.2 | 20.5 |
| 700 | 4200 | 7.05 | 2.8 | 23.4 |
| 1200 | 7200 | 7.8 | 2.5 | 26.2 |
| 2000 and more | 12000 | 8.5 | 2.2 | 29.0 |

Before, the speed was taken in viewport heights per second and capped at 10.2 m/s (35 km/h,
1.84 s to the pins); a phone reached the cap at about 4200 px/s in portrait and 1900 px/s in
landscape, so nearly every real swipe gave the same, too fast ball. At 700 mm/s, where the cap
began on a phone in portrait, the ball is now a third slower (1.5 times as long to the pins).
The speed is timed by the events' own clock: a slow device that handles a swipe's events late
and in bursts throws exactly as fast, and a rest before a quick flick (a still finger sends no
events) is not counted as part of it.

**Hook.** The curve (and a phone's twist) gives up to 20 rad/s of side rotation, scaled by
`0.69 (v / 7.05)^0.6` for a ball of launch speed v (`sideFactor`): a quicker arm turns the ball more, but
less than in proportion, so the same curve hooks further and enters the pins at a steeper
angle on a slower ball, and a faster ball drives through straighter.

**Deflection.** A standing pin is pressed onto the deck by its weight and held by the friction
under its base, so a slow ball meets it as a heavier pin and is pushed aside more; a ball that
comes in hard throws the pin off its base at once and meets a free pin (`pinHold` in
`physics.js`: the pin counts `1 + 2 (6 / v - 1)` times its mass in the ball's impulse below
6 m/s against the pin, the pin itself leaves as a free pin would, energy is only lost). At the
pocket (6.5 cm right of the head pin, the side rotation a strong curve gives, 300 and 150
balls per speed):

| Launch (m/s) | Ball at the head pin (m/s) | Deflection off the head pin, before / now (deg) | Pushed aside through the deck, before / now (cm) | Strikes, before / now |
|---|---|---|---|---|
| 5 | 4.0 | 9.2 / 12.7 | 7.5 / 14.6 | 13 % / 1 % |
| 6 | 4.9 | 10.7 / 11.3 | 9.9 / 9.8 | 32 % / 10 % |
| 7 | 5.8 | 9.1 / 9.4 | 9.9 / 9.7 | 39 % / 39 % |
| 8 | 6.7 | 9.4 / 9.4 | 8.5 / 9.4 | 48 % / 42 % |

A slow ball deflects more and leaves the 7, the 10, 7-10 and 4-7-10 more often; from about
7 m/s (23 km/h on the readout) the ball drives through as before.

**Where you stand.** The stance is only where the bowler starts, as on a real approach: the
ball is carried straight up the approach on that board (drawn rolling at the release speed,
without touching the lane's physics) and released at the foul line. So the lane, the line,
the hook, the speed and the aim line are the same wherever you stand; the camera stands
behind the ball (`scene.aimView(laneX, portrait, stanceZ)`).

**Ball speed.** After every ball, the player's and the machine players', the bottom right
corner shows the ball speed as a lane measures it: the average from the foul line to the pins
in the lane's true scale (18.29 m to the head pin). The same value goes into the lane file as OpenPlay
writes it (`ballSpeed[]` in km/h x 100; the bowler's `amrLeague.ballSpeed` and the lane's `lastBallSpeed`
in mm/s, the pinsetter's unit, which TakTV turns back into km/h), and the lane TV shows it when "Visa
klotfart" is on. ⏩ speeds up the machine players' balls,
never the player's own. The machine players are unchanged: their pinfall is drawn from the
statistics first, and their balls are released at the foul line as before.

## Throwing by swinging the phone

`js/sim3d/motion.js` (sensors, analysis, the swing button), `js/sim3d/motiondemo.js` (the demo),
`css/motion.css`; the mapping onto a throw is `motionParams` in `js/sim3d/input.js`.

**The gesture.** Hold the phone upright in one hand like a remote: its long side along the
forearm, the screen towards you, the thumb on the big **HÅLL - SVINGA - SLÄPP** button, which
covers the lower part of the screen (centred, so either thumb finds it without looking). Press
and hold, **aim** (the button says **SIKTA**: turn the phone a little, and a marker moves over the
lane's arrows, with the aim line, until it stands on the arrow you want), swing the arm back (that
locks the aim: **SVINGA!**), swing it forward, and **lift the thumb at the bottom of the swing**:
letting go of the button is letting go of the ball, and the sensors alone never throw.
The volume keys are not used (browsers do not give them to pages). Moving the ball works as
with the swipe: grip it above the button, drag it slowly and let go, or the arrow keys (a quick
release on the lane does not throw: a hint says to use the button).

**When.** The **Kast** setting (open play and VBS-T): **Auto** (the default) swings on a phone or
tablet (the browser says Android, iPhone, iPad or iPod) that delivers motion events and swipes
everywhere else; **Svinga telefonen** and **Svep** force one. With the swing, a swipe on the lane
does not throw (a hint says how it is done). The first time, a short animated demo shows the
delivery (below); its **Spela** is also the tap with which iOS asks for the sensors
(`DeviceMotionEvent.requestPermission` and `DeviceOrientationEvent.requestPermission`, both asked
inside the tap). iOS asks again on every new page, with a small card. The swing is ready at the
first gyroscope event: the first events come while the game starts, when the page is at its busiest,
and are not judged. Back to the swipe, with a note: the permission refused, or a request for it not
answered within 12 s (a "granted" that comes later still brings the swing back and takes the note
away); no gyroscope event at all within two seconds; no gyroscope; a stream too slow or stalled to
follow a swing - two presses in a row with fewer than 20 events in the last second (a quick tap with
the sensors running is not counted). "Auto" then stays on the swipe on that device at once for a
refusal or a missing gyroscope, and for the others only when it happens on two pages in a row (a
press the sensors followed clears the count); choosing **Svinga telefonen** tries again. Motion events
need https or localhost.

**No dead button.** The release is heard on the whole window, not only on the button: a finger that
slid off it, a touch the browser took over (`pointercancel`, then touch events: the thumb is the touch
that started on the button, whatever other fingers rest on the screen), all release it; the page
hidden (an app switch), the window losing focus or the pointer capture lost cancel the press. A long
hold keeps every sensor sample from the press on (up to 60 s), so aiming slowly for many seconds still
throws where the marker stood. The sensors are stopped on the menus, the standings and the summary
and after 20 s without the button (the machine players' turns), and started again at the player's
turn without a new card. On a phone held upright the HUD's buttons go above the swing button while it
shows (two columns at the left edge, clear of the arrows), not inside it where a left thumb rests.

**Calibration.** The first press, and the first press after the screen turned between portrait
and landscape, says **Håll stilla …** for half a second (the gyroscope's offset and gravity).
Upright is the agreed grip; a phone held on its side is allowed (it is calibrated for that, and a
tip says upright is the grip once). In full screen on Android, the swing locks the screen upright
(`screen.orientation.lock('portrait')`, a refusal is ignored); a turn during a swing is ignored.

**What the swing gives.** Measured with the gyroscope (the rotation rate) and the accelerometer
(gravity at rest, and its sign), in the phone's own frame, whatever the grip:

| | from | mapping |
|---|---|---|
| speed | the forward swing's rate about the shoulder's axis, the highest mean over 45 ms | on the swipe's own curve: 73 deg/s is the weakest swipe (3.3 m/s), 900 deg/s and more the fastest (8.54 m/s), log-log between (`motionFingerMmS`) |
| aim | how far the phone turned about the vertical while held after the press (smoothed over 120 ms for the marker); the backswing locks it (turning about a level axis faster than 60 deg/s for 40 ms), at the mean over the 250 ms before | 1 board at the arrows (15 ft) per degree, board 5 to 35 (boards counted from the right); the launch angle is the line from the ball's board to that point (`aimAt`): a straight swing follows the aim exactly |
| pull, push | how far the phone turned about the vertical during the swing, from the lock to 180 ms before the release, the swing's own turning left out | an error on top of the aim: 5 degree dead zone, then 0.03 rad per radian (a 20 degree pull: 0.008 rad, 3.6 cm at the arrows) |
| hook | the wrist's turn about the arm in the last 180 ms | 8 degree dead zone, then the swipe's 18 per radian, scaled with speed as the swipe's |
| release timing | the arm's angle at the release: past the bottom of the swing (the forward swing's fastest point) it is measured from there; still speeding up, from the vertical: the arm's angle at the press or, with the agreed grip, where the phone's top points down (so aiming chest high works too), whichever is nearer | -10 to +30 degrees: no error; then up to 3 boards at the arrows over 40 degrees more, early to the right, late to the left |
| no throw | no backswing and forward swing, let go during the backswing, or 0.4 s after the swing ended (swing and hold to call it off) | a hint; too slow or too short a forward swing is "För svagt" |

| forward swing (deg/s) | 100 | 150 | 200 | 300 | 450 | 600 | 900 |
|---|---|---|---|---|---|---|---|
| launch (m/s) | 3.95 | 4.80 | 5.40 | 6.24 | 7.08 | 7.68 | 8.50 |
| lane shows (km/h) | 11.8 | 15.0 | 17.3 | 20.4 | 23.5 | 25.7 | 28.8 |

A small swing (a 30 degree backswing, about 120 deg/s) gives about 13 km/h, a full free swing from
shoulder height (about 300 deg/s) 20 km/h, a hard one 25-27.

| let go (arm from vertical) | -42° | -35° | -25° | -15° | -7° to +32° | +44° | +54° | +60° |
|---|---|---|---|---|---|---|---|---|
| line error at the arrows (boards) | 2.6 right | 2.0 right | 1.4 right | 0.35 right | 0 | 0.8 left | 1.7 left | 2.2 left |

How it is worked out, and why: the swing's axis is the direction across every "up" of the swing
(a level swing turns "up" about its axis and never along it; turning the phone towards the target
and the wrist's turn turn it about "up" itself), which a fit to the gyroscope's own axis is not;
"up" at the press is gravity if the phone was still for 200 ms, else the orientation event's (a
gyroscope integrated through the time between turns drifted 30-40 degrees in the tests);
through the swing "up" follows the gyroscope alone. Two platform conventions are checked from
the data: which of `rotationRate`'s alpha/beta/gamma is which axis (Chromium, desktop and
Android, gives alpha = x, beta = y, gamma = z: the default; a mapping that predicts how gravity
turns better while the phone is handled wins) and the sign of `accelerationIncludingGravity`
(against the orientation event's beta/gamma). For the agreed grip the swing comes out about the
phone's short axis, x (the unit test checks it). Every throw the player releases, swipe or
swing, is the game event `throwRelease` (`js/game/events.js`). `?motiondebug=1` shows the live
sensor values and the last swing's analysis on the screen.

**The demo.** The first time a game starts with the swing on a phone or tablet: one delivery
drawn in SVG (no video), looped, with the caption of each step: 1 the phone upright in one hand,
thumb on the button; 2 press and hold; 3 **Sikta: vrid telefonen lite tills markören står på
pilen, svinga sedan rakt** (a small lane seen from behind, top right, where the marker slides onto
an arrow and stays); 4 swing back; 5 swing forward; 6 lift the thumb at the bottom of the swing,
and the ball rolls away down the lane on the aimed line; and the line **Släpp vid botten av
svingen** with what early and late do. **Spela** and **Hoppa över** end it at any time; **Visa
svingdemo** in the settings plays it again. With `prefers-reduced-motion` the six steps are still
frames. The safety note (hold the phone firmly, a wrist strap, room around you) is in
it the first time.

**Tests.**

| Test | What |
|---|---|
| `node tests/motion_test.mjs` | synthetic traces of a rigid arm and phone (`tests/motion_traces.mjs`) through the page's own tracker and analysis: slow to flat-out swings (monotone, the swipe's range), 30 and 60 Hz, four grips, the aim (held then a straight swing gives exactly the aimed line, aim plus a pulled or pushed swing gives the aim plus the error, a wobbling hand is smoothed, the board 5-35 range, the stance, chest high), the pull and push (dead zone, left and right, before and in the forward swing), the hook, both together, noise, jitter, dropped samples and a gyroscope offset (20 seeds: the ball goes where the marker stood), hesitant and unusual swings, the cancels, the release timing (on time, early, late, chest high), the platform conventions; the swing button with a stand-in page: a 10 s hold keeps the aim, ready at the first gyroscope event, a stall while the game starts never counts against the sensors, slow sensors (5 Hz, a stalled stream) fall back to the swipe after two presses, "unavailable" remembered only for a refusal or the second page in a row, no data at all given a second round, a permission request never answered, and one granted after the timeout (the swing back, the miss forgotten), a press never stuck (a touch taken over by the browser with another finger resting, the page hidden, focus lost, the capture lost, a release beside the button), the sensors off on the menus and after a long wait; 382 checks |
| `node tests/motion_browser.mjs [url] [outDir]` | headless Edge with phone emulation and Chromium's sensor overrides, fed a swing in real time while the button is touched: the default, the demo, nine throws (speed, aim with the live marker read while held and after the lock, pull, hook, timing, cancels), placing, a swipe that does not throw, the swipe chosen; iPhone with `requestPermission` mocked granted and denied; the demo at 390x844 and 800x1280 in Swedish and English (steps, skip, replay, reduced motion); a desktop that swipes; **E** no dead button: a touch taken over by the browser with another finger resting, the page hidden, focus lost, the capture lost, a release beside the button, placing afterwards, a 9 s hold that keeps the aim, no `devicemotion` listener on the menu, a stalled stream (two presses) and 5 Hz sensors (the swing at first, the swipe after two presses, on two page loads) falling back to the swipe, an iPhone permission request never answered, and one granted after the timeout (the swing back, the note gone). `ONLY=ABCDE` picks scenarios |
| `node tests/motion_android.mjs [port] [outDir]` | (`adb` from the PATH, or `ADB=<path>`) Chrome on Android in the emulator (AVD `vbs_tablet`): the emulator's own sensors set through its console (`tests/emu_console.mjs`) reach `devicemotion`, and the scripted swings throw; needs `adb reverse` (done by the script) so that the page is on localhost |

**Testing it on a real phone.** Open the game over https (the published page) or on localhost.

1. Splash: the line under the help says that on a phone you throw by swinging. Start open play
   with 0 machine players (Inställningar: Kast reads "Auto (Svinga telefonen)").
2. The demo plays: six steps with captions, the phone upright, the aim marker sliding onto an
   arrow, the thumb lifting at the bottom and the ball rolling. Tap **Spela** (iPhone: allow
   motion in the dialog).
3. The big button reads **HÅLL - SVINGA - SLÄPP**. Stand with room around you, hold the phone
   upright like a remote, thumb on the button. Press: the first time it says **Håll stilla …**,
   then **SIKTA** (Android vibrates). Turn the phone a little left and right: a gold marker with
   the board number moves over the arrows and the aim line follows (board 5 to 35, about a board
   a degree). Put it on an arrow and hold.
4. Swing back: the marker turns white (locked) and the button says **SVINGA!**. Swing forward and
   lift the thumb as the arm passes the bottom: the ball rolls along the aim line; a gentle swing
   about 13-17 km/h on the readout, a full swing about 20, a hard one 25 or more.
5. Press, aim and let go without swinging: no throw, "Inget kast - svinga bakåt …". Swing, stop
   and hold, then let go: no throw ("släpp knappen under svingen"). A very slow swing: "För svagt".
   Aim on the same arrow and swing again with the arm pulled across the body to the left: the
   ball goes a little left of the aim line; pushed out to the right: a little right; a swing
   that stays straight follows the aim line.
6. Turn the wrist counterclockwise (seen from above) as you let go: a right-hander's hook, the
   ball curves left at the end; clockwise: it curves right.
7. Let go clearly early (arm still behind you): the ball goes a little right; clearly late
   (arm out in front): a little left; at the bottom: straight.
8. Touch the lane above the button (the hand grips the ball), drag slowly and let go: the ball
   moves on the approach. A swipe up on the lane does not throw and says how to throw.
9. Settings: **Kast: Svep**: the button is gone and the swipe throws; **Visa svingdemo** plays the
   demo again. On an iPhone, deny the permission once (Safari settings): the game falls back to
   the swipe with a note.
10. If anything is off, open the page with `?motiondebug=1` and send a screenshot of the box at
    the top left after the throw.

**Known limits.** iOS was not tested on a device (Safari's permission flow was tested with a
mock; the platform checks cover a different axis order or sign). A swing that starts with the arm
behind you and only goes forward is taken as a backswing and cancelled (swing back first). The
early side of the release timing assumes the arm hangs at the press. A phone without a gyroscope
uses the swipe.

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

## The sound

The hall and its people are heard: the player's ball rolling down the lane, the pins, the
pinsetter, the ball coming back, the hall's ventilation, the other lanes, and the friends
on the settee who applaud a strike. **No human voices are heard**: no murmur of talkers, no
cheers or groans. **Every sound is synthesised in the browser** (`js/audio/`, Web Audio); no
sound file is loaded.

**Where the sounds come from.** VBS's own sounds were looked for first, in an installed
Viking 4.4 (`C:\Viking2001`: `web\screen`, `v3gfx`, `GameConsole`, `Voice` (GSVoice), the
Commercial and lane console folders). It holds two sound files, and neither belongs in a
hall: `Spelmotor\Service.wav` is the reception's alarm when a lane calls for service
(`beepwindow.cpp`), and `Bong\spinning-coin-1.wav` is the order printer's coin sound, whose
name points to a sound library and whose licence is not known. The RedPin videos
(`web\screen\TV\media\*.webm`, `v3gfx\Resource\RedPin\*.mpg`) have no sound track, and
GSVoice's announcements and ComTV's `MISS*.wav` / `HAL*.wav` are not installed. So nothing
is copied: every sound is synthesised, and no CC0 or other outside sound is used.

**Size.** The scripts add 68 KB (22 KB gzipped): `js/audio/synth.js`, `hallaudio.js`,
`reactions.js`, `moments.js` and `css/audio.css`. No media files. The sounds are rendered
after the first tap in the browser's idle time, a few clappers at a time (ready within about
0.5 s on the test PC, 2-3 s with its CPU slowed four times as a phone's), and take about 9 MB
of memory. An applause or whistle variant made anew after use waits while a ball is out.

**Frame cost** (headless Edge on the test PC, the low detail level, full games): the sound's own
work in a frame takes a median of under 0.1 ms, 0.2 ms at the 95th percentile and at most 0.9 ms,
and the frame interval is the same with the sound on and muted (13.3 ms median, 13.4 ms at the
95th percentile; the display's rate). With the CPU slowed four times, as a phone's, the sound's
work is 0.1 ms median, 0.5 ms at the 95th percentile, at most 4.3 ms. Under that slowdown the
95th-percentile frame interval varied more from run to run than between sound on and muted. The
mixing itself runs on the browser's audio thread, not in the frames.

### What plays when

| When | What is heard | How it is made |
|---|---|---|
| always, after the first tap | the hall's room tone: the ventilation, far below everything else (no talkers) | a 12 s seamless loop of low-passed noise (160 Hz, about -44 dBFS) |
| the player's ball | its roll, from the real speed (level, brightness) and position (fainter towards the pins), with a beat at its rotation rate (about 10 per second at 7 m/s); a hollow rattle in the gutter | looped noise, filtered every frame from the physics; the ball carried up the approach is quieter |
| a machine player's release | the ball landing on the lane | a low thud |
| the ball at the pins | an impact for every hit the physics reports: the ball meeting a pin, a pin against a pin, a pin falling on the deck, against the kickback, into the pit, the ball into the cushion. More pins falling, more impacts: in two full games a ball averaged 2 impacts with no pin down, 13 for one pin, 48 for seven and 68 for a strike (at most 8 a frame, 5 on a phone: the loudest) | modal synthesis: the pin's decaying modes (0.7-6 kHz, damped in 6-55 ms) and a click; a pin on the deck, the kickback and the pit lower and duller |
| the ball at rest | the pinsetter: the sweep drops, the rake takes the deadwood to the pit, the deck sets a new rack (after a strike or a frame) or lifts and respots the leave; then the ball comes back on the return, with a clack on the rack | motors (the 100 Hz mains hum and a gliding gearbox whine), metal clunks, scraping, pin knocks; from the pin deck, 18 m away, with more reverb |
| the hall's far lanes | when the hall shows a ball on a lane further away (`hall.js`, every 3.5-9.5 s), it is heard rolling, its pins crash as the hall's pins fall (louder for more pins), and its pinsetter sweeps as the hall's rake does | the hall's own events are read each frame (nothing in `hall.js` is changed); placed left or right by the lane's place |
| the bumpers | the rails rising or lowering (a motor, two stops); a ball against a rail | from the shared game events `bumpersUp`, `bumpersDown`, `bumperHit` |
| the warm-up | a soft rising chime and the machine setting a rack at the start, a falling chime at the end; no applause during practice balls | `practiceStart`, `practiceEnd` |
| the end of a game | a short round of applause | `gameEnd` |

Every sound has a place: its distance from the bowler (at the foul line of the playing lane)
sets its level, its pan and how much of it goes to the hall's reverb (one shared convolver:
a 1.4 s decay that dulls with time, as a large room with carpet and ceiling tiles).

### The people

After a strike or a spare the people applaud (`js/audio/reactions.js`). **They have no
voices**: no cheers, no groans, and so no reaction at all to a bad ball. The player's friends
react in full; a machine player's ball gets a smaller, quieter reaction (at most 0.6 of the
level, fewer layers), so the player's stand out. The applause is single claps, one clapper at a
time, each with their own hands (the band of a clap, 0.9-2.5 kHz) and pace (4-6 a second); a
big ball also gets a two-finger whistle (a pure tone that rises and falls, not a voice).

| Ball | The player | A machine player |
|---|---|---|
| strike | applause | a few claps |
| double | more applause | a few claps |
| turkey | a bigger round and a whistle | applause |
| four or more in a row | the round, louder, and a whistle | as a turkey |
| perfect game | the hall: everyone clapping for 6 s, two whistles | a round |
| RedPin strike | at least as a turkey | at least as a turkey |
| spare | a few claps | a few claps |
| converted split | applause and a whistle | a few claps |
| gutter ball, split, a pin left, missed spare, foul, open frame | nothing (only the ball and the pins) | nothing |

Each reaction is picked from its variants (two of each, one of the perfect game's round, made
anew with a new seed after each use), played a little faster or slower and louder or softer each time, so it never
repeats.

**When.** What the hall can already see is answered at once, from the physics: every pin of
the rack down (a strike, or a spare; a converted split when the leave was a split). In two
full games these reactions came 0.6 s or more (median 1.5 s) before the ball was scored. The
scored ball comes from the shared game events (`js/game/events.js`: `ball`, `strike`,
`spare`). When the scored ball turns out bigger than the first guess (a turkey where the
physics only knew the strikes before it), the bigger reaction's extra layers are added; in No
Tap and Mini Bowling, where a ball the physics does not see as all down can be a strike, the
reaction comes with the score.

**The lights.** On a big ball for the player the lights over the lane pair (the pin-deck lamp
and the lamps behind the valances, `scene.gameLights()`) brighten for a moment and fade back
within a second: a spare a little, a strike more, a turkey in two pulses, four in a row in three,
a perfect game in five (`js/audio/moments.js`). Only light intensities change.

### Controls

| | |
|---|---|
| 🔊 in the play screen | mutes and unmutes (remembered: `localStorage` `vbg.sound`); its tooltip says what a press does, in the five languages |
| **Volym** in the options of open play and VBS-T | 0-100, remembered (`vbg.volume`); a pin's clack plays at the new level when it is let go. Default 60, 45 on a phone (a touch screen whose short side is under 600 px) |
| the first tap, click or key | starts the sound (the browsers' autoplay rules): before it no AudioContext exists |
| a hidden tab, a muted game | the audio is suspended |

`?audiolog=1` prints every sound event (reactions, judged balls, balls at rest with their
pins and impacts, far lanes) to the console; `vikingApp.sound.log` holds the last 400.

## The TV wall

A hall has one lane TV per lane, and so has the game (`js/game/tvwall.js`):

* **The lanes the player bowls on are shown by the real lane TV page**, TakTV (`#tvBox`, fed by the
  stand-in LoadCom as before): large, framed, at the top right (the whole width in portrait). It
  follows the play: in an American pair it shows the lane being bowled, and in a VBS-T competition it
  moves with the player to the next serie's lanes.
* **Every other lane in play gets a small TV** in the strip under it (`#tvStrip`): the other lanes of
  a VBS-T competition (up to seven for an 8-lane format), and in an American pair the pair lane the
  large TV is not showing. A small TV is the game's compact view of that lane's own score
  (`js/game/scoreview.js`): the lane number, the names, the ten frames with the Standard theme's
  marks (X, /, -, F, a split ringed), the running totals as `CProtocol::GetTotal` shows them
  (`RecalcScore`, strike sequence held back; the frames a game type does not play, in 10th Frame and
  Short Game, empty), the total, the bowler up and the practice box during a warm-up - drawn from the same lane struct the TakTV pages are fed, at most twice a second per
  lane. A tap shows a small TV large; another tap puts it back. On a phone the strip scrolls sideways.
  A strike or a spare on another lane flashes on its small TV.
* **The hall's overhead TVs** show the compact view of every lane in play
  (`scene.setLaneTvTexture`, one canvas per lane, uploaded again when it is drawn); the player's lane
  is the large, framed one (`scene.setActiveLane`). Lanes of the competition that the low detail
  level's hall does not have (more than four lanes to the left) have only their small TV.
* In a VBS-T competition the other lanes are no longer only results: each group of lanes is drawn
  first (as before, so the competition's results are the same) and then bowled again ball by ball
  on the lane structs the TVs and the consoles show, at the player's pace (`PacedLanes` in
  `js/vbst/session.js`), with its warm-up before serie 1. A console correction on such a lane counts:
  the serie's result is read from the lane when the serie ends.

**Why the small TVs are not TakTV pages:** measured on the low detail level with
`node tests/wall_fps.mjs` (headless Edge on the Intel UHD Graphics 770, Direct3D 11, an 8-lane
format, the machine players bowling at ⏩):

| Case | Detail | Small TVs | fps 1280 x 800 | Main thread busy per s | fps 1920 x 1080 | Main thread busy per s |
|---|---|---|---|---|---|---|
| 8 lanes: TakTV + 7 compact small TVs + 8 overhead TVs | low | 7 | 75 | 58 ms | 75 | 62 ms |
| 8 lanes, the 7 small TVs as 7 live TakTV pages | low | 7 | 75 | 206 ms | 75 | 135 ms |
| 8 lanes: TakTV + 7 compact small TVs + 8 overhead TVs | high | 7 | 75 | 96 ms | 75 | 102 ms |
| open play, 1 lane (TakTV, 1 overhead TV) | low | 0 | 75 | 58 ms | 75 | 59 ms |
| open play, 1 lane (TakTV, 1 overhead TV) | high | 0 | 75 | 90 ms | 75 | 94 ms |

The frame rate is the display's (75 Hz) on both levels in every case, so it cannot tell the cases
apart; the main thread's busy time can. The compact TV wall costs nothing measurable over a game
with no small TVs (58 against 58 ms a second); seven TakTV pages cost 73-148 ms a second more -
each page parses its theme, renders its sheet as SVG on every push and every 1 Hz tick and keeps its
own clock - which on a phone's CPU is most of a frame budget.
At a phone's size with the CPU slowed down four times (`node tests/wall_fps.mjs 390 844 <url> 4`,
touch, low level):

| Case | fps (median) | Frame ms p90 | Main thread busy per s |
|---|---|---|---|
| 8 lanes: TakTV + 7 compact small TVs + 8 overhead TVs | 75 | 13.4 | 259 ms |
| 8 lanes, the 7 small TVs as 7 live TakTV pages | 15 | 254 | 968 ms |

So the small TVs are the compact view, refreshed at most twice a second; only the large TV is a
live TakTV page.

## The lane console

Each lane in play has its lane console (`js/game/consolehost.js`): the console button in the HUD
opens VBS's own web console page over the game, with a tab per lane. The page is
`web/screen/console/touchconsoleLaneGame.html` = `touchconsoleLane.html` with one script tag
(`js/standin/console-standin.js`) and the phone sizing below, and its scripts are Viking 4.4's. The stand-in
answers the page as LoadCom's console service does (`Slave/LOADCOM/LoadComWebInterface.cpp`):

| The page asks | The game answers as |
|---|---|
| `/console/events?lane=n&WebSource=console` (the status feed) | `BuildLaneStatusJson` for a console: `Playing`, the lane's `practice` ("Yes" while practising), `isAMR`, `laneImgIndex`, the hall's `WebGameControl` |
| `players.json`, `playerScore.json` | `GetPlayers` (names without the bumper mark, `bump`), `GetPlayerScore` (-1 past `activeSquare`, `playerIdNumber`, `activeGame`, `activeSquare`) |
| `changeScore` (Korrigera's Spara) | `ChangeScore`: `CorrectionFitsLane` / `CorrectionSeesAllBalls` (the `laneMovedOn` / `scoreChanged` refusals and their alerts), `ApplyScoreCorrection` (the values the editor sent, F a foul, a moved ball losing its split and foul marks, `GCI_CHANGED` set, its pin picture redrawn with `GlobCreatePinConfig`), `MoveActiveMarkOffCompletedSeries`; then OpenPlay's `GC_CONSOLE_REFRESH`: `RefreshGame` - the game's scoring port rescores the lane (`js/engine/correction.js`) |
| `changePlayersInfo` (Ändra spelare's Spara) | `ChangePlayersInfo`: the list refused when it is from another game, bowlers kept by id, new ones added with the lane's `scoreMode` (3-6-9's strikes dealt), the `PlusC` bumper mark turned into `+C`, `ActiveBowlerWithBallLeft`; then the refresh |
| `endPractice` (Avsluta inspelning) | `StopPractice` -> `EndPracticeOnLaneData`: only on a lane practising; the practice balls go, every bowler on `FirstBallOfSerie`, serie and totals kept, the game's lane status back; an American pair ends both lanes |
| `lastPlayedPinPattern`, `ResetPin`, `SetPin` (Reset/Set) | the game's pinsetter: the rack on the deck, a new rack, the pins set for a second ball |
| `../common/gamectrl/VTVFile<n>.jpg` (the lane's picture) | the lane TV page's own picture of its sheet, as a lane PC's HTML screen writes `VTVFile<n>.html.jpg` (TakTV's `vbsExportSheetJpeg` at 960 wide), asked of the TakTV page only while the console shows that lane - once the console page is up, so it does not hold up the page's start - and again after every change of it (`ConsoleHost.picture`); the TV frames themselves are `readonly`, because a JPEG of the sheet after every push hitched a phone (the TV page's long tasks per four balls at 390 x 844 with the CPU slowed four times: 11-12 of up to 260 ms before, 5-7 after - those of its own drawing). Until it comes, and for a lane without a TakTV page, the compact view drawn at 960 x 540 |

While the console is open the bowlers on the lane wait and the player's swipe is off. The hall's
console settings (`WebGameControl`) offer Korrigera, Ändra spelare (names, order, bumpers, adding a
bowler: a machine player of the game's level) and Avsluta inspelning; Reset/Set is always on the
dock. **Left out, because they need a real hall:** Avsluta spel (the game's ☰ menu ends a game),
Service (staff), Flytta spel (another lane), Kundens meny (the hall's own page; `custom.html` is the
game's placeholder), Beställ (the hall's order page), Byt in reserv (the competition's player file on
the reception, `numReservPlayers` sent as 0), the start form's member lookup and the start itself
(the game starts its lanes), and "Ändra aktiv spelare" in American play (`AMRsetActivePlayer`
answers "offline").

The console page is a lane tablet's, and its size follows the screen (`html { font-size: min(1.25vw,
2vh) }` in `touchconsoleLane.css`): on a tablet or a desktop it is as on a lane. On a phone that made it
too small to use with a finger (a 4.9 px root at 390 x 844: Korrigera 38 x 19 px, a ball's cell 15 px
wide), and the player corrects the score on it as at a lane, so the game's page gives that size a floor
of 11 px (a `<style>` block in `touchconsoleLaneGame.html`; nothing of the console's scripts or
stylesheet is changed). What no longer fits then scrolls: a dialog downwards (`.overlay` already
scrolls) and Korrigera's row of 21 balls sideways (900 px wide under 900 px of screen, in the
`.scoreWrap` that already scrolls), with the ball being edited kept in view by a small script; the
dialogs' padding is tighter and the dock's labels larger. Measured with real taps (open the console,
Korrigera, a ball's cell, a digit, Spara, the lane checked):

| Size | Root font | Korrigera (dock) | A ball's cell | The digits | Spara |
|---|---|---|---|---|---|
| 390 x 844 | 4.9 -> 11 px | 38 x 19 -> 85 x 43 | 15 -> 41 x 50 | 24 -> 65 x 55 | 41 x 20 -> 90 x 44 |
| 844 x 390 | 6.7 -> 11 px | 52 x 26 -> 85 x 44 | 21 -> 41 x 50 | 34 -> 65 x 55 | 56 x 27 -> 90 x 44 (scrolled to) |
| 800 x 1280 | 10 -> 11 px | 78 x 39 -> 85 x 43 | 31 -> 41 x 50 | 50 -> 65 x 55 | 82 x 40 -> 90 x 44 |
| 1280 x 800 | 14.9 px | 116 x 60 | 47 | 75 | 122 x 60 (unchanged) |

The console's own tab bar in the game is 40 px high, its close button 44 x 44.

**The button.** It carries the console's own word as its label (`conButton`: Banterminal, Lane
console, Baneterminal, Ratapääte), beside a lane tablet with the dock's Korrigera pencil, in the
dock's look: a raised blue button with a gold icon. A bare screen icon among four other icons was
not recognised as the lane console. It is the last of the HUD's buttons: the end of the row at the
top (landscape, desktop), the foot of the column upright (furthest from the small TVs above it), and
with the swing button the last row of its grid, across both columns, straight above the button
(102-119 px wide: Ratapääte to Baneterminal). The start help has a line on it (`howToConsole`), and the console hint
(`conHint`) and the help use the dock's own words in each language (`dock.correct`,
`dock.changePlayer`, `dock.endPractice` in `web/screen/console/lang/`). The HUD's buttons draw above the small TVs
(`.hudBtns` z-index 3), because on a short upright screen (a phone's browser with its bars, 375 x 548
or 390 x 664) the strip of small TVs reached the column and hid the menu, ⏩, sound and full-screen buttons;
a small TV shown large still covers them.

**Played in headless Edge** (`node tests/wall_play.mjs`, real taps and swipes, from
`/games/VikingBowling/`; the screenshots are kept outside the published folder):

| Scenario | Sizes | What was checked |
|---|---|---|
| `open` | 1280 x 800, 390 x 844 (touch) | warm-up of 2 balls: the lane in practice (`laneStatus` 11), the TV's practice layout, a practice ball not scored; the player and a machine player with bumpers (`+C` in the lane file, the rails up for the player); End practice on the console (the serie starts with bowler 1, `laneStatus` back to 2); a ball at the gutter with the bumpers up stays out of it; Korrigera: the player's first ball changed (the lane, `GCI_CHANGED`, the TV's lane file); Ändra spelare: a third bowler given bumpers; the TV's animations played (`Strike.webm`, `Spare.webm`, `Split.webm` among them); the HUD laid out without overlaps; no exception or console error |
| `vbst` | 1280 x 800 | Banpoängsmatch 4+4: 4 lanes on the TV wall (TakTV and 3 small TVs, 4 overhead TVs); the other lanes bowled at the player's pace; serie 1 played out, serie 2 on other lanes - the large TV followed the player (lane 1 -> 3) |
| `layout` | 1920 x 1080, 1280 x 800, 800 x 1280, 390 x 844, 844 x 390 (touch except the first) | Banpoängsmatch 8+8 on 8 lanes: 8 lanes, 7 small TVs, all in their warm-up; a ball; a small TV shown large inside the screen; the console of lane 8 (tabs scroll on a phone), Korrigera on it; nothing cut off or overlapping; every HUD button inside the screen with nothing on top of it, the console button labelled (all scenarios) |
| `minutes` | 844 x 390 (touch) | a 1-minute warm-up: the clock running, practice balls, the stop picture (`GCI_PracticeOver`, `maskPicture` 3; the 30 s shortened to 20 s for the test by `app.practiceStopMs`), then the serie |

The only failed requests in these runs are the five harmless 404s listed under "Known gaps".

## Bumpers

As a hall does them:

* **Per bowler.** The names screen has a Bumpers box for the player and for every machine player (a
  child at a low level), and the console's Ändra spelare has one per bowler. A bumper bowler's name
  carries Viking's mark, `+C` at the end, in the lane file (what the console's start writes,
  `plusCCC` -> `+C`; `CProtocol::IsBowlerUsingBumper` reads it). TakTV and the score views take the
  mark off (`truncatePlayerName`); **TakTV has no bumper marking on the sheet**, only in the name
  entry panel while names are typed at a lane, which the game's names screen does not use.
* **Up and down as OpenPlay drives them** (`CGameAbstract::adjustBumper`): up for a bumper bowler,
  down for the others, set at the start, after every scored ball that did not end the game and
  after a refresh (a console change). Not during the warm-up (OpenPlay scores warm-up balls in
  `TestFrames_Score` / `TestBalls_Score`, which do not move them, so they stay as the start left
  them), and **not in cross lane play** (American): OpenPlay leaves the rails alone there, and the
  game says so in a note when an American game has a bumper bowler.
* **In 3D** (`js/sim3d/bumpers.js`): a padded rail in each gutter of the game's lanes rises out of it
  in 1.6 s, leaning out on its lever as it comes up, and sinks back below the gutter's floor.
* **In the physics** (`js/sim3d/physics.js`): a rail's face 12 mm outside the lane edge, 14 cm high,
  from 25 cm past the foul line to 20 cm before the end of the pin deck, solid from the moment it is
  raised; a padded rail gives back about half the ball's speed across the lane (restitution 0.45).
  The ball's centre stays within 0.43 m of the middle, so it never reaches the gutter, and the pins
  fall from the deflected ball. The aim line predicts the bounce. A slow ball going from rail to rail
  can take more than 9 s to the pins (12 s at most in the test); a ball is ended short of the pins only
  once it has stopped moving forward for half a second (a safety cap at 45 s), so it is scored for the
  pins it takes, never cut off on its way (before: 31 of the test's 120 slow balls were ended 1-4 m
  short of the pins and scored nothing).
* **Machine players with bumpers** throw no gutter ball: a first ball the statistics make a gutter
  ball comes off a bumper and takes a side of the rack instead (a multi-pin leave weighted toward
  four to six pins standing), bowled in 3D at the bumper; a second ball misses everything less often.
* The first time the bumpers rise, a hint explains them.

## The warm-up (inspelning)

Chosen before the game: **Inspelning** in the options - none, 2, 4 or 8 balls per bowler (VBS-T's
"2 / 4 Klot"), 1-3 frames, or 1, 2, 5 or 10 minutes. A VBS-T format uses its own setting (the
header's `practiceMethod` / `practiceAmount`; 39 of the 153 Auto formats have one: 5, 10 or 15 minutes, or 1-6 frames)
unless another is chosen, and only before serie 1 (`CShiftSettings::CreateGCI`). OpenPlay's warm-up
is ported (`js/engine/openplay.js`):

| | What OpenPlay does | The TV |
|---|---|---|
| Balls (`GCI_PRACTICE_BALLS`, `TestBalls_Score`) | nothing is written on the sheet; every ball passes the turn; after bowlers x balls the serie starts | the practice layout with "Inspelningsklot" (the count is counted inside OpenPlay, in no lane file, so the TV shows only the description - the game's status line shows the balls left) |
| Frames (`GCI_PRACTICE_FRAMES`, `TestFrames_Score`) | the balls are on the sheet while a frame is played, wiped when the turn has gone round (`CleanPractice`), one frame counted per round | the practice layout with the frames left |
| Minutes (`GCI_PRACTICE_MINUTES`) | frames as above while the clock runs; at the end the stop picture (`GCI_PracticeOver`, `maskPicture` 3) for 30 s, practice balls still practice balls, then the serie (`TestFrames_UpdateClock`) | the practice clock, then the stop picture |

During the warm-up the lane is in practice (`laneStatus` 11), no throw is scored, RedPin is held
(it is drawn again when the warm-up ends; the 3D head pin stays white meanwhile) and nothing is celebrated;
a ball still rolling when the warm-up ends (End practice on the console, the clock's stop picture
running out) is not scored as a serie ball - the serie starts with its first bowler and a full rack,
and a ball also goes unscored when the console changed the bowler up while it rolled; the machine players take their
practice turns quickly. It ends when it runs out or with **Avsluta inspelning** on the console;
then the serie starts at frame 1 (a tenth-frame game ends a warm-up in frames on ball 0, as OpenPlay
does - `m_activeSquare` is captured before the tenth frame's 18; End practice puts it on ball 18).
**One deviation:** after End practice in a warm-up on time, OpenPlay's clock thread would end the
practice once more 10-40 s later and wipe the balls bowled since (a known limit, `Slave/LOADCOM`);
the game stops its clock instead. The game's open play lanes keep the lane status they started with
(Gameplay) after the warm-up, where `PlayingLaneStatus` would give Timeplay for a start without a
start time.

## The TV animations

TakTV plays an animation full screen over the sheet when the payload carries one
(`animation`, a one-shot, `vbsPlayMedia(ANIMATION_PATH + animation)`). Which one is OpenPlay's
choice, ported in `js/game/tvmedia.js`: after a scored ball (not a warm-up ball) with an exciter
other than none and no RedPin strike just played, for a bowler before ball 19 or a strike in a row in
the tenth (`CGame::RenderScreen2`), the exciter's action (`CMultimedia::GetRandomMedia`: STRIKEA,
STRIKE2-11, 300, SPARE, SPMAKE, SPLIT, MISS for a gutter first ball, FOUL, PIN1-9, OPEN), if the
hall's list has it (`WebOpenplayActions`, all by default), a file whose `.ini` names the action
(`[main] action=... prio=...`, as `shared/graphics/prio.cpp` reads it), sent lower-cased as
`MyCGamePlayAnim` sends it. The hall's `v3GfxPercentAnims` is 100 in the game's hall (Viking's
default is 50). Viking 4.4 ships only the two RedPin videos in `web\screen\TV\media`; a hall adds its
own. The game's hall has a set made for it by `tools/make_tv_media.mjs` (original artwork drawn on a
canvas in `tools/tv_media_maker.html` and recorded as WebM): Strike, Double (STRIKE2), Turkey
(STRIKE3), 4 in a row (STRIKE4), Strike streak (STRIKE5-11), 300, Spare, Split converted (SPMAKE),
Split, Gutter ball (MISS) and Foul, 2-3 s each, 100-220 KB, 1.9 MB together. PIN1-9 and OPEN have no
file, so nothing plays for them (as in a hall without such media). The RedPin chance and RedPin
strike videos play as before. A short animation still waiting when the next ball's comes is
replaced by it, as LoadCom's one slot is written over.

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

**The lane console's correction** (`node run_correction.mjs 150 4471` in the same folder): the C++
of LoadCom's `changeScore` - `ApplyScoreCorrection`, `ActiveBowlerWithBallLeft`,
`MoveActiveMarkOffCompletedSeries`, with `SetChangedFlagInStatus`, `GlobIsFirstBall` and
`GlobCreatePinConfig` from `GCI_info.cpp`, copied verbatim by `extract.mjs` like the rest - followed
by OpenPlay's `GC_CONSOLE_REFRESH` (`RefreshGame` of the pair lane in cross lane play, then of the
lane), against `js/engine/correction.js` and the game's engine. Games of nine types, EUR and AMR,
with corrections between the balls as the console's editor makes them (a ball changed to a digit,
X, a spare or F; a ball added; the last ball taken off; the rest of the series filled in with strikes;
another row than the bowler up), the whole state printed after every ball and every correction:
**2,700 games, 48,478 corrections, 413,100 state lines compared, 0 differ.**

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
  lane and the serie tied), a Petersen serie with a tie;
* the lanes bowled at the player's pace (`PacedLanes`): with an American pair and a warm-up in
  frames (1-3) every lane pair of the predefined formats (78) bowls exactly the serie drawn for it
  (one lane of a pair can end its warm-up before the other; a lane of a pair with nobody on it has no
  warm-up);
* a bowler added on the lane console (Ändra spelare) on the player's lane bowls the serie to the end
  as a machine player of the game's level (EUR and AMR), and the other lanes' pace timer stops.

Result: **0 check failures.** The full table (format, mode, players, series, lanes,
teams, points, pins, leader) is printed by the test.

## Other tests

| Test | What |
|---|---|
| `node tests/loading_test.mjs [kbps=3000] [outDir]` | the load bar on the splash in headless Edge on a throttled connection (starts its own `tests/serve.mjs`): `js/loadsizes.js` names exactly the files the splash waits for; while the game loads the bar shows "Laddar … n %", n only grows and passes 50 %, and the flags, help and **OK** wait; when the game has started the bar is gone, the splash is complete and OK, Fortsätt and Starta reach the play screen with no exception; the text follows the language chosen last time ("Loading … n%"); a file that does not load turns the bar red with "Spelet kunde inte laddas …" |
| `node tests/swipe_test.mjs` | the grip-and-release throw with synthetic pointer events, each with its own `timeStamp`: the ball speed rises with the release speed on the curve above, a release slower than 50 mm/s does not throw and a short quick flick is too weak; the same finger speed gives the same ball on nine real phones, tablets and touch screens in portrait and landscape (real pixel densities, within 4 %) and with a mouse; the release decides (a stroke that slows or speeds up at the end, a turn at the end sets the line), a pull-back adds nothing; a straight push gives no spin and a straight line; a slow drag and lift moves the ball without a throw (also forward), a sideways or backward release, a finger that stopped before it lifted and a tap never throw; a quick stroke throws from where the ball stood and leaves the stance there, a slow drag first moves it; the drag is clamped to the approach, the modes the hints get, the arrow keys; standing 4 m back gives the same lane speed and line; a curve left spins the ball to hook left in the back end (right: right), a little, and the same curve hooks further and enters steeper on a slower ball; the phone's twist (the turn over the last 180 ms, its dead zone and scale, counterclockwise left, clockwise right, added to the curve and clamped, none without a sensor); on a slow device (6, 10 and 20 frames a second: the events handled in bursts, coalesced, the pointer-up a frame late) a swipe throws exactly as fast as at full frame rate, a rest before a quick flick does not slow it; a touch whose pointer stream the browser cancels while it goes on delivering touch events still throws |
| `node tests/grip_browser.mjs <w> <h> <touch 0\|1> [lang] [outDir] [baseUrl]` | the grip throw in headless Edge with real pointer input: the hint near the ball (clear of the ball, the aim line, the status line, the buttons, the TVs and the ball speed), the hand on the ball at the press and while it is dragged, a slow drag that moves the ball without a throw, a sideways release, a straight push (no spin), a curved swipe (side spin, the body turning about its direction of travel, the path hooking in the back end), "wait for your turn" while the ball rolls and during a machine player's turn; touch: the phone's twist through Chromium's sensor emulation (counterclockwise, clockwise, still); screenshots in outDir |
| `node tests/physics_tune.mjs` | pin action at the classic impact points (pocket, light, high, head-on, Brooklyn, straight ball); the low level's budget for the pin crash only takes time away (exactly one sub-step a frame when it runs out at once; the pocket hit's strike rate stepped that way) |
| `node tests/warmup_test.mjs` | the warm-up in balls, frames and minutes as OpenPlay plays it (nothing on the sheet / the frame on the sheet and wiped / the clock, the stop picture and the serie), the turn passed, End practice on the console (only on a lane practising; an American pair ends both lanes, bowlers 0 and 8), a tenth-frame game after a warm-up (ball 0 by OpenPlay's own end, ball 18 by End practice), and **not scored**: the same game balls give the same sheet and totals with and without a warm-up (EUR and AMR, balls and frames); the game's ball loop (`LaneGame` with a stand-in App): a ball still rolling when End practice or the clock ends the warm-up is not scored (balls, frames, minutes, the player's ball and a machine player's) |
| `node tests/bumper_test.mjs [throws=120]` | balls released at the gutters (both sides, hook and none, 3.5-8.5 m/s): with the bumpers up **none ends in the gutter**, nearly all meet a bumper and take pins, the ball's centre stays inside the rails; the same balls with the bumpers down go into the gutter and touch no rail; a second ball into the same rail is heard as the first (the bumper-hit clock starts again at each release); the slowest balls (3.3-4.2 m/s) at the rails all reach the pins (none ended short while still rolling; a ball that has stopped moving forward is ended where it is); machine players with bumpers throw **no gutter ball** in 20,000 first balls at averages 80, 100 and 130, and without bumpers draw exactly as before; the `+C` mark as `IsBowlerUsingBumper` reads it, players.json's `bump`, and Ändra spelare setting and clearing it |
| `node tests/wall_play.mjs <open\|vbst\|minutes\|layout\|anim> <w> <h> <touch 0\|1> [outDir] [baseUrl]` | the TV wall, the console, the bumpers and the warm-up played in headless Edge with real pointer input (`tests/cdp.mjs`: swipes and taps by the DevTools protocol, each event with its own time) from the sub-path `/games/VikingBowling/`; checks the lane file, the TV and the layout, and lists every exception and failed request (see "The TV wall" for the results) |
| `node tests/wall_fps.mjs [w] [h] [baseUrl]` | frames a second on both detail levels with the TV wall, and the small TVs as live TakTV pages instead (on this PC's GPU) |
| `node tools/make_tv_media.mjs [baseUrl] [previewDir]` | makes the TV animations (not a test) |
| `node tests/motion_test.mjs`, `tests/motion_browser.mjs`, `tests/motion_android.mjs` | throwing by swinging the phone: see "Throwing by swinging the phone" |
| `node tests/shoot.mjs <spec>` | headless Edge screenshots (the specs used are described below) |
| `node tests/audio_test.mjs [outDir]` | the sound, in node: renders every sound (no NaN, no clipping, no DC, each in its band; the room tone at its level and seamless; with `outDir` each is written as a WAV to listen to); no human voice: no voice synthesis left in `synth.js` and no reaction made of anything but applause and whistles; balls scored by the game's engine give the right reactions (a strike, a double, a turkey, four in a row, a perfect game, a spare, a converted split, No Tap 9; nothing for a gutter ball, a split, a near miss with the 10 and with the 5, one pin left of a spare, a missed spare, an open frame); the player's reactions louder than a machine player's, a bigger strike bigger; the strikes-in-a-row guess made before the ball against the engine's count after it (8,732 strikes in five game types: 100 % the same) |
| `node tests/audio_browser.mjs <url> <outDir> [mobile] [cpu] [quick]` | the sound in headless Edge with the browsers' own autoplay rules, the game served from a sub-path (`node tests/serve.mjs 8790 <folder holding games/VikingBowling>`, then `http://127.0.0.1:8790/games/VikingBowling/`): no AudioContext and no sound before the first gesture, one context created in it and running; every sound rendered, no voice among them, the room tone running; a full EUR and a full AMR game in 3D (the player by test throws, two machine players), where every scored ball with a reaction got it, the early reactions came 0.6 s or more (median 1.5 s) before the score, the impacts grew with the pins down, the far lanes were heard and every sound played came from a bank that is not a voice; every reaction played through the shared game events with the engine's result and recorded from the output as a WAV (a turkey louder than a strike, a perfect game louder than a turkey, the player's strike more than 1.5 times a machine player's, a bad ball nothing over the room tone, two strikes never the same sound); mute and volume, remembered over a reload, and no AudioContext while muted; the frame time with the sound on and muted on the low detail level; no exception or console error |

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
at full resolution. They were taken before the review fixes of 2026-11-18 (the splash, now the blue
Viking helmet without a version number, the phone tables, the full-size lane TV in portrait and the status line have changed
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
  A slower ball deflects more and carries less (see "Deflection" under "The throw"): the
  deck's hold on a standing pin is a phenomenological model, sized by judgement, as no
  published measurement of deflection against ball speed was found; in an ideal impulse
  collision the deflection would not depend on the speed at all.
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
* The reception's live booking flow and online scoring are not part of the game. The lane console's
  commands that need a real hall are left out (see "The lane console"), and so is "Räkna tid först
  vid spelat klot" (a warm-up clock that waits for the first ball): the game's clock starts with the
  game.
* **Bumpers in American play** stay down, as OpenPlay leaves them in cross lane play; a VBS-T
  competition has no bumper toggles. TakTV has no bumper marking on the sheet.
* **The warm-up's two small deviations** (see "The warm-up"): End practice stops the game's clock
  for good, and an open play lane keeps Gameplay after a warm-up.
* In a VBS-T competition the other lanes are bowled at the player's pace serie by serie (on a rig
  each lane goes at its own pace); a lane whose player sits out a serie is played out at once.
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
* The Android emulator check was done for throwing by swinging the phone only
  (`tests/motion_android.mjs`), not for the rest of the game.
* **The hall** is built around the game's two lanes as lanes 5 and 6. A VBS-T format on other
  lanes renumbers the masking units (and `scene.laneIndexOf` follows), but the layout stays:
  the hall still ends four lanes to the left, and lanes left of lane 1 carry no number.
* The lanes are the physics' 41.5 in (USBC: 41.5 ± 0.5 in), not 41 in; changing the width would
  change the game's physics.
* No bowlers are drawn: the other lanes look occupied by their pins, the balls on their racks,
  their TVs and the balls that roll, not by people. There is no "cosmic" (black light) mood.
* The lane reflection mirrors the hall above the lanes (pin decks, masking units, TVs, lamps),
  not the lanes, gutters or approach themselves; on the low level only the environment map
  gives the sheen. The environment map is rendered once from over the game's lanes, so a
  ball's reflections do not change as it rolls.
* The overhead TVs of the lanes in play show each lane's own score (the TV wall's compact view);
  the hall's other TVs keep their still pictures. In landscape the HTML lane TV and the small TVs
  cover the overhead TVs over the lanes right of the player's.
* The small TVs of the TV wall are the game's compact view, not TakTV pages (see "The TV wall"
  for why); they have no animations of their own beyond a short "STRIKE" / "SPARE".
* The quiet life plays on lanes two to seven lanes from the game's lanes; the lanes right next
  to the player stay still, so that nothing moves beside the player's own ball.
* **The sound** was checked by measurement (levels, bands, timing, the recordings in the
  test), not yet by ear in a real hall. There are no human voices (no murmur of talkers, no
  cheers or groans), so the hall is quieter than a real centre. There is no background music (a centre
  usually has some). The pinsetter and the ball return are heard but not seen move on the
  game's own lanes (the pins are reset at once, as before). On a phone in silent
  mode iOS mutes Web Audio.

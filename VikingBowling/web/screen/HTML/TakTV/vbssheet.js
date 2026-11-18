// ---------------------------------------------------------------------------
// vbssheet.js - the scoring sheet: which layout to draw a lane with, what to
// draw it with, and the transient pictures that belong to the sheet rather than
// over it.
//
// Shared by every HTML screen that shows a lane's scoring: the lane TV
// (TakTV.html) and the web console (..\console\TouchConsole.html) both load this
// one file rather than carrying a copy each - the same arrangement, and the same
// reasoning, as vbsmedia.js one folder along.
//
// It is not a renderer. vbsrender.js draws a protocol and vbsprotocol.js parses
// one; this is the layer above them that answers "which protocol, with which
// options, for this lane file" - and that is precisely the part two screens must
// not each decide for themselves. A console whose sheet chose a different theme,
// or applied HideStrikeSeq differently, or missed the ShowPins window, would be
// showing the operator something the lane TV two metres away is not.
//
// What deliberately stayed behind in each page: the transport it is fed by, the
// lane status machine and media loop it runs, and - for the lane TV alone -
// rasterising the sheet and posting it to the slave. Those genuinely differ. The
// TV shows StartConsole and the slow-waiting media on an idle lane where the
// console shows ClosedLane and its own start form, and only the lane's own
// screen may write VTVFile<n>.jpg.
//
// One object rather than a dozen bare globals, unlike its siblings here. There
// is exactly one sheet per page, so the state below is a singleton either way;
// the namespace is only so that a page loading this alongside commonAPI.js -
// which the console does, and which brings its own scoring helpers - cannot
// collide with it.
//
// Usage:
//   vbsSheet.init({ sheet: <svg>, fileSheet: <svg>, protocol: 'viking', ... });
//   vbsSheet.setLaneJson(text or object);   // parse, update, draw
//   vbsSheet.render();                      // redraw from what is already held
// ---------------------------------------------------------------------------

/* global vbsRenderProtocol, vbsLoadProtocol, vbsLoadLanguage, vbsFetch1252,
   vbsPinsFromString, vbsArray, vbsIsFirstBall, vbsLoadOnScoringText,
   vbsLoadOnScoringValues, vbsMergeOnScoring, vbsSetPinsOnScoring, vbsPinsOnScoring, vbsGammaOnReady */
/* exported vbsSheet */

var vbsSheet = (function () {
  'use strict';

  // Set by init(). Until then nothing here draws: a page that forgets to call it
  // gets a status message rather than a thrown error on every payload.
  var sheet = null;
  var fileSheet = null;
  var statusHook = null;
  var backgroundLocked = false;   // the page pinned one with ?bg=, so the slave's is ignored

  // The page's status line, wherever it keeps one. A page without one passes no
  // hook and the messages are dropped - which is what a customer-facing screen
  // wants anyway.
  function setStatus(message) {
    if (statusHook) statusHook(message || '');
  }

  var protocols = {
    viking: window.VBS_PROTOCOL_VIKING,
    refresh: window.VBS_PROTOCOL_VIKING_REFRESH,
    'viking refresh': window.VBS_PROTOCOL_VIKING_REFRESH
  };

  function pickProtocol(name) {
    return name ? protocols[String(name).toLowerCase().trim()] : null;
  }

  // The theme, and the theme a competition game uses instead. Both are registry
  // values on the slave that a browser cannot read, so the page is told and
  // passes them to init(); see the ?protocol= note in TakTV.js for where they
  // come from and why the lane file's own "protocol" field is preferred when it
  // is finally filled in.
  var protocol = window.VBS_PROTOCOL_VIKING;
  var compProtocol = window.VBS_PROTOCOL_VIKING;

  function xmlProtocolForLane(json) {
    var explicitTheme = pickProtocol(json && json.protocol);
    if (explicitTheme) return explicitTheme;
    var dll = (json && json.dllName) ? String(json.dllName) : '';
    return (dll.indexOf('VBS') >= 0) ? compProtocol : protocol;
  }

  // --- the theme, loaded from its own XML -------------------------------
  //
  // The lane file names the theme the slave drew with, and vbsprotocol.js reads
  // that theme's protocol.xml the way BitmapFromXml does. That is what lets a
  // hall run any of the twenty-one installed themes - or its own - without a
  // transcription per theme, and it is what a web client fed only by a slave
  // needs, since the theme folder sits under the same root as the lane data.
  //
  // protocol_viking.js and protocol_viking_refresh.js stay as the fallback: they
  // cover a lane file written before the slave stamped the theme, and they are
  // what draws the first frame while the XML is still being fetched.
  var protocolCache = {};        // "theme|file" -> promise
  var loadedProtocol = null;     // the parsed theme in use, once it has arrived
  var loadedKey = null;

  // v3GfxPinsOnScoring, the style of the small pin rack the theme imports as
  // #PINS_ON_PROTOCOL#. The value itself lives in vbsprotocol.js, which is what
  // splices the rack in, and is read back from there rather than copied - a
  // second copy could disagree with it, since that setter rejects a name that is
  // not a plain folder. Empty means the hall wants no rack, which is the slave's
  // own default.
  //
  // Changing it has to throw the parsed layouts away: the rack is spliced into a
  // protocol while it is parsed, so one already in the cache has the old rack
  // baked into it.
  function setPinsOnScoring(style) {
    if (!vbsSetPinsOnScoring(style)) return;   // unchanged; nothing to reload

    protocolCache = {};
    loadedProtocol = null;
    loadedKey = null;
    if (laneJson) refreshProtocol(laneJson);
  }

  // RenderScreen2's choice of layout, from the same fields it reads (player 1 is
  // the GetPlayer(0) / GetPlayer(8) it asks: this lane's own first bowler). A
  // practice or short-game layout the theme does not ship is borrowed from the
  // Standard theme, and only then replaced by protocol.xml, inside
  // vbsLoadProtocol - as the C++ does.
  function protocolXmlFile(json) {
    var GCI_SCORING_SHORTGAME_2 = 0x0080;
    var GCI_SCORING_SHORTGAME_3 = 0x0100;
    var GCI_SCORING_SHORTGAME_4 = 0x0200;
    var GCI_SCORING_SHORTGAME_5 = 0x0400;

    if ((parseInt(json.practiceMethod, 10) || 0) !== 0) return 'practice.xml';   // != GCI_PRACTICE_NONE

    var first = json.players && json.players['player 1'];
    var mode = first ? (parseInt(first.scoreMode, 10) || 0) : 0;
    if (mode & GCI_SCORING_SHORTGAME_2) return 'shortgames2.xml';
    if (mode & GCI_SCORING_SHORTGAME_3) return 'shortgames3.xml';
    if (mode & GCI_SCORING_SHORTGAME_4) return 'shortgames4.xml';
    if (mode & GCI_SCORING_SHORTGAME_5) return 'shortgames5.xml';
    return 'protocol.xml';
  }

  function refreshProtocol(json) {
    var theme = (json && json.protocol) ? String(json.protocol).trim() : '';
    if (!theme) return;                       // older lane file: use the transcription

    var key = theme + '|' + protocolXmlFile(json);
    if (key === loadedKey) return;            // already drawing this one

    if (!protocolCache[key]) {
      protocolCache[key] = vbsLoadProtocol(theme, protocolXmlFile(json));
    }

    protocolCache[key].then(function (loaded) {
      // A later payload may have moved on to a different layout while this was
      // in flight; only the newest one may take effect.
      if (key !== theme + '|' + protocolXmlFile(laneJson || json)) return;
      loadedProtocol = loaded;
      loadedKey = key;
      render();
      // A tournament layout that arrived before its theme is merged now.
      refreshOnScoring(laneJson || json);
    }, function (error) {
      // Keep the transcription rather than losing the sheet. Asked once per
      // key, because the rejected promise stays in the cache.
      if (window.console) console.warn('Protocol theme not loaded: ' + key, error);
    });
  }

  // What the page actually draws: the Full HD mirror of that protocol. Same
  // content and the same per-player-count logic, laid out for 1920x1080 so it
  // fills a 16:9 display edge to edge instead of leaving a 4:3 sheet in the
  // middle. Every XML protocol maps here today; this is where a second mirror
  // would be selected if one is ever authored.
  // The page draws the same layout the lane TV does - same rows, same panels,
  // same tokens - and only the proportion changes: vbsRenderProtocol stretches
  // the finished composition across the 1920x1080 canvas. So the mirror of an
  // XML protocol is that protocol, not a different theme. Drawing Viking as
  // Viking Refresh looked close but was not the same thing: Refresh puts three
  // lines under each player where Viking puts two, and its TeamInfo strip
  // carries a TOT column Viking's does not.
  function protocolForLane(json) {
    var merged = mergedProtocolFor(json);
    if (merged) return merged;
    return loadedProtocol || xmlProtocolForLane(json);
  }
  // The background behind the sheet.
  //
  // The XML path takes it from ScorerSettings::m_v3BackGroundPath - the per-lane
  // registry value v3GfxBackgroundName under V3GFX\Backgrounds - overridden by
  // the lane file's bg_image when a game sets one, and when that path is a
  // *folder* it shows a random picture from it, changing every ten seconds
  // (GetRandomImageFromDir, Slave/OPENPLAY/Game.cpp). A browser can read neither
  // a registry nor a directory, so the slave resolves it and hands the finished
  // URL over in the lane status payload as "background". Until that arrives -
  // and under WebView2, where there is no payload - the fallback below is used,
  // which is what this page always drew.
  //
  // A page's own ?bg= still wins over both, and ?bg=none draws on black; the
  // page resolves that for itself and passes backgroundLocked so setBackground()
  // below leaves it alone.
  var VBS_DEFAULT_BACKGROUND = '../../../../v3gfx/Backgrounds/Blue.jpg';

  // Set from init(): the resolved URL, or null to draw on black. The slave's own
  // answer arrives later in the lane status payload and is applied with
  // setBackground() unless the page pinned one.
  var options = {
    language: 'Svenska',
    background: null,
    showBallSpeed: false,
    hideStrikeSequence: true,
    alwaysShowLaneSum: false,
    showMaxGame: false
  };

  var laneJson = null;

  // --- GSX training -------------------------------------------------------
  //
  // A GSX training game is not drawn by the scoring protocol at all: OpenPlay is
  // not what runs the lane, TrainingGameControl.exe is, and it draws
  // V3GFX\Resource\GSX_Training\protocol.xml - the programme per player, the hit
  // rate, and the rack the lane is set for. Same thing here: the layout is
  // loaded from that folder and drawn instead of the theme's protocol, with the
  // tokens resolved from the lane file (see the #GSX_ block in vbstokens.js).
  //
  // The rack is the one thing not simply in the lane file. CScreenPainter keeps
  // it in gCurrentPins, from player 0's programme, which is packed into that
  // player's practiceElapsed by CTrainingProgram::GetProgram:
  //
  //   PIN_PROGRAM_BIT set -> the low bits are the rack, and that is all of it
  //   otherwise          -> low 16 bits are the programme number, bits 20+ the
  //                         position in it, and the rack is that position's line
  //                         in GameConsole\trainingPrograms\<nnn>.ini
  //
  // The second form is readable here because TrainingGameControl writes the
  // *advanced* position back before drawing, so the stored position is the one
  // whose pins are currently up. No randomness has to be repeated.
  var TRAINING_LAYOUT_URL = '../../../../v3gfx/Resource/GSX_Training/';
  var TRAINING_PROGRAM_URL = '../../../../GameConsole/trainingPrograms/';
  var PIN_PROGRAM_BIT = 0x00010000;

  var trainingLayout = null;
  var trainingLayoutAsked = false;
  var trainingPinsCache = {};      // "<program>:<position>" -> mask

  function isTrainingGame(json) {
    var amount = json ? parseInt(json.practiceAmount, 10) : 0;
    return amount === 66 || amount === 67;
  }

  function loadTrainingLayout() {
    if (trainingLayoutAsked) return;
    trainingLayoutAsked = true;

    vbsLoadProtocol(null, 'protocol.xml', TRAINING_LAYOUT_URL).then(
      function (loaded) {
        trainingLayout = loaded;
        render();
      },
      function (error) {
        if (window.console) console.warn('GSX training layout not loaded', error);
      }
    );
  }

  function pad(value, width) {
    var text = String(value);
    while (text.length < width) text = '0' + text;
    return text;
  }

  // Sets options.trainingPins, fetching the programme file when it takes one.
  function refreshTrainingPins(json) {
    var first = json && json.players && json.players['player 1'];
    var program = first ? (parseInt(first.amrLeague && first.amrLeague.practiceElapsed, 10) || 0) : 0;

    if (program & PIN_PROGRAM_BIT) {
      options.trainingPins = program & ~PIN_PROGRAM_BIT;
      return;
    }

    var number = program & 0xFFFF;
    var position = program >>> 20;
    if (!number) {
      options.trainingPins = 0;
      return;
    }

    var key = number + ':' + position;
    if (trainingPinsCache[key] !== undefined) {
      options.trainingPins = trainingPinsCache[key];
      return;
    }

    trainingPinsCache[key] = 0;      // asked; do not ask again for this position
    vbsFetch1252(TRAINING_PROGRAM_URL + pad(number, 3) + '.ini').then(
      function (text) {
        // [Pins] Pins0001=1,2,3 - GetPrivateProfileString semantics, and the
        // same key name CTrainingProgram builds with INI_FILE_KEY.
        var wanted = 'pins' + pad(position, 4);
        var section = '';
        var lines = text.split(/\r?\n/);

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.charAt(0) === '[') { section = line.toLowerCase(); continue; }
          if (section !== '[pins]') continue;

          var eq = line.indexOf('=');
          if (eq < 0) continue;
          if (line.substring(0, eq).trim().toLowerCase() !== wanted) continue;

          trainingPinsCache[key] = vbsPinsFromString(line.substring(eq + 1).trim());
          options.trainingPins = trainingPinsCache[key];
          render();
          return;
        }
      },
      function (error) {
        if (window.console) console.warn('Training programme not readable', error);
      }
    );
  }

  // --- the pins left standing ---------------------------------------------
  //
  // After a first ball that leaves pins up, the lane screen shows them full
  // screen for five seconds and then goes back to the sheet. CGame::RenderScreen2
  // does it by drawing V3GFX\Resource\ShowPins\ShowPins.xml into its own bitmap,
  // playing it and then sleeping five seconds; this draws the same layout into
  // the same SVG for the same five seconds instead, so the picture is the hall's
  // own - background, laminate, the two commercial frames and the Brunswick pins
  // come from that folder, not from anything transcribed here.
  //
  // The trigger is derived from the lane file rather than taken from a message.
  // MM_GetExciter (Slave/OPENPLAY/Multimedia.cpp) classifies the ball from the
  // standing-pin mask and the C++ shows the picture for GCI_EXCITER_PIN and
  // GCI_EXCITER_SPLIT; both mean the same thing here - a first ball, pins still
  // up, and not a gutter, which is exactly what the mask says. That keeps the
  // decision on this side of the wall: nothing in OpenPlay has to publish
  // anything for this screen to work.
  var PIN_DISPLAY_MS = 5000;
  var PIN_LAYOUT_URL = '../../../../v3gfx/Resource/ShowPins/';
  var ALL_PINS_STANDING = 0x3FF;

  var pinLayout = null;          // the parsed ShowPins.xml, once it has arrived
  var pinLayoutAsked = false;
  var pinShownUntil = 0;         // ms; while now is below this the pins are up
  var pinShowMask = 0;           // which pins are standing, as CGame::m_showPins
  var pinLastBall = null;        // "<player>:<square>" of the ball already shown

  function loadPinLayout() {
    if (pinLayoutAsked) return;
    pinLayoutAsked = true;

    vbsLoadProtocol(null, 'ShowPins.xml', PIN_LAYOUT_URL).then(
      function (loaded) {
        pinLayout = loaded;
        // The first ball of the day pays for the fetch, so the window may
        // already be open by the time it lands - draw it now rather than
        // waiting for the next tick to notice.
        if (pinsAreUp()) render();
      },
      function (error) {
        // Not fatal: the sheet is drawn as before, only the pin picture is
        // missing. A hall that has removed the folder is a supported state.
        if (window.console) console.warn('ShowPins layout not loaded', error);
      }
    );
  }

  // --- the bowler up, across a cross lane pair -----------------------------
  //
  // An American game bowls a pair of lanes at once and activePlayer is a PAIR
  // index rather than a row: 0-7 are the ODD lane's roster and 8-15 the EVEN
  // lane's, whichever of the two is being drawn. That is CGCI_info::GetPlayer,
  // which answers m_pSharedMem[0]->player[p] for 0-7 and m_pSharedMem[1]->
  // player[p-8] for 8-15, and it is how CGame::GetText marks the two bowlers
  // who are up at once - the odd lane matching activePlayer against the row,
  // the even lane against the row plus 8.
  //
  // So on either lane of such a pair, half the balls are thrown by a bowler
  // whose row lives in the *partner's* lane file, and this payload carries only
  // our own roster. Those were exactly the balls the pin picture was missing,
  // every other one: measured on the rig 2026-08-19 in an American game, lane
  // 1's activePlayer alternated 0, 1, 8, 9 and 'player 9' resolved to nothing,
  // so the picture came up for one first ball in two.
  //
  // The partner's roster is fetched for those balls. Asked for per ball rather
  // than on a timer: a throw rewrites both lane files of the pair (GameAbstract
  // signals the partner GC_SAVE_LANEFILE), so our own laneDataModifiedTime
  // moving is the signal that the copy we hold is stale. At ~5 kB and ~20 ms
  // that is one small fetch per ball, and only in an American game - a normal
  // game never reaches this code at all.
  var partnerPlayers = null;      // the partner's roster, as last read
  var partnerPlayersFor = null;   // ...for this "<our lane>|<our laneDataModifiedTime>"
  var partnerAskedFor = null;     // the stamp the request in flight was made for
  var partnerBusy = false;
  var partnerRetryAt = 0;         // ms; back off after a failure rather than per ball

  function isCrossLane(json) {
    var LC_START_AMERICAN = 0x4000;
    return (parseInt(json && json.type, 10) & LC_START_AMERICAN) !== 0;
  }

  // Whether the bowler up is one of ours or one of the partner's, by the rule
  // above: pair index 0-7 lives on the odd lane, 8-15 on the even one.
  function bowlerIsOnPartner(json) {
    var pair = parseInt(json.activePlayer, 10);
    if (isNaN(pair) || pair < 0) return false;

    var laneNumber = parseInt(json.laneNumber, 10);
    if (!laneNumber) return false;                            // older payload: no lane number

    return (pair < 8) !== ((laneNumber % 2) === 1);
  }

  function requestPartner(json) {
    var laneNumber = parseInt(json.laneNumber, 10);
    if (!laneNumber) return;

    // The copy is only good for the lane data it was read for. A throw rewrites
    // both lane files of the pair, so our own laneDataModifiedTime moving is
    // what says the roster we hold is a ball out of date - and holding a stale
    // one is worse than holding none, because it reads as a bowler who has not
    // thrown yet. Qualified by our lane number as well, because that time is
    // GetTickCount() and two lanes written in the same millisecond share it:
    // both pages that use this sheet read their lane once at load today, so it
    // cannot bite, and this keeps it that way if one ever switches lanes.
    var stamp = laneNumber + '|' + json.laneDataModifiedTime;
    if (stamp === partnerPlayersFor || stamp === partnerAskedFor) return;
    if (partnerBusy || Date.now() < partnerRetryAt) return;

    partnerBusy = true;
    partnerAskedFor = stamp;

    // GET_CROSSED_LANE: the pair is (odd, odd + 1).
    var partner = (laneNumber % 2) === 1 ? laneNumber + 1 : laneNumber - 1;

    fetch('/html/lanedata.json?lane=' + partner)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (payload) {
        partnerBusy = false;
        partnerPlayers = (payload && payload.lane) ? payload.lane.players : null;
        partnerPlayersFor = stamp;
        options.partnerPlayers = partnerTeams(partnerPlayers);
        // The ball this was read for is still the one on the lane, so put the
        // pins up now rather than leaving them for the ball after next.
        updatePinDisplay(laneJson);
        render();
      }, function (error) {
        partnerBusy = false;
        // Transient rather than settled - unlike a missing OnScoring layout,
        // the partner's lane data is there under any healthy rig - so this
        // backs off and asks again instead of giving up on the lane for good.
        // A page fed by WebView2 has no server behind it at all and simply
        // never gets the picture for these balls, which is what it did before.
        partnerRetryAt = Date.now() + 10000;
        if (window.console) console.warn('Partner lane data not read for the pin picture', error);
      });
  }

  // The partner's bowlers as #teamLogo_n# reads them: their team names, by row.
  function partnerTeams(players) {
    if (!players) return null;
    var out = [];
    for (var i = 1; i <= 8; i++) {
      var p = players['player ' + i];
      out.push({ teamName: p && p.teamName ? String(p.teamName) : '' });
    }
    return out;
  }

  // A VBS-T lane whose first two bowlers carry one team name takes the other
  // team's logo from the partner lane (#teamLogo_n#, CGame::GetText), so its
  // roster is read too - only from a LoadCom, which is what answers the fetch.
  function needsPartnerTeams(json) {
    if (!serverSide || !onScoringApplies(json) || !json.players) return false;
    var a = json.players['player 1'], b = json.players['player 2'];
    return String((a && a.teamName) || '') === String((b && b.teamName) || '');
  }

  // The bowler up on this lane, which in a cross lane game need not be one of
  // this lane's own players. Null when there is none, or when it is the
  // partner's and this ball's roster has not arrived yet.
  function activeBowler(json) {
    if (!json || !json.players) return null;

    var pair = parseInt(json.activePlayer, 10);
    if (isNaN(pair) || pair < 0) return null;

    if (!isCrossLane(json)) return json.players['player ' + (pair + 1)] || null;

    var row = 'player ' + ((pair % 8) + 1);
    if (!bowlerIsOnPartner(json)) return json.players[row] || null;

    var stamp = parseInt(json.laneNumber, 10) + '|' + json.laneDataModifiedTime;
    if (partnerPlayersFor !== stamp) return null;             // stale, or not here yet
    return partnerPlayers ? (partnerPlayers[row] || null) : null;
  }

  // The mask of pins the ball just thrown left standing, or 0 when this ball is
  // not one that shows any: a strike, a gutter, a second ball, or practice.
  //
  // Not gated on the full-screen setting, and that is the point. m_showPins in
  // the C++ is maintained on every ball whatever that setting says, because two
  // different things read it: the scoring protocol's own small rack, which the
  // theme imports as #PINS_ON_PROTOCOL#, and - only when the setting is on - the
  // five-second full-screen picture. Switching the picture off must not take the
  // rack with it.
  function standingPinsForBall(json, player) {
    if (!json || !player) return 0;
    if (parseInt(json.practiceMethod, 10) > 0) return 0;      // never during practice

    var square = parseInt(player.activeSquare, 10) || 0;
    var pos = square - 1;                                     // the ball just thrown
    if (pos < 0 || pos >= 20) return 0;                       // the C++ stops at 20 too

    // Only a first ball. On a second ball the frame is over as far as this
    // picture is concerned, and MM_GetExciter returns OPEN or SPARE.
    var scores = vbsArray(player.score, 21);
    if (!vbsIsFirstBall(pos, scores)) return 0;

    var standing = vbsArray(player.pinConfig, 21)[pos];
    if (!standing) return 0;                                  // strike: nothing left
    if (standing === ALL_PINS_STANDING) return 0;             // gutter: GCI_EXCITER_ZERO

    return standing;
  }

  // The rack on the sheet, which lives longer than the full-screen picture:
  // CGame::RenderScreen2 sets m_showPins on a ball that leaves pins up and
  // clears it only once the frame is over - an even activeSquare means the next
  // ball is a first ball - so the pins to pick up stay on the sheet while the
  // bowler walks back and throws the second. Practice and "nobody up" clear it
  // outright, as they do there.
  //
  // GCI_Practice is 11 (shared/lanedata/GCI.h). The mask function above already
  // declines during practice, which would leave a stale rack on an odd square
  // rather than clearing it - the C++ forces 0, so this does too.
  function updatePinRack(json, player, standing) {
    var GCI_PRACTICE = 11;

    if (parseInt(json.activePlayer, 10) < 0 ||
        parseInt(json.laneStatus, 10) === GCI_PRACTICE ||
        parseInt(json.practiceMethod, 10) > 0) {
      options.showPins = 0;
      return;
    }

    if (standing) options.showPins = standing;
    else if ((parseInt(player.activeSquare, 10) || 0) % 2 === 0) options.showPins = 0;
  }

  function updatePinDisplay(json) {
    if (!json) return;

    // Driven by staleness, not by absence: once a roster has been read it stays
    // held, so asking only when we have none would read the partner's bowler a
    // ball behind for the rest of the game. Asked for only when something will
    // actually draw the mask - the rack, the full-screen picture, or both - so a
    // hall that has switched off both pays nothing for a read it cannot use.
    if ((options.showPinsEnabled || vbsPinsOnScoring) &&
        isCrossLane(json) && bowlerIsOnPartner(json))
      requestPartner(json);

    var player = activeBowler(json);

    if (!player) {
      // A game that has ended clears the rack; a bowler we simply cannot resolve
      // yet - the partner's roster is still in flight - leaves everything alone,
      // pinLastBall included, so the ball is still unseen when it lands.
      // Consuming it here is what would turn a slow read into a lost picture.
      if (parseInt(json.activePlayer, 10) < 0) options.showPins = 0;
      return;
    }

    var ball = parseInt(json.activePlayer, 10) + ':' + player.activeSquare;
    if (ball === pinLastBall) return;                         // same ball, nothing new
    pinLastBall = ball;

    var standing = standingPinsForBall(json, player);
    updatePinRack(json, player, standing);

    // ...and the full-screen picture over it, which is the part the hall can
    // switch off.
    if (!standing || !options.showPinsEnabled) return;

    loadPinLayout();
    pinShowMask = standing;
    pinShownUntil = Date.now() + PIN_DISPLAY_MS;
  }

  function pinsAreUp() {
    return pinLayout !== null && Date.now() < pinShownUntil;
  }
  function optionsCopy() {
    var copy = {};
    for (var key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) copy[key] = options[key];
    }
    return copy;
  }

  // Draws the lane onto one SVG.
  //
  // `withEffects` is what separates the screen from the file. The screen gets
  // everything, transient effects included; the file gets the scoring sheet
  // underneath them - see captureSheet().
  function drawScreen(target, withEffects) {
    // now is re-read on every draw so the open-play countdown ticks; the lane TV
    // refreshes once a second for the same reason.
    options.now = Math.floor(Date.now() / 1000);

    // A training game is drawn by its own layout, not by the scoring protocol -
    // the lane is not running a game the protocol could show. That is the lane's
    // real content rather than an effect over it, so it is in the file too.
    if (isTrainingGame(laneJson)) {
      loadTrainingLayout();
      if (trainingLayout) {
        vbsRenderProtocol(target, trainingLayout, laneJson, options);
        return true;
      }
    }

    if (withEffects && pinsAreUp()) {
      // A copy, so what is changed here lives only for this draw. `options`
      // carries showPins all the time now - that is the mask the protocol's own
      // small rack is drawn from - but this layout wants the mask of *this* ball
      // rather than the frame's, and it brings its own background and fills the
      // frame, so the lane one is left off. The C++ draws this layout on its own
      // too, with pPis NULL.
      var pinOptions = optionsCopy();
      pinOptions.background = null;
      pinOptions.showPins = pinShowMask;
      // ...and the VBS-T OnScoring layout is not part of it. The C++ calls
      // BitmapFromXml for this picture with pPis NULL (Slave/OPENPLAY/Game.cpp),
      // and CacheLoadXml splices the layout in only when pPis is non-null - so
      // the tournament layout is never part of ShowPins there. pinLayout is the
      // bare ShowPins.xml, so nothing is merged into it here either.
      pinOptions.onScoringValues = null;

      vbsRenderProtocol(target, pinLayout, laneJson, pinOptions);
      return true;
    }

    vbsRenderProtocol(target, protocolForLane(laneJson), laneJson, options);
    return true;
  }

  function render() {
    if (!laneJson) return;
    try {
      drawScreen(sheet, true);
      setStatus('');
    } catch (error) {
      setStatus('Render failed: ' + error.message);
      if (window.console) console.error(error);
    }
  }

  // --- what goes into the file -------------------------------------------
  //
  // The JPEG on disk is history: it is reviewed later, in the restore dialog and
  // by whoever is asked what happened in a game. So it must always show the
  // scoring sheet and, in a tournament, the VBS-T OnScoring panel with it -
  // never one of the effects that momentarily covers them on the screen.
  //
  // The full-screen picture of the pins left standing is the one that reaches
  // this far. It is drawn into the same SVG as the sheet, and it is triggered by
  // a ball landing - which is exactly when a capture is due - so a plain capture
  // of the visible sheet caught the pins nearly every time. (The commercials,
  // messages and animations never could: those are the <img> and <video> over
  // the sheet, and only the SVG is rasterised.)
  //
  // Waiting for the effect to pass is not an option either - the capture is due
  // now and the sheet moves on - so the sheet is drawn a second time, into an
  // off-screen SVG of its own, and that is what is rasterised. The screen is
  // untouched by it.
  function captureSheet() {
    if (!fileSheet) return null;
    drawScreen(fileSheet, false);
    return fileSheet;
  }

  // --- VBS-T OnScoring ---------------------------------------------------
  //
  // A tournament game names its league in the lane file, and that name is the
  // key to both OnScoring files. Loading them is asynchronous while render() is
  // not, so the overlay is applied to the *next* render rather than held up for:
  // the layout is fetched once, merged into the theme once, the values follow
  // every lane payload, and each arrival re-renders. Worst case the very first
  // frame of a tournament is drawn without the overlay, a fraction of a second
  // before it appears.
  //
  // The layout is put into the theme as TEXT, before the theme is parsed - that
  // is what CacheLoadXml does - so a name both of them use stays the theme's, and
  // the layout's own imports come out of the theme's folder.
  var onScoringBusy = false;
  var onScoringFailed = {};       // leaguePath -> true, so a miss is asked for once
  var onScoringShownFor = null;   // leaguePath whose overlay is currently drawn
  var onScoringText = {};         // leaguePath -> the layout as fetched
  var mergedProtocols = {};       // "<loadedKey>|<leaguePath>" -> merged protocol, or PENDING
  var PENDING = {};
  var serverSide = /^https?:$/.test(window.location.protocol);   // see init()

  // BitmapFromXml is asked for the layout only for a game with a dllName, and
  // CacheLoadXml only when the lane file names a league.
  function onScoringApplies(json) {
    return !!(json && json.dllName && String(json.dllName).trim() !== '' && laneLeaguePath(json));
  }

  // The theme with this tournament's layout in it, when it is ready.
  function mergedProtocolFor(json) {
    if (!loadedProtocol || !onScoringApplies(json)) return null;
    var path = laneLeaguePath(json);
    if (path !== onScoringShownFor) return null;
    var m = mergedProtocols[loadedKey + '|' + path];
    return (m && m !== PENDING) ? m : null;
  }

  function ensureMerged(path) {
    if (!loadedProtocol || onScoringText[path] === undefined) return;
    var key = loadedKey + '|' + path;
    if (mergedProtocols[key]) return;
    mergedProtocols[key] = PENDING;
    var base = loadedProtocol;
    vbsMergeOnScoring(base, onScoringText[path]).then(function (merged) {
      mergedProtocols[key] = merged;
      render();
    }, function (error) {
      // xml_michael cannot read the theme with this layout in it either. The TV
      // then draws no sheet at all (MyPrepareXml fails); this keeps the theme
      // without the layout rather than leaving the lane screen empty.
      mergedProtocols[key] = base;
      if (window.console) console.warn('OnScoring layout not merged for ' + path, error);
    });
  }

  // An overlay belongs to one tournament. It has to be taken down when the lane
  // moves to a game that has none, or the previous tournament's team names and
  // differences sit on top of the new game - which is what a Lagspel game showed
  // after a Banpoäng one, since only some tournaments have an OnScoring layout.
  function clearOnScoring() {
    if (!onScoringShownFor && !options.onScoringValues) return false;
    options.onScoringValues = null;
    onScoringShownFor = null;
    return true;
  }

  function laneLeaguePath(json) {
    var p = json && json.players && json.players['player 1'];
    var amr = p && p.amrLeague;
    return (amr && amr.leaguePath) ? String(amr.leaguePath).trim() : '';
  }

  function refreshOnScoring(json) {
    var path = laneLeaguePath(json);

    if (!onScoringApplies(json)) {
      // Not a tournament any more - drop the overlay rather than leaving the
      // previous game's team names on the sheet.
      if (clearOnScoring()) render();
      return;
    }

    // A different tournament: what is on screen belongs to the old one, so take
    // it down now rather than after the new one has loaded - and whether or not
    // the new one turns out to have an overlay at all.
    if (onScoringShownFor && onScoringShownFor !== path) {
      if (clearOnScoring()) render();
    }

    // A tournament need not have an OnScoring layout at all - most do not - so a
    // miss is the normal case, not an error. Ask once per league and then stop:
    // otherwise a hall without these files pays a 404 per poll, once a second,
    // for the whole night.
    if (onScoringFailed[path]) return;
    if (onScoringBusy) return;      // one in flight is enough at 1 Hz
    onScoringBusy = true;

    // The two files fail for different reasons and are treated differently. No
    // layout means this tournament simply has no overlay, which is settled and
    // permanent. The values file is rewritten by the rig as the match runs, so a
    // single unreadable read is transient - keep the values already shown and
    // try again on the next payload rather than losing the overlay over it.
    var layout = (onScoringText[path] !== undefined)
      ? Promise.resolve(onScoringText[path])
      : vbsLoadOnScoringText(path, parseInt(json.laneNumber, 10) || 0, serverSide);
    layout
      .then(function (text) {
        onScoringText[path] = text;
        onScoringShownFor = path;
        ensureMerged(path);
        return vbsLoadOnScoringValues(path).then(
          function (values) { options.onScoringValues = values; },
          function (error) {
            if (window.console) console.warn('OnScoring values unreadable for ' + path, error);
          }
        );
      })
      .then(function () {
        onScoringBusy = false;
        render();
      })
      .catch(function (error) {
        onScoringBusy = false;
        onScoringFailed[path] = true;
        // This tournament has no OnScoring layout, which is the normal case -
        // only some do. Make sure nothing from a previous one is left drawn.
        if (clearOnScoring()) render();
        // Deliberately not shown on the sheet: the lane TV is customer facing
        // and the scoring is perfectly good without the overlay. The XML path
        // does the same - it logs and carries on rather than refusing to draw.
        if (window.console) console.warn('OnScoring layout not loaded for ' + path, error);
      });
  }
  // The hall's own .lang file, fetched once. Its strings replace the built-in
  // fallback table, so a hall that has reworded one gets its own text - and the
  // ids the fallback never carried, "press SPACE for a new game" among them,
  // become available at all.
  //
  // Asked for once per page whatever happens: the file either exists or it does
  // not, and a lane TV must not pay a 404 per payload all night for it.
  var languageAsked = false;

  function ensureLanguage(language) {
    if (languageAsked) return;
    languageAsked = true;

    vbsLoadLanguage(language || options.language, options.language).then(
      function () { render(); },
      function (error) {
        // The fallback table stays in place, so the sheet is still drawn - only
        // the few strings that are not in it are missing. Not shown on the
        // sheet: these screens are customer facing.
        if (window.console) console.warn('Language file not loaded', error);
      }
    );
  }

  // Four settings the XML renderer reads from the slave's registry, which a page
  // cannot: HideStrikeSequence, AlwaysShowLaneSum ("Visa bansumma"), the lane's
  // ball-speed media flag (MES_MASK_BALLSPEED) and ShowMaxGame ("Visa maxpoäng
  // för serien", #MAX_GAME#). The slave sends them in the payload as "Yes"/"No"
  // (BuildHtmlPayload); `pinned` names the ones the page's own address set
  // (?hidestrike=, ?lanesum=, ?speed=, ?maxgame=), which win, as ?bg= does.
  // Absent on an older slave, and then the page keeps what it was started with.
  // Returns whether anything changed, so the caller knows to draw again.
  function applySlaveSettings(payload, pinned) {
    var changed = false;
    [['hideStrikeSequence', 'hideStrikeSequence'],
     ['alwaysShowLaneSum', 'alwaysShowLaneSum'],
     ['showBallSpeed', 'showBallSpeed'],
     ['showMaxGame', 'showMaxGame']].forEach(function (pair) {
      var field = pair[0], key = pair[1];
      if ((pinned && pinned[key]) || !payload || payload[field] === undefined) return;
      var on = payload[field] === 'Yes';
      if (options[key] !== on) { options[key] = on; changed = true; }
    });
    // The message overlay OpenPlay's screen shows, as LoadCom last heard it -
    // see vbsMaskState in vbstokens.js. Absent from an older slave: null.
    var mask = (payload && payload.maskPicture !== undefined) ? (parseInt(payload.maskPicture, 10) || 0) : null;
    if (options.maskPicture !== mask) { options.maskPicture = mask; changed = true; }
    // The pictures the full-screen pins picture shows in its two frames.
    if (payload && payload.openPlayCommercial1 !== undefined) {
      var pictures = [String(payload.openPlayCommercial1 || ''), String(payload.openPlayCommercial2 || '')];
      var had = options.openPlayCommercial;
      if (!had || had[0] !== pictures[0] || had[1] !== pictures[1]) { options.openPlayCommercial = pictures; changed = true; }
    }
    return changed;
  }

  // The background the slave resolved for this lane, as a URL under its document
  // root. Ignored when the page pinned one with ?bg=, so a test or a wall page
  // can still force a background of its own.
  function setBackground(background) {
    if (backgroundLocked) return;
    if (!background) return;
    if (options.background === background) return;

    options.background = background;
    render();
  }

  // Accepts the lane file as text or as an already parsed object, makes it the
  // one being drawn, and draws it.
  //
  // Returns the parsed object, or null when the payload was not readable - which
  // is what lets the lane TV decide whether it also has a sheet worth writing to
  // disk without parsing the same text twice.
  function setLaneJson(payload) {
    try {
      laneJson = (typeof payload === 'string') ? JSON.parse(payload) : payload;
    } catch (error) {
      setStatus('Bad lane data: ' + error.message);
      return null;
    }

    // Before the render, so a ball that leaves pins standing puts them up on
    // this very frame rather than a second later.
    updatePinDisplay(laneJson);
    if (needsPartnerTeams(laneJson)) requestPartner(laneJson);
    if (isTrainingGame(laneJson)) refreshTrainingPins(laneJson);

    render();
    refreshProtocol(laneJson);
    refreshOnScoring(laneJson);
    return laneJson;
  }

  // config:
  //   sheet         the <svg> drawn on the screen. Required.
  //   fileSheet     a second, off-screen <svg> for capture(). Optional - a page
  //                 that never writes an image needs none, and the console does
  //                 not have one.
  //   protocol      theme name, "viking" or "refresh"; the lane's own.
  //   compProtocol  theme name a competition game uses instead.
  //   background    resolved URL, 'none'/'' for black, or null for the default.
  //   backgroundLocked  the page pinned it, so the slave's is ignored.
  //   language, showBallSpeed, hideStrikeSequence, alwaysShowLaneSum, showMaxGame
  //   serverSide    a LoadCom serves the page. Optional, default: served over http.
  //   onStatus      function(text) for the page's status line. Optional.
  function init(config) {
    var settings = config || {};

    sheet = settings.sheet || null;
    fileSheet = settings.fileSheet || null;
    statusHook = settings.onStatus || null;
    backgroundLocked = settings.backgroundLocked === true;

    protocol = pickProtocol(settings.protocol) || window.VBS_PROTOCOL_VIKING;
    compProtocol = pickProtocol(settings.compProtocol) || window.VBS_PROTOCOL_VIKING;

    var background = (settings.background === undefined) ? VBS_DEFAULT_BACKGROUND : settings.background;
    if (background === 'none' || background === '') background = null;

    options.language = settings.language || 'Svenska';
    options.background = background;
    options.showBallSpeed = settings.showBallSpeed === true;
    // Both default to the registry's own default rather than to false:
    // HideStrikeSeq is on unless a hall turns it off, and the team-sums panel is
    // off unless one turns it on.
    options.hideStrikeSequence = settings.hideStrikeSequence !== false;
    options.alwaysShowLaneSum = settings.alwaysShowLaneSum === true;
    // Off unless the address or the slave says otherwise, as ShowMaxGame is absent = 0.
    options.showMaxGame = settings.showMaxGame === true;
    // Whether a LoadCom is behind the page to ask for the tournament layout
    // (/html/onscoring); without one the file under the page's own root is read.
    if (settings.serverSide !== undefined) serverSide = settings.serverSide === true;

    // A picture whose translucent pixels have been corrected to mix as the lane
    // TV mixes them (vbsgamma.js) is drawn from the next render on.
    if (typeof vbsGammaOnReady === 'function') vbsGammaOnReady(render);
  }

  return {
    init: init,
    options: options,          // the live object: pages set waitingSpace and showPinsEnabled on it
    setLaneJson: setLaneJson,
    laneJson: function () { return laneJson; },
    render: render,
    capture: captureSheet,
    protocolForLane: protocolForLane,
    ensureLanguage: ensureLanguage,
    setBackground: setBackground,
    applySlaveSettings: applySlaveSettings,
    setPinsOnScoring: setPinsOnScoring,
    defaultBackground: VBS_DEFAULT_BACKGROUND
  };
}());

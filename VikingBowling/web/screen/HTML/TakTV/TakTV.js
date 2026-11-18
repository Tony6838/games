// ---------------------------------------------------------------------------
// TakTV.js - the HTML lane TV: transport, the lane status machine, and the
// wiring that puts the scoring sheet on the screen.
//
// The sheet on the screen is not drawn here. vbssheet.js holds all of that -
// which protocol a lane file is drawn with, the theme XML behind it, the GSX
// training layout, the ShowPins picture and the VBS-T OnScoring overlay - and is
// shared with the HTML web console in ..\console, so the two screens cannot
// disagree about what a lane looks like. This file is the lane TV: how the lane
// file gets here, the status machine and the media over the sheet, and writing
// the sheet back to the slave as a picture.
//
// This is the browser-rendered counterpart of the lane TV in ..\..\TV, which
// shows pictures the slave produced. It does everything that screen does - the
// commercials, the messages, the animations, the slow-waiting and OpenPlayExtra
// media, the banner strip and the ticking clock - off the same payload and the
// same 1 Hz tick, from the same media files. What it does not do is fetch the
// scoring sheet as a JPEG: it draws it. See the lane status machine below for
// the port, and vbsmedia.js for the layer that shows everything else.
//
// Three ways in, all carrying the same payload - the lane file that
// CGCI_info::GetJsonFromPlayInfo writes:
//
//   1. WebView2. CRestoreHistoryLaneFile posts the JSON as a web message; that
//      is how the "Review and restore game history" dialog drives this page.
//   2. Server-sent events, which is how a live lane TV runs. The page subscribes
//      to /html/events?lane=<n> on LoadCom's HTML server (port 24324, document
//      root C:\Viking2001) and is pushed a payload only when the lane actually
//      moves. The message is the ordinary lane-status JSON every web screen
//      gets, with the lane file nested under "lane".
//
//      That is a second, separate service. The XML/image screens customers run
//      today are on 24321 under /console/ and nothing here touches them.
//   3. Plain http polling. ?json=<url> fetches a lane file directly, optionally
//      re-fetching every ?poll=<ms>. Kept for testing and for reading a lane
//      file that is not live; it is not what a lane TV uses.
//
// Chosen in that order: ?feed=host opens no transport at all, ?json= selects
// polling, and otherwise a page served over http streams. Opened from file:// with
// no ?json= the page just waits to be fed.
//
// ?feed=host has to be said rather than worked out, and that is worth spelling
// out. CRestoreHistoryLaneFile does not load this page from file:// - it maps
// C:\Viking2001 to a virtual host name so the theme XML can be fetched and the
// canvas stays untainted - so its pages are "https:" with no server behind them
// and every /html/ request 404s. The page took that protocol as proof of a server,
// opened an event stream that could only fail, and reopened it every three seconds
// for as long as the dialog was open.
//
// Query string:
//   ?lane=<n>       which lane to subscribe to (streaming path), default 1
//   ?feed=host      the host pushes the payload in (WebView2): open no stream and
//                   poll nothing. Implies readonly.
//   ?readonly=1     this screen watches and never writes: no scoresheet image is
//                   rasterised or posted back. For a viewer that is not the lane's
//                   own screen - the reception's "Monitor this lane" window.
//   ?json=<url>     where to fetch the lane file from (polling path)
//   ?poll=<ms>      re-fetch interval, default 1000 when ?json is given
//   ?protocol=viking|refresh   which layout to draw, default viking. The lane TV
//                   takes this from the slave registry (v3GfxProtocol, per lane),
//                   which a browser cannot read - hence the parameter.
//   ?compprotocol=viking|refresh   which layout a competition game uses (registry
//                   v3GfxCompProt, machine-wide, default Viking). A lane file
//                   whose dllName contains "VBS" is drawn with this instead of
//                   ?protocol, matching CGame::RenderScreen2.
//   ?lang=Svenska|English    label language, default Svenska
//   ?bg=<url>       background image, default V3GFX\Backgrounds\Blue.jpg, "none"
//                   for black
//   ?pins=<style>   which Pins_On_Protocol style the small rack of pins left
//                   standing is drawn with on the sheet (registry
//                   v3GfxPinsOnScoring, machine-wide). Normally the slave says
//                   it; this pins one for a single screen, and an empty value
//                   draws no rack. Either way it is the configured style: on a
//                   protocol of the other width (640 / 1920) the nearest style
//                   that fits is drawn instead, as the lane TV does - see
//                   vbsPinsStyleCandidates in vbsprotocol.js. Nothing to do with
//                   the full-screen picture, which is the
//                   v3gfxShowFullScreenRemainingPins setting.
//   ?speed=1        show ball speed (the MES_MASK_BALLSPEED media flag)
//   ?hidestrike=0   show running totals during a strike sequence
//                   (registry HideStrikeSeq, which defaults to on)
//   ?lanesum=1      draw the team-sums panel under the sheet. Mirrors
//                   ScorerSettings::m_alwaysShowLaneSum ("Visa bansumma",
//                   REGVAL_ALWAYS_SHOW_LANE_SUM), which a browser cannot read -
//                   the same problem and the same answer as ?protocol=. A team
//                   play game, or a VBS-T game with team_mode > 0, switches the
//                   panel on from the lane file alone and needs no parameter.
//   ?maxgame=1      draw #MAX_GAME# / #MAX_GAME_HCP# (the highest game still
//                   reachable). Mirrors ScorerSettings::m_showMaxGame (Setup >
//                   Machine, ShowMaxGame), which the slave also sends
//                   in the payload; ?maxgame=0 pins it off.
// ---------------------------------------------------------------------------

/* global vbsRenderProtocol */

(function () {
  'use strict';

  var sheet = document.getElementById('sheet');
  var statusBar = document.getElementById('status');

  // Parameter names are matched case insensitively, because URLSearchParams is
  // not: "?Lane=3" is what a hand-typed or bookmarked address looks like, and
  // get('lane') answers null for it - so the page silently showed lane 1. Every
  // other screen already treats them this way (getLane in common/js/commonAPI.js
  // lowercases them for exactly this reason), so a URL that works on one screen
  // has to work here too. Values are left alone; only the names are folded.
  var params = (function () {
    var lowered = new URLSearchParams();
    new URLSearchParams(window.location.search).forEach(function (value, name) {
      lowered.append(name.toLowerCase(), value);
    });
    return lowered;
  }());

  // Served by a web server, as opposed to loaded from file:// or fed by WebView2.
  // Decides both which transport is used and whether this page writes the lane's
  // scoresheet image.
  var httpHosted = /^https?:$/.test(window.location.protocol);

  // Whether there is a Viking web server behind that origin, which is not the same
  // question - see the ?feed=host note at the top of this file. The host says which
  // it is instead of the protocol being taken as the answer.
  var hostFed = params.get('feed') === 'host';

  // A screen that watches and never writes back. The reception's "Monitor this
  // lane" window is one: it shows the lane exactly as the lane TV does, but
  // GameCtrl\VTVFile<n>.jpg is the lane's history and belongs to the lane's
  // own screen, which is drawing and posting that very same sheet all along. A
  // second writer would only race it. A host-fed page has no server to post to at
  // all, so it is read-only by definition.
  var readOnly = hostFed || params.get('readonly') === '1';

  // A page driven by the lane's status - served by LoadCom and not handed its lane
  // file or a JSON address. On such a page the drawn sheet is kept out of sight
  // until the status has said the sheet is what this screen shows (sheetDue below):
  // the first payload carries the lane file whatever the lane is doing, so the sheet
  // used to be drawn and shown at once, and the commercial over it only came with
  // the next tick and its picture after that. An idle lane's file is the last game,
  // or an empty one that the theme fills with its own placeholders ("Lagnamn", the
  // RED PIN badge) - and that was what the reception's Restore old scoring showed
  // for a second or two on every lane it was asked to show live (Siren, Vora,
  // 2026-10-24, "Lagspel med red pin", which that hall never plays). The lane TV
  // itself showed the same at every page load. Until the status is known the media
  // area shows nothing, which is honest; the history view (feed=host) and ?json=
  // pages have no status at all and show the sheet as before.
  var statusDriven = httpHosted && !hostFed && !params.get('json');
  var statusApplied = false;
  var stageElement = document.getElementById('stage');
  if (statusDriven && stageElement) stageElement.classList.add('awaits-status');

  // The sheet itself - which protocol to draw this lane with, the theme XML
  // behind it, the GSX training layout, the ShowPins picture and the VBS-T
  // OnScoring overlay - is vbssheet.js, shared with the HTML web console
  // (..\console\TouchConsole.html). Everything from here down is what this page
  // adds on top of it: how the lane file reaches the page, the lane status
  // machine and the media layer over the sheet, and rasterising the sheet for
  // the slave.
  //
  // The query string is read here rather than inside vbsSheet because it is this
  // page's URL and not the sheet's. The console takes the same settings from its
  // own address and passes the same names in, which is what keeps two screens on
  // one lane drawing the same thing.
  var bgOverride = params.get('bg');
  var pinsOverride = params.get('pins');

  vbsSheet.init({
    sheet: sheet,
    fileSheet: document.getElementById('sheetForFile'),
    protocol: params.get('protocol'),
    compProtocol: params.get('compprotocol'),
    // undefined, not null: null is a legitimate answer meaning "draw on black",
    // and only an absent ?bg= may fall back to the default background.
    background: (bgOverride === null) ? undefined : bgOverride,
    backgroundLocked: bgOverride !== null,
    language: params.get('lang') || 'Svenska',
    showBallSpeed: params.get('speed') === '1',
    hideStrikeSequence: params.get('hidestrike') !== '0',
    alwaysShowLaneSum: params.get('lanesum') === '1',
    showMaxGame: params.get('maxgame') === '1',
    // LoadCom's /html/onscoring answers only where LoadCom is the server.
    serverSide: httpHosted && !hostFed,
    onStatus: setStatus
  });

  // The live options object, so the payload handler below can set waitingSpace
  // and showPinsEnabled on it exactly as it did when it was declared here.
  var options = vbsSheet.options;

  // Which of the settings the slave sends this page's address pins - see
  // vbsSheet.applySlaveSettings.
  var pinnedSettings = {
    hideStrikeSequence: params.get('hidestrike') !== null,
    alwaysShowLaneSum: params.get('lanesum') !== null,
    showBallSpeed: params.get('speed') !== null,
    showMaxGame: params.get('maxgame') !== null
  };

  function render() {
    vbsSheet.render();
  }

  function setStatus(message) {
    statusBar.textContent = message || '';
  }

  // Accepts the lane file as text or as an already parsed object. Exposed
  // because it is the host's contract: CRestoreHistoryLaneFile pushes the lane
  // file in with a web message, and may also call this directly with
  // ExecuteScript. Kept on this page rather than in vbsSheet because of the one
  // thing it does that drawing does not - deciding whether this screen owes the
  // slave a picture of the sheet.
  window.vbsRenderLaneJson = function (payload) {
    var json = vbsSheet.setLaneJson(payload);
    if (json) maybeSendVtvImage(json);
  };

  // --- WebView2 ----------------------------------------------------------
  //
  // Host -> page carries the lane file, and nothing else. The host used to also
  // send a "backup" command and read the rasterised sheet back out to write it
  // into C:\Backup\AutoCopy; that is gone, and the sheet is now rasterised on
  // the slave by the lane screen itself - see below.
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', function (event) {
      window.vbsRenderLaneJson(event.data);
    });
  }

  // --- the lane's scoresheet image, slave side ---------------------------
  //
  // The sheet as a picture, on disk. The XML renderer produces one in OpenPlay,
  // which draws the protocol with GDI+ and writes
  // C:\Viking2001\GameCtrl\VTVFile<n>.jpg on every screen update
  // (Slave/OPENPLAY/Game.cpp); the reception reads that file over SMB. Nothing on
  // the slave can rasterise an HTML sheet, so a screen that draws in the browser
  // has to produce its own: the SVG is rasterised to a JPEG and posted to
  // LoadCom's HTML service, which writes that very same VTVFile<n>.jpg
  // (HtmlRequestHandler::VtvImage in Slave/LOADCOM/LoadComWebInterface.cpp).
  //
  // The same file, and still only ever one writer. "Use HTML protocol" on the
  // reception's Setup/Web page picks one of the two renderings for the whole hall
  // - the slave hands out only that one's screens and redirects to it - and
  // OpenPlay skips its own write of this file when the HTML one is selected. So
  // the reception, COMTV and everything else that reads GameCtrl\VTVFile<n>.jpg
  // over SMB get this sheet without a second code path. It was ".html.jpg" while
  // both renderings ran side by side and either might be live.
  //
  // Note that is the file on disk only. A GET for VTVFile<n>.jpg is answered from
  // shared memory with whatever is on the lane display, which stays OpenPlay's
  // under both settings - the console's Messaging and no-game screens need it.
  //
  // Trigger and gate are the C++ ones, taken from the lane file itself:
  // laneDataModifiedTime changing is what OpenPlay compares against, and the
  // three laneStatus values are exactly CGCI_info::IsLaneScoring. So a sheet is
  // sent once per change while the lane is being bowled, not once per render.
  // Keeping the decision here rather than having the server flag it avoids
  // one-shot state on the server that two screens watching one lane would race
  // for - if both post, both post the same sheet and the second write simply
  // replaces the first.
  //
  // Only when this page is served over http, i.e. by the slave that owns the
  // lane. Under WebView2 the page is the reception's history dialog, which is
  // reviewing lane files rather than showing a live lane and must never write a
  // lane's current scoresheet.
  var GCI_SCORING_STATUS = { 1: true, 2: true, 10: true };   // Timeplay, Gameplay, Tournament
  var lastSentTime = null;
  var sendInFlight = false;

  // The width to rasterise at is v3GfxSaveImagesResX - the same registry value
  // the XML renderer resizes VTVFile<n>.jpg to before saving
  // (ScorerSettings::m_VTVimageResX, used by CGame::RenderScreen2 in
  // Slave/OPENPLAY/Game.cpp). A browser cannot read a registry, so the slave puts
  // it in the payload as vtvImageResX. One knob for both files: a hall that turns
  // the saved sheet up or down gets it on the XML and the HTML sheet alike.
  //
  // The XML path also refuses to *upscale* - it saves its 1920-wide render
  // untouched when the setting is wider than that. There is nothing to carry over
  // here: this sheet is vectors and has no resolution of its own, so it is
  // rasterised at exactly the width asked for.
  var IMAGE_WIDTH_DEFAULT = 960;    // the registry default, used by an older slave
  var imageWidth = IMAGE_WIDTH_DEFAULT;

  function setImageWidth(value) {
    var w = parseInt(value, 10);
    if (!(w > 0)) w = IMAGE_WIDTH_DEFAULT;
    // A canvas of an absurd size throws instead of producing a file, and the POST
    // is capped at 4 MB on the slave, so a mistyped registry value must not take
    // the sheet down with it.
    imageWidth = Math.min(Math.max(w, 320), 3840);
  }

  // The banner strip follows the banner height set on the reception's Video3
  // page, so one setting sizes the banner on V3 and web lane screens alike. The
  // slave sends it as bannerHeight, in a V3 screen's 480 rows (v3GfxClipBanner).
  // 23 rows is the slave's default for that setting (ScorerSettings), and it is
  // the strip this page has always drawn, so that is scale 1 - a hall on the
  // default sees no change - and TakTV.css multiplies every banner measurement
  // by --banner_scale.
  //
  // 0 to 2 rows is no banner on V3 (Commercial draws none below 3), and 0 is
  // also what the Video3 page stores when nobody typed a height. The strip then
  // keeps the size it has always had: it carries the network error and the
  // clock, and a hall that has no V3 banner has not asked to lose those. So does
  // an older slave that sends no such field, and a page the reception's own
  // window feeds, which is handed the lane file and never a status payload.
  // Above 120 rows - a quarter of the screen - it stops growing, so a mistyped
  // value cannot leave no room for the sheet.
  //
  // This is applyBannerHeight from ..\..\TV\js\TakTV.js, the XML lane TV's -
  // the same deliberate pair as acceptPayload and vbsAcceptPayload. Change one
  // and change the other.
  var BANNER_ROWS_DEFAULT = 23;
  var BANNER_ROWS_MAX = 120;
  var bannerScaleApplied = '';

  function applyBannerHeight(value) {
    var rows = parseInt(value, 10);
    var scale = (isNaN(rows) || rows <= 2) ? '' : String(Math.min(rows, BANNER_ROWS_MAX) / BANNER_ROWS_DEFAULT);
    if (scale === bannerScaleApplied) return;
    bannerScaleApplied = scale;

    // Removed rather than set to 1, so the stylesheet's own value is what
    // applies when the setting says nothing.
    if (scale === '')
      document.documentElement.style.removeProperty('--banner_scale');
    else
      document.documentElement.style.setProperty('--banner_scale', scale);
  }

  // Follow the rendered composition, not the protocol: a bottom panel makes the
  // sheet taller than y_generate (Viking is 640x570 once the team-sums or
  // OnScoring panel is on), and sizing from the protocol alone letterboxes the
  // image instead of filling it. The width is the setting and the height follows
  // from the composition, so a 16:9 one comes out at exactly the ResX x ResY the
  // XML renderer writes.
  function imageSize(source) {
    var w = imageWidth;
    var viewBox = (source.getAttribute('viewBox') || '').split(/[\s,]+/);
    var vbWidth = parseFloat(viewBox[2]);
    var vbHeight = parseFloat(viewBox[3]);
    if (vbWidth > 0 && vbHeight > 0) return { w: w, h: Math.round(w * vbHeight / vbWidth) };

    var drawn = vbsSheet.protocolForLane(vbsSheet.laneJson());
    return { w: w, h: Math.round(w * drawn.y_generate / drawn.x_generate) };
  }

  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(',');
    var binary = window.atob(dataUrl.substring(comma + 1));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }

  function maybeSendVtvImage(json) {
    if (readOnly || !httpHosted || typeof vbsExportSheetJpeg !== 'function') return;
    if (!GCI_SCORING_STATUS[parseInt(json.laneStatus, 10)]) return;

    var modified = String(json.laneDataModifiedTime);
    if (modified === lastSentTime) return;

    // A rasterise takes longer than the gap between two quick balls can be. Skip
    // rather than queue: the next payload carries the newer sheet anyway, and
    // queueing would leave an older sheet to be written last.
    if (sendInFlight) return;

    lastSentTime = modified;
    sendInFlight = true;

    // Drawn fresh, without the effects - the file is history and has to show the
    // scoring sheet and the OnScoring panel, whatever is momentarily on screen.
    var source = vbsSheet.capture();
    var size = imageSize(source);
    vbsExportSheetJpeg(source, size.w, size.h, 0.85)
      .then(function (dataUrl) {
        return fetch('/html/vtvimage?lane=' + laneParam(), {
          method: 'POST',
          body: dataUrlToBlob(dataUrl)
        });
      })
      .then(function (r) {
        // The answer is read to the end although only the status matters. An unread response keeps
        // the whole request alive in the browser - its JPEG body and the shared-memory buffer that
        // carried it - for as long as the page is open, one per ball. Measured in the stress test of
        // 2026-09-25: one lane TV in Edge held 6,706 such 2 MB buffers after 6.7 h, 13.9 GB of the
        // machine's commit, and edge://blob-internals showed every uploaded JPEG still referenced.
        return r.text().then(function () {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          sendInFlight = false;
        });
      })
      .catch(function (error) {
        sendInFlight = false;
        // Deliberately not shown on the sheet. This screen is customer facing and
        // the scoring on it is perfectly good without the image file - the XML
        // path takes the same view, logging the failure and carrying on.
        if (window.console) console.warn('Lane image not saved', error);
      });
  }

  // --- the lane status machine -------------------------------------------
  //
  // Straight port of fetchLaneStatus in ..\..\TV\js\TakTV.js, which is what the
  // XML lane TV runs, driven off the same 1 Hz tick and reading the same fields
  // out of the same payload. Every state, every counter and every media path is
  // the one that screen uses; the media files are the same files, not copies.
  //
  // Two adaptations, both forced by this renderer drawing the sheet instead of
  // fetching it as a picture:
  //
  //  * The XML screen tracks `laneImgIndex` - laneImageModifiedTime, stamped
  //    when OpenPlay last wrote VTVFile<n>.jpg - to know that a newer sheet
  //    exists. This one draws from the lane data, so it tracks
  //    `laneDataModifiedTime`, the stamp of the data it draws from. Using
  //    laneImgIndex here would make the HTML screen wait on the XML renderer's
  //    write, which is precisely the coupling the two modules must not have.
  //    It stays the right marker in the two states that show the lane display
  //    as a picture rather than drawing it - see LANE_IMAGE below.
  //  * "Show the scoring sheet" is a pseudo-media, so it still goes through
  //    vbsPlayMedia and gets the same de-duplication and the same treatment
  //    behind a playing video.
  //
  // The media live where the XML lane TV keeps them and are read from there
  // rather than copied: shared input, which is fine, as against a shared output
  // file, which is not. Paths are relative to this page,
  // /web/screen/HTML/TakTV/.
  var COMMERCIAL_PATH  = '../../common/commercial/';
  var DEFAULT_IMAGE    = '../../common/img/VBSBowling_Dont_Move_or_Edit.jpg';
  var START_CONSOLE    = '../../common/img/StartConsole.png';
  var ANIMATION_PATH   = '../../TV/media/';
  var SLOW_WAITING_PATH = '../../TV/SlowWaitingMedia/';
  var OPENPLAY_EXTRA_PATH = '../../TV/OpenPlayExtra/';

  // The lane display itself, as a picture, and the one thing on this screen the
  // HTML renderer does not draw. CGdiMON stamps whatever is on that display
  // into shared memory, and the static handler recognises the VTVFile<n>.jpg
  // name on either port (shared/httpd/request_handler.cpp) and answers from
  // there - so this is exactly the picture the XML lane TV shows.
  //
  // Two states need it, and in both the pixels exist nowhere else:
  //
  //  * Messaging. The message is composed by Commercial.exe (DisplayMessage,
  //    Slave/COMMERCIAL/GameStart.cpp) straight into that image, and only its
  //    end time reaches the web payload - the text never does.
  //  * A lane switched on with a game console and no game. What is on the
  //    display then is OpenPlayConsole's own "Spelarnamn" screen, drawn with a
  //    GUI toolkit rather than from XML, with the names as they are typed.
  //
  // Both would need their producer to publish something before they could be
  // drawn here; neither does today.
  var LANE_IMAGE = '../../common/gamectrl/VTVFile';

  var lanePayload = null;      // most recent status payload, whole
  var SlowMediaPlayTime = 0;
  var inactiveTimeLaneOn = 0;
  var oldLaneImgIndex = 0;

  // The hall runs one of two renderings of these screens and the reception can
  // switch between them while they are running ("Use HTML protocol" on
  // Setup/Web). Every payload says which is selected, so a page that is the
  // wrong one reloads itself and LoadCom answers that reload with a 302 to the
  // right page on the right port (ResolveScreenPage in
  // Slave/LOADCOM/LoadComWebInterface.cpp). Nothing here knows any URL but its
  // own; the mapping between the two lives once, in the C++.
  //
  // This is vbsFollowProtocolSwitch from ..\..\common\js\commonAPI.js, which
  // this page is the one screen not to load - the same deliberate pair as
  // acceptPayload and vbsAcceptPayload. Change one and change the other.
  //
  // One difference, and it is not an oversight: the twin is opt-in
  // (window.vbsFollowsProtocolSwitch) because commonAPI.js is also loaded by
  // pages the switch does not govern - the check-in kiosk and the VBSmechanic
  // remote both subscribe to the payload and must never reload on a switch.
  // This file is loaded by the HTML lane TV and by nothing else, so there is
  // no page here that could be told to follow a switch it has no part in.
  var PROTOCOL_RELOAD_KEY = 'vbsProtocolSwitch';
  var lastProtocolSeen = null;

  function followProtocolSwitch(payload) {
    var wanted = payload && payload.useHtmlProtocol;
    if (wanted !== 'Yes' && wanted !== 'No') return;  // older slave, field absent

    // Every payload carries the field and the pump ticks four times a second,
    // so everything below runs only when the value actually moves - once on the
    // first payload and once per switch. Otherwise the session-storage write
    // further down would happen at 4 Hz for as long as the screen is on.
    if (wanted === lastProtocolSeen) return;
    lastProtocolSeen = wanted;

    // readOnly is hostFed or readonly=1 - a window watching this lane from
    // somewhere else, which asked for this rendering and which the server
    // exempts from the redirect for the same reason. Reloading it would only
    // make it flash.
    if (readOnly) return;

    // A framed page belongs to a composition its parent chose (TakTVWall), and
    // no composition page is in the server's table - so moving the children
    // alone would leave a wall of one rendering full of frames of the other.
    try { if (window.top !== window) return; } catch (error) { return; }

    // Without session storage there is no way to stop the reload repeating, so
    // the feature turns itself off rather than spin a lane TV forever. F5 works.
    var store = null;
    try { store = window.sessionStorage; } catch (error) { store = null; }
    if (!store) return;

    // Derived from the path, not a constant: the HTML rendering is exactly the
    // pages under /HTML/, which is what the server matches on too. Always true
    // for this file today - it is kept in the same shape as its twin so the two
    // stay readable side by side.
    var isHtmlPage = window.location.pathname.toUpperCase().indexOf('/HTML/') >= 0;
    if (isHtmlPage === (wanted === 'Yes')) {
      store.removeItem(PROTOCOL_RELOAD_KEY);          // armed for the next switch
      return;
    }

    // Once per value, never in a loop: if the reload comes back as this same
    // page, the other service is not running and the server declined to send us
    // there, so trying again would never stop.
    if (store.getItem(PROTOCOL_RELOAD_KEY) === wanted) return;
    store.setItem(PROTOCOL_RELOAD_KEY, wanted);

    console.log('Lane screens switched to the ' + (wanted === 'Yes' ? 'HTML' : 'XML')
      + ' rendering, reloading to follow');
    window.location.reload();
  }

  // Every payload also carries appInstance, a value the slave settles once when it
  // starts and never changes afterwards (http::server::AppInstanceId). A screen that
  // watches it change has been talking to one process and is now talking to another:
  // LoadCom was restarted under it, which on a customer's machine is what a release
  // update looks like. So the page reloads, and the scripts it goes on running are
  // the ones the installer just wrote rather than what the browser cached months ago
  // - a lane TV is switched on once and left alone, and nobody walks round the hall
  // pressing F5 on sixteen of them.
  //
  // A plain reload is enough and a cache-buster is deliberately not used: httpd
  // answers every static file with an ETag and Cache-Control: no-cache, so a reload
  // revalidates each one and gets what is on disk now.
  //
  // This is vbsFollowAppRestart from ..\..\common\js\commonAPI.js, which this page is
  // the one screen not to load - the same deliberate pair as followProtocolSwitch
  // above. One difference, and it is not an oversight: the twin there can be told to
  // hold the reload back (window.vbsReloadIsUnsafe), because that file is also loaded
  // by the check-in kiosk, which must not be reloaded with a customer halfway through
  // typing names into it. There is nothing on a lane TV a reload can interrupt, so
  // this side has no such hook.
  var RELOAD_SPREAD_MS = 2000;   // so a wall of screens does not reload in one instant
  var appInstanceSeen = null;
  var reloadArmed = false;

  function followAppRestart(payload) {
    var instance = payload && payload.appInstance;
    if (typeof instance !== 'string' || instance === '') return;  // older slave

    // The first payload is the baseline and never a reload: this page was served by
    // whichever process is answering now, so it already runs that version's files.
    if (appInstanceSeen === null) {
      appInstanceSeen = instance;
      return;
    }

    if (instance === appInstanceSeen) return;
    appInstanceSeen = instance;

    if (reloadArmed) return;   // armed once, however many payloads go on saying so
    reloadArmed = true;

    console.log('Reloading: the slave was restarted (' + instance + ')');
    window.setTimeout(reloadNow, Math.floor(Math.random() * RELOAD_SPREAD_MS));
  }

  function reloadNow() {
    // A composition page is a shell of iframes that subscribes to no payload of its
    // own, so nothing in it would ever notice a restart. Reloading the top window
    // rather than this frame is what gets the shell's own HTML and script replaced
    // too. A frame whose parent is not one of ours cannot reach it and reloads
    // itself, which is still right - it leaves the stranger's page alone.
    //
    // Reading window.top.document is what settles whether the parent is ours.
    // Testing window.top.location would look right and be wrong: Location is one
    // of the few things reachable across origins - only its members throw - so a
    // stranger's frame would pass, take the branch and then throw on the hash
    // below with nothing left to catch it. Same test canUseEventStream makes.
    var target = window;
    try {
      if (window.top !== window && window.top.document) target = window.top;
    } catch (error) {
      target = window;   // cross-origin parent
    }

    // Every frame of a wall reaches the same top window and each arms its own reload.
    // Without this the later ones would call reload again while the navigation the
    // first one started was still running, restarting it every time.
    try {
      if (target.vbsReloadStarted) return;
      target.vbsReloadStarted = true;
    } catch (error) { /* nothing to guard with; one extra reload is harmless */ }

    // The fragment says where in the page we are, not which version we are running,
    // so it is dropped - which needs a navigation rather than reload(), and
    // location.replace revalidates exactly as reload does.
    if (target.location.hash) {
      target.location.replace(target.location.pathname + target.location.search);
      return;
    }

    target.location.reload();
  }

  function acceptPayload(payload) {
    // Before anything else: if the hall has switched rendering this page is
    // about to be replaced, so there is no point drawing a sheet on it first.
    followProtocolSwitch(payload);

    // Same reasoning, for the slave having been restarted under this page.
    followAppRestart(payload);

    // The animation is a one-shot: the server hands it over on the push that
    // carries it and the very next push has it empty. Since it is only played
    // on the 1 Hz tick, and the pump ticks four times a second, a plain
    // overwrite would drop most of them. Carry it forward until the tick has
    // played it - the same thing vbsAcceptPayload does in commonAPI.js.
    if (lanePayload && lanePayload.animation && !payload.animation)
      payload.animation = lanePayload.animation;

    lanePayload = payload;

    // The six name boxes, if names are being typed at this lane right now. Here
    // rather than on the 1 Hz tick because a name has to appear as it is typed,
    // and here rather than in the status machine because it is not a lane state
    // at all - it draws over the media area and leaves everything under it
    // running exactly as before. See vbsnameentry.js.
    vbsUpdateNameEntry(payload);

    // Both of these come from the slave because a browser cannot read them for
    // itself, and both are settled before the sheet is drawn from this payload.
    vbsSheet.setBackground(payload.background);
    // The lane's own language (laneLang) - OpenPlay draws each lane in its own; "lang" is the
    // slave's, and is what an older slave sends.
    ensureLanguage(payload.laneLang || payload.lang);
    if (vbsSheet.applySlaveSettings(payload, pinnedSettings)) render();

    // LC_WAIT_SPACE. Read here rather than in the status machine because it is
    // drawn *on the sheet*, by the theme's own MessageInfo.xml, not by the media
    // layer over it.
    options.waitingSpace = (payload.waitingSpace === 'Yes');

    // v3gfxShowFullScreenRemainingPins. Absent on an older slave, and then the
    // picture stays off rather than being shown where the setting says not to.
    options.showPinsEnabled = (payload.showPins === 'Yes');

    // v3GfxPinsOnScoring: the style of the small rack of pins left standing that
    // is drawn on the sheet itself, which the theme pulls in as
    // #PINS_ON_PROTOCOL#. A different setting from the one above and not a
    // switch for it - the C++ keeps m_showPins on every ball whatever the
    // full-screen picture is set to, and this rack is what reads it - so a hall
    // with the picture turned off still sees the pins on the protocol.
    // Machine-wide registry value the browser cannot read, so the slave says it;
    // ?pins= pins one for a single screen, the way ?bg= and ?protocol= do.
    vbsSheet.setPinsOnScoring(pinsOverride !== null ? pinsOverride : payload.pinsOnScoring);

    // v3GfxSaveImagesResX: the width VTVFile<n>.jpg is written at, whichever of
    // the two renderings is the one writing it - the XML side sizes its GDI+
    // render by the same setting. Absent on an older slave, and then the registry
    // default is used - see setImageWidth.
    setImageWidth(payload.vtvImageResX);

    // v3GfxClipBanner: how tall the banner strip is. Here rather than on the
    // 1 Hz tick so the first frame already has the strip at its size.
    applyBannerHeight(payload.bannerHeight);

    // Absent while the lane has no shared memory mapped - before the first
    // game of the day, typically. The status alone is still a valid message,
    // so the media loop below still runs on it.
    if (!payload.lane)
      setStatus('Waiting for lane data...');
    else
      window.vbsRenderLaneJson(payload.lane);

    // The FIRST status is applied as it arrives instead of on the next tick, so the
    // screen goes straight to what the lane is doing - the commercial starts loading
    // now, a game in progress is shown now. Only the first: from then on the status
    // machine runs on the tick as before, because its counters are counted in ticks.
    if (!statusApplied) applyStatusNow();
  }

  // The hall's own .lang file, fetched once - but only when there is a server to
  // fetch it from. Under WebView2 the page is the reception's history dialog and
  // every such request 404s, so the built-in fallback table is used as it stands.
  // That gate is this page's, which is why it is here and not inside vbsSheet:
  // the console is always served over http and always asks.
  function ensureLanguage(language) {
    if (!httpHosted) return;
    vbsSheet.ensureLanguage(language);
  }

  function applyLaneStatus(data) {
    var laneStatus = data.lanestatus || '';

    if (vbsCurrentLaneStatus() !== laneStatus) oldLaneImgIndex = 0;

    if (laneStatus === 'Messaging') {
      if (data.laneImgIndex !== oldLaneImgIndex) {
        oldLaneImgIndex = data.laneImgIndex;
        vbsPlayMedia(LANE_IMAGE + laneParam() + '.jpg?index=' + oldLaneImgIndex, laneStatus);
      }
    }
    else if (laneStatus === 'Commercial') {
      if (data.commercial === 'NoThingToPlay')
        vbsPlayMedia(DEFAULT_IMAGE, laneStatus);
      else
        vbsPlayMedia(COMMERCIAL_PATH + data.commercial, laneStatus);
    }
    else if (laneStatus === 'Playing') {
      // Slow-waiting media is holding the screen; nothing else may take it,
      // and - as on the XML screen - the banner is not refreshed either.
      if (--SlowMediaPlayTime >= 0) return;

      if (data.laneDataModifiedTime !== oldLaneImgIndex) {
        oldLaneImgIndex = data.laneDataModifiedTime;
        vbsPlayMedia(VBS_SHEET + oldLaneImgIndex, laneStatus);
        inactiveTimeLaneOn = 0;
      }
      else
        playSlowWaiting(data.slowWaitingMedia, laneStatus);

      if (data.animation) {
        vbsPlayMedia(ANIMATION_PATH + data.animation, laneStatus);
        inactiveTimeLaneOn = 0;
      }

      // The extra media plays in a two-second window once every ten minutes,
      // staggered by lane so a row of screens does not all start together:
      // odd lanes on their own digit, even lanes four minutes later.
      if (data.openPlayExtraMedia) {
        var now = new Date();
        var laneDigit = laneParam() % 10;
        var minute = now.getMinutes() % 10;

        if (laneDigit % 2) {
          if (laneDigit === minute && now.getSeconds() <= 2)
            vbsPlayMedia(OPENPLAY_EXTRA_PATH + data.openPlayExtraMedia, laneStatus);
        }
        else {
          if (laneDigit + 4 === minute && now.getSeconds() <= 2)
            vbsPlayMedia(OPENPLAY_EXTRA_PATH + data.openPlayExtraMedia, laneStatus);
        }
      }
    }
    else if (laneStatus.indexOf('NoPlayer') === 0) {
      if (--SlowMediaPlayTime >= 0) return;

      if (laneStatus.indexOf('Loki2') > 0) {
        if (laneStatus.indexOf('BaseConsole') > 0) {
          vbsPlayMedia(START_CONSOLE, laneStatus);
          return;
        }

        // The lane image, not a sheet drawn here - and the second place this
        // screen shows a picture it did not draw, for the same kind of reason
        // as Messaging. What is on the lane display in this state is
        // OpenPlayConsole's own screen: the "Spelarnamn" form with the names
        // as they are being typed (CStartGameNew, Slave/NewOpenPlayConsole),
        // drawn with its GUI toolkit rather than from any XML, and held in
        // that process. None of it reaches a lane file, so there is nothing to
        // render from - CGdiMON stamps the lane display into shared memory and
        // this is the only way to see it. Note it is deliberately the *image's*
        // stamp that is tracked here, laneImgIndex, and not laneDataModifiedTime
        // as everywhere else: the picture changes on every keystroke, and the
        // lane data does not change at all.
        if (data.laneImgIndex === oldLaneImgIndex) return;

        oldLaneImgIndex = data.laneImgIndex;
        vbsPlayMedia(LANE_IMAGE + laneParam() + '.jpg?index=' + oldLaneImgIndex, laneStatus);
      }
      // vbsPlayMedia answers undefined when it drops a repeat, so this reads
      // as "StartConsole is already up" - and that is when the inactivity
      // counter towards the slow-waiting media is allowed to run.
      else if (!vbsPlayMedia(START_CONSOLE, laneStatus))
        playSlowWaiting(data.slowWaitingMedia, laneStatus);
    }

    vbsPlayBottomText(navigator.onLine ? data.banner : 'Network Error or Busy');

    // Reached only when no media call updated it - the branches above that
    // change nothing still have to record the state they saw, or the reset at
    // the top would fire again on the next tick.
    vbsSetLaneStatus(laneStatus);

    function playSlowWaiting(media, laneStatus) {
      if (media === undefined) return;

      if (++inactiveTimeLaneOn > data.slowWaitingTime) {
        vbsPlayMedia(SLOW_WAITING_PATH + media, laneStatus);
        inactiveTimeLaneOn = 0;
        SlowMediaPlayTime = data.slowPlayingTime;
        oldLaneImgIndex--;      // so the sheet is redrawn when the media ends
      }
    }
  }

  // The 1 Hz tick. Everything the screen does on a schedule hangs off this one
  // timer, exactly as on the XML lane TV: the clock, the play-time box on the
  // sheet, the inactivity counters and the OpenPlayExtra window are all counted
  // in ticks, so driving them off payload arrival instead would silently change
  // every one of those timings.
  function tick() {
    // Unlike the XML screen, which only starts its clock once a payload has
    // arrived, this ticks from the first second. A stopped clock on a lane TV
    // reads as a broken screen, and nothing else depends on it.
    vbsDisplayTime();

    // Keeps the countdown in the play-time box moving between payloads.
    render();

    if (!lanePayload) return;

    applyStatusNow();
  }

  function applyStatusNow() {
    statusApplied = true;
    try {
      applyLaneStatus(lanePayload);
    } finally {
      // Played once. Cleared in a finally so a handler that throws cannot
      // leave an animation replaying on the lane TV until someone reloads.
      if (lanePayload.animation) lanePayload.animation = '';
      sheetDue();
    }
  }

  // Brings the sheet into sight once the media layer says the sheet is what this
  // screen shows (vbsMediaUnder, vbsmedia.js) - Playing, normally on the very first
  // status. Under a commercial, a message or StartConsole it stays hidden; they cover
  // it anyway, and it comes into sight the first time the lane is played.
  function sheetDue() {
    var stage = document.getElementById('stage');
    if (stage && stage.classList.contains('awaits-status') && vbsMediaUnder === VBS_SHEET)
      stage.classList.remove('awaits-status');
  }

  // --- server-sent events ------------------------------------------------
  //
  // The live path. LoadCom pushes when the lane changes rather than the screen
  // asking on a timer: a lane that is not being bowled costs nothing at all, and
  // a ball reaches the sheet as soon as the pump notices it instead of up to a
  // poll interval later.
  //
  // Deliberately self-contained rather than reusing common/js/commonAPI.js. That
  // file is the transport for the JPEG screens and it needs jQuery, a #clock and
  // an #imageFx to exist; this page has none of them, and it must also run with
  // no server at all under WebView2. The reconnect handling below is the one
  // piece worth copying from it, for the reason spelled out in the handler.
  //
  // The payload is the lane status with the lane file nested under "lane" - see
  // BuildPayload in Slave/LOADCOM/LoadComWebInterface.cpp. Only "lane" is drawn
  // here; the rest is what a media-loop page (or a future HTML console) reads
  // from the very same message.
  var eventSource = null;

  // Which lane this screen shows. Remembered in two places, and the difference between
  // them is the whole point: a lane display is set up once with ?lane=<n> and must come
  // back on the same lane if it is later opened without one.
  //
  //   sessionStorage - this tab, and nothing else. Survives a reload, dies with the tab.
  //   cookie         - the whole browser. Survives the browser being closed.
  //
  // The cookie alone is too wide a scope, and that only became a fault when pages
  // started reloading themselves. A cookie belongs to the browser rather than to one
  // screen - no path is named below, so it defaults to this page's own directory
  // (RFC 6265 5.1.4) and every tab showing this same screen shares one value. A second
  // tab opened on ?lane=2, a screen being set up or a technician checking another lane,
  // is enough to rewrite what the first one picks up next.
  // Before vbsFollowAppRestart (r17446/r17447) that hardly mattered, because a lane TV
  // is switched on once and never reloaded, so it kept the lane it started with for
  // months. Now every LoadCom restart reloads it, and it would re-read the cookie and
  // silently move to whichever lane was looked at last - a screen on the wall quietly
  // showing the wrong lane, with nothing on it saying so.
  //
  // Measured 2026-08-21: two tabs of one browser, the first opened ?lane=2 and the
  // second opened with no parameter at all; LoadCom logged both as "HTML event stream
  // requested, Lane2".
  //
  // So the tab's own answer wins, and is pinned on first load whichever way it was
  // reached. The cookie keeps doing what it was for - the bare start page a browser
  // reopens after an update - because that is a new tab, which has no session of its own.
  function laneParam() {
    return laneNumber;
  }

  // A framed page is left out of the session half entirely: its lane comes from the
  // composition's own HTML (TakTVWall), which is refetched whenever the shell reloads,
  // so it cannot drift and needs no pin - and every frame of one wall shares one
  // sessionStorage, so pinning from them would be eight screens overwriting each other.
  function lanePinnable() {
    try {
      return window.top === window;
    } catch (error) {
      return true;   // cross-origin parent, so not one of our compositions
    }
  }

  function pinLane(lane) {
    if (!lanePinnable()) return;

    try {
      window.sessionStorage.setItem('lane', String(lane));
    } catch (error) { /* storage refused; the cookie still answers as it always did */ }
  }

  // Both may be refused (private mode, storage disabled, a WebView2 host): the query
  // string still works and the lane simply is not remembered.
  function rememberLane(lane) {
    pinLane(lane);

    try {
      var expires = new Date();
      expires.setTime(expires.getTime() + (99 * 24 * 60 * 60 * 1000));
      document.cookie = 'lane=' + lane + ';expires=' + expires.toUTCString();
    } catch (error) { /* cookies refused - the query string still works */ }
  }

  var laneNumber = (function () {
    var asked = parseInt(params.get('lane'), 10);
    if (!isNaN(asked) && asked >= 1) {
      rememberLane(asked);
      return asked;
    }

    // What this tab settled on the first time it was opened, which a reload must not
    // be able to change and another tab must not be able to reach.
    if (lanePinnable()) {
      var mine = NaN;
      try {
        mine = parseInt(window.sessionStorage.getItem('lane'), 10);
      } catch (error) { /* no session storage; fall through to the cookie */ }
      if (!isNaN(mine) && mine >= 1) return mine;
    }

    var stored = document.cookie.match('(^|;) ?lane=([^;]*)(;|$)');
    var remembered = stored ? parseInt(stored[2], 10) : NaN;
    if (isNaN(remembered) || remembered < 1) remembered = 1;

    // Pin it to this tab now, so a ?lane= opened elsewhere later cannot move this screen
    // at the next reload. Deliberately not written back to the cookie: this tab was
    // never told which lane to show, so it has nothing to teach the next one.
    pinLane(remembered);

    return remembered;
  }());

  function openEventStream() {
    // /html/ is the HTML service's own root on port 24324, deliberately not the
    // /console/ endpoints that the XML/image screens use in production on 24321.
    // The two services are kept apart end to end: separate handler, separate
    // port, separate event pump. See HtmlRequestHandler in
    // Slave/LOADCOM/LoadComWebInterface.cpp.
    var url = '/html/events?lane=' + laneParam();
    eventSource = new EventSource(url);

    eventSource.onmessage = function (event) {
      var payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        setStatus('Bad event payload: ' + error.message);
        return;
      }

      acceptPayload(payload);
    };

    eventSource.onerror = function () {
      // `this` rather than the global on purpose. By the time a late error
      // arrives the global may already be a different stream (we reopened), and
      // reading it would schedule a second reconnect - leaving two live streams
      // for one page, each holding one of the browser's six connections.
      var source = this;
      if (source !== eventSource) return;

      // A dropped connection leaves readyState CONNECTING and the browser
      // retries on its own, which is the normal case for a lane TV on flaky wifi
      // or across a LoadCom restart. CLOSED means it gave up - the request was
      // refused - and only that needs help.
      if (source.readyState !== EventSource.CLOSED) return;

      eventSource = null;
      setStatus('Lane data unavailable, reconnecting...');
      window.setTimeout(openEventStream, 3000);
    };
  }

  // --- http polling ------------------------------------------------------
  var jsonUrl = params.get('json');

  function startPolling(url) {
    var pollMs = parseInt(params.get('poll'), 10);
    if (isNaN(pollMs) || pollMs < 100) pollMs = 1000;

    var fetchOnce = function () {
      // cache-bust: the lane file changes on every ball and LoadCom serves it
      // without a validator
      fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now())
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(window.vbsRenderLaneJson)
        .catch(function (error) { setStatus('Lane data unavailable: ' + error.message); });
    };

    fetchOnce();
    window.setInterval(fetchOnce, pollMs);
  }

  // The polled fallback, for a browser with no EventSource. It asks
  // /html/lanedata.json, which exists for exactly this and is built by the same
  // producer as the stream, so the two cannot drift. Same one-second interval
  // the XML screens polled at.
  function startStatusPolling() {
    var fetchOnce = function () {
      fetch('/html/lanedata.json?lane=' + laneParam() + '&t=' + Date.now())
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(acceptPayload)
        .catch(function (error) { setStatus('Lane data unavailable: ' + error.message); });
    };

    fetchOnce();
    window.setInterval(fetchOnce, 1000);
  }

  // A browser allows only six HTTP/1.1 connections per origin, and an event
  // stream holds one for as long as the page lives. A composition of eight lane
  // screens in iframes would take every slot with streams alone and then starve
  // everything else they share them with - the page would load once and freeze.
  // Such a page sets window.vbsNoStream in its <head>, and its children poll
  // instead. Same rule and the same reasoning as vbsCanUseEventStream in
  // ..\..\common\js\commonAPI.js.
  var MAX_FRAMES_FOR_STREAM = 4;   // six, less headroom for the other fetches

  function canUseEventStream() {
    if (typeof EventSource === 'undefined') return false;
    if (window.top === window) return true;

    try {
      // The parent's explicit opt-out, and why it exists rather than just
      // counting frames: a child can load before the parent has parsed the rest
      // of its <iframe> tags, so the count below only ever sees "however many
      // precede me" and different children reach different answers. The flag is
      // set in the parent's <head>, so it is there when the first child looks.
      if (window.top.vbsNoStream) return false;

      return window.top.document.getElementsByTagName('iframe').length <= MAX_FRAMES_FOR_STREAM;
    } catch (error) {
      return true;   // parent is cross-origin, so not one of ours
    }
  }

  if (hostFed) {
    // The host pushes the lane file in as a web message: there is nothing to
    // subscribe to and nothing to poll, and asking would only 404 in a loop.
  } else if (jsonUrl) {
    // No payload says which language the hall runs, so ?lang= does - and here it
    // names the .lang file too, not only the built-in fallback table.
    if (params.get('lang')) ensureLanguage(params.get('lang'));
    // Nor which style the small rack of pins on the sheet is drawn in, so ?pins=
    // is the only answer here: without it #PINS_ON_PROTOCOL# imports nothing, and
    // a Red Pin game had no rack before its first ball.
    if (pinsOverride !== null) vbsSheet.setPinsOnScoring(pinsOverride);
    startPolling(jsonUrl);
  } else if (httpHosted && canUseEventStream()) {
    openEventStream();
  } else if (httpHosted) {
    startStatusPolling();
  }

  // One timer for the whole screen - see tick().
  window.setInterval(tick, 1000);
  vbsDisplayTime();

  if (!vbsSheet.laneJson()) setStatus('Waiting for lane data...');
}());

var oldLaneImgIndex = 0;
var oldLaneStatus = 'Commercial';
var laneStatus;
var lane = getLane();
var videoStatus = "";       // lane status the video in #videoFx was started under
var unPlayedImage = "";
var adShowTime = 0;
var videoPlaying = false;
var picturefx = document.getElementById("imageFx");   
var infoImageIdex = 0;
var oldMedia = "";
var scoreTable = [];
var activePlayer = 0;

function setCookie(key, value) {
  var expires = new Date();
  expires.setTime(expires.getTime() + (99 * 24 * 60 * 60 * 1000));
  document.cookie = key + '=' + value + ';expires=' + expires.toUTCString();
}
function getCookie(key) {
  var keyValue = document.cookie.match('(^|;) ?' + key + '=([^;]*)(;|$)');
  return keyValue ? keyValue[2] : null;
}
// A lane remembered from somewhere other than this page's own address. It was not typed for
// this screen, so it has to be a plain positive number before anything is built from it -
// these values end up in /console/startBowling and /console/changeScore, not only in what is
// displayed. Answers the value as a string, or null. The upper bound is left to the server,
// which refuses a lane the slave does not serve; duplicating MAX_LANE here would only let the
// two drift.
function vbsSaneLane(value) {
  return /^[1-9][0-9]*$/.test(String(value)) ? String(value) : null;
}

// sessionStorage is this tab and nothing else: it survives a reload and dies with the tab,
// which is exactly the scope a screen's lane wants. The cookie is browser-wide, and that is
// the whole trouble with using it alone - see the note in getLane below.
//
// A framed page is left out of both halves on purpose. Its lane comes from the composition's
// own HTML (TakTv2x4, the TakTV_Split pages, TakTVWall), which is refetched whenever the shell
// reloads, so it cannot drift and needs no pin - and eight frames of one wall share one
// sessionStorage, so pinning from them would just be eight screens overwriting each other.
function vbsLaneIsPinnable() {
  try {
    return window.top === window;
  } catch (error) {
    return true;   // cross-origin parent, so not one of our compositions
  }
}

function vbsPinnedLane() {
  if (!vbsLaneIsPinnable()) return null;

  try {
    return vbsSaneLane(window.sessionStorage.getItem('lane'));
  } catch (error) {
    return null;   // storage refused (private mode, site data blocked)
  }
}

function vbsPinLane(lane) {
  if (!vbsLaneIsPinnable()) return;

  try {
    window.sessionStorage.setItem('lane', String(lane));
  } catch (error) { /* storage refused; the cookie still answers as it always did */ }
}

// Which lane this screen is for. The address says it; the two remembered copies answer only
// when it does not, which is how a screen set up once with ?lane=<n> comes back on the same
// lane if the address is later lost - a browser reopening a bare start page after an update.
//
// The cookie read used to be written `getCookie('lane')` with the result dropped on the floor,
// so the fallback never worked at all and a page without ?lane= always answered "1". Fixing
// that alone would have been wrong, because a cookie belongs to the browser and not to one
// screen: setCookie above names no path, so it defaults to the directory of the page that set
// it (RFC 6265 5.1.4), which means every tab showing this same screen shares one value. A
// second tab opened on ?lane=2 - a screen being set up, a technician looking at another lane -
// is therefore enough to rewrite what the first one picks up next. That hardly mattered while
// a screen was switched on once and never reloaded; since
// vbsFollowAppRestart (r17446/r17447) every service restart reloads it, and on a console that
// would mean the buttons quietly starting to act on somebody else's lane. So the tab's own
// answer is settled on first use and wins from then on, and the cookie is consulted only when
// this tab has none of its own - a genuinely new tab, which is the case it was meant for.
//
// The twin of this is the laneNumber block in ..\..\HTML\TakTV\TakTV.js, the one screen that
// does not load this file. Change one and change the other.
function getLane() {
  const urlParams = new URLSearchParams(window.location.search);
  const newParams = new URLSearchParams();
  for (const [name, value] of urlParams) {
    newParams.append(name.toLowerCase(), value);
  }
  var lane = newParams.get('lane');

  if (lane !== null && lane !== "") {
    // Handed back exactly as it was given, even if it is nonsense: the address is what the
    // operator typed for this page, and a bad one has to fail visibly at the server rather
    // than be quietly turned into lane 1, which on a console would act on the wrong lane.
    // Only a sane value is worth remembering, though.
    if (vbsSaneLane(lane) !== null) {
      setCookie('lane', lane);
      vbsPinLane(lane);
    }
    return lane;
  }

  var pinned = vbsPinnedLane();
  if (pinned !== null) return pinned;

  var remembered = vbsSaneLane(getCookie('lane'));
  if (remembered === null) return "1";

  // Settled for this tab now, so a ?lane= opened elsewhere later cannot move this screen at
  // the next reload. Not written back to the cookie: this page was never told which lane to
  // show, so it has nothing to teach the next tab.
  vbsPinLane(remembered);
  return remembered;
}
function isLaneStatusChanged(status) {
  if (oldLaneStatus === status)
    return false;
  else
  {
    oldLaneStatus = status;
    return true;
  }
}
function playMedia(media, status) {
  var statusChanged = isLaneStatusChanged(status);

  if (statusChanged)
    removeAnchorFromUrl();

  if (oldMedia !== media)
    oldMedia = media;
  else if (!statusChanged)
    return;

  console.log(media);
  if (media.indexOf(".jpg") > 0 || media.indexOf(".png") > 0)
    displayImageFx(media, status);
  else if (media.indexOf(".webm") > 0 || media.indexOf(".mp4") > 0)
    displayVideoFx(media, status);

  return true;
}

function updateStatus() {
  if (typeof fetchLaneStatus === 'function') {
    fetchLaneStatus(lane);
  }
  $('#header_text').html('Bana ' + lane);
}

// --- AJAX defaults -------------------------------------------------------------------------
//
// Every $.ajax / $.getJSON on these pages was fired with no deadline and, in all but ten of the
// 46 call sites, no error handler at all - so a request that failed did nothing and said
// nothing. An operator who pressed a button on the touch console saw the dialog close and the
// lane not react, with no way to tell whether the request had been sent, lost or refused.
//
// Setting it here rather than at each call site is deliberate: one line covers all of them,
// including pages whose own script loads after this file, and no success path changes at all.
// A call that wants its own error handling still passes error:/fail() and that still runs.
//
// The timeout is generous on purpose. It is here to bound a hung request, not to give up on a
// slow one: most of these answer in milliseconds, but a kiosk booking query can genuinely take
// seconds, and aborting a POST the server has already acted on is worse than waiting for it.
var VBS_AJAX_TIMEOUT_MS = 30000;

if (typeof $ !== 'undefined' && $.ajaxSetup) {
  $.ajaxSetup({ timeout: VBS_AJAX_TIMEOUT_MS });

  // Fires for every failed request on the page, whether or not the call site has its own
  // handler, so this is a reporting point and not a substitute for one. Pages that have
  // somewhere sensible to show a failure define vbsOnAjaxError; the default only records it,
  // because a lane TV has nowhere to put a message and must not have one thrown over the
  // scoresheet.
  $(document).ajaxError(function (event, jqXHR, settings, thrownError) {
    var reason = (jqXHR.statusText === 'timeout') ? 'timed out after ' + VBS_AJAX_TIMEOUT_MS + ' ms'
               : (jqXHR.status === 0) ? 'no connection to the server'
               : 'HTTP ' + jqXHR.status + ' ' + (thrownError || jqXHR.statusText);

    console.error('Request failed: ' + (settings && settings.url) + ' - ' + reason);

    if (typeof vbsOnAjaxError === 'function') {
      try { vbsOnAjaxError(settings && settings.url, reason, jqXHR); }
      catch (error) { console.error('vbsOnAjaxError threw:', error); }
    }
  });
}

// --- Server-Sent Events transport ---------------------------------------------------------
//
// The three screens - WebTV, WebConsole, WebInfoTV - used to ask /console/lanestatus.json for
// the whole payload once a second whether or not anything had changed. The server answers
// HTTP/1.0 without Content-Length and closes, so that was a fresh TCP connection per screen per
// second. LoadCom now pushes the identical payload, built by the identical code, over one
// connection that stays open, and only when it actually changes.
//
// What deliberately did NOT change: the 1 Hz timer at the bottom of this file still runs and
// the page handlers still do all their work from it. TakTV counts seconds with that tick - the
// clock, slowWaitingTime, the OpenPlayExtra minute window - so driving the handlers off event
// arrival instead would silently alter those timings. The tick now reads the last pushed
// payload out of memory rather than off the network; that is the only difference a page sees.
//
// Requests in the other direction are untouched. The console still calls changeScore,
// stopBowling, changePlayersInfo and the rest as ordinary one-shot $.ajax calls - the client
// already only spoke when the user pressed something, so there was never anything to fix there.
//
// A page opts in by declaring `var webSource` ('TV', 'console', 'info', 'mechanic') in its own
// script. A page that declares nothing - HTML/TakTV, which is fed by WebView2 and not by HTTP at
// all - opens no stream and is unaffected.
//
// These three are written defensively rather than assigned outright because load order is not
// consistent across the pages: the slave screens load commonAPI.js *before* their own script,
// but VBSmechanic/index.html loads it *after* Remote.js. A plain `var webSource = ''` here would
// silently wipe what that page had already set, and the stream would never open. Keeping
// whatever is already there makes the order irrelevant.
var webSource = (typeof webSource === 'undefined') ? '' : webSource;
var webSourceLane = (typeof webSourceLane === 'undefined') ? null : webSourceLane;   // info uses 127
var webEventPath = (typeof webEventPath === 'undefined') ? '/console/events' : webEventPath;
var webPollPath = (typeof webPollPath === 'undefined') ? '/console/lanestatus.json' : webPollPath;

// Interval for the fallback poll below, which is NOT the same for every page. The lane screens
// polled once a second and their endpoint reads shared memory; the kiosk polled once a minute
// and its endpoint runs a small pile of queries per call. A single hardcoded second here would
// quietly put the kiosk's database load up sixtyfold on any browser that falls back.
var webPollIntervalMs = (typeof webPollIntervalMs === 'undefined') ? 1000 : webPollIntervalMs;

var vbsLaneStatus = null;   // most recent payload pushed by the server
var vbsEventSource = null;
var vbsStatusWaiters = [];
var vbsLaneStatusVersion = 0;
var vbsSeenVersion = 0;
var vbsPayloadHandlers = [];

function vbsStreamLane() {
  return (webSourceLane === null) ? getLane() : webSourceLane;
}

// Subscribe to every payload as it arrives.
//
// For a page driven by the 1 Hz tick use withLaneStatus instead - that is what keeps TakTV's
// per-second counters and the mechanic's repeating alarm behaving exactly as they did. This is
// for a page with no tick of its own: the kiosk cancels commonAPI's timer outright, so a push is
// the only thing that can reach it. Fires immediately when a payload has already arrived, so a
// late subscriber is not left blank until the next change.
function onLaneStatus(handler) {
  vbsPayloadHandlers.push(handler);
  if (vbsLaneStatus !== null) handler(vbsLaneStatus);
}

// The hall runs one of two renderings of these screens - the XML ones under /screen/ that show a
// picture of the sheet, and the HTML ones under /screen/HTML/ that draw it - and the reception can
// switch between them while they are running ("Use HTML protocol" on Setup/Web). Every payload
// carries which one is selected, so a page that is the wrong one reloads itself; LoadCom answers
// that reload with a 302 to the right page on the right port (ResolveScreenPage in
// Slave/LOADCOM/LoadComWebInterface.cpp). The mapping between the two therefore exists in exactly
// one place, in the C++, and a page needs to know no URL but its own.
//
// Which one this page is comes from where it lives rather than from a constant somebody has to
// remember to set on every page: the HTML rendering is precisely the pages under the /HTML/
// directory, which is the same thing the server matches on.
//
// TakTV.js in ..\..\HTML\TakTV has the same function - that page is the one screen that does not
// load this file. The two are a deliberate pair, like vbsAcceptPayload and acceptPayload below;
// change one and change the other.
var VBS_PROTOCOL_RELOAD_KEY = 'vbsProtocolSwitch';
var vbsLastProtocolSeen = null;

function vbsFollowProtocolSwitch(payload) {
  // Opt-in, and it has to be: this file is loaded by pages the switch has nothing to do with,
  // and two of them subscribe to the payload - the check-in kiosk (Kiosk.js) and the VBSmechanic
  // remote (Remote.js). Neither is one of the three screens the server redirects, so neither is
  // ever "the wrong rendering"; without this test both would reload once on a switch, and doing
  // that to a kiosk under a customer who is halfway through checking in is the worse bug of the
  // two. A switchable page says so just before it loads this file.
  //
  // Forgetting the flag on a new screen costs an automatic switch, and F5 still works. Getting it
  // wrong the other way costs somebody's check-in. That is why the default is off.
  if (window.vbsFollowsProtocolSwitch !== true) return;

  var wanted = payload && payload.useHtmlProtocol;
  if (wanted !== 'Yes' && wanted !== 'No') return;   // older slave, field absent: do nothing

  // Every payload carries the field and the pump ticks four times a second, so everything below
  // runs only when the value actually moves - once on the first payload, and once per switch.
  // Without this the session-storage write further down would happen 4 Hz forever.
  if (wanted === vbsLastProtocolSeen) return;
  vbsLastProtocolSeen = wanted;

  // A window watching this lane from somewhere else asked for one particular rendering and is
  // exempt from the redirect, so it must not reload itself either - the reception's "Monitor this
  // lane" is one, and reloading it would only make it flash. The same two flags the server tests.
  var params = new URLSearchParams(window.location.search);
  if (params.get('readonly') === '1' || params.get('feed') === 'host') return;

  // A page inside a frame belongs to a composition its parent chose - the multi-lane walls, the
  // splits, TakTv2x4 - and none of those composition pages is in the server's table, so switching
  // their children alone would leave a wall of one rendering full of frames of the other. The
  // parent is the thing that would have to move, so nothing here does. Such a wall follows the
  // switch when it is next loaded.
  try { if (window.top !== window) return; } catch (error) { return; }   // cross-origin parent

  // No session storage means no way to keep the reload below from repeating, so the feature turns
  // itself off rather than risk a screen in a bowling hall reloading forever. F5 still works.
  var store = null;
  try { store = window.sessionStorage; } catch (error) { store = null; }
  if (!store) return;

  var isHtmlPage = window.location.pathname.toUpperCase().indexOf('/HTML/') >= 0;
  if (isHtmlPage === (wanted === 'Yes')) {
    store.removeItem(VBS_PROTOCOL_RELOAD_KEY);       // where we belong; arm it for the next switch
    return;
  }

  // Once per value, never in a loop. If the reload comes back as the same page - the other service
  // failed to start, so ResolveScreenPage declined to send us there and served this one instead -
  // then reloading again would spin for as long as the screen is on.
  if (store.getItem(VBS_PROTOCOL_RELOAD_KEY) === wanted) return;
  store.setItem(VBS_PROTOCOL_RELOAD_KEY, wanted);

  console.log('Lane screens switched to the ' + (wanted === 'Yes' ? 'HTML' : 'XML')
    + ' rendering, reloading to follow');
  window.location.reload();
}

// Every payload also carries appInstance, a value the service settles once when it starts and
// never changes afterwards (http::server::AppInstanceId, shared\httpd\appinstance.h). A page that
// watches it change has been talking to one process and is now talking to another: the service
// was restarted under it, which on a customer's machine is what a release update looks like. So
// the page reloads, and the HTML, CSS and JavaScript it goes on running are the ones the installer
// just wrote instead of whatever the browser has had cached since the last release. A lane TV is
// switched on once and left alone for months, and nobody is going to walk round the hall pressing
// F5 on sixteen of them and every tablet.
//
// A plain reload is enough, and a cache-buster is deliberately not used: httpd answers every
// static file with an ETag and Cache-Control: no-cache, so a reload revalidates each one and gets
// whatever is on disk now. See "Static files carry an ETag" in shared\httpd\CLAUDE.md.
//
// The identity travels inside the payload rather than arriving as a message the service broadcasts
// when it starts, and that is the design rather than an implementation detail: at the moment a
// service starts, none of its clients is connected - they are all sitting in EventSource's
// reconnect backoff - so a broadcast would reach nobody at all. This reaches a screen the instant
// it comes back, and reaches one that was switched off during the update, one on the polled
// fallback, and one on the far side of a network outage in exactly the same way.
//
// TakTV.js in ..\..\HTML\TakTV has the same function - that page is the one screen that does not
// load this file. The two are a deliberate pair, like vbsAcceptPayload and acceptPayload below;
// change one and change the other.

// Spread, so sixteen lane TVs and their consoles do not all reload in the same instant on a slave
// that has only just finished starting. Nothing depends on the delay - it only smooths the burst.
var VBS_RELOAD_SPREAD_MS = 2000;

// How often a deferred reload asks again whether the page is ready for it, and how long it waits
// before reloading regardless. The cap is the part that matters: a check-in terminal left halfway
// through by somebody who walked away would otherwise never take the new version at all.
var VBS_RELOAD_RETRY_MS = 5000;
var VBS_RELOAD_MAX_DEFER_MS = 300000;

var vbsAppInstanceSeen = null;
var vbsReloadArmed = false;

function vbsFollowAppRestart(payload) {
  var instance = payload && payload.appInstance;
  if (typeof instance !== 'string' || instance === '') return;   // older service, field absent

  // The first payload is the baseline and never a reload: this page was served by whichever
  // process is answering now, so it is already running that version's files.
  if (vbsAppInstanceSeen === null) {
    vbsAppInstanceSeen = instance;
    return;
  }

  if (instance === vbsAppInstanceSeen) return;

  vbsAppInstanceSeen = instance;
  vbsRequestReload('the ' + (webSource || 'web') + ' service was restarted (' + instance + ')');
}

// A page that must not be interrupted mid-transaction defines window.vbsReloadIsUnsafe and returns
// true for as long as that is so; the check-in kiosk is the one page that does. A hook rather than
// a list of pages here, because only the page itself knows what it is in the middle of.
function vbsReloadDeferred() {
  try {
    return typeof window.vbsReloadIsUnsafe === 'function' && window.vbsReloadIsUnsafe() === true;
  } catch (error) {
    return false;   // a throwing hook must not be able to pin a screen on an old release for ever
  }
}

function vbsRequestReload(why) {
  if (vbsReloadArmed) return;   // armed once per page, however many payloads go on saying so
  vbsReloadArmed = true;

  console.log('Reloading: ' + why);

  var giveUpWaitingAt = Date.now() + VBS_RELOAD_MAX_DEFER_MS;

  var attempt = function () {
    if (Date.now() < giveUpWaitingAt && vbsReloadDeferred()) {
      window.setTimeout(attempt, VBS_RELOAD_RETRY_MS);
      return;
    }
    vbsReloadNow();
  };

  window.setTimeout(attempt, Math.floor(Math.random() * VBS_RELOAD_SPREAD_MS));
}

function vbsReloadNow() {
  // The composition pages - TakTv2x4, the TakTV_Split pages, TakTV0102 and the rest - are shells
  // of iframes that subscribe to no payload of their own, so nothing in them would ever notice a
  // restart. Reloading the top window rather than this frame is what gets the shell's own HTML and
  // script replaced too. A frame whose parent is not one of ours cannot reach it and reloads
  // itself, which is still right - it just leaves the stranger's page alone.
  //
  // Reading window.top.document is what actually settles whether the parent is ours. Testing
  // window.top.location instead would look right and be wrong: Location is one of the few things
  // reachable across origins - only its members throw - so a stranger's frame would pass the test,
  // take the branch, and then throw on the hash below with nothing left to catch it. It is the
  // same test vbsCanUseEventStream above makes, for the same reason.
  var target = window;
  try {
    if (window.top !== window && window.top.document) target = window.top;
  } catch (error) {
    target = window;   // cross-origin parent
  }

  // Eight frames of one wall all reach the same top window and each arms its own reload. Without
  // this the later ones would call reload again while the navigation the first one started was
  // still running, restarting it every time.
  try {
    if (target.vbsReloadStarted) return;
    target.vbsReloadStarted = true;
  } catch (error) { /* nothing to guard with; one extra reload is harmless */ }

  // The fragment says where in the page we are, not which version we are running: the kiosk uses
  // it for which screen it is on and the console for its dialogs, so coming back up on
  // #editPlayers with every field empty is not what a refresh should mean. Dropping it needs a
  // navigation rather than reload() - and location.replace revalidates exactly as reload does.
  if (target.location.hash) {
    target.location.replace(target.location.pathname + target.location.search);
    return;
  }

  target.location.reload();
}

// Takes one payload, whether it was pushed or polled, and makes it the current one.
function vbsAcceptPayload(pushed) {
  vbsHideWrongLane();

  // Before anything else is done with it: if the hall has switched rendering this page is about
  // to be replaced, and there is no point running a tick's worth of work on it first.
  vbsFollowProtocolSwitch(pushed);

  // Same reasoning, for the service having been restarted under this page since the last payload.
  vbsFollowAppRestart(pushed);

  // The animation is a one-shot the server hands over exactly once, not a state field: it is
  // set on the push that carries it and empty on the very next one. Since a page only plays it
  // on its 1 Hz tick, a plain overwrite would drop any animation whose following push arrived
  // first - and it always does, the pump ticks four times a second. Carrying it forward until
  // the tick has played it is what the old poll got for free, by making the server hold the
  // value until somebody read it.
  if (vbsLaneStatus && vbsLaneStatus.animation && !pushed.animation)
    pushed.animation = vbsLaneStatus.animation;

  vbsLaneStatus = pushed;
  vbsLaneStatusVersion++;

  var waiters = vbsStatusWaiters;
  vbsStatusWaiters = [];
  for (var i = 0; i < waiters.length; i++) waiters[i](vbsLaneStatus);

  // Subscribers stay registered, unlike the one-shot waiters above. Each is isolated so one
  // page handler throwing cannot stop the rest, or the payload cache, from being updated.
  for (var h = 0; h < vbsPayloadHandlers.length; h++) {
    try { vbsPayloadHandlers[h](vbsLaneStatus); }
    catch (error) { console.error('onLaneStatus handler threw:', error); }
  }
}

// A browser allows only six HTTP/1.1 connections per origin, and an event stream holds one for
// as long as the page lives. TakTv2x4.html is eight same-origin iframes: eight streams would
// take every slot and then starve the VTVFile scoresheet images that share them, so the page
// would load once and freeze. Such a composition sets window.vbsNoStream and its children keep
// polling, behaving exactly as before. The 17 two-frame pages (TakTV_Split*, TakTV0102, ...) are
// comfortably inside the limit and stream normally.
var VBS_MAX_FRAMES_FOR_STREAM = 4;   // six, less headroom for the image fetches

function vbsCanUseEventStream() {
  if (typeof EventSource === 'undefined') return false;
  if (window.top === window) return true;

  try {
    // The parent's explicit opt-out, and the reason it exists rather than just counting frames:
    // a child's DOM-ready can fire before the parent has parsed the rest of its <iframe> tags,
    // so the count below only ever sees "however many tags precede me". Different children of
    // the same page then reach different answers - on TakTv2x4 the first few would stream and
    // the rest would poll, which works by luck rather than design. The flag is set in the
    // parent's <head>, so it is already there when the first child looks.
    if (window.top.vbsNoStream) return false;

    // Fallback for a composition that predates the flag. Racy as described, but it errs towards
    // polling as the frame count grows, which is the safe direction.
    return window.top.document.getElementsByTagName('iframe').length <= VBS_MAX_FRAMES_FOR_STREAM;
  } catch (error) {
    return true;   // parent is cross-origin, so it is not one of ours and shares no budget
  }
}

function vbsOpenEventStream() {
  if (webSource === '') return;

  if (!vbsCanUseEventStream()) {
    vbsStartPolling();
    return;
  }

  vbsEventSource = new EventSource(webEventPath + '?lane=' + vbsStreamLane() + '&WebSource=' + webSource);

  vbsEventSource.onmessage = function (event) {
    try {
      vbsAcceptPayload(JSON.parse(event.data));
    } catch (error) {
      console.error('Bad event payload:', error, event.data);
    }
  };

  vbsEventSource.onerror = function () {
    // `this` is the stream that failed, deliberately rather than the global: by the time a late
    // error arrives the global may already be null (we cleared it) or a different stream (we
    // reopened). Reading the global would then either throw on null or, worse, see a healthy new
    // stream's state and schedule a second reconnect - leaving two live streams for one page.
    var source = this;
    if (source !== vbsEventSource) return;   // stale handler from a stream we already replaced

    // A dropped connection leaves readyState CONNECTING and the browser retries on its own,
    // which is the normal case for a lane TV on flaky wifi or a server restart. CLOSED means it
    // has given up - the request was refused - and only that needs help.
    if (source.readyState !== EventSource.CLOSED) return;

    vbsEventSource = null;
    window.setTimeout(vbsOpenEventStream, 3000);
    vbsCheckLaneServed();   // after the reconnect is scheduled, so nothing in it can cost us that
  };
}

// The pre-push path, kept for the frame-heavy compositions above and for a browser with no
// EventSource. Every polled endpoint it targets is still registered and unchanged, so an old
// cached page on a tablet also keeps working against a new server.
var vbsPollingStarted = false;

function vbsStartPolling() {
  if (vbsPollingStarted) return;   // one interval per page, however often we are re-entered
  vbsPollingStarted = true;

  window.setInterval(function () {
    $.getJSON(webPollPath + '?lane=' + vbsStreamLane() + '&WebSource=' + webSource, vbsAcceptPayload)
      .fail(function (jqXHR) {
        if (vbsWrongLaneApplies() && jqXHR.status === 400) vbsNoteLaneRefused();
      });
  }, webPollIntervalMs);
}

// A screen pointed at a lane this computer does not serve used to be a black screen with an
// empty banner and nothing else - LoadCom refuses the stream for such a lane, the page retried
// every three seconds for ever, and the only trace was a WARNING in LoadCom's log (seen at a
// hall: SLAVE2 serves lanes 3-4, its TV start script had been overwritten to open lanes
// 1-2 by the update). An EventSource cannot see why it was refused, so on a refusal we ask
// lanestatus.json for the same lane: LoadCom answers it with 400 exactly when the lane is not
// served here (or is no lane at all), and then the screen says so in words.
// Lane screens and consoles only: the info screen passes a placeholder lane the server never
// refuses, and the kiosk and VBSmechanic stream from Spelmotor, where lanestatus.json is not
// the endpoint that answers.
// The text goes up only once the refusals have gone on for VBS_WRONG_LANE_AFTER_MS without a
// single answer in between. LoadCom starts its web server BEFORE it creates its lanes: in between
// it waits up to 30 s for the reception (WaitForFrontdeskConnection in LoadCom.cpp) and then
// writes systeminfo.ini on the reception's share, and all that time it answers "not served" for
// its own lanes. Measured at a hall, reception not up yet: LoadCom started
// 07:29:13, lanes 3 and 4 refused eleven times, accepted at 07:29:46. A slave booting before the
// reception is an ordinary morning, so a count of refusals would put the text on every screen
// for half a minute. 40 s clears that measured 33 s; a slower start can still flash the text
// briefly, which is accepted - it goes the moment the lane answers, and saying
// so sooner matters more on a screen that really is wrong.
var VBS_WRONG_LANE_ID = 'vbsWrongLaneMessage';
var VBS_WRONG_LANE_AFTER_MS = 40000;
var vbsFirstLaneRefusal = 0;   // Date.now() of the first refusal since the lane last answered

function vbsWrongLaneApplies() {
  return webSource === 'TV' || webSource === 'console';
}

// jQuery rather than fetch(): every page that loads this file loads jQuery 3.7.1 first, and a
// lane tablet's WebView can be old enough to have EventSource but no fetch.
function vbsCheckLaneServed() {
  if (!vbsWrongLaneApplies()) return;

  // A 200 is the lane's ordinary payload - LoadCom has just come up between the refused stream
  // and this question - so it is used like any polled one rather than thrown away: building it
  // hands over the lane's pending animation once, and it also clears the refusal clock.
  $.ajax({ url: webPollPath + '?lane=' + vbsStreamLane() + '&WebSource=' + webSource, cache: false, dataType: 'json' })
    .done(vbsAcceptPayload)
    .fail(function (jqXHR) {
      // Anything but 400 - LoadCom down, a timeout - is not this fault; leave the screen alone.
      if (jqXHR.status === 400) vbsNoteLaneRefused();
    });
}

function vbsNoteLaneRefused() {
  var now = Date.now();
  if (vbsFirstLaneRefusal === 0) vbsFirstLaneRefusal = now;
  if (now - vbsFirstLaneRefusal >= VBS_WRONG_LANE_AFTER_MS) vbsShowWrongLane();
}

function vbsShowWrongLane() {
  if (document.body === null) return;   // the next refusal, seconds later, will find it

  var box = document.getElementById(VBS_WRONG_LANE_ID);
  if (box === null) {
    box = document.createElement('div');
    box.id = VBS_WRONG_LANE_ID;
    box.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483647;' +
      'display:flex;align-items:center;justify-content:center;text-align:center;padding:5%;' +
      'box-sizing:border-box;background:#000;color:#fff;font:bold 5vmin Arial,sans-serif;';
    document.body.appendChild(box);
  }
  box.textContent = 'Looking at invalid lane ' + vbsStreamLane() + ' that is not at this computer.';
}

// Called with every payload: a lane that delivers data is a lane this computer serves.
function vbsHideWrongLane() {
  vbsFirstLaneRefusal = 0;
  var box = document.getElementById(VBS_WRONG_LANE_ID);
  if (box !== null) box.parentNode.removeChild(box);
}

// Hands the latest pushed payload to a page handler. Called from the 1 Hz tick, so before the
// first event arrives it does nothing at all - exactly what happened while a poll was still in
// flight.
function withLaneStatus(handler) {
  if (vbsLaneStatus === null) return;

  try {
    handler(vbsLaneStatus);
  } finally {
    // The server clears the pending animation as it hands it over so it plays once. The cached
    // copy has to be cleared for the same reason: without this the 1 Hz tick would replay the
    // last animation for ever.
    //
    // In `finally` rather than after the call so a handler that throws cannot leave a stuck
    // animation looping on the lane TV until someone reloads the page. Clearing it may lose one
    // animation, which is the better of the two failures - and a throwing handler is a bug to
    // fix at the source either way.
    if (vbsLaneStatus && vbsLaneStatus.animation) vbsLaneStatus.animation = '';
  }
}

// Promise form, for the info screen: its media loop is paced by the server's playTime rather
// than by the 1 Hz tick, so it awaits a payload instead of being handed one.
//
// Resolves with a payload the caller has not seen yet - immediately if one arrived while it was
// sleeping, otherwise as soon as the next one is pushed. Tracking that is what stops the loop
// spinning: playTime is 0 until the first LC_PLAY_INFO reaches the slave, so a version that
// always resolved from cache would turn the info page's `await sleep(playTime)` into a busy
// loop. Handing it the same payload twice is also just wrong - a poll never did that.
function vbsNextLaneStatus() {
  if (vbsLaneStatus !== null && vbsLaneStatusVersion !== vbsSeenVersion) {
    vbsSeenVersion = vbsLaneStatusVersion;
    return Promise.resolve(vbsLaneStatus);
  }

  return new Promise(function (resolve) {
    vbsStatusWaiters.push(function (data) {
      vbsSeenVersion = vbsLaneStatusVersion;
      resolve(data);
    });
  });
}

// A video keeps the screen until it ends - as long as the lane is still in the state it was
// started in. That is what stops an animation being cut in half by the next payload. It does not
// hold across a change of lane status: a commercial was started while the lane was off, and once
// the lane has been switched on the bowlers are waiting for their sheet, not for the end of a
// two-minute film. So a video started under another status is cut the moment media for the new
// status arrives, and the new media shows at once.
function yieldVideoFx(status) {
  if (videoPlaying && videoStatus !== status)
    stopVideoFx();
}

// Takes the video layer down at once, playing or still loading. The handlers are detached before
// the element goes: a <video> removed from the page is not a dead one - it goes on loading, and
// its canplay would otherwise mark a video nobody can see as playing and queue every picture
// behind it until that video had ended.
function stopVideoFx() {
  var videofx = document.getElementById("videoFx");

  if (videofx !== null)
  {
    videofx.oncanplay = null;
    videofx.onended = null;
    videofx.pause();
    videofx.removeAttribute('src');
    videofx.load();
    videofx.remove();
  }

  videoPlaying = false;
  unPlayedImage = "";
  picturefx.hidden = false;
}

function displayVideoFx (source, status) {
  yieldVideoFx(status);
  if (videoPlaying) return;

  if (status === 'Commercial')
    picturefx.hidden = true;

  var videofx   = document.getElementById("videoFx");

  if (videofx === null)
  {
    $('#main_content').append('<video id="videoFx" muted playsinline></video>');
    videofx   = document.getElementById("videoFx");
  }

  // source = animation.
  videoStatus = status;
  videofx.setAttribute('src', source);
  videofx.style.opacity = '100%';
  videofx.load();

  videofx.oncanplay = function() {
    videoPlaying = true;
    videofx.play();
    videofx.onended = function() {
      videofx.remove();
			picturefx.hidden = false;
      videoPlaying = false;

      if (unPlayedImage !== "")
      {
        displayImageFx(unPlayedImage, status);
        unPlayedImage = "";
      }
    };
  };
}

function displayImageFx (source, status) {
  if ((source.includes(".xml.jpg") || source.includes(".txt.jpg")) && (!source.includes("?index=")))
    source += '?index=' + infoImageIdex++;

  yieldVideoFx(status);
  if (videoPlaying)
  {
    unPlayedImage = source;
    return;
  }

  stopVideoFx();
  picturefx.hidden = false;
  picturefx.style.opacity = '100%';
  picturefx.setAttribute('src', source);
}

var oldBanner = "";
function playBottomText(show, text, method) {
  // show = true: show text, false: do not show text.. (we'll show text all the time.. future feature.)
  // text = text to show.
  // method = how to show (direct, moving and so so... future feature.)
  if (oldBanner === text) return;
  
  if (show === undefined) {
    show = true;
  }	
  if (method === undefined) {
    method = 'direct';
  }	
  document.getElementById("bannerText").innerHTML = text;
  oldBanner = text;
}

function selectAll(x) {
  x.select();
}

// Which characters make up a player name - the web half of one rule, and the only place it is
// written on this side.
//
// IT MUST STAY THE SAME LIST AS LanedataUtil::IsAcceptableNameChar in the C++ (shared/lanedata),
// which is the boundary that actually enforces it. A character accepted here and rejected there
// is typed and then silently changed by the start; one rejected here and accepted there looks
// like a broken key. That function's comment says why each character is out - briefly: the
// quote, the angle brackets and the control characters are not escaped by every writer
// downstream, and & = + are the delimiters of the very requests these names travel in.
//
// Spelled out as Latin-1 ranges rather than \p{L}, deliberately. The storage is Windows-1252 -
// the lane file, the shared memory and the reception-to-slave protocol are packed char arrays -
// so a letter outside that code page does not survive the trip: it reaches the slave as '?' and
// is dropped there, which would leave a guest watching the name they typed turn into nothing.
// Declining the keystroke says so at once instead. The ranges are split around 00D7 and 00F7,
// which are the multiplication and division signs sitting inside the accented block.
//
// U+00B4 and U+2019 are both in: a name already stored with either must survive being loaded
// into this box and edited.
var VBS_NAME_CHARS = /[^A-Za-z0-9 .,\-'\u00B4\u2019\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E]/g;

// A trailing marker the code puts there itself, which is not the guest's text and is not
// measured against the rule above: "{<n>}" is the VBS-T baker position, and the change-players
// box can be showing a name that carries one. The slave sets it aside the same way. Without
// this the first keystroke in such a box would strip the braces, which changes which position
// the player is bowling.
var VBS_NAME_MARKER = /\{[1-9]\}$/;

function adjustCaps(el) {
  // The element is passed when the caller has one - a box filled from a member lookup, where it
  // is not the focused element. With no argument this works on the focused field, which is what
  // every oninput caller has always relied on, vbskeyboard.js included.
  // A handler assigned as a property (AddPlayer in TouchConsole.js: Spelarnamn.oninput = adjustCaps)
  // is called with the event instead: take the field it fired on. Read as the element, the event
  // has no .value, and from 6431 the change-players boxes were neither capitalised nor filtered.
  // .target rather than .currentTarget, so a handler on a parent works too, and a jQuery event as well.
  if (el && typeof el.value !== "string" && el.target) el = el.target;
  var target = el || document.activeElement;
  if (!target || typeof target.value !== "string") return;

  var raw = target.value;
  var marker = (raw.match(VBS_NAME_MARKER) || [""])[0];
  var name = raw.slice(0, raw.length - marker.length).replace(VBS_NAME_CHARS, "");

  for (var i = 0; i < name.length; i++) {
    if (i === 0) {
      name = name.replace(name.charAt(i), name.charAt(i).toUpperCase());
    } else if ([" ", ".", "-", "_"].includes(name[i - 1])) {
      name = name.replace(
        name[i - 1] + name.charAt(i),
        name[i - 1] + name.charAt(i).toUpperCase()
      );
    }
  }
  target.value = name + marker;
}

function removeAnchorFromUrl() {
  // Don't let the 1s status poll auto-close the interactive "Starta flyttat spel"
  // confirmation before the user answers it: right after a move the target lane's
  // status/media is changing, which would otherwise clear the hash and close the
  // #startMovePlay dialog within a second. Scoped to that one dialog so all other
  // transient overlays (e.g. #fillBowlingData after OK) still auto-dismiss here.
  if (window.location.hash === '#startMovePlay') return;
  window.location.hash = '';
}
var timerInvervalId;
$(function() {
  // The 1 Hz tick starts on a whole second, so the clock on the screens changes with the wall
  // clock. This used to be a busy loop spinning on Date.getTime() until it hit one - up to a
  // second of a core at 100 % on every screen load. A page that does not want the tick (the
  // kiosk) sets vbsNoStatusTick before the timeout fires.
  window.setTimeout(function() {
    if (!window.vbsNoStatusTick)
      timerInvervalId = window.setInterval(updateStatus, 1000);
  }, 1000 - (new Date().getTime() % 1000));

  // Opened here rather than at parse time so the page's own script has already declared its
  // webSource; every screen loads this file first and its own second.
  vbsOpenEventStream();
});

var vbsAudioContext = null;
function beep(frequency, duration) {
  // One AudioContext for the page, not one per beep: the mechanic handset beeps every second
  // while an alarm stands, and Chromium stops handing out contexts after a few dozen - the
  // handset then went silent until it was reloaded.
  if (!vbsAudioContext)
    vbsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  const context = vbsAudioContext;
  if (context.state === 'suspended' && context.resume)
    context.resume();
  const oscillator = context.createOscillator();
  oscillator.type = "sine"; // You can choose different waveforms: sine, square, triangle, sawtooth
  oscillator.frequency.setValueAtTime(frequency, context.currentTime); // Frequency in Hz
  oscillator.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration / 1000); // Duration in seconds
}

function vibrate(pattern) {
  if (navigator.vibrate) {
      navigator.vibrate(pattern);
  } else {
      console.log("Vibration not supported on this device.");
  }
}

function beepAndVibrate(frequency, duration, vibrationPattern) {
  beep(frequency, duration);
  vibrate(vibrationPattern);
}

function getFirstThrowlChar(value) {
  if (value === 0) return "-";
  if (value === 10) return "X";
  if (value === -1) return "";
  return value;
}

function getSecondThrowlChar(cell, value) {
  if (value === 0)
    if (scoreTable[cell - 1] === 10) return '';
  else
    return "-";

  if (value + scoreTable[cell - 1] === 10) return "/";
  if (value === -1) return "";
  return value;
}

function isFirstThrow(cell) {
  if (cell < 19 && cell % 2 === 0) return true;

  if (cell < 19 && cell % 2 === 1) return false;

  if (cell === 19)
  {
    if (scoreTable[18] === 10) 
      return true;
    else
      return false;
  }

  if (cell === 20)
  {
    var sumUp = scoreTable[18] + scoreTable[19];
    if (sumUp === 10 || sumUp === 20) 
      return true;
    else
      return false;
  }
}

function getSpecialBowlChar(cell, value) {
  if (isFirstThrow(cell))
    return getFirstThrowlChar(value);
  else
    return getSecondThrowlChar(cell, value);
}

function recalcScore(pResults, activePos = 21, bHideStrikeSequence = true, isCFG = false) {
  let pSumArray = new Array(10).fill(0);
  
  // Step 1: Calculate plain sums without bonus
  for (let i = 0; i < 9; i++) {
      pSumArray[i] = pResults[i * 2] + pResults[i * 2 + 1];
  }
  // Frame 10
  pSumArray[9] = pResults[18] + pResults[19] + (pResults[20] || 0);
  
  // Step 2: Add spare bonuses (excluding frame 10)
  for (let i = 0; i < (isCFG ? 10 : 9); i++) {
      if (pResults[i * 2] + pResults[i * 2 + 1] >= 10 && pResults[i * 2] !== 10) {
          pSumArray[i] += isCFG ? pResults[i * 2] : pResults[(i + 1) * 2];
      }
  }
  
  // Step 3: Add strike bonuses (excluding frame 10)
  for (let i = 0; i < (isCFG ? 10 : 9); i++) {
      if (pResults[i * 2] === 10) { // Strike
          if (isCFG) {
              pSumArray[i] += 20;
          } else {
              pSumArray[i] += pResults[(i + 1) * 2] + pResults[(i + 1) * 2 + 1];
              if (pResults[(i + 1) * 2] === 10 && i !== 8) {
                  pSumArray[i] += pResults[(i + 2) * 2];
              }
          }
      }
  }
  
  if (!isCFG) {
      let pos = activePos < 2 ? -1 : (activePos > 18 ? activePos - 1 : 
          ((activePos % 2 === 0 && pResults[activePos - 2] === 10) ? activePos - 2 : activePos - 1));
      
      if (pos >= 0 && pos < 20) {
          if (bHideStrikeSequence && isFirstBall(pos, pResults)) {
              pSumArray[Math.floor(pos / 2)] = -1;
          }
      }
  }
  
  // Step 4: Make cumulative sum
  for (let i = 1; i < 10; i++) {
      pSumArray[i] += pSumArray[i - 1];
  }
  
  return pSumArray;
}

function isFirstBall(slag, score) {
  return !((slag < 19 && slag % 2) || 
      (slag === 20 && score[18] === 10 && score[19] !== 10) ||
      (slag === 19 && score[18] !== 10));
}

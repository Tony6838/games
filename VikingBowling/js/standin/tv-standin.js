// ---------------------------------------------------------------------------
// tv-standin.js - LoadCom's HTML service, as the lane TV page sees it, inside the game.
//
// Loaded by web/screen/HTML/TakTV/TakTVGame.html, which is VBS's TakTV.html with this
// one script added in front of its own. Nothing of TakTV.js or the files it loads is
// changed: the page opens /html/events?lane=<n> and is pushed the same payload a live
// lane TV gets from LoadCom (BuildHtmlPayload: the lane status with the lane file under
// "lane"), because EventSource and fetch are answered here instead of by a server.
//
//   EventSource('/html/events?lane=n')   -> subscribed to the game's stand-in LoadCom
//                                          (window.parent.VikingLoadCom), which pushes
//                                          a payload whenever the lane moves
//   fetch('/html/lanedata.json?lane=n')  -> that lane's payload (the partner lane's roster
//                                          in an American game)
//   fetch('/html/onscoring?lane=n')      -> 404, so the page reads the tournament layout
//                                          from Reception/vbsTournaments as without LoadCom
//   fetch('.../GameCtrl/VBST_<x>.ini')   -> the OnScoring values the game's VBS-T engine
//                                          keeps (OpenPlay writes this file on a lane)
//   fetch('/GameConsole/...') and other absolute paths -> the same file under the game's
//                                          own folder, so the game runs from any sub-path
//   fetch('/html/vtvimage')              -> the sheet's JPEG, kept by the stand-in for the lane
//                                          console's picture of the lane (VTVFile<n>.jpg); the game's
//                                          TV frames are readonly and post none - the console asks the
//                                          page for its picture instead (game/consolehost.js)
//   v3gfx/Backgrounds/ClubLogos/<team>.png -> ClubLogos/Empty.png (no team has a logo)
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  // The game folder, seen from web/screen/HTML/TakTV/
  var ROOT = new URL('../../../../', window.location.href).href;
  var host = null;
  try { host = window.parent && window.parent.VikingLoadCom; } catch (e) { host = null; }

  function laneOf(url) {
    var m = /[?&]lane=(\d+)/i.exec(url);
    return m ? parseInt(m[1], 10) : 1;
  }

  function FakeEventSource(url) {
    this.url = url;
    this.readyState = 0;
    this.onmessage = null;
    this.onerror = null;
    this.onopen = null;
    var self = this;
    var lane = laneOf(url);
    window.setTimeout(function () {
      self.readyState = 1;
      if (self.onopen) self.onopen({});
      if (host) host.subscribe(lane, function (text) {
        if (self.readyState === 2 || !self.onmessage) return;
        self.onmessage({ data: text });
      });
    }, 0);
  }
  FakeEventSource.CONNECTING = 0;
  FakeEventSource.OPEN = 1;
  FakeEventSource.CLOSED = 2;
  FakeEventSource.prototype.close = function () { this.readyState = 2; };
  FakeEventSource.prototype.addEventListener = function (type, fn) { if (type === 'message') this.onmessage = fn; };
  window.EventSource = FakeEventSource;

  // --- the real spelling of an asset path ------------------------------------
  // The theme XML was written on Windows and asks for "V3GFX/Resource/..." or
  // "common_practice.xml" where the file is "v3gfx/..." / "Common_Practice.xml". A
  // case-sensitive server (GitHub Pages) would answer 404, so every URL the page asks for
  // - by fetch, as an <image>/<img> source - is put through the table in manifest.js.
  var CASES = window.VIKING_ASSET_CASE || {};
  var rootPath = new URL(ROOT).pathname;
  function fixUrl(u) {
    if (typeof u !== 'string' || u === '' || /^(data|blob):/i.test(u)) return u;
    var abs;
    try { abs = new URL(u, window.location.href); } catch (e) { return u; }
    if (abs.origin !== window.location.origin) return u;
    var path = abs.pathname;
    if (path.indexOf(rootPath) !== 0) {
      // a root-absolute path ("/V3GFX/...") means the lane PC's C:\Viking2001: the game folder
      if (u.charAt(0) === '/' && u.charAt(1) !== '/') path = rootPath + path.substring(1);
      else return u;
    }
    var rel;
    try { rel = decodeURIComponent(path.substring(rootPath.length)); } catch (e) { return u; }
    var real = CASES[rel.toLowerCase()];
    // A team's club logo (ClubLogos\<team>.png): the game's teams have none, so the page
    // gets Empty.png, as the C++ copies Empty.png into place when the named logo is missing
    if (!real && /^v3gfx\/backgrounds\/clublogos\/[^/]+\.png$/i.test(rel)) real = CASES['v3gfx/backgrounds/clublogos/empty.png'];
    if (!real) {
      if (path === abs.pathname) return u;          // not an asset we know: leave it alone
      real = rel;
    }
    if (real === rel && path === abs.pathname) return u;
    return ROOT + real.split('/').map(encodeURIComponent).join('/') + abs.search + abs.hash;
  }
  window.vikingFixAssetUrl = fixUrl;

  // An animation taken down before it had started playing (the next ball's, or a status change)
  // rejects the page's video.play() promise, which vbsmedia.js leaves unhandled - harmless on a
  // lane TV, noise in the game's console: answered here
  var mediaPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    var p = mediaPlay.apply(this, arguments);
    if (p && typeof p.catch === 'function') p.catch(function () { /* taken down before it played */ });
    return p;
  };

  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === 'href' || name === 'src' || name === 'xlink:href') value = fixUrl(String(value));
    return setAttr.call(this, name, value);
  };
  var setAttrNS = Element.prototype.setAttributeNS;
  Element.prototype.setAttributeNS = function (ns, name, value) {
    if (name === 'href' || name === 'xlink:href' || name === 'src') value = fixUrl(String(value));
    return setAttrNS.call(this, ns, name, value);
  };
  ['HTMLImageElement', 'HTMLVideoElement', 'HTMLSourceElement'].forEach(function (cls) {
    var proto = window[cls] && window[cls].prototype;
    var d = proto && Object.getOwnPropertyDescriptor(proto, 'src');
    if (!d || !d.set) return;
    Object.defineProperty(proto, 'src', {
      configurable: true, enumerable: d.enumerable,
      get: d.get, set: function (v) { d.set.call(this, fixUrl(String(v))); }
    });
  });

  var realFetch = window.fetch.bind(window);

  function textResponse(body, type, status) {
    return Promise.resolve(new Response(body, { status: status || 200, headers: { 'Content-Type': type || 'text/plain' } }));
  }

  function latin1(text) {
    // The page decodes these files as windows-1252, as the lane PCs write them
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) { var c = text.charCodeAt(i); bytes[i] = c < 256 ? c : 63; }
    return bytes;
  }

  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = url;
    try { path = new URL(url, window.location.href).pathname; } catch (e) { /* keep */ }

    if (/^\/html\/lanedata\.json/i.test(url))
      return host ? textResponse(host.payloadText(laneOf(url)), 'application/json') : textResponse('', 'text/plain', 404);
    if (/^\/html\/onscoring/i.test(url)) return textResponse('', 'text/plain', 404);
    // the sheet as a JPEG (VTVFile<n>.html.jpg on a lane PC): kept for the lane console's picture
    if (/^\/html\/vtvimage/i.test(url)) {
      if (host && host.storeVtvImage && init && init.body) host.storeVtvImage(laneOf(url), init.body);
      return textResponse('{}', 'application/json');
    }

    // the competition's OnScoring layout, which VBS-T copies to <league>.xml when it is booked
    var layoutFor = /\/Reception\/vbsTournaments\/([^/?]+\.h001)\.xml$/i.exec(decodeURIComponent(path));
    if (layoutFor && host && host.onScoringLayout) {
      var layoutUrl = host.onScoringLayout(layoutFor[1]);
      if (layoutUrl) return realFetch(fixUrl(ROOT + layoutUrl), init);
      return textResponse('', 'text/plain', 404);
    }

    var vbst = /\/GameCtrl\/VBST_([^/?]+)\.ini/i.exec(decodeURIComponent(path));
    if (vbst && host && host.onScoringValues) {
      var ini = host.onScoringValues(vbst[1]);
      if (ini !== null && ini !== undefined) return textResponse(latin1(ini), 'text/plain');
      return textResponse('', 'text/plain', 404);
    }

    // An absolute path means the lane PC's document root, C:\Viking2001: the game folder
    // here; and every asset is asked for in its real spelling (see fixUrl)
    if (typeof input === 'string') return realFetch(fixUrl(url), init);
    return realFetch(input, init);
  };
}());

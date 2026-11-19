// ---------------------------------------------------------------------------
// console-standin.js - LoadCom's console service (port 24321 on a lane PC), as the lane console
// page sees it, inside the game.
//
// Loaded by web/screen/console/touchconsoleLaneGame.html, which is VBS's touchconsoleLane.html
// with this one script added in front of its own. Nothing of the console's own scripts is
// changed: the page opens /console/events?lane=<n>&WebSource=console and sends its commands with
// jQuery ($.ajax, $.getJSON - XMLHttpRequest underneath) exactly as on a lane, and they are
// answered here by the game's stand-in LoadCom (window.parent.VikingLoadCom, js/standin/loadcom.js),
// which does what LoadComWebInterface.cpp does with them.
//
//   EventSource('/console/events?lane=n&WebSource=console') -> the console payload (BuildLaneStatusJson)
//   XMLHttpRequest / fetch to /console/...                   -> VikingLoadCom.consoleRequest(url, body)
//   ../common/gamectrl/VTVFile<n>.jpg (the lane's picture)   -> the lane TV's own picture of the
//                                                               sheet, or the game's compact view
//   Android.loadHomePage() (the logo in the dock)            -> closes the console
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  var host = null;
  try { host = window.parent && window.parent.VikingLoadCom; } catch (e) { host = null; }

  function laneOf(url) {
    var m = /[?&]lane=(\d+)/i.exec(url);
    return m ? parseInt(m[1], 10) : 0;
  }
  function isConsoleUrl(url) {
    var path = String(url);
    try { path = new URL(url, window.location.href).pathname; } catch (e) { /* keep */ }
    return /^\/console\//i.test(path) || /^\/console\//i.test(String(url));
  }

  // --- the status feed ---------------------------------------------------------------------
  function FakeEventSource(url) {
    this.url = url;
    this.readyState = 0;
    this.onmessage = null; this.onerror = null; this.onopen = null;
    var self = this, lane = laneOf(url);
    window.setTimeout(function () {
      self.readyState = 1;
      if (self.onopen) self.onopen({});
      if (host) host.subscribeConsole(lane, function (text) {
        if (self.readyState === 2 || !self.onmessage) return;
        self.onmessage({ data: text });
      }, function () { return self.readyState === 2; });
    }, 0);
  }
  FakeEventSource.CONNECTING = 0; FakeEventSource.OPEN = 1; FakeEventSource.CLOSED = 2;
  FakeEventSource.prototype.close = function () { this.readyState = 2; };
  FakeEventSource.prototype.addEventListener = function (type, fn) { if (type === 'message') this.onmessage = fn; };
  window.EventSource = FakeEventSource;

  // --- the commands --------------------------------------------------------------------------
  function answer(url, body) {
    if (!host) return { status: 503, text: '', type: 'text/plain' };
    var r = host.consoleRequest(String(url), body);
    var text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { status: r.status || 200, text: text, type: r.type || 'application/json' };
  }

  var RealXHR = window.XMLHttpRequest;
  function define(o, k, v) { Object.defineProperty(o, k, { value: v, configurable: true, writable: true }); }
  function GameXHR() {
    var x = new RealXHR();
    var open = x.open, send = x.send, setHeader = x.setRequestHeader, abort = x.abort;
    x.open = function (method, url) {
      x._game = isConsoleUrl(url) ? { method: method, url: url } : null;
      if (!x._game) return open.apply(x, arguments);
      define(x, 'readyState', 1);
    };
    x.setRequestHeader = function () { if (!x._game) return setHeader.apply(x, arguments); };
    x.abort = function () { if (!x._game) return abort.apply(x, arguments); x._game.aborted = true; };
    x.send = function (body) {
      if (!x._game) return send.apply(x, arguments);
      var game = x._game;
      window.setTimeout(function () {
        if (game.aborted) return;
        var r = answer(game.url, body);
        define(x, 'readyState', 4);
        define(x, 'status', r.status);
        define(x, 'statusText', r.status === 200 ? 'OK' : (r.status === 404 ? 'Not Found' : 'Error'));
        define(x, 'responseText', r.text);
        define(x, 'response', r.text);
        define(x, 'responseURL', String(game.url));
        x.getAllResponseHeaders = function () { return 'content-type: ' + r.type + '\r\n'; };
        x.getResponseHeader = function (h) { return /content-type/i.test(h) ? r.type : null; };
        x.dispatchEvent(new Event('readystatechange'));
        x.dispatchEvent(new ProgressEvent('load'));
        x.dispatchEvent(new ProgressEvent('loadend'));
      }, 0);
    };
    return x;
  }
  GameXHR.prototype = RealXHR.prototype;
  ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE'].forEach(function (k, i) { GameXHR[k] = i; });
  window.XMLHttpRequest = GameXHR;

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (isConsoleUrl(url)) {
      var r = answer(url, init && init.body);
      return Promise.resolve(new Response(r.text, { status: r.status, headers: { 'Content-Type': r.type } }));
    }
    return realFetch(input, init);
  };

  // --- the lane's picture ------------------------------------------------------------------------
  function fixUrl(u) {
    var m = /gamectrl\/VTVFile(\d+)\.jpg/i.exec(String(u));
    if (m && host && host.vtvImageUrl) return host.vtvImageUrl(parseInt(m[1], 10)) || u;
    return u;
  }
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === 'src') value = fixUrl(String(value));
    return setAttr.call(this, name, value);
  };
  var d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (d && d.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { d.set.call(this, fixUrl(String(v))); }
    });
  }

  // The dock's logo goes "home" (the tablet's start page); in the game that closes the console
  window.Android = { loadHomePage: function () { if (host && host.closeConsole) host.closeConsole(); } };
}());

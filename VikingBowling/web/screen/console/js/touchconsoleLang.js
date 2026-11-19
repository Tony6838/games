// touchconsoleLang.js - texter från språkfiler, för TouchConsole.html/TouchConsole2.html och touchconsoleLane.html.
//
// En fil per språk i ../lang/ (sv.json, en.json ...): platta par nyckel -> text. Sidorna märker
// sina element med nyckeln och den här filen fyller i texten:
//
//   <span data-i18n="welcome"></span>              textContent
//   <input data-i18n-placeholder="playerPlaceholder">
//   <button data-i18n-aria="close">                 aria-label
//
// I texten ersätts {n}, {mode}, {lane} ... av värden sidan skickar med till t().
//
// Språket kommer från banan själv: lanestatus-payloaden har 'laneLang' (banans eget språk; en
// äldre slav bara 'lang') med receptionens namn på språket ("Svenska", "Suomeksi" ...), om inte
// gästerna har valt ett annat (touchconsoleLane.js, shownLanguage). LANG_FILES översätter det
// till filnamnet. Ett nytt språk = en ny fil + en rad här.
//
// Saknas en nyckel i språkfilen används den svenska texten, och saknas språkfilen helt används
// engelska - så att en ofullständig översättning syns som enstaka svenska/engelska ord i stället
// för som tomma knappar.

(function (global) {
  'use strict';

  var LANG_FILES = {
    svenska: 'sv',
    english: 'en',
    suomeksi: 'fi',
    deutsch: 'de',
    dansk: 'da',
    norsk: 'no'
  };
  var FALLBACK_CODE = 'en';
  var BASE_CODE = 'sv';

  // Katalogen lang/ ligger bredvid js/, dvs ../lang/ från den här filen.
  var base = (function () {
    var s = document.currentScript && document.currentScript.src;
    try { return new URL('../lang/', s || global.location.href).href; }
    catch (e) { return 'lang/'; }
  })();

  var cache = {};          // code -> Promise<dict>
  var current = {};        // dict för aktuellt språk
  var baseDict = {};       // sv, för nycklar som saknas
  var currentCode = null;

  function codeFor(langName) {
    var key = String(langName || '').trim().toLowerCase();
    return LANG_FILES[key] || FALLBACK_CODE;
  }

  // XMLHttpRequest om WebView:n saknar fetch (commonAPI.js: en äldre tablets WebView kan ha
  // EventSource men inte fetch). Svarar med ordlistan eller null.
  function getJson(url) {
    if (typeof global.fetch === 'function') {
      return fetch(url, { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .catch(function () { return null; });
    }
    return new Promise(function (resolve) {
      try {
        var x = new XMLHttpRequest();
        x.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now(), true);
        x.onload = function () {
          try { resolve(x.status >= 200 && x.status < 300 ? JSON.parse(x.responseText) : null); }
          catch (e) { resolve(null); }
        };
        x.onerror = function () { resolve(null); };
        x.send();
      } catch (e) { resolve(null); }
    });
  }

  function fetchDict(code) {
    if (!cache[code]) cache[code] = getJson(base + code + '.json');
    return cache[code];
  }

  // Laddar språket (en gång per språk och sida) och gör det till det aktuella.
  // Svarar med true när texterna har bytts.
  function use(langName) {
    var code = codeFor(langName);
    if (code === currentCode) return Promise.resolve(false);
    currentCode = code;
    return Promise.all([fetchDict(BASE_CODE), fetchDict(code)]).then(function (res) {
      if (code !== currentCode) return false;            // ett nyare byte hann före
      baseDict = res[0] || {};
      current = res[1] || (code !== FALLBACK_CODE ? null : {}) || {};
      if (!res[1] && code !== FALLBACK_CODE) {
        return fetchDict(FALLBACK_CODE).then(function (fb) { current = fb || {}; return true; });
      }
      return true;
    });
  }

  function t(key, vars) {
    var s = current[key];
    if (s === undefined) s = baseDict[key];
    if (s === undefined) s = key;
    if (vars) {
      s = String(s).replace(/\{(\w+)\}/g, function (m, name) {
        return vars[name] !== undefined ? vars[name] : m;
      });
    }
    return s;
  }

  function apply(root) {
    root = root || document;
    var i, el, txt;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      txt = t(el.getAttribute('data-i18n'));
      if (el.textContent !== txt) el.textContent = txt;
    }
    nodes = root.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      txt = t(el.getAttribute('data-i18n-placeholder'));
      if (el.placeholder !== txt) el.placeholder = txt;
    }
    nodes = root.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    }
  }

  global.rev2I18n = {
    use: use,
    t: t,
    apply: apply,
    codeFor: codeFor,
    code: function () { return currentCode; }
  };
})(window);

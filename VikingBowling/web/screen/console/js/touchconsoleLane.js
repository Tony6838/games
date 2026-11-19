// touchconsoleLane.js - det touchconsoleLane.html behöver utöver originalets skript.
//
// Rör ingenting som skickas till servern; startknappen här trycker bara på den riktiga,
// dolda #startBowling. Det som görs:
//   - banans färg och nummer (--lane, bandet, dialogrubrikerna)
//   - texter ur språkfilen (js/touchconsoleLang.js) i banans språk
//   - snabbval för spelsätt, namnet på valt spelsätt, antal spelare, startknappens text
//   - vbsPlaying på body när banan spelar
//   - knappraden i kolumnläge: Avsluta spel fyller ut sista raden
//   - skärmtangentbordet: rulla fram fältet som skrivs i
//   - dialoger som öppnats med jQuery show() stängs av krysset (samma fel finns i originalet)
//
// Skalet TouchConsole.html/TouchConsole2.html styr sidan genom window.rev2Lane (se längst ner).
//
// Adressparametrar: ?lane=<n>  &pair=1 (banan ingår i ett banpar)  &lanecolor=E2B550

(function () {
  'use strict';

  // Banans färg om skalet inte anger någon (?lanecolor=): guld för alla banor
  var LANE_COLOR = '#E2B550';
  var I = window.rev2I18n;

  var mode = 'full';              // 'full' | 'column', satt av skalet
  var shownLang = null;
  var laneNo = 0;
  var pair = false;

  function byId(id) { return document.getElementById(id); }

  function params() {
    var out = {};
    new URLSearchParams(window.location.search).forEach(function (v, k) { out[k.toLowerCase()] = v; });
    return out;
  }

  // ------------------------------------------------------------------ bana: färg och nummer

  function setupLane() {
    var p = params();
    laneNo = parseInt(getLane(), 10);
    pair = p.pair === '1';

    var color = p.lanecolor ? '#' + String(p.lanecolor).replace(/^#/, '') : '';
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) color = LANE_COLOR;

    var root = document.documentElement.style;
    root.setProperty('--lane', color);
    root.setProperty('--laneNo', '"' + laneNo + '"');
    if (pair) document.body.classList.add('vbsPair');

    var nos = document.querySelectorAll('.laneNo');
    for (var i = 0; i < nos.length; i++) nos[i].textContent = laneNo;
  }

  function laneLabel() { return I.t('lane') + ' ' + laneNo; }

  // ------------------------------------------------------------------ språk

  // Språket kommer med banans första statusmeddelande. Tills dess används det språk tabletten
  // hade senast för banan (localStorage), så att sidan inte visar engelska en stund vid varje
  // start. Per bana, eftersom banorna i ett banpar kan ha var sitt språk (en nyckel för båda
  // skrevs om av ramarna i tur och ordning varje tick); rev2Lang utan bana är den äldre nyckeln,
  // som bara läses.
  var LANG_KEY = 'rev2Lang';
  function laneLangKey() { return LANG_KEY + ':' + laneNo; }

  function rememberedLang() {
    try { return window.localStorage.getItem(laneLangKey()) || window.localStorage.getItem(LANG_KEY); }
    catch (e) { return null; }
  }

  // Banans språk enligt servern, eller null innan första statusmeddelandet. (TouchConsole.js
  // har "English" i lang från början, så lang ensam säger inte om språket är känt.)
  // laneLang är banans eget språk, som poängbilden ritas på; lang är slavens enda (första
  // banans, läst när LoadCom startade). En äldre slav skickar bara lang.
  function serverLang() {
    try {
      var p = window.vbsLaneStatus;
      if (!p) return null;
      var l = typeof p.laneLang === 'string' && p.laneLang !== '' ? p.laneLang : p.lang;
      return typeof l === 'string' && l !== '' ? l : null;
    } catch (e) { return null; }
  }

  // Språket sidan visar, som serverns namn: gästernas val, annars banans, annars det tabletten
  // hade senast. Det enda svaret - texterna, flaggknappen och tangentbordets knappar
  // (vbskeyboard.js, config.language) frågar alla här.
  function shownLanguage() {
    return langOverride() || serverLang() || rememberedLang() || 'English';
  }

  function syncLanguage() {
    var known = serverLang();
    var l = shownLanguage();
    if (known) {
      try { if (window.localStorage.getItem(laneLangKey()) !== known) window.localStorage.setItem(laneLangKey(), known); }
      catch (e) { /* bara en bekvämlighet */ }
    }
    if (l !== shownLang) {
      shownLang = l;
      // När språkfilen har laddats: alla texter på en gång, också de tick() skriver
      I.use(l).then(function () { I.apply(); if (document.body) tick(); });
    }
    // Varje gång, inte bara vid byte: ChangeLanguage() i TouchConsole.js skriver sina egna
    // (hårdkodade) texter på samma element när banans språk ändras, och apply() skriver bara
    // där texten skiljer sig.
    I.apply();
    document.documentElement.style.setProperty('--laneLabel', '"' + laneLabel() + '"');
    document.documentElement.lang = I.code() || 'sv';
  }

  // ------------------------------------------------------------------ språkval
  //
  // Gästerna kan byta språk på banan: knappen med flaggan i banans band (startbilden, GSX,
  // bandet ovanför bilden i en kolumn) eller i knappraden under spel på hela skärmen öppnar
  // #rev2LangDialog. Valet gäller den här banan och bara konsolen - poängbilden, TV:n och
  // utskrifter följer banans språk från servern som förut ("hallens språk" i dialogen: banans
  // eget, laneLang). Det sparas i tabletten (localStorage, per bana), så det ligger kvar om sidan
  // laddas om under spelet, och tas bort när banan stängs av (status Commercial eller Info).
  // Väljer man banans språk tas valet bort.
  //
  // Stängs banan inte av mellan sällskapen tas valet bort efter 30 minuter utan aktivitet:
  // banan har inte spelat och ingen har rört dess konsol (rev2LangActive:<bana>). Under spel
  // ligger valet kvar. Samma regel tar hand om en tablet som har sovit eller varit avstängd
  // medan banan bytte sällskap - då har ingen aktivitet heller noterats.
  //
  // När valet gjordes sparas också (rev2LangChosen:<bana>): på ett banpar där båda banorna syns
  // har skalet en gemensam rubrik och Service-knapp, och de visas på det språk som valdes
  // senast på någon av banorna - annars hallens (rev2Lane.languageChoice, touchconsoleMain.js).

  var LANGS = [
    { code: 'sv', name: 'Svenska', server: 'Svenska' },
    { code: 'en', name: 'English', server: 'English' },
    { code: 'fi', name: 'Suomi',   server: 'Suomeksi' },
    { code: 'de', name: 'Deutsch', server: 'Deutsch' },
    { code: 'da', name: 'Dansk',   server: 'Dansk' },
    { code: 'no', name: 'Norsk',   server: 'Norsk' }
  ];
  var FLAGS = {
      "sv": "<svg viewBox=\"0 0 16 10\" aria-hidden=\"true\"><rect width=\"16\" height=\"10\" fill=\"#006AA7\"></rect><rect x=\"5\" width=\"2\" height=\"10\" fill=\"#FECC00\"></rect><rect y=\"4\" width=\"16\" height=\"2\" fill=\"#FECC00\"></rect></svg>",
      "en": "<svg viewBox=\"0 0 60 30\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><rect width=\"60\" height=\"30\" fill=\"#012169\"></rect><path d=\"M0 0L60 30M60 0L0 30\" stroke=\"#FFFFFF\" stroke-width=\"6\"></path><path d=\"M0 0L60 30M60 0L0 30\" stroke=\"#C8102E\" stroke-width=\"2\"></path><path d=\"M30 0v30M0 15h60\" stroke=\"#FFFFFF\" stroke-width=\"10\"></path><path d=\"M30 0v30M0 15h60\" stroke=\"#C8102E\" stroke-width=\"6\"></path></svg>",
      "fi": "<svg viewBox=\"0 0 18 11\" aria-hidden=\"true\"><rect width=\"18\" height=\"11\" fill=\"#FFFFFF\"></rect><rect x=\"5\" width=\"3\" height=\"11\" fill=\"#002F6C\"></rect><rect y=\"4\" width=\"18\" height=\"3\" fill=\"#002F6C\"></rect></svg>",
      "de": "<svg viewBox=\"0 0 5 3\" aria-hidden=\"true\"><rect width=\"5\" height=\"1\" fill=\"#000000\"></rect><rect y=\"1\" width=\"5\" height=\"1\" fill=\"#DD0000\"></rect><rect y=\"2\" width=\"5\" height=\"1\" fill=\"#FFCE00\"></rect></svg>",
      "da": "<svg viewBox=\"0 0 32 20\" aria-hidden=\"true\"><rect width=\"32\" height=\"20\" fill=\"#C8102E\"></rect><rect x=\"10\" width=\"4\" height=\"20\" fill=\"#FFFFFF\"></rect><rect y=\"8\" width=\"32\" height=\"4\" fill=\"#FFFFFF\"></rect></svg>",
      "no": "<svg viewBox=\"0 0 24 15\" aria-hidden=\"true\"><rect width=\"24\" height=\"15\" fill=\"#BA0C2F\"></rect><rect x=\"6\" width=\"4\" height=\"15\" fill=\"#FFFFFF\"></rect><rect y=\"5.5\" width=\"24\" height=\"4\" fill=\"#FFFFFF\"></rect><rect x=\"7\" width=\"2\" height=\"15\" fill=\"#00205B\"></rect><rect y=\"6.5\" width=\"24\" height=\"2\" fill=\"#00205B\"></rect></svg>"
  };
  var OFF_STATUSES = ['Commercial', 'Info'];

  // Skalet (TouchConsole.html/TouchConsole2.html), eller null när sidan är öppnad direkt
  function shell() {
    try { return window.parent !== window && window.parent.rev2Shell ? window.parent.rev2Shell : null; }
    catch (e) { return null; }
  }

  var IDLE_MS = 30 * 60 * 1000;           // valet glöms efter så lång tid utan aktivitet
  var ACTIVE_WRITE_MS = 60 * 1000;        // aktivitet sparas högst så här ofta

  function overrideKey() { return 'rev2LangOverride:' + laneNo; }
  function chosenKey() { return 'rev2LangChosen:' + laneNo; }
  function activeKey() { return 'rev2LangActive:' + laneNo; }

  // Lagring: localStorage, eller minnet om tabletten saknar den (en Android-WebView utan
  // DOM-lagring) - då gäller valet tills sidan laddas om.
  var memStore = {};
  function storeGet(k) {
    if (Object.prototype.hasOwnProperty.call(memStore, k)) return memStore[k];
    try { return window.localStorage ? window.localStorage.getItem(k) : null; } catch (e) { return null; }
  }
  function storeSet(k, v) {
    try {
      if (window.localStorage) { window.localStorage.setItem(k, v); delete memStore[k]; return; }
    } catch (e) { /* full eller avstängd */ }
    memStore[k] = v;
  }
  function storeRemove(k) {
    delete memStore[k];
    try { if (window.localStorage) window.localStorage.removeItem(k); } catch (e) { /* ingen lagring */ }
  }
  function storeTime(k) { return parseInt(storeGet(k), 10) || 0; }

  // Banan är igång med något annat än namnifyllning (spel, meddelande): valet ska ligga kvar
  function laneBusy() {
    return typeof laneStatus === 'string' && laneStatus !== '' &&
      laneStatus.indexOf('NoPlayer') !== 0 && OFF_STATUSES.indexOf(laneStatus) < 0;
  }

  // Senaste aktivitet för valet: när det gjordes, konsolen rördes eller banan spelade
  function lastActivity() { return Math.max(storeTime(activeKey()), storeTime(chosenKey())); }
  function langStale() { return !laneBusy() && Date.now() - lastActivity() > IDLE_MS; }

  // Gästernas val, som serverns namn ("Suomeksi" ...), eller null. Ett val som har legat för
  // länge utan aktivitet gäller inte längre (syncLangReset tar bort det) - så att en tablet som
  // startar efter en lång paus inte först visar förra sällskapets språk.
  function langOverride() {
    var v = storeGet(overrideKey());
    return v && !langStale() ? v : null;
  }

  // När gästerna senast valde språk på banan (ms), eller 0
  function langChosenAt() { return storeTime(chosenKey()); }

  var activeWritten = 0;
  function noteActivity() {
    if (!storeGet(overrideKey()) && !langChosenAt()) return;
    var now = Date.now();
    if (now - activeWritten < ACTIVE_WRITE_MS) return;
    activeWritten = now;
    storeSet(activeKey(), String(now));
  }

  // server: serverns namn på språket, eller null för hallens. byGuest: gästerna valde i
  // dialogen (då sparas tiden, också när de valde hallens språk); annars tas allt bort.
  function setLangOverride(server, byGuest) {
    if (server) storeSet(overrideKey(), server);
    else storeRemove(overrideKey());
    if (byGuest) {
      var now = String(Date.now());
      storeSet(chosenKey(), now);
      storeSet(activeKey(), now);
    } else {
      storeRemove(chosenKey());
      storeRemove(activeKey());
    }
    syncLanguage();
    syncLangButtons();
    // Skalets gemensamma rubrik och Service byter direkt (annars vid nästa tick)
    var s = shell();
    try { if (s && s.languageChanged) s.languageChanged(); } catch (e) { /* skalet laddas */ }
  }

  function langByCode(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return LANGS[1];
  }

  // Språket som visas nu (koden från språkfilen som används)
  function shownLangInfo() {
    return langByCode(I.codeFor(shownLanguage()));
  }

  function fillFlag(el, code) {
    if (el.getAttribute('data-flag') === code) return;
    el.setAttribute('data-flag', code);
    el.innerHTML = FLAGS[code] || '';
  }

  function syncLangButtons() {
    var info = shownLangInfo();
    var buttons = document.querySelectorAll('.langChip, #rev2LangDock');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      fillFlag(b.querySelector('.langFlag'), info.code);
      var n = b.querySelector('.langName');
      if (n.textContent !== info.name) n.textContent = info.name;
      var aria = I.t('lang.button') + ': ' + info.name;
      if (b.getAttribute('aria-label') !== aria) b.setAttribute('aria-label', aria);
    }
  }

  function closeLang() { byId('rev2LangDialog').hidden = true; }

  function openLang() {
    var list = byId('rev2LangList');
    var current = shownLangInfo().code;
    var hall = I.codeFor(serverLang() || rememberedLang() || 'English');
    list.innerHTML = '';
    LANGS.forEach(function (l) {
      var b = el('button', 'langTile' + (l.code === current ? ' isOn' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(l.code === current));
      var f = el('span', 'langFlag');
      f.setAttribute('aria-hidden', 'true');
      fillFlag(f, l.code);
      var n = el('span', 'langName');
      n.textContent = l.name;
      b.appendChild(f);
      b.appendChild(n);
      if (l.code === hall) {
        var h = el('span', 'langHall', 'lang.hall');
        h.textContent = I.t('lang.hall');
        b.appendChild(h);
      }
      b.addEventListener('click', function () {
        setLangOverride(l.code === hall ? null : l.server, true);
        closeLang();
      });
      list.appendChild(b);
    });
    byId('rev2LangDialog').hidden = false;
  }

  function setupLang() {
    // Nycklar från en tidigare testversion där valet gällde hela banparet ("rev2LangOverride:7-8")
    try {
      for (var k = window.localStorage.length - 1; k >= 0; k--) {
        var key = window.localStorage.key(k);
        if (/^rev2LangOverride:\d+-\d+$/.test(key)) window.localStorage.removeItem(key);
      }
    } catch (e) { /* ingen lagring */ }

    // En knapp i varje band
    var bands = document.querySelectorAll('.laneBand, .playBand');
    for (var i = 0; i < bands.length; i++) {
      var b = el('button', 'langChip');
      b.type = 'button';
      var f = el('span', 'langFlag');
      f.setAttribute('aria-hidden', 'true');
      b.appendChild(f);
      b.appendChild(el('span', 'langName'));
      bands[i].appendChild(b);
    }
    // Gästerna använder konsolen: valet är fortfarande deras
    ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'input'].forEach(function (type) {
      document.addEventListener(type, noteActivity, true);
    });

    var all = document.querySelectorAll('.langChip, #rev2LangDock');
    for (var j = 0; j < all.length; j++) all[j].addEventListener('click', function (e) {
      e.preventDefault();
      openLang();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang-close]'), function (b) {
      b.addEventListener('click', closeLang);
    });
    byId('rev2LangDialog').addEventListener('click', function (e) { if (e.target === this) closeLang(); });
    syncLangButtons();
  }

  // Tillbaka till hallens språk när banan stängs av, eller efter 30 minuter utan aktivitet
  function syncLangReset() {
    if (typeof laneStatus !== 'string' || laneStatus === '') return;
    var any = storeGet(overrideKey()) || langChosenAt() || storeGet(activeKey());
    if (OFF_STATUSES.indexOf(laneStatus) >= 0) {
      if (any) setLangOverride(null, false);
      var d = byId('rev2LangDialog');
      if (d && !d.hidden) closeLang();
      return;
    }
    if (!any) return;
    if (laneBusy()) { noteActivity(); return; }
    if (langStale()) setLangOverride(null, false);
  }

  // ------------------------------------------------------------------ originalskriptens texter
  //
  // Några texter skriver originalskripten själva, hårdkodade i hallens språk, bara på svenska
  // eller bara på engelska. De hämtas här ur språkfilen i stället, så att de följer konsolens
  // språk som allt annat - utan att skripten ändras:
  //   - startBowling.js partnerBusyMessage(): grannbanan upptagen (amerikanskt spel)
  //   - TouchConsole.js isDataValid(): de två alert() i Ändra spelare
  //   - VBSTchangePlayer.js updateVBSTreservPlayers(): hjälptexten i Byt in reserv
  // Globala funktioner i skripten slås upp via namnet när de anropas, så det räcker att byta
  // ut dem på window. Texter som inte känns igen visas som förut.

  var ALERTS = {
    'Please select active player !': 'alert.selectActive',
    'Player name cannot be empty !': 'alert.emptyName'
  };

  function setupScriptTexts() {
    if (typeof window.partnerBusyMessage === 'function') {
      window.partnerBusyMessage = function (partnerLane) {
        return I.t('alert.partnerBusy', { lane: partnerLane });
      };
    }

    var nativeAlert = window.alert;
    window.alert = function (msg) {
      var key = ALERTS[String(msg)];
      return nativeAlert.call(window, key ? I.t(key) : msg);
    };

    if (typeof window.updateVBSTreservPlayers === 'function') {
      var original = window.updateVBSTreservPlayers;
      window.updateVBSTreservPlayers = function () {
        var result = original.apply(this, arguments);
        syncReserveInfo();
        return result;
      };
    }
  }

  // Hjälptexten under Byt in reserv: originalet väljer text efter om spelaren får bytas
  // (knappen Byt ut/in aktiv eller inte). Nyckeln läggs på elementet så att apply() byter
  // texten om språket ändras medan dialogen är öppen; radbrytningarna (\n) visas av CSS.
  function syncReserveInfo() {
    var p = byId('changePlayerInfo');
    var b = byId('changePlayersubmitbutton');
    if (!p || p.textContent === '') return;
    var key = b && b.disabled ? 'reserve.infoLocked' : 'reserve.infoOk';
    if (p.getAttribute('data-i18n') !== key) p.setAttribute('data-i18n', key);
    var txt = I.t(key);
    if (p.textContent !== txt) p.textContent = txt;
  }

  // ------------------------------------------------------------------ spelsätt och start

  function currentModeValue() {
    var start = byId('startBowling');
    return start ? start.innerHTML.trim() : '';
  }

  // Det synliga namnet på spelsättet som startknappen står på: texten på knappen med samma
  // value i "Välj spelsätt" (översatt), eller data-mode-name för No Tap/Short Game.
  function currentModeName() {
    var value = currentModeValue();
    var buttons = document.querySelectorAll('#otherBowlingForm .gameType, #otherBowlingForm .gameTypeSub');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].value === value)
        return buttons[i].getAttribute('data-mode-name') || buttons[i].textContent.trim();
    }
    // Efter ett språkbyte står startknappen på ChangeLanguage():s översatta text - vanlig bowling.
    var normal = byId('gameType10Pin');
    return normal ? normal.textContent.trim() : '';
  }

  function syncModes() {
    var value = currentModeValue();
    var anyMatch = false;
    var chips = document.querySelectorAll('.quickMode');
    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      var src = byId(chip.getAttribute('data-src'));
      if (src) {
        if (chip.textContent !== src.textContent) chip.textContent = src.textContent;
        chip.classList.toggle('isHidden', src.style.visibility === 'hidden');
      }
      var match = chip.value === value;
      chip.classList.toggle('isSelected', match);
      if (match) anyMatch = true;
    }
    if (!anyMatch && chips.length && !/3-6-9|mini|10th|notap|short|ameri|gsx/i.test(value))
      chips[0].classList.add('isSelected');

    var tiles = document.querySelectorAll('#otherBowlingForm .gameType, #otherBowlingForm .gameTypeSub');
    for (var j = 0; j < tiles.length; j++)
      tiles[j].classList.toggle('isSelected', tiles[j].value === value);

    var nameEl = byId('currentModeName');
    var name = currentModeName();
    if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
  }

  function playerCount() {
    var names = document.querySelectorAll('#bowlingStartForm .playerName');
    var n = 0;
    // Only the rows the form shows ("Antal spelarfält", startBowling.js), as the start sends them.
    var shown = typeof vbsMaxPlayers === 'number' ? vbsMaxPlayers : names.length;
    for (var i = 0; i < names.length && i < shown; i++)
      if (names[i].value.trim().length > 0) n++;
    return n;
  }

  function syncStart() {
    var n = playerCount();
    var count = byId('playerCount');
    // "{n} av {max}": max is the rows the form shows ("Antal spelarfält", startBowling.js).
    var max = typeof vbsMaxPlayers === 'number' ? vbsMaxPlayers : 6;
    if (count) count.textContent = I.t('playersCount', { n: n, max: max });

    var real = byId('startBowling');
    var btn = byId('rev2Start');
    if (!real || !btn) return;
    btn.disabled = real.disabled;

    var label = pair ? I.t('start') + ' ' + laneLabel() : I.t('start');
    var sub = I.t('startSub', { n: n, mode: currentModeName() });
    var l = btn.querySelector('.rev2StartLabel');
    var s = btn.querySelector('.rev2StartSub');
    if (l.textContent !== label) l.textContent = label;
    if (s.textContent !== sub) s.textContent = sub;
  }

  // ------------------------------------------------------------------ spel och knapprad

  function isPlaying() {
    var buttons = document.querySelector('.lanebuttons');
    return !!buttons && buttons.style.display !== 'none' &&
           typeof laneStatus === 'string' && laneStatus === 'Playing';
  }

  // I kolumnläget ligger knapparna fyra per rad; Avsluta spel tar resten av sista raden, så
  // att raden alltid är full - oavsett hur många knappar hallen har slagit på.
  function syncDock() {
    var stop = byId('stopBowlingbutton');
    if (!stop) return;
    if (mode !== 'column') { stop.style.gridColumn = ''; return; }

    var all = document.querySelectorAll('.lanebuttons .onGoingGameButton');
    var n = 0;
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (b === stop || b.id === 'onGoingMiniLogo' || b.id === 'callPersonalButton' || b.classList.contains('dockSpacer')) continue;
      if (window.getComputedStyle(b).display !== 'none') n++;
    }
    var span = 4 - (n % 4);
    var want = 'span ' + span;
    if (stop.style.gridColumn !== want) stop.style.gridColumn = want;
  }

  function applyMode() {
    var b = document.body.classList;
    b.toggle('rev2Full', mode !== 'column');
    b.toggle('rev2Column', mode === 'column');
    b.toggle('vbsPlaying', isPlaying());
  }

  // ------------------------------------------------------------------ GSX-träning
  //
  // Originalfälten i .gsxHiddenFields är det startBowling.js läser när träningen startas:
  // per spelare ett namnfält, en rullista (rad 0 = egna käglor, rad 1.. = färdiga program från
  // getTrainingNames.json) och tio kryssrutor i ordningen 7 8 9 10 / 4 5 6 / 2 3 / 1.
  // Korten nedan visar och ändrar just de fälten - namnfältet flyttas in i kortet, rullistan och
  // kryssrutorna styrs härifrån - så submitStartTraining() skickar exakt samma sak som förut.

  var PIN_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  var PIN_INDEX = { 7: 0, 8: 1, 9: 2, 10: 3, 4: 4, 5: 5, 6: 6, 2: 7, 3: 8, 1: 9 };
  var GROUP_END = [1, 3, 6];                      // luckor efter 1, 3 och 6: triangelns rader
  var PREVIEW_ROWS = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
  var gsx = null;

  function el(tag, cls, i18n) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (i18n) e.setAttribute('data-i18n', i18n);
    if (tag === 'button') e.type = 'button';
    return e;
  }

  function changed(select) {
    select.dispatchEvent(new Event('change'));      // kör updateTrainingPINsActive()
  }

  function buildGsx() {
    var left = byId('trainingFormLeft');
    var right = byId('trainingFormRight');
    var box = byId('gsxCards');
    if (!left || !right || !box) return;

    var inputs = left.querySelectorAll('.playerName');
    var selects = left.querySelectorAll('select');
    var checks = right.querySelectorAll('input[type=checkbox]');
    gsx = { cards: [], dialogFor: -1 };

    for (var i = 0; i < inputs.length; i++) (function (i) {
      var card = el('div', 'gsxCard');
      var main = el('div', 'gsxCardMain');

      var row1 = el('div', 'gsxRow1');
      var no = el('span', 'nameNo');
      no.textContent = i + 1;
      var seg = el('div', 'gsxSeg');
      seg.setAttribute('role', 'radiogroup');
      var own = el('button', '', 'gsx.own');
      var prog = el('button', '', 'gsx.program');
      seg.appendChild(own);
      seg.appendChild(prog);
      row1.appendChild(no);
      row1.appendChild(inputs[i]);                  // samma element, flyttat hit
      row1.appendChild(seg);

      var pinsRow = el('div', 'gsxPins');
      var pinButtons = {};
      PIN_ORDER.forEach(function (p) {
        var b = el('button', 'gsxPin' + (GROUP_END.indexOf(p) >= 0 ? ' groupEnd' : ''));
        b.textContent = p;
        b.setAttribute('aria-label', String(p));
        b.addEventListener('click', function () { togglePin(i, p); });
        pinButtons[p] = b;
        pinsRow.appendChild(b);
      });
      pinsRow.appendChild(el('span', 'gsxPinsSpacer'));
      var all = el('button', 'gsxSmall gsxPinAll', 'gsx.all');
      var clear = el('button', 'gsxSmall', 'gsx.clear');
      all.addEventListener('click', function () { setAllPins(i, true); });
      clear.addEventListener('click', function () { setAllPins(i, false); });
      pinsRow.appendChild(all);
      pinsRow.appendChild(clear);

      var progRow = el('div', 'gsxProgRow');
      var progName = el('span', 'gsxProgName');
      var lbl = el('span', 'lbl', 'gsx.programLabel');
      var val = el('span', 'val');
      progName.appendChild(lbl);
      progName.appendChild(val);
      var choose = el('button', 'gsxChoose', 'gsx.chooseProgram');
      progRow.appendChild(progName);
      progRow.appendChild(choose);

      main.appendChild(row1);
      main.appendChild(pinsRow);
      main.appendChild(progRow);

      var preview = el('div', 'gsxPreview');
      preview.setAttribute('aria-hidden', 'true');
      var dots = {};
      PREVIEW_ROWS.forEach(function (row) {
        var r = el('div', 'row');
        row.forEach(function (p) { var d = el('span', 'dot'); dots[p] = d; r.appendChild(d); });
        preview.appendChild(r);
      });

      card.appendChild(main);
      card.appendChild(preview);
      box.appendChild(card);

      own.addEventListener('click', function () {
        if (selects[i].selectedIndex !== 0) { selects[i].selectedIndex = 0; changed(selects[i]); }
      });
      prog.addEventListener('click', function () { openPrograms(i); });
      choose.addEventListener('click', function () { openPrograms(i); });

      gsx.cards.push({
        card: card, input: inputs[i], select: selects[i], own: own, prog: prog,
        pinButtons: pinButtons, dots: dots, val: val,
        checkFor: function (p) { return checks[i * 10 + PIN_INDEX[p]]; }
      });
    })(i);

    // Programlistan
    Array.prototype.forEach.call(document.querySelectorAll('[data-gsx-close]'), function (b) {
      b.addEventListener('click', closePrograms);
    });
    byId('gsxProgramDialog').addEventListener('click', function (e) { if (e.target === this) closePrograms(); });
    byId('gsxProgramOwn').addEventListener('click', function () {
      var c = gsx.cards[gsx.dialogFor];
      if (c && c.select.selectedIndex !== 0) { c.select.selectedIndex = 0; changed(c.select); }
      closePrograms();
    });

    var start = byId('gsxStart');
    start.addEventListener('click', function () {
      var real = byId('startTraning');
      if (real && !real.disabled) real.click();
    });
  }

  function togglePin(i, p) {
    var cb = gsx.cards[i].checkFor(p);
    if (!cb || cb.disabled) return;
    cb.checked = !cb.checked;
    if (typeof checkTrainingValid === 'function') checkTrainingValid();
    syncGsx();
  }

  function setAllPins(i, on) {
    PIN_ORDER.forEach(function (p) {
      var cb = gsx.cards[i].checkFor(p);
      if (cb && !cb.disabled) cb.checked = on;
    });
    if (typeof checkTrainingValid === 'function') checkTrainingValid();
    syncGsx();
  }

  function openPrograms(i) {
    var c = gsx.cards[i];
    var opts = c.select.options;
    if (opts.length <= 1) return;                   // inga program från servern
    gsx.dialogFor = i;

    var name = c.input.value.trim() || ('#' + (i + 1));
    byId('gsxProgramTitle').textContent = I.t('gsx.chooseFor', { name: name });
    byId('gsxProgramSub').textContent = I.t('gsx.programCount', { lane: laneLabel(), n: opts.length - 1 });

    var list = byId('gsxProgramList');
    list.innerHTML = '';
    var selectedButton = null;
    for (var k = 1; k < opts.length; k++) (function (k) {
      var b = el('button', c.select.selectedIndex === k ? 'isOn' : '');
      var no = el('span', 'no');
      no.textContent = k;
      var nm = el('span', 'name');
      nm.textContent = opts[k].text;
      b.appendChild(no);
      b.appendChild(nm);
      b.addEventListener('click', function () {
        c.select.selectedIndex = k;
        changed(c.select);
        closePrograms();
      });
      if (c.select.selectedIndex === k) selectedButton = b;
      list.appendChild(b);
    })(k);

    byId('gsxProgramDialog').hidden = false;
    list.scrollTop = 0;
    if (selectedButton) selectedButton.scrollIntoView({ block: 'nearest' });
  }

  function closePrograms() {
    byId('gsxProgramDialog').hidden = true;
    gsx.dialogFor = -1;
    syncGsx();
  }

  function syncGsx() {
    if (!gsx) return;
    var named = 0;
    gsx.cards.forEach(function (c) {
      var opts = c.select.options;
      var progMode = c.select.selectedIndex > 0;
      c.card.setAttribute('data-mode', progMode ? 'prog' : 'own');
      c.card.classList.toggle('isEmpty', c.input.value.trim() === '');
      if (c.input.value.trim() !== '') named++;

      c.own.classList.toggle('isOn', !progMode);
      c.prog.classList.toggle('isOn', progMode);
      c.prog.hidden = opts.length <= 1;
      c.own.setAttribute('aria-checked', String(!progMode));
      c.prog.setAttribute('aria-checked', String(progMode));

      PIN_ORDER.forEach(function (p) {
        var cb = c.checkFor(p);
        var on = !!cb && cb.checked;
        c.pinButtons[p].classList.toggle('isOn', on);
        c.pinButtons[p].setAttribute('aria-pressed', String(on));
        c.pinButtons[p].disabled = !cb || cb.disabled;
        c.dots[p].classList.toggle('isOn', on && !progMode);
      });

      var progText = progMode && opts[c.select.selectedIndex] ? opts[c.select.selectedIndex].text : '';
      if (c.val.textContent !== progText) c.val.textContent = progText;
    });

    var real = byId('startTraning');
    var btn = byId('gsxStart');
    if (real && btn) {
      btn.disabled = real.disabled;
      var label = pair ? I.t('gsx.start') + ' ' + laneLabel() : I.t('gsx.start');
      var sub = I.t('gsx.startSub', { n: named });
      var l = btn.querySelector('.rev2StartLabel');
      var s = btn.querySelector('.rev2StartSub');
      if (l.textContent !== label) l.textContent = label;
      if (s.textContent !== sub) s.textContent = sub;
    }
  }

  // ------------------------------------------------------------------ Reset/Set
  //
  // Käglorna är originalets kryssrutor pin1-pin10 (fetchLastPlayedPinPattern fyller i dem,
  // submitPinSetLane läser dem), lagda osynliga över sina siffror, så de behöver inget skript.
  // Här: Alla/Inga, antalet, texten och den lilla triangeln på andraslagskortet, och korten som
  // trycker på originalets dolda knappar (TouchConsole.js binder sina klick på dem).

  var PIN_ROWS = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
  var pinDots = {};               // kägla -> prick i andraslagskortets triangel

  function pinBox(n) { return byId('pin' + n); }

  function fillPinIcon(icon, keep) {
    PIN_ROWS.forEach(function (row) {
      var r = el('span', 'row');
      row.forEach(function (n) {
        var d = el('span', 'dot');
        if (keep) keep[n] = d;
        r.appendChild(d);
      });
      icon.appendChild(r);
    });
  }

  function setAllPinBoxes(on) {
    for (var n = 1; n <= 10; n++) {
      var cb = pinBox(n);
      if (cb && !cb.disabled) cb.checked = on;
    }
    syncPins();
  }

  function setupPins() {
    var first = byId('pinFirstCard');
    var second = byId('pinSecondCard');
    if (!first || !second) return;
    fillPinIcon(first.querySelector('.pinIcon'), null);
    fillPinIcon(second.querySelector('.pinIcon'), pinDots);

    first.addEventListener('click', function () {
      var real = byId('pinResetSubmitbutton');
      if (real && !real.disabled) real.click();
    });
    second.addEventListener('click', function () {
      var real = byId('pinSetSubmitbutton');
      if (real && !real.disabled) real.click();
    });
    byId('pinAll').addEventListener('click', function () { setAllPinBoxes(true); });
    byId('pinNone').addEventListener('click', function () { setAllPinBoxes(false); });
    byId('pinSetter').addEventListener('change', syncPins);
  }

  function syncPins() {
    var count = byId('pinCount');
    if (!count) return;
    var n = 0;
    for (var p = 1; p <= 10; p++) {
      var cb = pinBox(p);
      var on = !!cb && cb.checked;
      if (on) n++;
      if (pinDots[p]) pinDots[p].classList.toggle('isOn', on);
    }
    var c = I.t('pins.count', { n: n });
    if (count.textContent !== c) count.textContent = c;
    var sub = byId('pinSecondSub');
    var s = n === 0 ? I.t('pins.secondSubNone') : n === 1 ? I.t('pins.secondSubOne') : I.t('pins.secondSub', { n: n });
    if (sub.textContent !== s) sub.textContent = s;
  }

  // ------------------------------------------------------------------ Service i knappraden
  //
  // Under spel på hela skärmen ligger Service i banans knapprad. Den öppnar skalets dialog
  // (rev2Shell.askService) i stället för bankonsolens egen #callPersonal, så att Service ser ut
  // och fungerar likadant var man än trycker: fråga, anrop, bekräftelse som stängs själv.
  // Utan skalet (sidan öppnad direkt) gäller den gamla dialogen som förut.

  function setupService() {
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('#callPersonalButton') : null;
      if (!b) return;
      var shell = null;
      try { shell = window.parent !== window ? window.parent.rev2Shell : null; } catch (err) { shell = null; }
      if (!shell || !shell.askService) return;
      e.preventDefault();
      e.stopPropagation();
      shell.askService(laneNo);
    }, true);
  }

  // ------------------------------------------------------------------ Ändra spelare i en kolumn
  //
  // Rubriken Aktiv står över en smal kolumn. Får ordet inte plats där (finska) tar det
  // Spelarnamns plats i rubrikraden i stället för att klippas av, se touchconsoleLane.css.

  function syncPlayerHead() {
    // Amerikanskt spel: ingen Aktiv-kolumn (se CSS, ÄNDRA SPELARE)
    var dlg = byId('changeactive');
    if (dlg) dlg.classList.toggle('isAMR', window.isAMR === true);

    var head = document.querySelector('#changeactive .playerGridHead');
    var active = head ? head.querySelector('.colActive') : null;
    if (!active) return;
    if (mode !== 'column') { head.classList.remove('longActive'); return; }
    if (!active.clientWidth) return;            // dialogen är inte öppen
    head.classList.toggle('longActive', active.scrollWidth > active.clientWidth + 1);
  }

  // ------------------------------------------------------------------ Ändra spelare: dra
  //
  // Spelordningen ändras genom att dra i handtaget längst till vänster på raden (pilarna upp/ned
  // från TouchConsole.js visas inte längre, se CSS). Raderna byggs av TouchConsole.js (AddPlayer),
  // så handtaget läggs till när en rad dyker upp i #playerNameList. Ordningen är radernas ordning
  // i listan, och submitChangePlayerInfoForm() läser dem uppifrån och ned - att flytta raden är
  // därför allt som behövs, precis som pilarna gjorde.
  //
  // Pekhändelser (pointer events), inte webbläsarens dra-och-släpp: originalets draggable på
  // raderna gör ingenting med finger på Android, och stängs av här så att det inte stör med mus.

  var drag = null;

  function addDragHandles() {
    var rows = document.querySelectorAll('#playerNameList > .playerRow');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector('.dragHandle')) continue;
      row.draggable = false;
      var h = document.createElement('span');
      h.className = 'dragHandle';
      h.setAttribute('aria-hidden', 'true');
      row.insertBefore(h, row.firstChild);
    }
  }

  function otherRows(list, row) {
    var out = [];
    for (var c = list.firstElementChild; c; c = c.nextElementSibling)
      if (c !== row && c.classList.contains('playerRow')) out.push(c);
    return out;
  }

  function startDrag(e) {
    var h = e.target && e.target.closest ? e.target.closest('.dragHandle') : null;
    if (!h) return;
    // En dragning vars handtag inte längre finns i sidan (listan byggdes om och släppet kom
    // aldrig fram) får inte spärra nästa
    if (drag) {
      if (document.documentElement.contains(drag.handle)) return;
      endDrag();
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var row = h.parentNode;
    var list = row.parentNode;
    e.preventDefault();

    var top = row.offsetTop;
    var height = row.offsetHeight;
    var slot = document.createElement('div');
    slot.className = 'dropSlot';
    slot.style.height = height + 'px';
    list.insertBefore(slot, row);
    row.classList.add('isDragging');
    row.style.top = top + 'px';

    drag = { row: row, list: list, slot: slot, handle: h, id: e.pointerId,
             startY: e.clientY, startTop: top, height: height };
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* äldre webbläsare */ }
    h.addEventListener('pointermove', moveDrag);
    h.addEventListener('pointerup', endDrag);
    h.addEventListener('pointercancel', endDrag);
    h.addEventListener('lostpointercapture', endDrag);
  }

  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    // Lite utanför listan i båda ändar, så att första och sista platsen går att nå
    var over = drag.height * 0.4;
    var max = Math.max(0, drag.list.clientHeight - drag.height);
    var top = Math.max(-over, Math.min(max + over, drag.startTop + e.clientY - drag.startY));
    drag.row.style.top = top + 'px';

    // Platsen hamnar före den första raden vars mitt ligger under den dragna radens mitt
    var center = top + drag.height / 2;
    var others = otherRows(drag.list, drag.row);
    var before = null;
    for (var i = 0; i < others.length; i++) {
      if (center < others[i].offsetTop + others[i].offsetHeight / 2) { before = others[i]; break; }
    }
    if (before) {
      if (drag.slot.nextElementSibling !== before) drag.list.insertBefore(drag.slot, before);
    } else if (others.length) {
      var last = others[others.length - 1];
      if (drag.slot.previousElementSibling !== last) drag.list.insertBefore(drag.slot, last.nextSibling);
    }
  }

  function endDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.handle.removeEventListener('pointermove', moveDrag);
    d.handle.removeEventListener('pointerup', endDrag);
    d.handle.removeEventListener('pointercancel', endDrag);
    d.handle.removeEventListener('lostpointercapture', endDrag);
    // Listan kan ha byggts om under tiden (updatePlayerInfo tömmer den): då finns varken platsen
    // eller raden kvar i den, och raden ska inte tillbaka.
    if (d.slot.parentNode === d.list) {
      d.list.insertBefore(d.row, d.slot);
      d.list.removeChild(d.slot);
    } else if (d.slot.parentNode) {
      d.slot.parentNode.removeChild(d.slot);
    }
    d.row.classList.remove('isDragging');
    d.row.style.top = '';
    try { d.handle.releasePointerCapture(d.id); } catch (err) { /* redan släppt */ }
  }

  // ------------------------------------------------------------------ Ändra spelare: få plats
  //
  // Ändra spelare och Ändra aktiv spelare (amerikanskt spel) ska rymmas utan att dialogen
  // rullar, så att Spara alltid syns. Med sju eller åtta spelare på en bana kan raderna bli
  // tätare (manyPlayers), och tipset under listan kan döljas (noDragHint) - men bara när det
  // behövs: först provas vanliga rader med tips, sedan tätare rader, sist utan tips. Klasserna
  // byts i samma skriptvarv, så inget av försöken hinner synas på skärmen.
  // Inte under en dragning (radernas höjd får inte ändras då) och inte medan ett tangentbord är
  // uppe (då är fönstret tillfälligt lägre, och raderna ska inte hoppa medan man skriver).

  function fits(overlay, pop) {
    var os = window.getComputedStyle(overlay), ps = window.getComputedStyle(pop);
    var need = pop.offsetHeight + (parseFloat(ps.marginTop) || 0) + (parseFloat(ps.marginBottom) || 0) +
               (parseFloat(os.paddingTop) || 0) + (parseFloat(os.paddingBottom) || 0);
    return need <= overlay.clientHeight + 1;
  }

  function isOpen(overlay) {
    return !!overlay && window.getComputedStyle(overlay).display !== 'none';
  }

  function syncPlayerFit() {
    if (drag && document.documentElement.contains(drag.handle)) return;
    if (document.body.classList.contains('kbOpen')) return;

    var dlg = byId('changeactive');
    var pop = dlg ? dlg.querySelector('.popup') : null;
    if (pop && isOpen(dlg)) {
      var c = dlg.classList;
      var many = dlg.querySelectorAll('#playerNameList > .playerRow').length >= 7;
      c.remove('manyPlayers');
      c.remove('noDragHint');
      if (many && !fits(dlg, pop)) c.add('manyPlayers');
      if (!fits(dlg, pop)) c.add('noDragHint');
    }

    var amr = byId('AMRchangeActiveSection');
    var apop = amr ? amr.querySelector('.popup') : null;
    if (apop && isOpen(amr)) {
      var most = Math.max(document.querySelectorAll('#oddLane input[type=text]').length,
                          document.querySelectorAll('#evenLane input[type=text]').length);
      amr.classList.remove('manyPlayers');
      if (most >= 7 && !fits(amr, apop)) amr.classList.add('manyPlayers');
    }
  }

  // ------------------------------------------------------------------ Ändra spelare: ta bort
  //
  // removePlayer() i TouchConsole.js letar upp raden med getElementById(id på raden kring knappen
  // som har fokus). Nya spelare (Lägg till spelare) har alla id -1, så med två nya i listan togs
  // den översta av dem bort i stället för den man tryckte på. Precis före (fångstfasen, innan
  // knappens onclick) får raden ett eget id om dess id inte är unikt - den tas bort direkt
  // efteråt, så id:t skickas aldrig - och knappen får fokus om den inte redan har det.
  var removeSeq = 0;

  function setupRemoveFix(list) {
    list.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.btnRemove') : null;
      if (!b || !b.parentNode || b.parentNode.parentNode !== list) return;
      var row = b.parentNode;
      if (document.getElementById(row.id) !== row) row.id = 'rev2Remove' + (++removeSeq);
      if (document.activeElement !== b) { try { b.focus(); } catch (err) { /* ingen fokus */ } }
    }, true);
  }

  function setupPlayerDrag() {
    var list = byId('playerNameList');
    if (!list) return;
    addDragHandles();
    if (window.MutationObserver) {
      new MutationObserver(function () { addDragHandles(); syncPlayerFit(); })
        .observe(list, { childList: true });
    }
    list.addEventListener('dragstart', function (e) { e.preventDefault(); });
    list.addEventListener('pointerdown', startDrag);
    setupRemoveFix(list);
  }

  // ------------------------------------------------------------------ Korrigera
  //
  // correctScore.js väljer spelarens sista slag (focusedCell) först när poängen har laddats, men
  // markerar rutan (getFocus) innan dess - så ingen ruta syntes markerad fast tangenterna redan
  // gällde det slaget. Här markeras den valda rutan och tangenterna begränsas till de möjliga
  // (updateCorrectButtons) så snart poängen finns, med skriptets egna funktioner.

  // Lägg till / Ta bort i correctScore.js flyttar markeringen men låter alla tangenter vara
  // aktiva; när den valda rutan har bytts räknas de möjliga tangenterna om.
  var correctCell = -1;

  function syncCorrect() {
    var dlg = byId('changescore');
    if (!dlg || window.getComputedStyle(dlg).display === 'none') { correctCell = -1; return; }
    if (typeof window.focusedCell !== 'number' || window.focusedCell < 0) { correctCell = -1; return; }
    if (typeof getFocus !== 'function' || typeof updateCorrectButtons !== 'function') return;
    if (!document.querySelector('#scorerow .focusedTabelCell')) getFocus();
    else if (window.focusedCell === correctCell) return;
    updateCorrectButtons();
    correctCell = window.focusedCell;
  }

  function setupCorrect() {
    var row = byId('scorerow');
    // Direkt när poängen skrivs in i rutorna, inte först vid nästa tick
    if (row && window.MutationObserver) {
      new MutationObserver(function () { syncCorrect(); })
        .observe(row, { childList: true, characterData: true, subtree: true });
    }
  }

  // ------------------------------------------------------------------ Flytta spel
  //
  // saveMoveGame.js bygger banknapparna i #targetLanes och skriver den valda banan i #theTarget
  // (som flytten sedan läser). Här: texten ovanför knapparna och vilken knapp som är vald.

  function syncMove() {
    var text = byId('moveText');
    if (!text) return;
    var target = byId('theTarget');
    var lane = target ? target.textContent.trim() : '';

    var key = lane ? 'to|' + lane + '|' + I.t('move.to') : 'choose|' + I.t('move.choose');
    if (text.getAttribute('data-shown') !== key) {
      text.setAttribute('data-shown', key);
      text.textContent = '';
      if (!lane) {
        text.textContent = I.t('move.choose');
      } else {
        var parts = I.t('move.to').split('{lane}');
        text.appendChild(document.createTextNode(parts[0]));
        var b = el('span', 'moveLane');
        b.textContent = lane;
        text.appendChild(b);
        if (parts.length > 1) text.appendChild(document.createTextNode(parts.slice(1).join(lane)));
      }
    }

    var buttons = document.querySelectorAll('#targetLanes button');
    for (var i = 0; i < buttons.length; i++)
      buttons[i].classList.toggle('isSelected', lane !== '' && buttons[i].textContent.trim() === lane);
  }

  // ------------------------------------------------------------------ tangentbord och skrivläge
  //
  // Två sorters tangentbord:
  //   - Vårt, vbskeyboard.js, inne i den här ramen: på Windows, och på Android när WebView kan
  //     hålla Androids tangentbord nere (inputmode) och rita vårt. Sätter vbskb-open på body och
  //     har egna tangenter för Nästa och Klar.
  //   - Androids eget, när vårt står åt sidan (?keyboard=0, eller en för gammal WebView).
  //     WebView krymper; skalet märker det och anropar
  //     rev2Lane.setKeyboard(true) för banan som har fokus. Då visas listen #rev2KbBar
  //     (Föregående / Nästa / Klar) längst ner i ramen, alltså precis ovanför tangentbordet.
  // I båda fallen får body kbOpen: CSS:en visar då bara fälten (skrivläge), se
  // touchconsoleLane.css. Textstorleken låser skalet (räknas från full höjd).
  //
  // Enter (tangentbordets Nästa) går till nästa fält i samma formulär; på sista fältet
  // stängs tangentbordet. enterkeyhint gör att Androids tangentbord visar Nästa/Klar.

  var TEXT_FIELD = 'input[type=text], input:not([type]), textarea';
  var systemKb = false;               // satt av skalet
  var standalone = window.parent === window;
  var ownStable = { w: 0, h: 0 };     // bara när sidan körs utan skalet

  function isTextField(el) {
    return !!el && el.nodeType === 1 && el.matches && el.matches(TEXT_FIELD);
  }

  function fieldsAround(el) {
    var scope = el.form || el.closest('.overlay') || document;
    var all = scope.querySelectorAll(TEXT_FIELD);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var f = all[i];
      if (f.disabled || f.readOnly || f.getClientRects().length === 0) continue;
      out.push(f);
    }
    return out;
  }

  function markEnterKeys(el) {
    var list = fieldsAround(el);
    for (var i = 0; i < list.length; i++) {
      var want = i === list.length - 1 ? 'done' : 'next';
      if (list[i].getAttribute('enterkeyhint') !== want) list[i].setAttribute('enterkeyhint', want);
    }
    return list;
  }

  // Avsluta skrivandet: blur kör fältets onblur (checkMember gör om ett medlemsnummer till
  // namnet) och får Android att fälla ner tangentbordet.
  function finishTyping() {
    var el = document.activeElement;
    if (window.vbsKeyboard && window.vbsKeyboard.isOpen && window.vbsKeyboard.isOpen()) window.vbsKeyboard.close();
    if (isTextField(el)) el.blur();
  }

  function moveField(dir) {
    var el = document.activeElement;
    if (!isTextField(el)) return;
    var list = fieldsAround(el);
    var at = list.indexOf(el);
    var to = list[at + dir];
    if (!to) { if (dir > 0) finishTyping(); return; }
    to.focus();
    revealSoon(to);
  }

  function syncKbBar() {
    var bar = byId('rev2KbBar');
    if (!bar) return;
    bar.hidden = !systemKb;
    if (!systemKb) return;
    var label = bar.querySelector('.kbLane');
    var text = laneLabel();
    if (label.textContent !== text) label.textContent = text;
    var el = document.activeElement;
    var list = isTextField(el) ? fieldsAround(el) : [];
    var at = list.indexOf(el);
    bar.querySelector('.kbPrev').disabled = at <= 0;
    bar.querySelector('.kbNext').disabled = at < 0 || at >= list.length - 1;
  }

  function applyKeyboard() {
    var b = document.body.classList;
    var vbs = b.contains('vbskb-open');
    var wasOpen = b.contains('kbOpen');
    b.toggle('kbSystem', systemKb);
    b.toggle('kbOpen', systemKb || vbs);
    syncKbBar();
    if (!wasOpen && (systemKb || vbs)) revealSoon(document.activeElement);
  }

  // Utan skalet (sidan öppnad direkt): samma låsning av storleken som skalet gör.
  function standaloneMeasure() {
    if (!standalone) return;
    var w = window.innerWidth, h = window.innerHeight;
    if (window.visualViewport && window.visualViewport.height > 0) h = Math.min(h, window.visualViewport.height);
    if (Math.abs(w - ownStable.w) > 1) { ownStable.w = w; ownStable.h = h; }
    else if (h > ownStable.h || ownStable.h - h <= Math.max(150, ownStable.h * 0.2)) ownStable.h = h;
    var px = (Math.round(Math.min(ownStable.w * 0.0125, ownStable.h * 0.02) * 100) / 100) + 'px';
    if (document.documentElement.style.fontSize !== px) document.documentElement.style.fontSize = px;
    systemKb = ownStable.h - h > Math.max(150, ownStable.h * 0.2) && isTextField(document.activeElement);
  }

  // Var tangentbordet (eller listen ovanför det) börjar, i ramens koordinater.
  function keyboardTop() {
    var kb = document.querySelector('.vbskb');
    if (kb && !kb.hidden && document.body.classList.contains('vbskb-open'))
      return kb.getBoundingClientRect().top;
    var bar = byId('rev2KbBar');
    if (bar && !bar.hidden) return bar.getBoundingClientRect().top;
    return window.innerHeight;
  }

  function revealField(el) {
    if (!el || document.activeElement !== el) return;
    var box = el.closest('.playersCol') || el.closest('.gsxMain') || el.closest('.overlay');
    if (!box) return;
    var r = el.getBoundingClientRect();
    var b = box.getBoundingClientRect();
    var margin = 16;
    var visibleTop = Math.max(b.top, 0) + margin;
    var visibleBottom = Math.min(b.bottom, keyboardTop()) - margin;
    if (r.bottom > visibleBottom) box.scrollTop += r.bottom - visibleBottom;
    else if (r.top < visibleTop) box.scrollTop -= visibleTop - r.top;
  }

  // Efter att layouten hunnit ändras (skrivläge på, tangentbordet uppe)
  function revealSoon(el) {
    if (!isTextField(el)) return;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { revealField(el); });
    });
    window.setTimeout(function () { revealField(el); }, 350);
  }

  function setupKeyboard() {
    if (window.vbsKeyboard && window.vbsKeyboard.config) {
      window.vbsKeyboard.config.lift = false;
      // Knapparna (Klar, Fler ...) på det språk sidan visar. Tangentbordet läser annars lang,
      // som TouchConsole.js håller på banans språk också när gästerna har valt ett annat.
      window.vbsKeyboard.config.language = shownLanguage;
    }

    document.addEventListener('focusin', function (e) {
      if (!isTextField(e.target)) return;
      markEnterKeys(e.target);
      syncKbBar();
      revealSoon(e.target);
    });
    document.addEventListener('focusout', function () { window.setTimeout(syncKbBar, 0); });

    // Enter / tangentbordets Nästa: nästa fält, eller stäng på det sista
    document.addEventListener('keydown', function (e) {
      if (!isTextField(e.target) || e.target.tagName === 'TEXTAREA') return;
      if (e.key !== 'Enter' && e.keyCode !== 13) return;
      e.preventDefault();
      moveField(1);
    }, true);

    var bar = byId('rev2KbBar');
    if (bar) {
      // Knapparna får inte ta fokus från fältet - då fäller Android ner tangentbordet.
      bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
      bar.querySelector('.kbPrev').addEventListener('click', function () { moveField(-1); });
      bar.querySelector('.kbNext').addEventListener('click', function () { moveField(1); });
      bar.querySelector('.kbDone').addEventListener('click', finishTyping);
    }

    window.addEventListener('resize', function () {
      standaloneMeasure();
      applyKeyboard();
      revealSoon(document.activeElement);
    });
  }

  // ------------------------------------------------------------------ tick

  function tick() {
    syncLangReset();
    syncLanguage();
    syncLangButtons();
    applyMode();
    syncModes();
    syncStart();
    syncGsx();
    syncPins();
    syncMove();
    syncPlayerFit();
    syncPlayerHead();
    syncCorrect();
    syncDock();
    standaloneMeasure();
    applyKeyboard();
  }

  $(function () {
    setupLane();
    buildGsx();
    setupPins();
    setupService();
    setupLang();
    setupScriptTexts();
    setupCorrect();
    setupPlayerDrag();

    var btn = byId('rev2Start');
    if (btn) btn.addEventListener('click', function () {
      var real = byId('startBowling');
      if (real && !real.disabled) real.click();
    });

    setupKeyboard();

    // Dialoger som skripten öppnar med jQuery show() får display:block inline och stängs då
    // inte av krysset eller en länk till "#". Släpp det när adressen inte längre pekar på dem.
    // Namnifyllningen undantas: där är display:block från showBowlingMenuForm() avsiktligt.
    window.addEventListener('hashchange', function () {
      var overlays = document.querySelectorAll('.overlay');
      for (var i = 0; i < overlays.length; i++) {
        var el = overlays[i];
        if (el.id === 'fillBowlingData') continue;
        if (el.style.display === 'block' && window.location.hash !== '#' + el.id)
          el.style.display = '';
      }
      syncPlayerFit();          // dialogen som öppnades: rätt täthet direkt, inte först vid nästa tick
    });

    tick();
    window.setInterval(tick, 300);
  });

  // ------------------------------------------------------------------ för skalet

  window.rev2Lane = {
    // 'full' eller 'column'
    setMode: function (m) {
      m = m === 'column' ? 'column' : 'full';
      if (m === mode) return;
      mode = m;
      applyMode();
      syncDock();
    },
    lane: function () { return laneNo; },
    // Språket konsolen visar för banan (gästernas val, annars banans eget), som serverns namn
    // ("Suomeksi" ...), för skalets rubrik när bara den här banan syns.
    language: function () { return langOverride() || serverLang(); },
    // Banans eget språk utan gästernas val (laneLang, från en äldre slav lang), annars det
    // tabletten hade senast för banan, eller null - för skalets rubrik när inget val gäller
    laneLanguage: function () { return serverLang() || rememberedLang(); },
    // Gästernas senaste val på banan, { lang, at }, eller null om de inte har valt något
    // (för skalets gemensamma rubrik och Service när båda banorna i ett banpar syns)
    languageChoice: function () {
      var at = langChosenAt();
      return at && !langStale() ? { lang: langOverride() || serverLang(), at: at } : null;
    },
    // Androids tangentbord uppe och fokus i den här banan (skalet avgör, se touchconsoleMain.js)
    setKeyboard: function (on) {
      on = !!on;
      if (on === systemKb) return;
      systemKb = on;
      if (document.body) applyKeyboard();
    },
    // 'training' när GSX-träningen är öppen, annars 'names' (för skalets rubrik)
    view: function () { return window.location.hash === '#fillTrainingData' ? 'training' : 'names'; },
    // Tillkalla personal till den här banan: samma anrop som Service-knappen i originalet.
    callService: function () {
      if (typeof submitcallPersonalsubmit !== 'function') return false;
      submitcallPersonalsubmit();
      return true;
    },
    // Om hallen har slagit av Service (ConfigGameControl i TouchConsole.js)
    serviceEnabled: function () {
      var b = byId('callPersonalButton');
      return !b || b.style.visibility !== 'hidden';
    }
  };
})();

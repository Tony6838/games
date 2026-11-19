// ---------------------------------------------------------------------------
// vbsnameentry.js - the six name boxes the lane TV shows while player names are
// being typed at the lane.
//
// A lane that is switched on with nobody playing on it puts its console's start
// form on the lane TV, and until now that was a *picture* of it: CGdiMON stamps
// whatever is on the lane display into shared memory and the TV fetches it as
// VTVFile<n>.jpg, once per keystroke. That is still exactly what happens - none
// of it is changed, and it is what keeps every other console screen (the menus,
// the score editor) reaching the TV. This draws real HTML boxes over the top of
// it while, and only while, somebody is entering names.
//
// The names arrive in the ordinary lane status payload as "pendingNames", six
// strings, and LoadCom puts that field there only while a console says it is
// collecting them and the lane has no game on it (see PendingNamesAreLive in
// Slave/LOADCOM/LoadComWebInterface.cpp). So the field's presence is the whole
// signal: no lane status is tested here, and on every other lane and at every
// other time the payload is byte for byte what it always was and this file does
// nothing at all.
//
// Beside the names ride the console's own cursor and what it is showing there:
// "pendingFocus" and "pendingCaret" - the box the cursor is in and the column
// it stands at - draw a blinking caret; "pendingSel" says the focused name is
// shown selected (the console's replace-on-next-key state) and highlights the
// text instead; and "pendingStart" is the console's start button - "focus"
// while the console highlights it, "pressed" while a start is going through -
// which the mirrored button under the boxes copies. All of them are optional:
// an older slave or console sends none, and the boxes then appear exactly as
// they did before any of this existed.
//
// Under the boxes sit the start instruction and the mirrored start button -
// the same "Enter 2 gånger för start" the V3 console's form shows on the lane
// TV picture, in the hall's own language from the payload's "lang" field.
//
// Beside the boxes stands the form's bumper column, when the form has one:
// "pendingBumpers" is one character per box, '1' ticked, and
// "pendingBumpersKey" says the guest toggles them with the + key, which the
// V3 keyboard form says above its column ("Tryck + för rännstaket") and so
// does this one. The field is absent when the console's form has no column -
// a lane with BallWall set - and from an older slave or console, and the panel
// is then exactly what it was. This panel is opaque over the console's own
// picture, so in a Loki hall, where that TV is the only place the guest sees
// the form, leaving the column out took it away altogether (seen at a
// hall).
//
// The panel has as many boxes as the console's form shows: "pendingRows" when
// a web console whose hall chose fewer than six name rows says so ("Antal
// spelarfält"); absent - the V3 console, an older console or slave - all six.
//
// Both consoles feed the same slot, so both are shown here: the V3 game console
// sends LC_SET_PENDING_NAMES over the pipe as StartGameNew::Draw runs, and the
// web console posts /console/setPendingNames as its own fields are typed in.
//
// ---------------------------------------------------------------------------
// This file has a twin: ..\..\TV\js\vbsnameentry.js, which does the same thing
// for the XML lane TV. They are a deliberate copy of each other and not a
// shared include, for the reason the two TakTV.js files are - the XML screens
// are what customers run today and the two renderers' clients must not be able
// to move each other. Change one and change the other; the only difference
// between them is how the payload arrives, which is the last few lines.
// ---------------------------------------------------------------------------

/* exported vbsUpdateNameEntry */

// Must match GCI_PENDINGNAMES_SLOTS in shared/lanedata/GCI.h, which is in turn
// StartGameNew::MAX_PLAYERS and the web console's row count. The server always
// sends all six, empty ones included, so the third name stays in the third box
// when the second is cleared.
var VBS_NAME_SLOTS = 6;

// Everything this panel says, per hall language - the payload's "lang" is the
// slave's configured language, the same value the web console's ChangeLanguage
// switches on. The placeholder is the word that console puts in its own empty
// name fields; the hint is IDS_S_KBD_MENU and the button label IDS_S_START from
// the six GameConsole\Languages\*.lang files, word for word, so this panel says
// what the V3 console's picture beside it says. Keep the hints that short: the
// V3 form centres IDS_S_KBD_MENU in a slot only ~180 px wide, and a longer German
// one ("Zweimal Enter zum Starten") was already cut at its edge.
var VBS_NAME_TEXTS = {
  svenska:  { heading: 'Spelarnamn:',      placeholder: 'Spelarnamn',  hint: 'Enter 2 gånger för start', start: 'Starta' },
  dansk:    { heading: 'Spillernavne:',    placeholder: 'Spillernavn', hint: 'Enter 2 gange for start',  start: 'Start' },
  norsk:    { heading: 'Spillernavn:',     placeholder: 'Spillernavn', hint: 'Enter 2 ganger for start', start: 'Start' },
  suomeksi: { heading: 'Pelaajien nimet:', placeholder: 'Pelaajanimi', hint: 'Aloitus: Enter 2 kertaa',  start: 'Käynnistä' },
  deutsch:  { heading: 'Spielernamen:',    placeholder: 'Spielername', hint: '2x Enter zum Starten',     start: 'Start' },
  english:  { heading: "Player's names:",  placeholder: 'Player name', hint: 'Enter twice to start',     start: 'Start' }
};

// The bumper column's heading, word for word from the same .lang files:
// IDS_S_TOUCH_TITLE when the boxes are touched (the touch-screen form, the web
// console), and IDS_S_KBD_BUMPERS1 over IDS_S_KBD_BUMPERS2 when they are
// toggled with the + key - the two lines the V3 keyboard form puts above its
// column, which is how a guest at a Loki lane learns the key at all.
var VBS_BUMPER_TEXTS = {
  svenska:  { title: 'Rännstaket',  key: ['Tryck + för', 'rännstaket'] },
  dansk:    { title: 'Børnebande',  key: ['Tryk +', 'børnebande'] },
  norsk:    { title: 'Bumpers',     key: ['Trykk + for', 'bumpers'] },
  suomeksi: { title: 'Ratakaiteet', key: ['Antamalla + nousee', 'ratakaiteet'] },
  deutsch:  { title: 'Bumpers',     key: ['Press + for', 'bumpers'] },
  english:  { title: 'Bumpers',     key: ['Press + for', 'bumpers'] }
};

var vbsNameEntryRoot = null;
var vbsNameEntryInputs = [];
var vbsNameHeading = null;
var vbsNameHint = null;
var vbsNameStartBtn = null;

// The bumper column: a heading over it and one box beside each name.
var vbsBumpHead = null;
var vbsBumpBoxes = [];

// What the heading was last written from (language and key), so the push that
// arrives four times a second while somebody types rewrites it only on a change.
var vbsBumpHeadDrawn = '';

// Which language's texts are on the panel, so the payload's lang - sent on
// every push - rewrites them only when it actually changed.
var vbsNameLangApplied = '';

// The console's cursor, drawn as an element of our own rather than by focusing
// a box: a readonly input shows no caret, a television has no focus to give,
// and a native caret could not be made wide enough to read from across a lane.
var vbsNameCaret = null;

// The console's selection, same scheme: a highlight laid over the focused
// name's text while the console shows it selected, the state where the next
// key replaces the whole name.
var vbsNameSel = null;

// What the cursor was last drawn from, so a push that moved nothing - they
// come four a second while somebody is typing - does not restart the blink and
// hold the caret permanently solid.
var vbsNameCaretDrawn = '';

// Built on first use rather than being markup in the page, so a hall that has
// not updated its TakTV.html still gets nothing rather than an empty white
// panel, and so the two TV pages stay identical to what they were bar one
// <script> line each.
function vbsNameEntryBuild() {
  if (vbsNameEntryRoot !== null) return vbsNameEntryRoot;

  var wrapper = document.querySelector('.main-wrapper');
  if (!wrapper) return null;

  vbsNameEntryRoot = document.createElement('div');
  vbsNameEntryRoot.id = 'vbsNameEntry';
  vbsNameEntryRoot.hidden = true;

  var popup = document.createElement('div');
  popup.className = 'popup';

  var area = document.createElement('div');
  area.id = 'nameArea';

  // The heading is the grid's first cell and the bumper column's heading the
  // second, so the column heading stands beside it over its boxes, as on the V3
  // form, and the column is as wide as the wider of the two. Without the column
  // the heading's margin plus the grid's gap is what its margin alone was, so
  // that panel is laid out exactly as before.
  vbsNameHeading = document.createElement('h2');
  area.appendChild(vbsNameHeading);

  vbsBumpHead = document.createElement('div');
  vbsBumpHead.className = 'bumpHead';
  area.appendChild(vbsBumpHead);

  for (var i = 0; i < VBS_NAME_SLOTS; i++) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'playerName';

    // Nobody types on a television. readonly rather than disabled because a
    // disabled input is greyed out by the browser, and these have to look like
    // the boxes on the console they are mirroring.
    input.readOnly = true;
    input.tabIndex = -1;

    area.appendChild(input);
    vbsNameEntryInputs.push(input);

    // A span, not a checkbox: nothing on a television is clickable, and a
    // native checkbox cannot be made big enough to read across a lane on every
    // browser a TV runs. Hidden with the column.
    var bump = document.createElement('span');
    bump.className = 'bumpBox';
    area.appendChild(bump);
    vbsBumpBoxes.push(bump);
  }

  popup.appendChild(area);

  // Under the boxes: the start instruction, and beside it the mirrored start
  // button - a span, because nothing on a television is clickable; it only
  // shows the press the guest makes at the console.
  var startRow = document.createElement('div');
  startRow.className = 'startRow';

  vbsNameHint = document.createElement('span');
  vbsNameHint.className = 'startHint';
  startRow.appendChild(vbsNameHint);

  vbsNameStartBtn = document.createElement('span');
  vbsNameStartBtn.className = 'startBtn';
  startRow.appendChild(vbsNameStartBtn);

  popup.appendChild(startRow);
  vbsNameEntryRoot.appendChild(popup);

  // Children of the panel, not of a box - an input cannot hold child elements -
  // positioned over the right box by vbsDrawNameCursor. The panel is the
  // containing block (it is position: absolute), so the coordinates are simply
  // "rect minus the panel's rect". Hidden until a payload places them.
  vbsNameCaret = document.createElement('div');
  vbsNameCaret.className = 'nameCaret';
  vbsNameEntryRoot.appendChild(vbsNameCaret);

  vbsNameSel = document.createElement('div');
  vbsNameSel.className = 'nameSel';
  vbsNameEntryRoot.appendChild(vbsNameSel);

  // A sibling of #main_content, not a child of it. #main_content is positioned
  // with a z-index so it is a stacking context, which means everything inside
  // it - the scoresheet picture, a playing animation - is below anything the
  // wrapper puts above it, whatever their own z-indexes say. #bottom_content is
  // a sibling too and is higher still, so the banner strip and the clock stay
  // visible exactly as they are in every other state.
  wrapper.appendChild(vbsNameEntryRoot);

  return vbsNameEntryRoot;
}

// Puts the right language's words on the panel. Cheap on every push because it
// rewrites only when the payload's lang differs from what is already shown. The lane's
// own language (laneLang) first; "lang" is the slave's, and all an older slave sends.
function vbsNameEntryApplyLang(payload) {
  var lang = String(payload.laneLang || payload.lang || 'english').toLowerCase();
  if (lang === vbsNameLangApplied) return;
  vbsNameLangApplied = lang;

  var t = VBS_NAME_TEXTS[lang] || VBS_NAME_TEXTS.english;
  vbsNameHeading.textContent = t.heading;
  vbsNameHint.textContent = t.hint;
  vbsNameStartBtn.textContent = t.start;
  for (var i = 0; i < vbsNameEntryInputs.length; i++) {
    vbsNameEntryInputs[i].placeholder = t.placeholder;
  }

  // The bumper heading is in the language too: write it again with the new one.
  vbsBumpHeadDrawn = '';
}

// The form's bumper column from one payload: shown with its heading and a box
// per name while the payload carries "pendingBumpers", gone otherwise - which
// is every lane whose form has no column and every older slave or console, so
// those see exactly the panel they always did.
function vbsNameEntryApplyBumpers(payload) {
  var ticked = payload.pendingBumpers;
  var shown = typeof ticked === 'string' && ticked.length > 0;

  // The column widens and re-centres the panel, so the boxes move: the caret
  // has to be placed again even when the cursor itself did not move (the web
  // console's form closed and the V3 console's opened in the same box).
  if (vbsNameEntryRoot.classList.contains('vbsWithBumpers') !== shown) vbsNameCaretDrawn = '';
  vbsNameEntryRoot.classList.toggle('vbsWithBumpers', shown);
  if (!shown) return;

  for (var i = 0; i < vbsBumpBoxes.length; i++) {
    vbsBumpBoxes[i].classList.toggle('bumpOn', ticked.charAt(i) === '1');
  }

  var byKey = payload.pendingBumpersKey === '1';
  var drawn = vbsNameLangApplied + ':' + (byKey ? 'key' : 'title');
  if (drawn === vbsBumpHeadDrawn) return;
  vbsBumpHeadDrawn = drawn;

  // A heading of one line or two sets the first row's height, so it moves the
  // boxes too.
  vbsNameCaretDrawn = '';

  var t = VBS_BUMPER_TEXTS[vbsNameLangApplied] || VBS_BUMPER_TEXTS.english;
  var lines = byKey ? t.key : [t.title];

  // textContent per line rather than markup: these are fixed words, but a line
  // break has to be an element, and nothing here builds HTML from text.
  while (vbsBumpHead.firstChild) vbsBumpHead.removeChild(vbsBumpHead.firstChild);
  for (var n = 0; n < lines.length; n++) {
    var line = document.createElement('div');
    line.textContent = lines[n];
    vbsBumpHead.appendChild(line);
  }
}

// As many boxes as the console's form shows: "pendingRows" is sent when a web
// console whose hall chose fewer than six name rows ("Antal spelarfält" in the
// reception's Terminalinställningar) is typing. Absent - the V3 console, whose
// form always has six, an older console or slave - is all six, the panel as it
// always was. A hidden box and its bumper box take no cell in the grid.
var vbsNameRowsShown = VBS_NAME_SLOTS;

function vbsNameEntryApplyRows(payload) {
  var rows = parseInt(payload.pendingRows, 10);
  if (isNaN(rows) || rows < 1 || rows > VBS_NAME_SLOTS) rows = VBS_NAME_SLOTS;
  if (rows === vbsNameRowsShown) return;
  vbsNameRowsShown = rows;

  // The boxes left move, so the caret is placed again.
  vbsNameCaretDrawn = '';
  for (var i = 0; i < vbsNameEntryInputs.length; i++) {
    var shown = i < rows;
    vbsNameEntryInputs[i].style.display = shown ? '' : 'none';
    vbsBumpBoxes[i].style.display = shown ? '' : 'none';
  }
}

// Shows, updates or hides the boxes from one payload. Safe to call with
// anything, including a payload from an older slave that has no such field.
function vbsUpdateNameEntry(payload) {
  var names = (payload && payload.pendingNames) || null;

  if (!names || typeof names.length !== 'number') {
    // Not being collected on this lane. Hide if we ever showed anything, and do
    // not build the panel just to hide it.
    if (vbsNameEntryRoot !== null) vbsNameEntryRoot.hidden = true;
    return;
  }

  var root = vbsNameEntryBuild();
  if (!root) return;

  vbsNameEntryApplyLang(payload);

  for (var i = 0; i < vbsNameEntryInputs.length; i++) {
    var name = (i < names.length && names[i] !== null && names[i] !== undefined)
      ? String(names[i]) : '';

    // Only when it actually changed. This runs on every push - four a second
    // while somebody is typing - and writing an input's value re-lays it out
    // even when the text is identical.
    if (vbsNameEntryInputs[i].value !== name) vbsNameEntryInputs[i].value = name;
  }

  // Before the cursor is placed: the column narrows the name boxes, and a box
  // fewer moves the ones under it.
  vbsNameEntryApplyBumpers(payload);
  vbsNameEntryApplyRows(payload);

  root.hidden = false;

  // After the unhide: a hidden panel has no geometry to measure against.
  vbsDrawNameCursor(payload);
}

// The console's cursor, mirrored: "pendingFocus" says which box it is in and
// "pendingCaret" which column it stands at (quoted numbers, like every value in
// this payload); "pendingSel" that the focused name is shown selected, which
// draws the highlight instead of the caret; "pendingStart" that the console's
// start button is highlighted ("focus") or being pressed ("pressed"), which the
// mirrored one copies. Absent - an older slave, an older console, or nothing
// focused at the lane - everything disappears and the boxes are exactly what
// they were before any of it existed.
function vbsDrawNameCursor(payload) {
  if (!vbsNameCaret || !vbsNameSel) return;

  // The button first: it is independent of the box cursor - when the focus
  // stands on the console's own button there is no box cursor at all.
  vbsNameStartBtn.className =
    payload.pendingStart === 'pressed' ? 'startBtn vbsBtnPressed'
      : payload.pendingStart === 'focus' ? 'startBtn vbsBtnFocus'
      : 'startBtn';

  var slot = payload.pendingFocus === undefined ? -1 : parseInt(payload.pendingFocus, 10);
  if (isNaN(slot) || slot < 0 || slot >= vbsNameEntryInputs.length || slot >= vbsNameRowsShown) {
    vbsNameCaret.className = 'nameCaret';
    vbsNameSel.className = 'nameSel';
    vbsNameCaretDrawn = '';
    return;
  }

  var input = vbsNameEntryInputs[slot];

  // The slave already bounds the column to the name it stands in; this repeats
  // it against what this page actually shows, so the two cannot drift apart.
  var caret = parseInt(payload.pendingCaret, 10);
  if (isNaN(caret) || caret < 0 || caret > input.value.length) caret = input.value.length;

  // Selected only means something over text; the slave strips it from an empty
  // name too, so this is the same rule said twice.
  var selected = payload.pendingSel !== undefined && input.value.length > 0;

  // Nothing moved since the last push, so leave the blink alone - restarting
  // the animation on every identical push would hold the caret solid forever.
  // The second test redraws after a hide even when nothing moved.
  var drawn = slot + ':' + caret + ':' + (selected ? 's' : 'c') + ':' + input.value;
  if (drawn === vbsNameCaretDrawn &&
      (selected ? vbsNameSel.className !== 'nameSel' : vbsNameCaret.className !== 'nameCaret')) return;
  vbsNameCaretDrawn = drawn;

  // Where the cursor lands inside the box: the width of the text, in the box's
  // own resolved font (the vh sizes come back as px here). Composed from the
  // parts rather than read as style.font, which not every browser reports as a
  // usable shorthand.
  var style = window.getComputedStyle(input);
  var canvas = vbsDrawNameCursor.canvas || (vbsDrawNameCursor.canvas = document.createElement('canvas'));
  var ctx = canvas.getContext('2d');
  ctx.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;

  var rootRect = vbsNameEntryRoot.getBoundingClientRect();
  var rect = input.getBoundingClientRect();

  var left0 = rect.left - rootRect.left + input.clientLeft + parseFloat(style.paddingLeft);

  // A name wider than its box: pin to the box's right edge rather than drawing
  // outside it. (The box clips its own text the same way.)
  var xMax = rect.right - rootRect.left - input.clientLeft - 2;

  // A hair taller than the glyphs and centered in the box, like a real caret.
  var fontPx = parseFloat(style.fontSize);
  var caretHeight = fontPx * 1.15;
  var top = rect.top - rootRect.top + (rect.height - caretHeight) / 2;

  if (selected) {
    // The whole name highlighted, the way the console shows it: the selection
    // spans the text, not the box. No caret and no blink while it stands -
    // that is what the console shows too.
    var selWidth = ctx.measureText(input.value).width;
    if (left0 + selWidth > xMax) selWidth = xMax - left0;

    vbsNameSel.style.left = left0 + 'px';
    vbsNameSel.style.top = top + 'px';
    vbsNameSel.style.height = caretHeight + 'px';
    vbsNameSel.style.width = selWidth + 'px';
    vbsNameSel.className = 'nameSel vbsSelOn';
    vbsNameCaret.className = 'nameCaret';
    return;
  }

  vbsNameSel.className = 'nameSel';

  var x = left0 + ctx.measureText(input.value.substring(0, caret)).width;
  if (x > xMax) x = xMax;

  vbsNameCaret.style.left = x + 'px';
  vbsNameCaret.style.top = top + 'px';
  vbsNameCaret.style.height = caretHeight + 'px';

  // Re-adding the class restarts the animation, so the caret lands solid and
  // blinks from there - the way a real caret behaves when it moves. The void
  // read forces the reflow the restart depends on.
  vbsNameCaret.className = 'nameCaret';
  void vbsNameCaret.offsetWidth;
  vbsNameCaret.className = 'nameCaret vbsCaretOn';
}

// Where the twin differs. This page does not load commonAPI.js and has no
// onLaneStatus to subscribe to, so TakTV.js calls vbsUpdateNameEntry from
// acceptPayload instead - i.e. on every push rather than on the page's 1 Hz
// tick, which is the point either way: a name has to appear on the wall as it
// is typed, not up to a second later. Nothing else on this screen is driven
// that way and nothing else changes because of it.

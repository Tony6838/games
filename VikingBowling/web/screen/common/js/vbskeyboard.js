/*  vbskeyboard.js - an on-screen keyboard that lives inside the page.

    Why this exists: Windows has exactly one touch keyboard (TabTip.exe) for the
    whole desktop. A PC driving two lane screens therefore shows one soft
    keyboard, on one of the two screens, and the other lane cannot enter a player
    name at all. There is no Windows setting that produces a second one - so the
    keyboard has to be part of the page, and then each browser window has its own.

    Two halves, and both are needed:

      1. Draw a keyboard and type into the focused field (below).
      2. Stop Windows from offering its own. That is what inputmode="none" does:
         it tells the browser this field is edited by something other than the
         system keyboard, so the browser never asks Windows to raise TabTip -
         nor Android to raise its own keyboard (see below).
         Without step 2 the user gets both keyboards on top of each other.

    The same file serves the check-in kiosk (screen/kiosk/Kiosk.html), which has
    the same problem on a Windows kiosk PC and the same reasons as a lane tablet
    on an Android one.

    The keyboard attaches itself to every text field on the page, including the
    ones built later by script (AddPlayer in TouchConsole.js), and it types by
    dispatching the same 'input' and 'keyup' events a real keyboard would - so
    adjustCaps(), checkNameValid(), checkTrainingValid() and checkMember() all run
    exactly as before. Nothing in the pages had to learn about this file.

    The platform decides whether it appears at all:

      Windows: always, for the reason above.

      Android (the lane tablets and the kiosk tablet, a WebView or a browser,
        Chrome's desktop-site mode included - see isAndroid()): when the
        browser can hold Android's keyboard down (inputmode, Chromium 66) and
        draw ours (vbskeyboard.css, Chromium 84 - 2020).
        Ours then replaces Android's, so a tablet types like a Windows console:
        the lane language's own letters, only the characters a name may hold
        (Android's offers emoji and symbols that adjustCaps() silently removes
        again), Next and Done keys, no word suggestions, and a page that keeps
        its size - Android's keyboard makes the WebView lower, and the console
        and the kiosk rescale and switch layout around it. On an older WebView
        ours stays away rather than come up broken or under Android's, and the
        page goes on handling Android's as before (touchconsoleLane.js,
        kioskRev2.js).

      Anything else (iOS, a Mac, a Linux PC without a touch screen): the
        platform's own keyboard.

      ?keyboard=0 / ?keyboard=1 overrides it, in either direction, for that
        window only - ?keyboard=0 is how one tablet goes back to Android's.

    There used to be a second condition - stand down while a physical keyboard
    was being typed on - and it was removed 2026-09-18 on purpose. Every customer
    screen that shows this keyboard has no physical keyboard at all, so the rule
    protected nobody, while one stray trusted keystroke (a member-card scanner, a
    laptop plugged in to look at a log) silently took a console's keyboard away
    for a minute, and it made the keyboard untestable on any PC that has a
    keyboard. Do not bring it back; ?keyboard=0 is how a window is kept quiet.

    Two windows on one desktop is also what makes the field on the *other*
    screen misbehave: every tap on one screen deactivates the other window, and
    the browser then blurs and re-focuses the field being typed into there as if
    that person had left it and come back. The keyboard stops those two events
    before the page sees them, and draws the caret the browser stops drawing in
    an inactive window - see "Two windows on one desktop" below.

    Switches, in falling order of precedence:
      ?keyboard=0 / =1       off / on for this window, whatever the platform
      window.VBSKB_DEFAULT   set to false before this script loads
      vbsKeyboard.config     at runtime; see CFG below

    If a customer's Windows still raises TabTip on top of ours (or an Android
    tablet its own keyboard), call
    vbsKeyboard.setSuppress('readonly') - that is the hard version, and no browser
    raises a keyboard for a read-only field. We still write into it ourselves, so
    the field behaves the same. Use the call rather than assigning to
    config.suppress, which would only reach fields prepared after the change.
*/
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  var CFG = {
    /// 'inputmode' sets inputmode="none" (the browser stops asking Windows for a
    /// keyboard), 'readonly' additionally marks the field read-only (nothing can
    /// raise a keyboard for it at all), 'off' leaves the field alone and you get
    /// both keyboards.
    suppress: 'inputmode',

    /// What counts as a field we type into. Deliberately narrow: number, date and
    /// colour inputs have their own browser UI and checkboxes have none.
    selector: 'input[type=text], input[type=search], input[type=tel], ' +
              'input[type=password], input:not([type]), textarea',

    /// Move the dialog up when the keyboard would cover the field being edited.
    lift: true,

    /// The ancestor that gets moved - the nearest match walking up from the
    /// field. Not 'form': the forms here sit inside .popup, so lifting one would
    /// slide the fields out of the white box they are drawn in.
    liftWithin: '.popup, .overlay',

    /// Appear only on the platforms the head of this file names: Windows, and
    /// Android where the browser can hold its own keyboard down and draw ours.
    /// Set false to arm on any platform (windowsOnly: false, its old name, still
    /// does); ?keyboard=1 does the same for one window.
    platformsOnly: true,

    /// The language the page shows, as a function returning its name (either
    /// spelling LANGUAGES and ALIASES know). Asked every time the keyboard opens.
    /// A page whose shown language is not simply one global sets it to the very
    /// value it draws its own texts in: the lane console's guests can choose
    /// their own language, so its 'lang' (the lane's) is then not what it shows
    /// (touchconsoleLane.js). Unset or empty, the page's 'lang' or 'language'.
    language: null
  };

  // Per language: the three national letters, in the order a physical keyboard of
  // that country carries them - the first sits after P, the other two after L -
  // and the words on the two keys that cannot be a symbol. The keys are the lane
  // language names as the slave sends them, which the consoles keep in 'lang';
  // the kiosk keeps 'language' instead, with the reception's English names
  // (swedish, finnish, ...), which ALIASES maps onto the same rows. The page's
  // language (config.language, else those globals) is read every time we open,
  // so a language change - a lane switched to another language, a guest pressing
  // a flag on the console or the kiosk - is picked up without anyone telling us.
  var LANGUAGES = {
    svenska:  { extra: ['å', 'ö', 'ä'], done: 'Klar',   more: 'Fler'  },
    suomeksi: { extra: ['å', 'ö', 'ä'], done: 'Valmis', more: 'Lisää' },
    dansk:    { extra: ['å', 'æ', 'ø'], done: 'Færdig', more: 'Flere' },
    norsk:    { extra: ['å', 'ø', 'æ'], done: 'Ferdig', more: 'Flere' },
    deutsch:  { extra: ['ü', 'ö', 'ä'], done: 'Fertig', more: 'Mehr', qwertz: true },
    english:  { extra: [],              done: 'Done',   more: 'More'  }
  };

  // The reception's names for the same languages (shared/localization/LocaleHelper.cpp),
  // which is what the kiosk's 'language' holds and what its flag buttons set.
  var ALIASES = {
    swedish: 'svenska', finnish: 'suomeksi', danish: 'dansk', norwegian: 'norsk', german: 'deutsch'
  };

  var DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  var ROW_Q  = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
  var ROW_A  = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'];
  var ROW_Z  = ['z', 'x', 'c', 'v', 'b', 'n', 'm'];

  // The second page. The punctuation row is exactly the set adjustCaps() lets
  // through (VBS_NAME_CHARS in commonAPI.js) - anything else would be typed and
  // then silently removed again, which looks like a broken key. It lost _ / + & ( )
  // on 2026-10-17 when the name rule was narrowed to what a name actually contains:
  // + is the bumper marker's own character, & and = are query-string delimiters, and
  // none of the six belongs in a person's name. The rest are the accented letters of
  // the markets we sell to, so a foreign name can be spelled properly whatever the
  // console's own language is. A field that is not a name can ask for more keys on the
  // punctuation row, see fieldChars().
  var MORE_PUNCT = ['.', ',', '-', '\''];
  var MORE_1 = ['á', 'à', 'â', 'ã', 'ä', 'å', 'æ', 'ç', 'é', 'è'];
  var MORE_2 = ['ê', 'ë', 'í', 'î', 'ï', 'ñ', 'ó', 'ô', 'õ', 'ö'];
  var MORE_3 = ['ø', 'ß', 'ú', 'ù', 'û', 'ü', 'ý', 'ð', 'þ'];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  var enabled = true;     ///< the master switch, see readSwitch()
  var panel = null;       ///< the keyboard element, built once on first use
  var rowsBox = null;     ///< the element the key rows are (re)drawn into
  var target = null;      ///< the field we are typing into, or null when closed
  var parked = false;     ///< our window was deactivated mid-edit; see "Two windows on one desktop"
  var caret = null;       ///< the caret we draw while parked, built on first use
  var caretAt = '';       ///< where it was last put, so a blink is only restarted by a move
  var mirror = null;      ///< the hidden copy of the field's text the caret is measured in
  var page = 'abc';       ///< 'abc' or 'more'
  var shift = 0;          ///< 0 off, 1 one shot, 2 locked
  var drawnAs = '';       ///< page + language the current keys were drawn for
  var lifted = null;      ///< { el, previous } for the dialog we moved, or null
  var pointersDown = 0;   ///< fingers on the glass anywhere, see unliftWhenSafe
  var unliftWanted = false;
  var unliftTimer = 0;
  var hideTimer = 0;
  var repeatTimer = 0;
  var guardTimer = 0;

  // ---------------------------------------------------------------------------
  // Which fields we take over
  // ---------------------------------------------------------------------------

  /// Laid out and on the screen. offsetParent is the usual shorthand for this and
  /// is wrong for a position:fixed element, which reports null while perfectly
  /// visible - and .overlay is fixed, one step above every field here. Nothing is
  /// fixed between the two today, but a hall's Custom.css is free to change that,
  /// and the failure would be the keyboard closing itself mid-word.
  function isVisible(el) {
    return !!el && el.getClientRects().length > 0;
  }

  /// True for a field this keyboard should serve. A field that was already
  /// read-only before we saw it is not one: the AMR player names are displayed
  /// that way on purpose and must stay untypable. Our own read-only marking is
  /// remembered in data-vbskb-ro so we can tell the two apart afterwards.
  function isTypable(el) {
    if (!el || el.nodeType !== 1 || !el.matches) return false;
    if (!el.matches(CFG.selector)) return false;
    if (el.disabled) return false;
    if (el.getAttribute('data-vbskb') === 'off') return false;
    if (el.readOnly && el.getAttribute('data-vbskb-ro') !== '1') return false;
    return true;
  }

  /// Stop the browser asking Windows (or Android) for its keyboard. Done to the
  /// field itself rather than at focus time, because by the time a focus event
  /// reaches script the browser has already decided whether to raise one.
  ///
  /// A physical keyboard, when one is attached anyway, still types into the
  /// field as normal - inputmode only stops the browser raising TabTip or
  /// Android's on-screen keyboard; a member-card scanner keeps working too.
  function suppressOn(el) {
    if (CFG.suppress === 'off') return;
    if (el.getAttribute('data-vbskb-prep') === '1') return;
    el.setAttribute('data-vbskb-prep', '1');
    el.setAttribute('data-vbskb-im', el.getAttribute('inputmode') || '');
    el.setAttribute('inputmode', 'none');
    if (CFG.suppress === 'readonly' && !el.readOnly) {
      el.readOnly = true;
      el.setAttribute('data-vbskb-ro', '1');
    }
  }

  function suppressOff(el) {
    if (el.getAttribute('data-vbskb-prep') !== '1') return;
    var was = el.getAttribute('data-vbskb-im');
    if (was) el.setAttribute('inputmode', was); else el.removeAttribute('inputmode');
    el.removeAttribute('data-vbskb-im');
    el.removeAttribute('data-vbskb-prep');
    if (el.getAttribute('data-vbskb-ro') === '1') {
      el.readOnly = false;
      el.removeAttribute('data-vbskb-ro');
    }
  }

  function sweep(root) {
    if (!enabled || !root || root.nodeType !== 1) return;
    if (isTypable(root)) suppressOn(root);
    var all = root.querySelectorAll(CFG.selector);
    for (var i = 0; i < all.length; i++)
      if (isTypable(all[i])) suppressOn(all[i]);
  }

  function unsweepAll() {
    var all = document.querySelectorAll('[data-vbskb-prep="1"]');
    for (var i = 0; i < all.length; i++) suppressOff(all[i]);
  }

  // ---------------------------------------------------------------------------
  // Typing into the field
  // ---------------------------------------------------------------------------

  function caretOf(el) {
    // selectionStart throws on input types that have no text selection, and is
    // null on some of them; either way the end of the value is the right answer.
    try {
      if (el.selectionStart !== null && el.selectionStart !== undefined)
        return [el.selectionStart, el.selectionEnd];
    } catch (e) { /* no selection API on this field */ }
    return [el.value.length, el.value.length];
  }

  function setCaret(el, at) {
    try { el.setSelectionRange(at, at); } catch (e) { /* see caretOf */ }
  }

  /// Write a new value and tell the page about it exactly as a real key would.
  /// The caret is put back after every listener has run, because adjustCaps()
  /// assigns to .value - which drops the caret to the end of the field - and it
  /// reads document.activeElement, so the field has to still be focused here.
  function commit(el, value, caret, inputType, data) {
    if (document.activeElement !== el) {
      el.focus();
      // adjustCaps() reads document.activeElement rather than the event target,
      // and so do other handlers of this shape. A field we could not actually
      // focus would therefore have them rewriting whatever does hold the focus -
      // and if nothing does, reading .value off <body> throws. Dropping the
      // keystroke is the only safe answer; the guard below takes the keyboard
      // down a moment later anyway.
      if (document.activeElement !== el) return;
    }

    el.value = value;
    setCaret(el, caret);

    var ev;
    try {
      ev = new InputEvent('input', { bubbles: true, inputType: inputType, data: data });
    } catch (e) {
      ev = new Event('input', { bubbles: true });
    }
    el.dispatchEvent(ev);
    setCaret(el, Math.min(caret, el.value.length));

    try {
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
    } catch (e) {
      el.dispatchEvent(new Event('keyup', { bubbles: true }));
    }
    setCaret(el, Math.min(caret, el.value.length));
    caretUpdate();
  }

  function insert(text) {
    var el = target;
    if (!el || !text) return;

    var sel = caretOf(el);
    var before = el.value.slice(0, sel[0]);
    var after = el.value.slice(sel[1]);

    var max = parseInt(el.getAttribute('maxlength'), 10);
    if (max > 0) {
      var room = max - (before.length + after.length);
      if (room <= 0) return;
      if (text.length > room) text = text.slice(0, room);
    }

    commit(el, before + text + after, before.length + text.length, 'insertText', text);
  }

  function backspace() {
    var el = target;
    if (!el) return;

    var sel = caretOf(el);
    var from = sel[0], to = sel[1];

    if (from === to) {
      if (from === 0) return;
      from--;
      // A character outside the BMP is two code units; take both or the field is
      // left holding half a character.
      var code = el.value.charCodeAt(from);
      if (from > 0 && code >= 0xDC00 && code <= 0xDFFF) from--;
    }

    commit(el, el.value.slice(0, from) + el.value.slice(to), from, 'deleteContentBackward', null);
  }

  function clearAll() {
    if (target) commit(target, '', 0, 'deleteContentBackward', null);
  }

  function moveCaret(step) {
    var el = target;
    if (!el) return;
    var sel = caretOf(el);
    // From a selection an arrow collapses to that end rather than stepping past
    // it - the same thing a real arrow key does.
    var at = (sel[0] !== sel[1]) ? (step < 0 ? sel[0] : sel[1]) : sel[0] + step;
    setCaret(el, Math.max(0, Math.min(at, el.value.length)));
    caretUpdate();
  }

  /// The next field of the same form, so six player names can be filled without
  /// reaching past the keyboard to the one below.
  function nextField() {
    var el = target;
    if (!el) return;

    var scope = el.form || document;
    var candidates = scope.querySelectorAll(CFG.selector);
    var all = [];
    for (var i = 0; i < candidates.length; i++)
      if (isTypable(candidates[i]) && isVisible(candidates[i]))
        all.push(candidates[i]);

    var at = all.indexOf(el);
    if (at === -1 || all.length < 2) { done(); return; }

    var to = all[(at + 1) % all.length];
    to.focus();
    // Moved on ourselves rather than waiting for the focusin the line above
    // normally raises: focus() does not raise one while the window itself is not
    // focused, and the focusout of the field we just left would then close the
    // keyboard with nowhere to type. open() is idempotent, so the event doing its
    // job as well costs nothing.
    open(to);
  }

  // ---------------------------------------------------------------------------
  // Building the keyboard
  // ---------------------------------------------------------------------------

  /// The page's language as a LANGUAGES key: what config.language says the page
  /// shows, else the console's 'lang', else the kiosk's 'language', either spelling.
  function languageName() {
    var shown = null;
    if (typeof CFG.language === 'function') {
      try { shown = CFG.language(); } catch (e) { shown = null; }
    }
    var name = String(shown || global.lang || global.language || 'english').toLowerCase();
    return ALIASES[name] || name;
  }

  function currentLanguage() {
    return LANGUAGES[languageName()] || LANGUAGES.english;
  }

  /// The characters the field being typed into asks for beyond a name's: the
  /// kiosk's login field takes an e-mail address and says data-vbskb-chars="@_".
  /// They join the punctuation on the second page, in the room that row has
  /// left, so a name field never offers a key whose character adjustCaps() would
  /// only remove again.
  function fieldChars() {
    var want = target ? String(target.getAttribute('data-vbskb-chars') || '') : '';
    var out = [];
    for (var i = 0; i < want.length && out.length < 10 - MORE_PUNCT.length; i++) {
      var ch = want.charAt(i);
      if (ch !== ' ' && MORE_PUNCT.indexOf(ch) === -1 && out.indexOf(ch) === -1) out.push(ch);
    }
    return out;
  }

  function pageSignature() {
    return page + ':' + languageName() + ':' + fieldChars().join('');
  }

  function key(spec) {
    // A spacer holds room in a row without being pressable. A row's keys share its whole
    // width (flex, see vbskeyboard.css), so without one the four-key punctuation row would
    // draw its keys two and a half times the size of every letter key below it. A div, not a
    // disabled button: nothing should be able to focus or press it.
    if (spec.spacer) {
      var s = document.createElement('div');
      s.className = 'vbskb-spacer';
      s.style.setProperty('--vbskb-w', String(spec.width || 1));
      return s;
    }

    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'vbskb-key' + (spec.cls ? ' ' + spec.cls : '');
    b.textContent = spec.label;
    if (spec.width) b.style.setProperty('--vbskb-w', String(spec.width));
    if (spec.action) b.setAttribute('data-action', spec.action);
    if (spec.char !== undefined) b.setAttribute('data-char', spec.char);
    if (spec.title) b.setAttribute('aria-label', spec.title);
    return b;
  }

  function charKeys(chars) {
    var out = [];
    for (var i = 0; i < chars.length; i++)
      out.push({ char: chars[i], label: chars[i] });
    return out;
  }

  function buildRows() {
    var L = currentLanguage();
    var rows;

    var shiftKey = { action: 'shift', label: '⇧', cls: 'vbskb-special', width: 1.6, title: 'Shift' };
    var backKey  = { action: 'back',  label: '⌫', cls: 'vbskb-special', width: 1.6, title: 'Backspace' };

    if (page === 'more') {
      var punct = MORE_PUNCT.concat(fieldChars());
      rows = [
        // Padded to the ten units the three letter rows below use, so a punctuation key is
        // exactly the width of a letter key rather than two and a half of one.
        charKeys(punct).concat(punct.length < 10 ? [{ spacer: true, width: 10 - punct.length }] : []),
        charKeys(MORE_1),
        charKeys(MORE_2),
        [shiftKey].concat(charKeys(MORE_3)).concat([backKey])
      ];
    } else {
      var row1 = ROW_Q.slice();
      var row2 = ROW_A.slice();
      var row3 = ROW_Z.slice();
      if (L.qwertz) { row1[5] = 'z'; row3[0] = 'y'; }
      if (L.extra[0]) row1.push(L.extra[0]);
      if (L.extra[1]) row2.push(L.extra[1]);
      if (L.extra[2]) row2.push(L.extra[2]);

      rows = [
        charKeys(DIGITS),
        charKeys(row1),
        charKeys(row2),
        [shiftKey].concat(charKeys(row3)).concat([backKey])
      ];
    }

    rows.push([
      { action: 'page',  label: page === 'more' ? 'ABC' : L.more, cls: 'vbskb-special', width: 1.6 },
      { action: 'left',  label: '◀', cls: 'vbskb-special', title: 'Left' },
      { char: ' ',       label: '',  cls: 'vbskb-space', width: 5, title: 'Space' },
      { action: 'right', label: '▶', cls: 'vbskb-special', title: 'Right' },
      { action: 'next',  label: '⇥', cls: 'vbskb-special', title: 'Next field' },
      { action: 'clear', label: '✕', cls: 'vbskb-special', title: 'Clear' },
      { action: 'done',  label: L.done, cls: 'vbskb-accent', width: 1.8 }
    ]);

    rowsBox.textContent = '';
    for (var r = 0; r < rows.length; r++) {
      var div = document.createElement('div');
      div.className = 'vbskb-row';
      for (var k = 0; k < rows[r].length; k++) div.appendChild(key(rows[r][k]));
      rowsBox.appendChild(div);
    }

    drawnAs = pageSignature();
    paintShift();
  }

  /// Redraw the letter faces rather than the whole keyboard, so shift does not
  /// rebuild the DOM under the finger that is still on a key.
  function paintShift() {
    if (!panel) return;

    var keys = rowsBox.querySelectorAll('.vbskb-key[data-char]');
    for (var i = 0; i < keys.length; i++) {
      var ch = keys[i].getAttribute('data-char');
      if (ch === ' ') continue;
      keys[i].textContent = shift ? ch.toUpperCase() : ch;
    }

    var sk = rowsBox.querySelector('.vbskb-key[data-action="shift"]');
    if (sk)
      sk.className = 'vbskb-key vbskb-special' +
                     (shift === 2 ? ' is-locked' : shift === 1 ? ' is-active' : '');
  }

  function build() {
    panel = document.createElement('div');
    panel.className = 'vbskb';
    panel.setAttribute('role', 'application');
    panel.hidden = true;

    rowsBox = document.createElement('div');
    rowsBox.className = 'vbskb-rows';
    panel.appendChild(rowsBox);

    // Everything is driven from pointerdown, and pointerdown is cancelled: that
    // is what keeps the field focused. Let the press through and the browser
    // blurs the field the instant a key is touched, which would fire onblur (and
    // with it checkMember) on every single keystroke, and leave us with nothing
    // to type into.
    //
    // On an Android tablet that alone is not enough when the keyboard is in a
    // frame (the console shells TouchConsole.html / TouchConsole2.html): a
    // finger's tap on a key still sends a mousedown after the cancelled
    // pointerdown, and that mousedown focuses the key's <button> - the name field
    // blurs, onFocusOut takes the keyboard down, and the guest is left with one
    // letter (2026-11-16; reported in Chrome and Opera, recorded in the Android
    // emulator's Chrome and a WebView; Windows and Chromium's own touch emulation
    // drop that mousedown, so no desktop test could show it). So the touch is
    // cancelled too - no tap, long-press or double-tap is made out of a press on
    // our keys - and mousedown for any browser that sends one anyway. pointerup
    // still arrives, so the pressed look and key repeat end when the finger
    // lifts; a finger sliding off a key no longer turns into a pan, so repeat
    // runs until the lift rather than stopping at the slide.
    panel.addEventListener('pointerdown', onKeyDown);
    panel.addEventListener('touchstart', cancelPress, { passive: false });
    panel.addEventListener('mousedown', cancelPress);
    panel.addEventListener('pointerup', onKeyUp);
    panel.addEventListener('pointercancel', onKeyUp);
    panel.addEventListener('pointerleave', onKeyUp);
    panel.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // A finger lifted outside the keyboard never reaches the panel's own handler,
    // and a key repeat that nothing stops runs until the field is empty.
    global.addEventListener('pointerup', onKeyUp);
    global.addEventListener('pointercancel', onKeyUp);

    document.body.appendChild(panel);
    buildRows();
  }

  function keyFromEvent(e) {
    var el = e.target;
    while (el && el !== panel && !(el.classList && el.classList.contains('vbskb-key')))
      el = el.parentNode;
    return (el && el !== panel) ? el : null;
  }

  function onKeyDown(e) {
    e.preventDefault();           // keep the focus where it is - see build()
    var k = keyFromEvent(e);
    if (!k || !target) return;

    k.classList.add('is-down');
    press(k);

    // Backspace repeats while held; clearing a wrong name a character at a time
    // otherwise means one tap per letter.
    if (k.getAttribute('data-action') === 'back') {
      stopRepeat();
      repeatTimer = global.setTimeout(function () {
        repeatTimer = global.setInterval(function () {
          if (target) backspace(); else stopRepeat();
        }, 60);
      }, 450);
    }
  }

  /// The touchstart and mousedown of a press on the keyboard: cancelled, so the
  /// browser makes no focus change (or tap) out of it - see build(). A touch
  /// the browser has already given to a scroll cannot be cancelled any more.
  function cancelPress(e) {
    if (e.cancelable) e.preventDefault();
  }

  function onKeyUp() {
    stopRepeat();
    if (!rowsBox) return;
    var down = rowsBox.querySelectorAll('.vbskb-key.is-down');
    for (var i = 0; i < down.length; i++) down[i].classList.remove('is-down');
  }

  function stopRepeat() {
    if (!repeatTimer) return;
    global.clearTimeout(repeatTimer);
    global.clearInterval(repeatTimer);
    repeatTimer = 0;
  }

  function press(k) {
    var ch = k.getAttribute('data-char');
    if (ch !== null) {
      insert(shift && ch !== ' ' ? ch.toUpperCase() : ch);
      if (shift === 1) { shift = 0; paintShift(); }
      return;
    }

    switch (k.getAttribute('data-action')) {
      case 'back':  backspace(); break;
      case 'clear': clearAll(); break;
      case 'left':  moveCaret(-1); break;
      case 'right': moveCaret(1); break;
      case 'next':  nextField(); break;
      case 'done':  done(); break;
      case 'shift': shift = (shift + 1) % 3; paintShift(); break;
      case 'page':  page = (page === 'more') ? 'abc' : 'more'; buildRows(); break;
    }
  }

  /// The key that ends the edit. It blurs the field on purpose: onblur is where
  /// checkMember() turns a typed member number into that member's name, so
  /// closing the keyboard any other way would skip the lookup.
  function done() {
    var el = target;
    close();
    if (el) el.blur();
  }

  // ---------------------------------------------------------------------------
  // Showing, hiding and getting out of the way
  // ---------------------------------------------------------------------------

  function open(el) {
    if (!enabled) return;
    if (!panel) build();

    target = el;
    parked = false;
    caretHide();
    if (hideTimer) { global.clearTimeout(hideTimer); hideTimer = 0; }
    if (pageSignature() !== drawnAs) buildRows();

    shift = 0;
    paintShift();
    panel.hidden = false;
    document.body.classList.add('vbskb-open');
    lift();

    if (!guardTimer) guardTimer = global.setInterval(guard, 500);
  }

  function close() {
    if (hideTimer) { global.clearTimeout(hideTimer); hideTimer = 0; }
    if (guardTimer) { global.clearInterval(guardTimer); guardTimer = 0; }
    stopRepeat();
    target = null;
    parked = false;
    caretHide();
    unliftWhenSafe();
    if (panel) panel.hidden = true;
    document.body.classList.remove('vbskb-open');
  }

  /// A dialog can be closed out from under us - removeAnchorFromUrl() clears the
  /// hash on a timer and the overlay disappears without the field ever blurring.
  /// Nothing would then take the keyboard down, so check.
  function guard() {
    if (!target || !target.isConnected || !isVisible(target)) { close(); return; }
    if (document.activeElement !== target) { close(); return; }
    caretUpdate();
  }

  /// Move the box and have the move take effect now, rather than as an animation.
  /// .popup carries "transition: all 0.2s" (vbs.css), and a transform that is
  /// still being animated is also still *reported* at its old value - so a lift
  /// left to animate would make the next field's measurement come out wrong by
  /// the whole of the previous lift. The move is a jump either way when the user
  /// taps from one field to another; a correct jump beats a smooth wrong one.
  function moveNow(box, transform) {
    var previousTransition = box.style.transition;
    box.style.transition = 'none';
    box.style.transform = transform;
    box.getBoundingClientRect();          // commit it before the transition returns
    box.style.transition = previousTransition;
    caretUpdate();                        // the field moved with it
  }

  function lift() {
    unlift();
    if (!CFG.lift || !target) return;

    var top = panel.getBoundingClientRect().top;
    var field = target.getBoundingClientRect();
    var overlap = field.bottom - (top - 8);
    if (overlap <= 0) return;

    var box = target.closest ? target.closest(CFG.liftWithin) : null;
    if (!box) {
      try { target.scrollIntoView({ block: 'center' }); } catch (e) { /* no smooth scroll here */ }
      return;
    }

    // Never push the dialog's own top off the screen - its buttons are up there.
    var room = box.getBoundingClientRect().top - 4;
    var by = Math.min(overlap, Math.max(0, room));
    if (by <= 0) return;

    lifted = { el: box, previous: box.style.transform };
    moveNow(box, 'translateY(-' + Math.round(by) + 'px)');
  }

  function unlift() {
    unliftWanted = false;
    if (unliftTimer) { global.clearTimeout(unliftTimer); unliftTimer = 0; }
    if (!lifted) return;
    moveNow(lifted.el, lifted.previous);
    lifted = null;
  }

  /// Put the dialog back, but never while a finger is still on the glass.
  ///
  /// Tapping a button inside a lifted dialog focuses that button, which is a
  /// focus change away from the text field, which closes the keyboard. Drop the
  /// dialog back into place at that moment and the button slides out from under
  /// the finger between pointerdown and pointerup - so the click is delivered to
  /// whatever has moved into its place instead, and "Spara" does nothing on the
  /// first tap. Waiting for the finger to leave costs nothing and cannot race:
  /// a new lift calls unlift() directly and clears the wish.
  function unliftWhenSafe() {
    if (!lifted) return;
    if (pointersDown > 0) {
      unliftWanted = true;
      // A pointerup can go missing - a finger dragged off the window, a pointer
      // captured by something else - and a count that never comes back down would
      // leave the dialog standing where the keyboard used to be for the rest of
      // the session. We are waiting for one tap to end, so a short bound loses
      // nothing and cannot stick.
      if (!unliftTimer)
        unliftTimer = global.setTimeout(function () { unliftTimer = 0; unlift(); }, 1200);
      return;
    }
    unlift();
  }

  // ---------------------------------------------------------------------------
  // Two windows on one desktop
  // ---------------------------------------------------------------------------
  //
  // Windows has one active window. When the person on the other screen taps
  // their console, their window becomes it and ours is deactivated - and the
  // browser then fires blur and focusout on the field being typed into here,
  // although nobody left it, and focus and focusin on it again the moment our
  // window is tapped next. The page took those for the real thing: the console's
  // onblur looked up a half-typed member number, and its onfocus selected the
  // whole field, so the next letter typed on our keys replaced everything before
  // it. Two people entering names at once kept wiping each other's.
  //
  // The browser does tell the two apart, if asked: while a deactivation's blur
  // is dispatched the field is still document.activeElement, where a field that
  // is really being left has already been dropped from it (Chromium's
  // Document::SetFocusedElement clears the focused element before it fires
  // blur; FocusController::SetFocused leaves it in place, and fires nothing at
  // all for focus changes made while the window is inactive). So a blur on our
  // target that is still the active element is the window going, and the focus
  // that brings it back is the one arriving on the same target while we are
  // parked. Both are stopped here, before the page sees them: onfocus and onblur
  // on the field are target-phase listeners, so a capture listener on the
  // document is upstream of them. The keyboard itself stays exactly as it was -
  // same field, same caret, same shift, same lift - and typing on our keys goes
  // on working while the window is inactive, because the field never stopped
  // being the active element, and the tap on a key is what activates the window
  // again. The one thing the browser does take away is the caret - it draws none
  // in an inactive window - so while parked we draw it ourselves, see below.
  //
  // A focus that returns to some *other* field - the tap that woke the window
  // landed on one, and the browser moved the focus before it told us the window
  // was back - is a real one and is left alone: onFocusIn opens on it as usual.

  /// A blur or focusout on the field we are typing into that is the window being
  /// deactivated, not the person leaving the field. document.hasFocus() says the
  /// same thing from the other side - no engine fires a real blur while the
  /// window is inactive - and is accepted too, for one that clears activeElement
  /// before the event rather than after.
  function isWindowLeaving(e) {
    if (target === null || e.target !== target) return false;
    return document.activeElement === target || !document.hasFocus();
  }

  /// The focus or focusin that brings the window back to the same field.
  function isWindowReturning(e) {
    return parked && e.target === target;
  }

  /// 'blur' is dispatched before 'focusout' and is the one the inline onblur
  /// handlers hang off, so it needs a listener of its own; onFocusOut then sees
  /// the same deactivation and does its part.
  function onBlur(e) {
    if (!isWindowLeaving(e)) return;
    parked = true;
    e.stopImmediatePropagation();
    caretUpdate();
  }

  /// Likewise 'focus' before 'focusin'; onFocusIn is what un-parks.
  function onFocus(e) {
    if (isWindowReturning(e)) e.stopImmediatePropagation();
  }

  // ---------------------------------------------------------------------------
  // The caret on an inactive window
  // ---------------------------------------------------------------------------
  //
  // The browser draws no caret in a window that is not the active one, so the
  // moment the other screen is tapped the person typing here loses sight of
  // where they are in the name: the text stays, the keyboard stays, the caret
  // goes. No CSS brings it back, so while parked we draw one of our own - a bar
  // the browser's width and colour, blinking at the browser's rate, where the
  // real one is. The place is found the way every caret-position library finds
  // it: lay the field's text out again in a hidden element with the same font
  // and width, with an empty span at the caret index, and read that span's
  // position. It goes the moment the window comes back and the browser's own
  // caret returns, so the two are never on screen together.

  /// What decides where a glyph lands. Copied on every measurement, because a
  /// hall's Custom.css is free to change any of them.
  var MIRROR_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch',
    'fontKerning', 'fontFeatureSettings', 'letterSpacing', 'wordSpacing', 'textTransform',
    'textIndent', 'textAlign', 'textRendering', 'lineHeight', 'tabSize', 'direction'
  ];

  function caretHide() {
    if (caret) caret.hidden = true;
    caretAt = '';
  }

  /// Where the browser's caret is in the field, in viewport coordinates - or
  /// null when it would draw none: a range is selected (the selection is drawn
  /// instead, inactive window or not), or the caret is scrolled out of the box.
  function caretPlace(el) {
    var sel = caretOf(el);
    if (sel[0] !== sel[1]) return null;

    if (!mirror) {
      mirror = document.createElement('div');
      mirror.setAttribute('aria-hidden', 'true');
      var ms = mirror.style;
      ms.position = 'fixed'; ms.top = '0'; ms.left = '-100000px';
      ms.visibility = 'hidden'; ms.pointerEvents = 'none';
      ms.margin = '0'; ms.padding = '0'; ms.border = '0';
      document.body.appendChild(mirror);
    }

    var cs = global.getComputedStyle(el);
    var box = el.getBoundingClientRect();
    var isArea = el.tagName === 'TEXTAREA';

    // CSS zoom. The console's name fields carry zoom: 1.5 (vbs.css, #addplayer
    // input), and a mirror laid out unzoomed put the caret two thirds of the way
    // into every name. The browser reports a zoomed field's computed style and
    // client metrics in the field's own unzoomed pixels and its client rect in
    // zoomed viewport pixels, so the mirror is zoomed the same and the unzoomed
    // metrics are scaled by hand below. An older browser reported everything
    // zoomed already; there the ratio is 1 and the scaling is a no-op, which is
    // also right.
    var z = (typeof el.currentCSSZoom === 'number') ? el.currentCSSZoom
          : (el.offsetWidth ? box.width / el.offsetWidth : 1);
    mirror.style.zoom = z;

    for (var i = 0; i < MIRROR_PROPS.length; i++)
      mirror.style[MIRROR_PROPS[i]] = cs[MIRROR_PROPS[i]];
    // A single-line field keeps every space and never wraps; a textarea wraps
    // the way its own text does.
    mirror.style.whiteSpace = isArea ? 'pre-wrap' : 'pre';
    mirror.style.overflowWrap = isArea ? 'break-word' : 'normal';

    var padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    var padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    var contentW = el.clientWidth - padL - padR;        // unzoomed, like the mirror's width
    var contentH = el.clientHeight - padT - padB;
    mirror.style.width = Math.max(0, contentW) + 'px';

    var text = el.value;
    if (el.type === 'password') text = new Array(text.length + 1).join('\u2022');
    mirror.textContent = '';
    mirror.appendChild(document.createTextNode(text.slice(0, sel[0])));
    var mark = document.createElement('span');
    mirror.appendChild(mark);
    mirror.appendChild(document.createTextNode(text.slice(sel[0])));

    // From here on everything is in zoomed viewport pixels, like the rects -
    // which are also the browser's layout pixels, the units it places its own
    // caret in.
    var m = mark.getBoundingClientRect();
    var o = mirror.getBoundingClientRect();
    var w = contentW * z, hh = contentH * z;
    var h = m.height;

    // Where the browser puts its bar caret (Chromium caret_rect.cc,
    // ComputeLocalCaretRectAtTextOffset and the ClampAndRound after it): one
    // layout pixel wide whatever the zoom, centred on the glyph boundary - so
    // half a pixel to the left of it - then rounded to a whole layout pixel and
    // kept inside the box, which at the end of a full line pulls it back in by
    // its own width. A single line is centred in the content box, with the
    // odd pixel going below; a textarea starts at the top and scrolls.
    var x = m.left - o.left - el.scrollLeft * z - 0.5;
    x = Math.round(Math.max(0, Math.min(x, Math.floor(w - 1))));
    var y = isArea ? m.top - o.top - el.scrollTop * z : Math.floor((hh - h) / 2);
    if (y + h <= 0 || y >= hh) return null;

    return {
      left: Math.round(box.left + (el.clientLeft + padL) * z + x),
      top: Math.round(box.top + (el.clientTop + padT) * z + y),
      height: h,
      width: Math.max(1, Math.floor(z)),
      color: (cs.caretColor && cs.caretColor !== 'auto') ? cs.caretColor : cs.color
    };
  }

  /// Draw, move or take down our caret to match the field. Safe to call from
  /// anywhere: it does nothing unless we are parked on a field.
  function caretUpdate() {
    if (!parked || !target) { caretHide(); return; }
    var at = caretPlace(target);
    if (!at) { caretHide(); return; }

    if (!caret) {
      caret = document.createElement('div');
      caret.className = 'vbskb-caret';
      caret.setAttribute('aria-hidden', 'true');
      document.body.appendChild(caret);
    }
    caret.style.left = at.left + 'px';
    caret.style.top = at.top + 'px';
    caret.style.height = at.height + 'px';
    caret.style.width = at.width + 'px';
    caret.style.background = at.color;
    caret.hidden = false;

    // A real caret shows solid the instant it moves and blinks from there; ours
    // restarts its animation on a move and only on a move - the guard calls
    // here twice a second and must not keep it lit.
    var here = at.left + ',' + at.top;
    if (here !== caretAt) {
      caretAt = here;
      caret.style.animation = 'none';
      caret.getBoundingClientRect();
      caret.style.animation = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function onFocusIn(e) {
    if (!enabled) return;
    if (isWindowReturning(e)) { parked = false; caretHide(); e.stopImmediatePropagation(); return; }
    parked = false;
    caretHide();
    if (panel && panel.contains(e.target)) return;
    if (!isTypable(e.target)) { close(); return; }
    suppressOn(e.target);
    open(e.target);
  }

  function onFocusOut(e) {
    if (!enabled || e.target !== target) return;
    if (isWindowLeaving(e)) { parked = true; e.stopImmediatePropagation(); caretUpdate(); return; }
    // Deferred, so moving from one name field to the next re-opens on the new one
    // instead of closing and reopening the keyboard between every field.
    if (hideTimer) global.clearTimeout(hideTimer);
    hideTimer = global.setTimeout(function () {
      hideTimer = 0;
      if (document.activeElement !== target) close();
    }, 0);
  }

  /// navigator.userAgentData is the better answer and is usually not there to
  /// give it: it is defined only in a secure context, and a lane console reaches
  /// its slave over plain HTTP on a LAN address. So the user agent string is what
  /// actually decides here. Android and iOS never carry "Windows NT"; Windows
  /// Phone did, and had one screen, so it is named out.
  function isWindows() {
    var data = global.navigator.userAgentData;
    if (data && data.platform) return data.platform === 'Windows';
    var ua = global.navigator.userAgent || '';
    return /Windows NT/i.test(ua) && !/Windows Phone/i.test(ua);
  }

  /// The same question for Android, answered the same way. An Android WebView
  /// and Chrome on Android both carry "Android" (the WebView adds "; wv"). Chrome
  /// on a large tablet asks for the desktop site by default and then calls itself
  /// "X11; Linux x86_64", so a touch screen behind a Linux user agent is taken for
  /// such a tablet too - a Linux touch PC, the only other thing it can be, has
  /// the same want of a keyboard. ChromeOS says "CrOS" and is left alone.
  function isAndroid() {
    var nav = global.navigator;
    var data = nav.userAgentData;
    var ua = nav.userAgent || '';
    var platform = data && data.platform ? String(data.platform) : '';
    if (platform ? platform === 'Android' : /Android/i.test(ua)) return true;
    var linux = platform ? platform === 'Linux' : /Linux/i.test(ua) && !/CrOS/i.test(ua);
    return linux && (nav.maxTouchPoints || 0) > 0;
  }

  /// Whether inputmode="none" can keep the platform's keyboard down here. The
  /// property arrived with the behaviour (Chromium 66, Firefox 95); a WebView
  /// older than that ignores the attribute and would raise Android's keyboard
  /// on top of ours.
  function honoursInputMode() {
    return !!global.HTMLElement && 'inputMode' in global.HTMLElement.prototype;
  }

  /// Whether this browser can draw our keys: vbskeyboard.css sizes the panel and
  /// the key font with clamp() (Chromium 79) and spaces the keys with gap in a
  /// flex row (Chromium 84). Without them the panel loses its height, or its keys
  /// run into each other, while Android's keyboard is held down - so a WebView
  /// that old keeps Android's. CSS.supports cannot tell flex gap from the older
  /// grid gap, so that one is measured.
  function drawsKeys() {
    var css = global.CSS;
    if (!css || !css.supports || !css.supports('height', 'clamp(1px, 2px, 3px)')) return false;
    var box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;row-gap:10px;position:absolute;visibility:hidden';
    box.appendChild(document.createElement('div'));
    box.appendChild(document.createElement('div'));
    document.body.appendChild(box);
    var ok = box.scrollHeight >= 9;     // 10, give or take rounding; without flex gap 0
    document.body.removeChild(box);
    return ok;
  }

  /// The primary pointer is the first finger of a gesture, so it is also the
  /// point at which the count is known to be exactly one - which quietly corrects
  /// any drift left by a press whose release never arrived.
  function onPointerDown(e) {
    pointersDown = e.isPrimary ? 1 : pointersDown + 1;
  }

  /// The click that follows this pointerup is dispatched before a timer set here
  /// can run, which is exactly the point: the button gets its click, and only
  /// then does the dialog move.
  function onPointerUp() {
    if (pointersDown > 0) pointersDown--;
    if (!unliftWanted || pointersDown > 0) return;
    global.setTimeout(function () {
      if (unliftWanted && pointersDown === 0) unlift();
    }, 0);
  }

  /// ?keyboard=0 / off / false turns it off for this window, ?keyboard=1 / on
  /// forces it on - including on a platform the default would have skipped, which
  /// is how this gets tested anywhere but a lane console. window.VBSKB_DEFAULT and
  /// then the platform decide when the address says nothing.
  function readSwitch() {
    var chosen = null;
    new URLSearchParams(global.location.search).forEach(function (value, name) {
      if (name.toLowerCase() === 'keyboard') chosen = String(value).toLowerCase();
    });
    if (chosen !== null)
      return !(chosen === '0' || chosen === 'off' || chosen === 'false' || chosen === 'no');

    if (global.VBSKB_DEFAULT === false) return false;
    // windowsOnly is this switch's name from before Android: false there still means anywhere
    if (!CFG.platformsOnly || CFG.windowsOnly === false || isWindows()) return true;
    return isAndroid() && honoursInputMode() && drawsKeys();
  }

  function start() {
    enabled = readSwitch();
    if (!enabled) return;

    sweep(document.body);

    if (global.MutationObserver) {
      new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++)
          for (var n = 0; n < records[i].addedNodes.length; n++)
            sweep(records[i].addedNodes[n]);
      }).observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('blur', onBlur, true);
    document.addEventListener('focus', onFocus, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    global.addEventListener('resize', function () { if (target) { lift(); caretUpdate(); } });
    global.addEventListener('orientationchange', function () { if (target) { lift(); caretUpdate(); } });
  }

  // ---------------------------------------------------------------------------
  // The bit other code can call
  // ---------------------------------------------------------------------------

  global.vbsKeyboard = {
    config: CFG,

    enable: function () {
      if (enabled) return;
      enabled = true;
      sweep(document.body);
    },

    disable: function () {
      if (!enabled) return;
      close();
      enabled = false;
      unsweepAll();
    },

    isEnabled: function () { return enabled; },
    isOpen: function () { return target !== null; },
    close: close,

    /// Change how the browser's own keyboard is held off, and re-apply it to the
    /// fields already on the page - assigning to config.suppress on its own would
    /// only reach fields prepared after the change, because a field is only ever
    /// prepared once.
    setSuppress: function (mode) {
      CFG.suppress = mode;
      unsweepAll();
      if (enabled) sweep(document.body);
    },

    /// Why the keyboard is or is not on this screen, for answering a support
    /// call without a debugger: vbsKeyboard.why() in the browser console.
    why: function () {
      return {
        enabled: enabled,
        windows: isWindows(),
        android: isAndroid(),
        inputModeHonoured: honoursInputMode(),
        drawsKeys: drawsKeys(),
        platformsOnly: CFG.platformsOnly,
        suppress: CFG.suppress,
        pointersDown: pointersDown,
        dialogLifted: lifted !== null,
        restorePending: unliftWanted,
        fieldsTakenOver: document.querySelectorAll('[data-vbskb-prep="1"]').length,
        language: languageName(),
        open: target !== null,
        windowDeactivated: parked,
        caretDrawn: !!(caret && !caret.hidden)
      };
    },

    /// Force a redraw after a language change. Not normally needed - opening the
    /// keyboard reads the page's language every time - but useful from the console.
    refresh: function () { if (panel) buildRows(); }
  };

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start);
  else
    start();

})(window);

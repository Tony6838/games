// Hide the mouse pointer on a screen nobody is standing at.
//
// These pages are shown on a ceiling TV, a hall info screen or a lane console, in a
// chrome.exe --app= window with no toolbar, and a mouse is touched only while one of
// them is being set up. The arrow left behind in the middle of a 4 m screen is then
// what the hall looks at for the rest of the evening, so it goes away
// VBS_CURSOR_IDLE_MS after the last real movement and comes back on the next one.
//
// It is CSS, and no Windows call is needed or possible. Page script cannot reach
// ShowCursor(), and does not have to: the browser decides what is drawn over its own
// window, and `cursor: none` is how it is asked. The limit follows from the same fact -
// the rule holds over this page's content area and nowhere else. In an --app= window
// that is the whole window, which is the case that matters here; over the taskbar, the
// desktop or a browser's own toolbar the pointer belongs to Windows again, and a native
// right-click menu or a <select> drop-down shows it until it is dismissed.
//
// Opt-in, one <script> line per page, rather than folded into commonAPI.js: the two
// surfaces that are worked at with a mouse - the reception Web UI and VBS mechanic -
// must not have it, and VBS mechanic loads commonAPI.js. Same reason as
// window.vbsFollowsProtocolSwitch.
//
// Each document of a composition running its own copy is correct and not a gap. The
// TakTV wall and pair pages are a shell of <iframe>s, and the pointer drawn is the one
// the innermost document under it asks for - so the frame the mouse is actually over is
// the frame whose timer decides, and crossing into a frame fires mousemove there, which
// is what brings the pointer back. A cross-origin frame (the customer's own page in
// _custom.html) is the browser's to decide and neither we nor the shell can reach it.
//
// What is NOT touched: the text caret the lane TV mirrors from the console while names
// are typed (vbsnameentry.js). That is an element this page draws, not the pointer.

var VBS_CURSOR_IDLE_MS = 10000;   // gone 10 s after the mouse stops

(function () {
  // Set window.vbsCursorIdleMs before this script to use another delay on one screen;
  // 0 leaves the pointer alone there.
  var idleMs = (typeof window.vbsCursorIdleMs === 'number') ? window.vbsCursorIdleMs
                                                           : VBS_CURSOR_IDLE_MS;
  if (!(idleMs > 0)) return;

  // The descendant selector and !important are both load-bearing: bootstrap puts
  // `cursor: pointer` on every button and vbskeyboard.css on every key, so a rule on
  // <html> alone would be overridden on exactly the things a pointer comes to rest on.
  // An !important author rule also outranks a style="cursor:..." attribute.
  var style = document.createElement('style');
  style.textContent = 'html.vbs-cursor-hidden, html.vbs-cursor-hidden * { cursor: none !important; }';
  (document.head || document.documentElement).appendChild(style);

  var root = document.documentElement;
  var timer = null;
  var lastX = null;
  var lastY = null;

  function hide() {
    timer = null;
    root.classList.add('vbs-cursor-hidden');
  }

  function wake() {
    root.classList.remove('vbs-cursor-hidden');
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(hide, idleMs);
  }

  // Chromium re-fires mousemove at an unchanged pointer position whenever the layout
  // under it changes, so that :hover stays right. Every one of these screens swaps a
  // full-bleed <img> or starts a video every few seconds, so taking each mousemove at
  // face value would rearm the timer for ever and the pointer would never go. Only a
  // position that differs counts as movement. Screen coordinates rather than client
  // ones, so that a scroll or a window resize is not movement either.
  function onMouseMove(event) {
    if (event.screenX === lastX && event.screenY === lastY) return;
    lastX = event.screenX;
    lastY = event.screenY;
    wake();
  }

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  ['mousedown', 'wheel', 'touchstart', 'keydown'].forEach(function (name) {
    document.addEventListener(name, wake, { passive: true });
  });

  // Arm it now, so a screen that is switched on and left alone loses the pointer
  // idleMs later rather than keeping whatever Windows left at the last mouse position.
  wake();
})();

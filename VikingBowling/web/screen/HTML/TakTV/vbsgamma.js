// ---------------------------------------------------------------------------
// vbsgamma.js - translucency as the lane TV blends it.
//
// GDI_plus_helper::SetGraphicsMode sets CompositingQualityHighQuality, and GDI+
// then blends a translucent colour over what is under it in LINEAR light: it
// turns both into linear values with the sRGB curve, mixes those, and turns the
// result back. Every browser mixes the sRGB values themselves. For a dark colour
// over a background the two are far apart - the OnScoring team bars (black at
// alpha 175 over the background) come out at about 59% of the background's
// brightness on the TV and at 31% in a browser, 33 levels darker on average -
// and every translucent row picture (Inactive.png and the like) is lighter on
// the TV. Measured against VTVFile1.jpg: the sRGB curve fits the TV to within
// JPEG noise (mean error 1.6), the browser's own mixing is off by 33.
//
// A browser cannot be made to mix in linear light. An SVG filter that converts
// to linear and back works only in 8 bits, which crushes every value below ~16
// to black (measured), so that is not an answer. What is done instead: a
// translucent colour (c, a) is replaced by the (c', a') whose ordinary mixing
// comes closest to the linear-light result over every background from black to
// white - a least-squares line through the 256 results per channel, whose slope
// gives 1 - a' and whose intercept gives a' * c'. For a black overlay that is
// nearly exact (mean error 33 -> 5), for a white one 19 -> 4. Opaque and fully
// transparent colours are left alone; they mix nothing.
//
// The same is done for the translucent pixels of a picture: the page reads the
// picture once into a canvas, replaces every partly transparent pixel, and
// draws the result from then on (vbsGammaImageUrl). Antialiased edges of text
// and shapes are mixed by the browser itself and cannot be reached; that, and
// the residual of the fit, is what is left of the difference.
// ---------------------------------------------------------------------------

/* exported vbsGammaColor, vbsGammaImageUrl, vbsGammaOnReady */

var VBS_SRGB_TO_LINEAR = (function () {
  var t = new Float64Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
}());

function vbsLinearToSrgb(l) {
  if (l <= 0) return 0;
  if (l >= 1) return 255;
  return 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
}

// The sums of the least-squares line over backgrounds 0..255.
var VBS_GAMMA_XBAR = 127.5;
var VBS_GAMMA_SXX = (function () {
  var s = 0;
  for (var x = 0; x < 256; x++) s += (x - 127.5) * (x - 127.5);
  return s;
}());

// Slope and intercept of the line through the linear-light results of colour
// channel c (0..255) at alpha a (0..1) over every background.
function vbsGammaLine(c, a) {
  var cl = a * VBS_SRGB_TO_LINEAR[c];
  var sum = 0, sxy = 0;
  for (var x = 0; x < 256; x++) {
    var t = vbsLinearToSrgb(cl + (1 - a) * VBS_SRGB_TO_LINEAR[x]);
    sum += t;
    sxy += (x - VBS_GAMMA_XBAR) * t;
  }
  var k = sxy / VBS_GAMMA_SXX;
  return { k: k, m: sum / 256 - k * VBS_GAMMA_XBAR };
}

var vbsGammaCache = {};
var vbsGammaCacheSize = 0;

// { r, g, b, a } with every component 0..255 -> the colour that, mixed the
// browser's way, comes out as GDI+ would have mixed the original.
function vbsGammaColor(color) {
  var a = color.a;
  if (!(a > 0 && a < 255)) return color;
  var r = Math.round(color.r), g = Math.round(color.g), b = Math.round(color.b);
  var key = ((r * 256 + g) * 256 + b) * 256 + Math.round(a);
  var hit = vbsGammaCache[key];
  if (hit) return hit;

  var af = a / 255;
  var lr = vbsGammaLine(r, af), lg = vbsGammaLine(g, af), lb = vbsGammaLine(b, af);
  var ap = 1 - (lr.k + lg.k + lb.k) / 3;
  if (ap < 0.002) ap = 0.002;
  if (ap > 1) ap = 1;
  var clamp = function (v) { return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); };
  var out = { r: clamp(lr.m / ap), g: clamp(lg.m / ap), b: clamp(lb.m / ap), a: ap * 255 };

  if (vbsGammaCacheSize > 50000) { vbsGammaCache = {}; vbsGammaCacheSize = 0; }
  vbsGammaCache[key] = out;
  vbsGammaCacheSize++;
  return out;
}

// --- pictures --------------------------------------------------------------

var vbsGammaImages = {};        // url -> corrected blob URL, the url itself (nothing to do), or PENDING
var VBS_GAMMA_PENDING = {};
var vbsGammaReadyHooks = [];

// A function to call when a corrected picture becomes available, so the page
// can draw again with it.
function vbsGammaOnReady(fn) {
  if (typeof fn === 'function') vbsGammaReadyHooks.push(fn);
}

function vbsGammaNotify() {
  for (var i = 0; i < vbsGammaReadyHooks.length; i++) {
    try { vbsGammaReadyHooks[i](); } catch (e) { if (window.console) console.error(e); }
  }
}

// The URL to draw the picture with: the corrected copy once it exists, the
// picture itself until then (and for good when it has no translucent pixel, or
// cannot be read). A data: URI is drawn as it is.
function vbsGammaImageUrl(url) {
  if (!url || url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return url;
  var done = vbsGammaImages[url];
  if (done === VBS_GAMMA_PENDING) return url;
  if (done) return done;

  vbsGammaImages[url] = VBS_GAMMA_PENDING;
  var img = new Image();
  img.onload = function () {
    try {
      var w = img.naturalWidth, h = img.naturalHeight;
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      var data = ctx.getImageData(0, 0, w, h);
      var px = data.data;
      var changed = false;
      for (var i = 0; i < px.length; i += 4) {
        var a = px[i + 3];
        if (a === 0 || a === 255) continue;
        var c = vbsGammaColor({ r: px[i], g: px[i + 1], b: px[i + 2], a: a });
        px[i] = c.r; px[i + 1] = c.g; px[i + 2] = c.b; px[i + 3] = Math.round(c.a);
        changed = true;
      }
      if (!changed) { vbsGammaImages[url] = url; return; }
      ctx.putImageData(data, 0, 0);
      canvas.toBlob(function (blob) {
        vbsGammaImages[url] = blob ? URL.createObjectURL(blob) : url;
        if (blob) vbsGammaNotify();
      }, 'image/png');
    } catch (error) {
      vbsGammaImages[url] = url;     // not readable (another origin): drawn as it is
    }
  };
  img.onerror = function () { vbsGammaImages[url] = url; };
  img.src = url;
  return url;
}

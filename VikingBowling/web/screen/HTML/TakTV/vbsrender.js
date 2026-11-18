// ---------------------------------------------------------------------------
// vbsrender.js - the HTML replacement for GDI_plus_helper::BitmapFromXml.
//
// Same input (a lane's GCI_PLAYERINFORMATIONSTRUCT, here as the lane-file JSON),
// same layout description (protocol_viking.js, transcribed from protocol.xml),
// same output geometry (a 640x480 sheet) - but painted by the browser instead of
// by GDI+, and delivered over http/WebView2 instead of by reading XML off disk.
//
// The structure below follows BitmapFromXml step for step so the two can be
// compared:
//
//   BitmapFromXml                          vbsRenderProtocol
//   -------------                          -----------------
//   background bitmap x_generate*y_generate   <svg viewBox="0 0 640 480"> + bg image
//   PlayLayers(true, root, bg)                drawLayers(root, 'before')
//   for each player: active/inactive sub      drawPlayer() per player
//   PlayLayers(false, root, bg)               drawLayers(root, 'after')
//
// Three engine behaviours from CMyXml are reproduced exactly, because the
// layout depends on all three:
//
//  1. Value selection. "a;b;c" is indexed by (players - 1) and "a|b|c" by the
//     active frame, both clamped to the last entry - GetColumn writes the last
//     column and returns false, and GetElementContens ignores that return.
//  2. "+=n" / "-=n" adjust whatever the previous element left in that field,
//     which is how the 21 throw squares and the 10 sums step across the sheet.
//  3. Every text attribute except the text itself is sticky across elements,
//     globally and in paint order, because CMyXml keeps them in statics. An
//     element that omits <font> or <align> inherits the last one painted.
//
// Text is placed the way GDI_plus_helper::MyTextOut places it: the glyphs are
// stretched so a reference string exactly fills the rect vertically, then
// squeezed horizontally by <aspect>, then squeezed further if that would
// overflow the rect. SVG is used for the sheet because it is the only way to
// hit a baseline exactly; the page around it is ordinary HTML/CSS.
// ---------------------------------------------------------------------------

/* global vbsGetText, vbsMakeContext, vbsIsPlayerActive, vbsGammaColor, vbsGammaImageUrl,
   vbsIsLayoutUrl, vbsLayoutRelativeUrl */
/* exported vbsRenderProtocol */

var SVGNS = 'http://www.w3.org/2000/svg';
var XLINKNS = 'http://www.w3.org/1999/xlink';

// The page is a Full HD image. Every protocol composes into this canvas, so what
// a browser, a lane TV or the review dialog receives is always 1920x1080 and
// scales to a 1080p or 4K screen without any of them having to letterbox it.
var VBS_CANVAS_WIDTH = 1920;
var VBS_CANVAS_HEIGHT = 1080;


// Reference strings from MyTextOut: the first for a rect that must fit
// descenders ("is_text_rec"), the second for digits and caps only.
var REF_TEXT_REC = 'GgpPjJW';
var REF_TEXT_PLAIN = 'GPJW091';
var PROBE_SIZE = 100;

var vbsMeasureCanvas = null;
var vbsMeasureCache = {};
var vbsMeasureCacheSize = 0;

// Player names and running totals both end up as cache keys, and a lane TV runs
// for months, so the cache is dropped rather than grown without bound. The
// entries are cheap to rebuild - a few hundred measureText calls.
var VBS_MEASURE_CACHE_MAX = 4000;

function vbsMeasure(text, font, fontstyle) {
  var key = fontstyle + '|' + font + '|' + text;
  if (vbsMeasureCache[key]) return vbsMeasureCache[key];

  if (vbsMeasureCacheSize >= VBS_MEASURE_CACHE_MAX) {
    vbsMeasureCache = {};
    vbsMeasureCacheSize = 0;
  }

  if (!vbsMeasureCanvas) vbsMeasureCanvas = document.createElement('canvas');
  var ctx = vbsMeasureCanvas.getContext('2d');
  ctx.font = vbsCssFontShorthand(font, fontstyle, PROBE_SIZE);
  ctx.textBaseline = 'alphabetic';
  var m = ctx.measureText(text);

  // Ink box relative to the pen origin, matching GraphicsPath::GetBounds.
  var r = {
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent
  };
  r.width = r.left + r.right;
  r.height = r.ascent + r.descent;
  vbsMeasureCache[key] = r;
  vbsMeasureCacheSize++;
  return r;
}

// The font a name gives, the way GDI+ gives it. Gdiplus::Font, asked for a
// family that is not installed, falls back to FontFamily::GenericSansSerif -
// Microsoft Sans Serif on every Windows we ship to. "bowler", which some themes
// draw their throw squares with, is installed nowhere, and neither is "Times",
// CMyXml's starting font, so on the TV both are Microsoft Sans Serif. A browser
// would draw them in its own fallback instead, and Blink even maps "Times" to
// Times New Roman (with Helvetica -> Arial and Courier -> Courier New), so
// whether a family exists is worked out here: those three aliases count as
// absent, and any other name is absent when it measures exactly like the
// generic fallbacks it is put in front of.
var VBS_GDIPLUS_FALLBACK = '"Microsoft Sans Serif", Arial, sans-serif';
var vbsFontPresent = {};

function vbsFontIsInstalled(font) {
  var key = String(font).toLowerCase().trim();
  if (vbsFontPresent[key] !== undefined) return vbsFontPresent[key];
  var present = true;
  if (key === 'times' || key === 'helvetica' || key === 'courier') {
    present = false;
  } else {
    try {
      if (!vbsMeasureCanvas) vbsMeasureCanvas = document.createElement('canvas');
      var ctx = vbsMeasureCanvas.getContext('2d');
      var probe = 'mmmmmmmmmlli1WQ@#0123456789';
      var same = ['monospace', 'serif'].every(function (generic) {
        ctx.font = '72px ' + generic;
        var plain = ctx.measureText(probe).width;
        ctx.font = '72px "' + font + '", ' + generic;
        return ctx.measureText(probe).width === plain;
      });
      present = !same;
    } catch (e) {
      present = true;
    }
  }
  vbsFontPresent[key] = present;
  return present;
}

function vbsCssFontFamily(font) {
  if (!font || !vbsFontIsInstalled(font)) return VBS_GDIPLUS_FALLBACK;
  return '"' + font + '", ' + VBS_GDIPLUS_FALLBACK;
}

function vbsCssFontShorthand(font, fontstyle, size) {
  var weight = (fontstyle === 'bold' || fontstyle === 'bolditalic') ? 'bold' : 'normal';
  var slant = (fontstyle === 'italic' || fontstyle === 'bolditalic') ? 'italic' : 'normal';
  return slant + ' ' + weight + ' ' + size + 'px ' + vbsCssFontFamily(font);
}

// --- value selection (CMyXml::GetElementContens) -------------------------

function vbsPickColumn(spec, semiIndex, pipeIndex) {
  if (spec === undefined || spec === null) return null;
  var s = String(spec);
  var part = s;

  if (s.indexOf(';') >= 0) {
    var cols = s.split(';');
    part = cols[Math.min(semiIndex, cols.length - 1)];
  }
  if (part.indexOf('|') >= 0) {
    var pipes = part.split('|');
    part = pipes[Math.min(pipeIndex, pipes.length - 1)];
  }
  return part.replace(/[\t\r\n]/g, '').trim();
}

// GetIntContens: "+=n" and "-=n" adjust the inherited value, anything else
// replaces it. An absent node leaves the value untouched.
function vbsPickInt(spec, sel, previous) {
  var v = vbsPickColumn(spec, sel.semi, sel.pipe);
  if (v === null) return previous;
  if (v.indexOf('+=') === 0) return previous + (parseInt(v.substring(2), 10) || 0);
  if (v.indexOf('-=') === 0) return previous - (parseInt(v.substring(2), 10) || 0);
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function vbsPickFloat(spec, sel, previous) {
  var v = vbsPickColumn(spec, sel.semi, sel.pipe);
  if (v === null) return previous;
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function vbsPickString(spec, sel, previous) {
  var v = vbsPickColumn(spec, sel.semi, sel.pipe);
  return (v === null) ? previous : v;
}

function vbsPickColor(spec, sel, previous) {
  if (!spec) return previous;
  return {
    a: vbsPickInt(spec.trans, sel, previous.a),
    r: vbsPickInt(spec.red, sel, previous.r),
    g: vbsPickInt(spec.green, sel, previous.g),
    b: vbsPickInt(spec.blue, sel, previous.b)
  };
}

// A translucent colour as the lane TV mixes it - see vbsgamma.js. Opaque and
// fully transparent colours come back as they are.
function vbsMix(c) {
  return (typeof vbsGammaColor === 'function') ? vbsGammaColor(c) : c;
}

function vbsCssColor(c) {
  return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
}

// --- SVG helpers ---------------------------------------------------------

function svgEl(name, attrs) {
  var e = document.createElementNS(SVGNS, name);
  if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  return e;
}

function svgImage(href, x, y, w, h, opacity, colorFactor) {
  // A picture with translucent pixels is drawn from its corrected copy once that
  // exists (vbsgamma.js); the first draw has the picture itself.
  if (typeof vbsGammaImageUrl === 'function') href = vbsGammaImageUrl(href);
  var img = svgEl('image', {
    x: x, y: y, width: w, height: h,
    preserveAspectRatio: 'none'
  });
  img.setAttribute('href', href);
  img.setAttributeNS(XLINKNS, 'xlink:href', href);   // older WebView2 runtimes
  if (opacity !== undefined && opacity !== 1) img.setAttribute('opacity', opacity);
  // MyDrawImage scales R, G and B by color_factor through a ColorMatrix; a plain
  // brightness filter is the same operation on straight (non-premultiplied) RGB.
  if (colorFactor !== undefined && colorFactor !== 1)
    img.setAttribute('style', 'filter: brightness(' + colorFactor + ')');
  return img;
}

// --- the paint state CMyXml keeps in statics ------------------------------

// The starting values are the ones CMyXml's constructor sets, because an element
// that omits an attribute keeps whatever the last painted element left there.
function vbsNewPaintState() {
  return {
    rect: { x: 0, y: 0, w: 0, h: 0 },
    fill: { a: 255, r: 0, g: 0, b: 0 },         // t_col_fill (<color_fill>), Black
    pen: { a: 255, r: 255, g: 255, b: 255 },    // t_col_pen  (<color_shadow>), White
    font: 'Times',
    fontstyle: 'normal',
    align: 'center',
    aspect: 0.75,
    halo: 0,
    shadow: 0,
    penWidth: 0,
    isTextRec: 0,
    // A factor that would undo the stage's horizontal stretch for text. Always 1:
    // the lane TV draws the protocol at its own size and stretches the finished
    // picture to 16:9 (ResizeBitmap in CGame::RenderScreen2), glyphs included, so
    // a 640x480 Viking sheet has wide letters there and must have them here. It
    // used to squeeze them back to their own shape, which drew every name and
    // total of a 4:3 theme - and of a Full HD one with a bottom panel - narrower
    // than the TV does, by 11 to 35 per cent.
    xCompensate: 1
  };
}

// --- text (GDI_plus_helper::MyTextOut) ------------------------------------

function vbsAppendText(parent, text, rect, st) {
  if (text === '' || text === null || text === undefined) return;
  if (rect.w <= 0 || rect.h <= 0) return;

  var refText = st.isTextRec > 0 ? REF_TEXT_REC : REF_TEXT_PLAIN;
  var ref = vbsMeasure(refText, st.font, st.fontstyle);
  var ink = vbsMeasure(text, st.font, st.fontstyle);
  if (!ref.height || !ink.width) return;

  var sy = rect.h / ref.height;                     // glyph height fills the rect
  // <aspect>, then the correction for a stage whose axes scale differently. The
  // glyphs are about to be stretched horizontally by stageScaleX/stageScaleY, so
  // they are squeezed by its inverse here and come out the shape MyTextOut draws.
  var kx = st.aspect * (st.xCompensate || 1);       // horizontal squeeze
  if (kx * ink.width * sy > rect.w) kx = rect.w / (ink.width * sy);
  var sx = kx * sy;

  var tx;
  if (st.align === 'left') tx = rect.x + sx * ink.left;
  else if (st.align === 'right') tx = rect.x + rect.w + sx * ink.left - sx * ink.width;
  else tx = rect.x + rect.w / 2 + sx * ink.left - sx * ink.width / 2;
  var ty = rect.y + sy * ref.ascent;                // baseline

  var g = svgEl('g', { transform: 'translate(' + tx + ',' + ty + ') scale(' + kx + ',1)' });
  var t = svgEl('text', {
    x: 0, y: 0,
    'font-family': vbsCssFontFamily(st.font),
    'font-size': (PROBE_SIZE * sy),
    'font-weight': (st.fontstyle === 'bold' || st.fontstyle === 'bolditalic') ? 'bold' : 'normal',
    'font-style': (st.fontstyle === 'italic' || st.fontstyle === 'bolditalic') ? 'italic' : 'normal',
    'xml:space': 'preserve',
    fill: vbsCssColor(vbsMix(st.fill)),
    'fill-opacity': vbsMix(st.fill).a / 255
  });
  t.textContent = text;

  // halo_factor is not reproduced. MyTextOut implements it by rendering the
  // glyphs to a scratch bitmap, shrinking and re-expanding it to get a blur, and
  // every element of every shipped Viking layout sets it to 0 - so there is
  // nothing to match. If a theme ever turns it on, a feGaussianBlur under the
  // fill is the equivalent.

  // shadow_factor drops a copy of the path down-right in the pen colour
  if (st.shadow > 0) {
    var sh = t.cloneNode(true);
    sh.setAttribute('transform', 'translate(' + (st.shadow / kx) + ',' + st.shadow + ')');
    sh.setAttribute('fill', vbsCssColor(vbsMix(st.pen)));
    sh.setAttribute('fill-opacity', vbsMix(st.pen).a / 255);
    g.appendChild(sh);
  }

  // pen_width outlines the glyphs in the same colour
  if (st.penWidth > 0) {
    t.setAttribute('stroke', vbsCssColor(vbsMix(st.pen)));
    t.setAttribute('stroke-opacity', vbsMix(st.pen).a / 255);
    t.setAttribute('stroke-width', st.penWidth);
    t.setAttribute('paint-order', 'stroke');
  }

  g.appendChild(t);
  parent.appendChild(g);
}

// The four throw decorations PrintTrueTypeText draws from the GCI status bits.
// Painted before the text itself, exactly as in the C++.
function vbsAppendStatusDecorations(parent, status, rect, st) {
  if ((status & GCI_CHANGED) > 0) {
    var a = Math.floor(rect.w / 15);
    var b = Math.floor(rect.h / 15);
    parent.appendChild(svgEl('rect', {
      x: rect.x + rect.w - a, y: rect.y + rect.h - b, width: a, height: b,
      fill: vbsCssColor(vbsMix(st.fill)), 'fill-opacity': vbsMix(st.fill).a / 255
    }));
  }

  if (status & GCI_NOTAP) {
    var box = {
      x: rect.x + Math.floor(rect.w * 3 / 4), y: rect.y + Math.floor(rect.h / 4),
      w: Math.floor(rect.w / 4), h: Math.floor(rect.h / 2)
    };
    vbsAppendText(parent, 'T', box, st);
    vbsAppendText(parent, 'N', { x: rect.x, y: box.y, w: box.w, h: box.h }, st);
  }

  if ((status & GCI_SPLIT) > 0) {
    var e = { x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2 };
    parent.appendChild(svgEl('ellipse', {
      cx: e.x + e.w / 2, cy: e.y + e.h / 2, rx: e.w / 2, ry: e.h / 2,
      fill: 'none',
      stroke: vbsCssColor(vbsMix(st.fill)), 'stroke-opacity': vbsMix(st.fill).a / 255, 'stroke-width': 2
    }));
  }
}

// --- element painting ----------------------------------------------------

function vbsPaintText(parent, e, env) {
  var st = env.state;

  st.rect = {
    x: vbsPickInt(e.rect && e.rect.x, env.sel, st.rect.x),
    y: vbsPickInt(e.rect && e.rect.y, env.sel, st.rect.y),
    w: vbsPickInt(e.rect && e.rect.w, env.sel, st.rect.w),
    h: vbsPickInt(e.rect && e.rect.h, env.sel, st.rect.h)
  };
  st.pen = vbsPickColor(e.shadowColor, env.sel, st.pen);     // <color_shadow>
  st.fill = vbsPickColor(e.fill, env.sel, st.fill);          // <color_fill>

  // <text> is cleared for every element, unlike everything else here
  var text = vbsPickString(e.text, env.sel, '');
  if (text === null) text = '';

  st.font = vbsPickString(e.font, env.sel, st.font);
  st.fontstyle = vbsPickString(e.fontstyle, env.sel, st.fontstyle);
  st.align = vbsPickString(e.align, env.sel, st.align);
  st.aspect = vbsPickFloat(e.aspect, env.sel, st.aspect);
  st.halo = vbsPickFloat(e.halo, env.sel, st.halo);
  st.shadow = vbsPickFloat(e.shadow, env.sel, st.shadow);
  st.penWidth = vbsPickFloat(e.penWidth, env.sel, st.penWidth);
  st.isTextRec = vbsPickInt(e.isTextRec, env.sel, st.isTextRec);

  var status = 0;
  if (e.id !== undefined && e.id !== null) {
    var id = vbsPickString(e.id, env.sel, '');
    var resolved = vbsGetText(id, env.ctx, text);
    if (resolved) {                       // null = the buffer left alone, keep <text>
      text = resolved.text;
      status = resolved.status;
    }
    if (status) vbsAppendStatusDecorations(parent, status, st.rect, st);
    if ((status & GCI_FOUL) > 0) text = 'F';
  }

  vbsAppendText(parent, text, st.rect, st);
}

function vbsPaintRect(parent, e, env) {
  var r = {
    x: vbsPickInt(e.rect.x, env.sel, 0),
    y: vbsPickInt(e.rect.y, env.sel, 0),
    w: vbsPickInt(e.rect.w, env.sel, 0),
    h: vbsPickInt(e.rect.h, env.sel, 0)
  };
  var c = vbsPickColor(e.color, env.sel, { a: 255, r: 0, g: 0, b: 0 });
  if (r.w <= 0 || r.h <= 0 || c.a <= 0) return;
  parent.appendChild(svgEl('rect', {
    x: r.x, y: r.y, width: r.w, height: r.h,
    fill: vbsCssColor(vbsMix(c)), 'fill-opacity': vbsMix(c).a / 255
  }));
}

// CMyXml::MakeLine: Pen(color, pen_width) from point1 to point2, colour black
// and both points 0,0 unless the XML says otherwise. A GDI+ pen of width 0 is
// still drawn, one pixel wide, which SVG would not draw at all.
function vbsPaintLine(parent, e, env) {
  var p1 = e.p1 || {};
  var p2 = e.p2 || {};
  var x1 = vbsPickInt(p1.x, env.sel, 0), y1 = vbsPickInt(p1.y, env.sel, 0);
  var x2 = vbsPickInt(p2.x, env.sel, 0), y2 = vbsPickInt(p2.y, env.sel, 0);
  var c = vbsPickColor(e.color, env.sel, { a: 255, r: 0, g: 0, b: 0 });
  if (c.a <= 0) return;
  var w = vbsPickFloat(e.penWidth, env.sel, 0);
  parent.appendChild(svgEl('line', {
    x1: x1, y1: y1, x2: x2, y2: y2,
    stroke: vbsCssColor(vbsMix(c)), 'stroke-opacity': vbsMix(c).a / 255,
    'stroke-width': w > 0 ? w : 1
  }));
}

// A picture's own bitmap clips what is painted on it - its layers are drawn
// INTO it (PlayLayers onto pBm) or onto a bitmap of its size (the "under"
// bitmap), and a bottom panel is painted into a bitmap of the panel's size. SVG
// clips nothing unless told, so text and boxes that run past a picture's edge
// were drawn here and not on the TV. One clip per size and render.
function vbsClipId(env, w, h) {
  var key = w + 'x' + h;
  if (env.clips[key]) return env.clips[key];
  var id = env.idPrefix + 'clip' + (env.clipSeq++);
  var cp = svgEl('clipPath', { id: id, clipPathUnits: 'userSpaceOnUse' });
  cp.appendChild(svgEl('rect', { x: 0, y: 0, width: w, height: h }));
  env.defs.appendChild(cp);
  env.clips[key] = id;
  return id;
}

// MyDrawImage(dest, src, rect, factor, trans): the WHOLE bitmap is drawn with the
// colour factor and the transparency - the layers painted into it included, not
// just the picture file under them. A group carries both, so they apply to
// everything in it as they do to the bitmap.
function vbsBitmapGroup(env, w, h, factor, trans) {
  var g = svgEl('g', { 'clip-path': 'url(#' + vbsClipId(env, w, h) + ')' });
  if (trans !== undefined && trans !== 1) g.setAttribute('opacity', Math.max(0, Math.min(1, trans)));
  if (factor !== undefined && factor !== 1) g.setAttribute('style', 'filter: brightness(' + factor + ')');
  return g;
}

// LinearGradientBrush(point1, point2, color1, color2) with SetWrapMode(mode).
// mode 1 is WrapModeTileFlipX, which is what spreadMethod="reflect" does.
function vbsPaintGradient(parent, e, env) {
  var r = {
    x: vbsPickInt(e.rect.x, env.sel, 0),
    y: vbsPickInt(e.rect.y, env.sel, 0),
    w: vbsPickInt(e.rect.w, env.sel, 0),
    h: vbsPickInt(e.rect.h, env.sel, 0)
  };
  if (r.w <= 0 || r.h <= 0) return;

  var p1 = { x: vbsPickInt(e.p1.x, env.sel, 0), y: vbsPickInt(e.p1.y, env.sel, 0) };
  var p2 = { x: vbsPickInt(e.p2.x, env.sel, 0), y: vbsPickInt(e.p2.y, env.sel, 0) };
  var c1 = vbsPickColor(e.p1.color, env.sel, { a: 255, r: 0, g: 0, b: 0 });
  var c2 = vbsPickColor(e.p2.color, env.sel, { a: 255, r: 0, g: 0, b: 0 });
  if (c1.a <= 0 && c2.a <= 0) return;

  var mode = vbsPickInt(e.mode, env.sel, 0);
  var spread = (mode === 0) ? 'repeat' : (mode === 4 ? 'pad' : 'reflect');

  var id = env.idPrefix + 'grad' + (env.gradientSeq++);
  var grad = svgEl('linearGradient', {
    id: id, gradientUnits: 'userSpaceOnUse',
    x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
    spreadMethod: spread
  });
  grad.appendChild(svgEl('stop', {
    offset: '0', 'stop-color': vbsCssColor(vbsMix(c1)), 'stop-opacity': vbsMix(c1).a / 255
  }));
  grad.appendChild(svgEl('stop', {
    offset: '1', 'stop-color': vbsCssColor(vbsMix(c2)), 'stop-opacity': vbsMix(c2).a / 255
  }));
  env.defs.appendChild(grad);

  parent.appendChild(svgEl('rect', {
    x: r.x, y: r.y, width: r.w, height: r.h, fill: 'url(#' + id + ')'
  }));
}

// Where a <file> resolves to, and the rule is the XML's own. protocol.xml writes
// a bare name for an image in the protocol's own folder and a full path for the
// shared ones under V3Gfx\Resource\Objects:
//
//   <file>Viking2001_Grid1-5_Active.png</file>
//   <file>c:\Viking2001\V3Gfx\Resource\Objects\MessageFrame.png</file>
//
// so the same distinction is drawn here: a bare name is relative to the
// protocol's imagePath, anything containing "/" is already a path and is used as
// it stands. It has to stay this way round because the runtime file names come
// from tokens - vbstokens.js answers "Regular.png", "Substitute.png",
// "RedPin172x86Enabled.png" - and those are always protocol-local. That is also
// why imageSize is per protocol: both themes ship a Regular.png, at 620x69 and
// 1849x174.
function vbsImageUrl(env, file) {
  return vbsIsLayoutUrl(file) ? file : vbsLayoutRelativeUrl(env.imagePath, file);
}

// CMyXml::PlayImage. The <id> only decides whether the element is drawn at all;
// the <file> may itself be a token (that is how #PLAYER_STATUS# works).
function vbsPaintPicture(parent, e, env) {
  var file = vbsPickString(e.file, env.sel, null);
  if (file && file.indexOf('#') >= 0) {
    var rf = vbsGetText(file, env.ctx, file);
    file = rf ? rf.text : '';
  }

  if (e.id !== undefined && e.id !== null) {
    var id = vbsPickString(e.id, env.sel, '');
    if (id.indexOf('#') >= 0) {
      var ri = vbsGetText(id, env.ctx, id);
      id = ri ? ri.text : id;
    }
    if (id === '') return;
  }

  // A picture with no file at all is a pure coordinate frame (Empty200x100.png)
  if (file === null && !e.nativeW) return;
  if (file === '') return;

  var r = {
    x: vbsPickInt(e.rect.x, env.sel, 0),
    y: vbsPickInt(e.rect.y, env.sel, 0),
    w: vbsPickInt(e.rect.w, env.sel, 0),
    h: vbsPickInt(e.rect.h, env.sel, 0)
  };
  if (r.w <= 0 || r.h <= 0) return;

  var size = (file && env.imageSize[file]) || [e.nativeW || r.w, e.nativeH || r.h];
  var nw = e.nativeW || size[0];
  var nh = e.nativeH || size[1];

  var factor = vbsPickFloat(e.colorFactor, env.sel, 1);
  var trans = vbsPickFloat(e.trans, env.sel, 1);

  // The element's own layers live in the image's pixel space, which is then
  // stretched into the rect - so one group carries that mapping for all of it.
  var g = svgEl('g', {
    transform: 'translate(' + r.x + ',' + r.y + ') scale(' + (r.w / nw) + ',' + (r.h / nh) + ')'
  });

  // CMyXml::PlayImage paints the before-layers only when there is a
  // layer_before_1, onto a bitmap of the picture's size that is then drawn into
  // the rect; the after-layers are painted into the picture itself.
  if (e.layer_before_1 !== undefined) {
    var under = vbsBitmapGroup(env, nw, nh, factor, trans);
    vbsPaintLayerList(under, vbsCollectLayers(e, 'layer_before_'), env);
    g.appendChild(under);
  }
  var bitmap = vbsBitmapGroup(env, nw, nh, factor, trans);
  if (file) bitmap.appendChild(svgImage(vbsImageUrl(env, file), 0, 0, nw, nh, 1, 1));
  vbsPaintLayerList(bitmap, vbsCollectLayers(e, 'layer_after_'), env);
  g.appendChild(bitmap);

  parent.appendChild(g);
}

// PaintThings order inside one layer: pictures, gradients, rectangles, lines,
// then texts. Source order within each kind is preserved.
function vbsPaintLayer(parent, elements, env) {
  if (!elements) return;
  var kinds = ['picture', 'gradient', 'rect', 'line', 'text'];
  for (var ki = 0; ki < kinds.length; ki++) {
    for (var i = 0; i < elements.length; i++) {
      var e = elements[i];
      if (e.k !== kinds[ki]) continue;
      if (e.k === 'picture') vbsPaintPicture(parent, e, env);
      else if (e.k === 'gradient') vbsPaintGradient(parent, e, env);
      else if (e.k === 'rect') vbsPaintRect(parent, e, env);
      else if (e.k === 'line') vbsPaintLine(parent, e, env);
      else if (e.k === 'text') vbsPaintText(parent, e, env);
    }
  }
}

function vbsPaintLayerList(parent, layers, env) {
  for (var i = 0; i < layers.length; i++) vbsPaintLayer(parent, layers[i], env);
}

// PlayLayers walks layer_<before|after>_1 .. _21 in order, and on past 21 for as
// long as the next one exists.
function vbsCollectLayers(node, prefix) {
  var out = [];
  for (var n = 1; ; n++) {
    var l = node[prefix + n];
    if (l) out.push(l);
    else if (n > 21) break;
  }
  return out;
}

// --- BitmapFromXml ------------------------------------------------------

function vbsRenderProtocol(svg, protocol, json, options) {
  options = options || {};
  var ctx = vbsMakeContext(json, options);
  var lane = ctx.lane;

  // The VBS-T OnScoring layout is not merged here any more: the C++ splices its
  // TEXT into the protocol's before anything is parsed, and that is done by
  // vbsMergeOnScoring (vbsprotocol.js), so `protocol` already carries it.

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  var width = protocol.x_generate;
  var height = protocol.y_generate;

  var defs = svgEl('defs');
  svg.appendChild(defs);

  var env = {
    ctx: ctx,
    // CMyXml keeps the text attributes in members of the object that renders,
    // and the lane's one CGame renders every time - so a render starts with what
    // the last one ended on, not with the constructor's values. Carried the same
    // way here, across every render on the page.
    state: vbsPaintStateCarry || (vbsPaintStateCarry = vbsNewPaintState()),
    // m_whenSemiColonGetValue is set from noPlayers - 1 and m_whenPipeGetValue
    // from the active frame; both are re-set per player inside the loop.
    sel: { semi: lane.noPlayers > 0 ? lane.noPlayers - 1 : 0, pipe: 0 },
    defs: defs,
    gradientSeq: 0,
    // The page holds more than one sheet (the screen and the copy rasterised for
    // the file), and an id is looked up in the whole document - so every id a
    // render makes carries its SVG's own name, or a url(#...) can find the other
    // sheet's gradient or clip.
    idPrefix: (svg.id || 'vbs') + '_',
    clipSeq: 0,
    clips: {},
    imagePath: protocol.imagePath || '',
    // Per protocol, not global: two themes ship a Regular.png of different sizes,
    // and the size is the coordinate space an element's sub-layers live in.
    imageSize: protocol.imageSize || {}
  };

  // Bottom panels are measured before anything is drawn, because BitmapFromXml
  // grows the background bitmap to y_generate + the panels' total height and the
  // background is then stretched over the whole of it. m_playerBeeingProcessed is
  // 0 for this pass, as it is in the C++.
  ctx.playerBeingProcessed = 0;
  var panels = vbsCollectBottomPanels(protocol, ctx, env.sel);
  var panelHeight = 0;
  for (var pn = 0; pn < panels.length; pn++) {
    // y_generate can be a ";" list selected by player count - the OnScoring
    // layouts use "90;90;90;90;60" - so it goes through the same picker as
    // every other value rather than being read as a plain number.
    panels[pn].height = vbsPickInt(panels[pn].y_generate, env.sel, 0);
    panelHeight += panels[pn].height;
  }

  // The composition grows with its panels exactly as BitmapFromXml grows its
  // bitmap - Viking 640x480 becomes 640x550 once the team-sums strip is on.
  var totalHeight = height + panelHeight;

  // The page is always a 1080p image and the composition fills it edge to edge,
  // whatever the protocol's own resolution is - which is what the lane TV shows:
  // RenderScreen2 stretches the finished bitmap to 960x540 (ResizeBitmap, aspect
  // not kept). The two axes therefore scale by different factors (Viking 640x550
  // becomes 1920x1080, so 3.0 across and 1.96 down), and glyphs, pictures and
  // lines are all stretched alike, as they are on the TV.
  var stageScaleX = VBS_CANVAS_WIDTH / width;
  var stageScaleY = VBS_CANVAS_HEIGHT / totalHeight;
  env.state.xCompensate = 1;

  svg.setAttribute('viewBox', '0 0 ' + VBS_CANVAS_WIDTH + ' ' + VBS_CANVAS_HEIGHT);

  if (options.background)
    svg.appendChild(svgImage(options.background, 0, 0, VBS_CANVAS_WIDTH, VBS_CANVAS_HEIGHT, 1, 1));

  // Everything the protocol draws goes inside this group; nothing below this
  // point appends to the svg element directly.
  var stage = svgEl('g', {
    transform: 'scale(' + stageScaleX + ',' + stageScaleY + ')'
  });
  svg.appendChild(stage);

  // m_whenPipeGetValue is set before the root before-layers, at the top of every
  // player, and is left at the last player's for everything after the loop - and
  // only when there are players at all; otherwise it stays 0.
  var pipeFlags = {
    first: vbsPickInt(protocol.use_first_player, env.sel, 0),
    last: vbsPickInt(protocol.use_last_player, env.sel, 0),
    current: vbsPickInt(protocol.use_current_player, env.sel, 0)
  };
  var hasPlayers = lane.noPlayers > 0;

  // Root before-layers: frame numbers and the play-time box.
  ctx.playerBeingProcessed = 0;
  env.sel.pipe = hasPlayers ? vbsFramePipe(ctx, 0, pipeFlags) : 0;
  vbsPaintLayerList(stage, vbsCollectLayers(protocol, 'layer_before_'), env);

  // One row per player, stacked from y_start downwards.
  var ypos = vbsPickInt(protocol.y_start, env.sel, 0);

  for (var p = 0; p < lane.noPlayers; p++) {
    ctx.playerBeingProcessed = p;

    // #THIS_PLAYER_ACTIVE#: in cross lane play the bowler up on the partner lane
    // counts as active here too, so two rows can be active at once.
    var active = vbsIsPlayerActive(lane, p);
    var row = active ? protocol.active_player : protocol.inactive_player;
    env.sel.pipe = vbsFramePipe(ctx, p, pipeFlags);
    if (!row) continue;

    // "grid.png" when the row names no file, as BitmapFromXml has it.
    var file = vbsPickString(row.file, env.sel, 'grid.png');
    var size = env.imageSize[file];

    var yScale = vbsPickFloat(row.y_scale, env.sel, 1.5);
    var xpos = vbsPickInt(row.xpos, env.sel, 3);
    var factor = vbsPickFloat(row.color_factor, env.sel, 1);
    var trans = vbsPickFloat(row.image_tranparancy, env.sel, 1);

    var pre = vbsPickInt(row.y_pre_addon, env.sel, 0);
    if (p > 0) ypos += pre;            // the first player's pre-addon is ignored

    // A row picture GDI+ cannot open is a Bitmap of no size: nothing of the row
    // is drawn, its layers included, and it adds no height - only its addons.
    if (size) {
      var nw = size[0];
      var nh = size[1];

      // MyDrawImage gets an integer destination height, so the row is stretched by
      // the truncated ratio rather than by y_scale itself - otherwise the drawn row
      // and the ypos advance below would disagree by up to a pixel per player.
      var drawnHeight = Math.floor(nh * yScale);
      var g = svgEl('g', {
        transform: 'translate(' + xpos + ',' + ypos + ') scale(1,' + (drawnHeight / nh) + ')'
      });

      // layer_before_* paints on its own transparent bitmap of the grid's size,
      // drawn first, and only when there is a layer_before_1; layer_after_* paints
      // into the grid image itself. Both bitmaps go on with the row's colour
      // factor and transparency, and both clip what is painted on them.
      if (row.layer_before_1 !== undefined) {
        var under = vbsBitmapGroup(env, nw, nh, factor, trans);
        vbsPaintLayerList(under, vbsCollectLayers(row, 'layer_before_'), env);
        g.appendChild(under);
      }
      var bitmap = vbsBitmapGroup(env, nw, nh, factor, trans);
      bitmap.appendChild(svgImage(vbsImageUrl(env, file), 0, 0, nw, nh, 1, 1));
      vbsPaintLayerList(bitmap, vbsCollectLayers(row, 'layer_after_'), env);
      g.appendChild(bitmap);

      stage.appendChild(g);
      ypos += drawnHeight;
    }

    ypos += vbsPickInt(row.y_post_addon, env.sel, 0);
  }

  // BitmapFromXml leaves m_playerBeeingProcessed at noPlayers when the loop
  // ends, and the root after-layers are resolved with that value.
  ctx.playerBeingProcessed = lane.noPlayers;
  vbsPaintLayerList(stage, vbsCollectLayers(protocol, 'layer_after_'), env);

  // ... and the panels last, each painted into a bitmap of its own - x_generate
  // wide, its own height, so it clips - and blitted at y_generate + the panels
  // already placed.
  var panelY = height;
  for (var k = 0; k < panels.length; k++) {
    var pg = svgEl('g', { transform: 'translate(0,' + panelY + ')' });
    var pbm = vbsBitmapGroup(env, width, panels[k].height, 1, 1);
    vbsPaintLayer(pbm, panels[k].elements, env);
    pg.appendChild(pbm);
    stage.appendChild(pg);
    panelY += panels[k].height;
  }

  return ctx;
}

// The text attributes carried from one render to the next; see env.state.
var vbsPaintStateCarry = null;
// bottom_panel_1..98, in order. A panel is drawn only when its <id> resolves to a
// non-empty string, or when the id holds no token at all (the OnScoring layouts
// use a plain name such as "VBS", which is always on). That gate is the whole
// mechanism behind the team-sums panel appearing only for lane-sum games:
// #TFSUM# resolves empty when CalcStatusLine declines to produce a value.
// The id is read like every other value, so a ";" list picks its column by the
// number of bowlers first.
function vbsCollectBottomPanels(protocol, ctx, sel) {
  var out = [];
  for (var n = 1; n < 99; n++) {
    var panel = protocol['bottom_panel_' + n];
    if (!panel) continue;
    var id = vbsPickString(panel.id, sel, '');
    if (id.indexOf('#') >= 0) {
      var r = vbsGetText(id, ctx, '');
      if (!r || r.text === '') continue;
    }
    out.push(panel);
  }
  return out;
}

// m_whenPipeGetValue for the player being drawn, the way BitmapFromXml works it
// out: #ACTIVE_FRAME# - the frame of that player - unless the protocol says
// use_first_player (#ACTIVE_FIRST_FRAME#), and then use_last_player and
// use_current_player each override what came before. A token that answers
// nothing leaves the previous answer, as it leaves the C++ buffer.
function vbsFramePipe(ctx, playerIndex, flags) {
  var saved = ctx.playerBeingProcessed;
  ctx.playerBeingProcessed = playerIndex;
  var text = '';
  var take = function (token) {
    var r = vbsGetText(token, ctx);
    if (r) text = r.text;
  };
  take(flags && flags.first > 0 ? '#ACTIVE_FIRST_FRAME#' : '#ACTIVE_FRAME#');
  if (flags && flags.last > 0) take('#ACTIVE_LAST_FRAME#');
  if (flags && flags.current > 0) take('#ACTIVE_CURRENT_FRAME#');
  ctx.playerBeingProcessed = saved;
  return parseInt(text, 10) || 0;
}

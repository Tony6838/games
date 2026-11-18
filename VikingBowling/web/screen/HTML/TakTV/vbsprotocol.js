// ---------------------------------------------------------------------------
// vbsprotocol.js - load a protocol theme at runtime.
//
// protocol_viking.js and protocol_viking_refresh.js are hand transcriptions of
// two themes. Twenty-one ship, and a customer can add more, each with its own
// practice.xml and shortgames2..5.xml variants - so transcribing does not scale
// and a new theme would need new JavaScript. This reads the theme's own XML
// instead, exactly as GDI_plus_helper::BitmapFromXml does, and builds the same
// object shape the transcriptions produce. Every element kind the shipped themes
// use is already understood by the parser in vbsonscoring.js: picture,
// true_type_text, rectangle_fill, gradient_fill, draw_line, import,
// active_player, inactive_player and bottom_panel_<n>.
//
// It runs entirely in the browser against files the slave serves, so a web
// client can render a lane with nothing but the slave: the lane data, the theme
// folder and the images, all under the same root. Nothing here needs the
// reception.
//
// Four behaviours of the C++ are reproduced deliberately:
//
//  1. Imports are textual and recursive. GDI_plus_helper::ReadXmlFile replaces
//     <import>X.xml</import> with the whole text of X.xml before anything is
//     parsed, so an imported file is a bare list of elements rather than a
//     document. The same splice happens here.
//  2. The text is parsed the way xml_michael parses it (vbsxml.js), not by
//     DOMParser, which refuses a third of the themes and layouts that ship.
//  3. Where a name occurs twice, the FIRST one is used - GetChildName stops at
//     it. A theme may well carry two layer_after_2 (Halloween does), and a
//     VBS-T layout spliced in at the end may repeat one of the theme's names;
//     the second is never drawn.
//  4. Image sizes come from the images. BitmapFromXml asks GDI+ for a picture's
//     natural size and uses it as the coordinate space of that element's
//     sub-layers. The browser only knows it once the image has decoded, so every
//     picture a theme names is loaded before the protocol is handed back - which
//     is why this is a promise and why the transcriptions carry a hardcoded
//     IMAGE_SIZE table instead.
// ---------------------------------------------------------------------------

/* global vbsFetch1252, vbsWinPathToUrl, vbsElementsFromNode, vbsParseXml, vbsIsLayoutUrl,
   vbsLayoutRelativeUrl */
/* exported vbsLoadProtocol, vbsSetPinsOnScoring, vbsMergeOnScoring */

var VBS_PROTOCOLS_URL = '../../../../v3gfx/Protocols/';

// v3GfxPinsOnScoring: which style the small pin rack on the sheet is drawn with.
// It names a folder under V3GFX\Resource\Pins_On_Protocol - eleven ship, and a
// hall picks one in the reception's Video3 page - and an empty value means the
// hall wants no rack at all, which is what ScorerSettings defaults to. A browser
// cannot read the registry, so the page is told; see the #PINS_ON_PROTOCOL#
// block in vbsResolveImports for what it is used for, and
// vbsPinsStyleCandidates for why the style drawn can be another one.
var vbsPinsOnScoring = '';

// Returns whether the value actually changed, because a protocol already parsed
// has the old rack spliced into it and the caller has to load it again.
//
// Only a plain folder name is accepted, the same guard BuildHtmlPayload applies
// before sending it. The slave's copy cannot carry a separator, but ?pins= is
// typed into the address bar, and a name holding one would not select a style
// that exists - it would build a path pointing somewhere else entirely.
function vbsSetPinsOnScoring(style) {
  var next = String(style === undefined || style === null ? '' : style).trim();
  if (/[\\/"]/.test(next)) next = '';

  if (next === vbsPinsOnScoring) return false;
  vbsPinsOnScoring = next;
  return true;
}

// The setting is hall-wide, but its styles are laid out in a protocol's own
// pixels - 640 or 1920 wide - and the protocols are per lane, with VBS-T games
// on the competition protocol besides. The rack is spliced into the protocol
// here exactly as on the lane TV, so a style for the other width lands in the
// wrong place here too. So the style is chosen per protocol, the same way
// OpenPlay does it (PinsStyleForProtocol in Slave/OPENPLAY/Game.cpp, r17928):
// the configured one when it fits, else the same style in the other width, else
// the nearest look from the table below, else the configured one as before.
// Keep the two in step - the lane TV and this page must draw the same rack.
//
// Which width a style is for is in its name: "_FHD" is 1920, except Default,
// which is laid out for 1920 without saying so. Anything else is 640.
function vbsPinsStyleIsFullHd(style) {
  var lower = String(style).toLowerCase();
  return lower === 'default' || (lower.length > 4 && lower.slice(-4) === '_fhd');
}

// c_pinsStyleNearest in Game.cpp, decided from the images: the Brunswick pin
// styles and Triangle_FHD draw the same pin picture, Standard_FHD and Default
// draw blue pins, the round styles go to the round style of the other width.
var VBS_PINS_STYLE_NEAREST = [
  ['Brunswick_Pins_Table', 'Triangle_FHD'],
  ['Pins_In_Frame', 'Triangle_FHD'],
  ['Round_Small', 'Round_Small_Numbers_FHD'],
  ['Round_Medium_Numbers_FHD', 'Round_Big_Numbers'],
  ['Triangle_FHD', 'Brunswick_Pins_Table'],
  ['Standard_FHD', 'Brunswick_Pins_Table'],
  ['Default', 'Brunswick_Pins_Table']
];

// The styles to try for a protocol `width` pixels wide, best first - the C++
// asks whether each style folder exists, this page fetches each in turn and
// takes the first that loads, which answers the same question. The configured
// style is always last. A width of 0 (no <x_generate> to read) changes
// nothing, as in the C++.
function vbsPinsStyleCandidates(configured, width) {
  if (!configured || !(width > 0)) return [configured];
  var fullHd = width >= 1280;     // a number, not "1920": Xmas Left/Right are 2120
  if (vbsPinsStyleIsFullHd(configured) === fullHd) return [configured];

  var out = [];
  var add = function (style) {
    if (vbsPinsStyleIsFullHd(style) === fullHd && out.indexOf(style) < 0) out.push(style);
  };
  if (fullHd) add(configured + '_FHD');
  else if (/_fhd$/i.test(configured)) add(configured.slice(0, -4));
  VBS_PINS_STYLE_NEAREST.forEach(function (pair) {
    if (pair[0].toLowerCase() === configured.toLowerCase()) add(pair[1]);
  });
  out.push(configured);
  return out;
}

// One console line per configured style and width, like the lane TV's one INFO
// line per substitution - a protocol is loaded again whenever a lane changes
// layout, and the answer does not change.
var vbsPinsStyleLogged = {};

function vbsPinsOnProtocolUrl(style) {
  return vbsWinPathToUrl('C:\\Viking2001\\V3GFX\\Resource\\Pins_On_Protocol\\' + style + '\\Pins_On_Protocol.xml');
}

// The text #PINS_ON_PROTOCOL# is replaced with: the Pins_On_Protocol.xml of the
// style chosen for this width, or nothing when the hall has no rack or no
// candidate loads - a missing import is not fatal in the C++ either.
function vbsLoadPinsOnProtocol(width) {
  var configured = vbsPinsOnScoring;
  if (!configured) return Promise.resolve('');

  var candidates = vbsPinsStyleCandidates(configured, width);
  var logKey = configured + '|' + width;

  function attempt(i) {
    if (i >= candidates.length) return Promise.resolve('');
    return vbsFetch1252(vbsPinsOnProtocolUrl(candidates[i])).then(function (text) {
      var style = candidates[i];
      if (window.console && !vbsPinsStyleLogged[logKey]) {
        vbsPinsStyleLogged[logKey] = true;
        if (style !== configured) {
          console.info('Pin display "' + configured + '" does not fit a protocol ' + width +
                       ' wide, drawing "' + style + '" instead');
        } else if (candidates.length > 1) {
          console.warn('Pin display "' + configured + '" does not fit a protocol ' + width +
                       ' wide and no style of that width is installed to use instead');
        }
      }
      return text;
    }, function () {
      return attempt(i + 1);
    });
  }
  return attempt(0);
}

// The URL of an imported file. GDI_plus_helper::CacheLoadTxt tries the name as
// it stands and then the layout's own folder in front of it, so a path with a
// drive letter is absolute (that is how #PINS_ON_PROTOCOL# arrives) and
// anything else - "Header.xml", or "onScoringXml\2 Lag BanP Tot.xml", which a
// VBS-T layout uses to pull in the theme's own copy - belongs to the folder.
function vbsImportUrl(name, dir) {
  if (/^[a-zA-Z]:/.test(name)) return vbsWinPathToUrl(name);
  return vbsLayoutRelativeUrl(dir, name);     // "/theme/halloween_before.xml" too
}

// Replaces a piece of text with another taken literally - String.replace with a
// string would read "$&" and friends in the imported text as patterns.
function vbsReplaceLiteral(text, what, by) {
  return text.replace(what, function () { return by; });
}

// <import>Name.xml</import>, recursively, before the document is parsed - the
// text is ReadXmlFile's, so the name is taken exactly as written between the
// tags, untrimmed: a name the C++ cannot open is a name nothing is drawn from.
// The count is of imports spliced, not of nesting: each pass replaces one and
// recurses, and protocol.xml alone carries nine before its own imports are
// followed. The cap only exists so a file that imports itself cannot spin
// forever - the C++ loop has no guard at all and would hang.
// width is the <x_generate> of the file being loaded, 0 when it has none; only
// the pin rack needs it.
function vbsResolveImports(text, dir, spliced, width) {
  if (spliced > 200) return Promise.resolve(text);

  var open = text.indexOf('<import>');
  if (open < 0) return Promise.resolve(text);
  var close = text.indexOf('</import>', open);
  if (close < 0) return Promise.resolve(text);

  var name = text.substring(open + '<import>'.length, close);
  var whole = text.substring(open, close + '</import>'.length);

  // #PINS_ON_PROTOCOL# is the small rack of the pins left standing, drawn on the
  // sheet itself rather than over it. It is a style folder rather than a file:
  // CGame::GetText answers the token with
  // V3GFX\Resource\Pins_On_Protocol\<style>\Pins_On_Protocol.xml, the style
  // being v3GfxPinsOnScoring as chosen for this protocol's width (see
  // vbsPinsStyleCandidates), and with nothing when that setting is empty, in
  // which case the theme simply has no rack. Spliced here exactly as the C++
  // splices it.
  if (name === '#PINS_ON_PROTOCOL#') {
    return vbsLoadPinsOnProtocol(width).then(function (imported) {
      return vbsResolveImports(vbsReplaceLiteral(text, whole, imported), dir, spliced + 1, width);
    });
  }

  // Any other token import - #XTRA#, where some think the VBS-T layout goes -
  // CGame::GetText answers with nothing, so ReadXmlFile imports nothing.
  if (name === '' || name.indexOf('#') >= 0) {
    return vbsResolveImports(vbsReplaceLiteral(text, whole, ''), dir, spliced + 1, width);
  }

  return vbsFetch1252(vbsImportUrl(name, dir)).then(function (imported) {
    return vbsResolveImports(vbsReplaceLiteral(text, whole, imported), dir, spliced + 1, width);
  }, function () {
    // A missing import is not fatal in the C++ either - ReadXmlFile returns an
    // empty string and the layout simply lacks that part.
    return vbsResolveImports(vbsReplaceLiteral(text, whole, ''), dir, spliced + 1, width);
  });
}

// GetIntContens/GetStringContens on a direct child: the first of the name, and
// undefined when it is absent or has no text - both of which leave the C++
// caller's value as it was.
function vbsXmlScalar(root, tag) {
  for (var i = 0; i < root.children.length; i++) {
    if (root.children[i].nodeName === tag) return root.children[i].textContent;
  }
  return undefined;
}

// <active_player> / <inactive_player>: the row drawn per player. Same fields the
// transcriptions carry, read straight off the node - plus the two BitmapFromXml
// reads for the row picture and the transcriptions never needed: color_factor,
// and the transparency, which the C++ asks for as "image_tranparancy" (sic; the
// correctly spelt one is read by nothing).
function vbsRowFromNode(node) {
  if (!node) return undefined;
  var row = {};
  ['file', 'y_pre_addon', 'y_post_addon', 'xpos', 'y_scale', 'color_factor', 'image_tranparancy'].forEach(function (tag) {
    var v = vbsXmlScalar(node, tag);
    if (v !== undefined) row[tag] = v.replace(/[\t\r\n]/g, '');   // my_trimmed's set, not spaces
  });
  for (var i = 0; i < node.children.length; i++) {
    var child = node.children[i];
    if (/^layer_(before|after)_\d+$/.test(child.nodeName) && row[child.nodeName] === undefined) {
      row[child.nodeName] = vbsElementsFromNode(child);
    }
  }
  return row;
}

// Every picture name a theme can draw, so their natural sizes can be measured
// before the first render. A <file> may be a ";" list selected by player count
// or a "|" list selected by the active frame, and may be a token that resolves
// to a name at draw time - those are collected too, since the token's answers
// are file names in the same folder.
function vbsCollectFileNames(node, out) {
  if (!node) return out;
  if (Object.prototype.toString.call(node) === '[object Array]') {
    for (var i = 0; i < node.length; i++) vbsCollectFileNames(node[i], out);
    return out;
  }
  if (typeof node !== 'object') return out;

  if (typeof node.file === 'string' && node.file.indexOf('#') < 0) {
    node.file.split(';').forEach(function (part) {
      part.split('|').forEach(function (name) {
        var n = name.trim();
        if (n) out[n] = true;
      });
    });
  }
  for (var key in node) {
    if (node.hasOwnProperty(key) && typeof node[key] === 'object') vbsCollectFileNames(node[key], out);
  }
  return out;
}

// The natural size of each image, keyed by the string the layout uses - which is
// what vbsPaintPicture looks up. A name that will not load is left out; the
// renderer then falls back to the element's rect, as it does for a picture whose
// size it does not know.
function vbsMeasureImages(names, dir) {
  var keys = Object.keys(names);
  return Promise.all(keys.map(function (name) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve([name, [img.naturalWidth, img.naturalHeight]]); };
      img.onerror = function () { resolve(null); };
      // The same rule the picture is drawn by - vbsIsLayoutUrl.
      img.src = vbsIsLayoutUrl(name) ? name : vbsLayoutRelativeUrl(dir, name);
    });
  })).then(function (pairs) {
    var sizes = {};
    pairs.forEach(function (p) { if (p) sizes[p[0]] = p[1]; });
    return sizes;
  });
}

// theme is the folder name under V3GFX\Protocols, e.g. "Viking" - which is what
// the slave now stamps into the lane file. xmlFile defaults to protocol.xml;
// RenderScreen2 picks practice.xml or shortgames2..5.xml instead for those game
// modes, borrows the Standard theme's when the theme does not ship one, and
// falls back to protocol.xml when Standard has none either.
// dirOverride names the folder outright, for a layout that is not a protocol
// theme - V3GFX\Resource\ShowPins\ShowPins.xml, the full-screen picture of the
// pins left standing, is loaded that way. Everything else about it is the same:
// same imports, same elements, same measuring pass.
function vbsLoadProtocol(theme, xmlFile, dirOverride) {
  var dir = dirOverride || (VBS_PROTOCOLS_URL + encodeURIComponent(theme) + '/');
  var file = xmlFile || 'protocol.xml';

  return vbsFetch1252(dir + file)
    .catch(function (error) {
      // A caller that named the folder asked for one specific layout; there is
      // no protocol.xml beside it to fall back to.
      if (dirOverride) throw error;
      // The layout this game asked for is not in the lane's theme - the normal
      // case: only a few themes ship a practice.xml or shortgames*.xml at all.
      // RenderScreen2 then borrows the Standard theme's - the whole folder, since
      // the layout imports its siblings and names its own pictures - and only
      // when Standard has none either (or this IS Standard) draws protocol.xml.
      if (file === 'protocol.xml') throw error;
      var standardDir = VBS_PROTOCOLS_URL + 'Standard/';
      var fromStandard = (String(theme).trim().toLowerCase() === 'standard')
        ? Promise.reject(error)
        : vbsFetch1252(standardDir + file).then(function (text) { dir = standardDir; return text; });
      return fromStandard.catch(function () {
        if (window.console) console.warn('Protocol layout missing, using protocol.xml instead: ' + dir + file);
        return vbsFetch1252(dir + 'protocol.xml');
      });
    })
    .then(function (text) {
      // The width the pin rack has to fit, read before anything is spliced in -
      // as OpenPlay's ProtocolThemeWidth reads it, the first <x_generate> as a
      // number. Every file that imports the rack states its own.
      var width = /<x_generate>\s*(\d+)/.exec(text);
      width = width ? parseInt(width[1], 10) : 0;
      return vbsResolveImports(text, dir, 0, width).then(function (resolved) {
        return vbsProtocolFromText(theme, dir, resolved, width);
      });
    });
}

// The parsed protocol, from the text with every import already in it. The text
// and the width stay on the object so a VBS-T layout can be spliced into the
// same text later (vbsMergeOnScoring).
function vbsProtocolFromText(theme, dir, text, width) {
  var root = vbsParseXml(text);        // xml_michael's root: the last top-level element
  var protocol = {
    name: theme,
    imagePath: dir,
    text: text,
    width: width,
    x_generate: parseInt(vbsXmlScalar(root, 'x_generate'), 10) || 640,
    y_generate: parseInt(vbsXmlScalar(root, 'y_generate'), 10) || 480
  };

  ['y_start', 'use_first_player', 'use_last_player', 'use_current_player'].forEach(function (tag) {
    var v = vbsXmlScalar(root, tag);
    if (v !== undefined) protocol[tag] = v.replace(/[\t\r\n]/g, '');
  });

  // The first of each name, as GetChildName finds it; a later one is never drawn.
  for (var i = 0; i < root.children.length; i++) {
    var node = root.children[i];
    var nodeName = node.nodeName;
    if (protocol[nodeName] !== undefined) continue;

    if (/^layer_(before|after)_\d+$/.test(nodeName)) {
      protocol[nodeName] = vbsElementsFromNode(node);
    } else if (/^bottom_panel_\d+$/.test(nodeName)) {
      protocol[nodeName] = {
        id: vbsXmlScalar(node, 'id'),
        y_generate: vbsXmlScalar(node, 'y_generate'),
        elements: vbsElementsFromNode(node)
      };
    } else if (nodeName === 'active_player' || nodeName === 'inactive_player') {
      protocol[nodeName] = vbsRowFromNode(node);
    }
  }

  var names = vbsCollectFileNames(protocol, {});
  // A row that names no picture is drawn with grid.png (BitmapFromXml's default).
  ['active_player', 'inactive_player'].forEach(function (row) {
    if (protocol[row] && protocol[row].file === undefined) names['grid.png'] = true;
  });
  return vbsMeasureImages(names, dir).then(function (sizes) {
    protocol.imageSize = sizes;
    return protocol;
  });
}

// A VBS-T OnScoring layout put into a loaded protocol the way
// GDI_plus_helper::CacheLoadXml does it: the layout's own imports resolved
// against the theme's folder (ReadXmlFile runs with the theme as its XML path -
// that is how "onScoringXml\2 Lag BanP Tot.xml" finds the theme's own copy), the
// text inserted just before the first </protocol>, and the whole parsed again.
// A layout name the theme already has stays the theme's. Resolves to a new
// protocol; the one passed in is not touched.
function vbsMergeOnScoring(protocol, layoutText) {
  return vbsResolveImports(String(layoutText || ''), protocol.imagePath, 0, protocol.width).then(function (extra) {
    var end = protocol.text.indexOf('</protocol>');
    if (end < 0) {
      if (window.console) console.warn('OnScoring layout not merged, the layout has no </protocol>: ' + protocol.name);
      return protocol;
    }
    var merged = protocol.text.substring(0, end) + extra + protocol.text.substring(end);
    return vbsProtocolFromText(protocol.name, protocol.imagePath, merged, protocol.width);
  });
}

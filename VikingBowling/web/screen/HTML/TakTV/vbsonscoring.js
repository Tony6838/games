// ---------------------------------------------------------------------------
// vbsonscoring.js - the VBS-T "OnScoring" overlay, and the element reader the
// protocol loader shares with it.
//
// For a tournament game the XML protocol pulls in two files that are no part of
// the protocol at all, and this loads the same pair:
//
//   \\<reception>\c$\viking2001\Reception\vbsTournaments\<leaguePath>.xml
//       The layout: team names and team points, the lane-pair diff boxes under
//       the sheet, the "Lag Diff" and Pari boxes. GDI_plus_helper::CacheLoadXml
//       reads it (imports resolved, against the competition theme's folder) and
//       splices its text into the protocol XML just before the first
//       </protocol> (shared/graphics/MyGdiPlus.cpp) - the <import>#XTRA#</import>
//       the C++ also looks for never survives: ReadXmlFile has already replaced
//       it with nothing by then. vbsprotocol.js does the same splice.
//
//   c:\viking2001\GameCtrl\VBST_<leaguePath>.ini
//       The live values. CGame::GetText resolves #VBST_JOB_text<n># with
//       GetPrivateProfileString("text<n>", "text", ...) (Slave/OPENPLAY/Game.cpp),
//       so section "text6", key "text".
//
// Both are found from GCI_PLAYERSTRUCT::amrLeague::leaguePath, which the lane
// file already carries.
//
// The layout is *generated per tournament* by the VBSTournament plugin - it
// copies one of the templates under Reception\vbsTournaments\OnScoringXml - so
// it is data, not a fixed design, and is parsed here at runtime.
//
// Where the layout lives: on the reception, and nowhere else - OpenPlay reads it
// over the reception's share. A slave serving this page has no copy, so the page
// asks LoadCom for it (/html/onscoring?lane=<n>, which reads the same UNC path
// OpenPlay does) and falls back to the file under its own root, which is where
// it is when the page is served by the reception (its WebView2 dialogs) or by a
// test server rooted at the reception's C:\Viking2001.
// ---------------------------------------------------------------------------

/* global vbsParseXml */
/* exported vbsLoadOnScoringText, vbsLoadOnScoringValues, vbsWinPathToUrl, vbsParseIni,
   vbsIsLayoutUrl, vbsLayoutRelativeUrl,
   vbsElementsFromNode, vbsElementFromNode, vbsXmlChild, vbsXmlText */

// Everything the page reaches lives under C:\Viking2001, and the page sits four
// levels below it. The XML writes absolute Windows paths for shared images
// (C:\Viking2001\v3gfx\Resource\Objects\MessageFrameFilled.png); they have to
// become page-relative URLs. A path that is not under the install root is left
// alone - it would not be reachable anyway, and passing it through unchanged
// makes that visible as a broken image rather than a silent wrong one.
var VBS_ROOT_URL = '../../../../';

// Where a picture or an import names a file, the C++ decides between two cases:
// CMyXml::PlayImage uses a name with a backslash in it as it stands, and puts
// the layout's own folder in front of anything else - so "Regular.png",
// "Theme/Bat1.png" and "/Theme/Bat1.png" (Halloween writes them that way) are
// all files of the theme. A name already turned into a URL - a Windows path
// under C:\Viking2001, or a URL a token answered with - is used as it is.
function vbsIsLayoutUrl(s) {
  s = String(s || '');
  return s.indexOf('\\') >= 0 || s.indexOf(VBS_ROOT_URL) === 0 || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s);
}

function vbsLayoutRelativeUrl(dir, name) {
  var parts = String(name).replace(/^[\\/]+/, '').split(/[\\/]/);
  return dir + parts.map(encodeURIComponent).join('/');
}

function vbsWinPathToUrl(winPath) {
  if (!winPath) return winPath;
  var p = String(winPath).replace(/\\/g, '/');
  var lower = p.toLowerCase();
  var root = 'c:/viking2001/';
  if (lower.indexOf(root) === 0) return VBS_ROOT_URL + p.substring(root.length);
  return p;
}

// The rig's data files are Windows-1252, not UTF-8 - see the encoding rules in
// the repo's CLAUDE.md, which keep runtime data files in their original code
// page. Team names carry a o with umlaut and the like, so decode explicitly
// rather than letting fetch() assume UTF-8 and produce U+FFFD.
function vbsFetch1252(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.arrayBuffer();
  }).then(function (buf) {
    return new TextDecoder('windows-1252').decode(buf);
  });
}

// --- the INI ---------------------------------------------------------------

// GetPrivateProfileString semantics, as far as this file needs them: [section]
// headers and key=value lines, names compared without regard to case, the FIRST
// section and the first key of a name winning, the value trimmed and a pair of
// quotes around it removed, ';' comment lines ignored. Returns a flat
// { "text1": "16", "text9": "Hemmalag" } keyed by the section name in lower
// case, since every section here carries exactly one key called "text".
function vbsParseIni(content) {
  var out = {};
  var section = null;
  var lines = String(content).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === '' || line.charAt(0) === ';') continue;
    if (line.charAt(0) === '[') {
      var end = line.indexOf(']');
      section = end > 0 ? line.substring(1, end).trim().toLowerCase() : null;
      continue;
    }
    var eq = line.indexOf('=');
    if (eq < 0 || section === null) continue;
    if (line.substring(0, eq).trim().toLowerCase() !== 'text') continue;
    if (Object.prototype.hasOwnProperty.call(out, section)) continue;
    var value = line.substring(eq + 1).trim();
    if (value.length >= 2 && (value.charAt(0) === '"' || value.charAt(0) === "'") &&
        value.charAt(value.length - 1) === value.charAt(0))
      value = value.substring(1, value.length - 1);
    out[section] = value;
  }
  return out;
}

// --- reading elements --------------------------------------------------------
//
// The nodes come from vbsParseXml (vbsxml.js), the port of the parser the lane
// TV uses, so what an element "has" is what xml_michael gives CMyXml.

// GetChildName: the FIRST direct child of that name; undefined when absent,
// which matters because vbsrender inherits every text attribute it is not given
// (see vbsPaintText). Filling in defaults here would silently break that
// inheritance - the OnScoring layouts rely on it heavily, e.g.
// #VBST_JOB_text3# declares nothing but an <x> and takes colour, size and
// alignment from text2 above it.
function vbsXmlChild(node, tag) {
  if (!node) return undefined;
  for (var i = 0; i < node.children.length; i++) {
    if (node.children[i].nodeName === tag) return node.children[i];
  }
  return undefined;
}

// GetElementContens: an element without text has NO value - the caller keeps
// what it had - which is not the same thing as an empty one.
function vbsXmlText(node, tag) {
  var c = vbsXmlChild(node, tag);
  if (c === undefined || c.textContent === undefined) return undefined;
  return c.textContent;
}

function vbsXmlRect(node) {
  var r = vbsXmlChild(node, 'rect');
  if (r === undefined) return undefined;
  var out = {};
  var x = vbsXmlText(r, 'x'); if (x !== undefined) out.x = x;
  var y = vbsXmlText(r, 'y'); if (y !== undefined) out.y = y;
  var w = vbsXmlText(r, 'w'); if (w !== undefined) out.w = w;
  var h = vbsXmlText(r, 'h'); if (h !== undefined) out.h = h;
  return out;
}

function vbsXmlColor(node, tag) {
  var c = vbsXmlChild(node, tag);
  if (c === undefined) return undefined;
  return {
    trans: vbsXmlText(c, 'trans'),
    red: vbsXmlText(c, 'red'),
    green: vbsXmlText(c, 'green'),
    blue: vbsXmlText(c, 'blue')
  };
}

function vbsXmlPoint(node, tag) {
  var p = vbsXmlChild(node, tag);
  if (p === undefined) return undefined;
  return { x: vbsXmlText(p, 'x'), y: vbsXmlText(p, 'y'), color: vbsXmlColor(p, 'color') };
}

// Only assigns when the XML actually said something, for the reason above.
function vbsSet(obj, key, value) {
  if (value !== undefined) obj[key] = value;
}

function vbsElementFromNode(node) {
  var name = node.nodeName;
  var e;

  if (name === 'picture') {
    e = { k: 'picture' };
    vbsSet(e, 'id', vbsXmlText(node, 'id'));
    // A <file> may itself be a token (#teamLogo_1#); vbsPaintPicture resolves
    // those, so only a real path is rewritten here.
    var file = vbsXmlText(node, 'file');
    // A token is resolved when drawn; a path with a backslash is a Windows path,
    // made a URL now; anything else stays as written, relative to the layout.
    if (file !== undefined) e.file = (file.indexOf('#') < 0 && file.indexOf('\\') >= 0) ? vbsWinPathToUrl(file) : file;
    vbsSet(e, 'rect', vbsXmlRect(node));
    vbsSet(e, 'colorFactor', vbsXmlText(node, 'color_factor'));
    vbsSet(e, 'trans', vbsXmlText(node, 'trans'));
    vbsCollectNodeLayers(node, e);
    return e;
  }

  if (name === 'true_type_text') {
    e = { k: 'text' };
    vbsSet(e, 'id', vbsXmlText(node, 'id'));
    vbsSet(e, 'text', vbsXmlText(node, 'text'));
    vbsSet(e, 'font', vbsXmlText(node, 'font'));
    vbsSet(e, 'fill', vbsXmlColor(node, 'color_fill'));
    vbsSet(e, 'shadowColor', vbsXmlColor(node, 'color_shadow'));
    vbsSet(e, 'rect', vbsXmlRect(node));
    vbsSet(e, 'fontstyle', vbsXmlText(node, 'fontstyle'));
    vbsSet(e, 'align', vbsXmlText(node, 'align'));
    vbsSet(e, 'aspect', vbsXmlText(node, 'aspect'));
    vbsSet(e, 'halo', vbsXmlText(node, 'halo_factor'));
    vbsSet(e, 'shadow', vbsXmlText(node, 'shadow_factor'));
    vbsSet(e, 'penWidth', vbsXmlText(node, 'pen_width'));
    vbsSet(e, 'isTextRec', vbsXmlText(node, 'is_text_rec'));
    // <color_pen>, <halo_pen> and <maxsize> are not carried: PrintTrueTypeText
    // reads none of them, so neither does this.
    vbsCollectNodeLayers(node, e);
    return e;
  }

  if (name === 'rectangle_fill') {
    e = { k: 'rect' };
    vbsSet(e, 'rect', vbsXmlRect(node));
    vbsSet(e, 'color', vbsXmlColor(node, 'color'));
    return e;
  }

  if (name === 'gradient_fill') {
    e = { k: 'gradient' };
    vbsSet(e, 'mode', vbsXmlText(node, 'mode'));
    vbsSet(e, 'p1', vbsXmlPoint(node, 'point1'));
    vbsSet(e, 'p2', vbsXmlPoint(node, 'point2'));
    vbsSet(e, 'rect', vbsXmlRect(node));
    return e;
  }

  // CMyXml::MakeLine: point1 to point2 in <color>, <pen_width> wide.
  if (name === 'draw_line') {
    e = { k: 'line' };
    vbsSet(e, 'p1', vbsXmlPoint(node, 'point1'));
    vbsSet(e, 'p2', vbsXmlPoint(node, 'point2'));
    vbsSet(e, 'color', vbsXmlColor(node, 'color'));
    vbsSet(e, 'penWidth', vbsXmlText(node, 'pen_width'));
    return e;
  }

  return null;   // anything else is drawn by nothing in the C++ either
}

// layer_before_<n> / layer_after_<n> nested inside an element. The first of a
// name only, as GetChildName finds it.
function vbsCollectNodeLayers(node, target) {
  for (var i = 0; i < node.children.length; i++) {
    var child = node.children[i];
    if (/^layer_(before|after)_\d+$/.test(child.nodeName) && target[child.nodeName] === undefined) {
      target[child.nodeName] = vbsElementsFromNode(child);
    }
  }
}

function vbsElementsFromNode(node) {
  var out = [];
  for (var i = 0; i < node.children.length; i++) {
    var e = vbsElementFromNode(node.children[i]);
    if (e) out.push(e);
  }
  return out;
}

// --- loading ---------------------------------------------------------------

// The layout's text, unparsed: it is spliced into the theme before anything is
// parsed, as in the C++. `lane` is the lane being drawn, for LoadCom's endpoint;
// `serverSide` says whether there is a LoadCom behind this page to ask at all.
// The layout never changes while a tournament runs, so it is fetched once per
// league.
var vbsOnScoringTextCache = {};

function vbsLoadOnScoringText(leaguePath, lane, serverSide) {
  var key = leaguePath + '|' + lane;
  if (vbsOnScoringTextCache[key]) return vbsOnScoringTextCache[key];

  var local = VBS_ROOT_URL + 'Reception/vbsTournaments/' + encodeURIComponent(leaguePath) + '.xml';
  var p = serverSide
    ? vbsFetch1252('/html/onscoring?lane=' + encodeURIComponent(lane)).catch(function () { return vbsFetch1252(local); })
    : vbsFetch1252(local);
  vbsOnScoringTextCache[key] = p;
  // A miss is not cached for good: the file is written when the competition is
  // booked, which may be after the page first asked.
  p.catch(function () { delete vbsOnScoringTextCache[key]; });
  return p;
}

function vbsLoadOnScoringValues(leaguePath) {
  var url = VBS_ROOT_URL + 'GameCtrl/VBST_' + encodeURIComponent(leaguePath) + '.ini';
  return vbsFetch1252(url).then(vbsParseIni);
}

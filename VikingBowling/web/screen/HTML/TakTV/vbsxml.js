// ---------------------------------------------------------------------------
// vbsxml.js - the XML parser the lane TV's XML protocol actually uses, in JS.
//
// The theme XML, its imports and the VBS-T OnScoring layouts are read on the
// slave by xml_michael (helperlibs/xml_michael/xml.cpp, XML::LoadText ->
// XMLHelper::ParseElementTree / FindXMLClose), and that parser is not an XML
// parser in the strict sense. The browser's DOMParser is, and the difference is
// not academic: of the files that ship, 69 are refused by DOMParser and drawn by
// the TV without complaint - six of the twenty-one themes (5Frames, Aquarium,
// Glass, Xmas Center/Left/Right) and some thirty OnScoring layouts. The HTML
// page then threw the whole file away and drew a different sheet, or no panel.
// What they contain:
//
//   <!--- Vita rutor for diffar --->   "--" inside a comment
//   <w>100</100>  <font>Arial</arial>  <id>#TOTD#</idt>   a closing tag of the
//                                       wrong name
//   a layer opened as layer_after_1 and closed as </layer_after_2>
//
// So this is a port of what xml_michael does, rule for rule, and the protocol
// loaders build their tree with it instead of DOMParser:
//
//  1. Nesting is decided by counting, never by name. An element runs to the
//     closing tag that brings the count of open tags back to zero, whatever
//     that tag is called (FindXMLClose). So </100> closes <w>.
//  2. A comment runs from <!-- to the first --> (ParseElementTree), so
//     <!--- x ---> is a comment. While counting, a comment is skipped from <!--
//     to a > that has "--" before it.
//  3. An element joins its parent only when the parent's loop meets a closing
//     tag after it - which in practice is always its own - and at the top level
//     nothing is joined: the document root is the LAST top-level element.
//  4. An element's value is its FIRST text chunk, with spaces, tabs, CR and LF
//     cut from both ends (AddBlankVariable), entities decoded (XMLDecode). An
//     element with no text has no value at all - GetElementContens answers
//     false and the caller keeps what it had - which is not the same as "".
//  5. A name runs from after "<" to the first space, tab, "/", ">" or '"'.
//  6. Everything before the first "?>" in the file is the header.
//
// Children with the same name are all kept, in order; picking the first one is
// GetChildName's rule and belongs to the callers (vbsXmlChild).
//
// The nodes answer the small part of the DOM the loaders use - nodeName,
// children, textContent - so the code reading them stays as it was.
// ---------------------------------------------------------------------------

/* exported vbsParseXml */

function vbsXmlNode(name) {
  return { nodeName: name, children: [], contents: [], textContent: undefined };
}

// XMLElement::Reparse: the name is what follows "<" up to the first of these.
function vbsXmlTagName(tag) {
  var name = '';
  for (var i = 0; i < tag.length; i++) {
    var c = tag.charAt(i);
    if (c === '<') continue;
    if (c === ' ' || c === '/' || c === '\t' || c === '>' || c === '"') break;
    name += c;
  }
  return name;
}

// XML::XMLDecode - the five named entities and the numeric ones, nothing else.
function vbsXmlDecode(text) {
  if (text.indexOf('&') < 0) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]*|#[0-9]*|amp|quot|apos|lt|gt);/g, function (all, e) {
    if (e === 'amp') return '&';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    var n = (e.charAt(1) === 'x' || e.charAt(1) === 'X') ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10);
    return isNaN(n) ? '' : String.fromCharCode(n);
  });
}

// XMLHelper::AddBlankVariable: the text between two tags, if anything but
// spaces, tabs, CR and LF is left once those are cut from both ends.
function vbsXmlAddText(parent, text) {
  if (!parent || !text) return;
  var s = 0;
  var e = text.length;
  while (s < e && ' \t\n\r'.indexOf(text.charAt(s)) >= 0) s++;
  while (e > s && ' \t\n\r'.indexOf(text.charAt(e - 1)) >= 0) e--;
  if (e <= s) return;
  parent.contents.push(vbsXmlDecode(text.substring(s, e)));
  if (parent.textContent === undefined) parent.textContent = parent.contents[0];
}

// XMLHelper::FindXMLClose. `start` is the "<" of an opening tag; returns the
// index just past the ">" of the tag that closes it, or -1.
function vbsXmlFindClose(s, start) {
  var d = 0;
  var a2 = start;
  var isComment = false;
  var isCData = false;
  var n = s.length;

  for (;;) {
    var a1 = s.indexOf('<', a2);
    if (a1 < 0) return -1;

    if (s.charAt(a1 + 1) === '/') {
      a2 = s.indexOf('>', a1);
      if (a2 < 0) return -1;
      a2++;
      d--;
      if (!d) return a2;
      continue;
    }

    if ((s.charAt(a1 + 1) === '!' && n - a1 > 2 && s.charAt(a1 + 2) === '-' && s.charAt(a1 + 3) === '-') ||
        s.charAt(a1 + 1) === '?')
      isComment = true;

    if (s.charAt(a1 + 1) === '!' && n - a1 > 8 && s.substr(a1 + 1, 8) === '![CDATA[')
      isCData = true;

    var nest = false;
    for (;;) {
      if (a1 >= n) return -1;     // the C walks off the end of its buffer here
      var c = s.charAt(a1);
      if (isCData && (c !== ']' || s.charAt(a1 + 1) !== ']' || s.charAt(a1 + 2) !== '>')) { a1++; continue; }
      if (isCData) { a1 += 2; break; }

      if (c !== '/' && c !== '>') {
        if (c === '"') nest = !nest;
        a1++;
        continue;
      }
      if (c === '/' && nest) { a1++; continue; }
      if (c === '/' && (isComment || isCData)) { a1++; continue; }
      if (c === '>' && isCData && (s.charAt(a1 - 1) !== ']' || s.charAt(a1 - 2) !== ']')) { a1++; continue; }
      if (c === '>' && isComment && (s.charAt(a1 - 1) !== '-' || s.charAt(a1 - 2) !== '-')) { a1++; continue; }
      break;
    }

    d++;

    if ((s.charAt(a1) === '/' || isComment) && !isCData) {   // it closes itself
      isComment = false;
      a2 = a1 + 1;
      d--;
      if (d === 0) return a2;
      continue;
    }

    if (s.charAt(a1) === '>' && isCData && s.charAt(a1 - 1) === ']' && s.charAt(a1 - 2) === ']') {
      isCData = false;
      a2 = a1 + 1;
      d--;
      if (d === 0) return a2;
      continue;
    }

    a2 = a1 + 1;
  }
}

// XMLHelper::ParseElementTree. `tree` is the text between an element's tags -
// the C cuts it out by writing a NUL over the closing tag's "<", and so does
// this by taking the substring. Returns the last element opened at this level.
function vbsXmlParseTree(parent, tree, state) {
  var root = null;
  var a2 = 0;

  for (;;) {
    var a3 = tree.indexOf('<', a2);
    if (a3 < 0) {
      vbsXmlAddText(parent, tree.substring(a2));
      break;
    }

    var isCData = tree.substr(a3, 8) === '<![CDATA';
    var isComment = tree.substr(a3, 4) === '<!--';

    vbsXmlAddText(parent, tree.substring(a2, a3));

    var a4;
    if (isCData) a4 = tree.indexOf(']]>', a3);
    else if (isComment) a4 = tree.indexOf('-->', a3);
    else a4 = tree.indexOf('>', a3);
    if (a4 < 0) break;
    if (isCData || isComment) a4 += 2;     // onto the '>'

    // A comment or <? ?> markup: nothing reads it.
    if ((tree.charAt(a3 + 1) === '!' && tree.length - (a3 + 1) > 2 && tree.charAt(a3 + 2) === '-' && tree.charAt(a3 + 3) === '-') ||
        tree.charAt(a3 + 1) === '?') {
      a2 = a4 + 1;
      continue;
    }

    // CDATA is kept apart from an element's contents, so it is never a value.
    if (tree.charAt(a3 + 1) === '!' && tree.length - (a3 + 1) > 8 && tree.substr(a3 + 1, 8) === '![CDATA[') {
      a2 = a4 + 1;
      continue;
    }

    // A closing tag: whatever was opened last at this level joins the parent.
    if (tree.charAt(a3 + 1) === '/') {
      if (parent && root && parent.children.indexOf(root) < 0) parent.children.push(root);
      a2 = a4 + 1;
      continue;
    }

    // <x/> - complete in itself.
    if (tree.charAt(a4 - 1) === '/') {
      var single = vbsXmlNode(vbsXmlTagName(tree.substring(a3, a4 + 1)));
      if (parent) parent.children.push(single);
      a2 = a4 + 1;
      if (!root) root = single;
      continue;
    }

    var a5 = vbsXmlFindClose(tree, a3);
    if (a5 < 0) {
      state.error = 'no closing tag for the element at ' + a3;
      return root;
    }
    a5--;
    while (a5 > a3 && tree.charAt(a5) !== '<') a5--;
    var a1 = a5;

    root = vbsXmlNode(vbsXmlTagName(tree.substring(a3, a4 + 1)));
    vbsXmlParseTree(root, tree.substring(a4 + 1, a1), state);

    var before = a2;
    a2 = a1;
    if (a2 === before) break;
  }

  return root;
}

// XML::LoadText. Returns the root element, or throws when xml_michael would
// have reported a parse error - MyPrepareXml refuses the layout then, and the TV
// draws nothing from it either.
function vbsParseXml(text) {
  var s = String(text || '');
  var start = 0;
  var header = s.indexOf('?>');
  if (header >= 0) start = header + 2;
  var first = s.indexOf('<', start);
  if (first < 0) throw new Error('no element in the XML');

  var state = { error: null };
  var root = vbsXmlParseTree(null, s.substring(first), state);
  if (state.error) throw new Error('XML not readable by the lane TV either: ' + state.error);
  if (!root) throw new Error('no element in the XML');
  return root;
}

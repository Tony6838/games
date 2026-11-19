// ---------------------------------------------------------------------------
// menucards.js - the game-type cards of the menu: open play (13 game types) and the VBS-T
// formats (the dialog formats and the Auto list). Each card is a button with a symbol drawn
// in SVG (no raster picture: the lane console's blurred score-table pictures made the whole
// menu dim and hard to read), the name, and one line on what is special about the game.
// The lines are in js/i18n.js (gd* keys); each states the rule as the engine scores it
// (js/engine/openplay.js, js/engine/bowlingscore.js):
//   normal  standard ten-pin                   369    strikes given in frames 3, 6, 9
//   mini    a ball that knocks no (new) pins   tenth  activeSquare starts at 18
//           down, or fouls, is a strike/spare  notapN N or more pins on the first ball
//   shortN  starts at frame 11 - N                    are a strike
//   cfg     strike 30, spare 10 + the frame's first ball, no bonus balls in frame 10
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (body) => `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">${body}</svg>`;
// one line of text, centred; the font is the page's condensed font (css: .gSym text)
const txt = (s, size, y = 24, x = 24, cls = '') => `<text x="${x}" y="${y}" font-size="${size}"${cls ? ` class="${cls}"` : ''} text-anchor="middle" dominant-baseline="central">${esc(s)}</text>`;

// a bowling pin, white with two red neck stripes (the stripes are clipped to the outline)
const PIN_PATH = 'M24 4C26.6 4 28.2 6.2 28.2 9C28.2 11.6 26.6 13.6 26.4 16C26.2 18.4 31.6 23 31.6 31C31.6 37 29.6 41 28 44L20 44C18.4 41 16.4 37 16.4 31C16.4 23 21.8 18.4 21.6 16C21.4 13.6 19.8 11.6 19.8 9C19.8 6.2 21.4 4 24 4Z';
const pin = () => svg(`<defs><clipPath id="vbgPinClip"><path d="${PIN_PATH}"/></clipPath></defs>` +
  `<path class="symPin" d="${PIN_PATH}"/><g clip-path="url(#vbgPinClip)" class="symStripe"><rect x="14" y="13.4" width="20" height="1.8"/><rect x="14" y="16.6" width="20" height="1.8"/></g>`);

// a person: head and shoulders, at (cx, cy) = the head's centre, s = scale
const person = (cx, cy, s, cls) => `<g class="${cls}"><circle cx="${cx}" cy="${cy}" r="${(3.7 * s).toFixed(2)}"/>` +
  `<path d="M${(cx - 6.6 * s).toFixed(2)} ${(cy + 12.4 * s).toFixed(2)}C${(cx - 6.6 * s).toFixed(2)} ${(cy + 6.4 * s).toFixed(2)} ${(cx - 3.6 * s).toFixed(2)} ${(cy + 5 * s).toFixed(2)} ${cx} ${(cy + 5 * s).toFixed(2)}` +
  `C${(cx + 3.6 * s).toFixed(2)} ${(cy + 5 * s).toFixed(2)} ${(cx + 6.6 * s).toFixed(2)} ${(cy + 6.4 * s).toFixed(2)} ${(cx + 6.6 * s).toFixed(2)} ${(cy + 12.4 * s).toFixed(2)}Z"/></g>`;
// the label under a figure ("4+4", "8", "HCP")
const label = (s) => (s ? txt(s, 11.5, 40.5, 24, 'symLabel') : '');

const SYMBOLS = {
  pin,
  // text symbols: the rule in a few characters
  '369': () => svg(txt('3-6-9', 16.5)),
  mini: () => svg(txt('0', 19, 24, 12) + '<path class="symArrow" d="M18.5 24H28.5M25 20.2L29 24L25 27.8"/>' + txt('X', 19, 24, 36)),
  tenth: () => svg('<rect class="symFrame" x="7" y="9" width="34" height="30" rx="3"/><path class="symFrame" d="M29 9V19H41"/>' + txt('10', 17.5, 30, 19.5)),
  notap: (n) => svg(txt(n + '=X', 20)),
  short: (f) => svg(txt(f + '–10', 17.5)),
  cfg: () => svg(txt('X=30', 17.5)),
  // VBS-T: teams (white against gold), one person, everyone against everyone
  teams2: (l) => svg(person(11.5, 10.5, 0.78, 'symA') + person(17.5, 14, 0.9, 'symA') +
    person(36.5, 10.5, 0.78, 'symB') + person(30.5, 14, 0.9, 'symB') + label(l)),
  teams4: (l) => svg(person(9, 13, 0.7, 'symA') + person(19, 13, 0.7, 'symB') + person(29, 13, 0.7, 'symC') + person(39, 13, 0.7, 'symD') + label(l)),
  person: (l) => svg(person(24, l ? 10 : 14, l ? 1.05 : 1.35, 'symA') + label(l)),
  rr: () => {
    const pts = [...Array(6)].map((_, k) => [24 + 15 * Math.cos((k * 60 - 90) * Math.PI / 180), 24 + 15 * Math.sin((k * 60 - 90) * Math.PI / 180)]);
    let lines = '';
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) lines += `M${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}L${pts[j][0].toFixed(2)} ${pts[j][1].toFixed(2)}`;
    return svg(`<path class="symMesh" d="${lines}"/>` + pts.map((p, k) => `<circle class="${k % 2 ? 'symDotB' : 'symDotA'}" cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="3.4"/>`).join(''));
  }
};

// sym = 'pin' | '369' | 'mini' | 'tenth' | 'notap:9' | 'short:8' | 'cfg' | 'teams2:4+4' | 'teams4:4×3' | 'person:8' | 'rr'
function symbolSvg(sym) {
  const i = sym.indexOf(':');
  const kind = i < 0 ? sym : sym.slice(0, i), arg = i < 0 ? '' : sym.slice(i + 1);
  return (SYMBOLS[kind] || SYMBOLS.pin)(arg);
}
// the colour of a symbol's badge, by family (css: .gSym.k-*)
const FAMILY = { pin: 'normal', '369': '369', mini: 'mini', tenth: 'tenth', notap: 'notap', short: 'short', cfg: 'cfg', teams2: 'team', teams4: 'team', person: 'ind', rr: 'rr' };
const family = (sym) => FAMILY[sym.split(':')[0]] || 'normal';

// An open play card. g = { id, sym, label(), desc() } from OPEN_GAMES in main.js
export function gameCard(g, active) {
  return `<button type="button" class="gameTile${active ? ' active' : ''}" data-game="${esc(g.id)}" aria-pressed="${active}">` +
    `<span class="gSym k-${family(g.sym)}">${symbolSvg(g.sym)}</span>` +
    `<span class="gName">${esc(g.label())}</span><span class="gDesc">${esc(g.desc())}</span></button>`;
}

// The VBS-T dialog formats: which symbol each one gets (teams and their size, or players)
const FORMAT_SYMBOL = {
  banp44: 'teams2:4+4', banp88x8: 'teams2:8+8', banp88x4: 'teams2:8+8', banp88x6: 'teams2:8+8',
  ind: 'person:8', rr: 'rr', skane: 'person:HCP', lagspel: 'teams4:4×3',
  korp18: 'teams2:3+3', korp12: 'teams2:3+3', korpBaker: 'teams2:2+2', korpVg: 'teams2:4+4'
};
export function formatSymbolFor(id, teams) {
  return FORMAT_SYMBOL[id] || (teams > 1 ? (teams > 2 ? 'teams4' : 'teams2') : 'person');
}

// A VBS-T card. f = { id, title, sub, sym, bad }; small = the Auto list (a smaller symbol)
export function formatCard(f, active, small = false) {
  return `<button type="button" class="fmt${small ? ' small' : ''}${active ? ' active' : ''}${f.bad ? ' bad' : ''}" data-fmt="${esc(f.id)}" aria-pressed="${active}">` +
    `<span class="gSym k-${family(f.sym)}">${symbolSvg(f.sym)}</span>` +
    `<b>${esc(f.title)}</b><small>${esc(f.sub)}</small></button>`;
}

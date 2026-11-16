'use strict';
// lib/styler-fixes.js's "linehue" fix (its own file: the replacements are the mods' own template literals,
// kept as plain strings so nothing in them is interpolated here).
//
// Rainbow lines (and the rainbow search field and round header buttons) cycle through the hues via a
// registered variable, --pst-lh (Post Styler: --ps-lh), animated in 18 steps over 3 s. It was registered
// inherits: true and animated on <html> (Post Styler: on each styled post), so every step changed an inherited
// value at the top and restyled every element under it: the whole page, 6 times a second. Now it's
// inherits: false and animated on each thing it colours (the lines, separators, the search field and its
// magnifier, the round buttons; in a post, its card and quoted-post boxes), so a step restyles only those.
// They stay in step with one another: each hue animation is pinned to the page's time origin (as Rainbow
// Rave pins its own), which also keeps every line the same hue at the same moment, as before. Where one of
// them already rolls a rainbow (a side panel, a card, a quoted post, the top bar), it gets both animations.
// The search field's placeholder takes the field's colour (inherit), as the variable no longer reaches it.
//
// Post Styler: its hue animation was on the post itself, where the rainbow background's animation (an
// !important one on the same element) replaces it, so in a post with a rainbow background the card and
// quoted-post edges stay at the hue's first step (red): a bug, kept as it is here (the boxes of a post with a
// rainbow background get no hue animation, :not([data-ps-r~=bg])), so the look doesn't change. To make them
// cycle as intended, drop those three :not([data-ps-r~=bg]).
const P = (find, replace) => ({ find, replace });
const L = (...lines) => lines.join('\n');
const pin = (name) => L(
  `  // (each ${name} animation pinned to the page's time origin: every line steps through the hues together)`,
  "  addEventListener('animationstart', (e) => {",
  `    if (e.animationName !== '${name}') return;`,
  '    try { for (const a of e.target.getAnimations()) if (a.animationName === e.animationName && a.startTime !== 0) a.startTime = 0; } catch {}',
  '  }, true);', '');

const profileStyler = [
  P("@property --pst-lh { syntax: '<angle>'; inherits: true; initial-value: 0deg; }", "@property --pst-lh { syntax: '<angle>'; inherits: false; initial-value: 0deg; }"),
  P('    html[data-pst-on][data-pst-r-text] { animation: pst-line-hue 3s steps(18) infinite; }\n', ''),
  P('    html[data-pst-on][data-pst-r-icons] { animation: pst-line-hue 3s steps(18) infinite; }\n', ''),
  P('    html[data-pst-on][data-pst-r-lines] { animation: pst-line-hue 3s steps(18) infinite; }\n', ''),
  P('  `;\n  root.append(css);\n  // The small rainbow as an SVG gradient', L(
    "    /* the hue (pst-line-hue): animated on each thing it colours (the variable isn't inherited), pinned in step */",
    '    html[data-pst-on][data-pst-r-text] #react-root :is([data-testid=SearchBox_Search_Input], form[role=search] svg),',
    '    html[data-pst-on][data-pst-r-icons] #react-root ${ICON_BUTTONS},',
    '    html[data-pst-on][data-pst-r-lines] #react-root :is(${LINES}, [role=separator]) { animation: pst-line-hue 3s steps(18) infinite; }',
    '    /* (those that also roll a rainbow: both) */',
    '    html[data-pst-on][data-pst-r-lines][data-pst-r-panel] #react-root [data-pst-card]:not(#pst-l),',
    '    html[data-pst-on][data-pst-r-lines][data-pst-r-cards] #react-root :is(${CARDS}):is(${LINES}):not(#pst-l),',
    '    html[data-pst-on][data-pst-r-lines][data-pst-r-quotes] #react-root :is(${QUOTES}):not(#pst-l) { animation: pst-panel-roll 5s steps(75) infinite, pst-line-hue 3s steps(18) infinite !important; }',
    '    html[data-pst-on][data-pst-r-lines][data-pst-r-bg] #react-root [data-pst-solid]:not(#pst-l) { animation: pst-box-roll 5s steps(75) infinite, pst-line-hue 3s steps(18) infinite !important; }',
    "    /* (the search field's placeholder: the field's own colour) */",
    '    html[data-pst-on][data-pst-r-text]:not(#pst-l) #react-root [data-testid=SearchBox_Search_Input]::placeholder { color: inherit !important; -webkit-text-fill-color: inherit !important; }',
    '  `;', '  root.append(css);', '  // The small rainbow as an SVG gradient')),
  P("  const css = document.createElement('style');\n  css.textContent = `\n    /* (one hue cycle of RAVE_TILE", pin('pst-line-hue') + "  const css = document.createElement('style');\n  css.textContent = `\n    /* (one hue cycle of RAVE_TILE"),
];

const postStyler = [
  P("@property --ps-lh { syntax: '<angle>'; inherits: true; initial-value: 0deg; }", "@property --ps-lh { syntax: '<angle>'; inherits: false; initial-value: 0deg; }"),
  P('    ${X}[data-ps-r~=lines] { animation: ps-line-hue 3s steps(18) infinite; }\n', L(
    '    ${X}[data-ps-r~=lines]:not([data-ps-r~=bg]) :is([data-testid="card.wrapper"], [data-ps-quote]) { animation: ps-line-hue 3s steps(18) infinite; }',
    '    ${X}[data-ps-r~=lines][data-ps-r~=cards]:not([data-ps-r~=bg]) [data-testid="card.wrapper"]:not(#ps-l),',
    '    ${X}[data-ps-r~=lines][data-ps-r~=quotes]:not([data-ps-r~=bg]) [data-ps-quote]:not(#ps-l),',
    '    ${X}[data-ps-r~=lines]:not([data-ps-r~=bg]) [data-ps-quote][data-ps-r~=bg]:not(#ps-l):not(#ps-q):not(#ps-m) { animation: ps-box-roll 5s steps(75) infinite, ps-line-hue 3s steps(18) infinite !important; }', '')),
  P("  const css = document.createElement('style');\n  css.id = 'ps-css';", pin('ps-line-hue') + "  const css = document.createElement('style');\n  css.id = 'ps-css';"),
];

// "rededge" (lib/styler-fixes.js, by name only, after linehue): the Post Styler bug fixed as well, so card and
// quoted-post edges in a post with a rainbow background cycle through the hues like every other rainbow line
// (they stay red now): linehue's three rules without their :not([data-ps-r~=bg])
const redEdge = [
  P('    ${X}[data-ps-r~=lines]:not([data-ps-r~=bg]) :is([data-testid="card.wrapper"], [data-ps-quote]) {', '    ${X}[data-ps-r~=lines] :is([data-testid="card.wrapper"], [data-ps-quote]) {'),
  P('    ${X}[data-ps-r~=lines][data-ps-r~=cards]:not([data-ps-r~=bg]) [data-testid="card.wrapper"]:not(#ps-l),', '    ${X}[data-ps-r~=lines][data-ps-r~=cards] [data-testid="card.wrapper"]:not(#ps-l),'),
  P('    ${X}[data-ps-r~=lines][data-ps-r~=quotes]:not([data-ps-r~=bg]) [data-ps-quote]:not(#ps-l),', '    ${X}[data-ps-r~=lines][data-ps-r~=quotes] [data-ps-quote]:not(#ps-l),'),
  // (and a post with a rainbow background's own rolling rainbow, on its card or quoted post: both animations)
  P('    ${X}[data-ps-r~=lines]:not([data-ps-r~=bg]) [data-ps-quote][data-ps-r~=bg]:not(#ps-l):not(#ps-q):not(#ps-m) {', '    ${X}[data-ps-r~=lines] [data-ps-quote][data-ps-r~=bg]:not(#ps-l):not(#ps-q):not(#ps-m) {'),
];

module.exports = { 'profile-styler.js': profileStyler, 'post-styler.js': postStyler, redEdge };

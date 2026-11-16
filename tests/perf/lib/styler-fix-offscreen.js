'use strict';
// lib/styler-fixes.js's "offscreen" fix (its own file: the replacements are the mods' own code, kept as
// plain strings).
//
// Chrome samples every running CSS animation every frame, and restyles its element, whether or not it can
// be seen: X keeps about a screen of posts above the window and two below, so most of the rainbow text's
// animations (one per span) were in posts nobody could see. Now the timeline's rows that are well out of
// the window (an IntersectionObserver, with a 300 px margin) are marked data-pst-off (Post Styler:
// data-ps-off), and every animation inside them is paused (animation-play-state, which leaves everything
// else as it was); a row coming back is unpaused before it reaches the window. What shows is the same; a
// paused rainbow resumes where it stopped, so a row's rainbows may be at a different point of their roll than
// before (as they already are, row to row: each animation starts when its element gets it).
const P = (find, replace) => ({ find, replace });
const L = (...lines) => lines.join('\n');
// (pinned: the animation kept in step with the page, lib/styler-fix-linehue.js, re-pinned as a row comes back)
const observer = (attr, pinned) => L(
  `  // (the timeline's rows well out of the window: ${attr}, and their animations paused, see the CSS; a row`,
  `  // coming back gets its ${pinned} animations back in step: getAnimations brings its style up to date first)`,
  '  const offRows = new IntersectionObserver((entries) => {',
  '    for (const e of entries) {',
  `      if (e.target.hasAttribute('${attr}') !== e.isIntersecting) continue;`,
  `      e.target.toggleAttribute('${attr}', !e.isIntersecting);`,
  `      if (e.isIntersecting) try { for (const a of e.target.getAnimations({ subtree: true })) if (a.animationName === '${pinned}' && a.startTime !== 0) a.startTime = 0; } catch {}`,
  '    }',
  "  }, { rootMargin: '300px 0px' });",
  '  const offSeen = new WeakSet();',
  "  const observeRows = () => { for (const row of document.querySelectorAll('#react-root [data-testid=cellInnerDiv]')) if (!offSeen.has(row)) { offSeen.add(row); offRows.observe(row); } };",
  '');

const profileStyler = [
  P('  `;\n  root.append(css);\n  // The small rainbow as an SVG gradient', L(
    "    /* (a row of the timeline well out of the window: its animations paused, see observeRows) */",
    '    html #react-root [data-pst-off] *:not(#pst-o1):not(#pst-o2):not(#pst-o3):not(#pst-o4) { animation-play-state: paused !important; }',
    '  `;', '  root.append(css);', '  // The small rainbow as an SVG gradient')),
  P('  const mark = () => {\n', `${observer('data-pst-off', 'pst-line-hue')}  const mark = () => {\n    observeRows();\n`),
];
const postStyler = [
  P('    html #react-root :is(article, a, ${CARDS}) span:is([data-ps-emoji]', L(
    "    /* (a row of the timeline well out of the window: its animations paused, see observeRows) */",
    '    html #react-root [data-ps-off] *:not(#ps-o1):not(#ps-o2):not(#ps-o3):not(#ps-o4):not(#ps-o5):not(#ps-o6) { animation-play-state: paused !important; }',
    '    html #react-root :is(article, a, ${CARDS}) span:is([data-ps-emoji]')),
  P('  const tick = () => {\n    try {\n      tidyEmoji();', `${observer('data-ps-off', 'ps-line-hue')}  const tick = () => {\n    try {\n      observeRows();\n      tidyEmoji();`),
];

module.exports = { 'profile-styler.js': profileStyler, 'post-styler.js': postStyler };

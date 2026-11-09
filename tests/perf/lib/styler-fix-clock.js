'use strict';
// lib/styler-fixes.js's "clock" fix (its own file: its replacements are the mods' own template literals, kept
// as plain strings here so nothing in them is interpolated by this file).
//
// The rainbow text's roll and the lines' hue stepped by one clock (a timer to each step, 15 and 6 a second,
// setting the step's number on <html>), not by CSS animations: an animation on every rainbow span restyled
// each of them every frame (Chrome samples a running animation every frame, steps or not), and the lines'
// hue, an inherited variable animated on <html>, restyled the whole page 6 times a second. Now a step
// restyles only the rainbow text (its background-position: one rule per step), or only the lines and the
// other things the hue colours (the variable set on each of them, no longer inherited). The same steps at the
// same times (counted from the page's time origin, as an animation started at 0), all in phase.
const P = (find, replace) => ({ find, replace });
const L = (...lines) => lines.join('\n');

const profileStyler = [
  P('  const rainbowText = (sel) =>', L(
    "  // (the roll's steps: one rule per step, on the same selectors, picked by html[data-pst-tx], see clock)",
    "  const TX_STEPS = (sel) => Array.from({ length: 12 }, (_, k) => `${sel.split(/,(?![^(]*\\))/).map((s) => s.trim().replace(/(::[\\w-]+)?$/, ':not(#pst-never)$1').replace(/^html/, `html[data-pst-tx=\"${k}\"]`)).join(', ')} { background-position: ${(k * 33.941 / 12).toFixed(3)}px 0 !important; }`).join('\\n    ');",
    '  const rainbowText = (sel) =>')),
  P('      animation: pst-text-roll .8s steps(12) infinite !important; }`;', '      animation: none !important; }\n    ${TX_STEPS(sel)}`;'),
  P("@property --pst-lh { syntax: '<angle>'; inherits: true; initial-value: 0deg; }", "@property --pst-lh { syntax: '<angle>'; inherits: false; initial-value: 0deg; }"),
  P('    html[data-pst-on][data-pst-r-text] { animation: pst-line-hue 3s steps(18) infinite; }\n', ''),
  P('    html[data-pst-on][data-pst-r-icons] { animation: pst-line-hue 3s steps(18) infinite; }\n', ''),
  P('    html[data-pst-on][data-pst-r-lines] { animation: pst-line-hue 3s steps(18) infinite; }\n', ''),
  P('  `;\n  root.append(css);\n  // The small rainbow as an SVG gradient', L(
    "    /* the hue's steps (see clock): set on each thing that uses it (it isn't inherited) */",
    "    ${Array.from({ length: 18 }, (_, k) => [`#react-root :is(${LINES})`, '#react-root [role=separator]', `#react-root ${ICON_BUTTONS}`, '#react-root [data-testid=SearchBox_Search_Input]', '#react-root [data-testid=SearchBox_Search_Input]::placeholder', '#react-root form[role=search] svg'].map((x) => `html[data-pst-lh=\"${k}\"] ${x}`).join(', ') + ` { --pst-lh: ${k * 20}deg; }`).join('\\n    ')}",
    '  `;', '  root.append(css);', '  // The small rainbow as an SVG gradient')),
  P("    root.toggleAttribute('data-pst-r-links', r.includes('links'));\n    if (!st) return;", "    root.toggleAttribute('data-pst-r-links', r.includes('links'));\n    clock();\n    if (!st) return;"),
  P("  const anyRainbowText = () => ['data-pst-r-text', 'data-pst-r-name', 'data-pst-r-handle', 'data-pst-r-links'].some((a) => root.hasAttribute(a));\n", L(
    "  const anyRainbowText = () => ['data-pst-r-text', 'data-pst-r-name', 'data-pst-r-handle', 'data-pst-r-links'].some((a) => root.hasAttribute(a));",
    "  // The clock for the rainbow text's roll (12 steps in 0.8 s: html[data-pst-tx]) and the lines' hue (18 in 3 s:",
    "  // html[data-pst-lh]), while they're on: a timer to each next step, counted from the page's time origin",
    '  let clockTimer = 0;',
    '  const TX_MS = 800 / 12, LH_MS = 3000 / 18;',
    '  const clock = () => {',
    '    clearTimeout(clockTimer); clockTimer = 0;',
    "    const on = root.hasAttribute('data-pst-on'), now = performance.now();",
    "    const tx = on && (anyRainbowText() || root.hasAttribute('data-pst-r-logo'));",
    "    const lh = on && ['data-pst-r-text', 'data-pst-r-icons', 'data-pst-r-lines'].some((a) => root.hasAttribute(a));",
    '    const step = (name, k) => { const v = String(k); if (root.getAttribute(name) !== v) root.setAttribute(name, v); };',
    "    if (tx) step('data-pst-tx', Math.floor(now / TX_MS) % 12); else if (root.hasAttribute('data-pst-tx')) root.removeAttribute('data-pst-tx');",
    "    if (lh) step('data-pst-lh', Math.floor(now / LH_MS) % 18); else if (root.hasAttribute('data-pst-lh')) root.removeAttribute('data-pst-lh');",
    '    if (tx || lh) clockTimer = setTimeout(clock, Math.min(tx ? TX_MS - (now % TX_MS) : Infinity, lh ? LH_MS - (now % LH_MS) : Infinity) + 1);',
    '  };', '')),
];

const postStyler = [
  P('  const rainbowText = (sel) =>', L(
    "  // (the roll's steps: one rule per step, on the same selectors, picked by html[data-ps-tx], see clock)",
    "  const TX_STEPS = (sel) => Array.from({ length: 12 }, (_, k) => `${sel.split(/,(?![^(]*\\))/).map((s) => s.trim().replace(/^html/, `html[data-ps-tx=\"${k}\"]`)).join(', ')} { background-position: ${(k * 33.941 / 12).toFixed(3)}px 0 !important; }`).join('\\n    ');",
    '  const rainbowText = (sel) =>')),
  P('      animation: ps-text-roll .8s steps(12) infinite !important; }`;', '      animation: none !important; }\n    ${TX_STEPS(sel)}`;'),
  P("@property --ps-lh { syntax: '<angle>'; inherits: true; initial-value: 0deg; }", "@property --ps-lh { syntax: '<angle>'; inherits: false; initial-value: 0deg; }"),
  P('    ${X}[data-ps-r~=lines] { animation: ps-line-hue 3s steps(18) infinite; }\n', ''),
  P('    ${Q}[data-ps-r~=lines] { animation: ps-line-hue 3s steps(18) infinite; border-color', '    ${Q}[data-ps-r~=lines] { border-color'),
  P('    html #react-root :is(article, a, ${CARDS}) span:is([data-ps-emoji]', L(
    "    /* the hue's steps (see clock): set on the boxes that use it (it isn't inherited) */",
    "    ${Array.from({ length: 18 }, (_, k) => `html[data-ps-lh=\"${k}\"] #react-root [data-ps-u][data-ps-r~=lines] :is([data-testid=\"card.wrapper\"], [data-ps-quote]), html[data-ps-lh=\"${k}\"] #react-root [data-ps-quote][data-ps-u][data-ps-r~=lines] { --ps-lh: ${k * 20}deg; }`).join('\\n    ')}",
    '    html #react-root :is(article, a, ${CARDS}) span:is([data-ps-emoji]')),
  P("    } catch (e) { window.trif?.warn('post styler', String(e)); }\n  };\n  setInterval(tick, 800);", L(
    '      // (the clock, while anything shows rainbow text or rainbow lines)',
    "      clockTx = !!document.querySelector('[data-ps-r~=text], [data-ps-r~=name], [data-ps-r~=handle], [data-ps-r~=links]');",
    "      clockLh = !!document.querySelector('[data-ps-r~=lines]');",
    '      if ((clockTx || clockLh) !== !!clockTimer) clock();',
    "    } catch (e) { window.trif?.warn('post styler', String(e)); }", '  };', '  setInterval(tick, 800);')),
  P('  const tick = () => {\n    try {\n      tidyEmoji();', L(
    "  // The clock for the rainbow text's roll (12 steps in 0.8 s: html[data-ps-tx]) and the lines' hue (18 in 3 s:",
    '  // html[data-ps-lh]), while a post or card shows them (clockTx, clockLh: from tick): a timer to each next',
    "  // step, counted from the page's time origin",
    '  let clockTimer = 0, clockTx = false, clockLh = false;',
    '  const TX_MS = 800 / 12, LH_MS = 3000 / 18;',
    '  const clock = () => {',
    '    clearTimeout(clockTimer); clockTimer = 0;',
    '    const now = performance.now(), step = (name, k) => { const v = String(k); if (root.getAttribute(name) !== v) root.setAttribute(name, v); };',
    "    if (clockTx) step('data-ps-tx', Math.floor(now / TX_MS) % 12); else if (root.hasAttribute('data-ps-tx')) root.removeAttribute('data-ps-tx');",
    "    if (clockLh) step('data-ps-lh', Math.floor(now / LH_MS) % 18); else if (root.hasAttribute('data-ps-lh')) root.removeAttribute('data-ps-lh');",
    '    if (clockTx || clockLh) clockTimer = setTimeout(clock, Math.min(clockTx ? TX_MS - (now % TX_MS) : Infinity, clockLh ? LH_MS - (now % LH_MS) : Infinity) + 1);',
    '  };',
    '  const tick = () => {', '    try {', '      tidyEmoji();')),
];

module.exports = { 'profile-styler.js': profileStyler, 'post-styler.js': postStyler };

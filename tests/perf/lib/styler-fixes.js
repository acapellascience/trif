#!/usr/bin/env node
'use strict';
// Prototype performance fixes for the X stylers (profile-styler.js, post-styler.js), as anchored edits to
// whatever the files are now, so they can be rebuilt on newer versions. Each anchor must be found exactly
// once, or it fails loudly. Never writes to ~/.trif.
//   node tests/perf/lib/styler-fixes.js <dir with the mods> <outDir> [fix,fix...]
//     → <outDir>/<mod>.<fix>.js for each fix that touches it, and <outDir>/<mod>.js with all of them
// In the suite: --variants fix:<name> (one), fix:a&b, fixed (all).
const fs = require('fs');
const path = require('path');

const P = (find, replace) => ({ find, replace });
const L = (...lines) => lines.join('\n');
const PS = 'profile-styler.js', POST = 'post-styler.js';
// (a CSS animation starts when its element gets it, so two spans' rainbows were out of step, and their steps
// fell in different frames: every frame had some text to restyle and redraw. Pinned to the page's time
// origin, as Rainbow Rave pins its own (wm-rainbow-*), every rainbow steps in the same frames, in phase.)
const pinCode = (prefix) => `
  addEventListener('animationstart', (e) => {
    if (!e.animationName.startsWith('${prefix}')) return;
    try {
      const t = e.target, list = e.pseudoElement ? t.getAnimations({ subtree: true }).filter((a) => a.effect?.target === t && a.effect.pseudoElement === e.pseudoElement) : t.getAnimations();
      for (const a of list) if (a.animationName === e.animationName && a.startTime !== 0) a.startTime = 0;
    } catch {}
  }, true);
`;
const FIXES = {
  // pin (not in `fixed`): every rainbow animation pinned to the page's time origin, so their steps fall in the
  // same frames (first try: 1265 → 1227 ms/s idle, within the noise)
  pin: {
    [PS]: [P('  const css = document.createElement(\'style\');\n  css.textContent = `\n    /* (one hue cycle of RAVE_TILE', `  // (every rainbow animation pinned to the page's time origin: in step, so they redraw in the same frames)${pinCode('pst-')}  const css = document.createElement('style');\n  css.textContent = \`\n    /* (one hue cycle of RAVE_TILE`)],
    [POST]: [P("  const css = document.createElement('style');\n  css.id = 'ps-css';", `  // (every rainbow animation pinned to the page's time origin: in step, so they redraw in the same frames)${pinCode('ps-')}  const css = document.createElement('style');\n  css.id = 'ps-css';`)],
  },
  // 2. smil: the icon rainbow's SVG animation (60 frames a second, forever, whether or not any icon uses it)
  // runs only while some icon or badge does
  smil: {
    [PS]: [P("  {\n    const NS = 'http://www.w3.org/2000/svg';\n    const svg = document.createElementNS(NS, 'svg');", "  let pstRb = null; // (the gradient's <svg>: its animation paused while nothing uses it, see apply)\n  {\n    const NS = 'http://www.w3.org/2000/svg';\n    const svg = document.createElementNS(NS, 'svg');\n    pstRb = svg;"),
      P('    const r = st?.rainbow || [];\n', "    const r = st?.rainbow || [];\n    try { if (r.includes('icons') || r.includes('logo')) pstRb.unpauseAnimations(); else pstRb.pauseAnimations(); } catch {}\n"),
      P("    defs.append(grad); svg.append(defs);\n    root.append(svg);\n  }\n\n  // the text colour", "    defs.append(grad); svg.append(defs);\n    root.append(svg);\n    try { svg.pauseAnimations(); } catch {}\n  }\n\n  // the text colour")],
    [POST]: [P("  {\n    const NS = 'http://www.w3.org/2000/svg';\n    const svg = document.createElementNS(NS, 'svg');", "  let psRb = null; // (the gradient's <svg>: its animation paused while no post uses it, see tick)\n  {\n    const NS = 'http://www.w3.org/2000/svg';\n    const svg = document.createElementNS(NS, 'svg');\n    psRb = svg;"),
      P("    defs.append(grad); svg.append(defs);\n    root.append(svg);\n  }\n\n  // --- the posts", "    defs.append(grad); svg.append(defs);\n    root.append(svg);\n    try { svg.pauseAnimations(); } catch {}\n  }\n\n  // --- the posts"),
      P("    } catch (e) { window.trif?.warn('post styler', String(e)); }\n  };\n  setInterval(tick, 800);", "      // (the icon rainbow's animation only while a post or card shows rainbow icons or a rainbow badge)\n      const want = !!document.querySelector('[data-ps-r~=icons], [data-ps-r~=badge]');\n      if (want === psRb.animationsPaused()) { if (want) psRb.unpauseAnimations(); else psRb.pauseAnimations(); }\n    } catch (e) { window.trif?.warn('post styler', String(e)); }\n  };\n  setInterval(tick, 800);")],
  },
  // (4. textvar, tried and dropped: the roll as one inherited variable animated on <html> restyled the whole page
  // 15 times a second, which cost more than the span animations: main thread 609 vs 387 ms/s idle)
  // 5. linehue: the lines' hue animated on what it colours, not inherited from <html> (lib/styler-fix-linehue.js)
  linehue: require('./styler-fix-linehue'),
  // (tried and dropped: "clock", lib/styler-fix-clock.js, the text roll and the hue stepped by a timer setting a
  // step number on <html>, one CSS rule per step: the GPU's work fell (781 → 462 ms/s idle) but every step
  // re-matched those long selectors against the page, main thread 412 → 800 ms/s)
  // 3. toggle: Style profile's colours copied from Edit profile (getComputedStyle, which made the browser
  // bring every animated element's style up to date, every 0.7 s) only when it's placed or the style changes
  toggle: {
    [PS]: [P("    if (edit.previousElementSibling !== toggle) edit.before(toggle);\n    const cs", "    if (edit.previousElementSibling !== toggle) edit.before(toggle);\n    else if (copiedFor === applied) return true;\n    copiedFor = applied;\n    const cs"),
      P("  const placeToggle = () => {", "  let copiedFor; // (the style on show when Edit profile's colours were last copied)\n  const placeToggle = () => {")],
  },
};

function applyFixes(base, code, names) {
  for (const name of names) {
    const f = FIXES[name];
    if (!f) throw new Error(`unknown fix ${name}`);
    for (const { find, replace } of f[base] || []) {
      const n = code.split(find).length - 1;
      if (n !== 1) throw new Error(`fix ${name}: anchor in ${base} found ${n} times:\n${find.slice(0, 200)}`);
      code = code.replace(find, () => replace);
    }
  }
  return code;
}

if (require.main === module) {
  const [src, out, only] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: styler-fixes.js <mods dir> <outDir> [fix,fix...]'); process.exit(2); }
  const names = only ? only.split(',') : DEFAULT_FIXES();
  fs.mkdirSync(out, { recursive: true });
  const files = [...new Set(names.flatMap((n) => Object.keys(FIXES[n] || {})))];
  for (const base of files) {
    const code = fs.readFileSync(path.join(src, base), 'utf8');
    for (const n of names) if (FIXES[n][base]) fs.writeFileSync(path.join(out, `${base.replace(/\.js$/, '')}.${n}.js`), applyFixes(base, code, [n]));
    fs.writeFileSync(path.join(out, base), applyFixes(base, code, names));
    console.log(`${base}: ${names.filter((n) => FIXES[n][base]).join(', ')} → ${path.join(out, base)}`);
  }
}
// (the fixes `fixed` and the command line apply by default; the others only by name)
const OPTIONAL = ['pin', 'smil']; // (smil: no gain measured, 1265 → 1204 ms/s with the animation gone altogether)
const DEFAULT_FIXES = () => Object.keys(FIXES).filter((n) => !OPTIONAL.includes(n));
module.exports = { FIXES, DEFAULT_FIXES, applyFixes, P };

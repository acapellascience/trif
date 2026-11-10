'use strict';
// Variants for tests/perf/stylers.js: ablations (what each feature costs: a feature taken out, in a patched copy
// made as the files are read, failing loudly if an anchor has moved), and fixes (lib/styler-fixes.js, by
// name: fix:<name>, or `fixed` for all of them). `a+b` combines. Ablations are for attributing cost: an
// ablated page doesn't look the same.
const { STYLES, styleForUrl } = require('./styles');
const { FIXES, DEFAULT_FIXES, applyFixes } = require('./styler-fixes');

const patch = (find, replace) => ({ find, replace });
const rx = (re, replace) => ({ re, replace });
const PS = 'profile-styler.js', POST = 'post-styler.js';
// (the stub for the picture reads: what the picture would have given, at once, nothing loaded or drawn; the
// stand-in's table, lib/styles.js, as the page's own script)
const STUB_TABLE = () => `const __perfStyle = (url) => { const m = /\\/profile_images\\/\\d+\\/(av\\d+|me)_\\w+\\.png$/.exec(url || ''); const t = ${JSON.stringify(Object.fromEntries(Object.entries(require('./styles').PICTURES).map(([k, s]) => [k, STYLES[s]])))}; const v = m && t[m[1]]; return v ? JSON.parse(JSON.stringify(v)) : null; };`;

const ABLATIONS = {
  // rainbow off: every rainbow shown as its plain colour (same colours, same layout, no rainbow rules match)
  'no-rainbow': {
    [PS]: [patch('    const r = st?.rainbow || [];', '    const r = [];')],
    [POST]: [patch('  const styleArt = (art, h, st) => {', '  const styleArt = (art, h, st) => { st = { ...st, rainbow: [] };'),
      patch('    setRainbow(a, (st.rainbow || []).includes(\'name\') ? [\'name\'] : []);\n    if ((st.rainbow || []).includes(\'name\')) wrapEmoji(a);', '    setRainbow(a, []);')],
  },
  'no-rave': { drop: ['rainbow-rave.js'] },
  'no-poststyler': { drop: [POST] },
  'no-inherit': { drop: ['site-inherits-profile-style.js'] },
  'no-encoder': { drop: ['style-encoder.js'] },
  'no-xflyer': { drop: ['space-shooter.js'] },
  'no-others': { drop: ['detox-timeline.js', 'follow-status.js', 'image-borders.js', 'space-shooter.js', 'rainbow-rave.js'] },
  'no-stylers': { drop: [PS, POST, 'site-inherits-profile-style.js', 'style-encoder.js'] },
  'bare': { drop: '*' },
  // the editing panel (and its Style profile button) never built into the page
  'no-panel': { [PS]: [patch('      if (own) placeToggle();', '      if (false) placeToggle();')] },
  // the picture reads stubbed: each answers at once with what its picture carries (no <img>, no canvas)
  'no-readcode': {
    [PS]: [patch('  const readCode = (url) => {\n    if (decoded.has(url)) return decoded.get(url);', `  ${STUB_TABLE()}\n  const readCode = (url) => {\n    if (decoded.has(url)) return decoded.get(url);\n    if (true) { const v = Promise.resolve(__perfStyle(url)); decoded.set(url, v); v.then((x) => decoded.set(url, x)); return v; }`)],
    [POST]: [patch('  const readCode = (url) => {\n    if (seenMap.has(url)) return Promise.resolve(seenMap.get(url) || null);', `  ${STUB_TABLE()}\n  const readCode = (url) => {\n    if (seenMap.has(url)) return Promise.resolve(seenMap.get(url) || null);\n    if (true) { const st = __perfStyle(url); remember(url, st); return Promise.resolve(st); }`)],
  },
  // (diagnostic: one kind of animation at a time taken out, everywhere in both stylers)
  'no-smil': { [PS]: [patch('    grad.append(roll);', '')], [POST]: [patch('    grad.append(roll);', '')] },
  'no-textroll': { [PS]: [rx(/animation: pst-text-roll[^;]*;/g, 'animation: none !important;')], [POST]: [rx(/animation: ps-text-roll[^;]*;/g, 'animation: none !important;')] },
  'no-boxroll': { [PS]: [rx(/animation: pst-(panel|box)-roll[^;]*;/g, 'animation: none !important;')], [POST]: [rx(/animation: ps-box-roll[^;]*;/g, 'animation: none !important;')] },
  'no-smallroll': { [PS]: [rx(/animation: pst-small-roll[^;]*;/g, 'animation: none;')] },
  'no-linehue': { [PS]: [rx(/animation: pst-line-hue[^;]*;/g, '')], [POST]: [rx(/animation: ps-line-hue[^;]*;/g, '')] },
  'no-bigroll': { [PS]: [rx(/animation: pst-big-roll[^;]*;/g, '')] },
  // (diagnostic: the rainbows not pinned to the window: background-attachment: fixed taken out)
  'no-fixed': { [PS]: [rx(/background-attachment: fixed !important;/g, '')], [POST]: [rx(/background-attachment: fixed !important;/g, '')] },
  'no-emoji': { [PS]: [patch("if (root.hasAttribute('data-pst-on') && anyRainbowText()) {", 'if (false) {')], [POST]: [patch('  const wrapEmoji = (scope) => {', '  const wrapEmoji = (scope) => { return;')] },
  // (diagnostic, Rainbow Rave: its icons' and counts' rolling rainbow, .8s linear, taken out)
  'no-rave-icons': { 'rainbow-rave.js': [rx(/animation: trif-rave-icons-roll[^;]*;/g, 'animation: none;')] },
  // the timers stopped after the page is styled (both stylers): what polling costs while idle
  'no-ticks': {
    [PS]: [patch('  setInterval(tick, 700);', '  { const t0 = Date.now(), id = setInterval(() => { if (Date.now() - t0 > 4000) clearInterval(id); else tick(); }, 700); }')],
    [POST]: [patch('  setInterval(tick, 800);', '  { const t0 = Date.now(), id = setInterval(() => { if (Date.now() - t0 > 4000) clearInterval(id); else tick(); }, 800); }')],
  },
};

function edit(mod, patches) {
  let code = mod.code;
  for (const { find, replace, re } of patches) {
    if (re) { if (!(code.match(re) || []).length) throw new Error(`variant: ${re} not in ${mod.base}`); code = code.replace(re, replace); continue; }
    const n = code.split(find).length - 1;
    if (n !== 1) throw new Error(`variant: anchor in ${mod.base} found ${n} times: ${find.slice(0, 120)}`);
    code = code.replace(find, () => replace);
  }
  return { ...mod, code, patched: true };
}

/** mods: [{base, code, ...}] → the variant's mods. */
function applyVariant(variant, mods) {
  if (variant === 'none') return mods;
  let out = mods;
  for (const v of variant.split('+')) {
    if (v === 'fixed' || v.startsWith('fix:')) {
      const names = v === 'fixed' ? DEFAULT_FIXES() : v.slice(4).split('&');
      out = out.map((m) => { const code = applyFixes(m.base, m.code, names); return code === m.code ? m : { ...m, code, patched: true }; });
      continue;
    }
    const a = ABLATIONS[v];
    if (!a) throw new Error(`unknown variant ${v}`);
    if (a.drop === '*') { out = []; continue; }
    if (a.drop) out = out.filter((m) => !a.drop.includes(m.base));
    out = out.map((m) => (a[m.base] ? edit(m, a[m.base]) : m));
  }
  return out;
}
const knownVariant = (v) => v === 'none' || v.startsWith('@') || v.split('+').every((x) => ABLATIONS[x] || x === 'fixed' || (x.startsWith('fix:') && x.slice(4).split('&').every((f) => FIXES[f])));

module.exports = { ABLATIONS, applyVariant, knownVariant, styleForUrl };

'use strict';
// What a sandboxed mod's code uses that TRIF's sandbox doesn't give it (extension/sandbox.js), for `trif
// check`. A lint, not a hold: a sandboxed mod never waits for the user's OK, because whatever it tries
// outside TRIF's API simply isn't there when it runs (SES enforces that, not this reading). This only
// tells the agent early, so it can rewrite the mod with the API or make it a page script instead.
//
//   sandboxLint(code) -> [{ what, why, lines: [line numbers] }]
//
// A reading of tokens (lib/powers.js tokenize), so it can be wrong both ways (a local variable named like
// a browser global it doesn't declare in a way this sees, say); the sandbox is the real check.

const { tokenize } = require('./powers');

// Names a page script has that a sandboxed mod doesn't (it has page, trif, console, the timers, Math,
// Date, the language, and the pure tools sandbox.js SANDBOX_EXTRA_GLOBALS lists: Float32Array, Float64Array,
// URL, URLSearchParams, Intl, TextEncoder, TextDecoder, structuredClone, atob, btoa, performance.now).
const PAGE_GLOBALS = new Set([
  'window', 'document', 'self', 'top', 'parent', 'frames', 'opener', 'globalThis.document', 'location', 'history', 'navigator',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'WebTransport', 'RTCPeerConnection', 'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'postMessage', 'open', 'close',
  'alert', 'confirm', 'prompt', 'print', 'Image', 'Audio', 'Option', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'getComputedStyle', 'matchMedia', 'CSS', 'Blob', 'File', 'FileReader', 'crypto',
  'chrome', 'browser', 'unsafeWindow', 'eval', 'Function', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'PointerEvent',
  'InputEvent', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'DOMParser', 'AudioContext', 'OfflineAudioContext', 'Notification',
  'customElements', 'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask', 'scrollTo', 'scrollBy', 'innerWidth', 'innerHeight',
  'devicePixelRatio', 'screen', 'visualViewport', 'DOMPoint', 'ImageData', 'Path2D', 'OffscreenCanvas', 'createImageBitmap',
]);
// The language's names SES leaves out of every compartment (and TRIF doesn't add)
const LANGUAGE_MISSING = new Set(['SharedArrayBuffer', 'Atomics', 'WeakRef', 'FinalizationRegistry', 'WebAssembly', 'Float16Array']);
// Where the API has what a page global did
const GLOBAL_TIPS = {
  MutationObserver: 'use trif.observe(selector, fn, { attributes }) or trif.changes(selector, fn)',
  ResizeObserver: 'use el.onResize(fn)', IntersectionObserver: 'use el.onVisible(fn, { threshold, rootMargin })',
  matchMedia: 'use page.matchMedia(query)', devicePixelRatio: 'use page.devicePixelRatio', getComputedStyle: 'use el.style(property)',
  innerWidth: 'use page.width', innerHeight: 'use page.height', location: 'use page.url (and trif.onUrl)', document: 'use page (page.find, page.body, page.create)',
  AudioContext: 'use trif.audio() (the sound power)', OfflineAudioContext: 'use trif.audio().render(seconds, build)', DOMPoint: 'el.isPointInFill(x, y) takes numbers',
  ImageData: 'getImageData and putImageData take and give { width, height, data }',
};
// What a page script does with real elements that TRIF's stand-ins do another way.
const ELEMENT_MEMBERS = {
  innerHTML: 'use setText, or build it with page.create and append', outerHTML: 'use setText, or build it with page.create and append',
  insertAdjacentHTML: 'use page.create and before/after/append', setHTMLUnsafe: 'use page.create and append',
  addEventListener: 'use on(type, fn)', removeEventListener: 'use the function on() returns',
  querySelector: 'use find(selector)', querySelectorAll: 'use findAll(selector)', getElementById: 'use page.find("#id")',
  getElementsByClassName: 'use findAll(".name")', getElementsByTagName: 'use findAll("tag")',
  appendChild: 'use append', insertBefore: 'use before', removeChild: 'use remove()', replaceChildren: 'use remove() and append',
  setAttribute: 'use setAttr', getAttribute: 'use attr', removeAttribute: 'use removeAttr', classList: 'use classes.add / remove / toggle / has',
  textContent: 'use text / setText', parentElement: 'use parent', parentNode: 'use parent',
  nextElementSibling: 'use next', previousElementSibling: 'use previous', cloneNode: 'use clone()', getBoundingClientRect: 'use rect()',
  getContext: 'use canvas()', click: 'a boxed mod can\'t click for the user', dispatchEvent: 'a boxed mod can\'t act for the user',
  submit: 'a boxed mod can\'t submit', requestSubmit: 'a boxed mod can\'t submit',
  setPointerCapture: 'use capturePointer(e.pointerId), on the mod\'s own elements', releasePointerCapture: 'use releasePointer(e.pointerId)',
  getAnimations: 'use animations()', getBBox: 'use bbox()', getTotalLength: 'use totalLength()', getPointAtLength: 'use pointAtLength(length)',
  createElementNS: 'use page.createSvg(tag)', splitText: 'use trif.wrap(selector, /pattern/, fn)', toBlob: 'use toDataURL()',
  contentWindow: 'other frames are out of reach', contentDocument: 'other frames are out of reach', shadowRoot: 'not offered in a boxed mod',
};
const DECLARE = new Set(['const', 'let', 'var', 'function', 'class']);

function sandboxLint(code, { powers = [] } = {}) {
  const has = new Set(powers);
  const text = String(code || '');
  const found = new Map(); // what -> {what, why, lines:Set}
  const add = (what, why, line) => {
    if (!found.has(what)) found.set(what, { what, why, lines: new Set() });
    found.get(what).lines.add(line);
  };
  // What SES itself refuses in the source, even inside strings and comments
  text.split('\n').forEach((l, i) => {
    if (/\bimport\s*\(/.test(l)) add('import(', 'SES refuses source with "import(" in it, even in a string or comment ("Possible import expression rejected"): reword it', i + 1);
    if (/<!--|-->/.test(l)) add('<!-- or -->', 'SES refuses source with an HTML comment marker in it, even in a string ("Possible HTML comment rejected"): split it, as \'<\' + \'!--\'', i + 1);
  });
  let ts;
  try { ts = tokenize(text); } catch { return finish(found); }
  // Names the mod declares itself (const/let/var/function/class, and simple parameters)
  const declared = new Set();
  // (one declarator's name at ts[i]: a name, or a destructuring: const { a, b } = …, const [a, b] = …)
  const declareAt = (i) => {
    const n = ts[i];
    if (n && n.t === 'id') declared.add(n.v);
    if (n && n.t === 'p' && (n.v === '{' || n.v === '[')) {
      const close = n.v === '{' ? '}' : ']';
      for (let j = i + 1, depth = 1; j < ts.length && depth; j++) {
        if (ts[j].t === 'p' && ts[j].v === n.v) depth++;
        else if (ts[j].t === 'p' && ts[j].v === close) depth--;
        else if (ts[j].t === 'id' && !(ts[j + 1] && ts[j + 1].t === 'p' && ts[j + 1].v === ':')) declared.add(ts[j].v);
      }
    }
  };
  const OPEN = { '(': ')', '[': ']', '{': '}' };
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    if (t.t === 'id' && DECLARE.has(t.v)) {
      declareAt(k + 1);
      // (and the names after it: const a = 1, b = 2: each comma outside brackets until the statement ends)
      if (t.v === 'const' || t.v === 'let' || t.v === 'var') {
        const stack = [];
        for (let j = k + 2; j < ts.length && j < k + 20000; j++) {
          const x = ts[j];
          if (x.t !== 'p') continue;
          if (OPEN[x.v]) { stack.push(OPEN[x.v]); continue; }
          if (x.v === ')' || x.v === ']' || x.v === '}') { if (stack.pop() !== x.v) break; continue; }
          if (stack.length) continue;
          if (x.v === ';') break;
          if (x.v === ',') declareAt(j + 1);
        }
      }
      if (t.v === 'function') { // its parameters
        let j = k + 1;
        if (ts[j] && ts[j].t === 'id') j++;
        if (ts[j] && ts[j].t === 'p' && ts[j].v === '(') for (j++; j < ts.length && !(ts[j].t === 'p' && ts[j].v === ')'); j++) if (ts[j].t === 'id') declared.add(ts[j].v);
      }
    }
    if (t.t === 'p' && t.v === '=>') { // an arrow's parameters
      const p = ts[k - 1];
      if (p && p.t === 'id') declared.add(p.v);
      else if (p && p.t === 'p' && p.v === ')') for (let j = k - 2, depth = 1; j >= 0 && depth; j--) {
        if (ts[j].t === 'p' && ts[j].v === ')') depth++;
        else if (ts[j].t === 'p' && ts[j].v === '(') depth--;
        else if (ts[j].t === 'id') declared.add(ts[j].v);
      }
    }
    if (t.t === 'id' && t.v === 'catch' && ts[k + 1] && ts[k + 1].v === '(' && ts[k + 2] && ts[k + 2].t === 'id') declared.add(ts[k + 2].v);
  }
  const own = (v) => String(v).trim().split(/\s+/).filter(Boolean).every((x) => /^trif-box-/.test(x));
  // (what a power gives, used without declaring it: docs/POWERS.md)
  const powerUse = (what, power, line) => { if (!has.has(power)) add(what, `needs the ${power} power: add \`// @powers ${power}\` to the header (the user approves it once)`, line); };
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    if (t.t !== 'id') continue;
    const prev = ts[k - 1], next = ts[k + 1];
    const member = prev && prev.t === 'p' && (prev.v === '.' || prev.v === '?.');
    // Names a mod gives must be TRIF's (extension/sandbox.js: the page's own code acts on data-*, ids, classes)
    const arg = (i) => ts[k + 2 + i * 2];
    if (member && next && next.v === '(' && (t.v === 'setAttr' || t.v === 'removeAttr') && arg(0) && arg(0).t === 'str') {
      const n = arg(0).v.toLowerCase();
      if (/^data-/.test(n) && !/^data-trif-box-/.test(n)) add(`${t.v}('${n}')`, 'only data-trif-box-* data attributes are offered (the page\'s own code, or a free mod, could act on others): name it data-trif-box-…', t.line);
      if (t.v === 'setAttr' && (n === 'id' || n === 'class') && arg(1) && arg(1).t === 'str' && !own(arg(1).v)) add(`setAttr('${n}', '${arg(1).v.slice(0, 40)}')`, `${n === 'id' ? 'an id' : 'classes'} a boxed mod gives must start with trif-box-`, t.line);
    }
    if (member && next && next.v === '(' && /^(find|findAll|closest|matches|observe|text|hide)$/.test(t.v) && arg(0) && arg(0).t === 'str' && (/\\/.test(arg(0).v) || /\[\s*(?:[\w*-]*\|)?value\b|:(?:-webkit-)?autofill\b/i.test(arg(0).v))) {
      add(`${t.v}('${arg(0).v.slice(0, 40)}')`, 'selectors can\'t have \\ escapes, or name the value attribute or :autofill (they\'d read what\'s typed in a field)', t.line);
    }
    if (member && t.v === 'audio' && prev && ts[k - 2] && ts[k - 2].v === 'trif') powerUse('trif.audio', 'sound', t.line);
    if (member && t.v === 'create' && next && next.v === '(' && arg(0) && arg(0).t === 'str' && /^(input|select|option)$/i.test(arg(0).v)) powerUse(`create('${arg(0).v}')`, 'controls', t.line);
    if (member && next && next.v === '(' && /^(add|remove|toggle)$/.test(t.v) && ts[k - 2] && ts[k - 2].v === 'classes' && arg(0) && arg(0).t === 'str' && !own(arg(0).v)) {
      add(`classes.${t.v}('${arg(0).v.slice(0, 40)}')`, 'classes a boxed mod adds, removes or toggles must start with trif-box- (the page\'s own code, or a free mod, acts on classes)', t.line);
    }
    // (phase 3: the page's media, clicking what the header names, going to a page, a channel, changing drafts)
    if (member && next && next.v === '(') {
      if (t.v === 'click') { powerUse('.click()', 'click', t.line); continue; }
      // (the page's media: play() and pause() take nothing; trif.audio()'s play(sound, options) is the sound power's)
      const noArgs = ts[k + 2] && ts[k + 2].t === 'p' && ts[k + 2].v === ')';
      // (and on what reads as the page's media: a name like video or player, or a find('video…') just before;
      // an animation's play() and pause() are the mod's own)
      const recv = ts[k - 2];
      const mediaLike = (recv && recv.t === 'id' && /video|audio|media|player|clip|song|track/i.test(recv.v)) || ts.slice(Math.max(0, k - 8), k).some((x) => x.t === 'str' && /\b(video|audio)\b/i.test(x.v));
      if ((/^(play|pause)$/.test(t.v) && noArgs && mediaLike) || /^(setMuted|setVolume|seek)$/.test(t.v)) powerUse(`.${t.v}()`, 'media', t.line);
      if (t.v === 'setValue' && !has.has('controls')) powerUse('.setValue()', 'write-drafts', t.line);
      if ((t.v === 'goTo' || t.v === 'channel') && ts[k - 2] && ts[k - 2].v === 'trif') powerUse(`trif.${t.v}`, t.v === 'goTo' ? 'go-to' : 'mods', t.line);
    }
    if (member) {
      const base = ts[k - 2];
      const assigned = next && next.t === 'p' && next.v === '=';
      // (`.style.x`: a real element's style object; a stand-in's style is a function)
      if (t.v === 'style' && next && next.t === 'p' && next.v === '.') add('.style.…', 'a stand-in\'s style is style(property, value) (and inlineStyle(property) reads its style attribute)', t.line);
      else if (base && base.v === 'performance' && t.v !== 'now') add(`performance.${t.v}`, 'a boxed mod has performance.now() only (the rest lists what the page loaded)', t.line);
      else if (base && base.v === 'URL' && /^(createObjectURL|revokeObjectURL)$/.test(t.v)) add(`URL.${t.v}`, 'not there in a boxed mod: it would make a blob: address (a canvas\'s toDataURL() makes a data: one)', t.line);
      else if (assigned && /^(innerText|scrollTop|scrollLeft|offsetWidth|offsetHeight|clientWidth|clientHeight|scrollWidth|scrollHeight)$/.test(t.v)) add(`.${t.v} =`, t.v === 'innerText' ? 'use setText' : `a stand-in's ${t.v} is read only (scrolling the page's elements would make it load more)`, t.line);
      else if (Object.prototype.hasOwnProperty.call(ELEMENT_MEMBERS, t.v)) {
        const tip = ELEMENT_MEMBERS[t.v];
        add(`.${t.v}`, tip.startsWith('use ') ? `elements are TRIF's stand-ins here: ${tip}` : tip, t.line);
      }
      continue;
    }
    const key = next && next.t === 'p' && next.v === ':' && prev && prev.t === 'p' && (prev.v === '{' || prev.v === ',');
    if (key || declared.has(t.v)) continue;
    if (PAGE_GLOBALS.has(t.v)) add(t.v, `not there in a boxed mod: it has page, trif, console, the timers, Math, Date, the language and its pure tools (URL, Intl, typed arrays…)${GLOBAL_TIPS[t.v] ? `: ${GLOBAL_TIPS[t.v]}` : ''}`, t.line);
    if (LANGUAGE_MISSING.has(t.v)) add(t.v, 'not there in a boxed mod: the sandbox (SES) leaves it out of every mod', t.line);
    if ((t.v === 'setTimeout' || t.v === 'setInterval') && next && next.v === '(' && ts[k + 2] && (ts[k + 2].t === 'str' || ts[k + 2].t === 'tpl')) add(`${t.v}("…")`, 'timers take a function, not code in a string', t.line);
  }
  return finish(found);
}

/**
 * Could this free mod be a boxed one? Only when everything the sandbox wouldn't give it has a box equivalent
 * (the page's elements as stand-ins, page for document, trif.observe for MutationObserver…), and nothing needs
 * the page's own world (fetch or XHR, the page's code or globals, window, storage, frames…). A reading, so it
 * errs towards saying nothing. -> { boxable: boolean, swaps: ['document: use page (…)', …] }
 */
function boxable(code) {
  const lint = sandboxLint(code, { powers: Object.keys(POWER_FREE) });
  const swaps = [];
  for (const f of lint) {
    const tip = /^elements are TRIF's stand-ins here: (use .*)$/.exec(f.why) || /: (use .*)$/.exec(f.why);
    const swappable = (f.why.startsWith('elements are TRIF\'s stand-ins') || f.what === '.style.…' || (PAGE_GLOBALS.has(f.what) && Object.prototype.hasOwnProperty.call(BOX_GLOBALS, f.what)));
    if (!swappable) return { boxable: false, swaps: [] };
    swaps.push(`${f.what}: ${f.what === '.style.…' ? 'use style(property, value)' : tip ? tip[1] : f.why}`);
  }
  return { boxable: true, swaps };
}
// (page globals a DOM-only free mod uses that the box has in another form: GLOBAL_TIPS, minus the ones needing a power)
const BOX_GLOBALS = Object.fromEntries(Object.entries(GLOBAL_TIPS).filter(([k]) => !/AudioContext|DOMPoint|ImageData/.test(k)));
// (powers are a question of their own: the lint is read as if the mod had them, so only the page's world counts here)
const POWER_FREE = { sound: 1, controls: 1, click: 1, media: 1, 'write-drafts': 1, 'go-to': 1, mods: 1 };

function finish(found) {
  return [...found.values()].map((f) => ({ what: f.what, why: f.why, lines: [...f.lines].sort((a, b) => a - b) })).sort((a, b) => a.lines[0] - b.lines[0]);
}

module.exports = { boxable, sandboxLint, PAGE_GLOBALS, LANGUAGE_MISSING };

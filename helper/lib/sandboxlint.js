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
// Date and the language).
const PAGE_GLOBALS = new Set([
  'window', 'document', 'self', 'top', 'parent', 'frames', 'opener', 'globalThis.document', 'location', 'history', 'navigator',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'WebTransport', 'RTCPeerConnection', 'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'postMessage', 'open', 'close',
  'alert', 'confirm', 'prompt', 'print', 'Image', 'Audio', 'Option', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'getComputedStyle', 'matchMedia', 'CSS', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'crypto', 'performance',
  'chrome', 'browser', 'unsafeWindow', 'eval', 'Function', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'PointerEvent',
  'InputEvent', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'DOMParser', 'AudioContext', 'OfflineAudioContext', 'Notification',
  'customElements', 'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask', 'structuredClone', 'atob', 'btoa', 'TextEncoder',
  'TextDecoder', 'Intl', 'scrollTo', 'scrollBy', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'screen', 'visualViewport',
]);
// What a page script does with real elements that TRIF's stand-ins do another way.
const ELEMENT_MEMBERS = {
  innerHTML: 'use setText, or build it with page.create and append', outerHTML: 'use setText, or build it with page.create and append',
  insertAdjacentHTML: 'use page.create and before/after/append', setHTMLUnsafe: 'use page.create and append',
  addEventListener: 'use on(type, fn)', removeEventListener: 'use the function on() returns',
  querySelector: 'use find(selector)', querySelectorAll: 'use findAll(selector)', getElementById: 'use page.find("#id")',
  getElementsByClassName: 'use findAll(".name")', getElementsByTagName: 'use findAll("tag")',
  appendChild: 'use append', insertBefore: 'use before', removeChild: 'use remove()', replaceChildren: 'use remove() and append',
  setAttribute: 'use setAttr', getAttribute: 'use attr', removeAttribute: 'use removeAttr', classList: 'use classes.add / remove / toggle / has',
  textContent: 'use text / setText', innerText: 'use text / setText', parentElement: 'use parent', parentNode: 'use parent',
  nextElementSibling: 'use next', previousElementSibling: 'use previous', cloneNode: 'use clone()', getBoundingClientRect: 'use rect()',
  getContext: 'use canvas()', click: 'a boxed mod can\'t click for the user', dispatchEvent: 'a boxed mod can\'t act for the user',
  submit: 'a boxed mod can\'t submit', requestSubmit: 'a boxed mod can\'t submit', focus: 'not offered in a boxed mod',
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
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    if (t.t === 'id' && DECLARE.has(t.v)) {
      const n = ts[k + 1];
      if (n && n.t === 'id') declared.add(n.v);
      // (destructuring: const { a, b } = …, const [a, b] = …)
      if (n && n.t === 'p' && (n.v === '{' || n.v === '[')) {
        const close = n.v === '{' ? '}' : ']';
        for (let j = k + 2, depth = 1; j < ts.length && depth; j++) {
          if (ts[j].t === 'p' && ts[j].v === n.v) depth++;
          else if (ts[j].t === 'p' && ts[j].v === close) depth--;
          else if (ts[j].t === 'id' && !(ts[j + 1] && ts[j + 1].t === 'p' && ts[j + 1].v === ':')) declared.add(ts[j].v);
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
      if (/^(play|pause|setMuted|setVolume|seek)$/.test(t.v)) powerUse(`.${t.v}()`, 'media', t.line);
      if (t.v === 'setValue' && !has.has('controls')) powerUse('.setValue()', 'write-drafts', t.line);
      if ((t.v === 'goTo' || t.v === 'channel') && ts[k - 2] && ts[k - 2].v === 'trif') powerUse(`trif.${t.v}`, t.v === 'goTo' ? 'go-to' : 'mods', t.line);
    }
    if (member) {
      // (`.style.x`: a real element's style object; a stand-in's style is a function)
      if (t.v === 'style' && next && next.t === 'p' && next.v === '.') add('.style.…', 'a stand-in\'s style is style(property, value)', t.line);
      else if (Object.prototype.hasOwnProperty.call(ELEMENT_MEMBERS, t.v)) {
        const tip = ELEMENT_MEMBERS[t.v];
        add(`.${t.v}`, tip.startsWith('use ') ? `elements are TRIF's stand-ins here: ${tip}` : tip, t.line);
      }
      continue;
    }
    const key = next && next.t === 'p' && next.v === ':' && prev && prev.t === 'p' && (prev.v === '{' || prev.v === ',');
    if (key || declared.has(t.v)) continue;
    if (PAGE_GLOBALS.has(t.v)) add(t.v, 'not there in a boxed mod: it has page, trif, console, the timers, Math, Date and the language', t.line);
    if ((t.v === 'setTimeout' || t.v === 'setInterval') && next && next.v === '(' && ts[k + 2] && (ts[k + 2].t === 'str' || ts[k + 2].t === 'tpl')) add(`${t.v}("…")`, 'timers take a function, not code in a string', t.line);
  }
  return finish(found);
}

function finish(found) {
  return [...found.values()].map((f) => ({ what: f.what, why: f.why, lines: [...f.lines].sort((a, b) => a - b) })).sort((a, b) => a.lines[0] - b.lines[0]);
}

module.exports = { sandboxLint, PAGE_GLOBALS };

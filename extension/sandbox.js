// Sandboxed mods (docs/SAFE-MODS.md "Sandboxed: what's built"). A `// @sandboxed` mod's code runs in a
// Secure EcmaScript (SES) Compartment, inside TRIF's own userScripts world (SANDBOX_WORLD). The
// compartment's global holds only the JavaScript language (frozen by lockdown) and what TRIF hands it:
// `page`, `trif`, `console`, the timers, `Math` and `Date`. No window, document, element, event
// constructor, fetch, storage, frame or browser API is reachable from the mod unless it's in that list, so
// nor is anything browsers add later. The page's elements reach the mod only as TRIF-made stand-ins: frozen
// objects whose methods are TRIF's, allowlisted (tags, attributes, addresses, CSS), with the real node kept
// out of reach.
//
// What's registered (lib.js modToUserScript, sandboxRuntimeScript):
//  - once per page, in TRIF's world: vendor/ses.umd.min.js (SES 2.3.0, Apache-2.0), then
//    sandboxRuntimeCode(): lockdown() once, and globalThis.__trifSandbox, which runs each mod;
//  - each mod, in the same world: sandboxModCode(id, source), which hands the source to __trifSandbox (or
//    queues it, if the runtime isn't there yet: registration order is injection order, but a mod mustn't
//    depend on it);
//  - in a browser that can't host the world (Safari; see SANDBOX_BROWSERS in lib.js), a sandboxed mod the
//    user allowed runs as a page script instead: sandboxPageCode(id, source), the same API built in the
//    page's own world around the mod's code, with nothing confined (that's why it waits for the user's OK).
//
// Everything below runs in the page (serialized with Function.prototype.toString), so it's self-contained.

export const SANDBOX_WORLD = 'trif-sandbox';
export const SANDBOX_RUNTIME_ID = 'trif-sandbox-runtime';
export const SES_FILE = 'vendor/ses.umd.min.js';
// What that file must be: ses 2.3.0's dist/ses.umd.min.js from npm, unchanged (scripts/build-extension.js and
// tests/sandbox.test.js check it; extension/vendor/README.txt).
export const SES_SHA256 = '2ac48b2cda4e2e466a49a4acc7aab0288567e0c10ce96c0970ef1cadd0cec566';
// The world's own Content Security Policy. SES evaluates the mod's code with eval inside its compartment, so
// 'unsafe-eval' (the compartment itself has no eval or Function); nothing may connect anywhere; loads only
// from data:/blob: (and images from the page's own site, which TRIF's address check narrows further).
export const SANDBOX_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
// The names a sandboxed mod has besides the language (the API: docs/SAFE-MODS.md, TECHNIQUES.md).
export const SANDBOX_GLOBALS = ['page', 'trif', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Math', 'Date'];
// And, in TRIF's world, the language's and the browser's pure tools (frozen): sandboxRuntime's EXTRA.
export const SANDBOX_EXTRA_GLOBALS = ['Float32Array', 'Float64Array', 'URL', 'URLSearchParams', 'Intl', 'TextEncoder', 'TextDecoder', 'structuredClone', 'atob', 'btoa', 'performance'];
// The most a mod's settings may take on one site, as JSON, all its keys together (background.js keeps them);
// and all the boxed mods' settings on one site together.
export const SETTINGS_MAX = 1024 * 1024;
export const SETTINGS_SITE_MAX = 8 * SETTINGS_MAX;

const J = (v) => JSON.stringify(String(v));

/** The world's runtime: lockdown once, then __trifSandbox.run(id, source) per mod. */
export function sandboxRuntimeCode() {
  return `(${sandboxRuntime.toString()})('sandbox');\n//# sourceURL=trif-sandbox://runtime.js`;
}

/**
 * One sandboxed mod, in TRIF's world: its source, handed to the runtime as text (SES evaluates it), with its
 * powers (docs/POWERS.md), which come from its header as the helper read it, not from its code.
 */
// (a mod's powers, from its header as the helper read it: a list of names, or {powers, args})
const grantOf = (g) => {
  const names = Array.isArray(g) ? g : g && Array.isArray(g.powers) ? g.powers : [];
  const args = g && !Array.isArray(g) && g.args && typeof g.args === 'object' ? g.args : {};
  return JSON.stringify({ powers: names.map(String), args: Object.fromEntries(Object.entries(args).map(([k, v]) => [String(k), (Array.isArray(v) ? v : []).map(String)])) });
};
export function sandboxModCode(id, source, powers = []) {
  const P = grantOf(powers);
  return `(globalThis.__trifSandbox ? globalThis.__trifSandbox.run(${J(id)}, ${J(source)}, ${P}) : (globalThis.__trifSandboxQueue = globalThis.__trifSandboxQueue || []).push([${J(id)}, ${J(source)}, ${P}]));\n//# sourceURL=trif-sandbox://${id}.js`;
}

/**
 * A sandboxed mod run as a page script (a browser without TRIF's world, once the user allowed it): the
 * same API, built in the page's world, around the mod's code, which has everything the page has.
 */
export function sandboxPageCode(id, source, powers = []) {
  // (the mod's first line is the script's first line, so `trif errors` gives its own line numbers)
  const P = grantOf(powers);
  return `(() => { const __trifMod = async function (${SANDBOX_GLOBALS.filter((n) => n !== 'Math' && n !== 'Date').join(', ')}) { "use strict"; ${source}\n};\n(${sandboxRuntime.toString()})('page', ${J(id)}, __trifMod, ${P}); })();\n//# sourceURL=trif://${id}.js`;
}

/**
 * The runtime. mode 'sandbox': in TRIF's world, with SES loaded; installs globalThis.__trifSandbox. mode
 * 'page': in the page's world (no SES, nothing confined), runs `fn` with the API as its arguments.
 */
export function sandboxRuntime(mode, pageModId, pageFn, pagePowers) {
  const G = globalThis;
  const SANDBOX = mode === 'sandbox';
  if (SANDBOX && G.__trifSandbox) return;
  // What it costs, for `trif`'s e2e and anyone measuring (__trifSandbox.stats): SES's own load (from the stamp
  // put before it: sandboxRuntimeScript), lockdown, each mod's first run, and the mods' callbacks.
  const now = () => performance.now();
  let nativeStack = null; // (Firefox: Error.prototype's own stack getter, kept before lockdown)
  let closedRootOf = null; // (el) -> its shadow root, open or closed, where TRIF's world can see that
  const stats = { sesMs: typeof G.__trifT0 === 'number' ? now() - G.__trifT0 : null, lockdownMs: null, startedAt: now(), mods: {}, callbacks: 0, callbackMs: 0, closedRoots: 'none' };
  if (!closedRootOf && typeof Element !== 'undefined') {
    const od = Object.getOwnPropertyDescriptor(Element.prototype, 'openOrClosedShadowRoot');
    if (od && typeof od.get === 'function') { closedRootOf = (el) => od.get.call(el); stats.closedRoots = 'Element.openOrClosedShadowRoot'; }
  }
  // (TRIF's world: messaging to TRIF's background is for TRIF's code only, captured before any mod runs;
  // mods never get `chrome`: their global is the compartment's)
  let send = null;
  if (SANDBOX) {
    const rt = (G.chrome && G.chrome.runtime) || (G.browser && G.browser.runtime);
    if (rt && typeof rt.sendMessage === 'function') { const sm = rt.sendMessage; send = (m) => sm.call(rt, m); }
    // (a way to see an element's closed shadow root, where the browser gives TRIF's world one: Chrome's
    // chrome.dom for extensions, or Firefox's Element.openOrClosedShadowRoot; for the keys rule, below)
    const dom = G.chrome && G.chrome.dom;
    if (dom && typeof dom.openOrClosedShadowRoot === 'function') { const cd = dom.openOrClosedShadowRoot; closedRootOf = (el) => cd.call(dom, el); stats.closedRoots = 'chrome.dom'; }
    try { delete G.chrome; } catch { /* kept: unreachable from mods anyway */ }
    try { delete G.browser; } catch { /* as above */ }
    // The language locked down once per world (every sandboxed mod in this page shares it). Built-ins newer
    // than SES knows are removed (reporting 'none': it would otherwise list them in the console each time).
    // (errorTaming 'safe': a mod can't read any error's stack, which names TRIF's files; TRIF's own code reads
    // them with SES's getStackString, which only this world's start compartment has, for `trif errors`)
    // (Firefox keeps an error's stack behind an accessor on Error.prototype, which safe taming replaces for
    // everyone: TRIF keeps the original first, for its own reading)
    const sd = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
    if (sd && typeof sd.get === 'function') nativeStack = sd.get;
    const tl = now();
    G.lockdown({ errorTaming: 'safe', consoleTaming: 'unsafe', overrideTaming: 'severe', stackFiltering: 'concise', reporting: 'none' });
    stats.lockdownMs = now() - tl;
  }
  // What a boxed mod has besides TRIF's API and what SES gives every compartment: the language's floating-point
  // typed arrays (frozen by lockdown, kept out of compartments by SES), Intl, and the browser's pure tools as
  // TRIF's own small classes around them, frozen: URL (a parser, with no createObjectURL or revokeObjectURL),
  // URLSearchParams, TextEncoder, TextDecoder, structuredClone, atob, btoa and performance.now(). TRIF's own, as
  // the browser's objects can't be frozen everywhere (Firefox's are wrappers) and no mod may change them for
  // another, or for TRIF's own code in this world. A browser error reaches the mod as plain text.
  const EXTRA = {};
  if (SANDBOX) {
    const plain = (fn) => (...a) => { try { return fn(...a); } catch (e) { throw new TypeError(String(e && e.message ? e.message : e).slice(0, 500)); } };
    const NURL = G.URL, NParams = G.URLSearchParams, NEnc = G.TextEncoder, NDec = G.TextDecoder;
    for (const n of ['Float32Array', 'Float64Array']) if (typeof G[n] === 'function') EXTRA[n] = G[n];
    if (G.Intl && typeof G.Intl === 'object') { try { EXTRA.Intl = G.harden(G.Intl); } catch { /* not this browser's to freeze: not offered */ } }
    const inner = new WeakMap();
    const paramsOf = (native) => { const o = Object.create(TrifParams.prototype); inner.set(o, native); return o; };
    class TrifParams {
      constructor(init) {
        let src = init === undefined ? '' : init;
        if (src && typeof src === 'object') {
          const pairs = inner.has(src) ? [...inner.get(src)] : typeof src[Symbol.iterator] === 'function' ? [...src] : Object.entries(src);
          src = pairs.map(([k, v]) => `${encodeURIComponent(String(k))}=${encodeURIComponent(String(v))}`).join('&');
        }
        inner.set(this, new NParams(String(src)));
      }
      get size() { return [...inner.get(this)].length; }
      get(k) { return inner.get(this).get(String(k)); }
      getAll(k) { return [...inner.get(this).getAll(String(k))]; }
      has(k) { return inner.get(this).has(String(k)); }
      set(k, v) { inner.get(this).set(String(k), String(v)); }
      append(k, v) { inner.get(this).append(String(k), String(v)); }
      delete(k) { inner.get(this).delete(String(k)); }
      sort() { inner.get(this).sort(); }
      toString() { return String(inner.get(this)); }
      entries() { return [...inner.get(this)].map(([k, v]) => [k, v])[Symbol.iterator](); }
      keys() { return [...inner.get(this).keys()][Symbol.iterator](); }
      values() { return [...inner.get(this).values()][Symbol.iterator](); }
      forEach(fn) { for (const [k, v] of [...inner.get(this)]) fn(v, k, this); }
      [Symbol.iterator]() { return this.entries(); }
    }
    class TrifURL {
      constructor(u, base) { inner.set(this, plain(() => (base === undefined ? new NURL(String(u)) : new NURL(String(u), String(base))))()); }
      static canParse(u, base) { try { if (base === undefined) new NURL(String(u)); else new NURL(String(u), String(base)); return true; } catch { return false; } }
      get searchParams() { return paramsOf(inner.get(this).searchParams); }
      get origin() { return inner.get(this).origin; }
      toString() { return inner.get(this).href; }
      toJSON() { return inner.get(this).href; }
    }
    for (const k of ['href', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'username', 'password']) {
      Object.defineProperty(TrifURL.prototype, k, { get() { return inner.get(this)[k]; }, set(v) { plain(() => { inner.get(this)[k] = String(v); })(); }, enumerable: true, configurable: true });
    }
    class TrifTextEncoder {
      get encoding() { return 'utf-8'; }
      encode(s = '') { return new Uint8Array(new NEnc().encode(String(s))); }
    }
    class TrifTextDecoder {
      constructor(label, o) { inner.set(this, plain(() => new NDec(label === undefined ? 'utf-8' : String(label), { fatal: !!(o && o.fatal), ignoreBOM: !!(o && o.ignoreBOM) }))()); }
      get encoding() { return inner.get(this).encoding; }
      get fatal() { return inner.get(this).fatal; }
      get ignoreBOM() { return inner.get(this).ignoreBOM; }
      decode(bytes, o) { return plain(() => inner.get(this).decode(bytes === undefined ? undefined : new Uint8Array(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength) : bytes), { stream: !!(o && o.stream) }))(); }
    }
    EXTRA.URL = G.harden(TrifURL);
    EXTRA.URLSearchParams = G.harden(TrifParams);
    EXTRA.TextEncoder = G.harden(TrifTextEncoder);
    EXTRA.TextDecoder = G.harden(TrifTextDecoder);
    // (a deep copy of plain data, in this realm: what structuredClone copies that a mod can have)
    const clone = (v, seen) => {
      if (v === null || typeof v !== 'object') { if (typeof v === 'function' || typeof v === 'symbol') throw new TypeError(`${String(typeof v)}s can't be cloned`); return v; }
      if (seen.has(v)) return seen.get(v);
      if (v instanceof Date) return new Date(v.getTime());
      if (v instanceof RegExp) return new RegExp(v.source, v.flags);
      if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return new v.constructor(v);
      if (v instanceof ArrayBuffer) return v.slice(0);
      let out;
      if (Array.isArray(v)) { out = new Array(v.length); seen.set(v, out); for (let i = 0; i < v.length; i++) if (i in v) out[i] = clone(v[i], seen); return out; }
      if (v instanceof Map) { out = new Map(); seen.set(v, out); for (const [k, x] of v) out.set(clone(k, seen), clone(x, seen)); return out; }
      if (v instanceof Set) { out = new Set(); seen.set(v, out); for (const x of v) out.add(clone(x, seen)); return out; }
      const pr = Object.getPrototypeOf(v);
      if (pr !== Object.prototype && pr !== null) throw new TypeError('only plain data can be cloned');
      out = {}; seen.set(v, out);
      for (const k of Object.keys(v)) out[k] = clone(v[k], seen);
      return out;
    };
    EXTRA.structuredClone = G.harden((v) => clone(v, new Map()));
    const a0 = G.atob.bind(G), b0 = G.btoa.bind(G);
    EXTRA.atob = G.harden(plain((x) => a0(String(x))));
    EXTRA.btoa = G.harden(plain((x) => b0(String(x))));
    const pnow = performance.now.bind(performance);
    EXTRA.performance = G.harden({ now: () => pnow() });
  }
  const gss = SANDBOX && typeof G.getStackString === 'function' ? G.getStackString : null;
  const stackOf = (e) => {
    let st = '';
    try { st = gss ? String(gss(e) || '') : String((e && e.stack) || ''); } catch { st = ''; }
    if (!st && nativeStack) { try { st = String(nativeStack.call(e) || ''); } catch { st = ''; } }
    return st;
  };
  const harden = SANDBOX ? G.harden : (o) => Object.freeze(o);
  const D = document;
  const nativeConsole = { log: console.log, warn: console.warn, error: console.error };
  const MAX_ERRORS = 200, MAX_LOGS = 500;
  // Errors and logs, kept where `trif errors` / `trif logs` read them: this world's own lists (background.js
  // sandboxLists), or, as a page script, the page runtime's (runtime.js).
  const store = SANDBOX ? { errors: [], logs: [] } : (G.__webmods && Array.isArray(G.__webmods.errors) ? G.__webmods : { errors: [], logs: [] });
  const push = (arr, item, max) => { arr.push(item); if (arr.length > max) arr.splice(0, arr.length - max); };
  // (what each mod looks for, from trif.observe and trif.hide: background.js checks whether any of it is on
  // the page, to flag a mod that may be broken; extension/modhealth.js)
  if (!store.watched || typeof store.watched !== 'object') store.watched = {};
  const watch = (modId, sel) => { try { const l = store.watched[modId] || (store.watched[modId] = []); if (l.length < 40 && !l.includes(sel)) l.push(sel); } catch { /* never throw into a mod */ } };
  const textOf = (a) => { if (typeof a === 'string') return a; try { const s = JSON.stringify(a); return s === undefined ? String(a) : s.slice(0, 10000); } catch { try { return String(a); } catch { return '[unprintable]'; } } };
  const report = (modId, err) => {
    try {
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
      let stack = '';
      try { stack = err && typeof err === 'object' ? String(stackOf(err) || '') : ''; } catch { /* none */ }
      push(store.errors, { mod: modId, message: message.slice(0, 4000), stack: stack.slice(0, 8000), time: Date.now(), ...(SANDBOX ? { sandboxed: true } : {}) }, MAX_ERRORS);
      nativeConsole.error.call(console, '[TRIF]', modId, message);
    } catch { /* never throw into a mod */ }
  };
  const logTo = (modId, level) => (...args) => {
    try {
      push(store.logs, { mod: modId, level, args: args.map(textOf), time: Date.now() }, MAX_LOGS);
      nativeConsole[level].call(console, '[TRIF]', modId, ...args.map(textOf));
    } catch { /* never throw into a mod */ }
  };

  // ---- allowlists
  const HTML_NS = 'http://www.w3.org/1999/xhtml', SVG_NS = 'http://www.w3.org/2000/svg';
  const TAGS = new Set(['div', 'span', 'p', 'a', 'button', 'img', 'ul', 'ol', 'li', 'section', 'header', 'footer', 'nav', 'aside', 'article', 'main',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'mark', 'code', 'pre', 'blockquote', 'label',
    'br', 'hr', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption', 'canvas', 'details', 'summary', 'progress',
    // (display only: an <output> a mod makes has no form or for, and never goes inside a form, as for buttons)
    'output', 'meter', 'dl', 'dt', 'dd', 'abbr', 'time']);
  const ATTRS = new Set(['id', 'class', 'title', 'role', 'hidden', 'alt', 'width', 'height', 'lang', 'dir', 'tabindex', 'colspan', 'rowspan', 'open', 'value', 'max', 'href', 'src',
    'min', 'low', 'high', 'optimum', 'datetime']);
  // The page's own code reads attributes as instructions: htmx's data-hx-post, Turbo's data-turbo-method,
  // Stimulus's data-controller, classes a selector-observer acts on, ids it finds elements (or window globals)
  // by. So the names a mod gives are its own: data attributes only data-trif-box-*, and ids and classes only
  // trif-box-* (aria-* stay: they describe, they don't instruct). (`name` isn't offered at all.) Not plain
  // trif-: free mods use those, and act on them (an id they look up), so a boxed mod mustn't make them;
  // AGENTS.md tells free mods never to act on trif-box- names. (audit AU-3)
  const DATA_OK = /^data-trif-box-[a-z0-9-]+$/;
  const ARIA_OK = /^aria-[a-z]+$/;
  const OWN_NAME = /^trif-box-[A-Za-z0-9_-]*$/;
  const nameOk = (n) => ATTRS.has(n) || DATA_OK.test(n) || ARIA_OK.test(n);
  const nameRefused = (n) => (/^data-/.test(n) ? `only data-trif-box-* data attributes are offered (the page's own code, or a free mod, could act on ${n})` : `the ${n} attribute isn't offered`);
  const ownTokens = (v) => String(v).trim().split(/\s+/).filter(Boolean).every((t) => OWN_NAME.test(t));
  // (an address only where it can't run or send anything by itself: a link's href, an image's src; `value`
  // only on a progress bar or list item, never on a form field, whose value the site would receive)
  // (`open` only on <details>: on the page's <dialog> it would show the page's own confirm box: audit AU-8)
  const ATTR_TAGS = { href: new Set(['a']), src: new Set(['img']), value: new Set(['progress', 'li', 'meter']), max: new Set(['progress', 'meter']), open: new Set(['details']),
    min: new Set(['meter']), low: new Set(['meter']), high: new Set(['meter']), optimum: new Set(['meter']), datetime: new Set(['time']) };
  // (and `use`, `clipPath` and `symbol`, whose references, url(#…) and href="#…", may only name the mod's own
  // trif-box- ids: a copy renames the ids it keeps, and the references to them: svgValueOk)
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc',
    'clippath', 'use', 'symbol']);
  const SVG_ATTRS = /^(viewbox|d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|points|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|opacity|fill-opacity|stroke-opacity|fill-rule|clip-rule|transform|offset|stop-color|stop-opacity|gradientunits|gradienttransform|xmlns|preserveaspectratio|focusable|font-size|font-family|text-anchor|dominant-baseline|width|height|display|clip-path|clippathunits|stroke-dasharray|stroke-dashoffset|stroke-miterlimit|visibility|font-weight|font-style|letter-spacing|fx|fy|fr|spreadmethod|pathlength|vector-effect|paint-order|shape-rendering)$/;
  // An SVG attribute's value: no address, no code; a reference only to one of the mod's own ids (url(#trif-box-…),
  // and href="#trif-box-…" on use and gradients)
  const svgValueOk = (name, v) => {
    const s = String(v);
    if (/javascript:|data:|@import|expression\s*\(/i.test(s)) return false;
    if (name === 'href' || name === 'xlink:href') return /^#trif-box-[A-Za-z0-9_-]+$/.test(s.trim());
    const re = /url\s*\(/gi;
    let m;
    while ((m = re.exec(s))) if (!/^\s*["']?#trif-box-[A-Za-z0-9_-]+["']?\s*\)/.test(s.slice(m.index + m[0].length))) return false;
    return true;
  };
  // Text inside these is code or CSS the browser would carry out: never written by a mod.
  const RAW_TEXT = new Set(['script', 'style']);
  // Text inside these is what a form sends: not rewritten by a mod either (its own controls aside).
  const FORM_TEXT = new Set(['textarea', 'option', 'select']);
  // The `controls` power: a mod's own sliders, pickers, checkboxes, number and text boxes, and selects. TRIF
  // sets autocomplete off (the browser fills nothing into them) and keeps the type to these; never password.
  const CONTROL_TAGS = new Set(['input', 'select', 'option', 'label']);
  const CONTROL_TYPES = new Set(['range', 'color', 'checkbox', 'number', 'text']);
  const controlAttrOk = (node, n, v) => {
    const t = node.localName;
    if (t === 'input') {
      if (n === 'type') { if (!CONTROL_TYPES.has(v.toLowerCase())) fail(`a mod's input can be ${[...CONTROL_TYPES].join(', ')} (not ${v})`); return true; }
      if (/^(min|max|step)$/.test(n)) { if (!/^-?[0-9.e+-]*$|^any$/i.test(v)) fail(`${n} takes a number`); return true; }
      return n === 'value' || n === 'checked' || n === 'placeholder' || n === 'disabled';
    }
    if (t === 'option') return n === 'value' || n === 'selected';
    if (t === 'select') return n === 'disabled';
    if (t === 'label' && n === 'for') { if (!OWN_NAME.test(v)) fail('a label is for one of the mod\'s own controls (a trif-box- id)'); return true; }
    return false;
  };
  const ORIGIN = location.origin;
  const fail = (why) => { throw new TypeError(`TRIF sandbox: ${why}`); };
  const str = (v, what, max = 100000) => { if (typeof v !== 'string') fail(`${what} must be text`); if (v.length > max) fail(`${what} is too long`); return v; };
  // An address an element may carry. An image: a data: image, blob:, or an address an image on the page
  // already shows (so a copy of the site's logo works, but no new request goes anywhere, not even to the
  // site: a GET there can do things too). A link: this site's own pages without a query (a query to the site
  // could go on to another one through a redirect), or #somewhere; it goes nowhere until the user clicks it.
  const shownImage = (abs) => { for (const im of D.images) if (im.src === abs || im.currentSrc === abs) return true; return false; };
  const shownLink = (abs) => { for (const a of D.links) if (!created.has(a) && a.href === abs) return true; return false; };
  const urlOk = (v, attr) => {
    const s = String(v).trim();
    if (attr === 'src') {
      if (/^(data:image\/|blob:)/i.test(s)) return true;
      try { return shownImage(new URL(s, location.href).href); } catch { return false; }
    }
    if (/^#/.test(s)) return true;
    // A link: #somewhere, or an address a link on the page already has. Not a new address, not even a path on
    // this site: a path can carry data, and the page's speculation rules or a prefetching script can fetch it
    // without a click (audit AU-7).
    try { const abs = new URL(s, location.href).href; return /^https?:/.test(abs) && shownLink(abs); } catch { return false; }
  };
  // The images the page's own style sheets use (url() in a rule of a sheet the browser lets TRIF read, not one
  // TRIF added): for CSS url(), which may name one of those, as an img src may name an image the page shows.
  const trifSheets = new WeakSet(); // (<style> elements TRIF added for mods)
  let sheetCache = null, sheetAt = 0;
  const sheetImages = () => {
    if (sheetCache && now() - sheetAt < 1000) return sheetCache;
    const out = new Set();
    let budget = 20000;
    const walk = (rules, base) => {
      for (const r of rules) {
        if (budget-- <= 0) return;
        // (a grouping rule's own rules; a style rule's text has its nested ones in it)
        if (r.cssRules && !r.style) { walk(r.cssRules, base); continue; }
        const t = String(r.cssText || '');
        for (const m of t.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) { if (/^data:/i.test(m[2])) continue; try { out.add(new URL(m[2], base).href); } catch { /* not an address */ } }
      }
    };
    for (const sh of D.styleSheets) {
      if (sh.ownerNode && trifSheets.has(sh.ownerNode)) continue;
      let rules = null;
      try { rules = sh.cssRules; } catch { rules = null; } // (another site's sheet: the browser hides it)
      if (rules) walk(rules, sh.href || location.href);
    }
    sheetCache = out; sheetAt = now();
    return out;
  };
  const shownAddress = (u) => { try { const abs = new URL(u, location.href).href; return /^https?:/.test(abs) && (shownImage(abs) || sheetImages().has(abs)); } catch { return false; } };
  // CSS that loads nothing new (as rules mods: helper/lib/rules.js checkCss): url() only data:, #somewhere,
  // or an address an image on the page shows or one of the page's style sheets uses (the img src rule), no
  // @import, image-set() and the like, no escapes outside strings (nor inside an address).
  const cssOk = (css) => {
    css = String(css);
    let q = null, flat = '';
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '\\') return false;
      if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); if (e === -1) return false; i = e + 1; continue; }
      flat += c;
    }
    if (q) return false;
    const t = flat.toLowerCase();
    if (/@import\b|@namespace\b|expression\s*\(|-moz-binding|behavior\s*:/.test(t)) return false;
    if (/(?:^|[^a-z-])(?:-webkit-)?(image-set|image|cross-fade|element|src)\s*\(/.test(t)) return false;
    const re = /url\s*\(/gi;
    let m;
    while ((m = re.exec(css))) {
      const rest = css.slice(m.index + m[0].length);
      if (/^\s*["']?\s*data:/i.test(rest) || /^\s*["']?#[\w-]+["']?\s*\)/.test(rest)) continue;
      const a = /^\s*(["']?)([^"'()\s\\]+)\1\s*\)/.exec(rest);
      if (!a || !shownAddress(a[2])) return false;
    }
    return true;
  };
  // A selector, for a rule TRIF writes: one that parses and can't close the rule it's put in.
  // A selector a mod gives, anywhere: no escapes (so the checks below can't be spelled around: audit AU-9),
  // and nothing that reads what's typed in a field: the value attribute (React keeps it in step with what's
  // typed, passwords too) and :autofill (audit AU-2).
  const READS_FIELDS = /\[\s*(?:[\w*-]*\|)?value\b|:(?:-webkit-)?autofill\b/i;
  const selCheck = (sel, what = 'a selector') => {
    str(sel, what, 2000);
    if (sel.includes('\\')) fail(`"${sel.slice(0, 80)}": selectors can't have \\ escapes`);
    if (READS_FIELDS.test(sel)) fail(`"${sel.slice(0, 80)}": selectors can't name the value attribute or :autofill (they'd read what's typed in a field)`);
    return sel;
  };
  const selectorOk = (sel) => {
    selCheck(sel);
    if (/[{}<;@\\]|\/\*/.test(sel)) fail(`"${sel.slice(0, 80)}" isn't a selector TRIF writes into a style sheet`);
    try { D.createDocumentFragment().querySelector(sel); } catch { fail(`"${sel.slice(0, 80)}" isn't a valid selector`); }
    return sel;
  };
  const qs = (root, sel) => { selCheck(sel); try { return root.querySelector(sel); } catch { fail(`"${String(sel).slice(0, 80)}" isn't a valid selector`); } };
  const qsa = (root, sel) => { selCheck(sel); try { return root.querySelectorAll(sel); } catch { fail(`"${String(sel).slice(0, 80)}" isn't a valid selector`); } };
  const LISTEN = /^(click|dblclick|contextmenu|mouse(down|up|move|over|out|enter|leave)|pointer(down|up|move|over|out|enter|leave|cancel)|(got|lost)pointercapture|touch(start|move|end|cancel)|key(down|up)|wheel|scroll|resize|input|change|focus|blur|focusin|focusout|visibilitychange|fullscreenchange|pagehide|transition(start|run|end|cancel)|animation(start|iteration|end|cancel))$/;
  // Drag and drop: only on the mod's own elements, with its own data (dataOf): never files, nor what another
  // app or the page put in a drag.
  const DRAG = /^(drag|dragstart|dragend|dragenter|dragover|dragleave|drop)$/;
  const MEDIA_EVENTS = /^(play|playing|pause|ended|timeupdate|volumechange|seeking|seeked|ratechange|loadedmetadata|durationchange|waiting)$/;
  // A page's own event's name, as the header may declare it: with a - or a : (no browser event has either)
  const CUSTOM_EVENT = /^[a-z][\w.]*[-:][\w.:-]*$/i;
  const TA_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Int8Array.prototype), 'length').get; // (a typed array's, by its own slot)
  const REGEXP_SOURCE = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get;
  const REGEXP_FLAGS = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags').get;
  let leaving = 0; // (inside a mod's pagehide listener)
  const notLeaving = () => { if (leaving) fail('as the page goes away, a mod may only save its settings'); };
  const isRaw = (n) => !!n && n.nodeType === 1 && (RAW_TEXT.has(n.localName) || (FORM_TEXT.has(n.localName) && !created.has(n)));

  // ---- the stand-ins: one per node (identity kept), frozen, sharing one frozen prototype whose methods
  // find their node in a WeakMap (an object TRIF didn't make has none)
  const standins = new WeakMap(); // node -> stand-in
  const nodes = new WeakMap(); // stand-in -> node
  const created = new WeakSet(); // nodes a mod made (page.create, clone)
  const nodeOf = (s) => { const n = s && typeof s === 'object' ? nodes.get(s) : undefined; if (!n) fail('that isn\'t an element TRIF gave you'); return n; };
  const kidOf = (k) => (typeof k === 'string' ? k : nodeOf(k));
  // What a form sends is the page's: the page's own fields stay in the form they're in (moving one into, out
  // of or between forms changes what's submitted), and a mod's button never goes inside a form.
  const FORM_FIELDS = 'button, input, select, textarea, fieldset, output, object';
  // (and the options of a select, which say what it sends: audit AU-4; and custom elements, which can be form
  // fields through ElementInternals, out of sight from here: audit AU-5)
  const OPTIONS = 'option, optgroup';
  const fieldsIn = (k) => [...(k.matches(FORM_FIELDS) ? [k] : []), ...k.querySelectorAll(FORM_FIELDS)];
  const customIn = (k) => [...(k.localName.includes('-') ? [k] : []), ...[...k.querySelectorAll('*')].filter((e) => e.localName.includes('-'))];
  const optionsIn = (k) => [...(k.matches(OPTIONS) ? [k] : []), ...k.querySelectorAll(OPTIONS)];
  const formsOk = (parent, kids) => {
    const dest = parent && parent.nodeType === 1 ? parent.closest('form') : null;
    const destSelect = parent && parent.nodeType === 1 ? parent.closest('select') : null;
    for (const k of kids) {
      if (typeof k === 'string' || k.nodeType !== 1) continue;
      for (const f of fieldsIn(k)) {
        if (created.has(f)) { if (dest) fail(`a ${f.localName === 'button' ? 'button' : 'control'} a mod makes can't go inside a form`); continue; }
        if (f.hasAttribute('form')) continue; // (it names its form: where it is doesn't change that)
        if ((f.form || null) !== dest) fail(`the page's own <${f.localName}> can't be moved into, out of or between forms`);
      }
      for (const c of customIn(k)) if (!created.has(c) && c.closest('form') !== dest) fail(`the page's own <${c.localName}> can't be moved into, out of or between forms (it may be a form field)`);
      for (const o of optionsIn(k)) {
        if (created.has(o)) continue;
        const now = o.closest('select');
        const after = now && k.contains(now) ? now : destSelect; // (its select moves with it, or it goes where it's put)
        if (after !== now) fail(`the page's own <${o.localName}> can't be moved out of its select or into another`);
      }
    }
  };
  // What's typed into an editor (contenteditable, or a page in design mode) is the user's: a mod reads none
  // of it (.text, trif.text, clone()), sees no attribute inside it, and can't move its pieces out to read them.
  // (an SVG element has no isContentEditable of its own: it's in an editor when the HTML element it's in is)
  const inEditor = (n) => { for (let a = n; a && a.nodeType === 1; a = a.parentElement) if (typeof a.isContentEditable === 'boolean') return a.isContentEditable; return false; };
  const insideEditor = (n) => inEditor(n) && inEditor(n.parentElement);
  const visibleText = (n) => {
    if (inEditor(n)) return '';
    if (D.designMode !== 'on' && !n.querySelector('[contenteditable]')) return n.textContent;
    let out = '';
    const tw = D.createTreeWalker(n, 4 /* NodeFilter.SHOW_TEXT */);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) if (!inEditor(t.parentElement)) out += t.data;
    return out;
  };
  // Taking a page field out of its form (removing it, or what holds it, or writing over what holds it)
  // changes what the form sends, as moving it does.
  const fieldsOwned = (n) => fieldsIn(n).filter((f) => !created.has(f) && f.form);
  const detachOk = (n, keepsItself) => {
    for (const f of fieldsOwned(n)) {
      if (!keepsItself && n.contains(f.form)) continue; // (its form goes with it: nothing else submits differently)
      fail(`the page's own <${f.localName}> can't be taken out of its form`);
    }
    for (const c of customIn(n)) {
      const form = c.closest('form');
      if (created.has(c) || !form || (!keepsItself && n.contains(form))) continue;
      fail(`the page's own <${c.localName}> can't be taken out of its form (it may be a form field)`);
    }
    for (const o of optionsIn(n)) {
      const sel = o.closest('select');
      if (created.has(o) || !sel || !sel.form || (!keepsItself && n.contains(sel))) continue;
      fail(`the page's own <${o.localName}> can't be taken out of its select`);
    }
  };
  // Writing into an editor is changing what the user typed: refused (audit AU-1); restyling, hiding it: fine.
  const mediaOf = (s) => { const n = nodeOf(s); notLeaving(); if (!/^(video|audio)$/.test(n.localName)) fail('that\'s for the page\'s <video> and <audio>'); if (!cur().powers.has('media')) fail('playing the page\'s video and audio needs the media power (// @powers media)'); partnersOk(cur(), 'media'); return n; };
  // (would a click on it submit a form: a submit button or input, a button with no type in a form, or
  // something inside one of those)
  // (or reset one: what the user typed, wiped; a label clicks its control, so a label for one of those too)
  const submits = (n) => {
    const lb = n.closest('label');
    const b = n.closest('button, input') || (lb && lb.control);
    if (!b) return false;
    const t = String(b.getAttribute('type') || '').toLowerCase();
    if (b.localName === 'input') return t === 'submit' || t === 'image' || t === 'reset';
    return b.localName === 'button' && (t === '' || t === 'submit' || t === 'reset') && !!b.form;
  };
  // write-drafts and the reads: a mod with write-drafts and a read power has the combination in its hold
  // (docs/POWERS.md "Combinations"). Boxed mods on a page can see each other's elements, so what one mod
  // reads could reach another through the page: while any boxed mod here has a read power, a mod changes
  // what the user types only if it asked for that read too (and so the user saw the combination).
  // The page-wide rules (docs/SAFE-MODS.md "Combinations"): boxed mods on a page see each other's elements
  // (and with `mods`, talk), so a combination the hold warns about (helper/lib/combinations.js) could be split
  // between two mods, each without the warning. So an act is refused while another boxed mod that has run on
  // this page has a power that makes a warned pair with it, unless the acting mod asked for that power too
  // (and so its hold showed the warning). ACT_PARTNERS: the act, and the powers it's refused beside
  // (tests/combinations.test.js keeps it in step with the table). Not here: sound beside a read (SAFE-MODS says
  // why); click beside a draft another mod wrote (clickOk); click beside go-to (on go-to's side).
  const ACT_PARTNERS = {
    'write-drafts': ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts', 'image-variants'],
    click: ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts', 'image-variants', 'block-events'],
    media: ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts', 'image-variants'],
    'go-to': ['click', 'page-events'],
    'page-events': ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts', 'image-variants'],
    'edit-uploads': ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts', 'image-variants'],
    'image-variants': ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts'],
    preload: ['read-drafts', 'keys', 'site-data', 'page-data', 'site-storage', 'local-fonts'],
  };
  const PARTNER_WHY = {
    'write-drafts': ['changing what the user types', 'what one reads could end up in what the user posts'],
    click: ['clicking for the user', 'what one reads could decide what the other clicks (or one could keep the user\'s clicks from the page while the other clicks)'],
    media: ['playing the page\'s video and audio', 'what one reads could reach a video\'s host through how it plays'],
    'go-to': ['taking the user to a page', 'one could take the user to a page where the other clicks or sets off the page\'s own actions'],
    'page-events': ['signalling the page\'s own code', 'what one reads could reach the page\'s code, which may post or send it'],
    'edit-uploads': ['changing the pictures the user attaches', 'what one reads could end up in a picture the user posts'],
    'image-variants': ['loading other sizes of the page\'s pictures', 'what one reads could reach the pictures\' host through which ones load'],
    preload: ['loading the page\'s pictures sooner', 'what one reads could reach the pictures\' host through which ones load'],
  };
  const inPlay = new Set(); // (the powers of the boxed mods that have run on this page)
  const partnersOk = (api, act) => {
    for (const p of ACT_PARTNERS[act]) if (inPlay.has(p) && !api.powers.has(p)) fail(`${PARTNER_WHY[act][0]} is off on this page while another boxed mod here has the ${p} power: with both, ${PARTNER_WHY[act][1]} (a mod that asks for ${act} and ${p} together shows the user that)`);
  };
  const draftsOk = (api) => {
    if (!api.powers.has('write-drafts')) return false;
    partnersOk(api, 'write-drafts');
    return true;
  };
  // (click: also not after another mod changed a draft, unless the clicking mod has write-drafts: a click could
  // send it)
  const clickOk = (api) => {
    partnersOk(api, 'click');
    for (const w of draftWriters) if (w !== api.mod && !api.powers.has('write-drafts')) fail('clicking for the user is off on this page since another boxed mod here changed a draft: with both, a draft could be sent without the user (a mod that asks for click and write-drafts together shows the user that)');
    for (const w of uploadEditors) if (w !== api.mod && !api.powers.has('edit-uploads')) fail('clicking for the user is off on this page since another boxed mod here changed a picture the user attached: with both, it could be posted without the user (a mod that asks for click and edit-uploads together shows the user that)');
  };
  // (page-events, as click: not after another mod changed a draft or an attached picture: a signal could send it)
  const signalOk = (api) => {
    partnersOk(api, 'page-events');
    for (const w of draftWriters) if (w !== api.mod && !api.powers.has('write-drafts')) fail('signalling the page\'s code is off on this page since another boxed mod here changed a draft: with both, a draft could be sent without the user (a mod that asks for page-events and write-drafts together shows the user that)');
    for (const w of uploadEditors) if (w !== api.mod && !api.powers.has('edit-uploads')) fail('signalling the page\'s code is off on this page since another boxed mod here changed a picture the user attached (a mod that asks for page-events and edit-uploads together shows the user that)');
  };
  const uploadEditors = new Set(); // (boxed mods that changed an attached picture on this page)
  // write-drafts and addresses: the rule (docs/SAFE-MODS.md) holds in drafts too. A site can fetch an address
  // in a draft before anything is posted (a link preview), so the text a mod writes may only have the
  // addresses already in what the user typed there, or in a link on the page: no address it made up.
  const ADDRESS = /(?:[a-z][a-z0-9+.-]*:\/\/|www[.\u3002\uff0e\uff61])[^\s<>"'`]+|(?:[\p{L}\p{N}][\p{L}\p{N}-]{0,62}[.\u3002\uff0e\uff61])+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})(?![\p{L}\p{N}-])(?:[/?#:][^\s<>"'`]*)?|\b\d{1,3}(?:\.\d{1,3}){3}\b/giu;
  const linkHas = (t) => { for (const a of D.links) if (!created.has(a) && String(a.href).toLowerCase().includes(t)) return true; return false; };
  const noNewAddress = (before, after) => {
    const was = String(before).toLowerCase();
    for (const m of String(after).matchAll(ADDRESS)) {
      const t = m[0].toLowerCase();
      if (!was.includes(t) && !linkHas(t)) fail(`"${m[0].slice(0, 80)}" looks like an address that isn't in what the user typed here or in a link on the page: a boxed mod doesn't add addresses to a draft (a site can fetch one for a preview before anything is posted)`);
    }
  };
  // (an editor's text after a write: the text before where it goes, what it adds, the rest; `removed`
  // characters replaced)
  const editorRoot = (n) => { let r = n; while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement; return r; };
  const editorWrite = (n, setEnd, removed, added) => {
    const root = editorRoot(n);
    const before = root.textContent;
    const rg = D.createRange();
    rg.setStart(root, 0);
    setEnd(rg);
    const at = rg.toString().length;
    noNewAddress(before, before.slice(0, at) + added + before.slice(at + removed));
  };
  const draftWriters = new Set(); // (boxed mods that changed a draft on this page: see clickOk)
  const notInEditor = (n, what) => { if (inEditor(n) && !draftsOk(cur())) fail(`${what} isn't offered inside an editor (what the user is typing)`); };
  const wrote = (n) => { if (inEditor(n)) draftWriters.add(cur().mod); };
  const textInto = (parent, kids) => {
    formsOk(parent, kids);
    for (const k of kids) if (typeof k !== 'string' && insideEditor(k)) fail('a piece of an editor can\'t be moved out of it');
    if (kids.some((k) => typeof k === 'string') && isRaw(parent)) fail(`text can't be written into <${parent.localName}>`);
  };

  let PROTO = null; // made once the per-mod helpers exist (below): the methods need the mod's error reporting
  const wrap = (node) => {
    if (!node || node.nodeType !== 1) return null;
    let s = standins.get(node);
    if (!s) {
      s = Object.freeze(Object.create(PROTO));
      standins.set(node, s);
      nodes.set(s, node);
    }
    return s;
  };
  const list = (nl) => harden(Array.prototype.map.call(nl, wrap));

  // (a copy keeps no page-given id, class or data attribute: the page's code would act on the copy too)
  const SVG_COPY_ATTR = (n) => SVG_ATTRS.test(n) || n === 'class' || n === 'id' || n === 'role' || DATA_OK.test(n) || ARIA_OK.test(n);
  const safeCopy = (from, ids) => {
    const tag = from.localName.toLowerCase();
    const svg = from.namespaceURI === SVG_NS;
    if (svg ? !SVG_TAGS.has(tag) : from.namespaceURI !== HTML_NS || !TAGS.has(tag)) return null;
    const to = svg ? D.createElementNS(SVG_NS, from.localName) : D.createElement(tag);
    if (tag === 'button' && !svg) to.setAttribute('type', 'button');
    for (const a of from.attributes) {
      const n = a.name.toLowerCase();
      if (/^on/.test(n) || n === 'style') continue;
      if (svg) {
        if (!SVG_COPY_ATTR(n) && n !== 'href' && n !== 'xlink:href') continue;
        let v = a.value;
        // (its own ids renamed, and its references to them; a reference to anything else: to an id the page has
        // (no request), or dropped)
        if (ids) {
          v = v.replace(/url\(\s*(["']?)#([^"')\s]+)\1\s*\)/g, (m, q, id) => (ids.has(id) ? `url(#${ids.get(id)})` : m));
          const ref = /^\s*#(\S+)\s*$/.exec(v);
          if ((n === 'href' || n === 'xlink:href') && ref && ids.has(ref[1])) v = `#${ids.get(ref[1])}`;
          if (n === 'id' && ids.has(v)) v = ids.get(v);
        }
        if (n === 'id' || n === 'class') { if (!ownTokens(v)) continue; }
        else if (!svgValueOk(n, v)) {
          // (a reference to one of the page's own ids: shown as the page shows it, nothing loads)
          const pageRefs = [...v.matchAll(/url\(\s*["']?#([\w-]+)["']?\s*\)/g)].map((m) => m[1]);
          const href = (n === 'href' || n === 'xlink:href') ? /^\s*#([\w-]+)\s*$/.exec(v) : null;
          const refs = href ? [href[1]] : pageRefs;
          const stripped = v.replace(/url\(\s*["']?#[\w-]+["']?\s*\)/g, '');
          if (!refs.length || refs.some((id) => !D.getElementById(id)) || /url\s*\(|javascript:|data:/i.test(href ? '' : stripped) || (n === 'href' || n === 'xlink:href') && !href) continue;
        }
        if (n === 'xlink:href') to.setAttributeNS(XLINK_NS, 'xlink:href', v); else to.setAttribute(a.name, v);
        continue;
      }
      if (!nameOk(n) || (ATTR_TAGS[n] && !ATTR_TAGS[n].has(tag)) || ((n === 'href' || n === 'src') && !urlOk(a.value, n))) continue;
      if ((n === 'id' || n === 'class') && !ownTokens(a.value)) continue;
      if (n === 'type') continue;
      to.setAttribute(a.name, a.value);
    }
    for (const c of from.childNodes) {
      if (c.nodeType === 3) { if (!inEditor(from)) to.append(c.data); }
      else if (c.nodeType === 1) { const k = safeCopy(c, ids); if (k) to.append(k); }
    }
    created.add(to);
    return to;
  };

  // Which key was pressed reaches a mod only when TRIF can tell it wasn't typed into something editable:
  // default-deny. Shown: the document, <html>, <body>, and elements that are no field or editor and can't hold
  // one in a shadow root. A closed shadow root hides from the page's DOM (event targets stop at its host,
  // `shadowRoot` is null), so where TRIF's world can't see closed roots (closedRootOf), any element that can
  // host one (a custom element, or div, span, p, section, article and the other kinds attachShadow takes)
  // counts as editable. Hotkeys with the focus on the page, a link, a button, a list item: shown.
  const SHADOW_HOSTS = new Set(['article', 'aside', 'blockquote', 'body', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'main', 'nav', 'p', 'section', 'span']);
  const hasRoot = (t) => {
    if (t.shadowRoot) return true;
    if (closedRootOf) { try { return !!closedRootOf(t); } catch { return true; } }
    return null; // (can't tell)
  };
  const typedInto = (e) => {
    const p = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const t = p[0] || e.target;
    if (p.length && p[0] !== e.target) return true; // (from inside an open shadow root)
    if (!t || t.nodeType === 9) return false;
    if (t.nodeType !== 1) return true;
    if (t === D.documentElement) return false;
    if (/^(input|textarea|select)$/.test(t.localName) || t.isContentEditable) return true;
    const root = hasRoot(t);
    if (t === D.body) return root === true; // (a closed root on <body> itself: only where TRIF can see it)
    if (root !== null) return root || t.localName.includes('-');
    return t.localName.includes('-') || SHADOW_HOSTS.has(t.localName);
  };
  // A field whose content stays hidden whatever the mod's powers: passwords and card details.
  const secretField = (t) => !!t && t.nodeType === 1 && t.localName === 'input' && (String(t.type).toLowerCase() === 'password'
    || /(^|\s)(cc-[a-z-]+|current-password|new-password|one-time-code)(\s|$)/i.test(String(t.getAttribute('autocomplete') || '')));
  const isField = (t) => !!t && t.nodeType === 1 && (/^(input|textarea|select)$/.test(t.localName) || t.isContentEditable);
  // Whether a key event's key is hidden from a mod with these powers: `keys` shows keys outside fields and
  // editors (accepting that a field in a closed shadow root can't be seen); `read-drafts` shows them in
  // fields and editors too; a password or card field's never.
  const trifBoxes = new WeakSet(); // search boxes TRIF drew for a mod (search-box)
  const keyHidden = (e, powers) => {
    const p = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const t = p[0] || e.target;
    if (secretField(t) || trifBoxes.has(t) || trifBoxes.has(e.target)) return true; // (TRIF's own search boxes: never a mod's to read)
    if (powers && powers.has('read-drafts') && (isField(t) || (p.length && p[0] !== e.target && isField(p[0])))) return false;
    if (isField(t)) return true;
    if (powers && powers.has('keys')) return p.length > 0 && p[0] !== e.target && isField(p[0]);
    return typedInto(e);
  };
  // (an event on the mod's own element: one a mod may stop before the page sees it, so the page learns less,
  // never more; the page's own elements, fields and the document need block-events)
  const ownTarget = (e) => !!e.target && e.target.nodeType === 1 && created.has(e.target);
  // Drag and drop between a mod's own elements: what it puts in a drag stays with TRIF (`drag.data`), never in
  // the browser's dataTransfer, which the page (and another app) could read; what comes from outside (files,
  // another app's text, the page's own drags) never reaches the mod.
  const drag = { fromOwn: false, data: new Map() };
  const DRAG_TYPE = 'application/x-trif-box';
  if (SANDBOX || typeof G.addEventListener === 'function') {
    G.addEventListener('dragstart', (e) => {
      drag.fromOwn = ownTarget(e); drag.data = new Map();
      // (Firefox starts a drag only with something in it: an empty entry of TRIF's own type)
      if (drag.fromOwn && e.dataTransfer) { try { e.dataTransfer.setData(DRAG_TYPE, ''); } catch { /* fine */ } }
    }, true);
    for (const t of ['dragend', 'drop']) G.addEventListener(t, () => setTimeout(() => { drag.fromOwn = false; drag.data = new Map(); }, 0), true);
  }
  const dataOf = (e) => harden({
    setData: (type, v) => { if (e.type !== 'dragstart' || !drag.fromOwn) fail('setData is for a drag that starts on the mod\'s own element, in its dragstart'); drag.data.set(str(type, 'a type', 100), str(String(v), 'drag data', 100000)); },
    getData: (type) => (drag.fromOwn ? drag.data.get(String(type)) ?? '' : ''),
    types: () => harden(drag.fromOwn ? [...drag.data.keys()] : []),
    setDropEffect: (v) => { if (!/^(none|copy|link|move)$/.test(String(v))) fail('a drop effect is none, copy, link or move'); if (e.dataTransfer) e.dataTransfer.dropEffect = String(v); },
  });
  const eventOf = (e, powers) => harden({
    type: String(e.type), ...(keyHidden(e, powers) ? { key: null, code: null } : { key: typeof e.key === 'string' ? e.key : null, code: typeof e.code === 'string' ? e.code : null }),
    // (what an input event typed: read-drafts only, never in a password or card field)
    ...(powers && powers.has('read-drafts') && typeof e.data === 'string' && !secretField(e.target) ? { data: e.data } : {}),
    shift: !!e.shiftKey, alt: !!e.altKey, ctrl: !!e.ctrlKey, meta: !!e.metaKey,
    x: typeof e.clientX === 'number' ? e.clientX : null, y: typeof e.clientY === 'number' ? e.clientY : null,
    deltaX: typeof e.deltaX === 'number' ? e.deltaX : null, deltaY: typeof e.deltaY === 'number' ? e.deltaY : null, repeat: !!e.repeat,
    // (which buttons, and which pointer: numbers)
    button: typeof e.button === 'number' ? e.button : null, buttons: typeof e.buttons === 'number' ? e.buttons : null,
    pointerId: typeof e.pointerId === 'number' ? e.pointerId : null, pointerType: typeof e.pointerType === 'string' ? e.pointerType : null,
    // (an animation's or transition's name, and its time)
    ...(typeof e.animationName === 'string' ? { animationName: e.animationName } : {}), ...(typeof e.propertyName === 'string' ? { propertyName: e.propertyName } : {}),
    ...(typeof e.elapsedTime === 'number' ? { elapsedTime: e.elapsedTime } : {}),
    target: e.target && e.target.nodeType === 1 ? wrap(e.target) : null,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => { if (!ownTarget(e)) fail('stopping an event is for events on the mod\'s own elements (the page\'s own need the block-events power)'); e.stopPropagation(); },
    stopImmediatePropagation: () => { if (!ownTarget(e)) fail('stopping an event is for events on the mod\'s own elements (the page\'s own need the block-events power)'); e.stopImmediatePropagation(); },
    ...(DRAG.test(String(e.type)) ? { dataTransfer: dataOf(e) } : {}),
  });

  // ---- block-events (0.3): what a mod keeps from the page, by type (and, for clicks, by the header's
  // selectors): TRIF's capture listeners on the window, there before the page's own (the runtime runs at
  // document start), stop the event for every later listener. Never what the user types into a field or an
  // editor, nor anything on TRIF's own search box; never submit, focus, input or leaving (not blockable).
  const blocks = new Set(); // {type, sels, fn, api}
  const BLOCK_TYPES = ['mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousemove', 'mousedown', 'mouseup', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
    'pointermove', 'pointerdown', 'pointerup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'keydown', 'keyup', 'keypress', 'wheel', 'scroll', 'touchstart', 'touchmove', 'touchend',
    'drag', 'dragstart', 'dragover', 'dragenter', 'dragleave', 'dragend', 'drop'];
  const blocking = (e) => {
    if (!blocks.size) return;
    const p = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const t = p[0] || e.target;
    if (/^key/.test(e.type) && (isField(t) || isField(D.activeElement) || typedInto(e))) return;
    if ((t && trifBoxes.has(t)) || (e.target && trifBoxes.has(e.target))) return;
    for (const b of blocks) {
      if (b.type !== e.type) continue;
      if (b.sels) { let hit = false; for (const sel of b.sels) { try { if (t && t.nodeType === 1 && t.closest(sel)) { hit = true; break; } } catch { /* not a selector */ } } if (!hit) continue; }
      const r = b.fn ? b.api.call(b.fn, eventOf(e, b.api.powers)) : true;
      if (r === true) { e.stopImmediatePropagation(); return; }
    }
  };
  for (const ty of BLOCK_TYPES) G.addEventListener(ty, blocking, { capture: true, passive: true });
  // ---- rewrite-requests (0.3): the header's literal changes, handed to the page's side (runtime.js
  // pageBridge), which makes them in the site's own same-origin requests; the mod's code has no part in it
  const rewriteRules = []; // {mod, op, sets: [[path, value]]}
  const announceRewrites = () => { if (rewriteRules.length) D.dispatchEvent(new CustomEvent('trif:rewrite-rules', { detail: JSON.stringify(rewriteRules) })); };
  D.addEventListener('trif:bridge-ready', announceRewrites, true);
  // ---- edit-uploads (0.3): pictures the user attaches (a file input's change, a paste, a drop), handed to
  // the mods that edit them as a canvas of their own; what they give back becomes the file, with the same name
  // and type, where the original was. Only PNG, JPEG and WebP; other files pass untouched, and the mod never
  // sees a file, its path or its metadata.
  const uploadFns = new Set(); // {fn, api}
  const PICTURE = /^image\/(png|jpeg|webp)$/;
  let reDispatching = false;
  const editPicture = async (file) => {
    if (!PICTURE.test(file.type) || file.size > 30 * 1024 * 1024) return file;
    let bm;
    try { bm = await createImageBitmap(file); } catch { return file; }
    if (bm.width * bm.height > 8192 * 8192) return file;
    let cv = D.createElement('canvas');
    cv.width = bm.width; cv.height = bm.height;
    cv.getContext('2d').drawImage(bm, 0, 0);
    created.add(cv);
    let changed = false;
    for (const u of uploadFns) {
      try { partnersOk(u.api, 'edit-uploads'); } catch (err) { report(u.api.mod, err); continue; }
      const back = u.api.call(u.fn, wrap(cv), harden({ width: cv.width, height: cv.height, type: file.type }));
      const out = back && typeof back.then === 'function' ? await back.catch((err) => { report(u.api.mod, err); return undefined; }) : back;
      if (out !== undefined && out !== null) { const n = nodes.get(out); if (!n || n.localName !== 'canvas' || !created.has(n)) { report(u.api.mod, new TypeError('TRIF sandbox: onUpload returns a canvas of the mod\'s own (or nothing: the one it was given)')); continue; } cv = n; }
      changed = true;
      uploadEditors.add(u.api.mod);
    }
    if (!changed) return file;
    const blob = await new Promise((r) => cv.toBlob(r, file.type, 0.92));
    return blob ? new File([blob], file.name, { type: file.type, lastModified: file.lastModified }) : file;
  };
  const editFiles = async (files) => { const dt = new DataTransfer(); for (const f of files) dt.items.add(await editPicture(f)); return dt; };
  const hasPicture = (files) => !!files && [...files].some((f) => PICTURE.test(f.type));
  G.addEventListener('change', (e) => {
    const t = e.target;
    if (reDispatching || !uploadFns.size || !t || t.localName !== 'input' || String(t.type).toLowerCase() !== 'file' || !hasPicture(t.files)) return;
    e.stopImmediatePropagation();
    editFiles([...t.files]).then((dt) => {
      t.files = dt.files;
      reDispatching = true;
      try { t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); } finally { reDispatching = false; }
    });
  }, true);
  for (const [type, field, Ctor] of [['paste', 'clipboardData', 'ClipboardEvent'], ['drop', 'dataTransfer', 'DragEvent']]) {
    G.addEventListener(type, (e) => {
      const data = e[field];
      if (reDispatching || !uploadFns.size || !data || !hasPicture(data.files)) return;
      if (typeof G[Ctor] !== 'function') return;
      e.stopImmediatePropagation(); e.preventDefault();
      const t = e.target;
      editFiles([...data.files]).then((dt) => {
        reDispatching = true;
        try { t.dispatchEvent(new G[Ctor](type, { [field]: dt, bubbles: true, cancelable: true, composed: true })); } finally { reDispatching = false; }
      });
    }, true);
  }
  // ---- embeds (0.3): a video a link on the page names, played inside the page from the header's player, made
  // by the page's side (runtime.js pageBridge: trif:embed) after the user's own click on the mod's button
  const embedOf = new WeakMap(); // (TRIF's button -> the address)
  const variantImgs = new WeakSet(); // (image-variants: the pictures TRIF loaded for a mod)

  // ---- one MutationObserver for every mod in this world: trif.observe / trif.text watchers
  const watchers = new Set(); // {sel, fn, seen, mod}
  const texters = new Set(); // {sel, fn, mod}
  const changers = new Set(); // trif.changes: {sel, call, pending: Set, timer}
  const wrappers = new Set(); // trif.wrap: {sel, re, call}
  const shadowCss = new Set(); // trif.css(text, {shadow}): {sel, text, done: WeakSet of roots, styles}
  const written = new WeakMap(); // text node -> the text a mod's trif.text last wrote there
  let mo = null, moText = false;
  const runWatcher = (w, root) => {
    let found;
    try { found = root.nodeType === 1 && root.matches(w.sel) ? [root, ...root.querySelectorAll(w.sel)] : root.querySelectorAll ? root.querySelectorAll(w.sel) : []; } catch { return; }
    for (const n of found) {
      if (w.seen.has(n)) continue;
      w.seen.add(n);
      w.call(wrap(n));
    }
  };
  const fixText = (t, tx) => {
    const p = t.parentNode;
    if (!p || isRaw(p) || inEditor(p) || written.get(t) === t.data) return;
    const out = tx.call(t.data);
    if (typeof out !== 'string' || out === t.data) { written.set(t, t.data); return; }
    written.set(t, out);
    t.data = out;
  };
  const textUnder = (tx, root) => {
    if (root.nodeType === 3) { if (root.parentElement && root.parentElement.closest(tx.sel)) fixText(root, tx); return; }
    if (root.nodeType !== 1) return;
    const inside = !!root.closest(tx.sel);
    const tops = inside ? [root] : root.querySelectorAll(tx.sel);
    for (const top of tops) {
      const tw = D.createTreeWalker(top, 4 /* NodeFilter.SHOW_TEXT */);
      for (let t = tw.nextNode(); t; t = tw.nextNode()) fixText(t, tx);
    }
  };
  // trif.changes: what changed under an element a mod watches (added or removed children, or text), handed over
  // in batches; never inside an editor (what the user types)
  const noteChange = (ch, target) => {
    if (!target || target.nodeType !== 1 || inEditor(target)) return;
    let top = null;
    try { top = target.closest(ch.sel); } catch { return; }
    if (top && !insideEditor(top) && ch.pending.size < 500) ch.pending.add(top);
  };
  const flushChanges = (ch) => {
    if (ch.timer || !ch.pending.size) return;
    ch.timer = setTimeout(() => { ch.timer = null; const got = [...ch.pending].filter((n) => n.isConnected); ch.pending.clear(); if (got.length) ch.call(list(got)); }, 50);
  };
  // trif.wrap: a page's text split into the mod's own pieces, outside editors, fields, raw text and what a
  // form sends; the page's own text node stays where it was (empty), the pieces after it
  const wrapMade = new WeakSet(); // (text the pieces brought, never wrapped again)
  const wrapText = (wr, t) => {
    const p = t.parentElement;
    if (!p || wrapMade.has(t) || isRaw(p) || FORM_TEXT.has(p.localName) || p.localName === 'title' || inEditor(p) || t.data.length > 20000) return;
    for (let a = p; a; a = a.parentElement) if (created.has(a)) return; // (the mod's own elements: its own business)
    const text = t.data;
    wr.re.lastIndex = 0;
    const found = [];
    for (const m of text.matchAll(wr.re)) { if (!m[0]) break; found.push(m); if (found.length >= 200) break; }
    if (!found.length) return;
    const pieces = [];
    let at = 0;
    for (const m of found) {
      if (m.index > at) pieces.push(text.slice(at, m.index));
      const out = wr.call(m[0], harden(m.slice(1).map((x) => (x === undefined ? null : x))));
      let k = null;
      if (typeof out === 'string') k = out;
      else if (out && typeof out === 'object') { const n = nodes.get(out); if (n && created.has(n) && !n.isConnected) k = n; }
      pieces.push(k === null ? m[0] : k);
      at = m.index + m[0].length;
    }
    if (at < text.length) pieces.push(text.slice(at));
    try { formsOk(p, pieces); } catch { return; }
    const made = pieces.map((x) => { if (typeof x !== 'string') return x; const tn = D.createTextNode(x); wrapMade.add(tn); return tn; });
    t.data = '';
    t.after(...made);
  };
  const wrapUnder = (wr, root) => {
    if (root.nodeType === 3) { if (root.parentElement && root.parentElement.closest(wr.sel)) wrapText(wr, root); return; }
    if (root.nodeType !== 1) return;
    let tops;
    try { tops = root.closest(wr.sel) ? [root] : [...root.querySelectorAll(wr.sel)]; } catch { return; }
    for (const top of tops) {
      const texts = [];
      const tw = D.createTreeWalker(top, 4 /* NodeFilter.SHOW_TEXT */);
      for (let t = tw.nextNode(); t && texts.length < 5000; t = tw.nextNode()) texts.push(t);
      for (const t of texts) wrapText(wr, t);
    }
  };
  // trif.css into shadow roots: handed to the page's side (runtime.js pageBridge: trif:shadow-css), which
  // has every root the page made since the start, closed ones too (it sees them made), and adds the checked
  // sheet to those under hosts that match, now and as they come (adopted, so the page's own writes keep it)
  let shadowN = 0;
  const shadowSend = (o) => D.dispatchEvent(new CustomEvent('trif:shadow-css', { detail: JSON.stringify(o) }));
  D.addEventListener('trif:bridge-ready', () => { for (const sh of shadowCss) shadowSend({ id: sh.id, sel: sh.sel, text: sh.text }); }, true);
  const ensureObserver = () => {
    const root = D.documentElement;
    if (!root) return;
    const wantText = texters.size > 0 || changers.size > 0;
    if (mo && moText === wantText) return;
    if (!mo) {
      mo = new MutationObserver((recs) => {
        const added = [];
        const texts = [];
        for (const r of recs) {
          if (r.type === 'characterData') texts.push(r.target);
          else for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) added.push(n);
        }
        for (const w of watchers) for (const n of added) if (n.nodeType === 1 && n.isConnected) runWatcher(w, n);
        for (const tx of texters) {
          for (const n of added) if (n.isConnected) textUnder(tx, n);
          for (const t of texts) if (t.isConnected && t.parentElement && t.parentElement.closest(tx.sel)) fixText(t, tx);
        }
        for (const wr of wrappers) for (const n of added) if (n.isConnected && !wrapMade.has(n)) wrapUnder(wr, n);
        if (embeddedFilters.length) { for (const n of added) if (n.nodeType === 1) filterScripts(n); for (const r of recs) if (r.target && r.target.localName === 'script') filterScripts(r.target); }
        if (changers.size) {
          for (const r of recs.slice(0, 5000)) {
            const target = r.type === 'characterData' ? r.target.parentElement : r.target;
            for (const ch of changers) {
              noteChange(ch, target);
              for (const n of r.addedNodes) if (n.nodeType === 1 && ch.pending.size < 500) { try { if (n.matches(ch.sel) && !inEditor(n)) ch.pending.add(n); } catch { /* not a selector */ } }
            }
          }
          for (const ch of changers) flushChanges(ch);
        }
      });
    }
    moText = wantText;
    mo.observe(root, { childList: true, subtree: true, characterData: wantText });
  };
  // (at document_start there may be no <html> yet: watch for it)
  if (!D.documentElement) { const early = new MutationObserver(() => { if (D.documentElement) { early.disconnect(); if (watchers.size || texters.size || changers.size || wrappers.size || embeddedFilters.length) { ensureObserver(); for (const w of watchers) runWatcher(w, D.documentElement); for (const tx of texters) textUnder(tx, D.documentElement); for (const wr of wrappers) wrapUnder(wr, D.documentElement); } } }); early.observe(D, { childList: true }); }

  const styleSheet = (text) => {
    const st = D.createElement('style');
    trifSheets.add(st);
    st.textContent = text;
    (D.head || D.documentElement).append(st);
    return st;
  };

  // trif.onUrl: the page's address as it changes, in the app too (history moves: runtime.js pageBridge sends
  // trif:url after the page's pushState and replaceState; the back button and #somewhere: the browser's events)
  const urlFns = new Set();
  let lastUrl = location.href;
  const urlCheck = () => { const u = location.href; if (u === lastUrl) return; lastUrl = u; for (const f of urlFns) f(u); };
  G.addEventListener('popstate', urlCheck, true);
  G.addEventListener('hashchange', urlCheck, true);
  D.addEventListener('trif:url', urlCheck, true);
  // trif.ready, trif.loaded: the document parsed, and loaded
  const readyP = harden(new Promise((r) => { if (D.readyState !== 'loading') r(true); else D.addEventListener('DOMContentLoaded', () => r(true), { once: true }); }));
  const loadedP = harden(new Promise((r) => { if (D.readyState === 'complete') r(true); else G.addEventListener('load', () => r(true), { once: true }); }));

  let current = null; // the api of the mod whose code TRIF is running (its top level, or a callback)
  /** Everything one mod gets (its own error reporting, timers, settings, watchers). */
  const apis = new Map(); // mod id -> its api
  // ---- site-data (docs/POWERS.md, SAFE-MODS.md "trif.filterResponse"): the page's side (runtime.js
  // pageBridge) hands JSON responses over as text, during an event; the mods' filters run on copies; what
  // they return may only remove or reorder: every string, number and boolean in it, and every object key, has
  // to be in what the site sent, a string or number no more times than it was, or TRIF keeps the original.
  const filters = []; // {re, glob, call, mod}
  const tally = (v, strs, nums, keys, depth = 0) => {
    if (depth > 100) throw new TypeError('too deep');
    if (typeof v === 'string') strs.set(v, (strs.get(v) || 0) + 1);
    else if (typeof v === 'number' || typeof v === 'boolean') nums.set(`${typeof v}:${v}`, (nums.get(`${typeof v}:${v}`) || 0) + 1);
    else if (Array.isArray(v)) for (const x of v) tally(x, strs, nums, keys, depth + 1);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) { keys.add(k); tally(v[k], strs, nums, keys, depth + 1); }
  };
  // (B6: an address the site sent with whole query parameters taken out: the same scheme, host, path and #,
  // the rest of its parameters as they were, in their order)
  const lessParams = (s, from) => {
    if (typeof s !== 'string' || !s.includes('/') || s.length > 4000) return false;
    let a;
    try { a = new URL(s, location.href); } catch { return false; }
    const head = s.split('?')[0].split('#')[0];
    for (const u of from) {
      if (u.length < s.length || !u.includes('?') || !u.startsWith(head)) continue;
      let b;
      try { b = new URL(u, location.href); } catch { continue; }
      if (a.origin !== b.origin || a.pathname !== b.pathname || a.hash !== b.hash) continue;
      const kept = [...a.searchParams], all = [...b.searchParams];
      let i = 0;
      for (const [k, v] of all) if (i < kept.length && kept[i][0] === k && kept[i][1] === v) i++;
      if (i === kept.length && kept.length < all.length) return true;
    }
    return false;
  };
  const invented = (input, output) => {
    const si = new Map(), ni = new Map(), ki = new Set(), so = new Map(), no = new Map(), ko = new Set();
    tally(input, si, ni, ki); tally(output, so, no, ko);
    for (const k of ko) if (!ki.has(k)) return `the key "${k.slice(0, 60)}" isn't in what the site sent`;
    for (const [v, c] of so) if ((si.get(v) || 0) < c && !(!si.has(v) && lessParams(v, si.keys()))) return `the text "${v.slice(0, 60)}" ${si.has(v) ? 'more times than' : 'isn\'t in'} what the site sent`;
    for (const [v, c] of no) if ((ni.get(v) || 0) < c) return `the value ${v.replace(/^\w+:/, '')} ${ni.has(v) ? 'more times than' : 'isn\'t in'} what the site sent`;
    return null;
  };
  let filterListening = false;
  const announceFilters = () => { D.dispatchEvent(new CustomEvent('trif:filter-patterns', { detail: JSON.stringify(filters.map((f) => f.glob)) })); };
  const listenForFilters = () => {
    if (filterListening) return;
    filterListening = true;
    D.addEventListener('trif:bridge-ready', announceFilters, true);
    D.addEventListener('trif:filter-request', (e) => {
      let req;
      try { req = JSON.parse(String(e.detail)); } catch { return; }
      if (!req || typeof req.url !== 'string' || typeof req.text !== 'string') return;
      const mine = filters.filter((f) => f.re.test(req.url));
      if (!mine.length) return;
      // (B4: JSON behind a guard (for (;;); and the like), and several documents one after another: each
      // filtered on its own, put back as they were, with the same guard and separators)
      const docs = splitDocs(req.text);
      if (!docs) return;
      let any = false;
      const outs = docs.parts.map((d) => { const r = filterOne(mine, d.value, req); if (r !== null) any = true; return r === null ? d.text : JSON.stringify(r); });
      if (any) D.dispatchEvent(new CustomEvent('trif:filter-response', { detail: docs.prefix + outs.map((t, i) => t + docs.parts[i].sep).join('') }));
    }, true);
  };
  // (the documents in a response: its guard, then each JSON value and what follows it)
  const GUARD = /^\s*(?:for\s*\(\s*;\s*;\s*\)\s*;|while\s*\(\s*1\s*\)\s*;|\)\]\}'\s*,?)/;
  const splitDocs = (text) => {
    const g = GUARD.exec(text);
    const prefix = g ? g[0] : '';
    let i = prefix.length;
    const lead = /^\s*/.exec(text.slice(i))[0];
    const parts = [];
    const pre = prefix + lead;
    i += lead.length;
    while (i < text.length) {
      const start = i;
      const c = text[i];
      if (c === '{' || c === '[') {
        let depth = 0, q = false;
        for (; i < text.length; i++) {
          const ch = text[i];
          if (q) { if (ch === '\\') i++; else if (ch === '"') q = false; continue; }
          if (ch === '"') q = true; else if (ch === '{' || ch === '[') depth++; else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { i++; break; } }
        }
        if (depth !== 0) return null;
      } else return null;
      const t = text.slice(start, i);
      let value;
      try { value = JSON.parse(t); } catch { return null; }
      const sep = /^\s*/.exec(text.slice(i))[0];
      i += sep.length;
      parts.push({ text: t, value, sep });
      if (parts.length > 1000) return null;
    }
    return parts.length ? { prefix: pre, parts } : null;
  };
  const filterOne = (mine, original, req) => {
      let current = original, changed = false;
      for (const f of mine) {
        let copy;
        try { copy = JSON.parse(JSON.stringify(current)); } catch { return; }
        const r = f.call(copy, harden({ url: req.url, method: String(req.method || 'GET'), status: Number(req.status) || 0 }));
        if (r && typeof r.then === 'function') { report(f.mod, new TypeError('TRIF sandbox: a filter returns the data itself, not a promise: TRIF kept what the site sent')); continue; }
        let out;
        try { out = JSON.parse(JSON.stringify(r === undefined ? copy : r)); } catch { report(f.mod, new TypeError('TRIF sandbox: a filter returns plain data: TRIF kept what the site sent')); continue; }
        let why;
        try { why = invented(original, out); } catch { why = 'it was too deep to check'; }
        if (why) { report(f.mod, new TypeError(`TRIF sandbox: a filter may only remove or reorder, and ${why}: TRIF kept what the site sent`)); continue; }
        current = out; changed = true;
      }
      return changed ? current : null;
  };
  // (B5: <script type="application/json"> the page embeds, filtered as they arrive, before the page's code
  // reads them; never a JavaScript script)
  const embeddedFilters = []; // {sel, call, mod}
  const embeddedDone = new WeakSet();
  const JSON_SCRIPT = /^application\/(ld\+)?json$/i;
  const filterScripts = (root) => {
    if (!embeddedFilters.length || !root || root.nodeType !== 1) return;
    const list = root.localName === 'script' ? [root] : root.querySelectorAll('script');
    for (const sc of list) {
      if (embeddedDone.has(sc) || !JSON_SCRIPT.test(String(sc.type || ''))) continue;
      const mine = embeddedFilters.filter((f) => { try { return sc.matches(f.sel); } catch { return false; } });
      if (!mine.length) continue;
      let value;
      try { value = JSON.parse(sc.textContent); } catch { continue; } // (still arriving: next time)
      embeddedDone.add(sc);
      const out = filterOne(mine, value, { url: `embedded:${location.href}`, method: 'EMBEDDED', status: 0 });
      if (out !== null) sc.textContent = JSON.stringify(out);
    }
  };
  // ---- page-data: the page's side answers during the event (runtime.js pageBridge)
  let pageDataAnswer = null;
  // (mods: channels between this page's boxed mods; in a page script, shared with the page's other ones)
  const channels = SANDBOX ? new Map() : (G.__trifChannels || (Object.defineProperty(G, '__trifChannels', { value: new Map() }), G.__trifChannels));
  D.addEventListener('trif:page-data-answer', (e) => { pageDataAnswer = typeof e.detail === 'string' ? e.detail : null; }, true);

  const apiFor = (modId, powers) => {
    if (apis.has(modId)) return apis.get(modId);
    // (its powers: docs/POWERS.md; what's not in this set it doesn't get, and a mod TRIF can't name gets none)
    const grant = Array.isArray(powers) ? { powers, args: {} } : powers && typeof powers === 'object' ? powers : { powers: [], args: {} };
    const self = { mod: modId, powers: new Set((Array.isArray(grant.powers) ? grant.powers : []).map(String)), args: grant.args && typeof grant.args === 'object' ? grant.args : {} };
    const has = (p) => self.powers.has(p);
    const needs = (p) => { if (!has(p)) fail(`that needs the ${p} power (// @powers ${p} in the mod's header, which the user approves)`); };
    apis.set(modId, self);
    for (const p of self.powers) inPlay.add(p);
    // (a callback of the mod's: errors reported as its own, and stand-ins' listeners are its own)
    const call = (fn, ...args) => { const prev = current, t = now(); current = self; try { return fn(...args); } catch (e) { report(modId, e); return undefined; } finally { current = prev; stats.callbacks++; stats.callbackMs += now() - t; } };
    // TRIF's functions as the mod sees them: an error from the browser (a DOMException, say) is passed on
    // as plain text, so no object from outside the compartment reaches the mod through it.
    const guard = (fn) => function (...args) {
      try { return fn.apply(this, args); } catch (e) {
        if (e instanceof TypeError && /^TRIF sandbox: /.test(e.message)) throw e;
        throw new TypeError(`TRIF sandbox: ${String(e && e.message ? e.message : e).slice(0, 500)}`);
      }
    };
    // (the page's own custom events, by the names in the header's @events: never a browser event's name, nor
    // TRIF's own; the detail as a plain JSON copy)
    const declaredEvents = (self.args.events || []).map(String);
    const listen = (target, type, fn, opts) => {
      str(type, 'an event type', 100);
      if (typeof fn !== 'function') fail('a listener must be a function');
      const capture = !!(opts && opts.capture);
      if (target === G && declaredEvents.includes(type) && CUSTOM_EVENT.test(type) && !/^trif:/i.test(type)) {
        const hc = (e) => { let detail = null; try { const d = e.detail; const j = d === undefined ? 'null' : JSON.stringify(d); detail = j && j.length <= 256 * 1024 ? JSON.parse(j) : null; } catch { detail = null; } call(fn, harden({ type: String(e.type), detail })); };
        // (on the window, capturing: an event the page sends on the document or one of its elements, bubbling or not)
        G.addEventListener(type, hc, true);
        return harden(() => G.removeEventListener(type, hc, true));
      }
      if (DRAG.test(type)) { if (!target || target.nodeType !== 1 || !created.has(target)) fail('drag and drop is for the mod\'s own elements'); }
      // (a picture of the mod's own loading, or not)
      else if (/^(load|error)$/.test(type)) { if (!target || target.localName !== 'img' || !created.has(target)) fail(`${type} is for the mod's own pictures`); }
      // (media, B12: the page's own video and audio as they play; nothing about their source)
      else if (MEDIA_EVENTS.test(type)) { if (!target || !/^(video|audio)$/.test(target.localName || '')) fail(`${type} is for the page's <video> and <audio>`); if (!self.powers.has('media')) fail('hearing the page\'s video and audio needs the media power (// @powers media)'); }
      else if (!LISTEN.test(type)) fail(`listening for "${type}" isn't offered${CUSTOM_EVENT.test(type) ? ' (a page\'s own event needs its name in the header: // @events ' + type + ')' : ''}`);
      if (type === 'pagehide' && target !== G) fail('pagehide is for page.on');
      const h = type === 'pagehide'
        // (as the page goes: only saving settings; nothing that acts)
        ? (e) => { leaving++; try { call(fn, eventOf(e, self.powers)); } finally { leaving--; } }
        : (e) => call(fn, eventOf(e, self.powers));
      target.addEventListener(type, h, { passive: !(opts && opts.preventDefault), capture });
      return harden(() => target.removeEventListener(type, h, { capture }));
    };
    const timerSet = new Set(), frameSet = new Set();
    const timers = {
      setTimeout: (fn, ms) => { if (typeof fn !== 'function') fail('setTimeout takes a function'); const h = setTimeout(() => { timerSet.delete(h); call(fn); }, Number(ms) || 0); timerSet.add(h); return h; },
      clearTimeout: (h) => { if (timerSet.delete(h)) clearTimeout(h); },
      setInterval: (fn, ms) => { if (typeof fn !== 'function') fail('setInterval takes a function'); const h = setInterval(() => call(fn), Math.max(4, Number(ms) || 0)); timerSet.add(h); return h; },
      clearInterval: (h) => { if (timerSet.delete(h)) clearInterval(h); },
      requestAnimationFrame: (fn) => { if (typeof fn !== 'function') fail('requestAnimationFrame takes a function'); const h = requestAnimationFrame((t) => { frameSet.delete(h); call(fn, t); }); frameSet.add(h); return h; },
      cancelAnimationFrame: (h) => { if (frameSet.delete(h)) cancelAnimationFrame(h); },
    };
    const css = (text, opts) => {
      const t = str(text, 'CSS', 500000);
      if (!cssOk(t)) fail('that CSS loads from an address (only data:, #somewhere, or an image the page shows), or has escapes outside strings');
      if (READS_FIELDS.test(t)) fail('CSS can\'t select by the value attribute or :autofill (it would read what\'s typed in a field)');
      if (opts !== undefined) {
        if (!opts || typeof opts !== 'object' || typeof opts.shadow !== 'string') fail('css\'s options are { shadow: \'a selector for the hosts\' }');
        // (into the shadow roots, open or closed, of the hosts that match, now and as they come: TRIF adds the
        // sheet; the mod reads nothing inside them)
        const sh = { id: `${modId}#${++shadowN}`, sel: selectorOk(opts.shadow), text: t };
        shadowCss.add(sh);
        shadowSend(sh);
        return harden({ remove: () => { shadowCss.delete(sh); shadowSend({ id: sh.id, remove: true }); } });
      }
      const st = styleSheet(t);
      return harden({ remove: () => st.remove() });
    };
    const observe = (sel, fn, opts) => {
      str(sel, 'a selector', 2000);
      qsa(D.createDocumentFragment(), sel);
      if (typeof fn !== 'function') fail('observe takes a function');
      // ({attributes: ['class', 'hidden']}: also when one of these changes on a matching element; never the
      // value attribute, which React keeps in step with what's typed, nor inside an editor)
      let names = null;
      if (opts !== undefined) {
        if (!opts || typeof opts !== 'object') fail('observe\'s options are { attributes: [names] }');
        if (opts.attributes !== undefined) {
          if (!Array.isArray(opts.attributes) || !opts.attributes.length || opts.attributes.length > 20) fail('attributes is a list of 1 to 20 attribute names');
          names = opts.attributes.map((a) => { const n = str(a, 'an attribute name', 60).toLowerCase(); if (!/^[a-z][\w:.-]*$/.test(n)) fail(`"${n}" isn't an attribute name`); if (n === 'value') fail('the value attribute isn\'t watched (React keeps it in step with what\'s typed in a field)'); return n; });
        }
      }
      const w = { sel, seen: new WeakSet(), call: (s) => call(fn, s), mod: modId };
      watch(modId, sel);
      watchers.add(w);
      ensureObserver();
      if (D.documentElement) runWatcher(w, D.documentElement);
      let am = null;
      if (names) {
        am = new MutationObserver((recs) => {
          for (const r of recs) {
            const n = r.target;
            if (!n.isConnected || insideEditor(n)) continue;
            let ok = false;
            try { ok = n.matches(sel); } catch { ok = false; }
            if (ok) call(fn, wrap(n), harden({ attribute: String(r.attributeName) }));
          }
        });
        am.observe(D, { attributes: true, attributeFilter: names, subtree: true });
      }
      return harden(() => { watchers.delete(w); if (am) am.disconnect(); });
    };
    // trif.changes(sel, fn): what changed under elements that match (children added or removed, text), in
    // batches: fn([stand-ins]); never inside an editor
    const changes = (sel, fn) => {
      str(sel, 'a selector', 2000);
      qsa(D.createDocumentFragment(), sel);
      if (typeof fn !== 'function') fail('changes takes a function');
      const ch = { sel, call: (l) => call(fn, l), pending: new Set(), timer: null, mod: modId };
      watch(modId, sel);
      changers.add(ch);
      ensureObserver();
      return harden(() => { changers.delete(ch); if (ch.timer) clearTimeout(ch.timer); ensureObserver(); });
    };
    // trif.wrap(sel, /pattern/, (match, groups) => stand-in or text): the page's text, split into the mod's own
    // pieces (each match handed over; what fn returns goes in its place)
    const wrapTextIn = (sel, pattern, fn) => {
      str(sel, 'a selector', 2000);
      qsa(D.createDocumentFragment(), sel);
      if (typeof fn !== 'function') fail('wrap takes a function');
      // (read through RegExp's own getters: a look-alike object fails there)
      let src, flags;
      try { src = REGEXP_SOURCE.call(pattern); flags = REGEXP_FLAGS.call(pattern); } catch { fail('wrap takes a pattern (/…/)'); }
      if (src.length > 200) fail('a pattern is up to 200 characters');
      if (/\([^)]*[+*][^)]*\)[+*{]/.test(src) || /\\[1-9]|\\k</.test(src)) fail('nested repeats ((a+)+ and the like) and back-references can make a page hang');
      const re = new RegExp(src, `${flags.replace(/[gy]/g, '')}g`);
      const wr = { sel, re, call: (m, g) => call(fn, m, g), mod: modId };
      wrappers.add(wr);
      ensureObserver();
      if (D.documentElement) wrapUnder(wr, D.documentElement);
      return harden(() => { wrappers.delete(wr); });
    };
    const text = (sel, fn) => {
      str(sel, 'a selector', 2000);
      qsa(D.createDocumentFragment(), sel);
      if (typeof fn !== 'function') fail('text takes a function');
      const tx = { sel, call: (t) => call(fn, t), mod: modId };
      texters.add(tx);
      ensureObserver();
      if (D.documentElement) textUnder(tx, D.documentElement);
      return harden(() => { texters.delete(tx); ensureObserver(); });
    };
    // Settings: the mod's own, for this site, kept by TRIF (TRIF's world: background.js sandboxSettings), not
    // in the site's storage. As a page script, the site's localStorage under a TRIF prefix.
    const settings = async (key, defaults) => {
      const k = str(key, 'a settings key', 100);
      let base;
      try { base = JSON.parse(JSON.stringify(defaults === undefined ? {} : defaults)); } catch { fail('settings defaults must be plain data (JSON)'); }
      let stored = null;
      if (SANDBOX && send && argsOf('migrate').length) { if (!migrated) migrated = migrate(); await migrated; }
      if (SANDBOX) {
        if (send) { try { const r = await send({ trifSandbox: 'settings.get', mod: modId, key: k }); stored = r && r.ok ? r.value : null; } catch { stored = null; } }
      } else {
        try { stored = JSON.parse(localStorage.getItem(`trif.settings.${modId}.${k}`) || 'null'); } catch { stored = null; }
      }
      const value = base && typeof base === 'object' && !Array.isArray(base) && stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...base, ...stored } : stored ?? base;
      const save = async (obj) => {
        let json;
        try { json = JSON.stringify(obj); } catch { fail('settings must be plain data (JSON)'); }
        if (json === undefined) fail('settings must be plain data (JSON)');
        if (json.length > 1024 * 1024) fail('settings can take up to 1 MB');
        if (SANDBOX) {
          if (!send) fail('settings can\'t be saved here');
          const r = await send({ trifSandbox: 'settings.save', mod: modId, key: k, json });
          if (!r || !r.ok) fail(`settings weren't saved${r && r.error ? `: ${r.error}` : ''}`);
        } else localStorage.setItem(`trif.settings.${modId}.${k}`, json);
        return true;
      };
      return harden({ value: harden(value), save: guard(save) });
    };
    // The `sound` power: Web Audio through TRIF's own set of nodes (oscillators, with waves of the mod's own,
    // gains, filters, delays, panners, compressors, noise, buffers from numbers, and sounds from data: URLs), a
    // node into another's parameter, offline renders of the mod's own graph (numbers back), and its own
    // context's clock: no address, no microphone, no worklet, no page media.
    let audio = null;
    const contextsMade = []; // (when this mod made its contexts: at most 6 a minute)
    // (every function here guarded: a browser error, thrown or rejected, reaches the mod as plain text)
    const clean = (e) => (e instanceof TypeError && /^TRIF sandbox: /.test(e.message) ? e : new TypeError(`TRIF sandbox: ${String(e && e.message ? e.message : e).slice(0, 500)}`));
    const hardenAll = (o) => { for (const k of Object.keys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (typeof d.value === 'function') { const fn = d.value; o[k] = function (...a) { let r; try { r = fn.apply(this, a); } catch (e) { throw clean(e); } return r && typeof r.then === 'function' ? r.then((x) => x, (e) => { throw clean(e); }) : r; }; } } return harden(o); };
    const num = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} must be a number`); return v; };
    const opt = (o) => (o && typeof o === 'object' ? o : {});
    // A list of numbers, copied into TRIF's own array before the browser sees it: an Array of plain number
    // values (no getters), or a typed array (copied by value, through its own slots)
    const numsOf = (a, what, max) => {
      let len = -1;
      try { len = TA_LENGTH.call(a); } catch { len = -1; }
      let out;
      if (len >= 0) {
        if (len > max) fail(`${what} is up to ${max} numbers`);
        out = new Float32Array(a);
      } else if (Array.isArray(a)) {
        if (a.length > max) fail(`${what} is up to ${max} numbers`);
        out = new Float32Array(a.length);
        for (let i = 0; i < a.length; i++) { const d = Object.getOwnPropertyDescriptor(a, i); if (!d || !('value' in d) || typeof d.value !== 'number') fail(`${what} is a list of numbers`); out[i] = d.value; }
      } else fail(`${what} is a list of numbers (an array or a typed array)`);
      for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) fail(`${what} has a number that isn't finite`);
      return out;
    };
    const RATE_MIN = 3000, RATE_MAX = 96000, SECONDS_MAX = 10;
    const rateOf = (r, dflt) => { const v = r === undefined ? dflt : num(r, 'a sample rate'); if (v < RATE_MIN || v > RATE_MAX) fail(`a sample rate is ${RATE_MIN} to ${RATE_MAX}`); return v; };
    // One context's API (the mod's live one, or an offline one for a render): its facades connect only to
    // each other's nodes and parameters, never to another context's
    const makeAudio = (ctx, offline) => {
      const nodeOfFacade = new WeakMap(), paramOfFacade = new WeakMap();
      const when = (at) => (at === undefined ? ctx.currentTime : num(at, 'a time'));
      const paramOf = (ap) => {
        const f = hardenAll({
          get value() { return ap.value; },
          set: (v, at) => { ap.setValueAtTime(num(v, 'a value'), when(at)); },
          ramp: (v, at) => { ap.linearRampToValueAtTime(num(v, 'a value'), num(at, 'a time')); },
          expRamp: (v, at) => { ap.exponentialRampToValueAtTime(num(v, 'a value'), num(at, 'a time')); },
          target: (v, at, tc) => { ap.setTargetAtTime(num(v, 'a value'), when(at), num(tc, 'a time constant')); },
          cancel: (at) => { ap.cancelScheduledValues(when(at)); },
        });
        paramOfFacade.set(f, ap);
        return f;
      };
      const PARAMS = ['frequency', 'detune', 'gain', 'Q', 'delayTime', 'pan', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release'];
      const facade = (node, extra) => {
        const o = {
          // (into another of this mod's nodes, into one of their parameters (FM, AM, an LFO), or 'out')
          connect: (to) => {
            if (to === 'out') node.connect(ctx.destination);
            else if (to && typeof to === 'object' && paramOfFacade.has(to)) node.connect(paramOfFacade.get(to));
            else node.connect(nodeOfFacade.get(to) || fail('connect takes another of this mod\'s sound nodes, one of their parameters, or \'out\''));
            return to;
          },
          disconnect: () => { node.disconnect(); },
          start: (at) => { if (typeof node.start !== 'function') fail('only sources start'); node.start(when(at)); },
          stop: (at) => { if (typeof node.stop !== 'function') fail('only sources stop'); node.stop(when(at)); },
          param: (name) => { str(name, 'a parameter', 40); if (!PARAMS.includes(name) || !node[name] || typeof node[name].setValueAtTime !== 'function') fail(`no ${name} here`); return paramOf(node[name]); },
        };
        if (extra) Object.defineProperties(o, Object.getOwnPropertyDescriptors(extra));
        const f = hardenAll(o);
        nodeOfFacade.set(f, node);
        return f;
      };
      // (a wave of the mod's own: the cosine and sine terms, 2 to 4096 of each, finite numbers)
      const waveOf = (real, imag) => {
        const re = numsOf(real, 'a wave\'s real terms', 4096), im = numsOf(imag, 'a wave\'s imaginary terms', 4096);
        if (re.length < 2 || re.length !== im.length) fail('a wave has as many real terms as imaginary ones, at least 2');
        return ctx.createPeriodicWave(re, im);
      };
      const oscillatorFacade = (n) => facade(n, { setWave: (real, imag) => { n.setPeriodicWave(waveOf(real, imag)); } });
      const buffers = new Map(); // data: URL -> decoded buffer
      const decode = async (url) => {
        const u = str(url, 'a sound', 20 * 1024 * 1024);
        const m = /^data:audio\/[a-z0-9.+-]+(?:;[a-z-]+=[^;,]*)*;base64,([A-Za-z0-9+/=\s]+)$/i.exec(u);
        if (!m) fail('sounds come from data:audio/…;base64 addresses only');
        if (!buffers.has(u)) {
          const bin = atob(m[1].replace(/\s+/g, ''));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          buffers.set(u, await ctx.decodeAudioData(bytes.buffer));
        }
        return buffers.get(u);
      };
      const sourceOf = (b, o) => { const n = ctx.createBufferSource(); n.buffer = b; o = opt(o); if (o.loop) n.loop = true; if (o.rate !== undefined) n.playbackRate.value = num(o.rate, 'a rate'); return facade(n); };
      const api = {
        get now() { return ctx.currentTime; },
        get state() { return ctx.state; },
        get rate() { return ctx.sampleRate; },
        out: 'out',
        oscillator: (o) => {
          const n = ctx.createOscillator(); o = opt(o);
          if (o.type !== undefined) n.type = str(o.type, 'a wave type', 20);
          if (o.frequency !== undefined) n.frequency.value = num(o.frequency, 'a frequency');
          if (o.wave !== undefined) { const w = opt(o.wave); n.setPeriodicWave(waveOf(w.real, w.imag)); }
          return oscillatorFacade(n);
        },
        gain: (v) => { const n = ctx.createGain(); if (v !== undefined) n.gain.value = num(v, 'a gain'); return facade(n); },
        filter: (o) => { const n = ctx.createBiquadFilter(); o = opt(o); if (o.type !== undefined) n.type = str(o.type, 'a filter type', 20); for (const k of ['frequency', 'Q', 'gain']) if (o[k] !== undefined) n[k].value = num(o[k], k); return facade(n); },
        delay: (sec) => { const n = ctx.createDelay(5); if (sec !== undefined) n.delayTime.value = num(sec, 'a delay'); return facade(n); },
        panner: (pan) => { const n = ctx.createStereoPanner(); if (pan !== undefined) n.pan.value = num(pan, 'a pan'); return facade(n); },
        // (a compressor: its settings numbers, and how much it's reducing, a number)
        compressor: (o) => {
          const n = ctx.createDynamicsCompressor(); o = opt(o);
          for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) if (o[k] !== undefined) n[k].value = num(o[k], k);
          return facade(n, { get reduction() { const r = n.reduction; return typeof r === 'number' ? r : Number(r && r.value) || 0; } });
        },
        noise: (sec) => {
          const len = Math.max(1, Math.min(ctx.sampleRate * SECONDS_MAX, Math.round(ctx.sampleRate * num(sec === undefined ? 1 : sec, 'a length'))));
          const b = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = b.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          return sourceOf(b);
        },
        // (a sound from numbers: one list per channel, up to 2 channels and 10 seconds, at 3000 to 96000 a second)
        buffer: (channels, rate, o) => {
          if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) fail('buffer takes one or two channels: [[numbers]] or [[left], [right]]');
          const r = rateOf(rate, ctx.sampleRate);
          const data = channels.map((c, i) => numsOf(c, `channel ${i + 1}`, Math.floor(r * SECONDS_MAX)));
          const len = data[0].length;
          if (!len || data.some((d) => d.length !== len)) fail('a buffer\'s channels are as long as each other, and not empty');
          const b = ctx.createBuffer(data.length, len, r);
          data.forEach((d, i) => b.copyToChannel(d, i));
          return sourceOf(b, o);
        },
        sound: async (url, o) => sourceOf(await decode(url), o),
        // the simple ones: a beep, and a sound played once
        tone: (o) => {
          o = opt(o);
          const t0 = when(o.at), dur = num(o.duration === undefined ? 0.15 : o.duration, 'a duration'), vol = num(o.volume === undefined ? 0.2 : o.volume, 'a volume');
          const osc = ctx.createOscillator(), g = ctx.createGain();
          if (o.type !== undefined) osc.type = str(o.type, 'a wave type', 20);
          osc.frequency.value = num(o.frequency === undefined ? 440 : o.frequency, 'a frequency');
          g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.005); g.gain.linearRampToValueAtTime(0, t0 + dur);
          osc.connect(g).connect(ctx.destination); osc.start(t0); osc.stop(t0 + dur + 0.02);
        },
        play: async (url, o) => {
          const b = await decode(url); o = opt(o);
          const n = ctx.createBufferSource(), g = ctx.createGain();
          n.buffer = b; g.gain.value = num(o.volume === undefined ? 1 : o.volume, 'a volume');
          n.connect(g).connect(ctx.destination); n.start(when(o.at));
          return hardenAll({ stop: () => { try { n.stop(); } catch { /* done */ } }, duration: b.duration });
        },
      };
      if (!offline) {
        Object.defineProperties(api, Object.getOwnPropertyDescriptors({
          // (the mod's own context's clock: paused, resumed, closed (the next trif.audio() makes a new one), and
          // how late its sound comes out, in seconds)
          resume: () => { if (audio && audio.ctx === ctx) audio.paused = false; return ctx.resume().then(() => ctx.state, () => ctx.state); },
          suspend: () => { if (audio && audio.ctx === ctx) audio.paused = true; return ctx.suspend().then(() => ctx.state, () => ctx.state); },
          close: () => { if (audio && audio.ctx === ctx) audio = null; return ctx.close().then(() => 'closed', () => ctx.state); },
          get latency() { return harden({ base: Number(ctx.baseLatency) || 0, output: Number(ctx.outputLatency) || 0 }); },
          // An offline render of the mod's own graph: build(audio) makes it, with the same API on a context that
          // only renders; what comes back is numbers (each channel's samples, its peak and RMS). Up to 10 s, one
          // at a time.
          render: async (seconds, build, o) => {
            const sec = num(seconds, 'a length in seconds');
            if (!(sec > 0 && sec <= SECONDS_MAX)) fail(`a render is up to ${SECONDS_MAX} seconds`);
            if (typeof build !== 'function') fail('render takes a function that builds the sound');
            o = opt(o);
            const r = rateOf(o.rate, 44100);
            const chans = o.channels === undefined ? 1 : num(o.channels, 'channels');
            if (chans !== 1 && chans !== 2) fail('a render has 1 or 2 channels');
            if (rendering) fail('one render at a time');
            rendering = true;
            try {
              const off = new G.OfflineAudioContext(chans, Math.ceil(sec * r), r);
              const built = build(makeAudio(off, true));
              if (built && typeof built.then === 'function') await built;
              const buf = await off.startRendering();
              const channels = [];
              let peak = 0, sum = 0;
              for (let c = 0; c < buf.numberOfChannels; c++) {
                const d = new Float32Array(buf.getChannelData(c));
                for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
                channels.push(d);
              }
              return harden({ rate: buf.sampleRate, length: buf.length, peak, rms: Math.sqrt(sum / Math.max(1, buf.length * buf.numberOfChannels)), channels: harden(channels) });
            } finally { rendering = false; }
          },
        }));
      }
      return hardenAll(api);
    };
    let rendering = false;
    const audioApi = () => {
      needs('sound');
      if (audio) return audio.api;
      const AC = G.AudioContext || G.webkitAudioContext;
      if (!AC) fail('this browser has no Web Audio');
      const t = Date.now();
      while (contextsMade.length && t - contextsMade[0] > 60000) contextsMade.shift();
      if (contextsMade.length >= 6) fail('a mod makes up to 6 sound contexts a minute (close one less often)');
      contextsMade.push(t);
      const ctx = new AC();
      // (the browser starts it only after the user does something on the page: TRIF resumes it then)
      const wake = () => { if (ctx.state === 'suspended' && audio && audio.ctx === ctx && !audio.paused) ctx.resume().catch(() => {}); };
      for (const ty of ['pointerdown', 'keydown']) G.addEventListener(ty, wake, { capture: true, passive: true });
      const api = makeAudio(ctx, false);
      audio = { ctx, api, paused: false };
      return api;
    };
    // ---- 0.3 powers (WIDEN.md class B)
    const argsOf = (p) => (self.args[p] || []).map(String);
    // block-events: trif.block(type, fn?): the page doesn't see that event (when fn returns true, or always
    // without fn); click-like ones only on the header's selectors. A blocked event reaches only fn.
    const block = (type, fn) => {
      needs('block-events');
      const ty = str(type, 'an event type', 40);
      const decl = argsOf('block-events').map((a) => /^([a-z]+)(?:\((.+)\))?$/.exec(a)).filter((m) => m && m[1] === ty);
      if (!decl.length || !BLOCK_TYPES.includes(ty)) fail(`"${ty}" isn't one of the events the header says it keeps from the site (${argsOf('block-events').join(', ')})`);
      if (fn !== undefined && typeof fn !== 'function') fail('block takes a function, or nothing');
      const sels = decl.some((m) => !m[2]) ? null : decl.map((m) => m[2]);
      const b = { type: ty, sels, fn: fn || null, api: self };
      blocks.add(b);
      return harden(() => { blocks.delete(b); });
    };
    // page-events: trif.signal(name, detail): one of the header's names, sent to the page's own code on the
    // document, the detail plain JSON with no address the page's links don't have
    const signal = (name, detail) => {
      needs('page-events');
      notLeaving();
      const n = str(name, 'a signal', 100);
      if (!argsOf('page-events').includes(n)) fail(`"${n.slice(0, 60)}" isn't one of the header's signals (${argsOf('page-events').join(', ')})`);
      signalOk(self);
      let json = 'null';
      if (detail !== undefined) { try { json = JSON.stringify(detail); } catch { fail('a signal\'s detail is plain data (JSON)'); } }
      if (json === undefined || json.length > 64 * 1024) fail('a signal\'s detail is plain data, up to 64 KB');
      noNewAddress('', json);
      D.dispatchEvent(new CustomEvent('trif:page-event', { detail: JSON.stringify({ name: n, detail: json }) }));
    };
    // site-storage: trif.storage('local' | 'session' | 'cookie'): the header's keys only (a prefix with *);
    // cookies read only; what it writes has no address that wasn't there or in a link on the page
    const storage = (area) => {
      needs('site-storage');
      const a = str(area, 'where', 10);
      if (!/^(local|session|cookie)$/.test(a)) fail('storage is \'local\', \'session\' or \'cookie\'');
      const declared = argsOf('site-storage').filter((k) => k.startsWith(`${a}:`)).map((k) => k.slice(a.length + 1));
      if (!declared.length) fail(`the header names no ${a}: keys (@powers site-storage ${a}:a-key)`);
      const ok = (k) => declared.some((d) => (d.endsWith('*') ? k.startsWith(d.slice(0, -1)) : k === d));
      const keyOk = (k) => { str(k, 'a key', 200); if (!ok(k)) fail(`"${k.slice(0, 60)}" isn't one of the header's keys (${declared.join(', ')})`); return k; };
      const st = a === 'local' ? G.localStorage : a === 'session' ? G.sessionStorage : null;
      const cookies = () => { const out = {}; for (const part of String(D.cookie || '').split(/;\s*/)) { const i = part.indexOf('='); if (i > 0) out[decodeURIComponent(part.slice(0, i))] = part.slice(i + 1); } return out; };
      return harden({
        get: (k) => { keyOk(k); return a === 'cookie' ? (cookies()[k] ?? null) : st.getItem(k); },
        keys: () => harden((a === 'cookie' ? Object.keys(cookies()) : Array.from({ length: st.length }, (_, i) => st.key(i))).filter((k) => k !== null && ok(k))),
        set: (k, v) => {
          if (a === 'cookie') fail('cookies are only read');
          keyOk(k);
          const val = str(String(v), 'a value', 1024 * 1024);
          noNewAddress(st.getItem(k) || '', val);
          st.setItem(k, val);
        },
        remove: (k) => { if (a === 'cookie') fail('cookies are only read'); keyOk(k); st.removeItem(k); },
      });
    };
    // @migrate: its old settings, once per site: what its free version kept under those keys, as settings
    // keys of the same names (trif.settings('rrRave.zoom', …)), before its first trif.settings answers
    // (lazily, at the mod's first trif.settings: what the page itself keeps is there by then)
    let migrated = null;
    const migrate = () => (async () => {
      try {
        const r = await send({ trifSandbox: 'settings.get', mod: modId, key: '__migrated' });
        if (r && r.ok && r.value) return;
        for (const key of argsOf('migrate')) {
          const [area, ...rest] = key.split(':');
          const name = rest.join(':');
          const st = area === 'session' ? G.sessionStorage : G.localStorage;
          const raw = st.getItem(name);
          if (raw === null || name.length > 100 || raw.length > 1024 * 1024) continue;
          let json;
          try { JSON.parse(raw); json = raw; } catch { json = JSON.stringify(raw); }
          await send({ trifSandbox: 'settings.save', mod: modId, key: name, json });
        }
        await send({ trifSandbox: 'settings.save', mod: modId, key: '__migrated', json: 'true' });
      } catch { /* next time */ }
    })();
    // rewrite-requests: the header's rules, handed to the page's side as the mod starts
    if (self.powers.has('rewrite-requests')) {
      for (const rule of argsOf('rewrite-requests')) {
        const [op, ...sets] = rule.split(' ');
        rewriteRules.push({ mod: modId, op, sets: sets.map((x) => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }) });
      }
      announceRewrites();
    }
    // image-variants: another size of a picture the page shows, by the header's literal change, from its host;
    // a new <img> of the mod's own (pixels readable where the host allows it: CORS)
    const imageVariant = (img) => {
      needs('image-variants');
      partnersOk(self, 'image-variants');
      const n = nodeOf(img);
      if (n.localName !== 'img' || n.namespaceURI !== HTML_NS || created.has(n)) fail('imageVariant takes one of the page\'s own pictures (<img>)');
      let u;
      try { u = new URL(n.currentSrc || n.src); } catch { fail('that picture has no address'); }
      const rules = argsOf('image-variants').map((r) => r.split(' ')).filter((r) => r[0] === u.hostname.toLowerCase());
      if (!rules.length) fail(`that picture isn't from ${argsOf('image-variants').map((r) => r.split(' ')[0]).join(', ')}`);
      let rest = u.pathname + u.search;
      for (const ch of rules[0].slice(1)) { const i = ch.indexOf('→'); const from = ch.slice(0, i), to = ch.slice(i + 1); if (rest.includes(from)) rest = rest.replace(from, to); }
      const abs = `${u.origin}${rest}`;
      if (abs === u.href) fail('the header\'s change doesn\'t apply to that picture\'s address');
      const v = D.createElement('img');
      created.add(v);
      variantImgs.add(v);
      // (its address set by the page's side, under the page's own rules for pictures)
      D.documentElement.append(v);
      v.dispatchEvent(new CustomEvent('trif:image-src', { detail: abs }));
      v.remove();
      return wrap(v);
    };
    // edit-uploads: trif.onUpload((canvas, {width, height, type}) => canvas): each picture the user attaches
    const onUpload = (fn) => {
      needs('edit-uploads');
      if (typeof fn !== 'function') fail('onUpload takes a function');
      const u = { fn, api: self };
      uploadFns.add(u);
      return harden(() => { uploadFns.delete(u); });
    };
    // embeds: trif.embed(link, {label}): TRIF's button; the user's click on it plays the video the link names,
    // inside the page, from the header's player (the video's id kept, nothing else)
    const embed = (link, o) => {
      needs('embeds');
      const l = nodeOf(link);
      if (l.localName !== 'a' || created.has(l)) fail('embed takes a link the page shows');
      let u;
      try { u = new URL(l.href); } catch { fail('that link has no address'); }
      const yt = /(^|\.)youtube\.com$/.test(u.hostname) ? (u.searchParams.get('v') || (/^\/(shorts|embed|live)\/([\w-]{11})/.exec(u.pathname) || [])[2]) : u.hostname === 'youtu.be' ? u.pathname.slice(1, 12) : null;
      const vm = /(^|\.)vimeo\.com$/.test(u.hostname) ? (/^\/(\d{4,12})(\/|$)/.exec(u.pathname) || [])[1] : null;
      const players = argsOf('embeds');
      let src = null;
      if (yt && /^[\w-]{11}$/.test(yt)) { const p = players.find((x) => /youtube/.test(x)); if (p) src = `https://${p}/${yt}`; }
      if (vm) { const p = players.find((x) => /vimeo/.test(x)); if (p) src = `https://${p}/${vm}`; }
      if (!src) fail(`that link isn't a video from ${players.join(', ')}`);
      const b = D.createElement('button');
      b.setAttribute('type', 'button');
      b.textContent = o && typeof o.label === 'string' ? o.label.slice(0, 100) : 'Play the video here';
      created.add(b);
      embedOf.set(b, src);
      b.addEventListener('click', (e) => { if (!e.isTrusted || !b.isConnected) return; e.preventDefault(); b.dispatchEvent(new CustomEvent('trif:embed', { detail: src })); });
      return wrap(b);
    };
    // local-fonts: the fonts installed here, after the browser's own prompt (call it from the user's click)
    const localFonts = async () => {
      needs('local-fonts');
      if (typeof G.queryLocalFonts !== 'function') fail('this browser doesn\'t list its fonts');
      const list = await G.queryLocalFonts();
      return harden(Array.from(list).slice(0, 5000).map((f) => harden({ family: String(f.family), fullName: String(f.fullName), style: String(f.style), postscriptName: String(f.postscriptName) })));
    };
    // go-to: reload (at most once in 10 seconds in a tab, TRIF's background counts), and in-app moves
    const reload = async () => {
      needs('go-to');
      notLeaving();
      partnersOk(self, 'go-to');
      if (!argsOf('go-to').includes('reload')) fail('reloading needs `reload` in the header: @powers go-to reload');
      if (SANDBOX) { const r = send ? await send({ trifSandbox: 'reload', mod: modId, key: 'reload' }) : null; if (!r || !r.ok) fail(r && r.error ? r.error : 'not reloaded'); }
      location.reload();
    };

    const onUrl = (fn) => {
      if (typeof fn !== 'function') fail('onUrl takes a function');
      const f = (u) => call(fn, u);
      urlFns.add(f);
      return harden(() => { urlFns.delete(f); });
    };
    const trifApi = {
      css, observe, text, settings, audio: audioApi, changes, wrap: wrapTextIn, onUrl, ready: readyP, loaded: loadedP,
      block, signal, storage, imageVariant, onUpload, embed, localFonts, reload,
      // site-data: filter the site's JSON responses whose address matches `glob` (* for anything)
      filterResponse: (glob, fn) => {
        needs('site-data');
        str(glob, 'an address pattern', 500);
        if (typeof fn !== 'function') fail('filterResponse takes a function');
        const re = new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        filters.push({ re, glob, call: (data, info) => call(fn, data, info), mod: modId });
        listenForFilters();
        announceFilters();
      },
      // search-box: TRIF's own box (the mod can place and style it, but not fill or read it); Enter, by the
      // user, goes to the address in the header with what they typed
      // go-to: one of the header's pages, or a link the page shows
      goTo: (where, inApp) => {
        needs('go-to');
        notLeaving();
        partnersOk(self, 'go-to');
        const p = str(where, 'a page', 2000);
        const paths = (self.args['go-to'] || []).filter((x) => x !== 'reload');
        let abs = null;
        if (paths.includes(p)) abs = new URL(p, location.href).href;
        else {
          // (a page with a query from the header's list: /?mods=red,blue for /?mods=[red|blue|green])
          for (const x of paths) {
            const m = /^([^?]+)\?([\w-]+)=\[([^\]]+)\]$/.exec(x);
            if (!m) continue;
            const q = new RegExp(`^${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?${m[2]}=([\\w,-]+)$`).exec(p);
            const vals = q ? q[1].split(',') : null;
            if (vals && vals.length && vals.every((v) => m[3].split('|').includes(v)) && new Set(vals).size === vals.length) { abs = new URL(p, location.href).href; break; }
          }
        }
        if (!abs) { try { const u = new URL(p, location.href); if (u.origin === ORIGIN && shownLink(u.href)) abs = u.href; } catch { /* not an address */ } }
        if (!abs) fail(`"${p.slice(0, 80)}" isn't one of the header's pages (${paths.join(', ') || 'none'}), or a link to this site that the page shows`);
        // (in the app: TRIF moves the address and tells the page's router, as its back button would)
        if (inApp && typeof inApp === 'object' && inApp.inApp) { history.pushState(null, '', abs); G.dispatchEvent(new PopStateEvent('popstate', { state: null })); return; }
        location.assign(abs);
      },
      // site-data, B5: the page's embedded JSON scripts, and its data globals named in the header
      filterEmbedded: (sel, fn) => {
        needs('site-data');
        selCheck(sel);
        if (typeof fn !== 'function') fail('filterEmbedded takes a function');
        embeddedFilters.push({ sel, call: (data, info) => call(fn, data, info), mod: modId });
        ensureObserver();
        if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => filterScripts(D.documentElement), { once: true });
        if (D.documentElement) filterScripts(D.documentElement);
      },
      filterGlobal: (name, fn) => {
        needs('site-data');
        const n = str(name, 'a global\'s name', 60);
        if (!(self.args['site-data'] || []).includes(n)) fail(`"${n}" isn't one of the data globals the header names (@powers site-data ${n})`);
        if (typeof fn !== 'function') fail('filterGlobal takes a function');
        filters.push({ re: new RegExp(`^global:${n.replace(/\$/g, '\\$')}$`), glob: `global:${n}`, call: (data, info) => call(fn, data, info), mod: modId });
        listenForFilters();
        D.dispatchEvent(new CustomEvent('trif:filter-globals', { detail: JSON.stringify([n]) }));
      },
      // mods: a channel between this page's boxed mods, through TRIF only (never the page's DOM)
      channel: (name) => {
        needs('mods');
        const nm = str(name, 'a channel name', 100);
        const ch = channels.get(nm) || new Set();
        channels.set(nm, ch);
        const me = { mod: modId, call, fns: new Set() };
        ch.add(me);
        return harden({
          send: (data) => {
            notLeaving();
            // (plain data only: text, numbers, true/false, null, and arrays and plain objects of those; no
            // functions or stand-ins, which JSON would drop or turn into {} without a word)
            const plain = (v, depth) => {
              if (depth > 50) fail('a message is nested too deep');
              if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
              if (Array.isArray(v)) { for (const x of v) plain(x, depth + 1); return; }
              const pr = typeof v === 'object' ? Object.getPrototypeOf(v) : undefined;
              if (pr !== Object.prototype && pr !== null) fail('a message is plain data: text, numbers, true/false, null, arrays and plain objects (no functions or elements)');
              for (const k of Object.keys(v)) plain(v[k], depth + 1);
            };
            plain(data, 0);
            const text = JSON.stringify(data);
            if (text.length > 256 * 1024) fail('a message is up to 256 KB');
            for (const other of ch) if (other !== me) for (const f of other.fns) setTimeout(() => other.call(f, JSON.parse(text), harden({ from: modId })), 0);
          },
          on: (fn) => { if (typeof fn !== 'function') fail('on takes a function'); me.fns.add(fn); return harden(() => { me.fns.delete(fn); }); },
        });
      },
      searchBox: (o) => {
        needs('search-box');
        const tmpl0 = (self.args['search-box'] || [])[0];
        if (!tmpl0) fail('the search-box power needs its address in the header: @powers search-box https://…{query}');
        o = o && typeof o === 'object' ? o : {};
        // (options: autofocus at load, spaces as +, an empty search, the mod's own button that searches, the
        // current host when it's a host of the same site, and {link}: the path of a link the page shows)
        let tmpl = tmpl0;
        if (tmpl.includes('{link}')) {
          const l = o.link ? nodeOf(o.link) : null;
          if (!l || l.localName !== 'a' || created.has(l)) fail('this search box\'s address has {link}: give it a link the page shows, { link: page.find(…) }');
          let u = null;
          try { u = new URL(l.href); } catch { u = null; }
          if (!u || u.origin !== ORIGIN || !shownLink(u.href)) fail('{link} is a link the page shows, on this site');
          tmpl = tmpl.replace('{link}', u.pathname.replace(/^\/+|\/+$/g, ''));
        }
        if (o.here) {
          const t = new URL(tmpl.replace('{query}', 'q'));
          const base = t.hostname.replace(/^www\./, '');
          if (location.hostname !== t.hostname && (location.hostname === base || location.hostname.endsWith(`.${base}`))) tmpl = tmpl.replace(t.origin, ORIGIN);
        }
        const plus = o.spaces === '+';
        const emptyOk = !!o.emptyOk;
        const host = D.createElement('div');
        created.add(host);
        trifBoxes.add(host);
        const root = host.attachShadow({ mode: 'closed' });
        const input = D.createElement('input');
        input.type = 'search';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('aria-label', 'Search');
        const ph = typeof o.placeholder === 'string' ? o.placeholder.slice(0, 100) : '';
        if (ph) input.placeholder = ph;
        input.style.cssText = 'all: unset; box-sizing: border-box; width: 100%; font: inherit; color: inherit; padding: 0.4em 0.6em; border: 1px solid currentColor; border-radius: 0.4em;';
        trifBoxes.add(input);
        boxInputs.set(host, input);
        const go = () => {
          const q = input.value.trim();
          if (!q && !emptyOk) return;
          const enc = plus ? encodeURIComponent(q).replace(/%20/g, '+') : encodeURIComponent(q);
          location.assign(tmpl.replace('{query}', enc));
        };
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !e.isTrusted) return;
          e.preventDefault();
          go();
        });
        if (o.button !== undefined) {
          const b = nodeOf(o.button);
          if (!created.has(b) || b.localName !== 'button') fail('button is a <button> of the mod\'s own');
          // (TRIF presses it: on the user's own click only)
          b.addEventListener('click', (e) => { if (e.isTrusted) go(); });
        }
        root.append(input);
        // (autofocus: once, at load, and only when the focus is on nothing)
        if (o.autofocus) {
          const focusIfFree = () => { const a = D.activeElement; if ((!a || a === D.body || a === D.documentElement) && D.visibilityState === 'visible') input.focus({ preventScroll: true }); };
          if (now() < 10000) setTimeout(focusIfFree, 0);
        }
        return wrap(host);
      },
      hide: (sel) => { const r = css(`${selectorOk(sel)} { display: none !important; }`); watch(modId, sel); return r; },
      log: logTo(modId, 'log'), warn: logTo(modId, 'warn'), error: logTo(modId, 'error'),
    };
    const consoleApi = { log: logTo(modId, 'log'), info: logTo(modId, 'log'), debug: logTo(modId, 'log'), warn: logTo(modId, 'warn'), error: logTo(modId, 'error') };
    const pageApi = {
      get url() { return location.href; },
      get title() { return D.title; },
      get width() { return innerWidth; },
      get height() { return innerHeight; },
      get scrollX() { return scrollX; },
      get scrollY() { return scrollY; },
      get root() { return wrap(D.documentElement); },
      get body() { return wrap(D.body); },
      get prefersReducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; },
      get prefersDark() { return matchMedia('(prefers-color-scheme: dark)').matches; },
      // display facts, read only (visibilitychange: page.on)
      get devicePixelRatio() { return G.devicePixelRatio || 1; },
      get visibilityState() { return String(D.visibilityState); },
      get hidden() { return !!D.hidden; },
      // a media query, answered by the browser: { matches, onChange(fn) }
      matchMedia: (q) => {
        const mq = matchMedia(str(q, 'a media query', 500));
        return harden({
          get matches() { return mq.matches; },
          onChange: (fn) => { if (typeof fn !== 'function') fail('onChange takes a function'); const api = cur(); const h = () => api.call(fn, mq.matches); mq.addEventListener('change', h); return harden(() => mq.removeEventListener('change', h)); },
        });
      },
      // what's at a point: stand-ins (a shadow root's host, a frame's element: never what's inside them)
      elementFromPoint: (x, y) => { if (typeof x !== 'number' || typeof y !== 'number') fail('a point is two numbers'); return wrap(D.elementFromPoint(x, y)); },
      elementsFromPoint: (x, y) => { if (typeof x !== 'number' || typeof y !== 'number') fail('a point is two numbers'); return list((D.elementsFromPoint(x, y) || []).slice(0, 100)); },
      // the page's style sheets, as plain copies (another site's sheet stays hidden, as the browser hides it)
      styleSheets: () => {
        const out = [];
        let budget = 20000;
        const walk = (rules, into, media) => {
          for (const r of rules) {
            if (budget-- <= 0) return;
            if (r.cssRules && !r.style) { walk(r.cssRules, into, r.conditionText || (r.media && r.media.mediaText) || media); continue; }
            into.push(harden({ selector: typeof r.selectorText === 'string' ? r.selectorText : null, text: String(r.cssText || '').slice(0, 20000), ...(media ? { media: String(media) } : {}) }));
          }
        };
        for (const sh of D.styleSheets) {
          if (sh.ownerNode && trifSheets.has(sh.ownerNode)) continue;
          let rules = null;
          try { rules = sh.cssRules; } catch { rules = null; }
          const list2 = [];
          if (rules) walk(rules, list2, null);
          out.push(harden({ href: sh.href || null, readable: !!rules, rules: harden(list2) }));
        }
        return harden(out);
      },
      // the mod's own SVG (the shapes in sandbox.js's SVG_TAGS; attributes through setAttr)
      createSvg(tag) {
        const t = str(tag, 'a tag', 40).toLowerCase();
        if (!SVG_TAGS.has(t)) fail(`<${t}> isn't one of the SVG elements offered`);
        const n = D.createElementNS(SVG_NS, SVG_TAG_CASE[t] || t);
        created.add(n);
        return wrap(n);
      },
      find: (sel) => wrap(qs(D, str(sel, 'a selector', 2000))),
      findAll: (sel) => list(qsa(D, str(sel, 'a selector', 2000))),
      create(tag) {
        const t = str(tag, 'a tag', 40).toLowerCase();
        if (CONTROL_TAGS.has(t) && t !== 'label') needs('controls');
        if (!TAGS.has(t) && !CONTROL_TAGS.has(t)) fail(`<${t}> elements aren't offered`);
        const n = D.createElement(t);
        if (t === 'input') { n.setAttribute('type', 'text'); n.setAttribute('autocomplete', 'off'); }
        // (a button that never submits a form, whatever it's in: its type isn't offered to change)
        if (t === 'button') n.setAttribute('type', 'button');
        created.add(n);
        return wrap(n);
      },
      on: (type, fn, opts) => listen(G, type, fn, opts),
    };
    const g = (o) => { for (const k of Object.keys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (typeof d.value === 'function') o[k] = guard(d.value); } return harden(o); };
    return Object.assign(self, { id: modId, listen, guard, call, endowments: { page: g(pageApi), trif: g(trifApi), console: harden(consoleApi), ...Object.fromEntries(Object.entries(timers).map(([k, f]) => [k, harden(guard(f))])) } });
  };

  // ---- the element stand-ins' methods (shared). `listen` and errors are the calling mod's: a stand-in is
  // the same object for every mod, so which mod listens is the one whose code is running (`current`).
  // (code after an await runs outside both: then the mod is the one in the call stack, by its sourceURL)
  const modFromStack = () => { const m = /trif-sandbox:\/\/([^\s/]+\/[^\s/:)]+?)\.js/.exec(String(stackOf(new Error()) || '')); return m ? m[1] : null; };
  const cur = () => current || apiFor(modFromStack() || '(a boxed mod)');
  // (each method guarded: a browser error reaches the mod as plain text)
  const guardShared = (fn) => function (...args) {
    try { return fn.apply(this, args); } catch (e) {
      if (e instanceof TypeError && /^TRIF sandbox: /.test(e.message)) throw e;
      throw new TypeError(`TRIF sandbox: ${String(e && e.message ? e.message : e).slice(0, 500)}`);
    }
  };
  // (a picture a mod may draw: its own canvases, images it made from data:/blob: or from an address an image on
  // the page shows, and the page's own images (the browser's taint rules then decide whether pixels read back);
  // never the page's canvas (a signature pad, a drawing the page uploads) or its video)
  const imageSource = (s) => {
    const n = nodeOf(s);
    if (n.localName === 'canvas') { if (!created.has(n)) fail('the page\'s own canvas isn\'t drawn from (it may be a signature pad, or a drawing the page uploads)'); return n; }
    if (n.localName === 'img' && n.namespaceURI === HTML_NS) {
      if (created.has(n) && !variantImgs.has(n)) { const src = String(n.getAttribute('src') || ''); if (!/^(data:image\/|blob:)/i.test(src) && !shownImage(n.src)) fail('an image the mod made is drawn from data:, blob:, or an address an image on the page shows'); }
      return n;
    }
    return fail('drawImage and pattern take the mod\'s own canvas, or an image (<img>)');
  };
  const DRAW_PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'globalAlpha', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY',
    'globalCompositeOperation', 'lineDashOffset', 'filter', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'direction', 'letterSpacing', 'wordSpacing', 'fontKerning', 'miterLimit', 'textRendering', 'fontStretch'];
  const METRICS = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent',
    'emHeightAscent', 'emHeightDescent', 'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline'];
  const DATA_URL_MAX = 8 * 1024 * 1024;
  const ctxOf = (canvas) => {
    const c = canvas.getContext('2d');
    if (!c) fail('no 2D drawing on this canvas');
    const ops = {};
    const paints = new WeakMap(); // (gradient and pattern handles -> the browser's)
    const numbers = (k, a) => { for (const x of a) if (typeof x !== 'number' && x !== undefined) fail(`${k} takes numbers`); };
    for (const k of ['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
      'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'resetTransform', 'clip', 'roundRect', 'transform']) {
      ops[k] = guardShared((...a) => { for (const x of a) if (typeof x !== 'number' && typeof x !== 'string' && x !== undefined) fail(`${k} takes numbers and text`); c[k](...a); });
    }
    // (all of a text's measurements: numbers)
    ops.measureText = guardShared((t) => { const m = c.measureText(str(t, 'text', 10000)); const o = {}; for (const k of METRICS) if (typeof m[k] === 'number') o[k] = m[k]; return harden(o); });
    const colour = (v) => { const t = str(v, 'a colour', 200); if (!cssOk(t) || /url\s*\(/i.test(t)) fail('a colour loads nothing'); return t; };
    const paintHandle = (g) => { const h = harden({ addStop: guardShared((offset, col) => { if (typeof offset !== 'number') fail('a stop\'s offset is a number from 0 to 1'); g.addColorStop(offset, colour(col)); }) }); paints.set(h, g); return h; };
    ops.linearGradient = guardShared((...a) => { numbers('linearGradient', a); return paintHandle(c.createLinearGradient(...a)); });
    ops.radialGradient = guardShared((...a) => { numbers('radialGradient', a); return paintHandle(c.createRadialGradient(...a)); });
    ops.conicGradient = guardShared((...a) => { numbers('conicGradient', a); if (typeof c.createConicGradient !== 'function') fail('this browser has no conic gradients'); return paintHandle(c.createConicGradient(...a)); });
    ops.pattern = guardShared((src, rep) => { const p = c.createPattern(imageSource(src), rep === undefined ? 'repeat' : str(rep, 'a repetition', 20)); if (!p) return null; const h = harden({}); paints.set(h, p); return h; });
    ops.set = guardShared((props) => {
      for (const [k, v] of Object.entries(props || {})) {
        if (!DRAW_PROPS.includes(k)) fail(`${k} can't be set here`);
        if ((k === 'fillStyle' || k === 'strokeStyle') && v && typeof v === 'object') { const p = paints.get(v); if (!p) fail(`${k} takes a colour, or a gradient or pattern of this canvas`); c[k] = p; continue; }
        if (k === 'imageSmoothingEnabled') { c[k] = !!v; continue; }
        if (typeof v !== 'string' && typeof v !== 'number') fail(`${k} takes text or a number`);
        // (a filter, a colour or a font: CSS that loads nothing, not even a url(#…) filter)
        if (typeof v === 'string' && (!cssOk(v) || /url\s*\(/i.test(v))) fail(`${k} loads nothing (no url())`);
        c[k] = v;
      }
    });
    ops.setLineDash = guardShared((list) => { c.setLineDash(Array.from(numsCopy(list, 'a dash pattern', 100))); });
    ops.isPointInPath = guardShared((x, y) => { numbers('isPointInPath', [x, y]); return c.isPointInPath(x, y); });
    ops.isPointInStroke = guardShared((x, y) => { numbers('isPointInStroke', [x, y]); return c.isPointInStroke(x, y); });
    ops.drawImage = guardShared((src, ...a) => { numbers('drawImage', a); c.drawImage(imageSource(src), ...a); });
    // (pixels: of what's drawn here; the browser refuses where a picture from another site tainted the canvas)
    ops.getImageData = guardShared((x, y, w, h) => {
      numbers('getImageData', [x, y, w, h]);
      if (!(w > 0 && h > 0) || w * h > 16 * 1024 * 1024) fail('getImageData takes a width and height, up to 16 million pixels');
      const d = c.getImageData(x, y, w, h);
      return harden({ width: d.width, height: d.height, data: new Uint8ClampedArray(d.data) });
    });
    ops.putImageData = guardShared((img, x, y) => {
      numbers('putImageData', [x, y]);
      const o = img && typeof img === 'object' ? img : fail('putImageData takes { width, height, data }');
      const w = o.width, h = o.height;
      if (typeof w !== 'number' || typeof h !== 'number' || !(w > 0 && h > 0) || w * h > 16 * 1024 * 1024) fail('putImageData takes a width and height');
      const px = new Uint8ClampedArray(numsCopy(o.data, 'pixels', w * h * 4));
      if (px.length !== w * h * 4) fail('the pixels are width × height × 4 numbers');
      // (through the canvas's own ImageData: Firefox won't take one built from this world's array)
      const out = c.createImageData(w, h);
      for (let i = 0, d = out.data; i < px.length; i++) d[i] = px[i]; // (element by element: Firefox won't take this world's array whole)
      c.putImageData(out, x, y);
    });
    ops.toDataURL = guardShared((type, q) => {
      const t = type === undefined ? 'image/png' : str(type, 'a type', 30);
      if (!/^image\/(png|jpeg|webp)$/.test(t)) fail('toDataURL makes image/png, image/jpeg or image/webp');
      const u = canvas.toDataURL(t, typeof q === 'number' ? q : undefined);
      if (u.length > DATA_URL_MAX) fail('that picture is over 8 MB as a data: address');
      return u;
    });
    return harden(ops);
  };
  // (a list of numbers, as a plain array or a typed array, copied: for dashes and pixels)
  const numsCopy = (a, what, max) => {
    let len = -1;
    try { len = TA_LENGTH.call(a); } catch { len = -1; }
    if (len >= 0) { if (len > max) fail(`${what}: too many`); return new Float64Array(a); }
    if (!Array.isArray(a) || a.length > max) fail(`${what} is a list of numbers`);
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) { const d = Object.getOwnPropertyDescriptor(a, i); if (!d || typeof d.value !== 'number') fail(`${what} is a list of numbers`); out[i] = d.value; }
    return out;
  };
  // Web Animations (el.animate): keyframes and timing through the same checks as style(), and no url() at all;
  // the page's own animations readable as numbers, and changed only by the mod that made them
  const animOwner = new WeakMap(); // Animation -> the mod that made it
  const KEYFRAME_PROP = /^(-{0,2}[a-z][a-z0-9-]*|[a-z][a-zA-Z0-9]*)$/;
  const cssValue = (v, what) => { const t = typeof v === 'number' ? String(v) : str(v, what, 2000); if (!cssOk(t) || /url\s*\(/i.test(t)) fail(`${what} loads nothing (no url())`); return t; };
  const keyframesOf = (kf) => {
    if (!Array.isArray(kf) || kf.length > 100) fail('keyframes are a list (up to 100) of { property: value }');
    return kf.map((f) => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) fail('a keyframe is { property: value }');
      const o = {};
      for (const k of Object.keys(f)) {
        const v = f[k];
        if (k === 'offset') { if (v !== null && typeof v !== 'number') fail('offset is a number'); o.offset = v; }
        else if (k === 'easing') o.easing = cssValue(v, 'an easing');
        else if (k === 'composite') { if (!/^(replace|add|accumulate|auto)$/.test(String(v))) fail('composite is replace, add or accumulate'); o.composite = String(v); }
        else { if (!KEYFRAME_PROP.test(k)) fail(`"${k}" isn't a style property`); if (typeof v !== 'string' && typeof v !== 'number') fail(`${k} takes text or a number`); o[k] = cssValue(v, `${k}'s value`); }
      }
      return o;
    });
  };
  const timingOf = (t) => {
    if (typeof t === 'number') { if (!Number.isFinite(t) || t < 0) fail('a duration is a number of milliseconds'); return t; }
    if (t === undefined) return {};
    if (!t || typeof t !== 'object') fail('animate\'s timing is a duration, or { duration, delay, iterations, easing, … }');
    const o = {};
    for (const k of Object.keys(t)) {
      const v = t[k];
      if (/^(duration|delay|endDelay|iterationStart)$/.test(k)) { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${k} is a number`); o[k] = v; }
      else if (k === 'iterations') { if (typeof v !== 'number' || !(v >= 0)) fail('iterations is a number (or Infinity)'); o[k] = v; }
      else if (k === 'direction') { if (!/^(normal|reverse|alternate|alternate-reverse)$/.test(String(v))) fail('direction is normal, reverse, alternate or alternate-reverse'); o[k] = String(v); }
      else if (k === 'fill') { if (!/^(none|forwards|backwards|both|auto)$/.test(String(v))) fail('fill is none, forwards, backwards, both or auto'); o[k] = String(v); }
      else if (k === 'easing') o[k] = cssValue(v, 'an easing');
      else if (k === 'composite') { if (!/^(replace|add|accumulate)$/.test(String(v))) fail('composite is replace, add or accumulate'); o[k] = String(v); }
      else fail(`${k} isn't one of animate's options`);
    }
    return o;
  };
  const timeOf = (t) => (typeof t === 'number' ? t : t && typeof t.value === 'number' ? t.value : null);
  const animFacade = (a) => {
    const mine = () => { if (animOwner.get(a) !== cur().mod) fail('only the mod\'s own animations can be changed (the page may use one of its own as a timer)'); };
    const act = (k) => guardShared(() => { mine(); a[k](); });
    return harden({
      get currentTime() { return timeOf(a.currentTime); },
      get startTime() { return timeOf(a.startTime); },
      get playState() { return String(a.playState); },
      get playbackRate() { return a.playbackRate; },
      get mine() { return animOwner.get(a) === cur().mod; },
      get finished() { return a.finished.then(() => true, () => false); },
      play: act('play'), pause: act('pause'), cancel: act('cancel'), finish: act('finish'), reverse: act('reverse'),
      setCurrentTime: guardShared((t) => { mine(); if (typeof t !== 'number' || !Number.isFinite(t)) fail('a time is a number of milliseconds'); a.currentTime = t; }),
      setPlaybackRate: guardShared((r) => { mine(); if (typeof r !== 'number' || !Number.isFinite(r)) fail('a rate is a number'); a.playbackRate = r; }),
    });
  };
  // Pointer capture, on the mod's own elements: never while the pointer went down on TRIF's search box
  let downOnBox = false;
  G.addEventListener('pointerdown', (e) => { const p = typeof e.composedPath === 'function' ? e.composedPath() : []; downOnBox = trifBoxes.has(e.target) || (!!p[0] && trifBoxes.has(p[0])); }, true);
  // Focus: the mod's own elements and TRIF's search box; never while the user is in one of the page's fields
  // (or what may hold one), only while the page shows, and at most 10 times in 10 seconds
  const boxInputs = new WeakMap(); // (a search box's host -> its input)
  const focusTimes = new WeakMap(); // (api -> times)
  const userIsTyping = () => {
    const a = D.activeElement;
    if (!a || a === D.body || a === D.documentElement || created.has(a) || trifBoxes.has(a)) return false;
    return isField(a) || a.localName.includes('-') || hasRoot(a) !== false;
  };
  const SVG_TAG_CASE = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath' };
  const SVG_CASE = { viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', clippathunits: 'clipPathUnits', spreadmethod: 'spreadMethod', pathlength: 'pathLength' };
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const svgOnly = (n, what) => { if (n.namespaceURI !== SVG_NS || typeof n[what] !== 'function') fail(`${what} is for SVG shapes`); if (insideEditor(n) && !cur().powers.has('read-drafts')) fail(`${what} isn't offered inside an editor (what the user is typing)`); return n; };
  const pointOf = (x, y) => { if (typeof x !== 'number' || typeof y !== 'number') fail('a point is two numbers'); return typeof DOMPoint === 'function' ? new DOMPoint(x, y) : { x, y }; };
  let copyN = 0;
  const classesOf = new WeakMap();
  const protoDef = {
    get tag() { return nodeOf(this).localName; },
    get text() { const n = nodeOf(this); return cur().powers.has('read-drafts') ? n.textContent : visibleText(n); },
    // (the text as shown, as innerText: an editor's reads as empty without read-drafts, as for .text)
    get innerText() {
      const n = nodeOf(this);
      if (cur().powers.has('read-drafts')) return String(n.innerText ?? n.textContent);
      if (inEditor(n)) return '';
      if (D.designMode === 'on' || n.querySelector('[contenteditable]')) return visibleText(n);
      return String(n.innerText ?? n.textContent);
    },
    // layout, read only (scrolling the page's elements would make it load what's lazy)
    get offsetWidth() { return nodeOf(this).offsetWidth ?? 0; },
    get offsetHeight() { return nodeOf(this).offsetHeight ?? 0; },
    get offsetTop() { return nodeOf(this).offsetTop ?? 0; },
    get offsetLeft() { return nodeOf(this).offsetLeft ?? 0; },
    get clientWidth() { return nodeOf(this).clientWidth; },
    get clientHeight() { return nodeOf(this).clientHeight; },
    get scrollWidth() { return nodeOf(this).scrollWidth; },
    get scrollHeight() { return nodeOf(this).scrollHeight; },
    get scrollTop() { return nodeOf(this).scrollTop; },
    get scrollLeft() { return nodeOf(this).scrollLeft; },
    // SVG geometry, read only: numbers
    bbox() { const b = svgOnly(nodeOf(this), 'getBBox').getBBox(); return harden({ x: b.x, y: b.y, width: b.width, height: b.height }); },
    totalLength() { return svgOnly(nodeOf(this), 'getTotalLength').getTotalLength(); },
    pointAtLength(l) { if (typeof l !== 'number') fail('a length is a number'); const p = svgOnly(nodeOf(this), 'getPointAtLength').getPointAtLength(l); return harden({ x: p.x, y: p.y }); },
    isPointInFill(x, y) { return svgOnly(nodeOf(this), 'isPointInFill').isPointInFill(pointOf(x, y)); },
    isPointInStroke(x, y) { return svgOnly(nodeOf(this), 'isPointInStroke').isPointInStroke(pointOf(x, y)); },
    setText(t) {
      const n = nodeOf(this);
      if (isRaw(n)) fail(`text can't be written into <${n.localName}>`);
      notInEditor(n, 'writing text');
      detachOk(n, true);
      str(t, 'text');
      if (inEditor(n)) editorWrite(n, (rg) => rg.setEnd(n, 0), n.textContent.length, t);
      n.textContent = t;
      wrote(n);
    },
    // (a field's value attribute: null, as React keeps it in step with what's typed: audit AU-2; read-drafts
    // reads fields through .value, and attributes inside editors)
    attr(name) { const n = nodeOf(this); str(name, 'an attribute name', 100); return (insideEditor(n) && !cur().powers.has('read-drafts')) || (/^value$/i.test(name) && /^(input|textarea|select|option)$/.test(n.localName)) ? null : n.getAttribute(name); },
    // A field's value: the mod's own controls (`controls`), or what the user typed in the page's fields and
    // editors (`read-drafts`; never a password or card field, nor a hidden one: that's the site's, not typed)
    get value() {
      const n = nodeOf(this);
      if (created.has(n) && /^(input|select|option)$/.test(n.localName)) return String(n.value);
      if (!isField(n)) fail(`<${n.localName}> has no value`);
      if (!cur().powers.has('read-drafts')) fail('reading what\'s typed in the page needs the read-drafts power (// @powers read-drafts)');
      if (secretField(n)) fail('password and card fields stay hidden, whatever the mod\'s powers');
      if (n.localName === 'input' && /^(hidden|file|submit|button|reset|image)$/i.test(String(n.type))) fail(`a ${n.type} input isn't something the user typed`);
      return n.isContentEditable ? n.textContent : String(n.value);
    },
    setValue(v) {
      const n = nodeOf(this);
      const val = str(String(v), 'a value', 100000);
      if (created.has(n) && /^(input|select)$/.test(n.localName)) { n.value = val; return; }
      // write-drafts: what the user typed in the page's text fields and editors, changed before they post it;
      // never a password or card field, nor one the user doesn't type in
      if (!isField(n)) fail(`<${n.localName}> has no value`);
      notLeaving();
      if (!draftsOk(cur())) fail('changing what the user typed needs the write-drafts power (// @powers write-drafts)');
      if (secretField(n)) fail('password and card fields stay the user\'s, whatever the mod\'s powers');
      if (n.localName === 'select' || (n.localName === 'input' && !/^(text|search|email|url|tel|)$/i.test(String(n.type)))) fail(`a ${n.localName === 'select' ? 'select' : `${n.type} input`} isn't a text the user types`);
      if (n.isContentEditable) editorWrite(n, (rg) => rg.setEnd(n, 0), n.textContent.length, val);
      else noNewAddress(n.value, val);
      draftWriters.add(cur().mod);
      if (n.isContentEditable) { n.textContent = val; } else {
        // (through the element's own value setter, and an input event, so the page's code sees the change)
        const proto = n.localName === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, val);
      }
      n.dispatchEvent(new Event('input', { bubbles: true }));
    },
    // page-data: the page's own data behind this element (React props and fiber), by a path, as a plain copy
    pageData(path) {
      const n = nodeOf(this);
      if (!cur().powers.has('page-data')) fail('the page\'s data needs the page-data power (// @powers page-data)');
      const pth = str(path === undefined ? '' : path, 'a path', 500);
      if (!/^[\w$.]*$/.test(pth)) fail('a path is names with dots between them (props.post.text)');
      pageDataAnswer = null;
      n.dispatchEvent(new CustomEvent('trif:page-data', { detail: pth }));
      const a = pageDataAnswer;
      pageDataAnswer = null;
      if (a === null) return null;
      try { return JSON.parse(a); } catch { return null; }
    },
    get checked() { const n = nodeOf(this); return n.localName === 'input' ? !!n.checked : false; },
    setChecked(on) { const n = nodeOf(this); if (!created.has(n) || n.localName !== 'input') fail('setChecked is for the mod\'s own checkboxes'); n.checked = !!on; },
    setAttr(name, value) {
      const node = nodeOf(this);
      const n = str(name, 'an attribute name', 100).toLowerCase(), v = str(String(value), 'a value', 200000);
      notInEditor(node, 'changing attributes');
      // (the mod's own controls: their few attributes; autocomplete and name never)
      if (created.has(node) && CONTROL_TAGS.has(node.localName) && controlAttrOk(node, n, v)) { node.setAttribute(n, v); return; }
      // (its own elements dragged: drag and drop between them)
      if (n === 'draggable' && created.has(node)) { if (!/^(true|false|auto)$/.test(v)) fail('draggable is true, false or auto'); node.setAttribute('draggable', v); return; }
      // (a page field's placeholder: shown, never sent with the form)
      if (n === 'placeholder' && node.namespaceURI === HTML_NS && /^(input|textarea)$/.test(node.localName)) { node.setAttribute('placeholder', str(v, 'a placeholder', 1000)); return; }
      // (the mod's own SVG: its shapes' attributes, with references only to its own ids)
      if (node.namespaceURI === SVG_NS && created.has(node) && (SVG_ATTRS.test(n) || n === 'href' || n === 'xlink:href')) {
        if (!svgValueOk(n, v)) fail(`that ${n} names an address, code, or an id that isn't the mod's own (url(#trif-box-…) and href="#trif-box-…" only)`);
        if (n === 'xlink:href') node.setAttributeNS(XLINK_NS, 'xlink:href', v); else node.setAttribute(SVG_CASE[n] || n, v);
        return;
      }
      if (!nameOk(n)) fail(nameRefused(n));
      if (ATTR_TAGS[n] && (!ATTR_TAGS[n].has(node.localName) || node.namespaceURI !== HTML_NS)) fail(`${n} isn't offered on <${node.localName}>`);
      if (n === 'id' || n === 'class') {
        if (!ownTokens(v) || (n === 'id' && /\s/.test(v.trim()))) fail(`${n === 'id' ? 'an id' : 'classes'} must start with trif-box- (the page's own code, or a free mod, finds elements by ${n})`);
        // (the page's own id or classes stay theirs: a mod adds its classes with classes.add)
        if (!created.has(node) && node.hasAttribute(n) && !ownTokens(node.getAttribute(n))) fail(`the page's own ${n} isn't a mod's to replace${n === 'class' ? ' (classes.add adds a trif-box- class)' : ''}`);
      }
      // (site-data, B6: also a link the page shows with whole query parameters taken out)
      const fewer = () => { try { return lessParams(new URL(v, location.href).href, [...D.links].filter((a) => !created.has(a)).map((a) => a.href)); } catch { return false; } };
      if ((n === 'href' || n === 'src') && !urlOk(v, n) && !(n === 'href' && node.localName === 'a' && cur().powers.has('site-data') && fewer())) fail(n === 'src' ? 'src only takes data:/blob: images, or the address of an image the page already shows' : 'href only takes #somewhere, or an address a link on the page already has');
      node.setAttribute(n, v);
    },
    removeAttr(name) {
      const n = str(name, 'an attribute name', 100).toLowerCase();
      const node = nodeOf(this);
      notInEditor(node, 'changing attributes');
      if (!nameOk(n)) fail(nameRefused(n));
      if ((n === 'id' || n === 'class') && !created.has(node) && node.hasAttribute(n) && !ownTokens(node.getAttribute(n))) fail(`the page's own ${n} isn't a mod's to remove`);
      // (as for setting: an attribute only where it's offered, so not a form field's value)
      if (ATTR_TAGS[n] && (!ATTR_TAGS[n].has(node.localName) || node.namespaceURI !== HTML_NS)) fail(`${n} isn't offered on <${node.localName}>`);
      node.removeAttribute(n);
    },
    get classes() {
      const node = nodeOf(this);
      let c = classesOf.get(node);
      if (!c) {
        // (a mod adds, removes and toggles only its own trif-box- classes; it can read any)
        const cls = (x) => { str(x, 'a class', 200); notInEditor(node, 'changing classes'); if (!OWN_NAME.test(x)) fail(`classes a boxed mod sets must start with trif-box- (the page's own code, or a free mod, acts on classes like "${x.slice(0, 60)}")`); return x; };
        c = harden({
          add: guardShared((...x) => node.classList.add(...x.map(cls))),
          remove: guardShared((...x) => node.classList.remove(...x.map(cls))),
          toggle: guardShared((x, on) => node.classList.toggle(cls(x), on === undefined ? undefined : !!on)),
          has: guardShared((x) => node.classList.contains(str(x, 'a class', 200))),
        });
        classesOf.set(node, c);
      }
      return c;
    },
    style(prop, value) {
      const node = nodeOf(this);
      const p = str(prop, 'a style property', 100);
      if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(p)) fail(`"${p}" isn't a style property`);
      if (value === undefined) return getComputedStyle(node).getPropertyValue(p);
      if (value !== null && typeof value === 'object') fail('a style value is text or a number');
      if (value === null || value === '') { node.style.removeProperty(p); return ''; }
      const v = str(String(value), 'a style value', 10000);
      if (!cssOk(v)) fail('that style value loads from an address (only data: is allowed)');
      node.style.setProperty(p, v, 'important');
      return v;
    },
    // the element's own inline style, as its style attribute says it (attr('style') shows the same)
    inlineStyle(prop) { const p = str(prop, 'a style property', 100); if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(p)) fail(`"${p}" isn't a style property`); const st = nodeOf(this).style; return st ? st.getPropertyValue(p) : ''; },
    animate(keyframes, timing) {
      const n = nodeOf(this);
      if (typeof n.animate !== 'function') fail('this element can\'t be animated');
      const a = n.animate(keyframesOf(keyframes), timingOf(timing));
      animOwner.set(a, cur().mod);
      return animFacade(a);
    },
    animations() { const n = nodeOf(this); return harden((typeof n.getAnimations === 'function' ? n.getAnimations() : []).slice(0, 100).map(animFacade)); },
    // sizes and visibility, the mod's own observers: numbers
    onResize(fn) {
      const n = nodeOf(this);
      if (typeof fn !== 'function') fail('onResize takes a function');
      const api = cur();
      const ro = new ResizeObserver((entries) => {
        for (const en of entries) {
          const b = en.borderBoxSize && en.borderBoxSize[0];
          api.call(fn, harden({ width: en.contentRect.width, height: en.contentRect.height, ...(b ? { borderWidth: b.inlineSize, borderHeight: b.blockSize } : {}) }));
        }
      });
      ro.observe(n);
      return harden(() => ro.disconnect());
    },
    onVisible(fn, opts) {
      const n = nodeOf(this);
      if (typeof fn !== 'function') fail('onVisible takes a function');
      const o = {};
      if (opts !== undefined) {
        if (!opts || typeof opts !== 'object') fail('onVisible\'s options are { threshold, rootMargin }');
        if (opts.threshold !== undefined) { const th = Array.isArray(opts.threshold) ? opts.threshold : [opts.threshold]; if (th.length > 20 || th.some((x) => typeof x !== 'number' || !(x >= 0 && x <= 1))) fail('a threshold is a number from 0 to 1 (or a list of them)'); o.threshold = [...th]; }
        if (opts.rootMargin !== undefined) { const m = str(opts.rootMargin, 'a margin', 100); if (!/^\s*(-?\d+(\.\d+)?(px|%)?\s*){1,4}$/.test(m)) fail('a margin is like "100px 0px"'); o.rootMargin = m.trim(); }
      }
      const api = cur();
      const io = new IntersectionObserver((entries) => {
        for (const en of entries) { const r = en.boundingClientRect; api.call(fn, harden({ visible: !!en.isIntersecting, ratio: en.intersectionRatio, x: r.x, y: r.y, width: r.width, height: r.height })); }
      }, o);
      io.observe(n);
      return harden(() => io.disconnect());
    },
    capturePointer(id) {
      const n = nodeOf(this);
      if (!created.has(n)) fail('pointer capture is for the mod\'s own elements (on the page\'s, it would take their clicks)');
      if (downOnBox) fail('not while the pointer is on TRIF\'s search box');
      if (typeof id !== 'number') fail('capturePointer takes the event\'s pointerId');
      n.setPointerCapture(id);
    },
    releasePointer(id) { const n = nodeOf(this); if (!created.has(n)) fail('pointer capture is for the mod\'s own elements'); if (typeof id !== 'number') fail('releasePointer takes the event\'s pointerId'); n.releasePointerCapture(id); },
    focus() {
      const n = nodeOf(this);
      notLeaving();
      if (!created.has(n) && !trifBoxes.has(n)) fail('focus is for the mod\'s own elements and TRIF\'s search box (never the page\'s: the user\'s next keys would go there)');
      if (D.visibilityState !== 'visible') fail('focus only while the page is showing');
      if (userIsTyping()) fail('the user is in one of the page\'s fields: the focus stays there');
      const api = cur();
      const ts = focusTimes.get(api) || [];
      const t = Date.now();
      while (ts.length && t - ts[0] > 10000) ts.shift();
      if (ts.length >= 10) fail('focus at most 10 times in 10 seconds');
      ts.push(t); focusTimes.set(api, ts);
      (boxInputs.get(n) || n).focus({ preventScroll: true });
    },
    blur() {
      const n = nodeOf(this);
      if (!created.has(n) && !trifBoxes.has(n)) fail('blur is for the mod\'s own elements and TRIF\'s search box');
      const inner = boxInputs.get(n);
      const a = D.activeElement;
      if (inner) inner.blur(); else if (a && (a === n || n.contains(a))) a.blur();
    },
    // preload: the page's own lazy picture, loaded now (as it would be when scrolled to); nothing else changes
    loadSooner() {
      const n = nodeOf(this);
      const api = cur();
      if (!api.powers.has('preload')) fail('loading the page\'s pictures sooner needs the preload power (// @powers preload)');
      if (n.localName !== 'img' || n.namespaceURI !== HTML_NS || created.has(n)) fail('loadSooner is for the page\'s own pictures (<img>)');
      partnersOk(api, 'preload');
      // (by the page's side, under the page's own rules for pictures: runtime.js pageBridge)
      if (String(n.getAttribute('loading') || '').toLowerCase() === 'lazy') n.dispatchEvent(new CustomEvent('trif:load-sooner'));
    },
    hide() { nodeOf(this).style.setProperty('display', 'none', 'important'); },
    show() { nodeOf(this).style.removeProperty('display'); },
    find(sel) { return wrap(qs(nodeOf(this), str(sel, 'a selector', 2000))); },
    findAll(sel) { return list(qsa(nodeOf(this), str(sel, 'a selector', 2000))); },
    closest(sel) { const n = nodeOf(this); selCheck(sel); try { return wrap(n.closest(sel)); } catch { return fail(`"${sel.slice(0, 80)}" isn't a valid selector`); } },
    matches(sel) { const n = nodeOf(this); selCheck(sel); try { return n.matches(sel); } catch { return fail(`"${sel.slice(0, 80)}" isn't a valid selector`); } },
    get parent() { return wrap(nodeOf(this).parentElement); },
    get children() { return list(nodeOf(this).children); },
    get next() { return wrap(nodeOf(this).nextElementSibling); },
    get previous() { return wrap(nodeOf(this).previousElementSibling); },
    get created() { return created.has(nodeOf(this)); },
    append(...kids) { const n = nodeOf(this); notInEditor(n, 'adding'); const k = kids.map(kidOf); textInto(n, k); if (inEditor(n)) editorWrite(n, (rg) => rg.setEnd(n, n.childNodes.length), 0, k.map((x) => x.textContent).join('')); n.append(...k); wrote(n); },
    prepend(...kids) { const n = nodeOf(this); notInEditor(n, 'adding'); const k = kids.map(kidOf); textInto(n, k); if (inEditor(n)) editorWrite(n, (rg) => rg.setEnd(n, 0), 0, k.map((x) => x.textContent).join('')); n.prepend(...k); wrote(n); },
    before(...kids) { const n = nodeOf(this); notInEditor(n.parentElement, 'adding'); const k = kids.map(kidOf); if (n.parentNode) textInto(n.parentNode, k); if (inEditor(n.parentElement)) editorWrite(n.parentElement, (rg) => rg.setEndBefore(n), 0, k.map((x) => x.textContent).join('')); n.before(...k); wrote(n.parentElement); },
    after(...kids) { const n = nodeOf(this); notInEditor(n.parentElement, 'adding'); const k = kids.map(kidOf); if (n.parentNode) textInto(n.parentNode, k); if (inEditor(n.parentElement)) editorWrite(n.parentElement, (rg) => rg.setEndAfter(n), 0, k.map((x) => x.textContent).join('')); n.after(...k); wrote(n.parentElement); },
    remove() { const n = nodeOf(this); notInEditor(n, 'removing'); detachOk(n, false); if (inEditor(n.parentElement)) editorWrite(n.parentElement, (rg) => rg.setEndBefore(n), n.textContent.length, ''); n.remove(); wrote(n.parentElement || n); },
    // a copy of this element and what's inside it, keeping only allowed elements and attributes (an element
    // of another kind is left out, with what's inside it; other attributes are dropped)
    clone() {
      const from = nodeOf(this);
      // (an SVG copy keeps its ids, renamed trif-box-…, and the references inside it to them)
      let ids = null;
      if (from.namespaceURI === SVG_NS && !insideEditor(from)) {
        ids = new Map();
        const pre = `trif-box-c${++copyN}-`;
        for (const el of [from, ...from.querySelectorAll('[id]')]) if (el.id && !ids.has(el.id)) ids.set(el.id, pre + el.id.replace(/[^A-Za-z0-9_-]/g, '_'));
      }
      return wrap(safeCopy(from, ids));
    },
    rect() { const r = nodeOf(this).getBoundingClientRect(); return harden({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom }); },
    on(type, fn, opts) { const n = nodeOf(this); return cur().listen(n, type, fn, opts); },
    // (only the mod's own: a page's canvas may be a signature pad or a drawing the page uploads: audit AU-6)
    // media: the page's own audio and video
    play() { const n = mediaOf(this); const p = n.play(); return p && typeof p.then === 'function' ? p.then(() => true, () => false) : true; },
    pause() { mediaOf(this).pause(); },
    setMuted(on) { mediaOf(this).muted = !!on; },
    setVolume(v) { if (typeof v !== 'number' || !(v >= 0 && v <= 1)) fail('a volume is from 0 to 1'); mediaOf(this).volume = v; },
    seek(t) { if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) fail('seek takes a time in seconds'); mediaOf(this).currentTime = t; },
    get media() { const n = nodeOf(this); return /^(video|audio)$/.test(n.localName) && cur().powers.has('media') ? harden({ paused: n.paused, muted: n.muted, volume: n.volume, currentTime: n.currentTime, duration: Number.isFinite(n.duration) ? n.duration : null }) : null; },
    // click: only what the header names, never something that submits or a link to another site
    click() {
      const n = nodeOf(this);
      const api = cur();
      notLeaving();
      if (!api.powers.has('click')) fail('clicking for the user needs the click power, with what it may click named in the header (// @click words: selector)');
      const named = (api.args.click || []).map((c) => String(c).replace(/^[^:]*:\s*/, '')).filter(Boolean);
      let ok = false;
      for (const sel of named) { try { if (n.matches(sel)) { ok = true; break; } } catch { /* not a selector */ } }
      if (!ok) fail('that isn\'t one of the things the header says this mod may click');
      clickOk(api);
      if (submits(n)) fail('a click that would submit or reset a form isn\'t offered, whatever the header says');
      const a = n.closest('a[href], area[href]');
      if (a) { let u = null; try { u = new URL(a.href); } catch { /* none */ } if (!u || u.origin !== ORIGIN) fail('a click on a link to another site isn\'t offered'); }
      n.click();
    },
    canvas() { const n = nodeOf(this); if (n.localName !== 'canvas') fail('canvas() is for <canvas> elements'); if (!created.has(n)) fail('canvas() is for canvases the mod made'); return ctxOf(n); },
  };
  const protoOut = {};
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(protoDef))) {
    Object.defineProperty(protoOut, k, d.get ? { get: guardShared(d.get), enumerable: true } : { value: guardShared(d.value), enumerable: true });
  }
  PROTO = harden(protoOut);

  // ---- running a mod
  const SANDBOX_GLOBALS_PAGE = ['page', 'trif', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const run = (modId, source, powers) => {
    const id = String(modId);
    const api = apiFor(id, powers);
    const prev = current, t = now();
    current = api;
    try {
      if (SANDBOX) {
        const c = new G.Compartment({ __options__: true, globals: { ...EXTRA, ...api.endowments, Math, Date } });
        // (no code from strings inside the compartment either, and none of SES's own tools)
        for (const n of ['eval', 'Function', 'Compartment', 'lockdown', 'harden', 'assert']) {
          // (set to undefined, not deleted: SES's evaluator needs the property there)
          try { Object.defineProperty(c.globalThis, n, { value: undefined, writable: false, enumerable: false, configurable: false }); } catch { /* not there */ }
        }
        // (an async function: a top-level return ends the mod, and await works at the top; what it throws
        // after an await is caught too)
        // (the mod's first line on the first line, so `trif errors` gives the file's own line numbers)
        const p = c.evaluate(`(async function () { "use strict"; ${source}\n})();\n//# sourceURL=trif-sandbox://${id}.js`);
        if (p && typeof p.catch === 'function') p.catch((err) => report(id, err));
      } else {
        const e = api.endowments;
        const p = source.call(undefined, ...SANDBOX_GLOBALS_PAGE.map((n) => e[n]));
        if (p && typeof p.catch === 'function') p.catch((err) => report(id, err));
      }
    } catch (err) {
      report(id, err);
    } finally {
      current = prev;
      stats.mods[id] = { at: t, runMs: now() - t };
    }
  };
  if (!SANDBOX) { run(pageModId, pageFn, pagePowers); return; }
  // (a promise a mod left rejected: reported as that mod's, by the stack)
  try {
    G.addEventListener('unhandledrejection', (ev) => {
      const r = ev.reason;
      let st = '';
      try { st = r && typeof r === 'object' ? String(stackOf(r) || '') : ''; } catch { /* none */ }
      const m = /trif-sandbox:\/\/([^\s/]+\/[^\s/:)]+?)\.js/.exec(st);
      if (m) report(m[1], r);
    });
  } catch { /* none */ }
  Object.defineProperty(G, '__trifSandbox', { value: Object.freeze({ run, errors: store.errors, logs: store.logs, watched: store.watched, stats }), configurable: false, writable: false });
  // (mods that came before the runtime)
  const queued = G.__trifSandboxQueue;
  if (Array.isArray(queued)) { G.__trifSandboxQueue = null; for (const [id, source, powers] of queued) run(id, source, powers); }
}

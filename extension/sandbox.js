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
// The most a mod's settings may take on one site, as JSON (background.js keeps them).
export const SETTINGS_MAX = 64 * 1024;

const J = (v) => JSON.stringify(String(v));

/** The world's runtime: lockdown once, then __trifSandbox.run(id, source) per mod. */
export function sandboxRuntimeCode() {
  return `(${sandboxRuntime.toString()})('sandbox');\n//# sourceURL=trif-sandbox://runtime.js`;
}

/**
 * One sandboxed mod, in TRIF's world: its source, handed to the runtime as text (SES evaluates it), with its
 * powers (docs/POWERS.md), which come from its header as the helper read it, not from its code.
 */
export function sandboxModCode(id, source, powers = []) {
  const P = JSON.stringify((Array.isArray(powers) ? powers : []).map(String));
  return `(globalThis.__trifSandbox ? globalThis.__trifSandbox.run(${J(id)}, ${J(source)}, ${P}) : (globalThis.__trifSandboxQueue = globalThis.__trifSandboxQueue || []).push([${J(id)}, ${J(source)}, ${P}]));\n//# sourceURL=trif-sandbox://${id}.js`;
}

/**
 * A sandboxed mod run as a page script (a browser without TRIF's world, once the user allowed it): the
 * same API, built in the page's world, around the mod's code, which has everything the page has.
 */
export function sandboxPageCode(id, source, powers = []) {
  // (the mod's first line is the script's first line, so `trif errors` gives its own line numbers)
  const P = JSON.stringify((Array.isArray(powers) ? powers : []).map(String));
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
    'br', 'hr', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption', 'canvas', 'details', 'summary', 'progress']);
  const ATTRS = new Set(['id', 'class', 'title', 'role', 'hidden', 'alt', 'width', 'height', 'lang', 'dir', 'tabindex', 'colspan', 'rowspan', 'open', 'value', 'max', 'href', 'src']);
  // The page's own code reads attributes as instructions: htmx's data-hx-post, Turbo's data-turbo-method,
  // Stimulus's data-controller, classes a selector-observer acts on, ids it finds elements (or window globals)
  // by. So the names a mod gives are TRIF's: data attributes only data-trif-*, and ids and classes only
  // trif-* (aria-* stay: they describe, they don't instruct). (`name` isn't offered at all.)
  const DATA_OK = /^data-trif-[a-z0-9-]+$/;
  const ARIA_OK = /^aria-[a-z]+$/;
  const OWN_NAME = /^trif-[A-Za-z0-9_-]*$/;
  const nameOk = (n) => ATTRS.has(n) || DATA_OK.test(n) || ARIA_OK.test(n);
  const nameRefused = (n) => (/^data-/.test(n) ? `only data-trif-* data attributes are offered (the page's own code could act on ${n})` : `the ${n} attribute isn't offered`);
  const ownTokens = (v) => String(v).trim().split(/\s+/).filter(Boolean).every((t) => OWN_NAME.test(t));
  // (an address only where it can't run or send anything by itself: a link's href, an image's src; `value`
  // only on a progress bar or list item, never on a form field, whose value the site would receive)
  const ATTR_TAGS = { href: new Set(['a']), src: new Set(['img']), value: new Set(['progress', 'li']), max: new Set(['progress']) };
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc']);
  const SVG_ATTRS = /^(viewbox|d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|points|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|opacity|fill-opacity|stroke-opacity|fill-rule|clip-rule|transform|offset|stop-color|stop-opacity|gradientunits|gradienttransform|xmlns|preserveaspectratio|focusable|font-size|font-family|text-anchor|dominant-baseline|width|height)$/;
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
    if (t === 'label' && n === 'for') { if (!OWN_NAME.test(v)) fail('a label is for one of the mod\'s own controls (a trif- id)'); return true; }
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
  const urlOk = (v, attr) => {
    const s = String(v).trim();
    if (attr === 'src') {
      if (/^(data:image\/|blob:)/i.test(s)) return true;
      try { return shownImage(new URL(s, location.href).href); } catch { return false; }
    }
    if (/^#/.test(s)) return true;
    try { const u = new URL(s, location.href); return u.origin === ORIGIN && /^https?:$/.test(u.protocol) && !u.search; } catch { return false; }
  };
  // CSS that loads nothing (as rules mods: helper/lib/rules.js checkCss): url() only data:, no @import,
  // image-set() and the like, no escapes outside strings.
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
    while ((m = re.exec(css))) { if (!/^\s*["']?\s*data:/i.test(css.slice(m.index + m[0].length))) return false; }
    return true;
  };
  // A selector, for a rule TRIF writes: one that parses and can't close the rule it's put in.
  const selectorOk = (sel) => {
    str(sel, 'a selector', 2000);
    if (/[{}<;@\\]|\/\*/.test(sel)) fail(`"${sel.slice(0, 80)}" isn't a selector TRIF writes into a style sheet`);
    try { D.createDocumentFragment().querySelector(sel); } catch { fail(`"${sel.slice(0, 80)}" isn't a valid selector`); }
    return sel;
  };
  const qs = (root, sel) => { try { return root.querySelector(sel); } catch { fail(`"${String(sel).slice(0, 80)}" isn't a valid selector`); } };
  const qsa = (root, sel) => { try { return root.querySelectorAll(sel); } catch { fail(`"${String(sel).slice(0, 80)}" isn't a valid selector`); } };
  const LISTEN = /^(click|dblclick|contextmenu|mouse(down|up|move|over|out|enter|leave)|pointer(down|up|move|over|out|enter|leave|cancel)|touch(start|move|end|cancel)|key(down|up)|wheel|scroll|resize|input|change|focus|blur|focusin|focusout|visibilitychange|transitionend|animationend)$/;
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
  const formsOk = (parent, kids) => {
    const dest = parent && parent.nodeType === 1 ? parent.closest('form') : null;
    for (const k of kids) {
      if (typeof k === 'string' || k.nodeType !== 1) continue;
      for (const f of [...(k.matches(FORM_FIELDS) ? [k] : []), ...k.querySelectorAll(FORM_FIELDS)]) {
        if (created.has(f)) { if (dest) fail(`a ${f.localName === 'button' ? 'button' : 'control'} a mod makes can't go inside a form`); continue; }
        if (f.hasAttribute('form')) continue; // (it names its form: where it is doesn't change that)
        if ((f.form || null) !== dest) fail(`the page's own <${f.localName}> can't be moved into, out of or between forms`);
      }
    }
  };
  // What's typed into an editor (contenteditable, or a page in design mode) is the user's: a mod reads none
  // of it (.text, trif.text, clone()), sees no attribute inside it, and can't move its pieces out to read them.
  const inEditor = (n) => !!n && n.nodeType === 1 && !!n.isContentEditable;
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
  const fieldsOwned = (n) => [...(n.matches(FORM_FIELDS) ? [n] : []), ...n.querySelectorAll(FORM_FIELDS)].filter((f) => !created.has(f) && f.form);
  const detachOk = (n, keepsItself) => {
    for (const f of fieldsOwned(n)) {
      if (!keepsItself && n.contains(f.form)) continue; // (its form goes with it: nothing else submits differently)
      fail(`the page's own <${f.localName}> can't be taken out of its form`);
    }
  };
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
  const safeCopy = (from) => {
    const tag = from.localName.toLowerCase();
    const svg = from.namespaceURI === SVG_NS;
    if (svg ? !SVG_TAGS.has(tag) : from.namespaceURI !== HTML_NS || !TAGS.has(tag)) return null;
    const to = svg ? D.createElementNS(SVG_NS, from.localName) : D.createElement(tag);
    if (tag === 'button' && !svg) to.setAttribute('type', 'button');
    for (const a of from.attributes) {
      const n = a.name.toLowerCase();
      if (/^on/.test(n) || n === 'style') continue;
      if (svg) { if (!SVG_COPY_ATTR(n) || (/url\s*\(/i.test(a.value) && !/^\s*url\(\s*["']?#/.test(a.value))) continue; }
      else if (!nameOk(n) || (ATTR_TAGS[n] && !ATTR_TAGS[n].has(tag)) || ((n === 'href' || n === 'src') && !urlOk(a.value, n))) continue;
      if ((n === 'id' || n === 'class') && !ownTokens(a.value)) continue;
      if (n === 'type') continue;
      to.setAttribute(a.name, a.value);
    }
    for (const c of from.childNodes) {
      if (c.nodeType === 3) { if (!inEditor(from)) to.append(c.data); }
      else if (c.nodeType === 1) { const k = safeCopy(c); if (k) to.append(k); }
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
  const keyHidden = (e, powers) => {
    const p = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const t = p[0] || e.target;
    if (secretField(t)) return true;
    if (powers && powers.has('read-drafts') && (isField(t) || (p.length && p[0] !== e.target && isField(p[0])))) return false;
    if (isField(t)) return true;
    if (powers && powers.has('keys')) return p.length > 0 && p[0] !== e.target && isField(p[0]);
    return typedInto(e);
  };
  const eventOf = (e, powers) => harden({
    type: String(e.type), ...(keyHidden(e, powers) ? { key: null, code: null } : { key: typeof e.key === 'string' ? e.key : null, code: typeof e.code === 'string' ? e.code : null }),
    // (what an input event typed: read-drafts only, never in a password or card field)
    ...(powers && powers.has('read-drafts') && typeof e.data === 'string' && !secretField(e.target) ? { data: e.data } : {}),
    shift: !!e.shiftKey, alt: !!e.altKey, ctrl: !!e.ctrlKey, meta: !!e.metaKey,
    x: typeof e.clientX === 'number' ? e.clientX : null, y: typeof e.clientY === 'number' ? e.clientY : null,
    deltaX: typeof e.deltaX === 'number' ? e.deltaX : null, deltaY: typeof e.deltaY === 'number' ? e.deltaY : null, repeat: !!e.repeat,
    target: e.target && e.target.nodeType === 1 ? wrap(e.target) : null,
    preventDefault: () => e.preventDefault(),
  });

  // ---- one MutationObserver for every mod in this world: trif.observe / trif.text watchers
  const watchers = new Set(); // {sel, fn, seen, mod}
  const texters = new Set(); // {sel, fn, mod}
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
  const ensureObserver = () => {
    const root = D.documentElement;
    if (!root) return;
    const wantText = texters.size > 0;
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
      });
    }
    moText = wantText;
    mo.observe(root, { childList: true, subtree: true, characterData: wantText });
  };
  // (at document_start there may be no <html> yet: watch for it)
  if (!D.documentElement) { const early = new MutationObserver(() => { if (D.documentElement) { early.disconnect(); if (watchers.size || texters.size) { ensureObserver(); for (const w of watchers) runWatcher(w, D.documentElement); for (const tx of texters) textUnder(tx, D.documentElement); } } }); early.observe(D, { childList: true }); }

  const styleSheet = (text) => {
    const st = D.createElement('style');
    st.textContent = text;
    (D.head || D.documentElement).append(st);
    return st;
  };

  let current = null; // the api of the mod whose code TRIF is running (its top level, or a callback)
  /** Everything one mod gets (its own error reporting, timers, settings, watchers). */
  const apis = new Map(); // mod id -> its api
  const apiFor = (modId, powers) => {
    if (apis.has(modId)) return apis.get(modId);
    // (its powers: docs/POWERS.md; what's not in this set it doesn't get, and a mod TRIF can't name gets none)
    const self = { powers: new Set(Array.isArray(powers) ? powers.map(String) : []) };
    const has = (p) => self.powers.has(p);
    const needs = (p) => { if (!has(p)) fail(`that needs the ${p} power (// @powers ${p} in the mod's header, which the user approves)`); };
    apis.set(modId, self);
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
    const listen = (target, type, fn, opts) => {
      str(type, 'an event type', 40);
      if (!LISTEN.test(type)) fail(`listening for "${type}" isn't offered`);
      if (typeof fn !== 'function') fail('a listener must be a function');
      const capture = !!(opts && opts.capture);
      const h = (e) => call(fn, eventOf(e, self.powers));
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
    const css = (text) => {
      const t = str(text, 'CSS', 500000);
      if (!cssOk(t)) fail('that CSS loads from an address (only data: is allowed), or has escapes outside strings');
      const st = styleSheet(t);
      return harden({ remove: () => st.remove() });
    };
    const observe = (sel, fn) => {
      str(sel, 'a selector', 2000);
      qsa(D.createDocumentFragment(), sel);
      if (typeof fn !== 'function') fail('observe takes a function');
      const w = { sel, seen: new WeakSet(), call: (s) => call(fn, s), mod: modId };
      watchers.add(w);
      ensureObserver();
      if (D.documentElement) runWatcher(w, D.documentElement);
      return harden(() => { watchers.delete(w); });
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
        if (json.length > 64 * 1024) fail('settings can take up to 64 KB');
        if (SANDBOX) {
          if (!send) fail('settings can\'t be saved here');
          const r = await send({ trifSandbox: 'settings.save', mod: modId, key: k, json });
          if (!r || !r.ok) fail(`settings weren't saved${r && r.error ? `: ${r.error}` : ''}`);
        } else localStorage.setItem(`trif.settings.${modId}.${k}`, json);
        return true;
      };
      return harden({ value: harden(value), save: guard(save) });
    };
    // The `sound` power: Web Audio through TRIF's own small set of nodes (oscillators, gains, filters, delays,
    // panners, noise and sounds from data: URLs), so no address, no microphone, no worklet, no page media.
    let audio = null;
    const audioApi = () => {
      needs('sound');
      if (audio) return audio;
      const AC = G.AudioContext || G.webkitAudioContext;
      if (!AC) fail('this browser has no Web Audio');
      const ctx = new AC();
      // (the browser starts it only after the user does something on the page: TRIF resumes it then)
      const wake = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
      for (const t of ['pointerdown', 'keydown']) G.addEventListener(t, wake, { capture: true, passive: true });
      const nodeOfFacade = new WeakMap();
      // (every function here guarded: a browser error, thrown or rejected, reaches the mod as plain text)
      const clean = (e) => (e instanceof TypeError && /^TRIF sandbox: /.test(e.message) ? e : new TypeError(`TRIF sandbox: ${String(e && e.message ? e.message : e).slice(0, 500)}`));
      const hardenAll = (o) => { for (const k of Object.keys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (typeof d.value === 'function') { const fn = d.value; o[k] = function (...a) { let r; try { r = fn.apply(this, a); } catch (e) { throw clean(e); } return r && typeof r.then === 'function' ? r.then((x) => x, (e) => { throw clean(e); }) : r; }; } } return harden(o); };
      const num = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} must be a number`); return v; };
      const when = (at) => (at === undefined ? ctx.currentTime : num(at, 'a time'));
      const paramOf = (ap) => hardenAll({
        get value() { return ap.value; },
        set: (v, at) => { ap.setValueAtTime(num(v, 'a value'), when(at)); },
        ramp: (v, at) => { ap.linearRampToValueAtTime(num(v, 'a value'), num(at, 'a time')); },
        expRamp: (v, at) => { ap.exponentialRampToValueAtTime(num(v, 'a value'), num(at, 'a time')); },
        target: (v, at, tc) => { ap.setTargetAtTime(num(v, 'a value'), when(at), num(tc, 'a time constant')); },
        cancel: (at) => { ap.cancelScheduledValues(when(at)); },
      });
      const PARAMS = ['frequency', 'detune', 'gain', 'Q', 'delayTime', 'pan', 'playbackRate'];
      const facade = (node) => {
        const f = hardenAll({
          connect: (to) => { node.connect(to === 'out' ? ctx.destination : (nodeOfFacade.get(to) || fail('connect takes another of this mod\'s sound nodes, or \'out\''))); return to; },
          disconnect: () => { node.disconnect(); },
          start: (at) => { if (typeof node.start !== 'function') fail('only sources start'); node.start(when(at)); },
          stop: (at) => { if (typeof node.stop !== 'function') fail('only sources stop'); node.stop(when(at)); },
          param: (name) => { str(name, 'a parameter', 40); if (!PARAMS.includes(name) || !node[name]) fail(`no ${name} here`); return paramOf(node[name]); },
        });
        nodeOfFacade.set(f, node);
        return f;
      };
      const opt = (o) => (o && typeof o === 'object' ? o : {});
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
      audio = hardenAll({
        get now() { return ctx.currentTime; },
        get state() { return ctx.state; },
        resume: () => ctx.resume().then(() => ctx.state, () => ctx.state),
        out: 'out',
        oscillator: (o) => { const n = ctx.createOscillator(); o = opt(o); if (o.type !== undefined) n.type = str(o.type, 'a wave type', 20); if (o.frequency !== undefined) n.frequency.value = num(o.frequency, 'a frequency'); return facade(n); },
        gain: (v) => { const n = ctx.createGain(); if (v !== undefined) n.gain.value = num(v, 'a gain'); return facade(n); },
        filter: (o) => { const n = ctx.createBiquadFilter(); o = opt(o); if (o.type !== undefined) n.type = str(o.type, 'a filter type', 20); for (const k of ['frequency', 'Q', 'gain']) if (o[k] !== undefined) n[k].value = num(o[k], k); return facade(n); },
        delay: (sec) => { const n = ctx.createDelay(5); if (sec !== undefined) n.delayTime.value = num(sec, 'a delay'); return facade(n); },
        panner: (pan) => { const n = ctx.createStereoPanner(); if (pan !== undefined) n.pan.value = num(pan, 'a pan'); return facade(n); },
        noise: (sec) => {
          const len = Math.max(1, Math.min(ctx.sampleRate * 10, Math.round(ctx.sampleRate * num(sec === undefined ? 1 : sec, 'a length'))));
          const b = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = b.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          const n = ctx.createBufferSource(); n.buffer = b; return facade(n);
        },
        sound: async (url, o) => { const b = await decode(url); const n = ctx.createBufferSource(); n.buffer = b; o = opt(o); if (o.loop) n.loop = true; if (o.rate !== undefined) n.playbackRate.value = num(o.rate, 'a rate'); return facade(n); },
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
      });
      return audio;
    };
    const trifApi = {
      css, observe, text, settings, audio: audioApi,
      hide: (sel) => css(`${selectorOk(sel)} { display: none !important; }`),
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
  const ctxOf = (canvas) => {
    const c = canvas.getContext('2d');
    if (!c) fail('no 2D drawing on this canvas');
    const ops = {};
    for (const k of ['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
      'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'resetTransform', 'clip', 'roundRect']) {
      ops[k] = guardShared((...a) => { for (const x of a) if (typeof x !== 'number' && typeof x !== 'string' && x !== undefined) fail(`${k} takes numbers and text`); c[k](...a); });
    }
    ops.measureText = guardShared((t) => harden({ width: c.measureText(str(t, 'text', 10000)).width }));
    ops.set = guardShared((props) => {
      for (const [k, v] of Object.entries(props || {})) {
        if (!['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'globalAlpha', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'globalCompositeOperation', 'lineDashOffset'].includes(k)) fail(`${k} can't be set here`);
        if (typeof v !== 'string' && typeof v !== 'number') fail(`${k} takes text or a number`);
        c[k] = v;
      }
    });
    return harden(ops);
  };
  const classesOf = new WeakMap();
  const protoDef = {
    get tag() { return nodeOf(this).localName; },
    get text() { const n = nodeOf(this); return cur().powers.has('read-drafts') ? n.textContent : visibleText(n); },
    setText(t) {
      const n = nodeOf(this);
      if (isRaw(n)) fail(`text can't be written into <${n.localName}>`);
      detachOk(n, true);
      n.textContent = str(t, 'text');
    },
    attr(name) { const n = nodeOf(this); str(name, 'an attribute name', 100); return insideEditor(n) && !cur().powers.has('read-drafts') ? null : n.getAttribute(name); },
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
      if (!created.has(n) || !/^(input|select)$/.test(n.localName)) fail('setValue is for the mod\'s own controls (changing what the user typed is the write-drafts power, not in this version)');
      n.value = str(String(v), 'a value', 10000);
    },
    get checked() { const n = nodeOf(this); return n.localName === 'input' ? !!n.checked : false; },
    setChecked(on) { const n = nodeOf(this); if (!created.has(n) || n.localName !== 'input') fail('setChecked is for the mod\'s own checkboxes'); n.checked = !!on; },
    setAttr(name, value) {
      const node = nodeOf(this);
      const n = str(name, 'an attribute name', 100).toLowerCase(), v = str(String(value), 'a value', 200000);
      // (the mod's own controls: their few attributes; autocomplete and name never)
      if (created.has(node) && CONTROL_TAGS.has(node.localName) && controlAttrOk(node, n, v)) { node.setAttribute(n, v); return; }
      if (!nameOk(n)) fail(nameRefused(n));
      if (ATTR_TAGS[n] && (!ATTR_TAGS[n].has(node.localName) || node.namespaceURI !== HTML_NS)) fail(`${n} isn't offered on <${node.localName}>`);
      if (n === 'id' || n === 'class') {
        if (!ownTokens(v) || (n === 'id' && /\s/.test(v.trim()))) fail(`${n === 'id' ? 'an id' : 'classes'} must start with trif- (the page's own code finds elements by ${n})`);
        // (the page's own id or classes stay theirs: a mod adds its classes with classes.add)
        if (!created.has(node) && node.hasAttribute(n) && !ownTokens(node.getAttribute(n))) fail(`the page's own ${n} isn't a mod's to replace${n === 'class' ? ' (classes.add adds a trif- class)' : ''}`);
      }
      if ((n === 'href' || n === 'src') && !urlOk(v, n)) fail(`${n} only takes this site's own addresses without a query${n === 'src' ? ', or data:/blob: images' : ''}`);
      node.setAttribute(n, v);
    },
    removeAttr(name) {
      const n = str(name, 'an attribute name', 100).toLowerCase();
      const node = nodeOf(this);
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
        // (a mod adds, removes and toggles only its own trif- classes; it can read any)
        const cls = (x) => { str(x, 'a class', 200); if (!OWN_NAME.test(x)) fail(`classes a mod sets must start with trif- (the page's own code acts on classes like "${x.slice(0, 60)}")`); return x; };
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
      if (value === null || value === '') { node.style.removeProperty(p); return ''; }
      const v = str(String(value), 'a style value', 10000);
      if (!cssOk(v)) fail('that style value loads from an address (only data: is allowed)');
      node.style.setProperty(p, v, 'important');
      return v;
    },
    hide() { nodeOf(this).style.setProperty('display', 'none', 'important'); },
    show() { nodeOf(this).style.removeProperty('display'); },
    find(sel) { return wrap(qs(nodeOf(this), str(sel, 'a selector', 2000))); },
    findAll(sel) { return list(qsa(nodeOf(this), str(sel, 'a selector', 2000))); },
    closest(sel) { const n = nodeOf(this); str(sel, 'a selector', 2000); try { return wrap(n.closest(sel)); } catch { return fail(`"${sel.slice(0, 80)}" isn't a valid selector`); } },
    matches(sel) { const n = nodeOf(this); str(sel, 'a selector', 2000); try { return n.matches(sel); } catch { return fail(`"${sel.slice(0, 80)}" isn't a valid selector`); } },
    get parent() { return wrap(nodeOf(this).parentElement); },
    get children() { return list(nodeOf(this).children); },
    get next() { return wrap(nodeOf(this).nextElementSibling); },
    get previous() { return wrap(nodeOf(this).previousElementSibling); },
    get created() { return created.has(nodeOf(this)); },
    append(...kids) { const n = nodeOf(this); const k = kids.map(kidOf); textInto(n, k); n.append(...k); },
    prepend(...kids) { const n = nodeOf(this); const k = kids.map(kidOf); textInto(n, k); n.prepend(...k); },
    before(...kids) { const n = nodeOf(this); const k = kids.map(kidOf); if (n.parentNode) textInto(n.parentNode, k); n.before(...k); },
    after(...kids) { const n = nodeOf(this); const k = kids.map(kidOf); if (n.parentNode) textInto(n.parentNode, k); n.after(...k); },
    remove() { const n = nodeOf(this); detachOk(n, false); n.remove(); },
    // a copy of this element and what's inside it, keeping only allowed elements and attributes (an element
    // of another kind is left out, with what's inside it; other attributes are dropped)
    clone() { return wrap(safeCopy(nodeOf(this))); },
    rect() { const r = nodeOf(this).getBoundingClientRect(); return harden({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom }); },
    on(type, fn, opts) { const n = nodeOf(this); return cur().listen(n, type, fn, opts); },
    canvas() { const n = nodeOf(this); if (n.localName !== 'canvas') fail('canvas() is for <canvas> elements'); return ctxOf(n); },
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
        const c = new G.Compartment({ __options__: true, globals: { ...api.endowments, Math, Date } });
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
  Object.defineProperty(G, '__trifSandbox', { value: Object.freeze({ run, errors: store.errors, logs: store.logs, stats }), configurable: false, writable: false });
  // (mods that came before the runtime)
  const queued = G.__trifSandboxQueue;
  if (Array.isArray(queued)) { G.__trifSandboxQueue = null; for (const [id, source, powers] of queued) run(id, source, powers); }
}

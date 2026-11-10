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

/** One sandboxed mod, in TRIF's world: its source, handed to the runtime as text (SES evaluates it). */
export function sandboxModCode(id, source) {
  return `(globalThis.__trifSandbox ? globalThis.__trifSandbox.run(${J(id)}, ${J(source)}) : (globalThis.__trifSandboxQueue = globalThis.__trifSandboxQueue || []).push([${J(id)}, ${J(source)}]));\n//# sourceURL=trif-sandbox://${id}.js`;
}

/**
 * A sandboxed mod run as a page script (a browser without TRIF's world, once the user allowed it): the
 * same API, built in the page's world, around the mod's code, which has everything the page has.
 */
export function sandboxPageCode(id, source) {
  return `(${sandboxRuntime.toString()})('page', ${J(id)}, function (${SANDBOX_GLOBALS.filter((n) => n !== 'Math' && n !== 'Date').join(', ')}) { "use strict";\n${source}\n});\n//# sourceURL=trif://${id}.js`;
}

/**
 * The runtime. mode 'sandbox': in TRIF's world, with SES loaded; installs globalThis.__trifSandbox. mode
 * 'page': in the page's world (no SES, nothing confined), runs `fn` with the API as its arguments.
 */
export function sandboxRuntime(mode, pageModId, pageFn) {
  const G = globalThis;
  const SANDBOX = mode === 'sandbox';
  if (SANDBOX && G.__trifSandbox) return;
  // What it costs, for `trif`'s e2e and anyone measuring (__trifSandbox.stats): SES's own load (from the stamp
  // put before it: sandboxRuntimeScript), lockdown, each mod's first run, and the mods' callbacks.
  const now = () => performance.now();
  const stats = { sesMs: typeof G.__trifT0 === 'number' ? now() - G.__trifT0 : null, lockdownMs: null, startedAt: now(), mods: {}, callbacks: 0, callbackMs: 0 };
  // (TRIF's world: messaging to TRIF's background is for TRIF's code only, captured before any mod runs;
  // mods never get `chrome`: their global is the compartment's)
  let send = null;
  if (SANDBOX) {
    const rt = (G.chrome && G.chrome.runtime) || (G.browser && G.browser.runtime);
    if (rt && typeof rt.sendMessage === 'function') { const sm = rt.sendMessage; send = (m) => sm.call(rt, m); }
    try { delete G.chrome; } catch { /* kept: unreachable from mods anyway */ }
    try { delete G.browser; } catch { /* as above */ }
    // The language locked down once per world (every sandboxed mod in this page shares it). Built-ins newer
    // than SES knows are removed (reporting 'none': it would otherwise list them in the console each time).
    const tl = now();
    G.lockdown({ errorTaming: 'unsafe', consoleTaming: 'unsafe', overrideTaming: 'severe', stackFiltering: 'concise', reporting: 'none' });
    stats.lockdownMs = now() - tl;
  }
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
      const stack = err && typeof err === 'object' ? String(err.stack || '') : '';
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
  // (an address only where it can't run or send anything by itself: a link's href, an image's src; `value`
  // only on a progress bar or list item, never on a form field, whose value the site would receive)
  const ATTR_TAGS = { href: new Set(['a']), src: new Set(['img']), value: new Set(['progress', 'li']), max: new Set(['progress']) };
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc']);
  const SVG_ATTRS = /^(viewbox|d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|points|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|opacity|fill-opacity|stroke-opacity|fill-rule|clip-rule|transform|offset|stop-color|stop-opacity|gradientunits|gradienttransform|xmlns|preserveaspectratio|focusable|font-size|font-family|text-anchor|dominant-baseline|width|height)$/;
  // Text inside these is code or CSS the browser would carry out: never written by a mod.
  const RAW_TEXT = new Set(['script', 'style']);
  // Text inside these is what a form sends: not rewritten by a mod either.
  const FORM_TEXT = new Set(['textarea', 'option', 'select']);
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
  const isRaw = (n) => !!n && n.nodeType === 1 && (RAW_TEXT.has(n.localName) || FORM_TEXT.has(n.localName));

  // ---- the stand-ins: one per node (identity kept), frozen, sharing one frozen prototype whose methods
  // find their node in a WeakMap (an object TRIF didn't make has none)
  const standins = new WeakMap(); // node -> stand-in
  const nodes = new WeakMap(); // stand-in -> node
  const created = new WeakSet(); // nodes a mod made (page.create, clone)
  const nodeOf = (s) => { const n = s && typeof s === 'object' ? nodes.get(s) : undefined; if (!n) fail('that isn\'t an element TRIF gave you'); return n; };
  const kidOf = (k) => (typeof k === 'string' ? k : nodeOf(k));
  const textInto = (parent, kids) => {
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

  const SVG_COPY_ATTR = (n) => SVG_ATTRS.test(n) || n === 'class' || n === 'id' || n === 'role' || /^(data|aria)-[a-z0-9-]+$/.test(n);
  const safeCopy = (from) => {
    const tag = from.localName.toLowerCase();
    const svg = from.namespaceURI === SVG_NS;
    if (svg ? !SVG_TAGS.has(tag) : from.namespaceURI !== HTML_NS || !TAGS.has(tag)) return null;
    const to = svg ? D.createElementNS(SVG_NS, from.localName) : D.createElement(tag);
    for (const a of from.attributes) {
      const n = a.name.toLowerCase();
      if (/^on/.test(n) || n === 'style') continue;
      if (svg) { if (!SVG_COPY_ATTR(n) || (/url\s*\(/i.test(a.value) && !/^\s*url\(\s*["']?#/.test(a.value))) continue; }
      else if (!(ATTRS.has(n) || /^(data|aria)-[a-z0-9-]+$/.test(n)) || (ATTR_TAGS[n] && !ATTR_TAGS[n].has(tag)) || ((n === 'href' || n === 'src') && !urlOk(a.value, n))) continue;
      to.setAttribute(a.name, a.value);
    }
    for (const c of from.childNodes) {
      if (c.nodeType === 3) to.append(c.data);
      else if (c.nodeType === 1) { const k = safeCopy(c); if (k) to.append(k); }
    }
    created.add(to);
    return to;
  };

  const eventOf = (e) => harden({
    type: String(e.type), key: typeof e.key === 'string' ? e.key : null, code: typeof e.code === 'string' ? e.code : null,
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
    if (!p || isRaw(p) || written.get(t) === t.data) return;
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
  const apiFor = (modId) => {
    if (apis.has(modId)) return apis.get(modId);
    const self = {};
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
      const h = (e) => call(fn, eventOf(e));
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
    const trifApi = {
      css, observe, text, settings,
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
        if (!TAGS.has(t)) fail(`<${t}> elements aren't offered`);
        const n = D.createElement(t);
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
  const modFromStack = () => { const m = /trif-sandbox:\/\/([^\s/]+\/[^\s/:)]+?)\.js/.exec(String(new Error().stack || '')); return m ? m[1] : null; };
  const cur = () => current || apiFor(modFromStack() || '(a sandboxed mod)');
  const ctxOf = (canvas) => {
    const c = canvas.getContext('2d');
    if (!c) fail('no 2D drawing on this canvas');
    const ops = {};
    for (const k of ['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
      'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'resetTransform', 'clip', 'roundRect']) {
      ops[k] = (...a) => { for (const x of a) if (typeof x !== 'number' && typeof x !== 'string' && x !== undefined) fail(`${k} takes numbers and text`); c[k](...a); };
    }
    ops.measureText = (t) => harden({ width: c.measureText(str(t, 'text', 10000)).width });
    ops.set = (props) => {
      for (const [k, v] of Object.entries(props || {})) {
        if (!['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'globalAlpha', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'globalCompositeOperation', 'lineDashOffset'].includes(k)) fail(`${k} can't be set here`);
        if (typeof v !== 'string' && typeof v !== 'number') fail(`${k} takes text or a number`);
        c[k] = v;
      }
    };
    return harden(ops);
  };
  const classesOf = new WeakMap();
  const protoDef = {
    get tag() { return nodeOf(this).localName; },
    get text() { return nodeOf(this).textContent; },
    setText(t) {
      const n = nodeOf(this);
      if (isRaw(n)) fail(`text can't be written into <${n.localName}>`);
      n.textContent = str(t, 'text');
    },
    attr(name) { return nodeOf(this).getAttribute(str(name, 'an attribute name', 100)); },
    setAttr(name, value) {
      const node = nodeOf(this);
      const n = str(name, 'an attribute name', 100).toLowerCase(), v = str(String(value), 'a value', 10000);
      if (!(ATTRS.has(n) || /^(data|aria)-[a-z0-9-]+$/.test(n))) fail(`the ${n} attribute isn't offered`);
      if (ATTR_TAGS[n] && (!ATTR_TAGS[n].has(node.localName) || node.namespaceURI !== HTML_NS)) fail(`${n} isn't offered on <${node.localName}>`);
      if ((n === 'href' || n === 'src') && !urlOk(v, n)) fail(`${n} only takes this site's own addresses without a query${n === 'src' ? ', or data:/blob: images' : ''}`);
      node.setAttribute(n, v);
    },
    removeAttr(name) {
      const n = str(name, 'an attribute name', 100).toLowerCase();
      if (!(ATTRS.has(n) || /^(data|aria)-[a-z0-9-]+$/.test(n))) fail(`the ${n} attribute isn't offered`);
      nodeOf(this).removeAttribute(n);
    },
    get classes() {
      const node = nodeOf(this);
      let c = classesOf.get(node);
      if (!c) {
        const cls = (x) => str(x, 'a class', 200);
        c = harden({
          add: (...x) => node.classList.add(...x.map(cls)),
          remove: (...x) => node.classList.remove(...x.map(cls)),
          toggle: (x, on) => node.classList.toggle(cls(x), on === undefined ? undefined : !!on),
          has: (x) => node.classList.contains(cls(x)),
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
    remove() { nodeOf(this).remove(); },
    // a copy of this element and what's inside it, keeping only allowed elements and attributes (an element
    // of another kind is left out, with what's inside it; other attributes are dropped)
    clone() { return wrap(safeCopy(nodeOf(this))); },
    rect() { const r = nodeOf(this).getBoundingClientRect(); return harden({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom }); },
    on(type, fn, opts) { const n = nodeOf(this); return cur().listen(n, type, fn, opts); },
    canvas() { const n = nodeOf(this); if (n.localName !== 'canvas') fail('canvas() is for <canvas> elements'); return ctxOf(n); },
  };
  // (each method guarded: a browser error reaches the mod as plain text)
  const guardShared = (fn) => function (...args) {
    try { return fn.apply(this, args); } catch (e) {
      if (e instanceof TypeError && /^TRIF sandbox: /.test(e.message)) throw e;
      throw new TypeError(`TRIF sandbox: ${String(e && e.message ? e.message : e).slice(0, 500)}`);
    }
  };
  const protoOut = {};
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(protoDef))) {
    Object.defineProperty(protoOut, k, d.get ? { get: guardShared(d.get), enumerable: true } : { value: guardShared(d.value), enumerable: true });
  }
  PROTO = harden(protoOut);

  // ---- running a mod
  const SANDBOX_GLOBALS_PAGE = ['page', 'trif', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const run = (modId, source) => {
    const id = String(modId);
    const api = apiFor(id);
    const prev = current, t = now();
    current = api;
    try {
      if (SANDBOX) {
        const c = new G.Compartment({ __options__: true, globals: { ...api.endowments, Math, Date } });
        // (no code from strings inside the compartment either, and none of SES's own tools)
        for (const n of ['eval', 'Function', 'Compartment', 'lockdown', 'harden', 'assert']) {
          try { Object.defineProperty(c.globalThis, n, { value: undefined, writable: false, enumerable: false, configurable: false }); } catch { /* not there */ }
        }
        c.evaluate(`(function () { "use strict";\n${source}\n})();\n//# sourceURL=trif-sandbox://${id}.js`);
      } else {
        const e = api.endowments;
        source.call(undefined, ...SANDBOX_GLOBALS_PAGE.map((n) => e[n]));
      }
    } catch (err) {
      report(id, err);
    } finally {
      current = prev;
      stats.mods[id] = { at: t, runMs: now() - t };
    }
  };
  if (!SANDBOX) { run(pageModId, pageFn); return; }
  // (a promise a mod left rejected: reported as that mod's, by the stack)
  try {
    G.addEventListener('unhandledrejection', (ev) => {
      const r = ev.reason;
      const m = /trif-sandbox:\/\/([^\s/]+\/[^\s/:)]+?)\.js/.exec(String((r && r.stack) || ''));
      if (m) report(m[1], r);
    });
  } catch { /* none */ }
  Object.defineProperty(G, '__trifSandbox', { value: Object.freeze({ run, errors: store.errors, logs: store.logs, stats }), configurable: false, writable: false });
  // (mods that came before the runtime)
  const queued = G.__trifSandboxQueue;
  if (Array.isArray(queued)) { G.__trifSandboxQueue = null; for (const [id, source] of queued) run(id, source); }
}

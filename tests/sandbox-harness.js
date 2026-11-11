'use strict';
// A stand-in browser for TRIF's sandbox runtime (extension/sandbox.js), for unit tests of its page-wide rules:
// the runtime's own code, run in a vm context with a small fake document and SES's names stood in for (no
// lockdown, a Compartment that runs the mod with its endowments as parameters). Not the sandbox's guarantees
// (those are SES's and the browsers', tried in tests/e2e): only TRIF's own decisions, like which acts it refuses.

const vm = require('vm');
const path = require('path');
const { pathToFileURL } = require('url');

class FakeEvent { constructor(type, o = {}) { this.type = type; this.detail = o.detail; this.bubbles = !!o.bubbles; this.isTrusted = false; } preventDefault() {} stopPropagation() {} stopImmediatePropagation() {} }
class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(t, fn) { if (!this.listeners.has(t)) this.listeners.set(t, []); this.listeners.get(t).push(fn); }
  removeEventListener(t, fn) { const l = this.listeners.get(t) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  dispatchEvent(e) { if (!e.target) e.target = this; for (const fn of [...(this.listeners.get(e.type) || [])]) fn(e); return true; }
}
class FakeElement extends FakeTarget {
  constructor(doc, tag, attrs = {}) { super(); this.ownerDocument = doc; this.localName = tag; this.nodeType = 1; this.namespaceURI = 'http://www.w3.org/1999/xhtml'; this.attrs = { ...attrs }; this.children = []; this.parentElement = null; this.clicks = 0; }
  get id() { return this.attrs.id || ''; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  hasAttribute(n) { return n in this.attrs; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  matches(sel) { return sel.split(',').some((s) => { s = s.trim(); return s === this.localName || s === `#${this.id}` || s === `${this.localName}#${this.id}`; }); }
  closest(sel) { for (let e = this; e; e = e.parentElement) if (e.matches(sel)) return e; return null; }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  append(...k) { for (const c of k) if (typeof c === 'object') { c.parentElement = this; this.children.push(c); } }
  get isConnected() { return true; }
  get isContentEditable() { return false; }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
  get textContent() { return ''; }
  click() { this.clicks++; }
  getRootNode() { return this.ownerDocument; }
}

/** A page with the runtime loaded: {G, doc, run(id, source, grant), errors(), el(id)}. `body` lists elements. */
async function sandboxPage({ url = 'https://x.com/home', body = [] } = {}) {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'sandbox.js')).href);
  const doc = new FakeTarget();
  const html = new FakeElement(doc, 'html');
  const bodyEl = new FakeElement(doc, 'body');
  html.append(bodyEl);
  for (const b of body) bodyEl.append(new FakeElement(doc, b.tag, b.attrs));
  Object.assign(doc, {
    nodeType: 9, readyState: 'complete', documentElement: html, body: bodyEl, head: html, images: [], links: [], styleSheets: [], designMode: 'off', cookie: '',
    querySelectorAll: (s) => html.querySelectorAll(s), querySelector: (s) => html.querySelector(s), getElementById: (id) => html.querySelector(`#${id}`),
    createElement: (t) => new FakeElement(doc, t), createElementNS: (ns, t) => new FakeElement(doc, t), createTextNode: (t) => ({ nodeType: 3, data: t }),
    createDocumentFragment: () => ({ querySelector: () => null, querySelectorAll: () => [] }), activeElement: bodyEl,
    createTreeWalker: () => ({ nextNode: () => null }),
  });
  const u = new URL(url);
  const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null }; };
  const G = new FakeTarget();
  Object.assign(G, {
    document: doc, location: { href: url, origin: u.origin, hostname: u.hostname, assign() {}, reload() {} }, sessionStorage: storage(), localStorage: storage(),
    performance: { now: () => Date.now() }, CustomEvent: FakeEvent, Event: FakeEvent, PopStateEvent: FakeEvent,
    MutationObserver: class { observe() {} disconnect() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (f) => setTimeout(() => f(Date.now()), 0), cancelAnimationFrame: clearTimeout, console, Math, Date, URL, URLSearchParams, TextEncoder, TextDecoder,
    atob, btoa, Int8Array, Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, ArrayBuffer, DataView, Promise, Map, Set, WeakMap, WeakSet, Object, Array, JSON, Error, TypeError, RegExp, String, Number, Boolean, Symbol, Reflect, Proxy,
    Element: FakeElement, Node: FakeElement, DataTransfer: class { constructor() { this.items = { add() {} }; } },
    lockdown() {}, harden: (o) => o,
    Compartment: class { constructor(o) { this.g = (o && o.globals) || {}; this.globalThis = {}; } evaluate(src) { const k = Object.keys(this.g); return new Function(...k, `return ${src}`)(...k.map((n) => this.g[n])); } },
  });
  G.window = G; G.self = G; G.globalThis = G;
  const ctx = vm.createContext(G);
  vm.runInContext(mod.sandboxRuntimeCode(), ctx);
  const run = (id, source, grant = {}) => G.__trifSandbox.run(id, source, { powers: grant.powers || [], args: grant.args || {} });
  return { G, doc, run, errors: () => G.__trifSandbox.errors.slice(), el: (id) => doc.getElementById(id), tick: () => new Promise((r) => setTimeout(r, 10)) };
}

module.exports = { sandboxPage };

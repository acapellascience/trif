// Sandboxed mods, default-deny (docs/SAFE-MODS.md "Stand-in design"). A `// @sandboxed standin` mod's code
// runs in a Secure EcmaScript (SES) Compartment, inside TRIF's own userScripts world. The compartment's
// global holds only the JavaScript language (frozen by lockdown) and what TRIF hands it: `page`, `timers`,
// `trif`, `Math` and `Date`. No window, document, element, event constructor, fetch, storage, frame or
// browser API is reachable from the mod unless it's in that list, so what browsers add later isn't either.
// The page's elements reach the mod only as TRIF-made stand-ins: frozen objects whose methods are
// TRIF's, allowlisted (tags, attributes, addresses, CSS), with the real node kept out of reach.
//
// Loaded as two userScripts files in TRIF's world: vendor/ses.umd.min.js (SES, Apache-2.0), then
// `standinBootCode(id, source)`, which runs standinBoot (below) once per mod.

export const STANDIN_WORLD = 'trif-standin';
// (SES evaluates the mod's code with eval inside its compartment, so this world allows 'unsafe-eval';
// network stays off.)
export const STANDIN_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'";

export function standinBootCode(id, source) {
  return `(${standinBoot.toString()})(${JSON.stringify(String(id))}, ${JSON.stringify(String(source))});\n//# sourceURL=trif-standin://${id}.js`;
}

/** TRIF's side of a stand-in mod: runs in TRIF's world, where the real DOM is; serialized, so self-contained. */
export function standinBoot(modId, source) {
  const G = globalThis;
  // ---- the language locked down, once per world (every stand-in mod in this page shares it)
  if (!G.__trifStandinLocked) {
    // (reporting: 'none': lockdown removes built-ins it doesn't know, newer than SES, which it would
    // otherwise note in the page's console each time)
    G.lockdown({ errorTaming: 'unsafe', consoleTaming: 'unsafe', overrideTaming: 'severe', stackFiltering: 'concise', reporting: 'none' });
    G.__trifStandinLocked = true;
  }
  const harden = G.harden;
  const D = document;
  const realQS = (root, sel) => Element.prototype.querySelector.call(root, sel);
  const realQSA = (root, sel) => Element.prototype.querySelectorAll.call(root, sel);
  const fail = (why) => { throw new TypeError(`TRIF stand-in: ${why}`); };
  const str = (v, what, max = 100000) => { if (typeof v !== 'string') fail(`${what} must be text`); if (v.length > max) fail(`${what} is too long`); return v; };

  // ---- allowlists
  const TAGS = new Set(['div', 'span', 'p', 'a', 'button', 'img', 'ul', 'ol', 'li', 'section', 'header', 'footer', 'nav', 'aside', 'article',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'mark', 'code', 'pre', 'blockquote', 'label',
    'br', 'hr', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'canvas', 'details', 'summary', 'progress']);
  const ATTRS = new Set(['id', 'class', 'title', 'role', 'hidden', 'alt', 'width', 'height', 'lang', 'dir', 'tabindex', 'colspan', 'rowspan', 'open', 'value', 'max', 'href', 'src']);
  const URL_ATTRS = new Set(['href', 'src']);
  const URL_TAGS = { href: new Set(['a']), src: new Set(['img']) };
  const ORIGIN = location.origin;
  const urlOk = (v) => {
    const s = String(v).trim();
    if (/^(data:image\/|blob:)/i.test(s)) return true;
    try { const u = new URL(s, location.href); return u.origin === ORIGIN && /^https?:$/.test(u.protocol); } catch { return false; }
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
    if (/@import\b|expression\s*\(|-moz-binding|behavior\s*:/.test(t)) return false;
    if (/(?:^|[^a-z-])(?:-webkit-)?(image-set|image|cross-fade|element)\s*\(/.test(t)) return false;
    const re = /url\s*\(/gi;
    let m;
    while ((m = re.exec(css))) { if (!/^\s*["']?\s*data:/i.test(css.slice(m.index + m[0].length))) return false; }
    return true;
  };
  const LISTEN = /^(click|dblclick|mouse(down|up|move|over|out|enter|leave)|pointer(down|up|move|over|out|enter|leave)|key(down|up)|wheel|scroll|resize|input|change|focus|blur|visibilitychange)$/;

  // ---- stand-ins for elements: one per node (identity kept), frozen, the node only in this closure
  const standins = new WeakMap(); // node -> stand-in
  const nodes = new WeakMap(); // stand-in -> node
  const nodeOf = (s) => { const n = nodes.get(s); if (!n) fail('that isn\'t an element TRIF gave you'); return n; };
  const listeners = []; // [target, type, fn] the mod added, so they can't pile up unseen
  const eventOf = (e) => harden({
    type: e.type, key: e.key ?? null, code: e.code ?? null, shift: !!e.shiftKey, alt: !!e.altKey, ctrl: !!e.ctrlKey, meta: !!e.metaKey,
    x: typeof e.clientX === 'number' ? e.clientX : null, y: typeof e.clientY === 'number' ? e.clientY : null,
    deltaY: typeof e.deltaY === 'number' ? e.deltaY : null, repeat: !!e.repeat,
    target: e.target && e.target.nodeType === 1 ? wrap(e.target) : null,
    preventDefault: () => e.preventDefault(),
  });
  const listen = (target, type, fn, opts) => {
    str(type, 'an event type', 40);
    if (!LISTEN.test(type)) fail(`listening for "${type}" isn't offered`);
    if (typeof fn !== 'function') fail('a listener must be a function');
    const h = (e) => { try { fn(eventOf(e)); } catch (err) { console.error('[TRIF]', modId, err); } };
    target.addEventListener(type, h, { passive: !(opts && opts.preventDefault), capture: !!(opts && opts.capture) });
    listeners.push([target, type, h]);
    return harden(() => target.removeEventListener(type, h, { capture: !!(opts && opts.capture) }));
  };
  const ctxOf = (canvas) => {
    const c = canvas.getContext('2d');
    if (!c) fail('no 2D drawing on this canvas');
    const ops = {};
    for (const k of ['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
      'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'resetTransform']) {
      ops[k] = (...a) => { for (const x of a) if (typeof x !== 'number' && typeof x !== 'string' && x !== undefined) fail(`${k} takes numbers and text`); c[k](...a); };
    }
    ops.measureText = (t) => ({ width: c.measureText(str(t, 'text', 10000)).width });
    // settable look (strings and numbers only: no patterns or images)
    ops.set = (props) => {
      for (const [k, v] of Object.entries(props || {})) {
        if (!['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'globalAlpha', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'shadowBlur', 'shadowColor', 'globalCompositeOperation'].includes(k)) fail(`${k} can't be set here`);
        if (typeof v !== 'string' && typeof v !== 'number') fail(`${k} takes text or a number`);
        c[k] = v;
      }
    };
    return harden(ops);
  };
  function wrap(node) {
    if (!node || node.nodeType !== 1) return null;
    if (standins.has(node)) return standins.get(node);
    const s = harden({
      get tag() { return node.localName; },
      get text() { return node.textContent; },
      setText(t) { node.textContent = str(t, 'text'); },
      attr(name) { return node.getAttribute(str(name, 'an attribute name', 100)); },
      setAttr(name, value) {
        const n = str(name, 'an attribute name', 100).toLowerCase(), v = str(String(value), 'a value', 10000);
        if (!(ATTRS.has(n) || /^(data|aria)-[a-z0-9-]+$/.test(n))) fail(`the ${n} attribute isn't offered`);
        if (URL_ATTRS.has(n) && (!URL_TAGS[n].has(node.localName) || !urlOk(v))) fail(`${n} on <${node.localName}> only takes this site's addresses (or data:/blob: images)`);
        node.setAttribute(n, v);
      },
      removeAttr(name) { const n = str(name, 'an attribute name', 100).toLowerCase(); if (!(ATTRS.has(n) || /^(data|aria)-/.test(n))) fail(`the ${n} attribute isn't offered`); node.removeAttribute(n); },
      classes: harden({
        add: (...c) => node.classList.add(...c.map((x) => str(x, 'a class', 200))),
        remove: (...c) => node.classList.remove(...c.map((x) => str(x, 'a class', 200))),
        toggle: (c, on) => node.classList.toggle(str(c, 'a class', 200), on === undefined ? undefined : !!on),
        has: (c) => node.classList.contains(str(c, 'a class', 200)),
      }),
      style(prop, value) {
        const p = str(prop, 'a style property', 100);
        if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(p)) fail(`"${p}" isn't a style property`);
        if (value === undefined) return getComputedStyle(node).getPropertyValue(p);
        const v = str(String(value), 'a style value', 10000);
        if (!cssOk(v)) fail('that style value loads from an address (only data: is allowed)');
        node.style.setProperty(p, v, 'important');
        return v;
      },
      hide() { node.style.setProperty('display', 'none', 'important'); },
      show() { node.style.removeProperty('display'); },
      find(sel) { return wrap(realQS(node, str(sel, 'a selector', 1000))); },
      findAll(sel) { return harden([...realQSA(node, str(sel, 'a selector', 1000))].map(wrap)); },
      closest(sel) { return wrap(node.closest(str(sel, 'a selector', 1000))); },
      matches(sel) { return node.matches(str(sel, 'a selector', 1000)); },
      get parent() { return wrap(node.parentElement); },
      get children() { return harden([...node.children].map(wrap)); },
      append(...kids) { for (const k of kids) node.append(typeof k === 'string' ? k : nodeOf(k)); },
      prepend(...kids) { for (const k of kids) node.prepend(typeof k === 'string' ? k : nodeOf(k)); },
      before(k) { node.before(typeof k === 'string' ? k : nodeOf(k)); },
      after(k) { node.after(typeof k === 'string' ? k : nodeOf(k)); },
      remove() { node.remove(); },
      // a copy of this element and what's inside it, keeping only allowed elements and attributes (an
      // element of another kind is left out, with what's inside it; other attributes are dropped)
      clone() { return wrap(safeCopy(node)); },
      rect() { const r = node.getBoundingClientRect(); return harden({ x: r.x, y: r.y, width: r.width, height: r.height }); },
      on(type, fn, opts) { return listen(node, type, fn, opts); },
      canvas() { if (node.localName !== 'canvas') fail('canvas() is for <canvas> elements'); return ctxOf(node); },
    });
    standins.set(node, s);
    nodes.set(s, node);
    return s;
  }

  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc']);
  const SVG_ATTRS = /^(viewbox|d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|points|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|opacity|fill-opacity|stroke-opacity|fill-rule|clip-rule|transform|offset|stop-color|stop-opacity|gradientunits|gradienttransform|xmlns|preserveaspectratio|focusable|font-size|font-family|text-anchor|dominant-baseline)$/;
  const safeCopy = (from) => {
    const tag = from.localName.toLowerCase();
    const svg = from.namespaceURI === 'http://www.w3.org/2000/svg';
    if (svg ? !SVG_TAGS.has(tag) : !TAGS.has(tag)) return null;
    const to = svg ? D.createElementNS('http://www.w3.org/2000/svg', from.localName) : D.createElement(tag);
    for (const a of from.attributes) {
      const n = a.name.toLowerCase();
      if (/^on/.test(n)) continue;
      if (svg ? !(SVG_ATTRS.test(n) || n === 'class' || n === 'id' || /^(data|aria)-/.test(n) || n === 'role') : !(ATTRS.has(n) || /^(data|aria)-[a-z0-9-]+$/.test(n))) continue;
      if (URL_ATTRS.has(n) && (svg || !URL_TAGS[n].has(tag) || !urlOk(a.value))) continue;
      if (n === 'style' || (n === 'fill' && /url\(/i.test(a.value) && !cssOk(a.value))) continue;
      to.setAttribute(a.name, a.value);
    }
    for (const c of from.childNodes) {
      if (c.nodeType === 3) to.append(c.data);
      else if (c.nodeType === 1) { const k = safeCopy(c); if (k) to.append(k); }
    }
    return to;
  };

  // ---- what the mod gets
  const timers = harden({
    setTimeout: (fn, ms) => { if (typeof fn !== 'function') fail('setTimeout takes a function'); return setTimeout(() => fn(), Number(ms) || 0); },
    clearTimeout: (h) => clearTimeout(h),
    setInterval: (fn, ms) => { if (typeof fn !== 'function') fail('setInterval takes a function'); return setInterval(() => fn(), Math.max(4, Number(ms) || 0)); },
    clearInterval: (h) => clearInterval(h),
    onFrame: (fn) => { if (typeof fn !== 'function') fail('onFrame takes a function'); return requestAnimationFrame((t) => fn(t)); },
    cancelFrame: (h) => cancelAnimationFrame(h),
  });
  const page = harden({
    get url() { return location.href; },
    get title() { return D.title; },
    get width() { return innerWidth; },
    get height() { return innerHeight; },
    get root() { return wrap(D.documentElement); },
    get prefersReducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; },
    get body() { return wrap(D.body); },
    find: (sel) => wrap(D.querySelector(str(sel, 'a selector', 1000))),
    findAll: (sel) => harden([...D.querySelectorAll(str(sel, 'a selector', 1000))].map(wrap)),
    create(tag) {
      const t = str(tag, 'a tag', 40).toLowerCase();
      if (!TAGS.has(t)) fail(`<${t}> elements aren't offered`);
      return wrap(D.createElement(t));
    },
    css(text) {
      const t = str(text, 'CSS', 200000);
      if (!cssOk(t)) fail('that CSS loads from an address (only data: is allowed) or has escapes outside strings');
      const st = D.createElement('style');
      st.textContent = t;
      (D.head || D.documentElement).append(st);
      return harden({ remove: () => st.remove() });
    },
    // every element matching `sel`, now and as the page adds them
    observe(sel, fn) {
      str(sel, 'a selector', 1000);
      if (typeof fn !== 'function') fail('observe takes a function');
      const seen = new WeakSet();
      const run = (root) => {
        const list = root.nodeType === 1 && root.matches(sel) ? [root, ...realQSA(root, sel)] : root.querySelectorAll ? [...root.querySelectorAll(sel)] : [];
        for (const n of list) { if (seen.has(n)) continue; seen.add(n); try { fn(wrap(n)); } catch (err) { console.error('[TRIF]', modId, err); } }
      };
      run(D.documentElement);
      const mo = new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1) run(n); });
      mo.observe(D.documentElement, { childList: true, subtree: true });
      return harden(() => mo.disconnect());
    },
    on: (type, fn, opts) => listen(G, type, fn, opts),
  });
  const PREFIX = `trif.standin.${modId}.`;
  const trif = harden({
    log: (...a) => console.log('[TRIF]', modId, ...a),
    warn: (...a) => console.warn('[TRIF]', modId, ...a),
    error: (...a) => console.error('[TRIF]', modId, ...a),
    // the mod's own settings (namespaced, JSON): not the site's storage, which the mod can't reach
    settings(key, defaults = {}) {
      const k = PREFIX + str(key, 'a settings key', 100);
      let v;
      try { v = JSON.parse(localStorage.getItem(k) || 'null'); } catch { v = null; }
      const value = { ...JSON.parse(JSON.stringify(defaults)), ...(v && typeof v === 'object' ? v : {}) };
      return harden({ value: harden(value), save: (obj) => { localStorage.setItem(k, JSON.stringify(obj)); } });
    },
  });
  const endowments = { page, timers, trif, Math, Date };
  const c = new Compartment({ __options__: true, globals: endowments });
  try { c.evaluate(`(function () { "use strict";\n${source}\n})()`); } catch (err) { console.error('[TRIF]', modId, err); }
}

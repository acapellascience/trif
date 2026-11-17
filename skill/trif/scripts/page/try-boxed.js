// Try a boxed mod's code on the live page before you hand it over: a stand-in for TRIF's box, over the real page.
// Written for the TRIF skill (skill/src/scripts/page/try-boxed.js).
//
// Not TRIF's sandbox. TRIF runs a boxed mod in its own locked-down world, where the page can't reach it; this
// runs the mod's code in the page's own world with a copy of TRIF's API (references/boxed-mods.md) that refuses
// the same main things: names that aren't trif-box-, addresses that load something new, the page's own ids
// and classes, writing into editors. `window`, `document`, `fetch`, storage and the like read as undefined, as in
// the box (with the `with` line below). Powers aren't run: a mod asking for one gets an error saying so, except
// trif.filterResponse, whose function is kept so you can run it on recorded data (references/live-test.md).
// scripts/check-mod.js is what tells you what the real sandbox would refuse.
//
// Paste all of this into the page (it lasts until undo() or a reload), then:
//   await __trifBox.run(async function (trif, page) { with (__trifBox.scope) {
//     /* the mod's code below its header (and style section), as it is */
//   }}, { style: { width: 700 } })        // the style section's values, if it has one (its CSS: try-style.js)
//   await __trifBox.report()              what it did: errors, logs, what it changed, what was refused
//   __trifBox.undo()                      the page back as it was (timers and observers stopped)
//   __trifBox.checkFilter(before, after)  for site-data: does `after` only remove or reorder what `before` had?
(() => {
  if (window.__trifBox) { try { window.__trifBox.undo(); } catch { /* a page that changed it */ } }
  const W = window;
  const D = document;
  const st = {
    dead: false, errors: [], logs: [], refused: [], undo: [], created: new Set(), observers: [], timers: new Set(),
    intervals: new Set(), frames: new Set(), listeners: [], animations: [], filters: [], counts: { hidden: 0, attrs: 0, classes: 0, styles: 0, texts: 0, inserted: 0, removed: 0, css: 0 },
  };
  const clip = (s, n = 200) => { s = String(s); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  const show = (a) => { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch { return String(a); } };
  const log = (level, args) => { st.logs.push(clip(`${level}: ${args.map(show).join(' ')}`)); if (st.logs.length > 100) st.logs.shift(); };
  const refuse = (what) => { const m = `TRIF's box refuses this: ${what}`; if (st.refused.length < 50) st.refused.push(m); throw new Error(m); };
  const later = (fn) => { st.undo.push(fn); };
  const caught = (fn) => function () { if (st.dead) return undefined; try { return fn.apply(this, arguments); } catch (e) { st.errors.push(clip(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : String(e))); return undefined; } };

  // ---- what loads nothing new (BOXED.md: url() only data:, #…, or what the page already uses)
  const pageUrls = () => new Set([...D.querySelectorAll('img[src]')].map((i) => i.src).concat([...D.querySelectorAll('a[href]')].map((a) => a.href)));
  const loadsNothing = (css) => {
    const urls = [...String(css).matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((m) => m[2]);
    const known = urls.length ? pageUrls() : null;
    for (const u of urls) if (!/^data:/i.test(u) && !u.startsWith('#') && !known.has(new URL(u, location.href).href)) refuse(`url(${clip(u, 60)}) loads something new: use data: or what the page already shows`);
    if (/@import|image-set\(|(?:^|[^-\w])src\(/i.test(css)) refuse('@import, image-set() and src() load from elsewhere');
  };
  const own = (name) => /^trif-box-[\w-]*$/.test(name);

  // ---- element stand-ins
  const boxes = new WeakMap();
  const wrap = (n) => { if (!n || n.nodeType !== 1) return null; let b = boxes.get(n); if (!b) { b = new Box(n); boxes.set(n, b); } return b; };
  const real = (x) => (x instanceof Box ? x._el : null);
  const inEditor = (el) => !!(el.isContentEditable || (el.closest && el.closest('[contenteditable]:not([contenteditable=false])')));
  const isField = (el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  const noteAttr = (el, name) => { const had = el.hasAttribute(name); const v = el.getAttribute(name); later(() => { if (had) el.setAttribute(name, v); else el.removeAttribute(name); }); };
  const noteStyle = (el, prop) => { const v = el.style.getPropertyValue(prop); const p = el.style.getPropertyPriority(prop); later(() => { el.style.removeProperty(prop); if (v) el.style.setProperty(prop, v, p); }); };
  const noteChildren = (el) => { const kids = [...el.childNodes]; later(() => { el.replaceChildren(...kids); }); };
  const noteMove = (n) => { const parent = n.parentNode; const next = n.nextSibling; later(() => { if (st.created.has(n)) { n.remove(); return; } if (parent) parent.insertBefore(n, next && next.parentNode === parent ? next : null); }); };
  const toNode = (x) => { if (typeof x === 'string' || typeof x === 'number') return D.createTextNode(String(x)); const n = real(x); if (!n) refuse('append and the like take stand-ins or text'); return n; };
  const ATTR = /^(title|role|hidden|alt|width|height|aria-[\w-]+|data-trif-box-[\w-]+)$/;
  const plainEvent = (e, target) => {
    const field = e.target && e.target.nodeType === 1 && (isField(e.target) || inEditor(e.target) || /^(DIV|SPAN|ARTICLE)$/.test(e.target.tagName) || e.target.tagName.includes('-'));
    const keyed = /^key/.test(e.type);
    return {
      type: e.type, key: keyed && field ? null : e.key, code: keyed && field ? null : e.code, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
      x: e.clientX, y: e.clientY, deltaX: e.deltaX, deltaY: e.deltaY, button: e.button, buttons: e.buttons, pointerId: e.pointerId, pointerType: e.pointerType,
      animationName: e.animationName, propertyName: e.propertyName, elapsedTime: e.elapsedTime, target: wrap(e.target) || target || null,
      preventDefault: () => e.preventDefault(),
      stopPropagation: () => { if (st.created.has(e.currentTarget)) e.stopPropagation(); else refuse('stopping the page\'s own events is the block-events power'); },
      stopImmediatePropagation: () => { if (st.created.has(e.currentTarget)) e.stopImmediatePropagation(); else refuse('stopping the page\'s own events is the block-events power'); },
    };
  };
  const listen = (on, type, fn, opts, target) => {
    const h = caught((e) => fn(plainEvent(e, target)));
    on.addEventListener(type, h, { passive: !(opts && opts.preventDefault), capture: !!(opts && opts.capture) });
    st.listeners.push([on, type, h, !!(opts && opts.capture)]);
  };

  class Box {
    constructor(el) { this._el = el; }
    get tag() { return this._el.tagName.toLowerCase(); }
    get text() { return inEditor(this._el) ? '' : this._el.textContent; }
    get innerText() { return inEditor(this._el) ? '' : this._el.innerText; }
    setText(t) { const el = this._el; if (inEditor(el)) refuse('writing into an editor (the user\'s)'); if (isField(el)) refuse('the page\'s fields are the user\'s'); noteChildren(el); el.textContent = String(t); st.counts.texts++; }
    attr(name) { if (/^value$/i.test(name) && isField(this._el)) return null; return this._el.getAttribute(name); }
    setAttr(name, value) {
      const el = this._el;
      const n = String(name).toLowerCase();
      const v = String(value);
      const ok = ATTR.test(n) || ((n === 'id' || n === 'class') && v.split(/\s+/).every(own)) || (n === 'open' && el.tagName === 'DETAILS')
        || (n === 'datetime' && el.tagName === 'TIME') || (n === 'placeholder' && /^(INPUT|TEXTAREA)$/.test(el.tagName))
        || (/^(value|min|max|low|high|optimum)$/.test(n) && el.tagName === 'METER')
        || (n === 'href' && (v.startsWith('#') || pageUrls().has(new URL(v, location.href).href)))
        || (n === 'src' && (/^(data|blob):/i.test(v) || [...D.images].some((i) => i.src === new URL(v, location.href).href)));
      if (!ok) refuse(`setAttr("${clip(n, 40)}", …): names it may set are title, role, hidden, alt, sizes, aria-*, data-trif-box-*, a trif-box- id or class, and a few per tag (references/boxed-mods.md)`);
      if (inEditor(el)) refuse('attributes inside an editor');
      noteAttr(el, n); el.setAttribute(n, v); st.counts.attrs++;
    }
    removeAttr(name) { const n = String(name).toLowerCase(); if (!ATTR.test(n)) refuse(`removeAttr("${clip(n, 40)}")`); noteAttr(this._el, n); this._el.removeAttribute(n); st.counts.attrs++; }
    get classes() {
      const el = this._el;
      const change = (c, add) => { if (!own(c)) refuse(`class "${clip(c, 40)}": a boxed mod's classes start trif-box-`); const had = el.classList.contains(c); later(() => el.classList.toggle(c, had)); el.classList.toggle(c, add); st.counts.classes++; };
      return { add: (...cs) => cs.forEach((c) => change(c, true)), remove: (...cs) => cs.forEach((c) => change(c, false)), toggle: (c, f) => change(c, f === undefined ? !el.classList.contains(c) : !!f), has: (c) => el.classList.contains(c) };
    }
    style(prop, value) {
      if (value === undefined) return getComputedStyle(this._el).getPropertyValue(prop);
      let v = String(value);
      let pri = '';
      if (/!important\s*$/.test(v)) { pri = 'important'; v = v.replace(/!important\s*$/, '').trim(); }
      loadsNothing(v);
      noteStyle(this._el, prop); this._el.style.setProperty(prop, v, pri); st.counts.styles++;
      return undefined;
    }
    inlineStyle(prop) { return this._el.style.getPropertyValue(prop); }
    hide() { noteStyle(this._el, 'display'); this._el.style.setProperty('display', 'none', 'important'); st.counts.hidden++; }
    show() { noteStyle(this._el, 'display'); this._el.style.removeProperty('display'); }
    find(sel) { return wrap(this._el.querySelector(sel)); }
    findAll(sel) { return [...this._el.querySelectorAll(sel)].map(wrap); }
    closest(sel) { return wrap(this._el.closest(sel)); }
    matches(sel) { return this._el.matches(sel); }
    get parent() { return wrap(this._el.parentElement); }
    get children() { return [...this._el.children].map(wrap); }
    get next() { return wrap(this._el.nextElementSibling); }
    get previous() { return wrap(this._el.previousElementSibling); }
    _put(how, items) {
      const el = this._el;
      if (inEditor(el) && !st.created.has(el)) refuse('adding inside an editor');
      for (const x of items) { const n = toNode(x); if (n.nodeType === 1 && isField(n) && !st.created.has(n)) refuse('the page\'s fields stay where they are'); noteMove(n); el[how](n); st.counts.inserted++; }
    }
    append(...x) { this._put('append', x); }
    prepend(...x) { this._put('prepend', x); }
    before(...x) { this._put('before', x); }
    after(...x) { this._put('after', x); }
    remove() { const el = this._el; if (isField(el) && !st.created.has(el)) refuse('the page\'s fields can\'t be removed (hide() them)'); noteMove(el); el.remove(); st.counts.removed++; }
    clone() {
      const c = this._el.cloneNode(true);
      for (const n of [c, ...c.querySelectorAll('*')]) for (const a of [...n.attributes]) if (/^(id|class)$/.test(a.name) ? !a.value.split(/\s+/).every(own) : /^(on|data-(?!trif-box-))/.test(a.name) || a.name === 'style') n.removeAttribute(a.name);
      st.created.add(c);
      return wrap(c);
    }
    rect() { const r = this._el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom }; }
    get offsetWidth() { return this._el.offsetWidth; }
    get offsetHeight() { return this._el.offsetHeight; }
    get offsetTop() { return this._el.offsetTop; }
    get offsetLeft() { return this._el.offsetLeft; }
    get clientWidth() { return this._el.clientWidth; }
    get clientHeight() { return this._el.clientHeight; }
    get scrollWidth() { return this._el.scrollWidth; }
    get scrollHeight() { return this._el.scrollHeight; }
    get scrollTop() { return this._el.scrollTop; }
    get scrollLeft() { return this._el.scrollLeft; }
    get value() { if (st.created.has(this._el)) return this._el.value; return refuse('what the user types in the page\'s fields is the read-drafts power'); }
    on(type, fn, opts) { listen(this._el, type, fn, opts, this); }
    onResize(fn) { const o = new ResizeObserver(caught((es) => { for (const e of es) fn({ width: e.contentRect.width, height: e.contentRect.height }); })); o.observe(this._el); st.observers.push(o); }
    onVisible(fn, opts) { const o = new IntersectionObserver(caught((es) => { for (const e of es) fn({ visible: e.isIntersecting, ratio: e.intersectionRatio, x: e.boundingClientRect.x, y: e.boundingClientRect.y, width: e.boundingClientRect.width, height: e.boundingClientRect.height }); }), opts); o.observe(this._el); st.observers.push(o); }
    animate(keyframes, timing) { loadsNothing(JSON.stringify(keyframes)); const a = this._el.animate(keyframes, timing); st.animations.push(a); return a; }
    focus() { if (!st.created.has(this._el)) refuse('focus() is for the mod\'s own elements'); this._el.focus(); }
    blur() { this._el.blur(); }
    canvas() { if (this._el.tagName !== 'CANVAS' || !st.created.has(this._el)) refuse('canvas() is for a <canvas> the mod made'); const c = this._el.getContext('2d'); c.set = (o) => { for (const [k, v] of Object.entries(o)) { loadsNothing(String(v)); c[k] = v; } }; return c; }
  }

  // ---- page
  const TAGS = new Set('div span p a button img ul ol li dl dt dd h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th caption canvas output meter abbr time small strong em b i u s mark code pre kbd sup sub br hr section header footer nav aside figure figcaption details summary label blockquote q cite'.split(' '));
  const CONTROLS = new Set(['input', 'select', 'option']);
  const SVG = new Set('svg g path circle ellipse rect line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask use pattern title desc'.split(' '));
  let powers = [];
  const made = (n) => { st.created.add(n); return wrap(n); };
  const page = {
    find: (sel) => wrap(D.querySelector(sel)),
    findAll: (sel) => [...D.querySelectorAll(sel)].map(wrap),
    create: (tag) => { const t = String(tag).toLowerCase(); if (CONTROLS.has(t) && !powers.includes('controls')) refuse(`<${t}> is the controls power`); if (!TAGS.has(t) && !CONTROLS.has(t)) refuse(`<${clip(t, 30)}> isn't a tag a boxed mod can make`); const n = D.createElement(t); if (t === 'button') n.type = 'button'; return made(n); },
    createSvg: (tag) => { if (!SVG.has(String(tag))) refuse(`<${clip(tag, 30)}> isn't an SVG tag a boxed mod can make`); return made(D.createElementNS('http://www.w3.org/2000/svg', String(tag))); },
    on: (type, fn, opts) => listen(W, type, fn, opts, null),
    get url() { return location.href; },
    get title() { return D.title; },
    get width() { return W.innerWidth; },
    get height() { return W.innerHeight; },
    get scrollX() { return W.scrollX; },
    get scrollY() { return W.scrollY; },
    get root() { return wrap(D.documentElement); },
    get body() { return wrap(D.body); },
    get prefersReducedMotion() { return W.matchMedia('(prefers-reduced-motion: reduce)').matches; },
    get prefersDark() { return W.matchMedia('(prefers-color-scheme: dark)').matches; },
    get devicePixelRatio() { return W.devicePixelRatio; },
    get visibilityState() { return D.visibilityState; },
    get hidden() { return D.hidden; },
    matchMedia: (q) => { const m = W.matchMedia(q); return { get matches() { return m.matches; }, onChange: (fn) => { const h = caught(() => fn({ matches: m.matches })); m.addEventListener('change', h); st.listeners.push([m, 'change', h, false]); } }; },
    elementFromPoint: (x, y) => wrap(D.elementFromPoint(x, y)),
    elementsFromPoint: (x, y) => D.elementsFromPoint(x, y).map(wrap),
    styleSheets: () => [...D.styleSheets].map((s) => { try { return { href: s.href, readable: true, rules: [...s.cssRules].slice(0, 2000).map((r) => ({ selector: r.selectorText || null, text: r.cssText, media: r.media ? r.media.mediaText : null })) }; } catch { return { href: s.href, readable: false, rules: [] }; } }),
  };

  // ---- trif
  const addCss = (text) => {
    loadsNothing(text);
    const s = D.createElement('style');
    s.setAttribute('data-trif-box-try', '');
    s.textContent = String(text);
    (D.head || D.documentElement).append(s);
    let sheet = null;
    if (!(s.sheet && s.sheet.cssRules.length) && /\{/.test(text)) { try { sheet = new CSSStyleSheet(); sheet.replaceSync(String(text)); D.adoptedStyleSheets = [...D.adoptedStyleSheets, sheet]; } catch { sheet = null; } }
    const remove = () => { s.remove(); if (sheet) D.adoptedStyleSheets = D.adoptedStyleSheets.filter((x) => x !== sheet); };
    later(remove);
    st.counts.css++;
    return { remove };
  };
  const watch = (fn, opts) => { const o = new MutationObserver(caught(fn)); o.observe(D.documentElement, opts); st.observers.push(o); return () => o.disconnect(); };
  const timer = (set, clear, bag) => (fn, ms, ...a) => { if (typeof fn !== 'function') refuse('timers take functions, not text'); const id = set(caught(() => { if (bag === st.timers) bag.delete(id); fn(...a); }), ms); bag.add(id); return id; };
  const settings = new Map();
  const power = (name, p) => () => refuse(`trif.${name} is the ${p} power: this stand-in doesn't run powers; test its logic on its own (references/live-test.md)`);
  const textNodes = (root) => { const w = D.createTreeWalker(root, NodeFilter.SHOW_TEXT); const out = []; for (let n = w.nextNode(); n; n = w.nextNode()) { const p = n.parentElement; if (p && !p.closest('script,style,textarea,input,select') && !inEditor(p)) out.push(n); } return out; };
  const trif = {
    css: (text) => addCss(text),
    hide: (sel) => addCss(`${sel} { display: none !important; }`),
    observe: (sel, fn, opts) => {
      const seen = new WeakSet();
      const each = (el) => { if (!seen.has(el)) { seen.add(el); caught(() => fn(wrap(el), {}))(); } };
      for (const el of D.querySelectorAll(sel)) each(el);
      const attrs = opts && Array.isArray(opts.attributes) ? opts.attributes.filter((a) => a !== 'value') : null;
      return watch((list) => {
        for (const m of list) {
          if (m.type === 'attributes') { if (m.target.matches && m.target.matches(sel)) caught(() => fn(wrap(m.target), { attribute: m.attributeName }))(); continue; }
          for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches(sel)) each(n); for (const el of n.querySelectorAll(sel)) each(el); }
        }
      }, { childList: true, subtree: true, ...(attrs && attrs.length ? { attributes: true, attributeFilter: attrs } : {}) });
    },
    changes: (sel, fn) => watch((list) => { const hit = new Set(); for (const m of list) { const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; const el = t && t.closest(sel); if (el && !inEditor(el)) hit.add(el); } if (hit.size) fn([...hit].map(wrap)); }, { childList: true, subtree: true, characterData: true }),
    text: (sel, fn) => {
      const done = new WeakMap();
      const pass = () => { for (const root of D.querySelectorAll(sel)) for (const n of textNodes(root)) { if (done.get(n) === n.data) continue; const was = n.data; const now = String(fn(was)); if (now !== was) { later(() => { if (n.isConnected) n.data = was; }); n.data = now; st.counts.texts++; } done.set(n, n.data); } };
      pass();
      return watch(pass, { childList: true, subtree: true, characterData: true });
    },
    wrap: (sel, re, fn) => {
      if (!(re instanceof RegExp) || re.source.length > 200) refuse('wrap takes a pattern up to 200 characters');
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      const pass = () => {
        for (const root of D.querySelectorAll(sel)) for (const n of textNodes(root)) {
          if (!n.data || n.parentElement.closest('[data-trif-box-try-wrap]')) continue;
          const parts = []; let last = 0; let m; g.lastIndex = 0;
          while ((m = g.exec(n.data))) { if (!m[0]) { g.lastIndex++; continue; } parts.push(n.data.slice(last, m.index), fn(m[0], m.slice(1))); last = m.index + m[0].length; }
          if (!parts.length) continue;
          parts.push(n.data.slice(last));
          const span = D.createElement('span'); span.setAttribute('data-trif-box-try-wrap', ''); st.created.add(span);
          for (const p of parts) if (p !== '' && p != null) span.append(toNode(p));
          const was = n.data; n.parentNode.insertBefore(span, n); n.data = '';
          later(() => { span.remove(); n.data = was; });
          st.counts.texts++;
        }
      };
      pass();
      return watch(pass, { childList: true, subtree: true });
    },
    onUrl: (fn) => { let at = location.href; caught(() => fn(at))(); const id = W.setInterval(caught(() => { if (location.href !== at) { at = location.href; fn(at); } }), 400); st.intervals.add(id); },
    ready: D.readyState === 'loading' ? new Promise((r) => D.addEventListener('DOMContentLoaded', r, { once: true })) : Promise.resolve(),
    loaded: D.readyState === 'complete' ? Promise.resolve() : new Promise((r) => W.addEventListener('load', r, { once: true })),
    settings: async (key, defaults) => { const k = String(key); if (!settings.has(k)) settings.set(k, structuredClone(defaults === undefined ? {} : defaults)); return { value: settings.get(k), save: async (v) => { settings.set(k, structuredClone(v)); } }; },
    style: Object.freeze({}),
    log: (...a) => log('log', a), warn: (...a) => log('warn', a), error: (...a) => log('error', a),
    filterResponse: (glob, fn) => { if (!powers.includes('site-data')) refuse('trif.filterResponse is the site-data power (// @powers site-data)'); st.filters.push({ glob: String(glob), fn }); },
    audio: power('audio', 'sound'), searchBox: power('searchBox', 'search-box'), channel: power('channel', 'mods'), block: power('block', 'block-events'),
    signal: power('signal', 'page-events'), storage: power('storage', 'site-storage'), goTo: power('goTo', 'go-to'), reload: power('reload', 'go-to'),
    imageVariant: power('imageVariant', 'image-variants'), onUpload: power('onUpload', 'edit-uploads'), embed: power('embed', 'embeds'), localFonts: power('localFonts', 'local-fonts'),
    filterEmbedded: power('filterEmbedded', 'site-data'), filterGlobal: power('filterGlobal', 'site-data'),
  };

  // ---- what the box doesn't have reads as undefined (the `with (__trifBox.scope)` line); timers are tracked
  const tracked = {
    setTimeout: timer(W.setTimeout.bind(W), W.clearTimeout.bind(W), st.timers),
    setInterval: timer(W.setInterval.bind(W), W.clearInterval.bind(W), st.intervals),
    clearTimeout: (id) => { st.timers.delete(id); W.clearTimeout(id); },
    clearInterval: (id) => { st.intervals.delete(id); W.clearInterval(id); },
    requestAnimationFrame: (fn) => { if (typeof fn !== 'function') refuse('requestAnimationFrame takes a function'); const id = W.requestAnimationFrame(caught((t) => { st.frames.delete(id); fn(t); })); st.frames.add(id); return id; },
    cancelAnimationFrame: (id) => { st.frames.delete(id); W.cancelAnimationFrame(id); },
    console: { log: (...a) => log('log', a), info: (...a) => log('log', a), debug: (...a) => log('log', a), warn: (...a) => log('warn', a), error: (...a) => log('error', a) },
    performance: Object.freeze({ now: () => W.performance.now() }),
  };
  const ABSENT = new Set('window document globalThis self top parent frames opener fetch XMLHttpRequest WebSocket EventSource sendBeacon navigator location history localStorage sessionStorage indexedDB caches cookieStore crypto chrome browser eval Function importScripts open close postMessage alert confirm prompt print Image Audio Worker SharedWorker ServiceWorker BroadcastChannel MessageChannel FileReader Blob File FormData Request Response Headers HTMLElement Element Node MutationObserver ResizeObserver IntersectionObserver CustomEvent Event KeyboardEvent MouseEvent getComputedStyle'.split(' '));
  const scope = new Proxy({}, {
    has: (o, k) => typeof k === 'string' && (ABSENT.has(k) || Object.prototype.hasOwnProperty.call(tracked, k)),
    get: (o, k) => (k === Symbol.unscopables ? undefined : Object.prototype.hasOwnProperty.call(tracked, k) ? tracked[k] : undefined),
    set: (o, k) => refuse(`setting ${String(k)}`),
  });

  async function run(fn, opts = {}) {
    if (typeof fn !== 'function') throw new Error('run(async function (trif, page) { with (__trifBox.scope) { …the mod… } })');
    st.dead = false;
    powers = Array.isArray(opts.powers) ? opts.powers.map(String) : [];
    trif.style = Object.freeze({ ...(opts.style || {}) });
    try { await fn(trif, page); } catch (e) { st.errors.push(clip(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : String(e))); }
    return report();
  }

  async function report() {
    await new Promise((r) => W.setTimeout(r, 300));
    return {
      ok: !st.errors.length && !st.refused.length, errors: st.errors.slice(0, 10), refused: [...new Set(st.refused)].slice(0, 10), logs: st.logs.slice(-20),
      changed: { ...st.counts }, made: st.created.size, observers: st.observers.length, timers: st.timers.size + st.intervals.size + st.frames.size,
      filters: st.filters.map((f) => f.glob),
    };
  }

  function undo() {
    st.dead = true;
    for (const o of st.observers.splice(0)) o.disconnect();
    for (const id of st.timers) W.clearTimeout(id);
    for (const id of st.intervals) W.clearInterval(id);
    for (const id of st.frames) W.cancelAnimationFrame(id);
    for (const [on, type, h, capture] of st.listeners.splice(0)) on.removeEventListener(type, h, capture);
    for (const a of st.animations.splice(0)) { try { a.cancel(); } catch { /* gone */ } }
    const n = st.undo.length;
    for (const fn of st.undo.splice(0).reverse()) { try { fn(); } catch { /* the page moved on */ } }
    for (const el of st.created) if (el.isConnected) el.remove();
    return { undone: n, left: D.querySelectorAll('[data-trif-box-try], [data-trif-box-try-wrap]').length };
  }

  /** site-data's rule (BOXED.md): every string, number and boolean in `after`, and every key, was in `before`, no more times. */
  function checkFilter(before, after) {
    const count = (v, m) => { if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) m.set(`key:${k}`, (m.get(`key:${k}`) || 0) + 1); count(x, m); } } else if (v !== null && v !== undefined) { const k = `${typeof v}:${v}`; m.set(k, (m.get(k) || 0) + 1); } return m; };
    const had = count(before, new Map());
    const has = count(after, new Map());
    const extra = [...has].filter(([k, n]) => n > (had.get(k) || 0)).map(([k]) => clip(k, 80));
    return extra.length ? { ok: false, added: extra.slice(0, 10), why: 'TRIF would keep the original response: a filter may only remove or reorder' } : { ok: true };
  }

  window.__trifBox = { run, report, undo, checkFilter, scope, get filters() { return st.filters.slice(); } };
  return 'try-boxed ready: await __trifBox.run(async function (trif, page) { with (__trifBox.scope) { …the mod… } }, { style, powers })';
})();

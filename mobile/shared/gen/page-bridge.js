// Made by mobile/prepare.js from extension/runtime.js (pageBridge) and mobile/shared/modfile.js (matchesUrl): don't edit.
(function (mods) {
function matchesUrl(url, patterns) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  return (patterns || []).some((p) => {
    if (p === '<all_urls>') return /^https?:$/.test(u.protocol);
    const m = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(p);
    if (!m) return false;
    if (m[1] !== '*' && u.protocol !== `${m[1]}:`) return false;
    if (m[1] === '*' && !/^https?:$/.test(u.protocol)) return false;
    const host = m[2];
    if (host !== '*') {
      if (host.startsWith('*.')) { const base = host.slice(2); if (u.hostname !== base && !u.hostname.endsWith(`.${base}`)) return false; }
      else if (u.hostname !== host) return false;
    }
    const path = new RegExp(`^${m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return path.test(u.pathname + u.search);
  });
}
if (!mods.some((x) => matchesUrl(location.href, x[0]) && !matchesUrl(location.href, x[1]))) return;
try { (function pageBridge() {
  if (window.__trifBridge) return;
  Object.defineProperty(window, '__trifBridge', { value: true });
  const MAX = 5 * 1024 * 1024;
  let globs = [];
  let answer = null;
  const ask = (type, detail, target) => {
    answer = null;
    (target || document).dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    const a = answer; answer = null; return a;
  };
  document.addEventListener('trif:filter-response', (e) => { if (typeof e.detail === 'string') answer = e.detail; }, true);
  document.addEventListener('trif:page-data-answer', (e) => { if (typeof e.detail === 'string') answer = e.detail; }, true);
  const matches = (url) => globs.some((re) => re.test(url));
  const filterText = (url, method, status, text) => {
    // (JSON, or JSON behind a guard (for (;;); and the like), or several documents one after another)
    if (typeof text !== 'string' || text.length > MAX || !/^\s*([[{]|for\s*\(|while\s*\(|\)\]\}')/.test(text)) return text;
    const out = ask('trif:filter-request', JSON.stringify({ url, method, status, text }));
    return typeof out === 'string' ? out : text;
  };
  let wrapped = false;
  const wrap = () => {
    if (wrapped) return;
    wrapped = true;
    const f0 = window.fetch;
    if (typeof f0 === 'function') {
      window.fetch = async function fetch(input, init) {
        const res = await f0.apply(this, arguments);
        try {
          const url = res.url || (typeof input === 'string' ? new URL(input, location.href).href : input && input.url) || '';
          if (!matches(url)) return res;
          const text = await res.clone().text();
          const out = filterText(url, (init && init.method) || (input && input.method) || 'GET', res.status, text);
          if (out === text) return res;
          const r2 = new Response(out, { status: res.status, statusText: res.statusText, headers: res.headers });
          try { Object.defineProperty(r2, 'url', { value: res.url }); } catch (e) { /* kept */ }
          return r2;
        } catch (e) { return res; }
      };
    }
    const X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (X) {
      const urls = new WeakMap(), done = new WeakMap();
      const open = X.open;
      X.open = function (method, url) { try { urls.set(this, { method: String(method), url: new URL(String(url), location.href).href }); } catch (e) { /* not ours */ } return open.apply(this, arguments); };
      const textGet = Object.getOwnPropertyDescriptor(X, 'responseText').get;
      const respGet = Object.getOwnPropertyDescriptor(X, 'response').get;
      const filtered = (xhr) => {
        if (done.has(xhr)) return done.get(xhr);
        const u = urls.get(xhr);
        if (!u || xhr.readyState !== 4 || !matches(u.url)) return null;
        const t = textGet.call(xhr);
        const out = filterText(u.url, u.method, xhr.status, t);
        done.set(xhr, out);
        return out;
      };
      Object.defineProperty(X, 'responseText', { configurable: true, get() { if (this.responseType && this.responseType !== 'text') return textGet.call(this); const f = filtered(this); return f === null ? textGet.call(this) : f; } });
      Object.defineProperty(X, 'response', { configurable: true, get() {
        const rt = this.responseType;
        if (rt === '' || rt === 'text') { const f = filtered(this); return f === null ? respGet.call(this) : f; }
        if (rt === 'json' && this.readyState === 4 && urls.has(this) && matches(urls.get(this).url)) {
          // (a json response: filtered as text, from the original's JSON)
          if (!done.has(this)) { const orig = respGet.call(this); const t = orig === null ? null : JSON.stringify(orig); done.set(this, t === null ? null : filterText(urls.get(this).url, urls.get(this).method, this.status, t)); }
          const f = done.get(this); try { return f === null ? respGet.call(this) : JSON.parse(f); } catch (e) { return respGet.call(this); }
        }
        return respGet.call(this);
      } });
    }
  };
  const glob = (g) => new RegExp('^' + String(g).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  document.addEventListener('trif:filter-patterns', (e) => {
    try { const list = JSON.parse(String(e.detail)); if (Array.isArray(list) && list.length) { globs = list.slice(0, 50).map(glob); wrap(); } } catch (err) { /* ignore */ }
  }, true);

  // trif.onUrl: the page's own history moves, as a signal with nothing in it (the boxed mod reads page.url)
  for (const k of ['pushState', 'replaceState']) {
    try {
      const f = history[k];
      if (typeof f !== 'function') continue;
      history[k] = function () { const r = f.apply(this, arguments); try { document.dispatchEvent(new CustomEvent('trif:url')); } catch (e) { /* none */ } return r; };
    } catch (e) { /* kept as it was */ }
  }
  // trif.css with { shadow }: the roots the page makes (closed ones too), kept as they're made, so a boxed mod's
  // sheet (checked in TRIF's sandbox world, sent as text: trif:shadow-css) goes into those under hosts that
  // match, now and later; adopted, so the page writing its root's content keeps it. The roots never leave here.
  // (and inside other roots, at any depth: each root found is watched too, for hosts that come into it later)
  const roots = new WeakMap(); // host -> its root
  const shadowSheets = new Map(); // id -> { sel, sheet }
  const watchedRoots = new WeakSet();
  let shadowMo = null;
  const rootOf = (h) => roots.get(h) || h.shadowRoot;
  // every host with a root under `top` (a document or a root), roots inside roots too: fn(host, root)
  const eachRoot = (top, fn, depth = 0) => {
    if (depth > 30) return;
    let all;
    try { all = top.querySelectorAll('*'); } catch (e) { return; }
    for (const h of all) { const r = rootOf(h); if (r) { fn(h, r); eachRoot(r, fn, depth + 1); } }
  };
  const watchRoot = (root) => { if (shadowMo && !watchedRoots.has(root)) { watchedRoots.add(root); try { shadowMo.observe(root, { childList: true, subtree: true }); } catch (e) { /* none */ } } };
  const adopt = (host) => {
    const root = rootOf(host);
    if (!root || !('adoptedStyleSheets' in root)) return;
    watchRoot(root);
    for (const sh of shadowSheets.values()) {
      let m = false;
      try { m = host.matches(sh.sel); } catch (e) { m = false; }
      if (m && !root.adoptedStyleSheets.includes(sh.sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sh.sheet];
    }
  };
  try {
    const as = Element.prototype.attachShadow;
    if (typeof as === 'function') {
      Element.prototype.attachShadow = function attachShadow() {
        const root = as.apply(this, arguments);
        try { roots.set(this, root); if (shadowSheets.size) adopt(this); } catch (e) { /* none */ }
        return root;
      };
    }
  } catch (e) { /* kept as it was */ }
  document.addEventListener('trif:shadow-css', (e) => {
    let o;
    try { o = JSON.parse(String(e.detail)); } catch (err) { return; }
    if (!o || typeof o.id !== 'string') return;
    if (o.remove) {
      const sh = shadowSheets.get(o.id);
      shadowSheets.delete(o.id);
      if (sh) eachRoot(document, (h, r) => { if (r.adoptedStyleSheets && r.adoptedStyleSheets.includes(sh.sheet)) r.adoptedStyleSheets = r.adoptedStyleSheets.filter((x) => x !== sh.sheet); });
      return;
    }
    if (typeof o.sel !== 'string' || typeof o.text !== 'string' || shadowSheets.has(o.id)) return;
    let sheet;
    try { sheet = new CSSStyleSheet(); sheet.replaceSync(o.text); } catch (err) { return; }
    shadowSheets.set(o.id, { sel: o.sel, sheet });
    if (!shadowMo && document.documentElement) {
      shadowMo = new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1) { adopt(n); eachRoot(n, (h) => adopt(h)); } });
      shadowMo.observe(document.documentElement, { childList: true, subtree: true });
    }
    eachRoot(document, (h) => adopt(h));
  }, true);

  // page-data
  const plain = (v, depth, seen, budget) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'object' || depth > 8 || budget.n-- <= 0) return undefined;
    if (seen.has(v)) return undefined;
    if (typeof v.nodeType === 'number' || v === window || (typeof v.$$typeof === 'symbol' && v.$$typeof.toString() !== 'Symbol(react.element)')) return undefined;
    seen.add(v);
    try {
      if (Array.isArray(v)) return v.slice(0, 500).map((x) => { const y = plain(x, depth + 1, seen, budget); return y === undefined ? null : y; });
      const out = {};
      for (const k of Object.keys(v).slice(0, 300)) {
        if (k === '_owner' || k === 'stateNode' || k === '_store') continue;
        let x; try { x = v[k]; } catch (e) { continue; }
        if (typeof x === 'function' || typeof x === 'symbol') continue;
        const y = plain(x, depth + 1, seen, budget);
        if (y !== undefined) out[k] = y;
      }
      return out;
    } finally { seen.delete(v); }
  };
  document.addEventListener('trif:page-data', (e) => {
    try {
      const el = e.composedPath ? e.composedPath()[0] : e.target;
      if (!el || el.nodeType !== 1) return;
      const key = (pre) => Object.keys(el).find((k) => k.startsWith(pre));
      const fk = key('__reactFiber$') || key('__reactInternalInstance$');
      const pk = key('__reactProps$');
      let v = { props: pk ? el[pk] : null, fiber: fk ? el[fk] : null };
      for (const seg of String(e.detail || '').split('.').filter(Boolean).slice(0, 40)) {
        if (v === null || v === undefined || typeof v !== 'object') { v = null; break; }
        v = v[seg];
      }
      const json = JSON.stringify(plain(v === undefined ? null : v, 0, new Set(), { n: 5000 }));
      document.dispatchEvent(new CustomEvent('trif:page-data-answer', { detail: json && json.length <= 1024 * 1024 ? json : 'null' }));
    } catch (err) { /* no answer: null */ }
  }, true);
  // site-data's data globals (trif.filterGlobal): each declared name, filtered as the page sets it, as JSON
  // through the same check as a response (trif:filter-request, with the address global:<name>)
  document.addEventListener('trif:filter-globals', (e) => {
    let names;
    try { names = JSON.parse(String(e.detail)); } catch (err) { return; }
    for (const name of Array.isArray(names) ? names.slice(0, 20) : []) {
      if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]{0,60}$/.test(name) || Object.prototype.hasOwnProperty.call(window, name)) continue;
      let v;
      try {
        Object.defineProperty(window, name, {
          configurable: true, enumerable: true, get() { return v; },
          set(x) {
            v = x;
            try { const text = JSON.stringify(x); if (typeof text !== 'string' || text.length > MAX) return; const out = ask('trif:filter-request', JSON.stringify({ url: `global:${name}`, method: 'GLOBAL', status: 0, text })); if (typeof out === 'string') v = JSON.parse(out); } catch (err) { v = x; }
          },
        });
      } catch (err) { /* the page's own */ }
    }
  }, true);
  // page-events (trif.signal): a declared signal, sent here as text, dispatched to the page's own code on the
  // document (never one of TRIF's own)
  document.addEventListener('trif:page-event', (e) => {
    try {
      const o = JSON.parse(String(e.detail));
      if (!o || typeof o.name !== 'string' || !/^[a-z][\w.]*[-:][\w.:-]*$/i.test(o.name) || /^trif:/i.test(o.name)) return;
      document.dispatchEvent(new CustomEvent(o.name, { detail: JSON.parse(o.detail), bubbles: true }));
    } catch (err) { /* not one */ }
  }, true);
  // image-variants (trif.imageVariant): the address TRIF worked out, on the picture it made, set here under
  // the page's own rules for pictures; with CORS and without credentials only when the mod asked for its pixels
  // (TRIF's world put crossorigin="anonymous" on it), so a host without CORS still shows the picture
  document.addEventListener('trif:image-src', (e) => {
    const img = e.target;
    if (!img || img.localName !== 'img' || typeof e.detail !== 'string' || !/^https?:\/\//.test(e.detail)) return;
    if (img.getAttribute('crossorigin') !== null) img.crossOrigin = 'anonymous';
    img.src = e.detail;
  }, true);
  // preload (el.loadSooner): the page's own lazy picture, loaded now
  document.addEventListener('trif:load-sooner', (e) => {
    const img = e.target;
    if (img && img.localName === 'img' && String(img.getAttribute('loading') || '').toLowerCase() === 'lazy') img.loading = 'eager';
  }, true);
  // embeds (trif.embed): after the user's click on TRIF's button, the player's frame, made here: the
  // address TRIF made from the page's link, no referrer, scripts but no top navigation, without credentials
  document.addEventListener('trif:embed', (e) => {
    const b = e.target;
    if (!b || b.localName !== 'button' || typeof e.detail !== 'string' || !/^https:\/\/(www\.youtube\.com\/embed|www\.youtube-nocookie\.com\/embed|player\.vimeo\.com\/video)\/[\w-]{4,20}$/.test(e.detail)) return;
    const f = document.createElement('iframe');
    f.setAttribute('credentialless', '');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    f.referrerPolicy = 'no-referrer';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.width = '560'; f.height = '315';
    f.style.cssText = 'border: 0; max-width: 100%;';
    f.src = e.detail;
    b.replaceWith(f);
  }, true);
  // rewrite-requests: the header's changes, made in the site's own same-origin requests whose operation has
  // that name (the address's last part, or the body's or the query's operationName): in a query parameter, its
  // JSON, or a JSON body. Only to a field the request already has (never one added: a rule's names carry
  // nothing to the site), and only in place of a value of its kind: true or false for a boolean, a number for
  // a number, null for anything, and a word only for one of the words the header names (Top|Popular→Recent),
  // so no text of the mod's author's takes the place of the user's own (helper/lib/boxpowers.js checkRewrite).
  let rewrites = [];
  const lit = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^-?\d/.test(v) ? Number(v) : v);
  // (only the request's own fields: a name every object has (__proto__, constructor) would lead to the
  // page's Object.prototype, and a value set there shows up on every object the page makes)
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const UNSAFE_KEY = /^(__proto__|prototype|constructor)$/;
  // (the value a field gets, or undefined when the rule doesn't apply to what's there: `json` false for a
  // query parameter, which is text)
  const swap = (old, v, json) => {
    const i = v.indexOf('→');
    if (i >= 0) return typeof old === 'string' && v.slice(0, i).split('|').includes(old) ? v.slice(i + 1) : undefined;
    const x = lit(v);
    if (!json) return (typeof x === 'boolean' && (old === 'true' || old === 'false')) || (typeof x === 'number' && /^-?\d{1,15}(\.\d{1,10})?$/.test(old)) ? String(x) : undefined;
    if (x === null) return old === undefined ? undefined : null;
    return typeof x === typeof old ? x : undefined;
  };
  const setPath = (obj, segs, v) => {
    if (segs.some((k) => UNSAFE_KEY.test(k))) return false;
    let o = obj;
    for (const k of segs.slice(0, -1)) { if (!own(o, k) || !o[k] || typeof o[k] !== 'object') return false; o = o[k]; }
    const last = segs[segs.length - 1];
    if (!own(o, last)) return false;
    const n = swap(o[last], v, true);
    if (n === undefined) return false;
    o[last] = n;
    return true;
  };
  const rulesFor = (u, bodyOp) => rewrites.filter((r) => r.op === u.pathname.split('/').pop() || r.op === u.searchParams.get('operationName') || (bodyOp && r.op === bodyOp));
  const rewriteUrl = (url) => {
    let u;
    try { u = new URL(String(url), location.href); } catch (err) { return url; }
    if (u.origin !== location.origin) return url;
    let changed = false;
    for (const r of rulesFor(u)) for (const [path, v] of r.sets) {
      const [top, ...rest] = path.split('.');
      if (path.split('.').some((k) => UNSAFE_KEY.test(k))) continue;
      if (!u.searchParams.has(top)) continue;
      if (!rest.length) { const n = swap(u.searchParams.get(top), v, false); if (n !== undefined) { u.searchParams.set(top, n); changed = true; } continue; }
      let o;
      try { o = JSON.parse(u.searchParams.get(top)); } catch (err) { continue; }
      if (!o || typeof o !== 'object') continue;
      if (setPath(o, rest, v)) { u.searchParams.set(top, JSON.stringify(o)); changed = true; }
    }
    return changed ? u.href : url;
  };
  const rewriteBody = (url, body) => {
    if (typeof body !== 'string' || !/^\s*\{/.test(body)) return body;
    let u, o;
    try { u = new URL(String(url), location.href); o = JSON.parse(body); } catch (err) { return body; }
    if (u.origin !== location.origin || !o || typeof o !== 'object') return body;
    const rules = rulesFor(u, typeof o.operationName === 'string' ? o.operationName : null);
    let changed = false;
    for (const r of rules) for (const [path, v] of r.sets) if (setPath(o, path.split('.'), v)) changed = true;
    return changed ? JSON.stringify(o) : body;
  };
  let rewriting = false;
  const startRewriting = () => {
    if (rewriting) return;
    rewriting = true;
    const f0 = window.fetch;
    if (typeof f0 === 'function') {
      window.fetch = function fetch(input, init) {
        try {
          if (typeof input === 'string' || input instanceof URL) {
            const u2 = rewriteUrl(String(input));
            if (init && init.body !== undefined) { const b = rewriteBody(u2, init.body); if (b !== init.body) init = { ...init, body: b }; }
            input = u2;
          } else if (input instanceof Request) { const u2 = rewriteUrl(input.url); if (u2 !== input.url) input = new Request(u2, input); }
        } catch (err) { /* as it was */ }
        return init === undefined ? f0.call(this, input) : f0.call(this, input, init);
      };
    }
    const X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (X) {
      const urls = new WeakMap();
      const open0 = X.open, send0 = X.send;
      X.open = function (method, url) { const args = [...arguments]; try { args[1] = rewriteUrl(String(url)); urls.set(this, args[1]); } catch (err) { /* as it was */ } return open0.apply(this, args); };
      X.send = function (body) { try { if (urls.has(this) && body !== undefined) body = rewriteBody(urls.get(this), body); } catch (err) { /* as it was */ } return send0.call(this, body); };
    }
  };
  document.addEventListener('trif:rewrite-rules', (e) => {
    let list;
    try { list = JSON.parse(String(e.detail)); } catch (err) { return; }
    if (!Array.isArray(list)) return;
    const ok = list.filter((r) => r && typeof r.op === 'string' && /^[A-Za-z][\w]{0,60}$/.test(r.op) && Array.isArray(r.sets)
      && r.sets.every((x) => Array.isArray(x) && /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*){0,7}$/.test(String(x[0])) && /^(true|false|null|-?\d{1,15}(\.\d{1,10})?|[A-Za-z][\w-]{0,40}(\|[A-Za-z][\w-]{0,40}){0,7}→[A-Za-z][\w-]{0,40})$/.test(String(x[1]))));
    if (!ok.length) return;
    rewrites = ok.slice(0, 50);
    startRewriting();
  }, true);

  // (a boxed mod that asked before this was here: it asks again when it sees this)
  document.dispatchEvent(new CustomEvent('trif:bridge-ready'));
})(); }
catch (e) { console.error('[TRIF] bridge failed', e); }
})
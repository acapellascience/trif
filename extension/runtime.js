// Page-side code. Everything here is stringified with Function.prototype.toString and injected into
// pages, so these functions must be self-contained: no imports, no closures over module scope.

/**
 * JSON-encode any page value. Always returns valid JSON. Handles undefined, DOM nodes, Map/Set,
 * cycles, functions, errors, BigInt, symbols, throwing getters; caps the output at `cap` chars
 * (a truncated result becomes a JSON string ending with a note).
 */
export function safeStringify(value, cap) {
  cap = cap || 1000000;
  const MAX_DEPTH = 40;
  const MAX_NODES = 200000;
  let nodes = 0;
  const ancestors = [];

  const isNode = (v) => typeof v.nodeType === 'number' && typeof v.nodeName === 'string';
  const isError = (v) => v instanceof Error ||
    (Object.prototype.toString.call(v) === '[object Error]' && typeof v.message === 'string');
  const tag = (v) => Object.prototype.toString.call(v).slice(8, -1);

  function conv(v, depth) {
    if (v === undefined) return null;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
    if (typeof v === 'bigint') return v.toString() + 'n';
    if (typeof v === 'symbol') return v.toString();
    if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
    if (++nodes > MAX_NODES) return '[…]';
    if (ancestors.includes(v)) return '[Circular]';
    if (depth > MAX_DEPTH) return '[Max depth]';
    try {
      if (v.window === v) return '[Window ' + (v.location && v.location.href) + ']';
      if (isNode(v)) {
        let html = v.outerHTML;
        if (typeof html !== 'string') {
          html = v.nodeType === 9 && v.documentElement ? v.documentElement.outerHTML
            : (v.textContent != null ? v.textContent : v.nodeName);
        }
        return String(html).slice(0, 2000);
      }
      if (isError(v)) return { name: String(v.name), message: String(v.message), stack: String(v.stack || '') };
      const t = tag(v);
      if (t === 'Promise') return '[Promise]';
      if (t === 'RegExp') return String(v);
      if (t === 'WeakMap' || t === 'WeakSet') return '[' + t + ']';
      if (t === 'Date') return isNaN(v) ? 'Invalid Date' : v.toISOString();
      if (t === 'ArrayBuffer') return '[ArrayBuffer ' + v.byteLength + ' bytes]';
    } catch (e) { /* exotic object; fall through */ }

    ancestors.push(v);
    try {
      let out;
      if (Array.isArray(v)) {
        out = v.map((x) => conv(x, depth + 1));
      } else if (v instanceof Map || tag(v) === 'Map') {
        out = Array.from(v, ([k, x]) => [conv(k, depth + 1), conv(x, depth + 1)]);
      } else if (v instanceof Set || tag(v) === 'Set') {
        out = Array.from(v, (x) => conv(x, depth + 1));
      } else if (ArrayBuffer.isView(v)) {
        out = Array.from(v.length > 10000 ? v.subarray(0, 10000) : v, (x) => conv(x, depth + 1));
      } else if (typeof v.length === 'number' && typeof v.item === 'function') {
        out = Array.from(v, (x) => conv(x, depth + 1)); // NodeList, HTMLCollection
      } else if (typeof v.toJSON === 'function') {
        out = conv(v.toJSON(), depth + 1);
      } else {
        out = {};
        for (const k of Object.keys(v)) {
          let x;
          try { x = v[k]; } catch (e) { x = '[Thrown: ' + (e && e.message) + ']'; }
          out[k] = conv(x, depth + 1);
        }
      }
      return out;
    } catch (e) {
      return '[Unserializable: ' + (e && e.message) + ']';
    } finally {
      ancestors.pop();
    }
  }

  let json;
  try {
    json = JSON.stringify(conv(value, 0));
  } catch (e) {
    json = JSON.stringify('[Unserializable: ' + (e && e.message) + ']');
  }
  if (json === undefined) json = 'null';
  if (json.length > cap) {
    json = JSON.stringify(json.slice(0, cap) + '\n…[truncated: result was ' + json.length + ' chars]');
  }
  return json;
}

/** "<message>\n<stack>" for anything thrown, without repeating the message. */
export function formatError(e) {
  if (e && typeof e === 'object') {
    const msg = String(e.message !== undefined ? e.message : e);
    const name = e.name ? String(e.name) : 'Error';
    const stack = typeof e.stack === 'string' ? e.stack : '';
    if (!stack) return name + ': ' + msg;
    return stack.includes(msg) ? stack : name + ': ' + msg + '\n' + stack;
  }
  return 'Uncaught ' + String(e);
}

/** The body of `__webmods_runtime`. Runs once per page at document_start, before any mod. */
export function runtimeMain(RECORDING, safeStringify) {
  if (window.__webmods && window.__webmods.errors) return; // already installed
  const W = window.__webmods = { errors: [], pageErrors: [], logs: [], requests: [], recording: false, current: null, watched: {} };
  const nativeConsole = { log: console.log, warn: console.warn, error: console.error };
  const MAX_ERRORS = 200, MAX_PAGE_ERRORS = 100, MAX_LOGS = 500, MAX_REQUESTS = 300, MAX_BODY = 2 * 1024 * 1024;
  const MAX_KEPT = 32 * 1024 * 1024; // characters of bodies kept across all recorded requests

  const push = (arr, item, max) => { arr.push(item); if (arr.length > max) arr.splice(0, arr.length - max); };
  const modFromStack = (stack) => {
    const m = /(?:trif|webmods):\/\/([^\s/]+\/[^\s/:)]+?)\.js/.exec(String(stack || ''));
    return m ? m[1] : null;
  };

  // window.trif.log/warn/error: attribute to the mod in the call stack (works from async callbacks), else
  // to the mod whose top-level code ran last. window.webmods is the same object: its name before 0.2.0,
  // which users' mods call, so it stays.
  const logger = (level) => function (...args) {
    try {
      const mod = modFromStack(new Error().stack) || W.current || null;
      const strs = args.map((a) => (typeof a === 'string' ? a : safeStringify(a, 10000)));
      push(W.logs, { mod, level, args: strs, time: Date.now() }, MAX_LOGS);
      nativeConsole[level].call(console, '[TRIF]', mod || '', ...args);
    } catch (e) { /* never throw into a mod */ }
  };
  // trif.expect(selector): a free mod says what it looks for, so TRIF can tell when none of it is on the page
  // any more (the mod may be broken: extension/modhealth.js). It only notes it; nothing else happens.
  const expect = function (selector) {
    try {
      const mod = modFromStack(new Error().stack) || W.current || null;
      if (!mod || typeof selector !== 'string' || !selector || selector.length > 500) return;
      const l = W.watched[mod] || (W.watched[mod] = []);
      if (l.length < 40 && l.indexOf(selector) < 0) l.push(selector);
    } catch (e) { /* never throw into a mod */ }
  };
  window.webmods = window.trif = { log: logger('log'), warn: logger('warn'), error: logger('error'), expect };

  // Errors from mods' event handlers and timers (the per-mod wrapper only catches top-level throws); the
  // rest are the page's own (`trif errors --page`), kept apart and fewer.
  const recordError = (err, filename, line) => {
    try {
      const stack = err && typeof err === 'object' ? String(err.stack || '') : '';
      const mod = modFromStack(stack) || modFromStack(filename);
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
      if (mod) push(W.errors, { mod, message, stack, time: Date.now() }, MAX_ERRORS);
      else push(W.pageErrors, { message: message.slice(0, 2000), stack: stack.slice(0, 4000), source: filename ? String(filename).slice(0, 500) + (line ? ':' + line : '') : '', time: Date.now() }, MAX_PAGE_ERRORS);
    } catch (e) { /* ignore */ }
  };
  try {
    window.addEventListener('error', (ev) => recordError(ev.error != null ? ev.error : ev.message, ev.filename, ev.lineno), true);
    window.addEventListener('unhandledrejection', (ev) => recordError(ev.reason), true);
  } catch (e) { /* ignore */ }

  // ---- Network recorder -------------------------------------------------------------------------
  const host = String((window.location && window.location.hostname) || '').toLowerCase();
  W.recording = RECORDING.some((s) => host === s || host.endsWith('.' + s));
  if (!W.recording) return;

  let counter = 0;
  const cap = (s) => (s.length > MAX_BODY ? s.slice(0, MAX_BODY) + '\n…[truncated: ' + s.length + ' chars]' : s);
  const absUrl = (u) => { try { return new URL(String(u), window.location.href).href; } catch (e) { return String(u); } };
  const isTextType = (ct) => {
    if (!ct) return true; // unlabeled responses are usually small text
    ct = String(ct).toLowerCase().split(';')[0].trim();
    return ct.startsWith('text/') || /[/+](json|xml|javascript|ecmascript|graphql|x-www-form-urlencoded)$/.test(ct) ||
      ct === 'application/x-javascript' || ct === 'application/x-ndjson';
  };
  // Server-sent events never end: reading them would hold the stream open and grow forever.
  const isEventStream = (ct) => /^\s*text\/event-stream/i.test(String(ct || ''));
  const bodyText = (b) => {
    if (b == null) return null;
    if (typeof b === 'string') return cap(b);
    if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return cap(b.toString());
    return '[binary]';
  };

  // Bodies kept, in characters, across W.requests, so a page making many big requests can't make the
  // recorder hold more than MAX_KEPT: the oldest bodies are dropped first (their entries stay).
  let kept = 0;
  const sizes = new WeakMap(); // entry -> { requestBody, responseText } lengths counted in `kept`
  const forget = (entry, note) => {
    const s = sizes.get(entry);
    if (!s) return;
    for (const f of Object.keys(s)) {
      if (!s[f]) continue;
      kept -= s[f];
      s[f] = 0;
      if (note) entry[f] = '[dropped: the recorder keeps at most ' + MAX_KEPT + ' characters of bodies; this was one of the oldest]';
    }
  };
  const keep = (entry, field, text) => {
    entry[field] = text;
    if (typeof text !== 'string' || !W.requests.includes(entry)) return; // already pushed out by newer requests
    const s = sizes.get(entry) || {};
    kept += text.length - (s[field] || 0);
    s[field] = text.length;
    sizes.set(entry, s);
    for (let k = 0; kept > MAX_KEPT && k < W.requests.length; k++) if (W.requests[k] !== entry) forget(W.requests[k], true);
  };
  const start = (type, method, url, requestBody) => {
    const entry = {
      i: counter++, type, method: String(method || 'GET').toUpperCase(), url: absUrl(url), status: null,
      requestBody: null, responseText: null, size: null, time: Date.now(), duration: null,
    };
    W.requests.push(entry);
    if (W.requests.length > MAX_REQUESTS) for (const old of W.requests.splice(0, W.requests.length - MAX_REQUESTS)) forget(old, false);
    keep(entry, 'requestBody', requestBody);
    return entry;
  };
  // more: the body went on past what was read (readBody stopped at MAX_BODY bytes).
  const finish = (entry, status, text, size, more) => {
    entry.status = status;
    entry.duration = Date.now() - entry.time;
    if (text != null) {
      keep(entry, 'responseText', more ? text + '\n…[truncated: longer than ' + MAX_BODY + ' bytes]' : cap(text));
      entry.size = size != null ? size : more ? null : text.length;
    } else if (size != null) entry.size = size;
  };

  // A response's text, read from a clone through its stream so that at most MAX_BODY bytes are read: a
  // body that streams on (NDJSON, a long poll) would otherwise be buffered without end. Past the cap
  // the clone is cancelled, which leaves the page's own response alone. Resolves { text, more }.
  const readBody = (res) => {
    const clone = res.clone();
    const body = clone.body;
    if (!body || typeof body.getReader !== 'function' || typeof TextDecoder !== 'function') {
      return clone.text().then((text) => ({ text, more: false }));
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    const step = () => reader.read().then((r) => {
      if (r.done) return { text: text + decoder.decode(), more: false };
      const chunk = r.value;
      if (bytes + chunk.byteLength > MAX_BODY) {
        text += decoder.decode(chunk.subarray(0, MAX_BODY - bytes));
        try { reader.cancel().catch(() => {}); } catch (e) { /* ignore */ }
        return { text, more: true };
      }
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      return step();
    });
    return step();
  };

  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    const wrapped = function fetch(input, init) {
      let entry = null;
      try {
        const isReq = typeof Request !== 'undefined' && input instanceof Request;
        const method = (init && init.method) || (isReq ? input.method : 'GET');
        const url = isReq ? input.url : input;
        let body = init && 'body' in init ? bodyText(init.body) : null;
        entry = start('fetch', method, url, body);
        if (isReq && !(init && 'body' in init) && !/^(GET|HEAD)$/i.test(input.method)) {
          const e = entry;
          input.clone().text().then((t) => { keep(e, 'requestBody', cap(t)); }, () => {});
        }
      } catch (e) { entry = null; }
      const p = origFetch.apply(this, arguments);
      if (entry) {
        const e = entry;
        p.then((res) => {
          try {
            const ct = res.headers.get('content-type');
            const len = Number(res.headers.get('content-length'));
            const known = Number.isFinite(len) && len > 0 ? len : null;
            if (isEventStream(ct)) {
              finish(e, res.status, null, null);
              e.responseText = '[stream: ' + ct + '; not recorded]';
            } else if (isTextType(ct)) {
              finish(e, res.status, null, known);
              readBody(res).then((r) => finish(e, res.status, r.text, r.more ? known : null, r.more), () => {});
            } else {
              finish(e, res.status, null, Number.isFinite(len) ? len : null);
              e.responseText = '[binary: ' + ct + ']';
            }
          } catch (err) { /* ignore */ }
        }, (err) => { try { finish(e, 0, null, null); e.error = String(err && err.message || err); } catch (x) { /* ignore */ } });
      }
      return p;
    };
    try { window.fetch = wrapped; } catch (e) { /* ignore */ }
  }

  if (typeof window.XMLHttpRequest === 'function') {
    const proto = window.XMLHttpRequest.prototype;
    const origOpen = proto.open, origSend = proto.send;
    const info = new WeakMap();
    proto.open = function open(method, url) {
      try { info.set(this, { method, url }); } catch (e) { /* ignore */ }
      return origOpen.apply(this, arguments);
    };
    proto.send = function send(body) {
      try {
        const o = info.get(this);
        if (o) {
          const entry = start('xhr', o.method, o.url, bodyText(body));
          const xhr = this;
          xhr.addEventListener('loadend', () => {
            try {
              const ct = xhr.getResponseHeader('content-type');
              let text = null;
              if (isTextType(ct) && !isEventStream(ct)) {
                const rt = xhr.responseType;
                if (rt === '' || rt === 'text') text = xhr.responseText;
                else if (rt === 'json') text = xhr.response == null ? null : JSON.stringify(xhr.response);
                else if (rt === 'document') text = xhr.response && xhr.response.documentElement ? xhr.response.documentElement.outerHTML : null;
              }
              finish(entry, xhr.status, text, null);
              if (text == null) entry.responseText = '[binary: ' + ct + ']';
            } catch (e) { /* ignore */ }
          });
        }
      } catch (e) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  }
}

/**
 * The clickjacking guard (RT-3: docs/SANDBOX-TIER-NOTES.md, docs/SECURITY-TIERS.md). CSS can make one of the
 * page's controls invisible and float it over something else, so the user's own click lands on it unseen. On a
 * trusted press (pointer, touch, a click with no press before it, Enter or Space on a control), before the page
 * sees it, TRIF looks at the control pressed: is it unseen (opacity under FADE all the way up, masked out, a few
 * pixels small, or showing nothing at all: no text, border, background or picture)? Almost every press stops
 * there. If it is, TRIF looks again with the mods' styles taken away for that moment (their style elements and
 * adopted sheets disabled, boxed mods' inline styles and animations on its ancestors undone by sandbox.js,
 * the transitions that starts cancelled; all put back before anything paints): unseen without them too, it's the site's own design
 * (a file input the site made invisible) and the press goes on; seen without them, the mods hid it, and the press
 * and the rest of its gesture (up, click, its keyup) are stopped and the mod named in its errors (by the sheet's
 * owner: `data-trif-style` on TRIF's style elements, `sheetOwner` for adopted ones), which the panel shows.
 * Also stopped, without that comparison: a press through a boxed mod's own element drawn over the control with
 * pointer-events: none (sandbox.js answers trif:cj-cover). A frame the mods hid is made unclickable while the
 * pointer is over it (its presses happen inside it, out of TRIF's reach). Free mods' code isn't covered: it
 * runs in the page and can do anything the page can.
 * Costs: `window.__webmods.guard.stats` (ms per press checked, and for the rarer second look).
 */
export function clickGuard(sheetOwner) {
  if (window.__trifGuardOn) return;
  Object.defineProperty(window, '__trifGuardOn', { value: true });
  const W = window.__webmods || null;
  const gcs = window.getComputedStyle;
  const look = (el, pseudo) => gcs.call(window, el, pseudo || null);
  const now = () => performance.now();
  const FADE = 0.25; // (combined opacity under which a control counts as unseen)
  const TINY = 4; // (px: narrower or shorter than this, unseen)
  const INK_MAX = 60; // (elements looked at for anything a control shows; more: it shows something)
  const stats = { presses: 0, checked: 0, ms: 0, maxMs: 0, deep: 0, deepMs: 0, maxDeepMs: 0, stopped: 0 };
  const stoppedList = [];
  if (W) W.guard = { stats, stopped: stoppedList };

  const parentOf = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const ROLES = /^(button|link|checkbox|radio|switch|menuitem|menuitemcheckbox|menuitemradio|tab|option|slider|combobox|treeitem|spinbutton)$/;
  const FRAMES = /^(iframe|frame|embed|object)$/;
  const LINKS = /^(a|area)$/;
  const interactive = (el) => {
    const t = el.localName;
    if (LINKS.test(t)) return el.hasAttribute('href');
    if (t === 'input') return String(el.type) !== 'hidden';
    if (t === 'button' || t === 'select' || t === 'textarea' || t === 'label' || t === 'summary' || FRAMES.test(t)) return true;
    if (el.hasAttribute('onclick') || el.hasAttribute('contenteditable')) return true;
    const r = el.getAttribute('role');
    if (r && ROLES.test(r.trim().split(/\s+/)[0])) return true;
    const ti = el.getAttribute('tabindex');
    return ti !== null && ti.trim() !== '-1';
  };
  const TOP = /^(html|body)$/;
  // The control a press is on: the element hit or its nearest interactive ancestor; for a control the page
  // made of plain elements, the outermost with the pointer cursor. null: not a control.
  const controlOf = (path) => {
    const hit = path.find((n) => n && n.nodeType === 1);
    if (!hit) return null;
    let i = 0;
    for (let n = hit; n && i < 40 && !TOP.test(n.localName); n = parentOf(n), i++) if (interactive(n)) return { el: n, hit };
    let top = null;
    i = 0;
    for (let n = hit; n && i < 40 && !TOP.test(n.localName); n = parentOf(n), i++) { if (look(n).cursor !== 'pointer') break; top = n; }
    return top ? { el: top, hit } : null;
  };

  const num = (s) => { const t = String(s).trim(); const v = parseFloat(t); return Number.isFinite(v) ? (t.endsWith('%') ? v / 100 : v) : 1; };
  // (a computed colour's alpha: rgb()/rgba() with commas, or a / alpha)
  const alpha = (c) => {
    if (!c || c === 'transparent') return 0;
    const m = /\(([^)]*)\)/.exec(c);
    if (!m) return 1;
    const slash = m[1].split('/');
    if (slash.length > 1) return num(slash[1]);
    const parts = m[1].split(',');
    return parts.length >= 4 ? num(parts[3]) : 1;
  };
  // (what a filter leaves of the opacity: opacity(); a heavy blur or an SVG filter (url()), which can make it
  // transparent, as nothing)
  const filterFade = (f) => {
    if (!f || f === 'none') return 1;
    if (/url\(/.test(f)) return 0;
    let k = 1;
    for (const m of f.matchAll(/opacity\(\s*([^)]*)\)/g)) k *= Math.max(0, Math.min(1, num(m[1])));
    for (const m of f.matchAll(/blur\(\s*([\d.]+)px\s*\)/g)) if (parseFloat(m[1]) >= 8) k = 0;
    return k;
  };
  // (a mask that hides it: an image (TRIF can't see what it leaves), or a gradient of transparent colours only)
  const maskHides = (c) => {
    const m = c.maskImage || c.webkitMaskImage || '';
    if (!m || m === 'none') return false;
    if (/url\(/.test(m)) return true;
    const cs = m.match(/rgba?\([^)]*\)|color\([^)]*\)|transparent/g) || [];
    return cs.length > 0 && cs.every((x) => alpha(x) < 0.1);
  };
  const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
  const borderInk = (c) => SIDES.some((s) => { const st = c[`border${s}Style`]; return st !== 'none' && st !== 'hidden' && parseFloat(c[`border${s}Width`]) > 0 && alpha(c[`border${s}Color`]) >= 0.1; });
  const boxInk = (c) => alpha(c.backgroundColor) >= 0.1 || (!!c.backgroundImage && c.backgroundImage !== 'none') || (!!c.boxShadow && c.boxShadow !== 'none') || borderInk(c)
    || (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0 && alpha(c.outlineColor) >= 0.1);
  const textShows = (c) => parseFloat(c.fontSize) >= 4 && (alpha(c.webkitTextFillColor || c.color) >= 0.1 || (!!c.textShadow && c.textShadow !== 'none') || parseFloat(c.webkitTextStrokeWidth) > 0);
  const hasText = (el) => { for (let t = el.firstChild; t; t = t.nextSibling) if (t.nodeType === 3 && /\S/.test(t.data)) return true; return false; };
  const pseudoInk = (el) => {
    for (const p of ['::before', '::after']) {
      const c = look(el, p);
      const ct = c.content;
      if (!ct || ct === 'none' || ct === 'normal' || c.display === 'none' || c.visibility !== 'visible' || num(c.opacity) * filterFade(c.filter) < FADE) continue;
      if (boxInk(c) || /url\(/.test(ct)) return true;
      if (ct !== '""' && ct !== "''" && textShows(c)) return true;
    }
    return false;
  };
  const REPLACED = /^(img|svg|video|canvas|iframe|frame|embed|object|math)$/;
  const FIELDS = /^(input|select|textarea|meter|progress)$/;
  // Whether a control shows anything: itself or something in it (not what's faded or masked out inside it)
  const shows = (top) => {
    const stack = [[top, 1]];
    let seen = 0;
    while (stack.length) {
      const [el, o0] = stack.pop();
      if (++seen > INK_MAX) return true;
      const c = look(el);
      if (c.display === 'none') continue;
      let o = o0;
      const box = c.display !== 'contents';
      if (el !== top && box) { o *= num(c.opacity) * filterFade(c.filter); if (o < FADE || maskHides(c)) continue; }
      const t = el.localName;
      if (box && c.visibility === 'visible') {
        if (REPLACED.test(t)) { const r = el.getBoundingClientRect(); if (r.width >= 2 && r.height >= 2) return true; }
        else if (FIELDS.test(t)) { if ((c.appearance && c.appearance !== 'none') || (c.webkitAppearance && c.webkitAppearance !== 'none') || boxInk(c) || textShows(c)) return true; }
        else if (boxInk(c) || (hasText(el) && textShows(c)) || pseudoInk(el)) return true;
      }
      if (REPLACED.test(t)) continue;
      const kids = el.shadowRoot ? [...el.children, ...el.shadowRoot.children] : el.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], o]);
    }
    return false;
  };
  const tiny = (el) => { const r = el.getBoundingClientRect(); return r.width < TINY || r.height < TINY; };
  // (an element's opacity where its running transitions end: a control fading in as the pointer reaches it,
  // the site's own hover effect, is judged as it will be; an animation's value is taken as it is now)
  const atRest = (n, c) => {
    let o = num(c.opacity), f = c.filter;
    let anims = [];
    try { anims = n.getAnimations(); } catch (e) { anims = []; }
    for (const a of anims) {
      if (typeof CSSTransition !== 'function' || !(a instanceof CSSTransition) || a.playState !== 'running' || !a.effect) continue;
      let kf = [];
      try { kf = a.effect.getKeyframes(); } catch (e) { kf = []; }
      const end = kf[kf.length - 1] || {};
      if (a.transitionProperty === 'opacity' && end.opacity !== undefined) o = num(end.opacity);
      if (a.transitionProperty === 'filter' && end.filter !== undefined) f = String(end.filter);
    }
    return o * filterFade(f);
  };
  // Why the control is unseen, or null: faded, masked, tiny or inkless
  const unseen = (ctl) => {
    let o = 1;
    let i = 0;
    const chain = [];
    for (let n = ctl.el; n && i < 300; n = parentOf(n), i++) {
      const c = look(n);
      if (c.display === 'contents') continue;
      chain.push([n, c]);
      o *= num(c.opacity) * filterFade(c.filter);
      if (maskHides(c)) return 'masked';
    }
    if (o < FADE) {
      let r = 1;
      for (const [n, c] of chain) r *= atRest(n, c);
      if (r < FADE) return 'faded';
    }
    if (tiny(ctl.el) && (ctl.hit === ctl.el || tiny(ctl.hit))) return 'tiny';
    return shows(ctl.el) ? null : 'inkless';
  };

  // ---- the look without the mods' styles
  // (the tree scopes whose styles reach the control: its own root, its host's, …, the document)
  const scopesOf = (el) => { const out = []; for (let n = el; n;) { const r = n.getRootNode(); if (out.includes(r)) break; out.push(r); n = r.host || null; } return out; };
  const sheetsIn = (scopes) => {
    const out = [];
    for (const root of scopes) {
      const els = root === document ? document.getElementsByTagName('style') : (root.querySelectorAll ? root.querySelectorAll('style') : []);
      for (const st of els) { const o = st.getAttribute('data-trif-style'); if (o && st.sheet) out.push({ sheet: st.sheet, owner: o, was: false }); }
      let ad = [];
      try { ad = root.adoptedStyleSheets || []; } catch (e) { ad = []; }
      for (const sh of ad) { const o = typeof sheetOwner === 'function' ? sheetOwner(sh) : null; if (o) out.push({ sheet: sh, owner: o, was: false }); }
    }
    return out;
  };
  // A style change starts the page's transitions, and a look would read their first frame (the value before):
  // so the transitions TRIF's look starts are cancelled as they start (the page gets transitioncancel), on the
  // way there and on the way back, and the page never shows them. (A sheet that makes every element's
  // transition none costs 30 ms on a page of 9000 elements: this costs well under one.)
  const animsNow = () => { try { return document.getAnimations(); } catch (e) { return []; } };
  const settle = (before) => {
    if (typeof CSSTransition !== 'function') return;
    for (const a of animsNow()) if (a instanceof CSSTransition && !before.has(a)) { try { a.cancel(); } catch (e) { /* gone */ } }
  };
  // TRIF's sandbox world (sandbox.js), during the dispatch: undo the boxed mods' inline styles and animations on
  // the control and its ancestors (all but `keep`'s), say whose they were, and whether a mod made or moved it
  let answers = null;
  document.addEventListener('trif:cj-answer', (e) => { if (answers && typeof e.detail === 'string') answers.push(e.detail); }, true);
  const ask = (el, type, detail) => {
    answers = [];
    try { el.dispatchEvent(new CustomEvent(type, { detail, composed: true })); } catch (e) { /* none */ }
    const got = answers;
    answers = null;
    const out = [];
    for (const t of got) { try { const o = JSON.parse(t); if (o && typeof o === 'object') out.push(o); } catch (e) { /* not one */ } }
    return out;
  };
  const boxOff = (el, keep) => {
    const out = { mods: [], made: null, moved: null };
    for (const o of ask(el, 'trif:cj-off', JSON.stringify({ keep: keep || null }))) {
      if (Array.isArray(o.mods)) for (const m of o.mods) if (typeof m === 'string') out.mods.push(m);
      if (typeof o.made === 'string') out.made = o.made;
      if (typeof o.moved === 'string') out.moved = o.moved;
    }
    return out;
  };
  const boxOn = (el) => { try { el.dispatchEvent(new CustomEvent('trif:cj-on', { composed: true })); } catch (e) { /* none */ } };
  const cover = (el, x, y) => { for (const o of ask(el, 'trif:cj-cover', JSON.stringify({ x, y }))) if (typeof o.covered === 'string') return o.covered; return null; };
  // (a mod's own element pressed: only one with a default action of the page's kind counts)
  const OWN_ACTS = /^(a|area|button|input|select|textarea|label|summary)$/;
  // Whose sheet it was, without restyling the page for each: the sheets with a rule that changes how something
  // looks and matches the control, an ancestor, or something in it (only when that leaves more than one, each
  // of those alone is tried)
  const LOOKS = /^(opacity|filter|mask|-webkit-mask|visibility|color|-webkit-text|background|border|outline|box-shadow|font|width|height|min-|max-|transform|scale|zoom|display|content|clip|padding|inset|position|top|left|right|bottom|text-|line-height|appearance|-webkit-appearance|mix-blend)/;
  const PSEUDO_EL = /::?(before|after|marker|placeholder|selection|first-line|first-letter|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)/g;
  const touches = (sheet, els) => {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { return true; }
    const hits = (sel) => {
      if (/:host|::part|::slotted|&/.test(sel)) return true;
      const s = sel.replace(PSEUDO_EL, '').trim() || '*';
      for (const el of els) { try { if (el.matches(s)) return true; } catch (e) { return true; } }
      return false;
    };
    const looks = (st) => { for (let i = 0; i < st.length; i++) if (LOOKS.test(st[i])) return true; return false; };
    let budget = 5000;
    const walk = (list, depth) => {
      for (const r of list) {
        if (--budget < 0) return true;
        if (r.style && typeof r.selectorText === 'string' && looks(r.style) && hits(r.selectorText)) return true;
        if (r.cssRules && r.cssRules.length && depth < 10 && walk(r.cssRules, depth + 1)) return true;
      }
      return false;
    };
    return walk(rules, 0);
  };
  const near = (el) => {
    const out = [];
    for (let n = el, i = 0; n && i < 300; n = parentOf(n), i++) out.push(n);
    const inside = el.querySelectorAll ? el.querySelectorAll('*') : [];
    for (let i = 0; i < inside.length && i < INK_MAX; i++) out.push(inside[i]);
    return out;
  };

  const recent = new WeakMap(); // control -> when it was unseen without the mods too (the site's own)
  const deep = (ctl, why) => {
    const r = recent.get(ctl.el);
    if (r && now() - r < 2000) return null;
    const t0 = now();
    stats.deep++;
    const scopes = scopesOf(ctl.el);
    const sheets = sheetsIn(scopes);
    const before = new Set(animsNow());
    const sheetsOff = (keep) => { for (const s of sheets) { s.was = s.sheet.disabled; if (s.owner !== keep) s.sheet.disabled = true; } };
    const sheetsBack = () => { for (const s of sheets) s.sheet.disabled = s.was; };
    // (unseen with `keep`'s styles alone)
    const alone = (keep) => {
      sheetsOff(keep);
      boxOff(ctl.el, keep);
      try { settle(before); return !!unseen(ctl); } finally { sheetsBack(); boxOn(ctl.el); }
    };
    try {
      sheetsOff(null);
      const off = boxOff(ctl.el, null);
      let without;
      try { settle(before); without = unseen(ctl); } finally { sheetsBack(); boxOn(ctl.el); }
      if (off.made && !OWN_ACTS.test(ctl.el.localName)) return null;
      if (off.moved) return { why, mods: [off.moved], el: ctl.el };
      if (without) { recent.set(ctl.el, now()); return null; }
      const els = near(ctl.el);
      const owners = [...new Set([...sheets.filter((s) => touches(s.sheet, els)).map((s) => s.owner), ...off.mods])];
      const all = [...new Set([...sheets.map((s) => s.owner), ...off.mods])];
      if (!all.length) return null;
      let mods = owners.length ? owners : all;
      if (mods.length > 1 && mods.length <= 6) { const one = mods.filter((o) => alone(o)); if (one.length) mods = one; }
      return { why, mods, el: ctl.el };
    } finally {
      // (and the ones the way back started: the page goes on from where it was, as if TRIF hadn't looked)
      settle(before);
      const ms = now() - t0;
      stats.deepMs += ms;
      if (ms > stats.maxDeepMs) stats.maxDeepMs = ms;
    }
  };
  const verdict = (ctl, x, y) => {
    const t0 = now();
    stats.checked++;
    try {
      if (!ctl.el.isConnected) return null;
      const why = unseen(ctl);
      if (!why) {
        if (x === null || x === undefined) return null;
        const mod = cover(ctl.el, x, y);
        return mod ? { why: 'covered', mods: [mod], el: ctl.el } : null;
      }
      return deep(ctl, why);
    } finally { const ms = now() - t0; stats.ms += ms; if (ms > stats.maxMs) stats.maxMs = ms; }
  };

  // ---- telling: the mod's errors (trif errors; the panel's card: background.js), once per mod and reason here
  const WHY = {
    faded: 'made it nearly transparent',
    masked: 'masked it out',
    tiny: 'made it a few pixels small',
    inkless: 'left nothing of it showing (no text, border, background or picture)',
    covered: 'covered it with one of the mod\'s own elements, which lets clicks through to it',
  };
  const said = new Set();
  const describe = (el) => {
    const label = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `<${el.localName}${el.id ? `#${el.id}` : ''}>${label ? ` ${label}` : ''}`.replace(/"/g, '\'');
  };
  const report = (v) => {
    stats.stopped++;
    const what = describe(v.el);
    stoppedList.push({ mods: v.mods, why: v.why, control: what, time: Date.now() });
    if (stoppedList.length > 50) stoppedList.shift();
    for (const mod of v.mods) {
      const key = `${mod}|${v.why}`;
      if (said.has(key)) continue;
      said.add(key);
      if (W && Array.isArray(W.errors)) {
        W.errors.push({ mod, kind: 'clickjack', why: v.why, stack: '', time: Date.now(), message: `TRIF stopped a click on the page's "${what}": this mod's style ${WHY[v.why] || 'hid it'}, and without the mod it shows, so the click would have landed on it unseen.` });
        if (W.errors.length > 200) W.errors.splice(0, W.errors.length - 200);
      }
    }
    try { document.dispatchEvent(new CustomEvent('trif:cj-stopped')); } catch (e) { /* none */ }
  };

  // ---- the presses
  let g = null; // the gesture: {t, ptr (began with pointerdown), key (began with a key), stop}
  const halt = (ev) => { try { if (ev.cancelable && ev.type !== 'touchstart') ev.preventDefault(); } catch (e) { /* passive */ } ev.stopImmediatePropagation(); };
  const judge = (ev, x, y) => {
    let ctl = null;
    try { ctl = controlOf(ev.composedPath()); } catch (e) { ctl = null; }
    if (!ctl) return;
    let v = null;
    try { v = verdict(ctl, x, y); } catch (e) { v = null; }
    if (v) { g.stop = true; halt(ev); report(v); }
  };
  // (a frame the mods hid: unclickable while it's hidden, as its presses go inside it, where TRIF isn't)
  const shielded = new Set();
  let shieldSheet = null;
  const shield = (el) => {
    if (!shieldSheet) { shieldSheet = new CSSStyleSheet(); shieldSheet.replaceSync('[data-trif-guard] { pointer-events: none !important; }'); }
    const r = el.getRootNode();
    try { if (!r.adoptedStyleSheets.includes(shieldSheet)) r.adoptedStyleSheets = [...r.adoptedStyleSheets, shieldSheet]; } catch (e) { /* none */ }
    el.setAttribute('data-trif-guard', '');
    shielded.add(el);
  };
  const unshield = (x, y) => {
    for (const f of [...shielded]) {
      const b = f.getBoundingClientRect();
      if (!f.isConnected || x < b.left || x > b.right || y < b.top || y > b.bottom) { f.removeAttribute('data-trif-guard'); shielded.delete(f); }
    }
  };
  const onPress = (ev) => {
    if (!ev.isTrusted) return;
    stats.presses++;
    const t = now();
    if (ev.type !== 'pointerdown' && g && g.ptr && t - g.t < 1500) { if (g.stop) halt(ev); return; } // (the same press)
    g = { t, ptr: ev.type === 'pointerdown', key: false, stop: false };
    const pt = ev.type === 'touchstart' ? ev.touches && ev.touches[0] : ev;
    if (shielded.size && pt) unshield(pt.clientX, pt.clientY);
    judge(ev, pt ? pt.clientX : null, pt ? pt.clientY : null);
  };
  const onFollow = (ev) => {
    if (!ev.isTrusted) return;
    const t = now();
    if (g && g.stop && t - g.t < 30000) { halt(ev); return; }
    // (a click with no press before it: assistive technology's, say)
    if (ev.type === 'click' && (!g || t - g.t >= 30000)) {
      g = { t, ptr: false, key: false, stop: false };
      judge(ev, ev.detail > 0 ? ev.clientX : null, ev.detail > 0 ? ev.clientY : null);
    }
  };
  const PRESSES_KEYS = /^(checkbox|radio|button|submit|reset|file|image|color|range)$/;
  const onKey = (ev) => {
    if (!ev.isTrusted || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    if (ev.type === 'keyup' || ev.repeat) { if (g && g.key && g.stop) halt(ev); return; }
    const el = ev.composedPath()[0];
    if (!el || el.nodeType !== 1 || el.localName === 'textarea' || el.isContentEditable) return; // (typing)
    if (el.localName === 'input' && ev.key === ' ' && !PRESSES_KEYS.test(String(el.type))) return;
    g = { t: now(), ptr: false, key: true, stop: false };
    judge(ev, null, null);
  };
  const onOver = (ev) => {
    if (!ev.isTrusted) return;
    const el = ev.composedPath()[0];
    if (!el || el.nodeType !== 1 || !FRAMES.test(el.localName) || shielded.has(el)) return;
    let v = null;
    try { v = verdict({ el, hit: el }, ev.clientX, ev.clientY); } catch (e) { v = null; }
    if (v) { shield(el); report(v); }
  };
  const hard = { capture: true, passive: false };
  window.addEventListener('pointerdown', onPress, hard);
  window.addEventListener('mousedown', onPress, hard);
  // (passive: a touch listener that can cancel makes every scroll wait for the page; the click is what acts)
  window.addEventListener('touchstart', onPress, { capture: true, passive: true });
  for (const t of ['pointerup', 'mouseup', 'touchend', 'click', 'dblclick', 'auxclick', 'contextmenu']) window.addEventListener(t, onFollow, hard);
  window.addEventListener('keydown', onKey, hard);
  window.addEventListener('keyup', onKey, hard);
  window.addEventListener('pointerover', onOver, { capture: true, passive: true });
}

/**
 * The page's side of two boxed-mod powers (docs/POWERS.md), TRIF's code in the page's world. Talks to TRIF's
 * sandbox world only through events on the shared DOM, with JSON text: the boxed mod never touches the page's
 * own fetch, objects or functions.
 * - site-data: once a boxed mod asks to filter responses (`trif:filter-patterns`, a JSON list of URL globs),
 *   fetch and XMLHttpRequest are wrapped; a JSON response whose URL matches goes to the sandbox world as text
 *   (`trif:filter-request`, answered during the dispatch with `trif:filter-response`), and what comes back
 *   (checked there: nothing invented) replaces it.
 * - page-data: an element's React props and fiber, read by a path (`trif:page-data` on the element), answered
 *   with a plain JSON copy (`trif:page-data-answer`): no functions, no DOM nodes, capped.
 * - for every boxed mod: `trif:url` after the page's pushState and replaceState (trif.onUrl), with nothing in
 *   it; `trif:shadow-css` (trif.css with { shadow }): a checked sheet, as text, for the roots of hosts that match.
 * The page can see and send these events too: it learns or changes only its own data.
 */
export function pageBridge(guard) {
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
  const sheetOwners = new WeakMap(); // sheet -> the boxed mod whose it is (the clickjacking guard names it)
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
    sheetOwners.set(sheet, o.id.split('#')[0]);
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

  // the clickjacking guard (clickGuard, above), which knows these sheets' owners
  if (typeof guard === 'function') { try { guard((sh) => sheetOwners.get(sh) || null); } catch (e) { /* the page goes on without it */ } }
  // (a boxed mod that asked before this was here: it asks again when it sees this)
  document.dispatchEvent(new CustomEvent('trif:bridge-ready'));
}

export function runtimeCode(recordingSites) {
  return `(() => {
const RECORDING = ${JSON.stringify((recordingSites || []).map((s) => String(s).toLowerCase()))};
try { (${runtimeMain.toString()})(RECORDING, ${safeStringify.toString()}); }
catch (e) { console.error('[TRIF] runtime failed', e); }
try { (${pageBridge.toString()})(${clickGuard.toString()}); }
catch (e) { console.error('[TRIF] bridge failed', e); }
})();
//# sourceURL=trif-runtime.js`;
}

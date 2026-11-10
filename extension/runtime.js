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
  const W = window.__webmods = { errors: [], pageErrors: [], logs: [], requests: [], recording: false, current: null };
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
  window.webmods = window.trif = { log: logger('log'), warn: logger('warn'), error: logger('error') };

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

/** Source of the `__webmods_runtime` user script with the recording set embedded. */
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
 * The page can see and send these events too: it learns or changes only its own data.
 */
export function pageBridge() {
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
    if (typeof text !== 'string' || text.length > MAX || !/^\s*[[{]/.test(text)) return text;
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
  // (a boxed mod that asked before this was here: it asks again when it sees this)
  document.dispatchEvent(new CustomEvent('trif:bridge-ready'));

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
}

export function runtimeCode(recordingSites) {
  return `(() => {
const RECORDING = ${JSON.stringify((recordingSites || []).map((s) => String(s).toLowerCase()))};
try { (${runtimeMain.toString()})(RECORDING, ${safeStringify.toString()}); }
catch (e) { console.error('[TRIF] runtime failed', e); }
try { (${pageBridge.toString()})(); }
catch (e) { console.error('[TRIF] bridge failed', e); }
})();
//# sourceURL=trif-runtime.js`;
}

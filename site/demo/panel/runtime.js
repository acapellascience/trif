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
export function runtimeCode(recordingSites) {
  return `(() => {
const RECORDING = ${JSON.stringify((recordingSites || []).map((s) => String(s).toLowerCase()))};
try { (${runtimeMain.toString()})(RECORDING, ${safeStringify.toString()}); }
catch (e) { console.error('[TRIF] runtime failed', e); }
})();
//# sourceURL=trif-runtime.js`;
}

// Record the JSON the site's own requests get back, in this tab, to find where a feed's items live and to test a
// filter on real data. Written for the TRIF skill (skill/src/scripts/page/record.js); like `trif record`.
//
// Passive: it never makes a request. It keeps copies of the responses to the page's own fetch and XHR requests
// whose address matches, from now on (not the ones the page made before you pasted it: scroll, or move around
// the app, so it loads more). Kept in this tab's memory only, small (30 responses, 2 MB each), until stop() or a
// reload. Responses carry the user's data: read their shape, quote as little as you need, never copy out
// tokens or personal details.
//
//   __trifRecord.start(/graphql|api/)     what to keep (a RegExp on the address; none: every JSON response)
//   __trifRecord.list()                   [{i, method, url, status, kb, top}]: what came back
//   __trifRecord.shape(i, 'data.items', 3) the keys and list lengths under a path, a few levels deep
//   __trifRecord.find(i, 'some text')     the paths whose value contains the text (where items live)
//   __trifRecord.get(i, 'data.items')     the value at a path (a copy), to run a filter on
//   __trifRecord.stop()                   fetch and XHR as they were
(() => {
  if (window.__trifRecord) { try { window.__trifRecord.stop(); } catch { /* a page that changed it */ } }
  const MAX = 30;
  const MAX_TEXT = 2 * 1024 * 1024;
  const kept = [];
  let pattern = null;
  let on = false;
  const fetch0 = window.fetch;
  const open0 = XMLHttpRequest.prototype.open;
  const send0 = XMLHttpRequest.prototype.send;
  const wants = (url) => on && (!pattern || pattern.test(url));
  const keep = (method, url, status, text) => {
    if (kept.length >= MAX || typeof text !== 'string' || text.length > MAX_TEXT) return;
    const body = text.replace(/^\)\]\}'|^for\s*\(;;\);/, '').trim();
    if (!/^[[{]/.test(body)) return;
    try { kept.push({ i: kept.length, method, url: String(url), status, json: JSON.parse(body), kb: Math.round(text.length / 1024) }); } catch { /* not JSON */ }
  };
  function start(re) {
    pattern = re instanceof RegExp ? re : re ? new RegExp(String(re)) : null;
    if (on) return 'recording';
    on = true;
    window.fetch = function (input, init) {
      const p = fetch0.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const method = (init && init.method) || (input && input.method) || 'GET';
        if (wants(url)) p.then((r) => { if (r && /json|javascript|text/.test(r.headers.get('content-type') || '')) r.clone().text().then((t) => keep(method, url, r.status, t), () => {}); }, () => {});
      } catch { /* never in the page's way */ }
      return p;
    };
    XMLHttpRequest.prototype.open = function (method, url) { try { this.__trifRec = wants(String(url)) ? { method, url: String(url) } : null; } catch { /* ignore */ } return open0.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      try {
        if (this.__trifRec) this.addEventListener('load', () => { try { const t = this.responseType === '' || this.responseType === 'text' ? this.responseText : this.responseType === 'json' ? JSON.stringify(this.response) : null; keep(this.__trifRec.method, this.__trifRec.url, this.status, t); } catch { /* ignore */ } });
      } catch { /* ignore */ }
      return send0.apply(this, arguments);
    };
    return `recording ${pattern ? pattern : 'every JSON response'}: now scroll or move around so the page loads more`;
  }
  function stop() {
    on = false;
    if (window.fetch !== fetch0) window.fetch = fetch0;
    XMLHttpRequest.prototype.open = open0;
    XMLHttpRequest.prototype.send = send0;
    return { stopped: true, kept: kept.length };
  }
  const at = (v, p) => { for (const k of String(p || '').split('.').filter(Boolean)) v = v == null ? undefined : v[k]; return v; };
  const one = (i) => { const r = kept[i]; if (!r) throw new Error(`no response ${i}: list() says what's kept`); return r; };
  function shape(i, p, depth = 2) {
    const sum = (v, d) => {
      if (Array.isArray(v)) return d <= 0 ? `[${v.length}]` : { [`[${v.length}]`]: v.length ? sum(v[0], d - 1) : null };
      if (v && typeof v === 'object') { if (d <= 0) return `{${Object.keys(v).length} keys}`; const o = {}; for (const k of Object.keys(v).slice(0, 30)) o[k] = sum(v[k], d - 1); return o; }
      return typeof v === 'string' ? `string(${v.length})` : typeof v;
    };
    return sum(at(one(i).json, p), depth);
  }
  function find(i, text, limit = 20) {
    const out = [];
    const needle = String(text).toLowerCase();
    const walk = (v, p, d) => {
      if (out.length >= limit || d > 40) return;
      if (v && typeof v === 'object') { for (const k of Object.keys(v)) { if (k.toLowerCase().includes(needle)) out.push(`${p}${p ? '.' : ''}${k} (key)`); walk(v[k], `${p}${p ? '.' : ''}${k}`, d + 1); } }
      else if (typeof v === 'string' && v.toLowerCase().includes(needle)) out.push(p);
    };
    walk(one(i).json, '', 0);
    return out;
  }
  window.__trifRecord = {
    start, stop, shape, find,
    list: () => kept.map((r) => ({ i: r.i, method: r.method, url: r.url.length > 140 ? `${r.url.slice(0, 139)}…` : r.url, status: r.status, kb: r.kb, top: r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 8) : typeof r.json })),
    get: (i, p) => structuredClone(at(one(i).json, p)),
    info: (i) => { const r = one(i); return { method: r.method, url: r.url, status: r.status }; },
  };
  return 'record ready: __trifRecord.start(/pattern/), then list(), shape(i, path), find(i, text), get(i, path), stop()';
})();

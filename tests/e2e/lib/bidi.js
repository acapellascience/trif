'use strict';
// A small WebDriver BiDi client (Firefox's remote protocol), over Node's built-in WebSocket (Node 22+).
// No dependencies. Only what the e2e suite needs: commands, events, and evaluation helpers.

class Bidi {
  constructor(url) {
    this.url = url;
    this.seq = 0;
    this.waiting = new Map();
    this.listeners = new Map(); // method -> Set(fn)
  }

  async connect(timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < end) {
      try {
        await this._open();
        return this;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw new Error(`couldn't connect to ${this.url}: ${lastErr && lastErr.message}`);
  }

  _open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onclose = () => {
        for (const w of this.waiting.values()) w.reject(new Error('connection closed'));
        this.waiting.clear();
      };
      ws.onmessage = (e) => this._onMessage(JSON.parse(e.data));
    });
  }

  _onMessage(m) {
    if (m.id !== undefined && this.waiting.has(m.id)) {
      const w = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.type === 'error') w.reject(new Error(`${w.method}: ${m.error}: ${m.message}`));
      else w.resolve(m.result);
      return;
    }
    if (m.type === 'event') {
      for (const fn of this.listeners.get(m.method) || []) {
        try { fn(m.params); } catch { /* listener bugs don't break the client */ }
      }
    }
  }

  send(method, params = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method}: timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method).delete(fn);
  }

  /** Evaluates `fnSource` (an async function's source) with JSON-able `args` in a context; returns its JSON-able result. */
  async call(context, fnSource, args = [], { timeoutMs = 60000, userActivation = false } = {}) {
    const expression = `(async () => { const __r = await (${fnSource})(...${JSON.stringify(args)}); return JSON.stringify(__r === undefined ? null : __r); })()`;
    const r = await this.send('script.evaluate', { target: { context }, expression, awaitPromise: true, userActivation }, timeoutMs);
    if (r.type === 'exception') {
      const d = r.exceptionDetails || {};
      throw new Error(`in page: ${d.text || 'exception'}${d.stackTrace ? '' : ''}`);
    }
    const v = r.result && r.result.value;
    return v === undefined || v === null ? null : JSON.parse(v);
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

module.exports = { Bidi };

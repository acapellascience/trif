'use strict';
// A per-run reverse proxy that adds the API key, so the key never reaches Codex (agents/codex-oss.js).
//
// Why: anything in Codex's environment or argv can be read by the commands it runs. Its sandbox keeps them
// out of files and the network, but not out of other processes' arguments and environment: on macOS,
// sysctl(KERN_PROCARGS2) returns any same-user process's argv and initial environment, sandbox or not
// (shown with python3 ctypes inside `codex sandbox` under TRIF's profile). So Codex gets
// `base_url = http://127.0.0.1:<port>/<secret>/v1` and no key at all; this server, in the helper, adds
// `Authorization: Bearer <key>` and forwards to the provider. The key lives only in the helper's memory.
//
// Who can use it: Codex (it knows the address). Not the agent's commands: no network in their sandbox,
// 127.0.0.1 included. Not web pages: every request must start with the random path prefix (128 bits, never
// in a page's reach), and requests that carry `Origin`, `Sec-Fetch-Site` or `Sec-Fetch-Dest` (which
// browsers add to fetches, form posts and image loads alike) are refused, as is any Host but the proxy's own (DNS rebinding); no
// CORS headers either, so a page couldn't read an answer. Only the paths Codex uses go through
// (`/responses…`, `/models…`), GET and POST. It closes when the run ends.

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// Hop-by-hop headers (RFC 9110 7.6.1) and what the proxy sets or must not pass on.
const DROP_REQUEST = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'upgrade',
  'transfer-encoding', 'authorization', 'cookie', 'origin', 'referer', 'x-api-key', 'api-key']);
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade', 'transfer-encoding', 'set-cookie']);
const ALLOWED_PATH = /^\/(responses|models)(?:[/?]|$)/;

function refuse(res, status, message) {
  if (res.headersSent) { res.destroy(); return; }
  const body = JSON.stringify({ error: { message } });
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), connection: 'close' });
  res.end(body);
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * startKeyProxy({target, key, headers?, logger?, onStatus?}) -> Promise<{url, port, close(), stats}>
 *   target   the provider's base URL (https, or http on loopback), e.g. https://openrouter.ai/api/v1
 *   key      sent as `Authorization: Bearer <key>` on every forwarded request
 *   headers  extra headers for the provider (none by default)
 *   onStatus called with each answer's HTTP status (codex-oss: a 401 means the key was refused)
 *   url      what Codex gets as base_url: http://127.0.0.1:<port>/<32 hex>/v1
 *   stats    {forwarded, refused} counts (for tests and the log)
 */
function startKeyProxy({ target, key, headers = {}, logger = null, onStatus = null }) {
  const base = new URL(target);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return Promise.reject(new Error(`unsupported provider URL ${base.protocol}`));
  const basePath = base.pathname.replace(/\/+$/, '');
  const client = base.protocol === 'https:' ? https : http;
  const secret = crypto.randomBytes(16).toString('hex');
  const mount = `/${secret}/v1`;
  const upstreams = new Set();
  const stats = { forwarded: 0, refused: 0 };
  let port = 0;
  let closed = false;

  const server = http.createServer((req, res) => {
    const deny = (status, message) => { stats.refused++; req.resume(); refuse(res, status, message); };
    if (closed) return deny(503, 'the run has ended');
    const h = req.headers;
    // Browsers: a page's fetch, form post or <img> carries Origin and/or Sec-Fetch-Site and -Dest; Codex
    // sends none. (Node's fetch sends Sec-Fetch-Mode alone, so that one doesn't count.)
    if (h.origin !== undefined || h['sec-fetch-site'] !== undefined || h['sec-fetch-dest'] !== undefined) return deny(403, 'not for browsers');
    if (h.host !== `127.0.0.1:${port}` && h.host !== `localhost:${port}`) return deny(403, 'wrong host');
    const url = String(req.url || '');
    const head = url.slice(0, mount.length);
    if (!sameText(head, mount) || (url.length > mount.length && url[mount.length] !== '/')) return deny(404, 'not found');
    const rest = url.slice(mount.length) || '/';
    if (!ALLOWED_PATH.test(rest) || (req.method !== 'POST' && req.method !== 'GET')) return deny(404, 'not found');

    const out = {};
    for (const [k, v] of Object.entries(h)) if (!DROP_REQUEST.has(k)) out[k] = v;
    Object.assign(out, headers, { host: base.host, authorization: `Bearer ${key}` });
    const up = client.request({
      protocol: base.protocol, hostname: base.hostname, port: base.port || undefined, method: req.method,
      path: basePath + rest, headers: out,
    }, (upRes) => {
      if (onStatus) { try { onStatus(upRes.statusCode); } catch { /* ignore */ } }
      const back = {};
      for (const [k, v] of Object.entries(upRes.headers)) if (!DROP_RESPONSE.has(k) && !k.startsWith('access-control-')) back[k] = v;
      res.writeHead(upRes.statusCode || 502, back);
      res.flushHeaders();
      // Server-sent events go through as they come: pipe writes each chunk at once (no buffering here).
      upRes.pipe(res);
      upRes.on('error', () => res.destroy());
    });
    upstreams.add(up);
    up.on('close', () => upstreams.delete(up));
    up.on('error', (e) => {
      if (closed) return res.destroy();
      if (logger) logger.warn(`key proxy: ${base.host}: ${e.code || e.message}`);
      // (The error is about the connection, never the key.)
      refuse(res, 502, `couldn't reach ${base.host}: ${e.code || e.message}`);
    });
    req.on('aborted', () => up.destroy());
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    stats.forwarded++;
    req.pipe(up);
  });
  server.on('connection', (sock) => sock.setNoDelay(true));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}${mount}`,
        port,
        stats,
        close() {
          if (closed) return Promise.resolve();
          closed = true;
          for (const u of upstreams) u.destroy();
          return new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
        },
      });
    });
  });
}

module.exports = { startKeyProxy };

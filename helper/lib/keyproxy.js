'use strict';
// A per-run reverse proxy that adds the API key, so the key never reaches the agent: Codex for open
// models (agents/codex-oss.js), and plain Claude Code and Codex runs with an API key saved in the keyring
// (agentkeys.js).
//
// Why: anything in Codex's environment or argv can be read by the commands it runs. Its sandbox keeps them
// out of files and the network, but not out of other processes' arguments and environment: on macOS,
// sysctl(KERN_PROCARGS2) returns any same-user process's argv and initial environment, sandbox or not
// (shown with python3 ctypes inside `codex sandbox` under TRIF's profile). So the agent gets a base URL on
// 127.0.0.1 and no key at all; this server, in the helper, adds `Authorization: Bearer <key>` (or
// `x-api-key`) and forwards to the provider. The key lives only in the helper's memory.
//
// Codex's address has no secret in it any more (token mode, below): it was in Codex's argv (`-c
// model_providers…base_url`), which other same-user processes can read. Instead the proxy wants
// `Authorization: Bearer <token>`, a random token Codex gets from a file in the run's own folder
// (0600, in a folder runs can't read): its provider's `auth = { command = "/bin/cat", args = [<file>] }`
// (agents/codex.js proxyAuth; Codex 0.166 runs that command itself and sends what it prints). So the
// token is in no process's argv or environment either. Claude Code's base URL (ANTHROPIC_BASE_URL, its
// environment) still carries the secret path: it has no such setting.
//
// Who can use it: the run's agent (Codex has the token; Claude Code knows the address). Not the agent's
// commands: no network in their sandbox, 127.0.0.1 included. Not web pages: every request must carry the
// token or start with the random path prefix (256 or 128 bits, never in a page's reach), and requests that carry `Origin`, `Sec-Fetch-Site` or `Sec-Fetch-Dest` (which
// browsers add to fetches, form posts and image loads alike) are refused, as is any Host but the proxy's own (DNS rebinding); no
// CORS headers either, so a page couldn't read an answer. Only the paths the agent uses go through
// (OpenAI-style: `/responses…`, `/models…`; Anthropic: `/v1/messages…`, `/v1/models…`), GET and POST. It
// closes when the run ends.

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// Hop-by-hop headers (RFC 9110 7.6.1) and what the proxy sets or must not pass on.
const DROP_REQUEST = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'upgrade',
  'transfer-encoding', 'authorization', 'cookie', 'origin', 'referer', 'x-api-key', 'api-key']);
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade', 'transfer-encoding', 'set-cookie']);
const ALLOWED_PATH = /^\/(responses|models)(?:[/?]|$)/;
// The largest request body passed on (the agent's requests: JSON, with its conversation, images included).
const MAX_BODY = 64 * 1024 * 1024;
// The two ways of passing it: OpenAI's (and OpenRouter's, and most servers') bearer token, Anthropic's
// x-api-key (the base URL Claude Code gets is the proxy's root: it adds /v1/messages itself).
const STYLES = {
  bearer: { mount: '/v1', paths: ALLOWED_PATH, headers: (key) => ({ authorization: `Bearer ${key}` }) },
  anthropic: { mount: '', paths: /^\/v1\/(messages|models)(?:[/?]|$)/, headers: (key) => ({ 'x-api-key': key }) },
};

// What a request without the run's token gets (token mode). Codex shows it with the 401.
const NO_TOKEN = 'TRIF\'s key proxy: this request doesn\'t carry the run\'s token. Only the run\'s own Codex can use it (Codex 0.166 or later sends it)';

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
 * startKeyProxy({target, key, style?, headers?, logger?, onStatus?}) -> Promise<{url, port, close(), stats}>
 *   target   the provider's base URL (https, or http on loopback), e.g. https://openrouter.ai/api/v1
 *   key      added to every forwarded request, as `style` says:
 *   style    'bearer' (default): `Authorization: Bearer <key>`, url ends in /v1, paths /responses, /models;
 *            'anthropic': `x-api-key: <key>`, url is the root, paths /v1/messages, /v1/models
 *   headers  extra headers for the provider (none by default)
 *   onStatus called with each answer's HTTP status (a 401 means the key was refused)
 *   token    true (Codex): every request must carry `Authorization: Bearer <the proxy's token>`, and the
 *            url has no secret path; false (default, Claude Code): the url's secret path is the check
 *   url      what the agent gets as its base URL: http://127.0.0.1:<port>/<32 hex>[/v1], or with
 *            `token`, http://127.0.0.1:<port>[/v1]
 *   token    (with `token`) the token: 64 hex characters, for the run's token file, never an argv
 *   stats    {forwarded, refused, retried} counts (for tests and the log; retried: requests sent again
 *            after a kept-alive connection to the provider turned out closed)
 */
function startKeyProxy({ target, key, style = 'bearer', headers = {}, logger = null, onStatus = null, token: useToken = false }) {
  const how = STYLES[style];
  if (!how) return Promise.reject(new Error(`unknown key style ${style}`));
  const base = new URL(target);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return Promise.reject(new Error(`unsupported provider URL ${base.protocol}`));
  const basePath = base.pathname.replace(/\/+$/, '');
  const client = base.protocol === 'https:' ? https : http;
  const secret = crypto.randomBytes(16).toString('hex');
  const token = useToken ? crypto.randomBytes(32).toString('hex') : null;
  const mount = useToken ? how.mount : `/${secret}${how.mount}`;
  const upstreams = new Set();
  const stats = { forwarded: 0, refused: 0, retried: 0 };
  let port = 0;
  let closed = false;

  const server = http.createServer((req, res) => {
    const deny = (status, message) => {
      stats.refused++;
      req.resume();
      // (What was refused, never the secret prefix or a query string.)
      if (logger && logger.debug) logger.debug(`key proxy: refused ${req.method} ${String(req.url || '').replace(mount, '<proxy>').replace(/\?.*$/, '')}: ${message}`);
      refuse(res, status, message);
    };
    if (closed) return deny(503, 'the run has ended');
    const h = req.headers;
    // Browsers: a page's fetch, form post or <img> carries Origin and/or Sec-Fetch-Site and -Dest; Codex
    // sends none. (Node's fetch sends Sec-Fetch-Mode alone, so that one doesn't count.)
    if (h.origin !== undefined || h['sec-fetch-site'] !== undefined || h['sec-fetch-dest'] !== undefined) return deny(403, 'not for browsers');
    if (h.host !== `127.0.0.1:${port}` && h.host !== `localhost:${port}`) return deny(403, 'wrong host');
    // (token mode: the run's token, compared in constant time, before anything about the path is said)
    if (token && !sameText(h.authorization || '', `Bearer ${token}`)) return deny(401, NO_TOKEN);
    const url = String(req.url || '');
    const head = url.slice(0, mount.length);
    if (!sameText(head, mount) || (url.length > mount.length && url[mount.length] !== '/')) return deny(404, 'not found');
    const rest = url.slice(mount.length) || '/';
    if (!how.paths.test(rest) || (req.method !== 'POST' && req.method !== 'GET')) return deny(404, 'not found');
    // (the path as written is what's allowed: no dot segments, encoded or not, and no backslash, which a
    // provider's edge may resolve to another path on its host, with the user's key on the request)
    if (/(^|\/)\.{1,2}(\/|$)|%2e|%2f|%5c|\\|\/\//i.test(rest.split('?')[0])) return deny(404, 'not found');

    const out = {};
    for (const [k, v] of Object.entries(h)) if (!DROP_REQUEST.has(k) && k !== 'content-length') out[k] = v;
    Object.assign(out, headers, { host: base.host }, how.headers(key));
    // The request body is read whole first (the agent's requests are JSON, and bounded), so it can be sent
    // again: a kept-alive connection to the provider that the provider closed meanwhile fails at once
    // (ECONNRESET, "socket hang up") before any answer, and is retried once on a fresh one.
    let current = null;
    const send = (body, attempt) => {
      let answered = false;
      const up = client.request({
        protocol: base.protocol, hostname: base.hostname, port: base.port || undefined, method: req.method,
        path: basePath + rest, headers: { ...out, ...(body.length || req.method === 'POST' ? { 'content-length': body.length } : {}) },
      }, (upRes) => {
        answered = true;
        if (onStatus) { try { onStatus(upRes.statusCode); } catch { /* ignore */ } }
        const back = {};
        for (const [k, v] of Object.entries(upRes.headers)) if (!DROP_RESPONSE.has(k) && !k.startsWith('access-control-')) back[k] = v;
        res.writeHead(upRes.statusCode || 502, back);
        res.flushHeaders();
        // Server-sent events go through as they come: pipe writes each chunk at once (no buffering here).
        upRes.pipe(res);
        upRes.on('error', () => res.destroy());
      });
      current = up;
      upstreams.add(up);
      up.on('close', () => upstreams.delete(up));
      up.on('error', (e) => {
        if (closed) return res.destroy();
        if (!answered && up.reusedSocket && attempt === 0 && !res.headersSent && !res.destroyed) {
          stats.retried++;
          if (logger && logger.debug) logger.debug(`key proxy: ${base.host}: ${e.code || e.message} on a kept-alive connection; trying a new one`);
          return send(body, 1);
        }
        if (logger) logger.warn(`key proxy: ${base.host}: ${e.code || e.message}`);
        // (The error is about the connection, never the key.)
        refuse(res, 502, `couldn't reach ${base.host}: ${e.code || e.message}`);
      });
      up.end(body);
    };
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; deny(413, 'request too large'); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig || closed || res.destroyed) return;
      stats.forwarded++;
      send(Buffer.concat(chunks), 0);
    });
    req.on('aborted', () => current && current.destroy());
    res.on('close', () => { if (!res.writableFinished && current) current.destroy(); });
  });
  server.on('connection', (sock) => sock.setNoDelay(true));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}${mount}`,
        ...(token ? { token } : {}),
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

module.exports = { startKeyProxy, STYLES, NO_TOKEN };

'use strict';
// TRIF's network relay (docs/WHOLE-BOX-PROGRESS.md step 8): the one way out of TRIF's full sandbox for a
// run signed in with a token (no key proxy). The box lets the run reach one port on this computer, this
// relay's (HTTPS_PROXY, which Claude Code honours), and the relay tunnels only to the hosts it's given:
// Anthropic's, port 443, and (step 5) hosts an organization's managed settings name.
//
//   - CONNECT only (an HTTP proxy's tunnel). No TLS termination: after "200 Connection established" the
//     bytes go through untouched, so the relay never sees what the run sends (the token, the chat) and
//     Claude Code checks Anthropic's certificate itself.
//   - Strict parsing (parseHead, pure, fuzzed in tests/relay.test.js): one request line, `CONNECT
//     host:port HTTP/1.x`, CRLF only, header lines `name: value`, nothing odd; at most 8 KB and 64 lines.
//     Anything else gets an HTTP error and the socket closes; the target is never guessed from a request
//     that doesn't read cleanly.
//   - Exact host names (lower case), exact ports: no wildcards, no suffix matches; an IP address only if
//     it's on the list as written.
//   - The name is looked up once and the relay connects to the address it checked: an Anthropic host that
//     resolves to this computer (loopback), an unspecified, link-local or multicast address is refused, so
//     a hostile network's DNS can't make the relay a way into this computer's own services. (A host an
//     organization names may be on this computer, e.g. a local telemetry collector: `local: true`.)
//   - Time limits (the request's head, the connection to the host, an idle tunnel) and a cap on tunnels
//     at once.
//   - `seen`: every request, allowed or not ({target, allowed, reason, failed, up, down}), capped; what it refused
//     goes into the run's error and log (boxrefusals.js fromProxy).

const net = require('net');
const dns = require('dns');

const ANTHROPIC_HOSTS = ['api.anthropic.com', 'claude.ai', 'console.anthropic.com', 'platform.claude.com'];
const ANTHROPIC = ANTHROPIC_HOSTS.map((host) => ({ host, port: 443 }));

const MAX_HEAD = 8192;
const MAX_LINES = 64;
const SEEN_MAX = 500;
const LIMITS = { headMs: 10000, connectMs: 10000, idleMs: 5 * 60 * 1000, maxTunnels: 64 };

// ------------------------------------------------------------------ parsing (pure)

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const VALUE = /^[\t\x20-\x7e\x80-\xff]*$/; // (no control characters but tab)
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** A host name or IP literal as the relay accepts it, normalised (lower case; IPv6 without brackets), or null. */
function normHost(h) {
  const s = String(h);
  const v6 = s.startsWith('[') ? (s.endsWith(']') ? s.slice(1, -1) : '') : s.includes(':') ? s : null;
  if (v6 !== null) {
    if (!/^[0-9a-f:.]+$/i.test(v6) || !net.isIPv6(v6)) return null;
    try { return new URL(`http://[${v6}]/`).hostname.slice(1, -1); } catch { return null; } // (one spelling: 2001:DB8:0::1 → 2001:db8::1)
  }
  const n = s.toLowerCase();
  if (IPV4.test(n)) return n;
  // (a last label that's a number makes the whole an IPv4 address to most programs: 127.1, 2130706433, 0x7f.0.0.1)
  if (!n || n.length > 253 || /(^|\.)(0x[0-9a-f]*|\d+)$/.test(n)) return null;
  return n.split('.').every((l) => LABEL.test(l)) ? n : null;
}

/** "host:port" (authority form) -> {host, port} or null. Port 1-65535, decimal, no leading zero. */
function parseTarget(t) {
  const m = /^(\[[^\]]*\]|[^:\[\]]+):([1-9]\d{0,4})$/.exec(String(t));
  if (!m) return null;
  const port = Number(m[2]);
  const host = normHost(m[1]);
  return host && port <= 65535 ? { host, port } : null;
}

const fmt = ({ host, port }) => `${host.includes(':') ? `[${host}]` : host}:${port}`;

/**
 * parseHead(buffer) -> {more: true} (not all there yet) | {ok: false, status, reason, target?} |
 * {ok: true, host, port, end} (`end`: where the tunnel's own bytes begin). Never throws.
 */
function parseHead(buf) {
  const s = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf);
  const want = 'CONNECT ';
  // Not a CONNECT at all: say so at once rather than wait for the rest.
  if (!want.startsWith(s.slice(0, want.length))) {
    const abs = /^[A-Z]{3,10} (https?):\/\/(\[[^\]\s/]*\]|[^:/\s]+)(?::(\d{1,5}))?[/\s]/i.exec(s);
    const t = abs && parseTarget(`${abs[2]}:${abs[3] || (abs[1].toLowerCase() === 'https' ? 443 : 80)}`);
    return { ok: false, status: 405, reason: 'not CONNECT', ...(t ? { target: fmt(t) } : {}) };
  }
  const end = s.indexOf('\r\n\r\n');
  if (end === -1) {
    if (s.length > MAX_HEAD) return { ok: false, status: 431, reason: 'too long' };
    if (/[\0]|[^\r]\n|^\n/.test(s)) return { ok: false, status: 400, reason: 'bad line ending' };
    if ((s.match(/\r\n/g) || []).length > MAX_LINES) return { ok: false, status: 431, reason: 'too many lines' }; // (each a line of the head when it ends)
    return { more: true };
  }
  if (end + 4 > MAX_HEAD) return { ok: false, status: 431, reason: 'too long' };
  const head = s.slice(0, end);
  if (/[\0\n\r]/.test(head.replace(/\r\n/g, ''))) return { ok: false, status: 400, reason: 'bad line ending' };
  const lines = head.split('\r\n');
  if (lines.length > MAX_LINES) return { ok: false, status: 431, reason: 'too many lines' };
  const m = /^CONNECT ([^ ]+) HTTP\/1\.[01]$/.exec(lines[0]);
  if (!m) return { ok: false, status: 400, reason: 'bad request line' };
  const t = parseTarget(m[1]);
  if (!t) return { ok: false, status: 400, reason: 'bad target' };
  for (const line of lines.slice(1)) {
    const c = line.indexOf(':');
    if (c < 1 || !TOKEN.test(line.slice(0, c)) || !VALUE.test(line.slice(c + 1))) return { ok: false, status: 400, reason: 'bad header', target: fmt(t) };
  }
  return { ok: true, host: t.host, port: t.port, end: end + 4 };
}

// ------------------------------------------------------------------ the rules

/** [{host, port, local?}] with hosts normalised; entries that aren't a host and a port are dropped. */
function normRules(list) {
  const out = [];
  for (const r of list || []) {
    const host = r && normHost(String(r.host || ''));
    const port = r && Number(r.port);
    if (host && Number.isInteger(port) && port >= 1 && port <= 65535) out.push({ host, port, local: r.local === true });
  }
  return out;
}

function ruleFor(rules, host, port) {
  return rules.find((r) => r.host === host && r.port === port) || null;
}

/** An address the relay won't connect an Anthropic host to (this computer, unspecified, link-local, multicast). */
function localAddress(addr) {
  let a = String(addr).toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1];
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 0 || x === 127 || (x === 169 && y === 254) || x >= 224;
  }
  if (!net.isIPv6(a)) return true;
  return a === '::' || a === '::1' || /^fe[89ab]/.test(a) || /^ff/.test(a) || /^::ffff:/.test(a) || /^::[0-9.]+$/.test(a) || /^(0+:){7}0*[01]$/.test(a);
}

// ------------------------------------------------------------------ the server

const lookupAll = (host) => new Promise((resolve, reject) => dns.lookup(host, { all: true, verbatim: false }, (e, a) => (e ? reject(e) : resolve(a))));

/**
 * start({allow, connect, lookup, limits}) -> Promise<{port, seen, close, tunnels()}>.
 * `allow`: [{host, port, local?}] (default Anthropic's hosts on 443). `connect(port, address, host)` and
 * `lookup(host)` -> [{address, family}]: tests (instead of the internet and DNS).
 */
function start({ allow = ANTHROPIC, connect = (port, address) => net.connect({ port, host: address }), lookup = lookupAll, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const rules = normRules(allow);
  const seen = [];
  let dropped = 0;
  const note = (x) => { if (seen.length < SEEN_MAX) seen.push(x); else dropped++; return x; };
  const open = new Set();
  let tunnels = 0;

  const server = net.createServer((client) => {
    open.add(client);
    client.on('close', () => open.delete(client));
    client.on('error', () => {});
    let head = Buffer.alloc(0);
    let done = false;
    const refuse = (status, entry) => {
      done = true;
      clearTimeout(headTimer);
      client.removeListener('data', onData);
      if (entry) note(entry);
      const text = { 400: 'Bad Request', 403: 'Forbidden', 405: 'Method Not Allowed', 408: 'Request Timeout', 431: 'Request Header Fields Too Large', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' }[status] || 'Error';
      client.end(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
      setTimeout(() => client.destroy(), 1000).unref();
    };
    const headTimer = setTimeout(() => { if (!done) refuse(408, { target: '(no request in time)', allowed: false, reason: 'timeout' }); }, L.headMs);
    headTimer.unref();
    const onData = (d) => {
      if (done) return;
      head = Buffer.concat([head, d]);
      const p = parseHead(head);
      if (p.more) return;
      if (!p.ok) { refuse(p.status, { target: p.target || '(a request the relay couldn\'t read)', allowed: false, reason: p.reason }); return; }
      done = true;
      clearTimeout(headTimer);
      client.removeListener('data', onData);
      client.pause();
      const target = fmt(p);
      const rule = ruleFor(rules, p.host, p.port);
      if (!rule) { refuse(403, { target, allowed: false, reason: 'not allowed' }); return; }
      if (tunnels >= L.maxTunnels) { refuse(503, { target, allowed: false, reason: 'too many tunnels' }); return; }
      tunnels++;
      const entry = note({ target, allowed: true, up: 0, down: 0 });
      const rest = head.subarray(p.end);
      head = null;
      let released = false;
      const release = () => { if (!released) { released = true; tunnels--; } };
      client.on('close', release);
      tunnel(client, p, rule, rest, entry, release).catch(() => {}).finally(() => { if (client.destroyed) release(); });
    };
    client.on('data', onData);
  });

  async function tunnel(client, p, rule, rest, entry, release) {
    // (a host on the list that can't be reached isn't a refusal: `failed`; one resolving to this computer is)
    const fail = (status, reason) => {
      release();
      if (reason === 'local address') { entry.allowed = false; entry.reason = reason; } else entry.failed = reason;
      if (!client.destroyed) client.end(`HTTP/1.1 ${status} ${status === 504 ? 'Gateway Timeout' : status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
      setTimeout(() => client.destroy(), 1000).unref();
    };
    let addrs;
    if (net.isIP(p.host)) addrs = [{ address: p.host, family: net.isIP(p.host) }];
    else {
      try { addrs = await withTimeout(Promise.resolve(lookup(p.host)), L.connectMs); } catch { fail(502, 'no address'); return; }
    }
    addrs = (addrs || []).filter((a) => a && net.isIP(a.address));
    if (!rule.local) {
      if (addrs.some((a) => localAddress(a.address))) { fail(403, 'local address'); return; }
    }
    if (!addrs.length) { fail(502, 'no address'); return; }
    let up = null;
    for (const a of addrs) {
      if (client.destroyed) return;
      up = await new Promise((resolve) => {
        let s;
        try { s = connect(p.port, a.address, p.host); } catch { resolve(null); return; }
        const t = setTimeout(() => { s.destroy(); resolve(null); }, L.connectMs);
        s.once('connect', () => { clearTimeout(t); s.removeAllListeners('error'); resolve(s); });
        s.once('error', () => { clearTimeout(t); resolve(null); });
      });
      if (up) break;
    }
    if (!up) { fail(502, 'unreachable'); return; }
    if (client.destroyed) { up.destroy(); return; }
    entry.address = up.remoteAddress || undefined;
    client.write('HTTP/1.1 200 Connection established\r\n\r\n');
    if (rest.length) { up.write(rest); entry.up += rest.length; }
    const idle = () => { client.destroy(); up.destroy(); };
    let timer = setTimeout(idle, L.idleMs);
    const touch = () => { clearTimeout(timer); timer = setTimeout(idle, L.idleMs); };
    client.on('data', (d) => { entry.up += d.length; touch(); });
    up.on('data', (d) => { entry.down += d.length; touch(); });
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
    up.on('close', () => { clearTimeout(timer); client.destroy(); });
    client.on('close', () => { clearTimeout(timer); up.destroy(); });
    client.pipe(up);
    up.pipe(client);
    client.resume();
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      seen,
      dropped: () => dropped,
      tunnels: () => tunnels,
      close: () => new Promise((r) => { for (const s of open) s.destroy(); server.close(() => r()); }),
    }));
  });
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
}

module.exports = { start, parseHead, parseTarget, normHost, normRules, ruleFor, localAddress, ANTHROPIC, ANTHROPIC_HOSTS, MAX_HEAD, MAX_LINES, LIMITS };

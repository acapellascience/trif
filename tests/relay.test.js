'use strict';
// TRIF's network relay (helper/lib/relay.js, docs/WHOLE-BOX-PROGRESS.md step 8): its parsing, its rules, the
// server, and a fuzz-style test of both the parser and the running relay (seeded: a failure prints its seed;
// TRIF_RELAY_FUZZ_SEED=<n> repeats it, TRIF_RELAY_FUZZ_N=<n> runs more). Never the internet, never real DNS:
// stand-in `connect` and `lookup`; the "hosts" are servers on 127.0.0.1.

const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const relay = require('../helper/lib/relay');

const { parseHead, parseTarget, normHost, localAddress } = relay;
const ok = (s) => parseHead(Buffer.from(s, 'latin1'));

test('targets: host:port, exact, normalised; numbers that only look like addresses refused', () => {
  assert.deepStrictEqual(parseTarget('api.anthropic.com:443'), { host: 'api.anthropic.com', port: 443 });
  assert.deepStrictEqual(parseTarget('API.Anthropic.COM:443'), { host: 'api.anthropic.com', port: 443 });
  assert.deepStrictEqual(parseTarget('203.0.113.7:8443'), { host: '203.0.113.7', port: 8443 });
  assert.deepStrictEqual(parseTarget('[2001:DB8::1]:443'), { host: '2001:db8::1', port: 443 });
  assert.deepStrictEqual(parseTarget('[2001:db8:0:0::1]:443'), { host: '2001:db8::1', port: 443 });
  assert.deepStrictEqual(relay.normRules([{ host: '[2001:DB8::1]', port: 443 }, { host: '2001:db8::2', port: '8443' }, { host: 'x', port: 0 }, { host: 'bad host', port: 1 }, null]).map((x) => [x.host, x.port]), [['2001:db8::1', 443], ['2001:db8::2', 8443]]);
  for (const t of ['api.anthropic.com', 'api.anthropic.com:', ':443', 'api.anthropic.com:0', 'api.anthropic.com:65536', 'api.anthropic.com:0443',
    'api.anthropic.com:443a', 'api.anthropic.com:+443', 'api.anthropic.com:44 3', 'user@api.anthropic.com:443', 'api.anthropic.com.:443',
    '.api.anthropic.com:443', 'api..anthropic.com:443', 'api.anthropic.com%2e:443', '-api.anthropic.com:443', 'api-.anthropic.com:443',
    'api_x.anthropic.com:443', '2130706433:443', '0x7f.0.0.1:443', '127.1:443', '127.0.0.01:443', '256.1.1.1:443', '[::1:443', '[zz::1]:443',
    '2001:db8::1:443', `${'a'.repeat(64)}.com:443`, `${'a.'.repeat(127)}a:443`, 'api.anthropic.com:443:443', 'ａpi.anthropic.com:443', '']) {
    assert.equal(parseTarget(t), null, t);
  }
  assert.equal(normHost(`${'a'.repeat(63)}.com`), `${'a'.repeat(63)}.com`);
});

test('parseHead: one clean CONNECT; everything else an error, the target never guessed', () => {
  assert.deepStrictEqual(ok('CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\nUser-Agent: claude\r\n\r\n'), { ok: true, host: 'api.anthropic.com', port: 443, end: 'CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\nUser-Agent: claude\r\n\r\n'.length });
  assert.deepStrictEqual(ok('CONNECT api.anthropic.com:443 HTTP/1.0\r\n\r\n'), { ok: true, host: 'api.anthropic.com', port: 443, end: 42 });
  // the tunnel's first bytes may come with the head (a TLS hello): `end` says where they begin
  const r = ok('CONNECT a.example:443 HTTP/1.1\r\n\r\n\x16\x03\x01rest');
  assert.equal(r.ok, true);
  assert.equal(r.end, 'CONNECT a.example:443 HTTP/1.1\r\n\r\n'.length);
  // not there yet
  for (const s of ['', 'C', 'CONN', 'CONNECT ', 'CONNECT api.anthropic.com:443 HTTP/1.1', 'CONNECT a:443 HTTP/1.1\r\nHost: a\r\n', 'CONNECT a:443 HTTP/1.1\r']) assert.deepStrictEqual(ok(s), { more: true }, JSON.stringify(s));
  // not CONNECT: said at once, with the host when it's an absolute URL (for the run's error)
  assert.deepStrictEqual(ok('GET http://example.com/x HTTP/1.1\r\n\r\n'), { ok: false, status: 405, reason: 'not CONNECT', target: 'example.com:80' });
  assert.deepStrictEqual(ok('POST https://Example.com:8443/'), { ok: false, status: 405, reason: 'not CONNECT', target: 'example.com:8443' });
  assert.deepStrictEqual(ok('connect a:443 HTTP/1.1\r\n\r\n'), { ok: false, status: 405, reason: 'not CONNECT' });
  assert.deepStrictEqual(ok('\x16\x03\x01\x00'), { ok: false, status: 405, reason: 'not CONNECT' });
  const bad = {
    'CONNECT  a.example:443 HTTP/1.1\r\n\r\n': 'bad request line',
    'CONNECT a.example:443  HTTP/1.1\r\n\r\n': 'bad request line',
    'CONNECT a.example:443 HTTP/1.1 \r\n\r\n': 'bad request line',
    'CONNECT a.example:443 HTTP/2.0\r\n\r\n': 'bad request line',
    'CONNECT a.example:443\r\n\r\n': 'bad request line',
    'CONNECT\ta.example:443 HTTP/1.1\r\n\r\n': 'not CONNECT',
    'CONNECT http://a.example:443 HTTP/1.1\r\n\r\n': 'bad target',
    'CONNECT a.example HTTP/1.1\r\n\r\n': 'bad target',
    'CONNECT a.example:443 HTTP/1.1\nHost: a\r\n\r\n': 'bad line ending',
    'CONNECT a.example:443 HTTP/1.1\r\nHost: a\rX: y\r\n\r\n': 'bad line ending',
    'CONNECT a.example:443 HTTP/1.1\r\nHo\0st: a\r\n\r\n': 'bad line ending',
    'CONNECT a.example:443 HTTP/1.1\r\n folded: x\r\n\r\n': 'bad header',
    'CONNECT a.example:443 HTTP/1.1\r\nno colon\r\n\r\n': 'bad header',
    'CONNECT a.example:443 HTTP/1.1\r\n: empty name\r\n\r\n': 'bad header',
    'CONNECT a.example:443 HTTP/1.1\r\nX: a\x01b\r\n\r\n': 'bad header',
    'CONNECT a.example:443 HTTP/1.1\r\nX y: z\r\n\r\n': 'bad header',
  };
  for (const [s, reason] of Object.entries(bad)) {
    const p = ok(s);
    assert.equal(p.ok, false, JSON.stringify(s));
    assert.equal(p.reason, reason, JSON.stringify(s));
    assert.ok([400, 405].includes(p.status), JSON.stringify(s));
  }
  // an early bare LF or NUL is refused before the head ends
  assert.equal(ok('CONNECT a.example:443 HTTP/1.1\n').reason, 'bad line ending');
  // size and line limits, also before the head ends
  assert.deepStrictEqual(ok(`CONNECT a.example:443 HTTP/1.1\r\nX: ${'x'.repeat(relay.MAX_HEAD)}`), { ok: false, status: 431, reason: 'too long' });
  assert.equal(ok(`CONNECT a.example:443 HTTP/1.1\r\nX: ${'x'.repeat(relay.MAX_HEAD)}\r\n\r\n`).status, 431);
  const many = (n) => `CONNECT a.example:443 HTTP/1.1\r\n${'X: y\r\n'.repeat(n)}`;
  assert.equal(ok(`${many(relay.MAX_LINES - 1)}\r\n`).ok, true);
  assert.equal(ok(`${many(relay.MAX_LINES)}\r\n`).status, 431);
  assert.deepStrictEqual(ok(many(relay.MAX_LINES - 1)), { more: true });
  assert.equal(ok(many(relay.MAX_LINES)).status, 431); // (65 lines whatever comes next)
});

test('addresses an Anthropic host may not resolve to', () => {
  for (const a of ['127.0.0.1', '127.255.0.9', '0.0.0.0', '169.254.169.254', '224.0.0.1', '255.255.255.255', '::1', '::', '0:0:0:0:0:0:0:1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::127.0.0.1', 'nonsense']) assert.ok(localAddress(a), a);
  for (const a of ['160.79.104.10', '203.0.113.7', '10.0.0.5', '192.168.1.2', '2607:6bc0::10', 'fd00::5', '::ffff:160.79.104.10']) assert.ok(!localAddress(a), a);
});

// ------------------------------------------------------------------ the running relay

// A stand-in "internet": echo servers on 127.0.0.1, `connect` sends every address to one of them, `lookup`
// answers from a table. What the relay asked for is recorded.
async function world({ table = {}, behave = 'echo' } = {}) {
  const calls = [];
  const servers = [];
  const sockets = new Set();
  const up = net.createServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => {});
    if (behave === 'echo') s.on('data', (d) => s.write(Buffer.concat([Buffer.from('ECHO:'), d])));
    if (behave === 'hello') s.write('UPSTREAM-HELLO');
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  servers.push(up);
  const lookups = [];
  return {
    calls, lookups,
    connect: (port, address, host) => { calls.push({ port, address, host }); return net.connect(up.address().port, '127.0.0.1'); },
    lookup: async (host) => { lookups.push(host); if (!(host in table)) throw new Error('ENOTFOUND'); return table[host].map((address) => ({ address, family: net.isIP(address) })); },
    close: () => { for (const s of sockets) s.destroy(); for (const s of servers) s.close(); },
  };
}

// Send `chunks` (with a pause between), collect everything that comes back until the relay closes.
function talk(port, chunks, { gap = 0, then = null, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let out = Buffer.alloc(0);
    let sentThen = false;
    const timer = setTimeout(() => { s.destroy(); resolve({ out: out.toString('latin1'), timedOut: true }); }, timeout);
    s.on('data', (d) => {
      out = Buffer.concat([out, d]);
      if (then && !sentThen && /^HTTP\/1\.1 200 /.test(out.toString('latin1'))) { sentThen = true; s.write(then); setTimeout(() => s.end(), 50); }
    });
    s.on('close', () => { clearTimeout(timer); resolve({ out: out.toString('latin1'), timedOut: false }); });
    s.on('error', () => {});
    s.on('connect', async () => {
      for (const c of chunks) {
        if (s.destroyed) break;
        s.write(Buffer.isBuffer(c) ? c : Buffer.from(c, 'latin1'));
        if (gap) await new Promise((r) => setTimeout(r, gap));
      }
      if (!then) setTimeout(() => s.end(), 100);
    });
  });
}

test('relay: tunnels to the listed hosts and ports only, bytes untouched both ways', async () => {
  const w = await world({ table: { 'api.anthropic.com': ['160.79.104.10'], 'otel.corp.example': ['10.1.2.3'] } });
  const r = await relay.start({ allow: [...relay.ANTHROPIC, { host: 'OTEL.corp.example', port: 4318 }, { host: '203.0.113.9', port: 443 }], connect: w.connect, lookup: w.lookup });
  try {
    // the tunnel's first bytes in the same packet as the head, then more after the 200
    let t = await talk(r.port, ['CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\nFIRST'], { then: 'SECOND' });
    assert.match(t.out, /^HTTP\/1\.1 200 Connection established\r\n\r\nECHO:FIRST(ECHO:SECOND)?/);
    assert.ok(t.out.includes('SECOND'), t.out);
    assert.deepStrictEqual(w.calls.pop(), { port: 443, address: '160.79.104.10', host: 'api.anthropic.com' });
    // byte by byte works too
    t = await talk(r.port, [...'CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n'], { then: 'X' });
    assert.match(t.out, /^HTTP\/1\.1 200 [^]*ECHO:X/);
    // an organization's host on its own port (step 5); an IP address on the list as written
    t = await talk(r.port, ['CONNECT otel.corp.example:4318 HTTP/1.1\r\n\r\n'], { then: 'span' });
    assert.match(t.out, /ECHO:span/);
    assert.deepStrictEqual(w.calls.pop(), { port: 4318, address: '10.1.2.3', host: 'otel.corp.example' });
    t = await talk(r.port, ['CONNECT 203.0.113.9:443 HTTP/1.1\r\n\r\n'], { then: 'ip' });
    assert.match(t.out, /ECHO:ip/);
    assert.deepStrictEqual(w.calls.pop(), { port: 443, address: '203.0.113.9', host: '203.0.113.9' });
    // refused: other hosts, other ports, look-alikes, plain proxying, junk
    const calls = w.calls.length;
    const lookups = w.lookups.length;
    for (const [req, status] of [
      ['CONNECT example.com:443 HTTP/1.1\r\n\r\n', 403],
      ['CONNECT api.anthropic.com:80 HTTP/1.1\r\n\r\n', 403],
      ['CONNECT api.anthropic.com.evil.example:443 HTTP/1.1\r\n\r\n', 403],
      ['CONNECT evil-api.anthropic.com:443 HTTP/1.1\r\n\r\n', 403],
      ['CONNECT otel.corp.example:443 HTTP/1.1\r\n\r\n', 403],
      ['CONNECT 160.79.104.10:443 HTTP/1.1\r\n\r\n', 403],
      ['CONNECT [::1]:443 HTTP/1.1\r\n\r\n', 403],
      ['GET http://api.anthropic.com/v1/messages HTTP/1.1\r\nHost: api.anthropic.com\r\n\r\n', 405],
      ['CONNECT api.anthropic.com:443 HTTP/1.1\nHost: x\n\n', 400],
      ['\x16\x03\x01\x02\x00\x01\x00\x01\xfc\x03\x03', 405],
    ]) {
      t = await talk(r.port, [req]);
      assert.match(t.out, new RegExp(`^HTTP/1\\.1 ${status} [^\\r]*\\r\\nconnection: close\\r\\ncontent-length: 0\\r\\n\\r\\n$`), JSON.stringify(req));
      assert.equal(t.timedOut, false);
    }
    assert.equal(w.calls.length, calls, 'nothing refused reached a host');
    assert.equal(w.lookups.length, lookups, 'nothing refused was even looked up');
    // what it saw, for the run's log and error (boxrefusals.fromProxy)
    const refused = r.seen.filter((x) => !x.allowed).map((x) => [x.target, x.reason]);
    assert.deepStrictEqual(refused, [
      ['example.com:443', 'not allowed'], ['api.anthropic.com:80', 'not allowed'], ['api.anthropic.com.evil.example:443', 'not allowed'],
      ['evil-api.anthropic.com:443', 'not allowed'], ['otel.corp.example:443', 'not allowed'], ['160.79.104.10:443', 'not allowed'], ['[::1]:443', 'not allowed'],
      ['api.anthropic.com:80', 'not CONNECT'], ["(a request the relay couldn't read)", 'bad line ending'], ["(a request the relay couldn't read)", 'not CONNECT'],
    ]);
    const first = r.seen.find((x) => x.allowed);
    assert.deepStrictEqual([first.target, first.up, first.down > 0], ['api.anthropic.com:443', 'FIRSTSECOND'.length, true]);
    assert.deepStrictEqual(require('../helper/lib/boxrefusals').fromProxy(r.seen)[0], { kind: 'proxy', target: 'example.com:443' });
    assert.equal(r.tunnels(), 0);
  } finally { await r.close(); w.close(); }
});

test('relay: an Anthropic host resolving to this computer (or nowhere) is refused; an org\'s local host may', async () => {
  const w = await world({ table: { 'api.anthropic.com': ['160.79.104.10', '127.0.0.1'], 'claude.ai': ['::1'], 'console.anthropic.com': [], 'collector.local.example': ['127.0.0.1'] } });
  const r = await relay.start({ allow: [...relay.ANTHROPIC, { host: 'collector.local.example', port: 4317, local: true }], connect: w.connect, lookup: w.lookup });
  try {
    for (const [host, status, allowed, why] of [['api.anthropic.com', 403, false, 'local address'], ['claude.ai', 403, false, 'local address'], ['console.anthropic.com', 502, true, 'no address'], ['platform.claude.com', 502, true, 'no address']]) {
      const t = await talk(r.port, [`CONNECT ${host}:443 HTTP/1.1\r\n\r\n`]);
      assert.match(t.out, new RegExp(`^HTTP/1\\.1 ${status} `), host);
      const e = r.seen[r.seen.length - 1];
      assert.deepStrictEqual([e.target, e.allowed, e.reason || e.failed], [`${host}:443`, allowed, why]);
    }
    // in a failed run's error (boxrefusals.js): the two refusals, not the hosts that couldn't be reached
    const br = require('../helper/lib/boxrefusals');
    assert.deepStrictEqual(br.fromProxy(r.seen).map((x) => br.describe(x)), ['a connection to api.anthropic.com:443 (an address on this computer)', 'a connection to claude.ai:443 (an address on this computer)']);
    assert.equal(br.describe(br.fromProxy([{ target: "(a request the relay couldn't read)", allowed: false }])[0]), "a request its network relay couldn't read");
    assert.equal(w.calls.length, 0);
    const t = await talk(r.port, ['CONNECT collector.local.example:4317 HTTP/1.1\r\n\r\n'], { then: 'x' });
    assert.match(t.out, /^HTTP\/1\.1 200 [^]*ECHO:x/);
  } finally { await r.close(); w.close(); }
});

test('relay: time limits, a host that won\'t answer, the cap on tunnels, close()', async () => {
  const w = await world({ table: { 'api.anthropic.com': ['160.79.104.10'] }, behave: 'quiet' });
  const r = await relay.start({ connect: w.connect, lookup: w.lookup, limits: { headMs: 200, connectMs: 300, idleMs: 300, maxTunnels: 2 } });
  try {
    // a request that never finishes its head
    let t = await talk(r.port, ['CONNECT api.anthropic.com:443 HTTP/1.1\r\nX: '], { then: 'never' });
    assert.match(t.out, /^HTTP\/1\.1 408 /);
    assert.equal(t.timedOut, false);
    // an idle tunnel is closed
    const t0 = Date.now();
    t = await new Promise((resolve) => {
      const s = net.connect(r.port, '127.0.0.1', () => s.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n'));
      let out = '';
      s.on('data', (d) => { out += d; });
      s.on('close', () => resolve({ out, ms: Date.now() - t0 }));
    });
    assert.match(t.out, /^HTTP\/1\.1 200 /);
    assert.ok(t.ms >= 250 && t.ms < 3000, `${t.ms} ms`);
    // the cap: two open tunnels, the third refused (503), and a place frees when one closes
    const hold = () => new Promise((resolve) => {
      const s = net.connect(r.port, '127.0.0.1', () => s.write('CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n'));
      s.once('data', () => { const keep = setInterval(() => s.write('.'), 100); s.on('close', () => clearInterval(keep)); resolve(s); });
    });
    const a = await hold();
    const b = await hold();
    assert.equal(r.tunnels(), 2);
    t = await talk(r.port, ['CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n']);
    assert.match(t.out, /^HTTP\/1\.1 503 /);
    a.destroy();
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(r.tunnels(), 1);
    const c = await hold();
    assert.equal(r.tunnels(), 2);
    // close() ends what's open
    const closed = Promise.all([b, c].map((s) => new Promise((res) => s.on('close', res))));
    await r.close();
    await closed;
  } finally { await r.close().catch(() => {}); w.close(); }
  // a host that doesn't take the connection
  const r2 = await relay.start({ connect: () => net.connect(1, '127.0.0.1'), lookup: async () => [{ address: '160.79.104.10', family: 4 }], limits: { connectMs: 300 } });
  try {
    const t = await talk(r2.port, ['CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n']);
    assert.match(t.out, /^HTTP\/1\.1 502 /);
    assert.deepStrictEqual([r2.seen[0].allowed, r2.seen[0].failed], [true, 'unreachable']);
    assert.equal(r2.tunnels(), 0);
  } finally { await r2.close(); }
});

// ------------------------------------------------------------------ fuzz-style

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEED = Number(process.env.TRIF_RELAY_FUZZ_SEED) || (Date.now() % 1e9);
const N = Number(process.env.TRIF_RELAY_FUZZ_N) || 20000;
const SEEDS = ['CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\nProxy-Connection: keep-alive\r\n\r\n',
  'CONNECT [2001:db8::1]:443 HTTP/1.0\r\n\r\n', 'CONNECT otel.corp.example:4318 HTTP/1.1\r\nUser-Agent: x\r\n\r\n\x16\x03\x01', 'GET http://example.com/ HTTP/1.1\r\n\r\n'];
const PIECES = ['\r', '\n', '\r\n', '\0', ' ', '\t', ':', '[', ']', '.', '..', '@', '%', '443', '0', '65536', 'CONNECT ', 'HTTP/1.1', 'api.anthropic.com', 'API', '\xff', '\x7f', 'é', '\r\n\r\n', 'X: y\r\n'];

function mutate(r, s) {
  let b = s;
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const at = Math.floor(r() * (b.length + 1));
    const k = r();
    if (k < 0.3) b = b.slice(0, at) + PIECES[Math.floor(r() * PIECES.length)] + b.slice(at);
    else if (k < 0.5) b = b.slice(0, at) + b.slice(at + 1 + Math.floor(r() * 4));
    else if (k < 0.7) b = b.slice(0, at) + String.fromCharCode(Math.floor(r() * 256)) + b.slice(at + 1);
    else if (k < 0.8) b = b.slice(0, at);
    else if (k < 0.9) b = b.slice(0, at) + b.slice(at, at + 20).repeat(1 + Math.floor(r() * 3)) + b.slice(at + 20);
    else b = Array.from({ length: Math.floor(r() * 60) }, () => String.fromCharCode(Math.floor(r() * 256))).join('');
  }
  return b;
}
const ONE = (p) => ('more' in p ? Object.keys(p).length === 1 && p.more === true
  : p.ok === true ? Object.keys(p).sort().join() === 'end,host,ok,port'
    : p.ok === false && [400, 405, 431].includes(p.status) && typeof p.reason === 'string');

test(`fuzz: the parser never throws, answers one of its three ways, and accepts only clean CONNECTs (seed ${SEED}, ${N} inputs)`, () => {
  const r = rng(SEED);
  let accepted = 0;
  for (let i = 0; i < N; i++) {
    const input = mutate(r, SEEDS[Math.floor(r() * SEEDS.length)]);
    const buf = Buffer.from(input, 'latin1');
    let p;
    try { p = parseHead(buf); } catch (e) { assert.fail(`threw on ${JSON.stringify(input)} (seed ${SEED}): ${e.stack}`); }
    assert.ok(ONE(p), `odd answer ${JSON.stringify(p)} for ${JSON.stringify(input)} (seed ${SEED})`);
    if (p.ok) {
      accepted++;
      // what it accepted: a normalised host, a real port, and the head exactly as a clean request would be
      assert.equal(normHost(p.host), p.host, JSON.stringify(input));
      assert.ok(Number.isInteger(p.port) && p.port >= 1 && p.port <= 65535);
      assert.ok(p.end <= buf.length && p.end <= relay.MAX_HEAD);
      const head = input.slice(0, p.end);
      assert.match(head, /^CONNECT [^ \r\n]+ HTTP\/1\.[01]\r\n([!#$%&'*+.^_`|~0-9A-Za-z-]+:[\t\x20-\x7e\x80-\xff]*\r\n)*\r\n$/, JSON.stringify(input));
      const t = parseTarget(/^CONNECT ([^ ]+) /.exec(head)[1]);
      assert.deepStrictEqual([t.host, t.port], [p.host, p.port]);
      assert.deepStrictEqual(parseHead(Buffer.from(head, 'latin1')), p, 'the same without what follows');
    }
    // The same bytes in pieces: the first answer that isn't "more" agrees with the whole (accepted or
    // not; if accepted, the same target), so a request split anywhere can't read as another one.
    const cut = 1 + Math.floor(r() * Math.max(1, buf.length));
    let early = null;
    for (let k = cut; k < buf.length; k += cut) {
      const q = parseHead(buf.subarray(0, k));
      assert.ok(ONE(q));
      if (!q.more) { early = q; break; }
    }
    if (early) {
      assert.equal(early.ok, p.ok, `a prefix said ${JSON.stringify(early)}, the whole ${JSON.stringify(p)}: ${JSON.stringify(input)} (seed ${SEED})`);
      if (p.ok) assert.deepStrictEqual(early, p);
    }
  }
  assert.ok(accepted > N / 50, `few inputs accepted (${accepted}): the mutations are too rough to test acceptance`);
});

test(`fuzz: the running relay connects only to listed targets, answers or closes every connection, and keeps working (seed ${SEED})`, async () => {
  const r0 = rng(SEED ^ 0x5eed);
  const w = await world({ table: { 'api.anthropic.com': ['160.79.104.10'], 'otel.corp.example': ['10.1.2.3'] } });
  const r = await relay.start({ allow: [...relay.ANTHROPIC, { host: 'otel.corp.example', port: 4318 }], connect: w.connect, lookup: w.lookup, limits: { headMs: 300, idleMs: 500 } });
  const LISTED = new Set(['api.anthropic.com:443', 'otel.corp.example:4318']);
  try {
    const M = Math.max(200, Math.floor(N / 50));
    for (let batch = 0; batch < M; batch += 20) {
      await Promise.all(Array.from({ length: Math.min(20, M - batch) }, () => {
        const input = Buffer.from(mutate(r0, SEEDS[Math.floor(r0() * SEEDS.length)]), 'latin1');
        const chunks = [];
        for (let k = 0; k < input.length;) { const n = 1 + Math.floor(r0() * 40); chunks.push(input.subarray(k, k + n)); k += n; }
        return talk(r.port, chunks, { gap: r0() < 0.2 ? 2 : 0, timeout: 4000 }).then((t) => {
          assert.equal(t.timedOut, false, `a connection the relay neither answered nor closed: ${JSON.stringify(input.toString('latin1'))} (seed ${SEED})`);
          if (t.out) assert.match(t.out, /^HTTP\/1\.1 (200|400|403|405|408|431|502|503) /, `${JSON.stringify(input.toString('latin1'))} (seed ${SEED})`);
        });
      }));
    }
    for (const c of w.calls) assert.ok(LISTED.has(`${c.host}:${c.port}`), `connected to ${JSON.stringify(c)} (seed ${SEED})`);
    for (const h of w.lookups) assert.ok(['api.anthropic.com', 'otel.corp.example'].includes(h), `looked up ${h}`);
    for (const e of r.seen.filter((x) => x.allowed)) assert.ok(LISTED.has(e.target), e.target);
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(r.tunnels(), 0, 'every tunnel let go');
    // still works
    const t = await talk(r.port, ['CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\nok']);
    assert.match(t.out, /^HTTP\/1\.1 200 [^]*ECHO:ok/);
    console.log(`# relay fuzz (seed ${SEED}): ${M} connections, ${w.calls.length} tunnels to listed hosts, ${r.seen.filter((x) => !x.allowed).length} refused`);
  } finally { await r.close(); w.close(); }
});

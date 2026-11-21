'use strict';
// The phone link's listener (helper/lib/phonelink/server.js; docs/PHONE-LINK.md "The wire" and rule 2): no
// listener while the store says none, zero bytes for anyone who isn't a paired phone, sessions for those who are.
// Everything here binds 127.0.0.1 on a port the system picks, in a temp workspace with a fake keychain, and is
// stopped at the end.

const test = require('./on-windows')(__filename);
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { tempDir, sleep } = require('./fake-extension');
const { makeFakeKeychain } = require('./fake-keychain');
const { PhoneClient } = require('./phone-link-client');
const { Store, MAX_TRIES } = require('../helper/lib/phonelink/store');
const { Server, MAX_CONNECTIONS } = require('../helper/lib/phonelink/server');
const { generateKeyPair, keyId } = require('../helper/lib/phonelink/noise');
const { packet } = require('../helper/lib/phonelink/frames');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

const b64 = (b) => Buffer.from(b).toString('base64url');
const FIRST = 500; // (the first-message limit in these tests, ms)

/** A store (link on unless `on: false`) and a server on 127.0.0.1, in a temp workspace. */
async function setup({ on = true, ...opts } = {}) {
  const root = tempDir('wm-plsrv-');
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const chain = makeFakeKeychain(path.join(root, 'keychain'));
  const store = new Store(home, { env: { ...chain.env }, name: 'Test Mac' });
  const lines = [];
  const server = new Server(store, { version: '9.9.9', host: '127.0.0.1', port: 0, firstMessageMs: FIRST, log: (l) => lines.push(l), ...opts });
  cleanups.push(async () => { store.pairStop(); await server.stop(); });
  if (on) await store.setOn(true);
  await server.start();
  const computerKey = on ? (await store.keys()).publicKey : null;
  /** Opens a window and pairs a new phone through the listener: the connected stand-in phone, its session made. */
  const pair = async (name = 'Test iPhone', keys = generateKeyPair()) => {
    const { secret } = store.pairStart();
    const port = await server.sync();
    const phone = await PhoneClient.connect({ port, computerKey, keys, name, pair: secret });
    cleanups.push(() => phone.close());
    await phone.request({ t: 'ping' }); // (its first message, in time: q1)
    return phone;
  };
  return { root, home, store, server, lines, computerKey, pair, chain };
}

/** Connects, writes `bytes` (if any), and resolves how the computer treated it: {bytes, ms} at the close. */
function knock(port, bytes) {
  return new Promise((resolve, reject) => {
    const began = Date.now();
    let got = 0;
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.on('connect', () => { if (bytes) socket.write(bytes); });
    socket.on('data', (c) => { got += c.length; });
    socket.on('error', (e) => { if (e.code !== 'ECONNRESET' && e.code !== 'EPIPE') reject(e); }); // (a reset is a close too)
    socket.on('close', () => resolve({ bytes: got, ms: Date.now() - began }));
    setTimeout(() => { socket.destroy(); reject(new Error('the computer left the connection open')); }, 5000).unref();
  });
}

const refusedConnect = (port) => new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.on('connect', () => { socket.destroy(); resolve(false); });
  socket.on('error', (e) => resolve(e.code === 'ECONNREFUSED'));
});

/** connect() must fail with the computer having said nothing. */
async function silent(options) {
  await assert.rejects(PhoneClient.connect(options), (e) => {
    assert.equal(e.code, 'closed');
    assert.equal(e.bytes, 0, 'not one byte came back');
    return true;
  });
}

test('no listener at all: a new install, the link on with nobody paired, and after the window closes', async () => {
  const { store, server } = await setup({ on: false });
  assert.equal(server.address(), null, 'a new install');
  assert.equal(await server.sync(), 0);
  await store.setOn(true);
  assert.equal(await server.sync(), 0, 'on, nobody paired, no window');
  assert.equal(server.address(), null);

  store.pairStart();
  const port = await server.sync();
  assert.ok(port > 0, 'a window is open: listening');
  assert.equal(server.address().address, '127.0.0.1');
  assert.equal(store.status().port, port, 'the port is kept');

  store.pairStop();
  assert.equal(await server.sync(), 0);
  assert.equal(server.address(), null);
  assert.equal(await refusedConnect(port), true, 'nothing answers on the port');
});

test('garbage, a late first message, and silence each get zero bytes and a closed socket', async () => {
  const { store, server } = await setup();
  store.pairStart();
  const port = await server.sync();

  const garbage = await knock(port, packet(crypto.randomBytes(200)));
  assert.equal(garbage.bytes, 0);
  assert.ok(garbage.ms < FIRST, 'closed at once');

  const short = await knock(port, packet(Buffer.from('hi')));
  assert.equal(short.bytes, 0);

  const http = await knock(port, Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
  assert.equal(http.bytes, 0, 'no banner for a browser either'); // (its "length" is 18245: the rest never comes)
  assert.ok(http.ms >= FIRST - 50, 'closed when the time for a first message was up');

  const quiet = await knock(port, null);
  assert.equal(quiet.bytes, 0);
  assert.ok(quiet.ms >= FIRST - 50);

  // A first message that comes too slowly: the time is for the whole message, not from byte to byte.
  const slow = await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let got = 0;
    const began = Date.now();
    const drip = setInterval(() => { if (!socket.destroyed) socket.write(Buffer.from([0])); }, 50);
    socket.on('data', (c) => { got += c.length; });
    socket.on('error', () => {});
    socket.on('close', () => { clearInterval(drip); resolve({ bytes: got, ms: Date.now() - began }); });
    setTimeout(() => { clearInterval(drip); socket.destroy(); reject(new Error('left open')); }, 5000).unref();
  });
  assert.equal(slow.bytes, 0);
  assert.ok(slow.ms < FIRST * 3);
  assert.ok(server.stats.refused >= 5);
  assert.equal(server.stats.sessions, 0);
});

test('an unpaired key, a wrong secret and a bad first payload get zero bytes; five wrong secrets close the window and the listener', async () => {
  const { store, server, computerKey } = await setup();
  const { secret } = store.pairStart();
  const port = await server.sync();

  await silent({ port, computerKey }); // (knows the computer's key, isn't paired, no secret)
  await silent({ port, computerKey: generateKeyPair().publicKey, pair: secret }); // (the right secret to the wrong key)
  await silent({ port, computerKey, payload: 'not json' });
  await silent({ port, computerKey, payload: { v: 2, name: 'x', pair: secret } });
  await silent({ port, computerKey, payload: [1] });
  assert.deepEqual(store.list(), [], 'none of that paired anyone or used the window up');
  assert.ok(store.pairing());

  for (let i = 0; i < MAX_TRIES; i++) await silent({ port, computerKey, pair: b64(crypto.randomBytes(16)) });
  assert.equal(store.pairing(), null, 'the window closed');
  assert.equal(await server.sync(), 0, 'and with nobody paired, so did the listener');
  assert.equal(await refusedConnect(port), true);
  assert.deepEqual(store.list(), []);
});

test('pairing through the listener: the answer, hello, ping, last seen; then again without the secret', async () => {
  const { store, server, computerKey, lines } = await setup();
  const keys = generateKeyPair();
  const sessions = [];
  server.on('session', (s) => sessions.push(s));
  const { secret } = store.pairStart();
  const port = await server.sync();
  const phone = await PhoneClient.connect({ port, computerKey, keys, name: 'Tim’s iPhone', pair: secret });
  assert.deepEqual(phone.answer, { v: 1, name: 'Test Mac', paired: true });
  assert.equal(store.pairing(), null, 'one phone per window');
  assert.deepEqual(store.list().map((p) => [p.id, p.name]), [[keyId(keys.publicKey), 'Tim’s iPhone']]);
  assert.equal(sessions.length, 0, 'not a session until its first message decrypts');

  const hello = await phone.request({ t: 'hello', app: '0.1', device: { name: 'iPhone 16', width: 393, height: 852 } });
  assert.deepEqual(hello, { agent: null, pending: [], t: 'hello', v: 1, version: '9.9.9', name: 'Test Mac', id: 'q1' });
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].phone, { id: keyId(keys.publicKey), name: 'Tim’s iPhone' });
  assert.deepEqual(sessions[0].hello, { app: '0.1', device: { name: 'iPhone 16', width: 393, height: 852 } });
  assert.deepEqual(await phone.request({ t: 'ping' }), { t: 'pong', id: 'q2' });
  assert.equal(server.sessions.size, 1);
  await phone.close();
  await sleep(50);
  assert.equal(server.sessions.size, 0);
  assert.equal(sessions[0].open, false);

  // The listener stays (a phone is paired). The phone comes back with its key alone, and also with the used
  // secret (its pairing answer could have been lost): it is paired either way.
  assert.equal(await server.sync(), port);
  for (const again of [{}, { pair: secret }]) {
    const back = await PhoneClient.connect({ port, computerKey, keys, ...again });
    assert.deepEqual(await back.request({ t: 'ping' }), { t: 'pong', id: 'q1' });
    await back.close();
  }
  // Another phone can't use that secret again.
  await silent({ port, computerKey, pair: secret });
  assert.equal(store.list().length, 1);

  // Nothing secret reached the log, and no line per refusal.
  const log = lines.join('\n');
  assert.ok(!log.includes(secret) && !log.includes(b64(computerKey)) && !log.includes(b64(keys.publicKey)));
  assert.ok(lines.length <= 4, log);
});

test('what a session may ask: a registered handler, an unknown type, a handler that throws, a big message in pieces', async () => {
  const { server, pair } = await setup();
  server.handle('echo', (session, msg) => ({ t: 'echo', back: msg.data, from: session.phone.name }));
  server.handle('later', async () => { await sleep(20); return {}; });
  server.handle('quiet', () => undefined);
  server.handle('busy', () => { throw Object.assign(new Error('a run is already working there'), { code: 'busy' }); });
  server.handle('broken', async () => { throw new Error('oops'); });
  const phone = await pair('Echo phone');

  assert.deepEqual(await phone.request({ t: 'echo', data: 'hi' }), { t: 'echo', back: 'hi', from: 'Echo phone', id: 'q2' });
  assert.deepEqual(await phone.request({ t: 'later' }), { t: 'ok', id: 'q3' });
  assert.deepEqual(await phone.request({ t: 'busy' }), { t: 'error', code: 'busy', message: 'a run is already working there', id: 'q4' });
  assert.deepEqual(await phone.request({ t: 'broken' }), { t: 'error', code: 'bad-request', message: 'oops', id: 'q5' });
  for (const t of ['phone.remove', 'pair.start', 'constructor', '', 7]) {
    const no = await phone.request({ t });
    assert.equal(no.t, 'error');
    assert.equal(no.code, 'bad-request');
  }
  phone.send({ t: 'quiet', id: 'never' });
  const big = crypto.randomBytes(150000).toString('base64'); // (200 KB: four pieces each way)
  const echoed = await phone.request({ t: 'echo', data: big });
  assert.equal(echoed.back, big);
  assert.equal(phone.kept.length, 0, 'nothing came for the quiet one');
});

test('removing a phone closes its open session, and it gets nothing the next time; the other phone stays', async () => {
  const { store, server, computerKey, pair } = await setup();
  const keysA = generateKeyPair();
  const a = await pair('Phone A', keysA);
  const b = await pair('Phone B');
  await a.request({ t: 'ping' });
  await b.request({ t: 'ping' });
  assert.equal(server.sessions.size, 2);
  const port = server.address().port;

  assert.deepEqual(store.remove(keyId(keysA.publicKey)), { id: keyId(keysA.publicKey), name: 'Phone A' });
  await server.sync();
  await a.closed;
  assert.equal(server.sessions.size, 1);
  assert.deepEqual(await b.request({ t: 'ping' }), { t: 'pong', id: 'q3' });
  await silent({ port, computerKey, keys: keysA });

  // The last phone removed: its session closes and nothing listens any more.
  store.remove(store.list()[0].id);
  assert.equal(await server.sync(), 0);
  await b.closed;
  assert.equal(await refusedConnect(port), true);
});

test('turning the link off closes sessions and the listener; on again, the same phone connects', async () => {
  const { store, server, computerKey, pair } = await setup();
  const keys = generateKeyPair();
  const phone = await pair('Phone', keys);
  await phone.request({ t: 'ping' });
  const port = server.address().port;
  await store.setOn(false);
  assert.equal(await server.sync(), 0);
  await phone.closed;
  assert.equal(server.sessions.size, 0);
  assert.equal(await refusedConnect(port), true);

  await store.setOn(true);
  const again = await server.sync();
  assert.ok(again > 0);
  const back = await PhoneClient.connect({ port: again, computerKey, keys });
  assert.deepEqual(await back.request({ t: 'ping' }), { t: 'pong', id: 'q1' });
  await back.close();
});

test('a copied first message played again: answered once more, never a session, the real phone untouched', async () => {
  const { store, server, pair } = await setup();
  const phone = await pair('Real phone');
  await phone.request({ t: 'ping' });
  const port = server.address().port;
  const seenBefore = store.list()[0].lastSeen;
  const sessionsBefore = server.stats.sessions;
  await sleep(5);

  const replay = await knock(port, phone.firstMessage);
  assert.ok(replay.bytes > 0, 'the handshake\'s answer (only the real phone can read it)');
  assert.ok(replay.bytes < 200);
  assert.ok(replay.ms >= FIRST - 50, 'then closed when no message it could make came');
  assert.equal(server.stats.sessions, sessionsBefore, 'never a session');
  assert.equal(store.list()[0].lastSeen, seenBefore, 'last seen didn\'t move');
  assert.deepEqual(await phone.request({ t: 'ping' }), { t: 'pong', id: 'q3' }, 'the real phone\'s session is still there');

  // The same, followed by bytes that aren't a message of that session.
  const forged = await knock(port, Buffer.concat([phone.firstMessage, packet(crypto.randomBytes(40))]));
  assert.ok(forged.ms < FIRST, 'closed at once');
  assert.equal(server.stats.sessions, sessionsBefore);
  assert.deepEqual(await phone.request({ t: 'ping' }), { t: 'pong', id: 'q4' });
});

test('one session per phone: the phone\'s new connection closes its old one once it has proven itself', async () => {
  const { server, computerKey, pair } = await setup();
  const keys = generateKeyPair();
  const old = await pair('Phone', keys);
  await old.request({ t: 'ping' });
  const port = server.address().port;
  const fresh = await PhoneClient.connect({ port, computerKey, keys });
  await sleep(30);
  assert.equal(old.isClosed, false, 'connected, but hasn\'t said anything yet');
  assert.deepEqual(await fresh.request({ t: 'ping' }), { t: 'pong', id: 'q1' });
  await old.closed;
  assert.equal(server.sessions.size, 1);
  await fresh.close();
});

test('a transport message that doesn\'t check closes the session; a quiet session is closed after the idle time', async () => {
  const { server, pair } = await setup({ idleMs: 250 });
  const phone = await pair();
  await phone.request({ t: 'ping' });
  phone.raw(packet(crypto.randomBytes(64)));
  await phone.closed;
  await sleep(20);
  assert.equal(server.sessions.size, 0);

  const quiet = await pair('Quiet phone');
  await quiet.request({ t: 'ping' });
  const began = Date.now();
  await quiet.closed;
  assert.ok(Date.now() - began >= 200, 'not before the idle time');
});

test(`at most ${MAX_CONNECTIONS} connections: the next one is closed with nothing`, async () => {
  const { store, server } = await setup({ firstMessageMs: 1500 });
  store.pairStart();
  const port = await server.sync();
  const held = [];
  for (let i = 0; i < MAX_CONNECTIONS; i++) {
    held.push(await new Promise((resolve, reject) => {
      const s = net.connect({ host: '127.0.0.1', port });
      s.on('connect', () => resolve(s));
      s.on('error', reject);
    }));
  }
  await sleep(50);
  const extra = await knock(port, null);
  assert.equal(extra.bytes, 0);
  assert.ok(extra.ms < 1000, 'at once, not after the first-message time');
  for (const s of held) s.destroy();
});

test('the kept port is asked for again; when it is taken, any port', async () => {
  const { store, server } = await setup({ port: undefined });
  store.pairStart();
  const port = await server.sync();
  assert.equal(store.status().port, port);
  await server.stop();
  assert.equal(server.address(), null);

  const squatter = net.createServer();
  await new Promise((resolve) => squatter.listen({ host: '127.0.0.1', port }, resolve));
  cleanups.push(() => new Promise((resolve) => squatter.close(resolve)));
  const second = new Server(store, { host: '127.0.0.1' });
  cleanups.push(() => second.stop());
  const other = await second.start();
  assert.ok(other > 0 && other !== port);
  assert.equal(store.status().port, other);
  await second.stop();
  await new Promise((resolve) => squatter.close(resolve));

  const third = new Server(store, { host: '127.0.0.1' });
  cleanups.push(() => third.stop());
  assert.equal(await third.start(), other, 'the kept port again');
  await third.stop();
});

test('stop() ends it: no listener, sessions closed, and the store\'s changes are no longer followed', async () => {
  const { store, server, pair } = await setup();
  const phone = await pair();
  await phone.request({ t: 'ping' });
  const port = server.address().port;
  await server.stop();
  await phone.closed;
  assert.equal(await refusedConnect(port), true);
  store.pairStart();
  assert.equal(await server.sync(), 0);
  assert.equal(server.address(), null);
  assert.equal(store.listenerCount('change'), 0);
});

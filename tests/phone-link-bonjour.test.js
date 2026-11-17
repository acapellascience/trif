'use strict';
// The phone link's announcer (helper/lib/phonelink/bonjour.js; docs/PHONE-LINK.md section 5): one `dns-sd -R`
// child while the listener is up, none otherwise. The real dns-sd never runs here (it would announce on the
// Wi-Fi): every announcer gets TRIF_DNS_SD, a stand-in that writes its pid and arguments to calls.log and
// waits. The listener binds 127.0.0.1 on a port the system picks; everything is stopped at the end.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { tempDir, sleep, waitFor } = require('./fake-extension');
const { makeFakeKeychain } = require('./fake-keychain');
const { PhoneClient } = require('./phone-link-client');
const { makeStandIn } = require('./fake-dns-sd');
const { Store } = require('../helper/lib/phonelink/store');
const { Server } = require('../helper/lib/phonelink/server');
const { generateKeyPair } = require('../helper/lib/phonelink/noise');
const { Announcer, BIN, LABEL_MAX, instanceName, recordArgs, pause } = require('../helper/lib/phonelink/bonjour');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
const untilGone = (pid) => waitFor(() => gone(pid), { message: `process ${pid} to end` });

/** A store, a listener on 127.0.0.1 and an announcer with the stand-in, in a temp workspace. */
async function setup({ name = 'Test Mac', on = true, bin, ...opts } = {}) {
  const root = tempDir('wm-plbj-');
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const chain = makeFakeKeychain(path.join(root, 'keychain'));
  const standIn = makeStandIn(path.join(root, 'bin'));
  const store = new Store(home, { env: { ...chain.env }, name });
  const lines = [];
  const server = new Server(store, { version: '9.9.9', host: '127.0.0.1', port: 0, firstMessageMs: 500 });
  const announcer = new Announcer(store, server, { env: { TRIF_DNS_SD: bin || standIn.bin }, platform: 'darwin', log: (l) => lines.push(l), retryMs: 20, retryMaxMs: 80, ...opts });
  cleanups.push(async () => {
    store.pairStop();
    announcer.stop();
    await server.stop();
    for (const c of standIn.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
  });
  if (on) await store.setOn(true);
  await server.start();
  announcer.start();
  /** The listener up (a pairing window open), and the announcer's first child for it. */
  const listen = async () => {
    const before = standIn.calls().length;
    const { secret } = store.pairStart();
    const port = await server.sync();
    assert.ok(port > 0);
    const call = await waitFor(() => standIn.calls()[before], { message: 'the announcer to start' });
    await waitFor(() => announcer.status().running, { message: 'the announcer to be running' });
    return { port, secret, call };
  };
  return { root, store, server, announcer, standIn, lines, listen };
}

test('the arguments: one record, the name whole, 63 bytes at most', () => {
  assert.deepStrictEqual(recordArgs({ name: 'Test Mac', port: 51234, id: '0123456789abcdef' }),
    ['-R', 'Test Mac', '_trif._tcp', 'local', '51234', 'v=1', 'id=0123456789abcdef']);
  assert.strictEqual(instanceName('Tim’s MacBook Pro'), 'Tim’s MacBook Pro');
  const long = instanceName('é'.repeat(60));
  assert.strictEqual(long, 'é'.repeat(31)); // (62 bytes: never half a character)
  assert.ok(Buffer.byteLength(instanceName('😀'.repeat(40))) <= LABEL_MAX);
  assert.strictEqual(instanceName(''), 'TRIF');
  assert.strictEqual(instanceName(null), 'TRIF');
  assert.strictEqual(BIN, '/usr/bin/dns-sd');
});

test('the pauses grow: 1 s, 2 s, 4 s … 30 s', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 50].map((n) => pause(n)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('no child while nothing listens; the exact arguments once it does', async () => {
  const { store, server, announcer, standIn, listen } = await setup();
  // (the link is on, but nobody is paired or pairing: no listener, no record)
  assert.strictEqual(server.address(), null);
  await sleep(150);
  assert.deepStrictEqual(standIn.calls(), []);
  assert.deepStrictEqual(announcer.status(), { running: false, error: null, record: null });

  const { port, call } = await listen();
  const id = store.status().id;
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.deepStrictEqual(call.argv, ['-R', 'Test Mac', '_trif._tcp', 'local', String(port), 'v=1', `id=${id}`]);
  assert.deepStrictEqual(announcer.status(), { running: true, error: null, record: { name: 'Test Mac', port, id } });
  // (the store changing without the record changing starts nothing new)
  store.pairStop();
  store.pairStart();
  await server.sync();
  await sleep(150);
  assert.strictEqual(standIn.calls().length, 1);
  assert.ok(!gone(call.pid));
});

test('stop() ends the child, and nothing starts after it', async () => {
  const { store, server, announcer, standIn, listen } = await setup();
  const { call } = await listen();
  let changes = 0;
  announcer.on('change', () => { changes++; });
  announcer.stop();
  await untilGone(call.pid);
  assert.deepStrictEqual(announcer.status(), { running: false, error: null, record: null });
  assert.strictEqual(changes, 1);
  store.pairStop();
  store.pairStart();
  await server.sync();
  await sleep(150);
  assert.strictEqual(standIn.calls().length, 1);
});

test('the link turned off ends the child; on again, a new record for the new port', async () => {
  const { store, server, announcer, standIn, listen } = await setup();
  const first = await listen();
  await store.setOn(false);
  assert.strictEqual(await server.sync(), 0);
  await untilGone(first.call.pid);
  assert.strictEqual(announcer.status().record, null);
  assert.strictEqual(announcer.status().running, false);

  await store.setOn(true);
  const second = await listen();
  assert.strictEqual(standIn.calls().length, 2);
  assert.notStrictEqual(second.call.pid, first.call.pid);
  assert.deepStrictEqual(second.call.argv, ['-R', 'Test Mac', '_trif._tcp', 'local', String(second.port), 'v=1', `id=${store.status().id}`]);
});

test('the last phone removed ends the child', async () => {
  const { store, server, announcer, standIn, listen } = await setup();
  const { port, secret, call } = await listen();
  const phone = await PhoneClient.connect({ port, computerKey: (await store.keys()).publicKey, keys: generateKeyPair(), name: 'Test iPhone', pair: secret });
  cleanups.push(() => phone.close());
  await phone.request({ t: 'ping' });
  // (paired: the window is closed, the listener stays for the phone, and so does the record)
  assert.strictEqual(store.pairing(), null);
  assert.strictEqual(await server.sync(), port);
  assert.ok(!gone(call.pid));
  assert.strictEqual(standIn.calls().length, 1);

  const [row] = store.list();
  assert.ok(store.remove(row.id));
  assert.strictEqual(await server.sync(), 0);
  await untilGone(call.pid);
  assert.deepStrictEqual(announcer.status(), { running: false, error: null, record: null });
});

test('a child that dies is started again, after pauses that grow', async () => {
  const { announcer, standIn, lines, listen } = await setup();
  const { call } = await listen();
  process.kill(call.pid, 'SIGKILL');
  const again = await waitFor(() => standIn.calls()[1], { message: 'the announcer to start again' });
  assert.notStrictEqual(again.pid, call.pid);
  assert.deepStrictEqual(again.argv, call.argv);
  await waitFor(() => announcer.status().running, { message: 'running again' });
  assert.strictEqual(announcer.status().error, null);
  assert.ok(lines.some((l) => /the announcer stopped \(SIGKILL\)/.test(l)), lines.join('\n'));

  // (one that leaves at once: tried again and again, 'failing' meanwhile, and ended for good by stop())
  standIn.die(true);
  process.kill(again.pid, 'SIGKILL');
  await waitFor(() => standIn.calls().length >= 5, { message: 'more starts' });
  await waitFor(() => announcer.status().error === 'failing', { message: 'the failing state' });
  announcer.stop();
  await sleep(200);
  const n = standIn.calls().length;
  await sleep(200);
  assert.strictEqual(standIn.calls().length, n);
  assert.strictEqual(announcer.status().error, null);
});

test('no dns-sd: said once, nothing started, not tried again', async () => {
  const root = tempDir('wm-plbj-none-');
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const { store, server, announcer, standIn, lines } = await setup({ bin: path.join(root, 'nowhere', 'dns-sd') });
  store.pairStart();
  const port = await server.sync();
  await waitFor(() => announcer.status().error === 'missing', { message: 'the missing state' });
  assert.strictEqual(announcer.status().running, false);
  assert.strictEqual(announcer.status().record.port, port);
  await sleep(200);
  assert.deepStrictEqual(standIn.calls(), []);
  const said = () => lines.filter((l) => /can't announce/.test(l));
  assert.strictEqual(said().length, 1);
  assert.match(said()[0], /ENOENT/);
  // (a new record is one more try, not one more line)
  await store.setOn(false);
  await server.sync();
  assert.strictEqual(announcer.status().error, null);
  await store.setOn(true);
  store.pairStart();
  await server.sync();
  await waitFor(() => announcer.status().error === 'missing', { message: 'the missing state again' });
  assert.strictEqual(said().length, 1);
});

test('the name is one argument, whatever is in it', async () => {
  const name = '-R "x" $(touch pwned) `touch pwned`; touch pwned \\ \'é\' _http._tcp';
  const { root, store, standIn, listen } = await setup({ name });
  const { port, call } = await listen();
  assert.strictEqual(call.argv.length, 7);
  assert.strictEqual(call.argv[1], instanceName(store.name));
  assert.ok(call.argv[1].includes('$(touch pwned)'));
  assert.deepStrictEqual(call.argv.slice(2), ['_trif._tcp', 'local', String(port), 'v=1', `id=${store.status().id}`]);
  for (const dir of [root, standIn.dir, process.cwd()]) assert.ok(!fs.existsSync(path.join(dir, 'pwned')));
});

test('not a Mac: nothing started, "unsupported"', async () => {
  const { store, server, announcer, standIn } = await setup({ platform: 'linux' });
  store.pairStart();
  const port = await server.sync();
  assert.ok(port > 0);
  await sleep(150);
  assert.deepStrictEqual(standIn.calls(), []);
  assert.deepStrictEqual(announcer.status(), { running: false, error: 'unsupported', record: { name: 'Test Mac', port, id: store.status().id } });
  announcer.stop();
  assert.strictEqual(announcer.status().error, 'unsupported');
});

test('the child never outlives the process that started it', async () => {
  const root = tempDir('wm-plbj-exit-');
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const standIn = makeStandIn(path.join(root, 'bin'));
  cleanups.push(() => { for (const c of standIn.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } } });
  // (a small helper of its own: a listener and a store that are just enough, then process.exit())
  const script = `
    const { EventEmitter } = require('events');
    const fs = require('fs');
    const { Announcer } = require(${JSON.stringify(path.join(__dirname, '..', 'helper', 'lib', 'phonelink', 'bonjour.js'))});
    const store = Object.assign(new EventEmitter(), { name: 'Exit Mac', status: () => ({ id: '00112233445566ff' }) });
    const server = Object.assign(new EventEmitter(), { address: () => ({ address: '127.0.0.1', port: 51999 }) });
    new Announcer(store, server, { env: { TRIF_DNS_SD: process.argv[1] }, platform: 'darwin' }).start();
    const log = process.argv[2];
    const timer = setInterval(() => { if (fs.existsSync(log)) { clearInterval(timer); process.exit(0); } }, 20);
  `;
  const helper = spawn(process.execPath, ['-e', script, standIn.bin, path.join(standIn.dir, 'calls.log')], { stdio: 'ignore' });
  const code = await new Promise((resolve) => helper.once('exit', resolve));
  assert.strictEqual(code, 0);
  const [call] = standIn.calls();
  assert.deepStrictEqual(call.argv, ['-R', 'Exit Mac', '_trif._tcp', 'local', '51999', 'v=1', 'id=00112233445566ff']);
  await untilGone(call.pid);
});

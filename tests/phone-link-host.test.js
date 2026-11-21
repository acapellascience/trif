'use strict';
// The phone link in the real helper (helper/host.js with lib/phonelink/link.js; docs/PHONE-LINK.md): host.js
// run as a browser would run it, in a temp workspace, with a fake extension as the side panel, a fake
// keychain, a stand-in dns-sd (the real one never runs: it would announce on the Wi-Fi) and a stand-in phone.
// The listener is on 127.0.0.1 alone (TRIF_PHONE_LINK_HOST, tests/fake-extension.js testEnv), at a port the
// system picks. What is proven here:
//   - a new install has no link: no file, no key asked for, nothing listening, nothing announced;
//   - `phone.*` is the side panel's alone: refused on the socket (a terminal, a run), unchanged by the try;
//   - turned on, still nothing listens until a phone may pair; the QR's secret goes to the panel that asked
//     and nowhere else (no file, no log, no other message);
//   - a phone pairs with the QR, a stranger gets not one byte, the panel is told when the list changes;
//   - a second helper (another browser) has no listener of its own: its panel's phone.* go to the owner through
//     helper.sock (lib/phonelink/relay.js, with the relay key from the private folder: refused without it, and
//     never from a run), so it shows the owner's link, opens a pairing window there, removes a phone (the owner
//     drops it at once) and asks the phones to sync; the owner's news reaches its panel too;
//   - Sync now: each connected phone is told to sync (sync.changed), from either browser's panel;
//   - when the owner goes, its listener and its announcement go with it, and the helper that takes
//     helper.sock takes the link on the same port: the paired phone reaches it with the keys it has;
//   - with an owner that can't relay (a helper from before it), the panel names the owner's browser;
//   - turned off: nothing listens, nothing is announced, the phone is closed.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { FakeExtension, tempDir, waitFor } = require('./fake-extension');
const { makeFakeKeychain } = require('./fake-keychain');
const { makeStandIn } = require('./fake-dns-sd');
const { PhoneClient } = require('./phone-link-client');
const { generateKeyPair, keyId } = require('../helper/lib/phonelink/noise');
const { COMMANDS } = require('../helper/lib/phonelink/link');

const root = tempDir('wm-plh-');
const home = path.join(root, 'home');
fs.mkdirSync(home);
const chain = makeFakeKeychain(path.join(root, 'keychain'));
const standIn = makeStandIn(path.join(root, 'bin'));
const env = { ...chain.env, TRIF_DNS_SD: standIn.bin };
const exts = [];
const phones = [];

function helper() {
  const ext = new FakeExtension({ home, env });
  exts.push(ext);
  return ext;
}
let asked = 0;
/** A request as the side panel's (the extension's own connection to its helper). */
async function panel(ext, cmd, args = {}) {
  const id = `p${++asked}`;
  ext.send({ type: 'request', id, cmd, args });
  const r = await ext.next((m) => m.type === 'response' && m.id === id, { timeout: 15000 });
  if (!r.ok) throw new Error(r.error);
  return r.result;
}
/** A request on a helper's socket (a terminal's `trif`, or anything else on this computer). */
function socket(sock, msg) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    let buf = '';
    const t = setTimeout(() => { s.destroy(); reject(new Error('no answer from the helper')); }, 10000);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(`${JSON.stringify(msg)}\n`));
    s.on('data', (d) => { buf += d; if (buf.includes('\n')) { clearTimeout(t); s.destroy(); resolve(JSON.parse(buf.slice(0, buf.indexOf('\n')))); } });
    s.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}
/** Whether anything accepts a connection on 127.0.0.1 at this port. */
function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
/** Every file under the test's folders, as text. */
function everyFile(dir = root, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) everyFile(p, out);
    else if (d.isFile()) out.push([p, fs.readFileSync(p, 'latin1')]);
  }
  return out;
}
const HELLO = { t: 'hello', app: '1.0', device: { name: 'iPhone', width: 393, height: 852 } };
async function connect(port, computerKey, keys, { name, pair } = {}) {
  const phone = await PhoneClient.connect({ port, computerKey, keys, name: name || 'again', pair });
  phones.push(phone);
  phone.hello = await phone.request(HELLO);
  return phone;
}
const qrOf = (qr) => { const u = new URL(qr); return { key: Buffer.from(u.searchParams.get('k'), 'base64url'), secret: u.searchParams.get('s') }; };

test.after(async () => {
  for (const p of phones) { try { await p.close(); } catch { /* closed */ } }
  for (const e of exts) { try { await e.close(); } catch { /* gone */ } }
  for (const c of standIn.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* left */ }
});

test('the phone link in the real helper: off until the panel turns it on, the owner of helper.sock alone listens', async () => {
  const first = helper();
  await first.waitForSocket();
  first.hello({ browser: 'Firefox' });

  // A new install: off, nothing of it anywhere.
  const fresh = await panel(first, 'phone.status');
  assert.deepEqual({ on: fresh.on, id: fresh.id, port: fresh.port, phones: fresh.phones, pairing: fresh.pairing, listen: fresh.listen, here: fresh.here, listening: fresh.listening },
    { on: false, id: null, port: 0, phones: [], pairing: null, listen: false, here: true, listening: false });
  assert.equal(fs.existsSync(path.join(`${home}-private`, 'phone-link.json')), false);
  assert.deepEqual(chain.argv(), [], 'the keychain was not asked for anything');
  assert.deepEqual(standIn.calls(), [], 'nothing was announced');
  await assert.rejects(panel(first, 'phone.pair.start'), /the phone link is off/);

  // The socket: a terminal (or a run: host.js refuses PANEL_COMMANDS before it looks at a token) can't.
  for (const cmd of COMMANDS) {
    for (const extra of [{}, { token: 'not-a-run' }]) {
      const r = await socket(first.sock, { id: 1, cmd, args: { id: '0011223344556677' }, ...extra });
      assert.equal(r.ok, false, cmd);
      assert.match(r.error, /only TRIF's side panel/, cmd);
    }
  }
  assert.equal((await panel(first, 'phone.status')).on, false);
  assert.equal(fs.existsSync(path.join(`${home}-private`, 'phone-link.json')), false);

  // On: a key in the keychain, and still nothing listening or announced (no phone, no window).
  const on = await panel(first, 'phone.on');
  assert.equal(on.on, true);
  assert.match(on.id, /^[0-9a-f]{16}$/);
  assert.deepEqual([on.listen, on.listening, on.port], [false, false, 0]);
  assert.deepEqual(standIn.calls(), []);

  // Connect a phone: the QR, a listener on this computer alone, one announcement of its port.
  const before = first.messages.length;
  const window = await panel(first, 'phone.pair.start');
  const { key: computerKey, secret } = qrOf(window.qr);
  assert.equal(computerKey.length, 32);
  assert.ok(secret.length >= 22);
  assert.ok(window.expires > Date.now() && window.expires <= Date.now() + 5 * 60 * 1000);
  assert.equal(window.listening, true);
  const port = window.port;
  assert.ok(port > 0);
  assert.equal(await listening(port), true);
  const call = await waitFor(() => standIn.calls()[0], { message: 'the announcement' });
  assert.deepEqual(call.argv.slice(0, 1).concat(call.argv.slice(2)), ['-R', '_trif._tcp', 'local', String(port), 'v=1', `id=${on.id}`]);
  // The secret: in the answer to the panel that asked, and nowhere else.
  for (const [file, text] of everyFile()) assert.equal(text.includes(secret), false, `the secret is in ${file}`);
  for (const m of first.messages.slice(before)) {
    if (m.type === 'response' && m.result && m.result.qr) continue;
    assert.equal(JSON.stringify(m).includes(secret), false, `the secret is in a ${m.type} message`);
  }

  // A stranger (no secret, a wrong one): not one byte. The phone with the QR: paired, and the panel is told.
  await assert.rejects(PhoneClient.connect({ port, computerKey }), (e) => e.code === 'closed' && e.bytes === 0);
  await assert.rejects(PhoneClient.connect({ port, computerKey, pair: 'A'.repeat(22) }), (e) => e.code === 'closed' && e.bytes === 0);
  const keysA = generateKeyPair();
  const idA = keyId(keysA.publicKey);
  const a = await connect(port, computerKey, keysA, { name: 'Phone A', pair: secret });
  assert.equal(a.hello.t, 'hello');
  assert.equal(a.hello.agent, null, 'no agent is installed in this test');
  const told = await first.next((m) => m.type === 'phoneLink' && m.status.phones.length === 1 && !m.status.pairing, { since: before });
  assert.deepEqual(told.status.phones.map((p) => [p.id, p.name]), [[idA, 'Phone A']]);
  assert.equal(JSON.stringify(told).includes(keysA.publicKey.toString('base64url')), false);
  // (the window is closed: its secret pairs nobody else)
  await assert.rejects(PhoneClient.connect({ port, computerKey, pair: secret }), (e) => e.code === 'closed' && e.bytes === 0);

  // Phone sync (docs/PHONE-SYNC.md) rides this session: on for a paired phone (D11), the panel's switch turns it off.
  assert.equal(told.status.sync, true);
  const empty = await a.request({ t: 'sync.begin', mods: [] });
  assert.equal(empty.t, 'sync.plan');
  const done = await a.request({ t: 'sync.end', syncId: empty.syncId, have: [] });
  assert.equal(done.t, 'sync.done');
  assert.ok(fs.existsSync(path.join(`${home}-private`, 'phone-link', 'sync', `${idA}.json`)), 'the base');
  const after = await panel(first, 'phone.status');
  assert.deepEqual([after.phones[0].synced.fromPhone, after.phones[0].synced.waiting, after.phones[0].synced.conflicts], [0, 0, []]);
  // A phone twin changed on the computer (an edit, a chat): the phone is nudged, with no mod and no name in it.
  const twin = path.join(home, 'sites', 'phone~example.com');
  fs.mkdirSync(twin, { recursive: true });
  fs.writeFileSync(path.join(twin, 'dark.js'), '// ==WebMod==\n// @name Dark\n// ==/WebMod==\ndocument.body.style.background = "#000";\n');
  assert.deepEqual(await a.next((m) => m.t === 'sync.changed', { timeout: 10000 }), { t: 'sync.changed' });
  // Off in the panel: every sync.* is refused, and a twin's change nudges nobody.
  const syncOff = await panel(first, 'phone.sync', { on: false });
  assert.equal(syncOff.sync, false);
  await new Promise((r) => setTimeout(r, 1100)); // (one sync.begin a second)
  const refused = await a.request({ t: 'sync.begin', mods: [] });
  assert.deepEqual([refused.t, refused.code], ['error', 'off']);
  fs.writeFileSync(path.join(twin, 'dark.js'), '// ==WebMod==\n// @name Dark\n// ==/WebMod==\ndocument.body.style.background = "#111";\n');
  await assert.rejects(a.next((m) => m.t === 'sync.changed', { timeout: 3000 }), /no such message/);
  assert.equal((await panel(first, 'phone.sync', { on: true })).sync, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(`${home}-private`, 'phone-link.json'), 'utf8')).sync, true);

  // Sync now, in the owner's panel: the connected phone is told at once (not held to the nudges' 2 s).
  const nowAsked = await panel(first, 'phone.syncNow');
  assert.deepEqual(nowAsked.told, [idA]);
  assert.equal(nowAsked.phones[0].online, true);
  assert.deepEqual(await a.next((m) => m.t === 'sync.changed', { timeout: 5000 }), { t: 'sync.changed' });

  // Another browser's helper: its panel reaches the owner's link through helper.sock.
  const second = helper();
  await second.waitForSocket(5000, second.ownSock);
  second.hello({ browser: 'Chrome' });
  const there = await panel(second, 'phone.status');
  assert.deepEqual([there.on, there.here, there.listening, there.phones.length, there.phones[0].online], [true, true, true, 1, true]);
  assert.equal(standIn.calls().length, 1, 'the second helper announces nothing');
  // (the relay: refused on the socket without the key, with a wrong one, and with a run's token)
  const relayKey = fs.readFileSync(path.join(`${home}-private`, 'phone-relay.key'), 'utf8').trim();
  assert.match(relayKey, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(path.join(`${home}-private`, 'phone-relay.key')).mode & 0o777, 0o600);
  for (const args of [{ cmd: 'phone.pair.start' }, { cmd: 'phone.pair.start', key: 'f'.repeat(64) }, { cmd: 'phone.pair.start', key: relayKey.toUpperCase() }]) {
    const r = await socket(first.sock, { id: 1, cmd: 'phone.relay', args });
    assert.deepEqual([r.ok, r.code], [false, 'refused']);
  }
  const ran = await socket(first.sock, { id: 1, cmd: 'phone.relay', args: { cmd: 'phone.pair.start', key: relayKey }, token: 'a-run' });
  assert.match(ran.error, /inside an agent run/);
  const odd = await socket(first.sock, { id: 1, cmd: 'phone.relay', args: { cmd: 'agent.logout', key: relayKey } });
  assert.deepEqual([odd.ok, odd.code], [false, 'refused']);
  // (a pairing window opened from the second browser: the owner's, its QR to the second panel alone)
  const fromSecond = await panel(second, 'phone.pair.start');
  assert.equal(qrOf(fromSecond.qr).key.equals(computerKey), true);
  assert.equal(fromSecond.port, port);
  for (const m of first.messages) assert.equal(JSON.stringify(m).includes(qrOf(fromSecond.qr).secret), false, 'the second panel\'s secret reached the first');
  const closedThere = await panel(second, 'phone.pair.stop');
  assert.equal(closedThere.pairing, null);
  // (the owner's news reaches the second panel: the sync switch turned in the first browser)
  let mark2 = second.messages.length;
  await panel(first, 'phone.sync', { on: false });
  await second.next((m) => m.type === 'phoneLink' && m.status.sync === false && m.status.here === true, { since: mark2, timeout: 5000 });
  mark2 = second.messages.length;
  await panel(second, 'phone.sync', { on: true });
  await first.next((m) => m.type === 'phoneLink' && m.status.sync === true, { timeout: 5000 });
  // (Sync now from the second browser: the owner tells the phone; the sync's end reaches the second panel)
  const relayedNow = await panel(second, 'phone.syncNow');
  assert.deepEqual([relayedNow.told, relayedNow.browser], [[idA], 'Firefox'], 'the owner\'s browser, named');
  assert.deepEqual(await a.next((m) => m.t === 'sync.changed', { timeout: 5000 }), { t: 'sync.changed' });
  const beginAgain = await a.request({ t: 'sync.begin', mods: [] });
  mark2 = second.messages.length;
  await a.request({ t: 'sync.end', syncId: beginAgain.syncId, have: [] });
  await second.next((m) => m.type === 'phoneLink' && m.status.phones[0] && m.status.phones[0].synced && m.status.phones[0].synced.at >= relayedNow.phones[0].synced.at, { since: mark2, timeout: 5000 });
  // It can remove a phone: the owner closes that phone, and with no phone left nothing listens.
  const mark = first.messages.length;
  const removed = await panel(second, 'phone.remove', { id: idA });
  assert.deepEqual(removed.removed, { id: idA, name: 'Phone A' });
  await a.closed;
  // (its sync base goes with it)
  assert.equal(fs.existsSync(path.join(`${home}-private`, 'phone-link', 'sync', `${idA}.json`)), false);
  // (the owner's panel is told too; the listener is closed a moment after the phone is)
  await first.next((m) => m.type === 'phoneLink' && m.status.phones.length === 0 && !m.status.listening, { since: mark, timeout: 10000 });
  await waitFor(async () => !(await listening(port)), { message: 'the listener to close' });
  await waitFor(() => gone(call.pid), { message: 'the announcement to end' });
  await assert.rejects(PhoneClient.connect({ port, computerKey, keys: keysA }), (e) => e.code === 'ECONNREFUSED');

  // A second phone, paired in the owner; then the owner goes (its browser closed).
  const window2 = await panel(first, 'phone.pair.start');
  const again = qrOf(window2.qr);
  const keysB = generateKeyPair();
  const b = await connect(window2.port, computerKey, keysB, { name: 'Phone B', pair: again.secret });
  const call2 = await waitFor(() => standIn.calls()[1], { message: 'the second announcement' });
  await first.close();
  await b.closed;
  await waitFor(() => gone(call2.pid), { message: 'the owner\'s announcement to end with it' });

  // The helper that takes helper.sock takes the link: phone B reaches it with the keys it has.
  await waitFor(async () => { const s = await panel(second, 'phone.status'); return s.here && s.listening; }, { timeout: 15000, interval: 200, message: 'the second helper to take the link' });
  const now = await panel(second, 'phone.status');
  assert.deepEqual(now.phones.map((p) => p.name), ['Phone B']);
  assert.equal(now.port, window2.port, 'the same port: the phones find it where it was');
  const b2 = await connect(now.port, computerKey, keysB);
  assert.equal(b2.hello.t, 'hello');
  const call3 = await waitFor(() => standIn.calls()[2], { message: 'the new owner\'s announcement' });
  assert.equal(call3.argv[4], String(now.port));
  // (phone A was removed: still nobody)
  await assert.rejects(PhoneClient.connect({ port: now.port, computerKey, keys: keysA }), (e) => e.code === 'closed' && e.bytes === 0);

  // Off: the phone is closed, nothing listens, nothing is announced; the phone stays in the list.
  const off = await panel(second, 'phone.off');
  assert.deepEqual([off.on, off.listening, off.phones.length], [false, false, 1]);
  await b2.closed;
  assert.equal(await listening(now.port), false);
  await waitFor(() => gone(call3.pid), { message: 'the announcement to end' });
  await second.close();
  for (const c of standIn.calls()) assert.equal(gone(c.pid), true, 'no dns-sd is left behind');
});

test('an owner that can\'t relay (a helper from before the relay): the panel names its browser, the file\'s part still works here', async () => {
  const home2 = path.join(root, 'home2');
  fs.mkdirSync(home2);
  // (a stand-in older helper on helper.sock: it answers ping with its browser, and knows no phone.relay)
  const old = net.createServer((s) => {
    s.setEncoding('utf8');
    let buf = '';
    s.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const req = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        s.write(`${JSON.stringify(req.cmd === 'ping' ? { id: req.id, ok: true, result: { role: 'primary', extension: { browser: 'Firefox' } } } : { id: req.id, ok: false, error: `unknown command "${req.cmd}"` })}\n`);
      }
    });
    s.on('error', () => {});
  });
  await new Promise((r) => old.listen(path.join(home2, 'helper.sock'), r));
  try {
    const ext = new FakeExtension({ home: home2, env });
    exts.push(ext);
    await ext.waitForSocket(5000, ext.ownSock);
    ext.hello({ browser: 'Chrome' });
    const st = await panel(ext, 'phone.status');
    assert.deepEqual([st.here, st.browser], [false, 'Firefox']);
    const on = await panel(ext, 'phone.on');
    assert.deepEqual([on.on, on.here], [true, false]);
    await assert.rejects(panel(ext, 'phone.pair.start'), /TRIF in Firefox has the phone link just now: connect the phone from there, or quit Firefox/);
    await ext.close();
  } finally {
    await new Promise((r) => old.close(r));
  }
});

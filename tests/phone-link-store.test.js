'use strict';
// The phone link's store (helper/lib/phonelink/store.js; docs/PHONE-LINK.md "Keys and pairing"): the computer's
// key in the keyring (a fake one here, never the real Keychain), phone-link.json in a temp workspace's private
// folder, the pairing window and the paired phones. No network.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir } = require('./fake-extension');
const { makeFakeKeychain } = require('./fake-keychain');
const { Store, FILE, SERVICE, ACCOUNT, WINDOW_MS, MAX_TRIES, QR_TEXT_MAX, cleanName, qrName, computerName, parse } = require('../helper/lib/phonelink/store');
const { generateKeyPair, publicFromPrivate, keyId, Handshake } = require('../helper/lib/phonelink/noise');

const cleanups = [];
test.after(() => { for (const fn of cleanups.reverse()) { try { fn(); } catch { /* ignore */ } } });

const b64 = (b) => Buffer.from(b).toString('base64url');

/** A store in a temp workspace with a fake keychain and a clock the test moves. */
function setup({ kind = 'security', keychain = true, name = 'Tim’s MacBook' } = {}) {
  const root = tempDir('wm-plink-');
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const chain = makeFakeKeychain(path.join(root, 'keychain'), { kind });
  const env = keychain ? { ...chain.env } : { TRIF_KEYCHAIN_BIN: 'not-absolute' }; // (keyring.js: no keyring)
  const clock = { t: Date.parse('2026-11-16T12:00:00Z') };
  const store = new Store(home, { env, now: () => clock.t, name });
  cleanups.push(() => store.pairStop());
  const file = path.join(`${home}-private`, FILE);
  return { root, home, chain, env, clock, store, file, json: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

const phoneKey = () => generateKeyPair().publicKey;

test('syncing phone mods (D11): on by default, turned off by the panel, the switch kept through the link off and on', async () => {
  const { store, json } = setup();
  assert.equal(store.status().sync, true);
  let changes = 0;
  store.on('change', () => changes++);
  assert.equal(store.setSync(false), false);
  assert.deepEqual([store.status().sync, json().sync, changes], [false, false, 1]);
  assert.equal(store.setSync(false), false);
  assert.equal(changes, 1, 'no change, no event');
  await store.setOn(true);
  await store.setOn(false);
  await store.setOn(true);
  assert.equal(store.status().sync, false, 'the link off and on keeps it off');
  assert.equal(store.setSync(true), true);
  assert.equal(json().sync, true);
});

test('a new install: off, no file, no key, nobody paired, no pairing', async () => {
  const { store, file, chain } = setup();
  const s = store.status();
  assert.deepEqual({ on: s.on, id: s.id, phones: s.phones, pairing: s.pairing, listen: s.listen }, { on: false, id: null, phones: [], pairing: null, listen: false });
  assert.equal(await store.keys(), null);
  assert.equal(store.isPaired(phoneKey()), null);
  assert.throws(() => store.pairStart(), /off/);
  assert.equal(store.pairTry(phoneKey(), 'anything', 'x'), null);
  assert.equal(fs.existsSync(file), false, 'reading makes no file');
  assert.deepEqual(chain.items(), {});
});

for (const kind of ['security', 'secret-tool']) {
  test(`turning on makes the key pair: private key in the keyring (${kind}) alone, public key in the file, mode 600`, async () => {
    const { store, file, json, chain, root } = setup({ kind });
    assert.deepEqual(await store.setOn(true), { on: true, created: true });
    const items = Object.entries(chain.items());
    assert.equal(items.length, 1);
    assert.ok(items[0][0].includes(SERVICE) && items[0][0].includes(ACCOUNT));
    const privateText = items[0][1];
    assert.match(privateText, /^[A-Za-z0-9_-]{43}$/);
    const saved = json();
    assert.deepEqual(Object.keys(saved).sort(), ['on', 'phones', 'port', 'publicKey', 'sync']);
    assert.equal(saved.sync, true, 'syncing phone mods is on for a paired phone until the panel turns it off (D11)');
    assert.equal(saved.on, true);
    assert.equal(saved.publicKey, b64(publicFromPrivate(Buffer.from(privateText, 'base64url'))));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    // The private key is in the keyring's item and nowhere else: no file under the temp root, no argv.
    assert.ok(!chain.argvText().includes(privateText), 'not in a command line');
    assert.ok(!chain.argvText().includes(Buffer.from(privateText, 'utf8').toString('hex')), 'nor as hex');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(root)) if (path.basename(f) !== 'items.json') assert.ok(!fs.readFileSync(f, 'utf8').includes(privateText), f);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [FILE], 'no temp file left');

    const keys = await store.keys();
    assert.equal(b64(keys.publicKey), saved.publicKey);
    assert.equal(b64(keys.privateKey), privateText);
    const st = store.status();
    assert.equal(st.id, keyId(keys.publicKey));
    assert.equal(st.listen, false, 'on, but nobody paired and no window: nothing to listen for');
    assert.ok(!JSON.stringify(st).includes(privateText));
  });
}

test('off and on again keeps the key and the phones; off: no keys, nobody paired, the window closed', async () => {
  const { store, json } = setup();
  await store.setOn(true);
  const first = json().publicKey;
  const phone = phoneKey();
  const { secret } = store.pairStart();
  assert.ok(store.pairTry(phone, secret, 'Tim’s iPhone'));
  store.pairStart();

  assert.deepEqual(await store.setOn(false), { on: false });
  assert.equal(await store.keys(), null);
  assert.equal(store.isPaired(phone), null);
  assert.equal(store.pairing(), null);
  assert.equal(store.status().listen, false);
  assert.equal(store.list().length, 1, 'the phones stay listed');

  assert.deepEqual(await store.setOn(true), { on: true, created: false });
  assert.equal(json().publicKey, first);
  assert.equal(store.isPaired(phone).name, 'Tim’s iPhone');
  assert.equal(store.status().listen, true);
});

test('a key gone from the keyring (or not the file\'s): turning on makes a new one and drops the phones paired to the old', async () => {
  const { store, json, chain, env } = setup();
  await store.setOn(true);
  const first = json().publicKey;
  const phone = phoneKey();
  assert.ok(store.pairTry(phone, store.pairStart().secret, 'A'));

  fs.writeFileSync(path.join(path.dirname(chain.bin), 'items.json'), '{}');
  assert.equal(await store.keys(), null, 'no key: nothing to listen with');
  assert.deepEqual(await store.setOn(true), { on: true, created: true });
  assert.notEqual(json().publicKey, first);
  assert.deepEqual(store.list(), []);
  assert.equal(store.isPaired(phone), null);

  // Another key in the keyring than the file's public key: the same.
  const other = generateKeyPair();
  await require('../helper/lib/keyring').setKey(ACCOUNT, b64(other.privateKey), { service: SERVICE, env });
  assert.equal(await store.keys(), null);
  assert.equal((await store.setOn(true)).created, true);
  assert.notEqual(json().publicKey, b64(other.publicKey));
  assert.ok(await store.keys());
});

test('a keyring that can\'t be read just now is not a lost key: turning on fails, the key and the phones stay', async () => {
  const { store, json, chain, home, clock } = setup();
  await store.setOn(true);
  const before = json();
  const phone = phoneKey();
  assert.ok(store.pairTry(phone, store.pairStart().secret, 'A'));
  await store.setOn(false);
  // A keyring tool that fails (as a locked Keychain does: an error, not "not found").
  const broken = path.join(path.dirname(chain.bin), 'broken-security');
  fs.writeFileSync(broken, `#!${process.execPath}\nprocess.stderr.write('security: User interaction is not allowed.\\n'); process.exit(36);\n`);
  fs.chmodSync(broken, 0o755);
  const locked = new Store(home, { env: { TRIF_KEYCHAIN_BIN: broken }, now: () => clock.t });
  await assert.rejects(locked.setOn(true), /couldn't read this computer's phone link key/);
  assert.equal(await locked.keys(), null);
  assert.equal(json().publicKey, before.publicKey);
  assert.equal(json().on, false);
  assert.equal(store.list().length, 1);
  assert.deepEqual(await store.setOn(true), { on: true, created: false });
  assert.equal(store.isPaired(phone).name, 'A');
});

test('two turn-ons at once make one key', async () => {
  const { store, json, chain } = setup();
  const [a, b] = await Promise.all([store.setOn(true), store.setOn(true)]);
  assert.deepEqual([a.created, b.created], [true, false]);
  const keys = await store.keys();
  assert.equal(b64(keys.publicKey), json().publicKey);
  assert.equal(Object.keys(chain.items()).length, 1);
});

test('no keyring: the link stays off, and the error says why without a key in it', async () => {
  const { store, file } = setup({ keychain: false });
  await assert.rejects(store.setOn(true), /needs a system keyring/);
  assert.equal(store.status().on, false);
  assert.equal(fs.existsSync(file), false);
  // (and the store still answers afterwards)
  assert.deepEqual(await store.setOn(false), { on: false });
});

test('the pairing window: the QR text, and one phone pairs with its secret', async () => {
  const { store, json, clock } = setup();
  await store.setOn(true);
  const changes = [];
  store.on('change', () => changes.push(store.status().listen));
  const w = store.pairStart();
  assert.equal(Buffer.from(w.secret, 'base64url').length, 16);
  assert.equal(w.expires, clock.t + WINDOW_MS);
  const u = new URL(w.qr);
  assert.equal(u.protocol, 'trif:');
  assert.equal(u.host, 'pair');
  assert.deepEqual([...u.searchParams.keys()], ['v', 'k', 's', 'n']);
  assert.equal(u.searchParams.get('v'), '1');
  assert.equal(u.searchParams.get('k'), json().publicKey);
  assert.equal(u.searchParams.get('s'), w.secret);
  assert.equal(u.searchParams.get('n'), 'Tim’s MacBook');
  assert.deepEqual(store.status().pairing, { expires: w.expires });
  assert.equal(store.status().listen, true, 'a phone may pair: listen');
  assert.ok(!JSON.stringify(store.status()).includes(w.secret), 'the status never has the secret');
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes(w.secret), 'nor the file');

  const key = phoneKey();
  clock.t += 1000;
  const phone = store.pairTry(key, w.secret, 'Tim’s iPhone');
  assert.deepEqual(phone, { id: keyId(key), name: 'Tim’s iPhone', key: b64(key), pairedAt: '2026-11-16T12:00:01.000Z', lastSeen: '2026-11-16T12:00:01.000Z' });
  assert.deepEqual(json().phones, [phone]);
  assert.deepEqual(store.isPaired(key), phone);
  assert.deepEqual(store.list(), [{ id: phone.id, name: phone.name, pairedAt: phone.pairedAt, lastSeen: phone.lastSeen }]);
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);

  // One phone per window: the same secret is no good for a second.
  assert.equal(store.pairing(), null);
  const second = phoneKey();
  assert.equal(store.pairTry(second, w.secret, 'Another'), null);
  assert.equal(store.isPaired(second), null);
  assert.equal(store.list().length, 1);
  assert.deepEqual(changes, [true, true], 'window opened; phone paired (window closed)');
});

test('wrong secrets: refused, and the fifth closes the window even for the right one', async () => {
  const { store } = setup();
  await store.setOn(true);
  const w = store.pairStart();
  const key = phoneKey();
  const wrongs = ['', 'x', w.secret.slice(0, -1), w.secret + 'A', b64(Buffer.alloc(16)), null, undefined, 42, Buffer.from(w.secret)];
  for (const wrong of wrongs.slice(0, MAX_TRIES - 1)) assert.equal(store.pairTry(key, wrong, 'x'), null);
  assert.ok(store.pairing(), `still open after ${MAX_TRIES - 1} wrong tries`);
  assert.equal(store.pairTry(key, wrongs[MAX_TRIES - 1], 'x'), null);
  assert.equal(store.pairing(), null, 'closed by the fifth');
  assert.equal(store.pairTry(key, w.secret, 'x'), null);
  assert.equal(store.isPaired(key), null);
  assert.deepEqual(store.list(), []);

  // Every kind of wrong, each against a fresh window; a key that isn't 32 bytes doesn't count as a try.
  for (const wrong of wrongs) {
    const fresh = store.pairStart();
    assert.equal(store.pairTry(key, wrong, 'x'), null);
    assert.equal(store.pairTry(Buffer.alloc(31), fresh.secret, 'x'), null);
    assert.equal(store.pairTry(b64(key), fresh.secret, 'x'), null);
    assert.ok(store.pairTry(key, fresh.secret, 'x'), 'the right one still pairs after one wrong try');
    assert.ok(store.remove(keyId(key)));
  }
});

test('the window\'s time: good just before 5 minutes, gone at 5 minutes', async () => {
  const { store, clock } = setup();
  await store.setOn(true);
  let w = store.pairStart();
  clock.t += WINDOW_MS - 1;
  assert.ok(store.pairTry(phoneKey(), w.secret, 'in time'));

  w = store.pairStart();
  let changed = 0;
  store.on('change', () => changed++);
  clock.t += WINDOW_MS;
  const late = phoneKey();
  assert.equal(store.pairTry(late, w.secret, 'late'), null);
  assert.equal(store.isPaired(late), null);
  assert.equal(store.pairing(), null);
  assert.equal(changed, 1, 'closing by time is a change (the listener may stop)');
});

test('a new QR replaces the open window\'s secret; pairStop closes it', async () => {
  const { store } = setup();
  await store.setOn(true);
  const a = store.pairStart();
  const b = store.pairStart();
  assert.notEqual(a.secret, b.secret);
  const key = phoneKey();
  assert.equal(store.pairTry(key, a.secret, 'old'), null);
  assert.ok(store.pairTry(key, b.secret, 'new'));

  const c = store.pairStart();
  store.pairStop();
  assert.equal(store.pairing(), null);
  assert.equal(store.pairTry(phoneKey(), c.secret, 'closed'), null);
});

test('pairing again with the same phone replaces its row (the new name), no second row', async () => {
  const { store, clock } = setup();
  await store.setOn(true);
  const key = phoneKey();
  assert.ok(store.pairTry(key, store.pairStart().secret, 'Old name'));
  clock.t += 60000;
  assert.ok(store.pairTry(key, store.pairStart().secret, 'New name'));
  assert.deepEqual(store.list().map((p) => p.name), ['New name']);
});

test('remove: the phone is no longer paired; the others stay; removing the last one stops the listening', async () => {
  const { store, json } = setup();
  await store.setOn(true);
  const a = phoneKey();
  const b = phoneKey();
  assert.ok(store.pairTry(a, store.pairStart().secret, 'A'));
  assert.ok(store.pairTry(b, store.pairStart().secret, 'B'));
  let changed = 0;
  store.on('change', () => changed++);

  assert.deepEqual(store.remove(keyId(a)), { id: keyId(a), name: 'A' });
  assert.equal(store.isPaired(a), null);
  assert.equal(store.isPaired(b).name, 'B');
  assert.deepEqual(json().phones.map((p) => p.name), ['B']);
  assert.equal(store.status().listen, true);
  assert.equal(store.remove(keyId(a)), null, 'already gone');
  assert.equal(store.remove('not-an-id'), null);
  assert.equal(store.remove(b64(b)), null, 'by id only');

  assert.ok(store.remove(keyId(b)));
  assert.equal(store.status().listen, false);
  assert.equal(store.status().on, true, 'the switch stays where the user put it');
  assert.equal(changed, 2);
  // A removed phone's key pairs again only through a new window.
  assert.equal(store.pairTry(a, 'x', 'A'), null);
});

test('seen and setPort are kept; a second store on the same workspace reads the same phones', async () => {
  const { store, home, env, clock, json } = setup();
  await store.setOn(true);
  const key = phoneKey();
  const phone = store.pairTry(key, store.pairStart().secret, 'A');
  clock.t += 3600000;
  store.seen(phone.id);
  store.seen('0000000000000000'); // (nobody: nothing happens)
  assert.equal(store.list()[0].lastSeen, '2026-11-16T13:00:00.000Z');
  assert.equal(store.list()[0].pairedAt, '2026-11-16T12:00:00.000Z');
  store.setPort(50123);
  for (const bad of [0, -1, 65536, 1.5, '80', null]) store.setPort(bad);
  assert.equal(json().port, 50123);
  assert.equal(store.status().port, 50123);

  const other = new Store(home, { env, now: () => clock.t });
  assert.equal(other.isPaired(key).id, phone.id);
  assert.equal(other.pairing(), null, 'the window is the opening helper\'s alone');
  assert.ok(other.remove(phone.id));
  assert.equal(store.isPaired(key), null, 'removed there, gone here');
});

test('a file that isn\'t what the store wrote: off, or its bad rows dropped; ids come from the keys', () => {
  const off = { on: false, sync: true, publicKey: null, port: 0, phones: [] };
  for (const text of ['', 'not json', '[]', 'null', '"on"', '{"on":true}', '{"on":true,"publicKey":"short"}', `{"on":true,"publicKey":"${'A'.repeat(44)}"}`]) assert.deepEqual(parse(text), off, text);
  const pk = b64(generateKeyPair().publicKey);
  const k1 = phoneKey();
  const k2 = phoneKey();
  const got = parse(JSON.stringify({
    on: 'yes', sync: 'yes', publicKey: pk, port: 70000,
    phones: [
      { id: 'ffffffffffffffff', name: 'Lied about its id', key: b64(k1), pairedAt: 'never', lastSeen: '2026-11-16T12:00:00.000Z' },
      { id: keyId(k1), name: 'The same key again', key: b64(k1) },
      { id: 'x', name: 'No key' },
      { name: 'Short key', key: 'AAAA' },
      { name: 'x'.repeat(200) + '\n<b>', key: b64(k2) },
      null, 'phone', 7,
    ],
  }));
  assert.equal(got.on, false, 'on only when it says true');
  assert.equal(got.sync, true, 'syncing is off only when it says false');
  assert.equal(parse(JSON.stringify({ sync: false })).sync, false);
  assert.equal(got.port, 0);
  assert.deepEqual(got.phones.map((p) => p.id), [keyId(k1), keyId(k2)]);
  assert.deepEqual(got.phones[0], { id: keyId(k1), name: 'Lied about its id', key: b64(k1), pairedAt: null, lastSeen: '2026-11-16T12:00:00.000Z' });
  assert.equal(got.phones[1].name, 'x'.repeat(59) + '\u2026');
  // Phones without the computer's key are paired to nothing.
  assert.deepEqual(parse(JSON.stringify({ on: true, phones: [{ key: b64(k1), name: 'A' }] })), off);
});

test('names are shown as text: one line, no control characters, 60 characters, a fallback', () => {
  assert.equal(cleanName('  Tim’s\n iPhone\u0000\u2028 15 ', 'iPhone'), 'Tim’s iPhone 15');
  assert.equal(cleanName('', 'iPhone'), 'iPhone');
  assert.equal(cleanName(null, 'iPhone'), 'iPhone');
  assert.equal(cleanName({ toString: () => 'object' }, 'iPhone'), 'iPhone');
  assert.equal(cleanName('😀'.repeat(100), 'x'), '😀'.repeat(59) + '\u2026', 'no word to cut at: mid-word');
  assert.equal(cleanName('👨‍👩‍👧'.repeat(70), 'x'), '👨‍👩‍👧'.repeat(59) + '\u2026', 'an emoji of several code points stays whole');
  assert.equal(cleanName('a'.repeat(60), 'x'), 'a'.repeat(60), '60 is whole');
  assert.equal(cleanName('a'.repeat(59) + ' b', 'x'), 'a'.repeat(59) + '\u2026', 'no space in the second half: mid-word');
  const long = 'Tim’s iPhone from the studio upstairs, the one with the cracked screen';
  assert.equal(cleanName(long, 'x'), 'Tim’s iPhone from the studio upstairs, the one with the\u2026', 'at a word');
  assert.ok(Array.from(cleanName(long, 'x')).length <= 60);
});

test('a long computer name is cut in the code\'s text, never the code refused: whole characters, then "\u2026", in what the panel\'s code holds', async () => {
  const { qrMatrix } = await import('../extension/qr.js');
  const bytes = (s) => Buffer.byteLength(s);
  // (the name's part alone)
  assert.equal(qrName('Tim\u2019s MacBook Pro', 200), 'Tim%E2%80%99s%20MacBook%20Pro', 'a name that fits is whole');
  assert.equal(qrName('abcdefghij', 10), 'abcdefghij');
  assert.equal(qrName('abcdefghijk', 10), 'a%E2%80%A6', 'room for the "\u2026" is kept');
  assert.equal(qrName('ab cdefghijklmnop', 14), 'ab%E2%80%A6', 'no space before the "\u2026"');
  assert.equal(qrName('\u00e9'.repeat(10), 30), '%C3%A9'.repeat(3) + '%E2%80%A6', 'never half a letter\'s bytes');
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'; // (one emoji of five code points: 54 bytes encoded)
  assert.equal(qrName(family.repeat(3), 130), encodeURIComponent(family.repeat(2)) + '%E2%80%A6', 'an emoji of several code points stays whole or goes');
  assert.equal(qrName('a\ud83d', 50), 'a', 'half a surrogate pair is left out, nothing thrown');
  assert.equal(qrName('abc', 2), '');
  for (const [name, cut] of [['\u{1F600}'.repeat(100), true], ['\u6771'.repeat(100), true], [family.repeat(30), true], ['w '.repeat(100), false], ['Tim\u2019s MacBook Pro', false]]) {
    const { store } = setup({ name });
    await store.setOn(true);
    const w = store.pairStart();
    assert.ok(bytes(w.qr) <= QR_TEXT_MAX, `${bytes(w.qr)} bytes`);
    assert.doesNotThrow(() => qrMatrix(w.qr), 'the panel can draw it');
    const u = new URL(w.qr);
    const shown = u.searchParams.get('n');
    assert.equal(shown !== store.name, cut, shown);
    if (cut) {
      assert.ok(shown.endsWith('\u2026') && store.name.startsWith(shown.slice(0, -1)) && shown.length > 3, shown);
      assert.ok(bytes(w.qr) > QR_TEXT_MAX - 60, `as much of the name as fits (${bytes(w.qr)} bytes)`);
    }
    // (the rest of the code's text is as before: the key and the secret)
    assert.equal(u.searchParams.get('s'), w.secret);
    assert.equal(Buffer.from(u.searchParams.get('k'), 'base64url').length, 32);
    assert.equal(store.status().name, store.name, 'the name itself is as it was (hello and the panel give it whole)');
    store.pairStop();
  }
});

test('with the noise handshake: the store\'s keys answer a phone that pairs, and the phone\'s key is the one paired', async () => {
  const { store } = setup();
  await store.setOn(true);
  const w = store.pairStart();
  const q = new URL(w.qr).searchParams;
  const phoneKeys = generateKeyPair();
  const phone = new Handshake({ initiator: true, s: phoneKeys, rs: Buffer.from(q.get('k'), 'base64url') });
  const m1 = phone.writeMessage(Buffer.from(JSON.stringify({ v: 1, name: 'Tim’s iPhone', pair: q.get('s') })));

  const computer = new Handshake({ initiator: false, s: await store.keys() });
  const first = JSON.parse(computer.readMessage(m1).toString('utf8'));
  assert.equal(store.isPaired(computer.rs), null, 'not paired yet');
  const row = store.pairTry(computer.rs, first.pair, first.name);
  assert.equal(row.id, keyId(phoneKeys.publicKey));
  const second = JSON.parse(phone.readMessage(computer.writeMessage(Buffer.from(JSON.stringify({ v: 1, name: store.name, paired: true })))).toString('utf8'));
  assert.deepEqual(second, { v: 1, name: 'Tim’s MacBook', paired: true });
  assert.equal(store.isPaired(phoneKeys.publicKey).name, 'Tim’s iPhone');
});

test("the computer's name: the Mac's own, else the host name", () => {
  const host = cleanName(require('os').hostname().replace(/\.(local|lan|home)$/i, ''), 'Computer');
  assert.equal(computerName({ platform: 'darwin', read: () => 'Tim’s MacBook Pro\n' }), 'Tim’s MacBook Pro');
  assert.equal(computerName({ platform: 'darwin', read: () => { throw new Error('no scutil'); } }), host);
  assert.equal(computerName({ platform: 'darwin', read: () => ' \n' }), host);
  let asked = 0;
  assert.equal(computerName({ platform: 'linux', read: () => { asked++; return 'A Mac'; } }), host);
  assert.equal(asked, 0);
  assert.ok(computerName().length > 0);
});

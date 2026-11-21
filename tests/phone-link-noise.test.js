'use strict';
// The phone link's handshake, ciphers and frames (helper/lib/phonelink/noise.js, frames.js; docs/PHONE-LINK.md
// "The wire"). No network here: both sides in one process.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const noise = require('../helper/lib/phonelink/noise');
const { Handshake, CipherState, generateKeyPair, publicFromPrivate, keyId } = noise;
const { packet, PacketReader, seal, Assembler, MAX_JSON, PIECE } = require('../helper/lib/phonelink/frames');

const hex = (s) => Buffer.from(s, 'hex');
const EMPTY = Buffer.alloc(0);

/** A phone and a computer through the handshake: {phone, computer, p (the phone's ciphers), c, payloads}. */
function link({ phoneKeys = generateKeyPair(), computerKeys = generateKeyPair(), first = Buffer.from('{"v":1}'), second = Buffer.from('{"v":1,"paired":true}') } = {}) {
  const phone = new Handshake({ initiator: true, s: phoneKeys, rs: computerKeys.publicKey });
  const computer = new Handshake({ initiator: false, s: computerKeys });
  const m1 = phone.writeMessage(first);
  const got1 = computer.readMessage(m1);
  const m2 = computer.writeMessage(second);
  const got2 = phone.readMessage(m2);
  return { phone, computer, phoneKeys, computerKeys, m1, m2, got1, got2, p: phone.split(), c: computer.split() };
}

test('X25519: the RFC 7748 example (keys from raw bytes, the shared secret)', () => {
  const a = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const b = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  assert.equal(publicFromPrivate(a).toString('hex'), '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  assert.equal(publicFromPrivate(b).toString('hex'), 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
  assert.equal(noise.dh(a, publicFromPrivate(b)).toString('hex'), shared);
  assert.equal(noise.dh(b, publicFromPrivate(a)).toString('hex'), shared);
});

test('a low-order public key is refused (an all-zero secret would make the keys anyone\'s)', () => {
  const { privateKey } = generateKeyPair();
  assert.throws(() => noise.dh(privateKey, Buffer.alloc(32)));
  assert.throws(() => noise.dh(privateKey, Buffer.concat([Buffer.from([1]), Buffer.alloc(31)])));
});

test('Noise\'s HKDF is RFC 5869\'s with no info (checked against Node\'s own hkdf)', () => {
  const ck = crypto.randomBytes(32);
  const ikm = crypto.randomBytes(32);
  const [a, b] = noise.hkdf2(ck, ikm);
  const want = Buffer.from(crypto.hkdfSync('sha256', ikm, ck, EMPTY, 64));
  assert.equal(Buffer.concat([a, b]).toString('hex'), want.toString('hex'));
});

test('handshake: both sides get the payloads, the same hash, the phone\'s key, and ciphers that match', () => {
  const l = link();
  assert.equal(l.got1.toString(), '{"v":1}');
  assert.equal(l.got2.toString(), '{"v":1,"paired":true}');
  assert.equal(l.computer.rs.toString('hex'), l.phoneKeys.publicKey.toString('hex'), 'the computer learns the phone\'s static key');
  assert.equal(l.phone.hash.toString('hex'), l.computer.hash.toString('hex'));
  // message 1: e (32) + s encrypted (32+16) + payload encrypted (7+16); message 2: e (32) + payload (21+16)
  assert.equal(l.m1.length, 32 + 48 + 7 + 16);
  assert.equal(l.m2.length, 32 + 21 + 16);
  for (let i = 0; i < 3; i++) {
    assert.equal(l.c.receive.decrypt(EMPTY, l.p.send.encrypt(EMPTY, Buffer.from(`up ${i}`))).toString(), `up ${i}`);
    assert.equal(l.p.receive.decrypt(EMPTY, l.c.send.encrypt(EMPTY, Buffer.from(`down ${i}`))).toString(), `down ${i}`);
  }
  // (the two directions have different keys)
  assert.throws(() => l.p.receive.decrypt(EMPTY, l.p.send.encrypt(EMPTY, Buffer.from('x'))));
});

test('handshake: nothing of the phone\'s key or payload is readable in message 1', () => {
  const l = link({ first: Buffer.from('{"pair":"SECRETSECRETSECRET"}') });
  assert.equal(l.m1.includes(l.phoneKeys.publicKey), false);
  assert.equal(l.m1.includes(Buffer.from('SECRET')), false);
  assert.equal(l.m2.includes(l.computerKeys.publicKey), false, 'the computer\'s key never travels');
});

test('handshake: a first message made for another computer\'s key doesn\'t read', () => {
  const phoneKeys = generateKeyPair();
  const other = generateKeyPair();
  const computerKeys = generateKeyPair();
  const phone = new Handshake({ initiator: true, s: phoneKeys, rs: other.publicKey });
  const computer = new Handshake({ initiator: false, s: computerKeys });
  assert.throws(() => computer.readMessage(phone.writeMessage(EMPTY)));
});

test('handshake: a different prologue (another protocol version) doesn\'t read', () => {
  const computerKeys = generateKeyPair();
  const phone = new Handshake({ initiator: true, s: generateKeyPair(), rs: computerKeys.publicKey, prologue: 'TRIF phone link 2' });
  const computer = new Handshake({ initiator: false, s: computerKeys });
  assert.throws(() => computer.readMessage(phone.writeMessage(EMPTY)));
});

test('handshake: any changed byte of message 1 or 2, a short one, or garbage is refused', () => {
  const computerKeys = generateKeyPair();
  const phoneKeys = generateKeyPair();
  const m1 = new Handshake({ initiator: true, s: phoneKeys, rs: computerKeys.publicKey }).writeMessage(Buffer.from('hi'));
  for (let i = 0; i < m1.length; i++) {
    const bad = Buffer.from(m1);
    bad[i] ^= 0x01;
    assert.throws(() => new Handshake({ initiator: false, s: computerKeys }).readMessage(bad), `byte ${i} of message 1`);
  }
  for (const n of [0, 1, 31, 32, 79, 95]) assert.throws(() => new Handshake({ initiator: false, s: computerKeys }).readMessage(m1.subarray(0, n)), `${n} bytes`);
  assert.throws(() => new Handshake({ initiator: false, s: computerKeys }).readMessage(crypto.randomBytes(120)));
  assert.throws(() => new Handshake({ initiator: false, s: computerKeys }).readMessage('not a buffer'));

  const phone = new Handshake({ initiator: true, s: phoneKeys, rs: computerKeys.publicKey });
  const computer = new Handshake({ initiator: false, s: computerKeys });
  computer.readMessage(phone.writeMessage(EMPTY));
  const m2 = computer.writeMessage(Buffer.from('ok'));
  const bad = Buffer.from(m2);
  bad[m2.length - 1] ^= 0x80;
  assert.throws(() => phone.readMessage(bad));
});

test('handshake: someone who has the computer\'s public key but not its private key can\'t finish as the computer', () => {
  const computerKeys = generateKeyPair();
  const phone = new Handshake({ initiator: true, s: generateKeyPair(), rs: computerKeys.publicKey });
  const m1 = phone.writeMessage(EMPTY);
  const impostor = new Handshake({ initiator: false, s: { publicKey: computerKeys.publicKey, privateKey: generateKeyPair().privateKey } });
  assert.throws(() => impostor.readMessage(m1));
});

test('handshake: a copied message 1 played again gets a message 2 the copier can\'t use', () => {
  const l = link();
  const again = new Handshake({ initiator: false, s: l.computerKeys });
  again.readMessage(l.m1); // (it reads: it is the phone's real message)
  again.writeMessage(EMPTY);
  const c2 = again.split();
  // the first session's phone keys don't open the second session's messages, and the copier has neither
  assert.throws(() => l.p.receive.decrypt(EMPTY, c2.send.encrypt(EMPTY, Buffer.from('secret'))));
});

test('handshake: order is kept (no reading before writing, no split before the end)', () => {
  const computerKeys = generateKeyPair();
  const phone = new Handshake({ initiator: true, s: generateKeyPair(), rs: computerKeys.publicKey });
  const computer = new Handshake({ initiator: false, s: computerKeys });
  assert.throws(() => phone.readMessage(Buffer.alloc(48)));
  assert.throws(() => computer.writeMessage(EMPTY));
  assert.throws(() => phone.split());
  assert.throws(() => new Handshake({ initiator: true, s: generateKeyPair() }), 'the phone must know the computer\'s key');
  const m1 = phone.writeMessage(EMPTY);
  assert.throws(() => phone.writeMessage(EMPTY));
  computer.readMessage(m1);
  assert.throws(() => computer.split());
});

test('ciphers: a changed, repeated or out-of-order message is refused, and the next good one still reads', () => {
  const l = link();
  const a = l.p.send.encrypt(EMPTY, Buffer.from('one'));
  const b = l.p.send.encrypt(EMPTY, Buffer.from('two'));
  assert.throws(() => l.c.receive.decrypt(EMPTY, b), 'out of order');
  const bad = Buffer.from(a);
  bad[0] ^= 1;
  assert.throws(() => l.c.receive.decrypt(EMPTY, bad));
  assert.throws(() => l.c.receive.decrypt(EMPTY, a.subarray(0, 10)));
  assert.equal(l.c.receive.decrypt(EMPTY, a).toString(), 'one');
  assert.throws(() => l.c.receive.decrypt(EMPTY, a), 'played again');
  assert.equal(l.c.receive.decrypt(EMPTY, b).toString(), 'two');
});

test('ciphers: ChaCha20-Poly1305 as RFC 8439 2.8.2 has it (the nonce: 4 zero bytes, then the counter, little-endian)', () => {
  // RFC 8439's example has its own 12-byte nonce, which a Noise counter can't make; so: Node's cipher with the
  // nonce Noise asks for must open what CipherState made.
  const key = crypto.randomBytes(32);
  const cs = new CipherState(key);
  cs.n = 258;
  const ad = Buffer.from('ad');
  const ct = cs.encrypt(ad, Buffer.from('hello'));
  const nonce = Buffer.from('000000000201000000000000', 'hex');
  const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  d.setAAD(ad);
  d.setAuthTag(ct.subarray(ct.length - 16));
  assert.equal(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString(), 'hello');
  assert.equal(cs.n, 259);
});

test('keyId: 8 bytes of the key\'s SHA-256', () => {
  const k = generateKeyPair().publicKey;
  assert.equal(keyId(k), crypto.createHash('sha256').update(k).digest('hex').slice(0, 16));
  assert.throws(() => keyId(Buffer.alloc(31)));
});

test('frames: packets come back whole however the stream is cut', () => {
  const messages = [Buffer.from('a'), EMPTY, crypto.randomBytes(65535), Buffer.from('end')];
  const stream = Buffer.concat(messages.map(packet));
  for (const cut of [1, 2, 3, 7, 1000, 65536, stream.length]) {
    const r = new PacketReader();
    const got = [];
    for (let at = 0; at < stream.length; at += cut) got.push(...r.push(stream.subarray(at, at + cut)).map((b) => Buffer.from(b)));
    assert.equal(got.length, messages.length, `cut every ${cut}`);
    got.forEach((g, i) => assert.ok(g.equals(messages[i]), `message ${i}, cut every ${cut}`));
    assert.equal(r.waiting, 0);
  }
  assert.throws(() => packet(Buffer.alloc(65536)));
});

/** seal on one side, the stream, Assembler on the other. */
function carry(l, obj) {
  const r = new PacketReader();
  const asm = new Assembler(l.c.receive);
  const out = [];
  for (const m of r.push(Buffer.concat(seal(l.p.send, obj)))) { const o = asm.push(m); if (o !== undefined) out.push(o); }
  return out;
}

test('frames: small and big messages (a screenshot\'s worth) arrive as they left', () => {
  const l = link();
  assert.deepEqual(carry(l, { t: 'ping' }), [{ t: 'ping' }]);
  const big = { t: 'run.start', url: 'https://x.com/home', prompt: 'hide the reposts ✂️', shot: crypto.randomBytes(900000).toString('base64') };
  assert.equal(seal(link().p.send, big).length, Math.ceil(Buffer.byteLength(JSON.stringify(big)) / PIECE));
  assert.deepEqual(carry(l, big), [big]);
  // exactly one piece, and one byte more
  for (const n of [PIECE, PIECE + 1]) {
    const s = 'x'.repeat(n - '{"t":""}'.length);
    assert.deepEqual(carry(l, { t: s }), [{ t: s }]);
  }
});

test('frames: too big, not an object, a bad first byte or a piece from the wrong key closes it', () => {
  const l = link();
  assert.throws(() => seal(l.p.send, { shot: 'x'.repeat(MAX_JSON) }), /too big/);
  // a sender that ignores the limit: the receiver stops at its own
  const asm = new Assembler(l.c.receive, { max: 100000 });
  const piece = Buffer.concat([Buffer.from([0]), Buffer.alloc(60000, 0x20)]);
  assert.equal(asm.push(l.p.send.encrypt(EMPTY, piece)), undefined);
  assert.throws(() => asm.push(l.p.send.encrypt(EMPTY, piece)), /too big/);

  const m = link();
  const one = (plain) => new Assembler(m.c.receive).push(m.p.send.encrypt(EMPTY, plain));
  assert.throws(() => one(Buffer.from([1, ...Buffer.from('[1,2]')])), /not a message/);
  assert.throws(() => one(Buffer.from([1, ...Buffer.from('"text"')])), /not a message/);
  assert.throws(() => one(Buffer.from([1, ...Buffer.from('{broken')])));
  assert.throws(() => one(Buffer.from([2, ...Buffer.from('{}')])), /bad piece/);
  assert.throws(() => one(EMPTY), /bad piece/);
  const n = link();
  assert.throws(() => new Assembler(n.c.receive).push(link().p.send.encrypt(EMPTY, Buffer.from([1, 0x7b, 0x7d]))));
});

test('handshake and ciphers: the published vector for Noise_IK_25519_ChaChaPoly_SHA256 (cacophony\'s, as in snow\'s tests/vectors)', () => {
  const pair = (priv) => ({ privateKey: hex(priv), publicKey: Buffer.from(publicFromPrivate(hex(priv))) });
  const prologue = hex('4a6f686e2047616c74');
  const initStatic = pair('e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1');
  const respStatic = pair('4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893');
  assert.equal(respStatic.publicKey.toString('hex'), '31e0303fd6418d2f8c0e78b91f22e8caed0fbe48656dcf4767e4834f701b8f62', 'init_remote_static');
  const init = new Handshake({ initiator: true, s: initStatic, rs: respStatic.publicKey, prologue, e: pair('893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a') });
  const resp = new Handshake({ initiator: false, s: respStatic, prologue, e: pair('bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b') });
  const messages = [
    ['4c756477696720766f6e204d69736573', 'ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944718da798efbcd91528520204f904b9bd6c7413dccdc214d951e15253e39987f18146e8cd0873654207148333479d4d16c289f0294b29960a72f48e0b7bba2e89083169825e59642148d492020664ccf7'],
    ['4d757272617920526f746862617264', '95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088435361e70b2ed446e6c9ec387d1d6b3b840f194e373979d241b203c4acafccf5'],
    ['462e20412e20486179656b', '050e9f3c8fac16b68dbce8f8c4bfbf6617c897f9ada4aa29aa19c8'],
    ['4361726c204d656e676572', '344233a6cabb7141d80f3da2fedc311d9646bbb0f505afe403a667'],
    ['4a65616e2d426170746973746520536179', '62cdeeb172ad7ade7aa7d9e069da5790f12331bfa00177787a1d0810c67dc3b2b4'],
    ['457567656e2042f6686d20766f6e2042617765726b', '029bead1b40992327044d409d9a1f3ad8f36c3c452775d557e18bbeb2e8dfcead32d514024'],
  ];
  const m1 = init.writeMessage(hex(messages[0][0]));
  assert.equal(m1.toString('hex'), messages[0][1], 'message 1');
  assert.equal(resp.readMessage(m1).toString('hex'), messages[0][0]);
  const m2 = resp.writeMessage(hex(messages[1][0]));
  assert.equal(m2.toString('hex'), messages[1][1], 'message 2');
  assert.equal(init.readMessage(m2).toString('hex'), messages[1][0]);
  assert.equal(init.hash.toString('hex'), '0b0f68fb0c27e03ce9b97565995ed4838cc0581b762ef72b062f6a546419fad7', 'handshake hash');
  assert.equal(resp.hash.toString('hex'), init.hash.toString('hex'));
  const i = init.split();
  const r = resp.split();
  // (transport messages alternate, the initiator first)
  messages.slice(2).forEach(([plain, cipher], n) => {
    const [from, to] = n % 2 === 0 ? [i, r] : [r, i];
    const ct = from.send.encrypt(EMPTY, hex(plain));
    assert.equal(ct.toString('hex'), cipher, `transport message ${n + 1}`);
    assert.equal(to.receive.decrypt(EMPTY, ct).toString('hex'), plain);
  });
});

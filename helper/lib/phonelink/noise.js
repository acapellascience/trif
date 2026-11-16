'use strict';
// The phone link's handshake and ciphers (docs/PHONE-LINK.md "The wire"): Noise_IK_25519_ChaChaPoly_SHA256,
// from the Noise Protocol Framework (revision 34, noiseprotocol.org), with Node's own crypto and nothing else.
// The iPhone app has the same in CryptoKit. The phone is the initiator: it knows the computer's static key (from
// the QR code), so its first message carries its own static key and its payload encrypted to the computer.
//
//   -> e, es, s, ss     (phone → computer)
//   <- e, ee, se        (computer → phone)
//
// Then two CipherStates, one per direction. Keys are 32-byte Buffers, public and private, as X25519 has them.
// Anything wrong (a short message, a tag that doesn't check, a low-order key) throws: the caller closes the
// connection and says nothing (server.js).

const crypto = require('crypto');

const PROTOCOL = 'Noise_IK_25519_ChaChaPoly_SHA256';
const PROLOGUE = 'TRIF phone link 1';
const DHLEN = 32;
const TAGLEN = 16;
const MAX_MESSAGE = 65535; // (a Noise message's limit)
const MAX_NONCE = 2 ** 48; // (far below Noise's 2^64-1, and exact in a Number; a link never gets there)

// X25519 keys as Node wants them: DER around the 32 raw bytes (RFC 8410).
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI = Buffer.from('302a300506032b656e032100', 'hex');

function key32(buf, what) {
  if (!Buffer.isBuffer(buf) || buf.length !== DHLEN) throw new Error(`${what}: 32 bytes expected`);
  return buf;
}
const privateObject = (raw) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, key32(raw, 'private key')]), format: 'der', type: 'pkcs8' });
const publicObject = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI, key32(raw, 'public key')]), format: 'der', type: 'spki' });

/** The public key of a private key. */
function publicFromPrivate(privateKey) {
  return crypto.createPublicKey(privateObject(privateKey)).export({ format: 'der', type: 'spki' }).subarray(SPKI.length);
}

/** A new key pair: {publicKey, privateKey}, 32 bytes each. */
function generateKeyPair() {
  const { privateKey } = crypto.generateKeyPairSync('x25519');
  const raw = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8.length);
  return { privateKey: Buffer.from(raw), publicKey: Buffer.from(publicFromPrivate(raw)) };
}

/** DH. Throws on a key that gives an all-zero secret (a low-order point), as OpenSSL does. */
function dh(privateKey, publicKey) {
  const out = crypto.diffieHellman({ privateKey: privateObject(privateKey), publicKey: publicObject(publicKey) });
  if (out.length !== DHLEN || out.every((b) => b === 0)) throw new Error('bad key');
  return out;
}

const hash = (...parts) => { const h = crypto.createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };
const hmac = (key, ...parts) => { const h = crypto.createHmac('sha256', key); for (const p of parts) h.update(p); return h.digest(); };

/** Noise's HKDF, two outputs. */
function hkdf2(chainingKey, input) {
  const temp = hmac(chainingKey, input);
  const out1 = hmac(temp, Buffer.from([1]));
  const out2 = hmac(temp, out1, Buffer.from([2]));
  return [out1, out2];
}

function nonceBytes(n) {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(BigInt(n), 4);
  return b;
}

function aeadEncrypt(key, n, ad, plaintext) {
  const c = crypto.createCipheriv('chacha20-poly1305', key, nonceBytes(n), { authTagLength: TAGLEN });
  c.setAAD(ad, { plaintextLength: plaintext.length });
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

function aeadDecrypt(key, n, ad, ciphertext) {
  if (ciphertext.length < TAGLEN) throw new Error('short message');
  const d = crypto.createDecipheriv('chacha20-poly1305', key, nonceBytes(n), { authTagLength: TAGLEN });
  d.setAAD(ad, { plaintextLength: ciphertext.length - TAGLEN });
  d.setAuthTag(ciphertext.subarray(ciphertext.length - TAGLEN));
  return Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - TAGLEN)), d.final()]); // (final throws on a bad tag)
}

/** One direction's cipher after the handshake (and the handshake's own, inside SymmetricState). */
class CipherState {
  constructor(key = null) { this.k = key; this.n = 0; }

  hasKey() { return !!this.k; }

  encrypt(ad, plaintext) {
    if (!this.k) return plaintext;
    if (this.n >= MAX_NONCE) throw new Error('too many messages on this link');
    return aeadEncrypt(this.k, this.n++, ad, plaintext);
  }

  /** Throws on a message that doesn't check; the nonce moves only on one that does. */
  decrypt(ad, ciphertext) {
    if (!this.k) return ciphertext;
    if (this.n >= MAX_NONCE) throw new Error('too many messages on this link');
    const out = aeadDecrypt(this.k, this.n, ad, ciphertext);
    this.n++;
    return out;
  }
}

const EMPTY = Buffer.alloc(0);

class SymmetricState {
  constructor(name) {
    const n = Buffer.from(name, 'ascii');
    this.h = n.length <= 32 ? Buffer.concat([n, Buffer.alloc(32 - n.length)]) : hash(n);
    this.ck = this.h;
    this.cipher = new CipherState();
  }

  mixKey(input) { const [ck, k] = hkdf2(this.ck, input); this.ck = ck; this.cipher = new CipherState(k); }
  mixHash(data) { this.h = hash(this.h, data); }
  encryptAndHash(plaintext) { const c = this.cipher.encrypt(this.h, plaintext); this.mixHash(c); return c; }
  decryptAndHash(ciphertext) { const p = this.cipher.decrypt(this.h, ciphertext); this.mixHash(ciphertext); return p; }
  split() { const [k1, k2] = hkdf2(this.ck, EMPTY); return [new CipherState(k1), new CipherState(k2)]; }
}

/**
 * One side of the IK handshake.
 *   new Handshake({ initiator, s: {publicKey, privateKey}, rs, prologue, e })
 *     rs: the computer's public key (the initiator must have it; the responder learns the phone's from message 1)
 *     e: an ephemeral key pair, for tests with fixed keys (made new otherwise)
 *   initiator: writeMessage(payload) -> message 1; readMessage(message 2) -> payload; then split()
 *   responder: readMessage(message 1) -> payload (and this.rs is the phone's key: decide now);
 *              writeMessage(payload) -> message 2; then split()
 *   split() -> {send, receive}: this side's CipherStates. this.hash: the handshake hash (the same on both sides).
 */
class Handshake {
  constructor({ initiator, s, rs = null, prologue = PROLOGUE, e = null }) {
    this.initiator = !!initiator;
    this.s = { publicKey: key32(s.publicKey, 'static public key'), privateKey: key32(s.privateKey, 'static private key') };
    this.e = e;
    this.rs = rs;
    this.re = null;
    this.step = 0; // (messages done)
    this.sym = new SymmetricState(PROTOCOL);
    this.sym.mixHash(Buffer.from(prologue));
    // (IK's pre-message: the responder's static key, known to both)
    this.sym.mixHash(this.initiator ? key32(rs, 'the computer\'s public key') : this.s.publicKey);
  }

  get hash() { return this.sym.h; }

  writeMessage(payload = EMPTY) {
    const sym = this.sym;
    const turn = this.initiator ? 0 : 1;
    if (this.step !== turn) throw new Error('not this side\'s turn to write');
    if (!this.e) this.e = generateKeyPair();
    const parts = [this.e.publicKey];
    sym.mixHash(this.e.publicKey);
    if (this.initiator) {
      sym.mixKey(dh(this.e.privateKey, this.rs)); // es
      parts.push(sym.encryptAndHash(this.s.publicKey)); // s
      sym.mixKey(dh(this.s.privateKey, this.rs)); // ss
    } else {
      sym.mixKey(dh(this.e.privateKey, this.re)); // ee
      sym.mixKey(dh(this.e.privateKey, this.rs)); // se
    }
    parts.push(sym.encryptAndHash(payload));
    const out = Buffer.concat(parts);
    if (out.length > MAX_MESSAGE) throw new Error('handshake payload too big');
    this.step++;
    return out;
  }

  readMessage(message) {
    const sym = this.sym;
    const turn = this.initiator ? 1 : 0;
    if (this.step !== turn) throw new Error('not this side\'s turn to read');
    if (!Buffer.isBuffer(message) || message.length > MAX_MESSAGE) throw new Error('bad message');
    let at = 0;
    const take = (n) => { if (message.length < at + n) throw new Error('short message'); const b = message.subarray(at, at + n); at += n; return b; };
    this.re = Buffer.from(take(DHLEN));
    sym.mixHash(this.re);
    if (this.initiator) {
      sym.mixKey(dh(this.e.privateKey, this.re)); // ee
      sym.mixKey(dh(this.s.privateKey, this.re)); // se
    } else {
      sym.mixKey(dh(this.s.privateKey, this.re)); // es
      this.rs = Buffer.from(sym.decryptAndHash(take(DHLEN + TAGLEN))); // s
      sym.mixKey(dh(this.s.privateKey, this.rs)); // ss
    }
    const payload = sym.decryptAndHash(message.subarray(at));
    this.step++;
    return payload;
  }

  split() {
    if (this.step !== 2) throw new Error('the handshake isn\'t done');
    const [c1, c2] = this.sym.split(); // (c1: initiator → responder)
    return this.initiator ? { send: c1, receive: c2 } : { send: c2, receive: c1 };
  }
}

/** A key's short id: the first 8 bytes of its SHA-256, hex (the Bonjour record's `id`, a paired phone's `id`). */
const keyId = (publicKey) => hash(key32(publicKey, 'public key')).subarray(0, 8).toString('hex');

module.exports = { PROTOCOL, PROLOGUE, DHLEN, TAGLEN, MAX_MESSAGE, generateKeyPair, publicFromPrivate, dh, hkdf2, CipherState, Handshake, keyId };

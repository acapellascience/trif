'use strict';
// The phone link's messages on the wire (docs/PHONE-LINK.md "The wire").
//
// On the TCP connection: Noise messages, each after its length (2 bytes, big-endian). PacketReader cuts the
// stream into them, for the handshake's two messages and everything after.
//
// After the handshake, an application message (one JSON object, at most MAX_JSON bytes) travels as pieces, one
// per Noise transport message: a first byte (0 = more follows, 1 = the last piece), then the piece. `seal` makes
// the packets, `Assembler` puts the decrypted pieces back together.

const { MAX_MESSAGE, TAGLEN } = require('./noise');

const MAX_JSON = 8 * 1024 * 1024;
const PIECE = MAX_MESSAGE - TAGLEN - 1; // (what fits in one transport message beside the first byte)
const MORE = 0;
const LAST = 1;

/** A Noise message with its length before it. */
function packet(message) {
  if (message.length > MAX_MESSAGE) throw new Error('message too big for one packet');
  const head = Buffer.alloc(2);
  head.writeUInt16BE(message.length);
  return Buffer.concat([head, message]);
}

/** The stream cut back into Noise messages: push(chunk) -> [message, …]. */
class PacketReader {
  constructor() { this.buf = Buffer.alloc(0); }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    while (this.buf.length >= 2) {
      const len = this.buf.readUInt16BE(0);
      if (this.buf.length < 2 + len) break;
      out.push(this.buf.subarray(2, 2 + len));
      this.buf = this.buf.subarray(2 + len);
    }
    return out;
  }

  /** Bytes waiting for the rest of their message. */
  get waiting() { return this.buf.length; }
}

/** An object as packets ready to write: encrypted with `cipher` (this side's `send`), in order. */
function seal(cipher, obj) {
  const json = Buffer.from(JSON.stringify(obj));
  if (json.length > MAX_JSON) throw new Error('message too big');
  const out = [];
  let at = 0;
  do {
    const piece = json.subarray(at, at + PIECE);
    at += piece.length;
    out.push(packet(cipher.encrypt(Buffer.alloc(0), Buffer.concat([Buffer.from([at >= json.length ? LAST : MORE]), piece]))));
  } while (at < json.length);
  return out;
}

/**
 * Decrypted pieces back into objects: push(noiseMessage) -> the object when its last piece came, else undefined.
 * Throws on a piece that doesn't decrypt, a first byte that's neither, more than MAX_JSON, or JSON that isn't an
 * object: the caller closes the connection.
 */
class Assembler {
  constructor(cipher, { max = MAX_JSON } = {}) { this.cipher = cipher; this.max = max; this.parts = []; this.size = 0; }

  push(message) {
    const plain = this.cipher.decrypt(Buffer.alloc(0), message);
    if (!plain.length || (plain[0] !== MORE && plain[0] !== LAST)) throw new Error('bad piece');
    this.size += plain.length - 1;
    if (this.size > this.max) throw new Error('message too big');
    this.parts.push(plain.subarray(1));
    if (plain[0] === MORE) return undefined;
    const json = Buffer.concat(this.parts);
    this.parts = [];
    this.size = 0;
    const obj = JSON.parse(json.toString('utf8'));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not a message');
    return obj;
  }
}

module.exports = { MAX_JSON, PIECE, packet, PacketReader, seal, Assembler };

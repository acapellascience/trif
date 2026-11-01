'use strict';
// Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON.

// Chrome refuses host->extension messages over 1 MB.
const MAX_TO_EXTENSION = 1024 * 1024;
// Extension->host messages can be much larger (screenshots, response bodies); cap for sanity.
const MAX_FROM_EXTENSION = 256 * 1024 * 1024;

function encode(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Bytes received but not yet used, kept as the chunks they arrived in. A big message arrives in
 * thousands of small chunks; joining them all on every chunk would copy the message over and over
 * (gigabytes for a 20 MB screenshot), so bytes are only joined when they're taken.
 */
class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    if (!chunk.length) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  /** The first n bytes (n <= length), without removing them. */
  peek(n) {
    const first = this.chunks[0];
    if (first.length >= n) return first.subarray(0, n);
    const parts = [];
    for (let i = 0, got = 0; got < n; i++) { parts.push(this.chunks[i]); got += this.chunks[i].length; }
    return Buffer.concat(parts).subarray(0, n);
  }

  /** Removes and returns the first n bytes (n <= length). */
  take(n) {
    let i = 0;
    let got = 0;
    while (got < n) got += this.chunks[i++].length;
    const joined = i === 1 ? this.chunks[0] : Buffer.concat(this.chunks.slice(0, i), got);
    this.chunks.splice(0, i);
    if (got > n) this.chunks.unshift(joined.subarray(n));
    this.length -= n;
    return joined.subarray(0, n);
  }

  clear() {
    this.chunks = [];
    this.length = 0;
  }
}

/**
 * Turns pushed chunks into messages. onError(err) gets bad JSON frames (skipped; the next frame is still
 * read) and frames over maxLength. An oversize length means the stream can't be trusted any more (it's
 * most likely out of step, so every later "length" would be garbage), so that error has `fatal: true`
 * and the decoder ignores everything after it: whoever owns the stream should close it.
 */
class Decoder {
  constructor(onMessage, onError = () => {}, maxLength = MAX_FROM_EXTENSION) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.maxLength = maxLength;
    this.queue = new ByteQueue();
    this.need = -1; // the current frame's body length, once its header is read
    this.failed = false;
  }

  push(chunk) {
    if (this.failed) return;
    this.queue.push(chunk);
    for (;;) {
      if (this.need < 0) {
        if (this.queue.length < 4) return;
        const len = this.queue.take(4).readUInt32LE(0);
        if (len > this.maxLength) {
          this.failed = true;
          this.queue.clear();
          const e = new Error(`frame of ${len} bytes exceeds the ${this.maxLength}-byte limit; ignoring the rest of the stream`);
          e.fatal = true;
          this.onError(e);
          return;
        }
        this.need = len;
      }
      if (this.queue.length < this.need) return;
      const body = this.queue.take(this.need);
      this.need = -1;
      let msg;
      try {
        msg = JSON.parse(body.toString('utf8'));
      } catch (e) {
        this.onError(new Error(`bad JSON frame: ${e.message}`));
        continue;
      }
      this.onMessage(msg);
    }
  }
}

module.exports = { encode, Decoder, ByteQueue, MAX_TO_EXTENSION, MAX_FROM_EXTENSION };

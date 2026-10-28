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

class Decoder {
  constructor(onMessage, onError = () => {}, maxLength = MAX_FROM_EXTENSION) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.maxLength = maxLength;
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    this.chunks.push(chunk);
    this.length += chunk.length;
    for (;;) {
      if (this.length < 4) return;
      const head = this.chunks.length === 1 ? this.chunks[0] : this._flatten();
      const len = head.readUInt32LE(0);
      if (len > this.maxLength) {
        this.onError(new Error(`frame of ${len} bytes exceeds limit; dropping buffered input`));
        this.chunks = [];
        this.length = 0;
        return;
      }
      if (this.length < 4 + len) return;
      const buf = this._flatten();
      const body = buf.subarray(4, 4 + len);
      const rest = buf.subarray(4 + len);
      this.chunks = rest.length ? [rest] : [];
      this.length = rest.length;
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

  _flatten() {
    if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks, this.length)];
    return this.chunks[0];
  }
}

module.exports = { encode, Decoder, MAX_TO_EXTENSION, MAX_FROM_EXTENSION };

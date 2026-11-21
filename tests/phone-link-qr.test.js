'use strict';
// The side panel's QR encoder (extension/qr.js: Connect a phone's code). Its matrices against another
// encoder's, module for module: tests/phone-link-qr.vectors.json holds what macOS's own generator
// (CoreImage's CIQRCodeGenerator, macOS 15.7) makes of the same texts in byte mode, at level M and L: versions
// 1, 7 (the version bits) and 10 (two sizes of block, the 16-bit count), the mask included. When the vectors
// were made, macOS's reader (Vision) also read every one of this encoder's codes back to its text.

const test = require('node:test');
const assert = require('node:assert');
const VECTORS = require('./phone-link-qr.vectors.json');

const load = () => import('../extension/qr.js');
const bits = (qr) => qr.rows.map((r) => Array.from(r).join(''));
const fromHex = (v) => v.rows.map((h) => BigInt(`0x${h}`).toString(2).padStart(v.size, '0'));

test('qr: the same matrix as macOS\'s generator, versions 1, 7 and 10, level M and L', async () => {
  const { qrMatrix } = await load();
  const seen = [];
  for (const [name, v] of Object.entries(VECTORS)) {
    const qr = qrMatrix(v.text, { level: v.level || 'M' });
    assert.strictEqual(qr.size, v.size, name);
    assert.deepStrictEqual(bits(qr), fromHex(v), `${name}: every module, the mask's choice included`);
    seen.push([name, qr.version, qr.level]);
  }
  assert.deepStrictEqual(seen, [['small', 1, 'M'], ['pair', 7, 'M'], ['long', 10, 'M'], ['pairL', 6, 'L']]);
});

test('qr: the level and the version chosen by length; too long is an error, not a broken code', async () => {
  const { qrMatrix, qrFit, QR_MAX_VERSION } = await load();
  assert.strictEqual(QR_MAX_VERSION, 10);
  // (byte mode's room at M: 14 bytes in version 1, 213 in version 10; at L, 271)
  assert.deepStrictEqual(qrFit(14), { version: 1, level: 'M' });
  assert.deepStrictEqual(qrFit(15), { version: 2, level: 'M' });
  assert.deepStrictEqual(qrFit(213), { version: 10, level: 'M' });
  assert.deepStrictEqual(qrFit(214), { version: 9, level: 'L' });
  assert.deepStrictEqual(qrFit(271), { version: 10, level: 'L' });
  assert.strictEqual(qrFit(272), null);
  assert.strictEqual(qrFit(214, 'M'), null);
  assert.strictEqual(qrMatrix('x'.repeat(230)).level, 'L');
  assert.throws(() => qrMatrix('x'.repeat(272)), /too long/);
  assert.throws(() => qrMatrix('x', { level: 'H' }), /level/);
  assert.throws(() => qrMatrix('x', { mask: 8 }), /mask/);
  // UTF-8: bytes count, not characters
  assert.strictEqual(qrMatrix('é'.repeat(7)).version, 1);
  assert.strictEqual(qrMatrix('é'.repeat(8)).version, 2);
});

test('qr: every size has its three finders, the timing lines and the dark module; the chosen mask scores lowest', async () => {
  const { qrMatrix, qrPenalty } = await load();
  for (const n of [1, 20, 40, 60, 90, 110, 130, 160, 190, 213]) {
    const text = 'k'.repeat(n);
    const qr = qrMatrix(text);
    const { size, rows } = qr;
    assert.strictEqual(size, qr.version * 4 + 17);
    assert.ok(rows.length === size && rows.every((r) => r.length === size));
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          assert.strictEqual(rows[cy + dy][cx + dx], d === 2 ? 0 : 1, `version ${qr.version}: a finder`);
        }
      }
    }
    for (let i = 8; i < size - 8; i++) { assert.strictEqual(rows[6][i], (i + 1) % 2); assert.strictEqual(rows[i][6], (i + 1) % 2); }
    assert.strictEqual(rows[size - 8][8], 1);
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => qrPenalty(qrMatrix(text, { mask }).rows));
    assert.strictEqual(qrPenalty(rows), Math.min(...scores));
    assert.strictEqual(qr.mask, scores.indexOf(Math.min(...scores)), 'the first of the lowest');
  }
});

test('qr: the path draws exactly the dark modules, inside the quiet zone', async () => {
  const { qrMatrix, qrPath } = await load();
  const qr = qrMatrix(VECTORS.pair.text);
  const { d, size } = qrPath(qr);
  assert.strictEqual(size, qr.size + 8);
  const drawn = Array.from({ length: size }, () => new Uint8Array(size));
  const parts = d.match(/M\d+ \d+h\d+v1h-\d+z/g);
  assert.strictEqual(parts.join(''), d, 'nothing but row runs');
  for (const part of parts) {
    const [, x, y, w, back] = /^M(\d+) (\d+)h(\d+)v1h-(\d+)z$/.exec(part).map(Number);
    assert.strictEqual(w, back);
    for (let i = 0; i < w; i++) { assert.strictEqual(drawn[y][x + i], 0, 'no module twice'); drawn[y][x + i] = 1; }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = x >= 4 && y >= 4 && x < size - 4 && y < size - 4;
      assert.strictEqual(drawn[y][x], inside ? qr.rows[y - 4][x - 4] : 0);
    }
  }
  assert.strictEqual(qrPath(qr, 0).size, qr.size);
});

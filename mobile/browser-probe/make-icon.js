#!/usr/bin/env node
'use strict';
// Writes the iPhone app's icon, TrifProbe/Assets.xcassets/AppIcon.appiconset/icon-1024.png: the robot's head as
// the whole icon, as the Safari app's (scripts/render-icon.js renderMac: the square in the rim's green, the face
// inset by the rim, so iOS's own rounded mask becomes the head's outline), at 1024 px, without an alpha channel
// (iOS fills transparent parts black). One size is all iOS 17 and later need. The PNG is kept in the repository,
// so building doesn't need this; run it again when the robot changes:
//
//   node mobile/browser-probe/make-icon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { renderMac } = require('../../scripts/render-icon');

const SIZE = 1024;
const dir = path.join(__dirname, 'TrifProbe', 'Assets.xcassets', 'AppIcon.appiconset');

/** An RGBA PNG (renderMac's: one IDAT, filter 0 on every row) as an RGB one. */
function withoutAlpha(rgba) {
  const idat = [];
  for (let o = 8; o < rgba.length;) {
    const len = rgba.readUInt32BE(o), type = rgba.toString('latin1', o + 4, o + 8);
    if (type === 'IDAT') idat.push(rgba.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(SIZE * (1 + SIZE * 3));
  for (let y = 0; y < SIZE; y++) {
    const i = y * (1 + SIZE * 4), j = y * (1 + SIZE * 3);
    for (let x = 0; x < SIZE; x++) {
      const a = raw[i + 1 + x * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) out[j + 1 + x * 3 + c] = Math.round(raw[i + 1 + x * 4 + c] * a); // (on black, should any pixel not be opaque)
    }
  }
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([rgba.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-1024.png'), withoutAlpha(renderMac(SIZE)));
fs.writeFileSync(path.join(dir, 'Contents.json'), `${JSON.stringify({
  images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
  info: { author: 'xcode', version: 1 },
}, null, 2)}\n`);
fs.writeFileSync(path.join(dir, '..', 'Contents.json'), `${JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), dir)}/icon-1024.png`);

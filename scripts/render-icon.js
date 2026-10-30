#!/usr/bin/env node
'use strict';
// Draws the WebMods icon (store/icon.svg: a grey W whose right half is switch-on green) into
// extension/icons/icon-<size>.png, antialiased with 8x8 supersampling. No dependencies: shapes are
// signed distances, PNGs are written by hand. Usage: node scripts/render-icon.js [outDir] [sizes...]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outDir = process.argv[2] || path.join(__dirname, '..', 'extension', 'icons');
const sizes = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [16, 32, 48, 128];

// Geometry in 128-unit icon space (same numbers as store/icon.svg).
const TILE = { cx: 64, cy: 64, half: 56, r: 26, color: [0x6b, 0x72, 0x80] };
const STROKE = 10.5 / 2;
const LEFT = { pts: [[33.7, 43], [47.7, 87.3], [64, 52.3]], color: [0xff, 0xff, 0xff] };
const RIGHT = { pts: [[64, 52.3], [80.3, 87.3], [94.3, 43]], color: [0x34, 0xd3, 0x99] };
const SPLIT = 64;

const roundRect = (x, y, { cx, cy, half, r }) => {
  const qx = Math.abs(x - cx) - half + r;
  const qy = Math.abs(y - cy) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const segment = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
const polyline = (x, y, pts) => Math.min(...pts.slice(1).map((p, i) => segment(x, y, pts[i], p)));

/** Colour at one point, or null outside the tile. */
function sample(x, y) {
  if (roundRect(x, y, TILE) > 0) return null;
  if (Math.min(polyline(x, y, LEFT.pts), polyline(x, y, RIGHT.pts)) > STROKE) return TILE.color;
  return x < SPLIT ? LEFT.color : RIGHT.color; // a clean vertical cut through the middle peak
}

function render(size) {
  const N = 8;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0, then RGBA
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = sample(((px + (sx + 0.5) / N) * 128) / size, ((py + (sy + 0.5) / N) * 128) / size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = 1 + px * 4;
      if (a) { row[o] = Math.round(r / a); row[o + 1] = Math.round(g / a); row[o + 2] = Math.round(b / a); }
      row[o + 3] = Math.round((a / (N * N)) * 255);
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => { let c = -1; for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of sizes) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(file);
}

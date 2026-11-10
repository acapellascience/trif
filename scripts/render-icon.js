#!/usr/bin/env node
'use strict';
// Draws the TRIF icon (the robot's head: a dark squircle in a switch-green rim, with two mint eyes) into
// extension/icons/robot-<size>.png, antialiased with 8x8 supersampling, the same robot with a pause sign for
// eyes (two mint bars) into robot-paused-<size>.png (the toolbar icon of a tab TRIF has paused posting in,
// background.js and tablock.js), and writes the same shapes to
// store/icon.svg and the side panel's big shaded robot to extension/icons/robot-shaded.svg (and in red,
// robot-shaded-red.svg, for when TRIF can't run mods). No dependencies: shapes are superellipses, PNGs are
// written by hand.
// A new design gets new file names (manifest.json, sidepanel.html, onboarding.html): Firefox keeps an
// icon it has drawn in its image cache, keyed by URL, until it quits, so new pixels at an old path keep
// showing the old icon after an update or reload (the W outlived the switch to the robot that way).
// Usage: node scripts/render-icon.js [outDir] [sizes...]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outDir = require.main === module && process.argv[2] || path.join(__dirname, '..', 'extension', 'icons');
const sizes = require.main === module && process.argv.length > 3 ? process.argv.slice(3).map(Number) : [16, 32, 48, 128];
const SVG_FILE = path.join(__dirname, '..', 'store', 'icon.svg');
const SHADED_FILE = path.join(__dirname, '..', 'extension', 'icons', 'robot-shaded.svg');
const SHADED_RED_FILE = path.join(__dirname, '..', 'extension', 'icons', 'robot-shaded-red.svg');

// Geometry in 128-unit icon space. A superellipse |x/a|^n + |y/b|^n = 1: the head is n 3 (a squircle), the
// eyes n 2.3 (rounder, a touch taller than wide).
const HEAD = { cx: 64, cy: 64, outer: 56, inner: 46, n: 3, rim: [0x34, 0xd3, 0x99], face: [0x18, 0x18, 0x1a] };
const EYES = { cy: 63, xs: [45, 83], a: 12.35, b: 13.3, n: 2.3, color: [0x59, 0xdb, 0xab] };
// The pause sign: two bars in the eyes' mint, centred on the face, a bar's width apart. Their edges fall on
// whole pixels at 16, 32 and 48 px (a toolbar pixel is 7 units at 16 px), so they stay sharp: at 16 px each
// is 2 px wide and 6 px tall, with 2 px between. Corners rounded a little (r), like the eyes.
const PAUSE = { xs: [[43, 57], [71, 85]], y: [43, 85], r: 3.5, color: EYES.color };
// The toolbar sizes drop the 8-unit margin (the head fills the square, like other toolbar icons); the
// 128 px icon keeps it for the Web Store and chrome://extensions.
const FULL_BLEED_MAX = 48;
// The shaded robot's colours: the rim's gradient (top left to bottom right), the eyes' (centre to edge),
// and the eyes' glow (r g b, 0 to 1). Green as usual; red when the helper isn't connected or user scripts
// are off (the side panel's --bad).
const SHADED = {
  green: { rim: ['#44e0a8', '#1e9a6c'], eye: ['#a7f3d0', '#2fc58d'], glow: [0.204, 0.827, 0.6] },
  red: { rim: ['#ff8a80', '#c4372d'], eye: ['#ffd0cb', '#e5484d'], glow: [1, 0.45, 0.42] },
};

const inside = (x, y, cx, cy, a, b, n) => (Math.abs(x - cx) / a) ** n + (Math.abs(y - cy) / b) ** n <= 1;

/** Colour at one point, or null outside the head. */
function sample(x, y) {
  const { cx, cy, outer, inner, n } = HEAD;
  if (!inside(x, y, cx, cy, outer, outer, n)) return null;
  if (!inside(x, y, cx, cy, inner, inner, n)) return HEAD.rim;
  return EYES.xs.some((ex) => inside(x, y, ex, EYES.cy, EYES.a, EYES.b, EYES.n)) ? EYES.color : HEAD.face;
}

/** A rounded rectangle from x0,y0 to x1,y1 with corners of radius r. */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(0, x0 + r - x, x - (x1 - r)), dy = Math.max(0, y0 + r - y, y - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}

/** The paused robot's colour at one point: the head as usual, the pause sign in place of the eyes. */
function samplePaused(x, y) {
  const c = sample(x, y);
  if (c !== EYES.color && c !== HEAD.face) return c; // (outside, or the rim)
  return PAUSE.xs.some(([x0, x1]) => inRoundRect(x, y, x0, PAUSE.y[0], x1, PAUSE.y[1], PAUSE.r)) ? PAUSE.color : HEAD.face;
}

/** The same shapes as SVG polygons. */
function svg() {
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const shape = (cx, cy, a, b, n, fill) => {
    const pts = [];
    for (let i = 0; i < 180; i++) {
      const t = (i / 180) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      pts.push(`${+(cx + a * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(2)},${+(cy + b * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(2)}`);
    }
    return `  <polygon fill="${hex(fill)}" points="${pts.join(' ')}"/>`;
  };
  const { cx, cy, outer, inner, n } = HEAD;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">',
    '  <!-- TRIF icon, written by scripts/render-icon.js (edit the numbers there, not this file). Alternates with',
    '       more depth, for when he needs it: store/icon-alt-borderless.svg, store/icon-alt-shaded.svg. -->',
    shape(cx, cy, outer, outer, n, HEAD.rim),
    shape(cx, cy, inner, inner, n, HEAD.face),
    ...EYES.xs.map((ex) => shape(ex, EYES.cy, EYES.a, EYES.b, EYES.n, EYES.color)),
    '</svg>',
    '',
  ].join('\n');
}

/**
 * The shaded robot (store/icon-alt-shaded.svg's look), drawn big in the side panel when no website is open:
 * the rim as a stroke along the head's midline, darker toward the bottom right; gradient eyes with a soft
 * glow. Points are spaced evenly by angle about each centre, so the outline has no visible corners even
 * where a superellipse is flattest (the 180 points of svg() show facets there at 160 px).
 */
function shadedSvg({ rim, eye, glow } = SHADED.green) {
  const shape = (cx, cy, a, b, n) => {
    const pts = [];
    for (let i = 0; i < 360; i++) {
      const t = (i / 360) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      const r = (Math.abs(c / a) ** n + Math.abs(s / b) ** n) ** (-1 / n);
      pts.push(`${+(cx + r * c).toFixed(2)},${+(cy + r * s).toFixed(2)}`);
    }
    return pts.join(' ');
  };
  const { cx, cy, outer, inner, n } = HEAD;
  const mid = (outer + inner) / 2;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">',
    '  <!-- Written by scripts/render-icon.js (edit the numbers there, not this file). -->',
    '  <defs>',
    `    <linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${rim[0]}"/><stop offset="1" stop-color="${rim[1]}"/></linearGradient>`,
    `    <radialGradient id="e" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="${eye[0]}"/><stop offset="1" stop-color="${eye[1]}"/></radialGradient>`,
    `    <filter id="h" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="b"/><feColorMatrix in="b" type="matrix" values="${glow.map((c) => `0 0 0 0 ${c}`).join('  ')}  0 0 0 0.5 0" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    '  </defs>',
    `  <polygon points="${shape(cx, cy, mid, mid, n)}" fill="#18181a" stroke="url(#r)" stroke-width="${outer - inner}" stroke-linejoin="round"/>`,
    `  <g filter="url(#h)">${EYES.xs.map((ex) => `<polygon points="${shape(ex, EYES.cy, EYES.a, EYES.b, EYES.n)}" fill="url(#e)"/>`).join('')}</g>`,
    '</svg>',
    '',
  ].join('\n');
}

/** One size as PNG bytes. `zoom` scales the head about the centre (default: fill the square up to 48 px). */
function render(size, zoom = size <= FULL_BLEED_MAX ? (HEAD.outer + 8) / HEAD.outer : 1, at0 = sample) {
  const N = 8;
  const at = (p) => ((p * 128) / size - 64) / zoom + 64; // pixel position -> icon space
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0, then RGBA
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = at0(at(px + (sx + 0.5) / N), at(py + (sy + 0.5) / N));
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

// The Safari app's icon (macOS) is full bleed: the whole square is rim green, and the system's own rounded
// mask becomes the head's outline. Safari (Settings → Extensions) and macOS 26 put an icon with transparent
// margins on a white tile instead. The face is the mask inset by the rim (a rounded square: Apple's mask has
// corners of about 22.4% of the side), so the rim left after masking is as thick all round as the toolbar
// icon's; the eyes are the toolbar icon's, scaled with the face. Without a mask (Finder and the Dock before
// macOS 26) it shows as a green square; acceptable, since TRIF.app is only a container people open once.
const MAC = { r: 0.224 * 128, rim: (HEAD.outer - HEAD.inner) * (64 / HEAD.outer) };
function sampleMac(x, y) {
  const half = 64 - MAC.rim;
  const r = MAC.r - MAC.rim;
  const dx = Math.max(0, Math.abs(x - 64) - (half - r));
  const dy = Math.max(0, Math.abs(y - 64) - (half - r));
  if (Math.abs(x - 64) > half || Math.abs(y - 64) > half || dx * dx + dy * dy > r * r) return HEAD.rim;
  // Eyes: the toolbar icon's, zoomed with the head (64 / outer) about the centre.
  const k = HEAD.outer / 64;
  const ex = (x - 64) * k + 64, ey = (y - 64) * k + 64;
  return EYES.xs.some((cx) => inside(ex, ey, cx, EYES.cy, EYES.a, EYES.b, EYES.n)) ? EYES.color : HEAD.face;
}

/** The paused robot at `size` px, as PNG bytes (the toolbar icon's framing). */
function renderPaused(size) { return render(size, undefined, samplePaused); }

/** The Mac app icon at `size` px, as PNG bytes (opaque, full bleed). */
function renderMac(size) { return render(size, 1, sampleMac); }

if (require.main === module) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of sizes) {
    const file = path.join(outDir, `robot-${size}.png`);
    fs.writeFileSync(file, render(size));
    console.log(file);
    const paused = path.join(outDir, `robot-paused-${size}.png`);
    fs.writeFileSync(paused, renderPaused(size));
    console.log(paused);
  }
  if (!process.argv[2]) {
    fs.writeFileSync(SVG_FILE, svg()); console.log(SVG_FILE);
    fs.writeFileSync(SHADED_FILE, shadedSvg()); console.log(SHADED_FILE);
    fs.writeFileSync(SHADED_RED_FILE, shadedSvg(SHADED.red)); console.log(SHADED_RED_FILE);
  }
}

module.exports = { render, renderPaused, renderMac, PAUSE };

#!/usr/bin/env node
'use strict';
// Draws the TRIF icon (the robot's head: a dark squircle in a switch-green rim, with two mint eyes) into
// extension/icons/robot-<size>.png, antialiased with 8x8 supersampling, the same robot with a pause sign for
// eyes, all white (frame and bars) into robot-paused-white-<size>.png (the toolbar icon of a tab TRIF has
// paused posting in, background.js and tablock.js), the robot's other faces (FACES: off, a blank face;
// blocked, red with a red cross; logged out, yellow with hollow eyes) into robot-<face>-<size>.png, and
// writes the same shapes to
// store/icon.svg and the side panel's big shaded robot to extension/icons/robot-shaded.svg (and in red,
// robot-shaded-red.svg, for when TRIF can't run mods), and the gate's shaded robots (robot-shaded-off*.svg,
// robot-shaded-blocked.svg). No dependencies: shapes are superellipses, PNGs are written by hand.
// The robot is always one colour: its frame and its features share the state's colour (docs/STYLE.md;
// the usual robot's rim and mint eyes are both TRIF green).
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
// The pause sign: two white bars in a white frame (the side panel's paused colour), centred on the face, a bar's width apart. Their edges fall on
// whole pixels at 16, 32 and 48 px (a toolbar pixel is 7 units at 16 px), so they stay sharp: at 16 px each
// is 2 px wide and 6 px tall, with 2 px between. Corners rounded a little (r), like the eyes.
const PAUSE = { xs: [[43, 57], [71, 85]], y: [43, 85], r: 3.5, color: [0xff, 0xff, 0xff] };
// The cross of a blocked site: two strokes through the middle, in place of the eyes. At 16 px it's drawn on
// whole pixels (CROSS16, a 6 x 6 pattern of 7-unit cells over the pause sign's square, so 2 px strokes);
// bigger, as two smooth strokes (half-width w) between the same corners.
const CROSS = { from: 46.5, to: 81.5, w: 7 };
const CROSS16 = ['#....#', '##..##', '.####.', '.####.', '##..##', '#....#'];
// Hollow eyes (logged out): the eyes' outline only, `ring` units thick; at 16 px, whole pixels (RING16:
// each eye a 3 x 4 px outline, its middle 1 x 2 px open, at the eyes' places).
const RING = { 32: 7, 48: 5.25, 128: 6 };
const RING16 = { cols: [4, 9], rows: 6, cells: ['###', '#.#', '#.#', '###'] };
// The faces in the toolbar: one colour each, frame and features alike. Red and yellow are the side panel's
// (--bad and --warn on dark).
const RED = [0xff, 0x7b, 0x70], YELLOW = [0xe8, 0xb0, 0x4a], GREY = [0xa1, 0xa1, 0xa8];
// Disconnected: a broken link (two chain-link halves pulled apart, Material's link_off without its slash,
// which would read as blocked). At 16 px a pattern on whole pixels (LINK16, 10 x 5 from column 3, row 6);
// bigger, the same halves as smooth strokes (LINK: each half a C round a centre, its top and bottom running
// to the gap, and a stub toward it). PLUG16: the other idea, a plug pulled out of its socket (the sheet only).
const LINK16 = ['.###..###.', '#........#', '#.##..##.#', '#........#', '.###..###.'];
const PLUG16 = ['##......##', '####....##', '##......##', '####....##', '##......##'];
const LINK = { cx: 44, r: 11, end: 53, stub: [48, 53], w: 3.5, cy: 64 };
const FACES = {
  off: { rim: HEAD.rim, eyes: 'none' },
  disconnected: { rim: GREY, eyes: 'link', color: GREY },
  blocked: { rim: RED, eyes: 'cross', color: RED },
  login: { rim: YELLOW, eyes: 'ring', color: YELLOW },
};
// The toolbar sizes drop the 8-unit margin (the head fills the square, like other toolbar icons); the
// 128 px icon keeps it for the Web Store and chrome://extensions.
const FULL_BLEED_MAX = 48;
// The shaded robot's colours: the rim's gradient (top left to bottom right), the eyes' (centre to edge),
// and the eyes' glow (r g b, 0 to 1). Green as usual; red when the helper isn't connected or user scripts
// are off (the side panel's --bad).
const SHADED = {
  green: { rim: ['#44e0a8', '#1e9a6c'], eye: ['#a7f3d0', '#2fc58d'], glow: [0.204, 0.827, 0.6] },
  red: { rim: ['#ff8a80', '#c4372d'], eye: ['#ffd0cb', '#e5484d'], glow: [1, 0.45, 0.42] },
  yellow: { rim: ['#f6cf6e', '#b7791f'], eye: ['#fde9b8', '#e8b04a'], glow: [0.91, 0.69, 0.29] },
  grey: { rim: ['#c8c8ce', '#7c7c82'], eye: ['#e4e4e8', '#a1a1a8'], glow: [0.63, 0.63, 0.66] },
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

/** The paused robot's colour at one point: the head in white, the pause sign in place of the eyes. */
function samplePaused(x, y) {
  const c = sample(x, y);
  if (c === HEAD.rim) return PAUSE.color;
  if (c !== EYES.color && c !== HEAD.face) return c; // (outside)
  return PAUSE.xs.some(([x0, x1]) => inRoundRect(x, y, x0, PAUSE.y[0], x1, PAUSE.y[1], PAUSE.r)) ? PAUSE.color : HEAD.face;
}

/** Distance from (x, y) to the segment (x0, y0)-(x1, y1). */
function toSegment(x, y, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

/** A face's colour at one point at `size` px (FACES), or null outside the head. */
function faceSampler(face, size) {
  const f = face === 'plug' ? { rim: GREY, eyes: 'plug', color: GREY } : FACES[face];
  const ring = RING[size] || 6; // (16 px: RING16)
  const { cx, cy, outer, inner, n } = HEAD;
  return (x, y) => {
    if (!inside(x, y, cx, cy, outer, outer, n)) return null;
    if (!inside(x, y, cx, cy, inner, inner, n)) return f.rim;
    if (f.eyes === 'cross') {
      if (size === 16) {
        const c = Math.floor((x - 43) / 7), r = Math.floor((y - 43) / 7);
        return c >= 0 && c < 6 && r >= 0 && r < 6 && CROSS16[r][c] === '#' ? f.color : HEAD.face;
      }
      const { from, to, w } = CROSS;
      return Math.min(toSegment(x, y, from, from, to, to), toSegment(x, y, to, from, from, to)) <= w ? f.color : HEAD.face;
    }
    if (f.eyes === 'link' || f.eyes === 'plug') {
      if (size === 16 || f.eyes === 'plug') { // (7-unit cells: a pixel at 16 px)
        const pat = f.eyes === 'plug' ? PLUG16 : LINK16;
        const c = Math.floor((x - 64) / 7) + 8 - 3, r = Math.floor((y - 64) / 7) + 8 - 6;
        return c >= 0 && c < 10 && r >= 0 && r < 5 && pat[r][c] === '#' ? f.color : HEAD.face;
      }
      return inLink(x, y) ? f.color : HEAD.face;
    }
    if (f.eyes === 'ring' && size === 16) {
      const r = Math.floor((y - 64) / 7) + 8 - RING16.rows, px = Math.floor((x - 64) / 7) + 8;
      const hit = RING16.cols.some((c0) => px - c0 >= 0 && px - c0 < 3 && r >= 0 && r < 4 && RING16.cells[r][px - c0] === '#');
      return hit ? f.color : HEAD.face;
    }
    if (f.eyes === 'ring') {
      return EYES.xs.some((ex) => inside(x, y, ex, EYES.cy, EYES.a, EYES.b, EYES.n) && !inside(x, y, ex, EYES.cy, EYES.a - ring, EYES.b - ring, EYES.n)) ? f.color : HEAD.face;
    }
    return HEAD.face;
  };
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
function shadedSvg({ rim, eye, glow } = SHADED.green, face = 'eyes') {
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
    // (the face: eyes as usual; none (off); or a cross (blocked), in the rim's own gradient: one colour)
    face === 'eyes' ? `  <g filter="url(#h)">${EYES.xs.map((ex) => `<polygon points="${shape(ex, EYES.cy, EYES.a, EYES.b, EYES.n)}" fill="url(#e)"/>`).join('')}</g>`
      : face === 'cross' ? `  <g filter="url(#h)" stroke="url(#r)" stroke-width="${CROSS.w * 2}" stroke-linecap="round"><line x1="${CROSS.from}" y1="${CROSS.from}" x2="${CROSS.to}" y2="${CROSS.to}"/><line x1="${CROSS.to}" y1="${CROSS.from}" x2="${CROSS.from}" y2="${CROSS.to}"/></g>`
      : face === 'link' ? `  <g filter="url(#h)" stroke="url(#r)" stroke-width="${LINK.w * 2}" stroke-linecap="round" fill="none">${[1, -1].map((m) => { const X = (v) => (m > 0 ? v : 128 - v); return `<path d="M${X(LINK.end)} ${LINK.cy - LINK.r} H${X(LINK.cx)} A${LINK.r} ${LINK.r} 0 0 ${m > 0 ? 0 : 1} ${X(LINK.cx)} ${LINK.cy + LINK.r} H${X(LINK.end)}"/><line x1="${X(LINK.stub[0])}" y1="${LINK.cy}" x2="${X(LINK.stub[1])}" y2="${LINK.cy}"/>`; }).join('')}</g>`
      : null,
    '</svg>',
    '',
  ].filter((l) => l !== null).join('\n');
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

// On a light toolbar: the same robot flipped, dark-grey frame and bars on a light face, so it reads there.
// (The robot's own marks are one colour; the face can differ for contrast.)
const PAUSED_LIGHT = { mark: [0x3a, 0x3a, 0x3e], face: [0xf4, 0xf4, 0xf5] };
function samplePausedLight(x, y) {
  const c = samplePaused(x, y);
  return c === null ? null : c === HEAD.face ? PAUSED_LIGHT.face : PAUSED_LIGHT.mark;
}
/** The paused robot for a light toolbar at `size` px, as PNG bytes. */
function renderPausedLight(size) { return render(size, undefined, samplePausedLight); }

/** On the broken link's strokes (LINK), either half (the right one the left mirrored). */
function inLink(x0, y) {
  const { cx, r, end, stub, w, cy } = LINK;
  const x = x0 > 64 ? 128 - x0 : x0;
  const d = Math.min(
    x <= cx ? Math.abs(Math.hypot(x - cx, y - cy) - r) : Infinity, // the C's round end
    toSegment(x, y, cx, cy - r, end, cy - r), toSegment(x, y, cx, cy + r, end, cy + r), // its top and bottom
    toSegment(x, y, stub[0], cy, stub[1], cy)); // the stub toward the gap
  return d <= w;
}

/** A face of FACES at `size` px, as PNG bytes (the toolbar icon's framing). */
function renderFace(face, size) { return render(size, undefined, faceSampler(face, size)); }

// The gate's shaded robots (sidepanel.js renderGate): off (no eyes) in the state's colour, blocked (a cross).
const GATE_SHADED = {
  'robot-shaded-off.svg': [SHADED.green, 'none'],
  'robot-shaded-off-yellow.svg': [SHADED.yellow, 'none'],
  'robot-shaded-off-red.svg': [SHADED.red, 'none'],
  'robot-shaded-blocked.svg': [SHADED.red, 'cross'],
  'robot-shaded-disconnected.svg': [SHADED.grey, 'link'],
};

/** The Mac app icon at `size` px, as PNG bytes (opaque, full bleed). */
function renderMac(size) { return render(size, 1, sampleMac); }

if (require.main === module) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of sizes) {
    const file = path.join(outDir, `robot-${size}.png`);
    fs.writeFileSync(file, render(size));
    console.log(file);
    const paused = path.join(outDir, `robot-paused-white-${size}.png`);
    fs.writeFileSync(paused, renderPaused(size));
    console.log(paused);
    const pausedLight = path.join(outDir, `robot-paused-light-${size}.png`);
    fs.writeFileSync(pausedLight, renderPausedLight(size));
    console.log(pausedLight);
    for (const face of Object.keys(FACES)) {
      const file2 = path.join(outDir, `robot-${face}-${size}.png`);
      fs.writeFileSync(file2, renderFace(face, size));
      console.log(file2);
    }
  }
  if (!process.argv[2]) {
    fs.writeFileSync(SVG_FILE, svg()); console.log(SVG_FILE);
    fs.writeFileSync(SHADED_FILE, shadedSvg()); console.log(SHADED_FILE);
    fs.writeFileSync(SHADED_RED_FILE, shadedSvg(SHADED.red)); console.log(SHADED_RED_FILE);
    for (const [name, [colours, face]] of Object.entries(GATE_SHADED)) {
      const file = path.join(path.dirname(SHADED_FILE), name);
      fs.writeFileSync(file, shadedSvg(colours, face)); console.log(file);
    }
  }
}

/** The plug idea for disconnected (not shipped: for the icon sheet), at `size` px. */
function renderPlug(size) { return render(size, undefined, faceSampler('plug', size)); }

module.exports = { render, renderPaused, renderPausedLight, PAUSED_LIGHT, renderFace, renderPlug, renderMac, shadedSvg, PAUSE, FACES, CROSS16, LINK16, PLUG16, GATE_SHADED, SHADED };

#!/usr/bin/env node
'use strict';
// Writes the iPhone app's icons, TrifProbe/Assets.xcassets/AppIcon.appiconset/: light (Any), dark and tinted, each
// 1024 px (one size is all iOS 17 and later need), approved by Tim 11-16.
//
// The robot is robot-shaded.svg's (scripts/render-icon.js shadedSvg), with its body outline replaced by iOS's own
// icon mask: iOS clips the square to its mask, which makes the rim's outer edge. The face (the dark area inside the
// rim) is Apple's same curve scaled down (Tim 11-16, option A: the mask moved inward made its inner corners too
// sharp): a continuous-corner square inset by the rim width, corner radius 0.26 x its own side. The rim is the
// whole square minus the face (even-odd), in the rim's gradient; the face is filled on top. So the rim is 100.4
// wide at the middle of each side and 120.5 on the diagonal.
//
// iOS's mask (measured): UIKit's continuous-corner rounded rect (PaintCode's reverse-engineered bezier, "Drawing
// Code for iOS 7 Rounded Rectangles"), corner radius 0.26 x side on iOS 26 (the 192 px home-screen icons of an iOS
// 26.3 simulator fit it to 0.17 px RMS); iOS 7-18 used the same curve at 0.225 x side.
//
// The three, as Apple asks: light RGB without alpha (iOS fills transparent parts black); dark with the face left
// transparent (iOS's own dark gradient shows through); tinted fully opaque grayscale (iOS maps luminance to the
// tint). Drawn as SVG, rendered by headless Chrome for Testing (tests/e2e/lib/chrome.js findChrome; muted, its own
// profile and process group, killed past 1.5 GB or 30 s). The PNGs are kept in the repository, so building doesn't
// need this; run it again when the robot changes:
//
//   node mobile/browser-probe/make-icon.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, execFileSync } = require('child_process');
const { findChrome } = require('../../tests/e2e/lib/chrome');

const RADIUS = 0.26; // iOS 26's corner (0.225 for iOS 7-18)
const dir = path.join(__dirname, 'TrifProbe', 'Assets.xcassets', 'AppIcon.appiconset');

const S = 1024;
// robot-shaded.svg's geometry (render-icon.js HEAD, EYES, shadedSvg), in its 128 space.
const HEAD = { c: 64, outer: 56, inner: 46 };
const MID = (HEAD.outer + HEAD.inner) / 2; // 51: the rim's centre line, the squircle robot-shaded.svg draws
const EYES = { cy: 63, xs: [45, 83], a: 12.35, b: 13.3, n: 2.3, blur: 1.5 };
// TRIF's squircle (its rim's centre line) goes onto iOS's outline: 51 units -> half the icon.
const K = (S / 2) / MID; // 10.039
const RIM = (HEAD.outer - HEAD.inner) * K; // 100.39: the rim's width at the middle of each side
const FACE_SIDE = S - 2 * RIM; // 823.22

const COLOURS = {
  light: { rim: ['#44e0a8', '#1e9a6c'], eye: ['#a7f3d0', '#2fc58d'], glow: [0.204, 0.827, 0.6], face: '#18181a' },
  // Dark: the same robot with the face left transparent, so iOS's own dark gradient shows through (Apple:
  // "Provide your dark app icon with a transparent background"). Our face is already that dark.
  dark: { rim: ['#44e0a8', '#1e9a6c'], eye: ['#a7f3d0', '#2fc58d'], glow: [0.204, 0.827, 0.6], face: 'none' },
  // Tinted: fully opaque grayscale; iOS maps luminance to the tint over its own dark tile, so black is "no paint"
  // (the face stays the tile's dark), white is full tint. Tim, 11-16: the light colour art itself, grayscaled
  // (Rec. 709 luminance of the rendered pixels, so it stays tied to the colours), with the face black; a version
  // brightened towards white was much too white on his phone.
  tinted: { rim: ['#44e0a8', '#1e9a6c'], eye: ['#a7f3d0', '#2fc58d'], glow: [0.204, 0.827, 0.6], face: '#000000' },
};

const f = (v) => +v.toFixed(2);

/** A continuous-corner rounded square (UIKit's curve: PaintCode's coefficients, top-right corner, in radii from the
 * corner: [dx from the right, dy from the top], rotated for the other three corners) at (x0, y0), side `size`,
 * corner radius `r` (capped where UIKit caps it), as SVG path data. continuous(0, 0, S, RADIUS * S) is iOS's mask;
 * the face is continuous(RIM, RIM, FACE_SIDE, RADIUS * FACE_SIDE) = (100.39, 100.39, 823.22, 214.04). */
function continuous(x0, y0, size, r) {
  const C = 1.52866483; // the curve starts this many radii from the corner
  const TR = [ // [cmd, ...points] after the start point (C, 0)
    ['L', [1.52866471, 0]],
    ['C', [1.08849323, 0], [0.86840689, 0], [0.66993427, 0.065496]],
    ['L', [0.63149399, 0.074911]],
    ['C', [0.37282392, 0.16905899], [0.16906013, 0.37282401], [0.07491176, 0.63149399]],
    ['C', [0, 0.86840701], [0, 1.08849299], [0, C]],
  ];
  r = Math.min(r, size / 2 / C);
  const pt = ([dx, dy], q) => { // top-right local -> absolute, then rotate q quarter turns clockwise about the centre
    let x = size - dx * r, y = dy * r;
    for (let i = 0; i < q; i++) [x, y] = [size - y, x];
    return `${f(x0 + x)} ${f(y0 + y)}`;
  };
  let d = `M${pt([0, C], 3)}`; // the top-left corner's end on the top edge
  for (let q = 0; q < 4; q++) for (const [cmd, ...ps] of TR) d += ` ${cmd}${ps.map((p) => pt(p, q)).join(' ')}`;
  return `${d} Z`;
}

/** A superellipse as polygon points, spaced evenly by angle (shadedSvg's eyes). */
function squircle(cx, cy, a, b, n, count = 720) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    const r = (Math.abs(c / a) ** n + Math.abs(s / b) ** n) ** (-1 / n);
    pts.push(`${f(cx + r * c)},${f(cy + r * s)}`);
  }
  return pts.join(' ');
}

function iconSvg(variant) {
  const { rim, eye, glow, face } = COLOURS[variant];
  const d = continuous(RIM, RIM, FACE_SIDE, RADIUS * FACE_SIDE);
  const X = (v) => S / 2 + (v - HEAD.c) * K;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
    `  <!-- TRIF iPhone app icon (${variant}), make-icon.js: iOS mask continuous corners r=${RADIUS}*side; face the same curve inset ${f(RIM)}, r=${RADIUS}*its side; eyes x${f(K)} -->`,
    '  <defs>',
    `    <linearGradient id="r" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${S}" y2="${S}"><stop offset="0" stop-color="${rim[0]}"/><stop offset="1" stop-color="${rim[1]}"/></linearGradient>`,
    `    <radialGradient id="e" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="${eye[0]}"/><stop offset="1" stop-color="${eye[1]}"/></radialGradient>`,
    `    <filter id="h" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="${f(EYES.blur * K)}" result="b"/><feColorMatrix in="b" type="matrix" values="${glow.map((c) => `0 0 0 0 ${c}`).join('  ')}  0 0 0 0.5 0" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    '  </defs>',
    // The rim: the whole square minus the face (iOS clips the square to its mask, which makes the rim's outer edge;
    // the square's corners are opaque so the light PNG has no alpha).
    `  <path fill-rule="evenodd" fill="url(#r)" d="M0 0 H${S} V${S} H0 Z ${d}"/>`,
    face === 'none' ? null : `  <path fill="${face}" d="${d}"/>`,
    `  <g filter="url(#h)">${EYES.xs.map((ex) => `<polygon points="${squircle(X(ex), X(EYES.cy), EYES.a * K, EYES.b * K, EYES.n)}" fill="url(#e)"/>`).join('')}</g>`,
    '</svg>',
    '',
  ].filter((l) => l !== null).join('\n');
}

/** One SVG (or HTML) file -> PNG, in headless Chrome under a 1.5 GB / 30 s watchdog on its own process group. */
function shoot(src, png, w = S, h = S, transparent = true) {
  const profile = fs.mkdtempSync(path.join(path.dirname(png), '.chrome-'));
  return new Promise((resolve, reject) => {
    const p = spawn(findChrome(), ['--headless=new', '--mute-audio', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--no-default-browser-check', `--user-data-dir=${profile}`, '--force-device-scale-factor=1', `--window-size=${w},${h}`,
      ...(transparent ? ['--default-background-color=00000000'] : []), `--screenshot=${png}`, `file://${src}`],
    { detached: true, stdio: 'ignore' });
    const started = Date.now();
    const dog = setInterval(() => {
      let kb = 0;
      try {
        for (const line of execFileSync('ps', ['-A', '-o', 'pgid=,rss=']).toString().split('\n')) {
          const [g, rss] = line.trim().split(/\s+/).map(Number);
          if (g === p.pid) kb += rss;
        }
      } catch { /* ps gone */ }
      if (kb > 1.5 * 1024 * 1024 || Date.now() - started > 30000) {
        try { process.kill(-p.pid, 'SIGKILL'); } catch { /* exited */ }
        reject(new Error(`chrome killed: ${Math.round(kb / 1024)} MB, ${Date.now() - started} ms`));
      }
    }, 200);
    p.on('exit', () => {
      clearInterval(dog);
      try { process.kill(-p.pid, 'SIGKILL'); } catch { /* group gone */ }
      fs.rmSync(profile, { recursive: true, force: true });
      fs.existsSync(png) ? resolve(png) : reject(new Error(`no screenshot for ${src}`));
    });
  });
}

// ---- PNG in and out (8-bit, not interlaced: what Chrome writes), no dependencies ----

/** A PNG -> { width, height, channels, pixels } (unfiltered rows, no filter bytes). */
function readPng(buf) {
  let width = 0, height = 0, type = 0;
  const idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit, not interlaced');
    }
    if (kind === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`PNG colour type ${type}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels, px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0, b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + x] = (row[x] + pred) & 0xff;
    }
  }
  return { width, height, channels, pixels: px };
}

/** { width, height, channels, pixels } -> a PNG (filter 0 rows). */
function writePng({ width, height, channels, pixels }) {
  const type = { 1: 0, 3: 2, 4: 6 }[channels], stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (kind, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(kind), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** RGB(A) -> RGB (alpha dropped: the light icon is opaque), RGBA (opaque where there was no alpha), or L
 * (Rec. 709 luminance: the tinted icon, the colour art grayscaled). */
function convert(img, to) {
  const n = img.width * img.height, c = img.channels, out = Buffer.alloc(n * to);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [img.pixels[i * c], img.pixels[i * c + 1], img.pixels[i * c + 2]];
    const a = c === 4 ? img.pixels[i * c + 3] : 255;
    if (to === 4) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a; } else if (to === 3) { out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b; } else out[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b); // (Rec. 709 luminance)
  }
  return { ...img, channels: to, pixels: out };
}

module.exports = { continuous, iconSvg, RADIUS, RIM, FACE_SIDE, readPng, writePng };

// The robot on the black cover and launch screen (Tim, 11-18: "like you're going from TRIF to your app";
// LeavingCover.swift, Info.plist UILaunchScreen): the desktop's shaded robot (extension/icons/robot-shaded.svg, its
// 128 box) at COVER_PT points, @2x and @3x, transparent around it, into Assets.xcassets/CoverRobot.imageset:
//
//   node mobile/browser-probe/make-icon.js --cover
const COVER_PT = 88; // (the 128 box; the robot itself is 102/128 of it, ~70 pt: a Home Screen icon is 60-64 pt)
async function writeCover() {
  const shaded = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'icons', 'robot-shaded.svg'), 'utf8');
  const out = path.join(__dirname, 'TrifProbe', 'Assets.xcassets', 'CoverRobot.imageset');
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-cover-'));
  const images = [];
  for (const scale of [2, 3]) {
    const px = COVER_PT * scale, name = `cover-robot@${scale}x.png`;
    const svg = path.join(tmp, `cover-${scale}.svg`), png = path.join(tmp, `cover-${scale}.png`);
    fs.writeFileSync(svg, shaded.replace('width="128" height="128"', `width="${px}" height="${px}"`));
    await shoot(svg, png, px, px);
    const img = readPng(fs.readFileSync(png));
    if (img.channels !== 4 || img.width !== px) throw new Error(`cover ${scale}x: unexpected screenshot (${img.width}, ${img.channels} channels)`);
    fs.writeFileSync(path.join(out, name), writePng(img));
    images.push({ filename: name, idiom: 'universal', scale: `${scale}x` });
    console.log('wrote', name);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(out, 'Contents.json'), `${JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2)}\n`);
}

if (require.main === module && process.argv.includes('--cover')) {
  writeCover().catch((e) => { console.error(e); process.exit(1); });
} else if (require.main === module) {
  (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-icon-'));
    fs.mkdirSync(dir, { recursive: true });
    const files = { light: ['icon-light-1024.png', 3], dark: ['icon-dark-1024.png', 4], tinted: ['icon-tinted-1024.png', 1] };
    for (const [v, [name, channels]] of Object.entries(files)) {
      const svg = path.join(tmp, `icon-${v}.svg`), png = path.join(tmp, `icon-${v}.png`);
      fs.writeFileSync(svg, iconSvg(v));
      await shoot(svg, png);
      const img = readPng(fs.readFileSync(png));
      if (img.channels < 3 || img.width !== S || img.height !== S) throw new Error(`${v}: unexpected screenshot (${img.width}x${img.height}, ${img.channels} channels)`);
      fs.writeFileSync(path.join(dir, name), writePng(convert(img, channels)));
      console.log('wrote', name);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const old of ['icon-1024.png']) fs.rmSync(path.join(dir, old), { force: true });
    fs.writeFileSync(path.join(dir, 'Contents.json'), `${JSON.stringify({
      images: [
        { filename: 'icon-light-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
        { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'icon-dark-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
        { appearances: [{ appearance: 'luminosity', value: 'tinted' }], filename: 'icon-tinted-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      ],
      info: { author: 'xcode', version: 1 },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, '..', 'Contents.json'), `${JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2)}\n`);
  })().catch((e) => { console.error(e); process.exit(1); });
}

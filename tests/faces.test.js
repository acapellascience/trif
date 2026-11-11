'use strict';
// The robot's faces (extension/faces.js, scripts/render-icon.js): which face when, the files they name, and
// the drawn pixels (on whole pixels at 16 px).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const R = require('../scripts/render-icon.js');

const ICONS = path.join(__dirname, '..', 'extension', 'icons');
const load = () => import('../extension/faces.js');

/** Pixels of one of render-icon's PNGs (one IDAT, filter 0 rows of RGBA). */
function pixels(png) {
  const size = png.readUInt32BE(16);
  const at = png.indexOf('IDAT');
  const raw = zlib.inflateSync(png.subarray(at + 4, at + 4 + png.readUInt32BE(at - 4)));
  return (x, y) => [...raw.subarray(y * (size * 4 + 1) + 1 + x * 4, y * (size * 4 + 1) + 1 + x * 4 + 4)];
}

test('the face by precedence: paused, blocked, off, logged out, normal', async () => {
  const { toolbarFace } = await load();
  assert.equal(toolbarFace({}), 'normal');
  assert.equal(toolbarFace({ state: 'on' }), 'normal');
  assert.equal(toolbarFace({ state: 'disconnected' }), 'normal', 'disconnected: as before');
  assert.equal(toolbarFace({ loggedOut: true }), 'login');
  assert.equal(toolbarFace({ state: 'off', loggedOut: true }), 'off');
  assert.equal(toolbarFace({ state: 'blocked', loggedOut: true }), 'blocked');
  assert.equal(toolbarFace({ state: 'off', locked: true, loggedOut: true }), 'paused');
});

test('every face\'s files exist, are render-icon.js\'s, and the normal one is the manifest\'s', async () => {
  const { facePaths, FACE_FILES } = await load();
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.action.default_icon, facePaths('normal'));
  for (const face of Object.keys(FACE_FILES)) for (const p of Object.values(facePaths(face))) assert.ok(fs.existsSync(path.join(__dirname, '..', 'extension', p)), p);
  for (const face of Object.keys(R.FACES)) {
    for (const size of [16, 32, 48, 128]) {
      assert.ok(fs.readFileSync(path.join(ICONS, `robot-${face}-${size}.png`)).equals(R.renderFace(face, size)), `run node scripts/render-icon.js (robot-${face}-${size}.png)`);
    }
  }
  for (const [name, [colours, face]] of Object.entries(R.GATE_SHADED)) {
    assert.equal(fs.readFileSync(path.join(ICONS, name), 'utf8'), R.shadedSvg(colours, face), `run node scripts/render-icon.js (${name})`);
  }
  // the panel names the gate's files that exist
  const panel = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.js'), 'utf8');
  assert.match(panel, /icons\/robot-shaded-\$\{state === 'blocked' \? 'blocked' : `off\$\{red \? '-red' : loggedOut \? '-yellow' : ''\}`\}\.svg/);
  for (const n of ['robot-shaded-blocked.svg', 'robot-shaded-off.svg', 'robot-shaded-off-red.svg', 'robot-shaded-off-yellow.svg']) assert.ok(R.GATE_SHADED[n], n);
});

test('16 px: the cross and the hollow eyes on whole pixels; off has no eyes', () => {
  const face = [0x18, 0x18, 0x1a, 255];
  // blocked: the cross's pattern, 6 x 6 from (5, 5), in its red; the face elsewhere in that square
  const px = pixels(R.renderFace('blocked', 16));
  const red = [...R.FACES.blocked.color, 255];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) assert.deepEqual(px(5 + c, 5 + r), R.CROSS16[r][c] === '#' ? red : face, `cross ${c},${r}`);
  assert.deepEqual(px(0, 8), [...R.FACES.blocked.rim, 255], 'the rim red');
  // logged out: each eye a 3 x 4 outline, its middle open
  const lp = pixels(R.renderFace('login', 16));
  const ring = [...R.FACES.login.color, 255];
  for (const c0 of [4, 9]) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) assert.deepEqual(lp(c0 + c, 6 + r), (c === 1 && (r === 1 || r === 2)) ? face : ring, `eye ${c0} ${c},${r}`);
  }
  // off: nothing on the face
  const op = pixels(R.renderFace('off', 16));
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) assert.deepEqual(op(x, y), face, `${x},${y}`);
});

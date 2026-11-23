'use strict';
// The screenshot a side-panel message carries ("what you're looking at now", extension/inview.js): the extension
// takes it as the person presses Send and hands it here (inview.shot, the panel's alone: host.js PANEL_COMMANDS);
// it goes in the site's screenshots folder, the one that site's runs read and write (runs.js screenshotsFolder:
// checked there, links in it removed), under a name of its own, made fresh (never through a link, never over a
// file). Pruned with the rest of that folder (runs.js pruneScreenshots).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { screenshotsFolder, withPrivatePaths } = require('./runs');

const SHOT_MAX = 8 * 1024 * 1024; // bytes of image
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** {file}: the picture saved for `scope`'s runs, as they name it. Throws for anything that isn't a JPEG or a PNG. */
function saveInViewShot(ws0, { scope, dataUrl } = {}) {
  if (typeof scope !== 'string' || !scope || scope.length > 300) throw new Error('missing scope');
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new Error('not a JPEG or PNG data URL');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > SHOT_MAX) throw new Error(`the picture is empty or over ${SHOT_MAX / 1024 / 1024} MB`);
  const kind = buf.subarray(0, 3).equals(JPEG) ? 'jpg' : buf.subarray(0, 4).equals(PNG) ? 'png' : null;
  if (!kind) throw new Error('not a JPEG or PNG');
  const ws = withPrivatePaths(ws0);
  const { dir, real } = screenshotsFolder(ws, scope);
  const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
  const name = `in-view-${stamp}-${crypto.randomBytes(3).toString('hex')}.${kind}`;
  fs.writeFileSync(path.join(real, name), buf, { flag: 'wx', mode: 0o600 });
  return { file: path.join(dir, name) };
}

module.exports = { saveInViewShot, SHOT_MAX };

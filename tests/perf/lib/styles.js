'use strict';
// Profile styles for tests/perf/stylers.js, and the profile pictures that carry them: the stand-in's avatars
// (lib/xpage.js, 400×400 JPEGs) redrawn by Style Encoder's own code (style-encoder.js's encode(), run in the
// test browser: squared to 400×400, the code stamped in the bottom-left corner, a PNG), served as
// pbs.twimg.com/profile_images/… by the suite's request interception. Made once per encoder version and kept
// in the work folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALL = ['bg', 'name', 'badge', 'handle', 'text', 'buttons', 'links', 'panel', 'icons', 'logo', 'cards', 'lines', 'quotes'];
const COLOURS = { bg: '#15202b', name: '#ffcc00', badge: '#00ff88', handle: '#ff66aa', text: '#e0e0ff', buttons: '#ff5500', links: '#00ccff',
  panel: '#202a40', icons: '#ffaa00', logo: '#ff0066', cards: '#1a2a3a', lines: '#4455aa', quotes: '#102030' };
/** The styles: no rainbow; a rainbow background; everything rainbow. */
const STYLES = {
  plain: { ...COLOURS, rainbow: [] },
  rbg: { ...COLOURS, rainbow: ['bg'] },
  allrb: { ...COLOURS, rainbow: [...ALL] },
};
// Which picture carries which (the rest carry none: a plain 400×400 PNG, as Style Encoder makes without a
// style). lib/xpage.js: HANDLES[i]'s picture is av((i + 1) % 16): ada_l av1, grace_h av2, mkbhd_fan av4,
// nasa_watch av5, chromium_dev av7, acapella_news av10; perf_me (you) is "me".
const PICTURES = { me: 'plain', av1: 'plain', av4: 'plain', av2: 'rbg', av7: 'rbg', av5: 'allrb', av10: 'allrb' };
const AVATARS = [...Array.from({ length: 17 }, (_, i) => `av${i}`), 'me'];
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/**
 * The stamped pictures, made with `encoderFile`'s own encode() in the browser `b` (on the stand-in at
 * https://x.com:port). → {dir, files: {key: path}, encoderSha1}
 */
async function stampPictures(b, port, workDir, encoderFile) {
  const code = fs.readFileSync(encoderFile, 'utf8');
  const tag = sha1(code + JSON.stringify(STYLES) + JSON.stringify(PICTURES)).slice(0, 10);
  const dir = path.join(workDir, `pbs-${tag}`);
  const files = Object.fromEntries(AVATARS.map((k) => [k, path.join(dir, `${k}.png`)]));
  if (Object.values(files).every((f) => fs.existsSync(f))) return { dir, files, encoderSha1: sha1(code) };
  // (Style Encoder's file as it is, with its encode() handed out: function declarations are hoisted, so this
  // is the same function its change listener calls)
  const anchor = 'async function encode(file, st) {';
  if (code.split(anchor).length !== 2) throw new Error(`style-encoder.js: "${anchor}" not found once`);
  const exposed = code.replace(anchor, `window.__perfEncode = encode; ${anchor}`);
  await b.send('Page.navigate', { url: `https://x.com:${port}/blank` });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); if (await b.eval('document.readyState === "complete"').catch(() => false)) break; }
  await b.eval(`window.trif = { log() {}, warn(...a) { console.warn(...a); } }; ${exposed}\n; typeof window.__perfEncode`);
  fs.mkdirSync(dir, { recursive: true });
  for (const k of AVATARS) {
    const st = PICTURES[k] ? STYLES[PICTURES[k]] : null;
    const src = k === 'me' ? '/img/av3.jpg' : `/img/${k}.jpg`;
    const b64 = await b.eval(`(async () => {
      const blob = await (await fetch(${JSON.stringify(src)})).blob();
      const out = await window.__perfEncode(new File([blob], 'pic.jpg', { type: 'image/jpeg' }), ${JSON.stringify(st)});
      if (out.type !== 'image/png') throw new Error('encode gave ' + out.type);
      const u8 = new Uint8Array(await out.arrayBuffer()); let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(s);
    })()`);
    fs.writeFileSync(files[k], Buffer.from(b64, 'base64'));
  }
  return { dir, files, encoderSha1: sha1(code) };
}

/** The style each picture's URL (any size: _normal, _200x200, _400x400) carries, as the stylers would read it. */
function styleForUrl(url) {
  const m = /\/profile_images\/\d+\/(av\d+|me)_\w+\.png$/.exec(url);
  const s = m && PICTURES[m[1]];
  return s ? STYLES[s] : null;
}

module.exports = { STYLES, PICTURES, AVATARS, stampPictures, styleForUrl };

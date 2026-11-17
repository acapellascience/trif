'use strict';
// Phone mods made before the phone view had a folder of its own (docs/MOBILE-EDIT.md "Phone mods, a sandbox of
// their own"): a mod in a desktop folder, sites/<site>/, whose header says `@device phone` (what the phone view's
// agent was told to add, 0.3.x's mobile-edit branch) moves to the site's phone twin, sites/phone~<site>/, where
// only the phone view runs it. Once per workspace (a marker in the private folder, so a `@device phone` written
// by hand later stays where it's put). A name already taken there gets "-2", "-3"… Nothing is overwritten.

const fs = require('fs');
const path = require('path');
const { listModFiles, parseHeader, ALL_SITES } = require('./mods');
const { isPhoneSite, PHONE_PREFIX } = require('./scope');

const MARKER = 'phone-mods-moved';

/** Moves them: {moved: [{from, to}], skipped: true when done before}. `privateDir`: where the marker goes. */
function movePhoneMods(modsDir, privateDir, { force = false } = {}) {
  const marker = path.join(privateDir, MARKER);
  if (!force && fs.existsSync(marker)) return { moved: [], skipped: true };
  const moved = [];
  for (const f of listModFiles(modsDir)) {
    if (f.site === ALL_SITES || isPhoneSite(f.site)) continue;
    let text;
    try { text = fs.readFileSync(f.file, 'utf8'); } catch { continue; }
    if (parseHeader(text).device !== 'phone') continue;
    const dir = path.join(modsDir, PHONE_PREFIX + f.site);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(f.file, '.js');
    let name = `${base}.js`;
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base}-${n}.js`;
    fs.renameSync(f.file, path.join(dir, name));
    moved.push({ from: `${f.site}/${base}`, to: `${PHONE_PREFIX}${f.site}/${name.slice(0, -3)}` });
  }
  try { fs.mkdirSync(privateDir, { recursive: true }); fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), moved }) + '\n'); } catch { /* again next time */ }
  return { moved };
}

module.exports = { movePhoneMods, MARKER };

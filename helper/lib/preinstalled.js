'use strict';
// Mods a new workspace starts with, copied from the examples by `webmods setup`, switched off until the
// user turns them on. $WEBMODS_HOME/preinstalled.json = {offered: [ids], startOff: [ids]}:
//  - offered: ids already offered, so one the user deleted doesn't come back with the next setup (and an
//    existing file, the user's own version, is never overwritten);
//  - startOff: ids setup actually copied. The helper sends those mods with `startOff: true`, and the
//    extension switches each one off the first time it sees it (after that, its switch is the user's).

const fs = require('fs');
const path = require('path');

const PREINSTALLED = [
  'x.com/plain-x',
  'www.instagram.com/following-only-feed',
  'www.instagram.com/hide-reposts',
  'www.instagram.com/hide-ai-content',
  'www.instagram.com/desaturate',
];

function file(home) { return path.join(home, 'preinstalled.json'); }

function load(home) {
  let v = {};
  try { v = JSON.parse(fs.readFileSync(file(home), 'utf8')); } catch { /* none yet */ }
  const list = (x) => (Array.isArray(x) ? x.filter((id) => typeof id === 'string') : []);
  return { offered: list(v && v.offered), startOff: list(v && v.startOff) };
}

/** Copy the PREINSTALLED mods not offered before into modsDir. Returns the ids copied. */
function preinstallMods(home, modsDir, examplesDir, ids = PREINSTALLED) {
  const state = load(home);
  const added = [];
  let changed = false;
  for (const id of ids) {
    if (state.offered.includes(id)) continue;
    const [site, mod] = id.split('/');
    const src = path.join(examplesDir, site, `${mod}.js`);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(modsDir, site, `${mod}.js`);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      added.push(id);
      state.startOff.push(id);
    }
    state.offered.push(id);
    changed = true;
  }
  if (changed) fs.writeFileSync(file(home), JSON.stringify(state, null, 2) + '\n');
  return added;
}

/** The ids the extension should switch off when it first sees them. */
function startOffIds(home) { return new Set(load(home).startOff); }

module.exports = { PREINSTALLED, preinstallMods, startOffIds, loadPreinstalled: load };

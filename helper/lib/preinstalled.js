'use strict';
// Mods a new workspace starts with, copied from the examples by `webmods setup`, each switched on or off
// as listed, and the sites WebMods starts on for. $WEBMODS_HOME/preinstalled.json =
// {offered: [ids], startOff: [ids], sitesOn: [sites]}:
//  - offered: ids already offered, so one the user deleted doesn't come back with the next setup (and an
//    existing file, the user's own version, is never overwritten);
//  - startOff: ids setup copied that start off. The helper sends those mods with `startOff: true`, and
//    the extension switches each one off the first time it sees it (after that, its switch is the user's);
//  - sitesOn: sites setup offered. The helper sends them with every mods message, and each browser turns
//    each one on the first time it sees it (after that, the site's switch is the user's).

const fs = require('fs');
const path = require('path');

// on: switched on from the start; the rest wait for the user to switch them on.
const PREINSTALLED = [
  { id: 'www.google.com/hide-ai-in-results', on: true },
  { id: 'www.google.com/hide-ai-mode', on: true },
  { id: 'www.google.com/hide-extra-sections', on: true },
  { id: 'www.google.com/hide-sponsored', on: true },
  { id: 'x.com/plain-x', on: true },
  { id: 'x.com/punk-fonts', on: false },
  { id: 'x.com/rainbow-rave', on: false },
  { id: 'amazon.com/simple-home', on: true },
  { id: 'amazon.com/simple-shopping', on: true },
  { id: 'www.instagram.com/desaturate', on: false },
  { id: 'www.instagram.com/following-only-feed', on: true },
  { id: 'www.instagram.com/hide-ai-content', on: true },
  { id: 'www.instagram.com/hide-reposts', on: true },
];

// WebMods is off on every site until the user turns it on there; it starts on for these, the sites the
// mods above are for.
const SITES_ON = ['google.com', 'x.com', 'amazon.com', 'instagram.com'];

function file(home) { return path.join(home, 'preinstalled.json'); }

function load(home) {
  let v = {};
  try { v = JSON.parse(fs.readFileSync(file(home), 'utf8')); } catch { /* none yet */ }
  const list = (x) => (Array.isArray(x) ? x.filter((id) => typeof id === 'string') : []);
  return { offered: list(v && v.offered), startOff: list(v && v.startOff), sitesOn: list(v && v.sitesOn) };
}

/**
 * Copy the PREINSTALLED mods not offered before into modsDir, and offer SITES_ON. Returns
 * {added: [ids copied], on: [those switched on], sites: [sites newly offered]}.
 */
function preinstallMods(home, modsDir, examplesDir, list = PREINSTALLED, sitesOn = SITES_ON) {
  const state = load(home);
  const added = [];
  const on = [];
  let changed = false;
  for (const { id, on: startOn } of list) {
    if (state.offered.includes(id)) continue;
    const [site, mod] = id.split('/');
    const src = path.join(examplesDir, site, `${mod}.js`);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(modsDir, site, `${mod}.js`);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      added.push(id);
      if (startOn) on.push(id); else state.startOff.push(id);
    }
    state.offered.push(id);
    changed = true;
  }
  const sites = sitesOn.filter((s) => !state.sitesOn.includes(s));
  if (sites.length) { state.sitesOn.push(...sites); changed = true; }
  if (changed) fs.writeFileSync(file(home), JSON.stringify(state, null, 2) + '\n');
  return { added, on, sites };
}

/** The ids the extension should switch off when it first sees them. */
function startOffIds(home) { return new Set(load(home).startOff); }

/** The sites each browser should turn WebMods on for when it first sees them. */
function startSitesOn(home) { return load(home).sitesOn; }

module.exports = { PREINSTALLED, SITES_ON, preinstallMods, startOffIds, startSitesOn, loadPreinstalled: load };

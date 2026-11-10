'use strict';
// Powers: the named exceptions a boxed mod can ask for (docs/POWERS.md). A boxed mod declares them in its
// header, `// @powers sound, read-drafts`; TRIF holds it until the user approves that set, and the sandbox
// (extension/sandbox.js) gives it those and nothing more. None of them sends anything.
//
// The approval is for the set, not the code: each power is allowed for the mod by its key (`power:<name>`,
// held.js allowed.json), so an update with the same powers runs without asking again, and one that adds a
// power waits for that one. `controls` and `mods` give nothing that reaches past the mod: they're listed on a
// hold, but don't make one on their own.

// The menu, in the order a hold lists them. `hold`: the fact a hold shows (after "it", like the classifier's
// facts: held.js, the panel, trif status); `site` in it is the mod's site. `built`: in this version.
const MENU = {
  'read-drafts': { hold: () => 'can read what you type on this site, but can\'t send it anywhere', built: true },
  keys: { hold: () => 'can see the keys you press (not in text fields), so it can have shortcuts', built: true },
  'site-data': { hold: (site) => `can see and filter what ${site} sends this page (posts, profiles), but can't send anything`, built: false },
  'page-data': { hold: (site) => `can read the data ${site} keeps behind what's on the page`, built: false },
  sound: { hold: () => 'can play sounds', built: true },
  controls: { hold: () => 'can add its own controls (sliders, pickers)', built: true, soft: true },
  mods: { hold: () => 'can talk to your other boxed mods on this page', built: false, soft: true },
  media: { hold: () => 'can play and pause video and audio on this page', built: false },
  'search-box': { hold: (site) => `adds a search box that searches ${site}`, built: false },
  'go-to': { hold: (site) => `can take you to these pages on ${site}`, built: false },
  click: { hold: () => 'can click these for you', built: false },
  'write-drafts': { hold: () => 'can change what you type and paste on this site before you post it', built: false },
};
const NAMES = Object.keys(MENU);

class PowersError extends Error {}

/**
 * The powers a header's `@powers` lines ask for: `values` are the lines' texts. Returns a sorted list of
 * names; throws a PowersError for a name not on the menu, or one not built yet.
 */
function parsePowers(values) {
  const out = new Set();
  for (const v of values || []) {
    for (const item of String(v).split(',')) {
      const name = item.trim().split(/\s+/)[0].toLowerCase();
      if (!name) continue;
      if (!MENU[name]) throw new PowersError(`"${name}" isn't a power (the powers: ${NAMES.join(', ')})`);
      if (!MENU[name].built) throw new PowersError(`the ${name} power isn't in this version of TRIF yet`);
      out.add(name);
    }
  }
  return NAMES.filter((n) => out.has(n));
}

// The site a hold names: the mod's folder (x.com), or its sites in general.
function siteOf(mod) {
  const s = String(mod.site || String(mod.id || '').split('/')[0] || '');
  return !s || s === 'all-sites' ? 'the sites it runs on' : s;
}

/** What a boxed mod's powers need allowing: [{key, fact, power, soft}] (held.js needsOf). */
function powerNeeds(mod) {
  const site = siteOf(mod);
  return (Array.isArray(mod.powers) ? mod.powers : []).filter((n) => MENU[n]).map((n) => ({
    key: `power:${n}`, fact: MENU[n].hold(site), power: n, soft: !!MENU[n].soft, lines: [],
  }));
}

/** Whether a need is a power that doesn't hold on its own (controls, mods). */
function isSoft(key) {
  const m = /^power:(.+)$/.exec(String(key));
  return !!(m && MENU[m[1]] && MENU[m[1]].soft);
}

module.exports = { MENU, NAMES, PowersError, parsePowers, powerNeeds, isSoft, siteOf };

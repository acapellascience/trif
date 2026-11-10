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
  'site-data': { hold: (site) => `can see and filter what ${site} sends this page (posts, profiles), but can't send anything`, built: true },
  'page-data': { hold: (site) => `can read the data ${site} keeps behind what's on the page`, built: true },
  sound: { hold: () => 'can play sounds', built: true },
  controls: { hold: () => 'can add its own controls (sliders, pickers)', built: true, soft: true },
  mods: { hold: () => 'can talk to your other boxed mods on this page', built: false, soft: true },
  media: { hold: () => 'can play and pause video and audio on this page', built: false },
  'search-box': { hold: (site, args) => `adds a search box that searches ${args && args[0] ? hostOf(args[0]) : site}`, built: true, args: 'one' },
  'go-to': { hold: (site) => `can take you to these pages on ${site}`, built: false },
  click: { hold: () => 'can click these for you', built: false },
  'write-drafts': { hold: () => 'can change what you type and paste on this site before you post it', built: false },
};
const NAMES = Object.keys(MENU);

class PowersError extends Error {}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
// (a host is the mod's site, or one of its subdomains, or a host its @match lines name)
function sameSite(host, mod) {
  const site = String((mod && mod.site) || '').toLowerCase();
  const h = String(host).toLowerCase();
  if (site && site !== 'all-sites' && (h === site || h.endsWith(`.${site}`))) return true;
  return ((mod && mod.matches) || []).some((p) => { const m = /^[^:]+:\/\/([^/]+)\//.exec(String(p)); if (!m) return false; const ph = m[1].toLowerCase(); return ph === h || (ph.startsWith('*.') && (h === ph.slice(2) || h.endsWith(ph.slice(1)))); });
}

/**
 * The powers a header's `@powers` lines ask for: `values` are the lines' texts ("sound, search-box
 * https://www.amazon.ca/s?k={query}"). Returns the names, in the menu's order, and what some take after
 * their name (`args`: name -> [values]); throws a PowersError for a name not on the menu, one not built yet,
 * or one whose values don't check out. `mod` ({site, matches}) is for the checks that need its site.
 */
function parsePowersWithArgs(values, mod = {}) {
  const out = new Set();
  const args = {};
  for (const v of values || []) {
    for (const item of String(v).split(',')) {
      const [first, ...rest] = item.trim().split(/\s+/);
      const name = (first || '').toLowerCase();
      if (!name) continue;
      if (!MENU[name]) throw new PowersError(`"${name}" isn't a power (the powers: ${NAMES.join(', ')})`);
      if (!MENU[name].built) throw new PowersError(`the ${name} power isn't in this version of TRIF yet`);
      if (name === 'search-box') {
        const t = rest[0];
        if (!t || rest.length > 1) throw new PowersError('search-box takes the site\'s search address, with {query} where the words go: @powers search-box https://www.example.com/search?q={query}');
        let u;
        try { u = new URL(t.replace('{query}', 'q')); } catch { throw new PowersError(`search-box: "${t}" isn't an address`); }
        if (!/^https?:$/.test(u.protocol) || !t.includes('{query}')) throw new PowersError(`search-box: "${t}" needs to be an http(s) address with {query} in it`);
        if (!sameSite(u.hostname, mod)) throw new PowersError(`search-box: ${u.hostname} isn't this mod's site: a search box searches the site it's on`);
        args[name] = [t];
      } else if (rest.length) throw new PowersError(`the ${name} power takes nothing after its name`);
      out.add(name);
    }
  }
  return { names: NAMES.filter((n) => out.has(n)), args };
}
function parsePowers(values, mod) { return parsePowersWithArgs(values, mod).names; }

// The site a hold names: the mod's folder (x.com), or its sites in general.
function siteOf(mod) {
  const s = String(mod.site || String(mod.id || '').split('/')[0] || '');
  return !s || s === 'all-sites' ? 'the sites it runs on' : s;
}

/**
 * What a boxed mod's powers need allowing: [{key, fact, power, soft}] (held.js needsOf). A power's values
 * are part of its key (a search box's address), so changing them asks again.
 */
function powerNeeds(mod) {
  const site = siteOf(mod);
  const args = (mod && mod.powerArgs) || {};
  return (Array.isArray(mod.powers) ? mod.powers : []).filter((n) => MENU[n]).map((n) => ({
    key: `power:${n}${args[n] && args[n].length ? `:${args[n].join(' ')}` : ''}`, fact: MENU[n].hold(site, args[n]), power: n, soft: !!MENU[n].soft, lines: [],
  }));
}

/** Whether a need is a power that doesn't hold on its own (controls, mods). */
function isSoft(key) {
  const m = /^power:(.+)$/.exec(String(key));
  return !!(m && MENU[m[1]] && MENU[m[1]].soft);
}

module.exports = { MENU, NAMES, PowersError, parsePowers, parsePowersWithArgs, powerNeeds, isSoft, siteOf, sameSite };

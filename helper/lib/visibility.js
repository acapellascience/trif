'use strict';
// "Chats on other sites can read this site's mods" (docs/STAGING.md "Other sites' mods"): the user's choice
// per site, in the side panel (extension/agentsites.js modsReadable). On by default; off by default for a
// sensitive site (TRIF's list, or the user's, each sensitive host a site of its own). A site whose choice is
// off is absent from every other site's run: not in its working folder (stage.js), not readable in the mods
// folder, history or trash (runs.js runLimits), and not in what `trif status` tells it (host.js
// statusForRun). Absent rather than refused, so that whatever the run uses to look (`trif mods`, Read, Grep,
// a shell, Codex's own tools) has nothing to find, and the system's sandbox has nothing to get right.
//
// The extension sends the user's choices and the sensitive list with each run (agent.start `visibility`):
//   hidden     sites the user set off      shown      sites the user set on
//   sensitive  the sensitive list's patterns (a host and its subdomains, or `*` in a label: `*bank*`)
// The rule is here. A run without it (an older extension) sees every site's mods, as before.

const { scopeOf, hostInScope, phoneBase } = require('./scope');

const SITE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const PATTERN = /^[a-z0-9*-]+(\.[a-z0-9*-]+)*$/;
const clean = (s) => String(s || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
const names = (v, ok) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').map(clean).filter(ok))].slice(0, 2000).sort();

/** What agent.start's `visibility` says, cleaned: {hidden, shown, sensitive} (lists), or null without one. */
function cleanVisibility(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return {
    hidden: names(v.hidden, (x) => SITE.test(x)),
    shown: names(v.shown, (x) => SITE.test(x)),
    sensitive: names(v.sensitive, (x) => PATTERN.test(x) && /[a-z0-9]/.test(x)),
  };
}

/** Whether a sensitive pattern matches `host`: as extension/agentsites.js patternMatches. */
function patternMatches(pattern, host) {
  const p = clean(pattern);
  const h = clean(host);
  if (!p || !h) return false;
  if (!p.includes('*')) return h === p || h.endsWith(`.${p}`);
  const labels = h.split('.');
  const pl = p.split('.');
  const re = (lab) => new RegExp(`^${lab.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\-]/g, '\\$&')).join('[a-z0-9-]*')}$`);
  if (pl.length === 1) return labels.some((l) => re(pl[0]).test(l)); // (`*bank*`: any label)
  if (labels.length < pl.length) return false;
  const tail = labels.slice(labels.length - pl.length);
  return pl.every((lab, i) => re(lab).test(tail[i]));
}

/** Whether chats on other sites may read `site`'s mods: the user's choice, else not for a sensitive site. */
function readableByOthers(site, vis) {
  if (!vis) return true;
  const s = clean(site);
  if (vis.hidden.includes(s)) return false;
  if (vis.shown.includes(s)) return true;
  return !vis.sensitive.some((p) => patternMatches(p, s));
}

/**
 * For a run (its scope, splits and visibility): name -> whether the folder (or site) `name` under sites/ is
 * kept from it. Never its own: its site's folders, a part of it, a phone twin of it (a phone view's run: the
 * desktop folder too), the sites it's part of (a run on mail.google.com: google.com, whose mods run there),
 * and all-sites/. Any other site's, by readableByOthers; its phone twin (phone~<site>) and its www. folder
 * go with it.
 */
function hiddenFrom({ scope, splits = [], visibility = null } = {}) {
  const vis = visibility && Array.isArray(visibility.hidden) ? visibility : cleanVisibility(visibility);
  if (!vis) return () => false;
  const runSite = clean(phoneBase(scope));
  const memo = new Map();
  return (name) => {
    const key = String(name || '');
    if (memo.has(key)) return memo.get(key);
    let hide = false;
    const base = clean(phoneBase(clean(key)));
    if (base && base !== 'all-sites' && SITE.test(base)) {
      const site = scopeOf(base, splits);
      hide = !(runSite && hostInScope(runSite, site)) && !readableByOthers(site, vis);
    }
    memo.set(key, hide);
    return hide;
  };
}

module.exports = { cleanVisibility, patternMatches, readableByOthers, hiddenFrom };

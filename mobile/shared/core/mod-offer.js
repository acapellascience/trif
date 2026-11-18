// A mod a chat hands over, before Add this mod?: which site it's read for (a mod with no @match of its own is that
// site's) and where it came from; and whether the coral "runs on another site / other sites / every site" box shows
// (docs/MOBILE-BEHAVIOUR.md, Mods and holds; Chat offers). The words stay each app's. Both phone apps run this
// (mobile/shared/gen/core.js: TrifCore.modOffer); mod-offer-cases.json holds the answers the iPhone's Swift gave.

'use strict';

const site = require('./site.js');

/**
 * Where a chat's mod is read and where it came from: the chat's site (a phone twin, phone~<site>, as its site), never
 * the page that happens to be shown (Tim, 11-18); the shown page's host only when the chat has no site.
 * @param {string} chatSite the chat's site ("" for none)
 * @param {string} shown the shown tab's host
 * @returns {{here: string, came: string}} here: the host or site the mod reader takes; came: its site
 */
function from(chatSite, shown) {
  let s = String(chatSite || '');
  if (s.startsWith('phone~')) s = s.slice('phone~'.length);
  const here = s || String(shown || '');
  return { here, came: site.of(here) };
}

/** Code point order (Swift's sorted(), for the sites a box names; hosts are punycode, so ASCII in practice). */
const byCodePoint = (a, b) => {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
};

/**
 * The coral box's decision for a mod offered from `cameFrom` (a site; null or "" for a file or a code: no box).
 * @param {string|null} cameFrom
 * @param {string} folder the mod's site (all-sites: every site)
 * @param {string[]} sites the sites its @match names
 * @returns {null | {every: true} | {others: string[], also: boolean}} others: the other sites, sorted, once each;
 *   also: it runs on the site it came from too
 */
function elsewhere(cameFrom, folder, sites) {
  if (!cameFrom) return null;
  const list = (sites || []).map(String);
  if (folder === 'all-sites' || list.includes('all-sites')) return { every: true };
  const of = list.map(site.of);
  const others = [...new Set(of.filter((s) => s && s !== cameFrom))].sort(byCodePoint);
  if (!others.length) return null;
  return { others, also: of.includes(cameFrom) };
}

module.exports = { from, elsewhere };

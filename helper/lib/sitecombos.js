'use strict';
// Site approval (docs/SAFE-MODS.md "Combinations", "Across mods: one approval per site"). Boxed mods on a page see
// each other's elements (and with `mods`, talk), so what one reads, another could act on: the sandbox refuses an act
// beside another mod's power that makes a warned pair with it (extension/pagewide.js, the page-wide rules), unless
// the user approved both powers for the site. Approval is per site, for the site's boxed mods together:
//
// - A site's boxed mods: those that run on it (its folder, a host their @match names, or everywhere) and are on in
//   some browser (switches.json, below). Their powers together (the union; @migrate as site-storage) are what the
//   site's mods can do together, shown as three lists (reach(): what they can see beyond the page, what they can
//   do as you, where what they see could go) and a flag line or two.
// - The site's approved union: allowed.json keys `site:<site>:<a>+<b>+…` (the whole union approved, under the mod
//   whose hold carried it; the site's is every such key's powers, whichever mod's entry, so switching a mod off or
//   deleting it never takes any away, and adding it again doesn't ask again).
// - A mod whose powers add a holding power to the site's approved union (a quiet one, sound, controls, mods,
//   preload, embeds or media, only when it completes a warned combination there), on a site with other boxed mods,
//   asks: its hold shows the site's lists, the items it adds
//   marked new; approving it approves the site's new union. Switched on, such a mod waits like a new one (held.js,
//   by 'switch'); switched off or deleted, nothing is asked.
// - Mods the user has, unchanged and not just switched on, whose site's union isn't approved (from before site
//   approvals): the newest asks in its review.
// - The helper sends each boxed mod its sites' approved unions (`siteOk`: "<site> <a>+<b>+…"); the sandbox lets an
//   act through beside another mod's power when both are in the site's approved union, and refuses it otherwise.

const fs = require('fs');
const path = require('path');
const combos = require('./combinations');
const { modSites } = require('./powers');

// The sandbox's page-wide rules, as data: extension/pagewide.js, the one definition the sandbox refuses by
// (the JSON between its markers).
const PAGE_WIDE = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'pagewide.js'), 'utf8');
  const m = /\/\* page-wide rules: JSON from here \*\/\s*export const PAGE_WIDE = (\{[\s\S]*?\});\s*\/\* page-wide rules: JSON to here \*\//.exec(src);
  if (!m) throw new Error('extension/pagewide.js: no page-wide rules between its markers');
  return JSON.parse(m[1]);
})();

/** A boxed mod's powers as the combinations count them (@migrate reads the site's storage: site-storage). */
function comboOf(mod) {
  if (!mod || !mod.sandboxed) return [];
  const list = Array.isArray(mod.powers) ? mod.powers : [];
  const migrate = !!(mod.powerArgs && Array.isArray(mod.powerArgs.migrate) && mod.powerArgs.migrate.length);
  return combos.POWERS.filter((p) => list.includes(p) || (migrate && p === 'site-storage'));
}

// (whether two mods can be on one site: a site they both name, one under the other, or one runs everywhere)
const everywhere = (m) => (String(m.id || '').split('/')[0] === 'all-sites' && !(m.matches || []).some((p) => /^[^:]+:\/\/[^*/]/.test(String(p))))
  || (m.matches || []).some((p) => /^[^:]+:\/\/\*\//.test(String(p)) || String(p) === '<all_urls>');
function sharesSite(a, b) {
  if (everywhere(a) || everywhere(b)) return true;
  const sa = modSites(a), sb = modSites(b);
  return sa.some((x) => sb.some((y) => x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)));
}
const siteMod = (site) => ({ id: `${site}/_`, matches: [`*://${site}/*`] });
const folderOf = (m) => String(m.site || String(m.id || '').split('/')[0] || '');

/**
 * The pairs the sandbox refuses mod a's acts on beside mod b: [[act, b's power]]. `a` and `b`: {powers (its
 * acts), combo (@migrate as site-storage)}. An act a has, beside a power in its actPartners that b has and a
 * doesn't; or in alsoRefused (a draft or a picture b changed, b's go-to bringing the user here), a power b has and
 * a didn't ask for; a channelOnly act only when both can talk over `mods`.
 */
function refusedPairs(a, b) {
  const out = [];
  for (const act of a.powers) {
    if (PAGE_WIDE.channelOnly.includes(act) && !(a.powers.includes('mods') && b.powers.includes('mods'))) continue;
    for (const p of PAGE_WIDE.actPartners[act] || []) if (!a.combo.includes(p) && b.combo.includes(p)) out.push([act, p]);
    for (const p of PAGE_WIDE.alsoRefused[act] || []) if (!a.powers.includes(p) && b.powers.includes(p)) out.push([act, p]);
  }
  return out;
}
const shapeOf = (m) => ({ powers: combos.POWERS.filter((p) => (Array.isArray(m.powers) ? m.powers : []).includes(p)), combo: comboOf(m) });

// ---- which boxed mods are on: each browser's helper writes what's off there (modsApplied), in
// $TRIF_HOME/switches.json: {"<browser>": {at, known: [ids], off: [ids]}}. A mod is off when every browser that
// knows it has it off (switched off, its group or TRIF off on its site, paused); one no browser knows is on.
const SWITCHES_DAYS = 14;
const switchesFile = (home) => path.join(home, 'switches.json');
function loadSwitches(home) {
  try { const v = JSON.parse(fs.readFileSync(switchesFile(home), 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
/** (id) => whether that mod is off in every browser that knows it. */
function offFn(home) {
  const all = Object.values(loadSwitches(home)).filter((v) => v && Array.isArray(v.known) && Array.isArray(v.off));
  return (id) => {
    const knows = all.filter((v) => v.known.includes(id));
    return knows.length > 0 && knows.every((v) => v.off.includes(id));
  };
}
// (mods switched on since: worked out like a changed mod, held.js, until nothing is asked of them)
const switchedFile = (home) => path.join(home, 'switched-on.json');
function loadSwitched(home) { try { const v = JSON.parse(fs.readFileSync(switchedFile(home), 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
function saveSwitchedOn(home, obj) {
  const f = switchedFile(home);
  if (!Object.keys(obj).length) { try { fs.unlinkSync(f); } catch { /* none */ } return; }
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, f);
}
/**
 * Records what's off in one browser (by its key). Returns {changed, switchedOn: [ids that were off everywhere
 * and are on now]}, which it also adds to switched-on.json.
 */
function saveSwitches(home, browser, known, off) {
  const wasOff = offFn(home);
  const all = loadSwitches(home);
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (!v || now - Number(v.at) > SWITCHES_DAYS * 86400000) delete all[k];
  const entry = { known: [...new Set(known)].sort(), off: [...new Set(off)].sort() };
  const was = all[browser];
  const same = was && JSON.stringify(was.known) === JSON.stringify(entry.known) && JSON.stringify(was.off) === JSON.stringify(entry.off);
  all[browser] = { at: now, ...entry };
  try {
    const tmp = `${switchesFile(home)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
    fs.renameSync(tmp, switchesFile(home));
  } catch { return { changed: false, switchedOn: [] }; }
  const isOff = offFn(home);
  const switchedOn = entry.known.filter((id) => wasOff(id) && !isOff(id));
  if (switchedOn.length) { const s = loadSwitched(home); for (const id of switchedOn) s[id] = now; try { saveSwitchedOn(home, s); } catch { /* next time */ } }
  return { changed: !same, switchedOn };
}

/** The sites a boxed mod is on, as folder names: its own, and those of the boxed mods it shares a site with. */
function sitesOf(mod, mods) {
  const out = new Set();
  if (folderOf(mod) && folderOf(mod) !== 'all-sites') out.add(folderOf(mod));
  for (const o of mods) if (o !== mod && o.sandboxed && folderOf(o) && folderOf(o) !== 'all-sites' && sharesSite(mod, o)) out.add(folderOf(o));
  return [...out].sort();
}
/** A site's boxed mods with powers, on (not off everywhere), but `except`. */
function siteMods(site, mods, isOff = () => false, except = null) {
  const s = siteMod(site);
  return mods.filter((o) => o !== except && o.id !== (except && except.id) && o.sandboxed && !o.rules && comboOf(o).length && !isOff(o.id) && (folderOf(o) === site || sharesSite(o, s)));
}
const unionOf = (list) => combos.POWERS.filter((p) => list.some((m) => comboOf(m).includes(p)));

const keyFor = (site, powers) => `site:${site}:${combos.POWERS.filter((p) => powers.includes(p)).join('+')}`;
/** {site, powers} from a site key, or null. */
function parseKey(key) {
  const m = /^site:(.+):([a-z+-]+)$/.exec(String(key));
  return m ? { site: m[1], powers: m[2].split('+') } : null;
}
/** The powers approved for a site's mods together (any mod's allowed.json entry), in the menu's order. */
function approvedUnion(allowed, site) {
  const out = new Set();
  for (const a of Object.values(allowed || {})) for (const k of (a && Array.isArray(a.powers) ? a.powers : [])) { const p = parseKey(k); if (p && p.site === site) for (const x of p.powers) out.add(x); }
  return combos.POWERS.filter((p) => out.has(p));
}

// The quiet powers (boxpowers.js MENU soft: sound, controls, mods, preload, embeds, media) never make a site ask on
// their own: one does when it completes a warned combination in the site's union (one it's in, which the site's
// approved union, without it, can't have)
const QUIET = new Set(Object.entries(require('./boxpowers').MENU).filter(([, v]) => v.soft).map(([k]) => k));
/** The powers in `adding` that make a site with `union` (after) ask. */
function holding(adding, union) {
  const warned = combos.warningsFor(union).map((w) => w.combo.split('+'));
  return adding.filter((p) => !QUIET.has(p) || warned.some((c) => c.includes(p)));
}

// ---- the site's lists: what its boxed mods can do together, by the powers in the union (words from the
// powers' own lines, extension/explain.json)
const SEE = [['read-drafts', 'what you type'], ['keys', 'the keys you press'], ['site-data', (s) => `what ${s} sends this page`], ['page-data', 'the data behind the page'],
  ['site-storage', (s) => `what ${s} keeps`], ['local-fonts', 'the fonts on this computer'], ['edit-uploads', 'pictures you attach']];
const ACT = [['click', null], ['write-drafts', 'write into your drafts'], ['page-events', 'signal the page\'s code'], ['go-to', 'take you to pages'],
  ['rewrite-requests', (s) => `change what ${s} receives`], ['block-events', 'keep some of what you do from the site']];
const GO = [['write-drafts', 'into posts and drafts'], ['edit-uploads', 'pictures you post'], ['site-storage', (s) => `${s}'s storage`], ['click', 'clicks the site sees'],
  ['page-events', 'the page\'s own code'], ['block-events', 'clicks the site sees'], ['image-variants', 'which pictures load'], ['preload', 'which pictures load'], ['embeds', 'which videos load'],
  ['media', 'how media plays'], ['sound', 'sound']];
const FLAGS = { sent: 'So something they read could end up sent from your account.', post: 'So they could post for you.' };
const HEADS = { see: 'What they can see beyond the page', act: 'What they can do as you', go: 'Where what they see could go', title: (s) => `Your ${s} mods together` };
function listsFor(site, union, clickWords) {
  const words = (table) => [...new Set(table.filter(([p]) => union.includes(p)).map(([p, w]) => (w === null ? `click ${clickWords.length ? clickWords.join(', ') : 'what their headers name'}` : typeof w === 'function' ? w(site) : w)))];
  const see = words(SEE), act = words(ACT), go = words(GO);
  const flags = [];
  if (see.length && go.length) flags.push(FLAGS.sent);
  if (union.includes('write-drafts') && (union.includes('click') || union.includes('page-events'))) flags.push(FLAGS.post);
  return { see, act, go, flags };
}
/**
 * The site's lists for a hold: {site, title, heads, see, act, go, flags}, each item {t, new}: new when the site's
 * approved union (`before`) didn't have it.
 */
function reach(site, before, after, clickWords = []) {
  const b = listsFor(site, before, clickWords), a = listsFor(site, after, clickWords);
  const mark = (k) => a[k].map((t) => ({ t, new: !b[k].includes(t) }));
  return { site, title: HEADS.title(site), heads: { see: HEADS.see, act: HEADS.act, go: HEADS.go }, see: mark('see'), act: mark('act'), go: mark('go'), flags: mark('flags') };
}
const clickWordsOf = (list) => [...new Set(list.flatMap((m) => ((m.powerArgs && m.powerArgs.click) || []).map((c) => String(c).split(':')[0].trim())))];

/**
 * What a mod's hold asks for its sites: [{key, fact, power: 'site', site, union, reach, soft, lines}], one per site
 * where its powers add a holding power to the site's approved union. `approvedToo`: one per site whatever it adds
 * (for "Looks right", which approves the site's union as it is).
 */
function siteNeeds(mod, mods, { allowed = {}, isOff = () => false, approvedToo = false } = {}) {
  const mine = comboOf(mod);
  if (!mine.length) return [];
  const out = [];
  for (const site of sitesOf(mod, mods)) {
    const others = siteMods(site, mods, isOff, mod);
    if (!others.length) continue; // (alone on its site: nothing across mods to approve; the next one asks for both)
    const on = [...others, mod];
    const before = approvedUnion(allowed, site);
    const after = combos.POWERS.filter((p) => before.includes(p) || unionOf(on).includes(p));
    if (!approvedToo && !holding(mine.filter((p) => !before.includes(p)), after).length) continue;
    out.push(siteNeed(site, before, after, clickWordsOf(on)));
  }
  return out;
}
const siteNeed = (site, before, after, clickWords) => ({ key: keyFor(site, after), fact: `adds to what your ${site} mods can do together`, power: 'site', site, union: after, reach: reach(site, before, after, clickWords), soft: false, lines: [] });

/** For the sandbox: the approved union of each site a mod is on, ["<site> <a>+<b>+…", …]. */
function siteOkFor(mod, mods, allowed = {}) {
  if (!comboOf(mod).length) return [];
  return sitesOf(mod, mods).map((site) => [site, approvedUnion(allowed, site)]).filter(([, u]) => u.length).map(([site, u]) => `${site} ${u.join('+')}`);
}

module.exports = {
  PAGE_WIDE, comboOf, sharesSite, refusedPairs, shapeOf, sitesOf, siteMods, unionOf, keyFor, parseKey, approvedUnion, holding, reach, listsFor, siteNeeds, siteNeed, siteOkFor, clickWordsOf, FLAGS, HEADS,
  loadSwitches, saveSwitches, offFn, switchesFile, loadSwitched, saveSwitchedOn, switchedFile,
};

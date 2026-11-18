// The All mods page's model (allmods.js draws it): every mod as one entry with what the page shows and filters
// on, the entries grouped by site, the search and the filters. Pure: no DOM, no chrome.*, so the tests run it in
// Node, and the phone's All mods list can use it as it is (it gets the same status from its app).
//
// - An entry's site is its folder's (sites/<site>/): all-sites is "Every site"; a phone twin's folder
//   (phone~x.com) puts it in the Phone mods section, under x.com, since phone mods only run in the phone view.
// - The order: Every site first, then the sites from A to Z; then the Phone mods section, the same way.
//   In a site, the mods by name.
// - Search: every word of it in the name, the description, the site or its name, or the code (the
//   background's mods.search gives the ids whose code has it).
// - Filters (all of them must hold): on or off, the tier (style, boxed, free), waiting for your OK, has errors,
//   on a site where TRIF is off (off, blocked or disconnected there).

import { modGroup, isPhoneMod, phoneBase, siteState } from './lib.js';
import { enabledIn } from './modswitch.js';

export const EVERY_SITE = 'all-sites';
/** The tiers as the filter names them (lib.js GROUPS: rules, sandboxed, page). */
export const TIER_OF_GROUP = { rules: 'style', sandboxed: 'boxed', page: 'free' };

const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));

/** The folder a mod is in (sites/<folder>/): its id's first part. */
export const folderOf = (m) => str(m?.id).split('/')[0];

/** The site an entry is listed under: its folder, a phone twin's without phone~ (all-sites for every site). */
export const siteOfMod = (m) => phoneBase(folderOf(m));

/**
 * The ids of the mods whose code has `text` in it, any case: a style mod's rules as written (`text`), any other's
 * code. For the background's mods.search, which has the code (the page's status doesn't carry it).
 */
export function modsMatching(mods, text) {
  const q = str(text).trim().toLowerCase().slice(0, 200);
  if (!q) return [];
  return (Array.isArray(mods) ? mods : []).filter((m) => m && str(m.rules ? m.text : m.code).toLowerCase().includes(q)).map((m) => str(m.id));
}

/**
 * Each mod as the page shows it: [{id, name, description, folder, site, phone, every, tier, on, offOn, held,
 * pending, waiting, errors, quiet, clickjack, updated, update, isNew, changedAt, mod}].
 * `disabled`, `offSites`: chrome.storage.local's (the switches); a held mod isn't on, whatever its switch says:
 * it isn't running.
 */
export function entriesOf(mods, { disabled = {}, offSites = {} } = {}) {
  return (Array.isArray(mods) ? mods : []).filter((m) => m && typeof m.id === 'string' && m.id.includes('/')).map((m) => {
    const folder = folderOf(m);
    const site = siteOfMod(m);
    const broken = Array.isArray(m.broken) ? m.broken : [];
    const loud = broken.filter((b) => !b.quiet);
    const switchOn = enabledIn(disabled, m.id);
    return {
      id: m.id,
      name: str(m.name) || m.id,
      description: str(m.description),
      folder,
      site,
      phone: isPhoneMod(m),
      every: site === EVERY_SITE,
      tier: TIER_OF_GROUP[modGroup(m)],
      switchOn,
      on: switchOn && !m.held,
      offOn: Array.isArray(offSites?.[m.id]) ? offSites[m.id] : [],
      held: !!m.held,
      pending: !m.held && !!m.pending,
      waiting: !!(m.held || m.pending),
      errors: loud.length,
      quiet: !loud.length && broken.length > 0,
      clickjack: loud.length > 0 && loud.every((b) => b.clickjack),
      updated: m.newOff === 'update' && !switchOn,
      update: !!m.update,
      isNew: !!m.newOff && m.newOff !== 'update' && !switchOn,
      changedAt: Number.isFinite(m.changedAt) && m.changedAt > 0 ? m.changedAt : null,
      mod: m,
    };
  });
}

/**
 * The state of TRIF on an entry's site: 'on', 'off', 'blocked' or 'disconnected' (lib.js siteState), or null for
 * every site. `status`: the background's (sitesOn, access, blockedSites); `scopeOf`: a sensitive host's own site
 * (lib.js sensitiveSites().scopeOf), the registrable domain otherwise.
 */
export function siteStateOf(site, status, scopeOf = (s) => s) {
  if (!site || site === EVERY_SITE) return null;
  const scope = scopeOf(site) || site;
  return siteState(scope, { sitesOn: status?.sitesOn || [], access: status?.access || { all: true, origins: [] }, blocked: status?.blockedSites || [] });
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
const bySite = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * The entries in sections and groups: [{key: 'desktop'|'phone', groups: [{key, site, every, phone, state,
 * entries}]}], the phone section only when there are phone mods. Every site first, then the sites from A to Z,
 * each group's mods by name. `stateOf(site)`: siteStateOf for it.
 */
export function groupEntries(entries, { stateOf = () => null } = {}) {
  const sections = [];
  for (const phone of [false, true]) {
    const mine = entries.filter((e) => e.phone === phone);
    if (!mine.length && phone) continue;
    const bySiteName = new Map();
    for (const e of mine) {
      if (!bySiteName.has(e.site)) bySiteName.set(e.site, []);
      bySiteName.get(e.site).push(e);
    }
    const sites = [...bySiteName.keys()].sort((a, b) => (a === EVERY_SITE ? -1 : b === EVERY_SITE ? 1 : bySite(a, b)));
    sections.push({
      key: phone ? 'phone' : 'desktop',
      groups: sites.map((site) => ({
        key: `${phone ? 'phone~' : ''}${site}`, site, every: site === EVERY_SITE, phone, state: stateOf(site), entries: bySiteName.get(site).sort(byName),
      })),
    });
  }
  return sections;
}

/** The search's words, lower case: "dark  x.com" → ["dark", "x.com"]. */
export const searchWords = (q) => str(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);

/**
 * Whether an entry matches the search: every word in its name, description, site, the site's name
 * (`siteName(site)`, "X" for x.com) or its id, or the whole search in its code (`codeIds`: the background's
 * mods.search answer for it).
 */
export function matchesSearch(e, query, { siteName = () => '', codeIds = null } = {}) {
  const words = searchWords(query);
  if (!words.length) return true;
  if (codeIds && codeIds.has(e.id)) return true;
  const hay = `${e.name}\n${e.description}\n${e.site}\n${siteName(e.site) || ''}\n${e.id}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The filters with nothing picked. */
export const NO_FILTERS = Object.freeze({ state: 'all', tier: 'all', waiting: false, errors: false, siteOff: false });

/** `f` cleaned up: anything unknown back to NO_FILTERS's. */
export function normalizeFilters(f) {
  const x = f && typeof f === 'object' ? f : {};
  return {
    state: ['on', 'off'].includes(x.state) ? x.state : 'all',
    tier: ['style', 'boxed', 'free'].includes(x.tier) ? x.tier : 'all',
    waiting: x.waiting === true,
    errors: x.errors === true,
    siteOff: x.siteOff === true,
  };
}

/** How many filters are picked (for "Clear filters"). */
export const filterCount = (f) => { const n = normalizeFilters(f); return (n.state !== 'all') + (n.tier !== 'all') + n.waiting + n.errors + n.siteOff; };

/**
 * Whether an entry passes the filters. `state`: its site's TRIF state (siteStateOf), for siteOff; a mod for
 * every site is never on "a site where TRIF is off".
 */
export function passesFilters(e, filters, state = null) {
  const f = normalizeFilters(filters);
  if (f.state === 'on' && !e.on) return false;
  if (f.state === 'off' && e.on) return false;
  if (f.tier !== 'all' && e.tier !== f.tier) return false;
  if (f.waiting && !e.waiting) return false;
  if (f.errors && !(e.errors || e.quiet)) return false;
  if (f.siteOff && (state === null || state === 'on')) return false;
  return true;
}

/**
 * The sections with only what the search and filters let through (groups with nothing left go), and the counts:
 * {sections, shown, total}.
 */
export function visibleSections(sections, { query = '', filters = NO_FILTERS, siteName, codeIds } = {}) {
  let shown = 0, total = 0;
  const out = [];
  for (const s of sections) {
    const groups = [];
    for (const g of s.groups) {
      total += g.entries.length;
      const entries = g.entries.filter((e) => passesFilters(e, filters, g.state) && matchesSearch(e, query, { siteName, codeIds }));
      shown += entries.length;
      if (entries.length) groups.push({ ...g, entries });
    }
    if (groups.length) out.push({ ...s, groups });
  }
  return { sections: out, shown, total };
}

/** How many of each filter's mods there are (the filter buttons' counts): {on, off, style, boxed, free, waiting, errors, siteOff}. */
export function filterCounts(sections) {
  const c = { on: 0, off: 0, style: 0, boxed: 0, free: 0, waiting: 0, errors: 0, siteOff: 0 };
  for (const s of sections) {
    for (const g of s.groups) {
      for (const e of g.entries) {
        c[e.on ? 'on' : 'off']++;
        c[e.tier]++;
        if (e.waiting) c.waiting++;
        if (e.errors || e.quiet) c.errors++;
        if (g.state !== null && g.state !== 'on') c.siteOff++;
      }
    }
  }
  return c;
}

/**
 * An entry's status tags, most urgent first: [{key, text}]. Waiting for your OK (or a change waiting), errors
 * (or "stopped a click", or "may be broken"), updated from Tim's mods (switched off until you look) or an
 * update available, new. The words are the side panel's.
 */
export function statusTags(e) {
  const out = [];
  if (e.held) out.push({ key: 'waiting', text: 'waiting for your OK' });
  else if (e.pending) out.push({ key: 'waiting', text: 'change waiting for your OK' });
  if (e.clickjack) out.push({ key: 'errors', text: 'stopped a click' });
  else if (e.errors) out.push({ key: 'errors', text: e.errors > 1 ? `${e.errors} errors` : 'error' });
  else if (e.quiet) out.push({ key: 'errors', text: 'may be broken' });
  if (e.updated) out.push({ key: 'updated', text: 'updated' });
  else if (e.update) out.push({ key: 'update', text: 'update available' });
  if (e.isNew) out.push({ key: 'new', text: 'new' });
  return out;
}

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/**
 * When a mod last changed, in words: "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the
 * date ("12 Oct", "12 Oct 2025" in another year). '' when it isn't known.
 */
export function changedWords(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return '';
  const d = Math.max(0, now - at);
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  if (d < 2 * DAY) return 'yesterday';
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} days ago`;
  const date = new Date(at), today = new Date(now);
  const month = date.toLocaleString('en-GB', { month: 'short' });
  return date.getFullYear() === today.getFullYear() ? `${date.getDate()} ${month}` : `${date.getDate()} ${month} ${date.getFullYear()}`;
}

/** The address to open for a site: https, or http for localhost and IP addresses (all-sites has none: null). */
export function siteUrl(site) {
  const s = str(site);
  if (!s || s === EVERY_SITE) return null;
  return /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/.test(s) ? `http://${s}/` : `https://${s}/`;
}

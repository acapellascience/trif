// The mod store's rules (Tim, 11-18: Android had ported them to Kotlin by hand; both phones now run this). Part 1, holds
// and Allow: what a mod waits for, what Allow allows, what a change asks about beyond its code's needs, what the version
// before counts as already allowed, and whether the version before keeps running while a change waits. Part 2, changes:
// what an add keeps of the version before and how its switch starts, History's 30 days and 30 versions, Recently
// deleted's 30 days and 200 entries, Undo (of an add, of a delete), putting one back, Don't allow's and a restore's
// carry-over. Part 3, what runs: a mod's switch (the whole mod's, or a mod for several sites: its switch on each), the
// tiers switched off on a site, Pause all, and which mods run on a page (match.js: @match / @exclude).
// docs/MOBILE-BEHAVIOUR.md, Mods and holds. Both phone apps run this (mobile/shared/gen/core.js: TrifCore.modStore);
// mod-store-cases.json holds the iPhone's answers. Desktop's own rules: helper/lib/held.js.
//
// A mod here is a plain record of what the rules read: {tier, site, matches, needs, extraNeeds, allowed, ran}, where a
// need is {key, fact, power?, lines?}, allowed is {need key: [line hashes]} (allowed.json's shape), and ran is whether
// a version before is kept running while a change waits (a change on hold). What runs also reads {on, sites, offSites,
// excludes}: on, its switch; sites, the hosts its @match names (its site all-sites: every site); offSites, the sites it's
// switched off on. groupsOff is {site: [tier]}, the tiers switched off on each site.

'use strict';

const site = require('./site.js');
const match = require('./match.js');

const list = (a) => (Array.isArray(a) ? a : []);

/**
 * The needs not yet allowed: a need whose key isn't allowed, or one of whose lines isn't. What a hold waits for.
 * @param {{needs?: object[], extraNeeds?: object[], allowed?: object}} m
 */
function waiting(m) {
  const allowed = (m && m.allowed) || {};
  return [...list(m && m.needs), ...list(m && m.extraNeeds)].filter((n) => {
    const ok = Object.prototype.hasOwnProperty.call(allowed, n.key) ? list(allowed[n.key]) : null;
    if (!ok) return true;
    return list(n.lines).some((l) => !ok.includes(l));
  });
}

/** Held: something waits for the user's OK (it never runs; a change on hold: the version before runs). */
function held(m) {
  return waiting(m).length > 0;
}

/**
 * Allowed plus these needs: each need's key, with its lines added (no repeats, sorted).
 * @param {object[]} needs
 * @param {object} allowed
 */
function allow(needs, allowed) {
  const out = { ...(allowed || {}) };
  for (const n of list(needs)) out[n.key] = [...new Set([...list(out[n.key]), ...list(n.lines)])].sort();
  return out;
}

/** Allow: what the mod waits for is allowed for it (a later version that needs nothing more runs without asking). */
function approve(m) {
  return allow(waiting(m), (m && m.allowed) || {});
}

/**
 * What a change asks about beyond its code's needs, judged against the version before (as held.js judges one): becoming
 * a free mod; and each @match for another site, when the mod can do something there (it has needs: a style mod or a
 * boxed mod without powers can't act, wherever it runs) and the version before wasn't for every site.
 * @param {{tier: string, needs?: object[], matches?: string[]}} m the change
 * @param {{tier: string, site: string}} old the version before
 */
function changeNeeds(m, old) {
  const out = [];
  if (m.tier === 'free' && old.tier !== 'free') out.push({ key: 'tier:free', fact: 'is now a free mod, so it can do anything the page can do' });
  if (list(m.needs).length && old.site !== 'all-sites') {
    const home = site.of(old.site);
    for (const p of list(m.matches)) {
      const at = p.indexOf('://');
      const rest = at < 0 ? '' : p.slice(at + 3);
      const host = p === '<all_urls>' ? '*' : (rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest);
      const h = host.split('*.').join('');
      if (host !== '*' && site.hostIsIn(h, home)) continue;
      out.push({ key: `match:${p}`, fact: `runs on ${p}, outside ${home}` });
    }
  }
  return out;
}

/**
 * What the user had allowed, plus what the version that ran already did (its @match sites, being a free mod, what a
 * change before asked about), so a change is asked about only for what it adds. A held version: only what was allowed.
 * @param {{tier: string, matches?: string[], extraNeeds?: object[], allowed?: object, needs?: object[]}} old
 */
function seeded(old) {
  if (held(old)) return { ...(old.allowed || {}) };
  const keys = list(old.matches).map((p) => ({ key: `match:${p}`, fact: '' }));
  if (old.tier === 'free') keys.push({ key: 'tier:free', fact: '' });
  return allow([...keys, ...list(old.extraNeeds)], old.allowed || {});
}

/**
 * Which version runs while a change waits for an OK: 'ran' (the one the version before was already keeping), 'current'
 * (the version before itself), or null (none kept: the change runs, or nothing does). how: 'add' (a new version: chat,
 * import, an edit, the computer) or 'restore' (a kept version restored, which keeps one only if the version before
 * wasn't held).
 * @param {boolean} changeHeld whether the change waits for an OK
 * @param {object} old the version before (its hold record)
 * @param {'add'|'restore'} how
 */
function ranAfter(changeHeld, old, how) {
  if (!changeHeld) return null;
  const oldHeld = held(old);
  if (how === 'restore') return oldHeld ? null : 'current';
  if (oldHeld && !old.ran) return null;
  return old.ran ? 'ran' : 'current';
}

// --- Part 2: changes. Pure: the time comes in (`now`, ms since 1970) and the answers say what to do with the
// platform's own records. A history entry and a Recently deleted entry are {at (ms), …}; History and Recently deleted
// come back as indices into the list given (-1: the new entry, put first), so the code itself never crosses over.

const DAY = 86400000;
/** History keeps versions this long, and at most this many (Recently deleted: its days and its entries). */
const HISTORY_DAYS = 30;
const HISTORY_MAX = 30;
const TRASH_DAYS = 30;
const TRASH_MAX = 200;

/** A version kept in History at `now`: its stamp (ms, as text: desktop's history ids), when, what replaced it. */
function version(now, source) {
  return { stamp: String(Math.trunc(now)), at: now, source };
}

/** Which entries stay (indices; -1 the new one, first): younger than `days`, at most `max`. */
function recent(entries, now, days, max, withNew) {
  const l = list(entries);
  const all = withNew ? [-1, ...l.map((_, i) => i)] : l.map((_, i) => i);
  return all.filter((i) => (i < 0 ? now : l[i].at) > now - days * DAY).slice(0, max);
}

/**
 * Adding a mod, or a new version of one (old: the version with its id, or null). source: chat, import, link, pasted,
 * edit or computer (a phone sync), the one from the chat or a link on; changed: whether the code differs (the platform
 * compares the texts). New: an import starts off, marked import; one from the computer too, marked computer. A new
 * version keeps what the user allowed, its per-site switches and when it was added (`keep`: taken from the version
 * before); the version before goes into History (as import, edit or computer, else chat); an import starts off, marked
 * update; an edit or the computer keeps the switch and its mark; anything else is on, unmarked. `ran`: which version
 * runs while it waits (ranAfter).
 * @param {object|null} old {…hold record, on, newOff, history: [{at}]}
 * @param {object} m the new version: {…hold record, on, newOff}
 * @returns {{source, on, newOff, keep?, history?, version?, ran?}}
 */
function add(old, m, source, now, changed) {
  if (!old) {
    if (source === 'import') return { source, on: false, newOff: 'import' };
    if (source === 'computer') return { source, on: false, newOff: 'computer' };
    return { source, on: m.on !== false, newOff: m.newOff == null ? null : m.newOff };
  }
  const out = { source, keep: ['allowed', 'offSites', 'added'] };
  out.version = changed ? version(now, ['import', 'edit', 'computer'].includes(source) ? source : 'chat') : null;
  out.history = recent(old.history, now, HISTORY_DAYS, HISTORY_MAX, changed);
  if (source === 'import') Object.assign(out, { on: false, newOff: 'update' });
  else if (source === 'edit' || source === 'computer') Object.assign(out, { on: old.on !== false, newOff: old.newOff == null ? null : old.newOff });
  else Object.assign(out, { on: true, newOff: null });
  out.ran = ranAfter(held({ ...m, allowed: old.allowed || {} }), old, 'add');
  return out;
}

/**
 * A quick ask's Undo: the mod as it was before it was added, or gone if it was new; not to Recently deleted.
 * @param {string[]} ids the mods' ids, in order
 * @returns {number[]} the list after: indices into ids, -1 the version before
 */
function undoAdd(ids, id, hasBefore) {
  const l = list(ids);
  const all = l.map((_, i) => i);
  if (!hasBefore) return all.filter((i) => l[i] !== id);
  const at = l.indexOf(id);
  return at < 0 ? [...all, -1] : all.map((i) => (i === at ? -1 : i));
}

/**
 * Deleting a mod: to Recently deleted (first; 30 days, 200 entries). by: you (the Mods tab, which offers Undo) or
 * computer (a sync). keep: the entries of Recently deleted that stay, after the new one.
 * @param {{at: number}[]} trash
 */
function remove(trash, by, now) {
  return { undo: by === 'you', keep: recent(trash, now, TRASH_DAYS, TRASH_MAX, true).slice(1) };
}

/**
 * Undo of a delete: the last mod deleted is back (unless one with its id is here), out of Recently deleted. null:
 * nothing to undo. drop: the Recently deleted entry to take out (-1: none).
 * @param {string|null} last the last deleted mod's id
 * @param {string[]} ids the mods' ids
 * @param {string[]} trash Recently deleted's mod ids
 */
function undoDelete(last, ids, trash) {
  if (last == null) return null;
  return { append: !list(ids).includes(last), drop: list(trash).indexOf(last) };
}

/**
 * Putting a mod from Recently deleted back. null: no such entry, or a mod with its id is here now. index: the entry;
 * clearLast: the last deleted mod is here again (Undo has nothing left to do).
 * @param {string} entry its id
 * @param {{id: string, modId: string}[]} trash
 * @param {string[]} ids the mods' ids
 * @param {string|null} last the last deleted mod's id
 */
function restoreDeleted(entry, trash, ids, last) {
  const t = list(trash);
  const index = t.findIndex((e) => e.id === entry);
  if (index < 0 || list(ids).includes(t[index].modId)) return null;
  return { index, clearLast: last != null && (list(ids).includes(last) || last === t[index].modId) };
}

/**
 * Don't allow a change on hold: the version that ran is back (read again by the platform), taking the change's switch,
 * per-site switches, what was allowed, how it came and when it was added; it asks nothing beyond its code; the change
 * goes into History (undo), nothing dropped. null: nothing ran before (a new mod): it's deleted.
 * @param {{ran: boolean, history: object[]}} cur
 */
function reject(cur, now) {
  if (!cur || !cur.ran) return null;
  return { keep: ['on', 'offSites', 'allowed', 'source', 'added'], extraNeeds: [], version: version(now, 'undo'), history: [-1, ...list(cur.history).map((_, i) => i)] };
}

/**
 * Restoring a kept version (read again by the platform): it takes the current one's switch, per-site switches, how it
 * came, when it was added and its mark; the current one goes into History as `source` (restore, or undo), nothing
 * dropped. What it's allowed and asks come from seeded, changeNeeds and ranAfter.
 * @param {{history: object[]}} cur
 */
function restore(cur, source, now) {
  return { keep: ['on', 'offSites', 'source', 'added', 'newOff'], version: version(now, source), history: [-1, ...list(cur && cur.history).map((_, i) => i)] };
}

// ---- Part 3: what runs

const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** A mod for several sites (or every site) has a switch per site (desktop's isMultiSite). */
const multiSite = (m) => m.site === 'all-sites' || new Set(list(m.sites).map(site.of)).size > 1;

/** Whether a mod is switched on; for a site (not null or ''), a mod for several sites: its switch there. */
function isOn(m, s) {
  if (!m.on) return false;
  if (s == null || s === '') return true;
  return !(multiSite(m) && list(m.offSites).includes(s));
}

/** whether a tier is switched off on a site */
const tierOff = (groupsOff, tier, s) => has(groupsOff, s) && list(groupsOff[s]).includes(tier);

/**
 * The mods that run on a page: none while paused; else each switched on (on the page's site too), not held unless a
 * version before is kept running, its tier not off on the page's site, and its @match covering the address (no
 * @exclude). The page's site: site.of(the host).
 * @param {object[]} mods
 * @param {{paused?: boolean, groupsOff?: object, url: {scheme: string, host: string, path: string} | null}} at
 * @returns {[number, boolean][]} each one's index, and whether the version kept runs (a change waits)
 */
function running(mods, at) {
  if (at.paused) return [];
  const u = at.url || null;
  const s = site.of(u ? u.host : '');
  const out = [];
  list(mods).forEach((m, i) => {
    const h = held(m);
    if (!m.on || (h && !m.ran) || tierOff(at.groupsOff, m.tier, s) || (multiSite(m) && list(m.offSites).includes(s))) return;
    if (!match.applies(m.matches, m.excludes, u)) return;
    out.push([i, h && !!m.ran]);
  });
  return out;
}

/** The sites a mod's script checks it's off on: its own switch's (a mod for several sites), and its tier's. Sorted. */
function off(m, groupsOff) {
  const out = new Set(multiSite(m) ? list(m.offSites) : []);
  for (const s of Object.keys(groupsOff || {})) if (list(groupsOff[s]).includes(m.tier)) out.add(s);
  return [...out].sort();
}

/**
 * A mod's switch. On a site (not null or ''), a mod for several sites: that site's switch (switched on there, the mod
 * is on); else the whole mod's. Switching on clears its "new, off" mark.
 * @returns {{on: boolean, offSites: string[], clearNewOff: boolean}}
 */
function setOn(m, on, s) {
  let isOnNow = !!m.on, offSites = list(m.offSites).slice();
  if (s != null && s !== '' && multiSite(m)) {
    offSites = offSites.filter((x) => x !== s);
    if (!on) offSites.push(s); else if (!isOnNow) isOnNow = true;
  } else isOnNow = !!on;
  return { on: isOnNow, offSites, clearNewOff: !!on };
}

/** A tier's switch on a site: groupsOff after (a site with none off left out). */
function setGroup(groupsOff, tier, on, s) {
  const out = Object.create(null);
  for (const k of Object.keys(groupsOff || {})) out[k] = list(groupsOff[k]).slice();
  const l = (out[s] || []).filter((t) => t !== tier);
  if (!on) l.push(tier);
  if (l.length) out[s] = l; else delete out[s];
  return out;
}

module.exports = {
  multiSite, isOn, running, off, setOn, setGroup,
  waiting, held, allow, approve, changeNeeds, seeded, ranAfter,
  HISTORY_DAYS, HISTORY_MAX, TRASH_DAYS, TRASH_MAX, add, undoAdd, remove, undoDelete, restoreDeleted, reject, restore,
};

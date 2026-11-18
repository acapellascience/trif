// The mod store's rules (Tim, 11-18: Android had ported them to Kotlin by hand; both phones now run this). Part 1, holds
// and Allow: what a mod waits for, what Allow allows, what a change asks about beyond its code's needs, what the version
// before counts as already allowed, and whether the version before keeps running while a change waits.
// docs/MOBILE-BEHAVIOUR.md, Mods and holds. Both phone apps run this (mobile/shared/gen/core.js: TrifCore.modStore);
// mod-store-cases.json holds the iPhone's answers. Desktop's own rules: helper/lib/held.js.
//
// A mod here is a plain record of what the rules read: {tier, site, matches, needs, extraNeeds, allowed, ran}, where a
// need is {key, fact, power?, lines?}, allowed is {need key: [line hashes]} (allowed.json's shape), and ran is whether
// a version before is kept running while a change waits (a change on hold).

'use strict';

const site = require('./site.js');

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

module.exports = { waiting, held, allow, approve, changeNeeds, seeded, ranAfter };

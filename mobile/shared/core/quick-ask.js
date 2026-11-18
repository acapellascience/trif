// Quick ask's rules (Tim, 11-18: "have it done without fiddling with the chat"): which of a reply's mods are added at
// once (look-only), what the pill then says, and what Undo puts back. docs/MOBILE-BEHAVIOUR.md, Quick ask. Both phone
// apps run this (mobile/shared/gen/core.js: TrifCore.quickAsk); quick-ask-cases.json holds the iPhone's answers.

'use strict';

const site = require('./site.js');

/**
 * A look-only mod: a style mod (css, hide, settings) with no powers, nothing waiting for an OK, no warnings, not
 * everywhere, and every site it runs on the chat's own. Anything else gets its card (Add this mod? or the approval).
 * @param {{tier: string, powers: string[], held: boolean, warnings: string[], everywhere: boolean, sites: string[]}} m
 * @param {string} chatSite the chat's site (site.chat: phone~ twin removed, registrable part)
 */
function lookOnly(m, chatSite) {
  const sites = m.sites || [];
  return m.tier === 'style' && !(m.powers || []).length && !m.held && !(m.warnings || []).length && !m.everywhere
    && !!chatSite && sites.length > 0 && sites.every((s) => site.of(s) === chatSite);
}

/**
 * A quick ask's reply: its offered mods (each {id, ...lookOnly's facts}) sorted into look (added at once) and rest
 * (their cards; a mod whose id is among look's isn't carded too), and the pill's state: 'done' (something added),
 * 'card' (only cards), 'replied' (no mods).
 * @param {object[]} offered
 * @param {string} chatSite the chat's site as the tab gave it (phone~ twins and hosts are fine)
 */
function sort(offered, chatSite) {
  const s = site.chat(chatSite);
  const look = (offered || []).filter((m) => lookOnly(m, s)).map((m) => m.id);
  const rest = (offered || []).filter((m) => !look.includes(m.id)).map((m) => m.id);
  return { site: s, look, rest, state: look.length ? 'done' : rest.length ? 'card' : 'replied' };
}

/**
 * Undo after Done: newest first, each mod back to the version it replaced ('before') or removed ('remove': it was new),
 * and its code remembered as declined (never offered again). Never to Recently deleted: as far as the person goes, it
 * never was. Only from 'done'.
 * @param {string} state the quick ask's state
 * @param {{id: string, hadBefore: boolean}[]} applied what Done added, in order
 * @returns {{id: string, to: string, decline: boolean}[]} the steps ([] when there's nothing to undo)
 */
function undo(state, applied) {
  if (state !== 'done') return [];
  return (applied || []).slice().reverse().map((a) => ({ id: a.id, to: a.hadBefore ? 'before' : 'remove', decline: true }));
}

module.exports = { lookOnly, sort, undo };

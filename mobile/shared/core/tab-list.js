// The tab list's rules (docs/MOBILE-BEHAVIOUR.md, Tabs and Chats and tabs; Tim 11-18: "it should snap to the tab that
// I just left"): which card it opens at, and each card's robot badge. The list itself, its scrolling and the badges'
// looks stay each app's. Both phone apps run this (mobile/shared/gen/core.js: TrifCore.tabList); tab-list-cases.json
// holds the answers the iPhone's Swift gave.

'use strict';

const site = require('./site.js');

/**
 * The tab a chat link goes back to now: the one it was sent from, while it's still open and on the chat's site.
 * @param {{site: string, tab: string|null}} l
 * @param {{id: string, host: string}[]} tabs
 */
function tabFor(l, tabs) {
  if (l.tab == null) return null;
  const t = tabs.find((x) => x.id === l.tab);
  return t && site.of(String(t.host || '')) === l.site ? t : null;
}

/**
 * The card the list opens at, from the chat: the chat's own tab (its link's tab while open and on its site). A chat
 * not sent from yet has no link: its site's tab then, the shown one if it's on that site, else the last one there.
 * Not from the chat (the page, Mods, More's chat): null, the shown tab.
 * @param {{open: boolean, more: boolean, link: {site: string, tab: string|null}|null, chat: string|null,
 *   tabs: {id: string, host: string}[], current: string}} f
 *   open: the chat shown or the quick ask's strip; more: More's chat; link: the shown chat's; chat: its site, when it
 *   has no link; current: the shown tab's id
 * @returns {string|null} a tab's id
 */
function focus(f) {
  if (!f.open || f.more) return null;
  const tabs = Array.isArray(f.tabs) ? f.tabs : [];
  let l = f.link && typeof f.link === 'object' ? f.link : null;
  if (!l && typeof f.chat === 'string') {
    const cur = tabs.find((x) => x.id === f.current);
    if (cur) {
      const s = f.chat;
      let t = site.of(String(cur.host || '')) === s ? cur : null;
      if (!t) for (let i = tabs.length - 1; i >= 0 && !t; i--) if (site.of(String(tabs[i].host || '')) === s) t = tabs[i];
      l = { site: s, tab: t ? t.id : null };
    }
  }
  if (!l) return null;
  const t = tabFor(l, tabs);
  return t ? t.id : null;
}

/**
 * The card drawn as the current one: the focus while that tab is open, else the shown tab.
 * @param {{focus: string|null, tabs: string[], current: string}} f
 */
function marked(f) {
  return f.focus != null && (f.tabs || []).includes(f.focus) ? f.focus : f.current;
}

/** A chat's state as its badge: a reply being written, a reply waiting, or plain. */
function activity(state) {
  return state === 'working' ? 'working' : state === 'waiting' ? 'replied' : 'idle';
}

/**
 * Each card's robot badge: its chats' (sent from it, while it's on their site), working before a reply waiting
 * before plain. Tabs with none are left out.
 * @param {{links: {site: string, tab: string|null, state: string}[], tabs: {id: string, host: string}[]}} f
 * @returns {Object<string, 'working'|'replied'|'idle'>} tab id → badge
 */
function badges(f) {
  const tabs = Array.isArray(f.tabs) ? f.tabs : [];
  const links = Array.isArray(f.links) ? f.links : [];
  const out = {};
  for (const t of tabs) {
    const mine = links.filter((l) => l.tab === t.id && tabFor(l, tabs)).map((l) => activity(l.state));
    if (!mine.length) continue;
    out[t.id] = mine.includes('working') ? 'working' : mine.includes('replied') ? 'replied' : 'idle';
  }
  return out;
}

module.exports = { focus, marked, badges, activity };

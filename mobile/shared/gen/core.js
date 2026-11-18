// Made by mobile/prepare.js from mobile/shared/core/*.js: don't edit. The phone apps' shared rules (docs/MOBILE-BEHAVIOUR.md).
var TrifCore = (function () {
'use strict';
const TrifCore = {};
const SOURCES = {};
SOURCES["app-links.js"] = function (module, exports, require) {
// Links that aren't web pages (tel:, mailto:, sms:, maps:, an app's own scheme such as fb-messenger:): handed to the
// phone's OS, as Safari does (Tim, 11-18). Only at once when the person tapped; a page (or a mod) trying it by itself
// gets the OS browser's question instead, at most one at a time and one a page load; never from a frame inside the
// page unless tapped. http/https always stay in TRIF (the default-browser rules). docs/MOBILE-BEHAVIOUR.md, Links.
// Both phone apps run this (mobile/shared/gen/core.js: TrifCore.appLinks); app-links-cases.json holds the answers.

'use strict';

/** The schemes that stay in the web view: about:, blob:, data:, and the iPhone app's test pages. */
const STAY = ['about', 'blob', 'data', 'trifprobe'];

/** (a tap's link comes ~0–0.4 s after the finger lifts: WebKit waits for a double tap on pages without a phone viewport) */
const TAP_WINDOW = 1.5;

/**
 * What a link's scheme is: 'web' (http/https: TRIF's own business), 'stay' (about, blob, data: in the web view),
 * 'never' (javascript: runs in its page only, file: is never opened; also no scheme), 'own' (trif: and the app's other
 * schemes: never handed to the OS, that would be the page opening TRIF itself), 'other' (another app's).
 * @param {string} scheme the URL's scheme, any case, without the colon
 * @param {string[]} own the app's own schemes (lower case)
 */
function kind(scheme, own) {
  const s = String(scheme || '').toLowerCase();
  if (!s) return 'never';
  if (s === 'http' || s === 'https') return 'web';
  if (STAY.includes(s)) return 'stay';
  if (s === 'javascript' || s === 'file') return 'never';
  if ((own || []).includes(s)) return 'own';
  return 'other';
}

/**
 * What to do with another app's link: 'open' (to the OS now), 'ask' (the question first) or 'drop:<why>' (nothing; why
 * is for the log).
 * @param {{tapped: boolean, mainFrame: boolean, askedThisLoad: boolean, asking: boolean, mayAsk?: boolean}} a
 *   tapped: the person tapped it (isTap); mainFrame: the page itself or a new window, not a frame inside it;
 *   askedThisLoad: the question was already put for this page's load (answered either way); asking: a question is up
 *   now; mayAsk: where it came from can ask at all (More's panel can't: its own page, only taps). Default true.
 */
function decide(a) {
  if (a.tapped) return 'open';
  if (a.mayAsk === false) return 'drop:not tapped';
  if (!a.mainFrame) return 'drop:a frame inside the page, not tapped';
  if (a.asking) return 'drop:a question is already up';
  if (a.askedThisLoad) return 'drop:asked once on this page already';
  return 'ask';
}

/**
 * A link or form counts as tapped when the person's finger was on the page just now (WebKit calls a script's
 * a.click() a link too), or a long-press menu's item was chosen.
 * @param {{linkOrForm: boolean, sinceTouch: number|null, touching: boolean, menu: boolean}} a sinceTouch: seconds since
 *   the finger last lifted (null: never)
 */
function isTap(a) {
  if (!a.linkOrForm) return false;
  if (a.menu || a.touching) return true;
  return typeof a.sinceTouch === 'number' && a.sinceTouch >= 0 && a.sinceTouch < TAP_WINDOW;
}

/** What the log may say about it: the scheme only (a mailto:'s address or a tel:'s number is the person's business). */
function logged(scheme) {
  return `${String(scheme || '?').toLowerCase() || '?'}:`;
}

module.exports = { kind, decide, isTap, logged, TAP_WINDOW, STAY };

};
SOURCES["chat-offers.js"] = function (module, exports, require) {
// What a chat may offer with Add this mod? (Tim, 11-17: "spurious asks to add old code when I open Claude chat"): the
// same code is never offered from a chat twice, whatever came of it (remembered across launches by a key of the code
// with its line ends and trailing spaces evened out), nor an installed mod's current or earlier version, nor a mod's
// in Recently deleted, nor one already waiting to be offered. A new version of a mod is still offered. Add to TRIF's
// tap isn't held to this. docs/MOBILE-BEHAVIOUR.md, Chat offers. The memory's entries are kept by the app (iPhone:
// UserDefaults "chatOffers"); these take them and give the new list back.
// Both phone apps run this (mobile/shared/gen/core.js: TrifCore.chatOffers); chat-offers-cases.json holds the answers.

'use strict';

/** How many codes are remembered (all chats; the oldest goes). */
const LIMIT = 500;
const OUTCOMES = ['offered', 'added', 'declined', 'dismissed'];

/**
 * The code as compared: line ends as \n, no trailing spaces or tabs on a line (non-breaking spaces as spaces), no
 * blank lines at either end. (A page's innerText, a viewer's lines and the stored file differ only in those.)
 * @param {string} code
 */
function normalise(code) {
  const lines = String(code).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/ /g, ' ')
    .split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  let a = 0;
  let z = lines.length;
  while (a < z && lines[a] === '') a++;
  while (z > a && lines[z - 1] === '') z--;
  return lines.slice(a, z).join('\n');
}

/**
 * The code's key: FNV-1a 64 over the normalised code's UTF-8 bytes, in hex (no leading zeros), ':', the byte count.
 * (Four 16-bit limbs, so any JavaScript engine gives the same answer without BigInt; a lone surrogate counts as U+FFFD,
 * as a native string holds it.)
 * @param {string} code
 */
function key(code) {
  const n = normalise(code);
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  let len = 0;
  const byte = (b) => {
    h0 ^= b;
    // × 0x100000001b3 = × 0x1b3 + × 2^40 (mod 2^64)
    let t = h0 * 0x1b3;
    const n0 = t & 0xffff;
    t = h1 * 0x1b3 + ((t / 0x10000) | 0);
    const n1 = t & 0xffff;
    t = h2 * 0x1b3 + h0 * 0x100 + ((t / 0x10000) | 0);
    const n2 = t & 0xffff;
    t = h3 * 0x1b3 + h1 * 0x100 + ((t / 0x10000) | 0);
    h3 = t & 0xffff; h2 = n2; h1 = n1; h0 = n0;
    len++;
  };
  for (let i = 0; i < n.length; i++) {
    let c = n.charCodeAt(i);
    if (c < 0x80) {
      // (ASCII, most code: byte() inline; no JIT on a phone's JavaScriptCore)
      h0 ^= c;
      let t = h0 * 0x1b3;
      const n0 = t & 0xffff;
      t = h1 * 0x1b3 + ((t / 0x10000) | 0);
      const n1 = t & 0xffff;
      t = h2 * 0x1b3 + h0 * 0x100 + ((t / 0x10000) | 0);
      const n2 = t & 0xffff;
      h3 = (h3 * 0x1b3 + h1 * 0x100 + ((t / 0x10000) | 0)) & 0xffff; h2 = n2; h1 = n1; h0 = n0;
      len++;
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n.length) {
      const d = n.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x800) { byte(0xc0 | (c >> 6)); byte(0x80 | (c & 63)); }
    else if (c < 0x10000) { byte(0xe0 | (c >> 12)); byte(0x80 | ((c >> 6) & 63)); byte(0x80 | (c & 63)); }
    else { byte(0xf0 | (c >> 18)); byte(0x80 | ((c >> 12) & 63)); byte(0x80 | ((c >> 6) & 63)); byte(0x80 | (c & 63)); }
  }
  const hi = h3 * 0x10000 + h2;
  const lo = h1 * 0x10000 + h0;
  return (hi ? hi.toString(16) + lo.toString(16).padStart(8, '0') : lo.toString(16)) + ':' + len;
}

/**
 * What came of a code offered from a chat before: 'offered', 'added', 'declined', 'dismissed', or null (never).
 * @param {{key: string, outcome: string}[]} entries the memory, newest last
 * @param {string} code
 */
function outcome(entries, code) {
  const k = key(code);
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].key === k) return entries[i].outcome;
  return null;
}

/**
 * The memory after a code's news: offered → remembered as the newest (once; the oldest past LIMIT forgotten); added,
 * declined → what came of it, if it was offered from a chat (a paste's add isn't remembered); dismissed → only over
 * offered (Cancel says declined first). null when nothing changes (nothing to store).
 * @param {{key: string, outcome: string, at: number}[]} entries newest last; at: seconds since 1970
 * @param {string} code
 * @param {'offered'|'added'|'declined'|'dismissed'} o
 * @param {number} at seconds since 1970
 */
function note(entries, code, o, at) {
  if (!OUTCOMES.includes(o)) return null;
  const k = key(code);
  const list = entries.slice();
  let i = -1;
  for (let j = list.length - 1; j >= 0; j--) if (list[j].key === k) { i = j; break; }
  if (o === 'offered') {
    if (i >= 0) list.splice(i, 1);
    list.push({ key: k, outcome: 'offered', at });
    if (list.length > LIMIT) list.splice(0, list.length - LIMIT);
    return list;
  }
  if (i < 0 || (o === 'dismissed' && list[i].outcome !== 'offered')) return null;
  list[i] = Object.assign({}, list[i], { outcome: o });
  return list;
}

/**
 * Many codes' keys at once (an app keeps them: a code's key never changes, and a hand-over then hashes only new code).
 * @param {string[]} codes
 */
function keys(codes) {
  return codes.map(key);
}

/**
 * Why a chat's mod isn't offered, or null (offer it). In this order: installed with this very code, already waiting
 * to be offered, offered from a chat before (with what came of it), an installed mod's earlier version (its history),
 * in Recently deleted (its code or history). Every code as its key (key()).
 * @param {{key: string, installed: Known[], deleted: Known[], queued: Known[], entries: {key: string, outcome: string}[]}} a
 * @typedef {{id: string, key: string, history?: string[]}} Known history: the earlier versions' keys
 */
function skip(a) {
  const k = a.key;
  const hist = (m) => (m.history || []).includes(k);
  if ((a.installed || []).some((m) => m.key === k)) return 'installed as it is';
  if ((a.queued || []).some((m) => m.key === k)) return 'waiting to be offered';
  const entries = a.entries || [];
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].key === k) return `offered from a chat before (${entries[i].outcome})`;
  const m = (a.installed || []).find(hist);
  if (m) return `an earlier version of ${m.id}`;
  if ((a.deleted || []).some((d) => d.key === k || hist(d))) return 'in Recently deleted';
  return null;
}

module.exports = { normalise, key, keys, outcome, note, skip, LIMIT };

};
SOURCES["desktop.js"] = function (module, exports, require) {
// Request Desktop Website's per-site memory (docs/MOBILE-BEHAVIOUR.md, Desktop websites; Tim 11-18, "a desktop mode
// like safari has"): as Safari's per-website setting, by host without www., in every tab, kept across launches; Request
// Mobile Website takes the site off. How a page loads as a computer's, and where the list is kept, stay each app's.
// Both phone apps run this (mobile/shared/gen/core.js: TrifCore.desktop); desktop-cases.json holds the answers the
// iPhone's Swift gave.

'use strict';

/** Code point order (Swift's sorted(); hosts are punycode, so ASCII in practice). */
const byCodePoint = (a, b) => {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
};

/** The key a host is kept by: lower case, a leading www. removed. */
function key(host) {
  const h = String(host || '').toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/**
 * A page on `host` loads as a computer's.
 * @param {string[]} kept the kept keys
 */
function wants(kept, host) {
  const h = String(host || '');
  return h !== '' && (kept || []).includes(key(h));
}

/**
 * The kept list after Request Desktop (on) or Mobile (off) Website on `host`: sorted, once each.
 * @param {string[]} kept
 */
function set(kept, host, on) {
  const s = new Set(kept || []);
  if (on) s.add(key(host)); else s.delete(key(host));
  return [...s].sort(byCodePoint);
}

/** The page can be asked for as a computer's or a phone's: a website (http or https) with a host. */
function can(scheme, host) {
  return ['http', 'https'].includes(String(scheme || '').toLowerCase()) && String(host || '') !== '';
}

module.exports = { key, wants, set, can };

};
SOURCES["leaving-cover.js"] = function (module, exports, require) {
// The leaving cover's "icon use" decision (docs/MOBILE-BEHAVIOUR.md, Icons and full screen; Tim 11-18): as the app
// leaves while it's used through Home Screen icons, a plain cover goes up so the OS's picture of the app is never
// another page. The cover itself, its timing and the OS's hooks stay each app's. Both phone apps run this
// (mobile/shared/gen/core.js: TrifCore.leavingCover); leaving-cover-cases.json holds the answers the iPhone's Swift gave.

'use strict';

const site = require('./site.js');

/** Seconds after an icon's link within which coming to the front counts as by an icon (a warm return's link comes
 * just after the app comes to the front; a cold launch's just before). */
const ICON_WINDOW = 3;

/**
 * Whether the app is in icon use as it leaves (null: it isn't, the real picture stays). Two signs: the shown tab is
 * an icon's own tab, on its site, in full screen (how an icon lands); or the app last came to the front by an icon's
 * link. A tab put in full screen by the two-finger hold, with no icon, is neither.
 * @param {{fullScreen: boolean, host: string, tab: string, iconTabs: Object<string,string>|null, arrivedByIcon: boolean}} f
 *   host: the shown tab's; tab: its id; iconTabs: each icon's site → its own tab's id
 * @returns {null | {iconTab: string} | {arrived: true}} iconTab: the icon's site
 */
function reason(f) {
  const s = site.of(String(f.host || ''));
  const tabs = f.iconTabs && typeof f.iconTabs === 'object' ? f.iconTabs : {};
  if (f.fullScreen && s && Object.prototype.hasOwnProperty.call(tabs, s) && tabs[s] === f.tab) return { iconTab: s };
  if (f.arrivedByIcon) return { arrived: true };
  return null;
}

/**
 * Coming to the front counts as by an icon: its link came less than ICON_WINDOW seconds ago (or later: a clock
 * turned back).
 * @param {number} since seconds since the icon's last link
 */
function arrived(since) {
  return Number(since) < ICON_WINDOW;
}

module.exports = { ICON_WINDOW, reason, arrived };

};
SOURCES["match.js"] = function (module, exports, require) {
// Chrome-style match patterns (https://x.com/*, *://*.x.com/*, <all_urls>): whether a mod's @match / @exclude covers an
// address. docs/MOBILE-BEHAVIOUR.md, Mods and holds. Both phone apps run this (mobile/shared/gen/core.js:
// TrifCore.match); mod-runs-cases.json holds the answers the iPhone's MatchPattern gave. The iPhone keeps a Swift twin
// (ModRuns.swift: it's asked on every page load for every mod), held to the same cases. The page's own test is
// modfile.js matchesUrl.
//
// An address arrives as its parts, as the platform's URL parser gives them (parsing stays platform): {scheme, host,
// path}, scheme and host in lower case (a host without its port; a non-ASCII host as punycode), path the
// percent-encoded path ("/" when empty) plus "?" and the percent-encoded query when there is one (no fragment).
// null: an address the platform can't parse (covered by nothing).

'use strict';

const web = (s) => s === 'http' || s === 'https';

/** a whole-string glob: '*' any run of characters (line breaks too), anything else itself (UTF-16 units) */
function glob(pat, s) {
  const parts = pat.split('*');
  if (parts.length === 1) return pat === s;
  const first = parts[0], last = parts[parts.length - 1];
  if (s.length < first.length + last.length || !s.startsWith(first) || !s.endsWith(last)) return false;
  let at = first.length;
  const end = s.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const j = s.indexOf(parts[i], at);
    if (j < 0 || j + parts[i].length > end) return false;
    at = j + parts[i].length;
  }
  return true;
}

/**
 * Whether one pattern covers an address: <all_urls> any http(s) page; scheme * http or https only, else http or https
 * exactly (as written: HTTPS:// covers nothing); host * any, *.base base itself or under it, else exactly (in any case;
 * another * covers nothing; a port covers nothing); the path a whole-string glob over path and query.
 * @param {string} p
 * @param {{scheme: string, host: string, path: string} | null} u
 */
function one(p, u) {
  if (!u) return false;
  p = String(p);
  const scheme = String(u.scheme || '').toLowerCase(), host = String(u.host || '').toLowerCase();
  if (p === '<all_urls>') return web(scheme);
  const sep = p.indexOf('://');
  if (sep < 0) return false;
  const ps = p.slice(0, sep), rest = p.slice(sep + 3);
  const slash = rest.indexOf('/');
  if (slash < 0) return false;
  const ph = rest.slice(0, slash).toLowerCase(), path = rest.slice(slash);
  if (ps === '*') { if (!web(scheme)) return false; } else if (ps !== scheme || !web(ps)) return false;
  if (ph !== '*') {
    if (ph.startsWith('*.')) { const base = ph.slice(2); if (host !== base && !host.endsWith(`.${base}`)) return false; }
    else if (ph.includes('*') || host !== ph) return false;
  }
  return glob(path, String(u.path || ''));
}

/** whether any of the patterns covers the address */
const any = (patterns, u) => (Array.isArray(patterns) ? patterns : []).some((p) => one(p, u));

/** whether a mod applies to an address: an @match covers it and no @exclude does */
const applies = (matches, excludes, u) => any(matches, u) && !any(excludes, u);

module.exports = { one, any, applies };

};
SOURCES["mod-offer.js"] = function (module, exports, require) {
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

};
SOURCES["mod-store.js"] = function (module, exports, require) {
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

};
SOURCES["quick-ask.js"] = function (module, exports, require) {
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

};
SOURCES["site.js"] = function (module, exports, require) {
// Sites as both apps group them: a host's registrable part (en.wikipedia.org → wikipedia.org; news.bbc.co.uk →
// bbc.co.uk), without www., lower case; IP addresses, one-word hosts and all-sites as they are. docs/MOBILE-BEHAVIOUR.md,
// Sites. Both phone apps run this (mobile/shared/gen/core.js: TrifCore.site); site-cases.json holds the answers the
// iPhone's Site.of gave. The iPhone keeps a Swift twin (Site.swift: it runs on every navigation), held to the same cases.

'use strict';

/** the two-part public suffixes that keep three parts */
const TWO_PART = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.mx', 'co.in', 'co.kr', 'com.cn', 'com.tw', 'com.hk', 'co.za', 'com.sg', 'com.tr', 'com.ar', 'qc.ca'];

/** lower case, without one leading www. */
const plain = (host) => String(host || '').toLowerCase().replace(/^www\./, '');

/**
 * A host's site. Numbers-only hosts (any script's digits, as Unicode's Number category: an IP address) stay whole.
 * (The iPhone's Swift also counts Han numerals such as 一 as numbers; hosts arrive as punycode, so it never shows.)
 * @param {string} host
 */
function of(host) {
  const h = plain(host);
  if (!h || h === 'all-sites' || /^[\p{N}.]*$/u.test(h) || !h.includes('.')) return h;
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return TWO_PART.includes(last2) ? parts.slice(-3).join('.') : last2;
}

/** Whether `host` is `site` or under it (www. and case aside). */
function hostIsIn(host, site) {
  const h = plain(host);
  return h === site || h.endsWith(`.${site}`);
}

/** A chat's site: its page's site, a phone twin (phone~x.com, the computer's phone view) as its site. */
function chat(site) {
  let s = String(site || '');
  if (s.startsWith('phone~')) s = s.slice('phone~'.length);
  return of(s);
}

module.exports = { of, hostIsIn, chat, TWO_PART };

};
SOURCES["speech-text.js"] = function (module, exports, require) {
// The microphone's words, put together so they only ever grow (docs/MOBILE-BEHAVIOUR.md, Voice; Tim 11-18: "If you
// pause, it deletes the things you've said so far"): what was said before a pause stays, a restarted recognizer's
// words go after it, a revised partial replaces only the words since the last committed ones. The recognizers, the
// audio and the box stay each app's. Both phone apps run this (mobile/shared/gen/core.js: TrifCore.speechText);
// speech-text-cases.json holds the answers the iPhone's Swift (SpeechText.swift) gave.
//
// The words' state is a plain record {said, live, taskSaid, restarts}; the committed words stay the caller's (they
// only grow). `apply` takes one recognizer event and gives the next state, what to add to the committed words, and
// the text's tail after them. Events:
//   - iOS 26's SpeechAnalyzer: ['volatile', s] the words being heard (they may change), ['final', s] a finished stretch.
//   - SFSpeechRecognizer (and Android's SpeechRecognizer the same way): ['partial', s] the task's best transcription so
//     far, ['segment', s] the recognizer marked the utterance done, ['newTask'] a task ended and the next one starts.
//
// The iPhone's Swift split words on Characters (a whitespace followed by a mark is one whitespace Character; a Prepend
// sign joins what follows it), lowercased scalar by scalar (no final-sigma rule), kept Characters whose first scalar is
// a letter or a number, and compared by canonical equivalence; so does this.

'use strict';

/** what joins the Character before it (marks, joiners, emoji modifiers, tags, Thai and Lao AM): nearly Unicode's
 * Extend + SpacingMark, as the iPhone's Swift has them */
const JOINS = '\\p{M}\\u200C\\u200D\\u0E33\\u0EB3\\uFF9E\\uFF9F\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}';
/** Unicode's Prepend signs (they join the Character after them unless it's a control) */
const PREPEND = '\\u0600-\\u0605\\u06DD\\u070F\\u0890\\u0891\\u08E2\\u0D4E\\u{110BD}\\u{110CD}\\u{111C2}\\u{111C3}\\u{1193F}\\u{11941}\\u{11A3A}\\u{11A84}-\\u{11A89}\\u{11D46}\\u{11F02}';
/** a control: nothing joins it, and a Prepend sign doesn't join it */
const CONTROL = `(?![\\u200C\\u200D\\u{E0020}-\\u{E007F}${PREPEND}])[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]`;
const CHARACTER = new RegExp(`[${PREPEND}]+(?!${CONTROL})[^][${JOINS}]*|\\r\\n|${CONTROL}|[^][${JOINS}]*`, 'gu');
const SPACE = /^\p{White_Space}/u;
const KEEP = /^[\p{Alphabetic}\p{N}]/u;
const PLAIN = /^[\x21-\x7e]*$/;

const same = (a, b) => a === b || a.normalize('NFC') === b.normalize('NFC');

/** The words in `s`: split at whitespace Characters, none empty. */
function words(s) {
  s = String(s);
  if (/^[\x20-\x7e\t\n\v\f\r]*$/.test(s)) return s.split(/[ \t\n\v\f\r]+/).filter((w) => w !== '');
  const out = [];
  let w = '';
  for (const c of s.match(CHARACTER) || []) {
    if (SPACE.test(c)) { if (w) out.push(w); w = ''; } else w += c;
  }
  if (w) out.push(w);
  return out;
}

/** A word as it's compared: lowercased scalar by scalar, only its letters and numbers. */
function norm(w) {
  w = String(w);
  if (PLAIN.test(w)) return w.toLowerCase().replace(/[^a-z0-9]/g, '');
  let lower = '';
  for (const c of w) lower += c.toLowerCase();
  return (lower.match(CHARACTER) || []).filter((c) => KEEP.test(c)).join('');
}

/** `s`'s words with one space between them. */
const clean = (s) => words(s).join(' ');

/** what a join trims (Foundation's whitespacesAndNewlines: White_Space and U+200B; all of it is in the BMP) */
const trims = (c) => c === 0x20 || (c >= 9 && c <= 13) || c === 0x85 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200b) ||
  c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;

/** `s` without those at either end (a loop, not a regular expression: `committed` grows long) */
function trim(s) {
  let i = 0, j = s.length;
  while (i < j && trims(s.charCodeAt(i))) i++;
  while (j > i && trims(s.charCodeAt(j - 1))) j--;
  return i === 0 && j === s.length ? s : s.slice(i, j);
}

/** `a` then `b`, trimmed, with a space between when both have words. */
function join(a, b) {
  a = trim(String(a));
  b = trim(String(b));
  if (!a) return b;
  if (!b) return a;
  return a + ' ' + b;
}

/**
 * Whether `next` is a new transcription rather than a revision of `previous`: shorter, and either starting
 * differently or much shorter. (A wrong guess repeats a few words; the other way round would lose them.)
 */
function isFresh(previous, next) {
  const p = words(previous).map(norm), n = words(next).map(norm);
  if (p.length < 2 || n.length >= p.length) return false;
  if (n.length === 0) return true;
  for (let i = 0; i < Math.min(2, n.length); i++) if (!same(n[i], p[i])) return true;
  return n.length * 3 <= p.length * 2;
}

/** `s` without the task's already committed words at its start (when the recognizer repeats them). */
function afterTaskSaid(taskSaid, s) {
  if (!taskSaid) return s;
  const said = words(taskSaid), all = words(s);
  if (all.length < said.length) return s;
  const a = said.map(norm), b = all.slice(0, said.length).map(norm);
  let alike = 0;
  for (let i = 0; i < a.length; i++) if (same(a[i], b[i])) alike++;
  // (the same words; or, for a longer stretch, nearly the same: a word revised in the repeat)
  const ok = alike === a.length || (a.length >= 3 && alike >= a.length - Math.max(1, Math.floor(a.length / 5)) && same(a[0], b[0]));
  return ok ? all.slice(said.length).join(' ') : s;
}

/** The words before anything was heard. */
const start = () => ({ said: false, live: '', taskSaid: '', restarts: 0 });

/**
 * The next state after one recognizer event. What's committed stays the caller's (it only grows, and it grows long:
 * it never crosses): the answer says what to add to its end, and what follows it in the text.
 * @param {{said: boolean, live: string, taskSaid: string, restarts: number}|null} state said: anything committed yet
 * @param {Array} event ['volatile'|'final'|'partial'|'segment', text] or ['newTask']
 * @returns {{added: string, said: boolean, live: string, taskSaid: string, restarts: number, tail: string}}
 *   committed += added; text = committed + tail. restarts: how many times a fresh transcription was caught replacing
 *   the live words (for diagnostics)
 */
function apply(state, event) {
  const st = state || {};
  let live = String(st.live || ''), taskSaid = String(st.taskSaid || ''), restarts = Number(st.restarts) || 0;
  let said = !!st.said, added = '';
  // join(committed, x): committed is always trimmed, so only whether it has words matters
  const commit = (x) => {
    x = trim(x);
    if (!x) return;
    added += (said ? ' ' : '') + x;
    said = true;
  };
  const partial = (whole) => {
    const next = afterTaskSaid(taskSaid, clean(whole));
    if (isFresh(live, next)) {
      // (the recognizer started over after a pause: the words it dropped are kept)
      commit(live);
      restarts += 1;
    }
    live = next;
  };
  const [kind, s] = Array.isArray(event) ? event : [];
  switch (kind) {
    case 'volatile': live = clean(s || ''); break;
    case 'final': commit(clean(s || '')); live = ''; break;
    case 'partial': partial(s || ''); break;
    case 'segment': {
      partial(s || '');
      commit(live);
      live = '';
      const w = clean(s || '');
      if (w) taskSaid = w;
      break;
    }
    case 'newTask': commit(live); live = ''; taskSaid = ''; break;
    default: break;
  }
  const rest = trim(live);
  return { added, said, live, taskSaid, restarts, tail: rest ? (said ? ' ' : '') + rest : '' };
}

module.exports = { words, norm, clean, join, isFresh, start, apply };

};
SOURCES["tab-reload.js"] = function (module, exports, require) {
// Which tabs load again when the mods change (docs/MOBILE-BEHAVIOUR.md, Tabs; Tim 11-18: "when you successfully add
// the mod to the other tab, your tab reloads. That's quite annoying for watching videos"). After a change to the mods
// the scripts every page gets are made again; the shown page loads again only if what runs on it changed, and never
// while it plays (unless the person's own act asks for it: Pause all); tabs behind load again when they're next shown.
// What runs on a page is a signature each app makes (iPhone: Hasher, per launch); only its equality matters here. The
// reload itself, the playing check and the scripts stay each app's. Both phone apps run this (mobile/shared/gen/core.js:
// TrifCore.tabReload); tab-reload-cases.json holds the answers the iPhone's Swift gave.

'use strict';

/** The signature a page keeps as it commits while a change isn't in the scripts yet: it counts as stale. */
const PENDING = 'pending';

/**
 * A tab shown: its first load (what was kept of it) or a look at whether its mods changed.
 * @param {{started: boolean, waitingForFront: boolean}} f waitingForFront: the app isn't in front yet (it starts then)
 * @returns {'start' | 'refresh'}
 */
function shown(f) {
  return !f.started && !f.waitingForFront ? 'start' : 'refresh';
}

/**
 * The signature a page keeps as it commits.
 * @param {{pending: boolean, signature: string}} f pending: a change to the mods isn't in the scripts yet
 */
function loaded(f) {
  return f.pending ? PENDING : String(f.signature);
}

/**
 * Whether the mods running on a page changed since it loaded (null: it hasn't loaded).
 * @param {string|null} kept what loaded() gave as it committed
 * @param {string} now the signature for its address now
 */
function stale(kept, now) {
  return kept == null ? null : String(now) !== String(kept);
}

/**
 * The shown tab looked at after a change (or as it's shown again).
 * @param {{pending: boolean, started: boolean, hasPage: boolean, reloading: boolean, loaded: string|null, now: string,
 *   evenPlaying: boolean}} f hasPage: it has an address; reloading: a reload of it is under way; evenPlaying: Pause all
 * @returns {'later' | 'keep' | 'ask' | 'next'} later: once the scripts are in, look again (if it's still the tab
 *   shown); ask: find out whether it plays, then recheck; next: recheck (on the next turn) without asking
 */
function refresh(f) {
  if (f.pending) return 'later';
  if (!f.started || !f.hasPage || f.reloading || !stale(f.loaded, f.now)) return 'keep';
  return f.evenPlaying ? 'next' : 'ask';
}

/**
 * After refresh's ask (or next): whether it loads again now.
 * @param {{playing: boolean, shown: boolean, reloading: boolean, pending: boolean, loaded: string|null, now: string}} f
 *   playing: it plays sound or video (false when not asked); shown: it's still the tab shown
 * @returns {'playing' | 'keep' | 'reload'} playing: it keeps going as it is, and loads again the next time it's shown
 *   not playing
 */
function recheck(f) {
  if (f.playing) return 'playing';
  if (!f.shown || f.reloading || f.pending || !stale(f.loaded, f.now)) return 'keep';
  return 'reload';
}

module.exports = { PENDING, shown, loaded, stale, refresh, recheck };

};
SOURCES["video-resume.js"] = function (module, exports, require) {
// A video picks up where it was after its page loads again (docs/MOBILE-BEHAVIOUR.md, Video; Tim 11-18): which load
// resumes the video kept for its tab (the same page within 30 minutes, not live, not ended, not another video, not the
// first 5 s or the last 10 s, not a link asking for its own time), and the sites' video ids. What the page reports,
// where it's kept and how it's put back stay each app's (and the page's). Both phone apps run this
// (mobile/shared/gen/core.js: TrifCore.videoResume); video-resume-cases.json holds the answers the iPhone's Swift gave.
//
// An address crosses in as its parts, as the platform's parser gives them (a bare JavaScriptCore has no URL):
// {host, path (percent escapes decoded), query: [[name, value or null]] or null, fragment or null}, or null when it
// isn't an address. The iPhone's Swift compared text as Characters (a mark after "/" or "#" belongs to it, a number is
// a Character whose first scalar is one) and by canonical equivalence; so does this. (Its Character.isNumber also
// counts Han numerals such as 一; JS's \p{N} doesn't. Addresses are punycode and percent escapes in practice.)

'use strict';

const WINDOW = 30 * 60, SKIP_START = 5, SKIP_END = 10;

/** what joins the Character before it (marks, joiners, emoji modifiers, tags): nearly Unicode's Extend + SpacingMark */
const JOINS = '\\p{M}\\u200C\\u200D\\uFF9E\\uFF9F\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}';
const SLASH = new RegExp(`/(?![${JOINS}])`, 'u');
const HASH = new RegExp(`#(?![${JOINS}])`, 'u');
const NUMBER = new RegExp(`^(?:\\p{N}[${JOINS}]*)+$`, 'u');
const T_IS = new RegExp(`^t=(?![${JOINS}])`, 'u');

const same = (a, b) => a === b || (a != null && b != null && String(a).normalize('NFC') === String(b).normalize('NFC'));

/**
 * The site's own id for the video at an address, where it has one: YouTube's watch?v=, /shorts/, /embed/, /live/,
 * /v/, youtu.be/; Vimeo's number (the last one in the path). null elsewhere (the address itself is the page then).
 * @param {{host: ?string, path: string, query: ?Array, fragment: ?string}|null} p
 */
function videoID(p) {
  if (!p || p.host == null) return null;
  const host = String(p.host).toLowerCase().normalize('NFC');
  const parts = String(p.path || '').split(SLASH).filter((s) => s !== '');
  const is = (h) => host === h || host.endsWith('.' + h);
  if (host === 'youtu.be') return parts.length ? 'yt:' + parts[0] : null;
  if (is('youtube.com') || is('youtube-nocookie.com')) {
    const v = (p.query || []).find(([name]) => same(name, 'v'));
    if (v && v[1] != null && v[1] !== '') return 'yt:' + v[1];
    if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].some((k) => same(parts[0], k))) return 'yt:' + parts[1];
    return null;
  }
  if (is('vimeo.com')) {
    const n = [...parts].reverse().find((s) => NUMBER.test(s));
    return n ? 'vimeo:' + n : null;
  }
  return null;
}

/** The address asks for its own time (a shared link's t=, start=, time_continue=, a #t=): the person chose it. */
function asksForTime(p) {
  if (!p) return false;
  if ((p.query || []).some(([name]) => ['t', 'start', 'time_continue'].some((k) => same(name, k)))) return true;
  return T_IS.test(p.fragment || '');
}

/** An address without its #part. */
const bare = (url) => String(url).split(HASH)[0];

/**
 * The same page: the same video id when the site has one, else the same address (its #part aside).
 * @param {{url: string, parts: object|null}} a
 * @param {{url: string, parts: object|null}} b
 */
function samePage(a, b) {
  const va = videoID(a.parts), vb = videoID(b.parts);
  if (va != null || vb != null) return same(va, vb);
  return same(bare(a.url), bare(b.url));
}

/**
 * Whether the page loading `address` in this tab picks up the video kept for it, and why (Diagnostics only).
 * @param {{saved: ?{url: string, parts: object|null, time: number, duration: number, live: boolean, ended: boolean, age: number}, address: {url: string, parts: object|null}}} f
 *   duration: -1 when live or not known; age: seconds since it was kept
 * @returns {{plan: boolean, why: string}}
 */
function decide(f) {
  const s = f.saved;
  const no = (why) => ({ plan: false, why });
  if (!s) return no('nothing kept');
  if (s.age > WINDOW) return no('kept more than 30 minutes ago');
  if (s.live) return no('a live stream');
  if (s.ended) return no('it had ended');
  if (!samePage(s, f.address)) return no('another page or video');
  if (asksForTime(f.address.parts) && !asksForTime(s.parts)) return no('the address asks for its own time');
  if (s.time < SKIP_START) return no(`in its first ${SKIP_START} s`);
  if (s.duration > 0 && s.time > s.duration - SKIP_END) return no(`in its last ${SKIP_END} s`);
  return { plan: true, why: 'resume' };
}

module.exports = { videoID, asksForTime, samePage, decide, WINDOW, SKIP_START, SKIP_END };

};
const cache = {};
function require(name) {
  const f = name.replace(/^\.\//, '');
  if (cache[f]) return cache[f].exports;
  if (!SOURCES[f]) throw new Error(`no shared rule ${name}`);
  const module = { exports: {} };
  cache[f] = module;
  SOURCES[f](module, module.exports, require);
  return module.exports;
}
TrifCore.appLinks = require("app-links.js");
TrifCore.chatOffers = require("chat-offers.js");
TrifCore.desktop = require("desktop.js");
TrifCore.leavingCover = require("leaving-cover.js");
TrifCore.match = require("match.js");
TrifCore.modOffer = require("mod-offer.js");
TrifCore.modStore = require("mod-store.js");
TrifCore.quickAsk = require("quick-ask.js");
TrifCore.site = require("site.js");
TrifCore.speechText = require("speech-text.js");
TrifCore.tabReload = require("tab-reload.js");
TrifCore.videoResume = require("video-resume.js");
// name "module.fn", args a JSON array; the answer as JSON (null for undefined)
TrifCore.call = function (name, argsJSON) {
  const dot = name.indexOf('.');
  const r = TrifCore[name.slice(0, dot)][name.slice(dot + 1)].apply(null, JSON.parse(argsJSON));
  return JSON.stringify(r === undefined ? null : r);
};
return TrifCore;
})();
if (typeof module === 'object' && module && module.exports) module.exports = TrifCore;

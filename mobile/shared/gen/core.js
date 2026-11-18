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
SOURCES["mod-store.js"] = function (module, exports, require) {
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
TrifCore.modStore = require("mod-store.js");
TrifCore.quickAsk = require("quick-ask.js");
TrifCore.site = require("site.js");
// name "module.fn", args a JSON array; the answer as JSON (null for undefined)
TrifCore.call = function (name, argsJSON) {
  const dot = name.indexOf('.');
  const r = TrifCore[name.slice(0, dot)][name.slice(dot + 1)].apply(null, JSON.parse(argsJSON));
  return JSON.stringify(r === undefined ? null : r);
};
return TrifCore;
})();
if (typeof module === 'object' && module && module.exports) module.exports = TrifCore;

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
 * blank lines at either end. (A page's innerText, a viewer's lines and the stored file differ only in those.) The
 * header's `@id` lines are left out (Tim, 11-18: a mod's stable id, docs/PHONE-SYNC.md 2a): TRIF adds one to a mod it
 * keeps, so the installed copy is still "installed as it is" for the chat's copy without it. Code with no `@id` line
 * in its header keeps the key it had.
 * @param {string} code
 */
function normalise(code) {
  const lines = withoutIds(String(code).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/ /g, ' ')
    .split('\n').map((l) => l.replace(/[ \t]+$/, '')));
  let a = 0;
  let z = lines.length;
  while (a < z && lines[a] === '') a++;
  while (z > a && lines[z - 1] === '') z--;
  return lines.slice(a, z).join('\n');
}

/** The lines without the `@id` lines of the first whole ==WebMod== block (core/mod-id.js's header rule). */
function withoutIds(lines) {
  const start = lines.findIndex((l) => /^\s*\/\/\s*==WebMod==\s*$/i.test(l.replace(/^\uFEFF/, '')));
  if (start === -1) return lines;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (/^\s*\/\/\s*==\/WebMod==\s*$/i.test(lines[i])) { end = i; break; }
  if (end === -1) return lines;
  return lines.filter((l, i) => !(i > start && i < end && /^\s*\/\/\s*@id(?:\s|$)/i.test(l)));
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

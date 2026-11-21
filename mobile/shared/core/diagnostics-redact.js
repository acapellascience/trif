// Diagnostics as they leave the phone (security batch, Tim 2026-11-20: "Diagnostics without browsing history";
// docs/MOBILE-BEHAVIOUR.md, Diagnostics). The log kept on the phone, in the app's own container, keeps its detail;
// what Copy diagnostics copies and Send diagnostics… shares is this: sites only, never where on them; nothing at all
// of a sensitive site's ("a sensitive site"); cookies as totals, never per domain or by name; long ids (a chat's
// conversation, a tab's) shortened to their last 8; no page text (a mod's own log lines are counted, not copied).
// TRIF's own stand-in hosts (localhost, 127.0.0.1, ::1, a .local or .localhost name) keep their whole addresses:
// they're the tests', never the person's browsing.
//
// Pure functions, JSON in and out. Both phone apps can run this (mobile/shared/gen/core.js: TrifCore.diagnosticsRedact);
// diagnostics-redact-cases.json holds the answers; mobile/test/core-diagredact.test.js checks them.

'use strict';

const access = require('./site-access.js');

/** A host TRIF's own tests use (kept whole): loopback, a .localhost or .local (Bonjour) name. */
function isStandIn(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h) || h.endsWith('.localhost') || h.endsWith('.local');
}

/** TRIF's own page schemes (its pages, its panel): kept whole. */
const OWN_SCHEMES = ['trifprobe', 'trifpanel'];

const SENSITIVE = 'a sensitive site';

/** The chats TRIF itself drives (its robot view's Claude and ChatGPT): on TRIF's sensitive list for the person's own
 *  browsing, but TRIF's chat lines name them, with their pages' shape (/chat/…, /c/…, /project/…), ids shortened. */
const CHATS = ['claude.ai', 'chatgpt.com'];
const isChat = (host) => { const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, ''); return CHATS.includes(h); };

/** Whether a host is in a sensitive site (TRIF's list and the person's own), TRIF's own chats aside. */
function sensitive(host, own) {
  const h = String(host || '').replace(/:\d+$/, '');
  return !isChat(h) && !!access.hit(h, own);
}

// scheme://[user@]host[:port] then the rest (path, query, fragment) up to a space, a quote or a bracket; punctuation
// that ends a sentence stays out of it
const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#"'<>()[\]{},;]*)([^\s"'<>()[\]{}]*)/gi;
// a host-like word: labels with a dot between, a letter in the last
const HOST_RE = /(^|[^a-z0-9.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?)(?![a-z0-9-])/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_RE = /\b[0-9a-f]{20,}\b/gi;

const short = (id) => `…${id.slice(-8)}`;

/** An address cut to its site (`scheme://host`), whole for a stand-in or TRIF's own page, "a sensitive site". */
function address(scheme, authority, rest, own) {
  const s = scheme.toLowerCase();
  const host = authority.replace(/^[^@]*@/, '');
  if (OWN_SCHEMES.includes(s)) return `${scheme}://${authority}${rest}`;
  if (s === 'http' || s === 'https') {
    if (sensitive(host, own)) return SENSITIVE;
    if (isStandIn(host)) return `${scheme}://${host}${rest}`;
    if (isChat(host)) {
      // (the path's shape, each id in it shortened; never a query or fragment)
      const path = rest.replace(/[?#].*$/, '').replace(/[.,:;!?]+$/, '');
      const shaped = path.split('/').map((seg) => (seg.length >= 12 && /\d/.test(seg) ? short(seg) : seg)).join('/');
      return `${scheme}://${host}${shaped}`;
    }
  }
  // (a trailing full stop or comma belongs to the sentence, not the address)
  const tail = /[.,:;!?]+$/.exec(rest);
  return `${scheme}://${host}${tail ? tail[0] : ''}`;
}

/** One line's text, made safe to share (the kind decides the cookie and mod-log rules). */
function line(kind, text, own) {
  let t = String(text == null ? '' : text);
  const k = String(kind || '');
  if (k === 'cookies') t = cookies(t);
  else if (k === 'cookie names') t = cookieNames(t);
  else if (k === 'cookie changes') t = cookieChanges(t);
  else if (k === 'mod log') t = modLog(t);
  t = t.replace(URL_RE, (_, scheme, authority, rest) => address(scheme, authority, rest, own));
  t = t.replace(HOST_RE, (m, before, host) => (sensitive(host, own) ? `${before}${SENSITIVE}` : m));
  t = t.replace(UUID_RE, short).replace(HEX_RE, short);
  return t;
}

/** "{when}: N cookies: x.com 12, …" → "{when}: N cookies"; "…; changed: a 3, b none" → "…; changed on 2 sites". */
function cookies(t) {
  const m = /^(.*?): (\d+) cookies(?:(: )|(; changed: ))?([\s\S]*)$/.exec(t);
  if (!m) return t;
  if (m[4]) {
    const n = m[5].split(', ').filter(Boolean).length;
    return `${m[1]}: ${m[2]} cookies; changed on ${n} site${n === 1 ? '' : 's'}`;
  }
  return `${m[1]}: ${m[2]} cookies`;
}

/** "{when}, {site}: name (domain, until …), …" → "{when}: N cookie names (not copied)". */
function cookieNames(t) {
  const none = /^(.*?): none( now)?/.exec(t);
  const n = (t.match(/\((?:[^()]*), (?:this run only|until [^)]*)\)/g) || []).length;
  if (n === 0 && none) return `${none[1].replace(/, [^,]*$/, '')}: none`;
  const when = t.split(/, [^,:]+: /)[0].replace(/:.*$/, '');
  return `${when}: ${n} cookie name${n === 1 ? '' : 's'} (not copied)`;
}

/** "added a (d, …), replaced b (…), removed c (d)" → "1 added, 1 replaced, 1 removed". */
function cookieChanges(t) {
  const count = (w) => (t.match(new RegExp(`(^|, )${w} `, 'g')) || []).length;
  return ['added', 'replaced', 'removed'].map((w) => `${count(w)} ${w}`).join(', ');
}

/** A mod's own log line (it can hold anything of the page's): who and where, its size, never its words. */
function modLog(t) {
  const m = /^(\S+) (started on|on) ([^\s/]+)(?:\/\S*?)?(?:: ([\s\S]*))?$/.exec(t);
  if (!m) return `a mod's log line of ${t.length} characters (not copied)`;
  if (m[2] === 'started on') return `${m[1]} started on ${m[3].replace(/:$/, '')}`;
  return `${m[1]} on ${m[3]}: a log line of ${(m[4] || '').length} characters (not copied)`;
}

/** Every line: [[kind, text], …] → [text, …] (one call for the whole log). */
function all(lines, own) {
  return (Array.isArray(lines) ? lines : []).map((x) => line(Array.isArray(x) ? x[0] : '', Array.isArray(x) ? x[1] : '', own));
}

module.exports = { line, all, isStandIn, cookies, cookieNames, cookieChanges, modLog, SENSITIVE };

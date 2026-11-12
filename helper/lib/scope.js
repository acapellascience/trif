'use strict';
// Side-panel agent runs are limited to one site: the "scope", the registrable domain of the page the
// chat is about (en.wikipedia.org -> wikipedia.org). Page commands from a run may only touch tabs in
// the scope (enforced by the extension, see extension/lib.js `hostInScope`), and mods a run writes
// that match pages outside it are held until the user approves them (host.js). See docs/PROTOCOL.md
// "Run scope".

// Two-label public suffixes common enough to matter (no full Public Suffix List: no dependencies).
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'com.br', 'com.mx', 'co.in', 'co.za', 'com.cn',
  'com.tw', 'com.hk', 'co.kr', 'com.sg', 'com.tr', 'com.ar', 'co.il', 'com.my', 'co.id', 'com.ph',
]);
// Hosting domains where every subdomain belongs to someone else.
const SHARED_SUFFIXES = new Set([
  'github.io', 'githubusercontent.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'blogspot.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'glitch.me',
  'substack.com', 'tumblr.com', 'wordpress.com', 'neocities.org', 'fly.dev', 'onrender.com',
]);

function cleanHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
}

/** The scope for a host or site name: "www.news.bbc.co.uk" -> "bbc.co.uk", "x.com" -> "x.com". */
function scopeFor(host) {
  const h = cleanHost(host).replace(/^www\./, '');
  if (!h || !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return h;
  const labels = h.split('.');
  const last2 = labels.slice(-2).join('.');
  const keep = MULTI_SUFFIXES.has(last2) || SHARED_SUFFIXES.has(last2) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function hostInScope(host, scope) {
  const h = cleanHost(host);
  return !!scope && (h === scope || h.endsWith('.' + scope));
}

// Whether a Chrome match pattern only matches pages in `scope` (no <all_urls>, any-host patterns, file://…).
function patternInScope(pattern, scope) {
  const m = /^(\*|https?):\/\/([^/]*)\//i.exec(String(pattern || '').trim());
  if (!m) return false;
  let host = cleanHost(m[2].replace(/:(\*|\d+)$/, ''));
  if (host.startsWith('*.')) host = host.slice(2);
  if (!host || host.includes('*')) return false;
  return hostInScope(host, scope);
}

// A sensitive host under a registrable domain (mail.google.com) is a site of its own (extension/lib.js
// "sensitive sites"): the extension sends a run the host as its scope, and the sites of their own it knows
// of (`splits`), so the run's folder is sites/mail.google.com/ and sites/google.com/ is another site's, and
// the other way round.

const cleanSite = (h) => cleanHost(h).replace(/^www\./, '');
const SITE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A list of sites of their own from a message: clean host names, each under a longer registrable domain. */
function cleanSplits(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((x) => cleanSite(x)).filter((x) => SITE_RE.test(x) && scopeFor(x) !== x && x.endsWith(`.${scopeFor(x)}`)))].slice(0, 500).sort();
}

/** The site `host` is in: the longest of `splits` it's in, else its registrable domain. */
function scopeOf(host, splits = []) {
  const h = cleanSite(host);
  let best = null;
  for (const s of splits || []) if (hostInScope(h, s) && (!best || s.length > best.length)) best = s;
  return best || scopeFor(h);
}

/**
 * A run's scope: the one the extension sent when it's the site itself or a part of it under the same
 * registrable domain (mail.google.com for inbox.mail.google.com), else the site's registrable domain.
 */
function runScope(site, asked) {
  const s = cleanSite(site);
  const a = cleanSite(asked);
  if (a && SITE_RE.test(a) && hostInScope(s, a) && scopeFor(a) === scopeFor(s) && (a === scopeFor(s) || a.endsWith(`.${scopeFor(s)}`))) return a;
  return scopeFor(s);
}

/** The mod's @match patterns that reach outside `scope` (empty: the mod stays inside it). */
function outOfScope(mod, scope) {
  const matches = Array.isArray(mod && mod.matches) ? mod.matches : [];
  return matches.filter((p) => !patternInScope(p, scope));
}

module.exports = { scopeFor, hostInScope, patternInScope, outOfScope, scopeOf, runScope, cleanSplits };

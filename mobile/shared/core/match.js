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

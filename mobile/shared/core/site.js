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

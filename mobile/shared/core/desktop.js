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

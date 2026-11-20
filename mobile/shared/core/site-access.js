// Site access on the phones (Tim, 2026-11-20: "let's opt in per site"; docs/MOBILE-BEHAVIOUR.md, Site access): every
// site starts disconnected, and TRIF does nothing on a disconnected site (no mods, none of TRIF's scripts, nothing read,
// nothing sent to a chat) until the person connects it there. Connections are per device (they never sync), like Pause
// all. Sensitive sites (TRIF's list, the desktop's: core/sensitive-default.js, made from extension/agentsites.js by
// mobile/prepare.js; plus the person's own additions) start disconnected like every site, get one more line on the
// card, and are each a site of their own (mail.google.com isn't google.com), as on desktop (extension/lib.js
// "sensitive sites, each a site of its own": sensitiveHit, the same matching). Once connected, every mod starts off
// there and a chat's free mod or change waits for the person (sensitiveAdd).
//
// Pure functions, JSON in and out. Both phone apps run this (mobile/shared/gen/core.js: TrifCore.siteAccess);
// site-access-cases.json holds the answers; mobile/test/core-siteaccess.test.js checks them.

'use strict';

const site = require('./site.js');
const DEFAULT = require('./sensitive-default.js');

/** A host as it's compared: trimmed, lower case, without a trailing dot, a port or one leading www. */
const clean = (h) => String(h == null ? '' : h).trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
const isIp = (h) => /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[');
const esc = (s) => s.replace(/[.+?^${}()|[\]\\-]/g, '\\$&');
const labelRe = (lab) => new RegExp(`^${lab.split('*').map(esc).join('[a-z0-9-]*')}$`);

/**
 * What the person typed as a sensitive site of their own, cleaned: a host (bank.example.com), or a pattern with `*`
 * inside labels (`*bank*`, `*.bank`). An address is cut to its host. '' when it isn't one.
 */
function cleanPattern(text) {
  let p = String(text == null ? '' : text).trim().toLowerCase();
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9*-]+(\.[a-z0-9*-]+)*$/.test(p)) return '';
  // (a pattern needs letters beside its stars, or a dot: `*` alone would make every site sensitive)
  if (p.replace(/[*.]/g, '').length < 2) return '';
  if (!p.includes('*') && !p.includes('.')) return '';
  return p;
}

/** The sensitive list in use: TRIF's ([pattern, why]) and then the person's own (cleaned; why ''). [{pattern, why, own}] */
function list(own) {
  const out = DEFAULT.map(([pattern, why]) => ({ pattern, why, own: false }));
  const have = new Set(out.map((x) => x.pattern));
  for (const x of Array.isArray(own) ? own : []) {
    const p = cleanPattern(typeof x === 'string' ? x : x && x.pattern);
    if (p && !have.has(p)) { have.add(p); out.push({ pattern: p, why: '', own: true }); }
  }
  return out;
}

/** Whether a sensitive pattern matches a host (agentsites.js patternMatches: a host and its subdomains; `*` in a label). */
function patternMatches(pattern, host) {
  const p = clean(pattern);
  const h = String(host || '').toLowerCase();
  if (!p || !h) return false;
  if (!p.includes('*')) return h === p || h.endsWith(`.${p}`);
  const labels = h.split('.');
  const pl = p.split('.');
  if (pl.length === 1) return labels.some((l) => labelRe(pl[0]).test(l));
  if (labels.length < pl.length) return false;
  const tail = labels.slice(labels.length - pl.length);
  return pl.every((lab, i) => labelRe(lab).test(tail[i]));
}

/**
 * The sensitive site `host` is in: {scope, why, pattern, own}, or null. `scope` is the part of the host the matching
 * pattern names (mail.google.com for inbox.mail.google.com), or its registrable domain when that's longer (paypal.com
 * for www.paypal.com; example.bank for `*.bank`); the shortest when several match (lib.js sensitiveHit).
 */
function hit(host, own) {
  const h = clean(host);
  if (!h || !h.includes('.') || isIp(h)) return null;
  const reg = site.of(h);
  let best = null;
  for (const x of list(own)) {
    if (!patternMatches(x.pattern, h)) continue;
    const p = clean(x.pattern);
    let cand = p;
    if (p.includes('*')) {
      const labels = h.split('.');
      const pl = p.split('.');
      if (pl.length === 1) {
        // (the matching label furthest right: `*bank*` on bank.mybank.example.com is mybank.example.com)
        const re = labelRe(pl[0]);
        let i = labels.length - 1;
        while (i >= 0 && !re.test(labels[i])) i--;
        cand = labels.slice(Math.max(i, 0)).join('.');
      } else cand = labels.slice(labels.length - pl.length).join('.');
    }
    if (!site.hostIsIn(cand, reg)) cand = reg;
    if (!best || cand.length < best.scope.length) best = { scope: cand, why: x.why, pattern: x.pattern, own: x.own };
  }
  return best;
}

/** The site a host is in for TRIF: its sensitive site if it's in one, else its registrable domain (site.of). */
function scope(host, own) {
  const x = hit(host, own);
  return x ? x.scope : site.of(clean(host));
}

/** Whether a site (as scope gives it) is a sensitive one. */
function isSensitive(s, own) {
  const x = hit(s, own);
  return !!x && x.scope === clean(s);
}

/** The connected sites kept: clean, each once, sorted. */
function sites(v) {
  return [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').map(clean).filter(Boolean))].sort();
}

/** Whether TRIF is connected on `host`'s site. `connected`: the sites connected on this device. */
function connected(connectedSites, host, own) {
  const s = scope(host, own);
  return !!s && sites(connectedSites).includes(s);
}

/** The list after connecting / disconnecting `host`'s site. */
function connect(connectedSites, host, own) {
  const s = scope(host, own);
  return s ? sites([...sites(connectedSites), s]) : sites(connectedSites);
}
function disconnect(connectedSites, host, own) {
  const s = scope(host, own);
  return sites(connectedSites).filter((x) => x !== s);
}

/**
 * What the robot's card (and the Mods tab) says for `host`: {site, connected, sensitive, why, own}. `why` finishes
 * "It's …" ("email", "banking"); '' for one of the person's own (the card then says it's on their list).
 */
function card(connectedSites, host, own) {
  const s = scope(host, own);
  const x = hit(host, own);
  const sensitive = !!x && x.scope === s;
  return { site: s, connected: connected(connectedSites, host, own), sensitive, why: sensitive ? x.why : '', own: sensitive ? !!x.own : false };
}

/**
 * The first start of a version with site access, on a phone that had TRIF already (Tim, 11-20, confirmed): the sites
 * with mods installed (their folders; all-sites aside) or a Home Screen icon are connected, except sensitive sites,
 * which start disconnected like everything else (their mods kept, waiting). `already`: anything connected before.
 * @returns {{connect: string[], waiting: string[]}} the list to keep, and the sensitive sites left waiting
 */
function upgrade({ modSites = [], iconSites = [], already = [], own = [] } = {}) {
  const out = new Set(sites(already));
  const waiting = new Set();
  for (const h of [...(Array.isArray(modSites) ? modSites : []), ...(Array.isArray(iconSites) ? iconSites : [])]) {
    const c = clean(h);
    if (!c || c === 'all-sites') continue;
    const s = scope(c, own);
    if (!s) continue;
    if (isSensitive(s, own)) waiting.add(s);
    else out.add(s);
  }
  return { connect: [...out].sort(), waiting: [...waiting].sort() };
}

/**
 * A mod added for a sensitive site (desktop's rules there, docs/SECURITY.md "Sensitive sites"): every mod new to this
 * phone starts off there, whoever made it; a chat's free mod waits for the person ('free'), and so does a chat's change
 * to a mod that's on ('change'): the version before keeps running meanwhile. Not for the person's own edits, nor
 * imports or the computer's (they start off already, with their own marks).
 * @param {{sensitive: boolean, isNew: boolean, source: string, tier: string, oldOn: boolean}} f
 * @returns {{off: boolean, newOff: string|null, holds: string[]}}
 */
function sensitiveAdd(f) {
  const o = f || {};
  const none = { off: false, newOff: null, holds: [] };
  if (!o.sensitive) return none;
  const byChat = ['chat', 'pasted', 'quick'].includes(o.source);
  if (o.source === 'edit' || o.source === 'import' || o.source === 'computer') return none;
  const holds = [];
  if (byChat && o.tier === 'free') holds.push('free');
  if (byChat && !o.isNew && o.oldOn) holds.push('change');
  return { off: !!o.isNew, newOff: o.isNew ? 'sensitive' : null, holds };
}

module.exports = { clean, cleanPattern, list, patternMatches, hit, scope, isSensitive, sites, connected, connect, disconnect, card, upgrade, sensitiveAdd };

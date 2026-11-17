'use strict';
// A mod's text read as TRIF would read it, without writing anything: for the cards that come before an import
// (a mod file in the user's Downloads, lib/downloads.js; a pasted mod) and for "Try it here" (background.js
// tryMod), which runs a style or boxed mod once in one tab with TRIF's own runtime.
//
// What the card shows comes from the code (powers.js, boxpowers.js), never from what the header claims: the
// facts a hold would list. A free mod is never tried: it would run in the page's own world, with everything
// the page has; a style mod is TRIF's code with the rules as data, and a boxed mod runs in TRIF's sandbox, here
// with no powers at all, whatever its header asks for.

const path = require('path');
const mods = require('./mods');

const SITE_RE = /^(?:all-sites|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/;
const hostOfMatch = (m) => {
  if (m === '<all_urls>') return '*';
  const x = /^(?:\*|https?|file|ftp):\/\/([^/]+)\//.exec(String(m));
  return x ? x[1].toLowerCase().replace(/^\*\./, '').replace(/^www\./, '') : null;
};
const nameOf = (s) => String(s || '').toLowerCase().replace(/\.js$/i, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

class PreviewError extends Error {}

/** The one site a mod's @match lines name, or null (share.js sitesOf: the import asks the user then). */
function siteOf(header) {
  const hosts = [...new Set(header.matches.map(hostOfMatch).filter(Boolean))];
  if (hosts.includes('*')) return null;
  const ok = hosts.filter((x) => SITE_RE.test(x));
  return ok.length === 1 ? ok[0] : null;
}

/**
 * {kind: 'style'|'boxed'|'free', name, description, site, matches, excludes, can: [what TRIF found it can do],
 * asks: [the powers its header asks for], run?: {id, kind, code, style, matches, excludes}} — `run` only with
 * `forTry`, and only for a style or boxed mod: what "Try it here" runs, built as TRIF builds the mod, with no
 * powers. Throws a PreviewError when TRIF couldn't import it.
 */
function previewMod(text, { name = '', site: siteOpt = '', forTry = false } = {}) {
  const code = String(text ?? '');
  if (!code.trim()) throw new PreviewError('it\'s empty');
  if (Buffer.byteLength(code) > mods.MAX_MOD_BYTES) throw new PreviewError(`it's bigger than a mod can be (${mods.MAX_MOD_BYTES / 1024 / 1024} MB)`);
  const header = mods.parseHeader(code);
  if (!header.hasHeader) throw new PreviewError('it has no // ==WebMod== header, so it isn\'t a mod TRIF can read');
  const site = (siteOpt && SITE_RE.test(String(siteOpt).toLowerCase()) ? String(siteOpt).toLowerCase().replace(/^www\./, '') : null) || siteOf(header);
  const base = nameOf(name) || nameOf(header.name) || 'imported-mod';
  // (built under a name of its own: a trial's errors, styles and settings are never the mod's, nor any mod's)
  let built;
  try { built = mods.buildMod({ site: site || 'all-sites', file: path.join(path.sep, 'trif-preview', site || 'all-sites', `~try-${base}.js`), code }).mod; } catch (e) {
    throw new PreviewError(`its header has a problem: ${e.message}`);
  }
  const kind = built.rules ? 'style' : built.sandboxed ? 'boxed' : 'free';
  let can = [];
  if (kind === 'boxed') {
    const bp = require('./boxpowers');
    can = bp.powerNeeds({ site: site || '', powers: built.powers || [], powerArgs: built.powerArgs || {} }).filter((n) => !n.soft).map((n) => n.fact);
  } else if (kind === 'free') {
    const { powersOf, modSites } = require('./powers');
    can = powersOf(built.code || '', { sites: modSites({ id: `${site || 'all-sites'}/${base}`, matches: header.matches }) }).map((p) => p.fact);
  }
  const out = {
    kind, name: header.name || base, file: `${base}.js`, description: header.description || '', site,
    matches: built.matches, excludes: built.excludes, can: [...new Set(can)].slice(0, 12), asks: built.powers || [],
  };
  if (forTry && kind !== 'free') {
    out.run = { id: built.id, kind, code: built.code, matches: built.matches, excludes: built.excludes, ...(built.style ? { style: { css: built.style.css, values: built.style.values } } : {}) };
  }
  return out;
}

module.exports = { previewMod, PreviewError, siteOf, nameOf };

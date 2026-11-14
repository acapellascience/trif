'use strict';
// "Hide this" (the browser's right-click menu, extension/hidethis.js): what the user hides on a site is ONE
// style mod there, sites/<site>/hidden.js, named "Hidden on <site>", with one selector in its `hide` list per
// thing hidden, appended over time. The bar's Wider, All N like it and Undo edit that list (hide.add with
// `replace`, hide.remove). A style mod is data that TRIF's own code runs (lib/rules.js), so it never waits for
// the user's OK (held.js powersFor); the extension switches it on as the user's own doing (background.js).
//
// The file stays an ordinary style mod: the user or an agent may edit it (add CSS, reword it); what's there
// is kept, only `hide` changes. A selector that would hide the whole page (html, body, :root) is refused, as
// is one the style mod checks refuse (rules.js checkSelector).

const fs = require('fs');
const path = require('path');
const rules = require('./rules');
const mods = require('./mods');

class HiddenError extends Error {}

const FILE = 'hidden.js';
const MOD = 'hidden';
// (a host name, a single label too, as lib/share.js takes a site)
const SITE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

function checkSite(site) {
  const s = String(site || '').trim().toLowerCase().replace(/^www\./, '');
  if (!SITE_RE.test(s) || s === 'all-sites') throw new HiddenError(`"${String(site).slice(0, 80)}" isn't a site (a host name like x.com)`);
  return s;
}

/** Whether a selector's last part is the whole page: html, body or :root (with nothing more specific). */
function wholePage(sel) {
  const last = String(sel).trim().split(/\s*[>+~\s]\s*/).filter(Boolean).pop() || '';
  return /^(?:html|body|:root)(?::nth-of-type\(1\)|:first-child|:last-child|:only-child)?$/i.test(last);
}

function checkHideSelector(selector) {
  const sel = typeof selector === 'string' ? selector.trim() : '';
  const p = rules.checkSelector(sel);
  if (p) throw new HiddenError(`can't hide that: ${p}`);
  if (wholePage(sel)) throw new HiddenError('can\'t hide the whole page (html or body)');
  return sel;
}

const header = (site) => [
  '// ==WebMod==',
  `// @name        Hidden on ${site}`,
  `// @match       *://${site}/*`,
  `// @match       *://*.${site}/*`,
  '// @style',
  '// ==/WebMod==',
].join('\n');

/** The file's header (as written) and its rules object (as written, not normalized), or a new one's. */
function read(file, site) {
  if (!fs.existsSync(file)) return { head: header(site), spec: { hide: [] }, existed: false };
  const text = fs.readFileSync(file, 'utf8');
  const h = mods.parseHeader(text);
  if (!h.hasHeader || !h.rules) throw new HiddenError(`sites/${site}/${FILE} is there and isn't a style mod, so TRIF won't change it`);
  const end = text.search(/^\s*\/\/\s*==\/WebMod==\s*$/m);
  const nl = text.indexOf('\n', end);
  const head = (nl === -1 ? text : text.slice(0, nl)).replace(/\s+$/, '');
  const body = (nl === -1 ? '' : text.slice(nl + 1)).replace(/^\s*\/\/.*$/gm, '').trim().replace(/^\(([\s\S]*)\)\s*;?$/, '$1').trim();
  let spec = {};
  if (body) {
    try { spec = JSON.parse(body); } catch (e) { throw new HiddenError(`sites/${site}/${FILE} has rules that aren't valid JSON (${e.message}); fix or delete it first`); }
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new HiddenError(`sites/${site}/${FILE}'s rules aren't a JSON object`);
  if (spec.hide !== undefined && !Array.isArray(spec.hide)) throw new HiddenError(`sites/${site}/${FILE}'s "hide" isn't a list`);
  return { head, spec: { ...spec, hide: [...(spec.hide || [])] }, existed: true };
}

function write(file, head, spec) {
  rules.checkRules(spec); // (throws: never a file the scanner would refuse)
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${head}\n${JSON.stringify(spec, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const hasOther = (spec) => Object.entries(spec).some(([k, v]) => k !== 'hide' && (Array.isArray(v) ? v.length : typeof v === 'string' ? v.trim() : v != null));

const result = (site, file, spec, extra) => ({ id: `${site}/${MOD}`, site, name: `Hidden on ${site}`, file, hide: spec ? spec.hide : [], ...extra });

/**
 * Hide `selector` on `site`: appended to the site's hidden mod (made if it isn't there). `replace`: a selector
 * of the list it takes the place of (the bar's Wider and All N like it), in one write. Returns
 * {id, site, name, file, hide, created, added}.
 */
function hideAdd(ws, { site, selector, replace = '' } = {}) {
  const s = checkSite(site);
  const sel = checkHideSelector(selector);
  const file = path.join(ws.modsDir, s, FILE);
  const { head, spec, existed } = read(file, s);
  const old = typeof replace === 'string' ? replace.trim() : '';
  const added = !spec.hide.includes(sel);
  const list = [...spec.hide];
  const at = old && old !== sel ? list.indexOf(old) : -1;
  if (at !== -1) list.splice(at, 1, sel); else list.push(sel);
  const next = { ...spec, hide: list.filter((x, i, a) => a.indexOf(x) === i) };
  if (JSON.stringify(next.hide) !== JSON.stringify(spec.hide) || !existed) write(file, head, next);
  return result(s, file, next, { created: !existed, added });
}

/**
 * Show `selector` on `site` again: taken out of the hidden mod's list. A mod left with nothing in it (no
 * other rules either) is removed, so Undo after the first Hide this leaves nothing behind. Returns
 * {id, site, name, file, hide, removed, deleted}.
 */
function hideRemove(ws, { site, selector } = {}) {
  const s = checkSite(site);
  const sel = typeof selector === 'string' ? selector.trim() : '';
  if (!sel) throw new HiddenError('missing selector');
  const file = path.join(ws.modsDir, s, FILE);
  if (!fs.existsSync(file)) return result(s, file, null, { removed: false, deleted: false });
  const { head, spec } = read(file, s);
  if (!spec.hide.includes(sel)) return result(s, file, spec, { removed: false, deleted: false });
  const next = { ...spec, hide: spec.hide.filter((x) => x !== sel) };
  if (!next.hide.length && !hasOther(next)) {
    fs.unlinkSync(file);
    return result(s, file, next, { removed: true, deleted: true });
  }
  write(file, head, next);
  return result(s, file, next, { removed: true, deleted: false });
}

module.exports = { hideAdd, hideRemove, wholePage, checkHideSelector, HiddenError, HIDDEN_FILE: FILE, HIDDEN_MOD: MOD };

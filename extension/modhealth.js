// Mods that break: their errors, as fingerprints, and mods whose selectors stop matching (background.js
// checkTab gathers both from a page; the panel shows them; docs/MOD-HEALTH-STRINGS.md).
//
// An error's fingerprint is the mod, the line in the mod's file, and the message with its numbers and quoted
// parts taken out, so the same failure on another item or another load is the same error. Per mod and per
// version (the mod's hash: a fixed or updated mod starts fresh), TRIF keeps the fingerprints it has seen
// and the ones the user dismissed; one it hasn't seen is new. A mod whose selectors (a style mod's rules, the
// boxed mod's trif.observe and trif.hide, a free mod's trif.expect) matched on a page, then matched nothing on
// QUIET_LOADS loads of that page in a row, is flagged "may be broken", as a fingerprint of its own. A mod that
// only hides things (hideOnly: a style mod whose rules all hide, rules.js hidesOnly; a boxed mod that only
// calls trif.hide) is flagged only after HIDE_QUIET_LOADS loads in a row over HIDE_QUIET_DAYS days: what it
// hides is often something a site shows only sometimes (a promo, a banner), and nothing is wrong meanwhile.
// The evidence a page is one of the mod's: what it looks for found there on MATCH_LOADS loads, each at its
// settled look (background.js checkTab, loadVerdicts), on the page shown (not a single-page site's other pages
// kept in it hidden); only then can that page be flagged. (Before 11-20 a page was the mod's after one match
// on any look; dropWeakEvidence clears what such weak evidence left.)
// A page where what the mod looks for went away and came back (a streak of QUIET_STREAK loads or more with
// nothing, or a flag, then a match) "comes and goes" there: no flag on that page again for that version. So
// does one a fix run found nothing broken on (markNotBroken: `trif not-broken`).
//
// Pure functions over a plain object kept in chrome.storage.local `modHealth`:
//   { [modId]: { hash, errors: { [fp]: {message, stack, line, count, first, last, quiet?, page?} },
//                dismissed: { [fp]: true }, carded: { [fp]: true }, fixed: { [fp]: true },
//                pages: { [page]: { matched: bool, hits?, misses: n, at, since?, comesAndGoes? } }, logs: [..] } }
// (hits: the loads it was found on, up to MATCH_LOADS; since: when the current streak of loads with nothing began)

export const QUIET_LOADS = 3;
export const MATCH_LOADS = 2;
export const HIDE_QUIET_LOADS = 10;
export const HIDE_QUIET_DAYS = 3;
const QUIET_STREAK = 2; // (one load with nothing is often a page still building: two, then a match, is a pattern)
const DAY = 24 * 60 * 60 * 1000;
const MAX_FP = 30; // fingerprints kept per mod
const MAX_PAGES = 40; // pages kept per mod
const MAX_MODS = 300;

/** The message, without what changes from one occurrence to the next: numbers and quoted parts. */
export function normalizeMessage(message) {
  return String(message ?? '')
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '…')
    .replace(/\b0x[0-9a-f]+\b/gi, '#')
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * The line in the mod's file an error comes from, from its stack: a page script's frame is
 * `trif://<id>.js:<line>` (its wrapper puts the file's first line on line 2: lib.js wrapModCode); a boxed
 * mod's names it the same way, on the file's own lines (sandbox.js). 0 when there's none.
 */
export function errorLine(err, modId) {
  const stack = String(err?.stack ?? '');
  const id = String(modId || err?.mod || '');
  // (as the script is named: lib.js wrapModCode, sandbox.js scriptName)
  const esc = id.replace(/[^\w.\-/]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:trif|webmods|trif-box)[a-z-]*://${esc}\\.js:(\\d+)(?::\\d+)?`, 'i');
  const m = re.exec(stack);
  if (!m) return 0;
  const n = Number(m[1]);
  return err?.sandboxed ? n : Math.max(1, n - 1);
}

export function fingerprint(err, modId) {
  const id = String(modId || err?.mod || '');
  return `${id}|${errorLine(err, id)}|${normalizeMessage(err?.message)}`;
}

const entryFor = (health, mod) => {
  let e = health[mod.id];
  if (!e || e.hash !== mod.hash) e = health[mod.id] = { hash: mod.hash, errors: {}, dismissed: {}, carded: {}, fixed: {}, pages: {}, logs: [] };
  for (const k of ['errors', 'dismissed', 'carded', 'fixed', 'pages']) if (!e[k] || typeof e[k] !== 'object') e[k] = {};
  if (!Array.isArray(e.logs)) e.logs = [];
  return e;
};

const trim = (obj, max, by) => {
  const keys = Object.keys(obj);
  if (keys.length <= max) return;
  keys.sort((a, b) => by(obj[a]) - by(obj[b])).slice(0, keys.length - max).forEach((k) => delete obj[k]);
};

/**
 * Takes a page's mod errors (`trif errors`' entries: {mod, message, stack, time, sandboxed?}) for the mods
 * `mods` (id -> {id, hash}). Returns the errors that are new (not seen before for that version):
 * [{mod, fp, message, stack, line}].
 */
export function recordErrors(health, mods, errors, now = Date.now()) {
  const fresh = [];
  for (const err of errors || []) {
    const mod = mods.get(String(err?.mod || ''));
    if (!mod) continue;
    const e = entryFor(health, mod);
    const fp = fingerprint(err, mod.id);
    const had = e.errors[fp];
    if (had) { had.count = (had.count || 1) + 1; had.last = now; continue; }
    // (clickjack: a click TRIF's guard stopped, runtime.js clickGuard; not the mod's error, though kept as one)
    const cj = err?.kind === 'clickjack' ? { clickjack: true } : {};
    e.errors[fp] = { message: String(err.message ?? '').slice(0, 2000), stack: String(err.stack ?? '').slice(0, 4000), line: errorLine(err, mod.id), count: 1, first: now, last: now, ...cj };
    trim(e.errors, MAX_FP, (x) => x.last || 0);
    fresh.push({ mod: mod.id, fp, message: e.errors[fp].message, stack: e.errors[fp].stack, line: e.errors[fp].line, ...cj });
  }
  trim(health, MAX_MODS, (x) => Math.max(0, ...Object.values(x?.errors || {}).map((y) => y.last || 0)));
  return fresh;
}

const quietFp = (modId, page) => `${modId}|quiet|${page}`;

/**
 * One load's verdicts for "may be broken" (background.js checkTab): `earlier`, modId -> whether an earlier
 * look of the load found what the mod looks for (the 3-second one, the panel's); `settled`, the same for its
 * settled look (9 s on). Returns [[modId, found]]: found only if the settled look found it (an earlier look
 * may have seen the page changing over: the address already the next page's, the last one still shown);
 * not found only if no look did (found earlier and not now: neither, it may be something that comes and goes).
 */
export function loadVerdicts(earlier, settled) {
  const out = [];
  for (const [id, ok] of settled) { if (ok) out.push([id, true]); else if (!earlier.get(id)) out.push([id, false]); }
  return out;
}

/**
 * One load of `page` (an address without its query) for a mod with selectors: did any of them match?
 * Returns the "may be broken" flag when this load makes QUIET_LOADS in a row with nothing (a hide-only mod:
 * HIDE_QUIET_LOADS, over HIDE_QUIET_DAYS days), on a page where the mod matched before and that doesn't
 * come and go, else null. A match clears the count and the flag; after a streak with nothing (or a flag)
 * it marks the page as one where what the mod looks for comes and goes.
 */
export function recordMatches(health, mod, page, matched, now = Date.now(), { hideOnly = false } = {}) {
  const e = entryFor(health, mod);
  const p = e.pages[page] || (e.pages[page] = { matched: false, misses: 0 });
  p.at = now;
  const fp = quietFp(mod.id, page);
  trim(e.pages, MAX_PAGES, (x) => x.at || 0);
  if (matched) {
    if (p.matched && ((p.misses || 0) >= QUIET_STREAK || e.errors[fp])) p.comesAndGoes = true;
    p.matched = true;
    p.hits = Math.min(MATCH_LOADS, (p.hits || 0) + 1);
    p.misses = 0;
    delete p.since;
    delete e.errors[fp];
    return null;
  }
  if (!p.matched) return null; // (never matched here: not this mod's page, or not yet)
  p.misses = (p.misses || 0) + 1;
  if (p.since === undefined) p.since = now;
  if (p.comesAndGoes || e.errors[fp] || (p.hits || 0) < MATCH_LOADS) return null; // (found here once: not yet its page)
  const enough = hideOnly ? p.misses >= HIDE_QUIET_LOADS && now - p.since >= HIDE_QUIET_DAYS * DAY : p.misses >= QUIET_LOADS;
  if (!enough) return null;
  e.errors[fp] = { message: 'nothing it looks for is on the page any more', stack: '', line: 0, count: 1, first: now, last: now, quiet: true, page };
  return { mod: mod.id, fp, message: e.errors[fp].message, stack: '', line: 0, quiet: true, page };
}

/**
 * What was kept with weaker evidence than MATCH_LOADS settled loads, as everything before 11-20 was (one match
 * on any look made a page the mod's: on a single-page site often a look at another page, or at a piece of a
 * selector split inside its :is()), goes: a page's record without `hits` (unless it comes and goes: that's a
 * user's or a fix run's word), and a "may be broken" flag on a page without the evidence, with its card's mark
 * and its Ignore, so a flag with real evidence later is a new one. Returns the flags that went: [{mod, fp}].
 * (background.js, on start)
 */
export function dropWeakEvidence(health) {
  const gone = [];
  for (const [mod, e] of Object.entries(health || {})) {
    if (!e || typeof e !== 'object') continue;
    for (const [pg, p] of Object.entries(e.pages && typeof e.pages === 'object' ? e.pages : {})) if (!p || (p.hits === undefined && !p.comesAndGoes)) delete e.pages[pg];
    for (const [fp, x] of Object.entries(e.errors && typeof e.errors === 'object' ? e.errors : {})) {
      if (!x?.quiet || (e.pages?.[x.page]?.hits || 0) >= MATCH_LOADS) continue;
      delete e.errors[fp];
      for (const k of ['carded', 'dismissed', 'fixed']) if (e[k] && typeof e[k] === 'object') delete e[k][fp];
      gone.push({ mod, fp });
    }
  }
  return gone;
}

/**
 * Not broken (a fix run's conclusion, `trif not-broken`): what the mod looks for comes and goes on `page`
 * (or, without one, on every page it's flagged on), so no "may be broken" there again for this version, and
 * the flag goes. Returns the flags' fingerprints (a page's, flagged or not).
 */
export function markNotBroken(health, mod, page = null, now = Date.now()) {
  const e = entryFor(health, mod);
  const prefix = quietFp(mod.id, '');
  const pages = page ? [page] : Object.keys(e.errors).filter((fp) => fp.startsWith(prefix) && e.errors[fp]?.quiet).map((fp) => fp.slice(prefix.length));
  for (const pg of pages) {
    const p = e.pages[pg] || (e.pages[pg] = { matched: true, misses: 0 });
    p.comesAndGoes = true;
    p.at = now;
    delete e.errors[quietFp(mod.id, pg)];
  }
  trim(e.pages, MAX_PAGES, (x) => x.at || 0);
  return pages.map((pg) => quietFp(mod.id, pg));
}

/** A mod's errors the user hasn't dismissed, newest first: [{fp, message, line, count, quiet?}]. */
export function openErrors(health, mod) {
  const e = health[mod.id];
  if (!e || e.hash !== mod.hash) return [];
  return Object.entries(e.errors || {}).filter(([fp]) => !e.dismissed?.[fp])
    .map(([fp, x]) => ({ fp, message: x.message, line: x.line || 0, count: x.count || 1, ...(x.quiet ? { quiet: true, page: x.page } : {}), ...(x.clickjack ? { clickjack: true } : {}), last: x.last || 0 }))
    .sort((a, b) => b.last - a.last);
}

/** Ignore: that fingerprint, for this version of the mod. */
export function dismiss(health, mod, fp) {
  const e = entryFor(health, mod);
  e.dismissed[fp] = true;
  return health;
}

/** A mod's recent logs (kept to give a fix run context). */
export function keepLogs(health, mod, logs) {
  if (!logs?.length) return;
  const e = entryFor(health, mod);
  e.logs = [...e.logs, ...logs.map((l) => ({ level: l.level, text: (Array.isArray(l.args) ? l.args.join(' ') : String(l.text ?? '')).slice(0, 500), time: l.time || 0 }))].slice(-15);
}

/** What a fix run is asked, with the mod's error (or "may be broken" flag), its stack and its recent logs. */
export function fixPrompt({ mod, name, site, url, error, logs }) {
  const file = `sites/${mod}.js`;
  const lines = [];
  if (error.quiet) {
    lines.push(`TRIF thinks my mod "${name}" (${mod}, the file ${file}) may be broken on ${url || site}: nothing it looks for is on the page any more, though it was on earlier loads.`);
    lines.push('The site has probably changed how this part of the page is built. Look at the page as it is now (trif text, trif screenshot, trif sweep), find what the mod should act on, and update the mod so it works again, doing the same thing as before.');
    // (the page the flag is for, as TRIF keys it: the address without its query)
    const page = String(error.page || url || '').split(/[?#]/)[0];
    lines.push(`If nothing is broken (the mod still fits how the site builds that part, and the site just didn't show it this time: some parts of a page, like promos, come and go), don't change the mod. Run \`trif not-broken ${mod}${/^https?:\/\//.test(page) ? ` ${page}` : ''}\` so TRIF stops flagging it there, and tell me what you found.`);
  } else {
    lines.push(`My mod "${name}" (${mod}, the file ${file}) has a new error on ${url || site}${error.line ? `, at line ${error.line}` : ''}:`);
    lines.push('', '```', String(error.message || '').slice(0, 1000));
    const stack = String(error.stack || '').split('\n').slice(0, 12).join('\n');
    if (stack && !stack.startsWith(String(error.message))) lines.push(stack);
    else if (stack) lines.push(stack.split('\n').slice(1).join('\n'));
    lines.push('```');
    lines.push('', 'Fix the mod so it works with the page as it is now, doing the same thing as before. Look at the page first (trif text, trif screenshot) if that helps you see what changed.');
  }
  const recent = (logs || []).slice(-8);
  if (recent.length) lines.push('', 'Its recent logs:', ...recent.map((l) => `- ${l.level}: ${l.text}`));
  return lines.join('\n');
}

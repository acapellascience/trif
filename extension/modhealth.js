// Mods that break: their errors, as fingerprints, and mods whose selectors stop matching (background.js
// checkTab gathers both from a page; the panel shows them; docs/MOD-HEALTH-STRINGS.md).
//
// An error's fingerprint is the mod, the line in the mod's file, and the message with its numbers and quoted
// parts taken out, so the same failure on another item or another load is the same error. Per mod and per
// version (the mod's hash: a fixed or updated mod starts fresh), TRIF keeps the fingerprints it has seen
// and the ones the user dismissed; one it hasn't seen is new. A mod whose selectors (a style mod's rules, the
// boxed mod's trif.observe and trif.hide, a free mod's trif.expect) matched on a page, then matched nothing on
// QUIET_LOADS loads of that page in a row, is flagged "may be broken", as a fingerprint of its own.
//
// Pure functions over a plain object kept in chrome.storage.local `modHealth`:
//   { [modId]: { hash, errors: { [fp]: {message, stack, line, count, first, last, quiet?, page?} },
//                dismissed: { [fp]: true }, carded: { [fp]: true }, fixed: { [fp]: true },
//                pages: { [page]: { matched: bool, misses: n } }, logs: [..] } }

export const QUIET_LOADS = 3;
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
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    e.errors[fp] = { message: String(err.message ?? '').slice(0, 2000), stack: String(err.stack ?? '').slice(0, 4000), line: errorLine(err, mod.id), count: 1, first: now, last: now };
    trim(e.errors, MAX_FP, (x) => x.last || 0);
    fresh.push({ mod: mod.id, fp, message: e.errors[fp].message, stack: e.errors[fp].stack, line: e.errors[fp].line });
  }
  trim(health, MAX_MODS, (x) => Math.max(0, ...Object.values(x?.errors || {}).map((y) => y.last || 0)));
  return fresh;
}

/**
 * One load of `page` (an address without its query) for a mod with selectors: did any of them match?
 * Returns the "may be broken" flag when this load makes QUIET_LOADS in a row with nothing, on a page where
 * the mod matched before, else null. A match clears the count (and the flag, if it was up).
 */
export function recordMatches(health, mod, page, matched, now = Date.now()) {
  const e = entryFor(health, mod);
  const p = e.pages[page] || (e.pages[page] = { matched: false, misses: 0 });
  p.at = now;
  const fp = `${mod.id}|quiet|${page}`;
  trim(e.pages, MAX_PAGES, (x) => x.at || 0);
  if (matched) {
    p.matched = true;
    p.misses = 0;
    delete e.errors[fp];
    return null;
  }
  if (!p.matched) return null; // (never matched here: not this mod's page, or not yet)
  p.misses += 1;
  if (p.misses !== QUIET_LOADS || e.errors[fp]) return null;
  e.errors[fp] = { message: 'nothing it looks for is on the page any more', stack: '', line: 0, count: 1, first: now, last: now, quiet: true, page };
  return { mod: mod.id, fp, message: e.errors[fp].message, stack: '', line: 0, quiet: true, page };
}

/** A mod's errors the user hasn't dismissed, newest first: [{fp, message, line, count, quiet?}]. */
export function openErrors(health, mod) {
  const e = health[mod.id];
  if (!e || e.hash !== mod.hash) return [];
  return Object.entries(e.errors || {}).filter(([fp]) => !e.dismissed?.[fp])
    .map(([fp, x]) => ({ fp, message: x.message, line: x.line || 0, count: x.count || 1, ...(x.quiet ? { quiet: true, page: x.page } : {}), last: x.last || 0 }))
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

// A chat's changes to a mod as edit blocks, not the whole file again (Tim, 11-19: "an editing protocol? so they could
// just change the necessary lines and then we parse that on the app side"); and a whole file a chat shortened with
// "// rest unchanged" caught before it replaces the mod (docs/MOBILE-BEHAVIOUR.md, Chat offers). Both phone apps
// run this (mobile/shared/gen/core.js: TrifCore.modEdit). No words people see: each app has its own.
//
// The format (the prompt shows it; the coding tools' SEARCH/REPLACE blocks, which models already write reliably),
// inside a code block, one header line naming the mod's file and the version the chat saw, then the blocks:
//
//     TRIF edit youtube.com/calmer-feed 3f9a1c2b
//     <<<<<<< SEARCH
//     lines exactly as they are in the mod now
//     =======
//     the lines that replace them
//     >>>>>>> REPLACE
//
// A block applies only where its SEARCH lines appear exactly once: exactly first, else ignoring whitespace (line
// ends, trailing spaces, indentation, runs of spaces). The blocks apply in order, each to the text the ones before it
// made. Inserting is a replace that keeps its anchor; deleting is an empty replacement. If the version isn't the mod's
// now, or any block doesn't match exactly once, nothing is applied.

'use strict';

// (the markers: 5 to 9 of the character, as the tools accept; the words are what make them markers)
const OPEN = /^\s*<{5,9}\s*SEARCH\s*$/i;
const MID = /^\s*={5,9}\s*$/;
const CLOSE = /^\s*>{5,9}\s*REPLACE\s*$/i;
// (the header: "TRIF edit <file> <version>"; a comment's // or #, backticks, a colon, "version"/"v"/"@" tolerated)
const HEAD = /^\s*(?:\/\/|#|\/\*)?\s*`?\s*TRIF[ \t]+edit\b\s*:?\s*`?([^\s`]+?)`?\s+(?:version\s*:?\s*|v(?=[0-9a-f]{8}\b)|@)?`?([0-9a-f]{8})`?\s*(?:\*\/)?\s*$/i;
// (a file named with no version: said as "no version", never guessed)
const HEAD_BARE = /^\s*(?:\/\/|#|\/\*)?\s*`?\s*TRIF[ \t]+edit\b\s*:?\s*`?([^\s`]+?)`?\s*(?:\*\/)?\s*$/i;

/** Lines, whatever their ends (\r\n, \r, \n). */
const linesOf = (t) => String(t ?? '').split(/\r\n|\r|\n/);

/**
 * The version tag the prompt gives with a mod's code: FNV-1a (32 bits) over its UTF-8, line ends evened out to \n,
 * as 8 hex digits. The same text on either phone gives the same tag.
 * @param {string} code
 * @returns {string}
 */
function version(code) {
  const t = String(code ?? '').replace(/\r\n?/g, '\n');
  let h = 0x811c9dc5;
  const add = (b) => { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; };
  for (let i = 0; i < t.length; i++) {
    let c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) {
      const d = t.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) add(c);
    else if (c < 0x800) { add(0xc0 | (c >> 6)); add(0x80 | (c & 63)); }
    else if (c < 0x10000) { add(0xe0 | (c >> 12)); add(0x80 | ((c >> 6) & 63)); add(0x80 | (c & 63)); }
    else { add(0xf0 | (c >> 18)); add(0x80 | ((c >> 12) & 63)); add(0x80 | ((c >> 6) & 63)); add(0x80 | (c & 63)); }
  }
  return h.toString(16).padStart(8, '0');
}

/** Whether a text has edit blocks in it at all (a SEARCH marker and a REPLACE marker, each on a line of its own). */
function has(text) {
  const ls = linesOf(text);
  return ls.some((l) => OPEN.test(l)) && ls.some((l) => CLOSE.test(l));
}

/**
 * A chat's text → its edits, by the file and version each header names, in order; null when it has no edit blocks
 * (then it's read as a whole mod, as ever).
 * `edits`: [{file, version, blocks: [{search, replace}]}] (search and replace as lines). Blocks before any header
 * belong to the text's one header, if it has only one; else to a file of null. A header with no version gives a
 * version of null. `problems`: what couldn't be read ("unclosed": a block with no REPLACE, "nomid": one with no
 * =======, "empty": one with nothing to search for).
 * @param {string} text
 */
function parse(text) {
  if (!has(text)) return null;
  const ls = linesOf(text);
  const heads = [];
  for (const l of ls) {
    const m = HEAD.exec(l);
    if (m) { heads.push({ file: m[1], version: m[2].toLowerCase() }); continue; }
    const b = HEAD_BARE.exec(l);
    if (b) heads.push({ file: b[1], version: null });
  }
  const distinct = [...new Set(heads.map((h) => `${h.file} ${h.version}`))];
  const lone = distinct.length === 1 ? heads[0] : null;
  const edits = [];
  const problems = [];
  let cur = null; // the header in force
  const group = (h) => {
    const key = h ? `${h.file} ${h.version}` : null;
    let e = edits.length ? edits[edits.length - 1] : null;
    if (!e || e.key !== key) { e = { key, file: h ? h.file : null, version: h ? h.version : null, blocks: [] }; edits.push(e); }
    return e;
  };
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const m = HEAD.exec(l) || HEAD_BARE.exec(l);
    if (m) { cur = { file: m[1], version: m[2] ? m[2].toLowerCase() : null }; continue; }
    if (!OPEN.test(l)) continue;
    const search = [], replace = [];
    let part = search, mid = false, closed = false;
    for (i++; i < ls.length; i++) {
      const x = ls[i];
      if (CLOSE.test(x)) { closed = true; break; }
      if (!mid && MID.test(x)) { mid = true; part = replace; continue; }
      if (OPEN.test(x)) { i--; break; } // (a block left open: the next one starts)
      part.push(x);
    }
    if (!closed) { problems.push('unclosed'); continue; }
    if (!mid) { problems.push('nomid'); continue; }
    if (!search.some((s) => s.trim())) { problems.push('empty'); continue; }
    group(cur || lone).blocks.push({ search, replace });
  }
  return { edits: edits.filter((e) => e.blocks.length).map(({ file, version: v, blocks }) => ({ file, version: v, blocks })), problems };
}

// (a line as the whitespace-tolerant match compares it)
const loose = (s) => s.replace(/\s+/g, ' ').trim();
const lead = (s) => /^[ \t]*/.exec(s)[0];

/** Where `want` (lines) is in `have` (lines): every start index, compared by `same`. Blank lines at either end of
 *  `want` don't count (a chat's block often has an extra one). */
function places(have, want, same) {
  const out = [];
  for (let i = 0; i + want.length <= have.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) if (!same(have[i + k], want[k])) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}
const trimEnds = (ls) => { let a = 0, z = ls.length; while (a < z && !ls[a].trim()) a++; while (z > a && !ls[z - 1].trim()) z--; return [a, z]; };

/**
 * One block applied to lines: {ok, lines, at, removed, added, loose} or {ok: false, why: 'nomatch'|'many', count}.
 * Exactly first (all its lines, then without blank end lines); else ignoring whitespace, where the replacement's
 * lines get the indentation the mod's lines have more than the block's (a block quoted less indented).
 */
function applyBlock(lines, block) {
  const exact = (a, b) => a === b;
  const tries = [];
  tries.push([block.search, block.replace, false]);
  const [a, z] = trimEnds(block.search);
  if (a > 0 || z < block.search.length) {
    const [ra, rz] = trimEnds(block.replace);
    tries.push([block.search.slice(a, z), block.replace.slice(ra, rz), false]);
  }
  for (const [search, replace] of tries) {
    const at = places(lines, search, exact);
    if (at.length > 1) return { ok: false, why: 'many', count: at.length };
    if (at.length === 1) return put(lines, at[0], search.length, replace, '', false);
  }
  // (ignoring whitespace: the block without its blank end lines)
  const [search, replace] = tries[tries.length - 1];
  const at = places(lines, search, (x, y) => loose(x) === loose(y));
  if (at.length > 1) return { ok: false, why: 'many', count: at.length };
  if (at.length === 0) return { ok: false, why: 'nomatch', count: 0 };
  // (the indentation the mod's lines have beyond the block's, the same on every non-blank line: added to the replacement)
  let extra = null;
  for (let k = 0; k < search.length; k++) {
    if (!search[k].trim()) continue;
    const have = lead(lines[at[0] + k]), want = lead(search[k]);
    const d = have.endsWith(want) ? have.slice(0, have.length - want.length) : null;
    if (extra === null) extra = d;
    else if (d !== extra) { extra = ''; break; }
  }
  return put(lines, at[0], search.length, replace, extra || '', true);
}
function put(lines, at, n, replace, indent, wasLoose) {
  const added = replace.map((l) => (indent && l.trim() ? indent + l : l));
  const removed = lines.slice(at, at + n);
  return { ok: true, lines: [...lines.slice(0, at), ...added, ...lines.slice(at + n)], at, removed, added, loose: wasLoose };
}

/** A change made compact for the review: the lines that differ, with one unchanged line above and below. */
function compact(c) {
  let a = 0;
  while (a < c.removed.length && a < c.added.length && c.removed[a] === c.added[a]) a++;
  let z = 0;
  while (z < c.removed.length - a && z < c.added.length - a && c.removed[c.removed.length - 1 - z] === c.added[c.added.length - 1 - z]) z++;
  return {
    line: c.at + a + 1,
    removed: c.removed.slice(a, c.removed.length - z),
    added: c.added.slice(a, c.added.length - z),
    above: a > 0 ? c.added[a - 1] : null,
    below: z > 0 ? c.added[c.added.length - z] : null,
    loose: c.loose,
  };
}

/**
 * An edit applied to the mod's code now. `edit`: {version, blocks} as `parse` gives it.
 * {ok: true, code, changes: [{line, removed, added, above, below, loose}]} (line: 1-based, in the new code), or
 * {ok: false, why, block, count}: why 'stale' (the version isn't the code's now), 'noversion', 'nomatch' or 'many'
 * (block: the 0-based block that didn't fit, against the text the blocks before it made), 'nochange' (the blocks
 * leave it as it is). Nothing is applied unless all of it is. The code keeps its line ends (\r\n if it had them).
 * @param {string} code
 * @param {{version: string|null, blocks: {search: string[], replace: string[]}[]}} edit
 */
function apply(code, edit) {
  const text = String(code ?? '');
  if (!edit || !edit.version) return { ok: false, why: 'noversion' };
  if (String(edit.version).toLowerCase() !== version(text)) return { ok: false, why: 'stale' };
  return applyBlocks(text, edit.blocks);
}
/** The blocks applied with no version check (an earlier version, to see whether they're in already). */
function applyBlocks(code, blocks) {
  const text = String(code ?? '');
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  let lines = linesOf(text);
  const changes = [];
  for (let i = 0; i < (blocks || []).length; i++) {
    const r = applyBlock(lines, blocks[i]);
    if (!r.ok) return { ok: false, why: r.why, block: i, count: r.count };
    lines = r.lines;
    // (a later block's change moves the lines of the earlier ones after it)
    const delta = r.added.length - r.removed.length;
    for (const c of changes) if (c.at > r.at) c.at += delta;
    changes.push(r);
  }
  const out = lines.join(eol);
  if (out === text) return { ok: false, why: 'nochange' };
  return { ok: true, code: out, changes: changes.map(compact) };
}

// ---- which mod, and what came of it ----------------------------------------------------------------------------

// (a name as a file's: lower case, a .js and anything not a letter or digit evened out)
const slug = (s) => String(s || '').toLowerCase().replace(/\.js$/, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The mod an edit names: its file id (site/name) exactly; else ignoring case and a .js; else the one mod whose file
 * name (the part after the site) or @name it is. null: none, or more than one.
 * @param {string|null} file
 * @param {{id: string, name: string}[]} mods
 * @returns {string|null} the mod's id
 */
function target(file, mods) {
  if (!file) return null;
  const list = mods || [];
  const f = String(file).trim().replace(/^\/+|\/+$/g, '');
  const exact = list.filter((m) => m.id === f);
  if (exact.length === 1) return exact[0].id;
  const low = f.toLowerCase().replace(/\.js$/, '');
  const byId = list.filter((m) => String(m.id).toLowerCase() === low);
  if (byId.length === 1) return byId[0].id;
  // (phone~x.com/a and x.com/a: the site as a site)
  const bare = (id) => String(id).toLowerCase().replace(/^phone~/, '').replace(/^www\./, '');
  const bySite = list.filter((m) => bare(m.id) === bare(low));
  if (bySite.length === 1) return bySite[0].id;
  const tail = slug(low.split('/').pop());
  if (!tail) return null;
  const byName = list.filter((m) => slug(String(m.id).split('/').pop()) === tail || slug(m.name) === tail);
  return byName.length === 1 ? byName[0].id : null;
}

// (two texts the same but for line ends and a stable id line, which TRIF stamps in when it adds a chat's mod)
const sameText = (a, b) => {
  const plain = (t) => linesOf(t).filter((l) => !/^\s*\/\/\s*@id\b/.test(l)).map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
  return plain(a) === plain(b);
};

/**
 * An edit for a mod here: applied to its code now, or why not. `history`: its earlier versions' codes (newest first
 * or not: any order). {ok: true, code, changes} or {ok: false, why}: as `apply`, and 'already' when the edit is for
 * an earlier version and its result is the code now (the same reply's changes added before).
 * @param {{version: string|null, blocks: object[]}} edit
 * @param {string} current
 * @param {string[]} history
 */
function take(edit, current, history) {
  const r = apply(current, edit);
  if (r.ok || r.why !== 'stale') return r.ok || r.why !== 'nochange' ? r : { ok: false, why: 'already' };
  for (const old of history || []) {
    if (version(old) !== String(edit.version).toLowerCase()) continue;
    const o = applyBlocks(old, edit.blocks);
    if (o.ok && sameText(o.code, current)) return { ok: false, why: 'already' };
  }
  return r;
}

// ---- shortened files ------------------------------------------------------------------------------------------
// A chat asked to change a long mod often gives back its file with the parts it didn't change left out, and a
// comment in their place ("// ... rest of the code unchanged ..."). Saved, that's a broken mod. Caught only when all
// of these hold, so a real comment saying "unchanged" in working code never trips it: the line is only a comment (or
// only "..."), its words are a placeholder's, the mod's version now doesn't have that line, and lines the version
// now has are missing from the offered file where it stands.

// (a placeholder's words: a sameness word, and what stays the same (or dots, or the word alone); short)
const SAME = /\b(?:unchanged|untouched|the same|same as|as before|as is|as-is|as it was|as they were|intact|identical|omitted|elided|truncated|for brevity|not shown|snip|snipped)\b/;
const REF = /\b(?:rest|remainder|everything else|all else|remaining|existing|previous|original|code|file|mod|rules?|styles?|css|functions?|lines?|logic|content|implementation|script|stylesheet|body|parts?|sections?)\b/;
const ALONE = /^(?:unchanged|untouched|same as (?:before|above)|as before|omitted|truncated|snip|snipped)$/;
// "existing code", "your existing rules here", "original styles"
const EXISTING = /^(?:(?:your|the|all|all the|keep|keep the|keep all|keep all the)\s+)?(?:existing|original|previous|old)\s+(?:code|rules?|styles?|css|functions?|logic|lines|content|settings|selectors|declarations|handlers?|helpers?|implementation|stuff)(?:\s+(?:here|goes here|stays|remains|continues|follows|below|above))?$/;
// "keep the rest", "keep everything else as is"
const KEEP = /^keep\s+(?:the\s+)?(?:rest|everything else|all else|remaining (?:code|lines|rules|styles))\b/;
// "40 more lines", "lines 40-120 unchanged"
const COUNTED = /^(?:\d+\s+more\s+lines?|lines?\s+\d+\s*(?:-|–|to)\s*\d+)\b/;
const WORDS_MAX = 9;
const SHORT = 7;
const STARTS = /^(?:(?:the|all the|and the|all|your|keep(?: the)?)\s+)?(?:rest|remainder|everything else|all else|remaining|existing|previous|original|other|unchanged|untouched|same|code|rules?|styles?|css|functions?|lines?|omitted|truncated)\b/;

/** A line that is only a comment, or only dots: its words (lower case, markers and dots gone), else null. */
function commentWords(line) {
  const t = String(line).trim();
  let m;
  if (/^(?:\.{3,}|…+)$/.test(t)) return '...';
  if ((m = /^\/\/+\s*(.*)$/.exec(t))) return clean(m[1]);
  if ((m = /^\/\*+\s*(.*?)\s*\*+\/$/.exec(t))) return clean(m[1]);
  if ((m = /^<!--\s*(.*?)\s*-->$/.exec(t))) return clean(m[1]);
  if ((m = /^#\s*(.*)$/.exec(t)) && !/^#[\w-]*\s*[{,]/.test(t)) return clean(m[1]);
  return null;
}
function clean(s) {
  return String(s).toLowerCase().replace(/[.…]{2,}|…/g, ' ').replace(/^[\s\-–—:()[\]{}*]+|[\s\-–—:()[\]{}*.!]+$/g, '').replace(/\s+/g, ' ').trim();
}

/** Whether a line reads as an elision placeholder (its words alone; the version now isn't consulted). */
function placeholder(line) {
  const w = commentWords(line);
  if (w === null) return false;
  const dots = /\.{3}|…/.test(line);
  if (w === '' || w === '...') return dots; // ("// ..." alone; a bare "//" isn't one)
  if (w.split(' ').length > WORDS_MAX) return false;
  if (ALONE.test(w) || EXISTING.test(w) || KEEP.test(w) || COUNTED.test(w)) return true;
  // (else a short line, starting with what stays the same or a sameness word: "rest of the code unchanged", "other
  // rules unchanged", "unchanged code below"; a sentence that happens to say "the same" or "untouched" is longer)
  const n = w.split(' ').length;
  return n <= SHORT && SAME.test(w) && (REF.test(w) || dots) && (STARTS.test(w) || dots);
}

/**
 * A whole file a chat offered for a mod that's here already, shortened: {line, text, missing} (the placeholder's
 * 1-based line, its text, how many of the version now's lines it stands in for), or null. `current`: the mod's code
 * now. Lines are compared ignoring whitespace.
 * @param {string} offered
 * @param {string} current
 */
function elided(offered, current) {
  const off = linesOf(offered), cur = linesOf(current);
  const curSet = new Set(cur.map(loose));
  const offSet = new Set(off.map(loose));
  for (let k = 0; k < off.length; k++) {
    if (!placeholder(off[k]) || curSet.has(loose(off[k]))) continue;
    // (where it stands: the nearest real lines around it, found in the version now)
    const real = (j) => off[j].trim() && !placeholder(off[j]);
    let p = k - 1; while (p >= 0 && !real(p)) p--;
    let n = k + 1; while (n < off.length && !real(n)) n++;
    const before = p >= 0 ? loose(off[p]) : null, after = n < off.length ? loose(off[n]) : null;
    let from = 0, to = cur.length;
    if (before !== null) { const i = cur.findIndex((l) => loose(l) === before); if (i !== -1) from = i + 1; }
    if (after !== null) { let i = -1; for (let j = from; j < cur.length; j++) if (loose(cur[j]) === after) { i = j; break; } if (i !== -1) to = i; }
    // (the lines there now that the offered file doesn't have anywhere)
    const missing = cur.slice(from, to).filter((l) => l.trim() && !offSet.has(loose(l))).length;
    if (missing >= 1) return { line: k + 1, text: off[k].trim(), missing };
  }
  return null;
}

module.exports = { version, has, parse, apply, applyBlocks, target, take, elided, placeholder };

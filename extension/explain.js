// The four layers of the terms the panel shows (explain.json, the one table; helper/lib/explain.js reads it
// for `trif explain` and docs/EXPLAIN.md). The panel keeps its own labels and lines (tests/explain.test.js
// checks them against the table) and takes only the explanations from here: the "more" beside a line on
// the approval card, the code card and the tiers' notes.
//
// An explanation starts with its line, written out; "more" shows what comes after it, so the line the
// panel shows (its {site} and the like filled in) isn't said twice. A term the table doesn't have (a
// newer combination warning, say) has no "more": its line alone.

let table = { groups: [], terms: [] };

/** Loads explain.json once (the panel awaits it before it renders); an empty table if it can't. */
export async function loadExplain(url = new URL('./explain.json', import.meta.url)) {
  try {
    const r = await fetch(url);
    if (r.ok) setExplain(await r.json());
  } catch { /* none: no "more" anywhere */ }
  return table;
}

export function setExplain(t) {
  table = t && Array.isArray(t.terms) ? t : { groups: [], terms: [] };
}

/** A term by its group and id, or null. */
export function term(group, id) {
  return table.terms.find((t) => t.group === group && t.id === id) || null;
}

/** The warning whose line is this ("Together, it …." or the many-powers sentences), or null. */
export function warningByLine(line) {
  const s = String(line || '').trim();
  return table.terms.find((t) => t.group === 'warnings' && t.line === s) || null;
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * What "more" shows for a term: its explanation after its line ("It can read … anywhere. It sees …" →
 * "It sees …"), or the whole explanation when it doesn't start with the line; '' for none.
 */
export function moreText(t) {
  if (!t || !t.explanation) return '';
  const ex = String(t.explanation).trim();
  const line = String(t.line || '').trim().replace(/\.$/, '');
  if (line && lowerFirst(ex).startsWith(lowerFirst(line))) {
    const after = ex.slice(line.length);
    if (/^\.\s/.test(after)) return after.replace(/^\.\s+/, '').trim();
    if (after === '' || after === '.') return '';
  }
  return ex;
}

'use strict';
// `trif sweep`: the CLI side. The extension does the looking (extension/sweep.js, in the page); this turns
// the command line into its options and its answer into a compact report.

class SweepUsageError extends Error {}

const DEFAULT_BUDGET = 4000;

/** CLI options (parseArgs' opts) → the `sweep` page command's args (without the tab selector). */
function sweepArgs(opts) {
  const a = {};
  for (const k of ['selector', 'text', 'color']) {
    const v = opts[`--${k}`];
    if (v === undefined) continue;
    if (!String(v).trim()) throw new SweepUsageError(`--${k} needs a value`);
    a[k] = String(v);
  }
  if (!a.selector && !a.text && !a.color) throw new SweepUsageError('say what to look for: --selector <css>, --color <css colour> or --text <regex>');
  if (opts['--tolerance'] !== undefined) {
    const t = Number(opts['--tolerance']);
    if (!a.color) throw new SweepUsageError('--tolerance goes with --color');
    if (!Number.isFinite(t) || t < 0 || t > 255) throw new SweepUsageError('--tolerance is 0 to 255 (how far each of red, green and blue may be off)');
    a.tolerance = t;
  }
  if (opts['--limit'] !== undefined) {
    const n = Number(opts['--limit']);
    if (!Number.isInteger(n) || n <= 0) throw new SweepUsageError('--limit needs a positive integer');
    a.limit = Math.min(n, 2000);
  }
  if (opts['--timeout'] !== undefined) {
    const t = Number(opts['--timeout']);
    if (!(t > 0)) throw new SweepUsageError('--timeout needs a number of milliseconds');
    a.budget = Math.min(t, 30000);
  }
  if (opts['--scroll']) a.scroll = true;
  // How long the helper and CLI wait: the sweep, scrolling first, and the stylesheets after.
  const budget = a.budget || DEFAULT_BUDGET;
  a.timeout = budget + (a.scroll ? Math.min(15000, budget * 2) + 1000 : 0) + 5000;
  return a;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };

// "main 22 · header (sticky) 8": the biggest first, the rest summed.
function topCounts(obj, n = 6) {
  const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  const shown = entries.slice(0, n).map(([k, v]) => `${k} ${v}`);
  const rest = entries.slice(n).reduce((s, [, v]) => s + v, 0);
  if (rest) shown.push(`${entries.length - n} more ${rest}`);
  return shown.join(' · ');
}

function queryText(q, target) {
  const parts = [];
  if (q.selector) parts.push(`--selector '${q.selector}'`);
  if (q.text) parts.push(`--text '${q.text}'`);
  if (q.color) parts.push(`--color '${q.color}'${target && target !== q.color ? ` (${target}${q.tolerance ? `, ±${q.tolerance}` : ''})` : q.tolerance ? ` (±${q.tolerance})` : ''}`);
  if (q.scroll) parts.push('--scroll');
  return parts.join(' ');
}

/** The extension's answer → lines of text. */
function formatSweep(r) {
  const L = [];
  const q = r.query || {};
  const sc = r.scanned || {};
  const roots = [sc.shadowRoots ? plural(sc.shadowRoots, 'shadow root') + (sc.closedShadowRoots ? ` (${sc.closedShadowRoots} closed)` : '') : '', sc.frames ? plural(sc.frames, 'frame') : ''].filter(Boolean);
  L.push(`sweep ${queryText(q, r.target)}`);
  L.push(`  on ${r.url}`);
  L.push(`${plural(r.total, 'match', 'matches')}  (${sc.elements} elements scanned${roots.length ? `, incl. ${roots.join(' and ')}` : ''}, ${sc.ms} ms${r.scrolled ? `; scrolled ${r.scrolled.steps} times to ${r.scrolled.height}px first` : ''})`);
  if (r.partial) L.push(`PARTIAL: ${r.partial}`);
  const s = r.summary || {};
  if (r.total) {
    L.push(`  where   ${topCounts(s.regions)}`);
    const pos = [s.fixed ? `${s.fixed} fixed` : '', s.sticky ? `${s.sticky} sticky` : ''].filter(Boolean).join(', ');
    L.push(`  state   ${s.visible} visible (${s.inViewport} in view), ${s.hidden} hidden${pos ? `; ${pos}` : ''}${s.inShadowRoots ? `; ${s.inShadowRoots} in shadow roots` : ''}${s.inFrames ? `; ${s.inFrames} in frames` : ''}`);
    if (s.props && Object.keys(s.props).length) L.push(`  props   ${topCounts(s.props, 8)}`);
    const groups = r.groups || [];
    // Few matches: each one. Many: grouped by kind, with an example of each.
    if (r.total <= 12 && (r.matches || []).length === r.total) {
      L.push('  matches:');
      for (const m of r.matches) {
        const props = m.props ? ' ' + m.props.map((p) => `${p.pseudo ? `${p.pseudo} ` : ''}${p.prop}: ${p.value}`).join('; ') : '';
        L.push(`    ${m.element}${m.text ? `  "${m.text}"` : ''}  (${m.region}${m.position ? `, ${m.position}` : ''}${m.visible ? '' : ', hidden'}${m.root !== 'document' ? `, in ${m.root}` : ''})${props}`);
      }
    } else {
      L.push(`  kinds (${r.groupCount || groups.length}${groups.length < (r.groupCount || 0) ? `, top ${groups.length}` : ''}):`);
      const width = Math.min(48, Math.max(...groups.map((g) => g.signature.length)));
      for (const g of groups.slice(0, 15)) {
        const ex = g.example || {};
        L.push(`    ${String(g.count).padStart(4)}  ${pad(g.signature, width)}  ${ex.text ? `e.g. "${ex.text.slice(0, 40)}" ` : ''}(${topCounts(g.regions, 2)}${g.visible < g.count ? `; ${g.count - g.visible} hidden` : ''})`);
      }
      if (groups.length > 15) L.push(`    … ${groups.length - 15} more kinds (--json)`);
    }
  }
  const rules = r.rules;
  if (rules) {
    const vars = rules.variables || [];
    L.push(`stylesheets  ${plural(rules.total, 'rule')} use it${vars.length ? `; ${plural(vars.length, 'variable')} ${vars.length === 1 ? 'defines' : 'define'} it, used by ${plural(rules.usingVariables.total, 'rule')}` : ''} (${plural(rules.sheets, 'sheet')} read${rules.unreadable ? `, ${rules.unreadable} unreadable: cross-origin` : ''})`);
    for (const v of vars.slice(0, 8)) L.push(`    ${v.name}: ${v.value}   (${v.selector}; used ${v.uses || 0}×${v.computed && v.computed !== v.value ? `; now ${v.computed} on :root` : ''})`);
    for (const x of (rules.list || []).slice(0, 10)) L.push(`    ${x.selector} { ${x.prop}: ${x.value} }`);
    if ((rules.list || []).length > 10 || rules.total > (rules.list || []).length) L.push(`    … ${rules.total - Math.min(10, (rules.list || []).length)} more rules (--json)`);
  }
  const skipped = r.skipped || {};
  if ((skipped.crossOriginFrames || []).length) L.push(`not searched: cross-origin frames (${skipped.crossOriginFrames.join(', ')}); mods can't change them from this page either`);
  if (!r.total && !(rules && (rules.total || (rules.variables || []).length))) {
    L.push('Nothing matched. Only what is in the page now counts: content that loads on scroll or after a click isn\'t there yet (--scroll helps for the first).');
  } else if ((r.matches || []).length < r.total) {
    L.push(`--json lists ${r.matches.length} of the ${r.total} matches (--limit N for more)`);
  } else if (r.total > 12) {
    L.push('--json lists every match');
  }
  return L.join('\n');
}

module.exports = { sweepArgs, formatSweep, SweepUsageError };

// Summarise the second depth study (docs/STUDY-DEEP-2.md): node tests/e2e/deep2-summary.js <results dir with study.json> [--rows]
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const j = JSON.parse(fs.readFileSync(path.join(dir, 'study.json'), 'utf8'));
const tag = (r) => `study-${r.task}-${r.guide}-${r.rep}-${r.turn}`;
const src = (r) => (r.mods || []).map((m) => { const p = path.join(dir, `${tag(r)}-${m.file}`); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }).join('\n');
function fixKind(r) {
  const raw = src(r);
  if (!raw.trim()) return 'none';
  // (code without its comments; the header's @powers line kept)
  const s = raw.replace(/^\s*\/\/(?!\s*@powers).*$/gm, '');
  const k = [];
  if (r.task === 'suggest') {
    if (/filterResponse|window\.fetch\s*=|XMLHttpRequest\.prototype|JSON\.parse\s*=/.test(s)) k.push('data');
    if (/translateY|transform/.test(s)) k.push('reposition');
    if (!k.length) k.push('hide');
  }
  if (r.task === 'newest') {
    if (/qb:o|qb:flags/.test(s)) k.push('setting');
    if (/window\.fetch\s*=|XMLHttpRequest\.prototype|filterResponse|rewrite-requests/.test(s)) k.push('request');
    if (!k.length) k.push(/sort|order/.test(s) ? 'dom-sort' : 'other');
  }
  if (r.task === 'live') {
    if (/gl:prefs/.test(s)) k.push('setting');
    if (/filterResponse|window\.fetch\s*=|XMLHttpRequest\.prototype/.test(s)) k.push('data');
    if (/gl\.pv/.test(s)) k.push('session-flag');
    if (/\.click\(\)/.test(s)) k.push('click-close');
    if (!k.length) k.push('hide');
  }
  return k.join('+');
}
const med = (a) => { const x = a.filter((v) => v != null).sort((p, q) => p - q); return x.length ? x[Math.floor((x.length - 1) / 2)] : null; };
const tok = (r) => (r.tokens ? r.tokens.input + r.tokens.cacheWrite + r.tokens.cacheRead + r.tokens.output : null);
const rows = j.rows.map((r) => ({ ...r, kind: fixKind(r), tok: tok(r), read: (r.bundleCmds || 0) + (r.bundleSeen || 0) > 0 }));
if (process.argv.includes('--rows')) {
  for (const r of rows) console.log([r.task, r.guide, r.rep, r.outcome, r.kind, `${r.secs}s`, `$${(r.cost || 0).toFixed(2)}`, `tools ${r.tools}`, `page ${r.pageRuns}`, `bundle ${r.bundleCmds}/${r.bundleSeen}`, `net ${r.netLooks}`, r.mods.map((m) => `${m.file}:${m.tier}`).join(' '), JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => ['sugShown', 'wrongBlank', 'gapSteps', 'maxGap', 'pages', 'firstNewest', 'moreNewest', 'timeSorted', 'mini', 'miniFrames', 'bigFrames', 'theater'].includes(k))))].join(' | '));
}
const arms = [...new Set(rows.map((r) => r.guide))];
const tasks = [...new Set(rows.map((r) => r.task))];
for (const g of arms) {
  console.log(`\n## ${g}`);
  console.log('| task | deep | surface | fail | fix kinds | read bundle | used --page | median tokens | median output | median tools | median secs | cost |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const t of [...tasks, 'all']) {
    const x = rows.filter((r) => r.guide === g && (t === 'all' || r.task === t));
    if (!x.length) continue;
    const n = (o) => x.filter((r) => r.outcome === o).length;
    const kinds = Object.entries(x.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`| ${t} | ${n('deep')} | ${n('surface')} | ${n('fail')} | ${t === 'all' ? '' : kinds} | ${x.filter((r) => r.read).length}/${x.length} | ${x.filter((r) => r.pageRuns > 0).length}/${x.length} | ${Math.round(med(x.map((r) => r.tok)) / 1000)}k | ${med(x.map((r) => r.tokens && r.tokens.output))} | ${med(x.map((r) => r.tools))} | ${med(x.map((r) => r.secs))} | $${x.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2)} |`);
  }
}

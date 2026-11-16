// Scores saved replies: the app's own checkMod (mobile/shared/gen/mods.js), raw and after app-side repairs,
// then applies the mod to the page snapshot in headless Chrome for Testing (style rules with TRIF's runtime,
// boxed mods in TRIF's sandbox under SES) and runs the task's check.
// usage: node score.js [label ...]   (default: every folder in results/)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const REPO = process.env.HOME + '/WebMods-worktrees/ios-poc';
require(REPO + '/mobile/shared/gen/mods.js');
const M = globalThis.__trifMods;
const { launch } = require(REPO + '/tests/cdp-page.js');
const SES = fs.readFileSync(REPO + '/extension/vendor/ses.umd.min.js', 'utf8');
const RUNTIME = fs.readFileSync(REPO + '/mobile/shared/gen/sandbox-runtime.js', 'utf8');
const tasks = Object.fromEntries(require('./tasks').map((t) => [t.id, t]));

const pageUrl = (page) => { const u = fs.readFileSync(path.join(ROOT, 'outlines', page + '.url'), 'utf8').trim(); return u.startsWith('file:') ? 'https://feed.example/home' : u; };

function assemble(rec) {
  // json variant: the app writes the header itself
  let o;
  try { o = JSON.parse(rec.content); } catch (e) { return { text: null, why: 'not JSON: ' + e.message }; }
  const rules = {};
  if (o.css) rules.css = o.css;
  for (const k of ['hide', 'filter', 'replace']) if (Array.isArray(o[k]) && o[k].length) rules[k] = o[k];
  const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').slice(0, 120);
  const text = `// ==WebMod==\n// @name        ${clean(o.name) || 'Local mod'}\n// @description ${clean(o.description)}\n// @match       ${rec.origin}/*\n// @style\n// ==/WebMod==\n${JSON.stringify(rules, null, 2)}\n`;
  return { text };
}

// What the app could fix by itself before checking (no model call): a missing tier line, a @match that misses the page.
function repair(text, rec) {
  const fixes = [];
  const lines = text.split('\n');
  const end = lines.findIndex((l) => /^\s*\/\/\s*==\/WebMod==/.test(l));
  if (end === -1) return { text, fixes };
  const head = lines.slice(0, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  if (!/@(style|rules|boxed|sandboxed)\b/.test(head)) {
    let json = false; try { JSON.parse(body.replace(/^\s*\(/, '').replace(/\)\s*;?\s*$/, '')); json = true; } catch { /* code */ }
    lines.splice(end, 0, json ? '// @style' : '// @boxed');
    fixes.push(json ? 'added @style' : 'added @boxed');
  }
  let t = lines.join('\n');
  // (a boxed mod calling a stand-in's text property as a function: text() -> text)
  if (/@(boxed|sandboxed)\b/.test(t.split(/==\/WebMod==/)[0]) && /\.(text|innerText)\(\)/.test(t)) { t = t.replace(/\.(text|innerText)\(\)/g, '.$1'); fixes.push('text() to text'); }
  // (a filter's "words" written as a pattern: a|b in hideIfText becomes hideIfRegex)
  if (/@(style|rules)\b/.test(t.split(/==\/WebMod==/)[0])) {
    const [h, b] = t.split(/(?<===\/WebMod==.*)\n/);
    try {
      const o = JSON.parse(b);
      let changed = false;
      for (const f of o.filter || []) if (typeof f.hideIfText === 'string' && f.hideIfText.includes('|')) { f.hideIfRegex = f.hideIfText.split('|').map((w) => w.trim().replace(/[.*+?^${}()[\]\\]/g, '')).filter(Boolean).join('|'); delete f.hideIfText; changed = true; }
      if (changed) { t = h + '\n' + JSON.stringify(o, null, 2) + '\n'; fixes.push('words to pattern'); }
    } catch { /* left as it is */ }
  }
  const url = pageUrl(tasks[rec.task].page);
  const matches = [...t.matchAll(/^\s*\/\/\s*@match\s+(\S+)/gm)].map((m) => m[1]);
  if (!matches.length || !M.matchesUrl(url, matches)) {
    t = t.replace(/^\s*\/\/\s*@match\s+.*\n/gm, '');
    t = t.replace(/^(\s*\/\/\s*==WebMod==.*\n)/m, `$1// @match       ${rec.origin}/*\n`);
    fixes.push('set @match');
  }
  return { text: t, fixes };
}

function cssSelectors(css) {
  const out = [];
  const s = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(s))) { const pre = m[1].trim(); if (!pre || pre.startsWith('@')) continue; out.push(...pre.split(',').map((x) => x.trim()).filter(Boolean)); }
  return out;
}

async function clickAt(p, expr) {
  const r = await p.evaluate(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) return false;
  for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await p.waitForTimeout(250);
  return true;
}

const VIS = `window.__vis = (el) => { if (!el) return false; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };`;

async function boxedCheck(p, kind) {
  if (kind === 'toggle') {
    const btn = `[...document.querySelectorAll('button')].find((b) => !b.dataset.orig && __vis(b))`;
    const has = await p.evaluate(`!!(${btn})`);
    if (!has) return { pass: false, note: 'no new button' };
    const s0 = await p.evaluate(`__vis(document.querySelector('aside.sidebar'))`);
    await clickAt(p, btn);
    const s1 = await p.evaluate(`__vis(document.querySelector('aside.sidebar'))`);
    await clickAt(p, btn);
    const s2 = await p.evaluate(`__vis(document.querySelector('aside.sidebar'))`);
    const above = await p.evaluate(`(() => { const b = ${btn}; const f = document.querySelector('section.feed'); return b && f ? b.getBoundingClientRect().top <= f.getBoundingClientRect().top + 5 : null; })()`);
    return { pass: s0 !== s1 && s1 !== s2, note: `sidebar visible ${s0} -> click ${s1} -> click ${s2}; button above timeline: ${above}` };
  }
  if (kind === 'wordcount') {
    return p.evaluate(`(() => { const real = document.querySelector('#mw-content-text').textContent.trim().split(/\\s+/).length; const els = [...document.querySelectorAll('*')].filter((e) => !e.dataset.orig && __vis(e) && /\\d/.test(e.textContent) && /word/i.test(e.textContent) && e.textContent.length < 200); if (!els.length) return { pass: false, note: 'no new element with a word count (real ' + real + ')' }; const n = parseInt(els[0].textContent.replace(/,/g, '').match(/\\d+/)[0], 10); const h = document.querySelector('#firstHeading').getBoundingClientRect(); const y = els[0].getBoundingClientRect().top; return { pass: n > real * 0.5 && n < real * 2, note: 'shows "' + els[0].textContent.trim().slice(0, 60) + '", real about ' + real + ', ' + Math.round(y - h.bottom) + ' px below the title' }; })()`);
  }
  if (kind === 'perstory') {
    const n = await p.evaluate(`[...document.querySelectorAll('button, a, span')].filter((b) => !b.dataset.orig && __vis(b) && b.closest('tr')).length`);
    if (n < 10) return { pass: false, note: `${n} new controls in story rows` };
    const first = await p.evaluate(`(() => { const b = [...document.querySelectorAll('button, a, span')].find((b) => !b.dataset.orig && __vis(b) && b.closest('tr')); const tr = b.closest('tr.athing') || b.closest('tr').previousElementSibling; window.__target = b.closest('tr.athing') || (b.closest('tr').previousElementSibling && b.closest('tr').previousElementSibling.matches('tr.athing') ? b.closest('tr').previousElementSibling : b.closest('tr')); window.__btn = b; return window.__target ? window.__target.textContent.trim().slice(0, 40) : null; })()`);
    await clickAt(p, 'window.__btn');
    const gone = await p.evaluate(`!__vis(window.__target)`);
    const others = await p.evaluate(`[...document.querySelectorAll('tr.athing')].filter(__vis).length`);
    return { pass: gone && others >= 20, note: `${n} new controls; clicking the first hid its story: ${gone} ("${first}"); stories still shown ${others}` };
  }
  return { pass: false, note: 'unknown check' };
}

(async () => {
  const labels = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(ROOT, 'results')).filter((d) => fs.statSync(path.join(ROOT, 'results', d)).isDirectory());
  const recs = [];
  for (const l of labels) for (const v of fs.readdirSync(path.join(ROOT, 'results', l))) for (const f of fs.readdirSync(path.join(ROOT, 'results', l, v))) if (f.endsWith('.json')) recs.push(JSON.parse(fs.readFileSync(path.join(ROOT, 'results', l, v, f), 'utf8')));
  const b = await launch();
  const scores = [];
  try {
    for (const rec of recs) {
      const t = tasks[rec.task];
      const s = { label: rec.label, variant: rec.variant, task: rec.task, kind: t.kind, wallMs: rec.wallMs, promptN: rec.timings && rec.timings.prompt_n, genN: rec.timings && rec.timings.predicted_n, genTps: rec.timings && rec.timings.predicted_per_second, finish: rec.finish };
      let text = null;
      if (/json/.test(rec.variant)) { const a = assemble(rec); text = a.text; if (!text) s.extract = a.why; }
      else text = rec.content ? M.findMod(rec.content) : null;
      // (a reply that is only CSS: the app can wrap it as a style mod's "css"; counted as a repair, not raw-valid)
      let wrapped = false;
      if (!text && rec.content) { const c = /```css\n([\s\S]*?)```/.exec(rec.content); if (c) { text = `// ==WebMod==\n// @name        Local mod\n// @match       ${rec.origin}/*\n// @style\n// ==/WebMod==\n${JSON.stringify({ css: c[1].trim() }, null, 2)}\n`; wrapped = true; } }
      if (!text) { s.extract = s.extract || 'no mod in the reply'; scores.push(s); console.log(rec.label, rec.variant, rec.task, 'NO MOD'); continue; }
      const raw = M.checkMod(text, { here: new URL(pageUrl(t.page)).hostname });
      s.rawOk = raw.ok && !wrapped; s.rawErrors = raw.errors.map((e) => e.message).concat(raw.lint.map((l) => l.what)); s.tier = raw.tier;
      const rep = repair(text, rec);
      const fixed = M.checkMod(rep.text, { here: new URL(pageUrl(t.page)).hostname });
      s.fixes = wrapped ? ['wrapped bare CSS', ...rep.fixes] : rep.fixes; s.fixedOk = fixed.ok; s.fixedErrors = fixed.errors.map((e) => e.message).concat(fixed.lint.map((l) => l.what)); s.tierFixed = fixed.tier;
      s.wrongTier = (t.kind === 'style' && fixed.tier !== 'style') || (t.kind === 'boxed' && fixed.tier !== 'boxed');
      fs.mkdirSync(path.join(ROOT, 'results', rec.label, rec.variant, 'mods'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'results', rec.label, rec.variant, 'mods', rec.task + '.js'), rep.text);
      if (!fixed.ok && fixed.tier !== 'free') { scores.push(s); console.log(rec.label, rec.variant, rec.task, 'INVALID', s.fixedErrors.join('; ').slice(0, 160)); continue; }
      const mod = M.readMod(rep.text, { here: new URL(pageUrl(t.page)).hostname });
      if (mod.error) { s.extract = mod.error; scores.push(s); continue; }
      const p = await b.newPage();
      try {
        await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await p.goto('file://' + path.join(ROOT, 'outlines', t.page + '.html'), { timeoutMs: 45000 }).catch(() => {});
        await p.waitForTimeout(400);
        await p.evaluate(VIS + `document.querySelectorAll('*').forEach((e) => { e.dataset.orig = '1'; });`);
        const base = t.base ? await p.evaluate(t.base) : undefined;
        if (mod.tier === 'style') {
          const rules = JSON.parse(rep.text.split(/==\/WebMod==.*\n/)[1]);
          const sels = [...(rules.hide || []), ...(rules.filter || []).map((f) => f.items), ...(rules.replace || []).map((r) => r.in).filter(Boolean), ...cssSelectors(rules.css)];
          s.selectors = await p.evaluate(`(${JSON.stringify(sels)}).map((q) => { let n = -1; try { n = document.querySelectorAll(q.replace(/::?(before|after|hover|visited|focus|active|link|first-line|first-letter)\\b/g, '')).length; } catch {} return [q, n]; })`);
          s.selMatch = s.selectors.length ? s.selectors.filter(([, n]) => n > 0).length / s.selectors.length : null;
          await p.evaluate(mod.script.replace(/\(location\.href, /g, `(${JSON.stringify(pageUrl(t.page))}, `));
          await p.waitForTimeout(500);
        } else if (mod.tier === 'boxed') {
          await p.evaluate(SES); await p.evaluate(RUNTIME); await p.evaluate('globalThis.__trifStartSandbox()');
          await p.evaluate(`globalThis.__trifSandbox.run(${JSON.stringify(mod.id)}, ${JSON.stringify(String(mod.code))}, ${JSON.stringify({ powers: mod.powers || [], args: mod.powerArgs || {} })})`);
          await p.waitForTimeout(1200);
          s.boxErrors = await p.evaluate(`(globalThis.__trifSandbox.errors || []).map((e) => e.message)`);
        } else { s.extract = 'free mod: not run'; }
        if (mod.tier === 'style' || mod.tier === 'boxed') {
          const r = typeof t.check === 'string' && t.kind === 'boxed' ? await boxedCheck(p, t.check) : await p.evaluate(t.base ? `(${t.check})(${JSON.stringify(base)})` : t.check);
          s.pass = !!r.pass; s.note = r.note;
        }
      } catch (e) { s.runError = String(e.message || e).slice(0, 300); }
      await p.close();
      scores.push(s);
      console.log(rec.label, rec.variant, rec.task, s.rawOk ? 'raw-ok' : 'raw-bad', s.fixedOk ? 'fixed-ok' : 'fixed-bad', s.pass ? 'PASS' : 'fail', s.note || s.runError || '', s.boxErrors && s.boxErrors.length ? 'boxErr: ' + s.boxErrors.join('; ').slice(0, 150) : '');
    }
  } finally { await b.close(); }
  const out = path.join(ROOT, 'results', 'scores-' + labels.join('+') + '.json');
  fs.writeFileSync(out, JSON.stringify(scores, null, 1));
  // summary per label x variant
  const groups = {};
  for (const s of scores) { const k = `${s.label} ${s.variant}`; (groups[k] = groups[k] || []).push(s); }
  for (const [k, g] of Object.entries(groups)) {
    const n = g.length, raw = g.filter((s) => s.rawOk).length, fixed = g.filter((s) => s.fixedOk).length, pass = g.filter((s) => s.pass).length;
    const st = g.filter((s) => s.kind === 'style'), bx = g.filter((s) => s.kind === 'boxed');
    console.log(`${k}: valid raw ${raw}/${n}, valid after repair ${fixed}/${n}, does the job ${pass}/${n} (style ${st.filter((s) => s.pass).length}/${st.length}, boxed ${bx.filter((s) => s.pass).length}/${bx.length}), mean wall ${Math.round(g.reduce((a, s) => a + s.wallMs, 0) / n)} ms`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
'use strict';
// Checks a TRIF mod file the way TRIF will when the user adds it, with TRIF's own code (scripts/lib/: copies of
// TRIF's helper/lib, made by skill/build.js). Reads the file; runs nothing in it.
//
//   node scripts/check-mod.js <mod.js> [--site <host>] [--json]
//
// It says: whether the header and the mod parse (a style mod's rules, a style section, a boxed mod's powers,
// a free mod's code), which site TRIF will file it under and the mod's name there, what TRIF reads in it that
// makes it wait for the user's OK (and the plain way round, where there is one), what TRIF's sandbox wouldn't
// give a boxed mod, and a few things TRIF's guide asks of every mod (a 4-to-9-word @description, a @risk line).
// Exit code 1 when TRIF would refuse the file or the mod wouldn't run as written.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIB = fs.existsSync(path.join(__dirname, 'lib', 'mods.js')) ? path.join(__dirname, 'lib') : path.join(__dirname, '..', '..', '..', 'helper', 'lib');
const lib = (name) => require(path.join(LIB, `${name}.js`));

// As TRIF's import does (helper/lib/share.js sitesOf, nameOf, checkSite; tests/skill.test.js keeps them in step).
const SITE_RE = /^(?:all-sites|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/;
const hostOfMatch = (m) => {
  if (m === '<all_urls>') return '*';
  const x = /^(?:\*|https?|file|ftp):\/\/([^/]+)\//.exec(String(m));
  if (!x) return null;
  return x[1].toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
};
function sitesOf(header) {
  const hosts = [...new Set(header.matches.map(hostOfMatch).filter(Boolean))];
  if (hosts.includes('*')) return { site: null, candidates: ['all-sites', ...hosts.filter((x) => x !== '*')] };
  const ok = hosts.filter((x) => SITE_RE.test(x));
  return ok.length === 1 ? { site: ok[0], candidates: ok } : { site: null, candidates: ok };
}
const nameOf = (s) => String(s || '').toLowerCase().replace(/\.js$/i, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** The check, as data: {ok, problems: [text], notes: [text], tier, site, id, holds: [text], ...}. */
function checkMod(text, { fileName = 'mod.js', site: siteOpt = '' } = {}) {
  const mods = lib('mods');
  const out = { ok: true, problems: [], warnings: [], notes: [], holds: [], sandbox: [], tier: null, site: null, id: null };
  const problem = (t) => { out.ok = false; out.problems.push(t); };
  const code0 = String(text);
  if (!code0.trim()) { problem('the file is empty'); return out; }
  if (Buffer.byteLength(code0) > mods.MAX_MOD_BYTES) problem(`it's bigger than a mod can be (${mods.MAX_MOD_BYTES / 1024 / 1024} MB)`);
  const header = mods.parseHeader(code0);
  if (!header.hasHeader) { problem('no // ==WebMod== … // ==/WebMod== header: TRIF won\'t import it'); return out; }
  for (const w of header.warnings) out.warnings.push(`header: ${w}`);
  out.tier = header.rules && header.sandboxed ? null : header.rules ? 'style' : header.sandboxed ? 'boxed' : 'free';
  if (!out.tier) { problem('a mod is either a style mod (@style) or a boxed mod (@boxed), not both'); return out; }

  // where TRIF will put it (the import: its site from @match, its name from the file's name)
  let site = siteOpt ? String(siteOpt).trim().toLowerCase().replace(/^www\./, '') : null;
  if (site && !SITE_RE.test(site)) { problem(`"${site}" isn't a site (a host name like x.com)`); site = null; }
  if (!site) {
    const found = sitesOf(header);
    if (found.site) site = found.site;
    else out.warnings.push(found.candidates.length
      ? `its @match lines name ${found.candidates.join(', ')}: TRIF will ask the user which site it's for (one site in @match, or the folder all-sites for a mod for many, saves them that question)`
      : 'no @match line names a site: TRIF will ask the user which site it\'s for; add @match lines (https://example.com/*)');
  }
  const base = nameOf(fileName) || nameOf(header.name) || 'imported-mod';
  out.site = site;
  out.id = site ? `${site}/${base}` : null;
  if (/[^a-z0-9-]/.test(path.basename(fileName, '.js')) || path.basename(fileName, '.js') !== base) out.warnings.push(`TRIF names the mod after the file: "${path.basename(fileName)}" becomes "${base}". Name the file <what-it-does>.js, in kebab-case.`);
  if (/^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}-/.test(path.basename(fileName))) out.warnings.push('the file name starts with a site: name it after what the mod does (hide-reposts.js); TRIF takes the site from @match');
  if (header.source || header.version) out.notes.push('@source and @version are taken out on import (only Tim\'s own mods carry them)');

  // the guide's asks
  const words = String(header.description || '').trim().split(/\s+/).filter(Boolean).length;
  if (!header.description) out.warnings.push('no @description: write one, 4 to 9 words, saying what the user will see');
  else if (words < 4 || words > 9) out.warnings.push(`@description is ${words} words: TRIF's panel wants 4 to 9, what the user will see`);
  if (!header.risk) out.warnings.push('no @risk line: add one (// @risk 0 render-only; 1 the site could tell; 2 it changes what the site receives)');
  if (!header.name) out.warnings.push('no @name: TRIF shows the file name instead');

  // as TRIF builds it (the import refuses a header that doesn't make a mod)
  let built = null;
  try { built = mods.buildMod({ site: site || 'example.com', file: path.join('/nowhere', site || 'example.com', `${base}.js`), code: code0 }); } catch (e) { problem(`TRIF can't make a mod of it: ${e.message}`); }

  // its style section, if any (TRIF applies it; the code never sees its text)
  let code = code0;
  let section = null;
  try {
    section = lib('stylesection').parseSection(code0);
    if (section && header.rules) problem('a style mod is all style: its CSS and hide list go in its JSON, without a // ==Style== section');
  } catch (e) { problem(e.message); }
  if (section) {
    code = section.code;
    const names = Object.keys(section.values);
    out.notes.push(`its style section checks out${names.length ? ` (settings for the code: ${names.map((n) => `trif.style.${n}`).join(', ')})` : ''}; a change there alone never waits for the user's OK`);
    out.styleCss = section.css;
  }

  if (out.tier === 'style') {
    try { out.rules = lib('rules').parseRules(code0); out.notes.push('a style mod: TRIF runs its rules with its own code, so it never waits for the user\'s OK'); } catch (e) { problem(e.message); }
    return out;
  }

  try { new vm.Script(out.tier === 'boxed' ? `(async function () {\n${code}\n})` : code, { filename: fileName, lineOffset: out.tier === 'boxed' ? -1 : 0 }); } catch (e) {
    problem(`it doesn't parse: ${e.message}${e.stack ? ` (${String(e.stack).split('\n')[0]})` : ''}`);
    return out;
  }
  const lines = code.split('\n');
  const at = (ns) => ns.slice(0, 3).map((n) => `line ${n}: ${String(lines[n - 1] || '').trim().slice(0, 120)}`);

  if (out.tier === 'boxed') {
    const bp = lib('boxpowers');
    let asked = [];
    let args = {};
    try {
      const pa = bp.parsePowersWithArgs(header.powers, { site: site || '', matches: header.matches });
      asked = pa.names; args = pa.args;
      const clicks = bp.parseClicks(header.clicks);
      if (clicks.length && !asked.includes('click')) throw new bp.PowersError('@click lines are for a mod with the click power (@powers click)');
      if (asked.includes('click') && !clicks.length) throw new bp.PowersError('the click power needs what it may click: // @click the play button: button.play');
      if (clicks.length) args.click = clicks;
      const events = bp.parseEvents(header.events);
      if (events.length) args.events = events;
      const migrate = bp.parseMigrate(header.migrate);
      if (migrate.length) args.migrate = migrate;
    } catch (e) { problem(e.message); return out; }
    out.powers = asked;
    const needs = bp.powerNeeds({ site: site || '', powers: asked, powerArgs: args });
    const hard = needs.filter((n) => !n.soft);
    if (!needs.length) out.notes.push('a boxed mod with no powers: it can\'t send, click, navigate or load anything, so it never waits for the user\'s OK');
    else if (hard.length) for (const l of bp.factLines(needs.map((n) => n.key), needs.map((n) => n.fact))) out.holds.push(l);
    else out.notes.push(`its powers (${asked.join(', ')}) don't make it wait for the user's OK on their own`);
    // (sandboxlint.js, as of 0.3.0, also takes `trif.style.<setting>`, which the guide says to write, for an element's
    // .style.x: a line whose only .style. is trif.style.x isn't a problem)
    const styleOnly = (n) => { const l = String(lines[n - 1] || ''); return /\btrif\.style\./.test(l) && !/\.style\./.test(l.replace(/\btrif\.style\./g, '')); };
    const lint = lib('sandboxlint').sandboxLint(code, { powers: asked })
      .map((l) => (l.what === '.style.…' ? { ...l, lines: l.lines.filter((n) => !styleOnly(n)) } : l))
      .filter((l) => l.what !== '.style.…' || l.lines.length);
    for (const l of lint) { out.ok = false; out.sandbox.push(`${l.what}: ${l.why}${l.lines.length ? ` (${at(l.lines).join('; ')})` : ''}`); }
    return out;
  }

  // a free mod: what TRIF reads in it (helper/lib/powers.js), and whether a boxed mod would do
  const { powersOf, modSites } = lib('powers');
  const found = powersOf(code, { sites: modSites({ id: out.id || `${site || 'example.com'}/${base}`, matches: header.matches }) });
  for (const p of found) out.holds.push(`it ${p.fact}${p.lines.length ? ` (${at(p.lines).join('; ')})` : ''}`);
  const box = lib('sandboxlint').boxable(code);
  if (box.boxable) out.warnings.push(`this free mod only does what a boxed mod can, and boxed is the safer tier: rewrite it as one (// @boxed; references/boxed-mods.md)${box.swaps.length ? `: ${box.swaps.slice(0, 4).join('; ')}` : ''}`);
  if (!/\(\s*\(\s*\)\s*=>|\(\s*function\s*\(|\(\s*async\s*(?:\(\s*\)\s*=>|function\s*\()/.test(code)) out.warnings.push('wrap a free mod\'s code in an IIFE ((() => { … })();): nothing leaks into the page\'s globals');
  return out;
}

function print(r, file) {
  const say = (t) => process.stdout.write(`${t}\n`);
  say(`${r.ok ? 'ok' : 'NOT OK'}: ${file}${r.tier ? ` (a ${r.tier} mod)` : ''}`);
  if (r.id) say(`TRIF will add it as ${r.id}`);
  for (const p of r.problems) say(`- problem: ${p}`);
  for (const s of r.sandbox) say(`- TRIF's sandbox doesn't give it: ${s}`);
  if (r.holds.length) {
    say(r.tier === 'boxed' ? 'It waits for the user\'s OK once, for this set of powers. The hold will say:' : 'TRIF holds it until the user allows it, because:');
    for (const h of r.holds) say(`- ${h}`);
    say('Tell the user what it does and why it waits. If it doesn\'t really need it, see references/checks.md for the plain way.');
  } else if (r.ok && r.tier !== 'style') say('Nothing in it waits for the user\'s OK.');
  for (const w of r.warnings) say(`- note: ${w}`);
  for (const n of r.notes) say(`- ${n}`);
  say('Added from a file, it starts switched off: the user turns it on in TRIF\'s panel.');
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i === -1) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  const site = opt('--site') || '';
  const file = args[0];
  if (!file) { process.stderr.write('usage: node scripts/check-mod.js <mod.js> [--site <host>] [--json]\n'); return 2; }
  const r = checkMod(fs.readFileSync(file, 'utf8'), { fileName: path.basename(file), site });
  if (json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); else print(r, file);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv);
module.exports = { checkMod, sitesOf, nameOf, hostOfMatch, SITE_RE };

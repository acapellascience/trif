#!/usr/bin/env node
'use strict';
// The TRIF skill (skill/trif/): what Claude reads on surfaces that aren't TRIF's own side panel (Claude in
// Chrome, claude.ai, Cowork, Claude Code without TRIF's workspace) to write mods and hand them to TRIF.
//
// Made from two kinds of source, so it never drifts from TRIF:
//   - skill/src/: what only the skill says (SKILL.md, the live-test and hand-off references, the page helpers
//     written for it, the checker's command line). Edit those.
//   - TRIF itself: the agent guides' sections (helper/workspace/AGENTS.md, BOXED.md, TECHNIQUES.md), cut by
//     their headings; the libraries `trif check` uses (helper/lib: copied as they are, for scripts/check-mod.js);
//     TRIF's own style-mod runtime (helper/lib/rules.js rulesRuntime) and `trif sweep` (extension/sweep.js
//     sweepPage), as scripts to paste into a page.
// A heading that moves, or a line of rulesRuntime the live test hooks into that changes, fails the build
// loudly: fix the cut here rather than letting the skill quietly lose a section.
//
//   node skill/build.js           write skill/trif/
//   node skill/build.js --check   exit 1 if skill/trif/ isn't what this would write (tests/skill.test.js)
//
// skill/package.js packs skill/trif/ as a ZIP for claude.ai and as a Claude Code plugin.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'trif');
const NAME = 'trif';
const DESCRIPTION_MAX = 200; // (claude.ai's limit for a skill's description)

// The libraries `trif check` reads a mod with, and everything they require (tests/skill.test.js checks the set
// is closed: a new require() in one of them fails the test until it's added here).
const LIBS = ['mods', 'rules', 'stylesection', 'powers', 'sandboxlint', 'boxpowers', 'combinations', 'framing', 'pathcheck', 'scope', 'env'];

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/** The text of `file` from the line starting with `start` up to (not including) the line starting with `end` (or the end). */
function between(file, start, end) {
  const t = read('helper', 'workspace', file);
  const lines = t.split('\n');
  const a = lines.findIndex((l) => l.startsWith(start));
  if (a === -1) throw new Error(`${file}: no line starting "${start}" (a heading moved: update skill/build.js)`);
  let b = lines.length;
  if (end) {
    b = lines.findIndex((l, i) => i > a && l.startsWith(end));
    if (b === -1) throw new Error(`${file}: no line starting "${end}" after "${start}" (a heading moved: update skill/build.js)`);
  }
  return lines.slice(a, b).join('\n').trim();
}

const cutNote = (files) => `<!-- Cut from TRIF's agent guide (${files.join(', ')} in helper/workspace/) by skill/build.js: don't edit here. -->\n\n` +
  '> From TRIF\'s own guide for coding agents. Where it says `trif <command>`, that\'s TRIF\'s command line on the\n' +
  '> user\'s computer: use it if you have it (Claude Code with TRIF installed). If you don\'t, do the same with your own\n' +
  '> tools: references/live-test.md says how. "The side panel" is TRIF\'s, and "a side-panel run" is TRIF\'s own chat,\n' +
  '> not you.\n\n';

/** The reference files cut from the guides: [name, text]. */
function guideRefs() {
  const ref = (name, title, lead, files, parts) => [name, `# ${title}\n\n${cutNote(files)}${lead ? `${lead}\n\n` : ''}${parts.join('\n\n')}\n`];
  return [
    ref('mod-format.md', 'The mod file', 'One file per customization: a header, then the mod.', ['AGENTS.md'], [
      between('AGENTS.md', '## Mod files', '### Style mods: start here'),
      // (not "### Phone runs": those are the helper's own runs for a paired phone, docs/PHONE-LINK.md; the skill has none)
      between('AGENTS.md', '### Mods for several sites', '### Phone runs'),
      between('AGENTS.md', '### Sensitive sites', '## Agent on this site'),
    ]),
    ref('style-mods.md', 'Style mods, and a style section in other mods', 'The tier to try first.', ['AGENTS.md'], [
      between('AGENTS.md', '### Style mods: start here', '### Mods TRIF ships'),
    ]),
    ref('boxed-mods.md', 'Boxed mods and their powers', 'When a style mod can\'t do it but the mod doesn\'t need the page\'s own code.', ['BOXED.md'], [
      between('BOXED.md', '## Boxed mods: when a style mod isn', null),
    ]),
    ref('free-mods.md', 'Free mods: techniques', 'Only when a mod needs the page itself. Read references/checks.md too: what TRIF holds.', ['TECHNIQUES.md'], [
      between('TECHNIQUES.md', '## Where mods run', '## Testing'),
    ]),
    ref('checks.md', 'What TRIF checks, what it holds, and the safety rules', 'TRIF reads every mod before it runs. Write mods it can read, and tell the user what will wait for their OK.', ['AGENTS.md', 'TECHNIQUES.md'], [
      between('AGENTS.md', '## Mods that wait for the user\'s OK', '## Side-panel runs'),
      between('TECHNIQUES.md', '## Writing mods TRIF can read', '## Where mods run'),
      between('AGENTS.md', '## Never break the site', '## Etiquette'),
    ]),
    ref('finish-the-job.md', 'Finish the job', 'Users name one or two instances; they mean the whole kind.', ['AGENTS.md'], [
      between('AGENTS.md', '## Finish the job', '## Techniques, repairs and testing'),
    ]),
  ];
}

// ---- page scripts: pasted into the page by a model that can run JavaScript there (Claude in Chrome)

/** Replaces `from` in `text`, which must be there exactly once. */
function once(text, from, to, what) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${what}: expected one "${from}", found ${n} (TRIF's code changed: update skill/build.js)`);
  return text.replace(from, () => to);
}

/**
 * scripts/page/try-style.js: TRIF's own style-mod runtime (rules.js rulesRuntime, as the helper sends it to the
 * browser), with what it changes noted so undo() can put the page back, and a report of what each rule hit.
 */
function tryStyleFile() {
  const rules = require(path.join(ROOT, 'helper', 'lib', 'rules.js'));
  let rt = rules.rulesRuntime.toString();
  rt = once(rt, "if (hide) el.style.setProperty('display', 'none', 'important');",
    "if (hide) { __t.hid(el); el.style.setProperty('display', 'none', 'important'); }", 'rulesRuntime (filter)');
  rt = once(rt, 'if (t !== n.data) n.data = t;', 'if (t !== n.data) { __t.txt(n); n.data = t; }', 'rulesRuntime (replace)');
  once(rt, 'new MutationObserver(', 'new MutationObserver(', 'rulesRuntime (its observer)');
  once(rt, "style.setAttribute('data-trif-style', String(id));", "style.setAttribute('data-trif-style', String(id));", 'rulesRuntime (its style element)');
  const tpl = fs.readFileSync(path.join(SRC, 'scripts', 'page', 'try-style.template.js'), 'utf8');
  let out = once(tpl, '/*RULES_RUNTIME*/', rt, 'try-style template');
  out = once(out, '/*TOP_LEVEL_LIST*/', rules.topLevelList.toString(), 'try-style template');
  return once(out, '/*SELECTORS_OF*/', rules.selectorsOf.toString(), 'try-style template');
}

/** scripts/page/sweep.js: `trif sweep` itself (extension/sweep.js sweepPage, self-contained by design). */
function sweepFile() {
  const src = read('extension', 'sweep.js');
  const at = src.indexOf('export async function sweepPage(');
  if (at === -1) throw new Error('extension/sweep.js: no "export async function sweepPage(" (update skill/build.js)');
  const body = src.slice(at).replace(/^export /, '').trim();
  return '// TRIF\'s own `trif sweep` (extension/sweep.js sweepPage), made by skill/build.js: don\'t edit.\n' +
    '// Paste all of this into the page once (it lasts until the page reloads), then:\n' +
    '//   await __trifSweep({ selector: \'[role=dialog]\', limit: 20 })   // or { text: \'^Sponsored$\' }, { color: \'#1d9bf0\' }\n' +
    '// It returns total, summary (visible, hidden, fixed, sticky, in shadow roots, in frames), groups (kinds, with\n' +
    '// examples) and matches (each one, up to limit).\n' +
    '// options: selector, text (a regex), color, tolerance (0-255), limit (matches listed, 200), scroll (true: scrolls to\n' +
    '// the bottom first, for lazy content, then back). It only reads (and scrolls, if asked). See references/live-test.md.\n' +
    `${body}\nwindow.__trifSweep = sweepPage;\n'sweep ready: await __trifSweep({ selector | text | color })';\n`;
}

// ---- the whole skill

const banner = (src) => `// Made by skill/build.js from ${src}: don't edit here.\n`;

/** Every file of the skill: [relative path, text]. */
function files() {
  const out = [];
  const skill = fs.readFileSync(path.join(SRC, 'SKILL.md'), 'utf8');
  checkFrontmatter(skill);
  out.push(['SKILL.md', skill]);
  for (const f of fs.readdirSync(path.join(SRC, 'references')).sort()) out.push([`references/${f}`, fs.readFileSync(path.join(SRC, 'references', f), 'utf8')]);
  for (const [name, text] of guideRefs()) out.push([`references/${name}`, text]);
  out.push(['scripts/check-mod.js', fs.readFileSync(path.join(SRC, 'scripts', 'check-mod.js'), 'utf8')]);
  for (const lib of LIBS) out.push([`scripts/lib/${lib}.js`, banner(`helper/lib/${lib}.js (TRIF's own, as it is)`) + read('helper', 'lib', `${lib}.js`)]);
  for (const f of fs.readdirSync(path.join(SRC, 'scripts', 'page')).sort()) {
    if (f.endsWith('.template.js')) continue;
    out.push([`scripts/page/${f}`, fs.readFileSync(path.join(SRC, 'scripts', 'page', f), 'utf8')]);
  }
  out.push(['scripts/page/try-style.js', tryStyleFile()]);
  out.push(['scripts/page/sweep.js', sweepFile()]);
  out.push(['LICENSE', read('LICENSE')]);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/** SKILL.md's frontmatter: the name, and a description within claude.ai's limit. Returns {name, description}. */
function checkFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error('skill/src/SKILL.md: no frontmatter');
  const get = (k) => { const r = new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(m[1]); return r ? r[1].trim() : null; };
  const name = get('name');
  const description = get('description');
  if (name !== NAME) throw new Error(`SKILL.md: name should be "${NAME}"`);
  if (!description) throw new Error('SKILL.md: no description');
  if (description.length > DESCRIPTION_MAX) throw new Error(`SKILL.md: the description is ${description.length} characters; claude.ai allows ${DESCRIPTION_MAX}`);
  if (/[<>]/.test(description)) throw new Error('SKILL.md: no < or > in the description');
  return { name, description };
}

function main() {
  const want = files();
  const check = process.argv.includes('--check');
  const have = new Set();
  const walk = (dir, rel = '') => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(dir, e.name), r); else have.add(r); } };
  walk(OUT);
  const wanted = new Set(want.map(([p]) => p));
  const stale = [...have].filter((p) => !wanted.has(p));
  const differ = want.filter(([p, t]) => !have.has(p) || fs.readFileSync(path.join(OUT, p), 'utf8') !== t).map(([p]) => p);
  if (check) {
    if (stale.length || differ.length) {
      console.error(`skill/trif is out of date (${[...differ, ...stale.map((s) => `${s} (not made any more)`)].join(', ')}): run node skill/build.js`);
      process.exit(1);
    }
    console.log(`skill/trif is up to date (${want.length} files)`);
    return;
  }
  for (const p of stale) fs.rmSync(path.join(OUT, p));
  for (const [p, t] of want) {
    fs.mkdirSync(path.dirname(path.join(OUT, p)), { recursive: true });
    fs.writeFileSync(path.join(OUT, p), t);
  }
  console.log(`wrote skill/trif (${want.length} files; ${differ.length} changed, ${stale.length} removed)`);
}

if (require.main === module) main();
module.exports = { files, guideRefs, tryStyleFile, sweepFile, checkFrontmatter, between, LIBS, OUT, SRC, NAME, DESCRIPTION_MAX };

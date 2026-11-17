'use strict';
// The TRIF skill (skill/): the generator keeps skill/trif/ in step with TRIF's guides and code, the checker reads
// mods as TRIF does (and files them where TRIF's import would), the page scripts parse, and the packaging makes a
// ZIP claude.ai takes and a Claude Code plugin. The page scripts' behaviour in a real page: tests/skill-browser.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const build = require('../skill/build');
const { pack, unzip, crc32 } = require('../skill/package');
const { checkMod } = require('../skill/trif/scripts/check-mod');
const share = require('../helper/lib/share');

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'skill', 'trif');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const head = (extra, matches = ['https://x.com/*']) => `// ==WebMod==\n// @name Test mod\n// @description Hides the trending box on the side\n${matches.map((m) => `// @match ${m}\n`).join('')}// @risk 0 render-only\n${extra}// ==/WebMod==\n`;

test('skill/trif is what skill/build.js makes (run node skill/build.js after changing the guides or skill/src)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'skill', 'build.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('SKILL.md: the name, a description within claude.ai\'s 200 characters, and every file it points to is there', () => {
  const text = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const { name, description } = build.checkFrontmatter(text);
  assert.equal(name, 'trif');
  assert.ok(description.length <= 200, `${description.length} characters`);
  assert.throws(() => build.checkFrontmatter(`---\nname: trif\ndescription: ${'x'.repeat(201)}\n---\n`), /201 characters/);
  // (short: the details are in the references)
  assert.ok(text.split('\n').length < 160, 'SKILL.md stays short');
  for (const f of fs.readdirSync(path.join(SKILL, 'references'))) assert.ok(text.includes(`references/${f}`), `SKILL.md mentions references/${f}`);
  const all = [text, ...fs.readdirSync(path.join(SKILL, 'references')).map((f) => fs.readFileSync(path.join(SKILL, 'references', f), 'utf8'))].join('\n');
  for (const m of all.matchAll(/(?:^|[\s(`])((?:references|scripts)\/[\w./-]+\.(?:md|js))/g)) assert.ok(fs.existsSync(path.join(SKILL, m[1])), `${m[1]} is in the skill`);
});

test('the references cut from the guides have the sections they should, and a moved heading fails the build', () => {
  const ref = (f) => fs.readFileSync(path.join(SKILL, 'references', f), 'utf8');
  assert.match(ref('style-mods.md'), /### Style mods: start here[\s\S]*Scrolling feeds: filter the data[\s\S]*### A style section in boxed and free mods/);
  assert.match(ref('boxed-mods.md'), /## Boxed mods: when a style mod isn[\s\S]*### Powers: what a boxed mod can ask for[\s\S]*`site-data`/);
  assert.match(ref('checks.md'), /## Mods that wait for the user's OK[\s\S]*## Writing mods TRIF can read[\s\S]*## Account safety[\s\S]*## Safety rules/);
  assert.match(ref('free-mods.md'), /## Where mods run[\s\S]*### 2\. Filtering data before the app sees it[\s\S]*## Keep mods fast/);
  assert.match(ref('mod-format.md'), /## Mod files[\s\S]*@description[\s\S]*### Mods for several sites/);
  assert.match(ref('finish-the-job.md'), /## Finish the job/);
  for (const f of ['style-mods.md', 'checks.md']) assert.ok(!/## The CLI/.test(ref(f)), `${f} doesn't carry the CLI table`);
  assert.throws(() => build.between('AGENTS.md', '## No such heading', null), /a heading moved/);
  assert.throws(() => build.between('AGENTS.md', '## Mod files', '## No such heading'), /a heading moved/);
});

test('the checker\'s libraries are TRIF\'s own, unchanged, and every one they require is copied', () => {
  for (const lib of build.LIBS) {
    const copy = fs.readFileSync(path.join(SKILL, 'scripts', 'lib', `${lib}.js`), 'utf8');
    const own = fs.readFileSync(path.join(ROOT, 'helper', 'lib', `${lib}.js`), 'utf8');
    assert.equal(copy.slice(copy.indexOf('\n') + 1), own, `${lib}.js is TRIF's`);
    for (const m of own.matchAll(/require\('\.\/([\w-]+)'\)/g)) assert.ok(build.LIBS.includes(m[1]), `${lib}.js requires ./${m[1]}: add it to LIBS in skill/build.js`);
  }
  // (and it runs from the skill alone: a copy of the folder anywhere, no repository around it)
  const dir = tmp('trif-skill-copy-');
  fs.cpSync(SKILL, path.join(dir, 'trif'), { recursive: true });
  const f = path.join(dir, 'calm.js');
  fs.writeFileSync(f, `${head('// @style\n')}{ "hide": ["[data-testid=trend]"] }\n`);
  const r = spawnSync(process.execPath, [path.join(dir, 'trif', 'scripts', 'check-mod.js'), f], { encoding: 'utf8', cwd: dir });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok: .*calm\.js \(a style mod\)/m);
  assert.match(r.stdout, /TRIF will add it as x\.com\/calm/);
});

test('check-mod: style, boxed and free mods read as TRIF reads them', () => {
  const style = checkMod(`${head('// @style\n')}{ "hide": ["[data-testid=trend]"], "filter": [{ "items": "article", "hideIfText": "Promoted" }] }\n`, { fileName: 'calm.js' });
  assert.deepEqual([style.ok, style.tier, style.id, style.holds, style.warnings], [true, 'style', 'x.com/calm', [], []]);
  const loads = checkMod(`${head('// @style\n')}{ "css": "body { background-image: url(https://evil.example/p.png) }" }\n`, { fileName: 'calm.js' });
  assert.equal(loads.ok, false);
  assert.match(loads.problems.join(' '), /url|address|load/i);
  const badJson = checkMod(`${head('// @style\n')}{ "hide": [ }\n`, { fileName: 'calm.js' });
  assert.equal(badJson.ok, false);

  const boxed = checkMod(`${head('// @boxed\n')}trif.observe('article', (a) => a.classes.add('trif-box-seen'));\n`, { fileName: 'mark.js' });
  assert.deepEqual([boxed.ok, boxed.tier, boxed.holds, boxed.sandbox], [true, 'boxed', [], []]);
  const boxedDoc = checkMod(`${head('// @boxed\n')}document.querySelector('x').remove();\n`, { fileName: 'mark.js' });
  assert.equal(boxedDoc.ok, false);
  assert.match(boxedDoc.sandbox.join(' '), /document/);
  const powered = checkMod(`${head('// @boxed\n// @powers read-drafts\n')}page.on('input', (e) => trif.log(e.data));\n`, { fileName: 'drafts.js' });
  assert.ok(powered.holds.length, 'a power that asks is on the hold');
  const unknownPower = checkMod(`${head('// @boxed\n// @powers teleport\n')}1;\n`, { fileName: 'x.js' });
  assert.equal(unknownPower.ok, false);

  const sends = checkMod(`${head('')}(() => { fetch('/api/like', { method: 'POST' }); })();\n`, { fileName: 'liker.js' });
  assert.equal(sends.tier, 'free');
  assert.match(sends.holds.join(' '), /send/);
  const boxable = checkMod(`${head('')}(() => { const s = document.createElement('style'); s.textContent = 'a { color: red }'; document.documentElement.append(s); })();\n`, { fileName: 'red.js' });
  assert.match(boxable.warnings.join(' '), /boxed/);
  const syntax = checkMod(`${head('')}(() => { if ( })();\n`, { fileName: 'x.js' });
  assert.equal(syntax.ok, false);
  assert.match(syntax.problems.join(' '), /doesn't parse/);

  assert.equal(checkMod('alert(1)\n', { fileName: 'x.js' }).ok, false, 'no header: TRIF won\'t import it');
  const noRisk = checkMod('// ==WebMod==\n// @name A\n// @match https://x.com/*\n// ==/WebMod==\n{ "hide": ["a"] }\n'.replace('// @name A\n', '// @name A\n// @style\n'), { fileName: 'a.js' });
  assert.match(noRisk.warnings.join(' '), /@description/);
  assert.match(noRisk.warnings.join(' '), /@risk/);
  const two = checkMod(`${head('// @style\n', ['https://x.com/*', 'https://example.org/*'])}{ "hide": ["a"] }\n`, { fileName: 'a.js' });
  assert.equal(two.id, null);
  assert.match(two.warnings.join(' '), /ask the user which site/);
  assert.equal(checkMod(`${head('// @style\n', ['https://x.com/*', 'https://example.org/*'])}{ "hide": ["a"] }\n`, { fileName: 'a.js', site: 'x.com' }).id, 'x.com/a');
  const named = checkMod(`${head('// @style\n')}{ "hide": ["a"] }\n`, { fileName: 'x.com-Calm Feed.js' });
  assert.equal(named.id, 'x.com/x-com-calm-feed');
  assert.ok(named.warnings.some((w) => /becomes "x-com-calm-feed"/.test(w)));
  const section = checkMod(`${head('// @boxed\n')}// ==Style==\n// { "css": ["a { width: var(--w); }"], "settings": { "w": { "type": "number", "value": 5, "min": 1, "max": 9, "unit": "px" } } }\n// ==/Style==\ntrif.log(trif.style.w);\n`, { fileName: 's.js' });
  assert.equal(section.ok, true, section.problems.join());
  assert.equal(section.styleCss, 'a { width: 5px; }');
  // (trif.style.<setting> is the guide's own way; an element's .style.x is still the sandbox's no)
  const elStyle = checkMod(`${head('// @boxed\n')}trif.observe('a', (a) => { a.style.color = 'red'; });\n`, { fileName: 's.js' });
  assert.match(elStyle.sandbox.join(' '), /\.style\./);
});

test('check-mod files a mod where TRIF\'s import does (helper/lib/share.js importMod), for the same file', () => {
  const home = tmp('trif-skill-import-');
  const ws = { home, modsDir: path.join(home, 'sites') };
  const cases = [
    ['calm.js', ['https://x.com/*', 'https://twitter.com/*'], ''],
    ['calm.js', ['https://x.com/*', 'https://*.x.com/*'], ''],
    ['Dark Mode.js', ['https://www.wikipedia.org/*'], ''],
    ['wide.js', ['*://news.ycombinator.com/*'], ''],
    ['all.js', ['*://*/*'], 'all-sites'],
    ['two.js', ['https://a.example/*', 'https://b.example/*'], ''],
    ['nomatch.js', [], ''],
    ['forced.js', ['https://a.example/*', 'https://b.example/*'], 'b.example'],
  ];
  for (const [name, matches, site] of cases) {
    const text = `${head('// @style\n', matches)}{ "hide": ["a"] }\n`;
    const mine = checkMod(text, { fileName: name, site });
    const theirs = share.importMod(ws, { text, name, site, choice: 'copy' });
    if (theirs.needsSite) assert.equal(mine.id, null, `${name}: TRIF asks for the site, and so the checker says it will`);
    else assert.equal(mine.id, theirs.id.replace(/-\d+$/, ''), `${name}: filed as TRIF files it`);
  }
});

test('the page scripts parse as scripts, say they\'re ready, and try-style carries TRIF\'s own runtime with its undo hooks', () => {
  const dir = path.join(SKILL, 'scripts', 'page');
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotThrow(() => new vm.Script(text, { filename: f }), f);
    assert.match(text, /ready/, `${f} says it's ready`);
  }
  const tryStyle = fs.readFileSync(path.join(dir, 'try-style.js'), 'utf8');
  const runtime = require('../helper/lib/rules').rulesRuntime.toString();
  // (the runtime as the helper sends it, but for the two lines that note what it changes)
  assert.ok(tryStyle.includes(runtime.split('\n').slice(0, 12).join('\n')), 'TRIF\'s runtime, as it is');
  assert.match(tryStyle, /__t\.hid\(el\)/);
  assert.match(tryStyle, /__t\.txt\(n\)/);
  const sweep = fs.readFileSync(path.join(dir, 'sweep.js'), 'utf8');
  assert.ok(sweep.includes(fs.readFileSync(path.join(ROOT, 'extension', 'sweep.js'), 'utf8').slice(fs.readFileSync(path.join(ROOT, 'extension', 'sweep.js'), 'utf8').indexOf('async function sweepPage('))), 'trif sweep as it is');
});

test('packaging: a ZIP with trif/SKILL.md at its top, the same bytes each time, and a Claude Code plugin with its marketplace', () => {
  const out = tmp('trif-skill-pack-');
  const r = pack(out);
  const entries = unzip(fs.readFileSync(r.zip));
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('trif/SKILL.md'));
  assert.ok(names.every((n) => n.startsWith('trif/')), 'one folder at the top');
  for (const e of entries) {
    assert.equal(crc32(e.data), e.crc, `${e.name}: its checksum`);
    assert.equal(e.data.toString('utf8'), fs.readFileSync(path.join(SKILL, e.name.slice('trif/'.length)), 'utf8'), `${e.name} as built`);
  }
  assert.equal(names.length, fs.readdirSync(SKILL, { recursive: true }).filter((p) => fs.statSync(path.join(SKILL, p)).isFile()).length);
  const again = tmp('trif-skill-pack-');
  pack(again);
  assert.ok(fs.readFileSync(r.zip).equals(fs.readFileSync(path.join(again, 'trif-skill.zip'))), 'the same bytes');
  // (another tool reads it too, where there is one)
  const unzipTool = spawnSync('unzip', ['-tq', r.zip], { encoding: 'utf8' });
  if (!unzipTool.error) assert.equal(unzipTool.status, 0, unzipTool.stdout + unzipTool.stderr);

  const plugin = JSON.parse(fs.readFileSync(path.join(r.plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'trif');
  assert.equal(plugin.version, require('../package.json').version);
  assert.equal(plugin.description, build.checkFrontmatter(fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8')).description);
  assert.ok(fs.existsSync(path.join(r.plugin, 'skills', 'trif', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(r.plugin, 'skills', 'trif', 'scripts', 'check-mod.js')));
  const market = JSON.parse(fs.readFileSync(r.marketplace, 'utf8'));
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [['trif', './trif-plugin']]);
});

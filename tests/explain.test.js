'use strict';
// The terms' table (extension/explain.json): its four layers whole, every label and line the same as the
// code's (boxpowers.js, combinations.js, extension/modlevel.js, the panel's own), the panel's "more"
// (extension/explain.js), `trif explain`, docs/EXPLAIN.md written out from it, and AGENTS.md's pointer.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const X = require('../helper/lib/explain');
const B = require('../helper/lib/boxpowers');
const C = require('../helper/lib/combinations');
const { runCli, tempDir } = require('./fake-extension');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const loadPanel = async () => { const m = await import('../extension/explain.js'); m.setExplain(X.TABLE); return m; };
const key = (t) => `${t.group}/${t.id}`;
const byKey = (k) => X.TERMS.find((t) => key(t) === k);
const shows = (t, layer) => !(t.drafted || []).includes(layer);
// (a sentence a layer holds, its {placeholders} standing for anything)
const template = (s) => new RegExp(`^${String(s).split(/\{[^}]+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')}$`);
// (sentences: a full stop, ? or ! before a space and a capital or a quote)
const sentences = (s) => String(s).trim().split(/(?<=[.!?])\s+(?=[A-Z"“({])/);

test('every term has its four layers, once', () => {
  const seen = new Set();
  const groups = X.GROUPS.map((g) => g.id);
  assert.ok(X.TERMS.length >= 64, `${X.TERMS.length} terms`);
  for (const t of X.TERMS) {
    assert.ok(groups.includes(t.group), `${key(t)}: no such group`);
    assert.ok(!seen.has(key(t)), `${key(t)} twice`);
    seen.add(key(t));
    assert.match(t.id, /^[a-z][a-z0-9-]*$/, key(t));
    for (const f of ['label', 'line', 'explanation']) assert.ok(typeof t[f] === 'string' && t[f].trim() === t[f] && t[f], `${key(t)}: ${f}`);
    assert.ok(!/^NEW:/.test(t.label) && !/^NEW:/.test(t.line), `${key(t)}: a draft's mark left in`);
    assert.ok(t.label.split(/\s+/).length <= 4, `${key(t)}: label "${t.label}" is more than a few words`);
    assert.ok(Array.isArray(t.agent_notes) && t.agent_notes.length && t.agent_notes.every((n) => typeof n === 'string' && n.trim()), `${key(t)}: agent notes`);
    for (const d of t.drafted || []) assert.ok(['label', 'line'].includes(d), `${key(t)}: drafted ${d}`);
    assert.ok(t.approved, `${key(t)}: approved`);
  }
  for (const g of groups) assert.ok(X.TERMS.some((t) => t.group === g), `group ${g} is empty`);
});

test('no explanation is over four sentences', () => {
  for (const t of X.TERMS) {
    const n = sentences(t.explanation).length;
    assert.ok(n >= 1 && n <= 4, `${key(t)}: ${n} sentences: ${t.explanation}`);
  }
});

test('the powers: every one in boxpowers.js, in its order, plus @migrate; names and lines as the hold says them', () => {
  const powers = X.TERMS.filter((t) => t.group === 'powers');
  assert.deepEqual(powers.map((t) => t.id), [...B.NAMES, 'migrate']);
  assert.deepEqual(B.NAMES, C.POWERS);
  // (a hold's sentence for each, with some values for the powers that take them)
  const ARGS = {
    'site-storage': ['local:prefs'], 'image-variants': ['pbs.twimg.com name=orig'], 'search-box': ['https://x.com/search?q={q}'], 'go-to': ['/home'],
    embeds: ['www.youtube.com/embed/'], 'rewrite-requests': ['HomeTimeline variables.sort=Recent'], 'block-events': ['keydown'], 'page-events': ['my:event'],
    click: ['Like: button.like'],
  };
  for (const t of powers) {
    if (t.id === 'migrate') {
      assert.equal(t.label, '@migrate');
      const need = B.powerNeeds({ site: 'x.com', powers: [], powerArgs: { migrate: ['local:old-prefs'] } }).find((n) => n.power === 'migrate');
      assert.match(`It ${need.fact}.`, template(t.line), 'migrate');
      continue;
    }
    assert.equal(t.label, t.id);
    const said = `It ${B.MENU[t.id].hold('x.com', ARGS[t.id])}.`;
    assert.match(said, template(t.line), `${t.id}: the hold says "${said}"`);
    // (without values too, where the hold has words for that)
    if (!ARGS[t.id]) assert.equal(said, t.line.replace('{site}', 'x.com'), t.id);
  }
});

test('the combination warnings: each line as the hold says it; one without an explanation yet shows its line alone', async (t) => {
  const P = await loadPanel();
  const table = X.TERMS.filter((x) => x.group === 'warnings');
  for (const w of table) if (w.id !== 'many-powers') assert.ok(C.WARNINGS[w.id], `the table's ${w.id} isn't a warning in combinations.js`);
  const missing = [];
  for (const [id, w] of Object.entries(C.WARNINGS)) {
    const entry = byKey(`warnings/${id}`);
    const line = `Together, it ${w.fact}.`;
    if (!entry) { missing.push(id); assert.equal(P.warningByLine(line), null); assert.equal(P.moreText(P.warningByLine(line)), ''); continue; }
    assert.equal(entry.line, line, id);
    assert.equal(P.warningByLine(line), entry, id);
  }
  assert.equal(byKey('warnings/many-powers').line, C.MANY);
  assert.equal(P.warningByLine(C.MANY).id, 'many-powers');
  // (a warning a newer combinations.js adds: listed here, not a failure)
  if (missing.length) t.diagnostic(`warning: no explanation in extension/explain.json for ${missing.join(', ')} (their line shows alone)`);
});

test('the row chips: the words and lines extension/modlevel.js shows', async () => {
  const { modChip, levelWords } = await import('../extension/modlevel.js');
  const n = byKey('chips/n-powers');
  assert.equal(n.label, '{N} power(s)');
  assert.equal(modChip({ sandboxed: true, powers: ['sound'] }, 'x.com').text, '1 power');
  assert.equal(modChip({ sandboxed: true, powers: ['sound', 'controls'] }, 'x.com').text, '2 powers');
  const noticeable = byKey('chips/noticeable');
  assert.ok(modChip({ sandboxed: true, powers: ['click'] }, 'x.com').text.endsWith(noticeable.label));
  assert.match(levelWords({ sandboxed: true, powers: ['click'] }, 'x.com'), template(noticeable.line));
  const changes = byKey('chips/changes-requests');
  assert.ok(modChip({ sandboxed: true, powers: ['rewrite-requests'] }, 'x.com').text.endsWith(changes.label));
  assert.match(levelWords({ sandboxed: true, powers: ['rewrite-requests'] }, 'x.com'), template(changes.line));
});

test('the panel\'s own labels and lines (tiers, tags, agent levels, faces, chat mods) are in its code', async () => {
  const { GROUP_NAMES } = await import('../extension/lib.js');
  // (the code as its strings read: \' unescaped)
  const js = ['sidepanel.js', 'lib.js', 'agentsites.js', 'faces.js', 'login.js'].map((f) => read(`extension/${f}`)).join('\n').replace(/\\'/g, '\'');
  const html = read('extension/sidepanel.html');
  const src = `${js}\n${html}`;
  // (each part of a sentence between its placeholders; for the ones the code builds in pieces, the pieces)
  const PIECES = {
    'tags/error': { label: ['\'error\'', '} errors`'], line: ['`New error${first.line ? ` at line ${first.line}` : \'\'}: ${first.message}`'] },
  };
  const inCode = (t, layer) => {
    const pieces = PIECES[key(t)]?.[layer] || t[layer].split(/\{[^}]+\}/).map((p) => p.trim()).filter((p) => p.length > 1);
    for (const p of pieces) assert.ok(src.includes(p), `${key(t)} ${layer}: "${p}" isn't in the panel's code`);
  };
  const quoted = (t) => assert.ok([`'${t.label}'`, `>${t.label}<`, `"${t.label}"`].some((q) => src.includes(q)), `${key(t)}: the label "${t.label}" isn't in the panel's code`);
  const TIERS = { 'style-mods': 'rules', 'boxed-mods': 'sandboxed', 'free-mods': 'page' };
  for (const t of X.TERMS) {
    if (t.group === 'tiers') { assert.equal(t.label, GROUP_NAMES[TIERS[t.id]]); inCode(t, 'line'); continue; }
    if (t.group === 'agent-levels') { assert.ok(html.includes(`data-level="${t.id}"`) && html.includes(`<b>${t.label}</b><span>${t.line}</span>`), `${key(t)}: the agent menu says otherwise`); continue; }
    if (!['tags', 'faces', 'chat-mods'].includes(t.group)) continue;
    if (shows(t, 'label')) { if (PIECES[key(t)]?.label) inCode(t, 'label'); else quoted(t); }
    if (shows(t, 'line')) inCode(t, 'line');
  }
});

test('"more": what comes after the line, never a placeholder, for every term the panel explains', async () => {
  const P = await loadPanel();
  // (the approval card's powers and warnings, the code card's too with its level, the tiers' notes; the
  // "{N} powers" chip only has its hover)
  for (const t of X.TERMS.filter((x) => ['tiers', 'powers', 'warnings'].includes(x.group) || ['chips/noticeable', 'chips/changes-requests'].includes(key(x)))) {
    const more = P.moreText(t);
    assert.ok(more, `${key(t)}: nothing to show`);
    assert.notEqual(more, t.explanation, `${key(t)}: its explanation doesn't start with its line`);
    assert.ok(t.explanation.endsWith(more), key(t));
    assert.ok(!/\{[^}]+\}/.test(more), `${key(t)}: "more" would show a placeholder: ${more}`);
  }
  assert.equal(P.term('powers', 'read-drafts').id, 'read-drafts');
  assert.equal(P.term('powers', 'not-a-power'), null);
  assert.equal(P.moreText(null), '');
  assert.equal(P.moreText({ line: 'It can play sounds.', explanation: 'It can play sounds. Only its own.' }), 'Only its own.');
  assert.equal(P.moreText({ line: 'it can look.', explanation: 'It can look: and more.' }), 'It can look: and more.', 'not its line: all of it');
  // (an empty table: no "more" anywhere)
  P.setExplain(null);
  assert.equal(P.term('powers', 'read-drafts'), null);
  P.setExplain(X.TABLE);
});

test('the panel uses "more" and "less" only, from explain.js', () => {
  const js = read('extension/sidepanel.js');
  assert.match(js, /from '\.\/explain\.js'/);
  assert.match(js, /await loadExplain\(\)/);
  assert.match(js, /el\('button', 'more-btn', 'more'\)/);
  assert.match(js, /'less' : 'more'|'more' : 'less'/);
  // (the cards scroll up and down only)
  const css = read('extension/sidepanel.css');
  assert.match(css, /\.approval \{[^}]*overflow-y: auto; overflow-x: hidden;/);
});

test('docs/EXPLAIN.md is the table written out', () => {
  assert.equal(read('docs/EXPLAIN.md'), X.toMarkdown(), 'regenerate it: node -e "process.stdout.write(require(\'./helper/lib/explain\').toMarkdown())" > docs/EXPLAIN.md');
  for (const t of X.TERMS) assert.ok(X.toMarkdown().includes(t.explanation), key(t));
});

test('AGENTS.md points at trif explain and names every power', () => {
  const md = read('helper/workspace/AGENTS.md');
  assert.match(md, /`trif explain/);
  const line = md.split('\n').find((l) => l.includes('trif explain') && l.includes('read-drafts')) || '';
  for (const p of B.NAMES) assert.ok(line.includes(`\`${p}\``), `AGENTS.md's powers list: ${p}`);
});

test('side-panel runs may run trif explain, and read its table', () => {
  const cli = read('helper/cli.js');
  const notInRuns = /const NOT_IN_RUNS = new Set\(\[([^\]]*)\]\)/.exec(cli)[1];
  assert.ok(!notInRuns.includes('\'explain\''));
  const { trifCode } = require('../helper/lib/runs');
  assert.ok(trifCode().includes(fs.realpathSync(path.join(REPO, 'extension', 'explain.json'))));
});

test('trif explain: the terms by group; one by id or label, any case; two that share a name; none', async () => {
  const home = tempDir();
  const list = await runCli(['explain'], { home });
  assert.equal(list.code, 0, list.stderr);
  for (const g of X.GROUPS) assert.ok(list.stdout.includes(`\n${g.title}:\n`), g.title);
  for (const t of X.TERMS) assert.match(list.stdout, new RegExp(`^  ${t.id} +${t.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));

  const one = await runCli(['explain', 'read-drafts'], { home });
  assert.equal(one.code, 0, one.stderr);
  const rd = byKey('powers/read-drafts');
  assert.ok(one.stdout.startsWith('read-drafts  (Powers: powers/read-drafts)\n'));
  assert.ok(one.stdout.includes(`Line: ${rd.line}\n`) && one.stdout.includes(`\n${rd.explanation}\n`) && one.stdout.includes('For agents:\n'));
  for (const n of rd.agent_notes) assert.ok(one.stdout.includes(`- ${n}`));

  const ask = await runCli(['explain', 'ASK', 'FIRST'], { home });
  assert.equal(ask.code, 0, ask.stderr);
  assert.ok(ask.stdout.startsWith('Ask first  (Agent on this site: agent-levels/ask)'));
  assert.ok((await runCli(['explain', '@MIGRATE'], { home })).stdout.startsWith('@migrate  (Powers: powers/migrate)'));
  assert.ok((await runCli(['explain', 'changes requests'], { home })).stdout.startsWith('changes requests  (Row chips: chips/changes-requests)'));

  const off = await runCli(['explain', 'off'], { home });
  assert.equal(off.code, 0);
  assert.ok(off.stdout.includes('agent-levels/off') && off.stdout.includes('faces/off'));
  const offOne = await runCli(['explain', 'agent-levels/off', '--json'], { home });
  assert.deepEqual(JSON.parse(offOne.stdout).map(key), ['agent-levels/off']);

  const none = await runCli(['explain', 'no-such-term'], { home });
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no term "no-such-term" \(trif explain lists them\)/);

  // inside a side-panel run, too (it needs no helper)
  const inRun = await runCli(['explain', 'sound'], { home, env: { TRIF_RUN_TOKEN: 'x' } });
  assert.equal(inRun.code, 0, inRun.stderr);
  assert.ok(inRun.stdout.startsWith('sound  (Powers: powers/sound)'));

  const help = await runCli(['help'], { home });
  assert.match(help.stdout, /explain \[TERM\] +what a word the side panel shows means/);
});

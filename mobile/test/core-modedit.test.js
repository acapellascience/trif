'use strict';
// mobile/shared/core/mod-edit.js (Tim, 11-19: a chat's changes to a mod as edit blocks, not the whole file again; a
// whole file shortened with "// rest unchanged" caught), also through the generated mobile/shared/gen/core.js.
// TRIF_EDIT_CORPUS=<folder of real mods> (read-only copies, never ~/.trif itself): none may read as shortened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const E = require(path.join(__dirname, '..', 'shared', 'core', 'mod-edit.js'));

const MOD = [
  '// ==WebMod==',
  '// @name        Calmer feed',
  '// @match       https://www.youtube.com/*',
  '// @style',
  '// ==/WebMod==',
  '({',
  '  "css": [',
  '    "#related { display: none; }",',
  '    "ytd-rich-shelf-renderer { display: none; }",',
  '    "#chips { opacity: 0.6; }"',
  '  ]',
  '})',
  '',
].join('\n');
const tag = (code) => `TRIF edit youtube.com/calmer-feed ${E.version(code)}`;
const block = (search, replace) => ['<<<<<<< SEARCH', ...search, '=======', ...replace, '>>>>>>> REPLACE'].join('\n');
const edit = (code, ...blocks) => E.parse(['```', tag(code), ...blocks, '```'].join('\n')).edits[0];

test('version: 8 hex digits, line ends evened out, UTF-8 (not UTF-16) bytes', () => {
  assert.match(E.version(MOD), /^[0-9a-f]{8}$/);
  assert.equal(E.version(MOD), E.version(MOD.replace(/\n/g, '\r\n')));
  assert.notEqual(E.version(MOD), E.version(`${MOD} `));
  assert.equal(E.version(''), '811c9dc5'); // FNV-1a's offset basis
  assert.equal(E.version('a'), 'e40c292c'); // the published FNV-1a 32 vector for "a"
  assert.equal(E.version('é'), (() => { let h = 0x811c9dc5; for (const b of Buffer.from('é')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); })());
  assert.equal(E.version('😀x'), (() => { let h = 0x811c9dc5; for (const b of Buffer.from('😀x')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); })());
});

test('a whole file is no edit (parse null): read as before', () => {
  assert.equal(E.parse(MOD), null);
  assert.equal(E.parse(`Here it is:\n\`\`\`js\n${MOD}\`\`\``), null);
  assert.equal(E.has(MOD), false);
  // (a mod whose code has "=======" in a string is still no edit)
  assert.equal(E.parse(`${MOD}\nconst line = \`\n=======\n\`;`), null);
});

test('exact: one block, the header\'s file and version', () => {
  const e = edit(MOD, block(['    "#chips { opacity: 0.6; }"'], ['    "#chips { opacity: 0.3; }"']));
  assert.equal(e.file, 'youtube.com/calmer-feed');
  assert.equal(e.version, E.version(MOD));
  const r = E.apply(MOD, e);
  assert.ok(r.ok);
  assert.equal(r.code, MOD.replace('opacity: 0.6', 'opacity: 0.3'));
  assert.deepStrictEqual(r.changes, [{ line: 10, removed: ['    "#chips { opacity: 0.6; }"'], added: ['    "#chips { opacity: 0.3; }"'], above: null, below: null, loose: false }]);
});

test('whitespace-tolerant: other indentation, trailing spaces; the mod\'s indentation kept', () => {
  const e = edit(MOD, block(['"#related { display: none; }",   ', '"ytd-rich-shelf-renderer { display: none; }",'], ['"#related { display: none; }",', '"#comments { display: none; }",', '"ytd-rich-shelf-renderer { display: none; }",']));
  const r = E.apply(MOD, e);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.code.includes('    "#related { display: none; }",\n    "#comments { display: none; }",\n    "ytd-rich-shelf-renderer'), r.code);
  assert.equal(r.changes[0].loose, true);
  // (compact: the one line added, with the lines around it)
  assert.deepStrictEqual(r.changes[0].removed, []);
  assert.deepStrictEqual(r.changes[0].added, ['    "#comments { display: none; }",']);
  assert.equal(r.changes[0].above, '    "#related { display: none; }",');
  assert.equal(r.changes[0].below, '    "ytd-rich-shelf-renderer { display: none; }",');
  // (blank lines around a block's text don't count)
  const e2 = edit(MOD, block(['', '    "#chips { opacity: 0.6; }"', ''], ['', '    "#chips { opacity: 1; }"', '']));
  assert.ok(E.apply(MOD, e2).code.includes('"#chips { opacity: 1; }"\n  ]'));
});

test('several blocks, applied in order; several code blocks of one reply joined', () => {
  const text = ['```', tag(MOD), block(['    "#related { display: none; }",'], ['    "#related { display: block; }",']), '```', 'and', '```',
    block(['    "#chips { opacity: 0.6; }"'], ['    "#chips { opacity: 0.2; }"']), '```'].join('\n');
  const p = E.parse(text);
  assert.equal(p.edits.length, 1); // (the second block has no header: the text's one header)
  assert.equal(p.edits[0].blocks.length, 2);
  const r = E.apply(MOD, p.edits[0]);
  assert.ok(r.ok);
  assert.ok(r.code.includes('display: block') && r.code.includes('opacity: 0.2'));
  assert.deepStrictEqual(r.changes.map((c) => c.line), [8, 10]);
});

test('a block against the running result: its SEARCH spans a line an earlier block changed', () => {
  const e = edit(MOD,
    block(['    "#chips { opacity: 0.6; }"'], ['    "#chips { opacity: 0.4; }"']),
    block(['    "ytd-rich-shelf-renderer { display: none; }",', '    "#chips { opacity: 0.4; }"'], ['    "#chips { opacity: 0.4; }"']));
  const r = E.apply(MOD, e);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(!r.code.includes('ytd-rich-shelf-renderer') && r.code.includes('opacity: 0.4'));
  // (against the original text the second wouldn't match: in sequence it does)
  assert.equal(E.apply(MOD, { version: E.version(MOD), blocks: [e.blocks[1]] }).why, 'nomatch');
});

test('a block matching nowhere, or twice: nothing applied, which block said', () => {
  const none = E.apply(MOD, edit(MOD, block(['    "#chips { opacity: 0.6; }"'], ['x']), block(['nothing like this'], ['y'])));
  assert.deepStrictEqual(none, { ok: false, why: 'nomatch', block: 1, count: 0 });
  const twice = E.apply(MOD, edit(MOD, block(['display: none; }",'], ['x'])));
  assert.equal(twice.why, 'nomatch'); // (a fragment of a line isn't a line)
  const dup = `${MOD}// a\n// a\n`;
  assert.deepStrictEqual(E.apply(dup, edit(dup, block(['// a'], ['// b']))), { ok: false, why: 'many', block: 0, count: 2 });
  // (twice when whitespace is ignored, once exactly: the exact one)
  const near = `${MOD}  // a\n// a\n`;
  assert.ok(E.apply(near, edit(near, block(['// a'], ['// b']))).ok);
  const loose2 = `${MOD}  // a\n    // a\n`;
  assert.equal(E.apply(loose2, edit(loose2, block([' // a'], ['// b']))).why, 'many');
});

test('a stale version (the mod changed since), or none: nothing applied', () => {
  const e = edit(MOD, block(['    "#chips { opacity: 0.6; }"'], ['    "#chips { opacity: 0.3; }"']));
  const now = MOD.replace('#related', '#secondary');
  assert.deepStrictEqual(E.apply(now, e), { ok: false, why: 'stale' });
  const bare = E.parse(`TRIF edit youtube.com/calmer-feed\n${block(['    "#chips { opacity: 0.6; }"'], ['x'])}`).edits[0];
  assert.equal(bare.version, null);
  assert.deepStrictEqual(E.apply(MOD, bare), { ok: false, why: 'noversion' });
  const none = E.parse(block(['    "#chips { opacity: 0.6; }"'], ['x'])).edits[0];
  assert.equal(none.file, null);
  assert.equal(E.apply(MOD, none).why, 'noversion');
});

test('insert (the anchor kept) and delete (an empty replacement)', () => {
  const ins = E.apply(MOD, edit(MOD, block(['  ]'], ['    , "#guide { display: none; }"', '  ]'])));
  assert.ok(ins.ok);
  assert.ok(ins.code.includes('0.6; }"\n    , "#guide { display: none; }"\n  ]'));
  assert.deepStrictEqual(ins.changes[0].removed, []);
  assert.equal(ins.changes[0].below, '  ]');
  const del = E.apply(MOD, edit(MOD, block(['    "ytd-rich-shelf-renderer { display: none; }",'], [])));
  assert.ok(del.ok);
  assert.ok(!del.code.includes('ytd-rich-shelf-renderer'));
  assert.equal(del.code.split('\n').length, MOD.split('\n').length - 1);
  assert.deepStrictEqual(del.changes[0].added, []);
  // (an empty SEARCH is refused: a new mod is a whole file)
  assert.deepStrictEqual(E.parse(`${tag(MOD)}\n${block([], ['x'])}`), { edits: [], problems: ['empty'] });
});

test('CRLF: the mod\'s line ends kept, a reply\'s CRLF read', () => {
  const crlf = MOD.replace(/\n/g, '\r\n');
  const text = ['```', tag(crlf), block(['    "#chips { opacity: 0.6; }"'], ['    "#chips { opacity: 0.5; }"']), '```'].join('\r\n');
  const r = E.apply(crlf, E.parse(text).edits[0]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.code, crlf.replace('0.6', '0.5'));
  assert.ok(!/[^\r]\n/.test(r.code));
});

test('no change at all is said (nochange), not applied', () => {
  assert.equal(E.apply(MOD, edit(MOD, block(['  ]'], ['  ]']))).why, 'nochange');
});

test('headers: forms a model writes; several files in one reply; markers 5-9 long; problems', () => {
  const v = E.version(MOD);
  for (const h of [`TRIF edit youtube.com/calmer-feed ${v}`, `// TRIF edit youtube.com/calmer-feed ${v}`, `# TRIF edit: youtube.com/calmer-feed version ${v}`,
    `\`TRIF edit youtube.com/calmer-feed ${v}\``, `TRIF EDIT youtube.com/calmer-feed @${v}`, `trif edit \`youtube.com/calmer-feed\` v${v}`, `/* TRIF edit youtube.com/calmer-feed ${v} */`]) {
    const p = E.parse(`${h}\n${block(['  ]'], ['  ] '])}`);
    assert.deepStrictEqual([p.edits[0].file, p.edits[0].version], ['youtube.com/calmer-feed', v], h);
  }
  const two = E.parse([`TRIF edit a.com/x 0000000a`, block(['a'], ['b']), `TRIF edit b.com/y 0000000b`, block(['c'], ['d']), block(['e'], ['f'])].join('\n'));
  assert.deepStrictEqual(two.edits.map((e) => [e.file, e.version, e.blocks.length]), [['a.com/x', '0000000a', 1], ['b.com/y', '0000000b', 2]]);
  const long = E.parse(`${tag(MOD)}\n<<<<< SEARCH\n  ]\n=========\n  ]\n>>>>>>>>> REPLACE`);
  assert.equal(long.edits[0].blocks.length, 1);
  assert.deepStrictEqual(E.parse(`${tag(MOD)}\n<<<<<<< SEARCH\na\n>>>>>>> REPLACE`).problems, ['nomid']);
  assert.deepStrictEqual(E.parse(`${tag(MOD)}\n<<<<<<< SEARCH\na\n=======\nb\n<<<<<<< SEARCH\nc\n=======\nd\n>>>>>>> REPLACE`).problems, ['unclosed']);
  // (an edit quoting the mod's header lines is an edit: its ==WebMod== lines are SEARCH text)
  const hdr = E.apply(MOD, edit(MOD, block(['// @match       https://www.youtube.com/*'], ['// @match       https://*.youtube.com/*'])));
  assert.ok(hdr.ok && hdr.code.includes('https://*.youtube.com/*'));
});

test('target: the mod an edit names (id, case, .js, phone~, its name; one only)', () => {
  const mods = [{ id: 'youtube.com/calmer-feed', name: 'Calmer feed' }, { id: 'x.com/calmer-feed', name: 'Calmer feed' }, { id: 'phone~amazon.ca/just-search', name: 'Just search' }];
  assert.equal(E.target('youtube.com/calmer-feed', mods), 'youtube.com/calmer-feed');
  assert.equal(E.target('YouTube.com/Calmer-Feed.js', mods), 'youtube.com/calmer-feed');
  assert.equal(E.target('amazon.ca/just-search', mods), 'phone~amazon.ca/just-search');
  assert.equal(E.target('Just search', mods), 'phone~amazon.ca/just-search');
  assert.equal(E.target('calmer-feed', mods), null); // (two: neither)
  assert.equal(E.target(null, mods), null);
  assert.equal(E.target('nothing/here', mods), null);
});

test('take: an edit already in (the same reply\'s changes added before) is "already", not stale', () => {
  const e = edit(MOD, block(['    "#chips { opacity: 0.6; }"'], ['    "#chips { opacity: 0.3; }"']));
  const added = E.apply(MOD, e).code;
  assert.deepStrictEqual(E.take(e, added, [MOD]), { ok: false, why: 'already' });
  // (TRIF stamped an @id in as it added it: still the same)
  const stamped = added.replace('// @style', '// @style\n// @id        q1w2e3r4');
  assert.deepStrictEqual(E.take(e, stamped, [MOD]), { ok: false, why: 'already' });
  // (changed since by something else: stale)
  assert.deepStrictEqual(E.take(e, added.replace('#related', '#x'), [MOD]), { ok: false, why: 'stale' });
  assert.ok(E.take(e, MOD, []).ok);
  assert.deepStrictEqual(E.take(edit(MOD, block(['  ]'], ['  ]'])), MOD, []), { ok: false, why: 'already' });
});

test('shortened files: placeholders that stand in for lines the mod has now', () => {
  const big = [MOD.trimEnd(), '// a free part', 'function a() { return 1; }', 'function b() { return 2; }', 'function c() { return 3; }', ''].join('\n');
  const cut = (ph) => [MOD.trimEnd(), '// a free part', ph, 'function c() { return 3; }', ''].join('\n');
  for (const ph of ['// rest unchanged', '// ... existing code ...', '/* same as before */', '// ...', '// … unchanged …', '  // (rest of the code is the same)',
    '// rest of the file unchanged', '/* other functions unchanged */', '// Existing functions here', '// keep the rest as is', '// ... 2 more lines ...',
    '// [rest of mod unchanged]', '// code omitted for brevity', '// unchanged', '# ...', '// … the remaining functions stay the same …', '// Everything else stays the same']) {
    const r = E.elided(cut(ph), big);
    assert.ok(r, ph);
    assert.equal(r.line, 14, ph);
    assert.equal(r.missing, 2, ph);
  }
  // (at the end: everything after the last real line)
  assert.ok(E.elided([MOD.trimEnd(), '// a free part', 'function a() { return 1; }', '// ... rest unchanged'].join('\n'), big));
});

test('shortened files: not a real comment, nor a placeholder standing in for nothing', () => {
  const big = [MOD.trimEnd(), 'function a() { return 1; } // the rest is untouched', '// rest unchanged', 'function b() { return 2; }', ''].join('\n');
  // (the version now has the comment itself: it's code's comment, not a placeholder)
  assert.equal(E.elided(big, big), null);
  // (a placeholder-looking line, but nothing the mod has now is missing: new code with a comment)
  const added = [MOD.trimEnd(), 'function a() { return 1; } // the rest is untouched', '// rest unchanged', 'function b() { return 2; }', '// ...', 'function z() {}', ''].join('\n');
  assert.equal(E.elided(added, big), null);
  // (sentences that say "unchanged" or "the same" in working code; code with a comment after it)
  for (const l of ['// leave the header unchanged when scrolling the feed', '// for the same batch show the rest.', '// loads. CSS :hover still works, and clicks are untouched.',
    '// comment said "open the browser"; the code is unchanged.)', 'const unchanged = true; // ...', '// a … b', '//', '/* … */ x()', '"// rest unchanged"',
    '// keep the same order as the feed', '// the same as you scroll back and forth.']) {
    assert.equal(E.placeholder(l), false, l);
    assert.equal(E.elided([MOD.trimEnd(), l, 'function b() { return 2; }', ''].join('\n'), big), null, l);
  }
});

test('Tim\'s mods as a corpus: none reads as shortened (TRIF_EDIT_CORPUS)', (t) => {
  const dir = process.env.TRIF_EDIT_CORPUS;
  if (!dir || !fs.existsSync(dir)) { t.skip('TRIF_EDIT_CORPUS not set'); return; }
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(dir);
  assert.ok(files.length > 50, `${files.length} files`);
  let lines = 0;
  const tripped = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const ls = text.split('\n');
    lines += ls.length;
    // (every line as a comment a chat might write anew: none a placeholder)
    for (const l of ls) if (E.placeholder(l)) tripped.push(`${path.relative(dir, f)}: ${l.trim().slice(0, 100)}`);
    // (the mod offered as it is; and with lines taken out, as a real edit would, against the mod as it is)
    if (E.elided(text, text)) tripped.push(`${path.relative(dir, f)}: itself`);
    for (let k = 1; k < 4; k++) {
      const fewer = ls.filter((_, i) => i % (7 * k) !== 3).join('\n');
      if (E.elided(fewer, text)) tripped.push(`${path.relative(dir, f)}: lines taken out (${k})`);
    }
    // (and its version tag: stable, its edits round-trip: each 40th line changed through an edit block)
    const v = E.version(text);
    const want = ls.map((l, i) => (i % 40 === 20 && l.trim() && ls.filter((x) => x === l).length === 1 ? `${l} /* edited */` : l));
    const blocks = ls.map((l, i) => (want[i] !== l ? block([l], [want[i]]) : null)).filter(Boolean);
    if (blocks.length) {
      const r = E.apply(text, E.parse(`TRIF edit x/y ${v}\n${blocks.join('\n')}`).edits[0]);
      assert.ok(r.ok, `${f}: ${JSON.stringify(r)}`);
      assert.equal(r.code, want.join('\n'), f);
    }
  }
  assert.deepStrictEqual(tripped, []);
  console.log(`# corpus: ${files.length} mods, ${lines} lines, none tripped`);
});

test('gen/core.js: TrifCore.modEdit in a bare context (JavaScriptCore\'s view)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen', 'core.js'), 'utf8'), ctx);
  const e = edit(MOD, block(['  ]'], ['    , "#x { color: red; }"', '  ]']));
  const r = JSON.parse(vm.runInContext(`TrifCore.call("modEdit.take", ${JSON.stringify(JSON.stringify([e, MOD, []]))})`, ctx));
  assert.deepStrictEqual(r, JSON.parse(JSON.stringify(E.take(e, MOD, []))));
  assert.equal(JSON.parse(vm.runInContext(`TrifCore.call("modEdit.version", ${JSON.stringify(JSON.stringify([MOD]))})`, ctx)), E.version(MOD));
});

test('cost: a 5,000-line mod, its version and 20 edits', () => {
  const big = Array.from({ length: 5000 }, (_, i) => `const v${i} = ${i}; // line ${i}`).join('\n');
  const t0 = process.hrtime.bigint();
  const v = E.version(big);
  const blocks = Array.from({ length: 20 }, (_, k) => block([`const v${k * 200} = ${k * 200}; // line ${k * 200}`], [`const v${k * 200} = -1;`]));
  const r = E.apply(big, E.parse(`TRIF edit a/b ${v}\n${blocks.join('\n')}`).edits[0]);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(r.ok);
  assert.ok(E.elided(big, big) === null);
  console.log(`# a 5,000-line mod: version + 20 edits ${ms.toFixed(1)} ms`);
  assert.ok(ms < 2000);
});

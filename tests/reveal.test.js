'use strict';
// "Show in Finder" / "Open in editor" (helper/lib/reveal.js, the panel's code card, `trif reveal`): the path
// comes from the mod's id and TRIF's scan, never a message; anything else is refused. `open` is stubbed
// (TRIF_REVEAL_CMD): no Finder window opens.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { modFile, revealCommand, reveal } = require('../helper/lib/reveal');
const { runCli, writeMod, tempDir } = require('./fake-extension');

const stub = (dir) => {
  const log = path.join(dir, 'opened.log');
  const sh = path.join(dir, 'fake-open.sh');
  fs.writeFileSync(sh, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`, { mode: 0o755 });
  return { sh, log };
};
const waitFor = async (f) => { for (let i = 0; i < 100; i++) { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); await new Promise((r) => setTimeout(r, 30)); } return ''; };

test('the file: the mod\'s own, by its id, in the sites folder; anything else refused', () => {
  const home = tempDir('trif-reveal-');
  const modsDir = path.join(home, 'sites');
  const file = writeMod(home, 'x.com', 'hide.js', '// mod');
  const mods = [{ id: 'x.com/hide', file }];
  assert.strictEqual(modFile(modsDir, mods, 'x.com/hide'), file);
  assert.throws(() => modFile(modsDir, mods, 'x.com/nope'), /no mod x\.com\/nope/);
  assert.throws(() => modFile(modsDir, mods, ''), /no mod \(no id\)/);
  // (a mod whose file isn't where its id says, or outside the sites folder: refused, whatever the scan said)
  const outside = path.join(home, 'elsewhere.js');
  fs.writeFileSync(outside, 'x');
  assert.throws(() => modFile(modsDir, [{ id: 'x.com/hide', file: outside }], 'x.com/hide'), /isn't where TRIF keeps mods/);
  assert.throws(() => modFile(modsDir, [{ id: 'x.com/hide', file: path.join(modsDir, 'x.com', '..', '..', 'elsewhere.js') }], 'x.com/hide'), /isn't where TRIF keeps mods/);
  assert.throws(() => modFile(modsDir, [{ id: '../x', file: outside }], '../x'), /isn't a mod id TRIF opens files for/);
  assert.throws(() => modFile(modsDir, [{ id: 'x.com/a/b', file: outside }], 'x.com/a/b'), /isn't a mod id/);
  fs.unlinkSync(file);
  assert.throws(() => modFile(modsDir, mods, 'x.com/hide'), /isn't there any more/);
});

test('what opens it, by platform: open -R / open on a Mac, xdg-open on its folder or itself elsewhere', () => {
  assert.deepStrictEqual(revealCommand('/h/sites/x.com/a.js', 'folder', 'darwin'), ['open', ['-R', '/h/sites/x.com/a.js']]);
  assert.deepStrictEqual(revealCommand('/h/sites/x.com/a.js', 'editor', 'darwin'), ['open', ['/h/sites/x.com/a.js']]);
  assert.deepStrictEqual(revealCommand('/h/sites/x.com/a.js', 'folder', 'linux'), ['xdg-open', ['/h/sites/x.com']]);
  assert.deepStrictEqual(revealCommand('/h/sites/x.com/a.js', 'editor', 'linux'), ['xdg-open', ['/h/sites/x.com/a.js']]);
  assert.throws(() => revealCommand('/a.js', 'folder', 'aix'), /doesn't know how to open folders on aix/);
});

test('reveal runs it (stubbed), and trif reveal does the same without the browser; refused inside a run', async () => {
  const home = tempDir('trif-reveal-');
  const file = writeMod(home, 'x.com', 'hide.js', '// ==WebMod==\n// @name Hide\n// ==/WebMod==\n');
  const s = stub(home);
  const r = reveal(path.join(home, 'sites'), [{ id: 'x.com/hide', file }], 'x.com/hide', 'folder', { platform: 'darwin', env: { TRIF_REVEAL_CMD: s.sh } });
  assert.deepStrictEqual(r, { id: 'x.com/hide', how: 'folder', file: path.join('x.com', 'hide.js') });
  assert.strictEqual((await waitFor(s.log)).trim(), `open -R ${file}`);
  fs.unlinkSync(s.log);
  const cli = await runCli(['reveal', 'x.com/hide', '--editor'], { home, env: { TRIF_REVEAL_CMD: s.sh } });
  assert.strictEqual(cli.code, 0, cli.stderr);
  assert.match(cli.stdout, /opened x\.com\/hide\.js/);
  const opened = (await waitFor(s.log)).trim();
  assert.ok(opened.endsWith(path.join('sites', 'x.com', 'hide.js')) && /^(open|xdg-open) /.test(opened), opened);
  const bad = await runCli(['reveal', 'x.com/nope'], { home, env: { TRIF_REVEAL_CMD: s.sh } });
  assert.notStrictEqual(bad.code, 0);
  assert.match(bad.stderr, /no mod x\.com\/nope/);
  const inRun = await runCli(['reveal', 'x.com/hide'], { home, env: { TRIF_REVEAL_CMD: s.sh, TRIF_RUN_TOKEN: 't' } });
  assert.notStrictEqual(inRun.code, 0);
});

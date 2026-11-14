'use strict';
// Sharing mods and a site's files (helper/lib/share.js), and the history the code card shows
// (helper/lib/history.js): what's written where, what's refused, and that nothing comes from a path in a
// message. Finder is stubbed (TRIF_REVEAL_CMD); the downloads folder is a temporary one (TRIF_DOWNLOADS).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const share = require('../helper/lib/share');
const history = require('../helper/lib/history');
const { scanMods } = require('../helper/lib/mods');
const { runCli, writeMod, tempDir } = require('./fake-extension');

const head = (name, matches = ['*://x.com/*'], extra = '') => `// ==WebMod==\n// @name ${name}\n${matches.map((m) => `// @match ${m}\n`).join('')}${extra}// ==/WebMod==\n`;
const wsOf = (home) => ({ home, modsDir: path.join(home, 'sites') });

test('export: the mod\'s file to the downloads folder as <site>-<mod>.js, a number if taken; a site\'s mods as a folder', () => {
  const home = tempDir('trif-share-');
  const ws = wsOf(home);
  writeMod(home, 'x.com', 'hide.js', `${head('Hide')}x();\n`);
  writeMod(home, 'x.com', 'dark.js', `${head('Dark')}y();\n`);
  const list = scanMods(ws.modsDir).mods;
  const to = path.join(home, 'dl');
  const env = { TRIF_DOWNLOADS: to };
  assert.strictEqual(path.basename(share.exportMod(ws, list, 'x.com/hide', { env }).file), 'x.com-hide.js');
  assert.strictEqual(path.basename(share.exportMod(ws, list, 'x.com/hide', { env }).file), 'x.com-hide 2.js');
  assert.strictEqual(fs.readFileSync(path.join(to, 'x.com-hide.js'), 'utf8'), `${head('Hide')}x();\n`);
  assert.throws(() => share.exportMod(ws, list, '../etc/passwd', { env }), /no mod/);
  const site = share.exportSite(ws, list, 'x.com', { env });
  assert.deepStrictEqual([path.basename(site.dir), fs.readdirSync(site.dir).sort()], ['x.com mods', ['dark.js', 'hide.js']]);
  assert.throws(() => share.exportSite(ws, list, 'y.com', { env }), /no mods for y\.com/);
  assert.throws(() => share.exportSite(ws, list, '../x', { env }), /isn't a site/);
});

test('import: the site from @match, or asked; never over a mod without a choice; Replace keeps the old one in history; no shipped markers; marked imported', () => {
  const home = tempDir('trif-share-');
  const ws = wsOf(home);
  const text = `${head('Hide reposts', ['*://x.com/*', '*://*.x.com/*'], '// @source trif\n// @version 1.2\n')}hide();\n`;
  let r = share.importMod(ws, { text, name: 'x.com-hide-reposts.js' });
  assert.deepStrictEqual(r, { id: 'x.com/x-com-hide-reposts', file: path.join(ws.modsDir, 'x.com', 'x-com-hide-reposts.js') });
  const written = fs.readFileSync(r.file, 'utf8');
  assert.doesNotMatch(written, /@source|@version/);
  assert.match(written, /hide\(\);/);
  assert.ok(share.loadImported(home)['x.com/x-com-hide-reposts']);
  // the same name again: asked; a copy; Replace (the old one in history, as an import's)
  assert.deepStrictEqual(share.importMod(ws, { text, name: 'x.com-hide-reposts.js' }), { exists: 'x.com/x-com-hide-reposts', site: 'x.com', name: 'x-com-hide-reposts' });
  assert.strictEqual(share.importMod(ws, { text, name: 'x.com-hide-reposts.js', choice: 'copy' }).id, 'x.com/x-com-hide-reposts-2');
  r = share.importMod(ws, { text: text.replace('hide();', 'hide(2);'), name: 'x.com-hide-reposts.js', choice: 'replace' });
  assert.strictEqual(r.replaced, true);
  const [kept] = history.listHistory(ws, 'x.com/x-com-hide-reposts');
  assert.deepStrictEqual([kept.kind, kept.source], ['version', 'import']);
  assert.match(fs.readFileSync(kept.file, 'utf8'), /hide\(\);/);
  // no site in @match, or several: the user says
  assert.deepStrictEqual(share.importMod(ws, { text: `${head('Both', ['*://a.com/*', '*://b.com/*'])}x;\n`, name: 'both.js' }), { needsSite: ['a.com', 'b.com'] });
  assert.deepStrictEqual(share.importMod(ws, { text: `${head('Any', ['<all_urls>'])}x;\n`, name: 'any.js' }).needsSite, ['all-sites']);
  assert.strictEqual(share.importMod(ws, { text: `${head('Both', ['*://a.com/*', '*://b.com/*'])}x;\n`, name: 'both.js', site: 'b.com' }).id, 'b.com/both');
  // not a mod; a header with a problem; a bad site
  assert.throws(() => share.importMod(ws, { text: 'alert(1)', name: 'x.js' }), /no \/\/ ==WebMod== header/);
  assert.throws(() => share.importMod(ws, { text: `${head('P', ['*://x.com/*'], '// @powers sound\n')}x;\n`, name: 'p.js' }), /header has a problem: .*boxed mods/);
  assert.throws(() => share.importMod(ws, { text, name: 'a.js', site: '../../etc' }), /isn't a site/);
  // (the scanner sees the imported ones as mods; nothing else)
  assert.deepStrictEqual(scanMods(ws.modsDir).mods.map((m) => m.id).sort(), ['b.com/both', 'x.com/x-com-hide-reposts', 'x.com/x-com-hide-reposts-2']);
});

test('a site\'s files: bytes and a cleaned name, never over another; listed, removed to the trash; never scanned as mods', () => {
  const home = tempDir('trif-share-');
  const ws = wsOf(home);
  writeMod(home, 'x.com', 'hide.js', `${head('Hide')}x();\n`);
  const a = share.addFile(ws, { site: 'x.com', name: 'ding.opus', bytes: Buffer.from('OggS...') });
  assert.deepStrictEqual(a, { site: 'x.com', name: 'ding.opus', rel: 'sites/x.com/files/ding.opus', size: 7 });
  assert.strictEqual(share.addFile(ws, { site: 'x.com', name: 'ding.opus', bytes: Buffer.from('2') }).name, 'ding 2.opus');
  // (a path in the name: only its last part; control characters and leading dots go)
  assert.strictEqual(share.addFile(ws, { site: 'x.com', name: '../../../.ssh/authorized_keys', bytes: Buffer.from('k') }).name, 'authorized_keys');
  assert.strictEqual(share.addFile(ws, { site: 'x.com', name: '..\\..\\evil.js', bytes: Buffer.from('alert(1)') }).name, 'evil.js');
  assert.throws(() => share.addFile(ws, { site: '../x', name: 'a', bytes: Buffer.from('a') }), /isn't a site/);
  assert.deepStrictEqual(share.listFiles(ws, 'x.com').map((f) => f.name).sort(), ['authorized_keys', 'ding 2.opus', 'ding.opus', 'evil.js']);
  // a .js in files/ isn't a mod
  assert.deepStrictEqual(scanMods(ws.modsDir).mods.map((m) => m.id), ['x.com/hide']);
  assert.deepStrictEqual(share.removeFile(ws, 'x.com', 'ding.opus'), { site: 'x.com', name: 'ding.opus', removed: true });
  assert.ok(fs.existsSync(path.join(home, 'trash', 'x.com', 'files', 'ding.opus')));
  assert.throws(() => share.removeFile(ws, 'x.com', '../hide.js'), /no file/);
});

test('history: each kept version says what replaced it; one can be viewed and restored (the current one kept too)', () => {
  const home = tempDir('trif-share-');
  const ws = wsOf(home);
  const file = writeMod(home, 'x.com', 'hide.js', 'v1');
  history.writeEntry(ws, 'x.com', 'hide', 'v0', Date.UTC(2026, 10, 1), 'chat');
  history.writeEntry(ws, 'x.com', 'hide', 'v0.5', Date.UTC(2026, 10, 2), 'fix');
  let list = history.listHistory(ws, 'x.com/hide');
  assert.deepStrictEqual(list.map((e) => [e.source, e.kind]), [['fix', 'version'], ['chat', 'version']]);
  assert.strictEqual(history.entryText(ws, 'x.com/hide', list[1].stamp), 'v0');
  const r = history.restoreEntry(ws, 'x.com/hide', list[1].stamp);
  assert.strictEqual(r.restored, list[1].stamp);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'v0');
  list = history.listHistory(ws, 'x.com/hide');
  assert.deepStrictEqual(list.map((e) => e.source), ['restore', 'fix', 'chat']);
  assert.strictEqual(fs.readFileSync(list[0].file, 'utf8'), 'v1');
  // undo: the newest, and what it replaced kept as an undo's
  history.undoChange(ws, 'x.com/hide');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'v1');
  assert.strictEqual(history.listHistory(ws, 'x.com/hide')[0].source, 'undo');
  assert.throws(() => history.entryText(ws, 'x.com/hide', '20000101T000000000Z'), /no version from/);
});

test('trif export, import, add and files work without the browser; Finder stubbed', async () => {
  const home = tempDir('trif-share-');
  writeMod(home, 'x.com', 'hide.js', `${head('Hide')}x();\n`);
  const dl = path.join(home, 'dl');
  const sh = path.join(home, 'fake-open.sh');
  fs.writeFileSync(sh, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { TRIF_DOWNLOADS: dl, TRIF_REVEAL_CMD: sh };
  let r = await runCli(['export', 'x.com/hide', '--to', path.join(home, 'out')], { home, env });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, 'out', 'x.com-hide.js')));
  r = await runCli(['import', path.join(home, 'out', 'x.com-hide.js')], { home, env });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /imported x\.com\/x-com-hide/);
  r = await runCli(['import', path.join(home, 'out', 'x.com-hide.js')], { home, env });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /--as-copy .* --replace/);
  const f = path.join(home, 'note.txt');
  fs.writeFileSync(f, 'hello');
  r = await runCli(['add', f, '--site', 'x.com'], { home, env });
  assert.strictEqual(r.code, 0, r.stderr);
  r = await runCli(['files', 'x.com'], { home, env });
  assert.match(r.stdout, /sites\/x\.com\/files\/note\.txt {2}5 bytes/);
});

test('a site\'s files in slices: appended in order to a hidden temp file, renamed into place; no size cap but the disk', () => {
  const home = tempDir('trif-share-');
  const ws = wsOf(home);
  const dir = path.join(home, 'sites', 'x.com', 'files');
  const { id } = share.fileBegin(ws, { site: 'x.com', name: '../song.wav', size: 6 });
  assert.deepStrictEqual(share.listFiles(ws, 'x.com'), [], 'a file on its way isn\'t listed');
  assert.deepStrictEqual(share.fileSlice(ws, { id, offset: 0, bytes: Buffer.from('abc') }), { written: 3 });
  assert.throws(() => share.fileSlice(ws, { id, offset: 0, bytes: Buffer.from('abc') }), /out of order/);
  assert.throws(() => share.fileSlice(ws, { id, offset: 3, bytes: Buffer.from('abcd') }), /bigger than it said/);
  share.fileSlice(ws, { id, offset: 3, bytes: Buffer.from('def') });
  assert.deepStrictEqual(share.fileEnd(ws, { id }), { site: 'x.com', name: 'song.wav', rel: 'sites/x.com/files/song.wav', size: 6 });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'song.wav'), 'utf8'), 'abcdef');
  assert.throws(() => share.fileEnd(ws, { id }), /has ended/);
  // never over another; a file that came only in part is taken away; so is one given up
  const b = share.fileBegin(ws, { site: 'x.com', name: 'song.wav', size: 1 });
  share.fileSlice(ws, { id: b.id, offset: 0, bytes: Buffer.from('z') });
  assert.strictEqual(share.fileEnd(ws, { id: b.id }).name, 'song 2.wav');
  const c = share.fileBegin(ws, { site: 'x.com', name: 'part.wav', size: 5 });
  share.fileSlice(ws, { id: c.id, offset: 0, bytes: Buffer.from('z') });
  assert.throws(() => share.fileEnd(ws, { id: c.id }), /came only in part/);
  const d = share.fileBegin(ws, { site: 'x.com', name: 'gone.wav', size: 5 });
  assert.deepStrictEqual(share.fileAbort(ws, { id: d.id }), { aborted: true });
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.')), [], 'no temp files left');
  // no room: refused, with both sizes
  const statfs = () => ({ bavail: 1024, bsize: 1024 }); // 1 MB free
  assert.throws(() => share.fileBegin(ws, { site: 'x.com', name: 'huge.wav', size: 5 * 1024 ** 3 }, { statfs }), /huge\.wav is 5\.0 GB, and there's only 1\.0 MB free on this disk/);
  assert.throws(() => share.fileBegin(ws, { site: '../x', name: 'a', size: 1 }), /isn't a site/);
});

test('export asks where (helper/lib/choosefolder.js): the system chooser by platform, a cancel is null, tests never see a window', async () => {
  const { chooseFolder, chooserCommand } = require('../helper/lib/choosefolder');
  // the stand-ins: TRIF_CHOOSE_FOLDER answers ("cancel" for a cancel); TRIF_DOWNLOADS alone answers with itself
  assert.strictEqual(await chooseFolder('Where?', { start: '/x', env: { TRIF_CHOOSE_FOLDER: '/tmp/here' } }), '/tmp/here');
  assert.strictEqual(await chooseFolder('Where?', { start: '/x', env: { TRIF_CHOOSE_FOLDER: 'cancel' } }), null);
  assert.strictEqual(await chooseFolder('Where?', { start: '/x', env: { TRIF_DOWNLOADS: '/tmp/dl' } }), '/tmp/dl');
  // where TRIF knows no chooser: the fallback, as before (Downloads)
  assert.strictEqual(await chooseFolder('Where?', { start: '/x', fallback: '/dl', env: {}, platform: 'plan9' }), '/dl');
  // macOS: osascript, brought to the front, opening where it's told; quotes in the prompt can't end the string
  const [cmd, args] = chooserCommand('Where should TRIF save “A \"b\"”?', '/Users/me/Downloads', 'darwin');
  assert.strictEqual(cmd, 'osascript');
  assert.deepStrictEqual(args.slice(0, 2), ['-e', 'activate']);
  assert.match(args[3], /^POSIX path of \(choose folder with prompt "Where should TRIF save “A \\"b\\"”\?" default location \(POSIX file "\/Users\/me\/Downloads"\)\)$/);
  assert.strictEqual(chooserCommand('Where?', '/home/me/Downloads', 'linux')[0], 'zenity');
  assert.match(chooserCommand("It's here?", 'C:\\Users\\me', 'win32')[1].join(' '), /Description = 'It''s here\?'/);
});

test('a site\'s export takes its www. folder too (sites/www.google.com for google.com), names kept apart', () => {
  const home = tempDir('trif-share-www-');
  const ws = wsOf(home);
  const g = ['*://www.google.com/*'];
  writeMod(home, 'www.google.com', 'dvd.js', `${head('DVD', g)}a();\n`);
  writeMod(home, 'google.com', 'dvd.js', `${head('DVD too', g)}b();\n`);
  writeMod(home, 'google.com', 'calm.js', `${head('Calm', g)}c();\n`);
  const list = scanMods(ws.modsDir).mods;
  const to = path.join(home, 'dl');
  const r = share.exportSite(ws, list, 'www.google.com', { to });
  assert.strictEqual(r.site, 'google.com');
  assert.deepStrictEqual(r.ids.sort(), ['google.com/calm', 'google.com/dvd', 'www.google.com/dvd']);
  assert.deepStrictEqual(fs.readdirSync(r.dir).sort(), ['calm.js', 'dvd 2.js', 'dvd.js']);
});

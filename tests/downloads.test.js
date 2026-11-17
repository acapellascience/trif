'use strict';
// Mod files the user downloads (helper/lib/downloads.js) and the read of a mod before an import or a trial
// (helper/lib/preview.js): what's offered and what's never read, one offer at a time and a few an hour, offered
// once across browsers, a file changed since its offer refused, the folder left exactly as it was, macOS's
// refusal of the folder reported, and where a file came from as the system recorded it. The panel's card and
// Try it here in a real browser: tests/e2e/scenario.js downloadsCheck.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createWatcher, originOf, hostOf } = require('../helper/lib/downloads');
const { previewMod, PreviewError } = require('../helper/lib/preview');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const MOD = (name, extra = '', body = '{ "hide": ["#ad"] }') => `// ==WebMod==\n// @name ${name}\n// @description Hides the ads on the page\n// @match https://x.com/*\n${extra}// @style\n// ==/WebMod==\n${body}\n`;
const FREE = '// ==WebMod==\n// @name Liker\n// @match https://x.com/*\n// ==/WebMod==\n(() => { fetch("/like", { method: "POST" }); })();\n';
const BOXED = '// ==WebMod==\n// @name Marks\n// @match https://x.com/*\n// @boxed\n// @powers read-drafts\n// ==/WebMod==\ntrif.observe("article", (a) => a.classes.add("trif-box-x"));\n';

/** A watcher on a temp folder with a clock the test moves: {w, dir, tick(ms), events}. */
function rig(opts = {}) {
  const dir = tmp('trif-dl-');
  const priv = tmp('trif-dl-priv-');
  let t = 1_000_000;
  const events = [];
  const origins = opts.origins || {};
  const w = createWatcher({ dir, stateFile: path.join(priv, 'downloads.json'), now: () => t, pollMs: 60 * 60 * 1000, settleMs: 1000, perHour: opts.perHour || 4, watchFs: false,
    onChange: (s) => events.push(s), origin: async (file) => origins[path.basename(file)] || { from: null, app: null } });
  const tick = async (ms = 1500) => { t += ms; await w.poll(); };
  return { w, dir, priv, tick, events, write: (n, text) => fs.writeFileSync(path.join(dir, n), text) };
}
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]));

test('downloads: only new, finished .js files with a mod header are offered; nothing else is read; the folder stays as it was', async (t) => {
  const r = rig();
  t.after(() => r.w.stop());
  r.write('old-mod.js', MOD('Old'));
  await r.w.start();
  assert.equal(r.w.status().state, 'watching');
  r.write('notes.txt', 'hello');
  r.write('script.js', 'console.log(1)\n');
  r.write('.hidden.js', MOD('Hidden'));
  r.write('half.js', MOD('Half'));
  r.write('half.js.crdownload', 'x');
  r.write('calm-feed.js', MOD('Calm feed'));
  await r.tick(); await r.tick();
  const s = r.w.status();
  assert.equal(s.offer.file, 'calm-feed.js');
  assert.deepEqual([s.offer.name, s.offer.kind, s.offer.site, s.offer.description, s.offer.can], ['Calm feed', 'style', 'x.com', 'Hides the ads on the page', []]);
  assert.equal(s.waiting, 0, 'the old file, the text, the plain script, the hidden one and the unfinished one aren\'t offered');
  // (the download finishes: offered after the one showing)
  fs.unlinkSync(path.join(r.dir, 'half.js.crdownload'));
  await r.tick(); await r.tick();
  assert.equal(r.w.status().waiting, 1);
  const before = snapshot(r.dir);
  const got = await r.w.take(s.offer.id);
  assert.deepEqual(got, { text: MOD('Calm feed'), name: 'calm-feed.js' });
  r.w.done(s.offer.id, 'added');
  assert.equal(r.w.status().offer.file, 'half.js');
  assert.deepEqual(snapshot(r.dir), before, 'nothing in the folder moved, changed or went');
  await assert.rejects(r.w.take(s.offer.id), /gone/);
});

test('downloads: a file changed after its offer isn\'t added; one offered once isn\'t offered again, in this browser or another', async (t) => {
  const r = rig();
  t.after(() => r.w.stop());
  await r.w.start();
  r.write('a.js', MOD('A'));
  await r.tick(); await r.tick();
  const o = r.w.status().offer;
  fs.writeFileSync(path.join(r.dir, 'a.js'), MOD('A', '', '{ "hide": ["body"] }'));
  await assert.rejects(r.w.take(o.id), /changed since TRIF offered it/);
  r.w.done(o.id, 'dismissed');
  assert.equal(r.w.status().offer, null);
  // (a second browser's helper, the same private folder: the same file, already handled, isn't offered there)
  const w2 = createWatcher({ dir: r.dir, stateFile: path.join(r.priv, 'downloads.json'), pollMs: 3600000, settleMs: 0, watchFs: false, origin: async () => ({}) });
  t.after(() => w2.stop());
  await w2.start();
  r.write('b.js', MOD('B'));
  await r.tick(); await r.tick();
  await w2.poll(); await new Promise((res) => setTimeout(res, 5)); await w2.poll();
  const ob = r.w.status().offer;
  assert.equal(ob.file, 'b.js');
  assert.equal(w2.status().offer.file, 'b.js', 'both browsers offer a new file');
  r.w.done(ob.id, 'added');
  await w2.poll();
  assert.equal(w2.status().offer, null, 'added in one browser: gone from the other');
});

test('downloads: one offer at a time, at most a few an hour; Ignore files from <site> drops that site\'s', async (t) => {
  const r = rig({ perHour: 2, origins: { 'e1.js': { from: 'evil.example', app: 'Google Chrome' }, 'e2.js': { from: 'evil.example', app: null }, 'c.js': { from: 'claude.ai', app: 'Firefox' } } });
  t.after(() => r.w.stop());
  await r.w.start();
  for (const n of ['m1.js', 'm2.js', 'm3.js']) r.write(n, MOD(n));
  await r.tick(); await r.tick();
  assert.equal(r.w.status().offer.file, 'm1.js');
  assert.equal(r.w.status().waiting, 2);
  r.w.done(r.w.status().offer.id);
  assert.equal(r.w.status().offer.file, 'm2.js');
  r.w.done(r.w.status().offer.id);
  assert.equal(r.w.status().offer, null, 'two this hour: the third waits');
  await r.tick(61 * 60 * 1000);
  assert.equal(r.w.status().offer.file, 'm3.js', 'the hour came round');
  r.w.done(r.w.status().offer.id);
  await r.tick(61 * 60 * 1000);
  r.write('e1.js', MOD('E1')); r.write('e2.js', MOD('E2')); r.write('c.js', MOD('C'));
  await r.tick(); await r.tick();
  const o = r.w.status().offer;
  assert.deepEqual([o.file, o.from, o.app], ['c.js', 'claude.ai', 'Firefox']);
  r.w.done(o.id);
  assert.equal(r.w.status().offer.from, 'evil.example');
  r.w.ignore(r.w.status().offer.id);
  assert.equal(r.w.status().offer, null, 'the other file from that site went too');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.priv, 'downloads.json'), 'utf8')).ignored, ['evil.example']);
  r.write('e3.js', MOD('E3'));
  r.write('e3-origin-unknown.js', MOD('E4'));
  await r.tick(61 * 60 * 1000); await r.tick();
  assert.equal(r.w.status().offer.file, 'e3-origin-unknown.js');
});

test('downloads: a mod TRIF couldn\'t import isn\'t offered; a free mod\'s and a powered boxed mod\'s card say what TRIF finds', async (t) => {
  const r = rig();
  t.after(() => r.w.stop());
  await r.w.start();
  r.write('broken.js', '// ==WebMod==\n// @name Broken\n// @boxed\n// @style\n// ==/WebMod==\n');
  r.write('free.js', FREE);
  r.write('boxed.js', BOXED);
  await r.tick(); await r.tick();
  const files = [];
  for (let o = r.w.status().offer; o; o = r.w.status().offer) { files.push([o.file, o.kind, o.can.length > 0]); r.w.done(o.id); }
  assert.deepEqual(files.sort(), [['boxed.js', 'boxed', true], ['free.js', 'free', true]]);
});

test('downloads: a folder macOS won\'t let it read is reported, not fatal; off stops it', async (t) => {
  const r = rig();
  t.after(() => { try { fs.chmodSync(r.dir, 0o700); } catch { /* gone */ } r.w.stop(); });
  if (process.getuid && process.getuid() === 0) return t.skip('root reads anything');
  fs.chmodSync(r.dir, 0o000);
  await r.w.start();
  assert.equal(r.w.status().state, 'no-access');
  fs.chmodSync(r.dir, 0o700);
  await r.tick();
  assert.equal(r.w.status().state, 'watching');
  assert.deepEqual(r.w.stop(), { on: false, state: 'off', folder: r.dir, offer: null, waiting: 0 });
  const missing = createWatcher({ dir: path.join(r.dir, 'nope'), stateFile: path.join(r.priv, 'x.json'), pollMs: 3600000 });
  await missing.start();
  assert.equal(missing.status().state, 'missing');
  missing.stop();
});

test('where a download came from: the page\'s site, never the address; the app that saved it', async () => {
  assert.equal(hostOf('https://www.claude.ai/chat/1?token=x'), 'claude.ai');
  assert.equal(hostOf('blob:https://x.com/1234-abcd'), 'x.com');
  assert.equal(hostOf('data:text/javascript,1'), null);
  assert.equal(hostOf('file:///etc/passwd'), null);
  const calls = [];
  const fake = async (cmd, args, o) => {
    calls.push([path.basename(cmd), args[0]]);
    if (args.includes('com.apple.metadata:kMDItemWhereFroms')) return Buffer.from('00 11');
    if (path.basename(cmd) === 'plutil') return Buffer.from(JSON.stringify(['blob:https://claude.ai/1', 'https://claude.ai/chat/abc']));
    if (args.includes('com.apple.quarantine')) return Buffer.from('0083;6745a1b2;Google Chrome;ABCD\n');
    return null;
  };
  assert.deepEqual(await originOf('/x/a.js', { platform: 'darwin', exec: fake }), { from: 'claude.ai', app: 'Google Chrome' });
  const linux = async (cmd, args) => (args.includes('user.xdg.origin.url') ? Buffer.from('https://example.org/m.js') : null);
  assert.deepEqual(await originOf('/x/a.js', { platform: 'linux', exec: linux }), { from: 'example.org', app: null });
  assert.deepEqual(await originOf('/x/a.js', { platform: 'linux', exec: async () => null }), { from: null, app: null });
  // (a quarantine app name that isn't a plain name is left out)
  const odd = async (cmd, args) => (args.includes('com.apple.quarantine') ? Buffer.from('0083;1;<script>;x') : null);
  assert.deepEqual(await originOf('/x/a.js', { platform: 'darwin', exec: odd }), { from: null, app: null });
});

test('where a download came from, on a real Mac file: the attributes browsers set', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
  const dir = tmp('trif-dl-xattr-');
  const f = path.join(dir, 'm.js');
  fs.writeFileSync(f, MOD('M'));
  const plist = path.join(dir, 'wf.plist');
  execFileSync('/usr/bin/plutil', ['-convert', 'binary1', '-o', plist, '-'], { input: JSON.stringify(['blob:https://claude.ai/1234', 'https://claude.ai/chat/abc?x=1']) });
  execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.metadata:kMDItemWhereFroms', fs.readFileSync(plist).toString('hex'), f]);
  execFileSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0083;6745a1b2;Firefox;ABCD-1234', f]);
  assert.deepEqual(await originOf(f), { from: 'claude.ai', app: 'Firefox' });
  fs.writeFileSync(path.join(dir, 'plain.js'), 'x');
  assert.deepEqual(await originOf(path.join(dir, 'plain.js')), { from: null, app: null });
});

test('preview: what TRIF reads in a mod before an import or a trial, and what a trial would run', () => {
  const style = previewMod(MOD('Calm'), { forTry: true });
  assert.deepEqual([style.kind, style.site, style.can, style.run.kind], ['style', 'x.com', [], 'style']);
  assert.match(style.run.id, /^x\.com\/~try-calm$/, 'a trial has a name of its own');
  assert.match(style.run.code, /TRIF rules mod/);
  const boxed = previewMod(BOXED, { forTry: true });
  assert.equal(boxed.kind, 'boxed');
  assert.deepEqual(boxed.asks, ['read-drafts']);
  assert.ok(boxed.can.length, 'the power it asks for is on the card');
  assert.equal(boxed.run.kind, 'boxed');
  assert.ok(!('powers' in boxed.run), 'a trial carries no powers');
  const free = previewMod(FREE, { forTry: true });
  assert.equal(free.kind, 'free');
  assert.equal(free.run, undefined, 'a free mod is never tried');
  assert.match(free.can.join(' '), /send/);
  assert.equal(previewMod(MOD('Calm')).run, undefined, 'only with forTry');
  const section = previewMod('// ==WebMod==\n// @name S\n// @match https://x.com/*\n// @boxed\n// ==/WebMod==\n// ==Style==\n// { "css": ["a { color: var(--c); }"], "settings": { "c": { "type": "colour", "value": "#ff0000" } } }\n// ==/Style==\ntrif.log(trif.style.c);\n', { forTry: true });
  assert.deepEqual(section.run.style, { css: 'a { color: #ff0000; }', values: { c: '#ff0000' } });
  assert.throws(() => previewMod('alert(1)'), PreviewError);
  assert.throws(() => previewMod(''), /empty/);
  assert.throws(() => previewMod('// ==WebMod==\n// @style\n// @boxed\n// ==/WebMod==\n'), /header has a problem/);
  assert.equal(previewMod(MOD('Two').replace('// @match https://x.com/*\n', '// @match https://x.com/*\n// @match https://y.org/*\n')).site, null, 'two sites: the import asks');
});

test('the helper: off by default; only the extension\'s connection switches it on or takes a file; an offer, added through the import, is done', async (t) => {
  const net = require('net');
  const { FakeExtension, privDir } = require('./fake-extension');
  const home = tmp('trif-dl-host-');
  const dl = tmp('trif-dl-folder-');
  const ext = new FakeExtension({ home, env: { TRIF_DOWNLOADS: dl } });
  t.after(() => ext.close());
  let n = 0;
  const ask = async (cmd, args = {}) => { const id = `d${++n}`; ext.send({ type: 'request', id, cmd, args }); return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 15000 }); };
  const sockAsk = (msg) => new Promise((resolve, reject) => {
    const s = net.connect(ext.sock); let buf = '';
    s.setEncoding('utf8');
    s.on('connect', () => s.write(`${JSON.stringify(msg)}\n`));
    s.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i !== -1) { s.destroy(); resolve(JSON.parse(buf.slice(0, i))); } });
    s.on('error', reject);
  });
  ext.hello();
  const first = await ext.next((m) => m.type === 'downloads', { timeout: 10000 });
  assert.deepEqual(first.downloads, { on: false, state: 'off' });
  await ext.waitForSocket();
  for (const cmd of ['downloads.setWatch', 'downloads.take', 'downloads.status']) {
    const r = await sockAsk({ id: 's', cmd, args: { on: true, id: 'x' } });
    assert.equal(r.ok, false, cmd);
    assert.match(r.error, /only a click in TRIF's side panel/);
  }
  const preview = await sockAsk({ id: 'p', cmd: 'mod.preview', args: { text: MOD('Calm') } });
  assert.equal(preview.result.kind, 'style', 'a terminal may read a mod as TRIF would');
  fs.writeFileSync(path.join(dl, 'there-before.js'), MOD('Before'));
  const on = await ask('downloads.setWatch', { on: true });
  assert.equal(on.result.on, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).watchDownloads, true);
  fs.writeFileSync(path.join(dl, 'calm-feed.js'), MOD('Calm feed'));
  const offered = await ext.next((m) => m.type === 'downloads' && m.downloads.offer, { timeout: 15000 });
  assert.deepEqual([offered.downloads.offer.file, offered.downloads.offer.name, offered.downloads.state], ['calm-feed.js', 'Calm feed', 'watching']);
  const since = ext.messages.length;
  const taken = await ask('downloads.take', { id: offered.downloads.offer.id });
  const imported = await ask('mod.import', { text: taken.result.text, name: taken.result.name });
  assert.equal(imported.result.id, 'x.com/calm-feed');
  await ask('downloads.done', { id: offered.downloads.offer.id, how: 'added' });
  const after = await ext.next((m) => m.type === 'downloads' && !m.downloads.offer, { timeout: 5000, since });
  assert.equal(after.downloads.on, true);
  assert.deepEqual(fs.readdirSync(dl).sort(), ['calm-feed.js', 'there-before.js'], 'the downloads folder as it was');
  assert.equal(fs.readFileSync(path.join(dl, 'calm-feed.js'), 'utf8'), MOD('Calm feed'));
  const off = await ask('downloads.setWatch', { on: false });
  assert.deepEqual([off.result.on, off.result.state], [false, 'off']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).watchDownloads, undefined);
});

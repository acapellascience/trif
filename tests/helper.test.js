'use strict';
// Tests for helper/host.js (native messaging host) and helper/lib/mods.js (header parsing).

const test = require('./posix-only')('helpers on Unix sockets, file modes and symlinks');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { FakeExtension, runCli, writeMod, tempDir, waitFor, sleep, REPO, privDir } = require('./fake-extension');
const { parseHeader, buildMod, scanMods, planModsMessage, defaultMatches } = require('../helper/lib/mods');
const { encode, Decoder } = require('../helper/lib/framing');

const cleanups = [];
test.after(async () => {
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } }
});

function startHost(home, opts = {}) {
  const ext = new FakeExtension({ home, ...opts });
  cleanups.push(() => ext.close());
  return ext;
}

function sockRequest(sock, msg, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    let buf = '';
    const t = setTimeout(() => { s.destroy(); reject(new Error('socket request timed out')); }, timeout);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify(msg) + '\n'));
    s.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl !== -1) { clearTimeout(t); s.destroy(); resolve(JSON.parse(buf.slice(0, nl))); }
    });
    s.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

// ------------------------------------------------------------------ parsing

test('parseHeader: full header', () => {
  const h = parseHeader(`// ==WebMod==
// @name        Plain X
// @description Following-only, filtered X timeline
// @match       https://x.com/*
// @match       https://twitter.com/*
// @exclude     https://x.com/settings/*
// @run-at      document-end
// @version     3
// ==/WebMod==
console.log(1);`);
  assert.equal(h.hasHeader, true);
  assert.equal(h.name, 'Plain X');
  assert.equal(h.description, 'Following-only, filtered X timeline');
  assert.deepEqual(h.matches, ['https://x.com/*', 'https://twitter.com/*']);
  assert.deepEqual(h.excludes, ['https://x.com/settings/*']);
  assert.equal(h.runAt, 'document_end');
  assert.equal(h.version, '3');
  assert.equal(h.source, null);
  assert.deepEqual(h.warnings, []);
});

test('parseHeader: @source and @version mark the mods TRIF ships', () => {
  const h = parseHeader('// ==WebMod==\n// @name Plain X\n// @source      TRIF\n// @version     3\n// ==/WebMod==\n');
  assert.equal(h.source, 'trif');
  // Shipped mods say webmods (TRIF's name before 0.2.0) or trif; both count.
  const { isShippedSource } = require('../helper/lib/mods');
  assert.ok(isShippedSource('webmods') && isShippedSource('trif') && isShippedSource('WebMods'));
  assert.ok(!isShippedSource('me') && !isShippedSource(null));
  assert.equal(h.version, '3');
  const { mod } = buildMod({ site: 'x.com', file: '/s/x.com/plain-x.js', code: '// ==WebMod==\n// @source webmods\n// @version 2\n// ==/WebMod==\n' });
  assert.deepEqual([mod.source, mod.version], ['webmods', '2']);
  // Every shipped example says so (the updater only manages those).
  const { PREINSTALLED } = require('../helper/lib/preinstalled');
  for (const { id } of PREINSTALLED) {
    const ex = parseHeader(fs.readFileSync(path.join(REPO, 'examples', 'sites', `${id}.js`), 'utf8'));
    assert.equal(ex.source, 'webmods', id);
    assert.match(String(ex.version), /^\d+$/, id);
  }
});

test('parseHeader: run-at mapping and bad values', () => {
  const mk = (v) => parseHeader(`// ==WebMod==\n// @run-at ${v}\n// ==/WebMod==\n`);
  assert.equal(mk('document-start').runAt, 'document_start');
  assert.equal(mk('document-end').runAt, 'document_end');
  assert.equal(mk('document-idle').runAt, 'document_idle');
  assert.equal(mk('document_idle').runAt, 'document_idle');
  const bad = mk('whenever');
  assert.equal(bad.runAt, null);
  assert.match(bad.warnings[0], /unknown @run-at/);
});

test('parseHeader: no header, unterminated header, BOM, CRLF', () => {
  assert.equal(parseHeader('alert(1)').hasHeader, false);
  const un = parseHeader('// ==WebMod==\n// @name X\nalert(1)');
  assert.equal(un.hasHeader, false);
  assert.equal(un.name, null);
  assert.match(un.warnings[0], /no closing/);
  const crlf = parseHeader('﻿// ==WebMod==\r\n// @name  Spaced Name \r\n// ==/WebMod==\r\n');
  assert.equal(crlf.name, 'Spaced Name');
});

test('buildMod: defaults from folder and file name', () => {
  const { mod } = buildMod({ site: 'news.ycombinator.com', file: '/tmp/sites/news.ycombinator.com/wide-mode.js', code: 'document.title = "x";' });
  assert.equal(mod.id, 'news.ycombinator.com/wide-mode');
  assert.equal(mod.site, 'news.ycombinator.com');
  assert.equal(mod.name, 'wide-mode');
  assert.equal(mod.description, '');
  assert.deepEqual(mod.matches, ['*://news.ycombinator.com/*', '*://*.news.ycombinator.com/*']);
  assert.deepEqual(mod.excludes, []);
  assert.equal(mod.runAt, 'document_start');
  assert.equal(mod.code, 'document.title = "x";');
  assert.match(mod.hash, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(mod).sort(), ['code', 'description', 'excludes', 'file', 'hash', 'id', 'matches', 'name', 'risk', 'runAt', 'site', 'source', 'version']);
  assert.strictEqual(mod.risk, null);
  assert.deepEqual([mod.source, mod.version], [null, null]);
});

test('buildMod: hash changes with code and with metadata', () => {
  const a = buildMod({ site: 'a.com', file: '/s/a.com/m.js', code: 'x' }).mod.hash;
  assert.equal(buildMod({ site: 'a.com', file: '/s/a.com/m.js', code: 'x' }).mod.hash, a);
  assert.notEqual(buildMod({ site: 'a.com', file: '/s/a.com/m.js', code: 'y' }).mod.hash, a);
  assert.notEqual(buildMod({ site: 'b.com', file: '/s/b.com/m.js', code: 'x' }).mod.hash, a);
});

test('defaultMatches: ports stripped, IPs get exact pattern only', () => {
  assert.deepEqual(defaultMatches('localhost:3000'), ['*://localhost/*', '*://*.localhost/*']);
  assert.deepEqual(defaultMatches('127.0.0.1'), ['*://127.0.0.1/*']);
});

test('defaultMatches: the all-sites folder matches every site', () => {
  assert.deepEqual(defaultMatches('all-sites'), ['*://*/*']);
});

test('scanMods: ignores _ and . files, non-js, nested folders, ignored site folders', () => {
  const home = tempDir();
  writeMod(home, 'a.com', 'one.js', '1');
  writeMod(home, 'a.com', '_scratch.js', '2');
  writeMod(home, 'a.com', '.hidden.js', '3');
  writeMod(home, 'a.com', 'notes.txt', '4');
  writeMod(home, '_shared', 'lib.js', '5');
  fs.mkdirSync(path.join(home, 'sites', 'a.com', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sites', 'a.com', 'deeper', 'x.js'), '6');
  fs.writeFileSync(path.join(home, 'sites', 'stray.js'), '7');
  const { mods } = scanMods(path.join(home, 'sites'));
  assert.deepEqual(mods.map((m) => m.id), ['a.com/one']);
  assert.deepEqual(scanMods(path.join(home, 'missing')).mods, []);
});

test('scanMods: ignores links out of the mods folder (a run could plant one), keeps links within it', () => {
  const { readModFile, listModFiles, LINK_OUTSIDE } = require('../helper/lib/mods');
  const home = tempDir();
  const outside = tempDir();
  fs.writeFileSync(path.join(outside, 'id_rsa'), 'SECRET KEY');
  fs.writeFileSync(path.join(outside, 'x.js'), 'SECRET JS');
  writeMod(home, 'a.com', 'one.js', '// ==WebMod==\n// @name One\n// ==/WebMod==\n1');
  const sites = path.join(home, 'sites');
  fs.symlinkSync(path.join(outside, 'id_rsa'), path.join(sites, 'a.com', 'key.js')); // a file link out
  fs.symlinkSync(path.join(sites, 'a.com', 'one.js'), path.join(sites, 'a.com', 'same.js')); // within: fine
  fs.symlinkSync(outside, path.join(sites, 'evil.com')); // a folder link out
  fs.symlinkSync(path.join(sites, 'a.com'), path.join(sites, 'b.com')); // within: fine
  const { mods, problems, warnings } = scanMods(sites);
  assert.deepEqual(mods.map((m) => m.id), ['a.com/one', 'a.com/same', 'b.com/one', 'b.com/same']);
  assert.deepEqual(problems, []);
  assert.deepEqual(warnings.map((w) => [w.id, w.warning]), [['a.com/key', LINK_OUTSIDE], ['b.com/key', LINK_OUTSIDE], ['evil.com/', LINK_OUTSIDE]]);
  assert.ok(!JSON.stringify({ mods, problems, warnings }).includes('SECRET'));
  assert.ok(!listModFiles(sites).some((f) => f.file.includes('key.js') || f.site === 'evil.com'));
  // Reading checks the file opened, too (a link swapped in after the listing).
  assert.throws(() => readModFile(sites, path.join(sites, 'a.com', 'key.js')), new RegExp(LINK_OUTSIDE));
  assert.equal(readModFile(sites, path.join(sites, 'a.com', 'same.js')).trim().slice(-1), '1');
  // A mods folder that is itself a link (~/.webmods -> ~/.trif) is fine.
  const alias = path.join(tempDir(), 'alias');
  fs.symlinkSync(sites, alias);
  assert.deepEqual(scanMods(alias).mods.map((m) => m.id), ['a.com/one', 'a.com/same', 'b.com/one', 'b.com/same']);
});

test('planModsMessage: rejects a mod over 1 MB and keeps the total under the limit', () => {
  const small = buildMod({ site: 'a.com', file: '/s/a.com/s.js', code: 'x' }).mod;
  const huge = buildMod({ site: 'a.com', file: '/s/a.com/h.js', code: 'x'.repeat(1100 * 1024) }).mod;
  const p = planModsMessage([small, huge]);
  assert.deepEqual(p.mods.map((m) => m.id), ['a.com/s']);
  assert.equal(p.errors[0].id, 'a.com/h');
  assert.match(p.errors[0].error, /1 MB/);
  const mid = (n) => buildMod({ site: 'a.com', file: `/s/a.com/m${n}.js`, code: 'y'.repeat(400 * 1024 + n) }).mod;
  const p2 = planModsMessage([mid(1), mid(2), mid(3)]);
  assert.equal(p2.mods.length, 2);
  assert.equal(p2.errors.length, 1);
  assert.equal(p2.errors[0].id, 'a.com/m3'); // the largest is dropped
  assert.ok(Buffer.byteLength(JSON.stringify({ type: 'mods', mods: p2.mods })) < 1024 * 1024);
});

test('framing: round trip across arbitrary chunk boundaries', () => {
  const got = [];
  const d = new Decoder((m) => got.push(m));
  const buf = Buffer.concat([encode({ a: 1 }), encode({ b: 'ü'.repeat(1000) }), encode([1, 2])]);
  for (let i = 0; i < buf.length; i += 7) d.push(buf.subarray(i, i + 7));
  assert.deepEqual(got, [{ a: 1 }, { b: 'ü'.repeat(1000) }, [1, 2]]);
});

test('framing: a big frame in small chunks is joined once, not on every chunk', () => {
  const got = [];
  const d = new Decoder((m) => got.push(m));
  const frame = encode({ s: 'x'.repeat(8 * 1024 * 1024) });
  const concat = Buffer.concat;
  let copied = 0;
  Buffer.concat = (list, len) => { const b = concat(list, len); copied += b.length; return b; };
  try {
    for (let i = 0; i < frame.length; i += 16 * 1024) d.push(frame.subarray(i, i + 16 * 1024));
  } finally { Buffer.concat = concat; }
  assert.equal(got.length, 1);
  assert.equal(got[0].s.length, 8 * 1024 * 1024);
  assert.ok(copied < 2 * frame.length, `copied ${copied} bytes for a ${frame.length}-byte frame`);
});

test('framing: an oversize frame is a fatal error and nothing after it is read', () => {
  const got = [];
  const errors = [];
  const d = new Decoder((m) => got.push(m), (e) => errors.push(e), 1000);
  const huge = Buffer.alloc(4);
  huge.writeUInt32LE(5000, 0);
  d.push(Buffer.concat([encode({ a: 1 }), huge, encode({ b: 2 })]));
  d.push(encode({ c: 3 }));
  assert.deepEqual(got, [{ a: 1 }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].fatal, true);
  // A bad JSON frame isn't fatal: the frames after it are still read.
  const d2 = new Decoder((m) => got.push(m), (e) => errors.push(e));
  const bad = Buffer.from('{nope');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(bad.length, 0);
  d2.push(Buffer.concat([head, bad, encode({ d: 4 })]));
  assert.deepEqual(got, [{ a: 1 }, { d: 4 }]);
  assert.equal(errors[1].fatal, undefined);
});

// ------------------------------------------------------------------ host process

test('host: pushes mods on connect and after hello, socket is 0600, ping works before hello', async () => {
  const home = tempDir();
  writeMod(home, 'example.com', 'banner.js', `// ==WebMod==
// @name Hide banner
// @run-at document-idle
// ==/WebMod==
document.querySelector('#banner')?.remove();`);
  const ext = startHost(home);
  const first = await ext.nextMods();
  assert.equal(first.length, 1);
  const m = first[0];
  assert.equal(m.id, 'example.com/banner');
  assert.equal(m.name, 'Hide banner');
  assert.equal(m.runAt, 'document_idle');
  assert.deepEqual(m.matches, ['*://example.com/*', '*://*.example.com/*']);
  assert.equal(m.file, path.join(home, 'sites', 'example.com', 'banner.js'));

  await ext.waitForSocket();
  assert.equal(fs.statSync(ext.sock).mode & 0o777, 0o600);
  const ping = await sockRequest(ext.sock, { id: 'p1', cmd: 'ping', args: {} });
  assert.equal(ping.id, 'p1');
  assert.equal(ping.ok, true);
  assert.equal(ping.result.extension, null);
  assert.deepEqual(ping.result.mods, ['example.com/banner']);
  const mods = await sockRequest(ext.sock, { id: 'm1', cmd: 'mods' });
  assert.equal(mods.result.mods[0].id, 'example.com/banner');
  assert.equal(mods.result.mods[0].code, undefined);

  const since = ext.messages.length;
  ext.hello({ userScripts: false });
  await ext.nextMods(() => true, { since });
  const ping2 = await sockRequest(ext.sock, { id: 'p2', cmd: 'ping' });
  assert.equal(ping2.result.extension.userScripts, false);
  assert.equal(ping2.result.extension.chrome, '140.0.0.0');

  ext.send({ type: 'modsApplied', registered: [], errors: [{ id: 'example.com/banner', error: 'Invalid match pattern' }] });
  ext.send({ type: 'log', level: 'warn', message: 'hello from the fake extension' });
  await waitFor(async () => (await sockRequest(ext.sock, { id: 'p3', cmd: 'ping' })).result.modsApplied, { message: 'modsApplied' });
  await waitFor(() => fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes('hello from the fake extension'), { message: 'log line' });
  assert.deepEqual(ext.badFrames, []);
});

test('host: on start, moves the private files an older version left in the workspace (settings, logs, run logs)', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'sites', 'example.com'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ checkForUpdates: false }));
  fs.writeFileSync(path.join(home, 'helper.log'), 'a line from 0.2.0\n');
  fs.mkdirSync(path.join(home, 'runs'));
  fs.writeFileSync(path.join(home, 'runs', 'r0.jsonl'), '{}\n');
  const ext = startHost(home);
  await ext.waitForSocket();
  for (const f of ['config.json', 'helper.log', 'runs']) assert.ok(!fs.existsSync(path.join(home, f)), f);
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).checkForUpdates, false);
  assert.ok(fs.existsSync(path.join(privDir(home), 'runs', 'r0.jsonl')));
  const log = fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8');
  assert.match(log, /^a line from 0\.2\.0$/m);
  assert.match(log, /moved TRIF's private files \(.*config\.json.*\) out of/);
});

test('host: syncs on file add, change, delete, ignored files, and site folders coming and going', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  const ext = startHost(home);
  const initial = await ext.nextMods();
  assert.deepEqual(initial, []);
  ext.hello();

  let since = ext.messages.length;
  const file = writeMod(home, 'a.com', 'one.js', 'console.log(1)');
  const added = await ext.nextMods((mods) => mods.some((m) => m.id === 'a.com/one'), { since });
  const hash1 = added.find((m) => m.id === 'a.com/one').hash;

  since = ext.messages.length;
  fs.writeFileSync(file, '// ==WebMod==\n// @match https://a.com/x/*\n// ==/WebMod==\nconsole.log(2)');
  const changed = await ext.nextMods((mods) => mods.some((m) => m.id === 'a.com/one' && m.hash !== hash1), { since });
  assert.deepEqual(changed[0].matches, ['https://a.com/x/*']);

  // Ignored files do not trigger a push.
  since = ext.messages.length;
  writeMod(home, 'a.com', '_scratch.js', 'x');
  writeMod(home, 'a.com', '.tmp.js', 'x');
  await sleep(700);
  assert.equal(ext.messages.slice(since).filter((m) => m.type === 'mods').length, 0, 'no push for ignored files');

  // A brand-new site folder.
  since = ext.messages.length;
  writeMod(home, 'b.org', 'two.js', '2');
  await ext.nextMods((mods) => mods.map((m) => m.id).join() === 'a.com/one,b.org/two', { since });

  // Delete a file.
  since = ext.messages.length;
  fs.unlinkSync(file);
  await ext.nextMods((mods) => mods.map((m) => m.id).join() === 'b.org/two', { since });

  // Remove a whole site folder.
  since = ext.messages.length;
  fs.rmSync(path.join(home, 'sites', 'b.org'), { recursive: true });
  await ext.nextMods((mods) => mods.length === 0, { since });

  // Remove and recreate the whole mods folder.
  fs.rmSync(path.join(home, 'sites'), { recursive: true });
  await sleep(300);
  since = ext.messages.length;
  writeMod(home, 'c.net', 'three.js', '3');
  await ext.nextMods((mods) => mods.map((m) => m.id).join() === 'c.net/three', { since, timeout: 8000 });
  assert.deepEqual(ext.badFrames, []);
});

test('host: rapid edits are debounced into few pushes', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'sites'), { recursive: true });
  const ext = startHost(home);
  await ext.nextMods();
  const since = ext.messages.length;
  for (let i = 0; i < 10; i++) writeMod(home, 'a.com', 'burst.js', `// ${i}`);
  await ext.nextMods((mods) => mods.length === 1 && mods[0].code === '// 9', { since });
  await sleep(400);
  const pushes = ext.messages.slice(since).filter((m) => m.type === 'mods').length;
  assert.ok(pushes <= 2, `expected at most 2 pushes, got ${pushes}`);
});

test('host: oversized mod is not sent and is reported', async () => {
  const home = tempDir();
  writeMod(home, 'a.com', 'ok.js', 'ok');
  writeMod(home, 'a.com', 'huge.js', '/*' + 'x'.repeat(1100 * 1024) + '*/');
  const ext = startHost(home);
  const mods = await ext.nextMods();
  assert.deepEqual(mods.map((m) => m.id), ['a.com/ok']);
  await ext.waitForSocket();
  const ping = await sockRequest(ext.sock, { id: 1, cmd: 'ping' });
  assert.equal(ping.result.modErrors[0].id, 'a.com/huge');
  await waitFor(() => /a\.com\/huge/.test(ext.stderr), { message: 'stderr report' });
});

test('host: routes responses by id, handles concurrent requests answered out of order', async () => {
  const home = tempDir();
  const ext = startHost(home);
  ext.hello();
  ext.handlers.run = async (args) => {
    await sleep(args.code === 'slow' ? 300 : 10);
    return { value: `ran:${args.code}` };
  };
  await ext.waitForSocket();
  const [slow, fast] = await Promise.all([
    sockRequest(ext.sock, { id: 'same-id', cmd: 'run', args: { code: 'slow' } }),
    sockRequest(ext.sock, { id: 'same-id', cmd: 'run', args: { code: 'fast' } }),
  ]);
  assert.deepEqual(slow, { id: 'same-id', ok: true, result: { value: 'ran:slow' } });
  assert.deepEqual(fast, { id: 'same-id', ok: true, result: { value: 'ran:fast' } });
  const reqs = ext.messages.filter((m) => m.type === 'request');
  assert.equal(reqs.length, 2);
  assert.notEqual(reqs[0].id, reqs[1].id, 'helper assigns its own ids');

  ext.handlers.tabs = () => { throw new Error('no window'); };
  const err = await sockRequest(ext.sock, { id: 7, cmd: 'tabs', args: {} });
  assert.deepEqual(err, { id: 7, ok: false, error: 'no window' });

  const bad = await sockRequest(ext.sock, { id: 8 });
  assert.equal(bad.ok, false);
});

test('host: request timeout is args.timeout + grace', async () => {
  const home = tempDir();
  const ext = startHost(home, { env: { TRIF_TIMEOUT_GRACE: '200' } });
  ext.hello();
  await ext.waitForSocket();
  const t0 = Date.now();
  const r = await sockRequest(ext.sock, { id: 'to', cmd: 'reload', args: { timeout: 100 } });
  const elapsed = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out after 300ms/);
  assert.ok(elapsed >= 250 && elapsed < 3000, `elapsed ${elapsed}`);
  // A late response is ignored without crashing the host.
  const req = ext.messages.find((m) => m.type === 'request' && m.cmd === 'reload');
  ext.send({ type: 'response', id: req.id, ok: true, result: {} });
  const ping = await sockRequest(ext.sock, { id: 'p', cmd: 'ping' });
  assert.equal(ping.ok, true);
});

test('host: exits cleanly and removes the socket when stdin closes; pending requests fail', async () => {
  const home = tempDir();
  const ext = startHost(home);
  ext.hello();
  await ext.waitForSocket();
  const pending = sockRequest(ext.sock, { id: 'p', cmd: 'reload', args: {} });
  await ext.next((m) => m.type === 'request');
  const { code } = await ext.close();
  assert.equal(code, 0);
  const r = await pending;
  assert.equal(r.ok, false);
  assert.match(r.error, /disconnected/i);
  assert.equal(fs.existsSync(ext.sock), false);
});

test('host: removes a stale socket left by a crashed helper', async () => {
  const home = tempDir();
  const sock = path.join(home, 'helper.sock');
  const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(sock)}, () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((r) => child.stdout.once('data', r));
  child.kill('SIGKILL');
  await new Promise((r) => child.on('exit', r));
  assert.ok(fs.existsSync(sock), 'stale socket file left behind');
  const ext = startHost(home);
  await ext.waitForSocket();
  const ping = await sockRequest(ext.sock, { id: 1, cmd: 'ping' });
  assert.equal(ping.result.pid, ext.child.pid);
});

test('host: second instance only syncs mods, then takes over when the first exits', async () => {
  const home = tempDir();
  writeMod(home, 'a.com', 'm.js', 'x');
  const a = startHost(home);
  await a.waitForSocket();
  const b = startHost(home);
  const bMods = await b.nextMods();
  assert.deepEqual(bMods.map((m) => m.id), ['a.com/m']);
  await waitFor(() => fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes('for its own browser'), { message: 'secondary log line' });
  let ping = await sockRequest(a.sock, { id: 1, cmd: 'ping' });
  assert.equal(ping.result.pid, a.child.pid);

  // Mod changes reach both.
  const sinceB = b.messages.length;
  writeMod(home, 'a.com', 'n.js', 'y');
  await b.nextMods((mods) => mods.length === 2, { since: sinceB });

  await a.close();
  await waitFor(async () => {
    try { return (await sockRequest(b.sock, { id: 2, cmd: 'ping' }, 1000)).result.pid === b.child.pid; } catch { return false; }
  }, { timeout: 6000, message: 'takeover by the second host' });
  ping = await sockRequest(b.sock, { id: 3, cmd: 'ping' });
  assert.equal(ping.result.role, 'primary');
});

test('host: never writes anything but frames to stdout, even with odd input', async () => {
  const home = tempDir();
  const ext = startHost(home);
  await ext.nextMods();
  ext.send({ type: 'nonsense' });
  ext.send({ type: 'response', id: 'nope', ok: true });
  ext.child.stdin.write(Buffer.from([5, 0, 0, 0, 0x7b, 0x7b, 0x7b, 0x7b, 0x7b])); // bad JSON frame
  ext.hello();
  await ext.waitForSocket();
  const r = await runCli(['mods'], { home });
  assert.equal(r.code, 0);
  await sleep(200);
  assert.deepEqual(ext.badFrames, []);
  assert.equal(ext.child.exitCode, null, 'still running');
});

test('host: shuts down after a frame too big to be real, rather than misreading what follows', async () => {
  const home = tempDir();
  const ext = startHost(home);
  await ext.nextMods();
  ext.child.stdin.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x7b])); // a 4 GB "frame": out of step
  const { code } = await ext.exited;
  assert.equal(code, 1);
  assert.match(fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8'), /unreadable input from the extension/);
});

test('mods messages carry the sites preinstalled.json says to start on', async () => {
  const home = tempDir();
  writeMod(home, 'www.google.com', 'a.js', '// ==WebMod==\n// @name A\n// ==/WebMod==\n');
  fs.writeFileSync(path.join(home, 'preinstalled.json'), JSON.stringify({ offered: [], startOff: [], sitesOn: ['google.com', 'x.com'] }));
  const ext = new FakeExtension({ home });
  cleanups.push(() => ext.close());
  const msg = await ext.next((m) => m.type === 'mods');
  assert.deepStrictEqual(msg.sitesOn, ['google.com', 'x.com']);
});

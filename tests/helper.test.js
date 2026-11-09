'use strict';
// Tests for helper/host.js (native messaging host) and helper/lib/mods.js (header parsing).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { FakeExtension, runCli, writeMod, tempDir, waitFor, sleep, REPO, privDir } = require('./fake-extension');
const { parseHeader, buildMod, scanMods, planMods, planModsMessage, modsParts, withSame, MAX_MOD_BYTES, MAX_MODS_BYTES, defaultMatches } = require('../helper/lib/mods');
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
// @name        Detox Timeline
// @description Following-only, filtered X timeline
// @match       https://x.com/*
// @match       https://twitter.com/*
// @exclude     https://x.com/settings/*
// @run-at      document-end
// @version     3
// ==/WebMod==
console.log(1);`);
  assert.equal(h.hasHeader, true);
  assert.equal(h.name, 'Detox Timeline');
  assert.equal(h.description, 'Following-only, filtered X timeline');
  assert.deepEqual(h.matches, ['https://x.com/*', 'https://twitter.com/*']);
  assert.deepEqual(h.excludes, ['https://x.com/settings/*']);
  assert.equal(h.runAt, 'document_end');
  assert.equal(h.version, '3');
  assert.equal(h.source, null);
  assert.deepEqual(h.warnings, []);
});

test('parseHeader: @source and @version mark the mods TRIF ships', () => {
  const h = parseHeader('// ==WebMod==\n// @name Detox Timeline\n// @source      TRIF\n// @version     3\n// ==/WebMod==\n');
  assert.equal(h.source, 'trif');
  // Shipped mods say webmods (TRIF's name before 0.2.0) or trif; both count.
  const { isShippedSource } = require('../helper/lib/mods');
  assert.ok(isShippedSource('webmods') && isShippedSource('trif') && isShippedSource('WebMods'));
  assert.ok(!isShippedSource('me') && !isShippedSource(null));
  assert.equal(h.version, '3');
  const { mod } = buildMod({ site: 'x.com', file: '/s/x.com/detox-timeline.js', code: '// ==WebMod==\n// @source webmods\n// @version 2\n// ==/WebMod==\n' });
  assert.deepEqual([mod.source, mod.version], ['webmods', '2']);
  // Every shipped example says so (the updater only manages those).
  const { PREINSTALLED } = require('../helper/lib/preinstalled');
  for (const { id } of PREINSTALLED) {
    const ex = parseHeader(fs.readFileSync(path.join(REPO, 'examples', 'sites', `${id}.js`), 'utf8'));
    assert.ok(isShippedSource(ex.source), `${id}: @source ${ex.source}`);
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

test('findRenames: same code in the same site folder under a new file name is the same mod', () => {
  const { findRenames } = require('../helper/lib/mods');
  const m = (site, base, code) => buildMod({ site, file: `/m/${site}/${base}.js`, code }).mod;
  const prev = [m('x.com', 'a', 'A'), m('x.com', 'b', 'B'), m('x.com', 'c', 'C'), m('y.com', 'd', 'D')];
  const next = [m('x.com', 'a2', 'A'), m('x.com', 'b', 'B'), m('x.com', 'c2', 'C changed'), m('z.com', 'd', 'D'), m('x.com', 'copy', 'B')];
  // a -> a2 (same code); b stays (its copy isn't a rename); c changed too; d moved to another site folder.
  assert.deepStrictEqual(findRenames(prev, next), [{ from: 'x.com/a', to: 'x.com/a2' }]);
  assert.deepStrictEqual(findRenames(next, next), []);
  // A case-only rename (on macOS, the same file).
  assert.deepStrictEqual(findRenames([m('x.com', 'Wob', 'W')], [m('x.com', 'wob', 'W')]), [{ from: 'x.com/Wob', to: 'x.com/wob' }]);
  // Two identical old mods: each new one pairs with a different one.
  assert.deepStrictEqual(findRenames([m('x.com', 'p', 'S'), m('x.com', 'q', 'S')], [m('x.com', 'r', 'S'), m('x.com', 's', 'S')]),
    [{ from: 'x.com/p', to: 'x.com/r' }, { from: 'x.com/q', to: 'x.com/s' }]);
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

test('planMods: a mod over the per-mod cap is rejected; over the total, the largest go first', () => {
  const MB = 1024 * 1024;
  assert.equal(MAX_MOD_BYTES, 4 * MB);
  assert.equal(MAX_MODS_BYTES, 16 * MB);
  const m = (name, bytes) => buildMod({ site: 'a.com', file: `/s/a.com/${name}.js`, code: 'x'.repeat(bytes) }).mod;
  const p = planMods([m('small', 10), m('huge', 4 * MB + 1), m('max', 4 * MB)]);
  assert.deepEqual(p.mods.map((x) => x.id), ['a.com/small', 'a.com/max']);
  assert.deepEqual(p.errors.map((e) => [e.id, e.limit]), [['a.com/huge', 'mod']]);
  assert.match(p.errors[0].error, /mod is 4\.1 MB; a mod can be up to 4 MB, so it was not sent/);
  // Five at the cap are over the total: the last of the largest goes.
  const t = planMods([1, 2, 3, 4, 5].map((i) => m(`m${i}`, 4 * MB - i)));
  assert.deepEqual(t.mods.map((x) => x.id), ['a.com/m2', 'a.com/m3', 'a.com/m4', 'a.com/m5']);
  assert.deepEqual(t.errors.map((e) => [e.id, e.limit]), [['a.com/m1', 'total']]);
  assert.match(t.errors[0].error, /all mods together are over 16 MB, the most TRIF sends to the browser; this one \(the largest, 4 MB\) was not sent/);
  const q = planMods([m('a', 3 * MB), m('b', 4 * MB), m('c', 2 * MB), m('d', 2 * MB)], { total: 7 * MB });
  assert.deepEqual(q.mods.map((x) => x.id), ['a.com/a', 'a.com/c', 'a.com/d']);
  assert.deepEqual(q.errors.map((e) => [e.id, e.limit]), [['a.com/b', 'total']]);
  assert.match(q.errors[0].error, /all mods together are over 7 MB/);
  // Multi-byte characters count as the bytes they are.
  assert.equal(planMods([m('e', 0), { ...m('f', 0), code: 'é'.repeat(6) }], { perMod: 11 }).errors[0].id, 'a.com/f');
});

test('planModsMessage (an extension that takes one message): rejects a mod over 1 MB and keeps the total under the limit', () => {
  const small = buildMod({ site: 'a.com', file: '/s/a.com/s.js', code: 'x' }).mod;
  const huge = buildMod({ site: 'a.com', file: '/s/a.com/h.js', code: 'x'.repeat(1100 * 1024) }).mod;
  const p = planModsMessage([small, huge], { who: 'TRIF 0.2.4 in Chrome' });
  assert.deepEqual(p.mods.map((m) => m.id), ['a.com/s']);
  assert.equal(p.errors[0].id, 'a.com/h');
  assert.equal(p.errors[0].limit, 'extension');
  assert.match(p.errors[0].error, /TRIF 0\.2\.4 in Chrome takes at most 1 MB of mods; update it/);
  const mid = (n) => buildMod({ site: 'a.com', file: `/s/a.com/m${n}.js`, code: 'y'.repeat(400 * 1024 + n) }).mod;
  const p2 = planModsMessage([mid(1), mid(2), mid(3)]);
  assert.equal(p2.mods.length, 2);
  assert.equal(p2.errors.length, 1);
  assert.equal(p2.errors[0].id, 'a.com/m3'); // the largest is dropped
  assert.ok(Buffer.byteLength(JSON.stringify({ type: 'mods', mods: p2.mods })) < 1024 * 1024);
});

test('withSame: a mod the extension has (same id and hash as last sent) goes without its code', () => {
  const mods = [{ id: 'a', hash: 'h1', code: 'A' }, { id: 'b', hash: 'h2', code: 'B' }, { id: 'c', hash: 'h1', code: 'C' }];
  assert.equal(withSame(mods, null), mods);
  assert.deepEqual(JSON.parse(JSON.stringify(withSame(mods, new Map([['a', 'h1'], ['b', 'h1']])))),
    [{ id: 'a', hash: 'h1', same: true }, { id: 'b', hash: 'h2', code: 'B' }, { id: 'c', hash: 'h1', code: 'C' }]);
});

test('modsParts: every part fits in a native message, and the parts join back into the same JSON', () => {
  const limit = 1024 * 1024;
  const join = (parts) => parts.map((p) => JSON.parse(JSON.stringify(p)).data).join('');
  // Plain code, code full of quotes and backslashes (escaped twice), text past ASCII and emoji (surrogate
  // pairs, which a part never splits), lone surrogates.
  const codes = ['x'.repeat(3 * limit), '"\\'.repeat(700000), 'é漢😀'.repeat(400000), '\ud800a\udc00'.repeat(200000) + '😀'.repeat(300000)];
  for (const code of codes) {
    const json = JSON.stringify({ type: 'mods', mods: [{ id: 'a.com/x', code }], sitesOn: [] });
    const parts = modsParts(json, 'set-1');
    assert.ok(parts.length > 1);
    for (const [i, p] of parts.entries()) {
      assert.deepEqual([p.type, p.set, p.i, p.n], ['modsPart', 'set-1', i, parts.length]);
      assert.ok(Buffer.byteLength(JSON.stringify(p)) <= limit, `part ${i} is ${Buffer.byteLength(JSON.stringify(p))} bytes`);
      if (i < parts.length - 1) assert.ok(!/[\ud800-\udbff]$/.test(p.data) || /[\ud800-\udbff]{2}$/.test(p.data) || !/[\udc00-\udfff]/.test(parts[i + 1].data[0]), 'no pair split');
    }
    assert.equal(join(parts), json);
  }
  // Mostly ASCII fills each part close to the limit (no more parts than needed).
  assert.equal(modsParts(JSON.stringify({ code: 'x'.repeat(3 * limit) }), 1).length, 4);
  assert.deepEqual(modsParts('{}', 2).map((p) => p.data), ['{}']);
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

test('host: a renamed mod file goes out under its new name (mv, case-only, an editor\'s temp file renamed into place)', async () => {
  const home = tempDir();
  const ext = startHost(home);
  const dir = path.join(home, 'sites', 'a.com');
  writeMod(home, 'a.com', 'wobble.js', '// ==WebMod==\n// @name Wobble\n// ==/WebMod==\nconsole.log(1)');
  ext.hello();
  await ext.nextMods((mods) => mods.some((m) => m.id === 'a.com/wobble'));
  const renamedTo = async (base, act) => {
    const since = ext.messages.length;
    act();
    const mods = await ext.nextMods((ms) => ms.some((m) => m.id === `a.com/${base}`), { since, timeout: 4000 });
    assert.deepStrictEqual(mods.map((m) => [m.id, path.basename(m.file), m.name]), [[`a.com/${base}`, `${base}.js`, 'Wobble']]);
  };
  await renamedTo('jelly', () => fs.renameSync(path.join(dir, 'wobble.js'), path.join(dir, 'jelly.js')));
  await renamedTo('Jelly', () => fs.renameSync(path.join(dir, 'jelly.js'), path.join(dir, 'Jelly.js')));
  await renamedTo('wiggle', () => {
    fs.writeFileSync(path.join(dir, '.wiggle.js.tmp'), fs.readFileSync(path.join(dir, 'Jelly.js')));
    fs.unlinkSync(path.join(dir, 'Jelly.js'));
    fs.renameSync(path.join(dir, '.wiggle.js.tmp'), path.join(dir, 'wiggle.js'));
  });
});

test('host: every mods message carries the side panel\'s default order for the shipped mods', async () => {
  const home = tempDir();
  writeMod(home, 'timsrobot.com', 'fireworks.js', '// mine');
  const ext = startHost(home);
  ext.hello();
  const msg = await ext.next((m) => m.type === 'mods' && m.mods.length === 1);
  assert.deepStrictEqual(msg.defaultOrder, require('../helper/lib/preinstalled').DEFAULT_ORDER);
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

test('host: a mod over the cap is not sent and is reported', async () => {
  const home = tempDir();
  writeMod(home, 'a.com', 'ok.js', 'ok');
  writeMod(home, 'a.com', 'huge.js', '/*' + 'x'.repeat(MAX_MOD_BYTES) + '*/');
  const ext = startHost(home);
  const mods = await ext.nextMods();
  assert.deepEqual(mods.map((m) => m.id), ['a.com/ok']);
  await ext.waitForSocket();
  const ping = await sockRequest(ext.sock, { id: 1, cmd: 'ping' });
  assert.equal(ping.result.modErrors[0].id, 'a.com/huge');
  assert.equal(ping.result.modErrors[0].limit, 'mod');
  await waitFor(() => /a\.com\/huge/.test(ext.stderr), { message: 'stderr report' });
  const cli = await runCli(['mods', '--json'], { home });
  assert.deepEqual(JSON.parse(cli.stdout).errors.map((e) => [e.id, e.limit]), [['a.com/huge', 'mod']]);
});

// Mods of 1.4 MB in all as sent: more than one native message.
function writeBigMods(home) {
  writeMod(home, 'a.com', 'big.js', `/* ${'"\\'.repeat(200 * 1024)} */`); // 400 KB that JSON doubles
  writeMod(home, 'a.com', 'data.js', `const d = "${'é'.repeat(300 * 1024)}";`); // 600 KB of UTF-8
  writeMod(home, 'a.com', 'small.js', 'small');
}

test('host: a set over 1 MB waits for the hello, then goes in parts to an extension that can take them', async () => {
  const home = tempDir();
  writeBigMods(home);
  const ext = startHost(home);
  await ext.waitForSocket();
  await waitFor(() => fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes('waiting for the extension\'s hello'), { message: 'waiting' });
  assert.equal(ext.messages.filter((m) => m.type === 'mods').length, 0, 'nothing before the hello says parts are fine');
  ext.hello({ features: ['modsParts'], version: '0.2.5' });
  const msg = await ext.next((m) => m.type === 'mods');
  assert.deepEqual(msg.mods.map((m) => m.id), ['a.com/big', 'a.com/data', 'a.com/small']);
  assert.ok(msg.parts >= 2, `came in ${msg.parts} parts`);
  assert.equal(msg.mods[0].code, fs.readFileSync(path.join(home, 'sites', 'a.com', 'big.js'), 'utf8'));
  assert.equal(msg.mods[1].code, fs.readFileSync(path.join(home, 'sites', 'a.com', 'data.js'), 'utf8'));
  assert.ok(ext.parts.every((p) => Buffer.byteLength(JSON.stringify(p)) <= 1024 * 1024));
  assert.deepEqual(ext.badFrames, []);
  const ping = await sockRequest(ext.sock, { id: 1, cmd: 'ping' });
  assert.deepEqual(ping.result.modErrors, []);
  assert.deepEqual(ping.result.extension.features, ['modsParts']);

  // A change: a new set, under a new id.
  const since = ext.messages.length;
  writeMod(home, 'a.com', 'small.js', 'small 2');
  const next = await ext.next((m) => m.type === 'mods', { since });
  assert.notEqual(next.set, msg.set);
  assert.equal(next.mods[2].code, 'small 2');

  // Asked again (a set that didn't arrive whole): sent again, once.
  const before = ext.messages.length;
  ext.send({ type: 'modsResend', reason: 'part 2 of 3 of mods set x came without the parts before it' });
  const again = await ext.next((m) => m.type === 'mods', { since: before });
  assert.equal(again.mods[2].code, 'small 2');
  ext.send({ type: 'modsResend', reason: 'again' });
  await sleep(500);
  assert.equal(ext.messages.slice(before).filter((m) => m.type === 'mods').length, 1, 'only once for the same set');
  await waitFor(() => fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes('asked for the mods again: part 2 of 3'), { message: 'logged' });

  // An extension that takes mods without their code (modsSame): after the hello, every mod whole; then a
  // change sends only the changed one's code.
  ext.hello({ features: ['modsParts', 'modsSame'], version: '0.2.5' });
  const whole = await ext.next((m) => m.type === 'mods' && m.mods.length === 3, { since: ext.messages.length });
  assert.equal(whole.sameIds, undefined);
  const since1 = ext.messages.length;
  writeMod(home, 'a.com', 'small.js', 'small 3');
  const delta = await ext.next((m) => m.type === 'mods', { since: since1 });
  assert.deepEqual(delta.sameIds, ['a.com/big', 'a.com/data']);
  assert.equal(delta.parts, undefined, 'small enough for one message now');
  assert.equal(delta.mods[1].code, fs.readFileSync(path.join(home, 'sites', 'a.com', 'data.js'), 'utf8'), 'the fake took it from the last set');
  assert.equal(delta.mods[2].code, 'small 3');
  await waitFor(() => fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8').includes('(2 it has already, without their code)'), { message: 'logged' });
  // Asked again: every mod whole.
  const since3 = ext.messages.length;
  ext.send({ type: 'modsResend', reason: 'missing 2 mod(s) sent without their code' });
  const full = await ext.next((m) => m.type === 'mods', { since: since3 });
  assert.equal(full.sameIds, undefined);
  assert.equal(full.mods[2].code, 'small 3');
  assert.deepEqual(ext.badFrames, []);

  // A set that fits in one message still goes as one.
  const since2 = ext.messages.length;
  fs.rmSync(path.join(home, 'sites', 'a.com', 'big.js'));
  const small = await ext.next((m) => m.type === 'mods', { since: since2 });
  assert.equal(small.parts, undefined);
  assert.deepEqual(small.mods.map((m) => m.id), ['a.com/data', 'a.com/small']);
});

test('host: an extension that takes one message (0.2.4 and older) gets 1 MB of mods, and is told why not more', async () => {
  const home = tempDir();
  writeBigMods(home);
  const ext = startHost(home);
  await ext.waitForSocket();
  ext.hello({ version: '0.2.4', browser: 'Firefox' });
  const mods = await ext.nextMods();
  assert.deepEqual(mods.map((m) => m.id), ['a.com/data', 'a.com/small'], 'the largest as sent (big.js, doubled by JSON) is left out');
  assert.equal(ext.parts.length, 0);
  const ping = await sockRequest(ext.sock, { id: 1, cmd: 'ping' });
  assert.deepEqual(ping.result.modErrors.map((e) => [e.id, e.limit]), [['a.com/big', 'extension']]);
  assert.match(ping.result.modErrors[0].error, /TRIF 0\.2\.4 in Firefox takes at most 1 MB of mods; update it/);
  const doctor = await runCli(['doctor', '--json'], { home });
  const check = JSON.parse(doctor.stdout).checks.find((c) => /a\.com\/big/.test(c.title));
  assert.ok(check, doctor.stdout);
  assert.equal(check.status, 'fail');
  assert.match(check.fix, /about:addons/);
  // Under 1 MB in all: everything, in one message, as before.
  const since = ext.messages.length;
  fs.rmSync(path.join(home, 'sites', 'a.com', 'data.js'));
  const now = await ext.nextMods(() => true, { since });
  assert.deepEqual(now.map((m) => m.id), ['a.com/big', 'a.com/small']);
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

test('host: a reload right after a mod file is written sends the mod first, not 150 ms later', async () => {
  const home = tempDir();
  const ext = startHost(home);
  ext.hello();
  await ext.waitForSocket();
  await ext.nextMods(() => true);
  ext.handlers.reload = () => ({ url: 'https://example.com/' });
  // An agent writes a mod and reloads at once, inside the debounce (and likely before the watcher fires).
  writeMod(home, 'example.com', 'fresh.js', '// ==WebMod==\n// @name Fresh\n// ==/WebMod==\ndocument.title = "fresh";\n');
  const since = ext.messages.length;
  const r = await sockRequest(ext.sock, { id: 'r', cmd: 'reload', args: {} });
  assert.equal(r.ok, true, r.error);
  const after = ext.messages.slice(since);
  const modsAt = after.findIndex((m) => m.type === 'mods' && m.mods.some((x) => x.id === 'example.com/fresh'));
  const reloadAt = after.findIndex((m) => m.type === 'request' && m.cmd === 'reload');
  assert.ok(modsAt !== -1 && modsAt < reloadAt, `the mod (${modsAt}) before the reload (${reloadAt}): ${after.map((m) => m.type + (m.cmd ? ` ${m.cmd}` : '')).join(', ')}`);
  await ext.close();
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

test('Tim\'s mods: none until the user chooses; shipped.install adds the sites asked for (the rest none with `others`), and the mods message says so', async () => {
  const home = tempDir();
  const ext = new FakeExtension({ home, env: { TRIF_EXAMPLES_DIR: path.join(REPO, 'examples', 'sites') } });
  cleanups.push(() => ext.close());
  ext.hello({ features: ['modsParts', 'modsSame'], version: '0.2.5' }); // (X's mods take more than one message)
  let msg = await ext.next((m) => m.type === 'mods');
  const S = require('../helper/lib/preinstalled');
  assert.deepStrictEqual([msg.mods, msg.sitesOn], [[], []]);
  assert.strictEqual(msg.starter.chosen, false);
  assert.deepStrictEqual(msg.starter.sites.map((x) => x.site), S.starterSites());
  assert.ok(msg.starter.sites.every((x) => x.choice === null && x.mods.length));
  let since = ext.messages.length;
  ext.send({ type: 'request', id: 'a', cmd: 'shipped.install', args: { sites: ['x.com', 'google.com'], others: 'none' } });
  let res = await ext.next((m) => m.type === 'response' && m.id === 'a', { since });
  assert.strictEqual(res.ok, true, res.error);
  assert.deepStrictEqual(res.result.sitesOn, ['google.com', 'x.com']);
  assert.ok(res.result.added.includes('x.com/detox-timeline'));
  // The mods went first (the extension turns the sites on from them), then the answer.
  msg = ext.messages.slice(since).findLast((m) => m.type === 'mods');
  assert.ok(msg && ext.messages.indexOf(msg) < ext.messages.indexOf(res), 'mods before the response');
  assert.deepStrictEqual(msg.sitesOn, ['google.com', 'x.com']);
  assert.ok(msg.mods.every((m) => /^(x\.com|www\.google\.com)\//.test(m.id)), msg.mods.map((m) => m.id).join());
  assert.strictEqual(msg.starter.chosen, true);
  assert.deepStrictEqual(msg.starter.sites.map((x) => [x.site, x.choice]), [['google.com', 'added'], ['x.com', 'added'], ['amazon.com', 'none'], ['instagram.com', 'none'], ['timsrobot.com', 'none']]);
  // Settings' Add, later: one more site.
  since = ext.messages.length;
  ext.send({ type: 'request', id: 'b', cmd: 'shipped.install', args: { sites: ['amazon.com'] } });
  res = await ext.next((m) => m.type === 'response' && m.id === 'b', { since });
  assert.deepStrictEqual(res.result.sitesOn, ['amazon.com']);
  msg = await ext.next((m) => m.type === 'mods' && m.starter.sites.find((x) => x.site === 'amazon.com').choice === 'added', { since });
  assert.ok(msg.mods.some((m) => m.id === 'amazon.com/simple-home'));
  // A site Tim has no mods for, or no sites: refused.
  ext.send({ type: 'request', id: 'c', cmd: 'shipped.install', args: { sites: ['example.com'] } });
  assert.match((await ext.next((m) => m.type === 'response' && m.id === 'c')).error, /Tim has no mods for example\.com/);
  ext.send({ type: 'request', id: 'd', cmd: 'shipped.install', args: { sites: [] } });
  assert.match((await ext.next((m) => m.type === 'response' && m.id === 'd')).error, /no sites/);

  // "Start with none": remembered, nothing on disk.
  const home2 = tempDir();
  const ext2 = new FakeExtension({ home: home2 });
  cleanups.push(() => ext2.close());
  await ext2.next((m) => m.type === 'mods');
  ext2.send({ type: 'request', id: 'n', cmd: 'shipped.none', args: {} });
  res = await ext2.next((m) => m.type === 'response' && m.id === 'n');
  assert.strictEqual(res.result.starter.chosen, true);
  await ext2.next((m) => m.type === 'mods' && m.starter.chosen, { timeout: 8000 });
  assert.strictEqual(fs.existsSync(path.join(home2, 'sites', 'x.com')), false);
  assert.ok(Object.values(S.starterChoices(home2)).every((c) => c === 'none'));
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
